-- Nawasrah ERP
-- Safe supplier receipt reversal, including receipts with recorded payments.
-- Financial and inventory history is preserved; no business document is hard-deleted.

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_active_receipt
  ON public.supplier_payments(supplier_receipt_id, is_reversed);

CREATE OR REPLACE FUNCTION public._cancel_supplier_receipt_impl(
  p_supplier_receipt_id UUID,
  p_reason TEXT DEFAULT 'إلغاء سند استلام البضائع'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_receipt RECORD;
  v_item RECORD;
  v_old_on_hand INTEGER;
  v_reserved_quantity INTEGER;
  v_new_on_hand INTEGER;
  v_inventory_units_reversed INTEGER := 0;
  v_payments_amount_reversed BIGINT := 0;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإلغاء سند استلام.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'سبب إلغاء سند الاستلام مطلوب.';
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.supplier_receipts
  WHERE id = p_supplier_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;

  -- Validate every line before mutating anything. Reversal must never consume
  -- stock that was already sold or reserved for customer orders.
  FOR v_item IN
    SELECT sri.*, p.name_ar AS product_name
    FROM public.supplier_receipt_items sri
    JOIN public.products p ON p.id = sri.product_id
    WHERE sri.supplier_receipt_id = p_supplier_receipt_id
    ORDER BY sri.product_id
  LOOP
    SELECT on_hand_quantity, reserved_quantity
    INTO v_old_on_hand, v_reserved_quantity
    FROM public.inventory_balances
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id
    FOR UPDATE;

    IF v_old_on_hand IS NULL
      OR (v_old_on_hand - v_item.total_base_units) < v_reserved_quantity
    THEN
      RAISE EXCEPTION
        'لا يمكن إلغاء السند لأن كمية المنتج % تم بيعها أو حجزها لطلبات زبائن.',
        v_item.product_name;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT *
    FROM public.supplier_receipt_items
    WHERE supplier_receipt_id = p_supplier_receipt_id
    ORDER BY product_id
  LOOP
    SELECT on_hand_quantity, reserved_quantity
    INTO v_old_on_hand, v_reserved_quantity
    FROM public.inventory_balances
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id
    FOR UPDATE;

    v_new_on_hand := v_old_on_hand - v_item.total_base_units;
    v_inventory_units_reversed :=
      v_inventory_units_reversed + v_item.total_base_units;

    UPDATE public.inventory_balances
    SET
      on_hand_quantity = v_new_on_hand,
      updated_at = NOW()
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id;

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
      v_receipt.warehouse_id,
      v_item.product_id,
      'return_out',
      -v_item.total_base_units,
      v_old_on_hand,
      v_new_on_hand,
      'supplier_receipt_cancellation',
      p_supplier_receipt_id,
      'عكس سند استلام ' || v_receipt.receipt_number || ': ' || v_reason,
      v_user_id
    );
  END LOOP;

  -- The supplier balance contains only the unpaid portion of the receipt.
  UPDATE public.suppliers
  SET
    current_balance_in_minor_units = GREATEST(
      0,
      current_balance_in_minor_units - v_receipt.amount_due_in_minor_units
    ),
    updated_at = NOW()
  WHERE id = v_receipt.supplier_id;

  SELECT COALESCE(SUM(amount_in_minor_units), 0)
  INTO v_payments_amount_reversed
  FROM public.supplier_payments
  WHERE supplier_receipt_id = p_supplier_receipt_id
    AND is_reversed = false;

  UPDATE public.supplier_payments
  SET
    is_reversed = true,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE supplier_receipt_id = p_supplier_receipt_id
    AND is_reversed = false;

  UPDATE public.supplier_receipts
  SET
    status = 'cancelled',
    is_archived = true,
    amount_paid_in_minor_units = 0,
    amount_due_in_minor_units = 0,
    payment_status = 'paid',
    notes = CONCAT_WS(
      E'\n',
      NULLIF(notes, ''),
      '[إلغاء ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || '] ' || v_reason
    ),
    updated_at = NOW()
  WHERE id = p_supplier_receipt_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CANCEL_SUPPLIER_RECEIPT',
    'supplier_receipts',
    p_supplier_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'reason', v_reason,
      'original_paid_in_minor_units', v_receipt.amount_paid_in_minor_units,
      'original_due_in_minor_units', v_receipt.amount_due_in_minor_units,
      'payments_amount_reversed', v_payments_amount_reversed,
      'inventory_units_reversed', v_inventory_units_reversed
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', p_supplier_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'inventory_units_reversed', v_inventory_units_reversed,
    'payments_amount_reversed', v_payments_amount_reversed
  );
END;
$$;

REVOKE ALL ON FUNCTION public._cancel_supplier_receipt_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
