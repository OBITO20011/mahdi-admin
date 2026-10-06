BEGIN;

-- Package D: explicit active-path definitions. Historical migrations stay intact.
-- No statement in this migration enables or changes the parcel feature state.

-- Modern aftercare must reject absent creation evidence, not let SQL UNKNOWN
-- skip NOT IN. Source operation identity is immutable business evidence.
CREATE FUNCTION public.package_d_assert_modern_sale_internal(
  p_order_id UUID, p_error_identity TEXT
)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_creation_type TEXT;
BEGIN
  SELECT operation.operation_type INTO v_creation_type
  FROM public.orders sale
  LEFT JOIN public.business_operations operation ON operation.id = sale.operation_id
  WHERE sale.id = p_order_id;
  IF v_creation_type IS NULL OR v_creation_type NOT IN (
    'phase3_pos_sale_v1', 'phase3_customer_reservation_v1'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = p_error_identity || ': يتطلب الإجراء بيعاً حديثاً موثقاً بالإصدار V2.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.package_d_assert_modern_sale_internal(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.settle_sales_return_v1(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  RENAME TO package_d_settle_sales_return_before_guard_internal;
REVOKE ALL ON FUNCTION public.package_d_settle_sales_return_before_guard_internal(
  UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.settle_sales_return_v1(
  p_order_id UUID, p_idempotency_key TEXT, p_items JSONB, p_reason TEXT,
  p_refund_method TEXT DEFAULT NULL, p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'تسوية مرتجع مبيعات');
  PERFORM public.package_d_assert_modern_sale_internal(
    p_order_id, 'PHASE42_SALE_CONTRACT_UNSUPPORTED'
  );
  -- The original coordinator resolves committed replay before mutation gates.
  RETURN public.package_d_settle_sales_return_before_guard_internal(
    p_order_id, p_idempotency_key, p_items, p_reason,
    p_refund_method, p_reference_number, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.settle_sales_return_v1(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sales_return_v1(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

ALTER FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT)
  RENAME TO package_d_settle_sales_replacement_before_guard_internal;
REVOKE ALL ON FUNCTION public.package_d_settle_sales_replacement_before_guard_internal(
  UUID, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.settle_sales_replacement_v1(
  p_order_id UUID, p_idempotency_key TEXT, p_items JSONB,
  p_reason TEXT, p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات');
  PERFORM public.package_d_assert_modern_sale_internal(
    p_order_id, 'PHASE43_SALE_CONTRACT_UNSUPPORTED'
  );
  RETURN public.package_d_settle_sales_replacement_before_guard_internal(
    p_order_id, p_idempotency_key, p_items, p_reason, p_notes
  );
END;
$$;
REVOKE ALL ON FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sales_replacement_v1(UUID, TEXT, JSONB, TEXT, TEXT)
  TO authenticated;

-- Preserve legacy history/readers, but legacy commands no longer create sales
-- or Returns. Definitions are explicit; no source-text rewriting.
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_warehouse_id UUID, p_branch_id UUID, p_customer_id UUID,
  p_customer_name TEXT, p_payment_method TEXT, p_items JSONB,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'sales'], 'بيع الكاشير');
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'PACKAGE_D_POS_V2_REQUIRED: حدّث الصفحة وأعد المحاولة؛ البيع الجديد يتطلب V2.';
END;
$$;
CREATE OR REPLACE FUNCTION public.return_completed_website_order(
  p_order_id UUID, p_reason TEXT, p_stock_disposition TEXT, p_refund_method TEXT,
  p_reference_number TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager'], 'تسجيل مرتجع');
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'PACKAGE_D_MODERN_AFTERCARE_REQUIRED: المسار القديم للقراءة فقط؛ استخدم المرتجع الحديث.';
END;
$$;

ALTER FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) RENAME TO package_d_create_customer_order_before_source_guard_internal;
REVOKE ALL ON FUNCTION public.package_d_create_customer_order_before_source_guard_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.create_customer_order(
  p_customer_full_name TEXT, p_customer_phone TEXT,
  p_customer_email TEXT DEFAULT NULL, p_governorate TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL, p_area TEXT DEFAULT NULL, p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL, p_floor TEXT DEFAULT NULL, p_apartment TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL, p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL, p_formatted_address TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL, p_location_source TEXT DEFAULT 'manual',
  p_branch_id UUID DEFAULT NULL, p_warehouse_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB, p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0, p_customer_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL, p_source TEXT DEFAULT 'website'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF LOWER(BTRIM(p_source)) = 'pos' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PACKAGE_D_POS_V2_REQUIRED: بيع الكاشير يتطلب create_pos_sale_v2.';
  END IF;
  RETURN public.package_d_create_customer_order_before_source_guard_internal(
    p_customer_full_name, p_customer_phone, p_customer_email, p_governorate,
    p_city, p_area, p_street, p_building, p_floor, p_apartment, p_address_notes,
    p_latitude, p_longitude, p_formatted_address, p_google_maps_url, p_location_source,
    p_branch_id, p_warehouse_id, p_items, p_delivery_fee_in_minor_units,
    p_discount_in_minor_units, p_customer_notes, p_internal_notes, p_source
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;

-- Validate each actual physical source at its shared mutation boundary, not
-- merely a UI total. Run AFTER root-gate and physical rebind BEFORE triggers.
CREATE FUNCTION public.package_d_guard_physical_capacity_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_capacity INTEGER; v_used BIGINT;
BEGIN
  IF NEW.consumption_state NOT IN ('draft', 'settled') THEN RETURN NEW; END IF;
  PERFORM public.phase4_lock_aftercare_operation_order_internal(NEW.operation_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'phase4-aftercare|' || NEW.source_kind || '|' || NEW.source_id::TEXT, 0
  ));
  IF NEW.source_kind = 'base_order_item' THEN
    SELECT quantity INTO v_capacity FROM public.order_items
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  ELSIF NEW.source_kind = 'parcel_component' THEN
    SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  ELSIF NEW.source_kind = 'replacement_item' THEN
    SELECT quantity INTO v_capacity FROM public.sales_replacement_items
    WHERE id = NEW.source_id AND product_id = NEW.product_id FOR UPDATE;
  END IF;
  SELECT COALESCE(SUM(consumed_quantity), 0) INTO v_used
  FROM public.sales_aftercare_consumptions
  WHERE source_kind = NEW.source_kind AND source_id = NEW.source_id
    AND id IS DISTINCT FROM NEW.id
    AND (consumption_state = 'settled'
      OR (operation_id = NEW.operation_id AND consumption_state = 'draft'));
  IF v_capacity IS NULL OR NEW.consumed_quantity <= 0
    OR v_used + NEW.consumed_quantity > v_capacity THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: تغيرت الكمية المتبقية لهذه القطعة؛ أعد تحميل الطلب.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.package_d_guard_physical_capacity_internal()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_zz_package_d_physical_capacity
BEFORE INSERT OR UPDATE ON public.sales_aftercare_consumptions
FOR EACH ROW EXECUTE FUNCTION public.package_d_guard_physical_capacity_internal();

-- Parcel policy extends the existing configuration, never commercial history.
CREATE TABLE public.product_parcel_allowed_components (
  configuration_id UUID NOT NULL REFERENCES public.product_parcel_configurations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  PRIMARY KEY(configuration_id, product_id)
);
ALTER TABLE public.product_parcel_allowed_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_parcel_allowed_components FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_parcel_allowed_components TO authenticated;
CREATE POLICY "Active staff read parcel component policy"
ON public.product_parcel_allowed_components FOR SELECT TO authenticated
USING ((SELECT public.is_active_erp_staff()));

-- Preserve the previously eligible current family membership. No historical
-- order composition, price, cost or receipt snapshot is altered.
INSERT INTO public.product_parcel_allowed_components(configuration_id, product_id)
SELECT configuration.id, product.id
FROM public.product_parcel_configurations configuration
JOIN public.products product ON product.is_active AND (
  (configuration.composition_mode='configurable_mix'
    AND product.flavor_master_product_id=configuration.family_product_id
    AND NOT product.is_flavor_master)
  OR (configuration.composition_mode='single_sku'
    AND product.id=configuration.family_product_id)
);

CREATE FUNCTION public.save_product_parcel_configuration_v1(
  p_family_product_id UUID, p_composition_mode TEXT, p_is_active BOOLEAN,
  p_units_per_parcel INTEGER, p_allowed_product_ids UUID[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_configuration public.product_parcel_configurations%ROWTYPE;
  v_family public.products%ROWTYPE; v_previous_ids UUID[]; v_ids UUID[];
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إعداد الطرود');
  IF p_composition_mode IS NULL OR p_composition_mode NOT IN ('single_sku','configurable_mix')
    OR p_is_active IS NULL OR p_units_per_parcel IS NULL OR p_units_per_parcel <= 0
    OR p_allowed_product_ids IS NULL OR array_position(p_allowed_product_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_CONFIGURATION_INVALID: راجع إعداد الطرد.';
  END IF;
  -- Configuration before family/product matches the sales validator order.
  -- Serialize creation of a previously absent configuration as well.
  PERFORM pg_advisory_xact_lock(hashtextextended('parcel-configuration|' || p_family_product_id::TEXT,0));
  SELECT * INTO v_configuration FROM public.product_parcel_configurations
  WHERE family_product_id=p_family_product_id FOR UPDATE;
  SELECT * INTO v_family FROM public.products WHERE id=p_family_product_id FOR UPDATE;
  IF NOT FOUND OR NOT v_family.is_active OR v_family.flavor_master_product_id IS NOT NULL
    OR v_family.sale_unit_id IS NULL
    OR (p_composition_mode='configurable_mix' AND NOT v_family.is_flavor_master) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_CONFIGURATION_INVALID: العائلة غير صالحة لهذا الطرد.';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}'::UUID[]) INTO v_ids
  FROM (SELECT DISTINCT unnest(p_allowed_product_ids) id) ids;
  IF (p_is_active AND cardinality(v_ids)=0)
    OR (p_composition_mode='single_sku' AND v_ids IS DISTINCT FROM ARRAY[p_family_product_id])
    OR EXISTS(SELECT 1 FROM unnest(v_ids) requested(id)
      LEFT JOIN public.products component ON component.id=requested.id
      WHERE component.id IS NULL OR NOT component.is_active
        OR (p_composition_mode='configurable_mix' AND
          (component.flavor_master_product_id IS DISTINCT FROM p_family_product_id
            OR component.is_flavor_master))) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PARCEL_COMPONENT_FAMILY_MISMATCH: النكهات المسموحة يجب أن تنتمي للعائلة نفسها.';
  END IF;
  SELECT COALESCE(array_agg(product_id ORDER BY product_id),'{}'::UUID[])
  INTO v_previous_ids FROM public.product_parcel_allowed_components
  WHERE configuration_id=v_configuration.id;
  IF v_family.units_per_sale_unit IS DISTINCT FROM p_units_per_parcel THEN
    UPDATE public.products SET units_per_sale_unit=p_units_per_parcel
    WHERE id=p_family_product_id;
  END IF;
  IF v_configuration.id IS NULL THEN
    INSERT INTO public.product_parcel_configurations(family_product_id,composition_mode,is_active,created_by,updated_by)
    VALUES(p_family_product_id,p_composition_mode,p_is_active,auth.uid(),auth.uid())
    RETURNING * INTO v_configuration;
  ELSE
    UPDATE public.product_parcel_configurations SET composition_mode=p_composition_mode,
      is_active=p_is_active,updated_by=auth.uid(),updated_at=now(),
      configuration_revision=configuration_revision+CASE WHEN
        v_configuration.composition_mode IS DISTINCT FROM p_composition_mode
        OR v_configuration.is_active IS DISTINCT FROM p_is_active
        OR v_family.units_per_sale_unit IS DISTINCT FROM p_units_per_parcel
        OR v_previous_ids IS DISTINCT FROM v_ids THEN 1 ELSE 0 END
    WHERE id=v_configuration.id RETURNING * INTO v_configuration;
  END IF;
  DELETE FROM public.product_parcel_allowed_components WHERE configuration_id=v_configuration.id;
  INSERT INTO public.product_parcel_allowed_components(configuration_id,product_id)
  SELECT v_configuration.id,unnest(v_ids);
  RETURN jsonb_build_object('success',true,'configuration',to_jsonb(v_configuration),
    'unitsPerParcel',p_units_per_parcel,'allowedProductIds',to_jsonb(v_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.save_product_parcel_configuration_v1(UUID,TEXT,BOOLEAN,INTEGER,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_product_parcel_configuration_v1(UUID,TEXT,BOOLEAN,INTEGER,UUID[]) TO authenticated;

-- Preserve the unambiguous historical three-argument API, with the same owner
-- authority and complete current policy rather than an alternate bypass writer.
CREATE OR REPLACE FUNCTION public.save_product_parcel_configuration_v1(
  p_family_product_id UUID,p_composition_mode TEXT,p_is_active BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_units INTEGER; v_ids UUID[]; v_configuration public.product_parcel_configurations%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'إعداد الطرود');
  PERFORM pg_advisory_xact_lock(hashtextextended('parcel-configuration|' || p_family_product_id::TEXT,0));
  SELECT * INTO v_configuration FROM public.product_parcel_configurations
  WHERE family_product_id=p_family_product_id FOR UPDATE;
  SELECT units_per_sale_unit INTO v_units FROM public.products WHERE id=p_family_product_id;
  IF v_configuration.id IS NOT NULL AND v_configuration.composition_mode=p_composition_mode THEN
    SELECT array_agg(product_id ORDER BY product_id) INTO v_ids
    FROM public.product_parcel_allowed_components WHERE configuration_id=v_configuration.id;
  ELSE
    SELECT array_agg(product.id ORDER BY product.id) INTO v_ids FROM public.products product
    WHERE product.is_active AND CASE WHEN p_composition_mode='single_sku'
      THEN product.id=p_family_product_id
      ELSE product.flavor_master_product_id=p_family_product_id AND NOT product.is_flavor_master END;
  END IF;
  RETURN public.save_product_parcel_configuration_v1(
    p_family_product_id,p_composition_mode,p_is_active,v_units,COALESCE(v_ids,'{}'::UUID[]));
END;
$$;

ALTER FUNCTION public.phase3_validate_configurable_parcel_internal(TEXT,UUID,UUID,UUID,INTEGER,JSONB)
RENAME TO package_d_validate_configurable_parcel_before_policy_internal;
REVOKE ALL ON FUNCTION public.package_d_validate_configurable_parcel_before_policy_internal(TEXT,UUID,UUID,UUID,INTEGER,JSONB)
FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.phase3_validate_configurable_parcel_internal(
  p_actor_scope_type TEXT,p_actor_user_id UUID,p_family_product_id UUID,
  p_parcel_configuration_id UUID,p_configuration_revision INTEGER,p_components JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  v_result:=public.package_d_validate_configurable_parcel_before_policy_internal(
    p_actor_scope_type,p_actor_user_id,p_family_product_id,p_parcel_configuration_id,
    p_configuration_revision,p_components);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'components') component
    WHERE NOT EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed
      WHERE allowed.configuration_id=p_parcel_configuration_id
        AND allowed.product_id=(component->>'product_id')::UUID)) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='PARCEL_COMPONENT_NOT_ALLOWED: إحدى النكهات غير مسموحة لهذا الطرد.';
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.phase3_validate_configurable_parcel_internal(TEXT,UUID,UUID,UUID,INTEGER,JSONB)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_admin_parcel_configuration_context_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_products JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'إعداد الطرود');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'familyProductId',family.id,'nameAr',family.name_ar,'sku',family.sku,
    'isFlavorMaster',family.is_flavor_master,'unitsPerParcel',family.units_per_sale_unit,
    'parcelPriceInMinorUnits',family.default_sale_price_in_minor_units,
    'configuration',CASE WHEN configuration.id IS NULL THEN NULL ELSE to_jsonb(configuration) END,
    'allowedProductIds',COALESCE((SELECT jsonb_agg(allowed.product_id ORDER BY allowed.product_id)
      FROM public.product_parcel_allowed_components allowed WHERE allowed.configuration_id=configuration.id),'[]'::JSONB),
    'components',COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',component.id,
      'nameAr',component.name_ar,'sku',component.sku,'flavorNameAr',component.flavor_name_ar) ORDER BY component.name_ar,component.id)
      FROM public.products component WHERE component.is_active AND
        (component.flavor_master_product_id=family.id OR component.id=family.id)),'[]'::JSONB)
    ) ORDER BY family.name_ar,family.id),'[]'::JSONB) INTO v_products
  FROM public.products family LEFT JOIN public.product_parcel_configurations configuration
    ON configuration.family_product_id=family.id
  WHERE family.is_active AND family.flavor_master_product_id IS NULL AND family.sale_unit_id IS NOT NULL;
  RETURN jsonb_build_object('featureState',public.get_configurable_parcel_feature_state(),'products',v_products);
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_parcel_configuration_context_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_parcel_configuration_context_v1() TO authenticated;

