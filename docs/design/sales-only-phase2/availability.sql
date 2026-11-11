-- QUARANTINED phase2. The same phase1 manual flags and optimistic revision.
-- No synthetic stock amount, cost read, legacy writer or ACL change.
CREATE FUNCTION public.lite1_product_availability2(p_product_ids UUID[]) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE products JSONB;full_mode BOOLEAN;
BEGIN
 PERFORM sales_lite1.owner();
 IF p_product_ids IS NULL OR cardinality(p_product_ids) NOT BETWEEN 1 AND 200
 OR EXISTS(SELECT 1 FROM unnest(p_product_ids) x WHERE x IS NULL)
 OR(SELECT count(DISTINCT x) FROM unnest(p_product_ids) x)<>cardinality(p_product_ids)
 THEN RAISE EXCEPTION 'LITE2_AVAILABILITY_IDS_INVALID';END IF;
 SELECT full_accounting INTO STRICT full_mode FROM sales_lite1.mode WHERE id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',p.id,'available',COALESCE(a.available,true),'revision',COALESCE(a.revision,0),
  'effectiveAvailable',sales_lite1.available(p.id),'active',p.is_active,'flavorMasterProductId',p.flavor_master_product_id,
  'parentAvailable',COALESCE(parent.is_active,true) AND COALESCE(parent_flag.available,true)) ORDER BY p.id),'[]') INTO products
 FROM public.products p LEFT JOIN sales_lite1.availability a ON a.product_id=p.id
 LEFT JOIN public.products parent ON parent.id=p.flavor_master_product_id
 LEFT JOIN sales_lite1.availability parent_flag ON parent_flag.product_id=parent.id WHERE p.id=ANY(p_product_ids);
 IF jsonb_array_length(products)<>cardinality(p_product_ids) THEN RAISE EXCEPTION 'LITE2_AVAILABILITY_PRODUCT_CHANGED';END IF;
 RETURN jsonb_build_object('contractVersion','sales-only-availability2-v1','fullAccounting',full_mode,'products',products);
END $$;
REVOKE ALL ON FUNCTION public.lite1_product_availability2(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_product_availability2(UUID[]) TO authenticated;

CREATE FUNCTION public.lite1_set_available2(p_product UUID,p_available BOOLEAN,p_revision INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM sales_lite1.owner();PERFORM sales_lite1.lock_mode();
 IF NOT sales_lite1.enabled() THEN RAISE EXCEPTION 'LITE1_MODE_DISABLED';END IF;
 RETURN public.lite1_set_available(p_product,p_available,p_revision);
END $$;
REVOKE ALL ON FUNCTION public.lite1_set_available2(UUID,BOOLEAN,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_set_available2(UUID,BOOLEAN,INTEGER) TO authenticated;
