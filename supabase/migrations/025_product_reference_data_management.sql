-- =========================================================================
-- Nawasrah ERP - Product reference data management
-- Persist brands and units through authenticated RPCs. Deletion in the UI is
-- a safe archive operation so existing products and historical documents keep
-- their references intact.
-- =========================================================================

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS conversion_factor INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.units
  DROP CONSTRAINT IF EXISTS units_conversion_factor_positive;

ALTER TABLE public.units
  ADD CONSTRAINT units_conversion_factor_positive
  CHECK (conversion_factor > 0);

UPDATE public.units
SET
  is_system = true,
  conversion_factor = CASE
    WHEN code = 'PCS' THEN 1
    ELSE GREATEST(conversion_factor, 1)
  END,
  updated_at = NOW()
WHERE code IN (
  'PCS',
  'CTN',
  'BOX',
  'PKT',
  'SHRINK',
  'BAG',
  'SACK',
  'BUNDLE',
  'CASE',
  'CAN',
  'BTL'
);

-- Older seed runs could insert the same Arabic brand name more than once
-- because the original table had no natural unique key. Keep the oldest row
-- as the canonical reference, relink active products, and archive the extras.
WITH ranked_brands AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(BTRIM(name_ar))
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(BTRIM(name_ar))
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.brands
)
UPDATE public.products p
SET
  brand_id = ranked_brands.canonical_id,
  updated_at = NOW()
FROM ranked_brands
WHERE ranked_brands.row_number > 1
  AND p.brand_id = ranked_brands.id;

WITH ranked_brands AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(BTRIM(name_ar))
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.brands
)
UPDATE public.brands b
SET
  is_active = false,
  updated_at = NOW()
FROM ranked_brands
WHERE ranked_brands.row_number > 1
  AND b.id = ranked_brands.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_active_name_ar_unique
  ON public.brands (LOWER(BTRIM(name_ar)))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_brands_is_active
  ON public.brands (is_active);

CREATE INDEX IF NOT EXISTS idx_units_is_active
  ON public.units (is_active);

