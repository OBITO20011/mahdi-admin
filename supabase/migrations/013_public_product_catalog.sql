-- =========================================================================
-- Nawasrah ERP - Migration 013
-- Safe public catalog for the customer website.
-- =========================================================================

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
      u.name_ar AS unit_name_ar,
      p.sale_price_in_minor_units,
      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
      image.image_url
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN public.units u ON u.id = p.unit_id
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
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'imageUrl', image_url,
          'isAvailable', available_quantity > 0
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
  'Public customer catalog. Exposes sale price and available stock only; never cost or supplier data.';

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

-- The website order RPC is intentionally public, but the grant is explicit.
REVOKE ALL ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) TO anon, authenticated;

-- Product images are business data and must use a protected, audited RPC.
CREATE OR REPLACE FUNCTION public.set_product_primary_image(
  p_product_id UUID,
  p_image_url TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_image_id UUID;
  v_image_url TEXT := NULLIF(TRIM(p_image_url), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تحديث صورة المنتج'
  );

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'معرف المنتج مطلوب.';
  END IF;
  IF v_image_url IS NULL THEN
    RAISE EXCEPTION 'رابط صورة المنتج مطلوب.';
  END IF;

  PERFORM 1
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  UPDATE public.product_images
  SET is_primary = false
  WHERE product_id = p_product_id
    AND is_primary = true;

  SELECT id
  INTO v_image_id
  FROM public.product_images
  WHERE product_id = p_product_id
    AND image_url = v_image_url
  ORDER BY created_at
  LIMIT 1;

  IF v_image_id IS NULL THEN
    INSERT INTO public.product_images (
      product_id,
      image_url,
      is_primary,
      display_order
    ) VALUES (
      p_product_id,
      v_image_url,
      true,
      1
    )
    RETURNING id INTO v_image_id;
  ELSE
    UPDATE public.product_images
    SET
      is_primary = true,
      display_order = 1
    WHERE id = v_image_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'SET_PRODUCT_PRIMARY_IMAGE',
    'products',
    p_product_id,
    jsonb_build_object(
      'product_image_id', v_image_id,
      'image_url', v_image_url
    )
  );

  RETURN v_image_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_primary_image(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_primary_image(UUID, TEXT)
  TO authenticated;
