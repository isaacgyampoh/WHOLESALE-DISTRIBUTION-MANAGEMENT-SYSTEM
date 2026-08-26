-- =====================================================================
-- UPGRADE: Van crew, counter sales, and the ways stock enters
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0021_crew_and_selling.sql
-- Regenerate: node database/build.mjs
--
-- FOR AN EXISTING INSTALLATION ONLY. A database installed from
-- WHOLESALE_DISTRIBUTION_DATABASE.sql already contains this.
--
-- RUN IT ONCE. Unlike the other upgrade scripts in this folder, this one
-- creates types, renames columns and replaces indexes, so a second run
-- fails partway with "already exists" rather than doing nothing. To check
-- whether it has already been applied, run:
--
--   select 1 from pg_type where typname = 'van_crew_role';
--   If that returns a row, this has been applied.
--
-- Run UPGRADE_0020_MOVEMENT_TYPES.sql first, on its own: PostgreSQL cannot use a new
-- enum value in the transaction that added it.
-- =====================================================================

-- =====================================================================
-- 0021_crew_and_selling.sql
--
-- The business this schema now has to describe:
--
--   WAREHOUSE -> VAN -> SALESPERSON -> CUSTOMER
--
-- The driver takes the van out and answers for what is on it. The
-- salesperson riding with the van is the one who sells. Until now the
-- schema had only a driver, and the driver both carried the stock and
-- made the sale, so there was nowhere to record a salesperson and no way
-- to stop a driver selling.
--
-- Four changes follow from that, plus the inventory entry points the
-- catalogue never had:
--
--   1. van_assignments becomes a CREW table. It already was the one
--      authoritative record of who is on which van; it gains a crew_role
--      so it can hold a salesperson as well as a driver. driver_id is
--      renamed member_id, because a column named driver_id holding a
--      salesperson is exactly the ambiguity this migration exists to
--      remove. The foreign key and indexes are renamed with it so no
--      constraint keeps an obsolete name.
--
--   2. van_sales.driver_id becomes salesperson_id, and the table learns
--      to hold a counter sale as well as a van sale: van_id and load_id
--      become optional and warehouse_id appears beside them, with a
--      check constraint keeping exactly one location. An in-shop
--      salesperson is not given a van to satisfy the schema.
--
--   3. Selling is one SECURITY DEFINER function, record_sale(), that
--      determines the seller's authorized location from the database
--      rather than from the request, checks stock, and writes the sale,
--      the lines, the ledger movements and any credit charge in a single
--      transaction. Nothing half-commits.
--
--   4. Stock now has entry points: opening stock at product creation,
--      a deliberate correction, and a stocktake. All three land in
--      stock_movements, which stays the only place stock changes.
--
-- Nothing here weakens a policy. Drivers lose the ability to create a
-- sale, which they should never have had; every other grant is narrowed
-- or unchanged.
-- =====================================================================

-- ===================================================================
-- 1. Ledger: where the new movement types push the balance
-- ===================================================================

create or replace function public.movement_direction(t public.movement_type)
returns integer
language sql
immutable
as $$
  select case t
    when 'receipt'          then  1
    when 'transfer_in'      then  1
    when 'customer_return'  then  1
    when 'adjustment_in'    then  1
    when 'opening_stock'    then  1
    when 'stocktake_in'     then  1
    when 'issue'            then -1
    when 'transfer_out'     then -1
    when 'supplier_return'  then -1
    when 'adjustment_out'   then -1
    when 'damage'           then -1
    when 'shortage'         then -1
    when 'stocktake_out'    then -1
  end
$$;

comment on function public.movement_direction is
  'Sign of a movement type. Every type must appear here: a missing case '
  'returns null and the trigger that applies the movement would fail.';

-- ===================================================================
-- 2. Van crew: driver and salesperson on the same van
-- ===================================================================

create type public.van_crew_role as enum ('driver', 'salesperson');

alter table public.van_assignments
  add column crew_role public.van_crew_role not null default 'driver';

-- Everything already recorded was a driver assignment, which is what the
-- default above gives it. The rename is safe for the same reason.
alter table public.van_assignments rename column driver_id to member_id;
alter table public.van_assignments
  rename constraint van_assignments_driver_id_fkey to van_assignments_member_id_fkey;

comment on column public.van_assignments.member_id is
  'The crew member. crew_role says whether they drive the van or sell from it.';

-- One driver per van, as before. Salespeople are not limited to one per
-- van: a van can carry a crew.
drop index public.van_assignments_one_active_van;
create unique index van_assignments_one_active_driver_per_van
  on public.van_assignments (van_id)
  where unassigned_at is null and crew_role = 'driver';

-- Nobody is on two vans at once, whichever seat they are in. This is
-- what makes "the caller's van" a single answer the server can trust.
drop index public.van_assignments_one_active_driver;
create unique index van_assignments_one_active_van_per_member
  on public.van_assignments (member_id)
  where unassigned_at is null;

alter index public.van_assignments_driver_idx rename to van_assignments_member_idx;

