-- ===================================================================
-- 0059  The paperwork says cartons and singles
-- ===================================================================
--
-- A waybill is the evidence that a quantity of goods left a warehouse
-- and arrived somewhere. It is copied from the load, and it copied
-- qty_loaded alone - so the loose pieces on a load travelled with no
-- paperwork at all. A driver stopped with singles on board has nothing
-- to show for them, and the depot receiving a delivery has nothing to
-- check them against.
--
-- The receiving columns get the same treatment. qty_received,
-- qty_damaged and qty_short are how a delivery is signed for, and a
-- shortage of three singles has to be recordable or it becomes a
-- shortage of nothing.

alter table public.waybill_items
  add column if not exists pieces integer not null default 0,
  add column if not exists qty_received_pieces integer,
  add column if not exists qty_damaged_pieces integer,
  add column if not exists qty_short_pieces integer;

comment on column public.waybill_items.pieces is
  'Loose pieces on this delivery line, beside quantity in full units. '
  'Never added to it: ten cartons and five pieces is not fifteen of '
  'anything.';

-- A line may be pieces only, the same rule the ledger holds.
alter table public.waybill_items
  drop constraint if exists waybill_items_quantity_check;
alter table public.waybill_items
  add constraint waybill_items_quantity_not_negative check (quantity >= 0);
alter table public.waybill_items
  drop constraint if exists waybill_items_carries_something;
alter table public.waybill_items
  add constraint waybill_items_carries_something
  check (quantity > 0 or pieces > 0);

-- ------------------------------------------------------------------
-- The waybill copies both halves of the load
-- ------------------------------------------------------------------
--
-- The 0026 body with one line changed: the select that copies the load
-- lines now carries qty_loaded_pieces across as well.
create or replace function public.issue_waybill_for_load(p_load_id uuid)
returns public.waybills
language plpgsql
security definer
set search_path = public
as $$
declare
  load public.van_loads;
  wb   public.waybills;
begin
  perform public.require_role('admin', 'senior_manager', 'manager', 'warehouse');

  select * into load from public.van_loads where id = p_load_id;
  if not found then
    raise exception 'Van load % not found', p_load_id;
  end if;

  -- Security definer runs past row level security, so the tenant check
  -- the policies would have made has to be made here instead. Reported
  -- as 'not found': whether another organization's sale exists is not
  -- this caller's business either.
  if auth.uid() is not null and load.org_id is distinct from public.auth_org_id() then
    raise exception 'Van load % not found', p_load_id using errcode = '42501';
  end if;

  select * into wb from public.waybills
   where reference_type = 'van_load' and reference_id = p_load_id;
  if found then
    return wb;
  end if;

  insert into public.waybills (
    org_id, status, from_warehouse_id, van_id, driver_id,
    reference_type, reference_id, issued_on, created_by
  ) values (
    load.org_id, 'issued', load.warehouse_id, load.van_id, load.driver_id,
    'van_load', load.id, load.load_date, auth.uid()
  )
  returning * into wb;

  insert into public.waybill_items (org_id, waybill_id, product_id, quantity, pieces)
  select load.org_id, wb.id, i.product_id, i.qty_loaded,
         coalesce(i.qty_loaded_pieces, 0)
    from public.van_load_items i
   where i.load_id = p_load_id;

  return wb;
end;
$$;
