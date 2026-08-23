-- ===================================================================
-- 0033  Which network the mobile money came from
-- ===================================================================
--
-- A mobile money payment records a reference and nothing else. In Ghana
-- that reference is only meaningful alongside the network that issued
-- it: MTN, Telecel and AirtelTigo each number their transactions
-- independently, so "0071234567" identifies a payment only once you know
-- whose system it came out of.
--
-- Without the network, reconciling a day's takings against a merchant
-- statement means guessing which statement to look in. With it, the
-- match is exact.
--
-- The list is a table rather than an enum. Networks merge and rebrand -
-- Vodafone Ghana became Telecel in 2023 - and a business should be able
-- to add one without a migration.

create table if not exists public.momo_providers (
  code       text primary key,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 100,

  constraint momo_providers_code_lower check (code = lower(code)),
  constraint momo_providers_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.momo_providers is
  'Mobile money networks. A table rather than an enum because networks '
  'rebrand and a business should not need a migration to follow them.';

insert into public.momo_providers (code, name, sort_order) values
  ('mtn',        'MTN Mobile Money', 10),
  ('telecel',    'Telecel Cash',     20),
  ('airteltigo', 'AirtelTigo Money', 30),
  ('other',      'Other',            90)
on conflict (code) do nothing;

alter table public.momo_providers enable row level security;

-- A reference list, readable by anybody signed in. Nothing about it is
-- specific to one organization.
drop policy if exists momo_providers_read on public.momo_providers;
create policy momo_providers_read on public.momo_providers
  for select using (auth.uid() is not null);

revoke all on public.momo_providers from anon, authenticated;
grant select on public.momo_providers to authenticated;
grant all on public.momo_providers to service_role;

-- ------------------------------------------------------------------
-- Carried on the payment itself
-- ------------------------------------------------------------------
alter table public.van_sale_payments
  add column if not exists provider text references public.momo_providers(code);

alter table public.payments
  add column if not exists provider text references public.momo_providers(code);

comment on column public.van_sale_payments.provider is
  'The mobile money network, where the method is mobile_money. A '
  'reference without the network it was issued by cannot be matched '
  'against a statement.';

-- A network on a cash payment is meaningless, and its absence on mobile
-- money is a reconciliation that cannot be done. Both are refused.
alter table public.van_sale_payments
  drop constraint if exists van_sale_payments_provider_matches_method;
alter table public.van_sale_payments
  add constraint van_sale_payments_provider_matches_method
  check (provider is null or method = 'mobile_money');

alter table public.payments
  drop constraint if exists payments_provider_matches_method;
alter table public.payments
  add constraint payments_provider_matches_method
  check (provider is null or method = 'mobile_money');

create index if not exists van_sale_payments_provider_idx
  on public.van_sale_payments (org_id, provider, created_at desc)
  where provider is not null;

-- ------------------------------------------------------------------
-- Recording it
-- ------------------------------------------------------------------
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
  sale     public.van_sales;
  entry    jsonb;
  amount   numeric(14,2);
  method   public.payment_method;
  provider text;
  total    numeric(14,2) := 0;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver');

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
  -- to it. The sale is still a draft, so nothing has been reported on it.
  delete from public.van_sale_payments where sale_id = p_sale_id;

  for entry in select * from jsonb_array_elements(p_payments) loop
    amount   := (entry ->> 'amount')::numeric;
    method   := (entry ->> 'method')::public.payment_method;
    provider := nullif(entry ->> 'provider', '');

    if amount is null or amount <= 0 then
      raise exception 'Every payment needs an amount above zero';
    end if;

    if provider is not null
       and not exists (select 1 from public.momo_providers
                        where code = provider and is_active) then
      raise exception 'Unknown mobile money network: %', provider;
    end if;

    insert into public.van_sale_payments
      (org_id, sale_id, method, amount, reference, provider)
    values
      (sale.org_id, p_sale_id, method, amount,
       nullif(entry ->> 'reference', ''),
       case when method = 'mobile_money' then provider end);

    total := total + amount;
  end loop;

  -- Nobody hands over more than the sale is worth. A customer paying
  -- extra is a payment on account, not part of this sale.
  if total > sale.total then
    raise exception 'Payment of % is more than the sale total of %', total, sale.total;
  end if;

  -- A cash sale is one that was paid for. Short payment is what credit
  -- is for, and calling it cash leaves a balance nobody is chasing.
  if sale.sale_type = 'cash' and total < sale.total then
    raise exception
      'This is a cash sale of % but only % was paid. Take the balance, or record it as a credit sale.',
      sale.total, total;
  end if;

  return total;
end;
$$;

revoke all on function public.record_sale_payments(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_payments(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Reconciling mobile money
-- ------------------------------------------------------------------
create or replace view public.momo_reconciliation
with (security_invoker = on) as
  select
    p.org_id,
    p.created_at::date            as taken_on,
    coalesce(p.provider, 'other') as provider,
    coalesce(m.name, 'Unknown')   as provider_name,
    s.van_id,
    v.code                        as van_code,
    s.salesperson_id,
    sp.full_name                  as salesperson_name,
    count(*)                      as payment_count,
    sum(p.amount)                 as total_amount,
    -- A payment nobody can match to a statement. Not an error on its
    -- own, but it is the pile somebody has to work through.
    count(*) filter (where p.reference is null or trim(p.reference) = '') as unreferenced_count,
    sum(p.amount) filter (where p.reference is null or trim(p.reference) = '')
                                  as unreferenced_amount
  from public.van_sale_payments p
  join public.van_sales s on s.id = p.sale_id
  left join public.momo_providers m on m.code = p.provider
  left join public.vans v on v.id = s.van_id
  left join public.profiles sp on sp.id = s.salesperson_id
  where p.method = 'mobile_money'
    and s.status = 'completed'
  group by p.org_id, p.created_at::date, p.provider, m.name,
           s.van_id, v.code, s.salesperson_id, sp.full_name;

comment on view public.momo_reconciliation is
  'Mobile money taken, by day, network, van and salesperson - the four '
  'ways somebody asks about it. Unreferenced payments are counted apart '
  'because those are the ones that cannot be matched to a statement.';
