-- Owner-approved216: an initial POS payment, atomically composed from the
-- existing debt sale and customer receipt. Old operation snapshots stay exact.
BEGIN;
SET LOCAL lock_timeout='10s';

CREATE TABLE public.pos216_initial_payments (
  order_id UUID PRIMARY KEY REFERENCES public.orders(id),
  operation_id UUID NOT NULL UNIQUE REFERENCES public.business_operations(id),
  payment_id UUID NOT NULL UNIQUE REFERENCES public.customer_payments(id),
  actor_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_identity JSONB NOT NULL,
  total_in_minor_units BIGINT NOT NULL CHECK(total_in_minor_units>0),
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','cliq')),
  reference_number TEXT,
  result_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(amount_in_minor_units<total_in_minor_units)
);
ALTER TABLE public.pos216_initial_payments OWNER TO postgres;
ALTER TABLE public.pos216_initial_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos216_initial_payments FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.tc216_reject_initial_payment_mutation_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='POS216_INITIAL_PAYMENT_IMMUTABLE: لا يمكن تعديل دليل الدفعة الأولى.';
END;
$$;
ALTER FUNCTION public.tc216_reject_initial_payment_mutation_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tc216_reject_initial_payment_mutation_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER pos216_initial_payments_immutable BEFORE UPDATE OR DELETE ON public.pos216_initial_payments
FOR EACH ROW EXECUTE FUNCTION public.tc216_reject_initial_payment_mutation_internal();
CREATE TRIGGER pos216_initial_payments_no_truncate BEFORE TRUNCATE ON public.pos216_initial_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.tc216_reject_initial_payment_mutation_internal();

ALTER FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT)
 RENAME TO tc216_create_pos_sale_v2_internal;
REVOKE ALL ON FUNCTION public.tc216_create_pos_sale_v2_internal(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_pos_sale_v2(
 p_warehouse_id UUID,p_branch_id UUID,p_customer_id UUID,p_customer_name TEXT,
 p_payment_method TEXT,p_lines JSONB,p_discount_in_minor_units BIGINT DEFAULT 0,
 p_amount_received_in_minor_units BIGINT DEFAULT 0,p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_key TEXT:=NULLIF(BTRIM(p_idempotency_key),'');
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'تنفيذ بيع الكاشير');
 IF v_key IS NULL OR length(v_key) NOT BETWEEN 16 AND 200 THEN
  RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Invalid POS key';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(v_key));
 IF EXISTS(SELECT 1 FROM public.pos216_initial_payments WHERE idempotency_key=v_key) THEN
  RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: أعد محاولة الدفعة الجزئية بنفس مسارها الأصلي.';
 END IF;
 RETURN public.tc216_create_pos_sale_v2_internal(p_warehouse_id,p_branch_id,p_customer_id,p_customer_name,
  p_payment_method,p_lines,p_discount_in_minor_units,p_amount_received_in_minor_units,p_idempotency_key);
END;
$$;
ALTER FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) TO authenticated;

