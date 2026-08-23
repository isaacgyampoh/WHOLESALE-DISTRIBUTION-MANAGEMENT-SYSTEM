-- ====================================================================
-- UPGRADE 0033 - a van has a crew
-- ====================================================================
--
-- For a database installed before migration 0033.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0033_van_crew.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT CHANGES
--
-- The schema assumed the driver was the salesperson. Every van record
-- was keyed on driver_id, and the driver role could sell. That put the
-- wrong name on every receipt and handed the till to whoever was behind
-- the wheel.
--
-- A van now has a crew: one driver, and one or more people who sell
-- from it.
--
--   van_assignments.driver_id becomes member_id, with a crew_role
--   my_van_id()               resolves for any crew member
--   is_van_salesperson()      the predicate that gates selling
--   van_sales.salesperson_id  who sold it, beside who drove
--   van_load_crew             who went out with a load, snapshotted
--   salesperson_performance   sales attributed to whoever made them
--
-- A van with nobody crewed to sell can no longer be dispatched: the
-- goods would leave the warehouse with no way to record what happened
-- to them.
--
-- EXISTING DATA IS PRESERVED. Every assignment becomes a driver
-- assignment, which is what it was. Every existing sale is backfilled
-- with the driver as the salesperson, because on those rounds that
-- person genuinely was both.
--
-- THE POLICIES FROM 0013 ARE DROPPED AND REPLACED, not added to. Row
-- level security policies are permissive and OR together, so leaving
-- the old driver rules in place would mean a driver could still open a
-- sale however the new rules were written.
--
-- RUN UPGRADE_0032_SALESPERSON_ROLE.sql FIRST, on its own. This script
-- needs the salesperson role to already exist.
--
-- AFTER RUNNING IT, redeploy, then crew your vans: Vans, open one, and
-- assign a driver and at least one salesperson. Until a van has a
-- salesperson it cannot be dispatched.

do $enum$
declare
  found text[];
  wanted text[] := array['driver', 'salesperson'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'crew_role'
  ) then
    create type public.crew_role as enum ('driver', 'salesperson');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'crew_role';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.crew_role already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


-- The `salesperson` role itself is added by migration 0032, on its own,
-- because PostgreSQL will not let a new enum label be used in the
-- transaction that created it - and the policies below use it.

-- ------------------------------------------------------------------
-- van_assignments becomes a crew list
-- ------------------------------------------------------------------
-- Guarded: a rename is not idempotent, and this script has to survive
-- being run twice - which is exactly what somebody does when they are
-- not sure whether it took the first time.
do $rename_member$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'van_assignments'
       and column_name = 'driver_id'
  ) then
    alter table public.van_assignments rename column driver_id to member_id;
  end if;
end
$rename_member$;

alter table public.van_assignments
  add column if not exists crew_role public.crew_role;

-- Everything already there was a driver assignment, because that is the
-- only thing the table could hold.
update public.van_assignments set crew_role = 'driver' where crew_role is null;

alter table public.van_assignments
  alter column crew_role set not null,
  alter column crew_role set default 'salesperson';

comment on column public.van_assignments.member_id is
  'The crew member. Was driver_id, when a van could only have a driver.';
comment on column public.van_assignments.crew_role is
  'What they do on this van. Defaults to salesperson: a van takes one '
  'driver and any number of people selling from it, so the common case '
  'is the one that needs no thought.';

-- One driver per van, rather than one crew member per van.
drop index if exists public.van_assignments_one_active_van;
create unique index if not exists van_assignments_one_active_driver_per_van
  on public.van_assignments (van_id)
  where unassigned_at is null and crew_role = 'driver';

-- A person is on one van at a time, whichever job they do. Somebody
-- selling from two vans at once is a mistake, not a configuration.
drop index if exists public.van_assignments_one_active_driver;
create unique index if not exists van_assignments_one_active_van_per_member
  on public.van_assignments (member_id) where unassigned_at is null;

drop index if exists public.van_assignments_driver_idx;
create index if not exists van_assignments_member_idx
  on public.van_assignments (member_id);
create index if not exists van_assignments_van_crew_idx
  on public.van_assignments (van_id, crew_role) where unassigned_at is null;

-- ------------------------------------------------------------------
-- Who may be crewed
-- ------------------------------------------------------------------
create or replace function public.check_crew_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member public.profiles;
  van    public.vans;