-- ------------------------------------------------------ crew lookups
-- The van the caller is crewed on, in any seat. Used wherever "may this
-- person see this van" is the question.
create or replace function public.my_van_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select van_id from public.van_assignments
  where member_id = auth.uid() and unassigned_at is null
  limit 1
$$;

comment on function public.my_van_id is
  'Van the caller is currently crewed on, driver or salesperson.';

-- The van the caller drives. A driver reads their van through this.
create or replace function public.my_driver_van_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select van_id from public.van_assignments
  where member_id = auth.uid()
    and unassigned_at is null
    and crew_role = 'driver'
  limit 1
$$;

-- The van the caller may SELL from. This is the only thing that decides
-- a field salesperson's stock, and it is never taken from the request.
create or replace function public.my_sales_van_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select van_id from public.van_assignments
  where member_id = auth.uid()
    and unassigned_at is null
    and crew_role = 'salesperson'
  limit 1
$$;

comment on function public.my_sales_van_id is
  'Van the caller is authorized to sell from; null for an in-shop seller.';

-- ===================================================================
-- 3. The in-shop salesperson's location
--
-- A shop assistant has no van. What they may sell is decided by the
-- warehouse or shop they are posted to, held on their profile and
-- changeable only by an administrator.
-- ===================================================================

alter table public.profiles
  add column sales_warehouse_id uuid references public.warehouses (id) on delete set null;

comment on column public.profiles.sales_warehouse_id is
  'Shop or warehouse an in-shop salesperson sells from. Null for field '
  'staff, who sell from their van, and for everyone who does not sell.';

-- Same reasoning as the role guard: a seller who could set their own
-- selling location could sell any warehouse''s stock.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context()
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active)
     and not public.has_role('admin') then
    raise exception 'Only an administrator may change a user role or status'
      using errcode = '42501';
  end if;

  if not public.is_trusted_context()
     and new.sales_warehouse_id is distinct from old.sales_warehouse_id
     and not public.has_role('admin', 'senior_manager') then
    raise exception 'Only an administrator may change a selling location'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.my_sales_warehouse_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sales_warehouse_id from public.profiles
  where id = auth.uid() and is_active
$$;

-- ------------------------------------------- what a seller may see
-- A field salesperson sees the products on their van and no others, so
-- van A's seller cannot browse, price or sell van B's stock. This is
-- enforced in the catalogue policy itself, not only on the sell screen.
create or replace function public.can_access_product(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('admin', 'senior_manager') then true
    when public.has_role('manager') then exists (
      select 1 from public.products p
      join public.manager_category_scopes s on s.category_id = p.category_id
      where p.id = target and s.profile_id = auth.uid()
    )
    when public.has_role('driver') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    )
    -- A sales_rep crewed on a van is a field salesperson: their
    -- catalogue is that van. One with no van is in the shop and sees the
    -- whole catalogue, as they always did.
    when public.has_role('sales_rep') and public.my_sales_van_id() is not null then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_sales_van_id()
    )
    when public.auth_role() is null then false
    else true
  end
$$;

-- ===================================================================
-- 4. van_sales: the seller is a salesperson, the location may be a shop
-- ===================================================================

alter table public.van_sales rename column driver_id to salesperson_id;
alter table public.van_sales
  rename constraint van_sales_driver_id_fkey to van_sales_salesperson_id_fkey;
alter index public.van_sales_driver_idx rename to van_sales_salesperson_idx;

comment on column public.van_sales.salesperson_id is
  'Who made the sale. A driver never appears here: drivers do not sell.';

-- A counter sale has no van and no load.
alter table public.van_sales alter column van_id  drop not null;
alter table public.van_sales alter column load_id drop not null;

alter table public.van_sales
  add column warehouse_id uuid references public.warehouses (id) on delete restrict;

-- Exactly one place the goods left from, so stock can never be deducted
-- from two locations or from none.
alter table public.van_sales
  add constraint van_sales_one_location check (
    (van_id is not null and warehouse_id is null)
    or (van_id is null and warehouse_id is not null)
  );

-- A load belongs to a van; a counter sale cannot carry one.
alter table public.van_sales
  add constraint van_sales_load_requires_van check (load_id is null or van_id is not null);

create index van_sales_warehouse_idx on public.van_sales (warehouse_id, sold_at desc);

create trigger van_sales_same_org_warehouse before insert or update on public.van_sales
  for each row execute function public.assert_same_org('warehouse_id', 'warehouses');

-- van_id may now be null, so the organization can no longer always be
-- derived from the van. Fall back to the warehouse, then to the caller.
create or replace function public.fill_van_sale_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived uuid;
begin
  if new.org_id is not null then
    return new;
  end if;

  if new.van_id is not null then
    select org_id into derived from public.vans where id = new.van_id;
  elsif new.warehouse_id is not null then
    select org_id into derived from public.warehouses where id = new.warehouse_id;
  end if;

  new.org_id := coalesce(derived, public.auth_org_id());
  if new.org_id is null then
    raise exception 'Cannot determine organization for van_sales';
  end if;
  return new;
