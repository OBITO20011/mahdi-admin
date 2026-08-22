-- =========================================================================
-- Nawasrah ERP - Migration 031
-- Canonical storefront categories and category-aware public catalog.
-- =========================================================================

-- Seed the practical wholesale departments requested for the storefront.
-- Existing rows are kept and re-used; this migration never deletes a custom
-- category or changes product assignments.
INSERT INTO public.categories (code, name_ar, is_active)
VALUES
  ('CAT-BEV', 'مشروبات وعصائر', true),
  ('CAT-WATER', 'مياه', true),
  ('CAT-ENERGY', 'مشروبات طاقة', true),
  ('CAT-BISCUIT', 'بسكويت وويفر', true),
  ('CAT-CAKE', 'كيك', true),
  ('CAT-CHOCO', 'شوكولاتة', true),
  ('CAT-CANDY', 'كاندي وسكاكر', true),
  ('CAT-GUM', 'علكة', true),
  ('CAT-CHIPS', 'شيبس وتسالي', true),
  ('CAT-FOOD', 'مواد غذائية', true),
  ('CAT-GIFTS', 'علب هدايا', true),
  ('CAT-OFFERS', 'عروض خاصة', true)
ON CONFLICT (code) DO UPDATE
SET
  name_ar = EXCLUDED.name_ar,
  is_active = true;

-- The public response contains only storefront-safe product fields plus
-- active category metadata and counters. Purchase cost and supplier data are
-- intentionally absent.
CREATE OR REPLACE FUNCTION public.get_public_product_catalog(
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0,
  p_category_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH catalog_source AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
      c.code AS category_code,
      c.name_ar AS category_name_ar,
      p.brand_id,
      b.name_ar AS brand_name_ar,
      p.unit_id,
      base_unit.name_ar AS unit_name_ar,
      p.sale_unit_id,
      sale_unit.name_ar AS sale_unit_name_ar,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
      image.image_url
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN public.units base_unit ON base_unit.id = p.unit_id
    LEFT JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN LATERAL (
      SELECT
        SUM(
          GREATEST(
            ib.on_hand_quantity - ib.reserved_quantity,
            0
          )
        ) AS available_quantity
      FROM public.inventory_balances ib
      WHERE ib.product_id = p.id
    ) stock ON true
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND c.is_active = true
      AND p.sale_unit_id IS NOT NULL
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  catalog AS (
    SELECT *
    FROM catalog_source
    WHERE (p_category_id IS NULL OR category_id = p_category_id)
      AND (
        NULLIF(TRIM(p_search), '') IS NULL
        OR name_ar ILIKE '%' || TRIM(p_search) || '%'
        OR sku ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(barcode, '') ILIKE '%' || TRIM(p_search) || '%'
      )
  ),
  paged AS (
    SELECT *
    FROM catalog
    ORDER BY name_ar, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      COUNT(cs.id)::INTEGER AS product_count,
      COUNT(cs.id) FILTER (
        WHERE cs.available_quantity >= cs.units_per_sale_unit
      )::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10
        WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30
        WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50
        WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70
        WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90
        WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110
        WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN catalog_source cs ON cs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar
  )
  SELECT jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'sku', sku,
          'barcode', barcode,
          'nameAr', name_ar,
          'description', description,
          'categoryId', category_id,
          'categoryCode', category_code,
          'categoryNameAr', category_name_ar,
          'brandId', brand_id,
          'brandNameAr', brand_name_ar,
          'unitId', unit_id,
          'unitNameAr', unit_name_ar,
          'saleUnitId', sale_unit_id,
          'saleUnitNameAr', sale_unit_name_ar,
          'unitsPerSalePackage', units_per_sale_unit,
          'salePackagePriceInMinorUnits',
            default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'availableSalePackages',
            FLOOR(available_quantity::NUMERIC / units_per_sale_unit),
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', available_quantity >= units_per_sale_unit
        )
        ORDER BY name_ar, id
      )
      FROM paged
    ), '[]'::jsonb),
    'categories',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'code', code,
          'nameAr', name_ar,
          'productCount', product_count,
          'availableProductCount', available_product_count
        )
        ORDER BY sort_order, name_ar, id
      )
      FROM category_summary
    ), '[]'::jsonb),
    'total', (SELECT COUNT(*) FROM catalog),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$$;

COMMENT ON FUNCTION public.get_public_product_catalog(
  INTEGER,
  INTEGER,
  UUID,
  TEXT
) IS
  'Public wholesale catalog with active category counters. Exposes sale-package and availability data only; never purchase cost or supplier data.';

REVOKE ALL ON FUNCTION public.get_public_product_catalog(
  INTEGER,
  INTEGER,
  UUID,
  TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_product_catalog(
  INTEGER,
  INTEGER,
  UUID,
  TEXT
) TO anon, authenticated;
