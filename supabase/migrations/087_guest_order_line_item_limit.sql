-- =========================================================================
-- M5: Wholesale guest checkout supports at most fifty distinct line items.
-- This replaces only the historical 30-item guards in the private checkout
-- core and promotion calculator. Price, stock reservation, gateway, locking,
-- and idempotency behavior remain unchanged.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._calculate_guest_promotion(
  p_code TEXT,
  p_items JSONB,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := UPPER(NULLIF(TRIM(p_code), ''));
  v_phone TEXT := CASE
    WHEN NULLIF(TRIM(p_customer_phone), '') IS NULL THEN NULL
    ELSE public.normalize_customer_phone(p_customer_phone)
  END;
  v_promotion public.promotion_codes%ROWTYPE;
  v_item JSONB;
  v_product_id UUID;
  v_quantity INTEGER;
  v_package_price BIGINT;
  v_units_per_package INTEGER;
  v_subtotal BIGINT := 0;
  v_discount BIGINT := 0;
  v_total_redemptions INTEGER := 0;
  v_phone_redemptions INTEGER := 0;
BEGIN
  IF v_code IS NULL OR v_code !~ '^[A-Z0-9_-]{3,32}$' THEN
    RAISE EXCEPTION 'اكتب رمز خصم صحيحاً.';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
    OR jsonb_array_length(p_items) > 50
  THEN
    RAISE EXCEPTION 'سلة الطلب غير صالحة لحساب الخصم.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS item(value)
    GROUP BY item.value->>'product_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار المنتج نفسه داخل الطلب.';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::UUID;
      v_quantity := (v_item->>'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات أحد طرود الطلب غير صحيحة.';
    END;

    IF v_product_id IS NULL OR COALESCE(v_quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'بيانات أحد طرود الطلب غير صحيحة.';
    END IF;

    SELECT
      p.default_sale_price_in_minor_units,
      p.units_per_sale_unit
    INTO v_package_price, v_units_per_package
    FROM public.products AS p
    WHERE p.id = v_product_id
      AND p.is_active = true;

    IF NOT FOUND
      OR COALESCE(v_package_price, 0) <= 0
      OR COALESCE(v_units_per_package, 0) <= 0
    THEN
      RAISE EXCEPTION 'أحد منتجات السلة غير متاح للبيع.';
    END IF;

    v_subtotal := v_subtotal + (v_quantity * v_package_price);
  END LOOP;

  SELECT pc.*
  INTO v_promotion
  FROM public.promotion_codes AS pc
  WHERE pc.code = v_code
  FOR UPDATE;

  IF NOT FOUND OR NOT v_promotion.is_active THEN
    RAISE EXCEPTION 'رمز الخصم غير صحيح أو غير فعال.';
  END IF;

  IF v_promotion.starts_at IS NOT NULL
    AND NOW() < v_promotion.starts_at
  THEN
    RAISE EXCEPTION 'رمز الخصم لم يبدأ بعد.';
  END IF;

  IF v_promotion.expires_at IS NOT NULL
    AND NOW() >= v_promotion.expires_at
  THEN
    RAISE EXCEPTION 'انتهت صلاحية رمز الخصم.';
  END IF;

  IF v_subtotal < v_promotion.minimum_subtotal_in_minor_units THEN
    RAISE EXCEPTION
      'الطلب لا يصل إلى الحد الأدنى المطلوب لهذا الخصم.';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_total_redemptions
  FROM public.promotion_redemptions AS pr
  WHERE pr.promotion_code_id = v_promotion.id;

  IF v_promotion.maximum_total_redemptions IS NOT NULL
    AND v_total_redemptions >= v_promotion.maximum_total_redemptions
  THEN
    RAISE EXCEPTION 'تم استنفاد عدد استخدامات رمز الخصم.';
  END IF;

  IF v_phone IS NOT NULL THEN
    IF v_phone !~ '^07[789][0-9]{7}$' THEN
      RAISE EXCEPTION 'رقم الهاتف الأردني غير صحيح.';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_phone_redemptions
    FROM public.promotion_redemptions AS pr
    WHERE pr.promotion_code_id = v_promotion.id
      AND pr.customer_phone = v_phone;

    IF v_phone_redemptions >=
      v_promotion.maximum_redemptions_per_phone
    THEN
      RAISE EXCEPTION 'تم استخدام رمز الخصم لهذا الرقم من قبل.';
    END IF;
  END IF;

  IF v_promotion.discount_type = 'fixed' THEN
    v_discount := LEAST(v_promotion.discount_value, v_subtotal);
  ELSE
    v_discount := FLOOR(
      (v_subtotal::NUMERIC * v_promotion.discount_value::NUMERIC)
      / 10000
    )::BIGINT;

    IF v_promotion.maximum_discount_in_minor_units IS NOT NULL THEN
      v_discount := LEAST(
        v_discount,
        v_promotion.maximum_discount_in_minor_units
      );
    END IF;
  END IF;

  v_discount := LEAST(GREATEST(v_discount, 0), v_subtotal);
  IF v_discount <= 0 THEN
    RAISE EXCEPTION 'قيمة الخصم المحسوبة غير صالحة لهذا الطلب.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'promotion_code_id', v_promotion.id,
    'code', v_promotion.code,
    'description', v_promotion.description_ar,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_subtotal - v_discount,
    'message', 'تم تطبيق رمز الخصم بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public._calculate_guest_promotion(
  TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_guest_customer_order_core(
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
  p_items JSONB DEFAULT '[]'::jsonb,
  p_promotion_code TEXT DEFAULT NULL
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
  v_promotion_quote JSONB;
  v_promotion_id UUID;
  v_promotion_code TEXT;
  v_promotion_subtotal BIGINT;
  v_discount BIGINT := 0;
  v_existing_order_id UUID;
  v_existing_order_number TEXT;
  v_existing_customer_id UUID;
  v_existing_address_id UUID;
  v_existing_subtotal BIGINT;
  v_existing_discount BIGINT;
  v_existing_total BIGINT;
  v_existing_status TEXT;
  v_existing_phone TEXT;
  v_existing_promotion_code TEXT;
  v_recent_orders INTEGER;
  v_package_count BIGINT;
  v_location_source TEXT := CASE
    WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN 'gps'
    WHEN NULLIF(TRIM(p_google_maps_url), '') IS NOT NULL THEN 'map_pin'
    ELSE 'manual'
  END;
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
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

  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'يجب إرسال إحداثيات الموقع كاملة.';
  END IF;

  IF p_latitude IS NOT NULL
    AND (
      p_latitude NOT BETWEEN -90 AND 90
      OR p_longitude NOT BETWEEN -180 AND 180
    )
  THEN
    RAISE EXCEPTION 'إحداثيات موقع التوصيل غير صحيحة.';
  END IF;

  v_google_maps_url := COALESCE(
    NULLIF(TRIM(p_google_maps_url), ''),
    CASE
      WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL
      THEN
        'https://www.google.com/maps?q='
        || p_latitude::TEXT
        || ','
        || p_longitude::TEXT
      ELSE NULL
    END
  );

  IF v_google_maps_url IS NOT NULL
    AND (
      CHAR_LENGTH(v_google_maps_url) > 1000
      OR v_google_maps_url !~* '^https://'
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

  IF jsonb_array_length(p_items) > 50 THEN
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

  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT
    o.id,
    o.order_number,
    o.customer_id,
    o.customer_address_id,
    o.subtotal_in_minor_units,
    o.discount_in_minor_units,
    o.total_in_minor_units,
    o.status,
    c.phone,
    o.promotion_code_snapshot
  INTO
    v_existing_order_id,
    v_existing_order_number,
    v_existing_customer_id,
    v_existing_address_id,
    v_existing_subtotal,
    v_existing_discount,
    v_existing_total,
    v_existing_status,
    v_existing_phone,
    v_existing_promotion_code
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
      'discount', v_existing_discount,
      'total', v_existing_total,
      'promotion_code', v_existing_promotion_code,
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

  IF NULLIF(TRIM(p_promotion_code), '') IS NOT NULL THEN
    v_promotion_quote := public._calculate_guest_promotion(
      p_promotion_code,
      p_items,
      v_phone
    );
    v_promotion_id :=
      (v_promotion_quote->>'promotion_code_id')::UUID;
    v_promotion_code := v_promotion_quote->>'code';
    v_promotion_subtotal :=
      (v_promotion_quote->>'subtotal')::BIGINT;
    v_discount := (v_promotion_quote->>'discount')::BIGINT;
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
    p_latitude,
    p_longitude,
    v_formatted_address,
    v_google_maps_url,
    v_location_source,
    NULL,
    NULL,
    p_items,
    0,
    v_discount,
    NULLIF(TRIM(p_customer_notes), ''),
    NULL,
    'website'
  );

  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RETURN v_result;
  END IF;

  IF v_promotion_id IS NOT NULL
    AND (v_result->>'subtotal')::BIGINT <> v_promotion_subtotal
  THEN
    RAISE EXCEPTION
      'تغير سعر أحد الأصناف أثناء حساب الخصم. أعد تطبيق الرمز.';
  END IF;

  UPDATE public.orders
  SET
    idempotency_key = v_key,
    promotion_code_id = v_promotion_id,
    promotion_code_snapshot = v_promotion_code,
    updated_at = NOW()
  WHERE id = (v_result->>'order_id')::UUID;

  IF v_promotion_id IS NOT NULL THEN
    INSERT INTO public.promotion_redemptions (
      promotion_code_id,
      order_id,
      customer_id,
      customer_phone,
      code_snapshot,
      discount_in_minor_units
    ) VALUES (
      v_promotion_id,
      (v_result->>'order_id')::UUID,
      (v_result->>'customer_id')::UUID,
      v_phone,
      v_promotion_code,
      v_discount
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'idempotent_replay', false,
    'discount', v_discount,
    'promotion_code', v_promotion_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order_core(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.submit_guest_customer_order_core(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) IS 'Private canonical guest checkout core. Allows at most 50 distinct line items; pricing, stock reservation, promotions, locking, and idempotency remain server-authoritative.';
