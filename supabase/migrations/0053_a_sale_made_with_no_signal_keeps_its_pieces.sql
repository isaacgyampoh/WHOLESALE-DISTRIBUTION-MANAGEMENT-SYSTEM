-- ===================================================================
-- 0053  A sale made with no signal keeps its loose pieces
-- ===================================================================
--
-- sync_submit is the other way a sale reaches this database. The till
-- queues it on the phone when there is no signal and replays it here
-- later, and it writes van_sale_items and van_return_items directly
-- rather than going back through the server action.
--
-- So it needed the same change 0051 made everywhere else, and until it
-- has it, an offline sale is the worst kind of wrong:
--
--   the singles are handed to the customer
--   the line is written with pieces defaulting to 0
--   line_total counts only the cartons, so the money is never asked for
--   complete_van_sale takes no pieces off the van
--
-- and nothing fails. The van comes back short at reconciliation with no
-- record of where the stock went, which is precisely the hole this
-- whole piece of work exists to close.
--
-- The body below is the deployed function with three changes and
-- nothing else: somewhere to hold the loose half of what is on board,
-- the sale line, and the return line. Every other branch - collections,
-- reconciliations, the replay guard that makes this idempotent - is
-- untouched.
--
-- coalesce throughout, so a payload from a phone that has not been
-- reloaded since before this deploy still applies exactly as it did.

