-- =========================================================================
-- Nawasrah ERP - Business delivery lifecycle hardening
-- Explicit dead-letter state and delivery timing without changing recipients,
-- messages, retry limits, or the n8n feed function signatures.
-- =========================================================================

BEGIN;

ALTER TABLE public.automation_event_deliveries
  ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

ALTER TABLE public.automation_event_deliveries
  DROP CONSTRAINT IF EXISTS automation_event_deliveries_status_check;

ALTER TABLE public.automation_event_deliveries
  ADD CONSTRAINT automation_event_deliveries_status_check CHECK (
    status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')
  );

CREATE INDEX IF NOT EXISTS idx_automation_deliveries_dead_letter
  ON public.automation_event_deliveries(updated_at, event_id)
  WHERE status = 'dead_letter';

CREATE OR REPLACE FUNCTION public.claim_automation_deliveries(
  p_channel TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel TEXT := LOWER(TRIM(COALESCE(p_channel, '')));
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_lease_seconds INTEGER :=
    LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 30), 900);
  v_items JSONB;
BEGIN
  IF v_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Invalid automation delivery channel.';
  END IF;

  INSERT INTO public.automation_event_deliveries (event_id, channel)
  SELECT ae.id, v_channel
  FROM public.automation_events ae
  WHERE ae.created_at >= NOW() - INTERVAL '30 days'
  ON CONFLICT (event_id, channel) DO NOTHING;

  -- Finalize exhausted retries explicitly. A live lease is never stolen; an
  -- exhausted processing row is dead-lettered only after its lease expires.
  UPDATE public.automation_event_deliveries d
  SET
    status = 'dead_letter',
    dead_lettered_at = COALESCE(d.dead_lettered_at, NOW()),
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE d.channel = v_channel
    AND d.attempt_count >= 10
    AND (
      d.status IN ('pending', 'failed')
      OR (d.status = 'processing' AND d.lease_expires_at <= NOW())
    );

  WITH candidates AS (
    SELECT d.event_id
    FROM public.automation_event_deliveries d
    JOIN public.automation_events ae ON ae.id = d.event_id
    WHERE d.channel = v_channel
      AND d.attempt_count < 10
      AND (
        (d.status IN ('pending', 'failed') AND d.next_attempt_at <= NOW())
        OR
        (d.status = 'processing' AND d.lease_expires_at <= NOW())
      )
    ORDER BY ae.created_at, ae.id
    FOR UPDATE OF d SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.automation_event_deliveries d
    SET
      status = 'processing',
      attempt_count = d.attempt_count + 1,
      first_attempt_at = COALESCE(d.first_attempt_at, NOW()),
      last_attempt_at = NOW(),
      lease_expires_at = NOW() + make_interval(secs => v_lease_seconds),
      last_error = NULL,
      updated_at = NOW()
    FROM candidates c
    WHERE d.event_id = c.event_id
      AND d.channel = v_channel
    RETURNING d.event_id, d.attempt_count, d.lease_expires_at
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'eventId', ae.id,
      'eventType', ae.event_type,
      'entityId', ae.entity_id,
      'payload', ae.payload,
      'createdAt', ae.created_at,
      'attemptCount', c.attempt_count,
      'leaseExpiresAt', c.lease_expires_at
    ) ORDER BY ae.created_at, ae.id
  ) INTO v_items
  FROM claimed c
  JOIN public.automation_events ae ON ae.id = c.event_id;

  RETURN jsonb_build_object(
    'success', true,
    'channel', v_channel,
    'items', COALESCE(v_items, '[]'::JSONB)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_automation_delivery(
  p_event_id UUID,
  p_channel TEXT,
  p_success BOOLEAN,
  p_error TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_channel TEXT := LOWER(TRIM(COALESCE(p_channel, '')));
  v_status TEXT;
BEGIN
  IF p_event_id IS NULL OR v_channel NOT IN ('telegram', 'whatsapp') THEN
    RAISE EXCEPTION 'Invalid automation delivery completion.';
  END IF;

  UPDATE public.automation_event_deliveries d
  SET
    status = CASE
      WHEN COALESCE(p_success, false) THEN 'delivered'
      WHEN d.attempt_count >= 10 THEN 'dead_letter'
      ELSE 'failed'
    END,
    delivered_at = CASE WHEN COALESCE(p_success, false)
      THEN NOW() ELSE NULL END,
    dead_lettered_at = CASE
      WHEN NOT COALESCE(p_success, false) AND d.attempt_count >= 10
        THEN COALESCE(d.dead_lettered_at, NOW())
      ELSE NULL
    END,
    next_attempt_at = CASE WHEN COALESCE(p_success, false)
      THEN d.next_attempt_at
      ELSE NOW() + make_interval(
        secs => LEAST(3600, 60 * power(2, LEAST(d.attempt_count, 6))::INTEGER)
      )
    END,
    lease_expires_at = NULL,
    last_error = CASE WHEN COALESCE(p_success, false)
      THEN NULL ELSE LEFT(COALESCE(NULLIF(TRIM(p_error), ''), 'Delivery failed'), 1000)
    END,
    updated_at = NOW()
  WHERE d.event_id = p_event_id
    AND d.channel = v_channel
    AND d.status = 'processing'
  RETURNING d.status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Automation delivery is not currently processing.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'eventId', p_event_id,
    'channel', v_channel,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_automation_deliveries(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_automation_delivery(UUID, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_deliveries(TEXT, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_automation_delivery(UUID, TEXT, BOOLEAN, TEXT)
  TO service_role;

COMMENT ON COLUMN public.automation_event_deliveries.dead_lettered_at IS
  'Time a delivery exhausted its fixed ten-attempt retry budget.';

COMMIT;
