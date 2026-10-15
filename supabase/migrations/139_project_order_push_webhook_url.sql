-- Per-project URL, deliberately unset until the owner activates notifications.
-- No secret values, endpoint defaults, trigger or scheduler changes here.
BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_order_push_webhook(
  p_payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_secret TEXT;
  v_url TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'order_push_webhook_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NULLIF(v_secret, '') IS NULL THEN
    RAISE EXCEPTION 'سر إشعارات الطلبات غير مهيأ.';
  END IF;

  SELECT decrypted_secret
  INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'order_push_webhook_url'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NULLIF(TRIM(v_url), '') IS NULL THEN
    RAISE EXCEPTION 'رابط إشعارات الطلبات غير مهيأ.';
  END IF;

  SELECT net.http_post(
    url := v_url,
    body := p_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-order-push-secret', v_secret
    ),
    timeout_milliseconds := 5000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

ALTER FUNCTION public.enqueue_order_push_webhook(JSONB) OWNER TO postgres;
-- Existing effective ACL is postgres only; no new service-role grant.
REVOKE ALL ON FUNCTION public.enqueue_order_push_webhook(JSONB)
  FROM PUBLIC, anon, authenticated;

COMMIT;