begin
  select * into member from public.profiles where id = new.member_id;
  if not found then
    raise exception 'That person does not exist';
  end if;

  if not member.is_active then
    raise exception 'Cannot crew %: their account is not active', member.full_name;
  end if;

  select * into van from public.vans where id = new.van_id;
  if van.org_id is distinct from member.org_id then
    raise exception 'That person belongs to a different organization';
  end if;

  -- The job on the van has to match what the person is employed to do.
  -- A driver crewed as a salesperson would be handed the till.
  if new.crew_role = 'driver' and member.role not in ('driver', 'admin', 'senior_manager', 'manager') then
    raise exception 'Only a driver can be crewed to drive. % is a %', member.full_name, member.role;
  end if;

  if new.crew_role = 'salesperson'
     and member.role not in ('salesperson', 'sales_rep', 'admin', 'senior_manager', 'manager') then
    raise exception 'Only a salesperson can be crewed to sell. % is a %', member.full_name, member.role;
  end if;

  return new;
end;
$$;

drop trigger if exists van_assignments_check_member on public.van_assignments;drop trigger if exists van_assignments_check_member on public.van_assignments;
create trigger van_assignments_check_member
  before insert or update on public.van_assignments
  for each row execute function public.check_crew_member();


-- ------------------------------------------------------------------
-- The van a person is on, whatever they do on it
-- ------------------------------------------------------------------
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
  'The van the caller is crewed on. Any crew member, not only the '
  'driver: a salesperson needs the van stock to sell from it.';

-- Whether the caller is on this van's crew. The predicate every field
-- policy is written against, so "may this person touch this van" is
-- decided in one place rather than twenty.
create or replace function public.is_van_crew(p_van_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.van_assignments
     where van_id = p_van_id
       and member_id = auth.uid()
       and unassigned_at is null
  )
$$;

revoke all on function public.is_van_crew(uuid) from public, anon;
grant execute on function public.is_van_crew(uuid) to authenticated, service_role;

-- Crewed specifically to sell.
--
-- Being aboard is not the same as being allowed to take money. The
-- fill-in trigger below stamps a sale with whoever recorded it, so a
-- policy that only asked "are you the salesperson on this row" would be
-- satisfied by anybody who inserted one - including the driver. This is
-- the predicate that actually gates selling.
create or replace function public.is_van_salesperson(p_van_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.van_assignments
     where van_id = p_van_id
       and member_id = auth.uid()
       and crew_role = 'salesperson'
       and unassigned_at is null
  )
$$;

revoke all on function public.is_van_salesperson(uuid) from public, anon;
grant execute on function public.is_van_salesperson(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Who is on a van right now
-- ------------------------------------------------------------------
create or replace view public.van_crew
with (security_invoker = on) as
  select
    a.org_id,
    a.van_id,
    v.code        as van_code,
    v.registration_no,
    a.member_id,
    p.full_name   as member_name,
    p.phone       as member_phone,
    a.crew_role,
    a.assigned_at,
    a.assigned_by
  from public.van_assignments a
  join public.vans v on v.id = a.van_id
  join public.profiles p on p.id = a.member_id
  where a.unassigned_at is null;

comment on view public.van_crew is
  'The crew currently on each van. One driver, and whoever is selling.';

-- ------------------------------------------------------------------
-- A sale records who sold it and who drove
-- ------------------------------------------------------------------
alter table public.van_sales
  add column if not exists salesperson_id uuid references public.profiles(id) on delete restrict;

-- Every sale so far was made by the person driving, because the schema
-- had nobody else to attribute it to. That is what happened, so it is
-- what gets recorded.
update public.van_sales set salesperson_id = driver_id where salesperson_id is null;

alter table public.van_sales
  alter column salesperson_id set not null;

create index if not exists van_sales_salesperson_idx
  on public.van_sales (salesperson_id, sold_at desc);

comment on column public.van_sales.salesperson_id is
  'Who made the sale. Distinct from driver_id, which is who drove the '
  'van: they are different jobs and usually different people.';
comment on column public.van_sales.driver_id is
  'Who drove the van this was sold from. Not who sold it.';

-- The same on a return, so a shortage is attributable.
alter table public.van_returns
  add column if not exists salesperson_id uuid references public.profiles(id) on delete set null;

-- ------------------------------------------------------------------
-- Filling in the crew a caller did not have to think about
-- ------------------------------------------------------------------
create or replace function public.fill_sale_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
begin
  -- The salesperson is whoever is recording the sale, unless the office
  -- is entering it on their behalf and has said who for.
  if new.salesperson_id is null then
    new.salesperson_id := auth.uid();
  end if;

  -- The driver comes from the load. Asking a salesperson who drove them
  -- today would be a question with one possible answer.
  if new.driver_id is null then
    select * into load from public.van_loads where id = new.load_id;
    new.driver_id := load.driver_id;
  end if;

  return new;
end;
$$;

drop trigger if exists van_sales_fill_crew on public.van_sales;drop trigger if exists van_sales_fill_crew on public.van_sales;
create trigger van_sales_fill_crew
  before insert on public.van_sales
  for each row execute function public.fill_sale_crew();


-- driver_id can now be derived, so it no longer has to be supplied.
alter table public.van_sales alter column driver_id drop not null;

-- ------------------------------------------------------------------
-- The crew that went out with a load
-- ------------------------------------------------------------------
--
-- Snapshotted at dispatch rather than read live, because a waybill has
-- to say who took the goods out on the day - not who is on the van
-- three weeks later when somebody prints it again.
create table if not exists public.van_load_crew (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  load_id    uuid not null references public.van_loads(id) on delete cascade,
  member_id  uuid not null references public.profiles(id) on delete restrict,
  crew_role  public.crew_role not null,
  created_at timestamptz not null default now(),

  unique (load_id, member_id)
);

create index if not exists van_load_crew_load_idx on public.van_load_crew (load_id);

comment on table public.van_load_crew is
  'Who went out with this load. A snapshot, so the waybill still names '
  'the right people after the crew changes.';

alter table public.van_load_crew enable row level security;

drop policy if exists van_load_crew_read on public.van_load_crew;drop policy if exists van_load_crew_read on public.van_load_crew;
create policy van_load_crew_read on public.van_load_crew
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
      or member_id = auth.uid()
      or exists (select 1 from public.van_loads l
                  where l.id = van_load_crew.load_id and public.is_van_crew(l.van_id))
    )
  );


