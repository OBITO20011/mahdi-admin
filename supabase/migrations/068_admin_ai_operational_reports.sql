-- =========================================================================
-- Nawasrah ERP - Read-only monthly data source for the admin AI assistant
-- The language model must never calculate accounting figures itself. This
-- function reuses the existing role-checked operational report per branch,
-- and returns only anonymous operational totals for the current month.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_ai_monthly_report()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_date DATE := (NOW() AT TIME ZONE 'Asia/Amman')::DATE;
  v_date_from DATE;
  v_date_to DATE;
  v_report JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'قراءة التقرير الشهري لمساعد الإدارة الذكي'
  );

  v_date_from := date_trunc('month', v_business_date)::DATE;
  v_date_to := (v_date_from + INTERVAL '1 month - 1 day')::DATE;

  WITH branch_reports AS (
    SELECT
      b.id,
      b.name_ar,
      public.get_operational_business_report(
        b.id,
        v_date_from,
        v_date_to
      ) AS report
    FROM public.branches b
    WHERE b.is_active = true
  ),
  totals AS (
    SELECT
      COUNT(*)::INTEGER AS branch_count,
      COALESCE(SUM(COALESCE((report->'sales'->>'orderCount')::BIGINT, 0)), 0)::BIGINT
        AS order_count,
      COALESCE(SUM(COALESCE((report->'sales'->>'grossSalesInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS gross_sales,
      COALESCE(SUM(COALESCE((report->'sales'->>'netSalesInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS net_sales,
      COALESCE(SUM(COALESCE((report->'sales'->>'grossProfitInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS gross_profit,
      COALESCE(SUM(COALESCE((report->'sales'->>'netProfitInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS net_profit,
      COALESCE(SUM(COALESCE((report->'sales'->>'collectedInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS collected,
      COALESCE(SUM(COALESCE((report->'sales'->>'outstandingInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS period_outstanding,
      COALESCE(SUM(COALESCE((report->'expenses'->>'count')::BIGINT, 0)), 0)::BIGINT
        AS expense_count,
      COALESCE(SUM(COALESCE((report->'expenses'->>'totalInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS expenses_total,
      COALESCE(SUM(COALESCE((report->'purchases'->>'receiptCount')::BIGINT, 0)), 0)::BIGINT
        AS purchase_receipt_count,
      COALESCE(SUM(COALESCE((report->'purchases'->>'totalInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS purchases_total,
      COALESCE(SUM(COALESCE((report->'balances'->>'customerDueInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS customer_due,
      COALESCE(SUM(COALESCE((report->'balances'->>'supplierDueInMinorUnits')::BIGINT, 0)), 0)::BIGINT
        AS supplier_due,
      COALESCE(SUM(COALESCE((report->'inventory'->>'stockedProducts')::BIGINT, 0)), 0)::BIGINT
        AS stocked_products,
      COALESCE(SUM(COALESCE((report->'inventory'->>'lowStockProducts')::BIGINT, 0)), 0)::BIGINT
        AS low_stock_products
    FROM branch_reports
  ),
  branch_payload AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT('name', name_ar)
        ORDER BY name_ar ASC
      ),
      '[]'::JSONB
    ) AS payload
    FROM branch_reports
  )
  SELECT JSONB_BUILD_OBJECT(
    'success', true,
    'generatedAt', NOW(),
    'period', JSONB_BUILD_OBJECT(
      'dateFrom', v_date_from,
      'dateTo', v_date_to,
      'label', TO_CHAR(v_date_from, 'YYYY-MM')
    ),
    'branches', branch_payload.payload,
    'sales', JSONB_BUILD_OBJECT(
      'orderCount', totals.order_count,
      'grossSalesInMinorUnits', totals.gross_sales,
      'netSalesInMinorUnits', totals.net_sales,
      'grossProfitInMinorUnits', totals.gross_profit,
      'netProfitInMinorUnits', totals.net_profit,
      'collectedInMinorUnits', totals.collected,
      'outstandingInMinorUnits', totals.period_outstanding
    ),
    'expenses', JSONB_BUILD_OBJECT(
      'count', totals.expense_count,
      'totalInMinorUnits', totals.expenses_total
    ),
    'purchases', JSONB_BUILD_OBJECT(
      'receiptCount', totals.purchase_receipt_count,
      'totalInMinorUnits', totals.purchases_total
    ),
    'balances', JSONB_BUILD_OBJECT(
      'customerDueInMinorUnits', totals.customer_due,
      'supplierDueInMinorUnits', totals.supplier_due
    ),
    'inventory', JSONB_BUILD_OBJECT(
      'stockedProducts', totals.stocked_products,
      'lowStockProducts', totals.low_stock_products
    ),
    'branchCount', totals.branch_count
  )
  INTO v_report
  FROM totals
  CROSS JOIN branch_payload;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_ai_monthly_report()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_monthly_report()
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_ai_monthly_report() IS
  'Anonymous, current-month operational totals for the authenticated admin AI assistant. Reuses get_operational_business_report.';

COMMIT;
