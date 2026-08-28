-- ===================================================================
-- 0057  The rest of the ways stock moves
-- ===================================================================
--
-- Five paths were still counting full units only: warehouse to
-- warehouse in both directions, a wholesale order shipping, a purchase
-- being received, and a return. Each is a real way stock enters or
-- leaves this business, and a piece that travels one of them silently
-- fails to move.
--
-- The pattern is the one every other function now follows. Either half
-- may be zero; the movement as a whole may not. coalesce throughout, so
-- a caller that has not been updated behaves exactly as it did.
--
-- MONEY, AGAIN
--
-- sales_order_items has the same generated-column fault van_sale_items
-- had: line_subtotal reads quantity * unit_price and nothing else, so
-- pieces on a wholesale order would be delivered and never invoiced.
-- purchase_order_items has the mirror of it on the buying side, where
-- the consequence is a supplier bill that does not match what arrived.
-- Both expressions now count the loose half at its own rate.
--
-- A piece costs a fraction of the case it came out of, so piece_cost
-- defaults to zero and is set when a supplier actually prices singles.
-- A piece SELLS for its own price, never a twelfth of the carton - the
-- reasoning is in 0051 and it has not changed.

-- ------------------------------------------------------------------
-- The columns
-- ------------------------------------------------------------------

alter table public.stock_transfer_items
  add column if not exists pieces integer not null default 0,
  add column if not exists qty_received_pieces integer not null default 0;

alter table public.stock_return_items
  add column if not exists pieces integer not null default 0;

alter table public.purchase_order_items
  add column if not exists pieces integer not null default 0,
  add column if not exists qty_received_pieces integer not null default 0,
  add column if not exists piece_cost numeric(14,2) not null default 0;

alter table public.sales_order_items
  add column if not exists pieces integer not null default 0,
  add column if not exists qty_shipped_pieces integer not null default 0,
  add column if not exists piece_price numeric(14,2) not null default 0;

-- ------------------------------------------------------------------
-- A line may be pieces only
-- ------------------------------------------------------------------
--
-- The quantity > 0 trap, in the last three tables that still hold it.

alter table public.stock_transfer_items
  drop constraint if exists stock_transfer_items_quantity_check;
alter table public.stock_transfer_items
  add constraint stock_transfer_items_quantity_not_negative check (quantity >= 0);
alter table public.stock_transfer_items
  drop constraint if exists stock_transfer_items_moves_something;
alter table public.stock_transfer_items
  add constraint stock_transfer_items_moves_something
  check (quantity > 0 or pieces > 0);

alter table public.stock_return_items
  drop constraint if exists stock_return_items_quantity_check;
alter table public.stock_return_items
  add constraint stock_return_items_quantity_not_negative check (quantity >= 0);
alter table public.stock_return_items
  drop constraint if exists stock_return_items_returns_something;
alter table public.stock_return_items
  add constraint stock_return_items_returns_something
  check (quantity > 0 or pieces > 0);

alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_quantity_check;
alter table public.purchase_order_items
  add constraint purchase_order_items_quantity_not_negative check (quantity >= 0);
alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_orders_something;
alter table public.purchase_order_items
  add constraint purchase_order_items_orders_something
  check (quantity > 0 or pieces > 0);

alter table public.sales_order_items
  drop constraint if exists sales_order_items_quantity_check;
alter table public.sales_order_items
  add constraint sales_order_items_quantity_not_negative check (quantity >= 0);
alter table public.sales_order_items
  drop constraint if exists sales_order_items_orders_something;
alter table public.sales_order_items
  add constraint sales_order_items_orders_something
  check (quantity > 0 or pieces > 0);

-- ------------------------------------------------------------------
-- The money the pieces are worth
-- ------------------------------------------------------------------

alter table public.sales_order_items
  alter column line_subtotal set expression as (
    round((quantity::numeric * unit_price + pieces::numeric * piece_price)
          * (1::numeric - discount_pct / 100::numeric), 2)
  );

