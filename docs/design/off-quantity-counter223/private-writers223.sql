-- Generated explicit OFF-private leaves only;no frozen public body or ON dispatch changes.
BEGIN;
CREATE OR REPLACE FUNCTION sales_lite2.pos(p_request JSONB,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $pos$
DECLARE
 replay JSONB;plan JSONB;line JSONB;instance JSONB;component JSONB;
 result JSONB;items JSONB:='[]';item JSONB;instances JSONB;proof_lines JSONB:='[]';proof_instances JSONB;proof_components JSONB;
 product public.products;leaf public.products;customer public.customers;
 bid UUID;wid UUID;cid UUID;shift_id UUID;oid UUID:=gen_random_uuid();op UUID:=gen_random_uuid();item_id UUID;instance_id UUID;component_id UUID;
 ids UUID[];unavailable UUID[]:='{}';pid UUID;name TEXT;method TEXT;paid BIGINT:=0;received BIGINT;change_due BIGINT:=0;
 payment JSONB;initial_method TEXT;initial_id UUID;initial_reference TEXT;initial_amount BIGINT;
 base_name TEXT;parcel_name TEXT;stored_quantity INTEGER;effective_price BIGINT;
BEGIN
 PERFORM sales_lite1.owner();
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::TEXT)>65536
 OR(p_request-ARRAY['branchId','warehouseId','customerId','customerName','paymentMethod','lines','discountInMinorUnits','amountReceivedInMinorUnits','initialPayment','unavailableConfirmed'])<>'{}'::JSONB THEN RAISE EXCEPTION 'LITE2_REQUEST_INVALID';END IF;
 -- Preserve the raw-key coordinator used by the existing POS/partial writers,
 -- in addition to the private sealed-request guard introduced by phase1.
 PERFORM pg_advisory_xact_lock(hashtext(p_key));
 replay:=sales_lite1.lock_request(p_key,'pos2',p_request);IF replay IS NOT NULL THEN RETURN replay;END IF;
 IF EXISTS(SELECT 1 FROM public.pos_uncommitted_attempt_cancellations WHERE actor_id=auth.uid() AND idempotency_key=p_key) THEN RAISE EXCEPTION 'PACKAGE_D_POS_ATTEMPT_CANCELLED';END IF;
 bid:=(p_request->>'branchId')::UUID;wid:=(p_request->>'warehouseId')::UUID;cid:=NULLIF(p_request->>'customerId','')::UUID;
 method:=p_request->>'paymentMethod';received:=COALESCE((p_request->>'amountReceivedInMinorUnits')::BIGINT,0);
 IF method IS NULL OR method NOT IN('cash','cliq','debt') OR received<0 THEN RAISE EXCEPTION 'PHASE3_POS_PAYMENT_METHOD_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.branches WHERE id=bid AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.warehouses WHERE id=wid AND branch_id=bid AND is_active) THEN RAISE EXCEPTION 'PHASE3_POS_LOCATION_INVALID';END IF;
 IF cid IS NOT NULL THEN
  SELECT * INTO customer FROM public.customers WHERE id=cid AND is_active AND NOT is_deleted AND NOT is_blocked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_CUSTOMER_INVALID';END IF;name:=customer.full_name;
 ELSE name:=COALESCE(NULLIF(btrim(p_request->>'customerName'),''),'زبون نقدي');END IF;
 IF length(name)>120 THEN RAISE EXCEPTION 'LITE2_CUSTOMER_NAME_INVALID';END IF;
 IF method='debt' AND cid IS NULL THEN RAISE EXCEPTION 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED';END IF;
 SELECT id INTO shift_id FROM public.cash_shifts WHERE branch_id=bid AND status='open' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PHASE3_POS_OPEN_SHIFT_REQUIRED';END IF;
 -- Validate/canonicalize first, then lock all products+parents in stable order
 -- and re-read commercial truth. No inventory rows or quantities are touched.
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM(
  SELECT(value->>'product_id')::UUID id FROM jsonb_array_elements(plan->'lines')
  UNION SELECT(c->>'product_id')::UUID FROM jsonb_array_elements(plan->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c
 ) x;
 PERFORM 1 FROM public.products WHERE id=ANY(ids) OR id IN(SELECT flavor_master_product_id FROM public.products WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 plan:=sales_lite2.plan(p_request->'lines','admin_pos',COALESCE((p_request->>'discountInMinorUnits')::BIGINT,0));
 IF p_request?'unavailableConfirmed' AND jsonb_typeof(p_request->'unavailableConfirmed')<>'array' THEN RAISE EXCEPTION 'LITE2_CONFIRMATION_INVALID';END IF;
 FOREACH pid IN ARRAY ids LOOP
  IF NOT sales_lite1.available(pid) THEN
   IF NOT COALESCE(p_request->'unavailableConfirmed' @> jsonb_build_array(pid),false) THEN RAISE EXCEPTION 'LITE1_UNAVAILABLE_CONFIRM_REQUIRED';END IF;
   unavailable:=array_append(unavailable,pid);
  END IF;
 END LOOP;
 unavailable:=sales_lite3.confirm_plan223(plan,unavailable,p_request->'unavailableConfirmed');
 IF p_request?'initialPayment' THEN
  IF method<>'debt' OR jsonb_typeof(p_request->'initialPayment')<>'object'
  OR((p_request->'initialPayment')-ARRAY['amountInMinorUnits','method','referenceNumber'])<>'{}'::JSONB THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
  initial_amount:=(p_request#>>'{initialPayment,amountInMinorUnits}')::BIGINT;initial_method:=p_request#>>'{initialPayment,method}';initial_reference:=NULLIF(btrim(p_request#>>'{initialPayment,referenceNumber}'),'');
  IF initial_amount IS NULL OR initial_amount<=0 OR initial_amount>=(plan->>'totalInMinorUnits')::BIGINT OR initial_method IS NULL OR initial_method NOT IN('cash','cliq') OR length(COALESCE(initial_reference,''))>200 THEN RAISE EXCEPTION 'POS216_INITIAL_PAYMENT_INVALID';END IF;
 ELSIF method IN('cash','cliq') THEN paid:=(plan->>'totalInMinorUnits')::BIGINT;END IF;
 IF method='cash' AND received>0 AND received<paid THEN RAISE EXCEPTION 'PHASE3_POS_TENDER_INSUFFICIENT';END IF;
 IF method='cash' THEN change_due:=GREATEST(received-paid,0);END IF;
 -- Immutable operation envelope is inserted once, like the phase1 contract.
 -- The sealed request stores the complete DTO (including the subsequently
 -- generated partial-payment ID). Never UPDATE immutable business history.
 INSERT INTO public.business_operations(id,operation_type,idempotency_key,request_fingerprint,initiated_by,result_snapshot,completed_at)
 VALUES(op,'lite1_pos',p_key,(SELECT fingerprint FROM sales_lite1.requests WHERE key=p_key),auth.uid(),
  jsonb_build_object('success',true,'orderId',oid,'operationId',op,'contractVersion','lite2-pos-v1','totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,'accountingTracked',false),now());
 INSERT INTO sales_lite1.orders VALUES(oid,op,'{}',unavailable);
 INSERT INTO public.orders(id,order_number,customer_id,customer_name_snapshot,branch_id,warehouse_id,status,payment_method,payment_status,
  subtotal_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,change_due_in_minor_units,source,idempotency_key,operation_id,cash_shift_id)
 VALUES(oid,'L2-'||oid::TEXT,cid,name,bid,wid,'completed',method,CASE WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,
  (plan->>'subtotalInMinorUnits')::BIGINT,(plan->>'discountInMinorUnits')::BIGINT,(plan->>'totalInMinorUnits')::BIGINT,paid,change_due,'pos',p_key,op,shift_id);
 INSERT INTO sales_lite1.completions(order_id) VALUES(oid);
 result:=sales_lite2.materialize(oid,op,plan,'admin_pos');items:=result->'items';proof_lines:=result->'lines';
 IF initial_amount IS NOT NULL THEN
  payment:=public.record_customer_order_payment_once(oid,initial_amount,initial_method,initial_reference,NULL,'lite2-initial-'||op::TEXT);
  initial_id:=(payment->>'payment_id')::UUID;paid:=initial_amount;
 END IF;
 result:=jsonb_build_object('success',true,'idempotentReplay',false,'orderId',oid,'operationId',op,'orderNumber','L2-'||oid::TEXT,'warehouseId',wid,'branchId',bid,'cashShiftId',shift_id,
  'customerName',name,'subtotalInMinorUnits',(plan->>'subtotalInMinorUnits')::BIGINT,'discountInMinorUnits',(plan->>'discountInMinorUnits')::BIGINT,'totalInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT,
  'amountPaidInMinorUnits',paid,'changeDueInMinorUnits',change_due,'remainingInMinorUnits',(plan->>'totalInMinorUnits')::BIGINT-paid,'paymentMethod',method,
  'paymentStatus',CASE WHEN initial_amount IS NOT NULL THEN 'partially_paid' WHEN method='debt' THEN 'unpaid' ELSE 'paid' END,'items',items,'unavailableConfirmed',to_jsonb(unavailable),'accountingTracked',false);
 IF initial_id IS NOT NULL THEN result:=result||jsonb_build_object('initialPaymentMethod',initial_method,'initialPaymentId',initial_id);END IF;
 INSERT INTO sales_lite2.sales(order_id,request_key,plan,initial_payment_id) VALUES(oid,p_key,plan||jsonb_build_object('lines',proof_lines),initial_id);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_POS','orders',oid,jsonb_build_object('operationId',op,'unavailableConfirmed',to_jsonb(unavailable)));
 RETURN sales_lite1.finish(p_key,result);
END $pos$;

CREATE OR REPLACE FUNCTION sales_lite2.catalog_page(p_limit integer,p_offset integer,p_category_id uuid,p_search text,p_availability text,p_sort text,p_brand_id uuid,p_sale_unit_id uuid,p_product_ids uuid[])
 RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $catalog$
  WITH  sales_by_product AS (
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
      p.default_sale_price_in_minor_units,
      p.sale_price_in_minor_units,
      sales_lite3.effective_available223(p.id) AS manual_available,
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
      NULL::INTEGER AS available_sale_packages,
      BOOL_OR(NOT is_flavor_master AND manual_available) AS is_available,
      false AS is_low_stock,
      MAX(created_at) AS created_at,
      COALESCE(SUM(sold_packages_last_90_days) FILTER (WHERE NOT is_flavor_master), 0)::BIGINT
        AS sold_packages_last_90_days
    FROM catalog_source
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
    JOIN catalog_source cs ON cs.family_id = pf.family_id
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
          'quantityTracked',false,
          'manualAvailable',manual_available,
          'availableQuantity',NULL,
          'availableSalePackages',NULL,
          'minimumOrderPackages', 1,
          'imageUrl', image_url,
          'isAvailable', manual_available AND NOT is_flavor_master,
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
      'quantityTracked',false,
      'availableSalePackages',NULL,
      'lowStockProducts', (SELECT COUNT(*) FROM matching_families WHERE is_low_stock)
    ),
    'total', (SELECT COUNT(*) FROM matching_families),
    'limit', LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
$catalog$;

CREATE OR REPLACE FUNCTION sales_lite2.parcel_options(p_family_product_ids UUID[])
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $parcel$
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
      AND sales_lite3.effective_available223(family.id)
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
      sales_lite3.effective_available223(component.id) AS manual_available
    FROM configuration_source configuration
    CROSS JOIN storefront_warehouse warehouse
    JOIN public.products component
      ON component.flavor_master_product_id = configuration.family_product_id
      AND component.is_active
      AND NOT component.is_flavor_master
    JOIN public.categories component_category
      ON component_category.id = component.category_id
      AND component_category.is_active
    JOIN public.units component_unit
      ON component_unit.id = component.unit_id
    JOIN public.units component_sale_unit
      ON component_sale_unit.id = component.sale_unit_id
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
    WHERE sales_lite3.effective_available223(component.id)
      AND EXISTS(SELECT 1 FROM public.product_parcel_allowed_components allowed WHERE allowed.configuration_id=configuration.parcel_configuration_id AND allowed.product_id=component.id)
      AND component.units_per_sale_unit > 0
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
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'productId', component.product_id,
          'sku', component.sku,
          'nameAr', component.name_ar,
          'flavorNameAr', component.flavor_name_ar,
          'unitNameAr', component.component_unit_name_ar,
          'imageUrl', component.image_url,
          'quantityTracked',false,
          'manualAvailable',component.manual_available,
          'availableQuantity',NULL
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
        'quantityTracked',false,
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
$parcel$;
COMMIT;
