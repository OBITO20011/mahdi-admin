-- =========================================================================
-- Nawasrah ERP - Daily and weekly Business summaries
--
-- Generates bounded, deduplicated owner summaries from the same audited
-- sources and formulas used by the operational report. Delivery continues
-- through the existing hardened Business outbox; no new recipient or channel
-- is introduced.
-- =========================================================================

BEGIN;

ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;
ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check CHECK (event_type IN (
    'new_order',
    'low_stock',
    'out_of_stock',
    'shift_closed',
    'order_unprocessed',
    'order_near_expiry',
    'order_expired',
    'shift_close_reminder',
    'shift_close_overdue',
    'purchase_order_overdue',
    'expense_daily_threshold',
    'business_alert_recovery',
    'business_daily_summary',
    'business_weekly_summary'
  ));

ALTER TABLE public.business_alert_settings
  ADD COLUMN daily_summary_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN daily_summary_local_time TIME NOT NULL DEFAULT TIME '08:00',
  ADD COLUMN weekly_summary_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN weekly_summary_iso_day SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN weekly_summary_local_time TIME NOT NULL DEFAULT TIME '09:00',
  ADD COLUMN summaries_activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.business_alert_settings
  ADD CONSTRAINT business_alert_settings_weekly_summary_day_check
  CHECK (weekly_summary_iso_day BETWEEN 1 AND 7);

CREATE TABLE public.business_summary_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_type TEXT NOT NULL CHECK (summary_type IN ('daily', 'weekly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  run_status TEXT NOT NULL CHECK (run_status IN ('queued', 'missed')),
  event_id UUID UNIQUE REFERENCES public.automation_events(id) ON DELETE RESTRICT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (summary_type = 'daily' AND period_start = period_end)
    OR
    (summary_type = 'weekly' AND period_end = period_start + 6)
  ),
  CHECK (
    (run_status = 'queued' AND event_id IS NOT NULL)
    OR
    (run_status = 'missed' AND event_id IS NULL)
  ),
  UNIQUE (summary_type, period_start, period_end)
);

CREATE INDEX idx_business_summary_runs_schedule
  ON public.business_summary_runs(summary_type, scheduled_for DESC, period_end DESC);

