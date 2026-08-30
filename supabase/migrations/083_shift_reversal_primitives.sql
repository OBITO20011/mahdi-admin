-- =========================================================================
-- Nawasrah ERP - Phase 2: auditable reversal primitives for future full
-- cash-shift reversal. This migration deliberately does not add an
-- orchestrator, shift lifecycle state, or client UI.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pos_sale_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(idempotency_key)) BETWEEN 16 AND 200),
  expected_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  actual_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requested_by, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pos_sale_reversals_shift_created
  ON public.pos_sale_reversals(cash_shift_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_payment_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id UUID NOT NULL UNIQUE REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(idempotency_key)) BETWEEN 16 AND 200),
  expected_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  actual_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (requested_by, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_reversals_shift_created
  ON public.supplier_payment_reversals(cash_shift_id, created_at DESC);

ALTER TABLE public.pos_sale_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payment_reversals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pos_sale_reversals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.supplier_payment_reversals FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pos_sale_reversals TO service_role;
GRANT ALL ON TABLE public.supplier_payment_reversals TO service_role;

CREATE OR REPLACE FUNCTION public.assert_reversal_owner(
  p_operation TEXT DEFAULT 'عكس عملية مالية حساسة'
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], p_operation);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول من حساب مالك نظام.';
  END IF;

  -- The common guard requires AAL2 only after factor enrollment. Reversal
  -- primitives are stricter by design: every owner must present AAL2.
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'تتطلب عملية % مصادقة ثنائية مؤكدة (AAL2).', p_operation;
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_reversal_owner(TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reverse_pos_sale(
  p_order_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_existing public.pos_sale_reversals%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_item RECORD;
  v_balance_before INTEGER;
  v_balance_after INTEGER;
  v_cogs BIGINT := 0;
  v_profit BIGINT := 0;
  v_quantity INTEGER := 0;
  v_effect JSONB;
BEGIN
  v_user_id := public.assert_reversal_owner('عكس بيع نقطة بيع مكتمل');
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'بيع نقطة البيع المطلوب عكسه غير محدد.';
  END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'سبب عكس البيع مطلوب ويجب أن يكون بين 3 و500 حرف.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع التكرار لعكس البيع غير صالح.';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  -- Read the immutable link first. Every standalone primitive and the full
  -- shift orchestrator serialize on the same shift-level advisory lock before
  -- taking an operation lock or any row lock. This prevents the cycle
  -- "primitive operation lock -> shift row" versus
  -- "orchestrator shift row -> primitive operation lock".
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'بيع نقطة البيع غير موجود.';
  END IF;
  IF v_order.cash_shift_id IS NULL THEN
    RAISE EXCEPTION 'بيع نقطة البيع غير مرتبط بورديّة صريحة.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('cash-shift-full-reversal:' || v_order.cash_shift_id::TEXT, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pos-sale-reversal:' || p_order_id::TEXT, 0)
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = v_order.cash_shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'لا يمكن عكس بيع مرتبط بورديّة غير مفتوحة.';
  END IF;

  SELECT * INTO v_existing
  FROM public.pos_sale_reversals
  WHERE requested_by = v_user_id
    AND idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id <> p_order_id THEN
      RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لعكس بيع آخر.';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reversal_id', v_existing.id,
      'order_id', v_existing.order_id,
      'cash_shift_id', v_existing.cash_shift_id,
      'actual_effect', v_existing.actual_effect
    );
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_order.source IS DISTINCT FROM 'pos'
    OR v_order.status <> 'completed'
    OR v_order.cash_shift_id <> v_shift.id
  THEN
    RAISE EXCEPTION 'البيع لم يعد بيع POS مكتملًا قابلًا للعكس.';
  END IF;

  SELECT * INTO v_existing
  FROM public.pos_sale_reversals
  WHERE order_id = p_order_id
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'تم عكس بيع نقطة البيع مسبقًا.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_payments cp
    WHERE cp.order_id = p_order_id
  ) OR EXISTS (
    SELECT 1 FROM public.sales_returns sr
    WHERE sr.order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس البيع بعد تسجيل دفعة عميل أو مرتجع مرتبط به.';
  END IF;

  -- A later stock movement is a dependency, not a guessed relationship.
  -- It deliberately blocks even unrelated later movement for the same stock
  -- identity rather than risking a historical quantity reversal.
  IF EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.inventory_movements im
      ON im.warehouse_id = v_order.warehouse_id
     AND im.product_id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND im.reference_id IS DISTINCT FROM p_order_id
      AND im.created_at >= v_order.created_at
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس البيع بعد وجود حركة مخزون لاحقة على أحد أصنافه.';
  END IF;

  FOR v_item IN
    SELECT oi.product_id, oi.quantity, oi.cogs_in_minor_units,
           oi.profit_in_minor_units, oi.line_total_in_minor_units
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id
  LOOP
    SELECT on_hand_quantity, reserved_quantity
    INTO v_balance_before, v_balance_after
    FROM public.inventory_balances
    WHERE warehouse_id = v_order.warehouse_id
      AND product_id = v_item.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_balance_after <> 0 THEN
      RAISE EXCEPTION 'لا يمكن عكس البيع لأن مخزون أحد أصنافه غير متاح أو محجوز.';
    END IF;

    v_balance_after := v_balance_before + v_item.quantity;
    UPDATE public.inventory_balances
    SET on_hand_quantity = v_balance_after, updated_at = NOW()
    WHERE warehouse_id = v_order.warehouse_id
      AND product_id = v_item.product_id;

    v_cogs := v_cogs + v_item.cogs_in_minor_units;
    v_profit := v_profit + v_item.profit_in_minor_units;
    v_quantity := v_quantity + v_item.quantity;
  END LOOP;

  v_effect := jsonb_build_object(
    'payment_method', v_order.payment_method,
    'cash_in_minor_units', CASE WHEN v_order.payment_method = 'cash' THEN v_order.total_in_minor_units ELSE 0 END,
    'cliq_in_minor_units', CASE WHEN v_order.payment_method = 'cliq' THEN v_order.total_in_minor_units ELSE 0 END,
    'customer_receivable_in_minor_units', CASE WHEN v_order.payment_method = 'debt' THEN v_order.total_in_minor_units ELSE 0 END,
    'discount_in_minor_units', v_order.discount_in_minor_units,
    'cogs_in_minor_units', v_cogs,
    'profit_in_minor_units', v_profit,
    'restored_base_units', v_quantity
  );

  INSERT INTO public.pos_sale_reversals (
    order_id, cash_shift_id, requested_by, reason, idempotency_key,
    expected_effect, actual_effect
  ) VALUES (
    v_order.id, v_shift.id, v_user_id, v_reason, v_key, v_effect, v_effect
  ) RETURNING id INTO v_existing.id;

  FOR v_item IN
    SELECT oi.product_id, oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.product_id
  LOOP
    SELECT on_hand_quantity - v_item.quantity
    INTO v_balance_before
    FROM public.inventory_balances
    WHERE warehouse_id = v_order.warehouse_id
      AND product_id = v_item.product_id;
    SELECT on_hand_quantity INTO v_balance_after
    FROM public.inventory_balances
    WHERE warehouse_id = v_order.warehouse_id
      AND product_id = v_item.product_id;

    INSERT INTO public.inventory_movements (
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by
    ) VALUES (
      v_order.warehouse_id, v_item.product_id, 'return_in', v_item.quantity,
      v_balance_before, v_balance_after, 'pos_sale_reversal', v_existing.id,
      'عكس بيع نقطة البيع ' || v_order.order_number, v_user_id
    );
  END LOOP;

  UPDATE public.orders
  SET
    status = 'cancelled',
    amount_paid_in_minor_units = 0,
    change_due_in_minor_units = 0,
    updated_at = NOW()
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by, notes
  ) VALUES (
    v_order.id, 'completed', 'cancelled', v_user_id,
    'عكس POS موثق: ' || v_reason
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'REVERSE_POS_SALE', 'pos_sale_reversals', v_existing.id,
    jsonb_build_object(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'cash_shift_id', v_shift.id,
      'reason', v_reason,
      'effect', v_effect
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'reversal_id', v_existing.id,
    'order_id', v_order.id,
    'cash_shift_id', v_shift.id,
    'actual_effect', v_effect
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_supplier_payment(
  p_supplier_payment_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_payment public.supplier_payments%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_receipt public.supplier_receipts%ROWTYPE;
  v_purchase_order public.purchase_orders%ROWTYPE;
  v_existing public.supplier_payment_reversals%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_new_paid BIGINT;
  v_new_due BIGINT;
  v_effect JSONB;
BEGIN
  v_user_id := public.assert_reversal_owner('عكس دفعة مورد');
  IF p_supplier_payment_id IS NULL THEN
    RAISE EXCEPTION 'دفعة المورد المطلوب عكسها غير محددة.';
  END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'سبب عكس دفعة المورد مطلوب ويجب أن يكون بين 3 و500 حرف.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع التكرار لعكس دفعة المورد غير صالح.';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_supplier_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'دفعة المورد غير موجودة.';
  END IF;
  IF v_payment.cash_shift_id IS NULL THEN
    RAISE EXCEPTION 'دفعة المورد غير مرتبطة بورديّة صريحة.';
  END IF;

  -- Match the orchestrator's canonical order: shift advisory, operation
  -- advisory, shift row, payment row, then receipt/PO and supplier rows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('cash-shift-full-reversal:' || v_payment.cash_shift_id::TEXT, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended('supplier-payment-reversal:' || p_supplier_payment_id::TEXT, 0)
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = v_payment.cash_shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'لا يمكن عكس دفعة مورد مرتبطة بورديّة غير مفتوحة.';
  END IF;

  SELECT * INTO v_existing
  FROM public.supplier_payment_reversals
  WHERE requested_by = v_user_id
    AND idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.supplier_payment_id <> p_supplier_payment_id THEN
      RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لعكس دفعة مورد أخرى.';
    END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'reversal_id', v_existing.id,
      'supplier_payment_id', v_existing.supplier_payment_id,
      'cash_shift_id', v_existing.cash_shift_id,
      'actual_effect', v_existing.actual_effect
    );
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment.cash_shift_id <> v_shift.id OR v_payment.is_reversed THEN
    RAISE EXCEPTION 'دفعة المورد لم تعد قابلة للعكس.';
  END IF;
  IF (v_payment.supplier_receipt_id IS NULL AND v_payment.purchase_order_id IS NULL)
    OR (v_payment.supplier_receipt_id IS NOT NULL AND v_payment.purchase_order_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'دفعة المورد لا تحمل مرجعًا ماليًا واحدًا واضحًا يمكن عكسه بأمان.';
  END IF;

  IF v_payment.supplier_receipt_id IS NOT NULL THEN
    SELECT * INTO v_receipt
    FROM public.supplier_receipts
    WHERE id = v_payment.supplier_receipt_id
    FOR UPDATE;
    IF NOT FOUND OR v_receipt.status <> 'completed' OR v_receipt.supplier_id <> v_payment.supplier_id THEN
      RAISE EXCEPTION 'سند استلام المورد لم يعد صالحًا لعكس الدفعة.';
    END IF;
    IF v_receipt.amount_paid_in_minor_units < v_payment.amount_in_minor_units THEN
      RAISE EXCEPTION 'رصيد دفعات سند المورد لا يسمح بعكس هذه الدفعة بأمان.';
    END IF;

    v_new_paid := v_receipt.amount_paid_in_minor_units - v_payment.amount_in_minor_units;
    v_new_due := v_receipt.total_in_minor_units - v_new_paid;

    PERFORM 1 FROM public.suppliers
    WHERE id = v_payment.supplier_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'المورد المرتبط بالدفعة غير موجود.';
    END IF;

    UPDATE public.supplier_receipts
    SET
      amount_paid_in_minor_units = v_new_paid,
      amount_due_in_minor_units = v_new_due,
      payment_status = CASE
        WHEN v_new_paid = 0 THEN 'unpaid'
        WHEN v_new_paid = v_receipt.total_in_minor_units THEN 'paid'
        ELSE 'partially_paid'
      END,
      updated_at = NOW()
    WHERE id = v_receipt.id;

    UPDATE public.suppliers
    SET
      current_balance_in_minor_units = current_balance_in_minor_units + v_payment.amount_in_minor_units,
      updated_at = NOW()
    WHERE id = v_payment.supplier_id;

    v_effect := jsonb_build_object(
      'reference_type', 'supplier_receipt',
      'reference_id', v_receipt.id,
      'supplier_balance_restored_in_minor_units', v_payment.amount_in_minor_units,
      'receipt_amount_paid_after_in_minor_units', v_new_paid,
      'receipt_amount_due_after_in_minor_units', v_new_due,
      'cash_in_minor_units', CASE WHEN v_payment.payment_method = 'cash' THEN v_payment.amount_in_minor_units ELSE 0 END,
      'cliq_in_minor_units', CASE WHEN v_payment.payment_method = 'cliq' THEN v_payment.amount_in_minor_units ELSE 0 END
    );
  ELSE
    SELECT * INTO v_purchase_order
    FROM public.purchase_orders
    WHERE id = v_payment.purchase_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_purchase_order.supplier_id <> v_payment.supplier_id THEN
      RAISE EXCEPTION 'أمر شراء المورد لم يعد صالحًا لعكس الدفعة.';
    END IF;
    IF v_purchase_order.amount_paid_in_minor_units < v_payment.amount_in_minor_units THEN
      RAISE EXCEPTION 'رصيد دفعات أمر الشراء لا يسمح بعكس هذه الدفعة بأمان.';
    END IF;

    v_new_paid := v_purchase_order.amount_paid_in_minor_units - v_payment.amount_in_minor_units;
    UPDATE public.purchase_orders
    SET amount_paid_in_minor_units = v_new_paid, updated_at = NOW()
    WHERE id = v_purchase_order.id;

    v_effect := jsonb_build_object(
      'reference_type', 'purchase_order',
      'reference_id', v_purchase_order.id,
      'purchase_order_amount_paid_after_in_minor_units', v_new_paid,
      'supplier_balance_restored_in_minor_units', 0,
      'cash_in_minor_units', CASE WHEN v_payment.payment_method = 'cash' THEN v_payment.amount_in_minor_units ELSE 0 END,
      'cliq_in_minor_units', CASE WHEN v_payment.payment_method = 'cliq' THEN v_payment.amount_in_minor_units ELSE 0 END
    );
  END IF;

  INSERT INTO public.supplier_payment_reversals (
    supplier_payment_id, cash_shift_id, requested_by, reason, idempotency_key,
    expected_effect, actual_effect
  ) VALUES (
    v_payment.id, v_shift.id, v_user_id, v_reason, v_key, v_effect, v_effect
  ) RETURNING id INTO v_existing.id;

  UPDATE public.supplier_payments
  SET
    is_reversed = true,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE id = v_payment.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'REVERSE_SUPPLIER_PAYMENT', 'supplier_payment_reversals', v_existing.id,
    jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'cash_shift_id', v_shift.id,
      'reason', v_reason,
      'effect', v_effect
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'reversal_id', v_existing.id,
    'supplier_payment_id', v_payment.id,
    'cash_shift_id', v_shift.id,
    'actual_effect', v_effect
  );
END;
$$;

-- Completed-sale reports are event based for returns, so a reversal must
-- explicitly exclude the retained-but-cancelled POS source order from every
-- sales/COGS/profit aggregate. Keep returned orders in scope: their existing
-- refund/recovered-COGS accounting remains the canonical returns behavior.
DO $$
DECLARE
  v_definition TEXT;
  v_core_original TEXT := E'  completed_orders AS (\n    SELECT o.*, ce.completed_at\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n  ),';
  v_core_replacement TEXT := E'  completed_orders AS (\n    SELECT o.*, ce.completed_at\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n    WHERE o.status IN (''completed'', ''returned'')\n  ),';
  v_discount_original TEXT := E'  completed_orders AS (\n    SELECT o.id, COALESCE(o.discount_in_minor_units, 0)::BIGINT AS order_discount\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n  ),';
  v_discount_replacement TEXT := E'  completed_orders AS (\n    SELECT o.id, COALESCE(o.discount_in_minor_units, 0)::BIGINT AS order_discount\n    FROM completion_events ce\n    JOIN public.orders o ON o.id = ce.order_id\n    WHERE o.status IN (''completed'', ''returned'')\n  ),';
BEGIN
  SELECT pg_get_functiondef('public._get_operational_business_report_v1(uuid,date,date)'::REGPROCEDURE)
  INTO v_definition;

  IF v_definition IS NULL OR POSITION(v_core_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot safely install POS reversal report guard: core report contract changed.';
  END IF;
  EXECUTE REPLACE(v_definition, v_core_original, v_core_replacement);

  SELECT pg_get_functiondef('public.get_operational_business_report(uuid,date,date)'::REGPROCEDURE)
  INTO v_definition;
  IF v_definition IS NULL OR POSITION(v_discount_original IN v_definition) = 0 THEN
    RAISE EXCEPTION
      'Cannot safely install POS reversal report guard: discount report contract changed.';
  END IF;
  EXECUTE REPLACE(v_definition, v_discount_original, v_discount_replacement);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT)
  TO authenticated;

COMMENT ON TABLE public.pos_sale_reversals IS
  'Immutable audit record for an owner-authorized POS sale reversal. The original order is retained and cancelled.';
COMMENT ON TABLE public.supplier_payment_reversals IS
  'Immutable audit record for an owner-authorized supplier payment reversal.';
COMMENT ON FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT) IS
  'Owner AAL2-only POS reversal primitive. Blocks downstream payment, return, reservation, and later stock movement dependencies.';
COMMENT ON FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT) IS
  'Owner AAL2-only supplier payment reversal primitive for one explicit receipt or purchase-order payment.';

COMMIT;
