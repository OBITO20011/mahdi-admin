BEGIN;

-- ============================================================================
-- Nawasrah ERP - Phase 2 configurable Parcel purchasing and receiving
--
-- Additive only. Legacy RPC signatures and historical rows remain untouched.
-- New contracts are versioned and store immutable financial/composition truth.
-- ============================================================================

ALTER TABLE public.business_operations
  ADD COLUMN result_snapshot JSONB,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN request_identity_version SMALLINT,
  ADD COLUMN request_identity_snapshot JSONB,
  ADD CONSTRAINT business_operations_completion_shape_check CHECK (
    (result_snapshot IS NULL AND completed_at IS NULL)
    OR (result_snapshot IS NOT NULL AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT business_operations_request_identity_shape_check CHECK (
    (request_identity_version IS NULL AND request_identity_snapshot IS NULL)
    OR (request_identity_version > 0 AND request_identity_snapshot IS NOT NULL)
  );

CREATE UNIQUE INDEX uq_business_operations_phase2_idempotency
  ON public.business_operations(operation_type, initiated_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND operation_type IN (
      'supplier_receipt_v2',
      'purchase_order_v2',
      'purchase_order_receipt_v2'
    );

CREATE UNIQUE INDEX uq_business_operations_legacy_receipt_v113_idempotency
  ON public.business_operations(operation_type, initiated_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND operation_type = 'supplier_receipt_legacy_v113';

ALTER TABLE public.supplier_receipts
  ADD COLUMN phase2_finalized_at TIMESTAMPTZ,
  ADD COLUMN merchandise_gross_snapshot_in_minor_units BIGINT,
  ADD COLUMN line_discount_total_snapshot_in_minor_units BIGINT,
  ADD COLUMN header_discount_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_freight_snapshot_in_minor_units BIGINT,
  ADD COLUMN legacy_tax_snapshot_in_minor_units BIGINT,
  ADD COLUMN inventory_acquisition_cost_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_invoice_payable_total_snapshot_in_minor_units BIGINT,
  ADD COLUMN amount_paid_at_receipt_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_outstanding_balance_effect_snapshot_in_minor_units BIGINT,
  ADD COLUMN phase2_cancelled_at TIMESTAMPTZ,
  ADD COLUMN phase2_cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN phase2_cancellation_reason TEXT,
  ADD CONSTRAINT supplier_receipts_phase2_financial_shape_check CHECK (
    phase2_finalized_at IS NULL
    OR (
      operation_id IS NOT NULL
      AND merchandise_gross_snapshot_in_minor_units >= 0
      AND line_discount_total_snapshot_in_minor_units >= 0
      AND header_discount_snapshot_in_minor_units >= 0
      AND supplier_freight_snapshot_in_minor_units >= 0
      AND legacy_tax_snapshot_in_minor_units >= 0
      AND inventory_acquisition_cost_snapshot_in_minor_units >= 0
      AND supplier_invoice_payable_total_snapshot_in_minor_units >= 0
      AND amount_paid_at_receipt_snapshot_in_minor_units >= 0
      AND supplier_outstanding_balance_effect_snapshot_in_minor_units >= 0
      AND line_discount_total_snapshot_in_minor_units <= merchandise_gross_snapshot_in_minor_units
      AND header_discount_snapshot_in_minor_units
        <= merchandise_gross_snapshot_in_minor_units
          - line_discount_total_snapshot_in_minor_units
      AND inventory_acquisition_cost_snapshot_in_minor_units
        = merchandise_gross_snapshot_in_minor_units
          - line_discount_total_snapshot_in_minor_units
          - header_discount_snapshot_in_minor_units
          + supplier_freight_snapshot_in_minor_units
      AND supplier_invoice_payable_total_snapshot_in_minor_units
        = inventory_acquisition_cost_snapshot_in_minor_units
          + legacy_tax_snapshot_in_minor_units
      AND amount_paid_at_receipt_snapshot_in_minor_units
        <= supplier_invoice_payable_total_snapshot_in_minor_units
      AND supplier_outstanding_balance_effect_snapshot_in_minor_units
        = supplier_invoice_payable_total_snapshot_in_minor_units
          - amount_paid_at_receipt_snapshot_in_minor_units
    )
  );

ALTER TABLE public.supplier_receipt_commercial_lines
  ADD COLUMN client_line_id UUID,
  ADD COLUMN received_parcel_quantity INTEGER,
  ADD COLUMN received_base_unit_quantity INTEGER,
  ADD COLUMN allocated_header_discount_in_minor_units BIGINT,
  ADD COLUMN allocated_supplier_freight_in_minor_units BIGINT,
  ADD COLUMN final_acquisition_amount_in_minor_units BIGINT,
  ADD COLUMN finalized_at TIMESTAMPTZ,
  ADD CONSTRAINT supplier_receipt_lines_phase2_shape_check CHECK (
    finalized_at IS NULL
    OR (
      client_line_id IS NOT NULL
      AND received_base_unit_quantity > 0
      AND allocated_header_discount_in_minor_units >= 0
      AND allocated_supplier_freight_in_minor_units >= 0
      AND final_acquisition_amount_in_minor_units >= 0
      AND allocated_header_discount_in_minor_units <= line_total_snapshot_in_minor_units
      AND final_acquisition_amount_in_minor_units
        = line_total_snapshot_in_minor_units
          - allocated_header_discount_in_minor_units
          + allocated_supplier_freight_in_minor_units
      AND (
        (commercial_line_kind = 'base_unit'
          AND received_parcel_quantity IS NULL
          AND received_base_unit_quantity = commercial_quantity)
        OR
        (commercial_line_kind = 'configurable_parcel'
          AND received_parcel_quantity = commercial_quantity
          AND received_base_unit_quantity
            = received_parcel_quantity * units_per_parcel_snapshot)
      )
    )
  );

CREATE UNIQUE INDEX uq_supplier_receipt_lines_client_identity
  ON public.supplier_receipt_commercial_lines(supplier_receipt_id, client_line_id)
  WHERE client_line_id IS NOT NULL;

ALTER TABLE public.supplier_receipt_items
  ADD COLUMN merchandise_net_cost_in_minor_units BIGINT,
  ADD CONSTRAINT supplier_receipt_items_phase2_cost_shape_check CHECK (
    operation_id IS NULL
    OR (
      commercial_line_id IS NOT NULL
      AND merchandise_net_cost_in_minor_units >= 0
      AND allocated_cost_in_minor_units >= 0
      AND exact_unit_cost_in_minor_units >= 0
    )
  );

CREATE UNIQUE INDEX uq_supplier_receipt_items_phase2_line_product
  ON public.supplier_receipt_items(commercial_line_id, product_id)
  WHERE commercial_line_id IS NOT NULL;

ALTER TABLE public.purchase_order_items
  ADD COLUMN client_line_id UUID,
  ADD COLUMN units_per_parcel_snapshot INTEGER,
  ADD COLUMN received_parcel_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN commercial_quantity_snapshot INTEGER,
  ADD COLUMN gross_amount_snapshot_in_minor_units BIGINT,
  ADD COLUMN line_discount_snapshot_in_minor_units BIGINT,
  ADD COLUMN line_net_snapshot_in_minor_units BIGINT,
  ADD CONSTRAINT purchase_order_items_phase2_financial_shape_check CHECK (
    client_line_id IS NULL
    OR (
      commercial_line_kind IN ('base_unit', 'configurable_parcel')
      AND commercial_quantity_snapshot > 0
      AND gross_amount_snapshot_in_minor_units >= 0
      AND line_discount_snapshot_in_minor_units >= 0
      AND line_discount_snapshot_in_minor_units <= gross_amount_snapshot_in_minor_units
      AND line_net_snapshot_in_minor_units
        = gross_amount_snapshot_in_minor_units
          - line_discount_snapshot_in_minor_units
    )
  ),
  ADD CONSTRAINT purchase_order_items_phase2_quantity_shape_check CHECK (
    (client_line_id IS NULL)
    OR (commercial_line_kind = 'base_unit'
      AND parcel_quantity IS NULL
      AND units_per_parcel_snapshot IS NULL
      AND received_parcel_quantity = 0
      AND ordered_quantity = commercial_quantity_snapshot)
    OR (commercial_line_kind = 'configurable_parcel'
      AND client_line_id IS NOT NULL
      AND parcel_quantity > 0
      AND units_per_parcel_snapshot > 0
      AND commercial_quantity_snapshot = parcel_quantity
      AND ordered_quantity = parcel_quantity * units_per_parcel_snapshot
      AND received_parcel_quantity >= 0
      AND received_parcel_quantity <= parcel_quantity
      AND received_quantity
        = received_parcel_quantity * units_per_parcel_snapshot
    )
  ),
  ADD CONSTRAINT purchase_order_items_received_not_over_ordered_check
    CHECK (received_quantity <= ordered_quantity),
  ADD CONSTRAINT purchase_order_items_id_order_unique
    UNIQUE (id, purchase_order_id);

CREATE UNIQUE INDEX uq_purchase_order_items_phase2_client_identity
  ON public.purchase_order_items(purchase_order_id, client_line_id)
  WHERE client_line_id IS NOT NULL;

CREATE TABLE public.purchase_order_item_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_item_id UUID NOT NULL
    REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  expected_base_quantity INTEGER NOT NULL CHECK (expected_base_quantity > 0),
  product_name_snapshot TEXT NOT NULL
    CHECK (NULLIF(BTRIM(product_name_snapshot), '') IS NOT NULL),
  sku_snapshot TEXT NOT NULL CHECK (NULLIF(BTRIM(sku_snapshot), '') IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_order_item_id, product_id)
);

ALTER TABLE public.purchase_receipts
  ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled')),
  ADD COLUMN supplier_invoice_number TEXT,
  ADD COLUMN supplier_invoice_date DATE,
  ADD COLUMN merchandise_gross_snapshot_in_minor_units BIGINT,
  ADD COLUMN line_discount_total_snapshot_in_minor_units BIGINT,
  ADD COLUMN header_discount_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_freight_snapshot_in_minor_units BIGINT,
  ADD COLUMN legacy_tax_snapshot_in_minor_units BIGINT,
  ADD COLUMN inventory_acquisition_cost_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_invoice_payable_total_snapshot_in_minor_units BIGINT,
  ADD COLUMN amount_paid_at_receipt_snapshot_in_minor_units BIGINT,
  ADD COLUMN supplier_outstanding_balance_effect_snapshot_in_minor_units BIGINT,
  ADD COLUMN payment_method TEXT,
  ADD COLUMN payment_reference TEXT,
  ADD COLUMN phase2_finalized_at TIMESTAMPTZ,
  ADD COLUMN phase2_cancelled_at TIMESTAMPTZ,
  ADD COLUMN phase2_cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN phase2_cancellation_reason TEXT,
  ADD CONSTRAINT purchase_receipts_phase2_financial_shape_check CHECK (
    phase2_finalized_at IS NULL
    OR (
      operation_id IS NOT NULL
      AND merchandise_gross_snapshot_in_minor_units >= 0
      AND line_discount_total_snapshot_in_minor_units >= 0
      AND header_discount_snapshot_in_minor_units >= 0
      AND supplier_freight_snapshot_in_minor_units >= 0
      AND legacy_tax_snapshot_in_minor_units >= 0
      AND inventory_acquisition_cost_snapshot_in_minor_units >= 0
      AND supplier_invoice_payable_total_snapshot_in_minor_units >= 0
      AND amount_paid_at_receipt_snapshot_in_minor_units >= 0
      AND supplier_outstanding_balance_effect_snapshot_in_minor_units >= 0
      AND line_discount_total_snapshot_in_minor_units <= merchandise_gross_snapshot_in_minor_units
      AND header_discount_snapshot_in_minor_units
        <= merchandise_gross_snapshot_in_minor_units
          - line_discount_total_snapshot_in_minor_units
      AND inventory_acquisition_cost_snapshot_in_minor_units
        = merchandise_gross_snapshot_in_minor_units
          - line_discount_total_snapshot_in_minor_units
          - header_discount_snapshot_in_minor_units
          + supplier_freight_snapshot_in_minor_units
      AND supplier_invoice_payable_total_snapshot_in_minor_units
        = inventory_acquisition_cost_snapshot_in_minor_units
          + legacy_tax_snapshot_in_minor_units
      AND amount_paid_at_receipt_snapshot_in_minor_units
        <= supplier_invoice_payable_total_snapshot_in_minor_units
      AND supplier_outstanding_balance_effect_snapshot_in_minor_units
        = supplier_invoice_payable_total_snapshot_in_minor_units
          - amount_paid_at_receipt_snapshot_in_minor_units
    )
  ),
  ADD CONSTRAINT purchase_receipts_id_order_operation_unique
    UNIQUE (id, purchase_order_id, operation_id);

CREATE TABLE public.purchase_receipt_commercial_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id UUID NOT NULL,
  purchase_order_id UUID NOT NULL,
  purchase_order_item_id UUID NOT NULL,
  operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  client_line_id UUID NOT NULL,
  line_sequence INTEGER NOT NULL CHECK (line_sequence > 0),
  commercial_line_kind TEXT NOT NULL
    CHECK (commercial_line_kind IN ('base_unit', 'configurable_parcel')),
  family_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
  parcel_configuration_id UUID
    REFERENCES public.product_parcel_configurations(id) ON DELETE RESTRICT,
  configuration_revision INTEGER,
  received_commercial_quantity INTEGER NOT NULL
    CHECK (received_commercial_quantity > 0),
  received_parcel_quantity INTEGER,
  received_base_unit_quantity INTEGER NOT NULL
    CHECK (received_base_unit_quantity > 0),
  units_per_parcel_snapshot INTEGER,
  base_unit_name_snapshot TEXT NOT NULL
    CHECK (NULLIF(BTRIM(base_unit_name_snapshot), '') IS NOT NULL),
  parcel_unit_name_snapshot TEXT,
  gross_amount_snapshot_in_minor_units BIGINT NOT NULL CHECK (gross_amount_snapshot_in_minor_units >= 0),
  line_discount_snapshot_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (line_discount_snapshot_in_minor_units >= 0),
  line_net_merchandise_snapshot_in_minor_units BIGINT NOT NULL CHECK (line_net_merchandise_snapshot_in_minor_units >= 0),
  allocated_header_discount_in_minor_units BIGINT NOT NULL CHECK (allocated_header_discount_in_minor_units >= 0),
  allocated_supplier_freight_in_minor_units BIGINT NOT NULL CHECK (allocated_supplier_freight_in_minor_units >= 0),
  final_acquisition_amount_in_minor_units BIGINT NOT NULL CHECK (final_acquisition_amount_in_minor_units >= 0),
  finalized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_receipt_id, line_sequence),
  UNIQUE (purchase_receipt_id, client_line_id),
  UNIQUE (id, purchase_receipt_id, operation_id),
  FOREIGN KEY (purchase_receipt_id, purchase_order_id, operation_id)
    REFERENCES public.purchase_receipts(id, purchase_order_id, operation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (purchase_order_item_id, purchase_order_id)
    REFERENCES public.purchase_order_items(id, purchase_order_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (parcel_configuration_id, family_product_id)
    REFERENCES public.product_parcel_configurations(id, family_product_id)
    ON DELETE RESTRICT,
  CHECK (line_discount_snapshot_in_minor_units <= gross_amount_snapshot_in_minor_units),
  CHECK (line_net_merchandise_snapshot_in_minor_units
    = gross_amount_snapshot_in_minor_units - line_discount_snapshot_in_minor_units),
  CHECK (allocated_header_discount_in_minor_units <= line_net_merchandise_snapshot_in_minor_units),
  CHECK (final_acquisition_amount_in_minor_units
    = line_net_merchandise_snapshot_in_minor_units
      - allocated_header_discount_in_minor_units
      + allocated_supplier_freight_in_minor_units),
  CHECK (
    (commercial_line_kind = 'base_unit'
      AND family_product_id IS NULL
      AND parcel_configuration_id IS NULL
      AND configuration_revision IS NULL
      AND received_parcel_quantity IS NULL
      AND units_per_parcel_snapshot IS NULL
      AND parcel_unit_name_snapshot IS NULL
      AND received_base_unit_quantity = received_commercial_quantity)
    OR
    (commercial_line_kind = 'configurable_parcel'
      AND family_product_id IS NOT NULL
      AND parcel_configuration_id IS NOT NULL
      AND configuration_revision > 0
      AND received_parcel_quantity = received_commercial_quantity
      AND units_per_parcel_snapshot > 0
      AND NULLIF(BTRIM(parcel_unit_name_snapshot), '') IS NOT NULL
      AND received_base_unit_quantity
        = received_parcel_quantity * units_per_parcel_snapshot)
  )
);

ALTER TABLE public.purchase_receipt_items
  ADD COLUMN commercial_line_id UUID,
  ADD COLUMN merchandise_net_cost_in_minor_units BIGINT,
  ADD CONSTRAINT purchase_receipt_items_commercial_chain_fk
    FOREIGN KEY (commercial_line_id, purchase_receipt_id, operation_id)
    REFERENCES public.purchase_receipt_commercial_lines(
      id, purchase_receipt_id, operation_id
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT purchase_receipt_items_phase2_cost_shape_check CHECK (
    operation_id IS NULL
    OR (
      commercial_line_id IS NOT NULL
      AND product_id IS NOT NULL
      AND merchandise_net_cost_in_minor_units >= 0
      AND allocated_cost_in_minor_units >= 0
      AND exact_unit_cost_in_minor_units >= 0
    )
  );

CREATE UNIQUE INDEX uq_purchase_receipt_items_phase2_line_product
  ON public.purchase_receipt_items(commercial_line_id, product_id)
  WHERE commercial_line_id IS NOT NULL;

CREATE TABLE public.supplier_financial_invoice_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  normalized_invoice_number TEXT NOT NULL
    CHECK (NULLIF(BTRIM(normalized_invoice_number), '') IS NOT NULL),
  operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  supplier_receipt_id UUID REFERENCES public.supplier_receipts(id) ON DELETE RESTRICT,
  purchase_receipt_id UUID REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(supplier_receipt_id, purchase_receipt_id) = 1),
  CHECK ((is_active AND cancelled_at IS NULL) OR (NOT is_active AND cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_supplier_financial_invoice_active
  ON public.supplier_financial_invoice_identities(
    supplier_id, normalized_invoice_number
  ) WHERE is_active;

CREATE TABLE public.phase2_receipt_wac_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.business_operations(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  supplier_receipt_id UUID REFERENCES public.supplier_receipts(id) ON DELETE RESTRICT,
  purchase_receipt_id UUID REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT,
  received_base_quantity INTEGER NOT NULL CHECK (received_base_quantity > 0),
  allocated_acquisition_cost_in_minor_units BIGINT NOT NULL
    CHECK (allocated_acquisition_cost_in_minor_units >= 0),
  opening_global_quantity INTEGER NOT NULL CHECK (opening_global_quantity >= 0),
  prior_exact_wac_in_minor_units NUMERIC(24, 6) NOT NULL
    CHECK (prior_exact_wac_in_minor_units >= 0),
  resulting_exact_wac_in_minor_units NUMERIC(24, 6) NOT NULL
    CHECK (resulting_exact_wac_in_minor_units >= 0),
  prior_legacy_wac_in_minor_units BIGINT NOT NULL
    CHECK (prior_legacy_wac_in_minor_units >= 0),
  resulting_legacy_wac_in_minor_units BIGINT NOT NULL
    CHECK (resulting_legacy_wac_in_minor_units >= 0),
  receipt_movement_sequence_max BIGINT NOT NULL CHECK (receipt_movement_sequence_max > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operation_id, product_id),
  CHECK (num_nonnulls(supplier_receipt_id, purchase_receipt_id) = 1)
);

ALTER TABLE public.inventory_movements
  ADD COLUMN mutation_sequence BIGINT,
  ADD COLUMN supplier_receipt_item_id UUID
    REFERENCES public.supplier_receipt_items(id) ON DELETE RESTRICT,
  ADD COLUMN purchase_receipt_item_id UUID
    REFERENCES public.purchase_receipt_items(id) ON DELETE RESTRICT,
  ADD COLUMN reversed_movement_id UUID
    REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  ADD CONSTRAINT inventory_movements_phase2_receipt_source_check CHECK (
    num_nonnulls(supplier_receipt_item_id, purchase_receipt_item_id) <= 1
  );

CREATE UNIQUE INDEX uq_inventory_movements_phase2_source_item
  ON public.inventory_movements(
    COALESCE(supplier_receipt_item_id, purchase_receipt_item_id)
  )
  WHERE supplier_receipt_item_id IS NOT NULL
     OR purchase_receipt_item_id IS NOT NULL;

CREATE UNIQUE INDEX uq_inventory_movements_reversed_movement
  ON public.inventory_movements(reversed_movement_id)
  WHERE reversed_movement_id IS NOT NULL;

CREATE SEQUENCE public.inventory_movement_mutation_seq;

CREATE FUNCTION public.assign_inventory_movement_mutation_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.mutation_sequence IS NULL THEN
    NEW.mutation_sequence := NEXTVAL('public.inventory_movement_mutation_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_inventory_movement_mutation_sequence
BEFORE INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.assign_inventory_movement_mutation_sequence();

CREATE UNIQUE INDEX uq_inventory_movements_mutation_sequence
  ON public.inventory_movements(mutation_sequence)
  WHERE mutation_sequence IS NOT NULL;

ALTER TABLE public.supplier_payments
  ADD COLUMN purchase_receipt_id UUID
    REFERENCES public.purchase_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN operation_id UUID
    REFERENCES public.business_operations(id) ON DELETE RESTRICT;

CREATE INDEX idx_supplier_payments_purchase_receipt_id
  ON public.supplier_payments(purchase_receipt_id)
  WHERE purchase_receipt_id IS NOT NULL;

CREATE INDEX idx_supplier_payments_operation_id
  ON public.supplier_payments(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE INDEX idx_purchase_order_item_components_product
  ON public.purchase_order_item_components(product_id);
CREATE INDEX idx_purchase_receipt_commercial_lines_operation
  ON public.purchase_receipt_commercial_lines(operation_id);
CREATE INDEX idx_purchase_receipt_commercial_lines_po_item
  ON public.purchase_receipt_commercial_lines(purchase_order_item_id);
CREATE INDEX idx_phase2_receipt_wac_product
  ON public.phase2_receipt_wac_snapshots(product_id, created_at DESC);
CREATE INDEX idx_inventory_movements_supplier_receipt_item
  ON public.inventory_movements(supplier_receipt_item_id)
  WHERE supplier_receipt_item_id IS NOT NULL;
CREATE INDEX idx_inventory_movements_purchase_receipt_item
  ON public.inventory_movements(purchase_receipt_item_id)
  WHERE purchase_receipt_item_id IS NOT NULL;

-- Deterministic integer largest-remainder allocator. The caller supplies a
-- stable business key; UUIDs generated during execution are never tie-breakers.
CREATE FUNCTION public.phase2_allocate_largest_remainder_internal(
  p_total BIGINT,
  p_weighted_keys JSONB
)
RETURNS TABLE(allocation_key TEXT, allocated_amount BIGINT)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  WITH parsed AS (
    SELECT
      NULLIF(BTRIM(item->>'key'), '') AS allocation_key,
      (item->>'weight')::NUMERIC AS weight
    FROM jsonb_array_elements(COALESCE(p_weighted_keys, '[]'::JSONB)) item
  ), basis AS (
    SELECT COALESCE(SUM(weight), 0::NUMERIC) AS total_weight FROM parsed
  ), shares AS (
    SELECT
      parsed.allocation_key,
      CASE
        WHEN p_total = 0 OR basis.total_weight = 0 THEN 0::BIGINT
        ELSE FLOOR((p_total::NUMERIC * parsed.weight) / basis.total_weight)::BIGINT
      END AS base_amount,
      CASE
        WHEN p_total = 0 OR basis.total_weight = 0 THEN 0::NUMERIC
        ELSE (p_total::NUMERIC * parsed.weight) / basis.total_weight
          - FLOOR((p_total::NUMERIC * parsed.weight) / basis.total_weight)
      END AS fractional_remainder
    FROM parsed CROSS JOIN basis
  ), residual AS (
    SELECT p_total - COALESCE(SUM(base_amount), 0) AS units FROM shares
  ), ranked AS (
    SELECT
      shares.*,
      ROW_NUMBER() OVER (
        ORDER BY fractional_remainder DESC, allocation_key ASC
      ) AS residual_rank
    FROM shares
  )
  SELECT
    ranked.allocation_key,
    ranked.base_amount
      + CASE WHEN ranked.residual_rank <= residual.units THEN 1 ELSE 0 END
  FROM ranked CROSS JOIN residual
  ORDER BY ranked.allocation_key;
$$;

CREATE FUNCTION public.phase2_canonicalize_receipt_lines_internal(
  p_lines JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'client_line_id', LOWER((line->>'client_line_id')::UUID::TEXT),
        'purchase_order_item_id', CASE
          WHEN NULLIF(BTRIM(line->>'purchase_order_item_id'), '') IS NULL THEN NULL
          ELSE LOWER((line->>'purchase_order_item_id')::UUID::TEXT)
        END,
        'line_kind', LOWER(BTRIM(line->>'line_kind')),
        'family_product_id', CASE
          WHEN NULLIF(BTRIM(line->>'family_product_id'), '') IS NULL THEN NULL
          ELSE LOWER((line->>'family_product_id')::UUID::TEXT)
        END,
        'parcel_configuration_id', CASE
          WHEN NULLIF(BTRIM(line->>'parcel_configuration_id'), '') IS NULL THEN NULL
          ELSE LOWER((line->>'parcel_configuration_id')::UUID::TEXT)
        END,
        'configuration_revision', NULLIF(BTRIM(line->>'configuration_revision'), '')::INTEGER,
        'commercial_quantity', (line->>'commercial_quantity')::INTEGER,
        'units_per_parcel', NULLIF(BTRIM(line->>'units_per_parcel'), '')::INTEGER,
        'base_unit_name', NULLIF(BTRIM(line->>'base_unit_name'), ''),
        'parcel_unit_name', NULLIF(BTRIM(line->>'parcel_unit_name'), ''),
        'gross_amount_in_minor_units', (line->>'gross_amount_in_minor_units')::BIGINT,
        'line_discount_in_minor_units', COALESCE(NULLIF(BTRIM(line->>'line_discount_in_minor_units'), '')::BIGINT, 0),
        'components', (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'product_id', LOWER((component->>'product_id')::UUID::TEXT),
                'base_quantity', (component->>'base_quantity')::INTEGER,
                'explicit_merchandise_cost_in_minor_units',
                  NULLIF(BTRIM(component->>'explicit_merchandise_cost_in_minor_units'), '')::BIGINT,
                'batch_number', NULLIF(BTRIM(component->>'batch_number'), ''),
                'production_date', NULLIF(BTRIM(component->>'production_date'), '')::DATE,
                'expiry_date', NULLIF(BTRIM(component->>'expiry_date'), '')::DATE,
                'notes', NULLIF(BTRIM(component->>'notes'), '')
              )
              ORDER BY (component->>'product_id')::UUID
            ),
            '[]'::JSONB
          )
          FROM jsonb_array_elements(COALESCE(line->'components', '[]'::JSONB)) component
        )
      )
      ORDER BY (line->>'client_line_id')::UUID
    ),
    '[]'::JSONB
  )
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::JSONB)) line;
$$;

