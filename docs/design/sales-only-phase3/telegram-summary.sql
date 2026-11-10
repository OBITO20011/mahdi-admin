-- Owner10Nov: ninth READ bridge only. Snapshot remains at enqueue time.
CREATE FUNCTION sales_lite2.summary_uses_lite(p_from DATE,p_to DATE) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE zone TEXT;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;
BEGIN
 IF sales_lite1.enabled() THEN RETURN true;END IF;
 SELECT business_timezone INTO STRICT zone FROM public.business_alert_settings WHERE id=true;
 start_at:=p_from::TIMESTAMP AT TIME ZONE zone;end_at:=(p_to+1)::TIMESTAMP AT TIME ZONE zone;
 -- All branches,including returns after the opening epoch. No NULL equality.
 RETURN EXISTS(SELECT 1 FROM sales_lite1.completions c WHERE c.completed_at>=start_at AND c.completed_at<end_at)
 OR EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.created_at>=start_at AND r.created_at<end_at);
END $$;
REVOKE ALL ON FUNCTION sales_lite2.summary_uses_lite(DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sales_lite2.business_summary(p_type TEXT,p_from DATE,p_to DATE,p_generated TIMESTAMPTZ) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE zone TEXT;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;facts JSONB;result JSONB;sales JSONB;
BEGIN
 IF p_type IS NULL OR p_type NOT IN('daily','weekly') OR p_from IS NULL OR p_to IS NULL OR p_generated IS NULL
 OR(p_type='daily' AND p_from<>p_to) OR(p_type='weekly' AND p_to<>p_from+6) THEN
  RAISE EXCEPTION 'Invalid Business summary period.';
 END IF;
 SELECT business_timezone INTO STRICT zone FROM public.business_alert_settings WHERE id=true;
 start_at:=p_from::TIMESTAMP AT TIME ZONE zone;end_at:=(p_to+1)::TIMESTAMP AT TIME ZONE zone;
 facts:=sales_lite2.simple_facts(NULL,start_at,end_at,zone,true);
 -- Same monetary inspection/exchange evidence checks used by the owner reader.
 PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
 WHERE i.created_at>=start_at AND i.created_at<end_at;
 PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
 WHERE c.created_at>=start_at AND c.created_at<end_at;
 facts:=public.tb215_exchange_financial_adjustment_internal(facts,NULL,start_at,end_at,zone,true);
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO sales FROM jsonb_each(facts->'sales')
 WHERE key=ANY(ARRAY['orderCount','completedOrderCount','returnCount','grossSalesInMinorUnits','netSalesInMinorUnits',
 'refundsInMinorUnits','returnEntitlementInMinorUnits','debtReductionInMinorUnits','deliveryFeesInMinorUnits',
 'collectedInMinorUnits','outstandingInMinorUnits','discountInMinorUnits']);
 result:=jsonb_build_object('contractVersion','lite220-business-summary-v1','accountingTracked',false,'summaryType',p_type,
 'generatedAt',p_generated,'period',jsonb_build_object('dateFrom',p_from,'dateTo',p_to,'timezone',zone),
 'sales',sales,'cashFlow',facts->'cashFlow','expenses',facts->'expenses','dailyBreakdown',facts->'dailyBreakdown',
 'balances',jsonb_build_object('customerDueInMinorUnits',facts#>'{balances,customerDueInMinorUnits}',
 'customerOrderCount',facts#>'{balances,customerOrderCount}','customerCount',facts#>'{balances,customerCount}'));
 IF jsonb_typeof(result)<>'object' OR octet_length(result::TEXT)>32768 THEN
  RAISE EXCEPTION 'Business summary payload is invalid or too large.';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.business_summary(TEXT,DATE,DATE,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
