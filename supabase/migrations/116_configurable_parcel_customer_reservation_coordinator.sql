BEGIN;

-- ============================================================================
-- Nawasrah ERP - Phase 3.3 Customer reservation coordinator
--
-- Adds the versioned guest reservation lifecycle without changing the public
-- V1 checkout contract.  Reservation-time commercial truth is immutable;
-- exact WAC/COGS is finalized once, atomically with inventory consumption.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Versioned operation identities and one-time cost state.
-- --------------------------------------------------------------------------

ALTER TABLE public.business_operations
  DROP CONSTRAINT business_operations_actor_scope_shape_check,
  DROP CONSTRAINT business_operations_phase3_shape_check;

ALTER TABLE public.business_operations
  ADD CONSTRAINT business_operations_actor_scope_shape_check CHECK (
    (actor_scope_type IS NULL AND actor_scope_hash IS NULL)
    OR (
      actor_scope_type IN ('erp_user', 'guest_gateway', 'system_job')
      AND actor_scope_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  ADD CONSTRAINT business_operations_phase3_shape_check CHECK (
    operation_type NOT IN (
      'phase3_pos_sale_v1',
      'phase3_customer_reservation_v1',
      'phase3_customer_completion_v1',
      'phase3_customer_cancellation_v1',
      'phase3_customer_expiry_v1'
    )
    OR (
      idempotency_key IS NOT NULL
      AND request_fingerprint IS NOT NULL
      AND request_identity_version = 301
      AND request_identity_snapshot IS NOT NULL
      AND result_snapshot IS NOT NULL
      AND completed_at IS NOT NULL
      AND actor_scope_type IS NOT NULL
      AND actor_scope_hash IS NOT NULL
      AND (
        (actor_scope_type = 'erp_user' AND initiated_by IS NOT NULL)
        OR (actor_scope_type IN ('guest_gateway', 'system_job') AND initiated_by IS NULL)
      )
    )
  );

-- --------------------------------------------------------------------------
-- 1A. Registered-customer POS serialization.
--
-- Customer V2 must hold the customer row while it resolves/upserts the guest
-- identity.  POS V2 previously reached the shared inventory hierarchy first,
-- then acquired an implicit KEY SHARE row lock while inserting orders.customer_id.
-- That created a reachable Customer -> Inventory / Inventory -> Customer cycle.
-- Keep the proven sale implementation private and put the minimum compatible
-- customer-row lock ahead of every POS inventory lock.
-- --------------------------------------------------------------------------

ALTER FUNCTION public.create_pos_sale_v2(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) RENAME TO _create_pos_sale_v2_before_registered_customer_lock;

REVOKE ALL ON FUNCTION public._create_pos_sale_v2_before_registered_customer_lock(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_pos_sale_v2(
  p_warehouse_id UUID,
  p_branch_id UUID,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_lines JSONB,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Apply the exact centralized POS authorization/MFA policy before any
  -- Customer-specific lookup or lock.  The private implementation keeps the
  -- same guard as defense in depth after this serialization boundary.
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع نقطة البيع بالإصدار المحمي'
  );

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1
    FROM public.customers customer
    WHERE customer.id = p_customer_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_CUSTOMER_INVALID: العميل المحدد غير موجود.';
    END IF;
  END IF;

  RETURN public._create_pos_sale_v2_before_registered_customer_lock(
    p_warehouse_id,
    p_branch_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_lines,
    p_discount_in_minor_units,
    p_amount_received_in_minor_units,
    p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pos_sale_v2(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_v2(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) TO authenticated;

ALTER FUNCTION public.create_pos_sale_v2(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) OWNER TO postgres;

COMMENT ON FUNCTION public.create_pos_sale_v2(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) IS
  'Phase 3 POS coordinator with registered-customer serialization before inventory locking.';

DROP INDEX public.uq_business_operations_phase3_idempotency;
CREATE UNIQUE INDEX uq_business_operations_phase3_idempotency
  ON public.business_operations(operation_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND operation_type IN (
      'phase3_pos_sale_v1',
      'phase3_customer_reservation_v1',
      'phase3_customer_completion_v1',
      'phase3_customer_cancellation_v1',
      'phase3_customer_expiry_v1'
    );

ALTER TABLE public.orders
  ADD COLUMN cost_finalized_at TIMESTAMPTZ;

ALTER TABLE public.order_items
  ADD COLUMN unit_cost_snapshot_in_minor_units_exact NUMERIC(24, 6),
  ADD COLUMN exact_cogs_snapshot_in_minor_units NUMERIC(30, 6),
  ADD COLUMN cost_finalized_at TIMESTAMPTZ,
  ADD CONSTRAINT order_items_phase3_exact_cost_nonnegative CHECK (
    unit_cost_snapshot_in_minor_units_exact IS NULL
      OR unit_cost_snapshot_in_minor_units_exact >= 0
  ),
  ADD CONSTRAINT order_items_phase3_exact_cogs_nonnegative CHECK (
    exact_cogs_snapshot_in_minor_units IS NULL
      OR exact_cogs_snapshot_in_minor_units >= 0
  ),
  ADD CONSTRAINT order_items_phase3_cost_finalization_shape CHECK (
    cost_finalized_at IS NULL
      OR (
        unit_cost_snapshot_in_minor_units_exact IS NOT NULL
        AND exact_cogs_snapshot_in_minor_units IS NOT NULL
      )
  );

ALTER TABLE public.order_parcel_instances
  ADD COLUMN exact_cogs_snapshot_in_minor_units NUMERIC(30, 6),
  ADD COLUMN cost_finalized_at TIMESTAMPTZ,
  ADD CONSTRAINT order_parcel_instances_exact_cogs_nonnegative CHECK (
    exact_cogs_snapshot_in_minor_units IS NULL
      OR exact_cogs_snapshot_in_minor_units >= 0
  ),
  ADD CONSTRAINT order_parcel_instances_cost_finalization_shape CHECK (
    cost_finalized_at IS NULL
      OR exact_cogs_snapshot_in_minor_units IS NOT NULL
  );

ALTER TABLE public.order_parcel_components
  ADD COLUMN exact_cogs_snapshot_in_minor_units NUMERIC(30, 6),
  ADD COLUMN cost_finalized_at TIMESTAMPTZ,
  ADD CONSTRAINT order_parcel_components_exact_cogs_nonnegative CHECK (
    exact_cogs_snapshot_in_minor_units IS NULL
      OR exact_cogs_snapshot_in_minor_units >= 0
  ),
  ADD CONSTRAINT order_parcel_components_cost_finalization_shape CHECK (
    cost_finalized_at IS NULL
      OR exact_cogs_snapshot_in_minor_units IS NOT NULL
  );

-- An authorization row exists only while the private completion coordinator
-- is executing in the same database transaction.  It is not business state;
-- it prevents a caller-controlled custom GUC from bypassing history guards.
CREATE TABLE public.phase3_customer_cost_finalization_guards (
  transaction_id XID8 NOT NULL,
  lifecycle_operation_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('order', 'order_item', 'parcel_instance', 'parcel_component')),
  row_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transaction_id, row_kind, row_id)
);

ALTER TABLE public.phase3_customer_cost_finalization_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase3_customer_cost_finalization_guards
  FROM PUBLIC, anon, authenticated, service_role;

-- Terminal lifecycle transitions are authorized structurally in the same
-- transaction as the approved V2 coordinator.  A caller-controlled GUC is
-- insufficient on its own because browser roles cannot write this table.
CREATE TABLE public.phase3_customer_lifecycle_transition_guards (
  transaction_id XID8 NOT NULL,
  lifecycle_operation_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  target_status TEXT NOT NULL CHECK (target_status IN ('completed', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (transaction_id, order_id, target_status)
);

ALTER TABLE public.phase3_customer_lifecycle_transition_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase3_customer_lifecycle_transition_guards
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.orders.cost_finalized_at IS
  'Phase-3 Customer V2 all-or-none completion-cost boundary. NULL is not recognized zero cost.';
COMMENT ON COLUMN public.order_items.cost_finalized_at IS
  'Write-once Customer V2 completion-cost boundary; unrelated historical rows remain NULL.';

-- The legacy insert trigger remains authoritative for every legacy/POS row.
-- Only structurally proven Customer V2 reservation lines remain provisional.
CREATE OR REPLACE FUNCTION public.populate_order_item_cost_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_cost BIGINT;
  v_operation_type TEXT;
BEGIN
  SELECT operation.operation_type INTO v_operation_type
  FROM public.orders customer_order
  JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE customer_order.id = NEW.order_id;

  IF v_operation_type = 'phase3_customer_reservation_v1' THEN
    NEW.unit_cost_in_minor_units := 0;
    NEW.cogs_in_minor_units := 0;
    NEW.profit_in_minor_units := 0;
    NEW.unit_cost_snapshot_in_minor_units_exact := NULL;
    NEW.exact_cogs_snapshot_in_minor_units := NULL;
    NEW.cost_finalized_at := NULL;
    RETURN NEW;
  END IF;

  SELECT cost_price_in_minor_units INTO v_unit_cost
  FROM public.products WHERE id = NEW.product_id;
  NEW.unit_cost_in_minor_units := COALESCE(v_unit_cost, 0);
  NEW.cogs_in_minor_units := COALESCE(NEW.quantity, 0) * NEW.unit_cost_in_minor_units;
  NEW.profit_in_minor_units :=
    COALESCE(NEW.line_total_in_minor_units, 0) - NEW.cogs_in_minor_units;
  RETURN NEW;
END;
$$;

-- Structural predicate shared by the three narrowly-scoped history guards.
CREATE FUNCTION public.phase3_customer_cost_finalization_allowed_internal(
  p_order_id UUID,
  p_row_kind TEXT,
  p_row_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.orders customer_order
      JOIN public.business_operations creation
        ON creation.id = customer_order.operation_id
      WHERE customer_order.id = p_order_id
        AND customer_order.source = 'website'
        AND customer_order.status IN ('ready', 'out_for_delivery')
        AND customer_order.cost_finalized_at IS NULL
        AND creation.operation_type = 'phase3_customer_reservation_v1'
    )
    AND EXISTS (
      SELECT 1
      FROM public.phase3_customer_cost_finalization_guards guard_authorization
      WHERE guard_authorization.transaction_id = pg_current_xact_id()
        AND guard_authorization.order_id = p_order_id
        AND guard_authorization.row_kind = p_row_kind
        AND guard_authorization.row_id = p_row_id
        AND guard_authorization.lifecycle_operation_id::TEXT = CURRENT_SETTING(
          'nawasrah.customer_cost_finalization_operation_id', true
        )
    );
$$;

REVOKE ALL ON FUNCTION public.phase3_customer_cost_finalization_allowed_internal(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.phase3_customer_cost_finalization_allowed_internal(UUID, TEXT, UUID)
  OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.guard_order_parcel_instance_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cost_transition BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'FINALIZED_PARCEL_IMMUTABLE: لا يمكن حذف حقيقة طرد مكتمل.';
    END IF;
    RETURN OLD;
  END IF;

  v_cost_transition :=
    OLD.cost_finalized_at IS NULL
    AND NEW.cost_finalized_at IS NOT NULL
    AND public.phase3_customer_cost_finalization_allowed_internal(
      OLD.order_id, 'parcel_instance', OLD.id
    )
    AND ROW(
      NEW.order_item_id, NEW.order_id, NEW.operation_id,
      NEW.parcel_configuration_id, NEW.family_product_id,
      NEW.instance_sequence, NEW.configuration_revision,
      NEW.units_per_parcel_snapshot, NEW.parcel_unit_name_snapshot,
      NEW.gross_amount_snapshot_in_minor_units,
      NEW.allocated_discount_snapshot_in_minor_units,
      NEW.net_refundable_amount_snapshot_in_minor_units,
      NEW.composition_fingerprint, NEW.finalized_at, NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.order_item_id, OLD.order_id, OLD.operation_id,
      OLD.parcel_configuration_id, OLD.family_product_id,
      OLD.instance_sequence, OLD.configuration_revision,
      OLD.units_per_parcel_snapshot, OLD.parcel_unit_name_snapshot,
      OLD.gross_amount_snapshot_in_minor_units,
      OLD.allocated_discount_snapshot_in_minor_units,
      OLD.net_refundable_amount_snapshot_in_minor_units,
      OLD.composition_fingerprint, OLD.finalized_at, OLD.created_at
    );

  IF v_cost_transition THEN
    RETURN NEW;
  END IF;

  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'FINALIZED_PARCEL_IMMUTABLE: لا يمكن تعديل حقيقة طرد مكتمل.';
  END IF;

  IF ROW(
    NEW.order_item_id, NEW.order_id, NEW.operation_id,
    NEW.parcel_configuration_id, NEW.family_product_id,
    NEW.instance_sequence, NEW.configuration_revision,
    NEW.units_per_parcel_snapshot, NEW.parcel_unit_name_snapshot,
    NEW.gross_amount_snapshot_in_minor_units,
    NEW.allocated_discount_snapshot_in_minor_units,
    NEW.net_refundable_amount_snapshot_in_minor_units,
    NEW.cogs_snapshot_in_minor_units, NEW.exact_cogs_snapshot_in_minor_units,
    NEW.cost_finalized_at, NEW.composition_fingerprint, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.order_item_id, OLD.order_id, OLD.operation_id,
    OLD.parcel_configuration_id, OLD.family_product_id,
    OLD.instance_sequence, OLD.configuration_revision,
    OLD.units_per_parcel_snapshot, OLD.parcel_unit_name_snapshot,
    OLD.gross_amount_snapshot_in_minor_units,
    OLD.allocated_discount_snapshot_in_minor_units,
    OLD.net_refundable_amount_snapshot_in_minor_units,
    OLD.cogs_snapshot_in_minor_units, OLD.exact_cogs_snapshot_in_minor_units,
    OLD.cost_finalized_at, OLD.composition_fingerprint, OLD.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_IDENTITY_IMMUTABLE: لا يمكن إعادة ربط أو تعديل حقيقة الطرد بعد إنشائه.';
  END IF;

  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL THEN
    IF CURRENT_SETTING('nawasrah.parcel_finalization_id', true)
      IS DISTINCT FROM OLD.id::TEXT
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PARCEL_FINALIZATION_REQUIRES_INTERNAL_PROTOCOL: استخدم مسار الإكمال الذري المحمي.';
    END IF;
  ELSIF NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_FINALIZATION_INVALID_TRANSITION: حد الإكمال أحادي الاتجاه.';
  END IF;
  RETURN NEW;
END;
$$;

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
        NEW.base_unit_name_snapshot, NEW.created_at
      ) IS NOT DISTINCT FROM ROW(
        OLD.parcel_instance_id, OLD.operation_id, OLD.product_id,
        OLD.base_quantity, OLD.product_name_snapshot, OLD.sku_snapshot,
        OLD.base_unit_name_snapshot, OLD.created_at
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

CREATE OR REPLACE FUNCTION public.guard_finalized_order_parcel_item_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cost_transition BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_cost_transition :=
      OLD.cost_finalized_at IS NULL
      AND NEW.cost_finalized_at IS NOT NULL
      AND public.phase3_customer_cost_finalization_allowed_internal(
        OLD.order_id, 'order_item', OLD.id
      )
      AND ROW(
        NEW.order_id, NEW.product_id, NEW.product_name_snapshot, NEW.sku_snapshot,
        NEW.quantity, NEW.unit_price_in_minor_units, NEW.line_total_in_minor_units,
        NEW.sale_package_quantity, NEW.units_per_sale_package,
        NEW.sale_package_name_snapshot, NEW.sale_package_price_in_minor_units,
        NEW.commercial_line_kind, NEW.family_product_id,
        NEW.parcel_configuration_id, NEW.parcel_configuration_revision,
        NEW.base_unit_name_snapshot,
        NEW.allocated_discount_snapshot_in_minor_units,
        NEW.net_refundable_amount_snapshot_in_minor_units, NEW.created_at
      ) IS NOT DISTINCT FROM ROW(
        OLD.order_id, OLD.product_id, OLD.product_name_snapshot, OLD.sku_snapshot,
        OLD.quantity, OLD.unit_price_in_minor_units, OLD.line_total_in_minor_units,
        OLD.sale_package_quantity, OLD.units_per_sale_package,
        OLD.sale_package_name_snapshot, OLD.sale_package_price_in_minor_units,
        OLD.commercial_line_kind, OLD.family_product_id,
        OLD.parcel_configuration_id, OLD.parcel_configuration_revision,
        OLD.base_unit_name_snapshot,
        OLD.allocated_discount_snapshot_in_minor_units,
        OLD.net_refundable_amount_snapshot_in_minor_units, OLD.created_at
      );
    IF v_cost_transition THEN RETURN NEW; END IF;
  END IF;

  PERFORM 1 FROM public.order_parcel_instances instance
  WHERE instance.order_item_id = OLD.id ORDER BY instance.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.order_parcel_instances WHERE order_item_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_LINE_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد بدء إنشاء طرد مرتبط به.';
  END IF;

  PERFORM 1 FROM public.order_inventory_reservations reservation
  WHERE reservation.order_item_id = OLD.id ORDER BY reservation.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.order_inventory_reservations WHERE order_item_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'RESERVED_ORDER_ITEM_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد إنشاء حجز مرتبط به.';
  END IF;

  PERFORM 1 FROM public.sales_return_items return_item
  WHERE return_item.order_item_id = OLD.id ORDER BY return_item.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.sales_return_items WHERE order_item_id = OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'RETURNED_ORDER_ITEM_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد إنشاء إرجاع مرتبط به.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_phase3_customer_order_cost_finalization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.cost_finalized_at IS NOT DISTINCT FROM OLD.cost_finalized_at THEN
    RETURN NEW;
  END IF;

  IF OLD.cost_finalized_at IS NULL
    AND NEW.cost_finalized_at IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.phase3_customer_cost_finalization_guards guard_authorization
      WHERE guard_authorization.transaction_id = pg_current_xact_id()
        AND guard_authorization.order_id = OLD.id
        AND guard_authorization.row_kind = 'order'
        AND guard_authorization.row_id = OLD.id
        AND guard_authorization.lifecycle_operation_id::TEXT = CURRENT_SETTING(
          'nawasrah.customer_cost_finalization_operation_id', true
        )
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'CUSTOMER_ORDER_COST_FINALIZATION_IMMUTABLE: حد تكلفة الطلب أحادي الاتجاه ومحمي.';
END;
$$;

CREATE TRIGGER trg_guard_phase3_customer_order_cost_finalization
BEFORE UPDATE OF cost_finalized_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_phase3_customer_order_cost_finalization();

CREATE FUNCTION public.guard_phase3_customer_v2_terminal_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_type TEXT;
  v_expected_reservation_state TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR NEW.status NOT IN ('completed', 'cancelled', 'expired')
  THEN
    RETURN NEW;
  END IF;

  SELECT operation.operation_type INTO v_operation_type
  FROM public.business_operations operation
  WHERE operation.id = OLD.operation_id;

  IF v_operation_type IS DISTINCT FROM 'phase3_customer_reservation_v1' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.phase3_customer_lifecycle_transition_guards lifecycle_guard
    WHERE lifecycle_guard.transaction_id = pg_current_xact_id()
      AND lifecycle_guard.order_id = OLD.id
      AND lifecycle_guard.target_status = NEW.status
      AND lifecycle_guard.lifecycle_operation_id::TEXT = CURRENT_SETTING(
        'nawasrah.customer_lifecycle_operation_id', true
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED: Customer V2 terminal transitions require the approved coordinator.';
  END IF;

  IF NEW.status = 'completed' THEN
    IF NEW.cost_finalized_at IS NULL
      OR EXISTS (
        SELECT 1 FROM public.order_items item
        WHERE item.order_id = OLD.id
          AND (item.cost_finalized_at IS NULL
            OR item.exact_cogs_snapshot_in_minor_units IS NULL)
      )
      OR EXISTS (
        SELECT 1 FROM public.order_parcel_instances instance
        WHERE instance.order_id = OLD.id
          AND (instance.cost_finalized_at IS NULL
            OR instance.exact_cogs_snapshot_in_minor_units IS NULL)
      )
      OR EXISTS (
        SELECT 1
        FROM public.order_parcel_components component
        JOIN public.order_parcel_instances instance
          ON instance.id = component.parcel_instance_id
        WHERE instance.order_id = OLD.id
          AND (component.cost_finalized_at IS NULL
            OR component.exact_cogs_snapshot_in_minor_units IS NULL)
      )
      OR EXISTS (
        SELECT 1 FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = OLD.id
          AND reservation.reservation_state <> 'consumed'
      )
      OR EXISTS (
        SELECT 1
        FROM public.order_parcel_instances instance
        WHERE instance.order_id = OLD.id
          AND (
            instance.cogs_snapshot_in_minor_units IS DISTINCT FROM (
              SELECT COALESCE(SUM(component.cogs_snapshot_in_minor_units), 0)::BIGINT
              FROM public.order_parcel_components component
              WHERE component.parcel_instance_id = instance.id
            )
            OR instance.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
              SELECT COALESCE(SUM(component.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
              FROM public.order_parcel_components component
              WHERE component.parcel_instance_id = instance.id
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.order_items item
        WHERE item.order_id = OLD.id
          AND item.commercial_line_kind = 'configurable_parcel'
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
          )
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_COST_FINALIZATION_INCOMPLETE: Customer V2 completion cost is incomplete.';
    END IF;
  ELSE
    v_expected_reservation_state := CASE NEW.status
      WHEN 'cancelled' THEN 'cancelled' ELSE 'released' END;
    IF NEW.cost_finalized_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.order_items item
        WHERE item.order_id = OLD.id AND item.cost_finalized_at IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.order_parcel_instances instance
        WHERE instance.order_id = OLD.id AND instance.cost_finalized_at IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.order_parcel_components component
        JOIN public.order_parcel_instances instance
          ON instance.id = component.parcel_instance_id
        WHERE instance.order_id = OLD.id
          AND component.cost_finalized_at IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = OLD.id
          AND reservation.reservation_state <> v_expected_reservation_state
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_INCOMPLETE: Customer V2 reservation release is incomplete.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_phase3_customer_v2_terminal_status
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_phase3_customer_v2_terminal_status();

-- Legacy lifecycle wrappers operate on one product per Order Item and cannot
-- consume/release Phase-3 component reservations or finalize per-instance
-- costs.  Reject immutable Customer-V2 lineage before legacy inventory or
-- settlement code starts; the status trigger above remains defense in depth.
CREATE FUNCTION public.phase3_assert_legacy_customer_lifecycle_allowed_internal(
  p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders customer_order
    JOIN public.business_operations operation
      ON operation.id = customer_order.operation_id
    WHERE customer_order.id = p_order_id
      AND operation.operation_type = 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_V2_LIFECYCLE_COORDINATOR_REQUIRED: Customer V2 terminal transitions require the approved coordinator.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'sales', 'warehouse_keeper',
      'delivery_driver'
    ],
    'إكمال الطلبات وخصم المخزون'
  );
  PERFORM public.phase3_assert_legacy_customer_lifecycle_allowed_internal(p_order_id);
  RETURN public._complete_order_impl(p_order_id, p_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إلغاء الطلبات'
  );
  PERFORM public.phase3_assert_legacy_customer_lifecycle_allowed_internal(p_order_id);
  RETURN public._cancel_order_impl(p_order_id, p_reason);
END;
$$;

-- Phase-3 lifecycle operations use the same private actor and replay
-- primitives as POS/reservation creation.  The system actor is a constant
-- namespace and never accepts caller identity material.
CREATE OR REPLACE FUNCTION public.phase3_actor_scope_hash_internal(
  p_actor_scope_type TEXT,
  p_erp_user_id UUID DEFAULT NULL,
  p_guest_phone_hash TEXT DEFAULT NULL,
  p_guest_session_hash TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope_type TEXT := LOWER(NULLIF(BTRIM(p_actor_scope_type), ''));
  v_material TEXT;
BEGIN
  IF v_scope_type = 'erp_user' THEN
    IF p_erp_user_id IS NULL OR p_guest_phone_hash IS NOT NULL
      OR p_guest_session_hash IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_ACTOR_SCOPE_INVALID: ERP actor scope is malformed.';
    END IF;
    v_material := 'phase3:erp_user:v1|' || LOWER(p_erp_user_id::TEXT);
  ELSIF v_scope_type = 'guest_gateway' THEN
    IF p_erp_user_id IS NOT NULL
      OR COALESCE(p_guest_phone_hash, '') !~ '^[0-9a-f]{64}$'
      OR COALESCE(p_guest_session_hash, '') !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_ACTOR_SCOPE_INVALID: Guest actor scope is malformed.';
    END IF;
    v_material := 'phase3:guest_gateway:v1|'
      || p_guest_phone_hash || '|' || p_guest_session_hash;
  ELSIF v_scope_type = 'system_job' THEN
    IF p_erp_user_id IS NOT NULL OR p_guest_phone_hash IS NOT NULL
      OR p_guest_session_hash IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_ACTOR_SCOPE_INVALID: System actor scope is malformed.';
    END IF;
    v_material := 'phase3:system_job:v1|customer-reservation-lifecycle';
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_SCOPE_INVALID: Unsupported actor scope.';
  END IF;

  RETURN ENCODE(extensions.digest(v_material, 'sha256'::TEXT), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION public.phase3_resolve_operation_replay_internal(
  p_operation_type TEXT,
  p_idempotency_key TEXT,
  p_actor_scope_type TEXT,
  p_actor_scope_hash TEXT,
  p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.business_operations%ROWTYPE;
  v_operation_type TEXT := LOWER(NULLIF(BTRIM(p_operation_type), ''));
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_scope_type TEXT := LOWER(NULLIF(BTRIM(p_actor_scope_type), ''));
  v_scope_hash TEXT := LOWER(NULLIF(BTRIM(p_actor_scope_hash), ''));
  v_fingerprint TEXT := LOWER(NULLIF(BTRIM(p_request_fingerprint), ''));
BEGIN
  IF v_operation_type NOT IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1',
    'phase3_customer_completion_v1', 'phase3_customer_cancellation_v1',
    'phase3_customer_expiry_v1'
  ) OR v_key IS NULL OR CHAR_LENGTH(v_key) > 255
    OR v_scope_type NOT IN ('erp_user', 'guest_gateway', 'system_job')
    OR COALESCE(v_scope_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(v_fingerprint, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Invalid operation identity.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase3-operation:' || v_operation_type || ':' || v_key, 0
  ));

  SELECT * INTO v_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = v_operation_type
    AND operation.idempotency_key = v_key
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN JSONB_BUILD_OBJECT('decision', 'NEW');
  END IF;
  IF v_operation.actor_scope_type IS DISTINCT FROM v_scope_type
    OR v_operation.actor_scope_hash IS DISTINCT FROM v_scope_hash
    OR v_operation.request_fingerprint IS DISTINCT FROM v_fingerprint
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;
  IF v_operation.request_identity_version IS DISTINCT FROM 301
    OR v_operation.request_identity_snapshot IS NULL
    OR v_operation.result_snapshot IS NULL
    OR v_operation.completed_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_OPERATION_IDENTITY_UNPROVEN: Stored operation identity is incomplete.';
  END IF;
  RETURN JSONB_BUILD_OBJECT(
    'decision', 'REPLAY', 'operation_id', v_operation.id,
    'result_snapshot', v_operation.result_snapshot
  );
END;
$$;

-- Preserve the published V1 signature while making raw-key ownership
-- symmetric with V2.  V1 never tries to reconstruct a V2 request.
ALTER FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) RENAME TO _submit_guest_customer_order_v1_before_phase3;

REVOKE ALL ON FUNCTION public._submit_guest_customer_order_v1_before_phase3(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.submit_guest_customer_order(
  p_idempotency_key TEXT,
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_governorate TEXT,
  p_city TEXT,
  p_area TEXT,
  p_street TEXT,
  p_building TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_customer_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_promotion_code TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash_on_delivery',
  p_delivery_zone TEXT DEFAULT 'inside_ramtha'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := LOWER(NULLIF(BTRIM(p_idempotency_key), ''));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Guest checkout requires the protected gateway.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  IF EXISTS (
    SELECT 1
    FROM public.orders customer_order
    JOIN public.business_operations operation
      ON operation.id = customer_order.operation_id
    WHERE customer_order.idempotency_key = v_key
      AND operation.operation_type = 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  RETURN public._submit_guest_customer_order_v1_before_phase3(
    p_idempotency_key, p_customer_full_name, p_customer_phone,
    p_governorate, p_city, p_area, p_street, p_building,
    p_address_notes, p_google_maps_url, p_latitude, p_longitude,
    p_customer_notes, p_items, p_promotion_code, p_payment_method,
    p_delivery_zone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) TO service_role;

CREATE FUNCTION public.phase3_customer_line_identity_internal(p_line JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind TEXT := LOWER(NULLIF(BTRIM(p_line->>'commercial_line_kind'), ''));
BEGIN
  IF v_kind = 'base_unit' THEN
    RETURN 'base_unit:' || LOWER(public.phase3_require_uuid_internal(
      p_line->>'product_id', 'quote product_id'
    )::TEXT);
  ELSIF v_kind = 'legacy_single_sku_parcel' THEN
    RETURN 'legacy_single_sku_parcel:' || LOWER(public.phase3_require_uuid_internal(
      p_line->>'product_id', 'quote product_id'
    )::TEXT);
  ELSIF v_kind = 'configurable_parcel' THEN
    RETURN 'configurable_parcel:'
      || LOWER(public.phase3_require_uuid_internal(
        p_line->>'family_product_id', 'quote family_product_id'
      )::TEXT) || ':'
      || LOWER(public.phase3_require_uuid_internal(
        p_line->>'parcel_configuration_id', 'quote parcel_configuration_id'
      )::TEXT) || ':'
      || public.phase3_require_positive_integer_internal(
        p_line->>'configuration_revision', 'quote configuration_revision'
      )::TEXT;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Unsupported Customer line kind.';
END;
$$;

CREATE FUNCTION public.submit_guest_customer_order_v2(
  p_idempotency_key TEXT,
  p_guest_phone_hash TEXT,
  p_guest_session_hash TEXT,
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_governorate TEXT,
  p_city TEXT,
  p_area TEXT,
  p_street TEXT,
  p_building TEXT,
  p_address_notes TEXT,
  p_google_maps_url TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_customer_notes TEXT,
  p_lines JSONB,
  p_promotion_code TEXT,
  p_payment_method TEXT,
  p_delivery_zone TEXT,
  p_expected_subtotal_in_minor_units BIGINT,
  p_expected_discount_in_minor_units BIGINT,
  p_expected_delivery_fee_in_minor_units BIGINT,
  p_expected_total_in_minor_units BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := LOWER(NULLIF(BTRIM(p_idempotency_key), ''));
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_payment_method TEXT := LOWER(NULLIF(BTRIM(p_payment_method), ''));
  v_delivery_zone TEXT := LOWER(NULLIF(BTRIM(p_delivery_zone), ''));
  v_actor_hash TEXT;
  v_delivery_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_quote_lines JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_component JSONB;
  v_validated JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_plan_components JSONB;
  v_line_weights JSONB;
  v_instance_weights JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_line_identity TEXT;
  v_expected_price BIGINT;
  v_product public.products%ROWTYPE;
  v_settings public.storefront_settings%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_instance_id UUID;
  v_customer_id UUID;
  v_address_id UUID := gen_random_uuid();
  v_customer_reused BOOLEAN := false;
  v_customer_is_blocked BOOLEAN;
  v_customer_is_active BOOLEAN;
  v_branch_id UUID;
  v_warehouse_id UUID;
  v_order_number TEXT;
  v_tracking_token UUID := gen_random_uuid();
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_delivery_fee BIGINT;
  v_total BIGINT;
  v_promotion public.promotion_codes%ROWTYPE;
  v_promotion_id UUID;
  v_promotion_code TEXT;
  v_recent_orders INTEGER;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
  v_location_source TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Customer V2 requires the protected gateway.';
  END IF;
  IF v_key IS NULL
    OR v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR COALESCE(p_guest_phone_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_guest_session_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Customer operation identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_customer_full_name), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_customer_full_name)) NOT BETWEEN 2 AND 120
    OR v_phone !~ '^07[789][0-9]{7}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Customer identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_governorate), '') IS NULL
    OR NULLIF(BTRIM(p_city), '') IS NULL
    OR NULLIF(BTRIM(p_area), '') IS NULL
    OR NULLIF(BTRIM(p_street), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_governorate)) > 80
    OR CHAR_LENGTH(BTRIM(p_city)) > 80
    OR CHAR_LENGTH(BTRIM(p_area)) > 120
    OR CHAR_LENGTH(BTRIM(p_street)) > 300
    OR CHAR_LENGTH(COALESCE(BTRIM(p_building), '')) > 120
    OR CHAR_LENGTH(COALESCE(BTRIM(p_address_notes), '')) > 500
    OR CHAR_LENGTH(COALESCE(BTRIM(p_customer_notes), '')) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Address fields are invalid.';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR (p_latitude IS NOT NULL AND (
      p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Delivery coordinates are invalid.';
  END IF;
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq')
    OR v_delivery_zone NOT IN ('inside_ramtha', 'outside_ramtha')
    OR COALESCE(p_expected_subtotal_in_minor_units, -1) < 0
    OR COALESCE(p_expected_discount_in_minor_units, -1) < 0
    OR COALESCE(p_expected_delivery_fee_in_minor_units, -1) < 0
    OR COALESCE(p_expected_total_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_INVALID: Customer quote is invalid.';
  END IF;

  IF JSONB_TYPEOF(p_lines) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_lines) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer lines are invalid.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'line_identity', public.phase3_customer_line_identity_internal(value),
    'expected_unit_price_in_minor_units',
      public.phase3_require_nonnegative_bigint_internal(
        value->>'expected_unit_price_in_minor_units',
        'expected_unit_price_in_minor_units'
      )
  ) ORDER BY public.phase3_customer_line_identity_internal(value))
  INTO v_quote_lines
  FROM JSONB_ARRAY_ELEMENTS(p_lines);

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_lines) candidate
    GROUP BY public.phase3_customer_line_identity_internal(candidate)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer commercial identities must be unique.';
  END IF;

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'guest_gateway', NULL, LOWER(p_guest_phone_hash), LOWER(p_guest_session_hash)
  );
  v_delivery_hash := ENCODE(extensions.digest(
    JSONB_BUILD_OBJECT(
      'governorate', BTRIM(p_governorate), 'city', BTRIM(p_city),
      'area', BTRIM(p_area), 'street', BTRIM(p_street),
      'building', NULLIF(BTRIM(p_building), ''),
      'latitude', p_latitude, 'longitude', p_longitude
    )::TEXT, 'sha256'::TEXT
  ), 'hex');

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'guest_gateway',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'customer_reservation',
    'warehouse_id', '00000000-0000-0000-0000-000000000001',
    'customer_identity_hash', LOWER(p_guest_phone_hash),
    'delivery_identity_hash', v_delivery_hash,
    'payment_method', v_payment_method,
    'delivery_zone', v_delivery_zone,
    'promotion_code', NULLIF(BTRIM(p_promotion_code), ''),
    'order_discount_in_minor_units', 0,
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request)
    || JSONB_BUILD_OBJECT('customer_quote', JSONB_BUILD_OBJECT(
      'lines', v_quote_lines,
      'subtotal_in_minor_units', p_expected_subtotal_in_minor_units,
      'discount_in_minor_units', p_expected_discount_in_minor_units,
      'delivery_fee_in_minor_units', p_expected_delivery_fee_in_minor_units,
      'total_in_minor_units', p_expected_total_in_minor_units
    ));
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);

  -- Same raw-key lock as V1. Replay is decided before current feature, price,
  -- configuration, inventory or storefront state is consulted.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_reservation_v1', v_key, 'guest_gateway',
    v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE idempotency_key = v_key) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  SELECT * INTO v_settings FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(v_settings.orders_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_ORDERS_DISABLED: Customer orders are unavailable.';
  END IF;
  IF v_delivery_zone = 'inside_ramtha'
    AND CONCAT_WS(' ', p_governorate, p_city, p_area) NOT ILIKE '%الرمثا%'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_DELIVERY_ZONE_MISMATCH: Delivery zone does not match address.';
  END IF;

  SELECT warehouse.branch_id, warehouse.id
  INTO v_branch_id, v_warehouse_id
  FROM public.warehouses warehouse
  JOIN public.branches branch ON branch.id = warehouse.branch_id
  WHERE warehouse.is_active AND branch.is_active
  ORDER BY warehouse.created_at, warehouse.id
  LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LOCATION_UNAVAILABLE: No active storefront warehouse.';
  END IF;

  -- Customer V1 already serializes normalized customer identity before taking
  -- inventory locks.  V2 follows the same relative order so mixed-version
  -- requests cannot form Customer -> Inventory / Inventory -> Customer cycles.
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);
  SELECT id, is_blocked, is_active INTO
    v_customer_id, v_customer_is_blocked, v_customer_is_active
  FROM public.customers
  WHERE public.normalize_customer_phone(phone) = v_phone AND is_deleted = false
  LIMIT 1 FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'guest_gateway', NULL
    );
  END IF;

  SELECT ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';
  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id FOR SHARE;
    PERFORM family.id FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id FOR SHARE;
  END IF;

  SELECT ARRAY_AGG(DISTINCT identity.product_id ORDER BY identity.product_id)
  INTO v_product_ids
  FROM (
    SELECT (candidate->>'product_id')::UUID AS product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' IN ('base_unit', 'legacy_single_sku_parcel')
    UNION ALL
    SELECT (component->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(candidate->'parcel_instances') parcel
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(parcel->'components') component
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) identity;
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_line_identity := public.phase3_customer_line_identity_internal(v_line);
    SELECT public.phase3_require_nonnegative_bigint_internal(
      raw_line->>'expected_unit_price_in_minor_units',
      'expected_unit_price_in_minor_units'
    ) INTO v_expected_price
    FROM JSONB_ARRAY_ELEMENTS(p_lines) raw_line
    WHERE public.phase3_customer_line_identity_internal(raw_line) = v_line_identity;
    v_plan_instances := '[]'::JSONB;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRODUCT_INVALID: Base Unit is unavailable.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Legacy Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;
    ELSE
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'family_product_id')::UUID AND is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Configurable Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;

      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_validated := public.phase3_validate_configurable_parcel_internal(
          'guest_gateway', NULL, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'reservation_id', gen_random_uuid(),
          'product_id', component->>'product_id',
          'base_quantity', (component->>'base_quantity')::INTEGER,
          'product_name_snapshot', component->>'product_name_snapshot',
          'sku_snapshot', component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(component->>'base_unit_name_snapshot', ''), v_base_unit_name
          )
        ) ORDER BY (component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') component;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    IF v_base_quantity > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_CUSTOMER_QUANTITY_OVERFLOW: Base quantity exceeds safe capacity.';
    END IF;
    IF v_unit_price IS DISTINCT FROM v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Commercial price changed.';
    END IF;
    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
      'reservation_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN NULL ELSE gen_random_uuid() END,
      'commercial_line_kind', v_line_kind,
      'product_id', v_product.id,
      'product_name_snapshot', v_product.name_ar,
      'sku_snapshot', v_product.sku,
      'family_product_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'family_product_id' ELSE NULL END,
      'parcel_configuration_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'parcel_configuration_id' ELSE NULL END,
      'configuration_revision', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN (v_line->>'configuration_revision')::INTEGER ELSE NULL END,
      'commercial_quantity', v_commercial_quantity,
      'base_quantity', v_base_quantity,
      'units_per_parcel', v_units_per_parcel,
      'base_unit_name_snapshot', v_base_unit_name,
      'parcel_unit_name_snapshot', v_parcel_unit_name,
      'unit_price_in_minor_units', v_unit_price,
      'gross_amount_in_minor_units', v_line_gross,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF v_subtotal IS DISTINCT FROM p_expected_subtotal_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Subtotal changed.';
  END IF;
  IF v_subtotal < v_settings.minimum_order_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_MINIMUM_ORDER: Order is below the current minimum.';
  END IF;

  IF NULLIF(BTRIM(p_promotion_code), '') IS NOT NULL THEN
    SELECT * INTO v_promotion FROM public.promotion_codes
    WHERE code = UPPER(BTRIM(p_promotion_code)) FOR UPDATE;
    IF NOT FOUND OR NOT v_promotion.is_active
      OR (v_promotion.starts_at IS NOT NULL AND NOW() < v_promotion.starts_at)
      OR (v_promotion.expires_at IS NOT NULL AND NOW() >= v_promotion.expires_at)
      OR v_subtotal < v_promotion.minimum_subtotal_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable.';
    END IF;
    IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
      SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
    ) >= v_promotion.maximum_total_redemptions THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is exhausted.';
    END IF;
    IF (SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
        AND redemption.customer_phone = v_phone
    ) >= v_promotion.maximum_redemptions_per_phone THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable for this customer.';
    END IF;
    v_promotion_id := v_promotion.id;
    v_promotion_code := v_promotion.code;
    IF v_promotion.discount_type = 'fixed' THEN
      v_discount := LEAST(v_promotion.discount_value, v_subtotal);
    ELSE
      v_discount := FLOOR(v_subtotal::NUMERIC * v_promotion.discount_value / 10000)::BIGINT;
      IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
        v_discount := LEAST(v_discount, v_promotion.maximum_discount_in_minor_units);
      END IF;
    END IF;
    v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  END IF;

  v_delivery_fee := CASE v_delivery_zone
    WHEN 'inside_ramtha' THEN v_settings.inside_ramtha_delivery_fee_in_minor_units
    ELSE v_settings.outside_ramtha_delivery_fee_in_minor_units END;
  v_total := v_subtotal - v_discount + v_delivery_fee;
  IF v_discount IS DISTINCT FROM p_expected_discount_in_minor_units
    OR v_delivery_fee IS DISTINCT FROM p_expected_delivery_fee_in_minor_units
    OR v_total IS DISTINCT FROM p_expected_total_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Accepted totals changed.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;
  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(v_discount, v_line_weights)
    WHERE allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_plan_instances := v_line->'parcel_instances';
    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_instances) instance;
      v_plan_instances := '[]'::JSONB;
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(v_line_discount, v_instance_weights)
        WHERE allocation_key = v_instance->>'instance_sequence';
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', COALESCE(v_instance_discount, 0),
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - COALESCE(v_instance_discount, 0)
          )
        );
      END LOOP;
    END IF;
    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'parcel_instances', v_plan_instances
      )
    );
  END LOOP;

  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID product_id,
        (line->>'base_quantity')::INTEGER quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    ) SELECT product_id, SUM(quantity)::INTEGER quantity
      FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_INSUFFICIENT_INVENTORY: Component inventory is unavailable.';
    END IF;
  END LOOP;

  SELECT COUNT(*)::INTEGER INTO v_recent_orders
  FROM public.orders customer_order
  JOIN public.customers customer ON customer.id = customer_order.customer_id
  WHERE customer_order.source = 'website'
    AND public.normalize_customer_phone(customer.phone) = v_phone
    AND customer_order.created_at >= NOW() - INTERVAL '10 minutes';
  IF v_recent_orders >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RATE_LIMITED: Too many recent orders.';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    IF v_customer_is_blocked OR NOT v_customer_is_active THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_UNAVAILABLE: Customer account is unavailable.';
    END IF;
    v_customer_reused := true;
    UPDATE public.customers SET full_name = BTRIM(p_customer_full_name),
      phone = v_phone, governorate = BTRIM(p_governorate), updated_at = NOW()
    WHERE id = v_customer_id;
  ELSE
    v_customer_id := gen_random_uuid();
    INSERT INTO public.customers(
      id, full_name, phone, governorate, customer_type,
      is_active, is_blocked, is_deleted
    ) VALUES (
      v_customer_id, BTRIM(p_customer_full_name), v_phone,
      BTRIM(p_governorate), 'wholesale', true, false, false
    );
  END IF;

  UPDATE public.customer_addresses SET is_default = false
  WHERE customer_id = v_customer_id AND is_default;
  v_formatted_address := CONCAT_WS(' - ', BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''));
  v_google_maps_url := COALESCE(NULLIF(BTRIM(p_google_maps_url), ''), CASE
    WHEN p_latitude IS NOT NULL THEN 'https://www.google.com/maps?q='
      || p_latitude::TEXT || ',' || p_longitude::TEXT ELSE NULL END);
  IF v_google_maps_url IS NOT NULL AND (
    CHAR_LENGTH(v_google_maps_url) > 1000 OR v_google_maps_url !~* '^https://'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Map URL is invalid.';
  END IF;
  v_location_source := CASE WHEN p_latitude IS NOT NULL THEN 'gps'
    WHEN v_google_maps_url IS NOT NULL THEN 'map_pin' ELSE 'manual' END;
  INSERT INTO public.customer_addresses(
    id, customer_id, governorate, city, area, street, building, notes,
    latitude, longitude, formatted_address, google_maps_url,
    location_source, location_confirmed, is_default
  ) VALUES (
    v_address_id, v_customer_id, BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''),
    NULLIF(BTRIM(p_address_notes), ''), p_latitude, p_longitude,
    v_formatted_address, v_google_maps_url, v_location_source,
    p_latitude IS NOT NULL, true
  );

  LOOP
    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
      || LPAD((FLOOR(RANDOM() * 89999 + 10000))::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
  END LOOP;

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id', 'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot', 'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits', (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits', (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'costFinalized', false, 'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotent_replay', false,
    'contract_version', 'phase3-customer-reservation-v2',
    'operation_id', v_operation_id, 'order_id', v_order_id,
    'order_number', v_order_number, 'customer_id', v_customer_id,
    'customer_address_id', v_address_id, 'customer_reused', v_customer_reused,
    'status', 'new', 'subtotal', v_subtotal, 'discount', v_discount,
    'delivery_fee', v_delivery_fee, 'total', v_total,
    'promotion_code', v_promotion_code, 'payment_method', v_payment_method,
    'payment_status', 'unpaid', 'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'items', v_result_items,
    'message', 'تم إنشاء طلب V2 وحجز مكوناته بدقة.'
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_customer_reservation_v1', v_key, v_fingerprint,
    NULL, v_result, NOW(), 301, v_canonical_request,
    'guest_gateway', v_actor_hash
  );
  INSERT INTO public.orders(
    id, order_number, customer_id, customer_address_id, customer_name_snapshot,
    branch_id, warehouse_id, status, payment_method, payment_status,
    subtotal_in_minor_units, delivery_fee_in_minor_units,
    discount_in_minor_units, total_in_minor_units, amount_paid_in_minor_units,
    customer_notes, internal_notes, whatsapp_message, source,
    idempotency_key, promotion_code_id, promotion_code_snapshot,
    delivery_zone, tracking_token, operation_id
  ) VALUES (
    v_order_id, v_order_number, v_customer_id, v_address_id,
    BTRIM(p_customer_full_name), v_branch_id, v_warehouse_id, 'new',
    v_payment_method, 'unpaid', v_subtotal, v_delivery_fee, v_discount,
    v_total, 0, NULLIF(BTRIM(p_customer_notes), ''),
    'طلب عميل V2 محجوز بالمكونات',
    'تم استلام طلبك رقم ' || v_order_number, 'website', v_key,
    v_promotion_id, v_promotion_code, v_delivery_zone, v_tracking_token,
    v_operation_id
  );

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items(
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot', CASE
        WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'commercial_quantity')::INTEGER,
      (v_line->>'units_per_parcel')::INTEGER,
      v_line->>'parcel_unit_name_snapshot',
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      v_line->>'commercial_line_kind',
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name_snapshot',
      (v_line->>'allocated_discount_in_minor_units')::BIGINT,
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT
    );

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances(
          id, order_item_id, order_id, operation_id, parcel_configuration_id,
          family_product_id, instance_sequence, configuration_revision,
          units_per_parcel_snapshot, parcel_unit_name_snapshot,
          gross_amount_snapshot_in_minor_units,
          allocated_discount_snapshot_in_minor_units,
          net_refundable_amount_snapshot_in_minor_units,
          cogs_snapshot_in_minor_units, composition_fingerprint
        ) VALUES (
          (v_instance->>'instance_id')::UUID,
          (v_line->>'order_item_id')::UUID, v_order_id, v_operation_id,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'family_product_id')::UUID,
          (v_instance->>'instance_sequence')::INTEGER,
          (v_instance->>'configuration_revision')::INTEGER,
          (v_instance->>'units_per_parcel')::INTEGER,
          v_line->>'parcel_unit_name_snapshot',
          (v_instance->>'gross_amount_in_minor_units')::BIGINT,
          (v_instance->>'allocated_discount_in_minor_units')::BIGINT,
          (v_instance->>'net_refundable_amount_in_minor_units')::BIGINT,
          0, v_instance->>'composition_fingerprint'
        );
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components(
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot', 0, 0
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      INSERT INTO public.order_inventory_reservations(
        id, operation_id, order_id, order_item_id, parcel_instance_id,
        warehouse_id, product_id, reserved_quantity
      ) VALUES (
        (v_line->>'reservation_id')::UUID, v_operation_id, v_order_id,
        (v_line->>'order_item_id')::UUID, NULL, v_warehouse_id,
        (v_line->>'product_id')::UUID, (v_line->>'base_quantity')::INTEGER
      );
    ELSE
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_inventory_reservations(
            id, operation_id, order_id, order_item_id, parcel_instance_id,
            warehouse_id, product_id, reserved_quantity
          ) VALUES (
            (v_component->>'reservation_id')::UUID, v_operation_id, v_order_id,
            (v_line->>'order_item_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_warehouse_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_demand IN
    SELECT reservation.product_id, SUM(reservation.reserved_quantity)::INTEGER quantity
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = v_order_id
      AND reservation.reservation_state = 'active'
    GROUP BY reservation.product_id ORDER BY reservation.product_id
  LOOP
    UPDATE public.inventory_balances
    SET reserved_quantity = reserved_quantity + v_demand.quantity,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id AND product_id = v_demand.product_id;
  END LOOP;

  IF v_promotion_id IS NOT NULL THEN
    INSERT INTO public.promotion_redemptions(
      promotion_code_id, order_id, customer_id, customer_phone,
      code_snapshot, discount_in_minor_units
    ) VALUES (
      v_promotion_id, v_order_id, v_customer_id, v_phone,
      v_promotion_code, v_discount
    );
  END IF;
  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by, notes)
  VALUES (v_order_id, NULL, 'new', NULL, 'إنشاء طلب عميل V2 وحجز المكونات ذريًا');
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (NULL, 'CREATE_CUSTOMER_ORDER_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'commercial_lines',
      JSONB_ARRAY_LENGTH(v_final_lines), 'reserved_components', (
        SELECT COUNT(*) FROM public.order_inventory_reservations
        WHERE order_id = v_order_id
      )));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT,
  TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT,
  TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT
) TO service_role;

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
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_payment_method TEXT := LOWER(NULLIF(BTRIM(p_payment_method), ''));
  v_actor_hash TEXT;
  v_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_order public.orders%ROWTYPE;
  v_creation_operation public.business_operations%ROWTYPE;
  v_lifecycle_operation_id UUID := gen_random_uuid();
  v_delivery_fee BIGINT;
  v_total BIGINT;
  v_collected BIGINT;
  v_remaining BIGINT;
  v_shift_id UUID;
  v_shift_number TEXT;
  v_product_ids UUID[];
  v_reservation RECORD;
  v_line RECORD;
  v_instance RECORD;
  v_component RECORD;
  v_balance_before INTEGER;
  v_reserved_before INTEGER;
  v_balance_after INTEGER;
  v_line_exact_cogs NUMERIC(30,6);
  v_line_cogs BIGINT;
  v_instance_allocation JSONB;
  v_allocation_component JSONB;
  v_component_inputs JSONB;
  v_payment_result JSONB;
  v_result JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إكمال طلب عميل V2 وتسوية الحجز'
  );
  IF v_user_id IS NULL OR v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Completion identity is invalid.';
  END IF;
  IF v_payment_method = 'cash_on_delivery' THEN v_payment_method := 'cash'; END IF;
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
    'phase3_customer_completion_v1', v_key, 'erp_user', v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_ORDER_NOT_FOUND: Customer order is unavailable.';
  END IF;
  SELECT * INTO v_creation_operation FROM public.business_operations
  WHERE id = v_order.operation_id FOR SHARE;
  IF NOT FOUND OR v_creation_operation.operation_type IS DISTINCT FROM
      'phase3_customer_reservation_v1'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_CONTRACT_MISMATCH: Order is not Customer V2.';
  END IF;
  IF v_order.status NOT IN ('ready', 'out_for_delivery')
    OR v_order.cost_finalized_at IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Order cannot be completed from current state.';
  END IF;

  v_delivery_fee := COALESCE(
    p_delivery_fee_in_minor_units, v_order.delivery_fee_in_minor_units, 0
  );
  v_total := v_order.subtotal_in_minor_units - v_order.discount_in_minor_units
    + v_delivery_fee;
  v_collected := CASE WHEN v_payment_method = 'debt' THEN 0
    ELSE COALESCE(p_amount_collected_in_minor_units, v_total) END;
  IF v_total < 0 OR v_collected < 0 OR v_collected > v_total THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_SETTLEMENT_INVALID: Collected amount is invalid.';
  END IF;
  IF v_collected = 0 THEN v_payment_method := 'debt'; END IF;
  v_remaining := v_total - v_collected;
  IF v_remaining > 0 AND v_order.customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_SETTLEMENT_INVALID: Registered customer is required for debt.';
  END IF;

  SELECT id, shift_number INTO v_shift_id, v_shift_number
  FROM public.cash_shifts
  WHERE branch_id = v_order.branch_id AND status = 'open'
  ORDER BY id LIMIT 1 FOR SHARE;
  IF v_collected > 0 AND v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_OPEN_SHIFT_REQUIRED: Open Shift is required.';
  END IF;

  SELECT ARRAY_AGG(DISTINCT reservation.product_id ORDER BY reservation.product_id)
  INTO v_product_ids
  FROM public.order_inventory_reservations reservation
  WHERE reservation.order_id = p_order_id
    AND reservation.reservation_state = 'active';
  IF COALESCE(CARDINALITY(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RESERVATION_TERMINAL: No active reservation remains.';
  END IF;
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);
  PERFORM 1 FROM public.inventory_balances balance
  WHERE balance.warehouse_id = v_order.warehouse_id
    AND balance.product_id = ANY(v_product_ids)
  ORDER BY balance.product_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = p_order_id
      AND reservation.reservation_state = 'active'
      AND reservation.warehouse_id IS DISTINCT FROM v_order.warehouse_id
  ) OR EXISTS (
    SELECT 1
    FROM public.order_inventory_reservations reservation
    LEFT JOIN public.inventory_balances balance
      ON balance.warehouse_id = reservation.warehouse_id
      AND balance.product_id = reservation.product_id
    WHERE reservation.order_id = p_order_id
      AND reservation.reservation_state = 'active'
      AND (balance.product_id IS NULL
        OR balance.on_hand_quantity < reservation.reserved_quantity
        OR balance.reserved_quantity < reservation.reserved_quantity)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RESERVATION_MISMATCH: Reservation inventory is inconsistent.';
  END IF;

  PERFORM SET_CONFIG(
    'nawasrah.customer_cost_finalization_operation_id',
    v_lifecycle_operation_id::TEXT, true
  );
  INSERT INTO public.phase3_customer_cost_finalization_guards(
    transaction_id, lifecycle_operation_id, order_id, row_kind, row_id
  ) VALUES (
    pg_current_xact_id(), v_lifecycle_operation_id, p_order_id, 'order', p_order_id
  );
  INSERT INTO public.phase3_customer_cost_finalization_guards(
    transaction_id, lifecycle_operation_id, order_id, row_kind, row_id
  ) SELECT pg_current_xact_id(), v_lifecycle_operation_id, p_order_id,
      'order_item', item.id
    FROM public.order_items item WHERE item.order_id = p_order_id;
  INSERT INTO public.phase3_customer_cost_finalization_guards(
    transaction_id, lifecycle_operation_id, order_id, row_kind, row_id
  ) SELECT pg_current_xact_id(), v_lifecycle_operation_id, p_order_id,
      'parcel_instance', instance.id
    FROM public.order_parcel_instances instance WHERE instance.order_id = p_order_id;
  INSERT INTO public.phase3_customer_cost_finalization_guards(
    transaction_id, lifecycle_operation_id, order_id, row_kind, row_id
  ) SELECT pg_current_xact_id(), v_lifecycle_operation_id, p_order_id,
      'parcel_component', component.id
    FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance
      ON instance.id = component.parcel_instance_id
    WHERE instance.order_id = p_order_id;

  FOR v_line IN
    SELECT * FROM public.order_items WHERE order_id = p_order_id ORDER BY id FOR UPDATE
  LOOP
    IF v_line.commercial_line_kind = 'configurable_parcel' THEN
      v_line_exact_cogs := 0;
      v_line_cogs := 0;
      FOR v_instance IN
        SELECT * FROM public.order_parcel_instances
        WHERE order_item_id = v_line.id ORDER BY instance_sequence, id FOR UPDATE
      LOOP
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'product_id', component.product_id,
          'base_quantity', component.base_quantity,
          'unit_cost_in_minor_units_exact', product.wac_cost_in_minor_units_exact
        ) ORDER BY component.product_id)
        INTO v_component_inputs
        FROM public.order_parcel_components component
        JOIN public.products product ON product.id = component.product_id
        WHERE component.parcel_instance_id = v_instance.id;
        IF EXISTS (
          SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_component_inputs) candidate
          WHERE candidate->'unit_cost_in_minor_units_exact' = 'null'::JSONB
        ) THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE3_EXACT_WAC_UNAVAILABLE: Exact WAC is required at completion.';
        END IF;
        v_instance_allocation := public.phase3_allocate_parcel_cogs_internal(
          v_component_inputs
        );
        FOR v_component IN
          SELECT * FROM public.order_parcel_components
          WHERE parcel_instance_id = v_instance.id ORDER BY product_id FOR UPDATE
        LOOP
          SELECT value INTO v_allocation_component
          FROM JSONB_ARRAY_ELEMENTS(v_instance_allocation->'components') value
          WHERE (value->>'product_id')::UUID = v_component.product_id;
          UPDATE public.order_parcel_components SET
            unit_cost_snapshot_in_minor_units =
              (v_allocation_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
            cogs_snapshot_in_minor_units =
              (v_allocation_component->>'allocated_cogs_in_minor_units')::BIGINT,
            exact_cogs_snapshot_in_minor_units =
              (v_allocation_component->>'exact_cogs_in_minor_units')::NUMERIC(30,6),
            cost_finalized_at = v_now
          WHERE id = v_component.id;
        END LOOP;
        UPDATE public.order_parcel_instances SET
          cogs_snapshot_in_minor_units =
            (v_instance_allocation->>'total_cogs_in_minor_units')::BIGINT,
          exact_cogs_snapshot_in_minor_units = (
            SELECT SUM((candidate->>'exact_cogs_in_minor_units')::NUMERIC(30,6))
            FROM JSONB_ARRAY_ELEMENTS(v_instance_allocation->'components') candidate
          ),
          cost_finalized_at = v_now
        WHERE id = v_instance.id;
        v_line_cogs := v_line_cogs
          + (v_instance_allocation->>'total_cogs_in_minor_units')::BIGINT;
        v_line_exact_cogs := v_line_exact_cogs + (
          SELECT SUM((candidate->>'exact_cogs_in_minor_units')::NUMERIC(30,6))
          FROM JSONB_ARRAY_ELEMENTS(v_instance_allocation->'components') candidate
        );
      END LOOP;
      UPDATE public.order_items SET
        unit_cost_snapshot_in_minor_units_exact = ROUND(
          v_line_exact_cogs / NULLIF((
            SELECT SUM(reservation.reserved_quantity)
            FROM public.order_inventory_reservations reservation
            WHERE reservation.order_item_id = v_line.id
          ), 0), 6
        ),
        exact_cogs_snapshot_in_minor_units = v_line_exact_cogs,
        unit_cost_in_minor_units = ROUND(v_line_exact_cogs / NULLIF((
          SELECT SUM(reservation.reserved_quantity)
          FROM public.order_inventory_reservations reservation
          WHERE reservation.order_item_id = v_line.id
        ), 0))::BIGINT,
        cogs_in_minor_units = v_line_cogs,
        profit_in_minor_units = v_line.net_refundable_amount_snapshot_in_minor_units
          - v_line_cogs,
        cost_finalized_at = v_now
      WHERE id = v_line.id;
    ELSE
      SELECT SUM(reservation.reserved_quantity * product.wac_cost_in_minor_units_exact)
      INTO v_line_exact_cogs
      FROM public.order_inventory_reservations reservation
      JOIN public.products product ON product.id = reservation.product_id
      WHERE reservation.order_item_id = v_line.id
        AND reservation.reservation_state = 'active';
      IF v_line_exact_cogs IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_EXACT_WAC_UNAVAILABLE: Exact WAC is required at completion.';
      END IF;
      v_line_cogs := ROUND(v_line_exact_cogs, 0)::BIGINT;
      UPDATE public.order_items SET
        unit_cost_snapshot_in_minor_units_exact = ROUND(
          v_line_exact_cogs / NULLIF(quantity, 0), 6
        ),
        exact_cogs_snapshot_in_minor_units = v_line_exact_cogs,
        unit_cost_in_minor_units = ROUND(v_line_exact_cogs / NULLIF(quantity, 0))::BIGINT,
        cogs_in_minor_units = v_line_cogs,
        profit_in_minor_units = net_refundable_amount_snapshot_in_minor_units - v_line_cogs,
        cost_finalized_at = v_now
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  FOR v_reservation IN
    SELECT * FROM public.order_inventory_reservations
    WHERE order_id = p_order_id AND reservation_state = 'active'
    ORDER BY product_id, id FOR UPDATE
  LOOP
    SELECT on_hand_quantity, reserved_quantity
    INTO v_balance_before, v_reserved_before
    FROM public.inventory_balances
    WHERE warehouse_id = v_reservation.warehouse_id
      AND product_id = v_reservation.product_id
    FOR UPDATE;
    v_balance_after := v_balance_before - v_reservation.reserved_quantity;
    IF v_balance_after < 0 OR v_reserved_before < v_reservation.reserved_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_RESERVATION_MISMATCH: Reservation cannot be consumed.';
    END IF;
    UPDATE public.inventory_balances SET
      on_hand_quantity = v_balance_after,
      reserved_quantity = v_reserved_before - v_reservation.reserved_quantity,
      updated_at = v_now
    WHERE warehouse_id = v_reservation.warehouse_id
      AND product_id = v_reservation.product_id;
    UPDATE public.order_inventory_reservations SET
      reservation_state = 'consumed', resolved_at = v_now
    WHERE id = v_reservation.id;
    INSERT INTO public.inventory_movements(
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id, parcel_component_id, reservation_id
    ) VALUES (
      v_reservation.warehouse_id, v_reservation.product_id,
      'sales_deduction', -v_reservation.reserved_quantity,
      v_balance_before, v_balance_after, 'customer_order', p_order_id,
      'استهلاك حجز طلب عميل V2 رقم ' || v_order.order_number,
      v_user_id, v_reservation.operation_id,
      CASE WHEN v_reservation.parcel_instance_id IS NULL THEN NULL ELSE (
        SELECT component.id FROM public.order_parcel_components component
        WHERE component.parcel_instance_id = v_reservation.parcel_instance_id
          AND component.product_id = v_reservation.product_id
      ) END,
      v_reservation.id
    );
  END LOOP;

  PERFORM SET_CONFIG(
    'nawasrah.customer_lifecycle_operation_id',
    v_lifecycle_operation_id::TEXT, true
  );
  INSERT INTO public.phase3_customer_lifecycle_transition_guards(
    transaction_id, lifecycle_operation_id, order_id, target_status
  ) VALUES (
    pg_current_xact_id(), v_lifecycle_operation_id, p_order_id, 'completed'
  );

  UPDATE public.orders SET
    status = 'completed', delivery_fee_in_minor_units = v_delivery_fee,
    total_in_minor_units = v_total,
    payment_method = CASE WHEN v_remaining > 0 THEN 'debt'
      WHEN v_payment_method = 'cash' THEN 'cash_on_delivery' ELSE 'cliq' END,
    payment_status = CASE WHEN v_remaining = 0 THEN 'paid'
      WHEN v_collected > 0 THEN 'partially_paid' ELSE 'unpaid' END,
    amount_paid_in_minor_units = 0,
    payment_reference_number = CASE WHEN v_payment_method = 'cliq'
      THEN NULLIF(BTRIM(p_reference_number), '') ELSE NULL END,
    payment_confirmed_at = CASE WHEN v_collected > 0 THEN v_now ELSE NULL END,
    payment_confirmed_by = CASE WHEN v_collected > 0 THEN v_user_id ELSE NULL END,
    cash_shift_id = v_shift_id, cost_finalized_at = v_now, updated_at = v_now
  WHERE id = p_order_id;

  IF v_remaining > 0 AND v_collected > 0 THEN
    v_payment_result := public.record_customer_order_payment(
      p_order_id, v_collected, v_payment_method,
      NULLIF(BTRIM(p_reference_number), ''),
      COALESCE(NULLIF(BTRIM(p_notes), ''), 'دفعة مستلمة عند تسليم طلب V2')
    );
  END IF;

  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by, notes)
  VALUES (p_order_id, v_order.status, 'completed', v_user_id,
    COALESCE(NULLIF(BTRIM(p_notes), ''), 'إكمال طلب V2 واستهلاك الحجز ذريًا'));

  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotent_replay', false,
    'operation_id', v_lifecycle_operation_id, 'order_id', p_order_id,
    'order_number', v_order.order_number, 'status', 'completed',
    'payment_method', CASE WHEN v_remaining > 0 THEN 'debt' ELSE v_payment_method END,
    'payment_status', CASE WHEN v_remaining = 0 THEN 'paid'
      WHEN v_collected > 0 THEN 'partially_paid' ELSE 'unpaid' END,
    'total_in_minor_units', v_total,
    'amount_paid_in_minor_units', v_collected,
    'remaining_in_minor_units', v_remaining,
    'customer_payment_number', v_payment_result->>'payment_number',
    'cash_shift_id', v_shift_id, 'cash_shift_number', v_shift_number,
    'cost_finalized_at', v_now,
    'message', 'تم إكمال طلب V2 واستهلاك مكوناته وتجميد تكلفته مرة واحدة.'
  );

  DELETE FROM public.phase3_customer_cost_finalization_guards
  WHERE transaction_id = pg_current_xact_id()
    AND lifecycle_operation_id = v_lifecycle_operation_id;
  DELETE FROM public.phase3_customer_lifecycle_transition_guards
  WHERE transaction_id = pg_current_xact_id()
    AND lifecycle_operation_id = v_lifecycle_operation_id;
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_lifecycle_operation_id, 'phase3_customer_completion_v1', v_key,
    v_fingerprint, v_user_id, v_result, v_now, 301, v_request,
    'erp_user', v_actor_hash
  );
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'COMPLETE_CUSTOMER_ORDER_V2', 'orders', p_order_id,
    JSONB_BUILD_OBJECT('operation_id', v_lifecycle_operation_id,
      'creation_operation_id', v_order.operation_id,
      'consumed_reservations', (SELECT COUNT(*)
        FROM public.order_inventory_reservations WHERE order_id = p_order_id
          AND reservation_state = 'consumed')));
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) TO authenticated;

