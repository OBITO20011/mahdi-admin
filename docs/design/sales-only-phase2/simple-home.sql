-- QUARANTINED: reuse verified cost-free report facts, never stock/cost readers.
CREATE FUNCTION public.lite1_home2(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE today DATE:=(now() AT TIME ZONE 'Asia/Amman')::DATE;month_start DATE:=date_trunc('month',today)::DATE;
 facts JSONB;summary JSONB;day_fact JSONB;week JSONB;statuses JSONB;recent JSONB;
BEGIN
 PERFORM sales_lite1.owner();
 facts:=public.lite1_business_report2(p_branch_id,LEAST(month_start,today-6),today);
 SELECT x INTO STRICT day_fact FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE x->>'date'=today::TEXT;
 SELECT jsonb_build_object(
  'todayCollections',day_fact->'customerCollections',
  'todayCashCollectedInMinorUnits',day_fact->'customerCollections'->'cashInMinorUnits',
  'todayCliqCollectedInMinorUnits',day_fact->'customerCollections'->'cliqInMinorUnits',
  'todaySalesInMinorUnits',day_fact->'grossSalesInMinorUnits','todayCompletedOrders',day_fact->'completedOrderCount',
  'monthSalesInMinorUnits',sum((x->>'grossSalesInMinorUnits')::BIGINT),
  'monthNetSalesInMinorUnits',sum((x->>'netSalesInMinorUnits')::BIGINT),
  'customerReceivablesInMinorUnits',facts->'balances'->'customerDueInMinorUnits',
  'activeProductsCount',(SELECT count(*) FROM public.products WHERE is_active),
  'activeCustomersCount',(SELECT count(*) FROM public.customers WHERE is_active AND NOT is_deleted)) INTO summary
 FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE (x->>'date')::DATE>=month_start;
 SELECT jsonb_agg(jsonb_build_object('date',x->'date','dayLabel',x->'date','salesInMinorUnits',x->'grossSalesInMinorUnits','netSalesInMinorUnits',x->'netSalesInMinorUnits') ORDER BY x->>'date') INTO week
 FROM jsonb_array_elements(facts->'dailyBreakdown') x WHERE (x->>'date')::DATE>=today-6;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('status',status,'count',n) ORDER BY status),'[]'::JSONB) INTO statuses
 FROM(SELECT status,count(*) n FROM public.orders WHERE branch_id=p_branch_id GROUP BY status) s;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'orderNumber',order_number,'customerName',COALESCE(customer_name_snapshot,'زبون مباشر'),'status',status,'paymentStatus',payment_status,'totalInMinorUnits',total_in_minor_units,'source',COALESCE(source,'website'),'createdAt',created_at) ORDER BY created_at DESC,id DESC),'[]'::JSONB) INTO recent
 FROM(SELECT id,order_number,customer_name_snapshot,status,payment_status,total_in_minor_units,source,created_at FROM public.orders WHERE branch_id=p_branch_id ORDER BY created_at DESC,id DESC LIMIT 5) o;
 RETURN jsonb_build_object('contractVersion','lite2-home-v1','accountingTracked',false,'branchId',p_branch_id,'generatedAt',now(),'financialFactsAvailable',true,
  'summary',summary,'orderStatuses',statuses,'latestOrders',recent,'sevenDaySales',week,
  'chequeAlerts',jsonb_build_object('due',(SELECT count(*) FROM public.deferred_cheques WHERE branch_id=p_branch_id AND direction='incoming' AND status='pending' AND due_date>=today AND due_date<=today+2),
   'overdue',(SELECT count(*) FROM public.deferred_cheques WHERE branch_id=p_branch_id AND direction='incoming' AND status='pending' AND due_date<today)));
END $$;
REVOKE ALL ON FUNCTION public.lite1_home2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_home2(UUID) TO authenticated;
