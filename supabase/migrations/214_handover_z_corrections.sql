-- Owner-approved Z2: future POS exact costs and historical Return valuation.
-- Full literal definitions; no catalog/text mutation at migration runtime.
BEGIN;
SET LOCAL lock_timeout='10s';

CREATE OR REPLACE FUNCTION public.parcel209_pos_sale_internal(p_warehouse_id uuid, p_branch_id uuid, p_customer_id uuid, p_customer_name text, p_payment_method text, p_lines jsonb, p_discount_in_minor_units bigint DEFAULT 0, p_amount_received_in_minor_units bigint DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_unit_cost_exact NUMERIC(24,6);
  v_line_exact_cogs NUMERIC(30,6);
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

  PERFORM public.parcel209_guard_modern_lines_internal(v_canonical_request->'lines');

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
    v_unit_cost_exact := NULL;
    v_line_exact_cogs := NULL;

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
      v_unit_cost_exact := COALESCE(v_product.wac_cost_in_minor_units_exact,
        v_product.cost_price_in_minor_units::NUMERIC);
      v_line_exact_cogs := ROUND(v_base_quantity::NUMERIC * v_unit_cost_exact, 6);
      -- Round once at the financial line boundary, never per physical unit.
      v_line_cogs := ROUND(v_line_exact_cogs)::BIGINT;
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
      v_unit_cost_exact := COALESCE(v_product.wac_cost_in_minor_units_exact,
        v_product.cost_price_in_minor_units::NUMERIC);
      v_line_exact_cogs := ROUND(v_base_quantity::NUMERIC * v_unit_cost_exact, 6);
      -- Round once at the financial line boundary, never per physical unit.
      v_line_cogs := ROUND(v_line_exact_cogs)::BIGINT;
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
      'unit_cost_snapshot_in_minor_units_exact', v_unit_cost_exact,
      'exact_cogs_snapshot_in_minor_units', v_line_exact_cogs,
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
      net_refundable_amount_snapshot_in_minor_units,
      unit_cost_snapshot_in_minor_units_exact, exact_cogs_snapshot_in_minor_units,
      cost_finalized_at
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
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT,
      (v_line->>'unit_cost_snapshot_in_minor_units_exact')::NUMERIC(24,6),
      (v_line->>'exact_cogs_snapshot_in_minor_units')::NUMERIC(30,6),
      CASE WHEN v_line->>'commercial_line_kind' IN ('base_unit','legacy_single_sku_parcel')
        THEN clock_timestamp() ELSE NULL END
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
$function$
;

CREATE OR REPLACE FUNCTION public.package_d_settle_sales_return_before_guard_internal(p_order_id uuid, p_idempotency_key text, p_items jsonb, p_reason text, p_refund_method text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_creation_type IS NULL OR v_creation_type NOT IN (
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
      PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_order_item.id,v_quantity);
      IF v_order_item.commercial_line_kind IS NULL OR v_order_item.commercial_line_kind NOT IN ('base_unit','legacy_single_sku_parcel')
        OR v_order_item.product_id IS NULL
        OR v_order_item.quantity <= 0
        OR v_order_item.net_refundable_amount_snapshot_in_minor_units IS NULL
        OR v_order_item.cogs_in_minor_units IS NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE42_BASE_SALE_EVIDENCE_MISSING: Base Unit sale evidence is incomplete.';
      END IF;

      SELECT COALESCE(SUM(item.returned_quantity), 0)::INTEGER,
        COALESCE(SUM(item.refund_amount_snapshot_in_minor_units + item.applied_customer_damage_deduction_in_minor_units), 0)::BIGINT,
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
      v_rejected := COALESCE((v_item->>'customer_damage_quantity')::INTEGER,0);
      v_accepted := v_quantity-v_rejected;
      -- One inspected damaged carton per logical item prevents one carton's
      -- damage from consuming another carton's refundable entitlement.
      IF v_rejected>0 AND v_quantity IS DISTINCT FROM v_order_item.units_per_sale_package THEN
        RAISE EXCEPTION USING ERRCODE='22023',
          MESSAGE='PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE: افحص ضرر العميل بمرتجع مستقل لكل كرتونة حتى يبقى الخصم ضمن استحقاقها الأصلي.';
      END IF;
      IF v_rejected>0 AND v_order_item.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PACKAGE_D_CARTON_INSPECTION_INVALID: Damage inspection requires a carton.';
      END IF;
      IF v_rejected>0 AND v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='P0001',
          MESSAGE='PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING: هذا البيع القديم لا يحتوي سعر القطعة التاريخي؛ لا يمكن تسوية ضرر العميل. مرتجع السليم وعيب المورد متاحان.';
      END IF;
      v_raw_damage := v_rejected::BIGINT*COALESCE(v_order_item.effective_standalone_unit_sale_price_snapshot_in_minor_units,0);
      v_applied_damage := LEAST(v_item_refund,v_raw_damage);
      v_item_refund := v_item_refund-v_applied_damage;
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
        v_unit_cost_exact := COALESCE(v_order_item.unit_cost_snapshot_in_minor_units_exact,
          v_order_item.unit_cost_in_minor_units::NUMERIC);
      END IF;
      v_item_stock_disposition := v_item->>'stock_disposition';
      IF v_item_stock_disposition = 'restock' AND v_accepted>0 THEN
        v_historical_value := ROUND(v_unit_cost_exact * v_accepted, 6);
        v_inventory_sources := v_inventory_sources || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'source_kind', 'base_order_item',
            'source_id', v_order_item.id,
            'return_item_id', v_return_item_id,
            'product_id', v_order_item.product_id,
            'quantity', v_accepted,
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
          'accepted_quantity', v_accepted,
          'rejected_quantity', v_rejected,
          'original_cogs', v_item_cogs,
          'raw_damage', v_raw_damage,
          'applied_damage', v_applied_damage,
          'components', '[]'::JSONB
        )
      );
      v_total_entitlement := v_total_entitlement + v_item_refund;
      v_total_raw_damage := v_total_raw_damage + v_raw_damage;
      v_total_applied_damage := v_total_applied_damage + v_applied_damage;
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
    || UPPER(SUBSTRING(REGEXP_REPLACE(v_operation_id::TEXT, '-', '', 'g') FROM 1 FOR 12));
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
$function$
;

CREATE OR REPLACE FUNCTION public.phase42_expected_return_effects_pre43_internal(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        ELSE COALESCE(order_item.unit_cost_snapshot_in_minor_units_exact,
          order_item.unit_cost_in_minor_units::NUMERIC)
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
          ELSE COALESCE(order_item.unit_cost_snapshot_in_minor_units_exact,
          order_item.unit_cost_in_minor_units::NUMERIC)
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
$function$
;

COMMIT;
