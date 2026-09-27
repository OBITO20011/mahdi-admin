BEGIN;

-- Phase 4.3: operational Replacement issuance and one authoritative Admin
-- aftercare boundary.  Phase 4.1 foundation settlement remains historical
-- truth, but it is not evidence that sellable inventory was issued.

ALTER TABLE public.sales_replacement_events
  ADD COLUMN issuance_coordinator_version SMALLINT,
  ADD COLUMN issuance_status TEXT NOT NULL DEFAULT 'not_issued'
    CHECK (issuance_status IN ('not_issued', 'issued')),
  ADD COLUMN issued_at TIMESTAMPTZ,
  ADD CONSTRAINT sales_replacement_events_operational_issuance_check CHECK (
    (issuance_status = 'not_issued' AND issued_at IS NULL)
    OR (
      issuance_status = 'issued'
      AND issued_at IS NOT NULL
      AND issuance_coordinator_version IS NOT DISTINCT FROM 403
      AND replacement_status = 'settled'
      AND settled_at IS NOT NULL
    )
  );

COMMENT ON COLUMN public.sales_replacement_events.issuance_coordinator_version IS
  '403 identifies an operational Phase 4.3 issuance. NULL is foundation-only evidence and never proves inventory outflow.';

CREATE TABLE public.phase43_replacement_issuance_guards (
  transaction_id XID8 NOT NULL,
  operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE CASCADE,
  replacement_event_id UUID NOT NULL REFERENCES public.sales_replacement_events(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, operation_id),
  UNIQUE (transaction_id, replacement_event_id)
);

CREATE TABLE public.phase43_replacement_inventory_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  replacement_event_id UUID NOT NULL REFERENCES public.sales_replacement_events(id) ON DELETE RESTRICT,
  replacement_item_id UUID NOT NULL REFERENCES public.sales_replacement_items(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  inventory_movement_id UUID NOT NULL UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('base_order_item', 'parcel_component', 'replacement_item')),
  source_id UUID NOT NULL,
  issued_quantity INTEGER NOT NULL CHECK (issued_quantity > 0),
  replacement_unit_cost_snapshot_in_minor_units_exact NUMERIC(24, 6) NOT NULL
    CHECK (replacement_unit_cost_snapshot_in_minor_units_exact >= 0),
  replacement_cogs_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (replacement_cogs_snapshot_in_minor_units >= 0),
  target_balance_before INTEGER NOT NULL CHECK (target_balance_before >= 0),
  target_balance_after INTEGER NOT NULL CHECK (target_balance_after >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operation_id, replacement_item_id),
  UNIQUE (replacement_event_id, replacement_item_id),
  CHECK (target_balance_after = target_balance_before - issued_quantity)
);

CREATE TABLE public.phase43_replacement_settlement_evidence (
  operation_id UUID PRIMARY KEY REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  replacement_event_id UUID NOT NULL UNIQUE REFERENCES public.sales_replacement_events(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  result_snapshot JSONB NOT NULL CHECK (JSONB_TYPEOF(result_snapshot) = 'object'),
  inventory_effects_snapshot JSONB NOT NULL
    CHECK (JSONB_TYPEOF(inventory_effects_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Extend the Phase 4.1 immutable-history guard with one coordinator-bound
-- not_issued -> issued transition. All original cancellation/finalization
-- rules remain unchanged.
CREATE OR REPLACE FUNCTION public.guard_phase4_replacement_event_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Replacement evidence cannot be deleted.';
  END IF;
  IF CURRENT_SETTING('nawasrah.phase4_cancellation_operation_id', true) = OLD.operation_id::TEXT
    AND OLD.replacement_status = 'draft' AND NEW.replacement_status = 'cancelled'
    AND NEW.settled_at IS NULL
    AND NEW.issuance_status IS NOT DISTINCT FROM OLD.issuance_status
    AND NEW.issuance_coordinator_version IS NOT DISTINCT FROM OLD.issuance_coordinator_version
    AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at
    AND ROW(NEW.id,NEW.operation_id,NEW.root_order_id,NEW.branch_id,NEW.warehouse_id,
      NEW.contract_version,NEW.original_completed_at_snapshot,NEW.reason,NEW.created_by,NEW.created_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.root_order_id,OLD.branch_id,OLD.warehouse_id,
      OLD.contract_version,OLD.original_completed_at_snapshot,OLD.reason,OLD.created_by,OLD.created_at)
  THEN RETURN NEW; END IF;
  IF CURRENT_SETTING('nawasrah.phase4_finalization_operation_id', true) = OLD.operation_id::TEXT
    AND OLD.replacement_status = 'draft' AND NEW.replacement_status = 'settled'
    AND NEW.settled_at IS NOT NULL
    AND NEW.issuance_status IS NOT DISTINCT FROM OLD.issuance_status
    AND NEW.issuance_coordinator_version IS NOT DISTINCT FROM OLD.issuance_coordinator_version
    AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at
    AND ROW(NEW.id,NEW.operation_id,NEW.root_order_id,NEW.branch_id,NEW.warehouse_id,
      NEW.contract_version,NEW.original_completed_at_snapshot,NEW.reason,NEW.created_by,NEW.created_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.root_order_id,OLD.branch_id,OLD.warehouse_id,
      OLD.contract_version,OLD.original_completed_at_snapshot,OLD.reason,OLD.created_by,OLD.created_at)
  THEN RETURN NEW; END IF;
  IF OLD.replacement_status = 'settled' AND NEW.replacement_status = 'settled'
    AND OLD.settled_at IS NOT DISTINCT FROM NEW.settled_at
    AND OLD.issuance_status = 'not_issued' AND NEW.issuance_status = 'issued'
    AND NEW.issued_at IS NOT NULL AND NEW.issuance_coordinator_version = 403
    AND EXISTS (
      SELECT 1 FROM public.phase43_replacement_issuance_guards guard_row
      WHERE guard_row.transaction_id = pg_current_xact_id()
        AND guard_row.operation_id = OLD.operation_id
        AND guard_row.replacement_event_id = OLD.id
    )
    AND ROW(NEW.id,NEW.operation_id,NEW.root_order_id,NEW.branch_id,NEW.warehouse_id,
      NEW.contract_version,NEW.original_completed_at_snapshot,NEW.reason,NEW.created_by,NEW.created_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.root_order_id,OLD.branch_id,OLD.warehouse_id,
      OLD.contract_version,OLD.original_completed_at_snapshot,OLD.reason,OLD.created_by,OLD.created_at)
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Replacement evidence may change only at a protected finalization or issuance boundary.';
END;
$$;

CREATE UNIQUE INDEX uq_phase43_replacement_inventory_movement
  ON public.inventory_movements(reference_type, reference_id, product_id, operation_id)
  WHERE reference_type = 'phase4_replacement_item';

CREATE FUNCTION public.phase43_guard_immutable_replacement_effect()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Replacement inventory effect evidence cannot be changed.';
END;
$$;

CREATE TRIGGER trg_phase43_guard_replacement_effect_history
BEFORE UPDATE OR DELETE ON public.phase43_replacement_inventory_effects
FOR EACH ROW EXECUTE FUNCTION public.phase43_guard_immutable_replacement_effect();

CREATE FUNCTION public.phase43_guard_replacement_settlement_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Replacement settlement evidence cannot be changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.phase43_replacement_issuance_guards guard_row
    WHERE guard_row.transaction_id = pg_current_xact_id()
      AND guard_row.operation_id = NEW.operation_id
      AND guard_row.replacement_event_id = NEW.replacement_event_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_COORDINATOR_REQUIRED: Durable Replacement evidence requires the operational coordinator.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase43_guard_replacement_settlement_evidence
BEFORE INSERT OR UPDATE OR DELETE ON public.phase43_replacement_settlement_evidence
FOR EACH ROW EXECUTE FUNCTION public.phase43_guard_replacement_settlement_evidence();

CREATE FUNCTION public.phase43_inventory_effects_snapshot_internal(p_operation_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    JSONB_AGG(TO_JSONB(effect) ORDER BY effect.product_id, effect.replacement_item_id),
    '[]'::JSONB
  )
  FROM public.phase43_replacement_inventory_effects effect
  WHERE effect.operation_id = p_operation_id;
$$;

CREATE FUNCTION public.phase43_canonicalize_replacement_request_internal(
  p_order_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items JSONB;
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
BEGIN
  IF p_order_id IS NULL OR v_reason IS NULL
    OR JSONB_TYPEOF(p_items) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_items) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_REPLACEMENT_REQUEST_INVALID: Order, reason and non-empty items are required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_items) item
    WHERE JSONB_TYPEOF(item) IS DISTINCT FROM 'object'
      OR item->>'sourceKind' NOT IN ('base_order_item', 'parcel_component', 'replacement_item')
      OR COALESCE(item->>'sourceId', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      OR COALESCE(item->>'quantity', '') !~ '^[1-9][0-9]*$'
      OR (item - ARRAY['sourceKind', 'sourceId', 'quantity']) <> '{}'::JSONB
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_REPLACEMENT_ITEM_INVALID: Each item requires one supported immutable source and positive quantity.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'source_kind', item->>'sourceKind',
    'source_id', LOWER(item->>'sourceId'),
    'quantity', (item->>'quantity')::INTEGER
  ) ORDER BY item->>'sourceKind', LOWER(item->>'sourceId'))
  INTO v_items
  FROM JSONB_ARRAY_ELEMENTS(p_items) item;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_items) item
    GROUP BY item->>'source_kind', item->>'source_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_REPLACEMENT_SOURCE_DUPLICATE: Replacement source identities must be unique.';
  END IF;

  RETURN JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
    'order_id', LOWER(p_order_id::TEXT),
    'items', v_items,
    'reason', v_reason,
    'notes', v_notes,
    'operational_coordinator_version', 403
  ));
