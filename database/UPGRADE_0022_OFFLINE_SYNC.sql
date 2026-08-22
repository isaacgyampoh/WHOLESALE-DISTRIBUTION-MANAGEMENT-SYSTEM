-- ====================================================================
-- UPGRADE 0022 - offline operation and synchronisation
-- ====================================================================
--
-- For a database installed before migration 0022.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0022_offline_sync.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT ADDS
--
--   sync_operations   one row per offline mutation, keyed by a uuid the
--                     device generates before queueing. That key is the
--                     primary key, so a retried upload cannot apply the
--                     same sale twice.
--   sync_submit()     the single entry point for a queued operation.
--                     Re-derives authorization from the calling session
--                     and never from the payload.
--   sync_bootstrap()  the snapshot a phone caches so it can keep
--                     selling with no signal.
--
-- The driver PWA does not work without this. Everything else in the
-- application does.

do $enum$
declare
  found text[];
  wanted text[] := array['applied', 'failed', 'conflict'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_status'
  ) then
    create type public.sync_status as enum ('applied', 'failed', 'conflict');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_status';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.sync_status already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;
do $enum$
declare
  found text[];
  wanted text[] := array['van_sale', 'collection', 'van_return', 'reconciliation'];
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_operation'
  ) then
    create type public.sync_operation as enum ('van_sale', 'collection', 'van_return', 'reconciliation');
  else
    select array_agg(e.enumlabel order by e.enumsortorder) into found
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'sync_operation';

    -- Already correct: nothing to do, and the script carries on.
    if found is distinct from wanted then
      raise exception
        'public.sync_operation already exists with different values. Found %, expected %. '
        'Reconcile it before running this script; this script will not alter an '
        'enum other code may already depend on.',
        found, wanted;
    end if;
  end if;
end $enum$;


create table if not exists public.sync_operations (
  -- Generated on the device. This is what makes a retry safe.
  id            uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  device_id     text not null,
  operation     public.sync_operation not null,
  payload       jsonb not null,
  status        public.sync_status not null,
  result        jsonb,
  error         text,
  attempts      integer not null default 1,
  -- When the driver performed it, as the device saw it. Kept apart
  -- from received_at: the gap between them is how long the round was
  -- offline, and it is the first thing anyone investigating a
  -- discrepancy wants to see.
  occurred_at   timestamptz not null,
  received_at   timestamptz not null default now(),
  constraint sync_operations_device_not_blank check (length(trim(device_id)) > 0),
  constraint sync_operations_attempts_sane check (attempts between 1 and 1000)
);


comment on table public.sync_operations is
  'One row per offline mutation, keyed by a client-generated uuid so a '
  'retried upload cannot apply the same work twice. Never holds a '
  'credential.';
comment on column public.sync_operations.id is
  'Idempotency key, generated on the device before queueing.';

create index if not exists sync_operations_org_time on public.sync_operations (org_id, received_at desc);

create index if not exists sync_operations_profile on public.sync_operations (profile_id, received_at desc);

create index if not exists sync_operations_status on public.sync_operations (org_id, status, received_at desc);


alter table public.sync_operations enable row level security;drop policy if exists sync_operations_select on public.sync_operations;
-- A person sees their own sync history. A supervisor sees the
-- organization's, because a failed sale that never arrived is an
-- operational problem, not a private one.
create policy sync_operations_select on public.sync_operations
  for select using (
    org_id = public.auth_org_id()
    and (
      profile_id = auth.uid()
      or public.has_role('admin', 'senior_manager', 'manager', 'accountant')
    )
  );


-- Nothing writes here through the Data API. Rows are written by
-- sync_submit(), which is SECURITY DEFINER and re-checks authorization.
revoke all on public.sync_operations from anon, authenticated;
grant select on public.sync_operations to authenticated;
grant all on public.sync_operations to service_role;

-- History of what a device did is not editable, for the same reason the
-- audit trail is not.
create or replace function public.block_sync_mutation()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_context() then
    return case tg_op when 'DELETE' then old else new end;
  end if;
  raise exception 'sync history cannot be altered'
    using errcode = '42501';
end;
$$;drop trigger if exists sync_operations_no_edit on public.sync_operations;
create trigger sync_operations_no_edit
  before update or delete on public.sync_operations
  for each row execute function public.block_sync_mutation();


