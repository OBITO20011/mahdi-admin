-- =========================================================================
-- F2: return the existing opaque tracking capability only to the customer
-- who has just created (or idempotently replayed) a guest order.
--
-- This changes no order, pricing, inventory, payment, or gateway behavior.
-- The public tracking RPCs remain the only way the browser can read status.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_guest_customer_order(
  p_idempotency_key TEXT,
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_governorate TEXT,
  p_city TEXT,
  p_area TEXT,
  p_street TEXT,
  p_building TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_customer_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_promotion_code TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash_on_delivery',
  p_delivery_zone TEXT DEFAULT 'inside_ramtha'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_method TEXT := LOWER(NULLIF(TRIM(p_payment_method), ''));
  v_delivery_zone TEXT := LOWER(NULLIF(TRIM(p_delivery_zone), ''));
  v_result JSONB;
  v_order_id UUID;
  v_existing_payment_method TEXT;
  v_existing_delivery_zone TEXT;
  v_existing_delivery_fee BIGINT;
  v_existing_total BIGINT;
  v_tracking_token UUID;
  v_settings public.storefront_settings%ROWTYPE;
  v_is_replay BOOLEAN;
  v_delivery_fee BIGINT;
  v_total BIGINT;
BEGIN
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq') THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة. اختر كاش عند الاستلام أو CliQ.';
  END IF;

  IF v_delivery_zone NOT IN ('inside_ramtha', 'outside_ramtha') THEN
    RAISE EXCEPTION 'اختر منطقة التوصيل: داخل الرمثا أو خارج الرمثا.';
  END IF;

  IF v_delivery_zone = 'inside_ramtha'
    AND CONCAT_WS(' ', p_governorate, p_city, p_area) NOT ILIKE '%الرمثا%'
  THEN
    RAISE EXCEPTION 'العنوان لا يظهر أنه داخل الرمثا. اختر خارج الرمثا أو صحح المدينة.';
  END IF;

  SELECT * INTO v_settings
  FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

  v_result := public.submit_guest_customer_order_core(
    p_idempotency_key, p_customer_full_name, p_customer_phone,
    p_governorate, p_city, p_area, p_street, p_building,
    p_address_notes, p_google_maps_url, p_latitude, p_longitude,
    p_customer_notes, p_items, p_promotion_code
  );

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  v_is_replay := COALESCE((v_result->>'idempotent_replay')::BOOLEAN, false);
  v_order_id := (v_result->>'order_id')::UUID;

  SELECT
    payment_method,
    delivery_zone,
    delivery_fee_in_minor_units,
    total_in_minor_units,
    tracking_token
  INTO
    v_existing_payment_method,
    v_existing_delivery_zone,
    v_existing_delivery_fee,
    v_existing_total,
    v_tracking_token
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF v_is_replay THEN
    IF v_existing_payment_method IS DISTINCT FROM v_payment_method THEN
      RAISE EXCEPTION 'تغيرت طريقة الدفع لطلب محفوظ مسبقًا. أعد إرسال الطلب.';
    END IF;

    IF v_existing_delivery_zone IS NOT NULL
      AND v_existing_delivery_zone IS DISTINCT FROM v_delivery_zone
    THEN
      RAISE EXCEPTION 'تغيرت منطقة التوصيل لطلب محفوظ مسبقًا. أعد إرسال الطلب.';
    END IF;

    IF v_existing_delivery_zone IS NULL THEN
      UPDATE public.orders
      SET delivery_zone = v_delivery_zone,
          updated_at = NOW()
      WHERE id = v_order_id;
      v_existing_delivery_zone := v_delivery_zone;
    END IF;

    RETURN v_result || jsonb_build_object(
      'total', v_existing_total,
      'delivery_fee', v_existing_delivery_fee,
      'delivery_zone', v_existing_delivery_zone,
      'payment_method', v_payment_method,
      'payment_status', 'unpaid',
      'tracking_token', v_tracking_token,
      'tracking_path', '/#track=' || v_tracking_token::TEXT
    );
  END IF;

  IF NOT COALESCE(v_settings.orders_enabled, false) THEN
    RAISE EXCEPTION 'الطلبات متوقفة مؤقتًا من إدارة المتجر. تواصل معنا عبر واتساب.';
  END IF;

  IF (v_result->>'subtotal')::BIGINT < v_settings.minimum_order_in_minor_units THEN
    RAISE EXCEPTION 'قيمة الطلب أقل من الحد الأدنى المطلوب وهو % د.أ.',
      to_char(v_settings.minimum_order_in_minor_units / 1000.0, 'FM999999990.000');
  END IF;

  v_delivery_fee := CASE v_delivery_zone
    WHEN 'inside_ramtha' THEN
      v_settings.inside_ramtha_delivery_fee_in_minor_units
    ELSE
      v_settings.outside_ramtha_delivery_fee_in_minor_units
  END;
  v_total := (v_result->>'total')::BIGINT + v_delivery_fee;

  UPDATE public.orders
  SET delivery_zone = v_delivery_zone,
      delivery_fee_in_minor_units = v_delivery_fee,
      total_in_minor_units = v_total,
      payment_method = v_payment_method,
      payment_status = 'unpaid',
      updated_at = NOW()
  WHERE id = v_order_id;

  RETURN v_result || jsonb_build_object(
    'total', v_total,
    'delivery_fee', v_delivery_fee,
    'delivery_zone', v_delivery_zone,
    'payment_method', v_payment_method,
    'payment_status', 'unpaid',
    'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) IS 'Gateway-only canonical guest checkout. Returns the order-scoped opaque tracking token only in the accepted gateway response.';

COMMIT;
