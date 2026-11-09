-- Same old page/filter/sort/count contract and role check. Financial correction
-- applies only to immutable lite provenance;full-only JSON stays byte-for-byte.
CREATE FUNCTION public.lite1_operational_orders_page2(p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25,p_filter TEXT DEFAULT 'action',p_search TEXT DEFAULT NULL,p_sort TEXT DEFAULT 'newest')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base JSONB;adjustment BIGINT;amounts JSONB;
BEGIN
 base:=public.get_operational_orders_page(p_page,p_page_size,p_filter,p_search,p_sort);
 IF NOT EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE COALESCE(o.source,'website')<>'pos') THEN RETURN base;END IF;
 SELECT COALESCE(sum(f.outstanding_total_in_minor_units-GREATEST(o.total_in_minor_units-o.amount_paid_in_minor_units,0)),0)::BIGINT INTO adjustment
 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE COALESCE(o.source,'website')<>'pos' AND o.status IN('completed','delivered');
 SELECT COALESCE(jsonb_agg(jsonb_build_object('orderId',o.id,'amountPaidInMinorUnits',o.amount_paid_in_minor_units,'amountDueInMinorUnits',f.outstanding_total_in_minor_units,'customerName',o.customer_name_snapshot) ORDER BY o.id),'[]'::JSONB) INTO amounts
 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE o.id IN(SELECT value::UUID FROM jsonb_array_elements_text(base->'order_ids'));
 RETURN jsonb_set(base,'{summary,due_in_minor_units}',to_jsonb((base#>>'{summary,due_in_minor_units}')::BIGINT+adjustment))
 ||jsonb_build_object('contractVersion','lite2-orders-page-v1','liteAmounts',amounts);
END $$;
REVOKE ALL ON FUNCTION public.lite1_operational_orders_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_operational_orders_page2(INTEGER,INTEGER,TEXT,TEXT,TEXT) TO authenticated;

-- Reuse the original metadata writer after the parallel state coordinator has
-- reached out_for_delivery. Its legacy update_order_status branch cannot run.
CREATE FUNCTION public.lite1_delivery2(p_order_id UUID,p_eta_minutes INTEGER,p_driver_phone TEXT,p_notes TEXT,p_key UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE replay JSONB;status TEXT;result JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 replay:=sales_lite1.lock_request(p_key::TEXT,'delivery2',jsonb_build_object('order',p_order_id,'eta',p_eta_minutes,'phone',p_driver_phone,'notes',p_notes));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order_id,false,false);
 SELECT o.status INTO status FROM public.orders o WHERE o.id=p_order_id AND o.source='website' AND sales_lite1.is_order(o.id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 IF status='preparing' THEN PERFORM public.lite1_transition2(p_order_id,'ready',p_key::TEXT||':ready',p_notes);status:='ready';END IF;
 IF status='ready' THEN PERFORM public.lite1_transition2(p_order_id,'out_for_delivery',p_key::TEXT||':out',p_notes);status:='out_for_delivery';END IF;
 IF status IS DISTINCT FROM 'out_for_delivery' THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 result:=public.start_or_update_order_delivery(p_order_id,p_eta_minutes,p_driver_phone,p_notes);
 RETURN sales_lite1.finish(p_key::TEXT,result||jsonb_build_object('accountingTracked',false));
END $$;
REVOKE ALL ON FUNCTION public.lite1_delivery2(UUID,INTEGER,TEXT,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_delivery2(UUID,INTEGER,TEXT,TEXT,UUID) TO authenticated;