drop policy if exists van_load_crew_write on public.van_load_crew;drop policy if exists van_load_crew_write on public.van_load_crew;
create policy van_load_crew_write on public.van_load_crew
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );


grant select on public.van_load_crew to authenticated;
grant all on public.van_load_crew to service_role;

-- Dispatch records the crew as it stands at that moment.
create or replace function public.snapshot_load_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'dispatched' and old.status is distinct from 'dispatched' then
    insert into public.van_load_crew (org_id, load_id, member_id, crew_role)
    select new.org_id, new.id, a.member_id, a.crew_role
      from public.van_assignments a
     where a.van_id = new.van_id and a.unassigned_at is null
    on conflict (load_id, member_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists van_loads_snapshot_crew on public.van_loads;drop trigger if exists van_loads_snapshot_crew on public.van_loads;
create trigger van_loads_snapshot_crew
  after update on public.van_loads
  for each row execute function public.snapshot_load_crew();


-- ------------------------------------------------------------------
-- A van does not go out without a crew
-- ------------------------------------------------------------------
create or replace function public.dispatch_van_load(p_load_id uuid)
returns public.van_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  item record;
  available integer;
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

  if load.driver_confirmed_at is null then
    raise exception 'Load % has not been confirmed by the driver', load.load_number;
  end if;

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
    select coalesce(qty_available, 0) into available
    from public.inventory
    where product_id = item.product_id and warehouse_id = load.warehouse_id;

    if coalesce(available, 0) < item.qty_loaded then
      raise exception 'Insufficient stock for product %: % available, % requested',
        item.product_id, coalesce(available, 0), item.qty_loaded;
    end if;

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.warehouse_id, 'transfer_out',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.van_id, 'transfer_in',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    perform public.consume_batches(item.product_id, load.warehouse_id, item.qty_loaded);
  end loop;

  update public.van_loads
     set status = 'dispatched', dispatched_at = now(), updated_at = now()
   where id = p_load_id
  returning * into load;

  return load;
end;
$$;

-- ------------------------------------------------------------------
-- Completing a sale is the salesperson's job
-- ------------------------------------------------------------------
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
  on_van integer;
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

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  for item in select * from public.van_sale_items where sale_id = p_sale_id loop
    select coalesce(qty_on_hand, 0) into on_van
    from public.van_inventory
    where van_id = sale.van_id and product_id = item.product_id;

    if coalesce(on_van, 0) < item.quantity then
      raise exception 'Van does not carry enough of product %: % on board, % sold',
        item.product_id, coalesce(on_van, 0), item.quantity;
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
      (org_id, product_id, van_id, type, quantity,
       reference_type, reference_id, created_by)
    values
      (sale.org_id, item.product_id, sale.van_id, 'issue', item.quantity,
       'van_sale', sale.id, auth.uid());
  end loop;

  select * into sale from public.van_sales where id = p_sale_id;
  return sale;
end;
$$;

-- ------------------------------------------------------------------
-- Field policies follow the crew, not the driver
-- ------------------------------------------------------------------
--
-- The policies from 0013 are dropped rather than added to. Row level
-- security policies are permissive and OR together, so leaving
-- `van_sales_driver_insert` in place beside a new rule would mean the
-- old one still let a driver open a sale - the new rule could only ever
-- widen access, never narrow it.
--
-- That is the trap this migration walked into first time round, and it
-- is worth stating plainly: to take something away you have to remove
-- the policy that grants it.

-- ---- sales -------------------------------------------------------
drop policy if exists van_sales_read on public.van_sales;
drop policy if exists van_sales_select on public.van_sales;
drop policy if exists van_sales_driver_insert on public.van_sales;
drop policy if exists van_sales_insert on public.van_sales;
drop policy if exists van_sales_driver_update on public.van_sales;
drop policy if exists van_sales_update on public.van_sales;drop policy if exists van_sales_select on public.van_sales;
create policy van_sales_select on public.van_sales
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse', 'sales_rep')
         or salesperson_id = auth.uid()
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_sales_insert on public.van_sales;
create policy van_sales_insert on public.van_sales
  for insert with check (
    org_id = public.auth_org_id()
    -- Crewed to sell, not merely aboard. A driver is on the van too,
    -- and the trigger that fills in salesperson_id would otherwise let
    -- them stamp a sale with their own name and satisfy the check below.
    and public.is_van_salesperson(van_id)
    -- And recorded by whoever made it. Recording one in somebody else's
    -- name is how a shortage gets moved onto a colleague.
    and salesperson_id = auth.uid()
  );
drop policy if exists van_sales_update on public.van_sales;
create policy van_sales_update on public.van_sales
  for update using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager')
         or (salesperson_id = auth.uid() and status = 'draft'))
  );


