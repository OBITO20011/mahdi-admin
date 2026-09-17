BEGIN;

-- ============================================================================
-- Nawasrah ERP - Configurable parcel additive foundation
--
-- This migration is deliberately storage/security only. It does not replace
-- any legacy package RPC and it does not create a configurable-parcel mutation
-- RPC. The server-side feature state is inserted as OFF and guarded below.
-- ============================================================================

CREATE TABLE public.configurable_parcel_feature_settings (
  feature_key TEXT PRIMARY KEY,
  feature_state TEXT NOT NULL DEFAULT 'OFF'
    CHECK (feature_state IN ('OFF', 'OWNER_PILOT', 'ENABLED')),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (feature_key = 'configurable_parcels')
);

INSERT INTO public.configurable_parcel_feature_settings (
  feature_key,
  feature_state
) VALUES (
  'configurable_parcels',
  'OFF'
)
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE public.product_parcel_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_product_id UUID NOT NULL UNIQUE
    REFERENCES public.products(id) ON DELETE RESTRICT,
  composition_mode TEXT NOT NULL
    CHECK (composition_mode IN ('single_sku', 'configurable_mix')),
  configuration_revision INTEGER NOT NULL DEFAULT 1
    CHECK (configuration_revision > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, family_product_id)
);

COMMENT ON TABLE public.product_parcel_configurations IS
  'Optional family-level parcel policy. Unit, pack-size and price truth remains on the existing family product fields.';

