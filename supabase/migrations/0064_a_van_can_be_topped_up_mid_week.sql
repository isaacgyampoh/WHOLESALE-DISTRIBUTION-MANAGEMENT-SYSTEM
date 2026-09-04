-- ===================================================================
-- 0064  A van can be topped up mid-week
-- ===================================================================
--
-- A van goes out on Monday and comes back on Friday. In between it runs
-- out of things, and the depot sends more. Until now it could not: a
-- load was dispatched once and the manifest was fixed, so the only ways
-- to get stock onto a moving van were to reconcile the week early or to
-- adjust quantities by hand - which is the thing an audited ledger
-- exists to prevent.
--
-- WHAT ALREADY MODELS THE WEEK
--
-- The open load. van_loads_one_open_per_van is a unique index over
-- van_id for status in (loaded, dispatched), so a van has at most one
-- open load at a time, and that load already is the weekly cycle: sales,
-- returns and the reconciliation all hang off its id. Nothing new is
-- needed to represent a cycle, and inventing one would leave two
-- answers to the same question.
--
-- So a top-up is not a second load. It is more stock onto the load that
-- is already open, and the index stays exactly as it is.
--
-- WHERE THE HISTORY LIVES
--
-- van_load_items is unique on (load_id, product_id) and is the cycle's
-- cumulative manifest: what this van has been given this week. A top-up
-- adds to it. That is deliberate - every existing figure keeps working
-- untouched, because they all read the manifest:
--
--   van_load_value      what the load is worth at cost
--   build_reconciliation  expected stock at the end of the week
--   getLoadDetail       the loaded column beside sold and remaining
--
-- Had top-ups gone into a table of their own, each of those would have
-- had to learn about it, and any that was missed would quietly under-
-- count what the salesperson is answerable for on Friday.
--
-- The per-top-up detail lives where every other movement already does:
-- stock_movements, carrying product, both quantities, cost, who and
-- when, keyed by reference_id to the header below. So a top-up is one
-- transaction, separately auditable, and never lost.
--
-- WHAT A TOP-UP DOES NOT CHANGE
--
-- unit_price and unit_cost on the manifest stay as the load set them.
-- unit_price is the price list the till reads for the week, and moving
-- it mid-cycle would silently reprice goods already on the van. Cost is
-- left alone for the same reason in reverse: averaging it would rewrite
-- the basis of a figure already reported. The top-up's own cost is on
-- its movements, which is where cost truth belongs.

-- ------------------------------------------------------------------
-- The header: one row per top-up
-- ------------------------------------------------------------------
create table if not exists public.van_load_top_ups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  load_id     uuid not null references public.van_loads(id) on delete cascade,
  note        text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

comment on table public.van_load_top_ups is
  'One row per delivery of extra stock to a van whose weekly load is '
  'already out. The items are on stock_movements, keyed by this id; the '
  'running manifest is van_load_items, which this adds to.';

create index if not exists van_load_top_ups_load_idx
  on public.van_load_top_ups (load_id, created_at);

alter table public.van_load_top_ups enable row level security;

-- Mirrors van_load_items exactly: everyone in the organization may read
-- the history, and only the office may write it.
drop policy if exists van_load_top_ups_read on public.van_load_top_ups;
create policy van_load_top_ups_read on public.van_load_top_ups
  for select using (org_id = public.auth_org_id());

