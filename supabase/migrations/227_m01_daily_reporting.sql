BEGIN;
CREATE FUNCTION public.report227_exchange_adjustment_internal(p_facts jsonb, p_branch_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_timezone text, p_verify boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE result JSONB:=p_facts; false_collections BIGINT; credit_refunds BIGINT; cash_in BIGINT; cliq_in BIGINT; cash_out BIGINT; cliq_out BIGINT;
 days JSONB;
BEGIN
 IF p_verify THEN PERFORM public.tb215_assert_exchange_internal(x.operation_id) FROM public.aftercare215_exchanges x
  JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id JOIN public.orders o ON o.id=r.new_order_id
  JOIN public.business_operations b ON b.id=o.operation_id JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id
  WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND(x.created_at>=p_start AND x.created_at<p_end OR b.completed_at>=p_start AND b.completed_at<p_end OR e.settled_at>=p_start AND e.settled_at<p_end); END IF;
 SELECT COALESCE(sum(o.total_in_minor_units) FILTER(WHERE b.completed_at>=p_start AND b.completed_at<p_end),0),
  COALESCE(sum((x.prepared_plan->>'internalCreditInMinorUnits')::BIGINT) FILTER(WHERE e.settled_at>=p_start AND e.settled_at<p_end),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cliq'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cash'),0),
  COALESCE(sum((x.prepared_plan->>'moneyRefundInMinorUnits')::BIGINT) FILTER(WHERE x.created_at>=p_start AND x.created_at<p_end AND x.prepared_plan->>'differenceMethod'='cliq'),0)
 INTO false_collections,credit_refunds,cash_in,cliq_in,cash_out,cliq_out
 FROM public.aftercare215_exchanges x JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
 JOIN public.orders o ON o.id=r.new_order_id JOIN public.business_operations b ON b.id=o.operation_id
 JOIN public.sales_return_events e ON e.operation_id=r.return_operation_id WHERE p_branch_id IS NULL OR o.branch_id=p_branch_id;
 result:=jsonb_set(result,'{sales,refundsInMinorUnits}',to_jsonb((result->'sales'->>'refundsInMinorUnits')::BIGINT-credit_refunds));
 result:=jsonb_set(result,'{cashFlow,customerCollections,otherInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'otherInMinorUnits')::BIGINT-false_collections));
 result:=jsonb_set(result,'{cashFlow,customerCollections,totalInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'totalInMinorUnits')::BIGINT-false_collections+cash_in+cliq_in));
 result:=jsonb_set(result,'{cashFlow,customerCollections,cashInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'cashInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cashFlow,customerCollections,cliqInMinorUnits}',to_jsonb((result->'cashFlow'->'customerCollections'->>'cliqInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashFlow,cashCollectedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashCollectedInMinorUnits')::BIGINT+cash_in));
 result:=jsonb_set(result,'{cashFlow,cliqCollectedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqCollectedInMinorUnits')::BIGINT+cliq_in));
 result:=jsonb_set(result,'{cashFlow,cashRefundedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashRefundedInMinorUnits')::BIGINT+cash_out));
 result:=jsonb_set(result,'{cashFlow,cliqRefundedInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqRefundedInMinorUnits')::BIGINT+cliq_out));
 result:=jsonb_set(result,'{cashFlow,cashNetFlowInMinorUnits}',to_jsonb((result->'cashFlow'->>'cashNetFlowInMinorUnits')::BIGINT+cash_in-cash_out));
 result:=jsonb_set(result,'{cashFlow,cliqNetFlowInMinorUnits}',to_jsonb((result->'cashFlow'->>'cliqNetFlowInMinorUnits')::BIGINT+cliq_in-cliq_out));
 WITH exchange_rows AS MATERIALIZED (
  SELECT b.completed_at,o.total_in_minor_units AS booked_total,x.created_at,
    (x.prepared_plan->>'moneyReceivedInMinorUnits')::BIGINT AS money_received,
    x.prepared_plan->>'differenceMethod' AS method
  FROM public.aftercare215_exchanges x
  JOIN public.aftercare215_exchange_results r ON r.operation_id=x.operation_id
  JOIN public.orders o ON o.id=r.new_order_id
  JOIN public.business_operations b ON b.id=o.operation_id
  WHERE (p_branch_id IS NULL OR o.branch_id=p_branch_id)
    AND (b.completed_at>=p_start AND b.completed_at<p_end OR x.created_at>=p_start AND x.created_at<p_end)
 ), by_day AS (
  SELECT (v.at AT TIME ZONE p_timezone)::DATE AS date,
    COALESCE(sum(v.booked_total),0)::BIGINT AS booked,
    COALESCE(sum(v.cash_in),0)::BIGINT AS cash,
    COALESCE(sum(v.cliq_in),0)::BIGINT AS cliq
  FROM exchange_rows x
  CROSS JOIN LATERAL (VALUES
    (x.completed_at,x.booked_total,0::BIGINT,0::BIGINT),
    (x.created_at,0::BIGINT,CASE WHEN x.method='cash' THEN x.money_received ELSE 0 END,
      CASE WHEN x.method='cliq' THEN x.money_received ELSE 0 END)
  ) v(at,booked_total,cash_in,cliq_in)
  WHERE v.at>=p_start AND v.at<p_end
  GROUP BY (v.at AT TIME ZONE p_timezone)::DATE
 )
 SELECT COALESCE(jsonb_agg(updated.value ORDER BY d.sequence),'[]'::JSONB) INTO days
 FROM jsonb_array_elements(result->'dailyBreakdown') WITH ORDINALITY d(value,sequence)
 LEFT JOIN by_day e ON e.date=(d.value->>'date')::DATE
 CROSS JOIN LATERAL (
  SELECT d.value||jsonb_build_object(
    'customerCollections', (d.value->'customerCollections')||jsonb_build_object(
      'otherInMinorUnits',(d.value#>>'{customerCollections,otherInMinorUnits}')::BIGINT-coalesce(e.booked,0),
      'totalInMinorUnits',(d.value#>>'{customerCollections,totalInMinorUnits}')::BIGINT-coalesce(e.booked,0)+coalesce(e.cash,0)+coalesce(e.cliq,0),
      'cashInMinorUnits',(d.value#>>'{customerCollections,cashInMinorUnits}')::BIGINT+coalesce(e.cash,0),
      'cliqInMinorUnits',(d.value#>>'{customerCollections,cliqInMinorUnits}')::BIGINT+coalesce(e.cliq,0)),
    'cashCollectedInMinorUnits',(d.value->>'cashCollectedInMinorUnits')::BIGINT+coalesce(e.cash,0),
    'cliqCollectedInMinorUnits',(d.value->>'cliqCollectedInMinorUnits')::BIGINT+coalesce(e.cliq,0)) AS value
 ) updated;
 RETURN jsonb_set(result,'{dailyBreakdown}',days);
END $function$;
ALTER FUNCTION public.report227_exchange_adjustment_internal(jsonb,uuid,timestamptz,timestamptz,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_exchange_adjustment_internal(jsonb,uuid,timestamptz,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
-- M01 calculation and authorization follow the 225 readers. Separate names preserve the frozen bodies.

CREATE FUNCTION public.report227_daily_facts_internal(p_branch_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_timezone text, p_verify_evidence boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_facts JSONB;
  v_damage JSONB;
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start OR NULLIF(BTRIM(p_timezone), '') IS NULL
  THEN
    RAISE EXCEPTION 'Invalid Phase 6 financial facts period.';
  END IF;

  -- Fail closed on corrupt evidence for the rows this period reports.
  IF p_verify_evidence THEN
    PERFORM public.phase42_assert_operational_return_evidence_internal(e.operation_id, true)
    FROM public.sales_return_events e
    JOIN public.orders o ON o.id = e.order_id
    JOIN public.business_operations creation ON creation.id = o.operation_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND creation.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.settled_at >= p_period_start AND e.settled_at < p_period_end;

    PERFORM public.phase43_assert_operational_replacement_evidence_internal(e.operation_id, true)
    FROM public.sales_replacement_events e
    JOIN public.orders o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND e.issued_at >= p_period_start AND e.issued_at < p_period_end;
  END IF;

  v_damage := public.inventory_damage_period_totals_internal(p_branch_id,p_period_start,p_period_end);
  WITH first_completion AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id
  ), completion_ops AS MATERIALIZED (
    SELECT DISTINCT ON (b.result_snapshot->>'order_id')
      b.result_snapshot->>'order_id' AS order_key,
      b.result_snapshot, b.completed_at, b.request_identity_snapshot
    FROM public.business_operations b
    WHERE b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = b.request_identity_snapshot->>'order_id'
    ORDER BY b.result_snapshot->>'order_id', b.completed_at, b.id
  ), order_scope AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.branch_id, o.status, o.payment_method, o.delivery_fee_in_minor_units, o.total_in_minor_units, o.source, o.created_at, o.amount_paid_in_minor_units, o.operation_id, fc.at AS completion_at, creation.operation_type,
      creation.result_snapshot AS creation_result, creation.completed_at AS creation_recorded_at,
      completion.result_snapshot AS completion_result,
      completion.completed_at AS completion_recorded_at,
      completion.request_identity_snapshot AS completion_request
    FROM public.orders o
    JOIN first_completion fc ON fc.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    LEFT JOIN completion_ops completion ON completion.order_key = o.id::TEXT
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
  ), modern_returns AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_return_events e JOIN order_scope o ON o.id = e.order_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND o.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), issued AS MATERIALIZED (
    SELECT e.*
    FROM public.sales_replacement_events e JOIN order_scope o ON o.id = e.root_order_id
    WHERE e.issuance_status = 'issued'
  ), return_rows AS (
    SELECT e.id, e.order_id, e.settled_at AS at,
      e.debt_reduction_amount_in_minor_units AS debt,
      e.money_refund_amount_in_minor_units AS refund, e.refund_method,
      e.debt_reduction_amount_in_minor_units + e.money_refund_amount_in_minor_units AS entitlement,
      COALESCE((SELECT SUM(f.historical_restock_value_in_minor_units_exact)
        FROM public.phase42_return_inventory_effects f WHERE f.return_event_id = e.id), 0) AS recovery
    FROM modern_returns e
    UNION ALL
    SELECT e.id, e.order_id, e.created_at, 0, e.refund_amount_in_minor_units, e.refund_method,
      e.refund_amount_in_minor_units,
      CASE WHEN e.stock_disposition = 'restock' THEN COALESCE((SELECT SUM(i.cogs_in_minor_units)
        FROM public.order_items i WHERE i.order_id = e.order_id), 0) ELSE 0 END
    FROM public.sales_returns e JOIN order_scope o ON o.id = e.order_id
    WHERE o.operation_type IS NULL OR o.operation_type NOT IN
      ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), initial_collections AS (
    SELECT o.id AS order_id,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_recorded_at
        ELSE COALESCE(o.completion_recorded_at, o.completion_at) END AS at,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN o.creation_result->>'paymentMethod'
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN o.completion_request->>'payment_method'
        WHEN o.payment_method = 'cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS method,
      CASE WHEN o.operation_type = 'phase3_pos_sale_v1' THEN (o.creation_result->>'amountPaidInMinorUnits')::BIGINT
        WHEN o.operation_type = 'phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(o.completion_result->>'customer_payment_number', '') IS NOT NULL THEN 0
            ELSE (o.completion_result->>'amount_paid_in_minor_units')::BIGINT END
        WHEN o.payment_method = 'debt' THEN 0 ELSE o.total_in_minor_units END AS amount
    FROM order_scope o
  ), money_events AS (
    SELECT order_id, at, method, amount AS collection, 0::BIGINT AS reversal, 0::BIGINT AS refund
    FROM initial_collections WHERE amount > 0
    UNION ALL
    SELECT p.order_id, p.created_at, p.payment_method, p.amount_in_minor_units, 0, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
    UNION ALL
    SELECT p.order_id, p.reversed_at, p.payment_method, 0, p.amount_in_minor_units, 0
    FROM public.customer_payments p JOIN public.orders o ON o.id = p.order_id
    WHERE p.is_reversed AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
    UNION ALL
    SELECT r.order_id, r.created_at, m.method, 0, m.amount, 0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id = r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash', (r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq', (r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method, amount)
    WHERE m.amount > 0
    UNION ALL
    SELECT order_id, at, refund_method, 0, 0, refund FROM return_rows WHERE refund > 0
    UNION ALL
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c JOIN public.customer_collection_cheque_allocations a ON a.operation_id=c.id
    JOIN public.cheque_compensation_claims k ON k.id=a.claim_id JOIN public.deferred_cheques q ON q.id=k.cheque_id
    WHERE c.is_reversed AND(p_branch_id IS NULL OR COALESCE(c.branch_id,q.branch_id)=p_branch_id)
    UNION ALL
    -- Opening allocation is not a customer_payment. The order allocation is
    -- already counted above and must never be added from collection totals.
    SELECT NULL::UUID,c.created_at,c.payment_method,a.amount_in_minor_units,0,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id
    UNION ALL
    SELECT NULL::UUID,c.reversed_at,c.payment_method,0,a.amount_in_minor_units,0
    FROM public.customer_collection_operations c
    JOIN public.customer_collection_opening_allocations a ON a.operation_id=c.id
    WHERE c.is_reversed AND (p_branch_id IS NULL OR COALESCE(c.branch_id,public.go_live_main_branch_internal())=p_branch_id)
  ), coverage_by_order AS (
    SELECT order_id, SUM(collection - reversal)::BIGINT AS coverage
    FROM money_events GROUP BY order_id
  ), debt_by_order AS (
    SELECT order_id, SUM(debt)::BIGINT AS debt_reduction
    FROM return_rows GROUP BY order_id
  ), positions AS (
    SELECT o.id, o.customer_id, o.status, o.total_in_minor_units,
      COALESCE(c.coverage, 0)::BIGINT AS coverage,
      COALESCE(d.debt_reduction, 0)::BIGINT AS debt_reduction,
      GREATEST(o.total_in_minor_units - COALESCE(c.coverage, 0) - COALESCE(d.debt_reduction, 0), 0)::BIGINT AS due
    FROM order_scope o
    LEFT JOIN coverage_by_order c ON c.order_id = o.id
    LEFT JOIN debt_by_order d ON d.order_id = o.id
  ), period_sales AS (
    SELECT * FROM order_scope WHERE status IN ('completed', 'returned')
      AND completion_at >= p_period_start AND completion_at < p_period_end
  ), sales_totals AS (
    SELECT COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross,
      COALESCE(SUM(delivery_fee_in_minor_units), 0)::BIGINT AS delivery,
      COUNT(*) AS count FROM period_sales
  ), period_returns AS (
    SELECT COALESCE(SUM(entitlement), 0)::BIGINT AS entitlement,
      COALESCE(SUM(refund), 0)::BIGINT AS refund, COALESCE(SUM(debt), 0)::BIGINT AS debt,
      ROUND(COALESCE(SUM(recovery), 0))::BIGINT AS recovery, COUNT(*) AS count
    FROM return_rows WHERE at >= p_period_start AND at < p_period_end
  ), costs AS (
    SELECT COALESCE(SUM(i.cogs_in_minor_units), 0)::BIGINT AS cogs
    FROM public.order_items i JOIN period_sales o ON o.id = i.order_id
  ), replacement_costs AS (
    SELECT COALESCE(SUM(f.replacement_cogs_snapshot_in_minor_units), 0)::BIGINT AS cost
    FROM issued e JOIN public.phase43_replacement_inventory_effects f ON f.operation_id = e.operation_id
    WHERE e.issued_at >= p_period_start AND e.issued_at < p_period_end
  ), flows AS (
    SELECT COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_received,
      COALESCE(SUM(collection - reversal) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='bank_transfer'),0)::BIGINT AS bank_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE method='cheque'),0)::BIGINT AS cheque_received,
      COALESCE(SUM(collection-reversal) FILTER(WHERE COALESCE(method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_received,
      COALESCE(SUM(collection-reversal),0)::BIGINT AS total_received,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= p_period_start AND at < p_period_end
  ), eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), canonical_order_due AS (
    -- Same set-based canonical positions used by192 aging/CRM;see parity guard.
    SELECT id, customer_id, outstanding AS due FROM financial_positions
  ), opening_due AS (
    -- Preserve164 main-branch attribution;do not clamp signed source values.
    SELECT opening.customer_id, opening.outstanding AS due
    FROM public.go_live_customer_opening_positions_internal(NULL) opening
    WHERE p_branch_id IS NULL OR p_branch_id = public.go_live_main_branch_internal()
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0 AND is_order) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM (
      SELECT true AS is_order, customer_id, due FROM canonical_order_due
      UNION ALL
      SELECT false, customer_id, due FROM opening_due
      UNION ALL
      SELECT false,c.customer_id,c.outstanding FROM public.cheque_customer_claim_positions_internal() c
      JOIN public.cheque_compensation_claims k ON k.id=c.id JOIN public.deferred_cheques q ON q.id=k.cheque_id
      WHERE p_branch_id IS NULL OR q.branch_id=p_branch_id
    ) receivables
  ), cohort AS (
    SELECT COALESCE(SUM(p.coverage), 0)::BIGINT AS coverage,
      COALESCE(SUM(p.due), 0)::BIGINT AS due
    FROM positions p JOIN period_sales o ON o.id = p.id
  ), expenses AS (
    SELECT COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS amount,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq,
      COUNT(*) AS count
    FROM public.operational_expenses
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND NOT COALESCE(is_reversed, false)
      AND created_at >= p_period_start AND created_at < p_period_end
  ), daily_collections AS (
    -- One period-local aggregation. Never rescan all money events twice for
    -- every date in the month; collection/reversal equations are unchanged.
    SELECT (m.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cash'),0)::BIGINT AS cash_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cliq'),0)::BIGINT AS cliq_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='bank_transfer'),0)::BIGINT AS bank_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE m.method='cheque'),0)::BIGINT AS cheque_collected,
      COALESCE(SUM(m.collection-m.reversal) FILTER(WHERE COALESCE(m.method,'') NOT IN ('cash','cliq','bank_transfer','cheque')),0)::BIGINT AS other_collected,
      COALESCE(SUM(m.collection-m.reversal),0)::BIGINT AS total_collected
    FROM money_events m WHERE m.at>=p_period_start AND m.at<p_period_end
    GROUP BY (m.at AT TIME ZONE p_timezone)::DATE
  ), daily_sales AS MATERIALIZED (
    SELECT (o.completion_at AT TIME ZONE p_timezone)::DATE AS day,
      SUM(o.total_in_minor_units)::BIGINT AS gross, COUNT(*)::BIGINT AS count
    FROM period_sales o
    GROUP BY (o.completion_at AT TIME ZONE p_timezone)::DATE
  ), daily_returns AS MATERIALIZED (
    SELECT (r.at AT TIME ZONE p_timezone)::DATE AS day,
      SUM(r.entitlement)::BIGINT AS returned
    FROM return_rows r
    WHERE r.at >= p_period_start AND r.at < p_period_end
    GROUP BY (r.at AT TIME ZONE p_timezone)::DATE
  ), days AS (
    SELECT day::DATE AS day FROM generate_series((p_period_start AT TIME ZONE p_timezone)::DATE,
      (p_period_end AT TIME ZONE p_timezone)::DATE - 1, INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE(ds.gross,0)::BIGINT AS gross,
      COALESCE(ds.count,0)::BIGINT AS count,
      COALESCE(dr.returned,0)::BIGINT AS returned,
      COALESCE(dc.cash_collected,0)::BIGINT AS cash_collected,
      COALESCE(dc.cliq_collected,0)::BIGINT AS cliq_collected,
      COALESCE(dc.bank_collected,0)::BIGINT AS bank_collected,
      COALESCE(dc.cheque_collected,0)::BIGINT AS cheque_collected,
      COALESCE(dc.other_collected,0)::BIGINT AS other_collected,
      COALESCE(dc.total_collected,0)::BIGINT AS total_collected
    FROM days d
    LEFT JOIN daily_sales ds ON ds.day=d.day
    LEFT JOIN daily_returns dr ON dr.day=d.day
    LEFT JOIN daily_collections dc ON dc.day=d.day
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'cogsInMinorUnits', c.cogs, 'replacementCostInMinorUnits', rc.cost,
      'restockRecoveryInMinorUnits', r.recovery, 'grossProfitInMinorUnits', s.gross - s.delivery - c.cogs,
      'aftercareAdjustedMarginInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery,
      'netProfitInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery - x.amount
        - (v_damage->>'additionalInMinorUnits')::BIGINT,
      'damageLosses',v_damage,
      'collectedInMinorUnits', co.coverage, 'outstandingInMinorUnits', co.due, 'returnCount', r.count,
      'orderCount', s.count, 'completedOrderCount', s.count),
    'cashFlow', jsonb_build_object('customerCollections',jsonb_build_object(
      'cashInMinorUnits',f.cash_received,'cliqInMinorUnits',f.cliq_received,
      'bankTransferInMinorUnits',f.bank_received,'chequeInMinorUnits',f.cheque_received,
      'otherInMinorUnits',f.other_received,'totalInMinorUnits',f.total_received),
      'cashCollectedInMinorUnits', f.cash_received,
      'cliqCollectedInMinorUnits', f.cliq_received, 'cashRefundedInMinorUnits', f.cash_refunded,
      'cliqRefundedInMinorUnits', f.cliq_refunded, 'cashNetFlowInMinorUnits', f.cash_received - f.cash_refunded,
      'cliqNetFlowInMinorUnits', f.cliq_received - f.cliq_refunded),
    'balances', jsonb_build_object('customerDueInMinorUnits', b.due, 'customerOrderCount', b.orders,
      'customerCount', b.customers),
    'expenses', jsonb_build_object('totalInMinorUnits', x.amount, 'cashInMinorUnits', x.cash,
      'cliqInMinorUnits', x.cliq, 'count', x.count),
    'dailyBreakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day,
      'completedOrderCount', count, 'grossSalesInMinorUnits', gross,
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned,
      'cashCollectedInMinorUnits',cash_collected,'cliqCollectedInMinorUnits',cliq_collected,
      'customerCollections',jsonb_build_object('cashInMinorUnits',cash_collected,'cliqInMinorUnits',cliq_collected,
        'bankTransferInMinorUnits',bank_collected,'chequeInMinorUnits',cheque_collected,
        'otherInMinorUnits',other_collected,'totalInMinorUnits',total_collected))
      ORDER BY day), '[]'::JSONB) FROM daily)
  ) INTO v_facts
  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c
    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b
    CROSS JOIN cohort co CROSS JOIN expenses x;

  RETURN v_facts;
