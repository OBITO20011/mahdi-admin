-- =========================================================================
-- Nawasrah ERP - Full sales returns, inventory disposition and shift refunds
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS public.sales_return_number_seq START 1001;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'new',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled',
    'returned'
  ));

CREATE TABLE IF NOT EXISTS public.sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT UNIQUE NOT NULL,
  order_id UUID UNIQUE NOT NULL
    REFERENCES public.orders(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL
    REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL
    REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  cash_shift_id UUID NOT NULL
    REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  stock_disposition TEXT NOT NULL
    CHECK (stock_disposition IN ('restock', 'damaged')),
  reason TEXT NOT NULL,
  refund_method TEXT NOT NULL
    CHECK (refund_method IN ('cash', 'cliq')),
  refund_amount_in_minor_units BIGINT NOT NULL
    CHECK (refund_amount_in_minor_units > 0),
  reference_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    refund_method <> 'cliq'
    OR NULLIF(TRIM(reference_number), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_shift
  ON public.sales_returns(cash_shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_order
  ON public.sales_returns(order_id);

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active ERP staff can read sales returns"
  ON public.sales_returns;
CREATE POLICY "Active ERP staff can read sales returns"
  ON public.sales_returns
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_active_erp_staff()));

REVOKE ALL ON TABLE public.sales_returns
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.sales_returns TO authenticated;

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS cash_refunds_in_minor_units BIGINT
    NOT NULL DEFAULT 0 CHECK (cash_refunds_in_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS cliq_refunds_in_minor_units BIGINT
    NOT NULL DEFAULT 0 CHECK (cliq_refunds_in_minor_units >= 0);

-- Preserve the amount originally collected while expressing the final state
-- as refunded. The order is excluded from realized sales reports by status.
CREATE OR REPLACE FUNCTION public.sync_order_payment_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.amount_paid_in_minor_units := LEAST(
    GREATEST(COALESCE(NEW.amount_paid_in_minor_units, 0), 0),
    NEW.total_in_minor_units
  );

  IF NEW.status = 'completed'
    AND COALESCE(NEW.payment_method, 'cash_on_delivery') <> 'debt'
  THEN
    NEW.amount_paid_in_minor_units := NEW.total_in_minor_units;
  END IF;

  IF NEW.status = 'returned' THEN
    NEW.payment_status := 'refunded';
  ELSE
    NEW.payment_status := CASE
      WHEN NEW.amount_paid_in_minor_units >= NEW.total_in_minor_units
        THEN 'paid'
      WHEN NEW.amount_paid_in_minor_units > 0
        THEN 'partially_paid'
      ELSE 'unpaid'
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_completed_website_order(
  p_order_id UUID,
  p_reason TEXT,
  p_stock_disposition TEXT,
  p_refund_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order public.orders%ROWTYPE;
  v_shift_id UUID;
  v_shift_number TEXT;
  v_return_id UUID;
  v_return_number TEXT;
  v_item RECORD;
  v_balance_before INTEGER;
  v_balance_after INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'تسجيل مرتجع مبيعات ورد المبلغ'
  );

  IF CHAR_LENGTH(TRIM(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'اكتب سبب المرتجع بوضوح.';
  END IF;

  IF p_stock_disposition NOT IN ('restock', 'damaged') THEN
    RAISE EXCEPTION 'حدد هل البضاعة سليمة وتعود للمخزون أم تالفة.';
  END IF;

  IF p_refund_method NOT IN ('cash', 'cliq') THEN
    RAISE EXCEPTION 'طريقة رد المبلغ يجب أن تكون كاش أو CliQ.';
  END IF;

  IF p_refund_method = 'cliq'
    AND NULLIF(TRIM(p_reference_number), '') IS NULL
  THEN
    RAISE EXCEPTION 'رقم مرجع CliQ مطلوب عند رد المبلغ إلكترونيًا.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود.';
  END IF;
  IF v_order.source = 'pos' THEN
    RAISE EXCEPTION 'مرتجع البيع المباشر يجب أن يتم من مسار نقطة البيع.';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'يمكن إرجاع طلب مكتمل ومسلم فقط.';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'لا يمكن رد مبلغ طلب غير مدفوع بالكامل.';
  END IF;
  IF v_order.branch_id IS NULL OR v_order.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'الطلب غير مرتبط بفرع ومستودع صالحين.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.sales_returns WHERE order_id = p_order_id
  ) THEN
    RAISE EXCEPTION 'تم تسجيل مرتجع لهذا الطلب مسبقًا.';
  END IF;

  SELECT id, shift_number
  INTO v_shift_id, v_shift_number
  FROM public.cash_shifts
  WHERE branch_id = v_order.branch_id
    AND status = 'open'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولاً قبل رد مبلغ المرتجع.';
  END IF;

  v_return_number :=
    'SRT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
    LPAD(NEXTVAL('public.sales_return_number_seq')::TEXT, 6, '0');

  INSERT INTO public.sales_returns (
    return_number,
    order_id,
    branch_id,
    warehouse_id,
    cash_shift_id,
    stock_disposition,
    reason,
    refund_method,
    refund_amount_in_minor_units,
    reference_number,
    notes,
    created_by
  ) VALUES (
    v_return_number,
    p_order_id,
    v_order.branch_id,
    v_order.warehouse_id,
    v_shift_id,
    p_stock_disposition,
    TRIM(p_reason),
    p_refund_method,
    v_order.total_in_minor_units,
    CASE WHEN p_refund_method = 'cliq'
      THEN NULLIF(TRIM(p_reference_number), '') ELSE NULL END,
    NULLIF(TRIM(p_notes), ''),
    v_user_id
  )
  RETURNING id INTO v_return_id;

  IF p_stock_disposition = 'restock' THEN
    FOR v_item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = p_order_id
      ORDER BY product_id
    LOOP
      SELECT on_hand_quantity
      INTO v_balance_before
      FROM public.inventory_balances
      WHERE warehouse_id = v_order.warehouse_id
        AND product_id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'لا يوجد رصيد مخزون للصنف المرتجع (%).',
          v_item.product_id;
      END IF;

      v_balance_after := v_balance_before + v_item.quantity;

      UPDATE public.inventory_balances
      SET on_hand_quantity = v_balance_after,
          updated_at = NOW()
      WHERE warehouse_id = v_order.warehouse_id
        AND product_id = v_item.product_id;

      INSERT INTO public.inventory_movements (
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        balance_before,
        balance_after,
        reference_type,
        reference_id,
        notes,
        created_by
      ) VALUES (
        v_order.warehouse_id,
        v_item.product_id,
        'return_in',
        v_item.quantity,
        v_balance_before,
        v_balance_after,
        'sales_return',
        v_return_id,
        'إعادة صنف سليم للمخزون من المرتجع ' || v_return_number,
        v_user_id
      );
    END LOOP;
  END IF;

  UPDATE public.orders
  SET status = 'returned',
      payment_status = 'refunded',
      updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    'completed',
    'returned',
    v_user_id,
    'مرتجع ' || v_return_number || ': ' || TRIM(p_reason)
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'RETURN_COMPLETED_WEBSITE_ORDER',
    'sales_returns',
    v_return_id,
    jsonb_build_object(
      'return_number', v_return_number,
      'order_id', p_order_id,
      'order_number', v_order.order_number,
      'refund_method', p_refund_method,
      'refund_amount_in_minor_units', v_order.total_in_minor_units,
      'stock_disposition', p_stock_disposition,
      'cash_shift_id', v_shift_id,
      'cash_shift_number', v_shift_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'status', 'returned',
    'payment_status', 'refunded',
    'stock_disposition', p_stock_disposition,
    'refund_method', p_refund_method,
    'refund_amount_in_minor_units', v_order.total_in_minor_units,
    'cash_shift_id', v_shift_id,
    'cash_shift_number', v_shift_number,
    'message', CASE
      WHEN p_stock_disposition = 'restock'
        THEN 'تم تسجيل المرتجع ورد المبلغ وإعادة البضاعة السليمة للمخزون.'
      ELSE 'تم تسجيل المرتجع ورد المبلغ وتوثيق البضاعة كتالف دون إعادتها للمخزون.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

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
  v_cash_refunds BIGINT := 0;
  v_cliq_refunds BIGINT := 0;
  v_expected_cash BIGINT := 0;
  v_cashier_name TEXT;
  v_closed_by_name TEXT;
BEGIN
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id;
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
        AND o.status IN ('completed', 'returned')
    ), attributed_orders AS (
      SELECT * FROM completed_orders
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
          AND (
            cash_shift_id = v_shift.id
            OR (
              cash_shift_id IS NULL
              AND completed_at >= v_shift.opened_at
              AND completed_at <= v_period_end
            )
          )
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
    'cashExpensesInMinorUnits', v_cash_expenses,
    'cliqExpensesInMinorUnits', v_cliq_expenses,
    'cashRefundsInMinorUnits', v_cash_refunds,
    'cliqRefundsInMinorUnits', v_cliq_refunds,
    'expectedCashInMinorUnits', v_expected_cash,
    'actualCashInMinorUnits', v_shift.actual_cash_in_minor_units,
    'cashDiscrepancyInMinorUnits', v_shift.cash_discrepancy_in_minor_units,
    'discrepancyReason', v_shift.discrepancy_reason,
    'status', v_shift.status,
    'managerSignOffBy', v_closed_by_name
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
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;
  IF v_shift.status <> 'open' THEN RAISE EXCEPTION 'هذه الوردية مغلقة مسبقًا.'; END IF;

  v_summary := public.get_cash_shift_summary(p_shift_id);
  v_expected := (v_summary->>'expectedCashInMinorUnits')::BIGINT;
  v_discrepancy := p_actual_cash_in_minor_units - v_expected;
  IF v_discrepancy <> 0
    AND NULLIF(TRIM(p_discrepancy_reason), '') IS NULL
  THEN
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
    cash_refunds_in_minor_units = (v_summary->>'cashRefundsInMinorUnits')::BIGINT,
    cliq_refunds_in_minor_units = (v_summary->>'cliqRefundsInMinorUnits')::BIGINT,
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
      'discrepancy_reason', NULLIF(TRIM(p_discrepancy_reason), '')
    )
  );

  RETURN public.get_cash_shift_summary(p_shift_id) || jsonb_build_object(
    'success', true,
    'message', 'تم إغلاق الوردية وتثبيت جرد الصندوق بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  TO authenticated;

COMMENT ON TABLE public.sales_returns IS
  'Audited full-order sales returns with refund, stock disposition and shift linkage.';
COMMENT ON FUNCTION public.return_completed_website_order(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'Atomically records a full website order return, refunds cash/CliQ and optionally restocks saleable goods.';
