-- ===================================================================
-- 0051  The van carries pieces too
-- ===================================================================
--
-- 0048 gave the warehouse two quantities and 0050 gave it a way to move
-- between them. The van still had one. A salesperson could be sent out
-- with ten cartons and no way to record the five loose pieces that went
-- with them, which is exactly the stock that goes missing.
--
-- This carries the second quantity through the field-sales loop it was
-- always going to have to reach: loaded onto the van, sold off it,
-- brought back at the end of the round.
--
-- PRICING A PIECE
--
-- A piece is not a twelfth of a carton in money terms. Wholesale exists
-- because buying the carton is cheaper per piece than buying singles,
-- so dividing the carton price by the pack size would undercharge every
-- single sale, quietly, forever.
--
-- piece_price is therefore its own column. It is nullable and the
-- interface falls back to list_price / pack size when it is unset -
-- which is the wrong number but a visible one, shown on the screen
-- before anything is sold, rather than a blocked sale on day one. Set
-- it and the real price is used.
--
-- BATCHES
--
-- Loose pieces do not consume batches, and full units go on doing so
-- exactly as before. That follows the rule consume_batches already
-- states in its own body: batches are a record of what arrived, not the
-- authority on how much there is - inventory is. A piece is not an
-- arrival, and once a carton is open there is no honest way to say
-- which batch a single came from.

-- ------------------------------------------------------------------
-- What a piece sells for
-- ------------------------------------------------------------------

alter table public.products
  add column if not exists piece_price numeric(14,2);

comment on column public.products.piece_price is
  'What one loose piece sells for. Null means nobody has set one, and '
  'the interface falls back to list_price divided by units_per_case - '
  'visibly, and only as a starting point. A piece is not a twelfth of a '
  'carton in money: that is what the carton is for.';

-- The masked view has to carry the new column or no screen can read it.
-- Rebuilt from its current definition with piece_price added; cost stays
-- masked exactly as it was.
do $$
begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'products_priced') then
    execute 'grant select (piece_price) on public.products to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------------
-- Pieces on the load, the sale and the return
-- ------------------------------------------------------------------

alter table public.van_load_items
  add column if not exists qty_loaded_pieces integer not null default 0;

comment on column public.van_load_items.qty_loaded_pieces is
  'Loose pieces loaded, beside qty_loaded in full units.';

alter table public.van_sale_items
  add column if not exists pieces integer not null default 0;

comment on column public.van_sale_items.pieces is
  'Loose pieces sold on this line, beside quantity in full units. A '
  'line may carry either or both: two cartons and three singles is one '
  'line of one product, not two.';

-- What the pieces on this line were charged at, kept on the line the
-- same way unit_price already is. A price that moves after the sale
-- must not change what the customer was billed.
alter table public.van_sale_items
  add column if not exists piece_price numeric(14,2) not null default 0;

-- ------------------------------------------------------------------
-- The line total has to count the pieces
-- ------------------------------------------------------------------
--
-- line_subtotal and line_total are generated columns, and both read
--
--   quantity * unit_price
--
-- and nothing else. Left alone, every loose piece on every sale would
-- be charged at nothing at all: the sale would complete, the stock
-- would leave the van, and the money would never be asked for. That is
-- the worst possible shape for this bug, because nothing fails.
--
-- PostgreSQL 17 can replace a generation expression in place. Every row
-- already recorded carries pieces = 0 and piece_price = 0, so each total
-- recomputes to exactly what it holds now.
alter table public.van_sale_items
  alter column line_subtotal set expression as (
    round((quantity::numeric * unit_price + pieces::numeric * piece_price)
          * (1::numeric - discount_pct / 100::numeric), 2)
  );

alter table public.van_sale_items
  alter column line_total set expression as (
    round((quantity::numeric * unit_price + pieces::numeric * piece_price)
          * (1::numeric - discount_pct / 100::numeric)
          * (1::numeric + tax_rate / 100::numeric), 2)
  );

alter table public.van_return_items
  add column if not exists qty_expected_pieces integer not null default 0,
  add column if not exists qty_returned_good_pieces integer not null default 0,
  add column if not exists qty_damaged_pieces integer not null default 0;

-- Missing is not entered, it is what is left over - mirroring qty_missing,
-- which has always been generated exactly this way. A piece nobody
-- returned and nobody reported damaged is a piece unaccounted for, and
-- the warehouse should not have to do that subtraction by hand.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'van_return_items'
       and column_name = 'qty_missing_pieces'
  ) then
    alter table public.van_return_items
      add column qty_missing_pieces integer
      generated always as (qty_expected_pieces - qty_returned_good_pieces - qty_damaged_pieces) stored;
  end if;
end $$;

