-- QUARANTINED. Extensions only to phase1's private evidence,not the219 schema.
-- Zero entitlement consumes return capacity too (e.g.a fully discounted line).
-- The old prototype entrypoint is revoked below; no change to a219 function.
ALTER TABLE sales_lite1.returns DROP CONSTRAINT returns_entitlement_check;
ALTER TABLE sales_lite1.returns ADD CONSTRAINT returns_entitlement_check CHECK(entitlement>=0);
-- Debt-only returns, as in215, do not need a drawer. Money refunds still do.
ALTER TABLE sales_lite1.returns ALTER COLUMN shift_id DROP NOT NULL;
ALTER TABLE sales_lite1.returns ADD CONSTRAINT return_money_requires_shift CHECK(money_refund=0 OR shift_id IS NOT NULL);
CREATE TABLE sales_lite2.return_details(
 return_id UUID PRIMARY KEY REFERENCES sales_lite1.returns(id),
 parcel_instance_id UUID UNIQUE REFERENCES public.order_parcel_instances(id),
 applied_damage BIGINT NOT NULL CHECK(applied_damage>=0),
 request_snapshot JSONB NOT NULL,plan_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE sales_lite2.return_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE sales_lite2.return_details FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_immutable BEFORE UPDATE OR DELETE ON sales_lite2.return_details FOR EACH ROW EXECUTE FUNCTION sales_lite1.immutable();
CREATE TRIGGER lite2_no_truncate BEFORE TRUNCATE ON sales_lite2.return_details FOR EACH STATEMENT EXECUTE FUNCTION sales_lite1.immutable();

CREATE FUNCTION sales_lite2.sale_packet_price(p_order UUID,p_item UUID,p_component UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_component IS NULL THEN (line->>'effectiveStandaloneUnitPriceInMinorUnits')::BIGINT
 ELSE(SELECT(c->>'effectiveStandaloneUnitPriceInMinorUnits')::BIGINT FROM jsonb_array_elements(line->'parcel_instances') i CROSS JOIN LATERAL jsonb_array_elements(i->'components') c WHERE c->>'component_id'=p_component::TEXT) END
 FROM sales_lite2.sales s CROSS JOIN LATERAL jsonb_array_elements(s.plan->'lines') line WHERE s.order_id=p_order AND line->>'orderItemId'=p_item::TEXT;
$$;
REVOKE ALL ON FUNCTION sales_lite2.sale_packet_price(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.return_context(p_order UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.orders;completed TIMESTAMPTZ;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order;
 IF NOT FOUND OR o.status<>'completed' OR NOT sales_lite1.is_order(o.id) OR o.branch_id IS NULL OR o.warehouse_id IS NULL THEN RAISE EXCEPTION 'AFTERCARE215_ORDER_UNAVAILABLE';END IF;
 SELECT completed_at INTO completed FROM sales_lite1.completions WHERE order_id=p_order;
 PERFORM sales_lite1.assert_return_window(completed,statement_timestamp());
 RETURN jsonb_build_object('capability','lite2','order',jsonb_build_object('id',o.id,'orderNumber',o.order_number,'status',o.status,'saleContract','lite2',
  'branchId',o.branch_id,'warehouseId',o.warehouse_id,'completedAt',completed,'deadlineAt',completed+interval '48 hours','withinWindow',true));
END $$;
REVOKE ALL ON FUNCTION sales_lite2.return_context(UUID) FROM PUBLIC,anon,authenticated,service_role;

-- INSERT_EXACT_RETURN_PREPARE_HERE

CREATE FUNCTION public.lite1_preview_return2(p_payload JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;plan JSONB;
BEGIN
 PERFORM sales_lite1.owner();request:=public.tb215_canonical_return_internal(p_payload);
 -- The current inspector submits one root at a time. No silent partial commit
 -- or invented grouping: wider batches fail before any mutation.
 IF jsonb_array_length(request#>'{baseRequest,items}')<>1 THEN RAISE EXCEPTION 'LITE2_ONE_RETURN_ROOT_REQUIRED';END IF;
 plan:=sales_lite2.prepare_return(request);
 RETURN (plan-ARRAY['request','order','originalPaymentMethod','financialPosition','cashShiftId','physicalSources','goodRestockValueExact','badLossInMinorUnits','supplierHeldInMinorUnits'])
  ||jsonb_build_object('contractVersion',215,'orderId',p_payload->'orderId','previewFingerprint',encode(extensions.digest(plan::TEXT,'sha256'),'hex'),'canConfirm',jsonb_array_length(plan->'issues')=0,'accountingTracked',false);
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_return2(JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_return2(JSONB) TO authenticated;

CREATE FUNCTION public.lite1_settle_return2(p_payload JSONB,p_key TEXT,p_preview TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE request JSONB;sealed_request JSONB;fingerprint TEXT;r sales_lite1.requests;plan JSONB;item JSONB;o public.orders;rid UUID:=gen_random_uuid();sid UUID;quantity INTEGER;method TEXT;result JSONB;
BEGIN
 PERFORM sales_lite1.owner();request:=public.tb215_canonical_return_internal(p_payload);
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 8 AND 128 OR p_preview IS NULL OR p_preview!~'^[a-f0-9]{64}$' OR jsonb_array_length(request#>'{baseRequest,items}')<>1 THEN RAISE EXCEPTION 'LITE2_RETURN_IDENTITY_INVALID';END IF;
 sealed_request:=jsonb_build_object('request',request,'preview',p_preview);fingerprint:=encode(extensions.digest(sealed_request::TEXT,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 SELECT * INTO r FROM sales_lite1.requests WHERE key=p_key;
 IF FOUND THEN
  IF r.kind<>'return2' OR r.actor IS DISTINCT FROM auth.uid() OR r.fingerprint<>fingerprint OR r.result IS NULL THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
  RETURN r.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.business_operations WHERE idempotency_key=p_key) OR EXISTS(SELECT 1 FROM public.orders WHERE idempotency_key=p_key) THEN RAISE EXCEPTION 'LITE1_IDEMPOTENCY_CONFLICT';END IF;
 -- Old lite invoices remain non-stock even after opening epoch enables full.
 PERFORM sales_lite1.lock_mode();
 -- Locks any open shift when present, but debt-only settlement needs none.
 -- The pinned215 preparation and conditional money check below enforce it.
 PERFORM public.phase4_lock_customer_order_context_internal((request#>>'{baseRequest,order_id}')::UUID,false,false);
 SELECT * INTO o FROM public.orders WHERE id=(request#>>'{baseRequest,order_id}')::UUID FOR UPDATE;
 IF NOT FOUND OR NOT sales_lite1.is_order(o.id) THEN RAISE EXCEPTION 'LITE2_ORDER_CONTEXT_INVALID';END IF;
 plan:=sales_lite2.prepare_return(request);
 IF encode(extensions.digest(plan::TEXT,'sha256'),'hex')<>p_preview THEN RAISE EXCEPTION 'AFTERCARE215_PREVIEW_CHANGED';END IF;
 IF jsonb_array_length(plan->'issues')<>0 THEN RAISE EXCEPTION 'LITE2_RETURN_REVIEW_REQUIRED';END IF;
 SELECT id INTO sid FROM public.cash_shifts WHERE branch_id=o.branch_id AND status='open' ORDER BY id LIMIT 1 FOR UPDATE;
 IF (plan->>'moneyRefundInMinorUnits')::BIGINT>0 AND sid IS NULL THEN RAISE EXCEPTION 'LITE1_SHIFT_REQUIRED';END IF;
 IF (plan->>'moneyRefundInMinorUnits')::BIGINT=0 THEN sid:=NULL;END IF;
 item:=request#>'{baseRequest,items,0}';quantity:=CASE WHEN item->>'return_scope'='parcel_instance' THEN 1 ELSE(item->>'quantity')::INTEGER END;
 method:=COALESCE(plan->>'refundMethod','cash');
 INSERT INTO sales_lite1.requests VALUES(p_key,'return2',fingerprint,auth.uid(),NULL);
 INSERT INTO sales_lite1.returns(id,order_id,item_id,quantity,entitlement,debt_reduction,money_refund,method,shift_id,key,created_by)
 VALUES(rid,o.id,(item->>'order_item_id')::UUID,quantity,(plan->>'entitlementInMinorUnits')::BIGINT,(plan->>'debtReductionInMinorUnits')::BIGINT,(plan->>'moneyRefundInMinorUnits')::BIGINT,method,sid,p_key,auth.uid());
 INSERT INTO sales_lite2.return_details(return_id,parcel_instance_id,applied_damage,request_snapshot,plan_snapshot)
 VALUES(rid,NULLIF(item->>'parcel_instance_id','')::UUID,(plan->>'customerDamageDeductionInMinorUnits')::BIGINT,request,plan);
 result:=jsonb_build_object('success',true,'contractVersion',215,'operationId',rid,'returnOperationId',rid,'returnId',rid,'returnNumber','L2R-'||rid::TEXT,'orderId',o.id,'entitlementInMinorUnits',plan->'entitlementInMinorUnits',
  'debtReductionInMinorUnits',plan->'debtReductionInMinorUnits','moneyRefundInMinorUnits',plan->'moneyRefundInMinorUnits','accountingTracked',false,
  'goodQuantity',plan->'goodQuantity','badQuantity',plan->'badQuantity','customerDamageQuantity',plan->'customerDamageQuantity',
  'refundMethod',CASE WHEN(plan->>'moneyRefundInMinorUnits')::BIGINT>0 THEN method ELSE NULL END);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details) VALUES(auth.uid(),'LITE2_RETURN','orders',o.id,jsonb_build_object('returnId',rid,'preview',p_preview));
 RETURN sales_lite1.finish(p_key,result);
END $$;
REVOKE ALL ON FUNCTION public.lite1_settle_return2(JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_settle_return2(JSONB,TEXT,TEXT) TO authenticated;
-- Prototype straight-unit arithmetic is not an alternative financial path.
REVOKE ALL ON FUNCTION public.lite1_return(UUID,INTEGER,TEXT,TEXT) FROM authenticated;
