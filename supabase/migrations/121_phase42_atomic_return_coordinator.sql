BEGIN;

-- ============================================================================
-- Nawasrah ERP - Phase 4.2 atomic Return settlement coordinator
--
-- Migration 120 remains the immutable Return/Replacement evidence foundation.
-- This migration adds the operational Return boundary only. Replacement
-- settlement remains out of scope except for the existing conflict guards.
-- Tax is not present in the current sales contract and is intentionally absent.
-- ============================================================================

ALTER TABLE public.sales_return_events
  ADD COLUMN settlement_coordinator_version SMALLINT;

ALTER TABLE public.sales_return_events
  ADD CONSTRAINT sales_return_events_coordinator_version_check CHECK (
    settlement_coordinator_version IS NULL
    OR settlement_coordinator_version = 402
  );

COMMENT ON COLUMN public.sales_return_events.settlement_coordinator_version IS
  '402 identifies a Return whose financial, inventory and audit effects may settle only through the Phase 4.2 atomic coordinator. NULL preserves foundation/legacy evidence.';

CREATE TABLE public.phase42_return_settlement_guards (
  transaction_id XID8 NOT NULL,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  return_event_id UUID NOT NULL
    REFERENCES public.sales_return_events(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (transaction_id, operation_id),
  UNIQUE (transaction_id, return_event_id)
);

CREATE TABLE public.phase42_return_inventory_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  return_event_id UUID NOT NULL
    REFERENCES public.sales_return_events(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  inventory_movement_id UUID NOT NULL UNIQUE
    REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  sellable_quantity INTEGER NOT NULL CHECK (sellable_quantity > 0),
  historical_restock_value_in_minor_units_exact NUMERIC(30, 6) NOT NULL
    CHECK (historical_restock_value_in_minor_units_exact >= 0),
  opening_global_quantity INTEGER NOT NULL CHECK (opening_global_quantity >= 0),
  target_balance_before INTEGER NOT NULL CHECK (target_balance_before >= 0),
  target_balance_after INTEGER NOT NULL CHECK (target_balance_after >= 0),
  prior_wac_in_minor_units_exact NUMERIC(24, 6) NOT NULL
    CHECK (prior_wac_in_minor_units_exact >= 0),
  resulting_wac_in_minor_units_exact NUMERIC(24, 6) NOT NULL
    CHECK (resulting_wac_in_minor_units_exact >= 0),
  resulting_global_quantity INTEGER NOT NULL
    CHECK (resulting_global_quantity > 0),
  resulting_global_value_in_minor_units_exact NUMERIC(30, 6) NOT NULL
    CHECK (resulting_global_value_in_minor_units_exact >= 0),
  source_evidence JSONB NOT NULL
    CHECK (JSONB_TYPEOF(source_evidence) = 'array'
      AND JSONB_ARRAY_LENGTH(source_evidence) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (return_event_id, product_id),
  UNIQUE (operation_id, product_id),
  UNIQUE (id, operation_id)
);

CREATE TABLE public.phase42_return_settlement_evidence (
  operation_id UUID PRIMARY KEY
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  return_event_id UUID NOT NULL UNIQUE
    REFERENCES public.sales_return_events(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  result_snapshot JSONB NOT NULL
    CHECK (JSONB_TYPEOF(result_snapshot) = 'object'),
  inventory_effects_snapshot JSONB NOT NULL
    CHECK (JSONB_TYPEOF(inventory_effects_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.phase42_return_settlement_evidence IS
  'Immutable durable binding proving that one modern Return outcome and its inventory effects were produced inside the Phase 4.2 coordinator transaction.';

CREATE UNIQUE INDEX uq_phase42_return_inventory_movement
  ON public.inventory_movements(reference_type, reference_id, product_id)
  WHERE reference_type = 'phase4_sales_return';

CREATE FUNCTION public.phase42_guard_return_coordinator_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.settlement_coordinator_version
      IS DISTINCT FROM OLD.settlement_coordinator_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Return coordinator identity cannot change.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase42_guard_return_coordinator_version
BEFORE UPDATE ON public.sales_return_events
FOR EACH ROW EXECUTE FUNCTION public.phase42_guard_return_coordinator_version();

CREATE FUNCTION public.phase42_guard_inventory_effect_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Return inventory effect evidence cannot be modified or deleted.';
END;
$$;

CREATE TRIGGER trg_phase42_guard_inventory_effect_history
BEFORE UPDATE OR DELETE ON public.phase42_return_inventory_effects
FOR EACH ROW EXECUTE FUNCTION public.phase42_guard_inventory_effect_history();

CREATE FUNCTION public.phase42_guard_settlement_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Return settlement evidence cannot be modified or deleted.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.phase42_return_settlement_guards guard_row
    WHERE guard_row.transaction_id = pg_current_xact_id()
      AND guard_row.operation_id = NEW.operation_id
      AND guard_row.return_event_id = NEW.return_event_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_COORDINATOR_REQUIRED: Durable Return settlement evidence may be created only by the atomic coordinator.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase42_guard_settlement_evidence
BEFORE INSERT OR UPDATE OR DELETE ON public.phase42_return_settlement_evidence
FOR EACH ROW EXECUTE FUNCTION public.phase42_guard_settlement_evidence();

CREATE FUNCTION public.phase42_inventory_effects_snapshot_internal(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    JSONB_AGG(TO_JSONB(effect) ORDER BY effect.product_id, effect.id),
    '[]'::JSONB
  )
  FROM public.phase42_return_inventory_effects effect
  WHERE effect.operation_id = p_operation_id;
$$;

CREATE FUNCTION public.phase42_expected_return_inventory_effects_internal(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH return_context AS (
    SELECT event.id AS return_event_id,
      creation.operation_type AS sale_operation_type
    FROM public.sales_return_events event
    JOIN public.orders customer_order ON customer_order.id = event.order_id
    JOIN public.business_operations creation
      ON creation.id = customer_order.operation_id
    WHERE event.operation_id = p_operation_id
  ), expected_sources AS (
    SELECT item.product_id,
      item.accepted_base_quantity AS quantity,
      ROUND((CASE
        WHEN context.sale_operation_type = 'phase3_customer_reservation_v1'
          THEN order_item.unit_cost_snapshot_in_minor_units_exact
        ELSE order_item.unit_cost_in_minor_units::NUMERIC
      END) * item.accepted_base_quantity, 6) AS historical_value_exact,
      JSONB_BUILD_OBJECT(
        'source_kind', 'base_order_item',
        'source_id', order_item.id,
        'return_item_id', item.id,
        'product_id', item.product_id,
        'quantity', item.accepted_base_quantity,
        'historical_value_exact', ROUND((CASE
          WHEN context.sale_operation_type = 'phase3_customer_reservation_v1'
            THEN order_item.unit_cost_snapshot_in_minor_units_exact
          ELSE order_item.unit_cost_in_minor_units::NUMERIC
        END) * item.accepted_base_quantity, 6)
      ) AS source_evidence
    FROM public.sales_return_items item
    JOIN return_context context ON true
    JOIN public.order_items order_item ON order_item.id = item.order_item_id
    WHERE item.operation_id = p_operation_id
      AND item.return_scope = 'base_unit'
      AND item.stock_disposition = 'restock'
      AND item.accepted_base_quantity > 0

    UNION ALL

    SELECT inspection.product_id,
      inspection.accepted_quantity AS quantity,
      ROUND((CASE
        WHEN component.exact_cogs_snapshot_in_minor_units IS NOT NULL
          THEN component.exact_cogs_snapshot_in_minor_units
            / component.base_quantity::NUMERIC
        ELSE component.unit_cost_snapshot_in_minor_units
      END) * inspection.accepted_quantity, 6) AS historical_value_exact,
      JSONB_BUILD_OBJECT(
        'source_kind', 'parcel_component',
        'source_id', component.id,
        'return_item_id', item.id,
        'product_id', inspection.product_id,
        'quantity', inspection.accepted_quantity,
        'historical_value_exact', ROUND((CASE
          WHEN component.exact_cogs_snapshot_in_minor_units IS NOT NULL
            THEN component.exact_cogs_snapshot_in_minor_units
              / component.base_quantity::NUMERIC
          ELSE component.unit_cost_snapshot_in_minor_units
        END) * inspection.accepted_quantity, 6)
      ) AS source_evidence
    FROM public.sales_return_component_inspections inspection
    JOIN public.sales_return_items item
      ON item.id = inspection.sales_return_item_id
      AND item.operation_id = inspection.return_operation_id
    JOIN public.order_parcel_components component
      ON component.id = inspection.parcel_component_id
    JOIN return_context context ON true
    WHERE inspection.return_operation_id = p_operation_id
      AND inspection.accepted_condition = 'sellable'
      AND inspection.accepted_stock_disposition = 'restock'
      AND inspection.accepted_quantity > 0
  ), grouped AS (
    SELECT product_id,
      SUM(quantity)::INTEGER AS quantity,
      ROUND(SUM(historical_value_exact), 6) AS historical_value_exact,
      JSONB_AGG(
        source_evidence
        ORDER BY source_evidence->>'source_kind',
          source_evidence->>'source_id',
          source_evidence->>'return_item_id'
      ) AS source_evidence
    FROM expected_sources
    GROUP BY product_id
  )
  SELECT COALESCE(JSONB_OBJECT_AGG(
    product_id::TEXT,
    JSONB_BUILD_OBJECT(
      'quantity', quantity,
      'historicalValueExact', historical_value_exact,
      'sourceEvidence', source_evidence
    )
  ), '{}'::JSONB)
  FROM grouped;
$$;

CREATE FUNCTION public.phase42_assert_operational_return_evidence_internal(
  p_operation_id UUID,
  p_require_settled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_event public.sales_return_events%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_evidence public.phase42_return_settlement_evidence%ROWTYPE;
  v_creation_type TEXT;
  v_inventory JSONB;
  v_expected_inventory JSONB;
  v_actual_inventory JSONB;
BEGIN
  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id;
  IF NOT FOUND OR v_operation.operation_type IS DISTINCT FROM 'phase4_return_v1' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EVIDENCE_INVALID: Return operation identity is missing or invalid.';
  END IF;

  SELECT * INTO v_event
  FROM public.sales_return_events event
  WHERE event.operation_id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EVIDENCE_INVALID: Return event identity is missing.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders customer_order
  WHERE customer_order.id = v_event.order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EVIDENCE_INVALID: Return sale identity is missing.';
  END IF;

  SELECT creation.operation_type INTO v_creation_type
  FROM public.business_operations creation
  WHERE creation.id = v_order.operation_id;

  -- Historical/non-modern Returns retain the Phase 4.1 foundation contract.
  IF v_creation_type NOT IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_evidence
  FROM public.phase42_return_settlement_evidence evidence
  WHERE evidence.operation_id = p_operation_id;
  v_inventory := public.phase42_inventory_effects_snapshot_internal(
    p_operation_id
  );

  -- Derive the complete required restoration independently from persisted
  -- operational effects. This binds quantity, historical valuation and every
  -- logical source to the immutable sale/inspection evidence.
  v_expected_inventory :=
    public.phase42_expected_return_inventory_effects_internal(p_operation_id);
  SELECT COALESCE(
    JSONB_OBJECT_AGG(product_id::TEXT, JSONB_BUILD_OBJECT(
      'quantity', sellable_quantity,
      'historicalValueExact',
        historical_restock_value_in_minor_units_exact,
      'sourceEvidence', source_evidence
    )),
    '{}'::JSONB
  )
  INTO v_actual_inventory
  FROM public.phase42_return_inventory_effects effect
  WHERE effect.operation_id = p_operation_id;
  IF v_actual_inventory IS DISTINCT FROM v_expected_inventory THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE: Inventory effects do not match accepted sellable evidence.';
  END IF;

  -- Durable evidence must point to the exact inventory movement produced for
  -- this Return and its authoritative sale warehouse. Current balances are not
  -- consulted, so legitimate later inventory activity cannot invalidate replay.
  IF EXISTS (
    SELECT 1
    FROM public.phase42_return_inventory_effects effect
    LEFT JOIN public.inventory_movements movement
      ON movement.id = effect.inventory_movement_id
    WHERE effect.operation_id = p_operation_id
      AND (
        effect.return_event_id IS DISTINCT FROM v_event.id
        OR v_event.warehouse_id IS DISTINCT FROM v_order.warehouse_id
        OR effect.warehouse_id IS DISTINCT FROM v_order.warehouse_id
        OR effect.target_balance_after IS DISTINCT FROM
          effect.target_balance_before + effect.sellable_quantity
        OR effect.resulting_global_quantity IS DISTINCT FROM
          effect.opening_global_quantity + effect.sellable_quantity
        OR effect.resulting_global_value_in_minor_units_exact IS DISTINCT FROM
          ROUND(
            effect.opening_global_quantity::NUMERIC
              * effect.prior_wac_in_minor_units_exact
              + effect.historical_restock_value_in_minor_units_exact,
            6
          )
        OR effect.resulting_wac_in_minor_units_exact IS DISTINCT FROM
          ROUND(
            effect.resulting_global_value_in_minor_units_exact
              / effect.resulting_global_quantity::NUMERIC,
            6
          )
        OR movement.id IS NULL
        OR movement.warehouse_id IS DISTINCT FROM effect.warehouse_id
        OR movement.product_id IS DISTINCT FROM effect.product_id
        OR movement.movement_type IS DISTINCT FROM 'return_in'
        OR movement.quantity IS DISTINCT FROM effect.sellable_quantity
        OR movement.balance_before IS DISTINCT FROM effect.target_balance_before
        OR movement.balance_after IS DISTINCT FROM effect.target_balance_after
        OR movement.reference_type IS DISTINCT FROM 'phase4_sales_return'
        OR movement.reference_id IS DISTINCT FROM v_event.id
        OR movement.created_by IS DISTINCT FROM v_operation.initiated_by
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EFFECTS_INVALID: Inventory effects are not bound to the authoritative Return movement.';
  END IF;

  IF v_event.settlement_coordinator_version IS DISTINCT FROM 402
    OR v_evidence.operation_id IS NULL
    OR v_evidence.return_event_id IS DISTINCT FROM v_event.id
    OR v_evidence.order_id IS DISTINCT FROM v_event.order_id
    OR v_evidence.result_snapshot IS DISTINCT FROM v_operation.result_snapshot
    OR v_evidence.inventory_effects_snapshot IS DISTINCT FROM v_inventory
    OR JSONB_TYPEOF(v_operation.result_snapshot) IS DISTINCT FROM 'object'
    OR (v_operation.result_snapshot->>'success')::BOOLEAN IS DISTINCT FROM true
    OR (v_operation.result_snapshot->>'operationId')::UUID
      IS DISTINCT FROM v_operation.id
    OR (v_operation.result_snapshot->>'returnId')::UUID
      IS DISTINCT FROM v_event.id
    OR (v_operation.result_snapshot->>'orderId')::UUID
      IS DISTINCT FROM v_event.order_id
    OR v_operation.result_snapshot->>'returnNumber'
      IS DISTINCT FROM v_event.return_number
    OR (v_operation.result_snapshot->>'merchandiseEntitlementInMinorUnits')::BIGINT
      IS DISTINCT FROM v_event.merchandise_refund_amount_in_minor_units
    OR (v_operation.result_snapshot->>'debtReductionInMinorUnits')::BIGINT
      IS DISTINCT FROM v_event.debt_reduction_amount_in_minor_units
    OR (v_operation.result_snapshot->>'moneyRefundInMinorUnits')::BIGINT
      IS DISTINCT FROM v_event.money_refund_amount_in_minor_units
    OR v_operation.result_snapshot->>'refundMethod'
      IS DISTINCT FROM v_event.refund_method
    OR (v_operation.result_snapshot->>'deliveryRefundInMinorUnits')::BIGINT
      IS DISTINCT FROM 0
    OR (v_operation.result_snapshot->>'taxRefundInMinorUnits')::BIGINT
      IS DISTINCT FROM 0
    OR (p_require_settled AND (
      v_event.settlement_status IS DISTINCT FROM 'settled'
      OR v_event.settled_at IS NULL
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_OPERATIONAL_EVIDENCE_INVALID: Modern Return settlement evidence is missing, malformed, or inconsistent.';
  END IF;
END;
$$;

-- Enforce the operational boundary at the state transition itself. This
-- trigger also protects calls made directly to the private Phase 4.1
-- foundation finalizer; wrapper-only validation is intentionally insufficient.
CREATE FUNCTION public.phase42_require_evidence_before_return_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.settlement_status IS DISTINCT FROM 'settled'
    AND NEW.settlement_status = 'settled'
  THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(
      NEW.operation_id, false
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase42_require_evidence_before_return_settlement
BEFORE UPDATE ON public.sales_return_events
FOR EACH ROW EXECUTE FUNCTION
  public.phase42_require_evidence_before_return_settlement();

-- Replace the Phase 4.1 resolver at its canonical name. There is deliberately
-- no alternate foundation replay function that can adopt a modern settled-
-- looking row without the durable Phase 4.2 evidence binding.
CREATE OR REPLACE FUNCTION public.phase4_resolve_operation_replay_internal(
  p_operation_type TEXT,
  p_idempotency_key TEXT,
  p_actor_scope_hash TEXT,
  p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT := LOWER(NULLIF(BTRIM(p_operation_type), ''));
  v_key TEXT;
  v_actor_hash TEXT := LOWER(NULLIF(BTRIM(p_actor_scope_hash), ''));
  v_fingerprint TEXT := LOWER(NULLIF(BTRIM(p_request_fingerprint), ''));
  v_operation public.business_operations%ROWTYPE;
  v_outcome_count INTEGER;
  v_settled_outcome_count INTEGER;
  v_outcome_id UUID;
BEGIN
  IF v_type IS NULL
    OR v_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
    OR COALESCE(v_actor_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(v_fingerprint, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_IDEMPOTENCY_INPUT_INVALID: Invalid operation identity.';
  END IF;

  v_key := public.phase4_canonicalize_idempotency_key_internal(
    p_idempotency_key
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase4-operation|' || v_type || '|' || v_actor_hash || '|' || v_key, 0
  ));
  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = v_type
    AND operation.actor_scope_type = 'erp_user'
    AND operation.actor_scope_hash = v_actor_hash
    AND public.phase4_canonicalize_idempotency_key_internal(
      operation.idempotency_key
    ) = v_key
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN JSONB_BUILD_OBJECT('decision', 'NEW');
  END IF;
  IF v_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;
  IF v_operation.request_identity_version IS DISTINCT FROM 401
    OR v_operation.request_identity_snapshot IS NULL
    OR v_operation.result_snapshot IS NULL
    OR v_operation.completed_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_IDENTITY_UNPROVEN: Stored operation identity is incomplete.';
  END IF;

  IF v_type = 'phase4_return_v1' THEN
    SELECT COUNT(*)::INTEGER,
      COUNT(*) FILTER (WHERE event.settlement_status = 'settled'
        AND event.settled_at IS NOT NULL
        AND event.contract_version = 401)::INTEGER,
      MIN(event.id::TEXT)::UUID
    INTO v_outcome_count, v_settled_outcome_count, v_outcome_id
    FROM public.sales_return_events event
    WHERE event.operation_id = v_operation.id;
  ELSE
    SELECT COUNT(*)::INTEGER,
      COUNT(*) FILTER (WHERE event.replacement_status = 'settled'
        AND event.settled_at IS NOT NULL
        AND event.contract_version = 401)::INTEGER,
      MIN(event.id::TEXT)::UUID
    INTO v_outcome_count, v_settled_outcome_count, v_outcome_id
    FROM public.sales_replacement_events event
    WHERE event.operation_id = v_operation.id;
  END IF;

  IF v_outcome_count IS DISTINCT FROM 1
    OR v_settled_outcome_count IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_NOT_SETTLED: Stored operation is not a committed successful aftercare outcome.';
  END IF;

  PERFORM public.phase4_assert_aftercare_operation_binding_internal(
    v_operation.id,
    CASE v_type WHEN 'phase4_return_v1' THEN 'return' ELSE 'replacement' END,
    v_outcome_id,
    401::SMALLINT
  );

  IF v_type = 'phase4_return_v1' THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(
      v_operation.id, true
    );
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'decision', 'REPLAY',
    'operation_id', v_operation.id,
    'result_snapshot', v_operation.result_snapshot
  );
END;
$$;

-- Canonical request identity. Arrays are sorted by immutable identities so
-- representation order cannot create a second logical request identity.
CREATE FUNCTION public.phase42_canonicalize_return_request_internal(
  p_order_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_refund_method TEXT,
  p_reference_number TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_method TEXT := LOWER(NULLIF(BTRIM(p_refund_method), ''));
  v_reference TEXT := NULLIF(BTRIM(p_reference_number), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_item JSONB;
  v_component JSONB;
  v_items JSONB := '[]'::JSONB;
  v_components JSONB;
  v_scope TEXT;
  v_order_item_id UUID;
  v_parcel_instance_id UUID;
  v_component_id UUID;
  v_quantity INTEGER;
  v_accepted INTEGER;
  v_rejected INTEGER;
  v_condition TEXT;
  v_accepted_disposition TEXT;
  v_rejection_reason TEXT;
  v_rejected_disposition TEXT;
BEGIN
  IF p_order_id IS NULL OR v_reason IS NULL OR CHAR_LENGTH(v_reason) < 3
    OR CHAR_LENGTH(v_reason) > 500
    OR p_items IS NULL OR JSONB_TYPEOF(p_items) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_items) = 0
    OR JSONB_ARRAY_LENGTH(p_items) > 100
    OR v_method IS NOT NULL AND v_method NOT IN ('cash', 'cliq')
    OR v_method = 'cliq' AND v_reference IS NULL
    OR v_method IS DISTINCT FROM 'cliq' AND v_reference IS NOT NULL
    OR CHAR_LENGTH(COALESCE(v_reference, '')) > 120
    OR CHAR_LENGTH(COALESCE(v_notes, '')) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE42_RETURN_REQUEST_INVALID: Return request shape is invalid.';
  END IF;

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(p_items)
    ORDER BY value->>'order_item_id', value->>'return_scope',
      COALESCE(value->>'parcel_instance_id', '')
  LOOP
    IF JSONB_TYPEOF(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE42_RETURN_ITEM_INVALID: Return item must be an object.';
    END IF;
    v_scope := LOWER(NULLIF(BTRIM(v_item->>'return_scope'), ''));
    v_order_item_id := public.phase3_require_uuid_internal(
      v_item->>'order_item_id', 'return item order_item_id'
    );

    IF v_scope = 'base_unit' THEN
      IF v_item - ARRAY[
          'return_scope', 'order_item_id', 'quantity', 'stock_disposition'
        ]::TEXT[] <> '{}'::JSONB
        OR COALESCE(v_item->>'quantity', '') !~ '^[1-9][0-9]*$'
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_BASE_RETURN_ITEM_INVALID: Base Unit Return shape is invalid.';
      END IF;
      v_quantity := (v_item->>'quantity')::INTEGER;
      IF v_quantity <= 0 OR v_quantity > 2147483647
        OR LOWER(COALESCE(v_item->>'stock_disposition', ''))
          NOT IN ('restock', 'damaged')
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_BASE_RETURN_ITEM_INVALID: Base Unit quantity or disposition is invalid.';
      END IF;
      v_items := v_items || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'return_scope', 'base_unit',
        'order_item_id', LOWER(v_order_item_id::TEXT),
        'quantity', v_quantity,
        'stock_disposition', LOWER(v_item->>'stock_disposition')
      ));
    ELSIF v_scope = 'parcel_instance' THEN
      IF v_item - ARRAY[
          'return_scope', 'order_item_id', 'parcel_instance_id', 'components'
        ]::TEXT[] <> '{}'::JSONB
        OR JSONB_TYPEOF(v_item->'components') IS DISTINCT FROM 'array'
        OR JSONB_ARRAY_LENGTH(v_item->'components') = 0
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_PARCEL_RETURN_ITEM_INVALID: Parcel Return shape is invalid.';
      END IF;
      v_parcel_instance_id := public.phase3_require_uuid_internal(
        v_item->>'parcel_instance_id', 'return item parcel_instance_id'
      );
      v_components := '[]'::JSONB;
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        IF JSONB_TYPEOF(v_component) IS DISTINCT FROM 'object'
          OR v_component - ARRAY[
            'parcel_component_id', 'accepted_quantity', 'rejected_quantity',
            'accepted_condition', 'accepted_stock_disposition',
            'rejection_reason', 'rejected_stock_disposition'
          ]::TEXT[] <> '{}'::JSONB
          OR COALESCE(v_component->>'accepted_quantity', '') !~ '^[0-9]+$'
          OR COALESCE(v_component->>'rejected_quantity', '') !~ '^[0-9]+$'
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE42_PARCEL_INSPECTION_INVALID: Component inspection shape is invalid.';
        END IF;
        v_component_id := public.phase3_require_uuid_internal(
          v_component->>'parcel_component_id', 'parcel_component_id'
        );
        v_accepted := (v_component->>'accepted_quantity')::INTEGER;
        v_rejected := (v_component->>'rejected_quantity')::INTEGER;
        v_condition := LOWER(NULLIF(BTRIM(v_component->>'accepted_condition'), ''));
        v_accepted_disposition := LOWER(NULLIF(BTRIM(
          v_component->>'accepted_stock_disposition'
        ), ''));
        v_rejection_reason := LOWER(NULLIF(BTRIM(
          v_component->>'rejection_reason'
        ), ''));
        v_rejected_disposition := LOWER(NULLIF(BTRIM(
          v_component->>'rejected_stock_disposition'
        ), ''));
        IF v_accepted + v_rejected <= 0
          OR (v_accepted = 0 AND (
            v_condition IS NOT NULL OR v_accepted_disposition IS NOT NULL))
          OR (v_accepted > 0 AND NOT (
            (v_condition = 'sellable' AND v_accepted_disposition = 'restock')
            OR (v_condition = 'supplier_defect'
              AND v_accepted_disposition = 'non_sellable')))
          OR (v_rejected = 0 AND (
            v_rejection_reason IS NOT NULL OR v_rejected_disposition IS NOT NULL))
          OR (v_rejected > 0 AND NOT (
            v_rejection_reason = 'customer_damage'
            AND v_rejected_disposition = 'returned_to_customer'))
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE42_PARCEL_INSPECTION_INVALID: Component quantities and dispositions are inconsistent.';
        END IF;
        v_components := v_components || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'parcel_component_id', LOWER(v_component_id::TEXT),
          'accepted_quantity', v_accepted,
          'rejected_quantity', v_rejected,
          'accepted_condition', v_condition,
          'accepted_stock_disposition', v_accepted_disposition,
          'rejection_reason', v_rejection_reason,
          'rejected_stock_disposition', v_rejected_disposition
        ));
      END LOOP;
      v_items := v_items || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'return_scope', 'parcel_instance',
        'order_item_id', LOWER(v_order_item_id::TEXT),
        'parcel_instance_id', LOWER(v_parcel_instance_id::TEXT),
        'components', v_components
      ));
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE42_RETURN_SCOPE_INVALID: Return scope is unsupported.';
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'order_id', LOWER(p_order_id::TEXT),
    'reason', v_reason,
    'refund_method', v_method,
    'reference_number', v_reference,
    'notes', v_notes,
    'items', v_items
  );
END;
$$;

-- One authoritative projection keeps amount_paid immutable while applying
-- settled Return debt reductions and refunds exactly once.
CREATE FUNCTION public.phase42_order_financial_position_internal(p_order_id UUID)
RETURNS TABLE(
  total_in_minor_units BIGINT,
  delivery_fee_in_minor_units BIGINT,
  net_collected_in_minor_units BIGINT,
  prior_debt_reductions_in_minor_units BIGINT,
  prior_money_refunds_in_minor_units BIGINT,
  outstanding_total_in_minor_units BIGINT,
  delivery_outstanding_in_minor_units BIGINT,
  merchandise_debt_in_minor_units BIGINT,
  refundable_collected_in_minor_units BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH position AS (
    SELECT customer_order.total_in_minor_units AS total_amount,
      customer_order.delivery_fee_in_minor_units AS delivery_amount,
      customer_order.amount_paid_in_minor_units AS collected_amount,
      COALESCE(SUM(event.debt_reduction_amount_in_minor_units)
        FILTER (WHERE event.settlement_status = 'settled'
          AND event.contract_version = 401), 0)::BIGINT AS prior_debt,
      COALESCE(SUM(event.money_refund_amount_in_minor_units)
        FILTER (WHERE event.settlement_status = 'settled'
          AND event.contract_version = 401), 0)::BIGINT AS prior_refunds
    FROM public.orders customer_order
    LEFT JOIN public.sales_return_events event
      ON event.order_id = customer_order.id
    WHERE customer_order.id = p_order_id
    GROUP BY customer_order.id
  ), derived AS (
    SELECT *, GREATEST(total_amount - collected_amount - prior_debt, 0)::BIGINT
      AS outstanding_amount
    FROM position
  ), delivery AS (
    SELECT *, LEAST(delivery_amount, outstanding_amount)::BIGINT
      AS delivery_outstanding
    FROM derived
  )
  SELECT total_amount, delivery_amount, collected_amount, prior_debt,
    prior_refunds, outstanding_amount, delivery_outstanding,
    GREATEST(outstanding_amount - delivery_outstanding, 0)::BIGINT,
    GREATEST(collected_amount - prior_refunds
      - (delivery_amount - delivery_outstanding), 0)::BIGINT
  FROM delivery;
$$;

CREATE FUNCTION public.phase42_apply_return_inventory_internal(
  p_operation_id UUID,
  p_return_event_id UUID,
  p_warehouse_id UUID,
  p_sources JSONB,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product RECORD;
  v_opening_global INTEGER;
  v_target_before INTEGER;
  v_target_after INTEGER;
  v_prior_exact NUMERIC(24, 6);
  v_prior_legacy BIGINT;
  v_restock_value NUMERIC(30, 6);
  v_resulting_value NUMERIC(30, 6);
  v_resulting_quantity INTEGER;
  v_new_exact NUMERIC(24, 6);
  v_new_legacy BIGINT;
  v_movement_id UUID;
  v_effects JSONB := '[]'::JSONB;
BEGIN
  IF p_operation_id IS NULL OR p_return_event_id IS NULL
    OR p_warehouse_id IS NULL OR p_user_id IS NULL
    OR p_sources IS NULL OR JSONB_TYPEOF(p_sources) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE42_INVENTORY_EFFECT_INPUT_INVALID: Return inventory effect input is invalid.';
  END IF;
  IF JSONB_ARRAY_LENGTH(p_sources) = 0 THEN
    RETURN v_effects;
  END IF;

  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT DISTINCT (source->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(p_sources) source
    ORDER BY (source->>'product_id')::UUID
  ));

  FOR v_product IN
    SELECT (source->>'product_id')::UUID AS product_id,
      SUM((source->>'quantity')::INTEGER)::INTEGER AS quantity,
      SUM((source->>'historical_value_exact')::NUMERIC(30, 6))::NUMERIC(30, 6)
        AS historical_value_exact,
      JSONB_AGG(source ORDER BY source->>'source_kind', source->>'source_id')
        AS source_evidence
    FROM JSONB_ARRAY_ELEMENTS(p_sources) source
    GROUP BY (source->>'product_id')::UUID
    ORDER BY (source->>'product_id')::UUID
  LOOP
    IF v_product.quantity <= 0 OR v_product.historical_value_exact < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE42_INVENTORY_EFFECT_INVALID: Sellable quantity and historical value must be valid.';
    END IF;

    SELECT product.wac_cost_in_minor_units_exact,
      product.cost_price_in_minor_units
    INTO v_prior_exact, v_prior_legacy
    FROM public.products product
    WHERE product.id = v_product.product_id
    FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'PHASE42_RETURN_PRODUCT_NOT_FOUND: Return product is unavailable.';
    END IF;
    v_prior_exact := COALESCE(v_prior_exact, v_prior_legacy::NUMERIC);

    SELECT COALESCE(SUM(balance.on_hand_quantity), 0)::INTEGER
    INTO v_opening_global
    FROM public.inventory_balances balance
    WHERE balance.product_id = v_product.product_id;

    INSERT INTO public.inventory_balances(
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES (p_warehouse_id, v_product.product_id, 0, 0)
    ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    SELECT balance.on_hand_quantity INTO v_target_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_product.product_id
    FOR UPDATE;

    v_restock_value := v_product.historical_value_exact;
    v_resulting_quantity := v_opening_global + v_product.quantity;
    v_resulting_value := ROUND(
      v_opening_global::NUMERIC * v_prior_exact + v_restock_value, 6
    );
    v_new_exact := ROUND(
      v_resulting_value / v_resulting_quantity::NUMERIC, 6
    );
    v_new_legacy := ROUND(v_new_exact)::BIGINT;
    v_target_after := v_target_before + v_product.quantity;
    v_movement_id := gen_random_uuid();

    UPDATE public.products
    SET wac_cost_in_minor_units_exact = v_new_exact,
      cost_price_in_minor_units = v_new_legacy,
      updated_at = clock_timestamp()
    WHERE id = v_product.product_id;

    UPDATE public.inventory_balances
    SET on_hand_quantity = v_target_after, updated_at = clock_timestamp()
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product.product_id;

    INSERT INTO public.inventory_movements(
      id, warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by
    ) VALUES (
      v_movement_id, p_warehouse_id, v_product.product_id, 'return_in',
      v_product.quantity, v_target_before, v_target_after,
      'phase4_sales_return', p_return_event_id,
      'Phase 4.2 historical-cost sellable Return restock', p_user_id
    );

    INSERT INTO public.phase42_return_inventory_effects(
      operation_id, return_event_id, warehouse_id, product_id,
      inventory_movement_id, sellable_quantity,
      historical_restock_value_in_minor_units_exact,
      opening_global_quantity, target_balance_before, target_balance_after,
      prior_wac_in_minor_units_exact, resulting_wac_in_minor_units_exact,
      resulting_global_quantity, resulting_global_value_in_minor_units_exact,
      source_evidence
    ) VALUES (
      p_operation_id, p_return_event_id, p_warehouse_id,
      v_product.product_id, v_movement_id, v_product.quantity,
      v_restock_value, v_opening_global, v_target_before, v_target_after,
      v_prior_exact, v_new_exact, v_resulting_quantity,
      v_resulting_value, v_product.source_evidence
    );

    v_effects := v_effects || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'productId', v_product.product_id,
      'quantity', v_product.quantity,
      'historicalRestockValueInMinorUnitsExact', v_restock_value,
      'priorWacInMinorUnitsExact', v_prior_exact,
      'resultingWacInMinorUnitsExact', v_new_exact,
      'inventoryMovementId', v_movement_id
    ));
  END LOOP;
  RETURN v_effects;
END;
$$;

-- Preserve the Phase 4.1 foundation finalizer for Replacement and foundation
-- proofs. Operational Return rows marked 402 require the transaction-local
-- guard created only by settle_sales_return_v1.
ALTER FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID)
  RENAME TO phase4_finalize_aftercare_operation_foundation_internal;

CREATE FUNCTION public.phase4_finalize_aftercare_operation_internal(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_event_id UUID;
  v_version SMALLINT;
BEGIN
  SELECT operation.operation_type INTO v_type
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id;
  IF v_type = 'phase4_return_v1' THEN
    SELECT event.id, event.settlement_coordinator_version
    INTO v_event_id, v_version
    FROM public.sales_return_events event
    WHERE event.operation_id = p_operation_id;

    -- This assertion is deliberately unconditional for Return operations.
    -- It preserves historical/non-modern foundation behavior internally, but
    -- a modern POS/Customer V2 Return cannot exploit a NULL or malformed
    -- coordinator marker to enter the foundation finalizer.
    PERFORM public.phase42_assert_operational_return_evidence_internal(
      p_operation_id, false
    );

    IF v_version = 402 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.phase42_return_settlement_guards guard_row
        WHERE guard_row.transaction_id = pg_current_xact_id()
          AND guard_row.operation_id = p_operation_id
          AND guard_row.return_event_id = v_event_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_COORDINATOR_REQUIRED: Operational Return settlement must use the atomic coordinator.';
      END IF;

    END IF;
  END IF;
  RETURN public.phase4_finalize_aftercare_operation_foundation_internal(
    p_operation_id
  );
END;
$$;

CREATE FUNCTION public.settle_sales_return_v1(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_items JSONB,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_actor_hash TEXT;
  v_key TEXT;
  v_canonical JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_order public.orders%ROWTYPE;
  v_order_item public.order_items%ROWTYPE;
  v_instance public.order_parcel_instances%ROWTYPE;
  v_component_row public.order_parcel_components%ROWTYPE;
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_shift_id UUID;
  v_product_ids UUID[];
  v_item JSONB;
  v_component JSONB;
  v_prepared_items JSONB := '[]'::JSONB;
  v_prepared_components JSONB;
  v_inventory_sources JSONB := '[]'::JSONB;
  v_operation_id UUID := gen_random_uuid();
  v_return_event_id UUID := gen_random_uuid();
  v_return_item_id UUID;
  v_return_number TEXT;
  v_scope TEXT;
  v_quantity INTEGER;
  v_accepted INTEGER;
  v_rejected INTEGER;
  v_accepted_total INTEGER;
  v_rejected_total INTEGER;
  v_actual_component_count INTEGER;
  v_prior_quantity INTEGER;
  v_prior_refund BIGINT;
  v_prior_cogs BIGINT;
  v_new_cumulative INTEGER;
  v_target_refund BIGINT;
  v_target_cogs BIGINT;
  v_item_refund BIGINT;
  v_item_cogs BIGINT;
  v_unit_cost_exact NUMERIC(24, 6);
  v_historical_value NUMERIC(30, 6);
  v_raw_damage BIGINT;
  v_applied_damage BIGINT;
  v_item_stock_disposition TEXT;
  v_total_entitlement BIGINT := 0;
  v_total_raw_damage BIGINT := 0;
  v_total_applied_damage BIGINT := 0;
  v_financial RECORD;
  v_debt_reduction BIGINT;
  v_money_refund BIGINT;
  v_method TEXT;
  v_reference TEXT;
  v_result JSONB;
  v_inventory_result JSONB;
  v_now TIMESTAMPTZ;
BEGIN
  -- Authorization deliberately precedes replay and every business lock.
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin'], 'تسوية مرتجع مبيعات Phase 4.2'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE42_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;

  v_key := public.phase4_canonicalize_idempotency_key_internal(
    p_idempotency_key
  );
  v_canonical := public.phase42_canonicalize_return_request_internal(
    p_order_id, p_items, p_reason, p_refund_method,
    p_reference_number, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);

  -- A committed operation is immutable truth and replays before 48-hour,
  -- Shift, payment, inventory or any other current-state eligibility check.
  v_replay := public.phase4_resolve_operation_replay_internal(
    'phase4_return_v1', v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  v_method := v_canonical->>'refund_method';
  v_reference := v_canonical->>'reference_number';
  v_shift_id := public.phase4_lock_customer_order_context_internal(
    p_order_id, v_method IS NOT NULL, false
  );

  SELECT customer_order.* INTO v_order
  FROM public.orders customer_order
  WHERE customer_order.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_ORIGINAL_SALE_INVALID: Return requires one completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation
  WHERE operation.id = v_order.operation_id
  FOR SHARE;
  IF v_creation_type NOT IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales use this coordinator.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    GROUP BY item->>'return_scope', item->>'order_item_id',
      COALESCE(item->>'parcel_instance_id', '')
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      COALESCE(item->'components', '[]'::JSONB)
    ) component
    GROUP BY component->>'parcel_component_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE42_RETURN_IDENTITY_DUPLICATE: Return source identities must be unique.';
  END IF;

  SELECT ARRAY_AGG(product_id ORDER BY product_id) INTO v_product_ids
  FROM (
    SELECT DISTINCT order_item.product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    JOIN public.order_items order_item
      ON order_item.id = (item->>'order_item_id')::UUID
      AND order_item.order_id = p_order_id
    WHERE item->>'return_scope' = 'base_unit'
    UNION
    SELECT DISTINCT parcel_component.product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items') item
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      COALESCE(item->'components', '[]'::JSONB)
    ) component
    JOIN public.order_parcel_components parcel_component
      ON parcel_component.id = (component->>'parcel_component_id')::UUID
    JOIN public.order_parcel_instances parcel_instance
      ON parcel_instance.id = parcel_component.parcel_instance_id
      AND parcel_instance.order_id = p_order_id
    WHERE item->>'return_scope' = 'parcel_instance'
  ) products
  WHERE product_id IS NOT NULL;
  IF COALESCE(CARDINALITY(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_RETURN_PRODUCTS_UNPROVEN: No authoritative returned SKU set was found.';
  END IF;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);

  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_WINDOW_EXPIRED: A new Return cannot be settled after the original 48-hour window.';
  END IF;

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'order_item_id', value->>'return_scope',
      COALESCE(value->>'parcel_instance_id', '')
  LOOP
    v_scope := v_item->>'return_scope';
    SELECT order_item.* INTO v_order_item
    FROM public.order_items order_item
    WHERE order_item.id = (v_item->>'order_item_id')::UUID
      AND order_item.order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'PHASE42_ORDER_ITEM_INVALID: Return item does not belong to the locked sale.';
    END IF;
    v_return_item_id := gen_random_uuid();

    IF v_scope = 'base_unit' THEN
      v_quantity := (v_item->>'quantity')::INTEGER;
      IF v_order_item.commercial_line_kind IS DISTINCT FROM 'base_unit'
        OR v_order_item.product_id IS NULL
        OR v_order_item.quantity <= 0
        OR v_order_item.net_refundable_amount_snapshot_in_minor_units IS NULL
        OR v_order_item.cogs_in_minor_units IS NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_BASE_SALE_EVIDENCE_MISSING: Base Unit sale evidence is incomplete.';
      END IF;

      SELECT COALESCE(SUM(item.returned_quantity), 0)::INTEGER,
        COALESCE(SUM(item.refund_amount_snapshot_in_minor_units), 0)::BIGINT,
        COALESCE(SUM(item.original_cogs_snapshot_in_minor_units), 0)::BIGINT
      INTO v_prior_quantity, v_prior_refund, v_prior_cogs
      FROM public.sales_return_items item
      JOIN public.sales_return_events event
        ON event.id = item.sales_return_event_id
      WHERE item.order_item_id = v_order_item.id
        AND item.return_scope = 'base_unit'
        AND event.settlement_status = 'settled';
      v_new_cumulative := v_prior_quantity + v_quantity;
      IF v_new_cumulative > v_order_item.quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Requested Base Unit quantity exceeds remaining Return capacity.';
      END IF;
      v_target_refund := CASE WHEN v_new_cumulative = v_order_item.quantity
        THEN v_order_item.net_refundable_amount_snapshot_in_minor_units
        ELSE FLOOR(
          v_order_item.net_refundable_amount_snapshot_in_minor_units::NUMERIC
            * v_new_cumulative::NUMERIC / v_order_item.quantity::NUMERIC
        )::BIGINT END;
      v_target_cogs := CASE WHEN v_new_cumulative = v_order_item.quantity
        THEN v_order_item.cogs_in_minor_units
        ELSE FLOOR(v_order_item.cogs_in_minor_units::NUMERIC
          * v_new_cumulative::NUMERIC / v_order_item.quantity::NUMERIC
        )::BIGINT END;
      v_item_refund := v_target_refund - v_prior_refund;
      v_item_cogs := v_target_cogs - v_prior_cogs;
      IF v_item_refund < 0 OR v_item_cogs < 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_CUMULATIVE_ALLOCATION_INVALID: Historical partial allocations are contradictory.';
      END IF;

      IF v_creation_type = 'phase3_customer_reservation_v1' THEN
        IF v_order_item.unit_cost_snapshot_in_minor_units_exact IS NULL
          OR v_order_item.exact_cogs_snapshot_in_minor_units IS NULL
          OR v_order_item.cost_finalized_at IS NULL
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Customer V2 exact historical cost is missing.';
        END IF;
        v_unit_cost_exact := v_order_item.unit_cost_snapshot_in_minor_units_exact;
      ELSE
        IF v_order_item.unit_cost_in_minor_units IS NULL THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: POS V2 historical cost is missing.';
        END IF;
        v_unit_cost_exact := v_order_item.unit_cost_in_minor_units::NUMERIC;
      END IF;
      v_item_stock_disposition := v_item->>'stock_disposition';
      IF v_item_stock_disposition = 'restock' THEN
        v_historical_value := ROUND(v_unit_cost_exact * v_quantity, 6);
        v_inventory_sources := v_inventory_sources || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'source_kind', 'base_order_item',
            'source_id', v_order_item.id,
            'return_item_id', v_return_item_id,
            'product_id', v_order_item.product_id,
            'quantity', v_quantity,
            'historical_value_exact', v_historical_value
          )
        );
      END IF;

      v_prepared_items := v_prepared_items || JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT(
          'id', v_return_item_id,
          'return_scope', 'base_unit',
          'order_item_id', v_order_item.id,
          'product_id', v_order_item.product_id,
          'returned_quantity', v_quantity,
          'refund_amount', v_item_refund,
          'stock_disposition', v_item_stock_disposition,
          'accepted_quantity', v_quantity,
          'rejected_quantity', 0,
          'original_cogs', v_item_cogs,
          'raw_damage', 0,
          'applied_damage', 0,
          'components', '[]'::JSONB
        )
      );
      v_total_entitlement := v_total_entitlement + v_item_refund;
    ELSE
      SELECT instance.* INTO v_instance
      FROM public.order_parcel_instances instance
      WHERE instance.id = (v_item->>'parcel_instance_id')::UUID
        AND instance.order_item_id = v_order_item.id
        AND instance.order_id = p_order_id
      FOR UPDATE;
      IF NOT FOUND
        OR v_order_item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
        OR v_instance.finalized_at IS NULL
        OR v_instance.net_refundable_amount_snapshot_in_minor_units IS NULL
        OR v_instance.cogs_snapshot_in_minor_units IS NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_SALE_EVIDENCE_MISSING: Parcel sale evidence is incomplete.';
      END IF;
      SELECT COUNT(*)::INTEGER INTO v_actual_component_count
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = v_instance.id;
      IF v_actual_component_count IS DISTINCT FROM
          JSONB_ARRAY_LENGTH(v_item->'components') THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_INSPECTION_INCOMPLETE: Every historical Parcel Component must be classified.';
      END IF;

      v_prepared_components := '[]'::JSONB;
      v_accepted_total := 0;
      v_rejected_total := 0;
      v_raw_damage := 0;
      v_item_stock_disposition := 'damaged';
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        SELECT component.* INTO v_component_row
        FROM public.order_parcel_components component
        WHERE component.id = (v_component->>'parcel_component_id')::UUID
          AND component.parcel_instance_id = v_instance.id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = '23503',
            MESSAGE = 'PHASE42_PARCEL_COMPONENT_INVALID: Component does not belong to the returned Parcel.';
        END IF;
        v_accepted := (v_component->>'accepted_quantity')::INTEGER;
        v_rejected := (v_component->>'rejected_quantity')::INTEGER;
        IF v_accepted + v_rejected IS DISTINCT FROM v_component_row.base_quantity
          OR (v_rejected > 0 AND
            v_component_row.effective_standalone_unit_sale_price_snapshot_in_minor_units
              IS NULL)
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID: Component quantity or historical effective standalone price is missing.';
        END IF;
        IF v_creation_type = 'phase3_customer_reservation_v1'
          AND (v_component_row.exact_cogs_snapshot_in_minor_units IS NULL
            OR v_component_row.cost_finalized_at IS NULL)
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Customer V2 Parcel exact historical cost is missing.';
        END IF;
        v_accepted_total := v_accepted_total + v_accepted;
        v_rejected_total := v_rejected_total + v_rejected;
        v_raw_damage := v_raw_damage + v_rejected::BIGINT
          * COALESCE(
            v_component_row.effective_standalone_unit_sale_price_snapshot_in_minor_units,
            0
          );
        IF v_accepted > 0
          AND v_component->>'accepted_condition' = 'sellable'
          AND v_component->>'accepted_stock_disposition' = 'restock'
        THEN
          v_item_stock_disposition := 'restock';
          v_unit_cost_exact := CASE
            WHEN v_component_row.exact_cogs_snapshot_in_minor_units IS NOT NULL
              THEN ROUND(v_component_row.exact_cogs_snapshot_in_minor_units
                / v_component_row.base_quantity::NUMERIC, 6)
            ELSE v_component_row.unit_cost_snapshot_in_minor_units
          END;
          IF v_unit_cost_exact IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001',
              MESSAGE = 'PHASE42_HISTORICAL_COST_MISSING: Parcel Component historical cost is missing.';
          END IF;
          v_inventory_sources := v_inventory_sources || JSONB_BUILD_ARRAY(
            JSONB_BUILD_OBJECT(
              'source_kind', 'parcel_component',
              'source_id', v_component_row.id,
              'return_item_id', v_return_item_id,
              'product_id', v_component_row.product_id,
              'quantity', v_accepted,
              'historical_value_exact', ROUND(v_unit_cost_exact * v_accepted, 6)
            )
          );
        END IF;
        v_prepared_components := v_prepared_components || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'parcel_component_id', v_component_row.id,
            'original_sale_operation_id', v_component_row.operation_id,
            'product_id', v_component_row.product_id,
            'original_quantity', v_component_row.base_quantity,
            'accepted_quantity', v_accepted,
            'rejected_quantity', v_rejected,
            'accepted_condition', v_component->>'accepted_condition',
            'accepted_stock_disposition',
              v_component->>'accepted_stock_disposition',
            'rejection_reason', v_component->>'rejection_reason',
            'rejected_stock_disposition',
              v_component->>'rejected_stock_disposition'
          )
        );
      END LOOP;
      IF v_accepted_total + v_rejected_total
          IS DISTINCT FROM v_instance.units_per_parcel_snapshot THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_PARCEL_INSPECTION_INCOMPLETE: Parcel inspection does not account for every historical Base Unit.';
      END IF;
      v_applied_damage := LEAST(
        v_instance.net_refundable_amount_snapshot_in_minor_units, v_raw_damage
      );
      v_item_refund :=
        v_instance.net_refundable_amount_snapshot_in_minor_units
          - v_applied_damage;
      v_prepared_items := v_prepared_items || JSONB_BUILD_ARRAY(
        JSONB_BUILD_OBJECT(
          'id', v_return_item_id,
          'return_scope', 'parcel_instance',
          'order_item_id', v_order_item.id,
          'parcel_instance_id', v_instance.id,
          'returned_quantity', 1,
          'refund_amount', v_item_refund,
          'stock_disposition', v_item_stock_disposition,
          'accepted_quantity', v_accepted_total,
          'rejected_quantity', v_rejected_total,
          'original_cogs', v_instance.cogs_snapshot_in_minor_units,
          'raw_damage', v_raw_damage,
          'applied_damage', v_applied_damage,
          'components', v_prepared_components
        )
      );
      v_total_entitlement := v_total_entitlement + v_item_refund;
      v_total_raw_damage := v_total_raw_damage + v_raw_damage;
      v_total_applied_damage := v_total_applied_damage + v_applied_damage;
    END IF;
  END LOOP;

  SELECT * INTO v_financial
  FROM public.phase42_order_financial_position_internal(p_order_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_FINANCIAL_POSITION_UNAVAILABLE: Locked sale financial position is unavailable.';
  END IF;
  v_debt_reduction := LEAST(
    v_total_entitlement, v_financial.merchandise_debt_in_minor_units
  );
  v_money_refund := v_total_entitlement - v_debt_reduction;
  IF v_money_refund > v_financial.refundable_collected_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_FINANCIAL_EVIDENCE_CONTRADICTORY: Return exceeds same-sale refundable collected funds.';
  END IF;
  IF (v_money_refund = 0 AND (v_method IS NOT NULL OR v_reference IS NOT NULL))
    OR (v_money_refund > 0 AND (
      v_method IS NULL OR v_method NOT IN ('cash', 'cliq')
      OR v_shift_id IS NULL
      OR (v_method = 'cliq' AND v_reference IS NULL)
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_REFUND_METHOD_INVALID: Refund method must match the authoritative monetary outcome.';
  END IF;

  v_now := clock_timestamp();
  -- Do not consume a non-transactional sequence: an injected failure must
  -- leave no externally visible Return-number side effect. The operation UUID
  -- is already unique and transaction-local until commit.
  v_return_number := 'SRT4-' || TO_CHAR(v_now, 'YYYYMMDD') || '-'
    || UPPER(SUBSTRING(REPLACE(v_operation_id::TEXT, '-', '') FROM 1 FOR 12));
  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'idempotentReplay', false,
    'operationId', v_operation_id,
    'returnId', v_return_event_id,
    'returnNumber', v_return_number,
    'orderId', p_order_id,
    'merchandiseEntitlementInMinorUnits', v_total_entitlement,
    'debtReductionInMinorUnits', v_debt_reduction,
    'moneyRefundInMinorUnits', v_money_refund,
    'refundMethod', CASE WHEN v_money_refund > 0 THEN v_method END,
    'deliveryRefundInMinorUnits', 0,
    'taxRefundInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_return_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );

  INSERT INTO public.sales_return_events(
    id, return_number, operation_id, order_id, branch_id, warehouse_id,
    cash_shift_id, reason, refund_method,
    merchandise_refund_amount_in_minor_units, reference_number, notes,
    created_by, contract_version, settlement_status,
    outstanding_debt_before_snapshot_in_minor_units,
    net_collected_before_snapshot_in_minor_units,
    debt_reduction_amount_in_minor_units,
    money_refund_amount_in_minor_units,
    raw_customer_damage_deduction_in_minor_units,
    applied_customer_damage_deduction_in_minor_units,
    settlement_coordinator_version
  ) VALUES (
    v_return_event_id, v_return_number, v_operation_id, p_order_id,
    v_order.branch_id, v_order.warehouse_id,
    CASE WHEN v_money_refund > 0 THEN v_shift_id END,
    v_canonical->>'reason', CASE WHEN v_money_refund > 0 THEN v_method END,
    v_total_entitlement,
    CASE WHEN v_money_refund > 0 AND v_method = 'cliq'
      THEN v_reference END,
    v_canonical->>'notes', v_user_id, 401, 'draft',
    v_financial.merchandise_debt_in_minor_units,
    v_financial.refundable_collected_in_minor_units,
    v_debt_reduction, v_money_refund, v_total_raw_damage,
    v_total_applied_damage, 402
  );

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared_items)
    ORDER BY value->>'order_item_id', value->>'id'
  LOOP
    INSERT INTO public.sales_return_items(
      id, sales_return_event_id, operation_id, order_id, order_item_id,
      return_scope, parcel_instance_id, product_id, returned_quantity,
      refund_amount_snapshot_in_minor_units, stock_disposition,
      accepted_base_quantity, rejected_base_quantity,
      original_cogs_snapshot_in_minor_units,
      raw_customer_damage_deduction_in_minor_units,
      applied_customer_damage_deduction_in_minor_units
    ) VALUES (
      (v_item->>'id')::UUID, v_return_event_id, v_operation_id, p_order_id,
      (v_item->>'order_item_id')::UUID, v_item->>'return_scope',
      (v_item->>'parcel_instance_id')::UUID,
      (v_item->>'product_id')::UUID,
      (v_item->>'returned_quantity')::INTEGER,
      (v_item->>'refund_amount')::BIGINT,
      v_item->>'stock_disposition',
      (v_item->>'accepted_quantity')::INTEGER,
      (v_item->>'rejected_quantity')::INTEGER,
      (v_item->>'original_cogs')::BIGINT,
      (v_item->>'raw_damage')::BIGINT,
      (v_item->>'applied_damage')::BIGINT
    );

    IF v_item->>'return_scope' = 'base_unit' THEN
      INSERT INTO public.sales_aftercare_consumptions(
        operation_id, return_item_id, source_kind, source_id, product_id,
        consumed_quantity, consumption_kind
      ) VALUES (
        v_operation_id, (v_item->>'id')::UUID, 'base_order_item',
        (v_item->>'order_item_id')::UUID, (v_item->>'product_id')::UUID,
        (v_item->>'returned_quantity')::INTEGER, 'return'
      );
    ELSE
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        INSERT INTO public.sales_return_component_inspections(
          sales_return_item_id, return_operation_id, parcel_component_id,
          original_sale_operation_id, product_id, accepted_quantity,
          rejected_quantity, accepted_condition,
          accepted_stock_disposition, rejection_reason,
          rejected_stock_disposition
        ) VALUES (
          (v_item->>'id')::UUID, v_operation_id,
          (v_component->>'parcel_component_id')::UUID,
          (v_component->>'original_sale_operation_id')::UUID,
          (v_component->>'product_id')::UUID,
          (v_component->>'accepted_quantity')::INTEGER,
          (v_component->>'rejected_quantity')::INTEGER,
          v_component->>'accepted_condition',
          v_component->>'accepted_stock_disposition',
          v_component->>'rejection_reason',
          v_component->>'rejected_stock_disposition'
        );
        INSERT INTO public.sales_aftercare_consumptions(
          operation_id, return_item_id, source_kind, source_id, product_id,
          consumed_quantity, consumption_kind
        ) VALUES (
          v_operation_id, (v_item->>'id')::UUID, 'parcel_component',
          (v_component->>'parcel_component_id')::UUID,
          (v_component->>'product_id')::UUID,
          (v_component->>'original_quantity')::INTEGER, 'return'
        );
      END LOOP;
    END IF;
  END LOOP;

  IF v_money_refund > 0 THEN
    UPDATE public.cash_shifts
    SET cash_refunds_in_minor_units = cash_refunds_in_minor_units
        + CASE WHEN v_method = 'cash' THEN v_money_refund ELSE 0 END,
      cliq_refunds_in_minor_units = cliq_refunds_in_minor_units
        + CASE WHEN v_method = 'cliq' THEN v_money_refund ELSE 0 END,
      updated_at = clock_timestamp()
    WHERE id = v_shift_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '40001',
        MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Refund Shift is no longer open.';
    END IF;
  END IF;

  v_inventory_result := public.phase42_apply_return_inventory_internal(
    v_operation_id, v_return_event_id, v_order.warehouse_id,
    v_inventory_sources, v_user_id
  );

  INSERT INTO public.phase42_return_settlement_guards(
    transaction_id, operation_id, return_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_return_event_id);

  INSERT INTO public.phase42_return_settlement_evidence(
    operation_id, return_event_id, order_id, result_snapshot,
    inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_return_event_id, p_order_id, v_result,
    public.phase42_inventory_effects_snapshot_internal(v_operation_id)
  );

  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase42_return_settlement_guards
  WHERE transaction_id = pg_current_xact_id()
    AND operation_id = v_operation_id;

  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id, 'SETTLE_PHASE42_SALES_RETURN', 'sales_return_events',
    v_return_event_id, JSONB_BUILD_OBJECT(
      'operation_id', v_operation_id,
      'order_id', p_order_id,
      'debt_reduction_in_minor_units', v_debt_reduction,
      'money_refund_in_minor_units', v_money_refund,
      'refund_method', CASE WHEN v_money_refund > 0 THEN v_method END,
      'inventory_effects', v_inventory_result
    )
  );
  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------------
-- Receivable read-model integration. Historical order totals and amount_paid
-- remain immutable; every operational balance is derived from the same
-- Phase-4.2 projection used by payment and Return settlement.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.phase42_customer_receivable_total_internal(
  p_customer_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(position.outstanding_total_in_minor_units), 0)::BIGINT
  FROM public.orders customer_order
  CROSS JOIN LATERAL public.phase42_order_financial_position_internal(
    customer_order.id
  ) position
  WHERE customer_order.customer_id = p_customer_id
    AND customer_order.status IN ('completed', 'delivered')
    AND (
      COALESCE(customer_order.source, 'website') <> 'pos'
      OR customer_order.payment_method = 'debt'
    );
$$;

CREATE OR REPLACE FUNCTION public.get_customer_outstanding_orders_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض ذمم العملاء'
  );
  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH outstanding_orders AS (
      SELECT customer_order.id, customer_order.order_number,
        customer_order.customer_id, customer_order.customer_name_snapshot,
        customer_order.source, customer_order.payment_method,
        customer_order.total_in_minor_units,
        customer_order.amount_paid_in_minor_units,
        customer_order.payment_status, customer_order.created_at,
        customer.full_name AS customer_name,
        customer.phone AS customer_phone,
        position.outstanding_total_in_minor_units AS amount_due_in_minor_units
      FROM public.orders customer_order
      JOIN public.customers customer
        ON customer.id = customer_order.customer_id
      CROSS JOIN LATERAL public.phase42_order_financial_position_internal(
        customer_order.id
      ) position
      WHERE customer_order.status IN ('completed', 'delivered')
        AND position.outstanding_total_in_minor_units > 0
        AND (
          COALESCE(customer_order.source, 'website') <> 'pos'
          OR customer_order.payment_method = 'debt'
        )
        AND (
          v_search IS NULL
          OR customer_order.order_number ILIKE '%' || v_search || '%'
          OR COALESCE(
            customer.full_name, customer_order.customer_name_snapshot, ''
          ) ILIKE '%' || v_search || '%'
          OR COALESCE(customer.phone, '') ILIKE '%' || v_search || '%'
        )
    ), paged_orders AS (
      SELECT * FROM outstanding_orders
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset LIMIT v_page_size
    ), summary AS (
      SELECT COUNT(*)::INTEGER AS total_count,
        COUNT(DISTINCT customer_id)::INTEGER AS customer_count,
        COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT
          AS due_in_minor_units
      FROM outstanding_orders
    )
    SELECT JSONB_BUILD_OBJECT(
      'orders', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', id, 'order_number', order_number,
          'customer_id', customer_id,
          'customer_name', COALESCE(
            customer_name, customer_name_snapshot, 'عميل مسجل'
          ),
          'customer_phone', COALESCE(customer_phone, ''),
          'source', source, 'payment_method', payment_method,
          'total_in_minor_units', total_in_minor_units,
          'amount_paid_in_minor_units', amount_paid_in_minor_units,
          'amount_due_in_minor_units', amount_due_in_minor_units,
          'payment_status', payment_status, 'created_at', created_at
        ) ORDER BY created_at DESC, id DESC)
        FROM paged_orders
      ), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', JSONB_BUILD_OBJECT(
        'customer_count', summary.customer_count,
        'due_in_minor_units', summary.due_in_minor_units
      )
    ) FROM summary
  );
