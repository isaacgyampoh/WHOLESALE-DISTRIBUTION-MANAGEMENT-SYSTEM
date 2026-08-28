-- ===================================================================
-- 0045  The warehouse dispatches; the driver does not approve
-- ===================================================================
--
-- dispatch_van_load refused any load whose driver had not signed for it:
--
--   if load.driver_confirmed_at is null then
--     raise exception 'Load % has not been confirmed by the driver'
--
-- That is not how this business runs, and it had stopped the whole
-- chain. A load sat at status 'loaded' with driver_confirmed_at null,
-- so dispatch never ran, so no goods ever moved onto a van, so
-- van_inventory was empty and every salesperson opening the sell screen
-- found nothing to sell. The warehouse had done its part and the round
-- could not start.
--
-- The owner's instruction is explicit: the administrator loads the van
-- and assigns the salesperson, the salesperson sells, the driver views.
-- There is no driver approval step.
--
-- So the check goes. driver_confirmed_at is not dropped and nothing that
-- writes it changes - a driver who does sign still records that they
-- did, and the column remains for anyone who wants to know whether they
-- had. It simply no longer gates the goods.
--
-- Everything else in the function is the 0033 body, unchanged: the load
-- must still be 'loaded', still have items, still have somebody crewed
-- to sell from the van, and stock is still checked before it moves.
-- Only who must say yes has changed.

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

  -- The driver's signature is recorded when it happens and no longer
  -- required before the goods can leave. See the header: the business
  -- this serves dispatches on the warehouse's authority, and waiting on
  -- a second approval stopped every round.

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
