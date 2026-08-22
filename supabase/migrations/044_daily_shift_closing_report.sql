-- =========================================================================
-- Nawasrah ERP - Complete daily shift closing report and payment attribution
-- All monetary amounts use Jordanian minor units (1 JOD = 1000).
-- =========================================================================

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS cash_shift_id UUID
    REFERENCES public.cash_shifts(id) ON DELETE RESTRICT;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS cash_shift_id UUID
    REFERENCES public.cash_shifts(id) ON DELETE RESTRICT;

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS cliq_supplier_payments_in_minor_units BIGINT
    NOT NULL DEFAULT 0
    CHECK (cliq_supplier_payments_in_minor_units >= 0);

CREATE INDEX IF NOT EXISTS idx_customer_payments_cash_shift
  ON public.customer_payments(cash_shift_id)
  WHERE cash_shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_cash_shift
  ON public.supplier_payments(cash_shift_id)
  WHERE cash_shift_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attach_customer_payment_to_open_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id UUID;
  v_shift_id UUID;
BEGIN
  IF NEW.payment_method NOT IN ('cash', 'cliq')
    OR NEW.cash_shift_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_branch_id
  FROM public.orders
  WHERE id = NEW.order_id;

  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = v_branch_id
    AND status = 'open'
  FOR SHARE;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION
      'افتح وردية الصندوق أولًا قبل تسجيل سند قبض كاش أو CliQ.';
  END IF;

  NEW.cash_shift_id := v_shift_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_payment_open_shift
  ON public.customer_payments;
CREATE TRIGGER trg_customer_payment_open_shift
BEFORE INSERT ON public.customer_payments
FOR EACH ROW
EXECUTE FUNCTION public.attach_customer_payment_to_open_shift();

CREATE OR REPLACE FUNCTION public.attach_supplier_payment_to_open_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch_id UUID;
  v_shift_id UUID;
BEGIN
  IF NEW.payment_method NOT IN ('cash', 'cliq')
    OR NEW.cash_shift_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT branch_id FROM public.purchase_orders
     WHERE id = NEW.purchase_order_id),
    (SELECT branch_id FROM public.supplier_receipts
     WHERE id = NEW.supplier_receipt_id)
  ) INTO v_branch_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'تعذر تحديد فرع دفعة المورد.';
  END IF;

  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = v_branch_id
    AND status = 'open'
  FOR SHARE;

  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION
      'افتح وردية الصندوق أولًا قبل تسجيل دفعة مورد كاش أو CliQ.';
  END IF;

  NEW.cash_shift_id := v_shift_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payment_open_shift
  ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payment_open_shift
BEFORE INSERT ON public.supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public.attach_supplier_payment_to_open_shift();

CREATE OR REPLACE FUNCTION public.get_cash_shift_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_period_end TIMESTAMPTZ;
  v_cash_sales BIGINT := 0;
  v_cliq_sales BIGINT := 0;
  v_card_sales BIGINT := 0;
  v_cash_receipts BIGINT := 0;
  v_cliq_receipts BIGINT := 0;
  v_cash_supplier_payments BIGINT := 0;
  v_cliq_supplier_payments BIGINT := 0;
  v_cash_expenses BIGINT := 0;
  v_cliq_expenses BIGINT := 0;
  v_cash_refunds BIGINT := 0;
  v_cliq_refunds BIGINT := 0;
  v_expected_cash BIGINT := 0;
  v_cashier_name TEXT;
  v_closed_by_name TEXT;
