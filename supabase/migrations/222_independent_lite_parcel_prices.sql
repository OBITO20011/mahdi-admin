-- Owner14Nov2026: independent OFF prices. 221 remains reserved for accounting.
-- Additive writers only; historical 209/220, sales, tables and ON remain unchanged.
BEGIN;
DO $history222$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>181
 OR (SELECT max(version::integer) FROM supabase_migrations.schema_migrations)<>220 THEN
  RAISE EXCEPTION 'PRICES222_EXACT220_HISTORY_REQUIRED';
 END IF;
END $history222$;

CREATE FUNCTION sales_lite1.assert_prices222(
 p_unit_id UUID,p_sale_unit_id UUID,p_units INTEGER,p_single BIGINT,p_parcel BIGINT,p_parcel_only BOOLEAN
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'حفظ أسعار المنتج');
 PERFORM sales_lite1.lock_mode();
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'PRICES222_OFF_REQUIRED: أسعار الطرد المستقلة متاحة في وضع البيع بلا محاسبة فقط.';END IF;
 IF p_unit_id IS NULL OR p_sale_unit_id IS NULL OR p_units IS NULL OR p_units<1 THEN
  RAISE EXCEPTION 'PRICES222_UNIT_REQUIRED: اختر الوحدة وعدد وحدات الطرد الصحيح.';
 END IF;
 IF p_single IS NULL OR p_parcel IS NULL OR p_single<=0 OR p_parcel<=0 THEN
  RAISE EXCEPTION 'PRICES222_POSITIVE_PRICE_REQUIRED: يجب أن يكون السعر أكبر من صفر.';
 END IF;
 IF p_units=1 THEN
  IF p_single<>p_parcel OR COALESCE(p_parcel_only,false) THEN
   RAISE EXCEPTION 'PRICES222_SINGLE_PRICE_MISMATCH: البيع المفرد له سعر واحد ولا يُباع كطرد متعدد.';
  END IF;
 ELSE
  IF p_unit_id=p_sale_unit_id THEN
   RAISE EXCEPTION 'PRICES222_DISTINCT_PARCEL_UNIT_REQUIRED: اختر للطرد وحدة تختلف عن وحدة المحتوى.';
  END IF;
  IF p_parcel=p_single THEN
   RAISE EXCEPTION 'PRICES222_UNSAFE_PARCEL_PRICE: لا يمكن بيع عدة وحدات بسعر وحدة واحدة.';
  END IF;
  IF p_parcel::NUMERIC>p_units::NUMERIC*p_single::NUMERIC THEN
   RAISE EXCEPTION 'PRICES222_PARCEL_PRICE_TOO_HIGH: سعر الطرد لا يتجاوز العدد مضروباً في سعر الوحدة.';
  END IF;
 END IF;
