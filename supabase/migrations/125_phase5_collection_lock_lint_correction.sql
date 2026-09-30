BEGIN;

-- Bounded lint correction: discard the unused return value, never the lock call.
-- Migration 124 remains immutable; authority, signature and behavior are unchanged.
CREATE OR REPLACE FUNCTION phase5_private.commit_customer_collection_v1(
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

  PERFORM public.phase4_lock_customer_order_context_internal(
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

REVOKE ALL ON FUNCTION phase5_private.commit_customer_collection_v1(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION phase5_private.commit_customer_collection_v1(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT)
  OWNER TO postgres;

COMMIT;
