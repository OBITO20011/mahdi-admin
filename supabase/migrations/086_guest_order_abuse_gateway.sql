-- =========================================================================
-- Nawasrah ERP - Migration 086
-- Protected guest-order gateway authorization and atomic abuse throttling.
-- =========================================================================

CREATE TABLE public.guest_order_gateway_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key UUID NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  session_hash TEXT NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  phone_hash TEXT NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'rate_limited')),
  reason TEXT NOT NULL CHECK (reason IN (
    'allowed',
    'ip_burst',
    'ip_short_window',
    'session_short_window',
    'phone_short_window'
  )),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN (
    'pending', 'succeeded', 'rate_limited', 'order_rejected', 'gateway_error'
  )),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX idx_guest_order_gateway_ip_created
  ON public.guest_order_gateway_requests (ip_hash, created_at DESC);
CREATE INDEX idx_guest_order_gateway_session_created
  ON public.guest_order_gateway_requests (session_hash, created_at DESC);
CREATE INDEX idx_guest_order_gateway_phone_created
  ON public.guest_order_gateway_requests (phone_hash, created_at DESC);

ALTER TABLE public.guest_order_gateway_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_order_gateway_requests
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.authorize_guest_order_gateway(
  p_idempotency_key UUID,
  p_ip_hash TEXT,
  p_session_hash TEXT,
  p_phone_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
SET statement_timeout = '5s'
AS $$
DECLARE
  v_existing public.guest_order_gateway_requests%ROWTYPE;
  v_lock_key TEXT;
  v_ip_burst INTEGER;
  v_ip_short INTEGER;
  v_session_short INTEGER;
  v_phone_short INTEGER;
  v_decision TEXT := 'allowed';
  v_reason TEXT := 'allowed';
  v_retry_after INTEGER := 0;
  v_existing_window INTERVAL;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Invalid gateway request.';
  END IF;

  IF COALESCE(p_ip_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_session_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_phone_hash, '') !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Invalid gateway identifiers.';
  END IF;

  -- Every signal is locked in one deterministic order. This keeps the limit
  -- atomic under concurrency without retaining raw network or customer data.
  FOR v_lock_key IN
    SELECT lock_key
    FROM unnest(ARRAY[
      'guest-order:idempotency:' || p_idempotency_key::TEXT,
      'guest-order:ip:' || p_ip_hash,
      'guest-order:phone:' || p_phone_hash,
      'guest-order:session:' || p_session_hash
    ]) AS lock_key
    ORDER BY lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));
  END LOOP;

  SELECT * INTO v_existing
  FROM public.guest_order_gateway_requests
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.ip_hash <> p_ip_hash
      OR v_existing.session_hash <> p_session_hash
      OR v_existing.phone_hash <> p_phone_hash
    THEN
      RAISE EXCEPTION 'Gateway retry context does not match.';
    END IF;

    IF v_existing.decision = 'allowed' THEN
      RETURN jsonb_build_object(
        'allowed', true,
        'reason', v_existing.reason,
        'retry_after_seconds', 0,
        'idempotent_replay', true
      );
    END IF;

    v_existing_window := CASE v_existing.reason
      WHEN 'ip_burst' THEN INTERVAL '1 minute'
      WHEN 'ip_short_window' THEN INTERVAL '15 minutes'
      ELSE INTERVAL '10 minutes'
    END;

    IF v_existing.created_at >= NOW() - v_existing_window THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', v_existing.reason,
        'retry_after_seconds', GREATEST(
          1,
          CEIL(EXTRACT(EPOCH FROM (
            v_existing.created_at + v_existing_window - NOW()
          )))::INTEGER
        ),
        'idempotent_replay', true
      );
    END IF;

    -- A denied operation may be retried with the same business idempotency key
    -- after its limit window. Successful operations remain immutable replays.
    DELETE FROM public.guest_order_gateway_requests
    WHERE id = v_existing.id;
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE ip_hash = p_ip_hash
        AND created_at >= NOW() - INTERVAL '1 minute'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE ip_hash = p_ip_hash
        AND created_at >= NOW() - INTERVAL '15 minutes'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE session_hash = p_session_hash
        AND created_at >= NOW() - INTERVAL '10 minutes'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE phone_hash = p_phone_hash
        AND created_at >= NOW() - INTERVAL '10 minutes'
    )::INTEGER
  INTO v_ip_burst, v_ip_short, v_session_short, v_phone_short
  FROM public.guest_order_gateway_requests
  WHERE created_at >= NOW() - INTERVAL '15 minutes'
    AND (
      ip_hash = p_ip_hash
      OR session_hash = p_session_hash
      OR phone_hash = p_phone_hash
    );

  -- Limits intentionally allow a normal second order and several customers
  -- behind one household/store network, while stopping identifier rotation.
  IF v_ip_burst >= 6 THEN
    v_decision := 'rate_limited';
    v_reason := 'ip_burst';
    v_retry_after := 60;
  ELSIF v_ip_short >= 20 THEN
    v_decision := 'rate_limited';
    v_reason := 'ip_short_window';
    v_retry_after := 900;
  ELSIF v_session_short >= 4 THEN
    v_decision := 'rate_limited';
    v_reason := 'session_short_window';
    v_retry_after := 600;
  ELSIF v_phone_short >= 3 THEN
    v_decision := 'rate_limited';
    v_reason := 'phone_short_window';
    v_retry_after := 600;
  END IF;

  INSERT INTO public.guest_order_gateway_requests (
    idempotency_key,
    ip_hash,
    session_hash,
    phone_hash,
    decision,
    reason,
    outcome
  ) VALUES (
    p_idempotency_key,
    p_ip_hash,
    p_session_hash,
    p_phone_hash,
    v_decision,
    v_reason,
    CASE WHEN v_decision = 'allowed' THEN 'pending' ELSE 'rate_limited' END
  );

  RETURN jsonb_build_object(
    'allowed', v_decision = 'allowed',
    'reason', v_reason,
    'retry_after_seconds', v_retry_after,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_guest_order_gateway(
  p_idempotency_key UUID,
  p_outcome TEXT,
  p_order_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
SET statement_timeout = '5s'
AS $$
DECLARE
  v_request public.guest_order_gateway_requests%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'order_rejected', 'gateway_error') THEN
    RAISE EXCEPTION 'Invalid gateway outcome.';
  END IF;

  SELECT * INTO v_request
  FROM public.guest_order_gateway_requests
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND OR v_request.decision <> 'allowed' THEN
    RAISE EXCEPTION 'Gateway authorization was not found.';
  END IF;

  IF v_request.outcome = 'succeeded' THEN
    IF p_outcome <> 'succeeded'
      OR v_request.order_id IS DISTINCT FROM p_order_id
    THEN
      RAISE EXCEPTION 'Gateway request is already finalized.';
    END IF;
    RETURN;
  END IF;

  UPDATE public.guest_order_gateway_requests
  SET outcome = p_outcome,
      order_id = CASE WHEN p_outcome = 'succeeded' THEN p_order_id ELSE NULL END,
      finalized_at = NOW()
  WHERE idempotency_key = p_idempotency_key;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_guest_order_gateway(
  UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_guest_order_gateway(
  UUID, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_guest_order_gateway(
  UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_guest_order_gateway(
  UUID, TEXT, UUID
) TO service_role;

-- The public browser can no longer cross the mutation boundary directly.
-- Only the protected Edge Function, using its server-side service credential,
-- may call the existing canonical wrapper.
REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) TO service_role;

DO $$
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
    RAISE EXCEPTION 'Guest order RPC remains directly executable outside the gateway.';
  END IF;
END;
$$;

COMMENT ON TABLE public.guest_order_gateway_requests IS
  'HMAC-pseudonymized, short-window guest-order gateway decisions and outcomes. Raw IP, phone and session identifiers are never stored.';
COMMENT ON FUNCTION public.authorize_guest_order_gateway(UUID, TEXT, TEXT, TEXT) IS
  'Service-role-only atomic multi-signal guest-order rate limiter. Six/IP/minute, twenty/IP/15m, four/session/10m and three/phone/10m.';
COMMENT ON FUNCTION public.finalize_guest_order_gateway(UUID, TEXT, UUID) IS
  'Service-role-only gateway audit finalizer. It never mutates the order or inventory.';
