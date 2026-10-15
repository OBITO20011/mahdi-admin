-- Actual pg_net queue is inspected BEFORE rollback. pg_net dispatches only
-- after commit; this entire probe rolls back,so no external request is sent.
BEGIN;
-- Session owner is the disposable extension owner; all application probes run
-- as postgres, exactly like the migration. No GRANT is added to any role.
SET LOCAL ROLE postgres;
SET LOCAL search_path=public,pg_temp;
CREATE TEMP TABLE push139_results(name text PRIMARY KEY,passed boolean);
DO $probe$
DECLARE queued bigint;payload jsonb:='{"type":"test","eventKey":"139-runtime"}';
 original_queue bigint;oid_missing uuid;oid_configured uuid;oid_failure uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE name='order_push_webhook_url') THEN
  RAISE EXCEPTION 'URL must be absent after migration';
 END IF;
 SELECT count(*) INTO original_queue FROM net.http_request_queue;
 BEGIN
  PERFORM public.enqueue_order_push_webhook(payload);
  RAISE EXCEPTION 'Missing URL was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'رابط إشعارات الطلبات غير مهيأ.' THEN RAISE;END IF;
 END;
 INSERT INTO public.orders(order_number,source,status) VALUES('P139-NO-URL','website','new') RETURNING id INTO oid_missing;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=oid_missing) OR
  (SELECT count(*) FROM net.http_request_queue)<>original_queue THEN RAISE EXCEPTION 'Missing URL sent or blocked order';END IF;
 INSERT INTO push139_results VALUES('missing_url_no_send_order_survives',true);
 PERFORM vault.create_secret('   ','order_push_webhook_url');
 INSERT INTO public.orders(order_number,source,status) VALUES('P139-BLANK-URL','website','new');
 IF (SELECT count(*) FROM net.http_request_queue)<>original_queue THEN RAISE EXCEPTION 'Blank URL queued';END IF;
 DELETE FROM vault.secrets WHERE name='order_push_webhook_url';
 INSERT INTO push139_results VALUES('blank_url_no_send',true);
 PERFORM vault.create_secret('http://127.0.0.1:9/139-proof-only','order_push_webhook_url');
 queued:=public.enqueue_order_push_webhook(payload);
 IF NOT EXISTS(SELECT 1 FROM net.http_request_queue q WHERE id=queued
  AND url='http://127.0.0.1:9/139-proof-only' AND method='POST'
  AND convert_from(body,'UTF8')::jsonb=payload AND timeout_milliseconds=5000
  AND headers=jsonb_build_object('Content-Type','application/json','x-order-push-secret',
   (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='order_push_webhook_secret' ORDER BY created_at DESC LIMIT 1)))
 THEN RAISE EXCEPTION 'Configured URL/payload/headers/timeout mismatch';END IF;
 INSERT INTO push139_results VALUES('configured_url_exact_payload_headers_timeout',true);
 INSERT INTO public.orders(order_number,source,status) VALUES('P139-URL','website','new') RETURNING id INTO oid_configured;
 IF NOT EXISTS(SELECT 1 FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb=
  jsonb_build_object('type','new_order','orderId',oid_configured,'eventKey','new_order:'||oid_configured::text))
 THEN RAISE EXCEPTION 'Trigger payload changed';END IF;
 INSERT INTO push139_results VALUES('configured_url_trigger_payload_unchanged',true);
 DELETE FROM vault.secrets WHERE name='order_push_webhook_secret';
 SELECT count(*) INTO original_queue FROM net.http_request_queue;
 INSERT INTO public.orders(order_number,source,status) VALUES('P139-NO-SECRET','website','new') RETURNING id INTO oid_failure;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE id=oid_failure) OR
  (SELECT count(*) FROM net.http_request_queue)<>original_queue THEN RAISE EXCEPTION 'Missing secret sent or blocked order';END IF;
 INSERT INTO push139_results VALUES('missing_secret_behavior_unchanged',true);
END $probe$;
-- Synchronous transport failure is swallowed by the ORIGINAL trigger too.
RESET ROLE;
CREATE OR REPLACE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}'::jsonb,
 params jsonb DEFAULT '{}'::jsonb,headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb,
 timeout_milliseconds integer DEFAULT 1000) RETURNS bigint LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION '139_SYNCHRONOUS_TRANSPORT_PROBE';END $$;
SET LOCAL ROLE postgres;
DO $probe$
DECLARE prior bigint;
BEGIN
 PERFORM vault.create_secret('runtime-fixture-not-a-real-secret','order_push_webhook_secret');
 SELECT count(*) INTO prior FROM net.http_request_queue;
 INSERT INTO public.orders(order_number,source,status) VALUES('P139-TRANSPORT-FAIL','website','new');
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE order_number='P139-TRANSPORT-FAIL') OR
  (SELECT count(*) FROM net.http_request_queue)<>prior THEN RAISE EXCEPTION 'Transport failure blocked order';END IF;
 INSERT INTO push139_results VALUES('synchronous_transport_error_order_survives',true);
END $probe$;
SELECT jsonb_agg(to_jsonb(r) ORDER BY name) FROM push139_results r;
ROLLBACK;
