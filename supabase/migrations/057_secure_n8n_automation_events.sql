-- =========================================================================
-- Nawasrah ERP - Secure n8n automation event outbox
-- Durable, per-channel delivery without exposing database credentials to n8n.
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.automation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('new_order', 'low_stock', 'out_of_stock', 'shift_closed')
  ),
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::TEXT) <= 32768
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_events_created
  ON public.automation_events(created_at, id);

CREATE TABLE IF NOT EXISTS public.automation_event_deliveries (
  event_id UUID NOT NULL
    REFERENCES public.automation_events(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'delivered', 'failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_automation_deliveries_claim
  ON public.automation_event_deliveries(
    channel,
    status,
    next_attempt_at,
    lease_expires_at
  );

ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_event_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.automation_events
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.automation_event_deliveries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_events
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automation_event_deliveries
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_automation_event(
  p_event_key TEXT,
  p_event_type TEXT,
  p_entity_id UUID,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_event_key TEXT := NULLIF(TRIM(p_event_key), '');
  v_payload JSONB := COALESCE(p_payload, '{}'::JSONB);
BEGIN
  IF v_event_key IS NULL OR length(v_event_key) > 300 THEN
    RAISE EXCEPTION 'Invalid automation event key.';
  END IF;
  IF p_event_type NOT IN (
    'new_order', 'low_stock', 'out_of_stock', 'shift_closed'
  ) THEN
    RAISE EXCEPTION 'Invalid automation event type.';
  END IF;
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'Automation event entity is required.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object'
    OR octet_length(v_payload::TEXT) > 32768
  THEN
    RAISE EXCEPTION 'Invalid automation event payload.';
  END IF;

  INSERT INTO public.automation_events (
    event_key,
    event_type,
    entity_id,
    payload
  ) VALUES (
    v_event_key,
    p_event_type,
    p_entity_id,
    v_payload
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.automation_events
    WHERE event_key = v_event_key;
  END IF;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_order_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_name TEXT;
BEGIN
  IF NEW.source = 'website' AND NEW.status = 'new' THEN
    SELECT c.full_name INTO v_customer_name
    FROM public.customers c
    WHERE c.id = NEW.customer_id;

    PERFORM public.enqueue_automation_event(
      'new_order:' || NEW.id::TEXT,
      'new_order',
      NEW.id,
      jsonb_build_object(
        'orderId', NEW.id,
        'orderNumber', NEW.order_number,
        'customerName', COALESCE(v_customer_name, 'عميل'),
        'totalInMinorUnits', NEW.total_in_minor_units,
        'paymentMethod', NEW.payment_method,
        'source', NEW.source,
        'createdAt', NEW.created_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_order_automation_event
  ON public.orders;
CREATE TRIGGER trg_enqueue_order_automation_event
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_order_automation_event();

CREATE OR REPLACE FUNCTION public.enqueue_stock_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_name TEXT;
  v_warehouse_name TEXT;
  v_should_enqueue BOOLEAN := false;
BEGIN
  IF NEW.status = 'active' THEN
    v_should_enqueue := TG_OP = 'INSERT'
      OR OLD.status IS DISTINCT FROM 'active'
      OR OLD.severity IS DISTINCT FROM NEW.severity;
  END IF;

  IF NOT v_should_enqueue THEN
    RETURN NEW;
  END IF;

  SELECT p.name_ar INTO v_product_name
  FROM public.products p
  WHERE p.id = NEW.product_id;

  SELECT w.name_ar INTO v_warehouse_name
  FROM public.warehouses w
  WHERE w.id = NEW.warehouse_id;

  PERFORM public.enqueue_automation_event(
    'stock_alert:' || NEW.id::TEXT || ':' || NEW.severity || ':'
      || floor(extract(epoch FROM NEW.last_updated_at))::BIGINT::TEXT,
    CASE
      WHEN NEW.severity = 'out_of_stock' THEN 'out_of_stock'
      ELSE 'low_stock'
    END,
    NEW.id,
    jsonb_build_object(
      'stockAlertId', NEW.id,
      'productId', NEW.product_id,
      'productName', COALESCE(v_product_name, 'صنف'),
      'warehouseId', NEW.warehouse_id,
      'warehouseName', COALESCE(v_warehouse_name, 'المستودع'),
      'availableQuantity', NEW.available_quantity,
      'thresholdQuantity', NEW.threshold_quantity,
      'severity', NEW.severity,
      'updatedAt', NEW.last_updated_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_stock_automation_event
  ON public.stock_alerts;
CREATE TRIGGER trg_enqueue_stock_automation_event
AFTER INSERT OR UPDATE OF status, severity ON public.stock_alerts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_stock_automation_event();

CREATE OR REPLACE FUNCTION public.enqueue_closed_shift_automation_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    PERFORM public.enqueue_automation_event(
      'shift_closed:' || NEW.id::TEXT,
      'shift_closed',
      NEW.id,
      jsonb_build_object(
        'shiftId', NEW.id,
        'shiftNumber', NEW.shift_number,
        'expectedCashInMinorUnits', NEW.expected_cash_in_minor_units,
        'actualCashInMinorUnits', NEW.actual_cash_in_minor_units,
        'cashDiscrepancyInMinorUnits', NEW.cash_discrepancy_in_minor_units,
        'closedAt', NEW.closed_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_closed_shift_automation_event
  ON public.cash_shifts;
CREATE TRIGGER trg_enqueue_closed_shift_automation_event
AFTER UPDATE OF status ON public.cash_shifts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_closed_shift_automation_event();

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
    status = CASE WHEN COALESCE(p_success, false)
      THEN 'delivered' ELSE 'failed' END,
    delivered_at = CASE WHEN COALESCE(p_success, false)
      THEN NOW() ELSE NULL END,
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

REVOKE ALL ON FUNCTION public.enqueue_automation_event(TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_order_automation_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_stock_automation_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_closed_shift_automation_event()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_automation_deliveries(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_automation_delivery(UUID, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_automation_deliveries(TEXT, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_automation_delivery(UUID, TEXT, BOOLEAN, TEXT)
  TO service_role;

COMMENT ON TABLE public.automation_events IS
  'Immutable operational events for external automation delivery.';
COMMENT ON TABLE public.automation_event_deliveries IS
  'Independent retry and delivery status per event and notification channel.';

COMMIT;
