-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 007: Dashboard Analytics RPC
-- Highly optimized RPC function to retrieve all executive dashboard metrics
-- strictly adhering to real table columns in migrations 001 and 004.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_analytics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today_start TIMESTAMPTZ := date_trunc('day', NOW());
  v_yesterday_start TIMESTAMPTZ := date_trunc('day', NOW() - INTERVAL '1 day');
  v_week_start TIMESTAMPTZ := date_trunc('week', NOW());
  v_month_start TIMESTAMPTZ := date_trunc('month', NOW());
  v_30_days_ago TIMESTAMPTZ := date_trunc('day', NOW() - INTERVAL '30 days');

  -- KPI Variables
  v_today_sales NUMERIC := 0;
  v_yesterday_sales NUMERIC := 0;
  v_week_sales NUMERIC := 0;
  v_month_sales NUMERIC := 0;
  v_total_revenue NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_net_profit NUMERIC := 0;
  v_today_orders_count INT := 0;
  v_active_customers_count INT := 0;
  v_total_products_count INT := 0;
  v_low_stock_count INT := 0;
  v_out_of_stock_count INT := 0;

  -- Result Arrays
  v_daily_sales JSONB := '[]'::jsonb;
  v_monthly_revenue JSONB := '[]'::jsonb;
  v_orders_by_status JSONB := '[]'::jsonb;
  v_top_selling_products JSONB := '[]'::jsonb;
  v_sales_by_warehouse JSONB := '[]'::jsonb;
  v_sales_by_branch JSONB := '[]'::jsonb;
  v_latest_orders JSONB := '[]'::jsonb;
  v_latest_customers JSONB := '[]'::jsonb;
  v_low_stock_alerts JSONB := '[]'::jsonb;
  v_recent_inventory_movements JSONB := '[]'::jsonb;
  v_today_notifications JSONB := '[]'::jsonb;
