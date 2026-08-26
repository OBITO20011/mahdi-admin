BEGIN;

CREATE OR REPLACE FUNCTION public.create_product_family_with_flavors_v1(
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
  p_image_url TEXT DEFAULT NULL,
  p_flavors JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_master_result JSONB;
  v_master_id UUID;
  v_flavor JSONB;
  v_flavor_count INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إنشاء منتج بنكهات'
  );

  IF jsonb_typeof(COALESCE(p_flavors, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'قائمة النكهات غير صالحة.';
  END IF;

  v_flavor_count := jsonb_array_length(COALESCE(p_flavors, '[]'::JSONB));
  IF v_flavor_count < 1 THEN
    RAISE EXCEPTION 'أضف نكهة واحدة على الأقل.';
  END IF;
  IF v_flavor_count > 30 THEN
    RAISE EXCEPTION 'الحد الأعلى هو 30 نكهة للمنتج الواحد.';
  END IF;

  -- The family root never carries stock. Every real unit is created on its
  -- flavor row below, inside this same PostgreSQL transaction.
  v_master_result := public.create_product_with_opening_stock_v4(
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
    p_warehouse_id,
    0,
    'بطاقة منتج أساسية لمجموعة نكهات',
    p_image_url
  );

  v_master_id := NULLIF(v_master_result->>'product_id', '')::UUID;
  IF v_master_id IS NULL THEN
    RAISE EXCEPTION 'تعذر إنشاء المنتج الأساسي لمجموعة النكهات.';
  END IF;

  FOR v_flavor IN
    SELECT value
    FROM jsonb_array_elements(p_flavors)
  LOOP
    PERFORM public.create_product_flavor_v1(
      v_master_id,
      v_flavor->>'nameAr',
      GREATEST(
        0,
        COALESCE((v_flavor->>'openingSalePackages')::INTEGER, 0)
      ),
      p_warehouse_id,
      NULLIF(BTRIM(v_flavor->>'imageUrl'), ''),
      NULL
    );
  END LOOP;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'CREATE_PRODUCT_FLAVOR_FAMILY',
    'products',
    v_master_id,
    jsonb_build_object(
      'flavor_count', v_flavor_count,
      'atomic', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', v_master_id,
    'flavorCount', v_flavor_count,
    'message', 'تم إنشاء المنتج وجميع نكهاته ومخزونها بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_family_with_flavors_v1(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_family_with_flavors_v1(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, TEXT, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.create_product_family_with_flavors_v1(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  UUID, INTEGER, BIGINT, BIGINT, INTEGER, INTEGER, UUID, TEXT, JSONB
) IS
  'Atomically creates one flavor-family master and all independently stocked flavor products. Any flavor failure rolls back the complete family.';

COMMIT;
