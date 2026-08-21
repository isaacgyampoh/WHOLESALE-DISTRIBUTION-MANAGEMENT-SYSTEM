-- =====================================================================
-- 0012_distribution_logic.sql
-- Workflow functions and row level security for van operations.
--
-- Every stock effect goes through public.stock_movements, so van stock
-- carries the same audit guarantees as warehouse stock.
-- =====================================================================

-- ---------------------------------------------- org_id backfill triggers
create trigger vans_fill_org before insert on public.vans
  for each row execute function public.fill_org_from_parent();
create trigger van_assignments_fill_org before insert on public.van_assignments
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_inventory_fill_org before insert on public.van_inventory
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_loads_fill_org before insert on public.van_loads
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_load_items_fill_org before insert on public.van_load_items
  for each row execute function public.fill_org_from_parent('load_id', 'van_loads');
create trigger van_sales_fill_org before insert on public.van_sales
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_sale_items_fill_org before insert on public.van_sale_items
  for each row execute function public.fill_org_from_parent('sale_id', 'van_sales');
create trigger van_returns_fill_org before insert on public.van_returns
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger van_return_items_fill_org before insert on public.van_return_items
  for each row execute function public.fill_org_from_parent('return_id', 'van_returns');
create trigger van_reconciliations_fill_org before insert on public.van_reconciliations
  for each row execute function public.fill_org_from_parent('van_id', 'vans');
create trigger credit_transactions_fill_org before insert on public.credit_transactions
  for each row execute function public.fill_org_from_parent('customer_id', 'customers');
create trigger manager_category_scopes_fill_org before insert on public.manager_category_scopes
  for each row execute function public.fill_org_from_parent('profile_id', 'profiles');
create trigger stock_transfers_fill_org before insert on public.stock_transfers
  for each row execute function public.fill_org_from_parent('from_warehouse_id', 'warehouses');
create trigger stock_transfer_items_fill_org before insert on public.stock_transfer_items
  for each row execute function public.fill_org_from_parent('transfer_id', 'stock_transfers');

create trigger van_sales_same_org_customer before insert or update on public.van_sales
  for each row execute function public.assert_same_org('customer_id', 'customers');
create trigger stock_movements_same_org_van before insert on public.stock_movements
  for each row execute function public.assert_same_org('van_id', 'vans');

-- ===================================================================
-- Authorization inside SECURITY DEFINER functions
--
-- These functions run as their owner and therefore bypass row level
-- security entirely. Each one must re-assert who is allowed to call it,
-- or RLS becomes decorative. auth.uid() is null for the SQL editor,
-- service_role and cron, which are trusted server-side contexts.
-- ===================================================================

create or replace function public.require_role(variadic allowed public.user_role[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;  -- trusted server-side context
  end if;
  if not public.has_role(variadic allowed) then
    raise exception 'Permission denied: this action requires one of %', allowed
      using errcode = '42501';
  end if;
end;
$$;

-- ===================================================================
-- Van totals
-- ===================================================================

create or replace function public.recalc_van_sale_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.sale_id, old.sale_id);
begin
  update public.van_sales s
  set subtotal  = coalesce(t.sub, 0),
      tax_total = coalesce(t.tax, 0),
      total     = coalesce(t.sub, 0) + coalesce(t.tax, 0),
      updated_at = now()
  from (
    select sum(line_subtotal) sub, sum(line_total - line_subtotal) tax
    from public.van_sale_items where sale_id = target
  ) t
  where s.id = target;
  return null;
end;
$$;

create trigger van_sale_items_recalc
  after insert or update or delete on public.van_sale_items
  for each row execute function public.recalc_van_sale_totals();

-- ===================================================================
-- Dispatch: warehouse -> van
-- ===================================================================

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

  -- The driver signs for the goods before they leave the yard.
  if load.driver_confirmed_at is null then
    raise exception 'Load % has not been confirmed by the driver', load.load_number;
  end if;

  if not exists (select 1 from public.van_load_items where load_id = p_load_id) then
    raise exception 'Load % has no items', load.load_number;
  end if;

  for item in select * from public.van_load_items where load_id = p_load_id loop
    select coalesce(qty_available, 0) into available
    from public.inventory
    where product_id = item.product_id and warehouse_id = load.warehouse_id;

    if coalesce(available, 0) < item.qty_loaded then
      raise exception 'Insufficient stock for product %: % available, % requested',
        item.product_id, coalesce(available, 0), item.qty_loaded;
    end if;

    -- Out of the warehouse...
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.warehouse_id, 'transfer_out',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());

    -- ...and onto the van.
    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, unit_cost,
       reference_type, reference_id, created_by)
    values
      (load.org_id, item.product_id, load.van_id, 'transfer_in',
       item.qty_loaded, item.unit_cost, 'van_load', load.id, auth.uid());
  end loop;

  update public.van_loads
  set status = 'dispatched', dispatched_at = now(), updated_at = now()
  where id = p_load_id
  returning * into load;

  return load;
