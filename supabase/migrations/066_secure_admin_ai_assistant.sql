-- Secure, read-only administrative AI assistant.
-- The assistant never receives direct table access: it reuses existing role-protected RPCs.

CREATE TABLE IF NOT EXISTS public.admin_ai_assistant_usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_ai_assistant_usage_events_user_created_idx
  ON public.admin_ai_assistant_usage_events (user_id, created_at DESC);

ALTER TABLE public.admin_ai_assistant_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_ai_assistant_usage_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.authorize_admin_ai_assistant_request()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_requests_in_window INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لاستخدام مساعد الإدارة الذكي.'
      USING ERRCODE = '28000';
  END IF;

  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'استخدام مساعد الإدارة الذكي'
  );

  -- Serialise checks per user so parallel browser requests cannot bypass the limit.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  DELETE FROM public.admin_ai_assistant_usage_events
  WHERE created_at < v_now - INTERVAL '2 days';

  SELECT COUNT(*)::INTEGER
    INTO v_requests_in_window
  FROM public.admin_ai_assistant_usage_events
  WHERE user_id = v_user_id
    AND created_at >= v_now - INTERVAL '15 minutes';

  IF v_requests_in_window >= 20 THEN
    RAISE EXCEPTION 'تم بلوغ الحد المؤقت للمساعد. حاول بعد بضع دقائق.'
      USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.admin_ai_assistant_usage_events (user_id, created_at)
  VALUES (v_user_id, v_now);

  RETURN v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_admin_ai_assistant_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_admin_ai_assistant_request() TO authenticated;
