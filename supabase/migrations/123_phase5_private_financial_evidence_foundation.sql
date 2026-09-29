BEGIN;

-- Phase 5 Slice 1: private, additive and inactive financial evidence
-- foundation. No current writer or reader uses these objects. Activation and
-- caller cutover require a later owner-approved slice.

CREATE SCHEMA phase5_private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA phase5_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE phase5_private.financial_operation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'customer_collection_v1',
    'customer_payment_reversal_v1'
  )),
  actor_scope_type TEXT NOT NULL CHECK (actor_scope_type = 'erp_user'),
  actor_scope_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (
    idempotency_key = BTRIM(idempotency_key)
    AND CHAR_LENGTH(idempotency_key) BETWEEN 1 AND 255
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    request_fingerprint ~ '^[0-9A-F]{64}$'
  ),
  request_identity_snapshot JSONB NOT NULL CHECK (
    JSONB_TYPEOF(request_identity_snapshot) = 'object'
  ),
  result_type TEXT NOT NULL,
  result_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(result_snapshot) = 'object'),
  operation_event_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT phase5_financial_operation_result_type_check CHECK (
    (operation_type = 'customer_collection_v1'
      AND result_type = 'customer_collection_committed_v1')
    OR
    (operation_type = 'customer_payment_reversal_v1'
      AND result_type = 'customer_payment_reversal_committed_v1')
  ),
  CONSTRAINT uq_phase5_financial_operation_idempotency_scope UNIQUE (
    actor_scope_type,
    actor_scope_id,
    operation_type,
    idempotency_key
  ),
  CONSTRAINT uq_phase5_financial_operation_event_identity UNIQUE (
    id,
    operation_type,
    operation_event_at
  )
);

COMMENT ON TABLE phase5_private.financial_operation_events IS
  'Inactive Phase 5 committed operation identity foundation. Future writers must capture operation_event_at after locks and validation; replay preserves it.';
COMMENT ON COLUMN phase5_private.financial_operation_events.operation_event_at IS
  'Explicit immutable server event time supplied by a future authoritative writer. It has no DEFAULT and is not claimed to be commit time.';

CREATE TABLE phase5_private.collection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_operation_id UUID NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type = 'customer_collection_v1'),
  operation_event_at TIMESTAMPTZ NOT NULL,
  original_payment_id UUID NOT NULL UNIQUE
    REFERENCES public.customer_payments(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  cash_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  tender_method TEXT NOT NULL CHECK (tender_method IN ('cash', 'cliq')),
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  tender_reference TEXT,
  CONSTRAINT fk_phase5_collection_operation_event
    FOREIGN KEY (financial_operation_id, operation_type, operation_event_at)
    REFERENCES phase5_private.financial_operation_events(
      id, operation_type, operation_event_at
    ) ON DELETE RESTRICT,
  CONSTRAINT phase5_collection_tender_evidence_check CHECK (
    (tender_method <> 'cash' OR cash_shift_id IS NOT NULL)
    AND
    (tender_method <> 'cliq' OR NULLIF(BTRIM(tender_reference), '') IS NOT NULL)
  ),
  CONSTRAINT uq_phase5_collection_reversal_anchor UNIQUE (
    id,
    original_payment_id,
    order_id,
    customer_id,
    amount_in_minor_units
  )
);

COMMENT ON TABLE phase5_private.collection_events IS
  'Inactive future canonical collection evidence for supported Cash/CliQ tenders. It does not replace customer_payments or orders.amount_paid_in_minor_units in Slice 1.';

CREATE TABLE phase5_private.payment_reversal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_operation_id UUID NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type = 'customer_payment_reversal_v1'),
  operation_event_at TIMESTAMPTZ NOT NULL,
  original_collection_event_id UUID NOT NULL UNIQUE,
  original_payment_id UUID NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  reversed_amount_in_minor_units BIGINT NOT NULL CHECK (reversed_amount_in_minor_units > 0),
  reversal_tender_method TEXT NOT NULL CHECK (reversal_tender_method IN ('cash', 'cliq')),
  cash_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  tender_reference TEXT,
  reversal_reason TEXT NOT NULL CHECK (
    reversal_reason = BTRIM(reversal_reason)
    AND CHAR_LENGTH(reversal_reason) BETWEEN 1 AND 1000
  ),
  CONSTRAINT fk_phase5_reversal_operation_event
    FOREIGN KEY (financial_operation_id, operation_type, operation_event_at)
    REFERENCES phase5_private.financial_operation_events(
      id, operation_type, operation_event_at
    ) ON DELETE RESTRICT,
  CONSTRAINT fk_phase5_reversal_exact_original_collection
    FOREIGN KEY (
      original_collection_event_id,
      original_payment_id,
      order_id,
      customer_id,
      reversed_amount_in_minor_units
    )
    REFERENCES phase5_private.collection_events(
      id,
      original_payment_id,
      order_id,
      customer_id,
      amount_in_minor_units
    ) ON DELETE RESTRICT,
  CONSTRAINT phase5_reversal_tender_evidence_check CHECK (
    (reversal_tender_method <> 'cash' OR cash_shift_id IS NOT NULL)
    AND
    (reversal_tender_method <> 'cliq' OR NULLIF(BTRIM(tender_reference), '') IS NOT NULL)
  )
);