end;
$$;

-- ===================================================================
-- Completing a van sale: issue stock, take cash or extend credit
-- ===================================================================

create or replace function public.complete_van_sale(p_sale_id uuid, p_amount_paid numeric default null)
returns public.van_sales
language plpgsql
security definer
set search_path = public
as $$
declare
  sale public.van_sales;
  item record;
  on_van integer;
  owing numeric(14,2);
  limit_amount numeric(14,2);
  terms integer;
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Van sale % not found', p_sale_id;
  end if;

  -- Either the driver who owns the sale, or someone managing them.
  if auth.uid() is not null
     and sale.driver_id <> auth.uid()
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the assigned driver or a manager may complete this sale'
      using errcode = '42501';
  end if;

  if sale.status <> 'draft' then
    raise exception 'Sale % is already %', sale.sale_number, sale.status;
  end if;

  if not exists (select 1 from public.van_sale_items where sale_id = p_sale_id) then
    raise exception 'Sale % has no items', sale.sale_number;
  end if;

  -- Stock must actually be on the van.
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
    -- Cash sales are settled in full at the point of sale.
    if coalesce(p_amount_paid, sale.total) < sale.total then
      raise exception 'Cash sale % requires full payment of %, received %',
        sale.sale_number, sale.total, coalesce(p_amount_paid, 0);
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = p_sale_id;
  else
    -- Credit sales are checked against the customer's remaining credit.
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

  -- Stock leaves the van either way.
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

-- Recording a collection against a customer's credit.
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
  txn public.credit_transactions;
  org uuid;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'accountant', 'driver');

  if p_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select org_id into org from public.customers where id = p_customer_id;
  if org is null then
    raise exception 'Customer % not found', p_customer_id;
  end if;

  insert into public.credit_transactions
    (org_id, customer_id, type, amount, reference_type, created_by, notes)
  values
    (org, p_customer_id, 'payment', -p_amount, p_method::text, auth.uid(),
     coalesce(p_notes, 'Payment received'))
  returning * into txn;

  return txn;
end;
$$;

-- ===================================================================
-- Van return: good stock back to the warehouse, damage and shortage
-- written off against the van.
-- ===================================================================

create or replace function public.approve_van_return(p_return_id uuid)
returns public.van_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  ret public.van_returns;
  item record;