END;
$$;

CREATE FUNCTION public.phase43_assert_operational_replacement_evidence_internal(
  p_operation_id UUID,
  p_require_issued BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_event public.sales_replacement_events%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_evidence public.phase43_replacement_settlement_evidence%ROWTYPE;
  v_actual JSONB;
  v_expected_count INTEGER;
  v_actual_count INTEGER;
  v_covered_item_count INTEGER;
  v_effect_count INTEGER;
  v_movement_count INTEGER;
  v_consumption_count INTEGER;
  v_operation_consumption_count INTEGER;
  v_request_count INTEGER;
  v_issued_quantity INTEGER;
  v_replacement_cogs BIGINT;
BEGIN
  IF p_require_issued IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_REPLACEMENT_EVIDENCE_MISMATCH: Evidence lifecycle requirement is missing.';
  END IF;
  SELECT * INTO v_operation FROM public.business_operations operation
  WHERE operation.id = p_operation_id;
  SELECT * INTO v_event FROM public.sales_replacement_events event
  WHERE event.operation_id = p_operation_id;
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = v_event.root_order_id;
  IF NOT FOUND OR v_operation.operation_type IS DISTINCT FROM 'phase4_replacement_v1'
    OR v_operation.request_identity_version IS DISTINCT FROM 401
    OR (v_operation.result_snapshot->>'operationalCoordinatorVersion')::INTEGER IS DISTINCT FROM 403
    OR v_event.contract_version IS DISTINCT FROM 401
    OR v_event.issuance_coordinator_version IS DISTINCT FROM 403
    OR v_event.branch_id IS DISTINCT FROM v_order.branch_id
    OR v_event.warehouse_id IS DISTINCT FROM v_order.warehouse_id
    OR v_event.created_by IS DISTINCT FROM v_operation.initiated_by
    OR JSONB_TYPEOF(v_operation.request_identity_snapshot) IS DISTINCT FROM 'object'
    OR (v_operation.request_identity_snapshot->>'order_id')::UUID
      IS DISTINCT FROM v_event.root_order_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_OPERATIONAL_REPLACEMENT_UNPROVEN: Replacement coordinator identity is incomplete.';
  END IF;

  SELECT * INTO v_evidence FROM public.phase43_replacement_settlement_evidence evidence
  WHERE evidence.operation_id = p_operation_id;
  v_actual := public.phase43_inventory_effects_snapshot_internal(p_operation_id);
  IF NOT FOUND
    OR v_evidence.replacement_event_id IS DISTINCT FROM v_event.id
    OR v_evidence.order_id IS DISTINCT FROM v_event.root_order_id
    OR v_evidence.result_snapshot IS DISTINCT FROM v_operation.result_snapshot
    OR v_evidence.inventory_effects_snapshot IS DISTINCT FROM v_actual
    OR JSONB_TYPEOF(v_operation.result_snapshot) IS DISTINCT FROM 'object'
    OR (v_operation.result_snapshot->>'success')::BOOLEAN IS DISTINCT FROM true
    OR (v_operation.result_snapshot->>'idempotentReplay')::BOOLEAN IS DISTINCT FROM false
    OR (v_operation.result_snapshot->>'operationId')::UUID IS DISTINCT FROM v_operation.id
    OR (v_operation.result_snapshot->>'replacementId')::UUID IS DISTINCT FROM v_event.id
    OR (v_operation.result_snapshot->>'orderId')::UUID IS DISTINCT FROM v_event.root_order_id
    OR (v_operation.result_snapshot->>'operationalCoordinatorVersion')::INTEGER
      IS DISTINCT FROM 403
    OR (v_operation.result_snapshot->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM 0
    OR (v_operation.result_snapshot->>'debtReductionInMinorUnits')::BIGINT IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_REPLACEMENT_EVIDENCE_MISMATCH: Durable Replacement evidence does not match the operation.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_expected_count
  FROM public.sales_replacement_items item
  WHERE item.operation_id = p_operation_id;
  SELECT JSONB_ARRAY_LENGTH(v_operation.request_identity_snapshot->'items')
  INTO v_request_count;

  -- Operational issuance creates exactly one consumption per immutable item.
  -- Row UUID is not its business identity: (operation_id, replacement_item_id)
  -- is. Check both directions before joins can multiply A and hide missing B.
  IF EXISTS (
    SELECT 1 FROM public.sales_replacement_items item
    WHERE item.operation_id = p_operation_id
      AND (SELECT COUNT(*) FROM public.sales_aftercare_consumptions consumption
        WHERE consumption.operation_id = p_operation_id
          AND consumption.replacement_item_id = item.id) <> 1
  ) OR EXISTS (
    SELECT 1 FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.operation_id = p_operation_id
      AND NOT EXISTS (
        SELECT 1 FROM public.sales_replacement_items item
        WHERE item.operation_id = p_operation_id
          AND item.id = consumption.replacement_item_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE: Each authoritative item requires exactly one owned consumption.';
  END IF;

  SELECT COUNT(*)::INTEGER, COUNT(DISTINCT item.id)::INTEGER,
    COALESCE(SUM(effect.issued_quantity), 0)::INTEGER,
    COALESCE(SUM(effect.replacement_cogs_snapshot_in_minor_units), 0)::BIGINT
  INTO v_actual_count, v_covered_item_count, v_issued_quantity, v_replacement_cogs
  FROM public.phase43_replacement_inventory_effects effect
  JOIN public.sales_replacement_items item
    ON item.id = effect.replacement_item_id
    AND item.operation_id = effect.operation_id
    AND item.replacement_event_id = effect.replacement_event_id
    AND item.product_id = effect.product_id
    AND item.quantity = effect.issued_quantity
    AND item.replacement_unit_cost_snapshot_in_minor_units_exact
      = effect.replacement_unit_cost_snapshot_in_minor_units_exact
    AND item.replacement_cogs_snapshot_in_minor_units
      = effect.replacement_cogs_snapshot_in_minor_units
    AND item.replacement_cogs_snapshot_in_minor_units
      = ROUND(item.replacement_unit_cost_snapshot_in_minor_units_exact * item.quantity)::BIGINT
    AND effect.replacement_cogs_snapshot_in_minor_units
      = ROUND(effect.replacement_unit_cost_snapshot_in_minor_units_exact
        * effect.issued_quantity)::BIGINT
  JOIN public.sales_aftercare_consumptions consumption
    ON consumption.operation_id = effect.operation_id
    AND consumption.replacement_item_id = effect.replacement_item_id
    AND consumption.consumption_kind = 'replacement'
    AND consumption.source_kind = effect.source_kind
    AND consumption.source_id = effect.source_id
    AND consumption.product_id = effect.product_id
    AND consumption.consumed_quantity = effect.issued_quantity
    AND consumption.consumption_state = CASE
      WHEN p_require_issued THEN 'settled'
      ELSE 'draft'
    END
    AND (
      (p_require_issued AND consumption.settled_at IS NOT NULL)
      OR (NOT p_require_issued AND consumption.settled_at IS NULL)
    )
  JOIN LATERAL JSONB_ARRAY_ELEMENTS(v_operation.request_identity_snapshot->'items') request_item
    ON request_item->>'source_kind' = effect.source_kind
    AND (request_item->>'source_id')::UUID = effect.source_id
    AND (request_item->>'quantity')::INTEGER = effect.issued_quantity
  JOIN public.inventory_movements movement
    ON movement.id = effect.inventory_movement_id
    AND movement.operation_id = effect.operation_id
    AND movement.warehouse_id = effect.warehouse_id
    AND movement.product_id = effect.product_id
    AND movement.movement_type = 'sales_deduction'
    AND movement.quantity = -effect.issued_quantity
    AND movement.balance_before = effect.target_balance_before
    AND movement.balance_after = effect.target_balance_after
    AND movement.reference_type = 'phase4_replacement_item'
    AND movement.reference_id = effect.replacement_item_id
    AND movement.created_by IS NOT DISTINCT FROM v_operation.initiated_by
  CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
    effect.source_kind, effect.source_id, effect.product_id
  ) source_root
  LEFT JOIN public.order_items root_item
    ON source_root.root_kind = 'base_order_item'
    AND root_item.id = source_root.root_id
    AND root_item.order_id = v_event.root_order_id
    AND root_item.product_id = effect.product_id
  LEFT JOIN public.order_parcel_components root_component
    ON source_root.root_kind = 'parcel_component'
    AND root_component.id = source_root.root_id
    AND root_component.product_id = effect.product_id
  LEFT JOIN public.order_parcel_instances root_instance
    ON root_instance.id = root_component.parcel_instance_id
    AND root_instance.order_id = v_event.root_order_id
  LEFT JOIN public.sales_replacement_items source_replacement
    ON effect.source_kind = 'replacement_item'
    AND source_replacement.id = effect.source_id
    AND source_replacement.product_id = effect.product_id
  LEFT JOIN public.sales_replacement_events source_event
    ON source_event.id = source_replacement.replacement_event_id
    AND source_event.replacement_status = 'settled'
    AND source_event.issuance_status = 'issued'
    AND source_event.issuance_coordinator_version = 403
  WHERE effect.operation_id = p_operation_id
    AND effect.replacement_event_id = v_event.id
    AND effect.warehouse_id = v_event.warehouse_id
    AND (
      (source_root.root_kind = 'base_order_item' AND root_item.id IS NOT NULL)
      OR (source_root.root_kind = 'parcel_component' AND root_instance.id IS NOT NULL)
    )
    AND (
      (source_root.root_kind = 'base_order_item'
        AND item.root_order_item_id = root_item.id
        AND item.root_parcel_instance_id IS NULL
        AND item.root_parcel_component_id IS NULL
        AND item.original_sale_operation_id IS NULL)
      OR (source_root.root_kind = 'parcel_component'
        AND item.root_order_item_id = root_instance.order_item_id
        AND item.root_parcel_instance_id = root_instance.id
        AND item.root_parcel_component_id = root_component.id
        AND item.original_sale_operation_id = root_component.operation_id)
    )
    AND (
      (effect.source_kind = 'replacement_item'
        AND source_event.id IS NOT NULL
        AND source_event.root_order_id = v_event.root_order_id
        AND item.parent_replacement_item_id = source_replacement.id)
      OR (effect.source_kind <> 'replacement_item'
        AND item.parent_replacement_item_id IS NULL)
    );

  SELECT COUNT(*)::INTEGER INTO v_consumption_count
  FROM public.sales_aftercare_consumptions consumption
  WHERE consumption.operation_id = p_operation_id
    AND consumption.consumption_kind = 'replacement';

  -- Distinct authoritative item coverage and per-item consumption cardinality
  -- prove identity, not merely bag counts. Raw operation counts additionally
  -- exclude orphan evidence; totals below are supplementary arithmetic checks.
  SELECT COUNT(*)::INTEGER INTO v_effect_count
  FROM public.phase43_replacement_inventory_effects effect
  WHERE effect.operation_id = p_operation_id;

  SELECT COUNT(*)::INTEGER INTO v_movement_count
  FROM public.inventory_movements movement
  WHERE movement.operation_id = p_operation_id;

  SELECT COUNT(*)::INTEGER INTO v_operation_consumption_count
  FROM public.sales_aftercare_consumptions consumption
  WHERE consumption.operation_id = p_operation_id;

  IF v_expected_count <= 0
    OR v_request_count IS DISTINCT FROM v_expected_count
    OR v_actual_count IS DISTINCT FROM v_expected_count
    OR v_covered_item_count IS DISTINCT FROM v_expected_count
    OR v_effect_count IS DISTINCT FROM v_expected_count
    OR v_movement_count IS DISTINCT FROM v_expected_count
    OR v_consumption_count IS DISTINCT FROM v_expected_count
    OR v_operation_consumption_count IS DISTINCT FROM v_expected_count
    OR (v_operation.result_snapshot->>'issuedQuantity')::INTEGER
      IS DISTINCT FROM v_issued_quantity
    OR (v_operation.result_snapshot->>'replacementCogsInMinorUnits')::BIGINT
      IS DISTINCT FROM v_replacement_cogs
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_REPLACEMENT_EFFECTS_INCOMPLETE: Every issued Replacement item requires exact inventory and cost evidence.';
  END IF;

  IF (p_require_issued AND (
      v_event.replacement_status IS DISTINCT FROM 'settled'
      OR v_event.settled_at IS NULL
      OR v_event.issuance_status IS DISTINCT FROM 'issued'
      OR v_event.issued_at IS NULL
    )) OR (NOT p_require_issued AND (
      v_event.replacement_status IS DISTINCT FROM 'draft'
      OR v_event.settled_at IS NOT NULL
      OR v_event.issuance_status IS DISTINCT FROM 'not_issued'
      OR v_event.issued_at IS NOT NULL
    )) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_REPLACEMENT_NOT_ISSUED: Foundation settlement is not operational issuance.';
  END IF;
END;
$$;

CREATE FUNCTION public.phase43_resolve_replacement_replay_internal(
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
  v_replay JSONB;
BEGIN
  v_replay := public.phase4_resolve_operation_replay_internal(
    'phase4_replacement_v1', p_idempotency_key,
    p_actor_scope_hash, p_request_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    PERFORM public.phase43_assert_operational_replacement_evidence_internal(
      (v_replay->>'operation_id')::UUID, true
    );
  END IF;
  RETURN v_replay;
END;
$$;

-- Preserve the Phase 4.2 wrapper, then add Replacement issuance enforcement.
ALTER FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID)
  RENAME TO phase4_finalize_aftercare_operation_before_phase43;

CREATE FUNCTION public.phase4_finalize_aftercare_operation_internal(p_operation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_event_id UUID;
  v_version SMALLINT;
  v_result JSONB;
BEGIN
  SELECT operation.operation_type INTO v_type
  FROM public.business_operations operation WHERE operation.id = p_operation_id;
  IF v_type = 'phase4_replacement_v1' THEN
    SELECT event.id, event.issuance_coordinator_version
    INTO v_event_id, v_version
    FROM public.sales_replacement_events event
    WHERE event.operation_id = p_operation_id;
    IF v_version = 403 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.phase43_replacement_issuance_guards guard_row
        WHERE guard_row.transaction_id = pg_current_xact_id()
          AND guard_row.operation_id = p_operation_id
          AND guard_row.replacement_event_id = v_event_id
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE43_COORDINATOR_REQUIRED: Operational Replacement issuance must use the atomic coordinator.';
      END IF;
      PERFORM public.phase43_assert_operational_replacement_evidence_internal(
        p_operation_id, false
      );
    END IF;
  END IF;

  v_result := public.phase4_finalize_aftercare_operation_before_phase43(
    p_operation_id
  );

  IF v_type = 'phase4_replacement_v1' AND v_version = 403 THEN
    UPDATE public.sales_replacement_events
    SET issuance_status = 'issued', issued_at = clock_timestamp()
    WHERE id = v_event_id AND operation_id = p_operation_id
      AND replacement_status = 'settled'
      AND issuance_status = 'not_issued';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_REPLACEMENT_ISSUANCE_TRANSITION_FAILED: Replacement could not become operationally issued.';
    END IF;
    PERFORM public.phase43_assert_operational_replacement_evidence_internal(
      p_operation_id, true
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.settle_sales_replacement_v1(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_items JSONB,
  p_reason TEXT,
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
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_operation_id UUID := gen_random_uuid();
  v_event_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ;
  v_item JSONB;
  v_prepared JSONB := '[]'::JSONB;
  v_product_ids UUID[];
  v_source_kind TEXT;
  v_source_id UUID;
  v_quantity INTEGER;
  v_product_id UUID;
  v_root_order_item_id UUID;
  v_root_parcel_instance_id UUID;
  v_root_parcel_component_id UUID;
  v_original_sale_operation_id UUID;
  v_parent_replacement_item_id UUID;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_wac NUMERIC(24, 6);
  v_cogs BIGINT;
  v_replacement_item_id UUID;
  v_before INTEGER;
  v_available INTEGER;
  v_after INTEGER;
  v_movement_id UUID;
  v_result JSONB;
  v_total_quantity INTEGER := 0;
  v_total_cogs BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات Phase 4.3');
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE43_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;
  v_key := public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
  v_canonical := public.phase43_canonicalize_replacement_request_internal(
    p_order_id, p_items, p_reason, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal('erp_user', v_user_id, NULL, NULL);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);
  v_replay := public.phase43_resolve_replacement_replay_internal(
    v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  PERFORM public.phase4_lock_customer_order_context_internal(p_order_id, false, false);
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_ORIGINAL_SALE_INVALID: Replacement requires a completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id FOR SHARE;
  IF v_creation_type NOT IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales are supported.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_root_order_item_id := NULL;
    v_root_parcel_instance_id := NULL;
    v_root_parcel_component_id := NULL;
    v_original_sale_operation_id := NULL;
    v_parent_replacement_item_id := NULL;

    IF v_source_kind = 'base_order_item' THEN
      SELECT item.id, item.product_id, item.quantity
      INTO v_root_order_item_id, v_product_id, v_capacity
      FROM public.order_items item
      WHERE item.id = v_source_id AND item.order_id = p_order_id
        AND item.commercial_line_kind = 'base_unit';
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT order_item.id, instance.id, component.id, component.operation_id,
        component.product_id, component.base_quantity
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      JOIN public.order_items order_item ON order_item.id = instance.order_item_id
      WHERE component.id = v_source_id AND instance.order_id = p_order_id;
    ELSE
      SELECT item.root_order_item_id, item.root_parcel_instance_id,
        item.root_parcel_component_id, item.original_sale_operation_id,
        item.product_id, item.quantity, item.id
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity, v_parent_replacement_item_id
      FROM public.sales_replacement_items item
      JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
      WHERE item.id = v_source_id AND event.root_order_id = p_order_id
        AND event.replacement_status = 'settled'
        AND event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403;
      IF v_parent_replacement_item_id IS NOT NULL THEN
        PERFORM public.phase43_assert_operational_replacement_evidence_internal(
          (SELECT operation_id FROM public.sales_replacement_items WHERE id = v_parent_replacement_item_id), true
        );
      END IF;
    END IF;

    IF v_product_id IS NULL OR v_capacity IS NULL OR v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE43_REPLACEMENT_SOURCE_INVALID: Source is unavailable or quantity exceeds its immutable capacity.';
    END IF;
    v_prepared := v_prepared || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'source_kind', v_source_kind, 'source_id', v_source_id,
      'quantity', v_quantity, 'product_id', v_product_id,
      'root_order_item_id', v_root_order_item_id,
      'root_parcel_instance_id', v_root_parcel_instance_id,
      'root_parcel_component_id', v_root_parcel_component_id,
      'original_sale_operation_id', v_original_sale_operation_id,
      'parent_replacement_item_id', v_parent_replacement_item_id
    ));
  END LOOP;

  SELECT ARRAY_AGG(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID)
  INTO v_product_ids FROM JSONB_ARRAY_ELEMENTS(v_prepared) item;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);
  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'phase4-aftercare|' || v_source_kind || '|' || v_source_id::TEXT, 0
    ));
    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source_kind
      AND consumption.source_id = v_source_id
      AND consumption.consumption_state = 'settled';
    IF v_source_kind = 'base_order_item' THEN
      SELECT quantity INTO v_capacity FROM public.order_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSE
      SELECT quantity INTO v_capacity FROM public.sales_replacement_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    END IF;
    IF v_capacity IS NULL OR v_consumed + v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Replacement exceeds the remaining physical source.';
    END IF;
    SELECT product.wac_cost_in_minor_units_exact INTO v_wac
    FROM public.products product WHERE product.id = v_product_id FOR NO KEY UPDATE;
    SELECT balance.on_hand_quantity, balance.available_quantity
    INTO v_before, v_available
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    IF v_wac IS NULL OR v_before IS NULL OR v_available < v_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE: Sellable inventory or exact WAC evidence is insufficient.';
    END IF;
  END LOOP;

  v_now := clock_timestamp();
  SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)::INTEGER,
    COALESCE(SUM(ROUND(product.wac_cost_in_minor_units_exact
      * (item->>'quantity')::INTEGER)::BIGINT), 0)::BIGINT
  INTO v_total_quantity, v_total_cogs
  FROM JSONB_ARRAY_ELEMENTS(v_prepared) item
  JOIN public.products product ON product.id = (item->>'product_id')::UUID;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotentReplay', false,
    'operationId', v_operation_id, 'replacementId', v_event_id,
    'orderId', p_order_id, 'operationalCoordinatorVersion', 403,
    'issuedQuantity', v_total_quantity,
    'replacementCogsInMinorUnits', v_total_cogs,
    'moneyRefundInMinorUnits', 0, 'debtReductionInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_replacement_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, replacement_status, original_completed_at_snapshot,
    reason, created_by, issuance_coordinator_version
  ) VALUES (
    v_event_id, v_operation_id, p_order_id, v_order.branch_id,
    v_order.warehouse_id, 401, 'draft', v_completion_at,
    v_canonical->>'reason', v_user_id, 403
  );

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    SELECT product.wac_cost_in_minor_units_exact INTO STRICT v_wac
    FROM public.products product WHERE product.id = v_product_id;
    v_cogs := ROUND(v_wac * v_quantity)::BIGINT;
    v_replacement_item_id := gen_random_uuid();
    INSERT INTO public.sales_replacement_items(
      id, replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, parent_replacement_item_id,
      product_id, quantity, replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_replacement_item_id, v_event_id, v_operation_id,
      (v_item->>'root_order_item_id')::UUID,
      (v_item->>'root_parcel_instance_id')::UUID,
      (v_item->>'root_parcel_component_id')::UUID,
      (v_item->>'original_sale_operation_id')::UUID,
      (v_item->>'parent_replacement_item_id')::UUID,
      v_product_id, v_quantity, v_wac, v_cogs, 'supplier_defect'
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, replacement_item_id, source_kind, source_id,
      product_id, consumed_quantity, consumption_kind
    ) VALUES (
      v_operation_id, v_replacement_item_id, v_source_kind, v_source_id,
      v_product_id, v_quantity, 'replacement'
    );
    SELECT balance.on_hand_quantity INTO STRICT v_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    v_after := v_before - v_quantity;
    UPDATE public.inventory_balances SET on_hand_quantity = v_after,
      updated_at = clock_timestamp()
    WHERE warehouse_id = v_order.warehouse_id AND product_id = v_product_id;
    INSERT INTO public.inventory_movements(
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id
    ) VALUES (
      v_order.warehouse_id, v_product_id, 'sales_deduction', -v_quantity,
      v_before, v_after, 'phase4_replacement_item', v_replacement_item_id,
      'Phase 4.3 operational Replacement issuance', v_user_id, v_operation_id
    ) RETURNING id INTO v_movement_id;
    INSERT INTO public.phase43_replacement_inventory_effects(
      operation_id, replacement_event_id, replacement_item_id,
      warehouse_id, product_id, inventory_movement_id,
      source_kind, source_id, issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,
      target_balance_before, target_balance_after
    ) VALUES (
      v_operation_id, v_event_id, v_replacement_item_id,
      v_order.warehouse_id, v_product_id, v_movement_id,
      v_source_kind, v_source_id, v_quantity, v_wac, v_cogs,
      v_before, v_after
    );
  END LOOP;
  INSERT INTO public.phase43_replacement_issuance_guards(
    transaction_id, operation_id, replacement_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_event_id);
  INSERT INTO public.phase43_replacement_settlement_evidence(
    operation_id, replacement_event_id, order_id,
    result_snapshot, inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_event_id, p_order_id, v_result,
    public.phase43_inventory_effects_snapshot_internal(v_operation_id)
  );
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase43_replacement_issuance_guards
  WHERE transaction_id = pg_current_xact_id() AND operation_id = v_operation_id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'SETTLE_PHASE43_SALES_REPLACEMENT',
    'sales_replacement_events', v_event_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'order_id', p_order_id,
      'issued_quantity', v_total_quantity, 'replacement_cogs', v_total_cogs));
  RETURN v_result;
