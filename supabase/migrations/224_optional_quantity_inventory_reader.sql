-- Owner-only inventory screen for optional OFF counters. 221 stays reserved.
-- Additive reader only: no existing function, table, trigger or writer changes.
BEGIN;
DO $history224$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>183
 OR (SELECT max(version::INTEGER) FROM supabase_migrations.schema_migrations)<>223
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='221') THEN
  RAISE EXCEPTION 'INVENTORY224_EXACT223_REQUIRED';
 END IF;
END $history224$;

CREATE FUNCTION public.lite3_counters224(
 p_search TEXT DEFAULT '',p_filter TEXT DEFAULT 'all',p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 20
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE needle TEXT;result JSONB;
BEGIN
 PERFORM sales_lite3.assert_owner223();
 IF p_search IS NOT NULL AND char_length(p_search)>256 THEN RAISE EXCEPTION 'INVENTORY224_SEARCH_INVALID';END IF;
 IF p_filter IS NULL OR p_filter NOT IN('all','low','zero') THEN RAISE EXCEPTION 'INVENTORY224_FILTER_INVALID';END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'INVENTORY224_PAGE_INVALID';
 END IF;
 needle:=btrim(regexp_replace(translate(lower(normalize(COALESCE(p_search,''),NFKC)),
  '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]]+',' ','g'));
 WITH tracked AS MATERIALIZED(
  SELECT p.id,p.name_ar,p.flavor_name_ar,p.flavor_master_product_id,parent.name_ar AS family_name,
   p.sku,p.barcode,c.unit_id,COALESCE(u.name_ar,'باكيت') AS unit_name,c.quantity,c.low_threshold,c.revision,c.updated_at,
   CASE WHEN c.quantity=0 THEN 0 WHEN c.quantity<c.low_threshold THEN 1 ELSE 2 END AS priority,
   btrim(regexp_replace(translate(lower(normalize(concat_ws(' ',p.name_ar,p.flavor_name_ar,parent.name_ar,p.sku,p.barcode),NFKC)),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[[:space:]]+',' ','g')) AS search_text
  FROM sales_lite3.quantity_counters c JOIN public.products p ON p.id=c.product_id
  LEFT JOIN public.products parent ON parent.id=p.flavor_master_product_id
  LEFT JOIN public.units u ON u.id=c.unit_id
  WHERE c.enabled AND p.is_active AND NOT p.is_flavor_master
   AND NOT EXISTS(SELECT 1 FROM public.products child WHERE child.flavor_master_product_id=p.id)
 ),filtered AS MATERIALIZED(
  SELECT * FROM tracked WHERE(needle='' OR strpos(search_text,needle)>0)
   AND(p_filter='all' OR(p_filter='low' AND priority IN(0,1)) OR(p_filter='zero' AND priority=0))
 ),page_rows AS MATERIALIZED(
  SELECT * FROM filtered ORDER BY priority,name_ar,flavor_name_ar,sku,id
  LIMIT p_page_size OFFSET(p_page-1)::BIGINT*p_page_size
 )
 SELECT jsonb_build_object('contractVersion','inventory224-v1','fullAccounting',false,
  'counts',(SELECT jsonb_build_object('tracked',count(*),'low',count(*) FILTER(WHERE priority IN(0,1)),
   'zero',count(*) FILTER(WHERE priority=0)) FROM tracked),
  'total',(SELECT count(*) FROM filtered),'page',p_page,'pageSize',p_page_size,
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'productId',r.id,'name',r.name_ar,'flavorName',r.flavor_name_ar,
   'familyId',r.flavor_master_product_id,'familyName',r.family_name,'sku',r.sku,'barcode',r.barcode,
   'unitId',r.unit_id,'unitName',r.unit_name,'enabled',true,'quantity',r.quantity,'threshold',r.low_threshold,
   'status',CASE r.priority WHEN 0 THEN 'zero' WHEN 1 THEN 'low' ELSE 'available' END,
   'revision',r.revision,'updatedAt',r.updated_at,'lastEvent',event.data
  ) ORDER BY r.priority,r.name_ar,r.flavor_name_ar,r.sku,r.id)
  FROM page_rows r LEFT JOIN LATERAL(
   SELECT jsonb_build_object('kind',e.kind,'delta',e.quantity_after-e.quantity_before,'at',e.created_at,
    'actorDisplayName',NULLIF(btrim(actor.full_name),''),'source',o.source) AS data
   FROM sales_lite3.quantity_events e LEFT JOIN public.profiles actor ON actor.id=e.created_by
   LEFT JOIN public.orders o ON o.id=e.order_id
   WHERE e.product_id=r.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1
  ) event ON true),'[]'::JSONB)) INTO result;
 RETURN result;
END $$;
ALTER FUNCTION public.lite3_counters224(TEXT,TEXT,INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.lite3_counters224(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite3_counters224(TEXT,TEXT,INTEGER,INTEGER) TO authenticated;
COMMIT;
