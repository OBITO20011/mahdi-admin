BEGIN;

-- Owner2026-10-16: cheques reduce debt once on receipt/issue. A bank return
-- AND an erroneous registration cancellation create independent claims.
-- Original vouchers/orders/Returns/allocations are NEVER reversed by either.
-- All amounts are integer JOD fils; no drawer, stock, COGS or profit effect.

CREATE SEQUENCE public.deferred_cheque_number_seq START 1001;
ALTER SEQUENCE public.deferred_cheque_number_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE public.deferred_cheque_number_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.deferred_cheques (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK(direction IN ('incoming','outgoing')),
  origin TEXT NOT NULL DEFAULT 'operational' CHECK(origin IN ('operational','opening')),
  cheque_number TEXT NOT NULL CHECK(char_length(btrim(cheque_number))>=1 AND char_length(btrim(cheque_number))<=80 AND cheque_number=btrim(cheque_number)),
  bank_name TEXT NOT NULL CHECK(char_length(btrim(bank_name))>=1 AND char_length(btrim(bank_name))<=120 AND bank_name=btrim(bank_name)),
  bank_key TEXT GENERATED ALWAYS AS (lower(btrim(bank_name))) STORED,
  due_date DATE NOT NULL,
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units BETWEEN 1 AND 999999999999),
  customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  endorsed_supplier_id UUID REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','endorsed','cleared','returned','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  collection_operation_id UUID UNIQUE REFERENCES public.customer_collection_operations(id) ON DELETE RESTRICT,
  supplier_payment_id UUID UNIQUE REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  original_debt_at TIMESTAMPTZ,
  notes TEXT CHECK(notes IS NULL OR char_length(notes)<=500),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registration_txid BIGINT NOT NULL DEFAULT txid_current(),
  changed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((direction='incoming' AND customer_id IS NOT NULL AND supplier_id IS NULL)
     OR(direction='outgoing' AND customer_id IS NULL AND supplier_id IS NOT NULL AND endorsed_supplier_id IS NULL)),
  CHECK(status<>'endorsed' OR (direction='incoming' AND endorsed_supplier_id IS NOT NULL)),
  CHECK(endorsed_supplier_id IS NULL OR status IN ('endorsed','cleared','returned'))
);
CREATE INDEX idx_deferred_cheques_due ON public.deferred_cheques(status,due_date,branch_id);
CREATE INDEX idx_deferred_cheques_customer ON public.deferred_cheques(customer_id,created_at,id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_deferred_cheques_supplier ON public.deferred_cheques(supplier_id,created_at,id) WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_deferred_cheques_endorsed_supplier ON public.deferred_cheques(endorsed_supplier_id) WHERE endorsed_supplier_id IS NOT NULL;

-- The same supplier cannot receive the same bank/number via both issue and
-- endorsement. Cancellation never erases the original duplicate identity.
CREATE TABLE public.cheque_party_keys (
  party_kind TEXT NOT NULL CHECK(party_kind IN ('customer','supplier')),
  party_id UUID NOT NULL,
  bank_key TEXT NOT NULL,
  cheque_number TEXT NOT NULL,
  cheque_id UUID NOT NULL REFERENCES public.deferred_cheques(id) ON DELETE RESTRICT,
  registered_by UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE RESTRICT,
  registration_txid BIGINT NOT NULL DEFAULT txid_current(),
  PRIMARY KEY(party_kind,party_id,bank_key,cheque_number)
);

CREATE TABLE public.deferred_cheque_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id UUID NOT NULL REFERENCES public.deferred_cheques(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(version>0),
  kind TEXT NOT NULL CHECK(kind IN ('received','issued','opening_registered','endorsed','cleared','returned','cancelled')),
  previous_status TEXT,
  resulting_status TEXT NOT NULL CHECK(resulting_status IN ('pending','endorsed','cleared','returned','cancelled')),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT CHECK(reason IS NULL OR char_length(btrim(reason)) BETWEEN 5 AND 500),
  idempotency_key TEXT NOT NULL CHECK(char_length(idempotency_key) BETWEEN 16 AND 160),
  request_identity JSONB NOT NULL CHECK(jsonb_typeof(request_identity)='object'),
  result_snapshot JSONB NOT NULL CHECK(jsonb_typeof(result_snapshot)='object'),
  UNIQUE(cheque_id,version),
  UNIQUE(actor_id,idempotency_key),
  CHECK(kind NOT IN ('returned','cancelled') OR reason IS NOT NULL)
);
CREATE INDEX idx_deferred_cheque_events_timeline ON public.deferred_cheque_events(cheque_id,version);

CREATE TABLE public.deferred_cheque_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id UUID NOT NULL REFERENCES public.deferred_cheques(id) ON DELETE RESTRICT,
  party_kind TEXT NOT NULL CHECK(party_kind IN ('customer','supplier')),
  party_id UUID NOT NULL,
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('order','opening','compensation','supplier_balance','opening_cheque')),
  origin_id UUID NOT NULL,
  original_debt_at TIMESTAMPTZ,
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  customer_payment_id UUID REFERENCES public.customer_payments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cheque_id,party_kind,origin_kind,origin_id)
);
CREATE INDEX idx_deferred_cheque_allocations_party ON public.deferred_cheque_allocations(party_kind,party_id,cheque_id);

