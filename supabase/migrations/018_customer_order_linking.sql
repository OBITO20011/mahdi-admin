-- =========================================================================
-- Nawasrah ERP - Migration 018
-- Reliable customer identity and customer-order linking.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. One canonical phone representation for website and admin entries.
--    Jordan mobile numbers such as 079..., 96279..., +96279..., and 79...
--    resolve to the same local value (079...).
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_customer_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  WITH cleaned AS (
    SELECT regexp_replace(TRIM(p_phone), '[^0-9]', '', 'g') AS digits
  ),
  international_prefix_removed AS (
    SELECT CASE
      WHEN digits LIKE '00962%' THEN SUBSTRING(digits FROM 3)
      ELSE digits
    END AS digits
    FROM cleaned
  )
  SELECT CASE
    WHEN digits ~ '^962[0-9]{9}$' THEN '0' || SUBSTRING(digits FROM 4)
    WHEN digits ~ '^7[0-9]{8}$' THEN '0' || digits
    ELSE digits
  END
  FROM international_prefix_removed;
$$;

-- Existing records are standardized before adding the uniqueness guard.
UPDATE public.customers
SET phone = public.normalize_customer_phone(phone)
WHERE phone IS DISTINCT FROM public.normalize_customer_phone(phone);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_active_normalized_phone
  ON public.customers (
    (public.normalize_customer_phone(phone))
  )
  WHERE is_deleted = false;

COMMENT ON INDEX public.uq_customers_active_normalized_phone IS
  'Prevents duplicate active customer profiles when the same phone is entered in different formats.';

-- Repair legacy data that marked more than one address as the default.
WITH ranked_defaults AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY created_at DESC, id DESC
    ) AS default_rank
  FROM public.customer_addresses
  WHERE is_default = true
)
UPDATE public.customer_addresses AS address
SET is_default = false
FROM ranked_defaults AS ranked
WHERE address.id = ranked.id
  AND ranked.default_rank > 1;

