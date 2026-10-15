CREATE OR REPLACE FUNCTION public.enqueue_order_push_webhook(p_payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'net', 'pg_temp'
AS $function$
DECLARE
  v_secret TEXT;
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

  SELECT net.http_post(
    url := 'https://acjtabdqqnpwhdvbvnyw.supabase.co/functions/v1/send-order-push',
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
$function$
