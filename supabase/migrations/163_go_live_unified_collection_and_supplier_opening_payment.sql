BEGIN;

-- Owner decisions 2026-10-15:
-- (1, unified) «تحصيل من الزبون»: one lump sum from a customer, allocated
--   oldest-first — opening debts by original date, then open orders by age —
--   with a read-only preview. Order parts go through the EXISTING
--   record_customer_order_payment_once path (no parallel order logic). One
--   transaction, all or nothing, idempotent, never above the total debt.
--   Cash enters the open shift drawer; CliQ is recorded on the shift outside
--   the drawer; bank transfer has no shift. Reversal reverses the WHOLE
--   operation through the existing payment reversal for its order parts.
-- (2) Supplier opening balance paid in cash/CliQ from the chosen branch's open
--   shift, recorded as a supplier payment and a shift cash outflow; stays
--   consistent with the 133 supplier evidence and its monitor.
-- Shift integration is one explicit get_cash_shift_summary definition: the
-- closing columns, closing report and immutable snapshot all read it.

-- ---------------------------------------------------------------------------
-- Unified customer collection
-- ---------------------------------------------------------------------------

-- Plan only; locks nothing. Opening entries by original date, then open
-- orders of the canonical receivable set (121) by creation, oldest first.
CREATE FUNCTION public.go_live_plan_customer_collection_internal(p_customer_id UUID, p_amount BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH debts AS (
    SELECT 1 AS kind_order, 'opening'::TEXT AS kind, o.id, o.entry_number AS reference,
      o.occurred_at AS debt_at, o.outstanding
    FROM public.go_live_customer_opening_positions_internal(p_customer_id) o
    WHERE o.outstanding > 0
    UNION ALL
    SELECT 2, 'order', customer_order.id, customer_order.order_number,
      customer_order.created_at, position.outstanding_total_in_minor_units
    FROM public.orders customer_order
    CROSS JOIN LATERAL public.phase42_order_financial_position_internal(customer_order.id) position
    WHERE customer_order.customer_id = p_customer_id
      AND customer_order.status IN ('completed', 'delivered')
      AND (COALESCE(customer_order.source, 'website') <> 'pos' OR customer_order.payment_method = 'debt')
      AND position.outstanding_total_in_minor_units > 0
  ), ordered AS (
    SELECT d.*, COALESCE(SUM(outstanding) OVER (ORDER BY kind_order, debt_at, reference, id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_amount
    FROM debts d
  ), allocated AS (
    SELECT o.*, GREATEST(LEAST(o.outstanding, COALESCE(p_amount, 0) - o.before_amount), 0)::BIGINT AS allocate
    FROM ordered o
  )
  SELECT jsonb_build_object(
    'openingOutstandingInMinorUnits', COALESCE(SUM(outstanding) FILTER (WHERE kind = 'opening'), 0),
    'ordersOutstandingInMinorUnits', COALESCE(SUM(outstanding) FILTER (WHERE kind = 'order'), 0),
    'totalOutstandingInMinorUnits', COALESCE(SUM(outstanding), 0),
    'openingAllocatedInMinorUnits', COALESCE(SUM(allocate) FILTER (WHERE kind = 'opening'), 0),
    'ordersAllocatedInMinorUnits', COALESCE(SUM(allocate) FILTER (WHERE kind = 'order'), 0),
    'parts', COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'reference', reference,
      'debtAt', debt_at, 'outstandingInMinorUnits', outstanding, 'allocateInMinorUnits', allocate,
      'remainingAfterInMinorUnits', outstanding - allocate)
      ORDER BY kind_order, debt_at, reference, id), '[]'::JSONB))
  FROM allocated;
