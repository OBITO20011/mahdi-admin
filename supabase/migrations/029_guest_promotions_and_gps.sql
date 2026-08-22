-- =========================================================================
-- Nawasrah ERP - Migration 029
-- Guest GPS delivery location and server-authoritative promotion codes.
--
-- Pricing, customer linking, order creation, and inventory reservation remain
-- owned by public.create_customer_order. The public checkout can only provide
-- a promotion code; it can never provide a discount amount.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.promotion_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  description_ar TEXT,
  discount_type TEXT NOT NULL CHECK (
    discount_type IN ('fixed', 'percentage')
  ),
  discount_value BIGINT NOT NULL,
  minimum_subtotal_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (
    minimum_subtotal_in_minor_units >= 0
  ),
  maximum_discount_in_minor_units BIGINT CHECK (
    maximum_discount_in_minor_units IS NULL
    OR maximum_discount_in_minor_units > 0
  ),
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  maximum_total_redemptions INTEGER CHECK (
    maximum_total_redemptions IS NULL
    OR maximum_total_redemptions > 0
  ),
  maximum_redemptions_per_phone INTEGER NOT NULL DEFAULT 1 CHECK (
    maximum_redemptions_per_phone > 0
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotion_codes_code_format_check CHECK (
    code = UPPER(TRIM(code))
    AND code ~ '^[A-Z0-9_-]{3,32}$'
  ),
  CONSTRAINT promotion_codes_value_check CHECK (
    (
      discount_type = 'fixed'
      AND discount_value > 0
    )
    OR (
      discount_type = 'percentage'
      AND discount_value BETWEEN 1 AND 10000
    )
  ),
  CONSTRAINT promotion_codes_dates_check CHECK (
    starts_at IS NULL
    OR expires_at IS NULL
    OR starts_at < expires_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_codes_normalized_code
  ON public.promotion_codes(UPPER(TRIM(code)));

CREATE INDEX IF NOT EXISTS idx_promotion_codes_active_window
  ON public.promotion_codes(is_active, starts_at, expires_at);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promotion_code_id UUID
    REFERENCES public.promotion_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_code_snapshot TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_promotion_code_id
  ON public.orders(promotion_code_id)
  WHERE promotion_code_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_code_id UUID NOT NULL
    REFERENCES public.promotion_codes(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL UNIQUE
    REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_phone TEXT NOT NULL,
  code_snapshot TEXT NOT NULL,
  discount_in_minor_units BIGINT NOT NULL CHECK (
    discount_in_minor_units > 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_code
  ON public.promotion_redemptions(promotion_code_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_phone
  ON public.promotion_redemptions(
    promotion_code_id,
    customer_phone,
    created_at DESC
  );

ALTER TABLE public.promotion_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_update_promotion_codes_updated_at
  ON public.promotion_codes;
CREATE TRIGGER trg_update_promotion_codes_updated_at
BEFORE UPDATE ON public.promotion_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- One canonical promotion calculator for preview and final submission.
-- Percentage values are stored as basis points: 1250 = 12.50%.
-- Fixed values and all totals are stored in JOD minor units (fils).
-- -------------------------------------------------------------------------
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
    OR jsonb_array_length(p_items) > 30
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

CREATE OR REPLACE FUNCTION public.preview_guest_promotion(
  p_code TEXT,
  p_items JSONB,
  p_customer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._calculate_guest_promotion(
    p_code,
    p_items,
    p_customer_phone
  );
$$;

REVOKE ALL ON FUNCTION public.preview_guest_promotion(
  TEXT, JSONB, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_guest_promotion(
  TEXT, JSONB, TEXT
) TO anon, authenticated;

-- -------------------------------------------------------------------------
-- Authenticated promotion administration. Direct table writes remain blocked.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_promotion_codes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_codes JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'عرض رموز الخصم'
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
  INTO v_codes
  FROM (
    SELECT
      pc.id,
      pc.code,
      pc.description_ar,
      pc.discount_type,
      pc.discount_value,
      pc.minimum_subtotal_in_minor_units,
      pc.maximum_discount_in_minor_units,
      pc.starts_at,
      pc.expires_at,
      pc.maximum_total_redemptions,
      pc.maximum_redemptions_per_phone,
      pc.is_active,
      pc.created_at,
      pc.updated_at,
      COUNT(pr.id)::INTEGER AS redemption_count,
      COALESCE(SUM(pr.discount_in_minor_units), 0)::BIGINT
        AS redeemed_discount_in_minor_units
    FROM public.promotion_codes AS pc
    LEFT JOIN public.promotion_redemptions AS pr
      ON pr.promotion_code_id = pc.id
    GROUP BY pc.id
    ORDER BY pc.created_at DESC
  ) AS row_data;

  RETURN jsonb_build_object('success', true, 'codes', v_codes);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_promotion_code(
  p_code TEXT,
  p_discount_type TEXT,
  p_discount_value BIGINT,
  p_promotion_code_id UUID DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_minimum_subtotal_in_minor_units BIGINT DEFAULT 0,
  p_maximum_discount_in_minor_units BIGINT DEFAULT NULL,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_maximum_total_redemptions INTEGER DEFAULT NULL,
  p_maximum_redemptions_per_phone INTEGER DEFAULT 1,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := UPPER(NULLIF(TRIM(p_code), ''));
  v_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إدارة رموز الخصم'
  );

  IF v_code IS NULL OR v_code !~ '^[A-Z0-9_-]{3,32}$' THEN
    RAISE EXCEPTION 'رمز الخصم يجب أن يحتوي 3 إلى 32 حرفاً أو رقماً.';
  END IF;

  IF p_discount_type NOT IN ('fixed', 'percentage') THEN
    RAISE EXCEPTION 'نوع الخصم غير صحيح.';
  END IF;

  IF p_discount_type = 'fixed' AND COALESCE(p_discount_value, 0) <= 0 THEN
    RAISE EXCEPTION 'قيمة الخصم الثابت يجب أن تكون أكبر من صفر.';
  END IF;

  IF p_discount_type = 'percentage'
    AND COALESCE(p_discount_value, 0) NOT BETWEEN 1 AND 10000
  THEN
    RAISE EXCEPTION 'نسبة الخصم يجب أن تكون أكبر من صفر ولا تتجاوز 100%%.';
  END IF;

  IF COALESCE(p_minimum_subtotal_in_minor_units, -1) < 0
    OR (
      p_maximum_discount_in_minor_units IS NOT NULL
      AND p_maximum_discount_in_minor_units <= 0
    )
    OR (
      p_maximum_total_redemptions IS NOT NULL
      AND p_maximum_total_redemptions <= 0
    )
    OR COALESCE(p_maximum_redemptions_per_phone, 0) <= 0
  THEN
    RAISE EXCEPTION 'حدود استخدام رمز الخصم غير صحيحة.';
  END IF;

  IF p_starts_at IS NOT NULL
    AND p_expires_at IS NOT NULL
    AND p_starts_at >= p_expires_at
  THEN
    RAISE EXCEPTION 'تاريخ انتهاء الخصم يجب أن يكون بعد تاريخ بدايته.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.promotion_codes AS pc
    WHERE pc.code = v_code
      AND pc.id IS DISTINCT FROM p_promotion_code_id
  ) THEN
    RAISE EXCEPTION 'رمز الخصم مستخدم مسبقاً.';
  END IF;

  IF p_promotion_code_id IS NULL THEN
    INSERT INTO public.promotion_codes (
      code,
      description_ar,
      discount_type,
      discount_value,
      minimum_subtotal_in_minor_units,
      maximum_discount_in_minor_units,
      starts_at,
      expires_at,
      maximum_total_redemptions,
      maximum_redemptions_per_phone,
      is_active,
      created_by
    ) VALUES (
      v_code,
      NULLIF(TRIM(p_description_ar), ''),
      p_discount_type,
      p_discount_value,
      p_minimum_subtotal_in_minor_units,
      p_maximum_discount_in_minor_units,
      p_starts_at,
      p_expires_at,
      p_maximum_total_redemptions,
      p_maximum_redemptions_per_phone,
      COALESCE(p_is_active, true),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.promotion_codes
    SET
      code = v_code,
      description_ar = NULLIF(TRIM(p_description_ar), ''),
      discount_type = p_discount_type,
      discount_value = p_discount_value,
      minimum_subtotal_in_minor_units =
        p_minimum_subtotal_in_minor_units,
      maximum_discount_in_minor_units =
        p_maximum_discount_in_minor_units,
      starts_at = p_starts_at,
      expires_at = p_expires_at,
      maximum_total_redemptions = p_maximum_total_redemptions,
      maximum_redemptions_per_phone =
        p_maximum_redemptions_per_phone,
      is_active = COALESCE(p_is_active, true),
      updated_at = NOW()
    WHERE id = p_promotion_code_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'رمز الخصم المطلوب غير موجود.';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN p_promotion_code_id IS NULL
      THEN 'CREATE_PROMOTION_CODE'
      ELSE 'UPDATE_PROMOTION_CODE'
    END,
    'promotion_codes',
    v_id,
    jsonb_build_object(
      'code', v_code,
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'is_active', COALESCE(p_is_active, true)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'promotion_code_id', v_id,
    'code', v_code,
    'message', CASE
      WHEN p_promotion_code_id IS NULL
      THEN 'تم إنشاء رمز الخصم.'
      ELSE 'تم تحديث رمز الخصم.'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_promotion_code_active(
  p_promotion_code_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تفعيل أو إيقاف رمز الخصم'
  );

  UPDATE public.promotion_codes
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_promotion_code_id
  RETURNING code INTO v_code;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'رمز الخصم المطلوب غير موجود.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'SET_PROMOTION_CODE_ACTIVE',
    'promotion_codes',
    p_promotion_code_id,
    jsonb_build_object('code', v_code, 'is_active', p_is_active)
  );

  RETURN jsonb_build_object(
    'success', true,
    'promotion_code_id', p_promotion_code_id,
    'code', v_code,
    'is_active', p_is_active,
    'message', CASE
      WHEN p_is_active THEN 'تم تفعيل رمز الخصم.'
      ELSE 'تم إيقاف رمز الخصم مع حفظ سجله.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_promotion_codes()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_promotion_code(
  TEXT, TEXT, BIGINT, UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ,
  TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_promotion_code_active(UUID, BOOLEAN)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_promotion_codes()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_promotion_code(
  TEXT, TEXT, BIGINT, UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ,
  TIMESTAMPTZ, INTEGER, INTEGER, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_promotion_code_active(UUID, BOOLEAN)
  TO authenticated;

-- -------------------------------------------------------------------------
-- Replace the public checkout signature with GPS and promotion inputs.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
);

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

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT
) IS
  'Safe guest checkout with GPS and server-calculated promotion codes. Delegates customer, order, price, and stock logic to create_customer_order.';
