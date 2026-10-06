\set ON_ERROR_STOP on
CREATE TEMP TABLE package_d_results(scenario TEXT PRIMARY KEY, evidence JSONB);
DO $$
DECLARE
  v_owner UUID := '92400000-0000-0000-0000-000000000001';
  v_product UUID := '92400000-0000-0000-0000-000000000101';
  v_sale JSONB; v_order UUID; v_item UUID; v_error TEXT; v_case TEXT;
  v_items JSONB; v_sources JSONB; v_before JSONB; v_after JSONB;
  v_mode TEXT := current_setting('nawasrah.package_d_mode');
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub',v_owner,'role','authenticated','aal','aal2')::TEXT,false);
  v_sale := public.create_pos_sale_v2(
    '92400000-0000-0000-0000-000000000201',
    '92400000-0000-0000-0000-000000000200',NULL,'Package D guard fixture','cash',
    jsonb_build_array(jsonb_build_object('commercial_line_kind','base_unit',
      'product_id',v_product,'base_quantity',2)),0,2000,gen_random_uuid()::TEXT);
  IF v_sale->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Clean POS V2 fixture failed'; END IF;
  v_order := (v_sale->>'orderId')::UUID;
  SELECT id INTO STRICT v_item FROM public.order_items WHERE order_id=v_order;
  v_items := jsonb_build_array(jsonb_build_object('return_scope','base_unit',
    'order_item_id',v_item,'quantity',1,'stock_disposition','damaged'));
  v_sources := jsonb_build_array(jsonb_build_object('root_source_kind','base_order_item',
    'root_source_id',v_item,'source_kind','base_order_item','source_id',v_item,
    'product_id',v_product,'quantity',1,'sellable_restock_quantity',0,
    'defect_non_sellable_quantity',1,'customer_damage_quantity',0));
  FOREACH v_case IN ARRAY ARRAY['return','admin_return','replacement'] LOOP
    SELECT jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.orders t),
      'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.business_operations t),
      'returns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_return_events t),
      'replacements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_replacement_events t),
      'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t),
      'consumptions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_aftercare_consumptions t))
    INTO v_before;
    v_error := NULL;
    BEGIN
      -- Fault injection is isolated inside this rollback subtransaction.
      UPDATE public.orders SET operation_id=NULL WHERE id=v_order;
      BEGIN
        SET LOCAL ROLE authenticated;
        IF v_case='return' THEN
          PERFORM public.settle_sales_return_v1(v_order,gen_random_uuid()::TEXT,v_items,'D NULL source',NULL,NULL,NULL);
        ELSIF v_case='admin_return' THEN
          PERFORM public.settle_admin_sales_return_v1(v_order,gen_random_uuid()::TEXT,v_items,v_sources,'D NULL source',NULL,NULL,NULL);
        ELSE
          PERFORM public.settle_sales_replacement_v1(v_order,gen_random_uuid()::TEXT,
            jsonb_build_array(jsonb_build_object('sourceKind','base_order_item',
              'sourceId',v_item,'quantity',1)),'D NULL source',NULL);
        END IF;
      EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      END;
      RAISE EXCEPTION 'PACKAGE_D_ROLLBACK_PROBE';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'PACKAGE_D_ROLLBACK_PROBE' THEN RAISE; END IF;
    END;
    IF v_mode='after' THEN
      IF v_error IS NULL OR v_error NOT LIKE
        (CASE WHEN v_case='replacement' THEN 'PHASE43_SALE_CONTRACT_UNSUPPORTED:%'
          ELSE 'PHASE42_SALE_CONTRACT_UNSUPPORTED:%' END) THEN
        RAISE EXCEPTION 'NULL contract did not fail closed for %: %',v_case,v_error;
      END IF;
    ELSIF v_error LIKE 'PHASE42_SALE_CONTRACT_UNSUPPORTED:%'
      OR v_error LIKE 'PHASE43_SALE_CONTRACT_UNSUPPORTED:%' THEN
      RAISE EXCEPTION 'Before fixture unexpectedly rejected NULL at corrected boundary';
    END IF;
    SELECT jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.orders t),
      'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.business_operations t),
      'returns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_return_events t),
      'replacements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_replacement_events t),
      'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.inventory_movements t),
      'consumptions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.sales_aftercare_consumptions t))
    INTO v_after;
    IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'Probe leaked state: %',v_case; END IF;
    INSERT INTO package_d_results VALUES(v_case,jsonb_build_object(
      'observedError',v_error,'rolledBack',true,'modernContractRejected',
      COALESCE(v_error LIKE 'PHASE42_SALE_CONTRACT_UNSUPPORTED:%'
        OR v_error LIKE 'PHASE43_SALE_CONTRACT_UNSUPPORTED:%',false)));
  END LOOP;
END;
$$;
SELECT jsonb_object_agg(scenario,evidence) FROM package_d_results;