-- This is authoritative additional debt evidence, NOT a balance cache. Its
-- principal is derived solely from an immutable cheque allocation. Existing
-- receipts and their allocations remain byte-for-byte unchanged on return.
CREATE TABLE public.cheque_compensation_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cheque_id UUID NOT NULL REFERENCES public.deferred_cheques(id) ON DELETE RESTRICT,
  source_allocation_id UUID NOT NULL UNIQUE REFERENCES public.deferred_cheque_allocations(id) ON DELETE RESTRICT,
  party_kind TEXT NOT NULL CHECK(party_kind IN ('customer','supplier')),
  party_id UUID NOT NULL,
  claim_kind TEXT NOT NULL CHECK(claim_kind IN ('returned','cancelled')),
  reference TEXT NOT NULL,
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  original_debt_at TIMESTAMPTZ,
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('order','opening','compensation','supplier_balance','opening_cheque')),
  reason TEXT NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 5 AND 500),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cheque_compensation_party ON public.cheque_compensation_claims(party_kind,party_id,original_debt_at,id);

CREATE TABLE public.customer_collection_cheque_allocations (
  operation_id UUID NOT NULL REFERENCES public.customer_collection_operations(id) ON DELETE RESTRICT,
  claim_id UUID NOT NULL REFERENCES public.cheque_compensation_claims(id) ON DELETE RESTRICT,
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  PRIMARY KEY(operation_id,claim_id)
);
CREATE INDEX idx_customer_collection_cheque_claim ON public.customer_collection_cheque_allocations(claim_id);

CREATE TABLE public.supplier_cheque_claim_payments (
  supplier_payment_id UUID NOT NULL REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  claim_id UUID NOT NULL REFERENCES public.cheque_compensation_claims(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','cliq','bank_transfer','cheque')),
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(char_length(idempotency_key) BETWEEN 16 AND 160),
  PRIMARY KEY(supplier_payment_id,claim_id),
  CHECK((payment_method IN ('cash','cliq'))=(branch_id IS NOT NULL AND cash_shift_id IS NOT NULL))
);
CREATE INDEX idx_supplier_cheque_claim_payment_claim ON public.supplier_cheque_claim_payments(claim_id);

-- Separate evidence: standalone claim payments need neither a receipt nor a PO.
CREATE TABLE public.supplier_cheque_claim_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id UUID NOT NULL UNIQUE REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 5 AND 500),
  idempotency_key TEXT NOT NULL CHECK(char_length(idempotency_key) BETWEEN 16 AND 160),
  amount_in_minor_units BIGINT NOT NULL CHECK(amount_in_minor_units>0),
  cash_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','cliq','bank_transfer')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(requested_by,idempotency_key),
  CHECK((payment_method IN ('cash','cliq'))=(cash_shift_id IS NOT NULL))
);
ALTER TABLE public.supplier_cheque_claim_reversals OWNER TO postgres;
ALTER TABLE public.supplier_cheque_claim_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_cheque_claim_reversals FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.customer_collection_operations
  ADD COLUMN compensation_amount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK(compensation_amount_in_minor_units>=0),
  DROP CONSTRAINT customer_collection_operations_parts_sum,
  ADD CONSTRAINT customer_collection_operations_parts_sum CHECK(
    opening_amount_in_minor_units+orders_amount_in_minor_units+compensation_amount_in_minor_units=amount_in_minor_units),
  DROP CONSTRAINT customer_collection_operations_payment_method_check,
  ADD CONSTRAINT customer_collection_operations_payment_method_check CHECK(payment_method IN ('cash','cliq','bank_transfer','cheque')),
  DROP CONSTRAINT customer_collection_operations_opening_shift,
  ADD CONSTRAINT customer_collection_operations_opening_shift CHECK(
    NOT(payment_method IN ('cash','cliq') AND opening_amount_in_minor_units+compensation_amount_in_minor_units>0)
    OR(cash_shift_id IS NOT NULL AND branch_id IS NOT NULL));