END;
$$;

-- A later Return still refunds from original-sale evidence, but its physical
-- consumption and sellable restock valuation must follow the current lineage
-- leaf.  Keep Phase 4.2's coordinator as the single Return authority: this
-- adapter only adds immutable physical allocations to its request identity,
-- rewrites draft consumption before finalization, and supplies leaf-valued
-- inventory sources to the existing atomic coordinator.
ALTER FUNCTION public.phase42_canonicalize_return_request_internal(
  UUID, JSONB, TEXT, TEXT, TEXT, TEXT
) RENAME TO phase42_canonicalize_return_request_before_phase43_internal;

CREATE FUNCTION public.phase43_canonicalize_return_physical_sources_internal(
  p_sources JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source JSONB;
  v_result JSONB := '[]'::JSONB;
  v_root_kind TEXT;
  v_source_kind TEXT;
  v_root_id UUID;
  v_source_id UUID;
  v_product_id UUID;
  v_quantity INTEGER;
  v_sellable INTEGER;
  v_supplier_defect INTEGER;
  v_customer_damage INTEGER;
BEGIN
  IF p_sources IS NULL OR JSONB_TYPEOF(p_sources) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_sources) > 200
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_RETURN_PHYSICAL_SOURCES_INVALID: Physical lineage allocations must be an array.';
  END IF;
  FOR v_source IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_sources)
    ORDER BY value->>'root_source_kind', value->>'root_source_id',
      value->>'source_kind', value->>'source_id'
  LOOP
    IF JSONB_TYPEOF(v_source) IS DISTINCT FROM 'object'
      OR v_source - ARRAY[
        'root_source_kind', 'root_source_id', 'source_kind', 'source_id',
        'product_id', 'quantity', 'sellable_restock_quantity',
        'defect_non_sellable_quantity', 'customer_damage_quantity'
      ]::TEXT[] <> '{}'::JSONB
      OR COALESCE(v_source->>'quantity', '') !~ '^[1-9][0-9]*$'
      OR COALESCE(v_source->>'sellable_restock_quantity', '') !~ '^[0-9]+$'
      OR COALESCE(v_source->>'defect_non_sellable_quantity', '') !~ '^[0-9]+$'
      OR COALESCE(v_source->>'customer_damage_quantity', '') !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE43_RETURN_PHYSICAL_SOURCE_INVALID: Physical lineage allocation shape is invalid.';
    END IF;
    v_root_kind := LOWER(v_source->>'root_source_kind');
    v_source_kind := LOWER(v_source->>'source_kind');
    IF v_root_kind NOT IN ('base_order_item', 'parcel_component')
      OR v_source_kind NOT IN ('base_order_item', 'parcel_component', 'replacement_item')
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE43_RETURN_PHYSICAL_SOURCE_INVALID: Physical source kinds are invalid.';
    END IF;
    v_root_id := public.phase3_require_uuid_internal(v_source->>'root_source_id', 'root_source_id');
    v_source_id := public.phase3_require_uuid_internal(v_source->>'source_id', 'source_id');
    v_product_id := public.phase3_require_uuid_internal(v_source->>'product_id', 'product_id');
    v_quantity := (v_source->>'quantity')::INTEGER;
    v_sellable := (v_source->>'sellable_restock_quantity')::INTEGER;
    v_supplier_defect := (v_source->>'defect_non_sellable_quantity')::INTEGER;
    v_customer_damage := (v_source->>'customer_damage_quantity')::INTEGER;
    IF v_sellable + v_supplier_defect + v_customer_damage
      IS DISTINCT FROM v_quantity
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE43_RETURN_PHYSICAL_SOURCE_INVALID: Every physical leaf unit requires exactly one inspection bucket.';
    END IF;
    v_result := v_result || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'root_source_kind', v_root_kind, 'root_source_id', LOWER(v_root_id::TEXT),
      'source_kind', v_source_kind, 'source_id', LOWER(v_source_id::TEXT),
      'product_id', LOWER(v_product_id::TEXT), 'quantity', v_quantity,
      'sellable_restock_quantity', v_sellable,
      'defect_non_sellable_quantity', v_supplier_defect,
      'customer_damage_quantity', v_customer_damage
    ));
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_result) source
    GROUP BY source->>'source_kind', source->>'source_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_RETURN_PHYSICAL_SOURCE_DUPLICATE: A physical lineage leaf may appear only once.';
  END IF;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.phase43_assert_return_allocation_contract_internal(
  p_base_request JSONB,
  p_physical_sources JSONB
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_component JSONB;
  v_root_kind TEXT;
  v_root_id TEXT;
  v_quantity INTEGER;
  v_sellable INTEGER;
  v_defect INTEGER;
  v_damage INTEGER;
BEGIN
  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items')
  LOOP
    IF v_item->>'return_scope' = 'base_unit' THEN
      v_root_kind := 'base_order_item';
      v_root_id := v_item->>'order_item_id';
      v_quantity := (v_item->>'quantity')::INTEGER;
      SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
      INTO v_sellable, v_defect, v_damage
      FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
      WHERE source->>'root_source_kind' = v_root_kind
        AND source->>'root_source_id' = v_root_id;
      IF v_sellable + v_defect + v_damage IS DISTINCT FROM v_quantity
        OR (v_item->>'stock_disposition' = 'restock'
          AND (v_sellable IS DISTINCT FROM v_quantity OR v_defect <> 0 OR v_damage <> 0))
        OR (v_item->>'stock_disposition' = 'damaged'
          AND (v_defect IS DISTINCT FROM v_quantity OR v_sellable <> 0 OR v_damage <> 0))
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Base-unit inspection does not match its physical leaves.';
      END IF;
    ELSE
      FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
      LOOP
        v_root_kind := 'parcel_component';
        v_root_id := v_component->>'parcel_component_id';
        SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
        INTO v_sellable, v_defect, v_damage
        FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
        WHERE source->>'root_source_kind' = v_root_kind
          AND source->>'root_source_id' = v_root_id;
        IF v_sellable + v_defect
            IS DISTINCT FROM (v_component->>'accepted_quantity')::INTEGER
          OR v_damage IS DISTINCT FROM (v_component->>'rejected_quantity')::INTEGER
          OR (v_sellable > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'sellable'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'restock'))
          OR (v_sellable = 0 AND v_defect > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'supplier_defect'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'non_sellable'))
          OR (v_sellable + v_defect = 0 AND (
            v_component->>'accepted_condition' IS NOT NULL
            OR v_component->>'accepted_stock_disposition' IS NOT NULL))
          OR (v_damage > 0 AND (
            v_component->>'rejection_reason' IS DISTINCT FROM 'customer_damage'
            OR v_component->>'rejected_stock_disposition' IS DISTINCT FROM 'returned_to_customer'))
          OR (v_damage = 0 AND (
            v_component->>'rejection_reason' IS NOT NULL
            OR v_component->>'rejected_stock_disposition' IS NOT NULL))
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Parcel inspection does not equal its three-bucket physical allocation.';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
    WHERE NOT EXISTS (
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items') item
      WHERE (item->>'return_scope' = 'base_unit'
          AND source->>'root_source_kind' = 'base_order_item'
          AND source->>'root_source_id' = item->>'order_item_id')
        OR (item->>'return_scope' = 'parcel_instance'
          AND source->>'root_source_kind' = 'parcel_component'
          AND EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(item->'components') component
            WHERE component->>'parcel_component_id' = source->>'root_source_id'))
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Physical allocation contains a root outside the Return request.';
  END IF;
