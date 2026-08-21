-- =====================================================================
-- 0004_sales.sql
-- Sales orders -> invoices -> payments.
-- Header totals and invoice balances are derived by trigger so the
-- application never has to keep them in sync by hand.
-- =====================================================================

create table public.sales_orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   text not null unique
                 default public.next_document_number('SO', 'public.sales_order_seq'),
  customer_id    uuid not null references public.customers (id) on delete restrict,
  warehouse_id   uuid not null references public.warehouses (id) on delete restrict,
  status         public.order_status not null default 'draft',
  order_date     date not null default current_date,
  required_date  date,
  shipped_date   date,
  shipping_address text,
  subtotal       numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index sales_orders_customer_idx on public.sales_orders (customer_id, order_date desc);
create index sales_orders_status_idx on public.sales_orders (status);

create table public.sales_order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.sales_orders (id) on delete cascade,
  product_id     uuid not null references public.products (id) on delete restrict,
  quantity       integer not null check (quantity > 0),
  qty_shipped    integer not null default 0 check (qty_shipped >= 0),
  unit_price     numeric(14,2) not null check (unit_price >= 0),
  discount_pct   numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate       numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal  numeric(14,2) generated always as
                   (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  line_total     numeric(14,2) generated always as
                   (round(quantity * unit_price * (1 - discount_pct / 100)
                          * (1 + tax_rate / 100), 2)) stored,
  created_at     timestamptz not null default now(),
  unique (order_id, product_id)
);

create index sales_order_items_order_idx on public.sales_order_items (order_id);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique
                 default public.next_document_number('INV', 'public.invoice_seq'),
  order_id       uuid references public.sales_orders (id) on delete set null,
  customer_id    uuid not null references public.customers (id) on delete restrict,
  status         public.invoice_status not null default 'draft',
  issue_date     date not null default current_date,
  due_date       date not null default (current_date + 30),
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance        numeric(14,2) generated always as (total - amount_paid) stored,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index invoices_customer_idx on public.invoices (customer_id, issue_date desc);
create index invoices_open_idx on public.invoices (status)
  where status in ('issued', 'partially_paid', 'overdue');

create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  payment_number text not null unique
                 default public.next_document_number('PAY', 'public.payment_seq'),
  invoice_id     uuid not null references public.invoices (id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  method         public.payment_method not null default 'bank_transfer',
  reference      text,
  paid_at        timestamptz not null default now(),
  received_by    uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id);

-- ------------------------------------------------- derived order totals
create or replace function public.recalc_order_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.order_id, old.order_id);
begin
  update public.sales_orders o
  set subtotal       = coalesce(t.subtotal, 0),
      tax_total      = coalesce(t.tax, 0),
      discount_total = coalesce(t.discount, 0),
      total          = coalesce(t.subtotal, 0) + coalesce(t.tax, 0),
      updated_at     = now()
  from (
    select
      sum(line_subtotal)                          as subtotal,
      sum(line_total - line_subtotal)             as tax,
      sum(round(quantity * unit_price * discount_pct / 100, 2)) as discount
    from public.sales_order_items
    where order_id = target
  ) t
  where o.id = target;

  return null;
end;
$$;

create trigger sales_order_items_recalc
  after insert or update or delete on public.sales_order_items
  for each row execute function public.recalc_order_totals();

-- ------------------------------------------ payments -> invoice balance
create or replace function public.recalc_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
  paid   numeric(14,2);
  inv    public.invoices;
begin
  select coalesce(sum(amount), 0) into paid
  from public.payments where invoice_id = target;

  select * into inv from public.invoices where id = target;

  update public.invoices
  set amount_paid = paid,
      status = case
        when status = 'void' then 'void'
        when paid <= 0 and inv.due_date < current_date then 'overdue'
        when paid <= 0 then inv.status
        when paid >= inv.total then 'paid'
        else 'partially_paid'
      end,
      updated_at = now()
  where id = target;

  return null;
end;
$$;

create trigger payments_recalc_invoice
  after insert or update or delete on public.payments
  for each row execute function public.recalc_invoice_payment();

-- ------------------------------------- reserve / release / ship stock
-- Confirming an order reserves stock; shipping converts the reservation
-- into an actual issue; cancelling releases it.
create or replace function public.handle_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
begin
  if new.status = old.status then
    return new;
  end if;

  -- draft -> confirmed: reserve
  if old.status = 'draft' and new.status = 'confirmed' then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = qty_reserved + item.quantity, updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;

      if not found then
        raise exception 'No stock record for product % in warehouse %',
          item.product_id, new.warehouse_id;
      end if;
    end loop;
  end if;

  -- anything -> shipped: release reservation and issue the stock
  if new.status = 'shipped' and old.status <> 'shipped' then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = greatest(qty_reserved - item.quantity, 0), updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;

      insert into public.stock_movements
        (product_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
      values
        (item.product_id, new.warehouse_id, 'issue', item.quantity,
         'sales_order', new.id, auth.uid());
    end loop;

    new.shipped_date := coalesce(new.shipped_date, current_date);
  end if;

  -- cancelled before shipping: release the reservation
  if new.status = 'cancelled' and old.status in ('confirmed', 'picking', 'packed') then
    for item in select * from public.sales_order_items where order_id = new.id loop
      update public.inventory
      set qty_reserved = greatest(qty_reserved - item.quantity, 0), updated_at = now()
      where product_id = item.product_id and warehouse_id = new.warehouse_id;
    end loop;
  end if;

  return new;
end;
$$;

create trigger sales_orders_status_change
  before update of status on public.sales_orders
  for each row execute function public.handle_order_status_change();

create trigger sales_orders_set_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
