-- Runtime verification for Migration 094. Runs only against a disposable
-- isolated Supabase database and rolls all fixtures back afterwards.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE closing_snapshot_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '94000000-0000-0000-0000-000000000001';
  v_branch UUID := '94000000-0000-0000-0000-000000000010';
  v_shift UUID;
  v_owner_role UUID;
  v_close_result JSONB;
  v_first_report JSONB;
  v_second_report JSONB;
  v_summary JSONB;
  v_snapshot JSONB;
  v_snapshot_bytes INTEGER;
  v_immutable_blocked BOOLEAN := false;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated', 'snapshot-owner@example.test',
    NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (v_owner, 'مالك لقطة الإغلاق', true)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, is_active = true;

  INSERT INTO public.roles (code, name_ar)
  VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_owner, v_owner_role)
  ON CONFLICT DO NOTHING;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'SNAPSHOT-RUNTIME', 'فرع اختبار لقطة الإغلاق', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  v_shift := (public.open_cash_shift(v_branch, 1234)->>'id')::UUID;
  v_close_result := public.close_cash_shift(v_shift, 1234, NULL);

  SELECT closing_report_snapshot, octet_length(closing_report_snapshot::TEXT)
  INTO v_snapshot, v_snapshot_bytes
  FROM public.cash_shifts
  WHERE id = v_shift
    AND status = 'closed'
    AND closing_report_snapshotted_at IS NOT NULL
    AND closing_report_snapshot_version = 1;

  IF v_snapshot IS NULL
    OR v_snapshot->>'snapshotStatus' <> 'immutable'
    OR COALESCE(v_close_result->>'closingReportSnapshotCaptured', 'false') <> 'true'
  THEN
    RAISE EXCEPTION 'Newly closed shift did not persist an immutable closing report snapshot.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'new_close_persists_immutable_snapshot', true,
    jsonb_build_object('snapshot_bytes', v_snapshot_bytes)
  );

  v_first_report := public.get_cash_shift_closing_report(v_shift);
  UPDATE public.profiles
  SET full_name = 'اسم تم تغييره بعد الإغلاق'
  WHERE id = v_owner;
  v_second_report := public.get_cash_shift_closing_report(v_shift);
  IF v_first_report IS DISTINCT FROM v_snapshot
    OR v_second_report IS DISTINCT FROM v_snapshot
  THEN
    RAISE EXCEPTION 'Closed shift report changed after a related profile changed.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'closed_report_returns_exact_snapshot_after_related_change', true,
    '{}'::JSONB
  );

  BEGIN
    UPDATE public.cash_shifts
    SET closing_report_snapshot = jsonb_build_object('tampered', true)
    WHERE id = v_shift;
  EXCEPTION WHEN OTHERS THEN
    v_immutable_blocked := true;
  END;
  IF NOT v_immutable_blocked THEN
    RAISE EXCEPTION 'Snapshot mutation was not blocked by the database.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'database_rejects_snapshot_mutation', true,
    '{}'::JSONB
  );

  v_summary := public.get_cash_shift_summary(v_shift);
  IF (v_summary->>'openingCashInMinorUnits')::BIGINT <> 1234
    OR (v_summary->>'expectedCashInMinorUnits')::BIGINT <> 1234
    OR (v_summary->>'actualCashInMinorUnits')::BIGINT <> 1234
    OR (v_snapshot #>> '{reconciliation,expectedCashInMinorUnits}')::BIGINT <> 1234
    OR (v_snapshot #>> '{reconciliation,actualCashInMinorUnits}')::BIGINT <> 1234
  THEN
    RAISE EXCEPTION 'Snapshot capture changed the canonical cash reconciliation.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'snapshot_capture_does_not_change_accounting_totals', true,
    '{}'::JSONB
  );

END;
$$;

-- Flush the deferred close guard before temporarily recreating a pre-094 row.
-- This is a test-only construction; production migrations never backfill it.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.cash_shifts DISABLE TRIGGER USER;
INSERT INTO public.cash_shifts (
  id, shift_number, branch_id, opened_by, closed_by, opened_at, closed_at,
  opening_cash_in_minor_units, expected_cash_in_minor_units,
  actual_cash_in_minor_units, cash_discrepancy_in_minor_units, status
) VALUES (
  '94000000-0000-0000-0000-000000000011',
  'SHIFT-LEGACY-SNAPSHOT-RUNTIME',
  '94000000-0000-0000-0000-000000000010',
  '94000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  NOW() - INTERVAL '2 days', NOW() - INTERVAL '40 hours',
  0, 0, 0, 0, 'closed'
);
ALTER TABLE public.cash_shifts ENABLE TRIGGER USER;

DO $$
DECLARE
  v_legacy_shift UUID := '94000000-0000-0000-0000-000000000011';
  v_legacy_backfill_blocked BOOLEAN := false;
BEGIN
  IF public.get_cash_shift_closing_report(v_legacy_shift)->>'snapshotStatus'
    <> 'legacy_recalculated'
  THEN
    RAISE EXCEPTION 'Legacy closed shift did not safely use recalculated report fallback.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'legacy_closed_shift_keeps_recalculated_report', true,
    '{}'::JSONB
  );

  BEGIN
    UPDATE public.cash_shifts
    SET closing_report_snapshot = jsonb_build_object('fabricated', true),
        closing_report_snapshotted_at = NOW(),
        closing_report_snapshot_version = 1
    WHERE id = v_legacy_shift;
  EXCEPTION WHEN OTHERS THEN
    v_legacy_backfill_blocked := true;
  END;
  IF NOT v_legacy_backfill_blocked THEN
    RAISE EXCEPTION 'Legacy closed shift accepted a fabricated snapshot.';
  END IF;
  INSERT INTO closing_snapshot_results VALUES (
    'database_rejects_legacy_snapshot_backfill', true,
    '{}'::JSONB
  );
END;
$$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'snapshot_bytes', max((details->>'snapshot_bytes')::INTEGER),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS closing_report_snapshot_runtime_summary
FROM closing_snapshot_results;

ROLLBACK;
