-- QUARANTINED. Same canonical sales/receivables/collections/expenses;no costs.
CREATE FUNCTION public.lite1_business_report2(p_branch_id UUID,p_date_from DATE,p_date_to DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE facts JSONB;start_at TIMESTAMPTZ;end_at TIMESTAMPTZ;
BEGIN
 PERFORM sales_lite1.owner();
 IF p_branch_id IS NULL OR p_date_from IS NULL OR p_date_to IS NULL OR p_date_to<p_date_from OR p_date_to-p_date_from>365
  OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active) THEN RAISE EXCEPTION 'LITE2_REPORT_PERIOD_INVALID';END IF;
 start_at:=p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';end_at:=(p_date_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
 facts:=sales_lite2.simple_facts(p_branch_id,start_at,end_at,'Asia/Amman',true);
 -- Reuse the complete existing215 cash/exchange adjustment and evidence
 -- assertions. Inventory recovery/profit-only presentation is intentionally
 -- absent;full historical exchanges still keep their exact monetary meaning.
 PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
  JOIN public.orders o ON o.id=i.order_id WHERE o.branch_id=p_branch_id AND i.created_at>=start_at AND i.created_at<end_at;
 PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
  JOIN public.orders o ON o.id=c.order_id WHERE o.branch_id=p_branch_id AND c.created_at>=start_at AND c.created_at<end_at;
 facts:=public.tb215_exchange_financial_adjustment_internal(facts,p_branch_id,start_at,end_at,'Asia/Amman',true);
 RETURN jsonb_build_object('success',true,'contractVersion','lite2-business-report-v1','accountingTracked',false,'branchId',p_branch_id,'generatedAt',now(),
  'period',jsonb_build_object('dateFrom',p_date_from,'dateTo',p_date_to,'timezone','Asia/Amman'))||facts;
END $$;
REVOKE ALL ON FUNCTION public.lite1_business_report2(UUID,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_business_report2(UUID,DATE,DATE) TO authenticated;