-- ---- sale lines --------------------------------------------------
drop policy if exists van_sale_items_read on public.van_sale_items;
drop policy if exists van_sale_items_select on public.van_sale_items;
drop policy if exists van_sale_items_write on public.van_sale_items;drop policy if exists van_sale_items_select on public.van_sale_items;
create policy van_sale_items_select on public.van_sale_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s where s.id = van_sale_items.sale_id)
  );
drop policy if exists van_sale_items_write on public.van_sale_items;
create policy van_sale_items_write on public.van_sale_items
  for all using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s
                 where s.id = van_sale_items.sale_id
                   and (public.has_role('admin', 'senior_manager', 'manager')
                        or (s.salesperson_id = auth.uid() and s.status = 'draft')))
  ) with check (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_sales s
                 where s.id = van_sale_items.sale_id
                   and (public.has_role('admin', 'senior_manager', 'manager')
                        or (s.salesperson_id = auth.uid() and s.status = 'draft')))
  );


-- ---- returns -----------------------------------------------------
--
-- Either crew member may bring goods back: the driver has the vehicle
-- and the salesperson knows what went out.
drop policy if exists van_returns_read on public.van_returns;
drop policy if exists van_returns_select on public.van_returns;
drop policy if exists van_returns_driver on public.van_returns;
drop policy if exists van_returns_driver_update on public.van_returns;drop policy if exists van_returns_select on public.van_returns;
create policy van_returns_select on public.van_returns
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
         or driver_id = auth.uid()
         or salesperson_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_returns_crew_insert on public.van_returns;
create policy van_returns_crew_insert on public.van_returns
  for insert with check (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
  );
drop policy if exists van_returns_crew_update on public.van_returns;
create policy van_returns_crew_update on public.van_returns
  for update using (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
    -- Once submitted it is the warehouse's to approve, not the crew's
    -- to keep editing.
    and status = 'draft'
  );


drop policy if exists van_return_items_read on public.van_return_items;
drop policy if exists van_return_items_write on public.van_return_items;drop policy if exists van_return_items_read on public.van_return_items;
create policy van_return_items_read on public.van_return_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r where r.id = van_return_items.return_id)
  );
drop policy if exists van_return_items_write on public.van_return_items;
create policy van_return_items_write on public.van_return_items
  for all using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r
                 where r.id = van_return_items.return_id
                   and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
                        or (public.is_van_crew(r.van_id) and r.status = 'draft')))
  ) with check (
    org_id = public.auth_org_id()
    and exists (select 1 from public.van_returns r
                 where r.id = van_return_items.return_id
                   and (public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
                        or (public.is_van_crew(r.van_id) and r.status = 'draft')))
  );