-- ------------------------------------------------------------------
-- Applying a queued operation
-- ------------------------------------------------------------------
--
-- One entry point for every offline mutation. It is deliberately the
-- only way a queued operation reaches the business functions, so the
-- idempotency check cannot be skipped by calling the underlying
-- function directly from the client.
create or replace function public.sync_submit(
  p_id           uuid,
  p_device_id    text,
  p_operation    public.sync_operation,
  p_payload      jsonb,
  p_occurred_at  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing   public.sync_operations;
  actor      uuid := auth.uid();
  org        uuid;
  outcome    jsonb;
  line       jsonb;
  sale       public.van_sales;
  ret        public.van_returns;
  recon      public.van_reconciliations;
  load_row   public.van_loads;
  v_customer uuid;
  v_van      uuid;
  v_avail    integer;
begin
  -- Authorization is re-derived here, from the session doing the
  -- syncing. Anything the payload says about who the driver is or what
  -- they may do is ignored.
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  if org is null then
    raise exception 'No profile for the calling user' using errcode = '42501';
  end if;

  -- Already seen? Hand back exactly what happened the first time. This
  -- is the whole point: a retry is free and cannot double-apply.
  select * into existing from public.sync_operations where id = p_id;
  if found then
    -- A key belonging to somebody else is not a replay, it is a
    -- collision or an attack. Say nothing about the original.
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
          select qty_on_hand into v_avail from public.van_inventory
           where van_id = v_van and product_id = (line ->> 'product_id')::uuid;

          if coalesce(v_avail, 0) < (line ->> 'quantity')::integer then
            raise exception 'Only % of that product on the van, % were sold',
              coalesce(v_avail, 0), (line ->> 'quantity')::integer;
          end if;

          insert into public.van_sale_items (
            org_id, sale_id, product_id, quantity, unit_price, discount_pct, tax_rate
          ) values (
            org, sale.id, (line ->> 'product_id')::uuid,
            (line ->> 'quantity')::integer,
            (line ->> 'unit_price')::numeric,
            coalesce((line ->> 'discount_pct')::numeric, 0),
            coalesce((line ->> 'tax_rate')::numeric, 0)
          );
        end loop;

        -- The existing business function moves the stock and puts a
        -- credit sale on the customer ledger. None of that is
        -- reimplemented here.
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
            qty_expected, qty_returned_good, qty_damaged, damage_reason
          ) values (
            org, ret.id, (line ->> 'product_id')::uuid,
            (line ->> 'qty_expected')::integer,
            (line ->> 'qty_returned_good')::integer,
            coalesce((line ->> 'qty_damaged')::integer, 0),
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
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict' else 'failed' end,
      'error', sqlerrm,
      'replayed', false);
  end;
end;
$$;

comment on function public.sync_submit is
  'The single entry point for a queued offline mutation. Idempotent on '
  'the client-generated id; re-derives authorization from the calling '
  'session and never from the payload.';

revoke all on function public.sync_submit(uuid, text, public.sync_operation, jsonb, timestamptz) from public, anon;
grant execute on function public.sync_submit(uuid, text, public.sync_operation, jsonb, timestamptz) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What a device needs cached to work offline
-- ------------------------------------------------------------------
create or replace function public.sync_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  org   uuid;
  van   uuid;
  out   jsonb;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  van := public.my_van_id();

  -- Deliberately narrow: what a driver needs to sell from the van they
  -- are on, and nothing else. A phone that is lost should not be
  -- carrying the whole customer book or the cost price of every line.
  select jsonb_build_object(
    'cached_at', now(),
    'van', (
      select jsonb_build_object('id', v.id, 'code', v.code, 'registration_no', v.registration_no)
        from public.vans v where v.id = van
    ),
    'load', (
      select jsonb_build_object(
               'id', l.id, 'load_number', l.load_number,
               'status', l.status, 'opening_float', l.opening_float)
        from public.van_loads l
       where l.van_id = van and l.status in ('loaded', 'dispatched')
       order by l.load_date desc limit 1
    ),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', s.product_id, 'sku', s.sku, 'name', s.product_name,
               'qty_on_hand', s.qty_on_hand))
        from public.van_stock_summary s where s.van_id = van
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', i.product_id, 'unit_price', i.unit_price,
               'tax_rate', p.tax_rate))
        from public.van_load_items i
        join public.products p on p.id = i.product_id
       where i.load_id = (
         select l.id from public.van_loads l
          where l.van_id = van and l.status in ('loaded', 'dispatched')
          order by l.load_date desc limit 1)
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'code', c.code, 'name', c.name, 'phone', c.phone,
               'balance', coalesce(cp.ledger_balance, 0),
               'credit_available', coalesce(cp.credit_available, c.credit_limit)))
        from public.customers c
        left join public.customer_credit_position cp on cp.customer_id = c.id
       where c.org_id = org and c.is_active
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$$;

comment on function public.sync_bootstrap is
  'The snapshot a device caches to keep working without a connection: '
  'the van, its load, what is on board, and the active customers.';

revoke all on function public.sync_bootstrap() from public, anon;
grant execute on function public.sync_bootstrap() to authenticated, service_role;

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'sync_operations table' as check,
       case when to_regclass('public.sync_operations') is not null
            then 'PASS' else 'FAIL' end as result
union all
select 'sync_status has exactly applied/failed/conflict',
       case when (
         select array_agg(e.enumlabel order by e.enumsortorder)
           from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'sync_status'
       ) = array['applied','failed','conflict']::name[]
            then 'PASS' else 'FAIL' end
union all
select 'row level security on',
       case when (select relrowsecurity from pg_class
                   where oid = 'public.sync_operations'::regclass)
            then 'PASS' else 'FAIL' end
union all
select 'sync_submit function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_submit')
            then 'PASS' else 'FAIL' end
union all
select 'sync_bootstrap function',
       case when exists (select 1 from pg_proc p
                           join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'sync_bootstrap')
            then 'PASS' else 'FAIL' end
union all
select 'history is append-only',
       case when exists (select 1 from pg_trigger
                          where tgrelid = 'public.sync_operations'::regclass
                            and tgname = 'sync_operations_no_edit')
            then 'PASS' else 'FAIL' end
union all
select 'authenticated cannot write it',
       case when not exists (
              select 1 from information_schema.role_table_grants
               where table_name = 'sync_operations' and grantee = 'authenticated'
                 and privilege_type in ('INSERT','UPDATE','DELETE'))
            then 'PASS' else 'FAIL' end;
