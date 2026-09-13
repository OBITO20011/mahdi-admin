-- The deferred close-snapshot guard runs when the caller's transaction commits.
-- Execute its table read with the trusted function owner's privileges while
-- keeping the trigger helper unavailable as a direct RPC/API entrypoint.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_closed_cash_shift_has_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cash_shifts
    WHERE id = NEW.id
      AND status = 'closed'
      AND closing_report_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION 'لا يمكن إغلاق الوردية بدون حفظ لقطة تقرير الإغلاق.';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.assert_closed_cash_shift_has_snapshot() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.assert_closed_cash_shift_has_snapshot()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.assert_closed_cash_shift_has_snapshot() IS
  'Internal deferred trigger guard. SECURITY DEFINER is required because it reads the final cash_shifts row after the public close RPC returns; direct execution remains revoked.';

COMMIT;