end;
$$;

drop trigger van_sales_fill_org on public.van_sales;
create trigger van_sales_fill_org before insert on public.van_sales
  for each row execute function public.fill_van_sale_org();

-- ===================================================================
-- 5. Getting stock into the system
--
-- Three deliberate, separately named events. Stock count stays what it
-- has always been - "what is physically here right now" - and is no
-- longer the only door into the ledger, which is why people were being
-- sent through it to enter a starting balance.
-- ===================================================================

-- Opening stock at the moment a product is created. One call, so a
-- product with a starting balance cannot half-exist.
create or replace function public.create_product_with_stock(
  p_sku            text,
  p_name           text,
  p_warehouse_id   uuid    default null,
  p_opening_qty    integer default 0,
  p_category_id    uuid    default null,
  p_supplier_id    uuid    default null,
  p_unit_of_measure text   default 'each',
  p_units_per_case integer default 1,
  p_cost_price     numeric default 0,
  p_list_price     numeric default 0,
  p_tax_rate       numeric default 0,
  p_reorder_point  integer default 0,
  p_reorder_qty    integer default 0,
  p_barcode        text    default null,
  p_description    text    default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  product public.products;
  org uuid;
  wh  uuid;
begin
  perform public.require_role('admin', 'senior_manager', 'manager');

  if coalesce(trim(p_sku), '') = '' then
    raise exception 'A product needs an SKU';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A product needs a name';
  end if;
  if coalesce(p_opening_qty, 0) < 0 then
    raise exception 'Opening stock cannot be negative';
  end if;

  -- A scoped manager may not create a product outside their categories,
  -- which would otherwise be a way to widen their own access.
  if p_category_id is not null and not public.can_access_category(p_category_id) then
    raise exception 'You do not have access to that product category'
      using errcode = '42501';
  end if;

  org := public.auth_org_id();

  if p_warehouse_id is not null then
    select id, org_id into wh, org
    from public.warehouses
    where id = p_warehouse_id
      and (org = org_id or org is null);
    if wh is null then
      raise exception 'Warehouse % not found in your organization', p_warehouse_id;
    end if;
  end if;

  if org is null then
    raise exception 'Cannot determine organization for the new product';
  end if;

  insert into public.products (
    org_id, sku, barcode, name, description, category_id, supplier_id,
    unit_of_measure, units_per_case, cost_price, list_price, tax_rate,
    reorder_point, reorder_qty, created_by
  )
  values (
    org, trim(p_sku), nullif(trim(coalesce(p_barcode, '')), ''), trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''), p_category_id, p_supplier_id,
    coalesce(nullif(trim(p_unit_of_measure), ''), 'each'), coalesce(p_units_per_case, 1),
    coalesce(p_cost_price, 0), coalesce(p_list_price, 0), coalesce(p_tax_rate, 0),
    coalesce(p_reorder_point, 0), coalesce(p_reorder_qty, 0), auth.uid()
  )
  returning * into product;

  -- The opening balance is a ledger entry like every other stock change,
  -- so the product's history starts with where it started.
  if coalesce(p_opening_qty, 0) > 0 then
    if wh is null then
      raise exception 'Opening stock needs a warehouse to be counted in';
    end if;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, unit_cost,
       reference_type, reference_id, reason, created_by)
    values
      (org, product.id, wh, 'opening_stock', p_opening_qty,
       coalesce(p_cost_price, 0), 'product', product.id,
       'Opening stock at product creation', auth.uid());
  end if;

  return product;
end;
$$;

comment on function public.create_product_with_stock is
  'Creates a product and, if a quantity is given, its opening stock '
  'movement, in one transaction.';