BEGIN
  -- 1. KPI Calculations

  -- Today Sales & Orders Count (Column in orders is total_in_minor_units)
  SELECT COALESCE(SUM(total_in_minor_units), 0) / 1000.0, COUNT(*)
  INTO v_today_sales, v_today_orders_count
  FROM public.orders
  WHERE created_at >= v_today_start AND status != 'cancelled';

  -- Yesterday Sales
  SELECT COALESCE(SUM(total_in_minor_units), 0) / 1000.0
  INTO v_yesterday_sales
  FROM public.orders
  WHERE created_at >= v_yesterday_start AND created_at < v_today_start AND status != 'cancelled';

  -- This Week Sales
  SELECT COALESCE(SUM(total_in_minor_units), 0) / 1000.0
  INTO v_week_sales
  FROM public.orders
  WHERE created_at >= v_week_start AND status != 'cancelled';

  -- This Month Sales
  SELECT COALESCE(SUM(total_in_minor_units), 0) / 1000.0
  INTO v_month_sales
  FROM public.orders
  WHERE created_at >= v_month_start AND status != 'cancelled';

  -- Total Revenue
  SELECT COALESCE(SUM(total_in_minor_units), 0) / 1000.0
  INTO v_total_revenue
  FROM public.orders
  WHERE status != 'cancelled';

  -- Net Profit Calculation
  SELECT
    COALESCE(SUM(oi.line_total_in_minor_units), 0) / 1000.0,
    COALESCE(SUM(oi.quantity * COALESCE(p.cost_price_in_minor_units, 0)), 0) / 1000.0
  INTO v_total_revenue, v_total_cost
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE o.status != 'cancelled';

  v_net_profit := GREATEST(0, v_total_revenue - v_total_cost);

  -- Counts
  -- Note: customers table does NOT have is_active column; total registered customers are counted
  SELECT COUNT(*) INTO v_active_customers_count FROM public.customers;
  -- products table DOES have is_active column
  SELECT COUNT(*) INTO v_total_products_count FROM public.products WHERE is_active = true;

  -- Stock Status Counts (Column in products is min_stock_level, NOT reorder_level)
  WITH prod_stock AS (
    SELECT
      p.id,
      p.min_stock_level,
      COALESCE(SUM(b.on_hand_quantity - b.reserved_quantity), 0) AS total_available
    FROM public.products p
    LEFT JOIN public.inventory_balances b ON b.product_id = p.id
    WHERE p.is_active = true
    GROUP BY p.id, p.min_stock_level
  )
  SELECT
    COUNT(*) FILTER (WHERE total_available <= min_stock_level AND total_available > 0),
    COUNT(*) FILTER (WHERE total_available <= 0)
  INTO v_low_stock_count, v_out_of_stock_count
  FROM prod_stock;


  -- 2. Daily Sales (Last 30 Days)
  SELECT COALESCE(jsonb_agg(d), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS date,
      to_char(d.day, 'DD/MM') AS "formattedDate",
      COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 AS sales,
      COUNT(o.id) AS "ordersCount"
    FROM generate_series(v_30_days_ago, date_trunc('day', NOW()), INTERVAL '1 day') AS d(day)
    LEFT JOIN public.orders o ON date_trunc('day', o.created_at) = d.day AND o.status != 'cancelled'
    GROUP BY d.day
    ORDER BY d.day ASC
  ) d;


  -- 3. Monthly Revenue
  SELECT COALESCE(jsonb_agg(m), '[]'::jsonb)
  INTO v_monthly_revenue
  FROM (
    SELECT
      to_char(m.month, 'YYYY-MM') AS month,
      to_char(m.month, 'Mon YYYY') AS "monthName",
      COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 AS revenue
    FROM generate_series(date_trunc('month', NOW() - INTERVAL '11 months'), date_trunc('month', NOW()), INTERVAL '1 month') AS m(month)
    LEFT JOIN public.orders o ON date_trunc('month', o.created_at) = m.month AND o.status != 'cancelled'
    GROUP BY m.month
    ORDER BY m.month ASC
  ) m;


  -- 4. Orders by Status
  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
  INTO v_orders_by_status
  FROM (
    SELECT
      status,
      COUNT(*) AS count,
      COALESCE(SUM(total_in_minor_units), 0) / 1000.0 AS "totalAmount"
    FROM public.orders
    GROUP BY status
  ) s;


  -- 5. Top Selling Products
  SELECT COALESCE(jsonb_agg(tp), '[]'::jsonb)
  INTO v_top_selling_products
  FROM (
    SELECT
      p.id,
      p.name_ar AS "nameAr",
      p.sku,
      COALESCE(SUM(oi.quantity), 0) AS "totalQuantity",
      COALESCE(SUM(oi.line_total_in_minor_units), 0) / 1000.0 AS "totalRevenue"
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY p.id, p.name_ar, p.sku
    ORDER BY "totalRevenue" DESC
    LIMIT 5
  ) tp;


  -- 6. Sales by Warehouse
  SELECT COALESCE(jsonb_agg(w), '[]'::jsonb)
  INTO v_sales_by_warehouse
  FROM (
    SELECT
      wh.id,
      wh.name_ar AS "nameAr",
      COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 AS sales,
      COUNT(o.id) AS "ordersCount",
      CASE
        WHEN v_total_revenue > 0 THEN ROUND((COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 / v_total_revenue) * 100.0, 1)
        ELSE 0
      END AS percentage
    FROM public.warehouses wh
    LEFT JOIN public.orders o ON o.warehouse_id = wh.id AND o.status != 'cancelled'
    GROUP BY wh.id, wh.name_ar
  ) w;


  -- 7. Sales by Branch
  SELECT COALESCE(jsonb_agg(b), '[]'::jsonb)
  INTO v_sales_by_branch
  FROM (
    SELECT
      br.id,
      br.name_ar AS "nameAr",
      COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 AS sales,
      COUNT(o.id) AS "ordersCount",
      CASE
        WHEN v_total_revenue > 0 THEN ROUND((COALESCE(SUM(o.total_in_minor_units), 0) / 1000.0 / v_total_revenue) * 100.0, 1)
        ELSE 0
      END AS percentage
    FROM public.branches br
    LEFT JOIN public.orders o ON o.branch_id = br.id AND o.status != 'cancelled'
    GROUP BY br.id, br.name_ar
  ) b;


  -- 8. Latest Orders
  SELECT COALESCE(jsonb_agg(lo), '[]'::jsonb)
  INTO v_latest_orders
  FROM (
    SELECT
      o.id,
      o.order_number AS "orderNumber",
      COALESCE(c.full_name, 'زبون مباشر') AS "customerName",
      o.total_in_minor_units / 1000.0 AS "totalAmount",
      o.status,
      o.created_at AS "createdAt"
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC
    LIMIT 10
  ) lo;


  -- 9. Latest Customers (Get governorate from customer_addresses table)
  SELECT COALESCE(jsonb_agg(lc), '[]'::jsonb)
  INTO v_latest_customers
  FROM (
    SELECT
      c.id,
      c.full_name AS "fullName",
      c.phone,
      COALESCE(ca.governorate, 'عمان') AS governorate,
      c.created_at AS "createdAt"
    FROM public.customers c
    LEFT JOIN LATERAL (
      SELECT governorate
      FROM public.customer_addresses
      WHERE customer_id = c.id
      ORDER BY is_default DESC, created_at DESC
      LIMIT 1
    ) ca ON true
    ORDER BY c.created_at DESC
    LIMIT 5
  ) lc;


  -- 10. Low Stock Alerts (p.min_stock_level instead of reorder_level)
  SELECT COALESCE(jsonb_agg(lsa), '[]'::jsonb)
  INTO v_low_stock_alerts
  FROM (
    SELECT
      p.id,
      p.name_ar AS "nameAr",
      p.sku,
      COALESCE(SUM(b.on_hand_quantity - b.reserved_quantity), 0) AS "availableQuantity",
      COALESCE(SUM(b.on_hand_quantity), 0) AS "onHandQuantity",
      COALESCE(SUM(b.reserved_quantity), 0) AS "reservedQuantity",
      p.min_stock_level AS "reorderLevel",
      (COALESCE(SUM(b.on_hand_quantity - b.reserved_quantity), 0) <= 0) AS "isOutOfStock",
      'قطعة' AS unit
    FROM public.products p
    LEFT JOIN public.inventory_balances b ON b.product_id = p.id
    WHERE p.is_active = true
    GROUP BY p.id, p.name_ar, p.sku, p.min_stock_level
    HAVING COALESCE(SUM(b.on_hand_quantity - b.reserved_quantity), 0) <= p.min_stock_level
    ORDER BY "availableQuantity" ASC
    LIMIT 10
  ) lsa;


  -- 11. Recent Inventory Movements (table is inventory_movements, column is movement_type)
  SELECT COALESCE(jsonb_agg(rim), '[]'::jsonb)
  INTO v_recent_inventory_movements
  FROM (
    SELECT
      m.id,
      COALESCE(p.name_ar, 'منتج غير معروف') AS "productName",
      m.movement_type AS "transactionType",
      m.quantity,
      m.created_at AS "createdAt"
    FROM public.inventory_movements m
    LEFT JOIN public.products p ON p.id = m.product_id
    ORDER BY m.created_at DESC
    LIMIT 10
  ) rim;


  -- 12. Today Notifications / Audit Logs
  SELECT COALESCE(jsonb_agg(tn), '[]'::jsonb)
  INTO v_today_notifications
  FROM (
    SELECT
      a.id,
      a.action,
      COALESCE(a.details::text, 'حركة جديدة على النظام') AS details,
      a.created_at AS "createdAt"
    FROM public.audit_logs a
    ORDER BY a.created_at DESC
    LIMIT 10
  ) tn;


  -- Return Combined JSON Payload
  RETURN jsonb_build_object(
    'kpis', jsonb_build_object(
      'todaySales', v_today_sales,
      'yesterdaySales', v_yesterday_sales,
      'todaySalesChangePercent', CASE WHEN v_yesterday_sales > 0 THEN ROUND(((v_today_sales - v_yesterday_sales) / v_yesterday_sales) * 100.0, 1) ELSE 0 END,
      'weekSales', v_week_sales,
      'monthSales', v_month_sales,
      'totalRevenue', v_total_revenue,
      'netProfit', v_net_profit,
      'profitMarginPercent', CASE WHEN v_total_revenue > 0 THEN ROUND((v_net_profit / v_total_revenue) * 100.0, 1) ELSE 0 END,
      'todayOrdersCount', v_today_orders_count,
      'activeCustomersCount', v_active_customers_count,
      'totalProductsCount', v_total_products_count,
      'lowStockCount', v_low_stock_count,
      'outOfStockCount', v_out_of_stock_count
    ),
    'dailySales30d', v_daily_sales,
    'monthlyRevenue', v_monthly_revenue,
    'ordersByStatus', v_orders_by_status,
    'topSellingProducts', v_top_selling_products,
    'salesByWarehouse', v_sales_by_warehouse,
    'salesByBranch', v_sales_by_branch,
    'latestOrders', v_latest_orders,
    'latestCustomers', v_latest_customers,
    'lowStockAlerts', v_low_stock_alerts,
    'recentInventoryMovements', v_recent_inventory_movements,
    'todayNotifications', v_today_notifications
  );
END;
$$;
