-- =====================================================================
-- 0010_enum_extensions.sql
-- New enum values, isolated in their own migration.
--
-- PostgreSQL forbids using a newly added enum value in the transaction
-- that added it, and the Supabase SQL editor runs each script inside a
-- transaction. Keeping these four ALTERs in a separate file means the
-- later migrations can reference the new values safely.
-- =====================================================================

-- driver operates a van; senior_manager is unrestricted by category scopes.
alter type public.user_role add value if not exists 'driver';
alter type public.user_role add value if not exists 'senior_manager';

-- Damage and shortage are distinct so variance reporting can tell
-- "broken" apart from "unaccounted for".
alter type public.movement_type add value if not exists 'damage';
alter type public.movement_type add value if not exists 'shortage';
