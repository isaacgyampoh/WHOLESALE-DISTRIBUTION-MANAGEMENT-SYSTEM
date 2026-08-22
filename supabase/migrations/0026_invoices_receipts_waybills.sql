-- ===================================================================
-- 0026  Invoices, receipts and waybills
-- ===================================================================
--
-- `invoices` and `payments` have been in this schema since 0001 and
-- nothing has ever written to them. Meanwhile a credit sale writes a
-- charge to `credit_transactions`, and a collection writes a payment
-- there too.
--
-- So the business has two ideas of what it is owed, and the older one -
-- the one with invoice numbers, due dates and ageing - is empty. The
-- Credit screen reads `invoice_ageing`, which is built on invoices, and
-- has therefore always shown nothing however much was outstanding.
--
-- This consolidates them rather than adding a third. `credit_transactions`
-- stays as the customer's running ledger, because that is what the
-- credit limit is checked against and it works. On top of it:
--
--   a credit sale now raises an invoice, automatically, by trigger. Not
--   from the application, because an invoice that depends on somebody
--   remembering to create one is how a business loses track of what it
--   is owed.
--
--   a collection now settles invoices oldest first and records a
--   payment against each, which is what a receipt is printed from.
--
-- Waybills are new: goods moving without a document is the one part of
-- this that had nothing at all.

-- ------------------------------------------------------------------
-- An invoice knows which sale it came from
-- ------------------------------------------------------------------
alter table public.invoices
  add column if not exists van_sale_id uuid references public.van_sales(id) on delete restrict;

create unique index if not exists invoices_one_per_sale
  on public.invoices (van_sale_id) where van_sale_id is not null;

comment on column public.invoices.van_sale_id is
  'The van sale this invoice was raised for. One invoice per sale, '
  'enforced by index rather than by whoever calls the function.';

-- ------------------------------------------------------------------
-- Raising an invoice for a credit sale
-- ------------------------------------------------------------------
create or replace function public.issue_invoice_for_sale(p_sale_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  sale    public.van_sales;
  cust    public.customers;
  inv     public.invoices;
  inv_id  uuid;
  terms   integer;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver');

  select * into sale from public.van_sales where id = p_sale_id;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- Security definer runs past row level security, so the tenant check
  -- the policies would have made has to be made here instead. Reported
  -- as 'not found': whether another organization's sale exists is not
  -- this caller's business either.
  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
  end if;

  -- Cash sales are settled at the counter and are evidenced by a
  -- receipt. An invoice for one would be a document nobody owes
  -- anything against.
  if sale.sale_type <> 'credit' then
    return null;
  end if;

  select * into inv from public.invoices where van_sale_id = p_sale_id;
  if found then
    return inv;
  end if;

  select * into cust from public.customers where id = sale.customer_id;
  terms := coalesce(cust.payment_terms_days, 0);

  -- Raised for the whole value of the sale, with nothing paid against
  -- it yet, even when the customer put money down at the door.
  --
  -- The deposit is written below as a payment instead. It has to be:
  -- `amount_paid` on an invoice is recalculated from the payments table
  -- every time one lands, so a figure written straight into the column
  -- survives only until the first collection and then silently
  -- disappears - taking the customer's deposit with it.
  insert into public.invoices (
    org_id, van_sale_id, customer_id, status,
    issue_date, due_date,
    subtotal, tax_total, total, created_by
  ) values (
    sale.org_id, sale.id, sale.customer_id, 'issued',
    sale.sold_at::date,
    coalesce(sale.due_date, sale.sold_at::date + terms),
    sale.subtotal, sale.tax_total, sale.total,
    sale.driver_id
  )
  returning * into inv;
  inv_id := inv.id;

  if sale.amount_paid > 0 then
    -- What they put down at the door, by the method they used, so the
    -- receipt says 'mobile money' when that is what it was.
    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by, paid_at)
    select sale.org_id, inv_id, sp.amount, sp.method, sp.reference, sale.driver_id, sale.sold_at
      from public.van_sale_payments sp
     where sp.sale_id = sale.id;

    if not found then
      -- A sale recorded before payment methods existed, or one taken
      -- offline without a breakdown. It was cash at the time.
      insert into public.payments (org_id, invoice_id, amount, method, received_by, paid_at)
      values (sale.org_id, inv_id, sale.amount_paid, 'cash', sale.driver_id, sale.sold_at);
    end if;

    -- Re-read: the payments above have moved amount_paid, balance and
    -- status underneath us.
    select * into inv from public.invoices where id = inv_id;
  end if;

  return inv;