-- Stock arriving outside a purchase order: a delivery entered by hand,
-- a top-up. Adds to what is there rather than replacing it.
create or replace function public.add_stock(
  p_product_id   uuid,
  p_warehouse_id uuid,
  p_quantity     integer,
  p_reason       text default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  movement public.stock_movements;
  org uuid;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Quantity to add must be a positive number';
  end if;
  if not public.can_access_product(p_product_id) and not public.is_trusted_context() then
    raise exception 'You do not have access to that product' using errcode = '42501';
  end if;

  select w.org_id into org
  from public.warehouses w
  join public.products p on p.id = p_product_id and p.org_id = w.org_id
  where w.id = p_warehouse_id;

  if org is null then
    raise exception 'Product and warehouse must belong to the same organization';
  end if;

  insert into public.stock_movements
    (org_id, product_id, warehouse_id, type, quantity, reason, created_by)
  values
    (org, p_product_id, p_warehouse_id, 'receipt', p_quantity,
     coalesce(nullif(trim(p_reason), ''), 'Stock added'), auth.uid())
  returning * into movement;

  return movement;
end;
$$;

-- Correcting a quantity to what it should be.
--
-- The number on screen changes; the history does not. What is written is
-- the DIFFERENCE, as an adjustment carrying its reason, so next month it
-- is still possible to see that someone changed 50 to 45 and why.
create or replace function public.adjust_stock_to(
  p_product_id   uuid,
  p_warehouse_id uuid,
  p_new_quantity integer,
  p_reason       text
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  movement public.stock_movements;
  current_qty integer;
  delta integer;
  org uuid;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'The corrected quantity must be zero or more';
  end if;

  -- An adjustment without a reason is an unexplained change to the
  -- company's stock position. Refuse it.
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A stock adjustment must say why';
  end if;

  if not public.can_access_product(p_product_id) and not public.is_trusted_context() then
    raise exception 'You do not have access to that product' using errcode = '42501';
  end if;

  select w.org_id into org
  from public.warehouses w
  join public.products p on p.id = p_product_id and p.org_id = w.org_id
  where w.id = p_warehouse_id;

  if org is null then
    raise exception 'Product and warehouse must belong to the same organization';
  end if;

  select coalesce(qty_on_hand, 0) into current_qty
  from public.inventory
  where product_id = p_product_id and warehouse_id = p_warehouse_id;

  delta := p_new_quantity - coalesce(current_qty, 0);

  if delta = 0 then
    raise exception 'Stock is already %; nothing to adjust', p_new_quantity;
  end if;

  insert into public.stock_movements
    (org_id, product_id, warehouse_id, type, quantity, reason, created_by)
  values
    (org, p_product_id, p_warehouse_id,
     (case when delta > 0 then 'adjustment_in' else 'adjustment_out' end)::public.movement_type,
     abs(delta), trim(p_reason), auth.uid())
  returning * into movement;

  return movement;
end;
$$;

comment on function public.adjust_stock_to is
  'Corrects a stock figure by posting the difference as an adjustment. '
  'The previous balance and the reason both survive in the ledger.';

-- Stock count: what was physically found, line by line.
-- p_counts is [{"product_id": uuid, "counted": integer}, ...]
create or replace function public.record_stocktake(
  p_warehouse_id uuid,
  p_counts       jsonb,
  p_notes        text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  line record;
  org uuid;
  delta integer;
  posted integer := 0;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) = 0 then
    raise exception 'A stock count needs at least one counted line';
  end if;

  select org_id into org from public.warehouses where id = p_warehouse_id;
  if org is null then
    raise exception 'Warehouse % not found', p_warehouse_id;
  end if;
  if not public.is_trusted_context() and org <> public.auth_org_id() then
    raise exception 'That warehouse belongs to another organization'
      using errcode = '42501';
  end if;

  for line in
    select (e ->> 'product_id')::uuid as product_id,
           (e ->> 'counted')::integer as counted
    from jsonb_array_elements(p_counts) e
  loop
    if line.counted is null or line.counted < 0 then
      raise exception 'Counted quantity for product % must be zero or more',
        line.product_id;
    end if;
    if not public.can_access_product(line.product_id) and not public.is_trusted_context() then
      raise exception 'You do not have access to product %', line.product_id
        using errcode = '42501';
    end if;

    delta := line.counted - coalesce(
      (select i.qty_on_hand from public.inventory i
        where i.product_id = line.product_id
          and i.warehouse_id = p_warehouse_id), 0);

    -- A line that agrees with the ledger is the normal case and writes
    -- nothing: a stocktake should not fill the history with zero rows.
    if delta = 0 then
      continue;
    end if;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, reason, created_by)
    values
      (org, line.product_id, p_warehouse_id,
       (case when delta > 0 then 'stocktake_in' else 'stocktake_out' end)::public.movement_type,
       abs(delta),
       coalesce(nullif(trim(p_notes), ''), 'Stock count'), auth.uid());

    posted := posted + 1;
  end loop;

  return posted;
end;
$$;

comment on function public.record_stocktake is
  'Posts the difference between a physical count and the ledger. '
  'Returns how many lines actually moved.';

-- ===================================================================
-- 6. Where the caller is allowed to sell from
--
-- This is the hinge of the whole workflow. The answer comes from the
-- caller's session and their assignments, never from the request. A
-- salesperson who posts a different van_id gets their own van; a driver
-- gets an error.
-- ===================================================================

create or replace function public.resolve_sales_location(p_warehouse_id uuid default null)
returns table (kind text, van_id uuid, warehouse_id uuid, load_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_role public.user_role;
  trusted boolean := public.is_trusted_context();
  v uuid;
  w uuid;
  l uuid;
  org uuid := public.auth_org_id();
begin
  if not trusted and auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  actor_role := public.auth_role();

  -- The driver keeps the van; the salesperson sells from it. Said here
  -- once, so every caller of this function inherits it.
  if actor_role = 'driver' then
    raise exception 'A driver cannot record a sale. Sales are made by the salesperson assigned to the van.'
      using errcode = '42501';
  end if;

  if not trusted
     and actor_role is distinct from 'admin'
     and actor_role is distinct from 'senior_manager'
     and actor_role is distinct from 'manager'
     and actor_role is distinct from 'sales_rep' then
    raise exception 'Your role does not permit recording sales' using errcode = '42501';
  end if;

  -- A field salesperson: the van they are crewed on, and only that one.
  v := public.my_sales_van_id();
  if v is not null then
    select id into l
    from public.van_loads
    where van_loads.van_id = v and status = 'dispatched'
    order by load_date desc, created_at desc
    limit 1;

    return query select 'van'::text, v, null::uuid, l;
    return;
  end if;

  -- Otherwise a counter sale, from the location this person is posted to.
  w := public.my_sales_warehouse_id();

  -- Managers and administrators are authorized across locations, so they
  -- may name one. A salesperson may not, and the parameter is ignored.
  if p_warehouse_id is not null
     and (trusted or public.has_role('admin', 'senior_manager', 'manager')) then
    w := p_warehouse_id;
  end if;

  if w is null and (trusted or public.has_role('admin', 'senior_manager', 'manager')) then
    select id into w from public.warehouses
    where is_default and is_active
      and (org is null or org_id = org)
    limit 1;
  end if;

  if w is null then
    raise exception
      'You have no van assignment and no shop location, so there is nothing you can sell from. Ask a manager to assign you.'
      using errcode = '42501';
  end if;

  if not trusted and not exists (
    select 1 from public.warehouses where id = w and org_id = org
  ) then
    raise exception 'That location belongs to another organization'
      using errcode = '42501';
  end if;

  return query select 'warehouse'::text, null::uuid, w, null::uuid;
end;
$$;

comment on function public.resolve_sales_location is
  'The caller''s authorized selling location, decided by the database. '
  'Any van or warehouse id supplied by a salesperson is ignored.';

-- ===================================================================
-- 7. Recording a sale
--
-- One call: header, lines, stock check, payment or credit, ledger
-- movements. It either all happens or none of it does, because it is one
-- statement in one transaction. There is no window in which a sale
-- exists but the stock has not left.
--
-- p_items is [{"product_id": uuid, "quantity": integer,
--              "unit_price": numeric (optional), "discount_pct": numeric (optional)}]
-- ===================================================================

create or replace function public.record_sale(
  p_customer_id  uuid,
  p_items        jsonb,
  p_sale_type    public.van_sale_type default 'cash',
  p_amount_paid  numeric default null,
  p_warehouse_id uuid default null,
  p_notes        text default null
)
returns public.van_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  loc record;
  sale public.van_sales;
  org uuid;
  customer record;
  wanted_lines integer;
  accepted integer;
  blocked uuid;
  shortfall record;
  owing numeric(14,2);
  terms integer;
  paid numeric(14,2);
begin
  -- Who may sell, and from where. Raises for a driver, for an
  -- unassigned salesperson, and for anyone not signed in.
  select * into loc from public.resolve_sales_location(p_warehouse_id);

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one product';
  end if;

  select c.id, c.org_id, c.credit_limit, c.payment_terms_days
    into customer
  from public.customers c
  where c.id = p_customer_id and c.is_active;

  if customer.id is null then
    raise exception 'Customer not found';
  end if;

  org := customer.org_id;

  if not public.is_trusted_context() and org <> public.auth_org_id() then
    raise exception 'That customer belongs to another organization'
      using errcode = '42501';
  end if;

  insert into public.van_sales
    (org_id, load_id, van_id, warehouse_id, salesperson_id, customer_id,
     sale_type, status, notes)
  values
    (org, loc.load_id, loc.van_id, loc.warehouse_id, auth.uid(), p_customer_id,
     p_sale_type, 'draft', nullif(trim(coalesce(p_notes, '')), ''))
  returning * into sale;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where coalesce((e ->> 'quantity')::integer, 0) <= 0
  ) then
    raise exception 'Every quantity on a sale must be a positive number';
  end if;

  -- Lines. The price a field salesperson sells at is the one fixed when
  -- the van was loaded, so a seller cannot discount at will; a counter
  -- sale uses the list price. A manager may override, nobody else can.
  with wanted as (
    select (e ->> 'product_id')::uuid as product_id,
           sum((e ->> 'quantity')::integer) as quantity,
           max(coalesce((e ->> 'discount_pct')::numeric, 0)) as discount_pct,
           max((e ->> 'unit_price')::numeric) as asked_price
    from jsonb_array_elements(p_items) e
    group by 1
  )
  insert into public.van_sale_items
    (org_id, sale_id, product_id, quantity, unit_price, discount_pct, tax_rate)
  select
    org, sale.id, w.product_id, w.quantity,
    case
      when w.asked_price is not null
       and (public.is_trusted_context()
            or public.has_role('admin', 'senior_manager', 'manager'))
        then w.asked_price
      else coalesce(vli.unit_price, p.list_price)
    end,
    least(greatest(coalesce(w.discount_pct, 0), 0), 100),
    p.tax_rate
  from wanted w
  join public.products p on p.id = w.product_id and p.org_id = org and p.is_active
  left join public.van_load_items vli
    on vli.load_id = sale.load_id and vli.product_id = w.product_id;

  select count(distinct (e ->> 'product_id')) into wanted_lines
  from jsonb_array_elements(p_items) e;
  select count(*) into accepted from public.van_sale_items where sale_id = sale.id;

  -- A product that did not resolve is not silently dropped from a sale:
  -- a receipt that is missing a line the customer was charged for is
  -- worse than a refusal.
  if accepted = 0 then
    raise exception 'None of those products could be sold from your location';
  end if;
  if accepted < wanted_lines then
    raise exception 'One or more of those products is not available to you';
  end if;

  -- This function is SECURITY DEFINER, so the products policy that keeps
  -- a scoped manager inside their own categories does not apply to the
  -- insert above. Check it here, or selling would be a way around it.
  select i.product_id into blocked
  from public.van_sale_items i
  where i.sale_id = sale.id
    and not public.can_access_product(i.product_id)
  limit 1;

  if blocked is not null and not public.is_trusted_context() then
    raise exception 'You do not have access to one of those products'
      using errcode = '42501';
  end if;

  -- Stock check, against the location the sale is actually leaving from.
  -- The message names the product and the number, because "insufficient
  -- stock" tells a person standing in front of a customer nothing.
  if loc.kind = 'van' then
    select p.name as product_name, i.quantity as wanted,
           coalesce(vi.qty_on_hand, 0) as have
      into shortfall
    from public.van_sale_items i
    join public.products p on p.id = i.product_id
    left join public.van_inventory vi
      on vi.van_id = loc.van_id and vi.product_id = i.product_id
    where i.sale_id = sale.id
      and coalesce(vi.qty_on_hand, 0) < i.quantity
    limit 1;

    if shortfall.product_name is not null then
      raise exception 'Only % units of % are available in your van.',
        shortfall.have, shortfall.product_name;
    end if;
  else
    select p.name as product_name, i.quantity as wanted,
           coalesce(inv.qty_available, 0) as have
      into shortfall
    from public.van_sale_items i
    join public.products p on p.id = i.product_id
    left join public.inventory inv
      on inv.warehouse_id = loc.warehouse_id and inv.product_id = i.product_id
    where i.sale_id = sale.id
      and coalesce(inv.qty_available, 0) < i.quantity
    limit 1;

    if shortfall.product_name is not null then
      raise exception 'Only % units of % are available at your location.',
        shortfall.have, shortfall.product_name;
    end if;
  end if;

  -- Totals were maintained by the line trigger as the items went in.
  select * into sale from public.van_sales where id = sale.id;

  if p_sale_type = 'cash' then
    paid := coalesce(p_amount_paid, sale.total);
    if paid < sale.total then
      raise exception 'A cash sale must be paid in full: % due, % offered',
        sale.total, paid;
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = sale.id;
  else
    paid := coalesce(p_amount_paid, 0);
    terms := coalesce(customer.payment_terms_days, 30);

    select coalesce(sum(amount), 0) into owing
    from public.credit_transactions where customer_id = p_customer_id;

    if owing + (sale.total - paid) > customer.credit_limit then
      raise exception
        'Credit limit reached for this customer: % already owing, % on this sale, limit %',
        owing, sale.total - paid, customer.credit_limit;
    end if;

    update public.van_sales
    set amount_paid = paid,
        status = 'completed',
        due_date = current_date + terms,
        updated_at = now()
    where id = sale.id;

    if sale.total - paid > 0 then
      insert into public.credit_transactions
        (org_id, customer_id, type, amount, reference_type, reference_id,
         due_date, created_by, notes)
      values
        (org, p_customer_id, 'charge', sale.total - paid, 'van_sale', sale.id,
         current_date + terms, auth.uid(), 'Credit sale ' || sale.sale_number);
    end if;
  end if;

  -- The stock leaves the location it was sold from. A van sale reduces
  -- the van, not the warehouse the goods left days ago.
  insert into public.stock_movements
    (org_id, product_id, warehouse_id, van_id, type, quantity,
     reference_type, reference_id, created_by)
  select org, i.product_id, loc.warehouse_id, loc.van_id, 'issue', i.quantity,
         'van_sale', sale.id, auth.uid()
  from public.van_sale_items i
  where i.sale_id = sale.id;

  select * into sale from public.van_sales where id = sale.id;
  return sale;
end;
$$;

comment on function public.record_sale is
  'Records a complete sale atomically: header, lines, stock check, '
  'payment or credit, and the ledger movements that take the goods out '
  'of the seller''s own location.';

-- ===================================================================
-- 8. complete_van_sale follows the rename
--
-- The body referred to sale.driver_id, and a function body is stored as
-- text: it would only fail when someone called it. Redefined here, with
-- the driver refused rather than privileged.
-- ===================================================================

create or replace function public.complete_van_sale(
  p_sale_id uuid,
  p_amount_paid numeric default null
)
returns public.van_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.van_sales;
  item record;
  on_hand integer;
  owing numeric(14,2);
  limit_amount numeric(14,2);
  terms integer;
begin
  if not public.is_trusted_context() and auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if public.has_role('driver') then
    raise exception 'A driver cannot complete a sale' using errcode = '42501';
  end if;

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- The salesperson who raised it, or someone who manages them.
  if not public.is_trusted_context()
     and sale.salesperson_id <> auth.uid()
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the salesperson who raised this sale or a manager may complete it'
      using errcode = '42501';
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  -- The goods must be where the sale says they are leaving from.
  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    if sale.van_id is not null then
      select coalesce(qty_on_hand, 0) into on_hand
      from public.van_inventory
      where van_id = sale.van_id and product_id = item.product_id;
    else
      select coalesce(qty_available, 0) into on_hand
      from public.inventory
      where warehouse_id = sale.warehouse_id and product_id = item.product_id;
    end if;

    if coalesce(on_hand, 0) < item.quantity then
      raise exception 'Only % units of product % are available where you are selling from',
        coalesce(on_hand, 0), item.product_id;
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

  insert into public.stock_movements
    (org_id, product_id, warehouse_id, van_id, type, quantity,
     reference_type, reference_id, created_by)
  select sale.org_id, item2.product_id, sale.warehouse_id, sale.van_id,
         'issue', item2.quantity, 'van_sale', sale.id, auth.uid()
  from public.van_sale_items item2
  where item2.sale_id = p_sale_id;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$$;

-- ===================================================================
-- 9. Row level security
--
-- Drivers lose the ability to create or edit a sale. They keep, and
-- gain, the ability to SEE the sales made from their van, because a
-- driver who cannot see what left the van cannot answer for it.
-- ===================================================================

drop policy van_sales_driver_insert on public.van_sales;
drop policy van_sales_driver_update on public.van_sales;
drop policy van_sales_read on public.van_sales;

create policy van_sales_read on public.van_sales
  for select using (
    org_id = public.auth_org_id()
    and (
      salesperson_id = auth.uid()
      -- Anyone crewed on the van, which is how the driver sees the sales
      -- their salesperson made from their stock.
      or (van_id is not null and van_id = public.my_van_id())
      or public.has_role('admin', 'senior_manager', 'manager', 'accountant')
    )
  );

-- A salesperson may raise a sale only against the location the database
-- says they sell from. record_sale() is the supported route; this policy
-- means a direct Data API call cannot do more than the function allows.
create policy van_sales_salesperson_insert on public.van_sales
  for insert with check (
    org_id = public.auth_org_id()
    and public.has_role('sales_rep')
    and salesperson_id = auth.uid()
    and (
      (van_id is not null and van_id = public.my_sales_van_id())
      or (warehouse_id is not null and warehouse_id = public.my_sales_warehouse_id())
    )
  );

create policy van_sales_salesperson_update on public.van_sales
  for update using (
    org_id = public.auth_org_id()
    and public.has_role('sales_rep')
    and salesperson_id = auth.uid()
    and status = 'draft'
  )
  with check (
    org_id = public.auth_org_id()
    and salesperson_id = auth.uid()
  );

drop policy van_sale_items_write on public.van_sale_items;
create policy van_sale_items_write on public.van_sale_items
  for all using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
      where s.id = sale_id
        and (public.has_role('admin', 'senior_manager', 'manager')
             or (s.salesperson_id = auth.uid() and s.status = 'draft'))
    )
  )
  with check (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
      where s.id = sale_id
        and (public.has_role('admin', 'senior_manager', 'manager')
             or (s.salesperson_id = auth.uid() and s.status = 'draft'))
    )
  );

