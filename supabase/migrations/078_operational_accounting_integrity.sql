-- =========================================================================
-- Nawasrah ERP - operational accounting integrity
-- Keeps the existing small operational accounting model. This is deliberately
-- not a general ledger: all mutations remain audited, atomic RPC operations.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. Discount-aware profitability reporting
-- -------------------------------------------------------------------------
-- Preserve the current report (which already adds inventory activity) and
-- layer the financial correction without changing its public signature.
DO $$
BEGIN
  IF to_regprocedure(
    'public._get_operational_business_report_v2(uuid,date,date)'
  ) IS NULL THEN
    ALTER FUNCTION public.get_operational_business_report(UUID, DATE, DATE)
      RENAME TO _get_operational_business_report_v2;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_operational_business_report_v2(
  UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated;

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
  v_report JSONB;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_discounted_gross_profit BIGINT := 0;
  v_discount_impact BIGINT := 0;
  v_top_products JSONB := '[]'::JSONB;
  v_expense_count INTEGER := 0;
  v_active_expenses BIGINT := 0;
  v_active_cash_expenses BIGINT := 0;
  v_active_cliq_expenses BIGINT := 0;
  v_base_expenses BIGINT := 0;
  v_expense_categories JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض التقارير المالية والتشغيلية'
  );

  v_report := public._get_operational_business_report_v2(
    p_branch_id,
    p_date_from,
    p_date_to
  );
  v_period_start := p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_period_end := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';

  -- Allocate every order-level discount proportionally across its lines in
  -- integer minor units. The final remainder is assigned by a deterministic
  -- line order, so allocated discounts always total the recorded discount.
  WITH completion_events AS (
    SELECT DISTINCT ON (osh.order_id)
      osh.order_id
    FROM public.order_status_history osh
    JOIN public.orders o ON o.id = osh.order_id
    WHERE osh.new_status = 'completed'
      AND o.branch_id = p_branch_id
      AND osh.created_at >= v_period_start
      AND osh.created_at < v_period_end
    ORDER BY osh.order_id, osh.created_at
  ),
  completed_orders AS (
    SELECT o.id, COALESCE(o.discount_in_minor_units, 0)::BIGINT AS order_discount
    FROM completion_events ce
    JOIN public.orders o ON o.id = ce.order_id
  ),
  item_basis AS (
    SELECT
      co.id AS order_id,
      co.order_discount,
      oi.id AS order_item_id,
      COALESCE(oi.product_name_snapshot, 'منتج') AS product_name,
      COALESCE(oi.sku_snapshot, '') AS sku,
      COALESCE(oi.sale_package_quantity, oi.quantity)::BIGINT AS package_quantity,
      COALESCE(oi.line_total_in_minor_units, 0)::BIGINT AS line_total,
      COALESCE(oi.cogs_in_minor_units, 0)::BIGINT AS cogs,
      SUM(COALESCE(oi.line_total_in_minor_units, 0)) OVER (
        PARTITION BY co.id
      )::BIGINT AS lines_subtotal,
      ROW_NUMBER() OVER (
        PARTITION BY co.id
        ORDER BY oi.created_at NULLS LAST, oi.id
      ) AS allocation_rank
    FROM completed_orders co
    JOIN public.order_items oi ON oi.order_id = co.id
  ),
  base_allocations AS (
    SELECT
      *,
      CASE
        WHEN order_discount > 0 AND lines_subtotal > 0 THEN
          (order_discount * line_total) / lines_subtotal
        ELSE 0
      END::BIGINT AS base_discount
    FROM item_basis
  ),
  discounted_items AS (
    SELECT
      *,
      (
        base_discount + CASE
          WHEN allocation_rank <= (
            order_discount - SUM(base_discount) OVER (PARTITION BY order_id)
          ) THEN 1
          ELSE 0
        END
      )::BIGINT AS allocated_discount
    FROM base_allocations
  ),
  item_totals AS (
    SELECT
      COALESCE(SUM(line_total - allocated_discount - cogs), 0)::BIGINT
        AS gross_profit,
      COALESCE(SUM(allocated_discount), 0)::BIGINT AS allocated_discounts
    FROM discounted_items
  ),
  top_products AS (
    SELECT COALESCE(jsonb_agg(product_payload ORDER BY revenue DESC, product_name), '[]'::JSONB)
      AS payload
    FROM (
      SELECT
        product_name,
        sku,
        SUM(package_quantity)::BIGINT AS package_count,
        SUM(line_total - allocated_discount)::BIGINT AS revenue,
        SUM(line_total - allocated_discount - cogs)::BIGINT AS profit,
        jsonb_build_object(
          'productName', product_name,
          'sku', sku,
          'packageCount', SUM(package_quantity),
          'revenueInMinorUnits', SUM(line_total - allocated_discount),
          'profitInMinorUnits', SUM(line_total - allocated_discount - cogs)
        ) AS product_payload
      FROM discounted_items
      GROUP BY product_name, sku
      ORDER BY revenue DESC, product_name
      LIMIT 10
    ) ranked_products
  )
  SELECT
    item_totals.gross_profit,
    item_totals.allocated_discounts,
    top_products.payload
  INTO v_discounted_gross_profit, v_discount_impact, v_top_products
  FROM item_totals
  CROSS JOIN top_products;

  WITH active_expenses AS (
    SELECT category, amount_in_minor_units, payment_method
    FROM public.operational_expenses
    WHERE branch_id = p_branch_id
      AND created_at >= v_period_start
      AND created_at < v_period_end
      AND COALESCE(is_reversed, false) = false
  ), totals AS (
    SELECT
      COUNT(*)::INTEGER AS expense_count,
      COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS total_expenses,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0)::BIGINT AS cash_expenses,
      COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)::BIGINT AS cliq_expenses
    FROM active_expenses
  ), categories AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'category', category,
        'count', expense_count,
        'amountInMinorUnits', amount
      ) ORDER BY amount DESC, category
    ), '[]'::JSONB) AS payload
    FROM (
      SELECT
        category,
        COUNT(*)::INTEGER AS expense_count,
        SUM(amount_in_minor_units)::BIGINT AS amount
      FROM active_expenses
      GROUP BY category
    ) grouped_categories
  )
  SELECT
    totals.expense_count,
    totals.total_expenses,
    totals.cash_expenses,
    totals.cliq_expenses,
    categories.payload
  INTO
    v_expense_count,
    v_active_expenses,
    v_active_cash_expenses,
    v_active_cliq_expenses,
    v_expense_categories
  FROM totals
  CROSS JOIN categories;

  -- A valid order has item totals covering its recorded discount. If legacy
  -- data is malformed, do not allow a report to invent a negative line value.
  IF v_discount_impact <> COALESCE(
    (v_report #>> '{sales,discountInMinorUnits}')::BIGINT,
    0
  ) THEN
    RAISE EXCEPTION
      'تعذر توزيع خصومات التقرير بدقة؛ راجع سلامة إجماليات أصناف الطلبات.';
  END IF;

  v_base_expenses := COALESCE(
    (v_report #>> '{expenses,totalInMinorUnits}')::BIGINT,
    0
  );
  v_report := jsonb_set(
    v_report,
    '{expenses}',
    jsonb_build_object(
      'count', v_expense_count,
      'totalInMinorUnits', v_active_expenses,
      'cashInMinorUnits', v_active_cash_expenses,
      'cliqInMinorUnits', v_active_cliq_expenses,
      'categories', v_expense_categories
    ),
    true
  );

  RETURN jsonb_set(
    jsonb_set(
      jsonb_set(
        v_report,
        '{sales,grossProfitInMinorUnits}',
        to_jsonb(v_discounted_gross_profit),
        true
      ),
      '{sales,netProfitInMinorUnits}',
      to_jsonb(
        COALESCE((v_report #>> '{sales,netProfitInMinorUnits}')::BIGINT, 0)
        - v_discount_impact
        + (v_base_expenses - v_active_expenses)
      ),
      true
    ),
    '{topProducts}',
    v_top_products,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_business_report(
  UUID, DATE, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report(
  UUID, DATE, DATE
) TO authenticated;

-- -------------------------------------------------------------------------
-- 2. Conservative WAC-safe supplier receipt cancellation
-- -------------------------------------------------------------------------
-- A rounded weighted-average cost cannot always be reversed exactly. Direct
-- cancellation is therefore allowed only while every received line is still
-- wholly present, unreserved, and has no later inventory movement. In all
-- other cases the original audit trail remains intact and a supplier return
-- is required instead of corrupting valuation history.
CREATE OR REPLACE FUNCTION public.cancel_supplier_receipt(
  p_supplier_receipt_id UUID,
  p_reason TEXT DEFAULT 'إلغاء سند استلام البضائع'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt public.supplier_receipts%ROWTYPE;
  v_item RECORD;
  v_on_hand BIGINT;
  v_reserved BIGINT;
  v_total_on_hand BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سندات الاستلام'
  );

  SELECT * INTO v_receipt
  FROM public.supplier_receipts
  WHERE id = p_supplier_receipt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'هذا السند ملغى أو معكوس مسبقاً.';
  END IF;

  FOR v_item IN
    SELECT sri.product_id, sri.total_base_units, p.name_ar AS product_name
    FROM public.supplier_receipt_items sri
    JOIN public.products p ON p.id = sri.product_id
    WHERE sri.supplier_receipt_id = p_supplier_receipt_id
    ORDER BY sri.product_id
  LOOP
    SELECT ib.on_hand_quantity, ib.reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances ib
    WHERE ib.warehouse_id = v_receipt.warehouse_id
      AND ib.product_id = v_item.product_id
    FOR UPDATE;

    IF COALESCE(v_on_hand, 0) <> v_item.total_base_units
      OR COALESCE(v_reserved, 0) <> 0
    THEN
      RAISE EXCEPTION
        'لا يمكن إلغاء سند الاستلام مباشرة للمنتج % لأن المخزون تحرك بعده أو أصبح محجوزاً. استخدم مرتجع المورد للحفاظ على متوسط التكلفة.',
        v_item.product_name;
    END IF;

    SELECT COALESCE(SUM(ib.on_hand_quantity), 0)
    INTO v_total_on_hand
    FROM public.inventory_balances ib
    WHERE ib.product_id = v_item.product_id;

    IF v_total_on_hand <> v_item.total_base_units THEN
      RAISE EXCEPTION
        'لا يمكن إلغاء سند الاستلام مباشرة للمنتج % لأن متوسط التكلفة يتضمن مخزوناً سابقاً أو لاحقاً. استخدم مرتجع المورد للحفاظ على متوسط التكلفة.',
        v_item.product_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements im
      WHERE im.product_id = v_item.product_id
        AND im.reference_id IS DISTINCT FROM p_supplier_receipt_id
        AND im.created_at >= v_receipt.received_at
    ) THEN
      RAISE EXCEPTION
        'لا يمكن إلغاء سند الاستلام مباشرة للمنتج % بعد وجود حركة مخزون لاحقة. استخدم مرتجع المورد للحفاظ على متوسط التكلفة.',
        v_item.product_name;
    END IF;
  END LOOP;

  RETURN public._cancel_supplier_receipt_impl(
    p_supplier_receipt_id,
    p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  TO authenticated;

-- -------------------------------------------------------------------------
-- 3. Idempotent customer receipts and audited reversals
-- -------------------------------------------------------------------------
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_created_by_idempotency
  ON public.customer_payments(created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_active_order
  ON public.customer_payments(order_id, is_reversed, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_customer_order_payment_once(
  p_order_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(TRIM(p_idempotency_key), '');
  v_existing public.customer_payments%ROWTYPE;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'تسجيل دفعة عميل'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة عميل.';
  END IF;
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'مفتاح تكرار الدفعة غير صالح.';
  END IF;

  -- Serialize just this user/key. A transport retry cannot create a second
  -- receipt even if it arrives while the first request is still committing.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_user_id::TEXT || ':' || v_key, 0)
  );

  SELECT * INTO v_existing
  FROM public.customer_payments
  WHERE created_by = v_user_id
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'payment_id', v_existing.id,
      'payment_number', v_existing.payment_number,
      'order_id', v_existing.order_id,
      'amount_in_minor_units', v_existing.amount_in_minor_units,
      'remaining_in_minor_units', GREATEST((
        SELECT total_in_minor_units - amount_paid_in_minor_units
        FROM public.orders WHERE id = v_existing.order_id
      ), 0)
    );
  END IF;

  v_result := public.record_customer_order_payment(
    p_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_notes
  );

  UPDATE public.customer_payments
  SET idempotency_key = v_key
  WHERE id = (v_result->>'payment_id')::UUID
    AND created_by = v_user_id
    AND idempotency_key IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت مفتاح منع تكرار الدفعة.';
  END IF;

  RETURN v_result || jsonb_build_object('idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_customer_order_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_payment public.customer_payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_new_paid BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عكس سند قبض عميل'
  );
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لعكس سند القبض.';
  END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) > 500 THEN
    RAISE EXCEPTION 'سبب عكس سند القبض مطلوب ولا يتجاوز 500 حرف.';
  END IF;

  SELECT * INTO v_payment
  FROM public.customer_payments
  WHERE id = p_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند القبض غير موجود.'; END IF;
  IF v_payment.is_reversed THEN
    RAISE EXCEPTION 'تم عكس سند القبض مسبقاً.';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_payment.order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'لا يمكن عكس الدفعة إلا لطلب مكتمل قائم.';
  END IF;

  IF v_payment.cash_shift_id IS NOT NULL THEN
    SELECT * INTO v_shift
    FROM public.cash_shifts
    WHERE id = v_payment.cash_shift_id
    FOR UPDATE;
    IF NOT FOUND OR v_shift.status <> 'open' THEN
      RAISE EXCEPTION 'لا يمكن عكس سند قبض مرتبط بوردية مغلقة؛ سجّل تسوية تدقيقية جديدة بدلاً من ذلك.';
    END IF;
  END IF;

  v_new_paid := GREATEST(
    v_order.amount_paid_in_minor_units - v_payment.amount_in_minor_units,
    0
  );
  UPDATE public.orders
  SET
    amount_paid_in_minor_units = v_new_paid,
    payment_status = CASE WHEN v_new_paid = 0 THEN 'unpaid' ELSE 'partially_paid' END,
    updated_at = NOW()
  WHERE id = v_order.id;

  UPDATE public.customer_payments
  SET
    is_reversed = true,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE id = v_payment.id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id,
    'REVERSE_CUSTOMER_PAYMENT',
    'customer_payments',
    v_payment.id,
    jsonb_build_object(
      'payment_number', v_payment.payment_number,
      'order_id', v_order.id,
      'original_amount_in_minor_units', v_payment.amount_in_minor_units,
      'payment_method', v_payment.payment_method,
      'reason', v_reason,
      'remaining_in_minor_units', v_order.total_in_minor_units - v_new_paid
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'order_id', v_order.id,
    'remaining_in_minor_units', v_order.total_in_minor_units - v_new_paid,
    'message', 'تم عكس سند القبض وحفظ أثره التدقيقي وتحديث ذمة العميل.'
  );
END;
$$;

-- The legacy RPC is retained for internal, transaction-safe settlement calls,
-- but browser clients must use the idempotent endpoint above.
REVOKE ALL ON FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_customer_order_payment_once(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_customer_order_payment(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment_once(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_customer_order_payment(UUID, TEXT)
  TO authenticated;

-- -------------------------------------------------------------------------
-- 4. Audited expense reversals and active-only operational totals
-- -------------------------------------------------------------------------
ALTER TABLE public.operational_expenses
  ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_operational_expenses_active_shift
  ON public.operational_expenses(shift_id, is_reversed, created_at DESC);

CREATE OR REPLACE FUNCTION public.reverse_operational_expense(
  p_expense_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense public.operational_expenses%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عكس مصروف تشغيلي'
  );
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول لعكس المصروف.'; END IF;
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) > 500 THEN
    RAISE EXCEPTION 'سبب عكس المصروف مطلوب ولا يتجاوز 500 حرف.';
  END IF;

  SELECT * INTO v_expense
  FROM public.operational_expenses
  WHERE id = p_expense_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المصروف غير موجود.'; END IF;
  IF v_expense.is_reversed THEN RAISE EXCEPTION 'تم عكس هذا المصروف مسبقاً.'; END IF;

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = v_expense.shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'لا يمكن عكس مصروف مرتبط بوردية مغلقة؛ سجّل تسوية تدقيقية جديدة بدلاً من ذلك.';
  END IF;

  UPDATE public.operational_expenses
  SET
    is_reversed = true,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversal_reason = v_reason
  WHERE id = v_expense.id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id,
    'REVERSE_OPERATIONAL_EXPENSE',
    'operational_expenses',
    v_expense.id,
    jsonb_build_object(
      'expense_number', v_expense.expense_number,
      'shift_id', v_expense.shift_id,
      'original_amount_in_minor_units', v_expense.amount_in_minor_units,
      'payment_method', v_expense.payment_method,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'expense_id', v_expense.id,
    'shift', public.get_cash_shift_summary(v_expense.shift_id),
    'message', 'تم عكس المصروف مع الاحتفاظ بسجل المراجعة.'
  );
END;
$$;

-- Preserve the current center and attach reversal metadata without changing
-- existing dashboard/shift payloads.
DO $$
BEGIN
  IF to_regprocedure('public._get_expense_shift_center_v1(uuid,integer)') IS NULL THEN
    ALTER FUNCTION public.get_expense_shift_center(UUID, INTEGER)
      RENAME TO _get_expense_shift_center_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_expense_shift_center_v1(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_expense_shift_center(
  p_branch_id UUID,
  p_expense_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_expenses JSONB;
BEGIN
  v_result := public._get_expense_shift_center_v1(p_branch_id, p_expense_limit);

  SELECT COALESCE(jsonb_agg(expense_payload ORDER BY created_at DESC), '[]'::JSONB)
  INTO v_expenses
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
        'isReversed', oe.is_reversed,
        'reversedAt', oe.reversed_at,
        'reversalReason', oe.reversal_reason,
        'reversedByName', COALESCE(reversed_profile.full_name, ''),
        'createdByName', COALESCE(created_profile.full_name, 'مستخدم النظام'),
        'createdAt', oe.created_at
      ) AS expense_payload
    FROM public.operational_expenses oe
    LEFT JOIN public.profiles created_profile ON created_profile.id = oe.created_by
    LEFT JOIN public.profiles reversed_profile ON reversed_profile.id = oe.reversed_by
    WHERE oe.branch_id = p_branch_id
    ORDER BY oe.created_at DESC
    LIMIT p_expense_limit
  ) expense_rows;

  RETURN jsonb_set(v_result, '{expenses}', v_expenses, true);
END;
$$;

REVOKE ALL ON FUNCTION public.get_expense_shift_center(UUID, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_shift_center(UUID, INTEGER)
  TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_operational_expense(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_operational_expense(UUID, TEXT)
  TO authenticated;

-- -------------------------------------------------------------------------
-- 5. Current open-shift summaries must ignore reversed receipts/expenses.
-- Closed shifts are immutable because reversals are blocked after close.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public._get_cash_shift_summary_v1(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_cash_shift_summary(UUID)
      RENAME TO _get_cash_shift_summary_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_cash_shift_summary_v1(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_shift_summary(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_summary JSONB;
  v_shift_status TEXT;
  v_reversed_cash_receipts BIGINT := 0;
  v_reversed_cliq_receipts BIGINT := 0;
  v_reversed_cash_expenses BIGINT := 0;
  v_reversed_cliq_expenses BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض ملخص الوردية'
  );

  SELECT status INTO v_shift_status
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;

  v_summary := public._get_cash_shift_summary_v1(p_shift_id);
  IF v_shift_status <> 'open' THEN RETURN v_summary; END IF;

  SELECT
    COALESCE(SUM(cp.amount_in_minor_units) FILTER (WHERE cp.payment_method = 'cash'), 0),
    COALESCE(SUM(cp.amount_in_minor_units) FILTER (WHERE cp.payment_method = 'cliq'), 0)
  INTO v_reversed_cash_receipts, v_reversed_cliq_receipts
  FROM public.customer_payments cp
  JOIN public.orders o ON o.id = cp.order_id
  WHERE cp.cash_shift_id = p_shift_id
    AND o.payment_method = 'debt'
    AND cp.is_reversed = true;

  SELECT
    COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0),
    COALESCE(SUM(amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)
  INTO v_reversed_cash_expenses, v_reversed_cliq_expenses
  FROM public.operational_expenses
  WHERE shift_id = p_shift_id
    AND is_reversed = true;

  v_summary := jsonb_set(
    v_summary,
    '{cashReceiptsInMinorUnits}',
    to_jsonb(GREATEST(COALESCE((v_summary->>'cashReceiptsInMinorUnits')::BIGINT, 0) - v_reversed_cash_receipts, 0)),
    true
  );
  v_summary := jsonb_set(
    v_summary,
    '{cliqReceiptsInMinorUnits}',
    to_jsonb(GREATEST(COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0) - v_reversed_cliq_receipts, 0)),
    true
  );
  v_summary := jsonb_set(
    v_summary,
    '{cashExpensesInMinorUnits}',
    to_jsonb(GREATEST(COALESCE((v_summary->>'cashExpensesInMinorUnits')::BIGINT, 0) - v_reversed_cash_expenses, 0)),
    true
  );
  v_summary := jsonb_set(
    v_summary,
    '{cliqExpensesInMinorUnits}',
    to_jsonb(GREATEST(COALESCE((v_summary->>'cliqExpensesInMinorUnits')::BIGINT, 0) - v_reversed_cliq_expenses, 0)),
    true
  );
  RETURN jsonb_set(
    v_summary,
    '{expectedCashInMinorUnits}',
    to_jsonb(
      COALESCE((v_summary->>'expectedCashInMinorUnits')::BIGINT, 0)
      + v_reversed_cash_expenses
      - v_reversed_cash_receipts
    ),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID)
  TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public._get_cash_shift_closing_report_v1(uuid)') IS NULL THEN
    ALTER FUNCTION public.get_cash_shift_closing_report(UUID)
      RENAME TO _get_cash_shift_closing_report_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_v1(UUID)
  FROM PUBLIC, anon, authenticated;

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
  v_report JSONB;
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_reversed_receipt_count INTEGER := 0;
  v_reversed_expense_count INTEGER := 0;
  v_expense_breakdown JSONB := '[]'::JSONB;
  v_gross_sales BIGINT := 0;
  v_total_refunds BIGINT := 0;
  v_total_inflows BIGINT := 0;
  v_total_outflows BIGINT := 0;
  v_net_cliq BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض تقرير إغلاق الوردية'
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.'; END IF;

  v_report := public._get_cash_shift_closing_report_v1(p_shift_id);
  IF v_shift.status <> 'open' THEN RETURN v_report; END IF;

  v_summary := public.get_cash_shift_summary(p_shift_id);
  SELECT COUNT(*)::INTEGER INTO v_reversed_receipt_count
  FROM public.customer_payments cp
  JOIN public.orders o ON o.id = cp.order_id
  WHERE cp.cash_shift_id = p_shift_id
    AND o.payment_method = 'debt'
    AND cp.is_reversed = true;

  SELECT COUNT(*)::INTEGER INTO v_reversed_expense_count
  FROM public.operational_expenses
  WHERE shift_id = p_shift_id
    AND is_reversed = true;

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
    WHERE shift_id = p_shift_id
      AND is_reversed = false
    GROUP BY category
  ) active_expense_groups;

  v_gross_sales := COALESCE((v_report #>> '{sales,grossSalesInMinorUnits}')::BIGINT, 0);
  v_total_refunds := COALESCE((v_report #>> '{sales,refundsInMinorUnits}')::BIGINT, 0);
  v_total_inflows := v_gross_sales
    + COALESCE((v_summary->>'cashReceiptsInMinorUnits')::BIGINT, 0)
    + COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0);
  v_total_outflows :=
    COALESCE((v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT, 0)
    + COALESCE((v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT, 0)
    + COALESCE((v_summary->>'cashExpensesInMinorUnits')::BIGINT, 0)
    + COALESCE((v_summary->>'cliqExpensesInMinorUnits')::BIGINT, 0)
    + v_total_refunds;
  v_net_cliq :=
    COALESCE((v_summary->>'cliqSalesInMinorUnits')::BIGINT, 0)
    + COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0)
    - COALESCE((v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT, 0)
    - COALESCE((v_summary->>'cliqExpensesInMinorUnits')::BIGINT, 0)
    - COALESCE((v_summary->>'cliqRefundsInMinorUnits')::BIGINT, 0);

  v_report := jsonb_set(v_report, '{shift}', v_summary, true);
  v_report := jsonb_set(
    v_report,
    '{collections}',
    jsonb_build_object(
      'count', GREATEST(COALESCE((v_report #>> '{collections,count}')::INTEGER, 0) - v_reversed_receipt_count, 0),
      'cashInMinorUnits', COALESCE((v_summary->>'cashReceiptsInMinorUnits')::BIGINT, 0),
      'cliqInMinorUnits', COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0)
    ),
    true
  );
  v_report := jsonb_set(
    v_report,
    '{outflows}',
    jsonb_build_object(
      'supplierPaymentCount', COALESCE((v_report #>> '{outflows,supplierPaymentCount}')::INTEGER, 0),
      'cashSupplierPaymentsInMinorUnits', COALESCE((v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT, 0),
      'cliqSupplierPaymentsInMinorUnits', COALESCE((v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT, 0),
      'expenseCount', GREATEST(COALESCE((v_report #>> '{outflows,expenseCount}')::INTEGER, 0) - v_reversed_expense_count, 0),
      'cashExpensesInMinorUnits', COALESCE((v_summary->>'cashExpensesInMinorUnits')::BIGINT, 0),
      'cliqExpensesInMinorUnits', COALESCE((v_summary->>'cliqExpensesInMinorUnits')::BIGINT, 0),
      'returnCount', COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0),
      'cashRefundsInMinorUnits', COALESCE((v_summary->>'cashRefundsInMinorUnits')::BIGINT, 0),
      'cliqRefundsInMinorUnits', COALESCE((v_summary->>'cliqRefundsInMinorUnits')::BIGINT, 0)
    ),
    true
  );
  v_report := jsonb_set(v_report, '{expenseBreakdown}', v_expense_breakdown, true);
  RETURN jsonb_set(
    v_report,
    '{reconciliation}',
    jsonb_build_object(
      'totalInflowsInMinorUnits', v_total_inflows,
      'totalOutflowsInMinorUnits', v_total_outflows,
      'netMovementInMinorUnits', v_total_inflows - v_total_outflows,
      'netCliqMovementInMinorUnits', v_net_cliq,
      'openingCashInMinorUnits', COALESCE((v_summary->>'openingCashInMinorUnits')::BIGINT, 0),
      'expectedCashInMinorUnits', COALESCE((v_summary->>'expectedCashInMinorUnits')::BIGINT, 0),
      'actualCashInMinorUnits', CASE WHEN v_summary ? 'actualCashInMinorUnits' THEN v_summary->'actualCashInMinorUnits' ELSE 'null'::JSONB END,
      'cashDiscrepancyInMinorUnits', CASE WHEN v_summary ? 'cashDiscrepancyInMinorUnits' THEN v_summary->'cashDiscrepancyInMinorUnits' ELSE 'null'::JSONB END,
      'isBalanced', NULL
    ),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_closing_report(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_closing_report(UUID)
  TO authenticated;

COMMIT;
