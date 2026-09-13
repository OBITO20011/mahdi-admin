-- Migration 110 focused runtime verification. This must run only against a
-- disposable isolated Supabase database.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE shift_close_security_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := '11000000-0000-0000-0000-000000000001';
  v_owner_role UUID;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated', 'shift-close-runtime@example.test',
    NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (v_owner, 'Shift Close Runtime Owner', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar)
  VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_owner, v_owner_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES
    ('11000000-0000-0000-0000-000000000010', 'SHIFT-CLOSE-RUNTIME', 'Shift Close Runtime', true),
    ('11000000-0000-0000-0000-000000000011', 'SHIFT-CLOSE-ROLLBACK', 'Shift Close Rollback', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.cash_shifts (
    id, shift_number, branch_id, opened_by, opened_at,
    opening_cash_in_minor_units, expected_cash_in_minor_units, status
  ) VALUES
    (
      '11000000-0000-0000-0000-000000000020', 'SHIFT-CLOSE-SUCCESS',
      '11000000-0000-0000-0000-000000000010', v_owner, NOW(), 1000, 1000, 'open'
    ),
    (
      '11000000-0000-0000-0000-000000000021', 'SHIFT-CLOSE-ROLLBACK',
      '11000000-0000-0000-0000-000000000011', v_owner, NOW(), 2000, 2000, 'open'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.test_block_shift_snapshot_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.closing_report_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'test-only snapshot write failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.test_try_close_cash_shift(
  p_shift_id UUID,
  p_actual BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.close_cash_shift(p_shift_id, p_actual, NULL);
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

CREATE TRIGGER test_block_shift_snapshot_write
BEFORE UPDATE OF closing_report_snapshot ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.test_block_shift_snapshot_write();

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'aal', 'aal2'
  )::TEXT,
  true
);
SET LOCAL ROLE authenticated;
SELECT public.test_try_close_cash_shift(
  '11000000-0000-0000-0000-000000000021',
  2000
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_shifts
    WHERE id = '11000000-0000-0000-0000-000000000021'
      AND status = 'open'
      AND closing_report_snapshot IS NULL
      AND closed_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE entity_name = 'cash_shifts'
      AND entity_id = '11000000-0000-0000-0000-000000000021'
      AND action = 'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT'
  ) THEN
    RAISE EXCEPTION 'A failed snapshot did not roll back the entire close.';
  END IF;

  INSERT INTO shift_close_security_results VALUES (
    'failed_snapshot_rolls_back_entire_close',
    true,
    jsonb_build_object('shift_status', 'open', 'snapshot_count', 0)
  );
END;
$$;

DROP TRIGGER test_block_shift_snapshot_write ON public.cash_shifts;

SET LOCAL ROLE authenticated;
SELECT public.close_cash_shift(
  '11000000-0000-0000-0000-000000000020',
  1000,
  NULL
);
RESET ROLE;

DO $$
DECLARE
  v_snapshot JSONB;
  v_snapshot_count BIGINT;
BEGIN
  SELECT closing_report_snapshot
  INTO v_snapshot
  FROM public.cash_shifts
  WHERE id = '11000000-0000-0000-0000-000000000020'
    AND status = 'closed'
    AND closing_report_snapshotted_at IS NOT NULL
    AND closing_report_snapshot_version = 1;

  SELECT count(*) INTO v_snapshot_count
  FROM public.audit_logs
  WHERE entity_name = 'cash_shifts'
    AND entity_id = '11000000-0000-0000-0000-000000000020'
    AND action = 'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT';

  IF v_snapshot IS NULL
    OR v_snapshot->>'snapshotStatus' <> 'immutable'
    OR v_snapshot_count <> 1
  THEN
    RAISE EXCEPTION 'Authenticated close did not capture the snapshot exactly once.';
  END IF;

  INSERT INTO shift_close_security_results VALUES (
    'authenticated_close_snapshot_exactly_once',
    true,
    jsonb_build_object('shift_status', 'closed', 'snapshot_count', 1)
  );
END;
$$;

SET LOCAL ROLE authenticated;
SELECT public.test_try_close_cash_shift(
  '11000000-0000-0000-0000-000000000020',
  1000
);
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs
      WHERE entity_name = 'cash_shifts'
        AND entity_id = '11000000-0000-0000-0000-000000000020'
        AND action = 'CAPTURE_CASH_SHIFT_CLOSING_REPORT_SNAPSHOT') <> 1
  THEN
    RAISE EXCEPTION 'A rejected second close duplicated the snapshot audit record.';
  END IF;

  INSERT INTO shift_close_security_results VALUES (
    'second_close_is_rejected_without_duplicate_snapshot',
    true,
    jsonb_build_object('snapshot_count', 1)
  );
END;
$$;

DO $$
DECLARE
  v_owner TEXT;
  v_security_definer BOOLEAN;
  v_search_path TEXT;
  v_public_execute BOOLEAN;
  v_anon_execute BOOLEAN;
  v_authenticated_execute BOOLEAN;
BEGIN
  SELECT pg_get_userbyid(proowner), prosecdef, array_to_string(proconfig, ',')
  INTO v_owner, v_security_definer, v_search_path
  FROM pg_proc
  WHERE oid = 'public.assert_closed_cash_shift_has_snapshot()'::regprocedure;

  SELECT EXISTS (
           SELECT 1
           FROM pg_proc p,
                LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
           WHERE p.oid = 'public.assert_closed_cash_shift_has_snapshot()'::regprocedure
             AND acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
         ),
         has_function_privilege('anon', 'public.assert_closed_cash_shift_has_snapshot()', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.assert_closed_cash_shift_has_snapshot()', 'EXECUTE')
  INTO v_public_execute, v_anon_execute, v_authenticated_execute;

  IF v_owner <> 'postgres'
    OR NOT v_security_definer
    OR v_search_path NOT LIKE '%search_path=public, pg_temp%'
    OR v_public_execute
    OR v_anon_execute
    OR v_authenticated_execute
  THEN
    RAISE EXCEPTION 'Migration 110 function security metadata is incorrect.';
  END IF;

  INSERT INTO shift_close_security_results VALUES (
    'guard_security_metadata_is_restricted',
    true,
    jsonb_build_object(
      'owner', v_owner,
      'security_definer', v_security_definer,
      'direct_execute_revoked', true
    )
  );
END;
$$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS shift_close_security_runtime_summary
FROM shift_close_security_results;

ROLLBACK;
