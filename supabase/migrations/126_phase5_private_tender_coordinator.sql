BEGIN;

-- Slice 3 is private and INACTIVE. These facts do not update public payment
-- flags, amount_paid, drawer projections, reports, or closed Shift snapshots.
-- Public activation requires a separate atomic writer/reader/guard cutover.
CREATE TABLE phase5_private.reversal_coordinator_guards (
  operation_id UUID PRIMARY KEY,
  transaction_id XID8 NOT NULL
);

CREATE TABLE phase5_private.reversal_tender_movements (
  operation_id UUID PRIMARY KEY REFERENCES phase5_private.financial_operation_events(id),
  reversal_event_id UUID NOT NULL UNIQUE REFERENCES phase5_private.payment_reversal_events(id),
  original_payment_id UUID NOT NULL UNIQUE REFERENCES public.customer_payments(id),
  order_id UUID NOT NULL REFERENCES public.orders(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  actual_tender TEXT NOT NULL CHECK (actual_tender IN ('cash', 'cliq')),
  tender_reference TEXT,
  actual_cash_shift_id UUID REFERENCES public.cash_shifts(id),
  source_recorded_at TIMESTAMPTZ NOT NULL,
  evidence_recorded_at TIMESTAMPTZ NOT NULL,
  reversal_executed_at TIMESTAMPTZ NOT NULL,
  CHECK ((actual_tender = 'cash' AND actual_cash_shift_id IS NOT NULL)
    OR (actual_tender = 'cliq' AND actual_cash_shift_id IS NULL
      AND NULLIF(BTRIM(tender_reference), '') IS NOT NULL))
);

CREATE TABLE phase5_private.reversal_coordinator_completions (
  operation_id UUID PRIMARY KEY REFERENCES phase5_private.financial_operation_events(id),
  coordinator_version INTEGER NOT NULL CHECK (coordinator_version = 503),
  sources_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(sources_snapshot) = 'array'),
  prior_reversal_operation_ids UUID[] NOT NULL,
  settled_return_operation_ids UUID[] NOT NULL,
  position_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(position_snapshot) = 'object'),
  result_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(result_snapshot) = 'object'),
  reversal_executed_at TIMESTAMPTZ NOT NULL
);