CREATE FUNCTION public.create_pos_sale_with_initial_payment_v1(
 p_warehouse_id UUID,p_branch_id UUID,p_customer_id UUID,p_customer_name TEXT,
 p_lines JSONB,p_discount_in_minor_units BIGINT,p_initial_paid_in_minor_units BIGINT,
 p_initial_payment_method TEXT,p_reference_number TEXT,p_idempotency_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_actor UUID:=auth.uid();v_key TEXT:=NULLIF(BTRIM(p_idempotency_key),'');
 v_method TEXT:=LOWER(BTRIM(p_initial_payment_method));
 v_reference TEXT:=NULLIF(BTRIM(p_reference_number),'');
 v_request JSONB;v_sale_request JSONB;v_existing public.pos216_initial_payments%ROWTYPE;
 v_shift UUID;v_total NUMERIC;v_sale JSONB;v_payment JSONB;v_result JSONB;
BEGIN
 -- Exactly the V2 role/active/MFA boundary, before reading any business data.
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'تنفيذ بيع بدفعة جزئية');
 IF v_actor IS NULL OR v_key IS NULL OR length(v_key) NOT BETWEEN 16 AND 200 THEN
  RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID: مفتاح المحاولة غير صالح.';
 END IF;
 IF p_customer_id IS NULL THEN
  RAISE EXCEPTION 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED: اختر زبوناً مسجلاً للبيع الآجل.';
 END IF;
 IF p_initial_paid_in_minor_units IS NULL OR p_initial_paid_in_minor_units<=0
  OR p_discount_in_minor_units IS NULL OR p_discount_in_minor_units<0
  OR v_method IS NULL OR v_method NOT IN ('cash','cliq')
  OR char_length(COALESCE(v_reference,''))>200 THEN
  RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID: راجع المدفوع الآن وطريقة الدفع.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext(v_key));
 v_sale_request:=public.phase3_canonicalize_sale_request_internal(jsonb_build_object(
  'contract_version','phase3-sale-v1','actor_scope_type','erp_user',
  'actor_scope_hash',public.phase3_actor_scope_hash_internal('erp_user',v_actor,NULL,NULL),
  'operation_source','admin_pos','warehouse_id',p_warehouse_id,'branch_id',p_branch_id,
  'customer_id',p_customer_id,'customer_identity_hash',NULL,'payment_method','debt',
  'order_discount_in_minor_units',p_discount_in_minor_units,'amount_received_in_minor_units',0,'lines',p_lines));
 v_request:=jsonb_build_object('contract','pos-initial-payment216-v1','sale',v_sale_request,
  'paid',p_initial_paid_in_minor_units,'method',v_method,'reference',v_reference);
 SELECT * INTO v_existing FROM public.pos216_initial_payments WHERE idempotency_key=v_key;
 IF FOUND THEN
  IF v_existing.actor_id IS DISTINCT FROM v_actor OR v_existing.request_identity IS DISTINCT FROM v_request THEN
   RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: مفتاح المحاولة مرتبط ببيع أو دفعة مختلفة.';
  END IF;
  RETURN v_existing.result_snapshot||jsonb_build_object('idempotentReplay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=v_key)
  OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=v_key) THEN
  RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: لا يمكن إضافة دفعة أولى لمحاولة بيع سابقة.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations WHERE actor_id=v_actor AND idempotency_key=v_key) THEN
  RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_CANCELLED: هذه المحاولة ملغاة.';
 END IF;

 -- Keep the established customer KEY SHARE (compatible with receipt FK
 -- checks). Acquire the final shift UPDATE mode before stock, avoiding a
 -- SHARE-to-UPDATE upgrade after the sale has locked inventory.
 PERFORM 1 FROM public.customers WHERE id=p_customer_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_CUSTOMER_INVALID: الزبون غير موجود.';END IF;
 SELECT id INTO v_shift FROM public.cash_shifts WHERE branch_id=p_branch_id AND status='open' ORDER BY id LIMIT 1 FOR UPDATE;
 IF v_shift IS NULL THEN RAISE EXCEPTION 'PHASE3_POS_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق أولاً.';END IF;

 -- Price only from the same locked server catalog. The existing sale performs
 -- all commercial/parcel/stock validation again; no client total is trusted.
 PERFORM public.parcel209_guard_modern_lines_internal(v_sale_request->'lines');
 SELECT SUM(CASE WHEN l->>'commercial_line_kind'='base_unit'
   THEN p.sale_price_in_minor_units::NUMERIC*(l->>'base_quantity')::NUMERIC
   ELSE p.default_sale_price_in_minor_units::NUMERIC*(l->>'parcel_quantity')::NUMERIC END)
  -p_discount_in_minor_units INTO v_total
 FROM jsonb_array_elements(v_sale_request->'lines') l JOIN public.products p
  ON p.id=COALESCE((l->>'product_id')::UUID,(l->>'family_product_id')::UUID);
 IF v_total IS NULL OR p_initial_paid_in_minor_units>=v_total THEN
  RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID: المدفوع الجزئي يجب أن يكون أقل من صافي الفاتورة؛ اختر الدفع الكامل عند تساويهما.';
 END IF;

 v_sale:=public.tc216_create_pos_sale_v2_internal(p_warehouse_id,p_branch_id,p_customer_id,p_customer_name,
  'debt',p_lines,p_discount_in_minor_units,0,v_key);
 IF (v_sale->>'totalInMinorUnits')::NUMERIC IS DISTINCT FROM v_total
  OR COALESCE((v_sale->>'idempotentReplay')::BOOLEAN,true) THEN
  RAISE EXCEPTION 'POS216_SALE_CONTRACT_CHANGED: تغيّر عقد البيع؛ لم تُحفظ العملية.';
 END IF;
 v_payment:=public.record_customer_order_payment_once((v_sale->>'orderId')::UUID,
  p_initial_paid_in_minor_units,v_method,v_reference,NULL,'pos216-initial-'||(v_sale->>'operationId'));
 v_result:=v_sale||jsonb_build_object('amountPaidInMinorUnits',p_initial_paid_in_minor_units,
  'paymentStatus','partially_paid','initialPaymentMethod',v_method,
  'initialPaymentId',v_payment->>'payment_id','remainingInMinorUnits',v_total-p_initial_paid_in_minor_units);
 INSERT INTO public.pos216_initial_payments(order_id,operation_id,payment_id,actor_id,idempotency_key,
  request_identity,total_in_minor_units,amount_in_minor_units,payment_method,reference_number,result_snapshot)
 VALUES((v_sale->>'orderId')::UUID,(v_sale->>'operationId')::UUID,(v_payment->>'payment_id')::UUID,
  v_actor,v_key,v_request,v_total::BIGINT,p_initial_paid_in_minor_units,v_method,v_reference,v_result);
 RETURN v_result;