-- Crew, not just drivers, may read their own assignment.
drop policy van_assignments_read on public.van_assignments;
create policy van_assignments_read on public.van_assignments
  for select using (
    org_id = public.auth_org_id()
    and (member_id = auth.uid()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse'))
  );

-- Crew may read each other's names. Without this the driver's screen can
-- show that five units left the van but not who sold them, which is the
-- one thing they need in order to ask about it.
create or replace function public.shares_van_with(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.van_assignments mine
    join public.van_assignments theirs on theirs.van_id = mine.van_id
    where mine.member_id = auth.uid() and mine.unassigned_at is null
      and theirs.member_id = target and theirs.unassigned_at is null
  )
$$;

create policy profiles_read_crewmate on public.profiles
  for select using (
    org_id = public.auth_org_id()
    and public.shares_van_with(id)
  );

-- A salesperson sees the stock on the van they sell from, and nothing
-- from any other van. Warehouse stock stays invisible to both seats.
drop policy van_inventory_read on public.van_inventory;
create policy van_inventory_read on public.van_inventory
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant')
      or van_id = public.my_van_id()
    )
  );

drop policy vans_read on public.vans;
create policy vans_read on public.vans
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant')
      or id = public.my_van_id()
    )
  );

-- The van's crew may read the load it is working from: the driver signed
-- for it, and the salesperson sells at the prices it fixed.
drop policy van_loads_read on public.van_loads;
create policy van_loads_read on public.van_loads
  for select using (
    org_id = public.auth_org_id()
    and (driver_id = auth.uid()
         or van_id = public.my_van_id()
         or public.has_role('admin', 'senior_manager', 'manager', 'warehouse', 'accountant'))
  );

