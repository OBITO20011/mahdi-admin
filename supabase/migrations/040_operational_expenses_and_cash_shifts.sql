-- =========================================================================
-- Nawasrah ERP - Operational expenses and cash shifts
-- All monetary amounts use Jordanian minor units (1 JOD = 1000).
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS public.operational_expense_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.cash_shift_number_seq START 1001;

CREATE TABLE IF NOT EXISTS public.cash_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_number TEXT UNIQUE NOT NULL,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash_in_minor_units BIGINT NOT NULL CHECK (opening_cash_in_minor_units >= 0),
  cash_sales_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cash_sales_in_minor_units >= 0),
  cliq_sales_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cliq_sales_in_minor_units >= 0),
  card_sales_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (card_sales_in_minor_units >= 0),
  cash_receipts_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cash_receipts_in_minor_units >= 0),
  cliq_receipts_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cliq_receipts_in_minor_units >= 0),
  cash_supplier_payments_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cash_supplier_payments_in_minor_units >= 0),
  cash_expenses_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cash_expenses_in_minor_units >= 0),
  cliq_expenses_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (cliq_expenses_in_minor_units >= 0),
  expected_cash_in_minor_units BIGINT NOT NULL DEFAULT 0,
  actual_cash_in_minor_units BIGINT CHECK (actual_cash_in_minor_units IS NULL OR actual_cash_in_minor_units >= 0),
  cash_discrepancy_in_minor_units BIGINT,
  discrepancy_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'open' AND closed_at IS NULL AND actual_cash_in_minor_units IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND actual_cash_in_minor_units IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_branch
  ON public.cash_shifts(branch_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cash_shifts_branch_opened
  ON public.cash_shifts(branch_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.operational_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number TEXT UNIQUE NOT NULL,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'cliq')),
  reference_number TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payment_method <> 'cliq' OR NULLIF(TRIM(reference_number), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_operational_expenses_branch_created
  ON public.operational_expenses(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_expenses_shift
  ON public.operational_expenses(shift_id, created_at DESC);

ALTER TABLE public.cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_shifts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.operational_expenses FROM PUBLIC, anon, authenticated;

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
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;

  SELECT full_name INTO v_cashier_name FROM public.profiles WHERE id = v_shift.opened_by;
  SELECT full_name INTO v_closed_by_name FROM public.profiles WHERE id = v_shift.closed_by;

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
        COALESCE(
          (
            SELECT MIN(osh.created_at)
            FROM public.order_status_history osh
            WHERE osh.order_id = o.id AND osh.new_status = 'completed'
          ),
          o.updated_at
        ) AS completed_at
      FROM public.orders o
      WHERE o.branch_id = v_shift.branch_id AND o.status = 'completed'
    )
    SELECT
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method IN ('cash', 'cash_on_delivery')
          AND completed_at >= v_shift.opened_at AND completed_at <= v_period_end
      ), 0),
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'cliq'
          AND completed_at >= v_shift.opened_at AND completed_at <= v_period_end
      ), 0),
      COALESCE(SUM(total_in_minor_units) FILTER (
        WHERE payment_method = 'card'
          AND completed_at >= v_shift.opened_at AND completed_at <= v_period_end
      ), 0)
    INTO v_cash_sales, v_cliq_sales, v_card_sales
    FROM completed_orders;

    SELECT
      COALESCE(SUM(cp.amount_in_minor_units) FILTER (WHERE cp.payment_method = 'cash'), 0),
      COALESCE(SUM(cp.amount_in_minor_units) FILTER (WHERE cp.payment_method = 'cliq'), 0)
    INTO v_cash_receipts, v_cliq_receipts
    FROM public.customer_payments cp
    JOIN public.orders o ON o.id = cp.order_id
    WHERE o.branch_id = v_shift.branch_id
      -- A paid cash/CliQ/card order is already included in completed_orders.
      -- Receipt vouchers represent later collection of a credit sale only.
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
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0),
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)
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

