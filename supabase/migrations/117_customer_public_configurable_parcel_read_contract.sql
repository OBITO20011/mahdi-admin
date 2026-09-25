BEGIN;

-- Customer storefront projection for new configurable-parcel composition.
-- Protected configuration, cost and reservation tables remain private; this
-- function returns only the current public facts required by Customer V2.
CREATE FUNCTION public.get_public_configurable_parcel_options(
  p_family_product_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_feature_state TEXT := public.get_configurable_parcel_feature_state();
  v_requested_count INTEGER := COALESCE(CARDINALITY(p_family_product_ids), 0);
  v_options JSONB;
BEGIN
  IF v_requested_count < 1
    OR v_requested_count > 48
    OR ARRAY_POSITION(p_family_product_ids, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'PUBLIC_CONFIGURABLE_PARCEL_REQUEST_INVALID: Provide between 1 and 48 valid Family IDs.';
  END IF;

  -- OWNER_PILOT intentionally grants no Customer guest creation capability.
  -- Returning an empty projection also prevents stale configuration discovery
  -- while creation is unavailable to the public guest actor.
  IF v_feature_state IS DISTINCT FROM 'ENABLED' THEN
    RETURN JSONB_BUILD_OBJECT(
      'featureState', v_feature_state,
      'guestCreationEnabled', false,
      'options', '[]'::JSONB
    );
  END IF;

  WITH requested_families AS (
    SELECT DISTINCT requested.family_product_id
    FROM UNNEST(p_family_product_ids) AS requested(family_product_id)
  ), storefront_warehouse AS (
    -- This is intentionally identical to the Customer V2 warehouse selector.
    SELECT warehouse.id
    FROM public.warehouses warehouse
    JOIN public.branches branch
      ON branch.id = warehouse.branch_id
    WHERE warehouse.is_active
      AND branch.is_active
    ORDER BY warehouse.created_at, warehouse.id
    LIMIT 1
  ), configuration_source AS (
    SELECT
      configuration.id AS parcel_configuration_id,
      configuration.family_product_id,
      configuration.configuration_revision,
      configuration.composition_mode,
      family.units_per_sale_unit AS units_per_parcel,
      family.default_sale_price_in_minor_units AS parcel_price_in_minor_units,
      base_unit.name_ar AS base_unit_name_ar,
      sale_unit.name_ar AS sale_unit_name_ar
    FROM requested_families requested
    JOIN public.product_parcel_configurations configuration
      ON configuration.family_product_id = requested.family_product_id
    JOIN public.products family
      ON family.id = configuration.family_product_id
    JOIN public.categories family_category
      ON family_category.id = family.category_id
      AND family_category.is_active
    JOIN public.units base_unit
      ON base_unit.id = family.unit_id
    JOIN public.units sale_unit
      ON sale_unit.id = family.sale_unit_id
    WHERE configuration.is_active
      AND configuration.composition_mode = 'configurable_mix'
      AND configuration.configuration_revision > 0
      AND family.is_active
      AND family.is_flavor_master
      AND family.units_per_sale_unit > 0
      AND family.default_sale_price_in_minor_units > 0
      AND sale_unit.code <> 'PCS'
  ), eligible_components AS (
    SELECT
      configuration.parcel_configuration_id,
      configuration.family_product_id,
      configuration.configuration_revision,
      configuration.composition_mode,
      configuration.units_per_parcel,
      configuration.parcel_price_in_minor_units,
      configuration.base_unit_name_ar,
      configuration.sale_unit_name_ar,
      component.id AS product_id,
      component.sku,
      component.name_ar,
      component.flavor_name_ar,
      component_unit.name_ar AS component_unit_name_ar,
      image.image_url,
      COALESCE(balance.available_quantity, 0)::INTEGER AS available_quantity
    FROM configuration_source configuration
    CROSS JOIN storefront_warehouse warehouse
    JOIN public.products component
      ON component.flavor_master_product_id = configuration.family_product_id
      AND component.is_active
      AND NOT component.is_flavor_master
      AND component.wac_cost_in_minor_units_exact IS NOT NULL
    JOIN public.categories component_category
      ON component_category.id = component.category_id
      AND component_category.is_active
    JOIN public.units component_unit
      ON component_unit.id = component.unit_id
    JOIN public.units component_sale_unit
      ON component_sale_unit.id = component.sale_unit_id
    LEFT JOIN public.inventory_balances balance
      ON balance.warehouse_id = warehouse.id
      AND balance.product_id = component.id
    LEFT JOIN LATERAL (
      SELECT product_image.image_url
      FROM public.product_images product_image
      WHERE product_image.product_id = component.id
      ORDER BY product_image.is_primary DESC,
        product_image.display_order,
        product_image.created_at,
        product_image.id
      LIMIT 1
    ) image ON true
    WHERE component.units_per_sale_unit > 0
      AND component.default_sale_price_in_minor_units > 0
      AND component_sale_unit.code <> 'PCS'
  ), option_groups AS (
    SELECT
      component.parcel_configuration_id,
      component.family_product_id,
      component.configuration_revision,
      component.composition_mode,
      component.units_per_parcel,
      component.parcel_price_in_minor_units,
      component.base_unit_name_ar,
      component.sale_unit_name_ar,
      SUM(component.available_quantity)::BIGINT AS total_available_quantity,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'productId', component.product_id,
          'sku', component.sku,
          'nameAr', component.name_ar,
          'flavorNameAr', component.flavor_name_ar,
          'unitNameAr', component.component_unit_name_ar,
          'imageUrl', component.image_url,
          'availableQuantity', component.available_quantity
        )
        ORDER BY component.flavor_name_ar NULLS LAST,
          component.name_ar,
          component.product_id
      ) AS components
    FROM eligible_components component
    GROUP BY
      component.parcel_configuration_id,
      component.family_product_id,
      component.configuration_revision,
      component.composition_mode,
      component.units_per_parcel,
      component.parcel_price_in_minor_units,
      component.base_unit_name_ar,
      component.sale_unit_name_ar
    HAVING SUM(component.available_quantity) >= component.units_per_parcel
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'familyProductId', option_group.family_product_id,
        'parcelConfigurationId', option_group.parcel_configuration_id,
        'configurationRevision', option_group.configuration_revision,
        'compositionMode', option_group.composition_mode,
        'unitsPerParcel', option_group.units_per_parcel,
        'parcelPriceInMinorUnits', option_group.parcel_price_in_minor_units,
        'baseUnitNameAr', option_group.base_unit_name_ar,
        'saleUnitNameAr', option_group.sale_unit_name_ar,
        'components', option_group.components
      )
      ORDER BY option_group.family_product_id,
        option_group.parcel_configuration_id
    ),
    '[]'::JSONB
  )
  INTO v_options
  FROM option_groups option_group;

  RETURN JSONB_BUILD_OBJECT(
    'featureState', v_feature_state,
    'guestCreationEnabled', true,
    'options', v_options
  );
END;
$$;

ALTER FUNCTION public.get_public_configurable_parcel_options(UUID[])
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_public_configurable_parcel_options(UUID[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_configurable_parcel_options(UUID[])
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_configurable_parcel_options(UUID[]) IS
  'Bounded Customer-safe projection of currently guest-creatable configurable Parcel options. Uses the same storefront warehouse and Phase-3 family/component facts without exposing protected configuration tables or cost data.';

COMMIT;
