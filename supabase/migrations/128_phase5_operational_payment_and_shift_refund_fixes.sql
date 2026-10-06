BEGIN;

-- Phase 5 re-scope (docs/agent/PHASE5_RESCOPE.md): direct fixes on the
-- operational paths. No private layer, no new business policy.
--
-- C. Shift summary/close/report ignored Phase 4.2 Return refunds.
--    Migration 121 records settled refunds in sales_return_events and only
--    increments cash_shifts counters; the open-shift summary recomputed refunds
--    from legacy sales_returns, so expected cash was overstated and
--    close_cash_shift overwrote the counters without them.
-- B. Migration 121 re-granted the non-idempotent record_customer_order_payment
--    to authenticated after Migration 120 had revoked it. The application uses
--    record_customer_order_payment_once; internal SECURITY DEFINER callers are
--    unaffected by the revoke.
-- A. record_customer_order_payment_once returned the stored payment for a
--    same user/key replay without checking that order, amount and method match.

-- -------------------------------------------------------------------------
-- C1. Shift summary includes settled Phase 4.2 refunds for open shifts.
-- Closed shifts keep returning their frozen columns, which close_cash_shift
-- now writes from this corrected summary.
-- -------------------------------------------------------------------------
ALTER FUNCTION public.get_cash_shift_summary(UUID)
  RENAME TO _get_cash_shift_summary_before_return_events;
REVOKE ALL ON FUNCTION public._get_cash_shift_summary_before_return_events(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_cash_shift_summary(p_shift_id UUID)
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

  IF v_cash_refunds = 0 AND v_cliq_refunds = 0 THEN RETURN v_summary; END IF;

  v_summary := jsonb_set(
    v_summary,
    '{cashRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cashRefundsInMinorUnits')::BIGINT, 0) + v_cash_refunds),
    true
  );
  v_summary := jsonb_set(
    v_summary,
    '{cliqRefundsInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'cliqRefundsInMinorUnits')::BIGINT, 0) + v_cliq_refunds),
    true
  );
  RETURN jsonb_set(
    v_summary,
    '{expectedCashInMinorUnits}',
    to_jsonb(COALESCE((v_summary->>'expectedCashInMinorUnits')::BIGINT, 0) - v_cash_refunds),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_summary(UUID) TO authenticated;
ALTER FUNCTION public._get_cash_shift_summary_before_return_events(UUID) OWNER TO postgres;
ALTER FUNCTION public.get_cash_shift_summary(UUID) OWNER TO postgres;

-- -------------------------------------------------------------------------
-- C2. Closing report counts and breaks down settled Phase 4.2 refunds.
-- Monetary totals already come from the corrected summary. The immutable
-- close-time snapshot (Migration 094) is built from this same function.
-- -------------------------------------------------------------------------
ALTER FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID)
  RENAME TO _get_cash_shift_closing_report_before_return_events;
REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_before_return_events(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._get_cash_shift_closing_report_before_snapshot(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report JSONB;
  v_event_count INTEGER := 0;
  v_breakdown JSONB;
BEGIN
  v_report := public._get_cash_shift_closing_report_before_return_events(p_shift_id);

  SELECT COUNT(*)::INTEGER INTO v_event_count
  FROM public.sales_return_events
  WHERE cash_shift_id = p_shift_id
    AND settlement_status = 'settled'
    AND money_refund_amount_in_minor_units > 0;

  IF v_event_count = 0 OR COALESCE(v_report->>'success', 'false') <> 'true' THEN
    RETURN v_report;
  END IF;

  WITH combined AS (
    SELECT
      item->>'refundMethod' AS refund_method,
      item->>'stockDisposition' AS stock_disposition,
      COALESCE((item->>'count')::INTEGER, 0) AS item_count,
      COALESCE((item->>'amountInMinorUnits')::BIGINT, 0) AS amount
    FROM jsonb_array_elements(COALESCE(v_report->'returnBreakdown', '[]'::JSONB)) item
    UNION ALL
    SELECT
      return_event.refund_method,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.sales_return_items return_item
        WHERE return_item.sales_return_event_id = return_event.id
          AND return_item.stock_disposition = 'damaged'
      ) THEN 'damaged' ELSE 'restock' END,
      1,
      return_event.money_refund_amount_in_minor_units
    FROM public.sales_return_events return_event
    WHERE return_event.cash_shift_id = p_shift_id
      AND return_event.settlement_status = 'settled'
      AND return_event.money_refund_amount_in_minor_units > 0
  ), grouped AS (
    SELECT refund_method, stock_disposition,
      SUM(item_count)::INTEGER AS item_count, SUM(amount)::BIGINT AS amount
    FROM combined
    GROUP BY refund_method, stock_disposition
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'refundMethod', refund_method,
      'stockDisposition', stock_disposition,
      'count', item_count,
      'amountInMinorUnits', amount
    ) ORDER BY amount DESC, refund_method, stock_disposition
  ), '[]'::JSONB)
  INTO v_breakdown
  FROM grouped;

  v_report := jsonb_set(v_report, '{returnBreakdown}', v_breakdown, true);
  RETURN jsonb_set(
    v_report,
    '{outflows,returnCount}',
    to_jsonb(COALESCE((v_report #>> '{outflows,returnCount}')::INTEGER, 0) + v_event_count),
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public._get_cash_shift_closing_report_before_return_events(UUID) OWNER TO postgres;
ALTER FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID) OWNER TO postgres;

-- -------------------------------------------------------------------------
-- B. Restore Migration 120's intent: the non-idempotent writer is internal only.
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_customer_order_payment(UUID, BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- -------------------------------------------------------------------------
-- A. Same-key payment replay must carry the same request.
-- -------------------------------------------------------------------------
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
    IF v_existing.order_id IS DISTINCT FROM p_order_id
      OR v_existing.amount_in_minor_units IS DISTINCT FROM p_amount_in_minor_units
      OR v_existing.payment_method IS DISTINCT FROM p_payment_method
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'PAYMENT_IDEMPOTENCY_CONFLICT: مفتاح الدفعة مستخدم لطلب مختلف.';
    END IF;

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

REVOKE ALL ON FUNCTION public.record_customer_order_payment_once(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment_once(
  UUID, BIGINT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
