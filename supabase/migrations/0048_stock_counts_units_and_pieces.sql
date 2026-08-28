-- ===================================================================
-- 0048  Stock counts full units and loose pieces
-- ===================================================================
--
-- This business does not hold one number per product. It holds ten
-- cartons and seven loose pieces, and those are two different things:
-- ten cartons is not seventy, and seven pieces is not a fraction of a
-- carton. Until now the ledger had a single integer and could say only
-- one of them.
--
-- WHAT THE EXISTING NUMBERS MEAN
--
-- Every quantity already in this database is a count of the product's
-- own unit_of_measure. A carton product holding 137 holds 137 cartons.
-- All 68 products carry units_per_case = 1, which is to say no
-- pieces-per-unit has ever been configured.
--
-- So the migration is a rename in meaning and nothing else:
--
--   qty_on_hand  ->  full units, exactly as recorded    (untouched)
--   qty_pieces   ->  loose pieces, of which there are none yet (0)
--
-- Not one quantity moves. The audit that matters:
--
--   warehouse   1,509 units
--   vans           80 units
--   movements      94
--
-- all still read the same after this, because every new column defaults
-- and every existing write omits it.
--
-- WHY THIS IS SAFE TO DEPLOY BEFORE THE SCREENS EXIST
--
-- pieces defaults to 0 on a movement, so the eleven functions that
-- write the ledger keep working untouched and keep meaning what they
-- meant. The trigger applies a zero to the piece balance, which is a
-- no-op. The system behaves exactly as it does today until something
-- deliberately passes a piece count.
--
-- That is the point of doing it in this order: the hard half is the
-- ledger, and it can be laid down without changing a single figure.
--
-- CONVERSION IS NOT ASSUMED
--
-- pieces_per_unit says how many pieces come out of one full unit, and it
-- only means something when somebody has configured it. Left at 1, a
-- piece and a unit are the same thing, which is true of the four
-- products sold by the piece and harmless for the rest. Nothing here
-- converts between the two columns: opening a carton is a deliberate act
-- that has to be recorded, not arithmetic the database does quietly.

-- ------------------------------------------------------------------
-- What one full unit contains
-- ------------------------------------------------------------------
--
-- units_per_case already carries exactly this meaning and is 1 for every
-- product, so it is kept rather than replaced. The comment is the
-- change: it had no stated meaning before and now has one that the rest
-- of the system relies on.
comment on column public.products.units_per_case is
  'How many loose pieces come out of one full unit_of_measure - one '
  'carton, box or bag. 1 means a piece and a unit are the same thing, '
  'which is the case until somebody configures otherwise. Never used to '
  'convert between qty_on_hand and qty_pieces on its own: opening a '
  'carton is a recorded movement, not silent arithmetic.';

-- ------------------------------------------------------------------
-- The second quantity, everywhere stock is held or moved
-- ------------------------------------------------------------------

alter table public.stock_movements
  add column if not exists pieces integer not null default 0;

comment on column public.stock_movements.pieces is
  'Loose pieces moved, alongside quantity, which counts full units. A '
  'movement may carry either, or both: five cartons and three pieces is '
  'one movement, not two.';

alter table public.inventory
  add column if not exists qty_pieces integer not null default 0;

comment on column public.inventory.qty_pieces is
  'Loose pieces on hand. qty_on_hand counts full units and the two are '
  'independent: ten cartons and five pieces is not seventy-five of '
  'anything.';

alter table public.van_inventory
  add column if not exists qty_pieces integer not null default 0;

comment on column public.van_inventory.qty_pieces is
  'Loose pieces on the van, beside qty_on_hand in full units.';

-- No non-negative check on the balances, deliberately, and the same way
-- qty_on_hand has never had one.
--
-- The trigger keeps balances with INSERT ... ON CONFLICT DO UPDATE, and
-- PostgreSQL validates the proposed row before it resolves the
-- conflict. The proposed row carries the delta - minus three pieces for
-- a sale of three - so a check of qty_pieces >= 0 refuses every
-- outbound movement against an existing balance rather than only the
-- ones that would overdraw. That is why inventory.qty_on_hand has no
-- such constraint either, and only qty_reserved does.
--
-- Running out of stock is prevented where it can be judged: complete_van_sale,
-- dispatch_van_load and transfer_van_stock each check what is actually
-- there and refuse by name before writing anything.

-- A movement's own quantities are always positive - direction comes from
-- the type, not the sign - and that can be constrained safely.
alter table public.stock_movements
  drop constraint if exists stock_movements_pieces_not_negative;
alter table public.stock_movements
  add constraint stock_movements_pieces_not_negative check (pieces >= 0);

-- A movement that moves nothing at all is a mistake, not a record.
--
-- The original rule was quantity > 0, which said the same thing back
-- when quantity was the only column. It now forbids the very case this
-- migration exists for: selling three loose pieces and no full units is
-- a movement of quantity 0 and pieces 3, and that check refused it.
--
-- So the rule moves up a level rather than being weakened. Each column
-- may be zero; the movement as a whole may not.
alter table public.stock_movements
  drop constraint if exists stock_movements_quantity_check;
alter table public.stock_movements
  add constraint stock_movements_quantity_not_negative check (quantity >= 0);

alter table public.stock_movements
  drop constraint if exists stock_movements_moves_something;
alter table public.stock_movements
  add constraint stock_movements_moves_something
  check (quantity > 0 or pieces > 0);

-- ------------------------------------------------------------------
-- The trigger applies both halves
-- ------------------------------------------------------------------
--
-- One direction governs the whole movement: five cartons and three
-- pieces out is both leaving, never one of each way. Otherwise this is
-- the 0011 body, and with pieces defaulting to 0 it behaves identically
-- for every write that exists today.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  direction integer;
  delta        integer;
  delta_pieces integer;
begin
  direction    := public.movement_direction(new.type);
  delta        := direction * new.quantity;
  delta_pieces := direction * new.pieces;

  if new.warehouse_id is not null then
    insert into public.inventory (org_id, product_id, warehouse_id, qty_on_hand, qty_pieces)
    values (new.org_id, new.product_id, new.warehouse_id, delta, delta_pieces)
    on conflict (product_id, warehouse_id) do update
      set qty_on_hand = public.inventory.qty_on_hand + delta,
          qty_pieces  = public.inventory.qty_pieces  + delta_pieces,
          updated_at  = now();
  else
    insert into public.van_inventory (org_id, van_id, product_id, qty_on_hand, qty_pieces)
    values (new.org_id, new.van_id, new.product_id, delta, delta_pieces)
    on conflict (van_id, product_id) do update
      set qty_on_hand = public.van_inventory.qty_on_hand + delta,
          qty_pieces  = public.van_inventory.qty_pieces  + delta_pieces,
          updated_at  = now();
  end if;

  return new;
end;
$function$;

comment on function public.apply_stock_movement() is
  'Applies a movement to the balance it names - a warehouse or a van - '
  'in both full units and loose pieces. One direction governs both: a '
  'movement out takes from each, never one from each side.';