$$;
ALTER FUNCTION public.go_live_plan_customer_collection_internal(UUID, BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_plan_customer_collection_internal(UUID, BIGINT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.preview_customer_collection_v1(p_customer_id UUID, p_amount_in_minor_units BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'معاينة تحصيل من الزبون');
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;
  v_plan := public.go_live_plan_customer_collection_internal(p_customer_id, p_amount_in_minor_units);
  RETURN v_plan || jsonb_build_object('success', true, 'customerId', p_customer_id,
    'amountInMinorUnits', p_amount_in_minor_units,
    'exceedsBalance', COALESCE(p_amount_in_minor_units, 0) > (v_plan->>'totalOutstandingInMinorUnits')::BIGINT,
    'canonicalBalanceInMinorUnits', public.phase42_customer_receivable_total_internal(p_customer_id));
END;
$$;
ALTER FUNCTION public.preview_customer_collection_v1(UUID, BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_customer_collection_v1(UUID, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_customer_collection_v1(UUID, BIGINT) TO authenticated;

CREATE FUNCTION public.collect_customer_balance_v1(
  p_customer_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_branch_id UUID,
  p_reference_number TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_existing public.customer_collection_operations%ROWTYPE;
  v_operation public.customer_collection_operations%ROWTYPE;
  v_plan JSONB;
  v_part JSONB;
  v_opening BIGINT;
  v_orders BIGINT;
  v_shift_id UUID;
  v_payment JSONB;
  v_notes TEXT := NULLIF(BTRIM(p_notes), '');
  v_reference TEXT := NULLIF(BTRIM(p_reference_number), '');
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'تحصيل من الزبون');
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار التحصيل غير صالح.';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'cliq', 'bank_transfer') THEN
    RAISE EXCEPTION 'طريقة الدفع يجب أن تكون كاش أو CliQ أو تحويلاً بنكياً.';
  END IF;
  IF COALESCE(p_amount_in_minor_units, 0) <= 0 OR p_amount_in_minor_units > 999999999999 THEN
    RAISE EXCEPTION 'مبلغ التحصيل يجب أن يكون أكبر من صفر.';
  END IF;
  IF v_notes IS NOT NULL AND CHAR_LENGTH(v_notes) > 300 THEN
    RAISE EXCEPTION 'الملاحظة أطول من 300 حرف.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection:' || v_key, 0));
  SELECT * INTO v_existing FROM public.customer_collection_operations WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.customer_id IS DISTINCT FROM p_customer_id
      OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'GO_LIVE_COLLECTION_KEY_CONFLICT: مفتاح التحصيل استُخدم لعملية مختلفة.';
    END IF;
    RETURN public.go_live_collection_result_internal(v_existing.id) || jsonb_build_object('idempotentReplay', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND NOT is_deleted) THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;
  -- One collector per customer at a time; opening rows locked oldest-first.
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:' || p_customer_id::TEXT, 0));
  PERFORM 1 FROM public.customer_opening_balances
  WHERE customer_id = p_customer_id AND NOT is_reversed
  ORDER BY occurred_at, entry_number FOR UPDATE;

  v_plan := public.go_live_plan_customer_collection_internal(p_customer_id, p_amount_in_minor_units);
  IF p_amount_in_minor_units > (v_plan->>'totalOutstandingInMinorUnits')::BIGINT THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_COLLECTION_EXCEEDS_BALANCE: المبلغ أكبر من مجموع دين العميل ('
        || ((v_plan->>'totalOutstandingInMinorUnits')::NUMERIC / 1000)::TEXT || ' د.أ).';
  END IF;
  v_opening := (v_plan->>'openingAllocatedInMinorUnits')::BIGINT;
  v_orders := (v_plan->>'ordersAllocatedInMinorUnits')::BIGINT;

  IF v_opening > 0 AND p_payment_method IN ('cash', 'cliq') THEN
    IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
      RAISE EXCEPTION 'حدد فرع الوردية لتحصيل الدين القديم كاش أو CliQ.';
    END IF;
    SELECT id INTO v_shift_id FROM public.cash_shifts
    WHERE branch_id = p_branch_id AND status = 'open' FOR SHARE;
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'افتح وردية الصندوق أولًا قبل تسجيل سند قبض كاش أو CliQ.';
    END IF;
  END IF;

  INSERT INTO public.customer_collection_operations(operation_number, customer_id, amount_in_minor_units,
    opening_amount_in_minor_units, orders_amount_in_minor_units, payment_method, reference_number, notes,
    branch_id, cash_shift_id, idempotency_key, created_by)
  VALUES ('COL-' || LPAD(nextval('public.customer_collection_operation_number_seq')::TEXT, 6, '0'),
    p_customer_id, p_amount_in_minor_units, v_opening, v_orders, p_payment_method, v_reference, v_notes,
    CASE WHEN v_shift_id IS NULL THEN NULL ELSE p_branch_id END, v_shift_id, v_key, v_user_id)
  RETURNING * INTO v_operation;

  FOR v_part IN SELECT value FROM jsonb_array_elements(v_plan->'parts')
    WHERE (value->>'allocateInMinorUnits')::BIGINT > 0
  LOOP
    IF v_part->>'kind' = 'opening' THEN
      INSERT INTO public.customer_collection_opening_allocations(operation_id, opening_balance_id, amount_in_minor_units)
      VALUES (v_operation.id, (v_part->>'id')::UUID, (v_part->>'allocateInMinorUnits')::BIGINT);
    ELSE
      -- Existing order payment contract: its own role, lock, outstanding cap,
      -- shift attachment and audit. Any refusal aborts the whole operation.
      v_payment := public.record_customer_order_payment_once(
        (v_part->>'id')::UUID, (v_part->>'allocateInMinorUnits')::BIGINT, p_payment_method,
        v_reference, COALESCE(v_notes || ' — ', '') || 'تحصيل موحد ' || v_operation.operation_number,
        'golive-col-' || md5(v_key || ':' || (v_part->>'id')));
      INSERT INTO public.customer_collection_order_payments(operation_id, customer_payment_id, order_id, amount_in_minor_units)
      VALUES (v_operation.id, (v_payment->>'payment_id')::UUID, (v_part->>'id')::UUID,
        (v_part->>'allocateInMinorUnits')::BIGINT);
    END IF;
  END LOOP;

  v_result := public.go_live_collection_result_internal(v_operation.id);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'CUSTOMER_UNIFIED_COLLECTION', 'customer_collection_operations', v_operation.id,
    jsonb_build_object('operation_number', v_operation.operation_number, 'customer_id', p_customer_id,
      'amount_in_minor_units', p_amount_in_minor_units, 'payment_method', p_payment_method,
      'opening_amount_in_minor_units', v_opening, 'orders_amount_in_minor_units', v_orders,
      'cash_shift_id', v_shift_id, 'parts', v_result->'parts'));
  RETURN v_result || jsonb_build_object('idempotentReplay', false);
END;
$$;

CREATE FUNCTION public.go_live_collection_result_internal(p_operation_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('success', true, 'operationId', op.id, 'operationNumber', op.operation_number,
    'customerId', op.customer_id, 'amountInMinorUnits', op.amount_in_minor_units,
    'openingAmountInMinorUnits', op.opening_amount_in_minor_units,
    'ordersAmountInMinorUnits', op.orders_amount_in_minor_units, 'paymentMethod', op.payment_method,
    'isReversed', op.is_reversed, 'createdAt', op.created_at,
    'parts', COALESCE((
      SELECT jsonb_agg(part ORDER BY sort_key) FROM (
        SELECT 1 AS sort_key_kind, b.occurred_at::TEXT || b.entry_number AS sort_key,
          jsonb_build_object('kind', 'opening', 'id', b.id, 'reference', b.entry_number,
            'amountInMinorUnits', a.amount_in_minor_units) AS part
        FROM public.customer_collection_opening_allocations a
        JOIN public.customer_opening_balances b ON b.id = a.opening_balance_id
        WHERE a.operation_id = op.id
        UNION ALL
        SELECT 2, '~' || o.created_at::TEXT || o.order_number,
          jsonb_build_object('kind', 'order', 'id', o.id, 'reference', o.order_number,
            'paymentId', l.customer_payment_id, 'amountInMinorUnits', l.amount_in_minor_units)
        FROM public.customer_collection_order_payments l
        JOIN public.orders o ON o.id = l.order_id
        WHERE l.operation_id = op.id
      ) parts), '[]'::JSONB),
    'remainingBalanceInMinorUnits', public.phase42_customer_receivable_total_internal(op.customer_id))
  FROM public.customer_collection_operations op WHERE op.id = p_operation_id;
$$;
ALTER FUNCTION public.go_live_collection_result_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_collection_result_internal(UUID) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.collect_customer_balance_v1(UUID, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.collect_customer_balance_v1(UUID, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_customer_balance_v1(UUID, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- A payment that belongs to a unified collection can only be reversed by
-- reversing that whole operation (reverse_customer_collection_v1 sets the
-- transaction-local marker for exactly its own operation).
CREATE FUNCTION public.go_live_guard_collection_payment_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id UUID;
BEGIN
  IF NEW.is_reversed AND NOT COALESCE(OLD.is_reversed, false) THEN
    SELECT operation_id INTO v_operation_id
    FROM public.customer_collection_order_payments WHERE customer_payment_id = NEW.id;
    IF v_operation_id IS NOT NULL
      AND COALESCE(current_setting('nawasrah.collection_reversal', true), '') <> v_operation_id::TEXT THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'GO_LIVE_COLLECTION_PART_REVERSAL: هذا السند جزء من عملية تحصيل موحدة؛ اعكس العملية كاملة.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_collection_payment_reversal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_collection_payment_reversal() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_customer_payments_collection_reversal_guard
BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.go_live_guard_collection_payment_reversal();

-- Whole-operation reversal: same roles and closed-shift rule as the existing
-- customer payment reversal, which it calls for every order part.
CREATE FUNCTION public.reverse_customer_collection_v1(p_operation_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_operation public.customer_collection_operations%ROWTYPE;
  v_payment_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant'], 'عكس عملية تحصيل');
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'اكتب سبب العكس (5 إلى 500 حرف).';
  END IF;
  SELECT * INTO v_operation FROM public.customer_collection_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'عملية التحصيل غير موجودة.';
  END IF;
  IF v_operation.is_reversed THEN
    RETURN public.go_live_collection_result_internal(v_operation.id) || jsonb_build_object('idempotentReplay', true);
  END IF;
  IF v_operation.cash_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cash_shifts WHERE id = v_operation.cash_shift_id AND status = 'open' FOR UPDATE) THEN
    RAISE EXCEPTION 'لا يمكن عكس سند قبض مرتبط بوردية مغلقة؛ سجّل تسوية تدقيقية جديدة بدلاً من ذلك.';
  END IF;
  PERFORM set_config('nawasrah.collection_reversal', v_operation.id::TEXT, true);
  FOR v_payment_id IN SELECT customer_payment_id FROM public.customer_collection_order_payments
    WHERE operation_id = v_operation.id ORDER BY customer_payment_id
  LOOP
    PERFORM public.reverse_customer_order_payment(v_payment_id,
      'عكس عملية تحصيل ' || v_operation.operation_number || ': ' || v_reason);
  END LOOP;
  PERFORM set_config('nawasrah.collection_reversal', '', true);
  UPDATE public.customer_collection_operations
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id, reversal_reason = v_reason
  WHERE id = v_operation.id RETURNING * INTO v_operation;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'CUSTOMER_UNIFIED_COLLECTION_REVERSED', 'customer_collection_operations', v_operation.id,
    jsonb_build_object('operation_number', v_operation.operation_number, 'customer_id', v_operation.customer_id,
      'amount_in_minor_units', v_operation.amount_in_minor_units, 'reason', v_reason));
  RETURN public.go_live_collection_result_internal(v_operation.id) || jsonb_build_object('idempotentReplay', false);
END;
$$;
ALTER FUNCTION public.reverse_customer_collection_v1(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_customer_collection_v1(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_customer_collection_v1(UUID, TEXT) TO authenticated;

CREATE FUNCTION public.get_customer_collections_v1(p_customer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'], 'عرض عمليات التحصيل');
  RETURN jsonb_build_object('success', true, 'customerId', p_customer_id,
    'operations', COALESCE((SELECT jsonb_agg(public.go_live_collection_result_internal(id)
      ORDER BY created_at DESC, operation_number DESC)
      FROM (SELECT id, created_at, operation_number FROM public.customer_collection_operations
        WHERE customer_id = p_customer_id ORDER BY created_at DESC, operation_number DESC LIMIT 50) recent), '[]'::JSONB));
END;
$$;
ALTER FUNCTION public.get_customer_collections_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_collections_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_collections_v1(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Supplier opening balance payment (cash/CliQ from a chosen branch's shift)
-- ---------------------------------------------------------------------------
CREATE TABLE public.supplier_opening_payments (
  supplier_payment_id UUID PRIMARY KEY REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_shift_id UUID REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'cliq', 'bank_transfer', 'cheque')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (CHAR_LENGTH(idempotency_key) BETWEEN 16 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT supplier_opening_payments_shift_rule CHECK (
    (payment_method IN ('cash', 'cliq')) = (cash_shift_id IS NOT NULL AND branch_id IS NOT NULL))
);
CREATE INDEX idx_supplier_opening_payments_shift
  ON public.supplier_opening_payments(cash_shift_id) WHERE cash_shift_id IS NOT NULL;
CREATE INDEX idx_supplier_opening_payments_supplier ON public.supplier_opening_payments(supplier_id);
ALTER TABLE public.supplier_opening_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_opening_payments FROM PUBLIC, anon, authenticated;
ALTER TABLE public.supplier_opening_payments OWNER TO postgres;
CREATE TRIGGER trg_supplier_opening_payments_immutable
BEFORE UPDATE OR DELETE ON public.supplier_opening_payments
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_collection_mutation();
CREATE TRIGGER trg_supplier_opening_payments_no_truncate
BEFORE TRUNCATE ON public.supplier_opening_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.go_live_reject_truncate();

-- Remaining opening payable = active "له" opening entries minus active payments
-- made through this path, never above the supplier's current balance.
CREATE FUNCTION public.go_live_supplier_opening_payable_internal(p_supplier_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(LEAST(
    COALESCE((SELECT SUM(amount_in_minor_units) FROM public.supplier_opening_balances
      WHERE supplier_id = p_supplier_id AND direction = 'payable' AND NOT is_reversed), 0)
    - COALESCE((SELECT SUM(p.amount_in_minor_units) FROM public.supplier_opening_payments l
      JOIN public.supplier_payments p ON p.id = l.supplier_payment_id
      WHERE l.supplier_id = p_supplier_id AND NOT COALESCE(p.is_reversed, false)), 0),
    COALESCE((SELECT current_balance_in_minor_units FROM public.suppliers WHERE id = p_supplier_id), 0)
  ), 0)::BIGINT;
$$;
ALTER FUNCTION public.go_live_supplier_opening_payable_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_supplier_opening_payable_internal(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_supplier_opening_payable_v1(p_supplier_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant'], 'عرض رصيد المورد الافتتاحي');
  RETURN jsonb_build_object('success', true, 'supplierId', p_supplier_id,
    'remainingOpeningPayableInMinorUnits', public.go_live_supplier_opening_payable_internal(p_supplier_id),
    'currentBalanceInMinorUnits', (SELECT current_balance_in_minor_units FROM public.suppliers WHERE id = p_supplier_id));
END;
$$;
ALTER FUNCTION public.get_supplier_opening_payable_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_supplier_opening_payable_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supplier_opening_payable_v1(UUID) TO authenticated;

CREATE FUNCTION public.pay_supplier_opening_balance_v1(
  p_supplier_id UUID,
  p_branch_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_existing public.supplier_opening_payments%ROWTYPE;
  v_payment public.supplier_payments%ROWTYPE;
  v_shift_id UUID;
  v_remaining BIGINT;
BEGIN
  -- Same roles as the existing supplier payment RPC.
  PERFORM public.assert_erp_role(ARRAY['owner', 'admin', 'manager', 'accountant'], 'سداد رصيد مورد افتتاحي');
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'مفتاح منع تكرار دفعة المورد غير صالح.';
  END IF;
  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'cliq', 'bank_transfer', 'cheque') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صالحة.';
  END IF;
  IF COALESCE(p_amount_in_minor_units, 0) <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-supplier-opening-payment:' || v_key, 0));
  SELECT * INTO v_existing FROM public.supplier_opening_payments WHERE idempotency_key = v_key;
  IF FOUND THEN
    SELECT * INTO STRICT v_payment FROM public.supplier_payments WHERE id = v_existing.supplier_payment_id;
    IF v_payment.supplier_id IS DISTINCT FROM p_supplier_id
      OR v_payment.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_payment.payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_IDEMPOTENCY_CONFLICT: استُخدم مفتاح الدفعة لطلب مختلف.';
    END IF;
    RETURN jsonb_build_object('success', true, 'idempotentReplay', true, 'paymentId', v_payment.id,
      'cashShiftId', v_payment.cash_shift_id,
      'remainingOpeningPayableInMinorUnits', public.go_live_supplier_opening_payable_internal(p_supplier_id));
  END IF;

  IF p_payment_method IN ('cash', 'cliq') THEN
    IF p_branch_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE2_PAYMENT_BRANCH_REQUIRED: اختر فرع الوردية التي يخرج منها المبلغ.';
    END IF;
    SELECT id INTO v_shift_id FROM public.cash_shifts
    WHERE branch_id = p_branch_id AND status = 'open' FOR SHARE;
    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'PHASE2_OPEN_SHIFT_REQUIRED: افتح وردية الصندوق قبل تسجيل دفعة المورد.';
    END IF;
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = p_supplier_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود أو غير نشط.';
  END IF;
  v_remaining := public.go_live_supplier_opening_payable_internal(p_supplier_id);
  IF p_amount_in_minor_units > v_remaining THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_SUPPLIER_PAYMENT_EXCEEDS_OPENING: المبلغ أكبر من المتبقي من الرصيد الافتتاحي للمورد ('
        || (v_remaining::NUMERIC / 1000)::TEXT || ' د.أ).';
  END IF;

  INSERT INTO public.supplier_payments(supplier_id, purchase_order_id, amount_in_minor_units, payment_method,
    reference_number, payment_date, notes, created_by, cash_shift_id)
  VALUES (p_supplier_id, NULL, p_amount_in_minor_units, p_payment_method,
    NULLIF(BTRIM(p_reference_number), ''), NOW(),
    COALESCE(NULLIF(BTRIM(p_notes), '') || ' — ', '') || 'سداد رصيد سابق قبل النظام', v_user_id, v_shift_id)
  RETURNING * INTO v_payment;
  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units - p_amount_in_minor_units, updated_at = NOW()
  WHERE id = p_supplier_id;
  INSERT INTO public.supplier_opening_payments(supplier_payment_id, supplier_id, branch_id, cash_shift_id,
    payment_method, idempotency_key)
  VALUES (v_payment.id, p_supplier_id, CASE WHEN v_shift_id IS NULL THEN NULL ELSE p_branch_id END,
    v_shift_id, p_payment_method, v_key);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_SUPPLIER_OPENING_PAYMENT', 'supplier_payments', v_payment.id,
    jsonb_build_object('supplier_id', p_supplier_id, 'amount_in_minor_units', p_amount_in_minor_units,
      'payment_method', p_payment_method, 'branch_id', p_branch_id, 'cash_shift_id', v_shift_id));
  RETURN jsonb_build_object('success', true, 'idempotentReplay', false, 'paymentId', v_payment.id,
    'cashShiftId', v_shift_id,
    'remainingOpeningPayableInMinorUnits', public.go_live_supplier_opening_payable_internal(p_supplier_id));
END;
$$;
ALTER FUNCTION public.pay_supplier_opening_balance_v1(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pay_supplier_opening_balance_v1(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_supplier_opening_balance_v1(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Shift: complete explicit get_cash_shift_summary. Same chain and refund
-- handling as 128; for an OPEN shift it also adds the opening part of active
-- unified collections attached to this shift (cash into the drawer, CliQ
-- outside it) and active supplier opening payments made from this shift
-- (cash out of the drawer). Order parts are customer_payments and are
-- already counted by the base summary. Closed shifts return frozen columns.
-- ---------------------------------------------------------------------------
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
  v_cash_refunds BIGINT := 0;
  v_cliq_refunds BIGINT := 0;
  v_cash_opening_receipts BIGINT := 0;
  v_cliq_opening_receipts BIGINT := 0;
  v_cash_opening_supplier BIGINT := 0;
  v_cliq_opening_supplier BIGINT := 0;
BEGIN
  v_summary := public._get_cash_shift_summary_before_return_events(p_shift_id);

  SELECT status INTO v_shift_status
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF v_shift_status IS DISTINCT FROM 'open' THEN RETURN v_summary; END IF;

  SELECT
    COALESCE(SUM(money_refund_amount_in_minor_units) FILTER (WHERE refund_method = 'cash'), 0),
    COALESCE(SUM(money_refund_amount_in_minor_units) FILTER (WHERE refund_method = 'cliq'), 0)
  INTO v_cash_refunds, v_cliq_refunds
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0;

  SELECT
    COALESCE(SUM(opening_amount_in_minor_units) FILTER (WHERE payment_method = 'cash'), 0),
    COALESCE(SUM(opening_amount_in_minor_units) FILTER (WHERE payment_method = 'cliq'), 0)
  INTO v_cash_opening_receipts, v_cliq_opening_receipts
  FROM public.customer_collection_operations
  WHERE cash_shift_id = p_shift_id AND NOT is_reversed;

  SELECT
    COALESCE(SUM(payment.amount_in_minor_units) FILTER (WHERE payment.payment_method = 'cash'), 0),
    COALESCE(SUM(payment.amount_in_minor_units) FILTER (WHERE payment.payment_method = 'cliq'), 0)
  INTO v_cash_opening_supplier, v_cliq_opening_supplier
  FROM public.supplier_opening_payments link
  JOIN public.supplier_payments payment ON payment.id = link.supplier_payment_id
  WHERE link.cash_shift_id = p_shift_id AND NOT COALESCE(payment.is_reversed, false);

  v_summary := jsonb_set(v_summary, '{cashRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashRefundsInMinorUnits')::BIGINT, 0) + v_cash_refunds), true);
  v_summary := jsonb_set(v_summary, '{cliqRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqRefundsInMinorUnits')::BIGINT, 0) + v_cliq_refunds), true);
  v_summary := jsonb_set(v_summary, '{cashReceiptsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashReceiptsInMinorUnits')::BIGINT, 0) + v_cash_opening_receipts), true);
  v_summary := jsonb_set(v_summary, '{cliqReceiptsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqReceiptsInMinorUnits')::BIGINT, 0) + v_cliq_opening_receipts), true);
  v_summary := jsonb_set(v_summary, '{cashSupplierPaymentsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashSupplierPaymentsInMinorUnits')::BIGINT, 0) + v_cash_opening_supplier), true);
  v_summary := jsonb_set(v_summary, '{cliqSupplierPaymentsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqSupplierPaymentsInMinorUnits')::BIGINT, 0) + v_cliq_opening_supplier), true);
  v_summary := v_summary || jsonb_build_object(
    'openingDebtCashReceiptsInMinorUnits', v_cash_opening_receipts,
    'openingDebtCliqReceiptsInMinorUnits', v_cliq_opening_receipts,
    'openingSupplierCashPaymentsInMinorUnits', v_cash_opening_supplier,
    'openingSupplierCliqPaymentsInMinorUnits', v_cliq_opening_supplier);
  RETURN jsonb_set(v_summary, '{expectedCashInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'expectedCashInMinorUnits')::BIGINT, 0)
      - v_cash_refunds + v_cash_opening_receipts - v_cash_opening_supplier), true);