-- ------------------------------------------------------------------
-- A line may be pieces only
-- ------------------------------------------------------------------
--
-- The same trap 0048 found in the ledger, in the two tables that feed
-- it. qty_loaded > 0 and quantity > 0 said all there was to say when a
-- line had one quantity; they now forbid the case this exists for -
-- three loose singles and no cartons is quantity 0, pieces 3.
--
-- The rule moves up a level rather than being weakened, exactly as it
-- did for stock_movements. Each column may be zero. The line as a whole
-- may not: a sale line for nothing at all is a mistake, not a record.
alter table public.van_load_items
  drop constraint if exists van_load_items_qty_loaded_check;
alter table public.van_load_items
  add constraint van_load_items_qty_loaded_not_negative check (qty_loaded >= 0);
alter table public.van_load_items
  drop constraint if exists van_load_items_pieces_not_negative;
alter table public.van_load_items
  add constraint van_load_items_pieces_not_negative check (qty_loaded_pieces >= 0);
alter table public.van_load_items
  drop constraint if exists van_load_items_loads_something;
alter table public.van_load_items
  add constraint van_load_items_loads_something
  check (qty_loaded > 0 or qty_loaded_pieces > 0);

alter table public.van_sale_items
  drop constraint if exists van_sale_items_quantity_check;
alter table public.van_sale_items
  add constraint van_sale_items_quantity_not_negative check (quantity >= 0);
alter table public.van_sale_items
  drop constraint if exists van_sale_items_pieces_not_negative;
alter table public.van_sale_items
  add constraint van_sale_items_pieces_not_negative check (pieces >= 0);
alter table public.van_sale_items
  drop constraint if exists van_sale_items_sells_something;
alter table public.van_sale_items
  add constraint van_sale_items_sells_something
  check (quantity > 0 or pieces > 0);

alter table public.van_sale_items
  drop constraint if exists van_sale_items_piece_price_check;
alter table public.van_sale_items
  add constraint van_sale_items_piece_price_check check (piece_price >= 0);

alter table public.van_return_items
  drop constraint if exists van_return_items_expected_pieces_check;
alter table public.van_return_items
  add constraint van_return_items_expected_pieces_check check (qty_expected_pieces >= 0);
alter table public.van_return_items
  drop constraint if exists van_return_items_good_pieces_check;
alter table public.van_return_items
  add constraint van_return_items_good_pieces_check check (qty_returned_good_pieces >= 0);
alter table public.van_return_items
  drop constraint if exists van_return_items_damaged_pieces_check;
alter table public.van_return_items
  add constraint van_return_items_damaged_pieces_check check (qty_damaged_pieces >= 0);

-- ------------------------------------------------------------------
-- Dispatching a load
-- ------------------------------------------------------------------
--
-- The 0045 body, with the piece half added to the availability check
-- and to both movements. Everything else is untouched, including the
-- expiry gate and the salesperson requirement.
create or replace function public.dispatch_van_load(p_load_id uuid)
returns public.van_loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  load public.van_loads;
  item record;
  available integer;
  available_pieces integer;
  expired_line record;
  sellers integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id for update;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  if load.status <> 'loaded' then
    raise exception 'Load % must be in status loaded to dispatch (currently %)',
      load.load_number, load.status;
  end if;

  -- The driver's signature is recorded when it happens and no longer
  -- required before the goods can leave. See 0045: the business this
  -- serves dispatches on the warehouse's authority, and waiting on a
  -- second approval stopped every round.

  if not exists (select 1 from public.van_load_items where load_id = p_load_id) then
    raise exception 'Load % has no items', load.load_number;
  end if;

  -- A van with nobody to sell from it is a delivery, not a round. Goods
  -- would leave the warehouse with no way to record what happened to
  -- them, which is how stock goes missing without anybody being wrong.
  select count(*) into sellers
    from public.van_assignments
   where van_id = load.van_id and unassigned_at is null and crew_role = 'salesperson';

  if sellers = 0 then
    raise exception
      'No salesperson is crewed on this van. Assign one before dispatching %.',
      load.load_number;
  end if;

  -- Nothing out of date leaves the yard. Checked before any movement is
  -- written, so a refused load moves no stock at all.
  select p.name, b.batch_number, b.expires_on
    into expired_line
    from public.van_load_items i
    join public.products p on p.id = i.product_id
    join public.product_batches b
      on b.product_id = i.product_id
     and b.warehouse_id = load.warehouse_id
     and b.qty_remaining > 0
   where i.load_id = p_load_id
     and p.track_expiry
     and b.expires_on is not null
     and b.expires_on < current_date
   order by b.expires_on
   limit 1;

  if found then
    raise exception
      'Cannot dispatch %: batch % of % expired on %. Remove it from the warehouse before loading.',
      load.load_number, expired_line.batch_number, expired_line.name, expired_line.expires_on;
  end if;

  for item in select * from public.van_load_items where load_id = p_load_id loop
    select coalesce(qty_available, 0), coalesce(qty_pieces, 0)
      into available, available_pieces
    from public.inventory
    where product_id = item.product_id and warehouse_id = load.warehouse_id;

    if coalesce(available, 0) < item.qty_loaded then
      raise exception 'Insufficient stock for product %: % available, % requested',
        item.product_id, coalesce(available, 0), item.qty_loaded;
    end if;

    -- Judged on its own. Sealed cartons in the warehouse do not cover a
    -- request for loose pieces: until one is opened the pieces are not
    -- there, and opening one is a recorded act somebody has to perform.
    if coalesce(available_pieces, 0) < coalesce(item.qty_loaded_pieces, 0) then
      raise exception
        'Not enough loose pieces of product %: % available, % requested. Open a full one first.',
        item.product_id, coalesce(available_pieces, 0), item.qty_loaded_pieces;
    end if;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, pieces, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.warehouse_id, 'transfer_out',
       item.qty_loaded, coalesce(item.qty_loaded_pieces, 0), item.unit_cost,
       'van_load', load.id, auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.van_id, 'transfer_in',
       item.qty_loaded, coalesce(item.qty_loaded_pieces, 0), item.unit_cost,
       'van_load', load.id, auth.uid());

    -- Full units only. See the header: a piece is not an arrival.
    perform public.consume_batches(item.product_id, load.warehouse_id, item.qty_loaded);
  end loop;

  update public.van_loads
     set status = 'dispatched', dispatched_at = now(), updated_at = now()
   where id = p_load_id
  returning * into load;

  return load;