ALTER TABLE public.business_summary_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_summary_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_summary_runs TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_automation_event(
  p_event_key TEXT,
  p_event_type TEXT,
  p_entity_id UUID,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_event_key TEXT := NULLIF(TRIM(p_event_key), '');
  v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
BEGIN
  IF v_event_key IS NULL OR length(v_event_key) > 300 THEN
    RAISE EXCEPTION 'Invalid automation event key.';
  END IF;
  IF p_event_type NOT IN (
    'new_order', 'low_stock', 'out_of_stock', 'shift_closed',
    'order_unprocessed', 'order_near_expiry', 'order_expired',
    'shift_close_reminder', 'shift_close_overdue',
    'purchase_order_overdue', 'expense_daily_threshold',
    'business_alert_recovery', 'business_daily_summary',
    'business_weekly_summary'
  ) THEN
    RAISE EXCEPTION 'Invalid automation event type.';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'Automation event entity is required.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object'
    OR octet_length(v_payload::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Invalid automation event payload.';
  END IF;

  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload)
  VALUES (v_event_key, p_event_type, p_entity_id, v_payload)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.automation_events
    WHERE event_key = v_event_key;
  END IF;

  RETURN v_event_id;
END;
$$;

-- Internal report for the summary scheduler. Its financial formulas mirror
-- get_operational_business_report after migrations 078 and 083:
-- completion-event dating, completed/returned source orders, proportional
-- discount allocation, return recovery, and non-reversed expenses.
CREATE OR REPLACE FUNCTION public.build_business_summary(
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
  v_timezone TEXT;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF p_summary_type NOT IN ('daily', 'weekly')
    OR p_period_start IS NULL OR p_period_end IS NULL
    OR p_generated_at IS NULL
    OR (p_summary_type = 'daily' AND p_period_start <> p_period_end)
    OR (p_summary_type = 'weekly' AND p_period_end <> p_period_start + 6)
  THEN
    RAISE EXCEPTION 'Invalid Business summary period.';
  END IF;

  SELECT business_timezone INTO STRICT v_timezone
  FROM public.business_alert_settings WHERE id = true;
  v_period_start := p_period_start::TIMESTAMP AT TIME ZONE v_timezone;
  v_period_end := (p_period_end + 1)::TIMESTAMP AT TIME ZONE v_timezone;

  WITH completion_events AS (
    SELECT DISTINCT ON (osh.order_id)
      osh.order_id,
      osh.created_at AS completed_at
    FROM public.order_status_history osh
    JOIN public.orders o ON o.id = osh.order_id
    WHERE osh.new_status = 'completed'
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
  item_basis AS (
    SELECT
      co.id AS order_id,
      COALESCE(co.discount_in_minor_units, 0)::BIGINT AS order_discount,
      oi.id AS order_item_id,
      COALESCE(oi.line_total_in_minor_units, 0)::BIGINT AS line_total,
      COALESCE(oi.cogs_in_minor_units, 0)::BIGINT AS cogs,
      SUM(COALESCE(oi.line_total_in_minor_units, 0)) OVER (
        PARTITION BY co.id
      )::BIGINT AS lines_subtotal,
      ROW_NUMBER() OVER (
        PARTITION BY co.id ORDER BY oi.created_at NULLS LAST, oi.id
      ) AS allocation_rank
    FROM completed_orders co
    JOIN public.order_items oi ON oi.order_id = co.id
  ),
  base_allocations AS (
    SELECT *,
      CASE
        WHEN order_discount > 0 AND lines_subtotal > 0
          THEN (order_discount * line_total) / lines_subtotal
        ELSE 0
      END::BIGINT AS base_discount
    FROM item_basis
  ),
  discounted_items AS (
    SELECT *,
      (
        base_discount + CASE
          WHEN allocation_rank <= (
            order_discount - SUM(base_discount) OVER (PARTITION BY order_id)
          ) THEN 1 ELSE 0
        END
      )::BIGINT AS allocated_discount
    FROM base_allocations
  ),
  sales AS (
    SELECT
      COUNT(*)::INTEGER AS order_count,
      COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS gross_sales,
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method IN ('cash', 'cash_on_delivery')
      ), 0)::BIGINT AS cash_sales,
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'cliq'
      ), 0)::BIGINT AS cliq_sales,
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'debt'
      ), 0)::BIGINT AS credit_sales,
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE COALESCE(payment_method, 'unknown') NOT IN (
          'cash', 'cash_on_delivery', 'cliq', 'debt'
        )
      ), 0)::BIGINT AS other_sales
    FROM completed_orders
  ),
  item_totals AS (
    SELECT
      COALESCE(SUM(cogs), 0)::BIGINT AS cogs,
      COALESCE(SUM(line_total - allocated_discount - cogs), 0)::BIGINT
        AS gross_profit,
      COALESCE(SUM(allocated_discount), 0)::BIGINT AS allocated_discounts
    FROM discounted_items
  ),
  returns AS (
    SELECT
      COUNT(*)::INTEGER AS return_count,
      COALESCE(SUM(sr.refund_amount_in_minor_units), 0)::BIGINT AS refunds,
      COALESCE((
        SELECT SUM(oi.cogs_in_minor_units)
        FROM public.sales_returns restocked_return
        JOIN public.order_items oi ON oi.order_id = restocked_return.order_id
        WHERE restocked_return.stock_disposition = 'restock'
          AND restocked_return.created_at >= v_period_start
          AND restocked_return.created_at < v_period_end
      ), 0)::BIGINT AS recovered_cogs
    FROM public.sales_returns sr
    WHERE sr.created_at >= v_period_start AND sr.created_at < v_period_end
  ),
  expenses AS (
    SELECT
      COUNT(*)::INTEGER AS expense_count,
      COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS total_expenses,
      COALESCE(SUM(amount_in_minor_units) FILTER (
        WHERE payment_method = 'cash'
      ), 0)::BIGINT AS cash_expenses,
      COALESCE(SUM(amount_in_minor_units) FILTER (
        WHERE payment_method = 'cliq'
      ), 0)::BIGINT AS cliq_expenses
    FROM public.operational_expenses
    WHERE created_at >= v_period_start AND created_at < v_period_end
      AND COALESCE(is_reversed, false) = false
  ),
  purchases AS (
    SELECT
      COUNT(*)::INTEGER AS receipt_count,
      COALESCE(SUM(total_in_minor_units), 0)::BIGINT AS total_purchases,
      COALESCE(SUM(amount_paid_in_minor_units), 0)::BIGINT AS paid,
      COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS due
    FROM public.supplier_receipts
    WHERE status = 'completed'
      AND received_at >= v_period_start AND received_at < v_period_end
  ),
  receivables AS (
    SELECT
      COUNT(*) FILTER (
        WHERE GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0) > 0
      )::INTEGER AS order_count,
      COUNT(DISTINCT customer_id) FILTER (
        WHERE GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0) > 0
      )::INTEGER AS customer_count,
      COALESCE(SUM(
        GREATEST(total_in_minor_units - amount_paid_in_minor_units, 0)
      ), 0)::BIGINT AS due
    FROM public.orders
    WHERE status = 'completed'
      AND payment_status IN ('unpaid', 'partially_paid')
  ),
  payables AS (
    SELECT
      COUNT(*) FILTER (WHERE current_balance_in_minor_units > 0)::INTEGER
        AS supplier_count,
      COALESCE(SUM(current_balance_in_minor_units), 0)::BIGINT AS due
    FROM public.suppliers
    WHERE COALESCE(is_active, true) = true
  ),
  inventory AS (
    SELECT
      COUNT(*) FILTER (
        WHERE p.is_active = true AND ib.available_quantity = 0
      )::INTEGER AS out_of_stock,
      COUNT(*) FILTER (
        WHERE p.is_active = true
          AND ib.available_quantity > 0
          AND ib.available_quantity <= p.min_stock_level
      )::INTEGER AS low_stock
    FROM public.inventory_balances ib
    JOIN public.products p ON p.id = ib.product_id
    JOIN public.warehouses w ON w.id = ib.warehouse_id
    WHERE w.is_active = true
  ),
  shifts AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'open')::INTEGER AS open_count,
      COUNT(*) FILTER (
        WHERE status = 'closed'
          AND closed_at >= v_period_start AND closed_at < v_period_end
      )::INTEGER AS closed_count,
      COUNT(*) FILTER (
        WHERE status = 'closed'
          AND closed_at >= v_period_start AND closed_at < v_period_end
          AND COALESCE(cash_discrepancy_in_minor_units, 0) <> 0
      )::INTEGER AS discrepancy_count,
      COALESCE(SUM(cash_discrepancy_in_minor_units) FILTER (
        WHERE status = 'closed'
          AND closed_at >= v_period_start AND closed_at < v_period_end
      ), 0)::BIGINT AS net_discrepancy
    FROM public.cash_shifts
  ),
  expired_orders AS (
    SELECT COUNT(DISTINCT osh.order_id)::INTEGER AS expired_count
    FROM public.order_status_history osh
    JOIN public.orders o ON o.id = osh.order_id
    WHERE osh.new_status = 'expired' AND o.source = 'website'
      AND osh.created_at >= v_period_start AND osh.created_at < v_period_end
  ),
  open_incident_rows AS (
    SELECT alert_type, COUNT(*)::INTEGER AS incident_count
    FROM public.business_alert_incidents
    WHERE state = 'open'
    GROUP BY alert_type
  ),
  open_incidents AS (
    SELECT
      COALESCE(SUM(incident_count), 0)::INTEGER AS total,
      COALESCE(jsonb_agg(
        jsonb_build_object('type', alert_type, 'count', incident_count)
        ORDER BY alert_type
      ), '[]'::JSONB) AS by_type
    FROM open_incident_rows
  ),
  daily_rows AS (
    SELECT
      day_value::DATE AS business_date,
      COUNT(co.id)::INTEGER AS order_count,
      COALESCE(SUM(co.total_in_minor_units), 0)::BIGINT AS gross_sales
    FROM generate_series(p_period_start, p_period_end, INTERVAL '1 day') day_value
    LEFT JOIN completed_orders co
      ON (co.completed_at AT TIME ZONE v_timezone)::DATE = day_value::DATE
    GROUP BY day_value::DATE
    ORDER BY day_value::DATE
  ),
  daily_breakdown AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'date', business_date,
        'completedOrderCount', order_count,
        'grossSalesInMinorUnits', gross_sales
      ) ORDER BY business_date
    ), '[]'::JSONB) AS payload
    FROM daily_rows
  )
  SELECT jsonb_build_object(
    'summaryType', p_summary_type,
    'generatedAt', p_generated_at,
    'period', jsonb_build_object(
      'dateFrom', p_period_start,
      'dateTo', p_period_end,
      'timezone', v_timezone
    ),
    'sales', jsonb_build_object(
      'completedOrderCount', sales.order_count,
      'grossSalesInMinorUnits', sales.gross_sales,
      'refundsInMinorUnits', returns.refunds,
      'netSalesInMinorUnits', sales.gross_sales - returns.refunds,
      'cashSalesInMinorUnits', sales.cash_sales,
      'cliqSalesInMinorUnits', sales.cliq_sales,
      'creditSalesInMinorUnits', sales.credit_sales,
      'otherSalesInMinorUnits', sales.other_sales,
      'cogsInMinorUnits', item_totals.cogs,
      'discountInMinorUnits', item_totals.allocated_discounts,
      'grossProfitInMinorUnits', item_totals.gross_profit,
      'netProfitInMinorUnits',
        item_totals.gross_profit - returns.refunds
        + returns.recovered_cogs - expenses.total_expenses,
      'returnCount', returns.return_count
    ),
    'expenses', jsonb_build_object(
      'count', expenses.expense_count,
      'totalInMinorUnits', expenses.total_expenses,
      'cashInMinorUnits', expenses.cash_expenses,
      'cliqInMinorUnits', expenses.cliq_expenses
    ),
    'inventory', jsonb_build_object(
      'lowStockCount', inventory.low_stock,
      'outOfStockCount', inventory.out_of_stock
    ),
    'balances', jsonb_build_object(
      'customerOrderCount', receivables.order_count,
      'customerCount', receivables.customer_count,
      'customerDueInMinorUnits', receivables.due,
      'supplierCount', payables.supplier_count,
      'supplierDueInMinorUnits', payables.due
    ),
    'purchases', jsonb_build_object(
      'receiptCount', purchases.receipt_count,
      'totalInMinorUnits', purchases.total_purchases,
      'paidInMinorUnits', purchases.paid,
      'dueInMinorUnits', purchases.due
    ),
    'shifts', jsonb_build_object(
      'openCount', shifts.open_count,
      'closedCount', shifts.closed_count,
      'cashDiscrepancyCount', shifts.discrepancy_count,
      'netCashDiscrepancyInMinorUnits', shifts.net_discrepancy
    ),
    'orders', jsonb_build_object(
      'expiredCount', expired_orders.expired_count
    ),
    'openIncidents', jsonb_build_object(
      'total', open_incidents.total,
      'byType', open_incidents.by_type
    ),
    'dailyBreakdown', daily_breakdown.payload
  ) INTO v_result
  FROM sales
  CROSS JOIN item_totals
  CROSS JOIN returns
  CROSS JOIN expenses
  CROSS JOIN purchases
  CROSS JOIN receivables
  CROSS JOIN payables
  CROSS JOIN inventory
  CROSS JOIN shifts
  CROSS JOIN expired_orders
  CROSS JOIN open_incidents
  CROSS JOIN daily_breakdown;

  IF jsonb_typeof(v_result) <> 'object'
    OR octet_length(v_result::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Business summary payload is invalid or too large.';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_business_summary(
  p_summary_type TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_scheduled_for TIMESTAMPTZ,
  p_generated_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run_id UUID;
  v_event_id UUID;
  v_event_key TEXT;
  v_event_type TEXT;
  v_payload JSONB;
BEGIN
  IF p_summary_type NOT IN ('daily', 'weekly') OR p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'Invalid Business summary enqueue request.';
  END IF;
  v_event_key := 'business_summary:' || p_summary_type || ':'
    || p_period_start::TEXT || ':' || p_period_end::TEXT;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_event_key, 0));

  SELECT id, event_id INTO v_run_id, v_event_id
  FROM public.business_summary_runs
  WHERE summary_type = p_summary_type
    AND period_start = p_period_start AND period_end = p_period_end;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'created', false,
      'runId', v_run_id, 'eventId', v_event_id
    );
  END IF;

  v_run_id := gen_random_uuid();
  v_payload := public.build_business_summary(
    p_summary_type, p_period_start, p_period_end, p_generated_at
  );
  v_event_type := CASE p_summary_type
    WHEN 'daily' THEN 'business_daily_summary'
    ELSE 'business_weekly_summary'
  END;
  v_event_id := public.enqueue_automation_event(
    v_event_key, v_event_type, v_run_id, v_payload
  );

  INSERT INTO public.business_summary_runs(
    id, summary_type, period_start, period_end, scheduled_for,
    run_status, event_id, generated_at
  ) VALUES (
    v_run_id, p_summary_type, p_period_start, p_period_end,
    p_scheduled_for, 'queued', v_event_id, p_generated_at
  );

  RETURN jsonb_build_object(
    'success', true, 'created', true,
    'runId', v_run_id, 'eventId', v_event_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_business_summaries(
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.business_alert_settings%ROWTYPE;
  v_local_now TIMESTAMP;
  v_latest_daily_due DATE;
  v_latest_weekly_due DATE;
  v_date DATE;
  v_due_at TIMESTAMPTZ;
  v_daily_created BOOLEAN := false;
  v_weekly_created BOOLEAN := false;
  v_missed INTEGER := 0;
  v_result JSONB;
BEGIN
  IF p_observed_at IS NULL THEN
    RAISE EXCEPTION 'Business summary observation time is required.';
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '25s', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('scan-business-summaries', 0));

  SELECT * INTO STRICT v_settings
  FROM public.business_alert_settings WHERE id = true;
  v_local_now := p_observed_at AT TIME ZONE v_settings.business_timezone;

  IF v_settings.daily_summary_enabled THEN
    v_latest_daily_due := v_local_now::DATE
      - CASE WHEN v_local_now::TIME < v_settings.daily_summary_local_time
        THEN 1 ELSE 0 END;
    FOR v_date IN
      SELECT day_value::DATE
      FROM generate_series(
        GREATEST(
          (v_settings.summaries_activated_at AT TIME ZONE v_settings.business_timezone)::DATE,
          v_latest_daily_due - 30
        ),
        v_latest_daily_due,
        INTERVAL '1 day'
      ) day_value
      ORDER BY day_value
    LOOP
      v_due_at := (v_date + v_settings.daily_summary_local_time)
        AT TIME ZONE v_settings.business_timezone;
      CONTINUE WHEN v_due_at < v_settings.summaries_activated_at
        OR v_due_at > p_observed_at
        OR v_date - 1 < (
          v_settings.summaries_activated_at AT TIME ZONE v_settings.business_timezone
        )::DATE;
      IF v_date < v_latest_daily_due THEN
        INSERT INTO public.business_summary_runs(
          summary_type, period_start, period_end, scheduled_for, run_status
        ) VALUES ('daily', v_date - 1, v_date - 1, v_due_at, 'missed')
        ON CONFLICT (summary_type, period_start, period_end) DO NOTHING;
        v_missed := v_missed + (FOUND)::INTEGER;
      ELSE
        v_result := public.enqueue_business_summary(
          'daily', v_date - 1, v_date - 1, v_due_at, p_observed_at
        );
        v_daily_created := COALESCE((v_result->>'created')::BOOLEAN, false);
      END IF;
    END LOOP;
  END IF;

  IF v_settings.weekly_summary_enabled THEN
    v_latest_weekly_due := v_local_now::DATE
      - MOD(
          EXTRACT(ISODOW FROM v_local_now::DATE)::INTEGER
          - v_settings.weekly_summary_iso_day + 7,
          7
        );
    IF v_latest_weekly_due = v_local_now::DATE
      AND v_local_now::TIME < v_settings.weekly_summary_local_time
    THEN
      v_latest_weekly_due := v_latest_weekly_due - 7;
    END IF;

    FOR v_date IN
      SELECT due_date::DATE
      FROM generate_series(
        GREATEST(
          (v_settings.summaries_activated_at AT TIME ZONE v_settings.business_timezone)::DATE,
          v_latest_weekly_due - 56
        ),
        v_latest_weekly_due,
        INTERVAL '1 day'
      ) due_date
      WHERE EXTRACT(ISODOW FROM due_date)::INTEGER
        = v_settings.weekly_summary_iso_day
      ORDER BY due_date
    LOOP
      v_due_at := (v_date + v_settings.weekly_summary_local_time)
        AT TIME ZONE v_settings.business_timezone;
      CONTINUE WHEN v_due_at < v_settings.summaries_activated_at
        OR v_due_at > p_observed_at
        OR v_date - 7 < (
          v_settings.summaries_activated_at AT TIME ZONE v_settings.business_timezone
        )::DATE;
      IF v_date < v_latest_weekly_due THEN
        INSERT INTO public.business_summary_runs(
          summary_type, period_start, period_end, scheduled_for, run_status
        ) VALUES ('weekly', v_date - 7, v_date - 1, v_due_at, 'missed')
        ON CONFLICT (summary_type, period_start, period_end) DO NOTHING;
        v_missed := v_missed + (FOUND)::INTEGER;
      ELSE
        v_result := public.enqueue_business_summary(
          'weekly', v_date - 7, v_date - 1, v_due_at, p_observed_at
        );
        v_weekly_created := COALESCE((v_result->>'created')::BOOLEAN, false);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'dailyCreated', v_daily_created,
    'weeklyCreated', v_weekly_created,
    'missedRecorded', v_missed
  );
