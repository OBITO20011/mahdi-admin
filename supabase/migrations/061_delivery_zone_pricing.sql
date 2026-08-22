-- Delivery-zone pricing for public storefront orders.
-- The browser submits only the selected zone; PostgreSQL owns the fee calculation.

ALTER TABLE public.storefront_settings
  ADD COLUMN IF NOT EXISTS inside_ramtha_delivery_fee_in_minor_units BIGINT,
  ADD COLUMN IF NOT EXISTS outside_ramtha_delivery_fee_in_minor_units BIGINT;

UPDATE public.storefront_settings
SET inside_ramtha_delivery_fee_in_minor_units = COALESCE(
      inside_ramtha_delivery_fee_in_minor_units,
      delivery_fee_in_minor_units,
      0
    ),
    outside_ramtha_delivery_fee_in_minor_units = COALESCE(
      outside_ramtha_delivery_fee_in_minor_units,
      delivery_fee_in_minor_units,
      0
    );

ALTER TABLE public.storefront_settings
  ALTER COLUMN inside_ramtha_delivery_fee_in_minor_units SET DEFAULT 0,
  ALTER COLUMN inside_ramtha_delivery_fee_in_minor_units SET NOT NULL,
  ALTER COLUMN outside_ramtha_delivery_fee_in_minor_units SET DEFAULT 0,
  ALTER COLUMN outside_ramtha_delivery_fee_in_minor_units SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storefront_settings_inside_ramtha_delivery_fee_check'
  ) THEN
    ALTER TABLE public.storefront_settings
      ADD CONSTRAINT storefront_settings_inside_ramtha_delivery_fee_check
      CHECK (inside_ramtha_delivery_fee_in_minor_units >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'storefront_settings_outside_ramtha_delivery_fee_check'
  ) THEN
    ALTER TABLE public.storefront_settings
      ADD CONSTRAINT storefront_settings_outside_ramtha_delivery_fee_check
      CHECK (outside_ramtha_delivery_fee_in_minor_units >= 0);
  END IF;
END;
$$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_zone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_zone_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_delivery_zone_check
      CHECK (
        delivery_zone IS NULL
        OR delivery_zone IN ('inside_ramtha', 'outside_ramtha')
      );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_storefront_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'storeNameAr', store_name_ar,
    'whatsappNumber', whatsapp_number,
    'cliqAlias', cliq_alias,
    'ordersEnabled', orders_enabled,
    'announcementText', announcement_text,
    'businessHoursText', business_hours_text,
    'deliveryAreasText', delivery_areas_text,
    'deliveryEtaText', delivery_eta_text,
    'exchangePolicyText', exchange_policy_text,
    'minimumOrderInMinorUnits', minimum_order_in_minor_units,
    -- Kept during rollout for older clients. It represents inside Ramtha.
    'deliveryFeeInMinorUnits', inside_ramtha_delivery_fee_in_minor_units,
    'insideRamthaDeliveryFeeInMinorUnits', inside_ramtha_delivery_fee_in_minor_units,
    'outsideRamthaDeliveryFeeInMinorUnits', outside_ramtha_delivery_fee_in_minor_units,
    'showNewestProducts', show_newest_products,
    'showBestSellers', show_best_sellers,
    'showOffers', show_offers,
    'showLowStock', show_low_stock,
    'updatedAt', updated_at
  )
  FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;
$$;

CREATE OR REPLACE FUNCTION public.save_storefront_settings_v3(
  p_store_name_ar TEXT,
  p_whatsapp_number TEXT,
  p_cliq_alias TEXT,
  p_orders_enabled BOOLEAN,
  p_announcement_text TEXT,
  p_business_hours_text TEXT,
  p_delivery_areas_text TEXT,
  p_delivery_eta_text TEXT,
  p_exchange_policy_text TEXT,
  p_minimum_order_in_minor_units BIGINT,
  p_inside_ramtha_delivery_fee_in_minor_units BIGINT,
  p_outside_ramtha_delivery_fee_in_minor_units BIGINT,
  p_show_newest_products BOOLEAN,
  p_show_best_sellers BOOLEAN,
  p_show_offers BOOLEAN,
  p_show_low_stock BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF COALESCE(p_inside_ramtha_delivery_fee_in_minor_units, -1) < 0
    OR COALESCE(p_outside_ramtha_delivery_fee_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION 'أجور التوصيل يجب ألا تكون سالبة.';
  END IF;

  PERFORM public.save_storefront_settings_v2(
    p_store_name_ar,
    p_whatsapp_number,
    p_cliq_alias,
    p_orders_enabled,
    p_announcement_text,
    p_business_hours_text,
    p_delivery_areas_text,
    p_delivery_eta_text,
    p_exchange_policy_text,
    p_minimum_order_in_minor_units,
    p_inside_ramtha_delivery_fee_in_minor_units,
    p_show_newest_products,
    p_show_best_sellers,
    p_show_offers,
    p_show_low_stock
  );

  UPDATE public.storefront_settings
  SET inside_ramtha_delivery_fee_in_minor_units = p_inside_ramtha_delivery_fee_in_minor_units,
      outside_ramtha_delivery_fee_in_minor_units = p_outside_ramtha_delivery_fee_in_minor_units,
      delivery_fee_in_minor_units = p_inside_ramtha_delivery_fee_in_minor_units,
      updated_at = NOW(),
      updated_by = v_user_id
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id,
    'save_storefront_delivery_zone_fees',
    'storefront_settings',
    '00000000-0000-0000-0000-000000000001'::UUID,
    jsonb_build_object(
      'inside_ramtha_delivery_fee_in_minor_units',
        p_inside_ramtha_delivery_fee_in_minor_units,
      'outside_ramtha_delivery_fee_in_minor_units',
        p_outside_ramtha_delivery_fee_in_minor_units
    )
  );

  RETURN public.get_public_storefront_settings() || jsonb_build_object(
    'success', true,
    'message', 'تم حفظ أسعار التوصيل داخل الرمثا وخارجها وتطبيقها على الموقع.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_storefront_settings_v2(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) FROM authenticated;

REVOKE ALL ON FUNCTION public.save_storefront_settings_v3(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_settings_v3(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) TO authenticated;

DROP FUNCTION IF EXISTS public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
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

  SELECT payment_method, delivery_zone, delivery_fee_in_minor_units,
         total_in_minor_units
  INTO v_existing_payment_method, v_existing_delivery_zone,
       v_existing_delivery_fee, v_existing_total
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
      'payment_status', 'unpaid'
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
    'payment_status', 'unpaid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON COLUMN public.orders.delivery_zone IS
  'Public delivery pricing zone selected at checkout: inside_ramtha or outside_ramtha.';
COMMENT ON FUNCTION public.save_storefront_settings_v3(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT,
  BIGINT, BIGINT, BIGINT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) IS 'Authenticated storefront settings update with audited inside/outside Ramtha delivery fees.';
COMMENT ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT, TEXT
) IS 'Public guest checkout; PostgreSQL selects the authoritative delivery fee from the chosen zone.';
