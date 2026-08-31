-- Runtime verification for Migration 092. This script is only executed
-- against the disposable isolated Supabase database.
\set ON_ERROR_STOP on

BEGIN;

-- The isolated database can be reused by another gateway test.  This fixture
-- owns the audit table only inside its disposable transaction, so establish a
-- deterministic baseline without affecting any production path.
TRUNCATE public.guest_order_gateway_requests;

CREATE TEMP TABLE rate_limit_cleanup_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_result JSONB;
  v_remaining INTEGER;
  v_deleted INTEGER;
BEGIN
  -- Exact identifiers are HMAC-shaped but synthetic; no raw PII appears in
  -- this test data. Two current rows prove all live rate-limit windows remain.
  INSERT INTO public.guest_order_gateway_requests(
    idempotency_key, ip_hash, session_hash, phone_hash, decision, reason,
    outcome, created_at
  ) VALUES
    ('92000000-0000-0000-0000-000000000001', repeat('a', 64), repeat('b', 64), repeat('c', 64), 'allowed', 'allowed', 'succeeded', NOW() - INTERVAL '47 hours 59 minutes'),
    ('92000000-0000-0000-0000-000000000002', repeat('d', 64), repeat('e', 64), repeat('f', 64), 'rate_limited', 'ip_short_window', 'rate_limited', NOW() - INTERVAL '15 minutes'),
    ('92000000-0000-0000-0000-000000000003', repeat('1', 64), repeat('2', 64), repeat('3', 64), 'allowed', 'allowed', 'pending', NOW() - INTERVAL '1 minute');

  -- 501 rows are stale: the first run must be bounded to 500 and leave one
  -- for the retry, without touching the two current rows above.
  INSERT INTO public.guest_order_gateway_requests(
    idempotency_key, ip_hash, session_hash, phone_hash, decision, reason,
    outcome, created_at
  )
  SELECT
    ('92000000-0000-0000-0000-' || lpad(n::TEXT, 12, '0'))::UUID,
    lpad(to_hex(n), 64, '0'), lpad(to_hex(n + 1000), 64, '0'), lpad(to_hex(n + 2000), 64, '0'),
    'rate_limited', 'phone_short_window', 'rate_limited', NOW() - INTERVAL '48 hours 1 minute'
  FROM generate_series(10, 510) AS n;

  v_result := public.cleanup_guest_order_gateway_requests(500);
  v_deleted := (v_result->>'deleted_count')::INTEGER;
  SELECT count(*) INTO v_remaining FROM public.guest_order_gateway_requests;
  IF v_deleted <> 500 OR v_remaining <> 4
    OR NOT EXISTS (SELECT 1 FROM public.guest_order_gateway_requests WHERE idempotency_key = '92000000-0000-0000-0000-000000000001')
    OR NOT EXISTS (SELECT 1 FROM public.guest_order_gateway_requests WHERE idempotency_key = '92000000-0000-0000-0000-000000000002')
    OR NOT EXISTS (SELECT 1 FROM public.guest_order_gateway_requests WHERE idempotency_key = '92000000-0000-0000-0000-000000000003')
  THEN
    RAISE EXCEPTION 'Bounded cleanup removed a protected row or did not delete exactly 500.';
  END IF;
  INSERT INTO rate_limit_cleanup_results VALUES ('bounded_cleanup_preserves_48h_margin_and_live_windows', true, v_result);

  v_result := public.cleanup_guest_order_gateway_requests(500);
  IF (v_result->>'deleted_count')::INTEGER <> 1
    OR (SELECT count(*) FROM public.guest_order_gateway_requests) <> 3
  THEN
    RAISE EXCEPTION 'Cleanup retry was not an exact safe continuation.';
  END IF;
  INSERT INTO rate_limit_cleanup_results VALUES ('retry_completes_remaining_stale_row_once', true, v_result);

  v_result := public.cleanup_guest_order_gateway_requests(500);
  IF (v_result->>'deleted_count')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'Cleanup no-op retry deleted current records.';
  END IF;
  INSERT INTO rate_limit_cleanup_results VALUES ('idempotent_noop_after_cleanup', true, v_result);

  IF has_function_privilege('anon', 'public.cleanup_guest_order_gateway_requests(integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.cleanup_guest_order_gateway_requests(integer)', 'EXECUTE')
    OR (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-guest-order-gateway-requests' AND schedule = '2,17,32,47 * * * *') <> 1
  THEN
    RAISE EXCEPTION 'Cleanup function privilege or cron schedule is unsafe.';
  END IF;
  INSERT INTO rate_limit_cleanup_results VALUES ('function_is_private_and_cron_is_scheduled_once', true, '{}'::JSONB);
END $$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario),
  'rows_before', 504,
  'rows_after', (SELECT count(*) FROM public.guest_order_gateway_requests)
) AS rate_limit_cleanup_runtime_summary
FROM rate_limit_cleanup_results;

ROLLBACK;
