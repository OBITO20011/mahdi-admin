-- Owner decision 2026-10-15: product edits use optimistic concurrency.
-- The editor sends the products.updated_at it opened; the save is refused
-- when the row changed since then, instead of silently overwriting it.
-- Pricing, stock and cost logic stay in update_product_master_v3 and
-- update_product_flavor_v1 unchanged; the new entry points only lock the row,
-- compare the version and then delegate. products.updated_at is maintained by
-- trg_update_products_updated_at (001) and every product writer.

CREATE FUNCTION public.product_edit_snapshot_internal(p_product_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'productId', product.id,
    'updatedAt', product.updated_at,
    'nameAr', product.name_ar,
    'sku', product.sku,
    'barcode', product.barcode,
    'description', product.description,
    'categoryId', product.category_id,
    'brandId', product.brand_id,
    'unitName', base_unit.name_ar,
    'purchasePackage', purchase_unit.name_ar,
    'unitsPerPackage', product.units_per_purchase_unit,
    'defaultPurchasePriceInMinorUnits', product.default_purchase_price_in_minor_units,
    'salePackage', sale_unit.name_ar,
    'unitsPerSalePackage', product.units_per_sale_unit,
    'salePackagePriceInMinorUnits', product.default_sale_price_in_minor_units,
    'costPriceInMinorUnits', product.cost_price_in_minor_units,
    'minStockLevel', product.min_stock_level,
    'maxStockLevel', product.max_stock_level,
    'isActive', product.is_active,
    'flavorNameAr', product.flavor_name_ar,
    'imageUrl', (
      SELECT image.image_url
      FROM public.product_images image
      WHERE image.product_id = product.id AND image.is_primary = true
      ORDER BY image.display_order, image.created_at
      LIMIT 1
    )
  )
  FROM public.products product
  LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
  LEFT JOIN public.units purchase_unit ON purchase_unit.id = product.purchase_unit_id
  LEFT JOIN public.units sale_unit ON sale_unit.id = product.sale_unit_id
  WHERE product.id = p_product_id;
$$;

REVOKE ALL ON FUNCTION public.product_edit_snapshot_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_edit_snapshot_internal(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.product_edit_snapshot_internal(UUID) FROM authenticated;

-- Locks the product row for the rest of the transaction and refuses a stale
-- version. A concurrent saver waits on the lock and then sees the new version.
CREATE FUNCTION public.product_edit_assert_version_internal(
  p_product_id UUID,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current TIMESTAMPTZ;
BEGIN
  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_EDIT_VERSION_REQUIRED: أعد فتح المنتج ثم احفظ التعديل.';
  END IF;

  SELECT product.updated_at
  INTO v_current
  FROM public.products product
  WHERE product.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  IF v_current IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'PRODUCT_EDIT_CONFLICT: عدّل مستخدم آخر هذا المنتج قبل قليل.',
      DETAIL = public.product_edit_snapshot_internal(p_product_id)::TEXT,
      HINT = 'اعرض القيم الحالية ثم أعد تطبيق تعديلاتك.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.product_edit_assert_version_internal(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.product_edit_assert_version_internal(UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.product_edit_assert_version_internal(UUID, TIMESTAMPTZ) FROM authenticated;

CREATE FUNCTION public.update_product_master_v4(
  p_product_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل منتج جملة'
  );
  PERFORM public.product_edit_assert_version_internal(p_product_id, p_expected_updated_at);

  v_result := public.update_product_master_v3(
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
    p_sale_unit_id,
    p_units_per_sale_unit,
    p_default_sale_price_in_minor_units,
    p_cost_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level,
    p_is_active,
    p_image_url
  );

  RETURN v_result || jsonb_build_object(
    'updatedAt',
    (SELECT product.updated_at FROM public.products product WHERE product.id = p_product_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_product_master_v4(
  UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO authenticated;

CREATE FUNCTION public.update_product_flavor_v2(
  p_flavor_product_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_flavor_name_ar TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
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
    'تعديل نكهة المنتج'
  );
  PERFORM public.product_edit_assert_version_internal(p_flavor_product_id, p_expected_updated_at);

  v_result := public.update_product_flavor_v1(
    p_flavor_product_id,
    p_flavor_name_ar,
    p_barcode,
    p_image_url,
    p_is_active
  );

  RETURN v_result || jsonb_build_object(
    'updatedAt',
    (SELECT product.updated_at FROM public.products product WHERE product.id = p_flavor_product_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_flavor_v2(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_product_flavor_v2(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_product_flavor_v2(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- The unversioned entry points stay as the internal bodies only; clients can
-- no longer bypass the version check through them.
REVOKE EXECUTE ON FUNCTION public.update_product_master_v3(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_product_flavor_v1(UUID, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