END;
$$;
ALTER FUNCTION sales_lite1.assert_prices222(UUID,UUID,INTEGER,BIGINT,BIGINT,BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION sales_lite1.assert_prices222(UUID,UUID,INTEGER,BIGINT,BIGINT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.update_product_master_v6(
 p_product_id uuid,
 p_expected_updated_at timestamp with time zone,
 p_sku text,
 p_barcode text,
 p_name_ar text,
 p_description text,
 p_category_id uuid,
 p_brand_id uuid,
 p_unit_id uuid,
 p_purchase_unit_id uuid,
 p_units_per_purchase_unit integer,
 p_default_purchase_price_in_minor_units bigint,
 p_sale_unit_id uuid,
 p_units_per_sale_unit integer,
 p_default_sale_price_in_minor_units bigint,
 p_cost_price_in_minor_units bigint,
 p_min_stock_level integer,
 p_max_stock_level integer,
 p_is_active boolean,
 p_image_url text,
 p_sale_price_in_minor_units bigint,
 p_parcel_only boolean DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_id UUID;v_before JSONB;
BEGIN
 PERFORM sales_lite1.assert_prices222(p_unit_id,COALESCE(p_sale_unit_id,p_purchase_unit_id,p_unit_id),p_units_per_sale_unit,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,p_parcel_only);
 -- Keep the existing family/row locks outside the exception subtransaction.
 PERFORM public.phase2_lock_inventory_products_internal(ARRAY[p_product_id]);
 PERFORM 1 FROM public.products WHERE id=p_product_id FOR UPDATE;
 BEGIN
  PERFORM public.product_edit_assert_version_internal(p_product_id,p_expected_updated_at);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'PRODUCT_EDIT_CONFLICT:%' THEN
   RAISE EXCEPTION USING MESSAGE=SQLERRM,
    DETAIL=(public.product_edit_snapshot_internal(p_product_id)||jsonb_build_object('salePriceInMinorUnits',(SELECT sale_price_in_minor_units FROM public.products WHERE id=p_product_id)))::TEXT,
    HINT='اعرض القيم الحالية ثم أعد تطبيق تعديلاتك.';
  END IF;
  RAISE;
 END;
 SELECT jsonb_build_object('singlePrice',sale_price_in_minor_units,'parcelPrice',default_sale_price_in_minor_units,'unitsPerParcel',units_per_sale_unit) INTO v_before FROM public.products WHERE id=p_product_id;
 v_result:=public.update_product_master_v5(p_product_id,p_expected_updated_at,p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_is_active,p_image_url,p_parcel_only);
 v_id:=p_product_id;
 IF v_id IS NULL OR COALESCE((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'PRICES222_PRODUCT_WRITE_FAILED';
 END IF;
 -- The existing family trigger copies both final prices to every flavor.
 UPDATE public.products SET sale_price_in_minor_units=p_sale_price_in_minor_units,
  wholesale_price_in_minor_units=p_sale_price_in_minor_units,updated_at=NOW() WHERE id=v_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=v_id
  AND sale_price_in_minor_units=p_sale_price_in_minor_units
  AND default_sale_price_in_minor_units=p_default_sale_price_in_minor_units
  AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES222_FAMILY_PRICE_INHERITANCE_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(auth.uid(),'SET_PRODUCT_INDEPENDENT_PRICES','products',v_id,
  jsonb_build_object('writer','update_product_master_v6','before',v_before,'singlePrice',p_sale_price_in_minor_units,
   'parcelPrice',p_default_sale_price_in_minor_units,'unitsPerParcel',p_units_per_sale_unit));
 RETURN v_result||jsonb_build_object('salePriceInMinorUnits',p_sale_price_in_minor_units,
  'defaultSalePriceInMinorUnits',p_default_sale_price_in_minor_units,'updatedAt',(SELECT updated_at FROM public.products WHERE id=v_id));
END;
$$;
ALTER FUNCTION public.update_product_master_v6(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,bigint,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_product_master_v6(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_product_master_v6(uuid,timestamp with time zone,text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,boolean,text,bigint,boolean) TO authenticated;

CREATE FUNCTION public.create_product_with_opening_stock_v6(
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
 p_sale_price_in_minor_units bigint DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_id UUID;v_before JSONB;
BEGIN
 PERFORM sales_lite1.assert_prices222(p_unit_id,COALESCE(p_sale_unit_id,p_purchase_unit_id,p_unit_id),p_units_per_sale_unit,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,p_parcel_only);
 v_result:=public.create_product_with_opening_stock_v5(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_opening_quantity,p_notes,p_image_url,p_parcel_only);
 v_id:=COALESCE(NULLIF(v_result->>'productId',''),NULLIF(v_result->>'product_id',''))::UUID;
 IF v_id IS NULL OR COALESCE((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'PRICES222_PRODUCT_WRITE_FAILED';
 END IF;
 -- The existing family trigger copies both final prices to every flavor.
 UPDATE public.products SET sale_price_in_minor_units=p_sale_price_in_minor_units,
  wholesale_price_in_minor_units=p_sale_price_in_minor_units,updated_at=NOW() WHERE id=v_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=v_id
  AND sale_price_in_minor_units=p_sale_price_in_minor_units
  AND default_sale_price_in_minor_units=p_default_sale_price_in_minor_units
  AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES222_FAMILY_PRICE_INHERITANCE_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(auth.uid(),'SET_PRODUCT_INDEPENDENT_PRICES','products',v_id,
  jsonb_build_object('writer','create_product_with_opening_stock_v6','before',v_before,'singlePrice',p_sale_price_in_minor_units,
   'parcelPrice',p_default_sale_price_in_minor_units,'unitsPerParcel',p_units_per_sale_unit));
 RETURN v_result||jsonb_build_object('salePriceInMinorUnits',p_sale_price_in_minor_units,
  'defaultSalePriceInMinorUnits',p_default_sale_price_in_minor_units,'updatedAt',(SELECT updated_at FROM public.products WHERE id=v_id));
END;
$$;
ALTER FUNCTION public.create_product_with_opening_stock_v6(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_with_opening_stock_v6(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock_v6(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,integer,text,text,boolean,bigint) TO authenticated;

CREATE FUNCTION public.create_product_family_with_flavors_v3(
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
 p_sale_price_in_minor_units bigint DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result JSONB;v_id UUID;v_before JSONB;
BEGIN
 PERFORM sales_lite1.assert_prices222(p_unit_id,COALESCE(p_sale_unit_id,p_purchase_unit_id,p_unit_id),p_units_per_sale_unit,p_sale_price_in_minor_units,p_default_sale_price_in_minor_units,p_parcel_only);
 v_result:=public.create_product_family_with_flavors_v2(p_sku,p_barcode,p_name_ar,p_description,p_category_id,p_brand_id,p_unit_id,p_purchase_unit_id,p_units_per_purchase_unit,p_default_purchase_price_in_minor_units,p_sale_unit_id,p_units_per_sale_unit,p_default_sale_price_in_minor_units,p_cost_price_in_minor_units,p_min_stock_level,p_max_stock_level,p_warehouse_id,p_image_url,p_flavors,p_parcel_only);
 v_id:=COALESCE(NULLIF(v_result->>'productId',''),NULLIF(v_result->>'product_id',''))::UUID;
 IF v_id IS NULL OR COALESCE((v_result->>'success')::BOOLEAN,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'PRICES222_PRODUCT_WRITE_FAILED';
 END IF;
 -- The existing family trigger copies both final prices to every flavor.
 UPDATE public.products SET sale_price_in_minor_units=p_sale_price_in_minor_units,
  wholesale_price_in_minor_units=p_sale_price_in_minor_units,updated_at=NOW() WHERE id=v_id;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=v_id
  AND sale_price_in_minor_units=p_sale_price_in_minor_units
  AND default_sale_price_in_minor_units=p_default_sale_price_in_minor_units
  AND units_per_sale_unit=p_units_per_sale_unit) THEN
  RAISE EXCEPTION 'PRICES222_FAMILY_PRICE_INHERITANCE_REQUIRED: عدّل سعر العائلة؛ النكهات ترث السعرين منها.';
 END IF;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(auth.uid(),'SET_PRODUCT_INDEPENDENT_PRICES','products',v_id,
  jsonb_build_object('writer','create_product_family_with_flavors_v3','before',v_before,'singlePrice',p_sale_price_in_minor_units,
   'parcelPrice',p_default_sale_price_in_minor_units,'unitsPerParcel',p_units_per_sale_unit));
 RETURN v_result||jsonb_build_object('salePriceInMinorUnits',p_sale_price_in_minor_units,
  'defaultSalePriceInMinorUnits',p_default_sale_price_in_minor_units,'updatedAt',(SELECT updated_at FROM public.products WHERE id=v_id));
END;
$$;
ALTER FUNCTION public.create_product_family_with_flavors_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_product_family_with_flavors_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_product_family_with_flavors_v3(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,uuid,integer,bigint,bigint,integer,integer,uuid,text,jsonb,boolean,bigint) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
