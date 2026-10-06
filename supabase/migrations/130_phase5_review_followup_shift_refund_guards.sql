BEGIN;

-- Phase 5 re-scope follow-up to the independent review of Migrations 128-129
-- (docs/agent/PHASE5_RESCOPE.md). Direct fixes on operational paths only.
--
-- H1. cancel_empty_cash_shift (046) treated a shift as empty when its only
--     activity was a settled Phase 4.2 refund (sales_return_events), so the
--     refund could leave the shift's accounting by "cancelling" it.
-- M2. Monitoring integrity:shifts:closing applied the close-time cash formula
--     to open shifts. Migration 121 increments the refund counter while the
--     shift is open, so every open shift with a Phase 4.2 refund was critical.
-- L8. The full-shift reversal preview did not list settled Phase 4.2 refunds,
--     showing canExecute=true while execution fails on the 121 guard.
-- L7. A same-key CliQ payment replay with a different reference number was
--     answered with the first receipt.

-- -------------------------------------------------------------------------
-- H1. Cancelling an "empty" shift also requires no Phase 4.2 refund events.
-- The shift row lock serializes with Migration 121, which only attaches a
-- refund to a shift that is still open under the same row lock.
-- -------------------------------------------------------------------------
ALTER FUNCTION public.cancel_empty_cash_shift(UUID, TEXT)
  RENAME TO _cancel_empty_cash_shift_before_return_events;
REVOKE ALL ON FUNCTION public._cancel_empty_cash_shift_before_return_events(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_empty_cash_shift(
  p_shift_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إلغاء وردية فُتحت بالخطأ'
  );

  PERFORM 1 FROM public.cash_shifts WHERE id = p_shift_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.sales_return_events
    WHERE cash_shift_id = p_shift_id
      AND settlement_status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION
      'لا يمكن إلغاء الوردية لأنها تحتوي حركة مالية. صحح العملية ثم أغلق الوردية طبيعيًا.';
  END IF;

  RETURN public._cancel_empty_cash_shift_before_return_events(p_shift_id, p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) TO authenticated;
ALTER FUNCTION public._cancel_empty_cash_shift_before_return_events(UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) OWNER TO postgres;
COMMENT ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) IS
  'Cancels, but never deletes, an open shift after verifying that it has no financial or order activity, including Phase 4.2 refunds.';

-- -------------------------------------------------------------------------
-- L8 (+A+). Full-shift preview: settled Phase 4.2 refunds are BLOCKED rows,
-- matching the execution guard of Migration 121. Replaces the 129 wrapper
-- body; the A+ rule is unchanged.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._preview_cash_shift_full_reversal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview JSONB;
  v_blocked UUID[];
  v_operations JSONB;
  v_return_rows JSONB;
BEGIN
  v_preview := public._preview_cash_shift_full_reversal_before_paid_order_guard(p_shift_id);

  SELECT ARRAY_AGG(payment.id) INTO v_blocked
  FROM public.customer_payments payment
  JOIN public.orders customer_order ON customer_order.id = payment.order_id
  WHERE payment.cash_shift_id = p_shift_id
    AND NOT payment.is_reversed
    AND customer_order.status = 'completed'
    AND COALESCE(customer_order.payment_method, 'cash_on_delivery') <> 'debt';

  SELECT jsonb_agg(jsonb_build_object(
    'operationType', 'phase42_sales_return',
    'originalRecordId', return_event.id,
    'status', 'BLOCKED',
    'reason', 'مرتجع مبيعات مسوّى ضمن الوردية لا يملك عكسًا مدعومًا ضمن عكس الوردية.',
    'expectedEffect', jsonb_build_object(
      'cash_in_minor_units', 0, 'cliq_in_minor_units', 0,
      'customer_balance_in_minor_units', 0, 'supplier_balance_in_minor_units', 0,
      'inventory_base_units_delta', 0, 'sales_in_minor_units', 0,
      'discount_in_minor_units', 0, 'cogs_in_minor_units', 0, 'profit_in_minor_units', 0)
  ) ORDER BY return_event.id)
  INTO v_return_rows
  FROM public.sales_return_events return_event
  WHERE return_event.cash_shift_id = p_shift_id
    AND return_event.settlement_status = 'settled';

  IF COALESCE(CARDINALITY(v_blocked), 0) = 0 AND v_return_rows IS NULL THEN
    RETURN v_preview;
  END IF;

  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN operation->>'operationType' = 'customer_payment'
        AND operation->>'status' = 'SUPPORTED'
        AND (operation->>'originalRecordId')::UUID = ANY(COALESCE(v_blocked, '{}'::UUID[]))
      THEN operation || jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'سند قبض لطلب مكتمل غير آجل؛ عكسه غير مدعوم.'
      )
      ELSE operation
    END ORDER BY ordinality
  ), '[]'::JSONB)
  INTO v_operations
  FROM jsonb_array_elements(COALESCE(v_preview->'operations', '[]'::JSONB))
    WITH ORDINALITY AS item(operation, ordinality);

  RETURN v_preview || jsonb_build_object(
    'operations', v_operations || COALESCE(v_return_rows, '[]'::JSONB),
    'canExecute', false
  );