END;
$$;

-- Technical counters only: no sales, balances, customer data, or amounts are
-- exposed to the Developer channel.
CREATE OR REPLACE FUNCTION public.get_business_summary_monitoring_status()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH delivered AS (
    SELECT r.summary_type, MAX(r.period_end) AS latest_period_end
    FROM public.business_summary_runs r
    JOIN public.automation_event_deliveries d ON d.event_id = r.event_id
    WHERE r.run_status = 'queued'
      AND d.channel = 'telegram' AND d.status = 'delivered'
    GROUP BY r.summary_type
  ), metrics AS (
    SELECT
      COUNT(*) FILTER (
        WHERE r.run_status = 'missed'
          AND r.period_end > COALESCE(d.latest_period_end, DATE '-infinity')
      )::INTEGER AS unresolved_missed_periods,
      COUNT(*) FILTER (
        WHERE r.run_status = 'queued'
          AND r.generated_at <= NOW() - INTERVAL '15 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM public.automation_event_deliveries delivery
            WHERE delivery.event_id = r.event_id
              AND delivery.channel = 'telegram'
              AND delivery.status = 'delivered'
          )
      )::INTEGER AS overdue_deliveries
    FROM public.business_summary_runs r
    LEFT JOIN delivered d ON d.summary_type = r.summary_type
  )
  SELECT jsonb_build_object(
    'unresolvedMissedPeriods', unresolved_missed_periods,
    'overdueDeliveries', overdue_deliveries
  ) FROM metrics;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_event(TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.scan_business_summaries(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_business_summary_monitoring_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.scan_business_summaries(TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_business_summary_monitoring_status()
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule(jobid)
FROM cron.job WHERE jobname = 'scan-business-summaries';
SELECT cron.schedule(
  'scan-business-summaries',
  '*/5 * * * *',
  $$SELECT public.scan_business_summaries(NOW());$$
);

COMMENT ON TABLE public.business_summary_runs IS
  'Deduplicated daily/weekly Business summary schedule ledger; payloads remain in the hardened Business outbox.';
COMMENT ON FUNCTION public.build_business_summary(TEXT, DATE, DATE, TIMESTAMPTZ) IS
  'Private bounded Business summary report using the approved operational accounting sources and formulas.';
COMMENT ON FUNCTION public.get_business_summary_monitoring_status() IS
  'Private technical-only missed/overdue summary counters for Developer monitoring.';

COMMIT;
