-- ===================================================================
-- 0069  A sale opens the carton it sells from
-- ===================================================================
--
-- WHAT WAS WRONG
--
-- A salesperson could not sell a single piece of anything.
--
-- Every path - the van till, the counter, the offline queue and
-- complete_van_sale itself - judged the loose half of a request against
-- the loose half of what was held, on its own. Two cartons on the van
-- did not cover three singles. That rule was written on purpose and the
-- reasoning behind it is still right: until somebody cuts the tape
-- there are no loose pieces, and a system that conjures them is
-- inventing stock.
--
-- What was wrong was the conclusion drawn from it. The only way to make
-- pieces was convert_stock_units, which requires the warehouse role and
-- happens at the depot. So the pieces had to exist before the round
-- started, on exactly the products someone guessed would be asked for.
-- In this business they mostly do not: of the stock on the two vans
-- this week, three product lines carry loose pieces and thirty-five do
-- not. Everything else is sealed, and a customer asking for four
-- singles was refused by a screen that could see ten cartons.
--
-- WHAT HAPPENS NOW
--
-- The carton is opened, and the opening is recorded.
--
-- This is not the arithmetic shortcut 0049 refused. The salesperson
-- physically breaks a carton to hand over four singles; the ledger now
-- says so, with the same conversion_out / conversion_in pair that
-- convert_stock_units writes, carrying the sale as its reference. The
-- stock that leaves is a carton, and what remains is the singles that
-- came out of it, and both are visible in the movement history and at
-- the next stocktake.
--
-- Three things still refuse:
--
--   No pack size. Nothing here divides by a number nobody entered.
--   The refusal names the product and says what to record.
--
--   No piece price. Unchanged from 0062. A single is dearer per piece
--   than the case it came out of; the carton price divided by twelve is
--   always the wrong number, and a wrong price that looks real gets
--   charged.
--
--   Not enough cartons for both halves. Selling two cartons and four
--   singles out of two cartons needs three, and the check now counts
--   what has to be opened as part of what has to be there.
--
-- WHAT IS DELIBERATELY UNCHANGED
--
-- Batches. consume_batches still draws down only the units sold whole,
-- exactly as convert_stock_units leaves them alone when the depot opens
-- a carton by hand. A carton opened at the till therefore still counts
-- towards the expiry report until it is counted. That is a pre-existing
-- gap in batch tracking, it belongs to both paths equally, and closing
-- it in one of them would only make the two disagree.

-- ------------------------------------------------------------------
-- How many have to be opened
-- ------------------------------------------------------------------
--
-- Its own function so that the till, the server action and the sale
-- itself cannot each round it differently. Null pack size and pack
-- sizes of 1 return null: there is no answer, and the caller has to say
-- so rather than take a number that happens to type-check.
create or replace function public.units_to_open_for_pieces(
  p_pieces_wanted integer,
  p_pieces_loose  integer,
  p_pack          integer
)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_pieces_wanted, 0) <= coalesce(p_pieces_loose, 0) then 0
    when coalesce(p_pack, 1) <= 1 then null
    else ceil(
      (coalesce(p_pieces_wanted, 0) - coalesce(p_pieces_loose, 0))::numeric
      / p_pack
    )::integer
  end
$$;

comment on function public.units_to_open_for_pieces(integer, integer, integer) is
  'How many full units must be opened to cover a request for loose '
  'pieces. Zero when the loose stock already covers it, null when no '
  'pack size is configured - which is a refusal, not a zero.';

-- ------------------------------------------------------------------
-- Opening them
-- ------------------------------------------------------------------
--
-- The movement pair only. Every question of authority - who may sell,
-- whose stock this is, whether there is enough - has already been
-- answered by the caller, which is why this is granted to nobody: a
-- definer function calls it as its owner, and nothing else can reach
-- it. Given a grant it would be a way to conjure loose pieces out of
-- any carton in any organization.
create or replace function public.open_units_for_sale(
  p_org       uuid,
  p_product   uuid,
  p_warehouse uuid,
  p_van       uuid,
  p_units     integer,
  p_pack      integer,
  p_reference uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_units, 0) <= 0 then
    return;
  end if;

  -- The sealed units leave.
  insert into public.stock_movements
    (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
     reference_type, reference_id, reason, created_by)
  values
    (p_org, p_product, p_warehouse, p_van, 'conversion_out', p_units, 0,
     'unit_opened', p_reference, p_reason, auth.uid());

  -- The loose pieces appear.
  insert into public.stock_movements
    (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
     reference_type, reference_id, reason, created_by)
  values
    (p_org, p_product, p_warehouse, p_van, 'conversion_in', 0, p_units * p_pack,
     'unit_opened', p_reference, p_reason, auth.uid());
