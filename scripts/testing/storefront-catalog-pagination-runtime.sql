BEGIN;

DO $$
DECLARE
  v_category_id UUID;
  v_piece_unit_id UUID;
  v_sale_unit_id UUID;
BEGIN
  SELECT id INTO v_category_id
  FROM public.categories
  WHERE is_active = true
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO v_piece_unit_id
  FROM public.units
  WHERE code = 'PCS'
  LIMIT 1;

  SELECT id INTO v_sale_unit_id
  FROM public.units
  WHERE code <> 'PCS'
  ORDER BY created_at, id
  LIMIT 1;

  IF v_category_id IS NULL OR v_piece_unit_id IS NULL OR v_sale_unit_id IS NULL THEN
    RAISE EXCEPTION 'Isolated runtime catalog fixture prerequisites are missing.';
  END IF;

  INSERT INTO public.products (
    sku,
    name_ar,
    category_id,
    unit_id,
    sale_unit_id,
    units_per_sale_unit,
    default_sale_price_in_minor_units,
    sale_price_in_minor_units,
    is_active
  )
  SELECT
    'CATALOG-RUNTIME-' || series::TEXT,
    CASE
      WHEN series = 201 THEN 'منتج اختبار رقم ٢٠١'
      ELSE 'منتج اختبار كتالوج ' || LPAD(series::TEXT, 3, '0')
    END,
    v_category_id,
    v_piece_unit_id,
    v_sale_unit_id,
    1,
    1000,
    1000,
    true
  FROM generate_series(1, 201) AS series;
END;
$$;

DO $$
DECLARE
  v_page JSONB;
  v_search JSONB;
BEGIN
  v_page := public.get_public_storefront_catalog_page(
    24, 192, NULL, NULL, 'all', 'name_asc', NULL, NULL, NULL
  );
  IF (v_page->>'total')::INTEGER <> 201 THEN
    RAISE EXCEPTION 'Expected 201 catalog families, received %.', v_page->>'total';
  END IF;
  IF (v_page->>'offset')::INTEGER <> 192
     OR jsonb_array_length(v_page->'items') <> 9 THEN
    RAISE EXCEPTION 'Expected final server page to return 9 rows at offset 192.';
  END IF;

  v_search := public.get_public_storefront_catalog_page(
    24, 0, NULL, 'CATALOG-RUNTIME-201', 'all', 'recommended', NULL, NULL, NULL
  );
  IF (v_search->>'total')::INTEGER <> 1
     OR COALESCE(v_search->'items'->0->>'sku', '') <> 'CATALOG-RUNTIME-201' THEN
    RAISE EXCEPTION 'Expected server-side search to locate product 201.';
  END IF;
END;
$$;

ROLLBACK;
