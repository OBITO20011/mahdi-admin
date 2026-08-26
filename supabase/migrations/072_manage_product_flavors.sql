BEGIN;

CREATE OR REPLACE FUNCTION public.update_product_flavor_v1(
  p_flavor_product_id UUID,
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
  v_flavor public.products%ROWTYPE;
  v_master public.products%ROWTYPE;
  v_name TEXT := NULLIF(BTRIM(p_flavor_name_ar), '');
  v_image_url TEXT := NULLIF(BTRIM(p_image_url), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل نكهة المنتج'
  );

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'اكتب اسم النكهة.';
  END IF;
  IF CHAR_LENGTH(v_name) > 80 THEN
    RAISE EXCEPTION 'اسم النكهة طويل جدًا.';
  END IF;

  SELECT * INTO v_flavor
  FROM public.products
  WHERE id = p_flavor_product_id
  FOR UPDATE;

  IF NOT FOUND OR v_flavor.flavor_master_product_id IS NULL THEN
    RAISE EXCEPTION 'النكهة المحددة غير موجودة.';
  END IF;

  SELECT * INTO v_master
  FROM public.products
  WHERE id = v_flavor.flavor_master_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج الأساسي للنكهة غير موجود.';
  END IF;
  IF COALESCE(p_is_active, TRUE) AND NOT v_master.is_active THEN
    RAISE EXCEPTION 'فعّل المنتج الأساسي قبل تفعيل هذه النكهة.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.flavor_master_product_id = v_master.id
      AND p.id <> v_flavor.id
      AND LOWER(BTRIM(p.flavor_name_ar)) = LOWER(v_name)
  ) THEN
    RAISE EXCEPTION 'هذه النكهة موجودة مسبقًا.';
  END IF;

  UPDATE public.products
  SET
    flavor_name_ar = v_name,
    name_ar = v_master.name_ar || ' - ' || v_name,
    barcode = NULLIF(BTRIM(p_barcode), ''),
    is_active = COALESCE(p_is_active, TRUE),
    updated_at = NOW()
  WHERE id = v_flavor.id;

  IF v_image_url IS NOT NULL THEN
    PERFORM public.set_product_primary_image(v_flavor.id, v_image_url);
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'UPDATE_PRODUCT_FLAVOR',
    'products',
    v_flavor.id,
    jsonb_build_object(
      'master_product_id', v_master.id,
      'previous_name_ar', v_flavor.flavor_name_ar,
      'flavor_name_ar', v_name,
      'is_active', COALESCE(p_is_active, TRUE),
      'barcode_changed',
        COALESCE(v_flavor.barcode, '') IS DISTINCT FROM
        COALESCE(NULLIF(BTRIM(p_barcode), ''), ''),
      'image_changed',
        v_image_url IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'productId', v_flavor.id,
    'masterProductId', v_master.id,
    'message', 'تم تحديث النكهة مع الحفاظ على مخزونها وسجلها.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_product_flavor_v1(
  UUID, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_flavor_v1(
  UUID, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;

CREATE OR REPLACE FUNCTION public.reorder_product_flavors_v1(
  p_master_product_id UUID,
  p_ordered_flavor_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_count INTEGER;
  v_requested_count INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'ترتيب نكهات المنتج'
  );

  PERFORM 1
  FROM public.products
  WHERE id = p_master_product_id
    AND flavor_master_product_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج الأساسي غير موجود.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_expected_count
  FROM public.products
  WHERE flavor_master_product_id = p_master_product_id;

  v_requested_count := COALESCE(CARDINALITY(p_ordered_flavor_ids), 0);
  IF v_requested_count <> v_expected_count THEN
    RAISE EXCEPTION 'يجب إرسال جميع نكهات المنتج عند ترتيبها.';
  END IF;
  IF (
    SELECT COUNT(DISTINCT requested.flavor_id)
    FROM UNNEST(p_ordered_flavor_ids) AS requested(flavor_id)
  ) <> v_requested_count THEN
    RAISE EXCEPTION 'قائمة ترتيب النكهات تحتوي على تكرار.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM UNNEST(p_ordered_flavor_ids) AS requested(flavor_id)
    LEFT JOIN public.products p
      ON p.id = requested.flavor_id
      AND p.flavor_master_product_id = p_master_product_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'قائمة ترتيب النكهات غير صالحة.';
  END IF;

  UPDATE public.products p
  SET
    flavor_sort_order = requested.position::INTEGER * 10,
    updated_at = NOW()
  FROM UNNEST(p_ordered_flavor_ids) WITH ORDINALITY
    AS requested(flavor_id, position)
  WHERE p.id = requested.flavor_id
    AND p.flavor_master_product_id = p_master_product_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'REORDER_PRODUCT_FLAVORS',
    'products',
    p_master_product_id,
    jsonb_build_object(
      'ordered_flavor_ids', to_jsonb(p_ordered_flavor_ids),
      'flavor_count', v_requested_count
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'productId', p_master_product_id,
    'message', 'تم ترتيب النكهات.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_product_flavors_v1(UUID, UUID[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_product_flavors_v1(UUID, UUID[])
  TO authenticated;

COMMENT ON FUNCTION public.update_product_flavor_v1(
  UUID, TEXT, TEXT, TEXT, BOOLEAN
) IS
  'Safely edits flavor identity and visibility without changing inherited prices, inventory, orders, or history.';

COMMENT ON FUNCTION public.reorder_product_flavors_v1(UUID, UUID[]) IS
  'Atomically persists the complete display order of one product flavor family.';

COMMIT;
