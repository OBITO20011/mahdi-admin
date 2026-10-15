-- Owner cash withdrawals (docs/design/OWNER_WITHDRAWALS_DESIGN_AR.md) with the
-- owner decisions of 2026-10-15:
--  1. Reversing a withdrawal of a closed shift is a return entry in the open
--     shift of the same branch; the closed shift and its snapshot never change.
--     Reversal is owner-only with a mandatory reason.
--  2. A withdrawal larger than the drawer's expected cash is refused
--     ("بالدرج X فقط").
--  3. A full shift reversal reverses the shift's withdrawals and the returns
--     booked in it atomically, or refuses before any write.
-- A withdrawal is its own cash movement: not an expense, purchase or cost.
-- Sales, COGS, expenses, profit and customer/supplier balances are unchanged.
-- New tables are RPC-only (RLS on, REVOKE ALL from client roles).

BEGIN;

CREATE SEQUENCE public.owner_cash_withdrawal_number_seq;
REVOKE ALL ON SEQUENCE public.owner_cash_withdrawal_number_seq FROM PUBLIC, anon, authenticated;

CREATE TABLE public.owner_cash_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_number TEXT NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  cash_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  request_fingerprint TEXT NOT NULL,
  UNIQUE (created_by, idempotency_key)
);
CREATE INDEX idx_owner_cash_withdrawals_shift ON public.owner_cash_withdrawals(cash_shift_id);
CREATE INDEX idx_owner_cash_withdrawals_branch_time ON public.owner_cash_withdrawals(branch_id, created_at DESC);

-- One active (not voided) reversal per withdrawal. A full reversal of the
-- shift the return was booked in voids it, so the withdrawal stands again.
CREATE TABLE public.owner_cash_withdrawal_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES public.owner_cash_withdrawals(id) ON DELETE RESTRICT,
  effective_shift_id UUID NOT NULL REFERENCES public.cash_shifts(id) ON DELETE RESTRICT,
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  reversed_by UUID NOT NULL,
  reversed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  via_shift_reversal_id UUID REFERENCES public.cash_shift_reversals(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
  request_fingerprint TEXT NOT NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  voided_by_shift_reversal_id UUID REFERENCES public.cash_shift_reversals(id) ON DELETE RESTRICT,
  CHECK ((voided_at IS NULL) = (voided_by_shift_reversal_id IS NULL)),
  UNIQUE (reversed_by, idempotency_key)
);
CREATE UNIQUE INDEX idx_owner_cash_withdrawal_reversals_one_active
  ON public.owner_cash_withdrawal_reversals(withdrawal_id) WHERE voided_at IS NULL;
CREATE INDEX idx_owner_cash_withdrawal_reversals_shift ON public.owner_cash_withdrawal_reversals(effective_shift_id);

