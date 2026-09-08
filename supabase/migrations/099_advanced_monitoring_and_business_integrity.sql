-- =========================================================================
-- Nawasrah ERP - Advanced monitoring and Business integrity
--
-- Read-only integrity/performance/security checks with bounded state, an
-- owner-only AAL2 dashboard, and sanitized technical incident hand-off.
-- This migration never repairs or mutates Business source data.
-- =========================================================================

BEGIN;

ALTER TABLE public.automation_events
  DROP CONSTRAINT IF EXISTS automation_events_event_type_check;
ALTER TABLE public.automation_events
  ADD CONSTRAINT automation_events_event_type_check CHECK (event_type IN (
    'new_order', 'low_stock', 'out_of_stock', 'shift_closed',
    'order_unprocessed', 'order_near_expiry', 'order_expired',
    'shift_close_reminder', 'shift_close_overdue',
    'purchase_order_overdue', 'expense_daily_threshold',
    'business_alert_recovery', 'business_daily_summary',
    'business_weekly_summary', 'business_integrity_warning'
  ));

ALTER TABLE public.business_alert_incidents
  DROP CONSTRAINT IF EXISTS business_alert_incidents_alert_type_check;
ALTER TABLE public.business_alert_incidents
  ADD CONSTRAINT business_alert_incidents_alert_type_check CHECK (alert_type IN (
    'order_unprocessed', 'order_near_expiry',
    'shift_close_reminder', 'shift_close_overdue',
    'purchase_order_overdue', 'expense_daily_threshold',
    'business_integrity_warning'
  ));

CREATE TABLE public.advanced_monitoring_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  slow_rpc_mean_ms INTEGER NOT NULL DEFAULT 2000 CHECK (slow_rpc_mean_ms BETWEEN 250 AND 60000),
  slow_rpc_max_ms INTEGER NOT NULL DEFAULT 5000 CHECK (slow_rpc_max_ms BETWEEN 500 AND 120000),
  slow_rpc_min_calls INTEGER NOT NULL DEFAULT 5 CHECK (slow_rpc_min_calls BETWEEN 1 AND 1000),
  connection_warning_percent INTEGER NOT NULL DEFAULT 80 CHECK (connection_warning_percent BETWEEN 25 AND 95),
  connection_critical_percent INTEGER NOT NULL DEFAULT 90 CHECK (connection_critical_percent BETWEEN 50 AND 99),
  gateway_rate_limit_warning_count INTEGER NOT NULL DEFAULT 5 CHECK (gateway_rate_limit_warning_count BETWEEN 1 AND 10000),
  gateway_error_warning_count INTEGER NOT NULL DEFAULT 3 CHECK (gateway_error_warning_count BETWEEN 1 AND 10000),
  database_growth_warning_percent INTEGER NOT NULL DEFAULT 25 CHECK (database_growth_warning_percent BETWEEN 5 AND 500),
  database_growth_min_bytes BIGINT NOT NULL DEFAULT 104857600 CHECK (database_growth_min_bytes >= 1048576),
  runtime_incident_window_minutes INTEGER NOT NULL DEFAULT 30 CHECK (runtime_incident_window_minutes BETWEEN 5 AND 1440),
  monitoring_activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (connection_warning_percent < connection_critical_percent)
);

INSERT INTO public.advanced_monitoring_settings(id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.advanced_monitoring_checks (
  check_key TEXT PRIMARY KEY CHECK (check_key ~ '^[a-z0-9:_-]{3,120}$'),
  category TEXT NOT NULL CHECK (category IN (
    'database', 'inventory', 'accounting', 'orders', 'shifts',
    'automation', 'performance', 'security', 'runtime',
    'backup', 'infrastructure', 'deployment'
  )),
  source TEXT NOT NULL CHECK (source IN ('database', 'external')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'warning', 'critical', 'unknown')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  issue_count INTEGER NOT NULL DEFAULT 0 CHECK (issue_count >= 0),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 240),
  details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    jsonb_typeof(details) = 'object' AND octet_length(details::TEXT) <= 4096
  ),
  checked_at TIMESTAMPTZ NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_advanced_monitoring_checks_status
  ON public.advanced_monitoring_checks(status, category, checked_at DESC);

