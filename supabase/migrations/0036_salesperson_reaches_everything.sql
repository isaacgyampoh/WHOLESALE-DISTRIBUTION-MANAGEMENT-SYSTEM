-- ===================================================================
-- 0036  The salesperson role reaches what it needs to
-- ===================================================================
--
-- Adding a role to the enum does not add it to the role lists already
-- written into functions. Five of them still name 'driver' and
-- 'sales_rep' and do not know the salesperson exists, so the person who
-- actually sells was refused by the very functions selling depends on.
--
-- Found by walking a whole round rather than by testing one rule at a
-- time: every unit-level test passed, because each used the old roles.
-- The break only appeared when a salesperson tried to complete a credit
-- sale and the invoice trigger refused them.
--
-- What was broken:
--
--   issue_invoice_for_sale   a credit sale by a salesperson failed at
--                            the invoice trigger. Credit selling did
--                            not work at all.
--   sync_submit              an offline sale could not be uploaded.
--   sync_bootstrap           the device could not fetch its snapshot,
--                            so offline selling never started.
--   record_credit_payment    a salesperson could not take a collection.
--   can_access_product       a salesperson was not scoped to their van
--                            and saw the whole catalogue instead.
--
-- The last one is the reason this is worth stating carefully. It is not
-- a cost leak - cost is withheld by column grants regardless - but a
-- salesperson could see products that were never on their van, and would
-- have been offered lines they could not sell.

-- ------------------------------------------------------------------
-- What a person may see in the catalogue
-- ------------------------------------------------------------------
create or replace function public.can_access_product(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.has_role('admin', 'senior_manager') then true
    when public.has_role('manager') then exists (
      select 1 from public.manager_category_scopes s
      join public.products p on p.category_id = s.category_id
      where p.id = target and s.profile_id = auth.uid()
    )
    -- Anyone crewed on a van sees what is on that van, whichever job
    -- they do. A salesperson needs it to sell; a driver needs it to
    -- know what they are carrying.
    when public.has_role('driver', 'salesperson') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    )
    when public.auth_role() is null then false
    else true
  end
$$;

comment on function public.can_access_product is
  'Whether this caller may see this product. Van crew are scoped to '
  'what is on their van - an empty van is not an empty catalogue, and '
  'the screens say so.';

-- ------------------------------------------------------------------
-- Raising the invoice for a credit sale
-- ------------------------------------------------------------------
--
-- Reproduced from 0026 with 'salesperson' added and nothing else
-- changed. This is the one that broke credit selling outright.
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
    'admin', 'senior_manager', 'manager', 'accountant',
    'sales_rep', 'salesperson', 'driver');

  select * into sale from public.van_sales where id = p_sale_id;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  if auth.uid() is not null and sale.org_id is distinct from public.auth_org_id() then
    raise exception 'Sale % not found', p_sale_id using errcode = '42501';
  end if;

  if sale.sale_type <> 'credit' then
    return null;
  end if;

  select * into inv from public.invoices where van_sale_id = p_sale_id;
  if found then
    return inv;
  end if;

  select * into cust from public.customers where id = sale.customer_id;
  terms := coalesce(cust.payment_terms_days, 0);

  -- Raised for the whole value, with the deposit written as a payment
  -- below rather than into amount_paid: that column is recalculated
  -- from the payments table, so a figure put straight into it survives
  -- only until the first collection.
  insert into public.invoices (
    org_id, van_sale_id, customer_id, status,
    issue_date, due_date,
    subtotal, tax_total, total, created_by
  ) values (
    sale.org_id, sale.id, sale.customer_id, 'issued',
    sale.sold_at::date,
    coalesce(sale.due_date, sale.sold_at::date + terms),
    sale.subtotal, sale.tax_total, sale.total,
    -- Whoever sold it. Before the crew model this was the driver,
    -- because there was nobody else to name.
    coalesce(sale.salesperson_id, sale.driver_id)
  )
  returning * into inv;
  inv_id := inv.id;

  if sale.amount_paid > 0 then
    insert into public.payments (org_id, invoice_id, amount, method, reference, received_by, paid_at)
    select sale.org_id, inv_id, sp.amount, sp.method, sp.reference,
           coalesce(sale.salesperson_id, sale.driver_id), sale.sold_at
      from public.van_sale_payments sp
     where sp.sale_id = sale.id;

    if not found then
      insert into public.payments (org_id, invoice_id, amount, method, received_by, paid_at)
      values (sale.org_id, inv_id, sale.amount_paid, 'cash',
              coalesce(sale.salesperson_id, sale.driver_id), sale.sold_at);
    end if;

    select * into inv from public.invoices where id = inv_id;
  end if;

  return inv;
end;
$$;

revoke all on function public.issue_invoice_for_sale(uuid) from public, anon;
grant execute on function public.issue_invoice_for_sale(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Taking a collection
-- ------------------------------------------------------------------
--
-- Only the role list changes. The allocation logic is untouched.
do $collections$
declare
  body text;
begin
  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_credit_payment'
   limit 1;

  if body is null then
    raise exception 'record_credit_payment is missing; run UPGRADE_0026 first';
  end if;

  -- Idempotent: if the role is already there this rewrites the function
  -- with an identical body.
  body := replace(
    body,
    $old$'admin', 'senior_manager', 'manager', 'accountant', 'driver'$old$,
    $new$'admin', 'senior_manager', 'manager', 'accountant', 'salesperson', 'driver'$new$);

  execute body;
end
$collections$;

-- ------------------------------------------------------------------
-- Offline sync
-- ------------------------------------------------------------------
--
-- Both of these are long functions whose logic is settled. Only the
-- role list is wrong, so it is rewritten in place rather than the whole
-- body being reproduced here - a copy would be one more place for the
-- two to drift apart.
do $sync$
declare
  target text;
  body   text;
begin
  foreach target in array array['sync_submit', 'sync_bootstrap']
  loop
    select pg_get_functiondef(p.oid) into body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = target
     limit 1;

    if body is null then
      raise notice '% is not on this database; skipping', target;
      continue;
    end if;

    body := replace(
      body,
      $old$'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'driver'$old$,
      $new$'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver'$new$);

    execute body;
  end loop;
end
$sync$;

-- ------------------------------------------------------------------
-- Nothing else should still be unaware of the role
-- ------------------------------------------------------------------
--
-- Fails the migration rather than leaving another one to be found in
-- the field. If this raises, the named function has a role list that
-- mentions the field roles and not the salesperson.
do $audit$
declare
  offender text;
begin
  select string_agg(p.proname, ', ') into offender
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname not in ('has_role', 'require_role')
     and pg_get_function_identity_arguments(p.oid) not like '%aggregate%'
     -- The whole call has to be captured, not its alternation groups:
     -- regexp_matches returns capture groups when there are any, so a
     -- pattern that groups only the function name would never see the
     -- role list it is meant to be checking.
     and exists (
       select 1 from regexp_matches(
         pg_get_functiondef(p.oid),
         '((?:require_role|has_role)\([^)]*''(?:driver|sales_rep)''[^)]*\))', 'g') as m(x)
       where m.x[1] not like '%salesperson%'
     );

  if offender is not null then
    raise exception
      'These functions still do not know about the salesperson role: %. '
      'Add it, or this role will be refused somewhere in the field.', offender;
  end if;
end
$audit$;
