-- QUARANTINED reader. The full immutable snapshot/writers are never changed.
-- A full shift may refund a pre-activation, uncosted invoice. Its drawer money
-- remains authoritative; do not publish a misleading complete profit report.
CREATE FUNCTION public.lite1_shift_closing2(p_shift_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE original JSONB;lite_count BIGINT;cash BIGINT;cliq BIGINT;summary JSONB;
BEGIN
 original:=public.get_cash_shift_closing_report(p_shift_id);
 IF COALESCE(original->>'success','false')<>'true' OR original->>'accountingTracked'='false' THEN RETURN original;END IF;
 SELECT count(*),COALESCE(sum(money_refund) FILTER(WHERE method='cash'),0),COALESCE(sum(money_refund) FILTER(WHERE method='cliq'),0)
 INTO lite_count,cash,cliq FROM sales_lite1.returns WHERE shift_id=p_shift_id AND money_refund>0;
 IF lite_count=0 THEN RETURN original;END IF;
 PERFORM sales_lite1.owner();
 summary:=original->'shift';
 IF jsonb_typeof(summary) IS DISTINCT FROM 'object' OR original#>>'{sales,orderCount}' IS NULL
 OR original#>>'{outflows,returnCount}' IS NULL
 OR (summary->>'cashRefundsInMinorUnits')::BIGINT<cash OR (summary->>'cliqRefundsInMinorUnits')::BIGINT<cliq
 OR original#>>'{outflows,cashRefundsInMinorUnits}' IS DISTINCT FROM summary->>'cashRefundsInMinorUnits'
 OR original#>>'{outflows,cliqRefundsInMinorUnits}' IS DISTINCT FROM summary->>'cliqRefundsInMinorUnits'
 THEN RAISE EXCEPTION 'LITE2_MIXED_SHIFT_EVIDENCE_MISMATCH';END IF;
 RETURN jsonb_build_object('success',true,'accountingTracked',false,'historyWithoutCost',true,'contractVersion','lite2-mixed-shift-v1',
 'shiftId',p_shift_id,'summary',summary,'reconciliation',original->'reconciliation','snapshotStatus',original->'snapshotStatus',
 'orderCount',(original#>>'{sales,orderCount}')::BIGINT,'returnCount',(original#>>'{outflows,returnCount}')::BIGINT+lite_count,
 'returnMoneyInMinorUnits',(summary->>'cashRefundsInMinorUnits')::BIGINT+(summary->>'cliqRefundsInMinorUnits')::BIGINT,
 'cashExpensesInMinorUnits',(summary->>'cashExpensesInMinorUnits')::BIGINT);
END $$;
REVOKE ALL ON FUNCTION public.lite1_shift_closing2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_shift_closing2(UUID) TO authenticated;
