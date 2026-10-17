BEGIN;

-- The existing 163 collection remains the ONLY customer allocation writer.
-- Its old opening-first/order ordering is preserved. Compensations re-enter
-- the original opening/order lane at their proven original date; unknown
-- dates are first within that lane. No client-supplied balance or unit cost.

CREATE FUNCTION public.cheque_order_debt_date_internal(p_order_id UUID)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(
    (SELECT MIN(h.created_at) FROM public.order_status_history h WHERE h.order_id=o.id AND h.new_status='completed'),
    (SELECT MIN(b.completed_at) FROM public.business_operations b WHERE b.operation_type='phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id'=o.id::TEXT AND b.request_identity_snapshot->>'order_id'=o.id::TEXT),
    CASE WHEN creation.operation_type='phase3_pos_sale_v1' AND creation.result_snapshot->>'orderId'=o.id::TEXT
      THEN creation.completed_at END)
  FROM public.orders o LEFT JOIN public.business_operations creation ON creation.id=o.operation_id WHERE o.id=p_order_id;
$$;
ALTER FUNCTION public.cheque_order_debt_date_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_order_debt_date_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

-- A cashier may collect an incoming cheque only through its atomic registered
-- context. A GUC alone is never authority: a private cheque row created by the
-- SAME authenticated actor in the SAME DB transaction must prove the context.
CREATE FUNCTION public.cheque_assert_customer_payment_role_internal(p_order_id UUID,p_method TEXT)
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
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales'],'تسجيل دفعة عميل');
  END IF;
