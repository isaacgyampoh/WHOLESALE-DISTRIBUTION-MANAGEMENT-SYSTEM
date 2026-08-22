-- ===================================================================
-- 0025  How a sale was paid for
-- ===================================================================
--
-- A van sale recorded how much was paid and never how. `amount_paid`
-- was a single number, so ₵500 taken half in cash and half on mobile
-- money was indistinguishable from ₵500 in notes.
--
-- In Ghana that is not a detail. Mobile money is most of the takings on
-- many rounds, and a driver hands over cash while the momo has already
-- gone to a float. Reconciling them together means a driver is short
-- every evening by exactly the amount they were paid electronically -
-- which is why end of day could only ever check cash.
--
-- So payment becomes a breakdown rather than a figure. One sale, one or
-- more payments, each with its own method and reference.

-- ------------------------------------------------------------------
-- The breakdown
-- ------------------------------------------------------------------
create table if not exists public.van_sale_payments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  sale_id    uuid not null references public.van_sales(id) on delete cascade,
  method     public.payment_method not null,
  amount     numeric(14,2) not null,
  -- A momo transaction id, a cheque number. What a disputed payment is
  -- matched against later.
  reference  text,
  created_at timestamptz not null default now(),

  constraint van_sale_payments_amount_positive check (amount > 0)
);

comment on table public.van_sale_payments is
  'What a sale was actually paid with. One row per method, so a split '
  'between cash and mobile money is two rows rather than a lost detail.';

create index if not exists van_sale_payments_sale on public.van_sale_payments (sale_id);
create index if not exists van_sale_payments_method
  on public.van_sale_payments (org_id, method, created_at desc);

alter table public.van_sale_payments enable row level security;

-- Whoever may see the sale may see how it was paid for.
drop policy if exists van_sale_payments_read on public.van_sale_payments;
create policy van_sale_payments_read on public.van_sale_payments
  for select using (
    org_id = public.auth_org_id()
    and exists (
      select 1 from public.van_sales s
       where s.id = van_sale_payments.sale_id
    )
  );

-- Written only by record_sale_payments(), which checks the arithmetic.
-- A driver who could insert here directly could claim a sale was paid.
revoke all on public.van_sale_payments from anon, authenticated;
grant select on public.van_sale_payments to authenticated;
grant all on public.van_sale_payments to service_role;

