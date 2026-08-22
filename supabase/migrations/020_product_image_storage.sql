-- =========================================================================
-- Nawasrah ERP - Migration 020
-- Product image storage, role-scoped uploads, and atomic product creation.
-- =========================================================================

-- Product images are publicly readable for the customer catalog. Mutations
-- remain limited to authenticated ERP roles and each user's own folder.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Some older live deployments predate public.has_role(). Keep Storage
-- authorization self-contained and aligned with assert_erp_role().
CREATE OR REPLACE FUNCTION public.has_erp_role(
  p_allowed_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      JOIN public.roles r ON r.id = ur.role_id
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND r.code = ANY(p_allowed_roles)
    );
$$;

REVOKE ALL ON FUNCTION public.has_erp_role(TEXT[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_erp_role(TEXT[])
  TO authenticated;

DROP POLICY IF EXISTS "Public can read product images"
  ON storage.objects;
CREATE POLICY "Public can read product images"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "ERP staff can upload own product images"
  ON storage.objects;
CREATE POLICY "ERP staff can upload own product images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND public.has_erp_role(
      ARRAY['owner', 'admin', 'manager', 'warehouse_keeper']
    )
  );

DROP POLICY IF EXISTS "ERP staff can update own product images"
  ON storage.objects;
CREATE POLICY "ERP staff can update own product images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND public.has_erp_role(
      ARRAY['owner', 'admin', 'manager', 'warehouse_keeper']
    )
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND public.has_erp_role(
      ARRAY['owner', 'admin', 'manager', 'warehouse_keeper']
    )
  );

DROP POLICY IF EXISTS "ERP staff can delete own product images"
  ON storage.objects;
CREATE POLICY "ERP staff can delete own product images"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
    AND public.has_erp_role(
      ARRAY['owner', 'admin', 'manager', 'warehouse_keeper']
    )
  );

-- Create product V3 keeps the image association in the same PostgreSQL
-- transaction as the product and opening stock.
CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock_v3(
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
  v_image_url TEXT := NULLIF(BTRIM(p_image_url), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة المنتجات والأرصدة الافتتاحية'
  );

  v_result := public.create_product_with_opening_stock_v2(
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
    p_wholesale_price_in_minor_units,
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

  IF v_image_url IS NOT NULL THEN
    PERFORM public.set_product_primary_image(
      v_product_id,
      v_image_url
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'image_url',
    v_image_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v3(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v3(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT, TEXT
) TO authenticated;
