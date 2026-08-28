-- ===================================================================
-- 0044  Every movement has a direction
-- ===================================================================
--
-- The three labels 0043 declares had no direction, and a movement type
-- without one is worse than a missing type: movement_direction returns
-- null, the trigger multiplies it by the quantity, and the inventory row
-- it updates becomes null rather than wrong. The balance is not off by
-- some amount - it stops being a number.
--
-- Written as a complete replacement rather than an addition so the
-- mapping can be read in one piece, which is how it should be checked.
--
--   in    goods arriving, found, or coming back
--   out   goods leaving, lost, or going back to a supplier
--
-- opening_stock is what was already on the shelf the day a product is
-- first written down. stocktake_in and stocktake_out are the two halves
-- of a count: more on the shelf than the system believed, or less.

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
    when 'issue'            then -1
    when 'transfer_out'     then -1
    when 'supplier_return'  then -1
    when 'adjustment_out'   then -1
    when 'damage'           then -1
    when 'shortage'         then -1
    when 'stocktake_out'    then -1
  end
$$;

comment on function public.movement_direction(public.movement_type) is
  'Which way a movement moves stock. Every member of movement_type must '
  'appear here: a null direction does not miscount the balance, it '
  'replaces it with null.';
