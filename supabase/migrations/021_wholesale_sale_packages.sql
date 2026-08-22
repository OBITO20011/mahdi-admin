-- =========================================================================
-- Nawasrah ERP - Migration 021
-- Wholesale-only sale packages and package-level profit truth.
-- =========================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_unit_id UUID,
  ADD COLUMN IF NOT EXISTS units_per_sale_unit INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_sale_price_in_minor_units BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_sale_unit_id_fkey'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_sale_unit_id_fkey
      FOREIGN KEY (sale_unit_id)
      REFERENCES public.units(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_units_per_sale_unit_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_units_per_sale_unit_check
      CHECK (units_per_sale_unit > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_default_sale_price_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_default_sale_price_check
      CHECK (default_sale_price_in_minor_units >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_products_sale_unit_id
  ON public.products(sale_unit_id);

-- Legacy prices were per base piece. Convert them once into the equivalent
-- package price so existing products retain their previous effective price.
UPDATE public.products
SET
  sale_unit_id = COALESCE(
    sale_unit_id,
    purchase_unit_id,
    unit_id
  ),
  units_per_sale_unit = CASE
    WHEN units_per_sale_unit > 1 THEN units_per_sale_unit
    ELSE GREATEST(1, units_per_purchase_unit)
  END,
  default_sale_price_in_minor_units = CASE
    WHEN default_sale_price_in_minor_units > 0
      THEN default_sale_price_in_minor_units
    ELSE
      COALESCE(
        NULLIF(wholesale_price_in_minor_units, 0),
        sale_price_in_minor_units,
        0
      )
      * CASE
          WHEN units_per_sale_unit > 1 THEN units_per_sale_unit
          ELSE GREATEST(1, units_per_purchase_unit)
        END
  END
WHERE
  sale_unit_id IS NULL
  OR units_per_sale_unit <= 1
  OR default_sale_price_in_minor_units = 0;

-- Never guess a wholesale package for legacy piece-only products. They stay
-- visible to admins for correction but are excluded from the public catalog.
UPDATE public.products p
SET
  sale_unit_id = NULL,
  default_sale_price_in_minor_units = 0,
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM public.units u
  WHERE u.id = p.sale_unit_id
    AND u.code = 'PCS'
);

COMMENT ON COLUMN public.products.sale_unit_id IS
  'Minimum wholesale package offered to customers.';
COMMENT ON COLUMN public.products.units_per_sale_unit IS
  'Base inventory pieces deducted for one wholesale sale package.';
COMMENT ON COLUMN public.products.default_sale_price_in_minor_units IS
  'Selling price of the complete wholesale package, in JOD fils.';

-- -------------------------------------------------------------------------
-- Atomic create wrapper for wholesale-only products.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock_v4(
  p_sku TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_name_ar TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_purchase_unit_id UUID DEFAULT NULL,
  p_units_per_purchase_unit INTEGER DEFAULT 1,
  p_default_purchase_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_unit_id UUID DEFAULT NULL,
  p_units_per_sale_unit INTEGER DEFAULT 1,
  p_default_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INTEGER DEFAULT 0,
  p_max_stock_level INTEGER DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INTEGER DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج',
  p_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_product_id UUID;
  v_unit_sale_price BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة منتج جملة'
  );

  IF COALESCE(p_units_per_sale_unit, 0) < 1 THEN
    RAISE EXCEPTION 'عدد الحبات داخل طرد البيع يجب أن يكون أكبر من صفر.';
  END IF;
  IF COALESCE(p_default_sale_price_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'سعر بيع طرد الجملة يجب أن يكون أكبر من صفر.';
  END IF;
  IF p_sale_unit_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.units
    WHERE id = p_sale_unit_id
      AND code = 'PCS'
  ) THEN
    RAISE EXCEPTION 'طرد البيع يجب أن يكون عبوة جملة وليس حبة أو قطعة.';
  END IF;

  -- Kept only as a backward-compatible per-piece accounting value.
  v_unit_sale_price := ROUND(
    p_default_sale_price_in_minor_units::NUMERIC
    / p_units_per_sale_unit
  )::BIGINT;

  v_result := public.create_product_with_opening_stock_v3(
    p_sku,
    p_barcode,
    p_name_ar,
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    p_purchase_unit_id,
    p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units,
    p_cost_price_in_minor_units,
    v_unit_sale_price,
    v_unit_sale_price,
    p_min_stock_level,
    p_max_stock_level,
    p_warehouse_id,
    p_opening_quantity,
    p_notes,
    p_image_url
  );

  v_product_id := NULLIF(v_result->>'product_id', '')::UUID;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم إرجاع معرف المنتج بعد إنشائه.';
  END IF;

  UPDATE public.products
  SET
    sale_unit_id = COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    units_per_sale_unit = p_units_per_sale_unit,
    default_sale_price_in_minor_units =
      p_default_sale_price_in_minor_units,
    updated_at = NOW()
  WHERE id = v_product_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'SET_PRODUCT_WHOLESALE_PACKAGE',
    'products',
    v_product_id,
    jsonb_build_object(
      'sale_unit_id',
      COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
      'units_per_sale_unit',
      p_units_per_sale_unit,
      'default_sale_price_in_minor_units',
      p_default_sale_price_in_minor_units
    )
  );

  RETURN v_result || jsonb_build_object(
    'saleUnitId',
    COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    'unitsPerSaleUnit',
    p_units_per_sale_unit,
    'defaultSalePriceInMinorUnits',
    p_default_sale_price_in_minor_units
  );
END;
$$;

-- -------------------------------------------------------------------------
-- Atomic update wrapper for wholesale-only products.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_master_v3(
  p_product_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_name_ar TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_brand_id UUID,
  p_unit_id UUID,
  p_purchase_unit_id UUID,
  p_units_per_purchase_unit INTEGER,
  p_default_purchase_price_in_minor_units BIGINT,
  p_sale_unit_id UUID,
  p_units_per_sale_unit INTEGER,
  p_default_sale_price_in_minor_units BIGINT,
  p_cost_price_in_minor_units BIGINT,
  p_min_stock_level INTEGER,
  p_max_stock_level INTEGER,
  p_is_active BOOLEAN,
  p_image_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_unit_sale_price BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل منتج جملة'
  );

  IF COALESCE(p_units_per_sale_unit, 0) < 1 THEN
    RAISE EXCEPTION 'عدد الحبات داخل طرد البيع يجب أن يكون أكبر من صفر.';
  END IF;
  IF COALESCE(p_default_sale_price_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'سعر بيع طرد الجملة يجب أن يكون أكبر من صفر.';
  END IF;
  IF p_sale_unit_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.units
    WHERE id = p_sale_unit_id
      AND code = 'PCS'
  ) THEN
    RAISE EXCEPTION 'طرد البيع يجب أن يكون عبوة جملة وليس حبة أو قطعة.';
  END IF;

  v_unit_sale_price := ROUND(
    p_default_sale_price_in_minor_units::NUMERIC
    / p_units_per_sale_unit
  )::BIGINT;

  v_result := public.update_product_master_v2(
    p_product_id,
    p_sku,
    p_barcode,
    p_name_ar,
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    p_purchase_unit_id,
    p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units,
    p_cost_price_in_minor_units,
    v_unit_sale_price,
    v_unit_sale_price,
    p_min_stock_level,
    p_max_stock_level,
    p_is_active,
    p_image_url
  );

  UPDATE public.products
  SET
    sale_unit_id = COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    units_per_sale_unit = p_units_per_sale_unit,
    default_sale_price_in_minor_units =
      p_default_sale_price_in_minor_units,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'UPDATE_PRODUCT_WHOLESALE_PACKAGE',
    'products',
    p_product_id,
    jsonb_build_object(
      'sale_unit_id',
      COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
      'units_per_sale_unit',
      p_units_per_sale_unit,
      'default_sale_price_in_minor_units',
      p_default_sale_price_in_minor_units
    )
  );

  RETURN v_result || jsonb_build_object(
    'saleUnitId',
    COALESCE(p_sale_unit_id, p_purchase_unit_id, p_unit_id),
    'unitsPerSaleUnit',
    p_units_per_sale_unit,
    'defaultSalePriceInMinorUnits',
    p_default_sale_price_in_minor_units
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v4(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER,
  TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v4(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER,
  TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_product_master_v3(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN,
  TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_master_v3(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN,
  TEXT
) TO authenticated;

-- -------------------------------------------------------------------------
-- Extend the public catalog without exposing purchase cost.
-- -------------------------------------------------------------------------
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
  WITH catalog AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
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
      AND p.sale_unit_id IS NOT NULL
      AND sale_unit.code <> 'PCS'
      AND p.default_sale_price_in_minor_units > 0
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (
        NULLIF(TRIM(p_search), '') IS NULL
        OR p.name_ar ILIKE '%' || TRIM(p_search) || '%'
        OR p.sku ILIKE '%' || TRIM(p_search) || '%'
        OR COALESCE(p.barcode, '') ILIKE '%' || TRIM(p_search) || '%'
      )
  ),
  paged AS (
    SELECT *
    FROM catalog
    ORDER BY name_ar, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
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
  'Public wholesale catalog. Exposes minimum sale package, package price, and package availability; never purchase cost.';
