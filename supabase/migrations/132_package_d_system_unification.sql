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
DECLARE v_capacity INTEGER; v_used BIGINT; v_root RECORD;
BEGIN
  IF NEW.consumption_state NOT IN ('draft', 'settled') THEN RETURN NEW; END IF;
  PERFORM public.phase4_lock_aftercare_operation_order_internal(NEW.operation_id, NULL);
  SELECT * INTO v_root FROM public.phase4_aftercare_source_root_internal(NEW.source_kind,NEW.source_id,NEW.product_id);
  IF v_root.root_kind='base_order_item' THEN
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_root.root_id,NEW.consumed_quantity);
  END IF;
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
    SELECT array_agg(allowed.product_id ORDER BY allowed.product_id) INTO v_ids
    FROM public.product_parcel_allowed_components allowed
    JOIN public.products component ON component.id=allowed.product_id AND component.is_active
    WHERE allowed.configuration_id=v_configuration.id;
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
      FROM public.product_parcel_allowed_components allowed
      JOIN public.products active_component ON active_component.id=allowed.product_id AND active_component.is_active
      WHERE allowed.configuration_id=configuration.id),'[]'::JSONB),
    'components',COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',component.id,
      'nameAr',component.name_ar,'sku',component.sku,'flavorNameAr',component.flavor_name_ar,
      'packetPriceInMinorUnits',component.sale_price_in_minor_units) ORDER BY component.name_ar,component.id)
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
  CROSS JOIN LATERAL(SELECT jsonb_agg(component.value ORDER BY component.value->>'nameAr',component.value->>'productId') components,
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

-- Whole single-SKU parcels retain the existing physical Base Unit evidence
-- contract. The UI displays cartons; immutable sale package snapshots provide
-- the conversion. No sale snapshot or financial writer is reinterpreted.
CREATE FUNCTION public.package_d_assert_whole_single_sku_quantity_internal(p_order_item_id UUID,p_quantity INTEGER)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item public.order_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id=p_order_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE43_REPLACEMENT_SOURCE_INVALID: Missing immutable sale root'; END IF;
  IF v_item.commercial_line_kind='legacy_single_sku_parcel' AND (
    v_item.units_per_sale_package IS NULL OR v_item.units_per_sale_package<=0
    OR v_item.sale_package_quantity IS NULL OR v_item.sale_package_quantity<=0
    OR v_item.quantity::bigint IS DISTINCT FROM v_item.sale_package_quantity::bigint*v_item.units_per_sale_package
    OR p_quantity IS NULL OR p_quantity<=0
    OR mod(p_quantity, v_item.units_per_sale_package)<>0
  ) THEN
    RAISE EXCEPTION 'PACKAGE_D_WHOLE_SINGLE_SKU_PARCEL_REQUIRED: اختر كراتين كاملة حسب حجم الكرتونة التاريخي';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.package_d_assert_whole_single_sku_quantity_internal(UUID,INTEGER)
FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_sales_return_item_line_kind()
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

  IF v_line_kind IN ('base_unit','legacy_single_sku_parcel') THEN
    IF v_line_kind='legacy_single_sku_parcel' THEN
      PERFORM public.package_d_assert_modern_sale_internal(NEW.order_id,'PHASE42_SALE_CONTRACT_UNSUPPORTED');
      PERFORM public.package_d_assert_whole_single_sku_quantity_internal(NEW.order_item_id,NEW.returned_quantity);
    END IF;
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
    -- NULL historical rows remain unsupported; no commercial mode is guessed.
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'sales_return_items_supported_line_kind_check',
      MESSAGE = 'New Return Item mode cannot be proven for this legacy commercial line.';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION public.validate_sales_return_item_line_kind() OWNER TO postgres;


CREATE OR REPLACE FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(
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
      OR (v_order_item.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel'
        AND (COALESCE(v_item.raw_customer_damage_deduction_in_minor_units, 0) <> 0
          OR COALESCE(v_item.applied_customer_damage_deduction_in_minor_units, 0) <> 0))
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
            item.refund_amount_snapshot_in_minor_units
              + item.applied_customer_damage_deduction_in_minor_units AS item_refund,
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
          GROUP BY item.id, item.refund_amount_snapshot_in_minor_units, item.applied_customer_damage_deduction_in_minor_units,
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
        AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel')
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

CREATE OR REPLACE FUNCTION public.package_d_settle_sales_return_before_guard_internal(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_items JSONB,
  p_reason TEXT,
  p_refund_method TEXT DEFAULT NULL,
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
        v_unit_cost_exact := v_order_item.unit_cost_in_minor_units::NUMERIC;
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
$$;

CREATE OR REPLACE FUNCTION public.package_d_settle_sales_replacement_before_guard_internal(
  p_order_id UUID,
  p_idempotency_key TEXT,
  p_items JSONB,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_actor_hash TEXT;
  v_key TEXT;
  v_canonical JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_completion_at TIMESTAMPTZ;
  v_operation_id UUID := gen_random_uuid();
  v_event_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ;
  v_item JSONB;
  v_prepared JSONB := '[]'::JSONB;
  v_product_ids UUID[];
  v_source_kind TEXT;
  v_source_id UUID;
  v_quantity INTEGER;
  v_product_id UUID;
  v_root_order_item_id UUID;
  v_root_parcel_instance_id UUID;
  v_root_parcel_component_id UUID;
  v_original_sale_operation_id UUID;
  v_parent_replacement_item_id UUID;
  v_capacity INTEGER;
  v_consumed INTEGER;
  v_wac NUMERIC(24, 6);
  v_cogs BIGINT;
  v_replacement_item_id UUID;
  v_before INTEGER;
  v_available INTEGER;
  v_after INTEGER;
  v_movement_id UUID;
  v_result JSONB;
  v_total_quantity INTEGER := 0;
  v_total_cogs BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'إصدار استبدال مبيعات Phase 4.3');
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PHASE43_ACTOR_REQUIRED: Authenticated ERP actor is required.';
  END IF;
  v_key := public.phase4_canonicalize_idempotency_key_internal(p_idempotency_key);
  v_canonical := public.phase43_canonicalize_replacement_request_internal(
    p_order_id, p_items, p_reason, p_notes
  );
  v_actor_hash := public.phase3_actor_scope_hash_internal('erp_user', v_user_id, NULL, NULL);
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical);
  v_replay := public.phase43_resolve_replacement_replay_internal(
    v_key, v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;

  PERFORM public.phase4_lock_customer_order_context_internal(p_order_id, false, false);
  SELECT * INTO v_order FROM public.orders customer_order
  WHERE customer_order.id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.status IS DISTINCT FROM 'completed'
    OR v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_ORIGINAL_SALE_INVALID: Replacement requires a completed sale with branch and warehouse evidence.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id FOR SHARE;
  IF v_creation_type IS NULL OR v_creation_type NOT IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE43_SALE_CONTRACT_UNSUPPORTED: Only proven Phase-3 POS V2 and Customer V2 sales are supported.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical->'items')
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_root_order_item_id := NULL;
    v_root_parcel_instance_id := NULL;
    v_root_parcel_component_id := NULL;
    v_original_sale_operation_id := NULL;
    v_parent_replacement_item_id := NULL;

    IF v_source_kind = 'base_order_item' THEN
      SELECT item.id, item.product_id, item.quantity
      INTO v_root_order_item_id, v_product_id, v_capacity
      FROM public.order_items item
      WHERE item.id = v_source_id AND item.order_id = p_order_id
        AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel');
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT order_item.id, instance.id, component.id, component.operation_id,
        component.product_id, component.base_quantity
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity
      FROM public.order_parcel_components component
      JOIN public.order_parcel_instances instance ON instance.id = component.parcel_instance_id
      JOIN public.order_items order_item ON order_item.id = instance.order_item_id
      WHERE component.id = v_source_id AND instance.order_id = p_order_id;
    ELSE
      SELECT item.root_order_item_id, item.root_parcel_instance_id,
        item.root_parcel_component_id, item.original_sale_operation_id,
        item.product_id, item.quantity, item.id
      INTO v_root_order_item_id, v_root_parcel_instance_id,
        v_root_parcel_component_id, v_original_sale_operation_id,
        v_product_id, v_capacity, v_parent_replacement_item_id
      FROM public.sales_replacement_items item
      JOIN public.sales_replacement_events event ON event.id = item.replacement_event_id
      WHERE item.id = v_source_id AND event.root_order_id = p_order_id
        AND event.replacement_status = 'settled'
        AND event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403;
      IF v_parent_replacement_item_id IS NOT NULL THEN
        PERFORM public.phase43_assert_operational_replacement_evidence_internal(
          (SELECT operation_id FROM public.sales_replacement_items WHERE id = v_parent_replacement_item_id), true
        );
      END IF;
    END IF;

    IF v_product_id IS NULL OR v_capacity IS NULL OR v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'PHASE43_REPLACEMENT_SOURCE_INVALID: Source is unavailable or quantity exceeds its immutable capacity.';
    END IF;
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_root_order_item_id,v_quantity);
    v_prepared := v_prepared || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'source_kind', v_source_kind, 'source_id', v_source_id,
      'quantity', v_quantity, 'product_id', v_product_id,
      'root_order_item_id', v_root_order_item_id,
      'root_parcel_instance_id', v_root_parcel_instance_id,
      'root_parcel_component_id', v_root_parcel_component_id,
      'original_sale_operation_id', v_original_sale_operation_id,
      'parent_replacement_item_id', v_parent_replacement_item_id
    ));
  END LOOP;

  SELECT ARRAY_AGG(DISTINCT (item->>'product_id')::UUID ORDER BY (item->>'product_id')::UUID)
  INTO v_product_ids FROM JSONB_ARRAY_ELEMENTS(v_prepared) item;
  PERFORM public.phase2_lock_inventory_products_internal(v_product_ids);
  v_completion_at := public.phase4_authoritative_completion_internal(p_order_id);
  IF clock_timestamp() > v_completion_at + INTERVAL '48 hours' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE4_REPLACEMENT_WINDOW_INVALID: Replacement is outside the original 48-hour window.';
  END IF;

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'phase4-aftercare|' || v_source_kind || '|' || v_source_id::TEXT, 0
    ));
    SELECT COALESCE(SUM(consumption.consumed_quantity), 0)::INTEGER
    INTO v_consumed FROM public.sales_aftercare_consumptions consumption
    WHERE consumption.source_kind = v_source_kind
      AND consumption.source_id = v_source_id
      AND consumption.consumption_state = 'settled';
    IF v_source_kind = 'base_order_item' THEN
      SELECT quantity INTO v_capacity FROM public.order_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSIF v_source_kind = 'parcel_component' THEN
      SELECT base_quantity INTO v_capacity FROM public.order_parcel_components
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    ELSE
      SELECT quantity INTO v_capacity FROM public.sales_replacement_items
      WHERE id = v_source_id AND product_id = v_product_id FOR UPDATE;
    END IF;
    IF v_capacity IS NULL OR v_consumed + v_quantity > v_capacity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: Replacement exceeds the remaining physical source.';
    END IF;
    SELECT product.wac_cost_in_minor_units_exact INTO v_wac
    FROM public.products product WHERE product.id = v_product_id FOR NO KEY UPDATE;
    SELECT balance.on_hand_quantity, balance.available_quantity
    INTO v_before, v_available
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    IF v_wac IS NULL OR v_before IS NULL OR v_available < v_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE: Sellable inventory or exact WAC evidence is insufficient.';
    END IF;
  END LOOP;

  v_now := clock_timestamp();
  SELECT COALESCE(SUM((item->>'quantity')::INTEGER), 0)::INTEGER,
    COALESCE(SUM(ROUND(product.wac_cost_in_minor_units_exact
      * (item->>'quantity')::INTEGER)::BIGINT), 0)::BIGINT
  INTO v_total_quantity, v_total_cogs
  FROM JSONB_ARRAY_ELEMENTS(v_prepared) item
  JOIN public.products product ON product.id = (item->>'product_id')::UUID;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotentReplay', false,
    'operationId', v_operation_id, 'replacementId', v_event_id,
    'orderId', p_order_id, 'operationalCoordinatorVersion', 403,
    'issuedQuantity', v_total_quantity,
    'replacementCogsInMinorUnits', v_total_cogs,
    'moneyRefundInMinorUnits', 0, 'debtReductionInMinorUnits', 0
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase4_replacement_v1', v_key, v_fingerprint, v_user_id,
    v_result, v_now, 401, v_canonical, 'erp_user', v_actor_hash
  );
  INSERT INTO public.sales_replacement_events(
    id, operation_id, root_order_id, branch_id, warehouse_id,
    contract_version, replacement_status, original_completed_at_snapshot,
    reason, created_by, issuance_coordinator_version
  ) VALUES (
    v_event_id, v_operation_id, p_order_id, v_order.branch_id,
    v_order.warehouse_id, 401, 'draft', v_completion_at,
    v_canonical->>'reason', v_user_id, 403
  );

  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_prepared)
    ORDER BY value->>'source_kind', value->>'source_id'
  LOOP
    v_source_kind := v_item->>'source_kind';
    v_source_id := (v_item->>'source_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_product_id := (v_item->>'product_id')::UUID;
    SELECT product.wac_cost_in_minor_units_exact INTO STRICT v_wac
    FROM public.products product WHERE product.id = v_product_id;
    v_cogs := ROUND(v_wac * v_quantity)::BIGINT;
    v_replacement_item_id := gen_random_uuid();
    INSERT INTO public.sales_replacement_items(
      id, replacement_event_id, operation_id, root_order_item_id,
      root_parcel_instance_id, root_parcel_component_id,
      original_sale_operation_id, parent_replacement_item_id,
      product_id, quantity, replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units, condition_code
    ) VALUES (
      v_replacement_item_id, v_event_id, v_operation_id,
      (v_item->>'root_order_item_id')::UUID,
      (v_item->>'root_parcel_instance_id')::UUID,
      (v_item->>'root_parcel_component_id')::UUID,
      (v_item->>'original_sale_operation_id')::UUID,
      (v_item->>'parent_replacement_item_id')::UUID,
      v_product_id, v_quantity, v_wac, v_cogs, 'supplier_defect'
    );
    INSERT INTO public.sales_aftercare_consumptions(
      operation_id, replacement_item_id, source_kind, source_id,
      product_id, consumed_quantity, consumption_kind
    ) VALUES (
      v_operation_id, v_replacement_item_id, v_source_kind, v_source_id,
      v_product_id, v_quantity, 'replacement'
    );
    SELECT balance.on_hand_quantity INTO STRICT v_before
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_order.warehouse_id
      AND balance.product_id = v_product_id FOR UPDATE;
    v_after := v_before - v_quantity;
    UPDATE public.inventory_balances SET on_hand_quantity = v_after,
      updated_at = clock_timestamp()
    WHERE warehouse_id = v_order.warehouse_id AND product_id = v_product_id;
    INSERT INTO public.inventory_movements(
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, reference_id,
      notes, created_by, operation_id
    ) VALUES (
      v_order.warehouse_id, v_product_id, 'sales_deduction', -v_quantity,
      v_before, v_after, 'phase4_replacement_item', v_replacement_item_id,
      'Phase 4.3 operational Replacement issuance', v_user_id, v_operation_id
    ) RETURNING id INTO v_movement_id;
    INSERT INTO public.phase43_replacement_inventory_effects(
      operation_id, replacement_event_id, replacement_item_id,
      warehouse_id, product_id, inventory_movement_id,
      source_kind, source_id, issued_quantity,
      replacement_unit_cost_snapshot_in_minor_units_exact,
      replacement_cogs_snapshot_in_minor_units,
      target_balance_before, target_balance_after
    ) VALUES (
      v_operation_id, v_event_id, v_replacement_item_id,
      v_order.warehouse_id, v_product_id, v_movement_id,
      v_source_kind, v_source_id, v_quantity, v_wac, v_cogs,
      v_before, v_after
    );
  END LOOP;
  INSERT INTO public.phase43_replacement_issuance_guards(
    transaction_id, operation_id, replacement_event_id
  ) VALUES (pg_current_xact_id(), v_operation_id, v_event_id);
  INSERT INTO public.phase43_replacement_settlement_evidence(
    operation_id, replacement_event_id, order_id,
    result_snapshot, inventory_effects_snapshot
  ) VALUES (
    v_operation_id, v_event_id, p_order_id, v_result,
    public.phase43_inventory_effects_snapshot_internal(v_operation_id)
  );
  PERFORM public.phase4_finalize_aftercare_operation_internal(v_operation_id);
  DELETE FROM public.phase43_replacement_issuance_guards
  WHERE transaction_id = pg_current_xact_id() AND operation_id = v_operation_id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'SETTLE_PHASE43_SALES_REPLACEMENT',
    'sales_replacement_events', v_event_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'order_id', p_order_id,
      'issued_quantity', v_total_quantity, 'replacement_cogs', v_total_cogs));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_sales_aftercare_context_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_creation_type TEXT;
  v_capability TEXT;
  v_completion TIMESTAMPTZ;
  v_financial RECORD;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin'], 'قراءة سياق خدمات ما بعد البيع');
  SELECT * INTO v_order FROM public.orders customer_order WHERE customer_order.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503',
      MESSAGE = 'PHASE43_ORDER_NOT_FOUND: Order does not exist.';
  END IF;
  SELECT operation.operation_type INTO v_creation_type
  FROM public.business_operations operation WHERE operation.id = v_order.operation_id;

  IF v_creation_type IS DISTINCT FROM 'phase3_pos_sale_v1'
    AND v_creation_type IS DISTINCT FROM 'phase3_customer_reservation_v1'
  THEN
    v_capability := CASE
      WHEN v_order.operation_id IS NULL AND v_order.source = 'website'
        THEN 'legacy_website_return_v1'
      WHEN v_order.operation_id IS NULL AND v_order.source = 'pos'
        THEN 'legacy_pos_v1_unsupported'
      ELSE 'unsupported_contract'
    END;

    RETURN JSONB_BUILD_OBJECT(
      'contractVersion', 403,
      'serverTime', clock_timestamp(),
      'supported', false,
      'capability', v_capability,
      'order', JSONB_BUILD_OBJECT(
        'id', v_order.id, 'orderNumber', v_order.order_number,
        'status', v_order.status, 'saleContract', v_creation_type,
        'source', v_order.source,
        'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
        'completedAt', NULL, 'deadlineAt', NULL, 'withinWindow', false
      ),
      'financial', NULL,
      'baseItems', '[]'::JSONB,
      'parcelInstances', '[]'::JSONB,
      'returns', '[]'::JSONB,
      'replacements', '[]'::JSONB
    );
  END IF;

  v_completion := public.phase4_authoritative_completion_internal(p_order_id);
  SELECT * INTO v_financial FROM public.phase42_order_financial_position_internal(p_order_id);
  RETURN JSONB_BUILD_OBJECT(
    'contractVersion', 403,
    'serverTime', clock_timestamp(),
    'supported', true,
    'capability', 'phase43_modern',
    'order', JSONB_BUILD_OBJECT(
      'id', v_order.id, 'orderNumber', v_order.order_number,
      'status', v_order.status, 'saleContract', v_creation_type,
      'branchId', v_order.branch_id, 'warehouseId', v_order.warehouse_id,
      'completedAt', v_completion, 'deadlineAt', v_completion + INTERVAL '48 hours',
      'withinWindow', clock_timestamp() <= v_completion + INTERVAL '48 hours'
    ),
    'financial', JSONB_BUILD_OBJECT(
      'merchandiseDebtInMinorUnits', v_financial.merchandise_debt_in_minor_units,
      'refundableCollectedInMinorUnits', v_financial.refundable_collected_in_minor_units,
      'deliveryFeeInMinorUnits', v_financial.delivery_fee_in_minor_units
    ),
    'baseItems', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'orderItemId', item.id, 'productId', item.product_id,
      'quantity', item.quantity,
      'commercialLineKind',item.commercial_line_kind,
      'unitsPerParcel',CASE WHEN item.commercial_line_kind='legacy_single_sku_parcel' THEN item.units_per_sale_package ELSE 1 END,
      'commercialQuantity',CASE WHEN item.commercial_line_kind='legacy_single_sku_parcel' THEN item.sale_package_quantity ELSE item.quantity END,
      'standalonePriceInMinorUnits',item.effective_standalone_unit_sale_price_snapshot_in_minor_units,
      'remainingQuantity', GREATEST(item.quantity - COALESCE(consumed.quantity, 0), 0),
      'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
        'base_order_item', item.id, item.product_id
      )
    ) ORDER BY item.id)
    FROM public.order_items item
    LEFT JOIN LATERAL (
      SELECT SUM(consumption.consumed_quantity)::INTEGER quantity
      FROM public.sales_aftercare_consumptions consumption
      WHERE consumption.source_kind = 'base_order_item'
        AND consumption.source_id = item.id
        AND consumption.consumption_state = 'settled'
    ) consumed ON true
    WHERE item.order_id = p_order_id
      AND item.commercial_line_kind IN ('base_unit','legacy_single_sku_parcel')), '[]'::JSONB),
    'parcelInstances', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'parcelInstanceId', instance.id, 'orderItemId', instance.order_item_id,
      'components', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'parcelComponentId', component.id, 'productId', component.product_id,
        'quantity', component.base_quantity,
        'physicalRepresentatives', public.phase43_current_physical_representatives_internal(
          'parcel_component', component.id, component.product_id
        )
      ) ORDER BY component.id), '[]'::JSONB)
      FROM public.order_parcel_components component
      WHERE component.parcel_instance_id = instance.id)
    ) ORDER BY instance.id)
    FROM public.order_parcel_instances instance
    WHERE instance.order_id = p_order_id), '[]'::JSONB),
    'returns', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'returnId', event.id, 'status', event.settlement_status,
      'createdAt', event.created_at, 'settledAt', event.settled_at,
      'merchandiseEntitlementInMinorUnits', event.merchandise_refund_amount_in_minor_units,
      'debtReductionInMinorUnits', event.debt_reduction_amount_in_minor_units,
      'moneyRefundInMinorUnits', event.money_refund_amount_in_minor_units
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_return_events event WHERE event.order_id = p_order_id), '[]'::JSONB),
    'replacements', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'replacementId', event.id, 'foundationStatus', event.replacement_status,
      'operationalStatus', CASE WHEN event.issuance_status = 'issued'
        AND event.issuance_coordinator_version = 403 THEN 'issued' ELSE 'foundation_only' END,
      'createdAt', event.created_at, 'issuedAt', event.issued_at,
      'items', (SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'replacementItemId', item.id, 'productId', item.product_id,
        'quantity', item.quantity, 'parentReplacementItemId', item.parent_replacement_item_id,
        'rootOrderItemId', item.root_order_item_id,
        'rootParcelComponentId', item.root_parcel_component_id
      ) ORDER BY item.id), '[]'::JSONB)
      FROM public.sales_replacement_items item WHERE item.replacement_event_id = event.id)
    ) ORDER BY event.created_at, event.id)
    FROM public.sales_replacement_events event WHERE event.root_order_id = p_order_id), '[]'::JSONB)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_guest_promotion_v2(
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
  IF jsonb_typeof(p_lines)='array' THEN
    FOR v_raw_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF jsonb_typeof(v_raw_line->'parcel_instances')='array' THEN
        FOR v_instance IN SELECT value FROM jsonb_array_elements(v_raw_line->'parcel_instances') LOOP
          IF jsonb_typeof(v_instance->'components')='array' AND EXISTS(
            SELECT 1 FROM jsonb_array_elements(v_instance->'components') c
            WHERE jsonb_typeof(c->'product_id') IS DISTINCT FROM 'string'
              OR (c->>'product_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION USING ERRCODE='22023',
              MESSAGE='PARCEL_COMPONENT_INVALID: هوية النكهة غير صحيحة؛ حدّث الصفحة وأعد المحاولة.';
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
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
        -- Validate all identifiers before any UUID cast (including the policy
        -- lookup below). SQL evaluation order is not a validation boundary.
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_components) c
          WHERE jsonb_typeof(c->'product_id') IS DISTINCT FROM 'string'
            OR (c->>'product_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN
          RAISE EXCEPTION USING ERRCODE='22023',
            MESSAGE='PARCEL_COMPONENT_INVALID: هوية النكهة غير صحيحة؛ حدّث الصفحة وأعد المحاولة.';
        END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_components) c WHERE NOT EXISTS(
          SELECT 1 FROM public.product_parcel_allowed_components allowed
          WHERE allowed.configuration_id=v_configuration.id AND allowed.product_id=(c->>'product_id')::uuid)) THEN
          RAISE EXCEPTION 'PARCEL_COMPONENT_NOT_ALLOWED: إحدى النكهات غير مسموحة لهذا الطرد';
        END IF;
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

-- Same whole-carton invariant in initial finalization AND committed replay.
ALTER FUNCTION public.phase43_assert_operational_replacement_evidence_internal(UUID,BOOLEAN)
RENAME TO package_d_replacement_evidence_before_carton_internal;
REVOKE ALL ON FUNCTION public.package_d_replacement_evidence_before_carton_internal(UUID,BOOLEAN)
FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.phase43_assert_operational_replacement_evidence_internal(p_operation_id UUID,p_require_issued BOOLEAN DEFAULT true)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item RECORD;
BEGIN
  PERFORM public.package_d_replacement_evidence_before_carton_internal(p_operation_id,p_require_issued);
  FOR v_item IN SELECT root_order_item_id,quantity FROM public.sales_replacement_items WHERE operation_id=p_operation_id LOOP
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_item.root_order_item_id,v_item.quantity);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.phase43_assert_operational_replacement_evidence_internal(UUID,BOOLEAN)
FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.phase42_assert_operational_return_evidence_internal(UUID,BOOLEAN)
RENAME TO package_d_assert_return_evidence_before_single_sku_internal;
REVOKE ALL ON FUNCTION public.package_d_assert_return_evidence_before_single_sku_internal(UUID,BOOLEAN)
FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.phase42_assert_operational_return_evidence_internal(p_operation_id UUID,p_require_settled BOOLEAN DEFAULT true)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_item RECORD; v_root RECORD;
BEGIN
  PERFORM public.package_d_assert_return_evidence_before_single_sku_internal(p_operation_id,p_require_settled);
  FOR v_item IN SELECT * FROM public.sales_return_items
    WHERE operation_id=p_operation_id AND return_scope='base_unit' LOOP
    PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_item.order_item_id,v_item.returned_quantity);
    PERFORM public.package_d_assert_carton_return_item_internal(to_jsonb(v_item));
  END LOOP;
  FOR v_item IN SELECT source_kind,source_id,product_id,consumed_quantity
    FROM public.sales_aftercare_consumptions WHERE operation_id=p_operation_id LOOP
    SELECT * INTO v_root FROM public.phase4_aftercare_source_root_internal(v_item.source_kind,v_item.source_id,v_item.product_id);
    IF v_root.root_kind='base_order_item' THEN
      PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_root.root_id,v_item.consumed_quantity);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.phase42_assert_operational_return_evidence_internal(UUID,BOOLEAN)
