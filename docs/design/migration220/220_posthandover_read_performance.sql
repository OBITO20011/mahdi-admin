-- QUARANTINED POST-GO-LIVE DRAFT. Not in supabase/migrations. No owner apply command.
-- Explicit local runner only; active catalog/history/tools remain219.
DO $guard$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>180 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'219' THEN RAISE EXCEPTION 'DRAFT220_REQUIRES_EXACT_219_HISTORY'; END IF;
 IF md5(pg_get_functiondef('public.phase6_financial_facts_before208_internal(uuid,timestamptz,timestamptz,text,boolean)'::regprocedure))<>'29c2e767ec0df7de11d0947811028d77' OR md5(pg_get_functiondef('public.get_supplier_replacements_page_v1(uuid,uuid,text,integer,integer)'::regprocedure))<>'e1893a4692cd517e117d692eccf00355' OR md5(pg_get_functiondef('public._get_operational_business_report_before_phase6(uuid,date,date)'::regprocedure))<>'25e0d690fafbd2c1113d8ea330e48137' OR md5(pg_get_functiondef('public._get_operational_business_report_v1(uuid,date,date)'::regprocedure))<>'25f5703530e8f4e2035469589b481528' THEN RAISE EXCEPTION 'DRAFT220_REQUIRES_REVIEWED_219_READERS'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.phase6_financial_facts_before208_internal(p_branch_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_timezone text, p_verify_evidence boolean)
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
        - COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding
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
  ), daily_sales_grouped AS (
    SELECT (o.completion_at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(o.total_in_minor_units),0)::BIGINT AS gross, COUNT(*)::BIGINT AS count
    FROM period_sales o GROUP BY (o.completion_at AT TIME ZONE p_timezone)::DATE
  ), daily_returns_grouped AS (
    SELECT (r.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(r.entitlement),0)::BIGINT AS returned
    FROM return_rows r WHERE r.at>=p_period_start AND r.at<p_period_end
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
    FROM days d LEFT JOIN daily_collections dc ON dc.day=d.day
      LEFT JOIN daily_sales_grouped ds ON ds.day=d.day
      LEFT JOIN daily_returns_grouped dr ON dr.day=d.day
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

-- Literal expansion of119 quantity functions only; caller/default memory unchanged.
CREATE OR REPLACE FUNCTION public._get_operational_business_report_v1(p_branch_id uuid, p_date_from date, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_report JSONB;
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

  WITH completion_events AS (
    SELECT DISTINCT ON (osh.order_id)
      osh.order_id,
      osh.created_at AS completed_at
    FROM public.order_status_history osh
    JOIN public.orders o ON o.id = osh.order_id
    WHERE osh.new_status = 'completed'
      AND o.branch_id = p_branch_id
      AND osh.created_at >= v_period_start
      AND osh.created_at < v_period_end
    ORDER BY osh.order_id, osh.created_at
  ),
  completed_orders AS (
    SELECT o.*, ce.completed_at
    FROM completion_events ce
    JOIN public.orders o ON o.id = ce.order_id
    WHERE o.status IN ('completed', 'returned')
  ),
  order_sales AS (
    SELECT
      COUNT(*)::INTEGER AS order_count,
      COUNT(*) FILTER (WHERE COALESCE(source, '') = 'pos')::INTEGER
        AS pos_order_count,
      COUNT(*) FILTER (WHERE COALESCE(source, '') <> 'pos')::INTEGER
        AS website_order_count,
      COALESCE(SUM(subtotal_in_minor_units), 0)::BIGINT AS subtotal,
      COALESCE(SUM(discount_in_minor_units), 0)::BIGINT AS discounts,
      COALESCE(SUM(delivery_fee_in_minor_units), 0)::BIGINT AS delivery_fees,
      COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross_sales,
      COALESCE(SUM(amount_paid_in_minor_units), 0)::BIGINT AS collected,
      COALESCE(SUM(
        GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0)
      ), 0)::BIGINT AS outstanding
    FROM completed_orders
  ),
  item_sales AS (
    SELECT
      COALESCE(SUM(oi.cogs_in_minor_units), 0)::BIGINT AS cogs,
      COALESCE(SUM(oi.profit_in_minor_units), 0)::BIGINT AS gross_profit,
      COALESCE(SUM(
        (CASE
    WHEN oi.commercial_line_kind = 'base_unit' THEN 0::BIGINT
    WHEN oi.commercial_line_kind = 'configurable_parcel' THEN (
      SELECT COUNT(*)::BIGINT
      FROM public.order_parcel_instances instance
      WHERE instance.order_item_id = oi.id
    )
    WHEN oi.commercial_line_kind = 'legacy_single_sku_parcel' THEN
      COALESCE(oi.sale_package_quantity, 0)::BIGINT
    WHEN oi.commercial_line_kind IS NULL
      AND oi.sale_package_quantity IS NOT NULL
      AND oi.units_per_sale_package IS NOT NULL
      AND oi.units_per_sale_package > 0
    THEN oi.sale_package_quantity::BIGINT
    ELSE 0::BIGINT
  END)
      ), 0)::BIGINT AS package_count,
      COALESCE(SUM((CASE
    WHEN oi.commercial_line_kind = 'configurable_parcel' THEN COALESCE((
      SELECT SUM(component.base_quantity)::BIGINT
      FROM public.order_parcel_instances instance
      JOIN public.order_parcel_components component
        ON component.parcel_instance_id = instance.id
      WHERE instance.order_item_id = oi.id
    ), 0::BIGINT)
    ELSE COALESCE(oi.quantity, 0)::BIGINT
  END)), 0)::BIGINT AS base_unit_count,
      COUNT(DISTINCT oi.product_id)::INTEGER AS unique_product_count
    FROM completed_orders co
    JOIN public.order_items oi ON oi.order_id = co.id
  ),
  period_returns AS (
    SELECT
      COUNT(*)::INTEGER AS return_count,
      COALESCE(SUM(sr.refund_amount_in_minor_units), 0)::BIGINT
        AS refund_amount,
      COALESCE((
        SELECT SUM(oi.cogs_in_minor_units)
        FROM public.sales_returns restocked_return
        JOIN public.order_items oi
          ON oi.order_id = restocked_return.order_id
        WHERE restocked_return.branch_id = p_branch_id
          AND restocked_return.stock_disposition = 'restock'
          AND restocked_return.created_at >= v_period_start
          AND restocked_return.created_at < v_period_end
      ), 0)::BIGINT AS recovered_cogs
    FROM public.sales_returns sr
    WHERE sr.branch_id = p_branch_id
      AND sr.created_at >= v_period_start
      AND sr.created_at < v_period_end
  ),
  period_expenses AS (
    SELECT
      COUNT(*)::INTEGER AS expense_count,
      COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS total_expenses,
      COALESCE(SUM(amount_in_minor_units)
        FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash_expenses,
      COALESCE(SUM(amount_in_minor_units)
        FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq_expenses
    FROM public.operational_expenses
    WHERE branch_id = p_branch_id
      AND created_at >= v_period_start
      AND created_at < v_period_end
  ),
  period_purchases AS (
    SELECT
      COUNT(*)::INTEGER AS receipt_count,
      COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS total_purchases,
      COALESCE(SUM(amount_paid_in_minor_units), 0)::BIGINT AS amount_paid,
      COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS amount_due
    FROM public.supplier_receipts
    WHERE branch_id = p_branch_id
      AND status = 'completed'
      AND received_at >= v_period_start
      AND received_at < v_period_end
  ),
  current_receivables AS (
    SELECT
      COUNT(*) FILTER (
        WHERE GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0) > 0
      )::INTEGER AS order_count,
      COUNT(DISTINCT customer_id) FILTER (
        WHERE GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0) > 0
      )::INTEGER AS customer_count,
      COALESCE(SUM(
        GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0)
      ), 0)::BIGINT AS amount_due
    FROM public.orders
    WHERE branch_id = p_branch_id
      AND status = 'completed'
      AND payment_status IN ('unpaid', 'partially_paid')
  ),
  current_payables AS (
    SELECT
      COUNT(*) FILTER (WHERE current_balance_in_minor_units > 0)::INTEGER
        AS supplier_count,
      COALESCE(SUM(current_balance_in_minor_units), 0)::BIGINT AS amount_due
    FROM public.suppliers
    WHERE COALESCE(is_active, true) = true
  ),
  current_inventory AS (
    SELECT
      COUNT(*) FILTER (WHERE ib.on_hand_quantity > 0)::INTEGER AS stocked_products,
      COALESCE(SUM(ib.on_hand_quantity), 0)::BIGINT AS base_units_on_hand,
      COALESCE(SUM(ib.reserved_quantity), 0)::BIGINT AS base_units_reserved,
      COALESCE(SUM(
        ib.on_hand_quantity::NUMERIC * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)
      ), 0)::BIGINT AS inventory_value,
      COUNT(*) FILTER (
        WHERE p.is_active = true
          AND ib.available_quantity <= p.min_stock_level
      )::INTEGER AS low_stock_products
    FROM public.inventory_balances ib
    JOIN public.warehouses w ON w.id = ib.warehouse_id
    JOIN public.products p ON p.id = ib.product_id
    WHERE w.branch_id = p_branch_id
  ),
  payment_methods AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'method', payment_method,
        'orderCount', order_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC
    ), '[]'::JSONB) AS payload
    FROM (
      SELECT
        COALESCE(payment_method, 'unknown') AS payment_method,
        COUNT(*)::INTEGER AS order_count,
        COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS amount
      FROM completed_orders
      GROUP BY COALESCE(payment_method, 'unknown')
    ) rows_by_method
  ),
  expense_categories AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'category', category,
        'count', expense_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC
    ), '[]'::JSONB) AS payload
    FROM (
      SELECT
        category,
        COUNT(*)::INTEGER AS expense_count,
        COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS amount
      FROM public.operational_expenses
      WHERE branch_id = p_branch_id
        AND created_at >= v_period_start
        AND created_at < v_period_end
      GROUP BY category
    ) rows_by_category
  ),
  top_products AS (
    SELECT COALESCE(jsonb_agg(product_payload ORDER BY revenue DESC), '[]'::JSONB)
      AS payload
    FROM (
      SELECT
        COALESCE(oi.product_name_snapshot, 'منتج') AS product_name,
        COALESCE(oi.sku_snapshot, '') AS sku,
        COALESCE(SUM(
          public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)
        ), 0)::BIGINT AS package_count,
        COALESCE(SUM(oi.line_total_in_minor_units), 0)::BIGINT AS revenue,
        COALESCE(SUM(oi.profit_in_minor_units), 0)::BIGINT AS profit,
        jsonb_build_object(
          'productName', COALESCE(oi.product_name_snapshot, 'منتج'),
          'sku', COALESCE(oi.sku_snapshot, ''),
          'packageCount', COALESCE(SUM(
            public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)
          ), 0),
          'revenueInMinorUnits', COALESCE(SUM(oi.line_total_in_minor_units), 0),
          'profitInMinorUnits', COALESCE(SUM(oi.profit_in_minor_units), 0)
        ) AS product_payload
      FROM completed_orders co
      JOIN public.order_items oi ON oi.order_id = co.id
      GROUP BY oi.product_name_snapshot, oi.sku_snapshot
      ORDER BY revenue DESC
      LIMIT 10
    ) ranked_products
  )
  SELECT jsonb_build_object(
    'success', true,
    'generatedAt', NOW(),
    'period', jsonb_build_object(
      'dateFrom', p_date_from,
      'dateTo', p_date_to,
      'branchId', p_branch_id,
      'branchName', (SELECT name_ar FROM public.branches WHERE id = p_branch_id)
    ),
    'sales', jsonb_build_object(
      'orderCount', os.order_count,
      'posOrderCount', os.pos_order_count,
      'websiteOrderCount', os.website_order_count,
      'packageCount', items.package_count,
      'baseUnitCount', items.base_unit_count,
      'uniqueProductCount', items.unique_product_count,
      'subtotalInMinorUnits', os.subtotal,
      'discountInMinorUnits', os.discounts,
      'deliveryFeesInMinorUnits', os.delivery_fees,
      'grossSalesInMinorUnits', os.gross_sales,
      'refundsInMinorUnits', returns.refund_amount,
      'netSalesInMinorUnits', os.gross_sales - returns.refund_amount,
      'cogsInMinorUnits', items.cogs,
      'grossProfitInMinorUnits', items.gross_profit,
      'netProfitInMinorUnits',
        items.gross_profit
        - returns.refund_amount
        + returns.recovered_cogs
        - expenses.total_expenses,
      'collectedInMinorUnits', os.collected,
      'outstandingInMinorUnits', os.outstanding,
      'returnCount', returns.return_count
    ),
    'expenses', jsonb_build_object(
      'count', expenses.expense_count,
      'totalInMinorUnits', expenses.total_expenses,
      'cashInMinorUnits', expenses.cash_expenses,
      'cliqInMinorUnits', expenses.cliq_expenses,
      'categories', expense_categories.payload
    ),
    'purchases', jsonb_build_object(
      'receiptCount', purchases.receipt_count,
      'totalInMinorUnits', purchases.total_purchases,
      'paidInMinorUnits', purchases.amount_paid,
      'dueInMinorUnits', purchases.amount_due
    ),
    'balances', jsonb_build_object(
      'customerOrderCount', receivables.order_count,
      'customerCount', receivables.customer_count,
      'customerDueInMinorUnits', receivables.amount_due,
      'supplierCount', payables.supplier_count,
      'supplierDueInMinorUnits', payables.amount_due
    ),
    'inventory', jsonb_build_object(
      'stockedProducts', inventory.stocked_products,
      'baseUnitsOnHand', inventory.base_units_on_hand,
      'baseUnitsReserved', inventory.base_units_reserved,
      'valueInMinorUnits', inventory.inventory_value,
      'lowStockProducts', inventory.low_stock_products
    ),
    'paymentMethods', payment_methods.payload,
    'topProducts', top_products.payload
  )
  INTO v_report
  FROM order_sales os
  CROSS JOIN item_sales items
  CROSS JOIN period_returns returns
  CROSS JOIN period_expenses expenses
  CROSS JOIN period_purchases purchases
  CROSS JOIN current_receivables receivables
  CROSS JOIN current_payables payables
  CROSS JOIN current_inventory inventory
  CROSS JOIN payment_methods
  CROSS JOIN expense_categories
  CROSS JOIN top_products;

  RETURN v_report;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_supplier_replacements_page_v1(p_supplier_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'pending'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ids UUID[]; result JSONB; values_allowed BOOLEAN; pending BIGINT; pending_value NUMERIC; total BIGINT;
BEGIN
 PERFORM public.sr208_assert_role_internal('read');values_allowed:=public.has_erp_role(ARRAY['owner']);
 IF p_status IS NULL OR p_status NOT IN ('pending','closed','all') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_PAGE_INVALID';
 END IF;
 -- The ledger is derived, never a writable pending-balance cache.
 WITH balances AS (
  SELECT c.id,c.occurred_at,COALESCE(sum(e.held_delta),0) held FROM public.supplier_replacement_cases c
  JOIN public.supplier_replacement_events e ON e.case_id=c.id
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND (p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
  GROUP BY c.id
 ), filtered AS(SELECT * FROM balances WHERE p_status='all' OR(p_status='pending' AND held>0) OR(p_status='closed' AND held=0))
 SELECT (SELECT count(*) FROM filtered),ARRAY(SELECT id FROM filtered ORDER BY occurred_at DESC,id DESC LIMIT p_page_size OFFSET(p_page::BIGINT-1)*p_page_size)
 INTO total,ids;
 PERFORM public.sr208_assert_operation_internal(x.operation_id) FROM (
  SELECT DISTINCT e.operation_id FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND(p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
  UNION SELECT c.operation_id FROM public.supplier_replacement_cases c
  WHERE (c.origin<>'shop_damage' OR p_status='all') AND(p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id)
 ) x;
 SELECT COALESCE(sum(e.held_delta),0),COALESCE(sum(e.held_delta*c.unit_cost_in_minor_units_exact),0) INTO pending,pending_value
 FROM public.supplier_replacement_cases c JOIN public.supplier_replacement_events e ON e.case_id=c.id
 WHERE c.origin<>'shop_damage' AND (p_supplier_id IS NULL OR c.supplier_id=p_supplier_id) AND(p_branch_id IS NULL OR c.branch_id=p_branch_id);
 result:=jsonb_build_object('contractVersion',208,'page',p_page,'pageSize',p_page_size,'totalCount',total,
  'pendingQuantity',pending,'cases',(SELECT COALESCE(jsonb_agg(public.sr208_case_dto_internal(v,values_allowed) ORDER BY c.occurred_at DESC,c.id DESC),'[]')
   FROM unnest(ids) v JOIN public.supplier_replacement_cases c ON c.id=v));
 IF values_allowed THEN result:=result||jsonb_build_object('pendingValueInMinorUnitsExact',pending_value::TEXT); END IF;
 RETURN result;
END $function$;
ALTER POLICY "Allow authenticated users to select supplier receipts" ON public.supplier_receipts USING ((select auth.uid()) IS NOT NULL);
ALTER POLICY "Allow authenticated users to select supplier receipt items" ON public.supplier_receipt_items USING ((select auth.uid()) IS NOT NULL);
-- Measured embedded receipt-detail read; no other Advisor FK indexes adopted.
CREATE INDEX idx_supplier_receipt_items_receipt220 ON public.supplier_receipt_items(supplier_receipt_id);
-- Bounded legacy-reader-only sort/hash memory; caller/default remains4MB.
ALTER FUNCTION public._get_operational_business_report_before_phase6(uuid,date,date) SET work_mem='8MB';

-- GUEST220_SOURCE_GUARD: exact current219 definitions,including compatibility wrappers.
DO $guest_guard$ BEGIN
 IF md5(pg_get_functiondef('public.submit_guest_customer_order_v2(text,text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text,bigint,bigint,bigint,bigint)'::regprocedure)) <> '357069ebfdf932b966c46893c96b8b52' OR md5(pg_get_functiondef('public.create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)'::regprocedure)) <> 'd372b6e9b17379d68095464e88ad810a' OR md5(pg_get_functiondef('public.package_d_create_customer_order_before_source_guard_internal(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)'::regprocedure)) <> 'b030ce72164342d4ce7342c24d173d6d' THEN RAISE EXCEPTION 'DRAFT220_REQUIRES_REVIEWED_219_GUEST_WRITERS'; END IF;
END $guest_guard$;
-- GUEST220_IDENTITY_ONLY: owner approved7Nov;no financial or privilege change.
CREATE OR REPLACE FUNCTION public.submit_guest_customer_order_v2(p_idempotency_key text, p_guest_phone_hash text, p_guest_session_hash text, p_customer_full_name text, p_customer_phone text, p_governorate text, p_city text, p_area text, p_street text, p_building text, p_address_notes text, p_google_maps_url text, p_latitude double precision, p_longitude double precision, p_customer_notes text, p_lines jsonb, p_promotion_code text, p_payment_method text, p_delivery_zone text, p_expected_subtotal_in_minor_units bigint, p_expected_discount_in_minor_units bigint, p_expected_delivery_fee_in_minor_units bigint, p_expected_total_in_minor_units bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key TEXT := LOWER(NULLIF(BTRIM(p_idempotency_key), ''));
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_payment_method TEXT := LOWER(NULLIF(BTRIM(p_payment_method), ''));
  v_delivery_zone TEXT := LOWER(NULLIF(BTRIM(p_delivery_zone), ''));
  v_actor_hash TEXT;
  v_delivery_hash TEXT;
  v_request JSONB;
  v_canonical_request JSONB;
  v_quote_lines JSONB;
  v_fingerprint TEXT;
  v_replay JSONB;
  v_line JSONB;
  v_instance JSONB;
  v_component JSONB;
  v_validated JSONB;
  v_plan_lines JSONB := '[]'::JSONB;
  v_final_lines JSONB := '[]'::JSONB;
  v_plan_instances JSONB;
  v_plan_components JSONB;
  v_line_weights JSONB;
  v_instance_weights JSONB;
  v_product_ids UUID[];
  v_configuration_ids UUID[];
  v_family_ids UUID[];
  v_line_sequence INTEGER := 0;
  v_line_kind TEXT;
  v_line_identity TEXT;
  v_expected_price BIGINT;
  v_product public.products%ROWTYPE;
  v_settings public.storefront_settings%ROWTYPE;
  v_order_id UUID := gen_random_uuid();
  v_operation_id UUID := gen_random_uuid();
  v_order_item_id UUID;
  v_instance_id UUID;
  v_customer_id UUID;
  v_address_id UUID := gen_random_uuid();
  v_customer_reused BOOLEAN := false;
  v_customer_is_blocked BOOLEAN;
  v_customer_is_active BOOLEAN;
  v_branch_id UUID;
  v_warehouse_id UUID;
  v_order_number TEXT;
  v_tracking_token UUID := gen_random_uuid();
  v_base_unit_name TEXT;
  v_parcel_unit_name TEXT;
  v_commercial_quantity INTEGER;
  v_base_quantity BIGINT;
  v_units_per_parcel INTEGER;
  v_unit_price BIGINT;
  v_line_gross BIGINT;
  v_line_discount BIGINT;
  v_line_net BIGINT;
  v_instance_discount BIGINT;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_delivery_fee BIGINT;
  v_total BIGINT;
  v_promotion public.promotion_codes%ROWTYPE;
  v_promotion_id UUID;
  v_promotion_code TEXT;
  v_recent_orders INTEGER;
  v_demand RECORD;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_result_items JSONB;
  v_result JSONB;
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
  v_location_source TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_ACTOR_NOT_AUTHORIZED: Customer V2 requires the protected gateway.';
  END IF;
  IF v_key IS NULL
    OR v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR COALESCE(p_guest_phone_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_guest_session_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_INPUT_INVALID: Customer operation identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_customer_full_name), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_customer_full_name)) NOT BETWEEN 2 AND 120
    OR v_phone !~ '^07[789][0-9]{7}$'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Customer identity is invalid.';
  END IF;
  IF NULLIF(BTRIM(p_governorate), '') IS NULL
    OR NULLIF(BTRIM(p_city), '') IS NULL
    OR NULLIF(BTRIM(p_area), '') IS NULL
    OR NULLIF(BTRIM(p_street), '') IS NULL
    OR CHAR_LENGTH(BTRIM(p_governorate)) > 80
    OR CHAR_LENGTH(BTRIM(p_city)) > 80
    OR CHAR_LENGTH(BTRIM(p_area)) > 120
    OR CHAR_LENGTH(BTRIM(p_street)) > 300
    OR CHAR_LENGTH(COALESCE(BTRIM(p_building), '')) > 120
    OR CHAR_LENGTH(COALESCE(BTRIM(p_address_notes), '')) > 500
    OR CHAR_LENGTH(COALESCE(BTRIM(p_customer_notes), '')) > 1000
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Address fields are invalid.';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL)
    OR (p_latitude IS NOT NULL AND (
      p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Delivery coordinates are invalid.';
  END IF;
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq')
    OR v_delivery_zone NOT IN ('inside_ramtha', 'outside_ramtha')
    OR COALESCE(p_expected_subtotal_in_minor_units, -1) < 0
    OR COALESCE(p_expected_discount_in_minor_units, -1) < 0
    OR COALESCE(p_expected_delivery_fee_in_minor_units, -1) < 0
    OR COALESCE(p_expected_total_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_INVALID: Customer quote is invalid.';
  END IF;

  IF JSONB_TYPEOF(p_lines) IS DISTINCT FROM 'array'
    OR JSONB_ARRAY_LENGTH(p_lines) NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer lines are invalid.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'line_identity', public.phase3_customer_line_identity_internal(value),
    'expected_unit_price_in_minor_units',
      public.phase3_require_nonnegative_bigint_internal(
        value->>'expected_unit_price_in_minor_units',
        'expected_unit_price_in_minor_units'
      )
  ) ORDER BY public.phase3_customer_line_identity_internal(value))
  INTO v_quote_lines
  FROM JSONB_ARRAY_ELEMENTS(p_lines);

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(p_lines) candidate
    GROUP BY public.phase3_customer_line_identity_internal(candidate)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_SALE_CONTRACT_INVALID: Customer commercial identities must be unique.';
  END IF;

  v_actor_hash := public.phase3_actor_scope_hash_internal(
    'guest_gateway', NULL, LOWER(p_guest_phone_hash), LOWER(p_guest_session_hash)
  );
  v_delivery_hash := ENCODE(extensions.digest(
    JSONB_BUILD_OBJECT(
      'governorate', BTRIM(p_governorate), 'city', BTRIM(p_city),
      'area', BTRIM(p_area), 'street', BTRIM(p_street),
      'building', NULLIF(BTRIM(p_building), ''),
      'latitude', p_latitude, 'longitude', p_longitude
    )::TEXT, 'sha256'::TEXT
  ), 'hex');

  v_request := JSONB_BUILD_OBJECT(
    'contract_version', 'phase3-sale-v1',
    'actor_scope_type', 'guest_gateway',
    'actor_scope_hash', v_actor_hash,
    'operation_source', 'customer_reservation',
    'warehouse_id', '00000000-0000-0000-0000-000000000001',
    'customer_identity_hash', LOWER(p_guest_phone_hash),
    'delivery_identity_hash', v_delivery_hash,
    'payment_method', v_payment_method,
    'delivery_zone', v_delivery_zone,
    'promotion_code', NULLIF(BTRIM(p_promotion_code), ''),
    'order_discount_in_minor_units', 0,
    'lines', p_lines
  );
  v_canonical_request := public.phase3_canonicalize_sale_request_internal(v_request)
    || JSONB_BUILD_OBJECT('customer_quote', JSONB_BUILD_OBJECT(
      'lines', v_quote_lines,
      'subtotal_in_minor_units', p_expected_subtotal_in_minor_units,
      'discount_in_minor_units', p_expected_discount_in_minor_units,
      'delivery_fee_in_minor_units', p_expected_delivery_fee_in_minor_units,
      'total_in_minor_units', p_expected_total_in_minor_units
    ));
  v_fingerprint := public.phase3_request_fingerprint_internal(v_canonical_request);

  -- Same raw-key lock as V1. Replay is decided before current feature, price,
  -- configuration, inventory or storefront state is consulted.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  v_replay := public.phase3_resolve_operation_replay_internal(
    'phase3_customer_reservation_v1', v_key, 'guest_gateway',
    v_actor_hash, v_fingerprint
  );
  IF v_replay->>'decision' = 'REPLAY' THEN
    RETURN v_replay->'result_snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE idempotency_key = v_key) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_IDEMPOTENCY_CONFLICT: Operation identity is unavailable.';
  END IF;

  SELECT * INTO v_settings FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(v_settings.orders_enabled, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_ORDERS_DISABLED: Customer orders are unavailable.';
  END IF;
  IF v_delivery_zone = 'inside_ramtha'
    AND CONCAT_WS(' ', p_governorate, p_city, p_area) NOT ILIKE '%الرمثا%'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_DELIVERY_ZONE_MISMATCH: Delivery zone does not match address.';
  END IF;

  SELECT warehouse.branch_id, warehouse.id
  INTO v_branch_id, v_warehouse_id
  FROM public.warehouses warehouse
  JOIN public.branches branch ON branch.id = warehouse.branch_id
  WHERE warehouse.is_active AND branch.is_active
  ORDER BY warehouse.created_at, warehouse.id
  LIMIT 1;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_LOCATION_UNAVAILABLE: No active storefront warehouse.';
  END IF;

  -- Customer V1 already serializes normalized customer identity before taking
  -- inventory locks.  V2 follows the same relative order so mixed-version
  -- requests cannot form Customer -> Inventory / Inventory -> Customer cycles.
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);
  SELECT id, is_blocked, is_active INTO
    v_customer_id, v_customer_is_blocked, v_customer_is_active
  FROM public.customers
  WHERE public.normalize_customer_phone(phone) = v_phone AND is_deleted = false
  LIMIT 1 FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) THEN
    PERFORM public.phase3_assert_configurable_parcel_creation_allowed_internal(
      'guest_gateway', NULL
    );
  END IF;

  PERFORM public.parcel209_guard_modern_lines_internal(v_canonical_request->'lines');

  SELECT ARRAY_AGG(DISTINCT (candidate->>'parcel_configuration_id')::UUID
      ORDER BY (candidate->>'parcel_configuration_id')::UUID),
    ARRAY_AGG(DISTINCT (candidate->>'family_product_id')::UUID
      ORDER BY (candidate->>'family_product_id')::UUID)
  INTO v_configuration_ids, v_family_ids
  FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
  WHERE candidate->>'commercial_line_kind' = 'configurable_parcel';
  IF COALESCE(CARDINALITY(v_configuration_ids), 0) > 0 THEN
    PERFORM configuration.id FROM public.product_parcel_configurations configuration
    WHERE configuration.id = ANY(v_configuration_ids)
    ORDER BY configuration.id FOR SHARE;
    PERFORM family.id FROM public.products family
    WHERE family.id = ANY(v_family_ids)
    ORDER BY family.id FOR SHARE;
  END IF;

  SELECT ARRAY_AGG(DISTINCT identity.product_id ORDER BY identity.product_id)
  INTO v_product_ids
  FROM (
    SELECT (candidate->>'product_id')::UUID AS product_id
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    WHERE candidate->>'commercial_line_kind' IN ('base_unit', 'legacy_single_sku_parcel')
    UNION ALL
    SELECT (component->>'product_id')::UUID
    FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines') candidate
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(candidate->'parcel_instances') parcel
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(parcel->'components') component
    WHERE candidate->>'commercial_line_kind' = 'configurable_parcel'
  ) identity;
  PERFORM public.phase3_lock_inventory_products_internal(v_product_ids);

  FOR v_line IN
    SELECT value FROM JSONB_ARRAY_ELEMENTS(v_canonical_request->'lines')
    ORDER BY value::TEXT
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_order_item_id := gen_random_uuid();
    v_line_kind := v_line->>'commercial_line_kind';
    v_line_identity := public.phase3_customer_line_identity_internal(v_line);
    SELECT public.phase3_require_nonnegative_bigint_internal(
      raw_line->>'expected_unit_price_in_minor_units',
      'expected_unit_price_in_minor_units'
    ) INTO v_expected_price
    FROM JSONB_ARRAY_ELEMENTS(p_lines) raw_line
    WHERE public.phase3_customer_line_identity_internal(raw_line) = v_line_identity;
    v_plan_instances := '[]'::JSONB;

    IF v_line_kind = 'base_unit' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.is_flavor_master THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRODUCT_INVALID: Base Unit is unavailable.';
      END IF;
      v_commercial_quantity := (v_line->>'base_quantity')::INTEGER;
      v_base_quantity := v_commercial_quantity;
      v_units_per_parcel := 1;
      v_unit_price := v_product.sale_price_in_minor_units;
      SELECT COALESCE(unit.name_ar, 'وحدة') INTO v_base_unit_name
      FROM public.units unit WHERE unit.id = v_product.unit_id;
      v_base_unit_name := COALESCE(v_base_unit_name, 'وحدة');
      v_parcel_unit_name := v_base_unit_name;
    ELSIF v_line_kind = 'legacy_single_sku_parcel' THEN
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'product_id')::UUID AND is_active;
      IF NOT FOUND OR v_product.units_per_sale_unit IS DISTINCT FROM
          (v_line->>'units_per_parcel')::INTEGER
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Legacy Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;
    ELSE
      SELECT * INTO v_product FROM public.products
      WHERE id = (v_line->>'family_product_id')::UUID AND is_active;
      IF NOT FOUND OR NOT v_product.is_flavor_master
        OR COALESCE(v_product.default_sale_price_in_minor_units, 0) <= 0
      THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001',
          MESSAGE = 'PHASE3_CUSTOMER_PRICE_OR_PACKAGE_STALE: Configurable Parcel changed.';
      END IF;
      v_commercial_quantity := (v_line->>'parcel_quantity')::INTEGER;
      v_units_per_parcel := v_product.units_per_sale_unit;
      v_base_quantity := v_commercial_quantity::BIGINT * v_units_per_parcel;
      v_unit_price := v_product.default_sale_price_in_minor_units;
      SELECT COALESCE(base_unit.name_ar, 'وحدة'), COALESCE(parcel_unit.name_ar, 'طرد')
      INTO v_base_unit_name, v_parcel_unit_name
      FROM public.products product
      LEFT JOIN public.units base_unit ON base_unit.id = product.unit_id
      LEFT JOIN public.units parcel_unit ON parcel_unit.id = product.sale_unit_id
      WHERE product.id = v_product.id;

      FOR v_instance IN
        SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        v_validated := public.phase3_validate_configurable_parcel_internal(
          'guest_gateway', NULL, (v_line->>'family_product_id')::UUID,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'configuration_revision')::INTEGER,
          v_instance->'components'
        );
        v_instance_id := gen_random_uuid();
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'component_id', gen_random_uuid(),
          'reservation_id', gen_random_uuid(),
          'product_id', component->>'product_id',
          'base_quantity', (component->>'base_quantity')::INTEGER,
          'product_name_snapshot', component->>'product_name_snapshot',
          'sku_snapshot', component->>'sku_snapshot',
          'base_unit_name_snapshot', COALESCE(
            NULLIF(component->>'base_unit_name_snapshot', ''), v_base_unit_name
          )
        ) ORDER BY (component->>'product_id')::UUID)
        INTO v_plan_components
        FROM JSONB_ARRAY_ELEMENTS(v_validated->'components') component;
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
          'instance_id', v_instance_id,
          'instance_sequence', (v_instance->>'instance_sequence')::INTEGER,
          'configuration_revision', (v_line->>'configuration_revision')::INTEGER,
          'units_per_parcel', (v_validated->>'units_per_parcel')::INTEGER,
          'composition_fingerprint', v_validated->>'composition_fingerprint',
          'gross_amount_in_minor_units', v_unit_price,
          'components', v_plan_components
        ));
      END LOOP;
    END IF;

    IF v_base_quantity > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '22003',
        MESSAGE = 'PHASE3_CUSTOMER_QUANTITY_OVERFLOW: Base quantity exceeds safe capacity.';
    END IF;
    IF v_unit_price IS DISTINCT FROM v_expected_price THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Commercial price changed.';
    END IF;
    v_line_gross := v_commercial_quantity::BIGINT * v_unit_price;
    v_subtotal := v_subtotal + v_line_gross;
    v_plan_lines := v_plan_lines || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
      'line_sequence', v_line_sequence,
      'order_item_id', v_order_item_id,
      'reservation_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN NULL ELSE gen_random_uuid() END,
      'commercial_line_kind', v_line_kind,
      'product_id', v_product.id,
      'product_name_snapshot', v_product.name_ar,
      'sku_snapshot', v_product.sku,
      'family_product_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'family_product_id' ELSE NULL END,
      'parcel_configuration_id', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN v_line->>'parcel_configuration_id' ELSE NULL END,
      'configuration_revision', CASE WHEN v_line_kind = 'configurable_parcel'
        THEN (v_line->>'configuration_revision')::INTEGER ELSE NULL END,
      'commercial_quantity', v_commercial_quantity,
      'base_quantity', v_base_quantity,
      'units_per_parcel', v_units_per_parcel,
      'base_unit_name_snapshot', v_base_unit_name,
      'parcel_unit_name_snapshot', v_parcel_unit_name,
      'unit_price_in_minor_units', v_unit_price,
      'gross_amount_in_minor_units', v_line_gross,
      'parcel_instances', v_plan_instances
    ));
  END LOOP;

  IF v_subtotal IS DISTINCT FROM p_expected_subtotal_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Subtotal changed.';
  END IF;
  IF v_subtotal < v_settings.minimum_order_in_minor_units THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_MINIMUM_ORDER: Order is below the current minimum.';
  END IF;

  IF NULLIF(BTRIM(p_promotion_code), '') IS NOT NULL THEN
    SELECT * INTO v_promotion FROM public.promotion_codes
    WHERE code = UPPER(BTRIM(p_promotion_code)) FOR UPDATE;
    IF NOT FOUND OR NOT v_promotion.is_active
      OR (v_promotion.starts_at IS NOT NULL AND NOW() < v_promotion.starts_at)
      OR (v_promotion.expires_at IS NOT NULL AND NOW() >= v_promotion.expires_at)
      OR v_subtotal < v_promotion.minimum_subtotal_in_minor_units
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable.';
    END IF;
    IF v_promotion.maximum_total_redemptions IS NOT NULL AND (
      SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
    ) >= v_promotion.maximum_total_redemptions THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is exhausted.';
    END IF;
    IF (SELECT COUNT(*) FROM public.promotion_redemptions redemption
      WHERE redemption.promotion_code_id = v_promotion.id
        AND redemption.customer_phone = v_phone
    ) >= v_promotion.maximum_redemptions_per_phone THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_PROMOTION_INVALID: Promotion is unavailable for this customer.';
    END IF;
    v_promotion_id := v_promotion.id;
    v_promotion_code := v_promotion.code;
    IF v_promotion.discount_type = 'fixed' THEN
      v_discount := LEAST(v_promotion.discount_value, v_subtotal);
    ELSE
      v_discount := FLOOR(v_subtotal::NUMERIC * v_promotion.discount_value / 10000)::BIGINT;
      IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
        v_discount := LEAST(v_discount, v_promotion.maximum_discount_in_minor_units);
      END IF;
    END IF;
    v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  END IF;

  v_delivery_fee := CASE v_delivery_zone
    WHEN 'inside_ramtha' THEN v_settings.inside_ramtha_delivery_fee_in_minor_units
    ELSE v_settings.outside_ramtha_delivery_fee_in_minor_units END;
  v_total := v_subtotal - v_discount + v_delivery_fee;
  IF v_discount IS DISTINCT FROM p_expected_discount_in_minor_units
    OR v_delivery_fee IS DISTINCT FROM p_expected_delivery_fee_in_minor_units
    OR v_total IS DISTINCT FROM p_expected_total_in_minor_units
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_QUOTE_STALE: Accepted totals changed.';
  END IF;

  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
    'key', line->>'line_sequence',
    'weight', (line->>'gross_amount_in_minor_units')::BIGINT
  ) ORDER BY (line->>'line_sequence')::INTEGER)
  INTO v_line_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_lines) line;
  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_plan_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    SELECT allocated_amount INTO v_line_discount
    FROM public.phase2_allocate_largest_remainder_internal(v_discount, v_line_weights)
    WHERE allocation_key = v_line->>'line_sequence';
    v_line_discount := COALESCE(v_line_discount, 0);
    v_line_gross := (v_line->>'gross_amount_in_minor_units')::BIGINT;
    v_line_net := v_line_gross - v_line_discount;
    v_plan_instances := v_line->'parcel_instances';
    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'key', instance->>'instance_sequence',
        'weight', (instance->>'gross_amount_in_minor_units')::BIGINT
      ) ORDER BY (instance->>'instance_sequence')::INTEGER)
      INTO v_instance_weights FROM JSONB_ARRAY_ELEMENTS(v_plan_instances) instance;
      v_plan_instances := '[]'::JSONB;
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        SELECT allocated_amount INTO v_instance_discount
        FROM public.phase2_allocate_largest_remainder_internal(v_line_discount, v_instance_weights)
        WHERE allocation_key = v_instance->>'instance_sequence';
        v_plan_instances := v_plan_instances || JSONB_BUILD_ARRAY(
          v_instance || JSONB_BUILD_OBJECT(
            'allocated_discount_in_minor_units', COALESCE(v_instance_discount, 0),
            'net_refundable_amount_in_minor_units',
              (v_instance->>'gross_amount_in_minor_units')::BIGINT
                - COALESCE(v_instance_discount, 0)
          )
        );
      END LOOP;
    END IF;
    v_final_lines := v_final_lines || JSONB_BUILD_ARRAY(
      v_line || JSONB_BUILD_OBJECT(
        'allocated_discount_in_minor_units', v_line_discount,
        'net_refundable_amount_in_minor_units', v_line_net,
        'parcel_instances', v_plan_instances
      )
    );
  END LOOP;

  FOR v_demand IN
    WITH demand AS (
      SELECT (line->>'product_id')::UUID product_id,
        (line->>'base_quantity')::INTEGER quantity
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      WHERE line->>'commercial_line_kind' <> 'configurable_parcel'
      UNION ALL
      SELECT (component->>'product_id')::UUID,
        (component->>'base_quantity')::INTEGER
      FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(line->'parcel_instances') instance
      CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(instance->'components') component
      WHERE line->>'commercial_line_kind' = 'configurable_parcel'
    ) SELECT product_id, SUM(quantity)::INTEGER quantity
      FROM demand GROUP BY product_id ORDER BY product_id
  LOOP
    SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances balance
    WHERE balance.warehouse_id = v_warehouse_id
      AND balance.product_id = v_demand.product_id
    FOR UPDATE;
    IF NOT FOUND OR v_on_hand - v_reserved < v_demand.quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_INSUFFICIENT_INVENTORY: Component inventory is unavailable.';
    END IF;
  END LOOP;

  SELECT COUNT(*)::INTEGER INTO v_recent_orders
  FROM public.orders customer_order
  JOIN public.customers customer ON customer.id = customer_order.customer_id
  WHERE customer_order.source = 'website'
    AND public.normalize_customer_phone(customer.phone) = v_phone
    AND customer_order.created_at >= NOW() - INTERVAL '10 minutes';
  IF v_recent_orders >= 3 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_RATE_LIMITED: Too many recent orders.';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    IF v_customer_is_blocked OR NOT v_customer_is_active THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE3_CUSTOMER_UNAVAILABLE: Customer account is unavailable.';
    END IF;
    v_customer_reused := true;
    -- Guest delivery details belong to this order,not the existing CRM card.
  ELSE
    v_customer_id := gen_random_uuid();
    INSERT INTO public.customers(
      id, full_name, phone, governorate, customer_type,
      is_active, is_blocked, is_deleted
    ) VALUES (
      v_customer_id, BTRIM(p_customer_full_name), v_phone,
      BTRIM(p_governorate), 'wholesale', true, false, false
    );
  END IF;

  -- Existing default addresses remain unchanged,including when none exists.
  v_formatted_address := CONCAT_WS(' - ', BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''));
  v_google_maps_url := COALESCE(NULLIF(BTRIM(p_google_maps_url), ''), CASE
    WHEN p_latitude IS NOT NULL THEN 'https://www.google.com/maps?q='
      || p_latitude::TEXT || ',' || p_longitude::TEXT ELSE NULL END);
  IF v_google_maps_url IS NOT NULL AND (
    CHAR_LENGTH(v_google_maps_url) > 1000 OR v_google_maps_url !~* '^https://'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE3_CUSTOMER_INPUT_INVALID: Map URL is invalid.';
  END IF;
  v_location_source := CASE WHEN p_latitude IS NOT NULL THEN 'gps'
    WHEN v_google_maps_url IS NOT NULL THEN 'map_pin' ELSE 'manual' END;
  INSERT INTO public.customer_addresses(
    id, customer_id, governorate, city, area, street, building, notes,
    latitude, longitude, formatted_address, google_maps_url,
    location_source, location_confirmed, is_default
  ) VALUES (
    v_address_id, v_customer_id, BTRIM(p_governorate), BTRIM(p_city),
    BTRIM(p_area), BTRIM(p_street), NULLIF(BTRIM(p_building), ''),
    NULLIF(BTRIM(p_address_notes), ''), p_latitude, p_longitude,
    v_formatted_address, v_google_maps_url, v_location_source,
    p_latitude IS NOT NULL, NOT v_customer_reused
  );

  LOOP
    v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-'
      || LPAD((FLOOR(RANDOM() * 89999 + 10000))::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_number = v_order_number);
  END LOOP;

  SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
    'id', line->>'order_item_id', 'productId', line->>'product_id',
    'productName', line->>'product_name_snapshot', 'sku', line->>'sku_snapshot',
    'commercialLineKind', line->>'commercial_line_kind',
    'quantity', (line->>'commercial_quantity')::INTEGER,
    'baseQuantity', (line->>'base_quantity')::BIGINT,
    'unitPriceInMinorUnits', (line->>'unit_price_in_minor_units')::BIGINT,
    'lineTotalInMinorUnits', (line->>'gross_amount_in_minor_units')::BIGINT,
    'allocatedDiscountInMinorUnits', (line->>'allocated_discount_in_minor_units')::BIGINT,
    'netRefundableAmountInMinorUnits', (line->>'net_refundable_amount_in_minor_units')::BIGINT,
    'costFinalized', false, 'parcelInstances', line->'parcel_instances'
  ) ORDER BY (line->>'line_sequence')::INTEGER), '[]'::JSONB)
  INTO v_result_items FROM JSONB_ARRAY_ELEMENTS(v_final_lines) line;
  v_result := JSONB_BUILD_OBJECT(
    'success', true, 'idempotent_replay', false,
    'contract_version', 'phase3-customer-reservation-v2',
    'operation_id', v_operation_id, 'order_id', v_order_id,
    'order_number', v_order_number, 'customer_id', v_customer_id,
    'customer_address_id', v_address_id, 'customer_reused', v_customer_reused,
    'status', 'new', 'subtotal', v_subtotal, 'discount', v_discount,
    'delivery_fee', v_delivery_fee, 'total', v_total,
    'promotion_code', v_promotion_code, 'payment_method', v_payment_method,
    'payment_status', 'unpaid', 'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'items', v_result_items,
    'message', 'تم إنشاء طلب V2 وحجز مكوناته بدقة.'
  );

  INSERT INTO public.business_operations(
    id, operation_type, idempotency_key, request_fingerprint, initiated_by,
    result_snapshot, completed_at, request_identity_version,
    request_identity_snapshot, actor_scope_type, actor_scope_hash
  ) VALUES (
    v_operation_id, 'phase3_customer_reservation_v1', v_key, v_fingerprint,
    NULL, v_result, NOW(), 301, v_canonical_request,
    'guest_gateway', v_actor_hash
  );
  INSERT INTO public.orders(
    id, order_number, customer_id, customer_address_id, customer_name_snapshot,
    branch_id, warehouse_id, status, payment_method, payment_status,
    subtotal_in_minor_units, delivery_fee_in_minor_units,
    discount_in_minor_units, total_in_minor_units, amount_paid_in_minor_units,
    customer_notes, internal_notes, whatsapp_message, source,
    idempotency_key, promotion_code_id, promotion_code_snapshot,
    delivery_zone, tracking_token, operation_id
  ) VALUES (
    v_order_id, v_order_number, v_customer_id, v_address_id,
    BTRIM(p_customer_full_name), v_branch_id, v_warehouse_id, 'new',
    v_payment_method, 'unpaid', v_subtotal, v_delivery_fee, v_discount,
    v_total, 0, NULLIF(BTRIM(p_customer_notes), ''),
    'طلب عميل V2 محجوز بالمكونات',
    'تم استلام طلبك رقم ' || v_order_number, 'website', v_key,
    v_promotion_id, v_promotion_code, v_delivery_zone, v_tracking_token,
    v_operation_id
  );

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    INSERT INTO public.order_items(
      id, order_id, product_id, product_name_snapshot, sku_snapshot,
      quantity, unit_price_in_minor_units, line_total_in_minor_units,
      sale_package_quantity, units_per_sale_package,
      sale_package_name_snapshot, sale_package_price_in_minor_units,
      commercial_line_kind, family_product_id, parcel_configuration_id,
      parcel_configuration_revision, base_unit_name_snapshot,
      allocated_discount_snapshot_in_minor_units,
      net_refundable_amount_snapshot_in_minor_units
    ) VALUES (
      (v_line->>'order_item_id')::UUID, v_order_id,
      (v_line->>'product_id')::UUID, v_line->>'product_name_snapshot',
      v_line->>'sku_snapshot', CASE
        WHEN v_line->>'commercial_line_kind' = 'configurable_parcel'
        THEN (v_line->>'commercial_quantity')::INTEGER
        ELSE (v_line->>'base_quantity')::INTEGER END,
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      (v_line->>'gross_amount_in_minor_units')::BIGINT,
      (v_line->>'commercial_quantity')::INTEGER,
      (v_line->>'units_per_parcel')::INTEGER,
      v_line->>'parcel_unit_name_snapshot',
      (v_line->>'unit_price_in_minor_units')::BIGINT,
      v_line->>'commercial_line_kind',
      NULLIF(v_line->>'family_product_id', '')::UUID,
      NULLIF(v_line->>'parcel_configuration_id', '')::UUID,
      NULLIF(v_line->>'configuration_revision', '')::INTEGER,
      v_line->>'base_unit_name_snapshot',
      (v_line->>'allocated_discount_in_minor_units')::BIGINT,
      (v_line->>'net_refundable_amount_in_minor_units')::BIGINT
    );

    IF v_line->>'commercial_line_kind' = 'configurable_parcel' THEN
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        INSERT INTO public.order_parcel_instances(
          id, order_item_id, order_id, operation_id, parcel_configuration_id,
          family_product_id, instance_sequence, configuration_revision,
          units_per_parcel_snapshot, parcel_unit_name_snapshot,
          gross_amount_snapshot_in_minor_units,
          allocated_discount_snapshot_in_minor_units,
          net_refundable_amount_snapshot_in_minor_units,
          cogs_snapshot_in_minor_units, composition_fingerprint
        ) VALUES (
          (v_instance->>'instance_id')::UUID,
          (v_line->>'order_item_id')::UUID, v_order_id, v_operation_id,
          (v_line->>'parcel_configuration_id')::UUID,
          (v_line->>'family_product_id')::UUID,
          (v_instance->>'instance_sequence')::INTEGER,
          (v_instance->>'configuration_revision')::INTEGER,
          (v_instance->>'units_per_parcel')::INTEGER,
          v_line->>'parcel_unit_name_snapshot',
          (v_instance->>'gross_amount_in_minor_units')::BIGINT,
          (v_instance->>'allocated_discount_in_minor_units')::BIGINT,
          (v_instance->>'net_refundable_amount_in_minor_units')::BIGINT,
          0, v_instance->>'composition_fingerprint'
        );
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_parcel_components(
            id, parcel_instance_id, operation_id, product_id, base_quantity,
            product_name_snapshot, sku_snapshot, base_unit_name_snapshot,
            unit_cost_snapshot_in_minor_units, cogs_snapshot_in_minor_units
          ) VALUES (
            (v_component->>'component_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_operation_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER,
            v_component->>'product_name_snapshot', v_component->>'sku_snapshot',
            v_component->>'base_unit_name_snapshot', 0, 0
          );
        END LOOP;
        PERFORM public.finalize_order_parcel_instance_internal(
          (v_instance->>'instance_id')::UUID
        );
      END LOOP;
    END IF;
  END LOOP;

  FOR v_line IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_final_lines)
    ORDER BY (value->>'line_sequence')::INTEGER
  LOOP
    IF v_line->>'commercial_line_kind' <> 'configurable_parcel' THEN
      INSERT INTO public.order_inventory_reservations(
        id, operation_id, order_id, order_item_id, parcel_instance_id,
        warehouse_id, product_id, reserved_quantity
      ) VALUES (
        (v_line->>'reservation_id')::UUID, v_operation_id, v_order_id,
        (v_line->>'order_item_id')::UUID, NULL, v_warehouse_id,
        (v_line->>'product_id')::UUID, (v_line->>'base_quantity')::INTEGER
      );
    ELSE
      FOR v_instance IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_line->'parcel_instances')
        ORDER BY (value->>'instance_sequence')::INTEGER
      LOOP
        FOR v_component IN SELECT value FROM JSONB_ARRAY_ELEMENTS(v_instance->'components')
          ORDER BY (value->>'product_id')::UUID
        LOOP
          INSERT INTO public.order_inventory_reservations(
            id, operation_id, order_id, order_item_id, parcel_instance_id,
            warehouse_id, product_id, reserved_quantity
          ) VALUES (
            (v_component->>'reservation_id')::UUID, v_operation_id, v_order_id,
            (v_line->>'order_item_id')::UUID,
            (v_instance->>'instance_id')::UUID, v_warehouse_id,
            (v_component->>'product_id')::UUID,
            (v_component->>'base_quantity')::INTEGER
          );
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;

  FOR v_demand IN
    SELECT reservation.product_id, SUM(reservation.reserved_quantity)::INTEGER quantity
    FROM public.order_inventory_reservations reservation
    WHERE reservation.order_id = v_order_id
      AND reservation.reservation_state = 'active'
    GROUP BY reservation.product_id ORDER BY reservation.product_id
  LOOP
    UPDATE public.inventory_balances
    SET reserved_quantity = reserved_quantity + v_demand.quantity,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id AND product_id = v_demand.product_id;
  END LOOP;

  IF v_promotion_id IS NOT NULL THEN
    INSERT INTO public.promotion_redemptions(
      promotion_code_id, order_id, customer_id, customer_phone,
      code_snapshot, discount_in_minor_units
    ) VALUES (
      v_promotion_id, v_order_id, v_customer_id, v_phone,
      v_promotion_code, v_discount
    );
  END IF;
  INSERT INTO public.order_status_history(order_id, old_status, new_status, changed_by, notes)
  VALUES (v_order_id, NULL, 'new', NULL, 'إنشاء طلب عميل V2 وحجز المكونات ذريًا');
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (NULL, 'CREATE_CUSTOMER_ORDER_V2', 'orders', v_order_id,
    JSONB_BUILD_OBJECT('operation_id', v_operation_id, 'commercial_lines',
      JSONB_ARRAY_LENGTH(v_final_lines), 'reserved_components', (
        SELECT COUNT(*) FROM public.order_inventory_reservations
        WHERE order_id = v_order_id
      )));
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_order_base_units_legacy(
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_location_source TEXT DEFAULT 'manual',
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_customer_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'website'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id UUID;
  v_customer_is_blocked BOOLEAN;
  v_customer_is_active BOOLEAN;
  v_customer_reused BOOLEAN := false;
  v_customer_phone TEXT :=
    public.normalize_customer_phone(p_customer_phone);
  v_address_id UUID;
  v_branch_id UUID := p_branch_id;
  v_warehouse_id UUID := p_warehouse_id;
  v_order_id UUID;
  v_order_number TEXT;
  v_item JSONB;
  v_prod_id UUID;
  v_qty INT;
  v_prod_name TEXT;
  v_prod_sku TEXT;
  v_unit_price BIGINT;
  v_is_active BOOLEAN;
  v_on_hand INT;
  v_reserved INT;
  v_available INT;
  v_line_total BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
BEGIN
  IF NULLIF(TRIM(p_customer_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'اسم العميل مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;
  IF NULLIF(v_customer_phone, '') IS NULL
    OR v_customer_phone !~ '^[0-9]{9,15}$'
  THEN
    RAISE EXCEPTION 'رقم هاتف العميل غير صحيح.';
  END IF;
  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة الطلب فارغة، يجب تقديم صنف واحد على الأقل.';
  END IF;
  IF COALESCE(p_delivery_fee_in_minor_units, 0) < 0
    OR COALESCE(p_discount_in_minor_units, 0) < 0
  THEN
    RAISE EXCEPTION 'رسوم التوصيل والخصم لا يمكن أن تكون سالبة.';
  END IF;
  IF COALESCE(p_location_source, 'manual')
    NOT IN ('gps', 'map_pin', 'manual')
  THEN
    RAISE EXCEPTION 'مصدر موقع التوصيل غير معتمد.';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'يجب إدخال خط العرض وخط الطول معاً.';
  END IF;
  IF p_latitude IS NOT NULL
    AND (
      p_latitude NOT BETWEEN -90 AND 90
      OR p_longitude NOT BETWEEN -180 AND 180
    )
  THEN
    RAISE EXCEPTION 'إحداثيات موقع التوصيل غير صحيحة.';
  END IF;

  IF v_branch_id IS NULL THEN
    SELECT id
    INTO v_branch_id
    FROM public.branches
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    SELECT id
    INTO v_warehouse_id
    FROM public.warehouses
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على مستودع فعال لمعالجة الطلب.';
  END IF;

  -- One transaction at a time may resolve a specific customer phone.
  PERFORM pg_advisory_xact_lock(hashtext(v_customer_phone)::BIGINT);

  SELECT id, is_blocked, is_active
  INTO
    v_customer_id,
    v_customer_is_blocked,
    v_customer_is_active
  FROM public.customers
  WHERE public.normalize_customer_phone(phone) = v_customer_phone
    AND is_deleted = false
  LIMIT 1
  FOR UPDATE;

  IF v_customer_id IS NOT NULL THEN
    IF v_customer_is_blocked OR NOT v_customer_is_active THEN
      RAISE EXCEPTION
        'لا يمكن إنشاء طلب لهذا العميل لأن ملفه موقوف أو محظور.';
    END IF;

    v_customer_reused := true;

    IF NOT (auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website') THEN
    UPDATE public.customers
    SET
      full_name = TRIM(p_customer_full_name),
      phone = v_customer_phone,
      email = COALESCE(NULLIF(TRIM(p_customer_email), ''), email),
      governorate = COALESCE(
        NULLIF(TRIM(p_governorate), ''),
        governorate
      ),
      updated_at = NOW()
    WHERE id = v_customer_id;
    END IF;
  ELSE
    INSERT INTO public.customers (
      full_name,
      phone,
      email,
      governorate,
      customer_type,
      is_active,
      is_blocked,
      is_deleted
    ) VALUES (
      TRIM(p_customer_full_name),
      v_customer_phone,
      NULLIF(TRIM(p_customer_email), ''),
      NULLIF(TRIM(p_governorate), ''),
      'retail',
      true,
      false,
      false
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- The latest website delivery address becomes the single default address.
  IF NOT (v_customer_reused AND auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website') THEN
  UPDATE public.customer_addresses
  SET is_default = false
  WHERE customer_id = v_customer_id
    AND is_default = true;
  END IF;

  v_formatted_address := COALESCE(
    NULLIF(TRIM(p_formatted_address), ''),
    NULLIF(
      CONCAT_WS(
        ' - ',
        NULLIF(TRIM(p_governorate), ''),
        NULLIF(TRIM(p_city), ''),
        NULLIF(TRIM(p_area), ''),
        NULLIF(TRIM(p_street), ''),
        NULLIF(TRIM(p_building), '')
      ),
      ''
    )
  );
  v_google_maps_url := COALESCE(
    NULLIF(TRIM(p_google_maps_url), ''),
    CASE
      WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL
      THEN
        'https://www.google.com/maps?q='
        || p_latitude::TEXT
        || ','
        || p_longitude::TEXT
      ELSE NULL
    END
  );

  INSERT INTO public.customer_addresses (
    customer_id,
    governorate,
    city,
    area,
    street,
    building,
    floor,
    apartment,
    notes,
    latitude,
    longitude,
    formatted_address,
    google_maps_url,
    location_source,
    location_confirmed,
    is_default
  ) VALUES (
    v_customer_id,
    NULLIF(TRIM(p_governorate), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), ''),
    NULLIF(TRIM(p_floor), ''),
    NULLIF(TRIM(p_apartment), ''),
    NULLIF(TRIM(p_address_notes), ''),
    p_latitude,
    p_longitude,
    v_formatted_address,
    v_google_maps_url,
    COALESCE(p_location_source, 'manual'),
    p_latitude IS NOT NULL AND p_longitude IS NOT NULL,
    NOT (v_customer_reused AND auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website')
  )
  RETURNING id INTO v_address_id;

  -- Prices and availability are canonical and locked server-side.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_prod_id := (v_item->>'product_id')::UUID;
      v_qty := (v_item->>'quantity')::INT;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات صنف الطلب غير صحيحة.';
    END;

    IF v_prod_id IS NULL THEN
      RAISE EXCEPTION 'معرف المنتج مفقود في عناصر الطلب.';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'كمية المنتج يجب أن تكون أكبر من صفر.';
    END IF;

    SELECT name_ar, sku, sale_price_in_minor_units, is_active
    INTO v_prod_name, v_prod_sku, v_unit_price, v_is_active
    FROM public.products
    WHERE id = v_prod_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'المنتج المحدد برقم (%) غير موجود في النظام.',
        v_prod_id;
    END IF;
    IF NOT v_is_active THEN
      RAISE EXCEPTION
        'المنتج (%) غير نشط حالياً ولا يمكن طلبه.',
        v_prod_name;
    END IF;

    SELECT on_hand_quantity, reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_prod_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'المنتج (%) غير مسجل له رصيد في المستودع المحدد.',
        v_prod_name;
    END IF;

    v_available := v_on_hand - v_reserved;
    IF v_available < v_qty THEN
      RAISE EXCEPTION
        'الكمية المتاحة للمنتج (%) غير كافية. المتاح: %، المطلوب: %.',
        v_prod_name,
        v_available,
        v_qty;
    END IF;

    v_line_total := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total :=
    v_subtotal
    + COALESCE(p_delivery_fee_in_minor_units, 0)
    - COALESCE(p_discount_in_minor_units, 0);

  IF v_total < 0 THEN
    RAISE EXCEPTION 'قيمة الخصم أكبر من إجمالي الطلب.';
  END IF;

  LOOP
    v_order_number :=
      'ORD-'
      || TO_CHAR(NOW(), 'YYYYMMDD')
      || '-'
      || LPAD(
        (FLOOR(RANDOM() * 89999 + 10000))::TEXT,
        5,
        '0'
      );
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders
      WHERE order_number = v_order_number
    );
  END LOOP;

  INSERT INTO public.orders (
    order_number,
    customer_id,
    customer_address_id,
    customer_name_snapshot,
    branch_id,
    warehouse_id,
    status,
    payment_method,
    payment_status,
    subtotal_in_minor_units,
    delivery_fee_in_minor_units,
    discount_in_minor_units,
    total_in_minor_units,
    customer_notes,
    internal_notes,
    whatsapp_message,
    source
  ) VALUES (
    v_order_number,
    v_customer_id,
    v_address_id,
    TRIM(p_customer_full_name),
    v_branch_id,
    v_warehouse_id,
    'new',
    'cash_on_delivery',
    'unpaid',
    v_subtotal,
    COALESCE(p_delivery_fee_in_minor_units, 0),
    COALESCE(p_discount_in_minor_units, 0),
    v_total,
    NULLIF(TRIM(p_customer_notes), ''),
    NULLIF(TRIM(p_internal_notes), ''),
    'تم استلام طلبك رقم '
      || v_order_number
      || ' بقيمة إجمالية '
      || (v_total::NUMERIC / 1000)::TEXT
      || ' د.أ. سيتم التواصل معك لتأكيد التوصيل.',
    COALESCE(NULLIF(TRIM(p_source), ''), 'website')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::INT;

    SELECT name_ar, sku, sale_price_in_minor_units
    INTO v_prod_name, v_prod_sku, v_unit_price
    FROM public.products
    WHERE id = v_prod_id;

    v_line_total := v_unit_price * v_qty;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      quantity,
      unit_price_in_minor_units,
      line_total_in_minor_units
    ) VALUES (
      v_order_id,
      v_prod_id,
      v_prod_name,
      v_prod_sku,
      v_qty,
      v_unit_price,
      v_line_total
    );

    UPDATE public.inventory_balances
    SET
      reserved_quantity = reserved_quantity + v_qty,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_prod_id;
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    v_order_id,
    NULL,
    'new',
    v_user_id,
    'إنشاء الطلب وربطه بالعميل وحجز الكميات تلقائياً'
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'create_customer_order',
    'orders',
    v_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'customer_id', v_customer_id,
      'customer_phone', v_customer_phone,
      'customer_reused', v_customer_reused,
      'customer_address_id', v_address_id,
      'total_in_minor_units', v_total,
      'items_count', jsonb_array_length(p_items)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'customer_address_id', v_address_id,
    'customer_reused', v_customer_reused,
    'subtotal', v_subtotal,
    'total', v_total,
    'status', 'new',
    'message', 'تم إنشاء الطلب وربطه بملف العميل وحجز الكميات بنجاح.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.package_d_create_customer_order_before_source_guard_internal(
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_location_source TEXT DEFAULT 'manual',
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_customer_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'website'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_package_quantity INTEGER;
  v_units_per_package INTEGER;
  v_package_price BIGINT;
  v_package_name TEXT;
  v_base_quantity INTEGER;
  v_line_total BIGINT;
  v_exact_subtotal BIGINT := 0;
  v_exact_total BIGINT;
  v_base_items JSONB := '[]'::jsonb;
  v_line_snapshots JSONB := '[]'::jsonb;
  v_legacy_result JSONB;
  v_order_id UUID;
  v_customer_id UUID;
  v_order_number TEXT;
BEGIN
  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة الطلب فارغة، يجب اختيار طرد واحد على الأقل.';
  END IF;

  IF COALESCE(p_delivery_fee_in_minor_units, 0) < 0
    OR COALESCE(p_discount_in_minor_units, 0) < 0
  THEN
    RAISE EXCEPTION 'رسوم التوصيل والخصم لا يمكن أن تكون سالبة.';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::UUID;
      v_package_quantity := (v_item->>'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات أحد طرود الطلب غير صحيحة.';
    END;

    IF v_product_id IS NULL
      OR v_package_quantity IS NULL
      OR v_package_quantity <= 0
    THEN
      RAISE EXCEPTION 'كل صنف يحتاج منتجاً وعدد طرود صحيحاً أكبر من صفر.';
    END IF;

    SELECT
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(su.name_ar, 'طرد')
    INTO
      v_units_per_package,
      v_package_price,
      v_package_name
    FROM public.products p
    LEFT JOIN public.units su ON su.id = p.sale_unit_id
    WHERE p.id = v_product_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد منتجات الطلب غير متاح للبيع على الموقع.';
    END IF;

    IF COALESCE(v_units_per_package, 0) <= 0
      OR COALESCE(v_package_price, 0) <= 0
    THEN
      RAISE EXCEPTION 'طرد بيع المنتج غير مضبوط، تواصل مع إدارة المتجر.';
    END IF;

    v_base_quantity := v_package_quantity * v_units_per_package;
    v_line_total := v_package_quantity * v_package_price;
    v_exact_subtotal := v_exact_subtotal + v_line_total;

    v_base_items := v_base_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'quantity', v_base_quantity
      )
    );
    v_line_snapshots := v_line_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'package_quantity', v_package_quantity,
        'units_per_package', v_units_per_package,
        'package_name', v_package_name,
        'package_price', v_package_price,
        'line_total', v_line_total
      )
    );
  END LOOP;

  v_exact_total :=
    v_exact_subtotal
    + COALESCE(p_delivery_fee_in_minor_units, 0)
    - COALESCE(p_discount_in_minor_units, 0);

  IF v_exact_total < 0 THEN
    RAISE EXCEPTION 'قيمة الخصم أكبر من إجمالي الطلب.';
  END IF;

  v_legacy_result :=
    public.create_customer_order_base_units_legacy(
      p_customer_full_name,
      p_customer_phone,
      p_customer_email,
      p_governorate,
      p_city,
      p_area,
      p_street,
      p_building,
      p_floor,
      p_apartment,
      p_address_notes,
      p_latitude,
      p_longitude,
      p_formatted_address,
      p_google_maps_url,
      p_location_source,
      p_branch_id,
      p_warehouse_id,
      v_base_items,
      p_delivery_fee_in_minor_units,
      0,
      p_customer_notes,
      p_internal_notes,
      p_source
    );

  IF NOT COALESCE((v_legacy_result->>'success')::BOOLEAN, false) THEN
    RETURN v_legacy_result;
  END IF;

  v_order_id := (v_legacy_result->>'order_id')::UUID;
  v_customer_id := (v_legacy_result->>'customer_id')::UUID;
  v_order_number := v_legacy_result->>'order_number';

  IF NOT (COALESCE((v_legacy_result->>'customer_reused')::BOOLEAN, false) AND auth.role() IS NOT DISTINCT FROM 'service_role' AND COALESCE(NULLIF(TRIM(p_source), ''), 'website') = 'website') THEN
  UPDATE public.customers
  SET customer_type = 'wholesale', updated_at = NOW()
  WHERE id = v_customer_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_line_snapshots)
  LOOP
    UPDATE public.order_items
    SET
      sale_package_quantity =
        (v_item->>'package_quantity')::INTEGER,
      units_per_sale_package =
        (v_item->>'units_per_package')::INTEGER,
      sale_package_name_snapshot = v_item->>'package_name',
      sale_package_price_in_minor_units =
        (v_item->>'package_price')::BIGINT,
      line_total_in_minor_units =
        (v_item->>'line_total')::BIGINT,
      cogs_in_minor_units =
        quantity * unit_cost_in_minor_units,
      profit_in_minor_units =
        (v_item->>'line_total')::BIGINT
        - (quantity * unit_cost_in_minor_units)
    WHERE order_id = v_order_id
      AND product_id = (v_item->>'product_id')::UUID;
  END LOOP;

  UPDATE public.orders
  SET
    subtotal_in_minor_units = v_exact_subtotal,
    discount_in_minor_units =
      COALESCE(p_discount_in_minor_units, 0),
    total_in_minor_units = v_exact_total,
    whatsapp_message =
      'تم استلام طلبك رقم '
      || v_order_number
      || ' بقيمة إجمالية '
      || (v_exact_total::NUMERIC / 1000)::TEXT
      || ' د.أ. سيتم التواصل معك لتأكيد التوصيل.',
    updated_at = NOW()
  WHERE id = v_order_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'APPLY_WHOLESALE_CUSTOMER_ORDER_ACCOUNTING',
    'orders',
    v_order_id,
    jsonb_build_object(
      'subtotal_in_minor_units', v_exact_subtotal,
      'delivery_fee_in_minor_units',
        COALESCE(p_delivery_fee_in_minor_units, 0),
      'discount_in_minor_units',
        COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_exact_total,
      'package_lines', v_line_snapshots
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'customer_address_id',
      v_legacy_result->>'customer_address_id',
    'customer_reused',
      COALESCE(
        (v_legacy_result->>'customer_reused')::BOOLEAN,
        false
      ),
    'subtotal', v_exact_subtotal,
    'total', v_exact_total,
    'status', 'new',
    'message', 'تم إنشاء طلب طرود الجملة وحجز حباتها من المخزون بدقة.'
  );
END;
$$;