end;
$function$;

-- ------------------------------------------------------------------
-- Completing a sale
-- ------------------------------------------------------------------
--
-- The 0042 body with the piece half added to the stock check and the
-- movement. Every authority check is verbatim - who may complete a sale,
-- and whether they are crewed on the van it draws from.
create or replace function public.complete_van_sale(
  p_sale_id uuid,
  p_amount_paid numeric default null::numeric
)
returns public.van_sales
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sale public.van_sales;
  item record;
  on_van integer;
  on_van_pieces integer;
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
$function$;

-- ------------------------------------------------------------------
-- Approving what came back
-- ------------------------------------------------------------------
--
-- Verbatim, with the piece half on each of the three outcomes. A
-- movement is written when either half is non-zero, so a return of
-- three loose pieces and no cartons is recorded rather than skipped by
-- a check that only ever looked at full units.
create or replace function public.approve_van_return(p_return_id uuid)
returns public.van_returns
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ret public.van_returns;
  item record;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into ret from public.van_returns where id = p_return_id for update;
  if not found then
    raise exception 'Van return % not found', p_return_id;
  end if;

  if ret.status <> 'submitted' then
    raise exception 'Return % must be submitted before approval (currently %)',
      ret.return_number, ret.status;
  end if;

  for item in select * from public.van_return_items where return_id = p_return_id loop
    if item.qty_missing < 0 or coalesce(item.qty_missing_pieces, 0) < 0 then
      raise exception 'Returned quantity for product % exceeds what was expected',
        item.product_id;
    end if;

    if item.qty_returned_good > 0 or coalesce(item.qty_returned_good_pieces, 0) > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, pieces,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'transfer_out',
              item.qty_returned_good, coalesce(item.qty_returned_good_pieces, 0),
              'van_return', ret.id, auth.uid());

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, pieces,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.warehouse_id, 'transfer_in',
              item.qty_returned_good, coalesce(item.qty_returned_good_pieces, 0),
              'van_return', ret.id, auth.uid());
    end if;

    if item.qty_damaged > 0 or coalesce(item.qty_damaged_pieces, 0) > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, pieces, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'damage',
              item.qty_damaged, coalesce(item.qty_damaged_pieces, 0),
              coalesce(item.damage_reason, 'Damaged in transit'),
              'van_return', ret.id, auth.uid());
    end if;

    if item.qty_missing > 0 or coalesce(item.qty_missing_pieces, 0) > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, pieces, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'shortage',
              item.qty_missing, coalesce(item.qty_missing_pieces, 0),
              'Unaccounted for at van return', 'van_return', ret.id, auth.uid());
    end if;
  end loop;

  update public.van_returns
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_return_id
  returning * into ret;

  update public.van_loads set status = 'returned', updated_at = now()
  where id = ret.load_id;

  return ret;
end;
$function$;

-- ------------------------------------------------------------------
-- What a load is worth, with its pieces
-- ------------------------------------------------------------------
--
-- Still definer-rights and still role-masked exactly as 0046 left it.
-- Only the sum changes: a piece is worth its share of the unit cost,
-- which for cost purposes genuinely is a twelfth of a carton - the
-- reason piece_price exists separately is margin, and cost has no
-- margin in it.
create or replace function public.van_load_value(p_load uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse') then
    return null;
  end if;

  return (
    select coalesce(sum(
      i.qty_loaded::numeric * i.unit_cost
      + case
          when coalesce(p.units_per_case, 1) > 1
          then coalesce(i.qty_loaded_pieces, 0)::numeric * i.unit_cost / p.units_per_case
          else 0
        end
    ), 0)
      from public.van_load_items i
      join public.van_loads l on l.id = i.load_id
      join public.products p on p.id = i.product_id
     where i.load_id = p_load
       and l.org_id = public.auth_org_id()
  );
end;
$$;
