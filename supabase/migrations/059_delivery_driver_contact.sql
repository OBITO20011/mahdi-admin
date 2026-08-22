-- =========================================================================
-- Nawasrah ERP - Driver contact on secure customer delivery tracking
-- =========================================================================

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_driver_phone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_delivery_driver_phone_check'
      AND conrelid = 'public.orders'::REGCLASS
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_driver_phone_check
      CHECK (
        delivery_driver_phone IS NULL
        OR delivery_driver_phone ~ '^07[789][0-9]{7}$'
      );
  END IF;
END;
$$;

-- Remove the three-argument version before publishing the extended function.
-- Calls from an older deployed client remain compatible because both new
-- optional parameters have defaults and PostgREST resolves named arguments.
DROP FUNCTION IF EXISTS public.start_or_update_order_delivery(
  UUID,
  INTEGER,
  TEXT
);

CREATE OR REPLACE FUNCTION public.start_or_update_order_delivery(
  p_order_id UUID,
  p_eta_minutes INTEGER,
  p_driver_phone TEXT DEFAULT NULL,
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
  v_existing_driver_phone TEXT;
  v_driver_phone TEXT;
  v_eta TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'بدء توصيل الطلب وتحديد وقت الوصول ورقم السائق'
  );

  IF p_eta_minutes IS NULL OR p_eta_minutes NOT BETWEEN 5 AND 360 THEN
    RAISE EXCEPTION 'وقت الوصول المتوقع يجب أن يكون بين 5 و360 دقيقة.';
  END IF;

  IF NULLIF(TRIM(p_driver_phone), '') IS NOT NULL THEN
    v_driver_phone := public.normalize_customer_phone(p_driver_phone);
    IF v_driver_phone !~ '^07[789][0-9]{7}$' THEN
      RAISE EXCEPTION 'رقم السائق الأردني غير صحيح.';
    END IF;
  END IF;

  SELECT
    order_number,
    status,
    source,
    tracking_token,
    delivery_driver_phone
  INTO
    v_order_number,
    v_status,
    v_source,
    v_tracking_token,
    v_existing_driver_phone
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_source IS DISTINCT FROM 'website' THEN
    RAISE EXCEPTION 'تتبع التوصيل متاح لطلبات الموقع فقط.';
  END IF;

  v_driver_phone := COALESCE(v_driver_phone, v_existing_driver_phone);
  IF v_driver_phone IS NULL THEN
    RAISE EXCEPTION 'أدخل رقم السائق قبل بدء التوصيل.';
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
      delivery_driver_phone = v_driver_phone,
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
      'driver_phone', v_driver_phone,
      'notes', NULLIF(TRIM(p_notes), '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'out_for_delivery',
    'estimated_arrival_at', v_eta,
    'driver_phone', v_driver_phone,
    'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'message', 'بدأ التوصيل وتم حفظ وقت الوصول ورقم السائق.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_or_update_order_delivery(
  UUID,
  INTEGER,
  TEXT,
  TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_or_update_order_delivery(
  UUID,
  INTEGER,
  TEXT,
  TEXT
) TO authenticated;

-- Replace only the private payload builder. The existing public token and
-- order-number tracking RPCs automatically receive this added safe field.
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
    'driver_phone', v_order.delivery_driver_phone,
    'tracking_token', v_order.tracking_token,
    'tracking_path', '/#track=' || v_order.tracking_token::TEXT,
    'timeline', v_timeline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_public_order_tracking_payload(UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.orders.delivery_driver_phone IS
  'Normalized Jordanian contact number shown only through the secure customer tracking payload.';
COMMENT ON FUNCTION public.start_or_update_order_delivery(
  UUID,
  INTEGER,
  TEXT,
  TEXT
) IS
  'Authenticated audited delivery start/ETA/driver RPC that reuses update_order_status for transition rules.';

COMMIT;