CREATE FUNCTION public.phase3_release_customer_reservations_internal(
  p_order_id UUID,
  p_lifecycle_operation_id UUID,
  p_operation_type TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT,
  p_request_snapshot JSONB,
  p_actor_scope_type TEXT,
  p_actor_scope_hash TEXT,
  p_initiated_by UUID,
  p_terminal_state TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_product_ids UUID[];
  v_demand RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_result JSONB;
  v_target_order_status TEXT;
  v_target_reservation_state TEXT;
BEGIN
  IF p_operation_type NOT IN (
      'phase3_customer_cancellation_v1', 'phase3_customer_expiry_v1'
    ) OR p_terminal_state NOT IN ('cancelled', 'released')
    OR (p_operation_type = 'phase3_customer_cancellation_v1'
      AND p_terminal_state <> 'cancelled')
    OR (p_operation_type = 'phase3_customer_expiry_v1'
      AND p_terminal_state <> 'released')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Release protocol is invalid.';
  END IF;
  v_target_order_status := CASE WHEN p_terminal_state = 'released'
    THEN 'expired' ELSE 'cancelled' END;
  v_target_reservation_state := p_terminal_state;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.business_operations operation
    WHERE operation.id = v_order.operation_id
      AND operation.operation_type = 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_CONTRACT_MISMATCH: Order is not Customer V2.';
  END IF;
  IF v_order.status = 'completed' OR v_order.cost_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Completed order cannot release reservations.';
  END IF;
  IF p_terminal_state = 'released' AND (
    v_order.status <> 'new' OR v_order.reservation_expires_at IS NULL
      OR v_order.reservation_expires_at > NOW()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Order is not eligible for expiry.';
  END IF;

  SELECT ARRAY_AGG(DISTINCT reservation.product_id ORDER BY reservation.product_id)
  INTO v_product_ids FROM public.order_inventory_reservations reservation
  WHERE reservation.order_id = p_order_id
    AND reservation.reservation_state = 'active';
  IF COALESCE(CARDINALITY(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RESERVATION_TERMINAL: No active reservation remains.';
  END IF;
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);
  PERFORM 1 FROM public.inventory_balances balance
  WHERE balance.warehouse_id = v_order.warehouse_id
    AND balance.product_id = ANY(v_product_ids)
  ORDER BY balance.product_id FOR UPDATE;

  FOR v_demand IN
    SELECT reservation.product_id,
      SUM(reservation.reserved_quantity)::INTEGER quantity
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = p_order_id
      AND reservation.reservation_state = 'active'
    GROUP BY reservation.product_id ORDER BY reservation.product_id
  LOOP
    UPDATE public.inventory_balances balance
    SET reserved_quantity = balance.reserved_quantity - v_demand.quantity,
      updated_at = v_now
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_demand.product_id
      AND balance.reserved_quantity >= v_demand.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_RESERVATION_MISMATCH: Reserved quantity cannot be released.';
    END IF;
  END LOOP;
  UPDATE public.order_inventory_reservations SET
    reservation_state = v_target_reservation_state, resolved_at = v_now
  WHERE order_id = p_order_id AND reservation_state = 'active';
  PERFORM SET_CONFIG(
    'nawasrah.customer_lifecycle_operation_id',
    p_lifecycle_operation_id::TEXT, true
  );
  INSERT INTO public.phase3_customer_lifecycle_transition_guards(
    transaction_id, lifecycle_operation_id, order_id, target_status
  ) VALUES (
    pg_current_xact_id(), p_lifecycle_operation_id, p_order_id,
    v_target_order_status
  );
  UPDATE public.orders SET
    status = v_target_order_status, reservation_released_at = v_now,
    expired_at = CASE WHEN v_target_order_status = 'expired' THEN v_now ELSE expired_at END,
    expired_reason = CASE WHEN v_target_order_status = 'expired'
      THEN p_reason ELSE expired_reason END,
    updated_at = v_now
  WHERE id = p_order_id;
  DELETE FROM public.phase3_customer_lifecycle_transition_guards
  WHERE transaction_id = pg_current_xact_id()
    AND lifecycle_operation_id = p_lifecycle_operation_id;

  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by, notes)
  VALUES (p_order_id, v_order.status, v_target_order_status, p_initiated_by, p_reason);
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotent_replay', false,
    'operation_id', p_lifecycle_operation_id, 'order_id', p_order_id,
    'order_number', v_order.order_number, 'status', v_target_order_status,
    'reservation_state', v_target_reservation_state,
    'released_reservations', (SELECT COUNT(*)
      FROM public.order_inventory_reservations
      WHERE order_id = p_order_id
        AND reservation_state = v_target_reservation_state),
    'message', CASE WHEN v_target_order_status = 'expired'
      THEN 'انتهت صلاحية طلب V2 وتم تحرير الحجز.'
      ELSE 'تم إلغاء طلب V2 وتحرير الحجز.' END
  );
  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    p_lifecycle_operation_id, p_operation_type, p_idempotency_key,
    p_request_fingerprint, p_initiated_by, v_result, v_now, 301,
    p_request_snapshot, p_actor_scope_type, p_actor_scope_hash
  );
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (p_initiated_by, UPPER(p_operation_type), 'orders', p_order_id,
    JSONB_BUILD_OBJECT('operation_id', p_lifecycle_operation_id,
      'creation_operation_id', v_order.operation_id,
      'reservation_state', v_target_reservation_state));
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.cancel_customer_order_v2(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_actor_hash TEXT;
  v_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_operation_id UUID := gen_random_uuid();
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'], 'إلغاء طلب عميل V2'
  );
  IF v_user_id IS NULL OR v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Cancellation identity is invalid.';
  END IF;
  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-customer-cancellation-v1',
    'actor_scope_hash', v_actor_hash, 'order_id', LOWER(p_order_id::TEXT),
    'reason', NULLIF(BTRIM(p_reason), '')
  );
  v_fingerprint := public.phase3_request_fingerprint_internal(v_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_cancellation_v1', v_key, 'erp_user',
    v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  RETURN public.phase3_release_customer_reservations_internal(
    p_order_id, v_operation_id, 'phase3_customer_cancellation_v1', v_key,
    v_fingerprint, v_request, 'erp_user', v_actor_hash, v_user_id,
    'cancelled', COALESCE(NULLIF(BTRIM(p_reason), ''), 'إلغاء طلب عميل V2')
  );
END;
$$;

CREATE FUNCTION public.phase3_expire_customer_order_v2_internal(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := 'expiry:' || LOWER(p_order_id::TEXT);
  v_actor_hash TEXT := public.phase3_actor_scope_hash_internal(
    'system_job', NULL, NULL, NULL
  );
  v_request JSONB := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-customer-expiry-v1',
    'order_id', LOWER(p_order_id::TEXT)
  );
  v_fingerprint TEXT;
  v_replay JSONB;
  v_operation_id UUID := gen_random_uuid();
  v_reason CONSTANT TEXT := 'انتهت مهلة حجز طلب الموقع (5 ساعات) قبل قبول الطلب.';
BEGIN
  v_fingerprint := public.phase3_request_fingerprint_internal(v_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_expiry_v1', v_key, 'system_job', v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  RETURN public.phase3_release_customer_reservations_internal(
    p_order_id, v_operation_id, 'phase3_customer_expiry_v1', v_key,
    v_fingerprint, v_request, 'system_job', v_actor_hash, NULL,
    'released', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.phase3_release_customer_reservations_internal(
  UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_expire_customer_order_v2_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_customer_order_v2(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_customer_order_v2(UUID, TEXT, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_stale_new_website_orders(
  p_batch_size INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_expired_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_attempted_count INTEGER := 0;
  v_candidate_limit INTEGER;
  v_scan_exhausted BOOLEAN := false;
  v_expired_order_ids UUID[] := ARRAY[]::UUID[];
  v_failed_order_ids UUID[] := ARRAY[]::UUID[];
  v_reason CONSTANT TEXT := 'انتهت مهلة حجز طلب الموقع (5 ساعات) قبل قبول الطلب.';
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'دفعة إنهاء صلاحية الطلبات يجب أن تكون بين 1 و100.';
  END IF;
  -- p_batch_size is a success target.  Candidate attempts are independently
  -- bounded so poison rows cannot consume the success quota or cause a hot loop.
  v_candidate_limit := LEAST(1000, GREATEST(p_batch_size * 10, p_batch_size + 25));
  PERFORM SET_CONFIG('lock_timeout', '3s', true);
  PERFORM SET_CONFIG('statement_timeout', '25s', true);

  FOR v_order IN
    SELECT customer_order.id, customer_order.order_number,
      customer_order.warehouse_id,
      operation.operation_type = 'phase3_customer_reservation_v1' AS is_v2
    FROM public.orders customer_order
    LEFT JOIN public.business_operations operation
      ON operation.id = customer_order.operation_id
    WHERE customer_order.source = 'website'
      AND customer_order.status = 'new'
      AND customer_order.reservation_expires_at IS NOT NULL
      AND customer_order.reservation_expires_at <= NOW()
      AND customer_order.reservation_released_at IS NULL
    ORDER BY customer_order.reservation_expires_at, customer_order.id
    LIMIT v_candidate_limit
    FOR UPDATE OF customer_order SKIP LOCKED
  LOOP
    v_attempted_count := v_attempted_count + 1;
    BEGIN
      IF v_order.is_v2 THEN
        PERFORM public.phase3_expire_customer_order_v2_internal(v_order.id);
      ELSE
        IF v_order.warehouse_id IS NULL THEN
          RAISE EXCEPTION 'الطلب (%) لا يملك مستودعًا صالحًا لتحرير الحجز.',
            v_order.order_number;
        END IF;
        FOR v_item IN
          SELECT item.product_id, SUM(item.quantity)::INTEGER quantity
          FROM public.order_items item WHERE item.order_id = v_order.id
          GROUP BY item.product_id ORDER BY item.product_id
        LOOP
          UPDATE public.inventory_balances balance
          SET reserved_quantity = balance.reserved_quantity - v_item.quantity,
            updated_at = NOW()
          WHERE balance.warehouse_id = v_order.warehouse_id
            AND balance.product_id = v_item.product_id
            AND balance.reserved_quantity >= v_item.quantity;
          IF NOT FOUND THEN
            RAISE EXCEPTION
              'تعذر تحرير حجز الطلب (%): رصيد الحجز للصنف (%) غير متطابق.',
              v_order.order_number, v_item.product_id;
          END IF;
        END LOOP;
        UPDATE public.orders SET status = 'expired', expired_at = NOW(),
          expired_reason = v_reason, reservation_released_at = NOW(),
          updated_at = NOW()
        WHERE id = v_order.id AND source = 'website' AND status = 'new'
          AND reservation_expires_at <= NOW()
          AND reservation_released_at IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION
            'تغيرت حالة الطلب (%) أثناء إنهاء الصلاحية؛ تم إلغاء العملية بأمان.',
            v_order.order_number;
        END IF;
        INSERT INTO public.order_status_history(
          order_id, old_status, new_status, changed_by, notes
        ) VALUES (v_order.id, 'new', 'expired', NULL, v_reason);
        INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
        VALUES (NULL, 'EXPIRE_STALE_NEW_WEBSITE_ORDER', 'orders', v_order.id,
          JSONB_BUILD_OBJECT('order_number', v_order.order_number,
            'source', 'website', 'reason', v_reason, 'actor', 'system'));
      END IF;
      v_expired_count := v_expired_count + 1;
      v_expired_order_ids := ARRAY_APPEND(v_expired_order_ids, v_order.id);
    EXCEPTION WHEN OTHERS THEN
      -- A poison row is isolated by this subtransaction. The scheduler can
      -- continue releasing unrelated eligible orders and reports the exact
      -- opaque IDs that require operational review.
      v_failed_count := v_failed_count + 1;
      v_failed_order_ids := ARRAY_APPEND(v_failed_order_ids, v_order.id);
      INSERT INTO public.audit_logs(
        user_id, action, entity_name, entity_id, details
      ) VALUES (
        NULL,
        'EXPIRE_STALE_WEBSITE_ORDER_FAILED',
        'orders',
        v_order.id,
        JSONB_BUILD_OBJECT(
          'order_number', v_order.order_number,
          'source', 'website',
          'actor', 'system',
          'sqlstate', SQLSTATE,
          'error', LEFT(SQLERRM, 500)
        )
      );
    END;
    EXIT WHEN v_expired_count >= p_batch_size;
  END LOOP;

  IF v_attempted_count >= v_candidate_limit
    AND v_expired_count < p_batch_size
  THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.orders customer_order
      WHERE customer_order.source = 'website'
        AND customer_order.status = 'new'
        AND customer_order.reservation_expires_at IS NOT NULL
        AND customer_order.reservation_expires_at <= NOW()
        AND customer_order.reservation_released_at IS NULL
        AND NOT (customer_order.id = ANY(v_failed_order_ids))
    ) INTO v_scan_exhausted;
  END IF;
  RETURN JSONB_BUILD_OBJECT(
    'success', v_failed_count = 0,
    'attempted_count', v_attempted_count,
    'expired_count', v_expired_count,
    'expired_order_ids', v_expired_order_ids,
    'failed_count', v_failed_count,
    'failed_order_ids', v_failed_order_ids,
    'scan_exhausted', v_scan_exhausted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_new_website_orders(INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.submit_guest_customer_order_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT,
  TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT
) IS 'Gateway-only Customer V2 coordinator. Freezes accepted commercial truth and reserves exact Base-SKU components without recognizing inventory sale or COGS.';
COMMENT ON FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) IS 'Authenticated Customer V2 completion owner. Atomically consumes exact reservations, freezes completion-time WAC/COGS, writes movements and settles the order exactly once.';
COMMENT ON FUNCTION public.cancel_customer_order_v2(UUID, TEXT, TEXT)
  IS 'Authenticated Customer V2 pre-completion cancellation. Releases exact active reservations without changing on-hand or recognizing COGS.';

ALTER TABLE public.phase3_customer_cost_finalization_guards OWNER TO postgres;
ALTER TABLE public.phase3_customer_lifecycle_transition_guards OWNER TO postgres;
ALTER FUNCTION public.populate_order_item_cost_snapshot() OWNER TO postgres;
ALTER FUNCTION public.guard_order_parcel_instance_history() OWNER TO postgres;
ALTER FUNCTION public.guard_order_parcel_component_history() OWNER TO postgres;
ALTER FUNCTION public.guard_finalized_order_parcel_item_history() OWNER TO postgres;
ALTER FUNCTION public.guard_phase3_customer_order_cost_finalization() OWNER TO postgres;
ALTER FUNCTION public.guard_phase3_customer_v2_terminal_status() OWNER TO postgres;
ALTER FUNCTION public.phase3_assert_legacy_customer_lifecycle_allowed_internal(UUID)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_actor_scope_hash_internal(TEXT, UUID, TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.phase3_customer_line_identity_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.submit_guest_customer_order_v2(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT,
  TEXT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT
) OWNER TO postgres;
ALTER FUNCTION public.complete_website_order_with_settlement_v2(
  UUID, TEXT, TEXT, BIGINT, BIGINT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.phase3_release_customer_reservations_internal(
  UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.cancel_customer_order_v2(UUID, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase3_expire_customer_order_v2_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.expire_stale_new_website_orders(INTEGER) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.populate_order_item_cost_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_parcel_instance_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_parcel_component_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_finalized_order_parcel_item_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase3_customer_order_cost_finalization()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase3_customer_v2_terminal_status()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_assert_legacy_customer_lifecycle_allowed_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_actor_scope_hash_internal(TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_customer_line_identity_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

-- Phase-3-aware monitoring keeps legacy aggregate reservations compatible,
-- reconciles configurable Parcel inventory from immutable Components, and
-- treats Customer V2 COGS as provisional until the approved completion edge.
-- Correct the Phase 5 supplier-receipt integrity check without changing
-- supplier receiving, cancellation, WAC, inventory, or accounting behavior.
-- Migration 099 incorrectly treated the immutable purchase movement retained
-- by a cancelled receipt as an unmatched completed-receipt movement.

CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, cron, pg_temp
AS $$
DECLARE
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

  WITH dues AS (
    SELECT supplier_id,sum(amount_due_in_minor_units)::BIGINT due
    FROM public.supplier_receipts WHERE status='completed' GROUP BY supplier_id
  ) SELECT count(*) INTO v_count FROM public.suppliers s LEFT JOIN dues d ON d.supplier_id=s.id
    WHERE s.current_balance_in_minor_units<>COALESCE(d.due,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:supplier-balances','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units)
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
$$;

COMMIT;
