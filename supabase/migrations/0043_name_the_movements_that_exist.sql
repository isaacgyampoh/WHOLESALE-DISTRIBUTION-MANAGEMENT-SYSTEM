-- ===================================================================
-- 0043  Name the movements that already exist
-- ===================================================================
--
-- The production database carries three movement types that this
-- repository never declared: opening_stock, stocktake_in and
-- stocktake_out. They arrived with a migration from another line of
-- work whose remaining half was never applied, so the labels exist and
-- nothing knows what they mean.
--
-- movement_direction returns null for all three. The trigger that keeps
-- inventory in step multiplies that null by the quantity, and writes the
-- result:
--
--   delta := movement_direction(new.type) * new.quantity;   -- null
--   qty_on_hand := qty_on_hand + delta;                     -- null
--
-- So a movement using any of them does not merely fail to count - it
-- takes the running balance with it. Nothing writes one today, which is
-- the only reason no stock has been lost, but the labels are selectable
-- from the enum and the next caller to reach for the obvious name finds
-- the trap.
--
-- This migration declares them here so a fresh install matches the
-- database that exists. 0044 gives them their direction - separately,
-- because PostgreSQL will not let a value be used in the same
-- transaction that added it, the same reason 0032 shipped alone.

alter type public.movement_type add value if not exists 'opening_stock';
alter type public.movement_type add value if not exists 'stocktake_in';
alter type public.movement_type add value if not exists 'stocktake_out';