FROM PUBLIC,anon,authenticated,service_role;

-- Owner correction: active, durable cancellation evidence. An absence read
-- alone is not a reservation: cancellation rechecks under the same raw-key
-- gate as POS issuance and prevents a delayed request from committing later.
CREATE TABLE public.pos_uncommitted_attempt_cancellations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id,idempotency_key)
);
ALTER TABLE public.pos_uncommitted_attempt_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_uncommitted_attempt_cancellations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.package_d_reject_pos_cancellation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PACKAGE_D_POS_CANCELLATION_IMMUTABLE: Cancellation evidence is immutable';
END;
$$;
CREATE TRIGGER trg_pos_cancellation_immutable BEFORE UPDATE OR DELETE
ON public.pos_uncommitted_attempt_cancellations FOR EACH ROW
EXECUTE FUNCTION public.package_d_reject_pos_cancellation_mutation();
REVOKE ALL ON FUNCTION public.package_d_reject_pos_cancellation_mutation() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_pos_sale_attempt_state_v1(p_idempotency_key TEXT,p_request_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor UUID:=auth.uid(); v_key TEXT:=nullif(btrim(p_idempotency_key),'');
  v_operation public.business_operations%ROWTYPE; v_cancel public.pos_uncommitted_attempt_cancellations%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'التحقق من محاولة الكاشير');
  IF v_actor IS NULL OR v_key IS NULL OR length(v_key) NOT BETWEEN 16 AND 200
    OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_IDENTITY_INVALID: Invalid attempt identity';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_key));
  SELECT * INTO v_operation FROM public.business_operations WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_operation.operation_type IS DISTINCT FROM 'phase3_pos_sale_v1'
      OR v_operation.initiated_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable';
    END IF;
    RETURN jsonb_build_object('state','EXISTS','actorId',v_actor,'idempotencyKey',v_key,
      'requestFingerprint',p_request_fingerprint);
  END IF;
  -- A historical order with this raw key is not proof of non-commit either.
  IF EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=v_key) THEN
    RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable';
  END IF;
  SELECT * INTO v_cancel FROM public.pos_uncommitted_attempt_cancellations
    WHERE actor_id=v_actor AND idempotency_key=v_key;
  IF FOUND AND v_cancel.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
    RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_CONFLICT: Cancellation request identity differs';
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN v_cancel.id IS NULL THEN 'ABSENT' ELSE 'CANCELLED_UNCOMMITTED' END,
    'actorId',v_actor,'idempotencyKey',v_key,'requestFingerprint',p_request_fingerprint,
    'cancellationId',v_cancel.id);
