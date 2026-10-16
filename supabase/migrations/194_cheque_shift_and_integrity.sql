BEGIN;

-- Complete explicit shift/read/monitor definitions, retaining180182 semantics.
CREATE FUNCTION public.cheque_shift_settlement_section_internal(p_shift_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH items AS (
    SELECT 'customer_collection'::TEXT kind,o.id,o.operation_number reference,o.created_at at,o.payment_method,
      o.compensation_amount_in_minor_units amount
    FROM public.customer_collection_operations o WHERE o.cash_shift_id=p_shift_id AND NOT o.is_reversed AND o.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'supplier_payment',p.id,c.reference,p.payment_date,p.payment_method,l.amount_in_minor_units
    FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
    JOIN public.cheque_compensation_claims c ON c.id=l.claim_id WHERE l.cash_shift_id=p_shift_id AND NOT p.is_reversed
  ) SELECT jsonb_build_object('sectionVersion',1,
    'cashReceiptsInMinorUnits',COALESCE(SUM(amount) FILTER(WHERE kind='customer_collection' AND payment_method='cash'),0),
    'cliqReceiptsInMinorUnits',COALESCE(SUM(amount) FILTER(WHERE kind='customer_collection' AND payment_method='cliq'),0),
    'cashSupplierPaymentsInMinorUnits',COALESCE(SUM(amount) FILTER(WHERE kind='supplier_payment' AND payment_method='cash'),0),
    'cliqSupplierPaymentsInMinorUnits',COALESCE(SUM(amount) FILTER(WHERE kind='supplier_payment' AND payment_method='cliq'),0),
    'items',COALESCE(jsonb_agg(to_jsonb(items) ORDER BY at,id),'[]'::JSONB)) FROM items;
$$;
ALTER FUNCTION public.cheque_shift_settlement_section_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_shift_settlement_section_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_cash_shift_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_summary JSONB;
  v_shift_status TEXT;
  v_cash_refunds BIGINT := 0;
  v_cliq_refunds BIGINT := 0;
  v_cash_opening_receipts BIGINT := 0;
  v_cliq_opening_receipts BIGINT := 0;
  v_cash_opening_supplier BIGINT := 0;
  v_cliq_opening_supplier BIGINT := 0;
  v_withdrawn BIGINT := 0;
  v_returned BIGINT := 0;
  v_comp JSONB;
BEGIN
  v_summary := public._get_cash_shift_summary_before_return_events(p_shift_id);
  SELECT status INTO v_shift_status
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  SELECT effect.withdrawn_in_minor_units, effect.returned_in_minor_units
  INTO v_withdrawn, v_returned
  FROM public.owner_withdrawal_shift_effect_internal(p_shift_id) effect;
  v_summary := v_summary || jsonb_build_object(
    'ownerWithdrawalsInMinorUnits', v_withdrawn,
    'ownerWithdrawalReturnsInMinorUnits', v_returned);
  IF v_shift_status IS DISTINCT FROM 'open' THEN RETURN v_summary; END IF;
  SELECT
    COALESCE(SUM(money_refund_amount_in_minor_units) FILTER (WHERE refund_method = 'cash'), 0),
    COALESCE(SUM(money_refund_amount_in_minor_units) FILTER (WHERE refund_method = 'cliq'), 0)
  INTO v_cash_refunds, v_cliq_refunds
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0;
  SELECT
    COALESCE(SUM(opening_amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0),
    COALESCE(SUM(opening_amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)
  INTO v_cash_opening_receipts, v_cliq_opening_receipts
  FROM public.customer_collection_operations
  WHERE cash_shift_id = p_shift_id AND NOT is_reversed;
  SELECT
    COALESCE(SUM(payment.amount_in_minor_units) FILTER (WHERE payment.payment_method = 'cash'), 0),
    COALESCE(SUM(payment.amount_in_minor_units) FILTER (WHERE payment.payment_method = 'cliq'), 0)
  INTO v_cash_opening_supplier, v_cliq_opening_supplier
  FROM public.supplier_opening_payments link
  JOIN public.supplier_payments payment ON payment.id = link.supplier_payment_id
  WHERE link.cash_shift_id = p_shift_id AND NOT COALESCE(payment.is_reversed, false);
  v_comp:=public.cheque_shift_settlement_section_internal(p_shift_id);
  v_cash_opening_receipts:=v_cash_opening_receipts+(v_comp->>'cashReceiptsInMinorUnits')::BIGINT;
  v_cliq_opening_receipts:=v_cliq_opening_receipts+(v_comp->>'cliqReceiptsInMinorUnits')::BIGINT;
  v_cash_opening_supplier:=v_cash_opening_supplier+(v_comp->>'cashSupplierPaymentsInMinorUnits')::BIGINT;
  v_cliq_opening_supplier:=v_cliq_opening_supplier+(v_comp->>'cliqSupplierPaymentsInMinorUnits')::BIGINT;
  v_summary:=v_summary||jsonb_build_object('chequeCompensationSettlements',v_comp);
  v_summary := jsonb_set(v_summary, '{cashRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashRefundsInMinorUnits')::BIGINT, 0) + v_cash_refunds), true);
  v_summary := jsonb_set(v_summary, '{cliqRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqRefundsInMinorUnits')::BIGINT, 0) + v_cliq_refunds), true);
  v_summary := jsonb_set(v_summary, '{cashReceiptsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashReceiptsInMinorUnits')::BIGINT, 0) + v_cash_opening_receipts), true);
  v_summary := jsonb_set(v_summary, '{cliqReceiptsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0) + v_cliq_opening_receipts), true);
  v_summary := jsonb_set(v_summary, '{cashSupplierPaymentsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT, 0) + v_cash_opening_supplier), true);
  v_summary := jsonb_set(v_summary, '{cliqSupplierPaymentsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT, 0) + v_cliq_opening_supplier), true);
  v_summary := v_summary || jsonb_build_object(
    'openingDebtCashReceiptsInMinorUnits', v_cash_opening_receipts-(v_comp->>'cashReceiptsInMinorUnits')::BIGINT,
    'openingDebtCliqReceiptsInMinorUnits', v_cliq_opening_receipts-(v_comp->>'cliqReceiptsInMinorUnits')::BIGINT,
    'openingSupplierCashPaymentsInMinorUnits', v_cash_opening_supplier-(v_comp->>'cashSupplierPaymentsInMinorUnits')::BIGINT,
    'openingSupplierCliqPaymentsInMinorUnits', v_cliq_opening_supplier-(v_comp->>'cliqSupplierPaymentsInMinorUnits')::BIGINT);
  RETURN jsonb_set(v_summary, '{expectedCashInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'expectedCashInMinorUnits')::BIGINT, 0)
      - v_cash_refunds + v_cash_opening_receipts - v_cash_opening_supplier
      - v_withdrawn + v_returned), true);
END;
$$;
ALTER FUNCTION public.get_cash_shift_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_cash_shift(
  p_shift_id UUID,
  p_actual_cash_in_minor_units BIGINT,
  p_discrepancy_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_snapshot JSONB;
  v_section JSONB;
BEGIN
  v_result := public._close_cash_shift_before_closing_report_snapshot(
    p_shift_id,
    p_actual_cash_in_minor_units,
    p_discrepancy_reason
  );
  -- The internal close function has already frozen the canonical monetary
  -- columns. Capture the same report consumers see, inside this transaction.
  v_snapshot := public._get_cash_shift_closing_report_before_snapshot(p_shift_id)
    || jsonb_build_object(
      'snapshotStatus', 'immutable',
      'snapshotVersion', 1
    );
  IF COALESCE(v_snapshot->>'success', 'false') <> 'true' THEN
    RAISE EXCEPTION 'تعذر إنشاء لقطة تقرير الإغلاق؛ تم إلغاء إغلاق الوردية بأمان.';
  END IF;
  v_section := public.owner_withdrawal_closing_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items') > 0 THEN
    v_section := v_section || jsonb_build_object('netMovementAfterWithdrawalsInMinorUnits',
      (v_snapshot #>> '{reconciliation,netMovementInMinorUnits}')::BIGINT
        - (v_section->>'netInMinorUnits')::BIGINT);
    v_snapshot := v_snapshot || jsonb_build_object('ownerWithdrawals', v_section);
  END IF;
  v_section:=public.cheque_shift_settlement_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items')>0 THEN
    v_snapshot:=v_snapshot||jsonb_build_object('chequeCompensationSettlements',v_section);
  END IF;
  UPDATE public.cash_shifts
  SET closing_report_snapshot = v_snapshot,
      closing_report_snapshotted_at = NOW(),
      closing_report_snapshot_version = 1,
      updated_at = NOW()
  WHERE id = p_shift_id
    AND status = 'closed'
    AND closing_report_snapshot IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت لقطة تقرير الإغلاق؛ تم إلغاء العملية بأمان.';
  END IF;
  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    auth.uid(),
    'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT',
    'cash_shifts',
    p_shift_id,
    jsonb_build_object(
      'snapshot_version', 1,
      'snapshot_bytes', octet_length(v_snapshot::TEXT),
      'captured_at', NOW()
    )
  );
  RETURN v_result || jsonb_build_object(
    'closingReportSnapshotCaptured', true
  );
END;
$$;
ALTER FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_shift_closing_report(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_report JSONB;
  v_section JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض تقرير إغلاق الوردية'
  );
  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;
  IF v_shift.status = 'closed'
    AND v_shift.closing_report_snapshot IS NOT NULL
  THEN
    RETURN v_shift.closing_report_snapshot;
  END IF;
  v_report := public._get_cash_shift_closing_report_before_snapshot(p_shift_id);
  v_section := public.owner_withdrawal_closing_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items') > 0 THEN
    v_section := v_section || jsonb_build_object('netMovementAfterWithdrawalsInMinorUnits',
      (v_report #>> '{reconciliation,netMovementInMinorUnits}')::BIGINT
        - (v_section->>'netInMinorUnits')::BIGINT);
    v_report := v_report || jsonb_build_object('ownerWithdrawals', v_section);
  END IF;
  v_section:=public.cheque_shift_settlement_section_internal(p_shift_id);
  IF jsonb_array_length(v_section->'items')>0 THEN
    v_report:=v_report||jsonb_build_object('chequeCompensationSettlements',v_section);
  END IF;
  RETURN v_report || jsonb_build_object(
    'snapshotStatus',
    CASE
      WHEN v_shift.status = 'open' THEN 'live'
      WHEN v_shift.status = 'closed' THEN 'legacy_recalculated'
      ELSE 'not_applicable'
    END
  );
END;
$$;
ALTER FUNCTION public.get_cash_shift_closing_report(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_cash_shift_closing_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_closing_report(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_empty_cash_shift(
  p_shift_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إلغاء وردية فُتحت بالخطأ'
  );

  PERFORM 1 FROM public.cash_shifts WHERE id = p_shift_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.sales_return_events
    WHERE cash_shift_id = p_shift_id
      AND settlement_status <> 'cancelled'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_collection_operations WHERE cash_shift_id = p_shift_id
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_opening_payments WHERE cash_shift_id = p_shift_id
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_cheque_claim_payments WHERE cash_shift_id=p_shift_id
  ) THEN
    RAISE EXCEPTION
      'لا يمكن إلغاء الوردية لأنها تحتوي حركة مالية. صحح العملية ثم أغلق الوردية طبيعيًا.';
  END IF;

  RETURN public._cancel_empty_cash_shift_before_return_events(p_shift_id, p_reason);
END;
$$;
ALTER FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_cash_shift_full_reversal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview JSONB;
  v_plan JSONB;
BEGIN
  PERFORM public.assert_reversal_owner('معاينة إلغاء الوردية وعكس عملياتها');
  v_preview := public._preview_cash_shift_full_reversal(p_shift_id);
  v_plan := public.owner_withdrawal_shift_reversal_plan_internal(p_shift_id);
  IF EXISTS(SELECT 1 FROM public.customer_collection_operations o WHERE o.cash_shift_id=p_shift_id AND NOT o.is_reversed
      AND o.compensation_amount_in_minor_units>0)
    OR EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
      WHERE l.cash_shift_id=p_shift_id AND NOT p.is_reversed) THEN
    v_preview:=v_preview||jsonb_build_object('canExecute',false,'chequeCompensationBlocked',true,
      'chequeCompensationBlockedReason','اعكس تحصيل أو سداد قيد الشيك المرتبط بالوردية أولاً من مساره المعتمد.');
  END IF;
  RETURN v_preview || jsonb_build_object(
    'ownerWithdrawals', v_plan,
    'canExecute', COALESCE((v_preview->>'canExecute')::BOOLEAN, false) AND (v_plan->>'canExecute')::BOOLEAN
  );
END;
$$;
ALTER FUNCTION public.preview_cash_shift_full_reversal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_cash_shift_full_reversal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_cash_shift_full_reversal(UUID) TO authenticated;

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
  v_plan JSONB;
  v_result JSONB;
  v_reversal_id UUID;
  v_item JSONB;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_reversed_count INTEGER := 0;
  v_reversed_amount BIGINT := 0;
  v_voided_count INTEGER := 0;
  v_voided_amount BIGINT := 0;
BEGIN
  v_user_id := public.assert_reversal_owner(
    'إلغاء الوردية وعكس جميع عملياتها'
  );
  PERFORM public.phase4_lock_full_shift_context_internal(p_shift_id);

  IF EXISTS (
    SELECT 1
    FROM public.sales_return_events return_event
    WHERE return_event.cash_shift_id = p_shift_id
      AND return_event.settlement_coordinator_version = 402
      AND return_event.settlement_status = 'settled'
      AND return_event.money_refund_amount_in_minor_units > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_SETTLED_RETURN_REFUND_DEPENDENCY: Reverse the settled Return through an approved future reversal contract before reversing its Shift.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_collection_operations op
    WHERE NOT op.is_reversed AND (op.cash_shift_id = p_shift_id OR EXISTS (
      SELECT 1 FROM public.customer_collection_order_payments link
      JOIN public.customer_payments payment ON payment.id = link.customer_payment_id
      WHERE link.operation_id = op.id AND payment.cash_shift_id = p_shift_id))
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_opening_payments link
    JOIN public.supplier_payments payment ON payment.id = link.supplier_payment_id
    WHERE link.cash_shift_id = p_shift_id AND NOT COALESCE(payment.is_reversed, false)
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_cheque_claim_payments link JOIN public.supplier_payments payment ON payment.id=link.supplier_payment_id
    WHERE link.cash_shift_id=p_shift_id AND NOT payment.is_reversed
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_SHIFT_HAS_UNIFIED_OPERATIONS: الوردية تحتوي تحصيلاً موحداً أو سداد رصيد مورد افتتاحي؛ اعكس هذه العمليات أولاً.';
  END IF;

  -- Withdrawals of this shift and returns booked in it: lock, then decide
  -- before any write.
  PERFORM 1 FROM public.owner_cash_withdrawals WHERE cash_shift_id = p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.owner_cash_withdrawal_reversals
  WHERE effective_shift_id = p_shift_id
     OR withdrawal_id IN (SELECT id FROM public.owner_cash_withdrawals WHERE cash_shift_id = p_shift_id)
  ORDER BY id FOR UPDATE;
  v_plan := public.owner_withdrawal_shift_reversal_plan_internal(p_shift_id);
  IF NOT (v_plan->>'canExecute')::BOOLEAN THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_plan->>'blockedReason';
  END IF;

  v_result := public._reverse_cash_shift_with_operations_before_phase42_refund_guard(
    p_shift_id, p_reason, p_idempotency_key
  );
  IF COALESCE((v_result->>'idempotent')::BOOLEAN, false) THEN
    -- The first execution already handled withdrawals in its transaction.
    RETURN v_result || jsonb_build_object('ownerWithdrawals', v_plan);
  END IF;
  v_reversal_id := (v_result->>'reversalId')::UUID;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_plan->'withdrawalsToReverse') LOOP
    INSERT INTO public.owner_cash_withdrawal_reversals (
      withdrawal_id, effective_shift_id, amount_in_minor_units, reason, reversed_by,
      via_shift_reversal_id, idempotency_key, request_fingerprint
    ) VALUES (
      (v_item->>'withdrawalId')::UUID, p_shift_id, (v_item->>'amountInMinorUnits')::BIGINT, v_reason, v_user_id,
      v_reversal_id, 'shift-reversal:' || v_reversal_id::TEXT || ':' || (v_item->>'withdrawalId'),
      md5('shift-reversal|' || v_reversal_id::TEXT || '|' || (v_item->>'withdrawalId'))
    );
    v_reversed_count := v_reversed_count + 1;
    v_reversed_amount := v_reversed_amount + (v_item->>'amountInMinorUnits')::BIGINT;
  END LOOP;

  PERFORM set_config('nawasrah.owner_withdrawal_void', 'on', true);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_plan->'returnsToVoid') LOOP
    UPDATE public.owner_cash_withdrawal_reversals
    SET voided_at = clock_timestamp(), voided_by = v_user_id, voided_by_shift_reversal_id = v_reversal_id
    WHERE id = (v_item->>'reversalId')::UUID AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_RETURN_CHANGED: تغيّر عكس سحب أثناء عكس الوردية؛ أعد المحاولة.';
    END IF;
    v_voided_count := v_voided_count + 1;
    v_voided_amount := v_voided_amount + (v_item->>'amountInMinorUnits')::BIGINT;
  END LOOP;
  PERFORM set_config('nawasrah.owner_withdrawal_void', 'off', true);

  IF v_reversed_count + v_voided_count > 0 THEN
    INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
    VALUES (v_user_id, 'REVERSE_OWNER_WITHDRAWALS_FOR_SHIFT', 'cash_shifts', p_shift_id,
      jsonb_build_object('reversal_id', v_reversal_id, 'reason', v_reason,
        'withdrawals_reversed', v_plan->'withdrawalsToReverse', 'returns_voided', v_plan->'returnsToVoid'));
  END IF;

  RETURN v_result || jsonb_build_object('ownerWithdrawals', jsonb_build_object(
    'withdrawalsReversedCount', v_reversed_count,
    'withdrawalsReversedInMinorUnits', v_reversed_amount,
    'returnsVoidedCount', v_voided_count,
    'returnsVoidedInMinorUnits', v_voided_amount));
END;
$$;
ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.cheque_integrity_issues_internal()
RETURNS TABLE(cheque_id UUID,issue TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT q.id,'status-event' FROM public.deferred_cheques q LEFT JOIN LATERAL(
    SELECT e.* FROM public.deferred_cheque_events e WHERE e.cheque_id=q.id ORDER BY version DESC LIMIT 1)e ON true
  WHERE e.id IS NULL OR e.version<>q.version OR e.resulting_status<>q.status
  UNION ALL
  SELECT q.id,'allocation-total' FROM public.deferred_cheques q WHERE
    (q.customer_id IS NOT NULL AND COALESCE((SELECT SUM(a.amount_in_minor_units) FROM public.deferred_cheque_allocations a WHERE a.cheque_id=q.id AND a.party_kind='customer'),0)<>q.amount_in_minor_units)
    OR(COALESCE(q.supplier_id,q.endorsed_supplier_id) IS NOT NULL AND COALESCE((SELECT SUM(a.amount_in_minor_units) FROM public.deferred_cheque_allocations a WHERE a.cheque_id=q.id AND a.party_kind='supplier'),0)<>q.amount_in_minor_units)
  UNION ALL
  SELECT q.id,'compensation-origin' FROM public.deferred_cheques q JOIN public.deferred_cheque_allocations a ON a.cheque_id=q.id
    LEFT JOIN public.cheque_compensation_claims c ON c.source_allocation_id=a.id
  WHERE (q.status IN ('returned','cancelled') AND(c.id IS NULL OR c.amount_in_minor_units<>a.amount_in_minor_units OR c.original_debt_at IS DISTINCT FROM a.original_debt_at
      OR c.party_id<>a.party_id OR c.party_kind<>a.party_kind OR c.claim_kind<>q.status))
    OR(q.status NOT IN ('returned','cancelled') AND c.id IS NOT NULL)
  UNION ALL
  SELECT c.cheque_id,'customer-claim-overpaid' FROM public.cheque_compensation_claims c
    JOIN public.cheque_customer_claim_positions_internal()p ON p.id=c.id WHERE p.outstanding<0
  UNION ALL
  SELECT c.cheque_id,'supplier-claim-overpaid' FROM public.cheque_compensation_claims c
    JOIN public.cheque_supplier_claim_positions_internal()p ON p.id=c.id WHERE p.outstanding<0
  UNION ALL
  SELECT c.cheque_id,'customer-claim-allocation' FROM public.customer_collection_cheque_allocations a
    JOIN public.cheque_compensation_claims c ON c.id=a.claim_id JOIN public.customer_collection_operations o ON o.id=a.operation_id
    WHERE c.party_kind<>'customer' OR c.party_id<>o.customer_id
  UNION ALL
  SELECT NULL::UUID,'customer-collection-parts' FROM public.customer_collection_operations o
    WHERE o.compensation_amount_in_minor_units<>COALESCE((SELECT SUM(a.amount_in_minor_units) FROM public.customer_collection_cheque_allocations a WHERE a.operation_id=o.id),0)
  UNION ALL
  SELECT c.cheque_id,'supplier-claim-payment' FROM public.supplier_cheque_claim_payments l
    JOIN public.cheque_compensation_claims c ON c.id=l.claim_id JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
    WHERE c.party_kind<>'supplier' OR c.party_id<>p.supplier_id OR p.payment_method<>l.payment_method OR p.cash_shift_id IS DISTINCT FROM l.cash_shift_id
      OR COALESCE((SELECT SUM(a.amount_in_minor_units) FROM public.supplier_cheque_claim_payments a WHERE a.supplier_payment_id=p.id),0)>p.amount_in_minor_units
  UNION ALL
  SELECT c.cheque_id,'supplier-claim-reversal' FROM public.supplier_cheque_claim_payments l
    JOIN public.cheque_compensation_claims c ON c.id=l.claim_id JOIN public.supplier_payments p ON p.id=l.supplier_payment_id
    LEFT JOIN public.supplier_cheque_claim_reversals r ON r.supplier_payment_id=p.id
    WHERE p.is_reversed IS DISTINCT FROM(r.id IS NOT NULL) OR(r.id IS NOT NULL AND(
      r.amount_in_minor_units<>p.amount_in_minor_units OR r.payment_method<>p.payment_method
      OR r.cash_shift_id IS DISTINCT FROM p.cash_shift_id OR r.requested_by IS DISTINCT FROM p.reversed_by
      OR r.reason IS DISTINCT FROM p.reversal_reason));
$$;
ALTER FUNCTION public.cheque_integrity_issues_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_integrity_issues_internal() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(p_observed_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth', 'cron', 'pg_temp'
AS $function$
DECLARE
  v_operation RECORD;
  v_return_count INTEGER := 0;
  v_replacement_count INTEGER := 0;
  v_evidence_issues INTEGER := 0;
  v_cached_evidence public.advanced_monitoring_checks%ROWTYPE;
  v_evidence_started TIMESTAMPTZ;
  v_evidence_canceled BOOLEAN := false;
  v_settings public.advanced_monitoring_settings%ROWTYPE;
  v_count INTEGER;
  v_total_integrity INTEGER := 0;
  v_previous_size BIGINT;
  v_current_size BIGINT;
  v_growth BIGINT := 0;
  v_connection_percent NUMERIC := 0;
  v_slow_count INTEGER := 0;
  v_auth_entries INTEGER := 0;
  v_status TEXT;
  v_result JSONB;
  v_entity UUID := '00000000-0000-0000-0000-000000000099'::UUID;
BEGIN
  IF p_observed_at IS NULL THEN RAISE EXCEPTION 'Monitoring observation time is required.'; END IF;
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','90s',true);
  SELECT * INTO STRICT v_settings FROM public.advanced_monitoring_settings WHERE id=true;
  UPDATE public.advanced_monitoring_metrics SET last_scan_started_at=p_observed_at,
    last_error_code=NULL,updated_at=p_observed_at WHERE id=true;

  SELECT count(*) INTO v_count FROM public.inventory_balances
  WHERE on_hand_quantity<0 OR reserved_quantity<0
    OR available_quantity<>on_hand_quantity-reserved_quantity;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:balances','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'سلامة أرصدة المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements
  WHERE balance_before+quantity<>balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-arithmetic','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'معادلة حركات المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH last_move AS (
    SELECT DISTINCT ON(product_id,warehouse_id) product_id,warehouse_id,balance_after
    FROM public.inventory_movements ORDER BY product_id,warehouse_id,created_at DESC,id DESC
  ) SELECT count(*) INTO v_count FROM last_move l
    LEFT JOIN public.inventory_balances b USING(product_id,warehouse_id)
    WHERE b.id IS NULL OR b.on_hand_quantity<>l.balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-ledger','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق رصيد آخر حركة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements m
  LEFT JOIN public.products p ON p.id=m.product_id
  LEFT JOIN public.warehouses w ON w.id=m.warehouse_id
  WHERE p.id IS NULL OR w.id IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:references','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'مراجع حركات المخزون',jsonb_build_object('orphanCount',v_count),p_observed_at);

  WITH reservation_sources AS (
    SELECT
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = o.id
      )
    GROUP BY o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      reservation.warehouse_id,
      reservation.product_id,
      SUM(reservation.reserved_quantity)::BIGINT AS qty
    FROM public.order_inventory_reservations reservation
    JOIN public.orders o ON o.id = reservation.order_id
    WHERE reservation.reservation_state = 'active'
      AND o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
    GROUP BY reservation.warehouse_id, reservation.product_id
  ), expected AS (
    SELECT warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM reservation_sources
    GROUP BY warehouse_id, product_id
  ), actual AS (
    SELECT warehouse_id,product_id,reserved_quantity::BIGINT qty FROM public.inventory_balances
    WHERE reserved_quantity<>0
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:reservations','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حجوزات طلبات الموقع',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected_sources AS (
    SELECT
      o.id,
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status IN ('completed','returned')
      AND COALESCE(oi.commercial_line_kind, 'base_unit') <> 'configurable_parcel'
    GROUP BY o.id, o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      o.id,
      o.warehouse_id,
      component.product_id,
      SUM(component.base_quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_parcel_instances instance ON instance.order_id = o.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE o.status IN ('completed','returned')
    GROUP BY o.id, o.warehouse_id, component.product_id
  ), expected AS (
    SELECT id, warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM expected_sources
    GROUP BY id, warehouse_id, product_id
  ), actual AS (
    SELECT movement.reference_id AS id,movement.warehouse_id,movement.product_id,
      (-sum(movement.quantity))::BIGINT qty
    FROM public.inventory_movements movement
    JOIN public.orders moved_order ON moved_order.id = movement.reference_id
      AND moved_order.status IN ('completed','returned')
    WHERE movement.movement_type='sales_deduction'
      AND movement.reference_type IN ('order','pos_sale','customer_order')
    GROUP BY movement.reference_id,movement.warehouse_id,movement.product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:stock-deductions','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'خصم مخزون الطلبات المكتملة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Reconcile the net stock effect for the complete supplier-receipt lifecycle.
  -- A cancelled receipt intentionally keeps its original purchase movement and
  -- appends an exact return_out reversal under supplier_receipt_cancellation.
  WITH expected AS (
    SELECT
      sr.id,
      sr.warehouse_id,
      sri.product_id,
      CASE
        WHEN sr.status = 'completed' THEN sum(sri.total_base_units)::BIGINT
        WHEN sr.status = 'cancelled' THEN 0::BIGINT
      END AS qty
    FROM public.supplier_receipts sr
    JOIN public.supplier_receipt_items sri ON sri.supplier_receipt_id = sr.id
    WHERE sr.status IN ('completed', 'cancelled')
    GROUP BY sr.id, sr.status, sr.warehouse_id, sri.product_id
  ), actual AS (
    SELECT
      reference_id AS id,
      warehouse_id,
      product_id,
      sum(quantity)::BIGINT AS qty
    FROM public.inventory_movements
    WHERE
      (reference_type = 'supplier_receipt' AND movement_type = 'purchase_receipt')
      OR
      (reference_type = 'supplier_receipt_cancellation' AND movement_type = 'return_out')
    GROUP BY reference_id, warehouse_id, product_id
  )
  SELECT count(*) INTO v_count
  FROM expected e
  FULL JOIN actual a USING(id, warehouse_id, product_id)
  WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:receiving','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حركات استلام الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count
  FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id = item.order_id
  LEFT JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE CASE
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
      AND customer_order.status NOT IN ('completed','returned')
    THEN customer_order.cost_finalized_at IS NOT NULL
      OR item.cost_finalized_at IS NOT NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL
      OR item.cogs_in_minor_units <> 0
      OR item.profit_in_minor_units <> 0
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
    THEN customer_order.cost_finalized_at IS NULL
      OR item.cost_finalized_at IS NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NULL
      OR (
        item.commercial_line_kind = 'configurable_parcel'
        AND (
          item.cogs_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.cogs_snapshot_in_minor_units), 0)::BIGINT
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR item.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
              AND (
                instance.cost_finalized_at IS NULL
                OR instance.exact_cogs_snapshot_in_minor_units IS NULL
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM
                  ROUND(instance.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.cogs_snapshot_in_minor_units), 0)::BIGINT
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR instance.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                    AND (
                      component.cost_finalized_at IS NULL
                      OR component.exact_cogs_snapshot_in_minor_units IS NULL
                    )
                )
              )
          )
        )
      )
      OR (
        item.commercial_line_kind <> 'configurable_parcel'
        AND item.cogs_in_minor_units IS DISTINCT FROM
          ROUND(item.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
      )
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    WHEN operation.operation_type = 'phase3_pos_sale_v1'
    THEN item.cogs_in_minor_units < 0
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    ELSE item.cogs_in_minor_units <> item.unit_cost_in_minor_units * item.quantity
      OR item.profit_in_minor_units <> item.line_total_in_minor_units - item.cogs_in_minor_units
  END;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:cogs-profit','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق تكلفة وربح بنود الطلب',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.customer_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.supplier_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.operational_expenses WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
  ) x;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:reversals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'اكتمال بيانات العكوسات المالية',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Independent committed evidence, not mutable PO totals or supplier balance.
  SELECT COUNT(*) INTO v_count FROM public.suppliers supplier
  JOIN public.phase133_supplier_balance_evidence_internal() evidence ON evidence.supplier_id=supplier.id
  WHERE supplier.current_balance_in_minor_units IS DISTINCT FROM evidence.balance;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:supplier-balances','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Owner withdrawals: amounts/branches/links consistent with their shifts and
  -- shift reversals, and every operation has its audit evidence.
  SELECT count(*) INTO v_count FROM public.owner_withdrawal_integrity_issues_internal();
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:owner-withdrawals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق سحوبات المالك وعكوسها مع الورديات',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cheque_integrity_issues_internal();
  v_total_integrity:=v_total_integrity+v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:deferred-cheques','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق الشيكات والقيود التعويضية والتحصيل',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE (status<>'open' AND expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units-
    public.owner_withdrawal_frozen_shift_effect_internal(id)))
    OR (status='closed' AND cash_discrepancy_in_minor_units<>
      actual_cash_in_minor_units-expected_cash_in_minor_units)
    OR (closing_report_snapshot IS NOT NULL AND
      (closing_report_snapshotted_at IS NULL OR closing_report_snapshot_version<>1));
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:closing','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق إغلاق الوردية وCash/CliQ',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE status='closed' AND closed_at>=v_settings.monitoring_activated_at
    AND closing_report_snapshot IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:snapshot','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'وجود لقطة إغلاق للورديات الجديدة',jsonb_build_object('missingCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.automation_event_deliveries d
  LEFT JOIN public.automation_events e ON e.id=d.event_id
  WHERE e.id IS NULL OR (d.status='processing' AND d.lease_expires_at<=p_observed_at)
    OR d.status='dead_letter' OR (d.status<>'delivered' AND d.attempt_count>=10);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:automation:outbox','automation','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'سلامة Business automation outbox',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT round(100.0*count(*)/GREATEST(current_setting('max_connections')::INTEGER,1),2)
    INTO v_connection_percent FROM pg_stat_activity;
  v_status := CASE WHEN v_connection_percent>=v_settings.connection_critical_percent THEN 'critical'
    WHEN v_connection_percent>=v_settings.connection_warning_percent THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:connections','database','database',
    v_status,'high',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'استخدام اتصالات قاعدة البيانات',jsonb_build_object('usedPercent',v_connection_percent),p_observed_at);

  SELECT count(*) INTO v_slow_count FROM extensions.pg_stat_statements
  WHERE calls>=v_settings.slow_rpc_min_calls
    AND query ~ '"public"\."[a-zA-Z0-9_]+"'
    AND (mean_exec_time>=v_settings.slow_rpc_mean_ms OR max_exec_time>=v_settings.slow_rpc_max_ms);
  PERFORM public._set_advanced_monitoring_check('performance:database:rpcs','performance','database',
    CASE WHEN v_slow_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_slow_count,
    'أداء RPCs العامة',jsonb_build_object('slowFunctionCount',v_slow_count,
      'meanThresholdMs',v_settings.slow_rpc_mean_ms,'maxThresholdMs',v_settings.slow_rpc_max_ms),p_observed_at);

  PERFORM public._set_advanced_monitoring_check('performance:database:query-errors','performance','database',
    'unknown','medium',0,'معدل أخطاء الاستعلامات غير متاح من telemetry الحالية',
    jsonb_build_object('reason','no-safe-error-rate-source'),p_observed_at);

  SELECT pg_database_size(current_database()) INTO v_current_size;
  SELECT last_database_size_bytes INTO v_previous_size FROM public.advanced_monitoring_metrics WHERE id=true;
  v_growth := GREATEST(v_current_size-COALESCE(v_previous_size,v_current_size),0);
  v_status := CASE WHEN v_previous_size IS NOT NULL
    AND v_growth>=v_settings.database_growth_min_bytes
    AND (100.0*v_growth/GREATEST(v_previous_size,1))>=v_settings.database_growth_warning_percent
    THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:growth','performance','database',
    v_status,'medium',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'نمو حجم قاعدة البيانات',jsonb_build_object('databaseBytes',v_current_size,'growthBytes',v_growth),p_observed_at);

  SELECT count(*) INTO v_count FROM (VALUES
    ('expire-stale-new-website-orders'),('cleanup-guest-order-gateway-requests'),
    ('scan-core-business-alerts'),('scan-business-summaries'),('run-advanced-monitoring')
  ) expected(jobname) LEFT JOIN cron.job j USING(jobname)
  WHERE j.jobid IS NULL OR NOT j.active;
  v_count := v_count+(SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname IN ('expire-stale-new-website-orders','cleanup-guest-order-gateway-requests','scan-core-business-alerts','scan-business-summaries')
      AND d.start_time>=p_observed_at-interval '30 minutes' AND d.status<>'succeeded');
  PERFORM public._set_advanced_monitoring_check('database:cron:health','database','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'حالة مهام Supabase cron',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND decision='rate_limited';
  v_count := CASE WHEN v_count>=v_settings.gateway_rate_limit_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:rate-limit','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_count,
    'سلوك Rate Limit لبوابة الطلبات',jsonb_build_object('limitedRequestCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND outcome='gateway_error';
  v_count := CASE WHEN v_count>=v_settings.gateway_error_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:errors','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'high',v_count,
    'أخطاء بوابة الطلبات',jsonb_build_object('gatewayErrorCount',v_count),p_observed_at);

  SELECT count(*) INTO v_auth_entries FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes';
  SELECT count(*) INTO v_count FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes'
    AND payload::TEXT ~* 'error|failed|forbidden|unauthorized';
  PERFORM public._set_advanced_monitoring_check('security:auth:audit','security','database',
    CASE WHEN v_auth_entries=0 THEN 'unknown' WHEN v_count>=5 THEN 'warning' ELSE 'healthy' END,
    'medium',CASE WHEN v_count>=5 THEN v_count ELSE 0 END,
    'مؤشرات Auth audit المخزنة',jsonb_build_object('recentEntryCount',v_auth_entries,
      'anomalyCount',CASE WHEN v_count>=5 THEN v_count ELSE 0 END),p_observed_at);

  SELECT count(*) INTO v_count FROM public.advanced_monitoring_runtime_incidents
  WHERE resolved_at IS NULL AND last_seen_at>=p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);
  PERFORM public._set_advanced_monitoring_check('runtime:admin:errors','runtime','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'أخطاء تشغيل Admin الحرجة',jsonb_build_object('activeFingerprintCount',v_count),p_observed_at);
  UPDATE public.advanced_monitoring_runtime_incidents SET resolved_at=p_observed_at,updated_at=p_observed_at
  WHERE resolved_at IS NULL AND last_seen_at<p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);

  -- Six-hour cadence: never refresh checked_at while reusing the persisted result.
  -- The metrics UPDATE above serializes concurrent monitoring cycles.
  SELECT * INTO v_cached_evidence FROM public.advanced_monitoring_checks
  WHERE check_key='integrity:aftercare:durable-evidence';
  IF FOUND AND v_cached_evidence.checked_at<=p_observed_at
    AND v_cached_evidence.checked_at>p_observed_at-INTERVAL '6 hours' THEN
    v_evidence_issues:=v_cached_evidence.issue_count;
  ELSE
  v_evidence_started:=clock_timestamp();
  BEGIN
  FOR v_operation IN
    SELECT e.operation_id FROM public.sales_return_events e
    JOIN public.orders o ON o.id=e.order_id
    JOIN public.business_operations creation ON creation.id=o.operation_id
    WHERE e.settlement_status='settled' AND e.contract_version=401
      AND creation.operation_type IN ('phase3_pos_sale_v1','phase3_customer_reservation_v1')
      AND e.settled_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_return_count := v_return_count + 1;
    BEGIN
      PERFORM public.phase42_assert_operational_return_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN query_canceled THEN RAISE;
    WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  FOR v_operation IN
    SELECT operation_id FROM public.sales_replacement_events
    WHERE issuance_status='issued' AND issued_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_replacement_count := v_replacement_count + 1;
    BEGIN
      PERFORM public.phase43_assert_operational_replacement_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN query_canceled THEN RAISE;
    WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  EXCEPTION WHEN query_canceled THEN
    v_evidence_canceled:=true;
    v_evidence_issues:=v_evidence_issues+1;
  END;
  PERFORM public._set_advanced_monitoring_check('integrity:aftercare:durable-evidence','accounting','database',
    CASE WHEN v_evidence_issues=0 THEN 'healthy' ELSE 'critical' END,'critical',v_evidence_issues,
    'سلامة أدلة المرتجعات والاستبدالات لآخر 7 أيام',
    jsonb_build_object('windowDays',7,'returnsChecked',v_return_count,
      'replacementsChecked',v_replacement_count,'queryCanceled',v_evidence_canceled,
      'durationMs',ROUND(EXTRACT(EPOCH FROM clock_timestamp()-v_evidence_started)*1000,3)),p_observed_at);
  END IF;
  v_total_integrity := v_total_integrity + v_evidence_issues;

  PERFORM public._transition_business_alert_incident(
    'business-integrity:system','business_integrity_warning',v_entity,
    v_total_integrity>0,p_observed_at,
    jsonb_build_object('issueCount',v_total_integrity,
      'message','توجد مشكلة اتساق تحتاج مراجعة الإدارة التقنية.','dashboard','monitoring'),true);

  UPDATE public.advanced_monitoring_metrics SET
    last_scan_completed_at=p_observed_at,last_database_size_bytes=v_current_size,
    last_database_size_observed_at=p_observed_at,last_error_code=NULL,
    updated_at=p_observed_at WHERE id=true;

  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,
    'checkCount',count(*),'openIssueCount',count(*) FILTER(WHERE status IN ('warning','critical')),
    'integrityIssueCount',v_total_integrity) INTO v_result
  FROM public.advanced_monitoring_checks WHERE source='database';
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.advanced_monitoring_metrics SET last_error_code=COALESCE(SQLSTATE,'UNKNOWN'),
    updated_at=NOW() WHERE id=true;
  RAISE;
END;
$function$;

ALTER FUNCTION public.run_advanced_monitoring_checks(TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.run_advanced_monitoring_checks(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

COMMIT;
