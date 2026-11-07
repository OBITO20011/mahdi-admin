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
