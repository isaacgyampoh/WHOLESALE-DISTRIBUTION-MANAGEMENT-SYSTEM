-- ===================================================================
-- 0065  Stock can go back to the warehouse mid-week
-- ===================================================================
--
-- Stock could reach a van three ways and leave it two. Loading and
-- topping up send it out, a sale takes it off, and the Friday return
-- brings back whatever is left. What there was no way to do was hand
-- some of it back on Tuesday.
--
-- So a manager who realised on Tuesday afternoon that fifteen boxes were
-- never needed had two options, and both were bad: carry them around
-- until Friday, or edit a quantity by hand. This is the third.
--
-- WHY NOT transfer_van_stock
--
-- It moves stock van to van and knows nothing about loads - it takes two
-- van ids. A mid-week return has to know the round it belongs to,
-- because the round is what decides whether it is still allowed. Adding
-- a nullable warehouse and a load to that function would give it a
-- second meaning, which is the reasoning 0047 used to decline bending
-- stock_transfers into a van shape. The mirror of that argument applies
-- here.
--
-- Instead this is the exact shape of top_up_van_load, run backwards:
-- keyed to the load, a header per event, paired movements under one
-- reference, and the same authority. The two are symmetrical because the
-- operations are.
--
-- WHAT IS NOT TOUCHED
--
-- The manifest. van_load_items records what was sent out, and a return
-- is not an unsending: the Tuesday top-up stays a Tuesday top-up of ten,
-- and Wednesday's return of ten appears beside it as its own
-- transaction. unit_price and unit_cost are likewise left alone -
-- moving stock during a cycle does not reprice it.
--
-- Because the manifest does not shrink, the reconciliation has to learn
-- about this, and below it does. That is the only existing calculation
-- that needed changing.
--
-- BATCHES
--
-- Not restored, which is what approve_van_return already does on Friday.
-- Stock coming back onto a shelf does not re-enter the batch it left,
-- and inventing a second batch system to pretend otherwise would put two
-- answers in the database. Batches record what arrived from a supplier;
-- inventory records how much there is.

-- ------------------------------------------------------------------
-- The header: one row per hand-back
-- ------------------------------------------------------------------
--
-- Named for what distinguishes it from van_returns, which is the Friday
-- one that closes the week. This one changes nothing about the round
-- except how much is on the van.
create table if not exists public.van_midweek_returns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  load_id      uuid not null references public.van_loads(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id),
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

comment on table public.van_midweek_returns is
  'Stock handed back from a van to a warehouse during an active round, '
  'before the Friday return closes the week. The items are on '
  'stock_movements, keyed by this id. Not van_returns, which is the '
  'Friday count that ends the cycle.';

create index if not exists van_midweek_returns_load_idx
  on public.van_midweek_returns (load_id, created_at);

alter table public.van_midweek_returns enable row level security;

-- Mirrors van_load_top_ups: the organization may read its own history,
-- and only the depot may write it.
drop policy if exists van_midweek_returns_read on public.van_midweek_returns;
create policy van_midweek_returns_read on public.van_midweek_returns
  for select using (org_id = public.auth_org_id());

