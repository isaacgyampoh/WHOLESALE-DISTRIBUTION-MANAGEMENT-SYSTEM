-- ===================================================================
-- 0070  The phone is told about the pieces
-- ===================================================================
--
-- WHAT WAS WRONG
--
-- The van till showed no piece controls for anything, on any product,
-- even where the van was demonstrably carrying loose pieces.
--
-- 0051 gave the van a second quantity and 0052 put it in
-- van_stock_summary. 0053 taught sync_submit to carry pieces up from a
-- sale made with no signal. What nobody carried was the other
-- direction: sync_bootstrap, the snapshot the phone caches and then
-- sells from, still returned the 0022 shape - product, sku, name,
-- qty_on_hand, and a price list of unit_price and tax_rate.
--
-- So the till read qty_pieces as undefined, pieces_per_unit as 1 and
-- unit as the empty string, and an empty unit holds no pieces. Every
-- product on every round rendered as a single stepper. The salespeople
-- were right: they could not sell in pieces, and no amount of stock
-- being there made any difference.
--
-- There are two implementations of this snapshot - one here and
-- getOfflineSnapshot() in the application, which was updated and does
-- carry the pieces. The application one runs on the server for the
-- first render; the phone then refreshes through this RPC and
-- overwrites it. The one that was wrong is the one that governs.
--
-- The shape below is now exactly what OfflineSnapshotShape declares.

CREATE OR REPLACE FUNCTION public.sync_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  org   uuid;
  van   uuid;
  out   jsonb;
begin
  perform public.require_role(
    'admin', 'senior_manager', 'manager', 'accountant', 'sales_rep', 'salesperson', 'driver');
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select org_id into org from public.profiles where id = actor;
  van := public.my_van_id();

  -- Deliberately narrow: what a driver needs to sell from the van they
  -- are on, and nothing else. A phone that is lost should not be
  -- carrying the whole customer book or the cost price of every line.
  select jsonb_build_object(
    'cached_at', now(),
    'van', (
      select jsonb_build_object('id', v.id, 'code', v.code, 'registration_no', v.registration_no)
        from public.vans v where v.id = van
    ),
    'load', (
      select jsonb_build_object(
               'id', l.id, 'load_number', l.load_number,
               'status', l.status, 'opening_float', l.opening_float)
        from public.van_loads l
       where l.van_id = van and l.status in ('loaded', 'dispatched')
       order by l.load_date desc limit 1
    ),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', s.product_id, 'sku', s.sku, 'name', s.product_name,
               'qty_on_hand', s.qty_on_hand,
               -- The loose half, never folded into the first figure.
               'qty_pieces', coalesce(s.qty_pieces, 0),
               -- How many singles come out of one full unit. 1 means
               -- nobody has recorded it, and the till then offers no
               -- singles off a sealed carton rather than guessing.
               'pieces_per_unit', coalesce(s.units_per_case, 1),
               -- What the full unit is called. The till words the two
               -- halves from this - "3 Cartons + 2 Pieces" - and an
               -- empty one means the product is sold by the piece
               -- already and has no second quantity.
               'unit', coalesce(s.unit_of_measure, '')))
        from public.van_stock_summary s where s.van_id = van
    ), '[]'::jsonb),
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', i.product_id, 'unit_price', i.unit_price,
               'tax_rate', p.tax_rate, 'image_path', p.image_path,
               -- Never derived from the carton price. Zero means nobody
               -- has set one, and the till refuses to sell pieces of
               -- that product rather than inventing a figure that would
               -- undercharge every single one of them.
               'piece_price', coalesce(p.piece_price, 0)))
        from public.van_load_items i
        join public.products p on p.id = i.product_id
       where i.load_id = (
         select l.id from public.van_loads l
          where l.van_id = van and l.status in ('loaded', 'dispatched')
          order by l.load_date desc limit 1)
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'code', c.code, 'name', c.name, 'phone', c.phone,
               'balance', coalesce(cp.ledger_balance, 0),
               'credit_available', coalesce(cp.credit_available, c.credit_limit)))
        from public.customers c
        left join public.customer_credit_position cp on cp.customer_id = c.id
       where c.org_id = org and c.is_active
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$function$
;

comment on function public.sync_bootstrap() is
  'The snapshot a phone caches so it can keep selling with no signal. '
  'Carries both halves of every quantity and both prices: a till that '
  'is only told the cartons can only sell cartons.';