END;
$$;

CREATE FUNCTION public.phase42_canonicalize_return_request_internal(
  p_order_id UUID, p_items JSONB, p_reason TEXT, p_refund_method TEXT,
  p_reference_number TEXT, p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base JSONB;
  v_sources JSONB;
  v_raw TEXT := CURRENT_SETTING('nawasrah.phase43_return_physical_sources', true);
BEGIN
  v_base := public.phase42_canonicalize_return_request_before_phase43_internal(
    p_order_id, p_items, p_reason, p_refund_method, p_reference_number, p_notes
  );
  IF NULLIF(v_raw, '') IS NULL THEN
    RETURN v_base;
  END IF;
  v_sources := public.phase43_canonicalize_return_physical_sources_internal(v_raw::JSONB);
  PERFORM public.phase43_assert_return_allocation_contract_internal(v_base, v_sources);
  RETURN v_base || JSONB_BUILD_OBJECT('physical_sources', v_sources);
END;
$$;

CREATE FUNCTION public.phase43_assert_return_physical_source_internal(
  p_order_id UUID, p_root_kind TEXT, p_root_id UUID,
  p_source_kind TEXT, p_source_id UUID, p_product_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_root RECORD;
  v_source_order UUID;
  v_operation_id UUID;
BEGIN
  SELECT * INTO v_root FROM public.phase4_aftercare_source_root_internal(
    p_source_kind, p_source_id, p_product_id
  );
  IF NOT FOUND OR v_root.root_kind IS DISTINCT FROM p_root_kind
    OR v_root.root_id IS DISTINCT FROM p_root_id
    OR v_root.product_id IS DISTINCT FROM p_product_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_RETURN_LINEAGE_INVALID: Physical source does not represent the requested original sale root.';
  END IF;
  IF p_root_kind = 'base_order_item' THEN
    SELECT item.order_id INTO v_source_order FROM public.order_items item
    WHERE item.id = p_root_id;
  ELSE
    SELECT instance.order_id INTO v_source_order
    FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
    WHERE component.id = p_root_id;
  END IF;
  IF v_source_order IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_RETURN_LINEAGE_INVALID: Physical source belongs to another sale.';
  END IF;
  IF p_source_kind = 'replacement_item' THEN
    SELECT item.operation_id INTO v_operation_id
    FROM public.sales_replacement_items item
    JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
    WHERE item.id = p_source_id AND event.issuance_status = 'issued'
      AND event.issuance_coordinator_version = 403;
    IF v_operation_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_RETURN_LINEAGE_INVALID: Replacement leaf lacks operational issuance evidence.';
    END IF;
    PERFORM public.phase43_assert_operational_replacement_evidence_internal(v_operation_id, true);
  END IF;
END;
$$;

CREATE FUNCTION public.phase43_assert_return_physical_evidence_set_internal(
  p_operation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request JSONB;
  v_mismatch BOOLEAN;
BEGIN
  SELECT operation.request_identity_snapshot INTO v_request
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id
    AND operation.operation_type = 'phase4_return_v1';
  IF NOT FOUND OR NOT COALESCE(v_request ? 'physical_sources', false) THEN
    RETURN;
  END IF;

  WITH expected AS (
    SELECT return_item.id return_item_id,
      source->>'root_source_kind' root_source_kind,
      (source->>'root_source_id')::UUID root_source_id,
      source->>'source_kind' source_kind,
      (source->>'source_id')::UUID source_id,
      (source->>'product_id')::UUID product_id,
      (source->>'quantity')::INTEGER quantity
    FROM JSONB_ARRAY_ELEMENTS(v_request->'physical_sources') source
    JOIN public.sales_return_items return_item
      ON return_item.operation_id = p_operation_id
      AND (
        (source->>'root_source_kind' = 'base_order_item'
          AND return_item.return_scope = 'base_unit'
          AND return_item.order_item_id = (source->>'root_source_id')::UUID)
        OR
        (source->>'root_source_kind' = 'parcel_component'
          AND return_item.return_scope = 'parcel_instance'
          AND EXISTS (
            SELECT 1 FROM public.order_parcel_components component
            WHERE component.id = (source->>'root_source_id')::UUID
              AND component.parcel_instance_id = return_item.parcel_instance_id
          ))
      )
  ), actual AS (
    SELECT consumption.return_item_id,
      root.root_kind root_source_kind, root.root_id root_source_id,
      consumption.source_kind, consumption.source_id,
      consumption.product_id, consumption.consumed_quantity quantity
    FROM public.sales_aftercare_consumptions consumption
    CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
      consumption.source_kind, consumption.source_id, consumption.product_id
    ) root
    WHERE consumption.operation_id = p_operation_id
      AND consumption.consumption_kind = 'return'
  ), delta AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT EXISTS (SELECT 1 FROM delta) INTO v_mismatch;
  IF v_mismatch THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_RETURN_PHYSICAL_EVIDENCE_MISMATCH: Expected and persisted physical-consumption sets differ.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sales_return_component_inspections inspection
    JOIN public.sales_return_items return_item
      ON return_item.id = inspection.sales_return_item_id
      AND return_item.operation_id = p_operation_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER sellable,
        COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER defect,
        COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER damage
      FROM JSONB_ARRAY_ELEMENTS(v_request->'physical_sources') source
      WHERE source->>'root_source_kind' = 'parcel_component'
        AND (source->>'root_source_id')::UUID = inspection.parcel_component_id
    ) allocation ON true
    WHERE inspection.accepted_quantity IS DISTINCT FROM allocation.sellable + allocation.defect
      OR inspection.rejected_quantity IS DISTINCT FROM allocation.damage
      OR (allocation.sellable > 0 AND (
        inspection.accepted_condition IS DISTINCT FROM 'sellable'
        OR inspection.accepted_stock_disposition IS DISTINCT FROM 'restock'))
      OR (allocation.sellable = 0 AND allocation.defect > 0 AND (
        inspection.accepted_condition IS DISTINCT FROM 'supplier_defect'
        OR inspection.accepted_stock_disposition IS DISTINCT FROM 'non_sellable'))
      OR (allocation.damage > 0 AND (
        inspection.rejection_reason IS DISTINCT FROM 'customer_damage'
        OR inspection.rejected_stock_disposition IS DISTINCT FROM 'returned_to_customer'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_RETURN_INSPECTION_EVIDENCE_MISMATCH: Persisted inspection does not match the immutable leaf allocation.';
  END IF;
END;
$$;

ALTER FUNCTION public.phase42_assert_operational_return_evidence_internal(UUID, BOOLEAN)
  RENAME TO phase42_assert_operational_return_evidence_before_phase43;

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
BEGIN
  PERFORM public.phase42_assert_operational_return_evidence_before_phase43(
    p_operation_id, p_require_settled
  );
  PERFORM public.phase43_assert_return_physical_evidence_set_internal(
    p_operation_id
  );
END;
$$;

CREATE FUNCTION public.phase43_rebind_return_consumption_to_leaf()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_sources JSONB;
  v_source JSONB;
  v_total INTEGER;
BEGIN
  IF NEW.consumption_kind <> 'return'
    OR pg_trigger_depth() > 1
  THEN
    RETURN NEW;
  END IF;
  SELECT event.order_id, operation.request_identity_snapshot->'physical_sources'
  INTO v_order_id, v_sources
  FROM public.business_operations operation
  JOIN public.sales_return_events event ON event.operation_id = operation.id
  WHERE operation.id = NEW.operation_id;
  IF v_sources IS NULL OR JSONB_ARRAY_LENGTH(v_sources) = 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.sales_replacement_items item
      JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
      CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
        'replacement_item', item.id, item.product_id
      ) root
      WHERE root.root_kind = NEW.source_kind AND root.root_id = NEW.source_id
        AND root.product_id = NEW.product_id AND event.issuance_status = 'issued'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_RETURN_PHYSICAL_LINEAGE_REQUIRED: Return must identify every current physical representative.';
    END IF;
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM((source->>'quantity')::INTEGER), 0)::INTEGER INTO v_total
  FROM JSONB_ARRAY_ELEMENTS(v_sources) source
  WHERE source->>'root_source_kind' = NEW.source_kind
    AND (source->>'root_source_id')::UUID = NEW.source_id
    AND (source->>'product_id')::UUID = NEW.product_id;
  IF v_total = 0 THEN
    RETURN NEW;
  END IF;
  IF v_total IS DISTINCT FROM NEW.consumed_quantity THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_RETURN_LINEAGE_QUANTITY_INVALID: Physical lineage does not cover the exact Return consumption.';
  END IF;
  FOR v_source IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_sources)
    WHERE value->>'root_source_kind' = NEW.source_kind
      AND (value->>'root_source_id')::UUID = NEW.source_id
      AND (value->>'product_id')::UUID = NEW.product_id
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    PERFORM public.phase43_assert_return_physical_source_internal(
      v_order_id, NEW.source_kind, NEW.source_id,
      v_source->>'source_kind', (v_source->>'source_id')::UUID, NEW.product_id
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, return_item_id, source_kind, source_id, product_id,
      consumed_quantity, consumption_kind
    ) VALUES (
      NEW.operation_id, NEW.return_item_id, v_source->>'source_kind',
      (v_source->>'source_id')::UUID, NEW.product_id,
      (v_source->>'quantity')::INTEGER, 'return'
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_phase43_rebind_return_consumption_to_leaf
BEFORE INSERT ON public.sales_aftercare_consumptions
FOR EACH ROW EXECUTE FUNCTION public.phase43_rebind_return_consumption_to_leaf();

ALTER FUNCTION public.phase42_apply_return_inventory_internal(
  UUID, UUID, UUID, JSONB, UUID
) RENAME TO phase42_apply_return_inventory_before_phase43_internal;

CREATE FUNCTION public.phase43_return_inventory_sources_internal(
  p_operation_id UUID, p_sources JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request JSONB;
  v_order_id UUID;
  v_root JSONB;
  v_leaf JSONB;
  v_result JSONB := '[]'::JSONB;
  v_mapped INTEGER;
  v_unit_cost NUMERIC(24, 6);
  v_leaf_quantity INTEGER;
BEGIN
  SELECT operation.request_identity_snapshot, event.order_id
  INTO v_request, v_order_id
  FROM public.business_operations operation
  JOIN public.sales_return_events event ON event.operation_id = operation.id
  WHERE operation.id = p_operation_id;
  IF v_request->'physical_sources' IS NULL THEN RETURN p_sources; END IF;
  FOR v_root IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_sources)
  LOOP
    SELECT COALESCE(SUM((leaf->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER
    INTO v_mapped FROM JSONB_ARRAY_ELEMENTS(v_request->'physical_sources') leaf
    WHERE leaf->>'root_source_kind' = v_root->>'source_kind'
      AND leaf->>'root_source_id' = v_root->>'source_id';
    IF v_mapped > (v_root->>'quantity')::INTEGER THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_RETURN_RESTOCK_LINEAGE_INCOMPLETE: Sellable leaf allocation exceeds accepted Return evidence.';
    END IF;
    FOR v_leaf IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_request->'physical_sources')
      WHERE value->>'root_source_kind' = v_root->>'source_kind'
        AND value->>'root_source_id' = v_root->>'source_id'
        AND (value->>'sellable_restock_quantity')::INTEGER > 0
      ORDER BY value->>'source_kind', value->>'source_id'
    LOOP
      PERFORM public.phase43_assert_return_physical_source_internal(
        v_order_id, v_root->>'source_kind', (v_root->>'source_id')::UUID,
        v_leaf->>'source_kind', (v_leaf->>'source_id')::UUID,
        (v_leaf->>'product_id')::UUID
      );
      v_leaf_quantity := (v_leaf->>'sellable_restock_quantity')::INTEGER;
      IF v_leaf->>'source_kind' = 'replacement_item' THEN
        SELECT item.replacement_unit_cost_snapshot_in_minor_units_exact
        INTO v_unit_cost FROM public.sales_replacement_items item
        WHERE item.id = (v_leaf->>'source_id')::UUID;
      ELSE
        v_unit_cost := (v_root->>'historical_value_exact')::NUMERIC
          / (v_root->>'quantity')::INTEGER;
      END IF;
      v_result := v_result || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'source_kind', v_leaf->>'source_kind',
        'source_id', v_leaf->>'source_id',
        'return_item_id', v_root->>'return_item_id',
        'product_id', v_leaf->>'product_id', 'quantity', v_leaf_quantity,
        'historical_value_exact', ROUND(v_unit_cost * v_leaf_quantity, 6)
      ));
    END LOOP;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.phase42_apply_return_inventory_internal(
  p_operation_id UUID, p_return_event_id UUID, p_warehouse_id UUID,
  p_sources JSONB, p_user_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.phase42_apply_return_inventory_before_phase43_internal(
    p_operation_id, p_return_event_id, p_warehouse_id,
    public.phase43_return_inventory_sources_internal(p_operation_id, p_sources),
    p_user_id
  );
$$;

ALTER FUNCTION public.phase42_expected_return_inventory_effects_internal(UUID)
  RENAME TO phase42_expected_return_effects_pre43_internal;

CREATE FUNCTION public.phase42_expected_return_inventory_effects_internal(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request JSONB;
  v_result JSONB;
BEGIN
  SELECT operation.request_identity_snapshot INTO v_request
  FROM public.business_operations operation WHERE operation.id = p_operation_id;
  IF NOT COALESCE(v_request ? 'physical_sources', false) THEN
    RETURN public.phase42_expected_return_effects_pre43_internal(
      p_operation_id
    );
  END IF;
  WITH original_sources AS (
    SELECT JSONB_BUILD_OBJECT(
      'source_kind', evidence->>'source_kind', 'source_id', evidence->>'source_id',
      'return_item_id', evidence->>'return_item_id',
      'product_id', evidence->>'product_id', 'quantity', evidence->>'quantity',
      'historical_value_exact', evidence->>'historical_value_exact'
    ) source
    FROM JSONB_EACH(
      public.phase42_expected_return_effects_pre43_internal(p_operation_id)
    ) grouped
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(grouped.value->'sourceEvidence') evidence
  ), transformed AS (
    SELECT public.phase43_return_inventory_sources_internal(
      p_operation_id, COALESCE(JSONB_AGG(source), '[]'::JSONB)
    ) sources FROM original_sources
  ), flat AS (
    SELECT source FROM transformed
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(sources) source
  ), grouped AS (
    SELECT (source->>'product_id')::UUID product_id,
      SUM((source->>'quantity')::INTEGER)::INTEGER quantity,
      ROUND(SUM((source->>'historical_value_exact')::NUMERIC), 6) historical_value,
      JSONB_AGG(source ORDER BY source->>'source_kind', source->>'source_id') evidence
    FROM flat GROUP BY (source->>'product_id')::UUID
  )
  SELECT COALESCE(JSONB_OBJECT_AGG(product_id::TEXT, JSONB_BUILD_OBJECT(
    'quantity', quantity, 'historicalValueExact', historical_value,
    'sourceEvidence', evidence
  )), '{}'::JSONB) INTO v_result FROM grouped;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.settle_admin_sales_return_v1(
  p_order_id UUID, p_idempotency_key TEXT, p_items JSONB,
  p_physical_sources JSONB, p_reason TEXT, p_refund_method TEXT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'تسوية مرتجع مبيعات Admin Phase 4.3');
  PERFORM SET_CONFIG('nawasrah.phase43_return_physical_sources',
    public.phase43_canonicalize_return_physical_sources_internal(p_physical_sources)::TEXT, true);
  RETURN public.settle_sales_return_v1(
    p_order_id, p_idempotency_key, p_items, p_reason,
    p_refund_method, p_reference_number, p_notes
  );
END;
$$;

CREATE FUNCTION public.phase43_current_physical_representatives_internal(
  p_root_kind TEXT, p_root_id UUID, p_product_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH root_capacity AS (
    SELECT CASE
      WHEN p_root_kind = 'base_order_item' THEN (
        SELECT item.quantity FROM public.order_items item
        WHERE item.id = p_root_id AND item.product_id = p_product_id
      )
      WHEN p_root_kind = 'parcel_component' THEN (
        SELECT component.base_quantity FROM public.order_parcel_components component
        WHERE component.id = p_root_id AND component.product_id = p_product_id
      )
    END::INTEGER quantity
  ), original AS (
    SELECT p_root_kind source_kind, p_root_id source_id, p_product_id product_id,
      GREATEST(root.quantity - COALESCE((
        SELECT SUM(consumption.consumed_quantity)::INTEGER
        FROM public.sales_aftercare_consumptions consumption
        WHERE consumption.source_kind = p_root_kind
          AND consumption.source_id = p_root_id
          AND consumption.consumption_state = 'settled'
      ), 0), 0)::INTEGER remaining_quantity,
      NULL::UUID parent_replacement_item_id
    FROM root_capacity root WHERE root.quantity IS NOT NULL
  ), replacements AS (
    SELECT 'replacement_item'::TEXT source_kind, item.id source_id,
      item.product_id,
      GREATEST(item.quantity - COALESCE((
        SELECT SUM(consumption.consumed_quantity)::INTEGER
        FROM public.sales_aftercare_consumptions consumption
        WHERE consumption.source_kind = 'replacement_item'
          AND consumption.source_id = item.id
          AND consumption.consumption_state = 'settled'
      ), 0), 0)::INTEGER remaining_quantity,
      item.parent_replacement_item_id
    FROM public.sales_replacement_items item
    JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
    JOIN public.phase43_replacement_settlement_evidence evidence
      ON evidence.operation_id = item.operation_id
      AND evidence.replacement_event_id = event.id
    WHERE item.product_id = p_product_id
      AND CASE WHEN p_root_kind = 'base_order_item'
        THEN item.root_parcel_component_id IS NULL
          AND item.root_order_item_id = p_root_id
        ELSE item.root_parcel_component_id = p_root_id END
      AND event.root_order_id = (
        SELECT CASE WHEN p_root_kind = 'base_order_item'
          THEN (SELECT order_id FROM public.order_items WHERE id = p_root_id)
          ELSE (SELECT instance.order_id
            FROM public.order_parcel_components component
            JOIN public.order_parcel_instances instance
              ON instance.id = component.parcel_instance_id
            WHERE component.id = p_root_id) END
      )
      AND event.replacement_status = 'settled'
      AND event.issuance_status = 'issued'
      AND event.issuance_coordinator_version = 403
  ), representatives AS (
    SELECT * FROM original UNION ALL SELECT * FROM replacements
  )
  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'sourceKind', source_kind, 'sourceId', source_id,
    'productId', product_id, 'remainingQuantity', remaining_quantity,
    'parentReplacementItemId', parent_replacement_item_id
  ) ORDER BY source_kind, source_id) FILTER (WHERE remaining_quantity > 0), '[]'::JSONB)
  FROM representatives;
$$;

CREATE FUNCTION public.get_admin_sales_aftercare_context_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_capability TEXT;
  v_completion TIMESTAMPTZ;
  v_financial RECORD;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'قراءة سياق خدمات ما بعد البيع');
  SELECT * INTO v_order FROM public.orders customer_order WHERE customer_order.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE43_ORDER_NOT_FOUND: Order does not exist.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id;

  IF v_creation_type IS DISTINCT FROM 'phase3_pos_sale_v1'
    AND v_creation_type IS DISTINCT FROM 'phase3_customer_reservation_v1'
  THEN
    v_capability := CASE
      WHEN v_order.operation_id IS NULL AND v_order.source = 'website'
        THEN 'legacy_website_return_v1'
      WHEN v_order.operation_id IS NULL AND v_order.source = 'pos'
        THEN 'legacy_pos_v1_unsupported'
      ELSE 'unsupported_contract'
    END;

    RETURN JSONB_BUILD_OBJECT(
      'contractVersion', 403,
      'serverTime', clock_timestamp(),
      'supported', false,
      'capability', v_capability,
      'order', JSONB_BUILD_OBJECT(
        'id', v_order.id, 'orderNumber', v_order.order_number,
        'status', v_order.status, 'saleContract', v_creation_type,
        'source', v_order.source,
        'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
        'completedAt', NULL, 'deadlineAt', NULL, 'withinWindow', false
      ),
      'financial', NULL,
      'baseItems', '[]'::JSONB,
      'parcelInstances', '[]'::JSONB,
      'returns', '[]'::JSONB,
      'replacements', '[]'::JSONB
    );
  END IF;

  v_completion := public.phase4_authoritative_completion_internal(p_order_id);
  SELECT * INTO v_financial FROM public.phase42_order_financial_position_internal(p_order_id);
  RETURN JSONB_BUILD_OBJECT(
    'contractVersion', 403,
    'serverTime', clock_timestamp(),
    'supported', true,
    'capability', 'phase43_modern',
    'order', JSONB_BUILD_OBJECT(
      'id', v_order.id, 'orderNumber', v_order.order_number,
      'status', v_order.status, 'saleContract', v_creation_type,
      'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
      'completedAt', v_completion, 'deadlineAt', v_completion + INTERVAL '48 hours',
      'withinWindow', clock_timestamp() <= v_completion + INTERVAL '48 hours'
    ),
    'financial', JSONB_BUILD_OBJECT(
      'merchandiseDebtInMinorUnits', v_financial.merchandise_debt_in_minor_units,
      'refundableCollectedInMinorUnits', v_financial.refundable_collected_in_minor_units,
      'deliveryFeeInMinorUnits', v_financial.delivery_fee_in_minor_units
    ),
    'baseItems', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'orderItemId', item.id, 'productId', item.product_id,
      'quantity', item.quantity,
      'remainingQuantity', GREATEST(item.quantity - COALESCE(consumed.quantity, 0), 0),
      'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
        'base_order_item', item.id, item.product_id
      )
    ) ORDER BY item.id)
    FROM public.order_items item
    LEFT JOIN LATERAL (
      SELECT SUM(consumption.consumed_quantity)::INTEGER quantity
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.source_kind = 'base_order_item'
        AND consumption.source_id = item.id
        AND consumption.consumption_state = 'settled'
    ) consumed ON true
    WHERE item.order_id = p_order_id
      AND item.commercial_line_kind = 'base_unit'), '[]'::JSONB),
    'parcelInstances', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'parcelInstanceId', instance.id, 'orderItemId', instance.order_item_id,
      'components', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'parcelComponentId', component.id, 'productId', component.product_id,
        'quantity', component.base_quantity,
        'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
          'parcel_component', component.id, component.product_id
        )
      ) ORDER BY component.id), '[]'::JSONB)
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = instance.id)
    ) ORDER BY instance.id)
    FROM public.order_parcel_instances instance
    WHERE instance.order_id = p_order_id), '[]'::JSONB),
    'returns', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'returnId', event.id, 'status', event.settlement_status,
      'createdAt', event.created_at, 'settledAt', event.settled_at,
      'merchandiseEntitlementInMinorUnits', event.merchandise_refund_amount_in_minor_units,
      'debtReductionInMinorUnits', event.debt_reduction_amount_in_minor_units,
      'moneyRefundInMinorUnits', event.money_refund_amount_in_minor_units
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_return_events event WHERE event.order_id = p_order_id), '[]'::JSONB),
    'replacements', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'replacementId', event.id, 'foundationStatus', event.replacement_status,
      'operationalStatus', CASE WHEN event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403 THEN 'issued' ELSE 'foundation_only' END,
      'createdAt', event.created_at, 'issuedAt', event.issued_at,
      'items', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'replacementItemId', item.id, 'productId', item.product_id,
        'quantity', item.quantity, 'parentReplacementItemId', item.parent_replacement_item_id,
        'rootOrderItemId', item.root_order_item_id,
        'rootParcelComponentId', item.root_parcel_component_id
      ) ORDER BY item.id), '[]'::JSONB)
      FROM public.sales_replacement_items item WHERE item.replacement_event_id = event.id)
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_replacement_events event WHERE event.root_order_id = p_order_id), '[]'::JSONB)
  );
