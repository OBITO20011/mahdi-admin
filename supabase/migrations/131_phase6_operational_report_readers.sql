BEGIN;

-- Phase 6 package A (docs/agent/PHASE6_A_REPORTS_SCOPE.md), rewritten after the
-- independent review with explicit definitions and no runtime text patching.
-- The existing readers keep their bodies unchanged behind renamed
-- private functions; explicit wrappers merge one shared financial-facts reader.
-- No tables, writers, triggers, or historical closing snapshots change.

-- -------------------------------------------------------------------------
-- Shared financial facts for one branch (or all branches) and one period.
-- Definitions: sale at first completion; modern return at settlement
-- (entitlement = debt reduction + money refund); legacy return at its
-- historical amount; money at movement time and actual tender; receivable =
-- total - coverage - debt reduction, clamped per order; costs independent.
-- Modern returns are counted only for V2 orders and legacy returns only for
-- non-V2 orders, so no order is counted twice even if a writer gap appears.
-- -------------------------------------------------------------------------
CREATE FUNCTION public.phase6_financial_facts_internal(
  p_branch_id UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_timezone TEXT,
  p_verify_evidence BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_facts JSONB;
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
    SELECT o.*, fc.at AS completion_at, creation.operation_type,
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
    FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id
    UNION ALL
    SELECT p.order_id, p.reversed_at, p.payment_method, 0, p.amount_in_minor_units, 0
    FROM public.customer_payments p JOIN order_scope o ON o.id = p.order_id WHERE p.is_reversed
    UNION ALL
    SELECT r.order_id, r.created_at, m.method, 0, m.amount, 0
    FROM public.pos_sale_reversals r JOIN order_scope o ON o.id = r.order_id
    CROSS JOIN LATERAL (VALUES
      ('cash', (r.actual_effect->>'cash_in_minor_units')::BIGINT),
      ('cliq', (r.actual_effect->>'cliq_in_minor_units')::BIGINT)) m(method, amount)
    WHERE m.amount > 0
    UNION ALL
    SELECT order_id, at, refund_method, 0, 0, refund FROM return_rows WHERE refund > 0
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
      COALESCE(SUM(refund) FILTER (WHERE method = 'cash'), 0)::BIGINT AS cash_refunded,
      COALESCE(SUM(refund) FILTER (WHERE method = 'cliq'), 0)::BIGINT AS cliq_refunded
    FROM money_events WHERE at >= p_period_start AND at < p_period_end
  ), balances AS (
    SELECT COALESCE(SUM(due), 0)::BIGINT AS due,
      COUNT(*) FILTER (WHERE due > 0) AS orders,
      COUNT(DISTINCT customer_id) FILTER (WHERE due > 0) AS customers
    FROM positions WHERE status IN ('completed', 'returned')
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
  ), days AS (
    SELECT day::DATE AS day FROM generate_series((p_period_start AT TIME ZONE p_timezone)::DATE,
      (p_period_end AT TIME ZONE p_timezone)::DATE - 1, INTERVAL '1 day') day
  ), daily AS (
    SELECT d.day,
      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS gross,
      (SELECT COUNT(*) FROM period_sales o
        WHERE (o.completion_at AT TIME ZONE p_timezone)::DATE = d.day)::BIGINT AS count,
      COALESCE((SELECT SUM(r.entitlement) FROM return_rows r
        WHERE r.at >= p_period_start AND r.at < p_period_end
          AND (r.at AT TIME ZONE p_timezone)::DATE = d.day), 0)::BIGINT AS returned
    FROM days d
  ) SELECT jsonb_build_object(
    'sales', jsonb_build_object('grossSalesInMinorUnits', s.gross, 'deliveryFeesInMinorUnits', s.delivery,
      'returnEntitlementInMinorUnits', r.entitlement, 'refundsInMinorUnits', r.refund,
      'debtReductionInMinorUnits', r.debt, 'netSalesInMinorUnits', s.gross - r.entitlement,
      'cogsInMinorUnits', c.cogs, 'replacementCostInMinorUnits', rc.cost,
      'restockRecoveryInMinorUnits', r.recovery, 'grossProfitInMinorUnits', s.gross - s.delivery - c.cogs,
      'aftercareAdjustedMarginInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery,
      'netProfitInMinorUnits', s.gross - r.entitlement - c.cogs - rc.cost + r.recovery - x.amount,
      'collectedInMinorUnits', co.coverage, 'outstandingInMinorUnits', co.due, 'returnCount', r.count,
      'orderCount', s.count, 'completedOrderCount', s.count),
    'cashFlow', jsonb_build_object('cashCollectedInMinorUnits', f.cash_received,
      'cliqCollectedInMinorUnits', f.cliq_received, 'cashRefundedInMinorUnits', f.cash_refunded,
      'cliqRefundedInMinorUnits', f.cliq_refunded, 'cashNetFlowInMinorUnits', f.cash_received - f.cash_refunded,
      'cliqNetFlowInMinorUnits', f.cliq_received - f.cliq_refunded),
    'balances', jsonb_build_object('customerDueInMinorUnits', b.due, 'customerOrderCount', b.orders,
      'customerCount', b.customers),
    'expenses', jsonb_build_object('totalInMinorUnits', x.amount, 'cashInMinorUnits', x.cash,
      'cliqInMinorUnits', x.cliq, 'count', x.count),
    'dailyBreakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day,
      'completedOrderCount', count, 'grossSalesInMinorUnits', gross,
      'returnEntitlementInMinorUnits', returned, 'netSalesInMinorUnits', gross - returned)
      ORDER BY day), '[]'::JSONB) FROM daily)
  ) INTO v_facts
  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c
    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b
    CROSS JOIN cohort co CROSS JOIN expenses x;

  RETURN v_facts;
