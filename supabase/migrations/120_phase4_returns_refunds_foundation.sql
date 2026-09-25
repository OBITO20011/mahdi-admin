BEGIN;

-- ============================================================================
-- Phase 4.1 - Returns / replacements additive foundation
--
-- This migration intentionally does not expose an operational Return,
-- Refund, or Replacement coordinator.  It stores the immutable evidence that
-- those coordinators will require and hardens the existing sale/payment/shift
-- boundaries so a later reversal cannot silently bypass that evidence.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Historical effective standalone Base Unit sale-price evidence.
-- --------------------------------------------------------------------------

ALTER TABLE public.order_parcel_components
  ADD COLUMN effective_standalone_unit_sale_price_snapshot_in_minor_units BIGINT;

ALTER TABLE public.order_parcel_components
  ADD CONSTRAINT order_parcel_components_effective_standalone_price_check
  CHECK (
    effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL
    OR effective_standalone_unit_sale_price_snapshot_in_minor_units >= 0
  );

COMMENT ON COLUMN public.order_parcel_components.effective_standalone_unit_sale_price_snapshot_in_minor_units IS
  'Immutable server-authoritative price at which one standalone Base Unit of this component would have sold at the commercial price-freeze point. NULL is permitted only for historical rows created before Phase 4.1.';

CREATE FUNCTION public.phase4_effective_standalone_unit_price_internal(
  p_product_id UUID,
  p_channel TEXT,
  p_customer_phone TEXT DEFAULT NULL,
  p_promotion_code TEXT DEFAULT NULL,
  p_price_frozen_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_price BIGINT;
  v_effective_at TIMESTAMPTZ := COALESCE(p_price_frozen_at, statement_timestamp());
  v_code TEXT := UPPER(NULLIF(BTRIM(p_promotion_code), ''));
  v_phone TEXT := CASE
    WHEN NULLIF(BTRIM(p_customer_phone), '') IS NULL THEN NULL
    ELSE public.normalize_customer_phone(p_customer_phone)
  END;
  v_promotion public.promotion_codes%ROWTYPE;
  v_discount BIGINT := 0;
BEGIN
  IF p_channel NOT IN ('admin_pos', 'customer_v2') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_STANDALONE_PRICE_CONTEXT_INVALID: Unsupported commercial channel.';
  END IF;

  SELECT product.sale_price_in_minor_units
  INTO v_price
  FROM public.products product
  WHERE product.id = p_product_id
    AND product.is_active
    AND NOT product.is_flavor_master
  FOR SHARE;

  IF NOT FOUND OR COALESCE(v_price, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_STANDALONE_PRICE_UNPROVEN: The authoritative standalone Base Unit price cannot be proven.';
  END IF;

  -- POS V2 has no standalone promotion-code contract.  Its existing total
  -- discount must never be reinterpreted as a unit promotion.
  IF p_channel = 'admin_pos' OR v_code IS NULL THEN
    RETURN v_price;
  END IF;

  SELECT promotion.*
  INTO v_promotion
  FROM public.promotion_codes promotion
  WHERE promotion.code = v_code
  FOR SHARE;

  -- A pinned order promotion affects the standalone snapshot only when that
  -- exact one-unit hypothetical sale is itself eligible.  Ineligibility means
  -- the normal server price is the correct result, not a fallback guess.
  IF NOT FOUND
    OR NOT v_promotion.is_active
    OR (v_promotion.starts_at IS NOT NULL AND v_effective_at < v_promotion.starts_at)
    OR (v_promotion.expires_at IS NOT NULL AND v_effective_at >= v_promotion.expires_at)
    OR v_price < v_promotion.minimum_subtotal_in_minor_units
    OR (v_promotion.maximum_redemptions_per_phone IS NOT NULL AND v_phone IS NULL)
  THEN
    RETURN v_price;
  END IF;

  IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
    SELECT COUNT(*)
    FROM public.promotion_redemptions redemption
    WHERE redemption.promotion_code_id = v_promotion.id
  ) >= v_promotion.maximum_total_redemptions THEN
    RETURN v_price;
  END IF;

  IF v_promotion.maximum_redemptions_per_phone IS NOT NULL AND (
    SELECT COUNT(*)
    FROM public.promotion_redemptions redemption
    WHERE redemption.promotion_code_id = v_promotion.id
      AND redemption.customer_phone = v_phone
  ) >= v_promotion.maximum_redemptions_per_phone THEN
    RETURN v_price;
  END IF;

  IF v_promotion.discount_type = 'fixed' THEN
    v_discount := LEAST(v_promotion.discount_value, v_price);
  ELSIF v_promotion.discount_type = 'percentage' THEN
    v_discount := FLOOR(v_price::NUMERIC * v_promotion.discount_value / 10000)::BIGINT;
    IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_promotion.maximum_discount_in_minor_units);
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_STANDALONE_PRICE_UNPROVEN: Promotion pricing contract is unsupported.';
  END IF;

  RETURN v_price - LEAST(GREATEST(v_discount, 0), v_price);
END;
$$;

CREATE FUNCTION public.phase4_capture_parcel_component_price_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_source TEXT;
  v_operation_type TEXT;
  v_customer_phone TEXT;
  v_promotion_code TEXT;
  v_price_frozen_at TIMESTAMPTZ;
BEGIN
  IF NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_STANDALONE_PRICE_SERVER_AUTHORITY_REQUIRED: Caller-supplied snapshots are forbidden.';
  END IF;

  SELECT customer_order.source, operation.operation_type,
    customer.phone, customer_order.promotion_code_snapshot,
    operation.completed_at
  INTO v_source, v_operation_type, v_customer_phone, v_promotion_code,
    v_price_frozen_at
  FROM public.order_parcel_instances instance
  JOIN public.orders customer_order ON customer_order.id = instance.order_id
  JOIN public.business_operations operation ON operation.id = instance.operation_id
  LEFT JOIN public.customers customer ON customer.id = customer_order.customer_id
  WHERE instance.id = NEW.parcel_instance_id
    AND instance.operation_id = NEW.operation_id
  FOR SHARE OF instance, customer_order, operation;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_STANDALONE_PRICE_PARENT_MISSING: Parcel sale context is unavailable.';
  END IF;

  IF v_operation_type = 'phase3_pos_sale_v1' THEN
    NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units :=
      public.phase4_effective_standalone_unit_price_internal(
        NEW.product_id, 'admin_pos', NULL, NULL, v_price_frozen_at
      );
  ELSIF v_operation_type = 'phase3_customer_reservation_v1' THEN
    NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units :=
      public.phase4_effective_standalone_unit_price_internal(
        NEW.product_id, 'customer_v2', v_customer_phone,
        v_promotion_code, v_price_frozen_at
      );
  ELSE
    -- Existing historical/legacy creation paths remain valid.  They are not
    -- silently backfilled and cannot later use customer-damage deduction when
    -- the required immutable evidence is absent.
    NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_capture_parcel_component_price_snapshot
BEFORE INSERT ON public.order_parcel_components
FOR EACH ROW EXECUTE FUNCTION public.phase4_capture_parcel_component_price_snapshot();

-- Preserve the Phase-3 one-time cost-finalization exception while making the
-- newly captured commercial price immutable through that transition.
CREATE OR REPLACE FUNCTION public.guard_order_parcel_component_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_finalized_at TIMESTAMPTZ;
  v_cost_transition BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT instance.order_id, instance.finalized_at
    INTO v_order_id, v_finalized_at
    FROM public.order_parcel_instances instance
    WHERE instance.id = OLD.parcel_instance_id
    FOR UPDATE;
  ELSE
    SELECT instance.order_id, instance.finalized_at
    INTO v_order_id, v_finalized_at
    FROM public.order_parcel_instances instance
    WHERE instance.id = NEW.parcel_instance_id
    FOR UPDATE;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_finalized_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'FINALIZED_PARCEL_COMPONENT_IMMUTABLE: لا يمكن حذف مكونات طرد مكتمل.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_cost_transition :=
      OLD.cost_finalized_at IS NULL
      AND NEW.cost_finalized_at IS NOT NULL
      AND public.phase3_customer_cost_finalization_allowed_internal(
        v_order_id, 'parcel_component', OLD.id
      )
      AND ROW(
        NEW.parcel_instance_id, NEW.operation_id, NEW.product_id,
        NEW.base_quantity, NEW.product_name_snapshot, NEW.sku_snapshot,
        NEW.base_unit_name_snapshot,
        NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units,
        NEW.created_at
      ) IS NOT DISTINCT FROM ROW(
        OLD.parcel_instance_id, OLD.operation_id, OLD.product_id,
        OLD.base_quantity, OLD.product_name_snapshot, OLD.sku_snapshot,
        OLD.base_unit_name_snapshot,
        OLD.effective_standalone_unit_sale_price_snapshot_in_minor_units,
        OLD.created_at
      );
    IF v_cost_transition THEN RETURN NEW; END IF;
  END IF;

  IF v_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'FINALIZED_PARCEL_COMPONENT_IMMUTABLE: لا يمكن تعديل مكونات طرد مكتمل.';
  END IF;
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------------
-- Return settlement evidence. Existing rows are already completed history;
-- new nullable fields are additive and are enforced for Phase-4 contracts by
-- the protected finalization boundary rather than guessed backfill.
-- --------------------------------------------------------------------------

ALTER TABLE public.sales_return_events
  ALTER COLUMN cash_shift_id DROP NOT NULL,
  ALTER COLUMN refund_method DROP NOT NULL,
  ADD COLUMN contract_version SMALLINT,
  ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'settled',
  ADD COLUMN outstanding_debt_before_snapshot_in_minor_units BIGINT,
  ADD COLUMN net_collected_before_snapshot_in_minor_units BIGINT,
  ADD COLUMN debt_reduction_amount_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN money_refund_amount_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN raw_customer_damage_deduction_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN applied_customer_damage_deduction_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN settled_at TIMESTAMPTZ;

-- Existing and future legacy writers omit the Phase-4 contract columns and
-- continue to represent an immediately settled historical Return. Versioned
-- Phase-4 coordinators must request `draft` explicitly while constructing all
-- evidence inside their transaction.
ALTER TABLE public.sales_return_events
  ALTER COLUMN settlement_status SET DEFAULT 'settled';

ALTER TABLE public.sales_return_events
  ADD CONSTRAINT sales_return_events_contract_version_check
    CHECK (contract_version IS NULL OR contract_version > 0),
  ADD CONSTRAINT sales_return_events_settlement_status_check
    CHECK (settlement_status IN ('draft', 'inspected', 'settled', 'cancelled')),
  ADD CONSTRAINT sales_return_events_settlement_time_check
    CHECK (
      contract_version IS NULL
      OR (settlement_status = 'settled' AND settled_at IS NOT NULL)
      OR (settlement_status <> 'settled' AND settled_at IS NULL)
    ),
  ADD CONSTRAINT sales_return_events_debt_reduction_check
    CHECK (debt_reduction_amount_in_minor_units >= 0),
  ADD CONSTRAINT sales_return_events_financial_source_snapshots_check
    CHECK (
      (contract_version IS NULL
        AND outstanding_debt_before_snapshot_in_minor_units IS NULL
        AND net_collected_before_snapshot_in_minor_units IS NULL)
      OR (contract_version IS NOT NULL
        AND outstanding_debt_before_snapshot_in_minor_units >= 0
        AND net_collected_before_snapshot_in_minor_units >= 0)
    ),
  ADD CONSTRAINT sales_return_events_money_refund_check
    CHECK (money_refund_amount_in_minor_units >= 0),
  ADD CONSTRAINT sales_return_events_damage_amounts_check
    CHECK (
      raw_customer_damage_deduction_in_minor_units >= 0
      AND applied_customer_damage_deduction_in_minor_units >= 0
      AND applied_customer_damage_deduction_in_minor_units
        <= raw_customer_damage_deduction_in_minor_units
    ),
  ADD CONSTRAINT sales_return_events_money_method_shape_check
    CHECK (
      contract_version IS NULL
      OR (
        (money_refund_amount_in_minor_units = 0
          AND refund_method IS NULL
          AND cash_shift_id IS NULL
          AND reference_number IS NULL)
        OR
        (money_refund_amount_in_minor_units > 0
          AND refund_method IN ('cash', 'cliq')
          AND cash_shift_id IS NOT NULL
          AND (refund_method <> 'cliq'
            OR NULLIF(BTRIM(reference_number), '') IS NOT NULL))
      )
    );

-- Existing return rows predate split debt/refund evidence. Keep their original
-- merchandise value authoritative and exempt them from the new equality; only
-- versioned Phase-4 rows must reconcile the split exactly.
ALTER TABLE public.sales_return_events
  ADD CONSTRAINT sales_return_events_phase4_financial_identity_check
    CHECK (
      contract_version IS NULL
      OR (
        merchandise_refund_amount_in_minor_units
          = debt_reduction_amount_in_minor_units + money_refund_amount_in_minor_units
        AND debt_reduction_amount_in_minor_units
          <= outstanding_debt_before_snapshot_in_minor_units
        AND money_refund_amount_in_minor_units
          <= net_collected_before_snapshot_in_minor_units
      )
    );

-- SQL CHECK expressions that evaluate to UNKNOWN do not reject a row.  Make
-- every versioned source snapshot and money-method field explicit so a future
-- coordinator cannot finalize incomplete evidence through NULL semantics.
ALTER TABLE public.sales_return_events
  DROP CONSTRAINT sales_return_events_financial_source_snapshots_check,
  DROP CONSTRAINT sales_return_events_money_method_shape_check,
  ADD CONSTRAINT sales_return_events_financial_source_snapshots_check CHECK (
    (contract_version IS NULL
      AND outstanding_debt_before_snapshot_in_minor_units IS NULL
      AND net_collected_before_snapshot_in_minor_units IS NULL)
    OR (contract_version IS NOT NULL
      AND outstanding_debt_before_snapshot_in_minor_units IS NOT NULL
      AND outstanding_debt_before_snapshot_in_minor_units >= 0
      AND net_collected_before_snapshot_in_minor_units IS NOT NULL
      AND net_collected_before_snapshot_in_minor_units >= 0)
  ),
  ADD CONSTRAINT sales_return_events_money_method_shape_check CHECK (
    contract_version IS NULL
    OR (money_refund_amount_in_minor_units = 0
      AND refund_method IS NULL
      AND cash_shift_id IS NULL
      AND reference_number IS NULL)
    OR (money_refund_amount_in_minor_units > 0
      AND refund_method IS NOT NULL
      AND refund_method IN ('cash', 'cliq')
      AND cash_shift_id IS NOT NULL
      AND (refund_method <> 'cliq'
        OR NULLIF(BTRIM(reference_number), '') IS NOT NULL))
  );

