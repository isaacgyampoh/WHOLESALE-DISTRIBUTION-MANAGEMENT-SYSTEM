-- =====================================================================
-- 0015_data_api_grants.sql
--
-- Two hosted-platform problems that local PostgreSQL testing did not
-- expose, fixed together because they are two halves of the same gap:
-- who may reach these objects through the Data API.
--
-- 1. GRANTS
--    Supabase's current cloud default does not auto-expose new entities
--    to the Data API roles. Migrations 0001-0014 issue no GRANT, so on a
--    new project every PostgREST request fails with "permission denied
--    for table ..." before RLS is ever consulted.
--
-- 2. ANONYMOUS AUTHORIZATION BYPASS  (security fix)
--    require_role() treated a null auth.uid() as a trusted server-side
--    context. That is true for the SQL editor and service_role, but an
--    ANONYMOUS PostgREST caller also has a null auth.uid(). Combined
--    with PostgreSQL granting EXECUTE to PUBLIC by default, a holder of
--    the public anon key could call dispatch_van_load,
--    approve_reconciliation, approve_van_return and
--    record_credit_payment. Those functions are SECURITY DEFINER, so
--    they bypass row level security and would have operated on any
--    organization's data.
--
--    Trust is now decided by the database role in effect, not by the
--    absence of a user.
-- =====================================================================

-- ------------------------------------------------- trusted context
create or replace function public.is_trusted_context()
returns boolean
language sql
stable
as $$
  -- current_user cannot be used here: inside a SECURITY DEFINER function
  -- it is the function's owner, not the caller, so it would report every
  -- caller as trusted. session_user is not rewritten by SECURITY DEFINER
  -- or by SET ROLE, and the JWT role claim is what PostgREST switches on.
  select case
    -- A Data API request. Trust only the service role.
    when nullif(current_setting('request.jwt.claims', true), '') is not null then
      (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
    -- No claims: a direct database connection - SQL editor, psql, cron.
    -- PostgREST connects as 'authenticator' even when it presents no JWT,
    -- so that role is still refused here.
    else session_user not in ('authenticator', 'anon', 'authenticated')
  end
$$;

comment on function public.is_trusted_context is
  'True only for server-side roles. Never true for anon or authenticated.';

create or replace function public.require_role(variadic allowed public.user_role[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_trusted_context() then
    return;
  end if;

  -- An anonymous caller has no uid; it must not be mistaken for a
  -- trusted server-side context.
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_role(variadic allowed) then
    raise exception 'Permission denied: this action requires one of %', allowed
      using errcode = '42501';
  end if;
end;
$$;

-- The profile guards carried the same assumption.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context()
     and (new.role is distinct from old.role
          or new.is_active is distinct from old.is_active)
     and not public.has_role('admin') then
    raise exception 'Only an administrator may change a user role or status'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_org_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trusted_context() and new.org_id is distinct from old.org_id then
    raise exception 'Organization cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- complete_van_sale checks ownership inline rather than via require_role.
create or replace function public.complete_van_sale(
  p_sale_id uuid,
  p_amount_paid numeric default null
)
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
  if not public.is_trusted_context() and auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Van sale % not found', p_sale_id;
  end if;

  -- Either the driver who owns the sale, or someone managing them.
  if not public.is_trusted_context()
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
    if coalesce(p_amount_paid, sale.total) < sale.total then
      raise exception 'Cash sale % requires full payment of %, received %',
        sale.sale_number, sale.total, coalesce(p_amount_paid, 0);
    end if;
    update public.van_sales
    set amount_paid = sale.total, status = 'completed', updated_at = now()
    where id = p_sale_id;
  else
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

-- ===================================================================
-- Data API grants
--
-- anon receives nothing: this application has no public surface, so an
-- unauthenticated caller should not be able to read or call anything.
-- authenticated receives table access and RLS decides the rows.
-- ===================================================================

grant usage on schema public to authenticated, service_role;
revoke all on schema public from anon;

grant select, insert, update, delete on all tables in schema public
  to authenticated;
grant all on all tables in schema public to service_role;

-- Document-number defaults call nextval as the inserting role.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- The stock ledger is append-only. A trigger already refuses these, but
-- withholding the privilege means the attempt fails before it is tried.
revoke update, delete on public.stock_movements from authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC. Withdraw that for
-- our own functions (extension-owned functions are left alone, since
-- citext and pgcrypto operators must stay callable) and re-grant only to
-- signed-in roles.
do $grants$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid
          and d.deptype = 'e'          -- owned by an extension
      )
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
  end loop;
end
$grants$;

-- Anything created by later migrations inherits the same treatment.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;

-- ===================================================================
-- Authorize before looking up
--
-- Both approval functions read the record first and raise "not found"
-- before checking the caller's role. That lets an authenticated user
-- without approval rights probe which reconciliation and return ids
-- exist. The privilege check moves to the top.
-- ===================================================================

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
  perform public.require_role('admin', 'senior_manager', 'manager');

  select * into rec from public.van_reconciliations where id = p_recon_id for update;
  if not found then
    raise exception 'Reconciliation % not found', p_recon_id;
  end if;

  if rec.status <> 'submitted' then
    raise exception 'Reconciliation % must be submitted before approval (currently %)',
      rec.recon_number, rec.status;
  end if;

  -- Also enforced by a check constraint; this gives a clearer message.
  if rec.driver_id = auth.uid() then
    raise exception 'A driver cannot approve their own reconciliation'
      using errcode = '42501';
  end if;

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
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into ret from public.van_returns where id = p_return_id for update;
  if not found then
    raise exception 'Van return % not found', p_return_id;
  end if;

  if ret.status <> 'submitted' then
    raise exception 'Return % must be submitted before approval (currently %)',
      ret.return_number, ret.status;
  end if;

  for item in select * from public.van_return_items where return_id = p_return_id loop
    if item.qty_missing < 0 then
      raise exception 'Returned quantity for product % exceeds what was expected',
        item.product_id;
    end if;

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

    if item.qty_damaged > 0 then
      insert into public.stock_movements
        (org_id, product_id, van_id, type, quantity, reason,
         reference_type, reference_id, created_by)
      values (ret.org_id, item.product_id, ret.van_id, 'damage', item.qty_damaged,
              coalesce(item.damage_reason, 'Damaged in transit'),
              'van_return', ret.id, auth.uid());
    end if;

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

-- The redefinitions above are new function bodies, so they arrive with
-- PUBLIC execute again. Withdraw it once more.
do $regrant$
declare
  fn text;
begin
  foreach fn in array array[
    'public.approve_reconciliation(uuid, text)',
    'public.approve_van_return(uuid)',
    'public.complete_van_sale(uuid, numeric)',
    'public.require_role(public.user_role[])',
    'public.is_trusted_context()',
    'public.guard_role_change()',
    'public.guard_org_change()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end
$regrant$;