END;
$$;

REVOKE ALL ON FUNCTION public.phase6_financial_facts_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.phase6_financial_facts_internal(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, BOOLEAN)
  OWNER TO postgres;

-- -------------------------------------------------------------------------
-- Operational report (Reports Center / print / AI monthly per branch).
-- -------------------------------------------------------------------------
ALTER FUNCTION public.get_operational_business_report(UUID, DATE, DATE)
  RENAME TO _get_operational_business_report_before_phase6;
REVOKE ALL ON FUNCTION public._get_operational_business_report_before_phase6(UUID, DATE, DATE)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_operational_business_report(
  p_branch_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report JSONB;
  v_facts JSONB;
BEGIN
  -- The inner reader authorizes the caller and validates the period first.
  v_report := public._get_operational_business_report_before_phase6(p_branch_id, p_date_from, p_date_to);
  v_facts := public.phase6_financial_facts_internal(
    p_branch_id,
    p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman',
    'Asia/Amman',
    true
  );
  v_report := jsonb_set(v_report, '{sales}', (v_report->'sales') || (v_facts->'sales'));
  v_report := jsonb_set(v_report, '{balances}', (v_report->'balances') || (v_facts->'balances'));
  v_report := jsonb_set(v_report, '{expenses}', (v_report->'expenses') || (v_facts->'expenses'));
  RETURN v_report || jsonb_build_object('cashFlow', v_facts->'cashFlow');
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE) TO authenticated;
ALTER FUNCTION public._get_operational_business_report_before_phase6(UUID, DATE, DATE) OWNER TO postgres;
ALTER FUNCTION public.get_operational_business_report(UUID, DATE, DATE) OWNER TO postgres;

-- -------------------------------------------------------------------------
-- Daily/weekly Business summary (service-role scheduler only).
-- -------------------------------------------------------------------------
ALTER FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ)
  RENAME TO _build_business_summary_before_phase6;