-- Phase-4 uses one exact idempotency-key identity everywhere: PostgreSQL
-- BTRIM semantics (ordinary leading/trailing spaces only), case preserved.
-- Invalid values are rejected rather than normalized into a usable key.
CREATE FUNCTION public.phase4_canonicalize_idempotency_key_internal(
  p_idempotency_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
BEGIN
  IF v_key IS NULL OR CHAR_LENGTH(v_key) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_IDEMPOTENCY_KEY_INVALID: Phase-4 idempotency key must be non-empty and at most 255 characters after canonicalization.';
  END IF;
  RETURN v_key;
END;
$$;

-- One typed result validator is shared by operation creation, entity binding,
-- and replay.  A committed-success result requires JSON Boolean true exactly;
-- textual, false, null, numeric, object, array, and missing substitutes fail.
CREATE FUNCTION public.phase4_assert_success_result_internal(
  p_operation_id UUID,
  p_operation_type TEXT,
  p_result_snapshot JSONB,
  p_expected_entity_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_id_key TEXT;
BEGIN
  IF p_operation_id IS NULL
    OR p_operation_type IS NULL
    OR p_operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
    OR p_result_snapshot IS NULL
    OR JSONB_TYPEOF(p_result_snapshot) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_RESULT_IDENTITY_INVALID: Stored Phase-4 result is not a typed committed-success object.';
  END IF;

  v_expected_id_key := CASE p_operation_type
    WHEN 'phase4_return_v1' THEN 'returnId'
    ELSE 'replacementId'
  END;

  IF JSONB_TYPEOF(p_result_snapshot->'success') IS DISTINCT FROM 'boolean'
    OR p_result_snapshot->'success' IS DISTINCT FROM 'true'::JSONB
    OR COALESCE(LOWER(p_result_snapshot->>'operationId'), '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR LOWER(p_result_snapshot->>'operationId')
      IS DISTINCT FROM LOWER(p_operation_id::TEXT)
    OR COALESCE(LOWER(p_result_snapshot->>v_expected_id_key), '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_expected_entity_id IS NOT NULL
      AND LOWER(p_result_snapshot->>v_expected_id_key)
        IS DISTINCT FROM LOWER(p_expected_entity_id::TEXT))
    OR (p_operation_type = 'phase4_return_v1'
      AND p_result_snapshot ? 'replacementId')
    OR (p_operation_type = 'phase4_replacement_v1'
      AND p_result_snapshot ? 'returnId')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_RESULT_IDENTITY_INVALID: Stored result does not match its Phase-4 operation and entity.';
  END IF;
END;
$$;

-- Phase-4 operation identity is actor-scoped.  A canonical key may be reused
-- by a different actor without revealing another actor's result, while the
-- same actor/type/key can identify only one immutable request.
ALTER TABLE public.business_operations
  ADD CONSTRAINT business_operations_phase4_shape_check CHECK (
    operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
    OR (
      idempotency_key IS NOT NULL
      AND idempotency_key IS NOT DISTINCT FROM BTRIM(idempotency_key)
      AND idempotency_key <> ''
      AND CHAR_LENGTH(idempotency_key) <= 255
      AND request_fingerprint IS NOT NULL
      AND request_identity_version IS NOT NULL
      AND request_identity_version IS NOT DISTINCT FROM 401
      AND request_identity_snapshot IS NOT NULL
      AND JSONB_TYPEOF(request_identity_snapshot) IS NOT DISTINCT FROM 'object'
      AND COALESCE(LOWER(request_identity_snapshot->>'order_id'), '') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND result_snapshot IS NOT NULL
      AND JSONB_TYPEOF(result_snapshot) IS NOT DISTINCT FROM 'object'
      AND JSONB_TYPEOF(result_snapshot->'success') IS NOT DISTINCT FROM 'boolean'
      AND result_snapshot->'success' IS NOT DISTINCT FROM 'true'::JSONB
      AND LOWER(result_snapshot->>'operationId')
        IS NOT DISTINCT FROM LOWER(id::TEXT)
      AND (
        (operation_type = 'phase4_return_v1'
          AND COALESCE(LOWER(result_snapshot->>'returnId'), '') ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND NOT (result_snapshot ? 'replacementId'))
        OR (operation_type = 'phase4_replacement_v1'
          AND COALESCE(LOWER(result_snapshot->>'replacementId'), '') ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND NOT (result_snapshot ? 'returnId'))
      )
      AND completed_at IS NOT NULL
      AND actor_scope_type IS NOT NULL
      AND actor_scope_type IS NOT DISTINCT FROM 'erp_user'
      AND actor_scope_hash IS NOT NULL
      AND initiated_by IS NOT NULL
    )
  );

CREATE UNIQUE INDEX uq_business_operations_phase4_actor_idempotency
  ON public.business_operations(
    operation_type, actor_scope_type, actor_scope_hash,
    (public.phase4_canonicalize_idempotency_key_internal(idempotency_key))
  )
  WHERE operation_type IN ('phase4_return_v1', 'phase4_replacement_v1')
    AND idempotency_key IS NOT NULL;

-- Every versioned aftercare operation has exactly one immutable root Order.
-- Serialize that root before the first operation/draft write so concurrent
-- creators cannot both acquire child/FK locks and later upgrade to the Order
-- lock in opposite directions during finalization.
CREATE FUNCTION public.phase4_lock_aftercare_order_gate_internal(
  p_operation_type TEXT,
  p_request_identity_snapshot JSONB,
  p_expected_order_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_text TEXT;
  v_order_id UUID;
BEGIN
  IF p_operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ORDER_IDENTITY_INVALID: Unsupported Phase-4 operation type.';
  END IF;

  IF p_request_identity_snapshot IS NULL
    OR JSONB_TYPEOF(p_request_identity_snapshot) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ORDER_IDENTITY_INVALID: Immutable request evidence must contain one root Order.';
  END IF;

  v_order_text := LOWER(NULLIF(BTRIM(
    p_request_identity_snapshot->>'order_id'
  ), ''));
  IF v_order_text IS NULL OR v_order_text !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ORDER_IDENTITY_INVALID: Immutable request evidence has an invalid root Order.';
  END IF;
  v_order_id := v_order_text::UUID;

  IF p_expected_order_id IS NOT NULL
    AND v_order_id IS DISTINCT FROM p_expected_order_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ORDER_IDENTITY_INVALID: Immutable request evidence does not match the aftercare root Order.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase4-order|' || v_order_id::TEXT, 0
  ));
  RETURN v_order_id;
END;
$$;

CREATE FUNCTION public.phase4_lock_aftercare_operation_order_internal(
  p_operation_id UUID,
  p_expected_order_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_type TEXT;
  v_request_identity_snapshot JSONB;
BEGIN
  SELECT operation.operation_type, operation.request_identity_snapshot
  INTO v_operation_type, v_request_identity_snapshot
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  RETURN public.phase4_lock_aftercare_order_gate_internal(
    v_operation_type, v_request_identity_snapshot, p_expected_order_id
  );
END;
$$;

-- Child evidence must discover its immutable root without taking row locks,
-- acquire the one Phase-4 Order gate, and only then lock/revalidate the
-- operation -> header -> child chain.  This keeps every supported evidence
-- writer on the same root-first graph while preserving historical Returns.
CREATE FUNCTION public.phase4_lock_aftercare_parent_order_internal(
  p_parent_kind TEXT,
  p_parent_id UUID,
  p_expected_operation_id UUID,
  p_expected_order_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id UUID;
  v_order_id UUID;
  v_contract_version SMALLINT;
  v_operation_type TEXT;
  v_request_identity_snapshot JSONB;
  v_fresh_operation_id UUID;
  v_fresh_order_id UUID;
  v_fresh_contract_version SMALLINT;
BEGIN
  IF p_parent_id IS NULL OR p_parent_kind NOT IN (
    'return_event', 'return_item',
    'replacement_event', 'replacement_item'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_PARENT_ROOT_IDENTITY_INVALID: Aftercare parent identity is invalid.';
  END IF;

  -- Discovery is deliberately non-locking.  No FK/header/child row lock may
  -- precede the canonical root advisory gate.
  IF p_parent_kind = 'return_event' THEN
    SELECT event.operation_id, event.order_id, event.contract_version
    INTO v_operation_id, v_order_id, v_contract_version
    FROM public.sales_return_events event
    WHERE event.id = p_parent_id;
  ELSIF p_parent_kind = 'return_item' THEN
    SELECT item.operation_id, item.order_id, event.contract_version
    INTO v_operation_id, v_order_id, v_contract_version
    FROM public.sales_return_items item
    JOIN public.sales_return_events event
      ON event.id = item.sales_return_event_id
    WHERE item.id = p_parent_id;
  ELSIF p_parent_kind = 'replacement_event' THEN
    SELECT event.operation_id, event.root_order_id, event.contract_version
    INTO v_operation_id, v_order_id, v_contract_version
    FROM public.sales_replacement_events event
    WHERE event.id = p_parent_id;
  ELSE
    SELECT item.operation_id, event.root_order_id, event.contract_version
    INTO v_operation_id, v_order_id, v_contract_version
    FROM public.sales_replacement_items item
    JOIN public.sales_replacement_events event
      ON event.id = item.replacement_event_id
    WHERE item.id = p_parent_id;
  END IF;

  IF v_operation_id IS NULL OR v_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_PARENT_ROOT_NOT_FOUND: Aftercare parent does not exist.';
  END IF;
  IF (p_expected_operation_id IS NOT NULL
      AND v_operation_id IS DISTINCT FROM p_expected_operation_id)
    OR (p_expected_order_id IS NOT NULL
      AND v_order_id IS DISTINCT FROM p_expected_order_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_PARENT_ROOT_IDENTITY_INVALID: Aftercare parent does not match the submitted operation or Order.';
  END IF;

  SELECT operation.operation_type, operation.request_identity_snapshot
  INTO v_operation_type, v_request_identity_snapshot
  FROM public.business_operations operation
  WHERE operation.id = v_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  -- Historical Return rows keep the pre-Phase-4 contract.  A Phase-4
  -- operation may never masquerade as one by omitting the parent version.
  IF v_contract_version IS NULL
    AND p_parent_kind IN ('return_event', 'return_item')
    AND v_operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
  THEN
    RETURN v_order_id;
  END IF;
  IF v_contract_version IS DISTINCT FROM 401 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_PARENT_CONTRACT_INVALID: Versioned aftercare evidence requires contract version 401.';
  END IF;

  PERFORM public.phase4_lock_aftercare_order_gate_internal(
    v_operation_type, v_request_identity_snapshot, v_order_id
  );

  -- Fresh lock/revalidation after the gate.  Operation always precedes its
  -- header, and an item parent is locked only after its header.
  SELECT operation.operation_type, operation.request_identity_snapshot
  INTO v_operation_type, v_request_identity_snapshot
  FROM public.business_operations operation
  WHERE operation.id = v_operation_id
  FOR SHARE;
  IF NOT FOUND
    OR v_operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1')
    OR LOWER(v_request_identity_snapshot->>'order_id')
      IS DISTINCT FROM LOWER(v_order_id::TEXT)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_PARENT_ROOT_REVALIDATION_FAILED: Operation root identity changed during evidence creation.';
  END IF;

  IF p_parent_kind IN ('return_event', 'return_item') THEN
    SELECT event.operation_id, event.order_id, event.contract_version
    INTO v_fresh_operation_id, v_fresh_order_id, v_fresh_contract_version
    FROM public.sales_return_events event
    WHERE event.id = CASE p_parent_kind
      WHEN 'return_event' THEN p_parent_id
      ELSE (SELECT item.sales_return_event_id
        FROM public.sales_return_items item WHERE item.id = p_parent_id)
    END
    FOR SHARE;
    IF p_parent_kind = 'return_item' THEN
      PERFORM 1 FROM public.sales_return_items item
      WHERE item.id = p_parent_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503',
          MESSAGE = 'PHASE4_PARENT_ROOT_NOT_FOUND: Return Item parent does not exist.';
      END IF;
    END IF;
    IF v_operation_type IS DISTINCT FROM 'phase4_return_v1' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_PARENT_CONTRACT_INVALID: Return evidence requires a Return operation.';
    END IF;
  ELSE
    SELECT event.operation_id, event.root_order_id, event.contract_version
    INTO v_fresh_operation_id, v_fresh_order_id, v_fresh_contract_version
    FROM public.sales_replacement_events event
    WHERE event.id = CASE p_parent_kind
      WHEN 'replacement_event' THEN p_parent_id
      ELSE (SELECT item.replacement_event_id
        FROM public.sales_replacement_items item WHERE item.id = p_parent_id)
    END
    FOR SHARE;
    IF p_parent_kind = 'replacement_item' THEN
      PERFORM 1 FROM public.sales_replacement_items item
      WHERE item.id = p_parent_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503',
          MESSAGE = 'PHASE4_PARENT_ROOT_NOT_FOUND: Replacement Item parent does not exist.';
      END IF;
    END IF;
    IF v_operation_type IS DISTINCT FROM 'phase4_replacement_v1' THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_PARENT_CONTRACT_INVALID: Replacement evidence requires a Replacement operation.';
    END IF;
  END IF;

  IF v_fresh_operation_id IS DISTINCT FROM v_operation_id
    OR v_fresh_order_id IS DISTINCT FROM v_order_id
    OR v_fresh_contract_version IS DISTINCT FROM 401
  THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_PARENT_ROOT_REVALIDATION_FAILED: Parent identity changed; retry safely.';
  END IF;
  RETURN v_order_id;
END;
$$;

CREATE FUNCTION public.phase4_guard_aftercare_operation_order_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.operation_type NOT IN ('phase4_return_v1', 'phase4_replacement_v1') THEN
    RETURN NEW;
  END IF;

  -- This is the single earliest Phase-4 write boundary. Invalid operations are
  -- rejected with zero writes; valid operations acquire their root Order gate
  -- before the INSERT can take FK locks or persist evidence.
  IF COALESCE(NEW.request_fingerprint, '') !~ '^[0-9a-f]{64}$'
    OR NEW.request_identity_version IS DISTINCT FROM 401
    OR NEW.request_identity_snapshot IS NULL
    OR JSONB_TYPEOF(NEW.request_identity_snapshot) IS DISTINCT FROM 'object'
    OR COALESCE(LOWER(NEW.request_identity_snapshot->>'order_id'), '') !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NEW.completed_at IS NULL
    OR NEW.actor_scope_type IS DISTINCT FROM 'erp_user'
    OR COALESCE(NEW.actor_scope_hash, '') !~ '^[0-9a-f]{64}$'
    OR NEW.initiated_by IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_OPERATION_INSERT_SHAPE_INVALID: Phase-4 operation identity and structural result evidence must be complete.';
  END IF;

  NEW.idempotency_key := public.phase4_canonicalize_idempotency_key_internal(
    NEW.idempotency_key
  );

  PERFORM public.phase4_assert_success_result_internal(
    NEW.id, NEW.operation_type, NEW.result_snapshot, NULL
  );

  PERFORM public.phase4_lock_aftercare_order_gate_internal(
    NEW.operation_type, NEW.request_identity_snapshot, NULL
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_guard_aftercare_operation_order_gate
BEFORE INSERT ON public.business_operations
FOR EACH ROW EXECUTE FUNCTION public.phase4_guard_aftercare_operation_order_gate();

-- One relational boundary binds every versioned Phase-4 entity to the
-- immutable operation/result identity that owns it. Legacy Return rows remain
-- valid only when their operation is not a Phase-4 versioned operation.
CREATE FUNCTION public.phase4_assert_aftercare_operation_binding_internal(
  p_operation_id UUID,
  p_entity_kind TEXT,
  p_entity_id UUID,
  p_contract_version SMALLINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_expected_type TEXT;
BEGIN
  IF p_operation_id IS NULL OR p_entity_id IS NULL
    OR p_entity_kind NOT IN ('return', 'replacement')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH: Aftercare entity identity is invalid.';
  END IF;

  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  v_expected_type := CASE p_entity_kind
    WHEN 'return' THEN 'phase4_return_v1'
    ELSE 'phase4_replacement_v1'
  END;
  IF v_operation.operation_type NOT IN (
      'phase4_return_v1', 'phase4_replacement_v1'
    )
  THEN
    IF p_entity_kind = 'return' AND p_contract_version IS NULL THEN
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH: Versioned aftercare evidence requires its matching Phase-4 operation type.';
  END IF;

  IF v_operation.operation_type IS DISTINCT FROM v_expected_type
    OR p_contract_version IS DISTINCT FROM 401
    OR v_operation.request_identity_version IS DISTINCT FROM 401
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_ENTITY_CONTRACT_MISMATCH: Operation type, entity kind, and contract version do not match.';
  END IF;

  PERFORM public.phase4_assert_success_result_internal(
    v_operation.id, v_operation.operation_type,
    v_operation.result_snapshot, p_entity_id
  );
END;
$$;

CREATE FUNCTION public.phase4_resolve_operation_replay_internal(
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

  RETURN JSONB_BUILD_OBJECT(
    'decision', 'REPLAY',
    'operation_id', v_operation.id,
    'result_snapshot', v_operation.result_snapshot
  );
END;
$$;

ALTER TABLE public.sales_return_items
  ADD COLUMN accepted_base_quantity INTEGER,
  ADD COLUMN rejected_base_quantity INTEGER,
  ADD COLUMN original_cogs_snapshot_in_minor_units BIGINT,
  ADD COLUMN raw_customer_damage_deduction_in_minor_units BIGINT,
  ADD COLUMN applied_customer_damage_deduction_in_minor_units BIGINT;

ALTER TABLE public.sales_return_items
  ADD CONSTRAINT sales_return_items_id_operation_unique
    UNIQUE (id, operation_id);

ALTER TABLE public.sales_return_items
  ADD CONSTRAINT sales_return_items_inspection_quantities_check
    CHECK (
      (accepted_base_quantity IS NULL AND rejected_base_quantity IS NULL)
      OR (accepted_base_quantity >= 0 AND rejected_base_quantity >= 0
        AND accepted_base_quantity + rejected_base_quantity > 0)
    ),
  ADD CONSTRAINT sales_return_items_original_cogs_check
    CHECK (original_cogs_snapshot_in_minor_units IS NULL
      OR original_cogs_snapshot_in_minor_units >= 0),
  ADD CONSTRAINT sales_return_items_damage_deduction_check
    CHECK (
      (raw_customer_damage_deduction_in_minor_units IS NULL
        AND applied_customer_damage_deduction_in_minor_units IS NULL)
      OR (raw_customer_damage_deduction_in_minor_units >= 0
        AND applied_customer_damage_deduction_in_minor_units >= 0
        AND applied_customer_damage_deduction_in_minor_units
          <= raw_customer_damage_deduction_in_minor_units)
    );

CREATE TABLE public.sales_return_component_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_item_id UUID NOT NULL
    REFERENCES public.sales_return_items(id) ON DELETE RESTRICT,
  return_operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  parcel_component_id UUID NOT NULL
    REFERENCES public.order_parcel_components(id) ON DELETE RESTRICT,
  original_sale_operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  accepted_quantity INTEGER NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity INTEGER NOT NULL CHECK (rejected_quantity >= 0),
  accepted_condition TEXT
    CHECK (accepted_condition IN ('sellable', 'supplier_defect')),
  accepted_stock_disposition TEXT
    CHECK (accepted_stock_disposition IN ('restock', 'non_sellable')),
  rejection_reason TEXT
    CHECK (rejection_reason = 'customer_damage'),
  rejected_stock_disposition TEXT
    CHECK (rejected_stock_disposition = 'returned_to_customer'),
  effective_standalone_unit_sale_price_snapshot_in_minor_units BIGINT,
  raw_customer_damage_deduction_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (raw_customer_damage_deduction_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sales_return_item_id, parcel_component_id),
  FOREIGN KEY (sales_return_item_id, return_operation_id)
    REFERENCES public.sales_return_items(id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (parcel_component_id, product_id, original_sale_operation_id)
    REFERENCES public.order_parcel_components(id, product_id, operation_id)
    ON DELETE RESTRICT,
  CHECK (accepted_quantity + rejected_quantity > 0),
  CONSTRAINT sales_return_component_inspections_accepted_shape_check CHECK (
    (accepted_quantity = 0
      AND accepted_condition IS NULL
      AND accepted_stock_disposition IS NULL)
    OR (accepted_quantity > 0
      AND accepted_condition IS NOT NULL
      AND accepted_stock_disposition IS NOT NULL
      AND ((accepted_condition = 'sellable'
          AND accepted_stock_disposition = 'restock')
        OR (accepted_condition = 'supplier_defect'
          AND accepted_stock_disposition = 'non_sellable')))
  ),
  CONSTRAINT sales_return_component_inspections_rejected_shape_check CHECK (
    (rejected_quantity = 0
      AND rejection_reason IS NULL
      AND rejected_stock_disposition IS NULL
      AND raw_customer_damage_deduction_in_minor_units = 0)
    OR (rejected_quantity > 0
      AND rejection_reason IS NOT NULL
      AND rejection_reason = 'customer_damage'
      AND rejected_stock_disposition IS NOT NULL
      AND rejected_stock_disposition = 'returned_to_customer'
      AND effective_standalone_unit_sale_price_snapshot_in_minor_units IS NOT NULL
      AND effective_standalone_unit_sale_price_snapshot_in_minor_units >= 0
      AND raw_customer_damage_deduction_in_minor_units
        = rejected_quantity::BIGINT
          * effective_standalone_unit_sale_price_snapshot_in_minor_units)
  )
);

CREATE FUNCTION public.phase4_prepare_component_inspection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_return_operation_id UUID;
  v_parcel_instance_id UUID;
  v_return_status TEXT;
  v_component_operation_id UUID;
  v_component_product_id UUID;
  v_component_quantity INTEGER;
  v_component_price BIGINT;
BEGIN
  PERFORM public.phase4_lock_aftercare_parent_order_internal(
    'return_item', NEW.sales_return_item_id,
    NEW.return_operation_id, NULL
  );

  SELECT return_item.operation_id, return_item.parcel_instance_id,
    return_event.settlement_status
  INTO v_return_operation_id, v_parcel_instance_id, v_return_status
  FROM public.sales_return_items return_item
  JOIN public.sales_return_events return_event
    ON return_event.id = return_item.sales_return_event_id
  WHERE return_item.id = NEW.sales_return_item_id
    AND return_item.return_scope = 'parcel_instance'
  FOR SHARE;

  SELECT component.operation_id, component.product_id,
    component.base_quantity,
    component.effective_standalone_unit_sale_price_snapshot_in_minor_units
  INTO v_component_operation_id, v_component_product_id,
    v_component_quantity, v_component_price
  FROM public.order_parcel_components component
  WHERE component.id = NEW.parcel_component_id
    AND component.parcel_instance_id = v_parcel_instance_id
  FOR SHARE;

  IF v_return_operation_id IS NULL OR v_component_operation_id IS NULL
    OR v_return_status NOT IN ('draft', 'inspected')
    OR NEW.return_operation_id IS DISTINCT FROM v_return_operation_id
    OR NEW.original_sale_operation_id IS DISTINCT FROM v_component_operation_id
    OR NEW.product_id IS DISTINCT FROM v_component_product_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_COMPONENT_INSPECTION_CHAIN_INVALID: Inspection must reference one original Parcel Component and Return operation.';
  END IF;

  IF NEW.accepted_quantity + NEW.rejected_quantity
      IS DISTINCT FROM v_component_quantity
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_COMPONENT_INSPECTION_QUANTITY_INVALID: Inspection must account for the complete original Component quantity.';
  END IF;

  IF NEW.rejected_quantity > 0 AND v_component_price IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_EFFECTIVE_STANDALONE_PRICE_MISSING: Customer-damage deduction cannot be proven for this historical Component.';
  END IF;

  NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units :=
    v_component_price;
  NEW.raw_customer_damage_deduction_in_minor_units :=
    NEW.rejected_quantity::BIGINT * COALESCE(v_component_price, 0);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_prepare_component_inspection
BEFORE INSERT ON public.sales_return_component_inspections
FOR EACH ROW EXECUTE FUNCTION public.phase4_prepare_component_inspection();

CREATE FUNCTION public.phase4_guard_return_event_insert_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Historical/non-versioned Returns keep their pre-Phase-4 contract. Only a
  -- versioned Return participates in the new root-Order serialization gate.
  IF NEW.contract_version IS NOT NULL THEN
    PERFORM public.phase4_lock_aftercare_operation_order_internal(
      NEW.operation_id, NEW.order_id
    );
  END IF;
  PERFORM public.phase4_assert_aftercare_operation_binding_internal(
    NEW.operation_id, 'return', NEW.id, NEW.contract_version
  );
  IF NEW.contract_version IS NOT NULL
    AND (NEW.settlement_status IS DISTINCT FROM 'draft'
      OR NEW.settled_at IS NOT NULL)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_INITIAL_STATE_INVALID: Versioned Return evidence must begin as an unsettled draft.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_guard_return_event_insert_state
BEFORE INSERT ON public.sales_return_events
FOR EACH ROW EXECUTE FUNCTION public.phase4_guard_return_event_insert_state();

-- Replacement is deliberately a separate operation from Return/Refund.
CREATE TABLE public.sales_replacement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  root_order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  contract_version SMALLINT NOT NULL CHECK (contract_version > 0),
  replacement_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (replacement_status IN ('draft', 'settled', 'cancelled')),
  original_completed_at_snapshot TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (replacement_status = 'settled' AND settled_at IS NOT NULL)
    OR (replacement_status <> 'settled' AND settled_at IS NULL)
  )
);

CREATE FUNCTION public.phase4_guard_replacement_event_insert_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.phase4_lock_aftercare_operation_order_internal(
    NEW.operation_id, NEW.root_order_id
  );
  PERFORM public.phase4_assert_aftercare_operation_binding_internal(
    NEW.operation_id, 'replacement', NEW.id, NEW.contract_version
  );
  IF NEW.replacement_status IS DISTINCT FROM 'draft'
    OR NEW.settled_at IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_INITIAL_STATE_INVALID: Replacement evidence must begin as an unsettled draft.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_guard_replacement_event_insert_state
BEFORE INSERT ON public.sales_replacement_events
FOR EACH ROW EXECUTE FUNCTION public.phase4_guard_replacement_event_insert_state();

ALTER TABLE public.sales_replacement_events
  ADD CONSTRAINT sales_replacement_events_id_operation_unique
    UNIQUE (id, operation_id);

CREATE TABLE public.sales_replacement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replacement_event_id UUID NOT NULL
    REFERENCES public.sales_replacement_events(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  root_order_item_id UUID NOT NULL
    REFERENCES public.order_items(id) ON DELETE RESTRICT,
  root_parcel_instance_id UUID
    REFERENCES public.order_parcel_instances(id) ON DELETE RESTRICT,
  root_parcel_component_id UUID
    REFERENCES public.order_parcel_components(id) ON DELETE RESTRICT,
  original_sale_operation_id UUID,
  parent_replacement_item_id UUID
    REFERENCES public.sales_replacement_items(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  replacement_unit_cost_snapshot_in_minor_units_exact NUMERIC(24, 6) NOT NULL
    CHECK (replacement_unit_cost_snapshot_in_minor_units_exact >= 0),
  replacement_cogs_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (replacement_cogs_snapshot_in_minor_units >= 0),
  condition_code TEXT NOT NULL
    CHECK (condition_code = 'supplier_defect'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (root_parcel_instance_id IS NULL AND root_parcel_component_id IS NULL)
    OR (root_parcel_instance_id IS NOT NULL AND root_parcel_component_id IS NOT NULL)
  ),
  FOREIGN KEY (replacement_event_id, operation_id)
    REFERENCES public.sales_replacement_events(id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    root_parcel_component_id,
    product_id,
    original_sale_operation_id
  ) REFERENCES public.order_parcel_components(id, product_id, operation_id)
    ON DELETE RESTRICT,
  CHECK (
    (root_parcel_component_id IS NULL AND original_sale_operation_id IS NULL)
    OR (root_parcel_component_id IS NOT NULL
      AND original_sale_operation_id IS NOT NULL)
  )
);

CREATE FUNCTION public.phase4_validate_replacement_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_root_order_id UUID;
  v_event_operation_id UUID;
  v_event_status TEXT;
  v_order_item_order_id UUID;
  v_order_item_product_id UUID;
  v_component_instance_id UUID;
  v_component_operation_id UUID;
  v_component_product_id UUID;
  v_parent public.sales_replacement_items%ROWTYPE;
BEGIN
  PERFORM public.phase4_lock_aftercare_parent_order_internal(
    'replacement_event', NEW.replacement_event_id,
    NEW.operation_id, NULL
  );

  SELECT event.root_order_id, event.operation_id, event.replacement_status
  INTO v_root_order_id, v_event_operation_id, v_event_status
  FROM public.sales_replacement_events event
  WHERE event.id = NEW.replacement_event_id
  FOR SHARE;

  SELECT item.order_id, item.product_id
  INTO v_order_item_order_id, v_order_item_product_id
  FROM public.order_items item
  WHERE item.id = NEW.root_order_item_id
  FOR SHARE;

  IF v_root_order_id IS NULL
    OR NEW.operation_id IS DISTINCT FROM v_event_operation_id
    OR v_order_item_order_id IS DISTINCT FROM v_root_order_id
    OR v_event_status IS DISTINCT FROM 'draft'
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_REPLACEMENT_ROOT_INVALID: Replacement must remain linked to its original sale and operation.';
  END IF;

  IF NEW.root_parcel_component_id IS NULL THEN
    IF NEW.root_parcel_instance_id IS NOT NULL
      OR NEW.original_sale_operation_id IS NOT NULL
      OR NEW.product_id IS DISTINCT FROM v_order_item_product_id
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_REPLACEMENT_SKU_INVALID: Base Unit replacement must use the same original SKU.';
    END IF;
  ELSE
    SELECT component.parcel_instance_id, component.operation_id,
      component.product_id
    INTO v_component_instance_id, v_component_operation_id,
      v_component_product_id
    FROM public.order_parcel_components component
    WHERE component.id = NEW.root_parcel_component_id
    FOR SHARE;

    IF v_component_instance_id IS DISTINCT FROM NEW.root_parcel_instance_id
      OR v_component_operation_id IS DISTINCT FROM NEW.original_sale_operation_id
      OR v_component_product_id IS DISTINCT FROM NEW.product_id
      OR NOT EXISTS (
        SELECT 1 FROM public.order_parcel_instances instance
        WHERE instance.id = NEW.root_parcel_instance_id
          AND instance.order_item_id = NEW.root_order_item_id
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_REPLACEMENT_COMPONENT_INVALID: Replacement must use the same original Parcel Component SKU.';
    END IF;
  END IF;

  IF NEW.parent_replacement_item_id IS NOT NULL THEN
    SELECT * INTO v_parent
    FROM public.sales_replacement_items parent
    WHERE parent.id = NEW.parent_replacement_item_id
    FOR SHARE;
    IF NOT FOUND
      OR v_parent.root_order_item_id IS DISTINCT FROM NEW.root_order_item_id
      OR v_parent.root_parcel_instance_id IS DISTINCT FROM NEW.root_parcel_instance_id
      OR v_parent.root_parcel_component_id IS DISTINCT FROM NEW.root_parcel_component_id
      OR v_parent.product_id IS DISTINCT FROM NEW.product_id
      OR NOT EXISTS (
        SELECT 1
        FROM public.sales_replacement_events parent_event
        WHERE parent_event.id = v_parent.replacement_event_id
          AND parent_event.replacement_status = 'settled'
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_REPLACEMENT_LINEAGE_INVALID: Replacement lineage must retain the original commercial root and SKU.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_validate_replacement_item
BEFORE INSERT ON public.sales_replacement_items
FOR EACH ROW EXECUTE FUNCTION public.phase4_validate_replacement_item();

CREATE FUNCTION public.phase4_validate_return_item_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_contract_version SMALLINT;
  v_status TEXT;
  v_event_operation_id UUID;
  v_event_order_id UUID;
  v_original_entitlement BIGINT;
  v_original_cogs BIGINT;
  v_total_units INTEGER;
BEGIN
  PERFORM public.phase4_lock_aftercare_parent_order_internal(
    'return_event', NEW.sales_return_event_id,
    NEW.operation_id, NEW.order_id
  );

  SELECT event.contract_version, event.settlement_status,
    event.operation_id, event.order_id
  INTO v_contract_version, v_status, v_event_operation_id, v_event_order_id
  FROM public.sales_return_events event
  WHERE event.id = NEW.sales_return_event_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_RETURN_EVENT_REQUIRED: Return Item must reference an existing Return event.';
  END IF;
  IF v_contract_version IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_contract_version IS DISTINCT FROM 401
    OR v_event_operation_id IS DISTINCT FROM NEW.operation_id
    OR v_event_order_id IS DISTINCT FROM NEW.order_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_RETURN_ITEM_CHAIN_INVALID: Versioned Return Item must match its event operation and order.';
  END IF;
  IF v_status NOT IN ('draft', 'inspected') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_EVIDENCE_CLOSED: Versioned Return evidence is closed.';
  END IF;

  -- A versioned Return Item is immutable, so all settlement-relevant evidence
  -- must be structurally complete at its first and only write.  Historical
  -- Return Items retain their nullable pre-Phase-4 shape above.
  IF NEW.accepted_base_quantity IS NULL
    OR NEW.rejected_base_quantity IS NULL
    OR NEW.original_cogs_snapshot_in_minor_units IS NULL
    OR NEW.raw_customer_damage_deduction_in_minor_units IS NULL
    OR NEW.applied_customer_damage_deduction_in_minor_units IS NULL
    OR NEW.accepted_base_quantity < 0
    OR NEW.rejected_base_quantity < 0
    OR NEW.accepted_base_quantity + NEW.rejected_base_quantity <= 0
    OR NEW.original_cogs_snapshot_in_minor_units < 0
    OR NEW.raw_customer_damage_deduction_in_minor_units < 0
    OR NEW.applied_customer_damage_deduction_in_minor_units < 0
    OR NEW.applied_customer_damage_deduction_in_minor_units
      > NEW.raw_customer_damage_deduction_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'PHASE4_RETURN_ITEM_EVIDENCE_INCOMPLETE: Versioned Return Item evidence must be complete and internally valid.';
  END IF;

  IF NEW.return_scope = 'base_unit' THEN
    IF NEW.accepted_base_quantity + NEW.rejected_base_quantity
        IS DISTINCT FROM NEW.returned_quantity
      OR NEW.raw_customer_damage_deduction_in_minor_units <> 0
      OR NEW.applied_customer_damage_deduction_in_minor_units <> 0
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_BASE_RETURN_ITEM_EVIDENCE_INVALID: Base Unit Return evidence does not match its immutable quantity contract.';
    END IF;
  ELSE
    SELECT instance.net_refundable_amount_snapshot_in_minor_units,
      instance.cogs_snapshot_in_minor_units,
      instance.units_per_parcel_snapshot
    INTO v_original_entitlement, v_original_cogs, v_total_units
    FROM public.order_parcel_instances instance
    WHERE instance.id = NEW.parcel_instance_id
      AND instance.order_item_id = NEW.order_item_id
    FOR SHARE;

    IF NOT FOUND
      OR NEW.accepted_base_quantity + NEW.rejected_base_quantity
        IS DISTINCT FROM v_total_units
      OR NEW.original_cogs_snapshot_in_minor_units
        IS DISTINCT FROM v_original_cogs
      OR NEW.applied_customer_damage_deduction_in_minor_units
        IS DISTINCT FROM LEAST(
          v_original_entitlement,
          NEW.raw_customer_damage_deduction_in_minor_units
        )
      OR NEW.refund_amount_snapshot_in_minor_units IS DISTINCT FROM
        v_original_entitlement
          - NEW.applied_customer_damage_deduction_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_PARCEL_RETURN_ITEM_EVIDENCE_INVALID: Parcel Return evidence does not match its immutable sale snapshots.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_validate_return_item_insert
BEFORE INSERT ON public.sales_return_items
FOR EACH ROW EXECUTE FUNCTION public.phase4_validate_return_item_insert();

ALTER TABLE public.sales_replacement_items
  ADD CONSTRAINT sales_replacement_items_id_operation_unique
    UNIQUE (id, operation_id);

-- Shared aggregate consumption ledger.  It is not a physical serial number;
-- it records how much of one immutable commercial source has been consumed by
-- Return or Replacement operations.  Protected finalization performs the
-- cumulative bound under one source lock.
CREATE TABLE public.sales_aftercare_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  return_item_id UUID REFERENCES public.sales_return_items(id) ON DELETE RESTRICT,
  replacement_item_id UUID
    REFERENCES public.sales_replacement_items(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('base_order_item', 'parcel_component', 'replacement_item')),
  source_id UUID NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  consumed_quantity INTEGER NOT NULL CHECK (consumed_quantity > 0),
  consumption_kind TEXT NOT NULL CHECK (consumption_kind IN ('return', 'replacement')),
  consumption_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (consumption_state IN ('draft', 'settled', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  CHECK ((return_item_id IS NULL) <> (replacement_item_id IS NULL)),
  CHECK (
    (consumption_kind = 'return' AND return_item_id IS NOT NULL)
    OR (consumption_kind = 'replacement' AND replacement_item_id IS NOT NULL)
  ),
  CHECK (
    (consumption_state = 'settled' AND settled_at IS NOT NULL)
    OR (consumption_state <> 'settled' AND settled_at IS NULL)
  ),
  FOREIGN KEY (return_item_id, operation_id)
    REFERENCES public.sales_return_items(id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (replacement_item_id, operation_id)
    REFERENCES public.sales_replacement_items(id, operation_id) ON DELETE RESTRICT
);

CREATE FUNCTION public.phase4_validate_aftercare_consumption_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.return_item_id IS NOT NULL THEN
    PERFORM public.phase4_lock_aftercare_parent_order_internal(
      'return_item', NEW.return_item_id, NEW.operation_id, NULL
    );
  ELSE
    PERFORM public.phase4_lock_aftercare_parent_order_internal(
      'replacement_item', NEW.replacement_item_id, NEW.operation_id, NULL
    );
  END IF;

  IF NEW.consumption_state IS DISTINCT FROM 'draft'
    OR NEW.settled_at IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_CONSUMPTION_INITIAL_STATE_INVALID: Aftercare consumption must begin as an unsettled draft.';
  END IF;

  IF NEW.return_item_id IS NOT NULL THEN
    SELECT event.settlement_status INTO v_status
    FROM public.sales_return_items item
    JOIN public.sales_return_events event
      ON event.id = item.sales_return_event_id
    WHERE item.id = NEW.return_item_id
      AND item.operation_id = NEW.operation_id
    FOR SHARE OF event;
    IF v_status NOT IN ('draft', 'inspected') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_EVIDENCE_CLOSED: Versioned Return evidence is closed.';
    END IF;
  ELSE
    SELECT event.replacement_status INTO v_status
    FROM public.sales_replacement_items item
    JOIN public.sales_replacement_events event
      ON event.id = item.replacement_event_id
    WHERE item.id = NEW.replacement_item_id
      AND item.operation_id = NEW.operation_id
    FOR SHARE OF event;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_EVIDENCE_CLOSED: Replacement evidence is closed.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_validate_aftercare_consumption_insert
BEFORE INSERT ON public.sales_aftercare_consumptions
FOR EACH ROW EXECUTE FUNCTION public.phase4_validate_aftercare_consumption_insert();

-- Resolve a physical source to the immutable commercial root it currently
-- represents.  Replacement rows carry their root explicitly, so no guessed
-- history or physical serial number is required.
CREATE FUNCTION public.phase4_aftercare_source_root_internal(
  p_source_kind TEXT,
  p_source_id UUID,
  p_product_id UUID
)
RETURNS TABLE(root_kind TEXT, root_id UUID, product_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_source_kind IN ('base_order_item', 'parcel_component') THEN
    root_kind := p_source_kind;
    root_id := p_source_id;
    product_id := p_product_id;
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_source_kind = 'replacement_item' THEN
    RETURN QUERY
    SELECT CASE WHEN replacement.root_parcel_component_id IS NULL
        THEN 'base_order_item' ELSE 'parcel_component' END,
      COALESCE(replacement.root_parcel_component_id,
        replacement.root_order_item_id),
      replacement.product_id
    FROM public.sales_replacement_items replacement
    JOIN public.sales_replacement_events event
      ON event.id = replacement.replacement_event_id
    WHERE replacement.id = p_source_id
      AND replacement.product_id = p_product_id
      AND event.replacement_status = 'settled';
    RETURN;
  END IF;
END;
$$;

CREATE INDEX idx_phase4_consumptions_source
  ON public.sales_aftercare_consumptions(source_kind, source_id, consumption_state);
CREATE INDEX idx_phase4_consumptions_operation
  ON public.sales_aftercare_consumptions(operation_id);
CREATE INDEX idx_sales_replacement_items_root
  ON public.sales_replacement_items(root_order_item_id, root_parcel_instance_id);

-- Phase 1's unconditional uniqueness treated insertion as consumption. Phase
-- 4 distinguishes draft inspection from settlement; finalization below locks
-- the Parcel and enforces one settled Return instead.
DROP INDEX public.uq_sales_return_items_parcel_instance;
CREATE INDEX idx_sales_return_items_parcel_instance
  ON public.sales_return_items(parcel_instance_id)
  WHERE parcel_instance_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Finalization and cumulative invariants.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.phase4_authoritative_completion_internal(p_order_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_creation public.business_operations%ROWTYPE;
  v_completion_at TIMESTAMPTZ;
  v_completion_count INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_ORIGINAL_ORDER_NOT_FOUND: Original sale is unavailable.';
  END IF;
  IF v_order.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_ORIGINAL_SALE_NOT_COMPLETED: Returns and replacements require a completed original sale.';
  END IF;

  SELECT * INTO v_creation FROM public.business_operations operation
  WHERE operation.id = v_order.operation_id FOR SHARE;

  IF v_creation.operation_type = 'phase3_customer_reservation_v1' THEN
    SELECT COUNT(*)::INTEGER, MAX(operation.completed_at)
    INTO v_completion_count, v_completion_at
    FROM public.business_operations operation
    WHERE operation.operation_type = 'phase3_customer_completion_v1'
      AND operation.completed_at IS NOT NULL
      AND LOWER(operation.request_identity_snapshot->>'order_id')
        = LOWER(p_order_id::TEXT)
      AND LOWER(operation.result_snapshot->>'order_id')
        = LOWER(p_order_id::TEXT)
      AND operation.completed_at IS NOT DISTINCT FROM v_order.cost_finalized_at;

    IF v_completion_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_COMPLETION_EVIDENCE_UNPROVEN: Customer V2 completion identity is missing or ambiguous.';
    END IF;
  ELSE
    v_completion_at := v_creation.completed_at;
  END IF;

  IF v_completion_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_COMPLETION_EVIDENCE_UNPROVEN: Authoritative sale completion evidence is missing.';
  END IF;
  RETURN v_completion_at;
END;
$$;

CREATE FUNCTION public.phase4_finalize_aftercare_operation_internal(
  p_operation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_source RECORD;
  v_item RECORD;
  v_order_item public.order_items%ROWTYPE;
  v_return_event public.sales_return_events%ROWTYPE;
  v_replacement_event public.sales_replacement_events%ROWTYPE;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_completion_at TIMESTAMPTZ;
  v_item_count INTEGER;
  v_other_settled INTEGER;
  v_original_entitlement BIGINT;
  v_original_cogs BIGINT;
  v_total_units INTEGER;
  v_accepted_units INTEGER;
  v_rejected_units INTEGER;
  v_raw_damage BIGINT;
  v_expected_applied_damage BIGINT;
  v_item_refund_total BIGINT;
  v_item_raw_total BIGINT;
  v_item_applied_total BIGINT;
  v_current_consumption INTEGER;
  v_cumulative_quantity INTEGER;
  v_cumulative_refund BIGINT;
  v_cumulative_cogs BIGINT;
  v_return_count INTEGER;
  v_replacement_count INTEGER;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004',
      MESSAGE = 'PHASE4_OPERATION_REQUIRED: Operation identity is required.';
  END IF;

  -- Reacquire the same transaction-scoped root gate before locking the
  -- operation/header. This covers finalization of a draft committed by an
  -- earlier transaction while remaining re-entrant for create+finalize.
  PERFORM public.phase4_lock_aftercare_operation_order_internal(
    p_operation_id, NULL
  );

  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  IF v_operation.idempotency_key IS NULL
    OR v_operation.request_fingerprint IS NULL
    OR v_operation.request_identity_version IS DISTINCT FROM 401
    OR v_operation.request_identity_snapshot IS NULL
    OR v_operation.actor_scope_type IS NULL
    OR v_operation.actor_scope_hash IS NULL
    OR v_operation.result_snapshot IS NULL
    OR v_operation.completed_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_EVIDENCE_INCOMPLETE: Immutable request/result evidence is required before finalization.';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_return_count
  FROM public.sales_return_events event
  WHERE event.operation_id = p_operation_id;
  SELECT COUNT(*)::INTEGER INTO v_replacement_count
  FROM public.sales_replacement_events event
  WHERE event.operation_id = p_operation_id;

  IF (v_operation.operation_type = 'phase4_return_v1'
      AND (v_return_count <> 1 OR v_replacement_count <> 0))
    OR (v_operation.operation_type = 'phase4_replacement_v1'
      AND (v_replacement_count <> 1 OR v_return_count <> 0))
    OR v_operation.operation_type NOT IN (
      'phase4_return_v1', 'phase4_replacement_v1'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_SHAPE_INVALID: Operation type and aftercare evidence do not match.';
  END IF;

  PERFORM set_config(
    'nawasrah.phase4_finalization_operation_id', p_operation_id::TEXT, true
  );

  IF v_return_count = 1 THEN
    SELECT * INTO v_return_event
    FROM public.sales_return_events event
    WHERE event.operation_id = p_operation_id
    FOR UPDATE;

    IF v_return_event.contract_version IS DISTINCT FROM 401
      OR v_return_event.settlement_status NOT IN ('draft', 'inspected')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_NOT_FINALIZABLE: Return is not a valid versioned draft.';
    END IF;

    PERFORM public.phase4_assert_aftercare_operation_binding_internal(
      v_operation.id, 'return', v_return_event.id,
      v_return_event.contract_version
    );

    IF v_return_event.outstanding_debt_before_snapshot_in_minor_units IS NULL
      OR v_return_event.net_collected_before_snapshot_in_minor_units IS NULL
      OR v_return_event.debt_reduction_amount_in_minor_units IS NULL
      OR v_return_event.money_refund_amount_in_minor_units IS NULL
      OR (v_return_event.money_refund_amount_in_minor_units = 0 AND (
        v_return_event.refund_method IS NOT NULL
        OR v_return_event.cash_shift_id IS NOT NULL
        OR v_return_event.reference_number IS NOT NULL
      ))
      OR (v_return_event.money_refund_amount_in_minor_units > 0 AND (
        v_return_event.refund_method NOT IN ('cash', 'cliq')
        OR v_return_event.cash_shift_id IS NULL
        OR (v_return_event.refund_method = 'cliq'
          AND NULLIF(BTRIM(v_return_event.reference_number), '') IS NULL)
      ))
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_FINANCIAL_EVIDENCE_INCOMPLETE: Versioned Return financial evidence is incomplete.';
    END IF;

    PERFORM 1 FROM public.orders customer_order
    WHERE customer_order.id = v_return_event.order_id FOR UPDATE;
    v_completion_at := public.phase4_authoritative_completion_internal(
      v_return_event.order_id
    );

    SELECT COUNT(*)::INTEGER INTO v_item_count
    FROM public.sales_return_items item
    WHERE item.sales_return_event_id = v_return_event.id
      AND item.operation_id = p_operation_id;
    IF v_item_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_ITEMS_REQUIRED: Return requires immutable item evidence.';
    END IF;

    FOR v_item IN
      SELECT item.* FROM public.sales_return_items item
      WHERE item.sales_return_event_id = v_return_event.id
        AND item.operation_id = p_operation_id
      ORDER BY item.order_item_id, item.id
    LOOP
      SELECT * INTO v_order_item FROM public.order_items item
      WHERE item.id = v_item.order_item_id FOR UPDATE;

      IF v_item.return_scope = 'parcel_instance' THEN
        SELECT instance.net_refundable_amount_snapshot_in_minor_units,
          instance.cogs_snapshot_in_minor_units,
          instance.units_per_parcel_snapshot
        INTO v_original_entitlement, v_original_cogs, v_total_units
        FROM public.order_parcel_instances instance
        WHERE instance.id = v_item.parcel_instance_id
          AND instance.order_item_id = v_item.order_item_id
        FOR UPDATE;

        SELECT COUNT(*)::INTEGER INTO v_other_settled
        FROM public.sales_return_items other_item
        JOIN public.sales_return_events other_event
          ON other_event.id = other_item.sales_return_event_id
        WHERE other_item.parcel_instance_id = v_item.parcel_instance_id
          AND other_item.id <> v_item.id
          AND other_event.settlement_status = 'settled';
        IF v_other_settled > 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_RETURN_ALREADY_CONSUMED: Original Parcel Return identity was already settled.';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.order_parcel_components component
          LEFT JOIN public.sales_return_component_inspections inspection
            ON inspection.parcel_component_id = component.id
            AND inspection.sales_return_item_id = v_item.id
          WHERE component.parcel_instance_id = v_item.parcel_instance_id
            AND (inspection.id IS NULL
              OR inspection.accepted_quantity + inspection.rejected_quantity
                <> component.base_quantity
              OR (inspection.accepted_quantity > 0 AND (
                inspection.accepted_condition IS NULL
                OR inspection.accepted_stock_disposition IS NULL
                OR (inspection.accepted_condition = 'sellable'
                  AND inspection.accepted_stock_disposition <> 'restock')
                OR (inspection.accepted_condition = 'supplier_defect'
                  AND inspection.accepted_stock_disposition <> 'non_sellable')
              ))
              OR (inspection.rejected_quantity > 0 AND (
                inspection.rejection_reason IS NULL
                OR inspection.rejection_reason <> 'customer_damage'
                OR inspection.rejected_stock_disposition IS NULL
                OR inspection.rejected_stock_disposition <> 'returned_to_customer'
              )))
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_INSPECTION_INCOMPLETE: Every original Component quantity must be classified before settlement.';
        END IF;

        SELECT COALESCE(SUM(inspection.accepted_quantity), 0)::INTEGER,
          COALESCE(SUM(inspection.rejected_quantity), 0)::INTEGER,
          COALESCE(SUM(inspection.raw_customer_damage_deduction_in_minor_units), 0)::BIGINT
        INTO v_accepted_units, v_rejected_units, v_raw_damage
        FROM public.sales_return_component_inspections inspection
        WHERE inspection.sales_return_item_id = v_item.id;
        v_expected_applied_damage := LEAST(v_original_entitlement, v_raw_damage);

        IF v_accepted_units + v_rejected_units <> v_total_units
          OR v_item.accepted_base_quantity IS DISTINCT FROM v_accepted_units
          OR v_item.rejected_base_quantity IS DISTINCT FROM v_rejected_units
          OR v_item.raw_customer_damage_deduction_in_minor_units
            IS DISTINCT FROM v_raw_damage
          OR v_item.applied_customer_damage_deduction_in_minor_units
            IS DISTINCT FROM v_expected_applied_damage
          OR v_item.refund_amount_snapshot_in_minor_units
            IS DISTINCT FROM v_original_entitlement - v_expected_applied_damage
          OR v_item.original_cogs_snapshot_in_minor_units
            IS DISTINCT FROM v_original_cogs
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_SETTLEMENT_EVIDENCE_INVALID: Parcel accepted/rejected, refund, damage, or COGS evidence does not reconcile.';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM public.order_parcel_components component
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER quantity
            FROM public.sales_aftercare_consumptions consumption
            CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
              consumption.source_kind, consumption.source_id,
              consumption.product_id
            ) root
            WHERE consumption.operation_id = p_operation_id
              AND consumption.return_item_id = v_item.id
              AND root.root_kind = 'parcel_component'
              AND root.root_id = component.id
              AND root.product_id = component.product_id
              AND consumption.consumption_kind = 'return'
              AND consumption.consumption_state = 'draft'
          ) used ON true
          WHERE component.parcel_instance_id = v_item.parcel_instance_id
            AND used.quantity <> component.base_quantity
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_PARCEL_CONSUMPTION_INCOMPLETE: Whole Parcel settlement must consume every original Component quantity.';
        END IF;
      ELSE
        v_total_units := v_order_item.quantity;
        v_original_entitlement :=
          v_order_item.net_refundable_amount_snapshot_in_minor_units;
        v_original_cogs := v_order_item.cogs_in_minor_units;

        IF v_original_entitlement IS NULL
          OR v_item.accepted_base_quantity + v_item.rejected_base_quantity
            IS DISTINCT FROM v_item.returned_quantity
          OR COALESCE(v_item.raw_customer_damage_deduction_in_minor_units, 0) <> 0
          OR COALESCE(v_item.applied_customer_damage_deduction_in_minor_units, 0) <> 0
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_EVIDENCE_INVALID: Base Unit Return evidence is incomplete or unsupported.';
        END IF;

        SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
        INTO v_current_consumption
        FROM public.sales_aftercare_consumptions consumption
        CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
          consumption.source_kind, consumption.source_id,
          consumption.product_id
        ) root
        WHERE consumption.operation_id = p_operation_id
          AND consumption.return_item_id = v_item.id
          AND root.root_kind = 'base_order_item'
          AND root.root_id = v_item.order_item_id
          AND root.product_id = v_item.product_id
          AND consumption.consumption_kind = 'return'
          AND consumption.consumption_state = 'draft';
        IF v_current_consumption IS DISTINCT FROM v_item.returned_quantity THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_CONSUMPTION_INVALID: Logical Base Unit consumption does not match the Return quantity.';
        END IF;

        SELECT COALESCE(SUM(consumed.item_quantity), 0)::INTEGER,
          COALESCE(SUM(consumed.item_refund), 0)::BIGINT,
          COALESCE(SUM(consumed.item_cogs), 0)::BIGINT
        INTO v_cumulative_quantity, v_cumulative_refund, v_cumulative_cogs
        FROM (
          SELECT item.id,
            SUM(consumption.consumed_quantity)::INTEGER AS item_quantity,
            item.refund_amount_snapshot_in_minor_units AS item_refund,
            item.original_cogs_snapshot_in_minor_units AS item_cogs
          FROM public.sales_aftercare_consumptions consumption
          JOIN public.sales_return_items item
            ON item.id = consumption.return_item_id
          JOIN public.sales_return_events event
            ON event.id = item.sales_return_event_id
          CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
            consumption.source_kind, consumption.source_id,
            consumption.product_id
          ) root
          WHERE root.root_kind = 'base_order_item'
            AND root.root_id = v_item.order_item_id
            AND consumption.consumption_kind = 'return'
            AND (consumption.consumption_state = 'settled'
              OR (consumption.operation_id = p_operation_id
                AND consumption.consumption_state = 'draft'))
            AND event.settlement_status <> 'cancelled'
          GROUP BY item.id, item.refund_amount_snapshot_in_minor_units,
            item.original_cogs_snapshot_in_minor_units
        ) consumed;

        IF v_cumulative_quantity > v_total_units
          OR v_cumulative_refund > v_original_entitlement
          OR v_cumulative_cogs > v_original_cogs
          OR (v_cumulative_quantity = v_total_units
            AND (v_cumulative_refund <> v_original_entitlement
              OR v_cumulative_cogs <> v_original_cogs))
        THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE4_BASE_RETURN_CUMULATIVE_BOUND_INVALID: Quantity, refund, COGS, or final residual exceeds the immutable sale bounds.';
        END IF;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.consumption_state = 'draft'
        AND NOT EXISTS (
          SELECT 1
          FROM public.sales_return_items item
          CROSS JOIN LATERAL public.phase4_aftercare_source_root_internal(
            consumption.source_kind, consumption.source_id,
            consumption.product_id
          ) root
          WHERE item.id = consumption.return_item_id
            AND item.operation_id = p_operation_id
            AND consumption.consumption_kind = 'return'
            AND consumption.replacement_item_id IS NULL
            AND (
              (item.return_scope = 'base_unit'
                AND consumption.product_id = item.product_id
                AND root.root_kind = 'base_order_item'
                AND root.root_id = item.order_item_id
                AND root.product_id = item.product_id)
              OR (item.return_scope = 'parcel_instance'
                AND root.root_kind = 'parcel_component'
                AND root.product_id = consumption.product_id
                AND EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.id = root.root_id
                    AND component.parcel_instance_id = item.parcel_instance_id
                    AND component.product_id = consumption.product_id
                ))
            )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_CONSUMPTION_SCOPE_INVALID: Return consumption contains an unauthorized logical source.';
    END IF;

    SELECT COALESCE(SUM(item.refund_amount_snapshot_in_minor_units), 0)::BIGINT,
      COALESCE(SUM(item.raw_customer_damage_deduction_in_minor_units), 0)::BIGINT,
      COALESCE(SUM(item.applied_customer_damage_deduction_in_minor_units), 0)::BIGINT
    INTO v_item_refund_total, v_item_raw_total, v_item_applied_total
    FROM public.sales_return_items item
    WHERE item.sales_return_event_id = v_return_event.id;

    IF v_return_event.merchandise_refund_amount_in_minor_units
        IS DISTINCT FROM v_item_refund_total
      OR v_return_event.raw_customer_damage_deduction_in_minor_units
        IS DISTINCT FROM v_item_raw_total
      OR v_return_event.applied_customer_damage_deduction_in_minor_units
        IS DISTINCT FROM v_item_applied_total
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_RETURN_FINANCIAL_RECONCILIATION_FAILED: Return item and event financial evidence do not reconcile.';
    END IF;
  ELSE
    SELECT * INTO v_replacement_event
    FROM public.sales_replacement_events event
    WHERE event.operation_id = p_operation_id
    FOR UPDATE;

    IF v_replacement_event.contract_version IS DISTINCT FROM 401 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_NOT_FINALIZABLE: Replacement is not a valid versioned draft.';
    END IF;
    PERFORM public.phase4_assert_aftercare_operation_binding_internal(
      v_operation.id, 'replacement', v_replacement_event.id,
      v_replacement_event.contract_version
    );
    IF v_replacement_event.replacement_status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_NOT_FINALIZABLE: Replacement is not a draft.';
    END IF;

    PERFORM 1 FROM public.orders customer_order
    WHERE customer_order.id = v_replacement_event.root_order_id FOR UPDATE;
    v_completion_at := public.phase4_authoritative_completion_internal(
      v_replacement_event.root_order_id
    );
    IF v_completion_at IS DISTINCT FROM
        v_replacement_event.original_completed_at_snapshot THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement must use the original completion evidence.';
    END IF;

    SELECT COUNT(*)::INTEGER INTO v_item_count
    FROM public.sales_replacement_items item
    WHERE item.replacement_event_id = v_replacement_event.id
      AND item.operation_id = p_operation_id;
    IF v_item_count = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_ITEMS_REQUIRED: Replacement requires immutable item evidence.';
    END IF;

    FOR v_item IN
      SELECT item.* FROM public.sales_replacement_items item
      WHERE item.replacement_event_id = v_replacement_event.id
      ORDER BY item.id
    LOOP
      SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
      INTO v_current_consumption
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.replacement_item_id = v_item.id
        AND consumption.consumption_kind = 'replacement'
        AND consumption.consumption_state = 'draft'
        AND consumption.product_id = v_item.product_id
        AND (
          (v_item.parent_replacement_item_id IS NULL
            AND consumption.source_kind = CASE
              WHEN v_item.root_parcel_component_id IS NULL
                THEN 'base_order_item' ELSE 'parcel_component' END
            AND consumption.source_id = COALESCE(
              v_item.root_parcel_component_id, v_item.root_order_item_id
            ))
          OR (v_item.parent_replacement_item_id IS NOT NULL
            AND consumption.source_kind = 'replacement_item'
            AND consumption.source_id = v_item.parent_replacement_item_id)
        );
      IF v_current_consumption IS DISTINCT FROM v_item.quantity THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE4_REPLACEMENT_CONSUMPTION_INVALID: Replacement must consume the exact current physical lineage quantity.';
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.operation_id = p_operation_id
        AND consumption.consumption_state = 'draft'
        AND NOT EXISTS (
          SELECT 1
          FROM public.sales_replacement_items item
          WHERE item.id = consumption.replacement_item_id
            AND item.operation_id = p_operation_id
            AND consumption.consumption_kind = 'replacement'
            AND consumption.return_item_id IS NULL
            AND consumption.product_id = item.product_id
            AND (
              (item.parent_replacement_item_id IS NULL
                AND consumption.source_kind = CASE
                  WHEN item.root_parcel_component_id IS NULL
                    THEN 'base_order_item' ELSE 'parcel_component' END
                AND consumption.source_id = COALESCE(
                  item.root_parcel_component_id, item.root_order_item_id
                ))
              OR (item.parent_replacement_item_id IS NOT NULL
                AND consumption.source_kind = 'replacement_item'
                AND consumption.source_id = item.parent_replacement_item_id)
            )
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_REPLACEMENT_CONSUMPTION_SCOPE_INVALID: Replacement consumption contains an unauthorized logical source.';
    END IF;
  END IF;

  -- Stable advisory identity serializes an otherwise absent source row without
  -- inventing physical serial numbers.
  FOR v_source IN
    SELECT consumption.source_kind, consumption.source_id,
      consumption.product_id
    FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.operation_id = p_operation_id
      AND consumption.consumption_state = 'draft'
    GROUP BY consumption.source_kind, consumption.source_id,
      consumption.product_id
    ORDER BY consumption.source_kind, consumption.source_id,
      consumption.product_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('phase4-aftercare|' || v_source.source_kind || '|'
        || v_source.source_id::TEXT, 0)
    );

    IF v_source.source_kind = 'base_order_item' THEN
      SELECT item.quantity INTO v_capacity
      FROM public.order_items item
      WHERE item.id = v_source.source_id
        AND item.product_id = v_source.product_id
        AND item.commercial_line_kind = 'base_unit'
      FOR UPDATE;
    ELSIF v_source.source_kind = 'parcel_component' THEN
      SELECT component.base_quantity INTO v_capacity
      FROM public.order_parcel_components component
      WHERE component.id = v_source.source_id
        AND component.product_id = v_source.product_id
      FOR UPDATE;
    ELSE
      SELECT replacement.quantity INTO v_capacity
      FROM public.sales_replacement_items replacement
      WHERE replacement.id = v_source.source_id
        AND replacement.product_id = v_source.product_id
      FOR UPDATE;
    END IF;

    IF v_capacity IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE4_AFTERCARE_SOURCE_INVALID: Commercial source identity is not valid.';
    END IF;

    PERFORM 1 FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source.source_kind
      AND consumption.source_id = v_source.source_id
    ORDER BY consumption.id FOR UPDATE;

    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed
    FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source.source_kind
      AND consumption.source_id = v_source.source_id
      AND (consumption.consumption_state = 'settled'
        OR (consumption.operation_id = p_operation_id
          AND consumption.consumption_state = 'draft'));

    IF v_consumed > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Requested quantity exceeds the remaining original commercial source.';
    END IF;
  END LOOP;

  -- The eligibility clock is sampled only after the complete source set is
  -- locked.  Time spent waiting for locks cannot preserve an expired new
  -- operation.  A committed replay is resolved by its coordinator before this
  -- new-operation finalizer is entered.
  v_now := clock_timestamp();
  IF v_return_count = 1
    AND v_now > v_completion_at + INTERVAL '48 hours'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_RETURN_WINDOW_EXPIRED: A new Return cannot be finalized after the original 48-hour window.';
  END IF;
  IF v_replacement_count = 1
    AND v_now > v_completion_at + INTERVAL '48 hours'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  IF v_return_count = 1 THEN
    UPDATE public.sales_return_events event
    SET settlement_status = 'settled', settled_at = v_now
    WHERE event.id = v_return_event.id
      AND event.operation_id = p_operation_id
      AND event.settlement_status IN ('draft', 'inspected');
  END IF;

  IF v_replacement_count = 1 THEN
    UPDATE public.sales_replacement_events event
    SET replacement_status = 'settled', settled_at = v_now
    WHERE event.id = v_replacement_event.id
      AND event.operation_id = p_operation_id
      AND event.replacement_status = 'draft';
  END IF;

  UPDATE public.sales_aftercare_consumptions
  SET consumption_state = 'settled', settled_at = v_now
  WHERE operation_id = p_operation_id AND consumption_state = 'draft';

  RETURN JSONB_BUILD_OBJECT(
    'operationId', p_operation_id,
    'settledAt', v_now,
    'consumptionCount', (
      SELECT COUNT(*) FROM public.sales_aftercare_consumptions
      WHERE operation_id = p_operation_id AND consumption_state = 'settled'
    )
  );
END;
$$;

CREATE FUNCTION public.phase4_cancel_draft_aftercare_internal(
  p_operation_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_return_status TEXT;
  v_replacement_status TEXT;
  v_operation_type TEXT;
BEGIN
  -- Discover without a row lock, then enter the same root gate used by every
  -- Phase-4 evidence writer before locking operation/header rows.
  SELECT operation.operation_type INTO v_operation_type
  FROM public.business_operations operation
  WHERE operation.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;
  IF v_operation_type IN ('phase4_return_v1', 'phase4_replacement_v1') THEN
    PERFORM public.phase4_lock_aftercare_operation_order_internal(
      p_operation_id, NULL
    );
  END IF;

  PERFORM 1 FROM public.business_operations operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE4_OPERATION_NOT_FOUND: Business operation does not exist.';
  END IF;

  SELECT event.settlement_status INTO v_return_status
  FROM public.sales_return_events event
  WHERE event.operation_id = p_operation_id FOR UPDATE;
  SELECT event.replacement_status INTO v_replacement_status
  FROM public.sales_replacement_events event
  WHERE event.operation_id = p_operation_id FOR UPDATE;

  IF v_return_status = 'settled' OR v_replacement_status = 'settled' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_SETTLED_OPERATION_IMMUTABLE: A settled operation cannot be cancelled.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.operation_id = p_operation_id
      AND consumption.consumption_state = 'settled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_DRAFT_CONSUMPTION_STATE_INVALID: Draft cancellation cannot preserve finalized consumption.';
  END IF;
  IF v_return_status IS NULL AND v_replacement_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPERATION_SHAPE_INVALID: No draft aftercare operation exists.';
  END IF;

  PERFORM set_config(
    'nawasrah.phase4_cancellation_operation_id', p_operation_id::TEXT, true
  );
  UPDATE public.sales_return_events
  SET settlement_status = 'cancelled', settled_at = NULL
  WHERE operation_id = p_operation_id
    AND settlement_status IN ('draft', 'inspected');
  UPDATE public.sales_replacement_events
  SET replacement_status = 'cancelled', settled_at = NULL
  WHERE operation_id = p_operation_id AND replacement_status = 'draft';
  UPDATE public.sales_aftercare_consumptions
  SET consumption_state = 'cancelled', settled_at = NULL
  WHERE operation_id = p_operation_id AND consumption_state = 'draft';
END;
$$;

-- Existing immutable history remains immutable.  The only new mutation is the
-- guarded draft/inspected -> settled finalization transition.
CREATE OR REPLACE FUNCTION public.guard_phase4_sales_return_event_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: لا يمكن حذف سجل المرتجع.';
  END IF;

  IF CURRENT_SETTING('nawasrah.phase4_cancellation_operation_id', true)
      = OLD.operation_id::TEXT
    AND OLD.settlement_status IN ('draft', 'inspected')
    AND NEW.settlement_status = 'cancelled'
    AND NEW.settled_at IS NULL
    AND ROW(
      NEW.id, NEW.return_number, NEW.operation_id, NEW.order_id, NEW.branch_id,
      NEW.warehouse_id, NEW.cash_shift_id, NEW.reason, NEW.refund_method,
      NEW.merchandise_refund_amount_in_minor_units, NEW.reference_number,
      NEW.notes, NEW.created_by, NEW.created_at, NEW.contract_version,
      NEW.outstanding_debt_before_snapshot_in_minor_units,
      NEW.net_collected_before_snapshot_in_minor_units,
      NEW.debt_reduction_amount_in_minor_units,
      NEW.money_refund_amount_in_minor_units,
      NEW.raw_customer_damage_deduction_in_minor_units,
      NEW.applied_customer_damage_deduction_in_minor_units
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.return_number, OLD.operation_id, OLD.order_id, OLD.branch_id,
      OLD.warehouse_id, OLD.cash_shift_id, OLD.reason, OLD.refund_method,
      OLD.merchandise_refund_amount_in_minor_units, OLD.reference_number,
      OLD.notes, OLD.created_by, OLD.created_at, OLD.contract_version,
      OLD.outstanding_debt_before_snapshot_in_minor_units,
      OLD.net_collected_before_snapshot_in_minor_units,
      OLD.debt_reduction_amount_in_minor_units,
      OLD.money_refund_amount_in_minor_units,
      OLD.raw_customer_damage_deduction_in_minor_units,
      OLD.applied_customer_damage_deduction_in_minor_units
    )
  THEN
    RETURN NEW;
  END IF;

  IF CURRENT_SETTING('nawasrah.phase4_finalization_operation_id', true)
      IS DISTINCT FROM OLD.operation_id::TEXT
    OR OLD.settlement_status NOT IN ('draft', 'inspected')
    OR NEW.settlement_status IS DISTINCT FROM 'settled'
    OR NEW.settled_at IS NULL
    OR ROW(
      NEW.id, NEW.return_number, NEW.operation_id, NEW.order_id, NEW.branch_id,
      NEW.warehouse_id, NEW.cash_shift_id, NEW.reason, NEW.refund_method,
      NEW.merchandise_refund_amount_in_minor_units, NEW.reference_number,
      NEW.notes, NEW.created_by, NEW.created_at, NEW.contract_version,
      NEW.outstanding_debt_before_snapshot_in_minor_units,
      NEW.net_collected_before_snapshot_in_minor_units,
      NEW.debt_reduction_amount_in_minor_units,
      NEW.money_refund_amount_in_minor_units,
      NEW.raw_customer_damage_deduction_in_minor_units,
      NEW.applied_customer_damage_deduction_in_minor_units
    ) IS DISTINCT FROM ROW(
      OLD.id, OLD.return_number, OLD.operation_id, OLD.order_id, OLD.branch_id,
      OLD.warehouse_id, OLD.cash_shift_id, OLD.reason, OLD.refund_method,
      OLD.merchandise_refund_amount_in_minor_units, OLD.reference_number,
      OLD.notes, OLD.created_by, OLD.created_at, OLD.contract_version,
      OLD.outstanding_debt_before_snapshot_in_minor_units,
      OLD.net_collected_before_snapshot_in_minor_units,
      OLD.debt_reduction_amount_in_minor_units,
      OLD.money_refund_amount_in_minor_units,
      OLD.raw_customer_damage_deduction_in_minor_units,
      OLD.applied_customer_damage_deduction_in_minor_units
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Return evidence may change only at the protected finalization boundary.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER trg_guard_sales_return_event_history ON public.sales_return_events;
CREATE TRIGGER trg_guard_sales_return_event_history
BEFORE UPDATE OR DELETE ON public.sales_return_events
FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_sales_return_event_history();

CREATE FUNCTION public.guard_phase4_replacement_event_history()
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
  IF CURRENT_SETTING('nawasrah.phase4_cancellation_operation_id', true)
      = OLD.operation_id::TEXT
    AND OLD.replacement_status = 'draft'
    AND NEW.replacement_status = 'cancelled'
    AND NEW.settled_at IS NULL
    AND ROW(
      NEW.id, NEW.operation_id, NEW.root_order_id, NEW.branch_id,
      NEW.warehouse_id, NEW.contract_version,
      NEW.original_completed_at_snapshot, NEW.reason, NEW.created_by,
      NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.operation_id, OLD.root_order_id, OLD.branch_id,
      OLD.warehouse_id, OLD.contract_version,
      OLD.original_completed_at_snapshot, OLD.reason, OLD.created_by,
      OLD.created_at
    )
  THEN
    RETURN NEW;
  END IF;
  IF CURRENT_SETTING('nawasrah.phase4_finalization_operation_id', true)
      = OLD.operation_id::TEXT
    AND OLD.replacement_status = 'draft'
    AND NEW.replacement_status = 'settled'
    AND NEW.settled_at IS NOT NULL
    AND ROW(
      NEW.id, NEW.operation_id, NEW.root_order_id, NEW.branch_id,
      NEW.warehouse_id, NEW.contract_version,
      NEW.original_completed_at_snapshot, NEW.reason, NEW.created_by,
      NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.operation_id, OLD.root_order_id, OLD.branch_id,
      OLD.warehouse_id, OLD.contract_version,
      OLD.original_completed_at_snapshot, OLD.reason, OLD.created_by,
      OLD.created_at
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Replacement evidence may change only at the protected finalization boundary.';
END;
$$;

CREATE TRIGGER trg_guard_sales_replacement_event_history
BEFORE UPDATE OR DELETE ON public.sales_replacement_events
FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_replacement_event_history();

CREATE FUNCTION public.guard_phase4_immutable_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Phase-4 evidence cannot be modified or deleted.';
END;
$$;

CREATE TRIGGER trg_guard_sales_return_component_inspections
BEFORE UPDATE OR DELETE ON public.sales_return_component_inspections
FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_immutable_row();

CREATE TRIGGER trg_guard_sales_replacement_items
BEFORE UPDATE OR DELETE ON public.sales_replacement_items
FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_immutable_row();

CREATE FUNCTION public.guard_phase4_aftercare_consumption_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Phase-4 consumption evidence cannot be deleted.';
  END IF;
  IF OLD.consumption_state = 'draft'
    AND NEW.consumption_state = 'settled'
    AND NEW.settled_at IS NOT NULL
    AND CURRENT_SETTING('nawasrah.phase4_finalization_operation_id', true)
      = OLD.operation_id::TEXT
    AND ROW(
      NEW.id, NEW.operation_id, NEW.return_item_id, NEW.replacement_item_id,
      NEW.source_kind, NEW.source_id, NEW.product_id, NEW.consumed_quantity,
      NEW.consumption_kind, NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.operation_id, OLD.return_item_id, OLD.replacement_item_id,
      OLD.source_kind, OLD.source_id, OLD.product_id, OLD.consumed_quantity,
      OLD.consumption_kind, OLD.created_at
    )
  THEN
    RETURN NEW;
  END IF;
  IF OLD.consumption_state = 'draft'
    AND NEW.consumption_state = 'cancelled'
    AND NEW.settled_at IS NULL
    AND CURRENT_SETTING('nawasrah.phase4_cancellation_operation_id', true)
      = OLD.operation_id::TEXT
    AND ROW(
      NEW.id, NEW.operation_id, NEW.return_item_id, NEW.replacement_item_id,
      NEW.source_kind, NEW.source_id, NEW.product_id, NEW.consumed_quantity,
      NEW.consumption_kind, NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.operation_id, OLD.return_item_id, OLD.replacement_item_id,
      OLD.source_kind, OLD.source_id, OLD.product_id, OLD.consumed_quantity,
      OLD.consumption_kind, OLD.created_at
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: Phase-4 consumption transition is not authorized.';
END;
$$;

CREATE TRIGGER trg_guard_phase4_aftercare_consumptions
BEFORE UPDATE OR DELETE ON public.sales_aftercare_consumptions
FOR EACH ROW EXECUTE FUNCTION public.guard_phase4_aftercare_consumption_history();

-- --------------------------------------------------------------------------
-- Reversal dependency guards.  These do not implement Phase-5 reversal;
-- they only prevent legacy paths from ignoring settled Phase-4 evidence.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.phase4_assert_no_settled_aftercare_for_order_internal(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sales_return_events event
    WHERE event.order_id = p_order_id AND event.settlement_status = 'settled'
  ) OR EXISTS (
    SELECT 1 FROM public.sales_replacement_events event
    WHERE event.root_order_id = p_order_id AND event.replacement_status = 'settled'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_AFTERCARE_DEPENDENCY_BLOCKS_REVERSAL: Reverse the dependent Return/Replacement through its approved future path first.';
  END IF;
END;
$$;

CREATE FUNCTION public.phase4_guard_order_reversal_dependency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public.phase4_assert_no_settled_aftercare_for_order_internal(OLD.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_guard_order_reversal_dependency
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.phase4_guard_order_reversal_dependency();

CREATE FUNCTION public.phase4_guard_customer_payment_reversal_dependency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_reversed AND NOT OLD.is_reversed AND OLD.order_id IS NOT NULL THEN
    PERFORM public.phase4_assert_no_settled_aftercare_for_order_internal(OLD.order_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_phase4_guard_customer_payment_reversal_dependency
BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.phase4_guard_customer_payment_reversal_dependency();

-- --------------------------------------------------------------------------
-- Canonical lock compatibility for Customer/Order operational entrypoints.
-- Existing implementations are retained behind private wrappers so their
-- accounting behavior is unchanged; the wrappers acquire the complete known
-- resource set first and revalidate before any legacy mutation begins.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.phase4_lock_order_inventory_internal(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT source.product_id ORDER BY source.product_id)
  INTO v_product_ids
  FROM (
    SELECT item.product_id
    FROM public.order_items item
    WHERE item.order_id = p_order_id
      AND item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
    UNION ALL
    SELECT component.product_id
    FROM public.order_items item
    JOIN public.order_parcel_instances instance
      ON instance.order_item_id = item.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE item.order_id = p_order_id
      AND item.commercial_line_kind = 'configurable_parcel'
  ) source;
  IF COALESCE(CARDINALITY(v_product_ids), 0) > 0 THEN
    PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);
  END IF;
END;
$$;

CREATE FUNCTION public.phase4_lock_customer_order_context_internal(
  p_order_id UUID,
  p_require_open_shift BOOLEAN,
  p_lock_inventory BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id UUID;
  v_shift_id UUID;
  v_locked_branch_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('phase4-order|' || p_order_id::TEXT, 0)
  );

  SELECT customer_order.branch_id INTO v_branch_id
  FROM public.orders customer_order WHERE customer_order.id = p_order_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_ORDER_CONTEXT_INVALID: Order or branch is unavailable.';
  END IF;

  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.branch_id = v_branch_id AND shift.status = 'open'
  ORDER BY shift.id LIMIT 1;

  IF v_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.cash_shifts shift
    WHERE shift.id = v_shift_id FOR UPDATE;
  ELSIF p_require_open_shift THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_OPEN_SHIFT_REQUIRED: An open Shift is required.';
  END IF;

  SELECT customer_order.branch_id INTO v_locked_branch_id
  FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR UPDATE;
  IF v_locked_branch_id IS DISTINCT FROM v_branch_id
    OR (v_shift_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.cash_shifts shift
      WHERE shift.id = v_shift_id
        AND shift.branch_id = v_locked_branch_id
        AND shift.status = 'open'
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Customer Order lock plan changed.';
  END IF;

  IF p_lock_inventory THEN
    PERFORM public.phase4_lock_order_inventory_internal(p_order_id);
  END IF;
  PERFORM set_config(
    'nawasrah.phase4_prelocked_shift_id', COALESCE(v_shift_id::TEXT, ''), true
  );
  RETURN v_shift_id;
END;
$$;

ALTER FUNCTION public.record_customer_order_payment(UUID, BIGINT, TEXT, TEXT, TEXT)
  RENAME TO _record_customer_order_payment_before_phase4_lock;
REVOKE ALL ON FUNCTION public._record_customer_order_payment_before_phase4_lock(
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
  RETURN public._record_customer_order_payment_before_phase4_lock(
    p_order_id, p_amount_in_minor_units, p_payment_method,
    p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_customer_order_payment(UUID, BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) RENAME TO _complete_website_order_with_settlement_before_phase4_lock;
REVOKE ALL ON FUNCTION public._complete_website_order_with_settlement_before_phase4_lock(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.complete_website_order_with_settlement(
  p_order_id UUID,
  p_payment_method TEXT,
  p_amount_collected_in_minor_units BIGINT DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تسليم الطلب وتسجيل التحصيل والذمة'
  );
  PERFORM public.phase4_lock_customer_order_context_internal(
    p_order_id,
    LOWER(COALESCE(p_payment_method, '')) NOT IN ('debt', ''),
    true
  );
  RETURN public._complete_website_order_with_settlement_before_phase4_lock(
    p_order_id, p_payment_method, p_amount_collected_in_minor_units,
    p_delivery_fee_in_minor_units, p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) TO authenticated;

-- Resolve a completed Customer V2 request before current Shift/order state is
-- inspected.  This preserves the published idempotency contract when the
-- original Shift was closed after the committed completion.
CREATE FUNCTION public.phase4_customer_completion_replay_preflight_internal(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_payment_method TEXT,
  p_amount_collected_in_minor_units BIGINT,
  p_delivery_fee_in_minor_units BIGINT,
  p_reference_number TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_payment_method TEXT := LOWER(NULLIF(BTRIM(p_payment_method), ''));
  v_actor_hash TEXT;
  v_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إكمال طلب عميل V2 وتسوية الحجز'
  );
  IF v_user_id IS NULL OR v_key IS NULL
    OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Completion identity is invalid.';
  END IF;
  IF v_payment_method = 'cash_on_delivery' THEN
    v_payment_method := 'cash';
  END IF;
  IF v_payment_method NOT IN ('cash', 'cliq', 'debt')
    OR COALESCE(p_amount_collected_in_minor_units, 0) < 0
    OR COALESCE(p_delivery_fee_in_minor_units, 0) < 0
    OR CHAR_LENGTH(COALESCE(BTRIM(p_reference_number), '')) > 120
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_SETTLEMENT_INVALID: Settlement input is invalid.';
  END IF;
  IF v_payment_method = 'cliq'
    AND COALESCE(p_amount_collected_in_minor_units, 1) > 0
    AND NULLIF(BTRIM(p_reference_number), '') IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_SETTLEMENT_INVALID: CliQ reference is required.';
  END IF;

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-customer-completion-v1',
    'actor_scope_hash', v_actor_hash,
    'order_id', LOWER(p_order_id::TEXT),
    'payment_method', v_payment_method,
    'amount_collected_in_minor_units', p_amount_collected_in_minor_units,
    'delivery_fee_in_minor_units', p_delivery_fee_in_minor_units,
    'reference_number', NULLIF(BTRIM(p_reference_number), ''),
    'notes', NULLIF(BTRIM(p_notes), '')
  );
  v_fingerprint := public.phase3_request_fingerprint_internal(v_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_completion_v1', v_key, 'erp_user',
    v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) RENAME TO _complete_website_order_with_settlement_v2_before_phase4_lock;
REVOKE ALL ON FUNCTION public._complete_website_order_with_settlement_v2_before_phase4_lock(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.complete_website_order_with_settlement_v2(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_payment_method TEXT,
  p_amount_collected_in_minor_units BIGINT DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT NULL,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_replay JSONB;
BEGIN
  v_replay := public.phase4_customer_completion_replay_preflight_internal(
    p_order_id, p_idempotency_key, p_payment_method,
    p_amount_collected_in_minor_units, p_delivery_fee_in_minor_units,
    p_reference_number, p_notes
  );
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  PERFORM public.phase4_lock_customer_order_context_internal(
    p_order_id,
    LOWER(COALESCE(p_payment_method, '')) NOT IN ('debt', ''),
    true
  );
  RETURN public._complete_website_order_with_settlement_v2_before_phase4_lock(
    p_order_id, p_idempotency_key, p_payment_method,
    p_amount_collected_in_minor_units, p_delivery_fee_in_minor_units,
    p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) TO authenticated;

ALTER FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) RENAME TO _return_completed_website_order_before_phase4_lock;
REVOKE ALL ON FUNCTION public._return_completed_website_order_before_phase4_lock(
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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'تسجيل مرتجع مبيعات ورد المبلغ'
  );
  PERFORM public.phase4_lock_customer_order_context_internal(
    p_order_id, true, true
  );
  RETURN public._return_completed_website_order_before_phase4_lock(
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

ALTER FUNCTION public._complete_order_impl(UUID, TEXT)
  RENAME TO _complete_order_impl_before_phase4_lock;
ALTER FUNCTION public._cancel_order_impl(UUID, TEXT)
  RENAME TO _cancel_order_impl_before_phase4_lock;
REVOKE ALL ON FUNCTION public._complete_order_impl_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cancel_order_impl_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._complete_order_impl(p_order_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.phase4_lock_order_inventory_internal(p_order_id);
  RETURN public._complete_order_impl_before_phase4_lock(p_order_id, p_notes);
END;
$$;
CREATE FUNCTION public._cancel_order_impl(p_order_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.phase4_lock_order_inventory_internal(p_order_id);
  RETURN public._cancel_order_impl_before_phase4_lock(p_order_id, p_notes);
END;
$$;
REVOKE ALL ON FUNCTION public._complete_order_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cancel_order_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attach_customer_payment_to_open_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id UUID;
  v_shift_id UUID;
  v_prelocked TEXT := NULLIF(
    CURRENT_SETTING('nawasrah.phase4_prelocked_shift_id', true), ''
  );
BEGIN
  IF NEW.payment_method NOT IN ('cash', 'cliq') OR NEW.cash_shift_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF v_prelocked IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_SHIFT_LOCK_CONTEXT_REQUIRED: Cash/CliQ Customer Payment must use the protected payment coordinator.';
  END IF;
  SELECT customer_order.branch_id INTO v_branch_id
  FROM public.orders customer_order WHERE customer_order.id = NEW.order_id;
  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.id = v_prelocked::UUID
    AND shift.branch_id = v_branch_id
    AND shift.status = 'open';
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Prelocked Customer Payment Shift is no longer valid.';
  END IF;
  NEW.cash_shift_id := v_shift_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.reverse_customer_order_payment(UUID, TEXT)
  RENAME TO _reverse_customer_order_payment_before_phase4_lock;
REVOKE ALL ON FUNCTION public._reverse_customer_order_payment_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reverse_customer_order_payment(p_payment_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_shift_id UUID;
  v_locked_order_id UUID;
  v_locked_shift_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عكس سند قبض عميل'
  );
  SELECT payment.order_id, payment.cash_shift_id
  INTO v_order_id, v_shift_id
  FROM public.customer_payments payment WHERE payment.id = p_payment_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Customer payment not found.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phase4-order|' || v_order_id::TEXT, 0));
  IF v_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.cash_shifts shift WHERE shift.id = v_shift_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.orders customer_order WHERE customer_order.id = v_order_id FOR UPDATE;
  SELECT payment.order_id, payment.cash_shift_id
  INTO v_locked_order_id, v_locked_shift_id
  FROM public.customer_payments payment
  WHERE payment.id = p_payment_id FOR UPDATE;
  IF v_locked_order_id IS DISTINCT FROM v_order_id
    OR v_locked_shift_id IS DISTINCT FROM v_shift_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Customer Payment relationship changed.';
  END IF;
  RETURN public._reverse_customer_order_payment_before_phase4_lock(
    p_payment_id, p_reason
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_customer_order_payment(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_customer_order_payment(UUID, TEXT)
  TO authenticated;

ALTER FUNCTION public.reverse_operational_expense(UUID, TEXT)
  RENAME TO _reverse_operational_expense_before_phase4_lock;
REVOKE ALL ON FUNCTION public._reverse_operational_expense_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reverse_operational_expense(p_expense_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
  v_locked_shift_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عكس مصروف تشغيلي'
  );
  SELECT expense.shift_id INTO v_shift_id
  FROM public.operational_expenses expense WHERE expense.id = p_expense_id;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Operational expense not found.';
  END IF;
  PERFORM 1 FROM public.cash_shifts shift WHERE shift.id = v_shift_id FOR UPDATE;
  SELECT expense.shift_id INTO v_locked_shift_id
  FROM public.operational_expenses expense
  WHERE expense.id = p_expense_id FOR UPDATE;
  IF v_locked_shift_id IS DISTINCT FROM v_shift_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Expense Shift relationship changed.';
  END IF;
  RETURN public._reverse_operational_expense_before_phase4_lock(
    p_expense_id, p_reason
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_operational_expense(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_operational_expense(UUID, TEXT)
  TO authenticated;

-- Supplier Receipt/Payment lock-set discovery is pure and repeatable. The
-- locker compares a fresh snapshot after all rows are held; a changed relation
-- is a retryable serialization failure, never a late Shift acquisition.
CREATE FUNCTION public.phase4_supplier_context_snapshot_internal(
  p_supplier_receipt_id UUID,
  p_purchase_receipt_id UUID,
  p_supplier_payment_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH seed AS (
    SELECT
      COALESCE(p_supplier_receipt_id, payment.supplier_receipt_id) supplier_receipt_id,
      COALESCE(p_purchase_receipt_id, payment.purchase_receipt_id) purchase_receipt_id,
      payment.purchase_order_id payment_purchase_order_id
    FROM (SELECT 1) singleton
    LEFT JOIN public.supplier_payments payment
      ON payment.id = p_supplier_payment_id
  ), context AS (
    SELECT seed.supplier_receipt_id, seed.purchase_receipt_id,
      COALESCE(seed.payment_purchase_order_id, receipt.purchase_order_id)
        purchase_order_id
    FROM seed
    LEFT JOIN public.purchase_receipts receipt
      ON receipt.id = seed.purchase_receipt_id
  ), related_payments AS (
    SELECT payment.id, payment.cash_shift_id, payment.supplier_id,
      payment.supplier_receipt_id, payment.purchase_receipt_id,
      payment.purchase_order_id
    FROM public.supplier_payments payment CROSS JOIN context
    WHERE payment.id = p_supplier_payment_id
      OR (context.supplier_receipt_id IS NOT NULL
        AND payment.supplier_receipt_id = context.supplier_receipt_id)
      OR (context.purchase_receipt_id IS NOT NULL
        AND payment.purchase_receipt_id = context.purchase_receipt_id)
      OR (context.purchase_order_id IS NOT NULL
        AND payment.purchase_order_id = context.purchase_order_id)
  ), product_ids AS (
    SELECT item.product_id FROM public.supplier_receipt_items item CROSS JOIN context
    WHERE item.supplier_receipt_id = context.supplier_receipt_id
    UNION
    SELECT item.product_id FROM public.purchase_receipt_items item CROSS JOIN context
    WHERE item.purchase_receipt_id = context.purchase_receipt_id
  ), supplier_ids AS (
    SELECT receipt.supplier_id FROM public.supplier_receipts receipt CROSS JOIN context
    WHERE receipt.id = context.supplier_receipt_id
    UNION
    SELECT receipt.supplier_id FROM public.purchase_receipts receipt CROSS JOIN context
    WHERE receipt.id = context.purchase_receipt_id
    UNION
    SELECT payment.supplier_id FROM related_payments payment
  )
  SELECT JSONB_BUILD_OBJECT(
    'supplier_receipt_id', context.supplier_receipt_id,
    'purchase_receipt_id', context.purchase_receipt_id,
    'purchase_order_id', context.purchase_order_id,
    'payment_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM related_payments), '[]'::JSONB),
    'shift_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM (
      SELECT DISTINCT cash_shift_id id FROM related_payments WHERE cash_shift_id IS NOT NULL
    ) shifts), '[]'::JSONB),
    'product_ids', COALESCE((SELECT JSONB_AGG(product_id ORDER BY product_id) FROM product_ids), '[]'::JSONB),
    'supplier_ids', COALESCE((SELECT JSONB_AGG(supplier_id ORDER BY supplier_id) FROM supplier_ids WHERE supplier_id IS NOT NULL), '[]'::JSONB)
  )
  FROM context;
$$;

CREATE FUNCTION public.phase4_lock_supplier_context_internal(
  p_supplier_receipt_id UUID,
  p_purchase_receipt_id UUID,
  p_supplier_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan JSONB;
  v_fresh JSONB;
  v_ids UUID[];
  v_supplier_receipt_id UUID;
  v_purchase_receipt_id UUID;
  v_purchase_order_id UUID;
  v_shift_id UUID;
BEGIN
  v_plan := public.phase4_supplier_context_snapshot_internal(
    p_supplier_receipt_id, p_purchase_receipt_id, p_supplier_payment_id
  );
  v_supplier_receipt_id := NULLIF(v_plan->>'supplier_receipt_id', '')::UUID;
  v_purchase_receipt_id := NULLIF(v_plan->>'purchase_receipt_id', '')::UUID;
  v_purchase_order_id := NULLIF(v_plan->>'purchase_order_id', '')::UUID;

  -- Every path that can later enter a Shift-scoped reversal takes the same
  -- advisory gates before any Shift, inventory, receipt, PO, or payment row.
  -- A relationship change is retried instead of acquiring a new earlier-rank
  -- Shift after later-rank resources are held.
  FOR v_shift_id IN
    SELECT value::UUID
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'shift_ids')
    ORDER BY value::UUID
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'cash-shift-full-reversal:' || v_shift_id::TEXT, 0
    ));
  END LOOP;
  v_fresh := public.phase4_supplier_context_snapshot_internal(
    p_supplier_receipt_id, p_purchase_receipt_id, p_supplier_payment_id
  );
  IF v_fresh IS DISTINCT FROM v_plan THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Supplier Payment/Shift relationship changed before locking.';
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'shift_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.cash_shifts shift
    WHERE shift.id = ANY(v_ids) ORDER BY shift.id FOR UPDATE;
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'product_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM public.phase3_lock_inventory_products_internal(v_ids);
  END IF;

  IF v_supplier_receipt_id IS NOT NULL THEN
    PERFORM 1 FROM public.supplier_receipts receipt
    WHERE receipt.id = v_supplier_receipt_id FOR UPDATE;
  END IF;
  IF v_purchase_receipt_id IS NOT NULL THEN
    PERFORM 1 FROM public.purchase_receipts receipt
    WHERE receipt.id = v_purchase_receipt_id FOR UPDATE;
  END IF;
  IF v_purchase_order_id IS NOT NULL THEN
    PERFORM 1 FROM public.purchase_orders purchase_order
    WHERE purchase_order.id = v_purchase_order_id FOR UPDATE;
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'supplier_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.suppliers supplier
    WHERE supplier.id = ANY(v_ids) ORDER BY supplier.id FOR UPDATE;
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'payment_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.supplier_payments payment
    WHERE payment.id = ANY(v_ids) ORDER BY payment.id FOR UPDATE NOWAIT;
  END IF;

  v_fresh := public.phase4_supplier_context_snapshot_internal(
    p_supplier_receipt_id, p_purchase_receipt_id, p_supplier_payment_id
  );
  IF v_fresh IS DISTINCT FROM v_plan THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Supplier Payment/Shift relationship changed.';
  END IF;
  RETURN v_plan;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = '40001',
    MESSAGE = 'PHASE4_LOCK_CONTENTION_RETRY: Supplier Payment lock set is busy.';
END;
$$;

CREATE OR REPLACE FUNCTION public.phase2_lock_receipt_payment_shifts_internal(
  p_supplier_receipt_id UUID,
  p_purchase_receipt_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سندات الاستلام'
  );
  PERFORM public.phase4_lock_supplier_context_internal(
    p_supplier_receipt_id, p_purchase_receipt_id, NULL
  );
END;
$$;

ALTER FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  RENAME TO _cancel_supplier_receipt_before_phase4_lock;
ALTER FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT)
  RENAME TO _cancel_purchase_receipt_v2_before_phase4_lock;
ALTER FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT)
  RENAME TO _reverse_supplier_payment_before_phase4_lock;
REVOKE ALL ON FUNCTION public._cancel_supplier_receipt_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cancel_purchase_receipt_v2_before_phase4_lock(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reverse_supplier_payment_before_phase4_lock(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_supplier_receipt(
  p_supplier_receipt_id UUID, p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سند استلام أمر شراء'
  );
  PERFORM public.phase4_lock_supplier_context_internal(
    p_supplier_receipt_id, NULL, NULL
  );
  RETURN public._cancel_supplier_receipt_before_phase4_lock(
    p_supplier_receipt_id, p_reason
  );
END;
$$;

CREATE FUNCTION public.cancel_purchase_receipt_v2(
  p_purchase_receipt_id UUID, p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سند استلام أمر شراء'
  );
  PERFORM public.phase4_lock_supplier_context_internal(
    NULL, p_purchase_receipt_id, NULL
  );
  RETURN public._cancel_purchase_receipt_v2_before_phase4_lock(
    p_purchase_receipt_id, p_reason
  );
END;
$$;

CREATE FUNCTION public.reverse_supplier_payment(
  p_supplier_payment_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_reversal_owner('عكس دفعة مورد');
  PERFORM public.phase4_lock_supplier_context_internal(
    NULL, NULL, p_supplier_payment_id
  );
  RETURN public._reverse_supplier_payment_before_phase4_lock(
    p_supplier_payment_id, p_reason, p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT)
  TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT)
  TO authenticated;

CREATE FUNCTION public.phase4_full_shift_context_snapshot_internal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH target_supplier_payments AS (
    SELECT payment.* FROM public.supplier_payments payment
    WHERE payment.cash_shift_id = p_shift_id
  ), target_docs AS (
    SELECT DISTINCT payment.supplier_receipt_id,
      payment.purchase_receipt_id,
      COALESCE(payment.purchase_order_id, receipt.purchase_order_id)
        purchase_order_id
    FROM target_supplier_payments payment
    LEFT JOIN public.purchase_receipts receipt
      ON receipt.id = payment.purchase_receipt_id
  ), related_supplier_payments AS (
    SELECT DISTINCT payment.*
    FROM public.supplier_payments payment
    CROSS JOIN target_docs document
    WHERE (document.supplier_receipt_id IS NOT NULL
        AND payment.supplier_receipt_id = document.supplier_receipt_id)
      OR (document.purchase_receipt_id IS NOT NULL
        AND payment.purchase_receipt_id = document.purchase_receipt_id)
      OR (document.purchase_order_id IS NOT NULL
        AND payment.purchase_order_id = document.purchase_order_id)
  ), order_ids AS (
    SELECT customer_order.id FROM public.orders customer_order
    WHERE customer_order.cash_shift_id = p_shift_id
    UNION
    SELECT payment.order_id FROM public.customer_payments payment
    WHERE payment.cash_shift_id = p_shift_id AND payment.order_id IS NOT NULL
  ), product_ids AS (
    SELECT item.product_id
    FROM public.order_items item JOIN order_ids target ON target.id = item.order_id
    WHERE item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
    UNION
    SELECT component.product_id
    FROM public.order_items item
    JOIN order_ids target ON target.id = item.order_id
    JOIN public.order_parcel_instances instance ON instance.order_item_id = item.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE item.commercial_line_kind = 'configurable_parcel'
    UNION
    SELECT item.product_id FROM public.supplier_receipt_items item
    JOIN target_docs document
      ON document.supplier_receipt_id = item.supplier_receipt_id
    UNION
    SELECT item.product_id FROM public.purchase_receipt_items item
    JOIN target_docs document
      ON document.purchase_receipt_id = item.purchase_receipt_id
  ), supplier_ids AS (
    SELECT payment.supplier_id FROM related_supplier_payments payment
    UNION
    SELECT receipt.supplier_id FROM public.supplier_receipts receipt
    JOIN target_docs document ON document.supplier_receipt_id = receipt.id
    UNION
    SELECT receipt.supplier_id FROM public.purchase_receipts receipt
    JOIN target_docs document ON document.purchase_receipt_id = receipt.id
  )
  SELECT JSONB_BUILD_OBJECT(
    'shift_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM (
      SELECT p_shift_id id
      UNION SELECT cash_shift_id FROM related_supplier_payments
        WHERE cash_shift_id IS NOT NULL
    ) shifts), '[]'::JSONB),
    'order_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM order_ids), '[]'::JSONB),
    'product_ids', COALESCE((SELECT JSONB_AGG(product_id ORDER BY product_id) FROM product_ids), '[]'::JSONB),
    'customer_payment_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id)
      FROM public.customer_payments WHERE cash_shift_id = p_shift_id), '[]'::JSONB),
    'supplier_payment_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id)
      FROM related_supplier_payments), '[]'::JSONB),
    'supplier_receipt_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM (
      SELECT DISTINCT supplier_receipt_id id FROM target_docs
      WHERE supplier_receipt_id IS NOT NULL
    ) receipts), '[]'::JSONB),
    'purchase_receipt_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM (
      SELECT DISTINCT purchase_receipt_id id FROM target_docs
      WHERE purchase_receipt_id IS NOT NULL
    ) receipts), '[]'::JSONB),
    'purchase_order_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id) FROM (
      SELECT DISTINCT purchase_order_id id FROM target_docs
      WHERE purchase_order_id IS NOT NULL
    ) orders), '[]'::JSONB),
    'supplier_ids', COALESCE((SELECT JSONB_AGG(supplier_id ORDER BY supplier_id)
      FROM supplier_ids WHERE supplier_id IS NOT NULL), '[]'::JSONB),
    'expense_ids', COALESCE((SELECT JSONB_AGG(id ORDER BY id)
      FROM public.operational_expenses WHERE shift_id = p_shift_id), '[]'::JSONB)
  );
$$;

CREATE FUNCTION public.phase4_lock_full_shift_context_internal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan JSONB;
  v_fresh JSONB;
  v_ids UUID[];
  v_shift_id UUID;
BEGIN
  v_plan := public.phase4_full_shift_context_snapshot_internal(p_shift_id);

  FOR v_shift_id IN
    SELECT value::UUID
    FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'shift_ids')
    ORDER BY value::UUID
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'cash-shift-full-reversal:' || v_shift_id::TEXT, 0
    ));
  END LOOP;
  v_fresh := public.phase4_full_shift_context_snapshot_internal(p_shift_id);
  IF v_fresh IS DISTINCT FROM v_plan THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Full Shift resource set changed before locking.';
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'shift_ids');
  PERFORM 1 FROM public.cash_shifts shift
  WHERE shift.id = ANY(v_ids) ORDER BY shift.id FOR UPDATE;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'order_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.orders customer_order
    WHERE customer_order.id = ANY(v_ids) ORDER BY customer_order.id FOR UPDATE;
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'product_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM public.phase3_lock_inventory_products_internal(v_ids);
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'supplier_receipt_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.supplier_receipts receipt
    WHERE receipt.id = ANY(v_ids) ORDER BY receipt.id FOR UPDATE;
  END IF;
  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'purchase_receipt_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.purchase_receipts receipt
    WHERE receipt.id = ANY(v_ids) ORDER BY receipt.id FOR UPDATE;
  END IF;
  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'purchase_order_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.purchase_orders purchase_order
    WHERE purchase_order.id = ANY(v_ids) ORDER BY purchase_order.id FOR UPDATE;
  END IF;
  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'supplier_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.suppliers supplier
    WHERE supplier.id = ANY(v_ids) ORDER BY supplier.id FOR UPDATE;
  END IF;

  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'customer_payment_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.customer_payments payment
    WHERE payment.id = ANY(v_ids) ORDER BY payment.id FOR UPDATE NOWAIT;
  END IF;
  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'supplier_payment_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.supplier_payments payment
    WHERE payment.id = ANY(v_ids) ORDER BY payment.id FOR UPDATE NOWAIT;
  END IF;
  SELECT ARRAY_AGG(value::UUID ORDER BY value::UUID) INTO v_ids
  FROM JSONB_ARRAY_ELEMENTS_TEXT(v_plan->'expense_ids');
  IF COALESCE(CARDINALITY(v_ids), 0) > 0 THEN
    PERFORM 1 FROM public.operational_expenses expense
    WHERE expense.id = ANY(v_ids) ORDER BY expense.id FOR UPDATE;
  END IF;

  v_fresh := public.phase4_full_shift_context_snapshot_internal(p_shift_id);
  IF v_fresh IS DISTINCT FROM v_plan THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'PHASE4_LOCK_PLAN_CHANGED_RETRY: Full Shift resource set changed.';
  END IF;
  RETURN v_plan;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = '40001',
    MESSAGE = 'PHASE4_LOCK_CONTENTION_RETRY: Full Shift dependent set is busy.';
END;
$$;

ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  RENAME TO _reverse_cash_shift_with_operations_before_phase4_lock;
REVOKE ALL ON FUNCTION public._reverse_cash_shift_with_operations_before_phase4_lock(
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
  RETURN public._reverse_cash_shift_with_operations_before_phase4_lock(
    p_shift_id, p_reason, p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT)
  TO authenticated;

-- --------------------------------------------------------------------------
-- Least privilege.
-- --------------------------------------------------------------------------

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'sales_return_component_inspections',
    'sales_replacement_events',
    'sales_replacement_items',
    'sales_aftercare_consumptions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_active_erp_staff()))',
      'Active ERP staff can read Phase 4 foundation', v_table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.phase4_effective_standalone_unit_price_internal(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_canonicalize_idempotency_key_internal(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_assert_success_result_internal(UUID, TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_aftercare_order_gate_internal(TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_aftercare_operation_order_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_aftercare_parent_order_internal(TEXT, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_guard_aftercare_operation_order_gate()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_assert_aftercare_operation_binding_internal(UUID, TEXT, UUID, SMALLINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_resolve_operation_replay_internal(TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_capture_parcel_component_price_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_guard_return_event_insert_state()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_guard_replacement_event_insert_state()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_prepare_component_inspection()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_validate_replacement_item()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_validate_return_item_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_validate_aftercare_consumption_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_aftercare_source_root_internal(TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_authoritative_completion_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_cancel_draft_aftercare_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase4_sales_return_event_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase4_replacement_event_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase4_immutable_row()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase4_aftercare_consumption_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_assert_no_settled_aftercare_for_order_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_guard_order_reversal_dependency()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_guard_customer_payment_reversal_dependency()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_order_inventory_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_customer_order_context_internal(UUID, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_customer_completion_replay_preflight_internal(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_customer_payment_to_open_shift()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_supplier_context_snapshot_internal(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_supplier_context_internal(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_lock_receipt_payment_shifts_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_full_shift_context_snapshot_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase4_lock_full_shift_context_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.sales_return_component_inspections OWNER TO postgres;
ALTER TABLE public.sales_replacement_events OWNER TO postgres;
ALTER TABLE public.sales_replacement_items OWNER TO postgres;
ALTER TABLE public.sales_aftercare_consumptions OWNER TO postgres;

ALTER FUNCTION public.phase4_effective_standalone_unit_price_internal(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.phase4_canonicalize_idempotency_key_internal(TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase4_assert_success_result_internal(UUID, TEXT, JSONB, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_aftercare_order_gate_internal(TEXT, JSONB, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_aftercare_operation_order_internal(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_aftercare_parent_order_internal(TEXT, UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_guard_aftercare_operation_order_gate() OWNER TO postgres;
ALTER FUNCTION public.phase4_assert_aftercare_operation_binding_internal(UUID, TEXT, UUID, SMALLINT) OWNER TO postgres;
ALTER FUNCTION public.phase4_resolve_operation_replay_internal(TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase4_capture_parcel_component_price_snapshot() OWNER TO postgres;
ALTER FUNCTION public.phase4_guard_return_event_insert_state() OWNER TO postgres;
ALTER FUNCTION public.phase4_guard_replacement_event_insert_state() OWNER TO postgres;
ALTER FUNCTION public.guard_order_parcel_component_history() OWNER TO postgres;
ALTER FUNCTION public.phase4_prepare_component_inspection() OWNER TO postgres;
ALTER FUNCTION public.phase4_validate_replacement_item() OWNER TO postgres;
ALTER FUNCTION public.phase4_validate_return_item_insert() OWNER TO postgres;
ALTER FUNCTION public.phase4_validate_aftercare_consumption_insert() OWNER TO postgres;
ALTER FUNCTION public.phase4_aftercare_source_root_internal(TEXT, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_authoritative_completion_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_finalize_aftercare_operation_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_cancel_draft_aftercare_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.guard_phase4_sales_return_event_history() OWNER TO postgres;
ALTER FUNCTION public.guard_phase4_replacement_event_history() OWNER TO postgres;
ALTER FUNCTION public.guard_phase4_immutable_row() OWNER TO postgres;
ALTER FUNCTION public.guard_phase4_aftercare_consumption_history() OWNER TO postgres;
ALTER FUNCTION public.phase4_assert_no_settled_aftercare_for_order_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_guard_order_reversal_dependency() OWNER TO postgres;
ALTER FUNCTION public.phase4_guard_customer_payment_reversal_dependency() OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_order_inventory_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_customer_order_context_internal(UUID, BOOLEAN, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.phase4_customer_completion_replay_preflight_internal(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.record_customer_order_payment(UUID, BIGINT, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.complete_website_order_with_settlement(UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.complete_website_order_with_settlement_v2(UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.return_completed_website_order(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public._complete_order_impl(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public._cancel_order_impl(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.attach_customer_payment_to_open_shift() OWNER TO postgres;
ALTER FUNCTION public.reverse_customer_order_payment(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.reverse_operational_expense(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase4_supplier_context_snapshot_internal(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_supplier_context_internal(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.phase2_lock_receipt_payment_shifts_internal(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.cancel_supplier_receipt(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.reverse_supplier_payment(UUID, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase4_full_shift_context_snapshot_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase4_lock_full_shift_context_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) OWNER TO postgres;

COMMIT;