begin
  select * into ret from public.van_returns where id = p_return_id for update;
  if not found then
    raise exception 'Van return % not found', p_return_id;
  end if;

  if ret.status <> 'submitted' then
    raise exception 'Return % must be submitted before approval (currently %)',
      ret.return_number, ret.status;
  end if;

  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  for item in select * from public.van_return_items where return_id = p_return_id loop
    if item.qty_missing < 0 then
      raise exception 'Returned quantity for product % exceeds what was expected',
        item.product_id;
    end if;

    -- Good stock: off the van, back into the warehouse.
    if item.qty_returned_good > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'transfer_out',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());

      insert into public.stock_movements
        (org_id, product_id, warehouse_id, type, quantity, reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.warehouse_id, 'transfer_in',
              item.qty_returned_good, 'van_return', ret.id, auth.uid());
    end if;

    -- Damaged stock leaves the van and is not restocked.
    if item.qty_damaged > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'damage', item.qty_damaged,
              coalesce(item.damage_reason, 'Damaged in transit'),
              'van_return', ret.id, auth.uid());
    end if;

    -- Anything unaccounted for is a shortage against the driver.
    if item.qty_missing > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'shortage', item.qty_missing,
              'Unaccounted for at van return', 'van_return', ret.id, auth.uid());
    end if;
  end loop;

  update public.van_returns
  set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_return_id
  returning * into ret;

  update public.van_loads set status = 'returned', updated_at = now()
  where id = ret.load_id;

  return ret;
end;
$$;

-- ===================================================================
-- Reconciliation
-- ===================================================================

-- Compute what the driver should be handing back, from the ledger.
create or replace function public.build_reconciliation(p_load_id uuid)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  rec  public.van_reconciliations;
  cash numeric(14,2);
  credit numeric(14,2);
  collected numeric(14,2);
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
  into cash, credit, collected
  from public.van_sales
  where load_id = p_load_id and status = 'completed';

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

  -- Stock still on the van after selling, at load cost.
  remaining := loaded_value - sold_value;

  insert into public.van_reconciliations (
    org_id, load_id, van_id, driver_id,
    opening_float, cash_sales_total, credit_sales_total, collections_total,
    expected_cash, expected_stock_value, actual_stock_value,
    damaged_value, missing_value, submitted_by
  )
  values (
    load.org_id, load.id, load.van_id, load.driver_id,
    load.opening_float, cash, credit, collected,
    load.opening_float + cash + collected,
    remaining, remaining - damaged - missing,
    damaged, missing, auth.uid()
  )
  on conflict (load_id) do update
  set cash_sales_total   = excluded.cash_sales_total,
      credit_sales_total = excluded.credit_sales_total,
      collections_total  = excluded.collections_total,
      expected_cash      = excluded.expected_cash,
      expected_stock_value = excluded.expected_stock_value,
      actual_stock_value = excluded.actual_stock_value,
      damaged_value      = excluded.damaged_value,
      missing_value      = excluded.missing_value,
      updated_at         = now()
  returning * into rec;

  return rec;
end;
$$;

create or replace function public.approve_reconciliation(
  p_recon_id uuid,
  p_note text default null
)
returns public.van_reconciliations
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.van_reconciliations;
begin
  select * into rec from public.van_reconciliations where id = p_recon_id for update;
  if not found then
    raise exception 'Reconciliation % not found', p_recon_id;
  end if;

  if rec.status <> 'submitted' then
    raise exception 'Reconciliation % must be submitted before approval (currently %)',
      rec.recon_number, rec.status;
  end if;

  -- Enforced again by a check constraint, but fail with a clear message.
  if rec.driver_id = auth.uid() then
    raise exception 'A driver cannot approve their own reconciliation';
  end if;

  perform public.require_role('admin', 'senior_manager', 'manager');

  update public.van_reconciliations
  set status = 'approved', approved_by = auth.uid(), approved_at = now(),
      explanation = coalesce(p_note, explanation), updated_at = now()
  where id = p_recon_id
  returning * into rec;

  update public.van_loads set status = 'reconciled', updated_at = now()
  where id = rec.load_id;

  return rec;
end;
$$;

-- ===================================================================
-- Authorship stamping
--
-- The driver's read policy on credit_transactions keys off created_by.
-- PostgREST returns the inserted row, so an unstamped row is written
-- successfully and then fails the SELECT check, surfacing as a confusing
-- "violates row-level security policy" error. Stamp it automatically.
-- ===================================================================

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger credit_transactions_stamp_author before insert on public.credit_transactions
  for each row execute function public.stamp_created_by();
create trigger stock_transfers_stamp_author before insert on public.stock_transfers
  for each row execute function public.stamp_created_by();
