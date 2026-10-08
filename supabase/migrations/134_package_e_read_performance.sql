-- Owner-approved E2 read performance only. Explicit existing home body;
-- no writer, grant, historical snapshot or financial equation changes.
BEGIN;

CREATE INDEX idx_sales_return_items_operation_id
  ON public.sales_return_items(operation_id);
CREATE INDEX idx_sales_replacement_items_operation_id
  ON public.sales_replacement_items(operation_id);

CREATE OR REPLACE FUNCTION public._get_home_dashboard_before133()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_date DATE := (NOW() AT TIME ZONE 'Asia/Amman')::DATE;
  v_today_start TIMESTAMPTZ;
  v_tomorrow_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_month JSONB;
  v_week JSONB;
  v_today JSONB;
  v_today_sales BIGINT := 0;
  v_today_completed_orders INTEGER := 0;
  v_month_sales BIGINT := 0;
  v_month_profit BIGINT := 0;
  v_open_orders INTEGER := 0;
  v_new_orders INTEGER := 0;
  v_customer_receivables BIGINT := 0;
  v_supplier_payables BIGINT := 0;
  v_inventory_value BIGINT := 0;
  v_active_products INTEGER := 0;
  v_active_customers INTEGER := 0;
  v_low_stock INTEGER := 0;
  v_out_of_stock INTEGER := 0;
  v_configuration_issues INTEGER := 0;
  v_can_view_profit BOOLEAN := false;
  v_latest_orders JSONB := '[]'::JSONB;
  v_stock_alerts JSONB := '[]'::JSONB;
  v_order_statuses JSONB := '[]'::JSONB;
  v_seven_day_sales JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'عرض الصفحة الرئيسية'
  );

  v_today_start :=
    v_business_date::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_tomorrow_start :=
    (v_business_date + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_month_start :=
    date_trunc(
      'month',
      v_business_date::TIMESTAMP
    ) AT TIME ZONE 'Asia/Amman';

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND r.code IN ('owner', 'admin', 'manager', 'accountant')
  )
  INTO v_can_view_profit;

  -- The131 equations are unchanged. Only the home reader skips periodic
  -- evidence revalidation; reports and summaries remain strict.
  BEGIN
    v_month := public.phase6_financial_facts_internal(
      NULL, v_month_start, v_tomorrow_start, 'Asia/Amman', false);
    IF v_today_start - INTERVAL '6 days' >= v_month_start THEN
      -- Daily values are period-local by date. Reuse them only when the
      -- complete seven-day interval is contained in the monthly interval.
      SELECT jsonb_build_object('dailyBreakdown', jsonb_agg(day ORDER BY day->>'date'))
      INTO v_week FROM jsonb_array_elements(v_month->'dailyBreakdown') day
      WHERE (day->>'date')::DATE >= v_business_date - 6;
    ELSE
      -- Month boundary: never drop days from the previous month.
      v_week := public.phase6_financial_facts_internal(
        NULL, v_today_start - INTERVAL '6 days', v_tomorrow_start, 'Asia/Amman', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Preserve the complete pre131 unavailable response, including its old
    -- financial numbers. Expensive legacy calculations run ONLY on fallback.
    RETURN public._get_home_dashboard_before_phase6()
      || jsonb_build_object('financialFactsStatus', 'unavailable');
  END;
  SELECT day INTO v_today FROM jsonb_array_elements(v_week->'dailyBreakdown') day
  WHERE (day->>'date')::DATE = v_business_date;
  v_today_sales := COALESCE((v_today->>'grossSalesInMinorUnits')::BIGINT, 0);
  v_today_completed_orders := COALESCE((v_today->>'completedOrderCount')::INTEGER, 0);
  v_month_sales := (v_month #>> '{sales,grossSalesInMinorUnits}')::BIGINT;
  v_month_profit := (v_month #>> '{sales,netProfitInMinorUnits}')::BIGINT;
  v_customer_receivables := (v_month #>> '{balances,customerDueInMinorUnits}')::BIGINT;

  SELECT
    COUNT(*) FILTER (
      WHERE status IN (
        'new',
        'confirmed',
        'preparing',
        'ready',
        'out_for_delivery'
      )
    )::INTEGER,
    COUNT(*) FILTER (WHERE status = 'new')::INTEGER
  INTO
    v_open_orders,
    v_new_orders
  FROM public.orders;

  SELECT COALESCE(SUM(GREATEST(s.current_balance_in_minor_units, 0)), 0)
  INTO v_supplier_payables
  FROM public.suppliers s
  WHERE s.is_active = true;

  SELECT ROUND(COALESCE(SUM(
    ib.on_hand_quantity::NUMERIC
      * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)
  ), 0), 0)::BIGINT
  INTO v_inventory_value
  FROM public.inventory_balances ib
  JOIN public.products p ON p.id = ib.product_id
  WHERE p.is_active = true;

  SELECT COUNT(*)::INTEGER
  INTO v_active_products
  FROM public.products
  WHERE is_active = true;

  SELECT COUNT(*)::INTEGER
  INTO v_active_customers
  FROM public.customers
  WHERE is_active = true
    AND is_deleted = false;

  WITH product_stock AS (
    SELECT
      p.id,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(
        SUM(ib.on_hand_quantity - ib.reserved_quantity),
        0
      )::INTEGER AS available_quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.product_id = p.id
    WHERE p.is_active = true
    GROUP BY
      p.id,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units
  )
  SELECT
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NOT NULL
        AND units_per_sale_unit > 1
        AND default_sale_price_in_minor_units > 0
        AND available_quantity < units_per_sale_unit
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NOT NULL
        AND units_per_sale_unit > 1
        AND default_sale_price_in_minor_units > 0
        AND available_quantity >= units_per_sale_unit
        AND available_quantity <= GREATEST(
          min_stock_level,
          units_per_sale_unit
        )
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE sale_unit_id IS NULL
        OR units_per_sale_unit <= 1
        OR default_sale_price_in_minor_units <= 0
    )::INTEGER
  INTO
    v_out_of_stock,
    v_low_stock,
    v_configuration_issues
  FROM product_stock;

  SELECT COALESCE(JSONB_AGG(order_row), '[]'::JSONB)
  INTO v_latest_orders
  FROM (
    SELECT
      o.id,
      o.order_number AS "orderNumber",
      COALESCE(c.full_name, 'زبون مباشر') AS "customerName",
      o.status,
      o.payment_status AS "paymentStatus",
      o.total_in_minor_units AS "totalInMinorUnits",
      o.source,
      o.created_at AS "createdAt"
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC
    LIMIT 5
  ) order_row;

  WITH product_stock AS (
    SELECT
      p.id,
      p.name_ar,
      p.sku,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(u.name_ar, 'طرد') AS sale_unit_name,
      COALESCE(
        SUM(ib.on_hand_quantity - ib.reserved_quantity),
        0
      )::INTEGER AS available_quantity
    FROM public.products p
    LEFT JOIN public.inventory_balances ib
      ON ib.product_id = p.id
    LEFT JOIN public.units u
      ON u.id = p.sale_unit_id
    WHERE p.is_active = true
    GROUP BY
      p.id,
      p.name_ar,
      p.sku,
      p.min_stock_level,
      p.sale_unit_id,
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      u.name_ar
  )
  SELECT COALESCE(JSONB_AGG(stock_row), '[]'::JSONB)
  INTO v_stock_alerts
  FROM (
    SELECT
      ps.id,
      ps.name_ar AS "nameAr",
      ps.sku,
      ps.available_quantity AS "availableBaseUnits",
      ps.units_per_sale_unit AS "unitsPerSaleUnit",
      ps.sale_unit_name AS "saleUnitName",
      FLOOR(
        ps.available_quantity::NUMERIC
        / GREATEST(ps.units_per_sale_unit, 1)
      )::INTEGER AS "availableSalePackages",
      CASE
        WHEN ps.sale_unit_id IS NULL
          OR ps.units_per_sale_unit <= 1
          OR ps.default_sale_price_in_minor_units <= 0
          THEN 'configuration'
        WHEN ps.available_quantity < ps.units_per_sale_unit
          THEN 'out_of_stock'
        ELSE 'low_stock'
      END AS severity
    FROM product_stock ps
    WHERE
      ps.sale_unit_id IS NULL
      OR ps.units_per_sale_unit <= 1
      OR ps.default_sale_price_in_minor_units <= 0
      OR ps.available_quantity < ps.units_per_sale_unit
      OR ps.available_quantity <= GREATEST(
        ps.min_stock_level,
        ps.units_per_sale_unit
      )
    ORDER BY
      CASE
        WHEN ps.sale_unit_id IS NULL
          OR ps.units_per_sale_unit <= 1
          OR ps.default_sale_price_in_minor_units <= 0
          THEN 0
        WHEN ps.available_quantity < ps.units_per_sale_unit
          THEN 1
        ELSE 2
      END,
      ps.available_quantity ASC,
      ps.name_ar ASC
    LIMIT 5
  ) stock_row;

  SELECT COALESCE(JSONB_AGG(status_row), '[]'::JSONB)
  INTO v_order_statuses
  FROM (
    SELECT
      status,
      COUNT(*)::INTEGER AS count
    FROM public.orders
    WHERE status IN (
      'new',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
      'completed'
    )
    GROUP BY status
    ORDER BY CASE status
      WHEN 'new' THEN 1
      WHEN 'confirmed' THEN 2
      WHEN 'preparing' THEN 3
      WHEN 'ready' THEN 4
      WHEN 'out_for_delivery' THEN 5
      WHEN 'completed' THEN 6
      ELSE 7
    END
  ) status_row;

  SELECT COALESCE(jsonb_agg(day || jsonb_build_object(
    'salesInMinorUnits', day->'grossSalesInMinorUnits',
    'dayLabel', to_char((day->>'date')::DATE, 'Dy')
  ) ORDER BY day->>'date'), '[]'::JSONB)
  INTO v_seven_day_sales FROM jsonb_array_elements(v_week->'dailyBreakdown') day;

  RETURN JSONB_BUILD_OBJECT(
    'generatedAt', NOW(),
    'financialFactsStatus', 'available',
    'access', JSONB_BUILD_OBJECT(
      'canViewProfit', v_can_view_profit
    ),
    'summary', JSONB_BUILD_OBJECT(
      'todaySalesInMinorUnits', v_today_sales,
      'todayNetSalesInMinorUnits', COALESCE((v_today->>'netSalesInMinorUnits')::BIGINT, 0),
      'todayCompletedOrders', v_today_completed_orders,
      'monthSalesInMinorUnits', v_month_sales,
      'monthNetSalesInMinorUnits', v_month #> '{sales,netSalesInMinorUnits}',
      'monthProfitInMinorUnits',
        CASE WHEN v_can_view_profit THEN v_month_profit ELSE NULL END,
      'openOrdersCount', v_open_orders,
      'newOrdersCount', v_new_orders,
      'customerReceivablesInMinorUnits', v_customer_receivables,
      'supplierPayablesInMinorUnits', v_supplier_payables,
      'inventoryValueInMinorUnits', v_inventory_value,
      'activeProductsCount', v_active_products,
      'activeCustomersCount', v_active_customers,
      'lowStockCount', v_low_stock,
      'outOfStockCount', v_out_of_stock,
      'configurationIssuesCount', v_configuration_issues
    ),
    'latestOrders', v_latest_orders,
    'stockAlerts', v_stock_alerts,
    'orderStatuses', v_order_statuses,
    'sevenDaySales', v_seven_day_sales
  );
END;
$$;

ALTER FUNCTION public._get_home_dashboard_before133() OWNER TO postgres;






CREATE OR REPLACE FUNCTION public._get_operational_business_report_before133(
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
    false
  );
  v_report := jsonb_set(v_report, '{sales}', (v_report->'sales') || (v_facts->'sales'));
  v_report := jsonb_set(v_report, '{balances}', (v_report->'balances') || (v_facts->'balances'));
  v_report := jsonb_set(v_report, '{expenses}', (v_report->'expenses') || (v_facts->'expenses'));
  RETURN v_report || jsonb_build_object('cashFlow', v_facts->'cashFlow');
END;
$$;

CREATE OR REPLACE FUNCTION public._build_business_summary_before133(
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
    false
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

CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks(
  p_observed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth, cron, pg_temp
AS $$
DECLARE
  v_operation RECORD;
  v_return_count INTEGER := 0;
  v_replacement_count INTEGER := 0;
  v_evidence_issues INTEGER := 0;
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

  -- Independent committed evidence, not mutable PO totals or supplier balance.
  SELECT COUNT(*) INTO v_count FROM public.suppliers supplier
  JOIN public.phase133_supplier_balance_evidence_internal() evidence ON evidence.supplier_id=supplier.id
  WHERE supplier.current_balance_in_minor_units IS DISTINCT FROM evidence.balance;
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

  -- Seven-day operational evidence, checked independently by the write validators.
  -- Preserve a CRITICAL check/incident even when an individual validator rejects.
  FOR v_operation IN
    SELECT e.operation_id FROM public.sales_return_events e
    JOIN public.orders o ON o.id=e.order_id
    JOIN public.business_operations creation ON creation.id=o.operation_id
    WHERE e.settlement_status='settled' AND e.contract_version=401
      AND creation.operation_type IN ('phase3_pos_sale_v1','phase3_customer_reservation_v1')
      AND e.settled_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_return_count := v_return_count + 1;
    BEGIN
      PERFORM public.phase42_assert_operational_return_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  FOR v_operation IN
    SELECT operation_id FROM public.sales_replacement_events
    WHERE issuance_status='issued' AND issued_at>=p_observed_at-INTERVAL '7 days'
  LOOP
    v_replacement_count := v_replacement_count + 1;
    BEGIN
      PERFORM public.phase43_assert_operational_replacement_evidence_internal(v_operation.operation_id,true);
    EXCEPTION WHEN OTHERS THEN
      v_evidence_issues := v_evidence_issues + 1;
    END;
  END LOOP;
  PERFORM public._set_advanced_monitoring_check('integrity:aftercare:durable-evidence','accounting','database',
    CASE WHEN v_evidence_issues=0 THEN 'healthy' ELSE 'critical' END,'critical',v_evidence_issues,
    'سلامة أدلة المرتجعات والاستبدالات لآخر 7 أيام',
    jsonb_build_object('windowDays',7,'returnsChecked',v_return_count,
      'replacementsChecked',v_replacement_count),p_observed_at);
  v_total_integrity := v_total_integrity + v_evidence_issues;

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

ALTER FUNCTION public._get_operational_business_report_before133(UUID,DATE,DATE) OWNER TO postgres;

ALTER FUNCTION public._build_business_summary_before133(TEXT,DATE,DATE,TIMESTAMPTZ) OWNER TO postgres;

ALTER FUNCTION public.run_advanced_monitoring_checks(TIMESTAMPTZ) OWNER TO postgres;



COMMIT;
