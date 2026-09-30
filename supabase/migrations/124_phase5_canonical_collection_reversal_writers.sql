BEGIN;

-- Phase 5 Slice 2: private canonical evidence writers for one exact supported
-- customer collection and one full reversal of one exact canonical collection.
-- These functions intentionally remain unreachable from application roles.

CREATE FUNCTION phase5_private.validate_customer_collection_operation_v1(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_operation phase5_private.financial_operation_events%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_expected_request JSONB;
  v_expected_result JSONB;
  v_expected_fingerprint TEXT;
BEGIN
  SELECT operation.* INTO STRICT v_operation
  FROM phase5_private.financial_operation_events operation
  WHERE operation.id = p_operation_id
    AND operation.operation_type = 'customer_collection_v1';

  SELECT collection.* INTO STRICT v_collection
  FROM phase5_private.collection_events collection
  WHERE collection.financial_operation_id = v_operation.id
    AND collection.operation_type = v_operation.operation_type
    AND collection.operation_event_at = v_operation.operation_event_at;

  SELECT payment.* INTO STRICT v_payment
  FROM public.customer_payments payment
  WHERE payment.id = v_collection.original_payment_id;

  IF v_operation.actor_scope_type IS DISTINCT FROM 'erp_user'
    OR v_operation.result_type IS DISTINCT FROM 'customer_collection_committed_v1'
    OR v_payment.created_by IS DISTINCT FROM v_operation.actor_scope_id
    OR v_payment.order_id IS DISTINCT FROM v_collection.order_id
    OR v_payment.customer_id IS DISTINCT FROM v_collection.customer_id
    OR v_payment.cash_shift_id IS DISTINCT FROM v_collection.cash_shift_id
    OR v_payment.payment_method IS DISTINCT FROM v_collection.tender_method
    OR v_payment.amount_in_minor_units IS DISTINCT FROM v_collection.amount_in_minor_units
    OR v_payment.reference_number IS DISTINCT FROM v_collection.tender_reference
    OR v_payment.payment_method NOT IN ('cash', 'cliq')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_COLLECTION_EVIDENCE_INVALID: Canonical collection evidence no longer matches its authoritative source.';
  END IF;

  v_expected_request := JSONB_BUILD_OBJECT(
    'requestVersion', 'phase5-customer-collection-v1',
    'actorScopeType', 'erp_user',
    'actorScopeId', v_operation.actor_scope_id,
    'orderId', v_collection.order_id,
    'originalPaymentId', v_collection.original_payment_id,
    'amountInMinorUnits', v_collection.amount_in_minor_units,
    'tenderMethod', v_collection.tender_method,
    'tenderReference', v_collection.tender_reference
  );
  v_expected_fingerprint := UPPER(
    public.phase3_request_fingerprint_internal(v_expected_request)
  );

  v_expected_result := JSONB_BUILD_OBJECT(
    'success', true,
    'resultType', 'customer_collection_committed_v1',
    'operationId', v_operation.id,
    'collectionEventId', v_collection.id,
    'originalPaymentId', v_collection.original_payment_id,
    'orderId', v_collection.order_id,
    'customerId', v_collection.customer_id,
    'amountInMinorUnits', v_collection.amount_in_minor_units,
    'tenderMethod', v_collection.tender_method,
    'tenderReference', v_collection.tender_reference,
    'cashShiftId', v_collection.cash_shift_id,
    'operationEventAt', TO_CHAR(
      v_operation.operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );

  IF v_operation.request_identity_snapshot IS DISTINCT FROM v_expected_request
    OR v_operation.request_fingerprint IS DISTINCT FROM v_expected_fingerprint
    OR v_operation.result_snapshot IS DISTINCT FROM v_expected_result
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_COLLECTION_OPERATION_INVALID: Stored collection identity or result is inconsistent.';
  END IF;

  RETURN v_expected_result;
EXCEPTION
  WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_COLLECTION_EVIDENCE_INVALID: Exactly one canonical collection evidence set is required.';
END;
$$;

CREATE FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_operation phase5_private.financial_operation_events%ROWTYPE;
  v_reversal phase5_private.payment_reversal_events%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_expected_request JSONB;
  v_expected_result JSONB;
  v_expected_fingerprint TEXT;
BEGIN
  SELECT operation.* INTO STRICT v_operation
  FROM phase5_private.financial_operation_events operation
  WHERE operation.id = p_operation_id
    AND operation.operation_type = 'customer_payment_reversal_v1';

  SELECT reversal.* INTO STRICT v_reversal
  FROM phase5_private.payment_reversal_events reversal
  WHERE reversal.financial_operation_id = v_operation.id
    AND reversal.operation_type = v_operation.operation_type
    AND reversal.operation_event_at = v_operation.operation_event_at;

  SELECT collection.* INTO STRICT v_collection
  FROM phase5_private.collection_events collection
  WHERE collection.id = v_reversal.original_collection_event_id
    AND collection.original_payment_id = v_reversal.original_payment_id
    AND collection.order_id = v_reversal.order_id
    AND collection.customer_id = v_reversal.customer_id
    AND collection.amount_in_minor_units = v_reversal.reversed_amount_in_minor_units;

  PERFORM phase5_private.validate_customer_collection_operation_v1(
    v_collection.financial_operation_id
  );

  SELECT payment.* INTO STRICT v_payment
  FROM public.customer_payments payment
  WHERE payment.id = v_collection.original_payment_id;

  IF v_operation.actor_scope_type IS DISTINCT FROM 'erp_user'
    OR v_operation.result_type IS DISTINCT FROM 'customer_payment_reversal_committed_v1'
    OR v_payment.order_id IS DISTINCT FROM v_collection.order_id
    OR v_payment.customer_id IS DISTINCT FROM v_collection.customer_id
    OR v_payment.created_by IS DISTINCT FROM (
      SELECT source_operation.actor_scope_id
      FROM phase5_private.financial_operation_events source_operation
      WHERE source_operation.id = v_collection.financial_operation_id
        AND source_operation.operation_type = 'customer_collection_v1'
        AND source_operation.operation_event_at = v_collection.operation_event_at
    )
    OR v_payment.payment_method IS DISTINCT FROM v_collection.tender_method
    OR v_payment.amount_in_minor_units IS DISTINCT FROM v_collection.amount_in_minor_units
    OR v_payment.reference_number IS DISTINCT FROM v_collection.tender_reference
    OR v_reversal.reversal_tender_method NOT IN ('cash', 'cliq')
    OR (v_reversal.reversal_tender_method = 'cash' AND v_reversal.cash_shift_id IS NULL)
    OR (v_reversal.reversal_tender_method = 'cliq' AND (
      v_reversal.cash_shift_id IS NOT NULL
      OR NULLIF(BTRIM(v_reversal.tender_reference), '') IS NULL
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_EVIDENCE_INVALID: Canonical reversal evidence is inconsistent.';
  END IF;

  v_expected_request := JSONB_BUILD_OBJECT(
    'requestVersion', 'phase5-customer-payment-reversal-v1',
    'actorScopeType', 'erp_user',
    'actorScopeId', v_operation.actor_scope_id,
    'orderId', v_reversal.order_id,
    'originalCollectionEventId', v_reversal.original_collection_event_id,
    'originalPaymentId', v_reversal.original_payment_id,
    'reversalTenderMethod', v_reversal.reversal_tender_method,
    'tenderReference', v_reversal.tender_reference,
    'reversalReason', v_reversal.reversal_reason
  );
  v_expected_fingerprint := UPPER(
    public.phase3_request_fingerprint_internal(v_expected_request)
  );

  v_expected_result := JSONB_BUILD_OBJECT(
    'success', true,
    'resultType', 'customer_payment_reversal_committed_v1',
    'operationId', v_operation.id,
    'reversalEventId', v_reversal.id,
    'originalCollectionEventId', v_reversal.original_collection_event_id,
    'originalPaymentId', v_reversal.original_payment_id,
    'orderId', v_reversal.order_id,
    'customerId', v_reversal.customer_id,
    'reversedAmountInMinorUnits', v_reversal.reversed_amount_in_minor_units,
    'reversalTenderMethod', v_reversal.reversal_tender_method,
    'tenderReference', v_reversal.tender_reference,
    'cashShiftId', v_reversal.cash_shift_id,
    'reversalReason', v_reversal.reversal_reason,
    'operationEventAt', TO_CHAR(
      v_operation.operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );

  IF v_operation.request_identity_snapshot IS DISTINCT FROM v_expected_request
    OR v_operation.request_fingerprint IS DISTINCT FROM v_expected_fingerprint
    OR v_operation.result_snapshot IS DISTINCT FROM v_expected_result
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_OPERATION_INVALID: Stored reversal identity or result is inconsistent.';
  END IF;

  RETURN v_expected_result;
EXCEPTION
  WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_EVIDENCE_INVALID: Exactly one canonical reversal evidence set is required.';
END;
$$;

CREATE FUNCTION phase5_private.commit_customer_collection_v1(
  p_actor_scope_id UUID,
  p_order_id UUID,
  p_original_payment_id UUID,
  p_amount_in_minor_units BIGINT,
  p_tender_method TEXT,
  p_tender_reference TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_method TEXT := LOWER(NULLIF(BTRIM(p_tender_method), ''));
  v_reference TEXT := NULLIF(BTRIM(p_tender_reference), '');
  v_request JSONB;
  v_fingerprint TEXT;
  v_existing_operation phase5_private.financial_operation_events%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_shift_id UUID;
  v_operation_id UUID := gen_random_uuid();
  v_collection_id UUID := gen_random_uuid();
  v_operation_event_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF p_actor_scope_id IS NULL OR p_order_id IS NULL
    OR p_original_payment_id IS NULL OR p_amount_in_minor_units IS NULL
    OR p_amount_in_minor_units <= 0 OR v_method NOT IN ('cash', 'cliq')
    OR p_idempotency_key IS NULL
    OR p_idempotency_key IS DISTINCT FROM BTRIM(p_idempotency_key)
    OR CHAR_LENGTH(p_idempotency_key) NOT BETWEEN 1 AND 255
    OR (v_method = 'cliq' AND v_reference IS NULL)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE5_COLLECTION_REQUEST_INVALID: Canonical collection request is invalid.';
  END IF;

  v_request := JSONB_BUILD_OBJECT(
    'requestVersion', 'phase5-customer-collection-v1',
    'actorScopeType', 'erp_user',
    'actorScopeId', p_actor_scope_id,
    'orderId', p_order_id,
    'originalPaymentId', p_original_payment_id,
    'amountInMinorUnits', p_amount_in_minor_units,
    'tenderMethod', v_method,
    'tenderReference', v_reference
  );
  v_fingerprint := UPPER(public.phase3_request_fingerprint_internal(v_request));

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase5-idempotency|erp_user|' || p_actor_scope_id::TEXT
      || '|customer_collection_v1|' || p_idempotency_key,
    0
  ));

  SELECT operation.* INTO v_existing_operation
  FROM phase5_private.financial_operation_events operation
  WHERE operation.actor_scope_type = 'erp_user'
    AND operation.actor_scope_id = p_actor_scope_id
    AND operation.operation_type = 'customer_collection_v1'
    AND operation.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint
      OR v_existing_operation.request_identity_snapshot IS DISTINCT FROM v_request
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        MESSAGE = 'PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT: Idempotency key belongs to another request.';
    END IF;
    RETURN phase5_private.validate_customer_collection_operation_v1(
      v_existing_operation.id
    );
  END IF;

  v_shift_id := public.phase4_lock_customer_order_context_internal(
    p_order_id, true, false
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.user_roles membership ON membership.user_id = profile.id
    JOIN public.roles role ON role.id = membership.role_id
    WHERE profile.id = p_actor_scope_id
      AND profile.is_active
      AND role.code IN ('owner', 'admin', 'manager', 'accountant', 'sales')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE5_COLLECTION_ACTOR_UNAUTHORIZED: Actor cannot commit customer collections.';
  END IF;

  SELECT payment.* INTO STRICT v_payment
  FROM public.customer_payments payment
  WHERE payment.id = p_original_payment_id
  FOR UPDATE;

  IF v_payment.created_by IS DISTINCT FROM p_actor_scope_id
    OR v_payment.order_id IS DISTINCT FROM p_order_id
    OR v_payment.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
    OR v_payment.payment_method IS DISTINCT FROM v_method
    OR v_payment.reference_number IS DISTINCT FROM v_reference
    OR v_payment.payment_method NOT IN ('cash', 'cliq')
    OR v_payment.is_reversed
    OR (v_method = 'cash' AND v_payment.cash_shift_id IS NULL)
    OR (v_method = 'cliq' AND v_reference IS NULL)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_COLLECTION_SOURCE_MISMATCH: Request must exactly match an active supported original payment.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM phase5_private.collection_events collection
    WHERE collection.original_payment_id = p_original_payment_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'PHASE5_COLLECTION_ALREADY_COMMITTED: Original payment already has canonical collection evidence.';
  END IF;

  v_operation_event_at := clock_timestamp();
  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'resultType', 'customer_collection_committed_v1',
    'operationId', v_operation_id,
    'collectionEventId', v_collection_id,
    'originalPaymentId', v_payment.id,
    'orderId', v_payment.order_id,
    'customerId', v_payment.customer_id,
    'amountInMinorUnits', v_payment.amount_in_minor_units,
    'tenderMethod', v_payment.payment_method,
    'tenderReference', v_payment.reference_number,
    'cashShiftId', v_payment.cash_shift_id,
    'operationEventAt', TO_CHAR(
      v_operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );

  INSERT INTO phase5_private.financial_operation_events (
    id, operation_type, actor_scope_type, actor_scope_id, idempotency_key,
    request_fingerprint, request_identity_snapshot, result_type,
    result_snapshot, operation_event_at
  ) VALUES (
    v_operation_id, 'customer_collection_v1', 'erp_user', p_actor_scope_id,
    p_idempotency_key, v_fingerprint, v_request,
    'customer_collection_committed_v1', v_result, v_operation_event_at
  );

  INSERT INTO phase5_private.collection_events (
    id, financial_operation_id, operation_type, operation_event_at,
    original_payment_id, order_id, customer_id, cash_shift_id,
    tender_method, amount_in_minor_units, tender_reference
  ) VALUES (
    v_collection_id, v_operation_id, 'customer_collection_v1',
    v_operation_event_at, v_payment.id, v_payment.order_id,
    v_payment.customer_id, v_payment.cash_shift_id, v_payment.payment_method,
    v_payment.amount_in_minor_units, v_payment.reference_number
  );

  RETURN phase5_private.validate_customer_collection_operation_v1(v_operation_id);
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE5_COLLECTION_SOURCE_REQUIRED: Original payment does not exist.';
END;
$$;

CREATE FUNCTION phase5_private.commit_customer_payment_reversal_v1(
  p_actor_scope_id UUID,
  p_order_id UUID,
  p_original_collection_event_id UUID,
  p_original_payment_id UUID,
  p_reversal_tender_method TEXT,
  p_tender_reference TEXT,
  p_reversal_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_method TEXT := LOWER(NULLIF(BTRIM(p_reversal_tender_method), ''));
  v_reference TEXT := NULLIF(BTRIM(p_tender_reference), '');
  v_reason TEXT := NULLIF(BTRIM(p_reversal_reason), '');
  v_request JSONB;
  v_fingerprint TEXT;
  v_existing_operation phase5_private.financial_operation_events%ROWTYPE;
  v_collection phase5_private.collection_events%ROWTYPE;
  v_payment public.customer_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_shift_id UUID;
  v_operation_id UUID := gen_random_uuid();
  v_reversal_id UUID := gen_random_uuid();
  v_operation_event_at TIMESTAMPTZ;
  v_result JSONB;
  v_collection_coverage BIGINT;
  v_prior_reversals BIGINT;
  v_debt_reductions BIGINT;
  v_money_refunds BIGINT;
  v_candidate_coverage BIGINT;
  v_candidate_outstanding BIGINT;
  v_delivery_outstanding BIGINT;
  v_collected_delivery BIGINT;
  v_required_coverage BIGINT;
  v_return_operation_id UUID;
BEGIN
  IF p_actor_scope_id IS NULL OR p_order_id IS NULL
    OR p_original_collection_event_id IS NULL OR p_original_payment_id IS NULL
    OR v_method NOT IN ('cash', 'cliq') OR v_reason IS NULL
    OR CHAR_LENGTH(v_reason) > 1000
    OR p_idempotency_key IS NULL
    OR p_idempotency_key IS DISTINCT FROM BTRIM(p_idempotency_key)
    OR CHAR_LENGTH(p_idempotency_key) NOT BETWEEN 1 AND 255
    OR (v_method = 'cliq' AND v_reference IS NULL)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_REQUEST_INVALID: Canonical reversal request is invalid.';
  END IF;

  v_request := JSONB_BUILD_OBJECT(
    'requestVersion', 'phase5-customer-payment-reversal-v1',
    'actorScopeType', 'erp_user',
    'actorScopeId', p_actor_scope_id,
    'orderId', p_order_id,
    'originalCollectionEventId', p_original_collection_event_id,
    'originalPaymentId', p_original_payment_id,
    'reversalTenderMethod', v_method,
    'tenderReference', v_reference,
    'reversalReason', v_reason
  );
  v_fingerprint := UPPER(public.phase3_request_fingerprint_internal(v_request));

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase5-idempotency|erp_user|' || p_actor_scope_id::TEXT
      || '|customer_payment_reversal_v1|' || p_idempotency_key,
    0
  ));

  SELECT operation.* INTO v_existing_operation
  FROM phase5_private.financial_operation_events operation
  WHERE operation.actor_scope_type = 'erp_user'
    AND operation.actor_scope_id = p_actor_scope_id
    AND operation.operation_type = 'customer_payment_reversal_v1'
    AND operation.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint
      OR v_existing_operation.request_identity_snapshot IS DISTINCT FROM v_request
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        MESSAGE = 'PHASE5_PAYMENT_REVERSAL_IDEMPOTENCY_CONFLICT: Idempotency key belongs to another request.';
    END IF;
    RETURN phase5_private.validate_customer_payment_reversal_operation_v1(
      v_existing_operation.id
    );
  END IF;

  v_shift_id := public.phase4_lock_customer_order_context_internal(
    p_order_id, v_method = 'cash', false
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN public.user_roles membership ON membership.user_id = profile.id
    JOIN public.roles role ON role.id = membership.role_id
    WHERE profile.id = p_actor_scope_id
      AND profile.is_active
      AND role.code IN ('owner', 'admin', 'manager', 'accountant')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_ACTOR_UNAUTHORIZED: Actor cannot commit payment reversals.';
  END IF;

  SELECT customer_order.* INTO STRICT v_order
  FROM public.orders customer_order
  WHERE customer_order.id = p_order_id;

  SELECT collection.* INTO STRICT v_collection
  FROM phase5_private.collection_events collection
  WHERE collection.id = p_original_collection_event_id
    AND collection.original_payment_id = p_original_payment_id
    AND collection.order_id = p_order_id
  FOR UPDATE;

  SELECT payment.* INTO STRICT v_payment
  FROM public.customer_payments payment
  WHERE payment.id = p_original_payment_id
  FOR UPDATE;

  IF v_payment.order_id IS DISTINCT FROM v_collection.order_id
    OR v_payment.customer_id IS DISTINCT FROM v_collection.customer_id
    OR v_payment.amount_in_minor_units IS DISTINCT FROM v_collection.amount_in_minor_units
    OR v_payment.payment_method IS DISTINCT FROM v_collection.tender_method
    OR v_payment.reference_number IS DISTINCT FROM v_collection.tender_reference
    OR v_payment.is_reversed
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_SOURCE_INVALID: Original collection no longer matches its authoritative payment.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM phase5_private.payment_reversal_events reversal
    WHERE reversal.original_collection_event_id = v_collection.id
       OR reversal.original_payment_id = v_payment.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = 'PHASE5_PAYMENT_ALREADY_REVERSED: Exact original collection already has a reversal.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM phase5_private.collection_events collection
    JOIN public.customer_payments payment
      ON payment.id = collection.original_payment_id
    LEFT JOIN phase5_private.payment_reversal_events reversal
      ON reversal.original_collection_event_id = collection.id
    WHERE collection.order_id = p_order_id
      AND payment.is_reversed
      AND reversal.id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_LEGACY_PAYMENT_REVERSAL_CONFLICT: Canonical coverage conflicts with an unbound legacy payment reversal.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sales_return_events event
    WHERE event.order_id = p_order_id
      AND event.contract_version IS NULL
      AND event.settlement_status = 'settled'
      AND event.merchandise_refund_amount_in_minor_units > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_LEGACY_RETURN_EVIDENCE_INCOMPLETE: Reversal capacity cannot be guessed for legacy Return evidence.';
  END IF;

  -- A modern settled-looking Return is not financial truth by itself. Before
  -- its debt/refund split may constrain reversal capacity, re-prove the full
  -- Phase 4.2 operational settlement binding (result, coordinator evidence and
  -- inventory effects) through the same central validator used by replay.
  FOR v_return_operation_id IN
    SELECT event.operation_id
    FROM public.sales_return_events event
    WHERE event.order_id = p_order_id
      AND event.contract_version = 401
      AND event.settlement_status = 'settled'
    ORDER BY event.operation_id
  LOOP
    PERFORM public.phase42_assert_operational_return_evidence_internal(
      v_return_operation_id, true
    );
  END LOOP;

  SELECT COALESCE(SUM(collection.amount_in_minor_units), 0)::BIGINT
  INTO v_collection_coverage
  FROM phase5_private.collection_events collection
  WHERE collection.order_id = p_order_id;

  SELECT COALESCE(SUM(reversal.reversed_amount_in_minor_units), 0)::BIGINT
  INTO v_prior_reversals
  FROM phase5_private.payment_reversal_events reversal
  WHERE reversal.order_id = p_order_id;

  SELECT
    COALESCE(SUM(event.debt_reduction_amount_in_minor_units), 0)::BIGINT,
    COALESCE(SUM(event.money_refund_amount_in_minor_units), 0)::BIGINT
  INTO v_debt_reductions, v_money_refunds
  FROM public.sales_return_events event
  WHERE event.order_id = p_order_id
    AND event.contract_version = 401
    AND event.settlement_status = 'settled';

  v_candidate_coverage := v_collection_coverage - v_prior_reversals
    - v_collection.amount_in_minor_units;
  v_candidate_outstanding := GREATEST(
    v_order.total_in_minor_units - v_candidate_coverage - v_debt_reductions,
    0
  );
  v_delivery_outstanding := LEAST(
    v_order.delivery_fee_in_minor_units, v_candidate_outstanding
  );
  v_collected_delivery := v_order.delivery_fee_in_minor_units
    - v_delivery_outstanding;
  v_required_coverage := v_money_refunds + v_collected_delivery;

  IF v_candidate_coverage < 0
    OR v_candidate_coverage < v_required_coverage
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_CAPACITY_EXCEEDED: Reversal would violate committed refund or delivery coverage.';
  END IF;

  IF v_method = 'cash' AND v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE5_CASH_REVERSAL_SHIFT_REQUIRED: Cash reversal requires a current open Shift.';
  END IF;

  v_operation_event_at := clock_timestamp();
  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'resultType', 'customer_payment_reversal_committed_v1',
    'operationId', v_operation_id,
    'reversalEventId', v_reversal_id,
    'originalCollectionEventId', v_collection.id,
    'originalPaymentId', v_payment.id,
    'orderId', v_collection.order_id,
    'customerId', v_collection.customer_id,
    'reversedAmountInMinorUnits', v_collection.amount_in_minor_units,
    'reversalTenderMethod', v_method,
    'tenderReference', v_reference,
    'cashShiftId', CASE WHEN v_method = 'cash' THEN v_shift_id END,
    'reversalReason', v_reason,
    'operationEventAt', TO_CHAR(
      v_operation_event_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );

  INSERT INTO phase5_private.financial_operation_events (
    id, operation_type, actor_scope_type, actor_scope_id, idempotency_key,
    request_fingerprint, request_identity_snapshot, result_type,
    result_snapshot, operation_event_at
  ) VALUES (
    v_operation_id, 'customer_payment_reversal_v1', 'erp_user',
    p_actor_scope_id, p_idempotency_key, v_fingerprint, v_request,
    'customer_payment_reversal_committed_v1', v_result,
    v_operation_event_at
  );

  INSERT INTO phase5_private.payment_reversal_events (
    id, financial_operation_id, operation_type, operation_event_at,
    original_collection_event_id, original_payment_id, order_id, customer_id,
    reversed_amount_in_minor_units, reversal_tender_method, cash_shift_id,
    tender_reference, reversal_reason
  ) VALUES (
    v_reversal_id, v_operation_id, 'customer_payment_reversal_v1',
    v_operation_event_at, v_collection.id, v_payment.id, v_collection.order_id,
    v_collection.customer_id, v_collection.amount_in_minor_units, v_method,
    CASE WHEN v_method = 'cash' THEN v_shift_id END,
    v_reference, v_reason
  );

  RETURN phase5_private.validate_customer_payment_reversal_operation_v1(
    v_operation_id
  );
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE5_PAYMENT_REVERSAL_SOURCE_REQUIRED: Exact collection, payment, or order does not exist.';
END;
$$;

COMMENT ON FUNCTION phase5_private.validate_customer_collection_operation_v1(UUID) IS
  'Private Slice-2 relational validator for exact canonical collection replay.';
COMMENT ON FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1(UUID) IS
  'Private Slice-2 relational validator for exact canonical payment-reversal replay.';
COMMENT ON FUNCTION phase5_private.commit_customer_collection_v1(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT) IS
  'Private inactive Slice-2 writer for canonical evidence over one exact supported customer payment.';
COMMENT ON FUNCTION phase5_private.commit_customer_payment_reversal_v1(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) IS
  'Private inactive Slice-2 writer for one full reversal of one exact canonical collection; Cash activation still requires a later atomic drawer coordinator.';

REVOKE ALL ON FUNCTION phase5_private.validate_customer_collection_operation_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION phase5_private.commit_customer_collection_v1(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION phase5_private.commit_customer_payment_reversal_v1(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION phase5_private.validate_customer_collection_operation_v1(UUID)
  OWNER TO postgres;
ALTER FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1(UUID)
  OWNER TO postgres;
ALTER FUNCTION phase5_private.commit_customer_collection_v1(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION phase5_private.commit_customer_payment_reversal_v1(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  OWNER TO postgres;

COMMIT;