END;
$$;
ALTER FUNCTION public.cheque_assert_customer_payment_role_internal(UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_assert_customer_payment_role_internal(UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;

-- Complete explicit public payment body: the old 121 financial guard,120
-- lock contract and017 actual voucher/audit writer, not a new parallel path.
CREATE OR REPLACE FUNCTION public.record_customer_order_payment(
  p_order_id UUID,p_amount_in_minor_units BIGINT,p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_user_id UUID:=auth.uid();v_order RECORD;v_due BIGINT;v_new_paid BIGINT;
  v_payment_id UUID;v_payment_number TEXT;v_position RECORD;
BEGIN
  PERFORM public.cheque_assert_customer_payment_role_internal(p_order_id,p_payment_method);
  PERFORM public.phase4_lock_customer_order_context_internal(p_order_id,
    LOWER(COALESCE(p_payment_method,'')) IN ('cash','cliq'),false);
  SELECT * INTO v_position FROM public.phase42_order_financial_position_internal(p_order_id);
  IF COALESCE(p_amount_in_minor_units,0)<=0 OR p_amount_in_minor_units>v_position.outstanding_total_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PHASE42_CUSTOMER_PAYMENT_EXCEEDS_EFFECTIVE_OUTSTANDING: Payment exceeds the Return-adjusted receivable.';
  END IF;
  IF p_amount_in_minor_units IS NULL OR p_amount_in_minor_units<=0 THEN RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';END IF;
  IF p_payment_method NOT IN ('cash','cliq','card','bank_transfer','cheque') THEN RAISE EXCEPTION 'طريقة الدفع غير معتمدة.';END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الطلب غير موجود.';END IF;
  IF v_order.status<>'completed' THEN RAISE EXCEPTION 'يمكن تسجيل الدفعة على طلب مكتمل فقط.';END IF;
  IF v_order.customer_id IS NULL THEN RAISE EXCEPTION 'الطلب غير مرتبط بعميل مسجل.';END IF;
  v_due:=GREATEST(v_order.total_in_minor_units-v_order.amount_paid_in_minor_units,0);
  IF v_due=0 THEN RAISE EXCEPTION 'الطلب مدفوع بالكامل.';END IF;
  IF p_amount_in_minor_units>v_due THEN
    RAISE EXCEPTION 'مبلغ الدفعة أكبر من المتبقي على الطلب (% د.أ).',TO_CHAR(v_due::NUMERIC/1000,'FM999999990.000');
  END IF;
  v_new_paid:=v_order.amount_paid_in_minor_units+p_amount_in_minor_units;
  v_payment_number:='CRV-'||TO_CHAR(NOW(),'YYYYMMDD')||'-'||LPAD(NEXTVAL('public.customer_payment_number_seq')::TEXT,6,'0');
  UPDATE public.orders SET amount_paid_in_minor_units=v_new_paid,
    payment_status=CASE WHEN v_new_paid>=total_in_minor_units THEN 'paid' ELSE 'partially_paid' END,
    updated_at=NOW() WHERE id=p_order_id;
  INSERT INTO public.customer_payments(payment_number,customer_id,order_id,amount_in_minor_units,payment_method,
    reference_number,notes,created_by)
  VALUES(v_payment_number,v_order.customer_id,p_order_id,p_amount_in_minor_units,p_payment_method,
    NULLIF(TRIM(p_reference_number),''),NULLIF(TRIM(p_notes),''),v_user_id) RETURNING id INTO v_payment_id;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(v_user_id,'RECORD_CUSTOMER_PAYMENT','customer_payments',v_payment_id,
    jsonb_build_object('payment_number',v_payment_number,'order_id',p_order_id,'order_number',v_order.order_number,
      'customer_id',v_order.customer_id,'amount_in_minor_units',p_amount_in_minor_units,
      'remaining_in_minor_units',v_order.total_in_minor_units-v_new_paid));
  RETURN jsonb_build_object('success',true,'payment_id',v_payment_id,'payment_number',v_payment_number,
    'order_id',p_order_id,'order_number',v_order.order_number,'amount_in_minor_units',p_amount_in_minor_units,
    'remaining_in_minor_units',v_order.total_in_minor_units-v_new_paid);
END;
$$;
ALTER FUNCTION public.record_customer_order_payment(UUID,BIGINT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_customer_order_payment(UUID,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment(UUID,BIGINT,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_order_payment_once(
  p_order_id UUID,p_amount_in_minor_units BIGINT,p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,p_notes TEXT DEFAULT NULL,p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_user_id UUID:=auth.uid();v_key TEXT:=NULLIF(TRIM(p_idempotency_key),'');
  v_existing public.customer_payments%ROWTYPE;v_result JSONB;
BEGIN
  PERFORM public.cheque_assert_customer_payment_role_internal(p_order_id,p_payment_method);
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة عميل.';END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN RAISE EXCEPTION 'مفتاح تكرار الدفعة غير صالح.';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT||':'||v_key,0));
  SELECT * INTO v_existing FROM public.customer_payments WHERE created_by=v_user_id AND idempotency_key=v_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR(p_payment_method='cliq' AND NULLIF(TRIM(v_existing.reference_number),'') IS DISTINCT FROM NULLIF(TRIM(p_reference_number),'')) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PAYMENT_IDEMPOTENCY_CONFLICT: مفتاح الدفعة مستخدم لطلب مختلف.';
    END IF;
    RETURN jsonb_build_object('success',true,'idempotent',true,'payment_id',v_existing.id,
      'payment_number',v_existing.payment_number,'order_id',v_existing.order_id,
      'amount_in_minor_units',v_existing.amount_in_minor_units,'remaining_in_minor_units',
      GREATEST((SELECT total_in_minor_units-amount_paid_in_minor_units FROM public.orders WHERE id=v_existing.order_id),0));
  END IF;
  v_result:=public.record_customer_order_payment(p_order_id,p_amount_in_minor_units,p_payment_method,p_reference_number,p_notes);
  UPDATE public.customer_payments SET idempotency_key=v_key WHERE id=(v_result->>'payment_id')::UUID
    AND created_by=v_user_id AND idempotency_key IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار الدفعة.';END IF;
  RETURN v_result||jsonb_build_object('idempotent',false);
END;
$$;
ALTER FUNCTION public.record_customer_order_payment_once(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_customer_order_payment_once(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment_once(UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) TO authenticated;

-- A replacement cheque may itself pay a previous compensation. Follow that
-- immutable provenance so repeated returns retain the original opening/order
-- lane, not merely the immediate 'compensation' source kind.
CREATE FUNCTION public.cheque_customer_claim_lane_internal(p_claim_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH RECURSIVE provenance AS (
    SELECT c.id,c.origin_kind,a.origin_id,ARRAY[c.id] path
    FROM public.cheque_compensation_claims c JOIN public.deferred_cheque_allocations a ON a.id=c.source_allocation_id
    WHERE c.id=p_claim_id AND c.party_kind='customer'
    UNION ALL
    SELECT c.id,c.origin_kind,a.origin_id,p.path||c.id
    FROM provenance p JOIN public.cheque_compensation_claims c ON c.id=p.origin_id
    JOIN public.deferred_cheque_allocations a ON a.id=c.source_allocation_id
    WHERE p.origin_kind='compensation' AND NOT c.id=ANY(p.path)
  ) SELECT CASE WHEN origin_kind IN ('opening','opening_cheque') THEN 1 ELSE 2 END
    FROM provenance ORDER BY cardinality(path) DESC LIMIT 1;
$$;
ALTER FUNCTION public.cheque_customer_claim_lane_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_customer_claim_lane_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.go_live_plan_customer_collection_internal(p_customer_id UUID,p_amount BIGINT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH debts AS (
    SELECT 1 kind_order,'opening'::TEXT kind,o.id,o.entry_number reference,o.occurred_at debt_at,
      o.occurred_at original_debt_at,o.outstanding
    FROM public.go_live_customer_opening_positions_internal(p_customer_id)o WHERE o.outstanding>0
    UNION ALL
    SELECT 2,'order',o.id,o.order_number,o.created_at,public.cheque_order_debt_date_internal(o.id),p.outstanding_total_in_minor_units
    FROM public.orders o CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id)p
    WHERE o.customer_id=p_customer_id AND o.status IN ('completed','delivered')
      AND(COALESCE(o.source,'website')<>'pos' OR o.payment_method='debt') AND p.outstanding_total_in_minor_units>0
    UNION ALL
    SELECT public.cheque_customer_claim_lane_internal(c.id),
      'compensation',c.id,c.reference,c.occurred_at,c.occurred_at,c.outstanding
    FROM public.cheque_customer_claim_positions_internal(p_customer_id)c WHERE c.outstanding>0
  ),ordered AS (
    SELECT d.*,COALESCE(SUM(outstanding) OVER(ORDER BY kind_order,debt_at NULLS FIRST,reference,id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) before_amount FROM debts d
  ),allocated AS (
    SELECT o.*,GREATEST(LEAST(o.outstanding,COALESCE(p_amount,0)-o.before_amount),0)::BIGINT allocate FROM ordered o
  )
  SELECT jsonb_build_object(
    'openingOutstandingInMinorUnits',COALESCE(SUM(outstanding) FILTER(WHERE kind='opening'),0),
    'ordersOutstandingInMinorUnits',COALESCE(SUM(outstanding) FILTER(WHERE kind='order'),0),
    'compensationOutstandingInMinorUnits',COALESCE(SUM(outstanding) FILTER(WHERE kind='compensation'),0),
    'totalOutstandingInMinorUnits',COALESCE(SUM(outstanding),0),
    'openingAllocatedInMinorUnits',COALESCE(SUM(allocate) FILTER(WHERE kind='opening'),0),
    'ordersAllocatedInMinorUnits',COALESCE(SUM(allocate) FILTER(WHERE kind='order'),0),
    'compensationAllocatedInMinorUnits',COALESCE(SUM(allocate) FILTER(WHERE kind='compensation'),0),
    'parts',COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'reference',reference,
      'debtAt',debt_at,'originalDebtAt',original_debt_at,'outstandingInMinorUnits',outstanding,
      'allocateInMinorUnits',allocate,'remainingAfterInMinorUnits',outstanding-allocate)
      ORDER BY kind_order,debt_at NULLS FIRST,reference,id),'[]'::JSONB)) FROM allocated;
$$;
ALTER FUNCTION public.go_live_plan_customer_collection_internal(UUID,BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_plan_customer_collection_internal(UUID,BIGINT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.go_live_guard_collection_operation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.is_reversed OR NOT NEW.is_reversed
    OR(NEW.id,NEW.operation_number,NEW.customer_id,NEW.amount_in_minor_units,
      NEW.opening_amount_in_minor_units,NEW.orders_amount_in_minor_units,NEW.compensation_amount_in_minor_units,
      NEW.payment_method,NEW.reference_number,NEW.notes,NEW.branch_id,NEW.cash_shift_id,NEW.idempotency_key,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM(OLD.id,OLD.operation_number,OLD.customer_id,OLD.amount_in_minor_units,
      OLD.opening_amount_in_minor_units,OLD.orders_amount_in_minor_units,OLD.compensation_amount_in_minor_units,
      OLD.payment_method,OLD.reference_number,OLD.notes,OLD.branch_id,OLD.cash_shift_id,OLD.idempotency_key,OLD.created_by,OLD.created_at) THEN
    RAISE EXCEPTION 'GO_LIVE_COLLECTION_IMMUTABLE: سجل التحصيل دائم؛ التصحيح بعكس العملية كاملة فقط.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deferred_cheques WHERE collection_operation_id=OLD.id) THEN
    RAISE EXCEPTION 'CHEQUE_ORIGINAL_PAYMENT_IMMUTABLE: أصل تحصيل الشيك ثابت؛ استخدم انتقال الشيك المعتمد.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_collection_operation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_collection_operation() FROM PUBLIC,anon,authenticated,service_role;

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
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales'],'تحصيل من الزبون');
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
ALTER FUNCTION public.collect_customer_balance_v1(UUID,BIGINT,TEXT,UUID,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.collect_customer_balance_v1(UUID,BIGINT,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collect_customer_balance_v1(UUID,BIGINT,TEXT,UUID,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.go_live_collection_result_internal(p_operation_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('success',true,'operationId',op.id,'operationNumber',op.operation_number,
    'customerId',op.customer_id,'amountInMinorUnits',op.amount_in_minor_units,
    'openingAmountInMinorUnits',op.opening_amount_in_minor_units,'ordersAmountInMinorUnits',op.orders_amount_in_minor_units,
    'compensationAmountInMinorUnits',op.compensation_amount_in_minor_units,'paymentMethod',op.payment_method,
    'isReversed',op.is_reversed,'createdAt',op.created_at,
    'chequeId',(SELECT q.id FROM public.deferred_cheques q WHERE q.collection_operation_id=op.id),
    'parts',COALESCE((SELECT jsonb_agg(part ORDER BY sort_key) FROM(
      SELECT b.occurred_at::TEXT||b.entry_number sort_key,jsonb_build_object('kind','opening','id',b.id,'reference',b.entry_number,
        'amountInMinorUnits',a.amount_in_minor_units)part FROM public.customer_collection_opening_allocations a
        JOIN public.customer_opening_balances b ON b.id=a.opening_balance_id WHERE a.operation_id=op.id
      UNION ALL
      SELECT '~'||o.created_at::TEXT||o.order_number,jsonb_build_object('kind','order','id',o.id,'reference',o.order_number,
        'paymentId',l.customer_payment_id,'amountInMinorUnits',l.amount_in_minor_units)
      FROM public.customer_collection_order_payments l JOIN public.orders o ON o.id=l.order_id WHERE l.operation_id=op.id
      UNION ALL
      SELECT COALESCE(c.original_debt_at::TEXT,'')||c.reference,jsonb_build_object('kind','compensation','id',c.id,
        'reference',c.reference,'claimKind',c.claim_kind,'amountInMinorUnits',a.amount_in_minor_units)
      FROM public.customer_collection_cheque_allocations a JOIN public.cheque_compensation_claims c ON c.id=a.claim_id
      WHERE a.operation_id=op.id
    )parts),'[]'::JSONB),'remainingBalanceInMinorUnits',public.phase42_customer_receivable_total_internal(op.customer_id))
  FROM public.customer_collection_operations op WHERE op.id=p_operation_id;
$$;
ALTER FUNCTION public.go_live_collection_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_collection_result_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_guard_original_voucher_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.is_reversed AND NOT COALESCE(OLD.is_reversed,false) AND(
    (TG_TABLE_NAME='customer_payments' AND EXISTS(SELECT 1 FROM public.deferred_cheque_allocations WHERE customer_payment_id=OLD.id))
    OR(TG_TABLE_NAME='supplier_payments' AND EXISTS(SELECT 1 FROM public.deferred_cheques WHERE supplier_payment_id=OLD.id))) THEN
    RAISE EXCEPTION 'CHEQUE_ORIGINAL_PAYMENT_IMMUTABLE: لا يعكس أصل الشيك؛ الرجوع والإلغاء بقيد تعويضي مستقل.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.cheque_guard_original_voucher_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_guard_original_voucher_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_cheque_original_customer_payment BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_original_voucher_internal();
CREATE TRIGGER trg_cheque_original_supplier_payment BEFORE UPDATE OF is_reversed ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_original_voucher_internal();

COMMIT;
