-- =========================================================================
-- Nawasrah ERP - Migration 033
-- Secure Web Push subscriptions and asynchronous new-order notifications.
--
-- Inventory, pricing and order creation remain owned by the existing RPCs.
-- This migration only observes a committed website order and queues a
-- non-blocking pg_net request to a secret-verified Edge Function.
-- =========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL CHECK (
    endpoint ~ '^https://'
    AND CHAR_LENGTH(endpoint) <= 2048
  ),
  p256dh TEXT NOT NULL CHECK (CHAR_LENGTH(p256dh) BETWEEN 20 AND 512),
  auth_key TEXT NOT NULL CHECK (CHAR_LENGTH(auth_key) BETWEEN 8 AND 512),
  user_agent TEXT,
  device_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active_user
  ON public.push_subscriptions(user_id, is_active)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.push_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('new_order', 'test')),
  entity_id UUID,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'sent', 'partial', 'failed')
  ),
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Require active ERP staff membership"
  ON public.push_subscriptions;
CREATE POLICY "Require active ERP staff membership"
  ON public.push_subscriptions
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_active_erp_staff()))
  WITH CHECK ((SELECT public.is_active_erp_staff()));

DROP POLICY IF EXISTS "Deny client access to push dispatches"
  ON public.push_dispatches;
CREATE POLICY "Deny client access to push dispatches"
  ON public.push_dispatches
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE ALL ON TABLE public.push_subscriptions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_dispatches
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_dispatches
  TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'order_push_webhook_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'order_push_webhook_secret',
      'Authenticates PostgreSQL order webhooks to send-order-push.'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth_key TEXT,
  p_user_agent TEXT DEFAULT NULL,
  p_device_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_subscription_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'orders'],
    'تفعيل إشعارات الطلبات'
  );

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتفعيل الإشعارات.';
  END IF;

  IF NULLIF(TRIM(p_endpoint), '') IS NULL
    OR TRIM(p_endpoint) !~ '^https://'
    OR CHAR_LENGTH(TRIM(p_endpoint)) > 2048
    OR CHAR_LENGTH(COALESCE(TRIM(p_p256dh), '')) NOT BETWEEN 20 AND 512
    OR CHAR_LENGTH(COALESCE(TRIM(p_auth_key), '')) NOT BETWEEN 8 AND 512
  THEN
    RAISE EXCEPTION 'بيانات اشتراك الإشعارات غير صحيحة.';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    device_label,
    is_active,
    failure_count,
    last_failure_message,
    updated_at
  ) VALUES (
    v_user_id,
    TRIM(p_endpoint),
    TRIM(p_p256dh),
    TRIM(p_auth_key),
    LEFT(NULLIF(TRIM(p_user_agent), ''), 1000),
    LEFT(NULLIF(TRIM(p_device_label), ''), 120),
    true,
    0,
    NULL,
    NOW()
  )
  ON CONFLICT (user_id, endpoint)
  DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth_key = EXCLUDED.auth_key,
    user_agent = EXCLUDED.user_agent,
    device_label = EXCLUDED.device_label,
    is_active = true,
    failure_count = 0,
    last_failure_message = NULL,
    updated_at = NOW()
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'ENABLE_ORDER_PUSH',
    'push_subscriptions',
    v_subscription_id,
    jsonb_build_object('device_label', LEFT(p_device_label, 120))
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_subscription_id,
    'message', 'تم تفعيل إشعارات الطلبات على هذا الجهاز.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_push_subscription(
  p_endpoint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_subscription_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'orders'],
    'إيقاف إشعارات الطلبات'
  );

  UPDATE public.push_subscriptions
  SET
    is_active = false,
    updated_at = NOW()
  WHERE user_id = v_user_id
    AND endpoint = TRIM(p_endpoint)
  RETURNING id INTO v_subscription_id;

  IF v_subscription_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      entity_name,
      entity_id,
      details
    ) VALUES (
      v_user_id,
      'DISABLE_ORDER_PUSH',
      'push_subscriptions',
      v_subscription_id,
      '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم إيقاف إشعارات الطلبات على هذا الجهاز.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_push_subscription_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_active_count INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'orders'],
    'عرض حالة إشعارات الطلبات'
  );

  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.push_subscriptions
  WHERE user_id = v_user_id
    AND is_active = true;

  RETURN jsonb_build_object(
    'success', true,
    'active_device_count', v_active_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_push_webhook_secret()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'order_push_webhook_secret'
  ORDER BY created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_active_order_push_targets(
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  subscription_id UUID,
  user_id UUID,
  endpoint TEXT,
  p256dh TEXT,
  auth_key TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
    subscription.id,
    subscription.user_id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_key
  FROM public.push_subscriptions AS subscription
  JOIN public.profiles AS profile
    ON profile.id = subscription.user_id
  JOIN public.user_roles AS user_role
    ON user_role.user_id = profile.id
  JOIN public.roles AS role
    ON role.id = user_role.role_id
  WHERE subscription.is_active = true
    AND profile.is_active = true
    AND role.code = ANY (ARRAY['owner', 'admin', 'manager', 'orders']::TEXT[])
    AND (p_user_id IS NULL OR subscription.user_id = p_user_id);
$$;

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
$$;

CREATE OR REPLACE FUNCTION public.notify_new_website_order_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.source = 'website' AND NEW.status = 'new' THEN
    BEGIN
      PERFORM public.enqueue_order_push_webhook(
        jsonb_build_object(
          'type', 'new_order',
          'orderId', NEW.id,
          'eventKey', 'new_order:' || NEW.id::TEXT
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'تعذر صف إشعار الطلب %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_website_order_push
  ON public.orders;
CREATE TRIGGER trg_notify_new_website_order_push
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_website_order_push();

CREATE OR REPLACE FUNCTION public.send_test_push_notification()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_test_id UUID := gen_random_uuid();
  v_request_id BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'orders'],
    'اختبار إشعارات الطلبات'
  );

  SELECT public.enqueue_order_push_webhook(
    jsonb_build_object(
      'type', 'test',
      'userId', v_user_id,
      'eventKey', 'test:' || v_test_id::TEXT
    )
  )
  INTO v_request_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'TEST_ORDER_PUSH',
    'push_subscriptions',
    v_test_id,
    jsonb_build_object('pg_net_request_id', v_request_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_request_id,
    'message', 'تم إرسال إشعار تجريبي إلى هذا الجهاز.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.disable_push_subscription(TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_push_subscription_status()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_test_push_notification()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_push_subscription(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_push_subscription_status()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_test_push_notification()
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_push_webhook_secret()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_order_push_targets(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_order_push_webhook(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_new_website_order_push()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_push_webhook_secret()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_order_push_targets(UUID)
  TO service_role;

COMMIT;