-- ===================================================================
-- 10. Read models
-- ===================================================================

-- Every sale line with the names a receipt and a sales list need, so
-- neither has to embed four relationships to render a row.
create view public.sale_lines
with (security_invoker = on) as
  select
    vs.org_id,
    vs.id            as sale_id,
    vs.sale_number,
    vs.sale_type,
    vs.status,
    vs.sold_at,
    vs.van_id,
    vs.warehouse_id,
    vs.salesperson_id,
    sp.full_name     as salesperson_name,
    vs.customer_id,
    c.name           as customer_name,
    vs.total         as sale_total,
    vs.amount_paid,
    vs.balance,
    vsi.id           as line_id,
    vsi.product_id,
    p.sku,
    p.name           as product_name,
    p.unit_of_measure,
    vsi.quantity,
    vsi.unit_price,
    vsi.discount_pct,
    vsi.tax_rate,
    vsi.line_subtotal,
    vsi.line_total
  from public.van_sales vs
  join public.van_sale_items vsi on vsi.sale_id = vs.id
  join public.products p         on p.id = vsi.product_id
  join public.customers c        on c.id = vs.customer_id
  -- Left, deliberately: a reader who may see the sale but not the
  -- seller's profile should still see the sale, without their name.
  left join public.profiles sp   on sp.id = vs.salesperson_id;

