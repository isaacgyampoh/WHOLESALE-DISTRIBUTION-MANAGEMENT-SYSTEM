-- ===================================================================
-- 0056  A broken-down van hands over its singles too
-- ===================================================================
--
-- 0047 gave a stranded van a way to pass its stock to another. It moves
-- full units only, so the loose pieces stay on the hard shoulder: the
-- transfer completes, the paperwork looks right, and the singles are
-- still recorded against a vehicle nobody is driving.
--
-- Same shape as before - a pair of movements sharing one reference, one
-- transaction, all or nothing. Each half of each line is checked against
-- its own half of what is on board, and a line may now carry either.
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
  from_org        uuid;
  to_org          uuid;
  reference       uuid := gen_random_uuid();
  line            record;
  on_board        integer;
  on_board_pieces integer;
  product         text;
  moved           integer := 0;
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
    select (l ->> 'product_id')::uuid            as product_id,
           coalesce((l ->> 'quantity')::integer, 0) as quantity,
           coalesce((l ->> 'pieces')::integer, 0)   as pieces
      from jsonb_array_elements(p_lines) as l
  loop
    if line.quantity < 0 or line.pieces < 0 then
      raise exception 'Quantities must be whole numbers above zero';
    end if;

    -- Either half may be zero. A line that moves nothing at all is a
    -- mistake, the same rule the ledger itself holds.
    if line.quantity = 0 and line.pieces = 0 then
      raise exception 'Quantities must be whole numbers above zero';
    end if;

    -- What is actually on board, checked here so the message names the
    -- product rather than leaving a constraint to fail anonymously.
    select coalesce(qty_on_hand, 0), coalesce(qty_pieces, 0)
      into on_board, on_board_pieces
      from public.van_inventory
     where van_id = p_from_van and product_id = line.product_id;

    if coalesce(on_board, 0) < line.quantity then
      select name into product from public.products where id = line.product_id;
      raise exception 'Only % of % on that van, % requested',
        coalesce(on_board, 0), coalesce(product, line.product_id::text), line.quantity;
    end if;

    -- Judged on its own: a sealed carton on the stranded van is not
    -- twelve singles until somebody opens it.
    if coalesce(on_board_pieces, 0) < line.pieces then
      select name into product from public.products where id = line.product_id;
      raise exception 'Only % loose pieces of % on that van, % requested',
        coalesce(on_board_pieces, 0), coalesce(product, line.product_id::text), line.pieces;
    end if;

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces, reference_type, reference_id,
       reason, created_by)
    values
      (from_org, line.product_id, p_from_van, 'transfer_out', line.quantity, line.pieces,
       'van_transfer', reference, trim(p_reason), auth.uid());

    insert into public.stock_movements
      (org_id, product_id, van_id, type, quantity, pieces, reference_type, reference_id,
       reason, created_by)
    values
      (to_org, line.product_id, p_to_van, 'transfer_in', line.quantity, line.pieces,
       'van_transfer', reference, trim(p_reason), auth.uid());

    moved := moved + 1;
  end loop;

  return reference;
end;
$$;

comment on function public.transfer_van_stock(uuid, uuid, jsonb, text) is
  'Move stock from one van to another as a pair of ledger movements '
  'sharing one reference, in full units and loose pieces. For a van that '
  'has broken down mid-round. Atomic: either the goods leave one van and '
  'arrive on the other, or neither happens.';