CREATE FUNCTION public.phase2_request_fingerprint_internal(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ENCODE(extensions.digest(p_payload::TEXT, 'sha256'::TEXT), 'hex');
$$;

-- Legacy Direct Receiving processes repeated lines sequentially and rounds WAC
-- at each line. Preserve array order in request identity while normalizing JSON
-- object shape and the same field defaults used by Migration 011.
CREATE FUNCTION public.phase2_canonicalize_legacy_receipt_items_internal(p_items JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', LOWER((item.value->>'product_id')::UUID::TEXT),
        'purchase_unit_id', CASE
          WHEN NULLIF(item.value->>'purchase_unit_id', '') IS NULL THEN NULL
          ELSE LOWER((item.value->>'purchase_unit_id')::UUID::TEXT)
        END,
        'purchase_unit_name', NULLIF(item.value->>'purchase_unit_name', ''),
        'base_unit_name', NULLIF(item.value->>'base_unit_name', ''),
        'package_quantity', COALESCE((item.value->>'package_quantity')::INTEGER, 0),
        'units_per_package', COALESCE((item.value->>'units_per_package')::INTEGER, 0),
        'package_price_in_minor_units',
          COALESCE((item.value->>'package_price_in_minor_units')::BIGINT, 0),
        'update_product_defaults',
          COALESCE((item.value->>'update_product_defaults')::BOOLEAN, false),
        'discount_in_minor_units',
          COALESCE((item.value->>'discount_in_minor_units')::BIGINT, 0),
        'batch_number', NULLIF(BTRIM(item.value->>'batch_number'), ''),
        'production_date', NULLIF(item.value->>'production_date', '')::DATE,
        'expiry_date', NULLIF(item.value->>'expiry_date', '')::DATE,
        'notes', NULLIF(item.value->>'notes', '')
      )
      ORDER BY item.ordinality
    ),
    '[]'::JSONB
  )
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
    WITH ORDINALITY AS item(value, ordinality);
$$;

CREATE FUNCTION public.phase2_try_parse_uuid_internal(p_value TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NULLIF(BTRIM(p_value), '')::UUID;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

-- All acquisition writers use this hierarchy before any product-referencing
-- business row is inserted: deterministic per-SKU advisory locks, every
-- existing inventory balance in product/warehouse order, then product rows.
-- Balance-first runtime writers (POS, transfer, adjustments and returns) can
-- finish without forming a Product/FK <-> inventory-balance lock cycle.
CREATE FUNCTION public.phase2_lock_inventory_products_internal(
  p_product_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
  v_expected_count INTEGER;
  v_found_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_expected_count
  FROM (
    SELECT DISTINCT product_id
    FROM unnest(COALESCE(p_product_ids, ARRAY[]::UUID[])) product_id
    WHERE product_id IS NOT NULL
  ) requested;

  IF v_expected_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PRODUCT_LOCK_SET_EMPTY: مجموعة منتجات الاستلام فارغة.';
  END IF;

  FOR v_product_id IN
    SELECT DISTINCT product_id
    FROM unnest(p_product_ids) product_id
    WHERE product_id IS NOT NULL
    ORDER BY product_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'inventory-product:' || v_product_id::TEXT,
      0
    ));
  END LOOP;

  PERFORM balance.id
  FROM public.inventory_balances balance
  WHERE balance.product_id = ANY(p_product_ids)
  ORDER BY balance.product_id, balance.warehouse_id
  FOR UPDATE;

  PERFORM product.id
  FROM public.products product
  WHERE product.id = ANY(p_product_ids)
  ORDER BY product.id
  FOR NO KEY UPDATE;

  GET DIAGNOSTICS v_found_count = ROW_COUNT;
  IF v_found_count <> v_expected_count THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      CONSTRAINT = 'phase2_receipt_product_lock_set_check',
      MESSAGE = 'PHASE2_PRODUCT_NOT_FOUND: أحد منتجات الاستلام غير موجود.';
  END IF;
END;
$$;