-- What happened to a van's stock today: what it started with, what the
-- salesperson sold, what is still on board. This is the driver's view of
-- their own van, and it updates the moment a sale completes.
create view public.van_day_activity
with (security_invoker = on) as
  select
    vi.org_id,
    vi.van_id,
    v.code            as van_code,
    vi.product_id,
    p.sku,
    p.name            as product_name,
    p.unit_of_measure,
    -- What was on board before today's selling started. Not "at
    -- midnight": the van is usually loaded in the morning, and the
    -- number the driver signed for is the one they answer for.
    vi.qty_on_hand + coalesce(s.sold_today, 0) as qty_before_sales,
    coalesce(s.sold_today, 0)                  as qty_sold_today,
    vi.qty_on_hand                             as qty_remaining,
    p.cost_price,
    vi.qty_on_hand * p.cost_price              as stock_value
  from public.van_inventory vi
  join public.vans v     on v.id = vi.van_id
  join public.products p on p.id = vi.product_id
  left join (
    select vs.van_id, vsi.product_id, sum(vsi.quantity) as sold_today
    from public.van_sales vs
    join public.van_sale_items vsi on vsi.sale_id = vs.id
    where vs.status = 'completed'
      and vs.van_id is not null
      and vs.sold_at >= date_trunc('day', now())
    group by vs.van_id, vsi.product_id
  ) s on s.van_id = vi.van_id and s.product_id = vi.product_id;

