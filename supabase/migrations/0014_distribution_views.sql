-- =====================================================================
-- 0014_distribution_views.sql
-- Read models for van operations and customer credit.
-- All use security_invoker so RLS and category scopes still apply.
-- =====================================================================

-- Running customer statement from the credit ledger.
create view public.customer_statement
with (security_invoker = on) as
  select
    ct.org_id,
    ct.customer_id,
    c.code   as customer_code,
    c.name   as customer_name,
    ct.id    as transaction_id,
    ct.occurred_at,
    ct.type,
    ct.amount,
    ct.due_date,
    ct.reference_type,
    ct.reference_id,
    ct.notes,
    sum(ct.amount) over (
      partition by ct.customer_id
      order by ct.occurred_at, ct.id
      rows between unbounded preceding and current row
    ) as running_balance
  from public.credit_transactions ct
  join public.customers c on c.id = ct.customer_id;

-- Live credit position per customer, combining invoices and van credit.
create view public.customer_credit_position
with (security_invoker = on) as
  select
    c.org_id,
    c.id as customer_id,
    c.code,
    c.name,
    c.credit_limit,
    c.payment_terms_days,
    coalesce(ct.balance, 0) as ledger_balance,
    greatest(c.credit_limit - coalesce(ct.balance, 0), 0) as credit_available,
    coalesce(ct.balance, 0) > c.credit_limit as over_limit,
    ct.oldest_due,
    case
      when ct.oldest_due is null then null
      else current_date - ct.oldest_due
    end as days_past_due
  from public.customers c
  left join (
    select customer_id,
           sum(amount) as balance,
           min(due_date) filter (where type = 'charge' and due_date < current_date) as oldest_due
    from public.credit_transactions
    group by customer_id
  ) ct on ct.customer_id = c.id;

-- What each van is currently carrying, valued at cost.
create view public.van_stock_summary
with (security_invoker = on) as
  select
    vi.org_id,
    vi.van_id,
    v.code as van_code,
    v.registration_no,
    vi.product_id,
    p.sku,
    p.name as product_name,
    vi.qty_on_hand,
    p.cost_price,
    vi.qty_on_hand * p.cost_price as stock_value
  from public.van_inventory vi
  join public.vans v on v.id = vi.van_id
  join public.products p on p.id = vi.product_id
  where vi.qty_on_hand <> 0;

-- One row per trip: what went out, what sold, what came back.
create view public.van_load_summary
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
    coalesce(li.items, 0)          as line_count,
    coalesce(li.loaded_value, 0)   as loaded_value,
    coalesce(s.cash_sales, 0)      as cash_sales,
    coalesce(s.credit_sales, 0)    as credit_sales,
    coalesce(s.sale_count, 0)      as sale_count,
    r.cash_variance,
    r.stock_variance,
    r.status as reconciliation_status
  from public.van_loads l
  join public.vans v on v.id = l.van_id
  join public.profiles pr on pr.id = l.driver_id
  left join (
    select load_id, count(*) as items, sum(qty_loaded * unit_cost) as loaded_value
    from public.van_load_items group by load_id
  ) li on li.load_id = l.id
  left join (
    select load_id,
           count(*) as sale_count,
           sum(total) filter (where sale_type = 'cash')   as cash_sales,
           sum(total) filter (where sale_type = 'credit') as credit_sales
    from public.van_sales where status = 'completed' group by load_id
  ) s on s.load_id = l.id
  left join public.van_reconciliations r on r.load_id = l.id;

-- Variances awaiting a manager decision.
create view public.reconciliation_variances
with (security_invoker = on) as
  select
    r.org_id,
    r.id,
    r.recon_number,
    r.status,
    v.code as van_code,
    p.full_name as driver_name,
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
    r.submitted_at
  from public.van_reconciliations r
  join public.vans v on v.id = r.van_id
  join public.profiles p on p.id = r.driver_id
  where r.cash_variance <> 0 or r.stock_variance <> 0;