CREATE TABLE public.advanced_monitoring_metrics (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  last_scan_started_at TIMESTAMPTZ,
  last_scan_completed_at TIMESTAMPTZ,
  last_database_size_bytes BIGINT CHECK (last_database_size_bytes IS NULL OR last_database_size_bytes >= 0),
  last_database_size_observed_at TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_:-]{1,80}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.advanced_monitoring_metrics(id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.advanced_monitoring_runtime_incidents (
  fingerprint TEXT PRIMARY KEY CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  application TEXT NOT NULL CHECK (application = 'admin'),
  area TEXT NOT NULL CHECK (area IN ('admin_render', 'admin_global')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.advanced_monitoring_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advanced_monitoring_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advanced_monitoring_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advanced_monitoring_runtime_incidents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.advanced_monitoring_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.advanced_monitoring_checks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.advanced_monitoring_metrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.advanced_monitoring_runtime_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.advanced_monitoring_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.advanced_monitoring_checks TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.advanced_monitoring_metrics TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.advanced_monitoring_runtime_incidents TO service_role;

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
    'business_weekly_summary', 'business_integrity_warning'
  ) THEN
    RAISE EXCEPTION 'Invalid automation event type.';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'Automation event entity is required.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' OR octet_length(v_payload::TEXT) > 32768 THEN
    RAISE EXCEPTION 'Invalid automation event payload.';
  END IF;

  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload)
  VALUES (v_event_key, p_event_type, p_entity_id, v_payload)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id FROM public.automation_events WHERE event_key = v_event_key;
  END IF;
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._transition_business_alert_incident(
  p_incident_key TEXT,
  p_event_type TEXT,
  p_entity_id UUID,
  p_is_active BOOLEAN,
  p_observed_at TIMESTAMPTZ,
  p_payload JSONB DEFAULT '{}'::JSONB,
  p_emit_recovery BOOLEAN DEFAULT true
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_incident public.business_alert_incidents%ROWTYPE;
  v_occurrence INTEGER;
BEGIN
  IF p_incident_key IS NULL OR NULLIF(TRIM(p_incident_key), '') IS NULL
    OR length(p_incident_key) > 240 OR p_entity_id IS NULL OR p_observed_at IS NULL
    OR p_event_type NOT IN (
      'order_unprocessed', 'order_near_expiry',
      'shift_close_reminder', 'shift_close_overdue',
      'purchase_order_overdue', 'expense_daily_threshold',
      'business_integrity_warning'
    )
  THEN
    RAISE EXCEPTION 'Invalid Business alert incident transition.';
  END IF;

  SELECT * INTO v_incident FROM public.business_alert_incidents
  WHERE incident_key = p_incident_key FOR UPDATE;

  IF p_is_active THEN
    IF NOT FOUND THEN
      v_occurrence := 1;
      INSERT INTO public.business_alert_incidents(
        incident_key, alert_type, entity_id, state, occurrence,
        opened_at, last_seen_at, resolved_at, updated_at
      ) VALUES (
        p_incident_key, p_event_type, p_entity_id, 'open', v_occurrence,
        p_observed_at, p_observed_at, NULL, p_observed_at
      );
    ELSIF v_incident.state = 'resolved' THEN
      v_occurrence := v_incident.occurrence + 1;
      UPDATE public.business_alert_incidents
      SET alert_type=p_event_type, entity_id=p_entity_id, state='open',
          occurrence=v_occurrence, opened_at=p_observed_at,
          last_seen_at=p_observed_at, resolved_at=NULL, updated_at=p_observed_at
      WHERE incident_key=p_incident_key;
    ELSE
      UPDATE public.business_alert_incidents
      SET last_seen_at=p_observed_at, updated_at=p_observed_at
      WHERE incident_key=p_incident_key;
      RETURN 'unchanged';
    END IF;
    PERFORM public.enqueue_automation_event(
      'business:'||p_incident_key||':open:'||v_occurrence::TEXT,
      p_event_type, p_entity_id,
      COALESCE(p_payload,'{}'::JSONB)||jsonb_build_object(
        'incidentKey',p_incident_key,'state','open',
        'occurrence',v_occurrence,'observedAt',p_observed_at)
    );
    RETURN 'opened';
  END IF;

  IF NOT FOUND OR v_incident.state <> 'open' THEN RETURN 'unchanged'; END IF;
  UPDATE public.business_alert_incidents
  SET state='resolved', last_seen_at=p_observed_at, resolved_at=p_observed_at,
      updated_at=p_observed_at WHERE incident_key=p_incident_key;
  IF p_emit_recovery THEN
    PERFORM public.enqueue_automation_event(
      'business:'||p_incident_key||':resolved:'||v_incident.occurrence::TEXT,
      'business_alert_recovery', p_entity_id,
      COALESCE(p_payload,'{}'::JSONB)||jsonb_build_object(
        'incidentKey',p_incident_key,'resolvedAlertType',p_event_type,
        'state','resolved','occurrence',v_incident.occurrence,
        'observedAt',p_observed_at)
    );
  END IF;
  RETURN 'resolved';
END;
$$;

CREATE OR REPLACE FUNCTION public._set_advanced_monitoring_check(
  p_key TEXT, p_category TEXT, p_source TEXT, p_status TEXT,
  p_severity TEXT, p_issue_count INTEGER, p_summary TEXT,
  p_details JSONB, p_checked_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_key !~ '^[a-z0-9:_-]{3,120}$'
    OR p_category NOT IN ('database','inventory','accounting','orders','shifts','automation','performance','security','runtime','backup','infrastructure','deployment')
    OR p_source NOT IN ('database','external')
    OR p_status NOT IN ('healthy','warning','critical','unknown')
    OR p_severity NOT IN ('low','medium','high','critical')
    OR p_issue_count < 0 OR p_checked_at IS NULL
    OR NULLIF(TRIM(p_summary),'') IS NULL OR length(p_summary)>240
    OR jsonb_typeof(COALESCE(p_details,'{}'::JSONB)) <> 'object'
    OR octet_length(COALESCE(p_details,'{}'::JSONB)::TEXT)>4096
  THEN RAISE EXCEPTION 'Invalid monitoring check.'; END IF;

  INSERT INTO public.advanced_monitoring_checks(
    check_key,category,source,status,severity,issue_count,summary,details,
    checked_at,changed_at,updated_at
  ) VALUES (
    p_key,p_category,p_source,p_status,p_severity,p_issue_count,p_summary,
    COALESCE(p_details,'{}'::JSONB),p_checked_at,p_checked_at,p_checked_at
  ) ON CONFLICT (check_key) DO UPDATE SET
    category=EXCLUDED.category, source=EXCLUDED.source,
    status=EXCLUDED.status, severity=EXCLUDED.severity,
    issue_count=EXCLUDED.issue_count, summary=EXCLUDED.summary,
    details=EXCLUDED.details, checked_at=EXCLUDED.checked_at,
    changed_at=CASE
      WHEN advanced_monitoring_checks.status IS DISTINCT FROM EXCLUDED.status
        OR advanced_monitoring_checks.issue_count IS DISTINCT FROM EXCLUDED.issue_count
      THEN EXCLUDED.checked_at ELSE advanced_monitoring_checks.changed_at END,
    updated_at=EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, cron, pg_temp
AS $$
DECLARE
  v_settings public.advanced_monitoring_settings%ROWTYPE;
  v_count INTEGER;
  v_total_integrity INTEGER := 0;
  v_previous_size BIGINT;
  v_current_size BIGINT;
  v_growth BIGINT := 0;
  v_connection_percent NUMERIC := 0;
  v_slow_count INTEGER := 0;
  v_auth_entries INTEGER := 0;
  v_status TEXT;
  v_result JSONB;
  v_entity UUID := '00000000-0000-0000-0000-000000000099'::UUID;
BEGIN
  IF p_observed_at IS NULL THEN RAISE EXCEPTION 'Monitoring observation time is required.'; END IF;
  PERFORM set_config('lock_timeout','2s',true);
  PERFORM set_config('statement_timeout','90s',true);
  SELECT * INTO STRICT v_settings FROM public.advanced_monitoring_settings WHERE id=true;
  UPDATE public.advanced_monitoring_metrics SET last_scan_started_at=p_observed_at,
    last_error_code=NULL,updated_at=p_observed_at WHERE id=true;

  SELECT count(*) INTO v_count FROM public.inventory_balances
  WHERE on_hand_quantity<0 OR reserved_quantity<0
    OR available_quantity<>on_hand_quantity-reserved_quantity;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:balances','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'سلامة أرصدة المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements
  WHERE balance_before+quantity<>balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-arithmetic','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'معادلة حركات المخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH last_move AS (
    SELECT DISTINCT ON(product_id,warehouse_id) product_id,warehouse_id,balance_after
    FROM public.inventory_movements ORDER BY product_id,warehouse_id,created_at DESC,id DESC
  ) SELECT count(*) INTO v_count FROM last_move l
    LEFT JOIN public.inventory_balances b USING(product_id,warehouse_id)
    WHERE b.id IS NULL OR b.on_hand_quantity<>l.balance_after;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:movement-ledger','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق رصيد آخر حركة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.inventory_movements m
  LEFT JOIN public.products p ON p.id=m.product_id
  LEFT JOIN public.warehouses w ON w.id=m.warehouse_id
  WHERE p.id IS NULL OR w.id IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:references','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'مراجع حركات المخزون',jsonb_build_object('orphanCount',v_count),p_observed_at);

  WITH expected AS (
    SELECT o.warehouse_id,oi.product_id,sum(oi.quantity)::BIGINT qty
    FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id
    WHERE o.source='website' AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
    GROUP BY o.warehouse_id,oi.product_id
  ), actual AS (
    SELECT warehouse_id,product_id,reserved_quantity::BIGINT qty FROM public.inventory_balances
    WHERE reserved_quantity<>0
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:reservations','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حجوزات طلبات الموقع',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected AS (
    SELECT o.id,o.warehouse_id,oi.product_id,sum(oi.quantity)::BIGINT qty
    FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id
    WHERE o.status IN ('completed','returned') GROUP BY o.id,o.warehouse_id,oi.product_id
  ), actual AS (
    SELECT reference_id AS id,warehouse_id,product_id,(-sum(quantity))::BIGINT qty
    FROM public.inventory_movements
    WHERE movement_type='sales_deduction' AND reference_type IN ('order','pos_sale')
    GROUP BY reference_id,warehouse_id,product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:stock-deductions','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'خصم مخزون الطلبات المكتملة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected AS (
    SELECT sr.id,sr.warehouse_id,sri.product_id,sum(sri.total_base_units)::BIGINT qty
    FROM public.supplier_receipts sr JOIN public.supplier_receipt_items sri ON sri.supplier_receipt_id=sr.id
    WHERE sr.status='completed' GROUP BY sr.id,sr.warehouse_id,sri.product_id
  ), actual AS (
    SELECT reference_id AS id,warehouse_id,product_id,sum(quantity)::BIGINT qty
    FROM public.inventory_movements WHERE reference_type='supplier_receipt'
      AND movement_type='purchase_receipt' GROUP BY reference_id,warehouse_id,product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:receiving','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حركات استلام الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.order_items
  WHERE cogs_in_minor_units<>unit_cost_in_minor_units*quantity
    OR profit_in_minor_units<>line_total_in_minor_units-cogs_in_minor_units;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:cogs-profit','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق تكلفة وربح بنود الطلب',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.customer_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.supplier_payments WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
    UNION ALL
    SELECT id FROM public.operational_expenses WHERE is_reversed AND
      (reversed_at IS NULL OR reversed_by IS NULL OR NULLIF(TRIM(reversal_reason),'') IS NULL)
  ) x;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:reversals','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'اكتمال بيانات العكوسات المالية',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH dues AS (
    SELECT supplier_id,sum(amount_due_in_minor_units)::BIGINT due
    FROM public.supplier_receipts WHERE status='completed' GROUP BY supplier_id
  ) SELECT count(*) INTO v_count FROM public.suppliers s LEFT JOIN dues d ON d.supplier_id=s.id
    WHERE s.current_balance_in_minor_units<>COALESCE(d.due,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:accounting:supplier-balances','accounting','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق ذمم الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units)
    OR (status='closed' AND cash_discrepancy_in_minor_units<>
      actual_cash_in_minor_units-expected_cash_in_minor_units)
    OR (closing_report_snapshot IS NOT NULL AND
      (closing_report_snapshotted_at IS NULL OR closing_report_snapshot_version<>1));
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:closing','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق إغلاق الوردية وCash/CliQ',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.cash_shifts
  WHERE status='closed' AND closed_at>=v_settings.monitoring_activated_at
    AND closing_report_snapshot IS NULL;
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:shifts:snapshot','shifts','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'وجود لقطة إغلاق للورديات الجديدة',jsonb_build_object('missingCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.automation_event_deliveries d
  LEFT JOIN public.automation_events e ON e.id=d.event_id
  WHERE e.id IS NULL OR (d.status='processing' AND d.lease_expires_at<=p_observed_at)
    OR d.status='dead_letter' OR (d.status<>'delivered' AND d.attempt_count>=10);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:automation:outbox','automation','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'سلامة Business automation outbox',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT round(100.0*count(*)/GREATEST(current_setting('max_connections')::INTEGER,1),2)
    INTO v_connection_percent FROM pg_stat_activity;
  v_status := CASE WHEN v_connection_percent>=v_settings.connection_critical_percent THEN 'critical'
    WHEN v_connection_percent>=v_settings.connection_warning_percent THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:connections','database','database',
    v_status,'high',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'استخدام اتصالات قاعدة البيانات',jsonb_build_object('usedPercent',v_connection_percent),p_observed_at);

  SELECT count(*) INTO v_slow_count FROM extensions.pg_stat_statements
  WHERE calls>=v_settings.slow_rpc_min_calls
    AND query ~ '"public"\."[a-zA-Z0-9_]+"'
    AND (mean_exec_time>=v_settings.slow_rpc_mean_ms OR max_exec_time>=v_settings.slow_rpc_max_ms);
  PERFORM public._set_advanced_monitoring_check('performance:database:rpcs','performance','database',
    CASE WHEN v_slow_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_slow_count,
    'أداء RPCs العامة',jsonb_build_object('slowFunctionCount',v_slow_count,
      'meanThresholdMs',v_settings.slow_rpc_mean_ms,'maxThresholdMs',v_settings.slow_rpc_max_ms),p_observed_at);

  PERFORM public._set_advanced_monitoring_check('performance:database:query-errors','performance','database',
    'unknown','medium',0,'معدل أخطاء الاستعلامات غير متاح من telemetry الحالية',
    jsonb_build_object('reason','no-safe-error-rate-source'),p_observed_at);

  SELECT pg_database_size(current_database()) INTO v_current_size;
  SELECT last_database_size_bytes INTO v_previous_size FROM public.advanced_monitoring_metrics WHERE id=true;
  v_growth := GREATEST(v_current_size-COALESCE(v_previous_size,v_current_size),0);
  v_status := CASE WHEN v_previous_size IS NOT NULL
    AND v_growth>=v_settings.database_growth_min_bytes
    AND (100.0*v_growth/GREATEST(v_previous_size,1))>=v_settings.database_growth_warning_percent
    THEN 'warning' ELSE 'healthy' END;
  PERFORM public._set_advanced_monitoring_check('performance:database:growth','performance','database',
    v_status,'medium',CASE WHEN v_status='healthy' THEN 0 ELSE 1 END,
    'نمو حجم قاعدة البيانات',jsonb_build_object('databaseBytes',v_current_size,'growthBytes',v_growth),p_observed_at);

  SELECT count(*) INTO v_count FROM (VALUES
    ('expire-stale-new-website-orders'),('cleanup-guest-order-gateway-requests'),
    ('scan-core-business-alerts'),('scan-business-summaries'),('run-advanced-monitoring')
  ) expected(jobname) LEFT JOIN cron.job j USING(jobname)
  WHERE j.jobid IS NULL OR NOT j.active;
  v_count := v_count+(SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
    WHERE j.jobname IN ('expire-stale-new-website-orders','cleanup-guest-order-gateway-requests','scan-core-business-alerts','scan-business-summaries')
      AND d.start_time>=p_observed_at-interval '30 minutes' AND d.status<>'succeeded');
  PERFORM public._set_advanced_monitoring_check('database:cron:health','database','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'حالة مهام Supabase cron',jsonb_build_object('issueCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND decision='rate_limited';
  v_count := CASE WHEN v_count>=v_settings.gateway_rate_limit_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:rate-limit','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'medium',v_count,
    'سلوك Rate Limit لبوابة الطلبات',jsonb_build_object('limitedRequestCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count FROM public.guest_order_gateway_requests
  WHERE created_at>=p_observed_at-interval '15 minutes' AND outcome='gateway_error';
  v_count := CASE WHEN v_count>=v_settings.gateway_error_warning_count THEN v_count ELSE 0 END;
  PERFORM public._set_advanced_monitoring_check('security:gateway:errors','security','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'warning' END,'high',v_count,
    'أخطاء بوابة الطلبات',jsonb_build_object('gatewayErrorCount',v_count),p_observed_at);

  SELECT count(*) INTO v_auth_entries FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes';
  SELECT count(*) INTO v_count FROM auth.audit_log_entries
  WHERE created_at>=p_observed_at-interval '15 minutes'
    AND payload::TEXT ~* 'error|failed|forbidden|unauthorized';
  PERFORM public._set_advanced_monitoring_check('security:auth:audit','security','database',
    CASE WHEN v_auth_entries=0 THEN 'unknown' WHEN v_count>=5 THEN 'warning' ELSE 'healthy' END,
    'medium',CASE WHEN v_count>=5 THEN v_count ELSE 0 END,
    'مؤشرات Auth audit المخزنة',jsonb_build_object('recentEntryCount',v_auth_entries,
      'anomalyCount',CASE WHEN v_count>=5 THEN v_count ELSE 0 END),p_observed_at);

  SELECT count(*) INTO v_count FROM public.advanced_monitoring_runtime_incidents
  WHERE resolved_at IS NULL AND last_seen_at>=p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);
  PERFORM public._set_advanced_monitoring_check('runtime:admin:errors','runtime','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'high',v_count,
    'أخطاء تشغيل Admin الحرجة',jsonb_build_object('activeFingerprintCount',v_count),p_observed_at);
  UPDATE public.advanced_monitoring_runtime_incidents SET resolved_at=p_observed_at,updated_at=p_observed_at
  WHERE resolved_at IS NULL AND last_seen_at<p_observed_at-
    make_interval(mins=>v_settings.runtime_incident_window_minutes);

  PERFORM public._transition_business_alert_incident(
    'business-integrity:system','business_integrity_warning',v_entity,
    v_total_integrity>0,p_observed_at,
    jsonb_build_object('issueCount',v_total_integrity,
      'message','توجد مشكلة اتساق تحتاج مراجعة الإدارة التقنية.','dashboard','monitoring'),true);

  UPDATE public.advanced_monitoring_metrics SET
    last_scan_completed_at=p_observed_at,last_database_size_bytes=v_current_size,
    last_database_size_observed_at=p_observed_at,last_error_code=NULL,
    updated_at=p_observed_at WHERE id=true;

  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,
    'checkCount',count(*),'openIssueCount',count(*) FILTER(WHERE status IN ('warning','critical')),
    'integrityIssueCount',v_total_integrity) INTO v_result
  FROM public.advanced_monitoring_checks WHERE source='database';
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  UPDATE public.advanced_monitoring_metrics SET last_error_code=COALESCE(SQLSTATE,'UNKNOWN'),
    updated_at=NOW() WHERE id=true;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_admin_runtime_incident(
  p_fingerprint TEXT,
  p_area TEXT DEFAULT 'admin_render'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner','admin','manager','accountant','cashier','sales','warehouse_keeper','orders','delivery_driver','view_only'],
    'تسجيل حادث تقني'
  );
  IF p_fingerprint !~ '^[a-f0-9]{64}$' OR p_area NOT IN ('admin_render','admin_global') THEN
    RAISE EXCEPTION 'Invalid runtime incident fingerprint.';
  END IF;
  INSERT INTO public.advanced_monitoring_runtime_incidents(
    fingerprint,application,area,occurrence_count,first_seen_at,last_seen_at,resolved_at,updated_at
  ) VALUES (p_fingerprint,'admin',p_area,1,NOW(),NOW(),NULL,NOW())
  ON CONFLICT(fingerprint) DO UPDATE SET occurrence_count=
    advanced_monitoring_runtime_incidents.occurrence_count+1,
    last_seen_at=NOW(),resolved_at=NULL,updated_at=NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.record_external_monitoring_snapshot(
  p_checks JSONB,
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_count INTEGER := 0;
  v_allowed CONSTANT TEXT[] := ARRAY[
    'external:backup:erp','external:backup:n8n','external:backup:restore',
    'external:infrastructure:docker','external:infrastructure:n8n',
    'external:deployment:github','external:deployment:uptime',
    'external:deployment:cloudflare-admin','external:deployment:cloudflare-customer'
  ];
BEGIN
  IF p_observed_at IS NULL OR jsonb_typeof(p_checks)<>'array'
    OR jsonb_array_length(p_checks)>20 OR octet_length(p_checks::TEXT)>16384
  THEN RAISE EXCEPTION 'Invalid external monitoring snapshot.'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_checks)
  LOOP
    IF NOT (v_item->>'key'=ANY(v_allowed))
      OR v_item->>'category' NOT IN ('backup','infrastructure','deployment')
      OR v_item->>'status' NOT IN ('healthy','warning','critical','unknown')
      OR v_item->>'severity' NOT IN ('low','medium','high','critical')
      OR COALESCE((v_item->>'issueCount')::INTEGER,-1)<0
    THEN RAISE EXCEPTION 'Invalid external monitoring item.'; END IF;
    PERFORM public._set_advanced_monitoring_check(
      v_item->>'key',v_item->>'category','external',v_item->>'status',
      v_item->>'severity',(v_item->>'issueCount')::INTEGER,
      LEFT(COALESCE(NULLIF(TRIM(v_item->>'summary'),''),'External check'),240),
      COALESCE(v_item->'details','{}'::JSONB),p_observed_at);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_advanced_monitoring_status()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'checkedAt',m.last_scan_completed_at,
    'scanErrorCode',m.last_error_code,
    'checks',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'key',c.check_key,'category',c.category,'status',c.status,
      'severity',c.severity,'issueCount',c.issue_count,'checkedAt',c.checked_at
    ) ORDER BY c.category,c.check_key) FROM public.advanced_monitoring_checks c
      WHERE c.source='database'),'[]'::JSONB)
  ) FROM public.advanced_monitoring_metrics m WHERE m.id=true;