-- Paid acquisition takes the existing open-shift row lock BEFORE any SKU,
-- balance, document or supplier lock. Reversal/close already lock shift first.
-- This is read-only synchronization; historical replay never calls this helper.
CREATE FUNCTION public.phase2_lock_payment_shift_internal(
  p_branch_id UUID, p_payment_method TEXT, p_amount BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Callers pass the payment method after applying their own existing contract.
  -- Keep this comparison exact so lock selection cannot broaden accepted inputs.
  IF p_amount > 0 AND p_payment_method IN ('cash', 'cliq') THEN
    IF p_branch_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE2_PAYMENT_BRANCH_REQUIRED: تعذر تحديد فرع دفعة المورد.';
    END IF;
    PERFORM shift.id FROM public.cash_shifts shift
    WHERE shift.branch_id = p_branch_id AND shift.status = 'open'
    ORDER BY shift.id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE2_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق قبل تسجيل دفعة المورد.';
    END IF;
  END IF;
END;
$$;

-- Cancellation may update existing payment rows even on a closed shift. Lock
-- the referenced shifts first without adding an open-shift business condition.
CREATE FUNCTION public.phase2_lock_receipt_payment_shifts_internal(
  p_supplier_receipt_id UUID, p_purchase_receipt_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT FROM public.cash_shifts shift
  WHERE EXISTS (
    SELECT 1 FROM public.supplier_payments payment
    WHERE payment.cash_shift_id = shift.id AND NOT payment.is_reversed
      AND (payment.supplier_receipt_id = p_supplier_receipt_id
        OR payment.purchase_receipt_id = p_purchase_receipt_id)
  )
  -- Also synchronize with a later payment not committed at this read yet.
  -- The current open branch shift is optional: unpaid cancellation still works
  -- without one, and existing closed payment shifts remain lockable above.
  OR (shift.status = 'open' AND shift.branch_id = COALESCE(
    (SELECT branch_id FROM public.supplier_receipts WHERE id = p_supplier_receipt_id),
    (SELECT po.branch_id FROM public.purchase_receipts receipt
      JOIN public.purchase_orders po ON po.id = receipt.purchase_order_id
      WHERE receipt.id = p_purchase_receipt_id)
  ))
  ORDER BY shift.id FOR SHARE;
$$;

REVOKE ALL ON FUNCTION public.phase2_lock_payment_shift_internal(UUID, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_lock_receipt_payment_shifts_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve existing payment contracts/replay branches. Only new payments
-- pre-lock the open shift before the original document/supplier writer.
DO $payment_lock_order$
DECLARE
  v_spec RECORD;
  v_definition TEXT;
  v_marker TEXT;
BEGIN
  FOR v_spec IN SELECT * FROM (VALUES
    ('public.record_supplier_receipt_payment(uuid,bigint,text,text,text,text)',
     '_record_supplier_receipt_payment_impl',
     '(SELECT branch_id FROM public.supplier_receipts WHERE id = p_receipt_id)',
     'COALESCE(p_payment_method, ''cash'')'),
    ('public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text,text)',
     '_record_supplier_payment_impl',
     '(SELECT branch_id FROM public.purchase_orders WHERE id = p_purchase_order_id)',
     'p_payment_method')
  ) specs(signature, implementation_name, branch_expression, payment_expression)
  LOOP
    SELECT pg_get_functiondef(v_spec.signature::REGPROCEDURE) INTO v_definition;
    v_marker := '  v_result := public.' || v_spec.implementation_name || '(';
    IF POSITION(v_marker IN v_definition) = 0
      OR POSITION('RETURN jsonb_build_object(' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Cannot safely install Phase-2 payment lock order: %', v_spec.signature;
    END IF;
    EXECUTE REPLACE(v_definition, v_marker,
      '  PERFORM public.phase2_lock_payment_shift_internal(' ||
      v_spec.branch_expression || ', ' || v_spec.payment_expression ||
      ', p_amount_in_minor_units);' ||
      E'\n' || v_marker);
  END LOOP;
END;
$payment_lock_order$;

-- record_supplier_payment historically distinguishes an omitted argument
-- (SQL default 'cash') from explicit NULL (the NOT NULL payment column rejects
-- it). Make that rejection stable before the legacy implementation can lock a
-- purchase order, and before the payment trigger can request a Shift lock.
DO $supplier_payment_null_guard$
DECLARE
  v_signature CONSTANT TEXT :=
    'public.record_supplier_payment(uuid,uuid,bigint,text,text,timestamp with time zone,text,text)';
  v_definition TEXT;
  v_marker CONSTANT TEXT :=
    '  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN';
BEGIN
  SELECT pg_get_functiondef(v_signature::REGPROCEDURE) INTO v_definition;
  IF POSITION(v_marker IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Cannot safely install supplier-payment NULL guard: %', v_signature;
  END IF;
  EXECUTE REPLACE(v_definition, v_marker,
    '  IF p_payment_method IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION USING ERRCODE = ''22004'',' || E'\n' ||
    '      MESSAGE = ''SUPPLIER_PAYMENT_METHOD_REQUIRED: طريقة دفع المورد مطلوبة.'';' || E'\n' ||
    '  END IF;' || E'\n' || v_marker
  );
END;
$supplier_payment_null_guard$;

-- Defense at the table boundary: an invalid NULL payment never asks for a
-- Shift lock before the column's existing NOT NULL contract rejects it.
CREATE OR REPLACE FUNCTION public.attach_supplier_payment_to_open_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id UUID;
  v_shift_id UUID;
BEGIN
  IF NEW.payment_method IS NULL
    OR NEW.payment_method NOT IN ('cash', 'cliq')
    OR NEW.cash_shift_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT branch_id FROM public.purchase_orders
     WHERE id = NEW.purchase_order_id),
    (SELECT branch_id FROM public.supplier_receipts
     WHERE id = NEW.supplier_receipt_id)
  ) INTO v_branch_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'تعذر تحديد فرع دفعة المورد.';
  END IF;

  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = v_branch_id
    AND status = 'open'
  FOR SHARE;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION
      'افتح وردية الصندوق أولًا قبل تسجيل دفعة مورد كاش أو CliQ.';
  END IF;

  NEW.cash_shift_id := v_shift_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.phase2_lock_payment_shift_internal(UUID, TEXT, BIGINT) OWNER TO postgres;
ALTER FUNCTION public.phase2_lock_receipt_payment_shifts_internal(UUID, UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.phase2_allocate_largest_remainder_internal(BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_canonicalize_receipt_lines_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_request_fingerprint_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_canonicalize_legacy_receipt_items_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_try_parse_uuid_internal(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_lock_inventory_products_internal(UUID[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.phase2_validate_receipt_lines_internal(p_lines JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line JSONB;
  v_component JSONB;
  v_line_kind TEXT;
  v_family_id UUID;
  v_configuration_id UUID;
  v_configuration_revision INTEGER;
  v_commercial_quantity INTEGER;
  v_units_per_parcel INTEGER;
  v_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_component_count INTEGER;
  v_explicit_count INTEGER;
  v_component_quantity NUMERIC;
  v_explicit_total NUMERIC;
  v_product_id UUID;
  v_product_family UUID;
  v_is_master BOOLEAN;
  v_is_active BOOLEAN;
  v_config public.product_parcel_configurations%ROWTYPE;
  v_family public.products%ROWTYPE;
BEGIN
  IF p_lines IS NULL
    OR jsonb_typeof(p_lines) <> 'array'
    OR jsonb_array_length(p_lines) = 0
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'PHASE2_RECEIPT_LINES_REQUIRED: يجب إضافة سطر استلام واحد على الأقل.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lines) line
    GROUP BY (line->>'client_line_id')::UUID
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      CONSTRAINT = 'phase2_receipt_client_line_identity_unique',
      MESSAGE = 'DUPLICATE_COMMERCIAL_LINE_IDENTITY: هوية السطر التجاري مكررة.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM (v_line->>'client_line_id')::UUID;
    v_line_kind := LOWER(BTRIM(v_line->>'line_kind'));
    v_family_id := NULLIF(BTRIM(v_line->>'family_product_id'), '')::UUID;
    v_configuration_id :=
      NULLIF(BTRIM(v_line->>'parcel_configuration_id'), '')::UUID;
    v_configuration_revision :=
      NULLIF(BTRIM(v_line->>'configuration_revision'), '')::INTEGER;
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_units_per_parcel :=
      NULLIF(BTRIM(v_line->>'units_per_parcel'), '')::INTEGER;
    v_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_discount :=
      COALESCE(NULLIF(BTRIM(v_line->>'line_discount_in_minor_units'), '')::BIGINT, 0);

    IF v_line_kind NOT IN ('base_unit', 'configurable_parcel') THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'PHASE2_RECEIPT_LINE_KIND_INVALID: نوع السطر التجاري غير مدعوم.';
    END IF;
    IF v_commercial_quantity <= 0 OR v_gross < 0 OR v_line_discount < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'PHASE2_RECEIPT_LINE_VALUE_INVALID: الكمية والأسعار والخصومات يجب أن تكون ضمن الحدود المسموحة.';
    END IF;
    IF v_line_discount > v_gross THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'phase2_receipt_line_discount_check',
        MESSAGE = 'PHASE2_LINE_DISCOUNT_EXCEEDS_GROSS: خصم السطر يتجاوز إجماليه.';
    END IF;
    IF NULLIF(BTRIM(v_line->>'base_unit_name'), '') IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'PHASE2_BASE_UNIT_NAME_REQUIRED: اسم وحدة المخزون الأساسية مطلوب.';
    END IF;

    v_line_net := v_gross - v_line_discount;
    v_component_count := jsonb_array_length(COALESCE(v_line->'components', '[]'::JSONB));
    IF v_component_count = 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'PHASE2_RECEIPT_COMPONENTS_REQUIRED: مكونات السطر التجاري مطلوبة.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_line->'components') component
      GROUP BY (component->>'product_id')::UUID
      HAVING COUNT(*) > 1
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        CONSTRAINT = 'phase2_receipt_component_identity_unique',
        MESSAGE = 'DUPLICATE_COMPONENT_IDENTITY: لا يجوز تكرار نفس SKU داخل السطر التجاري.';
    END IF;

    SELECT
      COUNT(*) FILTER (
        WHERE NULLIF(BTRIM(component->>'explicit_merchandise_cost_in_minor_units'), '') IS NOT NULL
      ),
      COALESCE(SUM((component->>'base_quantity')::NUMERIC), 0),
      COALESCE(SUM(
        NULLIF(BTRIM(component->>'explicit_merchandise_cost_in_minor_units'), '')::NUMERIC
      ), 0)
    INTO v_explicit_count, v_component_quantity, v_explicit_total
    FROM jsonb_array_elements(v_line->'components') component;

    IF v_explicit_count NOT IN (0, v_component_count) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'phase2_component_cost_completeness_check',
        MESSAGE = 'PARTIAL_EXPLICIT_COMPONENT_COST: يجب إدخال تكلفة كل المكونات أو عدم إدخالها كلها.';
    END IF;
    IF v_explicit_count = v_component_count
      AND v_explicit_total IS DISTINCT FROM v_line_net::NUMERIC
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'phase2_component_merchandise_cost_total_check',
        MESSAGE = 'EXPLICIT_COMPONENT_COST_MISMATCH: تكاليف المكونات لا تطابق صافي السطر التجاري.';
    END IF;

    FOR v_component IN SELECT * FROM jsonb_array_elements(v_line->'components')
    LOOP
      v_product_id := (v_component->>'product_id')::UUID;
      IF (v_component->>'base_quantity')::INTEGER <= 0 THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'PHASE2_COMPONENT_QUANTITY_INVALID: كمية مكون SKU يجب أن تكون موجبة.';
      END IF;
      IF NULLIF(BTRIM(v_component->>'explicit_merchandise_cost_in_minor_units'), '')::BIGINT < 0 THEN
        RAISE EXCEPTION USING
          ERRCODE = '22023',
          MESSAGE = 'PHASE2_COMPONENT_COST_INVALID: تكلفة مكون SKU لا يمكن أن تكون سالبة.';
      END IF;

      SELECT
        COALESCE(product.flavor_master_product_id, product.id),
        product.is_flavor_master,
        product.is_active
      INTO v_product_family, v_is_master, v_is_active
      FROM public.products product
      WHERE product.id = v_product_id;

      IF NOT FOUND OR NOT v_is_active OR v_is_master THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'phase2_receipt_stocked_sku_check',
          MESSAGE = 'PHASE2_STOCKED_SKU_REQUIRED: الاستلام يقبل SKU مخزنيًا نشطًا فقط.';
      END IF;
      IF v_line_kind = 'configurable_parcel'
        AND v_product_family IS DISTINCT FROM v_family_id
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'phase2_receipt_component_family_check',
          MESSAGE = 'PHASE2_COMPONENT_FAMILY_MISMATCH: مكون الطرد خارج العائلة التجارية.';
      END IF;
    END LOOP;

    IF v_component_quantity > 2147483647::NUMERIC THEN
      RAISE EXCEPTION USING
        ERRCODE = '22003',
        MESSAGE = 'PHASE2_COMPONENT_QUANTITY_OVERFLOW: إجمالي كمية المكونات يتجاوز الحد المدعوم.';
    END IF;

    IF v_line_kind = 'base_unit' THEN
      IF v_family_id IS NOT NULL
        OR v_configuration_id IS NOT NULL
        OR v_configuration_revision IS NOT NULL
        OR v_units_per_parcel IS NOT NULL
        OR NULLIF(BTRIM(v_line->>'parcel_unit_name'), '') IS NOT NULL
        OR v_component_count <> 1
        OR v_component_quantity <> v_commercial_quantity::NUMERIC
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'phase2_base_unit_line_shape_check',
          MESSAGE = 'PHASE2_BASE_UNIT_LINE_INVALID: سطر الوحدة الأساسية يجب أن يحتوي SKU واحدًا وكمية مطابقة.';
      END IF;
    ELSE
      PERFORM public.assert_configurable_parcel_creation_allowed();

      SELECT * INTO v_config
      FROM public.product_parcel_configurations configuration
      WHERE configuration.id = v_configuration_id
      FOR SHARE;
      SELECT * INTO v_family
      FROM public.products product
      WHERE product.id = v_family_id
      FOR SHARE;

      IF v_config.id IS NULL
        OR NOT v_config.is_active
        OR v_config.composition_mode <> 'configurable_mix'
        OR v_config.family_product_id IS DISTINCT FROM v_family_id
        OR v_config.configuration_revision IS DISTINCT FROM v_configuration_revision
        OR v_family.id IS NULL
        OR NOT v_family.is_flavor_master
        OR v_units_per_parcel IS DISTINCT FROM v_family.units_per_sale_unit
        OR NULLIF(BTRIM(v_line->>'parcel_unit_name'), '') IS NULL
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'phase2_receipt_parcel_configuration_check',
          MESSAGE = 'PHASE2_PARCEL_CONFIGURATION_MISMATCH: إعداد الطرد أو نسخته أو سعته غير متطابقة.';
      END IF;

      IF v_component_quantity
        <> v_commercial_quantity::NUMERIC * v_units_per_parcel::NUMERIC
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'phase2_receipt_parcel_capacity_check',
          MESSAGE = 'PHASE2_PARCEL_CAPACITY_MISMATCH: مجموع وحدات الطرد لا يطابق العدد والسعة.';
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.phase2_apply_inventory_and_wac_internal(
  p_operation_id UUID,
  p_warehouse_id UUID,
  p_source_kind TEXT,
  p_source_id UUID,
  p_components JSONB,
  p_user_id UUID,
  p_reference_label TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product RECORD;
  v_component RECORD;
  v_opening_global INTEGER;
  v_target_before INTEGER;
  v_running_balance INTEGER;
  v_received_quantity INTEGER;
  v_received_cost BIGINT;
  v_prior_exact NUMERIC(24, 6);
  v_prior_legacy BIGINT;
  v_new_exact NUMERIC(24, 6);
  v_new_legacy BIGINT;
  v_movement_id UUID;
  v_last_movement_sequence BIGINT := 0;
  v_product_results JSONB := '[]'::JSONB;
BEGIN
  IF p_source_kind NOT IN ('supplier_receipt', 'purchase_receipt') THEN
    RAISE EXCEPTION 'PHASE2_RECEIPT_SOURCE_INVALID';
  END IF;

  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT DISTINCT (component->>'product_id')::UUID
    FROM jsonb_array_elements(p_components) component
    ORDER BY (component->>'product_id')::UUID
  ));

  FOR v_product IN
    SELECT
      (component->>'product_id')::UUID AS product_id,
      SUM((component->>'base_quantity')::INTEGER)::INTEGER AS received_quantity,
      SUM((component->>'allocated_cost_in_minor_units')::BIGINT)::BIGINT AS received_cost
    FROM jsonb_array_elements(p_components) component
    GROUP BY (component->>'product_id')::UUID
    ORDER BY (component->>'product_id')::UUID
  LOOP
    SELECT
      product.wac_cost_in_minor_units_exact,
      product.cost_price_in_minor_units
    INTO v_prior_exact, v_prior_legacy
    FROM public.products product
    WHERE product.id = v_product.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PHASE2_PRODUCT_NOT_FOUND';
    END IF;
    v_prior_exact := COALESCE(v_prior_exact, v_prior_legacy::NUMERIC);
    v_received_quantity := v_product.received_quantity;
    v_received_cost := v_product.received_cost;

    SELECT COALESCE(SUM(balance.on_hand_quantity), 0)::INTEGER
    INTO v_opening_global
    FROM public.inventory_balances balance
    WHERE balance.product_id = v_product.product_id;

    INSERT INTO public.inventory_balances (
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES (
      p_warehouse_id, v_product.product_id, 0, 0
    ) ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    SELECT balance.on_hand_quantity
    INTO v_target_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_product.product_id
    FOR UPDATE;

    v_new_exact := ROUND(
      (
        v_opening_global::NUMERIC * v_prior_exact
        + v_received_cost::NUMERIC
      ) / (v_opening_global::NUMERIC + v_received_quantity::NUMERIC),
      6
    );
    v_new_legacy := ROUND(v_new_exact)::BIGINT;

    UPDATE public.products
    SET
      wac_cost_in_minor_units_exact = v_new_exact,
      cost_price_in_minor_units = v_new_legacy,
      updated_at = NOW()
    WHERE id = v_product.product_id;

    v_running_balance := v_target_before;
    FOR v_component IN
      SELECT
        (component->>'item_id')::UUID AS item_id,
        (component->>'client_line_id')::UUID AS client_line_id,
        (component->>'product_id')::UUID AS product_id,
        (component->>'base_quantity')::INTEGER AS base_quantity
      FROM jsonb_array_elements(p_components) component
      WHERE (component->>'product_id')::UUID = v_product.product_id
      ORDER BY
        (component->>'client_line_id')::UUID,
        (component->>'product_id')::UUID
    LOOP
      v_movement_id := gen_random_uuid();
      INSERT INTO public.inventory_movements (
        id,
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        notes,
        created_by,
        operation_id,
        supplier_receipt_item_id,
        purchase_receipt_item_id
      ) VALUES (
        v_movement_id,
        p_warehouse_id,
        v_component.product_id,
        'purchase_receipt',
        v_component.base_quantity,
        v_running_balance,
        v_running_balance + v_component.base_quantity,
        p_source_kind,
        p_source_id,
        p_reference_label,
        p_user_id,
        p_operation_id,
        CASE WHEN p_source_kind = 'supplier_receipt' THEN v_component.item_id END,
        CASE WHEN p_source_kind = 'purchase_receipt' THEN v_component.item_id END
      ) RETURNING mutation_sequence INTO v_last_movement_sequence;
      v_running_balance := v_running_balance + v_component.base_quantity;
    END LOOP;

    UPDATE public.inventory_balances
    SET on_hand_quantity = v_running_balance, updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product.product_id;

    INSERT INTO public.phase2_receipt_wac_snapshots (
      operation_id,
      product_id,
      supplier_receipt_id,
      purchase_receipt_id,
      received_base_quantity,
      allocated_acquisition_cost_in_minor_units,
      opening_global_quantity,
      prior_exact_wac_in_minor_units,
      resulting_exact_wac_in_minor_units,
      prior_legacy_wac_in_minor_units,
      resulting_legacy_wac_in_minor_units,
      receipt_movement_sequence_max
    ) VALUES (
      p_operation_id,
      v_product.product_id,
      CASE WHEN p_source_kind = 'supplier_receipt' THEN p_source_id END,
      CASE WHEN p_source_kind = 'purchase_receipt' THEN p_source_id END,
      v_received_quantity,
      v_received_cost,
      v_opening_global,
      v_prior_exact,
      v_new_exact,
      v_prior_legacy,
      v_new_legacy,
      v_last_movement_sequence
    );

    v_product_results := v_product_results || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product.product_id,
        'received_base_quantity', v_received_quantity,
        'allocated_acquisition_cost_in_minor_units', v_received_cost,
        'opening_global_quantity', v_opening_global,
        'resulting_exact_wac_in_minor_units', v_new_exact,
        'resulting_legacy_wac_in_minor_units', v_new_legacy
      )
    );
  END LOOP;

  RETURN v_product_results;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_validate_receipt_lines_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase2_apply_inventory_and_wac_internal(
  UUID, UUID, TEXT, UUID, JSONB, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_direct_supplier_receipt_v2(
  p_supplier_id UUID,
  p_warehouse_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_header_discount_in_minor_units BIGINT DEFAULT 0,
  p_supplier_freight_in_minor_units BIGINT DEFAULT 0,
  p_legacy_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_at_receipt_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_invoice_number TEXT := NULLIF(BTRIM(p_supplier_invoice_number), '');
  v_normalized_invoice TEXT := LOWER(NULLIF(BTRIM(p_supplier_invoice_number), ''));
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_payment_reference TEXT := NULLIF(BTRIM(p_payment_reference), '');
  v_canonical_lines JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_legacy_key UUID;
  v_existing_operation public.business_operations%ROWTYPE;
  v_operation_id UUID := gen_random_uuid();
  v_receipt_id UUID := gen_random_uuid();
  v_receipt_number TEXT;
  v_result JSONB;
  v_line_weights JSONB;
  v_header_allocations JSONB;
  v_freight_allocations JSONB;
  v_component_weights JSONB;
  v_component_merchandise_allocations JSONB;
  v_component_final_allocations JSONB;
  v_inventory_components JSONB := '[]'::JSONB;
  v_wac_results JSONB;
  v_line JSONB;
  v_component JSONB;
  v_line_id UUID;
  v_item_id UUID;
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_client_line_id UUID;
  v_commercial_quantity INTEGER;
  v_units_per_parcel INTEGER;
  v_base_quantity INTEGER;
  v_product_id UUID;
  v_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_header_discount BIGINT;
  v_line_freight BIGINT;
  v_line_acquisition BIGINT;
  v_component_merchandise BIGINT;
  v_component_acquisition BIGINT;
  v_merchandise_gross NUMERIC := 0;
  v_line_discount_total NUMERIC := 0;
  v_line_net_total NUMERIC := 0;
  v_acquisition_total NUMERIC;
  v_invoice_payable NUMERIC;
  v_outstanding NUMERIC;
  v_product public.products%ROWTYPE;
  v_purchase_unit_name TEXT;
  v_base_unit_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام بضاعة الموردين - نموذج الطرود'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'PHASE2_AUTH_REQUIRED: يجب تسجيل الدخول.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_IDEMPOTENCY_KEY_INVALID: مفتاح منع التكرار غير صالح.';
  END IF;
  v_legacy_key := public.phase2_try_parse_uuid_internal(v_key);
  IF v_legacy_key IS NOT NULL THEN
    v_key := v_legacy_key::TEXT;
  END IF;
  IF p_header_discount_in_minor_units < 0
    OR p_supplier_freight_in_minor_units < 0
    OR p_legacy_tax_in_minor_units < 0
    OR p_amount_paid_at_receipt_in_minor_units < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_FINANCIAL_VALUE_INVALID: القيم المالية لا يمكن أن تكون سالبة.';
  END IF;
  IF v_payment_method NOT IN ('cash', 'cliq', 'bank_transfer', 'deferred') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PAYMENT_METHOD_INVALID: طريقة الدفع غير مدعومة.';
  END IF;
  IF v_payment_method = 'deferred'
    AND p_amount_paid_at_receipt_in_minor_units > 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_deferred_payment_zero_check',
      MESSAGE = 'PHASE2_DEFERRED_PAYMENT_INVALID: الاستلام الآجل لا يقبل دفعة فورية.';
  END IF;
  IF v_payment_method IN ('cliq', 'bank_transfer')
    AND p_amount_paid_at_receipt_in_minor_units > 0
    AND v_payment_reference IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_reference_required_check',
      MESSAGE = 'PHASE2_PAYMENT_REFERENCE_REQUIRED: مرجع الدفعة الإلكترونية مطلوب.';
  END IF;
  v_canonical_lines := public.phase2_canonicalize_receipt_lines_internal(p_lines);

  v_canonical_request := jsonb_build_object(
    'contract_version', 2,
    'operation_type', 'supplier_receipt_v2',
    'supplier_id', LOWER(p_supplier_id::TEXT),
    'warehouse_id', LOWER(p_warehouse_id::TEXT),
    'branch_id', CASE WHEN p_branch_id IS NULL THEN NULL ELSE LOWER(p_branch_id::TEXT) END,
    'supplier_invoice_number', v_normalized_invoice,
    'supplier_invoice_date', p_supplier_invoice_date,
    'received_at', CASE WHEN p_received_at IS NULL THEN NULL ELSE TO_CHAR(p_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'header_discount_in_minor_units', p_header_discount_in_minor_units,
    'supplier_freight_in_minor_units', p_supplier_freight_in_minor_units,
    'legacy_tax_in_minor_units', p_legacy_tax_in_minor_units,
    'amount_paid_at_receipt_in_minor_units', p_amount_paid_at_receipt_in_minor_units,
    'payment_method', v_payment_method,
    'payment_reference', v_payment_reference,
    'notes', NULLIF(BTRIM(p_notes), ''),
    'internal_notes', NULLIF(BTRIM(p_internal_notes), ''),
    'lines', v_canonical_lines
  );
  v_fingerprint := public.phase2_request_fingerprint_internal(v_canonical_request);

  -- Legacy and V2 direct receipts share one normalized key lock. A historical
  -- legacy UUID has no trustworthy Phase-2 fingerprint, so V2 fails closed.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'supplier_receipt:' || v_key,
    0
  ));

  IF v_legacy_key IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.supplier_receipts receipt
      WHERE receipt.idempotency_key = v_legacy_key
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_operations operation
    WHERE operation.operation_type = 'supplier_receipt_v2'
      AND operation.idempotency_key = v_key
      AND operation.initiated_by IS DISTINCT FROM v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح الاستلام غير متاح لهذا المستخدم.';
  END IF;

  SELECT * INTO v_existing_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = 'supplier_receipt_v2'
    AND operation.initiated_by = v_user_id
    AND operation.idempotency_key = v_key;

  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS NULL
      OR v_existing_operation.result_snapshot IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: استُخدم المفتاح نفسه لطلب مختلف.';
    END IF;
    RETURN v_existing_operation.result_snapshot;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers supplier
    WHERE supplier.id = p_supplier_id AND supplier.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_SUPPLIER_INVALID: المورد غير موجود أو غير نشط.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses warehouse
    WHERE warehouse.id = p_warehouse_id AND warehouse.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_WAREHOUSE_INVALID: المستودع غير موجود أو غير نشط.';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches branch
    WHERE branch.id = p_branch_id AND branch.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_BRANCH_INVALID: الفرع غير موجود أو غير نشط.';
  END IF;

  PERFORM public.phase2_lock_payment_shift_internal(
    p_branch_id, v_payment_method, p_amount_paid_at_receipt_in_minor_units
  );
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT DISTINCT (component->>'product_id')::UUID
    FROM jsonb_array_elements(v_canonical_lines) line
    CROSS JOIN LATERAL jsonb_array_elements(line->'components') component
    ORDER BY (component->>'product_id')::UUID
  ));
  PERFORM public.phase2_validate_receipt_lines_internal(v_canonical_lines);

  SELECT
    COALESCE(SUM((line->>'gross_amount_in_minor_units')::NUMERIC), 0),
    COALESCE(SUM((line->>'line_discount_in_minor_units')::NUMERIC), 0)
  INTO v_merchandise_gross, v_line_discount_total
  FROM jsonb_array_elements(v_canonical_lines) line;
  v_line_net_total := v_merchandise_gross - v_line_discount_total;

  IF v_merchandise_gross > 9223372036854775807::NUMERIC
    OR v_line_discount_total > 9223372036854775807::NUMERIC
    OR v_line_net_total > 9223372036854775807::NUMERIC
  THEN
    RAISE EXCEPTION USING ERRCODE = '22003',
      MESSAGE = 'PHASE2_MONEY_OVERFLOW: إجمالي الفاتورة يتجاوز الحد المدعوم.';
  END IF;
  IF p_header_discount_in_minor_units > v_line_net_total THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_header_discount_total_check',
      MESSAGE = 'PHASE2_HEADER_DISCOUNT_EXCEEDS_NET: خصم رأس الفاتورة يتجاوز صافي البضاعة.';
  END IF;
  IF v_line_net_total = 0
    AND (p_header_discount_in_minor_units > 0 OR p_supplier_freight_in_minor_units > 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_zero_allocation_basis_check',
      MESSAGE = 'PHASE2_ZERO_ALLOCATION_BASIS: لا يمكن توزيع خصم أو شحن على أساس صفري.';
  END IF;

  v_acquisition_total := v_line_net_total
    - p_header_discount_in_minor_units::NUMERIC
    + p_supplier_freight_in_minor_units::NUMERIC;
  v_invoice_payable := v_acquisition_total + p_legacy_tax_in_minor_units::NUMERIC;
  IF v_acquisition_total > 9223372036854775807::NUMERIC
    OR v_invoice_payable > 9223372036854775807::NUMERIC
  THEN
    RAISE EXCEPTION USING ERRCODE = '22003',
      MESSAGE = 'PHASE2_MONEY_OVERFLOW: تكلفة الاستحواذ أو إجمالي الفاتورة يتجاوز الحد المدعوم.';
  END IF;
  IF p_amount_paid_at_receipt_in_minor_units::NUMERIC > v_invoice_payable THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_upper_bound_check',
      MESSAGE = 'PHASE2_PAYMENT_EXCEEDS_PAYABLE: الدفعة تتجاوز إجمالي فاتورة المورد.';
  END IF;
  v_outstanding := v_invoice_payable - p_amount_paid_at_receipt_in_minor_units::NUMERIC;

  IF v_normalized_invoice IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'supplier_invoice:' || p_supplier_id::TEXT || ':' || v_normalized_invoice,
      0
    ));
    IF EXISTS (
      SELECT 1 FROM public.supplier_financial_invoice_identities identity
      WHERE identity.supplier_id = p_supplier_id
        AND identity.normalized_invoice_number = v_normalized_invoice
        AND identity.is_active
    ) OR EXISTS (
      SELECT 1 FROM public.supplier_receipts receipt
      WHERE receipt.supplier_id = p_supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) OR EXISTS (
      SELECT 1 FROM public.purchase_receipts receipt
      WHERE receipt.supplier_id = p_supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        CONSTRAINT = 'uq_supplier_financial_invoice_active',
        MESSAGE = 'DUPLICATE_SUPPLIER_INVOICE: رقم فاتورة المورد مستخدم في سند مالي نشط.';
    END IF;
  END IF;

  v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-'
    || LPAD(NEXTVAL('public.supplier_receipt_seq')::TEXT, 6, '0');
  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operation_id', v_operation_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
    'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
    'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT
  );

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_operation_id, 'supplier_receipt_v2', v_key, v_fingerprint,
    v_user_id, v_result, NOW()
  );

  INSERT INTO public.supplier_receipts (
    id, receipt_number, supplier_id, warehouse_id, branch_id,
    supplier_invoice_number, supplier_invoice_date, received_at, received_by,
    subtotal_in_minor_units, discount_in_minor_units,
    delivery_fee_in_minor_units, tax_in_minor_units, total_in_minor_units,
    amount_paid_in_minor_units, amount_due_in_minor_units, payment_status,
    payment_method, payment_reference, notes, internal_notes, status,
    idempotency_key, operation_id, phase2_finalized_at,
    merchandise_gross_snapshot_in_minor_units,
    line_discount_total_snapshot_in_minor_units,
    header_discount_snapshot_in_minor_units,
    supplier_freight_snapshot_in_minor_units,
    legacy_tax_snapshot_in_minor_units,
    inventory_acquisition_cost_snapshot_in_minor_units,
    supplier_invoice_payable_total_snapshot_in_minor_units,
    amount_paid_at_receipt_snapshot_in_minor_units,
    supplier_outstanding_balance_effect_snapshot_in_minor_units
  ) VALUES (
    v_receipt_id, v_receipt_number, p_supplier_id, p_warehouse_id, p_branch_id,
    v_invoice_number, p_supplier_invoice_date, COALESCE(p_received_at, NOW()), v_user_id,
    v_line_net_total::BIGINT, p_header_discount_in_minor_units,
    p_supplier_freight_in_minor_units, p_legacy_tax_in_minor_units,
    v_invoice_payable::BIGINT, p_amount_paid_at_receipt_in_minor_units,
    v_outstanding::BIGINT,
    CASE WHEN v_outstanding = 0 THEN 'paid'
      WHEN p_amount_paid_at_receipt_in_minor_units > 0 THEN 'partially_paid'
      ELSE 'unpaid' END,
    v_payment_method, v_payment_reference,
    NULLIF(BTRIM(p_notes), ''), NULLIF(BTRIM(p_internal_notes), ''),
    'completed', NULL, v_operation_id, NOW(),
    v_merchandise_gross::BIGINT, v_line_discount_total::BIGINT,
    p_header_discount_in_minor_units, p_supplier_freight_in_minor_units,
    p_legacy_tax_in_minor_units, v_acquisition_total::BIGINT,
    v_invoice_payable::BIGINT, p_amount_paid_at_receipt_in_minor_units,
    v_outstanding::BIGINT
  );

  IF v_normalized_invoice IS NOT NULL THEN
    INSERT INTO public.supplier_financial_invoice_identities (
      supplier_id, normalized_invoice_number, operation_id, supplier_receipt_id
    ) VALUES (
      p_supplier_id, v_normalized_invoice, v_operation_id, v_receipt_id
    );
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'key', line->>'client_line_id',
    'weight', (
      (line->>'gross_amount_in_minor_units')::BIGINT
      - (line->>'line_discount_in_minor_units')::BIGINT
    )
  )) INTO v_line_weights
  FROM jsonb_array_elements(v_canonical_lines) line;

  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_header_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_header_discount_in_minor_units, v_line_weights
  );
  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_freight_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_supplier_freight_in_minor_units, v_line_weights
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_line_id := gen_random_uuid();
    v_client_line_id := (v_line->>'client_line_id')::UUID;
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_units_per_parcel := NULLIF(v_line->>'units_per_parcel', '')::INTEGER;
    v_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_discount := (v_line->>'line_discount_in_minor_units')::BIGINT;
    v_line_net := v_gross - v_line_discount;
    v_line_header_discount := COALESCE(
      (v_header_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_freight := COALESCE(
      (v_freight_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_acquisition := v_line_net - v_line_header_discount + v_line_freight;

    INSERT INTO public.supplier_receipt_commercial_lines (
      id, supplier_receipt_id, operation_id, line_sequence,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      configuration_revision, commercial_quantity, units_per_parcel_snapshot,
      base_unit_name_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units, discount_snapshot_in_minor_units,
      line_total_snapshot_in_minor_units, client_line_id,
      received_parcel_quantity, received_base_unit_quantity,
      allocated_header_discount_in_minor_units,
      allocated_supplier_freight_in_minor_units,
      final_acquisition_amount_in_minor_units, finalized_at
    ) VALUES (
      v_line_id, v_receipt_id, v_operation_id, v_line_sequence,
      v_line_kind,
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_commercial_quantity, v_units_per_parcel,
      v_line->>'base_unit_name', NULLIF(v_line->>'parcel_unit_name', ''),
      v_gross, v_line_discount, v_line_net, v_client_line_id,
      CASE WHEN v_line_kind = 'configurable_parcel' THEN v_commercial_quantity END,
      (SELECT SUM((component->>'base_quantity')::INTEGER)
       FROM jsonb_array_elements(v_line->'components') component),
      v_line_header_discount, v_line_freight, v_line_acquisition, NOW()
    );

    SELECT jsonb_agg(jsonb_build_object(
      'key', component->>'product_id',
      'weight', CASE
        WHEN component->>'explicit_merchandise_cost_in_minor_units' IS NULL
          THEN (component->>'base_quantity')::BIGINT
        ELSE (component->>'explicit_merchandise_cost_in_minor_units')::BIGINT
      END
    )) INTO v_component_weights
    FROM jsonb_array_elements(v_line->'components') component;

    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_merchandise_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_net, v_component_weights
    );
    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_final_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_acquisition, v_component_weights
    );

    FOR v_component IN SELECT * FROM jsonb_array_elements(v_line->'components')
    LOOP
      v_item_id := gen_random_uuid();
      v_product_id := (v_component->>'product_id')::UUID;
      v_base_quantity := (v_component->>'base_quantity')::INTEGER;
      v_component_merchandise :=
        (v_component_merchandise_allocations->>v_product_id::TEXT)::BIGINT;
      v_component_acquisition :=
        (v_component_final_allocations->>v_product_id::TEXT)::BIGINT;

      SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
      SELECT unit.name_ar INTO v_purchase_unit_name
      FROM public.units unit WHERE unit.id = v_product.purchase_unit_id;
      SELECT unit.name_ar INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;

      INSERT INTO public.supplier_receipt_items (
        id, supplier_receipt_id, product_id, purchase_unit_id, base_unit_id,
        purchase_unit_name, base_unit_name, package_quantity,
        units_per_package, total_base_units, package_price_in_minor_units,
        base_unit_cost_in_minor_units, discount_in_minor_units,
        line_total_in_minor_units, batch_number, production_date, expiry_date,
        notes, selling_price_in_minor_units, commercial_line_id, operation_id,
        merchandise_net_cost_in_minor_units, allocated_cost_in_minor_units,
        exact_unit_cost_in_minor_units
      ) VALUES (
        v_item_id, v_receipt_id, v_product_id,
        v_product.purchase_unit_id, v_product.unit_id,
        COALESCE(v_purchase_unit_name, v_line->>'base_unit_name'),
        COALESCE(v_base_unit_name, v_line->>'base_unit_name'),
        v_base_quantity, 1, v_base_quantity,
        ROUND(v_component_merchandise::NUMERIC / v_base_quantity)::BIGINT,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity)::BIGINT,
        0, v_component_merchandise,
        NULLIF(v_component->>'batch_number', ''),
        NULLIF(v_component->>'production_date', '')::DATE,
        NULLIF(v_component->>'expiry_date', '')::DATE,
        NULLIF(v_component->>'notes', ''),
        0, v_line_id, v_operation_id,
        v_component_merchandise, v_component_acquisition,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity, 6)
      );

      v_inventory_components := v_inventory_components || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'client_line_id', v_client_line_id,
          'product_id', v_product_id,
          'base_quantity', v_base_quantity,
          'allocated_cost_in_minor_units', v_component_acquisition
        )
      );
    END LOOP;
  END LOOP;

  v_wac_results := public.phase2_apply_inventory_and_wac_internal(
    v_operation_id,
    p_warehouse_id,
    'supplier_receipt',
    v_receipt_id,
    v_inventory_components,
    v_user_id,
    'استلام مورد Phase 2 - ' || v_receipt_number
  );

  UPDATE public.suppliers
  SET current_balance_in_minor_units =
      current_balance_in_minor_units + v_outstanding::BIGINT,
    updated_at = NOW()
  WHERE id = p_supplier_id;

  IF p_amount_paid_at_receipt_in_minor_units > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id, supplier_receipt_id, amount_in_minor_units,
      payment_method, reference_number, payment_date, notes,
      created_by, operation_id
    ) VALUES (
      p_supplier_id, v_receipt_id, p_amount_paid_at_receipt_in_minor_units,
      v_payment_method, v_payment_reference, COALESCE(p_received_at, NOW()),
      'دفعة عند استلام السند ' || v_receipt_number,
      v_user_id, v_operation_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'CREATE_DIRECT_SUPPLIER_RECEIPT_V2',
    'supplier_receipts',
    v_receipt_id,
    jsonb_build_object(
      'operation_id', v_operation_id,
      'receipt_number', v_receipt_number,
      'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
      'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
      'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT,
      'wac', v_wac_results
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_direct_supplier_receipt_v2(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_supplier_receipt_v2(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;

CREATE FUNCTION public.create_purchase_order_v2(
  p_supplier_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_expected_delivery_date TIMESTAMPTZ DEFAULT NULL,
  p_expected_header_discount_in_minor_units BIGINT DEFAULT 0,
  p_expected_supplier_freight_in_minor_units BIGINT DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_canonical_lines JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_existing_operation public.business_operations%ROWTYPE;
  v_operation_id UUID := gen_random_uuid();
  v_purchase_order_id UUID := gen_random_uuid();
  v_purchase_order_number TEXT;
  v_result JSONB;
  v_line JSONB;
  v_component JSONB;
  v_po_item_id UUID;
  v_line_kind TEXT;
  v_commercial_quantity INTEGER;
  v_units_per_parcel INTEGER;
  v_ordered_base_quantity INTEGER;
  v_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_net_total NUMERIC;
  v_total NUMERIC;
  v_product_id UUID;
  v_product public.products%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إنشاء أمر شراء - نموذج الطرود'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'PHASE2_AUTH_REQUIRED: يجب تسجيل الدخول.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_IDEMPOTENCY_KEY_INVALID: مفتاح منع التكرار غير صالح.';
  END IF;
  IF p_expected_header_discount_in_minor_units < 0
    OR p_expected_supplier_freight_in_minor_units < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_FINANCIAL_VALUE_INVALID: قيم أمر الشراء لا يمكن أن تكون سالبة.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers supplier
    WHERE supplier.id = p_supplier_id AND supplier.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_SUPPLIER_INVALID: المورد غير موجود أو غير نشط.';
  END IF;
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses warehouse
    WHERE warehouse.id = p_warehouse_id AND warehouse.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_WAREHOUSE_INVALID: المستودع غير موجود أو غير نشط.';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches branch
    WHERE branch.id = p_branch_id AND branch.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_BRANCH_INVALID: الفرع غير موجود أو غير نشط.';
  END IF;

  v_canonical_lines := public.phase2_canonicalize_receipt_lines_internal(p_lines);
  PERFORM public.phase2_validate_receipt_lines_internal(v_canonical_lines);
  SELECT COALESCE(SUM(
    (line->>'gross_amount_in_minor_units')::NUMERIC
    - (line->>'line_discount_in_minor_units')::NUMERIC
  ), 0)
  INTO v_line_net_total
  FROM jsonb_array_elements(v_canonical_lines) line;

  IF p_expected_header_discount_in_minor_units > v_line_net_total THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_purchase_order_header_discount_check',
      MESSAGE = 'PHASE2_HEADER_DISCOUNT_EXCEEDS_NET: الخصم المتوقع يتجاوز صافي أمر الشراء.';
  END IF;
  IF v_line_net_total = 0
    AND (p_expected_header_discount_in_minor_units > 0
      OR p_expected_supplier_freight_in_minor_units > 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_purchase_order_zero_basis_check',
      MESSAGE = 'PHASE2_ZERO_ALLOCATION_BASIS: لا يمكن وضع خصم أو شحن متوقع على أساس صفري.';
  END IF;
  v_total := v_line_net_total
    - p_expected_header_discount_in_minor_units::NUMERIC
    + p_expected_supplier_freight_in_minor_units::NUMERIC;
  IF v_line_net_total > 9223372036854775807::NUMERIC
    OR v_total > 9223372036854775807::NUMERIC
  THEN
    RAISE EXCEPTION USING ERRCODE = '22003',
      MESSAGE = 'PHASE2_MONEY_OVERFLOW: قيمة أمر الشراء تتجاوز الحد المدعوم.';
  END IF;

  v_canonical_request := jsonb_build_object(
    'contract_version', 2,
    'operation_type', 'purchase_order_v2',
    'supplier_id', LOWER(p_supplier_id::TEXT),
    'branch_id', CASE WHEN p_branch_id IS NULL THEN NULL ELSE LOWER(p_branch_id::TEXT) END,
    'warehouse_id', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE LOWER(p_warehouse_id::TEXT) END,
    'expected_delivery_date', CASE WHEN p_expected_delivery_date IS NULL THEN NULL ELSE TO_CHAR(p_expected_delivery_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'expected_header_discount_in_minor_units', p_expected_header_discount_in_minor_units,
    'expected_supplier_freight_in_minor_units', p_expected_supplier_freight_in_minor_units,
    'notes', NULLIF(BTRIM(p_notes), ''),
    'internal_notes', NULLIF(BTRIM(p_internal_notes), ''),
    'lines', v_canonical_lines
  );
  v_fingerprint := public.phase2_request_fingerprint_internal(v_canonical_request);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'purchase_order_v2:' || v_user_id::TEXT || ':' || v_key, 0
  ));
  SELECT * INTO v_existing_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = 'purchase_order_v2'
    AND operation.initiated_by = v_user_id
    AND operation.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS NULL
      OR v_existing_operation.result_snapshot IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: استُخدم المفتاح نفسه لطلب مختلف.';
    END IF;
    RETURN v_existing_operation.result_snapshot;
  END IF;

  LOOP
    v_purchase_order_number := 'PO-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(FLOOR(100000 + RANDOM() * 900000)::BIGINT::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_orders purchase_order
      WHERE purchase_order.purchase_order_number = v_purchase_order_number
    );
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operation_id', v_operation_id,
    'purchase_order_id', v_purchase_order_id,
    'purchase_order_number', v_purchase_order_number,
    'expected_total_in_minor_units', v_total::BIGINT
  );
  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_operation_id, 'purchase_order_v2', v_key, v_fingerprint,
    v_user_id, v_result, NOW()
  );
  INSERT INTO public.purchase_orders (
    id, purchase_order_number, supplier_id, branch_id, warehouse_id,
    status, order_date, expected_delivery_date, subtotal_in_minor_units,
    discount_in_minor_units, delivery_fee_in_minor_units,
    total_in_minor_units, amount_paid_in_minor_units,
    notes, internal_notes, created_by, operation_id
  ) VALUES (
    v_purchase_order_id, v_purchase_order_number, p_supplier_id,
    p_branch_id, p_warehouse_id, 'draft', NOW(), p_expected_delivery_date,
    v_line_net_total::BIGINT, p_expected_header_discount_in_minor_units,
    p_expected_supplier_freight_in_minor_units, v_total::BIGINT, 0,
    NULLIF(BTRIM(p_notes), ''), NULLIF(BTRIM(p_internal_notes), ''),
    v_user_id, v_operation_id
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_po_item_id := gen_random_uuid();
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_units_per_parcel := NULLIF(v_line->>'units_per_parcel', '')::INTEGER;
    v_ordered_base_quantity := (
      SELECT SUM((component->>'base_quantity')::INTEGER)
      FROM jsonb_array_elements(v_line->'components') component
    );
    v_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_discount := (v_line->>'line_discount_in_minor_units')::BIGINT;
    v_line_net := v_gross - v_line_discount;
    IF v_line_kind = 'base_unit' THEN
      v_product_id := (v_line->'components'->0->>'product_id')::UUID;
    ELSE
      v_product_id := (v_line->>'family_product_id')::UUID;
    END IF;

    INSERT INTO public.purchase_order_items (
      id, purchase_order_id, product_id, ordered_quantity,
      received_quantity, purchase_price_in_minor_units,
      discount_in_minor_units, line_total_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      configuration_revision, base_unit_name_snapshot,
      parcel_unit_name_snapshot, parcel_quantity, client_line_id,
      units_per_parcel_snapshot, received_parcel_quantity,
      commercial_quantity_snapshot, gross_amount_snapshot_in_minor_units,
      line_discount_snapshot_in_minor_units, line_net_snapshot_in_minor_units
    ) VALUES (
      v_po_item_id, v_purchase_order_id, v_product_id,
      v_ordered_base_quantity, 0,
      ROUND(v_gross::NUMERIC / v_ordered_base_quantity)::BIGINT,
      v_line_discount, v_line_net, v_line_kind,
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name', NULLIF(v_line->>'parcel_unit_name', ''),
      CASE WHEN v_line_kind = 'configurable_parcel' THEN v_commercial_quantity END,
      (v_line->>'client_line_id')::UUID, v_units_per_parcel, 0,
      v_commercial_quantity, v_gross, v_line_discount, v_line_net
    );

    FOR v_component IN SELECT * FROM jsonb_array_elements(v_line->'components')
    LOOP
      v_product_id := (v_component->>'product_id')::UUID;
      SELECT * INTO v_product FROM public.products WHERE id = v_product_id;
      INSERT INTO public.purchase_order_item_components (
        purchase_order_item_id, product_id, expected_base_quantity,
        product_name_snapshot, sku_snapshot
      ) VALUES (
        v_po_item_id, v_product_id,
        (v_component->>'base_quantity')::INTEGER,
        v_product.name_ar, v_product.sku
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CREATE_PURCHASE_ORDER_V2', 'purchase_orders',
    v_purchase_order_id,
    jsonb_build_object(
      'operation_id', v_operation_id,
      'purchase_order_number', v_purchase_order_number,
      'expected_total_in_minor_units', v_total::BIGINT
    )
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order_v2(
  UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_v2(
  UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;

CREATE FUNCTION public.receive_purchase_order_v2(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_header_discount_in_minor_units BIGINT DEFAULT 0,
  p_supplier_freight_in_minor_units BIGINT DEFAULT 0,
  p_legacy_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_at_receipt_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_lines JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_invoice_number TEXT := NULLIF(BTRIM(p_supplier_invoice_number), '');
  v_normalized_invoice TEXT := LOWER(NULLIF(BTRIM(p_supplier_invoice_number), ''));
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_payment_reference TEXT := NULLIF(BTRIM(p_payment_reference), '');
  v_po public.purchase_orders%ROWTYPE;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_target_warehouse_id UUID;
  v_canonical_lines JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_existing_operation public.business_operations%ROWTYPE;
  v_operation_id UUID := gen_random_uuid();
  v_receipt_id UUID := gen_random_uuid();
  v_receipt_number TEXT;
  v_result JSONB;
  v_line_weights JSONB;
  v_header_allocations JSONB;
  v_freight_allocations JSONB;
  v_component_weights JSONB;
  v_component_merchandise_allocations JSONB;
  v_component_final_allocations JSONB;
  v_inventory_components JSONB := '[]'::JSONB;
  v_wac_results JSONB;
  v_line JSONB;
  v_component JSONB;
  v_line_id UUID;
  v_item_id UUID;
  v_line_sequence INTEGER := 0;
  v_po_item_id UUID;
  v_line_kind TEXT;
  v_client_line_id UUID;
  v_commercial_quantity INTEGER;
  v_units_per_parcel INTEGER;
  v_received_base_quantity INTEGER;
  v_base_quantity INTEGER;
  v_product_id UUID;
  v_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_header_discount BIGINT;
  v_line_freight BIGINT;
  v_line_acquisition BIGINT;
  v_component_merchandise BIGINT;
  v_component_acquisition BIGINT;
  v_merchandise_gross NUMERIC := 0;
  v_line_discount_total NUMERIC := 0;
  v_line_net_total NUMERIC := 0;
  v_acquisition_total NUMERIC;
  v_invoice_payable NUMERIC;
  v_outstanding NUMERIC;
  v_all_completed BOOLEAN;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام أمر شراء - نموذج الطرود'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'PHASE2_AUTH_REQUIRED: يجب تسجيل الدخول.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_IDEMPOTENCY_KEY_INVALID: مفتاح منع التكرار غير صالح.';
  END IF;
  IF p_header_discount_in_minor_units < 0
    OR p_supplier_freight_in_minor_units < 0
    OR p_legacy_tax_in_minor_units < 0
    OR p_amount_paid_at_receipt_in_minor_units < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_FINANCIAL_VALUE_INVALID: القيم المالية لا يمكن أن تكون سالبة.';
  END IF;
  IF v_payment_method NOT IN ('cash', 'cliq', 'bank_transfer', 'deferred') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PAYMENT_METHOD_INVALID: طريقة الدفع غير مدعومة.';
  END IF;
  IF v_payment_method = 'deferred'
    AND p_amount_paid_at_receipt_in_minor_units > 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_deferred_payment_zero_check',
      MESSAGE = 'PHASE2_DEFERRED_PAYMENT_INVALID: الاستلام الآجل لا يقبل دفعة فورية.';
  END IF;
  IF v_payment_method IN ('cliq', 'bank_transfer')
    AND p_amount_paid_at_receipt_in_minor_units > 0
    AND v_payment_reference IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_reference_required_check',
      MESSAGE = 'PHASE2_PAYMENT_REFERENCE_REQUIRED: مرجع الدفعة الإلكترونية مطلوب.';
  END IF;

  v_canonical_lines := public.phase2_canonicalize_receipt_lines_internal(p_lines);

  v_canonical_request := jsonb_build_object(
    'contract_version', 2,
    'operation_type', 'purchase_order_receipt_v2',
    'purchase_order_id', LOWER(p_purchase_order_id::TEXT),
    'warehouse_id', CASE WHEN p_warehouse_id IS NULL THEN NULL ELSE LOWER(p_warehouse_id::TEXT) END,
    'supplier_invoice_number', v_normalized_invoice,
    'supplier_invoice_date', p_supplier_invoice_date,
    'received_at', CASE WHEN p_received_at IS NULL THEN NULL ELSE TO_CHAR(p_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'header_discount_in_minor_units', p_header_discount_in_minor_units,
    'supplier_freight_in_minor_units', p_supplier_freight_in_minor_units,
    'legacy_tax_in_minor_units', p_legacy_tax_in_minor_units,
    'amount_paid_at_receipt_in_minor_units', p_amount_paid_at_receipt_in_minor_units,
    'payment_method', v_payment_method,
    'payment_reference', v_payment_reference,
    'supplier_delivery_note', NULLIF(BTRIM(p_supplier_delivery_note), ''),
    'notes', NULLIF(BTRIM(p_notes), ''),
    'lines', v_canonical_lines
  );
  v_fingerprint := public.phase2_request_fingerprint_internal(v_canonical_request);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'purchase_order_receipt_v2:' || v_user_id::TEXT || ':' || v_key, 0
  ));
  SELECT * INTO v_existing_operation
  FROM public.business_operations operation
  WHERE operation.operation_type = 'purchase_order_receipt_v2'
    AND operation.initiated_by = v_user_id
    AND operation.idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing_operation.request_fingerprint IS NULL
      OR v_existing_operation.result_snapshot IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: استُخدم المفتاح نفسه لطلب مختلف.';
    END IF;
    RETURN v_existing_operation.result_snapshot;
  END IF;

  PERFORM public.phase2_lock_payment_shift_internal(
    (SELECT branch_id FROM public.purchase_orders WHERE id = p_purchase_order_id),
    v_payment_method, p_amount_paid_at_receipt_in_minor_units
  );
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT DISTINCT (component->>'product_id')::UUID
    FROM jsonb_array_elements(v_canonical_lines) line
    CROSS JOIN LATERAL jsonb_array_elements(line->'components') component
    ORDER BY (component->>'product_id')::UUID
  ));
  PERFORM public.phase2_validate_receipt_lines_internal(v_canonical_lines);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_canonical_lines) line
    WHERE line->>'purchase_order_item_id' IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_PO_ITEM_ID_REQUIRED: كل سطر استلام يجب أن يرتبط بسطر أمر شراء.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_canonical_lines) line
    GROUP BY (line->>'purchase_order_item_id')::UUID
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      CONSTRAINT = 'phase2_purchase_receipt_po_item_unique',
      MESSAGE = 'PHASE2_DUPLICATE_PO_ITEM: لا يجوز تكرار سطر أمر الشراء داخل نفس سند الاستلام.';
  END IF;

  SELECT
    COALESCE(SUM((line->>'gross_amount_in_minor_units')::NUMERIC), 0),
    COALESCE(SUM((line->>'line_discount_in_minor_units')::NUMERIC), 0)
  INTO v_merchandise_gross, v_line_discount_total
  FROM jsonb_array_elements(v_canonical_lines) line;
  v_line_net_total := v_merchandise_gross - v_line_discount_total;
  IF p_header_discount_in_minor_units > v_line_net_total THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_header_discount_total_check',
      MESSAGE = 'PHASE2_HEADER_DISCOUNT_EXCEEDS_NET: خصم رأس الفاتورة يتجاوز صافي البضاعة.';
  END IF;
  IF v_line_net_total = 0
    AND (p_header_discount_in_minor_units > 0 OR p_supplier_freight_in_minor_units > 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_zero_allocation_basis_check',
      MESSAGE = 'PHASE2_ZERO_ALLOCATION_BASIS: لا يمكن توزيع خصم أو شحن على أساس صفري.';
  END IF;
  v_acquisition_total := v_line_net_total
    - p_header_discount_in_minor_units::NUMERIC
    + p_supplier_freight_in_minor_units::NUMERIC;
  v_invoice_payable := v_acquisition_total + p_legacy_tax_in_minor_units::NUMERIC;
  IF v_merchandise_gross > 9223372036854775807::NUMERIC
    OR v_line_discount_total > 9223372036854775807::NUMERIC
    OR v_line_net_total > 9223372036854775807::NUMERIC
    OR v_acquisition_total > 9223372036854775807::NUMERIC
    OR v_invoice_payable > 9223372036854775807::NUMERIC
  THEN
    RAISE EXCEPTION USING ERRCODE = '22003',
      MESSAGE = 'PHASE2_MONEY_OVERFLOW: قيمة الاستلام تتجاوز الحد المدعوم.';
  END IF;
  IF p_amount_paid_at_receipt_in_minor_units::NUMERIC > v_invoice_payable THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_payment_upper_bound_check',
      MESSAGE = 'PHASE2_PAYMENT_EXCEEDS_PAYABLE: الدفعة تتجاوز إجمالي فاتورة المورد.';
  END IF;
  v_outstanding := v_invoice_payable - p_amount_paid_at_receipt_in_minor_units::NUMERIC;

  SELECT * INTO v_po
  FROM public.purchase_orders purchase_order
  WHERE purchase_order.id = p_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PHASE2_PURCHASE_ORDER_NOT_FOUND: أمر الشراء غير موجود.';
  END IF;
  IF v_po.status NOT IN ('approved', 'partially_received') THEN
    RAISE EXCEPTION 'PHASE2_PURCHASE_ORDER_STATUS_INVALID: أمر الشراء غير جاهز للاستلام.';
  END IF;
  IF v_po.amount_paid_in_minor_units <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'AMBIGUOUS_PREPAID_PO: لا يمكن توزيع دفعة قديمة لأمر الشراء على سند الاستلام دون سياسة معتمدة.';
  END IF;

  v_target_warehouse_id := COALESCE(p_warehouse_id, v_po.warehouse_id);
  IF v_target_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses warehouse
    WHERE warehouse.id = v_target_warehouse_id AND warehouse.is_active
  ) THEN
    RAISE EXCEPTION 'PHASE2_WAREHOUSE_INVALID: المستودع غير موجود أو غير نشط.';
  END IF;

  PERFORM item.id
  FROM public.purchase_order_items item
  JOIN (
    SELECT DISTINCT (line->>'purchase_order_item_id')::UUID AS item_id
    FROM jsonb_array_elements(v_canonical_lines) line
  ) input_item ON input_item.item_id = item.id
  WHERE item.purchase_order_id = p_purchase_order_id
  ORDER BY item.id
  FOR UPDATE OF item;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_po_item_id := (v_line->>'purchase_order_item_id')::UUID;
    SELECT * INTO v_po_item
    FROM public.purchase_order_items item
    WHERE item.id = v_po_item_id
      AND item.purchase_order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PHASE2_PO_ITEM_NOT_FOUND: سطر أمر الشراء غير موجود.';
    END IF;
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_received_base_quantity := (
      SELECT SUM((component->>'base_quantity')::INTEGER)
      FROM jsonb_array_elements(v_line->'components') component
    );
    IF v_line_kind IS DISTINCT FROM v_po_item.commercial_line_kind THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'phase2_purchase_receipt_line_kind_check',
        MESSAGE = 'PHASE2_PO_LINE_KIND_MISMATCH: نوع الاستلام لا يطابق سطر أمر الشراء.';
    END IF;
    IF v_line_kind = 'base_unit' THEN
      IF (v_line->'components'->0->>'product_id')::UUID
          IS DISTINCT FROM v_po_item.product_id
        OR v_received_base_quantity > v_po_item.ordered_quantity - v_po_item.received_quantity
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'phase2_purchase_receipt_base_quantity_check',
          MESSAGE = 'PHASE2_PO_BASE_RECEIPT_INVALID: المنتج أو الكمية يتجاوزان المتبقي في أمر الشراء.';
      END IF;
    ELSE
      IF NULLIF(v_line->>'family_product_id', '')::UUID
          IS DISTINCT FROM v_po_item.family_product_id
        OR NULLIF(v_line->>'parcel_configuration_id', '')::UUID
          IS DISTINCT FROM v_po_item.parcel_configuration_id
        OR NULLIF(v_line->>'configuration_revision', '')::INTEGER
          IS DISTINCT FROM v_po_item.configuration_revision
        OR NULLIF(v_line->>'units_per_parcel', '')::INTEGER
          IS DISTINCT FROM v_po_item.units_per_parcel_snapshot
        OR v_commercial_quantity
          > v_po_item.parcel_quantity - v_po_item.received_parcel_quantity
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'phase2_purchase_receipt_parcel_quantity_check',
          MESSAGE = 'PHASE2_PO_PARCEL_RECEIPT_INVALID: هوية الطرد أو كميته تتجاوز المتبقي في أمر الشراء.';
      END IF;
    END IF;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1
    FROM public.purchase_order_items item
    LEFT JOIN LATERAL (
      SELECT
        SUM((component->>'base_quantity')::INTEGER)::INTEGER AS received_base,
        CASE WHEN line->>'line_kind' = 'configurable_parcel'
          THEN (line->>'commercial_quantity')::INTEGER ELSE 0 END AS received_parcels
      FROM jsonb_array_elements(v_canonical_lines) line
      CROSS JOIN LATERAL jsonb_array_elements(line->'components') component
      WHERE (line->>'purchase_order_item_id')::UUID = item.id
      GROUP BY line
    ) incoming ON true
    WHERE item.purchase_order_id = p_purchase_order_id
      AND (
        item.received_quantity + COALESCE(incoming.received_base, 0)
          < item.ordered_quantity
        OR (item.commercial_line_kind = 'configurable_parcel'
          AND item.received_parcel_quantity
            + COALESCE(incoming.received_parcels, 0) < item.parcel_quantity)
      )
  ) INTO v_all_completed;

  IF v_normalized_invoice IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'supplier_invoice:' || v_po.supplier_id::TEXT || ':' || v_normalized_invoice,
      0
    ));
    IF EXISTS (
      SELECT 1 FROM public.supplier_financial_invoice_identities identity
      WHERE identity.supplier_id = v_po.supplier_id
        AND identity.normalized_invoice_number = v_normalized_invoice
        AND identity.is_active
    ) OR EXISTS (
      SELECT 1 FROM public.supplier_receipts receipt
      WHERE receipt.supplier_id = v_po.supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) OR EXISTS (
      SELECT 1 FROM public.purchase_receipts receipt
      WHERE receipt.supplier_id = v_po.supplier_id
        AND LOWER(BTRIM(receipt.supplier_invoice_number)) = v_normalized_invoice
        AND receipt.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505',
        CONSTRAINT = 'uq_supplier_financial_invoice_active',
        MESSAGE = 'DUPLICATE_SUPPLIER_INVOICE: رقم فاتورة المورد مستخدم في سند مالي نشط.';
    END IF;
  END IF;

  LOOP
    v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(FLOOR(100000 + RANDOM() * 900000)::BIGINT::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.purchase_receipts receipt
      WHERE receipt.receipt_number = v_receipt_number
    );
  END LOOP;

  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operation_id', v_operation_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'purchase_order_id', p_purchase_order_id,
    'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
    'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
    'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT,
    'is_fully_received', v_all_completed,
    'new_status', CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END
  );
  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_operation_id, 'purchase_order_receipt_v2', v_key, v_fingerprint,
    v_user_id, v_result, NOW()
  );
  INSERT INTO public.purchase_receipts (
    id, receipt_number, purchase_order_id, supplier_id, warehouse_id,
    received_by, received_at, supplier_delivery_note, notes, operation_id,
    status, supplier_invoice_number, supplier_invoice_date,
    merchandise_gross_snapshot_in_minor_units,
    line_discount_total_snapshot_in_minor_units,
    header_discount_snapshot_in_minor_units,
    supplier_freight_snapshot_in_minor_units,
    legacy_tax_snapshot_in_minor_units,
    inventory_acquisition_cost_snapshot_in_minor_units,
    supplier_invoice_payable_total_snapshot_in_minor_units,
    amount_paid_at_receipt_snapshot_in_minor_units,
    supplier_outstanding_balance_effect_snapshot_in_minor_units,
    payment_method, payment_reference, phase2_finalized_at
  ) VALUES (
    v_receipt_id, v_receipt_number, p_purchase_order_id, v_po.supplier_id,
    v_target_warehouse_id, v_user_id, COALESCE(p_received_at, NOW()),
    NULLIF(BTRIM(p_supplier_delivery_note), ''), NULLIF(BTRIM(p_notes), ''),
    v_operation_id, 'completed', v_invoice_number, p_supplier_invoice_date,
    v_merchandise_gross::BIGINT, v_line_discount_total::BIGINT,
    p_header_discount_in_minor_units, p_supplier_freight_in_minor_units,
    p_legacy_tax_in_minor_units, v_acquisition_total::BIGINT,
    v_invoice_payable::BIGINT, p_amount_paid_at_receipt_in_minor_units,
    v_outstanding::BIGINT, v_payment_method, v_payment_reference, NOW()
  );

  IF v_normalized_invoice IS NOT NULL THEN
    INSERT INTO public.supplier_financial_invoice_identities (
      supplier_id, normalized_invoice_number, operation_id, purchase_receipt_id
    ) VALUES (
      v_po.supplier_id, v_normalized_invoice, v_operation_id, v_receipt_id
    );
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'key', line->>'client_line_id',
    'weight', (
      (line->>'gross_amount_in_minor_units')::BIGINT
      - (line->>'line_discount_in_minor_units')::BIGINT
    )
  )) INTO v_line_weights
  FROM jsonb_array_elements(v_canonical_lines) line;
  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_header_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_header_discount_in_minor_units, v_line_weights
  );
  SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
  INTO v_freight_allocations
  FROM public.phase2_allocate_largest_remainder_internal(
    p_supplier_freight_in_minor_units, v_line_weights
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines)
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_line_id := gen_random_uuid();
    v_client_line_id := (v_line->>'client_line_id')::UUID;
    v_po_item_id := (v_line->>'purchase_order_item_id')::UUID;
    v_line_kind := v_line->>'line_kind';
    v_commercial_quantity := (v_line->>'commercial_quantity')::INTEGER;
    v_units_per_parcel := NULLIF(v_line->>'units_per_parcel', '')::INTEGER;
    v_received_base_quantity := (
      SELECT SUM((component->>'base_quantity')::INTEGER)
      FROM jsonb_array_elements(v_line->'components') component
    );
    v_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_discount := (v_line->>'line_discount_in_minor_units')::BIGINT;
    v_line_net := v_gross - v_line_discount;
    v_line_header_discount := COALESCE(
      (v_header_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_freight := COALESCE(
      (v_freight_allocations->>v_client_line_id::TEXT)::BIGINT, 0
    );
    v_line_acquisition := v_line_net - v_line_header_discount + v_line_freight;

    INSERT INTO public.purchase_receipt_commercial_lines (
      id, purchase_receipt_id, purchase_order_id, purchase_order_item_id,
      operation_id, client_line_id, line_sequence, commercial_line_kind,
      family_product_id, parcel_configuration_id, configuration_revision,
      received_commercial_quantity, received_parcel_quantity,
      received_base_unit_quantity, units_per_parcel_snapshot,
      base_unit_name_snapshot, parcel_unit_name_snapshot,
      gross_amount_snapshot_in_minor_units,
      line_discount_snapshot_in_minor_units,
      line_net_merchandise_snapshot_in_minor_units,
      allocated_header_discount_in_minor_units,
      allocated_supplier_freight_in_minor_units,
      final_acquisition_amount_in_minor_units, finalized_at
    ) VALUES (
      v_line_id, v_receipt_id, p_purchase_order_id, v_po_item_id,
      v_operation_id, v_client_line_id, v_line_sequence, v_line_kind,
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_commercial_quantity,
      CASE WHEN v_line_kind = 'configurable_parcel' THEN v_commercial_quantity END,
      v_received_base_quantity, v_units_per_parcel,
      v_line->>'base_unit_name', NULLIF(v_line->>'parcel_unit_name', ''),
      v_gross, v_line_discount, v_line_net,
      v_line_header_discount, v_line_freight, v_line_acquisition, NOW()
    );

    SELECT jsonb_agg(jsonb_build_object(
      'key', component->>'product_id',
      'weight', CASE
        WHEN component->>'explicit_merchandise_cost_in_minor_units' IS NULL
          THEN (component->>'base_quantity')::BIGINT
        ELSE (component->>'explicit_merchandise_cost_in_minor_units')::BIGINT
      END
    )) INTO v_component_weights
    FROM jsonb_array_elements(v_line->'components') component;
    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_merchandise_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_net, v_component_weights
    );
    SELECT COALESCE(jsonb_object_agg(allocation_key, allocated_amount), '{}'::JSONB)
    INTO v_component_final_allocations
    FROM public.phase2_allocate_largest_remainder_internal(
      v_line_acquisition, v_component_weights
    );

    FOR v_component IN SELECT * FROM jsonb_array_elements(v_line->'components')
    LOOP
      v_item_id := gen_random_uuid();
      v_product_id := (v_component->>'product_id')::UUID;
      v_base_quantity := (v_component->>'base_quantity')::INTEGER;
      v_component_merchandise :=
        (v_component_merchandise_allocations->>v_product_id::TEXT)::BIGINT;
      v_component_acquisition :=
        (v_component_final_allocations->>v_product_id::TEXT)::BIGINT;

      INSERT INTO public.purchase_receipt_items (
        id, purchase_receipt_id, purchase_order_item_id, product_id,
        received_quantity, unit_cost_in_minor_units, operation_id,
        allocated_cost_in_minor_units, exact_unit_cost_in_minor_units,
        commercial_line_id, merchandise_net_cost_in_minor_units
      ) VALUES (
        v_item_id, v_receipt_id, v_po_item_id, v_product_id,
        v_base_quantity,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity)::BIGINT,
        v_operation_id, v_component_acquisition,
        ROUND(v_component_acquisition::NUMERIC / v_base_quantity, 6),
        v_line_id, v_component_merchandise
      );
      v_inventory_components := v_inventory_components || jsonb_build_array(
        jsonb_build_object(
          'item_id', v_item_id,
          'client_line_id', v_client_line_id,
          'product_id', v_product_id,
          'base_quantity', v_base_quantity,
          'allocated_cost_in_minor_units', v_component_acquisition
        )
      );
    END LOOP;

    UPDATE public.purchase_order_items
    SET
      received_quantity = received_quantity + v_received_base_quantity,
      received_parcel_quantity = received_parcel_quantity
        + CASE WHEN v_line_kind = 'configurable_parcel'
            THEN v_commercial_quantity ELSE 0 END,
      updated_at = NOW()
    WHERE id = v_po_item_id;
  END LOOP;

  v_wac_results := public.phase2_apply_inventory_and_wac_internal(
    v_operation_id,
    v_target_warehouse_id,
    'purchase_receipt',
    v_receipt_id,
    v_inventory_components,
    v_user_id,
    'استلام أمر شراء Phase 2 - ' || v_receipt_number
  );

  UPDATE public.suppliers
  SET current_balance_in_minor_units =
      current_balance_in_minor_units + v_outstanding::BIGINT,
    updated_at = NOW()
  WHERE id = v_po.supplier_id;

  IF p_amount_paid_at_receipt_in_minor_units > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id, purchase_order_id, purchase_receipt_id,
      amount_in_minor_units, payment_method, reference_number,
      payment_date, notes, created_by, operation_id
    ) VALUES (
      v_po.supplier_id, p_purchase_order_id, v_receipt_id,
      p_amount_paid_at_receipt_in_minor_units, v_payment_method,
      v_payment_reference, COALESCE(p_received_at, NOW()),
      'دفعة عند استلام السند ' || v_receipt_number,
      v_user_id, v_operation_id
    );
  END IF;

  UPDATE public.purchase_orders
  SET status = CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
    received_at = CASE WHEN v_all_completed THEN NOW() ELSE received_at END,
    updated_at = NOW()
  WHERE id = p_purchase_order_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'RECEIVE_PURCHASE_ORDER_V2', 'purchase_receipts',
    v_receipt_id,
    jsonb_build_object(
      'operation_id', v_operation_id,
      'purchase_order_id', p_purchase_order_id,
      'receipt_number', v_receipt_number,
      'inventory_acquisition_cost_in_minor_units', v_acquisition_total::BIGINT,
      'supplier_invoice_payable_total_in_minor_units', v_invoice_payable::BIGINT,
      'supplier_outstanding_balance_effect_in_minor_units', v_outstanding::BIGINT,
      'is_fully_received', v_all_completed,
      'wac', v_wac_results
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order_v2(
  UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_v2(
  UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;

CREATE FUNCTION public.phase2_reverse_inventory_and_wac_internal(
  p_original_operation_id UUID,
  p_reversal_operation_id UUID,
  p_warehouse_id UUID,
  p_source_kind TEXT,
  p_source_id UUID,
  p_user_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot public.phase2_receipt_wac_snapshots%ROWTYPE;
  v_original_movement public.inventory_movements%ROWTYPE;
  v_target_on_hand INTEGER;
  v_target_reserved INTEGER;
  v_global_on_hand INTEGER;
  v_current_exact NUMERIC(24, 6);
  v_current_legacy BIGINT;
  v_running_balance INTEGER;
  v_reversed_units INTEGER := 0;
BEGIN
  IF p_source_kind NOT IN ('supplier_receipt', 'purchase_receipt') THEN
    RAISE EXCEPTION 'PHASE2_REVERSAL_SOURCE_INVALID';
  END IF;

  PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
    SELECT snapshot.product_id
    FROM public.phase2_receipt_wac_snapshots snapshot
    WHERE snapshot.operation_id = p_original_operation_id
    ORDER BY snapshot.product_id
  ));

  FOR v_snapshot IN
    SELECT * FROM public.phase2_receipt_wac_snapshots snapshot
    WHERE snapshot.operation_id = p_original_operation_id
    ORDER BY snapshot.product_id
  LOOP
    SELECT
      product.wac_cost_in_minor_units_exact,
      product.cost_price_in_minor_units
    INTO v_current_exact, v_current_legacy
    FROM public.products product
    WHERE product.id = v_snapshot.product_id;
    SELECT COALESCE(SUM(balance.on_hand_quantity), 0)::INTEGER
    INTO v_global_on_hand
    FROM public.inventory_balances balance
    WHERE balance.product_id = v_snapshot.product_id;
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_target_on_hand, v_target_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_snapshot.product_id
    FOR UPDATE;

    IF v_current_exact IS DISTINCT FROM v_snapshot.resulting_exact_wac_in_minor_units
      OR v_current_legacy IS DISTINCT FROM v_snapshot.resulting_legacy_wac_in_minor_units
      OR v_global_on_hand IS DISTINCT FROM
        v_snapshot.opening_global_quantity + v_snapshot.received_base_quantity
      OR COALESCE(v_target_on_hand, 0) - v_snapshot.received_base_quantity
        < COALESCE(v_target_reserved, 0)
      OR EXISTS (
        SELECT 1 FROM public.inventory_movements movement
        WHERE movement.product_id = v_snapshot.product_id
          AND movement.mutation_sequence > v_snapshot.receipt_movement_sequence_max
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE2_RECEIPT_REVERSAL_UNSAFE: تحرك المخزون أو تغير WAC بعد السند؛ يلزم مسار تصحيحي مستقل.';
    END IF;
  END LOOP;

  FOR v_snapshot IN
    SELECT * FROM public.phase2_receipt_wac_snapshots snapshot
    WHERE snapshot.operation_id = p_original_operation_id
    ORDER BY snapshot.product_id
  LOOP
    SELECT balance.on_hand_quantity
    INTO v_running_balance
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_snapshot.product_id
    FOR UPDATE;

    FOR v_original_movement IN
      SELECT movement.*
      FROM public.inventory_movements movement
      WHERE movement.operation_id = p_original_operation_id
        AND movement.product_id = v_snapshot.product_id
        AND movement.movement_type = 'purchase_receipt'
      ORDER BY movement.mutation_sequence DESC
    LOOP
      INSERT INTO public.inventory_movements (
        warehouse_id, product_id, movement_type, quantity,
        balance_before, balance_after, reference_type, reference_id,
        notes, created_by, operation_id, reversed_movement_id
      ) VALUES (
        p_warehouse_id, v_snapshot.product_id, 'return_out',
        -v_original_movement.quantity,
        v_running_balance,
        v_running_balance - v_original_movement.quantity,
        p_source_kind || '_cancellation', p_source_id,
        'عكس استلام Phase 2: ' || p_reason,
        p_user_id, p_reversal_operation_id, v_original_movement.id
      );
      v_running_balance := v_running_balance - v_original_movement.quantity;
      v_reversed_units := v_reversed_units + v_original_movement.quantity;
    END LOOP;

    UPDATE public.inventory_balances
    SET on_hand_quantity = v_running_balance, updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_snapshot.product_id;
    UPDATE public.products
    SET
      wac_cost_in_minor_units_exact = CASE
        WHEN v_snapshot.opening_global_quantity = 0 THEN NULL
        ELSE v_snapshot.prior_exact_wac_in_minor_units
      END,
      cost_price_in_minor_units = v_snapshot.prior_legacy_wac_in_minor_units,
      updated_at = NOW()
    WHERE id = v_snapshot.product_id;
  END LOOP;

  RETURN jsonb_build_object(
    'reversed_base_units', v_reversed_units,
    'original_operation_id', p_original_operation_id,
    'reversal_operation_id', p_reversal_operation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_reverse_inventory_and_wac_internal(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  RENAME TO _cancel_supplier_receipt_legacy_guarded_v2;
REVOKE ALL ON FUNCTION public._cancel_supplier_receipt_legacy_guarded_v2(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.cancel_supplier_receipt(
  p_supplier_receipt_id UUID,
  p_reason TEXT DEFAULT 'إلغاء سند استلام البضائع'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_receipt public.supplier_receipts%ROWTYPE;
  v_reversal_operation_id UUID := gen_random_uuid();
  v_result JSONB;
  v_inventory_result JSONB;
  v_payment_total BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سندات الاستلام'
  );
  PERFORM public.phase2_lock_receipt_payment_shifts_internal(
    p_supplier_receipt_id, NULL
  );
  IF EXISTS (
    SELECT 1 FROM public.supplier_receipts receipt
    WHERE receipt.id = p_supplier_receipt_id
  ) THEN
    PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
      SELECT DISTINCT item.product_id
      FROM public.supplier_receipt_items item
      WHERE item.supplier_receipt_id = p_supplier_receipt_id
      ORDER BY item.product_id
    ));
  END IF;
  SELECT * INTO v_receipt
  FROM public.supplier_receipts receipt
  WHERE receipt.id = p_supplier_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_receipt.phase2_finalized_at IS NULL THEN
    RETURN public._cancel_supplier_receipt_legacy_guarded_v2(
      p_supplier_receipt_id, p_reason
    );
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'سبب إلغاء سند الاستلام مطلوب.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.supplier_payments payment
    WHERE payment.supplier_receipt_id = v_receipt.id
      AND NOT payment.is_reversed
      AND payment.operation_id IS DISTINCT FROM v_receipt.operation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_LATER_PAYMENT_CANCELLATION_UNSUPPORTED: لا يمكن إلغاء سند لديه دفعات لاحقة دون سياسة رد أو ائتمان معتمدة.';
  END IF;
  IF (SELECT supplier.current_balance_in_minor_units
      FROM public.suppliers supplier WHERE supplier.id = v_receipt.supplier_id)
      < v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_SUPPLIER_BALANCE_REVERSAL_UNSAFE: رصيد المورد لا يسمح بعكس الأثر الأصلي بأمان.';
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'original_operation_id', v_receipt.operation_id,
    'reversal_operation_id', v_reversal_operation_id
  );
  INSERT INTO public.business_operations (
    id, operation_type, initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_reversal_operation_id, 'supplier_receipt_cancellation_v2',
    v_user_id, v_result, NOW()
  );

  v_inventory_result := public.phase2_reverse_inventory_and_wac_internal(
    v_receipt.operation_id, v_reversal_operation_id, v_receipt.warehouse_id,
    'supplier_receipt', v_receipt.id, v_user_id, v_reason
  );

  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units
      - v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units,
    updated_at = NOW()
  WHERE id = v_receipt.supplier_id;

  SELECT COALESCE(SUM(payment.amount_in_minor_units), 0)
  INTO v_payment_total
  FROM public.supplier_payments payment
  WHERE payment.supplier_receipt_id = v_receipt.id
    AND NOT payment.is_reversed;
  UPDATE public.supplier_payments
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE supplier_receipt_id = v_receipt.id AND NOT is_reversed;

  UPDATE public.supplier_financial_invoice_identities
  SET is_active = false, cancelled_at = NOW()
  WHERE supplier_receipt_id = v_receipt.id AND is_active;
  UPDATE public.supplier_receipts
  SET status = 'cancelled', is_archived = true,
    phase2_cancelled_at = NOW(), phase2_cancelled_by = v_user_id,
    phase2_cancellation_reason = v_reason,
    updated_at = NOW()
  WHERE id = v_receipt.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CANCEL_SUPPLIER_RECEIPT_V2', 'supplier_receipts',
    v_receipt.id,
    jsonb_build_object(
      'original_operation_id', v_receipt.operation_id,
      'reversal_operation_id', v_reversal_operation_id,
      'supplier_outstanding_reversed_in_minor_units',
        v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units,
      'payments_marked_reversed_in_minor_units', v_payment_total,
      'inventory', v_inventory_result
    )
  );
  RETURN v_result || v_inventory_result || jsonb_build_object(
    'payments_marked_reversed_in_minor_units', v_payment_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  TO authenticated;

CREATE FUNCTION public.cancel_purchase_receipt_v2(
  p_purchase_receipt_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_receipt public.purchase_receipts%ROWTYPE;
  v_reversal_operation_id UUID := gen_random_uuid();
  v_result JSONB;
  v_inventory_result JSONB;
  v_payment_total BIGINT;
  v_po_status TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سند استلام أمر شراء'
  );
  PERFORM public.phase2_lock_receipt_payment_shifts_internal(
    NULL, p_purchase_receipt_id
  );
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'سبب إلغاء سند الاستلام مطلوب.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.purchase_receipts receipt
    WHERE receipt.id = p_purchase_receipt_id
      AND receipt.phase2_finalized_at IS NOT NULL
  ) THEN
    PERFORM public.phase2_lock_inventory_products_internal(ARRAY(
      SELECT DISTINCT item.product_id
      FROM public.purchase_receipt_items item
      WHERE item.purchase_receipt_id = p_purchase_receipt_id
      ORDER BY item.product_id
    ));
  END IF;
  SELECT * INTO v_receipt
  FROM public.purchase_receipts receipt
  WHERE receipt.id = p_purchase_receipt_id
  FOR UPDATE;
  IF NOT FOUND OR v_receipt.phase2_finalized_at IS NULL THEN
    RAISE EXCEPTION 'سند الاستلام Phase 2 غير موجود.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.supplier_payments payment
    WHERE payment.purchase_receipt_id = v_receipt.id
      AND NOT payment.is_reversed
      AND payment.operation_id IS DISTINCT FROM v_receipt.operation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_LATER_PAYMENT_CANCELLATION_UNSUPPORTED: لا يمكن إلغاء سند لديه دفعات لاحقة دون سياسة رد أو ائتمان معتمدة.';
  END IF;

  PERFORM 1 FROM public.purchase_orders purchase_order
  WHERE purchase_order.id = v_receipt.purchase_order_id
  FOR UPDATE;
  PERFORM item.id
  FROM public.purchase_order_items item
  JOIN public.purchase_receipt_commercial_lines line
    ON line.purchase_order_item_id = item.id
  WHERE line.purchase_receipt_id = v_receipt.id
  ORDER BY item.id
  FOR UPDATE OF item;

  IF (SELECT supplier.current_balance_in_minor_units
      FROM public.suppliers supplier WHERE supplier.id = v_receipt.supplier_id)
      < v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_SUPPLIER_BALANCE_REVERSAL_UNSAFE: رصيد المورد لا يسمح بعكس الأثر الأصلي بأمان.';
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'original_operation_id', v_receipt.operation_id,
    'reversal_operation_id', v_reversal_operation_id
  );
  INSERT INTO public.business_operations (
    id, operation_type, initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_reversal_operation_id, 'purchase_receipt_cancellation_v2',
    v_user_id, v_result, NOW()
  );

  v_inventory_result := public.phase2_reverse_inventory_and_wac_internal(
    v_receipt.operation_id, v_reversal_operation_id, v_receipt.warehouse_id,
    'purchase_receipt', v_receipt.id, v_user_id, v_reason
  );

  UPDATE public.purchase_order_items item
  SET
    received_quantity = item.received_quantity - line.received_base_unit_quantity,
    received_parcel_quantity = item.received_parcel_quantity
      - COALESCE(line.received_parcel_quantity, 0),
    updated_at = NOW()
  FROM public.purchase_receipt_commercial_lines line
  WHERE line.purchase_receipt_id = v_receipt.id
    AND item.id = line.purchase_order_item_id;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.purchase_order_items item
      WHERE item.purchase_order_id = v_receipt.purchase_order_id
        AND item.received_quantity > 0
    ) THEN 'partially_received'
    ELSE 'approved'
  END INTO v_po_status;
  UPDATE public.purchase_orders
  SET status = v_po_status, received_at = NULL, updated_at = NOW()
  WHERE id = v_receipt.purchase_order_id;

  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units
      - v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units,
    updated_at = NOW()
  WHERE id = v_receipt.supplier_id;

  SELECT COALESCE(SUM(payment.amount_in_minor_units), 0)
  INTO v_payment_total
  FROM public.supplier_payments payment
  WHERE payment.purchase_receipt_id = v_receipt.id
    AND NOT payment.is_reversed;
  UPDATE public.supplier_payments
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE purchase_receipt_id = v_receipt.id AND NOT is_reversed;
  UPDATE public.supplier_financial_invoice_identities
  SET is_active = false, cancelled_at = NOW()
  WHERE purchase_receipt_id = v_receipt.id AND is_active;
  UPDATE public.purchase_receipts
  SET status = 'cancelled', phase2_cancelled_at = NOW(),
    phase2_cancelled_by = v_user_id,
    phase2_cancellation_reason = v_reason
  WHERE id = v_receipt.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CANCEL_PURCHASE_RECEIPT_V2', 'purchase_receipts',
    v_receipt.id,
    jsonb_build_object(
      'original_operation_id', v_receipt.operation_id,
      'reversal_operation_id', v_reversal_operation_id,
      'supplier_outstanding_reversed_in_minor_units',
        v_receipt.supplier_outstanding_balance_effect_snapshot_in_minor_units,
      'payments_marked_reversed_in_minor_units', v_payment_total,
      'purchase_order_status', v_po_status,
      'inventory', v_inventory_result
    )
  );
  RETURN v_result || v_inventory_result || jsonb_build_object(
    'payments_marked_reversed_in_minor_units', v_payment_total,
    'purchase_order_status', v_po_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT)
  TO authenticated;

