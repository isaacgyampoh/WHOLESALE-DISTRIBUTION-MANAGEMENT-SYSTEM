-- =====================================================================
-- 0008_seed.sql
-- Demo reference data. Safe to re-run; safe to skip in production.
-- Users are NOT seeded here: create them in Authentication > Users,
-- then promote one with the UPDATE at the bottom of this file.
-- =====================================================================

insert into public.warehouses (code, name, city, is_default) values
  ('WH-ACC', 'Accra Main Depot', 'Accra', true),
  ('WH-KUM', 'Kumasi Depot',     'Kumasi', false)
on conflict (code) do nothing;

insert into public.categories (name) values
  ('Beverages'), ('Dry Goods'), ('Household'), ('Personal Care')
on conflict do nothing;

insert into public.suppliers (code, name, contact_name, email, phone, payment_terms_days, lead_time_days) values
  ('SUP-001', 'Volta Beverages Ltd', 'Kofi Mensah',  'sales@voltabev.example',  '+233201110001', 30, 5),
  ('SUP-002', 'Ashanti Foods Ltd',   'Ama Boateng',  'orders@ashfoods.example', 45, 10)
on conflict (code) do nothing;

insert into public.customers (code, name, contact_name, email, phone, city, credit_limit, payment_terms_days, price_tier) values
  ('CUS-001', 'Madina Retail Mart',   'Yaw Owusu',   'yaw@madinamart.example',  '+233241110001', 'Accra',  50000, 30, 'wholesale'),
  ('CUS-002', 'Suame Provisions',     'Akua Danso',  'akua@suameprov.example',  '+233241110002', 'Kumasi', 25000, 14, 'standard'),
  ('CUS-003', 'Tema Cash & Carry',    'Kwame Asare', 'kwame@temacc.example',    '+233241110003', 'Tema',  120000, 45, 'wholesale')
on conflict (code) do nothing;

insert into public.products (sku, name, category_id, supplier_id, unit_of_measure, units_per_case, cost_price, list_price, tax_rate, reorder_point, reorder_qty)
select v.sku, v.name,
       (select id from public.categories where name = v.category limit 1),
       (select id from public.suppliers  where code = v.supplier limit 1),
       v.uom, v.upc, v.cost, v.list, 15.0, v.rop, v.roq
from (values
  ('SKU-1001', 'Sparkling Water 500ml',   'Beverages',     'SUP-001', 'case', 24, 42.00,  58.00, 100, 200),
  ('SKU-1002', 'Cola 330ml',              'Beverages',     'SUP-001', 'case', 24, 55.00,  74.00, 150, 300),
  ('SKU-2001', 'Long Grain Rice 5kg',     'Dry Goods',     'SUP-002', 'bag',   1, 68.00,  89.00,  80, 150),
  ('SKU-2002', 'Vegetable Oil 5L',        'Dry Goods',     'SUP-002', 'each',  1, 95.00, 124.00,  60, 120),
  ('SKU-3001', 'Laundry Powder 2kg',      'Household',     'SUP-002', 'case', 12, 78.00, 102.00,  40,  80),
  ('SKU-4001', 'Bar Soap 150g',           'Personal Care', 'SUP-002', 'case', 48, 96.00, 130.00,  50, 100)
) as v(sku, name, category, supplier, uom, upc, cost, list, rop, roq)
on conflict (sku) do nothing;

-- Opening stock, posted through the ledger so inventory stays derived.
insert into public.stock_movements (product_id, warehouse_id, type, quantity, unit_cost, reference_type, reason)
select p.id,
       (select id from public.warehouses where code = 'WH-ACC'),
       'receipt', 250, p.cost_price, 'opening_balance', 'Opening stock'
from public.products p
where not exists (
  select 1 from public.stock_movements m
  where m.product_id = p.id and m.reference_type = 'opening_balance'
);

-- ---------------------------------------------------------------------
-- Promote your first user to admin. Create the account in the Supabase
-- dashboard first, then replace the email below and run this line.
--
--   update public.profiles set role = 'admin'
--   where email = 'you@example.com';
-- ---------------------------------------------------------------------
