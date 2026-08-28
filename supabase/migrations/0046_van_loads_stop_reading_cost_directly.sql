-- ===================================================================
-- 0046  The van loads list stops reading cost directly
-- ===================================================================
--
-- The Van loads page has been showing "Van loads could not be loaded"
-- to everybody, including administrators. The real error, which the
-- screen was hiding behind a friendly sentence:
--
--   permission denied for table van_load_items   (42501)
--
-- van_load_summary is a security_invoker view - it reads with the
-- caller's own privileges, which is what keeps row level security
-- honest - and its body contains
--
--   sum(van_load_items.qty_loaded * van_load_items.unit_cost)
--
-- 0023 withdrew table-level SELECT on the cost-bearing tables and
-- granted the individual columns instead, deliberately leaving
-- unit_cost out: cost is management information and is meant to reach
-- people through a masking function, not through a column grant. A
-- security_invoker view that names an ungranted column is refused in
-- full, so the whole view became unreadable - not merely the cost
-- column, the entire list.
--
-- This is the same shape of fault as 0038, where products_priced asked
-- for a column the caller could not read and the products screen died
-- with it. The lesson holds: a view that runs as its caller may only
-- name columns its caller may read.
--
-- THE FIX
--
-- van_load_value() is definer-rights and does the reading, the way
-- product_cost() already does for a product. The role check is the
-- whole of the control, so it comes first and returns null rather than
-- raising - a masked figure should leave a blank cell, not fail the
-- list it sits in. The view then calls it and never touches unit_cost.
--
-- Cost is no more visible than before: the same roles see it, and
-- everybody else now sees a blank where they previously saw an error
-- page.

create or replace function public.van_load_value(p_load uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Definer rights, so this reads a column the caller cannot. The role
  -- check is therefore the whole of the control and comes first.
  if not public.has_role('admin', 'senior_manager', 'manager', 'accountant', 'warehouse') then
    return null;
  end if;

  -- Still scoped to the caller's own organization: definer rights would
  -- otherwise reach across tenants.
  return (
    select coalesce(sum(i.qty_loaded::numeric * i.unit_cost), 0)
      from public.van_load_items i
      join public.van_loads l on l.id = i.load_id
     where i.load_id = p_load
       and l.org_id = public.auth_org_id()
  );
end;
$$;

comment on function public.van_load_value(uuid) is
  'What a load is worth at cost, for the roles allowed to know. Null '
  'for everybody else. Exists so van_load_summary need not name '
  'unit_cost, which its callers may not read.';

revoke all on function public.van_load_value(uuid) from public, anon;
grant execute on function public.van_load_value(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- The view, no longer naming a column its callers cannot read
-- ------------------------------------------------------------------
--
-- Everything else is the definition as it stood. Only loaded_value
-- changes, and only in where it gets the figure from.
create or replace view public.van_load_summary
with (security_invoker = on) as
  select
    l.org_id,
    l.id as load_id,
    l.load_number,
    l.load_date,
    l.status,
    v.code as van_code,
    pr.full_name as driver_name,
    l.driver_id,
    l.opening_float,
    coalesce(li.items, 0::bigint) as line_count,
    -- Counting rows needs no cost, so the count stays in the view and
    -- only the money goes through the function.
    public.van_load_value(l.id) as loaded_value,
    coalesce(s.cash_sales, 0::numeric) as cash_sales,
    coalesce(s.credit_sales, 0::numeric) as credit_sales,
    coalesce(s.sale_count, 0::bigint) as sale_count,
    r.cash_variance,
    r.stock_variance,
    r.status as reconciliation_status
  from public.van_loads l
    join public.vans v on v.id = l.van_id
    join public.profiles pr on pr.id = l.driver_id
    left join (
      select i.load_id, count(*) as items
        from public.van_load_items i
       group by i.load_id
    ) li on li.load_id = l.id
    left join (
      select vs.load_id,
             count(*) as sale_count,
             sum(vs.total) filter (where vs.sale_type = 'cash') as cash_sales,
             sum(vs.total) filter (where vs.sale_type = 'credit') as credit_sales
        from public.van_sales vs
       where vs.status = 'completed'
       group by vs.load_id
    ) s on s.load_id = l.id
    left join public.van_reconciliations r on r.load_id = l.id;

comment on view public.van_load_summary is
  'One row per van load, for the loads list. Its value at cost comes '
  'from van_load_value() rather than from unit_cost directly: this view '
  'runs as its caller, and its callers are not granted that column.';

grant select on public.van_load_summary to authenticated;
