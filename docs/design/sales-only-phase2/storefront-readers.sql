-- QUARANTINED parallel public reads. Full mode delegates byte-identical originals.
CREATE FUNCTION public.lite1_catalog_page2(p_limit integer DEFAULT 24,p_offset integer DEFAULT 0,p_category_id uuid DEFAULT NULL,p_search text DEFAULT NULL,p_availability text DEFAULT 'all',p_sort text DEFAULT 'recommended',p_brand_id uuid DEFAULT NULL,p_sale_unit_id uuid DEFAULT NULL,p_product_ids uuid[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN
  RETURN public.get_public_storefront_catalog_page(p_limit,p_offset,p_category_id,p_search,p_availability,p_sort,p_brand_id,p_sale_unit_id,p_product_ids);
 END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 IF length(COALESCE(p_search,''))>500 OR cardinality(p_product_ids)>48 OR array_position(p_product_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'LITE2_CATALOG_INPUT_INVALID';END IF;
 RETURN sales_lite2.catalog_page(p_limit,p_offset,p_category_id,p_search,p_availability,p_sort,p_brand_id,p_sale_unit_id,p_product_ids)
  ||jsonb_build_object('contractVersion','lite2-catalog-v1','quantityTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_catalog_page2(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_catalog_page2(integer,integer,uuid,text,text,text,uuid,uuid,uuid[]) TO anon,authenticated;

CREATE FUNCTION public.lite1_parcel_options2(p_family_product_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RETURN public.get_public_configurable_parcel_options(p_family_product_ids);END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN sales_lite2.parcel_options(p_family_product_ids)||jsonb_build_object('contractVersion','lite2-parcel-options-v1','quantityTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_parcel_options2(UUID[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_parcel_options2(UUID[]) TO anon,authenticated;

CREATE FUNCTION public.lite1_merchandising2()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) THEN RETURN public.get_public_storefront_merchandising();END IF;
 IF (SELECT full_accounting FROM sales_lite1.mode WHERE id) IS DISTINCT FROM false THEN RAISE EXCEPTION 'LITE2_MODE_MISSING';END IF;
 RETURN jsonb_build_object('contractVersion','lite2-merchandising-v1','quantityTracked',false,
  'newest',public.lite1_catalog_page2(6,0,NULL,NULL,'all','newest')->'items',
  'bestSellers',public.lite1_catalog_page2(6,0,NULL,NULL,'all','best_sellers')->'items',
  'offers',public.lite1_catalog_page2(6,0,NULL,NULL,'all','offers')->'items','lowStock','[]'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_merchandising2() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_merchandising2() TO anon,authenticated;