END;
$$;
ALTER FUNCTION public.get_pos_sale_attempt_state_v1(TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_pos_sale_attempt_state_v1(TEXT,TEXT) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_sale_attempt_state_v1(TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.cancel_uncommitted_pos_sale_attempt_v1(
  p_idempotency_key TEXT,p_request_fingerprint TEXT,p_confirmed BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_state JSONB; v_cancel public.pos_uncommitted_attempt_cancellations%ROWTYPE;
BEGIN
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PACKAGE_D_POS_CANCEL_CONFIRMATION_REQUIRED: Explicit confirmation is required';
  END IF;
  v_state:=public.get_pos_sale_attempt_state_v1(p_idempotency_key,p_request_fingerprint);
  IF v_state->>'state'='EXISTS' THEN
    RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_COMMITTED: استرجع العملية المسجلة؛ لا يمكن إلغاء المحاولة';
  END IF;
  -- The identity read holds the issuance gate to the end of this transaction.
  INSERT INTO public.pos_uncommitted_attempt_cancellations(actor_id,idempotency_key,request_fingerprint)
    VALUES(auth.uid(),btrim(p_idempotency_key),p_request_fingerprint)
    ON CONFLICT(actor_id,idempotency_key) DO NOTHING;
  SELECT * INTO STRICT v_cancel FROM public.pos_uncommitted_attempt_cancellations
    WHERE actor_id=auth.uid() AND idempotency_key=btrim(p_idempotency_key);
  RETURN v_state || jsonb_build_object('state','CANCELLED_UNCOMMITTED','cancellationId',v_cancel.id);
END;
$$;
ALTER FUNCTION public.cancel_uncommitted_pos_sale_attempt_v1(TEXT,TEXT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_uncommitted_pos_sale_attempt_v1(TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_uncommitted_pos_sale_attempt_v1(TEXT,TEXT,BOOLEAN) TO authenticated;

ALTER FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT)
  RENAME TO package_d_create_pos_sale_before_attempt_guard_internal;
REVOKE ALL ON FUNCTION public.package_d_create_pos_sale_before_attempt_guard_internal(
  UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_pos_sale_v2(
  p_warehouse_id UUID,p_branch_id UUID,p_customer_id UUID,p_customer_name TEXT,
  p_payment_method TEXT,p_lines JSONB,p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_key TEXT:=nullif(btrim(p_idempotency_key),'');
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','sales'],'تنفيذ بيع الكاشير');
  IF v_key IS NULL OR length(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Invalid POS key';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_key));
  IF EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations
    WHERE actor_id=auth.uid() AND idempotency_key=v_key) THEN
    RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_CANCELLED: هذه المحاولة ألغيت بعد إثبات عدم تسجيلها؛ ابدأ بيعاً جديداً';
  END IF;
  -- Historical committed replay still uses its exact original payment fact.
  IF NOT EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=v_key)
    AND (p_payment_method IS NULL OR lower(btrim(p_payment_method)) NOT IN ('cash','cliq','debt')) THEN
    RAISE EXCEPTION 'PHASE3_POS_PAYMENT_METHOD_INVALID: الكاشير يدعم كاش وCliQ ودين فقط';
  END IF;
  RETURN public.package_d_create_pos_sale_before_attempt_guard_internal(
    p_warehouse_id,p_branch_id,p_customer_id,p_customer_name,p_payment_method,p_lines,
    p_discount_in_minor_units,p_amount_received_in_minor_units,p_idempotency_key);
END;
$$;
ALTER FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT)
  TO authenticated;

ALTER TABLE public.order_items
  ADD COLUMN effective_standalone_unit_sale_price_snapshot_in_minor_units BIGINT
    CHECK (effective_standalone_unit_sale_price_snapshot_in_minor_units >= 0);
COMMENT ON COLUMN public.order_items.effective_standalone_unit_sale_price_snapshot_in_minor_units IS
  'Server-captured standalone unit price for new modern single-SKU cartons; old NULL is not backfilled.';

CREATE FUNCTION public.package_d_capture_single_sku_price_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_type TEXT; v_phone TEXT; v_code TEXT; v_frozen TIMESTAMPTZ; v_packet_price BIGINT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units IS DISTINCT FROM
       OLD.effective_standalone_unit_sale_price_snapshot_in_minor_units
      OR (OLD.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NOT NULL
        AND ROW(NEW.order_id,NEW.product_id,NEW.commercial_line_kind,NEW.quantity,NEW.units_per_sale_package,
          NEW.sale_package_quantity,NEW.net_refundable_amount_snapshot_in_minor_units)
        IS DISTINCT FROM ROW(OLD.order_id,OLD.product_id,OLD.commercial_line_kind,OLD.quantity,OLD.units_per_sale_package,
          OLD.sale_package_quantity,OLD.net_refundable_amount_snapshot_in_minor_units)) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',
        MESSAGE='PACKAGE_D_CARTON_PRICE_IMMUTABLE: Historical standalone price cannot be changed or backfilled.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='PHASE4_STANDALONE_PRICE_SERVER_AUTHORITY_REQUIRED: Caller supplied snapshot forbidden.';
  END IF;
  IF NEW.commercial_line_kind='legacy_single_sku_parcel' THEN
    SELECT sale_price_in_minor_units INTO v_packet_price FROM public.products
    WHERE id=NEW.product_id AND is_active AND NOT is_flavor_master FOR SHARE;
    -- A missing standalone packet price is not a missing carton price. Keep
    -- the nullable evidence absent; only CUSTOMER_DAMAGE requires this fact.
    -- Do not catch unrelated pricing/promotion/authority errors.
    IF FOUND AND v_packet_price=0 THEN RETURN NEW; END IF;
    SELECT op.operation_type, c.phone, o.promotion_code_snapshot, op.completed_at
      INTO v_type,v_phone,v_code,v_frozen
    FROM public.orders o JOIN public.business_operations op ON op.id=o.operation_id
      LEFT JOIN public.customers c ON c.id=o.customer_id WHERE o.id=NEW.order_id;
    IF v_type='phase3_pos_sale_v1' THEN
      NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units :=
        public.phase4_effective_standalone_unit_price_internal(NEW.product_id,'admin_pos',NULL,NULL,v_frozen);
    ELSIF v_type='phase3_customer_reservation_v1' THEN
      NEW.effective_standalone_unit_sale_price_snapshot_in_minor_units :=
        public.phase4_effective_standalone_unit_price_internal(NEW.product_id,'customer_v2',v_phone,v_code,v_frozen);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_package_d_capture_single_sku_price_snapshot
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.package_d_capture_single_sku_price_snapshot();
REVOKE ALL ON FUNCTION public.package_d_capture_single_sku_price_snapshot()
FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.package_d_capture_single_sku_price_snapshot() OWNER TO postgres;

-- Shared insert/finalization/replay proof. Request identity owns inspection;
-- independent immutable sale evidence owns price, entitlement and carton size.
CREATE FUNCTION public.package_d_assert_carton_return_item_internal(p_item JSONB)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_sale public.order_items%ROWTYPE; v_request JSONB; v_expected JSONB;
  v_quantity INTEGER := (p_item->>'returned_quantity')::INTEGER;
  v_damage INTEGER := (p_item->>'rejected_base_quantity')::INTEGER;
  v_raw BIGINT := (p_item->>'raw_customer_damage_deduction_in_minor_units')::BIGINT;
  v_applied BIGINT := (p_item->>'applied_customer_damage_deduction_in_minor_units')::BIGINT;
  v_gross BIGINT := (p_item->>'refund_amount_snapshot_in_minor_units')::BIGINT + v_applied;
  v_share NUMERIC; v_total_quantity BIGINT; v_total_gross BIGINT;
BEGIN
  SELECT * INTO v_sale FROM public.order_items WHERE id=(p_item->>'order_item_id')::UUID;
  IF v_sale.commercial_line_kind IS DISTINCT FROM 'legacy_single_sku_parcel' THEN RETURN; END IF;
  PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_sale.id,v_quantity);
  IF v_damage>0 AND v_quantity IS DISTINCT FROM v_sale.units_per_sale_package THEN
    RAISE EXCEPTION USING ERRCODE='22023',
      MESSAGE='PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE: افحص ضرر العميل بمرتجع مستقل لكل كرتونة.';
  END IF;
  SELECT request_identity_snapshot INTO v_request FROM public.business_operations
    WHERE id=(p_item->>'operation_id')::UUID AND operation_type='phase4_return_v1';
  SELECT value INTO v_expected FROM jsonb_array_elements(v_request->'items')
    WHERE value->>'return_scope'='base_unit' AND value->>'order_item_id'=v_sale.id::TEXT;
  IF v_expected IS NULL OR (v_expected->>'quantity')::INTEGER IS DISTINCT FROM v_quantity
    OR COALESCE((v_expected->>'customer_damage_quantity')::INTEGER,0) IS DISTINCT FROM v_damage
    OR v_damage IS NULL OR v_damage<0 OR v_damage>v_quantity
    OR (p_item->>'accepted_base_quantity')::INTEGER IS DISTINCT FROM v_quantity-v_damage
    OR v_expected->>'stock_disposition' IS DISTINCT FROM p_item->>'stock_disposition' THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PACKAGE_D_CARTON_INSPECTION_INVALID: Request and inspection differ.';
  END IF;
  IF v_damage>0 AND v_sale.effective_standalone_unit_sale_price_snapshot_in_minor_units IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0001',
      MESSAGE='PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING: هذا البيع القديم لا يحتوي سعر القطعة التاريخي؛ لا يمكن تسوية ضرر العميل. مرتجع السليم وعيب المورد متاحان.';
  END IF;
  v_share:=v_sale.net_refundable_amount_snapshot_in_minor_units::NUMERIC*v_quantity/v_sale.quantity;
  IF v_raw IS DISTINCT FROM v_damage::BIGINT*COALESCE(v_sale.effective_standalone_unit_sale_price_snapshot_in_minor_units,0)
    OR v_gross IS NULL OR v_gross<FLOOR(v_share) OR v_gross>CEIL(v_share)
    OR v_applied IS DISTINCT FROM LEAST(v_raw,v_gross) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PACKAGE_D_CARTON_DAMAGE_EVIDENCE_INVALID: Historical deduction or entitlement is invalid.';
  END IF;
  SELECT COALESCE(SUM(i.returned_quantity),0),COALESCE(SUM(i.refund_amount_snapshot_in_minor_units+
    i.applied_customer_damage_deduction_in_minor_units),0)
    INTO v_total_quantity,v_total_gross
  FROM public.sales_return_items i JOIN public.sales_return_events e ON e.id=i.sales_return_event_id
  WHERE i.order_item_id=v_sale.id AND e.settlement_status='settled'
    AND i.id IS DISTINCT FROM (p_item->>'id')::UUID;
  IF v_total_quantity+v_quantity>v_sale.quantity
    OR v_total_gross+v_gross>v_sale.net_refundable_amount_snapshot_in_minor_units
    OR (v_total_quantity+v_quantity=v_sale.quantity
      AND v_total_gross+v_gross IS DISTINCT FROM v_sale.net_refundable_amount_snapshot_in_minor_units) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PHASE4_BASE_RETURN_CUMULATIVE_BOUND_INVALID: Gross entitlement consumed exactly once.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.package_d_assert_carton_return_item_internal(JSONB)
FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.package_d_assert_carton_return_item_internal(JSONB) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.phase42_canonicalize_return_request_before_phase43_internal(
  p_order_id UUID,
  p_items JSONB,
  p_reason TEXT,
  p_refund_method TEXT,
  p_reference_number TEXT,
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_method TEXT := LOWER(NULLIF(BTRIM(p_refund_method), ''));
  v_reference TEXT := NULLIF(BTRIM(p_reference_number), '');
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_item JSONB;
  v_component JSONB;
  v_items JSONB := '[]'::JSONB;
  v_components JSONB;
  v_scope TEXT;
  v_order_item_id UUID;
  v_parcel_instance_id UUID;
  v_component_id UUID;
  v_quantity INTEGER;
  v_accepted INTEGER;
  v_rejected INTEGER;
  v_condition TEXT;
  v_accepted_disposition TEXT;
  v_rejection_reason TEXT;
  v_rejected_disposition TEXT;
BEGIN
  IF p_order_id IS NULL OR v_reason IS NULL OR CHAR_LENGTH(v_reason) < 3
    OR CHAR_LENGTH(v_reason) > 500
    OR p_items IS NULL OR JSONB_TYPEOF(p_items) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_items) = 0
    OR JSONB_ARRAY_LENGTH(p_items) > 100
    OR v_method IS NOT NULL AND v_method NOT IN ('cash', 'cliq')
    OR v_method = 'cliq' AND v_reference IS NULL
    OR v_method IS DISTINCT FROM 'cliq' AND v_reference IS NOT NULL
    OR CHAR_LENGTH(COALESCE(v_reference, '')) > 120
    OR CHAR_LENGTH(COALESCE(v_notes, '')) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE42_RETURN_REQUEST_INVALID: Return request shape is invalid.';
  END IF;

  FOR v_item IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(p_items)
    ORDER BY value->>'order_item_id', value->>'return_scope',
      COALESCE(value->>'parcel_instance_id', '')
  LOOP
    IF JSONB_TYPEOF(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE42_RETURN_ITEM_INVALID: Return item must be an object.';
    END IF;
    v_scope := LOWER(NULLIF(BTRIM(v_item->>'return_scope'), ''));
    v_order_item_id := public.phase3_require_uuid_internal(
      v_item->>'order_item_id', 'return item order_item_id'
    );

    IF v_scope = 'base_unit' THEN
      IF v_item - ARRAY[
          'return_scope', 'order_item_id', 'quantity', 'stock_disposition', 'customer_damage_quantity'
        ]::TEXT[] <> '{}'::JSONB
        OR COALESCE(v_item->>'quantity', '') !~ '^[1-9][0-9]*$'
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_BASE_RETURN_ITEM_INVALID: Base Unit Return shape is invalid.';
      END IF;
      v_quantity := (v_item->>'quantity')::INTEGER;
      IF v_item ? 'customer_damage_quantity' AND (
        COALESCE(v_item->>'customer_damage_quantity','') !~ '^[0-9]+$'
        OR (v_item->>'customer_damage_quantity')::BIGINT > v_quantity
      ) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='PACKAGE_D_CARTON_INSPECTION_INVALID: Invalid rejected quantity.';
      END IF;
      IF v_quantity <= 0 OR v_quantity > 2147483647
        OR LOWER(COALESCE(v_item->>'stock_disposition', ''))
          NOT IN ('restock', 'damaged')
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_BASE_RETURN_ITEM_INVALID: Base Unit quantity or disposition is invalid.';
      END IF;
      v_items := v_items || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'return_scope', 'base_unit',
        'order_item_id', LOWER(v_order_item_id::TEXT),
        'quantity', v_quantity,
        'stock_disposition', LOWER(v_item->>'stock_disposition')
      ) || CASE WHEN COALESCE((v_item->>'customer_damage_quantity')::INTEGER,0)>0
        THEN jsonb_build_object('customer_damage_quantity',(v_item->>'customer_damage_quantity')::INTEGER)
        ELSE '{}'::JSONB END);
    ELSIF v_scope = 'parcel_instance' THEN
      IF v_item - ARRAY[
          'return_scope', 'order_item_id', 'parcel_instance_id', 'components'
        ]::TEXT[] <> '{}'::JSONB
        OR JSONB_TYPEOF(v_item->'components') IS DISTINCT FROM 'array'
        OR JSONB_ARRAY_LENGTH(v_item->'components') = 0
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE42_PARCEL_RETURN_ITEM_INVALID: Parcel Return shape is invalid.';
      END IF;
      v_parcel_instance_id := public.phase3_require_uuid_internal(
        v_item->>'parcel_instance_id', 'return item parcel_instance_id'
      );
      v_components := '[]'::JSONB;
      FOR v_component IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
        ORDER BY value->>'parcel_component_id'
      LOOP
        IF JSONB_TYPEOF(v_component) IS DISTINCT FROM 'object'
          OR v_component - ARRAY[
            'parcel_component_id', 'accepted_quantity', 'rejected_quantity',
            'accepted_condition', 'accepted_stock_disposition',
            'rejection_reason', 'rejected_stock_disposition'
          ]::TEXT[] <> '{}'::JSONB
          OR COALESCE(v_component->>'accepted_quantity', '') !~ '^[0-9]+$'
          OR COALESCE(v_component->>'rejected_quantity', '') !~ '^[0-9]+$'
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE42_PARCEL_INSPECTION_INVALID: Component inspection shape is invalid.';
        END IF;
        v_component_id := public.phase3_require_uuid_internal(
          v_component->>'parcel_component_id', 'parcel_component_id'
        );
        v_accepted := (v_component->>'accepted_quantity')::INTEGER;
        v_rejected := (v_component->>'rejected_quantity')::INTEGER;
        v_condition := LOWER(NULLIF(BTRIM(v_component->>'accepted_condition'), ''));
        v_accepted_disposition := LOWER(NULLIF(BTRIM(
          v_component->>'accepted_stock_disposition'
        ), ''));
        v_rejection_reason := LOWER(NULLIF(BTRIM(
          v_component->>'rejection_reason'
        ), ''));
        v_rejected_disposition := LOWER(NULLIF(BTRIM(
          v_component->>'rejected_stock_disposition'
        ), ''));
        IF v_accepted + v_rejected <= 0
          OR (v_accepted = 0 AND (
            v_condition IS NOT NULL OR v_accepted_disposition IS NOT NULL))
          OR (v_accepted > 0 AND NOT (
            (v_condition = 'sellable' AND v_accepted_disposition = 'restock')
            OR (v_condition = 'supplier_defect'
              AND v_accepted_disposition = 'non_sellable')))
          OR (v_rejected = 0 AND (
            v_rejection_reason IS NOT NULL OR v_rejected_disposition IS NOT NULL))
          OR (v_rejected > 0 AND NOT (
            v_rejection_reason = 'customer_damage'
            AND v_rejected_disposition = 'returned_to_customer'))
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE42_PARCEL_INSPECTION_INVALID: Component quantities and dispositions are inconsistent.';
        END IF;
        v_components := v_components || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'parcel_component_id', LOWER(v_component_id::TEXT),
          'accepted_quantity', v_accepted,
          'rejected_quantity', v_rejected,
          'accepted_condition', v_condition,
          'accepted_stock_disposition', v_accepted_disposition,
          'rejection_reason', v_rejection_reason,
          'rejected_stock_disposition', v_rejected_disposition
        ));
      END LOOP;
      v_items := v_items || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
        'return_scope', 'parcel_instance',
        'order_item_id', LOWER(v_order_item_id::TEXT),
        'parcel_instance_id', LOWER(v_parcel_instance_id::TEXT),
        'components', v_components
      ));
    ELSE
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'PHASE42_RETURN_SCOPE_INVALID: Return scope is unsupported.';
    END IF;
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'order_id', LOWER(p_order_id::TEXT),
    'reason', v_reason,
    'refund_method', v_method,
    'reference_number', v_reference,
    'notes', v_notes,
    'items', v_items
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.phase43_assert_return_allocation_contract_internal(
  p_base_request JSONB,
  p_physical_sources JSONB
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_component JSONB;
  v_root_kind TEXT;
  v_root_id TEXT;
  v_quantity INTEGER;
  v_sellable INTEGER;
  v_defect INTEGER;
  v_damage INTEGER;
BEGIN
  FOR v_item IN SELECT value FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items')
  LOOP
    IF v_item->>'return_scope' = 'base_unit' THEN
      v_root_kind := 'base_order_item';
      v_root_id := v_item->>'order_item_id';
      v_quantity := (v_item->>'quantity')::INTEGER;
      SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
        COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
      INTO v_sellable, v_defect, v_damage
      FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
      WHERE source->>'root_source_kind' = v_root_kind
        AND source->>'root_source_id' = v_root_id;
      IF v_sellable + v_defect + v_damage IS DISTINCT FROM v_quantity
        OR v_damage IS DISTINCT FROM COALESCE((v_item->>'customer_damage_quantity')::INTEGER,0)
        OR (v_item->>'stock_disposition' = 'restock' AND v_sellable <= 0)
        OR (v_item->>'stock_disposition' = 'damaged' AND v_sellable <> 0)
        OR (NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=v_root_id::UUID
          AND oi.commercial_line_kind='legacy_single_sku_parcel')
          AND (v_damage <> 0 OR (v_sellable > 0 AND v_defect > 0)))
      THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Base-unit inspection does not match its physical leaves.';
      END IF;
    ELSE
      FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_item->'components')
      LOOP
        v_root_kind := 'parcel_component';
        v_root_id := v_component->>'parcel_component_id';
        SELECT COALESCE(SUM((source->>'sellable_restock_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'defect_non_sellable_quantity')::INTEGER), 0)::INTEGER,
          COALESCE(SUM((source->>'customer_damage_quantity')::INTEGER), 0)::INTEGER
        INTO v_sellable, v_defect, v_damage
        FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
        WHERE source->>'root_source_kind' = v_root_kind
          AND source->>'root_source_id' = v_root_id;
        IF v_sellable + v_defect
            IS DISTINCT FROM (v_component->>'accepted_quantity')::INTEGER
          OR v_damage IS DISTINCT FROM (v_component->>'rejected_quantity')::INTEGER
          OR (v_sellable > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'sellable'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'restock'))
          OR (v_sellable = 0 AND v_defect > 0 AND (
            v_component->>'accepted_condition' IS DISTINCT FROM 'supplier_defect'
            OR v_component->>'accepted_stock_disposition' IS DISTINCT FROM 'non_sellable'))
          OR (v_sellable + v_defect = 0 AND (
            v_component->>'accepted_condition' IS NOT NULL
            OR v_component->>'accepted_stock_disposition' IS NOT NULL))
          OR (v_damage > 0 AND (
            v_component->>'rejection_reason' IS DISTINCT FROM 'customer_damage'
            OR v_component->>'rejected_stock_disposition' IS DISTINCT FROM 'returned_to_customer'))
          OR (v_damage = 0 AND (
            v_component->>'rejection_reason' IS NOT NULL
            OR v_component->>'rejected_stock_disposition' IS NOT NULL))
        THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Parcel inspection does not equal its three-bucket physical allocation.';
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_physical_sources) source
    WHERE NOT EXISTS (
      SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_base_request->'items') item
      WHERE (item->>'return_scope' = 'base_unit'
          AND source->>'root_source_kind' = 'base_order_item'
          AND source->>'root_source_id' = item->>'order_item_id')
        OR (item->>'return_scope' = 'parcel_instance'
          AND source->>'root_source_kind' = 'parcel_component'
          AND EXISTS (SELECT 1 FROM JSONB_ARRAY_ELEMENTS(item->'components') component
            WHERE component->>'parcel_component_id' = source->>'root_source_id'))
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'PHASE43_RETURN_ALLOCATION_MISMATCH: Physical allocation contains a root outside the Return request.';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.phase4_validate_return_item_insert()
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
    PERFORM public.package_d_assert_carton_return_item_internal(to_jsonb(NEW));
    IF NEW.accepted_base_quantity + NEW.rejected_base_quantity
        IS DISTINCT FROM NEW.returned_quantity
      OR (NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.id=NEW.order_item_id
        AND oi.commercial_line_kind='legacy_single_sku_parcel') AND (
          NEW.raw_customer_damage_deduction_in_minor_units <> 0
          OR NEW.applied_customer_damage_deduction_in_minor_units <> 0))
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
ALTER FUNCTION public.phase42_canonicalize_return_request_before_phase43_internal(UUID,JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase43_assert_return_allocation_contract_internal(JSONB,JSONB) OWNER TO postgres;
ALTER FUNCTION public.phase4_validate_return_item_insert() OWNER TO postgres;

-- D4: retire the never-activated private layer. Lock before checking for data;
-- unexpected use aborts this entire migration, not just the DROP section.
LOCK TABLE phase5_private.financial_operation_events, phase5_private.collection_events,
  phase5_private.payment_reversal_events, phase5_private.reversal_coordinator_guards,
  phase5_private.reversal_tender_movements, phase5_private.reversal_coordinator_completions
  IN ACCESS EXCLUSIVE MODE;
DO $private_retirement$
BEGIN
  IF EXISTS(SELECT 1 FROM phase5_private.financial_operation_events)
    OR EXISTS(SELECT 1 FROM phase5_private.collection_events)
    OR EXISTS(SELECT 1 FROM phase5_private.payment_reversal_events)
    OR EXISTS(SELECT 1 FROM phase5_private.reversal_coordinator_guards)
    OR EXISTS(SELECT 1 FROM phase5_private.reversal_tender_movements)
    OR EXISTS(SELECT 1 FROM phase5_private.reversal_coordinator_completions) THEN
    RAISE EXCEPTION 'PACKAGE_D_PRIVATE_DATA_PRESENT: owner review required before retirement';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('phase5_private','pg_catalog','information_schema')
      AND p.prosrc LIKE '%phase5_private%')
    OR EXISTS(SELECT 1 FROM cron.job WHERE command LIKE '%phase5_private%') THEN
    RAISE EXCEPTION 'PACKAGE_D_PRIVATE_CALLER_PRESENT: owner review required before retirement';
  END IF;
