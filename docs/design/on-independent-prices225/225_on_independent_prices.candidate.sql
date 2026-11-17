-- Owner-approved ON225 work in progress. Quarantined until its writers,
-- runtime/golden proofs and versioned protection tools are complete.
-- No historical body, inventory/cost table or existing sale writer is replaced.
BEGIN;
DO $history225$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>184
 OR (SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>224 THEN
  RAISE EXCEPTION 'PRICES225_EXACT224_HISTORY_REQUIRED';
 END IF;
END $history225$;

CREATE TABLE public.product_sale_pricing_state225 (
 product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
 parcel_enabled BOOLEAN NOT NULL DEFAULT true,
 original_unit_price BIGINT CHECK(original_unit_price>0),
 original_unit_price_at TIMESTAMPTZ,
 original_unit_price_by UUID,
 original_parcel_price BIGINT CHECK(original_parcel_price>0),
 original_parcel_price_at TIMESTAMPTZ,
 original_parcel_price_by UUID,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 changed_by UUID NOT NULL,
 CHECK((original_unit_price IS NULL)=(original_unit_price_at IS NULL)
   AND (original_unit_price IS NULL)=(original_unit_price_by IS NULL)),
 CHECK((original_parcel_price IS NULL)=(original_parcel_price_at IS NULL)
   AND (original_parcel_price IS NULL)=(original_parcel_price_by IS NULL))
);
ALTER TABLE public.product_sale_pricing_state225 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_sale_pricing_state225 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.price225_assert_context_internal() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'حفظ أسعار المنتج');
 PERFORM sales_lite1.lock_mode();
 IF sales_lite1.enabled() THEN
  RAISE EXCEPTION 'PRICES225_ON_REQUIRED: هذا المسار مخصص لوضع المحاسبة المفعّل.';
 END IF;
END;
$$;
ALTER FUNCTION public.price225_assert_context_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_assert_context_internal() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.price225_assert_prices_internal(
 p_unit UUID,p_parcel_unit UUID,p_units INTEGER,p_single BIGINT,p_parcel BIGINT,
 p_parcel_enabled BOOLEAN,p_parcel_only BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_unit IS NULL OR p_parcel_unit IS NULL OR p_units IS NULL OR p_units<1
 OR p_parcel_enabled IS NULL OR p_parcel_only IS NULL THEN
  RAISE EXCEPTION 'PRICES225_UNIT_REQUIRED: اختر الوحدة وعدد وحدات الطرد الصحيح.';
 END IF;
 IF p_single IS NULL OR p_parcel IS NULL OR p_single<=0 OR p_parcel<=0 THEN
  RAISE EXCEPTION 'PRICES225_POSITIVE_PRICE_REQUIRED: يجب أن يكون السعر أكبر من صفر وبثلاث منازل.';
 END IF;
 IF p_units=1 THEN
  IF p_single<>p_parcel OR p_parcel_only THEN
   RAISE EXCEPTION 'PRICES225_SINGLE_PRICE_MISMATCH: البيع المفرد له سعر واحد ولا يُباع كطرد متعدد.';
  END IF;
 ELSE
  IF p_unit=p_parcel_unit THEN
   RAISE EXCEPTION 'PRICES225_DISTINCT_PARCEL_UNIT_REQUIRED: اختر للطرد وحدة تختلف عن وحدة المحتوى.';
  END IF;
  -- A paused parcel preserves its recorded price. Only its reactivation is
  -- admitted against the latest single price; no sale may bypass the pause.
  IF p_parcel_enabled THEN
   IF p_parcel=p_single THEN
    RAISE EXCEPTION 'PRICES225_UNSAFE_PARCEL_PRICE: لا يمكن بيع عدة وحدات بسعر وحدة واحدة.';
   END IF;
   IF p_parcel::NUMERIC>p_units::NUMERIC*p_single::NUMERIC THEN
    RAISE EXCEPTION 'PRICES225_PARCEL_PRICE_TOO_HIGH: سعر الطرد أعلى من مجموع الوحدات المفردة. عدّل سعر الطرد ثم أعد تفعيل بيعه.';
   END IF;
  END IF;
 END IF;
END;
$$;
ALTER FUNCTION public.price225_assert_prices_internal(UUID,UUID,INTEGER,BIGINT,BIGINT,BOOLEAN,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_assert_prices_internal(UUID,UUID,INTEGER,BIGINT,BIGINT,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

-- This is an exact current-price/WAC confirmation, not a reusable boolean.
-- Callers must hold the existing product/family inventory locks first.
CREATE FUNCTION public.price225_loss_confirmation_internal(
 p_product UUID,p_single BIGINT,p_parcel BIGINT,p_units INTEGER,
 p_parcel_enabled BOOLEAN,p_parcel_only BOOLEAN,p_confirmation JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_risks JSONB;v_expected JSONB;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'productId',p.id,'name',p.name_ar,
  'wacInMinorUnitsExact',coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)::TEXT,
  'unitBelowCost',NOT p_parcel_only AND p_single::NUMERIC<coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC),
  'parcelBelowCost',p_parcel_enabled AND p_units>1 AND p_parcel::NUMERIC<p_units::NUMERIC*coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)
 ) ORDER BY p.id),'[]') INTO v_risks
 FROM public.products p
 WHERE (p.id=p_product AND NOT p.is_flavor_master OR p.flavor_master_product_id=p_product)
 AND ((NOT p_parcel_only AND p_single::NUMERIC<coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC))
   OR (p_parcel_enabled AND p_units>1 AND p_parcel::NUMERIC<p_units::NUMERIC*coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)));
 IF jsonb_array_length(v_risks)=0 THEN RETURN NULL;END IF;
 v_expected:=jsonb_build_object('acknowledged',true,'unitPrice',p_single,'parcelPrice',p_parcel,
  'unitsPerParcel',p_units,'parcelEnabled',p_parcel_enabled,'parcelOnly',p_parcel_only,'risks',v_risks);
 IF p_confirmation IS DISTINCT FROM v_expected THEN
  RAISE EXCEPTION USING MESSAGE='PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED: السعر أقل من التكلفة؛ راجع القيم الحالية وأكّد البيع بخسارة.',
   DETAIL=v_expected::TEXT;
 END IF;
 RETURN v_expected;