CREATE FUNCTION phase5_private.authorize_coordinator_actor_v1(
  p_actor_id UUID, p_collection_only BOOLEAN DEFAULT FALSE
)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE p.id = p_actor_id AND p.is_active
      AND (r.code IN ('owner', 'admin', 'manager', 'accountant')
        OR (p_collection_only IS TRUE AND r.code = 'sales'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PHASE5_COORDINATOR_ACTOR_UNAUTHORIZED';
  END IF;
END;
$$;

-- One independent, typed source. A completion-linked partial payment is
-- represented only as customer_payment, never counted a second time here.
CREATE FUNCTION phase5_private.collection_source_v1(
  p_order_id UUID, p_kind TEXT, p_source_id UUID
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_op public.business_operations%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_amount BIGINT;
  v_method TEXT;
  v_shift UUID;
  v_at TIMESTAMPTZ;
  v_linked_payment public.customer_payments%ROWTYPE;
  v_remaining BIGINT;
BEGIN
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = p_order_id;
  IF p_kind = 'customer_payment' THEN
    SELECT * INTO STRICT v_payment FROM public.customer_payments
    WHERE id = p_source_id AND order_id = p_order_id;
    SELECT * INTO STRICT v_collection FROM phase5_private.collection_events
    WHERE original_payment_id = p_source_id AND order_id = p_order_id;
    PERFORM phase5_private.validate_customer_collection_operation_v1(v_collection.financial_operation_id);
    IF v_payment.customer_id IS DISTINCT FROM v_order.customer_id
      OR v_payment.created_at IS NULL OR v_payment.amount_in_minor_units <= 0
      OR v_payment.payment_method IS NULL OR v_payment.payment_method NOT IN ('cash', 'cliq')
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_SOURCE_POPULATION_INVALID'; END IF;
    v_amount := v_payment.amount_in_minor_units;
    v_method := v_payment.payment_method;
    v_shift := v_payment.cash_shift_id;
    v_at := v_payment.created_at;
  ELSIF p_kind IN ('modern_pos_initial', 'modern_customer_initial') THEN
    SELECT * INTO STRICT v_op FROM public.business_operations WHERE id = p_source_id;
    IF v_op.completed_at IS NULL OR v_op.request_identity_version IS DISTINCT FROM 301
      OR v_op.actor_scope_type IS DISTINCT FROM 'erp_user'
      OR v_op.initiated_by IS NULL
      OR v_op.actor_scope_hash IS DISTINCT FROM public.phase3_actor_scope_hash_internal(
        'erp_user', v_op.initiated_by, NULL, NULL)
      OR v_op.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(
        v_op.request_identity_snapshot)
      OR v_op.result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
    IF p_kind = 'modern_pos_initial' THEN
      IF v_op.operation_type IS DISTINCT FROM 'phase3_pos_sale_v1'
        OR v_order.operation_id IS DISTINCT FROM v_op.id
        OR v_op.request_identity_snapshot->>'contract_version' IS DISTINCT FROM 'phase3-sale-v1'
        OR v_op.result_snapshot->>'orderId' IS DISTINCT FROM p_order_id::TEXT
        OR v_op.result_snapshot->>'operationId' IS DISTINCT FROM v_op.id::TEXT
        OR (v_op.request_identity_snapshot->>'customer_id')::UUID IS DISTINCT FROM v_order.customer_id
        OR (v_op.request_identity_snapshot->>'branch_id')::UUID IS DISTINCT FROM v_order.branch_id
        OR (v_op.result_snapshot->>'totalInMinorUnits')::BIGINT IS DISTINCT FROM v_order.total_in_minor_units
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
      v_amount := (v_op.result_snapshot->>'amountPaidInMinorUnits')::BIGINT;
      v_method := v_op.result_snapshot->>'paymentMethod';
      v_shift := (v_op.result_snapshot->>'cashShiftId')::UUID;
      IF v_method IS DISTINCT FROM v_op.request_identity_snapshot->>'payment_method'
        OR v_amount IS DISTINCT FROM (CASE WHEN v_method = 'debt' THEN 0 ELSE v_order.total_in_minor_units END)
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
    ELSE
      IF v_op.operation_type IS DISTINCT FROM 'phase3_customer_completion_v1'
        OR NOT EXISTS (SELECT 1 FROM public.business_operations c WHERE c.id = v_order.operation_id
          AND c.operation_type = 'phase3_customer_reservation_v1' AND c.completed_at IS NOT NULL)
        OR v_op.request_identity_snapshot->>'contract_version' IS DISTINCT FROM 'phase3-customer-completion-v1'
        OR v_op.request_identity_snapshot->>'order_id' IS DISTINCT FROM p_order_id::TEXT
        OR v_op.result_snapshot->>'order_id' IS DISTINCT FROM p_order_id::TEXT
        OR v_op.result_snapshot->>'operation_id' IS DISTINCT FROM v_op.id::TEXT
        OR v_op.completed_at IS DISTINCT FROM v_order.cost_finalized_at
        OR (v_op.result_snapshot->>'total_in_minor_units')::BIGINT IS DISTINCT FROM v_order.total_in_minor_units
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
      v_amount := (v_op.result_snapshot->>'amount_paid_in_minor_units')::BIGINT;
      v_method := v_op.result_snapshot->>'payment_method';
      v_shift := (v_op.result_snapshot->>'cash_shift_id')::UUID;
      v_remaining := (v_op.result_snapshot->>'remaining_in_minor_units')::BIGINT;
      IF v_amount IS NULL OR v_amount < 0 OR v_amount > v_order.total_in_minor_units
        OR v_remaining IS DISTINCT FROM v_order.total_in_minor_units - v_amount
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
      IF v_remaining > 0 THEN
        IF v_method IS DISTINCT FROM 'debt' THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_INVALID';
        END IF;
        IF v_amount > 0 THEN
          SELECT * INTO STRICT v_linked_payment FROM public.customer_payments
            WHERE payment_number = v_op.result_snapshot->>'customer_payment_number';
          IF v_linked_payment.order_id IS DISTINCT FROM p_order_id
            OR v_linked_payment.customer_id IS DISTINCT FROM v_order.customer_id
            OR v_linked_payment.amount_in_minor_units IS DISTINCT FROM v_amount
            OR v_linked_payment.created_by IS DISTINCT FROM v_op.initiated_by
            OR v_linked_payment.payment_method IS DISTINCT FROM v_op.request_identity_snapshot->>'payment_method'
            OR v_linked_payment.cash_shift_id IS DISTINCT FROM v_shift
            OR v_linked_payment.reference_number IS DISTINCT FROM v_op.request_identity_snapshot->>'reference_number'
          THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_PAYMENT_INVALID'; END IF;
        ELSIF v_op.result_snapshot->>'customer_payment_number' IS NOT NULL THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_PAYMENT_INVALID';
        END IF;
        v_amount := 0; -- Its linked real payment is the sole financial source.
      ELSIF v_op.result_snapshot->>'customer_payment_number' IS NOT NULL
        OR v_method IS DISTINCT FROM v_op.request_identity_snapshot->>'payment_method' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID';
      END IF;
    END IF;
    v_at := v_op.completed_at;
    IF v_amount IS NULL OR v_amount < 0 OR v_method IS NULL
      OR v_method NOT IN ('cash', 'cliq', 'debt')
      OR (v_amount > 0 AND (v_method = 'debt' OR v_shift IS NULL))
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_MODERN_COLLECTION_ANCHOR_INVALID'; END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_SOURCE_KIND_UNSUPPORTED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('kind', p_kind, 'sourceId', p_source_id, 'orderId', p_order_id,
    'amountInMinorUnits', v_amount, 'tenderMethod', v_method, 'originalCashShiftId', v_shift,
    'sourceRecordedAt', TO_CHAR(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_SOURCE_POPULATION_INCOMPLETE';
END;
$$;

CREATE FUNCTION phase5_private.discover_collection_population_v1(p_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_creation public.business_operations%ROWTYPE;
  v_completion public.business_operations%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_sources JSONB := '[]'::JSONB;
  v_linked_number TEXT;
  v_paid BIGINT;
BEGIN
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = p_order_id;
  SELECT * INTO STRICT v_creation FROM public.business_operations WHERE id = v_order.operation_id;
  IF v_order.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COMPLETED_MODERN_SALE_REQUIRED';
  END IF;
  IF v_creation.operation_type = 'phase3_pos_sale_v1' THEN
    v_sources := JSONB_BUILD_ARRAY(phase5_private.collection_source_v1(
      p_order_id, 'modern_pos_initial', v_creation.id));
  ELSIF v_creation.operation_type = 'phase3_customer_reservation_v1' THEN
    SELECT * INTO STRICT v_completion FROM public.business_operations
    WHERE operation_type = 'phase3_customer_completion_v1'
      AND request_identity_snapshot->>'order_id' = p_order_id::TEXT
      AND completed_at = v_order.cost_finalized_at;
    v_linked_number := v_completion.result_snapshot->>'customer_payment_number';
    v_paid := (v_completion.result_snapshot->>'amount_paid_in_minor_units')::BIGINT;
    IF v_linked_number IS NULL AND v_paid = v_order.total_in_minor_units THEN
      v_sources := JSONB_BUILD_ARRAY(phase5_private.collection_source_v1(
        p_order_id, 'modern_customer_initial', v_completion.id));
    ELSE
      -- Partial Customer completion is counted ONCE via its exact real payment.
      IF v_completion.completed_at IS NULL OR v_completion.request_identity_version IS DISTINCT FROM 301
        OR v_completion.actor_scope_type IS DISTINCT FROM 'erp_user'
        OR v_completion.actor_scope_hash IS DISTINCT FROM public.phase3_actor_scope_hash_internal(
          'erp_user', v_completion.initiated_by, NULL, NULL)
        OR v_completion.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(
          v_completion.request_identity_snapshot)
        OR v_completion.request_identity_snapshot->>'contract_version' IS DISTINCT FROM 'phase3-customer-completion-v1'
        OR v_completion.result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
        OR v_completion.result_snapshot->>'order_id' IS DISTINCT FROM p_order_id::TEXT
        OR v_completion.result_snapshot->>'operation_id' IS DISTINCT FROM v_completion.id::TEXT
        OR v_paid IS NULL OR v_paid < 0 OR v_paid >= v_order.total_in_minor_units
        OR (v_completion.result_snapshot->>'remaining_in_minor_units')::BIGINT
          IS DISTINCT FROM v_order.total_in_minor_units - v_paid
        OR v_completion.result_snapshot->>'payment_method' IS DISTINCT FROM 'debt'
      THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_INVALID'; END IF;
      IF v_paid > 0 THEN
        SELECT * INTO STRICT v_payment FROM public.customer_payments WHERE payment_number = v_linked_number;
        IF v_payment.order_id IS DISTINCT FROM p_order_id
          OR v_payment.customer_id IS DISTINCT FROM v_order.customer_id
          OR v_payment.amount_in_minor_units IS DISTINCT FROM v_paid
          OR v_payment.created_by IS DISTINCT FROM v_completion.initiated_by
          OR v_payment.payment_method IS DISTINCT FROM v_completion.request_identity_snapshot->>'payment_method'
          OR v_payment.cash_shift_id IS DISTINCT FROM (v_completion.result_snapshot->>'cash_shift_id')::UUID
          OR v_payment.reference_number IS DISTINCT FROM v_completion.request_identity_snapshot->>'reference_number'
        THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_PAYMENT_INVALID'; END IF;
      ELSIF v_linked_number IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PARTIAL_COMPLETION_PAYMENT_INVALID';
      END IF;
    END IF;
  ELSE RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_LEGACY_SOURCE_UNSUPPORTED'; END IF;
  IF v_creation.operation_type = 'phase3_customer_reservation_v1'
    AND NOT EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_sources) s WHERE s->>'kind' = 'modern_customer_initial') THEN
    v_sources := JSONB_BUILD_ARRAY(phase5_private.collection_source_v1(
      p_order_id, 'modern_customer_initial', v_completion.id));
  END IF;
  FOR v_payment IN SELECT * FROM public.customer_payments WHERE order_id = p_order_id ORDER BY id LOOP
    IF v_payment.is_reversed THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_LEGACY_REVERSAL_CONFLICT';
    END IF;
    v_sources := v_sources || JSONB_BUILD_ARRAY(phase5_private.collection_source_v1(
      p_order_id, 'customer_payment', v_payment.id));
  END LOOP;
  IF EXISTS (SELECT 1 FROM phase5_private.collection_events c
    LEFT JOIN public.customer_payments p ON p.id = c.original_payment_id AND p.order_id = p_order_id
    WHERE c.order_id = p_order_id AND p.id IS NULL)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_SOURCE_POPULATION_INVALID'; END IF;
  RETURN v_sources;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_SOURCE_POPULATION_INCOMPLETE';
END;
$$;

-- Full JSON tuple discovery makes relationship changes observable; row locks
-- are acquired before evidence INSERTs, never discovered from inserted FKs.
CREATE FUNCTION phase5_private.coordinator_lock_plan_v1(p_order_id UUID, p_cash_outflow BOOLEAN)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  SELECT JSONB_BUILD_OBJECT('order', TO_JSONB(o),
    'currentShift', CASE WHEN p_cash_outflow THEN (SELECT TO_JSONB(s) FROM public.cash_shifts s
      WHERE s.branch_id = o.branch_id AND s.status = 'open' ORDER BY s.id LIMIT 1) END,
    'payments', COALESCE((SELECT JSONB_AGG(TO_JSONB(p) ORDER BY p.id)
      FROM public.customer_payments p WHERE p.order_id = o.id), '[]'::JSONB),
    'collections', COALESCE((SELECT JSONB_AGG(TO_JSONB(c) ORDER BY c.id)
      FROM phase5_private.collection_events c WHERE c.order_id = o.id), '[]'::JSONB))
  FROM public.orders o WHERE o.id = p_order_id;
$$;

CREATE FUNCTION phase5_private.lock_coordinator_context_v1(
  p_actor_id UUID, p_order_id UUID, p_cash_outflow BOOLEAN, p_anchor_payment_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_plan JSONB;
  v_shift UUID;
  v_historical UUID;
  v_id UUID;
  v_actor UUID;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(p_actor_id, p_anchor_payment_id IS NOT NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('phase4-order|' || p_order_id::TEXT, 0));
  v_plan := phase5_private.coordinator_lock_plan_v1(p_order_id, p_cash_outflow);
  IF v_plan IS NULL THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PHASE5_ORDER_REQUIRED'; END IF;
  v_shift := (v_plan->'currentShift'->>'id')::UUID;
  IF p_cash_outflow AND v_shift IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_CASH_REVERSAL_SHIFT_REQUIRED';
  END IF;
  IF p_anchor_payment_id IS NOT NULL THEN
    SELECT (p->>'cash_shift_id')::UUID INTO v_historical
    FROM JSONB_ARRAY_ELEMENTS(v_plan->'payments') p WHERE p->>'id' = p_anchor_payment_id::TEXT;
  END IF;
  FOR v_id IN SELECT DISTINCT id FROM UNNEST(ARRAY[v_shift, v_historical]) id
    WHERE id IS NOT NULL ORDER BY id LOOP
    IF v_id = v_shift THEN
      PERFORM 1 FROM public.cash_shifts WHERE id = v_id FOR UPDATE NOWAIT;
    ELSE PERFORM 1 FROM public.cash_shifts WHERE id = v_id FOR KEY SHARE NOWAIT; END IF;
  END LOOP;
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE NOWAIT;
  FOR v_id IN SELECT (p->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(v_plan->'payments') p ORDER BY 1 LOOP
    PERFORM 1 FROM public.customer_payments WHERE id = v_id FOR UPDATE NOWAIT;
  END LOOP;
  FOR v_id IN SELECT (c->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(v_plan->'collections') c ORDER BY 1 LOOP
    PERFORM 1 FROM phase5_private.collection_events WHERE id = v_id FOR KEY SHARE NOWAIT;
  END LOOP;
  -- All profile/customer FK parents used by either the anchor or reversal.
  FOR v_actor IN SELECT DISTINCT id FROM (
    SELECT p_actor_id AS id UNION ALL
    SELECT (p->>'created_by')::UUID FROM JSONB_ARRAY_ELEMENTS(v_plan->'payments') p
  ) actors WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM public.profiles WHERE id = v_actor FOR KEY SHARE NOWAIT;
  END LOOP;
  PERFORM 1 FROM public.customers WHERE id = (v_plan->'order'->>'customer_id')::UUID FOR KEY SHARE NOWAIT;
  IF v_plan IS DISTINCT FROM phase5_private.coordinator_lock_plan_v1(p_order_id, p_cash_outflow) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PHASE5_LOCK_PLAN_CHANGED_RETRY';
  END IF;
  PERFORM phase5_private.authorize_coordinator_actor_v1(p_actor_id, p_anchor_payment_id IS NOT NULL);
  RETURN v_shift;
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PHASE5_LOCK_CONTENTION_RETRY';
END;
$$;

-- Source anchoring is not a new inflow. Unlike the closed Slice-2 path, this
-- additive entrypoint plans historical FK Shift locks before locking Order.
CREATE FUNCTION phase5_private.anchor_existing_collection_v1(
  p_actor_id UUID, p_order_id UUID, p_payment_id UUID, p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_p public.customer_payments%ROWTYPE;
  v_existing phase5_private.financial_operation_events%ROWTYPE;
  v_request JSONB;
  v_result JSONB;
  v_fp TEXT;
  v_op UUID := gen_random_uuid();
  v_collection UUID := gen_random_uuid();
  v_at TIMESTAMPTZ;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(p_actor_id, true);
  IF p_order_id IS NULL OR p_payment_id IS NULL OR p_key IS NULL
    OR p_key IS DISTINCT FROM BTRIM(p_key) OR CHAR_LENGTH(p_key) NOT BETWEEN 1 AND 255
  THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_COLLECTION_REQUEST_INVALID'; END IF;
  SELECT * INTO STRICT v_p FROM public.customer_payments WHERE id = p_payment_id AND order_id = p_order_id;
  IF v_p.created_by IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PHASE5_COLLECTION_ACTOR_SOURCE_UNAUTHORIZED';
  END IF;
  v_request := JSONB_BUILD_OBJECT('requestVersion', 'phase5-customer-collection-v1',
    'actorScopeType', 'erp_user', 'actorScopeId', p_actor_id, 'orderId', p_order_id,
    'originalPaymentId', p_payment_id, 'amountInMinorUnits', v_p.amount_in_minor_units,
    'tenderMethod', v_p.payment_method, 'tenderReference', v_p.reference_number);
  v_fp := UPPER(public.phase3_request_fingerprint_internal(v_request));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase5-idempotency|erp_user|' || p_actor_id::TEXT
    || '|customer_collection_v1|' || p_key, 0));
  SELECT * INTO v_existing FROM phase5_private.financial_operation_events WHERE actor_scope_id = p_actor_id
    AND actor_scope_type = 'erp_user' AND operation_type = 'customer_collection_v1' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_existing.request_identity_snapshot IS DISTINCT FROM v_request OR v_existing.request_fingerprint IS DISTINCT FROM v_fp
    THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN phase5_private.validate_customer_collection_operation_v1(v_existing.id);
  END IF;
  PERFORM phase5_private.lock_coordinator_context_v1(p_actor_id, p_order_id, false, p_payment_id);
  IF TO_JSONB(v_p) IS DISTINCT FROM (SELECT TO_JSONB(p) FROM public.customer_payments p WHERE id = p_payment_id)
    OR v_p.created_by IS DISTINCT FROM p_actor_id OR v_p.created_at IS NULL OR v_p.is_reversed
  THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PHASE5_COLLECTION_SOURCE_CHANGED_RETRY'; END IF;
  v_at := clock_timestamp();
  v_result := JSONB_BUILD_OBJECT('success', true, 'resultType', 'customer_collection_committed_v1',
    'operationId', v_op, 'collectionEventId', v_collection, 'originalPaymentId', v_p.id,
    'orderId', v_p.order_id, 'customerId', v_p.customer_id, 'amountInMinorUnits', v_p.amount_in_minor_units,
    'tenderMethod', v_p.payment_method, 'tenderReference', v_p.reference_number, 'cashShiftId', v_p.cash_shift_id,
    'operationEventAt', TO_CHAR(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO phase5_private.financial_operation_events VALUES (v_op, 'customer_collection_v1',
    'erp_user', p_actor_id, p_key, v_fp, v_request, 'customer_collection_committed_v1', v_result, v_at);
  INSERT INTO phase5_private.collection_events VALUES (v_collection, v_op, 'customer_collection_v1', v_at,
    v_p.id, v_p.order_id, v_p.customer_id, v_p.cash_shift_id, v_p.payment_method, v_p.amount_in_minor_units, v_p.reference_number);
  RETURN phase5_private.validate_customer_collection_operation_v1(v_op);
END;
$$;

-- Body defined after the shared validator below; PL/pgSQL resolves the call at
-- runtime. Replay validates referenced historical inputs, not today's capacity.
CREATE FUNCTION phase5_private.reversal_position_v1(
  p_order_id UUID, p_sources JSONB, p_prior UUID[], p_returns UUID[], p_payment_id UUID, p_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_source JSONB;
  v_id UUID;
  v_order public.orders%ROWTYPE;
  v_prior_event phase5_private.payment_reversal_events%ROWTYPE;
  v_return public.sales_return_events%ROWTYPE;
  v_collected BIGINT := 0;
  v_reversed BIGINT := 0;
  v_debt BIGINT := 0;
  v_refund BIGINT := 0;
  v_amount BIGINT;
  v_candidate BIGINT;
  v_delivery BIGINT;
  v_creation public.business_operations%ROWTYPE;
  v_root_id UUID;
  v_root_kind TEXT;
  v_expected_sources JSONB;
  v_actual_sources JSONB;
  v_expected_prior UUID[];
  v_expected_returns UUID[];
BEGIN
  SELECT * INTO STRICT v_order FROM public.orders WHERE id = p_order_id;
  IF p_sources IS NULL OR JSONB_TYPEOF(p_sources) IS DISTINCT FROM 'array'
    OR p_prior IS NULL OR p_returns IS NULL OR p_at IS NULL
    OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_sources) s GROUP BY s->>'kind', s->>'sourceId' HAVING COUNT(*) <> 1)
    OR EXISTS (SELECT 1 FROM UNNEST(p_prior) id GROUP BY id HAVING COUNT(*) <> 1 OR id IS NULL)
    OR EXISTS (SELECT 1 FROM UNNEST(p_returns) id GROUP BY id HAVING COUNT(*) <> 1 OR id IS NULL)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_IDENTITY_INVALID'; END IF;
  -- Derive membership independently of the completion snapshot. Collection
  -- anchoring time defines when an original payment entered this private
  -- population; it is not a new economic inflow. Later anchors, reversals and
  -- Returns must not change an earlier committed operation's replay.
  SELECT * INTO STRICT v_creation FROM public.business_operations WHERE id = v_order.operation_id;
  IF v_creation.operation_type = 'phase3_pos_sale_v1' THEN
    v_root_id := v_creation.id;
    v_root_kind := 'modern_pos_initial';
  ELSIF v_creation.operation_type = 'phase3_customer_reservation_v1' THEN
    SELECT id INTO STRICT v_root_id FROM public.business_operations
      WHERE operation_type = 'phase3_customer_completion_v1'
        AND request_identity_snapshot->>'order_id' = p_order_id::TEXT
        AND completed_at = v_order.cost_finalized_at AND completed_at <= p_at;
    v_root_kind := 'modern_customer_initial';
  ELSE RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_MODERN_ROOT_REQUIRED'; END IF;
  IF v_creation.completed_at IS NULL OR v_creation.completed_at > p_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_SOURCE_INVALID';
  END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('kind', kind, 'sourceId', id) ORDER BY kind, id)
    INTO v_expected_sources FROM (
      SELECT v_root_kind AS kind, v_root_id AS id UNION ALL
      SELECT 'customer_payment', c.original_payment_id FROM phase5_private.collection_events c
        WHERE c.order_id = p_order_id AND c.operation_event_at <= p_at
    ) sources;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('kind', s->>'kind', 'sourceId', s->>'sourceId')
    ORDER BY s->>'kind', s->>'sourceId') INTO v_actual_sources FROM JSONB_ARRAY_ELEMENTS(p_sources) s;
  SELECT COALESCE(ARRAY_AGG(financial_operation_id ORDER BY financial_operation_id), ARRAY[]::UUID[])
    INTO v_expected_prior FROM phase5_private.payment_reversal_events
    WHERE order_id = p_order_id AND operation_event_at < p_at;
  SELECT COALESCE(ARRAY_AGG(operation_id ORDER BY operation_id), ARRAY[]::UUID[])
    INTO v_expected_returns FROM public.sales_return_events
    WHERE order_id = p_order_id AND contract_version = 401
      AND settlement_status = 'settled' AND settled_at <= p_at;
  IF v_actual_sources IS DISTINCT FROM v_expected_sources
    OR ARRAY(SELECT id FROM UNNEST(p_prior) id ORDER BY id) IS DISTINCT FROM v_expected_prior
    OR ARRAY(SELECT id FROM UNNEST(p_returns) id ORDER BY id) IS DISTINCT FROM v_expected_returns
    -- Equal-time unrelated reversals have no proven strict historical order.
    OR EXISTS (SELECT 1 FROM phase5_private.payment_reversal_events
      WHERE order_id = p_order_id AND operation_event_at = p_at AND original_payment_id <> p_payment_id)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_HISTORY_INCOMPLETE'; END IF;
  IF (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(p_sources) s
    WHERE s->>'kind' IN ('modern_pos_initial', 'modern_customer_initial')) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_MODERN_ROOT_REQUIRED';
  END IF;
  FOR v_source IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_sources) LOOP
    IF v_source IS DISTINCT FROM phase5_private.collection_source_v1(
      p_order_id, v_source->>'kind', (v_source->>'sourceId')::UUID)
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_SOURCE_INVALID'; END IF;
    v_collected := v_collected + (v_source->>'amountInMinorUnits')::BIGINT;
  END LOOP;
  FOR v_id IN SELECT * FROM UNNEST(p_prior) LOOP
    SELECT * INTO STRICT v_prior_event FROM phase5_private.payment_reversal_events
      WHERE financial_operation_id = v_id AND order_id = p_order_id AND operation_event_at < p_at;
    PERFORM phase5_private.validate_operational_reversal_v1(v_id);
    IF NOT EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_sources) s
      WHERE s->>'kind' = 'customer_payment' AND s->>'sourceId' = v_prior_event.original_payment_id::TEXT)
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_SOURCE_INVALID'; END IF;
    v_reversed := v_reversed + v_prior_event.reversed_amount_in_minor_units;
  END LOOP;
  FOR v_id IN SELECT * FROM UNNEST(p_returns) LOOP
    SELECT * INTO STRICT v_return FROM public.sales_return_events WHERE operation_id = v_id
      AND order_id = p_order_id AND contract_version = 401 AND settlement_status = 'settled';
    PERFORM public.phase42_assert_operational_return_evidence_internal(v_id, true);
    v_debt := v_debt + v_return.debt_reduction_amount_in_minor_units;
    v_refund := v_refund + v_return.money_refund_amount_in_minor_units;
  END LOOP;
  SELECT amount_in_minor_units INTO STRICT v_amount FROM public.customer_payments
    WHERE id = p_payment_id AND order_id = p_order_id;
  IF NOT EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_sources) s
    WHERE s->>'kind' = 'customer_payment' AND s->>'sourceId' = p_payment_id::TEXT)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_SOURCE_INVALID'; END IF;
  v_candidate := v_collected - v_reversed - v_amount;
  v_delivery := v_order.delivery_fee_in_minor_units - LEAST(v_order.delivery_fee_in_minor_units,
    GREATEST(v_order.total_in_minor_units - v_candidate - v_debt, 0));
  IF v_candidate < 0 OR v_candidate < v_refund + v_delivery THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_PAYMENT_REVERSAL_CAPACITY_EXCEEDED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('collectionCoverageBefore', v_collected - v_reversed,
    'candidateCoverage', v_candidate, 'settledDebtReduction', v_debt,
    'settledMoneyRefund', v_refund, 'collectedDelivery', v_delivery);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_POSITION_EVIDENCE_INVALID';
