-- =========================================================================
-- Nawasrah ERP - Migration 019
-- Product catalog: real wholesale pricing and RPC-only category management.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Persist a real wholesale selling price per base unit.
-- -------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_price_in_minor_units BIGINT;

UPDATE public.products
SET wholesale_price_in_minor_units = sale_price_in_minor_units
WHERE wholesale_price_in_minor_units IS NULL;

ALTER TABLE public.products
  ALTER COLUMN wholesale_price_in_minor_units SET DEFAULT 0,
  ALTER COLUMN wholesale_price_in_minor_units SET NOT NULL;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_wholesale_price_nonnegative;

ALTER TABLE public.products
  ADD CONSTRAINT products_wholesale_price_nonnegative
  CHECK (wholesale_price_in_minor_units >= 0);

-- Active catalog categories must have distinct Arabic names.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_active_name_ar_unique
  ON public.categories (LOWER(BTRIM(name_ar)))
  WHERE is_active = true;

-- -------------------------------------------------------------------------
-- 2. Create product V2 wrapper.
--    The existing canonical RPC remains untouched for older clients.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock_v2(
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
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_wholesale_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INTEGER DEFAULT 0,
  p_max_stock_level INTEGER DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INTEGER DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_product_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة المنتجات والأرصدة الافتتاحية'
  );

  IF COALESCE(p_wholesale_price_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'سعر بيع الجملة لا يمكن أن يكون سالباً.';
  END IF;

  v_result := public.create_product_with_opening_stock(
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
    p_sale_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level,
    p_warehouse_id,
    p_opening_quantity,
    p_notes
  );

  v_product_id := NULLIF(v_result->>'product_id', '')::UUID;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم إرجاع معرف المنتج بعد إنشائه.';
  END IF;

  UPDATE public.products
  SET
    wholesale_price_in_minor_units = p_wholesale_price_in_minor_units,
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
    'SET_PRODUCT_WHOLESALE_PRICE',
    'products',
    v_product_id,
    jsonb_build_object(
      'wholesale_price_in_minor_units',
      p_wholesale_price_in_minor_units
    )
  );

  RETURN v_result || jsonb_build_object(
    'wholesale_price_in_minor_units',
    p_wholesale_price_in_minor_units
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 3. Update product V2 wrapper.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_master_v2(
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
  p_cost_price_in_minor_units BIGINT,
  p_sale_price_in_minor_units BIGINT,
  p_wholesale_price_in_minor_units BIGINT,
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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل بيانات المنتج'
  );

  IF COALESCE(p_wholesale_price_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'سعر بيع الجملة لا يمكن أن يكون سالباً.';
  END IF;

  v_result := public.update_product_master(
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
    p_sale_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level,
    p_is_active,
    p_image_url
  );

  UPDATE public.products
  SET
    wholesale_price_in_minor_units = p_wholesale_price_in_minor_units,
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
    'SET_PRODUCT_WHOLESALE_PRICE',
    'products',
    p_product_id,
    jsonb_build_object(
      'wholesale_price_in_minor_units',
      p_wholesale_price_in_minor_units
    )
  );

  RETURN v_result || jsonb_build_object(
    'wholesalePriceInMinorUnits',
    p_wholesale_price_in_minor_units
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 4. RPC-only category management.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_product_category(
  p_name_ar TEXT,
  p_category_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category_id UUID := COALESCE(p_category_id, gen_random_uuid());
  v_name_ar TEXT := NULLIF(BTRIM(p_name_ar), '');
  v_code TEXT;
  v_is_new BOOLEAN := p_category_id IS NULL;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة أقسام المنتجات'
  );

  IF v_name_ar IS NULL THEN
    RAISE EXCEPTION 'اسم القسم مطلوب.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id <> v_category_id
      AND c.is_active = true
      AND LOWER(BTRIM(c.name_ar)) = LOWER(v_name_ar)
  ) THEN
    RAISE EXCEPTION 'يوجد قسم نشط بهذا الاسم مسبقاً.';
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT c.code
    INTO v_code
    FROM public.categories c
    WHERE c.id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'القسم المحدد غير موجود.';
    END IF;
  END IF;

  IF NULLIF(BTRIM(p_code), '') IS NOT NULL THEN
    v_code := NULLIF(
      BTRIM(
        REGEXP_REPLACE(
          UPPER(BTRIM(p_code)),
          '[^A-Z0-9_-]+',
          '-',
          'g'
        ),
        '-'
      ),
      ''
    );
  END IF;

  v_code := COALESCE(
    v_code,
    'CAT-' || UPPER(SUBSTRING(REPLACE(v_category_id::TEXT, '-', '') FROM 1 FOR 8))
  );

  INSERT INTO public.categories (
    id,
    code,
    name_ar,
    is_active
  ) VALUES (
    v_category_id,
    v_code,
    v_name_ar,
    true
  )
  ON CONFLICT (id) DO UPDATE
  SET
    code = EXCLUDED.code,
    name_ar = EXCLUDED.name_ar,
    is_active = true;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE WHEN v_is_new THEN 'CREATE_PRODUCT_CATEGORY' ELSE 'UPDATE_PRODUCT_CATEGORY' END,
    'categories',
    v_category_id,
    jsonb_build_object('name_ar', v_name_ar, 'code', v_code)
  );

  RETURN jsonb_build_object(
    'success', true,
    'categoryId', v_category_id,
    'code', v_code,
    'nameAr', v_name_ar,
    'message', CASE
      WHEN v_is_new THEN 'تمت إضافة القسم بنجاح.'
      ELSE 'تم تحديث القسم بنجاح.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_category_active(
  p_category_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name_ar TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة أقسام المنتجات'
  );

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'معرف القسم مطلوب.';
  END IF;

  SELECT c.name_ar
  INTO v_name_ar
  FROM public.categories c
  WHERE c.id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'القسم المحدد غير موجود.';
  END IF;

  IF COALESCE(p_is_active, false) = false
    AND EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.category_id = p_category_id
        AND p.is_active = true
    ) THEN
    RAISE EXCEPTION 'لا يمكن إخفاء قسم يحتوي على أصناف نشطة. انقل الأصناف إلى قسم آخر أولاً.';
  END IF;

  UPDATE public.categories
  SET is_active = COALESCE(p_is_active, false)
  WHERE id = p_category_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN COALESCE(p_is_active, false) THEN 'RESTORE_PRODUCT_CATEGORY'
      ELSE 'ARCHIVE_PRODUCT_CATEGORY'
    END,
    'categories',
    p_category_id,
    jsonb_build_object(
      'name_ar', v_name_ar,
      'is_active', COALESCE(p_is_active, false)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'categoryId', p_category_id,
    'isActive', COALESCE(p_is_active, false),
    'message', CASE
      WHEN COALESCE(p_is_active, false) THEN 'تمت إعادة إظهار القسم.'
      ELSE 'تم إخفاء القسم.'
    END
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 5. Enforce RPC-only writes and expose only approved RPCs.
-- -------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v2(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v2(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_product_master_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_master_v2(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_category(TEXT, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category(TEXT, UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.set_product_category_active(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_category_active(UUID, BOOLEAN)
  TO authenticated;
