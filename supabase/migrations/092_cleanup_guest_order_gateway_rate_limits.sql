-- =========================================================================
-- Nawasrah ERP - Migration 092
-- Bounded retention for H1 gateway rate-limit decisions.
--
-- The longest abuse window is 15 minutes. Checkout retains a pending
-- idempotency key for 24 hours, so 48 hours preserves retries with a full
-- additional 24-hour safety margin before any row can be removed.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_guest_order_gateway_requests_created_at
  ON public.guest_order_gateway_requests (created_at, id);

CREATE OR REPLACE FUNCTION public.cleanup_guest_order_gateway_requests(
  p_batch_size INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Cleanup batch size must be between 1 and 500.';
  END IF;

  -- Keep the cleanup short and defer contested rows to the next run. The
  -- cutoff is deliberately beyond both every rate-limit window (15 minutes)
  -- and the browser's 24-hour pending idempotency-key lifetime.
  PERFORM set_config('lock_timeout', '2s', true);
  PERFORM set_config('statement_timeout', '5s', true);

  WITH stale_rows AS (
    SELECT ctid
    FROM public.guest_order_gateway_requests
    WHERE created_at < NOW() - INTERVAL '48 hours'
    ORDER BY created_at, id
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ), deleted_rows AS (
    DELETE FROM public.guest_order_gateway_requests AS request
    USING stale_rows
    WHERE request.ctid = stale_rows.ctid
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_deleted_count
  FROM deleted_rows;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'retention_hours', 48
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_guest_order_gateway_requests(INTEGER)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.cleanup_guest_order_gateway_requests(INTEGER) IS
  'Private cron-only H1 gateway retention cleanup. Deletes at most 500 rows older than 48 hours, preserving the 15-minute rate-limit windows and 24-hour checkout idempotency lifetime.';

-- pg_cron already exists in Production. Scheduling is idempotent: exactly one
-- bounded run is retained, and it is offset from the inventory-expiry job.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'cleanup-guest-order-gateway-requests';

SELECT cron.schedule(
  'cleanup-guest-order-gateway-requests',
  '2,17,32,47 * * * *',
  $$SELECT public.cleanup_guest_order_gateway_requests(500);$$
);
