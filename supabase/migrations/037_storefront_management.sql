-- =========================================================================
-- Nawasrah ERP - Storefront management center
-- One protected settings record controls the public wholesale storefront.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.storefront_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::UUID
    CHECK (id = '00000000-0000-0000-0000-000000000001'::UUID),
  store_name_ar TEXT NOT NULL DEFAULT 'محلات النواصرة',
  whatsapp_number TEXT NOT NULL DEFAULT '0772838886',
  cliq_alias TEXT NOT NULL DEFAULT '',
  orders_enabled BOOLEAN NOT NULL DEFAULT true,
  announcement_text TEXT NOT NULL DEFAULT 'الأسعار والكميات تُحدّث مباشرة من مخزون محلات النواصرة',
  business_hours_text TEXT NOT NULL DEFAULT 'يُؤكد وقت التجهيز والتوصيل بعد مراجعة الطلب.',
  delivery_areas_text TEXT NOT NULL DEFAULT 'الرمثا وإربد والمناطق المحيطة، وتُؤكد المنطقة مع الإدارة.',
  delivery_eta_text TEXT NOT NULL DEFAULT 'تعتمد على المنطقة وتوفر الأصناف ويؤكدها فريق المتجر.',
  exchange_policy_text TEXT NOT NULL DEFAULT 'تواصل معنا فورًا عند وجود خطأ أو تلف قبل فتح الطرد.',
  minimum_order_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (minimum_order_in_minor_units >= 0),
  delivery_fee_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (delivery_fee_in_minor_units >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.storefront_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001'::UUID)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storefront_settings FROM PUBLIC, anon, authenticated;

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
    'deliveryFeeInMinorUnits', delivery_fee_in_minor_units,
    'updatedAt', updated_at
  )
  FROM public.storefront_settings
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_settings()
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_storefront_settings(
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
  p_delivery_fee_in_minor_units BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_whatsapp TEXT := regexp_replace(COALESCE(p_whatsapp_number, ''), '[^0-9]', '', 'g');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'إدارة إعدادات المتجر الإلكتروني'
  );

  IF CHAR_LENGTH(TRIM(COALESCE(p_store_name_ar, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'اسم المتجر يجب أن يكون بين حرفين و120 حرفًا.';
  END IF;
  IF v_whatsapp !~ '^[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'رقم واتساب غير صحيح.';
  END IF;
  IF CHAR_LENGTH(TRIM(COALESCE(p_cliq_alias, ''))) > 120 THEN
    RAISE EXCEPTION 'اسم CliQ أطول من المسموح.';
  END IF;
  IF CHAR_LENGTH(TRIM(COALESCE(p_announcement_text, ''))) NOT BETWEEN 2 AND 300
    OR CHAR_LENGTH(TRIM(COALESCE(p_business_hours_text, ''))) NOT BETWEEN 2 AND 500
    OR CHAR_LENGTH(TRIM(COALESCE(p_delivery_areas_text, ''))) NOT BETWEEN 2 AND 500
    OR CHAR_LENGTH(TRIM(COALESCE(p_delivery_eta_text, ''))) NOT BETWEEN 2 AND 500
    OR CHAR_LENGTH(TRIM(COALESCE(p_exchange_policy_text, ''))) NOT BETWEEN 2 AND 500
  THEN
    RAISE EXCEPTION 'أكمل نصوص معلومات المتجر ضمن الطول المسموح.';
  END IF;
  IF COALESCE(p_minimum_order_in_minor_units, -1) < 0
    OR COALESCE(p_delivery_fee_in_minor_units, -1) < 0
  THEN
    RAISE EXCEPTION 'الحد الأدنى ورسوم التوصيل لا يمكن أن يكونا سالبين.';
  END IF;

  INSERT INTO public.storefront_settings (
    id, store_name_ar, whatsapp_number, cliq_alias, orders_enabled,
    announcement_text, business_hours_text, delivery_areas_text,
    delivery_eta_text, exchange_policy_text,
    minimum_order_in_minor_units, delivery_fee_in_minor_units,
    updated_at, updated_by
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    TRIM(p_store_name_ar), v_whatsapp, TRIM(COALESCE(p_cliq_alias, '')),
    COALESCE(p_orders_enabled, false), TRIM(p_announcement_text),
    TRIM(p_business_hours_text), TRIM(p_delivery_areas_text),
    TRIM(p_delivery_eta_text), TRIM(p_exchange_policy_text),
    p_minimum_order_in_minor_units, p_delivery_fee_in_minor_units,
    NOW(), v_user_id
  )
  ON CONFLICT (id) DO UPDATE SET
    store_name_ar = EXCLUDED.store_name_ar,
    whatsapp_number = EXCLUDED.whatsapp_number,
    cliq_alias = EXCLUDED.cliq_alias,
    orders_enabled = EXCLUDED.orders_enabled,
    announcement_text = EXCLUDED.announcement_text,
    business_hours_text = EXCLUDED.business_hours_text,
    delivery_areas_text = EXCLUDED.delivery_areas_text,
    delivery_eta_text = EXCLUDED.delivery_eta_text,
    exchange_policy_text = EXCLUDED.exchange_policy_text,
    minimum_order_in_minor_units = EXCLUDED.minimum_order_in_minor_units,
    delivery_fee_in_minor_units = EXCLUDED.delivery_fee_in_minor_units,
    updated_at = NOW(),
    updated_by = v_user_id;

  INSERT INTO public.audit_logs (user_id, action, entity_name, entity_id, details)
  VALUES (
    v_user_id,
    'save_storefront_settings',
    'storefront_settings',
    '00000000-0000-0000-0000-000000000001'::UUID,
    jsonb_build_object(
      'orders_enabled', p_orders_enabled,
      'minimum_order_in_minor_units', p_minimum_order_in_minor_units,
      'delivery_fee_in_minor_units', p_delivery_fee_in_minor_units
    )
  );

  RETURN public.get_public_storefront_settings() || jsonb_build_object(
    'success', true,
    'message', 'تم حفظ إعدادات المتجر الإلكتروني وتطبيقها بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_storefront_settings(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_storefront_settings(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BIGINT
) TO authenticated;

-- Apply operational settings inside the existing guarded checkout boundary.
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
  p_payment_method TEXT DEFAULT 'cash_on_delivery'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment_method TEXT := LOWER(NULLIF(TRIM(p_payment_method), ''));
  v_result JSONB;
  v_order_id UUID;
  v_existing_payment_method TEXT;
  v_settings public.storefront_settings%ROWTYPE;
  v_is_replay BOOLEAN;
  v_total BIGINT;
BEGIN
  IF v_payment_method NOT IN ('cash_on_delivery', 'cliq') THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة. اختر كاش عند الاستلام أو CliQ.';
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

  IF NOT v_is_replay THEN
    IF NOT COALESCE(v_settings.orders_enabled, false) THEN
      RAISE EXCEPTION 'الطلبات متوقفة مؤقتًا من إدارة المتجر. تواصل معنا عبر واتساب.';
    END IF;
    IF (v_result->>'subtotal')::BIGINT < v_settings.minimum_order_in_minor_units THEN
      RAISE EXCEPTION 'قيمة الطلب أقل من الحد الأدنى المطلوب وهو % د.أ.',
        to_char(v_settings.minimum_order_in_minor_units / 1000.0, 'FM999999990.000');
    END IF;

    v_total := (v_result->>'total')::BIGINT + v_settings.delivery_fee_in_minor_units;
    UPDATE public.orders
    SET delivery_fee_in_minor_units = v_settings.delivery_fee_in_minor_units,
        total_in_minor_units = v_total,
        updated_at = NOW()
    WHERE id = v_order_id;
    v_result := jsonb_set(v_result, '{total}', to_jsonb(v_total), true)
      || jsonb_build_object('delivery_fee', v_settings.delivery_fee_in_minor_units);
  END IF;

  SELECT payment_method INTO v_existing_payment_method
  FROM public.orders WHERE id = v_order_id FOR UPDATE;

  IF v_is_replay AND v_existing_payment_method IS DISTINCT FROM v_payment_method THEN
    RAISE EXCEPTION 'تغيرت طريقة الدفع لطلب محفوظ مسبقًا. أعد إرسال الطلب.';
  END IF;

  UPDATE public.orders
  SET payment_method = v_payment_method,
      payment_status = 'unpaid',
      updated_at = NOW()
  WHERE id = v_order_id;

  RETURN v_result || jsonb_build_object(
    'payment_method', v_payment_method,
    'payment_status', 'unpaid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_guest_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, JSONB, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON TABLE public.storefront_settings IS
  'Singleton operational settings for the public wholesale storefront; writes are RPC-only and audited.';
