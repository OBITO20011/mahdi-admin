BEGIN;

-- ============================================================================
-- Nawasrah ERP - Phase 3.1 configurable Parcel sales contracts and primitives
--
-- This migration is additive infrastructure only. It deliberately creates no
-- public sale/reservation coordinator and performs no historical backfill.
-- Completed Phase-3 operations remain single-transaction, immutable records.
-- ============================================================================

ALTER TABLE public.business_operations
  ADD COLUMN actor_scope_type TEXT,
  ADD COLUMN actor_scope_hash TEXT,
  ADD CONSTRAINT business_operations_actor_scope_shape_check CHECK (
    (actor_scope_type IS NULL AND actor_scope_hash IS NULL)
    OR (
      actor_scope_type IN ('erp_user', 'guest_gateway')
      AND actor_scope_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  ADD CONSTRAINT business_operations_phase3_shape_check CHECK (
    operation_type NOT IN (
      'phase3_pos_sale_v1',
      'phase3_customer_reservation_v1'
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
        OR (actor_scope_type = 'guest_gateway' AND initiated_by IS NULL)
      )
    )
  );

COMMENT ON COLUMN public.business_operations.actor_scope_type IS
  'Versioned Phase-3 actor namespace. NULL preserves older operation contracts.';
COMMENT ON COLUMN public.business_operations.actor_scope_hash IS
  'Privacy-safe Phase-3 actor correlation hash. Never stores raw phone, IP, session or token material.';

CREATE UNIQUE INDEX uq_business_operations_phase3_idempotency
  ON public.business_operations(operation_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND operation_type IN (
      'phase3_pos_sale_v1',
      'phase3_customer_reservation_v1'
    );

-- Authenticated clients previously had whole-row SELECT on this table from the
-- Phase-1 foundation. Preserve operational traceability while hiding request
-- fingerprints, actor correlation hashes and immutable request/result payloads.
REVOKE SELECT ON TABLE public.business_operations FROM authenticated;
GRANT SELECT (
  id, operation_type, initiated_by, created_at, completed_at
) ON public.business_operations TO authenticated;

CREATE FUNCTION public.phase3_actor_scope_hash_internal(
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
    IF p_erp_user_id IS NULL
      OR p_guest_phone_hash IS NOT NULL
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
    -- IP is intentionally excluded. It is abuse-control context, not durable
    -- business identity. Inputs are already server-HMAC values from the gateway.
    v_material := 'phase3:guest_gateway:v1|'
      || p_guest_phone_hash || '|' || p_guest_session_hash;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_SCOPE_INVALID: Unsupported actor scope.';
  END IF;

  RETURN ENCODE(extensions.digest(v_material, 'sha256'::TEXT), 'hex');
END;
$$;

CREATE FUNCTION public.phase3_require_uuid_internal(
  p_value TEXT,
  p_field TEXT
)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(BTRIM(p_value), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Missing ' || p_field || '.';
  END IF;
  RETURN BTRIM(p_value)::UUID;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Invalid ' || p_field || '.';
END;
$$;

CREATE FUNCTION public.phase3_require_positive_integer_internal(
  p_value TEXT,
  p_field TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value NUMERIC;
BEGIN
  IF COALESCE(BTRIM(p_value), '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Invalid positive ' || p_field || '.';
  END IF;
  v_value := BTRIM(p_value)::NUMERIC;
  IF v_value > 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: ' || p_field || ' exceeds integer capacity.';
  END IF;
  RETURN v_value::INTEGER;
END;
$$;

CREATE FUNCTION public.phase3_require_nonnegative_bigint_internal(
  p_value TEXT,
  p_field TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value NUMERIC;
BEGIN
  IF COALESCE(BTRIM(p_value), '') !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Invalid nonnegative ' || p_field || '.';
  END IF;
  v_value := BTRIM(p_value)::NUMERIC;
  IF v_value > 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: ' || p_field || ' exceeds bigint capacity.';
  END IF;
  RETURN v_value::BIGINT;
END;
$$;

CREATE FUNCTION public.phase3_canonicalize_components_internal(p_components JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_component JSONB;
  v_total BIGINT;
  v_result JSONB;
BEGIN
  IF JSONB_TYPEOF(p_components) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_components) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Parcel components must be a non-empty array.';
  END IF;
  IF JSONB_ARRAY_LENGTH(p_components) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED: Parcel component entry limit exceeded.';
  END IF;

  FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_components)
  LOOP
    IF JSONB_TYPEOF(v_component) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Parcel component must be an object.';
    END IF;
    PERFORM public.phase3_require_uuid_internal(
      v_component->>'product_id', 'component product_id'
    );
    PERFORM public.phase3_require_positive_integer_internal(
      v_component->>'base_quantity', 'component base_quantity'
    );
  END LOOP;

  SELECT SUM(quantity), JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'product_id', LOWER(product_id::TEXT),
      'base_quantity', quantity
    )
    ORDER BY product_id
  )
  INTO v_total, v_result
  FROM (
    SELECT
      (component->>'product_id')::UUID AS product_id,
      SUM((component->>'base_quantity')::BIGINT) AS quantity
    FROM JSONB_ARRAY_ELEMENTS(p_components) component
    GROUP BY (component->>'product_id')::UUID
  ) normalized;

  IF v_total > 2147483647
    OR EXISTS (
      SELECT 1
      FROM JSONB_ARRAY_ELEMENTS(v_result) component
      WHERE (component->>'base_quantity')::NUMERIC > 2147483647
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Parcel component quantity exceeds integer capacity.';
  END IF;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.phase3_request_fingerprint_internal(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ENCODE(extensions.digest(p_payload::TEXT, 'sha256'::TEXT), 'hex');
$$;

CREATE FUNCTION public.phase3_canonicalize_sale_request_internal(p_request JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_scope_type TEXT;
  v_actor_scope_hash TEXT;
  v_source TEXT;
  v_lines JSONB;
  v_line JSONB;
  v_line_kind TEXT;
  v_canonical_lines JSONB := '[]'::JSONB;
  v_canonical_line JSONB;
  v_instances JSONB;
  v_instance JSONB;
  v_canonical_instances JSONB;
  v_canonical_components JSONB;
  v_instance_fingerprint TEXT;
  v_line_discount BIGINT;
  v_price_override BIGINT;
  v_price_authority TEXT;
  v_total_commercial_quantity BIGINT := 0;
  v_total_instances INTEGER := 0;
  v_branch_id UUID;
  v_customer_id UUID;
  v_customer_hash TEXT;
  v_delivery_hash TEXT;
  v_amount_received BIGINT;
BEGIN
  IF JSONB_TYPEOF(p_request) IS DISTINCT FROM 'object'
    OR p_request->>'contract_version' IS DISTINCT FROM 'phase3-sale-v1'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Unsupported sale contract version.';
  END IF;

  v_actor_scope_type := LOWER(NULLIF(BTRIM(p_request->>'actor_scope_type'), ''));
  v_actor_scope_hash := LOWER(NULLIF(BTRIM(p_request->>'actor_scope_hash'), ''));
  v_source := LOWER(NULLIF(BTRIM(p_request->>'operation_source'), ''));
  IF v_actor_scope_type NOT IN ('erp_user', 'guest_gateway')
    OR COALESCE(v_actor_scope_hash, '') !~ '^[0-9a-f]{64}$'
    OR v_source NOT IN ('admin_pos', 'customer_reservation')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Actor or operation source is invalid.';
  END IF;

  PERFORM public.phase3_require_uuid_internal(
    p_request->>'warehouse_id', 'warehouse_id'
  );
  IF NULLIF(BTRIM(p_request->>'branch_id'), '') IS NOT NULL THEN
    v_branch_id := public.phase3_require_uuid_internal(
      p_request->>'branch_id', 'branch_id'
    );
  END IF;
  IF NULLIF(BTRIM(p_request->>'customer_id'), '') IS NOT NULL THEN
    v_customer_id := public.phase3_require_uuid_internal(
      p_request->>'customer_id', 'customer_id'
    );
  END IF;

  v_customer_hash := LOWER(NULLIF(BTRIM(p_request->>'customer_identity_hash'), ''));
  v_delivery_hash := LOWER(NULLIF(BTRIM(p_request->>'delivery_identity_hash'), ''));
  IF (v_customer_hash IS NOT NULL AND v_customer_hash !~ '^[0-9a-f]{64}$')
    OR (v_delivery_hash IS NOT NULL AND v_delivery_hash !~ '^[0-9a-f]{64}$')
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Privacy-safe customer or delivery identity is invalid.';
  END IF;

  IF NULLIF(BTRIM(p_request->>'amount_received_in_minor_units'), '') IS NOT NULL THEN
    v_amount_received := public.phase3_require_nonnegative_bigint_internal(
      p_request->>'amount_received_in_minor_units',
      'amount_received_in_minor_units'
    );
  END IF;

  v_lines := p_request->'lines';
  IF JSONB_TYPEOF(v_lines) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(v_lines) = 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Sale lines must be a non-empty array.';
  END IF;
  IF JSONB_ARRAY_LENGTH(v_lines) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED: Commercial line limit exceeded.';
  END IF;

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_lines)
  LOOP
    IF JSONB_TYPEOF(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Sale line must be an object.';
    END IF;
    v_line_kind := LOWER(NULLIF(BTRIM(v_line->>'commercial_line_kind'), ''));
    IF v_line_kind NOT IN (
      'base_unit', 'legacy_single_sku_parcel', 'configurable_parcel'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Unsupported commercial line kind.';
    END IF;

    v_line_discount := public.phase3_require_nonnegative_bigint_internal(
      COALESCE(NULLIF(BTRIM(v_line->>'line_discount_in_minor_units'), ''), '0'),
      'line_discount_in_minor_units'
    );
    v_price_authority := LOWER(COALESCE(
      NULLIF(BTRIM(v_line->>'price_authority'), ''), 'server_catalog'
    ));
    v_price_override := NULL;
    IF NULLIF(BTRIM(v_line->>'commercial_unit_price_override_in_minor_units'), '')
      IS NOT NULL
    THEN
      v_price_override := public.phase3_require_nonnegative_bigint_internal(
        v_line->>'commercial_unit_price_override_in_minor_units',
        'commercial_unit_price_override_in_minor_units'
      );
    END IF;
    IF (v_price_authority = 'server_catalog' AND v_price_override IS NOT NULL)
      OR (v_price_authority = 'authorized_override' AND v_price_override IS NULL)
      OR v_price_authority NOT IN ('server_catalog', 'authorized_override')
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Price authority and override are inconsistent.';
    END IF;

    IF v_line_kind = 'base_unit' THEN
      v_canonical_line := JSONB_BUILD_OBJECT(
        'commercial_line_kind', v_line_kind,
        'product_id', LOWER(public.phase3_require_uuid_internal(
          v_line->>'product_id', 'base-unit product_id'
        )::TEXT),
        'base_quantity', public.phase3_require_positive_integer_internal(
          v_line->>'base_quantity', 'base_quantity'
        ),
        'price_authority', v_price_authority,
        'commercial_unit_price_override_in_minor_units', v_price_override,
        'line_discount_in_minor_units', v_line_discount
      );
      v_total_commercial_quantity := v_total_commercial_quantity
        + (v_canonical_line->>'base_quantity')::INTEGER;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      v_canonical_line := JSONB_BUILD_OBJECT(
        'commercial_line_kind', v_line_kind,
        'product_id', LOWER(public.phase3_require_uuid_internal(
          v_line->>'product_id', 'legacy parcel product_id'
        )::TEXT),
        'parcel_quantity', public.phase3_require_positive_integer_internal(
          v_line->>'parcel_quantity', 'parcel_quantity'
        ),
        'units_per_parcel', public.phase3_require_positive_integer_internal(
          v_line->>'units_per_parcel', 'units_per_parcel'
        ),
        'price_authority', v_price_authority,
        'commercial_unit_price_override_in_minor_units', v_price_override,
        'line_discount_in_minor_units', v_line_discount
      );
      v_total_commercial_quantity := v_total_commercial_quantity
        + (v_canonical_line->>'parcel_quantity')::INTEGER;
    ELSE
      v_instances := v_line->'parcel_instances';
      IF JSONB_TYPEOF(v_instances) IS DISTINCT FROM 'array'
        OR JSONB_ARRAY_LENGTH(v_instances) = 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Configurable Parcel requires instances.';
      END IF;
      IF JSONB_ARRAY_LENGTH(v_instances) > 200
        OR v_total_instances + JSONB_ARRAY_LENGTH(v_instances) > 200
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED: Parcel Instance limit exceeded.';
      END IF;

      v_canonical_instances := '[]'::JSONB;
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instances)
      LOOP
        IF JSONB_TYPEOF(v_instance) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Parcel Instance must be an object.';
        END IF;
        v_canonical_components := public.phase3_canonicalize_components_internal(
          v_instance->'components'
        );
        v_instance_fingerprint := public.phase3_request_fingerprint_internal(
          v_canonical_components
        );
        v_canonical_instances := v_canonical_instances || JSONB_BUILD_ARRAY(
          JSONB_BUILD_OBJECT(
            'composition_fingerprint', v_instance_fingerprint,
            'components', v_canonical_components
          )
        );
      END LOOP;

      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'instance_sequence', sequence,
          'composition_fingerprint', item->>'composition_fingerprint',
          'components', item->'components'
        )
        ORDER BY sequence
      )
      INTO v_canonical_instances
      FROM (
        SELECT
          value AS item,
          ROW_NUMBER() OVER (
            ORDER BY value->>'composition_fingerprint', value::TEXT
          )::INTEGER AS sequence
        FROM JSONB_ARRAY_ELEMENTS(v_canonical_instances)
      ) ordered_instances;

      v_canonical_line := JSONB_BUILD_OBJECT(
        'commercial_line_kind', v_line_kind,
        'family_product_id', LOWER(public.phase3_require_uuid_internal(
          v_line->>'family_product_id', 'family_product_id'
        )::TEXT),
        'parcel_configuration_id', LOWER(public.phase3_require_uuid_internal(
          v_line->>'parcel_configuration_id', 'parcel_configuration_id'
        )::TEXT),
        'configuration_revision', public.phase3_require_positive_integer_internal(
          v_line->>'configuration_revision', 'configuration_revision'
        ),
        'parcel_quantity', JSONB_ARRAY_LENGTH(v_canonical_instances),
        'parcel_instances', v_canonical_instances,
        'price_authority', v_price_authority,
        'commercial_unit_price_override_in_minor_units', v_price_override,
        'line_discount_in_minor_units', v_line_discount
      );
      v_total_instances := v_total_instances
        + JSONB_ARRAY_LENGTH(v_canonical_instances);
      v_total_commercial_quantity := v_total_commercial_quantity
        + JSONB_ARRAY_LENGTH(v_canonical_instances);
    END IF;

    v_canonical_lines := v_canonical_lines || JSONB_BUILD_ARRAY(v_canonical_line);
  END LOOP;

  IF v_total_commercial_quantity > 10000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_REQUEST_LIMIT_EXCEEDED: Total commercial quantity limit exceeded.';
  END IF;

  SELECT JSONB_AGG(value ORDER BY value::TEXT)
  INTO v_canonical_lines
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_lines);

  RETURN JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', v_actor_scope_type,
    'actor_scope_hash', v_actor_scope_hash,
    'operation_source', v_source,
    'warehouse_id', LOWER((p_request->>'warehouse_id')::UUID::TEXT),
    'branch_id', CASE WHEN v_branch_id IS NULL THEN NULL ELSE LOWER(v_branch_id::TEXT) END,
    'customer_id', CASE WHEN v_customer_id IS NULL THEN NULL ELSE LOWER(v_customer_id::TEXT) END,
    'customer_identity_hash', v_customer_hash,
    'delivery_identity_hash', v_delivery_hash,
    'payment_method', LOWER(NULLIF(BTRIM(p_request->>'payment_method'), '')),
    'delivery_zone', LOWER(NULLIF(BTRIM(p_request->>'delivery_zone'), '')),
    'promotion_code', UPPER(NULLIF(BTRIM(p_request->>'promotion_code'), '')),
    'order_discount_in_minor_units',
      public.phase3_require_nonnegative_bigint_internal(
        COALESCE(NULLIF(BTRIM(p_request->>'order_discount_in_minor_units'), ''), '0'),
        'order_discount_in_minor_units'
      ),
    'amount_received_in_minor_units', v_amount_received,
    'lines', v_canonical_lines
  );
END;
$$;

CREATE FUNCTION public.phase3_resolve_operation_replay_internal(
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
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) OR v_key IS NULL OR CHAR_LENGTH(v_key) > 255
    OR v_scope_type NOT IN ('erp_user', 'guest_gateway')
    OR COALESCE(v_scope_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(v_fingerprint, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Invalid operation identity.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase3-operation:' || v_operation_type || ':' || v_key,
    0
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
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  IF v_operation.request_identity_version IS DISTINCT FROM 301
    OR v_operation.request_identity_snapshot IS NULL
    OR v_operation.request_fingerprint IS NULL
    OR v_operation.result_snapshot IS NULL
    OR v_operation.completed_at IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_OPERATION_IDENTITY_UNPROVEN: Stored operation identity is incomplete.';
  END IF;

  IF v_operation.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'decision', 'REPLAY',
    'operation_id', v_operation.id,
    'result_snapshot', v_operation.result_snapshot
  );
END;
$$;

CREATE FUNCTION public.phase3_assert_configurable_parcel_creation_allowed_internal(
  p_actor_scope_type TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope_type TEXT := LOWER(NULLIF(BTRIM(p_actor_scope_type), ''));
  v_state TEXT := public.get_configurable_parcel_feature_state();
BEGIN
  IF v_scope_type = 'erp_user' THEN
    IF p_actor_user_id IS NULL
      OR auth.uid() IS NULL
      OR p_actor_user_id IS DISTINCT FROM auth.uid()
      OR NOT public.is_active_erp_staff()
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: ERP actor is not authorized.';
    END IF;
  ELSIF v_scope_type = 'guest_gateway' THEN
    IF p_actor_user_id IS NOT NULL OR auth.role() IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Guest gateway proof is invalid.';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Unsupported actor scope.';
  END IF;

  IF v_state = 'ENABLED' THEN
    RETURN;
  END IF;
  IF v_state = 'OWNER_PILOT'
    AND v_scope_type = 'erp_user'
    AND public.has_erp_role(ARRAY['owner'])
  THEN
    RETURN;
  END IF;

  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'CONFIGURABLE_PARCEL_DISABLED: الوظيفة غير مفعلة لإنشاء عمليات جديدة.';
END;
$$;

CREATE FUNCTION public.phase3_lock_inventory_products_internal(p_product_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Reuse the proven Phase-2 global product/balance hierarchy rather than
  -- creating a competing sale-specific order.
  PERFORM public.phase2_lock_inventory_products_internal(p_product_ids);
END;
$$;

CREATE FUNCTION public.phase3_validate_configurable_parcel_internal(
  p_actor_scope_type TEXT,
  p_actor_user_id UUID,
  p_family_product_id UUID,
  p_parcel_configuration_id UUID,
  p_configuration_revision INTEGER,
  p_components JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_capacity INTEGER;
  v_family_is_master BOOLEAN;
  v_components JSONB;
  v_component_total BIGINT;
  v_product_ids UUID[];
  v_invalid_count INTEGER;
  v_missing_wac_count INTEGER;
  v_enriched JSONB;
BEGIN
  PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
    p_actor_scope_type, p_actor_user_id
  );

  IF p_configuration_revision IS NULL OR p_configuration_revision <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel configuration revision is invalid.';
  END IF;

  SELECT * INTO v_configuration
  FROM public.product_parcel_configurations configuration
  WHERE configuration.id = p_parcel_configuration_id
  FOR SHARE;

  IF NOT FOUND
    OR NOT v_configuration.is_active
    OR v_configuration.composition_mode <> 'configurable_mix'
    OR v_configuration.family_product_id IS DISTINCT FROM p_family_product_id
    OR v_configuration.configuration_revision IS DISTINCT FROM p_configuration_revision
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel configuration is unavailable or changed.';
  END IF;

  SELECT product.units_per_sale_unit, product.is_flavor_master
  INTO v_capacity, v_family_is_master
  FROM public.products product
  WHERE product.id = p_family_product_id
    AND product.is_active
  FOR SHARE;

  IF NOT FOUND OR NOT v_family_is_master OR COALESCE(v_capacity, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel Family is not a valid configurable stock family.';
  END IF;

  v_components := public.phase3_canonicalize_components_internal(p_components);
  SELECT
    SUM((component->>'base_quantity')::BIGINT),
    ARRAY_AGG((component->>'product_id')::UUID ORDER BY (component->>'product_id')::UUID)
  INTO v_component_total, v_product_ids
  FROM JSONB_ARRAY_ELEMENTS(v_components) component;

  IF v_component_total IS DISTINCT FROM v_capacity::BIGINT THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase3_parcel_capacity_check',
      MESSAGE = 'PARCEL_CAPACITY_MISMATCH: Parcel composition must equal configured capacity.';
  END IF;

  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  SELECT COUNT(*) FILTER (
    WHERE NOT product.is_active
      OR product.is_flavor_master
      OR COALESCE(product.flavor_master_product_id, product.id)
        IS DISTINCT FROM p_family_product_id
  ), COUNT(*) FILTER (
    WHERE product.wac_cost_in_minor_units_exact IS NULL
  )
  INTO v_invalid_count, v_missing_wac_count
  FROM public.products product
  WHERE product.id = ANY(v_product_ids);

  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      CONSTRAINT = 'phase3_parcel_component_family_check',
      MESSAGE = 'PARCEL_COMPONENT_FAMILY_MISMATCH: Parcel component is not a stocked SKU in the configured Family.';
  END IF;
  IF v_missing_wac_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_EXACT_WAC_UNAVAILABLE: Exact WAC is required for configurable Parcel sale.';
  END IF;

  SELECT JSONB_AGG(
    JSONB_BUILD_OBJECT(
      'product_id', LOWER(product.id::TEXT),
      'base_quantity', (component->>'base_quantity')::INTEGER,
      'product_name_snapshot', product.name_ar,
      'sku_snapshot', product.sku,
      'base_unit_name_snapshot', unit.name_ar,
      'unit_cost_in_minor_units_exact', product.wac_cost_in_minor_units_exact
    )
    ORDER BY product.id
  )
  INTO v_enriched
  FROM JSONB_ARRAY_ELEMENTS(v_components) component
  JOIN public.products product
    ON product.id = (component->>'product_id')::UUID
  LEFT JOIN public.units unit ON unit.id = product.unit_id;

  RETURN JSONB_BUILD_OBJECT(
    'family_product_id', LOWER(p_family_product_id::TEXT),
    'parcel_configuration_id', LOWER(p_parcel_configuration_id::TEXT),
    'configuration_revision', p_configuration_revision,
    'units_per_parcel', v_component_total,
    'composition_fingerprint', public.phase3_request_fingerprint_internal(v_components),
    'components', v_enriched
  );
END;
$$;

CREATE FUNCTION public.phase3_allocate_parcel_cogs_internal(p_components JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_duplicate_count INTEGER;
BEGIN
  IF JSONB_TYPEOF(p_components) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_components) = 0
    OR JSONB_ARRAY_LENGTH(p_components) > 200
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_COGS_INPUT_INVALID: COGS components are invalid.';
  END IF;

  SELECT COUNT(*) - COUNT(DISTINCT component->>'product_id')
  INTO v_duplicate_count
  FROM JSONB_ARRAY_ELEMENTS(p_components) component;
  IF v_duplicate_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_COGS_INPUT_INVALID: COGS components must be canonical and unique.';
  END IF;

  BEGIN
    WITH parsed AS (
      SELECT
        (component->>'product_id')::UUID AS product_id,
        (component->>'base_quantity')::INTEGER AS base_quantity,
        (component->>'unit_cost_in_minor_units_exact')::NUMERIC(24, 6)
          AS unit_cost,
        (component->>'base_quantity')::INTEGER
          * (component->>'unit_cost_in_minor_units_exact')::NUMERIC(24, 6)
          AS exact_cost
      FROM JSONB_ARRAY_ELEMENTS(p_components) component
    ), validated AS (
      SELECT * FROM parsed
      WHERE base_quantity > 0 AND unit_cost >= 0
    ), totals AS (
      SELECT
        ROUND(SUM(exact_cost), 0)::BIGINT AS target_total,
        SUM(FLOOR(exact_cost))::BIGINT AS floor_total,
        COUNT(*)::INTEGER AS item_count
      FROM validated
    ), ranked AS (
      SELECT
        validated.*,
        FLOOR(exact_cost)::BIGINT AS floor_cost,
        ROW_NUMBER() OVER (
          ORDER BY exact_cost - FLOOR(exact_cost) DESC, product_id
        )::BIGINT AS residual_rank,
        totals.target_total,
        totals.target_total - totals.floor_total AS residual,
        totals.item_count
      FROM validated CROSS JOIN totals
    )
    SELECT JSONB_BUILD_OBJECT(
      'rounding_boundary', 'parcel_instance',
      'total_cogs_in_minor_units', MAX(target_total),
      'components', JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'product_id', LOWER(product_id::TEXT),
          'base_quantity', base_quantity,
          'unit_cost_in_minor_units_exact', unit_cost,
          'exact_cogs_in_minor_units', exact_cost,
          'allocated_cogs_in_minor_units',
            floor_cost + CASE WHEN residual_rank <= residual THEN 1 ELSE 0 END
        )
        ORDER BY product_id
      )
    )
    INTO v_result
    FROM ranked;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_COGS_INPUT_INVALID: COGS component values are malformed.';
  END;

  IF v_result IS NULL
    OR JSONB_ARRAY_LENGTH(v_result->'components') <> JSONB_ARRAY_LENGTH(p_components)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_COGS_INPUT_INVALID: COGS component values are invalid.';
  END IF;

  RETURN v_result;
END;
$$;

CREATE UNIQUE INDEX uq_order_inventory_reservations_active_identity
  ON public.order_inventory_reservations(
    order_id,
    order_item_id,
    COALESCE(parcel_instance_id, '00000000-0000-0000-0000-000000000000'::UUID),
    warehouse_id,
    product_id
  )
  WHERE reservation_state = 'active';

CREATE INDEX idx_order_inventory_reservations_operation_id
  ON public.order_inventory_reservations(operation_id);

CREATE OR REPLACE FUNCTION public.validate_order_inventory_reservation_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_kind TEXT;
  v_order_item_product_id UUID;
  v_component_quantity INTEGER;
  v_component_count INTEGER;
  v_instance_finalized_at TIMESTAMPTZ;
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

    SELECT
      SUM(component.base_quantity)::INTEGER,
      COUNT(*)::INTEGER,
      MAX(instance.finalized_at)
    INTO v_component_quantity, v_component_count, v_instance_finalized_at
    FROM public.order_parcel_components component
    JOIN public.order_parcel_instances instance
      ON instance.id = component.parcel_instance_id
    WHERE component.parcel_instance_id = NEW.parcel_instance_id
      AND component.product_id = NEW.product_id
      AND component.operation_id = NEW.operation_id
      AND instance.order_item_id = NEW.order_item_id
      AND instance.order_id = NEW.order_id;

    -- The Phase-1 contract permits a component reservation smaller than the
    -- immutable component quantity. The later coordinator is responsible for
    -- atomically reserving the full composition; this generic relationship
    -- guard only prevents an untraceable or over-capacity component hold.
    -- Missing/cross-chain component identity is left to the existing composite
    -- foreign keys so their established SQLSTATE/constraint identities remain
    -- backward compatible. This guard adds only finalized/quantity semantics.
    IF v_component_count > 0
      AND (
        v_instance_finalized_at IS NULL
        OR NEW.reserved_quantity > v_component_quantity
      )
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_inventory_reservations_component_quantity_check',
        MESSAGE = 'PARCEL_RESERVATION_COMPONENT_MISMATCH: Reservation must reference a finalized Parcel component without exceeding its Base Unit quantity.';
    END IF;
  ELSE
    IF NEW.parcel_instance_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'order_inventory_reservations_base_parcel_absent_check',
        MESSAGE = 'A Base Unit reservation cannot claim a Parcel Instance.';
    END IF;
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

COMMENT ON INDEX public.uq_order_inventory_reservations_active_identity IS
  'Prevents duplicate active holds for one logical commercial/component reservation identity.';
COMMENT ON FUNCTION public.phase3_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'Read-only Phase-3 replay/conflict resolver. It never creates placeholder operations and must run before current feature/config validation.';
COMMENT ON FUNCTION public.phase3_allocate_parcel_cogs_internal(JSONB) IS
  'Pure per-Parcel-Instance exact-WAC projection with deterministic largest-remainder minor-unit allocation.';

ALTER FUNCTION public.phase3_actor_scope_hash_internal(TEXT, UUID, TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_require_uuid_internal(TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase3_require_positive_integer_internal(TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_require_nonnegative_bigint_internal(TEXT, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_canonicalize_components_internal(JSONB)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_request_fingerprint_internal(JSONB)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_canonicalize_sale_request_internal(JSONB)
  OWNER TO postgres;
ALTER FUNCTION public.phase3_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.phase3_assert_configurable_parcel_creation_allowed_internal(
  TEXT, UUID
) OWNER TO postgres;
ALTER FUNCTION public.phase3_lock_inventory_products_internal(UUID[])
  OWNER TO postgres;
ALTER FUNCTION public.phase3_validate_configurable_parcel_internal(
  TEXT, UUID, UUID, UUID, INTEGER, JSONB
) OWNER TO postgres;
ALTER FUNCTION public.phase3_allocate_parcel_cogs_internal(JSONB)
  OWNER TO postgres;
ALTER FUNCTION public.validate_order_inventory_reservation_chain()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.phase3_actor_scope_hash_internal(
  TEXT, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_require_uuid_internal(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_require_positive_integer_internal(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_require_nonnegative_bigint_internal(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_canonicalize_components_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_request_fingerprint_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_canonicalize_sale_request_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_resolve_operation_replay_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_assert_configurable_parcel_creation_allowed_internal(
  TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_lock_inventory_products_internal(UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_validate_configurable_parcel_internal(
  TEXT, UUID, UUID, UUID, INTEGER, JSONB
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phase3_allocate_parcel_cogs_internal(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_order_inventory_reservation_chain()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
