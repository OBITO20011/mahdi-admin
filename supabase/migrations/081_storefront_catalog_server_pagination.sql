BEGIN;

-- The legacy storefront RPC remains available for backwards compatibility.
-- This endpoint pages *product families* so a flavor master and its sellable
-- flavors are never separated across browser pages.
CREATE OR REPLACE FUNCTION public.get_public_storefront_catalog_page(
  p_limit INTEGER DEFAULT 24,
  p_offset INTEGER DEFAULT 0,
  p_category_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_availability TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'recommended',
  p_brand_id UUID DEFAULT NULL,
  p_sale_unit_id UUID DEFAULT NULL,
  p_product_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH stock_by_product AS (
    SELECT
      ib.product_id,
      COALESCE(SUM(GREATEST(ib.on_hand_quantity - ib.reserved_quantity, 0)), 0)::INTEGER
        AS available_quantity
    FROM public.inventory_balances ib
    GROUP BY ib.product_id
  ),
  sales_by_product AS (
    SELECT
      oi.product_id,
      COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'completed'
      AND o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY oi.product_id
  ),
  catalog_source AS (
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
      image.image_url,
      p.created_at,
      COALESCE(sales.sold_packages, 0)::BIGINT AS sold_packages_last_90_days,
      p.flavor_master_product_id,
      p.flavor_name_ar,
      p.is_flavor_master,
      p.flavor_sort_order,
      COALESCE(p.flavor_master_product_id, p.id) AS family_id
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.is_active = true
    LEFT JOIN public.brands b ON b.id = p.brand_id
    JOIN public.units base_unit ON base_unit.id = p.unit_id
    JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN stock_by_product stock ON stock.product_id = p.id
    LEFT JOIN sales_by_product sales ON sales.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  family_summary AS (
    SELECT
      family_id,
      MIN(category_id::TEXT)::UUID AS category_id,
      MIN(category_code) AS category_code,
      MIN(brand_id::TEXT)::UUID AS brand_id,
      MIN(sale_unit_id::TEXT)::UUID AS sale_unit_id,
      COALESCE(
        MIN(name_ar) FILTER (WHERE flavor_master_product_id IS NULL),
        MIN(name_ar)
      ) AS family_name_ar,
      MIN(default_sale_price_in_minor_units) AS sale_price_in_minor_units,
      COALESCE(SUM(
        FLOOR(available_quantity::NUMERIC / units_per_sale_unit)
      ) FILTER (WHERE NOT is_flavor_master), 0)::INTEGER AS available_sale_packages,
      BOOL_OR(
        NOT is_flavor_master
        AND available_quantity >= units_per_sale_unit
      ) AS is_available,
      BOOL_OR(
        NOT is_flavor_master
        AND available_quantity >= units_per_sale_unit
        AND FLOOR(available_quantity::NUMERIC / units_per_sale_unit) <= 5
      ) AS is_low_stock,
      MAX(created_at) AS created_at,
      COALESCE(SUM(sold_packages_last_90_days) FILTER (WHERE NOT is_flavor_master), 0)::BIGINT
        AS sold_packages_last_90_days
    FROM catalog_source
    GROUP BY family_id
  ),
  normalized_search AS (
    SELECT LOWER(TRANSLATE(
      REGEXP_REPLACE(COALESCE(NULLIF(BTRIM(p_search), ''), ''), '[ً-ٰٟـ]', '', 'g'),
      'أإآى',
      'اااي'
    )) AS value
  ),
  matching_families AS (
    SELECT fs.*
    FROM family_summary fs
    CROSS JOIN normalized_search normalized
    WHERE (p_category_id IS NULL OR fs.category_id = p_category_id)
      AND (p_brand_id IS NULL OR fs.brand_id = p_brand_id)
      AND (p_sale_unit_id IS NULL OR fs.sale_unit_id = p_sale_unit_id)
      AND (
        p_product_ids IS NULL
        OR fs.family_id = ANY (p_product_ids)
        OR EXISTS (
          SELECT 1
          FROM catalog_source favorite_member
          WHERE favorite_member.family_id = fs.family_id
            AND favorite_member.id = ANY (p_product_ids)
        )
      )
      AND (
        p_availability NOT IN ('available', 'low_stock')
        OR (p_availability = 'available' AND fs.is_available)
        OR (p_availability = 'low_stock' AND fs.is_low_stock)
      )
      AND (p_sort <> 'offers' OR fs.category_code = 'CAT-OFFERS')
      AND (p_sort <> 'low_stock' OR fs.is_low_stock)
      AND (
        normalized.value = ''
        OR EXISTS (
          SELECT 1
          FROM catalog_source searched_member
          WHERE searched_member.family_id = fs.family_id
            AND (
              LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.name_ar, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.sku, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.barcode, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.description, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.brand_name_ar, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
            )
        )
      )
  ),
  paged_families AS (
    SELECT
      mf.*,
      ROW_NUMBER() OVER (
        ORDER BY
          mf.is_available DESC,
          CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
          CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
          CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
          CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
          CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
          CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
          CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
          mf.family_name_ar ASC,
          mf.family_id ASC
      ) AS page_order
    FROM matching_families mf
    ORDER BY
      mf.is_available DESC,
      CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
      CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
      CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
      CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
      CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
      CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
      CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
      mf.family_name_ar ASC,
      mf.family_id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  page_items AS (
    SELECT
      pf.page_order,
      cs.*
    FROM paged_families pf
    JOIN catalog_source cs ON cs.family_id = pf.family_id
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.image_url,
      COUNT(fs.family_id)::INTEGER AS product_count,
      COUNT(fs.family_id) FILTER (WHERE fs.is_available)::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10 WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30 WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50 WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70 WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90 WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110 WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN family_summary fs ON fs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar, c.image_url
  ),
  brand_facets AS (
    SELECT fs.brand_id AS id, MIN(cs.brand_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.brand_id IS NOT NULL
    GROUP BY fs.brand_id
  ),
  sale_unit_facets AS (
    SELECT fs.sale_unit_id AS id, MIN(cs.sale_unit_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.sale_unit_id IS NOT NULL
    GROUP BY fs.sale_unit_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
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
          'salePackagePriceInMinorUnits', default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'availableSalePackages', FLOOR(available_quantity::NUMERIC / units_per_sale_unit),
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', available_quantity >= units_per_sale_unit AND NOT is_flavor_master,
          'createdAt', created_at,
          'soldPackagesLast90Days', sold_packages_last_90_days,
          'flavorMasterProductId', flavor_master_product_id,
          'flavorNameAr', flavor_name_ar,
          'isFlavorMaster', is_flavor_master,
          'flavorSortOrder', flavor_sort_order
        )
        ORDER BY page_order,
          CASE WHEN flavor_master_product_id IS NULL THEN 0 ELSE 1 END,
          flavor_sort_order,
          name_ar,
          id
      )
      FROM page_items
    ), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'nameAr', name_ar, 'imageUrl', image_url,
        'productCount', product_count, 'availableProductCount', available_product_count
      ) ORDER BY sort_order, name_ar, id)
      FROM category_summary
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM brand_facets
    ), '[]'::jsonb),
    'saleUnits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM sale_unit_facets
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'availableProducts', (SELECT COUNT(*) FROM matching_families WHERE is_available),
      'availableSalePackages', (SELECT COALESCE(SUM(available_sale_packages), 0) FROM matching_families),
      'lowStockProducts', (SELECT COUNT(*) FROM matching_families WHERE is_low_stock)
    ),
    'total', (SELECT COUNT(*) FROM matching_families),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_catalog_page(
  INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_catalog_page(
  INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID[]
) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_storefront_catalog_page(
  INTEGER, INTEGER, UUID, TEXT, TEXT, TEXT, UUID, UUID, UUID[]
) IS
  'Public, family-safe storefront catalog pagination. Search and all catalog filters execute server-side; no costs or supplier data are exposed.';

COMMIT;
