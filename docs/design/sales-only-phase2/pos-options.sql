-- QUARANTINED parallel owner reader. Configuration and prices stay authoritative;
-- no inventory/cost predicate or invented stock capacity in sales-only mode.
CREATE FUNCTION public.lite1_pos_options2(p_warehouse_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE options JSONB;state TEXT:=public.get_configurable_parcel_feature_state();
BEGIN
 PERFORM sales_lite1.owner();
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id
  WHERE w.id=p_warehouse_id AND w.is_active AND b.is_active) THEN RAISE EXCEPTION 'PHASE3_POS_LOCATION_INVALID';END IF;
 IF state='OFF' THEN RETURN jsonb_build_object('featureState',state,'options','[]'::JSONB);END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('familyProductId',f.id,'nameAr',f.name_ar,
  'parcelConfigurationId',c.id,'configurationRevision',c.configuration_revision,
  'unitsPerParcel',f.units_per_sale_unit,'parcelPriceInMinorUnits',f.default_sale_price_in_minor_units,
  'quantityTracked',false,'components',components.value) ORDER BY f.name_ar,f.id),'[]'::JSONB) INTO options
 FROM public.product_parcel_configurations c JOIN public.products f ON f.id=c.family_product_id
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('productId',p.id,'nameAr',p.name_ar,
  'flavorNameAr',p.flavor_name_ar,'sku',p.sku,'manualAvailable',sales_lite1.available(p.id)) ORDER BY p.name_ar,p.id) value
  FROM public.product_parcel_allowed_components a JOIN public.products p ON p.id=a.product_id
  AND p.is_active AND p.flavor_master_product_id=f.id AND NOT p.is_flavor_master WHERE a.configuration_id=c.id) components
 WHERE c.is_active AND c.composition_mode='configurable_mix' AND f.is_active AND f.is_flavor_master
  AND f.units_per_sale_unit>0 AND f.default_sale_price_in_minor_units>0 AND components.value IS NOT NULL;
 RETURN jsonb_build_object('featureState',state,'options',options);
END $$;
REVOKE ALL ON FUNCTION public.lite1_pos_options2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_pos_options2(UUID) TO authenticated;
