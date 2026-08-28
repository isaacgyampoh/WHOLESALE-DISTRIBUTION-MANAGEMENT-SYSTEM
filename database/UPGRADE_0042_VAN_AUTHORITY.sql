-- ====================================================================
-- UPGRADE 0042 - a salesperson sells from their own van, and no other
-- ====================================================================
--
-- For a database installed before migration 0042.
-- Run it in the Supabase SQL editor.
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0042_a_salesperson_sells_from_their_own_van.sql
-- Regenerate: node database/build.mjs
--
-- Safe to run twice. Every object is created behind an existence check,
-- so a second run reports success and changes nothing. An enum that
-- already exists is compared against what this script expects and the
-- script stops with both lists if they differ, rather than altering a
-- type other code may already depend on.
--
-- WHAT IT FIXES
--
-- Any account holding sales.create could sell another van's stock.
--
-- The sell screen sends the load it is drawing from. The server checked
-- that the load existed, belonged to this organization and was out on
-- the road - then trusted it. complete_van_sale checked that the caller
-- owned the sale and that the van carried the goods. Between those two,
-- nobody asked whether that salesperson had any business with that van.
--
-- The goods came off a vehicle they were never crewed on, that round
-- reconciled short, and the ledger blamed the wrong van. Row level
-- security did not catch it: the sale is written with the service role,
-- which exists precisely to bypass it.
--
-- This adds one check to complete_van_sale - the seller must be crewed
-- on the van the sale draws from - using is_van_crew, which has
-- answered exactly that question since 0033 and was simply never asked
-- here. A manager or administrator is exempt, because settling somebody
-- else's round is their job.
--
-- Nothing else in the function changes. No table, policy or grant is
-- touched.
--
-- AFTER RUNNING IT, redeploy so the application refuses the same thing
-- with a sentence rather than a raised exception.

-- ===================================================================
-- 0042  A salesperson sells from their own van, and no other
-- ===================================================================
--
-- The crew model arrived in 0033 and answered "who made this sale". It
-- never answered "were they entitled to sell from that van", and
-- nothing else did either.
--
-- WHAT WAS WRONG
--
-- The sell screen sends the load it is drawing from. The server checked
-- that the load existed, belonged to this organization and was out on
-- the road - then trusted it. complete_van_sale checked that the caller
-- owned the sale and that the van carried the goods. Between those two,
-- nobody asked whether this salesperson had any business with that van.
--
-- So any account holding sales.create could sell another van's stock by
-- naming its load. The goods came off a vehicle they were never crewed
-- on, that round reconciled short, and the ledger blamed the wrong van.
-- Row level security did not catch it either: the sale is written with
-- the service role, which exists precisely to bypass it.
--
-- WHAT THIS CHANGES
--
-- One check, in the function that governs. Everything else below is the
-- 0033 body, unchanged.
--
-- It lives in the database rather than only in the action because the
-- action holds the service role - a check that lives only there is a
-- check that one refactor quietly removes.

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
  limit_amount numeric(14,2);
  terms integer;
  owing numeric(14,2);
begin
  select * into sale from public.van_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale % not found', p_sale_id;
  end if;

  -- The person who made the sale, or the office. Note this is the
  -- salesperson now, not the driver: the driver has no business
  -- completing somebody else's sale.
  if sale.salesperson_id <> auth.uid()
     and auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager') then
    raise exception 'Only the salesperson who made this sale or a manager may complete it'
      using errcode = '42501';
  end if;

  -- And the van has to be theirs.
  --
  -- Being the author of the sale is not the same as being entitled to
  -- the stock. The sale names its own van, and until this check that
  -- name was taken on trust: the screen sends the load it is selling
  -- from, the action checked only that the load existed and belonged to
  -- this organization, and row level security never saw the write
  -- because the action holds the service role.
  --
  -- is_van_crew has answered exactly this question since 0033. It was
  -- simply never asked here.
  --
  -- A manager or administrator is exempt: settling somebody else's
  -- round is their job, and that is not a salesperson reaching into a
  -- van that is not theirs.
  if auth.uid() is not null
     and not public.has_role('admin', 'senior_manager', 'manager')
     and not public.is_van_crew(sale.van_id) then
    raise exception 'You are not crewed on the van this sale draws from'
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

comment on function public.complete_van_sale(uuid, numeric) is
  'Complete a van sale: check the seller is crewed on the van, check the '
  'van carries the goods, take the money or raise the credit, and issue '
  'the stock off the van.';

-- ====================================================================
-- Confirm it took. Every row should read PASS.
-- ====================================================================
select 'the seller must be crewed on the van' as check,
       case when position('is_van_crew' in
              coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                          join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'complete_van_sale'
                         limit 1), '')) > 0
            then 'PASS' else 'FAIL' end as result
union all
select 'the office can still settle a round',
       case when position('has_role' in
              coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                          join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'complete_van_sale'
                         limit 1), '')) > 0
            then 'PASS' else 'FAIL' end
union all
select 'the van still has to carry the goods',
       case when position('does not carry enough' in
              coalesce((select pg_get_functiondef(p.oid) from pg_proc p
                          join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'complete_van_sale'
                         limit 1), '')) > 0
            then 'PASS' else 'FAIL' end;
