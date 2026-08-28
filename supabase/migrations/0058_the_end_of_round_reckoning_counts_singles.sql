-- ===================================================================
-- 0058  The end-of-round reckoning counts the singles
-- ===================================================================
--
-- build_reconciliation is where a round is settled: what went out, what
-- was sold, what came back, and whether the cash and the stock agree.
-- Every figure in it values full units only.
--
-- So a van that went out with loose pieces reconciles wrong in a
-- particular direction: the singles are counted in what was loaded -
-- no, they are not counted anywhere at all. Sold pieces are not
-- subtracted, damaged and missing pieces are worth nothing, and the
-- expected stock value comes out overstating what should be on board.
-- The salesperson is then short against a figure that was never right,
-- which is the worst way to be accused of something.
--
-- Each sum now carries the loose half at its share of the unit cost -
-- the same rule van_load_value and stock_summary already use, and the
-- one place the two quantities legitimately combine. A piece really is
-- a twelfth of a carton in cost terms; it is only in selling that the
-- two differ, which is what piece_price is for.
--
-- The joins to products are new and are what makes the pack size
-- reachable. Everything else is the deployed body unchanged.

CREATE OR REPLACE FUNCTION public.build_reconciliation(p_load_id uuid)
 RETURNS van_reconciliations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Each figure carries the loose half at its share of the unit cost.
  -- A piece is genuinely a twelfth of a carton in cost terms - cost has
  -- no margin in it to distort - which is the same rule van_load_value
  -- and stock_summary use.
  select coalesce(sum(
           i.qty_loaded * i.unit_cost
           + case when coalesce(p.units_per_case, 1) > 1
                  then coalesce(i.qty_loaded_pieces, 0) * i.unit_cost / p.units_per_case
                  else 0 end), 0)
    into loaded_value
  from public.van_load_items i
  join public.products p on p.id = i.product_id
  where i.load_id = p_load_id;

  select coalesce(sum(
           vsi.quantity * vli.unit_cost
           + case when coalesce(p.units_per_case, 1) > 1
                  then coalesce(vsi.pieces, 0) * vli.unit_cost / p.units_per_case
                  else 0 end), 0)
    into sold_value
  from public.van_sale_items vsi
  join public.van_sales vs on vs.id = vsi.sale_id
  join public.van_load_items vli
    on vli.load_id = vs.load_id and vli.product_id = vsi.product_id
  join public.products p on p.id = vsi.product_id
  where vs.load_id = p_load_id and vs.status = 'completed';

  select
    coalesce(sum(
      vri.qty_damaged * vli.unit_cost
      + case when coalesce(p.units_per_case, 1) > 1
             then coalesce(vri.qty_damaged_pieces, 0) * vli.unit_cost / p.units_per_case
             else 0 end), 0),
    coalesce(sum(
      vri.qty_missing * vli.unit_cost
      + case when coalesce(p.units_per_case, 1) > 1
             then coalesce(vri.qty_missing_pieces, 0) * vli.unit_cost / p.units_per_case
             else 0 end), 0)
  into damaged, missing
  from public.van_return_items vri
  join public.van_returns vr on vr.id = vri.return_id
  join public.van_load_items vli
    on vli.load_id = vr.load_id and vli.product_id = vri.product_id
  join public.products p on p.id = vri.product_id
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
$function$
;