-- ------------------------------------------------------------------
-- Recording payment against a sale
-- ------------------------------------------------------------------
--
-- Takes the whole breakdown at once rather than a row at a time: the
-- rules worth enforcing are about the total, and checking them per row
-- would let a second insert push a sale past its own value.
create or replace function public.record_sale_payments(
  p_sale_id  uuid,
  p_payments jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  sale    public.van_sales;
  entry   jsonb;
  amount  numeric(14,2);
  method  public.payment_method;
  total   numeric(14,2) := 0;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if sale.status = 'completed' then
    raise exception 'Sale % is already completed', sale.sale_number;
  end if;

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Payments must be a list';
  end if;

  -- Cleared first so a retry replaces the breakdown rather than adding
  -- to it. The sale is still a draft at this point, so nothing has been
  -- reported on it.
  delete from public.van_sale_payments where sale_id = p_sale_id;

  for entry in select * from jsonb_array_elements(p_payments) loop
    amount := (entry ->> 'amount')::numeric;
    method := (entry ->> 'method')::public.payment_method;

    if amount is null or amount <= 0 then
      raise exception 'Every payment needs an amount above zero';
    end if;

    insert into public.van_sale_payments (org_id, sale_id, method, amount, reference)
    values (sale.org_id, p_sale_id, method, amount, nullif(entry ->> 'reference', ''));

    total := total + amount;
  end loop;

  -- Nobody hands over more than the sale is worth. A customer paying
  -- extra is a payment on account, not part of this sale, and merging
  -- the two would misstate both.
  if total > sale.total then
    raise exception 'Payment of % is more than the sale total of %', total, sale.total;
  end if;

  -- A cash sale is one that was paid for. Short payment is what credit
  -- is for, and calling it cash would leave a balance nobody is
  -- chasing.
  if sale.sale_type = 'cash' and total < sale.total then
    raise exception
      'This is a cash sale of % but only % was paid. Take the balance, or record it as a credit sale.',
      sale.total, total;
  end if;

  return total;
end;
$$;

comment on function public.record_sale_payments is
  'Record how a sale was paid, as a breakdown by method. Refuses more '
  'than the sale is worth, and refuses a cash sale that is short.';

revoke all on function public.record_sale_payments(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_payments(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What a round took, by method
-- ------------------------------------------------------------------
create or replace view public.load_takings
with (security_invoker = on) as
  select
    s.org_id,
    s.load_id,
    coalesce(sum(p.amount) filter (where p.method = 'cash'), 0)          as cash_taken,
    coalesce(sum(p.amount) filter (where p.method = 'mobile_money'), 0)  as momo_taken,
    coalesce(sum(p.amount) filter (where p.method not in ('cash', 'mobile_money')), 0)
                                                                        as other_taken,
    coalesce(sum(p.amount), 0)                                          as total_taken
  from public.van_sales s
  left join public.van_sale_payments p on p.sale_id = s.id
  where s.status = 'completed'
  group by s.org_id, s.load_id;

comment on view public.load_takings is
  'What a round actually took, split by method. Cash is what the driver '
  'hands over; mobile money has already gone to the float.';

-- ------------------------------------------------------------------
-- End of day counts them apart
-- ------------------------------------------------------------------
alter table public.van_reconciliations
  add column if not exists momo_sales_total numeric(14,2) not null default 0,
  add column if not exists expected_momo    numeric(14,2) not null default 0,
  add column if not exists actual_momo      numeric(14,2) not null default 0;

-- `add column if not exists` cannot carry a GENERATED clause, and
-- dropping the column first fails the second time round because the
-- variance view has come to depend on it. Guarded instead.
do $momo$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'van_reconciliations'
       and column_name = 'momo_variance'
  ) then
    alter table public.van_reconciliations
      add column momo_variance numeric(14,2)
      generated always as (actual_momo - expected_momo) stored;
  end if;
end
$momo$;

comment on column public.van_reconciliations.expected_momo is
  'What the round took on mobile money. Not handed over in cash, so it '
  'is reconciled against the float rather than against the tin.';

-- Rebuilt so expected cash is cash, not cash plus everything else.
create or replace function public.build_reconciliation(p_load_id uuid)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
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

  select coalesce(sum(qty_loaded * unit_cost), 0) into loaded_value
  from public.van_load_items where load_id = p_load_id;

  select coalesce(sum(vsi.quantity * vli.unit_cost), 0) into sold_value
  from public.van_sale_items vsi
  join public.van_sales vs on vs.id = vsi.sale_id
  join public.van_load_items vli
    on vli.load_id = vs.load_id and vli.product_id = vsi.product_id
  where vs.load_id = p_load_id and vs.status = 'completed';

  select
    coalesce(sum(vri.qty_damaged * vli.unit_cost), 0),
    coalesce(sum(vri.qty_missing  * vli.unit_cost), 0)
  into damaged, missing
  from public.van_return_items vri
  join public.van_returns vr on vr.id = vri.return_id
  join public.van_load_items vli
    on vli.load_id = vr.load_id and vli.product_id = vri.product_id
  where vr.load_id = p_load_id;

  remaining := loaded_value - sold_value;

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
$$;

-- The variance view gains the same split.
--
-- Appended rather than inserted: `create or replace view` refuses to
-- rename or reorder a column, and dropping this one would take whatever
-- is built on it.
create or replace view public.reconciliation_variances
with (security_invoker = on) as
  select
    r.org_id,
    r.id,
    r.recon_number,
    r.status,
    v.code                as van_code,
    p.full_name           as driver_name,
    r.expected_cash,
    r.actual_cash,
    r.cash_variance,
    r.expected_stock_value,
    r.actual_stock_value,
    r.stock_variance,
    r.damaged_value,
    r.missing_value,
    r.cash_variance + r.stock_variance as total_variance,
    r.explanation,
    r.submitted_at,
    r.expected_momo,
    r.actual_momo,
    r.momo_variance
  from public.van_reconciliations r
  join public.vans v on v.id = r.van_id
  left join public.profiles p on p.id = r.driver_id;