END;
$$;
ALTER FUNCTION public.create_pos_sale_with_initial_payment_v1(UUID,UUID,UUID,TEXT,JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_pos_sale_with_initial_payment_v1(UUID,UUID,UUID,TEXT,JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_with_initial_payment_v1(UUID,UUID,UUID,TEXT,JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT) TO authenticated;


--216 initial voucher classification only;215 exchange/return and cash math remain literal.
CREATE OR REPLACE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report JSONB;
  v_base_report JSONB;
  v_event_count INTEGER := 0;
  v_exchange_refund_count INTEGER := 0;
  v_internal_exchange_credit BIGINT := 0;
  v_breakdown JSONB;
  v_quantity_breakdown JSONB;
  v_shift public.cash_shifts%ROWTYPE;
  v_gross BIGINT;
  v_credit BIGINT;
  v_first_cash BIGINT;
  v_first_cliq BIGINT;
  v_first_total BIGINT;
  v_direct_collected BIGINT;
  v_unproven INTEGER;
  v_debt_reduction BIGINT;
  v_return_entitlement BIGINT;
BEGIN
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);
  IF COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;
  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0 AND refund_method<>'exchange_credit';
  SELECT count(*) INTO v_exchange_refund_count FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0;
  v_event_count:=v_event_count+v_exchange_refund_count;

  IF v_event_count > 0 THEN
    WITH combined AS (
      SELECT
        item->>'refundMethod' AS refund_method,
        item->>'stockDisposition' AS stock_disposition,
        COALESCE((item->>'count')::INTEGER, 0) AS item_count,
        COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
      FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
      UNION ALL
      SELECT
        return_event.refund_method,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.sales_return_items return_item
          WHERE return_item.sales_return_event_id = return_event.id
            AND return_item.stock_disposition = 'damaged'
        ) THEN 'damaged' ELSE 'restock' END,
        1,
        return_event.money_refund_amount_in_minor_units
      FROM public.sales_return_events return_event
      WHERE return_event.cash_shift_id = p_shift_id
        AND return_event.settlement_status = 'settled'
        AND return_event.money_refund_amount_in_minor_units > 0 AND return_event.refund_method<>'exchange_credit'
      UNION ALL
      SELECT x.prepared_plan->>'differenceMethod',CASE WHEN EXISTS(SELECT 1 FROM public.sales_return_items i WHERE i.sales_return_event_id=e.id AND i.stock_disposition='damaged') THEN 'damaged' ELSE 'restock' END,
       1,(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT
      FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id
      WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id AND(x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT>0
    ), grouped AS (
      SELECT refund_method, stock_disposition,
        SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
      FROM combined
      GROUP BY refund_method, stock_disposition
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'refundMethod', refund_method,
        'stockDisposition', stock_disposition,
        'count', item_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, refund_method, stock_disposition
    ), '[]'::JSONB)
    INTO v_breakdown
    FROM grouped;

    v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
    v_report := jsonb_set(
      v_report,
      '{outflows,returnCount}',
      to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
      true
    );
  END IF;

  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id, (leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e
    JOIN public.business_operations op ON op.id = e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources') = 'array'
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN i.stock_disposition = 'restock' THEN i.accepted_base_quantity ELSE 0 END,
      CASE WHEN i.stock_disposition = 'damaged' THEN i.accepted_base_quantity ELSE 0 END,
      i.rejected_base_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND i.return_scope = 'base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, c.product_id,
      CASE WHEN c.accepted_stock_disposition = 'restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition = 'non_sellable' THEN c.accepted_quantity ELSE 0 END,
      c.rejected_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id = i.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN e.stock_disposition = 'restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition = 'damaged' THEN i.quantity ELSE 0 END,
      0
    FROM public.sales_returns e
    JOIN public.order_items i ON i.order_id = e.order_id
    WHERE e.cash_shift_id = p_shift_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventId', q.event_id, 'productId', q.product_id,
    'productName', COALESCE(p.name_ar, 'صنف تاريخي'),
    'sellableQuantity', q.sellable, 'defectQuantity', q.defect,
    'customerDamageQuantity', q.damage) ORDER BY q.event_id, q.product_id), '[]'::JSONB)
  INTO v_quantity_breakdown
  FROM quantities q LEFT JOIN public.products p ON p.id = q.product_id;

  -- Preserve the full131 Return projection even if only133 sales enrichment fails.
  v_report := v_report || jsonb_build_object('returnQuantityBreakdown',v_quantity_breakdown);
  v_base_report:=v_report;
  BEGIN

  SELECT * INTO STRICT v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  SELECT COALESCE(sum((x.prepared_plan->>'internalCreditInMinorUnits')::BIGINT),0) INTO v_internal_exchange_credit
  FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  WHERE(x.prepared_plan->>'cashShiftId')::UUID=p_shift_id;

  -- Completion-time truth is immutable. Later receipts/refunds do not turn
  -- newly-sold credit into a different sale. Existing cash/receipt/reconciliation
  -- fields in v_report are never rewritten by this presentation change.
  WITH first_completion AS MATERIALIZED (
    SELECT order_id,MAX(created_at) AS at FROM public.order_status_history
    WHERE new_status='completed' GROUP BY order_id
  ), completions AS MATERIALIZED (
    SELECT DISTINCT ON (operation.result_snapshot->>'order_id')
      operation.result_snapshot->>'order_id' AS order_key,
      operation.result_snapshot,operation.request_identity_snapshot
    FROM public.business_operations operation
    WHERE operation.operation_type='phase3_customer_completion_v1'
      AND operation.result_snapshot->>'order_id'=operation.request_identity_snapshot->>'order_id'
      AND operation.completed_at IS NOT NULL
    ORDER BY operation.result_snapshot->>'order_id',operation.completed_at,operation.id
  ), selected AS (
    SELECT customer_order.*,creation.operation_type,creation.result_snapshot AS creation_result,
      completion.result_snapshot AS completion_result,completion.request_identity_snapshot AS completion_request
    FROM public.orders customer_order
    LEFT JOIN first_completion ON first_completion.order_id=customer_order.id
    LEFT JOIN public.business_operations creation ON creation.id=customer_order.operation_id
    LEFT JOIN completions completion ON completion.order_key=customer_order.id::TEXT
    WHERE customer_order.branch_id=v_shift.branch_id
      AND customer_order.status IN('completed','returned')
      AND (customer_order.cash_shift_id=p_shift_id OR (
        customer_order.cash_shift_id IS NULL AND COALESCE(first_completion.at,customer_order.updated_at)>=v_shift.opened_at
        AND COALESCE(first_completion.at,customer_order.updated_at)<=COALESCE(v_shift.closed_at,NOW())
      ))
  ), anchors AS (
    SELECT selected.*,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN COALESCE((SELECT initial.amount_in_minor_units FROM public.pos216_initial_payments initial WHERE initial.order_id=selected.id),(creation_result->>'amountPaidInMinorUnits')::BIGINT)
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN (completion_result->>'amount_paid_in_minor_units')::BIGINT
        WHEN payment_method IN('cash','cash_on_delivery','cliq','card') THEN total_in_minor_units
        ELSE 0 END AS initial_collected,
      CASE WHEN operation_type='phase3_pos_sale_v1'
        THEN (SELECT receipt.payment_number FROM public.pos216_initial_payments initial JOIN public.customer_payments receipt ON receipt.id=initial.payment_id WHERE initial.order_id=selected.id)
        WHEN operation_type='phase3_customer_reservation_v1'
        THEN NULLIF(completion_result->>'customer_payment_number','') END AS first_voucher_number
    FROM selected
  ), bound AS (
    SELECT anchors.*,payment.id AS first_payment_id,payment.amount_in_minor_units AS first_amount,
      payment.payment_method AS first_method,payment.order_id AS first_order_id,
      payment.cash_shift_id AS first_shift_id
    FROM anchors LEFT JOIN public.customer_payments payment ON payment.payment_number=anchors.first_voucher_number
  )
  SELECT COALESCE(SUM(total_in_minor_units),0)::BIGINT,
    COALESCE(SUM(total_in_minor_units-initial_collected),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cash'),0)::BIGINT,
    COALESCE(SUM(first_amount) FILTER(WHERE first_method='cliq'),0)::BIGINT,
    COUNT(*) FILTER(WHERE initial_collected IS NULL OR initial_collected<0
      OR initial_collected>total_in_minor_units OR (
        first_voucher_number IS NOT NULL AND (
          first_payment_id IS NULL OR first_order_id IS DISTINCT FROM id
          OR first_shift_id IS DISTINCT FROM p_shift_id OR first_amount IS DISTINCT FROM initial_collected
          OR first_method IS DISTINCT FROM COALESCE((SELECT initial.payment_method FROM public.pos216_initial_payments initial WHERE initial.order_id=bound.id),completion_request->>'payment_method')
          OR first_method NOT IN('cash','cliq')
        )
      ))::INTEGER
  INTO v_gross,v_credit,v_first_cash,v_first_cliq,v_unproven
  FROM bound;

  v_first_total:=v_first_cash+v_first_cliq;
  v_direct_collected:=COALESCE((v_report#>>'{shift,cashSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cliqSalesInMinorUnits}')::BIGINT,0)
    +COALESCE((v_report#>>'{shift,cardSalesInMinorUnits}')::BIGINT,0);
  IF v_unproven<>0 OR v_gross<>v_direct_collected+v_first_total+v_credit+v_internal_exchange_credit THEN
    RAISE EXCEPTION 'PHASE133_CLOSING_SALES_EVIDENCE_MISMATCH: لا يمكن إثبات توزيع مبيعات الوردية.';
  END IF;

  -- Existing refunds contain legacy + modern money exactly once. Debt-only
  -- Returns have no cash_shift_id; use authoritative settlement time inside
  -- this branch's non-overlapping shift window. No drawer projection changes.
  SELECT COALESCE(SUM(event.debt_reduction_amount_in_minor_units),0)::BIGINT
  INTO v_debt_reduction
  FROM public.sales_return_events event
  JOIN public.orders customer_order ON customer_order.id=event.order_id
  JOIN public.business_operations creation ON creation.id=customer_order.operation_id
  WHERE event.contract_version=401 AND event.settlement_status='settled'
    AND creation.operation_type IN('phase3_pos_sale_v1','phase3_customer_reservation_v1')
    AND event.branch_id=v_shift.branch_id
    AND (event.cash_shift_id=p_shift_id OR (
      event.cash_shift_id IS NULL AND event.settled_at>=v_shift.opened_at
      AND event.settled_at<COALESCE(v_shift.closed_at,NOW())
    ));
  v_return_entitlement:=COALESCE((v_report#>>'{sales,refundsInMinorUnits}')::BIGINT,0)+v_debt_reduction+v_internal_exchange_credit;

  v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object(
    'salesDefinitionVersion',CASE WHEN v_internal_exchange_credit>0 THEN 215 ELSE 133 END,
    'grossSalesInMinorUnits',v_gross,
    'collectedDirectSalesInMinorUnits',v_direct_collected,
    'initialReceiptPaymentsInMinorUnits',v_first_total,
    'initialReceiptCashInMinorUnits',v_first_cash,
    'initialReceiptCliqInMinorUnits',v_first_cliq,
    'creditSalesInMinorUnits',v_credit,
    'returnEntitlementInMinorUnits',v_return_entitlement,
    'debtReductionInMinorUnits',v_debt_reduction,
    'netSalesInMinorUnits',v_gross-v_return_entitlement
  ));
  IF v_internal_exchange_credit>0 THEN
    v_report:=jsonb_set(v_report,'{sales}',(v_report->'sales')||jsonb_build_object('internalExchangeCreditInMinorUnits',v_internal_exchange_credit::TEXT));
  END IF;
  v_report:=jsonb_set(v_report,'{collections}',(v_report->'collections')||jsonb_build_object(
    'initialPaymentsInMinorUnits',v_first_total,
    'initialCashInMinorUnits',v_first_cash,
    'initialCliqInMinorUnits',v_first_cliq
  ));
  RETURN v_report || jsonb_build_object('returnQuantityBreakdown', v_quantity_breakdown,'salesDetailStatus','available');
  EXCEPTION WHEN query_canceled THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  WHEN OTHERS THEN
    RETURN v_base_report || jsonb_build_object('salesDetailStatus','unavailable','salesDetailMessage','تفصيل غير متاح');
  END;
END;
$function$;

ALTER FUNCTION public.get_public_pos_receipt(UUID) RENAME TO tc216_get_public_pos_receipt_internal;
REVOKE ALL ON FUNCTION public.tc216_get_public_pos_receipt_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_public_pos_receipt(p_receipt_token UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_receipt JSONB;v_payment JSONB;
BEGIN
 v_receipt:=public.tc216_get_public_pos_receipt_internal(p_receipt_token);
 IF COALESCE(v_receipt->>'success','false')<>'true' THEN RETURN v_receipt;END IF;
 -- The exact existing token gate executes first. Only216 receipts acquire
 -- current received/due values; no cost/WAC/profit or additional identity.
 SELECT jsonb_build_object('amountPaidInMinorUnits',o.amount_paid_in_minor_units,
  'remainingInMinorUnits',financial_position.outstanding_total_in_minor_units,'initialPaymentMethod',initial.payment_method)
 INTO v_payment FROM public.orders o JOIN public.pos216_initial_payments initial ON initial.order_id=o.id
 CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) financial_position
 WHERE o.public_receipt_token=p_receipt_token AND o.source='pos' AND o.status IN('completed','returned');
 RETURN v_receipt||COALESCE(v_payment,'{}'::JSONB);
END;
$$;
ALTER FUNCTION public.get_public_pos_receipt(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_pos_receipt(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_pos_receipt(UUID) TO anon,authenticated;

COMMIT;