END;
$$;

-- -------------------------------------------------------------------------
-- L7. Same-key CliQ replay must carry the same reference number. Reference is
-- stored as NULLIF(TRIM(...), '') by record_customer_order_payment (017).
-- Notes remain excluded: they are descriptive, not part of the money request.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_customer_order_payment_once(
  p_order_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.customer_payments%ROWTYPE;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'تسجيل دفعة عميل'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة عميل.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح تكرار الدفعة غير صالح.';
  END IF;

  -- Serialize just this user/key. A transport retry cannot create a second
  -- receipt even if it arrives while the first request is still committing.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::TEXT || ':' || v_key, 0)
  );

  SELECT * INTO v_existing
  FROM public.customer_payments
  WHERE created_by = v_user_id
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method
      OR (p_payment_method = 'cliq'
        AND NULLIF(TRIM(v_existing.reference_number), '')
          IS DISTINCT FROM NULLIF(TRIM(p_reference_number), ''))
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PAYMENT_IDEMPOTENCY_CONFLICT: مفتاح الدفعة مستخدم لطلب مختلف.';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'payment_number', v_existing.payment_number,
      'order_id', v_existing.order_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'remaining_in_minor_units', GREATEST((
        SELECT total_in_minor_units - amount_paid_in_minor_units
        FROM public.orders WHERE id = v_existing.order_id
      ), 0)
    );
  END IF;

  v_result := public.record_customer_order_payment(
    p_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_notes
  );

  UPDATE public.customer_payments
  SET idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار الدفعة.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

