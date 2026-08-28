-- ===================================================================
-- 0050  Opening a carton is something somebody does
-- ===================================================================
--
-- The pack size says a carton holds twelve. That is a fact about the
-- carton, not a licence to treat one carton as twelve pieces whenever
-- the arithmetic is convenient. Until somebody cuts the tape there are
-- no loose pieces, and a system that conjured them would be inventing
-- stock: the shelf would disagree with the screen, and the shelf is
-- right.
--
-- So the conversion is an operation with a person behind it and a line
-- in the ledger, exactly like a receipt or a count. It runs both ways -
-- opening a carton into pieces, and packing loose pieces back into one -
-- because a warehouse does both and only recording one of them leaves
-- the other to be faked with an adjustment.

-- ------------------------------------------------------------------
-- The direction of the two new types
-- ------------------------------------------------------------------
--
-- Rewritten whole rather than patched, the same as 0044, so the mapping
-- can be read and checked in one piece. A type missing from here does
-- not miscount the balance - it replaces it with null.
create or replace function public.movement_direction(t public.movement_type)
returns integer
language sql
immutable
as $$
  select case t
    when 'receipt'          then  1
    when 'transfer_in'      then  1
    when 'customer_return'  then  1
    when 'adjustment_in'    then  1
    when 'opening_stock'    then  1
    when 'stocktake_in'     then  1
    when 'conversion_in'    then  1
    when 'issue'            then -1
    when 'transfer_out'     then -1
    when 'supplier_return'  then -1
    when 'adjustment_out'   then -1
    when 'damage'           then -1
    when 'shortage'         then -1
    when 'stocktake_out'    then -1
    when 'conversion_out'   then -1
  end
$$;

comment on function public.movement_direction(public.movement_type) is
  'Which way a movement moves stock. Every member of movement_type must '
  'appear here: a null direction does not miscount the balance, it '
  'replaces it with null.';

-- ------------------------------------------------------------------
-- Opening a carton, and packing one back up
-- ------------------------------------------------------------------
create or replace function public.convert_stock_units(
  p_product   uuid,
  p_warehouse uuid,
  p_van       uuid,
  p_action    text,     -- 'open' or 'pack'
  p_units     integer,  -- full units to open, or to make up
  p_reason    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reference   uuid := gen_random_uuid();
  product_org uuid;
  product_name text;
  unit_name   text;
  pack        integer;
  held_units  integer;
  held_pieces integer;
  piece_count integer;
  note        text;
begin
  -- Changing the form stock is held in is a warehouse job. A
  -- salesperson turning cartons into pieces on their own authority is
  -- how a van comes back short and balanced.
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  if p_action is null or p_action not in ('open', 'pack') then
    raise exception 'Say whether the stock is being opened or packed';
  end if;

  if p_units is null or p_units <= 0 then
    raise exception 'Enter a whole number above zero';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the stock is changing';
  end if;

  -- Stock is held in one place or the other, never both and never
  -- neither. Left ambiguous, the trigger would silently pick the
  -- warehouse branch and the van would never be touched.
  if (p_warehouse is null) = (p_van is null) then
    raise exception 'Name either a warehouse or a van, not both';
  end if;

  select org_id, name, unit_of_measure, units_per_case
    into product_org, product_name, unit_name, pack
    from public.products
   where id = p_product;

  if product_org is null then
    raise exception 'Product not found';
  end if;

  -- Definer rights would otherwise reach across tenants.
  if auth.uid() is not null and product_org is distinct from public.auth_org_id() then
    raise exception 'Product not found' using errcode = '42501';
  end if;

  -- The whole operation rests on the pack size. Unset, it is 1, and
  -- opening a carton into one piece is not a conversion - it is a
  -- rounding error waiting to be discovered at stocktake.
  if coalesce(pack, 1) <= 1 then
    raise exception
      'No pack size is set for %. Record how many pieces come out of one % before opening one.',
      product_name, lower(coalesce(unit_name, 'unit'));
  end if;

  piece_count := p_units * pack;

  -- What is actually there, in whichever place holds it.
  if p_warehouse is not null then
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into held_units, held_pieces
      from public.inventory
     where warehouse_id = p_warehouse and product_id = p_product;
  else
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into held_units, held_pieces
      from public.van_inventory
     where van_id = p_van and product_id = p_product;
  end if;

  held_units  := coalesce(held_units, 0);
  held_pieces := coalesce(held_pieces, 0);

  -- Refused here, by name, rather than left to a balance going
  -- negative somewhere nobody is looking.
  if p_action = 'open' and held_units < p_units then
    raise exception 'Only % % there, % asked to be opened',
      held_units, lower(coalesce(unit_name, 'unit')) || 's', p_units;
  end if;

  if p_action = 'pack' and held_pieces < piece_count then
    raise exception 'Only % loose pieces there, % needed to make up % %',
      held_pieces, piece_count, p_units, lower(coalesce(unit_name, 'unit')) || 's';
  end if;

  note := trim(p_reason);

  if p_action = 'open' then
    -- The sealed units leave.
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (product_org, p_product, p_warehouse, p_van, 'conversion_out', p_units, 0,
       'unit_opened', reference, note, auth.uid());

    -- The loose pieces appear.
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (product_org, p_product, p_warehouse, p_van, 'conversion_in', 0, piece_count,
       'unit_opened', reference, note, auth.uid());
  else
    -- The loose pieces go back in the box.
    insert into public.stock_movements
      (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (product_org, p_product, p_warehouse, p_van, 'conversion_out', 0, piece_count,
       'unit_packed', reference, note, auth.uid());

    insert into public.stock_movements
      (org_id, product_id, warehouse_id, van_id, type, quantity, pieces,
       reference_type, reference_id, reason, created_by)
    values
      (product_org, p_product, p_warehouse, p_van, 'conversion_in', p_units, 0,
       'unit_packed', reference, note, auth.uid());
  end if;

  return reference;
end;
$$;

comment on function public.convert_stock_units(uuid, uuid, uuid, text, integer, text) is
  'Open full units into loose pieces, or pack loose pieces back into '
  'full units, as a pair of ledger movements sharing one reference. '
  'Requires a pack size on the product: nothing here converts on '
  'arithmetic alone, because until somebody opens the carton the pieces '
  'do not exist.';

revoke all on function public.convert_stock_units(uuid, uuid, uuid, text, integer, text)
  from public, anon;
grant execute on function public.convert_stock_units(uuid, uuid, uuid, text, integer, text)
  to authenticated, service_role;

-- Both halves are read back together by their reference.
create index if not exists stock_movements_conversion
  on public.stock_movements (reference_id)
  where reference_type in ('unit_opened', 'unit_packed');
