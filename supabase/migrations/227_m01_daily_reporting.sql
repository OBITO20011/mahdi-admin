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
      b.completed_at,
      b.request_identity_snapshot->>'payment_method' AS payment_method,
      b.result_snapshot->>'customer_payment_number' AS payment_number,
      b.result_snapshot->>'amount_paid_in_minor_units' AS amount_paid
    FROM public.business_operations b
    WHERE b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = b.request_identity_snapshot->>'order_id'
    ORDER BY b.result_snapshot->>'order_id', b.completed_at, b.id
  ), order_scope AS MATERIALIZED (
    -- Project snapshot scalars before the materialized relation and its joins.
    SELECT o.id, o.status, o.delivery_fee_in_minor_units, o.total_in_minor_units,
      fc.at AS completion_at, creation.operation_type,
      CASE WHEN creation.operation_type = 'phase3_pos_sale_v1' THEN creation.completed_at
        ELSE COALESCE(completion.completed_at, fc.at) END AS collection_at,
      CASE WHEN creation.operation_type = 'phase3_pos_sale_v1' THEN creation.result_snapshot->>'paymentMethod'
        WHEN creation.operation_type = 'phase3_customer_reservation_v1' THEN completion.payment_method
        WHEN o.payment_method = 'cash_on_delivery' THEN 'cash' ELSE o.payment_method END AS collection_method,
      CASE WHEN creation.operation_type = 'phase3_pos_sale_v1' THEN creation.result_snapshot->>'amountPaidInMinorUnits'
        WHEN creation.operation_type = 'phase3_customer_reservation_v1' THEN
          CASE WHEN NULLIF(completion.payment_number, '') IS NOT NULL THEN '0' ELSE completion.amount_paid END
        WHEN o.payment_method = 'debt' THEN '0' ELSE o.total_in_minor_units::TEXT END AS collection_amount
    FROM public.orders o
    JOIN first_completion fc ON fc.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
    LEFT JOIN completion_ops completion ON completion.order_key = o.id::TEXT
    WHERE p_branch_id IS NULL OR o.branch_id = p_branch_id
  ), modern_returns AS MATERIALIZED (
    SELECT e.order_id, e.id, e.settled_at, e.debt_reduction_amount_in_minor_units,
      e.money_refund_amount_in_minor_units, e.refund_method
    FROM public.sales_return_events e JOIN order_scope o ON o.id = e.order_id
    WHERE e.contract_version = 401 AND e.settlement_status = 'settled'
      AND o.operation_type IN ('phase3_pos_sale_v1', 'phase3_customer_reservation_v1')
  ), issued AS MATERIALIZED (
    SELECT e.operation_id, e.issued_at
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
    SELECT id AS order_id, collection_at AS at, collection_method AS method, collection_amount::BIGINT AS amount
    FROM order_scope
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
    SELECT o.id, COALESCE(c.coverage, 0)::BIGINT AS coverage,
      GREATEST(o.total_in_minor_units - COALESCE(c.coverage, 0) - COALESCE(d.debt_reduction, 0), 0)::BIGINT AS due
    FROM order_scope o
    LEFT JOIN coverage_by_order c ON c.order_id = o.id
    LEFT JOIN debt_by_order d ON d.order_id = o.id
  ), period_sales AS (
    SELECT id, completion_at, total_in_minor_units, delivery_fee_in_minor_units
    FROM order_scope WHERE status IN ('completed', 'returned')
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

CREATE FUNCTION public.report227_invoice_summary_internal(p_branch_id uuid, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_report JSONB;
  v_movement_summary JSONB;
  v_registered_discount BIGINT;
  v_allocated_discount BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض التقارير المالية والتشغيلية'
  );

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'الفرع مطلوب لإنشاء التقرير.';
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'تاريخ بداية ونهاية التقرير مطلوبان.';
  END IF;

  IF p_date_to < p_date_from THEN
    RAISE EXCEPTION 'تاريخ نهاية التقرير يجب ألا يسبق تاريخ البداية.';
  END IF;

  IF p_date_to - p_date_from > 366 THEN
    RAISE EXCEPTION 'الفترة القصوى للتقرير هي 367 يوماً.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches WHERE id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'الفرع المطلوب غير موجود.';
  END IF;

  v_period_start := p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_period_end := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';

  -- A status event admits each order once. The old three readers projected
  -- different subsets of the same completed orders and invoice snapshots.
  WITH completed_ids AS (
    SELECT h.order_id
    FROM public.order_status_history h
    JOIN public.orders o ON o.id = h.order_id
    WHERE o.branch_id = p_branch_id AND h.new_status = 'completed'
      AND h.created_at >= v_period_start AND h.created_at < v_period_end
    GROUP BY h.order_id
  ), completed_orders AS MATERIALIZED (
    SELECT o.id, o.source, o.subtotal_in_minor_units,
      COALESCE(o.discount_in_minor_units, 0)::BIGINT AS discount,
      o.total_in_minor_units, COALESCE(o.payment_method, 'unknown') AS payment_method
    FROM completed_ids c JOIN public.orders o ON o.id = c.order_id
    WHERE o.status IN ('completed', 'returned')
  ), invoice_lines AS MATERIALIZED (
    SELECT o.id AS order_id, o.discount, i.id, i.created_at, i.product_id,
      COALESCE(i.product_name_snapshot, 'منتج') AS product_name,
      COALESCE(i.sku_snapshot, '') AS sku,
      COALESCE(i.line_total_in_minor_units, 0)::BIGINT AS line_total,
      COALESCE(i.cogs_in_minor_units, 0)::BIGINT AS cogs,
      CASE
        WHEN i.commercial_line_kind = 'configurable_parcel' THEN
          public.phase35_report_package_count_internal(i.id, i.commercial_line_kind, i.sale_package_quantity, i.units_per_sale_package)
        WHEN i.commercial_line_kind = 'legacy_single_sku_parcel' THEN COALESCE(i.sale_package_quantity, 0)::BIGINT
        WHEN i.commercial_line_kind IS NULL AND i.sale_package_quantity IS NOT NULL
          AND i.units_per_sale_package > 0 THEN i.sale_package_quantity::BIGINT
        ELSE 0::BIGINT
      END AS packages,
      CASE WHEN i.commercial_line_kind = 'configurable_parcel' THEN
        public.phase35_report_base_unit_count_internal(i.id, i.commercial_line_kind, i.quantity)
        ELSE COALESCE(i.quantity, 0)::BIGINT END AS base_units
    FROM completed_orders o JOIN public.order_items i ON i.order_id = o.id
  ), discount_basis AS (
    -- The largest sorts use only the identifiers and amounts used by the
    -- original integer allocation. Zero/negative discounts allocate nothing.
    SELECT id, order_id, discount,
      ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at NULLS LAST, id) AS allocation_rank,
      line_total,
      SUM(line_total) OVER (PARTITION BY order_id)::BIGINT AS lines_subtotal
    FROM invoice_lines WHERE discount > 0
  ), discount_shares AS (
    SELECT id, order_id, discount, allocation_rank,
      CASE WHEN lines_subtotal > 0 THEN (discount * line_total) / lines_subtotal ELSE 0 END::BIGINT AS base_discount
    FROM discount_basis
  ), discounts AS (
    SELECT id, base_discount + CASE
      WHEN allocation_rank <= discount - SUM(base_discount) OVER (PARTITION BY order_id) THEN 1 ELSE 0
    END AS allocated
    FROM discount_shares
  ), order_totals AS (
    SELECT COUNT(*) FILTER (WHERE COALESCE(source, '') = 'pos')::INTEGER AS pos_count,
      COUNT(*) FILTER (WHERE COALESCE(source, '') <> 'pos')::INTEGER AS website_count,
      COALESCE(SUM(subtotal_in_minor_units), 0)::BIGINT AS subtotal,
      COALESCE(SUM(discount), 0)::BIGINT AS discounts
    FROM completed_orders
  ), item_totals AS (
    SELECT COALESCE(SUM(packages), 0)::BIGINT AS packages,
      COALESCE(SUM(base_units), 0)::BIGINT AS base_units,
      COUNT(DISTINCT product_id)::INTEGER AS products
    FROM invoice_lines
  ), best_products AS (
    SELECT product_name, sku, SUM(packages)::BIGINT AS packages,
      SUM(line_total - COALESCE(d.allocated, 0))::BIGINT AS revenue,
      SUM(line_total - COALESCE(d.allocated, 0) - cogs)::BIGINT AS profit
    FROM invoice_lines l LEFT JOIN discounts d ON d.id = l.id
    GROUP BY product_name, sku
    ORDER BY revenue DESC, product_name
    LIMIT 10
  ), payment_methods AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'method', payment_method, 'orderCount', order_count, 'amountInMinorUnits', amount
    ) ORDER BY amount DESC, payment_method), '[]'::JSONB) AS payload
    FROM (
      SELECT payment_method, COUNT(*)::INTEGER AS order_count,
        COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS amount
      FROM completed_orders GROUP BY payment_method
    ) grouped_methods
  ), expense_categories AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'category', category, 'count', expense_count, 'amountInMinorUnits', amount
    ) ORDER BY amount DESC, category), '[]'::JSONB) AS payload
    FROM (
      SELECT category, COUNT(*)::INTEGER AS expense_count, SUM(amount_in_minor_units)::BIGINT AS amount
      FROM public.operational_expenses
      WHERE branch_id = p_branch_id AND NOT COALESCE(is_reversed, false)
        AND created_at >= v_period_start AND created_at < v_period_end
      GROUP BY category
    ) grouped_categories
  ), period_purchases AS (
    SELECT COUNT(*)::INTEGER AS receipt_count,
      COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS total_purchases,
      COALESCE(SUM(amount_paid_in_minor_units), 0)::BIGINT AS amount_paid,
      COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS amount_due
    FROM public.supplier_receipts
    WHERE branch_id = p_branch_id AND status = 'completed'
      AND received_at >= v_period_start AND received_at < v_period_end
  ), current_inventory AS (
    SELECT COUNT(*) FILTER (WHERE ib.on_hand_quantity > 0)::INTEGER AS stocked_products,
      COALESCE(SUM(ib.on_hand_quantity), 0)::BIGINT AS base_units_on_hand,
      COALESCE(SUM(ib.reserved_quantity), 0)::BIGINT AS base_units_reserved,
      COALESCE(SUM(ib.on_hand_quantity::NUMERIC * COALESCE(p.wac_cost_in_minor_units_exact,
        p.cost_price_in_minor_units::NUMERIC)), 0)::BIGINT AS inventory_value,
      COUNT(*) FILTER (WHERE p.is_active AND ib.available_quantity <= p.min_stock_level)::INTEGER AS low_stock_products
    FROM public.inventory_balances ib
    JOIN public.warehouses w ON w.id = ib.warehouse_id
    JOIN public.products p ON p.id = ib.product_id
    WHERE w.branch_id = p_branch_id
  )
  SELECT o.discounts, COALESCE((SELECT SUM(allocated) FROM discounts), 0)::BIGINT,
    jsonb_build_object(
      'success', true, 'generatedAt', NOW(),
      'period', jsonb_build_object('dateFrom', p_date_from, 'dateTo', p_date_to, 'branchId', p_branch_id,
        'branchName', (SELECT name_ar FROM public.branches WHERE id = p_branch_id)),
      'sales', jsonb_build_object('posOrderCount', o.pos_count, 'websiteOrderCount', o.website_count,
        'packageCount', i.packages, 'baseUnitCount', i.base_units, 'uniqueProductCount', i.products,
        'subtotalInMinorUnits', o.subtotal, 'discountInMinorUnits', o.discounts),
      'expenses', jsonb_build_object('categories', e.payload),
      'purchases', jsonb_build_object('receiptCount', p.receipt_count, 'totalInMinorUnits', p.total_purchases,
        'paidInMinorUnits', p.amount_paid, 'dueInMinorUnits', p.amount_due),
      'balances', '{}'::JSONB,
      'inventory', jsonb_build_object('stockedProducts', s.stocked_products, 'baseUnitsOnHand', s.base_units_on_hand,
        'baseUnitsReserved', s.base_units_reserved, 'valueInMinorUnits', s.inventory_value,
        'lowStockProducts', s.low_stock_products),
      'paymentMethods', m.payload,
      'topProducts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('productName', product_name,
        'sku', sku, 'packageCount', packages, 'revenueInMinorUnits', revenue, 'profitInMinorUnits', profit)
        ORDER BY revenue DESC, product_name), '[]'::JSONB) FROM best_products)
    )
  INTO v_registered_discount, v_allocated_discount, v_report
  FROM order_totals o CROSS JOIN item_totals i CROSS JOIN expense_categories e
  CROSS JOIN period_purchases p CROSS JOIN current_inventory s CROSS JOIN payment_methods m;

  IF v_allocated_discount <> v_registered_discount THEN
    RAISE EXCEPTION 'تعذر توزيع خصومات التقرير بدقة؛ راجع سلامة إجماليات أصناف الطلبات.';
  END IF;

  WITH by_product_type AS MATERIALIZED (
    -- Collapse movements before the product joins and report sorts.
    SELECT im.product_id, im.movement_type, COUNT(*)::INTEGER AS movement_count,
      COALESCE(SUM(im.quantity) FILTER (WHERE im.quantity > 0), 0)::BIGINT AS units_in,
      COALESCE(SUM(ABS(im.quantity)) FILTER (WHERE im.quantity < 0), 0)::BIGINT AS units_out,
      COALESCE(SUM(im.quantity), 0)::BIGINT AS net_units
    FROM public.inventory_movements im
    JOIN public.warehouses w ON w.id = im.warehouse_id
    WHERE w.branch_id = p_branch_id AND im.created_at >= v_period_start AND im.created_at < v_period_end
    GROUP BY im.product_id, im.movement_type
  ), branch_movements AS MATERIALIZED (
    SELECT m.*, p.name_ar AS product_name, COALESCE(p.sku, '') AS sku
    FROM by_product_type m JOIN public.products p ON p.id = m.product_id
  ), by_type AS (
    SELECT movement_type, SUM(movement_count)::INTEGER AS movement_count,
      SUM(units_in)::BIGINT AS units_in, SUM(units_out)::BIGINT AS units_out, SUM(net_units)::BIGINT AS net_units
    FROM branch_movements GROUP BY movement_type
  ), by_product AS MATERIALIZED (
    SELECT product_id, product_name, sku, SUM(movement_count)::INTEGER AS movement_count,
      SUM(units_in)::BIGINT AS units_in, SUM(units_out)::BIGINT AS units_out, SUM(net_units)::BIGINT AS net_units
    FROM branch_movements GROUP BY product_id, product_name, sku
  ), best_moved AS (
    SELECT *, units_in + units_out AS activity_units
    FROM by_product ORDER BY activity_units DESC, product_name LIMIT 10
  )
  SELECT jsonb_build_object(
    'movementCount', COALESCE(SUM(movement_count), 0)::INTEGER,
    'affectedProducts', COUNT(*)::INTEGER,
    'unitsIn', COALESCE(SUM(units_in), 0)::BIGINT, 'unitsOut', COALESCE(SUM(units_out), 0)::BIGINT,
    'netUnits', COALESCE(SUM(net_units), 0)::BIGINT,
    'types', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'movementType', movement_type, 'movementCount', movement_count, 'unitsIn', units_in,
      'unitsOut', units_out, 'netUnits', net_units) ORDER BY movement_count DESC, movement_type), '[]'::JSONB) FROM by_type),
    'topProducts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'productName', product_name, 'sku', sku, 'movementCount', movement_count, 'unitsIn', units_in,
      'unitsOut', units_out, 'netUnits', net_units) ORDER BY activity_units DESC, product_name), '[]'::JSONB) FROM best_moved)
  )
  INTO v_movement_summary FROM by_product;

  RETURN v_report || jsonb_build_object('inventoryMovements', v_movement_summary);
END;
$function$;
ALTER FUNCTION public.report227_invoice_summary_internal(uuid,date,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.report227_invoice_summary_internal(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;


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
  v_report := public.report227_invoice_summary_internal(p_branch_id, p_date_from, p_date_to);
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
