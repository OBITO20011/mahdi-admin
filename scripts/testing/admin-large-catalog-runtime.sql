-- Disposable 5k-catalog verification for Migration 109.
-- Run only against a uniquely named local Supabase project.
\set ON_ERROR_STOP on
\timing on

BEGIN;

-- Idempotent cleanup is limited to fixtures owned by this isolated test.
DELETE FROM public.inventory_movements
WHERE reference_type = 'large_catalog_test';
DELETE FROM public.products
WHERE sku LIKE 'LCAT-%';

INSERT INTO public.profiles (id, full_name, is_active)
VALUES (:'test_user_id'::UUID, 'Large catalog test owner', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO public.roles (code, name_ar)
VALUES ('owner', 'مالك النظام')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id)
SELECT :'test_user_id'::UUID, role.id
FROM public.roles role
WHERE role.code = 'owner'
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE large_catalog_context AS
SELECT
  (SELECT id FROM public.branches ORDER BY created_at LIMIT 1) AS branch_id,
  (SELECT id FROM public.categories ORDER BY created_at LIMIT 1) AS category_id,
  (SELECT id FROM public.units WHERE code = 'PCS' LIMIT 1) AS base_unit_id,
  (SELECT id FROM public.units WHERE code = 'CTN' LIMIT 1) AS purchase_unit_id,
  (SELECT id FROM public.units WHERE code = 'PKT' LIMIT 1) AS sale_unit_id;

INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
SELECT
  '91000000-0000-0000-0000-000000000001'::UUID,
  context.branch_id,
  'LCAT-WH-01',
  'مستودع اختبار الكتالوج الأول',
  true
FROM large_catalog_context context
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
SELECT
  '91000000-0000-0000-0000-000000000002'::UUID,
  context.branch_id,
  'LCAT-WH-02',
  'مستودع اختبار الكتالوج الثاني',
  true
FROM large_catalog_context context
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE large_catalog_products (
  sequence_number INTEGER PRIMARY KEY,
  product_id UUID NOT NULL UNIQUE
);

INSERT INTO large_catalog_products (sequence_number, product_id)
SELECT sequence_number, gen_random_uuid()
FROM generate_series(1, 5000) sequence_number;

INSERT INTO public.products (
  id, sku, barcode, name_ar, description, category_id, unit_id,
  purchase_unit_id, units_per_purchase_unit,
  default_purchase_price_in_minor_units,
  sale_unit_id, units_per_sale_unit, default_sale_price_in_minor_units,
  cost_price_in_minor_units, sale_price_in_minor_units,
  wholesale_price_in_minor_units, min_stock_level, max_stock_level,
  is_active
)
SELECT
  fixture.product_id,
  'LCAT-' || LPAD(fixture.sequence_number::TEXT, 6, '0'),
  '9900' || LPAD(fixture.sequence_number::TEXT, 9, '0'),
  'منتج اختبار الحجم ' || LPAD(fixture.sequence_number::TEXT, 6, '0'),
  'بيانات اختبار محلية معزولة فقط',
  context.category_id,
  context.base_unit_id,
  context.purchase_unit_id,
  24,
  12000,
  context.sale_unit_id,
  6,
  4200,
  500,
  700,
  700,
  12,
  500,
  true
FROM large_catalog_products fixture
CROSS JOIN large_catalog_context context;

INSERT INTO public.inventory_balances (
  warehouse_id, product_id, on_hand_quantity, reserved_quantity
)
SELECT
  warehouse.warehouse_id,
  fixture.product_id,
  20 + (fixture.sequence_number % 80),
  fixture.sequence_number % 5
FROM large_catalog_products fixture
CROSS JOIN (
  VALUES
    ('91000000-0000-0000-0000-000000000001'::UUID),
    ('91000000-0000-0000-0000-000000000002'::UUID)
) warehouse(warehouse_id);

INSERT INTO public.inventory_movements (
  warehouse_id, product_id, movement_type, quantity,
  balance_before, balance_after, reference_type, created_by, created_at
)
SELECT
  CASE WHEN event_number % 2 = 0
    THEN '91000000-0000-0000-0000-000000000001'::UUID
    ELSE '91000000-0000-0000-0000-000000000002'::UUID
  END,
  fixture.product_id,
  'sales_deduction',
  -1,
  20,
  19,
  'large_catalog_test',
  :'test_user_id'::UUID,
  NOW() - make_interval(secs => event_number)
FROM generate_series(1, 42000) event_number
JOIN large_catalog_products fixture
  ON fixture.sequence_number = ((event_number - 1) % 5000) + 1;

ANALYZE public.products;
ANALYZE public.inventory_balances;
ANALYZE public.inventory_movements;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', :'test_user_id',
    'role', 'authenticated',
    'aal', 'aal1'
  )::TEXT,
  true
);

DO $$
DECLARE
  product_page JSONB;
  product_page_repeat JSONB;
  inventory_page JSONB;
  search_results JSONB;
  movement_page JSONB;
  expected_potential_profit NUMERIC;