END;
$function$;
ALTER FUNCTION public.report227_daily_facts_internal(uuid,timestamptz,timestamptz,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_daily_facts_internal(uuid,timestamptz,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.report227_damage_facts_internal(p_branch_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_timezone text, p_verify_evidence boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE facts JSONB; old_damage JSONB; damage JSONB; reasons JSONB; delta BIGINT; gross BIGINT; recovered BIGINT;
BEGIN
 facts:=public.report227_daily_facts_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
 old_damage:=facts->'sales'->'damageLosses';
 IF p_verify_evidence THEN
  PERFORM public.sr208_assert_operation_internal(x.operation_id) FROM(
   SELECT DISTINCT e.operation_id FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
   WHERE (p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end
   UNION SELECT c.operation_id FROM public.supplier_replacement_cases c
   WHERE(p_branch_id IS NULL OR c.branch_id=p_branch_id) AND c.occurred_at>=p_period_start AND c.occurred_at<p_period_end) x;
 END IF;
 SELECT COALESCE(sum(e.expense_delta_in_minor_units),0),COALESCE(sum(GREATEST(e.expense_delta_in_minor_units,0)),0),COALESCE(-sum(LEAST(e.expense_delta_in_minor_units,0)),0)
 INTO delta,gross,recovered FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
 WHERE (p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end;
 WITH rows AS(
  SELECT CASE WHEN e.action='writeoff' THEN 'supplier_writeoff'
   WHEN e.action='send' THEN 'customer_return_supplier_hold'
   WHEN original.action='writeoff' THEN 'supplier_writeoff_reversal'
   WHEN original.action='damage' THEN 'shop_damage_reversal' ELSE 'customer_return_supplier_hold_reversal' END code,
   e.quantity,e.expense_delta_in_minor_units amount
  FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
  LEFT JOIN public.supplier_replacement_events original ON original.id=e.reverses_event_id
  WHERE(p_branch_id IS NULL OR c.branch_id=p_branch_id) AND e.occurred_at>=p_period_start AND e.occurred_at<p_period_end
   AND(e.expense_delta_in_minor_units<>0 OR e.action='writeoff')
 ), grouped AS(SELECT code,count(*) count,sum(quantity) quantity,sum(amount) amount,sum(GREATEST(amount,0)) gross,-sum(LEAST(amount,0)) recovered FROM rows GROUP BY code)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'count',count,'quantity',quantity,'amountInMinorUnits',amount,'alreadyIncludedInMinorUnits',0,
  'grossInMinorUnits',g.gross,'recoveredInMinorUnits',g.recovered) ORDER BY code),'[]') INTO reasons FROM grouped g;
 SELECT COALESCE(jsonb_agg(x||jsonb_build_object('grossInMinorUnits',(x->>'amountInMinorUnits')::BIGINT,'recoveredInMinorUnits',0)),'[]')||reasons
 INTO reasons FROM jsonb_array_elements(old_damage->'reasons') x;
 damage:=jsonb_build_object('contractVersion',208,'grossInMinorUnits',(old_damage->>'totalInMinorUnits')::BIGINT+gross,'recoveredInMinorUnits',recovered,
  'totalInMinorUnits',(old_damage->>'totalInMinorUnits')::BIGINT+delta,'additionalInMinorUnits',(old_damage->>'additionalInMinorUnits')::BIGINT+delta,
  'alreadyIncludedInMinorUnits',(old_damage->>'alreadyIncludedInMinorUnits')::BIGINT,'reasons',reasons);
 facts:=jsonb_set(facts,'{sales,damageLosses}',damage);
 facts:=jsonb_set(facts,'{sales,netProfitInMinorUnits}',to_jsonb((facts->'sales'->>'netProfitInMinorUnits')::BIGINT-delta));
 RETURN facts;
END $function$;
ALTER FUNCTION public.report227_damage_facts_internal(uuid,timestamptz,timestamptz,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_damage_facts_internal(uuid,timestamptz,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.report227_aftercare_facts_internal(p_branch_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_timezone text, p_verify_evidence boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE facts JSONB; recovery BIGINT; k TEXT;
BEGIN
 facts:=public.report227_damage_facts_internal(p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
 IF p_verify_evidence THEN PERFORM public.tb215_assert_inspection_internal(i.operation_id) FROM public.aftercare215_inspections i
  JOIN public.orders o ON o.id=i.order_id WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end;
  PERFORM public.tb215_assert_return_internal(c.operation_id) FROM public.aftercare215_return_contexts c
   JOIN public.orders o ON o.id=c.order_id
   WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND c.created_at>=p_period_start AND c.created_at<p_period_end;
 END IF;
 SELECT COALESCE(sum(i.good_recovery_in_minor_units),0)::BIGINT INTO recovery FROM public.aftercare215_inspections i JOIN public.orders o ON o.id=i.order_id
  WHERE(p_branch_id IS NULL OR o.branch_id=p_branch_id) AND i.created_at>=p_period_start AND i.created_at<p_period_end;
 FOREACH k IN ARRAY ARRAY['restockRecoveryInMinorUnits','aftercareAdjustedMarginInMinorUnits','netProfitInMinorUnits'] LOOP
  facts:=jsonb_set(facts,ARRAY['sales',k],to_jsonb((facts->'sales'->>k)::BIGINT+recovery));
 END LOOP;
 facts:=public.report227_exchange_adjustment_internal(facts,p_branch_id,p_period_start,p_period_end,p_timezone,p_verify_evidence);
 RETURN public.tb215_damage_loss_presentation_internal(facts,p_branch_id,p_period_start,p_period_end);
END $function$;
ALTER FUNCTION public.report227_aftercare_facts_internal(uuid,timestamptz,timestamptz,text,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_aftercare_facts_internal(uuid,timestamptz,timestamptz,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.report227_base_internal(p_branch_id uuid, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report JSONB;
  v_facts JSONB;
BEGIN
  -- The inner reader authorizes the caller and validates the period first.
  v_report := public._get_operational_business_report_before_phase6(p_branch_id, p_date_from, p_date_to);
  v_facts := public.report227_aftercare_facts_internal(
    p_branch_id,
    p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    'Asia/Amman',
    false
  );
  v_report := jsonb_set(v_report, '{sales}', (v_report->'sales') || (v_facts->'sales'));
  v_report := jsonb_set(v_report, '{balances}', (v_report->'balances') || (v_facts->'balances'));
  v_report := jsonb_set(v_report, '{expenses}', (v_report->'expenses') || (v_facts->'expenses'));
  RETURN v_report || jsonb_build_object('cashFlow', v_facts->'cashFlow');
END;
$function$;
ALTER FUNCTION public.report227_base_internal(uuid,date,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_base_internal(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_operational_business_report227(p_branch_id uuid, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_totals JSONB;
  v_profit BIGINT;
BEGIN
  -- Preserve sales-only and mixed-period semantics at the existing RPC.
  IF sales_lite1.enabled() OR sales_lite2.period_has_uncosted(
    p_branch_id, p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman')
  THEN
    RETURN public.lite1_reporting_report2(p_branch_id,p_date_from,p_date_to);
  END IF;
  v_result := public.report227_base_internal(p_branch_id, p_date_from, p_date_to);
  v_result := jsonb_set(v_result, '{balances}', (v_result->'balances') || public.phase133_supplier_balances_internal());
  IF public.has_erp_role(ARRAY['owner']) THEN
    v_totals := public.owner_withdrawal_period_totals_internal(
      p_branch_id,
      p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',
      (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman');
    v_profit := COALESCE((v_result #>> '{sales,netProfitInMinorUnits}')::BIGINT, 0);
    v_result := v_result || jsonb_build_object('ownerWithdrawals', v_totals || jsonb_build_object(
      'netProfitInMinorUnits', v_profit,
      'remainingAfterWithdrawalsInMinorUnits', v_profit - (v_totals->>'netInMinorUnits')::BIGINT));
  END IF;
  RETURN v_result;
END;
$function$;
ALTER FUNCTION public.get_operational_business_report227(uuid,date,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_operational_business_report227(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report227(uuid,date,date) TO authenticated;

COMMIT;