-- -------------------------------------------------------------------------
-- Brand management
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_product_brand(
  p_name_ar TEXT,
  p_brand_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand_id UUID := p_brand_id;
  v_name_ar TEXT := NULLIF(BTRIM(p_name_ar), '');
  v_existing_active BOOLEAN;
  v_is_new BOOLEAN := p_brand_id IS NULL;
  v_was_restored BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة العلامات التجارية'
  );

  IF v_name_ar IS NULL THEN
    RAISE EXCEPTION 'اسم العلامة التجارية مطلوب.';
  END IF;

  IF p_brand_id IS NULL THEN
    SELECT b.id, b.is_active
    INTO v_brand_id, v_existing_active
    FROM public.brands b
    WHERE LOWER(BTRIM(b.name_ar)) = LOWER(v_name_ar)
    ORDER BY b.is_active DESC, b.created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_existing_active THEN
      RAISE EXCEPTION 'توجد علامة تجارية نشطة بهذا الاسم مسبقاً.';
    ELSIF FOUND THEN
      v_was_restored := true;
      v_is_new := false;
    ELSE
      v_brand_id := gen_random_uuid();
    END IF;
  ELSE
    PERFORM 1
    FROM public.brands
    WHERE id = p_brand_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'العلامة التجارية المحددة غير موجودة.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id <> v_brand_id
      AND b.is_active = true
      AND LOWER(BTRIM(b.name_ar)) = LOWER(v_name_ar)
  ) THEN
    RAISE EXCEPTION 'توجد علامة تجارية نشطة بهذا الاسم مسبقاً.';
  END IF;

  INSERT INTO public.brands (
    id,
    name_ar,
    description,
    logo_url,
    is_active,
    updated_at
  ) VALUES (
    v_brand_id,
    v_name_ar,
    NULLIF(BTRIM(p_description), ''),
    NULLIF(BTRIM(p_logo_url), ''),
    true,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    name_ar = EXCLUDED.name_ar,
    description = EXCLUDED.description,
    logo_url = EXCLUDED.logo_url,
    is_active = true,
    updated_at = NOW();

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN v_was_restored THEN 'RESTORE_PRODUCT_BRAND'
      WHEN v_is_new THEN 'CREATE_PRODUCT_BRAND'
      ELSE 'UPDATE_PRODUCT_BRAND'
    END,
    'brands',
    v_brand_id,
    jsonb_build_object(
      'name_ar', v_name_ar,
      'logo_url', NULLIF(BTRIM(p_logo_url), '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'brandId', v_brand_id,
    'nameAr', v_name_ar,
    'isActive', true,
    'message', CASE
      WHEN v_was_restored THEN 'تمت إعادة تفعيل العلامة التجارية.'
      WHEN v_is_new THEN 'تمت إضافة العلامة التجارية بنجاح.'
      ELSE 'تم تحديث العلامة التجارية بنجاح.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_brand_active(
  p_brand_id UUID,
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
    'إدارة العلامات التجارية'
  );

  SELECT name_ar
  INTO v_name_ar
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العلامة التجارية المحددة غير موجودة.';
  END IF;

  IF COALESCE(p_is_active, false) = false
    AND EXISTS (
      SELECT 1
      FROM public.products
      WHERE brand_id = p_brand_id
        AND is_active = true
    )
  THEN
    RAISE EXCEPTION 'لا يمكن إخفاء علامة مرتبطة بأصناف نشطة. عدّل الأصناف أولاً.';
  END IF;

  UPDATE public.brands
  SET
    is_active = COALESCE(p_is_active, false),
    updated_at = NOW()
  WHERE id = p_brand_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN COALESCE(p_is_active, false) THEN 'RESTORE_PRODUCT_BRAND'
      ELSE 'ARCHIVE_PRODUCT_BRAND'
    END,
    'brands',
    p_brand_id,
    jsonb_build_object(
      'name_ar', v_name_ar,
      'is_active', COALESCE(p_is_active, false)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'brandId', p_brand_id,
    'isActive', COALESCE(p_is_active, false),
    'message', CASE
      WHEN COALESCE(p_is_active, false) THEN 'تمت إعادة إظهار العلامة التجارية.'
      ELSE 'تم إخفاء العلامة التجارية.'
    END
  );
END;
$$;

-- -------------------------------------------------------------------------
-- Unit management
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_product_unit(
  p_name_ar TEXT,
  p_code TEXT,
  p_conversion_factor INTEGER DEFAULT 1,
  p_unit_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_id UUID := p_unit_id;
  v_name_ar TEXT := NULLIF(BTRIM(p_name_ar), '');
  v_code TEXT := NULLIF(
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
  v_existing_active BOOLEAN;
  v_existing_system BOOLEAN;
  v_is_new BOOLEAN := p_unit_id IS NULL;
  v_was_restored BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة وحدات القياس والتعبئة'
  );

  IF v_name_ar IS NULL THEN
    RAISE EXCEPTION 'اسم الوحدة مطلوب.';
  END IF;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'كود الوحدة مطلوب.';
  END IF;
  IF COALESCE(p_conversion_factor, 0) <= 0 THEN
    RAISE EXCEPTION 'معامل التعبئة يجب أن يكون عدداً صحيحاً أكبر من صفر.';
  END IF;

  IF p_unit_id IS NULL THEN
    SELECT u.id, u.is_active, u.is_system
    INTO v_unit_id, v_existing_active, v_existing_system
    FROM public.units u
    WHERE u.code = v_code
    FOR UPDATE;

    IF FOUND AND v_existing_active THEN
      RAISE EXCEPTION 'يوجد كود وحدة نشط بهذا الاسم مسبقاً.';
    ELSIF FOUND AND v_existing_system THEN
      RAISE EXCEPTION 'لا يمكن استبدال وحدة نظام أساسية.';
    ELSIF FOUND THEN
      v_was_restored := true;
      v_is_new := false;
    ELSE
      v_unit_id := gen_random_uuid();
    END IF;
  ELSE
    SELECT is_system
    INTO v_existing_system
    FROM public.units
    WHERE id = p_unit_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'وحدة القياس المحددة غير موجودة.';
    END IF;
    IF v_existing_system THEN
      RAISE EXCEPTION 'وحدات النظام الأساسية محمية من التعديل.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.units
    WHERE id <> v_unit_id
      AND code = v_code
  ) THEN
    RAISE EXCEPTION 'كود الوحدة مستخدم مسبقاً.';
  END IF;

  INSERT INTO public.units (
    id,
    code,
    name_ar,
    conversion_factor,
    is_system,
    is_active,
    updated_at
  ) VALUES (
    v_unit_id,
    v_code,
    v_name_ar,
    p_conversion_factor,
    false,
    true,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    code = EXCLUDED.code,
    name_ar = EXCLUDED.name_ar,
    conversion_factor = EXCLUDED.conversion_factor,
    is_active = true,
    updated_at = NOW();

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN v_was_restored THEN 'RESTORE_PRODUCT_UNIT'
      WHEN v_is_new THEN 'CREATE_PRODUCT_UNIT'
      ELSE 'UPDATE_PRODUCT_UNIT'
    END,
    'units',
    v_unit_id,
    jsonb_build_object(
      'name_ar', v_name_ar,
      'code', v_code,
      'conversion_factor', p_conversion_factor
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'unitId', v_unit_id,
    'nameAr', v_name_ar,
    'code', v_code,
    'conversionFactor', p_conversion_factor,
    'isActive', true,
    'message', CASE
      WHEN v_was_restored THEN 'تمت إعادة تفعيل وحدة القياس.'
      WHEN v_is_new THEN 'تمت إضافة وحدة القياس بنجاح.'
      ELSE 'تم تحديث وحدة القياس بنجاح.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_unit_active(
  p_unit_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name_ar TEXT;
  v_is_system BOOLEAN;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة وحدات القياس والتعبئة'
  );

  SELECT name_ar, is_system
  INTO v_name_ar, v_is_system
  FROM public.units
  WHERE id = p_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'وحدة القياس المحددة غير موجودة.';
  END IF;

  IF COALESCE(p_is_active, false) = false AND v_is_system THEN
    RAISE EXCEPTION 'وحدة نظام أساسية ولا يمكن إخفاؤها.';
  END IF;

  IF COALESCE(p_is_active, false) = false
    AND EXISTS (
      SELECT 1
      FROM public.products
      WHERE is_active = true
        AND (
          unit_id = p_unit_id
          OR purchase_unit_id = p_unit_id
          OR sale_unit_id = p_unit_id
        )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن إخفاء وحدة مرتبطة بأصناف نشطة. عدّل الأصناف أولاً.';
  END IF;

  UPDATE public.units
  SET
    is_active = COALESCE(p_is_active, false),
    updated_at = NOW()
  WHERE id = p_unit_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN COALESCE(p_is_active, false) THEN 'RESTORE_PRODUCT_UNIT'
      ELSE 'ARCHIVE_PRODUCT_UNIT'
    END,
    'units',
    p_unit_id,
    jsonb_build_object(
      'name_ar', v_name_ar,
      'is_active', COALESCE(p_is_active, false)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'unitId', p_unit_id,
    'isActive', COALESCE(p_is_active, false),
    'message', CASE
      WHEN COALESCE(p_is_active, false) THEN 'تمت إعادة إظهار وحدة القياس.'
      ELSE 'تم إخفاء وحدة القياس.'
    END
  );
END;
$$;

-- Reference-data writes are RPC-only.
REVOKE INSERT, UPDATE, DELETE ON public.brands FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.units FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.save_product_brand(TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_brand(TEXT, UUID, TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.set_product_brand_active(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_brand_active(UUID, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_unit(TEXT, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_unit(TEXT, TEXT, INTEGER, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.set_product_unit_active(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_unit_active(UUID, BOOLEAN)
  TO authenticated;
