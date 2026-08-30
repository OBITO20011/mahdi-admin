-- =========================================================================
-- Nawasrah ERP - Phase 3: owner/AAL2 full cash-shift reversal orchestrator.
-- All work happens in one transaction.  Original business records remain
-- immutable evidence; their active accounting effect is reversed in-place.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_shift_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL UNIQUE REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(reason)) BETWEEN 3 AND 500),
  idempotency_key TEXT NOT NULL CHECK (CHAR_LENGTH(TRIM(idempotency_key)) BETWEEN 16 AND 200),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed')),
  expected_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  actual_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (requested_by, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.cash_shift_reversal_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reversal_id UUID NOT NULL REFERENCES public.cash_shift_reversals(id) ON DELETE RESTRICT,
  shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('pos_sale', 'customer_payment', 'supplier_payment', 'operational_expense')),
  original_record_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reversed', 'already_reversed')),
  primitive_reversal_reference UUID,
  expected_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  actual_effect JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reversal_id, operation_type, original_record_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_shift_reversal_operations_shift
  ON public.cash_shift_reversal_operations(shift_id, created_at DESC);

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS reversal_id UUID;

ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_reversal_id_fkey;
ALTER TABLE public.cash_shifts
  ADD CONSTRAINT cash_shifts_reversal_id_fkey
  FOREIGN KEY (reversal_id) REFERENCES public.cash_shift_reversals(id) ON DELETE RESTRICT;

ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_status_check,
  DROP CONSTRAINT IF EXISTS cash_shifts_check,
  DROP CONSTRAINT IF EXISTS cash_shifts_lifecycle_check;
ALTER TABLE public.cash_shifts
  ADD CONSTRAINT cash_shifts_status_check
    CHECK (status IN ('open', 'closed', 'cancelled', 'reversed')),
  ADD CONSTRAINT cash_shifts_lifecycle_check CHECK (
    (status = 'open'
      AND closed_at IS NULL AND actual_cash_in_minor_units IS NULL
      AND cancelled_at IS NULL AND reversed_at IS NULL)
    OR (status = 'closed'
      AND closed_at IS NOT NULL AND actual_cash_in_minor_units IS NOT NULL
      AND cancelled_at IS NULL AND reversed_at IS NULL)
    OR (status = 'cancelled'
      AND closed_at IS NULL AND actual_cash_in_minor_units IS NULL
      AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL
      AND reversed_at IS NULL)
    OR (status = 'reversed'
      AND closed_at IS NULL AND actual_cash_in_minor_units IS NULL
      AND cancelled_at IS NULL
      AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL AND reversal_id IS NOT NULL)
  );

ALTER TABLE public.cash_shift_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_shift_reversal_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_shift_reversals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cash_shift_reversal_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cash_shift_reversals TO service_role;
GRANT ALL ON TABLE public.cash_shift_reversal_operations TO service_role;