CREATE TABLE public.business_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type TEXT NOT NULL
    CHECK (CHAR_LENGTH(BTRIM(operation_type)) BETWEEN 1 AND 64),
  idempotency_key TEXT,
  request_fingerprint TEXT,
  initiated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    idempotency_key IS NULL
    OR CHAR_LENGTH(BTRIM(idempotency_key)) BETWEEN 1 AND 255
  ),
  CHECK (
    request_fingerprint IS NULL
    OR request_fingerprint ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE public.business_operations IS
  'Stable correlation identity for future protected business commands. operation id and idempotency key remain separate concepts.';

ALTER TABLE public.products
  ADD COLUMN wac_cost_in_minor_units_exact NUMERIC(24, 6);

ALTER TABLE public.products
  ADD CONSTRAINT products_exact_wac_nonnegative_check
  CHECK (
    wac_cost_in_minor_units_exact IS NULL
    OR wac_cost_in_minor_units_exact >= 0
  );

COMMENT ON COLUMN public.products.wac_cost_in_minor_units_exact IS
  'Reserved high-precision WAC foundation. Phase 1 does not populate or use this field.';

ALTER TABLE public.orders
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_id_operation_unique UNIQUE (id, operation_id);

ALTER TABLE public.order_items
  ADD COLUMN commercial_line_kind TEXT,
  ADD COLUMN family_product_id UUID
    REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN parcel_configuration_id UUID
    REFERENCES public.product_parcel_configurations(id) ON DELETE RESTRICT,
  ADD COLUMN parcel_configuration_revision INTEGER,
  ADD COLUMN base_unit_name_snapshot TEXT,
  ADD COLUMN allocated_discount_snapshot_in_minor_units BIGINT,
  ADD COLUMN net_refundable_amount_snapshot_in_minor_units BIGINT;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_id_order_unique UNIQUE (id, order_id),
  ADD CONSTRAINT order_items_id_product_unique UNIQUE (id, product_id),
  ADD CONSTRAINT order_items_parcel_identity_unique UNIQUE (
    id,
    parcel_configuration_id,
    family_product_id,
    parcel_configuration_revision
  ),
  ADD CONSTRAINT order_items_parcel_configuration_family_fk
    FOREIGN KEY (parcel_configuration_id, family_product_id)
    REFERENCES public.product_parcel_configurations(id, family_product_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT order_items_commercial_line_kind_check
    CHECK (
      commercial_line_kind IS NULL
      OR commercial_line_kind IN (
        'base_unit',
        'legacy_single_sku_parcel',
        'configurable_parcel'
      )
    ),
  ADD CONSTRAINT order_items_parcel_revision_check
    CHECK (
      parcel_configuration_revision IS NULL
      OR parcel_configuration_revision > 0
    ),
  ADD CONSTRAINT order_items_allocated_discount_snapshot_check
    CHECK (
      allocated_discount_snapshot_in_minor_units IS NULL
      OR allocated_discount_snapshot_in_minor_units >= 0
    ),
  ADD CONSTRAINT order_items_net_refundable_snapshot_check
    CHECK (
      net_refundable_amount_snapshot_in_minor_units IS NULL
      OR net_refundable_amount_snapshot_in_minor_units >= 0
    ),
  ADD CONSTRAINT order_items_configurable_parcel_shape_check
    CHECK (
      commercial_line_kind <> 'configurable_parcel'
      OR (
        family_product_id IS NOT NULL
        AND parcel_configuration_id IS NOT NULL
        AND parcel_configuration_revision IS NOT NULL
        AND parcel_configuration_revision > 0
        AND NULLIF(BTRIM(base_unit_name_snapshot), '') IS NOT NULL
        AND allocated_discount_snapshot_in_minor_units IS NOT NULL
        AND net_refundable_amount_snapshot_in_minor_units IS NOT NULL
      )
    );

COMMENT ON COLUMN public.order_items.commercial_line_kind IS
  'NULL identifies untouched historical rows. New versioned contracts will write an explicit commercial line kind.';

CREATE TABLE public.order_parcel_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL
    REFERENCES public.order_items(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  parcel_configuration_id UUID NOT NULL
    REFERENCES public.product_parcel_configurations(id) ON DELETE RESTRICT,
  family_product_id UUID NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  instance_sequence INTEGER NOT NULL CHECK (instance_sequence > 0),
  configuration_revision INTEGER NOT NULL CHECK (configuration_revision > 0),
  units_per_parcel_snapshot INTEGER NOT NULL
    CHECK (units_per_parcel_snapshot > 0),
  parcel_unit_name_snapshot TEXT NOT NULL
    CHECK (NULLIF(BTRIM(parcel_unit_name_snapshot), '') IS NOT NULL),
  gross_amount_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (gross_amount_snapshot_in_minor_units >= 0),
  allocated_discount_snapshot_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (allocated_discount_snapshot_in_minor_units >= 0),
  net_refundable_amount_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (net_refundable_amount_snapshot_in_minor_units >= 0),
  cogs_snapshot_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (cogs_snapshot_in_minor_units >= 0),
  composition_fingerprint TEXT NOT NULL
    CHECK (composition_fingerprint ~ '^[0-9a-f]{64}$'),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_item_id, instance_sequence),
  UNIQUE (id, order_item_id),
  UNIQUE (id, operation_id),
  UNIQUE (id, order_item_id, operation_id),
  FOREIGN KEY (order_item_id, order_id)
    REFERENCES public.order_items(id, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, operation_id)
    REFERENCES public.orders(id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    order_item_id,
    parcel_configuration_id,
    family_product_id,
    configuration_revision
  ) REFERENCES public.order_items(
    id,
    parcel_configuration_id,
    family_product_id,
    parcel_configuration_revision
  ) ON DELETE RESTRICT,
  CHECK (
    allocated_discount_snapshot_in_minor_units
      <= gross_amount_snapshot_in_minor_units
  ),
  CHECK (
    net_refundable_amount_snapshot_in_minor_units
      = gross_amount_snapshot_in_minor_units
        - allocated_discount_snapshot_in_minor_units
  )
);

CREATE TABLE public.order_parcel_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_instance_id UUID NOT NULL
    REFERENCES public.order_parcel_instances(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  base_quantity INTEGER NOT NULL CHECK (base_quantity > 0),
  product_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  base_unit_name_snapshot TEXT NOT NULL,
  unit_cost_snapshot_in_minor_units NUMERIC(24, 6) NOT NULL
    CHECK (unit_cost_snapshot_in_minor_units >= 0),
  cogs_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (cogs_snapshot_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parcel_instance_id, product_id),
  UNIQUE (id, operation_id),
  UNIQUE (id, product_id, operation_id),
  UNIQUE (parcel_instance_id, product_id, operation_id),
  FOREIGN KEY (parcel_instance_id, operation_id)
    REFERENCES public.order_parcel_instances(id, operation_id)
    ON DELETE RESTRICT
);

COMMENT ON COLUMN public.order_parcel_instances.finalized_at IS
  'One-way history boundary. NULL is a transaction-local draft; non-NULL locks the commercial line and component truth.';

CREATE TABLE public.order_inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_item_id UUID NOT NULL
    REFERENCES public.order_items(id) ON DELETE RESTRICT,
  parcel_instance_id UUID
    REFERENCES public.order_parcel_instances(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  reserved_quantity INTEGER NOT NULL CHECK (reserved_quantity > 0),
  reservation_state TEXT NOT NULL DEFAULT 'active'
    CHECK (
      reservation_state IN ('active', 'consumed', 'released', 'cancelled')
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (
    (reservation_state = 'active' AND resolved_at IS NULL)
    OR (reservation_state <> 'active' AND resolved_at IS NOT NULL)
  ),
  FOREIGN KEY (order_item_id, order_id)
    REFERENCES public.order_items(id, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, operation_id)
    REFERENCES public.orders(id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (parcel_instance_id, order_item_id)
    REFERENCES public.order_parcel_instances(id, order_item_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (parcel_instance_id, operation_id)
    REFERENCES public.order_parcel_instances(id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (parcel_instance_id, product_id, operation_id)
    REFERENCES public.order_parcel_components(
      parcel_instance_id,
      product_id,
      operation_id
    )
    ON DELETE RESTRICT
);

ALTER TABLE public.supplier_receipts
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.supplier_receipts
  ADD CONSTRAINT supplier_receipts_id_operation_unique
    UNIQUE (id, operation_id);

CREATE TABLE public.supplier_receipt_commercial_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_receipt_id UUID NOT NULL
    REFERENCES public.supplier_receipts(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  line_sequence INTEGER NOT NULL CHECK (line_sequence > 0),
  commercial_line_kind TEXT NOT NULL
    CHECK (
      commercial_line_kind IN (
        'base_unit',
        'legacy_single_sku_parcel',
        'configurable_parcel'
      )
    ),
  family_product_id UUID
    REFERENCES public.products(id) ON DELETE RESTRICT,
  parcel_configuration_id UUID
    REFERENCES public.product_parcel_configurations(id) ON DELETE RESTRICT,
  configuration_revision INTEGER,
  commercial_quantity INTEGER NOT NULL CHECK (commercial_quantity > 0),
  units_per_parcel_snapshot INTEGER,
  base_unit_name_snapshot TEXT NOT NULL,
  parcel_unit_name_snapshot TEXT,
  gross_amount_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (gross_amount_snapshot_in_minor_units >= 0),
  discount_snapshot_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (discount_snapshot_in_minor_units >= 0),
  line_total_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (line_total_snapshot_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_receipt_id, line_sequence),
  UNIQUE (id, supplier_receipt_id, operation_id),
  FOREIGN KEY (supplier_receipt_id, operation_id)
    REFERENCES public.supplier_receipts(id, operation_id) ON DELETE RESTRICT,
  FOREIGN KEY (parcel_configuration_id, family_product_id)
    REFERENCES public.product_parcel_configurations(id, family_product_id)
    ON DELETE RESTRICT,
  CHECK (discount_snapshot_in_minor_units <= gross_amount_snapshot_in_minor_units),
  CHECK (
    line_total_snapshot_in_minor_units
      = gross_amount_snapshot_in_minor_units - discount_snapshot_in_minor_units
  ),
  CHECK (
    commercial_line_kind <> 'configurable_parcel'
    OR (
      family_product_id IS NOT NULL
      AND parcel_configuration_id IS NOT NULL
      AND configuration_revision IS NOT NULL
      AND configuration_revision > 0
      AND units_per_parcel_snapshot IS NOT NULL
      AND units_per_parcel_snapshot > 0
      AND NULLIF(BTRIM(parcel_unit_name_snapshot), '') IS NOT NULL
    )
  )
);

ALTER TABLE public.supplier_receipt_items
  ADD COLUMN commercial_line_id UUID
    REFERENCES public.supplier_receipt_commercial_lines(id) ON DELETE RESTRICT,
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  ADD COLUMN allocated_cost_in_minor_units BIGINT,
  ADD COLUMN exact_unit_cost_in_minor_units NUMERIC(24, 6),
  ADD CONSTRAINT supplier_receipt_items_commercial_chain_fk
    FOREIGN KEY (
      commercial_line_id,
      supplier_receipt_id,
      operation_id
    ) REFERENCES public.supplier_receipt_commercial_lines(
      id,
      supplier_receipt_id,
      operation_id
    ) ON DELETE RESTRICT;

ALTER TABLE public.supplier_receipt_items
  ADD CONSTRAINT supplier_receipt_items_allocated_cost_check
    CHECK (
      allocated_cost_in_minor_units IS NULL
      OR allocated_cost_in_minor_units >= 0
    ),
  ADD CONSTRAINT supplier_receipt_items_exact_unit_cost_check
    CHECK (
      exact_unit_cost_in_minor_units IS NULL
      OR exact_unit_cost_in_minor_units >= 0
    ),
  ADD CONSTRAINT supplier_receipt_items_commercial_shape_check
    CHECK (
      (commercial_line_id IS NULL AND operation_id IS NULL)
      OR (commercial_line_id IS NOT NULL AND operation_id IS NOT NULL)
    );

ALTER TABLE public.purchase_orders
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_order_items
  ADD COLUMN commercial_line_kind TEXT,
  ADD COLUMN family_product_id UUID
    REFERENCES public.products(id) ON DELETE RESTRICT,
  ADD COLUMN parcel_configuration_id UUID
    REFERENCES public.product_parcel_configurations(id) ON DELETE RESTRICT,
  ADD COLUMN configuration_revision INTEGER,
  ADD COLUMN base_unit_name_snapshot TEXT,
  ADD COLUMN parcel_unit_name_snapshot TEXT,
  ADD COLUMN parcel_quantity INTEGER;

ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT purchase_order_items_parcel_configuration_family_fk
    FOREIGN KEY (parcel_configuration_id, family_product_id)
    REFERENCES public.product_parcel_configurations(id, family_product_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT purchase_order_items_commercial_line_kind_check
    CHECK (
      commercial_line_kind IS NULL
      OR commercial_line_kind IN (
        'base_unit',
        'legacy_single_sku_parcel',
        'configurable_parcel'
      )
    ),
  ADD CONSTRAINT purchase_order_items_configuration_revision_check
    CHECK (configuration_revision IS NULL OR configuration_revision > 0),
  ADD CONSTRAINT purchase_order_items_parcel_quantity_check
    CHECK (parcel_quantity IS NULL OR parcel_quantity > 0),
  ADD CONSTRAINT purchase_order_items_configurable_shape_check
    CHECK (
      commercial_line_kind <> 'configurable_parcel'
      OR (
        family_product_id IS NOT NULL
        AND parcel_configuration_id IS NOT NULL
        AND configuration_revision IS NOT NULL
        AND configuration_revision > 0
        AND parcel_quantity IS NOT NULL
        AND parcel_quantity > 0
        AND NULLIF(BTRIM(base_unit_name_snapshot), '') IS NOT NULL
        AND NULLIF(BTRIM(parcel_unit_name_snapshot), '') IS NOT NULL
      )
    );

ALTER TABLE public.purchase_receipts
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.purchase_receipts
  ADD CONSTRAINT purchase_receipts_id_operation_unique
    UNIQUE (id, operation_id);

ALTER TABLE public.purchase_receipt_items
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  ADD COLUMN allocated_cost_in_minor_units BIGINT,
  ADD COLUMN exact_unit_cost_in_minor_units NUMERIC(24, 6),
  ADD CONSTRAINT purchase_receipt_items_operation_chain_fk
    FOREIGN KEY (purchase_receipt_id, operation_id)
    REFERENCES public.purchase_receipts(id, operation_id)
    ON DELETE RESTRICT;

ALTER TABLE public.purchase_receipt_items
  ADD CONSTRAINT purchase_receipt_items_allocated_cost_check
    CHECK (
      allocated_cost_in_minor_units IS NULL
      OR allocated_cost_in_minor_units >= 0
    ),
  ADD CONSTRAINT purchase_receipt_items_exact_unit_cost_check
    CHECK (
      exact_unit_cost_in_minor_units IS NULL
      OR exact_unit_cost_in_minor_units >= 0
    );

CREATE TABLE public.sales_return_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL UNIQUE,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  cash_shift_id UUID NOT NULL
    REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (NULLIF(BTRIM(reason), '') IS NOT NULL),
  refund_method TEXT NOT NULL CHECK (refund_method IN ('cash', 'cliq')),
  merchandise_refund_amount_in_minor_units BIGINT NOT NULL
    CHECK (merchandise_refund_amount_in_minor_units >= 0),
  reference_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, order_id, operation_id),
  CHECK (
    refund_method <> 'cliq'
    OR NULLIF(BTRIM(reference_number), '') IS NOT NULL
  )
);

COMMENT ON COLUMN public.sales_return_events.merchandise_refund_amount_in_minor_units IS
  'Merchandise-only refund. Delivery and tax allocation are outside this model.';

CREATE TABLE public.sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_event_id UUID NOT NULL
    REFERENCES public.sales_return_events(id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_item_id UUID NOT NULL
    REFERENCES public.order_items(id) ON DELETE RESTRICT,
  return_scope TEXT NOT NULL
    CHECK (return_scope IN ('base_unit', 'parcel_instance')),
  parcel_instance_id UUID
    REFERENCES public.order_parcel_instances(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  returned_quantity INTEGER NOT NULL CHECK (returned_quantity > 0),
  refund_amount_snapshot_in_minor_units BIGINT NOT NULL
    CHECK (refund_amount_snapshot_in_minor_units >= 0),
  stock_disposition TEXT NOT NULL
    CHECK (stock_disposition IN ('restock', 'damaged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (sales_return_event_id, order_id, operation_id)
    REFERENCES public.sales_return_events(id, order_id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id, order_id)
    REFERENCES public.order_items(id, order_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_item_id, product_id)
    REFERENCES public.order_items(id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (parcel_instance_id, order_item_id)
    REFERENCES public.order_parcel_instances(id, order_item_id)
    ON DELETE RESTRICT,
  CHECK (
    (
      return_scope = 'base_unit'
      AND parcel_instance_id IS NULL
      AND product_id IS NOT NULL
    )
    OR (
      return_scope = 'parcel_instance'
      AND parcel_instance_id IS NOT NULL
      AND product_id IS NULL
      AND returned_quantity = 1
    )
  )
);

ALTER TABLE public.sales_returns
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory_movements
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  ADD COLUMN parcel_component_id UUID
    REFERENCES public.order_parcel_components(id) ON DELETE RESTRICT,
  ADD COLUMN reservation_id UUID
    REFERENCES public.order_inventory_reservations(id) ON DELETE RESTRICT;

ALTER TABLE public.order_inventory_reservations
  ADD CONSTRAINT order_inventory_reservations_id_operation_unique
    UNIQUE (id, operation_id),
  ADD CONSTRAINT order_inventory_reservations_id_product_operation_unique
    UNIQUE (id, product_id, operation_id);

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_component_operation_fk
    FOREIGN KEY (parcel_component_id, product_id, operation_id)
    REFERENCES public.order_parcel_components(id, product_id, operation_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movements_reservation_operation_fk
    FOREIGN KEY (reservation_id, product_id, operation_id)
    REFERENCES public.order_inventory_reservations(id, product_id, operation_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movements_parcel_identity_shape_check
    CHECK (
      (parcel_component_id IS NULL AND reservation_id IS NULL)
      OR operation_id IS NOT NULL
    );

-- --------------------------------------------------------------------------
-- Server-enforced rollout state. Missing/malformed state is fail-closed.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.get_configurable_parcel_feature_state()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COUNT(*) = 1
      AND MAX(feature_state) IN ('OFF', 'OWNER_PILOT', 'ENABLED')
      THEN MAX(feature_state)
    ELSE 'OFF'
  END
  FROM public.configurable_parcel_feature_settings
  WHERE feature_key = 'configurable_parcels';
$$;

CREATE FUNCTION public.assert_configurable_parcel_creation_allowed()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_feature_state TEXT := public.get_configurable_parcel_feature_state();
BEGIN
  IF v_feature_state = 'ENABLED' THEN
    RETURN;
  END IF;

  IF v_feature_state = 'OWNER_PILOT'
    AND auth.uid() IS NOT NULL
    AND public.has_erp_role(ARRAY['owner'])
  THEN
    RETURN;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'CONFIGURABLE_PARCEL_DISABLED: الوظيفة غير مفعلة لإنشاء عمليات جديدة.';
END;
$$;

CREATE FUNCTION public.guard_new_configurable_parcel_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_kind TEXT;
  v_old_kind TEXT;
BEGIN
  IF TG_TABLE_NAME = 'order_parcel_instances' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.assert_configurable_parcel_creation_allowed();
    END IF;
    RETURN NEW;
  END IF;

  v_new_kind := TO_JSONB(NEW)->>'commercial_line_kind';
  IF TG_OP = 'UPDATE' THEN
    v_old_kind := TO_JSONB(OLD)->>'commercial_line_kind';
  END IF;

  IF v_new_kind = 'configurable_parcel'
    AND (TG_OP = 'INSERT' OR v_old_kind IS DISTINCT FROM v_new_kind)
  THEN
    PERFORM public.assert_configurable_parcel_creation_allowed();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_order_item_configurable_parcel
BEFORE INSERT OR UPDATE OF commercial_line_kind ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_new_configurable_parcel_row();

CREATE TRIGGER trg_guard_order_parcel_instance
BEFORE INSERT ON public.order_parcel_instances
FOR EACH ROW EXECUTE FUNCTION public.guard_new_configurable_parcel_row();

CREATE TRIGGER trg_guard_supplier_receipt_configurable_parcel
BEFORE INSERT OR UPDATE OF commercial_line_kind
ON public.supplier_receipt_commercial_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_new_configurable_parcel_row();

CREATE TRIGGER trg_guard_purchase_order_configurable_parcel
BEFORE INSERT OR UPDATE OF commercial_line_kind ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_new_configurable_parcel_row();

-- --------------------------------------------------------------------------
-- Historical truth boundary.
--
-- A parcel may be temporarily unfinished only inside the transaction that
-- creates it. Commit-time validation below rejects every persistent draft.
-- The internal finalizer is the one-way boundary; the original commercial
-- row, parcel identity and components then become immutable. Returns and
-- reversals append their own rows.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.guard_order_parcel_instance_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FINALIZED_PARCEL_IMMUTABLE: لا يمكن تعديل حقيقة طرد مكتمل.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF ROW(
    NEW.order_item_id,
    NEW.order_id,
    NEW.operation_id,
    NEW.parcel_configuration_id,
    NEW.family_product_id,
    NEW.instance_sequence,
    NEW.configuration_revision,
    NEW.units_per_parcel_snapshot,
    NEW.parcel_unit_name_snapshot,
    NEW.gross_amount_snapshot_in_minor_units,
    NEW.allocated_discount_snapshot_in_minor_units,
    NEW.net_refundable_amount_snapshot_in_minor_units,
    NEW.cogs_snapshot_in_minor_units,
    NEW.composition_fingerprint,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.order_item_id,
    OLD.order_id,
    OLD.operation_id,
    OLD.parcel_configuration_id,
    OLD.family_product_id,
    OLD.instance_sequence,
    OLD.configuration_revision,
    OLD.units_per_parcel_snapshot,
    OLD.parcel_unit_name_snapshot,
    OLD.gross_amount_snapshot_in_minor_units,
    OLD.allocated_discount_snapshot_in_minor_units,
    OLD.net_refundable_amount_snapshot_in_minor_units,
    OLD.cogs_snapshot_in_minor_units,
    OLD.composition_fingerprint,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_IDENTITY_IMMUTABLE: لا يمكن إعادة ربط أو تعديل حقيقة الطرد بعد إنشائه.';
  END IF;

  IF OLD.finalized_at IS NULL AND NEW.finalized_at IS NOT NULL THEN
    IF CURRENT_SETTING('nawasrah.parcel_finalization_id', true)
      IS DISTINCT FROM OLD.id::TEXT
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PARCEL_FINALIZATION_REQUIRES_INTERNAL_PROTOCOL: استخدم مسار الإكمال الذري المحمي.';
    END IF;

    IF NEW.finalized_at > NOW() THEN
      RAISE EXCEPTION 'Parcel finalization timestamp cannot be in the future.';
    END IF;
  ELSIF NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_FINALIZATION_INVALID_TRANSITION: حد الإكمال أحادي الاتجاه.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_order_parcel_instance_history
BEFORE UPDATE OR DELETE ON public.order_parcel_instances
FOR EACH ROW EXECUTE FUNCTION public.guard_order_parcel_instance_history();

CREATE FUNCTION public.guard_order_parcel_component_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_instance_id UUID;
  v_new_instance_id UUID;
  v_finalized_instance UUID;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_instance_id := OLD.parcel_instance_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_instance_id := NEW.parcel_instance_id;
  END IF;

  -- Lock every affected parent in stable UUID order. This serializes draft
  -- composition mutation against concurrent finalization without deadlocks.
  PERFORM 1
  FROM public.order_parcel_instances instance
  WHERE instance.id = ANY (
    ARRAY_REMOVE(ARRAY[v_old_instance_id, v_new_instance_id], NULL)
  )
  ORDER BY instance.id
  FOR UPDATE;

  SELECT instance.id
  INTO v_finalized_instance
  FROM public.order_parcel_instances instance
  WHERE instance.id = ANY (
    ARRAY_REMOVE(ARRAY[v_old_instance_id, v_new_instance_id], NULL)
  )
    AND instance.finalized_at IS NOT NULL
  LIMIT 1;

  IF v_finalized_instance IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FINALIZED_PARCEL_COMPONENT_IMMUTABLE: لا يمكن تعديل مكونات طرد مكتمل.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_order_parcel_component_history
BEFORE INSERT OR UPDATE OR DELETE ON public.order_parcel_components
FOR EACH ROW EXECUTE FUNCTION public.guard_order_parcel_component_history();

CREATE FUNCTION public.guard_finalized_order_parcel_item_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- The order-item row is already locked by the UPDATE/DELETE statement.
  -- Lock child instances next, always in UUID order. The internal finalizer
  -- follows the same Order Item -> Parcel Instance hierarchy.
  PERFORM 1
  FROM public.order_parcel_instances instance
  WHERE instance.order_item_id = OLD.id
  ORDER BY instance.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.order_parcel_instances instance
    WHERE instance.order_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_LINE_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد بدء إنشاء طرد مرتبط به.';
  END IF;

  -- Reservations use the same Order Item first lock hierarchy. Lock them in
  -- stable order before deciding whether the original Base Unit identity may
  -- change, so a concurrent insert cannot race this history boundary.
  PERFORM 1
  FROM public.order_inventory_reservations reservation
  WHERE reservation.order_item_id = OLD.id
  ORDER BY reservation.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RESERVED_ORDER_ITEM_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد إنشاء حجز مرتبط به.';
  END IF;

  -- Return construction also starts by locking the original Order Item. Lock
  -- linked Return Items last so every path follows the same parent-first order:
  -- Order Item -> Parcel Instance -> Reservation -> Return Item.
  PERFORM 1
  FROM public.sales_return_items return_item
  WHERE return_item.order_item_id = OLD.id
  ORDER BY return_item.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.sales_return_items return_item
    WHERE return_item.order_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RETURNED_ORDER_ITEM_IMMUTABLE: لا يمكن تعديل السطر التجاري بعد إنشاء إرجاع مرتبط به.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_finalized_order_parcel_item_history
BEFORE UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_finalized_order_parcel_item_history();

CREATE FUNCTION public.guard_immutable_parcel_foundation_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'IMMUTABLE_BUSINESS_HISTORY: لا يمكن تعديل أو حذف هذا السجل التاريخي.';
END;
$$;

CREATE TRIGGER trg_guard_business_operation_history
BEFORE UPDATE OR DELETE ON public.business_operations
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();

CREATE TRIGGER trg_guard_supplier_receipt_commercial_line_history
BEFORE UPDATE OR DELETE ON public.supplier_receipt_commercial_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();

CREATE TRIGGER trg_guard_sales_return_event_history
BEFORE UPDATE OR DELETE ON public.sales_return_events
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();

CREATE TRIGGER trg_guard_sales_return_item_history
BEFORE UPDATE OR DELETE ON public.sales_return_items
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();

CREATE FUNCTION public.guard_order_inventory_reservation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RESERVATION_HISTORY_IMMUTABLE: لا يمكن حذف سجل الحجز التاريخي.';
  END IF;

  IF ROW(
    NEW.operation_id,
    NEW.order_id,
    NEW.order_item_id,
    NEW.parcel_instance_id,
    NEW.warehouse_id,
    NEW.product_id,
    NEW.reserved_quantity,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.operation_id,
    OLD.order_id,
    OLD.order_item_id,
    OLD.parcel_instance_id,
    OLD.warehouse_id,
    OLD.product_id,
    OLD.reserved_quantity,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RESERVATION_IDENTITY_IMMUTABLE: لا يمكن تعديل هوية أو كمية الحجز الأصلية.';
  END IF;

  IF OLD.reservation_state <> 'active'
    AND ROW(NEW.reservation_state, NEW.resolved_at)
      IS DISTINCT FROM ROW(OLD.reservation_state, OLD.resolved_at)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'RESERVATION_TERMINAL_STATE_IMMUTABLE: لا يمكن إعادة فتح حجز منتهٍ.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_order_inventory_reservation_history
BEFORE UPDATE OR DELETE ON public.order_inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_order_inventory_reservation_history();

CREATE FUNCTION public.validate_order_inventory_reservation_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_kind TEXT;
  v_order_item_product_id UUID;
BEGIN
  SELECT item.commercial_line_kind, item.product_id
  INTO v_line_kind, v_order_item_product_id
  FROM public.order_items item
  WHERE item.id = NEW.order_item_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'order_inventory_reservations_order_item_id_fkey',
      MESSAGE = 'Reservation Order Item does not exist.';
  END IF;

  IF v_line_kind = 'configurable_parcel' THEN
    IF NEW.parcel_instance_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_inventory_reservations_parcel_required_check',
        MESSAGE = 'A configurable Parcel reservation requires its exact Parcel Instance.';
    END IF;
  ELSE
    IF NEW.parcel_instance_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_inventory_reservations_base_parcel_absent_check',
        MESSAGE = 'A Base Unit reservation cannot claim a Parcel Instance.';
    END IF;

    -- NULL commercial_line_kind is an untouched legacy Order Item. A new
    -- reservation is accepted only when its historical product identity is
    -- still provable; the historical parent row itself remains unchanged.
    IF v_order_item_product_id IS NULL
      OR NEW.product_id IS DISTINCT FROM v_order_item_product_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_inventory_reservations_base_product_check',
        MESSAGE = 'Base Unit reservation product must match its original Order Item product.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_order_inventory_reservation_chain
BEFORE INSERT ON public.order_inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.validate_order_inventory_reservation_chain();

CREATE FUNCTION public.validate_inventory_movement_source_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_component_parcel_instance_id UUID;
  v_component_order_item_id UUID;
  v_component_order_id UUID;
  v_reservation_parcel_instance_id UUID;
  v_reservation_order_item_id UUID;
  v_reservation_order_id UUID;
  v_reservation_warehouse_id UUID;
BEGIN
  IF NEW.reservation_id IS NOT NULL THEN
    SELECT
      reservation.parcel_instance_id,
      reservation.order_item_id,
      reservation.order_id,
      reservation.warehouse_id
    INTO
      v_reservation_parcel_instance_id,
      v_reservation_order_item_id,
      v_reservation_order_id,
      v_reservation_warehouse_id
    FROM public.order_inventory_reservations reservation
    WHERE reservation.id = NEW.reservation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        CONSTRAINT = 'inventory_movements_reservation_id_fkey',
        MESSAGE = 'Inventory Movement reservation does not exist.';
    END IF;

    IF NEW.warehouse_id IS DISTINCT FROM v_reservation_warehouse_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'inventory_movements_reservation_warehouse_check',
        MESSAGE = 'Inventory Movement warehouse must match its Reservation warehouse.';
    END IF;
  END IF;

  IF NEW.parcel_component_id IS NOT NULL THEN
    SELECT
      component.parcel_instance_id,
      instance.order_item_id,
      instance.order_id
    INTO
      v_component_parcel_instance_id,
      v_component_order_item_id,
      v_component_order_id
    FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance
      ON instance.id = component.parcel_instance_id
    WHERE component.id = NEW.parcel_component_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        CONSTRAINT = 'inventory_movements_parcel_component_id_fkey',
        MESSAGE = 'Inventory Movement Parcel Component does not exist.';
    END IF;
  END IF;

  IF NEW.parcel_component_id IS NOT NULL
    AND NEW.reservation_id IS NOT NULL
    AND (
      v_reservation_parcel_instance_id IS NULL
      OR v_component_parcel_instance_id
        IS DISTINCT FROM v_reservation_parcel_instance_id
      OR v_component_order_item_id IS DISTINCT FROM v_reservation_order_item_id
      OR v_component_order_id IS DISTINCT FROM v_reservation_order_id
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'inventory_movements_source_chain_check',
      MESSAGE = 'Inventory Movement Component and Reservation must share one commercial Parcel chain.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_inventory_movement_source_chain
BEFORE INSERT OR UPDATE OF
  warehouse_id, product_id, operation_id, parcel_component_id, reservation_id
ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_movement_source_chain();

CREATE FUNCTION public.validate_sales_return_item_line_kind()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_kind TEXT;
  v_order_item_product_id UUID;
  v_original_parcel_id UUID;
BEGIN
  -- Return writes and Order Item mutations share the same parent-first lock.
  SELECT item.commercial_line_kind, item.product_id
  INTO v_line_kind, v_order_item_product_id
  FROM public.order_items item
  WHERE item.id = NEW.order_item_id
    AND item.order_id = NEW.order_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'sales_return_items_order_item_id_order_id_fkey',
      MESSAGE = 'Return Item Order Item does not belong to the original Order.';
  END IF;

  IF v_line_kind = 'base_unit' THEN
    IF NEW.return_scope IS DISTINCT FROM 'base_unit'
      OR NEW.parcel_instance_id IS NOT NULL
      OR NEW.product_id IS NULL
      OR NEW.product_id IS DISTINCT FROM v_order_item_product_id
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_return_items_base_line_kind_check',
        MESSAGE = 'A Base Unit line permits only a matching Base Unit return.';
    END IF;
  ELSIF v_line_kind = 'configurable_parcel' THEN
    IF NEW.return_scope IS DISTINCT FROM 'parcel_instance'
      OR NEW.parcel_instance_id IS NULL
      OR NEW.product_id IS NOT NULL
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_return_items_parcel_line_kind_check',
        MESSAGE = 'A configurable Parcel line permits only a whole Parcel Instance return.';
    END IF;

    SELECT instance.id
    INTO v_original_parcel_id
    FROM public.order_parcel_instances instance
    WHERE instance.id = NEW.parcel_instance_id
      AND instance.order_item_id = NEW.order_item_id
      AND instance.order_id = NEW.order_id
    FOR SHARE;

    IF v_original_parcel_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'sales_return_items_original_parcel_check',
        MESSAGE = 'Parcel return must reference an exact original Parcel Instance from the commercial line.';
    END IF;
  ELSE
    -- NULL historical rows and legacy_single_sku_parcel stay on their existing
    -- legacy paths. The new Phase-1 Return table never guesses their mode.
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_return_items_supported_line_kind_check',
      MESSAGE = 'New Return Item mode cannot be proven for this legacy commercial line.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sales_return_item_line_kind
BEFORE INSERT ON public.sales_return_items
FOR EACH ROW EXECUTE FUNCTION public.validate_sales_return_item_line_kind();

-- --------------------------------------------------------------------------
-- Family/configuration and immutable composition integrity.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.validate_product_parcel_configuration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_family public.products%ROWTYPE;
BEGIN
  SELECT * INTO v_family
  FROM public.products
  WHERE id = NEW.family_product_id;

  IF NOT FOUND OR v_family.flavor_master_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'Parcel configuration must reference a family root product.';
  END IF;

  IF NEW.composition_mode = 'configurable_mix'
    AND NOT v_family.is_flavor_master
  THEN
    RAISE EXCEPTION 'Configurable mixed parcels require a flavor family master.';
  END IF;

  IF v_family.sale_unit_id IS NULL
    OR COALESCE(v_family.units_per_sale_unit, 0) <= 0
  THEN
    RAISE EXCEPTION 'Parcel family requires a valid configured sale unit and pack size.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_parcel_configuration
BEFORE INSERT OR UPDATE ON public.product_parcel_configurations
FOR EACH ROW EXECUTE FUNCTION public.validate_product_parcel_configuration();

CREATE FUNCTION public.validate_order_parcel_instance_family()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_line_kind TEXT;
BEGIN
  -- New Parcel construction starts the global lock hierarchy by locking its
  -- commercial Order Item before the Parcel Instance row exists.
  SELECT item.commercial_line_kind
  INTO v_line_kind
  FROM public.order_items item
  WHERE item.id = NEW.order_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_line_kind IS DISTINCT FROM 'configurable_parcel' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'order_parcel_instances_order_item_kind_check',
      MESSAGE = 'A Parcel Instance requires an explicit configurable Parcel Order Item.';
  END IF;

  SELECT * INTO v_configuration
  FROM public.product_parcel_configurations
  WHERE id = NEW.parcel_configuration_id
  FOR SHARE;

  IF NOT FOUND
    OR v_configuration.family_product_id IS DISTINCT FROM NEW.family_product_id
    OR v_configuration.configuration_revision IS DISTINCT FROM NEW.configuration_revision
  THEN
    RAISE EXCEPTION 'Parcel instance configuration/family snapshot is inconsistent.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_order_parcel_instance_family
BEFORE INSERT OR UPDATE OF order_item_id, parcel_configuration_id, family_product_id,
  configuration_revision ON public.order_parcel_instances
FOR EACH ROW EXECUTE FUNCTION public.validate_order_parcel_instance_family();

CREATE FUNCTION public.validate_order_parcel_component_family()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_family UUID;
  v_actual_family UUID;
  v_is_master BOOLEAN;
BEGIN
  SELECT family_product_id
  INTO v_expected_family
  FROM public.order_parcel_instances
  WHERE id = NEW.parcel_instance_id;

  SELECT COALESCE(flavor_master_product_id, id), is_flavor_master
  INTO v_actual_family, v_is_master
  FROM public.products
  WHERE id = NEW.product_id;

  IF v_expected_family IS NULL
    OR v_actual_family IS NULL
    OR v_is_master
    OR v_actual_family IS DISTINCT FROM v_expected_family
  THEN
    RAISE EXCEPTION 'Parcel component must be a stocked SKU from the configured family.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_order_parcel_component_family
BEFORE INSERT OR UPDATE ON public.order_parcel_components
FOR EACH ROW EXECUTE FUNCTION public.validate_order_parcel_component_family();

CREATE FUNCTION public.validate_supplier_receipt_item_commercial_family()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_kind TEXT;
  v_expected_family UUID;
  v_actual_family UUID;
  v_is_master BOOLEAN;
BEGIN
  IF NEW.commercial_line_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT line.commercial_line_kind, line.family_product_id
  INTO v_line_kind, v_expected_family
  FROM public.supplier_receipt_commercial_lines line
  WHERE line.id = NEW.commercial_line_id;

  IF v_line_kind = 'configurable_parcel' THEN
    SELECT COALESCE(product.flavor_master_product_id, product.id),
      product.is_flavor_master
    INTO v_actual_family, v_is_master
    FROM public.products product
    WHERE product.id = NEW.product_id;

    IF v_actual_family IS NULL
      OR v_is_master
      OR v_actual_family IS DISTINCT FROM v_expected_family
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'supplier_receipt_item_commercial_family_check',
        MESSAGE = 'Supplier receipt component must belong to its commercial Family.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_supplier_receipt_item_commercial_family
BEFORE INSERT OR UPDATE OF commercial_line_id, product_id
ON public.supplier_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.validate_supplier_receipt_item_commercial_family();

CREATE FUNCTION public.finalize_order_parcel_instance_internal(
  p_parcel_instance_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_item_id UUID;
  v_locked_order_item_id UUID;
  v_line_kind TEXT;
  v_family_product_id UUID;
  v_configuration_id UUID;
  v_configuration_revision INTEGER;
  v_expected INTEGER;
  v_actual BIGINT;
  v_invalid_components BIGINT;
  v_finalized_at TIMESTAMPTZ;
BEGIN
  SELECT instance.order_item_id
  INTO v_order_item_id
  FROM public.order_parcel_instances instance
  WHERE instance.id = p_parcel_instance_id;

  IF v_order_item_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'PARCEL_INSTANCE_NOT_FOUND: تعذر العثور على الطرد المطلوب.';
  END IF;

  -- Global hierarchy: Order Item -> Parcel Instance -> configuration/products.
  SELECT item.commercial_line_kind
  INTO v_line_kind
  FROM public.order_items item
  WHERE item.id = v_order_item_id
  FOR UPDATE;

  IF NOT FOUND OR v_line_kind IS DISTINCT FROM 'configurable_parcel' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'order_parcel_instances_order_item_kind_check',
      MESSAGE = 'Parcel finalization requires an explicit configurable Parcel Order Item.';
  END IF;

  SELECT
    instance.order_item_id,
    instance.family_product_id,
    instance.parcel_configuration_id,
    instance.configuration_revision,
    instance.units_per_parcel_snapshot,
    instance.finalized_at
  INTO
    v_locked_order_item_id,
    v_family_product_id,
    v_configuration_id,
    v_configuration_revision,
    v_expected,
    v_finalized_at
  FROM public.order_parcel_instances instance
  WHERE instance.id = p_parcel_instance_id
  FOR UPDATE;

  IF v_locked_order_item_id IS DISTINCT FROM v_order_item_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'PARCEL_ORDER_ITEM_CHANGED_DURING_FINALIZATION: أعد المحاولة من معاملة جديدة.';
  END IF;

  IF v_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_ALREADY_FINALIZED: الطرد مكتمل مسبقًا.';
  END IF;

  PERFORM 1
  FROM public.product_parcel_configurations configuration
  WHERE configuration.id = v_configuration_id
    AND configuration.family_product_id = v_family_product_id
    AND configuration.configuration_revision = v_configuration_revision
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'order_parcel_instance_configuration_snapshot_check',
      MESSAGE = 'Parcel configuration/family/revision is not valid at finalization.';
  END IF;

  -- Stable product ordering prevents two mixed Parcels from taking product
  -- locks in opposite orders. FOR SHARE freezes family membership until commit.
  PERFORM 1
  FROM public.products product
  WHERE product.id = v_family_product_id
    OR product.id IN (
      SELECT component.product_id
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = p_parcel_instance_id
    )
  ORDER BY product.id
  FOR SHARE;

  SELECT
    COALESCE(SUM(component.base_quantity), 0),
    COUNT(*) FILTER (
      WHERE product.id IS NULL
        OR product.is_flavor_master
        OR COALESCE(product.flavor_master_product_id, product.id)
          IS DISTINCT FROM v_family_product_id
    )
  INTO v_actual, v_invalid_components
  FROM public.order_parcel_components component
  LEFT JOIN public.products product ON product.id = component.product_id
  WHERE component.parcel_instance_id = p_parcel_instance_id;

  IF v_actual IS DISTINCT FROM v_expected::BIGINT THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'order_parcel_composition_total_check',
      MESSAGE = FORMAT(
        'Parcel composition total (%s) must equal its pack-size snapshot (%s).',
        v_actual,
        v_expected
      );
  END IF;

  IF v_invalid_components <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'order_parcel_component_family_check',
      MESSAGE = 'Every Parcel component must belong to its immutable Family snapshot.';
  END IF;

  PERFORM SET_CONFIG(
    'nawasrah.parcel_finalization_id',
    p_parcel_instance_id::TEXT,
    true
  );

  UPDATE public.order_parcel_instances
  SET finalized_at = NOW()
  WHERE id = p_parcel_instance_id;
END;
$$;

CREATE FUNCTION public.assert_order_parcel_composition_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instance_id UUID;
  v_instance_ids UUID[];
  v_expected INTEGER;
  v_actual BIGINT;
  v_finalized_at TIMESTAMPTZ;
  v_family_product_id UUID;
  v_invalid_components BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'order_parcel_instances' THEN
    v_instance_ids := ARRAY[NEW.id]::UUID[];
  ELSIF TG_OP = 'INSERT' THEN
    v_instance_ids := ARRAY[NEW.parcel_instance_id]::UUID[];
  ELSIF TG_OP = 'DELETE' THEN
    v_instance_ids := ARRAY[OLD.parcel_instance_id]::UUID[];
  ELSE
    v_instance_ids := ARRAY[
      OLD.parcel_instance_id,
      NEW.parcel_instance_id
    ]::UUID[];
  END IF;

  FOR v_instance_id IN
    SELECT DISTINCT affected.id
    FROM UNNEST(v_instance_ids) AS affected(id)
    WHERE affected.id IS NOT NULL
  LOOP
    SELECT units_per_parcel_snapshot, finalized_at, family_product_id
    INTO v_expected, v_finalized_at, v_family_product_id
    FROM public.order_parcel_instances
    WHERE id = v_instance_id;

    IF v_expected IS NULL THEN
      CONTINUE;
    END IF;

    IF v_finalized_at IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_parcel_instance_finalized_at_check',
        MESSAGE = 'A configurable Parcel must be finalized before transaction commit.';
    END IF;

    SELECT
      COALESCE(SUM(component.base_quantity), 0),
      COUNT(*) FILTER (
        WHERE product.id IS NULL
          OR product.is_flavor_master
          OR COALESCE(product.flavor_master_product_id, product.id)
            IS DISTINCT FROM v_family_product_id
      )
    INTO v_actual, v_invalid_components
    FROM public.order_parcel_components component
    LEFT JOIN public.products product ON product.id = component.product_id
    WHERE component.parcel_instance_id = v_instance_id;

    IF v_actual IS DISTINCT FROM v_expected::BIGINT THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_parcel_composition_total_check',
        MESSAGE = FORMAT(
          'Parcel composition total (%s) must equal its pack-size snapshot (%s).',
          v_actual,
          v_expected
        );
    END IF;

    IF v_invalid_components <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_parcel_component_family_check',
        MESSAGE = 'Every Parcel component must belong to its immutable Family snapshot.';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_order_parcel_instance_composition_total
AFTER INSERT OR UPDATE OF units_per_parcel_snapshot, finalized_at
ON public.order_parcel_instances
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_order_parcel_composition_total();

CREATE CONSTRAINT TRIGGER trg_order_parcel_component_composition_total
AFTER INSERT OR UPDATE OF base_quantity, parcel_instance_id OR DELETE
ON public.order_parcel_components
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_order_parcel_composition_total();

-- --------------------------------------------------------------------------
-- Indexes for future atomic lookups and end-to-end traceability.
-- --------------------------------------------------------------------------

CREATE INDEX idx_business_operations_idempotency
  ON public.business_operations(operation_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_orders_operation_id ON public.orders(operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX idx_order_items_family_product_id ON public.order_items(family_product_id)
  WHERE family_product_id IS NOT NULL;
CREATE INDEX idx_order_items_parcel_configuration_id
  ON public.order_items(parcel_configuration_id)
  WHERE parcel_configuration_id IS NOT NULL;
CREATE INDEX idx_order_parcel_instances_operation_id
  ON public.order_parcel_instances(operation_id);
CREATE INDEX idx_order_parcel_instances_order_id
  ON public.order_parcel_instances(order_id);
CREATE INDEX idx_order_parcel_instances_family_product_id
  ON public.order_parcel_instances(family_product_id);
CREATE INDEX idx_order_parcel_components_product_id
  ON public.order_parcel_components(product_id);
CREATE INDEX idx_order_inventory_reservations_order_id
  ON public.order_inventory_reservations(order_id);
CREATE INDEX idx_order_inventory_reservations_order_item_id
  ON public.order_inventory_reservations(order_item_id);
CREATE INDEX idx_order_inventory_reservations_parcel_instance_id
  ON public.order_inventory_reservations(parcel_instance_id)
  WHERE parcel_instance_id IS NOT NULL;
CREATE INDEX idx_order_inventory_reservations_active_stock
  ON public.order_inventory_reservations(warehouse_id, product_id)
  WHERE reservation_state = 'active';
CREATE INDEX idx_supplier_receipts_operation_id
  ON public.supplier_receipts(operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX idx_supplier_receipt_commercial_lines_operation_id
  ON public.supplier_receipt_commercial_lines(operation_id);
CREATE INDEX idx_supplier_receipt_items_commercial_line_id
  ON public.supplier_receipt_items(commercial_line_id)
  WHERE commercial_line_id IS NOT NULL;
CREATE INDEX idx_purchase_orders_operation_id
  ON public.purchase_orders(operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX idx_purchase_receipts_operation_id
  ON public.purchase_receipts(operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX idx_sales_return_events_order_id
  ON public.sales_return_events(order_id, created_at DESC);
CREATE INDEX idx_sales_return_events_operation_id
  ON public.sales_return_events(operation_id);
CREATE INDEX idx_sales_return_items_event_id
  ON public.sales_return_items(sales_return_event_id);
CREATE INDEX idx_sales_return_items_order_item_id
  ON public.sales_return_items(order_item_id);
CREATE UNIQUE INDEX uq_sales_return_items_parcel_instance
  ON public.sales_return_items(parcel_instance_id)
  WHERE parcel_instance_id IS NOT NULL;
CREATE INDEX idx_inventory_movements_operation_id
  ON public.inventory_movements(operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX idx_inventory_movements_parcel_component_id
  ON public.inventory_movements(parcel_component_id)
  WHERE parcel_component_id IS NOT NULL;
CREATE INDEX idx_inventory_movements_reservation_id
  ON public.inventory_movements(reservation_id)
  WHERE reservation_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Least privilege: authenticated staff may read the new records. No direct
-- client INSERT/UPDATE/DELETE privilege or policy is provided.
-- --------------------------------------------------------------------------

DO $$
DECLARE
  v_table_name TEXT;
  v_policy_name CONSTANT TEXT := 'Active ERP staff can read parcel foundation';
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'configurable_parcel_feature_settings',
    'product_parcel_configurations',
    'business_operations',
    'order_parcel_instances',
    'order_parcel_components',
    'order_inventory_reservations',
    'supplier_receipt_commercial_lines',
    'sales_return_events',
    'sales_return_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table_name
    );
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_active_erp_staff()))',
      v_policy_name,
      v_table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.configurable_parcel_feature_settings OWNER TO postgres;
ALTER TABLE public.product_parcel_configurations OWNER TO postgres;
ALTER TABLE public.business_operations OWNER TO postgres;
ALTER TABLE public.order_parcel_instances OWNER TO postgres;
ALTER TABLE public.order_parcel_components OWNER TO postgres;
ALTER TABLE public.order_inventory_reservations OWNER TO postgres;
ALTER TABLE public.supplier_receipt_commercial_lines OWNER TO postgres;
ALTER TABLE public.sales_return_events OWNER TO postgres;
ALTER TABLE public.sales_return_items OWNER TO postgres;

ALTER FUNCTION public.get_configurable_parcel_feature_state() OWNER TO postgres;
ALTER FUNCTION public.assert_configurable_parcel_creation_allowed() OWNER TO postgres;
ALTER FUNCTION public.guard_new_configurable_parcel_row() OWNER TO postgres;
ALTER FUNCTION public.guard_order_parcel_instance_history() OWNER TO postgres;
ALTER FUNCTION public.guard_order_parcel_component_history() OWNER TO postgres;
ALTER FUNCTION public.guard_finalized_order_parcel_item_history() OWNER TO postgres;
ALTER FUNCTION public.guard_immutable_parcel_foundation_row() OWNER TO postgres;
ALTER FUNCTION public.guard_order_inventory_reservation_history() OWNER TO postgres;
ALTER FUNCTION public.validate_order_inventory_reservation_chain() OWNER TO postgres;
ALTER FUNCTION public.validate_inventory_movement_source_chain() OWNER TO postgres;
ALTER FUNCTION public.validate_sales_return_item_line_kind() OWNER TO postgres;
ALTER FUNCTION public.validate_product_parcel_configuration() OWNER TO postgres;
ALTER FUNCTION public.validate_order_parcel_instance_family() OWNER TO postgres;
ALTER FUNCTION public.validate_order_parcel_component_family() OWNER TO postgres;
ALTER FUNCTION public.validate_supplier_receipt_item_commercial_family() OWNER TO postgres;
ALTER FUNCTION public.finalize_order_parcel_instance_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.assert_order_parcel_composition_total() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_configurable_parcel_feature_state()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_configurable_parcel_feature_state()
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_configurable_parcel_creation_allowed()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_new_configurable_parcel_row()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_parcel_instance_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_parcel_component_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_finalized_order_parcel_item_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_immutable_parcel_foundation_row()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_order_inventory_reservation_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_order_inventory_reservation_chain()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_inventory_movement_source_chain()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_sales_return_item_line_kind()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_product_parcel_configuration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_order_parcel_instance_family()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_order_parcel_component_family()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_supplier_receipt_item_commercial_family()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_order_parcel_instance_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_order_parcel_composition_total()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
