BEGIN;

-- Phase 5 re-scope A+ (owner decision 2026-10-06, docs/agent/PHASE5_RESCOPE.md):
-- reversing a customer receipt of a completed non-debt order is not supported.
-- sync_order_payment_state (Migration 043) forces such orders back to fully
-- paid, so a reversal would remove the money while the order stays "paid".
-- The reversal is rejected before any write. No alternative correction route
-- is introduced here; a Return is not a substitute for a wrong collection.

CREATE FUNCTION public.guard_paid_order_customer_payment_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_payment_method TEXT;
BEGIN
  IF NEW.is_reversed AND NOT OLD.is_reversed AND OLD.order_id IS NOT NULL THEN
    SELECT status, payment_method INTO v_status, v_payment_method
    FROM public.orders
    WHERE id = OLD.order_id;
    IF v_status = 'completed'
      AND COALESCE(v_payment_method, 'cash_on_delivery') <> 'debt'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PAYMENT_REVERSAL_PAID_ORDER_UNSUPPORTED: لا يمكن عكس سند قبض لطلب مكتمل غير آجل؛ هذا العكس غير مدعوم حاليًا.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_paid_order_customer_payment_reversal
BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_order_customer_payment_reversal();

REVOKE ALL ON FUNCTION public.guard_paid_order_customer_payment_reversal()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.guard_paid_order_customer_payment_reversal() OWNER TO postgres;

-- Full-shift reversal preview reports the same rule as BLOCKED, so the owner
-- sees the reason before executing. Execution gates on this same preview
-- (Migration 084) and the trigger above remains the final authority.
ALTER FUNCTION public._preview_cash_shift_full_reversal(UUID)
  RENAME TO _preview_cash_shift_full_reversal_before_paid_order_guard;
REVOKE ALL ON FUNCTION public._preview_cash_shift_full_reversal_before_paid_order_guard(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._preview_cash_shift_full_reversal(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview JSONB;
  v_blocked UUID[];
  v_operations JSONB;
BEGIN
  v_preview := public._preview_cash_shift_full_reversal_before_paid_order_guard(p_shift_id);

  SELECT ARRAY_AGG(payment.id) INTO v_blocked
  FROM public.customer_payments payment
  JOIN public.orders customer_order ON customer_order.id = payment.order_id
  WHERE payment.cash_shift_id = p_shift_id
    AND NOT payment.is_reversed
    AND customer_order.status = 'completed'
    AND COALESCE(customer_order.payment_method, 'cash_on_delivery') <> 'debt';

  IF COALESCE(CARDINALITY(v_blocked), 0) = 0 THEN RETURN v_preview; END IF;

  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN operation->>'operationType' = 'customer_payment'
        AND operation->>'status' = 'SUPPORTED'
        AND (operation->>'originalRecordId')::UUID = ANY(v_blocked)
      THEN operation || jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'سند قبض لطلب مكتمل غير آجل؛ عكسه غير مدعوم.'
      )
      ELSE operation
    END ORDER BY ordinality
  ), '[]'::JSONB)
  INTO v_operations
  FROM jsonb_array_elements(COALESCE(v_preview->'operations', '[]'::JSONB))
    WITH ORDINALITY AS item(operation, ordinality);

  RETURN v_preview || jsonb_build_object('operations', v_operations, 'canExecute', false);
END;
$$;

REVOKE ALL ON FUNCTION public._preview_cash_shift_full_reversal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public._preview_cash_shift_full_reversal_before_paid_order_guard(UUID) OWNER TO postgres;
ALTER FUNCTION public._preview_cash_shift_full_reversal(UUID) OWNER TO postgres;

COMMIT;