-- Stock per product per warehouse, named. stock_summary totals across
-- locations, which is the wrong number when the question is "how much is
-- in THIS warehouse" - the one a stock count or an adjustment asks.
create view public.product_stock_by_location
with (security_invoker = on) as
  select
    i.org_id,
    i.product_id,
    p.sku,
    p.name          as product_name,
    p.unit_of_measure,
    p.category_id,
    p.reorder_point,
    p.cost_price,
    p.list_price,
    i.warehouse_id,
    w.code          as warehouse_code,
    w.name          as warehouse_name,
    i.qty_on_hand,
    i.qty_reserved,
    i.qty_available,
    i.updated_at
  from public.inventory i
  join public.products p   on p.id = i.product_id
  join public.warehouses w on w.id = i.warehouse_id;

-- ===================================================================
-- 11. Data API grants
--
-- 0015 set default privileges for new tables and functions, but
-- PostgreSQL still grants EXECUTE on a new function to PUBLIC, which
-- includes anon. Withdraw it, exactly as 0015 does.
-- ===================================================================

grant select on public.sale_lines, public.van_day_activity,
                public.product_stock_by_location to authenticated;
grant all on public.sale_lines, public.van_day_activity,
             public.product_stock_by_location to service_role;

do $grants$
declare
  fn text;
begin
  foreach fn in array array[
    'public.movement_direction(public.movement_type)',
    'public.my_van_id()',
    'public.my_driver_van_id()',
    'public.my_sales_van_id()',
    'public.my_sales_warehouse_id()',
    'public.shares_van_with(uuid)',
    'public.can_access_product(uuid)',
    'public.guard_role_change()',
    'public.fill_van_sale_org()',
    'public.create_product_with_stock(text, text, uuid, integer, uuid, uuid, text, integer, numeric, numeric, numeric, integer, integer, text, text)',
    'public.add_stock(uuid, uuid, integer, text)',
    'public.adjust_stock_to(uuid, uuid, integer, text)',
    'public.record_stocktake(uuid, jsonb, text)',
    'public.resolve_sales_location(uuid)',
    'public.record_sale(uuid, jsonb, public.van_sale_type, numeric, uuid, text)',
    'public.complete_van_sale(uuid, numeric)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$grants$;