end;
$$;

comment on function public.open_units_for_sale(uuid, uuid, uuid, uuid, integer, integer, uuid, text) is
  'Write the conversion pair for full units opened to fill a sale. '
  'Checks nothing: the caller has already established authority and '
  'sufficiency. Granted to nobody on purpose.';

revoke all on function public.open_units_for_sale(uuid, uuid, uuid, uuid, integer, integer, uuid, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------------
-- Completing a sale that includes singles
-- ------------------------------------------------------------------
--
-- The 0067 body. Two changes: the loose-piece check now counts what
-- would be opened, and the movement loop opens it.

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
  unit_name text;
  pack integer;
  to_open integer;
  needed_units integer;
  limit_amount numeric(14,2);
  terms integer;
  owing numeric(14,2);
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- Definer rights would otherwise reach across tenants.
  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
  end if;

  -- The person who made the sale, or the office.
  if sale.salesperson_id <> auth.uid()
     and auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the salesperson who made this sale or a manager may complete it'
      using errcode = '42501';
  end if;

  -- And the stock has to be theirs to sell.
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

  -- Ordered by product, and locked, so every operation that touches a
  -- van takes the same lock order and two of them queue rather than
  -- deadlock.
  for item in
    select * from public.van_sale_items
     where sale_id = p_sale_id
     order by product_id
  loop
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

    select name, unit_of_measure, coalesce(units_per_case, 1)
      into product_name, unit_name, pack
      from public.products where id = item.product_id;

    -- What has to be opened to cover the singles on this line.
    to_open := public.units_to_open_for_pieces(
      coalesce(item.pieces, 0), coalesce(on_van_pieces, 0), pack);

    -- Null means the singles are not covered and there is no pack size
    -- to open against. Nothing here divides by a number nobody entered:
    -- a carton whose contents were never recorded cannot be opened into
    -- a known quantity of pieces, and guessing would put stock on the
    -- screen that is not on the shelf.
    if to_open is null then
      raise exception
        'No pack size is set for %. Record how many pieces come out of one % before selling singles of it.',
        coalesce(product_name, 'that product'), lower(coalesce(unit_name, 'unit'));
    end if;

    -- Full units the line needs: the ones sold whole, plus the ones
    -- broken open for singles. Counting only the first would let a sale
    -- of two cartons and four singles go through on two cartons.
    needed_units := item.quantity + to_open;

    if coalesce(on_van, 0) < needed_units then
      if to_open > 0 then
        raise exception
          '%: % on board, and this needs % - % sold whole and % opened for singles',
          coalesce(product_name, item.product_id::text), coalesce(on_van, 0),
          needed_units, item.quantity, to_open;
      elsif sale.van_id is not null then
        -- Wording left exactly as it was: a salesperson reads this at a
        -- customer's counter and the sentence is part of the interface.
        raise exception 'Van does not carry enough of product %: % on board, % sold',
          item.product_id, coalesce(on_van, 0), item.quantity;
      else
        raise exception '%: % available, % sold',
          coalesce(product_name, item.product_id::text), coalesce(on_van, 0), item.quantity;
      end if;
    end if;

    -- A piece with no price is a piece given away. Unchanged from 0062:
    -- line_total is generated from piece_price, so a line carrying
    -- pieces at zero would complete, take the stock, and bill nothing.
    if coalesce(item.pieces, 0) > 0 and coalesce(item.piece_price, 0) <= 0 then
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
    -- Anything that has to be opened is opened first, and recorded.
    --
    -- Read again here rather than carried from the check loop: the rows
    -- are still locked, so the figures cannot have moved, and computing
    -- it in one place means the movement can never disagree with the
    -- test that allowed it.
    if coalesce(item.pieces, 0) > 0 then
      if sale.van_id is not null then
        select coalesce(qty_pieces, 0) into on_van_pieces
          from public.van_inventory
         where van_id = sale.van_id and product_id = item.product_id;
      else
        select coalesce(qty_pieces, 0) into on_van_pieces
          from public.inventory
         where warehouse_id = sale.warehouse_id and product_id = item.product_id;
      end if;

      select coalesce(units_per_case, 1) into pack
        from public.products where id = item.product_id;

      to_open := public.units_to_open_for_pieces(
        item.pieces, coalesce(on_van_pieces, 0), pack);

      if coalesce(to_open, 0) > 0 then
        perform public.open_units_for_sale(
          sale.org_id, item.product_id, sale.warehouse_id, sale.van_id,
          to_open, pack, sale.id,
          'Opened to sell singles on ' || sale.sale_number);
      end if;
    end if;

    insert into public.stock_movements
      (org_id, product_id, van_id, warehouse_id, type, quantity, pieces,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, sale.warehouse_id, 'issue',
       item.quantity, coalesce(item.pieces, 0),
       'van_sale', sale.id, auth.uid());

    -- Goods leaving a warehouse over the counter come off a batch, the
    -- same as goods leaving it on a load. Full units sold whole only -
    -- see the note at the top about what opening a carton does not do.
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
-- The offline queue asks the same question once
-- ------------------------------------------------------------------
--
-- sync_submit pre-checked the loose half itself and then called
-- complete_van_sale, which checked it again. Two copies of one rule is
-- how they come to disagree, and they now would: the queued sale would
-- be refused here for singles the sale itself is willing to open a
-- carton for. The unit check stays - it is a cheap early word about a
-- round that has genuinely moved on - and the piece check goes to the
-- one function that governs it.

CREATE OR REPLACE FUNCTION public.sync_submit(p_id uuid, p_device_id text, p_operation sync_operation, p_payload jsonb, p_occurred_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing   public.sync_operations;
  actor      uuid := auth.uid();
  org        uuid;
  outcome    jsonb;
  line       jsonb;
  v_avail_pieces integer;
  sale       public.van_sales;
  ret        public.van_returns;
  recon      public.van_reconciliations;
  load_row   public.van_loads;
  v_customer uuid;
  v_van      uuid;
  v_avail    integer;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver');

  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  if org is null then
    raise exception 'No profile for the calling user' using errcode = '42501';
  end if;

  select * into existing from public.sync_operations where id = p_id;
  if found then
    if existing.profile_id <> actor then
      raise exception 'Operation % is not yours', p_id using errcode = '42501';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'status', existing.status,
      'result', existing.result,
      'error', existing.error,
      'replayed', true
    );
  end if;

  begin
    case p_operation

      -- ---------------------------------------------------------- sale
      when 'van_sale' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;

        if load_row.id is null then
          raise exception 'That load no longer exists';
        end if;
        if load_row.org_id <> org then
          raise exception 'That load belongs to another organization';
        end if;
        if load_row.status not in ('dispatched', 'loaded') then
          raise exception 'Load % is % and cannot take further sales',
            load_row.load_number, load_row.status;
        end if;
        if not exists (select 1 from public.customers
                        where id = v_customer and org_id = org and is_active) then
          raise exception 'That customer is no longer active';
        end if;

        v_van := load_row.van_id;

        insert into public.van_sales (
          org_id, load_id, van_id, driver_id, customer_id,
          sale_type, status, sold_at, due_date, notes,
          latitude, longitude
        ) values (
          org, load_row.id, v_van, load_row.driver_id, v_customer,
          (p_payload ->> 'sale_type')::public.van_sale_type, 'draft',
          p_occurred_at,
          nullif(p_payload ->> 'due_date', '')::date,
          nullif(p_payload ->> 'notes', ''),
          nullif(p_payload ->> 'latitude', '')::numeric,
          nullif(p_payload ->> 'longitude', '')::numeric
        ) returning * into sale;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          -- The van must actually be carrying it. A sale made offline
          -- against stock that was never on board is a conflict, not a
          -- sale, and it is caught here rather than going through.
          select qty_on_hand, coalesce(qty_pieces, 0)
            into v_avail, v_avail_pieces
            from public.van_inventory
           where van_id = v_van and product_id = (line ->> 'product_id')::uuid;

          if coalesce(v_avail, 0) < coalesce((line ->> 'quantity')::integer, 0) then
            raise exception 'Only % of that product on the van, % were sold',
              coalesce(v_avail, 0), (line ->> 'quantity')::integer;
          end if;

          -- The loose half is not judged here. complete_van_sale, below,
          -- decides it under a lock, counts the cartons that have to be
          -- opened towards what the van must be carrying, and records
          -- the opening. A second copy of that rule here could only be
          -- the stricter one, and it was: it refused singles the sale
          -- itself would have covered.

          insert into public.van_sale_items (
            org_id, sale_id, product_id, quantity, pieces,
            unit_price, piece_price, discount_pct, tax_rate
          ) values (
            org, sale.id, (line ->> 'product_id')::uuid,
            coalesce((line ->> 'quantity')::integer, 0),
            coalesce((line ->> 'pieces')::integer, 0),
            (line ->> 'unit_price')::numeric,
            coalesce((line ->> 'piece_price')::numeric, 0),
            coalesce((line ->> 'discount_pct')::numeric, 0),
            coalesce((line ->> 'tax_rate')::numeric, 0)
          );
        end loop;

        sale := public.complete_van_sale(
          sale.id, nullif(p_payload ->> 'amount_paid', '')::numeric);

        outcome := jsonb_build_object(
          'sale_id', sale.id, 'sale_number', sale.sale_number,
          'total', sale.total, 'balance', sale.balance);

      -- ---------------------------------------------------- collection
      when 'collection' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        if not exists (select 1 from public.customers where id = v_customer and org_id = org) then
          raise exception 'That customer no longer exists';
        end if;

        perform public.record_credit_payment(
          v_customer,
          (p_payload ->> 'amount')::numeric,
          coalesce((p_payload ->> 'method')::public.payment_method, 'cash'),
          nullif(p_payload ->> 'notes', ''));

        outcome := jsonb_build_object(
          'customer_id', v_customer, 'amount', (p_payload ->> 'amount')::numeric);

      -- -------------------------------------------------------- return
      when 'van_return' then
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;
        if load_row.id is null or load_row.org_id <> org then
          raise exception 'That load no longer exists';
        end if;

        insert into public.van_returns (
          org_id, load_id, van_id, driver_id, warehouse_id,
          status, returned_at, notes
        ) values (
          org, load_row.id, load_row.van_id, load_row.driver_id,
          load_row.warehouse_id, 'draft', p_occurred_at,
          nullif(p_payload ->> 'notes', '')
        ) returning * into ret;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          insert into public.van_return_items (
            org_id, return_id, product_id,
            qty_expected, qty_returned_good, qty_damaged,
            qty_expected_pieces, qty_returned_good_pieces, qty_damaged_pieces,
            damage_reason
          ) values (
            org, ret.id, (line ->> 'product_id')::uuid,
            (line ->> 'qty_expected')::integer,
            (line ->> 'qty_returned_good')::integer,
            coalesce((line ->> 'qty_damaged')::integer, 0),
            coalesce((line ->> 'qty_expected_pieces')::integer, 0),
            coalesce((line ->> 'qty_returned_good_pieces')::integer, 0),
            coalesce((line ->> 'qty_damaged_pieces')::integer, 0),
            nullif(line ->> 'damage_reason', '')
          );
        end loop;

        update public.van_returns set status = 'submitted' where id = ret.id;

        outcome := jsonb_build_object(
          'return_id', ret.id, 'return_number', ret.return_number);

      -- ------------------------------------------------ reconciliation
      when 'reconciliation' then
        select * into recon from public.van_reconciliations
         where id = (p_payload ->> 'reconciliation_id')::uuid;

        if recon.id is null then
          recon := public.build_reconciliation((p_payload ->> 'load_id')::uuid);
        end if;
        if recon.org_id <> org then
          raise exception 'That reconciliation belongs to another organization';
        end if;
        if recon.status <> 'draft' then
          raise exception 'Reconciliation % has already been submitted', recon.recon_number;
        end if;

        update public.van_reconciliations set
          status        = 'submitted',
          actual_cash   = (p_payload ->> 'actual_cash')::numeric,
          explanation   = nullif(p_payload ->> 'explanation', ''),
          submitted_by  = actor,
          submitted_at  = p_occurred_at
        where id = recon.id
        returning * into recon;

        outcome := jsonb_build_object(
          'reconciliation_id', recon.id, 'recon_number', recon.recon_number,
          'cash_variance', recon.cash_variance);
    end case;

    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, result, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      'applied', outcome, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id, 'status', 'applied', 'result', outcome, 'replayed', false);

  exception when others then
    -- The work is rolled back to the savepoint this block opened, but
    -- the verdict is kept: the driver is told what went wrong, and the
    -- same key is never retried into the same failure. A message about
    -- stock or a retired product is a conflict the driver has to see;
    -- anything else is a plain failure.
    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, error, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      case
        when sqlerrm ilike '%on the van%'
          -- What the till was carrying has moved on: the same kind of
          -- disagreement as the line above, worded by the sale itself
          -- when cartons had to be opened for singles.
          or sqlerrm ilike '%on board%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict'::public.sync_status
        else 'failed'::public.sync_status
      end,
      sqlerrm, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id,
      'status', case
        when sqlerrm ilike '%on the van%'
          -- What the till was carrying has moved on: the same kind of
          -- disagreement as the line above, worded by the sale itself
          -- when cartons had to be opened for singles.
          or sqlerrm ilike '%on board%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict' else 'failed' end,
      'error', sqlerrm,
      'replayed', false);
  end;
end;
$function$
;