BEGIN
  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;

  SELECT full_name INTO v_cashier_name
  FROM public.profiles WHERE id = v_shift.opened_by;
  SELECT full_name INTO v_closed_by_name
  FROM public.profiles WHERE id = v_shift.closed_by;

  IF v_shift.status = 'closed' THEN
    v_cash_sales := v_shift.cash_sales_in_minor_units;
    v_cliq_sales := v_shift.cliq_sales_in_minor_units;
    v_card_sales := v_shift.card_sales_in_minor_units;
    v_cash_receipts := v_shift.cash_receipts_in_minor_units;
    v_cliq_receipts := v_shift.cliq_receipts_in_minor_units;
    v_cash_supplier_payments :=
      v_shift.cash_supplier_payments_in_minor_units;
    v_cliq_supplier_payments :=
      v_shift.cliq_supplier_payments_in_minor_units;
    v_cash_expenses := v_shift.cash_expenses_in_minor_units;
    v_cliq_expenses := v_shift.cliq_expenses_in_minor_units;
    v_cash_refunds := v_shift.cash_refunds_in_minor_units;
    v_cliq_refunds := v_shift.cliq_refunds_in_minor_units;
    v_expected_cash := v_shift.expected_cash_in_minor_units;
  ELSE
    v_period_end := NOW();

    WITH completed_orders AS (
      SELECT
        o.total_in_minor_units,
        o.payment_method,
        o.source,
        o.cash_shift_id,
        COALESCE((
          SELECT MIN(osh.created_at)
          FROM public.order_status_history osh
          WHERE osh.order_id = o.id
            AND osh.new_status = 'completed'
        ), o.updated_at) AS completed_at
      FROM public.orders o
      WHERE o.branch_id = v_shift.branch_id
        AND o.status IN ('completed', 'returned')
    ), attributed_orders AS (
      SELECT * FROM completed_orders
      WHERE cash_shift_id = v_shift.id
        OR (
          cash_shift_id IS NULL
          AND completed_at >= v_shift.opened_at
          AND completed_at <= v_period_end
        )
    )
    SELECT
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method IN ('cash', 'cash_on_delivery')
      ), 0),
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'cliq'
      ), 0),
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'card'
      ), 0)
    INTO v_cash_sales, v_cliq_sales, v_card_sales
    FROM attributed_orders;

    SELECT
      COALESCE(SUM(cp.amount_in_minor_units) FILTER (
        WHERE cp.payment_method = 'cash'
      ), 0),
      COALESCE(SUM(cp.amount_in_minor_units) FILTER (
        WHERE cp.payment_method = 'cliq'
      ), 0)
    INTO v_cash_receipts, v_cliq_receipts
    FROM public.customer_payments cp
    JOIN public.orders o ON o.id = cp.order_id
    WHERE o.branch_id = v_shift.branch_id
      AND o.payment_method = 'debt'
      AND (
        cp.cash_shift_id = v_shift.id
        OR (
          cp.cash_shift_id IS NULL
          AND cp.created_at >= v_shift.opened_at
          AND cp.created_at <= v_period_end
        )
      );

    SELECT
      COALESCE(SUM(sp.amount_in_minor_units) FILTER (
        WHERE sp.payment_method = 'cash'
      ), 0),
      COALESCE(SUM(sp.amount_in_minor_units) FILTER (
        WHERE sp.payment_method = 'cliq'
      ), 0)
    INTO v_cash_supplier_payments, v_cliq_supplier_payments
    FROM public.supplier_payments sp
    LEFT JOIN public.purchase_orders po
      ON po.id = sp.purchase_order_id
    LEFT JOIN public.supplier_receipts sr
      ON sr.id = sp.supplier_receipt_id
    WHERE COALESCE(po.branch_id, sr.branch_id) = v_shift.branch_id
      AND COALESCE(sp.is_reversed, false) = false
      AND (
        sp.cash_shift_id = v_shift.id
        OR (
          sp.cash_shift_id IS NULL
          AND sp.payment_date >= v_shift.opened_at
          AND sp.payment_date <= v_period_end
        )
      );

    SELECT
      COALESCE(SUM(amount_in_minor_units) FILTER (
        WHERE payment_method = 'cash'
      ), 0),
      COALESCE(SUM(amount_in_minor_units) FILTER (
        WHERE payment_method = 'cliq'
      ), 0)
    INTO v_cash_expenses, v_cliq_expenses
    FROM public.operational_expenses
    WHERE shift_id = v_shift.id;

    SELECT
      COALESCE(SUM(refund_amount_in_minor_units) FILTER (
        WHERE refund_method = 'cash'
      ), 0),
      COALESCE(SUM(refund_amount_in_minor_units) FILTER (
        WHERE refund_method = 'cliq'
      ), 0)
    INTO v_cash_refunds, v_cliq_refunds
    FROM public.sales_returns
    WHERE cash_shift_id = v_shift.id;

    v_expected_cash := v_shift.opening_cash_in_minor_units
      + v_cash_sales
      + v_cash_receipts
      - v_cash_supplier_payments
      - v_cash_expenses
      - v_cash_refunds;
  END IF;

  RETURN jsonb_build_object(
    'id', v_shift.id,
    'shiftNumber', v_shift.shift_number,
    'branchId', v_shift.branch_id,
    'cashierName', COALESCE(v_cashier_name, 'مستخدم النظام'),
    'startTime', v_shift.opened_at,
    'endTime', v_shift.closed_at,
    'openingCashInMinorUnits', v_shift.opening_cash_in_minor_units,
    'cashSalesInMinorUnits', v_cash_sales,
    'cliqSalesInMinorUnits', v_cliq_sales,
    'cardSalesInMinorUnits', v_card_sales,
    'cashReceiptsInMinorUnits', v_cash_receipts,
    'cliqReceiptsInMinorUnits', v_cliq_receipts,
    'cashSupplierPaymentsInMinorUnits', v_cash_supplier_payments,
    'cliqSupplierPaymentsInMinorUnits', v_cliq_supplier_payments,
    'cashExpensesInMinorUnits', v_cash_expenses,
    'cliqExpensesInMinorUnits', v_cliq_expenses,
    'cashRefundsInMinorUnits', v_cash_refunds,
    'cliqRefundsInMinorUnits', v_cliq_refunds,
    'expectedCashInMinorUnits', v_expected_cash,
    'actualCashInMinorUnits', v_shift.actual_cash_in_minor_units,
    'cashDiscrepancyInMinorUnits',
      v_shift.cash_discrepancy_in_minor_units,
    'discrepancyReason', v_shift.discrepancy_reason,
    'status', v_shift.status,
    'managerSignOffBy', v_closed_by_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_cash_shift_closing_report(
  p_shift_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_period_end TIMESTAMPTZ;
  v_order_count INTEGER := 0;
  v_pos_order_count INTEGER := 0;
  v_website_order_count INTEGER := 0;
  v_package_count BIGINT := 0;
  v_unique_product_count INTEGER := 0;
  v_customer_receipt_count INTEGER := 0;
  v_supplier_payment_count INTEGER := 0;
  v_expense_count INTEGER := 0;
  v_return_count INTEGER := 0;
  v_gross_sales BIGINT := 0;
  v_total_refunds BIGINT := 0;
  v_total_inflows BIGINT := 0;
  v_total_outflows BIGINT := 0;
  v_net_cliq BIGINT := 0;
  v_expense_breakdown JSONB := '[]'::JSONB;
  v_return_breakdown JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض تقرير إغلاق الوردية'
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;

  v_period_end := COALESCE(v_shift.closed_at, NOW());
  v_summary := public.get_cash_shift_summary(p_shift_id);

  WITH attributed_orders AS (
    SELECT
      o.id,
      o.source,
      o.cash_shift_id,
      COALESCE((
        SELECT MIN(osh.created_at)
        FROM public.order_status_history osh
        WHERE osh.order_id = o.id
          AND osh.new_status = 'completed'
      ), o.updated_at) AS completed_at
    FROM public.orders o
    WHERE o.branch_id = v_shift.branch_id
      AND o.status IN ('completed', 'returned')
  ), selected_orders AS (
    SELECT * FROM attributed_orders
    WHERE cash_shift_id = v_shift.id
      OR (
        cash_shift_id IS NULL
        AND completed_at >= v_shift.opened_at
        AND completed_at <= v_period_end
      )
  )
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE source = 'pos')::INTEGER,
    COUNT(*) FILTER (WHERE source IS DISTINCT FROM 'pos')::INTEGER,
    COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      WHERE oi.order_id IN (SELECT id FROM selected_orders)
    ), 0),
    COALESCE((
      SELECT COUNT(DISTINCT oi.product_id)
      FROM public.order_items oi
      WHERE oi.order_id IN (SELECT id FROM selected_orders)
        AND oi.product_id IS NOT NULL
    ), 0)::INTEGER
  INTO
    v_order_count,
    v_pos_order_count,
    v_website_order_count,
    v_package_count,
    v_unique_product_count
  FROM selected_orders;

  SELECT COUNT(*)::INTEGER
  INTO v_customer_receipt_count
  FROM public.customer_payments cp
  JOIN public.orders o ON o.id = cp.order_id
  WHERE o.branch_id = v_shift.branch_id
    AND o.payment_method = 'debt'
    AND (
      cp.cash_shift_id = v_shift.id
      OR (
        cp.cash_shift_id IS NULL
        AND cp.created_at >= v_shift.opened_at
        AND cp.created_at <= v_period_end
      )
    );

  SELECT COUNT(*)::INTEGER
  INTO v_supplier_payment_count
  FROM public.supplier_payments sp
  LEFT JOIN public.purchase_orders po
    ON po.id = sp.purchase_order_id
  LEFT JOIN public.supplier_receipts sr
    ON sr.id = sp.supplier_receipt_id
  WHERE COALESCE(po.branch_id, sr.branch_id) = v_shift.branch_id
    AND COALESCE(sp.is_reversed, false) = false
    AND sp.payment_method IN ('cash', 'cliq')
    AND (
      sp.cash_shift_id = v_shift.id
      OR (
        sp.cash_shift_id IS NULL
        AND sp.payment_date >= v_shift.opened_at
        AND sp.payment_date <= v_period_end
      )
    );

  SELECT COUNT(*)::INTEGER
  INTO v_expense_count
  FROM public.operational_expenses
  WHERE shift_id = v_shift.id;

  SELECT COUNT(*)::INTEGER
  INTO v_return_count
  FROM public.sales_returns
  WHERE cash_shift_id = v_shift.id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category', category,
      'count', item_count,
      'amountInMinorUnits', amount_in_minor_units
    ) ORDER BY amount_in_minor_units DESC, category
  ), '[]'::JSONB)
  INTO v_expense_breakdown
  FROM (
    SELECT
      category,
      COUNT(*)::INTEGER AS item_count,
      SUM(amount_in_minor_units)::BIGINT AS amount_in_minor_units
    FROM public.operational_expenses
    WHERE shift_id = v_shift.id
    GROUP BY category
  ) expense_groups;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'refundMethod', refund_method,
      'stockDisposition', stock_disposition,
      'count', item_count,
      'amountInMinorUnits', amount_in_minor_units
    ) ORDER BY amount_in_minor_units DESC
  ), '[]'::JSONB)
  INTO v_return_breakdown
  FROM (
    SELECT
      refund_method,
      stock_disposition,
      COUNT(*)::INTEGER AS item_count,
      SUM(refund_amount_in_minor_units)::BIGINT AS amount_in_minor_units
    FROM public.sales_returns
    WHERE cash_shift_id = v_shift.id
    GROUP BY refund_method, stock_disposition
  ) return_groups;

  v_gross_sales :=
    (v_summary->>'cashSalesInMinorUnits')::BIGINT
    + (v_summary->>'cliqSalesInMinorUnits')::BIGINT
    + (v_summary->>'cardSalesInMinorUnits')::BIGINT;
  v_total_refunds :=
    (v_summary->>'cashRefundsInMinorUnits')::BIGINT
    + (v_summary->>'cliqRefundsInMinorUnits')::BIGINT;
  v_total_inflows := v_gross_sales
    + (v_summary->>'cashReceiptsInMinorUnits')::BIGINT
    + (v_summary->>'cliqReceiptsInMinorUnits')::BIGINT;
  v_total_outflows :=
    (v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT
    + (v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT
    + (v_summary->>'cashExpensesInMinorUnits')::BIGINT
    + (v_summary->>'cliqExpensesInMinorUnits')::BIGINT
    + v_total_refunds;
  v_net_cliq :=
    (v_summary->>'cliqSalesInMinorUnits')::BIGINT
    + (v_summary->>'cliqReceiptsInMinorUnits')::BIGINT
    - (v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT
    - (v_summary->>'cliqExpensesInMinorUnits')::BIGINT
    - (v_summary->>'cliqRefundsInMinorUnits')::BIGINT;

  RETURN jsonb_build_object(
    'success', true,
    'generatedAt', NOW(),
    'shift', v_summary,
    'sales', jsonb_build_object(
      'orderCount', v_order_count,
      'posOrderCount', v_pos_order_count,
      'websiteOrderCount', v_website_order_count,
      'packageCount', v_package_count,
      'uniqueProductCount', v_unique_product_count,
      'grossSalesInMinorUnits', v_gross_sales,
      'refundsInMinorUnits', v_total_refunds,
      'netSalesInMinorUnits', v_gross_sales - v_total_refunds
    ),
    'collections', jsonb_build_object(
      'count', v_customer_receipt_count,
      'cashInMinorUnits',
        (v_summary->>'cashReceiptsInMinorUnits')::BIGINT,
      'cliqInMinorUnits',
        (v_summary->>'cliqReceiptsInMinorUnits')::BIGINT
    ),
    'outflows', jsonb_build_object(
      'supplierPaymentCount', v_supplier_payment_count,
      'cashSupplierPaymentsInMinorUnits',
        (v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT,
      'cliqSupplierPaymentsInMinorUnits',
        (v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT,
      'expenseCount', v_expense_count,
      'cashExpensesInMinorUnits',
        (v_summary->>'cashExpensesInMinorUnits')::BIGINT,
      'cliqExpensesInMinorUnits',
        (v_summary->>'cliqExpensesInMinorUnits')::BIGINT,
      'returnCount', v_return_count,
      'cashRefundsInMinorUnits',
        (v_summary->>'cashRefundsInMinorUnits')::BIGINT,
      'cliqRefundsInMinorUnits',
        (v_summary->>'cliqRefundsInMinorUnits')::BIGINT
    ),
    'reconciliation', jsonb_build_object(
      'totalInflowsInMinorUnits', v_total_inflows,
      'totalOutflowsInMinorUnits', v_total_outflows,
      'netMovementInMinorUnits', v_total_inflows - v_total_outflows,
      'netCliqMovementInMinorUnits', v_net_cliq,
      'openingCashInMinorUnits',
        (v_summary->>'openingCashInMinorUnits')::BIGINT,
      'expectedCashInMinorUnits',
        (v_summary->>'expectedCashInMinorUnits')::BIGINT,
      'actualCashInMinorUnits',
        CASE WHEN v_summary->>'actualCashInMinorUnits' IS NULL
          THEN NULL
          ELSE (v_summary->>'actualCashInMinorUnits')::BIGINT
        END,
      'cashDiscrepancyInMinorUnits',
        CASE WHEN v_summary->>'cashDiscrepancyInMinorUnits' IS NULL
          THEN NULL
          ELSE (v_summary->>'cashDiscrepancyInMinorUnits')::BIGINT
        END,
      'isBalanced',
        CASE WHEN v_shift.status = 'open' THEN NULL
          ELSE COALESCE(
            (v_summary->>'cashDiscrepancyInMinorUnits')::BIGINT,
            0
          ) = 0
        END
    ),
    'expenseBreakdown', v_expense_breakdown,
    'returnBreakdown', v_return_breakdown
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cash_shift(
  p_shift_id UUID,
  p_actual_cash_in_minor_units BIGINT,
  p_discrepancy_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_expected BIGINT;
  v_discrepancy BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'إغلاق وردية الصندوق'
  );
  IF COALESCE(p_actual_cash_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'الكاش الفعلي لا يمكن أن يكون سالبًا.';
  END IF;

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'هذه الوردية مغلقة مسبقًا.';
  END IF;

  v_summary := public.get_cash_shift_summary(p_shift_id);
  v_expected := (v_summary->>'expectedCashInMinorUnits')::BIGINT;
  v_discrepancy := p_actual_cash_in_minor_units - v_expected;
  IF v_discrepancy <> 0
    AND NULLIF(TRIM(p_discrepancy_reason), '') IS NULL
  THEN
    RAISE EXCEPTION
      'اكتب سبب فرق الصندوق قبل إغلاق الوردية.';
  END IF;

  UPDATE public.cash_shifts SET
    closed_by = v_user_id,
    closed_at = NOW(),
    cash_sales_in_minor_units =
      (v_summary->>'cashSalesInMinorUnits')::BIGINT,
    cliq_sales_in_minor_units =
      (v_summary->>'cliqSalesInMinorUnits')::BIGINT,
    card_sales_in_minor_units =
      (v_summary->>'cardSalesInMinorUnits')::BIGINT,
    cash_receipts_in_minor_units =
      (v_summary->>'cashReceiptsInMinorUnits')::BIGINT,
    cliq_receipts_in_minor_units =
      (v_summary->>'cliqReceiptsInMinorUnits')::BIGINT,
    cash_supplier_payments_in_minor_units =
      (v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT,
    cliq_supplier_payments_in_minor_units =
      (v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT,
    cash_expenses_in_minor_units =
      (v_summary->>'cashExpensesInMinorUnits')::BIGINT,
    cliq_expenses_in_minor_units =
      (v_summary->>'cliqExpensesInMinorUnits')::BIGINT,
    cash_refunds_in_minor_units =
      (v_summary->>'cashRefundsInMinorUnits')::BIGINT,
    cliq_refunds_in_minor_units =
      (v_summary->>'cliqRefundsInMinorUnits')::BIGINT,
    expected_cash_in_minor_units = v_expected,
    actual_cash_in_minor_units = p_actual_cash_in_minor_units,
    cash_discrepancy_in_minor_units = v_discrepancy,
    discrepancy_reason = NULLIF(TRIM(p_discrepancy_reason), ''),
    status = 'closed',
    updated_at = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'CLOSE_CASH_SHIFT',
    'cash_shifts',
    p_shift_id,
    jsonb_build_object(
      'expected_cash_in_minor_units', v_expected,
      'actual_cash_in_minor_units', p_actual_cash_in_minor_units,
      'cash_discrepancy_in_minor_units', v_discrepancy,
      'cash_refunds_in_minor_units',
        (v_summary->>'cashRefundsInMinorUnits')::BIGINT,
      'cliq_refunds_in_minor_units',
        (v_summary->>'cliqRefundsInMinorUnits')::BIGINT,
      'cash_supplier_payments_in_minor_units',
        (v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT,
      'cliq_supplier_payments_in_minor_units',
        (v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT,
      'discrepancy_reason', NULLIF(TRIM(p_discrepancy_reason), '')
    )
  );

  RETURN public.get_cash_shift_summary(p_shift_id)
    || jsonb_build_object(
      'success', true,
      'message',
        'تم إغلاق الوردية وتثبيت تقرير الصندوق بنجاح.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_customer_payment_to_open_shift()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_supplier_payment_to_open_shift()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cash_shift_closing_report(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_cash_shift_closing_report(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.get_cash_shift_closing_report(UUID) IS
  'Returns the canonical sales, collections, outflows, refunds and drawer reconciliation for one shift.';
COMMENT ON COLUMN public.customer_payments.cash_shift_id IS
  'Open shift that collected this cash or CliQ customer payment.';
COMMENT ON COLUMN public.supplier_payments.cash_shift_id IS
  'Open shift that paid this cash or CliQ supplier payment.';
