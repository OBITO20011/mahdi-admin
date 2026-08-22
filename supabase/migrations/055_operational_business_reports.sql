-- =========================================================================
-- Nawasrah ERP - Operational business reports
-- One authenticated, role-checked RPC is the source of truth for sales,
-- profit, expenses, purchases, balances, and current inventory valuation.
-- All monetary values are returned in Jordanian minor units (1 JOD = 1000).
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_operational_business_report(
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
        COALESCE(oi.sale_package_quantity, oi.quantity)
      ), 0)::BIGINT AS package_count,
      COALESCE(SUM(oi.quantity), 0)::BIGINT AS base_unit_count,
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
        ib.on_hand_quantity * p.cost_price_in_minor_units
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
          COALESCE(oi.sale_package_quantity, oi.quantity)
        ), 0)::BIGINT AS package_count,
        COALESCE(SUM(oi.line_total_in_minor_units), 0)::BIGINT AS revenue,
        COALESCE(SUM(oi.profit_in_minor_units), 0)::BIGINT AS profit,
        jsonb_build_object(
          'productName', COALESCE(oi.product_name_snapshot, 'منتج'),
          'sku', COALESCE(oi.sku_snapshot, ''),
          'packageCount', COALESCE(SUM(
            COALESCE(oi.sale_package_quantity, oi.quantity)
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
$$;

REVOKE ALL ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE)
  TO authenticated;

COMMENT ON FUNCTION public.get_operational_business_report(UUID, DATE, DATE) IS
  'Role-checked operational report using completed-sale events and audited ERP tables.';

COMMIT;
