BEGIN;

-- Owner17Oct: collection-only cashier access. Complete explicit definitions;
-- allocation, locks, cheque registration context, payloads and reversal guards unchanged.

CREATE OR REPLACE FUNCTION public.cheque_assert_customer_payment_role_internal(p_order_id UUID,p_method TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_method='cheque' THEN
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','cashier','sales'],'استلام شيك عميل');
    IF NOT EXISTS(SELECT 1 FROM public.deferred_cheques c JOIN public.orders o ON o.customer_id=c.customer_id
      WHERE o.id=p_order_id AND c.direction='incoming' AND c.origin='operational' AND c.status='pending'
        AND c.created_by=auth.uid() AND c.registration_txid=txid_current() AND c.collection_operation_id IS NULL) THEN
      RAISE EXCEPTION 'CHEQUE_REQUIRES_UNIFIED_COLLECTION: سجّل الشيك من منسق التحصيل الموحد.';
    END IF;
  ELSE
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales']
      || CASE WHEN p_method IN ('cash','cliq','bank_transfer') THEN ARRAY['cashier'] ELSE ARRAY[]::TEXT[] END,'تسجيل دفعة عميل');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.collect_customer_balance_v1(
  p_customer_id UUID,p_amount_in_minor_units BIGINT,p_payment_method TEXT,p_branch_id UUID,
  p_reference_number TEXT,p_notes TEXT,p_idempotency_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_user_id UUID:=auth.uid();v_key TEXT:=NULLIF(BTRIM(p_idempotency_key),'');
  v_existing public.customer_collection_operations%ROWTYPE;v_operation public.customer_collection_operations%ROWTYPE;
  v_plan JSONB;v_locked_plan JSONB;v_part JSONB;v_opening BIGINT;v_orders BIGINT;v_comp BIGINT;
  v_shift_id UUID;v_payment JSONB;v_id UUID;v_cheque_id UUID;
  v_notes TEXT:=NULLIF(BTRIM(p_notes),'');v_reference TEXT:=NULLIF(BTRIM(p_reference_number),'');v_result JSONB;
BEGIN
  IF p_payment_method='cheque' THEN
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','cashier','sales'],'استلام شيك عميل');
    SELECT id INTO v_cheque_id FROM public.deferred_cheques WHERE customer_id=p_customer_id
      AND direction='incoming' AND origin='operational' AND status='pending' AND created_by=v_user_id
      AND registration_txid=txid_current() AND collection_operation_id IS NULL
      AND amount_in_minor_units=p_amount_in_minor_units AND v_key='cheque-collect-'||id::TEXT;
    IF v_cheque_id IS NULL THEN RAISE EXCEPTION 'CHEQUE_REQUIRES_UNIFIED_COLLECTION: سجّل بيانات الشيك كاملة أولاً.';END IF;
  ELSE
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','cashier','sales'],'تحصيل من الزبون');
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 120 THEN RAISE EXCEPTION 'مفتاح منع تكرار التحصيل غير صالح.';END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','cliq','bank_transfer','cheque') THEN RAISE EXCEPTION 'طريقة الدفع غير معتمدة.';END IF;
  IF COALESCE(p_amount_in_minor_units,0)<=0 OR p_amount_in_minor_units>999999999999 THEN RAISE EXCEPTION 'مبلغ التحصيل يجب أن يكون أكبر من صفر.';END IF;
  IF v_notes IS NOT NULL AND CHAR_LENGTH(v_notes)>300 THEN RAISE EXCEPTION 'الملاحظة أطول من 300 حرف.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection:'||v_key,0));
  SELECT * INTO v_existing FROM public.customer_collection_operations WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.customer_id IS DISTINCT FROM p_customer_id OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'GO_LIVE_COLLECTION_KEY_CONFLICT: مفتاح التحصيل استُخدم لعملية مختلفة.';
    END IF;
    RETURN public.go_live_collection_result_internal(v_existing.id)||jsonb_build_object('idempotentReplay',true);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND NOT is_deleted) THEN RAISE EXCEPTION 'العميل غير موجود.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||p_customer_id::TEXT,0));
  v_plan:=public.go_live_plan_customer_collection_internal(p_customer_id,p_amount_in_minor_units);
  -- Plan every order lock BEFORE any shift/row lock. Same Phase4 key as all
  -- order writers. Cash shifts then orders are acquired in stable UUID order.
  FOR v_id IN SELECT DISTINCT(value->>'id')::UUID FROM jsonb_array_elements(v_plan->'parts')
    WHERE value->>'kind'='order' AND(value->>'allocateInMinorUnits')::BIGINT>0 ORDER BY 1
  LOOP PERFORM pg_advisory_xact_lock(hashtextextended('phase4-order|'||v_id::TEXT,0));END LOOP;
  IF p_payment_method IN ('cash','cliq') THEN
    PERFORM 1 FROM public.cash_shifts s WHERE s.status='open' AND(
      s.branch_id=p_branch_id OR s.branch_id IN(SELECT o.branch_id FROM public.orders o
        JOIN jsonb_array_elements(v_plan->'parts')p ON o.id=(p.value->>'id')::UUID
        WHERE p.value->>'kind'='order' AND(p.value->>'allocateInMinorUnits')::BIGINT>0)) ORDER BY s.id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.orders o JOIN jsonb_array_elements(v_plan->'parts')p ON o.id=(p.value->>'id')::UUID
    WHERE p.value->>'kind'='order' AND(p.value->>'allocateInMinorUnits')::BIGINT>0 ORDER BY o.id FOR UPDATE OF o;
  PERFORM 1 FROM public.customer_opening_balances WHERE customer_id=p_customer_id AND NOT is_reversed ORDER BY occurred_at,entry_number FOR UPDATE;
  PERFORM 1 FROM public.cheque_compensation_claims WHERE party_kind='customer' AND party_id=p_customer_id ORDER BY id FOR UPDATE;
  v_locked_plan:=public.go_live_plan_customer_collection_internal(p_customer_id,p_amount_in_minor_units);
  IF v_locked_plan IS DISTINCT FROM v_plan THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CHEQUE_COLLECTION_PLAN_CHANGED: تغيرت خطة الدين قبل الأقفال؛ أعد المعاينة.';END IF;
  IF p_amount_in_minor_units>(v_plan->>'totalOutstandingInMinorUnits')::BIGINT THEN
    RAISE EXCEPTION 'GO_LIVE_COLLECTION_EXCEEDS_BALANCE: المبلغ أكبر من مجموع دين العميل (% د.أ).',
      ((v_plan->>'totalOutstandingInMinorUnits')::NUMERIC/1000)::TEXT;
  END IF;
  v_opening:=(v_plan->>'openingAllocatedInMinorUnits')::BIGINT;v_orders:=(v_plan->>'ordersAllocatedInMinorUnits')::BIGINT;
  v_comp:=(v_plan->>'compensationAllocatedInMinorUnits')::BIGINT;
  IF v_opening+v_comp>0 AND p_payment_method IN ('cash','cliq') THEN
    IF p_branch_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN
      RAISE EXCEPTION 'حدد فرع الوردية لتحصيل الدين كاش أو CliQ.';
    END IF;
    SELECT id INTO v_shift_id FROM public.cash_shifts WHERE branch_id=p_branch_id AND status='open' FOR SHARE;
    IF v_shift_id IS NULL THEN RAISE EXCEPTION 'افتح وردية الصندوق أولًا قبل تسجيل سند قبض كاش أو CliQ.';END IF;
  END IF;
  INSERT INTO public.customer_collection_operations(operation_number,customer_id,amount_in_minor_units,
    opening_amount_in_minor_units,orders_amount_in_minor_units,compensation_amount_in_minor_units,payment_method,
    reference_number,notes,branch_id,cash_shift_id,idempotency_key,created_by)
  VALUES('COL-'||LPAD(nextval('public.customer_collection_operation_number_seq')::TEXT,6,'0'),p_customer_id,
    p_amount_in_minor_units,v_opening,v_orders,v_comp,p_payment_method,v_reference,v_notes,
    CASE WHEN v_shift_id IS NULL THEN NULL ELSE p_branch_id END,v_shift_id,v_key,v_user_id) RETURNING * INTO v_operation;
  FOR v_part IN SELECT value FROM jsonb_array_elements(v_plan->'parts') WHERE(value->>'allocateInMinorUnits')::BIGINT>0
  LOOP
    IF v_part->>'kind'='opening' THEN
      INSERT INTO public.customer_collection_opening_allocations(operation_id,opening_balance_id,amount_in_minor_units)
      VALUES(v_operation.id,(v_part->>'id')::UUID,(v_part->>'allocateInMinorUnits')::BIGINT);
    ELSIF v_part->>'kind'='compensation' THEN
      INSERT INTO public.customer_collection_cheque_allocations(operation_id,claim_id,amount_in_minor_units)
      VALUES(v_operation.id,(v_part->>'id')::UUID,(v_part->>'allocateInMinorUnits')::BIGINT);
    ELSE
      v_payment:=public.record_customer_order_payment_once((v_part->>'id')::UUID,(v_part->>'allocateInMinorUnits')::BIGINT,
        p_payment_method,v_reference,COALESCE(v_notes||' — ','')||'تحصيل موحد '||v_operation.operation_number,
        'golive-col-'||md5(v_key||':'||(v_part->>'id')));
      INSERT INTO public.customer_collection_order_payments(operation_id,customer_payment_id,order_id,amount_in_minor_units)
      VALUES(v_operation.id,(v_payment->>'payment_id')::UUID,(v_part->>'id')::UUID,(v_part->>'allocateInMinorUnits')::BIGINT);
    END IF;
  END LOOP;
  v_result:=public.go_live_collection_result_internal(v_operation.id);
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(v_user_id,'CUSTOMER_UNIFIED_COLLECTION','customer_collection_operations',v_operation.id,
    jsonb_build_object('operation_number',v_operation.operation_number,'customer_id',p_customer_id,
      'amount_in_minor_units',p_amount_in_minor_units,'payment_method',p_payment_method,
      'opening_amount_in_minor_units',v_opening,'orders_amount_in_minor_units',v_orders,
      'compensation_amount_in_minor_units',v_comp,'cash_shift_id',v_shift_id,'parts',v_result->'parts'));
  RETURN v_result||jsonb_build_object('idempotentReplay',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_customer_collection_v1(p_customer_id UUID, p_amount_in_minor_units BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant', 'cashier', 'sales'],
    'معاينة تحصيل من الزبون');
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;
  v_plan := public.go_live_plan_customer_collection_internal(p_customer_id, p_amount_in_minor_units);
  RETURN v_plan || jsonb_build_object('success', true, 'customerId', p_customer_id,
    'amountInMinorUnits', p_amount_in_minor_units,
    'exceedsBalance', COALESCE(p_amount_in_minor_units, 0) > (v_plan->>'totalOutstandingInMinorUnits')::BIGINT,
    'canonicalBalanceInMinorUnits', public.phase42_customer_receivable_total_internal(p_customer_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_collections_v1(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant', 'cashier', 'sales'], 'عرض عمليات التحصيل');
  RETURN jsonb_build_object('success', true, 'customerId', p_customer_id,
    'operations', COALESCE((SELECT jsonb_agg(public.go_live_collection_result_internal(id)
      ORDER BY created_at DESC, operation_number DESC)
      FROM (SELECT id, created_at, operation_number FROM public.customer_collection_operations
        WHERE customer_id = p_customer_id ORDER BY created_at DESC, operation_number DESC LIMIT 50) recent), '[]'::JSONB));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_outstanding_orders_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'cashier', 'sales'],
    'عرض ذمم العملاء'
  );
  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH outstanding_orders AS (
      SELECT customer_order.id, customer_order.order_number,
        customer_order.customer_id, customer_order.customer_name_snapshot,
        customer_order.source, customer_order.payment_method,
        customer_order.total_in_minor_units,
        customer_order.amount_paid_in_minor_units,
        customer_order.payment_status, customer_order.created_at,
        customer.full_name AS customer_name,
        customer.phone AS customer_phone,
        position.outstanding_total_in_minor_units AS amount_due_in_minor_units
      FROM public.orders customer_order
      JOIN public.customers customer
        ON customer.id = customer_order.customer_id
      CROSS JOIN LATERAL public.phase42_order_financial_position_internal(
        customer_order.id
      ) position
      WHERE customer_order.status IN ('completed', 'delivered')
        AND position.outstanding_total_in_minor_units > 0
        AND (
          COALESCE(customer_order.source, 'website') <> 'pos'
          OR customer_order.payment_method = 'debt'
        )
        AND (
          v_search IS NULL
          OR customer_order.order_number ILIKE '%' || v_search || '%'
          OR COALESCE(
            customer.full_name, customer_order.customer_name_snapshot, ''
          ) ILIKE '%' || v_search || '%'
          OR COALESCE(customer.phone, '') ILIKE '%' || v_search || '%'
        )
    ), paged_orders AS (
      SELECT * FROM outstanding_orders
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset LIMIT v_page_size
    ), summary AS (
      SELECT COUNT(*)::INTEGER AS total_count,
        COUNT(DISTINCT customer_id)::INTEGER AS customer_count,
        COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT
          AS due_in_minor_units
      FROM outstanding_orders
    )
    SELECT JSONB_BUILD_OBJECT(
      'orders', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', id, 'order_number', order_number,
          'customer_id', customer_id,
          'customer_name', COALESCE(
            customer_name, customer_name_snapshot, 'عميل مسجل'
          ),
          'customer_phone', COALESCE(customer_phone, ''),
          'source', source, 'payment_method', payment_method,
          'total_in_minor_units', total_in_minor_units,
          'amount_paid_in_minor_units', amount_paid_in_minor_units,
          'amount_due_in_minor_units', amount_due_in_minor_units,
          'payment_status', payment_status, 'created_at', created_at
        ) ORDER BY created_at DESC, id DESC)
        FROM paged_orders
      ), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', JSONB_BUILD_OBJECT(
        'customer_count', summary.customer_count,
        'due_in_minor_units', summary.due_in_minor_units
      )
    ) FROM summary
  );
END;
$$;

COMMIT;
