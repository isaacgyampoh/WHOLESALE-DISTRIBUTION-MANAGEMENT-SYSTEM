-- ===================================================================
-- 0068  A salesperson at the counter can see the shelf
-- ===================================================================
--
-- 0067 gave the shop a till and it showed nothing. Not a bug in the
-- till: can_access_product scopes a salesperson to the products on the
-- van they are crewed on, so somebody standing at a counter - crewed on
-- no van, or on one carrying different goods - sees an empty catalogue
-- and cannot sell a thing.
--
-- That rule was written when selling only ever happened from a van, and
-- it was right then. It is simply narrower than the business now is.
--
-- A driver keeps the van-only rule: what they carry is the whole of
-- their business with the catalogue. A salesperson gets that plus
-- whatever is on a shelf in their own organisation, which is what they
-- can actually be asked to sell.
--
-- Nothing about cost changes. That is masked by product_cost() and
-- always has been, for every role, and this function has never had
-- anything to do with it - it decides which products exist for you, not
-- what you may know about their margin.

CREATE OR REPLACE FUNCTION public.can_access_product(target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when public.has_role('admin', 'senior_manager') then true
    when public.has_role('manager') then exists (
      select 1 from public.manager_category_scopes s
      join public.products p on p.category_id = s.category_id
      where p.id = target and s.profile_id = auth.uid()
    )
    -- A driver sees what is on the van they are crewed on, because that
    -- is what they are carrying and the whole of their business with
    -- the catalogue.
    when public.has_role('driver') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    )
    -- A salesperson sees that too, and also whatever is on a shelf.
    --
    -- The van-only rule was written when selling only ever happened
    -- from a van. It now leaves somebody serving at the shop counter
    -- looking at an empty catalogue, which is not a safeguard - it is
    -- the counter not working. Selling prices and product names are not
    -- what is protected here; cost is, and product_cost() still masks
    -- it for everyone who may not see it.
    when public.has_role('salesperson') then exists (
      select 1 from public.van_inventory vi
      where vi.product_id = target and vi.van_id = public.my_van_id()
    ) or exists (
      select 1 from public.inventory i
      where i.product_id = target and i.org_id = public.auth_org_id()
    )
    when public.auth_role() is null then false
    else true
  end
$function$
;
