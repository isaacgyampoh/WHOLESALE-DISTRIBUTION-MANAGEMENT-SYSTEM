-- ===================================================================
-- 0047  Stock moves between vans
-- ===================================================================
--
-- A van breaks down mid-round. The salesperson can already be moved to
-- another van - assign_crew closes the old assignment and opens a new
-- one, and the history survives - but the goods could not follow them.
-- There was no way to move stock from one van to another at all, so the
-- morning's load was stranded on the hard shoulder and the only way to
-- carry on was to edit quantities by hand, which is exactly what an
-- audited ledger exists to prevent.
--
-- WHY NOT stock_transfers
--
-- That table is warehouse to warehouse: from_warehouse_id and
-- to_warehouse_id, both required, wrapped in a raise/approve/dispatch/
-- receive lifecycle. None of that fits a vehicle that has broken down
-- and needs emptying now, and bending it to fit would mean nullable
-- warehouse columns and a second meaning for every status - changing a
-- module that works to serve a case it was not built for.
--
-- WHAT THIS USES INSTEAD
--
-- The ledger that is already there. stock_movements has carried van_id
-- since 0011 and apply_stock_movement already routes a movement to
-- van_inventory when it names a van rather than a warehouse. A van to
-- van transfer is therefore two movements and no new stock table:
--
--   transfer_out   from the van that broke down
--   transfer_in    to the van taking over
--
-- Both carry the same reference_id, so the pair can always be read back
-- as one event, and the reason is required because a movement nobody
-- can explain is the thing that makes a ledger worthless.
--
-- Atomic by construction: one function, one transaction. Either the
-- goods leave one van and arrive on the other, or neither happens.

create or replace function public.transfer_van_stock(
  p_from_van uuid,
  p_to_van   uuid,
  p_lines    jsonb,
  p_reason   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  from_org   uuid;
  to_org     uuid;
  reference  uuid := gen_random_uuid();
  line       record;
  on_board   integer;
  product    text;
  moved      integer := 0;
begin
  -- Moving goods between vehicles is the office's job. A salesperson
  -- emptying somebody else's van is how stock goes missing tidily.
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if p_from_van = p_to_van then
    raise exception 'A van cannot transfer stock to itself';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the stock is moving';
  end if;

  select org_id into from_org from public.vans where id = p_from_van;
  select org_id into to_org   from public.vans where id = p_to_van;

  if from_org is null then raise exception 'Van % not found', p_from_van; end if;
  if to_org   is null then raise exception 'Van % not found', p_to_van;   end if;

  -- Definer rights would otherwise reach across tenants, and a transfer
  -- between two organizations is never a real one.
  if from_org <> to_org then
    raise exception 'Those vans belong to different organizations'
      using errcode = '42501';
  end if;

  if auth.uid() is not null and from_org is distinct from public.auth_org_id() then
    raise exception 'Van % not found', p_from_van using errcode = '42501';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing was selected to move';
  end if;

  for line in
    select (l ->> 'product_id')::uuid as product_id,
           (l ->> 'quantity')::integer as quantity
      from jsonb_array_elements(p_lines) as l
  loop
    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Quantities must be whole numbers above zero';
    end if;

    -- What is actually on board, checked here so the message names the
    -- product rather than leaving a constraint to fail anonymously.
    select coalesce(qty_on_hand, 0) into on_board
      from public.van_inventory
     where van_id = p_from_van and product_id = line.product_id;

    if coalesce(on_board, 0) < line.quantity then
      select name into product from public.products where id = line.product_id;
      raise exception 'Only % of % on that van, % requested',
        coalesce(on_board, 0), coalesce(product, line.product_id::text), line.quantity;
    end if;

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, reference_type, reference_id,
       reason, created_by)
    values
      (from_org, line.product_id, p_from_van, 'transfer_out', line.quantity,
       'van_transfer', reference, trim(p_reason), auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, reference_type, reference_id,
       reason, created_by)
    values
      (to_org, line.product_id, p_to_van, 'transfer_in', line.quantity,
       'van_transfer', reference, trim(p_reason), auth.uid());

    moved := moved + 1;
  end loop;

  return reference;
end;
$$;

comment on function public.transfer_van_stock(uuid, uuid, jsonb, text) is
  'Move stock from one van to another as a pair of ledger movements '
  'sharing one reference. For a van that has broken down mid-round. '
  'Atomic: either the goods leave one van and arrive on the other, or '
  'neither happens.';

revoke all on function public.transfer_van_stock(uuid, uuid, jsonb, text)
  from public, anon;
grant execute on function public.transfer_van_stock(uuid, uuid, jsonb, text)
  to authenticated;

-- The pair is read back by its reference, so the ledger can answer
-- "what moved in that transfer" without scanning.
create index if not exists stock_movements_van_transfer
  on public.stock_movements (reference_id)
  where reference_type = 'van_transfer';