END;
$private_retirement$;

-- Callers first, then leaf readers/writers. No generated SQL and no CASCADE.
DROP FUNCTION phase5_private.reconcile_order_financial_position_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.read_order_financial_position_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.derive_financial_position_v1(JSONB) RESTRICT;
DROP FUNCTION phase5_private.read_order_financial_facts_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.return_entitlement_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.discover_order_financial_graph_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.financial_graph_nodes_v1() RESTRICT;
DROP FUNCTION phase5_private.financial_node_links_v1(TEXT,JSONB) RESTRICT;
DROP FUNCTION phase5_private.discovery_uuid_v1(JSONB) RESTRICT;
DROP FUNCTION phase5_private.money_v1(JSONB) RESTRICT;
DROP FUNCTION phase5_private.coordinate_payment_reversal_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT) RESTRICT;
DROP FUNCTION phase5_private.validate_operational_reversal_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.reversal_position_v1(UUID,JSONB,UUID[],UUID[],UUID,TIMESTAMPTZ) RESTRICT;
DROP FUNCTION phase5_private.anchor_existing_collection_v1(UUID,UUID,UUID,TEXT) RESTRICT;
DROP FUNCTION phase5_private.lock_coordinator_context_v1(UUID,UUID,BOOLEAN,UUID) RESTRICT;
DROP FUNCTION phase5_private.coordinator_lock_plan_v1(UUID,BOOLEAN) RESTRICT;
DROP FUNCTION phase5_private.discover_collection_population_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.collection_source_v1(UUID,TEXT,UUID) RESTRICT;
DROP FUNCTION phase5_private.authorize_coordinator_actor_v1(UUID,BOOLEAN) RESTRICT;
DROP FUNCTION phase5_private.commit_customer_payment_reversal_v1(UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT) RESTRICT;
DROP FUNCTION phase5_private.commit_customer_collection_v1(UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT) RESTRICT;
DROP FUNCTION phase5_private.validate_customer_payment_reversal_operation_v1(UUID) RESTRICT;
DROP FUNCTION phase5_private.validate_customer_collection_operation_v1(UUID) RESTRICT;

