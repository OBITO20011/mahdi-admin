BEGIN;

-- Slice5 preparation ONLY. No public RPC/body/trigger/ACL is changed.
-- The four prepared relations deliberately reject all business INSERTs and
-- control UPDATEs. A separately reviewed atomic activation must replace this
-- preparation barrier AFTER all writers/readers/guards/grants are aligned.
-- These pure wire validators are NOT durable settlement authority.

CREATE FUNCTION phase5_private.assert_wire_keys_v1(v JSONB, expected TEXT[])
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actual TEXT[]; ordered TEXT[];
BEGIN
  IF JSONB_TYPEOF(v) IS DISTINCT FROM 'object' OR expected IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_OBJECT_INVALID';
  END IF;
  SELECT ARRAY_AGG(k ORDER BY k) INTO actual FROM JSONB_OBJECT_KEYS(v) k;
  SELECT ARRAY_AGG(k ORDER BY k) INTO ordered FROM UNNEST(expected) k;
  IF actual IS DISTINCT FROM ordered THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_KEYS_INVALID';
  END IF;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION phase5_private.wire_money_v1(v JSONB)
RETURNS BIGINT LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE s TEXT;
BEGIN
  IF JSONB_TYPEOF(v) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_MONEY_INVALID';
  END IF;
  s := v #>> '{}';
  IF s !~ '^(0|[1-9][0-9]{0,18})$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_MONEY_INVALID';
  END IF;
  IF s::NUMERIC > 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'PHASE5_WIRE_MONEY_OVERFLOW';
  END IF;
  RETURN s::BIGINT;
END;
$$;

CREATE FUNCTION phase5_private.wire_uuid_v1(v JSONB)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE s TEXT;
BEGIN
  IF JSONB_TYPEOF(v) IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_UUID_INVALID';
  END IF;
  s := v #>> '{}';
  IF s !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR s = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_WIRE_UUID_INVALID';
  END IF;
  RETURN s::UUID;
END;
$$;

CREATE FUNCTION phase5_private.assert_collection_request_v2(r JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE field TEXT; s TEXT;
BEGIN
  PERFORM phase5_private.assert_wire_keys_v1(r, ARRAY[
    'requestVersion','actorId','orderId','action','idempotencyKey',
    'amountInMinorUnits','tenderMethod','tenderReference','notes'
  ]);
  PERFORM phase5_private.wire_uuid_v1(r->'actorId');
  PERFORM phase5_private.wire_uuid_v1(r->'orderId');
  IF r->'requestVersion' IS DISTINCT FROM '"phase5-customer-collection-v2"'::JSONB
    OR r->'action' IS DISTINCT FROM '"customer_collection"'::JSONB
    OR JSONB_TYPEOF(r->'idempotencyKey') IS DISTINCT FROM 'string'
    OR (r->>'idempotencyKey') IS DISTINCT FROM BTRIM(r->>'idempotencyKey')
    OR CHAR_LENGTH(r->>'idempotencyKey') NOT BETWEEN 1 AND 255
    OR r->'tenderMethod' NOT IN ('"cash"'::JSONB,'"cliq"'::JSONB)
    OR phase5_private.wire_money_v1(r->'amountInMinorUnits') = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_COLLECTION_WIRE_REQUEST_INVALID';
  END IF;
  FOREACH field IN ARRAY ARRAY['tenderReference','notes'] LOOP
    IF r->field IS DISTINCT FROM 'null'::JSONB THEN
      IF JSONB_TYPEOF(r->field) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_COLLECTION_WIRE_REQUEST_INVALID';
      END IF;
      s := r->>field;
      IF s IS DISTINCT FROM BTRIM(s) OR s = ''
        OR (field = 'tenderReference' AND CHAR_LENGTH(s) > 120) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_COLLECTION_WIRE_REQUEST_INVALID';
      END IF;
    END IF;
  END LOOP;
  IF r->'tenderMethod' = '"cliq"'::JSONB AND r->'tenderReference' = 'null'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PHASE5_COLLECTION_WIRE_REQUEST_INVALID';
  END IF;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION phase5_private.normalize_collection_request_v2(
  actor UUID, order_identity UUID, amount BIGINT, method TEXT,
  reference TEXT, notes TEXT, request_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE r JSONB;
BEGIN
  -- This copies a typed server request, not an authorization assertion.
  r := JSONB_BUILD_OBJECT('requestVersion','phase5-customer-collection-v2',
    'actorId',actor,'orderId',order_identity,'action','customer_collection',
    'idempotencyKey',request_key,'amountInMinorUnits',amount::TEXT,
    'tenderMethod',LOWER(BTRIM(method)),
    'tenderReference',NULLIF(BTRIM(reference),''),'notes',NULLIF(BTRIM(notes),''));
  PERFORM phase5_private.assert_collection_request_v2(r);
  RETURN r;
END;
$$;

CREATE FUNCTION phase5_private.assert_collection_result_v2(r JSONB, outcome JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE field TEXT; before_amount BIGINT; after_amount BIGINT; amount BIGINT;
BEGIN
  PERFORM phase5_private.assert_collection_request_v2(r);
  PERFORM phase5_private.assert_wire_keys_v1(outcome, ARRAY[
    'contractVersion','kind','success','actorId','orderId','action','idempotencyKey',
    'requestVersion','requestFingerprint','request','operationId','originalPaymentId',
    'collectionId','paymentNumber','amountInMinorUnits','tenderMethod',
    'tenderReference','notes','outstandingBeforeInMinorUnits','outstandingAfterInMinorUnits'
  ]);
  IF outcome->'contractVersion' IS DISTINCT FROM '"phase5-customer-collection-result-v2"'::JSONB
    OR outcome->'kind' IS DISTINCT FROM '"COMMITTED_COLLECTION"'::JSONB
    OR outcome->'success' IS DISTINCT FROM 'true'::JSONB
    OR outcome->'request' IS DISTINCT FROM r
    OR outcome->>'requestFingerprint' IS DISTINCT FROM
      UPPER(public.phase3_request_fingerprint_internal(r))
    OR JSONB_TYPEOF(outcome->'paymentNumber') IS DISTINCT FROM 'string'
    OR NULLIF(BTRIM(outcome->>'paymentNumber'),'') IS NULL
    OR (outcome->>'paymentNumber') IS DISTINCT FROM BTRIM(outcome->>'paymentNumber') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_WIRE_RESULT_INVALID';
  END IF;
  FOREACH field IN ARRAY ARRAY['actorId','orderId','action','idempotencyKey','requestVersion',
    'amountInMinorUnits','tenderMethod','tenderReference','notes'] LOOP
    IF outcome->field IS DISTINCT FROM r->field THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_WIRE_RESULT_MISMATCH';
    END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['operationId','originalPaymentId','collectionId'] LOOP
    PERFORM phase5_private.wire_uuid_v1(outcome->field);
  END LOOP;
  amount := phase5_private.wire_money_v1(outcome->'amountInMinorUnits');
  before_amount := phase5_private.wire_money_v1(outcome->'outstandingBeforeInMinorUnits');
  after_amount := phase5_private.wire_money_v1(outcome->'outstandingAfterInMinorUnits');
  IF before_amount < amount OR after_amount <> before_amount - amount THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_WIRE_FINANCIAL_MISMATCH';
  END IF;
  RETURN TRUE;
END;
$$;

CREATE TABLE phase5_private.authority_generation (
  singleton BOOLEAN PRIMARY KEY CHECK (singleton),
  generation INTEGER NOT NULL UNIQUE CHECK (generation IN (0,1)),
  authority_state TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9A-F]{64}$'),
  CONSTRAINT phase5_generation_state CHECK (
    (generation = 0 AND authority_state = 'PRIVATE_INACTIVE')
    OR (generation = 1 AND authority_state = 'ACTIVE')
  )
);
INSERT INTO phase5_private.authority_generation VALUES (
  TRUE,0,'PRIVATE_INACTIVE','9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099'
);

CREATE TABLE phase5_private.activation_receipts (
  generation INTEGER PRIMARY KEY CHECK (generation = 1),
  migration_version TEXT NOT NULL UNIQUE CHECK (migration_version ~ '^[0-9]{3,}$'),
  migration_file_sha256 TEXT NOT NULL CHECK (migration_file_sha256 ~ '^[0-9A-F]{64}$'),
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9A-F]{64}$'),
  activated_at TIMESTAMPTZ NOT NULL,
  activation_transaction_id BIGINT NOT NULL CHECK (activation_transaction_id > 0)
);

CREATE TABLE phase5_private.mutation_contexts (
  id UUID PRIMARY KEY,
  transaction_id BIGINT NOT NULL CHECK (transaction_id > 0),
  generation INTEGER NOT NULL CHECK (generation = 1),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  -- Order-rooted purposes retain a mandatory real Order. SHIFT_REVERSAL is
  -- explicitly Shift-rooted; its batch/supplier/expense nodes must NOT invent
  -- an Order. These private columns do not activate any context writer.
  order_id UUID REFERENCES public.orders(id) ON DELETE RESTRICT,
  shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  shift_source_kind TEXT,
  shift_source_id UUID,
  parent_context_id UUID,
  parent_context_kind TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN (
    'CUSTOMER_COLLECTION','CUSTOMER_PAYMENT_REVERSAL','POS_CREATION',
    'CUSTOMER_COMPLETION','LEGACY_WEBSITE_COMPLETION','RETURN_SETTLEMENT',
    'REPLACEMENT_ISSUANCE','POS_CANCELLATION','SHIFT_CLOSE','SHIFT_REVERSAL'
  )),
  operation_id UUID,
  normalized_request JSONB NOT NULL CHECK (JSONB_TYPEOF(normalized_request) = 'object'),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9A-F]{64}$'),
  locked_plan JSONB NOT NULL CHECK (JSONB_TYPEOF(locked_plan) = 'object'),
  CONSTRAINT phase5_context_collection_identity UNIQUE (id,actor_id,order_id,operation_id),
  CONSTRAINT phase5_context_shift_identity UNIQUE
    (id,transaction_id,generation,actor_id,shift_id,shift_source_kind),
  CONSTRAINT phase5_context_shift_parent FOREIGN KEY
    (parent_context_id,transaction_id,generation,actor_id,shift_id,parent_context_kind)
    REFERENCES phase5_private.mutation_contexts
      (id,transaction_id,generation,actor_id,shift_id,shift_source_kind) ON DELETE RESTRICT,
  CONSTRAINT phase5_context_root_shape CHECK (
    (purpose <> 'SHIFT_REVERSAL' AND order_id IS NOT NULL
      AND shift_id IS NULL AND shift_source_kind IS NULL AND shift_source_id IS NULL
      AND parent_context_id IS NULL AND parent_context_kind IS NULL)
    OR (purpose = 'SHIFT_REVERSAL' AND shift_id IS NOT NULL
      AND shift_source_kind IS NOT NULL AND shift_source_id IS NOT NULL AND operation_id IS NOT NULL
      AND ((shift_source_kind = 'BATCH' AND shift_source_id = shift_id AND order_id IS NULL
        AND parent_context_id IS NULL AND parent_context_kind IS NULL)
      OR (shift_source_kind IN ('customer_payment','pos_sale','supplier_payment','operational_expense')
        AND parent_context_id IS NOT NULL AND parent_context_id <> id
        AND parent_context_kind IS NOT NULL AND parent_context_kind = 'BATCH'
        AND ((shift_source_kind = 'customer_payment' AND order_id IS NOT NULL)
          OR (shift_source_kind = 'pos_sale' AND order_id IS NOT NULL AND order_id = shift_source_id)
          OR (shift_source_kind IN ('supplier_payment','operational_expense') AND order_id IS NULL)))))
  )
);

CREATE TABLE phase5_private.collection_attempt_envelopes (
  financial_operation_id UUID PRIMARY KEY
    REFERENCES phase5_private.financial_operation_events(id) ON DELETE RESTRICT,
  collection_id UUID NOT NULL UNIQUE
    REFERENCES phase5_private.collection_events(id) ON DELETE RESTRICT,
  original_payment_id UUID NOT NULL UNIQUE
    REFERENCES public.customer_payments(id) ON DELETE RESTRICT,
  payment_audit_id UUID NOT NULL UNIQUE REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
  context_id UUID NOT NULL UNIQUE,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  request_snapshot JSONB NOT NULL,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9A-F]{64}$'),
  result_snapshot JSONB NOT NULL,
  CONSTRAINT phase5_attempt_actor_key UNIQUE (actor_id,idempotency_key),
  CONSTRAINT phase5_attempt_context FOREIGN KEY(context_id,actor_id,order_id,financial_operation_id)
    REFERENCES phase5_private.mutation_contexts(id,actor_id,order_id,operation_id) ON DELETE RESTRICT,
  CONSTRAINT phase5_attempt_request CHECK (phase5_private.assert_collection_request_v2(request_snapshot)),
  CONSTRAINT phase5_attempt_result CHECK (phase5_private.assert_collection_result_v2(request_snapshot,result_snapshot)),
  CONSTRAINT phase5_attempt_identity CHECK (
    request_snapshot->>'actorId' = actor_id::TEXT
    AND request_snapshot->>'orderId' = order_id::TEXT
    AND request_snapshot->>'idempotencyKey' = idempotency_key
    AND result_snapshot->>'operationId' = financial_operation_id::TEXT
    AND result_snapshot->>'collectionId' = collection_id::TEXT
    AND result_snapshot->>'originalPaymentId' = original_payment_id::TEXT
    AND result_snapshot->>'requestFingerprint' = request_fingerprint
  )
);

-- No partially-implemented coordinator may use these tables as authority.
-- Keeping INSERT barred also prevents adopting an old foundation anchor as a
-- new operational payment. The future generation switch must install complete
-- relational/source/deferred validators before replacing this barrier.
CREATE FUNCTION phase5_private.reject_preparation_write_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PHASE5_PREPARATION_ONLY: No operational authority is activated.';
END;
$$;

CREATE TRIGGER phase5_preparation_generation_barrier
BEFORE INSERT OR UPDATE OR DELETE ON phase5_private.authority_generation
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_preparation_write_v1();
CREATE TRIGGER phase5_preparation_activation_barrier
BEFORE INSERT OR UPDATE OR DELETE ON phase5_private.activation_receipts
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_preparation_write_v1();
CREATE TRIGGER phase5_preparation_context_barrier
BEFORE INSERT OR UPDATE OR DELETE ON phase5_private.mutation_contexts
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_preparation_write_v1();
CREATE TRIGGER phase5_preparation_attempt_barrier
BEFORE INSERT OR UPDATE OR DELETE ON phase5_private.collection_attempt_envelopes
FOR EACH ROW EXECUTE FUNCTION phase5_private.reject_preparation_write_v1();

ALTER TABLE phase5_private.authority_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.authority_generation FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.activation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.activation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.mutation_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.mutation_contexts FORCE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.collection_attempt_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase5_private.collection_attempt_envelopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE phase5_private.authority_generation,phase5_private.activation_receipts,
  phase5_private.mutation_contexts,phase5_private.collection_attempt_envelopes
  FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE phase5_private.authority_generation OWNER TO postgres;
ALTER TABLE phase5_private.activation_receipts OWNER TO postgres;
ALTER TABLE phase5_private.mutation_contexts OWNER TO postgres;
ALTER TABLE phase5_private.collection_attempt_envelopes OWNER TO postgres;

REVOKE ALL ON FUNCTION phase5_private.assert_wire_keys_v1(JSONB,TEXT[]),
  phase5_private.wire_money_v1(JSONB),phase5_private.wire_uuid_v1(JSONB),
  phase5_private.assert_collection_request_v2(JSONB),
  phase5_private.normalize_collection_request_v2(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT),
  phase5_private.assert_collection_result_v2(JSONB,JSONB),
  phase5_private.reject_preparation_write_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_wire_keys_v1(JSONB,TEXT[]) OWNER TO postgres;
ALTER FUNCTION phase5_private.wire_money_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.wire_uuid_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_request_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.normalize_collection_request_v2(UUID,UUID,BIGINT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_result_v2(JSONB,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.reject_preparation_write_v1() OWNER TO postgres;

-- Preparation building blocks, not an operational entrypoint. Authorization
-- derives the actor from the authenticated context; a request actor is only an
-- equality assertion. Neither a caller-supplied actor nor a discovered plan
-- can mint a transaction permit. Generation0 barriers remain installed.
CREATE FUNCTION phase5_private.authorize_collection_request_v2(r JSONB)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID := auth.uid();
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor, TRUE);
  PERFORM phase5_private.assert_collection_request_v2(r);
  IF phase5_private.wire_uuid_v1(r->'actorId') IS DISTINCT FROM actor THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PHASE5_COLLECTION_ACTOR_MISMATCH';
  END IF;
  RETURN actor;
END;
$$;

-- This is a content-sensitive DISCOVERY snapshot for the standalone collection
-- path only. It deliberately says NOT_LOCKED and is NOT a complete held-lock
-- certificate for a parent completion, reversal or batch. The future executor
-- must merge that parent's full plan, acquire the canonical ranks, and compare
-- fresh discovery before the FIRST context/source/evidence write.
CREATE FUNCTION phase5_private.collection_plan_resources_v2(order_identity UUID, facts JSONB)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
  WITH resources(kind, row_data) AS (
    SELECT n->>'kind',n->'row' FROM JSONB_ARRAY_ELEMENTS(facts->'discoveredEvidence') n
    UNION ALL SELECT 'xe',TO_JSONB(e) FROM public.phase43_replacement_settlement_evidence e WHERE e.order_id=order_identity
    UNION ALL SELECT 'xi',TO_JSONB(e) FROM public.phase43_replacement_inventory_effects e
      JOIN public.sales_replacement_events h ON h.id=e.replacement_event_id WHERE h.root_order_id=order_identity
    UNION ALL SELECT 'm',TO_JSONB(m) FROM public.inventory_movements m WHERE EXISTS (
      SELECT 1 FROM public.sales_replacement_items i JOIN public.sales_replacement_events h ON h.id=i.replacement_event_id
      WHERE h.root_order_id=order_identity AND m.reference_type='phase4_replacement_item' AND m.reference_id=i.id)
      OR EXISTS (SELECT 1 FROM public.phase43_replacement_inventory_effects e
        JOIN public.sales_replacement_events h ON h.id=e.replacement_event_id
        WHERE h.root_order_id=order_identity AND e.inventory_movement_id=m.id)
      OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(facts->'discoveredEvidence') n
        WHERE n->>'kind'='b' AND n->'row'->>'id'=m.operation_id::TEXT)
    UNION ALL SELECT 'ae',TO_JSONB(e) FROM phase5_private.collection_attempt_envelopes e WHERE e.order_id=order_identity
    UNION ALL SELECT 'ct',TO_JSONB(c) FROM phase5_private.mutation_contexts c WHERE EXISTS (
      SELECT 1 FROM phase5_private.collection_attempt_envelopes e WHERE e.order_id=order_identity AND e.context_id=c.id)
  ), mapped AS (
    SELECT kind,row_data,CASE kind
      WHEN 'o' THEN 'public.orders' WHEN 'b' THEN 'public.business_operations'
      WHEN 'f' THEN 'phase5_private.financial_operation_events' WHEN 'p' THEN 'public.customer_payments'
      WHEN 'c' THEN 'phase5_private.collection_events' WHEN 'v' THEN 'phase5_private.payment_reversal_events'
      WHEN 't' THEN 'phase5_private.reversal_tender_movements' WHEN 'd' THEN 'phase5_private.reversal_coordinator_completions'
      WHEN 'r' THEN 'public.sales_return_events' WHEN 'i' THEN 'public.sales_return_items'
      WHEN 'n' THEN 'public.sales_return_component_inspections' WHEN 'u' THEN 'public.sales_aftercare_consumptions'
      WHEN 'e' THEN 'public.phase42_return_settlement_evidence' WHEN 'x' THEN 'public.phase42_return_inventory_effects'
      WHEN 'm' THEN 'public.inventory_movements' WHEN 's' THEN 'public.order_items'
      WHEN 'h' THEN 'public.order_parcel_instances' WHEN 'a' THEN 'public.order_parcel_components'
      WHEN 'z' THEN 'public.sales_replacement_items' WHEN 'k' THEN 'public.sales_replacement_events'
      WHEN 'xe' THEN 'public.phase43_replacement_settlement_evidence' WHEN 'xi' THEN 'public.phase43_replacement_inventory_effects'
      WHEN 'ae' THEN 'phase5_private.collection_attempt_envelopes' WHEN 'ct' THEN 'phase5_private.mutation_contexts'
    END relation_name,COALESCE(row_data->>'id',row_data->>'operation_id',row_data->>'financial_operation_id') identity
    FROM resources
  ), exact_rows AS (SELECT DISTINCT * FROM mapped)
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('kind',kind,'relation',relation_name,
    'id',identity,'row',row_data) ORDER BY relation_name,identity),'[]'::JSONB) FROM exact_rows;
$$;

CREATE FUNCTION phase5_private.discover_collection_write_plan_v2(r JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID; order_identity UUID; o public.orders%ROWTYPE;
  facts JSONB; position JSONB; current_shift JSONB;
  shift_ids UUID[]; shifts JSONB; parents JSONB; actor_ids UUID[];
BEGIN
  actor := phase5_private.authorize_collection_request_v2(r);
  order_identity := phase5_private.wire_uuid_v1(r->'orderId');
  SELECT * INTO STRICT o FROM public.orders WHERE id = order_identity;
  IF o.customer_id IS NULL OR o.branch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_PARENT_REQUIRED';
  END IF;
  -- The frozen private read validator refuses Legacy/unsupported/incomplete
  -- source populations. Never replace it with public amount_paid or a SUM of
  -- only the evidence that happens to be present.
  facts := phase5_private.read_order_financial_facts_v1(order_identity);
  position := phase5_private.derive_financial_position_v1(facts);
  IF phase5_private.wire_money_v1(r->'amountInMinorUnits') >
    phase5_private.money_v1(position->'outstandingTotalInMinorUnits') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_EXCEEDS_OUTSTANDING';
  END IF;
  IF r->>'tenderMethod' = 'cash' THEN
    SELECT TO_JSONB(s) INTO current_shift FROM public.cash_shifts s
      WHERE s.branch_id = o.branch_id AND s.status = 'open';
    IF current_shift IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_OPEN_SHIFT_REQUIRED';
    END IF;
    IF (SELECT COUNT(*) FROM public.cash_shifts s
      WHERE s.branch_id = o.branch_id AND s.status = 'open') <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_SHIFT_AMBIGUOUS';
    END IF;
  END IF;
  SELECT ARRAY_AGG(DISTINCT identity ORDER BY identity) INTO shift_ids FROM (
    SELECT (current_shift->>'id')::UUID identity
    UNION ALL SELECT (s->>'originalCashShiftId')::UUID
      FROM JSONB_ARRAY_ELEMENTS(facts->'sources') s
    UNION ALL SELECT (n->'row'->>field)::UUID
      FROM JSONB_ARRAY_ELEMENTS(facts->'discoveredEvidence') n
      CROSS JOIN UNNEST(ARRAY['cash_shift_id','actual_cash_shift_id']) field
  ) candidates WHERE identity IS NOT NULL;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('row',TO_JSONB(s),
    'mode',CASE WHEN s.id = (current_shift->>'id')::UUID THEN 'UPDATE' ELSE 'KEY_SHARE' END)
    ORDER BY s.id),'[]'::JSONB) INTO shifts FROM public.cash_shifts s WHERE s.id = ANY(shift_ids);
  IF JSONB_ARRAY_LENGTH(shifts) IS DISTINCT FROM COALESCE(CARDINALITY(shift_ids),0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_SHIFT_EVIDENCE_MISSING';
  END IF;
  SELECT ARRAY_AGG(DISTINCT identity ORDER BY identity) INTO actor_ids FROM (
    SELECT actor identity
    UNION ALL SELECT (n->'row'->>field)::UUID
      FROM JSONB_ARRAY_ELEMENTS(facts->'discoveredEvidence') n
      CROSS JOIN UNNEST(ARRAY['created_by','initiated_by','actor_id','actor_scope_id',
        'settled_by','reversed_by']) field
  ) candidates WHERE identity IS NOT NULL;
  parents := JSONB_BUILD_OBJECT(
    'customer',(SELECT TO_JSONB(c) FROM public.customers c WHERE c.id = o.customer_id),
    'branch',(SELECT TO_JSONB(b) FROM public.branches b WHERE b.id = o.branch_id),
    'profiles',(SELECT COALESCE(JSONB_AGG(TO_JSONB(p) ORDER BY p.id),'[]'::JSONB)
      FROM public.profiles p WHERE p.id = ANY(actor_ids)),
    'actorRoles',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),
      'role',TO_JSONB(role)) ORDER BY ur.role_id),'[]'::JSONB)
      FROM public.user_roles ur JOIN public.roles role ON role.id = ur.role_id WHERE ur.user_id = actor));
  IF parents->'customer' = 'null'::JSONB OR parents->'branch' = 'null'::JSONB
    OR JSONB_ARRAY_LENGTH(parents->'profiles') IS DISTINCT FROM CARDINALITY(actor_ids) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_FK_PARENT_MISSING';
  END IF;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-collection-discovery-v2',
    'planState','DISCOVERED_NOT_LOCKED','actorId',actor,'orderId',order_identity,
    'request',r,'requestFingerprint',UPPER(public.phase3_request_fingerprint_internal(r)),
    'order',TO_JSONB(o),'facts',facts,'position',position,
    'currentShift',current_shift,'shifts',shifts,'parents',parents,
    'resources',phase5_private.collection_plan_resources_v2(order_identity,facts));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'PHASE5_COLLECTION_SOURCE_INCOMPLETE';
END;
$$;

-- Rank0 for a future NEW mutation, never required by committed replay.
-- Still unusable for operational writes in this prepared generation0 schema.
-- The caller must subsequently acquire keys/root/Shift/source/FK ranks and
-- fresh revalidation; this function alone cannot mint a mutation context.
CREATE FUNCTION phase5_private.lock_collection_generation_v2(r JSONB)
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE g phase5_private.authority_generation%ROWTYPE;
BEGIN
  PERFORM phase5_private.authorize_collection_request_v2(r);
  SELECT * INTO STRICT g FROM phase5_private.authority_generation
    WHERE singleton FOR SHARE NOWAIT;
  IF g.generation IS DISTINCT FROM 1 OR g.authority_state IS DISTINCT FROM 'ACTIVE'
    OR g.manifest_sha256 IS DISTINCT FROM '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099'
    OR NOT EXISTS (SELECT 1 FROM phase5_private.activation_receipts a
      WHERE a.generation = g.generation AND a.manifest_sha256 = g.manifest_sha256) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PHASE5_PREPARATION_ONLY: No collection authority is activated.';
  END IF;
  RETURN g.generation;
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PHASE5_COLLECTION_GENERATION_BUSY_RETRY';
WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PHASE5_COLLECTION_GENERATION_UNAVAILABLE';
END;
$$;

CREATE FUNCTION phase5_private.assert_collection_plan_unchanged_v2(r JSONB, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actual JSONB;
BEGIN
  actual := phase5_private.discover_collection_write_plan_v2(r);
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PHASE5_COLLECTION_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION phase5_private.authorize_collection_request_v2(JSONB),
  phase5_private.discover_collection_write_plan_v2(JSONB),
  phase5_private.lock_collection_generation_v2(JSONB),
  phase5_private.assert_collection_plan_unchanged_v2(JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.authorize_collection_request_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.discover_collection_write_plan_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.lock_collection_generation_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_plan_unchanged_v2(JSONB,JSONB) OWNER TO postgres;

-- Standalone NEW collection only. Parent/batch paths must not call this after
-- taking their own locks: those purposes require their future merged executor.
-- No dynamically constructed SQL, caller-chosen relation, or late lock upgrade.
CREATE FUNCTION phase5_private.lock_collection_write_plan_v2(r JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID; order_identity UUID; key_name TEXT; plan JSONB; n JSONB; identity UUID;
BEGIN
  actor := phase5_private.authorize_collection_request_v2(r);
  order_identity := phase5_private.wire_uuid_v1(r->'orderId');
  IF EXISTS (SELECT 1 FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation
    LEFT JOIN pg_index index_parent ON index_parent.indexrelid=c.oid
    LEFT JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted
      AND (l.locktype='advisory' OR (ns.nspname IN ('public','phase5_private')
        AND l.mode NOT IN ('AccessShareLock')
        -- Index locks inherit their owning table's control/business domain.
        -- This never exempts an index belonging to a business evidence table.
        AND COALESCE(index_parent.indrelid,c.oid) NOT IN
          ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS)
        -- Owner-only barrier DDL is not a supported business entrypoint. This
        -- allows rollback-only preparation instrumentation, not prior context
        -- DML/row locks or any public business-resource lock.
        AND NOT (c.oid='phase5_private.mutation_contexts'::REGCLASS AND l.mode='ShareRowExclusiveLock')))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LATE_ENTRY_RETRY';
  END IF;
  PERFORM phase5_private.lock_collection_generation_v2(r);
  FOR key_name IN SELECT v FROM UNNEST(ARRAY[
    actor::TEXT || ':' || (r->>'idempotencyKey'),
    'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_collection_v1|' || (r->>'idempotencyKey'),
    'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_collection_v2|' || (r->>'idempotencyKey')
  ]) v ORDER BY v COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.customer_payments WHERE created_by=actor AND idempotency_key=r->>'idempotencyKey')
    OR EXISTS (SELECT 1 FROM phase5_private.financial_operation_events
      WHERE actor_scope_id=actor AND idempotency_key=r->>'idempotencyKey')
    OR EXISTS (SELECT 1 FROM phase5_private.collection_attempt_envelopes
      WHERE actor_id=actor AND idempotency_key=r->>'idempotencyKey') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_EXISTING_ATTEMPT_REQUIRES_RESOLVER';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phase4-order|' || order_identity::TEXT,0));
  plan := phase5_private.discover_collection_write_plan_v2(r);
  FOR key_name IN SELECT v FROM (
    SELECT 'cash-shift-full-reversal:' || (s->'row'->>'id') v FROM JSONB_ARRAY_ELEMENTS(plan->'shifts') s
    UNION SELECT 'pos-sale-reversal:' || order_identity::TEXT WHERE plan->'order'->>'source'='pos'
  ) gates ORDER BY v COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'shifts') ORDER BY value->'row'->>'id' LOOP
    identity := phase5_private.wire_uuid_v1(n->'row'->'id');
    IF n->>'mode'='UPDATE' THEN
      PERFORM 1 FROM public.cash_shifts WHERE id=identity FOR UPDATE NOWAIT;
    ELSIF n->>'mode'='KEY_SHARE' THEN
      PERFORM 1 FROM public.cash_shifts WHERE id=identity FOR KEY SHARE NOWAIT;
    ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_PLAN_INVALID'; END IF;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  PERFORM 1 FROM public.orders WHERE id=order_identity FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_PLAN_CHANGED'; END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources')
    ORDER BY value->>'relation' COLLATE "C",value->>'id' COLLATE "C" LOOP
    identity := phase5_private.wire_uuid_v1(n->'id');
    CASE n->>'kind'
      WHEN 'o' THEN
        IF identity IS DISTINCT FROM order_identity THEN RAISE EXCEPTION 'PHASE5_COLLECTION_LOCK_PLAN_INVALID'; END IF;
        CONTINUE;
      WHEN 'b' THEN PERFORM 1 FROM public.business_operations WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'f' THEN PERFORM 1 FROM phase5_private.financial_operation_events WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'p' THEN PERFORM 1 FROM public.customer_payments WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'c' THEN PERFORM 1 FROM phase5_private.collection_events WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'v' THEN PERFORM 1 FROM phase5_private.payment_reversal_events WHERE id=identity FOR SHARE NOWAIT;
      WHEN 't' THEN PERFORM 1 FROM phase5_private.reversal_tender_movements WHERE operation_id=identity FOR SHARE NOWAIT;
      WHEN 'd' THEN PERFORM 1 FROM phase5_private.reversal_coordinator_completions WHERE operation_id=identity FOR SHARE NOWAIT;
      WHEN 'r' THEN PERFORM 1 FROM public.sales_return_events WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'i' THEN PERFORM 1 FROM public.sales_return_items WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'n' THEN PERFORM 1 FROM public.sales_return_component_inspections WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'u' THEN PERFORM 1 FROM public.sales_aftercare_consumptions WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'e' THEN PERFORM 1 FROM public.phase42_return_settlement_evidence WHERE operation_id=identity FOR SHARE NOWAIT;
      WHEN 'x' THEN PERFORM 1 FROM public.phase42_return_inventory_effects WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'm' THEN PERFORM 1 FROM public.inventory_movements WHERE id=identity FOR SHARE NOWAIT;
      WHEN 's' THEN PERFORM 1 FROM public.order_items WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'h' THEN PERFORM 1 FROM public.order_parcel_instances WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'a' THEN PERFORM 1 FROM public.order_parcel_components WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'z' THEN PERFORM 1 FROM public.sales_replacement_items WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'k' THEN PERFORM 1 FROM public.sales_replacement_events WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'xe' THEN PERFORM 1 FROM public.phase43_replacement_settlement_evidence WHERE operation_id=identity FOR SHARE NOWAIT;
      WHEN 'xi' THEN PERFORM 1 FROM public.phase43_replacement_inventory_effects WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'ae' THEN PERFORM 1 FROM phase5_private.collection_attempt_envelopes WHERE financial_operation_id=identity FOR SHARE NOWAIT;
      WHEN 'ct' THEN PERFORM 1 FROM phase5_private.mutation_contexts WHERE id=identity FOR SHARE NOWAIT;
      ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_PLAN_INVALID';
    END CASE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  -- Deterministic FK/auth parents. SHARE freezes non-key authorization/content
  -- as well as protecting identity; no later upgrade is used in this path.
  PERFORM 1 FROM public.branches WHERE id=(plan->'parents'->'branch'->>'id')::UUID FOR SHARE NOWAIT;
  PERFORM 1 FROM public.customers WHERE id=(plan->'parents'->'customer'->>'id')::UUID FOR SHARE NOWAIT;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'parents'->'profiles') ORDER BY value->>'id' LOOP
    PERFORM 1 FROM public.profiles WHERE id=(n->>'id')::UUID FOR SHARE NOWAIT;
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'parents'->'actorRoles') ORDER BY value->'role'->>'id' LOOP
    PERFORM 1 FROM public.roles WHERE id=(n->'role'->>'id')::UUID FOR SHARE NOWAIT;
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'parents'->'actorRoles') ORDER BY value->'membership'->>'role_id' LOOP
    PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role_id=(n->'membership'->>'role_id')::UUID FOR SHARE NOWAIT;
  END LOOP;
  PERFORM phase5_private.assert_collection_plan_unchanged_v2(r,plan);
  RETURN plan || JSONB_BUILD_OBJECT('planState','LOCKED_STANDALONE_COLLECTION');
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_LOCK_CONTENTION_RETRY';
END;
$$;

CREATE FUNCTION phase5_private.enter_authority_context_v1(
  claimed_actor UUID, purpose TEXT, order_identity UUID, details JSONB
)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID; operation_identity UUID; request JSONB; plan JSONB; context_identity UUID := gen_random_uuid();
  event_at TIMESTAMPTZ; number TEXT;
BEGIN
  actor := auth.uid();
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  IF actor IS DISTINCT FROM claimed_actor OR purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_CONTEXT_PURPOSE_OR_ACTOR_UNSUPPORTED';
  END IF;
  PERFORM phase5_private.assert_wire_keys_v1(details,ARRAY['request','operationId']);
  request := details->'request'; operation_identity := phase5_private.wire_uuid_v1(details->'operationId');
  PERFORM phase5_private.authorize_collection_request_v2(request);
  IF phase5_private.wire_uuid_v1(request->'orderId') IS DISTINCT FROM order_identity THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_CONTEXT_ORDER_MISMATCH';
  END IF;
  plan := phase5_private.lock_collection_write_plan_v2(request);
  IF EXISTS (SELECT 1 FROM phase5_private.financial_operation_events WHERE id=operation_identity)
    OR EXISTS (SELECT 1 FROM public.business_operations WHERE id=operation_identity)
    OR EXISTS (SELECT 1 FROM phase5_private.mutation_contexts WHERE operation_id=operation_identity) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_CONTEXT_OPERATION_ALREADY_EXISTS';
  END IF;
  -- Receipt identity/time are authoritative prewrite facts, not values later
  -- copied from a source row under validation. Sequence rollback gaps remain.
  event_at := clock_timestamp();
  number := 'CRV-' || TO_CHAR(event_at AT TIME ZONE 'UTC','YYYYMMDD') || '-'
    || LPAD(NEXTVAL('public.customer_payment_number_seq')::TEXT,6,'0');
  plan := plan || JSONB_BUILD_OBJECT('operationId',operation_identity,
    'paymentId',gen_random_uuid(),'collectionId',gen_random_uuid(),'auditId',gen_random_uuid(),
    'paymentEventAt',TO_CHAR(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'paymentNumber',number);
  INSERT INTO phase5_private.mutation_contexts(id,transaction_id,generation,actor_id,order_id,
    purpose,operation_id,normalized_request,request_fingerprint,locked_plan)
    VALUES(context_identity,txid_current(),1,actor,order_identity,'CUSTOMER_COLLECTION',operation_identity,
      request,UPPER(public.phase3_request_fingerprint_internal(request)),plan);
  RETURN context_identity;
END;
$$;

-- PRE-FIRST-SOURCE-WRITE assertion only. The later completion validator must
-- prove the exact intended delta against this frozen plan, not demand that a
-- newly inserted legitimate payment leave the pre-write graph unchanged.
CREATE FUNCTION phase5_private.assert_collection_context_v2(context_identity UUID, r JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID; c phase5_private.mutation_contexts%ROWTYPE;
BEGIN
  actor := phase5_private.authorize_collection_request_v2(r);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  IF c.transaction_id IS DISTINCT FROM txid_current() OR c.generation IS DISTINCT FROM 1
    OR c.actor_id IS DISTINCT FROM actor OR c.order_id IS DISTINCT FROM (r->>'orderId')::UUID
    OR c.purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION' OR c.operation_id IS NULL
    OR c.normalized_request IS DISTINCT FROM r
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r))
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'
    OR c.locked_plan->>'operationId' IS DISTINCT FROM c.operation_id::TEXT
    OR NOT EXISTS (SELECT 1 FROM phase5_private.authority_generation g
      JOIN phase5_private.activation_receipts a ON a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256
      WHERE g.singleton AND g.generation=1 AND g.authority_state='ACTIVE'
        AND g.manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_CONTEXT_INVALID';
  END IF;
  PERFORM phase5_private.assert_collection_plan_unchanged_v2(r,
    (c.locked_plan - ARRAY['operationId','paymentId','collectionId','auditId','paymentEventAt','paymentNumber'])
      || JSONB_BUILD_OBJECT('planState','DISCOVERED_NOT_LOCKED'));
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'paymentId');
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'collectionId');
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'auditId');
  RETURN TO_JSONB(c);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_CONTEXT_INVALID';
END;
$$;

REVOKE ALL ON FUNCTION phase5_private.collection_plan_resources_v2(UUID,JSONB),
  phase5_private.lock_collection_write_plan_v2(JSONB),
  phase5_private.enter_authority_context_v1(UUID,TEXT,UUID,JSONB),
  phase5_private.assert_collection_context_v2(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.collection_plan_resources_v2(UUID,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.lock_collection_write_plan_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.enter_authority_context_v1(UUID,TEXT,UUID,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_context_v2(UUID,JSONB) OWNER TO postgres;

-- Historical committed-position proof, NOT current eligibility or a new lock
-- plan. The immutable server-owned prewrite snapshot is re-derived and every
-- captured money source is checked against its independent durable anchor.
CREATE FUNCTION phase5_private.validate_collection_before_snapshot_v1(c JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE f JSONB := c->'locked_plan'->'facts'; position JSONB; n JSONB; actual JSONB;
  order_identity UUID := (c->>'order_id')::UUID; o public.orders%ROWTYPE;
BEGIN
  SELECT * INTO STRICT o FROM public.orders WHERE id=order_identity;
  IF c->'locked_plan'->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'
    OR f->>'orderId' IS DISTINCT FROM order_identity::TEXT
    OR c->'locked_plan'->'order'->>'customer_id' IS DISTINCT FROM o.customer_id::TEXT
    OR c->'locked_plan'->'order'->>'branch_id' IS DISTINCT FROM o.branch_id::TEXT
    OR c->'locked_plan'->'order'->>'operation_id' IS DISTINCT FROM o.operation_id::TEXT
    OR c->'locked_plan'->'order'->>'source' IS DISTINCT FROM o.source
    OR phase5_private.money_v1(f->'totalInMinorUnits') IS DISTINCT FROM o.total_in_minor_units
    OR phase5_private.money_v1(f->'deliveryInMinorUnits') IS DISTINCT FROM o.delivery_fee_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_ANCHOR_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(f->'sources') s
    GROUP BY s->>'kind',s->>'sourceId' HAVING COUNT(*)<>1)
    OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(f->'returns') s
      GROUP BY s->>'operation_id' HAVING COUNT(*)<>1)
    OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(f->'reversals') s
      GROUP BY s->>'operation_id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_SET_INVALID';
  END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(f->'sources') LOOP
    actual := phase5_private.collection_source_v1(order_identity,n->>'kind',(n->>'sourceId')::UUID);
    IF actual IS DISTINCT FROM n THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_ANCHOR_INVALID';
    END IF;
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(f->'returns') LOOP
    SELECT TO_JSONB(t) INTO STRICT actual FROM public.sales_return_events t WHERE id=(n->>'id')::UUID;
    PERFORM public.phase42_assert_operational_return_evidence_internal((n->>'operation_id')::UUID,true);
    IF actual IS DISTINCT FROM n OR n->>'order_id' IS DISTINCT FROM order_identity::TEXT
      OR phase5_private.return_entitlement_v1((n->>'operation_id')::UUID)
        IS DISTINCT FROM (n->>'merchandise_refund_amount_in_minor_units')::NUMERIC THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_ANCHOR_INVALID';
    END IF;
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(f->'reversals') LOOP
    PERFORM phase5_private.validate_operational_reversal_v1((n->>'operation_id')::UUID);
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.reversal_tender_movements t
      WHERE operation_id=(n->>'operation_id')::UUID;
    IF actual IS DISTINCT FROM n OR n->>'order_id' IS DISTINCT FROM order_identity::TEXT THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_ANCHOR_INVALID';
    END IF;
  END LOOP;
  position := phase5_private.derive_financial_position_v1(f);
  IF position IS DISTINCT FROM c->'locked_plan'->'position' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_POSITION_INVALID';
  END IF;
  RETURN position;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_BEFORE_ANCHOR_INVALID';
END;
$$;

-- Same central relational validator for first completion and historical replay.
-- No current-generation/open-Shift/status gate, locks or projection repair here.
CREATE FUNCTION phase5_private.validate_collection_attempt_v1(operation_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE e phase5_private.collection_attempt_envelopes%ROWTYPE;
  c phase5_private.mutation_contexts%ROWTYPE; p public.customer_payments%ROWTYPE;
  op phase5_private.financial_operation_events%ROWTYPE; a public.audit_logs%ROWTYPE;
  r JSONB; position JSONB; expected JSONB; before_amount BIGINT; amount BIGINT;
BEGIN
  SELECT * INTO STRICT e FROM phase5_private.collection_attempt_envelopes WHERE financial_operation_id=operation_identity;
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=e.context_id;
  SELECT * INTO STRICT p FROM public.customer_payments WHERE id=e.original_payment_id;
  SELECT * INTO STRICT op FROM phase5_private.financial_operation_events WHERE id=operation_identity;
  SELECT * INTO STRICT a FROM public.audit_logs WHERE id=e.payment_audit_id;
  r := c.normalized_request; PERFORM phase5_private.assert_collection_request_v2(r);
  PERFORM phase5_private.validate_customer_collection_operation_v1(operation_identity);
  IF c.generation IS DISTINCT FROM 1 OR c.purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION'
    OR c.operation_id IS DISTINCT FROM operation_identity
    OR c.actor_id IS DISTINCT FROM e.actor_id OR c.order_id IS DISTINCT FROM e.order_id
    OR c.locked_plan->>'planVersion' IS DISTINCT FROM 'phase5-collection-discovery-v2'
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'
    OR c.locked_plan->'request' IS DISTINCT FROM r
    OR c.locked_plan->>'actorId' IS DISTINCT FROM e.actor_id::TEXT
    OR c.locked_plan->>'orderId' IS DISTINCT FROM e.order_id::TEXT
    OR c.locked_plan->>'requestFingerprint' IS DISTINCT FROM c.request_fingerprint
    OR c.locked_plan->>'operationId' IS DISTINCT FROM operation_identity::TEXT
    OR c.locked_plan->>'paymentId' IS DISTINCT FROM p.id::TEXT
    OR c.locked_plan->>'collectionId' IS DISTINCT FROM e.collection_id::TEXT
    OR c.locked_plan->>'auditId' IS DISTINCT FROM a.id::TEXT
    OR r IS DISTINCT FROM e.request_snapshot
    OR r->>'actorId' IS DISTINCT FROM e.actor_id::TEXT OR r->>'orderId' IS DISTINCT FROM e.order_id::TEXT
    OR r->>'idempotencyKey' IS DISTINCT FROM e.idempotency_key
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r))
    OR e.request_fingerprint IS DISTINCT FROM c.request_fingerprint
    OR op.actor_scope_id IS DISTINCT FROM e.actor_id OR op.idempotency_key IS DISTINCT FROM e.idempotency_key
    OR p.created_by IS DISTINCT FROM e.actor_id OR p.order_id IS DISTINCT FROM e.order_id
    OR p.customer_id::TEXT IS DISTINCT FROM c.locked_plan->'order'->>'customer_id'
    OR p.idempotency_key IS DISTINCT FROM e.idempotency_key OR p.created_at IS DISTINCT FROM op.operation_event_at
    OR c.locked_plan->>'paymentNumber' IS DISTINCT FROM p.payment_number
    OR c.locked_plan->>'paymentEventAt' IS DISTINCT FROM
      TO_CHAR(op.operation_event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    OR p.payment_method IS DISTINCT FROM r->>'tenderMethod' OR p.reference_number IS DISTINCT FROM r->>'tenderReference'
    OR p.notes IS DISTINCT FROM r->>'notes' OR p.is_reversed IS DISTINCT FROM false
    OR p.reversed_at IS NOT NULL OR p.reversed_by IS NOT NULL OR p.reversal_reason IS NOT NULL
    OR p.amount_in_minor_units IS DISTINCT FROM phase5_private.wire_money_v1(r->'amountInMinorUnits')
    OR p.cash_shift_id::TEXT IS DISTINCT FROM c.locked_plan->'currentShift'->>'id'
    OR EXISTS (SELECT 1 FROM phase5_private.payment_reversal_events WHERE financial_operation_id=operation_identity)
    OR EXISTS (SELECT 1 FROM phase5_private.reversal_tender_movements WHERE operation_id=operation_identity)
    OR EXISTS (SELECT 1 FROM phase5_private.reversal_coordinator_completions WHERE operation_id=operation_identity)
    OR EXISTS (SELECT 1 FROM public.business_operations WHERE id=operation_identity) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_BINDING_INVALID';
  END IF;
  -- The expected identity originates in the prewrite plan, not these children.
  IF (SELECT COUNT(*) FROM phase5_private.collection_events WHERE financial_operation_id=operation_identity)<>1
    OR NOT EXISTS (SELECT 1 FROM phase5_private.collection_events WHERE id=e.collection_id
      AND financial_operation_id=operation_identity AND original_payment_id=p.id)
    OR (SELECT COUNT(*) FROM public.customer_payments WHERE created_by=e.actor_id AND idempotency_key=e.idempotency_key)<>1
    OR (SELECT COUNT(*) FROM public.audit_logs WHERE entity_id=p.id AND action='RECORD_CUSTOMER_PAYMENT')<>1
    OR a.user_id IS DISTINCT FROM e.actor_id OR a.entity_id IS DISTINCT FROM p.id
    OR a.entity_name IS DISTINCT FROM 'customer_payments' OR a.action IS DISTINCT FROM 'RECORD_CUSTOMER_PAYMENT'
    OR a.created_at IS DISTINCT FROM op.operation_event_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_SET_INVALID';
  END IF;
  position := phase5_private.validate_collection_before_snapshot_v1(TO_JSONB(c));
  before_amount := phase5_private.money_v1(position->'outstandingTotalInMinorUnits'); amount := p.amount_in_minor_units;
  IF before_amount<amount OR a.details IS DISTINCT FROM JSONB_BUILD_OBJECT(
    'contractVersion','phase5-collection-audit-v2','operationId',operation_identity,
    'orderId',e.order_id,'paymentNumber',p.payment_number,'request',r,'requestFingerprint',e.request_fingerprint) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_BINDING_INVALID';
  END IF;
  expected := r || JSONB_BUILD_OBJECT('contractVersion','phase5-customer-collection-result-v2',
    'kind','COMMITTED_COLLECTION','success',true,'request',r,'requestFingerprint',e.request_fingerprint,
    'operationId',operation_identity,'originalPaymentId',p.id,'collectionId',e.collection_id,
    'paymentNumber',p.payment_number,'outstandingBeforeInMinorUnits',before_amount::TEXT,
    'outstandingAfterInMinorUnits',(before_amount-amount)::TEXT);
  PERFORM phase5_private.assert_collection_result_v2(r,expected);
  IF expected IS DISTINCT FROM e.result_snapshot THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_RESULT_INVALID';
  END IF;
  RETURN e.result_snapshot;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_INCOMPLETE';
END;
$$;

CREATE FUNCTION phase5_private.complete_collection_attempt_v1(operation_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; outcome JSONB; position JSONB;
BEGIN
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE operation_id=operation_identity;
  PERFORM phase5_private.authorize_collection_request_v2(c.normalized_request);
  IF c.transaction_id IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_CONTEXT_INVALID';
  END IF;
  outcome := phase5_private.validate_collection_attempt_v1(operation_identity);
  position := phase5_private.read_order_financial_position_v1(c.order_id);
  IF phase5_private.money_v1(position->'outstandingTotalInMinorUnits')
      IS DISTINCT FROM phase5_private.wire_money_v1(outcome->'outstandingAfterInMinorUnits')
    OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id=c.order_id
      AND amount_paid_in_minor_units=phase5_private.money_v1(position->'collectionCoverageInMinorUnits')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_COMPLETION_PROJECTION_INVALID';
  END IF;
  RETURN outcome;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_ATTEMPT_INCOMPLETE';
END;
$$;

CREATE FUNCTION phase5_private.create_customer_payment_prelocked_v1(
  context_identity UUID, payment_identity UUID, operation_identity UUID, r JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; event_at TIMESTAMPTZ; number TEXT; inner_request JSONB; inner_result JSONB;
  outcome JSONB; amount BIGINT; before_amount BIGINT; coverage BIGINT; collection_identity UUID; audit_identity UUID;
BEGIN
  c := phase5_private.assert_collection_context_v2(context_identity,r);
  IF c->>'operation_id' IS DISTINCT FROM operation_identity::TEXT
    OR c->'locked_plan'->>'paymentId' IS DISTINCT FROM payment_identity::TEXT
    OR EXISTS (SELECT 1 FROM public.customer_payments WHERE id=payment_identity)
    OR EXISTS (SELECT 1 FROM phase5_private.collection_attempt_envelopes WHERE context_id=context_identity) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_PREALLOCATED_IDENTITY_INVALID';
  END IF;
  amount := phase5_private.wire_money_v1(r->'amountInMinorUnits');
  before_amount := phase5_private.money_v1(c->'locked_plan'->'position'->'outstandingTotalInMinorUnits');
  coverage := phase5_private.money_v1(c->'locked_plan'->'position'->'collectionCoverageInMinorUnits')+amount;
  collection_identity := phase5_private.wire_uuid_v1(c->'locked_plan'->'collectionId');
  audit_identity := phase5_private.wire_uuid_v1(c->'locked_plan'->'auditId');
  event_at := (c->'locked_plan'->>'paymentEventAt')::TIMESTAMPTZ;
  number := c->'locked_plan'->>'paymentNumber';
  -- No old RPC/helper/GUC, late Shift selection or new earlier-rank lock.
  -- The unchanged old CliQ trigger still rejects a NULL Shift in preparation;
  -- its future atomic alignment is NOT performed or bypassed by this primitive.
  PERFORM phase5_private.assert_collection_source_tuple_v1(context_identity,'customer_payments','INSERT',NULL,
    JSONB_BUILD_OBJECT('id',payment_identity,'payment_number',number,
      'customer_id',(c->'locked_plan'->'order'->>'customer_id')::UUID,'order_id',(r->>'orderId')::UUID,
      'amount_in_minor_units',amount,'payment_method',r->>'tenderMethod','reference_number',r->'tenderReference',
      'notes',r->'notes','created_by',(r->>'actorId')::UUID,'created_at',event_at,
      'cash_shift_id',(c->'locked_plan'->'currentShift'->>'id')::UUID,'idempotency_key',r->>'idempotencyKey',
      'is_reversed',false,'reversed_at',NULL,'reversed_by',NULL,'reversal_reason',NULL));
  INSERT INTO public.customer_payments(id,payment_number,customer_id,order_id,amount_in_minor_units,
    payment_method,reference_number,notes,created_by,created_at,cash_shift_id,idempotency_key)
    VALUES(payment_identity,number,(c->'locked_plan'->'order'->>'customer_id')::UUID,
      (r->>'orderId')::UUID,amount,r->>'tenderMethod',r->>'tenderReference',r->>'notes',
      (r->>'actorId')::UUID,event_at,(c->'locked_plan'->'currentShift'->>'id')::UUID,r->>'idempotencyKey');
  inner_request := JSONB_BUILD_OBJECT('requestVersion','phase5-customer-collection-v1','actorScopeType','erp_user',
    'actorScopeId',r->>'actorId','orderId',r->>'orderId','originalPaymentId',payment_identity,
    'amountInMinorUnits',amount,'tenderMethod',r->>'tenderMethod','tenderReference',r->'tenderReference');
  inner_result := JSONB_BUILD_OBJECT('success',true,'resultType','customer_collection_committed_v1',
    'operationId',operation_identity,'collectionEventId',collection_identity,'originalPaymentId',payment_identity,
    'orderId',r->>'orderId','customerId',c->'locked_plan'->'order'->>'customer_id',
    'amountInMinorUnits',amount,'tenderMethod',r->>'tenderMethod','tenderReference',r->'tenderReference',
    'cashShiftId',c->'locked_plan'->'currentShift'->'id',
    'operationEventAt',TO_CHAR(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO phase5_private.financial_operation_events(id,operation_type,actor_scope_type,actor_scope_id,
    idempotency_key,request_fingerprint,request_identity_snapshot,result_type,result_snapshot,operation_event_at)
    VALUES(operation_identity,'customer_collection_v1','erp_user',(r->>'actorId')::UUID,r->>'idempotencyKey',
      UPPER(public.phase3_request_fingerprint_internal(inner_request)),inner_request,
      'customer_collection_committed_v1',inner_result,event_at);
  INSERT INTO phase5_private.collection_events(id,financial_operation_id,operation_type,operation_event_at,
    original_payment_id,order_id,customer_id,cash_shift_id,tender_method,amount_in_minor_units,tender_reference)
    VALUES(collection_identity,operation_identity,'customer_collection_v1',event_at,payment_identity,
      (r->>'orderId')::UUID,(c->'locked_plan'->'order'->>'customer_id')::UUID,
      (c->'locked_plan'->'currentShift'->>'id')::UUID,r->>'tenderMethod',amount,r->>'tenderReference');
  INSERT INTO public.audit_logs(id,user_id,action,entity_name,entity_id,details,created_at)
    VALUES(audit_identity,(r->>'actorId')::UUID,'RECORD_CUSTOMER_PAYMENT','customer_payments',payment_identity,
      JSONB_BUILD_OBJECT('contractVersion','phase5-collection-audit-v2','operationId',operation_identity,
        'orderId',r->>'orderId','paymentNumber',number,'request',r,'requestFingerprint',c->>'request_fingerprint'),event_at);
  outcome := r || JSONB_BUILD_OBJECT('contractVersion','phase5-customer-collection-result-v2',
    'kind','COMMITTED_COLLECTION','success',true,'request',r,'requestFingerprint',c->>'request_fingerprint',
    'operationId',operation_identity,'originalPaymentId',payment_identity,'collectionId',collection_identity,
    'paymentNumber',number,'outstandingBeforeInMinorUnits',before_amount::TEXT,
    'outstandingAfterInMinorUnits',(before_amount-amount)::TEXT);
  INSERT INTO phase5_private.collection_attempt_envelopes(financial_operation_id,collection_id,original_payment_id,
    payment_audit_id,context_id,actor_id,order_id,idempotency_key,request_snapshot,request_fingerprint,result_snapshot)
    VALUES(operation_identity,collection_identity,payment_identity,audit_identity,context_identity,
      (r->>'actorId')::UUID,(r->>'orderId')::UUID,r->>'idempotencyKey',r,c->>'request_fingerprint',outcome);
  PERFORM phase5_private.assert_collection_source_tuple_v1(context_identity,'orders','UPDATE',
    c->'locked_plan'->'order',(c->'locked_plan'->'order') || JSONB_BUILD_OBJECT(
      'amount_paid_in_minor_units',coverage,
      'payment_status',CASE WHEN coverage>=phase5_private.money_v1(c->'locked_plan'->'facts'->'totalInMinorUnits')
        THEN 'paid' ELSE 'partially_paid' END,'updated_at',event_at));
  UPDATE public.orders SET amount_paid_in_minor_units=coverage,
    payment_status=CASE WHEN coverage>=total_in_minor_units THEN 'paid' ELSE 'partially_paid' END,
    updated_at=event_at WHERE id=(r->>'orderId')::UUID;
  RETURN phase5_private.complete_collection_attempt_v1(operation_identity);
END;
$$;

-- Authenticated exact committed-result resolution. No fresh mutation context,
-- Shift requirement, eligibility timestamp, new row or projection repair.
CREATE FUNCTION phase5_private.resolve_collection_attempt_v2(r JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID; e phase5_private.collection_attempt_envelopes%ROWTYPE;
BEGIN
  actor := phase5_private.authorize_collection_request_v2(r);
  SELECT * INTO e FROM phase5_private.collection_attempt_envelopes
    WHERE actor_id=actor AND idempotency_key=r->>'idempotencyKey';
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF e.request_snapshot IS DISTINCT FROM r
    OR e.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COLLECTION_IDEMPOTENCY_CONFLICT';
  END IF;
  RETURN phase5_private.validate_collection_attempt_v1(e.financial_operation_id);
END;
$$;

CREATE FUNCTION phase5_private.guard_collection_control_history_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_CONTROL_IMMUTABLE';
END;
$$;
CREATE TRIGGER phase5_context_immutable BEFORE UPDATE OR DELETE ON phase5_private.mutation_contexts
FOR EACH ROW EXECUTE FUNCTION phase5_private.guard_collection_control_history_v1();
CREATE TRIGGER phase5_attempt_immutable BEFORE UPDATE OR DELETE ON phase5_private.collection_attempt_envelopes
FOR EACH ROW EXECUTE FUNCTION phase5_private.guard_collection_control_history_v1();

CREATE FUNCTION phase5_private.assert_source_completion_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE operation_identity UUID; parent_identity UUID; c phase5_private.mutation_contexts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='mutation_contexts' THEN operation_identity := NEW.operation_id;
    IF NEW.purpose='CUSTOMER_COMPLETION' THEN
      PERFORM phase5_private.complete_customer_completion_context_v1(NEW.id);
      RETURN NULL;
    END IF;
    IF NEW.purpose='LEGACY_WEBSITE_COMPLETION' THEN
      PERFORM phase5_private.complete_legacy_completion_context_v1(NEW.id);
      RETURN NULL;
    END IF;
    c:=NEW;
  ELSIF TG_TABLE_NAME='collection_attempt_envelopes' THEN operation_identity := NEW.financial_operation_id;
    SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=NEW.context_id;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_COMPLETION_TABLE_INVALID'; END IF;
  IF c.locked_plan->>'planVersion'='phase5-parent-collection-context-v1' THEN
    parent_identity:=phase5_private.wire_uuid_v1(c.locked_plan->'parentContextId');
    -- The complete parent proves the exact child context/envelope, not merely
    -- this nullable marker. No standalone adoption or fresh child acquisition.
    PERFORM phase5_private.complete_customer_completion_context_v1(parent_identity);
    RETURN NULL;
  END IF;
  PERFORM phase5_private.complete_collection_attempt_v1(operation_identity);
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER phase5_context_completion AFTER INSERT ON phase5_private.mutation_contexts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_source_completion_v1();
CREATE CONSTRAINT TRIGGER phase5_attempt_completion AFTER INSERT ON phase5_private.collection_attempt_envelopes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase5_private.assert_source_completion_v1();

REVOKE ALL ON FUNCTION phase5_private.validate_collection_before_snapshot_v1(JSONB),
  phase5_private.validate_collection_attempt_v1(UUID),phase5_private.complete_collection_attempt_v1(UUID),
  phase5_private.create_customer_payment_prelocked_v1(UUID,UUID,UUID,JSONB),
  phase5_private.resolve_collection_attempt_v2(JSONB),phase5_private.guard_collection_control_history_v1(),
  phase5_private.assert_source_completion_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.validate_collection_before_snapshot_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.validate_collection_attempt_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.complete_collection_attempt_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.create_customer_payment_prelocked_v1(UUID,UUID,UUID,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.resolve_collection_attempt_v2(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.guard_collection_control_history_v1() OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_source_completion_v1() OWNER TO postgres;

-- Immediate permit validation is NOT the prewrite discovery-equality check:
-- projection is written after a legitimate payment changed that discovery.
-- Neither this permit nor the frozen tuple substitutes for deferred evidence.
CREATE FUNCTION phase5_private.assert_collection_permit_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; actor UUID;
BEGIN
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  actor := phase5_private.authorize_collection_request_v2(c.normalized_request);
  IF c.transaction_id IS DISTINCT FROM txid_current() OR c.generation IS DISTINCT FROM 1
    OR c.actor_id IS DISTINCT FROM actor OR c.order_id::TEXT IS DISTINCT FROM c.normalized_request->>'orderId'
    OR c.purpose IS DISTINCT FROM 'CUSTOMER_COLLECTION' OR c.operation_id IS NULL
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(c.normalized_request))
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_STANDALONE_COLLECTION'
    OR c.locked_plan->'request' IS DISTINCT FROM c.normalized_request
    OR c.locked_plan->>'actorId' IS DISTINCT FROM actor::TEXT
    OR c.locked_plan->>'orderId' IS DISTINCT FROM c.order_id::TEXT
    OR c.locked_plan->>'operationId' IS DISTINCT FROM c.operation_id::TEXT
    OR c.locked_plan->>'requestFingerprint' IS DISTINCT FROM c.request_fingerprint
    OR c.locked_plan->>'paymentNumber' IS NULL
    OR c.locked_plan->>'paymentNumber' !~ '^CRV-[0-9]{8}-[0-9]{6,}$'
    OR c.locked_plan->>'paymentEventAt' IS NULL
    OR c.locked_plan->>'paymentEventAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    OR NOT EXISTS (SELECT 1 FROM phase5_private.authority_generation g
      JOIN phase5_private.activation_receipts a ON a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256
      WHERE g.singleton AND g.generation=1 AND g.authority_state='ACTIVE'
        AND g.manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_PERMIT_INVALID';
  END IF;
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'paymentId');
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'collectionId');
  PERFORM phase5_private.wire_uuid_v1(c.locked_plan->'auditId');
  PERFORM (c.locked_plan->>'paymentEventAt')::TIMESTAMPTZ;
  RETURN TO_JSONB(c);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_PERMIT_INVALID';
END;
$$;

CREATE FUNCTION phase5_private.assert_collection_source_tuple_v1(
  context_identity UUID, relation_name TEXT, event_name TEXT, old_tuple JSONB, new_tuple JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; r JSONB; expected JSONB; coverage BIGINT; event_at TIMESTAMPTZ;
BEGIN
  c := phase5_private.assert_collection_permit_v1(context_identity); r := c->'normalized_request';
  event_at := (c->'locked_plan'->>'paymentEventAt')::TIMESTAMPTZ;
  IF relation_name='customer_payments' AND event_name='INSERT' AND old_tuple IS NULL THEN
    expected := JSONB_BUILD_OBJECT('id',(c->'locked_plan'->>'paymentId')::UUID,
      'payment_number',c->'locked_plan'->>'paymentNumber',
      'customer_id',(c->'locked_plan'->'order'->>'customer_id')::UUID,'order_id',(r->>'orderId')::UUID,
      'amount_in_minor_units',phase5_private.wire_money_v1(r->'amountInMinorUnits'),
      'payment_method',r->>'tenderMethod','reference_number',r->'tenderReference','notes',r->'notes',
      'created_by',(r->>'actorId')::UUID,'created_at',event_at,
      'cash_shift_id',(c->'locked_plan'->'currentShift'->>'id')::UUID,'idempotency_key',r->>'idempotencyKey',
      'is_reversed',false,'reversed_at',NULL,'reversed_by',NULL,'reversal_reason',NULL);
  ELSIF relation_name='orders' AND event_name='UPDATE'
    AND old_tuple IS NOT DISTINCT FROM c->'locked_plan'->'order' THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id=(r->>'orderId')::UUID
      AND TO_JSONB(o) IS NOT DISTINCT FROM old_tuple) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_TUPLE_INVALID';
    END IF;
    -- Require the actual inserted source/evidence before the projection write.
    PERFORM phase5_private.validate_collection_attempt_v1((c->>'operation_id')::UUID);
    coverage := phase5_private.money_v1(c->'locked_plan'->'position'->'collectionCoverageInMinorUnits')
      +phase5_private.wire_money_v1(r->'amountInMinorUnits');
    expected := old_tuple || JSONB_BUILD_OBJECT('amount_paid_in_minor_units',coverage,
      'payment_status',CASE WHEN coverage>=phase5_private.money_v1(c->'locked_plan'->'facts'->'totalInMinorUnits')
        THEN 'paid' ELSE 'partially_paid' END,'updated_at',event_at);
  ELSE
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_ACTION_UNSUPPORTED';
  END IF;
  IF new_tuple IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_TUPLE_INVALID';
  END IF;
  RETURN TRUE;
END;
$$;

-- Prepared trigger ONLY: no public binding is installed in this migration.
-- It supports just the verified collection purpose. Other financial, lifecycle,
-- guest and Legacy purposes require their complete reviewed branch before any
-- activation. No missing-context, nullable type or generic Legacy exemption.
CREATE FUNCTION phase5_private.guard_source_generation_v1()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c UUID; order_identity UUID; actor UUID := auth.uid(); new_tuple JSONB; old_tuple JSONB;
BEGIN
  IF TG_TABLE_SCHEMA IS DISTINCT FROM 'public'
    OR NOT ((TG_TABLE_NAME='customer_payments' AND TG_OP='INSERT')
      OR (TG_TABLE_NAME='orders' AND TG_OP='UPDATE')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_ACTION_UNSUPPORTED';
  END IF;
  new_tuple := TO_JSONB(NEW);
  IF TG_OP='UPDATE' THEN old_tuple := TO_JSONB(OLD); END IF;
  order_identity := CASE WHEN TG_TABLE_NAME='orders' THEN (old_tuple->>'id')::UUID
    ELSE (new_tuple->>'order_id')::UUID END;
  SELECT id INTO STRICT c FROM phase5_private.mutation_contexts
    WHERE transaction_id=txid_current() AND actor_id=actor AND order_id=order_identity
      AND purpose='CUSTOMER_COLLECTION';
  PERFORM phase5_private.assert_collection_source_tuple_v1(c,TG_TABLE_NAME,TG_OP,old_tuple,new_tuple);
  RETURN NEW;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COLLECTION_SOURCE_PERMIT_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_collection_permit_v1(UUID),
  phase5_private.assert_collection_source_tuple_v1(UUID,TEXT,TEXT,JSONB,JSONB),
  phase5_private.guard_source_generation_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_collection_permit_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_source_tuple_v1(UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.guard_source_generation_v1() OWNER TO postgres;

-- Prepared collection-child UNION discovery, not a batch execution permit.
-- Inputs are requests only. Never accept a caller's claimed resource/mode list.
-- A future inventory/completion/Legacy/full-Shift parent MUST merge its own
-- independently discovered resources before any executor/context is admitted.
CREATE FUNCTION phase5_private.discover_collection_union_plan_v1(requests JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID; r JSONB; children JSONB := '[]'::JSONB; nodes JSONB; shifts JSONB;
  orders JSONB; resources JSONB; parents JSONB; keys JSONB; gates JSONB; capacities JSONB;
BEGIN
  IF JSONB_TYPEOF(requests) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COLLECTION_UNION_REQUESTS_INVALID';
  END IF;
  IF JSONB_ARRAY_LENGTH(requests)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COLLECTION_UNION_REQUESTS_INVALID';
  END IF;
  -- Authorize ALL children before discovering any source. No locks or writes.
  FOR r IN SELECT value FROM JSONB_ARRAY_ELEMENTS(requests) LOOP
    actor := phase5_private.authorize_collection_request_v2(r);
  END LOOP;
  IF EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(requests) q
    GROUP BY q->>'idempotencyKey' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COLLECTION_UNION_DUPLICATE_KEY';
  END IF;
  FOR r IN SELECT value FROM JSONB_ARRAY_ELEMENTS(requests)
    ORDER BY value->>'idempotencyKey' COLLATE "C" LOOP
    children := children || JSONB_BUILD_ARRAY(phase5_private.discover_collection_write_plan_v2(r));
  END LOOP;

  -- A shared identity must describe the SAME complete row in every child.
  -- Differing snapshots are a changed-discovery retry, never last-row-wins.
  SELECT COALESCE(JSONB_AGG(n),'[]'::JSONB) INTO nodes FROM (
    SELECT JSONB_BUILD_OBJECT('relation','public.orders','id',p->>'orderId','row',p->'order') n
      FROM JSONB_ARRAY_ELEMENTS(children) p
    UNION ALL SELECT s FROM JSONB_ARRAY_ELEMENTS(children) p
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'resources') s
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.cash_shifts','id',s->'row'->>'id','row',s->'row')
      FROM JSONB_ARRAY_ELEMENTS(children) p CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'shifts') s
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.branches','id',p->'parents'->'branch'->>'id','row',p->'parents'->'branch')
      FROM JSONB_ARRAY_ELEMENTS(children) p
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.customers','id',p->'parents'->'customer'->>'id','row',p->'parents'->'customer')
      FROM JSONB_ARRAY_ELEMENTS(children) p
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.profiles','id',s->>'id','row',s)
      FROM JSONB_ARRAY_ELEMENTS(children) p CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'parents'->'profiles') s
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.roles','id',s->'role'->>'id','row',s->'role')
      FROM JSONB_ARRAY_ELEMENTS(children) p CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'parents'->'actorRoles') s
    UNION ALL SELECT JSONB_BUILD_OBJECT('relation','public.user_roles',
      'id',(s->'membership'->>'user_id') || ':' || (s->'membership'->>'role_id'),'row',s->'membership')
      FROM JSONB_ARRAY_ELEMENTS(children) p CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'parents'->'actorRoles') s
  ) all_nodes;
  IF EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(nodes) n
    GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1)
    OR EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(children) p GROUP BY p->>'orderId'
      HAVING COUNT(DISTINCT p->'facts')<>1 OR COUNT(DISTINCT p->'position')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_UNION_SOURCE_CHANGED_RETRY';
  END IF;
  -- Numeric accumulation cannot overflow bigint. Compare against independently
  -- validated order capacity BEFORE narrowing/formatting the intended delta.
  IF EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(children) p GROUP BY p->>'orderId'
    HAVING SUM((p->'request'->>'amountInMinorUnits')::NUMERIC)
      > MIN((p->'position'->>'outstandingTotalInMinorUnits')::NUMERIC)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COLLECTION_UNION_EXCEEDS_OUTSTANDING';
  END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('orderId',identity,'amountInMinorUnits',amount::TEXT,
    'outstandingBeforeInMinorUnits',capacity::TEXT,'outstandingAfterInMinorUnits',(capacity-amount)::TEXT)
    ORDER BY identity COLLATE "C") INTO capacities FROM (
    SELECT p->>'orderId' identity,SUM((p->'request'->>'amountInMinorUnits')::NUMERIC) amount,
      MIN((p->'position'->>'outstandingTotalInMinorUnits')::NUMERIC) capacity
      FROM JSONB_ARRAY_ELEMENTS(children) p GROUP BY p->>'orderId'
  ) totals;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('row',row_data,'mode',mode) ORDER BY identity COLLATE "C")
    INTO shifts FROM (
      SELECT s->'row'->>'id' identity,s->'row' row_data,
        CASE WHEN BOOL_OR(s->>'mode'='UPDATE') THEN 'UPDATE' ELSE 'KEY_SHARE' END mode
      FROM JSONB_ARRAY_ELEMENTS(children) p CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'shifts') s
      GROUP BY s->'row'->>'id',s->'row'
    ) merged_shifts;
  shifts := COALESCE(shifts,'[]'::JSONB);
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id',identity,'row',row_data,'mode','UPDATE') ORDER BY identity COLLATE "C")
    INTO orders FROM (SELECT DISTINCT p->>'orderId' identity,p->'order' row_data
      FROM JSONB_ARRAY_ELEMENTS(children) p) merged_orders;
  SELECT COALESCE(JSONB_AGG(s || JSONB_BUILD_OBJECT('mode',CASE WHEN s->>'kind'='p' THEN 'UPDATE' ELSE 'SHARE' END)
    ORDER BY s->>'relation' COLLATE "C",s->>'id' COLLATE "C"),'[]'::JSONB)
    INTO resources FROM (SELECT DISTINCT s FROM JSONB_ARRAY_ELEMENTS(children) p
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'resources') s WHERE s->>'kind'<>'o') merged_resources;
  SELECT JSONB_AGG(n || JSONB_BUILD_OBJECT('mode','SHARE')
    ORDER BY n->>'relation' COLLATE "C",n->>'id' COLLATE "C") INTO parents
    FROM (SELECT DISTINCT n FROM JSONB_ARRAY_ELEMENTS(nodes) n
      WHERE n->>'relation' IN ('public.branches','public.customers','public.profiles','public.roles','public.user_roles')) merged_parents;
  SELECT JSONB_AGG(key_name ORDER BY key_name COLLATE "C") INTO keys FROM (
    SELECT DISTINCT key_name FROM JSONB_ARRAY_ELEMENTS(requests) q
      CROSS JOIN LATERAL UNNEST(ARRAY[actor::TEXT || ':' || (q->>'idempotencyKey'),
        'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_collection_v1|' || (q->>'idempotencyKey'),
        'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_collection_v2|' || (q->>'idempotencyKey')]) key_name
  ) key_set;
  SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) INTO gates FROM (
    SELECT 'cash-shift-full-reversal:' || (s->'row'->>'id') g FROM JSONB_ARRAY_ELEMENTS(shifts) s
    UNION SELECT 'pos-sale-reversal:' || (p->>'orderId') FROM JSONB_ARRAY_ELEMENTS(children) p
      WHERE p->'order'->>'source'='pos'
  ) shared_gates;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-collection-union-discovery-v1',
    'planState','DISCOVERED_UNION_NOT_LOCKED','completeFor','COLLECTION_CHILD_DISCOVERY_ONLY',
    'actorId',actor,'children',children,'keyGates',keys,
    'rootGates',(SELECT JSONB_AGG('phase4-order|' || (o->>'id') ORDER BY o->>'id' COLLATE "C") FROM JSONB_ARRAY_ELEMENTS(orders) o),
    'sharedGates',gates,'shifts',shifts,'orders',orders,'resources',resources,'parents',parents,'capacities',capacities);
END;
$$;

CREATE FUNCTION phase5_private.assert_collection_union_unchanged_v1(requests JSONB, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_collection_union_plan_v1(requests) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COLLECTION_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_collection_union_plan_v1(JSONB),
  phase5_private.assert_collection_union_unchanged_v1(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_collection_union_plan_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_collection_union_unchanged_v1(JSONB,JSONB) OWNER TO postgres;

-- Customer V2 PRE-COMPLETION discovery. This is neither a replay resolver nor
-- an execution permit. It must not call127's completed-sale financial reader.
CREATE FUNCTION phase5_private.discover_customer_completion_plan_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID := auth.uid(); key_name TEXT := NULLIF(BTRIM(request_key),'');
  tender TEXT := LOWER(NULLIF(BTRIM(method),'')); require_shift BOOLEAN;
  o public.orders%ROWTYPE; creation public.business_operations%ROWTYPE;
  r JSONB; expected JSONB; actual JSONB; resources JSONB; parents JSONB;
  shifts JSONB; inventory JSONB; products UUID[]; current_shift JSONB;
  merchandise NUMERIC; total NUMERIC; collected NUMERIC; fee BIGINT;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  IF order_identity IS NULL OR key_name IS NULL OR CHAR_LENGTH(key_name) NOT BETWEEN 16 AND 200
    OR tender IS NULL OR tender NOT IN ('cash','cash_on_delivery','cliq','debt')
    OR amount<0 OR delivery<0 OR CHAR_LENGTH(COALESCE(BTRIM(reference),''))>120 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_REQUEST_INVALID';
  END IF;
  -- Preserve120's original method predicate BEFORE trimming/zero normalization.
  require_shift := LOWER(COALESCE(method,'')) NOT IN ('debt','');
  IF tender='cash_on_delivery' THEN tender:='cash'; END IF;
  IF tender='cliq' AND COALESCE(amount,1)>0 AND NULLIF(BTRIM(reference),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_REFERENCE_REQUIRED';
  END IF;
  r := JSONB_BUILD_OBJECT('contract_version','phase3-customer-completion-v1',
    'actor_scope_hash',public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL),
    'order_id',order_identity::TEXT,'payment_method',tender,
    'amount_collected_in_minor_units',amount,'delivery_fee_in_minor_units',delivery,
    'reference_number',NULLIF(BTRIM(reference),''),'notes',NULLIF(BTRIM(notes),''));
  IF EXISTS (SELECT 1 FROM public.business_operations b
    WHERE b.operation_type='phase3_customer_completion_v1' AND b.idempotency_key=key_name) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COMPLETION_EXISTING_ATTEMPT_REQUIRES_REPLAY';
  END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=order_identity;
  SELECT * INTO STRICT creation FROM public.business_operations WHERE id=o.operation_id;
  IF o.source IS DISTINCT FROM 'website'
    OR creation.operation_type IS DISTINCT FROM 'phase3_customer_reservation_v1'
    OR creation.request_identity_version IS DISTINCT FROM 301
    OR JSONB_TYPEOF(creation.request_identity_snapshot) IS DISTINCT FROM 'object'
    OR creation.request_fingerprint IS DISTINCT FROM public.phase3_request_fingerprint_internal(creation.request_identity_snapshot)
    OR creation.completed_at IS NULL
    OR creation.actor_scope_type IS DISTINCT FROM 'guest_gateway'
    OR creation.result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
    OR creation.result_snapshot->>'contract_version' IS DISTINCT FROM 'phase3-customer-reservation-v2'
    OR creation.result_snapshot->>'order_id' IS DISTINCT FROM order_identity::TEXT
    OR creation.result_snapshot->>'operation_id' IS DISTINCT FROM creation.id::TEXT
    OR creation.result_snapshot->>'customer_id' IS DISTINCT FROM o.customer_id::TEXT
    OR o.customer_id IS NULL OR o.branch_id IS NULL OR o.warehouse_id IS NULL
    OR o.status IS NULL OR o.status NOT IN ('ready','out_for_delivery')
    OR o.cost_finalized_at IS NOT NULL OR o.amount_paid_in_minor_units IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_SOURCE_INVALID';
  END IF;
  merchandise := phase5_private.money_v1(creation.result_snapshot->'subtotal')
    - phase5_private.money_v1(creation.result_snapshot->'discount');
  IF merchandise<0
    OR o.subtotal_in_minor_units IS DISTINCT FROM phase5_private.money_v1(creation.result_snapshot->'subtotal')
    OR o.discount_in_minor_units IS DISTINCT FROM phase5_private.money_v1(creation.result_snapshot->'discount')
    OR o.delivery_fee_in_minor_units IS DISTINCT FROM phase5_private.money_v1(creation.result_snapshot->'delivery_fee')
    OR o.total_in_minor_units IS DISTINCT FROM phase5_private.money_v1(creation.result_snapshot->'total') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_FROZEN_PRICE_INVALID';
  END IF;
  fee:=COALESCE(delivery,o.delivery_fee_in_minor_units,0);
  total:=merchandise+fee;
  collected:=CASE WHEN tender='debt' THEN 0 ELSE COALESCE(amount,total) END;
  IF total<0 OR total>9223372036854775807 OR collected<0 OR collected>total THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_CAPACITY_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.order_id=order_identity)
    OR EXISTS (SELECT 1 FROM public.sales_return_events e WHERE e.order_id=order_identity)
    OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.reference_type='customer_order' AND m.reference_id=order_identity)
    OR EXISTS (SELECT 1 FROM public.business_operations b WHERE b.operation_type IN
      ('phase3_customer_completion_v1','phase3_customer_cancellation_v1','phase3_customer_expiry_v1')
      AND b.request_identity_snapshot->>'order_id'=order_identity::TEXT) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PRIOR_EFFECT_UNSUPPORTED';
  END IF;
  IF JSONB_TYPEOF(creation.result_snapshot->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ITEMS_INVALID';
  END IF;
  -- Immutable creation outcome supplies expected item and physical component
  -- identities; reservations cannot define their own expected demand.
  IF JSONB_ARRAY_LENGTH(creation.result_snapshot->'items')=0 OR EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(creation.result_snapshot->'items') s
    GROUP BY s->>'id' HAVING COUNT(*)<>1 OR s->>'id' IS NULL
  ) OR EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(creation.result_snapshot->'items') s
    FULL JOIN public.order_items i ON i.order_id=order_identity AND i.id=(s->>'id')::UUID
    WHERE (i.order_id=order_identity OR s IS NOT NULL) AND (
      s IS NULL OR i.id IS NULL OR i.product_id::TEXT IS DISTINCT FROM s->>'productId'
      OR i.commercial_line_kind IS DISTINCT FROM s->>'commercialLineKind'
      OR i.quantity::BIGINT IS DISTINCT FROM CASE WHEN i.commercial_line_kind='configurable_parcel'
        THEN (s->>'quantity')::BIGINT ELSE (s->>'baseQuantity')::BIGINT END
      OR i.net_refundable_amount_snapshot_in_minor_units IS DISTINCT FROM phase5_private.money_v1(s->'netRefundableAmountInMinorUnits')
      OR i.cost_finalized_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ITEMS_INVALID';
  END IF;
  WITH expected_sources AS (
    SELECT s->>'id' item_id,NULL::TEXT instance_id,NULL::TEXT component_id,
      s->>'productId' product_id,(s->>'baseQuantity')::BIGINT quantity
      FROM JSONB_ARRAY_ELEMENTS(creation.result_snapshot->'items') s
      WHERE s->>'commercialLineKind'<>'configurable_parcel'
    UNION ALL SELECT s->>'id',p->>'instance_id',c->>'component_id',c->>'product_id',(c->>'base_quantity')::BIGINT
      FROM JSONB_ARRAY_ELEMENTS(creation.result_snapshot->'items') s
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(s->'parcelInstances') p
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(p->'components') c
      WHERE s->>'commercialLineKind'='configurable_parcel'
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('itemId',item_id,'instanceId',instance_id,
    'componentId',component_id,'productId',product_id,'quantity',quantity)
    ORDER BY item_id,instance_id,product_id) INTO expected FROM expected_sources;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('itemId',a.order_item_id,'instanceId',a.parcel_instance_id,
    'componentId',c.id,'productId',a.product_id,'quantity',a.reserved_quantity)
    ORDER BY a.order_item_id,a.parcel_instance_id,a.product_id) INTO actual
    FROM public.order_inventory_reservations a LEFT JOIN public.order_parcel_components c
      ON c.parcel_instance_id=a.parcel_instance_id AND c.product_id=a.product_id
      AND c.operation_id=a.operation_id
    WHERE a.order_id=order_identity;
  IF expected IS NULL OR expected IS DISTINCT FROM actual OR EXISTS (
    SELECT 1 FROM public.order_inventory_reservations a WHERE a.order_id=order_identity
      AND (a.operation_id IS DISTINCT FROM creation.id OR a.warehouse_id IS DISTINCT FROM o.warehouse_id
        OR a.reservation_state IS DISTINCT FROM 'active' OR a.resolved_at IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_RESERVATION_IDENTITY_INVALID';
  END IF;
  -- Extra physical children may not be silently omitted merely because no
  -- reservation points to them. Prove both component and instance directions.
  SELECT JSONB_AGG(s ORDER BY s->>'itemId',s->>'instanceId',s->>'productId') INTO actual
    FROM JSONB_ARRAY_ELEMENTS(expected) s WHERE s->'componentId'<>'null'::JSONB;
  IF actual IS DISTINCT FROM (
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT('itemId',p.order_item_id,'instanceId',p.id,
      'componentId',c.id,'productId',c.product_id,'quantity',c.base_quantity)
      ORDER BY p.order_item_id,p.id,c.product_id) FROM public.order_parcel_components c
      JOIN public.order_parcel_instances p ON p.id=c.parcel_instance_id WHERE p.order_id=order_identity
    ) OR EXISTS (
      SELECT 1 FROM public.order_parcel_instances p WHERE p.order_id=order_identity
        AND (p.operation_id IS DISTINCT FROM creation.id OR p.cost_finalized_at IS NOT NULL
          OR NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(expected) s WHERE s->>'instanceId'=p.id::TEXT))
    ) OR EXISTS (
      SELECT 1 FROM public.order_parcel_components c JOIN public.order_parcel_instances p ON p.id=c.parcel_instance_id
      WHERE p.order_id=order_identity AND (c.operation_id IS DISTINCT FROM creation.id OR c.cost_finalized_at IS NOT NULL)
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PHYSICAL_SET_INVALID';
  END IF;
  SELECT ARRAY_AGG(DISTINCT (s->>'productId')::UUID ORDER BY (s->>'productId')::UUID)
    INTO products FROM JSONB_ARRAY_ELEMENTS(expected) s;
  -- Match113/114 exactly: ALL warehouse balances for the SKU set, then products.
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation','public.inventory_balances','id',b.id,
    'row',TO_JSONB(b),'mode','UPDATE') ORDER BY b.product_id,b.warehouse_id)
    INTO inventory FROM public.inventory_balances b WHERE b.product_id=ANY(products);
  IF EXISTS (SELECT 1 FROM (
    SELECT a.product_id,SUM(a.reserved_quantity)::NUMERIC quantity
      FROM public.order_inventory_reservations a WHERE a.order_id=order_identity GROUP BY a.product_id
    ) d LEFT JOIN public.inventory_balances b ON b.product_id=d.product_id AND b.warehouse_id=o.warehouse_id
    LEFT JOIN public.products p ON p.id=d.product_id
    WHERE b.id IS NULL OR p.id IS NULL OR b.on_hand_quantity<d.quantity OR b.reserved_quantity<d.quantity
      OR p.wac_cost_in_minor_units_exact IS NULL OR p.wac_cost_in_minor_units_exact<0) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_INVENTORY_INVALID';
  END IF;
  SELECT TO_JSONB(s) INTO current_shift FROM public.cash_shifts s
    WHERE s.branch_id=o.branch_id AND s.status='open';
  IF (require_shift OR collected>0) AND current_shift IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_OPEN_SHIFT_REQUIRED';
  END IF;
  shifts:=CASE WHEN current_shift IS NULL THEN '[]'::JSONB ELSE JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT('row',current_shift,'mode','UPDATE')) END;
  WITH nodes AS (
    SELECT 'public.business_operations' relation,creation.id::TEXT id,TO_JSONB(creation) row_data,'SHARE' mode
    UNION ALL SELECT 'public.order_items',i.id::TEXT,TO_JSONB(i),'UPDATE' FROM public.order_items i WHERE i.order_id=order_identity
    UNION ALL SELECT 'public.order_parcel_instances',p.id::TEXT,TO_JSONB(p),'UPDATE' FROM public.order_parcel_instances p WHERE p.order_id=order_identity
    UNION ALL SELECT 'public.order_parcel_components',c.id::TEXT,TO_JSONB(c),'UPDATE' FROM public.order_parcel_components c
      JOIN public.order_parcel_instances p ON p.id=c.parcel_instance_id WHERE p.order_id=order_identity
    UNION ALL SELECT 'public.order_inventory_reservations',a.id::TEXT,TO_JSONB(a),'UPDATE' FROM public.order_inventory_reservations a WHERE a.order_id=order_identity
    UNION ALL SELECT 'public.order_status_history',h.id::TEXT,TO_JSONB(h),'SHARE' FROM public.order_status_history h WHERE h.order_id=order_identity
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',id,'row',row_data,'mode',mode)
    ORDER BY relation COLLATE "C",id COLLATE "C") INTO resources FROM nodes;
  WITH nodes AS (
    SELECT 'public.branches' relation,b.id::TEXT id,TO_JSONB(b) row_data,'SHARE' mode FROM public.branches b WHERE b.id=o.branch_id
    UNION ALL SELECT 'public.customers',c.id::TEXT,TO_JSONB(c),'SHARE' FROM public.customers c WHERE c.id=o.customer_id
    UNION ALL SELECT 'public.customer_addresses',a.id::TEXT,TO_JSONB(a),'SHARE' FROM public.customer_addresses a WHERE a.id=o.customer_address_id
    UNION ALL SELECT 'public.warehouses',w.id::TEXT,TO_JSONB(w),'SHARE' FROM public.warehouses w
      WHERE w.id=o.warehouse_id OR EXISTS(SELECT 1 FROM public.inventory_balances b WHERE b.warehouse_id=w.id AND b.product_id=ANY(products))
    UNION ALL SELECT 'public.profiles',p.id::TEXT,TO_JSONB(p),'SHARE' FROM public.profiles p
      WHERE p.id=actor OR p.id=creation.initiated_by OR EXISTS (
        SELECT 1 FROM public.order_status_history h WHERE h.order_id=order_identity AND h.changed_by=p.id)
    -- Auth identity only: never discover or persist auth.users secret content.
    -- KEY_SHARE protects the FK identity; non-key auth changes are irrelevant.
    UNION ALL SELECT 'auth.users',u.id::TEXT,JSONB_BUILD_OBJECT('id',u.id),'KEY_SHARE' FROM auth.users u
      WHERE u.id=actor OR u.id=creation.initiated_by OR EXISTS (
        SELECT 1 FROM public.order_status_history h WHERE h.order_id=order_identity AND h.changed_by=u.id)
    UNION ALL SELECT 'public.roles',role_row.id::TEXT,TO_JSONB(role_row),'SHARE' FROM public.roles role_row JOIN public.user_roles ur ON ur.role_id=role_row.id WHERE ur.user_id=actor
    UNION ALL SELECT 'public.user_roles',ur.user_id::TEXT||':'||ur.role_id::TEXT,TO_JSONB(ur),'SHARE' FROM public.user_roles ur WHERE ur.user_id=actor
    UNION ALL SELECT 'public.products',p.id::TEXT,TO_JSONB(p),'NO_KEY_UPDATE' FROM public.products p WHERE p.id=ANY(products)
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',id,'row',row_data,'mode',mode)
    ORDER BY relation COLLATE "C",id COLLATE "C") INTO parents FROM nodes;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-customer-completion-discovery-v1',
    'planState','DISCOVERED_PARENT_NOT_LOCKED','completeFor','CUSTOMER_COMPLETION_SOURCE_DISCOVERY_ONLY',
    'actorId',actor,'orderId',order_identity,'request',r,'originalMethod',method,
    'requestKey',key_name,'requestFingerprint',public.phase3_request_fingerprint_internal(r),
    'order',TO_JSONB(o),'creation',TO_JSONB(creation),'expectedSources',expected,
    'capacity',JSONB_BUILD_OBJECT('merchandiseInMinorUnits',merchandise::TEXT,
      'deliveryInMinorUnits',fee::TEXT,'totalInMinorUnits',total::TEXT,
      'collectedInMinorUnits',collected::TEXT,'remainingInMinorUnits',(total-collected)::TEXT,
      'receiptRequired',collected>0 AND collected<total,'requiresOpenShift',require_shift OR collected>0),
    'keyGates',JSONB_BUILD_ARRAY('phase3-operation:phase3_customer_completion_v1:'||key_name),
    'rootGates',JSONB_BUILD_ARRAY('phase4-order|'||order_identity::TEXT),
    'sharedGates',(SELECT COALESCE(JSONB_AGG('cash-shift-full-reversal:'||(s->'row'->>'id')),'[]'::JSONB) FROM JSONB_ARRAY_ELEMENTS(shifts) s),
    'shifts',shifts,'inventoryGates',(SELECT JSONB_AGG('inventory-product:'||p::TEXT ORDER BY p) FROM UNNEST(products) p),
    'inventory',inventory,'resources',resources,'parents',parents);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_SOURCE_INCOMPLETE';
END;
$$;

CREATE FUNCTION phase5_private.assert_customer_completion_plan_unchanged_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT, expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_customer_completion_plan_v1(
    order_identity,request_key,method,amount,delivery,reference,notes) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_customer_completion_plan_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  phase5_private.assert_customer_completion_plan_unchanged_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_customer_completion_plan_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_plan_unchanged_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Merge the incomplete Customer parent with its OWN partial collection intent.
-- This cannot delegate discovery to127: the Order is not completed yet. The
-- receipt's capacity is the frozen parent's total, with starting coverage0.
-- No caller-supplied child/key/resource/mode or execution authority is accepted.
CREATE FUNCTION phase5_private.discover_customer_completion_union_core_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT, own_context UUID
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; child JSONB := 'null'::JSONB; request JSONB; identity_hash TEXT;
  child_key TEXT; identities JSONB := '{}'::JSONB; field TEXT; h TEXT; keys JSONB;
  nodes JSONB; resources JSONB; absent JSONB := '[]'::JSONB; actor UUID;
  own_row phase5_private.mutation_contexts%ROWTYPE;
BEGIN
  -- Includes actor authorization before every source lookup.
  parent:=phase5_private.discover_customer_completion_plan_v1(
    order_identity,request_key,method,amount,delivery,reference,notes);
  actor:=(parent->>'actorId')::UUID;
  IF own_context IS NOT NULL THEN
    SELECT * INTO own_row FROM phase5_private.mutation_contexts WHERE id=own_context;
    IF NOT FOUND OR own_row.transaction_id IS DISTINCT FROM txid_current() OR own_row.generation IS DISTINCT FROM 1
      OR own_row.actor_id IS DISTINCT FROM actor OR own_row.order_id IS DISTINCT FROM order_identity
      OR own_row.purpose IS DISTINCT FROM 'CUSTOMER_COMPLETION' OR own_row.operation_id IS NULL
      OR own_row.normalized_request IS DISTINCT FROM parent->'request'
      OR own_row.request_fingerprint IS DISTINCT FROM UPPER(parent->>'requestFingerprint') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_REDISCOVERY_CONTEXT_INVALID';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM phase5_private.financial_operation_events f
      WHERE f.request_identity_snapshot->>'orderId'=order_identity::TEXT)
    OR EXISTS(SELECT 1 FROM phase5_private.collection_events e WHERE e.order_id=order_identity)
    OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes e WHERE e.order_id=order_identity)
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts c WHERE c.order_id=order_identity
      AND c.id IS DISTINCT FROM own_context) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PREEXISTING_FINANCIAL_EVIDENCE';
  END IF;
  keys:=parent->'keyGates';
  IF parent->'capacity'->'receiptRequired'='true'::JSONB THEN
    -- Key ownership depends on parent attempt identity, NEVER its payload.
    -- Editing amount/notes under the same parent key must NOT mint a new child.
    identity_hash:=LOWER(public.phase3_request_fingerprint_internal(JSONB_BUILD_OBJECT(
      'domain','phase5-customer-completion-child-v1','actorId',actor,
      'orderId',order_identity,'parentKey',parent->>'requestKey')));
    child_key:='phase5-parent-collection|'||identity_hash;
    FOREACH field IN ARRAY ARRAY['operationId','paymentId','collectionId','auditId'] LOOP
      h:=LOWER(public.phase3_request_fingerprint_internal(JSONB_BUILD_OBJECT(
        'domain','phase5-customer-completion-child-identity-v1','key',child_key,'kind',field)));
      -- Deterministic RFC variant UUIDv8, domain-separated per durable relation.
      identities:=identities||JSONB_BUILD_OBJECT(field,(SUBSTR(h,1,8)||'-'||SUBSTR(h,9,4)||
        '-8'||SUBSTR(h,14,3)||'-8'||SUBSTR(h,18,3)||'-'||SUBSTR(h,21,12))::UUID);
    END LOOP;
    request:=phase5_private.normalize_collection_request_v2(actor,order_identity,
      (parent->'capacity'->>'collectedInMinorUnits')::BIGINT,
      parent->'request'->>'payment_method',parent->'request'->>'reference_number',
      COALESCE(parent->'request'->>'notes','دفعة مستلمة عند تسليم طلب V2'),child_key);
    IF EXISTS(SELECT 1 FROM public.customer_payments p WHERE p.id=(identities->>'paymentId')::UUID
        OR (p.created_by=actor AND p.idempotency_key=child_key))
      OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events f WHERE f.id=(identities->>'operationId')::UUID
        OR (f.actor_scope_id=actor AND f.idempotency_key=child_key
          AND f.operation_type IN ('customer_collection_v1','customer_collection_v2')))
      OR EXISTS(SELECT 1 FROM phase5_private.collection_events e WHERE e.id=(identities->>'collectionId')::UUID)
      OR EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=(identities->>'auditId')::UUID)
      OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes e
        WHERE e.financial_operation_id=(identities->>'operationId')::UUID
          OR (e.actor_id=actor AND e.idempotency_key=child_key))
      OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts c WHERE c.operation_id=(identities->>'operationId')::UUID) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COMPLETION_CHILD_IDENTITY_OWNED';
    END IF;
    child:=JSONB_BUILD_OBJECT('planState','DISCOVERED_CHILD_OF_INCOMPLETE_PARENT',
      'parentKey',parent->>'requestKey','parentRequestFingerprint',parent->>'requestFingerprint',
      'parentCreationOperationId',parent->'creation'->'id','request',request,
      'requestFingerprint',UPPER(public.phase3_request_fingerprint_internal(request)),
      'identities',identities,'outstandingBeforeInMinorUnits',parent->'capacity'->'totalInMinorUnits',
      'outstandingAfterInMinorUnits',parent->'capacity'->'remainingInMinorUnits',
      'initialCollectionInMinorUnits','0','shiftId',parent->'shifts'->0->'row'->'id');
    keys:=keys||JSONB_BUILD_ARRAY(actor::TEXT||':'||child_key,
      'phase5-idempotency|erp_user|'||actor::TEXT||'|customer_collection_v1|'||child_key,
      'phase5-idempotency|erp_user|'||actor::TEXT||'|customer_collection_v2|'||child_key);
    absent:=JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','phase5_private.financial_operation_events','id',identities->'operationId'),
      JSONB_BUILD_OBJECT('relation','public.customer_payments','id',identities->'paymentId'),
      JSONB_BUILD_OBJECT('relation','phase5_private.collection_events','id',identities->'collectionId'),
      JSONB_BUILD_OBJECT('relation','public.audit_logs','id',identities->'auditId'),
      JSONB_BUILD_OBJECT('relation','phase5_private.collection_attempt_envelopes','id',identities->'operationId'));
  END IF;
  -- The receipt reuses parent Order/Shift/customer/actor resources at their
  -- strongest required mode. It has no standalone financial rediscovery call.
  SELECT JSONB_AGG(n) INTO nodes FROM (
    SELECT JSONB_BUILD_OBJECT('relation','public.orders','id',order_identity,'row',parent->'order','mode','UPDATE','rank',5) n
    UNION ALL SELECT s||JSONB_BUILD_OBJECT('relation','public.cash_shifts','id',s->'row'->'id','rank',4)
      FROM JSONB_ARRAY_ELEMENTS(parent->'shifts') s
    UNION ALL SELECT s||JSONB_BUILD_OBJECT('rank',5) FROM JSONB_ARRAY_ELEMENTS(parent->'inventory') s
    UNION ALL SELECT s||JSONB_BUILD_OBJECT('rank',6) FROM JSONB_ARRAY_ELEMENTS(parent->'resources') s
    UNION ALL SELECT s||JSONB_BUILD_OBJECT('rank',CASE WHEN s->>'relation'='public.products' THEN 5 ELSE 7 END)
      FROM JSONB_ARRAY_ELEMENTS(parent->'parents') s
  ) discovered;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(nodes) n
    GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_UNION_SOURCE_CHANGED_RETRY';
  END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',id,'row',row_data,'rank',rank,
      'mode',CASE strength WHEN 4 THEN 'UPDATE' WHEN 3 THEN 'NO_KEY_UPDATE' WHEN 2 THEN 'SHARE' ELSE 'KEY_SHARE' END)
    ORDER BY rank,CASE relation WHEN 'public.orders' THEN 0 WHEN 'public.inventory_balances' THEN 1
      WHEN 'public.products' THEN 2 ELSE 3 END,
      relation COLLATE "C",CASE WHEN relation='public.inventory_balances' THEN row_data->>'product_id' ELSE id END COLLATE "C",
      CASE WHEN relation='public.inventory_balances' THEN row_data->>'warehouse_id' ELSE id END COLLATE "C") INTO resources FROM (
    SELECT n->>'relation' relation,n->>'id' id,n->'row' row_data,MIN((n->>'rank')::INT) rank,
      MAX(CASE n->>'mode' WHEN 'UPDATE' THEN 4 WHEN 'NO_KEY_UPDATE' THEN 3 WHEN 'SHARE' THEN 2 ELSE 1 END) strength
      FROM JSONB_ARRAY_ELEMENTS(nodes) n GROUP BY n->>'relation',n->>'id',n->'row'
  ) merged;
  SELECT JSONB_AGG(k ORDER BY k COLLATE "C") INTO keys FROM (SELECT DISTINCT k FROM JSONB_ARRAY_ELEMENTS_TEXT(keys) k) exact_keys;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-customer-completion-union-discovery-v1',
    'planState','DISCOVERED_PARENT_CHILD_NOT_LOCKED','completeFor','CUSTOMER_COMPLETION_PARENT_CHILD_DISCOVERY_ONLY',
    'parent',parent,'child',child,'keyGates',keys,'rootGates',parent->'rootGates',
    'sharedGates',parent->'sharedGates','inventoryGates',parent->'inventoryGates',
    'resources',resources,'expectedAbsent',absent);
END;
$$;

-- Ordinary discovery ignores NO context. Only the transaction-bound parent
-- assertion can rediscover while retaining its own immutable metadata row.
CREATE FUNCTION phase5_private.discover_customer_completion_union_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  RETURN phase5_private.discover_customer_completion_union_core_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,NULL);
END;
$$;

CREATE FUNCTION phase5_private.assert_customer_completion_union_unchanged_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT, expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_customer_completion_union_v1(
    order_identity,request_key,method,amount,delivery,reference,notes) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_customer_completion_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  phase5_private.discover_customer_completion_union_core_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,UUID),
  phase5_private.assert_customer_completion_union_unchanged_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_customer_completion_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.discover_customer_completion_union_core_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_union_unchanged_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- A parent has no synthetic collection request on full/debt/zero outcomes.
-- Fence its own authenticated authority without delegating to a child permit.
CREATE FUNCTION phase5_private.lock_customer_completion_generation_v1()
RETURNS INTEGER LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID := auth.uid(); g phase5_private.authority_generation%ROWTYPE;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  SELECT * INTO STRICT g FROM phase5_private.authority_generation WHERE singleton FOR SHARE NOWAIT;
  IF g.generation IS DISTINCT FROM 1 OR g.authority_state IS DISTINCT FROM 'ACTIVE'
    OR g.manifest_sha256 IS DISTINCT FROM '9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099'
    OR NOT EXISTS(SELECT 1 FROM phase5_private.activation_receipts a
      WHERE a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PREPARATION_ONLY: No parent authority is activated.';
  END IF;
  RETURN g.generation;
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_GENERATION_BUSY_RETRY';
WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_COMPLETION_GENERATION_UNAVAILABLE';
END;
$$;

-- Complete canonical acquisition for this supported parent/owned-child plan.
-- No context, DML, receipt or execution authority is minted by held locks.
-- A changed membership is rollback/safe retry, never a late acquisition.
CREATE FUNCTION phase5_private.lock_customer_completion_plan_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID := auth.uid(); plan JSONB; n JSONB; key_name TEXT; identity UUID;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  IF EXISTS(SELECT 1 FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation
    LEFT JOIN pg_index index_parent ON index_parent.indexrelid=c.oid
    LEFT JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted
      AND (l.locktype='advisory' OR (ns.nspname IN ('public','auth','phase5_private')
        AND l.mode<>'AccessShareLock' AND COALESCE(index_parent.indrelid,c.oid) NOT IN
          ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS)))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LATE_ENTRY_RETRY';
  END IF;
  PERFORM phase5_private.lock_customer_completion_generation_v1();
  plan:=phase5_private.discover_customer_completion_union_v1(
    order_identity,request_key,method,amount,delivery,reference,notes);
  FOR key_name IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'keyGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  FOR key_name IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'rootGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  FOR key_name IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'sharedGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal)
    WHERE (value->>'rank')::INT=4 ORDER BY ordinal LOOP
    identity:=phase5_private.wire_uuid_v1(n->'id');
    IF n->>'relation' IS DISTINCT FROM 'public.cash_shifts' OR n->>'mode' IS DISTINCT FROM 'UPDATE' THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_INVALID';
    END IF;
    PERFORM 1 FROM public.cash_shifts WHERE id=identity FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  PERFORM 1 FROM public.orders WHERE id=order_identity FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_CHANGED'; END IF;
  -- Reuse113/114's global SKU domain, not a parallel warehouse-only namespace.
  FOR key_name IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'inventoryGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(key_name,0));
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal)
    WHERE (value->>'rank')::INT>=5 ORDER BY ordinal LOOP
    IF n->>'relation'='public.user_roles' THEN
      PERFORM 1 FROM public.user_roles WHERE user_id=(n->'row'->>'user_id')::UUID
        AND role_id=(n->'row'->>'role_id')::UUID FOR SHARE NOWAIT;
    ELSE
      identity:=phase5_private.wire_uuid_v1(n->'id');
      CASE n->>'relation'
        WHEN 'public.orders' THEN
          IF identity IS DISTINCT FROM order_identity THEN RAISE EXCEPTION 'PHASE5_COMPLETION_LOCK_PLAN_INVALID'; END IF;
          CONTINUE;
        WHEN 'public.inventory_balances' THEN PERFORM 1 FROM public.inventory_balances WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.products' THEN PERFORM 1 FROM public.products WHERE id=identity FOR NO KEY UPDATE NOWAIT;
        WHEN 'public.business_operations' THEN PERFORM 1 FROM public.business_operations WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.order_items' THEN PERFORM 1 FROM public.order_items WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.order_parcel_instances' THEN PERFORM 1 FROM public.order_parcel_instances WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.order_parcel_components' THEN PERFORM 1 FROM public.order_parcel_components WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.order_inventory_reservations' THEN PERFORM 1 FROM public.order_inventory_reservations WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.order_status_history' THEN PERFORM 1 FROM public.order_status_history WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'auth.users' THEN PERFORM 1 FROM auth.users WHERE id=identity FOR KEY SHARE NOWAIT;
        WHEN 'public.branches' THEN PERFORM 1 FROM public.branches WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.customers' THEN PERFORM 1 FROM public.customers WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.customer_addresses' THEN PERFORM 1 FROM public.customer_addresses WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.warehouses' THEN PERFORM 1 FROM public.warehouses WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.profiles' THEN PERFORM 1 FROM public.profiles WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.roles' THEN PERFORM 1 FROM public.roles WHERE id=identity FOR SHARE NOWAIT;
        ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_INVALID';
      END CASE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  PERFORM phase5_private.assert_customer_completion_union_unchanged_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,plan);
  RETURN plan||JSONB_BUILD_OBJECT('planState','LOCKED_PARENT_RESOURCES_ONLY',
    'completeFor','CUSTOMER_COMPLETION_LOCK_ACQUISITION_ONLY');
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_CONTENTION_RETRY';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.lock_customer_completion_generation_v1(),
  phase5_private.lock_customer_completion_plan_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.lock_customer_completion_generation_v1() OWNER TO postgres;
ALTER FUNCTION phase5_private.lock_customer_completion_plan_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;

-- Pure running-delta/cost model, derived ONLY from the locked source snapshots.
-- It is not a writer, mutation permit or proof of durable completion.
CREATE FUNCTION phase5_private.derive_customer_completion_deltas_v1(plan JSONB, event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB := plan->'parent'; reservation JSONB; balance JSONB; source JSONB;
  running JSONB := '{}'::JSONB; inventory_steps JSONB := '[]'::JSONB;
  cost_steps JSONB := '[]'::JSONB; line_row JSONB; instance_row JSONB; component_row JSONB;
  inputs JSONB; allocation JSONB; component_cost JSONB; new_row JSONB;
  previous_quantity BIGINT; quantity BIGINT; line_exact NUMERIC; line_cogs BIGINT;
  instance_exact NUMERIC; denominator NUMERIC;
BEGIN
  IF plan->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_RESOURCES_ONLY'
    OR plan->>'completeFor' IS DISTINCT FROM 'CUSTOMER_COMPLETION_LOCK_ACQUISITION_ONLY'
    OR event_at IS NULL OR parent->>'planVersion' IS DISTINCT FROM 'phase5-customer-completion-discovery-v1' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_DELTA_PLAN_INVALID';
  END IF;
  -- Same116 per-reservation product/id order. A second reservation of the same
  -- SKU starts at the previous planned balance, not at the initial balance.
  FOR reservation IN SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(parent->'resources')
    WHERE value->>'relation'='public.order_inventory_reservations'
    ORDER BY value->'row'->>'product_id',value->>'id' LOOP
    SELECT value->'row' INTO STRICT balance FROM JSONB_ARRAY_ELEMENTS(parent->'inventory')
      WHERE value->'row'->>'product_id'=reservation->>'product_id'
        AND value->'row'->>'warehouse_id'=reservation->>'warehouse_id';
    SELECT value INTO STRICT source FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources')
      WHERE value->>'itemId'=reservation->>'order_item_id'
        AND value->>'productId'=reservation->>'product_id'
        AND value->'instanceId' IS NOT DISTINCT FROM reservation->'parcel_instance_id';
    quantity:=phase5_private.money_v1(source->'quantity');
    previous_quantity:=CASE WHEN running ? (balance->>'id') THEN (running->>(balance->>'id'))::BIGINT ELSE 0 END;
    IF quantity<=0 OR quantity IS DISTINCT FROM (reservation->>'reserved_quantity')::BIGINT
      OR (balance->>'on_hand_quantity')::NUMERIC<previous_quantity::NUMERIC+quantity
      OR (balance->>'reserved_quantity')::NUMERIC<previous_quantity::NUMERIC+quantity THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_DELTA_CAPACITY_INVALID';
    END IF;
    inventory_steps:=inventory_steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'reservationId',reservation->'id','balanceId',balance->'id',
      'balanceBefore',balance||JSONB_BUILD_OBJECT(
        'on_hand_quantity',(balance->>'on_hand_quantity')::BIGINT-previous_quantity,
        'reserved_quantity',(balance->>'reserved_quantity')::BIGINT-previous_quantity)
        ||CASE WHEN previous_quantity>0 THEN JSONB_BUILD_OBJECT('updated_at',event_at) ELSE '{}'::JSONB END,
      'balanceAfter',balance||JSONB_BUILD_OBJECT(
        'on_hand_quantity',(balance->>'on_hand_quantity')::BIGINT-previous_quantity-quantity,
        'reserved_quantity',(balance->>'reserved_quantity')::BIGINT-previous_quantity-quantity,'updated_at',event_at),
      'reservationBefore',reservation,'reservationAfter',reservation||JSONB_BUILD_OBJECT('reservation_state','consumed','resolved_at',event_at),
      'movement',JSONB_BUILD_OBJECT('warehouse_id',reservation->'warehouse_id','product_id',reservation->'product_id',
        'movement_type','sales_deduction','quantity',-quantity,
        'balance_before',(balance->>'on_hand_quantity')::BIGINT-previous_quantity,
        'balance_after',(balance->>'on_hand_quantity')::BIGINT-previous_quantity-quantity,
        'reference_type','customer_order','reference_id',parent->'orderId',
        'created_by',parent->'actorId','operation_id',parent->'creation'->'id',
        'parcel_component_id',source->'componentId','reservation_id',reservation->'id',
        'notes','استهلاك حجز طلب عميل V2 رقم '||(parent->'order'->>'order_number'),'created_at',event_at)));
    running:=running||JSONB_BUILD_OBJECT(balance->>'id',previous_quantity+quantity);
  END LOOP;
  FOR line_row IN SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(parent->'resources')
    WHERE value->>'relation'='public.order_items' ORDER BY value->>'id' LOOP
    line_exact:=0; line_cogs:=0;
    IF line_row->>'commercial_line_kind'='configurable_parcel' THEN
      FOR instance_row IN SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(parent->'resources')
        WHERE value->>'relation'='public.order_parcel_instances' AND value->'row'->>'order_item_id'=line_row->>'id'
        ORDER BY (value->'row'->>'instance_sequence')::INT,value->>'id' LOOP
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT('product_id',s->'productId','base_quantity',s->'quantity',
          'unit_cost_in_minor_units_exact',p->'row'->'wac_cost_in_minor_units_exact') ORDER BY s->>'productId')
          INTO inputs FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources') s
          JOIN JSONB_ARRAY_ELEMENTS(parent->'parents') p ON p->>'relation'='public.products' AND p->>'id'=s->>'productId'
          WHERE s->>'instanceId'=instance_row->>'id';
        -- Reuse the exact closed114 per-instance rounding/residual policy.
        allocation:=public.phase3_allocate_parcel_cogs_internal(inputs);
        SELECT SUM((value->>'exact_cogs_in_minor_units')::NUMERIC(30,6)) INTO instance_exact
          FROM JSONB_ARRAY_ELEMENTS(allocation->'components');
        FOR component_row IN SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(parent->'resources')
          WHERE value->>'relation'='public.order_parcel_components'
            AND value->'row'->>'parcel_instance_id'=instance_row->>'id' ORDER BY value->'row'->>'product_id' LOOP
          SELECT value INTO STRICT component_cost FROM JSONB_ARRAY_ELEMENTS(allocation->'components')
            WHERE value->>'product_id'=component_row->>'product_id';
          new_row:=component_row||JSONB_BUILD_OBJECT(
            'unit_cost_snapshot_in_minor_units',(component_cost->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
            'cogs_snapshot_in_minor_units',(component_cost->>'allocated_cogs_in_minor_units')::BIGINT,
            'exact_cogs_snapshot_in_minor_units',(component_cost->>'exact_cogs_in_minor_units')::NUMERIC(30,6),'cost_finalized_at',event_at);
          cost_steps:=cost_steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.order_parcel_components',
            'id',component_row->'id','before',component_row,'after',new_row));
        END LOOP;
        cost_steps:=cost_steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.order_parcel_instances',
          'id',instance_row->'id','before',instance_row,'after',instance_row||JSONB_BUILD_OBJECT(
            'cogs_snapshot_in_minor_units',(allocation->>'total_cogs_in_minor_units')::BIGINT,
            'exact_cogs_snapshot_in_minor_units',instance_exact,'cost_finalized_at',event_at)));
        line_exact:=line_exact+instance_exact; line_cogs:=line_cogs+(allocation->>'total_cogs_in_minor_units')::BIGINT;
      END LOOP;
      SELECT SUM((value->>'quantity')::NUMERIC) INTO denominator FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources')
        WHERE value->>'itemId'=line_row->>'id';
    ELSE
      SELECT SUM((s->>'quantity')::NUMERIC*(p->'row'->>'wac_cost_in_minor_units_exact')::NUMERIC(24,6))
        INTO line_exact FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources') s
        JOIN JSONB_ARRAY_ELEMENTS(parent->'parents') p ON p->>'relation'='public.products' AND p->>'id'=s->>'productId'
        WHERE s->>'itemId'=line_row->>'id';
      line_cogs:=ROUND(line_exact,0)::BIGINT; denominator:=(line_row->>'quantity')::NUMERIC;
    END IF;
    IF line_exact IS NULL OR denominator IS NULL OR denominator<=0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_DELTA_COST_INVALID';
    END IF;
    new_row:=line_row||JSONB_BUILD_OBJECT('unit_cost_snapshot_in_minor_units_exact',ROUND(line_exact/denominator,6),
      'exact_cogs_snapshot_in_minor_units',line_exact,'unit_cost_in_minor_units',ROUND(line_exact/denominator,0)::BIGINT,
      'cogs_in_minor_units',line_cogs,'profit_in_minor_units',(line_row->>'net_refundable_amount_snapshot_in_minor_units')::BIGINT-line_cogs,
      'cost_finalized_at',event_at);
    cost_steps:=cost_steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.order_items','id',line_row->'id','before',line_row,'after',new_row));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('modelVersion','phase5-customer-parent-deltas-v1',
    'inventorySteps',inventory_steps,'costSteps',cost_steps,'consumedByBalance',running,
    'financial',JSONB_BUILD_OBJECT('collectionCoverageBeforeInMinorUnits','0',
      'collectionCoverageAfterInMinorUnits',parent->'capacity'->'collectedInMinorUnits',
      'outstandingBeforeInMinorUnits',parent->'capacity'->'totalInMinorUnits',
      'outstandingAfterInMinorUnits',parent->'capacity'->'remainingInMinorUnits',
      'receiptRequired',parent->'capacity'->'receiptRequired'));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION OR NUMERIC_VALUE_OUT_OF_RANGE THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_DELTA_PLAN_INVALID';
END;
$$;

CREATE FUNCTION phase5_private.enter_customer_completion_context_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; frozen JSONB; deltas JSONB; actor UUID := auth.uid(); n JSONB;
  context_identity UUID := gen_random_uuid(); operation_identity UUID := gen_random_uuid();
  event_at TIMESTAMPTZ; movements JSONB := '{}'::JSONB; sequences JSONB := '{}'::JSONB;
  receipt JSONB := 'null'::JSONB; number TEXT;
BEGIN
  plan:=phase5_private.lock_customer_completion_plan_v1(order_identity,request_key,method,amount,delivery,reference,notes);
  -- Match116 and the retained source updated_at triggers' transaction clock.
  event_at:=transaction_timestamp();
  deltas:=phase5_private.derive_customer_completion_deltas_v1(plan,event_at);
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(deltas->'inventorySteps') LOOP
    movements:=movements||JSONB_BUILD_OBJECT(n->>'reservationId',gen_random_uuid());
    sequences:=sequences||JSONB_BUILD_OBJECT(n->>'reservationId',NEXTVAL('public.inventory_movement_mutation_seq'));
  END LOOP;
  IF plan->'child'<>'null'::JSONB THEN
    number:='CRV-'||TO_CHAR(event_at AT TIME ZONE 'UTC','YYYYMMDD')||'-'||LPAD(NEXTVAL('public.customer_payment_number_seq')::TEXT,6,'0');
    receipt:=JSONB_BUILD_OBJECT('identities',plan->'child'->'identities','request',plan->'child'->'request',
      'requestFingerprint',plan->'child'->'requestFingerprint','paymentNumber',number,
      'eventAt',TO_CHAR(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'cashShiftId',CASE WHEN plan->'child'->'request'->>'tenderMethod'='cash' THEN plan->'child'->'shiftId' ELSE 'null'::JSONB END);
  END IF;
  frozen:=JSONB_BUILD_OBJECT('planVersion','phase5-customer-parent-context-v1','planState','LOCKED_PARENT_PREWRITE_CONTEXT_ONLY',
    'sourcePlan',plan,'operationId',operation_identity,'parentAuditId',gen_random_uuid(),'historyId',gen_random_uuid(),
    'eventAt',TO_CHAR(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'movementIds',movements,'movementSequences',sequences,'childReceipt',receipt,'deltas',deltas);
  INSERT INTO phase5_private.mutation_contexts(id,transaction_id,generation,actor_id,order_id,purpose,
    operation_id,normalized_request,request_fingerprint,locked_plan)
    VALUES(context_identity,txid_current(),1,actor,order_identity,'CUSTOMER_COMPLETION',operation_identity,
      plan->'parent'->'request',UPPER(plan->'parent'->>'requestFingerprint'),frozen);
  RETURN context_identity;
END;
$$;

-- PRE-FIRST-SOURCE-WRITE only. Never run fresh standalone financial discovery
-- on an incomplete parent, or reacquire any lock through this assertion.
CREATE FUNCTION phase5_private.assert_customer_completion_context_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID := auth.uid(); c phase5_private.mutation_contexts%ROWTYPE; p JSONB; r JSONB;
  expected JSONB; actual JSONB; field TEXT; identity UUID; event_at TIMESTAMPTZ;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  p:=c.locked_plan->'sourcePlan'; r:=c.normalized_request;
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan,ARRAY['planVersion','planState','sourcePlan','operationId',
    'parentAuditId','historyId','eventAt','movementIds','movementSequences','childReceipt','deltas']);
  IF c.transaction_id IS DISTINCT FROM txid_current() OR c.actor_id IS DISTINCT FROM actor
    OR c.generation IS DISTINCT FROM 1 OR c.purpose IS DISTINCT FROM 'CUSTOMER_COMPLETION' OR c.operation_id IS NULL
    OR c.locked_plan->>'planVersion' IS DISTINCT FROM 'phase5-customer-parent-context-v1'
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY'
    OR c.locked_plan->>'operationId' IS DISTINCT FROM c.operation_id::TEXT
    OR p->'parent'->>'actorId' IS DISTINCT FROM actor::TEXT OR p->'parent'->>'orderId' IS DISTINCT FROM c.order_id::TEXT
    OR p->'parent'->'request' IS DISTINCT FROM r OR UPPER(p->'parent'->>'requestFingerprint') IS DISTINCT FROM c.request_fingerprint
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r))
    OR NOT EXISTS(SELECT 1 FROM phase5_private.authority_generation g JOIN phase5_private.activation_receipts a
      ON a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256 WHERE g.singleton AND g.generation=1
      AND g.authority_state='ACTIVE' AND g.manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_CONTEXT_INVALID';
  END IF;
  IF c.locked_plan->>'eventAt' IS NULL OR c.locked_plan->>'eventAt' !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_CONTEXT_INVALID';
  END IF;
  event_at:=(c.locked_plan->>'eventAt')::TIMESTAMPTZ;
  actual:=phase5_private.discover_customer_completion_union_core_v1(c.order_id,p->'parent'->>'requestKey',
    p->'parent'->>'originalMethod',(r->>'amount_collected_in_minor_units')::BIGINT,
    (r->>'delivery_fee_in_minor_units')::BIGINT,r->>'reference_number',r->>'notes',context_identity);
  expected:=p||JSONB_BUILD_OBJECT('planState','DISCOVERED_PARENT_CHILD_NOT_LOCKED','completeFor','CUSTOMER_COMPLETION_PARENT_CHILD_DISCOVERY_ONLY');
  IF actual IS DISTINCT FROM expected
    OR c.locked_plan->'deltas' IS DISTINCT FROM phase5_private.derive_customer_completion_deltas_v1(p,event_at) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PARENT_CONTEXT_CHANGED_RETRY';
  END IF;
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementIds',
    ARRAY(SELECT value->>'reservationId' FROM JSONB_ARRAY_ELEMENTS(c.locked_plan->'deltas'->'inventorySteps')));
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementSequences',
    ARRAY(SELECT value->>'reservationId' FROM JSONB_ARRAY_ELEMENTS(c.locked_plan->'deltas'->'inventorySteps')));
  IF EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') s
    WHERE phase5_private.money_v1(s.value)<=0)
    OR EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') GROUP BY value HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_SEQUENCE_INVALID';
  END IF;
  FOR field IN SELECT value FROM UNNEST(ARRAY['operationId','parentAuditId','historyId']) value LOOP
    PERFORM phase5_private.wire_uuid_v1(c.locked_plan->field);
  END LOOP;
  FOR field IN SELECT key FROM JSONB_OBJECT_KEYS(c.locked_plan->'movementIds') key LOOP
    identity:=phase5_private.wire_uuid_v1(c.locked_plan->'movementIds'->field);
    IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=identity) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_IDENTITY_ALREADY_USED';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.business_operations WHERE id=c.operation_id)
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=(c.locked_plan->>'parentAuditId')::UUID)
    OR EXISTS(SELECT 1 FROM public.order_status_history WHERE id=(c.locked_plan->>'historyId')::UUID) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_IDENTITY_ALREADY_USED';
  END IF;
  IF p->'child'='null'::JSONB THEN
    IF c.locked_plan->'childReceipt' IS DISTINCT FROM 'null'::JSONB THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_CONTEXT_INVALID';
    END IF;
  ELSE
    PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'childReceipt',
      ARRAY['identities','request','requestFingerprint','paymentNumber','eventAt','cashShiftId']);
    IF c.locked_plan->'childReceipt'->'identities' IS DISTINCT FROM p->'child'->'identities'
      OR c.locked_plan->'childReceipt'->'request' IS DISTINCT FROM p->'child'->'request'
      OR c.locked_plan->'childReceipt'->'requestFingerprint' IS DISTINCT FROM p->'child'->'requestFingerprint'
      OR c.locked_plan->'childReceipt'->'eventAt' IS DISTINCT FROM c.locked_plan->'eventAt'
      OR c.locked_plan->'childReceipt'->>'paymentNumber' IS NULL
      OR c.locked_plan->'childReceipt'->>'paymentNumber' !~ '^CRV-[0-9]{8}-[0-9]{6,}$'
      OR c.locked_plan->'childReceipt'->'cashShiftId' IS DISTINCT FROM (CASE
        WHEN p->'child'->'request'->>'tenderMethod'='cash' THEN p->'child'->'shiftId' ELSE 'null'::JSONB END) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_CONTEXT_INVALID';
    END IF;
  END IF;
  -- Per-reservation map identity must not collapse two planned movements into
  -- one UUID. Parent and child relation identities are server-owned and disjoint.
  IF EXISTS(SELECT 1 FROM (
      SELECT c.id::TEXT id UNION ALL SELECT c.locked_plan->>'operationId'
      UNION ALL SELECT c.locked_plan->>'parentAuditId' UNION ALL SELECT c.locked_plan->>'historyId'
      UNION ALL SELECT value FROM JSONB_EACH_TEXT(c.locked_plan->'movementIds')
      UNION ALL SELECT value FROM JSONB_EACH_TEXT(CASE WHEN p->'child'='null'::JSONB
        THEN '{}'::JSONB ELSE p->'child'->'identities' END)
    ) identities GROUP BY id HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_IDENTITY_DUPLICATE';
  END IF;
  RETURN TO_JSONB(c);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_CONTEXT_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_customer_completion_deltas_v1(JSONB,TIMESTAMPTZ),
  phase5_private.enter_customer_completion_context_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  phase5_private.assert_customer_completion_context_v1(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_customer_completion_deltas_v1(JSONB,TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION phase5_private.enter_customer_completion_context_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_context_v1(UUID) OWNER TO postgres;

-- A durable inventory-stage proof, NOT a source-write permit or settlement.
-- Expected identities/tuples originate in the immutable PREWRITE context.
-- It intentionally reads no current inventory balance/WAC: later legitimate
-- SKU activity must not reinterpret the historical per-reservation movements.
CREATE FUNCTION phase5_private.validate_customer_completion_inventory_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; p JSONB; parent JSONB; delta JSONB;
  creation JSONB; expected JSONB; actual JSONB; step JSONB; movement_identity UUID;
  event_at TIMESTAMPTZ; expected_sources JSONB; frozen_sources JSONB;
BEGIN
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  p:=c.locked_plan->'sourcePlan'; parent:=p->'parent'; delta:=c.locked_plan->'deltas';
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan,ARRAY['planVersion','planState','sourcePlan','operationId',
    'parentAuditId','historyId','eventAt','movementIds','movementSequences','childReceipt','deltas']);
  IF c.generation IS DISTINCT FROM 1 OR c.purpose IS DISTINCT FROM 'CUSTOMER_COMPLETION'
    OR c.operation_id IS NULL OR c.actor_id IS NULL OR c.order_id IS NULL
    OR c.locked_plan->>'planVersion' IS DISTINCT FROM 'phase5-customer-parent-context-v1'
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY'
    OR c.locked_plan->>'operationId' IS DISTINCT FROM c.operation_id::TEXT
    OR parent->>'actorId' IS DISTINCT FROM c.actor_id::TEXT OR parent->>'orderId' IS DISTINCT FROM c.order_id::TEXT
    OR parent->'order'->>'id' IS DISTINCT FROM c.order_id::TEXT
    OR parent->'request' IS DISTINCT FROM c.normalized_request
    OR c.normalized_request->>'order_id' IS DISTINCT FROM c.order_id::TEXT
    OR c.normalized_request->>'contract_version' IS DISTINCT FROM 'phase3-customer-completion-v1'
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(c.normalized_request))
    OR UPPER(parent->>'requestFingerprint') IS DISTINCT FROM c.request_fingerprint
    OR c.locked_plan->>'eventAt' IS NULL OR c.locked_plan->>'eventAt' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_CONTEXT_INVALID';
  END IF;
  event_at:=(c.locked_plan->>'eventAt')::TIMESTAMPTZ;
  SELECT TO_JSONB(b) INTO STRICT creation FROM public.business_operations b
    WHERE id=(parent->'creation'->>'id')::UUID;
  IF creation IS DISTINCT FROM parent->'creation'
    OR creation->>'operation_type' IS DISTINCT FROM 'phase3_customer_reservation_v1'
    OR creation->'request_identity_version' IS DISTINCT FROM '301'::JSONB
    OR creation->>'request_fingerprint' IS DISTINCT FROM
      public.phase3_request_fingerprint_internal(creation->'request_identity_snapshot')
    OR creation->'result_snapshot'->>'order_id' IS DISTINCT FROM c.order_id::TEXT
    OR creation->'result_snapshot'->>'operation_id' IS DISTINCT FROM creation->>'id'
    OR parent->'order'->>'operation_id' IS DISTINCT FROM creation->>'id'
    OR delta IS DISTINCT FROM phase5_private.derive_customer_completion_deltas_v1(p,event_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_ANCHOR_INVALID';
  END IF;
  IF JSONB_TYPEOF(delta->'inventorySteps') IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(delta->'inventorySteps')=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_SET_INVALID';
  END IF;
  -- Prove source coverage per item/instance/product identity in BOTH directions,
  -- not equal aggregate quantities/counts. No {A,B}->{A,A} substitution.
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('itemId',s->'reservationBefore'->'order_item_id',
    'instanceId',s->'reservationBefore'->'parcel_instance_id','componentId',s->'movement'->'parcel_component_id',
    'productId',s->'reservationBefore'->'product_id','quantity',s->'reservationBefore'->'reserved_quantity')
    ORDER BY s->'reservationBefore'->>'order_item_id',s->'reservationBefore'->>'parcel_instance_id',
      s->'reservationBefore'->>'product_id') INTO frozen_sources FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') s;
  SELECT JSONB_AGG(s ORDER BY s->>'itemId',s->>'instanceId',s->>'productId')
    INTO expected_sources FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources') s;
  IF expected_sources IS NULL OR expected_sources IS DISTINCT FROM frozen_sources
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') s
      GROUP BY s->>'reservationId' HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources') s
      GROUP BY s->>'itemId',s->>'instanceId',s->>'productId' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_SET_INVALID';
  END IF;
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementIds',
    ARRAY(SELECT value->>'reservationId' FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps')));
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementSequences',
    ARRAY(SELECT value->>'reservationId' FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps')));
  IF EXISTS(SELECT 1 FROM JSONB_EACH_TEXT(c.locked_plan->'movementIds')
    GROUP BY value HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') s WHERE phase5_private.money_v1(s.value)<=0)
    OR EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') GROUP BY value HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_SET_INVALID';
  END IF;
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') LOOP
    movement_identity:=phase5_private.wire_uuid_v1(c.locked_plan->'movementIds'->(step->>'reservationId'));
    SELECT TO_JSONB(r) INTO STRICT actual FROM public.order_inventory_reservations r
      WHERE id=(step->>'reservationId')::UUID;
    IF actual IS DISTINCT FROM step->'reservationAfter'
      OR actual->>'order_id' IS DISTINCT FROM c.order_id::TEXT
      OR actual->>'operation_id' IS DISTINCT FROM creation->>'id'
      OR actual->>'reservation_state' IS DISTINCT FROM 'consumed'
      OR step->'reservationBefore'->>'reservation_state' IS DISTINCT FROM 'active'
      OR step->'reservationBefore'->'resolved_at' IS DISTINCT FROM 'null'::JSONB THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_RESERVATION_INVALID';
    END IF;
    expected:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.inventory_movements,
      step->'movement'||JSONB_BUILD_OBJECT('id',movement_identity,
        'mutation_sequence',c.locked_plan->'movementSequences'->(step->>'reservationId'))));
    SELECT TO_JSONB(m) INTO STRICT actual FROM public.inventory_movements m WHERE id=movement_identity;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_MOVEMENT_INVALID';
    END IF;
  END LOOP;
  -- Exact operation/root/reservation ownership union: an alternate reference
  -- must not hide extra source evidence behind a different join/filter.
  IF EXISTS(SELECT 1 FROM public.inventory_movements m
    WHERE (m.reference_type='customer_order' AND m.reference_id=c.order_id
      OR m.operation_id=(creation->>'id')::UUID
      OR m.reservation_id IN (SELECT (s->>'reservationId')::UUID FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') s))
      AND NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') s
        WHERE m.id=(c.locked_plan->'movementIds'->>(s->>'reservationId'))::UUID))
    OR EXISTS(SELECT 1 FROM public.order_inventory_reservations r WHERE r.order_id=c.order_id
      AND NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(delta->'inventorySteps') s WHERE r.id=(s->>'reservationId')::UUID)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_SET_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('proofVersion','phase5-customer-parent-inventory-v1',
    'proofKind','DURABLE_INVENTORY_STAGE_ONLY','contextId',c.id,'parentOperationId',c.operation_id,
    'orderId',c.order_id,'movementIds',c.locked_plan->'movementIds');
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION
  OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_INVENTORY_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.validate_customer_completion_inventory_v1(UUID)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.validate_customer_completion_inventory_v1(UUID) OWNER TO postgres;

-- Cost is a separate durable stage. It cannot admit a parent/child writer or
-- replace deferred full completion. Expected cost comes from the immutable
-- prewrite plan and the closed114 allocator, never present-day product WAC.
CREATE FUNCTION phase5_private.validate_customer_completion_cost_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; parent JSONB; delta JSONB;
  step JSONB; expected JSONB; actual JSONB; expected_set JSONB; actual_set JSONB;
  frozen_set JSONB; event_at TIMESTAMPTZ; creation_identity UUID;
BEGIN
  PERFORM phase5_private.validate_customer_completion_inventory_v1(context_identity);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  parent:=c.locked_plan->'sourcePlan'->'parent'; delta:=c.locked_plan->'deltas';
  event_at:=(c.locked_plan->>'eventAt')::TIMESTAMPTZ;
  creation_identity:=(parent->'creation'->>'id')::UUID;
  IF JSONB_TYPEOF(delta->'costSteps') IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(delta->'costSteps')=0
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') s
      GROUP BY s->>'relation',s->>'id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_SET_INVALID';
  END IF;
  -- Equality includes every frozen commercial before-row, not merely totals
  -- or the rows reachable from successful cost updates.
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id','row',s->'before')
    ORDER BY s->>'relation',s->>'id') INTO expected_set FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') s;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id','row',s->'row')
    ORDER BY s->>'relation',s->>'id') INTO frozen_set FROM JSONB_ARRAY_ELEMENTS(parent->'resources') s
    WHERE s->>'relation' IN ('public.order_items','public.order_parcel_instances','public.order_parcel_components');
  IF expected_set IS NULL OR expected_set IS DISTINCT FROM frozen_set THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_SET_INVALID';
  END IF;
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') LOOP
    IF step->'before'->'cost_finalized_at' IS DISTINCT FROM 'null'::JSONB
      OR step->>'id' IS DISTINCT FROM step->'before'->>'id'
      OR step->>'id' IS DISTINCT FROM step->'after'->>'id'
      OR (step->'after'->>'cost_finalized_at')::TIMESTAMPTZ IS DISTINCT FROM event_at THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_ANCHOR_INVALID';
    END IF;
    CASE step->>'relation'
      WHEN 'public.order_items' THEN
        expected:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_items,step->'after'));
        SELECT TO_JSONB(t) INTO STRICT actual FROM public.order_items t WHERE id=(step->>'id')::UUID;
      WHEN 'public.order_parcel_instances' THEN
        expected:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_parcel_instances,step->'after'));
        SELECT TO_JSONB(t) INTO STRICT actual FROM public.order_parcel_instances t WHERE id=(step->>'id')::UUID;
      WHEN 'public.order_parcel_components' THEN
        expected:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_parcel_components,step->'after'));
        SELECT TO_JSONB(t) INTO STRICT actual FROM public.order_parcel_components t WHERE id=(step->>'id')::UUID;
      ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_SET_INVALID';
    END CASE;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_TUPLE_INVALID';
    END IF;
  END LOOP;
  -- Every actual root/creation/item-owned cost row must be expected. Alternate
  -- instance linkage cannot hide an extra component owned by the creation.
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',t.relation,'id',t.id) ORDER BY t.relation,t.id)
    INTO actual_set FROM (
      SELECT 'public.order_items'::TEXT relation,i.id::TEXT id FROM public.order_items i WHERE i.order_id=c.order_id
      UNION ALL
      SELECT 'public.order_parcel_instances',i.id::TEXT FROM public.order_parcel_instances i
        WHERE i.order_id=c.order_id OR i.operation_id=creation_identity
          OR i.order_item_id IN (SELECT (s->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') s
            WHERE s->>'relation'='public.order_items')
      UNION ALL
      SELECT 'public.order_parcel_components',i.id::TEXT FROM public.order_parcel_components i
        WHERE i.operation_id=creation_identity OR i.parcel_instance_id IN (
          SELECT p.id FROM public.order_parcel_instances p WHERE p.order_id=c.order_id
            OR p.operation_id=creation_identity
            OR p.id IN (SELECT (s->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') s
              WHERE s->>'relation'='public.order_parcel_instances'))
    ) t;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id') ORDER BY s->>'relation',s->>'id')
    INTO expected_set FROM JSONB_ARRAY_ELEMENTS(delta->'costSteps') s;
  IF actual_set IS DISTINCT FROM expected_set THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_SET_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('proofVersion','phase5-customer-parent-cost-v1',
    'proofKind','DURABLE_COST_STAGE_ONLY','contextId',c.id,'parentOperationId',c.operation_id,
    'orderId',c.order_id,'costIdentities',expected_set);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION
  OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COST_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.validate_customer_completion_cost_v1(UUID)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.validate_customer_completion_cost_v1(UUID) OWNER TO postgres;

-- Pure expected tuples, BEFORE source execution. These are not a permit or a
-- successful operation. Preserve116 fields,058 delivery time and043 projection
-- semantics while separating the full initial collection from a partial child.
CREATE FUNCTION phase5_private.derive_customer_completion_outcome_v1(c JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB:=c->'locked_plan'->'sourcePlan'->'parent'; r JSONB:=c->'normalized_request';
  receipt JSONB:=c->'locked_plan'->'childReceipt'; child JSONB:=c->'locked_plan'->'sourcePlan'->'child';
  o JSONB:=parent->'order'; capacity JSONB:=parent->'capacity'; event_at TIMESTAMPTZ;
  actor UUID; order_identity UUID; operation_identity UUID; shift_identity UUID; shift_number TEXT;
  total BIGINT; collected BIGINT; remaining BIGINT; fee BIGINT; tender TEXT;
  outcome JSONB; after_order JSONB; expected JSONB; child_expected JSONB:='null'::JSONB;
  cr JSONB; ids JSONB; inner_request JSONB; inner_result JSONB; payment JSONB; child_wire JSONB;
BEGIN
  actor:=phase5_private.wire_uuid_v1(c->'actor_id'); order_identity:=phase5_private.wire_uuid_v1(c->'order_id');
  operation_identity:=phase5_private.wire_uuid_v1(c->'operation_id');
  IF c->'generation' IS DISTINCT FROM '1'::JSONB OR c->>'purpose' IS DISTINCT FROM 'CUSTOMER_COMPLETION'
    OR c->'locked_plan'->>'planVersion' IS DISTINCT FROM 'phase5-customer-parent-context-v1'
    OR c->'locked_plan'->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY'
    OR parent->'request' IS DISTINCT FROM r OR parent->>'actorId' IS DISTINCT FROM actor::TEXT
    OR parent->>'orderId' IS DISTINCT FROM order_identity::TEXT OR o->>'id' IS DISTINCT FROM order_identity::TEXT
    OR r->>'contract_version' IS DISTINCT FROM 'phase3-customer-completion-v1'
    OR r->>'order_id' IS DISTINCT FROM order_identity::TEXT
    OR r->>'actor_scope_hash' IS DISTINCT FROM public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL)
    OR c->>'request_fingerprint' IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r))
    OR c->'locked_plan'->>'operationId' IS DISTINCT FROM operation_identity::TEXT THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_CONTEXT_INVALID';
  END IF;
  total:=phase5_private.wire_money_v1(capacity->'totalInMinorUnits');
  collected:=phase5_private.wire_money_v1(capacity->'collectedInMinorUnits');
  remaining:=phase5_private.wire_money_v1(capacity->'remainingInMinorUnits');
  fee:=phase5_private.wire_money_v1(capacity->'deliveryInMinorUnits');
  tender:=r->>'payment_method'; event_at:=(c->'locked_plan'->>'eventAt')::TIMESTAMPTZ;
  IF event_at IS NULL OR tender IS NULL OR tender NOT IN ('cash','cliq','debt')
    OR collected>total OR remaining IS DISTINCT FROM total-collected
    OR total::NUMERIC IS DISTINCT FROM phase5_private.money_v1(parent->'creation'->'result_snapshot'->'subtotal')
      -phase5_private.money_v1(parent->'creation'->'result_snapshot'->'discount')+fee
    OR fee IS DISTINCT FROM COALESCE((r->>'delivery_fee_in_minor_units')::BIGINT,(o->>'delivery_fee_in_minor_units')::BIGINT)
    OR collected IS DISTINCT FROM (CASE WHEN tender='debt' THEN 0 ELSE
      COALESCE((r->>'amount_collected_in_minor_units')::BIGINT,total) END)
    OR capacity->'receiptRequired' IS DISTINCT FROM TO_JSONB(collected>0 AND remaining>0) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_FINANCIAL_INVALID';
  END IF;
  IF collected=0 THEN tender:='debt'; END IF;
  IF JSONB_TYPEOF(parent->'shifts') IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(parent->'shifts')>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_SHIFT_INVALID';
  END IF;
  shift_identity:=(parent->'shifts'->0->'row'->>'id')::UUID;
  shift_number:=parent->'shifts'->0->'row'->>'shift_number';
  IF (collected>0 AND (shift_identity IS NULL OR shift_number IS NULL))
    OR (shift_identity IS NOT NULL AND (parent->'shifts'->0->'row'->>'branch_id' IS DISTINCT FROM o->>'branch_id'
      OR parent->'shifts'->0->'row'->>'status' IS DISTINCT FROM 'open')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_SHIFT_INVALID';
  END IF;
  IF collected>0 AND remaining>0 THEN
    PERFORM phase5_private.assert_wire_keys_v1(receipt,ARRAY['identities','request','requestFingerprint','paymentNumber','eventAt','cashShiftId']);
    ids:=receipt->'identities'; cr:=receipt->'request';
    IF receipt->'identities' IS DISTINCT FROM child->'identities' OR receipt->'request' IS DISTINCT FROM child->'request'
      OR cr IS DISTINCT FROM phase5_private.normalize_collection_request_v2(actor,order_identity,collected,tender,
        r->>'reference_number',COALESCE(r->>'notes','دفعة مستلمة عند تسليم طلب V2'),cr->>'idempotencyKey')
      OR receipt->>'requestFingerprint' IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(cr))
      OR receipt->'requestFingerprint' IS DISTINCT FROM child->'requestFingerprint'
      OR receipt->'eventAt' IS DISTINCT FROM c->'locked_plan'->'eventAt'
      OR receipt->>'paymentNumber' IS NULL OR receipt->>'paymentNumber' !~ '^CRV-[0-9]{8}-[0-9]{6,}$'
      OR (tender='cash' AND receipt->'cashShiftId' IS DISTINCT FROM TO_JSONB(shift_identity))
      -- NULL CliQ attribution remains deliberately unaligned under120. It is
      -- represented below, never converted into a fake Cash Shift.
      OR (tender='cliq' AND receipt->'cashShiftId' IS DISTINCT FROM 'null'::JSONB) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
    END IF;
    payment:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.customer_payments,JSONB_BUILD_OBJECT(
      'id',phase5_private.wire_uuid_v1(ids->'paymentId'),'payment_number',receipt->'paymentNumber',
      'customer_id',o->'customer_id','order_id',order_identity,'amount_in_minor_units',collected,
      'payment_method',tender,'reference_number',cr->'tenderReference','notes',cr->'notes','created_by',actor,
      'created_at',event_at,'cash_shift_id',receipt->'cashShiftId','idempotency_key',cr->'idempotencyKey',
      'is_reversed',false,'reversed_at',NULL,'reversed_by',NULL,'reversal_reason',NULL)));
    inner_request:=JSONB_BUILD_OBJECT('requestVersion','phase5-customer-collection-v1','actorScopeType','erp_user',
      'actorScopeId',actor,'orderId',order_identity,'originalPaymentId',ids->'paymentId',
      'amountInMinorUnits',collected,'tenderMethod',tender,'tenderReference',cr->'tenderReference');
    inner_result:=JSONB_BUILD_OBJECT('success',true,'resultType','customer_collection_committed_v1',
      'operationId',ids->'operationId','collectionEventId',ids->'collectionId','originalPaymentId',ids->'paymentId',
      'orderId',order_identity,'customerId',o->'customer_id','amountInMinorUnits',collected,
      'tenderMethod',tender,'tenderReference',cr->'tenderReference','cashShiftId',receipt->'cashShiftId','operationEventAt',receipt->'eventAt');
    child_wire:=cr||JSONB_BUILD_OBJECT('contractVersion','phase5-customer-collection-result-v2','kind','COMMITTED_COLLECTION',
      'success',true,'request',cr,'requestFingerprint',receipt->'requestFingerprint','operationId',ids->'operationId',
      'originalPaymentId',ids->'paymentId','collectionId',ids->'collectionId','paymentNumber',receipt->'paymentNumber',
      'outstandingBeforeInMinorUnits',total::TEXT,'outstandingAfterInMinorUnits',remaining::TEXT);
    PERFORM phase5_private.assert_collection_result_v2(cr,child_wire);
    child_expected:=JSONB_BUILD_OBJECT('payment',payment,'wireResult',child_wire,
      'operation',TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.financial_operation_events,JSONB_BUILD_OBJECT(
        'id',phase5_private.wire_uuid_v1(ids->'operationId'),'operation_type','customer_collection_v1',
        'actor_scope_type','erp_user','actor_scope_id',actor,'idempotency_key',cr->'idempotencyKey',
        'request_fingerprint',UPPER(public.phase3_request_fingerprint_internal(inner_request)),
        'request_identity_snapshot',inner_request,'result_type','customer_collection_committed_v1',
        'result_snapshot',inner_result,'operation_event_at',event_at))),
      'collection',TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.collection_events,JSONB_BUILD_OBJECT(
        'id',phase5_private.wire_uuid_v1(ids->'collectionId'),'financial_operation_id',ids->'operationId',
        'operation_type','customer_collection_v1','operation_event_at',event_at,'original_payment_id',ids->'paymentId',
        'order_id',order_identity,'customer_id',o->'customer_id','cash_shift_id',receipt->'cashShiftId',
        'tender_method',tender,'amount_in_minor_units',collected,'tender_reference',cr->'tenderReference'))),
      'audit',TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
        'id',phase5_private.wire_uuid_v1(ids->'auditId'),'user_id',actor,'action','RECORD_CUSTOMER_PAYMENT',
        'entity_name','customer_payments','entity_id',ids->'paymentId','created_at',event_at,
        'details',JSONB_BUILD_OBJECT('contractVersion','phase5-collection-audit-v2','operationId',ids->'operationId',
          'orderId',order_identity,'paymentNumber',receipt->'paymentNumber','request',cr,'requestFingerprint',receipt->'requestFingerprint')))));
  ELSIF receipt IS DISTINCT FROM 'null'::JSONB OR child IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
  END IF;
  outcome:=JSONB_BUILD_OBJECT('success',true,'idempotent_replay',false,'operation_id',operation_identity,
    'order_id',order_identity,'order_number',o->'order_number','status','completed',
    'payment_method',CASE WHEN remaining>0 THEN 'debt' ELSE tender END,
    'payment_status',CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
    'total_in_minor_units',total,'amount_paid_in_minor_units',collected,'remaining_in_minor_units',remaining,
    'customer_payment_number',CASE WHEN child_expected='null'::JSONB THEN 'null'::JSONB ELSE receipt->'paymentNumber' END,
    'cash_shift_id',shift_identity,'cash_shift_number',shift_number,'cost_finalized_at',event_at,
    'message','تم إكمال طلب V2 واستهلاك مكوناته وتجميد تكلفته مرة واحدة.');
  after_order:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.orders,o||JSONB_BUILD_OBJECT(
    'status','completed','delivery_fee_in_minor_units',fee,'total_in_minor_units',total,
    'payment_method',CASE WHEN remaining>0 OR tender='debt' THEN 'debt' WHEN tender='cash' THEN 'cash_on_delivery' ELSE 'cliq' END,
    'payment_status',outcome->'payment_status','amount_paid_in_minor_units',collected,
    'payment_reference_number',CASE WHEN tender='cliq' THEN r->'reference_number' ELSE 'null'::JSONB END,
    'payment_confirmed_at',CASE WHEN collected>0 THEN TO_JSONB(event_at) ELSE 'null'::JSONB END,
    'payment_confirmed_by',CASE WHEN collected>0 THEN TO_JSONB(actor) ELSE 'null'::JSONB END,
    'cash_shift_id',shift_identity,'cost_finalized_at',event_at,'updated_at',event_at,
    'delivery_completed_at',CASE WHEN o->'delivery_completed_at'='null'::JSONB THEN TO_JSONB(event_at) ELSE o->'delivery_completed_at' END)));
  expected:=JSONB_BUILD_OBJECT('modelVersion','phase5-customer-parent-outcome-tuples-v1','parentResult',outcome,'orderAfter',after_order,
    'initialCollectionInMinorUnits',CASE WHEN child_expected='null'::JSONB THEN collected::TEXT ELSE '0' END,
    'childReceipt',child_expected,
    'operation',TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.business_operations,JSONB_BUILD_OBJECT(
      'id',operation_identity,'operation_type','phase3_customer_completion_v1','idempotency_key',parent->'requestKey',
      'request_fingerprint',public.phase3_request_fingerprint_internal(r),'initiated_by',actor,'created_at',event_at,
      'result_snapshot',outcome,'completed_at',event_at,'request_identity_version',301,'request_identity_snapshot',r,
      'actor_scope_type','erp_user','actor_scope_hash',r->'actor_scope_hash'))),
    'history',TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_status_history,JSONB_BUILD_OBJECT(
      'id',phase5_private.wire_uuid_v1(c->'locked_plan'->'historyId'),'order_id',order_identity,
      'old_status',o->'status','new_status','completed','changed_by',actor,'created_at',event_at,
      'notes',COALESCE(r->>'notes','إكمال طلب V2 واستهلاك الحجز ذريًا')))),
    'audit',TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
      'id',phase5_private.wire_uuid_v1(c->'locked_plan'->'parentAuditId'),'user_id',actor,'action','COMPLETE_CUSTOMER_ORDER_V2',
      'entity_name','orders','entity_id',order_identity,'created_at',event_at,'details',JSONB_BUILD_OBJECT(
        'operation_id',operation_identity,'creation_operation_id',parent->'creation'->'id',
        'consumed_reservations',JSONB_ARRAY_LENGTH(c->'locked_plan'->'deltas'->'inventorySteps'))))));
  RETURN expected;
EXCEPTION WHEN INVALID_TEXT_REPRESENTATION OR NUMERIC_VALUE_OUT_OF_RANGE
  OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_CONTEXT_INVALID';
END;
$$;

-- Initial durable stage ONLY. Full live Order equality is appropriate here,
-- not as a historical replay gate after later payments/returns. No 127 reader,
-- receipt envelope, child mutation context or source execution is admitted.
CREATE FUNCTION phase5_private.validate_customer_completion_outcome_v1(context_identity UUID, historical BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; expected JSONB; actual JSONB; child JSONB;
  expected_history JSONB; actual_history JSONB;
BEGIN
  IF historical IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PARENT_PROOF_MODE_INVALID'; END IF;
  PERFORM phase5_private.validate_customer_completion_cost_v1(context_identity);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  expected:=phase5_private.derive_customer_completion_outcome_v1(TO_JSONB(c)); child:=expected->'childReceipt';
  SELECT TO_JSONB(t) INTO STRICT actual FROM public.orders t WHERE id=c.order_id;
  IF (NOT historical AND actual IS DISTINCT FROM expected->'orderAfter')
    OR (historical AND EXISTS(SELECT 1 FROM UNNEST(ARRAY['id','operation_id','source','customer_id',
      'branch_id','warehouse_id','subtotal_in_minor_units','discount_in_minor_units','delivery_fee_in_minor_units',
      'total_in_minor_units','cost_finalized_at','delivery_completed_at']) field
      WHERE actual->field IS DISTINCT FROM expected->'orderAfter'->field)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_ORDER_INVALID';
  END IF;
  SELECT TO_JSONB(t) INTO STRICT actual FROM public.business_operations t WHERE id=c.operation_id;
  IF actual IS DISTINCT FROM expected->'operation' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_OPERATION_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM public.business_operations b WHERE b.operation_type='phase3_customer_completion_v1'
    AND (b.request_identity_snapshot->>'order_id'=c.order_id::TEXT OR b.result_snapshot->>'order_id'=c.order_id::TEXT
      OR b.idempotency_key=c.locked_plan->'sourcePlan'->'parent'->>'requestKey') AND b.id<>c.operation_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_SET_INVALID';
  END IF;
  SELECT TO_JSONB(t) INTO STRICT actual FROM public.audit_logs t WHERE id=(expected->'audit'->>'id')::UUID;
  IF actual IS DISTINCT FROM expected->'audit' OR EXISTS(SELECT 1 FROM public.audit_logs a
    WHERE a.action='COMPLETE_CUSTOMER_ORDER_V2' AND (a.entity_id=c.order_id OR a.details->>'operation_id'=c.operation_id::TEXT)
      AND a.id<>(expected->'audit'->>'id')::UUID) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_AUDIT_INVALID';
  END IF;
  SELECT JSONB_AGG(h ORDER BY h->>'id') INTO expected_history FROM (
    SELECT s->'row' h FROM JSONB_ARRAY_ELEMENTS(c.locked_plan->'sourcePlan'->'parent'->'resources') s
      WHERE s->>'relation'='public.order_status_history'
    UNION ALL SELECT expected->'history') rows;
  SELECT JSONB_AGG(TO_JSONB(h) ORDER BY h.id::TEXT) INTO actual_history FROM public.order_status_history h WHERE order_id=c.order_id;
  IF (NOT historical AND actual_history IS DISTINCT FROM expected_history)
    OR (historical AND (EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(expected_history) h
      WHERE NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(actual_history) a WHERE a=h))
      OR EXISTS(SELECT 1 FROM public.order_status_history h WHERE h.order_id=c.order_id AND h.new_status='completed'
        AND h.id<>(expected->'history'->>'id')::UUID))) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_HISTORY_INVALID';
  END IF;
  IF child='null'::JSONB THEN
    IF NOT historical AND (EXISTS(SELECT 1 FROM public.customer_payments p WHERE p.order_id=c.order_id)
      OR EXISTS(SELECT 1 FROM phase5_private.collection_events e WHERE e.order_id=c.order_id)
      OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events f
        WHERE f.request_identity_snapshot->>'orderId'=c.order_id::TEXT OR f.result_snapshot->>'orderId'=c.order_id::TEXT)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_SET_INVALID';
    END IF;
  ELSE
    SELECT TO_JSONB(t) INTO STRICT actual FROM public.customer_payments t WHERE id=(child->'payment'->>'id')::UUID;
    IF actual IS DISTINCT FROM child->'payment' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
    END IF;
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.financial_operation_events t WHERE id=(child->'operation'->>'id')::UUID;
    IF actual IS DISTINCT FROM child->'operation' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
    END IF;
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.collection_events t WHERE id=(child->'collection'->>'id')::UUID;
    IF actual IS DISTINCT FROM child->'collection' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
    END IF;
    SELECT TO_JSONB(t) INTO STRICT actual FROM public.audit_logs t WHERE id=(child->'audit'->>'id')::UUID;
    IF actual IS DISTINCT FROM child->'audit' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_INVALID';
    END IF;
    PERFORM phase5_private.validate_customer_collection_operation_v1((child->'operation'->>'id')::UUID);
    IF EXISTS(SELECT 1 FROM public.customer_payments t
        WHERE (NOT historical AND t.order_id=c.order_id OR t.created_by=c.actor_id AND t.idempotency_key=child->'operation'->>'idempotency_key')
          AND t.id<>(child->'payment'->>'id')::UUID)
      OR EXISTS(SELECT 1 FROM phase5_private.collection_events t WHERE
        (NOT historical AND t.order_id=c.order_id OR t.financial_operation_id=(child->'operation'->>'id')::UUID
          OR t.original_payment_id=(child->'payment'->>'id')::UUID) AND t.id<>(child->'collection'->>'id')::UUID)
      OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events t WHERE
        (NOT historical AND (t.request_identity_snapshot->>'orderId'=c.order_id::TEXT OR t.result_snapshot->>'orderId'=c.order_id::TEXT)
          OR t.actor_scope_id=c.actor_id AND t.idempotency_key=child->'operation'->>'idempotency_key')
          AND t.id<>(child->'operation'->>'id')::UUID)
      OR EXISTS(SELECT 1 FROM public.audit_logs t WHERE t.action='RECORD_CUSTOMER_PAYMENT'
        AND (t.entity_id=(child->'payment'->>'id')::UUID OR t.details->>'operationId'=child->'operation'->>'id')
        AND t.id<>(child->'audit'->>'id')::UUID) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_RECEIPT_SET_INVALID';
    END IF;
  END IF;
  RETURN JSONB_BUILD_OBJECT('proofVersion','phase5-customer-parent-outcome-v1','proofKind','DURABLE_PARENT_OUTCOME_STAGE_ONLY',
    'contextId',c.id,'parentOperationId',c.operation_id,'orderId',c.order_id,
    'initialCollectionInMinorUnits',expected->'initialCollectionInMinorUnits',
    'partialCollectionInMinorUnits',CASE WHEN child='null'::JSONB THEN '0' ELSE child->'payment'->>'amount_in_minor_units' END);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_OUTCOME_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_customer_completion_outcome_v1(JSONB),
  phase5_private.validate_customer_completion_outcome_v1(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_customer_completion_outcome_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.validate_customer_completion_outcome_v1(UUID,BOOLEAN) OWNER TO postgres;

-- Pure child context/envelope expectation. The child has its OWN operation
-- identity for the existing composite FK; it never impersonates the parent.
-- All identities/request/result come from the parent PREWRITE anchors. This
-- is an initial link-stage model, not operational completion/replay authority.
CREATE FUNCTION phase5_private.derive_customer_completion_child_link_v1(c JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE e JSONB; child JSONB; receipt JSONB:=c->'locked_plan'->'childReceipt';
  context_identity UUID; h TEXT; child_context JSONB; field TEXT;
BEGIN
  e:=phase5_private.derive_customer_completion_outcome_v1(c); child:=e->'childReceipt';
  IF child='null'::JSONB THEN RETURN JSONB_BUILD_OBJECT('context','null'::JSONB,'envelope','null'::JSONB); END IF;
  h:=LOWER(public.phase3_request_fingerprint_internal(JSONB_BUILD_OBJECT(
    'domain','phase5-customer-parent-child-context-v1','parentContextId',c->'id',
    'childOperationId',receipt->'identities'->'operationId')));
  context_identity:=(SUBSTR(h,1,8)||'-'||SUBSTR(h,9,4)||'-8'||SUBSTR(h,14,3)||'-8'||SUBSTR(h,18,3)||'-'||SUBSTR(h,21,12))::UUID;
  IF c->'transaction_id' IS NULL OR c->'transaction_id'='null'::JSONB
    OR phase5_private.money_v1(c->'transaction_id')<=0
    OR context_identity=phase5_private.wire_uuid_v1(c->'id') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_IDENTITY_INVALID';
  END IF;
  FOREACH field IN ARRAY ARRAY['operationId','parentAuditId','historyId'] LOOP
    IF context_identity=phase5_private.wire_uuid_v1(c->'locked_plan'->field) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_IDENTITY_INVALID';
    END IF;
  END LOOP;
  FOR field IN SELECT key FROM JSONB_OBJECT_KEYS(receipt->'identities') key LOOP
    IF context_identity=phase5_private.wire_uuid_v1(receipt->'identities'->field) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_IDENTITY_INVALID';
    END IF;
  END LOOP;
  FOR field IN SELECT key FROM JSONB_OBJECT_KEYS(c->'locked_plan'->'movementIds') key LOOP
    IF context_identity=phase5_private.wire_uuid_v1(c->'locked_plan'->'movementIds'->field) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_IDENTITY_INVALID';
    END IF;
  END LOOP;
  child_context:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.mutation_contexts,JSONB_BUILD_OBJECT(
    'id',context_identity,'transaction_id',c->'transaction_id','generation',1,'actor_id',c->'actor_id',
    'order_id',c->'order_id','purpose','CUSTOMER_COLLECTION','operation_id',receipt->'identities'->'operationId',
    'normalized_request',receipt->'request','request_fingerprint',receipt->'requestFingerprint',
    'locked_plan',JSONB_BUILD_OBJECT('planVersion','phase5-parent-collection-context-v1',
      'planState','LOCKED_PARENT_CHILD_PREWRITE_ONLY','parentContextId',c->'id','parentOperationId',c->'operation_id',
      'parentKey',c->'locked_plan'->'sourcePlan'->'parent'->'requestKey',
      'parentRequestFingerprint',c->'request_fingerprint','receipt',receipt))));
  RETURN JSONB_BUILD_OBJECT('context',child_context,'envelope',
    TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.collection_attempt_envelopes,JSONB_BUILD_OBJECT(
      'financial_operation_id',receipt->'identities'->'operationId','collection_id',receipt->'identities'->'collectionId',
      'original_payment_id',receipt->'identities'->'paymentId','payment_audit_id',receipt->'identities'->'auditId',
      'context_id',context_identity,'actor_id',c->'actor_id','order_id',c->'order_id',
      'idempotency_key',receipt->'request'->'idempotencyKey','request_snapshot',receipt->'request',
      'request_fingerprint',receipt->'requestFingerprint','result_snapshot',child->'wireResult'))));
END;
$$;

-- Called BEFORE the first parent source write. Reuse its complete held plan;
-- no new key/root/Shift/FK lock, standalone entry or incomplete-Order127 read.
-- Ordinary INSERT remains blocked by the preparation barrier/generation0.
CREATE FUNCTION phase5_private.enter_customer_completion_child_context_v1(parent_context_identity UUID)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; expected JSONB; child JSONB; identity UUID;
BEGIN
  parent:=phase5_private.assert_customer_completion_context_v1(parent_context_identity);
  expected:=phase5_private.derive_customer_completion_child_link_v1(parent); child:=expected->'context';
  IF child='null'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_NOT_REQUIRED';
  END IF;
  identity:=phase5_private.wire_uuid_v1(child->'id');
  IF EXISTS(SELECT 1 FROM phase5_private.mutation_contexts c WHERE c.id=identity
      OR c.operation_id=(child->>'operation_id')::UUID OR c.locked_plan->>'parentContextId'=parent_context_identity::TEXT) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_ALREADY_EXISTS';
  END IF;
  INSERT INTO phase5_private.mutation_contexts SELECT (JSONB_POPULATE_RECORD(NULL::phase5_private.mutation_contexts,child)).*;
  RETURN identity;
END;
$$;

-- Initial durable link stage ONLY. It proves the exact context/envelope after
-- the independently validated parent outcome and source receipt. The existing
-- standalone validator/resolver is NOT extended to adopt this new parent kind;
-- deferred parent completion stays55000 until the complete executor exists.
CREATE FUNCTION phase5_private.validate_customer_completion_child_link_v1(parent_context_identity UUID, historical BOOLEAN DEFAULT FALSE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; expected JSONB; child JSONB; envelope JSONB; actual JSONB;
BEGIN
  PERFORM phase5_private.validate_customer_completion_outcome_v1(parent_context_identity,historical);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=parent_context_identity;
  expected:=phase5_private.derive_customer_completion_child_link_v1(TO_JSONB(c));
  child:=expected->'context'; envelope:=expected->'envelope';
  IF child='null'::JSONB THEN
    IF EXISTS(SELECT 1 FROM phase5_private.mutation_contexts t WHERE NOT historical AND t.order_id=c.order_id AND t.id<>c.id
        OR t.locked_plan->>'parentContextId'=c.id::TEXT OR t.operation_id=c.operation_id AND t.id<>c.id)
      OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes t WHERE NOT historical AND t.order_id=c.order_id OR t.context_id=c.id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_LINK_SET_INVALID';
    END IF;
  ELSE
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.mutation_contexts t WHERE id=(child->>'id')::UUID;
    IF actual IS DISTINCT FROM child THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_CONTEXT_INVALID';
    END IF;
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.collection_attempt_envelopes t
      WHERE financial_operation_id=(envelope->>'financial_operation_id')::UUID;
    IF actual IS DISTINCT FROM envelope THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_ENVELOPE_INVALID';
    END IF;
    IF EXISTS(SELECT 1 FROM phase5_private.mutation_contexts t WHERE
        (NOT historical AND t.order_id=c.order_id OR t.operation_id=(child->>'operation_id')::UUID OR t.operation_id=c.operation_id
          OR t.locked_plan->>'parentContextId'=c.id::TEXT)
        AND t.id NOT IN (c.id,(child->>'id')::UUID))
      OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes t WHERE
        (NOT historical AND t.order_id=c.order_id OR t.context_id IN (c.id,(child->>'id')::UUID)
          OR t.actor_id=c.actor_id AND t.idempotency_key=envelope->>'idempotency_key'
          OR t.original_payment_id=(envelope->>'original_payment_id')::UUID)
        AND t.financial_operation_id<>(envelope->>'financial_operation_id')::UUID) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_LINK_SET_INVALID';
    END IF;
  END IF;
  RETURN JSONB_BUILD_OBJECT('proofVersion','phase5-customer-parent-child-link-v1',
    'proofKind','DURABLE_PARENT_CHILD_LINK_STAGE_ONLY','parentContextId',c.id,'parentOperationId',c.operation_id,
    'orderId',c.order_id,'childContextId',child->'id','childOperationId',child->'operation_id');
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_CHILD_LINK_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_customer_completion_child_link_v1(JSONB),
  phase5_private.enter_customer_completion_child_context_v1(UUID),
  phase5_private.validate_customer_completion_child_link_v1(UUID,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_customer_completion_child_link_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.enter_customer_completion_child_context_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.validate_customer_completion_child_link_v1(UUID,BOOLEAN) OWNER TO postgres;

-- Pure ordered business-transition model. This does not execute DML, mint
-- identities, acquire locks or admit completion. Retained116 guard rows remain
-- a separate prerequisite for the future executor, not a selector exemption.
CREATE FUNCTION phase5_private.derive_customer_completion_writes_v1(c JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE e JSONB; link JSONB; child JSONB; s JSONB; writes JSONB:='[]'::JSONB; first_order JSONB;
  movement JSONB; relation_name TEXT; field TEXT; row_value JSONB;
BEGIN
  e:=phase5_private.derive_customer_completion_outcome_v1(c);
  link:=phase5_private.derive_customer_completion_child_link_v1(c); child:=e->'childReceipt';
  IF c->'locked_plan'->'deltas' IS DISTINCT FROM phase5_private.derive_customer_completion_deltas_v1(
    c->'locked_plan'->'sourcePlan',(c->'locked_plan'->>'eventAt')::TIMESTAMPTZ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_WRITE_MODEL_INVALID';
  END IF;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(c->'locked_plan'->'deltas'->'inventorySteps') LOOP
    movement:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.inventory_movements,s->'movement'||JSONB_BUILD_OBJECT(
      'id',c->'locked_plan'->'movementIds'->(s->>'reservationId'),
      'mutation_sequence',c->'locked_plan'->'movementSequences'->(s->>'reservationId'))));
    writes:=writes||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','public.inventory_balances','action','UPDATE','id',s->'balanceId',
        'before',s->'balanceBefore','after',s->'balanceAfter'),
      JSONB_BUILD_OBJECT('relation','public.order_inventory_reservations','action','UPDATE','id',s->'reservationId',
        'before',s->'reservationBefore','after',s->'reservationAfter'),
      JSONB_BUILD_OBJECT('relation','public.inventory_movements','action','INSERT','id',movement->'id',
        'before','null'::JSONB,'after',movement));
  END LOOP;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(c->'locked_plan'->'deltas'->'costSteps') LOOP
    writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',s->'relation','action','UPDATE',
      'id',s->'id','before',s->'before','after',s->'after'));
  END LOOP;
  first_order:=e->'orderAfter';
  IF child IS DISTINCT FROM 'null'::JSONB THEN
    first_order:=first_order||JSONB_BUILD_OBJECT('amount_paid_in_minor_units',0,'payment_status','unpaid');
  END IF;
  writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.orders','action','UPDATE',
    'id',c->'order_id','before',c->'locked_plan'->'sourcePlan'->'parent'->'order','after',first_order));
  FOREACH field IN ARRAY ARRAY['operation','history','audit'] LOOP
    relation_name:=CASE field WHEN 'operation' THEN 'public.business_operations'
      WHEN 'history' THEN 'public.order_status_history' ELSE 'public.audit_logs' END;
    row_value:=e->field;
    writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',relation_name,'action','INSERT',
      'id',row_value->'id','before','null'::JSONB,'after',row_value));
  END LOOP;
  IF child IS DISTINCT FROM 'null'::JSONB THEN
    FOREACH field IN ARRAY ARRAY['payment','operation','collection','audit','envelope'] LOOP
      relation_name:=CASE field WHEN 'payment' THEN 'public.customer_payments'
        WHEN 'operation' THEN 'phase5_private.financial_operation_events'
        WHEN 'collection' THEN 'phase5_private.collection_events'
        WHEN 'audit' THEN 'public.audit_logs' ELSE 'phase5_private.collection_attempt_envelopes' END;
      row_value:=CASE WHEN field='envelope' THEN link->field ELSE child->field END;
      writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',relation_name,'action','INSERT',
        'id',CASE WHEN field='envelope' THEN row_value->'financial_operation_id' ELSE row_value->'id' END,
        'before','null'::JSONB,'after',row_value));
    END LOOP;
    writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.orders','action','UPDATE',
      'id',c->'order_id','before',first_order,'after',e->'orderAfter'));
  END IF;
  RETURN JSONB_BUILD_OBJECT('modelVersion','phase5-parent-business-transitions-v1','writes',writes);
END;
$$;

-- Frozen permit usable between planned writes. It never rediscovers sources,
-- exempts arbitrary root contexts, re-enters standalone acquisition or reads127.
CREATE FUNCTION phase5_private.assert_customer_completion_permit_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID:=auth.uid(); c phase5_private.mutation_contexts%ROWTYPE; p JSONB;
  link JSONB; actual JSONB; child JSONB;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  p:=c.locked_plan->'sourcePlan';
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan,ARRAY['planVersion','planState','sourcePlan','operationId',
    'parentAuditId','historyId','eventAt','movementIds','movementSequences','childReceipt','deltas']);
  IF c.transaction_id IS DISTINCT FROM txid_current() OR c.actor_id IS DISTINCT FROM actor
    OR c.generation IS DISTINCT FROM 1 OR c.purpose IS DISTINCT FROM 'CUSTOMER_COMPLETION'
    OR c.operation_id IS NULL OR c.locked_plan->>'operationId' IS DISTINCT FROM c.operation_id::TEXT
    OR c.locked_plan->>'planVersion' IS DISTINCT FROM 'phase5-customer-parent-context-v1'
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_PARENT_PREWRITE_CONTEXT_ONLY'
    OR p->'parent'->>'actorId' IS DISTINCT FROM actor::TEXT OR p->'parent'->>'orderId' IS DISTINCT FROM c.order_id::TEXT
    OR p->'parent'->'request' IS DISTINCT FROM c.normalized_request
    OR UPPER(p->'parent'->>'requestFingerprint') IS DISTINCT FROM c.request_fingerprint
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(c.normalized_request))
    OR NOT EXISTS(SELECT 1 FROM phase5_private.authority_generation g JOIN phase5_private.activation_receipts a
      ON a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256 WHERE g.singleton AND g.generation=1
      AND g.authority_state='ACTIVE' AND g.manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_PERMIT_INVALID';
  END IF;
  SELECT TO_JSONB(b) INTO STRICT actual FROM public.business_operations b WHERE id=(p->'parent'->'creation'->>'id')::UUID;
  IF actual IS DISTINCT FROM p->'parent'->'creation' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_ANCHOR_INVALID';
  END IF;
  PERFORM phase5_private.derive_customer_completion_writes_v1(TO_JSONB(c));
  link:=phase5_private.derive_customer_completion_child_link_v1(TO_JSONB(c)); child:=link->'context';
  IF child IS DISTINCT FROM 'null'::JSONB THEN
    SELECT TO_JSONB(t) INTO STRICT actual FROM phase5_private.mutation_contexts t WHERE id=(child->>'id')::UUID;
    IF actual IS DISTINCT FROM child THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_CHILD_INVALID';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM phase5_private.mutation_contexts t WHERE
      (t.order_id=c.order_id OR t.locked_plan->>'parentContextId'=c.id::TEXT)
      AND t.id<>c.id AND (child='null'::JSONB OR t.id IS DISTINCT FROM (child->>'id')::UUID)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_CONTEXT_SET_INVALID';
  END IF;
  RETURN TO_JSONB(c);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_PERMIT_INVALID';
END;
$$;

-- Closed relation allowlist, no dynamic SQL or additional row/advisory locks.
CREATE FUNCTION phase5_private.read_customer_completion_source_row_v1(relation_name TEXT, row_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actual JSONB;
BEGIN
  CASE relation_name
    WHEN 'public.inventory_balances' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_balances t WHERE id=row_identity;
    WHEN 'public.order_inventory_reservations' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_inventory_reservations t WHERE id=row_identity;
    WHEN 'public.inventory_movements' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_movements t WHERE id=row_identity;
    WHEN 'public.order_items' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_items t WHERE id=row_identity;
    WHEN 'public.order_parcel_instances' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_parcel_instances t WHERE id=row_identity;
    WHEN 'public.order_parcel_components' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_parcel_components t WHERE id=row_identity;
    WHEN 'public.orders' THEN SELECT TO_JSONB(t) INTO actual FROM public.orders t WHERE id=row_identity;
    WHEN 'public.business_operations' THEN SELECT TO_JSONB(t) INTO actual FROM public.business_operations t WHERE id=row_identity;
    WHEN 'public.order_status_history' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_status_history t WHERE id=row_identity;
    WHEN 'public.audit_logs' THEN SELECT TO_JSONB(t) INTO actual FROM public.audit_logs t WHERE id=row_identity;
    WHEN 'public.customer_payments' THEN SELECT TO_JSONB(t) INTO actual FROM public.customer_payments t WHERE id=row_identity;
    WHEN 'phase5_private.financial_operation_events' THEN SELECT TO_JSONB(t) INTO actual FROM phase5_private.financial_operation_events t WHERE id=row_identity;
    WHEN 'phase5_private.collection_events' THEN SELECT TO_JSONB(t) INTO actual FROM phase5_private.collection_events t WHERE id=row_identity;
    WHEN 'phase5_private.collection_attempt_envelopes' THEN SELECT TO_JSONB(t) INTO actual FROM phase5_private.collection_attempt_envelopes t WHERE financial_operation_id=row_identity;
    ELSE RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_RELATION_UNSUPPORTED';
  END CASE;
  RETURN COALESCE(actual,'null'::JSONB);
END;
$$;

-- Permission ONLY, no business write or progress marker. A caller cannot skip
-- or repeat a step: reconstruct the complete touched-row prefix, including
-- future INSERT absence and repeated shared-SKU/Order transitions, then compare
-- every full live row. Ordinal alone is never authority. Completion is deferred.
CREATE FUNCTION phase5_private.assert_customer_completion_prefix_v1(context_identity UUID, write_ordinal INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; s JSONB; states JSONB:='{}'::JSONB; key TEXT; i INTEGER:=0; state JSONB;
BEGIN
  c:=phase5_private.assert_customer_completion_permit_v1(context_identity);
  writes:=phase5_private.derive_customer_completion_writes_v1(c)->'writes';
  IF write_ordinal IS NULL OR write_ordinal<1 OR write_ordinal>JSONB_ARRAY_LENGTH(writes)+1 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_STEP_INVALID';
  END IF;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(writes) LOOP
    i:=i+1; key:=(s->>'relation')||'|'||(s->>'id');
    IF NOT states ? key THEN
      states:=states||JSONB_BUILD_OBJECT(key,JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id','row',s->'before'));
    END IF;
    IF i<write_ordinal THEN states:=JSONB_SET(states,ARRAY[key,'row'],s->'after'); END IF;
  END LOOP;
  FOR state IN SELECT value FROM JSONB_EACH(states) LOOP
    IF phase5_private.read_customer_completion_source_row_v1(state->>'relation',
      phase5_private.wire_uuid_v1(state->'id')) IS DISTINCT FROM state->'row' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_PREFIX_INVALID';
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;
CREATE FUNCTION phase5_private.assert_customer_completion_source_tuple_v1(
  context_identity UUID, write_ordinal INTEGER, relation_name TEXT, event_name TEXT, old_tuple JSONB, new_tuple JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; step JSONB;
BEGIN
  c:=phase5_private.assert_customer_completion_permit_v1(context_identity);
  writes:=phase5_private.derive_customer_completion_writes_v1(c)->'writes';
  IF write_ordinal IS NULL OR write_ordinal<1 OR write_ordinal>JSONB_ARRAY_LENGTH(writes) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_STEP_INVALID';
  END IF;
  step:=writes->(write_ordinal-1);
  IF relation_name IS DISTINCT FROM step->>'relation' OR event_name IS DISTINCT FROM step->>'action'
    OR COALESCE(old_tuple,'null'::JSONB) IS DISTINCT FROM step->'before' OR new_tuple IS DISTINCT FROM step->'after' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_TUPLE_INVALID';
  END IF;
  RETURN phase5_private.assert_customer_completion_prefix_v1(context_identity,write_ordinal);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_customer_completion_writes_v1(JSONB),
  phase5_private.assert_customer_completion_permit_v1(UUID),
  phase5_private.read_customer_completion_source_row_v1(TEXT,UUID),
  phase5_private.assert_customer_completion_prefix_v1(UUID,INTEGER),
  phase5_private.assert_customer_completion_source_tuple_v1(UUID,INTEGER,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_customer_completion_writes_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_permit_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.read_customer_completion_source_row_v1(TEXT,UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_prefix_v1(UUID,INTEGER) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_customer_completion_source_tuple_v1(UUID,INTEGER,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- INITIAL same-transaction completion ONLY, never historical replay. All
-- source/evidence must exist before127 is consulted. The future replay contract
-- must not require live Order/balance equality after subsequent valid actions.
CREATE FUNCTION phase5_private.complete_customer_completion_context_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; expected JSONB; writes JSONB; position JSONB; actual JSONB;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(auth.uid(),TRUE);
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=c.order_id AND status='completed')
    OR (c.locked_plan->'childReceipt' IS DISTINCT FROM 'null'::JSONB AND NOT EXISTS(
      SELECT 1 FROM phase5_private.collection_attempt_envelopes e
      WHERE e.financial_operation_id=(c.locked_plan->'childReceipt'->'identities'->>'operationId')::UUID)) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_COMPLETION_NOT_PREPARED';
  END IF;
  actual:=phase5_private.assert_customer_completion_permit_v1(context_identity);
  writes:=phase5_private.derive_customer_completion_writes_v1(actual)->'writes';
  PERFORM phase5_private.assert_customer_completion_prefix_v1(context_identity,JSONB_ARRAY_LENGTH(writes)+1);
  PERFORM phase5_private.validate_customer_completion_child_link_v1(context_identity);
  IF EXISTS(SELECT 1 FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id())
    OR EXISTS(SELECT 1 FROM public.phase3_customer_lifecycle_transition_guards WHERE transaction_id=pg_current_xact_id()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COMPLETION_GUARD_LEAK';
  END IF;
  expected:=phase5_private.derive_customer_completion_outcome_v1(actual)->'parentResult';
  position:=phase5_private.read_order_financial_position_v1(c.order_id);
  IF phase5_private.money_v1(position->'collectionCoverageInMinorUnits') IS DISTINCT FROM
      phase5_private.money_v1(expected->'amount_paid_in_minor_units')
    OR phase5_private.money_v1(position->'outstandingTotalInMinorUnits') IS DISTINCT FROM
      phase5_private.money_v1(expected->'remaining_in_minor_units') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COMPLETION_FINANCIAL_INVALID';
  END IF;
  RETURN expected;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_COMPLETION_INCOMPLETE';
END;
$$;

-- Consumes the already held parent plan. No fresh lock/discovery/standalone
-- child RPC and no arbitrary relation/column execution. All116 capabilities
-- are backend rows tied to this full transaction/order/operation; GUCs alone
-- are never authority. Statement/subtransaction rollback restores them on error.
CREATE FUNCTION phase5_private.execute_customer_completion_prelocked_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; s JSONB; row_after JSONB; ordinal INTEGER:=0; affected BIGINT;
  previous_cost TEXT; previous_lifecycle TEXT; order_identity UUID; operation_identity UUID;
BEGIN
  c:=phase5_private.assert_customer_completion_context_v1(context_identity);
  order_identity:=phase5_private.wire_uuid_v1(c->'order_id'); operation_identity:=phase5_private.wire_uuid_v1(c->'operation_id');
  IF EXISTS(SELECT 1 FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id())
    OR EXISTS(SELECT 1 FROM public.phase3_customer_lifecycle_transition_guards WHERE transaction_id=pg_current_xact_id()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_EXECUTION_GUARD_CONFLICT';
  END IF;
  IF c->'locked_plan'->'childReceipt' IS DISTINCT FROM 'null'::JSONB THEN
    PERFORM phase5_private.enter_customer_completion_child_context_v1(context_identity);
  END IF;
  writes:=phase5_private.derive_customer_completion_writes_v1(c)->'writes';
  previous_cost:=CURRENT_SETTING('nawasrah.customer_cost_finalization_operation_id',TRUE);
  previous_lifecycle:=CURRENT_SETTING('nawasrah.customer_lifecycle_operation_id',TRUE);
  INSERT INTO public.phase3_customer_cost_finalization_guards(transaction_id,lifecycle_operation_id,order_id,row_kind,row_id)
    VALUES(pg_current_xact_id(),operation_identity,order_identity,'order',order_identity);
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(c->'locked_plan'->'deltas'->'costSteps') LOOP
    INSERT INTO public.phase3_customer_cost_finalization_guards(transaction_id,lifecycle_operation_id,order_id,row_kind,row_id)
      VALUES(pg_current_xact_id(),operation_identity,order_identity,CASE s->>'relation'
        WHEN 'public.order_items' THEN 'order_item' WHEN 'public.order_parcel_instances' THEN 'parcel_instance'
        ELSE 'parcel_component' END,phase5_private.wire_uuid_v1(s->'id'));
  END LOOP;
  INSERT INTO public.phase3_customer_lifecycle_transition_guards(transaction_id,lifecycle_operation_id,order_id,target_status)
    VALUES(pg_current_xact_id(),operation_identity,order_identity,'completed');
  PERFORM SET_CONFIG('nawasrah.customer_cost_finalization_operation_id',operation_identity::TEXT,TRUE);
  PERFORM SET_CONFIG('nawasrah.customer_lifecycle_operation_id',operation_identity::TEXT,TRUE);
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(writes) LOOP
    ordinal:=ordinal+1; row_after:=s->'after';
    PERFORM phase5_private.assert_customer_completion_source_tuple_v1(context_identity,ordinal,
      s->>'relation',s->>'action',s->'before',row_after);
    CASE s->>'relation'
      WHEN 'public.inventory_balances' THEN
        UPDATE public.inventory_balances SET on_hand_quantity=(row_after->>'on_hand_quantity')::BIGINT,
          reserved_quantity=(row_after->>'reserved_quantity')::BIGINT,updated_at=(row_after->>'updated_at')::TIMESTAMPTZ
          WHERE id=(s->>'id')::UUID;
      WHEN 'public.order_inventory_reservations' THEN
        UPDATE public.order_inventory_reservations SET reservation_state=row_after->>'reservation_state',
          resolved_at=(row_after->>'resolved_at')::TIMESTAMPTZ WHERE id=(s->>'id')::UUID;
      WHEN 'public.inventory_movements' THEN
        INSERT INTO public.inventory_movements SELECT (JSONB_POPULATE_RECORD(NULL::public.inventory_movements,row_after)).*;
      WHEN 'public.order_parcel_components' THEN
        UPDATE public.order_parcel_components SET unit_cost_snapshot_in_minor_units=(row_after->>'unit_cost_snapshot_in_minor_units')::NUMERIC,
          cogs_snapshot_in_minor_units=(row_after->>'cogs_snapshot_in_minor_units')::BIGINT,
          exact_cogs_snapshot_in_minor_units=(row_after->>'exact_cogs_snapshot_in_minor_units')::NUMERIC,
          cost_finalized_at=(row_after->>'cost_finalized_at')::TIMESTAMPTZ WHERE id=(s->>'id')::UUID;
      WHEN 'public.order_parcel_instances' THEN
        UPDATE public.order_parcel_instances SET cogs_snapshot_in_minor_units=(row_after->>'cogs_snapshot_in_minor_units')::BIGINT,
          exact_cogs_snapshot_in_minor_units=(row_after->>'exact_cogs_snapshot_in_minor_units')::NUMERIC,
          cost_finalized_at=(row_after->>'cost_finalized_at')::TIMESTAMPTZ WHERE id=(s->>'id')::UUID;
      WHEN 'public.order_items' THEN
        UPDATE public.order_items SET unit_cost_snapshot_in_minor_units_exact=(row_after->>'unit_cost_snapshot_in_minor_units_exact')::NUMERIC,
          exact_cogs_snapshot_in_minor_units=(row_after->>'exact_cogs_snapshot_in_minor_units')::NUMERIC,
          unit_cost_in_minor_units=(row_after->>'unit_cost_in_minor_units')::BIGINT,
          cogs_in_minor_units=(row_after->>'cogs_in_minor_units')::BIGINT,profit_in_minor_units=(row_after->>'profit_in_minor_units')::BIGINT,
          cost_finalized_at=(row_after->>'cost_finalized_at')::TIMESTAMPTZ WHERE id=(s->>'id')::UUID;
      WHEN 'public.orders' THEN
        UPDATE public.orders SET status=row_after->>'status',delivery_fee_in_minor_units=(row_after->>'delivery_fee_in_minor_units')::BIGINT,
          total_in_minor_units=(row_after->>'total_in_minor_units')::BIGINT,payment_method=row_after->>'payment_method',
          amount_paid_in_minor_units=(row_after->>'amount_paid_in_minor_units')::BIGINT,payment_status=row_after->>'payment_status',
          payment_reference_number=row_after->>'payment_reference_number',payment_confirmed_at=(row_after->>'payment_confirmed_at')::TIMESTAMPTZ,
          payment_confirmed_by=(row_after->>'payment_confirmed_by')::UUID,cash_shift_id=(row_after->>'cash_shift_id')::UUID,
          cost_finalized_at=(row_after->>'cost_finalized_at')::TIMESTAMPTZ,updated_at=(row_after->>'updated_at')::TIMESTAMPTZ
          WHERE id=(s->>'id')::UUID;
      WHEN 'public.business_operations' THEN
        INSERT INTO public.business_operations SELECT (JSONB_POPULATE_RECORD(NULL::public.business_operations,row_after)).*;
      WHEN 'public.order_status_history' THEN
        INSERT INTO public.order_status_history SELECT (JSONB_POPULATE_RECORD(NULL::public.order_status_history,row_after)).*;
      WHEN 'public.audit_logs' THEN
        INSERT INTO public.audit_logs SELECT (JSONB_POPULATE_RECORD(NULL::public.audit_logs,row_after)).*;
      WHEN 'public.customer_payments' THEN
        INSERT INTO public.customer_payments SELECT (JSONB_POPULATE_RECORD(NULL::public.customer_payments,row_after)).*;
      WHEN 'phase5_private.financial_operation_events' THEN
        INSERT INTO phase5_private.financial_operation_events SELECT (JSONB_POPULATE_RECORD(NULL::phase5_private.financial_operation_events,row_after)).*;
      WHEN 'phase5_private.collection_events' THEN
        INSERT INTO phase5_private.collection_events SELECT (JSONB_POPULATE_RECORD(NULL::phase5_private.collection_events,row_after)).*;
      WHEN 'phase5_private.collection_attempt_envelopes' THEN
        INSERT INTO phase5_private.collection_attempt_envelopes SELECT (JSONB_POPULATE_RECORD(NULL::phase5_private.collection_attempt_envelopes,row_after)).*;
      ELSE RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PARENT_SOURCE_RELATION_UNSUPPORTED';
    END CASE;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 OR phase5_private.read_customer_completion_source_row_v1(s->>'relation',(s->>'id')::UUID)
      IS DISTINCT FROM row_after THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_EXECUTION_WRITE_INVALID';
    END IF;
  END LOOP;
  DELETE FROM public.phase3_customer_cost_finalization_guards WHERE transaction_id=pg_current_xact_id()
    AND lifecycle_operation_id=operation_identity;
  DELETE FROM public.phase3_customer_lifecycle_transition_guards WHERE transaction_id=pg_current_xact_id()
    AND lifecycle_operation_id=operation_identity;
  PERFORM SET_CONFIG('nawasrah.customer_cost_finalization_operation_id',COALESCE(previous_cost,''),TRUE);
  PERFORM SET_CONFIG('nawasrah.customer_lifecycle_operation_id',COALESCE(previous_lifecycle,''),TRUE);
  RETURN phase5_private.complete_customer_completion_context_v1(context_identity);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.complete_customer_completion_context_v1(UUID),
  phase5_private.execute_customer_completion_prelocked_v1(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.complete_customer_completion_context_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.execute_customer_completion_prelocked_v1(UUID) OWNER TO postgres;

-- Legacy admission/commercial discovery ONLY. No modern completion reader,
-- evidence adoption, idempotency key, held-lock certificate or source permit.
-- Untouched NULL commercial-line identity is historical112, not permission to
-- strip301/reservation/Parcel/cost evidence and reinterpret a modern Order.
CREATE FUNCTION phase5_private.discover_legacy_completion_plan_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT,
  reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID:=auth.uid(); tender TEXT:=LOWER(NULLIF(BTRIM(method),''));
  require_shift BOOLEAN; o public.orders%ROWTYPE; source_items JSONB;
  source_demand JSONB; shifts JSONB; selected_shift JSONB; request JSONB;
  fee BIGINT; total NUMERIC; collected NUMERIC; remaining NUMERIC;
BEGIN
  --060 is narrower than126's collection role family: accountant is NOT admitted.
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id
    WHERE p.id=actor AND p.is_active AND r.code IN ('owner','admin','manager','sales')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_ACTOR_UNAUTHORIZED';
  END IF;
  IF order_identity IS NULL OR tender IS NULL OR tender NOT IN ('cash','cash_on_delivery','cliq','debt')
    OR delivery<0 OR CHAR_LENGTH(COALESCE(BTRIM(reference),''))>120 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_LEGACY_REQUEST_INVALID';
  END IF;
  -- Capture120's ORIGINAL predicate before trim/alias/zero normalization.
  require_shift:=LOWER(COALESCE(method,'')) NOT IN ('debt','');
  IF tender='cash_on_delivery' THEN tender:='cash'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=order_identity;
  IF o.source IS DISTINCT FROM 'website' OR o.operation_id IS NOT NULL
    OR o.status IS NULL OR o.status NOT IN ('ready','out_for_delivery')
    OR o.branch_id IS NULL OR o.warehouse_id IS NULL OR o.cost_finalized_at IS NOT NULL
    OR o.amount_paid_in_minor_units IS DISTINCT FROM 0
    OR o.subtotal_in_minor_units IS NULL OR o.discount_in_minor_units IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_SOURCE_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE order_id=order_identity)
    OR EXISTS(SELECT 1 FROM public.order_parcel_instances WHERE order_id=order_identity)
    OR EXISTS(SELECT 1 FROM public.business_operations b WHERE b.operation_type LIKE 'phase3_%'
      AND (b.request_identity_snapshot->>'order_id'=order_identity::TEXT
        OR b.result_snapshot->>'order_id'=order_identity::TEXT OR b.result_snapshot->>'orderId'=order_identity::TEXT))
    OR EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=order_identity AND (
      i.commercial_line_kind IS NOT NULL OR i.family_product_id IS NOT NULL
      OR i.parcel_configuration_id IS NOT NULL OR i.parcel_configuration_revision IS NOT NULL
      OR i.cost_finalized_at IS NOT NULL OR i.unit_cost_snapshot_in_minor_units_exact IS NOT NULL
      OR i.exact_cogs_snapshot_in_minor_units IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODERN_EVIDENCE_CONTRADICTION';
  END IF;
  IF EXISTS(SELECT 1 FROM public.customer_payments WHERE order_id=order_identity)
    OR EXISTS(SELECT 1 FROM public.sales_return_events WHERE order_id=order_identity)
    OR EXISTS(SELECT 1 FROM public.sales_replacement_events WHERE root_order_id=order_identity)
    OR EXISTS(SELECT 1 FROM phase5_private.collection_events WHERE order_id=order_identity)
    OR EXISTS(SELECT 1 FROM public.order_status_history WHERE order_id=order_identity AND new_status='completed')
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE reference_id=order_identity
      AND reference_type IN ('order','customer_order')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_PRIOR_EFFECT_UNSUPPORTED';
  END IF;
  SELECT JSONB_AGG(TO_JSONB(i) ORDER BY i.id),
    JSONB_AGG(JSONB_BUILD_OBJECT('itemId',i.id,'productId',i.product_id,'quantity',i.quantity) ORDER BY i.id)
    INTO source_items,source_demand FROM public.order_items i WHERE i.order_id=order_identity;
  IF source_items IS NULL OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=order_identity
    AND (product_id IS NULL OR quantity IS NULL OR quantity<=0)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_ITEMS_INVALID';
  END IF;
  fee:=COALESCE(delivery,o.delivery_fee_in_minor_units,0);
  total:=o.subtotal_in_minor_units::NUMERIC-o.discount_in_minor_units::NUMERIC+fee;
  -- Preserve060: explicit debt ignores the requested collected amount.
  collected:=CASE WHEN tender='debt' THEN 0 ELSE COALESCE(amount::NUMERIC,total) END;
  IF fee<0 OR total<0 OR total>9223372036854775807 OR collected<0 OR collected>total THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_CAPACITY_INVALID';
  END IF;
  IF collected=0 THEN tender:='debt'; END IF;
  IF tender='cliq' AND NULLIF(BTRIM(reference),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_LEGACY_REFERENCE_REQUIRED';
  END IF;
  remaining:=total-collected;
  IF remaining>0 AND o.customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_CUSTOMER_REQUIRED';
  END IF;
  SELECT COALESCE(JSONB_AGG(TO_JSONB(s) ORDER BY s.id),'[]'::JSONB) INTO shifts
    FROM public.cash_shifts s WHERE s.branch_id=o.branch_id AND s.status='open';
  IF JSONB_ARRAY_LENGTH(shifts)>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_SHIFT_IDENTITY_AMBIGUOUS';
  END IF;
  selected_shift:=shifts->0;
  IF (require_shift OR collected>0) AND selected_shift IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE4_OPEN_SHIFT_REQUIRED';
  END IF;
  request:=JSONB_BUILD_OBJECT('requestVersion','phase5-legacy-website-discovery-v1','actorId',actor,
    'orderId',order_identity,'originalMethod',method,'requestedAmountInMinorUnits',amount,
    'requestedDeliveryInMinorUnits',delivery,'reference',NULLIF(BTRIM(reference),''),'notes',NULLIF(BTRIM(notes),''));
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-legacy-website-discovery-v1',
    'planState','LEGACY_COMMERCIAL_DISCOVERY_ONLY','locksHeld',FALSE,'executionAuthority',FALSE,
    'actorId',actor,'orderId',order_identity,'request',request,
    'requestFingerprint',UPPER(public.phase3_request_fingerprint_internal(request)),
    'originalMethodRequiresShift',require_shift,'sourceOrder',TO_JSONB(o),
    'sourceItems',source_items,'sourceDemand',source_demand,'selectedShift',selected_shift,
    'settlement',JSONB_BUILD_OBJECT('totalInMinorUnits',total::BIGINT,'collectedInMinorUnits',collected::BIGINT,
      'remainingInMinorUnits',remaining::BIGINT,'collectionMethod',tender,
      'receiptRequired',collected>0 AND remaining>0));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_SOURCE_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_legacy_completion_plan_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_legacy_completion_plan_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_completion_plan_unchanged_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT,
  reference TEXT, notes TEXT, discovered JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF discovered IS DISTINCT FROM phase5_private.discover_legacy_completion_plan_v1(
    order_identity,method,amount,delivery,reference,notes) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_DISCOVERY_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_plan_unchanged_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_plan_unchanged_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Freeze the Legacy nested completion/FK footprint before taking any lock.
-- Uses the SAME root, Shift and global SKU domains/ranks as Customer completion.
-- Auth content is never captured; only its referenced identity is retained.
CREATE FUNCTION phase5_private.discover_legacy_completion_resources_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE commercial JSONB; products UUID[]; nodes JSONB; resources JSONB; source_order JSONB; shift_row JSONB;
BEGIN
  commercial:=phase5_private.discover_legacy_completion_plan_v1(order_identity,method,amount,delivery,reference,notes);
  source_order:=commercial->'sourceOrder'; shift_row:=commercial->'selectedShift';
  SELECT ARRAY_AGG(DISTINCT (s->>'productId')::UUID ORDER BY (s->>'productId')::UUID)
    INTO products FROM JSONB_ARRAY_ELEMENTS(commercial->'sourceDemand') s;
  --004 deducts stock quantities, not sale-package counts; repeated historical
  -- product lines are retained individually in sourceDemand. No cost revaluation.
  IF EXISTS(SELECT 1 FROM (
    SELECT (s->>'productId')::UUID product_id,SUM((s->>'quantity')::NUMERIC) quantity
      FROM JSONB_ARRAY_ELEMENTS(commercial->'sourceDemand') s GROUP BY s->>'productId'
    ) d LEFT JOIN public.inventory_balances b ON b.product_id=d.product_id
      AND b.warehouse_id=(source_order->>'warehouse_id')::UUID
    LEFT JOIN public.products p ON p.id=d.product_id
    WHERE b.id IS NULL OR p.id IS NULL OR b.on_hand_quantity<d.quantity) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_INVENTORY_INVALID';
  END IF;
  WITH profile_ids AS (
    SELECT (commercial->>'actorId')::UUID id
    UNION SELECT (source_order->>'payment_confirmed_by')::UUID
    UNION SELECT (shift_row->>'opened_by')::UUID
    UNION SELECT (shift_row->>'closed_by')::UUID
    UNION SELECT s.opened_by FROM public.cash_shifts s WHERE s.id=(source_order->>'cash_shift_id')::UUID
    UNION SELECT s.closed_by FROM public.cash_shifts s WHERE s.id=(source_order->>'cash_shift_id')::UUID
    UNION SELECT h.changed_by FROM public.order_status_history h WHERE h.order_id=order_identity
    UNION SELECT a.user_id FROM public.audit_logs a WHERE a.entity_name='orders' AND a.entity_id=order_identity
  ), discovered AS (
    SELECT 'public.orders' relation,order_identity::TEXT id,source_order row_data,'UPDATE' mode,5 rank
    UNION ALL SELECT 'public.cash_shifts',s.id::TEXT,TO_JSONB(s),'UPDATE',4
      FROM public.cash_shifts s WHERE s.id=(shift_row->>'id')::UUID OR s.id=(source_order->>'cash_shift_id')::UUID
    --113/114 lock all warehouse balances for these products, then products.
    UNION ALL SELECT 'public.inventory_balances',b.id::TEXT,TO_JSONB(b),'UPDATE',5
      FROM public.inventory_balances b WHERE b.product_id=ANY(products)
    UNION ALL SELECT 'public.products',p.id::TEXT,TO_JSONB(p),'NO_KEY_UPDATE',5
      FROM public.products p WHERE p.id=ANY(products)
    UNION ALL SELECT 'public.order_items',i.id::TEXT,TO_JSONB(i),'UPDATE',6
      FROM public.order_items i WHERE i.order_id=order_identity
    UNION ALL SELECT 'public.order_status_history',h.id::TEXT,TO_JSONB(h),'SHARE',6
      FROM public.order_status_history h WHERE h.order_id=order_identity
    UNION ALL SELECT 'public.audit_logs',a.id::TEXT,TO_JSONB(a),'SHARE',6
      FROM public.audit_logs a WHERE a.entity_name='orders' AND a.entity_id=order_identity
    UNION ALL SELECT 'public.branches',b.id::TEXT,TO_JSONB(b),'SHARE',7
      FROM public.branches b WHERE b.id=(source_order->>'branch_id')::UUID
    UNION ALL SELECT 'public.customers',c.id::TEXT,TO_JSONB(c),'SHARE',7
      FROM public.customers c WHERE c.id=(source_order->>'customer_id')::UUID
    UNION ALL SELECT 'public.customer_addresses',a.id::TEXT,TO_JSONB(a),'SHARE',7
      FROM public.customer_addresses a WHERE a.id=(source_order->>'customer_address_id')::UUID
    UNION ALL SELECT 'public.promotion_codes',p.id::TEXT,TO_JSONB(p),'SHARE',7
      FROM public.promotion_codes p WHERE p.id=(source_order->>'promotion_code_id')::UUID
    UNION ALL SELECT 'public.warehouses',w.id::TEXT,TO_JSONB(w),'SHARE',7
      FROM public.warehouses w WHERE w.id=(source_order->>'warehouse_id')::UUID
        OR EXISTS(SELECT 1 FROM public.inventory_balances b WHERE b.product_id=ANY(products) AND b.warehouse_id=w.id)
    UNION ALL SELECT 'public.profiles',p.id::TEXT,TO_JSONB(p),'SHARE',7
      FROM public.profiles p WHERE p.id IN (SELECT id FROM profile_ids)
    UNION ALL SELECT 'auth.users',u.id::TEXT,JSONB_BUILD_OBJECT('id',u.id),'KEY_SHARE',7
      FROM auth.users u WHERE u.id IN (SELECT id FROM profile_ids)
    UNION ALL SELECT 'public.roles',r.id::TEXT,TO_JSONB(r),'SHARE',7
      FROM public.roles r JOIN public.user_roles ur ON ur.role_id=r.id WHERE ur.user_id=(commercial->>'actorId')::UUID
    UNION ALL SELECT 'public.user_roles',ur.user_id::TEXT||':'||ur.role_id::TEXT,TO_JSONB(ur),'SHARE',7
      FROM public.user_roles ur WHERE ur.user_id=(commercial->>'actorId')::UUID
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',id,'row',row_data,'mode',mode,'rank',rank)
    ORDER BY rank,CASE relation WHEN 'public.orders' THEN 0 WHEN 'public.inventory_balances' THEN 1
      WHEN 'public.products' THEN 2 ELSE 3 END,relation COLLATE "C",
      CASE WHEN relation='public.inventory_balances' THEN row_data->>'product_id' ELSE id END COLLATE "C",
      CASE WHEN relation='public.inventory_balances' THEN row_data->>'warehouse_id' ELSE id END COLLATE "C")
    INTO nodes FROM discovered;
  SELECT JSONB_AGG(n ORDER BY ordinal) INTO resources
    FROM JSONB_ARRAY_ELEMENTS(nodes) WITH ORDINALITY r(n,ordinal);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-legacy-completion-resources-v1',
    'planState','LEGACY_RESOURCES_DISCOVERED_ONLY','locksHeld',FALSE,'executionAuthority',FALSE,
    'commercial',commercial,'rootGates',JSONB_BUILD_ARRAY('phase4-order|'||order_identity::TEXT),
    'sharedGates',(SELECT COALESCE(JSONB_AGG('cash-shift-full-reversal:'||(n->>'id') ORDER BY n->>'id'),'[]'::JSONB)
      FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE n->>'relation'='public.cash_shifts'),
    'inventoryGates',(SELECT JSONB_AGG('inventory-product:'||p::TEXT ORDER BY p) FROM UNNEST(products) p),
    'resources',resources);
END;
$$;

CREATE FUNCTION phase5_private.assert_legacy_completion_resources_unchanged_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT, reference TEXT, notes TEXT, expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_legacy_completion_resources_v1(
    order_identity,method,amount,delivery,reference,notes) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_RESOURCES_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;

-- Acquisition ONLY. No context, receipt, source DML or executor is admitted.
-- Narrow060 authorization/source discovery precedes the common generation
-- fence; the broader shared fence cannot expand this caller's role contract.
CREATE FUNCTION phase5_private.lock_legacy_completion_plan_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; n JSONB; gate TEXT; identity UUID;
BEGIN
  plan:=phase5_private.discover_legacy_completion_resources_v1(order_identity,method,amount,delivery,reference,notes);
  IF EXISTS(SELECT 1 FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation
    LEFT JOIN pg_index index_parent ON index_parent.indexrelid=c.oid
    LEFT JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted
      AND (l.locktype='advisory' OR (ns.nspname IN ('public','auth','phase5_private')
        AND l.mode<>'AccessShareLock' AND COALESCE(index_parent.indrelid,c.oid) NOT IN
          ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS)))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_LATE_ENTRY_RETRY';
  END IF;
  PERFORM phase5_private.lock_customer_completion_generation_v1();
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'rootGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0));
  END LOOP;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'sharedGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0));
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WHERE (value->>'rank')::INT=4 LOOP
    PERFORM 1 FROM public.cash_shifts WHERE id=(n->>'id')::UUID FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  PERFORM 1 FROM public.orders WHERE id=order_identity FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_LOCK_PLAN_CHANGED'; END IF;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'inventoryGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0));
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal)
    WHERE (value->>'rank')::INT>=5 ORDER BY ordinal LOOP
    IF n->>'relation'='public.user_roles' THEN
      PERFORM 1 FROM public.user_roles WHERE user_id=(n->'row'->>'user_id')::UUID
        AND role_id=(n->'row'->>'role_id')::UUID FOR SHARE NOWAIT;
    ELSE
      identity:=phase5_private.wire_uuid_v1(n->'id');
      CASE n->>'relation'
        WHEN 'public.orders' THEN CONTINUE;
        WHEN 'public.inventory_balances' THEN PERFORM 1 FROM public.inventory_balances WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.products' THEN PERFORM 1 FROM public.products WHERE id=identity FOR NO KEY UPDATE NOWAIT;
        WHEN 'public.order_items' THEN PERFORM 1 FROM public.order_items WHERE id=identity FOR UPDATE NOWAIT;
        WHEN 'public.order_status_history' THEN PERFORM 1 FROM public.order_status_history WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.audit_logs' THEN PERFORM 1 FROM public.audit_logs WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'auth.users' THEN PERFORM 1 FROM auth.users WHERE id=identity FOR KEY SHARE NOWAIT;
        WHEN 'public.branches' THEN PERFORM 1 FROM public.branches WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.customers' THEN PERFORM 1 FROM public.customers WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.customer_addresses' THEN PERFORM 1 FROM public.customer_addresses WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.promotion_codes' THEN PERFORM 1 FROM public.promotion_codes WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.warehouses' THEN PERFORM 1 FROM public.warehouses WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.profiles' THEN PERFORM 1 FROM public.profiles WHERE id=identity FOR SHARE NOWAIT;
        WHEN 'public.roles' THEN PERFORM 1 FROM public.roles WHERE id=identity FOR SHARE NOWAIT;
        ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_LOCK_PLAN_INVALID';
      END CASE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_LOCK_PLAN_CHANGED'; END IF;
  END LOOP;
  PERFORM phase5_private.assert_legacy_completion_resources_unchanged_v1(
    order_identity,method,amount,delivery,reference,notes,plan);
  RETURN plan||JSONB_BUILD_OBJECT('planState','LEGACY_RESOURCES_LOCKED_ONLY','locksHeld',TRUE);
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_CONTENTION_RETRY';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_legacy_completion_resources_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  phase5_private.assert_legacy_completion_resources_unchanged_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB),
  phase5_private.lock_legacy_completion_plan_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_legacy_completion_resources_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_legacy_completion_resources_unchanged_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.lock_legacy_completion_plan_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;

-- Frozen historical expectations only.004 has no item ORDER BY, so preserve
-- per-item multiplicity without inventing a durable modern item/operation FK
-- or asserting a guessed execution order. Balance endpoints are commutative;
-- the future executor/proof must additionally verify the actual movement chain.
CREATE FUNCTION phase5_private.derive_legacy_completion_model_v1(plan JSONB, event_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB:=plan->'commercial'; o JSONB:=c->'sourceOrder'; r JSONB:=c->'request';
  line JSONB; balance JSONB; demand JSONB:='[]'::JSONB; endpoints JSONB:='[]'::JSONB;
  setup JSONB; completed JSONB; total NUMERIC; collected NUMERIC; remaining NUMERIC;
  fee BIGINT; tender TEXT; qty NUMERIC; notes TEXT; grouped RECORD;
BEGIN
  IF event_at IS NULL OR plan->>'planVersion' IS DISTINCT FROM 'phase5-legacy-completion-resources-v1'
    OR plan->>'planState' IS DISTINCT FROM 'LEGACY_RESOURCES_LOCKED_ONLY'
    OR plan->'locksHeld' IS DISTINCT FROM 'true'::JSONB
    OR plan->'executionAuthority' IS DISTINCT FROM 'false'::JSONB
    OR JSONB_TYPEOF(c->'sourceItems') IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(c->'sourceItems')=0
    OR o->>'id' IS DISTINCT FROM c->>'orderId' OR r->>'actorId' IS DISTINCT FROM c->>'actorId'
    OR r->>'orderId' IS DISTINCT FROM c->>'orderId' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
  END IF;
  fee:=COALESCE((r->>'requestedDeliveryInMinorUnits')::BIGINT,(o->>'delivery_fee_in_minor_units')::BIGINT,0);
  total:=(o->>'subtotal_in_minor_units')::NUMERIC-(o->>'discount_in_minor_units')::NUMERIC+fee;
  tender:=LOWER(NULLIF(BTRIM(r->>'originalMethod'),''));
  IF tender='cash_on_delivery' THEN tender:='cash'; END IF;
  collected:=CASE WHEN tender='debt' THEN 0 ELSE COALESCE((r->>'requestedAmountInMinorUnits')::NUMERIC,total) END;
  remaining:=total-collected;
  IF tender IS NULL OR tender NOT IN ('cash','cliq','debt') OR fee<0 OR total IS NULL
    OR total<0 OR total>9223372036854775807 OR collected IS NULL OR collected<0 OR remaining<0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
  END IF;
  IF collected=0 THEN tender:='debt'; END IF;
  IF c->'settlement' IS DISTINCT FROM JSONB_BUILD_OBJECT('totalInMinorUnits',total::BIGINT,
    'collectedInMinorUnits',collected::BIGINT,'remainingInMinorUnits',remaining::BIGINT,
    'collectionMethod',tender,'receiptRequired',collected>0 AND remaining>0) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
  END IF;
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(c->'sourceItems') ORDER BY value->>'id' LOOP
    qty:=(line->>'quantity')::NUMERIC;
    IF line->>'order_id' IS DISTINCT FROM c->>'orderId' OR qty IS NULL OR qty<=0
      OR line->>'product_id' IS NULL OR line->>'id' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
    END IF;
    demand:=demand||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('itemId',line->'id',
      'movementTuple',JSONB_BUILD_OBJECT('warehouse_id',o->'warehouse_id','product_id',line->'product_id',
        'movement_type','sales_deduction','quantity',-qty,'reference_type','order','reference_id',c->'orderId',
        'created_by',c->'actorId','notes','خصم مبيعات نهائي للطلب رقم '||(o->>'order_number'),'created_at',event_at)));
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(c->'sourceItems') s GROUP BY s->>'id' HAVING COUNT(*)<>1)
    OR c->'sourceDemand' IS DISTINCT FROM (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('itemId',s->'id',
      'productId',s->'product_id','quantity',s->'quantity') ORDER BY s->>'id') FROM JSONB_ARRAY_ELEMENTS(c->'sourceItems') s) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
  END IF;
  FOR grouped IN SELECT s->>'product_id' product_id,SUM((s->>'quantity')::NUMERIC) quantity
    FROM JSONB_ARRAY_ELEMENTS(c->'sourceItems') s GROUP BY s->>'product_id' ORDER BY s->>'product_id' LOOP
    SELECT n->'row' INTO STRICT balance FROM JSONB_ARRAY_ELEMENTS(plan->'resources') n
      WHERE n->>'relation'='public.inventory_balances' AND n->'row'->>'product_id'=grouped.product_id
        AND n->'row'->>'warehouse_id'=o->>'warehouse_id';
    IF (balance->>'on_hand_quantity')::NUMERIC<grouped.quantity THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
    END IF;
    endpoints:=endpoints||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('balanceId',balance->'id','before',balance,
      'after',balance||JSONB_BUILD_OBJECT('on_hand_quantity',(balance->>'on_hand_quantity')::NUMERIC-grouped.quantity,
        'reserved_quantity',CASE WHEN (balance->>'reserved_quantity')::NUMERIC>grouped.quantity
          THEN (balance->>'reserved_quantity')::NUMERIC-grouped.quantity ELSE 0 END,'updated_at',event_at)));
  END LOOP;
  -- Retain060 +043 setup/projection and058 completion timestamp semantics.
  setup:=o||JSONB_BUILD_OBJECT('delivery_fee_in_minor_units',fee,'total_in_minor_units',total::BIGINT,
    'payment_method',CASE WHEN remaining>0 THEN 'debt' WHEN tender='cash' THEN 'cash_on_delivery' ELSE 'cliq' END,
    'amount_paid_in_minor_units',0,'payment_status',CASE WHEN total=0 THEN 'paid' ELSE 'unpaid' END,
    'payment_reference_number',CASE WHEN tender='cliq' THEN r->'reference' ELSE 'null'::JSONB END,
    'payment_confirmed_at',CASE WHEN collected>0 THEN TO_JSONB(event_at) ELSE 'null'::JSONB END,
    'payment_confirmed_by',CASE WHEN collected>0 THEN c->'actorId' ELSE 'null'::JSONB END,
    'cash_shift_id',c->'selectedShift'->'id','updated_at',event_at);
  completed:=setup||JSONB_BUILD_OBJECT('status','completed',
    'amount_paid_in_minor_units',CASE WHEN remaining=0 THEN total::BIGINT ELSE 0 END,
    'payment_status',CASE WHEN remaining=0 THEN 'paid' ELSE 'unpaid' END,
    'delivery_completed_at',CASE WHEN o->'delivery_completed_at'='null'::JSONB THEN TO_JSONB(event_at) ELSE o->'delivery_completed_at' END);
  notes:=COALESCE(r->>'notes',CASE WHEN remaining=0 THEN 'تم التسليم وقبض كامل المبلغ'
    WHEN collected=0 THEN 'تم التسليم وكامل المبلغ على حساب العميل' ELSE 'تم التسليم وتسجيل دفعة جزئية والباقي ذمة' END);
  RETURN JSONB_BUILD_OBJECT('modelVersion','phase5-legacy-prewrite-model-v1','executionAuthority',FALSE,
    'inventoryDemand',demand,'balanceEndpoints',endpoints,'orderSetup',setup,'orderCompletedBeforeReceipt',completed,
    'orderFinal',completed||JSONB_BUILD_OBJECT('amount_paid_in_minor_units',collected::BIGINT,
      'payment_status',CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END),
    'historyTuple',JSONB_BUILD_OBJECT('order_id',c->'orderId','old_status',o->'status','new_status','completed',
      'changed_by',c->'actorId','notes',notes,'created_at',event_at),
    'receiptTuple',CASE WHEN collected>0 AND remaining>0 THEN JSONB_BUILD_OBJECT('customer_id',o->'customer_id',
      'order_id',c->'orderId','amount_in_minor_units',collected::BIGINT,'payment_method',tender,
      'reference_number',r->'reference','notes',COALESCE(r->>'notes','دفعة مستلمة عند تسليم الطلب'),
      'created_by',c->'actorId','cash_shift_id',c->'selectedShift'->'id','created_at',event_at,
      'idempotency_key',NULL,'is_reversed',FALSE) ELSE 'null'::JSONB END,
    'financial',c->'settlement');
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION OR NUMERIC_VALUE_OUT_OF_RANGE THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_MODEL_INVALID';
END;
$$;

CREATE FUNCTION phase5_private.enter_legacy_completion_context_v1(
  order_identity UUID, method TEXT, amount BIGINT, delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; model JSONB; frozen JSONB; n JSONB; context_identity UUID:=gen_random_uuid();
  event_at TIMESTAMPTZ; movements JSONB:='{}'::JSONB; sequences JSONB:='{}'::JSONB; receipt JSONB:='null'::JSONB;
BEGIN
  plan:=phase5_private.lock_legacy_completion_plan_v1(order_identity,method,amount,delivery,reference,notes);
  IF EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE order_id=order_identity) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_CONTEXT_ALREADY_EXISTS';
  END IF;
  event_at:=transaction_timestamp();
  model:=phase5_private.derive_legacy_completion_model_v1(plan,event_at);
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(model->'inventoryDemand') LOOP
    movements:=movements||JSONB_BUILD_OBJECT(n->>'itemId',gen_random_uuid());
    sequences:=sequences||JSONB_BUILD_OBJECT(n->>'itemId',NEXTVAL('public.inventory_movement_mutation_seq'));
  END LOOP;
  IF model->'receiptTuple'<>'null'::JSONB THEN
    receipt:=JSONB_BUILD_OBJECT('paymentId',gen_random_uuid(),'auditId',gen_random_uuid(),
      'paymentNumber','CRV-'||TO_CHAR(event_at,'YYYYMMDD')||'-'||LPAD(NEXTVAL('public.customer_payment_number_seq')::TEXT,6,'0'));
  END IF;
  frozen:=JSONB_BUILD_OBJECT('planVersion','phase5-legacy-context-v1','planState','LOCKED_LEGACY_PREWRITE_CONTEXT_ONLY',
    'invocationId',context_identity,'sourcePlan',plan,'eventAt',TO_CHAR(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'eventTimeZone',CURRENT_SETTING('TimeZone'),'movementIds',movements,'movementSequences',sequences,
    'historyId',gen_random_uuid(),'completionAuditId',gen_random_uuid(),'settlementAuditId',gen_random_uuid(),
    'receipt',receipt,'model',model);
  INSERT INTO phase5_private.mutation_contexts(id,transaction_id,generation,actor_id,order_id,purpose,
    operation_id,normalized_request,request_fingerprint,locked_plan)
    VALUES(context_identity,txid_current(),1,auth.uid(),order_identity,'LEGACY_WEBSITE_COMPLETION',NULL,
      plan->'commercial'->'request',plan->'commercial'->>'requestFingerprint',frozen);
  RETURN context_identity;
END;
$$;

-- Frozen permission identity only. Usable between explicitly modeled writes,
-- never a fresh discovery after mutation or a successful completion/replay.
-- VOLATILE because pg_locks exposes live ownership, not an MVCC-stable view.
-- Volatility does not grant DML/lock acquisition; callers retain this property.
CREATE FUNCTION phase5_private.assert_legacy_completion_permit_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c phase5_private.mutation_contexts%ROWTYPE; p JSONB; r JSONB; event_at TIMESTAMPTZ;
  actor UUID:=auth.uid(); field TEXT; identity UUID; gate TEXT; gate_hash BIGINT;
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles pr JOIN public.user_roles ur ON ur.user_id=pr.id
    JOIN public.roles ro ON ro.id=ur.role_id WHERE pr.id=actor AND pr.is_active AND ro.code IN ('owner','admin','manager','sales')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_ACTOR_UNAUTHORIZED';
  END IF;
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts WHERE id=context_identity;
  p:=c.locked_plan->'sourcePlan'; r:=c.normalized_request;
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan,ARRAY['planVersion','planState','invocationId','sourcePlan','eventAt',
    'eventTimeZone','movementIds','movementSequences','historyId','completionAuditId','settlementAuditId','receipt','model']);
  IF c.transaction_id IS DISTINCT FROM txid_current() OR c.actor_id IS DISTINCT FROM actor
    OR c.generation IS DISTINCT FROM 1 OR c.purpose IS DISTINCT FROM 'LEGACY_WEBSITE_COMPLETION' OR c.operation_id IS NOT NULL
    OR c.locked_plan->>'planVersion' IS DISTINCT FROM 'phase5-legacy-context-v1'
    OR c.locked_plan->>'planState' IS DISTINCT FROM 'LOCKED_LEGACY_PREWRITE_CONTEXT_ONLY'
    OR c.locked_plan->>'invocationId' IS DISTINCT FROM c.id::TEXT
    OR p->'commercial'->>'actorId' IS DISTINCT FROM actor::TEXT OR p->'commercial'->>'orderId' IS DISTINCT FROM c.order_id::TEXT
    OR p->'commercial'->'request' IS DISTINCT FROM r OR p->'commercial'->>'requestFingerprint' IS DISTINCT FROM c.request_fingerprint
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r))
    OR c.locked_plan->>'eventTimeZone' IS DISTINCT FROM CURRENT_SETTING('TimeZone')
    OR NOT EXISTS(SELECT 1 FROM phase5_private.authority_generation g JOIN phase5_private.activation_receipts a
      ON a.generation=g.generation AND a.manifest_sha256=g.manifest_sha256 WHERE g.singleton AND g.generation=1
      AND g.authority_state='ACTIVE' AND g.manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099')
    OR (SELECT COUNT(*) FROM phase5_private.mutation_contexts WHERE order_id=c.order_id)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
  END IF;
  IF c.locked_plan->>'eventAt' IS NULL OR c.locked_plan->>'eventAt' !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
  END IF;
  event_at:=(c.locked_plan->>'eventAt')::TIMESTAMPTZ;
  IF event_at IS DISTINCT FROM transaction_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
  END IF;
  IF c.locked_plan->'model' IS DISTINCT FROM phase5_private.derive_legacy_completion_model_v1(p,event_at) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_CONTEXT_CHANGED_RETRY';
  END IF;
  -- Verify the actual shared transaction gates, not merely locksHeld JSON.
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT((p->'rootGates')||(p->'sharedGates')||(p->'inventoryGates')) LOOP
    gate_hash:=hashtextextended(gate,0);
    IF NOT EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=pg_backend_pid() AND l.locktype='advisory'
      AND l.granted AND l.mode='ExclusiveLock' AND l.objsubid=1
      AND l.classid::BIGINT=((gate_hash>>32)&4294967295) AND l.objid::BIGINT=(gate_hash&4294967295)) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_LOCK_MISSING';
    END IF;
  END LOOP;
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementIds',
    ARRAY(SELECT value->>'itemId' FROM JSONB_ARRAY_ELEMENTS(c.locked_plan->'model'->'inventoryDemand')));
  PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'movementSequences',
    ARRAY(SELECT value->>'itemId' FROM JSONB_ARRAY_ELEMENTS(c.locked_plan->'model'->'inventoryDemand')));
  IF EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') s
      WHERE JSONB_TYPEOF(s.value) IS DISTINCT FROM 'number' OR s.value::TEXT !~ '^[1-9][0-9]*$' OR (s.value::TEXT)::BIGINT<=0)
    OR EXISTS(SELECT 1 FROM JSONB_EACH(c.locked_plan->'movementSequences') GROUP BY value HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_SEQUENCE_INVALID';
  END IF;
  IF c.locked_plan->'model'->'receiptTuple'='null'::JSONB THEN
    IF c.locked_plan->'receipt' IS DISTINCT FROM 'null'::JSONB THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
    END IF;
  ELSE
    PERFORM phase5_private.assert_wire_keys_v1(c.locked_plan->'receipt',ARRAY['paymentId','auditId','paymentNumber']);
    IF c.locked_plan->'receipt'->>'paymentNumber' IS NULL OR c.locked_plan->'receipt'->>'paymentNumber' !~
      ('^CRV-'||TO_CHAR(event_at,'YYYYMMDD')||'-[0-9]{6,}$') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
    END IF;
  END IF;
  FOR field IN SELECT id FROM (
    SELECT value id FROM JSONB_EACH_TEXT(c.locked_plan->'movementIds')
    UNION ALL SELECT c.locked_plan->>'historyId' UNION ALL SELECT c.locked_plan->>'completionAuditId'
    UNION ALL SELECT c.locked_plan->>'settlementAuditId'
    UNION ALL SELECT c.locked_plan->'receipt'->>'paymentId' WHERE c.locked_plan->'receipt'<>'null'::JSONB
    UNION ALL SELECT c.locked_plan->'receipt'->>'auditId' WHERE c.locked_plan->'receipt'<>'null'::JSONB
  ) identities LOOP
    identity:=phase5_private.wire_uuid_v1(TO_JSONB(field));
    IF identity=c.id THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_IDENTITY_ALREADY_USED';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM (
    SELECT value id FROM JSONB_EACH_TEXT(c.locked_plan->'movementIds')
    UNION ALL SELECT c.locked_plan->>'historyId' UNION ALL SELECT c.locked_plan->>'completionAuditId'
    UNION ALL SELECT c.locked_plan->>'settlementAuditId'
    UNION ALL SELECT c.locked_plan->'receipt'->>'paymentId' WHERE c.locked_plan->'receipt'<>'null'::JSONB
    UNION ALL SELECT c.locked_plan->'receipt'->>'auditId' WHERE c.locked_plan->'receipt'<>'null'::JSONB
  ) ids GROUP BY id HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_IDENTITY_DUPLICATE';
  END IF;
  RETURN TO_JSONB(c);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION OR NUMERIC_VALUE_OUT_OF_RANGE
  OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
END;
$$;

-- Initial proof retains fresh resource membership/content and generated-ID
-- absence. Stage permission does NOT relax or replace this prewrite boundary.
CREATE FUNCTION phase5_private.assert_legacy_completion_context_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; p JSONB; r JSONB; fresh JSONB; identity UUID; field TEXT;
BEGIN
  c:=phase5_private.assert_legacy_completion_permit_v1(context_identity);
  p:=c->'locked_plan'->'sourcePlan'; r:=c->'normalized_request';
  fresh:=phase5_private.discover_legacy_completion_resources_v1((c->>'order_id')::UUID,r->>'originalMethod',
    (r->>'requestedAmountInMinorUnits')::BIGINT,(r->>'requestedDeliveryInMinorUnits')::BIGINT,r->>'reference',r->>'notes');
  IF fresh IS DISTINCT FROM (p||JSONB_BUILD_OBJECT('planState','LEGACY_RESOURCES_DISCOVERED_ONLY','locksHeld',FALSE)) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_LEGACY_CONTEXT_CHANGED_RETRY';
  END IF;
  IF EXISTS(SELECT 1 FROM public.customer_payments WHERE payment_number=c->'locked_plan'->'receipt'->>'paymentNumber') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_CONTEXT_INVALID';
  END IF;
  FOR field IN SELECT id FROM (
    SELECT value id FROM JSONB_EACH_TEXT(c->'locked_plan'->'movementIds')
    UNION ALL SELECT c->'locked_plan'->>'historyId' UNION ALL SELECT c->'locked_plan'->>'completionAuditId'
    UNION ALL SELECT c->'locked_plan'->>'settlementAuditId'
    UNION ALL SELECT c->'locked_plan'->'receipt'->>'paymentId' WHERE c->'locked_plan'->'receipt'<>'null'::JSONB
    UNION ALL SELECT c->'locked_plan'->'receipt'->>'auditId' WHERE c->'locked_plan'->'receipt'<>'null'::JSONB
  ) identities LOOP
    identity:=phase5_private.wire_uuid_v1(TO_JSONB(field));
    IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=identity)
      OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=identity)
      OR EXISTS(SELECT 1 FROM public.order_status_history WHERE id=identity)
      OR EXISTS(SELECT 1 FROM public.customer_payments WHERE id=identity) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_IDENTITY_ALREADY_USED';
    END IF;
  END LOOP;
  RETURN c;
END;
$$;

-- A complete frozen source set is required even at deferred COMMIT. This is
-- transaction-bound INITIAL completion, never historical same-key replay.
CREATE FUNCTION phase5_private.complete_legacy_completion_context_v1(context_identity UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM phase5_private.assert_legacy_completion_permit_v1(context_identity);
  BEGIN
    PERFORM phase5_private.assert_legacy_completion_payment_v1(context_identity);
  EXCEPTION WHEN INSUFFICIENT_PRIVILEGE THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_LEGACY_COMPLETION_INCOMPLETE';
  END;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_legacy_completion_model_v1(JSONB,TIMESTAMPTZ),
  phase5_private.enter_legacy_completion_context_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  phase5_private.assert_legacy_completion_permit_v1(UUID),
  phase5_private.assert_legacy_completion_context_v1(UUID),phase5_private.complete_legacy_completion_context_v1(UUID)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_legacy_completion_model_v1(JSONB,TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION phase5_private.enter_legacy_completion_context_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_legacy_completion_permit_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_legacy_completion_context_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.complete_legacy_completion_context_v1(UUID) OWNER TO postgres;

-- Exact private staged expectations, NOT an executor.004 does not prescribe
-- item order: choose the frozen item-ID order for this future private path,
-- retaining one movement per historical item and its actual balance chain.
-- No modern financial event/envelope/business operation is fabricated.
CREATE FUNCTION phase5_private.derive_legacy_completion_writes_v1(c JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE f JSONB:=c->'locked_plan'; p JSONB:=f->'sourcePlan'; m JSONB:=f->'model';
  commercial JSONB:=p->'commercial'; s JSONB; b JSONB; a JSONB; movement JSONB;
  history JSONB; audit JSONB; payment JSONB; writes JSONB:='[]'::JSONB; balances JSONB:='{}'::JSONB;
  event_at TIMESTAMPTZ:=(f->>'eventAt')::TIMESTAMPTZ; qty NUMERIC; key TEXT;
BEGIN
  IF m IS DISTINCT FROM phase5_private.derive_legacy_completion_model_v1(p,event_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_WRITE_MODEL_INVALID';
  END IF;
  writes:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.orders','action','UPDATE','id',c->'order_id',
    'before',commercial->'sourceOrder','after',m->'orderSetup'));
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(m->'balanceEndpoints') LOOP
    balances:=balances||JSONB_BUILD_OBJECT(s->>'balanceId',s->'before');
  END LOOP;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(m->'inventoryDemand') ORDER BY value->>'itemId' COLLATE "C" LOOP
    SELECT e->>'balanceId' INTO STRICT key FROM JSONB_ARRAY_ELEMENTS(m->'balanceEndpoints') e
      WHERE e->'before'->'product_id'=s->'movementTuple'->'product_id'
        AND e->'before'->'warehouse_id'=s->'movementTuple'->'warehouse_id';
    b:=balances->key; qty:=-(s->'movementTuple'->>'quantity')::NUMERIC;
    a:=b||JSONB_BUILD_OBJECT('on_hand_quantity',(b->>'on_hand_quantity')::NUMERIC-qty,
      'reserved_quantity',CASE WHEN (b->>'reserved_quantity')::NUMERIC>qty
        THEN (b->>'reserved_quantity')::NUMERIC-qty ELSE 0 END,'updated_at',event_at);
    movement:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.inventory_movements,s->'movementTuple'||JSONB_BUILD_OBJECT(
      'id',f->'movementIds'->(s->>'itemId'),'mutation_sequence',f->'movementSequences'->(s->>'itemId'),
      'balance_before',b->'on_hand_quantity','balance_after',a->'on_hand_quantity')));
    writes:=writes||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','public.inventory_balances','action','UPDATE','id',key,'before',b,'after',a),
      JSONB_BUILD_OBJECT('relation','public.inventory_movements','action','INSERT','id',movement->'id',
        'before','null'::JSONB,'after',movement));
    balances:=JSONB_SET(balances,ARRAY[key],a);
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(m->'balanceEndpoints') e
    WHERE balances->(e->>'balanceId') IS DISTINCT FROM e->'after') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_WRITE_MODEL_INVALID';
  END IF;
  history:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_status_history,
    m->'historyTuple'||JSONB_BUILD_OBJECT('id',f->'historyId')));
  audit:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
    'id',f->'completionAuditId','user_id',c->'actor_id','action','complete_order','entity_name','orders',
    'entity_id',c->'order_id','created_at',event_at,'details',JSONB_BUILD_OBJECT(
      'order_number',commercial->'sourceOrder'->'order_number','old_status',commercial->'sourceOrder'->'status','new_status','completed'))));
  writes:=writes||JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT('relation','public.orders','action','UPDATE','id',c->'order_id',
      'before',m->'orderSetup','after',m->'orderCompletedBeforeReceipt'),
    JSONB_BUILD_OBJECT('relation','public.order_status_history','action','INSERT','id',history->'id','before','null'::JSONB,'after',history),
    JSONB_BUILD_OBJECT('relation','public.audit_logs','action','INSERT','id',audit->'id','before','null'::JSONB,'after',audit));
  IF m->'receiptTuple' IS DISTINCT FROM 'null'::JSONB THEN
    payment:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.customer_payments,m->'receiptTuple'||JSONB_BUILD_OBJECT(
      'id',f->'receipt'->'paymentId','payment_number',f->'receipt'->'paymentNumber')));
    audit:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
      'id',f->'receipt'->'auditId','user_id',c->'actor_id','action','RECORD_CUSTOMER_PAYMENT',
      'entity_name','customer_payments','entity_id',payment->'id','created_at',event_at,
      'details',JSONB_BUILD_OBJECT('payment_number',payment->'payment_number','order_id',c->'order_id',
        'order_number',commercial->'sourceOrder'->'order_number','customer_id',payment->'customer_id',
        'amount_in_minor_units',payment->'amount_in_minor_units','remaining_in_minor_units',m->'financial'->'remainingInMinorUnits'))));
    --017 updates the debt projection BEFORE inserting the receipt/audit.
    writes:=writes||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','public.orders','action','UPDATE','id',c->'order_id',
        'before',m->'orderCompletedBeforeReceipt','after',m->'orderFinal'),
      JSONB_BUILD_OBJECT('relation','public.customer_payments','action','INSERT','id',payment->'id','before','null'::JSONB,'after',payment),
      JSONB_BUILD_OBJECT('relation','public.audit_logs','action','INSERT','id',audit->'id','before','null'::JSONB,'after',audit));
  END IF;
  audit:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
    'id',f->'settlementAuditId','user_id',c->'actor_id','action','COMPLETE_WEBSITE_ORDER_WITH_SETTLEMENT',
    'entity_name','orders','entity_id',c->'order_id','created_at',event_at,'details',JSONB_BUILD_OBJECT(
      'order_number',commercial->'sourceOrder'->'order_number','delivery_fee_in_minor_units',m->'orderFinal'->'delivery_fee_in_minor_units',
      'total_in_minor_units',m->'financial'->'totalInMinorUnits','collected_in_minor_units',m->'financial'->'collectedInMinorUnits',
      'remaining_in_minor_units',m->'financial'->'remainingInMinorUnits','collection_method',m->'financial'->'collectionMethod',
      'customer_payment_number',f->'receipt'->'paymentNumber','cash_shift_id',commercial->'selectedShift'->'id',
      'cash_shift_number',commercial->'selectedShift'->'shift_number'))));
  writes:=writes||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.audit_logs','action','INSERT',
    'id',audit->'id','before','null'::JSONB,'after',audit));
  RETURN JSONB_BUILD_OBJECT('modelVersion','phase5-legacy-source-transitions-v1','executionAuthority',FALSE,'writes',writes);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS OR INVALID_TEXT_REPRESENTATION OR NUMERIC_VALUE_OUT_OF_RANGE THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_WRITE_MODEL_INVALID';
END;
$$;

-- Closed resource reader: no dynamic SQL, no new row/advisory acquisition.
-- Auth identities expose only the frozen FK identity, never credentials.
CREATE FUNCTION phase5_private.read_legacy_completion_source_row_v1(relation_name TEXT, row_identity TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actual JSONB; identity UUID;
BEGIN
  IF relation_name='public.user_roles' THEN
    IF row_identity IS NULL OR row_identity !~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_IDENTITY_INVALID';
    END IF;
    SELECT TO_JSONB(t) INTO actual FROM public.user_roles t WHERE user_id=SPLIT_PART(row_identity,':',1)::UUID
      AND role_id=SPLIT_PART(row_identity,':',2)::UUID;
  ELSE
    identity:=phase5_private.wire_uuid_v1(TO_JSONB(row_identity));
    CASE relation_name
      WHEN 'public.orders' THEN SELECT TO_JSONB(t) INTO actual FROM public.orders t WHERE id=identity;
      WHEN 'public.inventory_balances' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_balances t WHERE id=identity;
      WHEN 'public.inventory_movements' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_movements t WHERE id=identity;
      WHEN 'public.order_items' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_items t WHERE id=identity;
      WHEN 'public.order_status_history' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_status_history t WHERE id=identity;
      WHEN 'public.audit_logs' THEN SELECT TO_JSONB(t) INTO actual FROM public.audit_logs t WHERE id=identity;
      WHEN 'public.customer_payments' THEN SELECT TO_JSONB(t) INTO actual FROM public.customer_payments t WHERE id=identity;
      WHEN 'public.cash_shifts' THEN SELECT TO_JSONB(t) INTO actual FROM public.cash_shifts t WHERE id=identity;
      WHEN 'public.products' THEN SELECT TO_JSONB(t) INTO actual FROM public.products t WHERE id=identity;
      WHEN 'public.branches' THEN SELECT TO_JSONB(t) INTO actual FROM public.branches t WHERE id=identity;
      WHEN 'public.customers' THEN SELECT TO_JSONB(t) INTO actual FROM public.customers t WHERE id=identity;
      WHEN 'public.customer_addresses' THEN SELECT TO_JSONB(t) INTO actual FROM public.customer_addresses t WHERE id=identity;
      WHEN 'public.promotion_codes' THEN SELECT TO_JSONB(t) INTO actual FROM public.promotion_codes t WHERE id=identity;
      WHEN 'public.warehouses' THEN SELECT TO_JSONB(t) INTO actual FROM public.warehouses t WHERE id=identity;
      WHEN 'public.profiles' THEN SELECT TO_JSONB(t) INTO actual FROM public.profiles t WHERE id=identity;
      WHEN 'public.roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.roles t WHERE id=identity;
      WHEN 'auth.users' THEN SELECT JSONB_BUILD_OBJECT('id',t.id) INTO actual FROM auth.users t WHERE id=identity;
      ELSE RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_RELATION_UNSUPPORTED';
    END CASE;
  END IF;
  RETURN COALESCE(actual,'null'::JSONB);
END;
$$;

-- Reconstruct the full source prefix, including baseline FK/header/history/
-- audit rows and absence of ALL future inserts. Row counts alone are not proof.
CREATE FUNCTION phase5_private.assert_legacy_completion_prefix_v1(context_identity UUID, write_ordinal INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; s JSONB; state JSONB; states JSONB:='{}'::JSONB;
  key TEXT; i INTEGER:=0; order_identity UUID; actual JSONB; expected JSONB; relation_name TEXT;
BEGIN
  c:=phase5_private.assert_legacy_completion_permit_v1(context_identity);
  order_identity:=(c->>'order_id')::UUID;
  writes:=phase5_private.derive_legacy_completion_writes_v1(c)->'writes';
  IF write_ordinal IS NULL OR write_ordinal<1 OR write_ordinal>JSONB_ARRAY_LENGTH(writes)+1 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_STEP_INVALID';
  END IF;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(c->'locked_plan'->'sourcePlan'->'resources') LOOP
    key:=(s->>'relation')||'|'||(s->>'id');
    states:=states||JSONB_BUILD_OBJECT(key,JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id','row',s->'row'));
  END LOOP;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(writes) LOOP
    i:=i+1; key:=(s->>'relation')||'|'||(s->>'id');
    IF NOT states ? key THEN
      states:=states||JSONB_BUILD_OBJECT(key,JSONB_BUILD_OBJECT('relation',s->'relation','id',s->'id','row',s->'before'));
    END IF;
    IF i<write_ordinal THEN states:=JSONB_SET(states,ARRAY[key,'row'],s->'after'); END IF;
  END LOOP;
  FOR state IN SELECT value FROM JSONB_EACH(states) LOOP
    IF phase5_private.read_legacy_completion_source_row_v1(state->>'relation',state->>'id') IS DISTINCT FROM state->'row' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_PREFIX_INVALID';
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['public.order_items','public.order_status_history','public.audit_logs',
    'public.inventory_movements','public.customer_payments'] LOOP
    SELECT COALESCE(JSONB_AGG(value->'row' ORDER BY value->>'id' COLLATE "C"),'[]'::JSONB) INTO expected
      FROM JSONB_EACH(states) WHERE value->>'relation'=relation_name AND value->'row'<>'null'::JSONB;
    CASE relation_name
      WHEN 'public.order_items' THEN SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id::TEXT COLLATE "C"),'[]'::JSONB)
        INTO actual FROM public.order_items t WHERE order_id=order_identity;
      WHEN 'public.order_status_history' THEN SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id::TEXT COLLATE "C"),'[]'::JSONB)
        INTO actual FROM public.order_status_history t WHERE order_id=order_identity;
      WHEN 'public.audit_logs' THEN SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id::TEXT COLLATE "C"),'[]'::JSONB)
        INTO actual FROM public.audit_logs t WHERE entity_id=order_identity
          OR id IN (SELECT (value->>'id')::UUID FROM JSONB_EACH(states) WHERE value->>'relation'=relation_name)
          OR entity_id=(c->'locked_plan'->'receipt'->>'paymentId')::UUID;
      WHEN 'public.inventory_movements' THEN SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id::TEXT COLLATE "C"),'[]'::JSONB)
        INTO actual FROM public.inventory_movements t WHERE reference_id=order_identity
          OR id IN (SELECT (value->>'id')::UUID FROM JSONB_EACH(states) WHERE value->>'relation'=relation_name);
      WHEN 'public.customer_payments' THEN SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id::TEXT COLLATE "C"),'[]'::JSONB)
        INTO actual FROM public.customer_payments t WHERE order_id=order_identity
          OR payment_number=c->'locked_plan'->'receipt'->>'paymentNumber'
          OR id=(c->'locked_plan'->'receipt'->>'paymentId')::UUID;
    END CASE;
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_SET_INVALID';
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;
CREATE FUNCTION phase5_private.assert_legacy_completion_source_tuple_v1(
  context_identity UUID, write_ordinal INTEGER, relation_name TEXT, event_name TEXT, old_tuple JSONB, new_tuple JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; step JSONB;
BEGIN
  c:=phase5_private.assert_legacy_completion_permit_v1(context_identity);
  writes:=phase5_private.derive_legacy_completion_writes_v1(c)->'writes';
  IF write_ordinal IS NULL OR write_ordinal<1 OR write_ordinal>JSONB_ARRAY_LENGTH(writes) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_STEP_INVALID';
  END IF;
  step:=writes->(write_ordinal-1);
  IF relation_name IS DISTINCT FROM step->>'relation' OR event_name IS DISTINCT FROM step->>'action'
    OR COALESCE(old_tuple,'null'::JSONB) IS DISTINCT FROM step->'before' OR new_tuple IS DISTINCT FROM step->'after' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_TUPLE_INVALID';
  END IF;
  RETURN phase5_private.assert_legacy_completion_prefix_v1(context_identity,write_ordinal);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_legacy_completion_writes_v1(JSONB),
  phase5_private.read_legacy_completion_source_row_v1(TEXT,TEXT),
  phase5_private.assert_legacy_completion_prefix_v1(UUID,INTEGER),
  phase5_private.assert_legacy_completion_source_tuple_v1(UUID,INTEGER,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_legacy_completion_writes_v1(JSONB) OWNER TO postgres;
ALTER FUNCTION phase5_private.read_legacy_completion_source_row_v1(TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_legacy_completion_prefix_v1(UUID,INTEGER) OWNER TO postgres;
ALTER FUNCTION phase5_private.assert_legacy_completion_source_tuple_v1(UUID,INTEGER,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Full deferred historical proof, including receipt absence for full/zero/debt,
-- exact movement multiplicity/chain and full source/FK/history/audit sets.
-- Expected rows come from the immutable prewrite request/source, not receipts.
CREATE FUNCTION phase5_private.assert_legacy_completion_payment_v1(context_identity UUID)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB;
BEGIN
  c:=phase5_private.assert_legacy_completion_permit_v1(context_identity);
  writes:=phase5_private.derive_legacy_completion_writes_v1(c)->'writes';
  RETURN phase5_private.assert_legacy_completion_prefix_v1(context_identity,JSONB_ARRAY_LENGTH(writes)+1);
END;
$$;

-- Only the exact server-preallocated partial receipt, at its complete prefix.
-- No standalone payment fallback or late source/Shift/key acquisition.
CREATE FUNCTION phase5_private.record_legacy_completion_payment_prelocked_v1(context_identity UUID, receipt_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; step JSONB; ordinal INTEGER; affected BIGINT;
BEGIN
  c:=phase5_private.assert_legacy_completion_permit_v1(context_identity);
  IF receipt_identity IS NULL OR receipt_identity::TEXT IS DISTINCT FROM c->'locked_plan'->'receipt'->>'paymentId' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_RECEIPT_IDENTITY_INVALID';
  END IF;
  writes:=phase5_private.derive_legacy_completion_writes_v1(c)->'writes';
  SELECT value,n::INTEGER INTO STRICT step,ordinal FROM JSONB_ARRAY_ELEMENTS(writes) WITH ORDINALITY s(value,n)
    WHERE value->>'relation'='public.customer_payments' AND value->>'action'='INSERT';
  PERFORM phase5_private.assert_legacy_completion_source_tuple_v1(context_identity,ordinal,
    step->>'relation',step->>'action',step->'before',step->'after');
  INSERT INTO public.customer_payments SELECT (JSONB_POPULATE_RECORD(NULL::public.customer_payments,step->'after')).*;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_EXECUTION_WRITE_INVALID';
  END IF;
  PERFORM phase5_private.assert_legacy_completion_prefix_v1(context_identity,ordinal+1);
  RETURN step->'after';
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_RECEIPT_IDENTITY_INVALID';
END;
$$;

-- Closed typed dispatch consumes an INITIAL already-owned plan; no dynamic SQL,
-- public nested payment/completion RPC, lock upgrade, or modern evidence.
CREATE FUNCTION phase5_private.execute_legacy_completion_prelocked_v1(context_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE c JSONB; writes JSONB; s JSONB; a JSONB; ordinal INTEGER:=0; affected BIGINT;
  f JSONB; financial JSONB; commercial JSONB;
BEGIN
  c:=phase5_private.assert_legacy_completion_context_v1(context_identity);
  writes:=phase5_private.derive_legacy_completion_writes_v1(c)->'writes';
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(writes) LOOP
    ordinal:=ordinal+1; a:=s->'after';
    PERFORM phase5_private.assert_legacy_completion_source_tuple_v1(context_identity,ordinal,
      s->>'relation',s->>'action',s->'before',a);
    IF s->>'relation'='public.customer_payments' THEN
      PERFORM phase5_private.record_legacy_completion_payment_prelocked_v1(context_identity,(s->>'id')::UUID);
    ELSE
      CASE s->>'relation'
        WHEN 'public.orders' THEN
          UPDATE public.orders SET delivery_fee_in_minor_units=(a->>'delivery_fee_in_minor_units')::BIGINT,
            total_in_minor_units=(a->>'total_in_minor_units')::BIGINT,payment_method=a->>'payment_method',
            amount_paid_in_minor_units=(a->>'amount_paid_in_minor_units')::BIGINT,payment_status=a->>'payment_status',
            status=a->>'status',payment_reference_number=a->>'payment_reference_number',
            payment_confirmed_at=(a->>'payment_confirmed_at')::TIMESTAMPTZ,
            payment_confirmed_by=(a->>'payment_confirmed_by')::UUID,cash_shift_id=(a->>'cash_shift_id')::UUID,
            delivery_completed_at=(a->>'delivery_completed_at')::TIMESTAMPTZ WHERE id=(s->>'id')::UUID;
        WHEN 'public.inventory_balances' THEN
          UPDATE public.inventory_balances SET on_hand_quantity=(a->>'on_hand_quantity')::NUMERIC,
            reserved_quantity=(a->>'reserved_quantity')::NUMERIC WHERE id=(s->>'id')::UUID;
        WHEN 'public.inventory_movements' THEN
          INSERT INTO public.inventory_movements SELECT (JSONB_POPULATE_RECORD(NULL::public.inventory_movements,a)).*;
        WHEN 'public.order_status_history' THEN
          INSERT INTO public.order_status_history SELECT (JSONB_POPULATE_RECORD(NULL::public.order_status_history,a)).*;
        WHEN 'public.audit_logs' THEN
          INSERT INTO public.audit_logs SELECT (JSONB_POPULATE_RECORD(NULL::public.audit_logs,a)).*;
        ELSE RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_SOURCE_RELATION_UNSUPPORTED';
      END CASE;
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected<>1 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_LEGACY_EXECUTION_WRITE_INVALID';
      END IF;
    END IF;
    PERFORM phase5_private.assert_legacy_completion_prefix_v1(context_identity,ordinal+1);
  END LOOP;
  PERFORM phase5_private.complete_legacy_completion_context_v1(context_identity);
  f:=c->'locked_plan'; financial:=f->'model'->'financial'; commercial:=f->'sourcePlan'->'commercial';
  RETURN JSONB_BUILD_OBJECT('success',TRUE,'order_id',c->'order_id',
    'order_number',commercial->'sourceOrder'->'order_number','status','completed',
    'payment_method',CASE WHEN (financial->>'remainingInMinorUnits')::BIGINT>0 THEN 'debt' ELSE financial->>'collectionMethod' END,
    'payment_status',f->'model'->'orderFinal'->'payment_status',
    'total_in_minor_units',financial->'totalInMinorUnits','amount_paid_in_minor_units',financial->'collectedInMinorUnits',
    'remaining_in_minor_units',financial->'remainingInMinorUnits','customer_payment_number',f->'receipt'->'paymentNumber',
    'cash_shift_id',commercial->'selectedShift'->'id','cash_shift_number',commercial->'selectedShift'->'shift_number',
    'message',CASE WHEN (financial->>'remainingInMinorUnits')::BIGINT=0 THEN 'تم التسليم وقبض كامل المبلغ وخصم المخزون.'
      WHEN (financial->>'collectedInMinorUnits')::BIGINT=0 THEN 'تم التسليم وخصم المخزون وتسجيل كامل المبلغ ذمة على العميل.'
      ELSE 'تم التسليم وتسجيل الدفعة والباقي ذمة على العميل.' END);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_payment_v1(UUID),
  phase5_private.record_legacy_completion_payment_prelocked_v1(UUID,UUID),
  phase5_private.execute_legacy_completion_prelocked_v1(UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_payment_v1(UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.record_legacy_completion_payment_prelocked_v1(UUID,UUID) OWNER TO postgres;
ALTER FUNCTION phase5_private.execute_legacy_completion_prelocked_v1(UUID) OWNER TO postgres;

-- Historical resolution is NOT an execution permit. Initial completion keeps
-- the default FALSE proof mode, full live prefix and transaction/generation
-- fence. This read-only resolver uses the SAME durable per-identity validators,
-- but excludes later independent financial/lifecycle activity from the original
-- completion-owned set. No current Shift, balance, WAC, paid projection or127.
CREATE FUNCTION phase5_private.resolve_customer_completion_v1(
  order_identity UUID, request_key TEXT, method TEXT, amount BIGINT,
  delivery BIGINT, reference TEXT, notes TEXT
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID:=auth.uid(); key_name TEXT:=NULLIF(BTRIM(request_key),'');
  tender TEXT:=LOWER(NULLIF(BTRIM(method),'')); r JSONB; c phase5_private.mutation_contexts%ROWTYPE;
  outcome JSONB;
BEGIN
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
  IF order_identity IS NULL OR key_name IS NULL OR CHAR_LENGTH(key_name) NOT BETWEEN 16 AND 200
    OR tender IS NULL OR tender NOT IN ('cash','cash_on_delivery','cliq','debt')
    OR amount<0 OR delivery<0 OR CHAR_LENGTH(COALESCE(BTRIM(reference),''))>120 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_REQUEST_INVALID';
  END IF;
  IF tender='cash_on_delivery' THEN tender:='cash'; END IF;
  IF tender='cliq' AND COALESCE(amount,1)>0 AND NULLIF(BTRIM(reference),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_REFERENCE_REQUIRED';
  END IF;
  r:=JSONB_BUILD_OBJECT('contract_version','phase3-customer-completion-v1',
    'actor_scope_hash',public.phase3_actor_scope_hash_internal('erp_user',actor,NULL,NULL),
    'order_id',order_identity::TEXT,'payment_method',tender,'amount_collected_in_minor_units',amount,
    'delivery_fee_in_minor_units',delivery,'reference_number',NULLIF(BTRIM(reference),''),'notes',NULLIF(BTRIM(notes),''));
  IF NOT EXISTS(SELECT 1 FROM phase5_private.mutation_contexts t WHERE t.purpose='CUSTOMER_COMPLETION'
    AND t.actor_id=actor AND t.locked_plan->'sourcePlan'->'parent'->>'requestKey'=key_name) THEN RETURN NULL; END IF;
  SELECT * INTO STRICT c FROM phase5_private.mutation_contexts t WHERE t.purpose='CUSTOMER_COMPLETION'
    AND t.actor_id=actor AND t.locked_plan->'sourcePlan'->'parent'->>'requestKey'=key_name;
  IF c.order_id IS DISTINCT FROM order_identity OR c.normalized_request IS DISTINCT FROM r
    OR c.request_fingerprint IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(r)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COMPLETION_IDEMPOTENCY_CONFLICT';
  END IF;
  PERFORM phase5_private.validate_customer_completion_child_link_v1(c.id,TRUE);
  IF EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE id=c.operation_id)
    OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes WHERE financial_operation_id=c.operation_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_REPLAY_OPERATION_INVALID';
  END IF;
  SELECT b.result_snapshot INTO STRICT outcome FROM public.business_operations b WHERE id=c.operation_id;
  RETURN outcome;
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PARENT_REPLAY_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.resolve_customer_completion_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.resolve_customer_completion_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO postgres;

-- First full-Shift preparation layer: explicit CUSTOMER PAYMENT instructions
-- and authoritative source binding ONLY. This is not the complete batch plan,
-- a financial-capacity approval, a lock permit, or an executable coordinator.
-- POS/supplier/expense discovery is retained as context, never omitted from a
-- purported complete plan. No existing writer or reader calls these helpers.
CREATE FUNCTION phase5_private.assert_shift_payment_instructions_v1(instructions JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE r JSONB; reference TEXT;
BEGIN
  IF JSONB_TYPEOF(instructions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_INVALID';
  END IF;
  FOR r IN SELECT value FROM JSONB_ARRAY_ELEMENTS(instructions) LOOP
    PERFORM phase5_private.assert_wire_keys_v1(r,ARRAY[
      'originalPaymentId','originalCollectionId','orderId','idempotencyKey',
      'actualTenderMethod','tenderReference','executionShiftId']);
    PERFORM phase5_private.wire_uuid_v1(r->'originalPaymentId');
    PERFORM phase5_private.wire_uuid_v1(r->'originalCollectionId');
    PERFORM phase5_private.wire_uuid_v1(r->'orderId');
    IF JSONB_TYPEOF(r->'idempotencyKey') IS DISTINCT FROM 'string'
      OR r->>'idempotencyKey' IS DISTINCT FROM BTRIM(r->>'idempotencyKey')
      OR CHAR_LENGTH(r->>'idempotencyKey') NOT BETWEEN 1 AND 255
      OR JSONB_TYPEOF(r->'actualTenderMethod') IS DISTINCT FROM 'string'
      OR r->>'actualTenderMethod' NOT IN ('cash','cliq') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_INVALID';
    END IF;
    IF r->'tenderReference' IS DISTINCT FROM 'null'::JSONB THEN
      IF JSONB_TYPEOF(r->'tenderReference') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_INVALID';
      END IF;
      reference := r->>'tenderReference';
      IF reference IS DISTINCT FROM BTRIM(reference) OR CHAR_LENGTH(reference) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_INVALID';
      END IF;
    END IF;
    IF r->>'actualTenderMethod'='cash' THEN
      PERFORM phase5_private.wire_uuid_v1(r->'executionShiftId');
    ELSIF r->'executionShiftId' IS DISTINCT FROM 'null'::JSONB
      OR r->'tenderReference'='null'::JSONB THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_INVALID';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(instructions) n
    GROUP BY n->>'originalPaymentId' HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(instructions) n
    GROUP BY n->>'originalCollectionId' HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(instructions) n
    GROUP BY n->>'idempotencyKey' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_DUPLICATE_IDENTITY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_payment_instructions_v1(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_payment_instructions_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_shift_payment_instructions_v1(
  actor UUID, shift_identity UUID, instructions JSONB
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE s public.cash_shifts%ROWTYPE; p public.customer_payments%ROWTYPE;
  c phase5_private.collection_events%ROWTYPE; o public.orders%ROWTYPE;
  r JSONB; actual UUID[]; expected UUID[]; children JSONB := '[]'::JSONB;
  ordered JSONB; source JSONB; facts JSONB; selected_shift JSONB;
BEGIN
  -- Owner/AAL2 and active actor validation precede every business read. A
  -- caller-supplied actor and privileged invoker execution are not authority.
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SHIFT_ACTOR_UNAUTHORIZED';
  END IF;
  IF public.assert_reversal_owner('Phase5 private Shift instruction discovery') IS DISTINCT FROM actor THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SHIFT_ACTOR_UNAUTHORIZED';
  END IF;
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,FALSE);
  IF shift_identity IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_IDENTITY_REQUIRED';
  END IF;
  PERFORM phase5_private.assert_shift_payment_instructions_v1(instructions);
  SELECT * INTO STRICT s FROM public.cash_shifts WHERE id=shift_identity;
  SELECT COALESCE(ARRAY_AGG(id ORDER BY id),ARRAY[]::UUID[]) INTO expected
    FROM public.customer_payments WHERE cash_shift_id=shift_identity;
  SELECT COALESCE(ARRAY_AGG((n->>'originalPaymentId')::UUID ORDER BY n->>'originalPaymentId'),ARRAY[]::UUID[])
    INTO actual FROM JSONB_ARRAY_ELEMENTS(instructions) n;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_PAYMENT_EXACT_SET_REQUIRED';
  END IF;
  SELECT COALESCE(JSONB_AGG(n ORDER BY n->>'originalPaymentId'),'[]'::JSONB)
    INTO ordered FROM JSONB_ARRAY_ELEMENTS(instructions) n;
  FOR r IN SELECT value FROM JSONB_ARRAY_ELEMENTS(ordered) LOOP
    SELECT * INTO STRICT p FROM public.customer_payments WHERE id=(r->>'originalPaymentId')::UUID;
    SELECT * INTO STRICT c FROM phase5_private.collection_events WHERE original_payment_id=p.id;
    SELECT * INTO STRICT o FROM public.orders WHERE id=p.order_id;
    IF p.cash_shift_id IS DISTINCT FROM shift_identity OR p.order_id IS DISTINCT FROM (r->>'orderId')::UUID
      OR c.id IS DISTINCT FROM (r->>'originalCollectionId')::UUID
      OR p.is_reversed IS DISTINCT FROM FALSE
      OR EXISTS(SELECT 1 FROM phase5_private.payment_reversal_events WHERE original_payment_id=p.id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_PAYMENT_SOURCE_INVALID';
    END IF;
    source := phase5_private.collection_source_v1(p.order_id,'customer_payment',p.id);
    -- Complete financial population, not amount_paid or a subset SUM. No
    -- missing anchor is created here; unavailable historical/Legacy evidence
    -- fails closed. Candidate batch capacity must be checked in a later layer.
    facts := phase5_private.read_order_financial_facts_v1(p.order_id);
    selected_shift := NULL;
    IF r->>'actualTenderMethod'='cash' THEN
      SELECT TO_JSONB(t) INTO STRICT selected_shift FROM public.cash_shifts t
        WHERE t.id=(r->>'executionShiftId')::UUID AND t.branch_id=o.branch_id AND t.status='open';
      IF (SELECT COUNT(*) FROM public.cash_shifts t WHERE t.branch_id=o.branch_id AND t.status='open')<>1 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_EXECUTION_SHIFT_AMBIGUOUS';
      END IF;
    END IF;
    children := children || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('instruction',r,
      'payment',TO_JSONB(p),'collection',TO_JSONB(c),'order',TO_JSONB(o),
      'source',source,'facts',facts,'position',phase5_private.derive_financial_position_v1(facts),
      'executionShift',selected_shift));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-payment-instruction-discovery-v1',
    'planState','DISCOVERED_NOT_LOCKED','completeFor','CUSTOMER_PAYMENT_SOURCE_BINDING_ONLY',
    'actorId',actor,'shift',TO_JSONB(s),'instructions',ordered,'children',children,
    'sourceContext',public.phase4_full_shift_context_snapshot_internal(shift_identity));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_PAYMENT_SOURCE_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_shift_payment_instructions_v1(UUID,UUID,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_shift_payment_instructions_v1(UUID,UUID,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_payment_instructions_unchanged_v1(
  actor UUID, shift_identity UUID, instructions JSONB, expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_shift_payment_instructions_v1(actor,shift_identity,instructions) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_INSTRUCTIONS_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_payment_instructions_unchanged_v1(UUID,UUID,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_payment_instructions_unchanged_v1(UUID,UUID,JSONB,JSONB) OWNER TO postgres;

-- Pure arithmetic/identity sub-boundary. Its inputs alone are NOT authoritative;
-- the discovery wrapper supplies freshly validated127 facts and126 sources.
-- Full exact payments are reversed; there is no caller-supplied partial amount.
CREATE FUNCTION phase5_private.derive_payment_reversal_candidate_v1(facts JSONB, sources JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE position JSONB; n JSONB; amount NUMERIC := 0; coverage NUMERIC;
  candidate NUMERIC; debt NUMERIC; refund NUMERIC; total NUMERIC; delivery NUMERIC;
  outstanding NUMERIC; collected_delivery NUMERIC;
BEGIN
  position := phase5_private.derive_financial_position_v1(facts);
  PERFORM phase5_private.wire_uuid_v1(facts->'orderId');
  IF JSONB_TYPEOF(sources) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_REVERSAL_CANDIDATE_SOURCES_INVALID';
  END IF;
  IF JSONB_ARRAY_LENGTH(sources)=0 OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(sources) s
    GROUP BY s->>'kind',s->>'sourceId' HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(facts->'sources') s
    GROUP BY s->>'kind',s->>'sourceId' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_REVERSAL_CANDIDATE_IDENTITY_INVALID';
  END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(sources) LOOP
    PERFORM phase5_private.wire_uuid_v1(n->'sourceId');
    IF n->>'kind' IS DISTINCT FROM 'customer_payment'
      OR n->'orderId' IS DISTINCT FROM facts->'orderId'
      OR (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(facts->'sources') s
        WHERE s=n)<>1 OR phase5_private.money_v1(n->'amountInMinorUnits')=0
      OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(facts->'reversals') v
        WHERE v->'original_payment_id'=n->'sourceId') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_REVERSAL_CANDIDATE_SOURCE_INVALID';
    END IF;
    amount := amount + phase5_private.money_v1(n->'amountInMinorUnits');
  END LOOP;
  coverage := phase5_private.money_v1(position->'collectionCoverageInMinorUnits');
  total := phase5_private.money_v1(position->'totalInMinorUnits');
  delivery := phase5_private.money_v1(position->'deliveryInMinorUnits');
  debt := phase5_private.money_v1(position->'settledDebtReductionInMinorUnits');
  refund := phase5_private.money_v1(position->'settledMoneyRefundInMinorUnits');
  candidate := coverage - amount;
  outstanding := total - candidate - debt;
  IF candidate<0 OR outstanding<0 OR amount>9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_REVERSAL_CANDIDATE_CAPACITY_EXCEEDED';
  END IF;
  -- Same closed126 candidate rule, applied to the complete per-Order batch.
  -- Refund is not subtracted twice and never recreates customer debt.
  collected_delivery := delivery - LEAST(delivery,outstanding);
  IF candidate < refund + collected_delivery THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_REVERSAL_CANDIDATE_CAPACITY_EXCEEDED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('orderId',facts->'orderId','fullReversalAmountInMinorUnits',amount::BIGINT::TEXT,
    'coverageBeforeInMinorUnits',coverage::BIGINT::TEXT,'candidateCoverageInMinorUnits',candidate::BIGINT::TEXT,
    'settledDebtReductionInMinorUnits',debt::BIGINT::TEXT,'settledMoneyRefundInMinorUnits',refund::BIGINT::TEXT,
    'candidateOutstandingInMinorUnits',outstanding::BIGINT::TEXT,
    'candidateCollectedDeliveryInMinorUnits',collected_delivery::BIGINT::TEXT);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_payment_reversal_candidate_v1(JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_payment_reversal_candidate_v1(JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_shift_payment_union_v1(actor UUID, shift_identity UUID, instructions JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; children JSONB; child JSONB; resources JSONB := '[]'::JSONB;
  capacities JSONB := '[]'::JSONB; shifts JSONB; parents JSONB; keys JSONB;
  actor_ids UUID[]; shift_ids UUID[]; order_ids UUID[]; warehouse_ids UUID[]; product_ids UUID[];
  branch_ids UUID[]; customer_ids UUID[]; order_identity UUID; facts JSONB; selected_sources JSONB;
BEGIN
  plan := phase5_private.discover_shift_payment_instructions_v1(actor,shift_identity,instructions);
  children := plan->'children';
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(children) n GROUP BY n->'order'->>'id'
    HAVING COUNT(DISTINCT n->'facts')<>1 OR COUNT(DISTINCT n->'order')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_UNION_SOURCE_CHANGED_RETRY';
  END IF;
  SELECT COALESCE(ARRAY_AGG(DISTINCT (n->'order'->>'id')::UUID ORDER BY (n->'order'->>'id')::UUID),ARRAY[]::UUID[])
    INTO order_ids FROM JSONB_ARRAY_ELEMENTS(children) n;
  FOREACH order_identity IN ARRAY order_ids LOOP
    SELECT n->'facts' INTO STRICT facts FROM JSONB_ARRAY_ELEMENTS(children) n
      WHERE n->'order'->>'id'=order_identity::TEXT ORDER BY n->'instruction'->>'originalPaymentId' LIMIT 1;
    SELECT JSONB_AGG(n->'source' ORDER BY n->'source'->>'sourceId') INTO selected_sources
      FROM JSONB_ARRAY_ELEMENTS(children) n WHERE n->'order'->>'id'=order_identity::TEXT;
    capacities := capacities || JSONB_BUILD_ARRAY(phase5_private.derive_payment_reversal_candidate_v1(facts,selected_sources));
    resources := resources || phase5_private.collection_plan_resources_v2(order_identity,facts);
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) n
    GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE n->>'id' IS NULL OR n->>'relation' IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_UNION_RESOURCE_CHANGED_RETRY';
  END IF;
  -- Claimability is only a read precondition; actual sorted key gates and
  -- post-lock ownership validation remain mandatory before any future write.
  FOR child IN SELECT value FROM JSONB_ARRAY_ELEMENTS(children) LOOP
    IF EXISTS(SELECT 1 FROM public.customer_payments WHERE created_by=actor AND idempotency_key=child->'instruction'->>'idempotencyKey')
      OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE actor_scope_id=actor
        AND idempotency_key=child->'instruction'->>'idempotencyKey')
      OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes WHERE actor_id=actor
        AND idempotency_key=child->'instruction'->>'idempotencyKey') THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_CHILD_KEY_ALREADY_OWNED';
    END IF;
  END LOOP;
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO shift_ids FROM (
    SELECT shift_identity id UNION ALL
    SELECT (n->'executionShift'->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(children) n UNION ALL
    SELECT (n->'row'->>field)::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
      CROSS JOIN UNNEST(ARRAY['cash_shift_id','actual_cash_shift_id']) field
  ) candidates WHERE id IS NOT NULL;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('row',TO_JSONB(s),'mode',CASE WHEN s.id=shift_identity OR EXISTS(
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(children) n WHERE n->'executionShift'->>'id'=s.id::TEXT)
      THEN 'UPDATE' ELSE 'KEY_SHARE' END) ORDER BY s.id),'[]'::JSONB)
    INTO shifts FROM public.cash_shifts s WHERE s.id=ANY(shift_ids);
  IF JSONB_ARRAY_LENGTH(shifts) IS DISTINCT FROM CARDINALITY(shift_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_UNION_SHIFT_MISSING';
  END IF;
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO actor_ids FROM (
    SELECT actor id UNION ALL SELECT (n->'row'->>field)::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
      CROSS JOIN UNNEST(ARRAY['created_by','initiated_by','actor_id','actor_scope_id','settled_by','reversed_by']) field
  ) identities WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO warehouse_ids FROM (
    SELECT (n->'order'->>'warehouse_id')::UUID id FROM JSONB_ARRAY_ELEMENTS(children) n UNION ALL
    SELECT (n->'row'->>'warehouse_id')::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
  ) identities WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO customer_ids FROM (
    SELECT (n->'order'->>'customer_id')::UUID id FROM JSONB_ARRAY_ELEMENTS(children) n UNION ALL
    SELECT (n->'row'->>'customer_id')::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
  ) identities WHERE id IS NOT NULL;
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO branch_ids FROM (
    SELECT (plan->'shift'->>'branch_id')::UUID id UNION ALL
    SELECT (n->'order'->>'branch_id')::UUID FROM JSONB_ARRAY_ELEMENTS(children) n UNION ALL
    SELECT (n->'row'->>'branch_id')::UUID FROM JSONB_ARRAY_ELEMENTS(shifts) n
  ) identities WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT (n->'row'->>'product_id')::UUID),ARRAY[]::UUID[]) INTO product_ids
    FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE n->'row'->>'product_id' IS NOT NULL;
  -- Static typed parent reads; never dynamic SQL or catalog-driven locking.
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',row_data->>'id',
      'row',row_data,'mode','SHARE') ORDER BY relation_name COLLATE "C",row_data->>'id' COLLATE "C"),'[]'::JSONB)
    INTO parents FROM (
    SELECT 'public.profiles' relation_name,TO_JSONB(p) row_data FROM public.profiles p WHERE p.id=ANY(actor_ids) UNION ALL
    SELECT 'public.customers',TO_JSONB(c) FROM public.customers c WHERE c.id=ANY(customer_ids) UNION ALL
    SELECT 'public.branches',TO_JSONB(b) FROM public.branches b WHERE b.id=ANY(branch_ids) UNION ALL
    SELECT 'public.warehouses',TO_JSONB(w) FROM public.warehouses w WHERE w.id=ANY(warehouse_ids) UNION ALL
    SELECT 'public.products',TO_JSONB(p) FROM public.products p WHERE p.id=ANY(product_ids)
  ) parent_rows;
  IF (SELECT COUNT(*) FROM public.profiles WHERE id=ANY(actor_ids))<>CARDINALITY(actor_ids)
    OR (SELECT COUNT(*) FROM public.customers WHERE id=ANY(customer_ids))<>CARDINALITY(customer_ids)
    OR (SELECT COUNT(*) FROM public.branches WHERE id=ANY(branch_ids))<>CARDINALITY(branch_ids)
    OR (SELECT COUNT(*) FROM public.warehouses WHERE id=ANY(warehouse_ids))<>CARDINALITY(warehouse_ids)
    OR (SELECT COUNT(*) FROM public.products WHERE id=ANY(product_ids))<>CARDINALITY(product_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_UNION_PARENT_MISSING';
  END IF;
  SELECT COALESCE(JSONB_AGG(key_name ORDER BY key_name COLLATE "C"),'[]'::JSONB) INTO keys FROM (
    SELECT DISTINCT key_name FROM JSONB_ARRAY_ELEMENTS(children) n CROSS JOIN LATERAL UNNEST(ARRAY[
      actor::TEXT || ':' || (n->'instruction'->>'idempotencyKey'),
      'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_payment_reversal_v1|' || (n->'instruction'->>'idempotencyKey'),
      'phase5-idempotency|erp_user|' || actor::TEXT || '|customer_payment_reversal_v2|' || (n->'instruction'->>'idempotencyKey')]) key_name
  ) key_set;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-payment-union-v1',
    'planState','DISCOVERED_UNION_NOT_LOCKED','completeFor','CUSTOMER_PAYMENT_REVERSAL_CHILDREN_ONLY',
    'sourcePlan',plan,'capacities',capacities,'keyGates',keys,
    'rootGates',(SELECT COALESCE(JSONB_AGG('phase4-order|' || id::TEXT ORDER BY id),'[]'::JSONB) FROM UNNEST(order_ids) id),
    'sharedGates',(SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) FROM (
      SELECT 'cash-shift-full-reversal:' || (s->'row'->>'id') g FROM JSONB_ARRAY_ELEMENTS(shifts) s UNION
      SELECT 'pos-sale-reversal:' || (n->'order'->>'id') FROM JSONB_ARRAY_ELEMENTS(children) n WHERE n->'order'->>'source'='pos') gates),
    'orders',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('row',TO_JSONB(o),'mode','UPDATE') ORDER BY o.id),'[]'::JSONB)
      FROM public.orders o WHERE o.id=ANY(order_ids)),
    'shifts',shifts,'parents',parents,
    'actorRoles',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),'role',TO_JSONB(r)) ORDER BY ur.role_id),'[]'::JSONB)
      FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor),
    'resources',(SELECT COALESCE(JSONB_AGG(n || JSONB_BUILD_OBJECT('mode',CASE WHEN n->>'kind'='p' THEN 'UPDATE' ELSE 'SHARE' END)
      ORDER BY n->>'relation' COLLATE "C",n->>'id' COLLATE "C"),'[]'::JSONB)
      FROM (SELECT DISTINCT n FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE n->>'kind'<>'o') rows));
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_shift_payment_union_v1(UUID,UUID,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_shift_payment_union_v1(UUID,UUID,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_payment_union_unchanged_v1(actor UUID, shift_identity UUID, instructions JSONB, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_shift_payment_union_v1(actor,shift_identity,instructions) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_payment_union_unchanged_v1(UUID,UUID,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_payment_union_unchanged_v1(UUID,UUID,JSONB,JSONB) OWNER TO postgres;

-- Retained POS/supplier/expense domain discovery, not batch eligibility or a
-- held-lock/execution permit. Fixed typed source reads preserve Legacy rows and
-- existing supplier/expense policy. The payment-child subplan stays separate
-- until the complete union and future child identities have been validated.
CREATE FUNCTION phase5_private.discover_shift_retained_resources_v1(actor UUID, shift_identity UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE seed JSONB; supplier_contexts JSONB := '[]'::JSONB; p RECORD;
  order_ids UUID[]; payment_ids UUID[]; supplier_receipt_ids UUID[]; purchase_receipt_ids UUID[];
  purchase_order_ids UUID[]; product_ids UUID[]; shift_ids UUID[]; actor_ids UUID[];
  resources JSONB; parents JSONB; side_effects JSONB; s public.cash_shifts%ROWTYPE;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SHIFT_ACTOR_UNAUTHORIZED';
  END IF;
  IF public.assert_reversal_owner('Phase5 private retained Shift discovery') IS DISTINCT FROM actor THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SHIFT_ACTOR_UNAUTHORIZED';
  END IF;
  PERFORM phase5_private.authorize_coordinator_actor_v1(actor,FALSE);
  IF shift_identity IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_IDENTITY_REQUIRED';
  END IF;
  SELECT * INTO STRICT s FROM public.cash_shifts WHERE id=shift_identity;
  seed := public.phase4_full_shift_context_snapshot_internal(shift_identity);
  -- Include the target payment itself even when it has no document identity.
  -- Discovery must preserve unsupported source rows, never silently omit them
  -- or manufacture business eligibility from the old context's related subset.
  FOR p IN SELECT id FROM public.supplier_payments WHERE cash_shift_id=shift_identity ORDER BY id LOOP
    supplier_contexts := supplier_contexts || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('paymentId',p.id,
      'context',public.phase4_supplier_context_snapshot_internal(NULL,NULL,p.id)));
  END LOOP;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO order_ids FROM (
    SELECT value::UUID id FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'order_ids') UNION ALL
    SELECT order_id FROM public.sales_return_events WHERE cash_shift_id=shift_identity UNION ALL
    SELECT order_id FROM public.sales_returns WHERE cash_shift_id=shift_identity
  ) ids WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO payment_ids FROM (
    SELECT id FROM public.supplier_payments WHERE cash_shift_id=shift_identity UNION ALL
    SELECT value::UUID FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'supplier_payment_ids') UNION ALL
    SELECT item.value::UUID FROM JSONB_ARRAY_ELEMENTS(supplier_contexts) c,
      JSONB_ARRAY_ELEMENTS_TEXT(c->'context'->'payment_ids') item
  ) ids;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO supplier_receipt_ids FROM (
    SELECT value::UUID id FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'supplier_receipt_ids') UNION ALL
    SELECT (c->'context'->>'supplier_receipt_id')::UUID FROM JSONB_ARRAY_ELEMENTS(supplier_contexts) c
  ) ids WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO purchase_receipt_ids FROM (
    SELECT value::UUID id FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'purchase_receipt_ids') UNION ALL
    SELECT (c->'context'->>'purchase_receipt_id')::UUID FROM JSONB_ARRAY_ELEMENTS(supplier_contexts) c
  ) ids WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO purchase_order_ids FROM (
    SELECT value::UUID id FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'purchase_order_ids') UNION ALL
    SELECT (c->'context'->>'purchase_order_id')::UUID FROM JSONB_ARRAY_ELEMENTS(supplier_contexts) c
  ) ids WHERE id IS NOT NULL;
  -- All source/dependency rows are frozen by full content, not just IDs/counts.
  -- SHARED SKU acquisition in113/115 touches every warehouse balance; chronology
  -- guards read movements independently of the selected sale/receipt reference.
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO product_ids FROM (
    SELECT value::UUID id FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'product_ids') UNION ALL
    SELECT item.value::UUID FROM JSONB_ARRAY_ELEMENTS(supplier_contexts) c,
      JSONB_ARRAY_ELEMENTS_TEXT(c->'context'->'product_ids') item
  ) ids WHERE id IS NOT NULL;
  WITH typed AS (
    SELECT 'public.orders' relation_name,5 rank, 'UPDATE' mode,TO_JSONB(t) row_data FROM public.orders t WHERE id=ANY(order_ids) UNION ALL
    SELECT 'public.order_items',6,'SHARE',TO_JSONB(t) FROM public.order_items t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.order_parcel_instances',6,'SHARE',TO_JSONB(t) FROM public.order_parcel_instances t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.order_parcel_components',6,'SHARE',TO_JSONB(t) FROM public.order_parcel_components t
      JOIN public.order_parcel_instances i ON i.id=t.parcel_instance_id WHERE i.order_id=ANY(order_ids) UNION ALL
    SELECT 'public.order_inventory_reservations',6,'SHARE',TO_JSONB(t) FROM public.order_inventory_reservations t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.order_status_history',6,'SHARE',TO_JSONB(t) FROM public.order_status_history t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.customer_payments',6,'UPDATE',TO_JSONB(t) FROM public.customer_payments t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.pos_sale_reversals',6,'SHARE',TO_JSONB(t) FROM public.pos_sale_reversals t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_returns',6,'SHARE',TO_JSONB(t) FROM public.sales_returns t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_return_events',6,'SHARE',TO_JSONB(t) FROM public.sales_return_events t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_return_items',6,'SHARE',TO_JSONB(t) FROM public.sales_return_items t
      JOIN public.sales_return_events h ON h.id=t.sales_return_event_id WHERE h.order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_replacement_events',6,'SHARE',TO_JSONB(t) FROM public.sales_replacement_events t WHERE root_order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_replacement_items',6,'SHARE',TO_JSONB(t) FROM public.sales_replacement_items t
      JOIN public.sales_replacement_events h ON h.id=t.replacement_event_id WHERE h.root_order_id=ANY(order_ids) UNION ALL
    SELECT 'public.sales_aftercare_consumptions',6,'SHARE',TO_JSONB(t) FROM public.sales_aftercare_consumptions t
      WHERE operation_id IN (SELECT operation_id FROM public.sales_return_events WHERE order_id=ANY(order_ids)
        UNION SELECT operation_id FROM public.sales_replacement_events WHERE root_order_id=ANY(order_ids)) UNION ALL
    SELECT 'public.phase42_return_settlement_evidence',6,'SHARE',TO_JSONB(t) FROM public.phase42_return_settlement_evidence t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.phase42_return_inventory_effects',6,'SHARE',TO_JSONB(t) FROM public.phase42_return_inventory_effects t
      JOIN public.sales_return_events h ON h.id=t.return_event_id WHERE h.order_id=ANY(order_ids) UNION ALL
    SELECT 'public.phase43_replacement_settlement_evidence',6,'SHARE',TO_JSONB(t) FROM public.phase43_replacement_settlement_evidence t WHERE order_id=ANY(order_ids) UNION ALL
    SELECT 'public.phase43_replacement_inventory_effects',6,'SHARE',TO_JSONB(t) FROM public.phase43_replacement_inventory_effects t
      JOIN public.sales_replacement_events h ON h.id=t.replacement_event_id WHERE h.root_order_id=ANY(order_ids) UNION ALL
    SELECT 'public.supplier_receipts',6,'UPDATE',TO_JSONB(t) FROM public.supplier_receipts t WHERE id=ANY(supplier_receipt_ids) UNION ALL
    SELECT 'public.supplier_receipt_items',6,'SHARE',TO_JSONB(t) FROM public.supplier_receipt_items t WHERE supplier_receipt_id=ANY(supplier_receipt_ids) UNION ALL
    SELECT 'public.supplier_receipt_commercial_lines',6,'SHARE',TO_JSONB(t) FROM public.supplier_receipt_commercial_lines t WHERE supplier_receipt_id=ANY(supplier_receipt_ids) UNION ALL
    SELECT 'public.phase2_receipt_wac_snapshots',6,'SHARE',TO_JSONB(t) FROM public.phase2_receipt_wac_snapshots t
      WHERE supplier_receipt_id=ANY(supplier_receipt_ids) OR purchase_receipt_id=ANY(purchase_receipt_ids) UNION ALL
    SELECT 'public.supplier_financial_invoice_identities',6,'SHARE',TO_JSONB(t) FROM public.supplier_financial_invoice_identities t
      WHERE supplier_receipt_id=ANY(supplier_receipt_ids) OR purchase_receipt_id=ANY(purchase_receipt_ids) UNION ALL
    SELECT 'public.purchase_receipts',6,'UPDATE',TO_JSONB(t) FROM public.purchase_receipts t WHERE id=ANY(purchase_receipt_ids) UNION ALL
    SELECT 'public.purchase_receipt_items',6,'SHARE',TO_JSONB(t) FROM public.purchase_receipt_items t WHERE purchase_receipt_id=ANY(purchase_receipt_ids) UNION ALL
    SELECT 'public.purchase_receipt_commercial_lines',6,'SHARE',TO_JSONB(t) FROM public.purchase_receipt_commercial_lines t WHERE purchase_receipt_id=ANY(purchase_receipt_ids) UNION ALL
    SELECT 'public.purchase_orders',6,'UPDATE',TO_JSONB(t) FROM public.purchase_orders t WHERE id=ANY(purchase_order_ids) UNION ALL
    SELECT 'public.purchase_order_items',6,'SHARE',TO_JSONB(t) FROM public.purchase_order_items t WHERE purchase_order_id=ANY(purchase_order_ids) UNION ALL
    SELECT 'public.supplier_payments',6,'UPDATE',TO_JSONB(t) FROM public.supplier_payments t WHERE id=ANY(payment_ids) UNION ALL
    SELECT 'public.supplier_payment_reversals',6,'SHARE',TO_JSONB(t) FROM public.supplier_payment_reversals t WHERE supplier_payment_id=ANY(payment_ids) UNION ALL
    SELECT 'public.operational_expenses',6,'UPDATE',TO_JSONB(t) FROM public.operational_expenses t WHERE shift_id=shift_identity UNION ALL
    SELECT 'public.cash_shift_reversals',6,'SHARE',TO_JSONB(t) FROM public.cash_shift_reversals t WHERE shift_id=shift_identity UNION ALL
    SELECT 'public.cash_shift_reversal_operations',6,'SHARE',TO_JSONB(t) FROM public.cash_shift_reversal_operations t WHERE shift_id=shift_identity UNION ALL
    SELECT 'public.inventory_balances',5,'UPDATE',TO_JSONB(t) FROM public.inventory_balances t WHERE product_id=ANY(product_ids) UNION ALL
    SELECT 'public.inventory_movements',6,'SHARE',TO_JSONB(t) FROM public.inventory_movements t WHERE product_id=ANY(product_ids)
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',COALESCE(row_data->>'id',row_data->>'operation_id'),
    'row',row_data,'rank',rank,'mode',mode) ORDER BY rank,relation_name COLLATE "C",COALESCE(row_data->>'id',row_data->>'operation_id') COLLATE "C"),'[]'::JSONB)
    INTO resources FROM typed;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO shift_ids FROM (
    SELECT shift_identity id UNION ALL SELECT value::UUID FROM JSONB_ARRAY_ELEMENTS_TEXT(seed->'shift_ids') UNION ALL
    SELECT (n->'row'->>'cash_shift_id')::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n UNION ALL
    SELECT (n->'row'->>'shift_id')::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
  ) ids WHERE id IS NOT NULL;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO actor_ids FROM (
    SELECT actor id UNION ALL SELECT (n->'row'->>field)::UUID FROM JSONB_ARRAY_ELEMENTS(resources) n
      CROSS JOIN UNNEST(ARRAY['created_by','requested_by','received_by','changed_by','reversed_by','initiated_by','settled_by']) field
  ) ids WHERE id IS NOT NULL;
  WITH identities AS (
    SELECT n->'row' r FROM JSONB_ARRAY_ELEMENTS(resources) n
  ), typed AS (
    SELECT 'public.business_operations' relation_name,6 rank,'SHARE' mode,TO_JSONB(t) row_data FROM public.business_operations t
      WHERE id IN (SELECT (r->>'operation_id')::UUID FROM identities) UNION ALL
    SELECT 'public.cash_shifts',4,'UPDATE',TO_JSONB(t) FROM public.cash_shifts t WHERE id=ANY(shift_ids) UNION ALL
    SELECT 'public.profiles',7,'SHARE',TO_JSONB(t) FROM public.profiles t WHERE id=ANY(actor_ids) UNION ALL
    SELECT 'auth.users',7,'KEY_SHARE',JSONB_BUILD_OBJECT('id',t.id) FROM auth.users t WHERE id=ANY(actor_ids) UNION ALL
    SELECT 'public.customers',7,'SHARE',TO_JSONB(t) FROM public.customers t WHERE id IN (SELECT (r->>'customer_id')::UUID FROM identities) UNION ALL
    SELECT 'public.suppliers',6,'UPDATE',TO_JSONB(t) FROM public.suppliers t WHERE id IN (SELECT (r->>'supplier_id')::UUID FROM identities) UNION ALL
    SELECT 'public.products',5,CASE WHEN id=ANY(product_ids) THEN 'UPDATE' ELSE 'SHARE' END,TO_JSONB(t) FROM public.products t
      WHERE id=ANY(product_ids) OR id IN (SELECT (r->>'family_product_id')::UUID FROM identities) UNION ALL
    SELECT 'public.branches',7,'SHARE',TO_JSONB(t) FROM public.branches t WHERE id=s.branch_id
      OR id IN (SELECT branch_id FROM public.cash_shifts WHERE id=ANY(shift_ids))
      OR id IN (SELECT (r->>'branch_id')::UUID FROM identities) UNION ALL
    SELECT 'public.warehouses',7,'SHARE',TO_JSONB(t) FROM public.warehouses t WHERE id IN (SELECT (r->>'warehouse_id')::UUID FROM identities) UNION ALL
    SELECT 'public.customer_addresses',7,'SHARE',TO_JSONB(t) FROM public.customer_addresses t WHERE id IN (SELECT (r->>'address_id')::UUID FROM identities) UNION ALL
    SELECT 'public.product_parcel_configurations',7,'SHARE',TO_JSONB(t) FROM public.product_parcel_configurations t WHERE id IN (SELECT (r->>'parcel_configuration_id')::UUID FROM identities)
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',row_data->>'id',
    'row',row_data,'rank',rank,'mode',mode) ORDER BY rank,relation_name COLLATE "C",row_data->>'id' COLLATE "C"),'[]'::JSONB)
    INTO parents FROM typed;
  IF (SELECT COUNT(*) FROM public.cash_shifts WHERE id=ANY(shift_ids))<>CARDINALITY(shift_ids)
    OR (SELECT COUNT(*) FROM public.profiles WHERE id=ANY(actor_ids))<>CARDINALITY(actor_ids)
    OR (SELECT COUNT(*) FROM public.products WHERE id=ANY(product_ids))<>CARDINALITY(product_ids)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources||parents) n WHERE n->>'id' IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_RETAINED_RESOURCE_INCOMPLETE';
  END IF;
  side_effects:=phase5_private.discover_shift_inventory_side_effects_v1(actor,product_ids);
  resources:=resources||(side_effects->'resources');
  parents:=parents||(side_effects->'parents');
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-retained-resources-v1',
    'planState','RETAINED_RESOURCES_DISCOVERED_NOT_LOCKED','executionAuthority',FALSE,
    'completeFor','RETAINED_SOURCE_RESOURCE_SNAPSHOT_ONLY','actorId',actor,'shift',TO_JSONB(s),
    'sourceContext',seed,'supplierContexts',supplier_contexts,'resources',resources,'parents',parents,
    'inventorySideEffects',side_effects,'compositeResources',side_effects->'compositeResources',
    'rootGates',(SELECT COALESCE(JSONB_AGG('phase4-order|'||id::TEXT ORDER BY id),'[]'::JSONB) FROM UNNEST(order_ids) id),
    'sharedGates',(SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) FROM (
      SELECT 'cash-shift-full-reversal:'||id::TEXT g FROM UNNEST(shift_ids) id UNION
      SELECT 'pos-sale-reversal:'||id::TEXT FROM public.orders WHERE id=ANY(order_ids) AND source='pos' UNION
      SELECT 'supplier-payment-reversal:'||id::TEXT FROM public.supplier_payments WHERE cash_shift_id=shift_identity) gates),
    'inventoryGates',(SELECT COALESCE(JSONB_AGG('inventory-product:'||id::TEXT ORDER BY id),'[]'::JSONB) FROM UNNEST(product_ids) id),
    'actorRoles',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),'role',TO_JSONB(r)) ORDER BY ur.role_id),'[]'::JSONB)
      FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_RETAINED_RESOURCE_INCOMPLETE';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_shift_retained_resources_v1(UUID,UUID)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_shift_retained_resources_v1(UUID,UUID) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_retained_resources_unchanged_v1(actor UUID, shift_identity UUID, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_shift_retained_resources_v1(actor,shift_identity) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_RETAINED_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_retained_resources_unchanged_v1(UUID,UUID,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_retained_resources_unchanged_v1(UUID,UUID,JSONB) OWNER TO postgres;

-- Pure content/mode merge ONLY. Its input is not authority and cannot mint a
-- held-lock certificate. Canonical ranks are fixed here, never caller selected.
CREATE FUNCTION phase5_private.merge_shift_resource_snapshots_v1(rows_to_merge JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE candidate JSONB; result JSONB;
BEGIN
  IF JSONB_TYPEOF(rows_to_merge) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_MERGE_ROWS_REQUIRED';
  END IF;
  FOR candidate IN SELECT value FROM JSONB_ARRAY_ELEMENTS(rows_to_merge) LOOP
    IF JSONB_TYPEOF(candidate) IS DISTINCT FROM 'object'
      OR JSONB_TYPEOF(candidate->'row') IS DISTINCT FROM 'object'
      OR JSONB_TYPEOF(candidate->'relation') IS DISTINCT FROM 'string'
      OR JSONB_TYPEOF(candidate->'mode') IS DISTINCT FROM 'string'
      OR candidate->>'mode' NOT IN ('KEY_SHARE','SHARE','NO_KEY_UPDATE','UPDATE')
      OR candidate->>'relation' NOT IN (
        'auth.users','public.profiles','public.customers','public.branches','public.warehouses',
        'public.products','public.suppliers','public.customer_addresses','public.product_parcel_configurations',
        'public.cash_shifts','public.orders','public.order_items','public.order_parcel_instances',
        'public.order_parcel_components','public.order_inventory_reservations','public.order_status_history',
        'public.customer_payments','public.pos_sale_reversals','public.business_operations',
        'public.sales_returns','public.sales_return_events','public.sales_return_items',
        'public.sales_return_component_inspections','public.sales_replacement_events','public.sales_replacement_items',
        'public.sales_aftercare_consumptions','public.phase42_return_settlement_evidence','public.phase42_return_inventory_effects',
        'public.phase43_replacement_settlement_evidence','public.phase43_replacement_inventory_effects',
        'public.supplier_receipts','public.supplier_receipt_items','public.supplier_receipt_commercial_lines',
        'public.phase2_receipt_wac_snapshots','public.supplier_financial_invoice_identities',
        'public.purchase_receipts','public.purchase_receipt_items','public.purchase_receipt_commercial_lines',
        'public.purchase_orders','public.purchase_order_items','public.supplier_payments','public.supplier_payment_reversals',
        'public.operational_expenses','public.cash_shift_reversals','public.cash_shift_reversal_operations',
        'public.inventory_balances','public.inventory_movements','public.stock_alerts','public.automation_events',
        'phase5_private.financial_operation_events','phase5_private.collection_events','phase5_private.payment_reversal_events',
        'phase5_private.reversal_tender_movements','phase5_private.reversal_coordinator_completions',
        'phase5_private.collection_attempt_envelopes','phase5_private.mutation_contexts')
      OR JSONB_TYPEOF(candidate->'id') IS DISTINCT FROM 'string'
      OR candidate->>'id' IS DISTINCT FROM COALESCE(candidate->'row'->>'id',candidate->'row'->>'operation_id',candidate->'row'->>'financial_operation_id') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_MERGE_RESOURCE_INVALID';
    END IF;
    PERFORM phase5_private.wire_uuid_v1(candidate->'id');
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(rows_to_merge) n
    GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_MERGE_CONTENT_CHANGED_RETRY';
  END IF;
  WITH merged AS (
    SELECT n->>'relation' relation_name,n->>'id' identity,
      (JSONB_AGG(n->'row')->0) row_data,
      MAX(CASE n->>'mode' WHEN 'UPDATE' THEN 4 WHEN 'NO_KEY_UPDATE' THEN 3 WHEN 'SHARE' THEN 2 ELSE 1 END) strength
    FROM JSONB_ARRAY_ELEMENTS(rows_to_merge) n GROUP BY n->>'relation',n->>'id'
  ), ranked AS (
    SELECT *,CASE WHEN relation_name='public.cash_shifts' THEN 4
      WHEN relation_name IN ('public.orders','public.products','public.inventory_balances') THEN 5
      WHEN relation_name IN ('auth.users','public.profiles','public.customers','public.branches',
        'public.warehouses','public.customer_addresses','public.product_parcel_configurations') THEN 7 ELSE 6 END rank,
      CASE relation_name WHEN 'public.orders' THEN 0 WHEN 'public.products' THEN 1 WHEN 'public.inventory_balances' THEN 2
        WHEN 'public.supplier_receipts' THEN 0 WHEN 'public.purchase_receipts' THEN 1
        WHEN 'public.purchase_orders' THEN 2 WHEN 'public.suppliers' THEN 3 ELSE 10 END ordinal
    FROM merged
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',identity,'row',row_data,
      'rank',rank,'ordinal',ordinal,'mode',CASE strength WHEN 4 THEN 'UPDATE' WHEN 3 THEN 'NO_KEY_UPDATE' WHEN 2 THEN 'SHARE' ELSE 'KEY_SHARE' END)
      ORDER BY rank,ordinal,relation_name COLLATE "C",identity COLLATE "C"),'[]'::JSONB) INTO result FROM ranked;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.merge_shift_resource_snapshots_v1(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.merge_shift_resource_snapshots_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_shift_merged_resources_v1(actor UUID, shift_identity UUID, instructions JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE payments JSONB; retained JSONB; rows_to_merge JSONB; merged JSONB;
BEGIN
  -- Both authoritative discovery boundaries independently enforce actor/Owner/
  -- AAL2 before any business read. This path takes no generation or business lock.
  payments := phase5_private.discover_shift_payment_union_v1(actor,shift_identity,instructions);
  retained := phase5_private.discover_shift_retained_resources_v1(actor,shift_identity);
  IF payments->'sourcePlan'->'shift' IS DISTINCT FROM retained->'shift'
    OR payments->'sourcePlan'->'sourceContext' IS DISTINCT FROM retained->'sourceContext'
    OR payments->'actorRoles' IS DISTINCT FROM retained->'actorRoles' THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_MERGE_SOURCE_CHANGED_RETRY';
  END IF;
  rows_to_merge := (payments->'resources') || (payments->'parents') || (retained->'resources') || (retained->'parents');
  SELECT rows_to_merge || COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation','public.orders',
      'id',n->'row'->>'id','row',n->'row','mode',n->>'mode')),'[]'::JSONB)
    INTO rows_to_merge FROM JSONB_ARRAY_ELEMENTS(payments->'orders') n;
  SELECT rows_to_merge || COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation','public.cash_shifts',
      'id',n->'row'->>'id','row',n->'row','mode',n->>'mode')),'[]'::JSONB)
    INTO rows_to_merge FROM JSONB_ARRAY_ELEMENTS(payments->'shifts') n;
  merged := phase5_private.merge_shift_resource_snapshots_v1(rows_to_merge);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-merged-resources-v1',
    'planState','MERGED_SOURCE_RESOURCES_NOT_LOCKED','completeFor','MERGED_SOURCE_RESOURCES_ONLY',
    'executionAuthority',FALSE,'futureBatchChildIdentityComplete',FALSE,
    'actorId',actor,'shiftId',shift_identity,'paymentPlan',payments,'retainedPlan',retained,
    'compositeResources',retained->'compositeResources',
    'capacities',payments->'capacities','resources',merged,'actorRoles',payments->'actorRoles',
    'customerPaymentKeyGates',payments->'keyGates',
    'rootGates',(SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) FROM (
      SELECT value g FROM JSONB_ARRAY_ELEMENTS_TEXT(payments->'rootGates') UNION
      SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(retained->'rootGates')) gates),
    'sharedGates',(SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) FROM (
      SELECT value g FROM JSONB_ARRAY_ELEMENTS_TEXT(payments->'sharedGates') UNION
      SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(retained->'sharedGates')) gates),
    'inventoryGates',retained->'inventoryGates');
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_shift_merged_resources_v1(UUID,UUID,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_shift_merged_resources_v1(UUID,UUID,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_merged_resources_unchanged_v1(actor UUID, shift_identity UUID, instructions JSONB, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_shift_merged_resources_v1(actor,shift_identity,instructions) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_MERGED_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_merged_resources_unchanged_v1(UUID,UUID,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_merged_resources_unchanged_v1(UUID,UUID,JSONB,JSONB) OWNER TO postgres;

-- Source identities ONLY, not preview eligibility or an executable batch.
-- Retain already-reversed sources as facts; their later reuse/skip rules must
-- be validated by the exact existing primitive/evidence contract, never guessed.
CREATE FUNCTION phase5_private.derive_shift_batch_sources_v1(plan JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE result JSONB;
BEGIN
  IF plan->'planVersion' IS DISTINCT FROM '"phase5-shift-merged-resources-v1"'::JSONB
    OR plan->'executionAuthority' IS DISTINCT FROM 'false'::JSONB
    OR JSONB_TYPEOF(plan->'paymentPlan'->'sourcePlan'->'children') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(plan->'retainedPlan'->'resources') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_BATCH_SOURCE_PLAN_INVALID';
  END IF;
  WITH sources AS (
    SELECT 'customer_payment' kind,n->'payment'->>'id' identity,n->'payment'->>'order_id' root,
      n->'payment' row_data,n->'instruction' instruction FROM JSONB_ARRAY_ELEMENTS(plan->'paymentPlan'->'sourcePlan'->'children') n
    UNION ALL SELECT 'pos_sale',n->>'id',n->>'id',n->'row','null'::JSONB
      FROM JSONB_ARRAY_ELEMENTS(plan->'retainedPlan'->'resources') n
      WHERE n->>'relation'='public.orders' AND n->'row'->>'cash_shift_id'=plan->>'shiftId' AND n->'row'->>'source'='pos'
    UNION ALL SELECT 'supplier_payment',n->>'id',NULL,n->'row','null'::JSONB
      FROM JSONB_ARRAY_ELEMENTS(plan->'retainedPlan'->'resources') n
      WHERE n->>'relation'='public.supplier_payments' AND n->'row'->>'cash_shift_id'=plan->>'shiftId'
    UNION ALL SELECT 'operational_expense',n->>'id',NULL,n->'row','null'::JSONB
      FROM JSONB_ARRAY_ELEMENTS(plan->'retainedPlan'->'resources') n
      WHERE n->>'relation'='public.operational_expenses' AND n->'row'->>'shift_id'=plan->>'shiftId'
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('operationType',kind,'originalRecordId',identity,
      'orderId',root,'sourceRow',row_data,'instruction',instruction) ORDER BY kind COLLATE "C",identity COLLATE "C"),'[]'::JSONB)
    INTO result FROM sources;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(result) n
    GROUP BY n->>'operationType',n->>'originalRecordId' HAVING COUNT(*)<>1)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(result) n WHERE n->>'originalRecordId' IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_SOURCE_IDENTITY_INVALID';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_shift_batch_sources_v1(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_shift_batch_sources_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_batch_identity_v1(
  actor UUID, shift_identity UUID, reason TEXT, batch_key TEXT, instructions JSONB, expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE fresh JSONB; request JSONB; sources JSONB; child JSONB; all_ids UUID[]; key_name TEXT;
  keys JSONB; batch_id UUID; stripped JSONB;
BEGIN
  fresh := phase5_private.discover_shift_merged_resources_v1(actor,shift_identity,instructions);
  IF reason IS NULL OR reason IS DISTINCT FROM BTRIM(reason) OR CHAR_LENGTH(reason) NOT BETWEEN 3 AND 500
    OR batch_key IS NULL OR batch_key IS DISTINCT FROM BTRIM(batch_key) OR CHAR_LENGTH(batch_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_BATCH_REQUEST_INVALID';
  END IF;
  request := JSONB_BUILD_OBJECT('requestVersion','phase5-shift-batch-preparation-v1','actorId',actor,
    'shiftId',shift_identity,'reason',reason,'idempotencyKey',batch_key,
    'instructions',fresh->'paymentPlan'->'sourcePlan'->'instructions');
  PERFORM phase5_private.assert_wire_keys_v1(expected,ARRAY['planVersion','planState','completeFor',
    'executionAuthority','request','requestFingerprint','sourcePlan','batchId','children','keyGates']);
  IF expected->'planVersion' IS DISTINCT FROM '"phase5-shift-batch-identity-v1"'::JSONB
    OR expected->'planState' IS DISTINCT FROM '"PREALLOCATED_IDENTITIES_NOT_CLAIMED"'::JSONB
    OR expected->'completeFor' IS DISTINCT FROM '"BATCH_HEADER_CHILD_PRIMITIVE_IDENTITY_ONLY"'::JSONB
    OR expected->'executionAuthority' IS DISTINCT FROM 'false'::JSONB
    OR expected->'request' IS DISTINCT FROM request
    OR expected->>'requestFingerprint' IS DISTINCT FROM UPPER(public.phase3_request_fingerprint_internal(request))
    OR JSONB_TYPEOF(expected->'children') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_IDENTITY_INVALID';
  END IF;
  IF expected->'sourcePlan' IS DISTINCT FROM fresh THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_BATCH_SOURCE_CHANGED_RETRY';
  END IF;
  sources := phase5_private.derive_shift_batch_sources_v1(fresh);
  SELECT COALESCE(JSONB_AGG(n-'childId'-'auditId'-'primitiveId'-'financialOperationId'-'idempotencyKey'
    ORDER BY n->>'operationType' COLLATE "C",n->>'originalRecordId' COLLATE "C"),'[]'::JSONB)
    INTO stripped FROM JSONB_ARRAY_ELEMENTS(expected->'children') n;
  IF stripped IS DISTINCT FROM sources OR JSONB_ARRAY_LENGTH(expected->'children')<>JSONB_ARRAY_LENGTH(sources) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_CHILD_EXACT_SET_REQUIRED';
  END IF;
  batch_id := phase5_private.wire_uuid_v1(expected->'batchId'); all_ids := ARRAY[batch_id];
  FOR child IN SELECT value FROM JSONB_ARRAY_ELEMENTS(expected->'children') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(child,ARRAY['operationType','originalRecordId','orderId',
      'sourceRow','instruction','childId','auditId','primitiveId','financialOperationId','idempotencyKey']);
    all_ids := all_ids || phase5_private.wire_uuid_v1(child->'childId') || phase5_private.wire_uuid_v1(child->'auditId');
    key_name := CASE child->>'operationType'
      WHEN 'customer_payment' THEN child->'instruction'->>'idempotencyKey'
      WHEN 'pos_sale' THEN 'shift:'||batch_id::TEXT||':pos:'||(child->>'originalRecordId')
      WHEN 'supplier_payment' THEN 'shift:'||batch_id::TEXT||':supplier:'||(child->>'originalRecordId')
      ELSE NULL END;
    IF child->'idempotencyKey' IS DISTINCT FROM TO_JSONB(key_name)
      AND NOT (key_name IS NULL AND child->'idempotencyKey'='null'::JSONB) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_CHILD_KEY_INVALID';
    END IF;
    IF child->>'operationType'='operational_expense' THEN
      IF child->'primitiveId' IS DISTINCT FROM child->'auditId' OR child->'financialOperationId' IS DISTINCT FROM 'null'::JSONB THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_CHILD_ID_INVALID';
      END IF;
    ELSE
      all_ids := all_ids || phase5_private.wire_uuid_v1(child->'primitiveId');
      IF child->>'operationType'='customer_payment' THEN
        all_ids := all_ids || phase5_private.wire_uuid_v1(child->'financialOperationId');
      ELSIF child->'financialOperationId' IS DISTINCT FROM 'null'::JSONB THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_CHILD_ID_INVALID';
      END IF;
    END IF;
  END LOOP;
  IF CARDINALITY(all_ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(all_ids) id)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(fresh->'resources') n WHERE (n->>'id')::UUID=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.cash_shift_reversals WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.cash_shift_reversal_operations WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.pos_sale_reversals WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.supplier_payment_reversals WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM public.business_operations WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM phase5_private.payment_reversal_events WHERE id=ANY(all_ids))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(all_ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_BATCH_FUTURE_ID_ALREADY_OWNED';
  END IF;
  -- Unique source keys are checked before gate planning; no duplicate key can
  -- silently collapse in a UNION and mask a distinct business child.
  IF EXISTS(SELECT 1 FROM (SELECT batch_key k UNION ALL SELECT n->>'idempotencyKey'
      FROM JSONB_ARRAY_ELEMENTS(expected->'children') n WHERE n->'idempotencyKey'<>'null'::JSONB) raw_keys
    GROUP BY k HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_BATCH_DUPLICATE_KEY';
  END IF;
  FOR key_name IN SELECT batch_key UNION ALL SELECT n->>'idempotencyKey'
    FROM JSONB_ARRAY_ELEMENTS(expected->'children') n WHERE n->'idempotencyKey'<>'null'::JSONB LOOP
    IF EXISTS(SELECT 1 FROM public.cash_shift_reversals WHERE requested_by=actor AND idempotency_key=key_name)
      OR EXISTS(SELECT 1 FROM public.pos_sale_reversals WHERE requested_by=actor AND idempotency_key=key_name)
      OR EXISTS(SELECT 1 FROM public.supplier_payment_reversals WHERE requested_by=actor AND idempotency_key=key_name)
      OR EXISTS(SELECT 1 FROM public.customer_payments WHERE created_by=actor AND idempotency_key=key_name)
      OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE actor_scope_id=actor AND idempotency_key=key_name)
      OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes WHERE actor_id=actor AND idempotency_key=key_name) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_BATCH_KEY_ALREADY_OWNED';
    END IF;
  END LOOP;
  SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) INTO keys FROM (
    SELECT value g FROM JSONB_ARRAY_ELEMENTS_TEXT(fresh->'customerPaymentKeyGates') UNION
    SELECT actor::TEXT||':'||batch_key UNION
    SELECT 'phase5-idempotency|erp_user|'||actor::TEXT||'|cash_shift_reversal_v2|'||batch_key UNION
    SELECT actor::TEXT||':'||(n->>'idempotencyKey') FROM JSONB_ARRAY_ELEMENTS(expected->'children') n
      WHERE n->'idempotencyKey'<>'null'::JSONB) key_set;
  IF expected->'keyGates' IS DISTINCT FROM keys THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_BATCH_KEY_DOMAIN_INVALID';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_batch_identity_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_batch_identity_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_shift_batch_identity_v1(
  actor UUID, shift_identity UUID, reason TEXT, batch_key TEXT, instructions JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; request JSONB; batch_id UUID; source JSONB; audit_id UUID;
  children JSONB := '[]'::JSONB; keys JSONB; result JSONB;
BEGIN
  plan := phase5_private.discover_shift_merged_resources_v1(actor,shift_identity,instructions);
  batch_id := gen_random_uuid();
  request := JSONB_BUILD_OBJECT('requestVersion','phase5-shift-batch-preparation-v1','actorId',actor,
    'shiftId',shift_identity,'reason',reason,'idempotencyKey',batch_key,
    'instructions',plan->'paymentPlan'->'sourcePlan'->'instructions');
  FOR source IN SELECT value FROM JSONB_ARRAY_ELEMENTS(phase5_private.derive_shift_batch_sources_v1(plan)) LOOP
    audit_id := gen_random_uuid();
    children := children || JSONB_BUILD_ARRAY(source || JSONB_BUILD_OBJECT(
      'childId',gen_random_uuid(),'auditId',audit_id,
      'primitiveId',CASE WHEN source->>'operationType'='operational_expense' THEN audit_id ELSE gen_random_uuid() END,
      'financialOperationId',CASE WHEN source->>'operationType'='customer_payment' THEN gen_random_uuid() ELSE NULL::UUID END,
      'idempotencyKey',CASE source->>'operationType'
        WHEN 'customer_payment' THEN source->'instruction'->>'idempotencyKey'
        WHEN 'pos_sale' THEN 'shift:'||batch_id::TEXT||':pos:'||(source->>'originalRecordId')
        WHEN 'supplier_payment' THEN 'shift:'||batch_id::TEXT||':supplier:'||(source->>'originalRecordId') ELSE NULL END));
  END LOOP;
  SELECT COALESCE(JSONB_AGG(g ORDER BY g COLLATE "C"),'[]'::JSONB) INTO keys FROM (
    SELECT value g FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'customerPaymentKeyGates') UNION
    SELECT actor::TEXT||':'||batch_key UNION
    SELECT 'phase5-idempotency|erp_user|'||actor::TEXT||'|cash_shift_reversal_v2|'||batch_key UNION
    SELECT actor::TEXT||':'||(n->>'idempotencyKey') FROM JSONB_ARRAY_ELEMENTS(children) n
      WHERE n->'idempotencyKey'<>'null'::JSONB) key_set;
  result := JSONB_BUILD_OBJECT('planVersion','phase5-shift-batch-identity-v1',
    'planState','PREALLOCATED_IDENTITIES_NOT_CLAIMED','completeFor','BATCH_HEADER_CHILD_PRIMITIVE_IDENTITY_ONLY',
    'executionAuthority',FALSE,'request',request,'requestFingerprint',UPPER(public.phase3_request_fingerprint_internal(request)),
    'sourcePlan',plan,'batchId',batch_id,'children',children,'keyGates',keys);
  PERFORM phase5_private.assert_shift_batch_identity_v1(actor,shift_identity,reason,batch_key,instructions,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.allocate_shift_batch_identity_v1(UUID,UUID,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_shift_batch_identity_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Planned insert FK coverage, not writable tuples, locks, eligibility or a
-- transaction permit. The authorized wrapper rediscoveries are mandatory.
CREATE FUNCTION phase5_private.shift_pos_inventory_identities_v1(identity_plan JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE result JSONB;
BEGIN
  IF identity_plan->'planVersion' IS DISTINCT FROM '"phase5-shift-batch-identity-v1"'::JSONB
    OR JSONB_TYPEOF(identity_plan->'children') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_MANIFEST_IDENTITY_REQUIRED';
  END IF;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('orderId',o.id,'orderItemId',r.order_item_id,
    'parcelComponentId',r.parcel_component_id,'productId',r.product_id,'baseQuantity',r.base_quantity,
    'operationId',r.operation_id,'warehouseId',o.warehouse_id,'primitiveId',n->'primitiveId',
    'itemSnapshot',TO_JSONB(i),'componentSnapshot',TO_JSONB(c))
    ORDER BY o.id,r.product_id,r.parcel_component_id NULLS FIRST,r.order_item_id),'[]'::JSONB)
    INTO result FROM JSONB_ARRAY_ELEMENTS(identity_plan->'children') n
    JOIN public.orders o ON o.id=(n->>'originalRecordId')::UUID
    CROSS JOIN LATERAL public.phase3_pos_reversal_inventory_rows_internal(o.id) r
    JOIN public.order_items i ON i.id=r.order_item_id AND i.order_id=o.id
    LEFT JOIN public.order_parcel_components c ON c.id=r.parcel_component_id
    WHERE n->>'operationType'='pos_sale';
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(result) n WHERE
      n->>'warehouseId' IS NULL OR n->>'productId' IS NULL OR (n->>'baseQuantity')::INTEGER<=0)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(result) n
      GROUP BY n->>'orderId',n->>'orderItemId',n->>'parcelComponentId' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_INVENTORY_IDENTITY_INVALID';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.shift_pos_inventory_identities_v1(JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.shift_pos_inventory_identities_v1(JSONB) OWNER TO postgres;

-- Catalog-driven FK-column discovery with NO dynamic SQL. All candidates are
-- frozen typed resources or explicitly planned future parents. A new/uncovered
-- FK column, partial MATCH FULL tuple or non-bijective parent aborts. This is
-- direct planned-insert coverage, not transitive trigger/source-write closure.
CREATE FUNCTION phase5_private.shift_insert_fk_coverage_v1(planned_rows JSONB,existing_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE n JSONB; fk RECORD; a RECORD; source_tuple JSONB; parent_tuple JSONB;
  parents JSONB; found_parent JSONB; matches INTEGER; nulls INTEGER; edges JSONB:='[]'::JSONB;
BEGIN
  IF JSONB_TYPEOF(planned_rows) IS DISTINCT FROM 'array' OR JSONB_TYPEOF(existing_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_FK_ROWS_REQUIRED';
  END IF;
  parents:=existing_rows||planned_rows;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(planned_rows) LOOP
    IF TO_REGCLASS(n->>'relation') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_FK_RELATION_MISSING';
    END IF;
    FOR fk IN SELECT c.*,pn.nspname||'.'||p.relname parent_name
      FROM pg_constraint c JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
      WHERE c.contype='f' AND c.conrelid=TO_REGCLASS(n->>'relation') ORDER BY c.conname LOOP
      source_tuple:='{}'::JSONB; parent_tuple:='{}'::JSONB; nulls:=0;
      FOR a IN SELECT sa.attname source_column,pa.attname parent_column
        FROM UNNEST(fk.conkey,fk.confkey) k(source_attribute,parent_attribute)
        JOIN pg_attribute sa ON sa.attrelid=fk.conrelid AND sa.attnum=k.source_attribute
        JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=k.parent_attribute LOOP
        IF NOT (n->'row' ? a.source_column) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_FK_COLUMN_UNPLANNED';
        END IF;
        source_tuple:=source_tuple||JSONB_BUILD_OBJECT(a.source_column,n->'row'->a.source_column);
        parent_tuple:=parent_tuple||JSONB_BUILD_OBJECT(a.parent_column,n->'row'->a.source_column);
        IF n->'row'->a.source_column='null'::JSONB THEN nulls:=nulls+1; END IF;
      END LOOP;
      IF fk.confmatchtype='f' AND nulls>0 AND nulls<CARDINALITY(fk.conkey) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_FK_PARTIAL_NULL_INVALID';
      END IF;
      found_parent:=NULL;
      IF nulls=0 THEN
        SELECT COUNT(*),(JSONB_AGG(p)->0) INTO matches,found_parent FROM JSONB_ARRAY_ELEMENTS(parents) p
          WHERE p->>'relation'=fk.parent_name AND p->'row' @> parent_tuple;
        IF matches<>1 THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_FK_PARENT_NOT_EXACTLY_ONE';
        END IF;
      END IF;
      edges:=edges||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',n->'relation','id',n->'id',
        'constraint',fk.conname,'parentRelation',fk.parent_name,'sourceTuple',source_tuple,'parentTuple',parent_tuple,
        'parentId',found_parent->'id','parentState',CASE WHEN nulls>0 THEN 'NOT_APPLICABLE'
          WHEN EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(planned_rows) p WHERE p=found_parent) THEN 'FUTURE_NOT_CLAIMED' ELSE 'EXISTING_NOT_LOCKED' END,
        'match',fk.confmatchtype,'deferrable',fk.condeferrable,'initiallyDeferred',fk.condeferred,
        'onUpdate',fk.confupdtype,'onDelete',fk.confdeltype));
    END LOOP;
  END LOOP;
  RETURN (SELECT COALESCE(JSONB_AGG(e ORDER BY e->>'relation' COLLATE "C",e->>'id' COLLATE "C",e->>'constraint' COLLATE "C"),'[]'::JSONB)
    FROM JSONB_ARRAY_ELEMENTS(edges) e);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.shift_insert_fk_coverage_v1(JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.shift_insert_fk_coverage_v1(JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.complete_shift_batch_manifest_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,identity_plan JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE inventory JSONB; stripped JSONB; histories JSONB; child JSONB; item_row JSONB; op JSONB; event_slot JSONB;
  rows_to_insert JSONB; resources JSONB; ids UUID[]; fk_edges JSONB;
BEGIN
  PERFORM phase5_private.assert_shift_batch_identity_v1(actor,shift_identity,reason,batch_key,instructions,identity_plan);
  PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['batchAuditId','inventory','histories']);
  IF JSONB_TYPEOF(allocation->'inventory') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(allocation->'histories') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_MANIFEST_ALLOCATION_INVALID';
  END IF;
  inventory:=phase5_private.shift_pos_inventory_identities_v1(identity_plan);
  SELECT COALESCE(JSONB_AGG(n-'movementId' ORDER BY n->>'orderId',n->>'productId',n->>'parcelComponentId' NULLS FIRST,n->>'orderItemId'),'[]'::JSONB)
    INTO stripped FROM JSONB_ARRAY_ELEMENTS(allocation->'inventory') n;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('orderId',n->'originalRecordId') ORDER BY n->>'originalRecordId'),'[]'::JSONB)
    INTO histories FROM JSONB_ARRAY_ELEMENTS(identity_plan->'children') n WHERE n->>'operationType'='pos_sale';
  IF stripped IS DISTINCT FROM inventory OR histories IS DISTINCT FROM
    (SELECT COALESCE(JSONB_AGG(n-'historyId' ORDER BY n->>'orderId'),'[]'::JSONB) FROM JSONB_ARRAY_ELEMENTS(allocation->'histories') n) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_MANIFEST_PER_ITEM_EXACT_SET_REQUIRED';
  END IF;
  resources:=identity_plan->'sourcePlan'->'resources';
  ids:=ARRAY[phase5_private.wire_uuid_v1(allocation->'batchAuditId'),phase5_private.wire_uuid_v1(identity_plan->'batchId')];
  FOR child IN SELECT value FROM JSONB_ARRAY_ELEMENTS(identity_plan->'children') LOOP
    ids:=ids||phase5_private.wire_uuid_v1(child->'childId')||phase5_private.wire_uuid_v1(child->'auditId');
    IF child->>'operationType'<>'operational_expense' THEN ids:=ids||phase5_private.wire_uuid_v1(child->'primitiveId'); END IF;
    IF child->>'operationType'='customer_payment' THEN ids:=ids||phase5_private.wire_uuid_v1(child->'financialOperationId'); END IF;
  END LOOP;
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'inventory') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(item_row,ARRAY['orderId','orderItemId','parcelComponentId','productId',
      'baseQuantity','operationId','warehouseId','primitiveId','itemSnapshot','componentSnapshot','movementId']);
    ids:=ids||phase5_private.wire_uuid_v1(item_row->'movementId');
  END LOOP;
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'histories') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(item_row,ARRAY['orderId','historyId']); ids:=ids||phase5_private.wire_uuid_v1(item_row->'historyId');
  END LOOP;
  IF CARDINALITY(ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(ids) id)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE (n->>'id')::UUID=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.order_status_history WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.cash_shift_reversals WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.cash_shift_reversal_operations WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.pos_sale_reversals WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.supplier_payment_reversals WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.payment_reversal_events WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_MANIFEST_FUTURE_ID_ALREADY_OWNED';
  END IF;
  rows_to_insert:=JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT('relation','public.cash_shift_reversals','id',identity_plan->'batchId','row',
      JSONB_BUILD_OBJECT('id',identity_plan->'batchId','shift_id',shift_identity,'requested_by',actor)),
    JSONB_BUILD_OBJECT('relation','public.audit_logs','id',allocation->'batchAuditId','row',
      JSONB_BUILD_OBJECT('id',allocation->'batchAuditId','user_id',actor)));
  FOR child IN SELECT value FROM JSONB_ARRAY_ELEMENTS(identity_plan->'children') LOOP
    rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','public.cash_shift_reversal_operations','id',child->'childId','row',
        JSONB_BUILD_OBJECT('id',child->'childId','reversal_id',identity_plan->'batchId','shift_id',shift_identity)),
      JSONB_BUILD_OBJECT('relation','public.audit_logs','id',child->'auditId','row',JSONB_BUILD_OBJECT('id',child->'auditId','user_id',actor)));
    CASE child->>'operationType'
    WHEN 'pos_sale' THEN rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'relation','public.pos_sale_reversals','id',child->'primitiveId','row',JSONB_BUILD_OBJECT('id',child->'primitiveId',
        'order_id',child->'orderId','cash_shift_id',shift_identity,'requested_by',actor)));
    WHEN 'supplier_payment' THEN rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'relation','public.supplier_payment_reversals','id',child->'primitiveId','row',JSONB_BUILD_OBJECT('id',child->'primitiveId',
        'supplier_payment_id',child->'originalRecordId','cash_shift_id',shift_identity,'requested_by',actor)));
    WHEN 'customer_payment' THEN
      -- One symbolic server event slot binds the composite future FK. No event
      -- timestamp is chosen before locks and these partial rows cannot be DML.
      event_slot:=JSONB_BUILD_OBJECT('serverPostLockEventSlot',child->'financialOperationId');
      op:=JSONB_BUILD_OBJECT('id',child->'financialOperationId','actor_scope_id',actor,
        'operation_type','customer_payment_reversal_v1','operation_event_at',event_slot);
      rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT('relation','phase5_private.financial_operation_events','id',child->'financialOperationId','row',op),
        JSONB_BUILD_OBJECT('relation','phase5_private.payment_reversal_events','id',child->'primitiveId','row',
          JSONB_BUILD_OBJECT('id',child->'primitiveId','financial_operation_id',child->'financialOperationId',
            'operation_type','customer_payment_reversal_v1','operation_event_at',event_slot,
            'original_collection_event_id',child->'instruction'->'originalCollectionId','original_payment_id',child->'originalRecordId',
            'order_id',child->'orderId','customer_id',child->'sourceRow'->'customer_id',
            'reversed_amount_in_minor_units',child->'sourceRow'->'amount_in_minor_units','cash_shift_id',child->'instruction'->'executionShiftId')),
        JSONB_BUILD_OBJECT('relation','phase5_private.reversal_tender_movements','id',child->'financialOperationId','row',
          JSONB_BUILD_OBJECT('operation_id',child->'financialOperationId','reversal_event_id',child->'primitiveId',
            'original_payment_id',child->'originalRecordId','order_id',child->'orderId','customer_id',child->'sourceRow'->'customer_id',
            'actor_id',actor,'actual_cash_shift_id',child->'instruction'->'executionShiftId')),
        JSONB_BUILD_OBJECT('relation','phase5_private.reversal_coordinator_completions','id',child->'financialOperationId',
          'row',JSONB_BUILD_OBJECT('operation_id',child->'financialOperationId')));
    ELSE NULL;
    END CASE;
  END LOOP;
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'inventory') LOOP
    rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.inventory_movements','id',item_row->'movementId',
      'row',JSONB_BUILD_OBJECT('id',item_row->'movementId','warehouse_id',item_row->'warehouseId','product_id',item_row->'productId',
        'created_by',actor,'operation_id',item_row->'operationId','parcel_component_id',item_row->'parcelComponentId','reservation_id',NULL,
        'supplier_receipt_item_id',NULL,'purchase_receipt_item_id',NULL,'reversed_movement_id',NULL)));
  END LOOP;
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'histories') LOOP
    rows_to_insert:=rows_to_insert||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.order_status_history','id',item_row->'historyId',
      'row',JSONB_BUILD_OBJECT('id',item_row->'historyId','order_id',item_row->'orderId','changed_by',actor)));
  END LOOP;
  fk_edges:=phase5_private.shift_insert_fk_coverage_v1(rows_to_insert,resources);
  RETURN JSONB_BUILD_OBJECT('manifestVersion','phase5-shift-planned-insert-manifest-v1',
    'manifestState','PLANNED_INSERT_FKS_NOT_LOCKED','completeFor','PLANNED_INSERT_FK_AND_POS_INVENTORY_ONLY',
    'executionAuthority',FALSE,'transactionContextComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE,
    'identityPlan',identity_plan,'allocation',allocation,'existingResources',resources,
    'plannedInsertFkRows',rows_to_insert,'foreignKeys',fk_edges);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.complete_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.complete_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_shift_batch_manifest_v1(actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE identity_plan JSONB; allocation JSONB;
BEGIN
  identity_plan:=phase5_private.allocate_shift_batch_identity_v1(actor,shift_identity,reason,batch_key,instructions);
  allocation:=JSONB_BUILD_OBJECT('batchAuditId',gen_random_uuid(),
    'inventory',(SELECT COALESCE(JSONB_AGG(n||JSONB_BUILD_OBJECT('movementId',gen_random_uuid())
      ORDER BY n->>'orderId',n->>'productId',n->>'parcelComponentId' NULLS FIRST,n->>'orderItemId'),'[]'::JSONB)
      FROM JSONB_ARRAY_ELEMENTS(phase5_private.shift_pos_inventory_identities_v1(identity_plan)) n),
    'histories',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('orderId',n->'originalRecordId','historyId',gen_random_uuid())
      ORDER BY n->>'originalRecordId'),'[]'::JSONB) FROM JSONB_ARRAY_ELEMENTS(identity_plan->'children') n WHERE n->>'operationType'='pos_sale'));
  RETURN phase5_private.complete_shift_batch_manifest_v1(actor,shift_identity,reason,batch_key,instructions,identity_plan,allocation);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.allocate_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_batch_manifest_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.complete_shift_batch_manifest_v1(
      actor,shift_identity,reason,batch_key,instructions,expected->'identityPlan',expected->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_MANIFEST_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_batch_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Typed private context planning only. A symbolic post-lock txid is NOT a
-- transaction permit. No context is inserted, no gate is acquired, and the
-- preparation barrier remains installed. Full source/trigger closure and an
-- actual held-plan certificate are required before any future context writer.
CREATE FUNCTION phase5_private.complete_shift_context_plan_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,
  manifest JSONB,context_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE batch_context UUID; identities UUID[]; child JSONB; allocation_row JSONB;
  rows_to_insert JSONB; context_rows JSONB; child_request JSONB; child_context UUID;
  stripped JSONB; expected_children JSONB; transaction_slot JSONB; manifest_fingerprint TEXT;
BEGIN
  PERFORM phase5_private.assert_shift_batch_manifest_v1(actor,shift_identity,reason,batch_key,instructions,manifest);
  PERFORM phase5_private.assert_wire_keys_v1(context_allocation,ARRAY['batchContextId','children']);
  batch_context:=phase5_private.wire_uuid_v1(context_allocation->'batchContextId');
  IF JSONB_TYPEOF(context_allocation->'children') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_CONTEXT_ALLOCATION_INVALID';
  END IF;
  SELECT COALESCE(JSONB_AGG(n-'contextId' ORDER BY n->>'childId'),'[]'::JSONB)
    INTO stripped FROM JSONB_ARRAY_ELEMENTS(context_allocation->'children') n;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('childId',n->'childId') ORDER BY n->>'childId'),'[]'::JSONB)
    INTO expected_children FROM JSONB_ARRAY_ELEMENTS(manifest->'identityPlan'->'children') n;
  IF stripped IS DISTINCT FROM expected_children THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_CONTEXT_CHILD_EXACT_SET_REQUIRED';
  END IF;
  identities:=ARRAY[batch_context];
  FOR allocation_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(context_allocation->'children') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(allocation_row,ARRAY['childId','contextId']);
    identities:=identities||phase5_private.wire_uuid_v1(allocation_row->'contextId');
  END LOOP;
  IF CARDINALITY(identities)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(identities) id)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(manifest->'existingResources') n WHERE (n->>'id')::UUID=ANY(identities))
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(manifest->'plannedInsertFkRows') n WHERE (n->>'id')::UUID=ANY(identities))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(identities)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SHIFT_CONTEXT_ID_ALREADY_OWNED';
  END IF;
  transaction_slot:=JSONB_BUILD_OBJECT('serverPostLockTransactionSlot',context_allocation->'batchContextId');
  manifest_fingerprint:=UPPER(public.phase3_request_fingerprint_internal(manifest));
  context_rows:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts',
    'id',batch_context,'row',JSONB_BUILD_OBJECT('id',batch_context,'transaction_id',transaction_slot,
      'generation',1,'actor_id',actor,'order_id',NULL,'shift_id',shift_identity,
      'shift_source_kind','BATCH','shift_source_id',shift_identity,
      'parent_context_id',NULL,'parent_context_kind',NULL,'purpose','SHIFT_REVERSAL',
      'operation_id',manifest->'identityPlan'->'batchId','normalized_request',manifest->'identityPlan'->'request',
      'request_fingerprint',manifest->'identityPlan'->'requestFingerprint','locked_plan',
      JSONB_BUILD_OBJECT('planState','PLANNED_CONTEXT_NOT_LOCKED','manifestFingerprint',manifest_fingerprint))));
  FOR child IN SELECT value FROM JSONB_ARRAY_ELEMENTS(manifest->'identityPlan'->'children') LOOP
    SELECT phase5_private.wire_uuid_v1(n->'contextId') INTO STRICT child_context
      FROM JSONB_ARRAY_ELEMENTS(context_allocation->'children') n WHERE n->'childId'=child->'childId';
    child_request:=JSONB_BUILD_OBJECT('requestVersion','phase5-shift-child-context-preparation-v1',
      'batchRequestFingerprint',manifest->'identityPlan'->'requestFingerprint',
      'actorId',actor,'shiftId',shift_identity,'batchId',manifest->'identityPlan'->'batchId',
      'childIdentity',child);
    context_rows:=context_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts',
      'id',child_context,'row',JSONB_BUILD_OBJECT('id',child_context,'transaction_id',transaction_slot,
        'generation',1,'actor_id',actor,'order_id',child->'orderId','shift_id',shift_identity,
        'shift_source_kind',child->'operationType','shift_source_id',child->'originalRecordId',
        'parent_context_id',batch_context,'parent_context_kind','BATCH','purpose','SHIFT_REVERSAL',
        'operation_id',CASE WHEN child->>'operationType'='customer_payment' THEN child->'financialOperationId'
          ELSE child->'primitiveId' END,'normalized_request',child_request,
        'request_fingerprint',UPPER(public.phase3_request_fingerprint_internal(child_request)),
        'locked_plan',JSONB_BUILD_OBJECT('planState','PLANNED_CONTEXT_NOT_LOCKED',
          'manifestFingerprint',manifest_fingerprint,'batchContextId',batch_context,'childId',child->'childId'))));
  END LOOP;
  rows_to_insert:=manifest->'plannedInsertFkRows'||context_rows;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-typed-context-plan-v1',
    'planState','PLANNED_CONTEXT_NOT_LOCKED','completeFor','TYPED_CONTEXT_IDENTITIES_AND_DIRECT_FKS_ONLY',
    'executionAuthority',FALSE,'heldPlanComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE,
    'manifest',manifest,'contextAllocation',context_allocation,'contextRows',context_rows,
    'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(rows_to_insert,manifest->'existingResources'));
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.complete_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.complete_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_shift_context_plan_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE manifest JSONB; allocation JSONB;
BEGIN
  manifest:=phase5_private.allocate_shift_batch_manifest_v1(actor,shift_identity,reason,batch_key,instructions);
  allocation:=JSONB_BUILD_OBJECT('batchContextId',gen_random_uuid(),'children',
    (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('childId',n->'childId','contextId',gen_random_uuid())
      ORDER BY n->>'childId'),'[]'::JSONB) FROM JSONB_ARRAY_ELEMENTS(manifest->'identityPlan'->'children') n));
  RETURN phase5_private.complete_shift_context_plan_v1(actor,shift_identity,reason,batch_key,instructions,manifest,allocation);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.allocate_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_context_plan_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.complete_shift_context_plan_v1(actor,shift_identity,reason,batch_key,
    instructions,expected->'manifest',expected->'contextAllocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_CONTEXT_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_context_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Owner-approved source-resource overlay: the unchanged014/057/099/113
-- inventory trigger graph is part of the retained POS write domain. These
-- readers mint neither new identities nor mutation/held-lock authority.
CREATE FUNCTION phase5_private.shift_inventory_side_effect_catalog_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE f RECORD; trigger_row RECORD; targets JSONB; actual JSONB; functions JSONB:='[]'::JSONB;
  triggers JSONB:='[]'::JSONB; foreign_keys JSONB; sequence_config JSONB; index_config JSONB;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.sync_stock_alert(uuid,uuid,integer,integer)','a6c71821c26518be874069ac77851c5746da5d2a06958f2fb8af5f86ded44349'),
    ('public.sync_stock_alert_from_balance()','1a8dbe0a4efcf8c4b4c4d15ffbb538ec8269d39fbdde77028e20bf4b4d2533f8'),
    ('public.enqueue_stock_automation_event()','28c3c013ce15c67c7153d485d5e2e881190922d02f90b1c5728a7b324cd17bce'),
    ('public.enqueue_automation_event(text,text,uuid,jsonb)','aa6901afb1a82502e263ce3ed700fa5938ed107239d64029cf32cc1a673dd3f2'),
    ('public.assign_inventory_movement_mutation_sequence()','5417c3ed893b48c98c67a33e9d66c475437746a778427c367ca7aa87fc9d68d6')
  ) expected(signature,definition_sha256) ORDER BY signature COLLATE "C" LOOP
    IF TO_REGPROCEDURE(f.signature) IS NULL OR
      ENCODE(extensions.digest(PG_GET_FUNCTIONDEF(TO_REGPROCEDURE(f.signature)),'sha256'),'hex') IS DISTINCT FROM f.definition_sha256 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_FUNCTION_DRIFT';
    END IF;
    functions:=functions||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('signature',f.signature,'sha256',f.definition_sha256));
  END LOOP;
  -- Include unchanged validation/timestamp bindings too: an extra trigger is
  -- never assumed harmless. Their policy remains outside this narrow overlay.
  targets:='[
    ["public.inventory_balances","trg_inventory_balances_reject_flavor_master","public.reject_flavor_master_inventory_mutation()",23,[]],
    ["public.inventory_balances","trg_sync_stock_alert_from_balance","public.sync_stock_alert_from_balance()",21,["on_hand_quantity","reserved_quantity"]],
    ["public.inventory_balances","trg_update_inventory_balances_updated_at","public.update_updated_at_column()",19,[]],
    ["public.inventory_movements","trg_assign_inventory_movement_mutation_sequence","public.assign_inventory_movement_mutation_sequence()",7,[]],
    ["public.inventory_movements","trg_inventory_movements_reject_flavor_master","public.reject_flavor_master_inventory_mutation()",23,[]],
    ["public.inventory_movements","trg_validate_inventory_movement_source_chain","public.validate_inventory_movement_source_chain()",23,["operation_id","parcel_component_id","product_id","reservation_id","warehouse_id"]],
    ["public.inventory_movements","trg_validate_phase2_inventory_movement_source","public.validate_phase2_inventory_movement_source()",23,["operation_id","product_id","purchase_receipt_item_id","reference_id","reference_type","supplier_receipt_item_id"]],
    ["public.stock_alerts","trg_enqueue_stock_automation_event","public.enqueue_stock_automation_event()",21,["severity","status"]]
  ]'::JSONB;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_ARRAY(n.nspname||'.'||c.relname,t.tgname,
    pn.nspname||'.'||p.proname||'('||PG_GET_FUNCTION_IDENTITY_ARGUMENTS(p.oid)||')',t.tgtype,
    (SELECT COALESCE(JSONB_AGG(a.attname ORDER BY a.attname COLLATE "C"),'[]'::JSONB)
      FROM UNNEST(t.tgattr::SMALLINT[]) k JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=k))
    ORDER BY n.nspname||'.'||c.relname COLLATE "C",t.tgname COLLATE "C"),'[]'::JSONB) INTO actual
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.inventory_balances'::REGCLASS,'public.inventory_movements'::REGCLASS,
      'public.stock_alerts'::REGCLASS,'public.stock_alert_reads'::REGCLASS,'public.automation_events'::REGCLASS);
  IF actual IS DISTINCT FROM targets OR EXISTS(SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
      AND t.tgrelid IN ('public.inventory_balances'::REGCLASS,'public.inventory_movements'::REGCLASS,
        'public.stock_alerts'::REGCLASS,'public.stock_alert_reads'::REGCLASS,'public.automation_events'::REGCLASS)
      AND (t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR OCTET_LENGTH(t.tgargs)<>0 OR t.tgconstraint<>0)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_TRIGGER_DRIFT';
  END IF;
  FOR trigger_row IN SELECT oid FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (
    'public.inventory_balances'::REGCLASS,'public.inventory_movements'::REGCLASS,'public.stock_alerts'::REGCLASS)
    ORDER BY tgrelid::TEXT COLLATE "C",tgname COLLATE "C" LOOP
    triggers:=triggers||JSONB_BUILD_ARRAY(PG_GET_TRIGGERDEF(trigger_row.oid));
  END LOOP;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',n.nspname||'.'||r.relname,'name',c.conname,
    'definition',PG_GET_CONSTRAINTDEF(c.oid),'validated',c.convalidated)
    ORDER BY n.nspname||'.'||r.relname COLLATE "C",c.conname COLLATE "C"),'[]'::JSONB) INTO foreign_keys
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='f' AND c.conrelid IN ('public.stock_alerts'::REGCLASS,'public.stock_alert_reads'::REGCLASS);
  IF foreign_keys IS DISTINCT FROM '[
    {"relation":"public.stock_alert_reads","name":"stock_alert_reads_stock_alert_id_fkey","definition":"FOREIGN KEY (stock_alert_id) REFERENCES public.stock_alerts(id) ON DELETE CASCADE","validated":true},
    {"relation":"public.stock_alert_reads","name":"stock_alert_reads_user_id_fkey","definition":"FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE","validated":true},
    {"relation":"public.stock_alerts","name":"stock_alerts_product_id_fkey","definition":"FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE","validated":true},
    {"relation":"public.stock_alerts","name":"stock_alerts_warehouse_id_fkey","definition":"FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE","validated":true}
  ]'::JSONB THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_FK_DRIFT'; END IF;
  SELECT JSONB_BUILD_OBJECT('relation','public.inventory_movement_mutation_seq','kind',c.relkind,'owner',r.rolname,
    'type',s.seqtypid::REGTYPE::TEXT,'start',s.seqstart,'increment',s.seqincrement,'minimum',s.seqmin,
    'maximum',s.seqmax::TEXT,'cache',s.seqcache,'cycle',s.seqcycle) INTO sequence_config
    FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_roles r ON r.oid=c.relowner
    WHERE s.seqrelid=TO_REGCLASS('public.inventory_movement_mutation_seq');
  IF sequence_config IS DISTINCT FROM '{"relation":"public.inventory_movement_mutation_seq","kind":"S","owner":"postgres",
    "type":"bigint","start":1,"increment":1,"minimum":1,"maximum":"9223372036854775807","cache":1,"cycle":false}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_SEQUENCE_DRIFT';
  END IF;
  SELECT JSONB_BUILD_OBJECT('unique',i.indisunique,'valid',i.indisvalid,'ready',i.indisready,
    'predicate',PG_GET_EXPR(i.indpred,i.indrelid),
    'columns',(SELECT JSONB_AGG(a.attname ORDER BY k.ordinality) FROM UNNEST(i.indkey::SMALLINT[]) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)) INTO index_config
    FROM pg_index i WHERE i.indexrelid=TO_REGCLASS('public.idx_stock_alerts_active_product_warehouse')
      AND i.indrelid='public.stock_alerts'::REGCLASS;
  IF index_config IS DISTINCT FROM '{"unique":true,"valid":true,"ready":true,"predicate":"(status = ''active''::text)","columns":["product_id","warehouse_id"]}'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_INDEX_DRIFT';
  END IF;
  RETURN JSONB_BUILD_OBJECT('functions',functions,'triggers',triggers,'foreignKeys',foreign_keys,
    'sequence',sequence_config,'activeAlertIndex',index_config,'sequenceLastValueIsBusinessEvidence',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.shift_inventory_side_effect_catalog_v1()
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.shift_inventory_side_effect_catalog_v1() OWNER TO postgres;

-- Source-specific private planning authorization; never a public grant or an
-- execution permit. Preserve126 Customer roles and060's narrower Legacy roles.
CREATE FUNCTION phase5_private.authorize_inventory_side_effect_actor_v1(actor UUID,source_kind TEXT)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SIDE_EFFECT_ACTOR_UNAUTHORIZED';
  END IF;
  IF source_kind IS NULL OR source_kind NOT IN ('POS_REVERSAL','CUSTOMER_COMPLETION','LEGACY_WEBSITE_COMPLETION') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_SOURCE_KIND_INVALID';
  END IF;
  CASE source_kind
    WHEN 'POS_REVERSAL' THEN
      IF public.assert_reversal_owner('Phase5 private inventory side-effect planning') IS DISTINCT FROM actor THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SIDE_EFFECT_ACTOR_UNAUTHORIZED';
      END IF;
      PERFORM phase5_private.authorize_coordinator_actor_v1(actor,FALSE);
    WHEN 'CUSTOMER_COMPLETION' THEN
      PERFORM phase5_private.authorize_coordinator_actor_v1(actor,TRUE);
    WHEN 'LEGACY_WEBSITE_COMPLETION' THEN
      IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id
        JOIN public.roles r ON r.id=ur.role_id WHERE p.id=actor AND p.is_active
        AND r.code IN ('owner','admin','manager','sales')) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_LEGACY_ACTOR_UNAUTHORIZED';
      END IF;
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.authorize_inventory_side_effect_actor_v1(UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.authorize_inventory_side_effect_actor_v1(UUID,TEXT) OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_inventory_side_effects_v1(actor UUID,product_identities UUID[],source_kind TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE product_ids UUID[]; catalog JSONB; resources JSONB; composites JSONB; parents JSONB; domains JSONB; fk_edges JSONB;
BEGIN
  PERFORM phase5_private.authorize_inventory_side_effect_actor_v1(actor,source_kind);
  IF product_identities IS NULL OR ARRAY_POSITION(product_identities,NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_PRODUCTS_REQUIRED';
  END IF;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id ORDER BY id),ARRAY[]::UUID[]) INTO product_ids FROM UNNEST(product_identities) id;
  IF CARDINALITY(product_ids)<>CARDINALITY(product_identities) OR
    (SELECT COUNT(*) FROM public.products WHERE id=ANY(product_ids))<>CARDINALITY(product_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_PRODUCT_SET_INVALID';
  END IF;
  catalog:=phase5_private.shift_inventory_side_effect_catalog_v1();
  WITH rows AS (
    SELECT 'public.stock_alerts' relation_name,TO_JSONB(a) row_data FROM public.stock_alerts a WHERE product_id=ANY(product_ids)
    UNION ALL SELECT 'public.automation_events',TO_JSONB(e) FROM public.automation_events e WHERE EXISTS(
      SELECT 1 FROM public.stock_alerts a WHERE a.product_id=ANY(product_ids)
        AND (e.entity_id=a.id OR STARTS_WITH(e.event_key,'stock_alert:'||a.id::TEXT||':')))
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',row_data->>'id','row',row_data,'rank',6,'mode','UPDATE')
    ORDER BY relation_name COLLATE "C",row_data->>'id' COLLATE "C"),'[]'::JSONB) INTO resources FROM rows;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation','public.stock_alert_reads',
    'id',r.stock_alert_id::TEXT||'|'||r.user_id::TEXT,
    'identity',JSONB_BUILD_OBJECT('stock_alert_id',r.stock_alert_id,'user_id',r.user_id),
    'row',TO_JSONB(r),'rank',6,'mode','UPDATE') ORDER BY r.stock_alert_id,r.user_id),'[]'::JSONB) INTO composites
    FROM public.stock_alert_reads r JOIN public.stock_alerts a ON a.id=r.stock_alert_id WHERE a.product_id=ANY(product_ids);
  WITH rows AS (
    SELECT 'public.products' relation_name,TO_JSONB(p) row_data FROM public.products p WHERE id=ANY(product_ids)
    UNION ALL SELECT 'public.warehouses',TO_JSONB(w) FROM public.warehouses w WHERE id IN (
      SELECT warehouse_id FROM public.inventory_balances WHERE product_id=ANY(product_ids)
      UNION SELECT warehouse_id FROM public.stock_alerts WHERE product_id=ANY(product_ids))
    UNION ALL SELECT 'public.profiles',TO_JSONB(p) FROM public.profiles p WHERE id IN (
      SELECT (n->'row'->>'user_id')::UUID FROM JSONB_ARRAY_ELEMENTS(composites) n)
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',row_data->>'id','row',row_data,'rank',7,'mode','SHARE')
    ORDER BY relation_name COLLATE "C",row_data->>'id' COLLATE "C"),'[]'::JSONB) INTO parents FROM rows;
  WITH pairs AS (
    SELECT product_id,warehouse_id FROM public.inventory_balances WHERE product_id=ANY(product_ids)
    UNION SELECT product_id,warehouse_id FROM public.stock_alerts WHERE product_id=ANY(product_ids)
  ) SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('productId',p.product_id,'warehouseId',p.warehouse_id,
    'serializationGate','inventory-product:'||p.product_id::TEXT,
    'balance',(SELECT TO_JSONB(b) FROM public.inventory_balances b WHERE b.product_id=p.product_id AND b.warehouse_id=p.warehouse_id),
    'activeAlert',(SELECT TO_JSONB(a) FROM public.stock_alerts a WHERE a.product_id=p.product_id AND a.warehouse_id=p.warehouse_id AND a.status='active'),
    'futureAlertIdentityAllocated',FALSE,'futureOutboxKeyAllocated',FALSE)
    ORDER BY p.product_id,p.warehouse_id),'[]'::JSONB) INTO domains FROM pairs p;
  -- Existing composite reads use their real key, never a fabricated UUID.
  -- The common direct FK oracle is reused; normalize its planned-node label
  -- because every node in this subgraph is an existing frozen row.
  SELECT COALESCE(JSONB_AGG(e||JSONB_BUILD_OBJECT('parentState','EXISTING_NOT_LOCKED')
    ORDER BY e->>'relation' COLLATE "C",e->>'id' COLLATE "C",e->>'constraint' COLLATE "C"),'[]'::JSONB) INTO fk_edges
    FROM JSONB_ARRAY_ELEMENTS(phase5_private.shift_insert_fk_coverage_v1(
      (SELECT COALESCE(JSONB_AGG(n),'[]'::JSONB) FROM JSONB_ARRAY_ELEMENTS(resources||composites) n WHERE n->>'relation'<>'public.automation_events'),parents)) e;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-inventory-side-effects-v1',
    'planState','SIDE_EFFECT_DOMAINS_NOT_LOCKED','completeFor','EXISTING_INVENTORY_ALERT_TRIGGER_DOMAIN_ONLY',
    'executionAuthority',FALSE,'futureWriteOwnershipComplete',FALSE,'locksHeld',FALSE,
    'actorId',actor,'productIds',TO_JSONB(product_ids),'catalog',catalog,
    'resources',resources,'compositeResources',composites,'parents',parents,'domains',domains,'foreignKeys',fk_edges);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_inventory_side_effects_v1(UUID,UUID[],TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_inventory_side_effects_v1(UUID,UUID[],TEXT) OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_shift_inventory_side_effects_v1(actor UUID,product_identities UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  -- Preserve the existing Shift actor-first rejection contract at this wrapper.
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SHIFT_ACTOR_UNAUTHORIZED';
  END IF;
  RETURN phase5_private.discover_inventory_side_effects_v1(actor,product_identities,'POS_REVERSAL');
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.discover_shift_inventory_side_effects_v1(UUID,UUID[])
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_shift_inventory_side_effects_v1(UUID,UUID[]) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_inventory_side_effects_unchanged_v1(actor UUID,product_identities UUID[],expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_shift_inventory_side_effects_v1(actor,product_identities) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SHIFT_SIDE_EFFECT_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_inventory_side_effects_unchanged_v1(UUID,UUID[],JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_inventory_side_effects_unchanged_v1(UUID,UUID[],JSONB) OWNER TO postgres;

-- Bounded shared planning kernel ONLY. Source steps supplied directly to this
-- kernel are a hypothetical model, NOT source authority. The source adapter
-- below independently derives them from the freshly verified typed manifest.
-- UUID allocation is volatile but performs NO DML/locks/claims. Public014/057/
-- 099 triggers remain unchanged and do NOT consume these planned identities.
CREATE FUNCTION phase5_private.model_inventory_alert_steps_v1(actor UUID,source_steps JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE products UUID[]; snapshot JSONB; step JSONB; a JSONB; alloc JSONB; allocs JSONB:='[]'::JSONB;
  running_balances JSONB:='{}'::JSONB; running_alerts JSONB:='{}'::JSONB; running_events JSONB:='{}'::JSONB;
  remaining_reads JSONB; domain JSONB; p JSONB; w JSONB; balance_before JSONB; balance_after JSONB;
  alert_before JSONB; alert_after JSONB; deleted_reads JSONB; invocation JSONB; stored_event JSONB;
  steps JSONB:='[]'::JSONB; inserts JSONB:='[]'::JSONB; new_ids UUID[]:=ARRAY[]::UUID[];
  all_source_ids UUID[]; product_id UUID; warehouse_id UUID; balance_id UUID; alert_id UUID; event_id UUID;
  pair_key TEXT; planned_event_key TEXT; severity TEXT; action TEXT; disposition TEXT; field TEXT;
  ordinal INTEGER:=0; available INTEGER; threshold INTEGER; source_at TIMESTAMPTZ:=transaction_timestamp();
  source_kind TEXT;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_SIDE_EFFECT_ACTOR_UNAUTHORIZED';
  END IF;
  IF JSONB_TYPEOF(source_steps) IS DISTINCT FROM 'array'
    OR (allocation IS NOT NULL AND JSONB_TYPEOF(allocation) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_STEPS_REQUIRED';
  END IF;
  source_kind:=CASE WHEN JSONB_ARRAY_LENGTH(source_steps)=0 THEN 'POS_REVERSAL' ELSE source_steps->0->>'sourceKind' END;
  PERFORM phase5_private.authorize_inventory_side_effect_actor_v1(actor,source_kind);
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(source_steps) LOOP
    PERFORM phase5_private.assert_wire_keys_v1(step,ARRAY['stepId','sourceKind','sourceId','orderId','orderItemId',
      'componentId','operationId','productId','warehouseId','balanceId','onHandBefore','onHandAfter','reservedBefore','reservedAfter']);
    IF JSONB_TYPEOF(step->'stepId') IS DISTINCT FROM 'string' OR step->>'stepId'='' OR
      step->>'sourceKind' IS DISTINCT FROM source_kind THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_STEP_IDENTITY_INVALID';
    END IF;
    FOREACH field IN ARRAY ARRAY['sourceId','orderId','orderItemId','productId','warehouseId','balanceId'] LOOP
      PERFORM phase5_private.wire_uuid_v1(step->field);
    END LOOP;
    -- Historical Legacy has no modern source operation; never manufacture one.
    IF source_kind='LEGACY_WEBSITE_COMPLETION' THEN
      IF step->'operationId' IS DISTINCT FROM 'null'::JSONB OR step->'componentId' IS DISTINCT FROM 'null'::JSONB THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_LEGACY_IDENTITY_INVALID';
      END IF;
    ELSE PERFORM phase5_private.wire_uuid_v1(step->'operationId'); END IF;
    IF step->'componentId' IS DISTINCT FROM 'null'::JSONB THEN PERFORM phase5_private.wire_uuid_v1(step->'componentId'); END IF;
    FOREACH field IN ARRAY ARRAY['onHandBefore','onHandAfter','reservedBefore','reservedAfter'] LOOP
      IF JSONB_TYPEOF(step->field) IS DISTINCT FROM 'number' OR step->>field !~ '^(0|[1-9][0-9]*)$'
        OR (step->>field)::NUMERIC>2147483647 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_QUANTITY_INVALID';
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(source_steps) n GROUP BY n->>'stepId' HAVING COUNT(*)<>1)
    OR (allocation IS NOT NULL AND JSONB_ARRAY_LENGTH(allocation)<>JSONB_ARRAY_LENGTH(source_steps)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_ALLOCATION_EXACT_SET_REQUIRED';
  END IF;
  SELECT COALESCE(ARRAY_AGG(DISTINCT (n->>'productId')::UUID ORDER BY (n->>'productId')::UUID),ARRAY[]::UUID[])
    INTO products FROM JSONB_ARRAY_ELEMENTS(source_steps) n;
  snapshot:=phase5_private.discover_inventory_side_effects_v1(actor,products,source_kind);
  remaining_reads:=snapshot->'compositeResources';
  FOR domain IN SELECT value FROM JSONB_ARRAY_ELEMENTS(snapshot->'domains') LOOP
    IF domain->'balance' IS DISTINCT FROM 'null'::JSONB THEN
      running_balances:=running_balances||JSONB_BUILD_OBJECT(domain->'balance'->>'id',domain->'balance');
    END IF;
    running_alerts:=running_alerts||JSONB_BUILD_OBJECT((domain->>'productId')||'|'||(domain->>'warehouseId'),domain->'activeAlert');
  END LOOP;
  FOR a IN SELECT value FROM JSONB_ARRAY_ELEMENTS(snapshot->'resources') WHERE value->>'relation'='public.automation_events' LOOP
    running_events:=running_events||JSONB_BUILD_OBJECT(a->'row'->>'event_key',JSONB_BUILD_OBJECT('origin','EXISTING','row',a->'row'));
  END LOOP;
  SELECT COALESCE(ARRAY_AGG(DISTINCT id),ARRAY[]::UUID[]) INTO all_source_ids FROM (
    SELECT (n->>'id')::UUID id FROM JSONB_ARRAY_ELEMENTS((snapshot->'resources')||(snapshot->'parents')) n
    UNION ALL SELECT (n->>f)::UUID FROM JSONB_ARRAY_ELEMENTS(source_steps) n
      CROSS JOIN UNNEST(ARRAY['sourceId','orderId','orderItemId','componentId','operationId','productId','warehouseId','balanceId']) f
      WHERE n->>f IS NOT NULL) source_ids;
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(source_steps) LOOP
    ordinal:=ordinal+1; product_id:=(step->>'productId')::UUID; warehouse_id:=(step->>'warehouseId')::UUID;
    balance_id:=(step->>'balanceId')::UUID; pair_key:=product_id::TEXT||'|'||warehouse_id::TEXT;
    SELECT n->'row' INTO STRICT p FROM JSONB_ARRAY_ELEMENTS(snapshot->'parents') n
      WHERE n->>'relation'='public.products' AND n->>'id'=product_id::TEXT;
    SELECT n->'row' INTO STRICT w FROM JSONB_ARRAY_ELEMENTS(snapshot->'parents') n
      WHERE n->>'relation'='public.warehouses' AND n->>'id'=warehouse_id::TEXT;
    balance_before:=running_balances->balance_id::TEXT;
    IF balance_before IS NULL OR balance_before->>'product_id' IS DISTINCT FROM product_id::TEXT
      OR balance_before->>'warehouse_id' IS DISTINCT FROM warehouse_id::TEXT
      OR balance_before->'on_hand_quantity' IS DISTINCT FROM step->'onHandBefore'
      OR balance_before->'reserved_quantity' IS DISTINCT FROM step->'reservedBefore' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_BALANCE_CHAIN_INVALID';
    END IF;
    balance_after:=balance_before||JSONB_BUILD_OBJECT('on_hand_quantity',step->'onHandAfter',
      'reserved_quantity',step->'reservedAfter','updated_at',source_at);
    running_balances:=running_balances||JSONB_BUILD_OBJECT(balance_id::TEXT,balance_after);
    alert_before:=running_alerts->pair_key; alert_after:=alert_before;
    action:='NONE'; disposition:='NONE'; deleted_reads:='[]'::JSONB; invocation:='null'::JSONB; stored_event:='null'::JSONB;
    alert_id:=NULL; event_id:=NULL;
    IF allocation IS NULL THEN alloc:=JSONB_BUILD_OBJECT('stepId',step->'stepId','alertId',NULL,'eventId',NULL);
    ELSE
      alloc:=allocation->(ordinal-1);
      PERFORM phase5_private.assert_wire_keys_v1(alloc,ARRAY['stepId','alertId','eventId']);
      IF alloc->'stepId' IS DISTINCT FROM step->'stepId' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_ALLOCATION_EXACT_SET_REQUIRED';
      END IF;
    END IF;
    available:=(step->>'onHandAfter')::INTEGER-(step->>'reservedAfter')::INTEGER;
    threshold:=GREATEST(COALESCE((p->>'min_stock_level')::INTEGER,0),0);
    IF NOT COALESCE((p->>'is_active')::BOOLEAN,FALSE) THEN
      IF alert_before IS DISTINCT FROM 'null'::JSONB THEN
        action:='UPDATE'; alert_after:=alert_before||JSONB_BUILD_OBJECT('status','resolved','resolved_at',source_at,'last_updated_at',source_at);
      END IF;
    ELSIF available<=threshold THEN
      severity:=CASE WHEN available<=0 THEN 'out_of_stock' ELSE 'low_stock' END;
      IF alert_before='null'::JSONB THEN
        action:='INSERT'; alert_id:=CASE WHEN allocation IS NULL THEN gen_random_uuid() ELSE phase5_private.wire_uuid_v1(alloc->'alertId') END;
        alert_after:=JSONB_BUILD_OBJECT('id',alert_id,'product_id',product_id,'warehouse_id',warehouse_id,
          'severity',severity,'status','active','available_quantity',available,'threshold_quantity',threshold,
          'first_triggered_at',source_at,'last_updated_at',source_at,'resolved_at',NULL);
        new_ids:=new_ids||alert_id;
        alloc:=alloc||JSONB_BUILD_OBJECT('alertId',alert_id);
        inserts:=inserts||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.stock_alerts','id',alert_id,'row',alert_after));
      ELSE
        action:='UPDATE'; alert_after:=alert_before||JSONB_BUILD_OBJECT('severity',severity,'available_quantity',available,
          'threshold_quantity',threshold,'last_updated_at',source_at,'resolved_at',NULL);
        IF alert_before->>'severity' IS DISTINCT FROM severity THEN
          SELECT COALESCE(JSONB_AGG(n ORDER BY n->'identity'->>'stock_alert_id',n->'identity'->>'user_id'),'[]'::JSONB)
            INTO deleted_reads FROM JSONB_ARRAY_ELEMENTS(remaining_reads) n WHERE n->'identity'->>'stock_alert_id'=alert_before->>'id';
          SELECT COALESCE(JSONB_AGG(n ORDER BY n->'identity'->>'stock_alert_id',n->'identity'->>'user_id'),'[]'::JSONB)
            INTO remaining_reads FROM JSONB_ARRAY_ELEMENTS(remaining_reads) n WHERE n->'identity'->>'stock_alert_id'<>alert_before->>'id';
        END IF;
      END IF;
    ELSIF alert_before IS DISTINCT FROM 'null'::JSONB THEN
      action:='UPDATE'; alert_after:=alert_before||JSONB_BUILD_OBJECT('status','resolved','available_quantity',available,
        'threshold_quantity',threshold,'last_updated_at',source_at,'resolved_at',source_at);
    END IF;
    IF alert_after->>'status'='active' AND (action='INSERT' OR alert_before->>'severity' IS DISTINCT FROM alert_after->>'severity') THEN
      planned_event_key:='stock_alert:'||(alert_after->>'id')||':'||(alert_after->>'severity')||':'||FLOOR(EXTRACT(EPOCH FROM source_at))::BIGINT::TEXT;
      invocation:=JSONB_BUILD_OBJECT('event_key',planned_event_key,'event_type',alert_after->'severity','entity_id',alert_after->'id','payload',
        JSONB_BUILD_OBJECT('stockAlertId',alert_after->'id','productId',product_id,'productName',COALESCE(p->>'name_ar','صنف'),
          'warehouseId',warehouse_id,'warehouseName',COALESCE(w->>'name_ar','المستودع'),
          'availableQuantity',available,'thresholdQuantity',threshold,'severity',alert_after->'severity','updatedAt',source_at));
      a:=running_events->planned_event_key;
      -- A forged/conflicting key not reachable by entity/prefix is still a
      -- unique-key conflict. Never assume the existing resource scan covers it.
      IF a IS NULL THEN
        SELECT JSONB_BUILD_OBJECT('origin','EXISTING','row',TO_JSONB(e)) INTO a FROM public.automation_events e WHERE e.event_key=planned_event_key;
      END IF;
      IF a IS NULL THEN
        event_id:=CASE WHEN allocation IS NULL THEN gen_random_uuid() ELSE phase5_private.wire_uuid_v1(alloc->'eventId') END;
        stored_event:=invocation||JSONB_BUILD_OBJECT('id',event_id,'created_at',source_at); disposition:='INSERT_NEW';
        running_events:=running_events||JSONB_BUILD_OBJECT(planned_event_key,JSONB_BUILD_OBJECT('origin','PLANNED','row',stored_event));
        new_ids:=new_ids||event_id; alloc:=alloc||JSONB_BUILD_OBJECT('eventId',event_id);
        inserts:=inserts||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.automation_events','id',event_id,'row',stored_event));
      ELSE
        stored_event:=a->'row'; disposition:=CASE a->>'origin' WHEN 'EXISTING' THEN 'REUSE_PREEXISTING' ELSE 'REUSE_EARLIER_PLANNED' END;
        IF stored_event->'event_key' IS DISTINCT FROM invocation->'event_key'
          OR stored_event->'event_type' IS DISTINCT FROM invocation->'event_type'
          OR stored_event->'entity_id' IS DISTINCT FROM invocation->'entity_id' THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_EVENT_IDENTITY_CONFLICT';
        END IF;
        -- First-wins payload is deliberately retained, NOT overwritten or
        -- falsely asserted equal to the later invocation payload.
      END IF;
    END IF;
    IF (alert_id IS NULL AND alloc->'alertId' IS DISTINCT FROM 'null'::JSONB)
      OR (event_id IS NULL AND alloc->'eventId' IS DISTINCT FROM 'null'::JSONB) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_UNUSED_IDENTITY_INVALID';
    END IF;
    allocs:=allocs||JSONB_BUILD_ARRAY(alloc);
    running_alerts:=running_alerts||JSONB_BUILD_OBJECT(pair_key,CASE WHEN alert_after->>'status'='active' THEN alert_after ELSE 'null'::JSONB END);
    steps:=steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',ordinal,'source',step,'balanceBefore',balance_before,
      'balanceAfter',balance_after,'alertAction',action,'alertBefore',alert_before,'alertAfter',alert_after,
      'deletedReads',deleted_reads,'eventInvocation',invocation,'eventDisposition',disposition,'storedEvent',stored_event));
  END LOOP;
  IF CARDINALITY(new_ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(new_ids) id)
    OR new_ids && all_source_ids OR EXISTS(SELECT 1 FROM public.stock_alerts WHERE id=ANY(new_ids))
    OR EXISTS(SELECT 1 FROM public.automation_events WHERE id=ANY(new_ids))
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=ANY(new_ids))
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=ANY(new_ids))
    OR EXISTS(SELECT 1 FROM public.business_operations WHERE id=ANY(new_ids))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(new_ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SIDE_EFFECT_FUTURE_ID_ALREADY_OWNED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-inventory-alert-steps-v1','planState','SERVER_ALLOCATED_NOT_CLAIMED',
    'completeFor','HYPOTHETICAL_TYPED_TRANSITIONS_ONLY','sourceBindingComplete',FALSE,'executionAuthority',FALSE,
    'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE,'actorId',actor,'sourceTransactionAt',source_at,
    'sourceSnapshot',snapshot,'sourceSteps',source_steps,'allocation',allocs,'steps',steps,'plannedInserts',inserts,
    'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(inserts,(snapshot->'resources')||(snapshot->'parents')));
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_PARENT_SET_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.model_inventory_alert_steps_v1(UUID,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.model_inventory_alert_steps_v1(UUID,JSONB,JSONB) OWNER TO postgres;

-- The private future batch executor must follow THIS frozen schedule. This
-- does not assert that the old public full-Shift implementation uses it.
CREATE FUNCTION phase5_private.complete_shift_inventory_side_effect_plan_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,context_plan JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE item_row JSONB; b JSONB; after_balance JSONB; balances JSONB:='{}'::JSONB; sources JSONB:='[]'::JSONB;
  model JSONB; forbidden_ids UUID[]; inventory JSONB;
BEGIN
  PERFORM phase5_private.assert_shift_context_plan_v1(actor,shift_identity,reason,batch_key,instructions,context_plan);
  inventory:=context_plan->'manifest'->'allocation'->'inventory';
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(inventory)
    ORDER BY value->>'orderId',value->>'productId',value->>'parcelComponentId' NULLS FIRST,value->>'orderItemId' LOOP
    SELECT COALESCE(balances->t.id::TEXT,TO_JSONB(t)) INTO STRICT b FROM public.inventory_balances t
      WHERE t.product_id=(item_row->>'productId')::UUID AND t.warehouse_id=(item_row->>'warehouseId')::UUID;
    after_balance:=b||JSONB_BUILD_OBJECT('on_hand_quantity',(b->>'on_hand_quantity')::BIGINT+(item_row->>'baseQuantity')::BIGINT);
    balances:=balances||JSONB_BUILD_OBJECT(b->>'id',after_balance);
    sources:=sources||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('stepId',(item_row->>'orderId')||'|'||(item_row->>'orderItemId')||'|'||
      COALESCE(item_row->>'parcelComponentId','BASE'),'sourceKind','POS_REVERSAL','sourceId',item_row->'primitiveId',
      'orderId',item_row->'orderId','orderItemId',item_row->'orderItemId','componentId',item_row->'parcelComponentId',
      'operationId',item_row->'operationId','productId',item_row->'productId','warehouseId',item_row->'warehouseId','balanceId',b->'id',
      'onHandBefore',b->'on_hand_quantity','onHandAfter',after_balance->'on_hand_quantity',
      'reservedBefore',b->'reserved_quantity','reservedAfter',b->'reserved_quantity'));
  END LOOP;
  model:=phase5_private.model_inventory_alert_steps_v1(actor,sources,allocation);
  SELECT COALESCE(ARRAY_AGG((n->>'id')::UUID),ARRAY[]::UUID[]) INTO forbidden_ids FROM
    JSONB_ARRAY_ELEMENTS((context_plan->'manifest'->'plannedInsertFkRows')||(context_plan->'contextRows')) n;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(model->'plannedInserts') n WHERE (n->>'id')::UUID=ANY(forbidden_ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_SIDE_EFFECT_FUTURE_ID_ALREADY_OWNED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-inventory-identity-plan-v1','planState','SIDE_EFFECT_IDENTITIES_NOT_CLAIMED',
    'completeFor','POS_SOURCE_ORDERED_SIDE_EFFECT_MODEL_ONLY','sourceBindingComplete',TRUE,'contextPlan',context_plan,
    'inventoryModel',model,'executionSchedule','ORDER_UUID_THEN_PRODUCT_COMPONENT_ITEM',
    'executionAuthority',FALSE,'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_BALANCE_SET_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.complete_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.complete_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_shift_inventory_side_effect_plan_v1(actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  RETURN phase5_private.complete_shift_inventory_side_effect_plan_v1(actor,shift_identity,reason,batch_key,instructions,
    phase5_private.allocate_shift_context_plan_v1(actor,shift_identity,reason,batch_key,instructions),NULL);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.allocate_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_inventory_side_effect_plan_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF JSONB_TYPEOF(expected->'inventoryModel'->'allocation') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_ALLOCATION_REQUIRED';
  END IF;
  IF expected IS DISTINCT FROM phase5_private.complete_shift_inventory_side_effect_plan_v1(actor,shift_identity,reason,batch_key,instructions,
    expected->'contextPlan',expected->'inventoryModel'->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SIDE_EFFECT_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_inventory_side_effect_plan_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Source adapters independently derive steps from current admitted source
-- rows, never from caller-supplied deltas or postwrite alert/effect evidence.
-- No future completion operation/context is invented at discovery.
CREATE FUNCTION phase5_private.plan_customer_inventory_side_effects_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; reservation_row JSONB; source_row JSONB; balance_row JSONB; after_row JSONB;
  running JSONB:='{}'::JSONB; sources JSONB:='[]'::JSONB; quantity NUMERIC; model JSONB;
BEGIN
  parent:=phase5_private.discover_customer_completion_plan_v1(order_identity,request_key,method,amount,delivery,reference,notes);
  -- Same116 product/reservation identity order, including repeated SKU roots.
  FOR reservation_row IN SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(parent->'resources')
    WHERE value->>'relation'='public.order_inventory_reservations'
    ORDER BY value->'row'->>'product_id',value->>'id' LOOP
    SELECT value INTO STRICT source_row FROM JSONB_ARRAY_ELEMENTS(parent->'expectedSources')
      WHERE value->>'itemId'=reservation_row->>'order_item_id'
        AND value->>'productId'=reservation_row->>'product_id'
        AND value->'instanceId' IS NOT DISTINCT FROM reservation_row->'parcel_instance_id';
    SELECT COALESCE(running->(value->>'id'),value->'row') INTO STRICT balance_row
      FROM JSONB_ARRAY_ELEMENTS(parent->'inventory')
      WHERE value->'row'->'product_id'=reservation_row->'product_id'
        AND value->'row'->'warehouse_id'=reservation_row->'warehouse_id';
    quantity:=(source_row->>'quantity')::NUMERIC;
    IF quantity IS NULL OR quantity<=0 OR quantity IS DISTINCT FROM (reservation_row->>'reserved_quantity')::NUMERIC
      OR quantity>(balance_row->>'on_hand_quantity')::NUMERIC OR quantity>(balance_row->>'reserved_quantity')::NUMERIC THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_SOURCE_CAPACITY_INVALID';
    END IF;
    after_row:=balance_row||JSONB_BUILD_OBJECT('on_hand_quantity',(balance_row->>'on_hand_quantity')::NUMERIC-quantity,
      'reserved_quantity',(balance_row->>'reserved_quantity')::NUMERIC-quantity);
    sources:=sources||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('stepId',reservation_row->'id','sourceKind','CUSTOMER_COMPLETION',
      'sourceId',reservation_row->'id','orderId',parent->'orderId','orderItemId',source_row->'itemId',
      'componentId',source_row->'componentId','operationId',parent->'creation'->'id',
      'productId',source_row->'productId','warehouseId',reservation_row->'warehouse_id','balanceId',balance_row->'id',
      'onHandBefore',balance_row->'on_hand_quantity','onHandAfter',after_row->'on_hand_quantity',
      'reservedBefore',balance_row->'reserved_quantity','reservedAfter',after_row->'reserved_quantity'));
    running:=running||JSONB_BUILD_OBJECT(balance_row->>'id',after_row);
  END LOOP;
  model:=phase5_private.model_inventory_alert_steps_v1(auth.uid(),sources,allocation);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-customer-inventory-side-effect-plan-v1',
    'completeFor','CUSTOMER_SOURCE_ORDERED_SIDE_EFFECT_MODEL_ONLY','sourceBindingComplete',TRUE,
    'sourcePlan',parent,'inventoryModel',model,'executionSchedule','PRODUCT_THEN_RESERVATION_UUID',
    'executionAuthority',FALSE,'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_SOURCE_SET_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_inventory_side_effects_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_inventory_side_effects_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_inventory_side_effects_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF JSONB_TYPEOF(expected->'inventoryModel'->'allocation') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_ALLOCATION_REQUIRED';
  END IF;
  IF expected IS DISTINCT FROM phase5_private.plan_customer_inventory_side_effects_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,expected->'inventoryModel'->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SIDE_EFFECT_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_inventory_side_effects_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_inventory_side_effects_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_inventory_side_effects_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; commercial JSONB; item_row JSONB; balance_row JSONB; after_row JSONB;
  running JSONB:='{}'::JSONB; sources JSONB:='[]'::JSONB; quantity NUMERIC; model JSONB;
BEGIN
  parent:=phase5_private.discover_legacy_completion_resources_v1(order_identity,method,amount,delivery,reference,notes);
  commercial:=parent->'commercial';
  -- Exact existing private Legacy executor item order, not aggregated demand.
  FOR item_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(commercial->'sourceItems') ORDER BY value->>'id' COLLATE "C" LOOP
    SELECT COALESCE(running->(value->>'id'),value->'row') INTO STRICT balance_row
      FROM JSONB_ARRAY_ELEMENTS(parent->'resources') WHERE value->>'relation'='public.inventory_balances'
        AND value->'row'->'product_id'=item_row->'product_id'
        AND value->'row'->'warehouse_id'=commercial->'sourceOrder'->'warehouse_id';
    quantity:=(item_row->>'quantity')::NUMERIC;
    IF quantity IS NULL OR quantity<=0 OR quantity>(balance_row->>'on_hand_quantity')::NUMERIC THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_SOURCE_CAPACITY_INVALID';
    END IF;
    after_row:=balance_row||JSONB_BUILD_OBJECT('on_hand_quantity',(balance_row->>'on_hand_quantity')::NUMERIC-quantity,
      'reserved_quantity',CASE WHEN (balance_row->>'reserved_quantity')::NUMERIC>quantity
        THEN (balance_row->>'reserved_quantity')::NUMERIC-quantity ELSE 0 END);
    sources:=sources||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('stepId',item_row->'id','sourceKind','LEGACY_WEBSITE_COMPLETION',
      'sourceId',item_row->'id','orderId',commercial->'orderId','orderItemId',item_row->'id',
      'componentId',NULL,'operationId',NULL,'productId',item_row->'product_id',
      'warehouseId',commercial->'sourceOrder'->'warehouse_id','balanceId',balance_row->'id',
      'onHandBefore',balance_row->'on_hand_quantity','onHandAfter',after_row->'on_hand_quantity',
      'reservedBefore',balance_row->'reserved_quantity','reservedAfter',after_row->'reserved_quantity'));
    running:=running||JSONB_BUILD_OBJECT(balance_row->>'id',after_row);
  END LOOP;
  model:=phase5_private.model_inventory_alert_steps_v1(auth.uid(),sources,allocation);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-legacy-inventory-side-effect-plan-v1',
    'completeFor','LEGACY_SOURCE_ORDERED_SIDE_EFFECT_MODEL_ONLY','sourceBindingComplete',TRUE,
    'sourcePlan',parent,'inventoryModel',model,'executionSchedule','ORDER_ITEM_UUID',
    'executionAuthority',FALSE,'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_SIDE_EFFECT_SOURCE_SET_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_inventory_side_effects_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_inventory_side_effects_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_inventory_side_effects_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF JSONB_TYPEOF(expected->'inventoryModel'->'allocation') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_SIDE_EFFECT_ALLOCATION_REQUIRED';
  END IF;
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_inventory_side_effects_v1(
    order_identity,method,amount,delivery,reference,notes,expected->'inventoryModel'->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_SIDE_EFFECT_PLAN_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_inventory_side_effects_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_inventory_side_effects_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Owner-approved non-row authority overlay. A baseline snapshot is diagnostic,
-- never a self-approved activation target. These readers do not mint a context,
-- acquire business locks, or alter any current public ACL/trigger/function.
CREATE FUNCTION phase5_private.inventory_authority_catalog_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE envelope JSONB;
BEGIN
  IF (SELECT COUNT(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN
        ('products','inventory_balances','stock_alerts','stock_alert_reads','automation_events')) <> 5 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_AUTHORITY_RELATION_MISSING';
  END IF;
  WITH RECURSIVE protected AS (
    SELECT c.* FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN
      ('products','inventory_balances','stock_alerts','stock_alert_reads','automation_events')
  ), callable_edges(classid,objid,refclassid,refobjid) AS (
    -- pg_depend omits pinned builtins. Direct catalog links are authority
    -- edges even when no dependency row exists. Keep both sources in one graph.
    SELECT d.classid,d.objid,d.refclassid,d.refobjid FROM pg_catalog.pg_depend d
      WHERE d.classid IN ('pg_catalog.pg_proc'::REGCLASS,'pg_catalog.pg_operator'::REGCLASS)
        AND d.refclassid IN ('pg_catalog.pg_proc'::REGCLASS,'pg_catalog.pg_operator'::REGCLASS)
    UNION
    SELECT 'pg_catalog.pg_proc'::REGCLASS,a.aggfnoid::OID,'pg_catalog.pg_proc'::REGCLASS,s.oid
      FROM pg_catalog.pg_aggregate a CROSS JOIN LATERAL UNNEST(ARRAY[
        a.aggtransfn::OID,a.aggfinalfn::OID,a.aggcombinefn::OID,a.aggserialfn::OID,
        a.aggdeserialfn::OID,a.aggmtransfn::OID,a.aggminvtransfn::OID,a.aggmfinalfn::OID]) s(oid)
      WHERE s.oid<>0
    UNION
    SELECT 'pg_catalog.pg_proc'::REGCLASS,a.aggfnoid::OID,'pg_catalog.pg_operator'::REGCLASS,a.aggsortop
      FROM pg_catalog.pg_aggregate a WHERE a.aggsortop<>0
    UNION
    SELECT 'pg_catalog.pg_proc'::REGCLASS,p.oid,'pg_catalog.pg_proc'::REGCLASS,p.prosupport::OID
      FROM pg_catalog.pg_proc p WHERE p.prosupport<>0
    UNION
    SELECT 'pg_catalog.pg_operator'::REGCLASS,o.oid,'pg_catalog.pg_proc'::REGCLASS,s.oid
      FROM pg_catalog.pg_operator o CROSS JOIN LATERAL
        UNNEST(ARRAY[o.oprcode::OID,o.oprrest::OID,o.oprjoin::OID]) s(oid) WHERE s.oid<>0
    UNION
    SELECT 'pg_catalog.pg_operator'::REGCLASS,o.oid,'pg_catalog.pg_operator'::REGCLASS,s.oid
      FROM pg_catalog.pg_operator o CROSS JOIN LATERAL
        UNNEST(ARRAY[o.oprcom,o.oprnegate]) s(oid) WHERE s.oid<>0
  ), callable_closure(classid,oid) AS (
    -- All callable kinds in the admitted schemas, not just ordinary functions.
    SELECT 'pg_catalog.pg_proc'::REGCLASS,p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','phase5_private')
    UNION
    -- One recursive graph follows routine -> operator -> support routine and
    -- nested aggregate/support edges, including pinned OIDs. UNION terminates
    -- reciprocal operator links. This does not discover dynamic/body SQL.
    SELECT e.refclassid,e.refobjid FROM callable_closure r JOIN callable_edges e
      ON e.classid=r.classid AND e.objid=r.oid
  ), routine_closure(oid) AS (
    SELECT oid FROM callable_closure WHERE classid='pg_catalog.pg_proc'::REGCLASS
  ), operator_closure(oid) AS (
    SELECT oid FROM callable_closure WHERE classid='pg_catalog.pg_operator'::REGCLASS
  ), reachable(root,roleid) AS (
    SELECT r.oid,r.oid FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
    UNION
    -- Conservative closure: a mixed inherit/SET chain cannot be silently ignored.
    SELECT r.root,m.roleid FROM reachable r JOIN pg_catalog.pg_auth_members m ON m.member=r.roleid
      WHERE m.inherit_option OR m.set_option
  )
  SELECT JSONB_BUILD_OBJECT('version',1,'scope','INVENTORY_AUTHORITY_DIAGNOSTIC_ONLY',
    'writerClosed',FALSE,'activationReady',FALSE,'executionAllowed',FALSE,
    'relations',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('oid',c.oid,'name','public.'||c.relname,
      'kind',c.relkind,'owner',pg_catalog.pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
      'forceRls',c.relforcerowsecurity,'acl',TO_JSONB(c.relacl),'columns',
      (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('number',a.attnum,'name',a.attname,'acl',TO_JSONB(a.attacl),
        'type',a.atttypid,'notNull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
       FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
       WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname) FROM protected c),
    'roles',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('oid',r.oid,'name',r.rolname,'super',r.rolsuper,
      'inherit',r.rolinherit,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'login',r.rolcanlogin,
      'replication',r.rolreplication,'bypassRls',r.rolbypassrls,
      'configSha256',ENCODE(extensions.digest(COALESCE(r.rolconfig::TEXT,''),'sha256'),'hex')) ORDER BY r.rolname)
      FROM pg_catalog.pg_roles r),
    'memberships',(SELECT COALESCE(JSONB_AGG(TO_JSONB(m) ORDER BY m.member,m.roleid,m.grantor),'[]'::JSONB)
      FROM pg_catalog.pg_auth_members m),
    'effectiveAuthority',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('root',pg_catalog.pg_get_userbyid(r.root),
      'role',pg_catalog.pg_get_userbyid(r.roleid),'relation','public.'||c.relname,
      'select',pg_catalog.has_table_privilege(r.roleid,c.oid,'SELECT'),
      'mutation',pg_catalog.has_table_privilege(r.roleid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
      'columnMutation',pg_catalog.has_any_column_privilege(r.roleid,c.oid,'INSERT,UPDATE,REFERENCES'),
      'grantOption',pg_catalog.has_table_privilege(r.roleid,c.oid,
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION'),
      'publicCreate',pg_catalog.has_schema_privilege(r.roleid,'public','CREATE'),
      'privateCreate',pg_catalog.has_schema_privilege(r.roleid,'phase5_private','CREATE'),
      'replicationSet',pg_catalog.has_parameter_privilege(r.roleid,'session_replication_role','SET'),
      'roleEscalation',(SELECT z.rolsuper OR z.rolcreaterole OR z.rolcreatedb OR z.rolreplication
        FROM pg_catalog.pg_roles z WHERE z.oid=r.roleid),
      'membershipAdmin',EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.roleid AND m.admin_option))
      ORDER BY r.root,r.roleid,c.relname) FROM reachable r CROSS JOIN protected c),
    'defaults',(SELECT COALESCE(JSONB_AGG(TO_JSONB(d) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::JSONB)
      FROM pg_catalog.pg_default_acl d),
    'schemas',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('oid',n.oid,'name',n.nspname,'owner',
      pg_catalog.pg_get_userbyid(n.nspowner),'acl',TO_JSONB(n.nspacl)) ORDER BY n.nspname)
      FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','phase5_private')
        OR n.oid IN (SELECT p.pronamespace FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT oid FROM routine_closure))
        OR n.oid IN (SELECT o.oprnamespace FROM pg_catalog.pg_operator o WHERE o.oid IN (SELECT oid FROM operator_closure))),
    'functions',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('oid',p.oid,'identity',p.oid::REGPROCEDURE::TEXT,'kind',p.prokind,
      'owner',pg_catalog.pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',TO_JSONB(p.proconfig),
      'acl',TO_JSONB(p.proacl),
      'catalogSha256',ENCODE(extensions.digest(TO_JSONB(p)::TEXT,'sha256'),'hex'),
      -- pg_get_functiondef rejects aggregates. Their definition is the complete
      -- pg_aggregate tuple plus pg_proc signature and support dependency graph.
      'definitionSha256',CASE WHEN p.prokind IN ('f','p','w') THEN
        ENCODE(extensions.digest(pg_catalog.pg_get_functiondef(p.oid),'sha256'),'hex')
        WHEN p.prokind='a' THEN ENCODE(extensions.digest(TO_JSONB(a)::TEXT,'sha256'),'hex') ELSE NULL END,
      'aggregateSha256',CASE WHEN p.prokind='a' THEN
        ENCODE(extensions.digest(TO_JSONB(a)::TEXT,'sha256'),'hex') ELSE NULL END)
      ORDER BY p.oid) FROM pg_catalog.pg_proc p LEFT JOIN pg_catalog.pg_aggregate a ON a.aggfnoid=p.oid
      WHERE p.oid IN (SELECT oid FROM routine_closure)),
    'routineOperators',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('oid',o.oid,
      'catalogSha256',ENCODE(extensions.digest(TO_JSONB(o)::TEXT,'sha256'),'hex')) ORDER BY o.oid),'[]'::JSONB)
      FROM pg_catalog.pg_operator o WHERE o.oid IN (SELECT oid FROM operator_closure)),
    'callableReferences',(SELECT COALESCE(JSONB_AGG(TO_JSONB(e)
      ORDER BY e.classid,e.objid,e.refclassid,e.refobjid),'[]'::JSONB) FROM callable_edges e
      WHERE EXISTS(SELECT 1 FROM callable_closure r WHERE r.classid=e.classid AND r.oid=e.objid)),
    'referenceClosureValid',NOT EXISTS(SELECT 1 FROM callable_closure r WHERE
      (r.classid='pg_catalog.pg_proc'::REGCLASS AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=r.oid))
      OR (r.classid='pg_catalog.pg_operator'::REGCLASS AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_operator o WHERE o.oid=r.oid))),
    'routineDependencies',(SELECT COALESCE(JSONB_AGG(TO_JSONB(d)
      ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::JSONB)
      FROM pg_catalog.pg_depend d WHERE
        (d.classid='pg_catalog.pg_proc'::REGCLASS AND d.objid IN (SELECT oid FROM routine_closure))
        OR (d.refclassid='pg_catalog.pg_proc'::REGCLASS AND d.refobjid IN (SELECT oid FROM routine_closure))),
    'triggers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('oid',t.oid,'relation',t.tgrelid,
      'function',t.tgfoid,'enabled',t.tgenabled,'internal',t.tgisinternal,
      'definition',pg_catalog.pg_get_triggerdef(t.oid)) ORDER BY t.oid),'[]'::JSONB)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM protected)),
    'constraints',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('oid',c.oid,'relation',c.conrelid,
      'referenced',c.confrelid,'definition',pg_catalog.pg_get_constraintdef(c.oid),'validated',c.convalidated)
      ORDER BY c.oid),'[]'::JSONB) FROM pg_catalog.pg_constraint c
      WHERE c.conrelid IN (SELECT oid FROM protected) OR c.confrelid IN (SELECT oid FROM protected)),
    'partitions',(SELECT COALESCE(JSONB_AGG(TO_JSONB(i) ORDER BY i.inhrelid,i.inhparent),'[]'::JSONB)
      FROM pg_catalog.pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM protected) OR i.inhparent IN (SELECT oid FROM protected)),
    'indexes',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('oid',i.indexrelid,'relation',i.indrelid,
      'valid',i.indisvalid,'ready',i.indisready,'definition',pg_catalog.pg_get_indexdef(i.indexrelid))
      ORDER BY i.indexrelid),'[]'::JSONB) FROM pg_catalog.pg_index i WHERE i.indrelid IN (SELECT oid FROM protected)),
    'policies',(SELECT COALESCE(JSONB_AGG(TO_JSONB(p) ORDER BY p.oid),'[]'::JSONB)
      FROM pg_catalog.pg_policy p WHERE p.polrelid IN (SELECT oid FROM protected)),
    'sequences',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('oid',c.oid,'name',c.oid::REGCLASS::TEXT,
      'owner',pg_catalog.pg_get_userbyid(c.relowner),'acl',TO_JSONB(c.relacl),'configuration',
      JSONB_BUILD_OBJECT('type',s.seqtypid,'start',s.seqstart::TEXT,'increment',s.seqincrement::TEXT,
        'minimum',s.seqmin::TEXT,'maximum',s.seqmax::TEXT,'cache',s.seqcache::TEXT,'cycle',s.seqcycle)) ORDER BY c.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_sequence s ON s.seqrelid=c.oid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
    -- OWNED BY / identity ownership and incoming default-expression references
    -- change lifecycle authority without changing sequence configuration/ACL.
    'sequenceDependencies',(SELECT COALESCE(JSONB_AGG(TO_JSONB(d)
      ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::JSONB)
      FROM pg_catalog.pg_depend d WHERE
      (d.classid='pg_catalog.pg_class'::REGCLASS AND d.objid IN
        (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind='S'))
      OR (d.refclassid='pg_catalog.pg_class'::REGCLASS AND d.refobjid IN
        (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind='S'))),
    'jobs',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('jobId',j.jobid,'name',j.jobname,'schedule',j.schedule,
      'database',j.database,'username',j.username,'active',j.active,
      'nodeNameSha256',ENCODE(extensions.digest(j.nodename,'sha256'),'hex'),'nodePort',j.nodeport,
      'commandSha256',ENCODE(extensions.digest(j.command,'sha256'),'hex')) ORDER BY j.jobid),'[]'::JSONB) FROM cron.job j)
  ) INTO envelope;
  -- Future/unknown callable kinds or structurally incomplete aggregate catalog
  -- rows must fail closed, never disappear from the frozen authority envelope.
  IF envelope->'referenceClosureValid' IS DISTINCT FROM 'true'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_CALLABLE_REFERENCE_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(envelope->'functions') f
      WHERE f->>'kind' NOT IN ('f','p','w','a') OR f->>'definitionSha256' IS NULL
        OR (f->>'kind'='a' AND f->>'aggregateSha256' IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_CALLABLE_KIND_UNSUPPORTED';
  END IF;
  RETURN envelope;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.inventory_authority_catalog_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.inventory_authority_catalog_v1() OWNER TO postgres;

-- Equality to an independently captured reviewed baseline is drift detection
-- ONLY. Calling this with the actual snapshot never authorizes execution.
CREATE FUNCTION phase5_private.assert_inventory_authority_snapshot_v1(expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object'
    OR expected IS DISTINCT FROM phase5_private.inventory_authority_catalog_v1() THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_INVENTORY_AUTHORITY_DRIFT';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_inventory_authority_snapshot_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_inventory_authority_snapshot_v1(JSONB) OWNER TO postgres;

-- Unbound until separately authorized activation. Even trusted maintenance
-- cannot use a caller flag to truncate business state through this guard.
CREATE FUNCTION phase5_private.reject_inventory_truncate_v1()
RETURNS TRIGGER LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $guard$BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_INVENTORY_TRUNCATE_FORBIDDEN'; END;$guard$;
REVOKE ALL ON FUNCTION phase5_private.reject_inventory_truncate_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.reject_inventory_truncate_v1() OWNER TO postgres;

-- A scoped direct-authority qualification, NOT complete writer closure. Future
-- activation also needs the independently reviewed SD/writer/context envelope.
-- There is no input capable of allowing prohibited authority or weakening the
-- five-relation policy. Defaults are frozen, not globally rewritten here.
CREATE FUNCTION phase5_private.assert_inventory_authority_target_v1(expected JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE envelope JSONB; relation_entry JSONB; rel_oid OID; guard_oid OID; bad BOOLEAN;
BEGIN
  PERFORM phase5_private.assert_inventory_authority_snapshot_v1(expected);
  envelope:=phase5_private.inventory_authority_catalog_v1();
  IF (SELECT COUNT(*) FROM JSONB_ARRAY_ELEMENTS(envelope->'roles') r
      WHERE r->>'name' IN ('anon','authenticated','service_role')) <> 3
      OR envelope->'partitions' IS DISTINCT FROM '[]'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_RELATION_AUTHORITY_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(envelope->'effectiveAuthority') a WHERE
    (a->>'mutation')::BOOLEAN OR (a->>'columnMutation')::BOOLEAN OR (a->>'grantOption')::BOOLEAN
    OR (a->>'publicCreate')::BOOLEAN OR (a->>'privateCreate')::BOOLEAN OR (a->>'replicationSet')::BOOLEAN
    OR (a->>'roleEscalation')::BOOLEAN OR (a->>'membershipAdmin')::BOOLEAN)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(envelope->'roles') r WHERE
      r->>'name' IN ('anon','authenticated','service_role') AND
      ((r->>'super')::BOOLEAN OR (r->>'createRole')::BOOLEAN OR (r->>'createDb')::BOOLEAN OR (r->>'replication')::BOOLEAN)) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_PROHIBITED_AUTHORITY';
  END IF;
  -- PUBLIC and unknown grantees, including column-only rights, cannot hide
  -- behind application membership checks. Only the trusted owner keeps rights.
  FOR relation_entry IN SELECT a FROM JSONB_ARRAY_ELEMENTS(envelope->'relations') a LOOP
    rel_oid:=(relation_entry->>'oid')::OID;
    IF relation_entry->>'kind' IS DISTINCT FROM 'r' OR relation_entry->>'owner' IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_RELATION_AUTHORITY_INVALID';
    END IF;
    SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL
      pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid=rel_oid AND a.grantee<>c.relowner AND (a.privilege_type<>'SELECT' OR a.is_grantable))
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute c CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a
      WHERE c.attrelid=rel_oid AND c.attnum>0 AND NOT c.attisdropped
        AND a.grantee<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid=rel_oid)
        AND (a.privilege_type<>'SELECT' OR a.is_grantable)) INTO bad;
    IF bad THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_PROHIBITED_AUTHORITY'; END IF;
    guard_oid:='phase5_private.reject_inventory_truncate_v1()'::REGPROCEDURE;
    IF (SELECT COUNT(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=rel_oid AND NOT t.tgisinternal
        AND t.tgname='phase5_inventory_no_truncate' AND t.tgfoid=guard_oid AND t.tgtype=34
        AND t.tgenabled='A' AND t.tgnargs=0 AND t.tgqual IS NULL AND t.tgconstraint=0) <> 1 THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_TRUNCATE_GUARD_INVALID';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=guard_oid AND
      (p.proowner<>'postgres'::REGROLE OR p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']
       OR p.prosrc IS DISTINCT FROM $body$BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_INVENTORY_TRUNCATE_FORBIDDEN'; END;$body$)) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_INVENTORY_TRUNCATE_GUARD_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('directAuthorityQualified',TRUE,'writerClosed',FALSE,
    'activationReady',FALSE,'executionAllowed',FALSE,'scope','FIVE_RELATION_DIRECT_AUTHORITY_ONLY');
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_inventory_authority_target_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_inventory_authority_target_v1(JSONB) OWNER TO postgres;

-- Typed identity preparation after fresh source planning. This compiles explicit
-- per-step UUID/key ownership, never a durable claim, held lock or execution
-- certificate. Public INSERT defaults and trigger bodies are unchanged.
CREATE FUNCTION phase5_private.derive_inventory_identity_manifest_v1(
  actor UUID, model JSONB, reserved_identities UUID[]
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE fresh JSONB; step JSONB; claim JSONB; first_claim JSONB; entry JSONB;
  uuid_claims JSONB:='[]'::JSONB; key_bindings JSONB:='[]'::JSONB;
  reads JSONB:='[]'::JSONB; planned_rows JSONB:='[]'::JSONB; new_ids UUID[];
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_IDENTITY_ACTOR_UNAUTHORIZED';
  END IF;
  IF reserved_identities IS NULL OR ARRAY_POSITION(reserved_identities,NULL) IS NOT NULL
    OR JSONB_TYPEOF(model->'sourceSteps') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(model->'allocation') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_IDENTITY_PLAN_REQUIRED';
  END IF;
  -- Expected tuples come from the current independent prewrite anchors and
  -- source transitions, not from the submitted claims or planned insert rows.
  fresh:=phase5_private.model_inventory_alert_steps_v1(actor,model->'sourceSteps',model->'allocation');
  IF model IS DISTINCT FROM fresh THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_IDENTITY_MODEL_CHANGED_RETRY';
  END IF;
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(fresh->'steps') LOOP
    IF step->>'alertAction'='INSERT' THEN
      uuid_claims:=uuid_claims||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'relation','public.stock_alerts','id',step->'alertAfter'->'id',
        'ordinal',step->'ordinal','stepId',step->'source'->'stepId',
        'source',step->'source','row',step->'alertAfter'));
    END IF;
    IF step->>'eventDisposition'='INSERT_NEW' THEN
      uuid_claims:=uuid_claims||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'relation','public.automation_events','id',step->'storedEvent'->'id',
        'ordinal',step->'ordinal','stepId',step->'source'->'stepId',
        'source',step->'source','row',step->'storedEvent'));
    END IF;
    IF step->'eventInvocation' IS DISTINCT FROM 'null'::JSONB THEN
      first_claim:=NULL;
      IF step->>'eventDisposition' IN ('INSERT_NEW','REUSE_EARLIER_PLANNED') THEN
        SELECT n INTO STRICT first_claim FROM JSONB_ARRAY_ELEMENTS(uuid_claims) n
          WHERE n->>'relation'='public.automation_events' AND n->'id'=step->'storedEvent'->'id';
      ELSIF step->>'eventDisposition' IS DISTINCT FROM 'REUSE_PREEXISTING' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_IDENTITY_EVENT_OWNER_INVALID';
      END IF;
      key_bindings:=key_bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'ordinal',step->'ordinal','stepId',step->'source'->'stepId','source',step->'source',
        'eventKey',step->'eventInvocation'->'event_key','eventId',step->'storedEvent'->'id',
        'disposition',step->'eventDisposition','ownerOrdinal',first_claim->'ordinal',
        'ownerStepId',first_claim->'stepId','invocation',step->'eventInvocation',
        'storedRow',step->'storedEvent'));
    END IF;
    FOR entry IN SELECT value FROM JSONB_ARRAY_ELEMENTS(step->'deletedReads') LOOP
      reads:=reads||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',step->'ordinal',
        'stepId',step->'source'->'stepId','source',step->'source','resource',entry));
    END LOOP;
  END LOOP;
  FOR claim IN SELECT value FROM JSONB_ARRAY_ELEMENTS(uuid_claims) LOOP
    planned_rows:=planned_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'relation',claim->'relation','id',claim->'id','row',claim->'row'));
  END LOOP;
  -- Array equality preserves source order and full content as well as the
  -- bidirectional identity set. Aggregate counts/sums cannot replace a step.
  IF planned_rows IS DISTINCT FROM fresh->'plannedInserts' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_IDENTITY_INSERT_EXACT_SET_REQUIRED';
  END IF;
  SELECT COALESCE(ARRAY_AGG((n->>'id')::UUID),ARRAY[]::UUID[]) INTO new_ids
    FROM JSONB_ARRAY_ELEMENTS(uuid_claims) n;
  IF new_ids && reserved_identities THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_IDENTITY_PARENT_COLLISION';
  END IF;
  RETURN JSONB_BUILD_OBJECT('manifestVersion','phase5-inventory-identity-manifest-v1',
    'manifestState','TYPED_IDENTITIES_NOT_CLAIMED','actorId',actor,
    'sourceTransactionAt',fresh->'sourceTransactionAt','sourceSteps',fresh->'sourceSteps',
    'reservedIdentities',TO_JSONB(reserved_identities),'uuidClaims',uuid_claims,
    'eventKeyBindings',key_bindings,'readDeletions',reads,
    'authoritySnapshot',phase5_private.inventory_authority_catalog_v1(),
    'sourceBindingComplete',FALSE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,
    'futureWriteOwnershipComplete',FALSE,'executionAuthority',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_IDENTITY_EVENT_OWNER_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_inventory_identity_manifest_v1(UUID,JSONB,UUID[])
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_inventory_identity_manifest_v1(UUID,JSONB,UUID[]) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_inventory_identity_manifest_v1(
  actor UUID, model JSONB, reserved_identities UUID[], expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_inventory_identity_manifest_v1(actor,model,reserved_identities) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_IDENTITY_MANIFEST_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_inventory_identity_manifest_v1(UUID,JSONB,UUID[],JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_inventory_identity_manifest_v1(UUID,JSONB,UUID[],JSONB) OWNER TO postgres;

-- These source-specific adapters are the only source-binding assertion in this
-- layer. A hypothetical model passed to the generic compiler stays unbound.
CREATE FUNCTION phase5_private.plan_shift_inventory_identity_manifest_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,
  context_plan JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; reserved UUID[];
BEGIN
  parent:=phase5_private.complete_shift_inventory_side_effect_plan_v1(
    actor,shift_identity,reason,batch_key,instructions,context_plan,allocation);
  SELECT COALESCE(ARRAY_AGG(DISTINCT (n->>'id')::UUID ORDER BY (n->>'id')::UUID),ARRAY[]::UUID[]) INTO reserved
    FROM JSONB_ARRAY_ELEMENTS((parent->'contextPlan'->'manifest'->'plannedInsertFkRows')||
      (parent->'contextPlan'->'contextRows')||(parent->'contextPlan'->'manifest'->'existingResources')) n;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-inventory-identity-manifest-v1',
    'parentPlan',parent,'identityManifest',phase5_private.derive_inventory_identity_manifest_v1(actor,parent->'inventoryModel',reserved),
    'sourceBindingComplete',TRUE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_shift_inventory_identity_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_shift_inventory_identity_manifest_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_inventory_identity_manifest_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; reserved UUID[];
BEGIN
  parent:=phase5_private.plan_customer_inventory_side_effects_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,allocation);
  -- Parent resources also have composite user-role identities; extract their
  -- UUID-valued row fields rather than casting a composite resource key.
  SELECT COALESCE(ARRAY_AGG(DISTINCT (v#>>'{}')::UUID ORDER BY (v#>>'{}')::UUID),ARRAY[]::UUID[]) INTO reserved
    FROM JSONB_ARRAY_ELEMENTS((parent->'sourcePlan'->'resources')||(parent->'sourcePlan'->'inventory')||
      (parent->'sourcePlan'->'parents')) n CROSS JOIN LATERAL JSONB_EACH(n->'row') r(k,v)
    WHERE JSONB_TYPEOF(v)='string' AND (v#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-customer-inventory-identity-manifest-v1',
    'parentPlan',parent,'identityManifest',phase5_private.derive_inventory_identity_manifest_v1(auth.uid(),parent->'inventoryModel',reserved),
    'sourceBindingComplete',TRUE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_inventory_identity_manifest_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_inventory_identity_manifest_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_inventory_identity_manifest_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; reserved UUID[];
BEGIN
  parent:=phase5_private.plan_legacy_inventory_side_effects_v1(order_identity,method,amount,delivery,reference,notes,allocation);
  SELECT COALESCE(ARRAY_AGG(DISTINCT (v#>>'{}')::UUID ORDER BY (v#>>'{}')::UUID),ARRAY[]::UUID[]) INTO reserved
    FROM JSONB_ARRAY_ELEMENTS(parent->'sourcePlan'->'resources') n CROSS JOIN LATERAL JSONB_EACH(n->'row') r(k,v)
    WHERE JSONB_TYPEOF(v)='string' AND (v#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-legacy-inventory-identity-manifest-v1',
    'parentPlan',parent,'identityManifest',phase5_private.derive_inventory_identity_manifest_v1(auth.uid(),parent->'inventoryModel',reserved),
    'sourceBindingComplete',TRUE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_inventory_identity_manifest_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_inventory_identity_manifest_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Compose already-rederived future parent and stock identities before any claim.
-- No caller-supplied parent row list can become source or execution authority.
CREATE FUNCTION phase5_private.plan_shift_inventory_identity_union_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,
  context_plan JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE source_plan JSONB; parent_rows JSONB; stock_rows JSONB; combined JSONB;
  existing JSONB; candidates JSONB; identities UUID[]; existing_ids UUID[];
BEGIN
  source_plan:=phase5_private.plan_shift_inventory_identity_manifest_v1(
    actor,shift_identity,reason,batch_key,instructions,context_plan,allocation);
  parent_rows:=source_plan->'parentPlan'->'contextPlan'->'manifest'->'plannedInsertFkRows'||
    (source_plan->'parentPlan'->'contextPlan'->'contextRows');
  stock_rows:=source_plan->'parentPlan'->'inventoryModel'->'plannedInserts';
  combined:=parent_rows||stock_rows;
  SELECT COALESCE(ARRAY_AGG(phase5_private.wire_uuid_v1(n->'id')),ARRAY[]::UUID[])
    INTO identities FROM JSONB_ARRAY_ELEMENTS(combined) n;
  IF CARDINALITY(identities)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(identities) id)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(combined) n WHERE n->'id' IS DISTINCT FROM n->'row'->'id') THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_IDENTITY_UNION_COLLISION';
  END IF;
  candidates:=source_plan->'parentPlan'->'contextPlan'->'manifest'->'existingResources'||
    (source_plan->'parentPlan'->'inventoryModel'->'sourceSnapshot'->'resources')||
    (source_plan->'parentPlan'->'inventoryModel'->'sourceSnapshot'->'parents');
  -- Repeated reads may share an identical frozen resource; contradictory rows
  -- under the same relation/id cannot be collapsed with DISTINCT or first-wins.
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(candidates) n
      GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_IDENTITY_UNION_RESOURCE_CHANGED_RETRY';
  END IF;
  SELECT COALESCE(JSONB_AGG(n ORDER BY n->>'relation' COLLATE "C",n->>'id' COLLATE "C"),'[]'::JSONB)
    INTO existing FROM (SELECT DISTINCT JSONB_BUILD_OBJECT('relation',n->'relation','id',n->'id','row',n->'row') n
      FROM JSONB_ARRAY_ELEMENTS(candidates) n) resources;
  SELECT COALESCE(ARRAY_AGG(phase5_private.wire_uuid_v1(n->'id')),ARRAY[]::UUID[])
    INTO existing_ids FROM JSONB_ARRAY_ELEMENTS(existing) n;
  IF identities && existing_ids THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_IDENTITY_UNION_COLLISION';
  END IF;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-shift-inventory-identity-union-v1',
    'planState','FUTURE_PARENT_AND_STOCK_IDENTITIES_NOT_CLAIMED',
    'sourcePlan',source_plan,'parentRows',parent_rows,'stockRows',stock_rows,
    'plannedRows',combined,'existingResources',existing,
    'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(combined,existing),
    'sourceBindingComplete',TRUE,'directPlannedInsertCoverageComplete',TRUE,
    'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'sourceWriteTriggerClosureComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_shift_inventory_identity_union_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_shift_inventory_identity_union_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_shift_inventory_identity_union_v1(
  actor UUID,shift_identity UUID,reason TEXT,batch_key TEXT,instructions JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_shift_inventory_identity_union_v1(
    actor,shift_identity,reason,batch_key,instructions,
    expected->'sourcePlan'->'parentPlan'->'contextPlan',
    expected->'sourcePlan'->'parentPlan'->'inventoryModel'->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_IDENTITY_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_shift_inventory_identity_union_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_shift_inventory_identity_union_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Completion inventory parent union. The generic compiler is hypothetical;
-- only the source adapters below independently bind a current completion.
-- Rows describe direct inventory INSERT/FK tuples, not an execution context,
-- sequence allocation, financial receipt or complete completion-write permit.
CREATE FUNCTION phase5_private.derive_completion_inventory_union_v1(
  actor UUID,model JSONB,source_resources JSONB,movement_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE existing JSONB; candidates JSONB; s JSONB; a JSONB; ids UUID[]; reserved UUID[];
  allocations JSONB:='[]'::JSONB; movements JSONB:='[]'::JSONB;
  combined JSONB; row_value JSONB; movement_identity UUID; identity_manifest JSONB;
BEGIN
  IF actor IS DISTINCT FROM auth.uid() OR model->>'actorId' IS DISTINCT FROM actor::TEXT THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_UNION_ACTOR_INVALID';
  END IF;
  IF JSONB_TYPEOF(source_resources) IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(model->'sourceSteps') IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(model->'sourceSteps')=0
    OR (movement_allocation IS NOT NULL AND JSONB_TYPEOF(movement_allocation) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_UNION_INPUT_REQUIRED';
  END IF;
  candidates:=source_resources||(model->'sourceSnapshot'->'resources')||(model->'sourceSnapshot'->'parents');
  IF JSONB_TYPEOF(candidates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_UNION_INPUT_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(candidates) n
      WHERE JSONB_TYPEOF(n->'row') IS DISTINCT FROM 'object' OR n->>'id' IS NULL OR n->>'relation' IS NULL)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(candidates) n
      GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_UNION_RESOURCE_CHANGED_RETRY';
  END IF;
  SELECT COALESCE(JSONB_AGG(n ORDER BY n->>'relation' COLLATE "C",n->>'id' COLLATE "C"),'[]'::JSONB)
    INTO existing FROM (SELECT DISTINCT JSONB_BUILD_OBJECT('relation',n->'relation','id',n->'id','row',n->'row') n
      FROM JSONB_ARRAY_ELEMENTS(candidates) n) resources;
  -- Composite resources (user_roles) are retained; reserve their UUID fields,
  -- never cast the composite resource key as a UUID.
  SELECT COALESCE(ARRAY_AGG(DISTINCT (v#>>'{}')::UUID),ARRAY[]::UUID[]) INTO reserved
    FROM JSONB_ARRAY_ELEMENTS(existing) n CROSS JOIN LATERAL JSONB_EACH(n->'row') r(k,v)
    WHERE JSONB_TYPEOF(v)='string' AND (v#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF movement_allocation IS NOT NULL AND
    (SELECT COALESCE(JSONB_AGG(n->'sourceId' ORDER BY ord),'[]'::JSONB)
      FROM JSONB_ARRAY_ELEMENTS(movement_allocation) WITH ORDINALITY x(n,ord))
    IS DISTINCT FROM (SELECT JSONB_AGG(n->'sourceId' ORDER BY ord)
      FROM JSONB_ARRAY_ELEMENTS(model->'sourceSteps') WITH ORDINALITY x(n,ord)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_UNION_SOURCE_EXACT_SET_REQUIRED';
  END IF;
  FOR s IN SELECT value FROM JSONB_ARRAY_ELEMENTS(model->'sourceSteps') LOOP
    IF movement_allocation IS NULL THEN
      a:=JSONB_BUILD_OBJECT('sourceId',s->'sourceId','movementId',gen_random_uuid());
    ELSE
      SELECT value INTO STRICT a FROM JSONB_ARRAY_ELEMENTS(movement_allocation) WHERE value->'sourceId'=s->'sourceId';
    END IF;
    PERFORM phase5_private.assert_wire_keys_v1(a,ARRAY['sourceId','movementId']);
    movement_identity:=phase5_private.wire_uuid_v1(a->'movementId');
    IF s->>'sourceKind' NOT IN ('CUSTOMER_COMPLETION','LEGACY_WEBSITE_COMPLETION')
      OR s->>'sourceKind' IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_UNION_SOURCE_INVALID';
    END IF;
    row_value:=JSONB_BUILD_OBJECT('id',movement_identity,'warehouse_id',s->'warehouseId','product_id',s->'productId',
      'movement_type','sales_deduction','quantity',(s->>'onHandAfter')::NUMERIC-(s->>'onHandBefore')::NUMERIC,
      'balance_before',s->'onHandBefore','balance_after',s->'onHandAfter','created_by',actor,
      'reference_type',CASE WHEN s->>'sourceKind'='CUSTOMER_COMPLETION' THEN 'customer_order' ELSE 'order' END,
      'reference_id',s->'orderId','operation_id',s->'operationId','parcel_component_id',s->'componentId',
      'reservation_id',CASE WHEN s->>'sourceKind'='CUSTOMER_COMPLETION' THEN s->'sourceId' ELSE 'null'::JSONB END);
    -- Retain the actual installed row type: every other FK is explicitly NULL,
    -- never omitted or guessed. This does not evaluate INSERT defaults.
    row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.inventory_movements,row_value));
    allocations:=allocations||JSONB_BUILD_ARRAY(a);
    movements:=movements||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.inventory_movements',
      'id',movement_identity,'sourceId',s->'sourceId','row',row_value));
  END LOOP;
  SELECT ARRAY_AGG((n->>'movementId')::UUID) INTO ids FROM JSONB_ARRAY_ELEMENTS(allocations) n;
  IF CARDINALITY(ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(ids) id) OR ids && reserved
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.business_operations WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COMPLETION_UNION_ID_COLLISION';
  END IF;
  identity_manifest:=phase5_private.derive_inventory_identity_manifest_v1(actor,model,reserved||ids);
  combined:=movements||(model->'plannedInserts');
  RETURN JSONB_BUILD_OBJECT('unionVersion','phase5-completion-inventory-union-v1',
    'planState','FUTURE_INVENTORY_IDENTITIES_NOT_CLAIMED','movementAllocation',allocations,
    'parentRows',movements,'stockRows',model->'plannedInserts','plannedRows',combined,
    'identityManifest',identity_manifest,'existingResources',existing,
    'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(combined,existing),
    'sourceBindingComplete',FALSE,'directInventoryInsertCoverageComplete',TRUE,
    'futureCompletionInsertCoverageComplete',FALSE,'durableClaimsCreated',FALSE,
    'locksHeld',FALSE,'executionAuthority',FALSE,'futureWriteOwnershipComplete',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_UNION_SOURCE_EXACT_SET_REQUIRED';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_completion_inventory_union_v1(UUID,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_completion_inventory_union_v1(UUID,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_inventory_identity_union_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,
  stock_allocation JSONB,movement_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; merged JSONB;
BEGIN
  parent:=phase5_private.plan_customer_inventory_side_effects_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,stock_allocation);
  merged:=phase5_private.derive_completion_inventory_union_v1(auth.uid(),parent->'inventoryModel',
    (parent->'sourcePlan'->'resources')||(parent->'sourcePlan'->'inventory')||(parent->'sourcePlan'->'parents')||
    (SELECT COALESCE(JSONB_AGG(s||JSONB_BUILD_OBJECT('relation','public.cash_shifts','id',s->'row'->'id') ORDER BY s->'row'->>'id'),'[]'::JSONB)
      FROM JSONB_ARRAY_ELEMENTS(parent->'sourcePlan'->'shifts') s),movement_allocation);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-customer-inventory-identity-union-v1',
    'sourcePlan',parent,'inventoryUnion',merged,'sourceBindingComplete',TRUE,
    'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'futureCompletionInsertCoverageComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_inventory_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_inventory_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_inventory_identity_union_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_customer_inventory_identity_union_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,
    expected->'sourcePlan'->'inventoryModel'->'allocation',expected->'inventoryUnion'->'movementAllocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_inventory_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_inventory_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_inventory_identity_union_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,
  stock_allocation JSONB,movement_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE parent JSONB; merged JSONB;
BEGIN
  parent:=phase5_private.plan_legacy_inventory_side_effects_v1(order_identity,method,amount,delivery,reference,notes,stock_allocation);
  merged:=phase5_private.derive_completion_inventory_union_v1(auth.uid(),parent->'inventoryModel',parent->'sourcePlan'->'resources',movement_allocation);
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-legacy-inventory-identity-union-v1',
    'sourcePlan',parent,'inventoryUnion',merged,'sourceBindingComplete',TRUE,
    'durableClaimsCreated',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE,
    'futureWriteOwnershipComplete',FALSE,'futureCompletionInsertCoverageComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_inventory_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_inventory_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_inventory_identity_union_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_inventory_identity_union_v1(
    order_identity,method,amount,delivery,reference,notes,
    expected->'sourcePlan'->'inventoryModel'->'allocation',expected->'inventoryUnion'->'movementAllocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_UNION_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_inventory_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_inventory_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Completion control identities and direct FK projection. Values requiring the
-- held execution context remain explicit symbolic slots, never sampled clocks,
-- sequence values or a success outcome. The compiler itself is hypothetical;
-- the adapters below independently rediscover the complete source/child union.
CREATE FUNCTION phase5_private.complete_completion_identity_plan_v1(
  actor UUID,kind TEXT,inventory_plan JSONB,source_union JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE u JSONB:=inventory_plan->'inventoryUnion'; p JSONB; r JSONB; child JSONB:='null'::JSONB;
  ids UUID[]; reserved UUID[]; field TEXT; identity UUID; child_context UUID; h TEXT;
  order_identity UUID; context_identity UUID; operation_identity UUID; row_value JSONB;
  receipt JSONB; receipt_needed BOOLEAN; event_slot JSONB; transaction_slot JSONB; number_slot JSONB;
  control_rows JSONB:='[]'::JSONB; combined JSONB; ownership JSONB:='[]'::JSONB;
  existing JSONB; candidates JSONB;
  roles JSONB; link JSONB:='null'::JSONB; completion_slot JSONB; shift_identity JSONB;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM auth.uid() OR kind IS NULL OR kind NOT IN ('customer','legacy') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_IDENTITIES_ACTOR_INVALID';
  END IF;
  IF kind='customer' THEN
    p:=source_union->'parent'; child:=source_union->'child';
    IF p IS DISTINCT FROM inventory_plan->'sourcePlan'->'sourcePlan'
      OR source_union->>'planVersion' IS DISTINCT FROM 'phase5-customer-completion-union-discovery-v1' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_SOURCE_INVALID';
    END IF;
    receipt_needed:=p->'capacity'->'receiptRequired'='true'::JSONB;
    IF receipt_needed IS NULL OR (receipt_needed AND JSONB_TYPEOF(child) IS DISTINCT FROM 'object')
      OR (NOT receipt_needed AND child IS DISTINCT FROM 'null'::JSONB) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_SOURCE_INVALID';
    END IF;
    PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['contextId','operationId','parentAuditId','historyId']);
    roles:=allocation;
  ELSE
    IF source_union IS DISTINCT FROM inventory_plan->'sourcePlan'->'sourcePlan'
      OR source_union->>'planVersion' IS DISTINCT FROM 'phase5-legacy-completion-resources-v1' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_SOURCE_INVALID';
    END IF;
    p:=source_union->'commercial';
    receipt_needed:=p->'settlement'->'receiptRequired'='true'::JSONB;
    IF receipt_needed IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_SOURCE_INVALID'; END IF;
    PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['contextId','historyId','completionAuditId','settlementAuditId','receipt']);
    roles:=allocation-'receipt'; receipt:=allocation->'receipt';
    IF receipt_needed THEN
      PERFORM phase5_private.assert_wire_keys_v1(receipt,ARRAY['paymentId','auditId']);
      roles:=roles||JSONB_BUILD_OBJECT('legacyPaymentId',receipt->'paymentId','legacyPaymentAuditId',receipt->'auditId');
    ELSIF receipt IS DISTINCT FROM 'null'::JSONB THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_RECEIPT_NOT_APPLICABLE';
    END IF;
  END IF;
  r:=p->'request'; order_identity:=phase5_private.wire_uuid_v1(p->'orderId');
  IF p->>'actorId' IS DISTINCT FROM actor::TEXT OR u->'sourceBindingComplete' IS DISTINCT FROM 'false'::JSONB
    OR inventory_plan->'sourceBindingComplete' IS DISTINCT FROM 'true'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_IDENTITIES_SOURCE_INVALID';
  END IF;
  context_identity:=phase5_private.wire_uuid_v1(roles->'contextId');
  operation_identity:=CASE WHEN kind='customer' THEN phase5_private.wire_uuid_v1(roles->'operationId') ELSE NULL END;
  IF kind='customer' AND receipt_needed THEN
    PERFORM phase5_private.assert_wire_keys_v1(child->'identities',ARRAY['operationId','paymentId','collectionId','auditId']);
    h:=LOWER(public.phase3_request_fingerprint_internal(JSONB_BUILD_OBJECT(
      'domain','phase5-customer-parent-child-context-v1','parentContextId',context_identity,
      'childOperationId',child->'identities'->'operationId')));
    child_context:=(SUBSTR(h,1,8)||'-'||SUBSTR(h,9,4)||'-8'||SUBSTR(h,14,3)||'-8'||SUBSTR(h,18,3)||'-'||SUBSTR(h,21,12))::UUID;
    roles:=roles||JSONB_BUILD_OBJECT('childContextId',child_context,
      'childOperationId',child->'identities'->'operationId','childPaymentId',child->'identities'->'paymentId',
      'childCollectionId',child->'identities'->'collectionId','childAuditId',child->'identities'->'auditId');
  END IF;
  ids:=ARRAY[]::UUID[];
  FOR field IN SELECT key FROM JSONB_OBJECT_KEYS(roles) key ORDER BY key COLLATE "C" LOOP
    identity:=phase5_private.wire_uuid_v1(roles->field); ids:=ids||identity;
    ownership:=ownership||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('role',field,'id',identity));
  END LOOP;
  candidates:=(u->'existingResources')||(source_union->'resources');
  IF JSONB_TYPEOF(candidates) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(candidates) n
    GROUP BY n->>'relation',n->>'id' HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_IDENTITIES_RESOURCE_CHANGED_RETRY';
  END IF;
  SELECT JSONB_AGG(n ORDER BY n->>'relation' COLLATE "C",n->>'id' COLLATE "C") INTO existing
    FROM (SELECT DISTINCT JSONB_BUILD_OBJECT('relation',n->'relation','id',n->'id','row',n->'row') n
      FROM JSONB_ARRAY_ELEMENTS(candidates) n) resources;
  SELECT COALESCE(ARRAY_AGG(DISTINCT (v#>>'{}')::UUID),ARRAY[]::UUID[]) INTO reserved
    FROM JSONB_ARRAY_ELEMENTS(existing) n CROSS JOIN LATERAL JSONB_EACH(n->'row') x(k,v)
    WHERE JSONB_TYPEOF(v)='string' AND (v#>>'{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  reserved:=reserved||ARRAY(SELECT (n->>'id')::UUID FROM JSONB_ARRAY_ELEMENTS(u->'plannedRows') n);
  IF CARDINALITY(ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(ids) id) OR ids && reserved
    OR EXISTS(SELECT 1 FROM public.business_operations WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.audit_logs WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.order_status_history WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM public.customer_payments WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.financial_operation_events WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.collection_events WHERE id=ANY(ids))
    OR EXISTS(SELECT 1 FROM phase5_private.collection_attempt_envelopes WHERE financial_operation_id=ANY(ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_COMPLETION_IDENTITIES_ID_COLLISION';
  END IF;
  event_slot:=JSONB_BUILD_OBJECT('serverPostLockEventSlot',context_identity);
  transaction_slot:=JSONB_BUILD_OBJECT('serverPostLockTransactionSlot',context_identity);
  number_slot:=JSONB_BUILD_OBJECT('serverPostLockPaymentNumberSlot',context_identity);
  completion_slot:=JSONB_BUILD_OBJECT('serverPostLockCompletionOutcomeSlot',context_identity);
  row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.mutation_contexts,JSONB_BUILD_OBJECT(
    'id',context_identity,'generation',1,'actor_id',actor,'order_id',order_identity,
    'purpose',CASE WHEN kind='customer' THEN 'CUSTOMER_COMPLETION' ELSE 'LEGACY_WEBSITE_COMPLETION' END,
    'operation_id',operation_identity,'normalized_request',r,'request_fingerprint',UPPER(p->>'requestFingerprint'),
    'locked_plan',JSONB_BUILD_OBJECT('planState','FUTURE_COMPLETION_IDENTITIES_NOT_CLAIMED',
      'inventoryPlanFingerprint',UPPER(public.phase3_request_fingerprint_internal(inventory_plan))))))
    ||JSONB_BUILD_OBJECT('transaction_id',transaction_slot);
  control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts','id',context_identity,'row',row_value));
  IF kind='customer' THEN
    row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.business_operations,JSONB_BUILD_OBJECT(
      'id',operation_identity,'operation_type','phase3_customer_completion_v1','idempotency_key',p->'requestKey',
      'request_fingerprint',p->'requestFingerprint','initiated_by',actor,'request_identity_version',301,
      'request_identity_snapshot',r,'actor_scope_type','erp_user','actor_scope_hash',r->'actor_scope_hash')))
      ||JSONB_BUILD_OBJECT('created_at',event_slot,'completed_at',event_slot,'result_snapshot',completion_slot);
    control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.business_operations','id',operation_identity,'row',row_value));
  END IF;
  row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.order_status_history,JSONB_BUILD_OBJECT(
    'id',roles->'historyId','order_id',order_identity,'changed_by',actor,'old_status',
    CASE WHEN kind='customer' THEN p->'order'->'status' ELSE p->'sourceOrder'->'status' END,'new_status','completed')))
    ||JSONB_BUILD_OBJECT('created_at',event_slot);
  control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.order_status_history','id',roles->'historyId','row',row_value));
  FOR field IN SELECT value FROM UNNEST(CASE WHEN kind='customer' THEN ARRAY['parentAuditId']
    ELSE ARRAY['completionAuditId','settlementAuditId'] END) value LOOP
    row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
      'id',roles->field,'user_id',actor,'entity_name','orders','entity_id',order_identity,
      'action',CASE field WHEN 'parentAuditId' THEN 'COMPLETE_CUSTOMER_ORDER_V2'
        WHEN 'completionAuditId' THEN 'complete_order' ELSE 'COMPLETE_WEBSITE_ORDER_WITH_SETTLEMENT' END)))
      ||JSONB_BUILD_OBJECT('created_at',event_slot,'details',completion_slot);
    control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.audit_logs','id',roles->field,'row',row_value));
  END LOOP;
  IF receipt_needed THEN
    shift_identity:=CASE WHEN kind='customer' THEN CASE WHEN child->'request'->>'tenderMethod'='cash'
      THEN child->'shiftId' ELSE 'null'::JSONB END ELSE p->'selectedShift'->'id' END;
    row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.customer_payments,JSONB_BUILD_OBJECT(
      'id',roles->'childPaymentId','customer_id',CASE WHEN kind='customer' THEN p->'order'->'customer_id' ELSE p->'sourceOrder'->'customer_id' END,
      'order_id',order_identity,'created_by',actor,'cash_shift_id',shift_identity,
      'payment_method',CASE WHEN kind='customer' THEN child->'request'->'tenderMethod' ELSE p->'settlement'->'collectionMethod' END,
      'amount_in_minor_units',CASE WHEN kind='customer' THEN p->'capacity'->'collectedInMinorUnits' ELSE p->'settlement'->'collectedInMinorUnits' END,
      'idempotency_key',CASE WHEN kind='customer' THEN child->'request'->'idempotencyKey' ELSE 'null'::JSONB END)));
    IF kind='legacy' THEN row_value:=row_value||JSONB_BUILD_OBJECT('id',roles->'legacyPaymentId'); END IF;
    row_value:=row_value||JSONB_BUILD_OBJECT('payment_number',number_slot,'created_at',event_slot);
    control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.customer_payments','id',row_value->'id','row',row_value));
    row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::public.audit_logs,JSONB_BUILD_OBJECT(
      'id',CASE WHEN kind='customer' THEN roles->'childAuditId' ELSE roles->'legacyPaymentAuditId' END,
      'user_id',actor,'action','RECORD_CUSTOMER_PAYMENT','entity_name','customer_payments',
      'entity_id',CASE WHEN kind='customer' THEN roles->'childPaymentId' ELSE roles->'legacyPaymentId' END)))
      ||JSONB_BUILD_OBJECT('created_at',event_slot,'details',completion_slot);
    control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.audit_logs','id',row_value->'id','row',row_value));
    IF kind='customer' THEN
      row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.financial_operation_events,JSONB_BUILD_OBJECT(
        'id',roles->'childOperationId','operation_type','customer_collection_v1','actor_scope_type','erp_user',
        'actor_scope_id',actor,'idempotency_key',child->'request'->'idempotencyKey','result_type','customer_collection_committed_v1')))
        ||JSONB_BUILD_OBJECT('operation_event_at',event_slot,'request_fingerprint',completion_slot,
          'request_identity_snapshot',completion_slot,'result_snapshot',completion_slot);
      control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.financial_operation_events','id',row_value->'id','row',row_value));
      row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.collection_events,JSONB_BUILD_OBJECT(
        'id',roles->'childCollectionId','financial_operation_id',roles->'childOperationId','operation_type','customer_collection_v1',
        'original_payment_id',roles->'childPaymentId','order_id',order_identity,'customer_id',p->'order'->'customer_id',
        'cash_shift_id',shift_identity,'tender_method',child->'request'->'tenderMethod',
        'amount_in_minor_units',p->'capacity'->'collectedInMinorUnits')))||JSONB_BUILD_OBJECT('operation_event_at',event_slot);
      control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.collection_events','id',row_value->'id','row',row_value));
      row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.mutation_contexts,JSONB_BUILD_OBJECT(
        'id',child_context,'generation',1,'actor_id',actor,'order_id',order_identity,'purpose','CUSTOMER_COLLECTION',
        'operation_id',roles->'childOperationId','normalized_request',child->'request','request_fingerprint',child->'requestFingerprint',
        'locked_plan',JSONB_BUILD_OBJECT('planState','FUTURE_COMPLETION_IDENTITIES_NOT_CLAIMED','parentContextId',context_identity,
          'parentOperationId',operation_identity,'parentKey',p->'requestKey','parentRequestFingerprint',p->'requestFingerprint'))))
        ||JSONB_BUILD_OBJECT('transaction_id',transaction_slot);
      control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts','id',child_context,'row',row_value));
      row_value:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.collection_attempt_envelopes,JSONB_BUILD_OBJECT(
        'financial_operation_id',roles->'childOperationId','collection_id',roles->'childCollectionId',
        'original_payment_id',roles->'childPaymentId','payment_audit_id',roles->'childAuditId','context_id',child_context,
        'actor_id',actor,'order_id',order_identity,'idempotency_key',child->'request'->'idempotencyKey',
        'request_snapshot',child->'request','request_fingerprint',child->'requestFingerprint')))
        ||JSONB_BUILD_OBJECT('result_snapshot',completion_slot);
      control_rows:=control_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.collection_attempt_envelopes',
        'id',roles->'childOperationId','row',row_value));
      link:=JSONB_BUILD_OBJECT('parentContextId',context_identity,'parentOperationId',operation_identity,
        'childContextId',child_context,'childIdentities',child->'identities','request',child->'request',
        'requestFingerprint',child->'requestFingerprint');
    END IF;
  END IF;
  combined:=u->'plannedRows'||control_rows;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(combined) n GROUP BY n->>'relation',n->>'id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_IDENTITIES_ROW_EXACT_SET_REQUIRED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('planVersion','phase5-completion-control-identity-plan-v1','sourceKind',kind,
    'planState','FUTURE_COMPLETION_IDENTITIES_NOT_CLAIMED','allocation',allocation,'identityOwners',ownership,
    'sourceUnion',source_union,'inventoryPlan',inventory_plan,'controlRows',control_rows,'plannedRows',combined,
    'existingResources',existing,'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(combined,existing),'childLink',link,
    'requiredExecutionSlots',JSONB_BUILD_OBJECT('event',event_slot,'transaction',transaction_slot,'paymentNumber',
      CASE WHEN receipt_needed THEN number_slot ELSE 'null'::JSONB END,'completionOutcome',completion_slot,
      'inventorySequences','EXACT_PER_SOURCE_SERVER_POST_LOCK_ALLOCATION'),
    'identityAndDirectFkCoverageComplete',TRUE,'fullRowSemanticsComplete',FALSE,'sourceBindingComplete',FALSE,
    'futureWriteOwnershipComplete',FALSE,'executionAuthority',FALSE,'durableClaimsCreated',FALSE,'locksHeld',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.complete_completion_identity_plan_v1(UUID,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.complete_completion_identity_plan_v1(UUID,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_completion_identity_union_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,
  stock_allocation JSONB,movement_allocation JSONB,completion_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE inventory_plan JSONB; source_union JSONB; allocation JSONB; result JSONB;
BEGIN
  inventory_plan:=phase5_private.plan_customer_inventory_identity_union_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,stock_allocation,movement_allocation);
  source_union:=phase5_private.discover_customer_completion_union_v1(order_identity,request_key,method,amount,delivery,reference,notes);
  allocation:=COALESCE(completion_allocation,JSONB_BUILD_OBJECT('contextId',gen_random_uuid(),'operationId',gen_random_uuid(),
    'parentAuditId',gen_random_uuid(),'historyId',gen_random_uuid()));
  result:=phase5_private.complete_completion_identity_plan_v1(auth.uid(),'customer',inventory_plan,source_union,allocation);
  RETURN result||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_completion_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_completion_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_completion_identity_union_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_customer_completion_identity_union_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,
    expected->'inventoryPlan'->'sourcePlan'->'inventoryModel'->'allocation',
    expected->'inventoryPlan'->'inventoryUnion'->'movementAllocation',expected->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_IDENTITIES_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_completion_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_completion_identity_union_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_completion_identity_union_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,
  stock_allocation JSONB,movement_allocation JSONB,completion_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE inventory_plan JSONB; source_union JSONB; allocation JSONB; result JSONB;
BEGIN
  inventory_plan:=phase5_private.plan_legacy_inventory_identity_union_v1(
    order_identity,method,amount,delivery,reference,notes,stock_allocation,movement_allocation);
  source_union:=inventory_plan->'sourcePlan'->'sourcePlan';
  allocation:=COALESCE(completion_allocation,JSONB_BUILD_OBJECT('contextId',gen_random_uuid(),'historyId',gen_random_uuid(),
    'completionAuditId',gen_random_uuid(),'settlementAuditId',gen_random_uuid(),'receipt',
    CASE WHEN source_union->'commercial'->'settlement'->'receiptRequired'='true'::JSONB
      THEN JSONB_BUILD_OBJECT('paymentId',gen_random_uuid(),'auditId',gen_random_uuid()) ELSE 'null'::JSONB END));
  result:=phase5_private.complete_completion_identity_plan_v1(auth.uid(),'legacy',inventory_plan,source_union,allocation);
  RETURN result||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_completion_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_completion_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_completion_identity_union_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_completion_identity_union_v1(
    order_identity,method,amount,delivery,reference,notes,
    expected->'inventoryPlan'->'sourcePlan'->'inventoryModel'->'allocation',
    expected->'inventoryPlan'->'inventoryUnion'->'movementAllocation',expected->'allocation') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_IDENTITIES_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB)
  FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_identity_union_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Completion business-row samples. Explicit hypothetical clock/sequence values
-- resolve the identity projection through the existing pure source models.
-- These samples are NOT stored contexts, held locks, allocated sequence values,
-- durable outcomes or an execution permit. Actual post-lock sampling/claims and
-- complete stock-trigger/transport writer convergence remain separate gates.
CREATE FUNCTION phase5_private.completion_execution_slot_catalog_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE rows JSONB;
BEGIN
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',n.nspname||'.'||c.relname,'oid',c.oid,
    'owner',PG_GET_USERBYID(c.relowner),'acl',TO_JSONB(c.relacl),'configuration',TO_JSONB(s)) ORDER BY c.oid)
    INTO rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
    WHERE c.oid IN (TO_REGCLASS('public.inventory_movement_mutation_seq'),TO_REGCLASS('public.customer_payment_number_seq'));
  IF JSONB_ARRAY_LENGTH(rows) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_SLOT_SEQUENCE_MISSING';
  END IF;
  RETURN JSONB_BUILD_OBJECT('catalogVersion','phase5-completion-execution-slots-v1','sequences',rows,
    'dependencies',(SELECT COALESCE(JSONB_AGG(TO_JSONB(d) ORDER BY d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]'::JSONB)
      FROM pg_depend d WHERE d.classid='pg_class'::REGCLASS AND d.objid IN
        (TO_REGCLASS('public.inventory_movement_mutation_seq'),TO_REGCLASS('public.customer_payment_number_seq'))
      OR d.refclassid='pg_class'::REGCLASS AND d.refobjid IN
        (TO_REGCLASS('public.inventory_movement_mutation_seq'),TO_REGCLASS('public.customer_payment_number_seq'))),
    'eventProvider','transaction_timestamp AFTER_COMPLETE_CANONICAL_LOCKS',
    'transactionProvider','txid_current AFTER_COMPLETE_CANONICAL_LOCKS',
    'movementProvider','inventory_movement_mutation_seq CUSTOMER_PRODUCT_RESERVATION_OR_LEGACY_ITEM_ORDER_POST_LOCK',
    'receiptProvider','customer_payment_number_seq ONLY_WHEN_RECEIPT_REQUIRED_POST_LOCK',
    'authorityQualified',FALSE,'valuesAllocated',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.completion_execution_slot_catalog_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.completion_execution_slot_catalog_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.derive_completion_business_row_sample_v1(identity_plan JSONB, sample_values JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE kind TEXT:=identity_plan->>'sourceKind'; actor UUID:=auth.uid(); p JSONB; c JSONB; f JSONB;
  allocation JSONB:=identity_plan->'allocation'; receipt JSONB:='null'::JSONB; link JSONB;
  row_model JSONB; n JSONB; source_ids TEXT[]; supplied_ids TEXT[];
  movements JSONB:='{}'::JSONB; sequences JSONB:='{}'::JSONB; sequence_value BIGINT; previous_sequence BIGINT:=0; payment_value BIGINT;
  event_at TIMESTAMPTZ; event_text TEXT; zone TEXT; transaction_value BIGINT; number TEXT;
  contexts JSONB; inserts JSONB; combined JSONB; expected_rows JSONB; columns TEXT[]; actual_columns TEXT[];
BEGIN
  IF kind IS NULL OR kind NOT IN ('customer','legacy') OR actor IS NULL
    OR identity_plan->>'planVersion' IS DISTINCT FROM 'phase5-completion-control-identity-plan-v1'
    OR identity_plan->'sourceBindingComplete' IS DISTINCT FROM 'true'::JSONB
    OR identity_plan->'identityAndDirectFkCoverageComplete' IS DISTINCT FROM 'true'::JSONB
    OR identity_plan->'executionAuthority' IS DISTINCT FROM 'false'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_INPUT_INVALID';
  END IF;
  PERFORM phase5_private.assert_wire_keys_v1(sample_values,ARRAY['eventAt','eventTimeZone','transactionId','movementSequences','paymentSequenceValue']);
  event_text:=sample_values->>'eventAt'; zone:=sample_values->>'eventTimeZone';
  IF JSONB_TYPEOF(sample_values->'eventAt') IS DISTINCT FROM 'string' OR event_text !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    OR JSONB_TYPEOF(sample_values->'eventTimeZone') IS DISTINCT FROM 'string'
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone)
    OR JSONB_TYPEOF(sample_values->'movementSequences') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SLOTS_INVALID';
  END IF;
  event_at:=event_text::TIMESTAMPTZ;
  IF NOT ISFINITE(event_at) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SLOTS_INVALID'; END IF;
  transaction_value:=phase5_private.wire_money_v1(sample_values->'transactionId');
  IF transaction_value<=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SLOTS_INVALID'; END IF;
  p:=identity_plan->'sourceUnion';
  IF (CASE WHEN kind='customer' THEN p->'parent'->>'actorId' ELSE p->'commercial'->>'actorId' END) IS DISTINCT FROM actor::TEXT THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_ACTOR_INVALID';
  END IF;
  -- Match the existing pure writer's actual ordered source traversal, not the
  -- unrelated UUID allocation ordering. Gaps are allowed; inversion is not.
  IF kind='customer' THEN
    SELECT ARRAY_AGG(x.n->>'id' ORDER BY x.n->'row'->>'product_id',x.n->>'id') INTO source_ids
      FROM JSONB_ARRAY_ELEMENTS(p->'parent'->'resources') x(n) WHERE x.n->>'relation'='public.order_inventory_reservations';
  ELSE
    SELECT ARRAY_AGG(x.n->>'id' ORDER BY x.n->>'id' COLLATE "C") INTO source_ids
      FROM JSONB_ARRAY_ELEMENTS(p->'commercial'->'sourceItems') x(n);
  END IF;
  SELECT ARRAY_AGG(x.n->>'sourceId' ORDER BY ord) INTO supplied_ids
    FROM JSONB_ARRAY_ELEMENTS(sample_values->'movementSequences') WITH ORDINALITY x(n,ord);
  IF source_ids IS NULL OR supplied_ids IS DISTINCT FROM source_ids
    OR CARDINALITY(source_ids)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(source_ids) id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SEQUENCE_EXACT_SET_REQUIRED';
  END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(sample_values->'movementSequences') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(n,ARRAY['sourceId','sequenceValue']);
    sequence_value:=phase5_private.wire_money_v1(n->'sequenceValue');
    IF sequence_value<=previous_sequence OR EXISTS(SELECT 1 FROM JSONB_EACH(sequences) v WHERE v.value=TO_JSONB(sequence_value)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SEQUENCE_EXACT_SET_REQUIRED';
    END IF;
    sequences:=sequences||JSONB_BUILD_OBJECT(n->>'sourceId',sequence_value);
    previous_sequence:=sequence_value;
  END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(identity_plan->'inventoryPlan'->'inventoryUnion'->'movementAllocation') LOOP
    movements:=movements||JSONB_BUILD_OBJECT(n->>'sourceId',n->'movementId');
  END LOOP;
  IF kind='customer' AND p->'child'<>'null'::JSONB OR kind='legacy' AND allocation->'receipt'<>'null'::JSONB THEN
    payment_value:=phase5_private.wire_money_v1(sample_values->'paymentSequenceValue');
    IF payment_value<=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SLOTS_INVALID'; END IF;
    -- Preserve the existing UTC Customer / explicit historical Legacy zone.
    number:='CRV-'||TO_CHAR(event_at AT TIME ZONE CASE WHEN kind='customer' THEN 'UTC' ELSE zone END,'YYYYMMDD')
      ||'-'||CASE WHEN LENGTH(payment_value::TEXT)<6 THEN LPAD(payment_value::TEXT,6,'0') ELSE payment_value::TEXT END;
  ELSIF sample_values->'paymentSequenceValue' IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_RECEIPT_NOT_APPLICABLE';
  END IF;
  c:=TO_JSONB(JSONB_POPULATE_RECORD(NULL::phase5_private.mutation_contexts,JSONB_BUILD_OBJECT(
    'id',allocation->'contextId','transaction_id',transaction_value,'generation',1,'actor_id',actor,
    'order_id',CASE WHEN kind='customer' THEN p->'parent'->'orderId' ELSE p->'commercial'->'orderId' END,
    'purpose',CASE WHEN kind='customer' THEN 'CUSTOMER_COMPLETION' ELSE 'LEGACY_WEBSITE_COMPLETION' END,
    'operation_id',CASE WHEN kind='customer' THEN allocation->'operationId' ELSE 'null'::JSONB END,
    'normalized_request',CASE WHEN kind='customer' THEN p->'parent'->'request' ELSE p->'commercial'->'request' END,
    'request_fingerprint',UPPER(CASE WHEN kind='customer' THEN p->'parent'->>'requestFingerprint' ELSE p->'commercial'->>'requestFingerprint' END))));
  -- Compatibility tags for pure models only; no lock/permit helper is invoked.
  IF kind='customer' THEN
    p:=p||JSONB_BUILD_OBJECT('planState','LOCKED_PARENT_RESOURCES_ONLY','completeFor','CUSTOMER_COMPLETION_LOCK_ACQUISITION_ONLY');
    IF p->'child'<>'null'::JSONB THEN receipt:=JSONB_BUILD_OBJECT('identities',p->'child'->'identities','request',p->'child'->'request',
      'requestFingerprint',p->'child'->'requestFingerprint','paymentNumber',number,'eventAt',event_text,
      'cashShiftId',CASE WHEN p->'child'->'request'->>'tenderMethod'='cash' THEN p->'child'->'shiftId' ELSE 'null'::JSONB END); END IF;
    f:=JSONB_BUILD_OBJECT('planVersion','phase5-customer-parent-context-v1','planState','LOCKED_PARENT_PREWRITE_CONTEXT_ONLY',
      'sourcePlan',p,'operationId',allocation->'operationId','parentAuditId',allocation->'parentAuditId','historyId',allocation->'historyId',
      'eventAt',event_text,'movementIds',movements,'movementSequences',sequences,'childReceipt',receipt,
      'deltas',phase5_private.derive_customer_completion_deltas_v1(p,event_at));
    c:=c||JSONB_BUILD_OBJECT('locked_plan',f);
    row_model:=phase5_private.derive_customer_completion_writes_v1(c);
    link:=phase5_private.derive_customer_completion_child_link_v1(c);
    contexts:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts','id',c->'id','row',c));
    IF link->'context'<>'null'::JSONB THEN contexts:=contexts||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts','id',link->'context'->'id','row',link->'context')); END IF;
  ELSE
    p:=p||JSONB_BUILD_OBJECT('planState','LEGACY_RESOURCES_LOCKED_ONLY','locksHeld',TRUE);
    IF allocation->'receipt'<>'null'::JSONB THEN receipt:=allocation->'receipt'||JSONB_BUILD_OBJECT('paymentNumber',number); END IF;
    f:=JSONB_BUILD_OBJECT('planVersion','phase5-legacy-context-v1','planState','LOCKED_LEGACY_PREWRITE_CONTEXT_ONLY',
      'invocationId',allocation->'contextId','sourcePlan',p,'eventAt',event_text,'eventTimeZone',zone,
      'movementIds',movements,'movementSequences',sequences,'historyId',allocation->'historyId',
      'completionAuditId',allocation->'completionAuditId','settlementAuditId',allocation->'settlementAuditId',
      'receipt',receipt,'model',phase5_private.derive_legacy_completion_model_v1(p,event_at));
    c:=c||JSONB_BUILD_OBJECT('locked_plan',f);
    row_model:=phase5_private.derive_legacy_completion_writes_v1(c);
    contexts:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','phase5_private.mutation_contexts','id',c->'id','row',c));
  END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',x.n->'relation','id',x.n->'id','row',x.n->'after') ORDER BY ord) INTO inserts
    FROM JSONB_ARRAY_ELEMENTS(row_model->'writes') WITH ORDINALITY x(n,ord) WHERE x.n->>'action'='INSERT';
  inserts:=contexts||inserts;
  SELECT JSONB_AGG(x.n ORDER BY x.n->>'relation',x.n->>'id') INTO expected_rows FROM JSONB_ARRAY_ELEMENTS(identity_plan->'plannedRows') x(n)
    WHERE NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(identity_plan->'inventoryPlan'->'inventoryUnion'->'stockRows') stock
      WHERE stock->'relation'=x.n->'relation' AND stock->'id'=x.n->'id');
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(inserts) x(n) GROUP BY x.n->>'relation',x.n->>'id' HAVING COUNT(*)<>1)
    OR (SELECT JSONB_AGG(x.n-'row' ORDER BY x.n->>'relation',x.n->>'id') FROM JSONB_ARRAY_ELEMENTS(inserts) x(n))
      IS DISTINCT FROM (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',x.n->'relation','id',x.n->'id') ORDER BY x.n->>'relation',x.n->>'id') FROM JSONB_ARRAY_ELEMENTS(expected_rows) x(n)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_IDENTITY_SET_INVALID';
  END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(inserts) LOOP
    SELECT ARRAY_AGG(attname::TEXT ORDER BY attname) INTO columns FROM pg_attribute
      WHERE attrelid=TO_REGCLASS(n->>'relation') AND attnum>0 AND NOT attisdropped;
    SELECT ARRAY_AGG(k ORDER BY k) INTO actual_columns FROM JSONB_OBJECT_KEYS(n->'row') k;
    IF columns IS DISTINCT FROM actual_columns OR EXISTS(SELECT 1 FROM pg_attribute a
      WHERE a.attrelid=TO_REGCLASS(n->>'relation') AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
        AND n->'row'->a.attname::TEXT='null'::JSONB) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_COLUMNS_INVALID';
    END IF;
  END LOOP;
  combined:=inserts||(identity_plan->'inventoryPlan'->'inventoryUnion'->'stockRows');
  RETURN JSONB_BUILD_OBJECT('sampleVersion','phase5-completion-business-row-sample-v1','sourceKind',kind,
    'identityPlan',identity_plan,'sampleValues',sample_values,'contextSample',c,'writes',row_model->'writes',
    'businessInsertRows',inserts,'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(combined,identity_plan->'existingResources'),
    'executionSlotCatalog',phase5_private.completion_execution_slot_catalog_v1(),
    'businessRowSampleComplete',TRUE,'sampleOnly',TRUE,'sourceBindingComplete',FALSE,
    'clockAndSequenceValuesAuthoritative',FALSE,'stockTriggerRowsComplete',FALSE,
    'executionAuthority',FALSE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,'futureWriteOwnershipComplete',FALSE);
EXCEPTION WHEN INVALID_TEXT_REPRESENTATION OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW OR NUMERIC_VALUE_OUT_OF_RANGE THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_ROW_SAMPLE_SLOTS_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_completion_business_row_sample_v1(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_completion_business_row_sample_v1(JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_completion_business_rows_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  PERFORM phase5_private.assert_customer_completion_identity_union_v1(order_identity,request_key,method,amount,delivery,reference,notes,identity_plan);
  RETURN phase5_private.derive_completion_business_row_sample_v1(identity_plan,sample_values)||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_completion_business_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_completion_business_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_completion_business_rows_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  PERFORM phase5_private.assert_legacy_completion_identity_union_v1(order_identity,method,amount,delivery,reference,notes,identity_plan);
  RETURN phase5_private.derive_completion_business_row_sample_v1(identity_plan,sample_values)||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_completion_business_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_completion_business_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_completion_business_rows_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_customer_completion_business_rows_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,expected->'identityPlan',expected->'sampleValues') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_BUSINESS_ROWS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_completion_business_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_completion_business_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_completion_business_rows_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_completion_business_rows_v1(
    order_identity,method,amount,delivery,reference,notes,expected->'identityPlan',expected->'sampleValues') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_BUSINESS_ROWS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_business_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_business_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Stock-trigger row samples compose the retained ordered source model with the
-- full completion rows. These private plans do not execute trigger DML, claim
-- identities, qualify transport authority, hold locks or grant a write permit.
CREATE FUNCTION phase5_private.derive_inventory_trigger_row_sample_v1(actor UUID,model JSONB,reserved_identities UUID[])
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE manifest JSONB; step JSONB; r JSONB; instruction JSONB; row_value JSONB;
  instructions JSONB:='[]'::JSONB; steps JSONB:='[]'::JSONB; inserts JSONB:='[]'::JSONB;
  invocations JSONB:='[]'::JSONB; columns TEXT[]; actual_columns TEXT[]; side TEXT;
BEGIN
  manifest:=phase5_private.derive_inventory_identity_manifest_v1(actor,model,reserved_identities);
  FOR step IN SELECT value FROM JSONB_ARRAY_ELEMENTS(model->'steps') LOOP
    instructions:='[]'::JSONB;
    IF step->>'alertAction' IN ('INSERT','UPDATE') THEN
      instructions:=instructions||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.stock_alerts',
        'action',step->'alertAction','identity',JSONB_BUILD_OBJECT('id',step->'alertAfter'->'id'),
        'before',step->'alertBefore','after',step->'alertAfter'));
    END IF;
    -- AFTER alert DML invokes enqueue synchronously, before sync_stock_alert's
    -- severity-change read deletion. First-wins reuse performs no event write.
    IF step->>'eventDisposition'='INSERT_NEW' THEN
      instructions:=instructions||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.automation_events',
        'action','INSERT','identity',JSONB_BUILD_OBJECT('id',step->'storedEvent'->'id'),
        'before','null'::JSONB,'after',step->'storedEvent'));
    END IF;
    IF step->'eventInvocation' IS DISTINCT FROM 'null'::JSONB THEN
      invocations:=invocations||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',step->'ordinal',
        'source',step->'source','invocation',step->'eventInvocation','disposition',step->'eventDisposition',
        'storedRow',step->'storedEvent'));
    END IF;
    FOR r IN SELECT value FROM JSONB_ARRAY_ELEMENTS(step->'deletedReads') LOOP
      instructions:=instructions||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.stock_alert_reads',
        'action','DELETE','identity',r->'identity','before',r->'row','after','null'::JSONB));
    END LOOP;
    FOR instruction IN SELECT value FROM JSONB_ARRAY_ELEMENTS(instructions) LOOP
      FOREACH side IN ARRAY ARRAY['before','after'] LOOP
        row_value:=instruction->side;
        IF row_value='null'::JSONB THEN CONTINUE; END IF;
        SELECT ARRAY_AGG(attname::TEXT ORDER BY attname) INTO columns FROM pg_attribute
          WHERE attrelid=TO_REGCLASS(instruction->>'relation') AND attnum>0 AND NOT attisdropped;
        SELECT ARRAY_AGG(k ORDER BY k) INTO actual_columns FROM JSONB_OBJECT_KEYS(row_value) k;
        IF columns IS DISTINCT FROM actual_columns OR EXISTS(SELECT 1 FROM pg_attribute a
          WHERE a.attrelid=TO_REGCLASS(instruction->>'relation') AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
            AND row_value->a.attname::TEXT='null'::JSONB) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_TRIGGER_ROW_COLUMNS_INVALID';
        END IF;
      END LOOP;
      IF instruction->>'action'='INSERT' THEN
        inserts:=inserts||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',instruction->'relation',
          'id',instruction->'identity'->'id','row',instruction->'after'));
      END IF;
    END LOOP;
    steps:=steps||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',step->'ordinal','source',step->'source',
      'balanceBefore',step->'balanceBefore','balanceAfter',step->'balanceAfter','writes',instructions));
  END LOOP;
  IF inserts IS DISTINCT FROM model->'plannedInserts' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_TRIGGER_ROW_INSERT_EXACT_SET_REQUIRED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('sampleVersion','phase5-inventory-trigger-row-sample-v1',
    'sourceTransactionAt',model->'sourceTransactionAt','sourceModel',model,'identityManifest',manifest,
    'steps',steps,'plannedInserts',inserts,'eventInvocations',invocations,
    'triggerCatalog',phase5_private.shift_inventory_side_effect_catalog_v1(),
    'sampleOnly',TRUE,'stockTriggerRowSampleComplete',TRUE,'sourceBindingComplete',FALSE,
    'triggerIdentitiesConsumed',FALSE,'durableClaimsCreated',FALSE,'locksHeld',FALSE,
    'executionAuthority',FALSE,'futureWriteOwnershipComplete',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_inventory_trigger_row_sample_v1(UUID,JSONB,UUID[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_inventory_trigger_row_sample_v1(UUID,JSONB,UUID[]) OWNER TO postgres;

CREATE FUNCTION phase5_private.compose_completion_trigger_row_sample_v1(business_sample JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID:=auth.uid(); model JSONB; trigger_sample JSONB; step JSONB; instruction JSONB;
  business_rows JSONB:=business_sample->'businessInsertRows'; combined JSONB; writes JSONB:='[]'::JSONB;
  reserved UUID[]; ordinal INTEGER:=0; expected_stock JSONB; actual_stock JSONB;
BEGIN
  IF actor IS NULL OR business_sample->>'sampleVersion' IS DISTINCT FROM 'phase5-completion-business-row-sample-v1'
    OR business_sample->'businessRowSampleComplete' IS DISTINCT FROM 'true'::JSONB
    OR business_sample->'sourceBindingComplete' IS DISTINCT FROM 'true'::JSONB
    OR business_sample->'executionAuthority' IS DISTINCT FROM 'false'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_TRIGGER_SAMPLE_INPUT_INVALID';
  END IF;
  model:=business_sample#>'{identityPlan,inventoryPlan,sourcePlan,inventoryModel}';
  IF (business_sample#>>'{sampleValues,eventAt}')::TIMESTAMPTZ IS DISTINCT FROM (model->>'sourceTransactionAt')::TIMESTAMPTZ THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_TRIGGER_CLOCK_INVALID';
  END IF;
  SELECT ARRAY_AGG((n->>'id')::UUID) INTO reserved FROM JSONB_ARRAY_ELEMENTS(business_rows) n;
  trigger_sample:=phase5_private.derive_inventory_trigger_row_sample_v1(actor,model,reserved);
  FOR instruction IN SELECT value FROM JSONB_ARRAY_ELEMENTS(business_sample->'writes') LOOP
    writes:=writes||JSONB_BUILD_ARRAY(instruction);
    IF instruction->>'relation'='public.inventory_balances' THEN
      step:=trigger_sample->'steps'->ordinal;
      IF step IS NULL OR instruction->>'action' IS DISTINCT FROM 'UPDATE'
        OR instruction->'id' IS DISTINCT FROM step->'source'->'balanceId'
        OR instruction->'before' IS DISTINCT FROM step->'balanceBefore'
        OR instruction->'after' IS DISTINCT FROM step->'balanceAfter' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_TRIGGER_SOURCE_EXACT_SET_REQUIRED';
      END IF;
      writes:=writes||(step->'writes'); ordinal:=ordinal+1;
    END IF;
  END LOOP;
  IF ordinal IS DISTINCT FROM JSONB_ARRAY_LENGTH(trigger_sample->'steps') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_TRIGGER_SOURCE_EXACT_SET_REQUIRED';
  END IF;
  SELECT COALESCE(JSONB_AGG(n ORDER BY n->>'relation',n->>'id'),'[]'::JSONB) INTO actual_stock
    FROM JSONB_ARRAY_ELEMENTS(trigger_sample->'plannedInserts') n;
  SELECT COALESCE(JSONB_AGG(n ORDER BY n->>'relation',n->>'id'),'[]'::JSONB) INTO expected_stock
    FROM JSONB_ARRAY_ELEMENTS(business_sample#>'{identityPlan,inventoryPlan,inventoryUnion,stockRows}') n;
  IF actual_stock IS DISTINCT FROM expected_stock THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_TRIGGER_INSERT_EXACT_SET_REQUIRED';
  END IF;
  combined:=business_rows||(trigger_sample->'plannedInserts');
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(combined) n GROUP BY n->>'relation',n->>'id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_TRIGGER_INSERT_EXACT_SET_REQUIRED';
  END IF;
  RETURN JSONB_BUILD_OBJECT('sampleVersion','phase5-completion-with-trigger-rows-v1','businessSample',business_sample,
    'triggerSample',trigger_sample,'writes',writes,'plannedInsertRows',combined,
    'foreignKeys',phase5_private.shift_insert_fk_coverage_v1(combined,business_sample#>'{identityPlan,existingResources}'),
    'sampleOnly',TRUE,'businessAndStockRowSampleComplete',TRUE,'sourceBindingComplete',FALSE,
    'clockAndSequenceValuesAuthoritative',FALSE,'triggerIdentitiesConsumed',FALSE,'durableClaimsCreated',FALSE,
    'locksHeld',FALSE,'executionAuthority',FALSE,'futureWriteOwnershipComplete',FALSE);
EXCEPTION WHEN INVALID_TEXT_REPRESENTATION OR INVALID_DATETIME_FORMAT OR DATETIME_FIELD_OVERFLOW THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_TRIGGER_SAMPLE_INPUT_INVALID';
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.compose_completion_trigger_row_sample_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.compose_completion_trigger_row_sample_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_completion_trigger_rows_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  RETURN phase5_private.compose_completion_trigger_row_sample_v1(phase5_private.plan_customer_completion_business_rows_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,identity_plan,sample_values))||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_completion_trigger_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_completion_trigger_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_completion_trigger_rows_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  RETURN phase5_private.compose_completion_trigger_row_sample_v1(phase5_private.plan_legacy_completion_business_rows_v1(
    order_identity,method,amount,delivery,reference,notes,identity_plan,sample_values))||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_completion_trigger_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_completion_trigger_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_completion_trigger_rows_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_customer_completion_trigger_rows_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,expected#>'{businessSample,identityPlan}',expected#>'{businessSample,sampleValues}') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_TRIGGER_ROWS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_completion_trigger_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_completion_trigger_rows_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_completion_trigger_rows_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_completion_trigger_rows_v1(
    order_identity,method,amount,delivery,reference,notes,expected#>'{businessSample,identityPlan}',expected#>'{businessSample,sampleValues}') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_TRIGGER_ROWS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_trigger_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_trigger_rows_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Completion execution groups are a preparation protocol. One balance write and
-- its synchronous trigger writes form an indivisible group. Full prefix states
-- include future INSERT absence and composite read identities; no ordinal alone
-- is a permit. Context binding, held ownership and durable progress remain later.
CREATE FUNCTION phase5_private.derive_completion_execution_groups_v1(sample JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE business JSONB:=sample->'businessSample'; instruction JSONB; nested JSONB; step JSONB;
  groups JSONB:='[]'::JSONB; grouped JSONB; all_writes JSONB:='[]'::JSONB; g JSONB; n JSONB;
  states JSONB:='{}'::JSONB; initial_states JSONB; identity JSONB; expected_identity JSONB;
  key TEXT; side TEXT; row_value JSONB; relation_name TEXT; primary_columns TEXT[];
  columns TEXT[]; actual_columns TEXT[]; c TEXT; position INTEGER:=0; source_ordinal INTEGER:=0;
  group_ordinal INTEGER:=0; business_ordinal INTEGER:=0; before_states JSONB;
  inserted JSONB:='[]'::JSONB; expected_inserts JSONB; actual_inserts JSONB;
BEGIN
  IF auth.uid() IS NULL OR sample->>'sampleVersion' IS DISTINCT FROM 'phase5-completion-with-trigger-rows-v1'
    OR sample->'businessAndStockRowSampleComplete' IS DISTINCT FROM 'true'::JSONB
    OR sample->'sourceBindingComplete' IS DISTINCT FROM 'true'::JSONB
    OR sample->'executionAuthority' IS DISTINCT FROM 'false'::JSONB
    OR business->'contextSample'->>'actor_id' IS DISTINCT FROM auth.uid()::TEXT
    OR JSONB_TYPEOF(sample->'writes') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(business->'writes') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(sample->'plannedInsertRows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_GROUP_SAMPLE_INVALID';
  END IF;
  -- The retained executors create parent/optional child contexts before source
  -- writes. They are separate INSERTs, not evidence manufactured by stock DML.
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(business->'businessInsertRows')
    WHERE value->>'relation'='phase5_private.mutation_contexts' LOOP
    instruction:=JSONB_BUILD_OBJECT('relation',n->'relation','action','INSERT','id',n->'id',
      'before','null'::JSONB,'after',n->'row');
    group_ordinal:=group_ordinal+1;
    groups:=groups||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',group_ordinal,'kind','CONTEXT_PRELUDE',
      'businessWriteOrdinal','null'::JSONB,'source','null'::JSONB,'writes',JSONB_BUILD_ARRAY(instruction)));
    all_writes:=all_writes||JSONB_BUILD_ARRAY(instruction);
  END LOOP;
  FOR instruction IN SELECT value FROM JSONB_ARRAY_ELEMENTS(business->'writes') LOOP
    business_ordinal:=business_ordinal+1;
    IF sample->'writes'->position IS DISTINCT FROM instruction THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_ORDER_INVALID';
    END IF;
    position:=position+1; grouped:=JSONB_BUILD_ARRAY(instruction); step:=NULL;
    IF instruction->>'relation'='public.inventory_balances' THEN
      step:=sample->'triggerSample'->'steps'->source_ordinal;
      IF step IS NULL OR instruction->'id' IS DISTINCT FROM step->'source'->'balanceId'
        OR instruction->'before' IS DISTINCT FROM step->'balanceBefore'
        OR instruction->'after' IS DISTINCT FROM step->'balanceAfter'
        OR JSONB_TYPEOF(step->'writes') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_SOURCE_INVALID';
      END IF;
      FOR nested IN SELECT value FROM JSONB_ARRAY_ELEMENTS(step->'writes') LOOP
        IF sample->'writes'->position IS DISTINCT FROM nested THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_ORDER_INVALID';
        END IF;
        grouped:=grouped||JSONB_BUILD_ARRAY(nested); position:=position+1;
      END LOOP;
      source_ordinal:=source_ordinal+1;
    END IF;
    group_ordinal:=group_ordinal+1;
    groups:=groups||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',group_ordinal,
      'kind',CASE WHEN step IS NULL THEN 'BUSINESS_WRITE' ELSE 'BALANCE_WITH_SYNCHRONOUS_TRIGGERS' END,
      'businessWriteOrdinal',business_ordinal,'source',COALESCE(step->'source','null'::JSONB),'writes',grouped));
    all_writes:=all_writes||grouped;
  END LOOP;
  IF position IS DISTINCT FROM JSONB_ARRAY_LENGTH(sample->'writes')
    OR source_ordinal IS DISTINCT FROM JSONB_ARRAY_LENGTH(sample->'triggerSample'->'steps') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_ORDER_INVALID';
  END IF;
  -- Primary keys come from the installed catalog. No composite key is coerced
  -- into one UUID, and every repeated write must start at its prior full after.
  FOR instruction IN SELECT value FROM JSONB_ARRAY_ELEMENTS(all_writes) LOOP
    relation_name:=instruction->>'relation';
    IF relation_name IS NULL OR relation_name NOT IN ('public.inventory_balances','public.order_inventory_reservations',
      'public.inventory_movements','public.order_items','public.order_parcel_instances','public.order_parcel_components',
      'public.orders','public.business_operations','public.order_status_history','public.audit_logs','public.customer_payments',
      'public.stock_alerts','public.stock_alert_reads','public.automation_events','phase5_private.mutation_contexts',
      'phase5_private.financial_operation_events','phase5_private.collection_events','phase5_private.collection_attempt_envelopes')
      OR instruction->>'action' IS NULL OR instruction->>'action' NOT IN ('INSERT','UPDATE','DELETE') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_ROW_INVALID';
    END IF;
    PERFORM phase5_private.assert_wire_keys_v1(instruction,CASE WHEN instruction ? 'identity'
      THEN ARRAY['relation','action','identity','before','after'] ELSE ARRAY['relation','action','id','before','after'] END);
    IF (instruction->>'action'='INSERT' AND (instruction->'before' IS DISTINCT FROM 'null'::JSONB OR JSONB_TYPEOF(instruction->'after') IS DISTINCT FROM 'object'))
      OR (instruction->>'action'='UPDATE' AND (JSONB_TYPEOF(instruction->'before') IS DISTINCT FROM 'object' OR JSONB_TYPEOF(instruction->'after') IS DISTINCT FROM 'object'))
      OR (instruction->>'action'='DELETE' AND (JSONB_TYPEOF(instruction->'before') IS DISTINCT FROM 'object' OR instruction->'after' IS DISTINCT FROM 'null'::JSONB)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_ROW_INVALID';
    END IF;
    SELECT ARRAY_AGG(a.attname::TEXT ORDER BY k.ord) INTO primary_columns FROM pg_index i
      CROSS JOIN UNNEST(i.indkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
      WHERE i.indrelid=TO_REGCLASS(relation_name) AND i.indisprimary AND k.ord<=i.indnkeyatts;
    IF primary_columns IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_KEY_INVALID'; END IF;
    identity:=NULL;
    FOREACH side IN ARRAY ARRAY['before','after'] LOOP
      row_value:=instruction->side;
      IF row_value='null'::JSONB THEN CONTINUE; END IF;
      SELECT ARRAY_AGG(attname::TEXT ORDER BY attname) INTO columns FROM pg_attribute
        WHERE attrelid=TO_REGCLASS(relation_name) AND attnum>0 AND NOT attisdropped;
      SELECT ARRAY_AGG(k ORDER BY k) INTO actual_columns FROM JSONB_OBJECT_KEYS(row_value) k;
      IF columns IS DISTINCT FROM actual_columns OR EXISTS(SELECT 1 FROM pg_attribute a
        WHERE a.attrelid=TO_REGCLASS(relation_name) AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull
          AND row_value->a.attname::TEXT='null'::JSONB) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_COLUMNS_INVALID';
      END IF;
      expected_identity:='{}'::JSONB;
      FOREACH c IN ARRAY primary_columns LOOP
        PERFORM phase5_private.wire_uuid_v1(row_value->c);
        expected_identity:=expected_identity||JSONB_BUILD_OBJECT(c,row_value->c);
      END LOOP;
      IF identity IS NOT NULL AND identity IS DISTINCT FROM expected_identity THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_KEY_INVALID';
      END IF;
      identity:=expected_identity;
    END LOOP;
    IF (instruction ? 'identity' AND instruction->'identity' IS DISTINCT FROM identity)
      OR (NOT instruction ? 'identity' AND (CARDINALITY(primary_columns)<>1 OR instruction->'id' IS DISTINCT FROM identity->primary_columns[1])) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_KEY_INVALID';
    END IF;
    key:=relation_name||'|'||identity::TEXT;
    IF NOT states ? key THEN states:=states||JSONB_BUILD_OBJECT(key,JSONB_BUILD_OBJECT('relation',relation_name,'identity',identity,'row',instruction->'before')); END IF;
    IF instruction->>'action'='INSERT' THEN inserted:=inserted||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',relation_name,'id',instruction->'after'->primary_columns[1],'row',instruction->'after')); END IF;
  END LOOP;
  SELECT COALESCE(JSONB_AGG(x.value ORDER BY x.value->>'relation',x.value->>'id'),'[]'::JSONB) INTO actual_inserts FROM JSONB_ARRAY_ELEMENTS(inserted) x;
  SELECT COALESCE(JSONB_AGG(x.value ORDER BY x.value->>'relation',x.value->>'id'),'[]'::JSONB) INTO expected_inserts FROM JSONB_ARRAY_ELEMENTS(sample->'plannedInsertRows') x;
  IF actual_inserts IS DISTINCT FROM expected_inserts OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(inserted) x
    GROUP BY x.value->>'relation',x.value->>'id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_INSERT_SET_INVALID';
  END IF;
  initial_states:=states; grouped:='[]'::JSONB;
  FOR g IN SELECT value FROM JSONB_ARRAY_ELEMENTS(groups) LOOP
    before_states:=states;
    FOR instruction IN SELECT value FROM JSONB_ARRAY_ELEMENTS(g->'writes') LOOP
      relation_name:=instruction->>'relation'; row_value:=CASE WHEN instruction->'after'='null'::JSONB THEN instruction->'before' ELSE instruction->'after' END;
      SELECT JSONB_OBJECT_AGG(a.attname,row_value->a.attname::TEXT) INTO identity FROM pg_index i
        CROSS JOIN UNNEST(i.indkey) WITH ORDINALITY k(attnum,ord)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        WHERE i.indrelid=TO_REGCLASS(relation_name) AND i.indisprimary AND k.ord<=i.indnkeyatts;
      key:=relation_name||'|'||identity::TEXT;
      IF states->key->'row' IS DISTINCT FROM instruction->'before' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_GROUP_PREFIX_INVALID';
      END IF;
      states:=JSONB_SET(states,ARRAY[key,'row'],instruction->'after');
    END LOOP;
    grouped:=grouped||JSONB_BUILD_ARRAY(g||JSONB_BUILD_OBJECT('beforeStates',before_states,'afterStates',states));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('protocolVersion','phase5-completion-execution-groups-v1','rowSample',sample,
    'initialStates',initial_states,'groups',grouped,'finalStates',states,
    'sampleOnly',TRUE,'sourceBindingComplete',FALSE,'groupBoundariesComplete',TRUE,
    'durableClaimsCreated',FALSE,'progressRecorded',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.derive_completion_execution_groups_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_completion_execution_groups_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_customer_completion_execution_groups_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  RETURN phase5_private.derive_completion_execution_groups_v1(phase5_private.plan_customer_completion_trigger_rows_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,identity_plan,sample_values))||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_customer_completion_execution_groups_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_customer_completion_execution_groups_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_legacy_completion_execution_groups_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,identity_plan JSONB,sample_values JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  RETURN phase5_private.derive_completion_execution_groups_v1(phase5_private.plan_legacy_completion_trigger_rows_v1(
    order_identity,method,amount,delivery,reference,notes,identity_plan,sample_values))||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_legacy_completion_execution_groups_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_legacy_completion_execution_groups_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_customer_completion_execution_groups_v1(
  order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_customer_completion_execution_groups_v1(
    order_identity,request_key,method,amount,delivery,reference,notes,expected#>'{rowSample,businessSample,identityPlan}',expected#>'{rowSample,businessSample,sampleValues}') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_GROUPS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_customer_completion_execution_groups_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_customer_completion_execution_groups_v1(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_legacy_completion_execution_groups_v1(
  order_identity UUID,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.plan_legacy_completion_execution_groups_v1(
    order_identity,method,amount,delivery,reference,notes,expected#>'{rowSample,businessSample,identityPlan}',expected#>'{rowSample,businessSample,sampleValues}') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_GROUPS_CHANGED_RETRY';
  END IF; RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_legacy_completion_execution_groups_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_legacy_completion_execution_groups_v1(UUID,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Context progress storage and deterministic ownership protocol, still inactive.
-- NULL keeps historical/private executors unchanged. The existing INSERT and
-- immutable UPDATE barriers are NOT replaced: simulated receipts are never
-- evidence that a lock, INSERT, or durable ownership claim actually occurred.
ALTER TABLE phase5_private.mutation_contexts ADD COLUMN side_effect_progress JSONB;
ALTER TABLE phase5_private.mutation_contexts ADD CONSTRAINT phase5_context_progress_shape
  CHECK (side_effect_progress IS NULL OR (JSONB_TYPEOF(side_effect_progress) = 'object'
    AND side_effect_progress->>'progressVersion' IS NOT NULL
    AND side_effect_progress->>'progressVersion' = 'phase5-completion-progress-v1'));

-- Internal hypothetical event fold. It does NOT qualify a source/protocol;
-- only model/advance below recompile the retained protocol before using it.
-- Raw invocation remains private and returns no durable/execution authority.
CREATE FUNCTION phase5_private.fold_completion_progress_v1(protocol JSONB, events JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE g JSONB; w JSONB; e JSONB; claims JSONB:='[]'::JSONB;
  consumed JSONB:='[]'::JSONB; states JSONB; context_row JSONB; claim JSONB;
  next_group INTEGER:=1; next_write INTEGER:=1; completed_writes INTEGER:=0;
  active BOOLEAN:=FALSE; state TEXT:='READY'; group_count INTEGER; ordinal INTEGER;
BEGIN
  PERFORM phase5_private.assert_wire_keys_v1(protocol,ARRAY['protocolVersion','rowSample','initialStates','groups','finalStates',
    'sampleOnly','sourceBindingComplete','groupBoundariesComplete','durableClaimsCreated','progressRecorded','locksHeld','executionAuthority']);
  IF protocol->'sourceBindingComplete' IS DISTINCT FROM 'true'::JSONB
    OR JSONB_TYPEOF(events) IS DISTINCT FROM 'array' OR auth.uid() IS NULL
    OR protocol#>>'{rowSample,businessSample,contextSample,actor_id}' IS DISTINCT FROM auth.uid()::TEXT THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_INPUT_INVALID';
  END IF;
  context_row:=protocol#>'{rowSample,businessSample,contextSample}';
  group_count:=JSONB_ARRAY_LENGTH(protocol->'groups'); states:=protocol->'initialStates';
  IF group_count=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_PROTOCOL_INVALID'; END IF;
  -- An INSERT identity is owned by its exact context/group/write/tuple, never
  -- just a count or UUID. REUSE and composite DELETE nodes mint no INSERT claim.
  FOR g IN SELECT value FROM JSONB_ARRAY_ELEMENTS(protocol->'groups') LOOP
    ordinal:=0;
    FOR w IN SELECT value FROM JSONB_ARRAY_ELEMENTS(g->'writes') LOOP
      ordinal:=ordinal+1;
      IF w->>'action'='INSERT' THEN
        claims:=claims||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('contextId',context_row->'id',
          'groupOrdinal',g->'ordinal','writeOrdinal',ordinal,'relation',w->'relation','id',w->'id','row',w->'after'));
      END IF;
    END LOOP;
  END LOOP;
  FOR e IN SELECT value FROM JSONB_ARRAY_ELEMENTS(events) LOOP
    IF state='COMPLETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_AFTER_COMPLETE'; END IF;
    g:=protocol->'groups'->(next_group-1);
    IF e->>'kind'='BEGIN_GROUP' THEN
      PERFORM phase5_private.assert_wire_keys_v1(e,ARRAY['kind','groupOrdinal','beforeStates']);
      IF active OR e->'groupOrdinal' IS DISTINCT FROM TO_JSONB(next_group)
        OR e->'beforeStates' IS DISTINCT FROM states OR states IS DISTINCT FROM g->'beforeStates' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_BEGIN_INVALID';
      END IF;
      active:=TRUE; state:='IN_GROUP';
    ELSIF e->>'kind'='OBSERVE_WRITE' THEN
      PERFORM phase5_private.assert_wire_keys_v1(e,ARRAY['kind','groupOrdinal','writeOrdinal','instruction']);
      w:=g->'writes'->(next_write-1);
      IF NOT active OR w IS NULL OR e->'groupOrdinal' IS DISTINCT FROM TO_JSONB(next_group)
        OR e->'writeOrdinal' IS DISTINCT FROM TO_JSONB(next_write) OR e->'instruction' IS DISTINCT FROM w THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_WRITE_INVALID';
      END IF;
      IF w->>'action'='INSERT' THEN
        SELECT x.value INTO STRICT claim FROM JSONB_ARRAY_ELEMENTS(claims) x
          WHERE x.value->'groupOrdinal'=TO_JSONB(next_group) AND x.value->'writeOrdinal'=TO_JSONB(next_write);
        IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(consumed) x
          WHERE x.value->'relation'=claim->'relation' AND x.value->'id'=claim->'id') THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_DUPLICATE_IDENTITY';
        END IF;
        consumed:=consumed||JSONB_BUILD_ARRAY(claim);
      END IF;
      next_write:=next_write+1; completed_writes:=completed_writes+1;
    ELSIF e->>'kind'='FINISH_GROUP' THEN
      PERFORM phase5_private.assert_wire_keys_v1(e,ARRAY['kind','groupOrdinal','afterStates']);
      IF NOT active OR e->'groupOrdinal' IS DISTINCT FROM TO_JSONB(next_group)
        OR next_write IS DISTINCT FROM JSONB_ARRAY_LENGTH(g->'writes')+1
        OR e->'afterStates' IS DISTINCT FROM g->'afterStates' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_FINISH_INVALID';
      END IF;
      states:=g->'afterStates'; next_group:=next_group+1; next_write:=1; active:=FALSE;
      state:=CASE WHEN next_group>group_count THEN 'COMPLETE' ELSE 'READY' END;
    ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_EVENT_INVALID'; END IF;
  END LOOP;
  IF state='COMPLETE' AND (consumed IS DISTINCT FROM claims OR states IS DISTINCT FROM protocol->'finalStates') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_EXACT_SET_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('progressVersion','phase5-completion-progress-v1','contextId',context_row->'id',
    'actorId',context_row->'actor_id','transactionId',context_row->'transaction_id','generation',context_row->'generation',
    'protocolFingerprint',UPPER(public.phase3_request_fingerprint_internal(protocol)),
    'state',state,'nextGroupOrdinal',next_group,'nextWriteOrdinal',next_write,'completedGroups',next_group-1,
    'completedWrites',completed_writes,'expectedInsertClaims',claims,'observedInsertClaims',consumed,
    'visibleStates',states,'events',events,'sampleOnly',TRUE,'durableClaimsCreated',FALSE,
    'progressRecorded',FALSE,'locksHeld',FALSE,'executionAuthority',FALSE);
END;
$$;
REVOKE ALL ON FUNCTION phase5_private.fold_completion_progress_v1(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.fold_completion_progress_v1(JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.model_completion_progress_v1(protocol JSONB, events JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  -- Complete protocol equality is required, not a caller-selected hash/flag.
  -- Source revalidation by Customer/Legacy assertions remains separate.
  IF protocol IS DISTINCT FROM (phase5_private.derive_completion_execution_groups_v1(protocol->'rowSample')
    ||JSONB_BUILD_OBJECT('sourceBindingComplete',TRUE)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_PROTOCOL_INVALID';
  END IF;
  RETURN phase5_private.fold_completion_progress_v1(protocol,events);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.model_completion_progress_v1(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.model_completion_progress_v1(JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.advance_completion_progress_v1(protocol JSONB, previous JSONB, event JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF previous IS DISTINCT FROM phase5_private.model_completion_progress_v1(protocol,previous->'events') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_STATE_INVALID';
  END IF;
  -- model above has just checked this exact protocol, actor and entire previous
  -- history. Fold the extended trace without a second catalog/protocol rebuild.
  RETURN phase5_private.fold_completion_progress_v1(protocol,(previous->'events')||JSONB_BUILD_ARRAY(event));
END; $$;
REVOKE ALL ON FUNCTION phase5_private.advance_completion_progress_v1(JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.advance_completion_progress_v1(JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_completion_progress_complete_v1(protocol JSONB, progress JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF progress IS DISTINCT FROM phase5_private.model_completion_progress_v1(protocol,progress->'events')
    OR progress->>'state' IS DISTINCT FROM 'COMPLETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_COMPLETION_PROGRESS_INCOMPLETE';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_completion_progress_complete_v1(JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_completion_progress_complete_v1(JSONB,JSONB) OWNER TO postgres;

-- Complete source-qualified lock union preparation. Acquisition is deliberately
-- restricted to generation0: it is NOT an activated execution/claim certificate.
CREATE FUNCTION phase5_private.merge_completion_lock_resources_v1(nodes JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE result JSONB;
BEGIN
  IF JSONB_TYPEOF(nodes) IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(nodes)=0
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(nodes) n WHERE
      JSONB_TYPEOF(n->'row') IS DISTINCT FROM 'object' OR n->>'id' IS NULL
      OR n->>'relation' IS NULL OR n->>'mode' IS NULL OR n->>'rank' IS NULL
      OR n->>'mode' NOT IN ('UPDATE','NO_KEY_UPDATE','SHARE','KEY_SHARE')
      OR n->>'rank' NOT IN ('4','5','6','7'))
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(nodes) n GROUP BY n->>'relation',n->>'id'
      HAVING COUNT(DISTINCT n->'row')<>1) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_RESOURCE_INVALID';
  END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation_name,'id',identity,'row',row_data,'rank',rank,
    'mode',CASE strength WHEN 4 THEN 'UPDATE' WHEN 3 THEN 'NO_KEY_UPDATE' WHEN 2 THEN 'SHARE' ELSE 'KEY_SHARE' END)
    ORDER BY rank,CASE relation_name WHEN 'public.orders' THEN 0 WHEN 'public.inventory_balances' THEN 1
      WHEN 'public.products' THEN 2 ELSE 3 END,relation_name COLLATE "C",
      CASE WHEN relation_name='public.inventory_balances' THEN row_data->>'product_id' ELSE identity END COLLATE "C",
      CASE WHEN relation_name='public.inventory_balances' THEN row_data->>'warehouse_id' ELSE identity END COLLATE "C")
    INTO result FROM (SELECT n->>'relation' relation_name,n->>'id' identity,n->'row' row_data,
      MIN((n->>'rank')::INT) rank,MAX(CASE n->>'mode' WHEN 'UPDATE' THEN 4 WHEN 'NO_KEY_UPDATE' THEN 3
        WHEN 'SHARE' THEN 2 ELSE 1 END) strength FROM JSONB_ARRAY_ELEMENTS(nodes) n
      GROUP BY n->>'relation',n->>'id',n->'row') merged;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.merge_completion_lock_resources_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.merge_completion_lock_resources_v1(JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.plan_completion_lock_union_v1(
  kind TEXT,order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,protocol JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE identity_plan JSONB; source_union JSONB; snapshot JSONB; nodes JSONB; resources JSONB;
BEGIN
  IF kind IS NULL OR kind NOT IN ('customer','legacy') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_LOCK_KIND_INVALID';
  END IF;
  -- Real actor/source authorization and full rederivation precede any lock.
  IF kind='customer' THEN
    PERFORM phase5_private.assert_customer_completion_execution_groups_v1(order_identity,request_key,method,amount,delivery,reference,notes,protocol);
  ELSE
    IF request_key IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_COMPLETION_LOCK_LEGACY_KEY_INVALID'; END IF;
    PERFORM phase5_private.assert_legacy_completion_execution_groups_v1(order_identity,method,amount,delivery,reference,notes,protocol);
  END IF;
  identity_plan:=protocol#>'{rowSample,businessSample,identityPlan}';
  source_union:=identity_plan->'sourceUnion';
  snapshot:=identity_plan#>'{inventoryPlan,sourcePlan,inventoryModel,sourceSnapshot}';
  nodes:=(source_union->'resources')||(snapshot->'resources')||(snapshot->'compositeResources')||(snapshot->'parents');
  resources:=phase5_private.merge_completion_lock_resources_v1(nodes);
  -- All existing direct FK rows must be covered, including the real composite
  -- read keys absent from the older identity-only existingResources array.
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(identity_plan->'existingResources') e WHERE NOT EXISTS(
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) r WHERE r->'relation'=e->'relation'
        AND r->'id'=e->'id' AND r->'row'=e->'row'))
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(snapshot->'compositeResources') e WHERE NOT EXISTS(
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) r WHERE r->'relation'=e->'relation'
        AND r->'id'=e->'id' AND r->'row'=e->'row')) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_COVERAGE_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('lockPlanVersion','phase5-completion-lock-union-v1','kind',kind,'orderId',order_identity,
    'protocol',protocol,'resources',resources,'keyGates',COALESCE(source_union->'keyGates','[]'::JSONB),
    'rootGates',source_union->'rootGates','sharedGates',source_union->'sharedGates',
    'inventoryGates',source_union->'inventoryGates','predicateSnapshot',snapshot->'domains',
    'foreignKeys',protocol->'rowSample'->'foreignKeys','sourceBindingComplete',TRUE,
    'locksHeld',FALSE,'absencePredicatesFenced',FALSE,'writerClosed',FALSE,'executionAuthority',FALSE,
    'durableClaimsCreated',FALSE,'contextCreated',FALSE,'progressRecorded',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_completion_lock_union_v1(TEXT,UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_completion_lock_union_v1(TEXT,UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.acquire_completion_lock_union_v1(
  kind TEXT,order_identity UUID,request_key TEXT,method TEXT,amount BIGINT,delivery BIGINT,reference TEXT,notes TEXT,expected JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; n JSONB; gate TEXT; identity UUID; actual JSONB;
BEGIN
  plan:=phase5_private.plan_completion_lock_union_v1(kind,order_identity,request_key,method,amount,delivery,reference,notes,expected->'protocol');
  IF expected IS DISTINCT FROM plan THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation
    LEFT JOIN pg_index i ON i.indexrelid=c.oid LEFT JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE l.pid=pg_backend_pid() AND l.granted AND (l.locktype='advisory' OR
      (ns.nspname IN ('public','auth','phase5_private') AND l.mode<>'AccessShareLock'
       AND COALESCE(i.indrelid,c.oid) NOT IN ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS)))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_LATE_ENTRY_RETRY';
  END IF;
  PERFORM 1 FROM phase5_private.authority_generation WHERE singleton AND generation=0
    AND authority_state='PRIVATE_INACTIVE' AND manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099'
    FOR SHARE NOWAIT;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM phase5_private.activation_receipts) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_COMPLETION_LOCK_PREPARATION_ONLY';
  END IF;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'keyGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'rootGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'sharedGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  -- Retain stage4 Shift rows then stage5 root Order, before the SKU domains.
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WHERE value->>'rank'='4' LOOP
    IF n->>'relation' IS DISTINCT FROM 'public.cash_shifts' OR n->>'mode' IS DISTINCT FROM 'UPDATE' THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_MODE_INVALID'; END IF;
    SELECT TO_JSONB(t) INTO actual FROM public.cash_shifts t WHERE id=(n->>'id')::UUID FOR UPDATE NOWAIT;
    IF actual IS DISTINCT FROM n->'row' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_ROW_CHANGED'; END IF;
  END LOOP;
  SELECT TO_JSONB(t) INTO actual FROM public.orders t WHERE id=order_identity FOR UPDATE NOWAIT;
  IF actual IS DISTINCT FROM (SELECT value->'row' FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WHERE value->>'relation'='public.orders' AND value->>'id'=order_identity::TEXT) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_ROW_CHANGED'; END IF;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'inventoryGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal)
    WHERE (value->>'rank')::INT>=5 ORDER BY ordinal LOOP
    identity:=CASE WHEN n->>'relation' IN ('public.user_roles','public.stock_alert_reads') THEN NULL ELSE phase5_private.wire_uuid_v1(n->'id') END;
    actual:=NULL;
    CASE n->>'relation'
      WHEN 'public.orders' THEN
        IF identity IS DISTINCT FROM order_identity OR n->>'mode' IS DISTINCT FROM 'UPDATE' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_MODE_INVALID'; END IF;
        CONTINUE;
      WHEN 'public.inventory_balances' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_balances t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.products' THEN SELECT TO_JSONB(t) INTO actual FROM public.products t WHERE id=identity FOR NO KEY UPDATE NOWAIT;
      WHEN 'public.order_items' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_items t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.order_parcel_instances' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_parcel_instances t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.order_parcel_components' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_parcel_components t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.order_inventory_reservations' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_inventory_reservations t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alerts' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alerts t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.automation_events' THEN SELECT TO_JSONB(t) INTO actual FROM public.automation_events t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alert_reads' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alert_reads t
        WHERE stock_alert_id=(n->'row'->>'stock_alert_id')::UUID AND user_id=(n->'row'->>'user_id')::UUID FOR UPDATE NOWAIT;
      WHEN 'public.user_roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.user_roles t
        WHERE user_id=(n->'row'->>'user_id')::UUID AND role_id=(n->'row'->>'role_id')::UUID FOR SHARE NOWAIT;
      WHEN 'public.business_operations' THEN SELECT TO_JSONB(t) INTO actual FROM public.business_operations t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.order_status_history' THEN SELECT TO_JSONB(t) INTO actual FROM public.order_status_history t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.audit_logs' THEN SELECT TO_JSONB(t) INTO actual FROM public.audit_logs t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'auth.users' THEN SELECT JSONB_BUILD_OBJECT('id',t.id) INTO actual FROM auth.users t WHERE id=identity FOR KEY SHARE NOWAIT;
      WHEN 'public.branches' THEN SELECT TO_JSONB(t) INTO actual FROM public.branches t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.customers' THEN SELECT TO_JSONB(t) INTO actual FROM public.customers t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.customer_addresses' THEN SELECT TO_JSONB(t) INTO actual FROM public.customer_addresses t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.promotion_codes' THEN SELECT TO_JSONB(t) INTO actual FROM public.promotion_codes t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.warehouses' THEN SELECT TO_JSONB(t) INTO actual FROM public.warehouses t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.profiles' THEN SELECT TO_JSONB(t) INTO actual FROM public.profiles t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.roles t WHERE id=identity FOR SHARE NOWAIT;
      ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_RELATION_UNSUPPORTED';
    END CASE;
    -- The closed static statements above must not acquire less than the plan.
    IF n->>'mode' IS DISTINCT FROM (CASE
      WHEN n->>'relation' IN ('public.inventory_balances','public.order_items','public.order_parcel_instances','public.order_parcel_components',
        'public.order_inventory_reservations','public.stock_alerts','public.stock_alert_reads','public.automation_events') THEN 'UPDATE'
      WHEN n->>'relation'='public.products' THEN 'NO_KEY_UPDATE'
      WHEN n->>'relation'='auth.users' THEN 'KEY_SHARE' ELSE 'SHARE' END) THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_MODE_INVALID'; END IF;
    IF actual IS DISTINCT FROM n->'row' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_ROW_CHANGED'; END IF;
  END LOOP;
  IF plan IS DISTINCT FROM phase5_private.plan_completion_lock_union_v1(kind,order_identity,request_key,method,amount,delivery,reference,notes,expected->'protocol') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_PLAN_CHANGED'; END IF;
  RETURN plan||JSONB_BUILD_OBJECT('locksHeld',TRUE,'acquisitionState','PRIVATE_INACTIVE_RESOURCES_ACQUIRED_ONLY',
    'actualTransactionId',txid_current()::TEXT,'actualBackendPid',pg_backend_pid(),
    'heldContextAuthority',FALSE,'absencePredicatesFenced',FALSE,'executionAuthority',FALSE);
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_COMPLETION_LOCK_CONTENTION_RETRY';
END; $$;
REVOKE ALL ON FUNCTION phase5_private.acquire_completion_lock_union_v1(TEXT,UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.acquire_completion_lock_union_v1(TEXT,UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Transport admission preserves immutable event source separately from mutable
-- lease/retry/ack rows. This is private preparation, never a writer permit.
CREATE FUNCTION phase5_private.plan_transport_source_envelope_v1(event_identities UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE source_rows JSONB; transport_catalog JSONB; entry RECORD; body_hash TEXT;
BEGIN
  IF event_identities IS NULL OR CARDINALITY(event_identities)=0
    OR ARRAY_POSITION(event_identities,NULL) IS NOT NULL
    OR CARDINALITY(event_identities)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(event_identities) id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_TRANSPORT_SOURCE_IDENTITIES_REQUIRED';
  END IF;
  -- Independent reviewed Migration096 bodies, not hashes supplied by a caller.
  FOR entry IN SELECT p.*,r.expected_hash FROM (VALUES
    ('public.claim_automation_deliveries(text,integer,integer)',
      '71aee5432b41ba415f366b2dd1f126a1cdb1c53c0f141f0881f0a73c44adeba6'),
    ('public.complete_automation_delivery(uuid,text,boolean,text)',
      '46a4e548a72aa58c3edf5471eccfb4f7feba77a65d856a9de87d9c86464e74b2')
    ) r(signature,expected_hash) LEFT JOIN pg_catalog.pg_proc p
      ON p.oid=pg_catalog.to_regprocedure(r.signature) LOOP
    body_hash:=ENCODE(extensions.digest(REPLACE(REPLACE(entry.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex');
    IF entry.oid IS NULL OR entry.prokind IS DISTINCT FROM 'f' OR entry.prosecdef IS DISTINCT FROM TRUE
      OR entry.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR entry.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR entry.prorettype IS DISTINCT FROM 'jsonb'::REGTYPE
      OR entry.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR body_hash IS DISTINCT FROM entry.expected_hash
      OR NOT pg_catalog.has_function_privilege('service_role',entry.oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('anon',entry.oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',entry.oid,'EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(entry.proacl,
           pg_catalog.acldefault('f',entry.proowner))) a
        WHERE a.grantee NOT IN ('postgres'::REGROLE,'service_role'::REGROLE)
          OR (a.grantee='service_role'::REGROLE AND a.is_grantable)) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_TRANSPORT_RPC_CONTRACT_INVALID';
    END IF;
  END LOOP;
  SELECT JSONB_AGG(TO_JSONB(e) ORDER BY e.id) INTO source_rows
    FROM public.automation_events e WHERE e.id=ANY(event_identities);
  IF JSONB_ARRAY_LENGTH(source_rows) IS DISTINCT FROM CARDINALITY(event_identities) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_TRANSPORT_SOURCE_MISSING';
  END IF;
  -- Capture installed delivery structure and authority, never delivery contents.
  SELECT JSONB_BUILD_OBJECT('relation',JSONB_BUILD_OBJECT('oid',c.oid,'kind',c.relkind,
    'owner',pg_catalog.pg_get_userbyid(c.relowner),'acl',TO_JSONB(c.relacl),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity),
    'columns',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('name',a.attname,'type',a.atttypid,
      'notNull',a.attnotnull,'acl',TO_JSONB(a.attacl),'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid))
      ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
      ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT COALESCE(JSONB_AGG(TO_JSONB(k) ORDER BY k.oid),'[]'::JSONB)
      FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid OR k.confrelid=c.oid),
    'triggers',(SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY t.oid),'[]'::JSONB)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid),
    'policies',(SELECT COALESCE(JSONB_AGG(TO_JSONB(p) ORDER BY p.oid),'[]'::JSONB)
      FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
    'indexes',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('catalog',TO_JSONB(i),
      'definition',pg_catalog.pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid),'[]'::JSONB)
      FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid),
    'partitions',(SELECT COALESCE(JSONB_AGG(TO_JSONB(i) ORDER BY i.inhrelid,i.inhparent),'[]'::JSONB)
      FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid))
    INTO transport_catalog FROM pg_catalog.pg_class c
      WHERE c.oid='public.automation_event_deliveries'::REGCLASS;
  IF transport_catalog->'relation'->>'kind' IS DISTINCT FROM 'r'
    OR transport_catalog->'relation'->>'owner' IS DISTINCT FROM 'postgres'
    OR transport_catalog->'partitions' IS DISTINCT FROM '[]'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_TRANSPORT_RELATION_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('version',1,'scope','TRANSPORT_SOURCE_PREPARATION_ONLY',
    'sourceRows',source_rows,'transportCatalog',transport_catalog,
    'authorityCatalog',phase5_private.inventory_authority_catalog_v1(),
    'reviewedRpcBodies',TRUE,'deliveryStateIsBusinessEvidence',FALSE,
    'locksHeld',FALSE,'heldContextAuthority',FALSE,'writerClosed',FALSE,
    'absencePredicatesFenced',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_transport_source_envelope_v1(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_transport_source_envelope_v1(UUID[]) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_transport_source_envelope_v1(event_identities UUID[],expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object'
    OR expected IS DISTINCT FROM phase5_private.plan_transport_source_envelope_v1(event_identities) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_TRANSPORT_SOURCE_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_transport_source_envelope_v1(UUID[],JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_transport_source_envelope_v1(UUID[],JSONB) OWNER TO postgres;

-- Fixed stock-trigger/read-mark source contract, not a complete writer ledger.
-- Historical bodies below are independently anchored in 014/057/099. Capturing
-- an unchanged installed catalog does NOT qualify early gates or execution.
CREATE FUNCTION phase5_private.plan_stock_writer_source_envelope_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE entry RECORD; body_hash TEXT; bindings JSONB:='[]'::JSONB;
  routines JSONB:='[]'::JSONB; trigger_row RECORD; actual_columns TEXT[];
BEGIN
  FOR entry IN SELECT p.*,r.signature,r.expected_hash,r.result_type,r.obligation FROM (VALUES
    ('public.sync_stock_alert(uuid,uuid,integer,integer)',
      '09198200f16e9d794c55cebef3937837f974eb8c8cd59f8e8681bbbc2fc1d85b','void','PREOWN_ALERT_READ_AND_ABSENT_ACTIVE_ALERT_DOMAIN'),
    ('public.sync_stock_alert_from_balance()',
      '4cc1cc81424fd3fd35bf11f866801c454caccf463572cc0d841b54614c90a3c8','trigger','BALANCE_PARENT_EARLY_PRODUCT_GATE'),
    ('public.sync_stock_alert_from_product()',
      'fbc126b6c712771fef1081cbfbb9037c20dd8b407a81ee5c5836f9df2dbda879','trigger','PRODUCT_PARENT_FULL_BALANCE_DOMAIN'),
    ('public.mark_stock_alert_read(uuid)',
      '2be28d31de3a4f7b61f81be297bf8100520bd529fd72eef0093d27725ee913c4','jsonb','PRODUCT_GATE_BEFORE_READ_CHILD_WRITE'),
    ('public.mark_all_stock_alerts_read()',
      '30eab73e75fa98a2afbb133e6c6d6fa955add9a40169c52dd280e463423be842','jsonb','SORTED_PRODUCT_GATES_AND_FULL_ACTIVE_MEMBERSHIP'),
    ('public.enqueue_stock_automation_event()',
      '7a01822c986427ff5dd6a57c0e0599cc4799f3de08c4608dd98fb59472d92049','trigger','SOURCE_OWNED_EVENT_ID_AND_FIRST_OWNER_KEY'),
    ('public.enqueue_automation_event(text,text,uuid,jsonb)',
      '2e8e7635b5754dd4be7ab3bfbc7678637912ec1e70fbff9dfcc2da531e46f1d9','uuid','STOCK_KEY_OWNERSHIP_WITH_GENERIC_EVENT_COMPATIBILITY')
    ) r(signature,expected_hash,result_type,obligation)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(r.signature)
    ORDER BY r.signature COLLATE "C" LOOP
    body_hash:=ENCODE(extensions.digest(REPLACE(REPLACE(entry.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex');
    IF entry.oid IS NULL OR entry.prokind IS DISTINCT FROM 'f'
      OR entry.proowner IS DISTINCT FROM 'postgres'::REGROLE OR entry.prosecdef IS DISTINCT FROM TRUE
      OR entry.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR entry.prorettype IS DISTINCT FROM pg_catalog.to_regtype(entry.result_type)
      OR entry.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR entry.proargdefaults IS NOT NULL OR entry.proretset OR entry.proisstrict OR entry.proleakproof
      OR entry.provolatile IS DISTINCT FROM 'v' OR body_hash IS DISTINCT FROM entry.expected_hash THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_STOCK_WRITER_SOURCE_CONTRACT_INVALID';
    END IF;
    routines:=routines||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('signature',entry.signature,
      'reviewedBodySha256',entry.expected_hash,'catalog',TO_JSONB(entry)-'expected_hash'-'result_type'-'obligation',
      'convergenceRequired',entry.obligation,'earlyGateQualified',FALSE));
  END LOOP;
  FOR entry IN SELECT * FROM (VALUES
    ('public.inventory_balances','trg_sync_stock_alert_from_balance','public.sync_stock_alert_from_balance()',21,
      ARRAY['on_hand_quantity','reserved_quantity']),
    ('public.products','trg_sync_stock_alert_from_product','public.sync_stock_alert_from_product()',17,
      ARRAY['min_stock_level','is_active']),
    ('public.stock_alerts','trg_enqueue_stock_automation_event','public.enqueue_stock_automation_event()',21,
      ARRAY['status','severity'])
    ) r(relation_name,trigger_name,signature,trigger_type,columns) ORDER BY relation_name COLLATE "C" LOOP
    SELECT t.* INTO trigger_row FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=pg_catalog.to_regclass(entry.relation_name) AND t.tgname=entry.trigger_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_STOCK_WRITER_TRIGGER_CONTRACT_INVALID';
    END IF;
    SELECT ARRAY_AGG(a.attname::TEXT ORDER BY x.ordinal) INTO actual_columns
      FROM UNNEST(trigger_row.tgattr::SMALLINT[]) WITH ORDINALITY x(attnum,ordinal)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=trigger_row.tgrelid AND a.attnum=x.attnum AND NOT a.attisdropped;
    IF trigger_row.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure(entry.signature)
      OR trigger_row.tgtype IS DISTINCT FROM entry.trigger_type::SMALLINT
      OR trigger_row.tgenabled IS DISTINCT FROM 'O' OR trigger_row.tgisinternal
      OR trigger_row.tgnargs<>0 OR trigger_row.tgqual IS NOT NULL OR trigger_row.tgconstraint<>0
      OR trigger_row.tgdeferrable OR trigger_row.tginitdeferred
      OR actual_columns IS DISTINCT FROM entry.columns THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_STOCK_WRITER_TRIGGER_CONTRACT_INVALID';
    END IF;
    bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation',entry.relation_name,
      'name',entry.trigger_name,'signature',entry.signature,'columns',TO_JSONB(actual_columns),'catalog',TO_JSONB(trigger_row)));
  END LOOP;
  -- A duplicate/alternate attachment of a reviewed trigger routine cannot be
  -- hidden by finding only the three expected names above.
  IF (SELECT COUNT(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid IN
      ('public.sync_stock_alert_from_balance()'::REGPROCEDURE,'public.sync_stock_alert_from_product()'::REGPROCEDURE,
       'public.enqueue_stock_automation_event()'::REGPROCEDURE)) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_STOCK_WRITER_TRIGGER_CONTRACT_INVALID';
  END IF;
  RETURN JSONB_BUILD_OBJECT('version',1,'scope','STOCK_TRIGGER_READ_MARK_SOURCE_PREPARATION_ONLY',
    'routines',routines,'triggerBindings',bindings,'authorityCatalog',phase5_private.inventory_authority_catalog_v1(),
    'reviewedSourceBodies',TRUE,'completeWriterLedger',FALSE,'earlyGateQualified',FALSE,
    'defaultsQualified',FALSE,'writerClosed',FALSE,'absencePredicatesFenced',FALSE,
    'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_stock_writer_source_envelope_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_stock_writer_source_envelope_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_stock_writer_source_envelope_v1(expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object'
    OR expected IS DISTINCT FROM phase5_private.plan_stock_writer_source_envelope_v1() THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_STOCK_WRITER_SOURCE_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_stock_writer_source_envelope_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_stock_writer_source_envelope_v1(JSONB) OWNER TO postgres;

-- Parent/callable source participation preparation, never execution authority.
-- The fixed identity inventory and95 source records are derived from001-127.
-- The090 exact street-fragment rewrite is recorded explicitly; no installed
-- body supplies its own expected hash. Branch timing, dynamic dispatch,
-- defaults, absence fencing and complete writer qualification remain open.
CREATE FUNCTION phase5_private.plan_inventory_parent_sources_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  expected_signatures JSONB := $signatures$[
  "public._archive_supplier_receipt_impl(uuid,bool)",
  "public._calculate_guest_promotion(text,jsonb,text)",
  "public._cancel_order_impl(uuid,text)",
  "public._cancel_order_impl_before_phase4_lock(uuid,text)",
  "public._cancel_purchase_receipt_v2_before_phase4_lock(uuid,text)",
  "public._cancel_supplier_receipt_before_phase4_lock(uuid,text)",
  "public._cancel_supplier_receipt_impl(uuid,text)",
  "public._cancel_supplier_receipt_legacy_guarded_v2(uuid,text)",
  "public._close_cash_shift_before_closing_report_snapshot(uuid,bigint,text)",
  "public._complete_order_impl(uuid,text)",
  "public._complete_order_impl_before_phase4_lock(uuid,text)",
  "public._complete_website_order_with_settlement_before_phase4_lock(uuid,text,bigint,bigint,text,text)",
  "public._complete_website_order_with_settlement_v2_before_phase4_lock(uuid,text,text,bigint,bigint,text,text)",
  "public._confirm_order_impl(uuid,text)",
  "public._create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
  "public._create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public._create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public._create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
  "public._create_purchase_order_impl(uuid,uuid,uuid,timestamptz,bigint,bigint,text,text,text,jsonb)",
  "public._get_cash_shift_closing_report_before_snapshot(uuid)",
  "public._get_cash_shift_closing_report_v1(uuid)",
  "public._get_cash_shift_summary_v1(uuid)",
  "public._get_crm_customer_detail_page_before_phase42_receivables(uuid,int,int)",
  "public._get_crm_customer_page_before_phase42_receivables(int,int,text,text,text)",
  "public._get_expense_shift_center_v1(uuid,int)",
  "public._get_inventory_opening_setup_including_flavor_masters_v1(uuid)",
  "public._get_operational_business_report_v1(uuid,date,date)",
  "public._get_operational_business_report_v2(uuid,date,date)",
  "public._preview_cash_shift_full_reversal(uuid)",
  "public._receive_inventory_impl(uuid,uuid,int,text,uuid,text)",
  "public._receive_purchase_order_impl(uuid,uuid,text,text,jsonb)",
  "public._record_customer_order_payment_before_phase42_financial_guard(uuid,bigint,text,text,text)",
  "public._record_customer_order_payment_before_phase4_lock(uuid,bigint,text,text,text)",
  "public._record_supplier_payment_idempotency_legacy(uuid,uuid,bigint,text,text,timestamptz,text)",
  "public._record_supplier_payment_impl(uuid,uuid,bigint,text,text,timestamptz,text)",
  "public._record_supplier_receipt_payment_idempotency_legacy(uuid,bigint,text,text,text)",
  "public._record_supplier_receipt_payment_impl(uuid,bigint,text,text,text)",
  "public._return_completed_website_order_before_phase42_coordinator(uuid,text,text,text,text,text)",
  "public._return_completed_website_order_before_phase4_lock(uuid,text,text,text,text,text)",
  "public._reverse_cash_shift_with_operations_before_phase42_refund_guard(uuid,text,text)",
  "public._reverse_cash_shift_with_operations_before_phase4_lock(uuid,text,text)",
  "public._reverse_customer_order_payment_before_phase4_lock(uuid,text)",
  "public._reverse_operational_expense_before_phase4_lock(uuid,text)",
  "public._reverse_supplier_payment_before_phase4_lock(uuid,text,text)",
  "public._set_advanced_monitoring_check(text,text,text,text,text,int,text,jsonb,timestamptz)",
  "public._submit_guest_customer_order_v1_before_phase3(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
  "public._transfer_inventory_between_warehouses_phase2_legacy(uuid,uuid,uuid,int,text,timestamptz)",
  "public._transition_business_alert_incident(text,text,uuid,bool,timestamptz,jsonb,bool)",
  "public._update_order_status_impl(uuid,text,text)",
  "public._update_purchase_order_status_impl(uuid,text,text)",
  "public.accept_order_for_preparation(uuid,text)",
  "public.add_customer_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,bool)",
  "public.adjust_inventory_stock(uuid,uuid,int,text,text)",
  "public.apply_inventory_opening_setup(uuid,jsonb,text,text)",
  "public.archive_supplier_receipt(uuid,bool)",
  "public.assert_closed_cash_shift_has_snapshot()",
  "public.assert_configurable_parcel_creation_allowed()",
  "public.assert_erp_role(text[],text)",
  "public.assert_monitoring_owner()",
  "public.assert_order_parcel_composition_total()",
  "public.assert_phase2_receipt_reconciliation()",
  "public.assert_reversal_owner(text)",
  "public.assign_inventory_movement_mutation_sequence()",
  "public.attach_customer_payment_to_open_shift()",
  "public.attach_open_cash_shift_to_pos_order()",
  "public.attach_supplier_payment_to_open_shift()",
  "public.authorize_admin_ai_assistant_request()",
  "public.authorize_guest_order_gateway(uuid,text,text,text)",
  "public.build_business_summary(text,date,date,timestamptz)",
  "public.build_public_order_tracking_payload(uuid)",
  "public.cancel_customer_order_v2(uuid,text,text)",
  "public.cancel_empty_cash_shift(uuid,text)",
  "public.cancel_order(uuid,text)",
  "public.cancel_purchase_order(uuid,text)",
  "public.cancel_purchase_receipt_v2(uuid,text)",
  "public.cancel_supplier_receipt(uuid,text)",
  "public.claim_automation_deliveries(text,int,int)",
  "public.cleanup_guest_order_gateway_requests(int)",
  "public.close_cash_shift(uuid,bigint,text)",
  "public.complete_automation_delivery(uuid,text,bool,text)",
  "public.complete_order(uuid,text)",
  "public.complete_website_order_with_payment(uuid,text,text,text)",
  "public.complete_website_order_with_settlement(uuid,text,bigint,bigint,text,text)",
  "public.complete_website_order_with_settlement_v2(uuid,text,text,bigint,bigint,text,text)",
  "public.confirm_order(uuid,text)",
  "public.create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
  "public.create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
  "public.create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
  "public.create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
  "public.create_erp_staff_account_record(uuid,text,text,text,uuid,text)",
  "public.create_operational_expense(uuid,text,text,bigint,text,text)",
  "public.create_pos_sale(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public.create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
  "public.create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,text,jsonb)",
  "public.create_product_flavor_v1(uuid,text,int,uuid,text,text)",
  "public.create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
  "public.create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text)",
  "public.create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text,text)",
  "public.create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,int,text,text)",
  "public.create_purchase_order(uuid,uuid,uuid,timestamptz,bigint,bigint,text,text,text,jsonb)",
  "public.create_purchase_order_v2(uuid,uuid,uuid,timestamptz,bigint,bigint,text,text,text,jsonb)",
  "public.delete_draft_purchase_order(uuid)",
  "public.disable_push_subscription(text)",
  "public.enforce_customer_for_debt_order()",
  "public.enforce_order_collection_before_completion()",
  "public.enforce_product_flavor_inheritance()",
  "public.enforce_product_identifier_integrity()",
  "public.enqueue_automation_event(text,text,uuid,jsonb)",
  "public.enqueue_business_summary(text,date,date,timestamptz,timestamptz)",
  "public.enqueue_closed_shift_automation_event()",
  "public.enqueue_expired_order_business_alert()",
  "public.enqueue_order_automation_event()",
  "public.enqueue_order_push_webhook(jsonb)",
  "public.enqueue_stock_automation_event()",
  "public.expire_stale_new_website_orders(int)",
  "public.extract_google_maps_coordinates(text)",
  "public.finalize_guest_order_gateway(uuid,text,uuid)",
  "public.finalize_order_parcel_instance_internal(uuid)",
  "public.get_active_order_push_targets(uuid)",
  "public.get_admin_ai_inventory_snapshot()",
  "public.get_admin_ai_monthly_report()",
  "public.get_admin_inventory_product_page(int,int,text,uuid,uuid,uuid,text)",
  "public.get_admin_product_listing()",
  "public.get_admin_product_page(int,int,text,uuid,text,text)",
  "public.get_admin_sales_aftercare_context_v1(uuid)",
  "public.get_advanced_monitoring_dashboard()",
  "public.get_advanced_monitoring_status()",
  "public.get_business_summary_monitoring_status()",
  "public.get_cash_shift_archive_page(uuid,uuid,text,text,date,date,int,int)",
  "public.get_cash_shift_closing_report(uuid)",
  "public.get_cash_shift_display_summary(uuid)",
  "public.get_cash_shift_summary(uuid)",
  "public.get_configurable_parcel_feature_state()",
  "public.get_crm_customer_detail_page(uuid,int,int)",
  "public.get_crm_customer_page(int,int,text,text,text)",
  "public.get_customer_outstanding_orders_page(int,int,text)",
  "public.get_dashboard_analytics()",
  "public.get_erp_staff_account_audit_logs(int)",
  "public.get_erp_staff_accounts()",
  "public.get_expense_shift_center(uuid,int)",
  "public.get_home_dashboard()",
  "public.get_inventory_movement_page(int,int,text,uuid,uuid,uuid)",
  "public.get_inventory_opening_setup(uuid)",
  "public.get_open_pos_shift(uuid)",
  "public.get_operational_business_report(uuid,date,date)",
  "public.get_operational_orders_page(int,int,text,text,text)",
  "public.get_or_create_pos_receipt_token(uuid)",
  "public.get_pos_customer_page(int,int,text)",
  "public.get_promotion_codes()",
  "public.get_public_configurable_parcel_options(uuid[])",
  "public.get_public_pos_receipt(uuid)",
  "public.get_public_product_catalog(int,int,uuid,text)",
  "public.get_public_storefront_catalog(int,int,uuid,text)",
  "public.get_public_storefront_catalog_page(int,int,uuid,text,text,text,uuid,uuid,uuid[])",
  "public.get_public_storefront_merchandising()",
  "public.get_public_storefront_offers()",
  "public.get_public_storefront_settings()",
  "public.get_purchase_orders_page(int,int,text,text,uuid,uuid,text)",
  "public.get_push_subscription_status()",
  "public.get_push_webhook_secret()",
  "public.get_stock_alert_notifications(bool,int)",
  "public.get_supplier_payments_page(int,int,text,uuid,text)",
  "public.get_supplier_receipts_page(int,int,text,uuid,uuid,text,bool)",
  "public.guard_cash_shift_closing_report_snapshot()",
  "public.guard_finalized_order_parcel_item_history()",
  "public.guard_immutable_parcel_foundation_row()",
  "public.guard_new_configurable_parcel_row()",
  "public.guard_order_inventory_reservation_history()",
  "public.guard_order_parcel_component_history()",
  "public.guard_order_parcel_instance_history()",
  "public.guard_phase2_detail_history()",
  "public.guard_phase2_receipt_header_history()",
  "public.guard_phase3_customer_order_cost_finalization()",
  "public.guard_phase3_customer_v2_terminal_status()",
  "public.guard_phase4_aftercare_consumption_history()",
  "public.guard_phase4_immutable_row()",
  "public.guard_phase4_replacement_event_history()",
  "public.guard_phase4_sales_return_event_history()",
  "public.guard_supplier_invoice_identity_history()",
  "public.has_erp_role(text[])",
  "public.is_active_erp_staff()",
  "public.is_authenticated()",
  "public.is_mfa_policy_satisfied()",
  "public.mark_all_stock_alerts_read()",
  "public.mark_stock_alert_read(uuid)",
  "public.normalize_customer_phone(text)",
  "public.notify_new_website_order_push()",
  "public.open_cash_shift(uuid,bigint)",
  "public.phase2_allocate_largest_remainder_internal(bigint,jsonb)",
  "public.phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)",
  "public.phase2_canonicalize_legacy_receipt_items_internal(jsonb)",
  "public.phase2_canonicalize_receipt_lines_internal(jsonb)",
  "public.phase2_lock_inventory_products_internal(uuid[])",
  "public.phase2_lock_payment_shift_internal(uuid,text,bigint)",
  "public.phase2_lock_receipt_payment_shifts_internal(uuid,uuid)",
  "public.phase2_request_fingerprint_internal(jsonb)",
  "public.phase2_reverse_inventory_and_wac_internal(uuid,uuid,uuid,text,uuid,uuid,text)",
  "public.phase2_try_parse_uuid_internal(text)",
  "public.phase2_validate_receipt_lines_internal(jsonb)",
  "public.phase35_report_base_unit_count_internal(uuid,text,int)",
  "public.phase35_report_package_count_internal(uuid,text,int,int)",
  "public.phase3_actor_scope_hash_internal(text,uuid,text,text)",
  "public.phase3_allocate_parcel_cogs_internal(jsonb)",
  "public.phase3_assert_configurable_parcel_creation_allowed_internal(text,uuid)",
  "public.phase3_assert_legacy_customer_lifecycle_allowed_internal(uuid)",
  "public.phase3_canonicalize_components_internal(jsonb)",
  "public.phase3_canonicalize_sale_request_internal(jsonb)",
  "public.phase3_customer_cost_finalization_allowed_internal(uuid,text,uuid)",
  "public.phase3_customer_line_identity_internal(jsonb)",
  "public.phase3_expire_customer_order_v2_internal(uuid)",
  "public.phase3_lock_inventory_products_internal(uuid[])",
  "public.phase3_lock_open_pos_shift_internal(uuid)",
  "public.phase3_pos_reversal_inventory_rows_internal(uuid)",
  "public.phase3_release_customer_reservations_internal(uuid,uuid,text,text,text,jsonb,text,text,uuid,text,text)",
  "public.phase3_request_fingerprint_internal(jsonb)",
  "public.phase3_require_nonnegative_bigint_internal(text,text)",
  "public.phase3_require_positive_integer_internal(text,text)",
  "public.phase3_require_uuid_internal(text,text)",
  "public.phase3_resolve_legacy_pos_location_internal(uuid,uuid)",
  "public.phase3_resolve_operation_replay_internal(text,text,text,text,text)",
  "public.phase3_validate_configurable_parcel_internal(text,uuid,uuid,uuid,int,jsonb)",
  "public.phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)",
  "public.phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)",
  "public.phase42_assert_operational_return_evidence_before_phase43(uuid,bool)",
  "public.phase42_assert_operational_return_evidence_internal(uuid,bool)",
  "public.phase42_canonicalize_return_request_before_phase43_internal(uuid,jsonb,text,text,text,text)",
  "public.phase42_canonicalize_return_request_internal(uuid,jsonb,text,text,text,text)",
  "public.phase42_customer_receivable_total_internal(uuid)",
  "public.phase42_expected_return_effects_pre43_internal(uuid)",
  "public.phase42_expected_return_inventory_effects_internal(uuid)",
  "public.phase42_guard_inventory_effect_history()",
  "public.phase42_guard_return_coordinator_version()",
  "public.phase42_guard_settlement_evidence()",
  "public.phase42_inventory_effects_snapshot_internal(uuid)",
  "public.phase42_order_financial_position_internal(uuid)",
  "public.phase42_require_evidence_before_return_settlement()",
  "public.phase43_assert_operational_replacement_evidence_internal(uuid,bool)",
  "public.phase43_assert_return_allocation_contract_internal(jsonb,jsonb)",
  "public.phase43_assert_return_physical_evidence_set_internal(uuid)",
  "public.phase43_assert_return_physical_source_internal(uuid,text,uuid,text,uuid,uuid)",
  "public.phase43_canonicalize_replacement_request_internal(uuid,jsonb,text,text)",
  "public.phase43_canonicalize_return_physical_sources_internal(jsonb)",
  "public.phase43_current_physical_representatives_internal(text,uuid,uuid)",
  "public.phase43_guard_immutable_replacement_effect()",
  "public.phase43_guard_replacement_settlement_evidence()",
  "public.phase43_inventory_effects_snapshot_internal(uuid)",
  "public.phase43_rebind_return_consumption_to_leaf()",
  "public.phase43_resolve_replacement_replay_internal(text,text,text)",
  "public.phase43_return_inventory_sources_internal(uuid,jsonb)",
  "public.phase4_aftercare_source_root_internal(text,uuid,uuid)",
  "public.phase4_assert_aftercare_operation_binding_internal(uuid,text,uuid,smallint)",
  "public.phase4_assert_no_settled_aftercare_for_order_internal(uuid)",
  "public.phase4_assert_success_result_internal(uuid,text,jsonb,uuid)",
  "public.phase4_authoritative_completion_internal(uuid)",
  "public.phase4_cancel_draft_aftercare_internal(uuid)",
  "public.phase4_canonicalize_idempotency_key_internal(text)",
  "public.phase4_capture_parcel_component_price_snapshot()",
  "public.phase4_customer_completion_replay_preflight_internal(uuid,text,text,bigint,bigint,text,text)",
  "public.phase4_effective_standalone_unit_price_internal(uuid,text,text,text,timestamptz)",
  "public.phase4_finalize_aftercare_operation_before_phase43(uuid)",
  "public.phase4_finalize_aftercare_operation_foundation_internal(uuid)",
  "public.phase4_finalize_aftercare_operation_internal(uuid)",
  "public.phase4_full_shift_context_snapshot_internal(uuid)",
  "public.phase4_guard_aftercare_operation_order_gate()",
  "public.phase4_guard_customer_payment_reversal_dependency()",
  "public.phase4_guard_order_reversal_dependency()",
  "public.phase4_guard_replacement_event_insert_state()",
  "public.phase4_guard_return_event_insert_state()",
  "public.phase4_lock_aftercare_operation_order_internal(uuid,uuid)",
  "public.phase4_lock_aftercare_order_gate_internal(text,jsonb,uuid)",
  "public.phase4_lock_aftercare_parent_order_internal(text,uuid,uuid,uuid)",
  "public.phase4_lock_customer_order_context_internal(uuid,bool,bool)",
  "public.phase4_lock_full_shift_context_internal(uuid)",
  "public.phase4_lock_order_inventory_internal(uuid)",
  "public.phase4_lock_supplier_context_internal(uuid,uuid,uuid)",
  "public.phase4_prepare_component_inspection()",
  "public.phase4_resolve_operation_replay_internal(text,text,text,text)",
  "public.phase4_supplier_context_snapshot_internal(uuid,uuid,uuid)",
  "public.phase4_validate_aftercare_consumption_insert()",
  "public.phase4_validate_replacement_item()",
  "public.phase4_validate_return_item_insert()",
  "public.populate_order_item_cost_snapshot()",
  "public.preview_cash_shift_full_reversal(uuid)",
  "public.preview_guest_promotion(text,jsonb,text)",
  "public.preview_guest_promotion_v2(jsonb,text,text)",
  "public.receive_inventory(uuid,uuid,int,text,uuid,text)",
  "public.receive_purchase_order(uuid,uuid,text,text,jsonb)",
  "public.receive_purchase_order_v2(uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
  "public.record_customer_order_payment(uuid,bigint,text,text,text)",
  "public.record_customer_order_payment_once(uuid,bigint,text,text,text,text)",
  "public.record_erp_staff_password_reset(uuid)",
  "public.record_external_monitoring_snapshot(jsonb,timestamptz)",
  "public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamptz,text,text)",
  "public.record_supplier_receipt_payment(uuid,bigint,text,text,text,text)",
  "public.reject_flavor_master_inventory_mutation()",
  "public.reject_stocked_product_flavor_master_promotion()",
  "public.reorder_product_flavors_v1(uuid,uuid[])",
  "public.report_admin_runtime_incident(text,text)",
  "public.resolve_legacy_supplier_receipt_replay_v1(uuid)",
  "public.return_completed_website_order(uuid,text,text,text,text,text)",
  "public.reverse_cash_shift_with_operations(uuid,text,text)",
  "public.reverse_customer_order_payment(uuid,text)",
  "public.reverse_operational_expense(uuid,text)",
  "public.reverse_pos_sale(uuid,text,text)",
  "public.reverse_supplier_payment(uuid,text,text)",
  "public.run_advanced_monitoring_checks(timestamptz)",
  "public.save_customer(text,text,uuid,text,text,text,text,text)",
  "public.save_product_brand(text,uuid,text,text)",
  "public.save_product_category(text,uuid,text)",
  "public.save_product_category(text,uuid,text,text)",
  "public.save_product_parcel_configuration_v1(uuid,text,bool)",
  "public.save_product_unit(text,text,int,uuid)",
  "public.save_push_subscription(text,text,text,text,text)",
  "public.save_storefront_settings(text,text,text,bool,text,text,text,text,text,bigint,bigint)",
  "public.save_storefront_settings_v2(text,text,text,bool,text,text,text,text,text,bigint,bigint,bool,bool,bool,bool)",
  "public.save_storefront_settings_v3(text,text,text,bool,text,text,text,text,text,bigint,bigint,bigint,bool,bool,bool,bool)",
  "public.save_supplier(text,uuid,text,text,text,text,text,text,text,bool)",
  "public.scan_business_summaries(timestamptz)",
  "public.scan_core_business_alerts(timestamptz,int)",
  "public.search_admin_products(text,int,uuid,text,uuid)",
  "public.set_configurable_parcel_feature_state_v1(text)",
  "public.set_customer_status(uuid,text)",
  "public.set_erp_staff_account_active(uuid,bool)",
  "public.set_product_brand_active(uuid,bool)",
  "public.set_product_category_active(uuid,bool)",
  "public.set_product_primary_image(uuid,text)",
  "public.set_product_unit_active(uuid,bool)",
  "public.set_promotion_code_active(uuid,bool)",
  "public.set_supplier_active(uuid,bool)",
  "public.set_website_new_order_reservation_expiry()",
  "public.settle_admin_sales_return_v1(uuid,text,jsonb,jsonb,text,text,text,text)",
  "public.settle_sales_replacement_v1(uuid,text,jsonb,text,text)",
  "public.settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)",
  "public.start_or_update_order_delivery(uuid,int,text,text)",
  "public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
  "public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)",
  "public.submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)",
  "public.sync_order_delivery_tracking_timestamps()",
  "public.sync_order_payment_state()",
  "public.sync_product_flavor_commercial_settings()",
  "public.sync_stock_alert(uuid,uuid,int,int)",
  "public.sync_stock_alert_from_balance()",
  "public.sync_stock_alert_from_product()",
  "public.track_guest_order(text,text)",
  "public.track_guest_order_by_token(text)",
  "public.transfer_inventory_between_warehouses(uuid,uuid,uuid,int,text,timestamptz)",
  "public.update_erp_staff_account_record(uuid,text,text,text,uuid,text)",
  "public.update_my_erp_profile(text,text,text)",
  "public.update_order_delivery_address(uuid,text,text,text,text,text,text,text,text,double precision,double precision,text,bool)",
  "public.update_order_status(uuid,text,text)",
  "public.update_product_flavor_v1(uuid,text,text,text,bool)",
  "public.update_product_master(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,bool,text)",
  "public.update_product_master_v2(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,bool,text)",
  "public.update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,bool,text)",
  "public.update_purchase_order(uuid,uuid,uuid,uuid,timestamptz,bigint,bigint,text,text,text,jsonb)",
  "public.update_purchase_order_status(uuid,text,text)",
  "public.update_updated_at_column()",
  "public.upsert_promotion_code(text,text,bigint,uuid,text,bigint,bigint,timestamptz,timestamptz,int,int,bool,bool)",
  "public.validate_customer_address_map_url()",
  "public.validate_inventory_movement_source_chain()",
  "public.validate_order_inventory_reservation_chain()",
  "public.validate_order_parcel_component_family()",
  "public.validate_order_parcel_instance_family()",
  "public.validate_phase2_inventory_movement_source()",
  "public.validate_product_parcel_configuration()",
  "public.validate_purchase_order_component_family_v2()",
  "public.validate_purchase_receipt_item_family_v2()",
  "public.validate_sales_return_item_line_kind()",
  "public.validate_supplier_receipt_item_commercial_family()"
]$signatures$::JSONB;
  expected_sources JSONB := $sources$[
  {
    "signature": "public._cancel_order_impl(uuid,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 3037,
    "sourceTransform": null,
    "bodySha256": "e99f70493d0ebf2d7f0ee5fe97ff2b6654df6621ae3ef7082a16d4b8a1387b2b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_order_impl_before_phase4_lock",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._cancel_order_impl_before_phase4_lock(uuid,text)",
    "sourceMigration": "004_customers_orders.sql",
    "sourceLine": 768,
    "sourceTransform": null,
    "bodySha256": "c42e39dfaa23b65fbe56c1098e2fe2f88a35320cd0a0a818d17e2904be69f833",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._cancel_purchase_receipt_v2_before_phase4_lock(uuid,text)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 3056,
    "sourceTransform": null,
    "bodySha256": "f8f2920f455097166adc5f2292f2dc952dffa7521518fde40d5d7e5e708b1263",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      },
      {
        "name": "phase2_reverse_inventory_and_wac_internal",
        "argument_count": 7
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._cancel_supplier_receipt_before_phase4_lock(uuid,text)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 2914,
    "sourceTransform": null,
    "bodySha256": "ed7775e013b0488311c0a298db20e279ebc6a7606e83f5480103b3aca1e2174b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_supplier_receipt_legacy_guarded_v2",
        "argument_count": 2
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      },
      {
        "name": "phase2_reverse_inventory_and_wac_internal",
        "argument_count": 7
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._cancel_supplier_receipt_impl(uuid,text)",
    "sourceMigration": "016_safe_paid_supplier_receipt_reversal.sql",
    "sourceLine": 14,
    "sourceTransform": null,
    "bodySha256": "329ba57b8e5c1917f525fc3c030c2b6d30a439ecb7a648739e307b36a374f24c",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._cancel_supplier_receipt_legacy_guarded_v2(uuid,text)",
    "sourceMigration": "078_operational_accounting_integrity.sql",
    "sourceLine": 278,
    "sourceTransform": null,
    "bodySha256": "be3b598eac64ed8639647f9ded79afceb518adc1cb19b7eaadc5c90b7100a9bf",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_supplier_receipt_impl",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._complete_order_impl(uuid,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 3026,
    "sourceTransform": null,
    "bodySha256": "8e8559c46e89768a30e670995c0dbee0b4810fb24ea721ea7eed9642316b654f",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_complete_order_impl_before_phase4_lock",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._complete_order_impl_before_phase4_lock(uuid,text)",
    "sourceMigration": "004_customers_orders.sql",
    "sourceLine": 606,
    "sourceTransform": null,
    "bodySha256": "9abfe62b99f019cd0be7649ec989de20efcdbc5bfacf8ed242b3dea323306abb",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._complete_website_order_with_settlement_before_phase4_lock(uuid,text,bigint,bigint,text,text)",
    "sourceMigration": "060_simplified_order_settlement_and_receivables.sql",
    "sourceLine": 208,
    "sourceTransform": null,
    "bodySha256": "2f9aabb48e2cd28f0a88604dffa336e57e39f0336f505f18a94f54d511a8ee87",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "complete_order",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._complete_website_order_with_settlement_v2_before_phase4_lock(uuid,text,text,bigint,bigint,text,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 1880,
    "sourceTransform": null,
    "bodySha256": "5ab09f9426b691dbe1af0ca4935ea461499d6f429ab082399799241a1e308a33",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
    "sourceMigration": "011_supplier_receiving_hardening.sql",
    "sourceLine": 367,
    "sourceTransform": null,
    "bodySha256": "a4230edfd2ab12741f8f1f0dc4a2f199d3a7c39b40c472a2256dd5250b44e657",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 721,
    "sourceTransform": null,
    "bodySha256": "552effd40c17a3bb7f6833bdfb91cb7e5eda1617cc7dfcb89159882aea9857cf",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "023_wholesale_order_accounting.sql",
    "sourceLine": 107,
    "sourceTransform": null,
    "bodySha256": "a2255860d58bd55f926f800364d401a9dc604d45ff11c5df3e8d772a8d1ea573",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "create_pos_sale_base_units_legacy",
        "argument_count": 9
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "115_configurable_parcel_pos_sale_coordinator.sql",
    "sourceLine": 186,
    "sourceTransform": null,
    "bodySha256": "035722f38503a2416fe0ad0b067d2bd5309d732026047f76b81ae76ee7fbe3b7",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
    "sourceMigration": "011_supplier_receiving_hardening.sql",
    "sourceLine": 198,
    "sourceTransform": null,
    "bodySha256": "9161e9574030cda6056ea178226a5233ada0a64ffbe49c983be4e21a9546d08e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._receive_inventory_impl(uuid,uuid,int,text,uuid,text)",
    "sourceMigration": "107_canonical_schema_reconciliation.sql",
    "sourceLine": 5,
    "sourceTransform": null,
    "bodySha256": "2f660eb3e094b2538278bcdaef36b6878acd9972e8c184c296c7b1439bb8b9a5",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._receive_purchase_order_impl(uuid,uuid,text,text,jsonb)",
    "sourceMigration": "104_remove_unused_receive_purchase_order_product_id.sql",
    "sourceLine": 5,
    "sourceTransform": null,
    "bodySha256": "01709a375da7952019fe71fa91b35ee15f7cc2273e432d9b231bb329aea7854c",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._return_completed_website_order_before_phase42_coordinator(uuid,text,text,text,text,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 2983,
    "sourceTransform": null,
    "bodySha256": "1b3590df77595c46acccb3431a2422f5822d5c13b1616f543acbca09ea73502e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_return_completed_website_order_before_phase4_lock",
        "argument_count": 6
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._return_completed_website_order_before_phase4_lock(uuid,text,text,text,text,text)",
    "sourceMigration": "043_sales_returns_and_refunds.sql",
    "sourceLine": 108,
    "sourceTransform": null,
    "bodySha256": "f4d6dcb997fc4a429a7c8372f0ff6ac2251e0111f041dead3e63a99a176db28c",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._reverse_cash_shift_with_operations_before_phase42_refund_guard(uuid,text,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 3668,
    "sourceTransform": null,
    "bodySha256": "3c71fa32ed70aa6d780954b78337398bf5b69fb7a265306bd50f0141906b708a",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_reverse_cash_shift_with_operations_before_phase4_lock",
        "argument_count": 3
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._reverse_cash_shift_with_operations_before_phase4_lock(uuid,text,text)",
    "sourceMigration": "084_full_cash_shift_reversal.sql",
    "sourceLine": 296,
    "sourceTransform": null,
    "bodySha256": "455aa3add85f8dce1e38ba676d6e4147a5fa4e5b0d95a3cf1d8bdc1443e7cbe0",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "reverse_pos_sale",
        "argument_count": 3
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._submit_guest_customer_order_v1_before_phase3(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
    "sourceMigration": "089_customer_order_tracking_receipt.sql",
    "sourceLine": 11,
    "sourceTransform": null,
    "bodySha256": "30f6c6b42666e0faab5ce0e2be45b7578355ca29c1b5fe4f5b2494d5569b1af6",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "submit_guest_customer_order_core",
        "argument_count": 15
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._transfer_inventory_between_warehouses_phase2_legacy(uuid,uuid,uuid,int,text,timestamptz)",
    "sourceMigration": "095_remove_unused_transfer_product_name.sql",
    "sourceLine": 4,
    "sourceTransform": null,
    "bodySha256": "38435a5319305f156d0f972bf16460b7982369864e6453241ff96d5763062bcd",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._transition_business_alert_incident(text,text,uuid,bool,timestamptz,jsonb,bool)",
    "sourceMigration": "099_advanced_monitoring_and_business_integrity.sql",
    "sourceLine": 164,
    "sourceTransform": null,
    "bodySha256": "3c716d197df8cb33ea0c20da9e3a280aceac6938f7f707e923dda408e23fbcad",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public._update_order_status_impl(uuid,text,text)",
    "sourceMigration": "005_order_status_transitions.sql",
    "sourceLine": 6,
    "sourceTransform": null,
    "bodySha256": "ccc2373770e742b382ebab94846c82903d15b67345269431ab5ffebbd9c66f90",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "cancel_order",
        "argument_count": 2
      },
      {
        "name": "complete_order",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.accept_order_for_preparation(uuid,text)",
    "sourceMigration": "060_simplified_order_settlement_and_receivables.sql",
    "sourceLine": 9,
    "sourceTransform": null,
    "bodySha256": "88464a07ecc0310fff25a975966844b9fddc94786ce3477178e4bfdfbf48dd74",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "update_order_status",
        "argument_count": 3
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.adjust_inventory_stock(uuid,uuid,int,text,text)",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 567,
    "sourceTransform": null,
    "bodySha256": "dc75971641a1bf3118bbc3d1f08ba7349d5c94736aa12c99fde3f9b426b98aef",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.apply_inventory_opening_setup(uuid,jsonb,text,text)",
    "sourceMigration": "047_inventory_opening_setup.sql",
    "sourceLine": 200,
    "sourceTransform": null,
    "bodySha256": "ad15e0ff0e446d5203fc7bae70223a59cd24957d3799a5689ca444e2255a5faf",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.cancel_customer_order_v2(uuid,text,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 2474,
    "sourceTransform": null,
    "bodySha256": "fd8b9fca84ddb2c871ea0d1f3ba844bccfa0d634734e50f81ffe60abe0f8291d",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase3_release_customer_reservations_internal",
        "argument_count": 11
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.cancel_order(uuid,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 763,
    "sourceTransform": null,
    "bodySha256": "84098d1b0f3902b7ca879afa4fa9b0ab20bc4c3990e57bad8da1ebb33aa84430",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_order_impl",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.cancel_purchase_receipt_v2(uuid,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 3409,
    "sourceTransform": null,
    "bodySha256": "c692eb87cdd1090b0234244f4b19e594aeffd64f61b9bb5f88013c557efc148b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_purchase_receipt_v2_before_phase4_lock",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.cancel_supplier_receipt(uuid,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 3387,
    "sourceTransform": null,
    "bodySha256": "5bf1438714ce14d87d1aa648d85e29aa1666459c19a033862440adeb7bc23aab",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_cancel_supplier_receipt_before_phase4_lock",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.claim_automation_deliveries(text,int,int)",
    "sourceMigration": "096_harden_automation_delivery_lifecycle.sql",
    "sourceLine": 26,
    "sourceTransform": null,
    "bodySha256": "71aee5432b41ba415f366b2dd1f126a1cdb1c53c0f141f0881f0a73c44adeba6",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "automation_event_deliveries"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.complete_automation_delivery(uuid,text,bool,text)",
    "sourceMigration": "096_harden_automation_delivery_lifecycle.sql",
    "sourceLine": 119,
    "sourceTransform": null,
    "bodySha256": "46a4e548a72aa58c3edf5471eccfb4f7feba77a65d856a9de87d9c86464e74b2",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "automation_event_deliveries"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.complete_order(uuid,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 741,
    "sourceTransform": null,
    "bodySha256": "0f4de4befdd66000a9f4e707fe0cfb1774ea9f6233936fbc9687d5ab8d808d1a",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_complete_order_impl",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.complete_website_order_with_payment(uuid,text,text,text)",
    "sourceMigration": "042_website_order_payment_settlement.sql",
    "sourceLine": 48,
    "sourceTransform": null,
    "bodySha256": "090c1b3c519cf7ef1a7348c0426cf74104088982c1188ce977f3d81074bd5567",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "complete_order",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.complete_website_order_with_settlement(uuid,text,bigint,bigint,text,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 2809,
    "sourceTransform": null,
    "bodySha256": "c0055cf0124832a3cd47dc284daeabb7373c0bf76fe47881443b732b15656641",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_complete_website_order_with_settlement_before_phase4_lock",
        "argument_count": 6
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.complete_website_order_with_settlement_v2(uuid,text,text,bigint,bigint,text,text)",
    "sourceMigration": "120_phase4_returns_refunds_foundation.sql",
    "sourceLine": 2932,
    "sourceTransform": null,
    "bodySha256": "3b685835e5b3d0246d18df01d9939c9229d55716737347fdb408fa2f15bff521",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_complete_website_order_with_settlement_v2_before_phase4_lock",
        "argument_count": 7
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
    "sourceMigration": "023_wholesale_order_accounting.sql",
    "sourceLine": 391,
    "sourceTransform": null,
    "bodySha256": "cd204da674a1e713ab0e3789929be7609b12cf8cf368b5f1d189873eadafabe1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "create_customer_order_base_units_legacy",
        "argument_count": 24
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
    "sourceMigration": "018_customer_order_linking.sql",
    "sourceLine": 195,
    "sourceTransform": null,
    "bodySha256": "e178c90fd39f75b2f3e6c3a5e0621006b91815c5669700ff17de7268bec1091b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 3789,
    "sourceTransform": null,
    "bodySha256": "c042811ea5b03a8af94a0574d1666e2fed3802d1e15da24497c7edabdc8ce3b9",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "_create_direct_supplier_receipt_impl",
        "argument_count": 16
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 1325,
    "sourceTransform": null,
    "bodySha256": "17e5cd89f9b5a6d445ffe9a348a670545aea02a19629890c64064f0216072030",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase2_apply_inventory_and_wac_internal",
        "argument_count": 7
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_pos_sale(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "111_harden_pos_sale_idempotency_replays.sql",
    "sourceLine": 25,
    "sourceTransform": null,
    "bodySha256": "60304ed43b03a5866239f8db225e3fa706adcb9088e43f34a9808544b98baadd",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_create_pos_sale_package_legacy",
        "argument_count": 9
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "115_configurable_parcel_pos_sale_coordinator.sql",
    "sourceLine": 138,
    "sourceTransform": null,
    "bodySha256": "200faf3b56577e33925d1bdcc9de33ca57cf2b5d4d08c499f16e03ad553a1862",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_create_pos_sale_base_units_before_phase3_lock",
        "argument_count": 9
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 70,
    "sourceTransform": null,
    "bodySha256": "321a3e22afc02ced7a043892d5c147c462e4319a6b35716a6795a055f2c349c6",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_create_pos_sale_v2_before_registered_customer_lock",
        "argument_count": 9
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,text,jsonb)",
    "sourceMigration": "071_atomic_product_family_creation.sql",
    "sourceLine": 3,
    "sourceTransform": null,
    "bodySha256": "3674f6b65dc7c0ba9de06bb10e95346c859a1769fb1a1841cfb8d414f406f5a1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "create_product_flavor_v1",
        "argument_count": 6
      },
      {
        "name": "create_product_with_opening_stock_v4",
        "argument_count": 20
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_flavor_v1(uuid,text,int,uuid,text,text)",
    "sourceMigration": "070_product_flavor_variants.sql",
    "sourceLine": 176,
    "sourceTransform": null,
    "bodySha256": "fc3eba888779efebbc16f6143f0b40a28bb766f1274f3cec7b67d5a665bd51bd",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "create_product_with_opening_stock_v4",
        "argument_count": 20
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
    "sourceMigration": "012_supplier_purchasing_rbac.sql",
    "sourceLine": 139,
    "sourceTransform": null,
    "bodySha256": "9ae4b3e0ac8d986e89c51778b7f9147081ebb749552fc22570772ce5070591e3",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_create_product_with_opening_stock_impl",
        "argument_count": 17
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text)",
    "sourceMigration": "019_product_catalog_experience.sql",
    "sourceLine": 36,
    "sourceTransform": null,
    "bodySha256": "9db016873553b84912af5f82380391fd814171304018a52742cf77885271fb78",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "create_product_with_opening_stock",
        "argument_count": 17
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text,text)",
    "sourceMigration": "020_product_image_storage.sql",
    "sourceLine": 116,
    "sourceTransform": null,
    "bodySha256": "50559743f9c40b9d3f82801755fe1484e4890e2802fad0b16f0b605fed721d7b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "create_product_with_opening_stock_v2",
        "argument_count": 18
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,int,text,text)",
    "sourceMigration": "103_flavor_receiving_hardening.sql",
    "sourceLine": 201,
    "sourceTransform": null,
    "bodySha256": "40113e26b6b6ab69906e073f22d30b8d769e1f37176899ce483a747bd4ab6aed",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "create_product_with_opening_stock_v3",
        "argument_count": 19
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_automation_event(text,text,uuid,jsonb)",
    "sourceMigration": "099_advanced_monitoring_and_business_integrity.sql",
    "sourceLine": 116,
    "sourceTransform": null,
    "bodySha256": "2e8e7635b5754dd4be7ab3bfbc7678637912ec1e70fbff9dfcc2da531e46f1d9",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "automation_events"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_business_summary(text,date,date,timestamptz,timestamptz)",
    "sourceMigration": "098_business_summaries.sql",
    "sourceLine": 467,
    "sourceTransform": null,
    "bodySha256": "dccdef51722523267cbf2589210d2c2a8a029eccde893f7374e24137c2d5f15e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_closed_shift_automation_event()",
    "sourceMigration": "105_harden_business_alert_rules_and_thresholds.sql",
    "sourceLine": 44,
    "sourceTransform": null,
    "bodySha256": "1dbec25622223b3a8339c17cca18d04dd11ded4635d128894e3277ecf91548f1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_expired_order_business_alert()",
    "sourceMigration": "097_core_business_alerts.sql",
    "sourceLine": 264,
    "sourceTransform": null,
    "bodySha256": "8fcaad7aa09310cb1fe193cda3aec0680e660667610dd9f9df263fa1e9c1051e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_order_automation_event()",
    "sourceMigration": "102_privacy_minimize_business_alert_payload.sql",
    "sourceLine": 13,
    "sourceTransform": null,
    "bodySha256": "0158bc289ccbe9462a2cb91042e82395f0c7aac07431e2360d31094b0c47276c",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.enqueue_stock_automation_event()",
    "sourceMigration": "057_secure_n8n_automation_events.sql",
    "sourceLine": 158,
    "sourceTransform": null,
    "bodySha256": "7a01822c986427ff5dd6a57c0e0599cc4799f3de08c4608dd98fb59472d92049",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_automation_event",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.expire_stale_new_website_orders(int)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 2569,
    "sourceTransform": null,
    "bodySha256": "d79b831289411bfd62b2cb06e6f186e4df3a1f1810ba0f8c54e31a7c97e378f3",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_expire_customer_order_v2_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.mark_all_stock_alerts_read()",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 393,
    "sourceTransform": null,
    "bodySha256": "30eab73e75fa98a2afbb133e6c6d6fa955add9a40169c52dd280e463423be842",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "stock_alert_reads"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.mark_stock_alert_read(uuid)",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 345,
    "sourceTransform": null,
    "bodySha256": "2be28d31de3a4f7b61f81be297bf8100520bd529fd72eef0093d27725ee913c4",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "stock_alert_reads"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 1125,
    "sourceTransform": null,
    "bodySha256": "478de04336b432e0f0e3e637193256c91130a450d5c0c322dc56cc654195f05c",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase2_lock_inventory_products_internal(uuid[])",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 648,
    "sourceTransform": null,
    "bodySha256": "5b52c52d7da7ccdcbc44b1c7a5c2864df3aacf52ee067b92c4eaf85ea8663865",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase2_reverse_inventory_and_wac_internal(uuid,uuid,uuid,text,uuid,uuid,text)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 2770,
    "sourceTransform": null,
    "bodySha256": "84fbbd59a8551943c3d760941e7345644bf2410a2a5d18fc327cfe6f5e3dc8d8",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase3_expire_customer_order_v2_internal(uuid)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 2524,
    "sourceTransform": null,
    "bodySha256": "b1e9d43e45b8b22bde53afc3e30281246952733133923b47de75db39d5b308e7",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase3_release_customer_reservations_internal",
        "argument_count": 11
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase3_lock_inventory_products_internal(uuid[])",
    "sourceMigration": "114_configurable_parcel_sales_contracts_and_safety_primitives.sql",
    "sourceLine": 655,
    "sourceTransform": null,
    "bodySha256": "4fcc232683685ffc666f7fe4d4632dd2f89f8389dbedc1c58326ec22ef6db0fa",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase3_release_customer_reservations_internal(uuid,uuid,text,text,text,jsonb,text,text,uuid,text,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 2321,
    "sourceTransform": null,
    "bodySha256": "71d07609f9bd7c16c824908abc5631008584c87fc8db1665c7b2de83f6fe56cb",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)",
    "sourceMigration": "121_phase42_atomic_return_coordinator.sql",
    "sourceLine": 817,
    "sourceTransform": null,
    "bodySha256": "86e8f476bd0c0f30f54fca45c7dfa46e6a12d5574ce9a0f9a3cc382b2e11e16e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances",
      "products"
    ],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)",
    "sourceMigration": "122_phase43_admin_aftercare_integration.sql",
    "sourceLine": 1466,
    "sourceTransform": null,
    "bodySha256": "729bd35deff9e3a2328fa5d6ab7517a345691573968c101a294949915480f70a",
    "language": "sql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase42_apply_return_inventory_before_phase43_internal",
        "argument_count": 5
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.receive_inventory(uuid,uuid,int,text,uuid,text)",
    "sourceMigration": "050_admin_api_security_hardening.sql",
    "sourceLine": 102,
    "sourceTransform": null,
    "bodySha256": "ffa7a31b4c98631f482eba17962bf62b53916d1916e0e16925effd8da877b399",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_receive_inventory_impl",
        "argument_count": 6
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.receive_purchase_order(uuid,uuid,text,text,jsonb)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 4129,
    "sourceTransform": null,
    "bodySha256": "5c49c2657b15da95a78f274e08d3e8b963d24b38714cb8a3b1d122d3ed1677c1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "_receive_purchase_order_impl",
        "argument_count": 5
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.receive_purchase_order_v2(uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 2149,
    "sourceTransform": null,
    "bodySha256": "22da75271630b8124c0ee22742b01e2553bc68e2fa02f95b44b73ffbb5264d65",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase2_apply_inventory_and_wac_internal",
        "argument_count": 7
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.reorder_product_flavors_v1(uuid,uuid[])",
    "sourceMigration": "072_manage_product_flavors.sql",
    "sourceLine": 117,
    "sourceTransform": null,
    "bodySha256": "31744ee1bcf6351b2951f9fc002a920247855a7373c85897cb99880ed0dd0f79",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.return_completed_website_order(uuid,text,text,text,text,text)",
    "sourceMigration": "121_phase42_atomic_return_coordinator.sql",
    "sourceLine": 1897,
    "sourceTransform": null,
    "bodySha256": "4f7a807d2dac6b7b1568248c2e200ef6fe232941327dd87f723d111c7b15de6b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_return_completed_website_order_before_phase42_coordinator",
        "argument_count": 6
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.reverse_cash_shift_with_operations(uuid,text,text)",
    "sourceMigration": "121_phase42_atomic_return_coordinator.sql",
    "sourceLine": 2008,
    "sourceTransform": null,
    "bodySha256": "ba86dc1cc0b7b6b458e66806042c20a6280326d3f44a97dfed9b766de8cde199",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_reverse_cash_shift_with_operations_before_phase42_refund_guard",
        "argument_count": 3
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.reverse_pos_sale(uuid,text,text)",
    "sourceMigration": "115_configurable_parcel_pos_sale_coordinator.sql",
    "sourceLine": 1055,
    "sourceTransform": null,
    "bodySha256": "9b515578dcfe825024e136d0f0759e8788b0062ad3a0f7bf62b73c0ba557fca2",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.run_advanced_monitoring_checks(timestamptz)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 2791,
    "sourceTransform": null,
    "bodySha256": "06898e955fe5af94a7715c5084ac4262f79d405d2cc7e8f303759070f2dc500c",
    "language": "plpgsql",
    "searchPath": "public, extensions, auth, cron, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_transition_business_alert_incident",
        "argument_count": 7
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.scan_business_summaries(timestamptz)",
    "sourceMigration": "098_business_summaries.sql",
    "sourceLine": 531,
    "sourceTransform": null,
    "bodySha256": "1a414c7d7bd6c9aec63b06b669c4f5ab54f42ddc24c1eb03bf6fd39ca0a922f1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "enqueue_business_summary",
        "argument_count": 5
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.scan_core_business_alerts(timestamptz,int)",
    "sourceMigration": "105_harden_business_alert_rules_and_thresholds.sql",
    "sourceLine": 83,
    "sourceTransform": null,
    "bodySha256": "2febd96da107f4252438e3bd97a5a3cccb0fa8e478bd7563c08e5bb8bceac36f",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_transition_business_alert_incident",
        "argument_count": 6
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.settle_admin_sales_return_v1(uuid,text,jsonb,jsonb,text,text,text,text)",
    "sourceMigration": "122_phase43_admin_aftercare_integration.sql",
    "sourceLine": 1538,
    "sourceTransform": null,
    "bodySha256": "85d5030a09a2e11cda38ffa0a57906c023f6539f029c688f615e7c5b54447cbf",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "settle_sales_return_v1",
        "argument_count": 7
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.settle_sales_replacement_v1(uuid,text,jsonb,text,text)",
    "sourceMigration": "122_phase43_admin_aftercare_integration.sql",
    "sourceLine": 600,
    "sourceTransform": null,
    "bodySha256": "30299a56935b7c0427712c2a6209ead0bb6d3056f8b11113996738437a22a2a0",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)",
    "sourceMigration": "121_phase42_atomic_return_coordinator.sql",
    "sourceLine": 1023,
    "sourceTransform": null,
    "bodySha256": "745b4a8156fe353958eaa2f5378801b4f60837b351b41902b12ea45c6905c16e",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      },
      {
        "name": "phase42_apply_return_inventory_internal",
        "argument_count": 5
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.start_or_update_order_delivery(uuid,int,text,text)",
    "sourceMigration": "060_simplified_order_settlement_and_receivables.sql",
    "sourceLine": 74,
    "sourceTransform": null,
    "bodySha256": "659df6bae74b26d7368482621af2088bde6232b54fe10e203359f5e8aca5aeac",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "update_order_status",
        "argument_count": 3
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 915,
    "sourceTransform": null,
    "bodySha256": "b6a8591355fe773ccbd5fe121e9c80cebf1a8b8e012b735f6d09b2fa06f903a4",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_submit_guest_customer_order_v1_before_phase3",
        "argument_count": 17
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)",
    "sourceMigration": "090_optional_guest_delivery_details.sql",
    "sourceLine": 12,
    "sourceTransform": "090_optional_guest_delivery_details.sql:remove-exact-required-street-fragment",
    "bodySha256": "b6922259f90d354da873c852444b0366bb1ad4a388c0f3c478062f4508cf09f8",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "create_customer_order",
        "argument_count": 24
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)",
    "sourceMigration": "116_configurable_parcel_customer_reservation_coordinator.sql",
    "sourceLine": 1013,
    "sourceTransform": null,
    "bodySha256": "ea158e4e2b095fa98bc461648ef2d257779a5e69c2957f8babc13e703f31c6b1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [
      "inventory_balances"
    ],
    "callCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.sync_product_flavor_commercial_settings()",
    "sourceMigration": "103_flavor_receiving_hardening.sql",
    "sourceLine": 145,
    "sourceTransform": null,
    "bodySha256": "eb4347bea788215709d24c54d360b82c189013e6ae9c9ca137d54abbc96aacd2",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.sync_stock_alert(uuid,uuid,int,int)",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 73,
    "sourceTransform": null,
    "bodySha256": "09198200f16e9d794c55cebef3937837f974eb8c8cd59f8e8681bbbc2fc1d85b",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "stock_alert_reads",
      "stock_alerts"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.sync_stock_alert_from_balance()",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 172,
    "sourceTransform": null,
    "bodySha256": "4cc1cc81424fd3fd35bf11f866801c454caccf463572cc0d841b54614c90a3c8",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "sync_stock_alert",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.sync_stock_alert_from_product()",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 197,
    "sourceTransform": null,
    "bodySha256": "fbc126b6c712771fef1081cbfbb9037c20dd8b407a81ee5c5836f9df2dbda879",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "sync_stock_alert",
        "argument_count": 4
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.transfer_inventory_between_warehouses(uuid,uuid,uuid,int,text,timestamptz)",
    "sourceMigration": "113_configurable_parcel_receiving_and_exact_wac.sql",
    "sourceLine": 4351,
    "sourceTransform": null,
    "bodySha256": "4ec6b53152098b1aceb686bea78f4ba7e43e61602f76c00299767fc7c78d0ff7",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": "postgres",
    "directRelations": [],
    "callCandidates": [
      {
        "name": "_transfer_inventory_between_warehouses_phase2_legacy",
        "argument_count": 6
      },
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "inventoryGateDelegates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.update_order_status(uuid,text,text)",
    "sourceMigration": "030_secure_order_entrypoints.sql",
    "sourceLine": 22,
    "sourceTransform": null,
    "bodySha256": "66b3a2d58defb3305973c08b8dced26b27d4417e312f21f1b4ddc47ea90b9a1a",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [],
    "callCandidates": [
      {
        "name": "cancel_order",
        "argument_count": 2
      },
      {
        "name": "complete_order",
        "argument_count": 2
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DELEGATED_WRITE_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.update_product_flavor_v1(uuid,text,text,text,bool)",
    "sourceMigration": "072_manage_product_flavors.sql",
    "sourceLine": 3,
    "sourceTransform": null,
    "bodySha256": "fc64b164a3308735f70d9ef7c02415c8b668f1846dde93f4b3aac3b5e8a478f4",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.update_product_master(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,bool,text)",
    "sourceMigration": "014_simple_inventory_operations.sql",
    "sourceLine": 439,
    "sourceTransform": null,
    "bodySha256": "c7dee424db3a3de3e30cba1579af4b533ffe04c1e95f33e3e257ae1d304fe8e8",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.update_product_master_v2(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,bool,text)",
    "sourceMigration": "019_product_catalog_experience.sql",
    "sourceLine": 132,
    "sourceTransform": null,
    "bodySha256": "5cb36ffffda9d11a0530af1c0caf2459c4297b266c92630da0c7ccfaa0fb2e29",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "update_product_master",
        "argument_count": 17
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  },
  {
    "signature": "public.update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,bool,text)",
    "sourceMigration": "021_wholesale_sale_packages.sql",
    "sourceLine": 238,
    "sourceTransform": null,
    "bodySha256": "e82de71ca34ae776cbd199660f7e67f2b069ba746c4c978d110f3429108d25e1",
    "language": "plpgsql",
    "searchPath": "public, pg_temp",
    "sourceOwner": null,
    "directRelations": [
      "products"
    ],
    "callCandidates": [
      {
        "name": "update_product_master_v2",
        "argument_count": 18
      }
    ],
    "inventoryGateDelegates": [],
    "firstWriteReview": "DIRECT_WRITE_BRANCH_ORDER_REQUIRES_REVIEW",
    "earlyGateQualified": false
  }
]$sources$::JSONB;
  source_entry JSONB; routine RECORD; expected_oids OID[]; actual_oids OID[];
  sources JSONB := '[]'::JSONB; source_hash TEXT;
BEGIN
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS_TEXT(expected_signatures) s
      WHERE pg_catalog.to_regprocedure(s) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_CALLABLE_SET_INVALID';
  END IF;
  SELECT ARRAY_AGG(pg_catalog.to_regprocedure(s)::OID ORDER BY pg_catalog.to_regprocedure(s)::OID)
    INTO expected_oids FROM JSONB_ARRAY_ELEMENTS_TEXT(expected_signatures) s;
  SELECT ARRAY_AGG(p.oid ORDER BY p.oid) INTO actual_oids
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
  IF actual_oids IS DISTINCT FROM expected_oids THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_CALLABLE_SET_INVALID';
  END IF;
  FOR source_entry IN SELECT x FROM JSONB_ARRAY_ELEMENTS(expected_sources) x LOOP
    SELECT p.* INTO STRICT routine FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure(source_entry->>'signature');
    source_hash:=ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex');
    IF routine.prokind IS DISTINCT FROM 'f' OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM TRUE
      OR routine.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname=source_entry->>'language')
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path='||(source_entry->>'searchPath')]
      OR source_hash IS DISTINCT FROM source_entry->>'bodySha256' THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_SOURCE_CONTRACT_INVALID';
    END IF;
    sources:=sources||JSONB_BUILD_ARRAY(source_entry||JSONB_BUILD_OBJECT('catalog',TO_JSONB(routine),
      'branchOrderQualified',FALSE,'defaultCreationQualified',FALSE,'executionAuthority',FALSE));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version',1,'scope','INVENTORY_PARENT_SOURCE_PREPARATION_ONLY',
    'publicSignatures',expected_signatures,'sources',sources,
    'stockSource',phase5_private.plan_stock_writer_source_envelope_v1(),
    'authorityCatalog',phase5_private.inventory_authority_catalog_v1(),
    'reviewedSourceBodies',TRUE,'publicCallableIdentitySetMatches',TRUE,
    'completeWriterLedger',FALSE,'earlyGateQualified',FALSE,'defaultsQualified',FALSE,
    'writerClosed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,
    'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_inventory_parent_sources_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_inventory_parent_sources_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_inventory_parent_sources_v1(expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object'
    OR expected IS DISTINCT FROM phase5_private.plan_inventory_parent_sources_v1() THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PARENT_SOURCE_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_inventory_parent_sources_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_inventory_parent_sources_v1(JSONB) OWNER TO postgres;

-- Parent EXECUTE qualification is independently specified from historical ACLs.
-- Actor guards/call sites remain branch-review candidates, never early admission.
CREATE FUNCTION phase5_private.plan_inventory_parent_execute_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  expected JSONB := $execute_contract$[
  {
    "signature": "public._cancel_order_impl(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._cancel_order_impl_before_phase4_lock(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._cancel_purchase_receipt_v2_before_phase4_lock(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "purchase_order_items",
      "purchase_orders",
      "purchase_receipts",
      "supplier_financial_invoice_identities",
      "supplier_payments",
      "suppliers"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._cancel_supplier_receipt_before_phase4_lock(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "supplier_financial_invoice_identities",
      "supplier_payments",
      "supplier_receipts",
      "suppliers"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._cancel_supplier_receipt_impl(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "supplier_payments",
      "supplier_receipts",
      "suppliers"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._cancel_supplier_receipt_legacy_guarded_v2(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._complete_order_impl(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._complete_order_impl_before_phase4_lock(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._complete_website_order_with_settlement_before_phase4_lock(uuid,text,bigint,bigint,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._complete_website_order_with_settlement_v2_before_phase4_lock(uuid,text,text,bigint,bigint,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "inventory_balances",
      "inventory_movements",
      "order_inventory_reservations",
      "order_items",
      "order_parcel_components",
      "order_parcel_instances",
      "order_status_history",
      "orders",
      "phase3_customer_cost_finalization_guards",
      "phase3_customer_lifecycle_transition_guards"
    ],
    "gateCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "products",
      "supplier_payments",
      "supplier_receipt_items",
      "supplier_receipts",
      "suppliers"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "order_items",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._create_pos_sale_package_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "order_items",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._create_pos_sale_v2_before_registered_customer_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "inventory_balances",
      "inventory_movements",
      "order_items",
      "order_parcel_components",
      "order_parcel_instances",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._receive_inventory_impl(uuid,uuid,int,text,uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._receive_purchase_order_impl(uuid,uuid,text,text,jsonb)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "products",
      "purchase_order_items",
      "purchase_orders",
      "purchase_receipt_items",
      "purchase_receipts"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._return_completed_website_order_before_phase42_coordinator(uuid,text,text,text,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._return_completed_website_order_before_phase4_lock(uuid,text,text,text,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "order_status_history",
      "orders",
      "sales_returns"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._reverse_cash_shift_with_operations_before_phase42_refund_guard(uuid,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._reverse_cash_shift_with_operations_before_phase4_lock(uuid,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "cash_shift_reversal_operations",
      "cash_shift_reversals",
      "cash_shifts",
      "customer_payments",
      "operational_expenses",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._submit_guest_customer_order_v1_before_phase3(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._transfer_inventory_between_warehouses_phase2_legacy(uuid,uuid,uuid,int,text,timestamptz)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._transition_business_alert_incident(text,text,uuid,bool,timestamptz,jsonb,bool)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "business_alert_incidents"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public._update_order_status_impl(uuid,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.accept_order_for_preparation(uuid,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.adjust_inventory_stock(uuid,uuid,int,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.apply_inventory_opening_setup(uuid,jsonb,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "inventory_opening_items",
      "inventory_opening_sessions"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.cancel_customer_order_v2(uuid,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.cancel_order(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.cancel_purchase_receipt_v2(uuid,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.cancel_supplier_receipt(uuid,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.claim_automation_deliveries(text,int,int)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "automation_event_deliveries"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.complete_automation_delivery(uuid,text,bool,text)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "automation_event_deliveries"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.complete_order(uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.complete_website_order_with_payment(uuid,text,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.complete_website_order_with_settlement(uuid,text,bigint,bigint,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.complete_website_order_with_settlement_v2(uuid,text,text,bigint,bigint,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_customer_order(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "customers",
      "order_items",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "customer_addresses",
      "customers",
      "inventory_balances",
      "order_items",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_direct_supplier_receipt(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "business_operations",
      "products",
      "supplier_receipts"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_direct_supplier_receipt_v2(uuid,uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "supplier_financial_invoice_identities",
      "supplier_payments",
      "supplier_receipt_commercial_lines",
      "supplier_receipt_items",
      "supplier_receipts",
      "suppliers"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_pos_sale(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_pos_sale_v2(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_family_with_flavors_v1(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,text,jsonb)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_flavor_v1(uuid,text,int,uuid,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_with_opening_stock(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,uuid,int,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v2(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v3(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,uuid,int,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.create_product_with_opening_stock_v4(text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,uuid,int,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_automation_event(text,text,uuid,jsonb)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "automation_events"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_business_summary(text,date,date,timestamptz,timestamptz)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "business_summary_runs"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_closed_shift_automation_event()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_expired_order_business_alert()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_order_automation_event()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.enqueue_stock_automation_event()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.expire_stale_new_website_orders(int)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.mark_all_stock_alerts_read()",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "stock_alert_reads"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.mark_stock_alert_read(uuid)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "stock_alert_reads"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase2_apply_inventory_and_wac_internal(uuid,uuid,text,uuid,jsonb,uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "inventory_balances",
      "inventory_movements",
      "phase2_receipt_wac_snapshots",
      "products"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase2_lock_inventory_products_internal(uuid[])",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase2_reverse_inventory_and_wac_internal(uuid,uuid,uuid,text,uuid,uuid,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "inventory_balances",
      "inventory_movements",
      "products"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase3_expire_customer_order_v2_internal(uuid)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase3_lock_inventory_products_internal(uuid[])",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase3_release_customer_reservations_internal(uuid,uuid,text,text,text,jsonb,text,text,uuid,text,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "inventory_balances",
      "order_inventory_reservations",
      "order_status_history",
      "orders",
      "phase3_customer_lifecycle_transition_guards"
    ],
    "gateCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "inventory_balances",
      "inventory_movements",
      "phase42_return_inventory_effects",
      "products"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.receive_inventory(uuid,uuid,int,text,uuid,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.receive_purchase_order(uuid,uuid,text,text,jsonb)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "products"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.receive_purchase_order_v2(uuid,uuid,text,date,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text,text,jsonb)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "purchase_order_items",
      "purchase_orders",
      "purchase_receipt_commercial_lines",
      "purchase_receipt_items",
      "purchase_receipts",
      "supplier_financial_invoice_identities",
      "supplier_payments",
      "suppliers"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.reorder_product_flavors_v1(uuid,uuid[])",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.return_completed_website_order(uuid,text,text,text,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.reverse_cash_shift_with_operations(uuid,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.reverse_pos_sale(uuid,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "inventory_balances",
      "inventory_movements",
      "order_status_history",
      "orders",
      "pos_sale_reversals"
    ],
    "gateCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.run_advanced_monitoring_checks(timestamptz)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "advanced_monitoring_metrics",
      "advanced_monitoring_runtime_incidents"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.scan_business_summaries(timestamptz)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "business_summary_runs"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.scan_core_business_alerts(timestamptz,int)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.settle_admin_sales_return_v1(uuid,text,jsonb,jsonb,text,text,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.settle_sales_replacement_v1(uuid,text,jsonb,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "inventory_balances",
      "inventory_movements",
      "phase43_replacement_inventory_effects",
      "phase43_replacement_issuance_guards",
      "phase43_replacement_settlement_evidence",
      "sales_aftercare_consumptions",
      "sales_replacement_events",
      "sales_replacement_items"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.settle_sales_return_v1(uuid,text,jsonb,text,text,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "cash_shifts",
      "phase42_return_settlement_evidence",
      "phase42_return_settlement_guards",
      "sales_aftercare_consumptions",
      "sales_return_component_inspections",
      "sales_return_events",
      "sales_return_items"
    ],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.start_or_update_order_delivery(uuid,int,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.submit_guest_customer_order_core(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "orders",
      "promotion_redemptions"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)",
    "grantees": [
      "postgres",
      "service_role"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": true
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "audit_logs",
      "business_operations",
      "customer_addresses",
      "customers",
      "inventory_balances",
      "order_inventory_reservations",
      "order_items",
      "order_parcel_components",
      "order_parcel_instances",
      "order_status_history",
      "orders",
      "promotion_redemptions"
    ],
    "gateCandidates": [
      {
        "name": "phase3_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.sync_product_flavor_commercial_settings()",
    "grantees": [
      "postgres",
      "public"
    ],
    "directAppAcl": {
      "public": true,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.sync_stock_alert(uuid,uuid,int,int)",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [],
    "directWrites": [
      "stock_alert_reads",
      "stock_alerts"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.sync_stock_alert_from_balance()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.sync_stock_alert_from_product()",
    "grantees": [
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": false,
      "service_role": false
    },
    "triggerOnly": true,
    "actorGuardCandidates": [],
    "directWrites": [],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.transfer_inventory_between_warehouses(uuid,uuid,uuid,int,text,timestamptz)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [],
    "gateCandidates": [
      {
        "name": "phase2_lock_inventory_products_internal",
        "argument_count": 1
      }
    ],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.update_order_status(uuid,text,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "order_status_history",
      "orders"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.update_product_flavor_v1(uuid,text,text,text,bool)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.update_product_master(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,int,int,bool,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.update_product_master_v2(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,bigint,bigint,bigint,int,int,bool,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  },
  {
    "signature": "public.update_product_master_v3(uuid,text,text,text,text,uuid,uuid,uuid,uuid,int,bigint,uuid,int,bigint,bigint,int,int,bool,text)",
    "grantees": [
      "authenticated",
      "postgres"
    ],
    "directAppAcl": {
      "public": false,
      "anon": false,
      "authenticated": true,
      "service_role": false
    },
    "triggerOnly": false,
    "actorGuardCandidates": [
      {
        "name": "assert_erp_role",
        "argument_count": 2
      }
    ],
    "directWrites": [
      "audit_logs",
      "products"
    ],
    "gateCandidates": [],
    "branchOrderQualified": false,
    "allowedInvokerClosure": false,
    "executionAuthority": false
  }
]$execute_contract$::JSONB;
  parent_plan JSONB; entry JSONB; routine RECORD; actual_grantees JSONB; root_role TEXT; allowed BOOLEAN;
  result JSONB := '[]'::JSONB;
BEGIN
  parent_plan:=phase5_private.plan_inventory_parent_sources_v1();
  FOR entry IN SELECT value FROM JSONB_ARRAY_ELEMENTS(expected) LOOP
    SELECT p.* INTO STRICT routine FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure(entry->>'signature');
    SELECT COALESCE(JSONB_AGG(name ORDER BY name COLLATE "C"),'[]'::JSONB) INTO actual_grantees
    FROM (SELECT CASE WHEN a.grantee=0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(a.grantee) END name
      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) a) grants;
    IF actual_grantees IS DISTINCT FROM entry->'grantees'
      OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) a
        WHERE a.privilege_type IS DISTINCT FROM 'EXECUTE' OR a.is_grantable
          OR a.grantor IS DISTINCT FROM 'postgres'::REGROLE)
      OR (entry->>'triggerOnly')::BOOLEAN IS DISTINCT FROM (routine.prorettype='pg_catalog.trigger'::REGTYPE) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_EXECUTE_CONTRACT_INVALID';
    END IF;
    FOREACH root_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      allowed:=(entry#>>ARRAY['directAppAcl',root_role])::BOOLEAN OR (entry#>>'{directAppAcl,public}')::BOOLEAN;
      IF pg_catalog.has_function_privilege(root_role,routine.oid,'EXECUTE') IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PARENT_EFFECTIVE_EXECUTE_INVALID';
      END IF;
    END LOOP;
    result:=result||JSONB_BUILD_ARRAY(entry||JSONB_BUILD_OBJECT('directAclQualified',TRUE,
      'effectiveAppExecuteQualified',TRUE,'firstBusinessWriteQualified',FALSE,'earlyGateQualified',FALSE));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version',1,'scope','FIXED_PARENT_EXECUTE_PREPARATION_ONLY',
    'parentSource',parent_plan,'contracts',result,'directAclQualified',TRUE,'effectiveAppExecuteQualified',TRUE,
    'allowedInvokerClosure',FALSE,'firstBusinessWriteQualified',FALSE,'earlyGateQualified',FALSE,
    'completeWriterLedger',FALSE,'writerClosed',FALSE,'absencePredicatesFenced',FALSE,
    'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.plan_inventory_parent_execute_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.plan_inventory_parent_execute_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_inventory_parent_execute_v1(expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object'
    OR expected IS DISTINCT FROM phase5_private.plan_inventory_parent_execute_v1() THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PARENT_EXECUTE_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_inventory_parent_execute_v1(JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_inventory_parent_execute_v1(JSONB) OWNER TO postgres;

-- Read-mark resource discovery/revalidation ONLY. No source execution or locks.
-- SINGLE preserves resolved alerts; ALL_ACTIVE preserves empty success. The
-- complete selected read domain includes other actors because severity reset
-- deletes all reads. Candidate modes/gates are requirements, not held locks.
CREATE FUNCTION phase5_private.discover_read_mark_resources_v1(action TEXT, alert_identity UUID)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID:=auth.uid(); ids UUID[]; product_ids UUID[]; warehouse_ids UUID[];
  profile_ids UUID[]; resources JSONB; reads JSONB; targets JSONB; actor_roles JSONB;
  actor_contract JSONB:='[]'::JSONB; routine RECORD; grantees TEXT[];
  parent_contract JSONB; stock_contract JSONB;
BEGIN
  -- Guard bodies are independently pinned before relying on their decision.
  FOR routine IN SELECT p.*,s.signature,s.body_hash,s.path,s.grantees FROM (VALUES
    ('public.assert_erp_role(text[],text)',
      '43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62',
      'search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.is_mfa_policy_satisfied()',
      '6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef',
      'search_path=public, auth, pg_temp',ARRAY['authenticated','postgres']::TEXT[])
    ) s(signature,body_hash,path,grantees)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(s.signature)
    ORDER BY s.signature COLLATE "C" LOOP
    SELECT ARRAY_AGG(name ORDER BY name COLLATE "C") INTO grantees FROM (
      SELECT CASE WHEN a.grantee=0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(a.grantee) END name
      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) a) acl;
    IF routine.oid IS NULL OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM TRUE OR routine.provolatile IS DISTINCT FROM 's'
      OR routine.proconfig IS DISTINCT FROM ARRAY[routine.path]
      OR ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex')
        IS DISTINCT FROM routine.body_hash OR grantees IS DISTINCT FROM routine.grantees THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_READ_MARK_ACTOR_CONTRACT_INVALID';
    END IF;
    actor_contract:=actor_contract||JSONB_BUILD_ARRAY(TO_JSONB(routine)-'prosrc');
  END LOOP;
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales','warehouse_keeper','delivery_driver'],
    'تحديث حالة تنبيه المخزون');
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_READ_MARK_ACTOR_REQUIRED';
  END IF;
  IF action IS NULL OR action NOT IN ('SINGLE','ALL_ACTIVE')
    OR (action='SINGLE' AND alert_identity IS NULL)
    OR (action='ALL_ACTIVE' AND alert_identity IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_READ_MARK_SCOPE_INVALID';
  END IF;
  parent_contract:=phase5_private.plan_inventory_parent_execute_v1();
  stock_contract:=phase5_private.plan_stock_writer_source_envelope_v1();
  SELECT COALESCE(ARRAY_AGG(a.id ORDER BY a.id),ARRAY[]::UUID[]) INTO ids
    FROM public.stock_alerts a WHERE
      (action='SINGLE' AND a.id=alert_identity) OR (action='ALL_ACTIVE' AND a.status='active');
  IF action='SINGLE' AND CARDINALITY(ids)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_READ_MARK_ALERT_MISSING';
  END IF;
  SELECT COALESCE(ARRAY_AGG(DISTINCT a.product_id ORDER BY a.product_id),ARRAY[]::UUID[]),
    COALESCE(ARRAY_AGG(DISTINCT a.warehouse_id ORDER BY a.warehouse_id),ARRAY[]::UUID[])
    INTO product_ids,warehouse_ids FROM public.stock_alerts a WHERE a.id=ANY(ids);
  SELECT COALESCE(JSONB_AGG(TO_JSONB(r) ORDER BY r.stock_alert_id,r.user_id),'[]'::JSONB) INTO reads
    FROM public.stock_alert_reads r WHERE r.stock_alert_id=ANY(ids);
  SELECT ARRAY_AGG(id ORDER BY id) INTO profile_ids FROM (
    SELECT actor id UNION SELECT r.user_id FROM public.stock_alert_reads r WHERE r.stock_alert_id=ANY(ids)) users;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'identity',identity,
    'requiredMode',mode,'row',row_data) ORDER BY rank,identity::TEXT COLLATE "C"),'[]'::JSONB)
    INTO resources FROM (
      SELECT 1 rank,'public.profiles' relation,JSONB_BUILD_OBJECT('id',p.id) identity,'KEY_SHARE' mode,TO_JSONB(p) row_data
        FROM public.profiles p WHERE p.id=ANY(profile_ids)
      UNION ALL SELECT 2,'public.products',JSONB_BUILD_OBJECT('id',p.id),'KEY_SHARE',TO_JSONB(p)
        FROM public.products p WHERE p.id=ANY(product_ids)
      UNION ALL SELECT 3,'public.warehouses',JSONB_BUILD_OBJECT('id',w.id),'KEY_SHARE',TO_JSONB(w)
        FROM public.warehouses w WHERE w.id=ANY(warehouse_ids)
      UNION ALL SELECT 4,'public.stock_alerts',JSONB_BUILD_OBJECT('id',a.id),'KEY_SHARE',TO_JSONB(a)
        FROM public.stock_alerts a WHERE a.id=ANY(ids)
      UNION ALL SELECT 5,'public.stock_alert_reads',JSONB_BUILD_OBJECT('stock_alert_id',r.stock_alert_id,'user_id',r.user_id),
        'UPDATE',TO_JSONB(r) FROM public.stock_alert_reads r WHERE r.stock_alert_id=ANY(ids)
    ) rows;
  IF (SELECT COUNT(*) FROM public.profiles WHERE id=ANY(profile_ids))<>CARDINALITY(profile_ids)
    OR (SELECT COUNT(*) FROM public.products WHERE id=ANY(product_ids))<>CARDINALITY(product_ids)
    OR (SELECT COUNT(*) FROM public.warehouses WHERE id=ANY(warehouse_ids))<>CARDINALITY(warehouse_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_READ_MARK_PARENT_MISSING';
  END IF;
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('identity',JSONB_BUILD_OBJECT('stock_alert_id',a.id,'user_id',actor),
    'existing',COALESCE((SELECT TO_JSONB(r) FROM public.stock_alert_reads r
      WHERE r.stock_alert_id=a.id AND r.user_id=actor),'null'::JSONB)) ORDER BY a.id),'[]'::JSONB)
    INTO targets FROM public.stock_alerts a WHERE a.id=ANY(ids);
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),'role',TO_JSONB(r)) ORDER BY ur.role_id),'[]'::JSONB)
    INTO actor_roles FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor;
  RETURN JSONB_BUILD_OBJECT('version',1,'scope','READ_MARK_RESOURCE_DISCOVERY_ONLY',
    'action',action,'alertId',alert_identity,'actorId',actor,'actorRoles',actor_roles,'actorContract',actor_contract,
    'parentContract',parent_contract,'stockContract',stock_contract,'alertIds',TO_JSONB(ids),
    'productIds',TO_JSONB(product_ids),'warehouseIds',TO_JSONB(warehouse_ids),
    'inventoryGates',COALESCE((SELECT JSONB_AGG('inventory-product:'||id::TEXT ORDER BY id) FROM UNNEST(product_ids) p(id)),'[]'::JSONB),
    'resources',resources,'readRows',reads,'writeTargets',targets,
    'firstBusinessWriteQualified',FALSE,'earlyGateQualified',FALSE,'allowedInvokerClosure',FALSE,
    'completeWriterLedger',FALSE,'writerClosed',FALSE,'absencePredicatesFenced',FALSE,
    'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.discover_read_mark_resources_v1(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_read_mark_resources_v1(TEXT,UUID) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_read_mark_resources_v1(action TEXT, alert_identity UUID, expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actual JSONB;
BEGIN
  actual:=phase5_private.discover_read_mark_resources_v1(action,alert_identity);
  IF JSONB_TYPEOF(expected) IS DISTINCT FROM 'object' OR expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_READ_MARK_RESOURCES_CHANGED_RETRY';
  END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_read_mark_resources_v1(TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_read_mark_resources_v1(TEXT,UUID,JSONB) OWNER TO postgres;

-- Receipt prewrite admission: source discovery and real acquisition only.
-- This does NOT allocate future rows, claim a number, fence absence, authorize
-- an executor, or change the historical public receipt contract.
CREATE FUNCTION phase5_private.discover_receiving_prewrite_v1(
  order_identity UUID, warehouse_identity UUID, delivery_note TEXT, notes TEXT, items JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID:=auth.uid(); po public.purchase_orders%ROWTYPE; wh UUID;
  item JSONB; source public.purchase_order_items%ROWTYPE; quantity INTEGER;
  lines JSONB:='[]'::JSONB; product_ids UUID[]; rows JSONB; resources JSONB;
  domains JSONB; catalog JSONB; stock_contract JSONB; parent_contract JSONB;
  actor_contract JSONB; routine RECORD; grantees TEXT[];
BEGIN
  FOR routine IN SELECT p.*,s.signature,s.body_hash,s.path,s.grantees FROM (VALUES
    ('public.assert_erp_role(text[],text)',
      '43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62',
      'search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.is_mfa_policy_satisfied()',
      '6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef',
      'search_path=public, auth, pg_temp',ARRAY['authenticated','postgres']::TEXT[])
    ) s(signature,body_hash,path,grantees)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(s.signature) LOOP
    SELECT ARRAY_AGG(name ORDER BY name COLLATE "C") INTO grantees FROM (
      SELECT CASE WHEN a.grantee=0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(a.grantee) END name
      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) a) acl;
    IF routine.oid IS NULL OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM TRUE OR routine.provolatile IS DISTINCT FROM 's'
      OR routine.proconfig IS DISTINCT FROM ARRAY[routine.path]
      OR ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex')
        IS DISTINCT FROM routine.body_hash OR grantees IS DISTINCT FROM routine.grantees THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_RECEIVING_ACTOR_CONTRACT_INVALID';
    END IF;
  END LOOP;
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'استلام أوامر الشراء');
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_RECEIVING_ACTOR_REQUIRED'; END IF;
  parent_contract:=phase5_private.plan_inventory_parent_execute_v1();
  stock_contract:=phase5_private.plan_stock_writer_source_envelope_v1();
  IF order_identity IS NULL OR JSONB_TYPEOF(items) IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(items)=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_REQUEST_INVALID'; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id=order_identity;
  IF NOT FOUND OR po.status NOT IN ('approved','partially_received') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIVING_ORDER_INVALID'; END IF;
  wh:=COALESCE(warehouse_identity,po.warehouse_id);
  IF wh IS NULL OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wh) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_RECEIVING_WAREHOUSE_MISSING'; END IF;
  FOR item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(items) LOOP
    IF JSONB_TYPEOF(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_LINE_INVALID'; END IF;
    -- Historical payload UUID validation is retained, but NEVER SKU authority.
    PERFORM (item->>'product_id')::UUID;
    quantity:=COALESCE((item->>'received_quantity')::INTEGER,0);
    SELECT * INTO source FROM public.purchase_order_items
      WHERE id=(item->>'purchase_order_item_id')::UUID AND purchase_order_id=order_identity;
    IF quantity>0 AND (NOT FOUND OR source.product_id IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_RECEIVING_ITEM_MISSING'; END IF;
    IF quantity>0 THEN
      IF NOT item ? 'unit_cost_in_minor_units' OR item->>'unit_cost_in_minor_units' IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE2_LEGACY_COST_REQUIRED'; END IF;
      IF (CASE WHEN item->>'unit_cost_in_minor_units' ~ '^[0-9]+$'
        THEN (item->>'unit_cost_in_minor_units')::NUMERIC>9223372036854775807::NUMERIC ELSE TRUE END) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE2_LEGACY_COST_INVALID'; END IF;
    END IF;
    lines:=lines||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',JSONB_ARRAY_LENGTH(lines)+1,
      'request',item,'source',CASE WHEN source.id IS NULL THEN 'null'::JSONB ELSE TO_JSONB(source) END,
      'quantity',quantity,'cost',CASE WHEN quantity>0 THEN TO_JSONB((item->>'unit_cost_in_minor_units')::BIGINT) ELSE 'null'::JSONB END));
  END LOOP;
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(lines) n WHERE (n->>'quantity')::INT>0
    GROUP BY n->'source' HAVING SUM((n->>'quantity')::BIGINT)>
      ((n->'source'->>'ordered_quantity')::BIGINT-(n->'source'->>'received_quantity')::BIGINT)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIVING_CAPACITY_INVALID'; END IF;
  -- Include nonpositive requested sources, as the current113 wrapper does.
  SELECT COALESCE(ARRAY_AGG(DISTINCT (n->'source'->>'product_id')::UUID ORDER BY (n->'source'->>'product_id')::UUID),ARRAY[]::UUID[])
    INTO product_ids FROM JSONB_ARRAY_ELEMENTS(lines) n WHERE n->'source'->>'product_id' IS NOT NULL;
  IF CARDINALITY(product_ids)=0 OR (SELECT COUNT(*) FROM public.products WHERE id=ANY(product_ids))<>CARDINALITY(product_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_RECEIVING_PRODUCT_DOMAIN_INVALID'; END IF;
  -- Full WAC balances across warehouses, PO completion membership, and the
  -- complete existing alert/read/outbox graph, not just receipt target rows.
  WITH selected AS (
    SELECT 'public.inventory_balances' relation,TO_JSONB(t) row_data,'UPDATE' mode,5 rank
      FROM public.inventory_balances t WHERE product_id=ANY(product_ids)
    UNION ALL SELECT 'public.products',TO_JSONB(t),'NO_KEY_UPDATE',5 FROM public.products t WHERE id=ANY(product_ids)
    UNION ALL SELECT 'public.purchase_orders',TO_JSONB(po),'UPDATE',5
    UNION ALL SELECT 'public.purchase_order_items',TO_JSONB(t),'UPDATE',6 FROM public.purchase_order_items t WHERE purchase_order_id=order_identity
    UNION ALL SELECT 'public.stock_alerts',TO_JSONB(t),'UPDATE',6 FROM public.stock_alerts t WHERE product_id=ANY(product_ids)
    UNION ALL SELECT 'public.automation_events',TO_JSONB(t),'UPDATE',6 FROM public.automation_events t WHERE EXISTS(
      SELECT 1 FROM public.stock_alerts a WHERE a.product_id=ANY(product_ids)
        AND (t.entity_id=a.id OR STARTS_WITH(t.event_key,'stock_alert:'||a.id::TEXT||':')))
    UNION ALL SELECT 'public.stock_alert_reads',TO_JSONB(t),'UPDATE',6 FROM public.stock_alert_reads t
      JOIN public.stock_alerts a ON a.id=t.stock_alert_id WHERE a.product_id=ANY(product_ids)
    UNION ALL SELECT 'public.suppliers',TO_JSONB(t),'SHARE',7 FROM public.suppliers t WHERE id=po.supplier_id
    UNION ALL SELECT 'public.branches',TO_JSONB(t),'SHARE',7 FROM public.branches t WHERE id=po.branch_id
    UNION ALL SELECT 'public.warehouses',TO_JSONB(t),'SHARE',7 FROM public.warehouses t WHERE id IN (
      SELECT wh UNION SELECT po.warehouse_id UNION SELECT warehouse_id FROM public.inventory_balances WHERE product_id=ANY(product_ids)
      UNION SELECT warehouse_id FROM public.stock_alerts WHERE product_id=ANY(product_ids))
    UNION ALL SELECT 'public.profiles',TO_JSONB(t),'SHARE',7 FROM public.profiles t WHERE id IN (
      SELECT actor UNION SELECT po.created_by UNION SELECT po.approved_by UNION
      SELECT r.user_id FROM public.stock_alert_reads r JOIN public.stock_alerts a ON a.id=r.stock_alert_id WHERE a.product_id=ANY(product_ids))
    UNION ALL SELECT 'public.user_roles',TO_JSONB(t),'SHARE',7 FROM public.user_roles t WHERE user_id=actor
    UNION ALL SELECT 'public.roles',TO_JSONB(t),'SHARE',7 FROM public.roles t WHERE id IN (SELECT role_id FROM public.user_roles WHERE user_id=actor)
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',CASE relation
      WHEN 'public.stock_alert_reads' THEN row_data->>'stock_alert_id'||'|'||(row_data->>'user_id')
      WHEN 'public.user_roles' THEN row_data->>'user_id'||'|'||(row_data->>'role_id') ELSE row_data->>'id' END,
      'row',row_data,'rank',rank,'mode',mode)) INTO rows FROM selected;
  resources:=phase5_private.merge_completion_lock_resources_v1(rows);
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('productId',keys.product_identity,'warehouseId',wh,
    'targetBalance',COALESCE((SELECT TO_JSONB(b) FROM public.inventory_balances b WHERE b.product_id=keys.product_identity AND b.warehouse_id=wh),'null'::JSONB),
    'allWarehouseQuantity',(SELECT COALESCE(SUM(b.on_hand_quantity),0) FROM public.inventory_balances b WHERE b.product_id=keys.product_identity),
    'exactWac',(SELECT COALESCE(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC) FROM public.products p WHERE p.id=keys.product_identity),
    'futureIdentityClaimed',FALSE) ORDER BY keys.product_identity) INTO domains FROM UNNEST(product_ids) keys(product_identity);
  -- Record defaults, FKs, triggers and number namespace exactly. Capture is
  -- deliberately NOT target qualification or an absence fence.
  SELECT JSONB_BUILD_OBJECT(
    'defaults',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',d.adrelid::REGCLASS::TEXT,'column',a.attname,
      'expression',pg_get_expr(d.adbin,d.adrelid)) ORDER BY d.adrelid,a.attnum),'[]'::JSONB)
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid IN (
        'public.purchase_receipts'::REGCLASS,'public.purchase_receipt_items'::REGCLASS,'public.inventory_movements'::REGCLASS,'public.audit_logs'::REGCLASS)),
    'constraints',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',c.conrelid::REGCLASS::TEXT,'name',c.conname,
      'definition',pg_get_constraintdef(c.oid,TRUE)) ORDER BY c.conrelid,c.conname),'[]'::JSONB)
      FROM pg_constraint c WHERE c.conrelid IN ('public.purchase_orders'::REGCLASS,'public.purchase_order_items'::REGCLASS,
        'public.purchase_receipts'::REGCLASS,'public.purchase_receipt_items'::REGCLASS,'public.inventory_movements'::REGCLASS)),
    'triggers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',t.tgrelid::REGCLASS::TEXT,'name',t.tgname,
      'definition',pg_get_triggerdef(t.oid,TRUE),'function',t.tgfoid::REGPROCEDURE::TEXT) ORDER BY t.tgrelid,t.tgname),'[]'::JSONB)
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.purchase_orders'::REGCLASS,'public.purchase_order_items'::REGCLASS,
        'public.purchase_receipts'::REGCLASS,'public.purchase_receipt_items'::REGCLASS)),
    'receiptNumbers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',id,'number',receipt_number) ORDER BY id),'[]'::JSONB) FROM public.purchase_receipts)
  ) INTO catalog;
  SELECT JSONB_BUILD_OBJECT('profile',(SELECT TO_JSONB(p) FROM public.profiles p WHERE id=actor),
    'roles',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),'role',TO_JSONB(r)) ORDER BY ur.role_id),'[]'::JSONB)
      FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor)) INTO actor_contract;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receiving-prewrite-v1','actorId',actor,'actorContract',actor_contract,
    'request',JSONB_BUILD_OBJECT('orderId',order_identity,'warehouseId',warehouse_identity,'deliveryNote',delivery_note,'notes',notes,'items',items),
    'effectiveWarehouseId',wh,'lines',lines,'productIds',TO_JSONB(product_ids),'resources',resources,'domains',domains,
    'inventoryGates',(SELECT JSONB_AGG('inventory-product:'||id::TEXT ORDER BY id) FROM UNNEST(product_ids) p(id)),
    'parentContract',parent_contract,'stockContract',stock_contract,'receiptCatalog',catalog,
    'locksHeld',FALSE,'futureIdentityClaimed',FALSE,'numberClaimed',FALSE,'defaultsQualified',FALSE,'allowedInvokerClosure',FALSE,
    'absencePredicatesFenced',FALSE,'writerClosed',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.discover_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receiving_prewrite_v1(
  order_identity UUID,warehouse_identity UUID,delivery_note TEXT,notes TEXT,items JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_receiving_prewrite_v1(order_identity,warehouse_identity,delivery_note,notes,items) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.acquire_receiving_prewrite_v1(
  order_identity UUID,warehouse_identity UUID,delivery_note TEXT,notes TEXT,items JSONB,expected JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; n JSONB; gate TEXT; actual JSONB; identity UUID;
BEGIN
  plan:=phase5_private.discover_receiving_prewrite_v1(order_identity,warehouse_identity,delivery_note,notes,items);
  IF expected IS DISTINCT FROM plan THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY'; END IF;
  IF EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE l.pid=pg_backend_pid() AND l.granted AND ns.nspname IN ('public','auth','phase5_private') AND l.mode<>'AccessShareLock'
      AND c.oid NOT IN ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS))
    OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND granted AND locktype='advisory') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_LATE_ENTRY_RETRY'; END IF;
  PERFORM 1 FROM phase5_private.authority_generation WHERE singleton AND generation=0 AND authority_state='PRIVATE_INACTIVE'
    AND manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099' FOR SHARE NOWAIT;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM phase5_private.activation_receipts) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_RECEIVING_PREPARATION_ONLY'; END IF;
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'inventoryGates') ORDER BY value COLLATE "C" LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  -- Same inventory domain/order as113: all balances, then products, then
  -- receipt parent/children and existing side-effect/FK resources.
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal) ORDER BY ordinal LOOP
    identity:=CASE WHEN n->>'relation' IN ('public.stock_alert_reads','public.user_roles') THEN NULL ELSE (n->>'id')::UUID END;
    actual:=NULL;
    CASE n->>'relation'
      WHEN 'public.inventory_balances' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_balances t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.products' THEN SELECT TO_JSONB(t) INTO actual FROM public.products t WHERE id=identity FOR NO KEY UPDATE NOWAIT;
      WHEN 'public.purchase_orders' THEN SELECT TO_JSONB(t) INTO actual FROM public.purchase_orders t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.purchase_order_items' THEN SELECT TO_JSONB(t) INTO actual FROM public.purchase_order_items t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alerts' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alerts t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.automation_events' THEN SELECT TO_JSONB(t) INTO actual FROM public.automation_events t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alert_reads' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alert_reads t
        WHERE stock_alert_id=(n->'row'->>'stock_alert_id')::UUID AND user_id=(n->'row'->>'user_id')::UUID FOR UPDATE NOWAIT;
      WHEN 'public.suppliers' THEN SELECT TO_JSONB(t) INTO actual FROM public.suppliers t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.branches' THEN SELECT TO_JSONB(t) INTO actual FROM public.branches t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.warehouses' THEN SELECT TO_JSONB(t) INTO actual FROM public.warehouses t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.profiles' THEN SELECT TO_JSONB(t) INTO actual FROM public.profiles t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.roles t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.user_roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.user_roles t
        WHERE user_id=(n->'row'->>'user_id')::UUID AND role_id=(n->'row'->>'role_id')::UUID FOR SHARE NOWAIT;
      ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_RESOURCE_UNSUPPORTED';
    END CASE;
    IF actual IS DISTINCT FROM n->'row' THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_PREWRITE_CHANGED_RETRY'; END IF;
  END LOOP;
  PERFORM phase5_private.assert_receiving_prewrite_v1(order_identity,warehouse_identity,delivery_note,notes,items,plan);
  RETURN plan||JSONB_BUILD_OBJECT('locksHeld',TRUE,'acquisitionState','PRIVATE_INACTIVE_RESOURCES_ACQUIRED_ONLY',
    'actualBackendPid',pg_backend_pid(),'actualTransactionId',txid_current()::TEXT,'executionAuthority',FALSE,'heldContextAuthority',FALSE);
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_CONTENTION_RETRY';
END; $$;
REVOKE ALL ON FUNCTION phase5_private.acquire_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.acquire_receiving_prewrite_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

-- Whole-family prewrite allocation ONLY: no public/default/trigger activation.
-- Allocation is minted within acquire, before every advisory/parent row lock.
-- Pure discovery can inspect a hypothetical allocation; it is NEVER a claim,
-- trusted execution context, or permission to pass IDs into historical RPCs.
CREATE FUNCTION phase5_private.assert_product_creation_actor_v1()
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE actor UUID:=auth.uid(); routine RECORD; grantees TEXT[];
BEGIN
  -- Independent identity/authority validation, before business-source reads.
  FOR routine IN SELECT p.*,s.signature,s.body_hash,s.path,s.grantees FROM (VALUES
    ('public.assert_erp_role(text[],text)',
      '43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62',
      'search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.is_mfa_policy_satisfied()',
      '6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef',
      'search_path=public, auth, pg_temp',ARRAY['authenticated','postgres']::TEXT[])
    ) s(signature,body_hash,path,grantees)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(s.signature) LOOP
    SELECT ARRAY_AGG(name ORDER BY name COLLATE "C") INTO grantees FROM (
      SELECT CASE WHEN x.grantee=0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(x.grantee) END name
      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) x) acl;
    IF routine.oid IS NULL OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM TRUE OR routine.provolatile IS DISTINCT FROM 's'
      OR routine.proconfig IS DISTINCT FROM ARRAY[routine.path]
      OR ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex')
        IS DISTINCT FROM routine.body_hash OR grantees IS DISTINCT FROM routine.grantees THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_PRODUCT_ACTOR_CONTRACT_INVALID'; END IF;
  END LOOP;
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'إنشاء المنتجات والنكهات');
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PRODUCT_ACTOR_REQUIRED'; END IF;
  RETURN actor;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_product_creation_actor_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_product_creation_actor_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.discover_product_creation_prewrite_v1(kind TEXT, request JSONB, allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID; master public.products%ROWTYPE; root_id UUID;
  root JSONB; flavors JSONB; n JSONB; a JSONB; field TEXT; wh UUID; ids UUID[];
  future JSONB:='[]'::JSONB; keys TEXT[]; gates JSONB; rows JSONB; resources JSONB;
  parent_contract JSONB; stock_contract JSONB; catalog JSONB; actor_contract JSONB;
  sort_start INTEGER:=0; ordinal INTEGER:=0; sku TEXT; barcode TEXT; flavor_name TEXT;
  unit_sale INTEGER; unit_price BIGINT;
BEGIN
  actor:=phase5_private.assert_product_creation_actor_v1();
  parent_contract:=phase5_private.plan_inventory_parent_execute_v1();
  stock_contract:=phase5_private.plan_stock_writer_source_envelope_v1();
  IF kind IS NULL OR kind NOT IN ('FAMILY_V1','FLAVOR_V1') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_KIND_INVALID'; END IF;
  PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['rootId','children']);
  root_id:=phase5_private.wire_uuid_v1(allocation->'rootId');
  IF JSONB_TYPEOF(allocation->'children') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ALLOCATION_INVALID'; END IF;
  IF kind='FAMILY_V1' THEN
    PERFORM phase5_private.assert_wire_keys_v1(request,ARRAY['sku','barcode','nameAr','description','categoryId','brandId',
      'unitId','purchaseUnitId','unitsPerPurchaseUnit','defaultPurchasePriceInMinorUnits','saleUnitId','unitsPerSaleUnit',
      'defaultSalePriceInMinorUnits','costPriceInMinorUnits','minStockLevel','maxStockLevel','warehouseId','imageUrl','flavors']);
    FOR field IN SELECT UNNEST(ARRAY['sku','nameAr']) LOOP
      IF JSONB_TYPEOF(request->field) IS DISTINCT FROM 'string' OR BTRIM(request->>field)='' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_TEXT_INVALID'; END IF;
    END LOOP;
    FOR field IN SELECT UNNEST(ARRAY['barcode','description','imageUrl']) LOOP
      IF request->field IS DISTINCT FROM 'null'::JSONB AND JSONB_TYPEOF(request->field) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_TEXT_INVALID'; END IF;
    END LOOP;
    -- A family root will be promoted:108 forbids root barcodes at that boundary.
    IF NULLIF(BTRIM(request->>'barcode'),'') IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_FAMILY_BARCODE_INVALID'; END IF;
    FOR field IN SELECT UNNEST(ARRAY['categoryId','brandId','unitId','purchaseUnitId','saleUnitId','warehouseId']) LOOP
      IF request->field IS DISTINCT FROM 'null'::JSONB THEN PERFORM phase5_private.wire_uuid_v1(request->field); END IF;
    END LOOP;
    FOR field IN SELECT UNNEST(ARRAY['unitsPerPurchaseUnit','unitsPerSaleUnit','minStockLevel','maxStockLevel']) LOOP
      IF field='maxStockLevel' AND request->field='null'::JSONB THEN CONTINUE; END IF;
      IF JSONB_TYPEOF(request->field) IS DISTINCT FROM 'number' OR (request->>field) !~ '^(0|[1-9][0-9]*)$'
        OR (request->>field)::NUMERIC>2147483647 THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_INTEGER_INVALID'; END IF;
    END LOOP;
    FOR field IN SELECT UNNEST(ARRAY['defaultPurchasePriceInMinorUnits','defaultSalePriceInMinorUnits','costPriceInMinorUnits']) LOOP
      PERFORM phase5_private.wire_money_v1(request->field);
    END LOOP;
    IF (request->>'unitsPerPurchaseUnit')::INT<1 OR (request->>'unitsPerSaleUnit')::INT<1
      OR phase5_private.wire_money_v1(request->'defaultSalePriceInMinorUnits')=0
      OR (request->>'maxStockLevel')::INT<(request->>'minStockLevel')::INT THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_PACKAGING_INVALID'; END IF;
    root:=request-'flavors'; root:=root||JSONB_BUILD_OBJECT('sku',UPPER(BTRIM(request->>'sku')),
      'nameAr',BTRIM(request->>'nameAr'),'purchaseUnitId',COALESCE(NULLIF(request->'purchaseUnitId','null'::JSONB),request->'unitId'));
    flavors:=request->'flavors';
    IF JSONB_TYPEOF(flavors) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_FLAVORS_INVALID'; END IF;
  ELSE
    PERFORM phase5_private.assert_wire_keys_v1(request,ARRAY['masterId','nameAr','openingSalePackages','warehouseId','imageUrl','barcode']);
    IF phase5_private.wire_uuid_v1(request->'masterId') IS DISTINCT FROM root_id THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ROOT_ID_INVALID'; END IF;
    FOR field IN SELECT UNNEST(ARRAY['imageUrl','barcode']) LOOP
      IF request->field IS DISTINCT FROM 'null'::JSONB AND JSONB_TYPEOF(request->field) IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_TEXT_INVALID'; END IF;
    END LOOP;
    IF request->'warehouseId' IS DISTINCT FROM 'null'::JSONB THEN PERFORM phase5_private.wire_uuid_v1(request->'warehouseId'); END IF;
    IF request->'openingSalePackages' IS DISTINCT FROM 'null'::JSONB AND
      (JSONB_TYPEOF(request->'openingSalePackages') IS DISTINCT FROM 'number' OR request->>'openingSalePackages' !~ '^0$') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_V4_OPENING_STOCK_FORBIDDEN'; END IF;
    SELECT * INTO master FROM public.products WHERE id=root_id;
    IF NOT FOUND OR master.flavor_master_product_id IS NOT NULL OR NOT master.is_active THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_MASTER_INVALID'; END IF;
    IF NOT master.is_flavor_master AND master.barcode IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_MASTER_BARCODE_INVALID'; END IF;
    IF NOT master.is_flavor_master AND (EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=root_id
        AND (on_hand_quantity<>0 OR reserved_quantity<>0)) OR EXISTS(SELECT 1 FROM public.inventory_movements WHERE product_id=root_id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_MASTER_STOCK_HISTORY_INVALID'; END IF;
    SELECT COALESCE(MAX(flavor_sort_order),0) INTO sort_start FROM public.products WHERE flavor_master_product_id=root_id;
    root:=JSONB_BUILD_OBJECT('sku',master.sku,'nameAr',master.name_ar,'description',master.description,
      'categoryId',master.category_id,'brandId',master.brand_id,'unitId',master.unit_id,'purchaseUnitId',master.purchase_unit_id,
      'unitsPerPurchaseUnit',master.units_per_purchase_unit,'defaultPurchasePriceInMinorUnits',master.default_purchase_price_in_minor_units::TEXT,
      'saleUnitId',master.sale_unit_id,'unitsPerSaleUnit',master.units_per_sale_unit,
      'defaultSalePriceInMinorUnits',master.default_sale_price_in_minor_units::TEXT,'costPriceInMinorUnits',master.cost_price_in_minor_units::TEXT,
      'minStockLevel',master.min_stock_level,'maxStockLevel',master.max_stock_level);
    flavors:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('nameAr',request->'nameAr','openingSalePackages',request->'openingSalePackages',
      'imageUrl',request->'imageUrl','barcode',request->'barcode'));
  END IF;
  IF JSONB_ARRAY_LENGTH(flavors) NOT BETWEEN 1 AND 30 OR JSONB_ARRAY_LENGTH(allocation->'children')<>JSONB_ARRAY_LENGTH(flavors) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ALLOCATION_INVALID'; END IF;
  unit_sale:=(root->>'unitsPerSaleUnit')::INT;
  IF COALESCE(unit_sale,0)<1 OR COALESCE((root->>'defaultSalePriceInMinorUnits')::BIGINT,0)<=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_PACKAGING_INVALID'; END IF;
  unit_price:=ROUND((root->>'defaultSalePriceInMinorUnits')::NUMERIC/unit_sale)::BIGINT;
  IF root->>'saleUnitId' IS NULL OR NOT EXISTS(SELECT 1 FROM public.units WHERE id=(root->>'saleUnitId')::UUID AND code<>'PCS') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_SALE_UNIT_INVALID'; END IF;
  FOR field IN SELECT UNNEST(ARRAY['unitId','purchaseUnitId']) LOOP
    IF root->>field IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.units WHERE id=(root->>field)::UUID) THEN
      RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_PRODUCT_UNIT_MISSING'; END IF;
  END LOOP;
  IF root->>'categoryId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=(root->>'categoryId')::UUID)
    OR root->>'brandId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.brands WHERE id=(root->>'brandId')::UUID) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_PRODUCT_CLASSIFICATION_MISSING'; END IF;
  wh:=(request->>'warehouseId')::UUID;
  IF wh IS NULL THEN SELECT id INTO wh FROM public.warehouses WHERE is_active ORDER BY created_at,id LIMIT 1; END IF;
  IF wh IS NULL OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wh AND is_active) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='PHASE5_PRODUCT_WAREHOUSE_MISSING'; END IF;
  IF kind='FAMILY_V1' THEN future:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',root_id,'kind','MASTER','rootId',root_id,
    'sku',root->'sku','barcode',NULL,'spec',root,'warehouseId',request->'warehouseId','openingQuantity',0)); END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(flavors) LOOP
    ordinal:=ordinal+1; a:=allocation->'children'->(ordinal-1);
    PERFORM phase5_private.assert_wire_keys_v1(a,ARRAY['id','skuClockText']);
    PERFORM phase5_private.wire_uuid_v1(a->'id');
    IF JSONB_TYPEOF(a->'skuClockText') IS DISTINCT FROM 'string' OR LENGTH(a->>'skuClockText') NOT BETWEEN 1 AND 100
      OR JSONB_TYPEOF(n) IS DISTINCT FROM 'object' OR JSONB_TYPEOF(n->'nameAr') IS DISTINCT FROM 'string' OR BTRIM(n->>'nameAr')='' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_FLAVOR_INVALID'; END IF;
    --071 clamps negative packages;070 rejects them. Both still delegate to103 V4.
    IF (CASE WHEN kind='FAMILY_V1' THEN GREATEST(0,COALESCE((n->>'openingSalePackages')::INT,0))
      ELSE COALESCE((n->>'openingSalePackages')::INT,0) END)<>0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_PRODUCT_V4_OPENING_STOCK_FORBIDDEN'; END IF;
    flavor_name:=BTRIM(n->>'nameAr'); barcode:=CASE WHEN kind='FLAVOR_V1' THEN NULLIF(BTRIM(n->>'barcode'),'') ELSE NULL END;
    IF kind='FLAVOR_V1' AND EXISTS(SELECT 1 FROM public.products WHERE flavor_master_product_id=root_id
      AND LOWER(BTRIM(flavor_name_ar))=LOWER(flavor_name)) OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(future) f
      WHERE f->>'kind'='FLAVOR' AND LOWER(f->>'flavorNameAr')=LOWER(flavor_name)) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_PRODUCT_FLAVOR_NAME_CONFLICT'; END IF;
    sku:=UPPER(LEFT(root->>'sku',42)||'-F-'||SUBSTRING(MD5(flavor_name||(a->>'skuClockText')),1,8));
    future:=future||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',a->'id','kind','FLAVOR','rootId',root_id,'sku',sku,'barcode',barcode,
      'flavorNameAr',flavor_name,'sortOrder',sort_start+ordinal*10,'spec',root,
      'imageUrl',COALESCE(NULLIF(BTRIM(n->>'imageUrl'),''),CASE WHEN kind='FAMILY_V1' THEN NULLIF(BTRIM(request->>'imageUrl'),'') ELSE
        (SELECT image_url FROM public.product_images WHERE product_id=root_id ORDER BY is_primary DESC,display_order,created_at LIMIT 1) END),
      'warehouseId',wh,'openingQuantity',0,'salePriceInMinorUnits',unit_price::TEXT));
  END LOOP;
  SELECT ARRAY_AGG((f->>'id')::UUID ORDER BY (f->>'id')::UUID) INTO ids FROM JSONB_ARRAY_ELEMENTS(future) f;
  IF CARDINALITY(ids)<>(SELECT COUNT(DISTINCT x) FROM UNNEST(ids) x) OR root_id=ANY(ids) AND kind='FLAVOR_V1'
    OR EXISTS(SELECT 1 FROM public.products WHERE id=ANY(ids)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_PRODUCT_FUTURE_ID_CONFLICT'; END IF;
  SELECT ARRAY_AGG(k ORDER BY k COLLATE "C") INTO keys FROM (
    SELECT LOWER(f->>'sku') k FROM JSONB_ARRAY_ELEMENTS(future) f
    UNION ALL SELECT LOWER(f->>'barcode') FROM JSONB_ARRAY_ELEMENTS(future) f WHERE f->>'barcode' IS NOT NULL) names;
  --108 allows a product's own SKU and barcode to share a normalized key.
  -- Reject only reuse by DISTINCT future product identities, not two fields
  -- of the same future row. The actual lock union deduplicates shared keys.
  IF EXISTS(SELECT 1 FROM (
      SELECT f->>'id' identity,LOWER(f->>'sku') key FROM JSONB_ARRAY_ELEMENTS(future) f
      UNION ALL SELECT f->>'id',LOWER(f->>'barcode') FROM JSONB_ARRAY_ELEMENTS(future) f WHERE f->>'barcode' IS NOT NULL
    ) identifiers GROUP BY key HAVING COUNT(DISTINCT identity)>1) OR EXISTS(SELECT 1 FROM public.products p
    WHERE LOWER(BTRIM(p.sku))=ANY(keys) OR LOWER(NULLIF(BTRIM(p.barcode),''))=ANY(keys)) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PHASE5_PRODUCT_IDENTIFIER_CONFLICT'; END IF;
  -- Existing root and all siblings participate before promotion/sync/image/FKs.
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO ids FROM (
    SELECT UNNEST(ids) id UNION SELECT root_id WHERE kind='FLAVOR_V1'
    UNION SELECT id FROM public.products WHERE kind='FLAVOR_V1' AND flavor_master_product_id=root_id) domain;
  SELECT JSONB_AGG(gate ORDER BY phase,gate COLLATE "C") INTO gates FROM (
    SELECT DISTINCT 0 phase,'inventory-product:'||id::TEXT gate FROM UNNEST(ids) p(id)
    UNION SELECT 1,'product_identifier:'||k FROM UNNEST(keys) k
    UNION SELECT 1,'product_identifier:'||LOWER(BTRIM(p.sku)) FROM public.products p WHERE p.id=ANY(ids)
    UNION SELECT 1,'product_identifier:'||LOWER(BTRIM(p.barcode)) FROM public.products p WHERE p.id=ANY(ids) AND NULLIF(BTRIM(p.barcode),'') IS NOT NULL) g;
  WITH selected AS (
    SELECT 'public.inventory_balances' relation,TO_JSONB(t) row_data,'UPDATE' mode,5 rank FROM public.inventory_balances t WHERE product_id=ANY(ids)
    UNION ALL SELECT 'public.products',TO_JSONB(t),'NO_KEY_UPDATE',5 FROM public.products t WHERE id=ANY(ids)
    UNION ALL SELECT 'public.product_images',TO_JSONB(t),'UPDATE',6 FROM public.product_images t WHERE product_id=ANY(ids)
    UNION ALL SELECT 'public.stock_alerts',TO_JSONB(t),'UPDATE',6 FROM public.stock_alerts t WHERE product_id=ANY(ids)
    UNION ALL SELECT 'public.stock_alert_reads',TO_JSONB(t),'UPDATE',6 FROM public.stock_alert_reads t JOIN public.stock_alerts s ON s.id=t.stock_alert_id WHERE s.product_id=ANY(ids)
    UNION ALL SELECT 'public.automation_events',TO_JSONB(t),'UPDATE',6 FROM public.automation_events t WHERE EXISTS(SELECT 1 FROM public.stock_alerts s
      WHERE s.product_id=ANY(ids) AND (t.entity_id=s.id OR STARTS_WITH(t.event_key,'stock_alert:'||s.id::TEXT||':')))
    UNION ALL SELECT 'public.units',TO_JSONB(t),'SHARE',7 FROM public.units t WHERE id IN ((root->>'unitId')::UUID,(root->>'purchaseUnitId')::UUID,(root->>'saleUnitId')::UUID)
    UNION ALL SELECT 'public.categories',TO_JSONB(t),'SHARE',7 FROM public.categories t WHERE id=(root->>'categoryId')::UUID
    UNION ALL SELECT 'public.brands',TO_JSONB(t),'SHARE',7 FROM public.brands t WHERE id=(root->>'brandId')::UUID
    UNION ALL SELECT 'public.warehouses',TO_JSONB(t),'SHARE',7 FROM public.warehouses t WHERE id=wh OR id IN (
      SELECT warehouse_id FROM public.inventory_balances WHERE product_id=ANY(ids) UNION SELECT warehouse_id FROM public.stock_alerts WHERE product_id=ANY(ids))
    UNION ALL SELECT 'public.branches',TO_JSONB(t),'SHARE',7 FROM public.branches t WHERE id IN (SELECT branch_id FROM public.warehouses WHERE id=wh)
    UNION ALL SELECT 'public.profiles',TO_JSONB(t),'SHARE',7 FROM public.profiles t WHERE id=actor OR id IN (
      SELECT r.user_id FROM public.stock_alert_reads r JOIN public.stock_alerts s ON s.id=r.stock_alert_id WHERE s.product_id=ANY(ids))
    UNION ALL SELECT 'public.user_roles',TO_JSONB(t),'SHARE',7 FROM public.user_roles t WHERE user_id=actor
    UNION ALL SELECT 'public.roles',TO_JSONB(t),'SHARE',7 FROM public.roles t WHERE id IN (SELECT role_id FROM public.user_roles WHERE user_id=actor)
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',CASE relation
      WHEN 'public.stock_alert_reads' THEN row_data->>'stock_alert_id'||'|'||(row_data->>'user_id')
      WHEN 'public.user_roles' THEN row_data->>'user_id'||'|'||(row_data->>'role_id') ELSE row_data->>'id' END,
      'row',row_data,'mode',mode,'rank',rank)) INTO rows FROM selected;
  resources:=phase5_private.merge_completion_lock_resources_v1(rows);
  actor_contract:=JSONB_BUILD_OBJECT('profile',(SELECT TO_JSONB(t) FROM public.profiles t WHERE id=actor),
    'roles',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(t),'role',TO_JSONB(r)) ORDER BY t.role_id)
      FROM public.user_roles t JOIN public.roles r ON r.id=t.role_id WHERE t.user_id=actor));
  catalog:=phase5_private.inventory_authority_catalog_v1();
  RETURN JSONB_BUILD_OBJECT('version','phase5-product-creation-prewrite-v1','kind',kind,'actorId',actor,'actorContract',actor_contract,
    'request',request,'allocation',allocation,'futureProducts',future,'productIds',TO_JSONB(ids),'gates',gates,'resources',resources,
    'rootRow',CASE WHEN kind='FLAVOR_V1' THEN TO_JSONB(master) ELSE 'null'::JSONB END,
    'existingMovements',(SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY id),'[]'::JSONB) FROM public.inventory_movements t WHERE product_id=ANY(ids)),
    'activeWarehouseSelection',(SELECT COALESCE(JSONB_AGG(TO_JSONB(t) ORDER BY created_at,id),'[]'::JSONB) FROM public.warehouses t WHERE is_active),
    'parentContract',parent_contract,'stockContract',stock_contract,'catalog',catalog,
    'locksHeld',FALSE,'serverAllocated',FALSE,'durableIdentityClaimed',FALSE,'defaultsQualified',FALSE,'allowedInvokerClosure',FALSE,
    'absencePredicatesFenced',FALSE,'writerClosed',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.discover_product_creation_prewrite_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_product_creation_prewrite_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_product_creation_prewrite_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_product_creation_prewrite_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_PREWRITE_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_product_creation_prewrite_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_product_creation_prewrite_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_and_acquire_product_prewrite_v1(kind TEXT,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE allocation JSONB; children JSONB:='[]'::JSONB; count_children INTEGER; plan JSONB;
  n JSONB; gate TEXT; actual JSONB; identity UUID;
BEGIN
  -- No caller allocation is accepted here. No UUID/key is generated after locks.
  PERFORM phase5_private.assert_product_creation_actor_v1();
  IF kind IS NULL OR kind NOT IN ('FAMILY_V1','FLAVOR_V1') OR JSONB_TYPEOF(request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_REQUEST_INVALID'; END IF;
  IF kind='FAMILY_V1' THEN
    IF JSONB_TYPEOF(request->'flavors') IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(request->'flavors') NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_FLAVORS_INVALID'; END IF;
    count_children:=JSONB_ARRAY_LENGTH(request->'flavors');
  ELSE count_children:=1; END IF;
  FOR i IN 1..count_children LOOP children:=children||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',gen_random_uuid(),'skuClockText',clock_timestamp()::TEXT)); END LOOP;
  allocation:=JSONB_BUILD_OBJECT('rootId',CASE WHEN kind='FAMILY_V1' THEN gen_random_uuid() ELSE phase5_private.wire_uuid_v1(request->'masterId') END,
    'children',children);
  plan:=phase5_private.discover_product_creation_prewrite_v1(kind,request,allocation);
  IF EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace ns ON ns.oid=c.relnamespace
      WHERE l.pid=pg_backend_pid() AND l.granted AND ns.nspname IN ('public','auth','phase5_private') AND l.mode<>'AccessShareLock'
        AND c.oid NOT IN ('phase5_private.authority_generation'::REGCLASS,'phase5_private.activation_receipts'::REGCLASS))
    OR EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND granted AND locktype='advisory') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_LATE_ENTRY_RETRY'; END IF;
  PERFORM 1 FROM phase5_private.authority_generation WHERE singleton AND generation=0 AND authority_state='PRIVATE_INACTIVE'
    AND manifest_sha256='9A74EB14788EA668BDE88DAC95561AD8DA2F734EC47EAA87491AB0F181E06099' FOR SHARE NOWAIT;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM phase5_private.activation_receipts) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_PRODUCT_PREPARATION_ONLY'; END IF;
  -- Existing inventory domain first, shared108 identifier gates second; all
  -- future identities and all siblings are covered BEFORE first parent lock.
  FOR gate IN SELECT value FROM JSONB_ARRAY_ELEMENTS_TEXT(plan->'gates') WITH ORDINALITY g(value,ordinal) ORDER BY ordinal LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(gate,0)); END LOOP;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'resources') WITH ORDINALITY r(value,ordinal) ORDER BY ordinal LOOP
    identity:=CASE WHEN n->>'relation' IN ('public.stock_alert_reads','public.user_roles') THEN NULL ELSE (n->>'id')::UUID END;
    actual:=NULL;
    CASE n->>'relation'
      WHEN 'public.inventory_balances' THEN SELECT TO_JSONB(t) INTO actual FROM public.inventory_balances t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.products' THEN SELECT TO_JSONB(t) INTO actual FROM public.products t WHERE id=identity FOR NO KEY UPDATE NOWAIT;
      WHEN 'public.product_images' THEN SELECT TO_JSONB(t) INTO actual FROM public.product_images t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alerts' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alerts t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.automation_events' THEN SELECT TO_JSONB(t) INTO actual FROM public.automation_events t WHERE id=identity FOR UPDATE NOWAIT;
      WHEN 'public.stock_alert_reads' THEN SELECT TO_JSONB(t) INTO actual FROM public.stock_alert_reads t
        WHERE stock_alert_id=(n->'row'->>'stock_alert_id')::UUID AND user_id=(n->'row'->>'user_id')::UUID FOR UPDATE NOWAIT;
      WHEN 'public.units' THEN SELECT TO_JSONB(t) INTO actual FROM public.units t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.categories' THEN SELECT TO_JSONB(t) INTO actual FROM public.categories t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.brands' THEN SELECT TO_JSONB(t) INTO actual FROM public.brands t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.warehouses' THEN SELECT TO_JSONB(t) INTO actual FROM public.warehouses t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.branches' THEN SELECT TO_JSONB(t) INTO actual FROM public.branches t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.profiles' THEN SELECT TO_JSONB(t) INTO actual FROM public.profiles t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.roles t WHERE id=identity FOR SHARE NOWAIT;
      WHEN 'public.user_roles' THEN SELECT TO_JSONB(t) INTO actual FROM public.user_roles t
        WHERE user_id=(n->'row'->>'user_id')::UUID AND role_id=(n->'row'->>'role_id')::UUID FOR SHARE NOWAIT;
      ELSE RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_RESOURCE_UNSUPPORTED';
    END CASE;
    IF actual IS DISTINCT FROM n->'row' THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_PREWRITE_CHANGED_RETRY'; END IF;
  END LOOP;
  PERFORM phase5_private.assert_product_creation_prewrite_v1(kind,request,allocation,plan);
  RETURN plan||JSONB_BUILD_OBJECT('serverAllocated',TRUE,'locksHeld',TRUE,'actualBackendPid',pg_backend_pid(),
    'actualTransactionId',txid_current()::TEXT,'acquisitionState','PRIVATE_INACTIVE_ALLOCATION_AND_RESOURCES_ONLY',
    'heldContextAuthority',FALSE,'executionAuthority',FALSE);
EXCEPTION WHEN LOCK_NOT_AVAILABLE THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_CONTENTION_RETRY';
END; $$;
REVOKE ALL ON FUNCTION phase5_private.allocate_and_acquire_product_prewrite_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_and_acquire_product_prewrite_v1(TEXT,JSONB) OWNER TO postgres;

-- Receipt future identities: preparation only, NOT a durable ownership receipt.
-- The104 legacy PO delegate's ordered positive lines are authoritative. A
-- repeated PO item has separate receipt-item/movement identities, but only the
-- first positive use of an absent SKU/warehouse balance allocates that balance.
-- Ordinary inventory writers are NOT relabelled as financial Order contexts.
CREATE FUNCTION phase5_private.derive_receiving_future_identities_v1(
  order_identity UUID, warehouse_identity UUID, delivery_note TEXT, notes TEXT,
  items JSONB, allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; line JSONB; ids JSONB; balance JSONB; domain JSONB;
  receipt UUID; audit UUID; number_value TEXT; seen UUID[]; all_ids UUID[];
  bindings JSONB:='[]'::JSONB; positive_count INTEGER; position INTEGER:=0;
  wanted_products UUID[]; actual_products UUID[];
BEGIN
  plan:=phase5_private.discover_receiving_prewrite_v1(order_identity,warehouse_identity,delivery_note,notes,items);
  PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['receiptId','receiptNumber','auditId','lineIdentities','balanceIdentities']);
  receipt:=phase5_private.wire_uuid_v1(allocation->'receiptId');
  audit:=phase5_private.wire_uuid_v1(allocation->'auditId');
  number_value:=allocation->>'receiptNumber';
  IF JSONB_TYPEOF(allocation->'receiptNumber') IS DISTINCT FROM 'string'
    OR number_value IS NULL OR number_value !~ ('^GRN-'||TO_CHAR(transaction_timestamp(),'YYYY')||'-[1-9][0-9]{3}$')
    OR JSONB_TYPEOF(allocation->'lineIdentities') IS DISTINCT FROM 'array'
    OR JSONB_TYPEOF(allocation->'balanceIdentities') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_ALLOCATION_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM public.purchase_receipts r WHERE r.receipt_number=number_value) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_NUMBER_CONFLICT_RETRY'; END IF;
  SELECT COUNT(*) INTO positive_count FROM JSONB_ARRAY_ELEMENTS(plan->'lines') n WHERE (n->>'quantity')::INTEGER>0;
  IF JSONB_ARRAY_LENGTH(allocation->'lineIdentities')<>positive_count THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_LINE_IDENTITIES_INVALID'; END IF;
  seen:=ARRAY[receipt,audit];
  bindings:=JSONB_BUILD_ARRAY(
    JSONB_BUILD_OBJECT('relation','public.purchase_receipts','id',receipt,'owner','HEADER',
      'binding',JSONB_BUILD_OBJECT('receipt_number',number_value,'purchase_order_id',order_identity,
        'supplier_id',(SELECT supplier_id FROM public.purchase_orders WHERE id=order_identity),
        'warehouse_id',plan->'effectiveWarehouseId','received_by',plan->'actorId')),
    JSONB_BUILD_OBJECT('relation','public.audit_logs','id',audit,'owner','RECEIPT_AUDIT',
      'binding',JSONB_BUILD_OBJECT('entity_id',receipt,'entity_name','purchase_receipts','user_id',plan->'actorId')));
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'lines') LOOP
    IF (line->>'quantity')::INTEGER<=0 THEN CONTINUE; END IF;
    ids:=allocation->'lineIdentities'->position; position:=position+1;
    PERFORM phase5_private.assert_wire_keys_v1(ids,ARRAY['ordinal','receiptItemId','movementId']);
    IF ids->'ordinal' IS DISTINCT FROM line->'ordinal' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_LINE_IDENTITIES_INVALID'; END IF;
    seen:=seen||ARRAY[phase5_private.wire_uuid_v1(ids->'receiptItemId'),phase5_private.wire_uuid_v1(ids->'movementId')];
    bindings:=bindings||JSONB_BUILD_ARRAY(
      JSONB_BUILD_OBJECT('relation','public.purchase_receipt_items','id',ids->'receiptItemId','owner','RECEIPT_LINE',
        'ordinal',line->'ordinal','binding',JSONB_BUILD_OBJECT('purchase_receipt_id',receipt,
          'purchase_order_item_id',line->'source'->'id','product_id',line->'source'->'product_id',
          'received_quantity',line->'quantity','unit_cost_in_minor_units',line->'cost')),
      JSONB_BUILD_OBJECT('relation','public.inventory_movements','id',ids->'movementId','owner','RECEIPT_MOVEMENT',
        'ordinal',line->'ordinal','binding',JSONB_BUILD_OBJECT('reference_type','purchase_receipt','reference_id',receipt,
          'movement_type','purchase_receipt','product_id',line->'source'->'product_id',
          'warehouse_id',plan->'effectiveWarehouseId','quantity',line->'quantity','created_by',plan->'actorId')));
  END LOOP;
  SELECT COALESCE(ARRAY_AGG((d->>'productId')::UUID ORDER BY (d->>'productId')::UUID),ARRAY[]::UUID[])
    INTO wanted_products FROM JSONB_ARRAY_ELEMENTS(plan->'domains') d
    WHERE d->'targetBalance'='null'::JSONB AND EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(plan->'lines') n
      WHERE (n->>'quantity')::INTEGER>0 AND n->'source'->'product_id'=d->'productId');
  actual_products:=ARRAY[]::UUID[];
  FOR balance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'balanceIdentities') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(balance,ARRAY['productId','id']);
    actual_products:=actual_products||phase5_private.wire_uuid_v1(balance->'productId');
    seen:=seen||phase5_private.wire_uuid_v1(balance->'id');
    SELECT value INTO domain FROM JSONB_ARRAY_ELEMENTS(plan->'domains')
      WHERE value->'productId'=balance->'productId';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_BALANCE_IDENTITIES_INVALID'; END IF;
    bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.inventory_balances',
      'id',balance->'id','owner','ABSENT_TARGET_BALANCE','binding',JSONB_BUILD_OBJECT(
        'product_id',domain->'productId','warehouse_id',plan->'effectiveWarehouseId')));
  END LOOP;
  IF actual_products IS DISTINCT FROM wanted_products THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIVING_BALANCE_IDENTITIES_INVALID'; END IF;
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO all_ids FROM UNNEST(seen) n(id);
  IF CARDINALITY(all_ids)<>CARDINALITY(seen) OR EXISTS(
    SELECT 1 FROM public.purchase_receipts WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.purchase_receipt_items WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.inventory_movements WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.inventory_balances WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.audit_logs WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM JSONB_ARRAY_ELEMENTS(plan->'resources') n WHERE n->>'id'=ANY(SELECT id::TEXT FROM UNNEST(all_ids) t(id))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_FUTURE_IDENTITY_CONFLICT_RETRY'; END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receiving-future-identities-v1','sourceKind','LEGACY_PO_RECEIVE_104',
    'prewritePlan',plan,'allocation',allocation,'identityBindings',bindings,'sourceTransactionAt',transaction_timestamp(),
    'serverAllocated',FALSE,'durableIdentityClaimed',FALSE,'numberClaimed',FALSE,'defaultsQualified',FALSE,
    'fullWriteTuples',FALSE,'stockEffectIdentitiesComplete',FALSE,'absencePredicatesFenced',FALSE,
    'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receiving_future_identities_v1(
  order_identity UUID,warehouse_identity UUID,delivery_note TEXT,notes TEXT,items JSONB,allocation JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receiving_future_identities_v1(
    order_identity,warehouse_identity,delivery_note,notes,items,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIVING_FUTURE_IDENTITIES_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_receiving_future_identities_v1(
  order_identity UUID,warehouse_identity UUID,delivery_note TEXT,notes TEXT,items JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; line JSONB; domain JSONB; allocation JSONB;
  lines JSONB:='[]'::JSONB; balances JSONB:='[]'::JSONB;
BEGIN
  -- Actual actor/source validation precedes EVERY allocation. No request can
  -- supply future IDs, a number or an ownership/held-context certificate.
  plan:=phase5_private.discover_receiving_prewrite_v1(order_identity,warehouse_identity,delivery_note,notes,items);
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'lines') LOOP
    IF (line->>'quantity')::INTEGER>0 THEN
      lines:=lines||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('ordinal',line->'ordinal',
        'receiptItemId',gen_random_uuid(),'movementId',gen_random_uuid())); END IF;
  END LOOP;
  FOR domain IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'domains') LOOP
    IF domain->'targetBalance'='null'::JSONB AND EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(plan->'lines') n
      WHERE (n->>'quantity')::INTEGER>0 AND n->'source'->'product_id'=domain->'productId') THEN
      balances:=balances||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('productId',domain->'productId','id',gen_random_uuid())); END IF;
  END LOOP;
  allocation:=JSONB_BUILD_OBJECT('receiptId',gen_random_uuid(),'auditId',gen_random_uuid(),
    'receiptNumber','GRN-'||TO_CHAR(transaction_timestamp(),'YYYY')||'-'||LPAD(FLOOR(1000+RANDOM()*9000)::TEXT,4,'0'),
    'lineIdentities',lines,'balanceIdentities',balances);
  -- An occupied number/UUID rejects before DML. This PRIVATE candidate is not
  -- number reservation or a replacement of104's public collision loop.
  RETURN phase5_private.derive_receiving_future_identities_v1(
    order_identity,warehouse_identity,delivery_note,notes,items,allocation)||JSONB_BUILD_OBJECT('serverAllocated',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.allocate_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_receiving_future_identities_v1(UUID,UUID,TEXT,TEXT,JSONB) OWNER TO postgres;

-- Product ancillary future identities: exact per-product source occurrences.
-- This covers the explicit012/019/020/103/070/071 balance/image/audit writes,
-- NOT generated timestamps, stock triggers, ownership, absence fences or DML.
CREATE FUNCTION phase5_private.derive_product_ancillary_identities_v1(
  kind TEXT,request JSONB,product_allocation JSONB,allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; product_row JSONB; ids JSONB; spec JSONB; image TEXT;
  bindings JSONB:='[]'::JSONB; all_ids UUID[]:=ARRAY[]::UUID[]; distinct_ids UUID[];
  position INTEGER:=0; field TEXT; image_required BOOLEAN; balance_required BOOLEAN;
  audit_action TEXT; details JSONB; unit_price BIGINT; purchase_unit JSONB;
BEGIN
  plan:=phase5_private.discover_product_creation_prewrite_v1(kind,request,product_allocation);
  PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['products','familyAuditId']);
  IF JSONB_TYPEOF(allocation->'products') IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(allocation->'products')<>JSONB_ARRAY_LENGTH(plan->'futureProducts') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ANCILLARY_MEMBERSHIP_INVALID'; END IF;
  IF kind='FAMILY_V1' THEN
    all_ids:=all_ids||phase5_private.wire_uuid_v1(allocation->'familyAuditId');
  ELSIF allocation->'familyAuditId' IS DISTINCT FROM 'null'::JSONB THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ANCILLARY_FAMILY_INVALID'; END IF;
  FOR product_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'futureProducts') LOOP
    ids:=allocation->'products'->position; position:=position+1;
    PERFORM phase5_private.assert_wire_keys_v1(ids,ARRAY['productId','balanceId','imageId',
      'packagingAuditId','wholesaleAuditId','imageAuditId','packageAuditId','flavorAuditId']);
    IF ids->'productId' IS DISTINCT FROM product_row->'id' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ANCILLARY_MEMBERSHIP_INVALID'; END IF;
    spec:=product_row->'spec';
    image:=CASE WHEN product_row->>'kind'='MASTER' THEN NULLIF(BTRIM(request->>'imageUrl'),'')
      ELSE product_row->>'imageUrl' END;
    image_required:=image IS NOT NULL;
    balance_required:=product_row->'warehouseId' IS DISTINCT FROM 'null'::JSONB;
    FOR field IN SELECT UNNEST(ARRAY['balanceId','imageId','packagingAuditId','wholesaleAuditId',
      'imageAuditId','packageAuditId','flavorAuditId']) LOOP
      IF (field='balanceId' AND NOT balance_required) OR (field IN ('imageId','imageAuditId') AND NOT image_required)
        OR (field='flavorAuditId' AND product_row->>'kind'='MASTER') THEN
        IF ids->field IS DISTINCT FROM 'null'::JSONB THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ANCILLARY_NOT_APPLICABLE'; END IF;
      ELSE all_ids:=all_ids||phase5_private.wire_uuid_v1(ids->field); END IF;
    END LOOP;
    IF balance_required THEN
      bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.inventory_balances','id',ids->'balanceId',
        'productId',product_row->'id','owner','ZERO_BALANCE','binding',JSONB_BUILD_OBJECT('product_id',product_row->'id',
          'warehouse_id',product_row->'warehouseId','on_hand_quantity',0,'reserved_quantity',0)));
    END IF;
    IF image_required THEN
      bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.product_images','id',ids->'imageId',
        'productId',product_row->'id','owner','PRIMARY_IMAGE','binding',JSONB_BUILD_OBJECT('product_id',product_row->'id',
          'image_url',image,'is_primary',TRUE,'display_order',1)));
    END IF;
    unit_price:=ROUND((spec->>'defaultSalePriceInMinorUnits')::NUMERIC/(spec->>'unitsPerSaleUnit')::INT)::BIGINT;
    -- Base audit retains the actual delegate argument, not the INSERT's unit
    -- COALESCE:071 may pass NULL for the root; children inherit the stored unit.
    purchase_unit:=CASE WHEN product_row->>'kind'='MASTER' THEN request->'purchaseUnitId' ELSE spec->'purchaseUnitId' END;
    FOR field IN SELECT UNNEST(ARRAY['packagingAuditId','wholesaleAuditId','imageAuditId','packageAuditId','flavorAuditId']) LOOP
      IF ids->field='null'::JSONB THEN CONTINUE; END IF;
      CASE field
        WHEN 'packagingAuditId' THEN
          audit_action:='CREATE_PRODUCT_WITH_PACKAGING';
          details:=JSONB_BUILD_OBJECT('sku',CASE WHEN product_row->>'kind'='MASTER' THEN request->>'sku' ELSE product_row->>'sku' END,
            'warehouse_id',product_row->'warehouseId','opening_quantity',0,'purchase_unit_id',purchase_unit,
            'units_per_purchase_unit',(spec->>'unitsPerPurchaseUnit')::INT);
        WHEN 'wholesaleAuditId' THEN
          audit_action:='SET_PRODUCT_WHOLESALE_PRICE';
          details:=JSONB_BUILD_OBJECT('wholesale_price_in_minor_units',unit_price);
        WHEN 'imageAuditId' THEN
          audit_action:='SET_PRODUCT_PRIMARY_IMAGE';
          details:=JSONB_BUILD_OBJECT('product_image_id',ids->'imageId','image_url',image);
        WHEN 'packageAuditId' THEN
          audit_action:='SET_PRODUCT_WHOLESALE_PACKAGE';
          details:=JSONB_BUILD_OBJECT('sale_unit_id',spec->'saleUnitId','units_per_sale_unit',(spec->>'unitsPerSaleUnit')::INT,
            'default_sale_price_in_minor_units',(spec->>'defaultSalePriceInMinorUnits')::BIGINT,'opening_stock_created',FALSE);
        WHEN 'flavorAuditId' THEN
          audit_action:='CREATE_PRODUCT_FLAVOR';
          details:=JSONB_BUILD_OBJECT('master_product_id',product_row->'rootId','flavor_name_ar',product_row->'flavorNameAr',
            'opening_sale_packages',0,'inherited_sale_price_in_minor_units',(spec->>'defaultSalePriceInMinorUnits')::BIGINT);
        ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_ANCILLARY_AUDIT_INVALID';
      END CASE;
      bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.audit_logs','id',ids->field,
        'productId',product_row->'id','owner',field,'binding',JSONB_BUILD_OBJECT('user_id',plan->'actorId',
          'action',audit_action,'entity_name','products','entity_id',product_row->'id','details',details)));
    END LOOP;
  END LOOP;
  IF kind='FAMILY_V1' THEN
    bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.audit_logs','id',allocation->'familyAuditId',
      'productId',product_allocation->'rootId','owner','FAMILY_AUDIT','binding',JSONB_BUILD_OBJECT('user_id',plan->'actorId',
        'action','CREATE_PRODUCT_FLAVOR_FAMILY','entity_name','products','entity_id',product_allocation->'rootId',
        'details',JSONB_BUILD_OBJECT('flavor_count',JSONB_ARRAY_LENGTH(product_allocation->'children'),'atomic',TRUE))));
  END IF;
  -- Ancillary UUIDs cannot alias each other, any future product, the source
  -- resource domain or an occupied UUID in a participating relation.
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id) INTO distinct_ids FROM UNNEST(all_ids) n(id);
  IF CARDINALITY(all_ids)<>CARDINALITY(distinct_ids) OR EXISTS(
    SELECT 1 FROM public.products WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.inventory_balances WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.product_images WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.audit_logs WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.inventory_movements WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.stock_alerts WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM public.automation_events WHERE id=ANY(all_ids)
    UNION ALL SELECT 1 FROM JSONB_ARRAY_ELEMENTS(plan->'futureProducts') n WHERE (n->>'id')::UUID=ANY(all_ids)
    UNION ALL SELECT 1 FROM JSONB_ARRAY_ELEMENTS(plan->'resources') n
      WHERE n->>'id'=ANY(SELECT id::TEXT FROM UNNEST(all_ids) t(id))) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_ANCILLARY_IDENTITY_CONFLICT_RETRY'; END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-product-ancillary-identities-v1','kind',kind,
    'prewritePlan',plan,'allocation',allocation,'identityBindings',bindings,'sourceTransactionAt',transaction_timestamp(),
    'serverAllocated',FALSE,'durableIdentityClaimed',FALSE,'defaultsQualified',FALSE,'fullWriteTuples',FALSE,
    'stockEffectIdentitiesComplete',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,
    'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_product_ancillary_identities_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_product_ancillary_identities_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_product_ancillary_identities_v1(
  kind TEXT,request JSONB,product_allocation JSONB,allocation JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_product_ancillary_identities_v1(kind,request,product_allocation,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_PRODUCT_ANCILLARY_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_product_ancillary_identities_v1(TEXT,JSONB,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_product_ancillary_identities_v1(TEXT,JSONB,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_product_ancillary_identities_v1(kind TEXT,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE product_allocation JSONB; plan JSONB; product_row JSONB; children JSONB:='[]'::JSONB;
  allocations JSONB:='[]'::JSONB; image_required BOOLEAN; root_id UUID;
BEGIN
  PERFORM phase5_private.assert_product_creation_actor_v1();
  IF kind IS NULL OR kind NOT IN ('FAMILY_V1','FLAVOR_V1') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_KIND_INVALID'; END IF;
  IF kind='FAMILY_V1' THEN
    IF JSONB_TYPEOF(request->'flavors') IS DISTINCT FROM 'array' OR JSONB_ARRAY_LENGTH(request->'flavors') NOT BETWEEN 1 AND 30 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_PRODUCT_FLAVORS_INVALID'; END IF;
    root_id:=gen_random_uuid();
    FOR product_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(request->'flavors') LOOP
      children:=children||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',gen_random_uuid(),'skuClockText',clock_timestamp()::TEXT));
    END LOOP;
  ELSE
    root_id:=phase5_private.wire_uuid_v1(request->'masterId');
    children:=JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',gen_random_uuid(),'skuClockText',clock_timestamp()::TEXT));
  END IF;
  product_allocation:=JSONB_BUILD_OBJECT('rootId',root_id,'children',children);
  plan:=phase5_private.discover_product_creation_prewrite_v1(kind,request,product_allocation);
  FOR product_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'futureProducts') LOOP
    image_required:=CASE WHEN product_row->>'kind'='MASTER' THEN NULLIF(BTRIM(request->>'imageUrl'),'') IS NOT NULL
      ELSE product_row->>'imageUrl' IS NOT NULL END;
    allocations:=allocations||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('productId',product_row->'id',
      'balanceId',CASE WHEN product_row->'warehouseId' IS DISTINCT FROM 'null'::JSONB THEN gen_random_uuid() ELSE NULL END,
      'imageId',CASE WHEN image_required THEN gen_random_uuid() ELSE NULL END,
      'packagingAuditId',gen_random_uuid(),'wholesaleAuditId',gen_random_uuid(),
      'imageAuditId',CASE WHEN image_required THEN gen_random_uuid() ELSE NULL END,'packageAuditId',gen_random_uuid(),
      'flavorAuditId',CASE WHEN product_row->>'kind'='FLAVOR' THEN gen_random_uuid() ELSE NULL END));
  END LOOP;
  RETURN phase5_private.derive_product_ancillary_identities_v1(kind,request,product_allocation,
    JSONB_BUILD_OBJECT('products',allocations,'familyAuditId',CASE WHEN kind='FAMILY_V1' THEN gen_random_uuid() ELSE NULL END))
    ||JSONB_BUILD_OBJECT('serverAllocated',TRUE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.allocate_product_ancillary_identities_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_product_ancillary_identities_v1(TEXT,JSONB) OWNER TO postgres;

-- Modern Receipt V2 allocation discovery ONLY: no header admission or authority.
-- The shared commercial core preserves client-line x component identity before
-- future UUID/default/sequence/stock/payment resource qualification. PO capacity,
-- header/key/tender/feature eligibility and held contexts remain separate OPEN gates.
CREATE FUNCTION phase5_private.assert_receipt_v2_allocation_sources_v1()
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE routine RECORD; grantees TEXT[]; actor UUID:=auth.uid(); parent JSONB;
BEGIN
  FOR routine IN SELECT p.*,s.signature,s.body_hash,s.definer,s.volatility,s.path,s.grantees FROM (VALUES
    ('public.assert_erp_role(text[],text)','43ba25c28960e79ed99d1c02e530bbd765ad0c276daac192b943c85ebd7d5f62',TRUE,'s','search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.is_mfa_policy_satisfied()','6925ebb2e9634c4c6c4444489e4bdedd5d2fbb2d3ec60856e013151e094882ef',TRUE,'s','search_path=public, auth, pg_temp',ARRAY['authenticated','postgres']::TEXT[]),
    ('public.phase2_canonicalize_receipt_lines_internal(jsonb)','4ad838104dc17ccf0812767f2b47b8c826fd2a5de80d0aa00d3b6ce451ea578d',FALSE,'i','search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.phase2_allocate_largest_remainder_internal(bigint,jsonb)','b5042d17c1e6defd94ddbcfef794942622f713afc8f5b3c27601f4c59ab3c458',FALSE,'i','search_path=public, pg_temp',ARRAY['postgres']::TEXT[]),
    ('public.phase2_request_fingerprint_internal(jsonb)','285f6a552d6c94d6b987162c07015ccf53a18bdc8e2fe34cef01d7b33ef1808e',FALSE,'i','search_path=public, pg_temp',ARRAY['postgres']::TEXT[])
    ) s(signature,body_hash,definer,volatility,path,grantees)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(s.signature) LOOP
    SELECT ARRAY_AGG(name ORDER BY name COLLATE "C") INTO grantees FROM (
      SELECT CASE WHEN a.grantee=0 THEN 'public' ELSE pg_catalog.pg_get_userbyid(a.grantee) END name
      FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) a) acl;
    IF routine.oid IS NULL OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM routine.definer OR routine.provolatile::TEXT IS DISTINCT FROM routine.volatility
      OR routine.proconfig IS DISTINCT FROM ARRAY[routine.path]
      OR ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex')
        IS DISTINCT FROM routine.body_hash OR grantees IS DISTINCT FROM routine.grantees THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_RECEIPT_V2_ALLOCATION_SOURCE_INVALID'; END IF;
  END LOOP;
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'استلام بضاعة الموردين - نموذج الطرود');
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PHASE5_RECEIPT_V2_ACTOR_REQUIRED'; END IF;
  -- Independent95 body/catalog contract includes both113 authoritative writers;
  -- this snapshot is NOT proof of default/invoker/absence convergence.
  parent:=phase5_private.plan_inventory_parent_execute_v1();
  RETURN JSONB_BUILD_OBJECT('actorId',actor,'parentContract',parent,
    'sourceContractSha256','BA04C099B758F303DEC157E03E864A6FC36CF5B36FD1C249BA8D6EC94816EA67');
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_allocation_sources_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_allocation_sources_v1() OWNER TO postgres;

CREATE FUNCTION phase5_private.derive_receipt_v2_line_allocation_v1(
  kind TEXT,request_lines JSONB,header_discount BIGINT,freight BIGINT,legacy_tax BIGINT,paid BIGINT
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  source_contract JSONB; lines JSONB; line JSONB; component JSONB; weights JSONB;
  discounts JSONB; freights JSONB; merchandise JSONB; acquisition JSONB;
  bindings JSONB:='[]'::JSONB; anchors JSONB:='[]'::JSONB; line_bindings JSONB:='[]'::JSONB;
  sku public.products%ROWTYPE; family public.products%ROWTYPE; config public.product_parcel_configurations%ROWTYPE;
  net NUMERIC:=0; gross NUMERIC:=0; line_discounts NUMERIC:=0; line_net BIGINT; line_acquisition BIGINT;
  quantity NUMERIC; explicit_count INTEGER; explicit_total NUMERIC; sequence INTEGER:=0;
  component_cost BIGINT; component_net BIGINT; product_identity UUID; source_identity UUID;
BEGIN
  source_contract:=phase5_private.assert_receipt_v2_allocation_sources_v1();
  IF kind IS NULL OR kind NOT IN ('DIRECT_V2','PO_V2') OR header_discount IS NULL OR freight IS NULL
    OR legacy_tax IS NULL OR paid IS NULL OR LEAST(header_discount,freight,legacy_tax,paid)<0
    OR JSONB_TYPEOF(request_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_ALLOCATION_REQUEST_INVALID'; END IF;
  IF JSONB_ARRAY_LENGTH(request_lines)=0 OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(request_lines) n
    WHERE JSONB_TYPEOF(n) IS DISTINCT FROM 'object' OR JSONB_TYPEOF(n->'components') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_ALLOCATION_LINES_INVALID'; END IF;
  lines:=public.phase2_canonicalize_receipt_lines_internal(request_lines);
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(lines) n WHERE n->>'client_line_id' IS NULL)
    OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(lines) n GROUP BY n->>'client_line_id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_LINE_IDENTITY_INVALID'; END IF;
  IF kind='PO_V2' AND EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(lines) n
    GROUP BY n->>'purchase_order_item_id' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PO_ITEM_IDENTITY_INVALID'; END IF;
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(lines) LOOP
    IF line->>'line_kind' IS NULL OR line->>'line_kind' NOT IN ('base_unit','configurable_parcel')
      OR line->>'commercial_quantity' IS NULL OR (line->>'commercial_quantity')::INT<=0
      OR line->>'gross_amount_in_minor_units' IS NULL OR (line->>'gross_amount_in_minor_units')::BIGINT<0
      OR (line->>'line_discount_in_minor_units')::BIGINT<0
      OR (line->>'line_discount_in_minor_units')::BIGINT>(line->>'gross_amount_in_minor_units')::BIGINT
      OR line->>'base_unit_name' IS NULL OR JSONB_ARRAY_LENGTH(line->'components')=0
      OR (kind='PO_V2' AND line->>'purchase_order_item_id' IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_LINE_VALUE_INVALID'; END IF;
    IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(line->'components') n WHERE n->>'product_id' IS NULL
      OR n->>'base_quantity' IS NULL OR (n->>'base_quantity')::INT<=0
      OR (n->>'explicit_merchandise_cost_in_minor_units')::BIGINT<0)
      OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(line->'components') n GROUP BY n->>'product_id' HAVING COUNT(*)<>1) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_COMPONENT_IDENTITY_INVALID'; END IF;
    line_net:=(line->>'gross_amount_in_minor_units')::BIGINT-(line->>'line_discount_in_minor_units')::BIGINT;
    SELECT SUM((n->>'base_quantity')::NUMERIC),COUNT(*) FILTER(WHERE n->>'explicit_merchandise_cost_in_minor_units' IS NOT NULL),
      COALESCE(SUM((n->>'explicit_merchandise_cost_in_minor_units')::NUMERIC),0)
      INTO quantity,explicit_count,explicit_total FROM JSONB_ARRAY_ELEMENTS(line->'components') n;
    IF quantity>2147483647 OR explicit_count NOT IN (0,JSONB_ARRAY_LENGTH(line->'components'))
      OR (explicit_count>0 AND explicit_total IS DISTINCT FROM line_net::NUMERIC) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_COMPONENT_COST_INVALID'; END IF;
    IF line->>'line_kind'='base_unit' THEN
      IF line->>'family_product_id' IS NOT NULL OR line->>'parcel_configuration_id' IS NOT NULL
        OR line->>'configuration_revision' IS NOT NULL OR line->>'units_per_parcel' IS NOT NULL
        OR line->>'parcel_unit_name' IS NOT NULL OR JSONB_ARRAY_LENGTH(line->'components')<>1
        OR quantity IS DISTINCT FROM (line->>'commercial_quantity')::NUMERIC THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_BASE_SHAPE_INVALID'; END IF;
    ELSE
      SELECT * INTO family FROM public.products WHERE id=(line->>'family_product_id')::UUID;
      SELECT * INTO config FROM public.product_parcel_configurations WHERE id=(line->>'parcel_configuration_id')::UUID;
      IF family.id IS NULL OR family.is_flavor_master IS DISTINCT FROM TRUE OR config.id IS NULL
        OR config.is_active IS DISTINCT FROM TRUE OR config.composition_mode IS DISTINCT FROM 'configurable_mix'
        OR config.family_product_id IS DISTINCT FROM family.id
        OR config.configuration_revision IS DISTINCT FROM (line->>'configuration_revision')::INT
        OR family.units_per_sale_unit IS DISTINCT FROM (line->>'units_per_parcel')::INT
        OR line->>'parcel_unit_name' IS NULL
        OR quantity IS DISTINCT FROM (line->>'commercial_quantity')::NUMERIC*(line->>'units_per_parcel')::NUMERIC THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PARCEL_SOURCE_INVALID'; END IF;
      anchors:=anchors||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('family',TO_JSONB(family),'configuration',TO_JSONB(config)));
    END IF;
    FOR component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(line->'components') LOOP
      product_identity:=(component->>'product_id')::UUID;
      SELECT * INTO sku FROM public.products WHERE id=product_identity;
      IF sku.id IS NULL OR sku.is_active IS DISTINCT FROM TRUE OR sku.is_flavor_master IS DISTINCT FROM FALSE
        OR (line->>'line_kind'='configurable_parcel' AND COALESCE(sku.flavor_master_product_id,sku.id)
          IS DISTINCT FROM (line->>'family_product_id')::UUID) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_SKU_SOURCE_INVALID'; END IF;
      anchors:=anchors||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('clientLineId',line->>'client_line_id','product',TO_JSONB(sku),
        'units',(SELECT COALESCE(JSONB_AGG(TO_JSONB(u) ORDER BY id),'[]') FROM public.units u WHERE id IN (sku.unit_id,sku.purchase_unit_id)),
        'allWarehouseBalances',(SELECT COALESCE(JSONB_AGG(TO_JSONB(b) ORDER BY warehouse_id,id),'[]') FROM public.inventory_balances b WHERE product_id=product_identity)));
    END LOOP;
    gross:=gross+(line->>'gross_amount_in_minor_units')::NUMERIC;
    line_discounts:=line_discounts+(line->>'line_discount_in_minor_units')::NUMERIC;
    net:=net+line_net;
  END LOOP;
  IF header_discount>net OR (net=0 AND (header_discount<>0 OR freight<>0))
    OR gross>9223372036854775807::NUMERIC OR line_discounts>9223372036854775807::NUMERIC
    OR net-header_discount+freight+legacy_tax>9223372036854775807::NUMERIC
    OR paid>net-header_discount+freight+legacy_tax OR net>9223372036854775807::NUMERIC THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_FINANCIAL_BOUNDS_INVALID'; END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT('key',n->>'client_line_id','weight',
    (n->>'gross_amount_in_minor_units')::BIGINT-(n->>'line_discount_in_minor_units')::BIGINT)) INTO weights FROM JSONB_ARRAY_ELEMENTS(lines) n;
  SELECT JSONB_OBJECT_AGG(allocation_key,allocated_amount) INTO discounts FROM public.phase2_allocate_largest_remainder_internal(header_discount,weights);
  SELECT JSONB_OBJECT_AGG(allocation_key,allocated_amount) INTO freights FROM public.phase2_allocate_largest_remainder_internal(freight,weights);
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(lines) LOOP
    sequence:=sequence+1;
    line_net:=(line->>'gross_amount_in_minor_units')::BIGINT-(line->>'line_discount_in_minor_units')::BIGINT;
    line_acquisition:=line_net-(discounts->>(line->>'client_line_id'))::BIGINT+(freights->>(line->>'client_line_id'))::BIGINT;
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT('key',n->>'product_id','weight',COALESCE(
      (n->>'explicit_merchandise_cost_in_minor_units')::BIGINT,(n->>'base_quantity')::BIGINT))) INTO weights FROM JSONB_ARRAY_ELEMENTS(line->'components') n;
    IF line_acquisition>0 AND NOT EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(weights) w WHERE (w->>'weight')::NUMERIC>0) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_COMPONENT_ALLOCATION_BASIS_INVALID'; END IF;
    SELECT JSONB_OBJECT_AGG(allocation_key,allocated_amount) INTO merchandise FROM public.phase2_allocate_largest_remainder_internal(line_net,weights);
    SELECT JSONB_OBJECT_AGG(allocation_key,allocated_amount) INTO acquisition FROM public.phase2_allocate_largest_remainder_internal(line_acquisition,weights);
    line_bindings:=line_bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('clientLineId',line->>'client_line_id','sequence',sequence,
      'purchaseOrderItemId',line->'purchase_order_item_id','net',line_net,'headerDiscount',discounts->(line->>'client_line_id'),
      'freight',freights->(line->>'client_line_id'),'acquisition',line_acquisition));
    FOR component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(line->'components') LOOP
      product_identity:=(component->>'product_id')::UUID;
      source_identity:=NULLIF(line->>'purchase_order_item_id','')::UUID;
      component_cost:=(acquisition->>product_identity::TEXT)::BIGINT;
      component_net:=(merchandise->>product_identity::TEXT)::BIGINT;
      bindings:=bindings||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('identity',line->>'client_line_id'||'|'||product_identity::TEXT,
        'clientLineId',line->>'client_line_id','productId',product_identity,'purchaseOrderItemId',source_identity,
        'baseQuantity',(component->>'base_quantity')::INT,'merchandiseNetCost',component_net,'allocatedCost',component_cost,
        'exactUnitCost',ROUND(component_cost::NUMERIC/(component->>'base_quantity')::NUMERIC,6),
        'legacyUnitCost',ROUND(component_cost::NUMERIC/(component->>'base_quantity')::NUMERIC,0)));
    END LOOP;
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-line-allocation-v1','kind',kind,'sourceContract',source_contract,
    'request',JSONB_BUILD_OBJECT('lines',request_lines,'headerDiscount',header_discount,'freight',freight,'legacyTax',legacy_tax,'paid',paid),
    'canonicalLines',lines,'anchors',anchors,'lineBindings',line_bindings,'componentBindings',bindings,
    'gross',gross,'lineDiscounts',line_discounts,'net',net,'acquisition',net-header_discount+freight,
    'payable',net-header_discount+freight+legacy_tax,'outstanding',net-header_discount+freight+legacy_tax-paid,
    'allocationFingerprint',public.phase2_request_fingerprint_internal(JSONB_BUILD_OBJECT('kind',kind,'lines',lines,
      'headerDiscount',header_discount,'freight',freight,'legacyTax',legacy_tax,'paid',paid)),
    'headerIdentityAdmitted',FALSE,'purchaseOrderCapacityQualified',FALSE,'featureEligibilityQualified',FALSE,
    'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'paymentDomainsQualified',FALSE,
    'futureIdentityClaimed',FALSE,'numberClaimed',FALSE,'locksHeld',FALSE,'absencePredicatesFenced',FALSE,
    'allowedInvokerClosure',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_line_allocation_v1(TEXT,JSONB,BIGINT,BIGINT,BIGINT,BIGINT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_line_allocation_v1(TEXT,JSONB,BIGINT,BIGINT,BIGINT,BIGINT) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_line_allocation_v1(
  kind TEXT,request_lines JSONB,header_discount BIGINT,freight BIGINT,legacy_tax BIGINT,paid BIGINT,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_line_allocation_v1(kind,request_lines,header_discount,freight,legacy_tax,paid) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_ALLOCATION_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_line_allocation_v1(TEXT,JSONB,BIGINT,BIGINT,BIGINT,BIGINT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_line_allocation_v1(TEXT,JSONB,BIGINT,BIGINT,BIGINT,BIGINT,JSONB) OWNER TO postgres;

-- Modern Receipt V2 header/resource discovery ONLY: no acquisition or executor.
-- Complete private wire snapshots use exact decimal strings for financial
-- scalars; the canonical public113 fingerprint uses the actual typed scalars.
-- A historical public result is observed BEFORE new eligibility, never adopted
-- as Phase5 execution/settlement authority by this inquiry boundary.
CREATE FUNCTION phase5_private.discover_receipt_v2_prewrite_v1(kind TEXT,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  actor UUID:=auth.uid(); source_contract JSONB; routine RECORD; grantees TEXT[];
  canonical JSONB; lines JSONB; allocation JSONB; resources JSONB; rows JSONB; catalog JSONB;
  actor_contract JSONB; feature_rows JSONB; feature_state TEXT; key TEXT; invoice TEXT;
  method TEXT; reference TEXT; field TEXT; supplier_identity UUID; wh UUID; branch_identity UUID;
  po public.purchase_orders%ROWTYPE; source public.purchase_order_items%ROWTYPE;
  existing public.business_operations%ROWTYPE; legacy_key UUID; fingerprint TEXT; v_operation_type TEXT;
  discount BIGINT; freight BIGINT; tax BIGINT; paid BIGINT; line JSONB; ids UUID[];
  quantity NUMERIC; all_completed BOOLEAN; shift_rows JSONB; gates JSONB; absence JSONB;
BEGIN
  source_contract:=phase5_private.assert_receipt_v2_allocation_sources_v1();
  FOR routine IN SELECT p.*,s.signature,s.body_hash,s.definer,s.volatility,s.grantees FROM (VALUES
    ('public.phase2_try_parse_uuid_internal(text)','25ad625f187c98d06c409f45c1daeb2802e7bd8bee35ae0f0a96c4d396856169',FALSE,'i',ARRAY['postgres']::TEXT[]),
    ('public.get_configurable_parcel_feature_state()','340b9b3656b0816610803191615b1837db55169627f9579b0df24fd7195f7028',TRUE,'s',ARRAY['anon','authenticated','postgres','service_role']::TEXT[]),
    ('public.assert_configurable_parcel_creation_allowed()','90875cd1e8136293145646ea8f2a2b6c8b297cdad0532d0c7473a479d703323a',TRUE,'s',ARRAY['postgres']::TEXT[])
    ) s(signature,body_hash,definer,volatility,grantees)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s.signature) LOOP
    SELECT ARRAY_AGG(name ORDER BY name COLLATE "C") INTO grantees FROM (
      SELECT CASE WHEN a.grantee=0 THEN 'public' ELSE pg_get_userbyid(a.grantee) END name
      FROM aclexplode(COALESCE(routine.proacl,acldefault('f',routine.proowner))) a) acl;
    IF routine.oid IS NULL OR routine.proowner IS DISTINCT FROM 'postgres'::REGROLE
      OR routine.prosecdef IS DISTINCT FROM routine.definer OR routine.provolatile::TEXT IS DISTINCT FROM routine.volatility
      OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
      OR ENCODE(extensions.digest(REPLACE(REPLACE(routine.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),'sha256'),'hex')
        IS DISTINCT FROM routine.body_hash OR grantees IS DISTINCT FROM routine.grantees THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_RECEIPT_V2_HEADER_SOURCE_INVALID'; END IF;
  END LOOP;
  IF kind IS NULL OR kind NOT IN ('DIRECT_V2','PO_V2') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_KIND_INVALID'; END IF;
  PERFORM phase5_private.assert_wire_keys_v1(request,CASE kind WHEN 'DIRECT_V2' THEN ARRAY[
    'supplier_id','warehouse_id','branch_id','supplier_invoice_number','supplier_invoice_date','received_at',
    'header_discount_in_minor_units','supplier_freight_in_minor_units','legacy_tax_in_minor_units',
    'amount_paid_at_receipt_in_minor_units','payment_method','payment_reference','notes','internal_notes','idempotency_key','lines']
    ELSE ARRAY['purchase_order_id','warehouse_id','supplier_invoice_number','supplier_invoice_date','received_at',
    'header_discount_in_minor_units','supplier_freight_in_minor_units','legacy_tax_in_minor_units',
    'amount_paid_at_receipt_in_minor_units','payment_method','payment_reference','supplier_delivery_note','notes','idempotency_key','lines'] END);
  FOR field IN SELECT value FROM UNNEST(CASE kind WHEN 'DIRECT_V2' THEN ARRAY[
    'supplier_invoice_number','supplier_invoice_date','received_at','payment_method','payment_reference','notes','internal_notes']
    ELSE ARRAY['supplier_invoice_number','supplier_invoice_date','received_at','payment_method','payment_reference','supplier_delivery_note','notes'] END) value LOOP
    IF JSONB_TYPEOF(request->field) NOT IN ('string','null') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_TEXT_INVALID'; END IF;
  END LOOP;
  IF JSONB_TYPEOF(request->'idempotency_key') IS DISTINCT FROM 'string'
    OR JSONB_TYPEOF(request->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_REQUEST_INVALID'; END IF;
  key:=NULLIF(BTRIM(request->>'idempotency_key'),'');
  IF key IS NULL OR CHAR_LENGTH(key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_KEY_INVALID'; END IF;
  discount:=phase5_private.wire_money_v1(request->'header_discount_in_minor_units');
  freight:=phase5_private.wire_money_v1(request->'supplier_freight_in_minor_units');
  tax:=phase5_private.wire_money_v1(request->'legacy_tax_in_minor_units');
  paid:=phase5_private.wire_money_v1(request->'amount_paid_at_receipt_in_minor_units');
  method:=LOWER(COALESCE(NULLIF(BTRIM(request->>'payment_method'),''),'cash'));
  reference:=NULLIF(BTRIM(request->>'payment_reference'),''); invoice:=LOWER(NULLIF(BTRIM(request->>'supplier_invoice_number'),''));
  IF method NOT IN ('cash','cliq','bank_transfer','deferred') OR (method='deferred' AND paid>0)
    OR (method IN ('cliq','bank_transfer') AND paid>0 AND reference IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_TENDER_INVALID'; END IF;
  lines:=public.phase2_canonicalize_receipt_lines_internal(request->'lines');
  v_operation_type:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt_v2' ELSE 'purchase_order_receipt_v2' END;
  canonical:=JSONB_BUILD_OBJECT('contract_version',2,'operation_type',v_operation_type,'warehouse_id',
    CASE WHEN request->'warehouse_id'='null'::JSONB THEN NULL ELSE phase5_private.wire_uuid_v1(request->'warehouse_id') END,
    'supplier_invoice_number',invoice,'supplier_invoice_date',(request->>'supplier_invoice_date')::DATE,
    'received_at',CASE WHEN request->>'received_at' IS NULL THEN NULL ELSE TO_CHAR((request->>'received_at')::TIMESTAMPTZ
      AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'header_discount_in_minor_units',discount,'supplier_freight_in_minor_units',freight,'legacy_tax_in_minor_units',tax,
    'amount_paid_at_receipt_in_minor_units',paid,'payment_method',method,'payment_reference',reference,
    'notes',NULLIF(BTRIM(request->>'notes'),''),'lines',lines);
  IF kind='DIRECT_V2' THEN
    supplier_identity:=phase5_private.wire_uuid_v1(request->'supplier_id');
    wh:=phase5_private.wire_uuid_v1(request->'warehouse_id');
    branch_identity:=CASE WHEN request->'branch_id'='null'::JSONB THEN NULL ELSE phase5_private.wire_uuid_v1(request->'branch_id') END;
    canonical:=canonical||JSONB_BUILD_OBJECT('supplier_id',supplier_identity,'branch_id',branch_identity,'internal_notes',NULLIF(BTRIM(request->>'internal_notes'),''));
    legacy_key:=public.phase2_try_parse_uuid_internal(key);
    IF legacy_key IS NOT NULL THEN key:=legacy_key::TEXT; END IF;
    IF legacy_key IS NOT NULL AND EXISTS(SELECT 1 FROM public.supplier_receipts WHERE idempotency_key=legacy_key) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN'; END IF;
    IF EXISTS(SELECT 1 FROM public.business_operations b WHERE b.operation_type=v_operation_type
      AND b.idempotency_key=key AND b.initiated_by IS DISTINCT FROM actor) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
  ELSE
    canonical:=canonical||JSONB_BUILD_OBJECT('purchase_order_id',phase5_private.wire_uuid_v1(request->'purchase_order_id'),
      'supplier_delivery_note',NULLIF(BTRIM(request->>'supplier_delivery_note'),''));
  END IF;
  fingerprint:=public.phase2_request_fingerprint_internal(canonical);
  SELECT * INTO existing FROM public.business_operations b WHERE b.operation_type=v_operation_type AND b.initiated_by=actor AND b.idempotency_key=key;
  SELECT JSONB_BUILD_OBJECT('profile',(SELECT TO_JSONB(p) FROM public.profiles p WHERE id=actor),
    'roles',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('membership',TO_JSONB(ur),'role',TO_JSONB(r)) ORDER BY ur.role_id),'[]')
      FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor)) INTO actor_contract;
  gates:=JSONB_BUILD_ARRAY(CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt:'||key ELSE 'purchase_order_receipt_v2:'||actor::TEXT||':'||key END);
  IF existing.id IS NOT NULL THEN
    IF existing.request_fingerprint IS NULL OR existing.result_snapshot IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN'; END IF;
    IF existing.request_fingerprint IS DISTINCT FROM fingerprint THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-prewrite-v1','kind',kind,'mode','EXISTING_PUBLIC_OUTCOME_OBSERVED',
      'request',request,'canonicalRequest',canonical,'fingerprint',fingerprint,'normalizedKey',key,'actorContract',actor_contract,
      'sourceContract',source_contract,'existingOperation',TO_JSONB(existing),'keyGates',gates,
      'replayEvidenceQualified',FALSE,'locksHeld',FALSE,'defaultsQualified',FALSE,'futureIdentityClaimed',FALSE,
      'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'allowedInvokerClosure',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
  END IF;
  allocation:=phase5_private.derive_receipt_v2_line_allocation_v1(kind,request->'lines',discount,freight,tax,paid);
  IF kind='PO_V2' THEN
    SELECT * INTO po FROM public.purchase_orders WHERE id=(canonical->>'purchase_order_id')::UUID;
    IF po.id IS NULL OR po.status IS NULL OR po.status NOT IN ('approved','partially_received') OR po.amount_paid_in_minor_units IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PO_INVALID_OR_PREPAID'; END IF;
    wh:=COALESCE((canonical->>'warehouse_id')::UUID,po.warehouse_id); branch_identity:=po.branch_id; supplier_identity:=po.supplier_id;
    FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(lines) LOOP
      SELECT * INTO source FROM public.purchase_order_items WHERE id=(line->>'purchase_order_item_id')::UUID AND purchase_order_id=po.id;
      SELECT SUM((c->>'base_quantity')::NUMERIC) INTO quantity FROM JSONB_ARRAY_ELEMENTS(line->'components') c;
      IF source.id IS NULL OR source.commercial_line_kind IS DISTINCT FROM line->>'line_kind' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PO_ITEM_INVALID'; END IF;
      IF line->>'line_kind'='base_unit' THEN
        IF source.ordered_quantity IS NULL OR source.received_quantity IS NULL
          OR source.product_id IS DISTINCT FROM (line->'components'->0->>'product_id')::UUID
          OR quantity>source.ordered_quantity::NUMERIC-source.received_quantity::NUMERIC THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PO_CAPACITY_INVALID'; END IF;
      ELSE
        IF source.family_product_id IS DISTINCT FROM (line->>'family_product_id')::UUID
          OR source.parcel_configuration_id IS DISTINCT FROM (line->>'parcel_configuration_id')::UUID
          OR source.configuration_revision IS DISTINCT FROM (line->>'configuration_revision')::INT
          OR source.units_per_parcel_snapshot IS DISTINCT FROM (line->>'units_per_parcel')::INT
          OR source.parcel_quantity IS NULL OR source.received_parcel_quantity IS NULL
          OR (line->>'commercial_quantity')::NUMERIC>source.parcel_quantity::NUMERIC-source.received_parcel_quantity::NUMERIC THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PO_PARCEL_CAPACITY_INVALID'; END IF;
      END IF;
    END LOOP;
    SELECT NOT EXISTS(SELECT 1 FROM public.purchase_order_items i LEFT JOIN LATERAL (
      SELECT SUM((c->>'base_quantity')::NUMERIC) received_base,
        CASE WHEN n->>'line_kind'='configurable_parcel' THEN (n->>'commercial_quantity')::NUMERIC ELSE 0 END received_parcels
      FROM JSONB_ARRAY_ELEMENTS(lines) n CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(n->'components') c
      WHERE (n->>'purchase_order_item_id')::UUID=i.id GROUP BY n) incoming ON TRUE WHERE i.purchase_order_id=po.id AND (
        i.received_quantity+COALESCE(incoming.received_base,0)<i.ordered_quantity OR (i.commercial_line_kind='configurable_parcel'
        AND i.received_parcel_quantity+COALESCE(incoming.received_parcels,0)<i.parcel_quantity))) INTO all_completed;
  END IF;
  IF wh IS NULL OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wh AND is_active)
    OR NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=supplier_identity AND (kind='PO_V2' OR is_active))
    OR (kind='DIRECT_V2' AND branch_identity IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.branches WHERE id=branch_identity AND is_active)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_HEADER_IDENTITY_INVALID'; END IF;
  SELECT COALESCE(JSONB_AGG(TO_JSONB(s) ORDER BY id),'[]') INTO shift_rows FROM public.cash_shifts s
    WHERE branch_id=branch_identity AND status='open' AND paid>0 AND method IN ('cash','cliq');
  IF paid>0 AND method IN ('cash','cliq') AND (branch_identity IS NULL OR JSONB_ARRAY_LENGTH(shift_rows)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_PAYMENT_SHIFT_REQUIRED'; END IF;
  SELECT COALESCE(JSONB_AGG(TO_JSONB(s) ORDER BY feature_key),'[]') INTO feature_rows FROM public.configurable_parcel_feature_settings s WHERE feature_key='configurable_parcels';
  -- Source-shaped feature predicate; role/MFA already qualified above. No
  -- unqualified elevated role-helper call is used as admission proof.
  SELECT CASE WHEN COUNT(*)=1 AND MAX(s.feature_state) IN ('OFF','OWNER_PILOT','ENABLED') THEN MAX(s.feature_state) ELSE 'OFF' END
    INTO feature_state FROM public.configurable_parcel_feature_settings s WHERE s.feature_key='configurable_parcels';
  IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(lines) n WHERE n->>'line_kind'='configurable_parcel') AND NOT (
    feature_state='ENABLED' OR (feature_state='OWNER_PILOT' AND EXISTS(SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=actor AND r.code='owner'))) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CONFIGURABLE_PARCEL_DISABLED'; END IF;
  IF invoice IS NOT NULL AND (EXISTS(SELECT 1 FROM public.supplier_financial_invoice_identities WHERE supplier_id=supplier_identity AND normalized_invoice_number=invoice AND is_active)
    OR EXISTS(SELECT 1 FROM public.supplier_receipts WHERE supplier_id=supplier_identity AND LOWER(BTRIM(supplier_invoice_number))=invoice AND status<>'cancelled')
    OR EXISTS(SELECT 1 FROM public.purchase_receipts WHERE supplier_id=supplier_identity AND LOWER(BTRIM(supplier_invoice_number))=invoice AND status<>'cancelled')) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DUPLICATE_SUPPLIER_INVOICE'; END IF;
  SELECT ARRAY_AGG(DISTINCT (n->>'productId')::UUID ORDER BY (n->>'productId')::UUID) INTO ids FROM JSONB_ARRAY_ELEMENTS(allocation->'componentBindings') n;
  -- Exact current row union, including whole PO completion membership and
  -- all-warehouse WAC/stock side effects. Future/default identities stay OPEN.
  WITH selected AS (
    SELECT 'public.products' relation,TO_JSONB(t) row_data,'NO_KEY_UPDATE' mode,5 rank FROM public.products t WHERE id=ANY(ids)
    UNION ALL SELECT 'public.inventory_balances',TO_JSONB(t),'UPDATE',5 FROM public.inventory_balances t WHERE product_id=ANY(ids)
    UNION ALL SELECT 'public.products',TO_JSONB(t),'SHARE',7 FROM public.products t WHERE id IN (SELECT (n->>'family_product_id')::UUID FROM JSONB_ARRAY_ELEMENTS(lines) n)
    UNION ALL SELECT 'public.product_parcel_configurations',TO_JSONB(t),'SHARE',7 FROM public.product_parcel_configurations t WHERE id IN (SELECT (n->>'parcel_configuration_id')::UUID FROM JSONB_ARRAY_ELEMENTS(lines) n)
    UNION ALL SELECT 'public.units',TO_JSONB(t),'SHARE',7 FROM public.units t WHERE id IN (SELECT unit_id FROM public.products WHERE id=ANY(ids) UNION SELECT purchase_unit_id FROM public.products WHERE id=ANY(ids))
    UNION ALL SELECT 'public.purchase_orders',TO_JSONB(po),'UPDATE',5 WHERE po.id IS NOT NULL
    UNION ALL SELECT 'public.purchase_order_items',TO_JSONB(t),'UPDATE',6 FROM public.purchase_order_items t WHERE purchase_order_id=po.id
    UNION ALL SELECT 'public.stock_alerts',TO_JSONB(t),'UPDATE',6 FROM public.stock_alerts t WHERE product_id=ANY(ids)
    UNION ALL SELECT 'public.stock_alert_reads',TO_JSONB(t),'UPDATE',6 FROM public.stock_alert_reads t JOIN public.stock_alerts a ON a.id=t.stock_alert_id WHERE a.product_id=ANY(ids)
    UNION ALL SELECT 'public.automation_events',TO_JSONB(t),'UPDATE',6 FROM public.automation_events t WHERE EXISTS(SELECT 1 FROM public.stock_alerts a WHERE a.product_id=ANY(ids) AND (t.entity_id=a.id OR STARTS_WITH(t.event_key,'stock_alert:'||a.id::TEXT||':')))
    UNION ALL SELECT 'public.suppliers',TO_JSONB(t),'UPDATE',5 FROM public.suppliers t WHERE id=supplier_identity
    UNION ALL SELECT 'public.branches',TO_JSONB(t),'SHARE',7 FROM public.branches t WHERE id=branch_identity
    UNION ALL SELECT 'public.warehouses',TO_JSONB(t),'SHARE',7 FROM public.warehouses t WHERE id IN (SELECT wh UNION SELECT warehouse_id FROM public.inventory_balances WHERE product_id=ANY(ids))
    UNION ALL SELECT 'public.cash_shifts',TO_JSONB(t),'SHARE',4 FROM public.cash_shifts t WHERE paid>0 AND method IN ('cash','cliq') AND branch_id=branch_identity AND status='open'
    UNION ALL SELECT 'public.profiles',TO_JSONB(t),'SHARE',7 FROM public.profiles t WHERE id=actor OR id=po.created_by OR id=po.approved_by
    UNION ALL SELECT 'public.user_roles',TO_JSONB(t),'SHARE',7 FROM public.user_roles t WHERE user_id=actor
    UNION ALL SELECT 'public.roles',TO_JSONB(t),'SHARE',7 FROM public.roles t WHERE id IN (SELECT role_id FROM public.user_roles WHERE user_id=actor)
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('relation',relation,'id',CASE relation
    WHEN 'public.stock_alert_reads' THEN row_data->>'stock_alert_id'||'|'||(row_data->>'user_id')
    WHEN 'public.user_roles' THEN row_data->>'user_id'||'|'||(row_data->>'role_id') ELSE row_data->>'id' END,
    'row',row_data,'rank',rank,'mode',mode)) INTO rows FROM selected;
  resources:=phase5_private.merge_completion_lock_resources_v1(rows);
  SELECT JSONB_BUILD_OBJECT('defaults',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',d.adrelid::REGCLASS::TEXT,'column',a.attname,'expression',pg_get_expr(d.adbin,d.adrelid)) ORDER BY d.adrelid,a.attnum),'[]')
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid IN (
        'public.business_operations'::REGCLASS,'public.supplier_receipts'::REGCLASS,'public.supplier_receipt_items'::REGCLASS,'public.supplier_receipt_commercial_lines'::REGCLASS,
        'public.purchase_receipts'::REGCLASS,'public.purchase_receipt_items'::REGCLASS,'public.purchase_receipt_commercial_lines'::REGCLASS,'public.supplier_payments'::REGCLASS,
        'public.inventory_balances'::REGCLASS,'public.inventory_movements'::REGCLASS,'public.phase2_receipt_wac_snapshots'::REGCLASS,'public.supplier_financial_invoice_identities'::REGCLASS,'public.audit_logs'::REGCLASS)),
    'constraints',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',c.conrelid::REGCLASS::TEXT,'name',c.conname,'definition',pg_get_constraintdef(c.oid,TRUE)) ORDER BY c.conrelid,c.conname),'[]')
      FROM pg_constraint c WHERE c.conrelid IN ('public.business_operations'::REGCLASS,'public.supplier_receipts'::REGCLASS,'public.purchase_receipts'::REGCLASS,
        'public.supplier_payments'::REGCLASS,'public.inventory_movements'::REGCLASS,'public.phase2_receipt_wac_snapshots'::REGCLASS,'public.supplier_financial_invoice_identities'::REGCLASS)),
    'triggers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('relation',t.tgrelid::REGCLASS::TEXT,'name',t.tgname,'definition',pg_get_triggerdef(t.oid,TRUE),'function',t.tgfoid::REGPROCEDURE::TEXT) ORDER BY t.tgrelid,t.tgname),'[]')
      FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN ('public.supplier_receipts'::REGCLASS,'public.purchase_receipts'::REGCLASS,
        'public.supplier_payments'::REGCLASS,'public.inventory_balances'::REGCLASS,'public.inventory_movements'::REGCLASS)),
    'sequences',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('name',sequencename,'start',start_value,'minimum',min_value,'maximum',max_value,'increment',increment_by,'cycle',cycle,'cache',cache_size) ORDER BY sequencename),'[]')
      FROM pg_sequences WHERE schemaname='public' AND sequencename IN ('supplier_receipt_seq','inventory_movement_mutation_seq'))) INTO catalog;
  absence:=JSONB_BUILD_OBJECT('key',key,'invoice',invoice,'supplierId',supplier_identity,
    'directNumbers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',id,'number',receipt_number) ORDER BY id),'[]') FROM public.supplier_receipts),
    'poNumbers',(SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('id',id,'number',receipt_number) ORDER BY id),'[]') FROM public.purchase_receipts),
    'targetBalances',(SELECT JSONB_AGG(JSONB_BUILD_OBJECT('productId',p.id,'warehouseId',wh,'row',(SELECT TO_JSONB(b) FROM public.inventory_balances b WHERE b.product_id=p.id AND b.warehouse_id=wh)) ORDER BY p.id) FROM UNNEST(ids) p(id)));
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-prewrite-v1','mode','NEW_REQUEST_DISCOVERED','kind',kind,'request',request,
    'canonicalRequest',canonical,'fingerprint',fingerprint,'normalizedKey',key,'actorContract',actor_contract,'sourceContract',source_contract,
    'allocation',allocation,'effectiveSupplierId',supplier_identity,'effectiveWarehouseId',wh,'effectiveBranchId',branch_identity,
    'prospectivePoCompleted',all_completed,'paymentShiftRows',shift_rows,'featureRows',feature_rows,'featureState',feature_state,
    'keyGates',gates,'invoiceGate',CASE WHEN invoice IS NOT NULL THEN 'supplier_invoice:'||supplier_identity::TEXT||':'||invoice END,
    'inventoryGates',(SELECT JSONB_AGG('inventory-product:'||id::TEXT ORDER BY id) FROM UNNEST(ids) p(id)),
    'resources',resources,'receiptCatalog',catalog,'absenceObservations',absence,'stockContract',phase5_private.plan_stock_writer_source_envelope_v1(),
    'locksHeld',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'futureIdentityClaimed',FALSE,'numberClaimed',FALSE,
    'absencePredicatesFenced',FALSE,'allowedInvokerClosure',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.discover_receipt_v2_prewrite_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.discover_receipt_v2_prewrite_v1(TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_prewrite_v1(kind TEXT,request JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.discover_receipt_v2_prewrite_v1(kind,request) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_PREWRITE_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_prewrite_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_prewrite_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

-- Modern Receipt V2 identity requirements ONLY: no UUID/number allocation,
-- defaults ownership, durable claim, acquisition, held context or executor.
-- The exact future slot set originates from request/source/allocation anchors,
-- never from receipt/movement/WAC/effect rows being validated.
CREATE FUNCTION phase5_private.derive_receipt_v2_identity_requirements_v1(kind TEXT,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE plan JSONB; slots JSONB; header_relation TEXT; line_relation TEXT; item_relation TEXT;
  reference_kind TEXT; operation_type TEXT; action TEXT; invoice TEXT;
BEGIN
  plan:=phase5_private.discover_receipt_v2_prewrite_v1(kind,request);
  IF plan->>'mode' IS DISTINCT FROM 'NEW_REQUEST_DISCOVERED' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_EXISTING_OUTCOME_NOT_NEW_IDENTITIES'; END IF;
  header_relation:=CASE kind WHEN 'DIRECT_V2' THEN 'public.supplier_receipts' ELSE 'public.purchase_receipts' END;
  line_relation:=CASE kind WHEN 'DIRECT_V2' THEN 'public.supplier_receipt_commercial_lines' ELSE 'public.purchase_receipt_commercial_lines' END;
  item_relation:=CASE kind WHEN 'DIRECT_V2' THEN 'public.supplier_receipt_items' ELSE 'public.purchase_receipt_items' END;
  reference_kind:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt' ELSE 'purchase_receipt' END;
  operation_type:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt_v2' ELSE 'purchase_order_receipt_v2' END;
  action:=CASE kind WHEN 'DIRECT_V2' THEN 'CREATE_DIRECT_SUPPLIER_RECEIPT_V2' ELSE 'RECEIVE_PURCHASE_ORDER_V2' END;
  invoice:=NULLIF(LOWER(BTRIM(plan->'canonicalRequest'->>'supplier_invoice_number')),'');
  WITH expected AS (
    SELECT 'OPERATION' slot_key,'public.business_operations' relation,TRUE uuid_required,
      JSONB_BUILD_OBJECT('operation_type',operation_type,'initiated_by',plan->'actorContract'->'profile'->'id',
        'idempotency_key',plan->'normalizedKey','request_fingerprint',plan->'fingerprint') binding
    UNION ALL SELECT 'HEADER',header_relation,TRUE,JSONB_BUILD_OBJECT('operationSlot','OPERATION',
      'supplier_id',plan->'effectiveSupplierId','warehouse_id',plan->'effectiveWarehouseId',
      'purchase_order_id',plan->'canonicalRequest'->'purchase_order_id','reference_kind',reference_kind)
    UNION ALL SELECT 'AUDIT','public.audit_logs',TRUE,JSONB_BUILD_OBJECT('entitySlot','HEADER',
      'entity_name',SUBSTRING(header_relation FROM 8),'action',action,'user_id',plan->'actorContract'->'profile'->'id')
    UNION ALL SELECT 'INVOICE','public.supplier_financial_invoice_identities',TRUE,
      JSONB_BUILD_OBJECT('operationSlot','OPERATION','receiptSlot','HEADER','supplier_id',plan->'effectiveSupplierId',
        'normalized_invoice_number',invoice) WHERE invoice IS NOT NULL
    UNION ALL SELECT 'PAYMENT','public.supplier_payments',TRUE,JSONB_BUILD_OBJECT('operationSlot','OPERATION',
      'receiptSlot','HEADER','supplier_id',plan->'effectiveSupplierId','purchase_order_id',plan->'canonicalRequest'->'purchase_order_id',
      'amount_in_minor_units',plan->'canonicalRequest'->'amount_paid_at_receipt_in_minor_units',
      'payment_method',plan->'canonicalRequest'->'payment_method','reference_number',plan->'canonicalRequest'->'payment_reference',
      'shiftRows',plan->'paymentShiftRows') WHERE (plan->'canonicalRequest'->>'amount_paid_at_receipt_in_minor_units')::BIGINT>0
    UNION ALL SELECT 'LINE|'||(n->>'clientLineId'),line_relation,TRUE,JSONB_BUILD_OBJECT('operationSlot','OPERATION',
      'receiptSlot','HEADER','client_line_id',n->'clientLineId','allocation',n)
      FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'lineBindings') n
    UNION ALL SELECT 'ITEM|'||(n->>'identity'),item_relation,TRUE,JSONB_BUILD_OBJECT('operationSlot','OPERATION',
      'receiptSlot','HEADER','lineSlot','LINE|'||(n->>'clientLineId'),'component',n)
      FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'componentBindings') n
    UNION ALL SELECT 'MOVEMENT|'||(n->>'identity'),'public.inventory_movements',TRUE,
      JSONB_BUILD_OBJECT('operationSlot','OPERATION','receiptSlot','HEADER','itemSlot','ITEM|'||(n->>'identity'),
        'reference_type',reference_kind,'warehouse_id',plan->'effectiveWarehouseId','component',n)
      FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'componentBindings') n
    UNION ALL SELECT 'WAC|'||(n->>'productId'),'public.phase2_receipt_wac_snapshots',TRUE,
      JSONB_BUILD_OBJECT('operationSlot','OPERATION','product_id',n->'productId','warehouse_id',plan->'effectiveWarehouseId',
        'movementSequence','ACTUAL_ALLOCATED_MOVEMENT_SEQUENCE_REQUIRED')
      FROM JSONB_ARRAY_ELEMENTS(plan->'absenceObservations'->'targetBalances') n
    UNION ALL SELECT 'BALANCE|'||(n->>'productId'),'public.inventory_balances',TRUE,
      JSONB_BUILD_OBJECT('product_id',n->'productId','warehouse_id',n->'warehouseId','on_hand_quantity',0,'reserved_quantity',0)
      FROM JSONB_ARRAY_ELEMENTS(plan->'absenceObservations'->'targetBalances') n WHERE n->'row'='null'::JSONB
  ) SELECT JSONB_AGG(JSONB_BUILD_OBJECT('slotKey',slot_key,'relation',relation,'uuidRequired',uuid_required,
      'binding',binding) ORDER BY slot_key COLLATE "C") INTO slots FROM expected;
  IF slots IS NULL OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(slots) n GROUP BY n->>'slotKey' HAVING COUNT(*)<>1) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_IDENTITY_REQUIREMENTS_INVALID'; END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-identity-requirements-v1','kind',kind,'prewrite',plan,'slots',slots,
    'numberDomain',CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt_seq / GRN-year-six-digit-nextval'
      ELSE 'purchase_receipts / GRN-year-six-digit-random-collision-loop' END,
    'movementSequenceDomain','public.inventory_movement_mutation_seq',
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'futureIdentityAllocated',FALSE,
    'durableIdentityClaimed',FALSE,'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,
    'allowedInvokerClosure',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_identity_requirements_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_identity_requirements_v1(TEXT,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_identity_requirements_v1(kind TEXT,request JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_identity_requirements_v1(kind,request) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_IDENTITY_REQUIREMENTS_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_identity_requirements_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_identity_requirements_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

-- Modern Receipt V2 future UUID allocation ONLY: candidates, never ownership.
-- Re-derive the exact primary slot domain BEFORE checking/minting identities.
CREATE FUNCTION phase5_private.derive_receipt_v2_future_uuids_v1(kind TEXT,request JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE requirements JSONB; n JSONB; identity UUID; ids UUID[]:=ARRAY[]::UUID[];
  expected_keys JSONB; actual_keys JSONB; bindings JSONB:='[]'::JSONB; source_ids UUID[];
BEGIN
  requirements:=phase5_private.derive_receipt_v2_identity_requirements_v1(kind,request);
  PERFORM phase5_private.assert_wire_keys_v1(allocation,ARRAY['identities']);
  IF JSONB_TYPEOF(allocation->'identities') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_UUID_ALLOCATION_INVALID'; END IF;
  SELECT JSONB_AGG(s->'slotKey' ORDER BY ordinal) INTO expected_keys
    FROM JSONB_ARRAY_ELEMENTS(requirements->'slots') WITH ORDINALITY t(s,ordinal);
  SELECT JSONB_AGG(s->'slotKey' ORDER BY ordinal) INTO actual_keys
    FROM JSONB_ARRAY_ELEMENTS(allocation->'identities') WITH ORDINALITY t(s,ordinal);
  IF actual_keys IS DISTINCT FROM expected_keys THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_UUID_SLOT_SET_INVALID'; END IF;
  FOR n IN SELECT value FROM JSONB_ARRAY_ELEMENTS(allocation->'identities') LOOP
    PERFORM phase5_private.assert_wire_keys_v1(n,ARRAY['slotKey','id']);
    identity:=phase5_private.wire_uuid_v1(n->'id');
    IF identity='00000000-0000-0000-0000-000000000000'::UUID OR identity=ANY(ids) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_UUID_DUPLICATE_OR_NIL'; END IF;
    ids:=ARRAY_APPEND(ids,identity);
    SELECT bindings||JSONB_BUILD_ARRAY(s||JSONB_BUILD_OBJECT('id',identity)) INTO bindings
      FROM JSONB_ARRAY_ELEMENTS(requirements->'slots') s WHERE s->'slotKey'=n->'slotKey';
  END LOOP;
  -- Source aliases include request client IDs and parent/FK/source row IDs,
  -- not merely the target table's currently occupied primary keys.
  SELECT ARRAY_AGG(DISTINCT (v#>>'{}')::UUID) INTO source_ids
    FROM JSONB_PATH_QUERY(requirements,'$.** ? (@.type() == "string")') v
    WHERE v#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF ids && COALESCE(source_ids,ARRAY[]::UUID[]) OR EXISTS(
    SELECT 1 FROM public.business_operations WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.supplier_receipts WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.purchase_receipts WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.supplier_receipt_commercial_lines WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.purchase_receipt_commercial_lines WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.supplier_receipt_items WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.purchase_receipt_items WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.inventory_movements WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.phase2_receipt_wac_snapshots WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.inventory_balances WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.supplier_financial_invoice_identities WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.supplier_payments WHERE id=ANY(ids)
    UNION ALL SELECT 1 FROM public.audit_logs WHERE id=ANY(ids)) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_UUID_COLLISION_RETRY'; END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-future-uuids-v1','kind',kind,'requirements',requirements,
    'allocation',allocation,'identityBindings',bindings,'futureIdentityAllocated',TRUE,
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'durableIdentityClaimed',FALSE,
    'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,'allowedInvokerClosure',FALSE,
    'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_future_uuids_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_future_uuids_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_future_uuids_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_future_uuids_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_UUID_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_future_uuids_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_future_uuids_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_receipt_v2_future_uuids_v1(kind TEXT,request JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE requirements JSONB; allocation JSONB;
BEGIN
  requirements:=phase5_private.derive_receipt_v2_identity_requirements_v1(kind,request);
  SELECT JSONB_BUILD_OBJECT('identities',JSONB_AGG(JSONB_BUILD_OBJECT('slotKey',s->'slotKey','id',gen_random_uuid()) ORDER BY ordinal))
    INTO allocation FROM JSONB_ARRAY_ELEMENTS(requirements->'slots') WITH ORDINALITY t(s,ordinal);
  -- Fresh exact source rederivation/collision check; no number/sequence use.
  RETURN phase5_private.derive_receipt_v2_future_uuids_v1(kind,request,allocation);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.allocate_receipt_v2_future_uuids_v1(TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_receipt_v2_future_uuids_v1(TEXT,JSONB) OWNER TO postgres;

-- Receipt V2 balance row projections ONLY; deferred event time is not a tuple value.
CREATE FUNCTION phase5_private.derive_receipt_v2_balance_rows_v1(kind TEXT,request JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE candidates JSONB; plan JSONB; source JSONB; old_row JSONB; ids JSONB; columns TEXT[];
  rows JSONB:='[]'::JSONB; next_row JSONB; insert_row JSONB; identity UUID;
  received BIGINT; opening BIGINT; reserved BIGINT; after_quantity BIGINT;
BEGIN
  candidates:=phase5_private.derive_receipt_v2_future_uuids_v1(kind,request,allocation);
  plan:=candidates->'requirements'->'prewrite';
  SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attname) INTO columns FROM pg_attribute a
    WHERE a.attrelid='public.inventory_balances'::REGCLASS AND a.attnum>0 AND NOT a.attisdropped;
  IF columns IS DISTINCT FROM ARRAY['available_quantity','id','on_hand_quantity','product_id','reserved_quantity','updated_at','warehouse_id']::TEXT[]
    OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.inventory_balances'::REGCLASS
      AND a.attnum>0 AND NOT a.attisdropped AND (a.attidentity<>'' OR NOT a.attnotnull AND a.attname<>'available_quantity'
        OR format_type(a.atttypid,a.atttypmod) IS DISTINCT FROM CASE
          WHEN a.attname IN ('id','product_id','warehouse_id') THEN 'uuid'
          WHEN a.attname='updated_at' THEN 'timestamp with time zone' ELSE 'integer' END))
    OR NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.inventory_balances'::REGCLASS AND a.attname='available_quantity' AND a.attgenerated='s'
        AND pg_get_expr(d.adbin,d.adrelid)='(on_hand_quantity - reserved_quantity)') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_BALANCE_SCHEMA_CHANGED_RETRY'; END IF;
  FOR source IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'absenceObservations'->'targetBalances') ORDER BY value->>'productId' LOOP
    old_row:=source->'row'; insert_row:='null'::JSONB;
    SELECT SUM((n->>'baseQuantity')::BIGINT) INTO received FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'componentBindings') n
      WHERE n->'productId'=source->'productId';
    IF received IS NULL OR received<=0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_BALANCE_QUANTITY_INVALID'; END IF;
    IF old_row='null'::JSONB THEN
      SELECT n->'id' INTO ids FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n
        WHERE n->>'slotKey'='BALANCE|'||(source->>'productId');
      identity:=phase5_private.wire_uuid_v1(ids); opening:=0;reserved:=0;
      insert_row:=JSONB_BUILD_OBJECT('id',identity,'warehouse_id',source->'warehouseId','product_id',source->'productId',
        'on_hand_quantity',0,'reserved_quantity',0,'available_quantity',0);
    ELSE
      identity:=(old_row->>'id')::UUID;opening:=(old_row->>'on_hand_quantity')::BIGINT;reserved:=(old_row->>'reserved_quantity')::BIGINT;
      IF (old_row->>'available_quantity')::BIGINT IS DISTINCT FROM opening-reserved THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_BALANCE_SOURCE_INVALID'; END IF;
    END IF;
    after_quantity:=opening+received;
    IF after_quantity>2147483647 OR opening<0 OR reserved<0 OR after_quantity<reserved THEN
      RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='PHASE5_RECEIPT_V2_BALANCE_QUANTITY_OVERFLOW'; END IF;
    next_row:=JSONB_BUILD_OBJECT('id',identity,'warehouse_id',source->'warehouseId','product_id',source->'productId',
      'on_hand_quantity',after_quantity,'reserved_quantity',reserved,'available_quantity',after_quantity-reserved);
    rows:=rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('productId',source->'productId','warehouseId',source->'warehouseId',
      'before',old_row,'insertWithoutEventTime',insert_row,'afterWithoutEventTime',next_row,'receivedQuantity',received,
      'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION','triggerEffectsQualified',FALSE));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-balance-rows-v1','kind',kind,'candidates',candidates,'rows',rows,
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'durableIdentityClaimed',FALSE,
    'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_balance_rows_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_balance_rows_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_balance_rows_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_balance_rows_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_BALANCE_ROWS_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_balance_rows_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_balance_rows_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

-- Receipt V2 inventory/WAC explicit row projections ONLY; actual sequence/time/number remain deferred.
CREATE FUNCTION phase5_private.derive_receipt_v2_inventory_rows_v1(kind TEXT,request JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE balance_plan JSONB; candidates JSONB; plan JSONB; balance_row JSONB; component JSONB; product_row JSONB;
  product_identity UUID; operation_identity UUID; receipt_identity UUID; movement_identity UUID; item_identity UUID; wac_identity UUID;
  source_kind TEXT; actor UUID; received BIGINT; cost BIGINT; opening BIGINT; running BIGINT; prior_exact NUMERIC(24,6);
  next_exact NUMERIC(24,6); prior_legacy BIGINT; next_legacy BIGINT; last_slot TEXT;
  movements JSONB:='[]'::JSONB; wac_rows JSONB:='[]'::JSONB; product_patches JSONB:='[]'::JSONB;
BEGIN
  balance_plan:=phase5_private.derive_receipt_v2_balance_rows_v1(kind,request,allocation);
  candidates:=balance_plan->'candidates';plan:=candidates->'requirements'->'prewrite';
  -- Actor belongs to the source-qualified actor contract, never payload authority.
  actor:=(plan->'actorContract'->'profile'->>'id')::UUID;
  SELECT (n->>'id')::UUID INTO operation_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='OPERATION';
  SELECT (n->>'id')::UUID INTO receipt_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='HEADER';
  source_kind:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt' ELSE 'purchase_receipt' END;
  IF actor IS NULL OR operation_identity IS NULL OR receipt_identity IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_INVENTORY_IDENTITY_INVALID'; END IF;
  FOR balance_row IN SELECT value FROM JSONB_ARRAY_ELEMENTS(balance_plan->'rows') ORDER BY (value->>'productId')::UUID LOOP
    product_identity:=(balance_row->>'productId')::UUID;
    SELECT TO_JSONB(p) INTO product_row FROM public.products p WHERE id=product_identity;
    SELECT SUM((n->>'baseQuantity')::BIGINT),SUM((n->>'allocatedCost')::BIGINT) INTO received,cost
      FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'componentBindings') n WHERE (n->>'productId')::UUID=product_identity;
    SELECT COALESCE(SUM(on_hand_quantity),0) INTO opening FROM public.inventory_balances WHERE product_id=product_identity;
    prior_legacy:=(product_row->>'cost_price_in_minor_units')::BIGINT;
    prior_exact:=COALESCE((product_row->>'wac_cost_in_minor_units_exact')::NUMERIC,prior_legacy::NUMERIC);
    IF product_row IS NULL OR received IS NULL OR received<=0 OR received>2147483647 OR cost IS NULL OR cost<0
      OR opening<0 OR opening>2147483647 OR prior_exact IS NULL OR prior_exact<0 OR prior_legacy IS NULL OR prior_legacy<0 THEN
      RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='PHASE5_RECEIPT_V2_WAC_SOURCE_INVALID'; END IF;
    next_exact:=ROUND((opening::NUMERIC*prior_exact+cost::NUMERIC)/(opening::NUMERIC+received::NUMERIC),6);
    next_legacy:=ROUND(next_exact)::BIGINT;
    running:=(balance_row->'afterWithoutEventTime'->>'on_hand_quantity')::BIGINT-received;
    last_slot:=NULL;
    FOR component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(plan->'allocation'->'componentBindings')
      WHERE (value->>'productId')::UUID=product_identity ORDER BY (value->>'clientLineId')::UUID LOOP
      SELECT (n->>'id')::UUID INTO movement_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n
        WHERE n->>'slotKey'='MOVEMENT|'||(component->>'identity');
      SELECT (n->>'id')::UUID INTO item_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n
        WHERE n->>'slotKey'='ITEM|'||(component->>'identity');
      IF movement_identity IS NULL OR item_identity IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_INVENTORY_IDENTITY_INVALID'; END IF;
      last_slot:='MOVEMENT|'||(component->>'identity');
      movements:=movements||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('slotKey',last_slot,'componentIdentity',component->'identity',
        'explicitRow',JSONB_BUILD_OBJECT('id',movement_identity,'warehouse_id',plan->'effectiveWarehouseId','product_id',product_identity,
          'movement_type','purchase_receipt','quantity',component->'baseQuantity','balance_before',running,
          'balance_after',running+(component->>'baseQuantity')::BIGINT,'reference_type',source_kind,'reference_id',receipt_identity,
          'created_by',actor,'operation_id',operation_identity,'supplier_receipt_item_id',CASE WHEN kind='DIRECT_V2' THEN item_identity END,
          'purchase_receipt_item_id',CASE WHEN kind='PO_V2' THEN item_identity END),
        'notesRequirement',CASE kind WHEN 'DIRECT_V2' THEN 'استلام مورد Phase 2 - ' ELSE 'استلام أمر شراء Phase 2 - ' END,
        'actualReceiptNumberRequired',TRUE,'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION',
        'sequenceRequirement','ACTUAL_INSERT_TRIGGER_RETURNING_SEQUENCE'));
      running:=running+(component->>'baseQuantity')::BIGINT;
    END LOOP;
    SELECT (n->>'id')::UUID INTO wac_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n
      WHERE n->>'slotKey'='WAC|'||product_identity::TEXT;
    IF wac_identity IS NULL OR last_slot IS NULL OR running IS DISTINCT FROM (balance_row->'afterWithoutEventTime'->>'on_hand_quantity')::BIGINT THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_WAC_IDENTITY_INVALID'; END IF;
    wac_rows:=wac_rows||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('slotKey','WAC|'||product_identity::TEXT,
      'explicitRow',JSONB_BUILD_OBJECT('id',wac_identity,'operation_id',operation_identity,'product_id',product_identity,
        'supplier_receipt_id',CASE WHEN kind='DIRECT_V2' THEN receipt_identity END,'purchase_receipt_id',CASE WHEN kind='PO_V2' THEN receipt_identity END,
        'received_base_quantity',received,'allocated_acquisition_cost_in_minor_units',cost,'opening_global_quantity',opening,
        'prior_exact_wac_in_minor_units',prior_exact,'resulting_exact_wac_in_minor_units',next_exact,
        'prior_legacy_wac_in_minor_units',prior_legacy,'resulting_legacy_wac_in_minor_units',next_legacy),
      'lastMovementSlot',last_slot,'sequenceRequirement','ACTUAL_LAST_ORDERED_MOVEMENT_RETURNING_SEQUENCE',
      'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'));
    product_patches:=product_patches||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('productId',product_identity,'before',product_row,
      'patchWithoutEventTime',JSONB_BUILD_OBJECT('wac_cost_in_minor_units_exact',next_exact,'cost_price_in_minor_units',next_legacy),
      'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'));
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-inventory-rows-v1','kind',kind,'balancePlan',balance_plan,
    'movements',movements,'wacRows',wac_rows,'productPatches',product_patches,
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'durableIdentityClaimed',FALSE,
    'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_inventory_rows_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_inventory_rows_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_inventory_rows_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_inventory_rows_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_INVENTORY_ROWS_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_inventory_rows_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_inventory_rows_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

-- Receipt V2 header/financial explicit projections ONLY; event values and trigger effects remain deferred.
CREATE FUNCTION phase5_private.derive_receipt_v2_financial_rows_v1(kind TEXT,request JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE inventory_plan JSONB; candidates JSONB; plan JSONB; amounts JSONB; canonical JSONB; supplier_row JSONB;
  header_row JSONB; operation_row JSONB; result_row JSONB; invoice_row JSONB:='null'::JSONB; payment_row JSONB:='null'::JSONB;
  audit_row JSONB; supplier_patch JSONB; operation_identity UUID; receipt_identity UUID; audit_identity UUID;
  invoice_identity UUID; payment_identity UUID; actor UUID; supplier_identity UUID; outstanding BIGINT; paid BIGINT;
  invoice_number TEXT; normalized_invoice TEXT; operation_type TEXT; entity_name TEXT; action TEXT;
BEGIN
  inventory_plan:=phase5_private.derive_receipt_v2_inventory_rows_v1(kind,request,allocation);
  candidates:=inventory_plan->'balancePlan'->'candidates';plan:=candidates->'requirements'->'prewrite';
  amounts:=plan->'allocation';canonical:=plan->'canonicalRequest';
  actor:=(plan->'actorContract'->'profile'->>'id')::UUID;
  supplier_identity:=(plan->>'effectiveSupplierId')::UUID;
  SELECT TO_JSONB(s) INTO supplier_row FROM public.suppliers s WHERE id=supplier_identity;
  SELECT (n->>'id')::UUID INTO operation_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='OPERATION';
  SELECT (n->>'id')::UUID INTO receipt_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='HEADER';
  SELECT (n->>'id')::UUID INTO audit_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='AUDIT';
  outstanding:=(amounts->>'outstanding')::BIGINT;paid:=(canonical->>'amount_paid_at_receipt_in_minor_units')::BIGINT;
  IF actor IS NULL OR supplier_row IS NULL OR operation_identity IS NULL OR receipt_identity IS NULL OR audit_identity IS NULL
    OR outstanding IS NULL OR outstanding<0 OR paid IS NULL OR paid<0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_FINANCIAL_IDENTITY_INVALID'; END IF;
  -- Preserve display case; the uniqueness domain alone is lower-cased.
  invoice_number:=NULLIF(BTRIM(request->>'supplier_invoice_number'),'');normalized_invoice:=LOWER(invoice_number);
  operation_type:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipt_v2' ELSE 'purchase_order_receipt_v2' END;
  entity_name:=CASE kind WHEN 'DIRECT_V2' THEN 'supplier_receipts' ELSE 'purchase_receipts' END;
  action:=CASE kind WHEN 'DIRECT_V2' THEN 'CREATE_DIRECT_SUPPLIER_RECEIPT_V2' ELSE 'RECEIVE_PURCHASE_ORDER_V2' END;
  header_row:=JSONB_BUILD_OBJECT('id',receipt_identity,'supplier_id',supplier_identity,'warehouse_id',plan->'effectiveWarehouseId',
    'received_by',actor,'operation_id',operation_identity,'status','completed','supplier_invoice_number',invoice_number,
    'supplier_invoice_date',canonical->'supplier_invoice_date','payment_method',canonical->'payment_method','payment_reference',canonical->'payment_reference',
    'notes',canonical->'notes','merchandise_gross_snapshot_in_minor_units',amounts->'gross',
    'line_discount_total_snapshot_in_minor_units',amounts->'lineDiscounts','header_discount_snapshot_in_minor_units',canonical->'header_discount_in_minor_units',
    'supplier_freight_snapshot_in_minor_units',canonical->'supplier_freight_in_minor_units','legacy_tax_snapshot_in_minor_units',canonical->'legacy_tax_in_minor_units',
    'inventory_acquisition_cost_snapshot_in_minor_units',amounts->'acquisition','supplier_invoice_payable_total_snapshot_in_minor_units',amounts->'payable',
    'amount_paid_at_receipt_snapshot_in_minor_units',paid,'supplier_outstanding_balance_effect_snapshot_in_minor_units',outstanding);
  IF kind='DIRECT_V2' THEN
    header_row:=header_row||JSONB_BUILD_OBJECT('branch_id',canonical->'branch_id','internal_notes',canonical->'internal_notes','idempotency_key',NULL,
      'subtotal_in_minor_units',amounts->'net','discount_in_minor_units',canonical->'header_discount_in_minor_units',
      'delivery_fee_in_minor_units',canonical->'supplier_freight_in_minor_units','tax_in_minor_units',canonical->'legacy_tax_in_minor_units',
      'total_in_minor_units',amounts->'payable','amount_paid_in_minor_units',paid,'amount_due_in_minor_units',outstanding,
      'payment_status',CASE WHEN outstanding=0 THEN 'paid' WHEN paid>0 THEN 'partially_paid' ELSE 'unpaid' END);
  ELSE
    header_row:=header_row||JSONB_BUILD_OBJECT('purchase_order_id',canonical->'purchase_order_id','supplier_delivery_note',canonical->'supplier_delivery_note');
  END IF;
  result_row:=JSONB_BUILD_OBJECT('success',TRUE,'idempotent',FALSE,'operation_id',operation_identity,'receipt_id',receipt_identity,
    'inventory_acquisition_cost_in_minor_units',amounts->'acquisition','supplier_invoice_payable_total_in_minor_units',amounts->'payable',
    'supplier_outstanding_balance_effect_in_minor_units',outstanding);
  IF kind='PO_V2' THEN result_row:=result_row||JSONB_BUILD_OBJECT('purchase_order_id',canonical->'purchase_order_id',
    'is_fully_received',plan->'prospectivePoCompleted','new_status',CASE WHEN (plan->>'prospectivePoCompleted')::BOOLEAN THEN 'received' ELSE 'partially_received' END); END IF;
  operation_row:=JSONB_BUILD_OBJECT('id',operation_identity,'operation_type',operation_type,'idempotency_key',plan->'normalizedKey',
    'request_fingerprint',plan->'fingerprint','initiated_by',actor);
  IF normalized_invoice IS NOT NULL THEN
    SELECT (n->>'id')::UUID INTO invoice_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='INVOICE';
    IF invoice_identity IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_FINANCIAL_IDENTITY_INVALID'; END IF;
    invoice_row:=JSONB_BUILD_OBJECT('id',invoice_identity,'supplier_id',supplier_identity,'normalized_invoice_number',normalized_invoice,'operation_id',operation_identity)
      ||CASE kind WHEN 'DIRECT_V2' THEN JSONB_BUILD_OBJECT('supplier_receipt_id',receipt_identity) ELSE JSONB_BUILD_OBJECT('purchase_receipt_id',receipt_identity) END;
  END IF;
  IF paid>0 THEN
    SELECT (n->>'id')::UUID INTO payment_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='PAYMENT';
    IF payment_identity IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_FINANCIAL_IDENTITY_INVALID'; END IF;
    payment_row:=JSONB_BUILD_OBJECT('id',payment_identity,'supplier_id',supplier_identity,'amount_in_minor_units',paid,
      'payment_method',canonical->'payment_method','reference_number',canonical->'payment_reference','created_by',actor,'operation_id',operation_identity)
      ||CASE kind WHEN 'DIRECT_V2' THEN JSONB_BUILD_OBJECT('supplier_receipt_id',receipt_identity)
        ELSE JSONB_BUILD_OBJECT('purchase_order_id',canonical->'purchase_order_id','purchase_receipt_id',receipt_identity) END;
  END IF;
  -- SQL NULL source balance stays NULL exactly as the existing writer does.
  supplier_patch:=JSONB_BUILD_OBJECT('id',supplier_identity,'before',supplier_row,'patchWithoutEventTime',
    JSONB_BUILD_OBJECT('current_balance_in_minor_units',(supplier_row->>'current_balance_in_minor_units')::BIGINT+outstanding));
  audit_row:=JSONB_BUILD_OBJECT('id',audit_identity,'user_id',actor,'action',action,'entity_name',entity_name,'entity_id',receipt_identity,
    'detailsWithoutReceiptNumberAndWac',result_row-'success'-'idempotent'-'receipt_id'-'new_status');
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-financial-rows-v1','kind',kind,'inventoryPlan',inventory_plan,
    'headerWithoutEventValues',header_row,'operationWithoutResultAndTime',operation_row,'resultWithoutReceiptNumber',result_row,
    'invoiceWithoutDefaults',invoice_row,'paymentWithoutNotesTimeAndTrigger',payment_row,'supplierPatchWithoutEventTime',supplier_patch,
    'auditWithoutEventValues',audit_row,'receivedAtInput',canonical->'received_at',
    'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION','receiptNumberRequirement','ACTUAL_SOURCE_NUMBER_ALLOCATION',
    'paymentNotesRequirement','دفعة عند استلام السند ','auditWacRequirement','ACTUAL_COMMITTED_WAC_RESULT',
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'paymentTriggerEffectsQualified',FALSE,
    'durableIdentityClaimed',FALSE,'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_financial_rows_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_financial_rows_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_financial_rows_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_financial_rows_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_FINANCIAL_ROWS_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_financial_rows_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_financial_rows_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

-- Receipt V2 commercial line/item explicit projections ONLY; defaults and finalization time remain deferred.
CREATE FUNCTION phase5_private.derive_receipt_v2_item_rows_v1(kind TEXT,request JSONB,allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE financial_plan JSONB; candidates JSONB; plan JSONB; amounts JSONB; canonical JSONB;
  line JSONB; line_amount JSONB; component JSONB; component_amount JSONB; product_row JSONB; source_row JSONB;
  line_row JSONB; item_row JSONB; patch_row JSONB; lines JSONB:='[]'::JSONB; items JSONB:='[]'::JSONB; po_patches JSONB:='[]'::JSONB;
  operation_identity UUID; receipt_identity UUID; line_identity UUID; item_identity UUID; client_identity UUID; product_identity UUID;
  unit_name TEXT; purchase_unit_name TEXT; received BIGINT; commercial BIGINT; incoming RECORD;
BEGIN
  financial_plan:=phase5_private.derive_receipt_v2_financial_rows_v1(kind,request,allocation);
  candidates:=financial_plan->'inventoryPlan'->'balancePlan'->'candidates';plan:=candidates->'requirements'->'prewrite';
  amounts:=plan->'allocation';canonical:=plan->'canonicalRequest';
  operation_identity:=(financial_plan->'operationWithoutResultAndTime'->>'id')::UUID;
  receipt_identity:=(financial_plan->'headerWithoutEventValues'->>'id')::UUID;
  FOR line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(amounts->'canonicalLines') LOOP
    client_identity:=(line->>'client_line_id')::UUID;
    SELECT n INTO line_amount FROM JSONB_ARRAY_ELEMENTS(amounts->'lineBindings') n WHERE (n->>'clientLineId')::UUID=client_identity;
    SELECT (n->>'id')::UUID INTO line_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n WHERE n->>'slotKey'='LINE|'||client_identity::TEXT;
    SELECT SUM((n->>'base_quantity')::BIGINT) INTO received FROM JSONB_ARRAY_ELEMENTS(line->'components') n;
    commercial:=(line->>'commercial_quantity')::BIGINT;
    IF line_identity IS NULL OR line_amount IS NULL OR received IS NULL OR received<=0 OR received>2147483647 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_ITEM_IDENTITY_INVALID'; END IF;
    line_row:=JSONB_BUILD_OBJECT('id',line_identity,'operation_id',operation_identity,'client_line_id',client_identity,
      'line_sequence',line_amount->'sequence','commercial_line_kind',line->'line_kind',
      'family_product_id',NULLIF(line->>'family_product_id','')::UUID,'parcel_configuration_id',NULLIF(line->>'parcel_configuration_id','')::UUID,
      'configuration_revision',NULLIF(line->>'configuration_revision','')::INT,'received_parcel_quantity',CASE WHEN line->>'line_kind'='configurable_parcel' THEN commercial END,
      'received_base_unit_quantity',received,'units_per_parcel_snapshot',NULLIF(line->>'units_per_parcel','')::INT,
      'base_unit_name_snapshot',line->>'base_unit_name','parcel_unit_name_snapshot',NULLIF(line->>'parcel_unit_name',''),
      'gross_amount_snapshot_in_minor_units',(line->>'gross_amount_in_minor_units')::BIGINT,
      'allocated_header_discount_in_minor_units',line_amount->'headerDiscount','allocated_supplier_freight_in_minor_units',line_amount->'freight',
      'final_acquisition_amount_in_minor_units',line_amount->'acquisition');
    IF kind='DIRECT_V2' THEN
      line_row:=line_row||JSONB_BUILD_OBJECT('supplier_receipt_id',receipt_identity,'commercial_quantity',commercial,
        'discount_snapshot_in_minor_units',(line->>'line_discount_in_minor_units')::BIGINT,'line_total_snapshot_in_minor_units',line_amount->'net');
    ELSE
      line_row:=line_row||JSONB_BUILD_OBJECT('purchase_receipt_id',receipt_identity,'purchase_order_id',canonical->'purchase_order_id',
        'purchase_order_item_id',line->'purchase_order_item_id','received_commercial_quantity',commercial,
        'line_discount_snapshot_in_minor_units',(line->>'line_discount_in_minor_units')::BIGINT,'line_net_merchandise_snapshot_in_minor_units',line_amount->'net');
    END IF;
    lines:=lines||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('identity',client_identity,'explicitRowWithoutFinalizedAt',line_row,
      'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'));
    FOR component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(line->'components') LOOP
      product_identity:=(component->>'product_id')::UUID;
      SELECT n INTO component_amount FROM JSONB_ARRAY_ELEMENTS(amounts->'componentBindings') n
        WHERE (n->>'clientLineId')::UUID=client_identity AND (n->>'productId')::UUID=product_identity;
      SELECT (n->>'id')::UUID INTO item_identity FROM JSONB_ARRAY_ELEMENTS(candidates->'identityBindings') n
        WHERE n->>'slotKey'='ITEM|'||client_identity::TEXT||'|'||product_identity::TEXT;
      IF item_identity IS NULL OR component_amount IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_ITEM_IDENTITY_INVALID'; END IF;
      item_row:=JSONB_BUILD_OBJECT('id',item_identity,'product_id',product_identity,'commercial_line_id',line_identity,'operation_id',operation_identity,
        'merchandise_net_cost_in_minor_units',component_amount->'merchandiseNetCost','allocated_cost_in_minor_units',component_amount->'allocatedCost',
        'exact_unit_cost_in_minor_units',component_amount->'exactUnitCost');
      IF kind='DIRECT_V2' THEN
        SELECT TO_JSONB(p) INTO product_row FROM public.products p WHERE id=product_identity;
        SELECT name_ar INTO unit_name FROM public.units WHERE id=(product_row->>'unit_id')::UUID;
        SELECT name_ar INTO purchase_unit_name FROM public.units WHERE id=(product_row->>'purchase_unit_id')::UUID;
        item_row:=item_row||JSONB_BUILD_OBJECT('supplier_receipt_id',receipt_identity,'purchase_unit_id',product_row->'purchase_unit_id','base_unit_id',product_row->'unit_id',
          'purchase_unit_name',COALESCE(purchase_unit_name,line->>'base_unit_name'),'base_unit_name',COALESCE(unit_name,line->>'base_unit_name'),
          'package_quantity',component_amount->'baseQuantity','units_per_package',1,'total_base_units',component_amount->'baseQuantity',
          'package_price_in_minor_units',ROUND((component_amount->>'merchandiseNetCost')::NUMERIC/(component_amount->>'baseQuantity')::NUMERIC)::BIGINT,
          'base_unit_cost_in_minor_units',component_amount->'legacyUnitCost','discount_in_minor_units',0,'line_total_in_minor_units',component_amount->'merchandiseNetCost',
          'batch_number',NULLIF(component->>'batch_number',''),'production_date',NULLIF(component->>'production_date','')::DATE,
          'expiry_date',NULLIF(component->>'expiry_date','')::DATE,'notes',NULLIF(component->>'notes',''),'selling_price_in_minor_units',0);
      ELSE
        item_row:=item_row||JSONB_BUILD_OBJECT('purchase_receipt_id',receipt_identity,'purchase_order_item_id',line->'purchase_order_item_id',
          'received_quantity',component_amount->'baseQuantity','unit_cost_in_minor_units',component_amount->'legacyUnitCost');
      END IF;
      items:=items||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('identity',component_amount->'identity','clientLineId',client_identity,'explicitRow',item_row));
    END LOOP;
  END LOOP;
  IF kind='PO_V2' THEN
    FOR incoming IN SELECT (l->>'purchase_order_item_id')::UUID source_id,
      SUM((SELECT SUM((c->>'base_quantity')::BIGINT) FROM JSONB_ARRAY_ELEMENTS(l->'components') c)) base_quantity,
      SUM(CASE WHEN l->>'line_kind'='configurable_parcel' THEN (l->>'commercial_quantity')::BIGINT ELSE 0 END) parcel_quantity
      FROM JSONB_ARRAY_ELEMENTS(amounts->'canonicalLines') l GROUP BY (l->>'purchase_order_item_id')::UUID ORDER BY source_id LOOP
      SELECT TO_JSONB(i) INTO source_row FROM public.purchase_order_items i WHERE id=incoming.source_id;
      patch_row:=JSONB_BUILD_OBJECT('received_quantity',(source_row->>'received_quantity')::BIGINT+incoming.base_quantity,
        'received_parcel_quantity',(source_row->>'received_parcel_quantity')::BIGINT+incoming.parcel_quantity);
      IF source_row IS NULL OR (patch_row->>'received_quantity')::NUMERIC>2147483647 OR (patch_row->>'received_parcel_quantity')::NUMERIC>2147483647 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='PHASE5_RECEIPT_V2_PO_QUANTITY_OVERFLOW'; END IF;
      po_patches:=po_patches||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('id',incoming.source_id,'before',source_row,'patchWithoutEventTime',patch_row,
        'eventTimeRequirement','ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'));
    END LOOP;
  END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-item-rows-v1','kind',kind,'financialPlan',financial_plan,
    'commercialLines',lines,'items',items,'purchaseOrderItemPatches',po_patches,
    'fullWriteTuples',FALSE,'defaultsQualified',FALSE,'stockEffectIdentitiesComplete',FALSE,'paymentTriggerEffectsQualified',FALSE,
    'durableIdentityClaimed',FALSE,'numberClaimed',FALSE,'absencePredicatesFenced',FALSE,'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_item_rows_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_item_rows_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_item_rows_v1(kind TEXT,request JSONB,allocation JSONB,expected JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_item_rows_v1(kind,request,allocation) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_ITEM_ROWS_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_item_rows_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_item_rows_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

-- Receipt-specific alert/outbox candidates. Reuse the COMPLETE source/item
-- union, not the sales-only alert kernel (receiving has no customer Order).
-- NULL allocation means server UUID minting; explicit allocations exist only
-- for private deterministic revalidation. Neither path claims an identity,
-- fences absence, acquires locks, consumes defaults or writes business rows.
CREATE FUNCTION phase5_private.derive_receipt_v2_stock_candidates_v1(
  kind TEXT,request JSONB,primary_allocation JSONB,stock_allocation JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE item_plan JSONB; balance_plan JSONB; prewrite JSONB; balance JSONB; product_row JSONB; warehouse_row JSONB;
  before_alert JSONB; after_alert JSONB; ids JSONB; event_row JSONB; payload JSONB; deleted_reads JSONB;
  stages JSONB:='[]'::JSONB; allocations JSONB:='[]'::JSONB; candidates UUID[]:=ARRAY[]::UUID[]; source_ids UUID[];
  clock_at TIMESTAMPTZ:=transaction_timestamp(); product_id UUID; warehouse_id UUID; alert_id UUID; event_id UUID;
  threshold INTEGER; available INTEGER; severity TEXT; stage_name TEXT; action TEXT; planned_key TEXT; disposition TEXT;
  ordinal INTEGER:=0; active_count INTEGER; emit BOOLEAN; supplied BOOLEAN:=stock_allocation IS NOT NULL;
BEGIN
  item_plan:=phase5_private.derive_receipt_v2_item_rows_v1(kind,request,primary_allocation);
  balance_plan:=item_plan->'financialPlan'->'inventoryPlan'->'balancePlan';
  prewrite:=balance_plan->'candidates'->'requirements'->'prewrite';
  -- Independent effective body/trigger pins are also part of prewrite. Pin the
  -- actual UUID/time defaults; caller time/UUID markers never confer authority.
  IF (SELECT COUNT(*) FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid IN ('public.stock_alerts'::REGCLASS,'public.automation_events'::REGCLASS)
        AND a.attname='id' AND a.atttypid='uuid'::REGTYPE AND a.attnotnull
        AND a.attidentity='' AND a.attgenerated='' AND pg_get_expr(d.adbin,d.adrelid)='gen_random_uuid()')<>2
    OR (SELECT COUNT(*) FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE ((a.attrelid='public.stock_alerts'::REGCLASS AND a.attname IN ('first_triggered_at','last_updated_at'))
        OR (a.attrelid='public.automation_events'::REGCLASS AND a.attname='created_at'))
        AND a.atttypid='timestamp with time zone'::REGTYPE AND a.attnotnull
        AND a.attidentity='' AND a.attgenerated='' AND pg_get_expr(d.adbin,d.adrelid)='now()')<>3 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PHASE5_RECEIPT_V2_STOCK_DEFAULT_DRIFT'; END IF;
  IF supplied AND JSONB_TYPEOF(stock_allocation) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_STOCK_ALLOCATION_INVALID'; END IF;
  FOR balance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(balance_plan->'rows') ORDER BY value->>'productId' LOOP
    product_id:=(balance->>'productId')::UUID; warehouse_id:=(balance->>'warehouseId')::UUID;
    SELECT n->'row' INTO STRICT product_row FROM JSONB_ARRAY_ELEMENTS(prewrite->'resources') n
      WHERE n->>'relation'='public.products' AND n->>'id'=product_id::TEXT;
    SELECT n->'row' INTO STRICT warehouse_row FROM JSONB_ARRAY_ELEMENTS(prewrite->'resources') n
      WHERE n->>'relation'='public.warehouses' AND n->>'id'=warehouse_id::TEXT;
    SELECT COUNT(*),JSONB_AGG(n->'row')->0 INTO active_count,before_alert
      FROM JSONB_ARRAY_ELEMENTS(prewrite->'resources') n WHERE n->>'relation'='public.stock_alerts'
        AND n->'row'->>'product_id'=product_id::TEXT AND n->'row'->>'warehouse_id'=warehouse_id::TEXT
        AND n->'row'->>'status'='active';
    IF active_count>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_ACTIVE_SET_INVALID'; END IF;
    threshold:=GREATEST(COALESCE((product_row->>'min_stock_level')::INTEGER,0),0);
    FOREACH stage_name IN ARRAY CASE WHEN balance->'before'='null'::JSONB
      THEN ARRAY['ZERO_INSERT','FINAL_UPDATE'] ELSE ARRAY['FINAL_UPDATE'] END LOOP
      available:=CASE WHEN stage_name='ZERO_INSERT' THEN 0 ELSE (balance->'afterWithoutEventTime'->>'available_quantity')::INTEGER END;
      action:='NONE'; severity:=NULL; after_alert:=before_alert;
      IF NOT COALESCE((product_row->>'is_active')::BOOLEAN,FALSE) THEN
        IF before_alert->>'status'='active' THEN action:='RESOLVE_INACTIVE'; END IF;
      ELSIF available<=threshold THEN
        severity:=CASE WHEN available<=0 THEN 'out_of_stock' ELSE 'low_stock' END;
        action:=CASE WHEN before_alert->>'status'='active' THEN 'UPDATE' ELSE 'INSERT' END;
      ELSIF before_alert->>'status'='active' THEN action:='RESOLVE'; END IF;
      IF action='NONE' THEN CONTINUE; END IF;
      IF supplied THEN
        ids:=stock_allocation->ordinal;
        PERFORM phase5_private.assert_wire_keys_v1(ids,ARRAY['productId','warehouseId','stage','alertId','eventId']);
        IF ids->>'productId' IS DISTINCT FROM product_id::TEXT OR ids->>'warehouseId' IS DISTINCT FROM warehouse_id::TEXT
          OR ids->>'stage' IS DISTINCT FROM stage_name THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_STOCK_SLOT_SET_INVALID'; END IF;
      ELSE ids:=JSONB_BUILD_OBJECT('productId',product_id,'warehouseId',warehouse_id,'stage',stage_name,'alertId',NULL,'eventId',NULL); END IF;
      alert_id:=NULL;event_id:=NULL;planned_key:=NULL;event_row:=NULL;payload:=NULL;disposition:='NONE';deleted_reads:='[]'::JSONB;
      IF action='INSERT' THEN
        alert_id:=CASE WHEN supplied THEN phase5_private.wire_uuid_v1(ids->'alertId') ELSE gen_random_uuid() END;
        candidates:=ARRAY_APPEND(candidates,alert_id);
        after_alert:=JSONB_BUILD_OBJECT('id',alert_id,'product_id',product_id,'warehouse_id',warehouse_id,'severity',severity,
          'status','active','available_quantity',available,'threshold_quantity',threshold,
          'first_triggered_at',clock_at,'last_updated_at',clock_at,'resolved_at',NULL);
      ELSIF action='UPDATE' THEN
        after_alert:=before_alert||JSONB_BUILD_OBJECT('severity',severity,'available_quantity',available,
          'threshold_quantity',threshold,'last_updated_at',clock_at,'resolved_at',NULL);
        IF before_alert->>'severity' IS DISTINCT FROM severity THEN
          SELECT COALESCE(JSONB_AGG(n->'row' ORDER BY n->'row'->>'stock_alert_id',n->'row'->>'user_id'),'[]'::JSONB)
            INTO deleted_reads FROM JSONB_ARRAY_ELEMENTS(prewrite->'resources') n
            WHERE n->>'relation'='public.stock_alert_reads' AND n->'row'->>'stock_alert_id'=before_alert->>'id';
        END IF;
      ELSE
        after_alert:=before_alert||JSONB_BUILD_OBJECT('status','resolved','last_updated_at',clock_at,'resolved_at',clock_at);
        IF action='RESOLVE' THEN after_alert:=after_alert||JSONB_BUILD_OBJECT('available_quantity',available,'threshold_quantity',threshold); END IF;
      END IF;
      emit:=action='INSERT' OR (action='UPDATE' AND before_alert->>'severity' IS DISTINCT FROM severity);
      IF emit THEN
        planned_key:='stock_alert:'||(after_alert->>'id')||':'||severity||':'||FLOOR(EXTRACT(EPOCH FROM clock_at))::BIGINT::TEXT;
        payload:=JSONB_BUILD_OBJECT('stockAlertId',after_alert->'id','productId',product_id,
          'productName',COALESCE(product_row->>'name_ar','صنف'),'warehouseId',warehouse_id,
          'warehouseName',COALESCE(warehouse_row->>'name_ar','المستودع'),'availableQuantity',available,
          'thresholdQuantity',threshold,'severity',severity,'updatedAt',clock_at);
        -- Global UNIQUE key lookup, not only rows reachable from the captured
        -- alert resource subset. 099 preserves the ENTIRE first-wins event.
        SELECT TO_JSONB(e) INTO event_row FROM public.automation_events e WHERE e.event_key=planned_key;
        IF event_row IS NOT NULL THEN disposition:='REUSE_PREEXISTING';
        ELSE
          event_id:=CASE WHEN supplied THEN phase5_private.wire_uuid_v1(ids->'eventId') ELSE gen_random_uuid() END;
          candidates:=ARRAY_APPEND(candidates,event_id);disposition:='INSERT_NEW';
          event_row:=JSONB_BUILD_OBJECT('id',event_id,'event_key',planned_key,'event_type',severity,
            'entity_id',after_alert->'id','payload',payload,'created_at',clock_at);
        END IF;
      END IF;
      IF (alert_id IS NULL AND ids->'alertId' IS DISTINCT FROM 'null'::JSONB)
        OR (event_id IS NULL AND ids->'eventId' IS DISTINCT FROM 'null'::JSONB) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_STOCK_UNUSED_IDENTITY'; END IF;
      allocations:=allocations||JSONB_BUILD_ARRAY(ids||JSONB_BUILD_OBJECT('alertId',alert_id,'eventId',event_id));ordinal:=ordinal+1;
      stages:=stages||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('productId',product_id,'warehouseId',warehouse_id,'stage',stage_name,
        'action',action,'before',before_alert,'after',after_alert,'deletedReads',deleted_reads,
        'eventKey',planned_key,'eventPayload',payload,'eventDisposition',disposition,'storedEvent',event_row));
      before_alert:=after_alert;
    END LOOP;
  END LOOP;
  IF supplied AND JSONB_ARRAY_LENGTH(stock_allocation)<>ordinal THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE5_RECEIPT_V2_STOCK_SLOT_SET_INVALID'; END IF;
  SELECT COALESCE(ARRAY_AGG(DISTINCT (v#>>'{}')::UUID),ARRAY[]::UUID[]) INTO source_ids
    FROM JSONB_PATH_QUERY(item_plan,'$.** ? (@.type() == "string")') v
    WHERE v#>>'{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  IF '00000000-0000-0000-0000-000000000000'::UUID=ANY(candidates)
    OR CARDINALITY(candidates)<>(SELECT COUNT(DISTINCT id) FROM UNNEST(candidates) n(id))
    OR candidates && source_ids OR EXISTS(
      SELECT 1 FROM public.stock_alerts WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.automation_events WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.inventory_movements WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.business_operations WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.audit_logs WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.inventory_balances WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.supplier_receipts WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.purchase_receipts WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.supplier_receipt_commercial_lines WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.purchase_receipt_commercial_lines WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.supplier_receipt_items WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.purchase_receipt_items WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.phase2_receipt_wac_snapshots WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.supplier_financial_invoice_identities WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM public.supplier_payments WHERE id=ANY(candidates)
      UNION ALL SELECT 1 FROM phase5_private.mutation_contexts WHERE id=ANY(candidates)) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_UUID_COLLISION_RETRY'; END IF;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-stock-candidates-v1','kind',kind,'itemPlan',item_plan,
    'clock',JSONB_BUILD_OBJECT('timestampUtc',TO_CHAR(clock_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'epochFloorSeconds',FLOOR(EXTRACT(EPOCH FROM clock_at))::BIGINT::TEXT),
    'allocation',allocations,'stages',stages,'serverAllocated',NOT supplied,
    'freshSourceAndCollisionRevalidation',TRUE,'durableIdentityClaimed',FALSE,'absencePredicatesFenced',FALSE,
    'afterWaitRevalidated',FALSE,'fullWriteTuples',FALSE,'writerInvokerClosure',FALSE,
    'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_SOURCE_SET_INVALID';
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.allocate_receipt_v2_stock_candidates_v1(kind TEXT,request JSONB,primary_allocation JSONB)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  RETURN phase5_private.derive_receipt_v2_stock_candidates_v1(kind,request,primary_allocation,NULL);
END; $$;
REVOKE ALL ON FUNCTION phase5_private.allocate_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.allocate_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_stock_candidates_v1(
  kind TEXT,request JSONB,primary_allocation JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ DECLARE fresh JSONB;
BEGIN
  fresh:=phase5_private.derive_receipt_v2_stock_candidates_v1(kind,request,primary_allocation,expected->'allocation');
  IF expected IS DISTINCT FROM fresh||JSONB_BUILD_OBJECT('serverAllocated',TRUE) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_CANDIDATES_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_stock_candidates_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

-- Receipt V2 conditional resource union ONLY. Fresh source/key observations are
-- never held absence fences, durable UUID claims or execution authority.
CREATE FUNCTION phase5_private.derive_receipt_v2_stock_resource_union_v1(
  kind TEXT,request JSONB,primary_allocation JSONB,stock_expected JSONB
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ DECLARE fresh JSONB; resources JSONB; stage JSONB; ids JSONB; prior JSONB;
  key_requirements JSONB:='[]'::JSONB; future JSONB:='[]'::JSONB;
  node JSONB; key_value TEXT; seen_keys TEXT[]:=ARRAY[]::TEXT[]; identity UUID;
BEGIN
  fresh:=phase5_private.derive_receipt_v2_stock_candidates_v1(kind,request,primary_allocation,stock_expected->'allocation');
  IF stock_expected IS DISTINCT FROM fresh||JSONB_BUILD_OBJECT('serverAllocated',TRUE) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_SOURCE_CHANGED_RETRY'; END IF;
  resources:=fresh->'itemPlan'->'financialPlan'->'inventoryPlan'->'balancePlan'->'candidates'->'requirements'->'prewrite'->'resources';
  IF JSONB_TYPEOF(resources) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_SOURCE_INVALID'; END IF;
  -- Full retained resource set, including other-warehouse events, not just
  -- target-alert reachability. Every retained event must still match globally.
  FOR node IN SELECT value FROM JSONB_ARRAY_ELEMENTS(resources) WHERE value->>'relation'='public.automation_events' LOOP
    SELECT TO_JSONB(e) INTO prior FROM public.automation_events e WHERE e.id=(node->>'id')::UUID;
    IF prior IS DISTINCT FROM node->'row' THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_CONTENT_CHANGED_RETRY'; END IF;
  END LOOP;
  FOR stage IN SELECT value FROM JSONB_ARRAY_ELEMENTS(fresh->'stages') LOOP
    SELECT value INTO STRICT ids FROM JSONB_ARRAY_ELEMENTS(fresh->'allocation')
      WHERE value->'productId'=stage->'productId' AND value->'warehouseId'=stage->'warehouseId' AND value->'stage'=stage->'stage';
    FOR node IN SELECT * FROM (VALUES
      (JSONB_BUILD_OBJECT('relation','public.stock_alerts','id',ids->'alertId')),
      (JSONB_BUILD_OBJECT('relation','public.automation_events','id',ids->'eventId'))
    ) AS n(value) LOOP
      IF node->'id' IS DISTINCT FROM 'null'::JSONB THEN
        identity:=(node->>'id')::UUID;
        IF EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(future) n WHERE n->>'id'=identity::TEXT)
          OR EXISTS(SELECT 1 FROM JSONB_ARRAY_ELEMENTS(resources) n WHERE n->>'id'=identity::TEXT) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_IDENTITY_INVALID'; END IF;
        future:=future||JSONB_BUILD_ARRAY(node||JSONB_BUILD_OBJECT('productId',stage->'productId',
          'warehouseId',stage->'warehouseId','stage',stage->'stage',
          'requirement','FRESH_GLOBAL_UUID_COLLISION_REVALIDATION_AND_DURABLE_CLAIM','owned',FALSE));
      END IF;
    END LOOP;
    key_value:=stage->>'eventKey';
    IF key_value IS NOT NULL THEN
      IF key_value=ANY(seen_keys) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_KEY_DUPLICATE'; END IF;
      seen_keys:=ARRAY_APPEND(seen_keys,key_value);
      IF stage->>'eventDisposition'='REUSE_PREEXISTING' THEN
        SELECT value INTO prior FROM JSONB_ARRAY_ELEMENTS(resources)
          WHERE value->>'relation'='public.automation_events' AND value->'id'=stage->'storedEvent'->'id';
        IF prior IS NULL THEN
          resources:=resources||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('relation','public.automation_events',
            'id',stage->'storedEvent'->'id','row',stage->'storedEvent'));
        ELSIF prior->'row' IS DISTINCT FROM stage->'storedEvent' THEN
          RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_CONTENT_CHANGED_RETRY'; END IF;
      END IF;
      key_requirements:=key_requirements||JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'relation','public.automation_events','column','event_key','key',key_value,'disposition',stage->'eventDisposition',
        'observedRow',CASE WHEN stage->>'eventDisposition'='REUSE_PREEXISTING' THEN stage->'storedEvent' ELSE 'null'::JSONB END,
        'candidateId',CASE WHEN stage->>'eventDisposition'='REUSE_PREEXISTING' THEN 'null'::JSONB ELSE stage->'storedEvent'->'id' END,
        'requirement',CASE WHEN stage->>'eventDisposition'='REUSE_PREEXISTING' THEN 'RETAIN_EXACT_GLOBAL_FIRST_OWNER_AND_REVALIDATE'
          ELSE 'FRESH_EXACT_KEY_ABSENCE_REVALIDATION_AND_EXCLUSION_FENCE' END,'afterWaitRevalidated',FALSE,'absenceFenced',FALSE));
    END IF;
  END LOOP;
  RETURN JSONB_BUILD_OBJECT('version','phase5-receipt-v2-stock-resource-union-v1','kind',kind,
    'stockCandidates',stock_expected,'resources',resources,'keyRequirements',key_requirements,'futureIdentityRequirements',future,
    'sourcePlanFreshlyRevalidated',TRUE,'foreignKeysInstalledValidated',FALSE,'typedFullRowsQualified',FALSE,
    'writerInvokerAbsenceConvergence',FALSE,'durableIdentityClaimed',FALSE,'absencePredicatesFenced',FALSE,
    'afterWaitRevalidated',FALSE,'locksHeld',FALSE,'heldContextAuthority',FALSE,'executionAuthority',FALSE);
EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_SOURCE_INVALID';
END; $$;
REVOKE ALL ON FUNCTION phase5_private.derive_receipt_v2_stock_resource_union_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.derive_receipt_v2_stock_resource_union_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

CREATE FUNCTION phase5_private.assert_receipt_v2_stock_resource_union_v1(
  kind TEXT,request JSONB,primary_allocation JSONB,expected JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$ BEGIN
  IF expected IS DISTINCT FROM phase5_private.derive_receipt_v2_stock_resource_union_v1(kind,request,primary_allocation,expected->'stockCandidates') THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE5_RECEIPT_V2_STOCK_RESOURCE_UNION_CHANGED_RETRY'; END IF;
  RETURN TRUE;
END; $$;
REVOKE ALL ON FUNCTION phase5_private.assert_receipt_v2_stock_resource_union_v1(TEXT,JSONB,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION phase5_private.assert_receipt_v2_stock_resource_union_v1(TEXT,JSONB,JSONB,JSONB) OWNER TO postgres;

COMMIT;