COMMENT ON TABLE phase5_private.payment_reversal_events IS
  'Inactive future evidence for one full reversal of one exact original collection. The original collection remains immutable and the actual reversal tender is recorded independently.';

CREATE INDEX idx_phase5_collection_order_event
  ON phase5_private.collection_events(order_id, operation_event_at, id);

CREATE INDEX idx_phase5_reversal_order_event
  ON phase5_private.payment_reversal_events(order_id, operation_event_at, id);

CREATE FUNCTION phase5_private.assert_collection_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_payment public.customer_payments%ROWTYPE;
  v_actor_scope_id UUID;
BEGIN
  SELECT payment.* INTO v_payment
  FROM public.customer_payments payment
  WHERE payment.id = NEW.original_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'PHASE5_COLLECTION_SOURCE_REQUIRED: The exact original payment does not exist.';
  END IF;

  SELECT operation.actor_scope_id INTO v_actor_scope_id
  FROM phase5_private.financial_operation_events operation
  WHERE operation.id = NEW.financial_operation_id
    AND operation.operation_type = NEW.operation_type
    AND operation.operation_event_at = NEW.operation_event_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'PHASE5_COLLECTION_OPERATION_REQUIRED: The exact collection operation does not exist.';
  END IF;

  IF v_payment.payment_method NOT IN ('cash', 'cliq')
    OR v_payment.created_by IS DISTINCT FROM v_actor_scope_id
    OR v_payment.order_id IS DISTINCT FROM NEW.order_id
    OR v_payment.customer_id IS DISTINCT FROM NEW.customer_id
    OR v_payment.cash_shift_id IS DISTINCT FROM NEW.cash_shift_id
    OR v_payment.payment_method IS DISTINCT FROM NEW.tender_method
    OR v_payment.amount_in_minor_units IS DISTINCT FROM NEW.amount_in_minor_units
    OR v_payment.reference_number IS DISTINCT FROM NEW.tender_reference
    OR v_payment.is_reversed
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PHASE5_COLLECTION_SOURCE_MISMATCH: Collection evidence must exactly match an active supported original payment.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION phase5_private.reject_financial_evidence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_FINANCIAL_EVIDENCE: Phase 5 committed evidence cannot be updated or deleted.';
END;
$$;

CREATE TRIGGER trg_phase5_collection_events_source
BEFORE INSERT ON phase5_private.collection_events
FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_collection_source();

CREATE TRIGGER trg_phase5_financial_operation_events_immutable
BEFORE UPDATE OR DELETE ON phase5_private.financial_operation_events
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation();

CREATE TRIGGER trg_phase5_collection_events_immutable
BEFORE UPDATE OR DELETE ON phase5_private.collection_events
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation();

CREATE TRIGGER trg_phase5_payment_reversal_events_immutable
BEFORE UPDATE OR DELETE ON phase5_private.payment_reversal_events
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_financial_evidence_mutation();

ALTER TABLE phase5_private.financial_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.financial_operation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.collection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.collection_events FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.payment_reversal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.payment_reversal_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  phase5_private.financial_operation_events,
  phase5_private.collection_events,
  phase5_private.payment_reversal_events
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION phase5_private.reject_financial_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION phase5_private.assert_collection_source()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE phase5_private.financial_operation_events OWNER TO postgres;
ALTER TABLE phase5_private.collection_events OWNER TO postgres;
ALTER TABLE phase5_private.payment_reversal_events OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_source() OWNER TO postgres;
ALTER FUNCTION phase5_private.reject_financial_evidence_mutation() OWNER TO postgres;

COMMIT;
