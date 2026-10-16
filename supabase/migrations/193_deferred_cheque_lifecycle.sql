BEGIN;

-- Owner2026-10-16. No original payment reversal on either return or erroneous
-- registration cancellation. All entrypoints own one atomic transaction.
CREATE FUNCTION public.cheque_replay_internal(p_key TEXT,p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_event public.deferred_cheque_events%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_key IS NULL OR char_length(p_key) NOT BETWEEN 16 AND 160 THEN
    RAISE EXCEPTION 'CHEQUE_KEY_REQUIRED: مفتاح العملية غير صالح.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cheque-request:'||auth.uid()::TEXT||':'||p_key,0));
  SELECT * INTO v_event FROM public.deferred_cheque_events WHERE actor_id=auth.uid() AND idempotency_key=p_key;
  IF FOUND THEN
    IF v_event.request_identity IS DISTINCT FROM p_request THEN
      RAISE EXCEPTION 'CHEQUE_IDEMPOTENCY_CONFLICT: المفتاح مستخدم لعملية مختلفة.';
    END IF;
    RETURN v_event.result_snapshot||jsonb_build_object('idempotentReplay',true);
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.cheque_replay_internal(TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_replay_internal(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_result_internal(p_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('success',true,'idempotentReplay',false,'cheque',
    to_jsonb(c)-'registration_txid'-'bank_key',
    'customerBalanceInMinorUnits',CASE WHEN c.customer_id IS NOT NULL THEN public.phase42_customer_receivable_total_internal(c.customer_id) END,
    'supplierBalanceInMinorUnits',(SELECT s.current_balance_in_minor_units FROM public.suppliers s WHERE s.id=COALESCE(c.endorsed_supplier_id,c.supplier_id)),
    'claims',COALESCE((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.party_kind,k.id) FROM public.cheque_compensation_claims k WHERE k.cheque_id=c.id),'[]'::JSONB))
  FROM public.deferred_cheques c WHERE c.id=p_id;
$$;
ALTER FUNCTION public.cheque_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_result_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_finish_event_internal(p_id UUID,p_kind TEXT,p_previous TEXT,p_reason TEXT,p_key TEXT,p_request JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_result JSONB;
BEGIN
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_id;
  v_result:=public.cheque_result_internal(p_id);
  INSERT INTO public.deferred_cheque_events(cheque_id,version,kind,previous_status,resulting_status,actor_id,reason,idempotency_key,request_identity,result_snapshot)
  VALUES(v_c.id,v_c.version,p_kind,p_previous,v_c.status,auth.uid(),p_reason,p_key,p_request,v_result);
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(auth.uid(),'DEFERRED_CHEQUE_'||upper(p_kind),'deferred_cheques',p_id,
    jsonb_build_object('tracking_number',v_c.tracking_number,'previous_status',p_previous,'status',v_c.status,
      'amount_in_minor_units',v_c.amount_in_minor_units,'version',v_c.version,'reason',p_reason,
      'compensation_kind',CASE WHEN p_kind IN ('returned','cancelled') THEN p_kind END));
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.cheque_finish_event_internal(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_finish_event_internal(UUID,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

-- Allocation dates only: the balance authority is still133, not these parts.
-- Non-positive opening advances and effective payments are coverage. No
-- creation timestamp is substituted for an unproven original debt date.
CREATE OR REPLACE FUNCTION public.go_live_supplier_opening_payable_internal(p_supplier_id UUID)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT GREATEST(LEAST(
    COALESCE((SELECT SUM(amount_in_minor_units) FROM public.supplier_opening_balances
      WHERE supplier_id=p_supplier_id AND direction='payable' AND NOT is_reversed),0)
    -COALESCE((SELECT SUM(p.amount_in_minor_units) FROM public.supplier_opening_payments l
      JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
      WHERE l.supplier_id=p_supplier_id AND NOT COALESCE(p.is_reversed,false)),0)
    -COALESCE((SELECT SUM(a.amount_in_minor_units) FROM public.deferred_cheque_allocations a
      JOIN public.deferred_cheques c ON c.id=a.cheque_id
      JOIN public.supplier_payments p ON p.id=c.supplier_payment_id
      WHERE a.party_kind='supplier' AND a.party_id=p_supplier_id AND a.origin_kind='opening'
        AND p.supplier_id=p_supplier_id AND NOT p.is_reversed
        AND NOT EXISTS(SELECT 1 FROM public.supplier_opening_payments l WHERE l.supplier_payment_id=p.id)),0),
    COALESCE((SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=p_supplier_id),0)
  ),0)::BIGINT;
$$;

CREATE FUNCTION public.cheque_supplier_plan_internal(p_supplier_id UUID,p_amount BIGINT,p_claim_id UUID DEFAULT NULL,p_purchase_order_id UUID DEFAULT NULL,p_opening_only BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_balance BIGINT;v_stored BIGINT;v_result JSONB;v_claim RECORD;
  v_po public.purchase_orders%ROWTYPE;v_paid NUMERIC;v_receipts NUMERIC;v_legacy NUMERIC;v_cap NUMERIC;v_available BIGINT;
BEGIN
  SELECT balance INTO v_balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=p_supplier_id;
  SELECT current_balance_in_minor_units INTO v_stored FROM public.suppliers WHERE id=p_supplier_id;
  IF v_balance IS NULL OR v_balance IS DISTINCT FROM v_stored THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH: رصيد المورد لا يطابق دليل133.';
  END IF;
  IF COALESCE(p_amount,0)<=0 OR p_amount>v_balance THEN
    RAISE EXCEPTION 'CHEQUE_EXCEEDS_SUPPLIER_BALANCE: مبلغ الشيك أكبر من ذمة المورد؛ لا سلفة مورد.';
  END IF;
  v_available:=v_balance;
  IF p_opening_only THEN
    IF p_claim_id IS NOT NULL OR p_purchase_order_id IS NOT NULL THEN RAISE EXCEPTION 'سداد الرصيد السابق لا يخصص لأمر شراء أو قيد آخر.';END IF;
    v_available:=public.go_live_supplier_opening_payable_internal(p_supplier_id);
    IF p_amount>v_available THEN RAISE EXCEPTION 'GO_LIVE_SUPPLIER_PAYMENT_EXCEEDS_OPENING: مبلغ الشيك أكبر من المتبقي من الرصيد السابق.';END IF;
  END IF;
  IF p_purchase_order_id IS NOT NULL THEN
    IF p_claim_id IS NOT NULL THEN RAISE EXCEPTION 'اختر أمر شراء أو قيد شيك، لا كليهما.';END IF;
    SELECT * INTO v_po FROM public.purchase_orders WHERE id=p_purchase_order_id AND supplier_id=p_supplier_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء لا يتبع المورد المحدد.';END IF;
    SELECT COALESCE(SUM(amount_in_minor_units),0) INTO v_paid FROM public.supplier_payments
      WHERE purchase_order_id=p_purchase_order_id AND NOT is_reversed;
    SELECT COALESCE(SUM(supplier_invoice_payable_total_snapshot_in_minor_units::NUMERIC),0) INTO v_receipts
      FROM public.purchase_receipts WHERE purchase_order_id=p_purchase_order_id AND status='completed' AND phase2_finalized_at IS NOT NULL;
    SELECT COALESCE((SELECT payable::NUMERIC FROM public.phase133_legacy_po_payables_internal()
      WHERE purchase_order_id=p_purchase_order_id),0) INTO v_legacy;
    v_cap:=GREATEST(v_po.total_in_minor_units::NUMERIC,v_receipts+v_legacy);
    IF v_paid+p_amount>v_cap THEN
      RAISE EXCEPTION USING MESSAGE='SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE: مبلغ الشيك أكبر من المتبقي لأمر الشراء.',
        DETAIL=jsonb_build_object('payable',v_cap,'paid',v_paid,'maxAllowed',GREATEST(v_cap-v_paid,0))::TEXT;
    END IF;
    -- Preserve the selected PO, including its existing133 cap. Finalized receipt
    -- dates are proven; the planned/unreceived residual has NO invented date.
    WITH principals AS (
      SELECT r.id,r.received_at debt_at,r.supplier_invoice_payable_total_snapshot_in_minor_units::NUMERIC principal
      FROM public.purchase_receipts r WHERE r.purchase_order_id=p_purchase_order_id
        AND r.status='completed' AND r.phase2_finalized_at IS NOT NULL
        AND r.supplier_invoice_payable_total_snapshot_in_minor_units>0
      UNION ALL SELECT v_po.id,CASE WHEN v_cap-v_receipts=v_legacy THEN v_po.received_at END,v_cap-v_receipts
        WHERE v_cap>v_receipts
    ), remaining AS (
      SELECT *,GREATEST(principal-GREATEST(v_paid-COALESCE(SUM(principal) OVER(
        ORDER BY debt_at NULLS FIRST,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0),0) outstanding
      FROM principals
    ), planned AS (
      SELECT *,GREATEST(LEAST(outstanding,p_amount-COALESCE(SUM(outstanding) OVER(
        ORDER BY debt_at NULLS FIRST,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)),0)::BIGINT allocation
      FROM remaining
    ) SELECT jsonb_build_object('balanceInMinorUnits',v_balance,'allocatedInMinorUnits',COALESCE(SUM(allocation),0),
      'parts',COALESCE(jsonb_agg(jsonb_build_object('kind','supplier_balance','id',id,'originalDebtAt',debt_at,
        'allocateInMinorUnits',allocation) ORDER BY debt_at NULLS FIRST,id) FILTER(WHERE allocation>0),'[]'::JSONB)) INTO v_result FROM planned;
    IF (v_result->>'allocatedInMinorUnits')::BIGINT<>p_amount THEN RAISE EXCEPTION 'CHEQUE_SUPPLIER_ALLOCATION_MISMATCH';END IF;
    RETURN v_result;
  END IF;
  IF p_claim_id IS NOT NULL THEN
    SELECT * INTO v_claim FROM public.cheque_supplier_claim_positions_internal(p_supplier_id) WHERE id=p_claim_id;
    IF NOT FOUND OR p_amount>v_claim.outstanding THEN RAISE EXCEPTION 'CHEQUE_CLAIM_PAYMENT_EXCEEDS_DUE: قيد المورد غير مطابق أو المبلغ أكبر من المتبقي.';END IF;
    RETURN jsonb_build_object('balanceInMinorUnits',v_balance,'allocatedInMinorUnits',p_amount,'parts',
      jsonb_build_array(jsonb_build_object('kind','compensation','id',v_claim.id,'originalDebtAt',v_claim.occurred_at,'allocateInMinorUnits',p_amount)));
  END IF;
  WITH principals AS (
    SELECT 'supplier_balance'::TEXT kind,r.id,r.received_at debt_at,r.total_in_minor_units::BIGINT principal
    FROM public.supplier_receipts r WHERE r.supplier_id=p_supplier_id AND r.status='completed' AND r.total_in_minor_units>0
    UNION ALL
    SELECT 'supplier_balance',r.id,r.received_at,r.supplier_invoice_payable_total_snapshot_in_minor_units
    FROM public.purchase_receipts r JOIN public.purchase_orders po ON po.id=r.purchase_order_id
    WHERE po.supplier_id=p_supplier_id AND r.status='completed' AND r.phase2_finalized_at IS NOT NULL
      AND r.supplier_invoice_payable_total_snapshot_in_minor_units>0
    UNION ALL
    SELECT 'supplier_balance',l.purchase_order_id,po.received_at,l.payable
    FROM public.phase133_legacy_po_payables_internal()l JOIN public.purchase_orders po ON po.id=l.purchase_order_id
    WHERE l.supplier_id=p_supplier_id AND l.payable>0
    UNION ALL
    SELECT 'opening',b.id,b.original_balance_date::TIMESTAMP AT TIME ZONE 'Asia/Amman',b.amount_in_minor_units
    FROM public.supplier_opening_balances b WHERE b.supplier_id=p_supplier_id AND NOT b.is_reversed AND b.direction='payable'
    UNION ALL
    SELECT 'compensation',c.id,c.occurred_at,c.outstanding
    FROM public.cheque_supplier_claim_positions_internal(p_supplier_id)c WHERE c.outstanding>0
  ), ordered AS (
    SELECT p.*,SUM(principal) OVER()-v_available coverage,
      COALESCE(SUM(principal) OVER(ORDER BY debt_at NULLS FIRST,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior
    FROM principals p WHERE NOT p_opening_only OR p.kind='opening'
  ), remaining AS (
    SELECT *,GREATEST(principal-GREATEST(coverage-prior,0),0)::BIGINT outstanding FROM ordered
  ), planned AS (
    SELECT *,GREATEST(LEAST(outstanding,p_amount-COALESCE(SUM(outstanding) OVER(
      ORDER BY debt_at NULLS FIRST,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)),0)::BIGINT allocation
    FROM remaining
  )
  SELECT jsonb_build_object('balanceInMinorUnits',v_balance,'allocatedInMinorUnits',COALESCE(SUM(allocation),0),
    'parts',COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'originalDebtAt',debt_at,
      'allocateInMinorUnits',allocation) ORDER BY debt_at NULLS FIRST,id) FILTER(WHERE allocation>0),'[]'::JSONB))
  INTO v_result FROM planned;
  IF (v_result->>'allocatedInMinorUnits')::BIGINT<>p_amount THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_ALLOCATION_MISMATCH: لا تخصيص بلا أصل مثبت.';
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.cheque_supplier_plan_internal(UUID,BIGINT,UUID,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_supplier_plan_internal(UUID,BIGINT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.receive_customer_cheque_v1(p_customer_id UUID,p_branch_id UUID,p_bank_name TEXT,p_cheque_number TEXT,
  p_due_date DATE,p_amount_in_minor_units BIGINT,p_notes TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id UUID:=gen_random_uuid();v_request JSONB;v_replay JSONB;v_plan JSONB;v_result JSONB;v_part JSONB;v_payment_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','cashier','sales'],'استلام شيك عميل');
  v_request:=jsonb_build_object('action','receive','customer',p_customer_id,'branch',p_branch_id,'bank',btrim(p_bank_name),
    'number',btrim(p_cheque_number),'due',p_due_date,'amount',p_amount_in_minor_units,'notes',NULLIF(btrim(p_notes),''));
  v_replay:=public.cheque_replay_internal(p_idempotency_key,v_request);IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN RAISE EXCEPTION 'اختر فرعاً نشطاً.';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND NOT is_deleted) THEN RAISE EXCEPTION 'العميل غير موجود.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||p_customer_id::TEXT,0));
  INSERT INTO public.deferred_cheques(id,tracking_number,direction,cheque_number,bank_name,due_date,amount_in_minor_units,
    customer_id,branch_id,notes,created_by,changed_by)
  VALUES(v_id,'CHQ-'||lpad(nextval('public.deferred_cheque_number_seq')::TEXT,8,'0'),'incoming',btrim(p_cheque_number),
    btrim(p_bank_name),p_due_date,p_amount_in_minor_units,p_customer_id,p_branch_id,NULLIF(btrim(p_notes),''),auth.uid(),auth.uid());
  INSERT INTO public.cheque_party_keys(party_kind,party_id,bank_key,cheque_number,cheque_id)
  VALUES('customer',p_customer_id,lower(btrim(p_bank_name)),btrim(p_cheque_number),v_id);
  v_plan:=public.go_live_plan_customer_collection_internal(p_customer_id,p_amount_in_minor_units);
  v_result:=public.collect_customer_balance_v1(p_customer_id,p_amount_in_minor_units,'cheque',p_branch_id,btrim(p_cheque_number),
    left(COALESCE(NULLIF(btrim(p_notes),'')||' — ','')||'استلام شيك مؤجل',300),'cheque-collect-'||v_id::TEXT);
  UPDATE public.deferred_cheques SET collection_operation_id=(v_result->>'operationId')::UUID WHERE id=v_id;
  FOR v_part IN SELECT value FROM jsonb_array_elements(v_plan->'parts') WHERE(value->>'allocateInMinorUnits')::BIGINT>0 LOOP
    v_payment_id:=NULL;
    IF v_part->>'kind'='order' THEN
      SELECT customer_payment_id INTO STRICT v_payment_id FROM public.customer_collection_order_payments
      WHERE operation_id=(v_result->>'operationId')::UUID AND order_id=(v_part->>'id')::UUID;
    END IF;
    INSERT INTO public.deferred_cheque_allocations(cheque_id,party_kind,party_id,origin_kind,origin_id,original_debt_at,amount_in_minor_units,customer_payment_id)
    VALUES(v_id,'customer',p_customer_id,v_part->>'kind',(v_part->>'id')::UUID,(v_part->>'originalDebtAt')::TIMESTAMPTZ,
      (v_part->>'allocateInMinorUnits')::BIGINT,v_payment_id);
  END LOOP;
  RETURN public.cheque_finish_event_internal(v_id,'received',NULL,NULL,p_idempotency_key,v_request);
END;
$$;
ALTER FUNCTION public.receive_customer_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.receive_customer_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_customer_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT) TO authenticated;

-- Explicit133 writer, same locks/caps/idempotency/balance mutation. Both cheque
-- spellings now require a private immutable party registration in THIS tx by
-- THIS actor. A user-set GUC or guessing the deterministic key cannot grant it.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_order_id UUID DEFAULT NULL,
  p_amount_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.supplier_payments%ROWTYPE;
  v_result JSONB;
  v_po public.purchase_orders%ROWTYPE;
  v_active_paid NUMERIC;
  v_actual_payable NUMERIC;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF p_payment_method IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'SUPPLIER_PAYMENT_METHOD_REQUIRED: طريقة دفع المورد مطلوبة.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار دفعة المورد غير صالح.';
  END IF;

  IF p_payment_method IN ('check','cheque') THEN
    PERFORM public.assert_erp_role(ARRAY['owner','manager'],'إصدار شيك مورد');
    IF NOT EXISTS(
      SELECT 1 FROM public.cheque_party_keys k
      JOIN public.deferred_cheques c ON c.id=k.cheque_id
      WHERE k.party_kind='supplier' AND k.party_id=p_supplier_id
        AND k.registered_by=v_user_id AND k.registration_txid=txid_current()
        AND c.status='pending' AND c.supplier_payment_id IS NULL
        AND c.amount_in_minor_units=p_amount_in_minor_units
        AND k.bank_key=c.bank_key AND k.cheque_number=c.cheque_number
        AND p_reference_number=c.cheque_number
        AND v_key='cheque-supplier-'||c.id::TEXT
        AND ((c.direction='outgoing' AND c.supplier_id=p_supplier_id)
          OR(c.direction='incoming' AND c.endorsed_supplier_id IS NULL))
    ) THEN
      RAISE EXCEPTION 'CHEQUE_REGISTRATION_REQUIRED: الشيك يحتاج البنك والرقم والاستحقاق عبر دورة الشيكات؛ لا تسجيل مباشر.';
    END IF;
  END IF;

  -- Serialize equal retries before the underlying implementation mutates the
  -- purchase order, supplier balance, cash shift, and audit history.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::TEXT || ':purchase_order_payment:' || v_key,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.supplier_payments
  WHERE created_by = v_user_id
    AND idempotency_scope = 'purchase_order_payment'
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.supplier_id IS DISTINCT FROM p_supplier_id
      OR v_existing.purchase_order_id IS DISTINCT FROM p_purchase_order_id
      OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR NULLIF(BTRIM(v_existing.reference_number),'') IS DISTINCT FROM NULLIF(BTRIM(p_reference_number),'')
    THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_IDEMPOTENCY_CONFLICT: استُخدم مفتاح الدفعة لطلب مختلف.'; END IF;
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'supplier_id', v_existing.supplier_id,
      'purchase_order_id', v_existing.purchase_order_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'message', 'تمت معالجة طلب الدفعة سابقًا.'
    );
  END IF;

  PERFORM public.phase2_lock_payment_shift_internal(
    (SELECT branch_id FROM public.purchase_orders WHERE id = p_purchase_order_id),
    p_payment_method, p_amount_in_minor_units
  );
  IF p_purchase_order_id IS NOT NULL THEN
    SELECT * INTO v_po FROM public.purchase_orders WHERE id=p_purchase_order_id FOR UPDATE;
    IF NOT FOUND OR v_po.supplier_id IS DISTINCT FROM p_supplier_id THEN
      RAISE EXCEPTION 'أمر الشراء لا يتبع المورد المحدد.';
    END IF;
    SELECT COALESCE(SUM(amount_in_minor_units),0) INTO v_active_paid
    FROM public.supplier_payments WHERE purchase_order_id=p_purchase_order_id AND NOT is_reversed;
    v_actual_payable := GREATEST(v_po.total_in_minor_units::NUMERIC,
      COALESCE((SELECT SUM(r.supplier_invoice_payable_total_snapshot_in_minor_units::NUMERIC)
        FROM public.purchase_receipts r WHERE r.purchase_order_id=p_purchase_order_id
          AND r.status='completed' AND r.phase2_finalized_at IS NOT NULL),0)
      +COALESCE((SELECT payable::NUMERIC FROM public.phase133_legacy_po_payables_internal()
        WHERE purchase_order_id=p_purchase_order_id),0));
    IF v_active_paid+p_amount_in_minor_units > v_actual_payable THEN
      RAISE EXCEPTION USING MESSAGE=format(
        'SUPPLIER_PO_PAYMENT_EXCEEDS_PAYABLE: المستحق الفعلي %s، المدفوع %s، الحد الأقصى المسموح الآن %s دينار.',
        v_actual_payable/1000.0,v_active_paid/1000.0,GREATEST(v_actual_payable-v_active_paid,0)/1000.0),
        DETAIL=jsonb_build_object('payable',v_actual_payable,'paid',v_active_paid,
          'maxAllowed',GREATEST(v_actual_payable-v_active_paid,0))::TEXT;
    END IF;
  END IF;
  v_result := public._record_supplier_payment_impl(
    p_supplier_id,
    p_purchase_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_payment_date,
    p_notes
  );

  -- One new committed payment reduces supplier debt even when it precedes
  -- receiving. The idempotent branch above never reaches this UPDATE.
  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units - p_amount_in_minor_units,
    updated_at = NOW()
  WHERE id = p_supplier_id;

  UPDATE public.supplier_payments
  SET
    idempotency_scope = 'purchase_order_payment',
    idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_scope IS NULL
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار دفعة المورد.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

-- The existing supplier writer is the only financial payment for issue or
-- endorsement. Allocation links merely attribute that SAME payment to claims.
-- Table boundary also closes163's direct opening-cheque writer and ANY other
-- legacy INSERT;non-cheque methods are returned untouched. No client context.
CREATE FUNCTION public.cheque_guard_supplier_payment_registration_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.payment_method IN ('check','cheque') THEN
    PERFORM public.assert_erp_role(ARRAY['owner','manager'],'إصدار شيك مورد');
    IF NEW.created_by IS DISTINCT FROM auth.uid() OR NOT EXISTS(
      SELECT 1 FROM public.cheque_party_keys k JOIN public.deferred_cheques c ON c.id=k.cheque_id
      WHERE k.party_kind='supplier' AND k.party_id=NEW.supplier_id
        AND k.registered_by=auth.uid() AND k.registration_txid=txid_current()
        AND c.status='pending' AND c.supplier_payment_id IS NULL
        AND c.amount_in_minor_units=NEW.amount_in_minor_units AND c.cheque_number=NEW.reference_number
        AND k.bank_key=c.bank_key AND k.cheque_number=c.cheque_number
        AND ((c.direction='outgoing' AND c.supplier_id=NEW.supplier_id)
          OR(c.direction='incoming' AND c.endorsed_supplier_id IS NULL))
    ) THEN RAISE EXCEPTION 'CHEQUE_REGISTRATION_REQUIRED: الشيك يحتاج البنك والرقم والاستحقاق عبر دورة الشيكات؛ لا تسجيل مباشر.';END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.cheque_guard_supplier_payment_registration_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_guard_supplier_payment_registration_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_cheque_supplier_payment_registration BEFORE INSERT ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_supplier_payment_registration_internal();

CREATE FUNCTION public.cheque_pay_supplier_internal(p_cheque_id UUID,p_supplier_id UUID,p_plan JSONB,p_purchase_order_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_payment JSONB;v_id UUID;v_part JSONB;
BEGIN
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_cheque_id;
  v_payment:=public.record_supplier_payment(p_supplier_id,p_purchase_order_id,v_c.amount_in_minor_units,'cheque',v_c.cheque_number,
    CURRENT_TIMESTAMP,'شيك مؤجل '||v_c.tracking_number,'cheque-supplier-'||v_c.id::TEXT);
  v_id:=(v_payment->>'payment_id')::UUID;
  IF v_id IS NULL THEN RAISE EXCEPTION 'CHEQUE_SUPPLIER_PAYMENT_MISSING';END IF;
  FOR v_part IN SELECT value FROM jsonb_array_elements(p_plan->'parts') LOOP
    INSERT INTO public.deferred_cheque_allocations(cheque_id,party_kind,party_id,origin_kind,origin_id,original_debt_at,amount_in_minor_units)
    VALUES(v_c.id,'supplier',p_supplier_id,v_part->>'kind',(v_part->>'id')::UUID,(v_part->>'originalDebtAt')::TIMESTAMPTZ,
      (v_part->>'allocateInMinorUnits')::BIGINT);
    IF v_part->>'kind'='compensation' THEN
      INSERT INTO public.supplier_cheque_claim_payments(supplier_payment_id,claim_id,payment_method,amount_in_minor_units,idempotency_key)
      VALUES(v_id,(v_part->>'id')::UUID,'cheque',(v_part->>'allocateInMinorUnits')::BIGINT,
        'cheque-claim-'||v_c.id::TEXT||':'||(v_part->>'id'));
    END IF;
  END LOOP;
  RETURN v_id;
END;
$$;
ALTER FUNCTION public.cheque_pay_supplier_internal(UUID,UUID,JSONB,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_pay_supplier_internal(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.issue_supplier_cheque_v1(p_supplier_id UUID,p_branch_id UUID,p_bank_name TEXT,p_cheque_number TEXT,
  p_due_date DATE,p_amount_in_minor_units BIGINT,p_notes TEXT,p_idempotency_key TEXT,p_claim_id UUID DEFAULT NULL,p_purchase_order_id UUID DEFAULT NULL,p_opening_only BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id UUID:=gen_random_uuid();v_request JSONB;v_replay JSONB;v_plan JSONB;v_payment UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'إصدار شيك مورد');
  v_request:=jsonb_build_object('action','issue','supplier',p_supplier_id,'branch',p_branch_id,'bank',btrim(p_bank_name),
    'number',btrim(p_cheque_number),'due',p_due_date,'amount',p_amount_in_minor_units,'notes',NULLIF(btrim(p_notes),''),'claim',p_claim_id,'purchaseOrder',p_purchase_order_id,'openingOnly',p_opening_only);
  v_replay:=public.cheque_replay_internal(p_idempotency_key,v_request);IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN RAISE EXCEPTION 'اختر فرعاً نشطاً.';END IF;
  -- Same PO-before-supplier row lock order as the existing133 writer.
  IF p_purchase_order_id IS NOT NULL THEN
    PERFORM 1 FROM public.purchase_orders WHERE id=p_purchase_order_id AND supplier_id=p_supplier_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'أمر الشراء لا يتبع المورد المحدد.';END IF;
  END IF;
  PERFORM 1 FROM public.suppliers WHERE id=p_supplier_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود أو غير نشط.';END IF;
  v_plan:=public.cheque_supplier_plan_internal(p_supplier_id,p_amount_in_minor_units,p_claim_id,p_purchase_order_id,p_opening_only);
  INSERT INTO public.deferred_cheques(id,tracking_number,direction,cheque_number,bank_name,due_date,amount_in_minor_units,
    supplier_id,branch_id,notes,created_by,changed_by)
  VALUES(v_id,'CHQ-'||lpad(nextval('public.deferred_cheque_number_seq')::TEXT,8,'0'),'outgoing',btrim(p_cheque_number),
    btrim(p_bank_name),p_due_date,p_amount_in_minor_units,p_supplier_id,p_branch_id,NULLIF(btrim(p_notes),''),auth.uid(),auth.uid());
  INSERT INTO public.cheque_party_keys(party_kind,party_id,bank_key,cheque_number,cheque_id)
  VALUES('supplier',p_supplier_id,lower(btrim(p_bank_name)),btrim(p_cheque_number),v_id);
  v_payment:=public.cheque_pay_supplier_internal(v_id,p_supplier_id,v_plan,p_purchase_order_id);
  UPDATE public.deferred_cheques SET supplier_payment_id=v_payment WHERE id=v_id;
  RETURN public.cheque_finish_event_internal(v_id,'issued',NULL,NULL,p_idempotency_key,v_request);
END;
$$;
ALTER FUNCTION public.issue_supplier_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT,UUID,UUID,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_supplier_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT,UUID,UUID,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_supplier_cheque_v1(UUID,UUID,TEXT,TEXT,DATE,BIGINT,TEXT,TEXT,UUID,UUID,BOOLEAN) TO authenticated;

CREATE FUNCTION public.endorse_customer_cheque_v1(p_cheque_id UUID,p_supplier_id UUID,p_expected_version INTEGER,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_plan JSONB;v_request JSONB;v_replay JSONB;v_payment UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'تجيير شيك لمورد');
  v_request:=jsonb_build_object('action','endorse','cheque',p_cheque_id,'supplier',p_supplier_id,'version',p_expected_version);
  v_replay:=public.cheque_replay_internal(p_idempotency_key,v_request);IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  -- Supplier before cheque; no order/payment/shift locks are discovered later.
  PERFORM 1 FROM public.suppliers WHERE id=p_supplier_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود أو غير نشط.';END IF;
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_cheque_id FOR UPDATE;
  IF v_c.version IS DISTINCT FROM p_expected_version OR v_c.direction<>'incoming' OR v_c.status<>'pending' THEN
    RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION: التجيير لوارد قيد الانتظار فقط؛ حدّث التفاصيل.';
  END IF;
  v_plan:=public.cheque_supplier_plan_internal(p_supplier_id,v_c.amount_in_minor_units);
  INSERT INTO public.cheque_party_keys(party_kind,party_id,bank_key,cheque_number,cheque_id)
  VALUES('supplier',p_supplier_id,v_c.bank_key,v_c.cheque_number,v_c.id);
  v_payment:=public.cheque_pay_supplier_internal(v_c.id,p_supplier_id,v_plan);
  UPDATE public.deferred_cheques SET status='endorsed',endorsed_supplier_id=p_supplier_id,supplier_payment_id=v_payment,
    version=version+1,changed_by=auth.uid(),changed_at=CURRENT_TIMESTAMP WHERE id=v_c.id;
  RETURN public.cheque_finish_event_internal(v_c.id,'endorsed',v_c.status,NULL,p_idempotency_key,v_request);
END;
$$;
ALTER FUNCTION public.endorse_customer_cheque_v1(UUID,UUID,INTEGER,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.endorse_customer_cheque_v1(UUID,UUID,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.endorse_customer_cheque_v1(UUID,UUID,INTEGER,TEXT) TO authenticated;

CREATE FUNCTION public.clear_deferred_cheque_v1(p_cheque_id UUID,p_expected_version INTEGER,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_request JSONB;v_replay JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','manager'],'تأكيد صرف شيك');
  v_request:=jsonb_build_object('action','clear','cheque',p_cheque_id,'version',p_expected_version);
  v_replay:=public.cheque_replay_internal(p_idempotency_key,v_request);IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_cheque_id FOR UPDATE;
  IF v_c.version IS DISTINCT FROM p_expected_version OR v_c.status NOT IN ('pending','endorsed') THEN
    RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION: لا صرف لشيك نهائي؛ حدّث التفاصيل.';
  END IF;
  UPDATE public.deferred_cheques SET status='cleared',version=version+1,changed_by=auth.uid(),changed_at=CURRENT_TIMESTAMP WHERE id=v_c.id;
  RETURN public.cheque_finish_event_internal(v_c.id,'cleared',v_c.status,NULL,p_idempotency_key,v_request);
END;
$$;
ALTER FUNCTION public.clear_deferred_cheque_v1(UUID,INTEGER,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clear_deferred_cheque_v1(UUID,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clear_deferred_cheque_v1(UUID,INTEGER,TEXT) TO authenticated;

CREATE FUNCTION public.cheque_compensate_internal(p_cheque_id UUID,p_expected_version INTEGER,p_kind TEXT,p_reason TEXT,p_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_before public.deferred_cheques%ROWTYPE;
  v_request JSONB;v_replay JSONB;v_supplier UUID;v_reason TEXT:=NULLIF(btrim(p_reason),'');v_sum BIGINT;
BEGIN
  IF p_kind='cancelled' THEN PERFORM public.assert_erp_role(ARRAY['owner'],'إلغاء تسجيل شيك خاطئ');
  ELSIF p_kind='returned' THEN PERFORM public.assert_erp_role(ARRAY['owner','manager'],'تسجيل شيك راجع');
  ELSE RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION';END IF;
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'سبب واضح من5 إلى500 حرف مطلوب.';END IF;
  v_request:=jsonb_build_object('action',p_kind,'cheque',p_cheque_id,'version',p_expected_version,'reason',v_reason);
  v_replay:=public.cheque_replay_internal(p_key,v_request);IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  SELECT * INTO STRICT v_before FROM public.deferred_cheques WHERE id=p_cheque_id;
  IF v_before.customer_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||v_before.customer_id::TEXT,0));
  END IF;
  v_supplier:=COALESCE(v_before.endorsed_supplier_id,v_before.supplier_id);
  IF v_supplier IS NOT NULL THEN PERFORM 1 FROM public.suppliers WHERE id=v_supplier FOR UPDATE;END IF;
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_cheque_id FOR UPDATE;
  IF v_c.version IS DISTINCT FROM p_expected_version OR v_c.version<>v_before.version
    OR(p_kind='cancelled' AND v_c.status<>'pending') OR(p_kind='returned' AND v_c.status NOT IN ('pending','endorsed')) THEN
    RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION: تغير الشيك أو انتهت حالته؛ حدّث التفاصيل.';
  END IF;
  IF v_supplier IS NOT NULL AND (SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_supplier)
    IS DISTINCT FROM(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_supplier) THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH';
  END IF;
  INSERT INTO public.cheque_compensation_claims(cheque_id,source_allocation_id,party_kind,party_id,claim_kind,reference,
    amount_in_minor_units,original_debt_at,origin_kind,reason,created_by)
  SELECT v_c.id,a.id,a.party_kind,a.party_id,p_kind,
    CASE WHEN p_kind='cancelled' THEN 'إلغاء تسجيل شيك رقم ' ELSE 'شيك راجع رقم ' END||v_c.cheque_number,
    a.amount_in_minor_units,a.original_debt_at,a.origin_kind,v_reason,auth.uid()
  FROM public.deferred_cheque_allocations a WHERE a.cheque_id=v_c.id;
  IF v_c.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_in_minor_units),0) INTO v_sum FROM public.cheque_compensation_claims WHERE cheque_id=v_c.id AND party_kind='customer';
    IF v_sum<>v_c.amount_in_minor_units THEN RAISE EXCEPTION 'CHEQUE_COMPENSATION_EVIDENCE_MISMATCH: تخصيص العميل ناقص.';END IF;
  END IF;
  IF v_supplier IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_in_minor_units),0) INTO v_sum FROM public.cheque_compensation_claims WHERE cheque_id=v_c.id AND party_kind='supplier';
    IF v_sum<>v_c.amount_in_minor_units THEN RAISE EXCEPTION 'CHEQUE_COMPENSATION_EVIDENCE_MISMATCH: تخصيص المورد ناقص.';END IF;
    UPDATE public.suppliers SET current_balance_in_minor_units=current_balance_in_minor_units+v_sum,updated_at=CURRENT_TIMESTAMP WHERE id=v_supplier;
  END IF;
  UPDATE public.deferred_cheques SET status=p_kind,version=version+1,changed_by=auth.uid(),changed_at=CURRENT_TIMESTAMP WHERE id=v_c.id;
  -- No original voucher/order/Return/allocation writes and no drawer mutation.
  -- Return alerts are emitted separately from the committed 'returned' event;
  -- cancelled is NOT a returned-cheque flag or a returned-cheque notification.
  RETURN public.cheque_finish_event_internal(v_c.id,p_kind,v_c.status,v_reason,p_key,v_request);
END;
$$;
ALTER FUNCTION public.cheque_compensate_internal(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_compensate_internal(UUID,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.return_deferred_cheque_v1(p_cheque_id UUID,p_expected_version INTEGER,p_reason TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RETURN public.cheque_compensate_internal(p_cheque_id,p_expected_version,'returned',p_reason,p_idempotency_key);END;
$$;
ALTER FUNCTION public.return_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.return_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.return_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.cancel_deferred_cheque_v1(p_cheque_id UUID,p_expected_version INTEGER,p_reason TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RETURN public.cheque_compensate_internal(p_cheque_id,p_expected_version,'cancelled',p_reason,p_idempotency_key);END;
$$;
ALTER FUNCTION public.cancel_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_deferred_cheque_v1(UUID,INTEGER,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.pay_supplier_cheque_claim_v1(p_claim_id UUID,p_branch_id UUID,p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,p_reference_number TEXT,p_notes TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_claim public.cheque_compensation_claims%ROWTYPE;v_payment public.supplier_payments%ROWTYPE;
  v_link public.supplier_cheque_claim_payments%ROWTYPE;v_shift UUID;v_outstanding BIGINT;v_key TEXT:=NULLIF(btrim(p_idempotency_key),'');
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant'],'سداد قيد شيك مورد');
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 16 AND 120 THEN RAISE EXCEPTION 'مفتاح الدفعة غير صالح.';END IF;
  -- A cheque must be registered with its bank/number/due date via issue RPC,
  -- never an untracked payment labelled cheque from this cash/transfer form.
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','cliq','bank_transfer') THEN
    RAISE EXCEPTION 'CHEQUE_REGISTRATION_REQUIRED: إصدار شيك يحتاج بياناته الكاملة.';
  END IF;
  IF COALESCE(p_amount_in_minor_units,0)<=0 OR p_amount_in_minor_units>999999999999 THEN RAISE EXCEPTION 'مبلغ غير صالح.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier-cheque-claim-payment:'||v_key,0));
  SELECT * INTO v_link FROM public.supplier_cheque_claim_payments WHERE idempotency_key=v_key;
  IF FOUND THEN
    SELECT * INTO STRICT v_payment FROM public.supplier_payments WHERE id=v_link.supplier_payment_id;
    IF v_link.claim_id IS DISTINCT FROM p_claim_id OR v_payment.created_by IS DISTINCT FROM auth.uid()
      OR v_payment.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units OR v_payment.payment_method IS DISTINCT FROM p_payment_method
      OR v_link.branch_id IS DISTINCT FROM(CASE WHEN p_payment_method IN ('cash','cliq') THEN p_branch_id END)
      OR v_payment.reference_number IS DISTINCT FROM NULLIF(btrim(p_reference_number),'')
      OR v_payment.notes IS DISTINCT FROM NULLIF(btrim(p_notes),'') THEN
      RAISE EXCEPTION 'CHEQUE_IDEMPOTENCY_CONFLICT: مفتاح سداد القيد مستخدم لطلب مختلف.';
    END IF;
    RETURN jsonb_build_object('success',true,'idempotentReplay',true,'paymentId',v_payment.id,'cashShiftId',v_payment.cash_shift_id);
  END IF;
  SELECT * INTO STRICT v_claim FROM public.cheque_compensation_claims WHERE id=p_claim_id AND party_kind='supplier';
  IF p_payment_method IN ('cash','cliq') THEN
    IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN RAISE EXCEPTION 'PHASE2_PAYMENT_BRANCH_REQUIRED';END IF;
    SELECT id INTO v_shift FROM public.cash_shifts WHERE branch_id=p_branch_id AND status='open' FOR SHARE;
    IF v_shift IS NULL THEN RAISE EXCEPTION 'PHASE2_OPEN_SHIFT_REQUIRED';END IF;
  END IF;
  PERFORM 1 FROM public.suppliers WHERE id=v_claim.party_id FOR UPDATE;
  PERFORM 1 FROM public.cheque_compensation_claims WHERE id=p_claim_id FOR UPDATE;
  SELECT outstanding INTO STRICT v_outstanding FROM public.cheque_supplier_claim_positions_internal(v_claim.party_id) WHERE id=p_claim_id;
  IF p_amount_in_minor_units>v_outstanding OR p_amount_in_minor_units>(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_claim.party_id) THEN
    RAISE EXCEPTION 'CHEQUE_CLAIM_PAYMENT_EXCEEDS_DUE: المبلغ أكبر من المتبقي.';
  END IF;
  IF(SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_claim.party_id)
    IS DISTINCT FROM(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_claim.party_id) THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH';
  END IF;
  INSERT INTO public.supplier_payments(supplier_id,purchase_order_id,amount_in_minor_units,payment_method,
    reference_number,payment_date,notes,created_by,cash_shift_id)
  VALUES(v_claim.party_id,NULL,p_amount_in_minor_units,p_payment_method,NULLIF(btrim(p_reference_number),''),CURRENT_TIMESTAMP,
    NULLIF(btrim(p_notes),''),auth.uid(),v_shift) RETURNING * INTO v_payment;
  INSERT INTO public.supplier_cheque_claim_payments(supplier_payment_id,claim_id,branch_id,cash_shift_id,payment_method,amount_in_minor_units,idempotency_key)
  VALUES(v_payment.id,p_claim_id,CASE WHEN v_shift IS NOT NULL THEN p_branch_id END,v_shift,p_payment_method,p_amount_in_minor_units,v_key);
  UPDATE public.suppliers SET current_balance_in_minor_units=current_balance_in_minor_units-p_amount_in_minor_units,updated_at=CURRENT_TIMESTAMP WHERE id=v_claim.party_id;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(auth.uid(),'SUPPLIER_CHEQUE_CLAIM_PAYMENT','supplier_payments',v_payment.id,
    jsonb_build_object('claim_id',p_claim_id,'supplier_id',v_claim.party_id,'amount_in_minor_units',p_amount_in_minor_units,'cash_shift_id',v_shift));
  RETURN jsonb_build_object('success',true,'idempotentReplay',false,'paymentId',v_payment.id,'cashShiftId',v_shift);
END;
$$;
ALTER FUNCTION public.pay_supplier_cheque_claim_v1(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pay_supplier_cheque_claim_v1(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier_cheque_claim_v1(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.reverse_supplier_cheque_claim_payment_v1(p_supplier_payment_id UUID,p_reason TEXT,p_idempotency_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor UUID;v_payment public.supplier_payments%ROWTYPE;v_initial public.supplier_payments%ROWTYPE;
  v_existing public.supplier_cheque_claim_reversals%ROWTYPE;v_shift public.cash_shifts%ROWTYPE;
  v_reason TEXT:=NULLIF(btrim(p_reason),'');v_key TEXT:=NULLIF(btrim(p_idempotency_key),'');v_id UUID;
BEGIN
  v_actor:=public.assert_reversal_owner('عكس سداد قيد شيك المورد');
  IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'سبب عكس سداد القيد مطلوب، من 5 إلى 500 حرف.';
  END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 16 AND 160 THEN RAISE EXCEPTION 'مفتاح العكس غير صالح.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier-cheque-claim-reversal-key:'||v_actor::TEXT||':'||v_key,0));
  SELECT * INTO v_existing FROM public.supplier_cheque_claim_reversals WHERE requested_by=v_actor AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.supplier_payment_id IS DISTINCT FROM p_supplier_payment_id OR v_existing.reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'CHEQUE_IDEMPOTENCY_CONFLICT: مفتاح عكس القيد مستخدم لطلب مختلف.';
    END IF;
    RETURN jsonb_build_object('success',true,'idempotentReplay',true,'reversalId',v_existing.id,'paymentId',v_existing.supplier_payment_id);
  END IF;
  SELECT * INTO v_initial FROM public.supplier_payments WHERE id=p_supplier_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'دفعة سداد القيد غير موجودة.';END IF;
  -- Match the existing shift-first full-reversal/voucher lock domain.
  IF v_initial.cash_shift_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cash-shift-full-reversal:'||v_initial.cash_shift_id::TEXT,0));
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier-payment-reversal:'||p_supplier_payment_id::TEXT,0));
  IF v_initial.cash_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift FROM public.cash_shifts WHERE id=v_initial.cash_shift_id FOR UPDATE;
    IF NOT FOUND OR v_shift.status<>'open' THEN RAISE EXCEPTION 'لا يمكن عكس سداد قيد من وردية غير مفتوحة.';END IF;
  END IF;
  SELECT * INTO v_payment FROM public.supplier_payments WHERE id=p_supplier_payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.cash_shift_id IS DISTINCT FROM v_initial.cash_shift_id
    OR v_payment.supplier_id IS DISTINCT FROM v_initial.supplier_id OR v_payment.is_reversed
    OR v_payment.supplier_receipt_id IS NOT NULL OR v_payment.purchase_order_id IS NOT NULL
    OR v_payment.payment_method NOT IN ('cash','cliq','bank_transfer')
    OR((v_payment.payment_method IN ('cash','cliq')) IS DISTINCT FROM(v_payment.cash_shift_id IS NOT NULL))
    OR EXISTS(SELECT 1 FROM public.deferred_cheques WHERE supplier_payment_id=p_supplier_payment_id)
    OR NOT EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments WHERE supplier_payment_id=p_supplier_payment_id)
    OR COALESCE((SELECT SUM(l.amount_in_minor_units) FROM public.supplier_cheque_claim_payments l
      JOIN public.cheque_compensation_claims c ON c.id=l.claim_id
      WHERE l.supplier_payment_id=p_supplier_payment_id AND c.party_kind='supplier' AND c.party_id=v_payment.supplier_id
        AND l.payment_method=v_payment.payment_method AND l.cash_shift_id IS NOT DISTINCT FROM v_payment.cash_shift_id),0)
      <>v_payment.amount_in_minor_units THEN
    RAISE EXCEPTION 'CHEQUE_CLAIM_REVERSAL_NOT_ALLOWED: هذه ليست دفعة سداد قيد مستقلة قابلة للعكس؛ دفعة الشيك الأصلية محمية.';
  END IF;
  PERFORM 1 FROM public.suppliers WHERE id=v_payment.supplier_id FOR UPDATE;
  IF(SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_payment.supplier_id)
    IS DISTINCT FROM(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_payment.supplier_id) THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH';
  END IF;
  INSERT INTO public.supplier_cheque_claim_reversals(supplier_payment_id,requested_by,reason,idempotency_key,amount_in_minor_units,cash_shift_id,payment_method)
  VALUES(v_payment.id,v_actor,v_reason,v_key,v_payment.amount_in_minor_units,v_payment.cash_shift_id,v_payment.payment_method) RETURNING id INTO v_id;
  UPDATE public.supplier_payments SET is_reversed=true,reversed_at=CURRENT_TIMESTAMP,reversed_by=v_actor,reversal_reason=v_reason WHERE id=v_payment.id;
  UPDATE public.suppliers SET current_balance_in_minor_units=current_balance_in_minor_units+v_payment.amount_in_minor_units,
    updated_at=CURRENT_TIMESTAMP WHERE id=v_payment.supplier_id;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(v_actor,'REVERSE_SUPPLIER_CHEQUE_CLAIM_PAYMENT','supplier_cheque_claim_reversals',v_id,
    jsonb_build_object('payment_id',v_payment.id,'supplier_id',v_payment.supplier_id,'amount_in_minor_units',v_payment.amount_in_minor_units,
      'cash_shift_id',v_payment.cash_shift_id,'payment_method',v_payment.payment_method,'reason',v_reason));
  RETURN jsonb_build_object('success',true,'idempotentReplay',false,'reversalId',v_id,'paymentId',v_payment.id);
END;
$$;
ALTER FUNCTION public.reverse_supplier_cheque_claim_payment_v1(UUID,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_supplier_cheque_claim_payment_v1(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_cheque_claim_payment_v1(UUID,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.cheque_assert_integrity_internal(p_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_e public.deferred_cheque_events%ROWTYPE;v_supplier UUID;
BEGIN
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_id;
  SELECT * INTO v_e FROM public.deferred_cheque_events WHERE cheque_id=p_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR v_e.version<>v_c.version OR v_e.resulting_status<>v_c.status OR v_e.actor_id<>v_c.changed_by
    OR(SELECT COUNT(*) FROM public.deferred_cheque_events WHERE cheque_id=p_id)<>v_c.version THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: الحالة والأحداث غير متطابقة.';
  END IF;
  v_supplier:=COALESCE(v_c.endorsed_supplier_id,v_c.supplier_id);
  IF(v_c.customer_id IS NOT NULL AND COALESCE((SELECT SUM(amount_in_minor_units) FROM public.deferred_cheque_allocations
      WHERE cheque_id=p_id AND party_kind='customer' AND party_id=v_c.customer_id),0)<>v_c.amount_in_minor_units)
    OR(v_supplier IS NOT NULL AND COALESCE((SELECT SUM(amount_in_minor_units) FROM public.deferred_cheque_allocations
      WHERE cheque_id=p_id AND party_kind='supplier' AND party_id=v_supplier),0)<>v_c.amount_in_minor_units)
    OR EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a WHERE a.cheque_id=p_id AND
      ((a.party_kind='customer' AND a.party_id IS DISTINCT FROM v_c.customer_id)
       OR(a.party_kind='supplier' AND a.party_id IS DISTINCT FROM v_supplier))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: تخصيص الشيك لا يطابق المبلغ أو الطرف.';
  END IF;
  IF(v_c.origin='operational' AND v_c.direction='incoming' AND NOT EXISTS(
    SELECT 1 FROM public.customer_collection_operations o WHERE o.id=v_c.collection_operation_id
      AND o.customer_id=v_c.customer_id AND o.amount_in_minor_units=v_c.amount_in_minor_units AND o.payment_method='cheque'
      AND NOT o.is_reversed AND o.cash_shift_id IS NULL))
    OR(v_c.origin='opening' AND v_c.collection_operation_id IS NOT NULL)
    OR(v_c.origin='opening' AND v_c.supplier_payment_id IS NOT NULL)
    OR(v_c.origin='operational' AND v_supplier IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.supplier_payments p WHERE p.id=v_c.supplier_payment_id AND p.supplier_id=v_supplier
        AND p.amount_in_minor_units=v_c.amount_in_minor_units AND p.payment_method='cheque' AND NOT p.is_reversed
        AND p.cash_shift_id IS NULL
        AND p.purchase_order_id IS NOT DISTINCT FROM(SELECT (e.request_identity->>'purchaseOrder')::UUID
          FROM public.deferred_cheque_events e WHERE e.cheque_id=v_c.id AND e.kind='issued' AND e.version=1))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: سند الشيك غير مطابق.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a
    LEFT JOIN public.customer_collection_order_payments l ON l.operation_id=v_c.collection_operation_id
      AND l.order_id=a.origin_id AND l.customer_payment_id=a.customer_payment_id
    LEFT JOIN public.customer_payments p ON p.id=a.customer_payment_id
    WHERE a.cheque_id=p_id AND a.party_kind='customer' AND a.origin_kind='order'
      AND(l.customer_payment_id IS NULL OR l.amount_in_minor_units<>a.amount_in_minor_units OR p.is_reversed
        OR p.payment_method<>'cheque' OR p.customer_id<>a.party_id OR p.amount_in_minor_units<>a.amount_in_minor_units)) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: رابط دفعة الطلب غير مطابق.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a LEFT JOIN public.cheque_compensation_claims c ON c.source_allocation_id=a.id
    WHERE a.cheque_id=p_id AND(
      (v_c.status IN ('returned','cancelled') AND(c.id IS NULL OR c.cheque_id<>p_id OR c.party_kind<>a.party_kind
        OR c.party_id<>a.party_id OR c.claim_kind<>v_c.status OR c.amount_in_minor_units<>a.amount_in_minor_units
        OR c.original_debt_at IS DISTINCT FROM a.original_debt_at OR c.origin_kind<>a.origin_kind OR c.reason IS DISTINCT FROM v_e.reason))
      OR(v_c.status NOT IN ('returned','cancelled') AND c.id IS NOT NULL))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: القيود التعويضية لا تطابق الأصول.';
  END IF;
  IF v_supplier IS NOT NULL AND(SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_supplier)
    IS DISTINCT FROM(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_supplier) THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH';
  END IF;
END;
$$;
ALTER FUNCTION public.cheque_assert_integrity_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_assert_integrity_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_validate_evidence_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='deferred_cheques' THEN
    PERFORM public.cheque_assert_integrity_internal(NEW.id);
  ELSE
    PERFORM public.cheque_assert_integrity_internal(NEW.cheque_id);
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.cheque_validate_evidence_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_validate_evidence_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER trg_cheque_validate_record AFTER INSERT OR UPDATE ON public.deferred_cheques
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_evidence_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_validate_event AFTER INSERT ON public.deferred_cheque_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_evidence_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_validate_allocation AFTER INSERT ON public.deferred_cheque_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_evidence_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_validate_claim AFTER INSERT ON public.cheque_compensation_claims
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_evidence_internal();

CREATE FUNCTION public.cheque_validate_claim_payment_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_operation UUID;v_payment UUID;v_claim UUID;
BEGIN
  IF TG_TABLE_NAME='customer_collection_operations' THEN v_operation:=NEW.id;
  ELSIF TG_TABLE_NAME='customer_collection_cheque_allocations' THEN v_operation:=NEW.operation_id;
  ELSIF TG_TABLE_NAME='supplier_payments' THEN v_payment:=NEW.id;
  ELSE v_payment:=NEW.supplier_payment_id;END IF;
  IF v_operation IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.customer_collection_operations o WHERE o.id=v_operation AND
      o.compensation_amount_in_minor_units<>COALESCE((SELECT SUM(a.amount_in_minor_units)
        FROM public.customer_collection_cheque_allocations a WHERE a.operation_id=o.id),0))
      OR EXISTS(SELECT 1 FROM public.customer_collection_cheque_allocations a
        JOIN public.cheque_compensation_claims c ON c.id=a.claim_id JOIN public.customer_collection_operations o ON o.id=a.operation_id
        WHERE o.id=v_operation AND(c.party_kind<>'customer' OR c.party_id<>o.customer_id)) THEN
      RAISE EXCEPTION 'CHEQUE_CLAIM_PAYMENT_MISMATCH: أجزاء تحصيل القيد غير متطابقة.';
    END IF;
    FOR v_claim IN SELECT claim_id FROM public.customer_collection_cheque_allocations WHERE operation_id=v_operation LOOP
      IF EXISTS(SELECT 1 FROM public.cheque_customer_claim_positions_internal() WHERE id=v_claim AND outstanding<0) THEN
        RAISE EXCEPTION 'CHEQUE_CLAIM_OVERPAID: تحصيل أكبر من قيد الشيك.';
      END IF;
    END LOOP;
  END IF;
  IF v_payment IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
      JOIN public.cheque_compensation_claims c ON c.id=l.claim_id WHERE p.id=v_payment AND
      (c.party_kind<>'supplier' OR c.party_id<>p.supplier_id OR l.payment_method<>p.payment_method OR l.cash_shift_id IS DISTINCT FROM p.cash_shift_id
        OR p.purchase_order_id IS NOT NULL))
      OR COALESCE((SELECT SUM(amount_in_minor_units) FROM public.supplier_cheque_claim_payments WHERE supplier_payment_id=v_payment),0)
        >(SELECT amount_in_minor_units FROM public.supplier_payments WHERE id=v_payment) THEN
      RAISE EXCEPTION 'CHEQUE_CLAIM_PAYMENT_MISMATCH: سند سداد قيد المورد غير مطابق.';
    END IF;
    FOR v_claim IN SELECT claim_id FROM public.supplier_cheque_claim_payments WHERE supplier_payment_id=v_payment LOOP
      IF EXISTS(SELECT 1 FROM public.cheque_supplier_claim_positions_internal() WHERE id=v_claim AND outstanding<0) THEN
        RAISE EXCEPTION 'CHEQUE_CLAIM_OVERPAID: سداد أكبر من قيد الشيك.';
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments WHERE supplier_payment_id=v_payment) AND EXISTS(
      SELECT 1 FROM public.supplier_payments p LEFT JOIN public.supplier_cheque_claim_reversals r ON r.supplier_payment_id=p.id
      WHERE p.id=v_payment AND(p.is_reversed IS DISTINCT FROM(r.id IS NOT NULL)
        OR(r.id IS NOT NULL AND(r.amount_in_minor_units<>p.amount_in_minor_units OR r.payment_method<>p.payment_method
          OR r.cash_shift_id IS DISTINCT FROM p.cash_shift_id OR r.requested_by IS DISTINCT FROM p.reversed_by
          OR r.reason IS DISTINCT FROM p.reversal_reason OR EXISTS(SELECT 1 FROM public.deferred_cheques WHERE supplier_payment_id=p.id))))) THEN
      RAISE EXCEPTION 'CHEQUE_CLAIM_REVERSAL_EVIDENCE_MISMATCH';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.cheque_validate_claim_payment_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_validate_claim_payment_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER trg_cheque_customer_claim_payment AFTER INSERT OR UPDATE ON public.customer_collection_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_claim_payment_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_customer_claim_allocation AFTER INSERT ON public.customer_collection_cheque_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_claim_payment_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_supplier_claim_payment AFTER INSERT OR UPDATE ON public.supplier_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_claim_payment_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_supplier_claim_allocation AFTER INSERT ON public.supplier_cheque_claim_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_claim_payment_internal();
CREATE CONSTRAINT TRIGGER trg_cheque_supplier_claim_reversal AFTER INSERT ON public.supplier_cheque_claim_reversals
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cheque_validate_claim_payment_internal();

COMMIT;