-- ---- end of day --------------------------------------------------
drop policy if exists van_reconciliations_read on public.van_reconciliations;
drop policy if exists van_reconciliations_select on public.van_reconciliations;
drop policy if exists van_reconciliations_driver on public.van_reconciliations;drop policy if exists van_reconciliations_select on public.van_reconciliations;
create policy van_reconciliations_select on public.van_reconciliations
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant')
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_reconciliations_crew_update on public.van_reconciliations;
-- Submitting is the crew's; approving is emphatically not, and the
-- table's own constraint refuses an approver who is the driver.
create policy van_reconciliations_crew_update on public.van_reconciliations
  for update using (
    org_id = public.auth_org_id()
    and public.is_van_crew(van_id)
    and status in ('draft', 'submitted')
  );


-- ---- loads -------------------------------------------------------
drop policy if exists van_loads_read on public.van_loads;
drop policy if exists van_loads_driver_confirm on public.van_loads;drop policy if exists van_loads_read on public.van_loads;
create policy van_loads_read on public.van_loads
  for select using (
    org_id = public.auth_org_id()
    and (public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
         or driver_id = auth.uid()
         or public.is_van_crew(van_id))
  );
drop policy if exists van_loads_driver_confirm on public.van_loads;
-- The driver signs for the goods. Not the salesperson: the vehicle and
-- what is on it are the driver's responsibility.
create policy van_loads_driver_confirm on public.van_loads
  for update using (
    org_id = public.auth_org_id()
    and driver_id = auth.uid()
    and status in ('draft', 'loaded')
  );


-- ---- customers ---------------------------------------------------
--
-- A salesperson meets new customers at the roadside and has to be able
-- to record one before selling to them. A driver does not: they are not
-- the one opening an account.
drop policy if exists customers_write on public.customers;drop policy if exists customers_write on public.customers;
create policy customers_write on public.customers
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'salesperson')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'sales_rep', 'salesperson')
  );


-- ------------------------------------------------------------------
-- What a round took, by whom
-- ------------------------------------------------------------------
create or replace view public.salesperson_performance
with (security_invoker = on) as
  select
    s.org_id,
    s.salesperson_id,
    p.full_name as salesperson_name,
    count(*)                                                      as sale_count,
    coalesce(sum(s.total), 0)                                     as revenue,
    coalesce(sum(s.total) filter (where s.sale_type = 'cash'), 0)  as cash_sales,
    coalesce(sum(s.total) filter (where s.sale_type = 'credit'), 0) as credit_sales,
    coalesce(sum(s.balance), 0)                                   as outstanding,
    max(s.sold_at)                                                as last_sale_at
  from public.van_sales s
  join public.profiles p on p.id = s.salesperson_id
  where s.status = 'completed'
  group by s.org_id, s.salesperson_id, p.full_name;

comment on view public.salesperson_performance is
  'What each salesperson has sold. Attributed to whoever made the sale, '
  'not to whoever was driving.';

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'crew_role enum' as check,
       case when exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                          where n.nspname = 'public' and t.typname = 'crew_role')
            then 'PASS' else 'FAIL' end as result
union all
select 'salesperson is a role',
       case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                          where t.typname = 'user_role' and e.enumlabel = 'salesperson')
            then 'PASS' else 'FAIL' end
union all
select 'assignments carry a crew member and a job',
       case when (select count(*) from information_schema.columns
                   where table_name = 'van_assignments'
                     and column_name in ('member_id','crew_role')) = 2
            then 'PASS' else 'FAIL' end
union all
select 'one driver per van, many salespeople',
       case when exists (select 1 from pg_indexes
                          where indexname = 'van_assignments_one_active_driver_per_van')
            then 'PASS' else 'FAIL' end
union all
select 'a sale records who sold it',
       case when exists (select 1 from information_schema.columns
                          where table_name = 'van_sales' and column_name = 'salesperson_id')
            then 'PASS' else 'FAIL' end
union all
select 'no sale left unattributed',
       case when not exists (select 1 from public.van_sales where salesperson_id is null)
            then 'PASS' else 'FAIL' end
union all
select 'selling is gated on being crewed to sell',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'is_van_salesperson')
            then 'PASS' else 'FAIL' end
union all
select 'the old driver-insert policy is gone',
       case when not exists (select 1 from pg_policies
                              where tablename = 'van_sales'
                                and policyname = 'van_sales_driver_insert')
            then 'PASS' else 'FAIL' end
union all
select 'load crew is snapshotted',
       case when to_regclass('public.van_load_crew') is not null
            then 'PASS' else 'FAIL' end;