-- -------------------------------------------------------------------------
-- M2. Monitoring: verbatim copy of Migration 116's run_advanced_monitoring_checks
-- with one change. The close-time cash formula applies to non-open shifts
-- only; open shifts keep expected cash at opening until close (040/044).
-- -------------------------------------------------------------------------
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

  WITH reservation_sources AS (
    SELECT
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.order_inventory_reservations reservation
        WHERE reservation.order_id = o.id
      )
    GROUP BY o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      reservation.warehouse_id,
      reservation.product_id,
      SUM(reservation.reserved_quantity)::BIGINT AS qty
    FROM public.order_inventory_reservations reservation
    JOIN public.orders o ON o.id = reservation.order_id
    WHERE reservation.reservation_state = 'active'
      AND o.source = 'website'
      AND o.status IN ('new','confirmed','preparing','ready','out_for_delivery')
      AND o.reservation_released_at IS NULL
    GROUP BY reservation.warehouse_id, reservation.product_id
  ), expected AS (
    SELECT warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM reservation_sources
    GROUP BY warehouse_id, product_id
  ), actual AS (
    SELECT warehouse_id,product_id,reserved_quantity::BIGINT qty FROM public.inventory_balances
    WHERE reserved_quantity<>0
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:reservations','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حجوزات طلبات الموقع',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  WITH expected_sources AS (
    SELECT
      o.id,
      o.warehouse_id,
      oi.product_id,
      SUM(oi.quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.status IN ('completed','returned')
      AND COALESCE(oi.commercial_line_kind, 'base_unit') <> 'configurable_parcel'
    GROUP BY o.id, o.warehouse_id, oi.product_id
    UNION ALL
    SELECT
      o.id,
      o.warehouse_id,
      component.product_id,
      SUM(component.base_quantity)::BIGINT AS qty
    FROM public.orders o
    JOIN public.order_parcel_instances instance ON instance.order_id = o.id
    JOIN public.order_parcel_components component
      ON component.parcel_instance_id = instance.id
    WHERE o.status IN ('completed','returned')
    GROUP BY o.id, o.warehouse_id, component.product_id
  ), expected AS (
    SELECT id, warehouse_id, product_id, SUM(qty)::BIGINT AS qty
    FROM expected_sources
    GROUP BY id, warehouse_id, product_id
  ), actual AS (
    SELECT movement.reference_id AS id,movement.warehouse_id,movement.product_id,
      (-sum(movement.quantity))::BIGINT qty
    FROM public.inventory_movements movement
    JOIN public.orders moved_order ON moved_order.id = movement.reference_id
      AND moved_order.status IN ('completed','returned')
    WHERE movement.movement_type='sales_deduction'
      AND movement.reference_type IN ('order','pos_sale','customer_order')
    GROUP BY movement.reference_id,movement.warehouse_id,movement.product_id
  ) SELECT count(*) INTO v_count FROM expected e FULL JOIN actual a USING(id,warehouse_id,product_id)
    WHERE COALESCE(e.qty,0)<>COALESCE(a.qty,0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:orders:stock-deductions','orders','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'خصم مخزون الطلبات المكتملة',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  -- Reconcile the net stock effect for the complete supplier-receipt lifecycle.
  -- A cancelled receipt intentionally keeps its original purchase movement and
  -- appends an exact return_out reversal under supplier_receipt_cancellation.
  WITH expected AS (
    SELECT
      sr.id,
      sr.warehouse_id,
      sri.product_id,
      CASE
        WHEN sr.status = 'completed' THEN sum(sri.total_base_units)::BIGINT
        WHEN sr.status = 'cancelled' THEN 0::BIGINT
      END AS qty
    FROM public.supplier_receipts sr
    JOIN public.supplier_receipt_items sri ON sri.supplier_receipt_id = sr.id
    WHERE sr.status IN ('completed', 'cancelled')
    GROUP BY sr.id, sr.status, sr.warehouse_id, sri.product_id
  ), actual AS (
    SELECT
      reference_id AS id,
      warehouse_id,
      product_id,
      sum(quantity)::BIGINT AS qty
    FROM public.inventory_movements
    WHERE
      (reference_type = 'supplier_receipt' AND movement_type = 'purchase_receipt')
      OR
      (reference_type = 'supplier_receipt_cancellation' AND movement_type = 'return_out')
    GROUP BY reference_id, warehouse_id, product_id
  )
  SELECT count(*) INTO v_count
  FROM expected e
  FULL JOIN actual a USING(id, warehouse_id, product_id)
  WHERE COALESCE(e.qty, 0) <> COALESCE(a.qty, 0);
  v_total_integrity := v_total_integrity + v_count;
  PERFORM public._set_advanced_monitoring_check('integrity:inventory:receiving','inventory','database',
    CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,
    'تطابق حركات استلام الموردين',jsonb_build_object('mismatchCount',v_count),p_observed_at);

  SELECT count(*) INTO v_count
  FROM public.order_items item
  JOIN public.orders customer_order ON customer_order.id = item.order_id
  LEFT JOIN public.business_operations operation
    ON operation.id = customer_order.operation_id
  WHERE CASE
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
      AND customer_order.status NOT IN ('completed','returned')
    THEN customer_order.cost_finalized_at IS NOT NULL
      OR item.cost_finalized_at IS NOT NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL
      OR item.cogs_in_minor_units <> 0
      OR item.profit_in_minor_units <> 0
    WHEN operation.operation_type = 'phase3_customer_reservation_v1'
    THEN customer_order.cost_finalized_at IS NULL
      OR item.cost_finalized_at IS NULL
      OR item.exact_cogs_snapshot_in_minor_units IS NULL
      OR (
        item.commercial_line_kind = 'configurable_parcel'
        AND (
          item.cogs_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.cogs_snapshot_in_minor_units), 0)::BIGINT
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR item.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
            SELECT COALESCE(SUM(instance.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.order_parcel_instances instance
            WHERE instance.order_item_id = item.id
              AND (
                instance.cost_finalized_at IS NULL
                OR instance.exact_cogs_snapshot_in_minor_units IS NULL
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM
                  ROUND(instance.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
                OR instance.cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.cogs_snapshot_in_minor_units), 0)::BIGINT
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR instance.exact_cogs_snapshot_in_minor_units IS DISTINCT FROM (
                  SELECT COALESCE(SUM(component.exact_cogs_snapshot_in_minor_units), 0)::NUMERIC(30,6)
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                )
                OR EXISTS (
                  SELECT 1
                  FROM public.order_parcel_components component
                  WHERE component.parcel_instance_id = instance.id
                    AND (
                      component.cost_finalized_at IS NULL
                      OR component.exact_cogs_snapshot_in_minor_units IS NULL
                    )
                )
              )
          )
        )
      )
      OR (
        item.commercial_line_kind <> 'configurable_parcel'
        AND item.cogs_in_minor_units IS DISTINCT FROM
          ROUND(item.exact_cogs_snapshot_in_minor_units, 0)::BIGINT
      )
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    WHEN operation.operation_type = 'phase3_pos_sale_v1'
    THEN item.cogs_in_minor_units < 0
      OR item.profit_in_minor_units <>
        item.net_refundable_amount_snapshot_in_minor_units - item.cogs_in_minor_units
    ELSE item.cogs_in_minor_units <> item.unit_cost_in_minor_units * item.quantity
      OR item.profit_in_minor_units <> item.line_total_in_minor_units - item.cogs_in_minor_units
  END;
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
  WHERE (status<>'open' AND expected_cash_in_minor_units<>(opening_cash_in_minor_units+cash_sales_in_minor_units+
    cash_receipts_in_minor_units-cash_supplier_payments_in_minor_units-
    cash_expenses_in_minor_units-cash_refunds_in_minor_units))
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

COMMIT;
