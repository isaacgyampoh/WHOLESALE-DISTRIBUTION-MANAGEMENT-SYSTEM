-- =====================================================================
-- 0005_purchasing.sql
-- Purchase orders and goods receipts. Receiving posts a 'receipt'
-- movement, so replenishment flows through the same ledger as sales.
-- =====================================================================

create table public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  po_number      text not null unique
                 default public.next_document_number('PO', 'public.purchase_order_seq'),
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  warehouse_id   uuid not null references public.warehouses (id) on delete restrict,
  status         public.po_status not null default 'draft',
  order_date     date not null default current_date,
  expected_date  date,
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  notes          text,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index purchase_orders_supplier_idx
  on public.purchase_orders (supplier_id, order_date desc);
create index purchase_orders_status_idx on public.purchase_orders (status);

create table public.purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  po_id         uuid not null references public.purchase_orders (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  qty_received  integer not null default 0 check (qty_received >= 0),
  unit_cost     numeric(14,2) not null check (unit_cost >= 0),
  tax_rate      numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  line_subtotal numeric(14,2) generated always as
                  (round(quantity * unit_cost, 2)) stored,
  line_total    numeric(14,2) generated always as
                  (round(quantity * unit_cost * (1 + tax_rate / 100), 2)) stored,
  created_at    timestamptz not null default now(),
  unique (po_id, product_id)
);

create index purchase_order_items_po_idx on public.purchase_order_items (po_id);

create or replace function public.recalc_po_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.po_id, old.po_id);
begin
  update public.purchase_orders p
  set subtotal   = coalesce(t.subtotal, 0),
      tax_total  = coalesce(t.tax, 0),
      total      = coalesce(t.subtotal, 0) + coalesce(t.tax, 0),
      updated_at = now()
  from (
    select sum(line_subtotal) as subtotal,
           sum(line_total - line_subtotal) as tax
    from public.purchase_order_items
    where po_id = target
  ) t
  where p.id = target;

  return null;
end;
$$;

create trigger purchase_order_items_recalc
  after insert or update or delete on public.purchase_order_items
  for each row execute function public.recalc_po_totals();

-- Receive a quantity against one PO line: posts stock, updates the line,
-- refreshes cost price, and advances the PO status.
create or replace function public.receive_purchase_line(
  p_item_id uuid,
  p_quantity integer
)
returns public.purchase_order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.purchase_order_items;
  po   public.purchase_orders;
  outstanding integer;
begin
  if p_quantity <= 0 then
    raise exception 'Received quantity must be positive';
  end if;

  select * into item from public.purchase_order_items where id = p_item_id for update;
  if not found then
    raise exception 'Purchase order line % not found', p_item_id;
  end if;

  select * into po from public.purchase_orders where id = item.po_id for update;

  if po.status in ('cancelled', 'received') then
    raise exception 'Purchase order % is %', po.po_number, po.status;
  end if;

  if item.qty_received + p_quantity > item.quantity then
    raise exception 'Cannot receive % units: only % outstanding on this line',
      p_quantity, item.quantity - item.qty_received;
  end if;

  insert into public.stock_movements
    (product_id, warehouse_id, type, quantity, unit_cost,
     reference_type, reference_id, created_by)
  values
    (item.product_id, po.warehouse_id, 'receipt', p_quantity, item.unit_cost,
     'purchase_order', po.id, auth.uid());

  update public.purchase_order_items
  set qty_received = qty_received + p_quantity
  where id = p_item_id
  returning * into item;

  -- Latest landed cost becomes the product's standard cost.
  update public.products
  set cost_price = item.unit_cost, updated_at = now()
  where id = item.product_id;

  select sum(quantity - qty_received) into outstanding
  from public.purchase_order_items where po_id = po.id;

  update public.purchase_orders
  set status = case when outstanding = 0 then 'received'::public.po_status
                    else 'partially_received'::public.po_status end,
      updated_at = now()
  where id = po.id;

  return item;
end;
$$;

create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();
