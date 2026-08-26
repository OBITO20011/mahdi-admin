-- =========================================================================
-- Nawasrah ERP - Migration 074
-- Reconcile legacy warehouse RPC drift, add the current transfer boundary,
-- and provide an audited self-profile update boundary.
-- =========================================================================

BEGIN;

-- Production inspection found the three old supplier-return/stock-count RPCs
-- absent despite legacy migration history. Do not recreate dead APIs blindly.
-- If an older environment still has one, remove inherited execution access.
DO $$
BEGIN
  IF to_regprocedure('public.create_supplier_return(uuid,uuid,uuid,jsonb,bigint,text,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_supplier_return(
      UUID, UUID, UUID, JSONB, BIGINT, TEXT, TEXT
    ) FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.create_stock_count_session(uuid,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.create_stock_count_session(UUID, TEXT)
      FROM PUBLIC, anon, authenticated;
  END IF;

  IF to_regprocedure('public.approve_stock_count(uuid,jsonb,text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.approve_stock_count(UUID, JSONB, TEXT)
      FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;

-- The active transfer screen needs one real, guarded mutation. It preserves
-- reservations, writes immutable movements, and records an audit entry.
CREATE OR REPLACE FUNCTION public.transfer_inventory_between_warehouses(
  p_product_id UUID,
  p_source_warehouse_id UUID,
  p_destination_warehouse_id UUID,
  p_quantity INTEGER,
  p_notes TEXT DEFAULT NULL,
  p_transfer_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product_name TEXT;
  v_source_warehouse_name TEXT;
  v_destination_warehouse_name TEXT;
  v_source_before INTEGER;
  v_source_reserved INTEGER;
  v_source_after INTEGER;
  v_destination_before INTEGER;
  v_destination_after INTEGER;
  v_out_movement_id UUID;
  v_in_movement_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'نقل المخزون بين المستودعات'
  );

  IF p_product_id IS NULL
     OR p_source_warehouse_id IS NULL
     OR p_destination_warehouse_id IS NULL
  THEN
    RAISE EXCEPTION 'المنتج والمستودع المصدر والمستودع الهدف مطلوبة.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'الكمية المنقولة يجب أن تكون عددًا صحيحًا أكبر من صفر.';
  END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'لا يمكن نقل المخزون إلى المستودع نفسه.';
  END IF;

  SELECT name_ar
  INTO v_product_name
  FROM public.products
  WHERE id = p_product_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود أو غير نشط.';
  END IF;

  SELECT name_ar
  INTO v_source_warehouse_name
  FROM public.warehouses
  WHERE id = p_source_warehouse_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستودع المصدر غير موجود أو غير نشط.';
  END IF;

  SELECT name_ar
  INTO v_destination_warehouse_name
  FROM public.warehouses
  WHERE id = p_destination_warehouse_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستودع الهدف غير موجود أو غير نشط.';
  END IF;

  -- One stable operation key prevents opposing transfers of the same product
  -- between this warehouse pair from deadlocking or overspending stock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_product_id::TEXT || ':' ||
      LEAST(p_source_warehouse_id::TEXT, p_destination_warehouse_id::TEXT) || ':' ||
      GREATEST(p_source_warehouse_id::TEXT, p_destination_warehouse_id::TEXT),
      0
    )
  );

  SELECT on_hand_quantity, reserved_quantity
  INTO v_source_before, v_source_reserved
  FROM public.inventory_balances
  WHERE warehouse_id = p_source_warehouse_id
    AND product_id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد رصيد لهذا المنتج في المستودع المصدر.';
  END IF;

  IF (v_source_before - p_quantity) < v_source_reserved THEN
    RAISE EXCEPTION
      'لا يمكن نقل % قطعة؛ المتاح للنقل في المستودع المصدر هو % قطعة بعد حجز الطلبات.',
      p_quantity,
      v_source_before - v_source_reserved;
  END IF;

  v_source_after := v_source_before - p_quantity;
  UPDATE public.inventory_balances
  SET on_hand_quantity = v_source_after, updated_at = NOW()
  WHERE warehouse_id = p_source_warehouse_id
    AND product_id = p_product_id;

  INSERT INTO public.inventory_balances (
    warehouse_id,
    product_id,
    on_hand_quantity,
    reserved_quantity
  ) VALUES (
    p_destination_warehouse_id,
    p_product_id,
    p_quantity,
    0
  ) ON CONFLICT (warehouse_id, product_id)
  DO UPDATE
  SET
    on_hand_quantity = public.inventory_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
    updated_at = NOW()
  RETURNING on_hand_quantity - p_quantity, on_hand_quantity
  INTO v_destination_before, v_destination_after;

  INSERT INTO public.inventory_movements (
    warehouse_id, product_id, movement_type, quantity, balance_before,
    balance_after, reference_type, notes, created_by
  ) VALUES (
    p_source_warehouse_id, p_product_id, 'transfer_out', -p_quantity,
    v_source_before, v_source_after, 'warehouse_transfer',
    COALESCE(NULLIF(BTRIM(p_notes), ''), 'نقل مخزون إلى ' || v_destination_warehouse_name),
    v_user_id
  ) RETURNING id INTO v_out_movement_id;

  INSERT INTO public.inventory_movements (
    warehouse_id, product_id, movement_type, quantity, balance_before,
    balance_after, reference_type, notes, created_by
  ) VALUES (
    p_destination_warehouse_id, p_product_id, 'transfer_in', p_quantity,
    v_destination_before, v_destination_after, 'warehouse_transfer',
    COALESCE(NULLIF(BTRIM(p_notes), ''), 'نقل مخزون من ' || v_source_warehouse_name),
    v_user_id
  ) RETURNING id INTO v_in_movement_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'TRANSFER_INVENTORY',
    'inventory_balances',
    p_product_id,
    jsonb_build_object(
      'source_warehouse_id', p_source_warehouse_id,
      'destination_warehouse_id', p_destination_warehouse_id,
      'quantity', p_quantity,
      'source_before', v_source_before,
      'source_after', v_source_after,
      'destination_before', v_destination_before,
      'destination_after', v_destination_after,
      'out_movement_id', v_out_movement_id,
      'in_movement_id', v_in_movement_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', p_product_id,
    'quantityTransferred', p_quantity,
    'sourceNewQuantity', v_source_after,
    'destinationNewQuantity', v_destination_after,
    'movementOutId', v_out_movement_id,
    'movementInId', v_in_movement_id,
    'message', 'تم نقل المخزون من ' || v_source_warehouse_name || ' إلى ' || v_destination_warehouse_name || ' بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) TO authenticated;

-- A staff member may update only their own display/contact fields. Role,
-- status, branch assignment, and job title stay under owner-managed staff
-- records. Auth email/password and UI preferences remain in Supabase Auth.
CREATE OR REPLACE FUNCTION public.update_my_erp_profile(
  p_full_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_full_name TEXT := NULLIF(BTRIM(p_full_name), '');
  v_phone TEXT := NULLIF(BTRIM(p_phone), '');
  v_avatar_url TEXT := NULLIF(BTRIM(p_avatar_url), '');
  v_profile public.profiles%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'تحديث الملف الشخصي'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتحديث الملف الشخصي.';
  END IF;

  IF v_full_name IS NULL OR CHAR_LENGTH(v_full_name) < 2 OR CHAR_LENGTH(v_full_name) > 120 THEN
    RAISE EXCEPTION 'الاسم الكامل يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+() -]{7,24}$' THEN
    RAISE EXCEPTION 'رقم الهاتف غير صالح.';
  END IF;
  IF v_avatar_url IS NOT NULL
     AND (CHAR_LENGTH(v_avatar_url) > 2048 OR v_avatar_url !~ '^https?://')
  THEN
    RAISE EXCEPTION 'رابط الصورة الشخصية يجب أن يكون رابط HTTP أو HTTPS صالحًا.';
  END IF;

  UPDATE public.profiles
  SET full_name = v_full_name, phone = v_phone, avatar_url = v_avatar_url
  WHERE id = v_user_id
  RETURNING * INTO v_profile;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ملف المستخدم غير موجود.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'تحديث الملف الشخصي',
    'profile',
    v_user_id,
    jsonb_build_object(
      'updated_fields', jsonb_build_array('full_name', 'phone', 'avatar_url'),
      'has_phone', v_profile.phone IS NOT NULL,
      'has_avatar_url', v_profile.avatar_url IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'fullName', v_profile.full_name,
      'phone', v_profile.phone,
      'avatarUrl', v_profile.avatar_url,
      'jobTitle', v_profile.job_title,
      'branchId', v_profile.branch_id
    )
  );
END;
$$;

-- Prevent direct self-updates of is_active, branch_id, or future sensitive
-- columns. The narrow audited RPC above replaces the row-wide policy.
DROP POLICY IF EXISTS "Allow users to update own profile" ON public.profiles;
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
REVOKE ALL ON FUNCTION public.update_my_erp_profile(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_erp_profile(TEXT, TEXT, TEXT)
  TO authenticated;

COMMIT;