ALTER TABLE public.owner_cash_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_cash_withdrawal_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.owner_cash_withdrawals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.owner_cash_withdrawal_reversals FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.owner_withdrawal_reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Nested so OLD/NEW columns are only read on the reversals table (PL/pgSQL
  -- does not short-circuit a single IF condition).
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'owner_cash_withdrawal_reversals'
    AND current_setting('nawasrah.owner_withdrawal_void', true) = 'on'
  THEN
    IF to_jsonb(OLD)->>'voided_at' IS NULL AND to_jsonb(NEW)->>'voided_at' IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by', 'voided_by_shift_reversal_id'])
        = (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by', 'voided_by_shift_reversal_id'])
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'OWNER_WITHDRAWAL_IMMUTABLE: سحب المالك وعكسه لا يُعدّلان ولا يُحذفان؛ التصحيح بقيد عكسي.';
END;
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_reject_mutation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_owner_cash_withdrawals_immutable
BEFORE UPDATE OR DELETE ON public.owner_cash_withdrawals
FOR EACH ROW EXECUTE FUNCTION public.owner_withdrawal_reject_mutation();
CREATE TRIGGER trg_owner_cash_withdrawals_no_truncate
BEFORE TRUNCATE ON public.owner_cash_withdrawals
FOR EACH STATEMENT EXECUTE FUNCTION public.owner_withdrawal_reject_mutation();
CREATE TRIGGER trg_owner_cash_withdrawal_reversals_immutable
BEFORE UPDATE OR DELETE ON public.owner_cash_withdrawal_reversals
FOR EACH ROW EXECUTE FUNCTION public.owner_withdrawal_reject_mutation();
CREATE TRIGGER trg_owner_cash_withdrawal_reversals_no_truncate
BEFORE TRUNCATE ON public.owner_cash_withdrawal_reversals
FOR EACH STATEMENT EXECUTE FUNCTION public.owner_withdrawal_reject_mutation();

-- Cash effect of withdrawals on one shift: withdrawals leave it, active
-- returns booked in it come back.
CREATE FUNCTION public.owner_withdrawal_shift_effect_internal(p_shift_id UUID)
RETURNS TABLE (withdrawn_in_minor_units BIGINT, returned_in_minor_units BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT SUM(w.amount_in_minor_units) FROM public.owner_cash_withdrawals w
      WHERE w.cash_shift_id = p_shift_id), 0)::BIGINT,
    COALESCE((SELECT SUM(r.amount_in_minor_units) FROM public.owner_cash_withdrawal_reversals r
      WHERE r.effective_shift_id = p_shift_id AND r.voided_at IS NULL), 0)::BIGINT;
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_shift_effect_internal(UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.owner_withdrawal_format_jod_internal(p_minor BIGINT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT to_char(p_minor / 1000.0, 'FM999999999990.000') || ' د.أ';
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_format_jod_internal(BIGINT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shift summary: complete explicit 163 body plus the withdrawal effect.
-- Closed shifts keep returning their frozen columns (the close froze this
-- same summary); the withdrawal fields are informational for them.
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
  v_withdrawn BIGINT := 0;
  v_returned BIGINT := 0;
BEGIN
  v_summary := public._get_cash_shift_summary_before_return_events(p_shift_id);
  SELECT status INTO v_shift_status
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  SELECT effect.withdrawn_in_minor_units, effect.returned_in_minor_units
  INTO v_withdrawn, v_returned
  FROM public.owner_withdrawal_shift_effect_internal(p_shift_id) effect;
  v_summary := v_summary || jsonb_build_object(
    'ownerWithdrawalsInMinorUnits', v_withdrawn,
    'ownerWithdrawalReturnsInMinorUnits', v_returned);
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
      - v_cash_refunds + v_cash_opening_receipts - v_cash_opening_supplier
      - v_withdrawn + v_returned), true);
END;
$$;
ALTER FUNCTION public.get_cash_shift_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.owner_withdrawal_result_internal(p_withdrawal_id UUID, p_replay BOOLEAN)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'idempotentReplay', p_replay,
    'withdrawalId', w.id,
    'withdrawalNumber', w.withdrawal_number,
    'branchId', w.branch_id,
    'shiftId', w.cash_shift_id,
    'amountInMinorUnits', w.amount_in_minor_units,
    'reason', w.reason,
    'createdAt', w.created_at,
    'reversal', (
      SELECT jsonb_build_object('reversalId', r.id, 'effectiveShiftId', r.effective_shift_id,
        'reversedAt', r.reversed_at, 'reason', r.reason)
      FROM public.owner_cash_withdrawal_reversals r
      WHERE r.withdrawal_id = w.id AND r.voided_at IS NULL
    )
  )
  FROM public.owner_cash_withdrawals w
  WHERE w.id = p_withdrawal_id;
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_result_internal(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_owner_cash_withdrawal_v1(
  p_shift_id UUID,
  p_amount_in_minor_units BIGINT,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
  v_reason TEXT := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
  v_fingerprint TEXT;
  v_existing public.owner_cash_withdrawals%ROWTYPE;
  v_shift public.cash_shifts%ROWTYPE;
  v_expected BIGINT;
  v_id UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'سحب المالك من الدرج');
  IF char_length(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_INVALID: مفتاح العملية غير صالح.';
  END IF;
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_SHIFT_REQUIRED: اختر الوردية المفتوحة.';
  END IF;
  IF p_amount_in_minor_units IS NULL OR p_amount_in_minor_units <= 0 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_AMOUNT_INVALID: مبلغ السحب يجب أن يكون أكبر من صفر.';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_REASON_TOO_LONG: السبب أطول من 500 حرف.';
  END IF;
  v_fingerprint := md5(p_shift_id::TEXT || '|' || p_amount_in_minor_units::TEXT || '|' || COALESCE(v_reason, ''));

  -- Same request replays its stored result without writing, even after close.
  SELECT * INTO v_existing FROM public.owner_cash_withdrawals
  WHERE created_by = v_user_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_CONFLICT: استُخدم مفتاح العملية لطلب سحب مختلف.';
    END IF;
    RETURN public.owner_withdrawal_result_internal(v_existing.id, true);
  END IF;

  -- Lock order: full-shift reversal domain, then the shift row.
  PERFORM pg_advisory_xact_lock(hashtextextended('cash-shift-full-reversal:' || p_shift_id::TEXT, 0));
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_SHIFT_NOT_FOUND: الوردية المحددة غير موجودة.';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_SHIFT_NOT_OPEN: السحب من وردية مفتوحة فقط.';
  END IF;
  -- Re-check after the lock: a concurrent double-click with the same key waits here.
  SELECT * INTO v_existing FROM public.owner_cash_withdrawals
  WHERE created_by = v_user_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_CONFLICT: استُخدم مفتاح العملية لطلب سحب مختلف.';
    END IF;
    RETURN public.owner_withdrawal_result_internal(v_existing.id, true);
  END IF;

  v_expected := COALESCE((public.get_cash_shift_summary(p_shift_id)->>'expectedCashInMinorUnits')::BIGINT, 0);
  IF p_amount_in_minor_units > v_expected THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_EXCEEDS_DRAWER: بالدرج % فقط.',
      public.owner_withdrawal_format_jod_internal(GREATEST(v_expected, 0))
      USING DETAIL = jsonb_build_object('expectedCashInMinorUnits', v_expected)::TEXT;
  END IF;

  INSERT INTO public.owner_cash_withdrawals (
    withdrawal_number, branch_id, cash_shift_id, amount_in_minor_units, reason,
    created_by, idempotency_key, request_fingerprint
  ) VALUES (
    'OW-' || lpad(nextval('public.owner_cash_withdrawal_number_seq')::TEXT, 6, '0'),
    v_shift.branch_id, p_shift_id, p_amount_in_minor_units, v_reason,
    v_user_id, v_key, v_fingerprint
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'CREATE_OWNER_CASH_WITHDRAWAL', 'owner_cash_withdrawals', v_id,
    jsonb_build_object('shift_id', p_shift_id, 'branch_id', v_shift.branch_id,
      'amount_in_minor_units', p_amount_in_minor_units, 'reason', v_reason,
      'expected_cash_before_in_minor_units', v_expected,
      'expected_cash_after_in_minor_units', v_expected - p_amount_in_minor_units));

  RETURN public.owner_withdrawal_result_internal(v_id, false)
    || jsonb_build_object('shiftSummary', public.get_cash_shift_summary(p_shift_id));
END;
$$;
REVOKE ALL ON FUNCTION public.create_owner_cash_withdrawal_v1(UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_owner_cash_withdrawal_v1(UUID, BIGINT, TEXT, TEXT) TO authenticated;

CREATE FUNCTION public.reverse_owner_cash_withdrawal_v1(
  p_withdrawal_id UUID,
  p_reason TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
  v_reason TEXT := BTRIM(COALESCE(p_reason, ''));
  v_fingerprint TEXT;
  v_existing public.owner_cash_withdrawal_reversals%ROWTYPE;
  v_withdrawal public.owner_cash_withdrawals%ROWTYPE;
  v_original public.cash_shifts%ROWTYPE;
  v_effective_shift UUID;
  v_lock UUID;
  v_id UUID;
BEGIN
  v_user_id := public.assert_reversal_owner('عكس سحب المالك');
  IF char_length(v_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_INVALID: مفتاح العملية غير صالح.';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_REVERSAL_REASON_REQUIRED: سبب العكس مطلوب (5 إلى 500 حرف).';
  END IF;
  v_fingerprint := md5(COALESCE(p_withdrawal_id::TEXT, '') || '|' || v_reason);

  SELECT * INTO v_existing FROM public.owner_cash_withdrawal_reversals
  WHERE reversed_by = v_user_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_CONFLICT: استُخدم مفتاح العملية لطلب عكس مختلف.';
    END IF;
    RETURN public.owner_withdrawal_result_internal(v_existing.withdrawal_id, true)
      || jsonb_build_object('reversalId', v_existing.id, 'effectiveShiftId', v_existing.effective_shift_id);
  END IF;

  SELECT * INTO v_withdrawal FROM public.owner_cash_withdrawals WHERE id = p_withdrawal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_NOT_FOUND: السحب المحدد غير موجود.';
  END IF;
  SELECT * INTO v_original FROM public.cash_shifts WHERE id = v_withdrawal.cash_shift_id;
  -- The return goes back into the withdrawal's shift while it is open,
  -- otherwise into the open shift of the same branch (one per branch).
  IF v_original.status = 'open' THEN
    v_effective_shift := v_original.id;
  ELSE
    SELECT shift.id INTO v_effective_shift FROM public.cash_shifts shift
    WHERE shift.branch_id = v_withdrawal.branch_id AND shift.status = 'open';
    IF v_effective_shift IS NULL THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_REVERSAL_NEEDS_OPEN_SHIFT: افتح وردية في فرع السحب ليُعاد المبلغ إلى درجها.';
    END IF;
  END IF;

  -- Lock order: reversal domains (sorted), shift rows (sorted), then the withdrawal.
  FOR v_lock IN SELECT DISTINCT id FROM unnest(ARRAY[v_original.id, v_effective_shift]) id ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('cash-shift-full-reversal:' || v_lock::TEXT, 0));
  END LOOP;
  PERFORM 1 FROM public.cash_shifts WHERE id IN (v_original.id, v_effective_shift) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.owner_cash_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;

  SELECT * INTO v_existing FROM public.owner_cash_withdrawal_reversals
  WHERE reversed_by = v_user_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_KEY_CONFLICT: استُخدم مفتاح العملية لطلب عكس مختلف.';
    END IF;
    RETURN public.owner_withdrawal_result_internal(v_existing.withdrawal_id, true)
      || jsonb_build_object('reversalId', v_existing.id, 'effectiveShiftId', v_existing.effective_shift_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.owner_cash_withdrawal_reversals
    WHERE withdrawal_id = p_withdrawal_id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_ALREADY_REVERSED: هذا السحب معكوس مسبقاً.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_shifts WHERE id = v_effective_shift AND status = 'open') THEN
    RAISE EXCEPTION 'OWNER_WITHDRAWAL_REVERSAL_NEEDS_OPEN_SHIFT: افتح وردية في فرع السحب ليُعاد المبلغ إلى درجها.';
  END IF;

  INSERT INTO public.owner_cash_withdrawal_reversals (
    withdrawal_id, effective_shift_id, amount_in_minor_units, reason, reversed_by,
    idempotency_key, request_fingerprint
  ) VALUES (
    p_withdrawal_id, v_effective_shift, v_withdrawal.amount_in_minor_units, v_reason, v_user_id,
    v_key, v_fingerprint
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'REVERSE_OWNER_CASH_WITHDRAWAL', 'owner_cash_withdrawals', p_withdrawal_id,
    jsonb_build_object('reversal_id', v_id, 'original_shift_id', v_original.id,
      'effective_shift_id', v_effective_shift, 'amount_in_minor_units', v_withdrawal.amount_in_minor_units,
      'reason', v_reason, 'original_shift_status', v_original.status));

  RETURN public.owner_withdrawal_result_internal(p_withdrawal_id, false)
    || jsonb_build_object('reversalId', v_id, 'effectiveShiftId', v_effective_shift,
      'shiftSummary', public.get_cash_shift_summary(v_effective_shift));
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_owner_cash_withdrawal_v1(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_owner_cash_withdrawal_v1(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Cancelling an "empty" shift: complete explicit 163 body plus withdrawals.
-- ---------------------------------------------------------------------------
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
  ) OR EXISTS (
    SELECT 1 FROM public.owner_cash_withdrawals WHERE cash_shift_id = p_shift_id
  ) OR EXISTS (
    SELECT 1 FROM public.owner_cash_withdrawal_reversals WHERE effective_shift_id = p_shift_id
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

-- ---------------------------------------------------------------------------
-- Full shift reversal (decision 3).
-- ---------------------------------------------------------------------------
-- What a full reversal of the shift would do to withdrawals, and whether it
-- is containable: a withdrawal of this shift already returned into another
-- shift cannot be undone from here.
CREATE FUNCTION public.owner_withdrawal_shift_reversal_plan_internal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH own AS (
    SELECT w.id, w.withdrawal_number, w.amount_in_minor_units, r.id AS reversal_id, r.effective_shift_id
    FROM public.owner_cash_withdrawals w
    LEFT JOIN public.owner_cash_withdrawal_reversals r ON r.withdrawal_id = w.id AND r.voided_at IS NULL
    WHERE w.cash_shift_id = p_shift_id
  ), foreign_returns AS (
    SELECT r.id, r.withdrawal_id, w.withdrawal_number, r.amount_in_minor_units, w.cash_shift_id
    FROM public.owner_cash_withdrawal_reversals r
    JOIN public.owner_cash_withdrawals w ON w.id = r.withdrawal_id
    WHERE r.effective_shift_id = p_shift_id AND r.voided_at IS NULL AND w.cash_shift_id <> p_shift_id
  )
  SELECT jsonb_build_object(
    'canExecute', NOT EXISTS (SELECT 1 FROM own WHERE reversal_id IS NOT NULL AND effective_shift_id <> p_shift_id),
    'blockedReason', CASE WHEN EXISTS (SELECT 1 FROM own WHERE reversal_id IS NOT NULL AND effective_shift_id <> p_shift_id)
      THEN 'OWNER_WITHDRAWAL_RETURNED_IN_OTHER_SHIFT: سحب من هذه الوردية أُعيد في وردية أخرى؛ لا يمكن احتواؤه في عكس هذه الوردية.' END,
    'withdrawalsToReverse', COALESCE((SELECT jsonb_agg(jsonb_build_object('withdrawalId', id, 'withdrawalNumber', withdrawal_number,
      'amountInMinorUnits', amount_in_minor_units) ORDER BY withdrawal_number) FROM own WHERE reversal_id IS NULL), '[]'::JSONB),
    'returnsToVoid', COALESCE((SELECT jsonb_agg(jsonb_build_object('reversalId', id, 'withdrawalId', withdrawal_id,
      'withdrawalNumber', withdrawal_number, 'amountInMinorUnits', amount_in_minor_units, 'originalShiftId', cash_shift_id)
      ORDER BY withdrawal_number) FROM foreign_returns), '[]'::JSONB),
    'cashBackToDrawerInMinorUnits', COALESCE((SELECT SUM(amount_in_minor_units) FROM own WHERE reversal_id IS NULL), 0),
    'cashOutAgainInMinorUnits', COALESCE((SELECT SUM(amount_in_minor_units) FROM foreign_returns), 0)
  );
$$;
REVOKE ALL ON FUNCTION public.owner_withdrawal_shift_reversal_plan_internal(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_cash_shift_full_reversal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview JSONB;
  v_plan JSONB;
BEGIN
  PERFORM public.assert_reversal_owner('معاينة إلغاء الوردية وعكس عملياتها');
  v_preview := public._preview_cash_shift_full_reversal(p_shift_id);
  v_plan := public.owner_withdrawal_shift_reversal_plan_internal(p_shift_id);
  RETURN v_preview || jsonb_build_object(
    'ownerWithdrawals', v_plan,
    'canExecute', COALESCE((v_preview->>'canExecute')::BOOLEAN, false) AND (v_plan->>'canExecute')::BOOLEAN
  );
END;
$$;
ALTER FUNCTION public.preview_cash_shift_full_reversal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_cash_shift_full_reversal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_cash_shift_full_reversal(UUID) TO authenticated;

-- Complete explicit 163 body plus withdrawals: refused before any write when
-- not containable; otherwise in the same transaction every unreversed
-- withdrawal of the shift gets a return booked in the shift, and every return
-- booked in this shift for a withdrawal of another shift is voided.
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
DECLARE
  v_user_id UUID;
  v_plan JSONB;
  v_result JSONB;
  v_reversal_id UUID;
  v_item JSONB;
  v_reason TEXT := NULLIF(TRIM(p_reason), '');
  v_reversed_count INTEGER := 0;
  v_reversed_amount BIGINT := 0;
  v_voided_count INTEGER := 0;
  v_voided_amount BIGINT := 0;
BEGIN
  v_user_id := public.assert_reversal_owner(
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

  -- Withdrawals of this shift and returns booked in it: lock, then decide
  -- before any write.
  PERFORM 1 FROM public.owner_cash_withdrawals WHERE cash_shift_id = p_shift_id ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.owner_cash_withdrawal_reversals
  WHERE effective_shift_id = p_shift_id
     OR withdrawal_id IN (SELECT id FROM public.owner_cash_withdrawals WHERE cash_shift_id = p_shift_id)
  ORDER BY id FOR UPDATE;
  v_plan := public.owner_withdrawal_shift_reversal_plan_internal(p_shift_id);
  IF NOT (v_plan->>'canExecute')::BOOLEAN THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = v_plan->>'blockedReason';
  END IF;

  v_result := public._reverse_cash_shift_with_operations_before_phase42_refund_guard(
    p_shift_id, p_reason, p_idempotency_key
  );
  IF COALESCE((v_result->>'idempotent')::BOOLEAN, false) THEN
    -- The first execution already handled withdrawals in its transaction.
    RETURN v_result || jsonb_build_object('ownerWithdrawals', v_plan);
  END IF;
  v_reversal_id := (v_result->>'reversalId')::UUID;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_plan->'withdrawalsToReverse') LOOP
    INSERT INTO public.owner_cash_withdrawal_reversals (
      withdrawal_id, effective_shift_id, amount_in_minor_units, reason, reversed_by,
      via_shift_reversal_id, idempotency_key, request_fingerprint
    ) VALUES (
      (v_item->>'withdrawalId')::UUID, p_shift_id, (v_item->>'amountInMinorUnits')::BIGINT, v_reason, v_user_id,
      v_reversal_id, 'shift-reversal:' || v_reversal_id::TEXT || ':' || (v_item->>'withdrawalId'),
      md5('shift-reversal|' || v_reversal_id::TEXT || '|' || (v_item->>'withdrawalId'))
    );
    v_reversed_count := v_reversed_count + 1;
    v_reversed_amount := v_reversed_amount + (v_item->>'amountInMinorUnits')::BIGINT;
  END LOOP;

  PERFORM set_config('nawasrah.owner_withdrawal_void', 'on', true);
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_plan->'returnsToVoid') LOOP
    UPDATE public.owner_cash_withdrawal_reversals
    SET voided_at = clock_timestamp(), voided_by = v_user_id, voided_by_shift_reversal_id = v_reversal_id
    WHERE id = (v_item->>'reversalId')::UUID AND voided_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OWNER_WITHDRAWAL_RETURN_CHANGED: تغيّر عكس سحب أثناء عكس الوردية؛ أعد المحاولة.';
    END IF;
    v_voided_count := v_voided_count + 1;
    v_voided_amount := v_voided_amount + (v_item->>'amountInMinorUnits')::BIGINT;
  END LOOP;
  PERFORM set_config('nawasrah.owner_withdrawal_void', 'off', true);

  IF v_reversed_count + v_voided_count > 0 THEN
    INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
    VALUES (v_user_id, 'REVERSE_OWNER_WITHDRAWALS_FOR_SHIFT', 'cash_shifts', p_shift_id,
      jsonb_build_object('reversal_id', v_reversal_id, 'reason', v_reason,
        'withdrawals_reversed', v_plan->'withdrawalsToReverse', 'returns_voided', v_plan->'returnsToVoid'));
  END IF;

  RETURN v_result || jsonb_build_object('ownerWithdrawals', jsonb_build_object(
    'withdrawalsReversedCount', v_reversed_count,
    'withdrawalsReversedInMinorUnits', v_reversed_amount,
    'returnsVoidedCount', v_voided_count,
    'returnsVoidedInMinorUnits', v_voided_amount));
END;
$$;
ALTER FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_cash_shift_with_operations(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON TABLE public.owner_cash_withdrawals IS
  'Owner cash withdrawals from an open shift drawer; immutable, corrected by a linked reversal.';
COMMENT ON TABLE public.owner_cash_withdrawal_reversals IS
  'One active reversal per withdrawal; booked in the original open shift or the branch open shift; voided only by a full reversal of the shift it was booked in.';

COMMIT;
