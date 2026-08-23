-- =========================================================================
-- Nawasrah ERP - Migration 063
-- Category cover images managed from the admin app and exposed safely in the
-- public storefront catalog.
-- =========================================================================

BEGIN;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'categories_image_url_length_check'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_image_url_length_check
      CHECK (image_url IS NULL OR char_length(image_url) <= 2048);
  END IF;
END;
$$;

-- The four-argument function is the canonical category mutation path.
-- It accepts only a public URL that points to an object already present in
-- the existing public product-images bucket; arbitrary external image URLs
-- are deliberately rejected.
CREATE OR REPLACE FUNCTION public.save_product_category(
  p_name_ar TEXT,
  p_category_id UUID,
  p_code TEXT,
  p_image_url TEXT
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
  v_image_url TEXT := NULLIF(BTRIM(p_image_url), '');
  v_storage_path TEXT;
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

  IF v_image_url IS NOT NULL THEN
    v_storage_path := SPLIT_PART(
      v_image_url,
      '/storage/v1/object/public/product-images/',
      2
    );

    IF v_storage_path = v_image_url
      OR v_storage_path = ''
      OR NOT EXISTS (
        SELECT 1
        FROM storage.objects o
        WHERE o.bucket_id = 'product-images'
          AND o.name = v_storage_path
      )
    THEN
      RAISE EXCEPTION 'صورة القسم يجب أن تكون مرفوعة من تطبيق الإدارة.';
    END IF;
  END IF;

  INSERT INTO public.categories (
    id,
    code,
    name_ar,
    image_url,
    is_active
  ) VALUES (
    v_category_id,
    v_code,
    v_name_ar,
    v_image_url,
    true
  )
  ON CONFLICT (id) DO UPDATE
  SET
    code = EXCLUDED.code,
    name_ar = EXCLUDED.name_ar,
    image_url = EXCLUDED.image_url,
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
    jsonb_build_object(
      'name_ar', v_name_ar,
      'code', v_code,
      'has_image', v_image_url IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'categoryId', v_category_id,
    'code', v_code,
    'nameAr', v_name_ar,
    'imageUrl', v_image_url,
    'message', CASE
      WHEN v_is_new THEN 'تمت إضافة القسم بنجاح.'
      ELSE 'تم تحديث القسم بنجاح.'
    END
  );
END;
$$;

-- Keep the former three-argument contract working for a currently open or
-- cached admin session. Updating a name/code through that legacy call keeps
-- the existing cover image instead of clearing it.
CREATE OR REPLACE FUNCTION public.save_product_category(
  p_name_ar TEXT,
  p_category_id UUID DEFAULT NULL,
  p_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.save_product_category(
    p_name_ar,
    p_category_id,
    p_code,
    (
      SELECT c.image_url
      FROM public.categories c
      WHERE c.id = p_category_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.save_product_category(TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category(TEXT, UUID, TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.save_product_category(TEXT, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category(TEXT, UUID, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.save_product_category(TEXT, UUID, TEXT, TEXT) IS
  'Canonical audited product-category save RPC. Category image URLs must reference an existing public product-images object.';

-- Keep get_public_product_catalog as the canonical catalog query and enrich
-- its category payload in the existing storefront-safe wrapper.
CREATE OR REPLACE FUNCTION public.get_public_storefront_catalog(
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
  WITH base AS (
    SELECT public.get_public_product_catalog(
      p_limit,
      p_offset,
      p_category_id,
      p_search
    ) AS payload
  ),
  enriched_items AS (
    SELECT
      item.ordinality,
      item.value || jsonb_build_object(
        'createdAt', p.created_at,
        'soldPackagesLast90Days', COALESCE(sales.sold_packages, 0)
      ) AS value
    FROM base
    CROSS JOIN LATERAL jsonb_array_elements(base.payload->'items')
      WITH ORDINALITY AS item(value, ordinality)
    JOIN public.products p ON p.id = (item.value->>'id')::UUID
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id
        AND o.status = 'completed'
        AND o.created_at >= NOW() - INTERVAL '90 days'
    ) sales ON true
  ),
  enriched_categories AS (
    SELECT
      category.ordinality,
      category.value || jsonb_build_object(
        'imageUrl', c.image_url
      ) AS value
    FROM base
    CROSS JOIN LATERAL jsonb_array_elements(base.payload->'categories')
      WITH ORDINALITY AS category(value, ordinality)
    LEFT JOIN public.categories c
      ON c.id = (category.value->>'id')::UUID
  )
  SELECT jsonb_set(
    jsonb_set(
      base.payload,
      '{items}',
      COALESCE(
        (SELECT jsonb_agg(value ORDER BY ordinality) FROM enriched_items),
        '[]'::jsonb
      )
    ),
    '{categories}',
    COALESCE(
      (SELECT jsonb_agg(value ORDER BY ordinality) FROM enriched_categories),
      '[]'::jsonb
    )
  )
  FROM base;
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_storefront_catalog(
  INTEGER, INTEGER, UUID, TEXT
) IS
  'Storefront-safe wholesale catalog with real sales metrics and optional administrator-managed category cover images.';

COMMIT;