BEGIN
  product_page := public.get_admin_product_page(1, 24, 'منتج اختبار الحجم', NULL, 'all', 'name');
  product_page_repeat := public.get_admin_product_page(1, 24, 'منتج اختبار الحجم', NULL, 'all', 'name');
  inventory_page := public.get_admin_inventory_product_page(1, 24, 'منتج اختبار الحجم', NULL, NULL, NULL, 'all');
  search_results := public.search_admin_products('LCAT-002500', 20, NULL, 'receiving', NULL);
  movement_page := public.get_inventory_movement_page(1, 25, NULL, NULL, NULL, NULL);
  WITH stock_by_product AS (
    SELECT
      balance.product_id,
      SUM(balance.available_quantity)::INTEGER AS available_quantity
    FROM public.inventory_balances balance
    GROUP BY balance.product_id
  ),
  family_stock AS (
    SELECT
      child.flavor_master_product_id AS product_id,
      COALESCE(SUM(stock.available_quantity), 0)::INTEGER AS available_quantity
    FROM public.products child
    LEFT JOIN stock_by_product stock ON stock.product_id = child.id
    WHERE child.flavor_master_product_id IS NOT NULL
    GROUP BY child.flavor_master_product_id
  )
  SELECT COALESCE(SUM(
    CASE WHEN product.sale_unit_id IS NULL THEN 0 ELSE GREATEST(
      product.default_sale_price_in_minor_units::NUMERIC
        / GREATEST(product.units_per_sale_unit, 1)
        - product.cost_price_in_minor_units,
      0
    ) * CASE WHEN product.is_flavor_master
      THEN COALESCE(family.available_quantity, 0)
      ELSE COALESCE(stock.available_quantity, 0)
    END END
  ), 0)
  INTO expected_potential_profit
  FROM public.products product
  LEFT JOIN stock_by_product stock ON stock.product_id = product.id
  LEFT JOIN family_stock family ON family.product_id = product.id
  WHERE product.flavor_master_product_id IS NULL;

  IF jsonb_array_length(product_page -> 'products') <> 24
     OR (product_page ->> 'total_count')::INTEGER <> 5000 THEN
    RAISE EXCEPTION 'Product page is not bounded or complete.';
  END IF;
  IF product_page -> 'products' <> product_page_repeat -> 'products' THEN
    RAISE EXCEPTION 'Product page ordering is not deterministic.';
  END IF;
  IF (product_page -> 'metrics' ->> 'potential_profit_in_minor_units')::NUMERIC
     <> expected_potential_profit THEN
    RAISE EXCEPTION 'Product potential-profit metric changed its per-base-unit semantics.';
  END IF;
  IF jsonb_array_length(inventory_page -> 'products') <> 24
     OR (inventory_page ->> 'total_count')::INTEGER <> 5000
     OR (inventory_page -> 'metrics' ->> 'total_items')::INTEGER <> 5000 THEN
    RAISE EXCEPTION 'Inventory page or full-scope metrics are incorrect.';
  END IF;
  IF jsonb_array_length(search_results) <> 1
     OR search_results -> 0 ->> 'sku' <> 'LCAT-002500' THEN
    RAISE EXCEPTION 'Exact server-side product search is incorrect.';
  END IF;
  IF COALESCE(jsonb_array_length(movement_page -> 'rows'), -1) <> 25
     OR movement_page -> 'product_movement_counts' <> '{}'::JSONB
     OR movement_page -> 'sales_product_ids' <> '[]'::JSONB THEN
    RAISE EXCEPTION 'Movement page still includes unbounded product aggregates.';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'products', (SELECT COUNT(*) FROM public.products WHERE sku LIKE 'LCAT-%'),
  'balances', (
    SELECT COUNT(*)
    FROM public.inventory_balances balance
    JOIN large_catalog_products fixture ON fixture.product_id = balance.product_id
  ),
  'movements', (
    SELECT COUNT(*) FROM public.inventory_movements WHERE reference_type = 'large_catalog_test'
  ),
  'product_page_rows', jsonb_array_length(public.get_admin_product_page(1, 24, NULL, NULL, 'all', 'name') -> 'products'),
  'product_page_bytes', pg_column_size(public.get_admin_product_page(1, 24, NULL, NULL, 'all', 'name')),
  'inventory_page_rows', jsonb_array_length(public.get_admin_inventory_product_page(1, 24, NULL, NULL, NULL, NULL, 'all') -> 'products'),
  'inventory_page_bytes', pg_column_size(public.get_admin_inventory_product_page(1, 24, NULL, NULL, NULL, NULL, 'all')),
  'pos_search_rows', jsonb_array_length(public.search_admin_products(NULL, 40, NULL, 'sellable', NULL)),
  'purchase_search_rows', jsonb_array_length(public.search_admin_products(NULL, 20, NULL, 'receiving', NULL)),
  'movement_page_rows', jsonb_array_length(public.get_inventory_movement_page(1, 25, NULL, NULL, NULL, NULL) -> 'rows')
) AS large_catalog_result;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.get_admin_product_page(1, 24, NULL, NULL, 'all', 'name');

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.get_admin_inventory_product_page(1, 24, NULL, NULL, NULL, NULL, 'all');

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.get_inventory_movement_page(1, 25, NULL, NULL, NULL, NULL);

COMMIT;