alter table public.sales_order_items
  alter column line_total set expression as (
    round((quantity::numeric * unit_price + pieces::numeric * piece_price)
          * (1::numeric - discount_pct / 100::numeric)
          * (1::numeric + tax_rate / 100::numeric), 2)
  );

alter table public.purchase_order_items
  alter column line_subtotal set expression as (
    round(quantity::numeric * unit_cost + pieces::numeric * piece_cost, 2)
  );

alter table public.purchase_order_items
  alter column line_total set expression as (
    round((quantity::numeric * unit_cost + pieces::numeric * piece_cost)
          * (1::numeric + tax_rate / 100::numeric), 2)
  );

-- ------------------------------------------------------------------
-- The old two-argument receive_purchase_line has to go
-- ------------------------------------------------------------------
--
-- receive_purchase_line gains p_pieces with a default, which does not
-- replace the old function - it creates a second one beside it. A
-- two-argument call then resolves to the exact match, which is the old
-- body that knows nothing about pieces, and every existing caller
-- silently keeps the old behaviour while appearing to have been
-- updated.
--
-- Dropped explicitly, so the three-argument version is the only one
-- there and its default answers a two-argument call.
drop function if exists public.receive_purchase_line(uuid, integer);

-- ------------------------------------------------------------------
-- The functions
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_stock_transfer(p_transfer_id uuid)
 RETURNS stock_transfers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  transfer  public.stock_transfers;
  item      record;
  available integer;
  expired   record;
  sent      jsonb;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  if transfer.status <> 'approved' then
    raise exception
      'Transfer % must be approved before the goods leave (currently %)',
      transfer.transfer_number, transfer.status;
  end if;

  -- Nothing out of date is moved to another depot. Shipping expired
  -- stock across the country only relocates the write-off, and the far
  -- warehouse has no way of knowing. Checked before any movement is
  -- written, so a refused transfer moves nothing at all.
  select p.name, b.batch_number, b.expires_on
    into expired
    from public.stock_transfer_items i
    join public.products p on p.id = i.product_id
    join public.product_batches b
      on b.product_id = i.product_id
     and b.warehouse_id = transfer.from_warehouse_id
     and b.qty_remaining > 0
   where i.transfer_id = p_transfer_id
     and p.track_expiry
     and b.expires_on is not null
     and b.expires_on < current_date
   order by b.expires_on
   limit 1;

  if found then
    raise exception
      'Cannot dispatch %: batch % of % expired on %. Write it off before transferring.',
      transfer.transfer_number, expired.batch_number, expired.name, expired.expires_on;
  end if;

  -- Every line is checked for stock before the first one moves, so a
  -- transfer that cannot be filled does not half-empty the warehouse.
  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    select coalesce(qty_available, 0) into available
      from public.inventory
     where product_id = item.product_id and warehouse_id = transfer.from_warehouse_id;

    if coalesce(available, 0) < item.quantity then
      raise exception
        'Not enough stock to transfer: % available at the source, % requested',
        coalesce(available, 0), item.quantity;
    end if;
  end loop;

  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    -- Out of the source warehouse. The matching transfer_in is written
    -- at receipt, not here: between the two the goods are in transit
    -- and belong to neither depot, which is the honest position and the
    -- reason a transfer is not two adjustments.
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, pieces,
       reference_type, reference_id, created_by)
    values
      (transfer.org_id, item.product_id, transfer.from_warehouse_id, 'transfer_out',
       item.quantity, coalesce(item.pieces, 0),
       'stock_transfer', transfer.id, auth.uid());

    sent := public.take_batches(item.product_id, transfer.from_warehouse_id, item.quantity);

    update public.stock_transfer_items
       set batches_sent = sent
     where id = item.id;
  end loop;

  update public.stock_transfers
     set status = 'in_transit', dispatched_by = auth.uid(),
         dispatched_at = now(), updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id uuid, p_counts jsonb DEFAULT '[]'::jsonb)
 RETURNS stock_transfers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  transfer public.stock_transfers;
  item     record;
  counted  integer;
  counted_pieces integer;
  batch    jsonb;
  place    integer;
  left_to_place integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into transfer from public.stock_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Transfer % not found', p_transfer_id;
  end if;

  if auth.uid() is not null and transfer.org_id is distinct from public.auth_org_id() then
    raise exception 'Transfer % not found', p_transfer_id using errcode = '42501';
  end if;

  if transfer.status <> 'in_transit' then
    raise exception 'Transfer % is % and is not out for delivery',
      transfer.transfer_number, transfer.status;
  end if;

  if jsonb_typeof(p_counts) <> 'array' then
    raise exception 'Counts must be a list';
  end if;

  for item in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    select (c ->> 'quantity')::integer, (c ->> 'pieces')::integer
      into counted, counted_pieces
      from jsonb_array_elements(p_counts) as c
     where (c ->> 'item_id')::uuid = item.id
     limit 1;

    counted := coalesce(counted, item.quantity);
    -- Nothing counted for the loose half means all of it arrived, the
    -- same assumption the full units already make.
    counted_pieces := coalesce(counted_pieces, coalesce(item.pieces, 0));

    if counted_pieces < 0 then
      raise exception 'A received quantity cannot be negative';
    end if;

    if counted_pieces > coalesce(item.pieces, 0) then
      raise exception
        'Received % loose pieces but only % were sent. Record the excess separately.',
        counted_pieces, coalesce(item.pieces, 0);
    end if;

    if counted < 0 then
      raise exception 'A received quantity cannot be negative';
    end if;

    -- More cannot arrive than left. If the far warehouse counts more,
    -- something else got mixed into the delivery and belongs on its own
    -- receipt rather than against this transfer.
    if counted > item.quantity then
      raise exception
        'More arrived than was sent: % received against % dispatched. '
        'Record the excess separately.', counted, item.quantity;
    end if;

    update public.stock_transfer_items
       set qty_received = counted, qty_received_pieces = counted_pieces
     where id = item.id;

    if counted > 0 or counted_pieces > 0 then
      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, pieces,
         reference_type, reference_id, created_by)
      values
        (transfer.org_id, item.product_id, transfer.to_warehouse_id, 'transfer_in',
         counted, coalesce(counted_pieces, 0),
         'stock_transfer', transfer.id, auth.uid());

      -- The batches land at the far warehouse still carrying their own
      -- expiry dates. Filled oldest first, so a short delivery is short
      -- of the newest stock rather than of whatever the loop reached
      -- last.
      left_to_place := counted;
      for batch in
        select value from jsonb_array_elements(coalesce(item.batches_sent, '[]'::jsonb))
      loop
        exit when left_to_place <= 0;
        place := least((batch ->> 'quantity')::integer, left_to_place);

        insert into public.product_batches (
          org_id, product_id, warehouse_id, batch_number,
          manufactured_on, expires_on, qty_received, qty_remaining, received_by
        ) values (
          transfer.org_id, item.product_id, transfer.to_warehouse_id,
          batch ->> 'batch_number',
          (batch ->> 'manufactured_on')::date,
          (batch ->> 'expires_on')::date,
          place, place, auth.uid()
        )
        on conflict (org_id, product_id, warehouse_id, batch_number) do update
          set qty_received  = public.product_batches.qty_received  + excluded.qty_received,
              qty_remaining = public.product_batches.qty_remaining + excluded.qty_remaining,
              updated_at    = now();

        left_to_place := left_to_place - place;
      end loop;
    end if;
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(),
         received_at = now(), updated_at = now()
   where id = p_transfer_id
  returning * into transfer;

  return transfer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_stock_return(p_warehouse_id uuid, p_reason return_reason, p_lines jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_supplier_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS stock_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  org       uuid;
  entry     public.stock_returns;
  line      jsonb;
  quantity  integer;
  pieces    integer;
  product   uuid;
  available integer;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if (p_customer_id is null) = (p_supplier_id is null) then
    raise exception 'A return is either from a customer or to a supplier, not both';
  end if;

  select org_id into org from public.warehouses where id = p_warehouse_id;
  if org is null then
    raise exception 'Warehouse % not found', p_warehouse_id;
  end if;

  if auth.uid() is not null and org is distinct from public.auth_org_id() then
    raise exception 'Warehouse % not found', p_warehouse_id using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A return needs at least one line';
  end if;

  insert into public.stock_returns
    (org_id, customer_id, supplier_id, warehouse_id, reason, notes, created_by)
  values
    (org, p_customer_id, p_supplier_id, p_warehouse_id, p_reason,
     nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into entry;

  for line in select * from jsonb_array_elements(p_lines) loop
    product  := (line ->> 'product_id')::uuid;
    quantity := coalesce((line ->> 'quantity')::integer, 0);
    pieces   := coalesce((line ->> 'pieces')::integer, 0);

    -- Either half may be zero; a line that returns nothing may not be.
    -- A customer bringing back three singles is a return.
    if product is null or quantity < 0 or pieces < 0
       or (quantity = 0 and pieces = 0) then
      raise exception 'Every line needs a product and a quantity above zero';
    end if;

    insert into public.stock_return_items
      (org_id, return_id, product_id, quantity, pieces, notes)
    values (org, entry.id, product, quantity, pieces, nullif(trim(line ->> 'notes'), ''));

    if p_customer_id is not null then
      -- Goods coming back in. Damaged or expired stock is booked in and
      -- then written off separately, so the return and the write-off are
      -- two facts rather than one entry that hides the first.
      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, pieces,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'customer_return', quantity, pieces,
         'stock_return', entry.id, p_reason::text, auth.uid());
    else
      -- Going back to the supplier, so it has to be there to send.
      select coalesce(qty_available, 0) into available
        from public.inventory
       where product_id = product and warehouse_id = p_warehouse_id;

      if coalesce(available, 0) < quantity then
        raise exception
          'Cannot return % of that line to the supplier: only % on hand',
          quantity, coalesce(available, 0);
      end if;

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, pieces,
         reference_type, reference_id, reason, created_by)
      values
        (org, product, p_warehouse_id, 'supplier_return', quantity, pieces,
         'stock_return', entry.id, p_reason::text, auth.uid());
    end if;
  end loop;

  return entry;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_order_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        (product_id, warehouse_id, type, quantity, pieces,
         reference_type, reference_id, created_by)
      values
        (item.product_id, new.warehouse_id, 'issue',
         item.quantity, coalesce(item.pieces, 0),
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
$function$
;

CREATE OR REPLACE FUNCTION public.receive_purchase_line(p_item_id uuid, p_quantity integer, p_pieces integer DEFAULT 0)
 RETURNS purchase_order_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  item public.purchase_order_items;
  po   public.purchase_orders;
  outstanding integer;
begin
  -- Either half may be zero; a receipt of nothing may not be. A
  -- delivery of six loose singles is a receipt.
  if p_quantity < 0 or coalesce(p_pieces, 0) < 0
     or (p_quantity = 0 and coalesce(p_pieces, 0) = 0) then
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

  if coalesce(item.qty_received_pieces, 0) + coalesce(p_pieces, 0)
     > coalesce(item.pieces, 0) then
    raise exception 'Cannot receive % loose pieces: only % outstanding on this line',
      p_pieces, coalesce(item.pieces, 0) - coalesce(item.qty_received_pieces, 0);
  end if;

  insert into public.stock_movements
    (product_id, warehouse_id, type, quantity, pieces, unit_cost,
     reference_type, reference_id, created_by)
  values
    (item.product_id, po.warehouse_id, 'receipt',
     p_quantity, coalesce(p_pieces, 0), item.unit_cost,
     'purchase_order', po.id, auth.uid());

  update public.purchase_order_items
  set qty_received = qty_received + p_quantity,
      qty_received_pieces = coalesce(qty_received_pieces, 0) + coalesce(p_pieces, 0)
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
$function$
;
