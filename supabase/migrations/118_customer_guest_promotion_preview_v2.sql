BEGIN;

-- Advisory Customer V2 merchandise/promotion preview.  Final checkout remains
-- authoritative for inventory, promotion quota locking/redemption and delivery.
CREATE FUNCTION public.preview_guest_promotion_v2(
  p_lines JSONB,
  p_promotion_code TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := CASE
    WHEN NULLIF(BTRIM(p_customer_phone), '') IS NULL THEN NULL
    ELSE public.normalize_customer_phone(p_customer_phone)
  END;
  v_promotion_code TEXT := UPPER(NULLIF(BTRIM(p_promotion_code), ''));
  v_request JSONB;
  v_canonical_request JSONB;
  v_line JSONB;
  v_raw_line JSONB;
  v_instance JSONB;
  v_components JSONB;
  v_line_kind TEXT;
  v_line_identity TEXT;
  v_expected_price BIGINT;
  v_unit_price BIGINT;
  v_commercial_quantity INTEGER;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_product public.products%ROWTYPE;
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_capacity INTEGER;
  v_component_total BIGINT;
  v_invalid_component_count INTEGER;
  v_missing_wac_count INTEGER;
  v_promotion public.promotion_codes%ROWTYPE;
BEGIN
  -- Reuse the approved Phase-3 canonical line grammar and all bounded input
  -- limits.  The synthetic actor/location fields are validation-only and are
  -- never returned or persisted.
  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'guest_gateway',
    'actor_scope_hash', REPEAT('0', 64),
    'operation_source', 'customer_reservation',
    'warehouse_id', '00000000-0000-0000-0000-000000000001',
    'promotion_code', v_promotion_code,
    'order_discount_in_minor_units', 0,
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request);

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(p_lines) candidate
    GROUP BY public.phase3_customer_line_identity_internal(candidate)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer commercial identities must be unique.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) AND public.get_configurable_parcel_feature_state() IS DISTINCT FROM 'ENABLED' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFIGURABLE_PARCEL_DISABLED: Configurable Parcel is unavailable for guest preview.';
  END IF;

  FOR v_line IN
    SELECT value
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_kind := v_line->>'commercial_line_kind';
    v_line_identity := public.phase3_customer_line_identity_internal(v_line);

    SELECT raw_line.value
    INTO STRICT v_raw_line
    FROM JSONB_ARRAY_ELEMENTS(p_lines) raw_line(value)
    WHERE public.phase3_customer_line_identity_internal(raw_line.value)
      = v_line_identity;
    v_expected_price := public.phase3_require_nonnegative_bigint_internal(
      v_raw_line->>'expected_unit_price_in_minor_units',
      'expected_unit_price_in_minor_units'
    );

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'product_id')::UUID
        AND product.is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRODUCT_INVALID: Base Unit is unavailable.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_unit_price := v_product.sale_price_in_minor_units;

    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'product_id')::UUID
        AND product.is_active;
      IF NOT FOUND
        OR v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Legacy Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_unit_price := v_product.default_sale_price_in_minor_units;

    ELSE
      SELECT * INTO v_product
      FROM public.products product
      WHERE product.id = (v_line->>'family_product_id')::UUID
        AND product.is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Configurable Parcel changed.';
      END IF;

      SELECT * INTO v_configuration
      FROM public.product_parcel_configurations configuration
      WHERE configuration.id = (v_line->>'parcel_configuration_id')::UUID;
      IF NOT FOUND
        OR NOT v_configuration.is_active
        OR v_configuration.composition_mode <> 'configurable_mix'
        OR v_configuration.family_product_id IS DISTINCT FROM v_product.id
        OR v_configuration.configuration_revision IS DISTINCT FROM
          (v_line->>'configuration_revision')::INTEGER
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel configuration is unavailable or changed.';
      END IF;

      v_capacity := v_product.units_per_sale_unit;
      IF COALESCE(v_capacity, 0) <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PARCEL_CONFIGURATION_STALE: Parcel Family capacity is invalid.';
      END IF;

      FOR v_instance IN
        SELECT value
        FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances') instance(value)
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_components := v_instance->'components';
        SELECT
          SUM((component->>'base_quantity')::BIGINT),
          COUNT(*) FILTER (
            WHERE product.id IS NULL
              OR NOT product.is_active
              OR product.is_flavor_master
              OR COALESCE(product.flavor_master_product_id, product.id)
                IS DISTINCT FROM v_product.id
          ),
          COUNT(*) FILTER (
            WHERE product.id IS NOT NULL
              AND product.wac_cost_in_minor_units_exact IS NULL
          )
        INTO v_component_total, v_invalid_component_count, v_missing_wac_count
        FROM JSONB_ARRAY_ELEMENTS(v_components) component
        LEFT JOIN public.products product
          ON product.id = (component->>'product_id')::UUID;

        IF v_component_total IS DISTINCT FROM v_capacity::BIGINT THEN
          RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'phase3_parcel_capacity_check',
            MESSAGE = 'PARCEL_CAPACITY_MISMATCH: Parcel composition must equal configured capacity.';
        END IF;
        IF v_invalid_component_count <> 0 THEN
          RAISE EXCEPTION USING ERRCODE = '23514',
            CONSTRAINT = 'phase3_parcel_component_family_check',
            MESSAGE = 'PARCEL_COMPONENT_FAMILY_MISMATCH: Parcel component is not an eligible stocked SKU.';
        END IF;
        IF v_missing_wac_count <> 0 THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001',
            MESSAGE = 'PHASE3_EXACT_WAC_UNAVAILABLE: Exact WAC is required for configurable Parcel sale.';
        END IF;
      END LOOP;

      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_unit_price := v_product.default_sale_price_in_minor_units;
    END IF;

    IF v_unit_price IS DISTINCT FROM v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Commercial price changed.';
    END IF;
    v_subtotal := v_subtotal + v_commercial_quantity::BIGINT * v_unit_price;
  END LOOP;

  IF v_promotion_code IS NOT NULL THEN
    IF v_phone IS NULL OR v_phone !~ '^07[789][0-9]{7}$' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Customer phone is required for promotion eligibility.';
    END IF;

    -- Deliberately no FOR UPDATE: preview observes current eligibility but does
    -- not reserve quota.  Final V2 checkout owns authoritative locking.
    SELECT * INTO v_promotion
    FROM public.promotion_codes promotion
    WHERE promotion.code = v_promotion_code;
    IF NOT FOUND OR NOT v_promotion.is_active
      OR (v_promotion.starts_at IS NOT NULL AND NOW() < v_promotion.starts_at)
      OR (v_promotion.expires_at IS NOT NULL AND NOW() >= v_promotion.expires_at)
      OR v_subtotal < v_promotion.minimum_subtotal_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable.';
    END IF;
    IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
      SELECT COUNT(*)
      FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
    ) >= v_promotion.maximum_total_redemptions THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is exhausted.';
    END IF;
    IF (
      SELECT COUNT(*)
      FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
        AND redemption.customer_phone = v_phone
    ) >= v_promotion.maximum_redemptions_per_phone THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable for this customer.';
    END IF;

    IF v_promotion.discount_type = 'fixed' THEN
      v_discount := LEAST(v_promotion.discount_value, v_subtotal);
    ELSE
      v_discount := FLOOR(
        v_subtotal::NUMERIC * v_promotion.discount_value / 10000
      )::BIGINT;
      IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
        v_discount := LEAST(
          v_discount, v_promotion.maximum_discount_in_minor_units
        );
      END IF;
    END IF;
    v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'success', true,
    'contractVersion', 'phase3-customer-promotion-preview-v2',
    'merchandiseSubtotalInMinorUnits', v_subtotal,
    'promotionDiscountInMinorUnits', v_discount,
    'finalMerchandiseTotalInMinorUnits', v_subtotal - v_discount,
    'promotion', CASE WHEN v_promotion_code IS NULL THEN NULL ELSE JSONB_BUILD_OBJECT(
      'code', v_promotion.code,
      'descriptionAr', v_promotion.description_ar
    ) END
  );
END;
$$;

ALTER FUNCTION public.preview_guest_promotion_v2(JSONB, TEXT, TEXT)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.preview_guest_promotion_v2(JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_guest_promotion_v2(JSONB, TEXT, TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.preview_guest_promotion_v2(JSONB, TEXT, TEXT) IS
  'Read-only Customer V2 commercial-line promotion preview. It validates current server pricing and promotion eligibility without reserving inventory or promotion quota; final checkout remains authoritative.';

COMMIT;