CREATE FUNCTION public.get_pos_configurable_parcel_options_v1(p_warehouse_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_options JSONB; v_state TEXT:=public.get_configurable_parcel_feature_state();
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'قراءة طرود الكاشير');
  IF NOT EXISTS(SELECT 1 FROM public.warehouses warehouse JOIN public.branches branch
    ON branch.id=warehouse.branch_id WHERE warehouse.id=p_warehouse_id AND warehouse.is_active AND branch.is_active) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PHASE3_POS_LOCATION_INVALID: المستودع غير متاح.';
  END IF;
  IF v_state='OFF' OR (v_state='OWNER_PILOT' AND NOT public.has_erp_role(ARRAY['owner'])) THEN
    RETURN jsonb_build_object('featureState',v_state,'options','[]'::JSONB);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('familyProductId',family.id,
    'nameAr',family.name_ar,'parcelConfigurationId',configuration.id,
    'configurationRevision',configuration.configuration_revision,
    'unitsPerParcel',family.units_per_sale_unit,'parcelPriceInMinorUnits',family.default_sale_price_in_minor_units,
    'components',components.value) ORDER BY family.name_ar,family.id),'[]'::JSONB) INTO v_options
  FROM public.product_parcel_configurations configuration
  JOIN public.products family ON family.id=configuration.family_product_id
  CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('productId',product.id,
    'nameAr',product.name_ar,'flavorNameAr',product.flavor_name_ar,'sku',product.sku,
    'availableQuantity',COALESCE(balance.available_quantity,0)) ORDER BY product.name_ar,product.id) value,
    SUM(COALESCE(balance.available_quantity,0)) available
    FROM public.product_parcel_allowed_components allowed
    JOIN public.products product ON product.id=allowed.product_id AND product.is_active
      AND product.flavor_master_product_id=family.id AND NOT product.is_flavor_master
      AND product.wac_cost_in_minor_units_exact IS NOT NULL
    LEFT JOIN public.inventory_balances balance ON balance.product_id=product.id AND balance.warehouse_id=p_warehouse_id
    WHERE allowed.configuration_id=configuration.id) components
  WHERE configuration.is_active AND configuration.composition_mode='configurable_mix'
    AND family.is_active AND family.is_flavor_master AND family.units_per_sale_unit>0
    AND family.default_sale_price_in_minor_units>0 AND components.available>=family.units_per_sale_unit;
  RETURN jsonb_build_object('featureState',v_state,'options',v_options);
