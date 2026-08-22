-- =========================================================================
-- Nawasrah ERP - Migration 022
-- Focused operational home dashboard backed by one authenticated RPC.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_home_dashboard()
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

  SELECT
    COALESCE(SUM(o.total_in_minor_units), 0),
    COUNT(*)::INTEGER
  INTO
    v_today_sales,
    v_today_completed_orders
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT MIN(osh.created_at) AS completed_at
    FROM public.order_status_history osh
    WHERE osh.order_id = o.id
      AND osh.new_status = 'completed'
  ) completion ON true
  WHERE o.status = 'completed'
    AND COALESCE(completion.completed_at, o.created_at) >= v_today_start
    AND COALESCE(completion.completed_at, o.created_at) < v_tomorrow_start;

  SELECT COALESCE(SUM(o.total_in_minor_units), 0)
  INTO v_month_sales
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT MIN(osh.created_at) AS completed_at
    FROM public.order_status_history osh
    WHERE osh.order_id = o.id
      AND osh.new_status = 'completed'
  ) completion ON true
  WHERE o.status = 'completed'
    AND COALESCE(completion.completed_at, o.created_at) >= v_month_start;

  SELECT COALESCE(SUM(oi.profit_in_minor_units), 0)
  INTO v_month_profit
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN LATERAL (
    SELECT MIN(osh.created_at) AS completed_at
    FROM public.order_status_history osh
    WHERE osh.order_id = o.id
      AND osh.new_status = 'completed'
  ) completion ON true
  WHERE o.status = 'completed'
    AND COALESCE(completion.completed_at, o.created_at) >= v_month_start;

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

  SELECT COALESCE(SUM(
    GREATEST(
      o.total_in_minor_units - o.amount_paid_in_minor_units,
      0
    )
  ), 0)
  INTO v_customer_receivables
  FROM public.orders o
  WHERE o.status = 'completed';

  SELECT COALESCE(SUM(GREATEST(s.current_balance_in_minor_units, 0)), 0)
  INTO v_supplier_payables
  FROM public.suppliers s
  WHERE s.is_active = true;

  SELECT COALESCE(SUM(
    ib.on_hand_quantity::BIGINT * p.cost_price_in_minor_units
  ), 0)
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

  SELECT COALESCE(JSONB_AGG(day_row), '[]'::JSONB)
  INTO v_seven_day_sales
  FROM (
    SELECT
      series.day::DATE AS date,
      TO_CHAR(series.day, 'Dy') AS "dayLabel",
      COALESCE(SUM(completed_order.total_in_minor_units), 0)::BIGINT
        AS "salesInMinorUnits"
    FROM generate_series(
      v_business_date - 6,
      v_business_date,
      INTERVAL '1 day'
    ) AS series(day)
    LEFT JOIN (
      SELECT
        o.id,
        o.total_in_minor_units,
        COALESCE(
          MIN(osh.created_at) FILTER (
            WHERE osh.new_status = 'completed'
          ),
          o.created_at
        ) AS completed_at
      FROM public.orders o
      LEFT JOIN public.order_status_history osh
        ON osh.order_id = o.id
      WHERE o.status = 'completed'
      GROUP BY o.id
    ) completed_order
      ON completed_order.completed_at >= (
        series.day::DATE::TIMESTAMP AT TIME ZONE 'Asia/Amman'
      )
      AND completed_order.completed_at < (
        (series.day::DATE + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman'
      )
    GROUP BY series.day
    ORDER BY series.day
  ) day_row;

  RETURN JSONB_BUILD_OBJECT(
    'generatedAt', NOW(),
    'access', JSONB_BUILD_OBJECT(
      'canViewProfit', v_can_view_profit
    ),
    'summary', JSONB_BUILD_OBJECT(
      'todaySalesInMinorUnits', v_today_sales,
      'todayCompletedOrders', v_today_completed_orders,
      'monthSalesInMinorUnits', v_month_sales,
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

REVOKE ALL ON FUNCTION public.get_home_dashboard()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_dashboard()
  TO authenticated;

COMMENT ON FUNCTION public.get_home_dashboard() IS
  'Authenticated operational home dashboard. Realized sales use completed orders, profit uses order item cost snapshots, and stock readiness uses wholesale sale packages.';
