-- =====================================================================
-- 0006_views.sql
-- Read models for the dashboard and operational screens.
-- security_invoker = on so the querying user's RLS policies still apply.
-- =====================================================================

-- Receivables per customer, for credit checks and the ageing widget.
create view public.customer_balances
with (security_invoker = on) as
  select
    c.id                                            as customer_id,
    c.code,
    c.name,
    c.credit_limit,
    coalesce(sum(i.balance), 0)                     as outstanding,
    greatest(c.credit_limit - coalesce(sum(i.balance), 0), 0) as credit_available,
    count(i.id) filter (where i.status = 'overdue')  as overdue_invoices
  from public.customers c
  left join public.invoices i
    on i.customer_id = c.id
   and i.status in ('issued', 'partially_paid', 'overdue')
  group by c.id, c.code, c.name, c.credit_limit;

-- Stock across all warehouses with a reorder flag for the buyer's queue.
create view public.stock_summary
with (security_invoker = on) as
  select
    p.id            as product_id,
    p.sku,
    p.name,
    p.reorder_point,
    p.reorder_qty,
    p.cost_price,
    p.list_price,
    coalesce(sum(inv.qty_on_hand), 0)   as qty_on_hand,
    coalesce(sum(inv.qty_reserved), 0)  as qty_reserved,
    coalesce(sum(inv.qty_available), 0) as qty_available,
    coalesce(sum(inv.qty_on_hand), 0) * p.cost_price as stock_value,
    coalesce(sum(inv.qty_available), 0) <= p.reorder_point as needs_reorder
  from public.products p
  left join public.inventory inv on inv.product_id = p.id
  where p.is_active
  group by p.id, p.sku, p.name, p.reorder_point, p.reorder_qty,
           p.cost_price, p.list_price;

-- Invoice ageing buckets for the finance dashboard.
create view public.invoice_ageing
with (security_invoker = on) as
  select
    i.id,
    i.invoice_number,
    i.customer_id,
    c.name as customer_name,
    i.due_date,
    i.total,
    i.balance,
    current_date - i.due_date as days_overdue,
    case
      when i.balance <= 0                    then 'settled'
      when current_date <= i.due_date        then 'current'
      when current_date - i.due_date <= 30   then '1-30'
      when current_date - i.due_date <= 60   then '31-60'
      when current_date - i.due_date <= 90   then '61-90'
      else '90+'
    end as bucket
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  where i.status <> 'void';

-- Flip issued invoices to overdue. Schedule via pg_cron or call from the app.
create or replace function public.mark_overdue_invoices()
returns integer
language sql
volatile
security definer
set search_path = public
as $$
  with updated as (
    update public.invoices
    set status = 'overdue', updated_at = now()
    where status in ('issued', 'partially_paid')
      and due_date < current_date
      and balance > 0
    returning 1
  )
  select count(*)::integer from updated;
$$;
