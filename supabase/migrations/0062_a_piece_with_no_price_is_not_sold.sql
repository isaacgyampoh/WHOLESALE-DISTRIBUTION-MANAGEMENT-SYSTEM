-- ===================================================================
-- 0062  A piece with no price is not sold
-- ===================================================================
--
-- 0051 let a piece be priced separately and the till fell back to the
-- carton price divided by the pack size wherever none was set. That
-- fallback is wrong in a direction that costs money on every sale:
-- wholesale is the business of a carton being cheaper per piece than
-- singles are, so dividing it undercharges every single ever sold, and
-- it does so invisibly because the figure looks like a real price.
--
-- The rule now is the one the business asked for. A piece price is set
-- deliberately or the product cannot be sold by the piece. Nothing is
-- inferred.
--
-- This is the guard that governs. The till hides the piece stepper and
-- the server action refuses the line, but both of those are screens; a
-- sale reaches this database from the offline queue as well, and the
-- database is where the transaction is decided.
--
-- Otherwise the 0051 body, unchanged - every authority check verbatim.

CREATE OR REPLACE FUNCTION public.complete_van_sale(p_sale_id uuid, p_amount_paid numeric DEFAULT NULL::numeric)
 RETURNS van_sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sale public.van_sales;
  item record;
  on_van integer;
  on_van_pieces integer;
  product_name text;
  limit_amount numeric(14,2);
  terms integer;
  owing numeric(14,2);
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- The person who made the sale, or the office. Note this is the
  -- salesperson now, not the driver: the driver has no business
  -- completing somebody else's sale.
  if sale.salesperson_id <> auth.uid()
     and auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the salesperson who made this sale or a manager may complete it'
      using errcode = '42501';
  end if;

  -- And the van has to be theirs. Being the author of the sale is not
  -- the same as being entitled to the stock. See 0042.
  if auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager')
     and not public.is_van_crew(sale.van_id) then
    raise exception 'You are not crewed on the van this sale draws from'
      using errcode = '42501';
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into on_van, on_van_pieces
    from public.van_inventory
    where van_id = sale.van_id and product_id = item.product_id;

    if coalesce(on_van, 0) < item.quantity then
      raise exception 'Van does not carry enough of product %: % on board, % sold',
        item.product_id, coalesce(on_van, 0), item.quantity;
    end if;

    if coalesce(on_van_pieces, 0) < coalesce(item.pieces, 0) then
      raise exception
        'Van does not carry enough loose pieces of product %: % on board, % sold',
        item.product_id, coalesce(on_van_pieces, 0), item.pieces;
    end if;

    -- A piece with no price is a piece given away.
    --
    -- line_total is generated from piece_price, so a line carrying
    -- pieces at zero would complete, take the stock off the van, and
    -- bill the customer nothing for them - and nothing would fail. The
    -- price is not guessed from the carton either: a single is dearer
    -- per piece than the case it came out of, which is the whole of
    -- wholesale. Somebody with the authority to set prices has to set
    -- one first.
    if coalesce(item.pieces, 0) > 0 and coalesce(item.piece_price, 0) <= 0 then
      select name into product_name from public.products where id = item.product_id;
      raise exception
        'No price is set for a single %. Set the piece price before selling pieces of it.',
        coalesce(product_name, 'unit');
    end if;
  end loop;

  if sale.sale_type = 'cash' then
    if coalesce(p_amount_paid, sale.total) < sale.total then
      raise exception 'Cash sale % requires full payment of %, received %',
        sale.sale_number, sale.total, coalesce(p_amount_paid, 0);
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = p_sale_id;
  else
    select credit_limit, payment_terms_days into limit_amount, terms
    from public.customers where id = sale.customer_id;

    select coalesce(sum(amount), 0) into owing
    from public.credit_transactions where customer_id = sale.customer_id;

    if owing + sale.total > limit_amount then
      raise exception
        'Credit limit exceeded for customer: outstanding %, sale %, limit %',
        owing, sale.total, limit_amount;
    end if;

    update public.van_sales
    set amount_paid = coalesce(p_amount_paid, 0),
        status = 'completed',
        due_date = coalesce(sale.due_date, current_date + coalesce(terms, 30)),
        updated_at = now()
    where id = p_sale_id;

    insert into public.credit_transactions
      (org_id, customer_id, type, amount, reference_type, reference_id,
       due_date, created_by, notes)
    values
      (sale.org_id, sale.customer_id, 'charge',
       sale.total - coalesce(p_amount_paid, 0), 'van_sale', sale.id,
       current_date + coalesce(terms, 30), auth.uid(),
       'Credit sale ' || sale.sale_number);
  end if;

  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, 'issue',
       item.quantity, coalesce(item.pieces, 0),
       'van_sale', sale.id, auth.uid());
  end loop;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$function$
;