END;
$$;

ALTER TABLE public.phase43_replacement_inventory_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase43_replacement_settlement_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phase43_replacement_issuance_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase43_replacement_inventory_effects,
  public.phase43_replacement_settlement_evidence,
  public.phase43_replacement_issuance_guards
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.get_admin_sales_aftercare_context_v1(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_sales_aftercare_context_v1(UUID)
  TO authenticated;
REVOKE ALL ON FUNCTION public.settle_admin_sales_return_v1(
  UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_admin_sales_return_v1(
  UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

DO $$
DECLARE v_signature REGPROCEDURE;
BEGIN
  FOR v_signature IN
    SELECT procedure_oid::REGPROCEDURE FROM (
      VALUES
        ('public.phase43_guard_immutable_replacement_effect()'::REGPROCEDURE),
        ('public.phase43_guard_replacement_settlement_evidence()'::REGPROCEDURE),
        ('public.phase43_inventory_effects_snapshot_internal(uuid)'::REGPROCEDURE),
        ('public.phase43_canonicalize_replacement_request_internal(uuid,jsonb,text,text)'::REGPROCEDURE),
        ('public.phase43_assert_operational_replacement_evidence_internal(uuid,boolean)'::REGPROCEDURE),
        ('public.phase43_resolve_replacement_replay_internal(text,text,text)'::REGPROCEDURE),
        ('public.phase42_canonicalize_return_request_before_phase43_internal(uuid,jsonb,text,text,text,text)'::REGPROCEDURE),
        ('public.phase43_canonicalize_return_physical_sources_internal(jsonb)'::REGPROCEDURE),
        ('public.phase43_assert_return_allocation_contract_internal(jsonb,jsonb)'::REGPROCEDURE),
        ('public.phase43_assert_return_physical_source_internal(uuid,text,uuid,text,uuid,uuid)'::REGPROCEDURE),
        ('public.phase43_assert_return_physical_evidence_set_internal(uuid)'::REGPROCEDURE),
        ('public.phase42_assert_operational_return_evidence_internal(uuid,boolean)'::REGPROCEDURE),
        ('public.phase42_assert_operational_return_evidence_before_phase43(uuid,boolean)'::REGPROCEDURE),
        ('public.phase43_rebind_return_consumption_to_leaf()'::REGPROCEDURE),
        ('public.phase42_apply_return_inventory_before_phase43_internal(uuid,uuid,uuid,jsonb,uuid)'::REGPROCEDURE),
        ('public.phase43_return_inventory_sources_internal(uuid,jsonb)'::REGPROCEDURE),
        ('public.phase43_current_physical_representatives_internal(text,uuid,uuid)'::REGPROCEDURE),
        ('public.phase42_expected_return_effects_pre43_internal(uuid)'::REGPROCEDURE),
        ('public.phase42_canonicalize_return_request_internal(uuid,jsonb,text,text,text,text)'::REGPROCEDURE),
        ('public.phase42_apply_return_inventory_internal(uuid,uuid,uuid,jsonb,uuid)'::REGPROCEDURE),
        ('public.phase42_expected_return_inventory_effects_internal(uuid)'::REGPROCEDURE),
        ('public.phase4_finalize_aftercare_operation_before_phase43(uuid)'::REGPROCEDURE),
        ('public.phase4_finalize_aftercare_operation_internal(uuid)'::REGPROCEDURE)
    ) signatures(procedure_oid)
  LOOP
    EXECUTE FORMAT('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_signature);
  END LOOP;
END;
$$;

ALTER TABLE public.phase43_replacement_inventory_effects OWNER TO postgres;
ALTER TABLE public.phase43_replacement_settlement_evidence OWNER TO postgres;
ALTER TABLE public.phase43_replacement_issuance_guards OWNER TO postgres;
ALTER FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.settle_admin_sales_return_v1(
  UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.get_admin_sales_aftercare_context_v1(UUID) OWNER TO postgres;

COMMENT ON FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT) IS
  'Atomic Phase 4.3 Replacement V1 issuance: same SKU/quantity, original 48-hour window, replacement-time exact cost, immutable lineage and replay.';
COMMENT ON FUNCTION public.get_admin_sales_aftercare_context_v1(UUID) IS
  'Authoritative read-only Admin aftercare context. Snapshot does not reserve eligibility; coordinators revalidate under locks.';
COMMENT ON FUNCTION public.settle_admin_sales_return_v1(
  UUID, TEXT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) IS 'Phase 4.3 Admin Return adapter: original-sale refund plus current physical-lineage consumption and immutable leaf-cost restock valuation.';

COMMIT;
