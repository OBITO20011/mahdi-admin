-- =========================================================================
-- Nawasrah ERP - Bind every direct POS sale to one open cash shift.
-- =========================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_shift_id UUID
    REFERENCES public.cash_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_cash_shift_id
  ON public.orders(cash_shift_id)
  WHERE cash_shift_id IS NOT NULL;

COMMENT ON COLUMN public.orders.cash_shift_id IS
  'The cash-register shift that atomically accepted this direct POS sale.';

CREATE OR REPLACE FUNCTION public.attach_open_cash_shift_to_pos_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  IF NEW.source IS DISTINCT FROM 'pos' THEN
    RETURN NEW;
  END IF;

  IF NEW.branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ البيع المباشر دون فرع محدد.';
  END IF;

  SELECT id
  INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = NEW.branch_id
    AND status = 'open'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولاً قبل إتمام البيع المباشر.';
  END IF;

  NEW.cash_shift_id := v_shift_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attach_open_cash_shift_to_pos_order
  ON public.orders;
CREATE TRIGGER trg_attach_open_cash_shift_to_pos_order
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.attach_open_cash_shift_to_pos_order();

REVOKE ALL ON FUNCTION public.attach_open_cash_shift_to_pos_order()
  FROM PUBLIC, anon, authenticated;

-- POS users need only a safe yes/no shift status. The full finance center stays
-- restricted to accounting roles and is not exposed here.
CREATE OR REPLACE FUNCTION public.get_open_pos_shift(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift RECORD;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'التحقق من وردية البيع المباشر'
  );

  SELECT id, shift_number, branch_id, opened_at
  INTO v_shift
  FROM public.cash_shifts
  WHERE branch_id = p_branch_id
    AND status = 'open'
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'hasOpenShift', FOUND,
    'shift', CASE
      WHEN NOT FOUND THEN NULL
      ELSE jsonb_build_object(
        'id', v_shift.id,
        'shiftNumber', v_shift.shift_number,
        'branchId', v_shift.branch_id,
        'startTime', v_shift.opened_at
      )
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_open_pos_shift(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_open_pos_shift(UUID)
  TO authenticated;

-- Replace the shift summary with explicit POS linkage. Website/delivery orders
-- remain attributed by their real completion time because they are created
-- before the cash collection shift is known.
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
  v_cash_expenses BIGINT := 0;
  v_cliq_expenses BIGINT := 0;
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
    v_cash_supplier_payments := v_shift.cash_supplier_payments_in_minor_units;
    v_cash_expenses := v_shift.cash_expenses_in_minor_units;
    v_cliq_expenses := v_shift.cliq_expenses_in_minor_units;
    v_expected_cash := v_shift.expected_cash_in_minor_units;
  ELSE
    v_period_end := NOW();

    WITH completed_orders AS (
      SELECT
        o.total_in_minor_units,
        o.payment_method,
        o.source,
        o.cash_shift_id,
        COALESCE(
          (
            SELECT MIN(osh.created_at)
            FROM public.order_status_history osh
            WHERE osh.order_id = o.id
              AND osh.new_status = 'completed'
          ),
          o.updated_at
        ) AS completed_at
      FROM public.orders o
      WHERE o.branch_id = v_shift.branch_id
        AND o.status = 'completed'
    ), attributed_orders AS (
      SELECT *
      FROM completed_orders
      WHERE
        (
          source = 'pos'
          AND (
            cash_shift_id = v_shift.id
            OR (
              cash_shift_id IS NULL
              AND completed_at >= v_shift.opened_at
              AND completed_at <= v_period_end
            )
          )
        )
        OR
        (
          source IS DISTINCT FROM 'pos'
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
      AND cp.created_at >= v_shift.opened_at
      AND cp.created_at <= v_period_end;

    SELECT COALESCE(SUM(sp.amount_in_minor_units), 0)
    INTO v_cash_supplier_payments
    FROM public.supplier_payments sp
    LEFT JOIN public.purchase_orders po ON po.id = sp.purchase_order_id
    LEFT JOIN public.supplier_receipts sr ON sr.id = sp.supplier_receipt_id
    WHERE COALESCE(po.branch_id, sr.branch_id) = v_shift.branch_id
      AND sp.payment_method = 'cash'
      AND sp.payment_date >= v_shift.opened_at
      AND sp.payment_date <= v_period_end;

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

    v_expected_cash := v_shift.opening_cash_in_minor_units
      + v_cash_sales
      + v_cash_receipts
      - v_cash_supplier_payments
      - v_cash_expenses;
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
    'cashExpensesInMinorUnits', v_cash_expenses,
    'cliqExpensesInMinorUnits', v_cliq_expenses,
    'expectedCashInMinorUnits', v_expected_cash,
    'actualCashInMinorUnits', v_shift.actual_cash_in_minor_units,
    'cashDiscrepancyInMinorUnits', v_shift.cash_discrepancy_in_minor_units,
    'discrepancyReason', v_shift.discrepancy_reason,
    'status', v_shift.status,
    'managerSignOffBy', v_closed_by_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID)
  FROM PUBLIC, anon, authenticated;