ALTER TABLE public.deferred_cheques OWNER TO postgres;
ALTER TABLE public.cheque_party_keys OWNER TO postgres;
ALTER TABLE public.deferred_cheque_events OWNER TO postgres;
ALTER TABLE public.deferred_cheque_allocations OWNER TO postgres;
ALTER TABLE public.cheque_compensation_claims OWNER TO postgres;
ALTER TABLE public.customer_collection_cheque_allocations OWNER TO postgres;
ALTER TABLE public.supplier_cheque_claim_payments OWNER TO postgres;
ALTER TABLE public.deferred_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_party_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deferred_cheque_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deferred_cheque_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheque_compensation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_collection_cheque_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_cheque_claim_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deferred_cheques,public.cheque_party_keys,public.deferred_cheque_events,
  public.deferred_cheque_allocations,public.cheque_compensation_claims,
  public.customer_collection_cheque_allocations,public.supplier_cheque_claim_payments
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_reject_evidence_mutation_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CHEQUE_EVIDENCE_IMMUTABLE: أدلة الشيكات دائمة؛ لا تعديل أو حذف أو تفريغ.';
END;
$$;
ALTER FUNCTION public.cheque_reject_evidence_mutation_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_reject_evidence_mutation_internal() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER trg_deferred_cheques_no_truncate BEFORE TRUNCATE ON public.deferred_cheques
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_cheque_party_keys_immutable BEFORE UPDATE OR DELETE ON public.cheque_party_keys
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_cheque_party_keys_no_truncate BEFORE TRUNCATE ON public.cheque_party_keys
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_deferred_cheque_events_immutable BEFORE UPDATE OR DELETE ON public.deferred_cheque_events
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_deferred_cheque_events_no_truncate BEFORE TRUNCATE ON public.deferred_cheque_events
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_deferred_cheque_allocations_immutable BEFORE UPDATE OR DELETE ON public.deferred_cheque_allocations
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_deferred_cheque_allocations_no_truncate BEFORE TRUNCATE ON public.deferred_cheque_allocations
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_cheque_compensation_claims_immutable BEFORE UPDATE OR DELETE ON public.cheque_compensation_claims
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_cheque_compensation_claims_no_truncate BEFORE TRUNCATE ON public.cheque_compensation_claims
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_customer_collection_cheque_allocations_immutable BEFORE UPDATE OR DELETE ON public.customer_collection_cheque_allocations
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_customer_collection_cheque_allocations_no_truncate BEFORE TRUNCATE ON public.customer_collection_cheque_allocations
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_supplier_cheque_claim_payments_immutable BEFORE UPDATE OR DELETE ON public.supplier_cheque_claim_payments
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_supplier_cheque_claim_payments_no_truncate BEFORE TRUNCATE ON public.supplier_cheque_claim_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_supplier_cheque_claim_reversals_immutable BEFORE UPDATE OR DELETE ON public.supplier_cheque_claim_reversals
FOR EACH ROW EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();
CREATE TRIGGER trg_supplier_cheque_claim_reversals_no_truncate BEFORE TRUNCATE ON public.supplier_cheque_claim_reversals
FOR EACH STATEMENT EXECUTE FUNCTION public.cheque_reject_evidence_mutation_internal();

