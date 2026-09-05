-- ===================================================================
-- 0067  Selling over the counter
-- ===================================================================
--
-- A salesperson standing in the shop had nowhere to record a sale. The
-- till is built for a round: it reads what a van is carrying, and
-- complete_van_sale checks the seller is crewed on that van before it
-- moves anything. Someone selling to a walk-in customer from warehouse
-- stock could not use it at all.
--
-- WHY THIS IS NOT A SECOND KIND OF SALE
--
-- Everything a sale needs is already built once, on van_sales: line
-- items with unit and piece prices, cash and mobile-money splits,
-- credit against a customer's limit, a receipt the customer can open, a
-- returns path, and every report that reads any of it. A counter sale is
-- that same thing. The only difference is where the goods come from.
--
-- So van_sales grows a warehouse to draw on, and exactly one source is
-- required: a van and its round, or a warehouse. The table keeps its
-- name because renaming it would touch every query in the system to say
-- nothing new; what it records is a sale by a person to a customer, and
-- it now has two places the goods can come from.
--
-- A WALK-IN IS NOBODY IN PARTICULAR
--
-- customer_id becomes optional, because the person buying a bar of soap
-- for cash does not give their name. Credit still requires one - it has
-- to, there is a limit to check and a ledger to charge - and that is a
-- constraint here rather than a convention someone has to remember.
--
-- Nothing else changes. The van path is untouched: same crew check,
-- same balances, same messages.

-- ------------------------------------------------------------------
-- A sale can draw on a warehouse instead of a van
-- ------------------------------------------------------------------

alter table public.van_sales
  add column if not exists warehouse_id uuid references public.warehouses(id);

comment on column public.van_sales.warehouse_id is
  'The warehouse a counter sale draws on. Null for a sale off a van, '
  'which draws on its round instead. Exactly one of the two is set.';

alter table public.van_sales alter column van_id  drop not null;
alter table public.van_sales alter column load_id drop not null;
alter table public.van_sales alter column customer_id drop not null;

-- One source, never both and never neither. Without this a sale could
-- be written with no way to know what it should deduct from.
alter table public.van_sales
  drop constraint if exists van_sales_has_one_source;
alter table public.van_sales
  add constraint van_sales_has_one_source check (
    (van_id is not null and load_id is not null and warehouse_id is null)
    or
    (van_id is null and load_id is null and warehouse_id is not null)
  );

-- Credit needs somebody to owe it. A cash sale does not.
alter table public.van_sales
  drop constraint if exists van_sales_credit_has_a_customer;
alter table public.van_sales
  add constraint van_sales_credit_has_a_customer check (
    sale_type <> 'credit' or customer_id is not null
  );

create index if not exists van_sales_warehouse_idx
  on public.van_sales (warehouse_id, sold_at desc)
  where warehouse_id is not null;

-- ------------------------------------------------------------------
-- Completing a sale, from whichever source it names
-- ------------------------------------------------------------------
--
-- The 0065 body with three changes: which authority applies, which
-- balance is checked, and which place the stock leaves. Every other
-- line is as it was, including the piece-price guard and the credit
-- limit.

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

  -- Definer rights would otherwise reach across tenants.
  --
  -- This function never had the guard every other definer function here
  -- carries. The van path was narrowly protected by is_van_crew, which
  -- can only be true inside the caller's own organization, but a
  -- manager - whose role check asks nothing about org - could complete
  -- another organization's sale given its id. The counter path has no
  -- crew to lean on at all, so the guard belongs here, once, for both.
  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
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

  -- And the stock has to be theirs to sell.
  --
  -- For a round, that means being crewed on the van it draws from -
  -- being the author of a sale is not the same as being entitled to the
  -- goods, which is what 0042 closed. For a sale over the counter there
  -- is no van and no crew, so the question is only whether this person
  -- sells at all.
  if auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager') then
    if sale.van_id is not null then
      if not public.is_van_crew(sale.van_id) then
        raise exception 'You are not crewed on the van this sale draws from'
          using errcode = '42501';
      end if;
    elsif not public.has_role('sales_rep', 'salesperson') then
      raise exception 'You are not allowed to sell over the counter'
        using errcode = '42501';
    end if;
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  -- Ordered by product, and locked.
  --
  -- The balance was read without a lock, so a sale and a mid-week return
  -- could each check the same stock, each find it sufficient, and both
  -- write - taking the van negative. The row is now held from the check
  -- to the commit. Ordering by product_id gives every operation that
  -- touches a van the same lock order, so two of them queue rather than
  -- deadlock.
  for item in
    select * from public.van_sale_items
     where sale_id = p_sale_id
     order by product_id
  loop
    -- Whichever this sale draws on. Locked either way, so a counter
    -- sale and a van load cannot each promise the same units.
    if sale.van_id is not null then
      select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
        into on_van, on_van_pieces
      from public.van_inventory
      where van_id = sale.van_id and product_id = item.product_id
      for update;
    else
      select coalesce(qty_available, 0), coalesce(qty_pieces, 0)
        into on_van, on_van_pieces
      from public.inventory
      where warehouse_id = sale.warehouse_id and product_id = item.product_id
      for update;
    end if;

    -- The van wording is left exactly as it was. A salesperson reads
    -- these at a customer's counter and the sentence is part of the
    -- interface; the counter path, which never had one, gets a better
    -- one that names the product rather than its id.
    if coalesce(on_van, 0) < item.quantity then
      if sale.van_id is not null then
        raise exception 'Van does not carry enough of product %: % on board, % sold',
          item.product_id, coalesce(on_van, 0), item.quantity;
      else
        select name into product_name from public.products where id = item.product_id;
        raise exception '%: % available, % sold',
          coalesce(product_name, item.product_id::text), coalesce(on_van, 0), item.quantity;
      end if;
    end if;

    if coalesce(on_van_pieces, 0) < coalesce(item.pieces, 0) then
      if sale.van_id is not null then
        raise exception
          'Van does not carry enough loose pieces of product %: % on board, % sold',
          item.product_id, coalesce(on_van_pieces, 0), item.pieces;
      else
        select name into product_name from public.products where id = item.product_id;
        raise exception '%: % loose pieces available, % sold',
          coalesce(product_name, item.product_id::text),
          coalesce(on_van_pieces, 0), item.pieces;
      end if;
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
      (org_id, product_id, van_id, warehouse_id, type, quantity, pieces,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, sale.warehouse_id, 'issue',
       item.quantity, coalesce(item.pieces, 0),
       'van_sale', sale.id, auth.uid());

    -- Goods leaving a warehouse over the counter come off a batch, the
    -- same as goods leaving it on a load. Nothing consumed them earlier,
    -- because there was no dispatch. Full units only: a piece is not an
    -- arrival, and once a carton is open no batch owns its singles.
    if sale.warehouse_id is not null then
      perform public.consume_batches(item.product_id, sale.warehouse_id, item.quantity);
    end if;
  end loop;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$function$