drop policy if exists van_load_top_ups_write on public.van_load_top_ups;
create policy van_load_top_ups_write on public.van_load_top_ups
  for all
  using (org_id = public.auth_org_id()
         and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  with check (org_id = public.auth_org_id()
              and public.has_role('admin', 'senior_manager', 'manager', 'warehouse'));

grant select on public.van_load_top_ups to authenticated;

-- The pair of movements a top-up writes is read back by this reference.
create index if not exists stock_movements_van_top_up
  on public.stock_movements (reference_id)
  where reference_type = 'van_top_up';

-- ------------------------------------------------------------------
-- Sending more stock to a van that is already out
-- ------------------------------------------------------------------
create or replace function public.top_up_van_load(
  p_load_id uuid,
  p_lines   jsonb,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  load        public.van_loads;
  top_up      public.van_load_top_ups;
  line        record;
  available   integer;
  available_pieces integer;
  product     text;
  moved       integer := 0;
begin
  -- The same authority as dispatching a load, and deliberately so:
  -- sending goods to a van is the depot's decision, not the
  -- salesperson's. A crew member topping up their own van is the hole
  -- this would otherwise open.
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  -- Locked for the duration: two top-ups landing together must not both
  -- read the same warehouse balance and both believe there is enough.
  select * into load from public.van_loads where id = p_load_id for update;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  -- Definer rights would otherwise reach across tenants.
  if auth.uid() is not null and load.org_id is distinct from public.auth_org_id() then
    raise exception 'Van load % not found', p_load_id using errcode = '42501';
  end if;

  -- The cutoff is the return being finalised, not a day or a clock.
  -- approve_van_return moves the load to 'returned', so a dispatched
  -- load is an open week - Monday or Friday, it makes no difference.
  if load.status <> 'dispatched' then
    raise exception
      'Load % is % - stock can only be added to a van that is out on its round.',
      load.load_number, load.status;
  end if;

  -- A return that has been counted but not yet approved is a special
  -- case worth naming. The count recorded what was on board at the time;
  -- adding stock behind it would show up on Friday as a surplus the
  -- salesperson cannot explain, and the blame would be theirs.
  if exists (
    select 1 from public.van_returns r
     where r.load_id = p_load_id and r.status in ('draft', 'submitted')
  ) then
    raise exception
      'A return has already been counted for load %. Approve or reject it before adding more stock.',
      load.load_number;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing was selected to send';
  end if;

  insert into public.van_load_top_ups (org_id, load_id, note, created_by)
  values (load.org_id, load.id, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning * into top_up;

  for line in
    select (l ->> 'product_id')::uuid                as product_id,
           coalesce((l ->> 'quantity')::integer, 0)  as quantity,
           coalesce((l ->> 'pieces')::integer, 0)    as pieces
      from jsonb_array_elements(p_lines) as l
  loop
    if line.product_id is null then
      raise exception 'Every line needs a product';
    end if;
    if line.quantity < 0 or line.pieces < 0 then
      raise exception 'Quantities must be whole numbers, zero or more';
    end if;
    -- Either half may be zero; a line that sends nothing may not be.
    if line.quantity = 0 and line.pieces = 0 then
      raise exception 'Every line needs a quantity above zero';
    end if;

    select name into product from public.products
     where id = line.product_id and org_id = load.org_id;
    if product is null then
      raise exception 'Product not found on this load';
    end if;

    -- Locked, so a concurrent top-up or dispatch cannot spend the same
    -- stock twice. This is the row the balance lives on.
    select coalesce(qty_available, 0), coalesce(qty_pieces, 0)
      into available, available_pieces
      from public.inventory
     where product_id = line.product_id and warehouse_id = load.warehouse_id
     for update;

    if coalesce(available, 0) < line.quantity then
      raise exception 'Only % of % at the warehouse, % requested',
        coalesce(available, 0), product, line.quantity;
    end if;

    -- Judged on its own. Sealed cartons do not cover a request for loose
    -- singles: until one is opened the pieces are not there.
    if coalesce(available_pieces, 0) < line.pieces then
      raise exception
        'Only % loose pieces of % at the warehouse, % requested. Open a full one first.',
        coalesce(available_pieces, 0), product, line.pieces;
    end if;

    -- The manifest grows. unit_price and unit_cost are set on insert and
    -- left alone on conflict: the week's price list does not move
    -- because more arrived on Wednesday.
    insert into public.van_load_items
      (org_id, load_id, product_id, qty_loaded, qty_loaded_pieces, unit_price, unit_cost)
    select load.org_id, load.id, line.product_id, line.quantity, line.pieces,
           p.list_price, p.cost_price
      from public.products p where p.id = line.product_id
    on conflict (load_id, product_id) do update
      set qty_loaded        = public.van_load_items.qty_loaded + line.quantity,
          qty_loaded_pieces = public.van_load_items.qty_loaded_pieces + line.pieces;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (load.org_id, line.product_id, load.warehouse_id, 'transfer_out',
       line.quantity, line.pieces, 'van_top_up', top_up.id,
       nullif(trim(coalesce(p_note, '')), ''), auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (load.org_id, line.product_id, load.van_id, 'transfer_in',
       line.quantity, line.pieces, 'van_top_up', top_up.id,
       nullif(trim(coalesce(p_note, '')), ''), auth.uid());

    -- Full units only, the same rule dispatch follows: a piece is not an
    -- arrival, and once a carton is open there is no honest way to say
    -- which batch a single came from.
    perform public.consume_batches(line.product_id, load.warehouse_id, line.quantity);

    moved := moved + 1;
  end loop;

  return top_up.id;
end;
$$;

comment on function public.top_up_van_load(uuid, jsonb, text) is
  'Send more stock to a van whose weekly load is already out. Adds to '
  'the load manifest so every existing figure counts it, and writes a '
  'paired movement per product under one reference so the delivery stays '
  'separately auditable. Refused once the return is finalised, or once a '
  'return has been counted and is waiting on approval.';

revoke all on function public.top_up_van_load(uuid, jsonb, text) from public, anon;
grant execute on function public.top_up_van_load(uuid, jsonb, text)
  to authenticated, service_role;
