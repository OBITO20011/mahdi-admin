-- =========================================================================
-- Nawasrah ERP - Migration 028
-- Safe guest checkout entry point for the public wholesale website.
--
-- The existing create_customer_order RPC remains the only owner of customer,
-- address, order, pricing, and stock-reservation business logic. This wrapper
-- exposes a deliberately smaller public contract and adds:
--   * server-side idempotency
--   * practical per-phone rate limiting
--   * bounded cart/input validation
--   * fixed website source with no guest-controlled discounts or fees
-- =========================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON public.orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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
  p_customer_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := LOWER(NULLIF(TRIM(p_idempotency_key), ''));
  v_phone TEXT := public.normalize_customer_phone(p_customer_phone);
  v_result JSONB;
  v_existing_order_id UUID;
  v_existing_order_number TEXT;
  v_existing_customer_id UUID;
  v_existing_address_id UUID;
  v_existing_subtotal BIGINT;
  v_existing_total BIGINT;
  v_existing_status TEXT;
  v_existing_phone TEXT;
  v_recent_orders INTEGER;
  v_package_count BIGINT;
  v_location_source TEXT :=
    CASE
      WHEN NULLIF(TRIM(p_google_maps_url), '') IS NULL THEN 'manual'
      ELSE 'map_pin'
    END;
  v_formatted_address TEXT;
BEGIN
  IF v_key IS NULL
    OR v_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'تعذر تأمين الطلب. حدّث الصفحة وحاول مرة أخرى.';
  END IF;

  IF NULLIF(TRIM(p_customer_full_name), '') IS NULL
    OR CHAR_LENGTH(TRIM(p_customer_full_name)) < 2
    OR CHAR_LENGTH(TRIM(p_customer_full_name)) > 120
  THEN
    RAISE EXCEPTION 'اكتب اسم العميل بشكل صحيح.';
  END IF;

  IF v_phone !~ '^07[789][0-9]{7}$' THEN
    RAISE EXCEPTION 'رقم الهاتف الأردني غير صحيح.';
  END IF;

  IF NULLIF(TRIM(p_governorate), '') IS NULL
    OR NULLIF(TRIM(p_city), '') IS NULL
    OR NULLIF(TRIM(p_area), '') IS NULL
    OR NULLIF(TRIM(p_street), '') IS NULL
  THEN
    RAISE EXCEPTION 'المحافظة والمدينة والمنطقة وتفاصيل العنوان مطلوبة.';
  END IF;

  IF CHAR_LENGTH(TRIM(p_governorate)) > 80
    OR CHAR_LENGTH(TRIM(p_city)) > 80
    OR CHAR_LENGTH(TRIM(p_area)) > 120
    OR CHAR_LENGTH(TRIM(p_street)) > 300
    OR CHAR_LENGTH(COALESCE(TRIM(p_building), '')) > 120
    OR CHAR_LENGTH(COALESCE(TRIM(p_address_notes), '')) > 500
    OR CHAR_LENGTH(COALESCE(TRIM(p_customer_notes), '')) > 1000
  THEN
    RAISE EXCEPTION 'أحد حقول العنوان أو الملاحظات أطول من المسموح.';
  END IF;

  IF NULLIF(TRIM(p_google_maps_url), '') IS NOT NULL
    AND (
      CHAR_LENGTH(TRIM(p_google_maps_url)) > 1000
      OR TRIM(p_google_maps_url) !~* '^https://'
    )
  THEN
    RAISE EXCEPTION 'رابط الموقع غير صحيح ويجب أن يبدأ بـ https://.';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة الطلب فارغة.';
  END IF;

  IF jsonb_array_length(p_items) > 30 THEN
    RAISE EXCEPTION 'عدد الأصناف في الطلب أكبر من الحد المسموح.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item(value)
    WHERE COALESCE(item.value->>'product_id', '') = ''
      OR COALESCE(item.value->>'quantity', '') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'بيانات أحد طرود الطلب غير صحيحة.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item(value)
    GROUP BY item.value->>'product_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار المنتج نفسه داخل الطلب.';
  END IF;

  SELECT SUM((item.value->>'quantity')::BIGINT)
  INTO v_package_count
  FROM jsonb_array_elements(p_items) AS item(value);

  IF COALESCE(v_package_count, 0) > 200 THEN
    RAISE EXCEPTION 'عدد الطرود في الطلب أكبر من الحد المسموح.';
  END IF;

  -- Serialize retries carrying the same browser-generated request key.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT
    o.id,
    o.order_number,
    o.customer_id,
    o.customer_address_id,
    o.subtotal_in_minor_units,
    o.total_in_minor_units,
    o.status,
    c.phone
  INTO
    v_existing_order_id,
    v_existing_order_number,
    v_existing_customer_id,
    v_existing_address_id,
    v_existing_subtotal,
    v_existing_total,
    v_existing_status,
    v_existing_phone
  FROM public.orders AS o
  JOIN public.customers AS c ON c.id = o.customer_id
  WHERE o.idempotency_key = v_key
  LIMIT 1;

  IF FOUND THEN
    IF public.normalize_customer_phone(v_existing_phone) <> v_phone THEN
      RAISE EXCEPTION 'مفتاح الطلب مستخدم لرقم هاتف مختلف.';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'order_id', v_existing_order_id,
      'order_number', v_existing_order_number,
      'customer_id', v_existing_customer_id,
      'customer_address_id', v_existing_address_id,
      'customer_reused', true,
      'subtotal', v_existing_subtotal,
      'total', v_existing_total,
      'status', v_existing_status,
      'message', 'هذا الطلب محفوظ مسبقاً ولم يتم تكراره.'
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_recent_orders
  FROM public.orders AS o
  JOIN public.customers AS c ON c.id = o.customer_id
  WHERE o.source = 'website'
    AND public.normalize_customer_phone(c.phone) = v_phone
    AND o.created_at >= NOW() - INTERVAL '10 minutes';

  IF v_recent_orders >= 3 THEN
    RAISE EXCEPTION
      'تم إرسال عدة طلبات خلال وقت قصير. انتظر عشر دقائق أو تواصل معنا.';
  END IF;

  v_formatted_address := CONCAT_WS(
    ' - ',
    NULLIF(TRIM(p_governorate), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), '')
  );

  v_result := public.create_customer_order(
    TRIM(p_customer_full_name),
    v_phone,
    NULL,
    TRIM(p_governorate),
    TRIM(p_city),
    TRIM(p_area),
    TRIM(p_street),
    NULLIF(TRIM(p_building), ''),
    NULL,
    NULL,
    NULLIF(TRIM(p_address_notes), ''),
    NULL,
    NULL,
    v_formatted_address,
    NULLIF(TRIM(p_google_maps_url), ''),
    v_location_source,
    NULL,
    NULL,
    p_items,
    0,
    0,
    NULLIF(TRIM(p_customer_notes), ''),
    NULL,
    'website'
  );

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  UPDATE public.orders
  SET idempotency_key = v_key, updated_at = NOW()
  WHERE id = (v_result->>'order_id')::UUID;

  RETURN v_result || jsonb_build_object(
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO anon, authenticated;

COMMENT ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) IS
  'Safe public guest-checkout wrapper. Delegates customer/order/stock logic to create_customer_order with idempotency and practical rate limits.';
