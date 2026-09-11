-- Runtime access-contract coverage for migration 106.
-- Run only in the disposable isolated Supabase database.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_owner UUID := '86000000-0000-0000-0000-000000000001';
  v_staff UUID := '86000000-0000-0000-0000-000000000002';
  v_owner_role UUID;
  v_staff_role UUID;
  v_dashboard JSONB;
  v_denied BOOLEAN;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_owner, 'authenticated', 'authenticated', 'monitoring-owner@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()),
    (v_staff, 'authenticated', 'authenticated', 'monitoring-staff@example.test', NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active) VALUES
    (v_owner, 'Monitoring Owner', true),
    (v_staff, 'Monitoring Staff', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar) VALUES
    ('owner', 'مالك النظام'),
    ('view_only', 'مشاهدة فقط')
  ON CONFLICT (code) DO NOTHING;

  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  SELECT id INTO v_staff_role FROM public.roles WHERE code = 'view_only';

  INSERT INTO public.user_roles (user_id, role_id) VALUES
    (v_owner, v_owner_role),
    (v_staff, v_staff_role)
  ON CONFLICT DO NOTHING;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::TEXT,
    true
  );
  v_dashboard := public.get_advanced_monitoring_dashboard();
  IF v_dashboard->>'overallStatus' IS NULL
     OR NOT (v_dashboard ? 'counts')
     OR NOT (v_dashboard ? 'lastScanAt')
     OR jsonb_typeof(v_dashboard->'checks') <> 'array'
  THEN
    RAISE EXCEPTION 'Owner without an enrolled factor did not receive the monitoring contract.';
  END IF;

  INSERT INTO auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status,
    created_at, updated_at, secret
  ) VALUES (
    '86000000-0000-0000-0000-000000000010',
    v_owner,
    'Runtime TOTP',
    'totp',
    'verified',
    NOW(),
    NOW(),
    'runtime-test-secret'
  );

  v_denied := false;
  BEGIN
    PERFORM public.get_advanced_monitoring_dashboard();
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Owner with a verified factor was not denied at AAL1.';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  v_dashboard := public.get_advanced_monitoring_dashboard();
  IF v_dashboard->>'overallStatus' IS NULL THEN
    RAISE EXCEPTION 'Owner with a verified factor was not allowed at AAL2.';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'aal', 'aal2')::TEXT,
    true
  );
  v_denied := false;
  BEGIN
    PERFORM public.get_advanced_monitoring_dashboard();
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'A non-owner role received technical monitoring data.';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"anon","aal":"aal1"}', true);
  v_denied := false;
  BEGIN
    PERFORM public.get_advanced_monitoring_dashboard();
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied OR has_function_privilege('anon', 'public.get_advanced_monitoring_dashboard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous monitoring access did not fail closed.';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_advanced_monitoring_dashboard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.assert_monitoring_owner()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Monitoring execute privileges do not match the intended boundary.';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'ok', true,
  'runtime_scenarios', 5,
  'owner_without_factor_aal1', 'allowed',
  'owner_with_factor_aal1', 'denied',
  'owner_with_factor_aal2', 'allowed',
  'non_owner', 'denied',
  'anon', 'denied'
);

ROLLBACK;
