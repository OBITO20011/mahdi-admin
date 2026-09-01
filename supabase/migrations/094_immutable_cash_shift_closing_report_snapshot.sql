-- =========================================================================
-- Immutable closing-report artifact for newly closed cash shifts.
-- Canonical financial rows remain the source of truth; this captures the
-- exact report presentation available at the instant a shift is closed.
-- =========================================================================

BEGIN;

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS closing_report_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS closing_report_snapshotted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closing_report_snapshot_version SMALLINT;

ALTER TABLE public.cash_shifts
  DROP CONSTRAINT IF EXISTS cash_shifts_closing_report_snapshot_integrity_check;

ALTER TABLE public.cash_shifts
  ADD CONSTRAINT cash_shifts_closing_report_snapshot_integrity_check
  CHECK (
    (
      closing_report_snapshot IS NULL
      AND closing_report_snapshotted_at IS NULL
      AND closing_report_snapshot_version IS NULL
    )
    OR
    (
      status = 'closed'
      AND jsonb_typeof(closing_report_snapshot) = 'object'
      AND closing_report_snapshotted_at IS NOT NULL
      AND closing_report_snapshot_version = 1
    )
  );

CREATE OR REPLACE FUNCTION public.guard_cash_shift_closing_report_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A captured report is an audit artifact: it can never be overwritten,
  -- cleared, or version-swapped after it has been stored.
  IF OLD.closing_report_snapshot IS NOT NULL
    AND (
      NEW.closing_report_snapshot IS DISTINCT FROM OLD.closing_report_snapshot
      OR NEW.closing_report_snapshotted_at IS DISTINCT FROM OLD.closing_report_snapshotted_at
      OR NEW.closing_report_snapshot_version IS DISTINCT FROM OLD.closing_report_snapshot_version
    )
  THEN
    RAISE EXCEPTION 'لقطة تقرير الإغلاق محفوظة ولا يمكن تعديلها أو حذفها.';
  END IF;

  -- Historical closed shifts deliberately remain without a fabricated
  -- snapshot. The one permitted late write is the second update performed by
  -- close_cash_shift in the same transaction that changed open -> closed.
  IF OLD.closing_report_snapshot IS NULL
    AND NEW.closing_report_snapshot IS NOT NULL
    AND NOT (
      NEW.status = 'closed'
      AND (
        OLD.status = 'open'
        OR (
          OLD.status = 'closed'
          AND OLD.closed_at = transaction_timestamp()
        )
      )
    )
  THEN
    RAISE EXCEPTION 'لا يمكن إضافة لقطة تقرير إلى وردية تاريخية مغلقة.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_cash_shift_closing_report_snapshot
  ON public.cash_shifts;
CREATE TRIGGER trg_guard_cash_shift_closing_report_snapshot
BEFORE UPDATE OF closing_report_snapshot, closing_report_snapshotted_at,
  closing_report_snapshot_version ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.guard_cash_shift_closing_report_snapshot();

-- A deferred DB-level guard makes a future close impossible unless the
-- wrapper below stores the artifact before the transaction commits.
CREATE OR REPLACE FUNCTION public.assert_closed_cash_shift_has_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS trg_closed_cash_shift_requires_snapshot
  ON public.cash_shifts;
CREATE CONSTRAINT TRIGGER trg_closed_cash_shift_requires_snapshot
AFTER UPDATE OF status, closing_report_snapshot ON public.cash_shifts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.assert_closed_cash_shift_has_snapshot();

-- Preserve the proven close implementation as an internal primitive, then
-- add snapshot capture without changing its accounting calculations.
DO $$
BEGIN
  IF to_regprocedure(
    'public._close_cash_shift_before_closing_report_snapshot(uuid,bigint,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
      RENAME TO _close_cash_shift_before_closing_report_snapshot;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._close_cash_shift_before_closing_report_snapshot(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The current report implementation is preserved internally so closed shifts
-- with a snapshot return the immutable artifact while open and legacy shifts
-- retain their established live/recalculated behavior.
DO $$
BEGIN
  IF to_regprocedure(
    'public._get_cash_shift_closing_report_before_snapshot(uuid)'
  ) IS NULL THEN
    ALTER FUNCTION public.get_cash_shift_closing_report(UUID)
      RENAME TO _get_cash_shift_closing_report_before_snapshot;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_cash_shift_closing_report_before_snapshot(UUID)
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
  v_shift public.cash_shifts%ROWTYPE;
  v_report JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض تقرير إغلاق الوردية'
  );

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحددة غير موجودة.';
  END IF;

  IF v_shift.status = 'closed'
    AND v_shift.closing_report_snapshot IS NOT NULL
  THEN
    RETURN v_shift.closing_report_snapshot;
  END IF;

  v_report := public._get_cash_shift_closing_report_before_snapshot(p_shift_id);
  RETURN v_report || jsonb_build_object(
    'snapshotStatus',
    CASE
      WHEN v_shift.status = 'open' THEN 'live'
      WHEN v_shift.status = 'closed' THEN 'legacy_recalculated'
      ELSE 'not_applicable'
    END
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
  v_result JSONB;
  v_snapshot JSONB;
BEGIN
  v_result := public._close_cash_shift_before_closing_report_snapshot(
    p_shift_id,
    p_actual_cash_in_minor_units,
    p_discrepancy_reason
  );

  -- The internal close function has already frozen the canonical monetary
  -- columns. Capture the same report consumers see, inside this transaction.
  v_snapshot := public._get_cash_shift_closing_report_before_snapshot(p_shift_id)
    || jsonb_build_object(
      'snapshotStatus', 'immutable',
      'snapshotVersion', 1
    );

  IF COALESCE(v_snapshot->>'success', 'false') <> 'true' THEN
    RAISE EXCEPTION 'تعذر إنشاء لقطة تقرير الإغلاق؛ تم إلغاء إغلاق الوردية بأمان.';
  END IF;

  UPDATE public.cash_shifts
  SET closing_report_snapshot = v_snapshot,
      closing_report_snapshotted_at = NOW(),
      closing_report_snapshot_version = 1,
      updated_at = NOW()
  WHERE id = p_shift_id
    AND status = 'closed'
    AND closing_report_snapshot IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'تعذر تثبيت لقطة تقرير الإغلاق؛ تم إلغاء العملية بأمان.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    auth.uid(),
    'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT',
    'cash_shifts',
    p_shift_id,
    jsonb_build_object(
      'snapshot_version', 1,
      'snapshot_bytes', octet_length(v_snapshot::TEXT),
      'captured_at', NOW()
    )
  );

  RETURN v_result || jsonb_build_object(
    'closingReportSnapshotCaptured', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cash_shift_closing_report(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_closing_report(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(UUID, BIGINT, TEXT)
  TO authenticated;

COMMENT ON COLUMN public.cash_shifts.closing_report_snapshot IS
  'Immutable close-time report artifact for newly closed shifts; canonical rows remain the financial source of truth.';
COMMENT ON FUNCTION public.get_cash_shift_closing_report(UUID) IS
  'Returns an immutable close-time artifact when available; legacy closed shifts remain safely recalculated.';

COMMIT;