END;
$$;

ALTER FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT)
  RENAME TO _get_crm_customer_page_before_phase42_receivables;
REVOKE ALL ON FUNCTION public._get_crm_customer_page_before_phase42_receivables(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_crm_customer_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 10,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'latest'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_customers JSONB;
BEGIN
  v_result := public._get_crm_customer_page_before_phase42_receivables(
    p_page, p_page_size, p_search, p_status, p_sort
  );
  SELECT COALESCE(JSONB_AGG(
    customer_row.value || JSONB_BUILD_OBJECT(
      'current_balance_in_minor_units',
      public.phase42_customer_receivable_total_internal(
        (customer_row.value->>'id')::UUID
      )
    ) ORDER BY customer_row.ordinality
  ), '[]'::JSONB)
  INTO v_customers
  FROM JSONB_ARRAY_ELEMENTS(COALESCE(v_result->'customers', '[]'::JSONB))
    WITH ORDINALITY customer_row(value, ordinality);
  RETURN JSONB_SET(v_result, '{customers}', v_customers, true);
END;
$$;

ALTER FUNCTION public.get_crm_customer_detail_page(UUID, INTEGER, INTEGER)
  RENAME TO _get_crm_customer_detail_page_before_phase42_receivables;
REVOKE ALL ON FUNCTION public._get_crm_customer_detail_page_before_phase42_receivables(
  UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_crm_customer_detail_page(
  p_customer_id UUID,
  p_history_page INTEGER DEFAULT 1,
  p_history_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_orders JSONB;
BEGIN
  v_result := public._get_crm_customer_detail_page_before_phase42_receivables(
    p_customer_id, p_history_page, p_history_page_size
  );
  SELECT COALESCE(JSONB_AGG(
    order_row.value || JSONB_BUILD_OBJECT(
      'amount_due_in_minor_units', CASE
        WHEN order_row.value->>'status' IN ('completed', 'delivered')
          THEN COALESCE((SELECT position.outstanding_total_in_minor_units
            FROM public.phase42_order_financial_position_internal(
              (order_row.value->>'id')::UUID
            ) position), 0)
        ELSE 0
      END
    ) ORDER BY order_row.ordinality
  ), '[]'::JSONB)
  INTO v_orders
  FROM JSONB_ARRAY_ELEMENTS(COALESCE(v_result->'orders', '[]'::JSONB))
    WITH ORDINALITY order_row(value, ordinality);
  v_result := JSONB_SET(v_result, '{orders}', v_orders, true);
  v_result := JSONB_SET(
    v_result, '{stats,outstanding_in_minor_units}',
    TO_JSONB(public.phase42_customer_receivable_total_internal(p_customer_id)),
    true
  );
  RETURN v_result;
END;
$$;

-- --------------------------------------------------------------------------
-- Existing-entrypoint alignment.  Modern Phase-3 sales must use the atomic
-- coordinator, customer payments must respect Return-adjusted receivables,
-- and a Shift containing a settled Phase-4.2 cash/CliQ refund cannot be
-- reversed independently from that immutable settlement.
-- --------------------------------------------------------------------------

ALTER FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) RENAME TO _return_completed_website_order_before_phase42_coordinator;
REVOKE ALL ON FUNCTION public._return_completed_website_order_before_phase42_coordinator(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.return_completed_website_order(
  p_order_id UUID,
  p_reason TEXT,
  p_stock_disposition TEXT,
  p_refund_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_creation_type TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'تسجيل مرتجع مبيعات ورد المبلغ'
  );
  PERFORM public.phase4_lock_customer_order_context_internal(
    p_order_id, true, true
  );

  SELECT operation.operation_type
  INTO v_creation_type
  FROM public.orders customer_order
  JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE customer_order.id = p_order_id;

  IF v_creation_type IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_COORDINATOR_REQUIRED: Phase-3 V2 sales must use settle_sales_return_v1.';
  END IF;

  RETURN public._return_completed_website_order_before_phase42_coordinator(
    p_order_id, p_reason, p_stock_disposition, p_refund_method,
    p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

ALTER FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) RENAME TO _record_customer_order_payment_before_phase42_financial_guard;
REVOKE ALL ON FUNCTION public._record_customer_order_payment_before_phase42_financial_guard(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_customer_order_payment(
  p_order_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_position RECORD;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'تسجيل دفعة عميل'
  );
  PERFORM public.phase4_lock_customer_order_context_internal(
    p_order_id,
    LOWER(COALESCE(p_payment_method, '')) IN ('cash', 'cliq'),
    false
  );
  SELECT * INTO v_position
  FROM public.phase42_order_financial_position_internal(p_order_id);

  IF COALESCE(p_amount_in_minor_units, 0) <= 0
    OR p_amount_in_minor_units > v_position.outstanding_total_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_CUSTOMER_PAYMENT_EXCEEDS_EFFECTIVE_OUTSTANDING: Payment exceeds the Return-adjusted receivable.';
  END IF;

  RETURN public._record_customer_order_payment_before_phase42_financial_guard(
    p_order_id, p_amount_in_minor_units, p_payment_method,
    p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;

ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  RENAME TO _reverse_cash_shift_with_operations_before_phase42_refund_guard;
REVOKE ALL ON FUNCTION public._reverse_cash_shift_with_operations_before_phase42_refund_guard(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reverse_cash_shift_with_operations(
  p_shift_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_reversal_owner(
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

  RETURN public._reverse_cash_shift_with_operations_before_phase42_refund_guard(
    p_shift_id, p_reason, p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  TO authenticated;

-- --------------------------------------------------------------------------
-- Least privilege and migration ownership.
-- --------------------------------------------------------------------------

ALTER TABLE public.phase42_return_inventory_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase42_return_inventory_effects
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.phase42_return_inventory_effects TO authenticated;
CREATE POLICY "Active ERP staff can read Phase 4.2 Return inventory effects"
ON public.phase42_return_inventory_effects
FOR SELECT TO authenticated
USING ((SELECT public.is_active_erp_staff()));

REVOKE ALL ON TABLE public.phase42_return_settlement_guards
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.phase42_return_settlement_evidence
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.phase42_guard_return_coordinator_version()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_guard_inventory_effect_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_guard_settlement_evidence()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_inventory_effects_snapshot_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_expected_return_inventory_effects_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_assert_operational_return_evidence_internal(
  UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_require_evidence_before_return_settlement()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_canonicalize_return_request_internal(
  UUID, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_order_financial_position_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_customer_receivable_total_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase42_apply_return_inventory_internal(
  UUID, UUID, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_sales_return_v1(
  UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sales_return_v1(
  UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_outstanding_orders_page(
  INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_outstanding_orders_page(
  INTEGER, INTEGER, TEXT
) TO authenticated;
REVOKE ALL ON FUNCTION public.get_crm_customer_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) TO authenticated;
REVOKE ALL ON FUNCTION public.get_crm_customer_detail_page(
  UUID, INTEGER, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_detail_page(
  UUID, INTEGER, INTEGER
) TO authenticated;

ALTER TABLE public.phase42_return_settlement_guards OWNER TO postgres;
ALTER TABLE public.phase42_return_settlement_evidence OWNER TO postgres;
ALTER TABLE public.phase42_return_inventory_effects OWNER TO postgres;
ALTER FUNCTION public.phase42_guard_return_coordinator_version() OWNER TO postgres;
ALTER FUNCTION public.phase42_guard_inventory_effect_history() OWNER TO postgres;
ALTER FUNCTION public.phase42_guard_settlement_evidence() OWNER TO postgres;
ALTER FUNCTION public.phase42_inventory_effects_snapshot_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase42_expected_return_inventory_effects_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase42_assert_operational_return_evidence_internal(
  UUID, BOOLEAN
) OWNER TO postgres;
ALTER FUNCTION public.phase42_require_evidence_before_return_settlement()
  OWNER TO postgres;
ALTER FUNCTION public.phase42_canonicalize_return_request_internal(
  UUID, JSONB, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.phase42_order_financial_position_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase42_customer_receivable_total_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase42_apply_return_inventory_internal(
  UUID, UUID, UUID, JSONB, UUID
) OWNER TO postgres;
ALTER FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase4_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.settle_sales_return_v1(
  UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.get_customer_outstanding_orders_page(
  INTEGER, INTEGER, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.get_crm_customer_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.get_crm_customer_detail_page(UUID, INTEGER, INTEGER)
  OWNER TO postgres;

COMMENT ON FUNCTION public.settle_sales_return_v1(
  UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT
) IS 'Atomic Phase 4.2 Return coordinator: replay-first, root-serialized, debt-first, exact inventory/WAC and immutable outcome.';

COMMIT;