$$;

CREATE OR REPLACE FUNCTION public.assert_monitoring_owner()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user_id UUID:=auth.uid();
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'عرض المراقبة التقنية');
  IF v_user_id IS NULL OR COALESCE(auth.jwt()->>'aal','aal1')<>'aal2' THEN
    RAISE EXCEPTION 'تتطلب لوحة المراقبة حساب المالك ومصادقة AAL2.';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_advanced_monitoring_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.assert_monitoring_owner();
  WITH effective_checks AS (
    SELECT c.*,
      CASE WHEN source='external' AND checked_at<NOW()-interval '15 minutes'
        THEN 'unknown' ELSE status END AS effective_status
    FROM public.advanced_monitoring_checks c
  )
  SELECT jsonb_build_object(
    'overallStatus',CASE
      WHEN count(*) FILTER(WHERE effective_status='critical')>0 THEN 'critical'
      WHEN count(*) FILTER(WHERE effective_status='warning')>0 THEN 'warning'
      WHEN count(*) FILTER(WHERE effective_status='unknown')>0 THEN 'unknown'
      ELSE 'healthy' END,
    'counts',jsonb_build_object(
      'healthy',count(*) FILTER(WHERE effective_status='healthy'),
      'warning',count(*) FILTER(WHERE effective_status='warning'),
      'critical',count(*) FILTER(WHERE effective_status='critical'),
      'unknown',count(*) FILTER(WHERE effective_status='unknown')),
    'lastScanAt',(SELECT last_scan_completed_at FROM public.advanced_monitoring_metrics WHERE id=true),
    'scanErrorCode',(SELECT last_error_code FROM public.advanced_monitoring_metrics WHERE id=true),
    'checks',COALESCE(jsonb_agg(jsonb_build_object(
      'key',check_key,'category',category,'source',source,'status',effective_status,
      'severity',severity,'issueCount',issue_count,'summary',summary,
      'details',details,'checkedAt',checked_at,'changedAt',changed_at)
      ORDER BY category,check_key),'[]'::JSONB)
  ) INTO v_result FROM effective_checks;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_automation_event(TEXT,TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._transition_business_alert_incident(TEXT,TEXT,UUID,BOOLEAN,TIMESTAMPTZ,JSONB,BOOLEAN) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._set_advanced_monitoring_check(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.run_advanced_monitoring_checks(TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.report_admin_runtime_incident(TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.report_admin_runtime_incident(TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.record_external_monitoring_snapshot(JSONB,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_advanced_monitoring_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_advanced_monitoring_status() TO service_role;
REVOKE ALL ON FUNCTION public.assert_monitoring_owner() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_advanced_monitoring_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_advanced_monitoring_dashboard() TO authenticated;

DO $$
DECLARE v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname='run-advanced-monitoring';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule('run-advanced-monitoring','*/5 * * * *',
    'SELECT public.run_advanced_monitoring_checks();');
END;
$$;

SELECT public.run_advanced_monitoring_checks();

COMMENT ON TABLE public.advanced_monitoring_checks IS
  'Bounded, sanitized health state only; never a Business data repair ledger.';
COMMENT ON FUNCTION public.record_external_monitoring_snapshot(JSONB,TIMESTAMPTZ) IS
  'Database-owner-only bridge for allowlisted external health checks.';

COMMIT;
