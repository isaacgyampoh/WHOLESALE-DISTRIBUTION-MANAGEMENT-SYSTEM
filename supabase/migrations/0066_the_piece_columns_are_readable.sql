-- ===================================================================
-- 0066  The piece columns are readable
-- ===================================================================
--
-- 0023 withdrew table-level SELECT on the tables that carry cost and
-- granted the individual columns instead, so that unit_cost and
-- cost_price reach people through a masking function rather than a
-- grant. That regime has one sharp edge: a column added afterwards
-- inherits nothing. It is simply unreadable, and every later migration
-- has to remember to grant what it adds.
--
-- 0051 and 0057 did not, and three columns have been unreadable since:
--
--   van_load_items.qty_loaded_pieces
--   purchase_order_items.pieces
--   purchase_order_items.qty_received_pieces
--
-- The consequence was not a visible error, which is why it lasted. A
-- select naming only granted columns works; the moment one names an
-- ungranted column the whole request is refused, and PostgREST reports
-- "permission denied for table van_load_items" - the table, not the
-- column, so the message points away from the cause.
--
-- What that broke: the manifest on every van load page. getLoadDetail
-- asks for qty_loaded_pieces, so the request was refused, the lines
-- came back empty, and the page has been showing "Nothing was loaded"
-- for every load since 0051 - on rounds that were carrying nine
-- products. The figures were right in the database the whole time.
--
-- piece_cost is deliberately not granted. It is cost, and cost reaches
-- people through product_cost() and van_load_value(), never a column.

grant select (qty_loaded_pieces) on public.van_load_items to authenticated;

grant select (pieces, qty_received_pieces) on public.purchase_order_items to authenticated;