CREATE OR REPLACE FUNCTION public.sync_submit(p_id uuid, p_device_id text, p_operation sync_operation, p_payload jsonb, p_occurred_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  existing   public.sync_operations;
  actor      uuid := auth.uid();
  org        uuid;
  outcome    jsonb;
  line       jsonb;
  v_avail_pieces integer;
  sale       public.van_sales;
  ret        public.van_returns;
  recon      public.van_reconciliations;
  load_row   public.van_loads;
  v_customer uuid;
  v_van      uuid;
  v_avail    integer;
begin
  -- Authorization is re-derived here, from the session doing the
  -- syncing. Anything the payload says about who the driver is or what
  -- they may do is ignored.
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver');

  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  if org is null then
    raise exception 'No profile for the calling user' using errcode = '42501';
  end if;

  -- Already seen? Hand back exactly what happened the first time. This
  -- is the whole point: a retry is free and cannot double-apply.
  select * into existing from public.sync_operations where id = p_id;
  if found then
    -- A key belonging to somebody else is not a replay, it is a
    -- collision or an attack. Say nothing about the original.
    if existing.profile_id <> actor then
      raise exception 'Operation % is not yours', p_id using errcode = '42501';
    end if;
    return jsonb_build_object(
      'id', existing.id,
      'status', existing.status,
      'result', existing.result,
      'error', existing.error,
      'replayed', true
    );
  end if;

  begin
    case p_operation

      -- ---------------------------------------------------------- sale
      when 'van_sale' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;

        if load_row.id is null then
          raise exception 'That load no longer exists';
        end if;
        if load_row.org_id <> org then
          raise exception 'That load belongs to another organization';
        end if;
        if load_row.status not in ('dispatched', 'loaded') then
          raise exception 'Load % is % and cannot take further sales',
            load_row.load_number, load_row.status;
        end if;
        if not exists (select 1 from public.customers
                        where id = v_customer and org_id = org and is_active) then
          raise exception 'That customer is no longer active';
        end if;

        v_van := load_row.van_id;

        insert into public.van_sales (
          org_id, load_id, van_id, driver_id, customer_id,
          sale_type, status, sold_at, due_date, notes,
          latitude, longitude
        ) values (
          org, load_row.id, v_van, load_row.driver_id, v_customer,
          (p_payload ->> 'sale_type')::public.van_sale_type, 'draft',
          p_occurred_at,
          nullif(p_payload ->> 'due_date', '')::date,
          nullif(p_payload ->> 'notes', ''),
          nullif(p_payload ->> 'latitude', '')::numeric,
          nullif(p_payload ->> 'longitude', '')::numeric
        ) returning * into sale;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          -- The van must actually be carrying it. A sale made offline
          -- against stock that was never on board is a conflict, not a
          -- sale, and it is caught here rather than going through.
          select qty_on_hand, coalesce(qty_pieces, 0)
            into v_avail, v_avail_pieces
            from public.van_inventory
           where van_id = v_van and product_id = (line ->> 'product_id')::uuid;

          if coalesce(v_avail, 0) < coalesce((line ->> 'quantity')::integer, 0) then
            raise exception 'Only % of that product on the van, % were sold',
              coalesce(v_avail, 0), (line ->> 'quantity')::integer;
          end if;

          -- The loose half, judged on its own. A sealed carton on the
          -- van does not cover singles sold off it: opening one is a
          -- recorded act and it happens at the depot, not here.
          if coalesce(v_avail_pieces, 0) < coalesce((line ->> 'pieces')::integer, 0) then
            raise exception
              'Only % loose pieces of that product on the van, % were sold',
              coalesce(v_avail_pieces, 0), (line ->> 'pieces')::integer;
          end if;

          insert into public.van_sale_items (
            org_id, sale_id, product_id, quantity, pieces,
            unit_price, piece_price, discount_pct, tax_rate
          ) values (
            org, sale.id, (line ->> 'product_id')::uuid,
            coalesce((line ->> 'quantity')::integer, 0),
            coalesce((line ->> 'pieces')::integer, 0),
            (line ->> 'unit_price')::numeric,
            coalesce((line ->> 'piece_price')::numeric, 0),
            coalesce((line ->> 'discount_pct')::numeric, 0),
            coalesce((line ->> 'tax_rate')::numeric, 0)
          );
        end loop;

        -- The existing business function moves the stock and puts a
        -- credit sale on the customer ledger. None of that is
        -- reimplemented here.
        sale := public.complete_van_sale(
          sale.id, nullif(p_payload ->> 'amount_paid', '')::numeric);

        outcome := jsonb_build_object(
          'sale_id', sale.id, 'sale_number', sale.sale_number,
          'total', sale.total, 'balance', sale.balance);

      -- ---------------------------------------------------- collection
      when 'collection' then
        v_customer := (p_payload ->> 'customer_id')::uuid;
        if not exists (select 1 from public.customers where id = v_customer and org_id = org) then
          raise exception 'That customer no longer exists';
        end if;

        perform public.record_credit_payment(
          v_customer,
          (p_payload ->> 'amount')::numeric,
          coalesce((p_payload ->> 'method')::public.payment_method, 'cash'),
          nullif(p_payload ->> 'notes', ''));

        outcome := jsonb_build_object(
          'customer_id', v_customer, 'amount', (p_payload ->> 'amount')::numeric);

      -- -------------------------------------------------------- return
      when 'van_return' then
        select * into load_row from public.van_loads
         where id = (p_payload ->> 'load_id')::uuid;
        if load_row.id is null or load_row.org_id <> org then
          raise exception 'That load no longer exists';
        end if;

        insert into public.van_returns (
          org_id, load_id, van_id, driver_id, warehouse_id,
          status, returned_at, notes
        ) values (
          org, load_row.id, load_row.van_id, load_row.driver_id,
          load_row.warehouse_id, 'draft', p_occurred_at,
          nullif(p_payload ->> 'notes', '')
        ) returning * into ret;

        for line in select * from jsonb_array_elements(p_payload -> 'lines') loop
          insert into public.van_return_items (
            org_id, return_id, product_id,
            qty_expected, qty_returned_good, qty_damaged,
            qty_expected_pieces, qty_returned_good_pieces, qty_damaged_pieces,
            damage_reason
          ) values (
            org, ret.id, (line ->> 'product_id')::uuid,
            (line ->> 'qty_expected')::integer,
            (line ->> 'qty_returned_good')::integer,
            coalesce((line ->> 'qty_damaged')::integer, 0),
            coalesce((line ->> 'qty_expected_pieces')::integer, 0),
            coalesce((line ->> 'qty_returned_good_pieces')::integer, 0),
            coalesce((line ->> 'qty_damaged_pieces')::integer, 0),
            nullif(line ->> 'damage_reason', '')
          );
        end loop;

        update public.van_returns set status = 'submitted' where id = ret.id;

        outcome := jsonb_build_object(
          'return_id', ret.id, 'return_number', ret.return_number);

      -- ------------------------------------------------ reconciliation
      when 'reconciliation' then
        select * into recon from public.van_reconciliations
         where id = (p_payload ->> 'reconciliation_id')::uuid;

        if recon.id is null then
          recon := public.build_reconciliation((p_payload ->> 'load_id')::uuid);
        end if;
        if recon.org_id <> org then
          raise exception 'That reconciliation belongs to another organization';
        end if;
        if recon.status <> 'draft' then
          raise exception 'Reconciliation % has already been submitted', recon.recon_number;
        end if;

        update public.van_reconciliations set
          status        = 'submitted',
          actual_cash   = (p_payload ->> 'actual_cash')::numeric,
          explanation   = nullif(p_payload ->> 'explanation', ''),
          submitted_by  = actor,
          submitted_at  = p_occurred_at
        where id = recon.id
        returning * into recon;

        outcome := jsonb_build_object(
          'reconciliation_id', recon.id, 'recon_number', recon.recon_number,
          'cash_variance', recon.cash_variance);
    end case;

    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, result, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      'applied', outcome, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id, 'status', 'applied', 'result', outcome, 'replayed', false);

  exception when others then
    -- The work is rolled back to the savepoint this block opened, but
    -- the verdict is kept: the driver is told what went wrong, and the
    -- same key is never retried into the same failure. A message about
    -- stock or a retired product is a conflict the driver has to see;
    -- anything else is a plain failure.
    insert into public.sync_operations (
      id, org_id, profile_id, device_id, operation, payload,
      status, error, occurred_at
    ) values (
      p_id, org, actor, p_device_id, p_operation, p_payload,
      case
        when sqlerrm ilike '%on the van%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict'::public.sync_status
        else 'failed'::public.sync_status
      end,
      sqlerrm, p_occurred_at
    );

    return jsonb_build_object(
      'id', p_id,
      'status', case
        when sqlerrm ilike '%on the van%'
          or sqlerrm ilike '%no longer%'
          or sqlerrm ilike '%already been%'
          or sqlerrm ilike '%cannot take further%'
        then 'conflict' else 'failed' end,
      'error', sqlerrm,
      'replayed', false);
  end;
end;
$function$
;
