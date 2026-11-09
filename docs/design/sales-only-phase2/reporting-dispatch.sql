-- Provenance controls historical presentation independently from today's mode.
CREATE FUNCTION sales_lite2.period_has_uncosted(p_branch UUID,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM sales_lite1.completions c JOIN public.orders o ON o.id=c.order_id WHERE o.branch_id=p_branch AND c.completed_at>=p_start AND c.completed_at<p_end)
 OR EXISTS(SELECT 1 FROM sales_lite1.returns r JOIN public.orders o ON o.id=r.order_id WHERE o.branch_id=p_branch AND r.created_at>=p_start AND r.created_at<p_end)
$$;
REVOKE ALL ON FUNCTION sales_lite2.period_has_uncosted(UUID,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.lite1_reporting_report2(p_branch_id UUID,p_date_from DATE,p_date_to DATE) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF sales_lite1.enabled() OR sales_lite2.period_has_uncosted(p_branch_id,p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',(p_date_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman') THEN
  RETURN public.lite1_business_report2(p_branch_id,p_date_from,p_date_to)||jsonb_build_object('historyWithoutCost',true);
 END IF;
 RETURN public.get_operational_business_report(p_branch_id,p_date_from,p_date_to);
END $$;
REVOKE ALL ON FUNCTION public.lite1_reporting_report2(UUID,DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_reporting_report2(UUID,DATE,DATE) TO authenticated;
CREATE FUNCTION public.lite1_reporting_home2(p_branch_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE today DATE:=(now() AT TIME ZONE 'Asia/Amman')::DATE;start_day DATE:=LEAST(date_trunc('month',today)::DATE,today-6);
BEGIN
 IF sales_lite1.enabled() OR sales_lite2.period_has_uncosted(p_branch_id,start_day::TIMESTAMP AT TIME ZONE 'Asia/Amman',(today+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman') THEN
  RETURN public.lite1_home2(p_branch_id)||jsonb_build_object('historyWithoutCost',true);
 END IF;
 RETURN public.get_home_dashboard();
END $$;
REVOKE ALL ON FUNCTION public.lite1_reporting_home2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_reporting_home2(UUID) TO authenticated;