END;
$$;
REVOKE ALL ON FUNCTION public.get_pos_configurable_parcel_options_v1(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_configurable_parcel_options_v1(UUID) TO authenticated;

ALTER FUNCTION public.get_public_configurable_parcel_options(UUID[])
RENAME TO package_d_public_parcel_options_before_policy_internal;
REVOKE ALL ON FUNCTION public.package_d_public_parcel_options_before_policy_internal(UUID[])
FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_public_configurable_parcel_options(p_family_product_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_result JSONB; v_options JSONB;
BEGIN
  v_result:=public.package_d_public_parcel_options_before_policy_internal(p_family_product_ids);
  SELECT COALESCE(jsonb_agg(option.value || jsonb_build_object('components',filtered.components)
    ORDER BY option.value->>'familyProductId'),'[]'::JSONB) INTO v_options
  FROM jsonb_array_elements(v_result->'options') option
  CROSS JOIN LATERAL(SELECT jsonb_agg(component.value ORDER BY component.value->>'productId') components,
    SUM((component.value->>'availableQuantity')::BIGINT) available
    FROM jsonb_array_elements(option.value->'components') component
    WHERE EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed
      WHERE allowed.configuration_id=(option.value->>'parcelConfigurationId')::UUID
        AND allowed.product_id=(component.value->>'productId')::UUID)) filtered
  WHERE filtered.available >= (option.value->>'unitsPerParcel')::INTEGER;
  RETURN v_result || jsonb_build_object('options',v_options);
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_configurable_parcel_options(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_configurable_parcel_options(UUID[]) TO anon,authenticated;

COMMIT;