-- --------------------------------------------------------------------------
-- Database-boundary integrity and history guards.
-- --------------------------------------------------------------------------

CREATE FUNCTION public.validate_purchase_order_component_family_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.purchase_order_items%ROWTYPE;
  v_actual_family UUID;
  v_is_master BOOLEAN;
BEGIN
  SELECT * INTO v_item
  FROM public.purchase_order_items item
  WHERE item.id = NEW.purchase_order_item_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      CONSTRAINT = 'purchase_order_item_components_item_fkey',
      MESSAGE = 'Purchase Order Item does not exist.';
  END IF;
  SELECT COALESCE(product.flavor_master_product_id, product.id), product.is_flavor_master
  INTO v_actual_family, v_is_master
  FROM public.products product WHERE product.id = NEW.product_id;
  IF v_is_master OR (
    v_item.commercial_line_kind = 'base_unit'
      AND NEW.product_id IS DISTINCT FROM v_item.product_id
  ) OR (
    v_item.commercial_line_kind = 'configurable_parcel'
      AND v_actual_family IS DISTINCT FROM v_item.family_product_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'purchase_order_item_components_family_check',
      MESSAGE = 'Purchase Order component must match its immutable commercial family.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_purchase_order_component_family_v2
BEFORE INSERT OR UPDATE ON public.purchase_order_item_components
FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_order_component_family_v2();

CREATE FUNCTION public.validate_purchase_receipt_item_family_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.purchase_receipt_commercial_lines%ROWTYPE;
  v_actual_family UUID;
  v_is_master BOOLEAN;
  v_po_product_id UUID;
BEGIN
  IF NEW.commercial_line_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_line
  FROM public.purchase_receipt_commercial_lines line
  WHERE line.id = NEW.commercial_line_id;
  SELECT COALESCE(product.flavor_master_product_id, product.id), product.is_flavor_master
  INTO v_actual_family, v_is_master
  FROM public.products product WHERE product.id = NEW.product_id;
  SELECT item.product_id INTO v_po_product_id
  FROM public.purchase_order_items item WHERE item.id = v_line.purchase_order_item_id;
  IF v_is_master OR (
    v_line.commercial_line_kind = 'base_unit'
      AND NEW.product_id IS DISTINCT FROM v_po_product_id
  ) OR (
    v_line.commercial_line_kind = 'configurable_parcel'
      AND v_actual_family IS DISTINCT FROM v_line.family_product_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'purchase_receipt_items_commercial_family_check',
      MESSAGE = 'Purchase Receipt component must match its commercial Family.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_purchase_receipt_item_family_v2
BEFORE INSERT OR UPDATE OF commercial_line_id, product_id
ON public.purchase_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_receipt_item_family_v2();

CREATE TRIGGER trg_guard_purchase_receipt_configurable_parcel_v2
BEFORE INSERT ON public.purchase_receipt_commercial_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_new_configurable_parcel_row();

CREATE FUNCTION public.validate_phase2_inventory_movement_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
  v_operation_id UUID;
  v_receipt_id UUID;
BEGIN
  IF NEW.supplier_receipt_item_id IS NOT NULL THEN
    SELECT item.product_id, item.operation_id, item.supplier_receipt_id
    INTO v_product_id, v_operation_id, v_receipt_id
    FROM public.supplier_receipt_items item
    WHERE item.id = NEW.supplier_receipt_item_id;
    IF NOT FOUND OR NEW.product_id IS DISTINCT FROM v_product_id
      OR NEW.operation_id IS DISTINCT FROM v_operation_id
      OR NEW.reference_id IS DISTINCT FROM v_receipt_id
      OR NEW.reference_type IS DISTINCT FROM 'supplier_receipt'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'inventory_movements_supplier_receipt_item_chain_check',
        MESSAGE = 'Inventory Movement must match its Supplier Receipt component.';
    END IF;
  ELSIF NEW.purchase_receipt_item_id IS NOT NULL THEN
    SELECT item.product_id, item.operation_id, item.purchase_receipt_id
    INTO v_product_id, v_operation_id, v_receipt_id
    FROM public.purchase_receipt_items item
    WHERE item.id = NEW.purchase_receipt_item_id;
    IF NOT FOUND OR NEW.product_id IS DISTINCT FROM v_product_id
      OR NEW.operation_id IS DISTINCT FROM v_operation_id
      OR NEW.reference_id IS DISTINCT FROM v_receipt_id
      OR NEW.reference_type IS DISTINCT FROM 'purchase_receipt'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'inventory_movements_purchase_receipt_item_chain_check',
        MESSAGE = 'Inventory Movement must match its Purchase Receipt component.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_phase2_inventory_movement_source
BEFORE INSERT OR UPDATE OF
  product_id, operation_id, reference_type, reference_id,
  supplier_receipt_item_id, purchase_receipt_item_id
ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.validate_phase2_inventory_movement_source();

CREATE FUNCTION public.guard_phase2_receipt_header_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_core JSONB;
  v_new_core JSONB;
BEGIN
  IF OLD.phase2_finalized_at IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_RECEIPT_HISTORY_IMMUTABLE: لا يمكن حذف سند Phase 2 النهائي.';
  END IF;
  IF TG_TABLE_NAME = 'supplier_receipts' THEN
    v_old_core := to_jsonb(OLD) - ARRAY[
      'status', 'is_archived', 'amount_paid_in_minor_units',
      'amount_due_in_minor_units', 'payment_status', 'updated_at',
      'phase2_cancelled_at', 'phase2_cancelled_by',
      'phase2_cancellation_reason'
    ];
    v_new_core := to_jsonb(NEW) - ARRAY[
      'status', 'is_archived', 'amount_paid_in_minor_units',
      'amount_due_in_minor_units', 'payment_status', 'updated_at',
      'phase2_cancelled_at', 'phase2_cancelled_by',
      'phase2_cancellation_reason'
    ];
  ELSE
    v_old_core := to_jsonb(OLD) - ARRAY[
      'status', 'phase2_cancelled_at', 'phase2_cancelled_by',
      'phase2_cancellation_reason'
    ];
    v_new_core := to_jsonb(NEW) - ARRAY[
      'status', 'phase2_cancelled_at', 'phase2_cancelled_by',
      'phase2_cancellation_reason'
    ];
  END IF;
  IF v_old_core IS DISTINCT FROM v_new_core THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_FINANCIAL_SNAPSHOT_IMMUTABLE: لا يمكن تعديل الحقيقة المالية التاريخية للسند.';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_RECEIPT_CANCELLATION_IMMUTABLE: لا يمكن إعادة تفعيل سند ملغى.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_supplier_receipt_phase2_history
BEFORE UPDATE OR DELETE ON public.supplier_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_phase2_receipt_header_history();
CREATE TRIGGER trg_guard_purchase_receipt_phase2_history
BEFORE UPDATE OR DELETE ON public.purchase_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_phase2_receipt_header_history();

CREATE FUNCTION public.guard_phase2_detail_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(OLD.operation_id, NEW.operation_id) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE2_RECEIPT_DETAIL_IMMUTABLE: لا يمكن تعديل مكونات أو تكاليف سند Phase 2.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_guard_supplier_receipt_item_phase2_history
BEFORE UPDATE OR DELETE ON public.supplier_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.guard_phase2_detail_history();
CREATE TRIGGER trg_guard_purchase_receipt_item_phase2_history
BEFORE UPDATE OR DELETE ON public.purchase_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.guard_phase2_detail_history();
CREATE TRIGGER trg_guard_purchase_receipt_line_phase2_history
BEFORE UPDATE OR DELETE ON public.purchase_receipt_commercial_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();
CREATE TRIGGER trg_guard_purchase_order_component_phase2_history
BEFORE UPDATE OR DELETE ON public.purchase_order_item_components
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();
CREATE TRIGGER trg_guard_phase2_wac_snapshot_history
BEFORE UPDATE OR DELETE ON public.phase2_receipt_wac_snapshots
FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_parcel_foundation_row();

CREATE FUNCTION public.guard_supplier_invoice_identity_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'SUPPLIER_INVOICE_IDENTITY_IMMUTABLE: لا يمكن حذف هوية فاتورة المورد.';
  END IF;
  IF ROW(
    NEW.id, NEW.supplier_id, NEW.normalized_invoice_number,
    NEW.operation_id, NEW.supplier_receipt_id, NEW.purchase_receipt_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.supplier_id, OLD.normalized_invoice_number,
    OLD.operation_id, OLD.supplier_receipt_id, OLD.purchase_receipt_id,
    OLD.created_at
  ) OR OLD.is_active = false OR NEW.is_active = true
    OR NEW.cancelled_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'SUPPLIER_INVOICE_IDENTITY_IMMUTABLE: يسمح فقط بإغلاق هوية الفاتورة مرة واحدة.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_supplier_invoice_identity_history
BEFORE UPDATE OR DELETE ON public.supplier_financial_invoice_identities
FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_invoice_identity_history();

CREATE FUNCTION public.assert_phase2_receipt_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id UUID := COALESCE(NEW.operation_id, OLD.operation_id);
  v_operation_type TEXT;
  v_header RECORD;
  v_line_count INTEGER;
  v_payment_total BIGINT;
  v_movement_total BIGINT;
BEGIN
  IF v_operation_id IS NULL THEN RETURN NULL; END IF;
  SELECT operation.operation_type INTO v_operation_type
  FROM public.business_operations operation WHERE operation.id = v_operation_id;

  IF v_operation_type = 'supplier_receipt_v2' THEN
    SELECT * INTO v_header FROM public.supplier_receipts receipt
    WHERE receipt.operation_id = v_operation_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT COUNT(*) INTO v_line_count
    FROM public.supplier_receipt_commercial_lines line
    WHERE line.operation_id = v_operation_id;
    IF v_line_count = 0 OR EXISTS (
      SELECT 1
      FROM public.supplier_receipt_commercial_lines line
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(item.total_base_units), 0) AS quantity_total,
          COALESCE(SUM(item.merchandise_net_cost_in_minor_units), 0) AS merchandise_total,
          COALESCE(SUM(item.allocated_cost_in_minor_units), 0) AS acquisition_total
        FROM public.supplier_receipt_items item
        WHERE item.commercial_line_id = line.id
      ) items ON true
      WHERE line.operation_id = v_operation_id
        AND (items.quantity_total <> line.received_base_unit_quantity
          OR items.merchandise_total <> line.line_total_snapshot_in_minor_units
          OR items.acquisition_total <> line.final_acquisition_amount_in_minor_units)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'supplier_receipt_phase2_line_component_reconciliation_check',
        MESSAGE = 'PHASE2_RECEIPT_COMPONENT_RECONCILIATION_FAILED';
    END IF;

    IF (SELECT COALESCE(SUM(line.gross_amount_snapshot_in_minor_units), 0)
        FROM public.supplier_receipt_commercial_lines line
        WHERE line.operation_id = v_operation_id)
          <> v_header.merchandise_gross_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.discount_snapshot_in_minor_units), 0)
          FROM public.supplier_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.line_discount_total_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.allocated_header_discount_in_minor_units), 0)
          FROM public.supplier_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.header_discount_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.allocated_supplier_freight_in_minor_units), 0)
          FROM public.supplier_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.supplier_freight_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.final_acquisition_amount_in_minor_units), 0)
          FROM public.supplier_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.inventory_acquisition_cost_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(snapshot.allocated_acquisition_cost_in_minor_units), 0)
          FROM public.phase2_receipt_wac_snapshots snapshot
          WHERE snapshot.operation_id = v_operation_id)
          <> v_header.inventory_acquisition_cost_snapshot_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'supplier_receipt_phase2_financial_reconciliation_check',
        MESSAGE = 'PHASE2_RECEIPT_FINANCIAL_RECONCILIATION_FAILED';
    END IF;

    IF v_header.status = 'completed' THEN
      SELECT COALESCE(SUM(payment.amount_in_minor_units), 0)
      INTO v_payment_total FROM public.supplier_payments payment
      WHERE payment.supplier_receipt_id = v_header.id
        AND payment.operation_id = v_operation_id
        AND NOT payment.is_reversed;
      IF v_payment_total <> v_header.amount_paid_at_receipt_snapshot_in_minor_units THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'supplier_receipt_phase2_payment_reconciliation_check',
          MESSAGE = 'PHASE2_RECEIPT_PAYMENT_RECONCILIATION_FAILED';
      END IF;
    END IF;
  ELSIF v_operation_type = 'purchase_order_receipt_v2' THEN
    SELECT * INTO v_header FROM public.purchase_receipts receipt
    WHERE receipt.operation_id = v_operation_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT COUNT(*) INTO v_line_count
    FROM public.purchase_receipt_commercial_lines line
    WHERE line.operation_id = v_operation_id;
    IF v_line_count = 0 OR EXISTS (
      SELECT 1
      FROM public.purchase_receipt_commercial_lines line
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(item.received_quantity), 0) AS quantity_total,
          COALESCE(SUM(item.merchandise_net_cost_in_minor_units), 0) AS merchandise_total,
          COALESCE(SUM(item.allocated_cost_in_minor_units), 0) AS acquisition_total
        FROM public.purchase_receipt_items item
        WHERE item.commercial_line_id = line.id
      ) items ON true
      WHERE line.operation_id = v_operation_id
        AND (items.quantity_total <> line.received_base_unit_quantity
          OR items.merchandise_total <> line.line_net_merchandise_snapshot_in_minor_units
          OR items.acquisition_total <> line.final_acquisition_amount_in_minor_units)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'purchase_receipt_phase2_line_component_reconciliation_check',
        MESSAGE = 'PHASE2_PURCHASE_RECEIPT_COMPONENT_RECONCILIATION_FAILED';
    END IF;

    IF (SELECT COALESCE(SUM(line.gross_amount_snapshot_in_minor_units), 0)
        FROM public.purchase_receipt_commercial_lines line
        WHERE line.operation_id = v_operation_id)
          <> v_header.merchandise_gross_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.line_discount_snapshot_in_minor_units), 0)
          FROM public.purchase_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.line_discount_total_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.allocated_header_discount_in_minor_units), 0)
          FROM public.purchase_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.header_discount_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.allocated_supplier_freight_in_minor_units), 0)
          FROM public.purchase_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.supplier_freight_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(line.final_acquisition_amount_in_minor_units), 0)
          FROM public.purchase_receipt_commercial_lines line
          WHERE line.operation_id = v_operation_id)
          <> v_header.inventory_acquisition_cost_snapshot_in_minor_units
      OR (SELECT COALESCE(SUM(snapshot.allocated_acquisition_cost_in_minor_units), 0)
          FROM public.phase2_receipt_wac_snapshots snapshot
          WHERE snapshot.operation_id = v_operation_id)
          <> v_header.inventory_acquisition_cost_snapshot_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        CONSTRAINT = 'purchase_receipt_phase2_financial_reconciliation_check',
        MESSAGE = 'PHASE2_PURCHASE_RECEIPT_FINANCIAL_RECONCILIATION_FAILED';
    END IF;

    IF v_header.status = 'completed' THEN
      SELECT COALESCE(SUM(payment.amount_in_minor_units), 0)
      INTO v_payment_total FROM public.supplier_payments payment
      WHERE payment.purchase_receipt_id = v_header.id
        AND payment.operation_id = v_operation_id
        AND NOT payment.is_reversed;
      IF v_payment_total <> v_header.amount_paid_at_receipt_snapshot_in_minor_units THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
          CONSTRAINT = 'purchase_receipt_phase2_payment_reconciliation_check',
          MESSAGE = 'PHASE2_PURCHASE_RECEIPT_PAYMENT_RECONCILIATION_FAILED';
      END IF;
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(movement.quantity), 0)
  INTO v_movement_total
  FROM public.inventory_movements movement
  WHERE movement.operation_id = v_operation_id
    AND movement.movement_type = 'purchase_receipt';
  IF v_movement_total <> (
    SELECT COALESCE(SUM(snapshot.received_base_quantity), 0)
    FROM public.phase2_receipt_wac_snapshots snapshot
    WHERE snapshot.operation_id = v_operation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase2_receipt_inventory_movement_reconciliation_check',
      MESSAGE = 'PHASE2_RECEIPT_MOVEMENT_RECONCILIATION_FAILED';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_reconcile_supplier_receipt_phase2_header
AFTER INSERT OR UPDATE ON public.supplier_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_supplier_receipt_phase2_line
AFTER INSERT ON public.supplier_receipt_commercial_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_supplier_receipt_phase2_item
AFTER INSERT ON public.supplier_receipt_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_purchase_receipt_phase2_header
AFTER INSERT OR UPDATE ON public.purchase_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_purchase_receipt_phase2_line
AFTER INSERT ON public.purchase_receipt_commercial_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_purchase_receipt_phase2_item
AFTER INSERT ON public.purchase_receipt_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();
CREATE CONSTRAINT TRIGGER trg_reconcile_phase2_receipt_wac
AFTER INSERT ON public.phase2_receipt_wac_snapshots
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_phase2_receipt_reconciliation();

CREATE FUNCTION public.save_product_parcel_configuration_v1(
  p_family_product_id UUID,
  p_composition_mode TEXT,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_configuration public.product_parcel_configurations%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إعداد الطرود التجارية'
  );
  IF p_composition_mode NOT IN ('single_sku', 'configurable_mix') THEN
    RAISE EXCEPTION 'نوع تكوين الطرد غير مدعوم.';
  END IF;
  SELECT * INTO v_configuration
  FROM public.product_parcel_configurations configuration
  WHERE configuration.family_product_id = p_family_product_id
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.product_parcel_configurations
    SET composition_mode = p_composition_mode,
      configuration_revision = CASE
        WHEN composition_mode IS DISTINCT FROM p_composition_mode
          THEN configuration_revision + 1
        ELSE configuration_revision
      END,
      is_active = COALESCE(p_is_active, true),
      updated_by = v_user_id,
      updated_at = NOW()
    WHERE id = v_configuration.id
    RETURNING * INTO v_configuration;
  ELSE
    INSERT INTO public.product_parcel_configurations (
      family_product_id, composition_mode, is_active, created_by, updated_by
    ) VALUES (
      p_family_product_id, p_composition_mode,
      COALESCE(p_is_active, true), v_user_id, v_user_id
    ) RETURNING * INTO v_configuration;
  END IF;
  RETURN jsonb_build_object('success', true, 'configuration', to_jsonb(v_configuration));
END;
$$;

CREATE FUNCTION public.set_configurable_parcel_feature_state_v1(p_state TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_state TEXT := UPPER(BTRIM(p_state));
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تغيير حالة ميزة الطرود');
  IF v_state NOT IN ('OFF', 'OWNER_PILOT', 'ENABLED') THEN
    RAISE EXCEPTION 'حالة ميزة الطرود غير صالحة.';
  END IF;
  UPDATE public.configurable_parcel_feature_settings
  SET feature_state = v_state, updated_by = v_user_id, updated_at = NOW()
  WHERE feature_key = 'configurable_parcels';
  RETURN jsonb_build_object('success', true, 'feature_state', v_state);
END;
$$;

REVOKE ALL ON FUNCTION public.save_product_parcel_configuration_v1(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_parcel_configuration_v1(UUID, TEXT, BOOLEAN)
  TO authenticated;
REVOKE ALL ON FUNCTION public.set_configurable_parcel_feature_state_v1(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_configurable_parcel_feature_state_v1(TEXT)
  TO authenticated;

-- -------------------------------------------------------------------------
-- Legacy receiving compatibility bridge
-- -------------------------------------------------------------------------
-- Migration 113 leaves the public legacy contracts callable for cached Admin
-- clients. They now participate in the same receipt-key/product lock protocol
-- and project one authoritative exact WAC back to the legacy BIGINT column.
CREATE OR REPLACE FUNCTION public.create_direct_supplier_receipt(
  p_supplier_id UUID,
  p_warehouse_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_purchase_only_items JSONB := p_items;
  -- Migration 011 defines only NULL/omitted as cash. Preserve exact casing,
  -- whitespace and unsupported-value rejection for every other input.
  v_payment_method TEXT := COALESCE(p_payment_method, 'cash');
  v_effective_received_at TIMESTAMPTZ := COALESCE(p_received_at, NOW());
  v_canonical_items JSONB;
  v_canonical_request JSONB;
  v_identity_snapshot JSONB;
  v_fingerprint TEXT;
  v_operation_id UUID := gen_random_uuid();
  v_existing_receipt public.supplier_receipts%ROWTYPE;
  v_existing_operation public.business_operations%ROWTYPE;
  v_product_ids UUID[];
  v_baselines JSONB;
  v_result JSONB;
  v_acquisition RECORD;
  v_baseline JSONB;
  v_opening_quantity INTEGER;
  v_prior_exact NUMERIC(24, 6);
  v_new_exact NUMERIC(24, 6);
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام بضاعة الموردين'
  );

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(item.value - 'selling_price_in_minor_units' ORDER BY item.ordinality),
      '[]'::JSONB
    )
    INTO v_purchase_only_items
    FROM jsonb_array_elements(p_items)
      WITH ORDINALITY AS item(value, ordinality);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'supplier_receipt:' || p_idempotency_key::TEXT,
      0
    ));

    IF EXISTS (
      SELECT 1
      FROM public.business_operations operation
      WHERE operation.operation_type = 'supplier_receipt_v2'
        AND operation.idempotency_key = p_idempotency_key::TEXT
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح الاستلام مستخدم في عقد أحدث.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.supplier_receipts receipt
      WHERE receipt.idempotency_key = p_idempotency_key
        AND receipt.received_by IS DISTINCT FROM v_user_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح الاستلام غير متاح لهذا المستخدم.';
    END IF;

    SELECT * INTO v_existing_receipt
    FROM public.supplier_receipts receipt
    WHERE receipt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing_receipt.received_by IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'IDEMPOTENCY_CONFLICT: مفتاح الاستلام غير متاح لهذا المستخدم.';
      END IF;

      IF v_existing_receipt.operation_id IS NOT NULL THEN
        SELECT * INTO v_existing_operation
        FROM public.business_operations operation
        WHERE operation.id = v_existing_receipt.operation_id
          AND operation.operation_type = 'supplier_receipt_legacy_v113'
          AND operation.initiated_by = v_user_id;
      END IF;

      IF v_existing_operation.id IS NULL THEN
        -- Pre-113 receipts do not retain enough immutable request evidence to
        -- prove equivalence. Fail before canonical parsing or business locks;
        -- the operator must review the existing receipt before any new action.
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: تعذر إثبات تطابق الطلب التاريخي؛ راجع سند الاستلام الموجود قبل إنشاء عملية مستقلة.';
      END IF;
    END IF;
  END IF;

  -- Canonical parsing is intentionally delayed until pre-113 historical
  -- replays have been excluded. Their original request identity cannot be
  -- reconstructed losslessly from immutable data.
  v_canonical_items :=
    public.phase2_canonicalize_legacy_receipt_items_internal(v_purchase_only_items);
  v_canonical_request := jsonb_build_object(
    'identity_version', 1,
    'operation_type', 'supplier_receipt_legacy_v113',
    'supplier_id', LOWER(p_supplier_id::TEXT),
    'warehouse_id', LOWER(p_warehouse_id::TEXT),
    'branch_id', CASE WHEN p_branch_id IS NULL THEN NULL ELSE LOWER(p_branch_id::TEXT) END,
    'supplier_invoice_number', LOWER(NULLIF(BTRIM(p_supplier_invoice_number), '')),
    'supplier_invoice_date', p_supplier_invoice_date,
    'received_at_mode', CASE WHEN p_received_at IS NULL THEN 'default' ELSE 'explicit' END,
    'received_at', CASE WHEN p_received_at IS NULL THEN NULL
      ELSE TO_CHAR(p_received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
    'delivery_fee_in_minor_units', p_delivery_fee_in_minor_units,
    'discount_in_minor_units', p_discount_in_minor_units,
    'tax_in_minor_units', p_tax_in_minor_units,
    'amount_paid_in_minor_units', p_amount_paid_in_minor_units,
    'payment_method', v_payment_method,
    'payment_reference', NULLIF(BTRIM(p_payment_reference), ''),
    'notes', p_notes,
    'internal_notes', p_internal_notes,
    'items', v_canonical_items
  );
  v_fingerprint := public.phase2_request_fingerprint_internal(v_canonical_request);
  v_identity_snapshot := jsonb_build_object(
    'canonical_request', v_canonical_request,
    'resolved_defaults', jsonb_build_object(
      'received_at', TO_CHAR(
        v_effective_received_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    )
  );

  IF v_existing_operation.id IS NOT NULL THEN
    IF v_existing_operation.request_identity_version IS DISTINCT FROM 1
      OR v_existing_operation.request_identity_snapshot IS NULL
      OR v_existing_operation.request_fingerprint IS NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN: لا يمكن إثبات تطابق العملية التاريخية.';
    END IF;
    IF v_existing_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'IDEMPOTENCY_CONFLICT: استُخدم المفتاح نفسه لطلب مختلف.';
    END IF;

    RETURN v_existing_operation.result_snapshot
      || jsonb_build_object('is_duplicate', true);
  END IF;

  SELECT ARRAY_AGG(product_id ORDER BY product_id)
  INTO v_product_ids
  FROM (
    SELECT DISTINCT (item->>'product_id')::UUID AS product_id
    FROM jsonb_array_elements(COALESCE(v_purchase_only_items, '[]'::JSONB)) item
  ) products;

  PERFORM public.phase2_lock_payment_shift_internal(
    p_branch_id, v_payment_method, p_amount_paid_in_minor_units
  );
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);

  SELECT jsonb_object_agg(
    product.id::TEXT,
    jsonb_build_object(
      'opening_quantity', COALESCE((
        SELECT SUM(balance.on_hand_quantity)
        FROM public.inventory_balances balance
        WHERE balance.product_id = product.id
      ), 0),
      'prior_exact', COALESCE(
        product.wac_cost_in_minor_units_exact,
        product.cost_price_in_minor_units::NUMERIC
      )
    )
  )
  INTO v_baselines
  FROM public.products product
  WHERE product.id = ANY(v_product_ids);

  v_result := public._create_direct_supplier_receipt_impl(
    p_supplier_id,
    p_warehouse_id,
    p_branch_id,
    p_supplier_invoice_number,
    p_supplier_invoice_date,
    v_effective_received_at,
    p_delivery_fee_in_minor_units,
    p_discount_in_minor_units,
    p_tax_in_minor_units,
    p_amount_paid_in_minor_units,
    v_payment_method,
    p_payment_reference,
    p_notes,
    p_internal_notes,
    p_idempotency_key,
    v_purchase_only_items
  );

  IF COALESCE((v_result->>'is_duplicate')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  FOR v_acquisition IN
    SELECT
      (item->>'product_id')::UUID AS product_id,
      SUM(
        (item->>'package_quantity')::NUMERIC
        * (item->>'units_per_package')::NUMERIC
      )::INTEGER AS received_quantity,
      SUM(
        (item->>'package_quantity')::NUMERIC
        * (item->>'package_price_in_minor_units')::NUMERIC
        - COALESCE((item->>'discount_in_minor_units')::NUMERIC, 0)
      ) AS received_cost
    FROM jsonb_array_elements(v_purchase_only_items) item
    GROUP BY (item->>'product_id')::UUID
    ORDER BY (item->>'product_id')::UUID
  LOOP
    v_baseline := v_baselines -> (v_acquisition.product_id::TEXT);
    v_opening_quantity := (v_baseline->>'opening_quantity')::INTEGER;
    v_prior_exact := (v_baseline->>'prior_exact')::NUMERIC(24, 6);
    v_new_exact := CASE
      WHEN v_opening_quantity <= 0 THEN
        ROUND(v_acquisition.received_cost / v_acquisition.received_quantity, 6)
      ELSE
        ROUND(
          (
            v_opening_quantity::NUMERIC * v_prior_exact
            + v_acquisition.received_cost
          ) / (v_opening_quantity + v_acquisition.received_quantity),
          6
        )
    END;

    UPDATE public.products
    SET wac_cost_in_minor_units_exact = v_new_exact,
      cost_price_in_minor_units = ROUND(v_new_exact)::BIGINT,
      updated_at = NOW()
    WHERE id = v_acquisition.product_id;
  END LOOP;

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint,
    request_identity_version, request_identity_snapshot,
    initiated_by, result_snapshot, completed_at
  ) VALUES (
    v_operation_id, 'supplier_receipt_legacy_v113',
    CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key::TEXT END,
    v_fingerprint, 1, v_identity_snapshot,
    v_user_id, v_result, NOW()
  );

  UPDATE public.supplier_receipts
  SET operation_id = v_operation_id
  WHERE id = (v_result->>'receipt_id')::UUID
    AND operation_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'LEGACY_REQUEST_IDENTITY_PERSIST_FAILED: تعذر تثبيت هوية طلب الاستلام.';
  END IF;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.resolve_legacy_supplier_receipt_replay_v1(
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_receipt public.supplier_receipts%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'مراجعة سند استلام تاريخي'
  );
  IF v_user_id IS NULL OR p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_receipt
  FROM public.supplier_receipts receipt
  WHERE receipt.idempotency_key = p_idempotency_key
    AND receipt.received_by = v_user_id;

  IF NOT FOUND THEN
    -- No distinction between an absent key and another actor's key.
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'receipt_id', v_receipt.id,
    'receipt_number', v_receipt.receipt_number,
    'received_at', v_receipt.received_at,
    'total_in_minor_units', v_receipt.total_in_minor_units,
    'status', v_receipt.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_legacy_supplier_receipt_replay_v1(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_legacy_supplier_receipt_replay_v1(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_ids UUID[];
  v_baselines JSONB;
  v_result JSONB;
  v_acquisition RECORD;
  v_baseline JSONB;
  v_opening_quantity INTEGER;
  v_prior_exact NUMERIC(24, 6);
  v_new_exact NUMERIC(24, 6);
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام أوامر الشراء'
  );

  -- Keep payload product_id UUID validation, but trust the PO item product.
  PERFORM (item->>'product_id')::UUID
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item;

  -- The current UI sends an explicit non-negative receipt unit cost, and the
  -- stored receipt schema treats zero as a real cost. Missing/NULL is not proof
  -- of free inventory. Validate before the legacy implementation writes rows.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    WHERE COALESCE((item->>'received_quantity')::INTEGER, 0) > 0
      AND (NOT item ? 'unit_cost_in_minor_units'
        OR item->>'unit_cost_in_minor_units' IS NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_LEGACY_COST_REQUIRED: يجب تحديد تكلفة الاستلام صراحةً.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    WHERE COALESCE((item->>'received_quantity')::INTEGER, 0) > 0
      AND CASE
        WHEN item->>'unit_cost_in_minor_units' ~ '^[0-9]+$' THEN
          (item->>'unit_cost_in_minor_units')::NUMERIC > 9223372036854775807::NUMERIC
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE2_LEGACY_COST_INVALID: تكلفة الاستلام يجب أن تكون عددًا صحيحًا غير سالب ضمن الحد المدعوم.';
  END IF;

  SELECT ARRAY_AGG(product_id ORDER BY product_id)
  INTO v_product_ids
  FROM (
    SELECT DISTINCT po_item.product_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item
    JOIN public.purchase_order_items po_item
      ON po_item.id = (item->>'purchase_order_item_id')::UUID
     AND po_item.purchase_order_id = p_purchase_order_id
  ) products;

  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);

  SELECT jsonb_object_agg(
    product.id::TEXT,
    jsonb_build_object(
      'opening_quantity', COALESCE((
        SELECT SUM(balance.on_hand_quantity)
        FROM public.inventory_balances balance
        WHERE balance.product_id = product.id
      ), 0),
      'prior_exact', COALESCE(
        product.wac_cost_in_minor_units_exact,
        product.cost_price_in_minor_units::NUMERIC
      )
    )
  )
  INTO v_baselines
  FROM public.products product
  WHERE product.id = ANY(v_product_ids);

  v_result := public._receive_purchase_order_impl(
    p_purchase_order_id,
    p_warehouse_id,
    p_supplier_delivery_note,
    p_notes,
    p_items
  );

  FOR v_acquisition IN
    SELECT
      po_item.product_id,
      SUM((item->>'received_quantity')::INTEGER)::INTEGER AS received_quantity,
      SUM(
        (item->>'received_quantity')::NUMERIC
        * (item->>'unit_cost_in_minor_units')::NUMERIC
      ) AS received_cost
    FROM jsonb_array_elements(p_items) item
    JOIN public.purchase_order_items po_item
      ON po_item.id = (item->>'purchase_order_item_id')::UUID
     AND po_item.purchase_order_id = p_purchase_order_id
    WHERE (item->>'received_quantity')::INTEGER > 0
    GROUP BY po_item.product_id
    ORDER BY po_item.product_id
  LOOP
    v_baseline := v_baselines -> (v_acquisition.product_id::TEXT);
    v_opening_quantity := (v_baseline->>'opening_quantity')::INTEGER;
    v_prior_exact := (v_baseline->>'prior_exact')::NUMERIC(24, 6);
    v_new_exact := CASE
      WHEN v_opening_quantity <= 0 THEN
        ROUND(v_acquisition.received_cost / v_acquisition.received_quantity, 6)
      ELSE
        ROUND(
          (
            v_opening_quantity::NUMERIC * v_prior_exact
            + v_acquisition.received_cost
          ) / (v_opening_quantity + v_acquisition.received_quantity),
          6
        )
    END;

    UPDATE public.products
    SET wac_cost_in_minor_units_exact = v_new_exact,
      cost_price_in_minor_units = ROUND(v_new_exact)::BIGINT,
      updated_at = NOW()
    WHERE id = v_acquisition.product_id;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(UUID, UUID, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(UUID, UUID, TEXT, TEXT, JSONB)
  TO authenticated;

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'purchase_order_item_components',
    'purchase_receipt_commercial_lines',
    'supplier_financial_invoice_identities',
    'phase2_receipt_wac_snapshots'
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
      'Active ERP staff can read Phase 2 receipt history',
      v_table_name
    );
  END LOOP;
END;
$$;

ALTER SEQUENCE public.inventory_movement_mutation_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE public.inventory_movement_mutation_seq
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.purchase_order_item_components OWNER TO postgres;
ALTER TABLE public.purchase_receipt_commercial_lines OWNER TO postgres;
ALTER TABLE public.supplier_financial_invoice_identities OWNER TO postgres;
ALTER TABLE public.phase2_receipt_wac_snapshots OWNER TO postgres;

ALTER FUNCTION public.phase2_allocate_largest_remainder_internal(BIGINT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_canonicalize_receipt_lines_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_request_fingerprint_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_canonicalize_legacy_receipt_items_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_try_parse_uuid_internal(TEXT) OWNER TO postgres;
ALTER FUNCTION public.attach_supplier_payment_to_open_shift() OWNER TO postgres;
ALTER FUNCTION public.resolve_legacy_supplier_receipt_replay_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.phase2_lock_inventory_products_internal(UUID[]) OWNER TO postgres;
ALTER FUNCTION public.phase2_validate_receipt_lines_internal(JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_apply_inventory_and_wac_internal(UUID, UUID, TEXT, UUID, JSONB, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_direct_supplier_receipt_v2(UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.create_purchase_order_v2(UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.receive_purchase_order_v2(UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase2_reverse_inventory_and_wac_internal(UUID, UUID, UUID, TEXT, UUID, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public._cancel_supplier_receipt_legacy_guarded_v2(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_supplier_receipt(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_purchase_receipt_v2(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.validate_purchase_order_component_family_v2() OWNER TO postgres;
ALTER FUNCTION public.validate_purchase_receipt_item_family_v2() OWNER TO postgres;
ALTER FUNCTION public.validate_phase2_inventory_movement_source() OWNER TO postgres;
ALTER FUNCTION public.guard_phase2_receipt_header_history() OWNER TO postgres;
ALTER FUNCTION public.guard_phase2_detail_history() OWNER TO postgres;
ALTER FUNCTION public.guard_supplier_invoice_identity_history() OWNER TO postgres;
ALTER FUNCTION public.assert_phase2_receipt_reconciliation() OWNER TO postgres;
ALTER FUNCTION public.assign_inventory_movement_mutation_sequence() OWNER TO postgres;
ALTER FUNCTION public.save_product_parcel_configuration_v1(UUID, TEXT, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.set_configurable_parcel_feature_state_v1(TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) OWNER TO postgres;
ALTER FUNCTION public.receive_purchase_order(UUID, UUID, TEXT, TEXT, JSONB)
  OWNER TO postgres;

-- Transfers previously locked source then destination. That is incompatible
-- with a global WAC writer locking all warehouses in canonical order when the
-- transfer runs in the opposite direction. Keep the existing implementation,
-- authorization and business behavior; add only the shared inventory gate.
ALTER FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) RENAME TO _transfer_inventory_between_warehouses_phase2_legacy;
REVOKE ALL ON FUNCTION public._transfer_inventory_between_warehouses_phase2_legacy(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.transfer_inventory_between_warehouses(
  p_product_id UUID,
  p_source_warehouse_id UUID,
  p_destination_warehouse_id UUID,
  p_quantity INTEGER,
  p_notes TEXT DEFAULT NULL,
  p_transfer_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'نقل المخزون بين المستودعات'
  );
  PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);
  RETURN public._transfer_inventory_between_warehouses_phase2_legacy(
    p_product_id, p_source_warehouse_id, p_destination_warehouse_id,
    p_quantity, p_notes, p_transfer_date
  );
END;
$$;
ALTER FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) OWNER TO postgres;
ALTER FUNCTION public._transfer_inventory_between_warehouses_phase2_legacy(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_inventory_between_warehouses(
  UUID, UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ
) TO authenticated;

REVOKE ALL ON FUNCTION public.validate_purchase_order_component_family_v2()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_purchase_receipt_item_family_v2()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_phase2_inventory_movement_source()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase2_receipt_header_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_phase2_detail_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_supplier_invoice_identity_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_phase2_receipt_reconciliation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_inventory_movement_mutation_sequence()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.create_direct_supplier_receipt_v2(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS 'Phase 2 atomic direct receiving: commercial-line snapshots, exact allocations, exact WAC and strong idempotency.';
COMMENT ON FUNCTION public.receive_purchase_order_v2(
  UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT,
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS 'Phase 2 atomic PO receiving with explicit Parcel/base quantities, exact WAC, financial snapshots and replay safety.';

COMMIT;
