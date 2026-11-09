-- QUARANTINED phase2. Parallel lifecycle;frozen full coordinators unchanged.
CREATE FUNCTION public.lite1_transition2(p_order UUID,p_next TEXT,p_key TEXT,p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $transition$
DECLARE replay JSONB;o public.orders;allowed BOOLEAN;
BEGIN
 PERFORM sales_lite1.owner();
 replay:=sales_lite1.lock_request(p_key,'transition2',jsonb_build_object('order',p_order,'next',p_next,'notes',p_notes));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,false,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 allowed:=CASE o.status WHEN 'new' THEN p_next IN('confirmed','preparing') WHEN 'confirmed' THEN p_next='preparing'
  WHEN 'preparing' THEN p_next IN('ready','out_for_delivery') WHEN 'ready' THEN p_next='out_for_delivery' ELSE false END;
 IF allowed IS DISTINCT FROM true OR length(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 UPDATE public.orders SET status=p_next,updated_at=now() WHERE id=p_order;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,p_next,auth.uid(),NULLIF(btrim(p_notes),''));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'order_id',p_order,'order_number',o.order_number,'status',p_next,'accountingTracked',false));
END $transition$;
REVOKE ALL ON FUNCTION public.lite1_transition2(UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_transition2(UUID,TEXT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_complete2(p_order UUID,p_key TEXT,p_payment_method TEXT,p_amount_collected_in_minor_units BIGINT DEFAULT NULL,
 p_delivery_fee_in_minor_units BIGINT DEFAULT NULL,p_reference_number TEXT DEFAULT NULL,p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $complete$
DECLARE replay JSONB;result JSONB;o public.orders;method TEXT:=lower(NULLIF(btrim(p_payment_method),''));
 fee BIGINT;total BIGINT;collected BIGINT;remaining BIGINT;sid UUID;payment JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 IF method='cash_on_delivery' THEN method:='cash';END IF;
 IF method IS NULL OR method NOT IN('cash','cliq','debt') OR COALESCE(p_amount_collected_in_minor_units,0)<0 OR COALESCE(p_delivery_fee_in_minor_units,0)<0
 OR length(COALESCE(btrim(p_reference_number),''))>120 OR length(COALESCE(p_notes,''))>1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 IF method='cliq' AND COALESCE(p_amount_collected_in_minor_units,1)>0 AND NULLIF(btrim(p_reference_number),'') IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_REFERENCE_REQUIRED';END IF;
 replay:=sales_lite1.lock_request(p_key,'complete2',jsonb_build_object('order',p_order,'method',method,'collected',p_amount_collected_in_minor_units,'delivery',p_delivery_fee_in_minor_units,'reference',p_reference_number,'notes',p_notes));
 IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,method<>'debt',false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' OR o.status NOT IN('ready','out_for_delivery')
 OR EXISTS(SELECT 1 FROM sales_lite1.completions WHERE order_id=p_order) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 fee:=COALESCE(p_delivery_fee_in_minor_units,o.delivery_fee_in_minor_units,0);
 total:=o.subtotal_in_minor_units-o.discount_in_minor_units+fee;
 collected:=CASE WHEN method='debt' THEN 0 ELSE COALESCE(p_amount_collected_in_minor_units,total) END;
 IF total<0 OR collected<0 OR collected>total THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 IF collected=0 THEN method:='debt';END IF;remaining:=total-collected;
 IF remaining>0 AND o.customer_id IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_SETTLEMENT_INVALID';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' ORDER BY id LIMIT 1 FOR UPDATE;
 IF collected>0 AND sid IS NULL THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_OPEN_SHIFT_REQUIRED';END IF;
 -- Same monetary settlement representation as the full completion coordinator.
 -- Full payment is classified by the shared order triggers;partial collection
 -- is a real customer payment through the existing protected writer.
 UPDATE public.orders SET status='completed',delivery_fee_in_minor_units=fee,total_in_minor_units=total,
  payment_method=CASE WHEN remaining>0 THEN 'debt' WHEN method='cash' THEN 'cash_on_delivery' ELSE 'cliq' END,
  payment_status=CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
  amount_paid_in_minor_units=0,payment_reference_number=CASE WHEN method='cliq' THEN NULLIF(btrim(p_reference_number),'') END,
  payment_confirmed_at=CASE WHEN collected>0 THEN now() END,payment_confirmed_by=CASE WHEN collected>0 THEN auth.uid() END,
  cash_shift_id=sid,updated_at=now() WHERE id=p_order;
 IF remaining>0 AND collected>0 THEN
  payment:=public.record_customer_order_payment_once(p_order,collected,method,NULLIF(btrim(p_reference_number),''),COALESCE(NULLIF(btrim(p_notes),''),'دفعة عند التسليم دون تتبع مخزون'),'lite2-delivery-'||p_order::TEXT);
 END IF;
 INSERT INTO sales_lite1.completions(order_id) VALUES(p_order);
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,'completed',auth.uid(),COALESCE(NULLIF(btrim(p_notes),''),'تسليم دون تتبع مخزون'));
 result:=jsonb_build_object('success',true,'operation_id',gen_random_uuid(),'order_id',p_order,'order_number',o.order_number,'status','completed','payment_method',CASE WHEN remaining>0 THEN 'debt' ELSE method END,
  'payment_status',CASE WHEN remaining=0 THEN 'paid' WHEN collected>0 THEN 'partially_paid' ELSE 'unpaid' END,
  'total_in_minor_units',total,'amount_paid_in_minor_units',collected,'remaining_in_minor_units',remaining,'customer_payment_number',payment->>'payment_number','accountingTracked',false);
 RETURN sales_lite1.finish(p_key,result);
END $complete$;
REVOKE ALL ON FUNCTION public.lite1_complete2(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_complete2(UUID,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) TO authenticated;

CREATE FUNCTION public.lite1_cancel_guest2(p_order UUID,p_key TEXT,p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $cancel_guest$
DECLARE replay JSONB;o public.orders;
BEGIN
 PERFORM sales_lite1.owner();
 IF length(COALESCE(btrim(p_reason),'')) NOT BETWEEN 2 AND 1000 THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 replay:=sales_lite1.lock_request(p_key,'cancel_guest2',jsonb_build_object('order',p_order,'reason',p_reason));IF replay IS NOT NULL THEN RETURN replay;END IF;
 PERFORM public.phase4_lock_customer_order_context_internal(p_order,false,false);
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) OR o.source<>'website' OR o.status NOT IN('new','confirmed','preparing','ready','out_for_delivery') OR o.amount_paid_in_minor_units<>0
 OR EXISTS(SELECT 1 FROM sales_lite1.completions WHERE order_id=p_order) THEN RAISE EXCEPTION 'PHASE3_CUSTOMER_LIFECYCLE_INVALID';END IF;
 UPDATE public.orders SET status='cancelled',updated_at=now() WHERE id=p_order;
 INSERT INTO public.order_status_history(order_id,old_status,new_status,changed_by,notes) VALUES(p_order,o.status,'cancelled',auth.uid(),btrim(p_reason));
 RETURN sales_lite1.finish(p_key,jsonb_build_object('success',true,'operation_id',gen_random_uuid(),'order_id',p_order,'order_number',o.order_number,'status','cancelled','accountingTracked',false,'reservation_state','not_tracked','released_reservations',0));
END $cancel_guest$;
REVOKE ALL ON FUNCTION public.lite1_cancel_guest2(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_cancel_guest2(UUID,TEXT,TEXT) TO authenticated;