end;
$$;

comment on function public.issue_invoice_for_sale is
  'Raise the invoice for a credit sale. Returns the existing one if '
  'there already is one, so it is safe to call twice.';

revoke all on function public.issue_invoice_for_sale(uuid) from public, anon;
grant execute on function public.issue_invoice_for_sale(uuid) to authenticated, service_role;

-- Completing a credit sale raises its invoice. By trigger, so it cannot
-- be forgotten by a caller and cannot be skipped by the offline path.
create or replace function public.invoice_on_sale_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.sale_type = 'credit' then
    perform public.issue_invoice_for_sale(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists van_sales_raise_invoice on public.van_sales;
create trigger van_sales_raise_invoice
  after update on public.van_sales
  for each row execute function public.invoice_on_sale_completed();

-- ------------------------------------------------------------------
-- A collection settles invoices, oldest first
-- ------------------------------------------------------------------
--
-- Replaces record_credit_payment. The ledger entry it always wrote is
-- unchanged - the credit limit is still checked against that - and the
-- money is now also allocated across open invoices so ageing means
-- something and a receipt can be printed.
create or replace function public.record_credit_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_method public.payment_method default 'cash',
  p_notes text default null
)
returns public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  txn       public.credit_transactions;
  org       uuid;
  remaining numeric(14,2) := p_amount;
  inv       record;
  take      numeric(14,2);
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant', 'driver');

  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select org_id into org from public.customers where id = p_customer_id;
  if org is null then
    raise exception 'Customer % not found', p_customer_id;
  end if;

  if auth.uid() is not null and org is distinct from public.auth_org_id() then
    raise exception 'Customer % not found', p_customer_id using errcode = '42501';
  end if;

  insert into public.credit_transactions
    (org_id, customer_id, type, amount, reference_type, created_by, notes)
  values
    (org, p_customer_id, 'payment', -p_amount, p_method::text, auth.uid(),
     coalesce(p_notes, 'Payment received'))
  returning * into txn;

  -- Oldest due first. A customer paying something off is paying down
  -- what has been owed longest, which is also what the ageing report
  -- assumes.
  for inv in
    select id, balance
      from public.invoices
     where customer_id = p_customer_id
       and status not in ('paid', 'void')
       and balance > 0
     order by due_date asc, issue_date asc
     for update
  loop
    exit when remaining <= 0;
    take := least(inv.balance, remaining);

    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by)
    values (org, inv.id, take, p_method, p_notes, auth.uid());

    remaining := remaining - take;
  end loop;

  -- Anything left over is money on account: it is on the ledger, and
  -- will settle the next invoice raised. It is deliberately not forced
  -- onto an invoice that does not exist yet.
  return txn;
end;
$$;

-- ------------------------------------------------------------------
-- Waybills
-- ------------------------------------------------------------------
create type public.waybill_status as enum (
  'draft', 'issued', 'delivered', 'cancelled'
);

create sequence if not exists public.waybill_seq;

create table if not exists public.waybills (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  waybill_number  text not null default public.next_document_number('WB', 'public.waybill_seq'),
  status          public.waybill_status not null default 'draft',
  -- Where the goods came from, and where they went. A waybill for a van
  -- round names the van; one for a delivery names the customer.
  from_warehouse_id uuid references public.warehouses(id) on delete restrict,
  van_id            uuid references public.vans(id) on delete restrict,
  customer_id       uuid references public.customers(id) on delete restrict,
  destination       text,
  driver_id         uuid references public.profiles(id) on delete set null,
  -- What it evidences: a van load, a sale, a transfer.
  reference_type  text,
  reference_id    uuid,
  issued_on       date not null default current_date,
  delivered_at    timestamptz,
  received_by     text,
  notes           text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint waybills_has_a_destination
    check (van_id is not null or customer_id is not null or destination is not null)
);

comment on table public.waybills is
  'The document that travels with the goods. Evidence of what left, '
  'where it went and who signed for it.';

create unique index if not exists waybills_number_unique on public.waybills (org_id, waybill_number);
create index if not exists waybills_reference on public.waybills (reference_type, reference_id);
create index if not exists waybills_org_date on public.waybills (org_id, issued_on desc);

create table if not exists public.waybill_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  waybill_id  uuid not null references public.waybills(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete restrict,
  quantity    integer not null,
  notes       text,
  created_at  timestamptz not null default now(),

  constraint waybill_items_quantity_positive check (quantity > 0)
);

create index if not exists waybill_items_waybill on public.waybill_items (waybill_id);