drop policy if exists van_midweek_returns_write on public.van_midweek_returns;
create policy van_midweek_returns_write on public.van_midweek_returns
  for all
  using (org_id = public.auth_org_id()
         and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

grant select on public.van_midweek_returns to authenticated;

create index if not exists stock_movements_van_midweek_return
  on public.stock_movements (reference_id)
  where reference_type = 'van_midweek_return';

-- ------------------------------------------------------------------
-- Handing stock back
-- ------------------------------------------------------------------
create or replace function public.return_van_stock_to_warehouse(
  p_load_id      uuid,
  p_warehouse_id uuid,
  p_lines        jsonb,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  load        public.van_loads;
  entry       public.van_midweek_returns;
  line        record;
  on_van      integer;
  on_van_pieces integer;
  product     text;
  destination uuid;
begin
  -- The same authority as sending stock out. Taking goods off a van is
  -- the depot's decision; a salesperson quietly handing back what they
  -- did not sell is how a round stops being answerable for anything.
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id for update;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  if auth.uid() is not null and load.org_id is distinct from public.auth_org_id() then
    raise exception 'Van load % not found', p_load_id using errcode = '42501';
  end if;

  -- The same cutoff as a top-up, for the same reason: approve_van_return
  -- moves the load to 'returned', so a dispatched load is a week still
  -- running whatever day it is.
  if load.status <> 'dispatched' then
    raise exception
      'Load % is % - stock can only be handed back while the van is out on its round.',
      load.load_number, load.status;
  end if;

  -- A count already taken is not overtaken. Removing stock behind it
  -- would show up on Friday as a shortfall the salesperson cannot
  -- explain, and the blame would be theirs.
  if exists (
    select 1 from public.van_returns r
     where r.load_id = p_load_id and r.status in ('draft', 'submitted')
  ) then
    raise exception
      'A return has already been counted for load %. Approve or reject it before moving stock.',
      load.load_number;
  end if;

  destination := coalesce(p_warehouse_id, load.warehouse_id);
  if not exists (
    select 1 from public.warehouses w
     where w.id = destination and w.org_id = load.org_id
  ) then
    raise exception 'Warehouse not found';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing was selected to send back';
  end if;

  insert into public.van_midweek_returns (org_id, load_id, warehouse_id, note, created_by)
  values (load.org_id, load.id, destination,
          nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning * into entry;

  -- Ordered by product so that every operation touching a van takes its
  -- locks in the same order. Two of them queue rather than deadlock.
  for line in
    select (l ->> 'product_id')::uuid                as product_id,
           coalesce((l ->> 'quantity')::integer, 0)  as quantity,
           coalesce((l ->> 'pieces')::integer, 0)    as pieces
      from jsonb_array_elements(p_lines) as l
     order by 1
  loop
    if line.product_id is null then
      raise exception 'Every line needs a product';
    end if;
    if line.quantity < 0 or line.pieces < 0 then
      raise exception 'Quantities must be whole numbers, zero or more';
    end if;
    if line.quantity = 0 and line.pieces = 0 then
      raise exception 'Every line needs a quantity above zero';
    end if;

    select name into product from public.products
     where id = line.product_id and org_id = load.org_id;
    if product is null then
      raise exception 'Product not found on this round';
    end if;

    -- The van's own balance, locked. This is the authoritative figure -
    -- what the load carried, plus every top-up, less every sale and
    -- every hand-back already made - and holding it from the check to
    -- the commit is what stops a sale and a return spending the same
    -- units.
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into on_van, on_van_pieces
      from public.van_inventory
     where van_id = load.van_id and product_id = line.product_id
     for update;

    if coalesce(on_van, 0) < line.quantity then
      raise exception 'Only % of % on the van, % offered back',
        coalesce(on_van, 0), product, line.quantity;
    end if;

    -- Judged on its own: sealed cartons on the van are not loose
    -- singles until somebody opens one.
    if coalesce(on_van_pieces, 0) < line.pieces then
      raise exception 'Only % loose pieces of % on the van, % offered back',
        coalesce(on_van_pieces, 0), product, line.pieces;
    end if;

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (load.org_id, line.product_id, load.van_id, 'transfer_out',
       line.quantity, line.pieces, 'van_midweek_return', entry.id,
       nullif(trim(coalesce(p_note, '')), ''), auth.uid());

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (load.org_id, line.product_id, destination, 'transfer_in',
       line.quantity, line.pieces, 'van_midweek_return', entry.id,
       nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  end loop;

  return entry.id;
end;
$$;

comment on function public.return_van_stock_to_warehouse(uuid, uuid, jsonb, text) is
  'Hand unsold stock back from a van to a warehouse during an active '
  'round. Writes a paired movement per product under one reference and '
  'leaves the load manifest alone - a return is not an unsending. '
  'Refused once the Friday return is finalised, or once one has been '
  'counted and is waiting on approval.';

revoke all on function public.return_van_stock_to_warehouse(uuid, uuid, jsonb, text)
  from public, anon;
grant execute on function public.return_van_stock_to_warehouse(uuid, uuid, jsonb, text)
  to authenticated, service_role;

-- ------------------------------------------------------------------
-- Friday counts what already went back
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.build_reconciliation(p_load_id uuid)
 RETURNS van_reconciliations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  load public.van_loads;
  rec  public.van_reconciliations;
  cash_sales numeric(14,2);
  credit numeric(14,2);
  collected numeric(14,2);
  cash_taken numeric(14,2);
  momo_taken numeric(14,2);
  loaded_value numeric(14,2);
  sold_value numeric(14,2);
  damaged numeric(14,2);
  missing numeric(14,2);
  remaining numeric(14,2);
  sent_back numeric(14,2);
begin
  select * into load from public.van_loads where id = p_load_id;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  select
    coalesce(sum(total) filter (where sale_type = 'cash'), 0),
    coalesce(sum(total) filter (where sale_type = 'credit'), 0),
    coalesce(sum(amount_paid) filter (where sale_type = 'credit'), 0)
  into cash_sales, credit, collected
  from public.van_sales
  where load_id = p_load_id and status = 'completed';

  -- What was actually taken, by method. A sale recorded before this
  -- migration has no breakdown, so it falls back to being treated as
  -- cash - which is what it was assumed to be at the time.
  select
    coalesce(t.cash_taken, 0),
    coalesce(t.momo_taken, 0)
  into cash_taken, momo_taken
  from public.load_takings t
  where t.load_id = p_load_id;

  if cash_taken = 0 and momo_taken = 0 then
    cash_taken := cash_sales + collected;
  end if;

  -- Each figure carries the loose half at its share of the unit cost.
  -- A piece is genuinely a twelfth of a carton in cost terms - cost has
  -- no margin in it to distort - which is the same rule van_load_value
  -- and stock_summary use.
  select coalesce(sum(
           i.qty_loaded * i.unit_cost
           + case when coalesce(p.units_per_case, 1) > 1
                  then coalesce(i.qty_loaded_pieces, 0) * i.unit_cost / p.units_per_case
                  else 0 end), 0)
    into loaded_value
  from public.van_load_items i
  join public.products p on p.id = i.product_id
  where i.load_id = p_load_id;

  select coalesce(sum(
           vsi.quantity * vli.unit_cost
           + case when coalesce(p.units_per_case, 1) > 1
                  then coalesce(vsi.pieces, 0) * vli.unit_cost / p.units_per_case
                  else 0 end), 0)
    into sold_value
  from public.van_sale_items vsi
  join public.van_sales vs on vs.id = vsi.sale_id
  join public.van_load_items vli
    on vli.load_id = vs.load_id and vli.product_id = vsi.product_id
  join public.products p on p.id = vsi.product_id
  where vs.load_id = p_load_id and vs.status = 'completed';

  select
    coalesce(sum(
      vri.qty_damaged * vli.unit_cost
      + case when coalesce(p.units_per_case, 1) > 1
             then coalesce(vri.qty_damaged_pieces, 0) * vli.unit_cost / p.units_per_case
             else 0 end), 0),
    coalesce(sum(
      vri.qty_missing * vli.unit_cost
      + case when coalesce(p.units_per_case, 1) > 1
             then coalesce(vri.qty_missing_pieces, 0) * vli.unit_cost / p.units_per_case
             else 0 end), 0)
  into damaged, missing
  from public.van_return_items vri
  join public.van_returns vr on vr.id = vri.return_id
  join public.van_load_items vli
    on vli.load_id = vr.load_id and vli.product_id = vri.product_id
  join public.products p on p.id = vri.product_id
  where vr.load_id = p_load_id;

  -- Stock the depot took back mid-week, at the same cost basis as the
  -- rest of this reckoning.
  --
  -- Without this the week expects everything that was ever sent out,
  -- less what sold - and a van that correctly handed fifteen boxes back
  -- on Tuesday arrives on Friday fifteen short of a figure that was
  -- never right. The salesperson carries a variance the depot created.
  select coalesce(sum(
           sm.quantity * vli.unit_cost
           + case when coalesce(p.units_per_case, 1) > 1
                  then coalesce(sm.pieces, 0) * vli.unit_cost / p.units_per_case
                  else 0 end), 0)
    into sent_back
  from public.stock_movements sm
  join public.van_midweek_returns r on r.id = sm.reference_id
  join public.van_load_items vli
    on vli.load_id = r.load_id and vli.product_id = sm.product_id
  join public.products p on p.id = sm.product_id
  where sm.reference_type = 'van_midweek_return'
    and sm.type = 'transfer_out'
    and r.load_id = p_load_id;

  remaining := loaded_value - sold_value - sent_back;

  insert into public.van_reconciliations (
    org_id, load_id, van_id, driver_id,
    opening_float, cash_sales_total, momo_sales_total, credit_sales_total,
    collections_total, expected_cash, expected_momo,
    expected_stock_value, actual_stock_value,
    damaged_value, missing_value, submitted_by
  )
  values (
    load.org_id, load.id, load.van_id, load.driver_id,
    load.opening_float, cash_sales, momo_taken, credit,
    collected,
    -- The float goes out with the driver and comes back with them.
    -- Mobile money never touches the tin, so it is not expected here.
    load.opening_float + cash_taken,
    momo_taken,
    remaining, remaining - damaged - missing,
    damaged, missing, auth.uid()
  )
  on conflict (load_id) do update
  set cash_sales_total   = excluded.cash_sales_total,
      momo_sales_total   = excluded.momo_sales_total,
      credit_sales_total = excluded.credit_sales_total,
      collections_total  = excluded.collections_total,
      expected_cash      = excluded.expected_cash,
      expected_momo      = excluded.expected_momo,
      expected_stock_value = excluded.expected_stock_value,
      actual_stock_value   = excluded.actual_stock_value,
      damaged_value        = excluded.damaged_value,
      missing_value        = excluded.missing_value,
      updated_at           = now()
  returning * into rec;

  return rec;
end;
$function$
;


-- ------------------------------------------------------------------
-- A sale locks the stock it is about to spend
-- ------------------------------------------------------------------
--
-- Otherwise a sale and a mid-week return can each read the same balance,
-- each find it sufficient, and both write. Nothing in the schema stops a
-- van balance going negative - 0048 explains why there is no check
-- constraint - so the protection has to be the lock.
--
-- Otherwise the 0062 body unchanged: every authority check verbatim.

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
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into on_van, on_van_pieces
    from public.van_inventory
    where van_id = sale.van_id and product_id = item.product_id
    for update;

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