END;
$$;
ALTER FUNCTION public.price225_loss_confirmation_internal(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,BOOLEAN,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_loss_confirmation_internal(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,BOOLEAN,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.price225_record_state_internal(
 p_product UUID,p_before_single BIGINT,p_before_parcel BIGINT,
 p_single BIGINT,p_parcel BIGINT,p_enabled BOOLEAN,p_initial BOOLEAN,
 p_restore TEXT,p_loss_confirmation JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_old public.product_sale_pricing_state225;v_state public.product_sale_pricing_state225;
BEGIN
 SELECT * INTO v_old FROM public.product_sale_pricing_state225 WHERE product_id=p_product FOR UPDATE;
 INSERT INTO public.product_sale_pricing_state225(product_id,parcel_enabled,changed_by)
 VALUES(p_product,p_enabled,auth.uid()) ON CONFLICT(product_id) DO NOTHING;
 UPDATE public.product_sale_pricing_state225 SET
  parcel_enabled=p_enabled,
  original_unit_price=CASE WHEN p_restore IN('single','both') THEN NULL
   WHEN original_unit_price IS NULL AND NOT p_initial AND p_single<p_before_single THEN p_before_single ELSE original_unit_price END,
  original_unit_price_at=CASE WHEN p_restore IN('single','both') THEN NULL
   WHEN original_unit_price IS NULL AND NOT p_initial AND p_single<p_before_single THEN now() ELSE original_unit_price_at END,
  original_unit_price_by=CASE WHEN p_restore IN('single','both') THEN NULL
   WHEN original_unit_price IS NULL AND NOT p_initial AND p_single<p_before_single THEN auth.uid() ELSE original_unit_price_by END,
  original_parcel_price=CASE WHEN p_restore IN('parcel','both') THEN NULL
   WHEN original_parcel_price IS NULL AND NOT p_initial AND p_parcel<p_before_parcel THEN p_before_parcel ELSE original_parcel_price END,
  original_parcel_price_at=CASE WHEN p_restore IN('parcel','both') THEN NULL
   WHEN original_parcel_price IS NULL AND NOT p_initial AND p_parcel<p_before_parcel THEN now() ELSE original_parcel_price_at END,
  original_parcel_price_by=CASE WHEN p_restore IN('parcel','both') THEN NULL
   WHEN original_parcel_price IS NULL AND NOT p_initial AND p_parcel<p_before_parcel THEN auth.uid() ELSE original_parcel_price_by END,
  changed_at=now(),changed_by=auth.uid()
 WHERE product_id=p_product RETURNING * INTO v_state;
 IF p_enabled IS DISTINCT FROM coalesce(v_old.parcel_enabled,true) THEN
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(auth.uid(),'SET_PRODUCT_PARCEL_AVAILABILITY225','products',p_product,
   jsonb_build_object('before',coalesce(v_old.parcel_enabled,true),'after',p_enabled));
 END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(auth.uid(),CASE WHEN p_restore IS NULL THEN 'SET_PRODUCT_ON_PRICES225' ELSE 'RESTORE_PRODUCT_ORIGINAL_PRICE225' END,
  'products',p_product,jsonb_build_object('beforeSingle',p_before_single,'beforeParcel',p_before_parcel,
   'singlePrice',p_single,'parcelPrice',p_parcel,'parcelEnabled',p_enabled,'restoredUnit',p_restore,
   'beforeOriginals',to_jsonb(v_old),'afterOriginals',to_jsonb(v_state),'belowCostConfirmation',p_loss_confirmation));
END;
$$;
ALTER FUNCTION public.price225_record_state_internal(UUID,BIGINT,BIGINT,BIGINT,BIGINT,BOOLEAN,BOOLEAN,TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_record_state_internal(UUID,BIGINT,BIGINT,BIGINT,BIGINT,BOOLEAN,BOOLEAN,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_product_pricing_context225(p_product_id UUID,
 p_single_price BIGINT DEFAULT NULL,p_parcel_price BIGINT DEFAULT NULL,p_units INTEGER DEFAULT NULL,
 p_parcel_enabled BOOLEAN DEFAULT NULL,p_parcel_only BOOLEAN DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.products;v_state public.product_sale_pricing_state225;v_required JSONB;
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'قراءة قرار أسعار المنتج');
 IF sales_lite1.enabled() THEN RAISE EXCEPTION 'PRICES225_ON_REQUIRED: هذه الأسعار للمحاسبة المفعّلة فقط.';END IF;
 SELECT * INTO p FROM public.products WHERE id=p_product_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRICES225_PRODUCT_NOT_FOUND';END IF;
 IF p.flavor_master_product_id IS NOT NULL THEN
  SELECT * INTO STRICT p FROM public.products WHERE id=p.flavor_master_product_id;
 END IF;
 SELECT * INTO v_state FROM public.product_sale_pricing_state225 WHERE product_id=p.id;
 BEGIN
  PERFORM public.price225_loss_confirmation_internal(p.id,coalesce(p_single_price,p.sale_price_in_minor_units),
   coalesce(p_parcel_price,p.default_sale_price_in_minor_units),coalesce(p_units,p.units_per_sale_unit),
   coalesce(p_parcel_enabled,v_state.parcel_enabled,true),coalesce(p_parcel_only,p.parcel_only),NULL);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;
  GET STACKED DIAGNOSTICS v_required=PG_EXCEPTION_DETAIL;
 END;
 RETURN jsonb_build_object('contractVersion','on-independent-prices225-v1','productId',p.id,
  'requestedProductId',p_product_id,'updatedAt',p.updated_at,'singlePrice',p.sale_price_in_minor_units,
  'parcelPrice',p.default_sale_price_in_minor_units,'unitsPerParcel',p.units_per_sale_unit,
  'parcelEnabled',coalesce(v_state.parcel_enabled,true),'parcelOnly',p.parcel_only,
  'baseUnit',(SELECT name_ar FROM public.units WHERE id=p.unit_id),
  'parcelUnit',(SELECT name_ar FROM public.units WHERE id=p.sale_unit_id),
  'originalUnitPrice',v_state.original_unit_price,'originalUnitPriceAt',v_state.original_unit_price_at,
  'originalUnitPriceBy',v_state.original_unit_price_by,'originalParcelPrice',v_state.original_parcel_price,
  'originalParcelPriceAt',v_state.original_parcel_price_at,'originalParcelPriceBy',v_state.original_parcel_price_by,
  'currentWacInMinorUnitsExact',coalesce(p.wac_cost_in_minor_units_exact,p.cost_price_in_minor_units::NUMERIC)::TEXT,
  'belowCostConfirmation',v_required);
END;
$$;
ALTER FUNCTION public.get_product_pricing_context225(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_product_pricing_context225(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_product_pricing_context225(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,BOOLEAN) TO authenticated;

CREATE FUNCTION public.update_product_master_v7(
 p_product_id UUID,p_expected_updated_at TIMESTAMPTZ,p_sku TEXT,p_barcode TEXT,
 p_name_ar TEXT,p_description TEXT,p_category_id UUID,p_brand_id UUID,p_unit_id UUID,
 p_purchase_unit_id UUID,p_units_per_purchase_unit INTEGER,p_default_purchase_price_in_minor_units BIGINT,
 p_sale_unit_id UUID,p_units_per_sale_unit INTEGER,p_default_sale_price_in_minor_units BIGINT,
 p_cost_price_in_minor_units BIGINT,p_min_stock_level INTEGER,p_max_stock_level INTEGER,
 p_is_active BOOLEAN,p_image_url TEXT,p_sale_price_in_minor_units BIGINT,
 p_parcel_only BOOLEAN DEFAULT NULL,p_parcel_enabled BOOLEAN DEFAULT NULL,
 p_below_cost_confirmation JSONB DEFAULT NULL,p_restore_original TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.products;v_state public.product_sale_pricing_state225;v_result JSONB;
 v_single BIGINT:=p_sale_price_in_minor_units;v_parcel BIGINT:=p_default_sale_price_in_minor_units;
 v_enabled BOOLEAN;v_only BOOLEAN;v_ack JSONB;
BEGIN
 PERFORM public.price225_assert_context_internal();
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);
 SELECT * INTO p FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRICES225_PRODUCT_NOT_FOUND';END IF;
 IF p.flavor_master_product_id IS NOT NULL THEN
  RAISE EXCEPTION 'PRICES225_EDIT_FAMILY_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 PERFORM public.product_edit_assert_version_internal(p_product_id,p_expected_updated_at);
 SELECT * INTO v_state FROM public.product_sale_pricing_state225 WHERE product_id=p_product_id FOR UPDATE;
 v_enabled:=coalesce(p_parcel_enabled,v_state.parcel_enabled,true);
 v_only:=coalesce(p_parcel_only,p.parcel_only);
 IF p_restore_original IS NOT NULL THEN
  IF p_restore_original NOT IN('single','parcel','both') THEN RAISE EXCEPTION 'PRICES225_RESTORE_UNIT_INVALID';END IF;
  IF p_restore_original IN('single','both') THEN
   IF v_state.original_unit_price IS NULL THEN RAISE EXCEPTION 'PRICES225_ORIGINAL_PRICE_MISSING: لا يوجد سعر أصلي محفوظ لهذه الوحدة.';END IF;
   v_single:=v_state.original_unit_price;
  END IF;
  IF p_restore_original IN('parcel','both') THEN
   IF v_state.original_parcel_price IS NULL THEN RAISE EXCEPTION 'PRICES225_ORIGINAL_PRICE_MISSING: لا يوجد سعر أصلي محفوظ لهذا الطرد.';END IF;
   v_parcel:=v_state.original_parcel_price;
  END IF;
 END IF;
 PERFORM public.price225_assert_prices_internal(p_unit_id,coalesce(p_sale_unit_id,p_purchase_unit_id,p_unit_id),
  p_units_per_sale_unit,v_single,v_parcel,v_enabled,v_only);
 -- Reuse the current CAS, unit/history restrictions, audit and WAC-preserving
 -- writer. The second update is the reviewed222 independent-price pattern.
 v_result:=public.update_product_master_v5(p_product_id,p_expected_updated_at,p_sku,p_barcode,p_name_ar,p_description,
  p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,
  p_sale_unit_id,p_units_per_sale_unit,v_parcel,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,
  p_is_active,p_image_url,v_only);
 IF coalesce((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN RAISE EXCEPTION 'PRICES225_PRODUCT_WRITE_FAILED';END IF;
 UPDATE public.products SET sale_price_in_minor_units=v_single,wholesale_price_in_minor_units=v_single,updated_at=now()
 WHERE id=p_product_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND sale_price_in_minor_units=v_single
  AND default_sale_price_in_minor_units=v_parcel AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES225_INDEPENDENT_PRICE_READBACK_FAILED';
 END IF;
 v_ack:=public.price225_loss_confirmation_internal(p_product_id,v_single,v_parcel,p_units_per_sale_unit,v_enabled,v_only,p_below_cost_confirmation);
 PERFORM public.price225_record_state_internal(p_product_id,p.sale_price_in_minor_units,p.default_sale_price_in_minor_units,
  v_single,v_parcel,v_enabled,false,p_restore_original,v_ack);
 RETURN v_result||public.get_product_pricing_context225(p_product_id);
END;
$$;
ALTER FUNCTION public.update_product_master_v7(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,INTEGER,BIGINT,UUID,INTEGER,BIGINT,BIGINT,INTEGER,INTEGER,BOOLEAN,TEXT,BIGINT,BOOLEAN,BOOLEAN,JSONB,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product_master_v7(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,INTEGER,BIGINT,UUID,INTEGER,BIGINT,BIGINT,INTEGER,INTEGER,BOOLEAN,TEXT,BIGINT,BOOLEAN,BOOLEAN,JSONB,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_product_master_v7(UUID,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,UUID,UUID,UUID,UUID,INTEGER,BIGINT,UUID,INTEGER,BIGINT,BIGINT,INTEGER,INTEGER,BOOLEAN,TEXT,BIGINT,BOOLEAN,BOOLEAN,JSONB,TEXT) TO authenticated;


-- Creation cannot bind the acknowledgment to a random UUID that rolls back.
-- Keep the exact cost/price snapshot, replacing only new product identity with
-- its final unique SKU. A changed price, cost, flavor or SKU invalidates it.
CREATE FUNCTION public.price225_create_loss_confirmation_internal(
 p_product UUID,p_single BIGINT,p_parcel BIGINT,p_units INTEGER,p_parcel_only BOOLEAN,p_confirmation JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_expected JSONB;v_risks JSONB;
BEGIN
 BEGIN
  PERFORM public.price225_loss_confirmation_internal(p_product,p_single,p_parcel,p_units,true,p_parcel_only,NULL);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED:%' THEN RAISE;END IF;
  GET STACKED DIAGNOSTICS v_expected=PG_EXCEPTION_DETAIL;
 END;
 IF v_expected IS NULL THEN RETURN NULL;END IF;
 SELECT jsonb_agg((r.value-'productId')||jsonb_build_object('productSku',p.sku) ORDER BY p.sku)
 INTO v_risks FROM jsonb_array_elements(v_expected->'risks') r(value)
 JOIN public.products p ON p.id=(r.value->>'productId')::UUID;
 v_expected:=(v_expected-'productId')||jsonb_build_object('contractVersion','on-prices225-create-confirmation-v1',
  'productSku',(SELECT sku FROM public.products WHERE id=p_product),'risks',v_risks);
 IF p_confirmation IS DISTINCT FROM v_expected THEN
  RAISE EXCEPTION USING MESSAGE='PRICES225_BELOW_WAC_CONFIRMATION_REQUIRED: السعر أقل من التكلفة؛ راجع التحذير وأكّد قرار البيع بخسارة.',DETAIL=v_expected::TEXT;
 END IF;
 RETURN v_expected;
END;
$$;
ALTER FUNCTION public.price225_create_loss_confirmation_internal(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_create_loss_confirmation_internal(UUID,BIGINT,BIGINT,INTEGER,BOOLEAN,JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.create_product_with_opening_stock_v7(
 p_sku text,
 p_barcode text DEFAULT NULL::text,
 p_name_ar text DEFAULT NULL::text,
 p_description text DEFAULT NULL::text,
 p_category_id uuid DEFAULT NULL::uuid,
 p_brand_id uuid DEFAULT NULL::uuid,
 p_unit_id uuid DEFAULT NULL::uuid,
 p_purchase_unit_id uuid DEFAULT NULL::uuid,
 p_units_per_purchase_unit integer DEFAULT 1,
 p_default_purchase_price_in_minor_units bigint DEFAULT 0,
 p_sale_unit_id uuid DEFAULT NULL::uuid,
 p_units_per_sale_unit integer DEFAULT 1,
 p_default_sale_price_in_minor_units bigint DEFAULT 0,
 p_cost_price_in_minor_units bigint DEFAULT 0,
 p_min_stock_level integer DEFAULT 0,
 p_max_stock_level integer DEFAULT NULL::integer,
 p_warehouse_id uuid DEFAULT NULL::uuid,
 p_opening_quantity integer DEFAULT 0,
 p_notes text DEFAULT 'رصيد افتتاحي عند إضافة المنتج'::text,
 p_image_url text DEFAULT NULL::text,
 p_parcel_only boolean DEFAULT false,
 p_sale_price_in_minor_units bigint DEFAULT NULL,
 p_below_cost_confirmation JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_result JSONB;v_id UUID;v_ack JSONB;
BEGIN
 PERFORM public.price225_assert_context_internal();
 PERFORM public.price225_assert_prices_internal(p_unit_id,COALESCE(p_sale_unit_id,p_purchase_unit_id,p_unit_id),p_units_per_sale_unit,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,true,p_parcel_only);
 v_result:=public.create_product_with_opening_stock_v5(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_opening_quantity,p_notes,p_image_url,p_parcel_only);
 v_id:=COALESCE(NULLIF(v_result->>'productId',''),NULLIF(v_result->>'product_id',''))::UUID;
 IF v_id IS NULL OR COALESCE((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'PRICES225_PRODUCT_WRITE_FAILED';
 END IF;
 -- The existing family trigger copies both final prices to every flavor.
 UPDATE public.products SET sale_price_in_minor_units=p_sale_price_in_minor_units,
  wholesale_price_in_minor_units=p_sale_price_in_minor_units,updated_at=NOW() WHERE id=v_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=v_id
  AND sale_price_in_minor_units=p_sale_price_in_minor_units
  AND default_sale_price_in_minor_units=p_default_sale_price_in_minor_units
  AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES225_FAMILY_PRICE_INHERITANCE_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 v_ack:=public.price225_create_loss_confirmation_internal(v_id,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,p_units_per_sale_unit,p_parcel_only,p_below_cost_confirmation);
 PERFORM public.price225_record_state_internal(v_id,NULL,NULL,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,true,true,NULL,v_ack);
 RETURN v_result||public.get_product_pricing_context225(v_id);
END;
$$;
ALTER FUNCTION public.create_product_with_opening_stock_v7(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v7(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v7(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint,jsonb) TO authenticated;

CREATE FUNCTION public.create_product_family_with_flavors_v4(
 p_sku text,
 p_barcode text DEFAULT NULL::text,
 p_name_ar text DEFAULT NULL::text,
 p_description text DEFAULT NULL::text,
 p_category_id uuid DEFAULT NULL::uuid,
 p_brand_id uuid DEFAULT NULL::uuid,
 p_unit_id uuid DEFAULT NULL::uuid,
 p_purchase_unit_id uuid DEFAULT NULL::uuid,
 p_units_per_purchase_unit integer DEFAULT 1,
 p_default_purchase_price_in_minor_units bigint DEFAULT 0,
 p_sale_unit_id uuid DEFAULT NULL::uuid,
 p_units_per_sale_unit integer DEFAULT 1,
 p_default_sale_price_in_minor_units bigint DEFAULT 0,
 p_cost_price_in_minor_units bigint DEFAULT 0,
 p_min_stock_level integer DEFAULT 0,
 p_max_stock_level integer DEFAULT NULL::integer,
 p_warehouse_id uuid DEFAULT NULL::uuid,
 p_image_url text DEFAULT NULL::text,
 p_flavors jsonb DEFAULT '[]'::jsonb,
 p_parcel_only boolean DEFAULT false,
 p_sale_price_in_minor_units bigint DEFAULT NULL,
 p_below_cost_confirmation JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_result JSONB;v_id UUID;v_ack JSONB;
BEGIN
 PERFORM public.price225_assert_context_internal();
 PERFORM public.price225_assert_prices_internal(p_unit_id,COALESCE(p_sale_unit_id,p_purchase_unit_id,p_unit_id),p_units_per_sale_unit,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,true,p_parcel_only);
 v_result:=public.create_product_family_with_flavors_v2(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_image_url,p_flavors,p_parcel_only);
 v_id:=COALESCE(NULLIF(v_result->>'productId',''),NULLIF(v_result->>'product_id',''))::UUID;
 IF v_id IS NULL OR COALESCE((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'PRICES225_PRODUCT_WRITE_FAILED';
 END IF;
 -- The existing family trigger copies both final prices to every flavor.
 UPDATE public.products SET sale_price_in_minor_units=p_sale_price_in_minor_units,
  wholesale_price_in_minor_units=p_sale_price_in_minor_units,updated_at=NOW() WHERE id=v_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=v_id
  AND sale_price_in_minor_units=p_sale_price_in_minor_units
  AND default_sale_price_in_minor_units=p_default_sale_price_in_minor_units
  AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES225_FAMILY_PRICE_INHERITANCE_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 v_ack:=public.price225_create_loss_confirmation_internal(v_id,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,p_units_per_sale_unit,p_parcel_only,p_below_cost_confirmation);
 PERFORM public.price225_record_state_internal(v_id,NULL,NULL,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,true,true,NULL,v_ack);
 RETURN v_result||public.get_product_pricing_context225(v_id);
END;
$$;
ALTER FUNCTION public.create_product_family_with_flavors_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_family_with_flavors_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_family_with_flavors_v4(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint,jsonb) TO authenticated;

-- New commercial lines are checked at the database write boundary so older
-- public sale RPCs cannot bypass a paused parcel. Existing orders retain their
-- snapshots and may still settle, cancel or return stock.
CREATE FUNCTION public.price225_guard_new_parcel_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_product UUID; v_root UUID;
BEGIN
 IF sales_lite1.enabled() THEN RETURN NEW; END IF;
 IF NEW.commercial_line_kind IS NULL THEN
  -- The legacy customer writer sets its package snapshot in a later UPDATE.
  IF coalesce(NEW.units_per_sale_package,1)<=1 THEN RETURN NEW; END IF;
 ELSIF NEW.commercial_line_kind NOT IN ('legacy_single_sku_parcel','configurable_parcel') THEN
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.commercial_line_kind,NEW.product_id,NEW.family_product_id,NEW.units_per_sale_package)
   IS NOT DISTINCT FROM ROW(OLD.commercial_line_kind,OLD.product_id,OLD.family_product_id,OLD.units_per_sale_package) THEN
  RETURN NEW;
 END IF;
 v_product:=coalesce(NEW.family_product_id,NEW.product_id);
 -- A product update locks this root before writing pricing state. Lock it
 -- even when the sidecar is absent, then read the state in a fresh statement.
 SELECT root.id INTO STRICT v_root
 FROM public.products item
 JOIN public.products root ON root.id=coalesce(item.flavor_master_product_id,item.id)
 WHERE item.id=v_product
 FOR SHARE OF root;
 IF EXISTS(SELECT 1 FROM public.product_sale_pricing_state225 WHERE product_id=v_root AND NOT parcel_enabled) THEN
  RAISE EXCEPTION 'PRICES225_PARCEL_PAUSED: بيع الطرد متوقف مؤقتاً لهذا الصنف.';
 END IF;
 RETURN NEW;
END;
$$;
ALTER FUNCTION public.price225_guard_new_parcel_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_guard_new_parcel_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_price225_guard_new_parcel
BEFORE INSERT OR UPDATE OF commercial_line_kind,product_id,family_product_id,units_per_sale_package ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.price225_guard_new_parcel_internal();

-- Product reader, import dispatch, UI and tooling remain pending.
-- This quarantined candidate is not deployable.
COMMIT;