END;
$$;
ALTER FUNCTION public.get_cash_shift_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID) TO authenticated;

-- Complete explicit cancel guard (130 body) plus the new shift activity.
CREATE OR REPLACE FUNCTION public.cancel_empty_cash_shift(
  p_shift_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إلغاء وردية فُتحت بالخطأ'
  );

  PERFORM 1 FROM public.cash_shifts WHERE id = p_shift_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.sales_return_events
    WHERE cash_shift_id = p_shift_id
      AND settlement_status <> 'cancelled'
  ) OR EXISTS (
    SELECT 1 FROM public.customer_collection_operations WHERE cash_shift_id = p_shift_id
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_opening_payments WHERE cash_shift_id = p_shift_id
  ) THEN
    RAISE EXCEPTION
      'لا يمكن إلغاء الوردية لأنها تحتوي حركة مالية. صحح العملية ثم أغلق الوردية طبيعيًا.';
  END IF;

  RETURN public._cancel_empty_cash_shift_before_return_events(p_shift_id, p_reason);
END;
$$;
ALTER FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_empty_cash_shift(UUID, TEXT) TO authenticated;

-- Complete explicit full-shift reversal guard (121 body) plus: a shift with an
-- active unified collection or supplier opening payment is reversed only
-- after those operations are reversed through their own whole-operation path.
CREATE OR REPLACE FUNCTION public.reverse_cash_shift_with_operations(
  p_shift_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_reversal_owner(
    'إلغاء الوردية وعكس جميع عملياتها'
  );
  PERFORM public.phase4_lock_full_shift_context_internal(p_shift_id);

  IF EXISTS (
    SELECT 1
    FROM public.sales_return_events return_event
    WHERE return_event.cash_shift_id = p_shift_id
      AND return_event.settlement_coordinator_version = 402
      AND return_event.settlement_status = 'settled'
      AND return_event.money_refund_amount_in_minor_units > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'PHASE42_SETTLED_RETURN_REFUND_DEPENDENCY: Reverse the settled Return through an approved future reversal contract before reversing its Shift.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_collection_operations op
    WHERE NOT op.is_reversed AND (op.cash_shift_id = p_shift_id OR EXISTS (
      SELECT 1 FROM public.customer_collection_order_payments link
      JOIN public.customer_payments payment ON payment.id = link.customer_payment_id
      WHERE link.operation_id = op.id AND payment.cash_shift_id = p_shift_id))
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_opening_payments link
    JOIN public.supplier_payments payment ON payment.id = link.supplier_payment_id
    WHERE link.cash_shift_id = p_shift_id AND NOT COALESCE(payment.is_reversed, false)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_SHIFT_HAS_UNIFIED_OPERATIONS: الوردية تحتوي تحصيلاً موحداً أو سداد رصيد مورد افتتاحي؛ اعكس هذه العمليات أولاً.';
  END IF;

  RETURN public._reverse_cash_shift_with_operations_before_phase42_refund_guard(
    p_shift_id, p_reason, p_idempotency_key
  );
END;
$$;
ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.collect_customer_balance_v1(UUID, BIGINT, TEXT, UUID, TEXT, TEXT, TEXT) IS
  'Unified customer collection: oldest-first over opening debts then open orders (existing order payment path); atomic, idempotent, capped at total debt.';
COMMENT ON FUNCTION public.pay_supplier_opening_balance_v1(UUID, UUID, BIGINT, TEXT, TEXT, TEXT, TEXT) IS
  'Pays a supplier opening payable; cash/CliQ from the chosen branch open shift; supplier balance and 133 evidence stay equal.';

COMMIT;
