-- =========================================================================
-- Nawasrah ERP - Audited cancellation for an accidentally opened empty shift
-- =========================================================================

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS cancelled_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_status_check;
ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_check;
ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_lifecycle_check;

ALTER TABLE public.cash_shifts
  ADD CONSTRAINT cash_shifts_status_check
    CHECK (status IN ('open', 'closed', 'cancelled')),
  ADD CONSTRAINT cash_shifts_lifecycle_check CHECK (
    (
      status = 'open'
      AND closed_at IS NULL
      AND actual_cash_in_minor_units IS NULL
      AND cancelled_at IS NULL
    )
    OR (
      status = 'closed'
      AND closed_at IS NOT NULL
      AND actual_cash_in_minor_units IS NOT NULL
      AND cancelled_at IS NULL
    )
    OR (
      status = 'cancelled'
      AND closed_at IS NULL
      AND actual_cash_in_minor_units IS NULL
      AND cancelled_at IS NOT NULL
      AND NULLIF(TRIM(cancellation_reason), '') IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.get_cash_shift_display_summary(
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
  v_opened_by_name TEXT;
  v_cancelled_by_name TEXT;
BEGIN
  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;

  IF v_shift.status <> 'cancelled' THEN
    RETURN public.get_cash_shift_summary(p_shift_id);
  END IF;

  SELECT full_name INTO v_opened_by_name
  FROM public.profiles WHERE id = v_shift.opened_by;
  SELECT full_name INTO v_cancelled_by_name
  FROM public.profiles WHERE id = v_shift.cancelled_by;

  RETURN jsonb_build_object(
    'id', v_shift.id,
    'shiftNumber', v_shift.shift_number,
    'branchId', v_shift.branch_id,
    'cashierName', COALESCE(v_opened_by_name, 'مستخدم النظام'),
    'startTime', v_shift.opened_at,
    'endTime', v_shift.cancelled_at,
    'openingCashInMinorUnits', v_shift.opening_cash_in_minor_units,
    'cashSalesInMinorUnits', 0,
    'cliqSalesInMinorUnits', 0,
    'cardSalesInMinorUnits', 0,
    'cashReceiptsInMinorUnits', 0,
    'cliqReceiptsInMinorUnits', 0,
    'cashSupplierPaymentsInMinorUnits', 0,
    'cliqSupplierPaymentsInMinorUnits', 0,
    'cashExpensesInMinorUnits', 0,
    'cliqExpensesInMinorUnits', 0,
    'cashRefundsInMinorUnits', 0,
    'cliqRefundsInMinorUnits', 0,
    'expectedCashInMinorUnits', v_shift.opening_cash_in_minor_units,
    'actualCashInMinorUnits', NULL,
    'cashDiscrepancyInMinorUnits', NULL,
    'discrepancyReason', NULL,
    'status', 'cancelled',
    'managerSignOffBy', NULL,
    'cancelledByName', v_cancelled_by_name,
    'cancelledAt', v_shift.cancelled_at,
    'cancellationReason', v_shift.cancellation_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_empty_cash_shift(
  p_shift_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_shift public.cash_shifts%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إلغاء وردية فُتحت بالخطأ'
  );

  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) < 2 THEN
    RAISE EXCEPTION 'اكتب سبب إلغاء الوردية.';
  END IF;
  IF CHAR_LENGTH(v_reason) > 500 THEN
    RAISE EXCEPTION 'سبب إلغاء الوردية أطول من المسموح.';
  END IF;

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'يمكن إلغاء وردية مفتوحة فقط.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE cash_shift_id = p_shift_id
    UNION ALL
    SELECT 1 FROM public.customer_payments
    WHERE cash_shift_id = p_shift_id
    UNION ALL
    SELECT 1 FROM public.supplier_payments
    WHERE cash_shift_id = p_shift_id
    UNION ALL
    SELECT 1 FROM public.operational_expenses
    WHERE shift_id = p_shift_id
    UNION ALL
    SELECT 1 FROM public.sales_returns
    WHERE cash_shift_id = p_shift_id
  ) THEN
    RAISE EXCEPTION
      'لا يمكن إلغاء الوردية لأنها تحتوي حركة مالية. صحح العملية ثم أغلق الوردية طبيعيًا.';
  END IF;

  UPDATE public.cash_shifts
  SET
    status = 'cancelled',
    cancelled_by = v_user_id,
    cancelled_at = NOW(),
    cancellation_reason = v_reason,
    expected_cash_in_minor_units = opening_cash_in_minor_units,
    updated_at = NOW()
  WHERE id = p_shift_id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'CANCEL_EMPTY_CASH_SHIFT',
    'cash_shifts',
    p_shift_id,
    jsonb_build_object(
      'shift_number', v_shift.shift_number,
      'opening_cash_in_minor_units',
        v_shift.opening_cash_in_minor_units,
      'reason', v_reason,
      'verified_empty', true
    )
  );

  RETURN public.get_cash_shift_display_summary(p_shift_id)
    || jsonb_build_object(
      'success', true,
      'message',
        'تم إلغاء الوردية الفارغة وحفظ السبب في سجل التدقيق.'
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
    'currentShift', CASE
      WHEN v_open_shift_id IS NULL THEN NULL
      ELSE public.get_cash_shift_display_summary(v_open_shift_id)
    END,
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
      SELECT jsonb_agg(
        public.get_cash_shift_display_summary(id)
        ORDER BY opened_at DESC
      )
      FROM (
        SELECT id, opened_at
        FROM public.cash_shifts
        WHERE branch_id = p_branch_id
          AND status IN ('closed', 'cancelled')
        ORDER BY opened_at DESC
        LIMIT 10
      ) recent
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_display_summary(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_expense_shift_center(UUID, INTEGER)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_shift_center(UUID, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) IS
  'Cancels, but never deletes, an open shift after verifying that it has no financial or order activity.';
