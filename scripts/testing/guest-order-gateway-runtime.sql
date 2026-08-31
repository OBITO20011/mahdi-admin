-- Runtime security and throttling verification for migration 086.
-- Runs only inside the disposable isolated Supabase project.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_result JSONB;
  v_second JSONB;
  v_index INTEGER;
  v_denied BOOLEAN := false;
  v_hash TEXT;
  v_orders_before BIGINT;
  v_customers_before BIGINT;
  v_inventory_before NUMERIC;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Direct guest order RPC remains browser executable.';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.authorize_guest_order_gateway(uuid,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.authorize_guest_order_gateway(uuid,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Gateway authorization is exposed to a browser role.';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.authorize_guest_order_gateway(uuid,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.finalize_guest_order_gateway(uuid,text,uuid)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The service-only gateway chain is incomplete.';
  END IF;

  IF has_table_privilege('anon', 'public.guest_order_gateway_requests', 'SELECT')
    OR has_table_privilege('authenticated', 'public.guest_order_gateway_requests', 'SELECT')
    OR has_table_privilege('anon', 'public.guest_order_gateway_requests', 'INSERT')
    OR has_table_privilege('authenticated', 'public.guest_order_gateway_requests', 'INSERT')
  THEN
    RAISE EXCEPTION 'Gateway audit rows are exposed to a browser role.';
  END IF;

  TRUNCATE public.guest_order_gateway_requests;
  SELECT COUNT(*) INTO v_orders_before FROM public.orders;
  SELECT COUNT(*) INTO v_customers_before FROM public.customers;
  SELECT COALESCE(SUM(on_hand_quantity + reserved_quantity), 0)
  INTO v_inventory_before
  FROM public.inventory_balances;

  -- Same operation and same context is a safe decision replay.
  v_result := public.authorize_guest_order_gateway(
    '86000000-0000-4000-8000-000000000001', repeat('1', 64), repeat('2', 64), repeat('3', 64)
  );
  v_second := public.authorize_guest_order_gateway(
    '86000000-0000-4000-8000-000000000001', repeat('1', 64), repeat('2', 64), repeat('3', 64)
  );
  IF NOT (v_result->>'allowed')::BOOLEAN
    OR NOT (v_second->>'allowed')::BOOLEAN
    OR NOT (v_second->>'idempotent_replay')::BOOLEAN
  THEN
    RAISE EXCEPTION 'Idempotent gateway replay failed.';
  END IF;

  BEGIN
    PERFORM public.authorize_guest_order_gateway(
      '86000000-0000-4000-8000-000000000001', repeat('4', 64), repeat('2', 64), repeat('3', 64)
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Idempotency context mismatch was accepted.';
  END IF;

  -- Three requests/phone/10 minutes are allowed; the fourth is denied.
  TRUNCATE public.guest_order_gateway_requests;
  FOR v_index IN 1..4 LOOP
    v_result := public.authorize_guest_order_gateway(
      ('86000000-0000-4000-8100-' || LPAD(v_index::TEXT, 12, '0'))::UUID,
      md5('phone-ip-' || v_index) || md5('phone-ip-x-' || v_index),
      md5('phone-session-' || v_index) || md5('phone-session-x-' || v_index),
      repeat('a', 64)
    );
    IF ((v_index <= 3) IS DISTINCT FROM (v_result->>'allowed')::BOOLEAN) THEN
      RAISE EXCEPTION 'Phone limiter failed at request %: %', v_index, v_result;
    END IF;
  END LOOP;

  -- A rate-limited business operation can retry with the same idempotency key
  -- after the applicable window without weakening successful replay safety.
  UPDATE public.guest_order_gateway_requests
  SET created_at = NOW() - INTERVAL '11 minutes'
  WHERE idempotency_key = '86000000-0000-4000-8100-000000000004'::UUID;
  UPDATE public.guest_order_gateway_requests
  SET created_at = NOW() - INTERVAL '11 minutes'
  WHERE phone_hash = repeat('a', 64);
  v_result := public.authorize_guest_order_gateway(
    '86000000-0000-4000-8100-000000000004',
    md5('phone-ip-4') || md5('phone-ip-x-4'),
    md5('phone-session-4') || md5('phone-session-x-4'),
    repeat('a', 64)
  );
  IF NOT (v_result->>'allowed')::BOOLEAN THEN
    RAISE EXCEPTION 'Expired rate-limit decision did not permit a safe retry: %', v_result;
  END IF;

  -- Four requests/session/10 minutes are allowed; the fifth is denied.
  TRUNCATE public.guest_order_gateway_requests;
  FOR v_index IN 1..5 LOOP
    v_result := public.authorize_guest_order_gateway(
      ('86000000-0000-4000-8200-' || LPAD(v_index::TEXT, 12, '0'))::UUID,
      md5('session-ip-' || v_index) || md5('session-ip-x-' || v_index),
      repeat('b', 64),
      md5('session-phone-' || v_index) || md5('session-phone-x-' || v_index)
    );
    IF ((v_index <= 4) IS DISTINCT FROM (v_result->>'allowed')::BOOLEAN) THEN
      RAISE EXCEPTION 'Session limiter failed at request %: %', v_index, v_result;
    END IF;
  END LOOP;

  -- Six requests/IP/minute are allowed; the seventh is denied.
  TRUNCATE public.guest_order_gateway_requests;
  FOR v_index IN 1..7 LOOP
    v_result := public.authorize_guest_order_gateway(
      ('86000000-0000-4000-8300-' || LPAD(v_index::TEXT, 12, '0'))::UUID,
      repeat('c', 64),
      md5('burst-session-' || v_index) || md5('burst-session-x-' || v_index),
      md5('burst-phone-' || v_index) || md5('burst-phone-x-' || v_index)
    );
    IF ((v_index <= 6) IS DISTINCT FROM (v_result->>'allowed')::BOOLEAN) THEN
      RAISE EXCEPTION 'IP burst limiter failed at request %: %', v_index, v_result;
    END IF;
  END LOOP;

  -- Twenty requests/IP/15 minutes are allowed when separated outside the
  -- one-minute burst; the twenty-first is denied.
  TRUNCATE public.guest_order_gateway_requests;
  v_hash := repeat('d', 64);
  FOR v_index IN 1..21 LOOP
    v_result := public.authorize_guest_order_gateway(
      ('86000000-0000-4000-8400-' || LPAD(v_index::TEXT, 12, '0'))::UUID,
      v_hash,
      md5('short-session-' || v_index) || md5('short-session-x-' || v_index),
      md5('short-phone-' || v_index) || md5('short-phone-x-' || v_index)
    );
    IF ((v_index <= 20) IS DISTINCT FROM (v_result->>'allowed')::BOOLEAN) THEN
      RAISE EXCEPTION 'IP short-window limiter failed at request %: %', v_index, v_result;
    END IF;
    IF v_index <= 20 THEN
      UPDATE public.guest_order_gateway_requests
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE idempotency_key = ('86000000-0000-4000-8400-' || LPAD(v_index::TEXT, 12, '0'))::UUID;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.guest_order_gateway_requests
    WHERE ip_hash !~ '^[0-9a-f]{64}$'
       OR session_hash !~ '^[0-9a-f]{64}$'
       OR phone_hash !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'A gateway identifier was not pseudonymized.';
  END IF;

  IF (SELECT COUNT(*) FROM public.orders) IS DISTINCT FROM v_orders_before
    OR (SELECT COUNT(*) FROM public.customers) IS DISTINCT FROM v_customers_before
    OR (SELECT COALESCE(SUM(on_hand_quantity + reserved_quantity), 0)
        FROM public.inventory_balances) IS DISTINCT FROM v_inventory_before
  THEN
    RAISE EXCEPTION 'Rejected gateway traffic changed business data or inventory.';
  END IF;
END $$;

SELECT jsonb_build_object(
  'runtime_scenarios', 8,
  'passed', 8,
  'unexpected_failures', 0,
  'direct_rpc_anon', has_function_privilege(
    'anon',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  'direct_rpc_authenticated', has_function_privilege(
    'authenticated',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  'gateway_anon', has_function_privilege(
    'anon', 'public.authorize_guest_order_gateway(uuid,text,text,text)', 'EXECUTE'
  ),
  'gateway_authenticated', has_function_privilege(
    'authenticated', 'public.authorize_guest_order_gateway(uuid,text,text,text)', 'EXECUTE'
  ),
  'gateway_service_role', has_function_privilege(
    'service_role', 'public.authorize_guest_order_gateway(uuid,text,text,text)', 'EXECUTE'
  ),
  'audit_table_anon_select', has_table_privilege(
    'anon', 'public.guest_order_gateway_requests', 'SELECT'
  ),
  'audit_table_authenticated_select', has_table_privilege(
    'authenticated', 'public.guest_order_gateway_requests', 'SELECT'
  )
);

ROLLBACK;
