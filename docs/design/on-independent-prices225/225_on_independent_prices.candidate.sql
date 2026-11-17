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
 IF p_product_id IS NULL THEN
  RETURN jsonb_build_object('contractVersion','on-independent-prices225-v1','mode','full');
 END IF;
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
 -- An identity-only edit does not make a new price decision. All changed
 -- commercial inputs and explicit restores still require the current WAC.
 IF p_restore_original IS NOT NULL OR
    (v_single,v_parcel,p_units_per_sale_unit,v_enabled,v_only,p_unit_id,coalesce(p_sale_unit_id,p_purchase_unit_id,p_unit_id))
    IS DISTINCT FROM (p.sale_price_in_minor_units,p.default_sale_price_in_minor_units,p.units_per_sale_unit,
      coalesce(v_state.parcel_enabled,true),p.parcel_only,p.unit_id,p.sale_unit_id) THEN
  v_ack:=public.price225_loss_confirmation_internal(p_product_id,v_single,v_parcel,p_units_per_sale_unit,v_enabled,v_only,p_below_cost_confirmation);
 END IF;
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

-- Derived from the frozen 209 page RPC. Preserve its search, page contract,
-- role boundary and public projection, with availability evaluated BEFORE page
-- selection so in-stock singles remain discoverable through filtered pages.
CREATE FUNCTION public.public_storefront_catalog_page225(p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_availability text DEFAULT 'all'::text, p_sort text DEFAULT 'recommended'::text, p_brand_id uuid DEFAULT NULL::uuid, p_sale_unit_id uuid DEFAULT NULL::uuid, p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 IF sales_lite1.enabled() THEN
  RETURN public.lite1_catalog_page2(p_limit,p_offset,p_category_id,p_search,p_availability,p_sort,p_brand_id,p_sale_unit_id,p_product_ids);
 END IF;
 RETURN (WITH stock_by_product AS (
    SELECT
      ib.product_id,
      COALESCE(SUM(GREATEST(ib.on_hand_quantity - ib.reserved_quantity, 0)), 0)::INTEGER
        AS available_quantity
    FROM public.inventory_balances ib
    GROUP BY ib.product_id
  ),
  sales_by_product AS (
    SELECT
      oi.product_id,
      COALESCE(SUM(COALESCE(oi.sale_package_quantity, 0)), 0)::BIGINT
        AS sold_packages
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'completed'
      AND o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY oi.product_id
  ),
  catalog_source AS (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name_ar,
      p.description,
      p.category_id,
      c.code AS category_code,
      c.name_ar AS category_name_ar,
      p.brand_id,
      b.name_ar AS brand_name_ar,
      p.unit_id,
      base_unit.name_ar AS unit_name_ar,
      p.sale_unit_id,
      sale_unit.name_ar AS sale_unit_name_ar,
      p.units_per_sale_unit,
      p.parcel_only,
      COALESCE(pricing.parcel_enabled,true) AS parcel_sale_enabled,
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      COALESCE(stock.available_quantity, 0)::INTEGER AS available_quantity,
      image.image_url,
      p.created_at,
      COALESCE(sales.sold_packages, 0)::BIGINT AS sold_packages_last_90_days,
      p.flavor_master_product_id,
      p.flavor_name_ar,
      p.is_flavor_master,
      p.flavor_sort_order,
      COALESCE(p.flavor_master_product_id, p.id) AS family_id
    FROM public.products p
    JOIN public.categories c ON c.id = p.category_id AND c.is_active = true
    LEFT JOIN public.brands b ON b.id = p.brand_id
    JOIN public.units base_unit ON base_unit.id = p.unit_id
    JOIN public.units sale_unit ON sale_unit.id = p.sale_unit_id
    LEFT JOIN stock_by_product stock ON stock.product_id = p.id
    LEFT JOIN public.product_sale_pricing_state225 pricing ON pricing.product_id=coalesce(p.flavor_master_product_id,p.id)
    LEFT JOIN sales_by_product sales ON sales.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT pi.image_url
      FROM public.product_images pi
      WHERE pi.product_id = p.id
      ORDER BY pi.is_primary DESC, pi.display_order, pi.created_at
      LIMIT 1
    ) image ON true
    WHERE p.is_active = true
      AND sale_unit.code <> 'PCS'
      AND p.units_per_sale_unit > 0
      AND p.default_sale_price_in_minor_units > 0
  ),
  method_availability AS (
    SELECT catalog_source.*,
      NOT is_flavor_master AND NOT parcel_only AND sale_price_in_minor_units>0
        AND available_quantity>0 AS single_available,
      NOT is_flavor_master AND parcel_sale_enabled
        AND available_quantity>=units_per_sale_unit AS parcel_available,
      CASE WHEN parcel_sale_enabled THEN floor(available_quantity::numeric/units_per_sale_unit)
        ELSE 0 END::integer AS sale_packages
    FROM catalog_source
  ),
  family_summary AS (
    SELECT
      family_id,
      MIN(category_id::TEXT)::UUID AS category_id,
      MIN(category_code) AS category_code,
      MIN(brand_id::TEXT)::UUID AS brand_id,
      MIN(sale_unit_id::TEXT)::UUID AS sale_unit_id,
      COALESCE(
        MIN(name_ar) FILTER (WHERE flavor_master_product_id IS NULL),
        MIN(name_ar)
      ) AS family_name_ar,
      MIN(default_sale_price_in_minor_units) AS sale_price_in_minor_units,
      COALESCE(SUM(sale_packages) FILTER (WHERE NOT is_flavor_master),0)::integer AS available_sale_packages,
      BOOL_OR(single_available OR parcel_available) AS is_available,
      BOOL_OR((single_available OR parcel_available) AND sale_packages<=5) AS is_low_stock,
      MAX(created_at) AS created_at,
      COALESCE(SUM(sold_packages_last_90_days) FILTER (WHERE NOT is_flavor_master), 0)::BIGINT
        AS sold_packages_last_90_days
    FROM method_availability
    GROUP BY family_id
  ),
  normalized_search AS (
    SELECT LOWER(TRANSLATE(
      REGEXP_REPLACE(COALESCE(NULLIF(BTRIM(p_search), ''), ''), '[ً-ٰٟـ]', '', 'g'),
      'أإآى',
      'اااي'
    )) AS value
  ),
  matching_families AS (
    SELECT fs.*
    FROM family_summary fs
    CROSS JOIN normalized_search normalized
    WHERE (p_category_id IS NULL OR fs.category_id = p_category_id)
      AND (p_brand_id IS NULL OR fs.brand_id = p_brand_id)
      AND (p_sale_unit_id IS NULL OR fs.sale_unit_id = p_sale_unit_id)
      AND (
        p_product_ids IS NULL
        OR fs.family_id = ANY (p_product_ids)
        OR EXISTS (
          SELECT 1
          FROM catalog_source favorite_member
          WHERE favorite_member.family_id = fs.family_id
            AND favorite_member.id = ANY (p_product_ids)
        )
      )
      AND (
        p_availability NOT IN ('available', 'low_stock')
        OR (p_availability = 'available' AND fs.is_available)
        OR (p_availability = 'low_stock' AND fs.is_low_stock)
      )
      AND (p_sort <> 'offers' OR fs.category_code = 'CAT-OFFERS')
      AND (p_sort <> 'low_stock' OR fs.is_low_stock)
      AND (
        normalized.value = ''
        OR EXISTS (
          SELECT 1
          FROM catalog_source searched_member
          WHERE searched_member.family_id = fs.family_id
            AND (
              LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.name_ar, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(searched_member.sku, '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.barcode, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.description, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
              OR LOWER(TRANSLATE(REGEXP_REPLACE(COALESCE(searched_member.brand_name_ar, ''), '[ً-ٰٟـ]', '', 'g'), 'أإآى', 'اااي')) LIKE '%' || normalized.value || '%'
            )
        )
      )
  ),
  paged_families AS (
    SELECT
      mf.*,
      ROW_NUMBER() OVER (
        ORDER BY
          mf.is_available DESC,
          CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
          CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
          CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
          CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
          CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
          CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
          CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
          mf.family_name_ar ASC,
          mf.family_id ASC
      ) AS page_order
    FROM matching_families mf
    ORDER BY
      mf.is_available DESC,
      CASE WHEN p_sort = 'name_asc' THEN mf.family_name_ar END ASC,
      CASE WHEN p_sort = 'price_asc' THEN mf.sale_price_in_minor_units END ASC,
      CASE WHEN p_sort = 'price_desc' THEN mf.sale_price_in_minor_units END DESC,
      CASE WHEN p_sort = 'stock_desc' THEN mf.available_sale_packages END DESC,
      CASE WHEN p_sort = 'newest' THEN mf.created_at END DESC,
      CASE WHEN p_sort = 'best_sellers' THEN mf.sold_packages_last_90_days END DESC,
      CASE WHEN p_sort = 'low_stock' THEN mf.available_sale_packages END ASC,
      mf.family_name_ar ASC,
      mf.family_id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  page_items AS (
    SELECT
      pf.page_order,
      cs.*
    FROM paged_families pf
    JOIN method_availability cs ON cs.family_id = pf.family_id
  ),
  category_summary AS (
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.image_url,
      COUNT(fs.family_id)::INTEGER AS product_count,
      COUNT(fs.family_id) FILTER (WHERE fs.is_available)::INTEGER AS available_product_count,
      CASE c.code
        WHEN 'CAT-BEV' THEN 10 WHEN 'CAT-WATER' THEN 20
        WHEN 'CAT-ENERGY' THEN 30 WHEN 'CAT-BISCUIT' THEN 40
        WHEN 'CAT-CAKE' THEN 50 WHEN 'CAT-CHOCO' THEN 60
        WHEN 'CAT-CANDY' THEN 70 WHEN 'CAT-GUM' THEN 80
        WHEN 'CAT-CHIPS' THEN 90 WHEN 'CAT-FOOD' THEN 100
        WHEN 'CAT-GIFTS' THEN 110 WHEN 'CAT-OFFERS' THEN 120
        ELSE 1000
      END AS sort_order
    FROM public.categories c
    LEFT JOIN family_summary fs ON fs.category_id = c.id
    WHERE c.is_active = true
    GROUP BY c.id, c.code, c.name_ar, c.image_url
  ),
  brand_facets AS (
    SELECT fs.brand_id AS id, MIN(cs.brand_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.brand_id IS NOT NULL
    GROUP BY fs.brand_id
  ),
  sale_unit_facets AS (
    SELECT fs.sale_unit_id AS id, MIN(cs.sale_unit_name_ar) AS name_ar
    FROM family_summary fs
    JOIN catalog_source cs ON cs.family_id = fs.family_id
    WHERE fs.sale_unit_id IS NOT NULL
    GROUP BY fs.sale_unit_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'sku', sku,
          'barcode', barcode,
          'nameAr', name_ar,
          'description', description,
          'categoryId', category_id,
          'categoryCode', category_code,
          'categoryNameAr', category_name_ar,
          'brandId', brand_id,
          'brandNameAr', brand_name_ar,
          'unitId', unit_id,
          'unitNameAr', unit_name_ar,
          'saleUnitId', sale_unit_id,
          'saleUnitNameAr', sale_unit_name_ar,
          'unitsPerSalePackage', units_per_sale_unit,
          'parcelOnly', parcel_only,
          'salePackagePriceInMinorUnits', default_sale_price_in_minor_units,
          'salePriceInMinorUnits', sale_price_in_minor_units,
          'availableQuantity', available_quantity,
          'availableSalePackages', sale_packages,
          'parcelSaleEnabled', parcel_sale_enabled,
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', single_available OR parcel_available,
          'createdAt', created_at,
          'soldPackagesLast90Days', sold_packages_last_90_days,
          'flavorMasterProductId', flavor_master_product_id,
          'flavorNameAr', flavor_name_ar,
          'isFlavorMaster', is_flavor_master,
          'flavorSortOrder', flavor_sort_order
        )
        ORDER BY page_order,
          CASE WHEN flavor_master_product_id IS NULL THEN 0 ELSE 1 END,
          flavor_sort_order,
          name_ar,
          id
      )
      FROM page_items
    ), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'nameAr', name_ar, 'imageUrl', image_url,
        'productCount', product_count, 'availableProductCount', available_product_count
      ) ORDER BY sort_order, name_ar, id)
      FROM category_summary
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM brand_facets
    ), '[]'::jsonb),
    'saleUnits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nameAr', name_ar) ORDER BY name_ar, id)
      FROM sale_unit_facets
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'availableProducts', (SELECT COUNT(*) FROM matching_families WHERE is_available),
      'availableSalePackages', (SELECT COALESCE(SUM(available_sale_packages), 0) FROM matching_families),
      'lowStockProducts', (SELECT COUNT(*) FROM matching_families WHERE is_low_stock)
    ),
    'total', (SELECT COUNT(*) FROM matching_families),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  ));