END;
$$;

CREATE FUNCTION phase5_private.validate_operational_reversal_v1(p_operation_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_base JSONB;
  v_op phase5_private.financial_operation_events%ROWTYPE;
  v_reversal phase5_private.payment_reversal_events%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_movement phase5_private.reversal_tender_movements%ROWTYPE;
  v_completion phase5_private.reversal_coordinator_completions%ROWTYPE;
  v_expected JSONB;
BEGIN
  v_base := phase5_private.validate_customer_payment_reversal_operation_v1(p_operation_id);
  SELECT * INTO STRICT v_op FROM phase5_private.financial_operation_events WHERE id = p_operation_id;
  SELECT * INTO STRICT v_reversal FROM phase5_private.payment_reversal_events WHERE financial_operation_id = p_operation_id;
  SELECT * INTO STRICT v_collection FROM phase5_private.collection_events WHERE id = v_reversal.original_collection_event_id;
  SELECT * INTO STRICT v_payment FROM public.customer_payments WHERE id = v_reversal.original_payment_id;
  SELECT * INTO STRICT v_movement FROM phase5_private.reversal_tender_movements WHERE operation_id = p_operation_id;
  SELECT * INTO STRICT v_completion FROM phase5_private.reversal_coordinator_completions WHERE operation_id = p_operation_id;
  IF ROW(v_movement.reversal_event_id, v_movement.original_payment_id, v_movement.order_id,
      v_movement.customer_id, v_movement.actor_id, v_movement.amount_in_minor_units,
      v_movement.actual_tender, v_movement.tender_reference, v_movement.actual_cash_shift_id,
      v_movement.source_recorded_at, v_movement.evidence_recorded_at, v_movement.reversal_executed_at)
    IS DISTINCT FROM ROW(v_reversal.id, v_payment.id, v_reversal.order_id,
      v_reversal.customer_id, v_op.actor_scope_id, v_payment.amount_in_minor_units,
      v_reversal.reversal_tender_method, v_reversal.tender_reference, v_reversal.cash_shift_id,
      v_payment.created_at, v_collection.operation_event_at, v_op.operation_event_at)
    OR v_completion.coordinator_version IS DISTINCT FROM 503
    OR v_completion.reversal_executed_at IS DISTINCT FROM v_op.operation_event_at
    OR v_payment.created_at > v_op.operation_event_at
    OR v_collection.operation_event_at > v_op.operation_event_at
    OR (v_reversal.reversal_tender_method = 'cash' AND NOT EXISTS (
      SELECT 1 FROM public.cash_shifts s JOIN public.orders o ON o.id = v_reversal.order_id
      WHERE s.id = v_reversal.cash_shift_id AND s.branch_id = o.branch_id
        AND s.opened_at <= v_op.operation_event_at
        AND (s.closed_at IS NULL OR s.closed_at >= v_op.operation_event_at)
    ))
    OR v_completion.position_snapshot IS DISTINCT FROM phase5_private.reversal_position_v1(
      v_reversal.order_id, v_completion.sources_snapshot, v_completion.prior_reversal_operation_ids,
      v_completion.settled_return_operation_ids, v_payment.id, v_op.operation_event_at)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_OPERATIONAL_REVERSAL_EVIDENCE_INVALID'; END IF;
  -- Unique operation/payment/reversal identities and full tuple equality prove
  -- BOTH expected coverage and absence of extra operation-owned movement rows.
  v_expected := v_base || JSONB_BUILD_OBJECT('resultType', 'phase5_operational_payment_reversal_v1',
    'coordinatorVersion', 503, 'sourceRecordedAt', TO_CHAR(v_payment.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'evidenceRecordedAt', TO_CHAR(v_collection.operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'financialPosition', v_completion.position_snapshot);
  IF v_completion.result_snapshot IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_OPERATIONAL_REVERSAL_RESULT_INVALID';
  END IF;
  RETURN v_expected;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_OPERATIONAL_REVERSAL_COMPLETION_REQUIRED';
END;
$$;

CREATE FUNCTION phase5_private.assert_coordinator_insert_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM phase5_private.reversal_coordinator_guards
    WHERE operation_id = NEW.operation_id AND transaction_id = pg_current_xact_id()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PHASE5_PRIVATE_COORDINATOR_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION phase5_private.assert_operational_completion_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM phase5_private.validate_operational_reversal_v1(NEW.operation_id);
  RETURN NEW;
END;
$$;

CREATE FUNCTION phase5_private.coordinate_payment_reversal_v1(
  p_actor_id UUID, p_order_id UUID, p_collection_id UUID, p_payment_id UUID,
  p_method TEXT, p_reference TEXT, p_reason TEXT, p_key TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  v_method TEXT := LOWER(NULLIF(BTRIM(p_method), ''));
  v_ref TEXT := NULLIF(BTRIM(p_reference), '');
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_request JSONB;
  v_fp TEXT;
  v_existing phase5_private.financial_operation_events%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_sources JSONB;
  v_prior UUID[];
  v_returns UUID[];
  v_position JSONB;
  v_base JSONB;
  v_result JSONB;
  v_shift UUID;
  v_op UUID := gen_random_uuid();
  v_reversal UUID := gen_random_uuid();
  v_at TIMESTAMPTZ;
BEGIN
  -- Even committed replay requires actor authorization before advisory locks.
  PERFORM phase5_private.authorize_coordinator_actor_v1(p_actor_id);
  IF p_order_id IS NULL OR p_collection_id IS NULL OR p_payment_id IS NULL
    OR v_method IS NULL OR v_method NOT IN ('cash', 'cliq') OR v_reason IS NULL
    OR CHAR_LENGTH(v_reason) > 1000 OR p_key IS NULL OR p_key IS DISTINCT FROM BTRIM(p_key)
    OR CHAR_LENGTH(p_key) NOT BETWEEN 1 AND 255 OR (v_method = 'cliq' AND v_ref IS NULL)
  THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_PAYMENT_REVERSAL_REQUEST_INVALID'; END IF;
  v_request := JSONB_BUILD_OBJECT('requestVersion', 'phase5-customer-payment-reversal-v1',
    'actorScopeType', 'erp_user', 'actorScopeId', p_actor_id, 'orderId', p_order_id,
    'originalCollectionEventId', p_collection_id, 'originalPaymentId', p_payment_id,
    'reversalTenderMethod', v_method, 'tenderReference', v_ref, 'reversalReason', v_reason);
  v_fp := UPPER(public.phase3_request_fingerprint_internal(v_request));
  PERFORM pg_advisory_xact_lock(hashtextextended('phase5-idempotency|erp_user|' || p_actor_id::TEXT
    || '|customer_payment_reversal_v1|' || p_key, 0));
  SELECT * INTO v_existing FROM phase5_private.financial_operation_events WHERE actor_scope_id = p_actor_id
    AND actor_scope_type = 'erp_user' AND operation_type = 'customer_payment_reversal_v1' AND idempotency_key = p_key;
  IF FOUND THEN
    IF v_existing.request_identity_snapshot IS DISTINCT FROM v_request OR v_existing.request_fingerprint IS DISTINCT FROM v_fp
    THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHASE5_PAYMENT_REVERSAL_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN phase5_private.validate_operational_reversal_v1(v_existing.id);
  END IF;
  v_shift := phase5_private.lock_coordinator_context_v1(p_actor_id, p_order_id, v_method = 'cash');
  SELECT * INTO STRICT v_collection FROM phase5_private.collection_events
    WHERE id = p_collection_id AND order_id = p_order_id AND original_payment_id = p_payment_id;
  PERFORM phase5_private.validate_customer_collection_operation_v1(v_collection.financial_operation_id);
  IF EXISTS (SELECT 1 FROM phase5_private.payment_reversal_events WHERE original_payment_id = p_payment_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PHASE5_PAYMENT_ALREADY_REVERSED';
  END IF;
  v_sources := phase5_private.discover_collection_population_v1(p_order_id);
  IF EXISTS (SELECT 1 FROM public.sales_return_events WHERE order_id = p_order_id
    AND settlement_status = 'settled' AND contract_version IS DISTINCT FROM 401) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_LEGACY_RETURN_EVIDENCE_INCOMPLETE';
  END IF;
  SELECT COALESCE(ARRAY_AGG(financial_operation_id ORDER BY financial_operation_id), ARRAY[]::UUID[])
    INTO v_prior FROM phase5_private.payment_reversal_events WHERE order_id = p_order_id;
  SELECT COALESCE(ARRAY_AGG(operation_id ORDER BY operation_id), ARRAY[]::UUID[])
    INTO v_returns FROM public.sales_return_events WHERE order_id = p_order_id
      AND contract_version = 401 AND settlement_status = 'settled';
  v_at := clock_timestamp(); -- One cutoff captured after locks, before position validation.
  v_position := phase5_private.reversal_position_v1(
    p_order_id, v_sources, v_prior, v_returns, p_payment_id, v_at);
  v_base := JSONB_BUILD_OBJECT('success', true, 'resultType', 'customer_payment_reversal_committed_v1',
    'operationId', v_op, 'reversalEventId', v_reversal, 'originalCollectionEventId', p_collection_id,
    'originalPaymentId', p_payment_id, 'orderId', p_order_id, 'customerId', v_collection.customer_id,
    'reversedAmountInMinorUnits', v_collection.amount_in_minor_units, 'reversalTenderMethod', v_method,
    'tenderReference', v_ref, 'cashShiftId', v_shift, 'reversalReason', v_reason,
    'operationEventAt', TO_CHAR(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  v_result := v_base || JSONB_BUILD_OBJECT('resultType', 'phase5_operational_payment_reversal_v1',
    'coordinatorVersion', 503, 'sourceRecordedAt', (SELECT TO_CHAR(created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM public.customer_payments WHERE id = p_payment_id),
    'evidenceRecordedAt', TO_CHAR(v_collection.operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'financialPosition', v_position);
  INSERT INTO phase5_private.financial_operation_events VALUES (v_op, 'customer_payment_reversal_v1',
    'erp_user', p_actor_id, p_key, v_fp, v_request, 'customer_payment_reversal_committed_v1', v_base, v_at);
  INSERT INTO phase5_private.payment_reversal_events VALUES (v_reversal, v_op, 'customer_payment_reversal_v1',
    v_at, p_collection_id, p_payment_id, p_order_id, v_collection.customer_id,
    v_collection.amount_in_minor_units, v_method, v_shift, v_ref, v_reason);
  INSERT INTO phase5_private.reversal_coordinator_guards VALUES (v_op, pg_current_xact_id());
  INSERT INTO phase5_private.reversal_tender_movements SELECT v_op, v_reversal, p_payment_id,
    p_order_id, v_collection.customer_id, p_actor_id, v_collection.amount_in_minor_units,
    v_method, v_ref, v_shift, p.created_at, v_collection.operation_event_at, v_at
    FROM public.customer_payments p WHERE p.id = p_payment_id;
  INSERT INTO phase5_private.reversal_coordinator_completions VALUES
    (v_op, 503, v_sources, v_prior, v_returns, v_position, v_result, v_at);
  v_result := phase5_private.validate_operational_reversal_v1(v_op);
  DELETE FROM phase5_private.reversal_coordinator_guards WHERE operation_id = v_op;
  RETURN v_result;
END;
$$;

CREATE TRIGGER phase5_reversal_movement_coordinator BEFORE INSERT ON phase5_private.reversal_tender_movements
FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_coordinator_insert_v1();
CREATE TRIGGER phase5_reversal_completion_coordinator BEFORE INSERT ON phase5_private.reversal_coordinator_completions
FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_coordinator_insert_v1();
CREATE TRIGGER phase5_reversal_movement_immutable BEFORE UPDATE OR DELETE ON phase5_private.reversal_tender_movements
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation();
CREATE TRIGGER phase5_reversal_completion_immutable BEFORE UPDATE OR DELETE ON phase5_private.reversal_coordinator_completions
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation();
CREATE CONSTRAINT TRIGGER phase5_reversal_movement_complete AFTER INSERT ON phase5_private.reversal_tender_movements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_operational_completion_v1();
CREATE CONSTRAINT TRIGGER phase5_reversal_completion_complete AFTER INSERT ON phase5_private.reversal_coordinator_completions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_operational_completion_v1();

ALTER TABLE phase5_private.reversal_coordinator_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.reversal_coordinator_guards FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.reversal_tender_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.reversal_tender_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.reversal_coordinator_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.reversal_coordinator_completions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE phase5_private.reversal_coordinator_guards,
  phase5_private.reversal_tender_movements, phase5_private.reversal_coordinator_completions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION phase5_private.authorize_coordinator_actor_v1(UUID, BOOLEAN),
  phase5_private.collection_source_v1(UUID, TEXT, UUID),
  phase5_private.discover_collection_population_v1(UUID),
  phase5_private.coordinator_lock_plan_v1(UUID, BOOLEAN),
  phase5_private.lock_coordinator_context_v1(UUID, UUID, BOOLEAN, UUID),
  phase5_private.anchor_existing_collection_v1(UUID, UUID, UUID, TEXT),
  phase5_private.reversal_position_v1(UUID, JSONB, UUID[], UUID[], UUID, TIMESTAMPTZ),
  phase5_private.validate_operational_reversal_v1(UUID),
  phase5_private.assert_coordinator_insert_v1(), phase5_private.assert_operational_completion_v1(),
  phase5_private.coordinate_payment_reversal_v1(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE phase5_private.reversal_coordinator_guards OWNER TO postgres;
ALTER TABLE phase5_private.reversal_tender_movements OWNER TO postgres;
ALTER TABLE phase5_private.reversal_coordinator_completions OWNER TO postgres;
ALTER FUNCTION phase5_private.authorize_coordinator_actor_v1(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION phase5_private.collection_source_v1(UUID, TEXT, UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.discover_collection_population_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.coordinator_lock_plan_v1(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION phase5_private.lock_coordinator_context_v1(UUID, UUID, BOOLEAN, UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.anchor_existing_collection_v1(UUID, UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.reversal_position_v1(UUID, JSONB, UUID[], UUID[], UUID, TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION phase5_private.validate_operational_reversal_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_coordinator_insert_v1() OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_operational_completion_v1() OWNER TO postgres;
ALTER FUNCTION phase5_private.coordinate_payment_reversal_v1(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;

COMMIT;