alter table public.waybills enable row level security;
alter table public.waybill_items enable row level security;

-- A driver sees the waybills for their own rounds; the office sees all
-- of them.
drop policy if exists waybills_read on public.waybills;
create policy waybills_read on public.waybills
  for select using (
    org_id = public.auth_org_id()
    and (
      public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse')
      or driver_id = auth.uid()
      or van_id = public.my_van_id()
    )
  );

drop policy if exists waybills_write on public.waybills;
create policy waybills_write on public.waybills
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );

drop policy if exists waybill_items_read on public.waybill_items;
create policy waybill_items_read on public.waybill_items
  for select using (
    org_id = public.auth_org_id()
    and exists (select 1 from public.waybills w where w.id = waybill_items.waybill_id)
  );

drop policy if exists waybill_items_write on public.waybill_items;
create policy waybill_items_write on public.waybill_items
  for all using (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  ) with check (
    org_id = public.auth_org_id()
    and public.has_role('admin', 'senior_manager', 'manager', 'warehouse')
  );

drop trigger if exists waybills_touch on public.waybills;
create trigger waybills_touch
  before update on public.waybills
  for each row execute function public.set_updated_at();

grant select on public.waybills to authenticated;
grant select on public.waybill_items to authenticated;
grant all on public.waybills to service_role;
grant all on public.waybill_items to service_role;

-- ------------------------------------------------------------------
-- A waybill for a dispatched load
-- ------------------------------------------------------------------
create or replace function public.issue_waybill_for_load(p_load_id uuid)
returns public.waybills
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  wb   public.waybills;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  -- Security definer runs past row level security, so the tenant check
  -- the policies would have made has to be made here instead. Reported
  -- as 'not found': whether another organization's sale exists is not
  -- this caller's business either.
  if auth.uid() is not null and load.org_id is distinct from public.auth_org_id() then
    raise exception 'Van load % not found', p_load_id using errcode = '42501';
  end if;

  select * into wb from public.waybills
   where reference_type = 'van_load' and reference_id = p_load_id;
  if found then
    return wb;
  end if;

  insert into public.waybills (
    org_id, status, from_warehouse_id, van_id, driver_id,
    reference_type, reference_id, issued_on, created_by
  ) values (
    load.org_id, 'issued', load.warehouse_id, load.van_id, load.driver_id,
    'van_load', load.id, load.load_date, auth.uid()
  )
  returning * into wb;

  insert into public.waybill_items (org_id, waybill_id, product_id, quantity)
  select load.org_id, wb.id, i.product_id, i.qty_loaded
    from public.van_load_items i
   where i.load_id = p_load_id;

  return wb;
end;
$$;

comment on function public.issue_waybill_for_load is
  'The document that goes out with a van load. Safe to call twice; it '
  'returns the waybill already issued.';

revoke all on function public.issue_waybill_for_load(uuid) from public, anon;
grant execute on function public.issue_waybill_for_load(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- What the office reads
-- ------------------------------------------------------------------
create or replace view public.invoice_detail
with (security_invoker = on) as
  select
    i.id,
    i.org_id,
    i.invoice_number,
    i.status,
    i.issue_date,
    i.due_date,
    i.subtotal,
    i.tax_total,
    i.total,
    i.amount_paid,
    i.balance,
    c.id           as customer_id,
    c.code         as customer_code,
    c.name         as customer_name,
    c.phone        as customer_phone,
    c.billing_address as customer_address,
    s.sale_number,
    s.sold_at,
    p.full_name    as sold_by,
    (i.due_date < current_date and i.balance > 0) as is_overdue
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  left join public.van_sales s on s.id = i.van_sale_id
  left join public.profiles p on p.id = i.created_by;

comment on view public.invoice_detail is
  'An invoice with everything a printed copy needs. No cost anywhere - '
  'a customer document shows what they were charged.';

create or replace view public.receipt_detail
with (security_invoker = on) as
  select
    pay.id,
    pay.org_id,
    pay.payment_number,
    pay.amount,
    pay.method,
    pay.reference,
    pay.paid_at,
    i.invoice_number,
    i.total          as invoice_total,
    i.balance        as invoice_balance,
    c.id             as customer_id,
    c.code           as customer_code,
    c.name           as customer_name,
    c.phone          as customer_phone,
    r.full_name      as received_by
  from public.payments pay
  join public.invoices i on i.id = pay.invoice_id
  join public.customers c on c.id = i.customer_id
  left join public.profiles r on r.id = pay.received_by;

comment on view public.receipt_detail is
  'A payment with what a receipt needs printed on it.';