REVOKE ALL ON FUNCTION public._build_business_summary_before_phase6(TEXT, DATE, DATE, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.build_business_summary(
  p_summary_type TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_generated_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_facts JSONB;
  v_timezone TEXT;
BEGIN
  -- The inner builder validates the period and the configured timezone.
  v_result := public._build_business_summary_before_phase6(
    p_summary_type, p_period_start, p_period_end, p_generated_at
  );
  SELECT business_timezone INTO STRICT v_timezone
  FROM public.business_alert_settings WHERE id = true;
  v_facts := public.phase6_financial_facts_internal(
    NULL,
    p_period_start::TIMESTAMP AT TIME ZONE v_timezone,
    (p_period_end + 1)::TIMESTAMP AT TIME ZONE v_timezone,
    v_timezone,
    true
  );
  v_result := jsonb_set(v_result, '{sales}', (v_result->'sales') || (v_facts->'sales'));
  v_result := jsonb_set(v_result, '{balances}', (v_result->'balances') || (v_facts->'balances'));
  v_result := jsonb_set(v_result, '{expenses}', (v_result->'expenses') || (v_facts->'expenses'));
  v_result := v_result || jsonb_build_object(
    'cashFlow', v_facts->'cashFlow',
    'dailyBreakdown', v_facts->'dailyBreakdown'
  );
  IF jsonb_typeof(v_result) <> 'object'
    OR octet_length(v_result::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Business summary payload is invalid or too large.';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ) TO service_role;
ALTER FUNCTION public._build_business_summary_before_phase6(TEXT, DATE, DATE, TIMESTAMPTZ) OWNER TO postgres;
ALTER FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ) OWNER TO postgres;

-- -------------------------------------------------------------------------
-- Home dashboard: two fact reads (month, last seven days incl. today) instead
-- of three. Corrupt evidence degrades the financial cards instead of failing
-- the whole home page for every role; reports and summaries stay strict.
-- -------------------------------------------------------------------------
ALTER FUNCTION public.get_home_dashboard() RENAME TO _get_home_dashboard_before_phase6;
REVOKE ALL ON FUNCTION public._get_home_dashboard_before_phase6()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_home_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_home JSONB;
  v_business_date DATE := (NOW() AT TIME ZONE 'Asia/Amman')::DATE;
  v_today_start TIMESTAMPTZ;
  v_tomorrow_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_month JSONB;
  v_week JSONB;
  v_today JSONB;
  v_can_view_profit BOOLEAN;
BEGIN
  -- The inner reader authorizes every home role and computes non-financial cards.
  v_home := public._get_home_dashboard_before_phase6();
  v_can_view_profit := COALESCE((v_home #>> '{access,canViewProfit}')::BOOLEAN, false);
  v_today_start := v_business_date::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_tomorrow_start := (v_business_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_month_start := date_trunc('month', v_business_date::TIMESTAMP) AT TIME ZONE 'Asia/Amman';

  BEGIN
    v_month := public.phase6_financial_facts_internal(
      NULL, v_month_start, v_tomorrow_start, 'Asia/Amman', true);
    v_week := public.phase6_financial_facts_internal(
      NULL, v_today_start - INTERVAL '6 days', v_tomorrow_start, 'Asia/Amman', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN v_home || jsonb_build_object('financialFactsStatus', 'unavailable');
  END;

  SELECT day INTO v_today
  FROM jsonb_array_elements(v_week->'dailyBreakdown') day
  WHERE (day->>'date')::DATE = v_business_date;

  v_home := jsonb_set(v_home, '{summary}', (v_home->'summary') || jsonb_build_object(
    'todaySalesInMinorUnits', COALESCE((v_today->>'grossSalesInMinorUnits')::BIGINT, 0),
    'todayCompletedOrders', COALESCE((v_today->>'completedOrderCount')::INTEGER, 0),
    'todayNetSalesInMinorUnits', COALESCE((v_today->>'netSalesInMinorUnits')::BIGINT, 0),
    'monthSalesInMinorUnits', v_month #> '{sales,grossSalesInMinorUnits}',
    'monthNetSalesInMinorUnits', v_month #> '{sales,netSalesInMinorUnits}',
    'monthProfitInMinorUnits',
      CASE WHEN v_can_view_profit THEN v_month #> '{sales,netProfitInMinorUnits}' ELSE 'null'::JSONB END,
    'customerReceivablesInMinorUnits', v_month #> '{balances,customerDueInMinorUnits}'
  ));
  RETURN v_home || jsonb_build_object(
    'financialFactsStatus', 'available',
    'sevenDaySales', (SELECT COALESCE(jsonb_agg(day || jsonb_build_object(
        'salesInMinorUnits', day->'grossSalesInMinorUnits',
        'dayLabel', to_char((day->>'date')::DATE, 'Dy')
      ) ORDER BY day->>'date'), '[]'::JSONB)
      FROM jsonb_array_elements(v_week->'dailyBreakdown') day)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_home_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard() TO authenticated;
ALTER FUNCTION public._get_home_dashboard_before_phase6() OWNER TO postgres;
ALTER FUNCTION public.get_home_dashboard() OWNER TO postgres;

-- -------------------------------------------------------------------------
-- Live closing report (item 2): Migration 128 body plus a per-physical-leaf
-- quantity breakdown. Money stays event-level; no per-item allocation. The
-- public snapshot reader (094) still returns persisted snapshots unchanged.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report JSONB;
  v_event_count INTEGER := 0;
  v_breakdown JSONB;
  v_quantity_breakdown JSONB;
BEGIN
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);
  IF COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0;

  IF v_event_count > 0 THEN
    WITH combined AS (
      SELECT
        item->>'refundMethod' AS refund_method,
        item->>'stockDisposition' AS stock_disposition,
        COALESCE((item->>'count')::INTEGER, 0) AS item_count,
        COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
      FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
      UNION ALL
      SELECT
        return_event.refund_method,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.sales_return_items return_item
          WHERE return_item.sales_return_event_id = return_event.id
            AND return_item.stock_disposition = 'damaged'
        ) THEN 'damaged' ELSE 'restock' END,
        1,
        return_event.money_refund_amount_in_minor_units
      FROM public.sales_return_events return_event
      WHERE return_event.cash_shift_id = p_shift_id
        AND return_event.settlement_status = 'settled'
        AND return_event.money_refund_amount_in_minor_units > 0
    ), grouped AS (
      SELECT refund_method, stock_disposition,
        SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
      FROM combined
      GROUP BY refund_method, stock_disposition
    )
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'refundMethod', refund_method,
        'stockDisposition', stock_disposition,
        'count', item_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, refund_method, stock_disposition
    ), '[]'::JSONB)
    INTO v_breakdown
    FROM grouped;

    v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
    v_report := jsonb_set(
      v_report,
      '{outflows,returnCount}',
      to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
      true
    );
  END IF;

  WITH quantities AS (
    -- Modern allocated returns preserve three independent buckets per physical
    -- leaf. A root inspection's accepted disposition cannot classify all its
    -- accepted quantity: it may contain both sellable and supplier-defect units.
    SELECT e.id AS event_id, (leaf->>'product_id')::UUID AS product_id,
      (leaf->>'sellable_restock_quantity')::INTEGER AS sellable,
      (leaf->>'defect_non_sellable_quantity')::INTEGER AS defect,
      (leaf->>'customer_damage_quantity')::INTEGER AS damage
    FROM public.sales_return_events e
    JOIN public.business_operations op ON op.id = e.operation_id
    CROSS JOIN LATERAL jsonb_array_elements(op.request_identity_snapshot->'physical_sources') leaf
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND jsonb_typeof(op.request_identity_snapshot->'physical_sources') = 'array'
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN i.stock_disposition = 'restock' THEN i.accepted_base_quantity ELSE 0 END,
      CASE WHEN i.stock_disposition = 'damaged' THEN i.accepted_base_quantity ELSE 0 END,
      i.rejected_base_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND i.return_scope = 'base_unit'
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, c.product_id,
      CASE WHEN c.accepted_stock_disposition = 'restock' THEN c.accepted_quantity ELSE 0 END,
      CASE WHEN c.accepted_stock_disposition = 'non_sellable' THEN c.accepted_quantity ELSE 0 END,
      c.rejected_quantity
    FROM public.sales_return_events e
    JOIN public.sales_return_items i ON i.sales_return_event_id = e.id
    JOIN public.sales_return_component_inspections c ON c.sales_return_item_id = i.id
    JOIN public.business_operations op ON op.id = e.operation_id
    WHERE e.cash_shift_id = p_shift_id AND e.settlement_status = 'settled' AND e.contract_version = 401
      AND NOT (op.request_identity_snapshot ? 'physical_sources')
    UNION ALL
    SELECT e.id, i.product_id,
      CASE WHEN e.stock_disposition = 'restock' THEN i.quantity ELSE 0 END,
      CASE WHEN e.stock_disposition = 'damaged' THEN i.quantity ELSE 0 END,
      0
    FROM public.sales_returns e
    JOIN public.order_items i ON i.order_id = e.order_id
    WHERE e.cash_shift_id = p_shift_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventId', q.event_id, 'productId', q.product_id,
    'productName', COALESCE(p.name_ar, 'صنف تاريخي'),
    'sellableQuantity', q.sellable, 'defectQuantity', q.defect,
    'customerDamageQuantity', q.damage) ORDER BY q.event_id, q.product_id), '[]'::JSONB)
  INTO v_quantity_breakdown
  FROM quantities q LEFT JOIN public.products p ON p.id = q.product_id;

  RETURN v_report || jsonb_build_object('returnQuantityBreakdown', v_quantity_breakdown);
END;
$$;

REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