CREATE OR REPLACE FUNCTION public.get_expense_shift_center(
  p_branch_id UUID,
  p_expense_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_open_shift_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض المصروفات والورديات'
  );
  IF p_expense_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'عدد المصروفات المطلوب غير صحيح.';
  END IF;

  SELECT id INTO v_open_shift_id
  FROM public.cash_shifts
  WHERE branch_id = p_branch_id AND status = 'open'
  LIMIT 1;

  RETURN jsonb_build_object(
    'success', true,
    'currentShift', CASE WHEN v_open_shift_id IS NULL THEN NULL ELSE public.get_cash_shift_summary(v_open_shift_id) END,
    'expenses', COALESCE((
      SELECT jsonb_agg(expense_payload ORDER BY created_at DESC)
      FROM (
        SELECT
          oe.created_at,
          jsonb_build_object(
            'id', oe.id,
            'expenseNumber', oe.expense_number,
            'branchId', oe.branch_id,
            'shiftId', oe.shift_id,
            'category', oe.category,
            'description', oe.description,
            'amountInMinorUnits', oe.amount_in_minor_units,
            'paymentMethod', oe.payment_method,
            'referenceNumber', oe.reference_number,
            'createdByName', COALESCE(p.full_name, 'مستخدم النظام'),
            'createdAt', oe.created_at
          ) AS expense_payload
        FROM public.operational_expenses oe
        LEFT JOIN public.profiles p ON p.id = oe.created_by
        WHERE oe.branch_id = p_branch_id
        ORDER BY oe.created_at DESC
        LIMIT p_expense_limit
      ) expense_rows
    ), '[]'::jsonb),
    'recentShifts', COALESCE((
      SELECT jsonb_agg(public.get_cash_shift_summary(id) ORDER BY opened_at DESC)
      FROM (
        SELECT id, opened_at FROM public.cash_shifts
        WHERE branch_id = p_branch_id AND status = 'closed'
        ORDER BY opened_at DESC LIMIT 10
      ) recent
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.open_cash_shift(
  p_branch_id UUID,
  p_opening_cash_in_minor_units BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_shift_id UUID;
  v_shift_number TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'فتح وردية الصندوق'
  );
  IF COALESCE(p_opening_cash_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'العهدة الافتتاحية لا يمكن أن تكون سالبة.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير نشط.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_shifts WHERE branch_id = p_branch_id AND status = 'open') THEN
    RAISE EXCEPTION 'توجد وردية مفتوحة بالفعل لهذا الفرع.';
  END IF;

  v_shift_number := 'SHF-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('public.cash_shift_number_seq')::TEXT, 6, '0');
  INSERT INTO public.cash_shifts (
    shift_number, branch_id, opened_by, opening_cash_in_minor_units,
    expected_cash_in_minor_units
  ) VALUES (
    v_shift_number, p_branch_id, v_user_id, p_opening_cash_in_minor_units,
    p_opening_cash_in_minor_units
  ) RETURNING id INTO v_shift_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'OPEN_CASH_SHIFT', 'cash_shifts', v_shift_id,
    jsonb_build_object('shift_number', v_shift_number, 'branch_id', p_branch_id,
      'opening_cash_in_minor_units', p_opening_cash_in_minor_units));

  RETURN public.get_cash_shift_summary(v_shift_id) || jsonb_build_object(
    'success', true, 'message', 'تم فتح الوردية وربطها بالصندوق بنجاح.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_operational_expense(
  p_branch_id UUID,
  p_category TEXT,
  p_description TEXT,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_shift_id UUID;
  v_expense_id UUID;
  v_expense_number TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل مصروف تشغيلي'
  );
  IF CHAR_LENGTH(TRIM(COALESCE(p_category, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'فئة المصروف غير صحيحة.';
  END IF;
  IF CHAR_LENGTH(TRIM(COALESCE(p_description, ''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION 'وصف المصروف يجب أن يكون واضحًا.';
  END IF;
  IF COALESCE(p_amount_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'قيمة المصروف يجب أن تكون أكبر من صفر.';
  END IF;
  IF p_payment_method NOT IN ('cash', 'cliq') THEN
    RAISE EXCEPTION 'طريقة دفع المصروف يجب أن تكون كاش أو CliQ.';
  END IF;
  IF p_payment_method = 'cliq' AND NULLIF(TRIM(p_reference_number), '') IS NULL THEN
    RAISE EXCEPTION 'رقم مرجع CliQ مطلوب للمصروف الإلكتروني.';
  END IF;

  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = p_branch_id AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولًا قبل تسجيل المصروف.';
  END IF;

  v_expense_number := 'EXP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('public.operational_expense_number_seq')::TEXT, 6, '0');
  INSERT INTO public.operational_expenses (
    expense_number, branch_id, shift_id, category, description,
    amount_in_minor_units, payment_method, reference_number, created_by
  ) VALUES (
    v_expense_number, p_branch_id, v_shift_id, TRIM(p_category),
    TRIM(p_description), p_amount_in_minor_units, p_payment_method,
    NULLIF(TRIM(p_reference_number), ''), v_user_id
  ) RETURNING id INTO v_expense_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'CREATE_OPERATIONAL_EXPENSE', 'operational_expenses', v_expense_id,
    jsonb_build_object('expense_number', v_expense_number, 'shift_id', v_shift_id,
      'amount_in_minor_units', p_amount_in_minor_units, 'payment_method', p_payment_method));

  RETURN jsonb_build_object(
    'success', true,
    'expenseId', v_expense_id,
    'expenseNumber', v_expense_number,
    'shift', public.get_cash_shift_summary(v_shift_id),
    'message', 'تم تسجيل المصروف وربطه بالوردية بنجاح.'
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
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'هذه الوردية مغلقة مسبقًا.'; END IF;

  v_summary := public.get_cash_shift_summary(p_shift_id);
  v_expected := (v_summary->>'expectedCashInMinorUnits')::BIGINT;
  v_discrepancy := p_actual_cash_in_minor_units - v_expected;
  IF v_discrepancy <> 0 AND NULLIF(TRIM(p_discrepancy_reason), '') IS NULL THEN
    RAISE EXCEPTION 'اكتب سبب فرق الصندوق قبل إغلاق الوردية.';
  END IF;

  UPDATE public.cash_shifts SET
    closed_by = v_user_id,
    closed_at = NOW(),
    cash_sales_in_minor_units = (v_summary->>'cashSalesInMinorUnits')::BIGINT,
    cliq_sales_in_minor_units = (v_summary->>'cliqSalesInMinorUnits')::BIGINT,
    card_sales_in_minor_units = (v_summary->>'cardSalesInMinorUnits')::BIGINT,
    cash_receipts_in_minor_units = (v_summary->>'cashReceiptsInMinorUnits')::BIGINT,
    cliq_receipts_in_minor_units = (v_summary->>'cliqReceiptsInMinorUnits')::BIGINT,
    cash_supplier_payments_in_minor_units = (v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT,
    cash_expenses_in_minor_units = (v_summary->>'cashExpensesInMinorUnits')::BIGINT,
    cliq_expenses_in_minor_units = (v_summary->>'cliqExpensesInMinorUnits')::BIGINT,
    expected_cash_in_minor_units = v_expected,
    actual_cash_in_minor_units = p_actual_cash_in_minor_units,
    cash_discrepancy_in_minor_units = v_discrepancy,
    discrepancy_reason = NULLIF(TRIM(p_discrepancy_reason), ''),
    status = 'closed', updated_at = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'CLOSE_CASH_SHIFT', 'cash_shifts', p_shift_id,
    jsonb_build_object('expected_cash_in_minor_units', v_expected,
      'actual_cash_in_minor_units', p_actual_cash_in_minor_units,
      'cash_discrepancy_in_minor_units', v_discrepancy,
      'discrepancy_reason', NULLIF(TRIM(p_discrepancy_reason), '')));

  RETURN public.get_cash_shift_summary(p_shift_id) || jsonb_build_object(
    'success', true, 'message', 'تم إغلاق الوردية وتثبيت جرد الصندوق بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_expense_shift_center(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.open_cash_shift(UUID, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_operational_expense(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_shift_center(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_shift(UUID, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operational_expense(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT) TO authenticated;

COMMENT ON TABLE public.operational_expenses IS 'RPC-only operational expenses linked to the open branch shift.';
COMMENT ON TABLE public.cash_shifts IS 'Audited cash-register shifts with totals derived from canonical sales, receipts, supplier payments and expenses.';
