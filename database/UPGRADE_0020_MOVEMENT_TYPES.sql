-- =====================================================================
-- UPGRADE: Opening stock and stock count movement types
--
-- GENERATED FILE - do not edit by hand.
-- Source: supabase/migrations/0020_inventory_enum_extensions.sql
-- Regenerate: node database/build.mjs
--
-- FOR AN EXISTING INSTALLATION ONLY. A database installed from
-- WHOLESALE_DISTRIBUTION_DATABASE.sql already contains this.
--
-- RUN IT ONCE. Unlike the other upgrade scripts in this folder, this one
-- creates types, renames columns and replaces indexes, so a second run
-- fails partway with "already exists" rather than doing nothing. To check
-- whether it has already been applied, run:
--
--   select unnest(enum_range(null::public.movement_type));
--   If the list already contains opening_stock, this has been applied.
--
-- Run UPGRADE_0020_MOVEMENT_TYPES.sql first, on its own: PostgreSQL cannot use a new
-- enum value in the transaction that added it.
-- =====================================================================

-- =====================================================================
-- 0020_inventory_enum_extensions.sql
-- New movement types, isolated in their own migration.
--
-- As with 0010: PostgreSQL forbids using a newly added enum value in the
-- transaction that added it, and the Supabase SQL editor wraps each
-- script in one. Keeping these ALTERs alone means 0021 can reference the
-- new values safely.
--
-- Why these three and not a reuse of adjustment_in / adjustment_out:
-- the business distinguishes three different events that all move a
-- number, and a variance report that cannot tell them apart is useless.
--
--   opening_stock  the quantity a product already had when it was first
--                  entered into the system. Not a purchase, not a
--                  correction: the starting balance.
--   stocktake_in   a physical count found more than the ledger said.
--   stocktake_out  a physical count found less than the ledger said.
--
-- A manager's deliberate correction stays adjustment_in / adjustment_out,
-- which already exist and already mean exactly that.
-- =====================================================================

alter type public.movement_type add value if not exists 'opening_stock';
alter type public.movement_type add value if not exists 'stocktake_in';
alter type public.movement_type add value if not exists 'stocktake_out';