END;
$function$;
ALTER FUNCTION public.public_storefront_catalog_page225(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_storefront_catalog_page225(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.public_storefront_catalog_page225(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) TO anon,authenticated;

-- Existing readers keep their current role, feature, eligibility and stock
-- checks. A separate ON layer filters known paused families after those checks.
CREATE FUNCTION public.price225_filter_parcel_options_internal(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_payload || jsonb_build_object('options',COALESCE((
  SELECT jsonb_agg(option.value ORDER BY option.position)
  FROM jsonb_array_elements(p_payload->'options') WITH ORDINALITY AS option(value,position)
  LEFT JOIN public.product_sale_pricing_state225 state ON state.product_id=(option.value->>'familyProductId')::UUID
  WHERE state.parcel_enabled IS DISTINCT FROM false
 ),'[]'::JSONB));
$$;
ALTER FUNCTION public.price225_filter_parcel_options_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.price225_filter_parcel_options_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_public_parcel_options225(p_family_product_ids UUID[])
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN sales_lite1.enabled() THEN public.lite1_parcel_options2(p_family_product_ids)
 ELSE public.price225_filter_parcel_options_internal(public.get_public_configurable_parcel_options(p_family_product_ids)) END;
$$;
ALTER FUNCTION public.get_public_parcel_options225(UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_parcel_options225(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_public_parcel_options225(UUID[]) TO anon,authenticated;

CREATE FUNCTION public.get_pos_parcel_options225(p_warehouse_id UUID)
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN sales_lite1.enabled() THEN public.lite1_pos_options2(p_warehouse_id)
 ELSE public.price225_filter_parcel_options_internal(public.get_pos_configurable_parcel_options_v1(p_warehouse_id)) END;
$$;
ALTER FUNCTION public.get_pos_parcel_options225(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_pos_parcel_options225(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_parcel_options225(UUID) TO authenticated;

CREATE FUNCTION public.search_pos_products225(p_search TEXT,p_limit INTEGER,p_category_id UUID,p_product_id UUID,p_purpose TEXT DEFAULT 'sellable')
RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(jsonb_agg(CASE WHEN sales_lite1.enabled() THEN row.value
   ELSE row.value || jsonb_build_object('parcel_sale_enabled',COALESCE(state.parcel_enabled,true)) END ORDER BY row.position),'[]'::JSONB)
 FROM jsonb_array_elements(public.search_admin_products(p_search,p_limit,p_category_id,p_purpose,p_product_id))
   WITH ORDINALITY AS row(value,position)
 JOIN public.products product ON product.id=(row.value->>'id')::UUID
 LEFT JOIN public.product_sale_pricing_state225 state ON state.product_id=COALESCE(product.flavor_master_product_id,product.id);
$$;
ALTER FUNCTION public.search_pos_products225(TEXT,INTEGER,UUID,UUID,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_pos_products225(TEXT,INTEGER,UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.search_pos_products225(TEXT,INTEGER,UUID,UUID,TEXT) TO authenticated;

-- Import dispatch, broader UI and tooling remain pending.
-- This quarantined candidate is not deployable.
COMMIT;
