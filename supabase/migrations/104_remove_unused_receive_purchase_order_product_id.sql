BEGIN;

-- Remove the dead local product variable while preserving the legacy payload
-- UUID validation and the purchase-order item as the authoritative product.
CREATE OR REPLACE FUNCTION public._receive_purchase_order_impl(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_po public.purchase_orders%ROWTYPE;
  v_target_warehouse_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_item JSONB;
  v_po_item_id UUID;
  v_recv_qty INT;
  v_unit_cost BIGINT;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_remaining_qty INT;
  v_current_on_hand INT := 0;
  v_total_on_hand_all_wh INT := 0;
  v_new_on_hand INT := 0;
  v_current_cost BIGINT := 0;
  v_new_weighted_cost BIGINT := 0;
  v_all_completed BOOLEAN := true;
  v_receipt_item_count INT := 0;
  v_check_item RECORD;
BEGIN
  v_user_id := auth.uid();

  -- Lock PO row
  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء المحدد غير موجود.';
  END IF;

  IF v_po.status NOT IN ('approved', 'partially_received') THEN
    RAISE EXCEPTION 'يجب أن يكون أمر الشراء معتمداً أو مستلماً جزئياً لاستلام البضائع. الحالة الحالية: %', v_po.status;
  END IF;

  v_target_warehouse_id := COALESCE(p_warehouse_id, v_po.warehouse_id);
  IF v_target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'يرجى تحديد المستودع المستلم للبضائع.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إدخال منتج واحد على الأقل للاستلام.';
  END IF;

  -- Generate Receipt Number: GRN-2026-XXXX
  v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  WHILE EXISTS (SELECT 1 FROM public.purchase_receipts WHERE receipt_number = v_receipt_number) LOOP
    v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  END LOOP;

  -- Create Purchase Receipt Header
  INSERT INTO public.purchase_receipts (
    receipt_number,
    purchase_order_id,
    supplier_id,
    warehouse_id,
    received_by,
    received_at,
    supplier_delivery_note,
    notes
  ) VALUES (
    v_receipt_number,
    p_purchase_order_id,
    v_po.supplier_id,
    v_target_warehouse_id,
    v_user_id,
    NOW(),
    p_supplier_delivery_note,
    p_notes
  )
  RETURNING id INTO v_receipt_id;

  -- Loop through received items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_po_item_id := (v_item->>'purchase_order_item_id')::UUID;
    -- Preserve the previous malformed UUID rejection. Product resolution
    -- remains authoritative through the locked purchase-order item below.
    PERFORM (v_item->>'product_id')::UUID;
    v_recv_qty := COALESCE((v_item->>'received_quantity')::INT, 0);
    v_unit_cost := COALESCE((v_item->>'unit_cost_in_minor_units')::BIGINT, 0);

    IF v_recv_qty <= 0 THEN
      CONTINUE; -- skip zero quantity items
    END IF;

    -- Lock & Fetch PO Item
    SELECT * INTO v_po_item
    FROM public.purchase_order_items
    WHERE id = v_po_item_id AND purchase_order_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'عنصر أمر الشراء غير موجود.';
    END IF;

    v_remaining_qty := v_po_item.ordered_quantity - v_po_item.received_quantity;
    IF v_recv_qty > v_remaining_qty THEN
      RAISE EXCEPTION 'الكمية المستلمة (%s) تتجاوز الكمية المتبقية (%s) للمنتج.', v_recv_qty, v_remaining_qty;
    END IF;

    -- 1. Insert Receipt Item
    INSERT INTO public.purchase_receipt_items (
      purchase_receipt_id,
      purchase_order_item_id,
      product_id,
      received_quantity,
      unit_cost_in_minor_units
    ) VALUES (
      v_receipt_id,
      v_po_item_id,
      v_po_item.product_id,
      v_recv_qty,
      v_unit_cost
    );

    -- 2. Update PO Item received_quantity
    UPDATE public.purchase_order_items
    SET received_quantity = received_quantity + v_recv_qty,
        updated_at = NOW()
    WHERE id = v_po_item_id;

    -- 3. Update Inventory Balance
    SELECT COALESCE(on_hand_quantity, 0) INTO v_current_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = v_target_warehouse_id AND product_id = v_po_item.product_id;

    IF NOT FOUND THEN
      v_current_on_hand := 0;
      INSERT INTO public.inventory_balances (
        warehouse_id,
        product_id,
        on_hand_quantity,
        reserved_quantity
      ) VALUES (
        v_target_warehouse_id,
        v_po_item.product_id,
        v_recv_qty,
        0
      );
      v_new_on_hand := v_recv_qty;
    ELSE
      v_new_on_hand := v_current_on_hand + v_recv_qty;
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_new_on_hand,
          updated_at = NOW()
      WHERE warehouse_id = v_target_warehouse_id AND product_id = v_po_item.product_id;
    END IF;

    -- 4. Record Inventory Movement
    INSERT INTO public.inventory_movements (
      warehouse_id,
      product_id,
      movement_type,
      quantity,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      notes,
      created_by
    ) VALUES (
      v_target_warehouse_id,
      v_po_item.product_id,
      'purchase_receipt',
      v_recv_qty,
      v_current_on_hand,
      v_new_on_hand,
      'purchase_receipt',
      v_receipt_id,
      'استلام مشتريات سند رقم ' || v_receipt_number || ' - طلب شراء ' || v_po.purchase_order_number,
      v_user_id
    );

    -- 5. Calculate Weighted Average Cost & Update Product Cost
    SELECT COALESCE(cost_price_in_minor_units, 0) INTO v_current_cost
    FROM public.products
    WHERE id = v_po_item.product_id;

    SELECT COALESCE(SUM(on_hand_quantity), 0) INTO v_total_on_hand_all_wh
    FROM public.inventory_balances
    WHERE product_id = v_po_item.product_id;

    -- Note: v_total_on_hand_all_wh already includes v_recv_qty
    IF (v_total_on_hand_all_wh) > 0 AND v_unit_cost > 0 THEN
      v_new_weighted_cost := (( (v_total_on_hand_all_wh - v_recv_qty) * v_current_cost ) + ( v_recv_qty * v_unit_cost )) / v_total_on_hand_all_wh;

      UPDATE public.products
      SET cost_price_in_minor_units = v_new_weighted_cost,
          updated_at = NOW()
      WHERE id = v_po_item.product_id;
    END IF;

    v_receipt_item_count := v_receipt_item_count + 1;
  END LOOP;

  -- Determine if PO is fully received
  FOR v_check_item IN SELECT ordered_quantity, received_quantity FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id
  LOOP
    IF v_check_item.received_quantity < v_check_item.ordered_quantity THEN
      v_all_completed := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET status = CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
      received_at = CASE WHEN v_all_completed THEN NOW() ELSE received_at END,
      updated_at = NOW()
  WHERE id = p_purchase_order_id;

  -- Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'استلام بضائع أمر شراء',
    'purchase_receipts',
    v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'purchase_order_id', p_purchase_order_id,
      'is_fully_received', v_all_completed,
      'items_received_count', v_receipt_item_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'is_fully_received', v_all_completed,
    'new_status', CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
    'message', 'تم استلام البضائع وزيادة المخزون وتحديث متوسط التكلفة بنجاح'
  );
END;
$$;

COMMIT;
