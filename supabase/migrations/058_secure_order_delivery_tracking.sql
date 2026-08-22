-- =========================================================================
-- Nawasrah ERP - Secure customer delivery tracking and ETA management
-- =========================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_token UUID,
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_completed_at TIMESTAMPTZ;

UPDATE public.orders
SET tracking_token = gen_random_uuid()
WHERE tracking_token IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN tracking_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN tracking_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token
  ON public.orders(tracking_token);

CREATE INDEX IF NOT EXISTS idx_orders_active_delivery_eta
  ON public.orders(estimated_arrival_at)
  WHERE status = 'out_for_delivery';

-- Keep delivery lifecycle timestamps synchronized no matter which canonical
-- order-completion RPC performs the final status update.
CREATE OR REPLACE FUNCTION public.sync_order_delivery_tracking_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'out_for_delivery'
    AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    NEW.delivery_started_at := COALESCE(NEW.delivery_started_at, NOW());
  END IF;

  IF NEW.status = 'completed'
    AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    NEW.delivery_completed_at := COALESCE(NEW.delivery_completed_at, NOW());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_delivery_tracking_timestamps
  ON public.orders;
CREATE TRIGGER trg_sync_order_delivery_tracking_timestamps
BEFORE UPDATE OF status
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_delivery_tracking_timestamps();

REVOKE ALL ON FUNCTION public.sync_order_delivery_tracking_timestamps()
  FROM PUBLIC, anon, authenticated;

-- Staff use this RPC to start delivery and set an ETA in one audited
-- transaction. The existing update_order_status RPC remains the sole owner of
-- status-transition rules and inventory behavior.
CREATE OR REPLACE FUNCTION public.start_or_update_order_delivery(
  p_order_id UUID,
  p_eta_minutes INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_number TEXT;
  v_status TEXT;
  v_source TEXT;
  v_tracking_token UUID;
  v_eta TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'بدء توصيل الطلب وتحديد وقت الوصول'
  );

  IF p_eta_minutes IS NULL OR p_eta_minutes NOT BETWEEN 5 AND 360 THEN
    RAISE EXCEPTION 'وقت الوصول المتوقع يجب أن يكون بين 5 و360 دقيقة.';
  END IF;

  SELECT order_number, status, source, tracking_token
  INTO v_order_number, v_status, v_source, v_tracking_token
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_source IS DISTINCT FROM 'website' THEN
    RAISE EXCEPTION 'تتبع التوصيل متاح لطلبات الموقع فقط.';
  END IF;

  IF v_status = 'ready' THEN
    PERFORM public.update_order_status(
      p_order_id,
      'out_for_delivery',
      COALESCE(NULLIF(TRIM(p_notes), ''), 'بدأ توصيل الطلب')
    );
  ELSIF v_status <> 'out_for_delivery' THEN
    RAISE EXCEPTION
      'يجب أن يكون الطلب جاهزًا أو خارجًا للتوصيل لتحديد وقت الوصول.';
  END IF;

  v_eta := NOW() + make_interval(mins => p_eta_minutes);

  UPDATE public.orders
  SET delivery_started_at = COALESCE(delivery_started_at, NOW()),
      estimated_arrival_at = v_eta,
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING tracking_token INTO v_tracking_token;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'start_or_update_order_delivery',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'eta_minutes', p_eta_minutes,
      'estimated_arrival_at', v_eta,
      'notes', NULLIF(TRIM(p_notes), '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'out_for_delivery',
    'estimated_arrival_at', v_eta,
    'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'message', 'بدأ التوصيل وتم تحديد وقت الوصول المتوقع.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_or_update_order_delivery(UUID, INTEGER, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_or_update_order_delivery(UUID, INTEGER, TEXT)
  TO authenticated;

-- One private builder keeps the public tracking payload identical whether the
-- customer enters order number + phone or opens the secure tracking link.
CREATE OR REPLACE FUNCTION public.build_public_order_tracking_payload(
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_timeline JSONB;
  v_item_count INTEGER;
BEGIN
  SELECT o.*
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.source = 'website';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'لم نعثر على طلب مطابق.'
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_item_count
  FROM public.order_items
  WHERE order_id = v_order.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'status', history.status,
        'created_at', history.created_at
      )
      ORDER BY history.created_at
    ),
    '[]'::jsonb
  )
  INTO v_timeline
  FROM (
    SELECT osh.new_status AS status, osh.created_at
    FROM public.order_status_history osh
    WHERE osh.order_id = v_order.id
    UNION ALL
    SELECT 'new'::TEXT, v_order.created_at
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.order_status_history osh
      WHERE osh.order_id = v_order.id
        AND osh.new_status = 'new'
    )
  ) history;

  RETURN jsonb_build_object(
    'success', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'total', v_order.total_in_minor_units,
    'item_count', v_item_count,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'delivery_started_at', v_order.delivery_started_at,
    'estimated_arrival_at', v_order.estimated_arrival_at,
    'delivery_completed_at', v_order.delivery_completed_at,
    'tracking_token', v_order.tracking_token,
    'tracking_path', '/#track=' || v_order.tracking_token::TEXT,
    'timeline', v_timeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_public_order_tracking_payload(UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.track_guest_order(
  p_order_number TEXT,
  p_customer_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_order_id UUID;
BEGIN
  IF NULLIF(TRIM(p_order_number), '') IS NULL
    OR CHAR_LENGTH(TRIM(p_order_number)) > 40
    OR v_phone !~ '^07[789][0-9]{7}$'
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'رقم الطلب أو الهاتف غير صحيح.'
    );
  END IF;

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE UPPER(o.order_number) = UPPER(TRIM(p_order_number))
    AND public.normalize_customer_phone(c.phone) = v_phone
    AND o.source = 'website'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'لم نعثر على طلب مطابق لرقم الطلب والهاتف.'
    );
  END IF;

  RETURN public.build_public_order_tracking_payload(v_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.track_guest_order_by_token(
  p_tracking_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF NULLIF(TRIM(p_tracking_token), '') IS NULL
    OR TRIM(p_tracking_token) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'رابط متابعة الطلب غير صحيح.'
    );
  END IF;

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.tracking_token = TRIM(p_tracking_token)::UUID
    AND o.source = 'website'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'رابط متابعة الطلب غير صحيح أو منتهي.'
    );
  END IF;

  RETURN public.build_public_order_tracking_payload(v_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.track_guest_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_guest_order(TEXT, TEXT)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.track_guest_order_by_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_guest_order_by_token(TEXT)
  TO anon, authenticated;

COMMENT ON FUNCTION public.start_or_update_order_delivery(UUID, INTEGER, TEXT) IS
  'Authenticated audited delivery start/ETA RPC that reuses update_order_status for transition rules.';
COMMENT ON FUNCTION public.build_public_order_tracking_payload(UUID) IS
  'Private builder for the minimal customer-safe order tracking payload.';
COMMENT ON FUNCTION public.track_guest_order(TEXT, TEXT) IS
  'Privacy-preserving website tracking requiring exact order number and normalized customer phone.';
COMMENT ON FUNCTION public.track_guest_order_by_token(TEXT) IS
  'Public website tracking by an unguessable per-order token; returns no customer address or phone.';

COMMIT;