DROP TABLE phase5_private.reversal_coordinator_completions RESTRICT;
DROP TABLE phase5_private.reversal_tender_movements RESTRICT;
DROP TABLE phase5_private.reversal_coordinator_guards RESTRICT;
DROP TABLE phase5_private.payment_reversal_events RESTRICT;
DROP TABLE phase5_private.collection_events RESTRICT;
DROP TABLE phase5_private.financial_operation_events RESTRICT;
DROP FUNCTION phase5_private.assert_operational_completion_v1() RESTRICT;
DROP FUNCTION phase5_private.assert_coordinator_insert_v1() RESTRICT;
DROP FUNCTION phase5_private.assert_collection_source() RESTRICT;
DROP FUNCTION phase5_private.reject_financial_evidence_mutation() RESTRICT;
DROP SCHEMA phase5_private RESTRICT;

REVOKE ALL ON FUNCTION public.create_customer_order_base_units_legacy(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,
  DOUBLE PRECISION,DOUBLE PRECISION,TEXT,TEXT,TEXT,UUID,UUID,
  JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT
) FROM service_role;
-- Explicit repository authority for every new/renamed definer, including wrappers.
ALTER FUNCTION public.package_d_assert_modern_sale_internal(UUID,TEXT) OWNER TO postgres;
ALTER FUNCTION public.settle_sales_return_v1(UUID,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.settle_sales_replacement_v1(UUID,TEXT,JSONB,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_pos_sale(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.return_completed_website_order(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.create_customer_order(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,TEXT,TEXT,UUID,UUID,JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.package_d_guard_physical_capacity_internal() OWNER TO postgres;
ALTER FUNCTION public.save_product_parcel_configuration_v1(UUID,TEXT,BOOLEAN,INTEGER,UUID[]) OWNER TO postgres;
ALTER FUNCTION public.save_product_parcel_configuration_v1(UUID,TEXT,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.phase3_validate_configurable_parcel_internal(TEXT,UUID,UUID,UUID,INTEGER,JSONB) OWNER TO postgres;
ALTER FUNCTION public.get_admin_parcel_configuration_context_v1() OWNER TO postgres;
ALTER FUNCTION public.get_pos_configurable_parcel_options_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.get_public_configurable_parcel_options(UUID[]) OWNER TO postgres;
ALTER FUNCTION public.package_d_assert_whole_single_sku_quantity_internal(UUID,INTEGER) OWNER TO postgres;
ALTER FUNCTION public.phase4_finalize_aftercare_operation_foundation_internal(UUID) OWNER TO postgres;
ALTER FUNCTION public.package_d_settle_sales_return_before_guard_internal(UUID,TEXT,JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.package_d_settle_sales_replacement_before_guard_internal(UUID,TEXT,JSONB,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.get_admin_sales_aftercare_context_v1(UUID) OWNER TO postgres;
ALTER FUNCTION public.preview_guest_promotion_v2(JSONB,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.phase43_assert_operational_replacement_evidence_internal(UUID,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.phase42_assert_operational_return_evidence_internal(UUID,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.get_pos_sale_attempt_state_v1(TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_uncommitted_pos_sale_attempt_v1(TEXT,TEXT,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.create_pos_sale_v2(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.package_d_create_customer_order_before_source_guard_internal(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,TEXT,TEXT,TEXT,UUID,UUID,JSONB,BIGINT,BIGINT,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.package_d_validate_configurable_parcel_before_policy_internal(TEXT,UUID,UUID,UUID,INTEGER,JSONB) OWNER TO postgres;
ALTER FUNCTION public.package_d_public_parcel_options_before_policy_internal(UUID[]) OWNER TO postgres;
ALTER FUNCTION public.package_d_replacement_evidence_before_carton_internal(UUID,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.package_d_assert_return_evidence_before_single_sku_internal(UUID,BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.package_d_create_pos_sale_before_attempt_guard_internal(UUID,UUID,UUID,TEXT,TEXT,JSONB,BIGINT,BIGINT,TEXT) OWNER TO postgres;

-- Owner-approved single-SKU carton damage: capture at sale, never backfill.

COMMIT;