;

-- ------------------------------------------------------------------
-- The receipt, for a customer who did not give a name
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_receipt_token(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tok      public.receipt_tokens;
  doc      jsonb;
  org_name text;
begin
  select * into tok
    from public.receipt_tokens
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  -- Null for unknown, expired and revoked alike. Telling the holder of
  -- a bad link which it was tells them how to make a better guess.
  if tok.id is null then
    return null;
  end if;

  update public.receipt_tokens
     set view_count = view_count + 1, last_viewed_at = now()
   where id = tok.id;

  select name into org_name from public.organizations where id = tok.org_id;

  if tok.subject_type = 'sale' then
    select jsonb_build_object(
      'kind',           'sale',
      'receiptNumber',  tok.receipt_number,
      'reference',      s.sale_number,
      'issuedAt',       s.sold_at,
      'organization',   org_name,
      'customerName',   coalesce(c.name, 'Walk-in customer'),
      'customerPhone',  tok.customer_phone,
      'servedBy',       coalesce(sp.full_name, dr.full_name),
      'saleType',       s.sale_type,
      'status',         s.status,
      'subtotal',       s.subtotal,
      'taxTotal',       s.tax_total,
      'total',          s.total,
      'amountPaid',     s.amount_paid,
      'balance',        s.balance,
      'dueDate',        s.due_date,
      'items',          coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name',       p.name,
                 'sku',        p.sku,
                 'quantity',   i.quantity,
                 -- The loose half, and what one of them cost. A customer
                 -- who bought two cartons and three singles is owed a
                 -- receipt that says so: "2" against a line they paid
                 -- thirteen cedis for is the kind of thing that gets
                 -- argued about at the next delivery.
                 'pieces',     coalesce(i.pieces, 0),
                 'piecePrice', coalesce(i.piece_price, 0),
                 'unit',       p.unit_of_measure,
                 'unitPrice',  i.unit_price,
                 'lineTotal',  i.line_total)
               order by p.name)
          from public.van_sale_items i
          join public.products p on p.id = i.product_id
         where i.sale_id = s.id), '[]'::jsonb),
      'payments',       coalesce((
        select jsonb_agg(jsonb_build_object(
                 'method',    pay.method,
                 'amount',    pay.amount,
                 'provider',  pay.provider,
                 'reference', pay.reference)
               order by pay.created_at)
          from public.van_sale_payments pay
         where pay.sale_id = s.id), '[]'::jsonb)
    )
    into doc
    from public.van_sales s
    -- Left, because a walk-in at the counter is nobody in particular.
    -- A credit sale still requires a customer; a cash one does not, and
    -- refusing to render its receipt would be refusing the commonest
    -- sale in the shop.
    left join public.customers c on c.id = s.customer_id
    left join public.profiles sp on sp.id = s.salesperson_id
    left join public.profiles dr on dr.id = s.driver_id
   where s.id = tok.subject_id;

  else
    -- A credit payment. The two figures the customer wants are what
    -- they owed and what they owe now, so both are computed here rather
    -- than left to the caller to get right.
    select jsonb_build_object(
      'kind',            'credit_payment',
      'receiptNumber',   tok.receipt_number,
      'reference',       null,
      'issuedAt',        t.occurred_at,
      'organization',    org_name,
      'customerName',    c.name,
      'customerPhone',   tok.customer_phone,
      'servedBy',        col.full_name,
      'method',          t.reference_type,
      'amount',          abs(t.amount),
      'notes',           t.notes,
      -- The ledger is signed: charges positive, payments negative. The
      -- balance after this payment is everything up to and including it.
      'balanceAfter',    coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id <= t.id))), 0),
      'balanceBefore',   coalesce((
        select sum(x.amount) from public.credit_transactions x
         where x.customer_id = t.customer_id
           and (x.occurred_at < t.occurred_at
                or (x.occurred_at = t.occurred_at and x.id < t.id))), 0)
    )
    into doc
    from public.credit_transactions t
    join public.customers c on c.id = t.customer_id
    left join public.profiles col on col.id = t.created_by
   where t.id = tok.subject_id;
  end if;

  return doc;
end;
$function$
;