-- Internal preview contains no authorisation so execute can re-run it after
-- acquiring the canonical lock set.  It is not callable by browser roles.
CREATE OR REPLACE FUNCTION public._preview_cash_shift_full_reversal(
  p_shift_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_operations JSONB := '[]'::JSONB;
  v_summary JSONB;
  v_has_blocker BOOLEAN := false;
BEGIN
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;

  WITH operation_rows AS (
    SELECT
      'pos_sale'::TEXT AS operation_type,
      o.id AS original_record_id,
      CASE
        WHEN psr.id IS NOT NULL THEN 'BLOCKED'
        WHEN o.source IS DISTINCT FROM 'pos' THEN 'BLOCKED'
        WHEN o.status <> 'completed' THEN 'BLOCKED'
        WHEN EXISTS (SELECT 1 FROM public.customer_payments cp WHERE cp.order_id = o.id AND NOT cp.is_reversed) THEN 'BLOCKED'
        WHEN EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.order_id = o.id) THEN 'BLOCKED'
        WHEN EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.inventory_movements im ON im.warehouse_id = o.warehouse_id AND im.product_id = oi.product_id
          WHERE oi.order_id = o.id AND im.reference_id IS DISTINCT FROM o.id AND im.created_at >= o.created_at
        ) THEN 'BLOCKED'
        WHEN EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.inventory_balances ib ON ib.warehouse_id = o.warehouse_id AND ib.product_id = oi.product_id
          WHERE oi.order_id = o.id AND ib.reserved_quantity <> 0
        ) THEN 'BLOCKED'
        ELSE 'SUPPORTED'
      END AS support_status,
      CASE
        WHEN psr.id IS NOT NULL THEN 'تم عكس بيع POS مسبقًا.'
        WHEN o.source IS DISTINCT FROM 'pos' THEN 'طلب Website/مصدر غير POS لا يملك primitive عكس آمنة ضمن V1.'
        WHEN o.status <> 'completed' THEN 'البيع ليس POS مكتملًا قابلًا للعكس.'
        WHEN EXISTS (SELECT 1 FROM public.customer_payments cp WHERE cp.order_id = o.id AND NOT cp.is_reversed) THEN 'البيع عليه سند قبض عميل لاحق.'
        WHEN EXISTS (SELECT 1 FROM public.sales_returns sr WHERE sr.order_id = o.id) THEN 'يوجد مرتجع مبيعات مرتبط بالبيع.'
        WHEN EXISTS (SELECT 1 FROM public.order_items oi JOIN public.inventory_movements im ON im.warehouse_id=o.warehouse_id AND im.product_id=oi.product_id WHERE oi.order_id=o.id AND im.reference_id IS DISTINCT FROM o.id AND im.created_at>=o.created_at) THEN 'يوجد اعتماد مخزون لاحق على أحد الأصناف.'
        WHEN EXISTS (SELECT 1 FROM public.order_items oi JOIN public.inventory_balances ib ON ib.warehouse_id=o.warehouse_id AND ib.product_id=oi.product_id WHERE oi.order_id=o.id AND ib.reserved_quantity<>0) THEN 'أحد أصناف البيع محجوز حاليًا.'
        ELSE NULL
      END AS reason,
      jsonb_build_object(
        'cash_in_minor_units', CASE WHEN o.payment_method = 'cash' THEN -o.total_in_minor_units ELSE 0 END,
        'cliq_in_minor_units', CASE WHEN o.payment_method = 'cliq' THEN -o.total_in_minor_units ELSE 0 END,
        'customer_balance_in_minor_units', CASE WHEN o.payment_method = 'debt' THEN -o.total_in_minor_units ELSE 0 END,
        'supplier_balance_in_minor_units', 0,
        'inventory_base_units_delta', COALESCE((SELECT SUM(oi.quantity)::BIGINT FROM public.order_items oi WHERE oi.order_id=o.id), 0),
        'sales_in_minor_units', -o.total_in_minor_units,
        'discount_in_minor_units', -o.discount_in_minor_units,
        'cogs_in_minor_units', -COALESCE((SELECT SUM(oi.cogs_in_minor_units)::BIGINT FROM public.order_items oi WHERE oi.order_id=o.id), 0),
        'profit_in_minor_units', -COALESCE((SELECT SUM(oi.profit_in_minor_units)::BIGINT FROM public.order_items oi WHERE oi.order_id=o.id), 0)
      ) AS expected_effect
    FROM public.orders o
    LEFT JOIN public.pos_sale_reversals psr ON psr.order_id = o.id
    WHERE o.cash_shift_id = p_shift_id

    UNION ALL

    SELECT
      'customer_payment', cp.id,
      CASE
        WHEN cp.is_reversed THEN 'BLOCKED'
        WHEN o.source = 'pos' THEN 'BLOCKED'
        WHEN o.status <> 'completed' THEN 'BLOCKED'
        ELSE 'SUPPORTED'
      END,
      CASE
        WHEN cp.is_reversed THEN 'تم عكس سند القبض مسبقًا.'
        WHEN o.source = 'pos' THEN 'سند قبض مرتبط ببيع POS؛ البيع نفسه يجب أن يبقى BLOCKED.'
        WHEN o.status <> 'completed' THEN 'سند القبض لا يرتبط بطلب مكتمل قائم.'
        ELSE NULL
      END,
      jsonb_build_object(
        'cash_in_minor_units', CASE WHEN cp.payment_method = 'cash' THEN -cp.amount_in_minor_units ELSE 0 END,
        'cliq_in_minor_units', CASE WHEN cp.payment_method = 'cliq' THEN -cp.amount_in_minor_units ELSE 0 END,
        'customer_balance_in_minor_units', cp.amount_in_minor_units,
        'supplier_balance_in_minor_units', 0,
        'inventory_base_units_delta', 0, 'sales_in_minor_units', 0,
        'discount_in_minor_units', 0, 'cogs_in_minor_units', 0, 'profit_in_minor_units', 0
      )
    FROM public.customer_payments cp
    JOIN public.orders o ON o.id = cp.order_id
    WHERE cp.cash_shift_id = p_shift_id

    UNION ALL

    SELECT
      'supplier_payment', sp.id,
      CASE
        WHEN sp.is_reversed THEN 'BLOCKED'
        WHEN (sp.supplier_receipt_id IS NULL AND sp.purchase_order_id IS NULL)
          OR (sp.supplier_receipt_id IS NOT NULL AND sp.purchase_order_id IS NOT NULL) THEN 'BLOCKED'
        WHEN sp.supplier_receipt_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.supplier_receipts sr WHERE sr.id=sp.supplier_receipt_id AND sr.status='completed' AND sr.supplier_id=sp.supplier_id AND sr.amount_paid_in_minor_units>=sp.amount_in_minor_units
        ) THEN 'BLOCKED'
        WHEN sp.purchase_order_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.purchase_orders po WHERE po.id=sp.purchase_order_id AND po.supplier_id=sp.supplier_id AND po.amount_paid_in_minor_units>=sp.amount_in_minor_units
        ) THEN 'BLOCKED'
        ELSE 'SUPPORTED'
      END,
      CASE
        WHEN sp.is_reversed THEN 'تم عكس دفعة المورد مسبقًا.'
        WHEN (sp.supplier_receipt_id IS NULL AND sp.purchase_order_id IS NULL) OR (sp.supplier_receipt_id IS NOT NULL AND sp.purchase_order_id IS NOT NULL) THEN 'دفعة المورد لا تحمل مرجعًا ماليًا واحدًا واضحًا.'
        WHEN sp.supplier_receipt_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.supplier_receipts sr WHERE sr.id=sp.supplier_receipt_id AND sr.status='completed' AND sr.supplier_id=sp.supplier_id AND sr.amount_paid_in_minor_units>=sp.amount_in_minor_units
        ) THEN 'سند استلام المورد أو رصيده لم يعد صالحًا لعكس الدفعة.'
        WHEN sp.purchase_order_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.purchase_orders po WHERE po.id=sp.purchase_order_id AND po.supplier_id=sp.supplier_id AND po.amount_paid_in_minor_units>=sp.amount_in_minor_units
        ) THEN 'أمر الشراء أو رصيده لم يعد صالحًا لعكس الدفعة.'
        ELSE NULL
      END,
      jsonb_build_object(
        'cash_in_minor_units', CASE WHEN sp.payment_method='cash' THEN sp.amount_in_minor_units ELSE 0 END,
        'cliq_in_minor_units', CASE WHEN sp.payment_method='cliq' THEN sp.amount_in_minor_units ELSE 0 END,
        'customer_balance_in_minor_units', 0,
        'supplier_balance_in_minor_units', CASE WHEN sp.supplier_receipt_id IS NOT NULL THEN sp.amount_in_minor_units ELSE 0 END,
        'inventory_base_units_delta', 0, 'sales_in_minor_units', 0,
        'discount_in_minor_units', 0, 'cogs_in_minor_units', 0, 'profit_in_minor_units', 0
      )
    FROM public.supplier_payments sp
    WHERE sp.cash_shift_id = p_shift_id

    UNION ALL

    SELECT
      'operational_expense', oe.id,
      CASE WHEN oe.is_reversed THEN 'BLOCKED' ELSE 'SUPPORTED' END,
      CASE WHEN oe.is_reversed THEN 'تم عكس المصروف مسبقًا.' ELSE NULL END,
      jsonb_build_object(
        'cash_in_minor_units', CASE WHEN oe.payment_method='cash' THEN oe.amount_in_minor_units ELSE 0 END,
        'cliq_in_minor_units', CASE WHEN oe.payment_method='cliq' THEN oe.amount_in_minor_units ELSE 0 END,
        'customer_balance_in_minor_units', 0, 'supplier_balance_in_minor_units', 0,
        'inventory_base_units_delta', 0, 'sales_in_minor_units', 0,
        'discount_in_minor_units', 0, 'cogs_in_minor_units', 0, 'profit_in_minor_units', 0
      )
    FROM public.operational_expenses oe
    WHERE oe.shift_id = p_shift_id

    UNION ALL

    SELECT
      'unsupported_sales_return', sr.id, 'BLOCKED',
      'مرتجع المبيعات لا يملك primitive عكس آمنة ضمن V1.',
      jsonb_build_object('cash_in_minor_units',0,'cliq_in_minor_units',0,'customer_balance_in_minor_units',0,'supplier_balance_in_minor_units',0,'inventory_base_units_delta',0,'sales_in_minor_units',0,'discount_in_minor_units',0,'cogs_in_minor_units',0,'profit_in_minor_units',0)
    FROM public.sales_returns sr WHERE sr.cash_shift_id = p_shift_id
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'operationType', operation_type,
      'originalRecordId', original_record_id,
      'status', support_status,
      'reason', reason,
      'expectedEffect', expected_effect
    ) ORDER BY operation_type, original_record_id), '[]'::JSONB),
    COALESCE(bool_or(support_status IN ('BLOCKED','UNSUPPORTED')), false),
    jsonb_build_object(
      'cash_in_minor_units', COALESCE(SUM((expected_effect->>'cash_in_minor_units')::BIGINT),0),
      'cliq_in_minor_units', COALESCE(SUM((expected_effect->>'cliq_in_minor_units')::BIGINT),0),
      'customer_balance_in_minor_units', COALESCE(SUM((expected_effect->>'customer_balance_in_minor_units')::BIGINT),0),
      'supplier_balance_in_minor_units', COALESCE(SUM((expected_effect->>'supplier_balance_in_minor_units')::BIGINT),0),
      'inventory_base_units_delta', COALESCE(SUM((expected_effect->>'inventory_base_units_delta')::BIGINT),0),
      'sales_in_minor_units', COALESCE(SUM((expected_effect->>'sales_in_minor_units')::BIGINT),0),
      'discount_in_minor_units', COALESCE(SUM((expected_effect->>'discount_in_minor_units')::BIGINT),0),
      'cogs_in_minor_units', COALESCE(SUM((expected_effect->>'cogs_in_minor_units')::BIGINT),0),
      'profit_in_minor_units', COALESCE(SUM((expected_effect->>'profit_in_minor_units')::BIGINT),0)
    )
  INTO v_operations, v_has_blocker, v_summary
  FROM operation_rows;

  IF v_shift.status <> 'open' THEN
    v_has_blocker := true;
  END IF;
  IF jsonb_array_length(v_operations) = 0 THEN
    v_has_blocker := true;
    v_operations := v_operations || jsonb_build_array(jsonb_build_object(
      'operationType','shift', 'originalRecordId', v_shift.id, 'status','BLOCKED',
      'reason','لا توجد عمليات مرتبطة صراحة بالوردية؛ استخدم إلغاء الوردية الفارغة.',
      'expectedEffect','{}'::JSONB));
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'shiftId', v_shift.id, 'shiftNumber', v_shift.shift_number,
    'shiftStatus', v_shift.status, 'canExecute', NOT v_has_blocker,
    'operations', v_operations, 'summary', v_summary,
    'scopeNote', 'لا تُنسب حركات المخزون أو الاستلام غير المرتبطة بمفتاح shift_id صريح إلى هذه الوردية بالتخمين.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_cash_shift_full_reversal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_reversal_owner('معاينة إلغاء الوردية وعكس عملياتها');
  RETURN public._preview_cash_shift_full_reversal(p_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_cash_shift_with_operations(
  p_shift_id UUID,
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
  v_existing public.cash_shift_reversals%ROWTYPE;
  v_reversal_id UUID;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_preview JSONB;
  v_operation JSONB;
  v_result JSONB;
  v_payment public.customer_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_expense public.operational_expenses%ROWTYPE;
  v_new_paid BIGINT;
  v_audit_id UUID;
  v_primitive_id UUID;
BEGIN
  v_user_id := public.assert_reversal_owner('إلغاء الوردية وعكس جميع عملياتها');
  IF p_shift_id IS NULL THEN RAISE EXCEPTION 'الوردية المطلوبة غير محددة.'; END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'سبب عكس الوردية مطلوب ويجب أن يكون بين 3 و500 حرف.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع التكرار لعكس الوردية غير صالح.';
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '30s', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-shift-full-reversal:' || p_shift_id::TEXT, 0));

  PERFORM 1 FROM public.cash_shifts WHERE id=p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;

  SELECT * INTO v_existing
  FROM public.cash_shift_reversals
  WHERE requested_by=v_user_id AND idempotency_key=v_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.shift_id <> p_shift_id THEN RAISE EXCEPTION 'مفتاح منع التكرار مستخدم لوردية أخرى.'; END IF;
    RETURN jsonb_build_object('success',true,'idempotent',true,'reversalId',v_existing.id,'status',v_existing.status,'actualEffect',v_existing.actual_effect);
  END IF;
  SELECT * INTO v_existing FROM public.cash_shift_reversals WHERE shift_id=p_shift_id FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'تم عكس هذه الوردية مسبقًا تحت المرجع %.', v_existing.id; END IF;

  -- Canonical global lock order: shift, orders, customer payments, supplier
  -- payments, expenses, returns, inventory balances, receipt/PO, suppliers.
  PERFORM 1 FROM public.orders WHERE cash_shift_id=p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.customer_payments WHERE cash_shift_id=p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.supplier_payments WHERE cash_shift_id=p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.operational_expenses WHERE shift_id=p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sales_returns WHERE cash_shift_id=p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1
  FROM public.inventory_balances ib
  JOIN (SELECT DISTINCT o.warehouse_id, oi.product_id FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id WHERE o.cash_shift_id=p_shift_id) keys
    ON keys.warehouse_id=ib.warehouse_id AND keys.product_id=ib.product_id
  ORDER BY ib.warehouse_id, ib.product_id FOR UPDATE OF ib;
  PERFORM 1 FROM public.supplier_receipts sr JOIN public.supplier_payments sp ON sp.supplier_receipt_id=sr.id WHERE sp.cash_shift_id=p_shift_id ORDER BY sr.id FOR UPDATE OF sr;
  PERFORM 1 FROM public.purchase_orders po JOIN public.supplier_payments sp ON sp.purchase_order_id=po.id WHERE sp.cash_shift_id=p_shift_id ORDER BY po.id FOR UPDATE OF po;
  PERFORM 1 FROM public.suppliers s JOIN public.supplier_payments sp ON sp.supplier_id=s.id WHERE sp.cash_shift_id=p_shift_id ORDER BY s.id FOR UPDATE OF s;

  v_preview := public._preview_cash_shift_full_reversal(p_shift_id);
  IF COALESCE((v_preview->>'canExecute')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'عكس الوردية محجوب: %', COALESCE(v_preview->'operations','[]'::JSONB);
  END IF;

  INSERT INTO public.cash_shift_reversals(shift_id,requested_by,reason,idempotency_key,expected_effect)
  VALUES(p_shift_id,v_user_id,v_reason,v_key,v_preview->'summary') RETURNING id INTO v_reversal_id;

  FOR v_operation IN SELECT value FROM jsonb_array_elements(v_preview->'operations') LOOP
    v_primitive_id := NULL;
    IF v_operation->>'status' = 'ALREADY_REVERSED' THEN
      IF v_operation->>'operationType'='pos_sale' THEN SELECT id INTO v_primitive_id FROM public.pos_sale_reversals WHERE order_id=(v_operation->>'originalRecordId')::UUID;
      ELSIF v_operation->>'operationType'='supplier_payment' THEN SELECT id INTO v_primitive_id FROM public.supplier_payment_reversals WHERE supplier_payment_id=(v_operation->>'originalRecordId')::UUID;
      END IF;
      INSERT INTO public.cash_shift_reversal_operations(reversal_id,shift_id,operation_type,original_record_id,status,primitive_reversal_reference,expected_effect,actual_effect)
      VALUES(v_reversal_id,p_shift_id,v_operation->>'operationType',(v_operation->>'originalRecordId')::UUID,'already_reversed',v_primitive_id,v_operation->'expectedEffect',v_operation->'expectedEffect');
      CONTINUE;
    END IF;

    IF v_operation->>'operationType'='pos_sale' THEN
      v_result := public.reverse_pos_sale((v_operation->>'originalRecordId')::UUID,v_reason,'shift:'||v_reversal_id::TEXT||':pos:'||(v_operation->>'originalRecordId'));
      v_primitive_id := (v_result->>'reversal_id')::UUID;
    ELSIF v_operation->>'operationType'='supplier_payment' THEN
      v_result := public.reverse_supplier_payment((v_operation->>'originalRecordId')::UUID,v_reason,'shift:'||v_reversal_id::TEXT||':supplier:'||(v_operation->>'originalRecordId'));
      v_primitive_id := (v_result->>'reversal_id')::UUID;
    ELSIF v_operation->>'operationType'='customer_payment' THEN
      SELECT * INTO v_payment FROM public.customer_payments WHERE id=(v_operation->>'originalRecordId')::UUID FOR UPDATE;
      SELECT * INTO v_order FROM public.orders WHERE id=v_payment.order_id FOR UPDATE;
      IF NOT FOUND OR v_payment.is_reversed OR v_payment.cash_shift_id<>p_shift_id OR v_order.status<>'completed' OR v_order.source='pos' THEN
        RAISE EXCEPTION 'سند القبض لم يعد قابلًا للعكس ضمن الوردية.';
      END IF;
      v_new_paid := GREATEST(v_order.amount_paid_in_minor_units-v_payment.amount_in_minor_units,0);
      UPDATE public.orders SET amount_paid_in_minor_units=v_new_paid,payment_status=CASE WHEN v_new_paid=0 THEN 'unpaid' ELSE 'partially_paid' END,updated_at=NOW() WHERE id=v_order.id;
      UPDATE public.customer_payments SET is_reversed=true,reversed_at=NOW(),reversed_by=v_user_id,reversal_reason=v_reason WHERE id=v_payment.id;
      INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(v_user_id,'REVERSE_CUSTOMER_PAYMENT_FOR_SHIFT','customer_payments',v_payment.id,jsonb_build_object('shift_id',p_shift_id,'reversal_id',v_reversal_id,'reason',v_reason)) RETURNING id INTO v_audit_id;
      v_primitive_id := v_audit_id;
    ELSIF v_operation->>'operationType'='operational_expense' THEN
      SELECT * INTO v_expense FROM public.operational_expenses WHERE id=(v_operation->>'originalRecordId')::UUID FOR UPDATE;
      IF NOT FOUND OR v_expense.is_reversed OR v_expense.shift_id<>p_shift_id THEN RAISE EXCEPTION 'المصروف لم يعد قابلًا للعكس ضمن الوردية.'; END IF;
      UPDATE public.operational_expenses SET is_reversed=true,reversed_at=NOW(),reversed_by=v_user_id,reversal_reason=v_reason WHERE id=v_expense.id;
      INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(v_user_id,'REVERSE_OPERATIONAL_EXPENSE_FOR_SHIFT','operational_expenses',v_expense.id,jsonb_build_object('shift_id',p_shift_id,'reversal_id',v_reversal_id,'reason',v_reason)) RETURNING id INTO v_audit_id;
      v_primitive_id := v_audit_id;
    ELSE
      RAISE EXCEPTION 'نوع عملية غير مدعوم في تنفيذ عكس الوردية.';
    END IF;

    INSERT INTO public.cash_shift_reversal_operations(reversal_id,shift_id,operation_type,original_record_id,status,primitive_reversal_reference,expected_effect,actual_effect)
    VALUES(v_reversal_id,p_shift_id,v_operation->>'operationType',(v_operation->>'originalRecordId')::UUID,'reversed',v_primitive_id,v_operation->'expectedEffect',v_operation->'expectedEffect');
  END LOOP;

  UPDATE public.cash_shifts SET status='reversed',closed_by=NULL,closed_at=NULL,actual_cash_in_minor_units=NULL,cash_discrepancy_in_minor_units=NULL,discrepancy_reason=NULL,reversed_by=v_user_id,reversed_at=NOW(),reversal_reason=v_reason,reversal_id=v_reversal_id,updated_at=NOW() WHERE id=p_shift_id;
  UPDATE public.cash_shift_reversals SET status='completed',actual_effect=v_preview->'summary',completed_at=NOW() WHERE id=v_reversal_id;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(v_user_id,'REVERSE_CASH_SHIFT_WITH_OPERATIONS','cash_shifts',p_shift_id,jsonb_build_object('reversal_id',v_reversal_id,'reason',v_reason,'effect',v_preview->'summary','operations',v_preview->'operations'));

  RETURN jsonb_build_object('success',true,'idempotent',false,'reversalId',v_reversal_id,'shiftId',p_shift_id,'actualEffect',v_preview->'summary','operations',v_preview->'operations','message','تم عكس جميع عمليات الوردية ضمن معاملة واحدة وحفظ سجل المراجعة.');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_shift_display_summary(p_shift_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_shift public.cash_shifts%ROWTYPE; v_opened_by_name TEXT; v_actor_name TEXT;
BEGIN
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;
  IF v_shift.status NOT IN ('cancelled','reversed') THEN RETURN public.get_cash_shift_summary(p_shift_id); END IF;
  SELECT full_name INTO v_opened_by_name FROM public.profiles WHERE id=v_shift.opened_by;
  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id=CASE WHEN v_shift.status='cancelled' THEN v_shift.cancelled_by ELSE v_shift.reversed_by END;
  RETURN jsonb_build_object('id',v_shift.id,'shiftNumber',v_shift.shift_number,'branchId',v_shift.branch_id,'cashierName',COALESCE(v_opened_by_name,'مستخدم النظام'),'startTime',v_shift.opened_at,'endTime',CASE WHEN v_shift.status='cancelled' THEN v_shift.cancelled_at ELSE v_shift.reversed_at END,'openingCashInMinorUnits',v_shift.opening_cash_in_minor_units,'cashSalesInMinorUnits',0,'cliqSalesInMinorUnits',0,'cardSalesInMinorUnits',0,'cashReceiptsInMinorUnits',0,'cliqReceiptsInMinorUnits',0,'cashSupplierPaymentsInMinorUnits',0,'cliqSupplierPaymentsInMinorUnits',0,'cashExpensesInMinorUnits',0,'cliqExpensesInMinorUnits',0,'cashRefundsInMinorUnits',0,'cliqRefundsInMinorUnits',0,'expectedCashInMinorUnits',v_shift.opening_cash_in_minor_units,'actualCashInMinorUnits',NULL,'cashDiscrepancyInMinorUnits',NULL,'discrepancyReason',NULL,'status',v_shift.status,'managerSignOffBy',NULL,'cancelledByName',CASE WHEN v_shift.status='cancelled' THEN v_actor_name ELSE NULL END,'cancelledAt',v_shift.cancelled_at,'cancellationReason',v_shift.cancellation_reason,'reversedByName',CASE WHEN v_shift.status='reversed' THEN v_actor_name ELSE NULL END,'reversedAt',v_shift.reversed_at,'reversalReason',v_shift.reversal_reason,'reversalId',v_shift.reversal_id);
END; $$;

-- Keep reversed shifts visible in the existing shift center history.
CREATE OR REPLACE FUNCTION public.get_expense_shift_center(p_branch_id UUID,p_expense_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB; v_expenses JSONB; v_recent JSONB;
BEGIN
  v_result := public._get_expense_shift_center_v1(p_branch_id,p_expense_limit);
  SELECT COALESCE(jsonb_agg(public.get_cash_shift_display_summary(id) ORDER BY opened_at DESC),'[]'::JSONB) INTO v_recent FROM (SELECT id,opened_at FROM public.cash_shifts WHERE branch_id=p_branch_id AND status IN ('closed','cancelled','reversed') ORDER BY opened_at DESC LIMIT 10) r;
  SELECT COALESCE(jsonb_agg(expense_payload ORDER BY created_at DESC),'[]'::JSONB) INTO v_expenses FROM (SELECT oe.created_at,jsonb_build_object('id',oe.id,'expenseNumber',oe.expense_number,'branchId',oe.branch_id,'shiftId',oe.shift_id,'category',oe.category,'description',oe.description,'amountInMinorUnits',oe.amount_in_minor_units,'paymentMethod',oe.payment_method,'referenceNumber',oe.reference_number,'isReversed',oe.is_reversed,'reversedAt',oe.reversed_at,'reversalReason',oe.reversal_reason,'reversedByName',COALESCE(rp.full_name,''),'createdByName',COALESCE(cp.full_name,'مستخدم النظام'),'createdAt',oe.created_at) expense_payload FROM public.operational_expenses oe LEFT JOIN public.profiles cp ON cp.id=oe.created_by LEFT JOIN public.profiles rp ON rp.id=oe.reversed_by WHERE oe.branch_id=p_branch_id ORDER BY oe.created_at DESC LIMIT p_expense_limit) e;
  RETURN jsonb_set(jsonb_set(v_result,'{expenses}',v_expenses,true),'{recentShifts}',v_recent,true);
END; $$;

REVOKE ALL ON FUNCTION public._preview_cash_shift_full_reversal(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_cash_shift_full_reversal(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_cash_shift_full_reversal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID,TEXT,TEXT) TO authenticated;

COMMENT ON FUNCTION public.reverse_cash_shift_with_operations(UUID,TEXT,TEXT) IS 'Owner AAL2-only atomic full reversal of explicit supported open-shift operations. Any unsafe dependency blocks before mutations.';
COMMENT ON TABLE public.cash_shift_reversals IS 'Immutable owner-authorized full cash-shift reversal header; originals are never deleted.';

COMMIT;
