BEGIN;

-- ============================================================================
-- Nawasrah ERP - Phase 3.2 Admin POS coordinator
--
-- The public V1 contract remains unchanged.  Its private base-unit writer is
-- wrapped below only to normalize the open-shift -> inventory lock boundary
-- with V2 and reversal.  This additive V2 contract stores one commercial
-- parent per line, one immutable row per configurable Parcel instance and
-- component-only stock effects.  The same raw idempotency key is serialized
-- with V1 before the Phase-3 operation namespace is consulted.
-- ============================================================================

-- Legacy V1 validates and resolves its package request before reaching this
-- private base-unit writer.  Preserve that public validation/idempotency layer,
-- but make every first execution join the same shift gate used by reversal
-- before the legacy writer can acquire any stocked-product/balance row.
DO $$
BEGIN
  IF to_regprocedure(
    'public._create_pos_sale_base_units_before_phase3_lock(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_pos_sale_base_units_legacy(
      UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
    ) RENAME TO _create_pos_sale_base_units_before_phase3_lock;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._create_pos_sale_base_units_before_phase3_lock(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.phase3_resolve_legacy_pos_location_internal(
  p_warehouse_id UUID,
  p_branch_id UUID
)
RETURNS TABLE(warehouse_id UUID, branch_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warehouse_id UUID := p_warehouse_id;
  v_branch_id UUID := p_branch_id;
BEGIN
  -- Preserve the published V1 resolver exactly.  A missing warehouse chooses
  -- the oldest active warehouse and replaces any supplied branch with that
  -- warehouse's branch.  An explicit warehouse preserves an explicit branch,
  -- including the historical mismatch behavior, and infers only a NULL one.
  IF v_warehouse_id IS NULL THEN
    SELECT warehouse.id, warehouse.branch_id
    INTO v_warehouse_id, v_branch_id
    FROM public.warehouses warehouse
    WHERE warehouse.is_active = true
    ORDER BY warehouse.created_at
    LIMIT 1;
  ELSE
    SELECT COALESCE(v_branch_id, warehouse.branch_id)
    INTO v_branch_id
    FROM public.warehouses warehouse
    WHERE warehouse.id = v_warehouse_id
      AND warehouse.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
    END IF;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مستودع نشط لتنفيذ البيع.';
  END IF;

  RETURN QUERY SELECT v_warehouse_id, v_branch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.phase3_resolve_legacy_pos_location_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.phase3_resolve_legacy_pos_location_internal(UUID, UUID)
  OWNER TO postgres;

CREATE FUNCTION public.phase3_lock_open_pos_shift_internal(
  p_branch_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ البيع المباشر دون فرع محدد.';
  END IF;

  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.branch_id = p_branch_id
    AND shift.status = 'open'
  ORDER BY shift.id
  LIMIT 1;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولاً قبل إتمام البيع المباشر.';
  END IF;

  -- Full-shift reversal and POS reversal already serialize on this key before
  -- taking the shift row.  Joining that gate prevents the historical
  -- Inventory -> Shift / Shift -> Inventory cycle without changing V1 data or
  -- its caller-visible contract.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'cash-shift-full-reversal:' || v_shift_id::TEXT,
    0
  ));

  PERFORM shift.id
  FROM public.cash_shifts shift
  WHERE shift.id = v_shift_id
    AND shift.branch_id = p_branch_id
    AND shift.status = 'open'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولاً قبل إتمام البيع المباشر.';
  END IF;

  RETURN v_shift_id;
END;
$$;

REVOKE ALL ON FUNCTION public.phase3_lock_open_pos_shift_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.phase3_lock_open_pos_shift_internal(UUID)
  OWNER TO postgres;

CREATE FUNCTION public.create_pos_sale_base_units_legacy(
  p_warehouse_id UUID,
  p_branch_id UUID,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location RECORD;
BEGIN
  SELECT * INTO STRICT v_location
  FROM public.phase3_resolve_legacy_pos_location_internal(
    p_warehouse_id,
    p_branch_id
  );

  PERFORM public.phase3_lock_open_pos_shift_internal(v_location.branch_id);

  RETURN public._create_pos_sale_base_units_before_phase3_lock(
    v_location.warehouse_id,
    v_location.branch_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    p_items,
    p_discount_in_minor_units,
    p_amount_received_in_minor_units,
    p_idempotency_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pos_sale_base_units_legacy(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.create_pos_sale_base_units_legacy(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) OWNER TO postgres;

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
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_payment_method TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'cash'));
  v_customer_name TEXT := COALESCE(NULLIF(BTRIM(p_customer_name), ''), 'زبون نقدي');
  v_customer_identity_hash TEXT;
  v_actor_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_validated JSONB;
  v_cogs_allocation JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_final_instances JSONB;
  v_plan_components JSONB;
  v_line_weighted_keys JSONB;
  v_instance_weighted_keys JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_product public.products%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_parcel_instance_id UUID;
  v_order_number TEXT;
  v_shift_id UUID;
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_cogs BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_line_profit BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_paid BIGINT;
  v_change BIGINT;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_balance_after INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_component JSONB;
  v_movement_quantity INTEGER;
  v_constraint_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع نقطة البيع بالإصدار المحمي'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: المستخدم الحالي غير مصادق عليه.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: مفتاح إعادة المحاولة غير صالح.';
  END IF;
  IF p_warehouse_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_REQUIRED: المستودع والفرع مطلوبان.';
  END IF;
  IF COALESCE(p_discount_in_minor_units, -1) < 0
    OR COALESCE(p_amount_received_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_MONEY_INVALID: قيم الخصم أو المبلغ المستلم غير صالحة.';
  END IF;
  IF v_payment_method NOT IN (
    'cash', 'cliq', 'card', 'bank_transfer', 'debt', 'mixed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PAYMENT_METHOD_INVALID: طريقة الدفع غير معتمدة.';
  END IF;

  -- Cross-version order is deliberate: V1 and V2 first serialize on the exact
  -- same raw-key lock.  Only then may V2 enter its versioned operation lock.
  PERFORM pg_advisory_xact_lock(hashtext(v_key));

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'erp_user', v_user_id, NULL, NULL
  );
  IF p_customer_id IS NULL THEN
    v_customer_identity_hash := ENCODE(extensions.digest(
      'phase3:walk-in-customer:v1|' || LOWER(v_customer_name),
      'sha256'::TEXT
    ), 'hex');
  END IF;

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'erp_user',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'admin_pos',
    'warehouse_id', p_warehouse_id,
    'branch_id', p_branch_id,
    'customer_id', p_customer_id,
    'customer_identity_hash', v_customer_identity_hash,
    'payment_method', v_payment_method,
    'order_discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
    'amount_received_in_minor_units', COALESCE(p_amount_received_in_minor_units, 0),
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_pos_sale_v1', v_key, 'erp_user', v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  -- A key already consumed by V1 can never be reconstructed as a proven V2
  -- request.  Reject generically without exposing the historical order.
  IF EXISTS (
    SELECT 1 FROM public.orders existing_order
    WHERE existing_order.idempotency_key = v_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  PERFORM 1
  FROM public.warehouses warehouse
  WHERE warehouse.id = p_warehouse_id
    AND warehouse.branch_id = p_branch_id
    AND warehouse.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_LOCATION_INVALID: المستودع لا يتبع الفرع المحدد أو غير نشط.';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT customer.full_name INTO v_customer_name
    FROM public.customers customer
    WHERE customer.id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_CUSTOMER_INVALID: العميل المحدد غير موجود.';
    END IF;
  ELSIF v_payment_method = 'debt' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED: البيع الآجل يحتاج عميلاً مسجلاً.';
  END IF;

  -- Shift precedes configuration/product/inventory locks throughout the paid
  -- operational paths and their reversal orchestrator.
  SELECT shift.id INTO v_shift_id
  FROM public.cash_shifts shift
  WHERE shift.branch_id = p_branch_id AND shift.status = 'open'
  ORDER BY shift.id
  LIMIT 1
  FOR SHARE;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق قبل إتمام البيع.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'erp_user', v_user_id
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE COALESCE((candidate->>'line_discount_in_minor_units')::BIGINT, 0) <> 0
      OR candidate->>'price_authority' <> 'server_catalog'
      OR candidate->'commercial_unit_price_override_in_minor_units' <> 'null'::JSONB
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_PRICE_AUTHORITY_INVALID: هذا المسار يعتمد سعر الخادم وخصم الطلب الحالي فقط.';
  END IF;

  SELECT
    ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';

  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id
    FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id
    FOR SHARE;

    PERFORM family.id
    FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id
    FOR SHARE;
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

  -- Family is commercial identity, never stock identity. Keep its shared
  -- snapshot lock ahead of the global stock-product hierarchy, but never pass
  -- it to the inventory helper (which would attempt a row-lock upgrade).
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  -- Build a complete immutable plan before any business row is inserted.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_plan_instances := '[]'::JSONB;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الوحدة الأساسية غير صالح للبيع.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      v_line_cogs := v_base_quantity * v_product.cost_price_in_minor_units;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRODUCT_INVALID: منتج الطرد التجاري غير صالح للبيع.';
      END IF;
      IF v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: إعداد الطرد أو سعره تغير.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      IF v_base_quantity > 2147483647 THEN
        RAISE EXCEPTION USING ERRCODE = '22003',
          MESSAGE = 'PHASE3_POS_QUANTITY_OVERFLOW: كمية الوحدات الأساسية تتجاوز الحد الآمن.';
      END IF;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_line_cogs := v_base_quantity * v_product.cost_price_in_minor_units;
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
          MESSAGE = 'PHASE3_POS_PRICE_OR_PACKAGE_STALE: عائلة الطرد أو سعرها غير صالح.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel::BIGINT;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      v_line_cogs := 0;
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
          'erp_user', v_user_id, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_cogs_allocation := public.phase3_allocate_parcel_cogs_internal(
          v_validated->'components'
        );
        v_parcel_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'product_id', validated_component->>'product_id',
          'base_quantity', (validated_component->>'base_quantity')::INTEGER,
          'product_name_snapshot', validated_component->>'product_name_snapshot',
          'sku_snapshot', validated_component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(validated_component->>'base_unit_name_snapshot', ''),
            v_base_unit_name
          ),
          'unit_cost_in_minor_units_exact',
            (validated_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
          'exact_cogs_in_minor_units',
            (allocated_component->>'exact_cogs_in_minor_units')::NUMERIC,
          'allocated_cogs_in_minor_units',
            (allocated_component->>'allocated_cogs_in_minor_units')::BIGINT
        ) ORDER BY (validated_component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') validated_component
        JOIN JSONB_ARRAY_ELEMENTS(v_cogs_allocation->'components') allocated_component
          ON allocated_component->>'product_id' = validated_component->>'product_id';

        v_line_cogs := v_line_cogs
          + (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_parcel_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'allocated_discount_in_minor_units', 0,
          'net_refundable_amount_in_minor_units', v_unit_price,
          'cogs_in_minor_units',
            (v_cogs_allocation->>'total_cogs_in_minor_units')::BIGINT,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    IF v_line_gross < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_POS_MONEY_OVERFLOW: إجمالي السطر تجاوز الحد الآمن.';
    END IF;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
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
      'cogs_in_minor_units', v_line_cogs,
      'unit_cost_in_minor_units', CASE WHEN v_base_quantity = 0 THEN 0
        ELSE ROUND(v_line_cogs::NUMERIC / v_base_quantity)::BIGINT END,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF COALESCE(p_discount_in_minor_units, 0) > v_subtotal THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL: الخصم يتجاوز مجموع البيع.';
  END IF;
  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0);
  IF v_payment_method = 'cash'
    AND COALESCE(p_amount_received_in_minor_units, 0) > 0
    AND p_amount_received_in_minor_units < v_total
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_TENDER_INSUFFICIENT: المبلغ النقدي المستلم أقل من الإجمالي.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weighted_keys
  FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(
      COALESCE(p_discount_in_minor_units, 0), v_line_weighted_keys
    ) allocation
    WHERE allocation.allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_cogs := (v_line->>'cogs_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_line_profit := v_line_net - v_line_cogs;
    v_final_instances := v_line->'parcel_instances';

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weighted_keys
      FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances') instance;

      v_final_instances := '[]'::JSONB;
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(
          v_line_discount, v_instance_weighted_keys
        ) allocation
        WHERE allocation.allocation_key = v_instance->>'instance_sequence';
        v_instance_discount := COALESCE(v_instance_discount, 0);
        v_final_instances := v_final_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', v_instance_discount,
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - v_instance_discount
          )
        );
      END LOOP;
    END IF;

    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'profit_in_minor_units', v_line_profit,
        'parcel_instances', v_final_instances
      )
    );
  END LOOP;

  IF (SELECT COALESCE(SUM((line->>'allocated_discount_in_minor_units')::BIGINT), 0)
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line)
      IS DISTINCT FROM COALESCE(p_discount_in_minor_units, 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_DISCOUNT_RECONCILIATION_FAILED: تعذر توزيع الخصم بدقة.';
  END IF;

  -- Authoritative stock is rechecked only after every relevant balance is
  -- locked by the shared Phase-2/3 product protocol.
  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID AS product_id,
        (line->>'base_quantity')::INTEGER AS quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    )
    SELECT product_id, SUM(quantity)::INTEGER AS quantity
    FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = p_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PARCEL_COMPONENT_NOT_STOCKED: أحد مكونات البيع لا يملك رصيدًا في المستودع.';
    END IF;
    IF v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_INSUFFICIENT_INVENTORY: مخزون أحد مكونات البيع غير كافٍ.';
    END IF;
  END LOOP;

  v_paid := CASE WHEN v_payment_method = 'debt' THEN 0 ELSE v_total END;
  v_change := CASE WHEN v_payment_method = 'cash' THEN GREATEST(
    COALESCE(p_amount_received_in_minor_units, v_total) - v_total, 0
  ) ELSE 0 END;
  v_order_number := 'POS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
    || LPAD(NEXTVAL('public.pos_sale_number_seq')::TEXT, 6, '0');

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id',
    'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot',
    'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitsPerSalePackage', (line->>'units_per_parcel')::INTEGER,
    'salePackage', line->>'parcel_unit_name_snapshot',
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits',
      (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits',
      (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'cogsInMinorUnits', (line->>'cogs_in_minor_units')::BIGINT,
    'profitInMinorUnits', (line->>'profit_in_minor_units')::BIGINT,
    'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items
  FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;

  v_result := JSONB_BUILD_OBJECT(
    'success', true,
    'idempotentReplay', false,
    'operationId', v_operation_id,
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'customerName', v_customer_name,
    'warehouseId', p_warehouse_id,
    'branchId', p_branch_id,
    'cashShiftId', v_shift_id,
    'subtotalInMinorUnits', v_subtotal,
    'discountInMinorUnits', COALESCE(p_discount_in_minor_units, 0),
    'totalInMinorUnits', v_total,
    'amountPaidInMinorUnits', v_paid,
    'changeDueInMinorUnits', v_change,
    'paymentMethod', v_payment_method,
    'paymentStatus', CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
    'items', v_result_items,
    'message', 'تم حفظ بيع نقطة البيع بالإصدار المحمي وخصم الوحدات الأساسية بدقة.'
  );

  INSERT INTO public.business_operations (
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_pos_sale_v1', v_key, v_fingerprint, v_user_id,
    v_result, NOW(), 301, v_canonical_request, 'erp_user', v_actor_hash
  );

  BEGIN
    INSERT INTO public.orders (
      id, order_number, customer_id, customer_name_snapshot, branch_id,
      warehouse_id, status, payment_method, payment_status,
      subtotal_in_minor_units, delivery_fee_in_minor_units,
      discount_in_minor_units, total_in_minor_units,
      amount_paid_in_minor_units, change_due_in_minor_units,
      internal_notes, source, idempotency_key, operation_id
    ) VALUES (
      v_order_id, v_order_number, p_customer_id, v_customer_name, p_branch_id,
      p_warehouse_id, 'completed', v_payment_method,
      CASE WHEN v_payment_method = 'debt' THEN 'unpaid' ELSE 'paid' END,
      v_subtotal, 0, COALESCE(p_discount_in_minor_units, 0), v_total,
      v_paid, v_change, 'بيع POS V2 محمي', 'pos', v_key, v_operation_id
    );
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name = 'idx_orders_idempotency_key' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
    END IF;
    RAISE;
  END;

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items (
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      unit_cost_in_minor_units, cogs_in_minor_units, profit_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot',
      CASE WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'unit_cost_in_minor_units')::BIGINT,
      (v_line->>'cogs_in_minor_units')::BIGINT,
      (v_line->>'profit_in_minor_units')::BIGINT,
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

    -- The legacy insert trigger snapshots product cost.  Replace that draft
    -- value before any Parcel child exists, using the already planned COGS.
    UPDATE public.order_items
    SET unit_cost_in_minor_units = (v_line->>'unit_cost_in_minor_units')::BIGINT,
      cogs_in_minor_units = (v_line->>'cogs_in_minor_units')::BIGINT,
      profit_in_minor_units = (v_line->>'profit_in_minor_units')::BIGINT
    WHERE id = (v_line->>'order_item_id')::UUID;

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances (
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
          (v_instance->>'cogs_in_minor_units')::BIGINT,
          v_instance->>'composition_fingerprint'
        );

        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components (
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot',
            (v_component->>'unit_cost_in_minor_units_exact')::NUMERIC(24,6),
            (v_component->>'allocated_cogs_in_minor_units')::BIGINT
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Apply the planned stock effects in deterministic commercial/component
  -- order.  Every balance was already checked and locked above.
  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      v_movement_quantity := (v_line->>'base_quantity')::INTEGER;
      SELECT on_hand_quantity INTO v_on_hand
      FROM public.inventory_balances
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID
      FOR UPDATE;
      v_balance_after := v_on_hand - v_movement_quantity;
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_balance_after, updated_at = NOW()
      WHERE warehouse_id = p_warehouse_id
        AND product_id = (v_line->>'product_id')::UUID;
      INSERT INTO public.inventory_movements (
        warehouse_id, product_id, movement_type, quantity,
        balance_before, balance_after, reference_type, reference_id,
        notes, created_by, operation_id
      ) VALUES (
        p_warehouse_id, (v_line->>'product_id')::UUID,
        'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
        'pos_sale', v_order_id, 'بيع POS V2 رقم ' || v_order_number,
        v_user_id, v_operation_id
      );
    ELSE
      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN
          SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          v_movement_quantity := (v_component->>'base_quantity')::INTEGER;
          SELECT on_hand_quantity INTO v_on_hand
          FROM public.inventory_balances
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID
          FOR UPDATE;
          v_balance_after := v_on_hand - v_movement_quantity;
          UPDATE public.inventory_balances
          SET on_hand_quantity = v_balance_after, updated_at = NOW()
          WHERE warehouse_id = p_warehouse_id
            AND product_id = (v_component->>'product_id')::UUID;
          INSERT INTO public.inventory_movements (
            warehouse_id, product_id, movement_type, quantity,
            balance_before, balance_after, reference_type, reference_id,
            notes, created_by, operation_id, parcel_component_id
          ) VALUES (
            p_warehouse_id, (v_component->>'product_id')::UUID,
            'sales_deduction', -v_movement_quantity, v_on_hand, v_balance_after,
            'pos_sale', v_order_id, 'مكوّن طرد POS V2 رقم ' || v_order_number,
            v_user_id, v_operation_id, (v_component->>'component_id')::UUID
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by, notes
  ) VALUES (
    v_order_id, NULL, 'completed', v_user_id,
    'بيع POS V2 مكتمل وخصم ذري للوحدات الأساسية'
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'CREATE_POS_SALE_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT(
      'operation_id', v_operation_id,
      'order_number', v_order_number,
      'cash_shift_id', v_shift_id,
      'subtotal_in_minor_units', v_subtotal,
      'discount_in_minor_units', COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_total,
      'commercial_lines', JSONB_ARRAY_LENGTH(v_final_lines)
    )
  );

  RETURN v_result;
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

-- One immutable inventory projection is shared by reversal validation,
-- locking and restoration.  Configurable parents are deliberately excluded;
-- their stocked Components are the only inventory identities.
CREATE FUNCTION public.phase3_pos_reversal_inventory_rows_internal(
  p_order_id UUID
)
RETURNS TABLE(
  order_item_id UUID,
  product_id UUID,
  base_quantity INTEGER,
  parcel_component_id UUID,
  operation_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    item.id,
    item.product_id,
    item.quantity,
    NULL::UUID,
    orders.operation_id
  FROM public.order_items item
  JOIN public.orders orders ON orders.id = item.order_id
  WHERE item.order_id = p_order_id
    AND item.product_id IS NOT NULL
    AND item.commercial_line_kind IS DISTINCT FROM 'configurable_parcel'
  UNION ALL
  SELECT
    instance.order_item_id,
    component.product_id,
    component.base_quantity,
    component.id,
    component.operation_id
  FROM public.order_parcel_components component
  JOIN public.order_parcel_instances instance
    ON instance.id = component.parcel_instance_id
  JOIN public.order_items item ON item.id = instance.order_item_id
  WHERE instance.order_id = p_order_id
    AND item.commercial_line_kind = 'configurable_parcel';
$$;

REVOKE ALL ON FUNCTION public.phase3_pos_reversal_inventory_rows_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.phase3_pos_reversal_inventory_rows_internal(UUID)
  OWNER TO postgres;

-- Replace the existing public primitive without changing its signature,
-- grants, owner-only/AAL2 policy or whole-sale reversal semantics.
CREATE OR REPLACE FUNCTION public.reverse_pos_sale(
  p_order_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_existing public.pos_sale_reversals%ROWTYPE;
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_item RECORD;
  v_balance_before INTEGER;
  v_balance_after INTEGER;
  v_reserved INTEGER;
  v_cogs BIGINT := 0;
  v_profit BIGINT := 0;
  v_quantity INTEGER := 0;
  v_effect JSONB;
  v_product_ids UUID[];
  v_reversal_id UUID := gen_random_uuid();
BEGIN
  v_user_id := public.assert_reversal_owner('عكس بيع نقطة بيع مكتمل');
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_ORDER_REQUIRED: بيع نقطة البيع غير محدد.';
  END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_REASON_INVALID: سبب العكس غير صالح.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_KEY_INVALID: مفتاح منع التكرار غير صالح.';
  END IF;

  PERFORM SET_CONFIG('lock_timeout', '3s', true);
  PERFORM SET_CONFIG('statement_timeout', '30s', true);

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_ORDER_NOT_FOUND: بيع نقطة البيع غير موجود.';
  END IF;
  IF v_order.cash_shift_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_SHIFT_MISSING: البيع غير مرتبط بورديّة صريحة.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'cash-shift-full-reversal:' || v_order.cash_shift_id::TEXT, 0
  ));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'pos-sale-reversal:' || p_order_id::TEXT, 0
  ));

  SELECT * INTO v_shift FROM public.cash_shifts
  WHERE id = v_order.cash_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_SHIFT_CLOSED: لا يمكن العكس على ورديّة غير مفتوحة.';
  END IF;

  SELECT * INTO v_existing FROM public.pos_sale_reversals
  WHERE requested_by = v_user_id AND idempotency_key = v_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_id <> p_order_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_REVERSAL_IDEMPOTENCY_CONFLICT: مفتاح العكس مستخدم لبيع آخر.';
    END IF;
    RETURN JSONB_BUILD_OBJECT(
      'success', true,
      'idempotent', true,
      'reversal_id', v_existing.id,
      'order_id', v_existing.order_id,
      'cash_shift_id', v_existing.cash_shift_id,
      'actual_effect', v_existing.actual_effect
    );
  END IF;

  SELECT * INTO v_order FROM public.orders
  WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.source IS DISTINCT FROM 'pos'
    OR v_order.cash_shift_id <> v_shift.id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_ORDER_INVALID: السجل ليس بيع POS قابلاً للعكس.';
  END IF;

  SELECT * INTO v_existing FROM public.pos_sale_reversals
  WHERE order_id = p_order_id FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_DUPLICATE: تم عكس البيع مسبقًا.';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_ORDER_INVALID: البيع لم يعد مكتملًا قابلاً للعكس.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_payments payment
      WHERE payment.order_id = p_order_id)
    OR EXISTS (SELECT 1 FROM public.sales_returns return_row
      WHERE return_row.order_id = p_order_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_DEPENDENCY_EXISTS: توجد دفعة أو مرتجع مرتبط بالبيع.';
  END IF;

  SELECT ARRAY_AGG(DISTINCT inventory_row.product_id
    ORDER BY inventory_row.product_id)
  INTO v_product_ids
  FROM public.phase3_pos_reversal_inventory_rows_internal(p_order_id) inventory_row;
  IF COALESCE(CARDINALITY(v_product_ids), 0) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_INVENTORY_IDENTITY_MISSING: لا توجد حقيقة مخزون قابلة للعكس.';
  END IF;

  -- Reuse the same SKU advisory/balance/product hierarchy as sale and receipt.
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  -- Check chronology only after taking the shared product/balance lock hierarchy.
  -- This closes the race where a concurrent sale/receipt could commit between
  -- the chronology read and the inventory restoration.
  IF EXISTS (
    SELECT 1
    FROM public.phase3_pos_reversal_inventory_rows_internal(p_order_id) inventory_row
    JOIN public.inventory_movements movement
      ON movement.warehouse_id = v_order.warehouse_id
     AND movement.product_id = inventory_row.product_id
    WHERE movement.reference_id IS DISTINCT FROM p_order_id
      AND movement.created_at >= v_order.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_POS_REVERSAL_LATER_MOVEMENT: توجد حركة مخزون لاحقة على أحد أصناف البيع.';
  END IF;

  FOR v_item IN
    SELECT DISTINCT inventory_row.product_id
    FROM public.phase3_pos_reversal_inventory_rows_internal(p_order_id) inventory_row
    ORDER BY inventory_row.product_id
  LOOP
    SELECT balance.reserved_quantity INTO v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_item.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_reserved <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_POS_REVERSAL_INVENTORY_UNAVAILABLE: مخزون أحد الأصناف غير متاح أو محجوز.';
    END IF;
  END LOOP;

  SELECT
    COALESCE(SUM(item.cogs_in_minor_units), 0),
    COALESCE(SUM(item.profit_in_minor_units), 0)
  INTO v_cogs, v_profit
  FROM public.order_items item
  WHERE item.order_id = p_order_id;
  SELECT COALESCE(SUM(inventory_row.base_quantity), 0)::INTEGER
  INTO v_quantity
  FROM public.phase3_pos_reversal_inventory_rows_internal(p_order_id) inventory_row;

  v_effect := JSONB_BUILD_OBJECT(
    'payment_method', v_order.payment_method,
    'cash_in_minor_units', CASE WHEN v_order.payment_method = 'cash'
      THEN v_order.total_in_minor_units ELSE 0 END,
    'cliq_in_minor_units', CASE WHEN v_order.payment_method = 'cliq'
      THEN v_order.total_in_minor_units ELSE 0 END,
    'customer_receivable_in_minor_units', CASE WHEN v_order.payment_method = 'debt'
      THEN v_order.total_in_minor_units ELSE 0 END,
    'discount_in_minor_units', v_order.discount_in_minor_units,
    'cogs_in_minor_units', v_cogs,
    'profit_in_minor_units', v_profit,
    'restored_base_units', v_quantity
  );

  INSERT INTO public.pos_sale_reversals (
    id, order_id, cash_shift_id, requested_by, reason, idempotency_key,
    expected_effect, actual_effect
  ) VALUES (
    v_reversal_id, v_order.id, v_shift.id, v_user_id, v_reason, v_key,
    v_effect, v_effect
  );

  FOR v_item IN
    SELECT *
    FROM public.phase3_pos_reversal_inventory_rows_internal(p_order_id) inventory_row
    ORDER BY inventory_row.product_id,
      inventory_row.parcel_component_id NULLS FIRST,
      inventory_row.order_item_id
  LOOP
    SELECT balance.on_hand_quantity INTO v_balance_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_item.product_id
    FOR UPDATE;
    v_balance_after := v_balance_before + v_item.base_quantity;
    UPDATE public.inventory_balances
    SET on_hand_quantity = v_balance_after, updated_at = NOW()
    WHERE warehouse_id = v_order.warehouse_id
      AND product_id = v_item.product_id;

    INSERT INTO public.inventory_movements (
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id, parcel_component_id
    ) VALUES (
      v_order.warehouse_id, v_item.product_id, 'return_in',
      v_item.base_quantity, v_balance_before, v_balance_after,
      'pos_sale_reversal', v_reversal_id,
      'عكس بيع نقطة البيع ' || v_order.order_number, v_user_id,
      v_item.operation_id, v_item.parcel_component_id
    );
  END LOOP;

  UPDATE public.orders
  SET status = 'cancelled', amount_paid_in_minor_units = 0,
    change_due_in_minor_units = 0, updated_at = NOW()
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (
    order_id, old_status, new_status, changed_by, notes
  ) VALUES (
    v_order.id, 'completed', 'cancelled', v_user_id,
    'عكس POS موثق: ' || v_reason
  );

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id, 'REVERSE_POS_SALE', 'pos_sale_reversals', v_reversal_id,
    JSONB_BUILD_OBJECT(
      'order_id', v_order.id,
      'order_number', v_order.order_number,
      'cash_shift_id', v_shift.id,
      'reason', v_reason,
      'effect', v_effect
    )
  );

  RETURN JSONB_BUILD_OBJECT(
    'success', true,
    'idempotent', false,
    'reversal_id', v_reversal_id,
    'order_id', v_order.id,
    'cash_shift_id', v_shift.id,
    'actual_effect', v_effect
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT)
  TO authenticated;
ALTER FUNCTION public.reverse_pos_sale(UUID, TEXT, TEXT) OWNER TO postgres;

COMMIT;
