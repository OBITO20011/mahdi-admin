-- Remove the unused product-name variable from the guarded warehouse transfer
-- function without changing its signature, authorization, locking, inventory,
-- movement, timestamp, or audit behavior.
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

  PERFORM 1
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