CREATE FUNCTION public.cheque_guard_record_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_IMMUTABLE: لا حذف للشيك.';
  END IF;
  IF (NEW.id,NEW.tracking_number,NEW.direction,NEW.origin,NEW.cheque_number,NEW.bank_name,
      NEW.due_date,NEW.amount_in_minor_units,NEW.customer_id,NEW.supplier_id,NEW.branch_id,
      NEW.original_debt_at,NEW.notes,NEW.created_by,NEW.created_at,NEW.registration_txid)
    IS DISTINCT FROM
     (OLD.id,OLD.tracking_number,OLD.direction,OLD.origin,OLD.cheque_number,OLD.bank_name,
      OLD.due_date,OLD.amount_in_minor_units,OLD.customer_id,OLD.supplier_id,OLD.branch_id,
      OLD.original_debt_at,OLD.notes,OLD.created_by,OLD.created_at,OLD.registration_txid) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_IMMUTABLE: هوية الشيك ومبلغه وأصله ثابتة.';
  END IF;
  IF NEW.status=OLD.status THEN
    IF OLD.status<>'pending' OR NEW.version<>OLD.version OR OLD.registration_txid<>txid_current()
      OR NEW.changed_by IS DISTINCT FROM OLD.changed_by OR NEW.changed_at IS DISTINCT FROM OLD.changed_at
      OR NEW.endorsed_supplier_id IS DISTINCT FROM OLD.endorsed_supplier_id
      OR(OLD.collection_operation_id IS NOT NULL AND NEW.collection_operation_id IS DISTINCT FROM OLD.collection_operation_id)
      OR(OLD.supplier_payment_id IS NOT NULL AND NEW.supplier_payment_id IS DISTINCT FROM OLD.supplier_payment_id) THEN
      RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION: لا إعادة كتابة لحالة الشيك.';
    END IF;
  ELSE
    IF NEW.version<>OLD.version+1 OR NOT(
      (OLD.status='pending' AND NEW.status IN ('endorsed','cleared','returned','cancelled'))
      OR(OLD.status='endorsed' AND NEW.status IN ('cleared','returned')))
      OR NEW.collection_operation_id IS DISTINCT FROM OLD.collection_operation_id
      OR(NEW.status<>'endorsed' AND (NEW.supplier_payment_id IS DISTINCT FROM OLD.supplier_payment_id
        OR NEW.endorsed_supplier_id IS DISTINCT FROM OLD.endorsed_supplier_id))
      OR(NEW.status='endorsed' AND(OLD.direction<>'incoming' OR OLD.endorsed_supplier_id IS NOT NULL
        OR NEW.endorsed_supplier_id IS NULL OR NEW.supplier_payment_id IS NULL)) THEN
      RAISE EXCEPTION 'CHEQUE_INVALID_TRANSITION: انتقال غير مسموح أو إعادة تخصيص.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.cheque_guard_record_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_guard_record_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_deferred_cheques_guard BEFORE UPDATE OR DELETE ON public.deferred_cheques
FOR EACH ROW EXECUTE FUNCTION public.cheque_guard_record_internal();

CREATE FUNCTION public.cheque_customer_claim_positions_internal(p_customer_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID,customer_id UUID,reference TEXT,principal BIGINT,outstanding BIGINT,occurred_at TIMESTAMPTZ,claim_kind TEXT,origin_kind TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.id,c.party_id,c.reference,c.amount_in_minor_units,
    (c.amount_in_minor_units-COALESCE((SELECT SUM(a.amount_in_minor_units)
      FROM public.customer_collection_cheque_allocations a
      JOIN public.customer_collection_operations o ON o.id=a.operation_id
      WHERE a.claim_id=c.id AND NOT o.is_reversed),0))::BIGINT,
    c.original_debt_at,c.claim_kind,c.origin_kind
  FROM public.cheque_compensation_claims c
  WHERE c.party_kind='customer' AND(p_customer_id IS NULL OR c.party_id=p_customer_id);
$$;
ALTER FUNCTION public.cheque_customer_claim_positions_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_customer_claim_positions_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.cheque_supplier_claim_positions_internal(p_supplier_id UUID DEFAULT NULL)
RETURNS TABLE(id UUID,supplier_id UUID,reference TEXT,principal BIGINT,outstanding BIGINT,occurred_at TIMESTAMPTZ,claim_kind TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT c.id,c.party_id,c.reference,c.amount_in_minor_units,
    (c.amount_in_minor_units-COALESCE((SELECT SUM(a.amount_in_minor_units)
      FROM public.supplier_cheque_claim_payments a JOIN public.supplier_payments p ON p.id=a.supplier_payment_id
      WHERE a.claim_id=c.id AND NOT p.is_reversed),0))::BIGINT,
    c.original_debt_at,c.claim_kind
  FROM public.cheque_compensation_claims c
  WHERE c.party_kind='supplier' AND(p_supplier_id IS NULL OR c.party_id=p_supplier_id);
$$;
ALTER FUNCTION public.cheque_supplier_claim_positions_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_supplier_claim_positions_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.cheque_compensation_claims IS
 'Owner2026-10-16: independent bounce/cancellation debt evidence. Never a reversal of the original payment or Return. Original proven debt date retained.';
COMMENT ON TABLE public.deferred_cheques IS
 'RPC-only deferred cheque lifecycle. Opening registration is tracking only; opening balances are net of outstanding cheques.';

COMMIT;
