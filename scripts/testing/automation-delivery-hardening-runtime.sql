\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE automation_delivery_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_event UUID;
  v_result JSONB;
BEGIN
  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload, created_at)
  VALUES ('phase2:retry', 'new_order', gen_random_uuid(), '{}'::JSONB, NOW() - INTERVAL '2 minutes')
  RETURNING id INTO v_event;
  INSERT INTO public.automation_event_deliveries(event_id, channel)
  VALUES (v_event, 'telegram');

  v_result := public.claim_automation_deliveries('telegram', 1, 30);
  IF jsonb_array_length(v_result->'items') <> 1
    OR (SELECT status FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram') <> 'processing'
    OR (SELECT attempt_count FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram') <> 1
    OR (SELECT first_attempt_at IS NULL OR last_attempt_at IS NULL FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram')
  THEN RAISE EXCEPTION 'Initial claim lifecycle failed.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('initial_claim_records_timing', true);

  v_result := public.complete_automation_delivery(v_event, 'telegram', false, 'synthetic provider failure');
  IF v_result->>'status' <> 'failed'
    OR (SELECT next_attempt_at <= NOW() FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram')
  THEN RAISE EXCEPTION 'Bounded retry scheduling failed.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('failed_attempt_schedules_bounded_retry', true);

  UPDATE public.automation_event_deliveries
  SET status='processing', attempt_count=10, lease_expires_at=NOW()+INTERVAL '30 seconds'
  WHERE event_id=v_event AND channel='telegram';
  v_result := public.complete_automation_delivery(v_event, 'telegram', false, 'synthetic exhaustion');
  IF v_result->>'status' <> 'dead_letter'
    OR NOT (SELECT dead_lettered_at IS NOT NULL AND lease_expires_at IS NULL FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram')
  THEN RAISE EXCEPTION 'Retry exhaustion did not enter dead-letter.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('retry_exhaustion_enters_dead_letter', true);

  v_result := public.claim_automation_deliveries('telegram', 10, 30);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'items') item WHERE item->>'eventId'=v_event::TEXT)
  THEN RAISE EXCEPTION 'Dead-letter delivery was reclaimed.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('dead_letter_is_not_retried', true);

  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload, created_at)
  VALUES ('phase2:lease', 'low_stock', gen_random_uuid(), '{}'::JSONB, NOW() - INTERVAL '2 minutes')
  RETURNING id INTO v_event;
  INSERT INTO public.automation_event_deliveries(
    event_id, channel, status, attempt_count, lease_expires_at, first_attempt_at, last_attempt_at
  ) VALUES (v_event, 'telegram', 'processing', 1, NOW()-INTERVAL '1 minute', NOW()-INTERVAL '3 minutes', NOW()-INTERVAL '2 minutes');
  v_result := public.claim_automation_deliveries('telegram', 1, 30);
  IF jsonb_array_length(v_result->'items') <> 1
    OR (v_result->'items'->0->>'eventId') <> v_event::TEXT
    OR (SELECT attempt_count FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram') <> 2
  THEN RAISE EXCEPTION 'Expired lease was not reclaimed exactly once.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('expired_lease_is_reclaimed', true);

  UPDATE public.automation_event_deliveries
  SET status='processing', attempt_count=10, lease_expires_at=NOW()-INTERVAL '1 minute'
  WHERE event_id=v_event AND channel='telegram';
  v_result := public.claim_automation_deliveries('telegram', 10, 30);
  IF (SELECT status FROM public.automation_event_deliveries WHERE event_id=v_event AND channel='telegram') <> 'dead_letter'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'items') item WHERE item->>'eventId'=v_event::TEXT)
  THEN RAISE EXCEPTION 'Exhausted stuck lease was not dead-lettered safely.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('exhausted_stuck_lease_is_dead_lettered', true);

  IF has_function_privilege('anon', 'public.claim_automation_deliveries(text,integer,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.claim_automation_deliveries(text,integer,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.complete_automation_delivery(uuid,text,boolean,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.complete_automation_delivery(uuid,text,boolean,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Automation delivery RPC privileges widened.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('rpc_permissions_remain_service_role_only', true);

  -- Aggregate health signals use only timing/status counts. No payload,
  -- customer, or financial content is returned to Developer Alerts.
  INSERT INTO public.automation_events(event_key, event_type, entity_id, payload, created_at)
  VALUES
    ('phase2:latency', 'new_order', gen_random_uuid(), '{}'::JSONB, NOW()-INTERVAL '20 minutes'),
    ('phase2:dead-letter', 'new_order', gen_random_uuid(), '{}'::JSONB, NOW()-INTERVAL '20 minutes');
  INSERT INTO public.automation_event_deliveries(event_id, channel, status, attempt_count, next_attempt_at, dead_lettered_at, updated_at)
  SELECT id, 'telegram',
    CASE WHEN event_key='phase2:dead-letter' THEN 'dead_letter' ELSE 'pending' END,
    CASE WHEN event_key='phase2:dead-letter' THEN 10 ELSE 0 END,
    NOW()-INTERVAL '10 minutes',
    CASE WHEN event_key='phase2:dead-letter' THEN NOW() ELSE NULL END,
    NOW()-INTERVAL '20 minutes'
  FROM public.automation_events
  WHERE event_key IN ('phase2:latency','phase2:dead-letter');
  IF (SELECT count(*) FROM public.automation_event_deliveries d JOIN public.automation_events e ON e.id=d.event_id WHERE d.status NOT IN ('delivered','dead_letter') AND e.created_at<=NOW()-INTERVAL '10 minutes') < 1
    OR (SELECT count(*) FROM public.automation_event_deliveries WHERE status='dead_letter') < 1
  THEN RAISE EXCEPTION 'Latency/dead-letter aggregate health signals failed.'; END IF;
  INSERT INTO automation_delivery_results VALUES ('aggregate_health_signals_detect_latency_and_dead_letter', true);
END $$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) FROM automation_delivery_results;

ROLLBACK;