-- -------------------------------------------------------------------------
-- 2. Admin customer writes use the same canonical identity rule.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_customer(
  p_full_name TEXT,
  p_phone TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT NULL,
  p_whatsapp TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_customer_type TEXT DEFAULT 'retail'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_customer_id UUID := p_customer_id;
  v_phone TEXT := public.normalize_customer_phone(p_phone);
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'حفظ بيانات العملاء'
  );

  IF NULLIF(TRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'اسم العميل مطلوب.';
  END IF;
  IF NULLIF(v_phone, '') IS NULL OR v_phone !~ '^[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'رقم هاتف العميل غير صحيح.';
  END IF;
  IF p_customer_type NOT IN ('retail', 'wholesale') THEN
    RAISE EXCEPTION 'تصنيف العميل غير معتمد.';
  END IF;

  -- Serialize writes for the same customer identity and avoid race duplicates.
  PERFORM pg_advisory_xact_lock(hashtext(v_phone)::BIGINT);

  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE public.normalize_customer_phone(phone) = v_phone
      AND id IS DISTINCT FROM p_customer_id
      AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'يوجد عميل آخر مسجل بنفس رقم الهاتف.';
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      full_name,
      phone,
      email,
      governorate,
      whatsapp,
      notes,
      customer_type,
      is_active,
      is_deleted
    ) VALUES (
      TRIM(p_full_name),
      v_phone,
      NULLIF(TRIM(p_email), ''),
      NULLIF(TRIM(p_governorate), ''),
      NULLIF(TRIM(p_whatsapp), ''),
      NULLIF(TRIM(p_notes), ''),
      p_customer_type,
      true,
      false
    )
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET
      full_name = TRIM(p_full_name),
      phone = v_phone,
      email = NULLIF(TRIM(p_email), ''),
      governorate = NULLIF(TRIM(p_governorate), ''),
      whatsapp = NULLIF(TRIM(p_whatsapp), ''),
      notes = NULLIF(TRIM(p_notes), ''),
      customer_type = p_customer_type,
      updated_at = NOW()
    WHERE id = v_customer_id
      AND is_deleted = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'العميل غير موجود أو محذوف.';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    CASE WHEN p_customer_id IS NULL
      THEN 'CREATE_CUSTOMER'
      ELSE 'UPDATE_CUSTOMER'
    END,
    'customers',
    v_customer_id,
    jsonb_build_object(
      'full_name', TRIM(p_full_name),
      'phone', v_phone,
      'customer_type', p_customer_type
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer_id,
    'full_name', TRIM(p_full_name),
    'phone', v_phone
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 3. Website order creation always creates or reuses exactly one customer,
--    links the order and address, and keeps one current default address.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_location_source TEXT DEFAULT 'manual',
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_customer_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'website'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id UUID;
  v_customer_is_blocked BOOLEAN;
  v_customer_is_active BOOLEAN;
  v_customer_reused BOOLEAN := false;
  v_customer_phone TEXT :=
    public.normalize_customer_phone(p_customer_phone);
  v_address_id UUID;
  v_branch_id UUID := p_branch_id;
  v_warehouse_id UUID := p_warehouse_id;
  v_order_id UUID;
  v_order_number TEXT;
  v_item JSONB;
  v_prod_id UUID;
  v_qty INT;
  v_prod_name TEXT;
  v_prod_sku TEXT;
  v_unit_price BIGINT;
  v_is_active BOOLEAN;
  v_on_hand INT;
  v_reserved INT;
  v_available INT;
  v_line_total BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_formatted_address TEXT;
  v_google_maps_url TEXT;
BEGIN
  IF NULLIF(TRIM(p_customer_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'اسم العميل مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;
  IF NULLIF(v_customer_phone, '') IS NULL
    OR v_customer_phone !~ '^[0-9]{9,15}$'
  THEN
    RAISE EXCEPTION 'رقم هاتف العميل غير صحيح.';
  END IF;
  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة الطلب فارغة، يجب تقديم صنف واحد على الأقل.';
  END IF;
  IF COALESCE(p_delivery_fee_in_minor_units, 0) < 0
    OR COALESCE(p_discount_in_minor_units, 0) < 0
  THEN
    RAISE EXCEPTION 'رسوم التوصيل والخصم لا يمكن أن تكون سالبة.';
  END IF;
  IF COALESCE(p_location_source, 'manual')
    NOT IN ('gps', 'map_pin', 'manual')
  THEN
    RAISE EXCEPTION 'مصدر موقع التوصيل غير معتمد.';
  END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'يجب إدخال خط العرض وخط الطول معاً.';
  END IF;
  IF p_latitude IS NOT NULL
    AND (
      p_latitude NOT BETWEEN -90 AND 90
      OR p_longitude NOT BETWEEN -180 AND 180
    )
  THEN
    RAISE EXCEPTION 'إحداثيات موقع التوصيل غير صحيحة.';
  END IF;

  IF v_branch_id IS NULL THEN
    SELECT id
    INTO v_branch_id
    FROM public.branches
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    SELECT id
    INTO v_warehouse_id
    FROM public.warehouses
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على مستودع فعال لمعالجة الطلب.';
  END IF;

  -- One transaction at a time may resolve a specific customer phone.
  PERFORM pg_advisory_xact_lock(hashtext(v_customer_phone)::BIGINT);

  SELECT id, is_blocked, is_active
  INTO
    v_customer_id,
    v_customer_is_blocked,
    v_customer_is_active
  FROM public.customers
  WHERE public.normalize_customer_phone(phone) = v_customer_phone
    AND is_deleted = false
  LIMIT 1
  FOR UPDATE;

  IF v_customer_id IS NOT NULL THEN
    IF v_customer_is_blocked OR NOT v_customer_is_active THEN
      RAISE EXCEPTION
        'لا يمكن إنشاء طلب لهذا العميل لأن ملفه موقوف أو محظور.';
    END IF;

    v_customer_reused := true;

    UPDATE public.customers
    SET
      full_name = TRIM(p_customer_full_name),
      phone = v_customer_phone,
      email = COALESCE(NULLIF(TRIM(p_customer_email), ''), email),
      governorate = COALESCE(
        NULLIF(TRIM(p_governorate), ''),
        governorate
      ),
      updated_at = NOW()
    WHERE id = v_customer_id;
  ELSE
    INSERT INTO public.customers (
      full_name,
      phone,
      email,
      governorate,
      customer_type,
      is_active,
      is_blocked,
      is_deleted
    ) VALUES (
      TRIM(p_customer_full_name),
      v_customer_phone,
      NULLIF(TRIM(p_customer_email), ''),
      NULLIF(TRIM(p_governorate), ''),
      'retail',
      true,
      false,
      false
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- The latest website delivery address becomes the single default address.
  UPDATE public.customer_addresses
  SET is_default = false
  WHERE customer_id = v_customer_id
    AND is_default = true;

  v_formatted_address := COALESCE(
    NULLIF(TRIM(p_formatted_address), ''),
    NULLIF(
      CONCAT_WS(
        ' - ',
        NULLIF(TRIM(p_governorate), ''),
        NULLIF(TRIM(p_city), ''),
        NULLIF(TRIM(p_area), ''),
        NULLIF(TRIM(p_street), ''),
        NULLIF(TRIM(p_building), '')
      ),
      ''
    )
  );
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

  INSERT INTO public.customer_addresses (
    customer_id,
    governorate,
    city,
    area,
    street,
    building,
    floor,
    apartment,
    notes,
    latitude,
    longitude,
    formatted_address,
    google_maps_url,
    location_source,
    location_confirmed,
    is_default
  ) VALUES (
    v_customer_id,
    NULLIF(TRIM(p_governorate), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), ''),
    NULLIF(TRIM(p_floor), ''),
    NULLIF(TRIM(p_apartment), ''),
    NULLIF(TRIM(p_address_notes), ''),
    p_latitude,
    p_longitude,
    v_formatted_address,
    v_google_maps_url,
    COALESCE(p_location_source, 'manual'),
    p_latitude IS NOT NULL AND p_longitude IS NOT NULL,
    true
  )
  RETURNING id INTO v_address_id;

  -- Prices and availability are canonical and locked server-side.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_prod_id := (v_item->>'product_id')::UUID;
      v_qty := (v_item->>'quantity')::INT;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات صنف الطلب غير صحيحة.';
    END;

    IF v_prod_id IS NULL THEN
      RAISE EXCEPTION 'معرف المنتج مفقود في عناصر الطلب.';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'كمية المنتج يجب أن تكون أكبر من صفر.';
    END IF;

    SELECT name_ar, sku, sale_price_in_minor_units, is_active
    INTO v_prod_name, v_prod_sku, v_unit_price, v_is_active
    FROM public.products
    WHERE id = v_prod_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'المنتج المحدد برقم (%) غير موجود في النظام.',
        v_prod_id;
    END IF;
    IF NOT v_is_active THEN
      RAISE EXCEPTION
        'المنتج (%) غير نشط حالياً ولا يمكن طلبه.',
        v_prod_name;
    END IF;

    SELECT on_hand_quantity, reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_prod_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'المنتج (%) غير مسجل له رصيد في المستودع المحدد.',
        v_prod_name;
    END IF;

    v_available := v_on_hand - v_reserved;
    IF v_available < v_qty THEN
      RAISE EXCEPTION
        'الكمية المتاحة للمنتج (%) غير كافية. المتاح: %، المطلوب: %.',
        v_prod_name,
        v_available,
        v_qty;
    END IF;

    v_line_total := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total :=
    v_subtotal
    + COALESCE(p_delivery_fee_in_minor_units, 0)
    - COALESCE(p_discount_in_minor_units, 0);

  IF v_total < 0 THEN
    RAISE EXCEPTION 'قيمة الخصم أكبر من إجمالي الطلب.';
  END IF;

  LOOP
    v_order_number :=
      'ORD-'
      || TO_CHAR(NOW(), 'YYYYMMDD')
      || '-'
      || LPAD(
        (FLOOR(RANDOM() * 89999 + 10000))::TEXT,
        5,
        '0'
      );
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.orders
      WHERE order_number = v_order_number
    );
  END LOOP;

  INSERT INTO public.orders (
    order_number,
    customer_id,
    customer_address_id,
    customer_name_snapshot,
    branch_id,
    warehouse_id,
    status,
    payment_method,
    payment_status,
    subtotal_in_minor_units,
    delivery_fee_in_minor_units,
    discount_in_minor_units,
    total_in_minor_units,
    customer_notes,
    internal_notes,
    whatsapp_message,
    source
  ) VALUES (
    v_order_number,
    v_customer_id,
    v_address_id,
    TRIM(p_customer_full_name),
    v_branch_id,
    v_warehouse_id,
    'new',
    'cash_on_delivery',
    'unpaid',
    v_subtotal,
    COALESCE(p_delivery_fee_in_minor_units, 0),
    COALESCE(p_discount_in_minor_units, 0),
    v_total,
    NULLIF(TRIM(p_customer_notes), ''),
    NULLIF(TRIM(p_internal_notes), ''),
    'تم استلام طلبك رقم '
      || v_order_number
      || ' بقيمة إجمالية '
      || (v_total::NUMERIC / 1000)::TEXT
      || ' د.أ. سيتم التواصل معك لتأكيد التوصيل.',
    COALESCE(NULLIF(TRIM(p_source), ''), 'website')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::INT;

    SELECT name_ar, sku, sale_price_in_minor_units
    INTO v_prod_name, v_prod_sku, v_unit_price
    FROM public.products
    WHERE id = v_prod_id;

    v_line_total := v_unit_price * v_qty;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      quantity,
      unit_price_in_minor_units,
      line_total_in_minor_units
    ) VALUES (
      v_order_id,
      v_prod_id,
      v_prod_name,
      v_prod_sku,
      v_qty,
      v_unit_price,
      v_line_total
    );

    UPDATE public.inventory_balances
    SET
      reserved_quantity = reserved_quantity + v_qty,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_prod_id;
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    v_order_id,
    NULL,
    'new',
    v_user_id,
    'إنشاء الطلب وربطه بالعميل وحجز الكميات تلقائياً'
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'create_customer_order',
    'orders',
    v_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'customer_id', v_customer_id,
      'customer_phone', v_customer_phone,
      'customer_reused', v_customer_reused,
      'customer_address_id', v_address_id,
      'total_in_minor_units', v_total,
      'items_count', jsonb_array_length(p_items)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'customer_address_id', v_address_id,
    'customer_reused', v_customer_reused,
    'subtotal', v_subtotal,
    'total', v_total,
    'status', 'new',
    'message', 'تم إنشاء الطلب وربطه بملف العميل وحجز الكميات بنجاح.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_customer_phone(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.save_customer(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) TO anon, authenticated;
