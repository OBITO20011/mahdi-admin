-- =========================================================================
-- Nawasrah ERP - Migration 017
-- Clear operational orders, real customer accounts, and RPC-only CRM writes.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Complete the customer master-data schema used by the admin application.
-- -------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS governorate TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'retail',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_vip BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_limit_in_minor_units BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_customer_type_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_customer_type_check
      CHECK (customer_type IN ('retail', 'wholesale'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_credit_limit_minor_check'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_credit_limit_minor_check
      CHECK (credit_limit_in_minor_units >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_customers_active_directory
  ON public.customers(is_deleted, is_active, full_name);

-- -------------------------------------------------------------------------
-- 2. Customer payment vouchers, linked to one completed customer order.
-- -------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.customer_payment_number_seq START 1001;

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number TEXT UNIQUE NOT NULL,
  customer_id UUID NOT NULL
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL
    REFERENCES public.orders(id) ON DELETE RESTRICT,
  amount_in_minor_units BIGINT NOT NULL
    CHECK (amount_in_minor_units > 0),
  payment_method TEXT NOT NULL
    CHECK (payment_method IN (
      'cash',
      'cliq',
      'card',
      'bank_transfer',
      'cheque'
    )),
  reference_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
  ON public.customer_payments(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_order
  ON public.customer_payments(order_id, created_at DESC);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated staff can read customer payments"
  ON public.customer_payments;
CREATE POLICY "Authenticated staff can read customer payments"
  ON public.customer_payments
  FOR SELECT
  TO authenticated
  USING (true);

-- -------------------------------------------------------------------------
-- 3. Canonical order payment state.
-- Cash/CliQ/card orders become collected when completed; debt orders remain
-- outstanding until payment vouchers are recorded.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_order_payment_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.amount_paid_in_minor_units := LEAST(
    GREATEST(COALESCE(NEW.amount_paid_in_minor_units, 0), 0),
    NEW.total_in_minor_units
  );

  IF NEW.status = 'completed'
    AND COALESCE(NEW.payment_method, 'cash_on_delivery') <> 'debt'
  THEN
    NEW.amount_paid_in_minor_units := NEW.total_in_minor_units;
  END IF;

  NEW.payment_status := CASE
    WHEN NEW.amount_paid_in_minor_units >= NEW.total_in_minor_units
      THEN 'paid'
    WHEN NEW.amount_paid_in_minor_units > 0
      THEN 'partially_paid'
    ELSE 'unpaid'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_payment_state ON public.orders;
CREATE TRIGGER trg_sync_order_payment_state
BEFORE INSERT OR UPDATE OF
  status,
  payment_method,
  payment_status,
  total_in_minor_units,
  amount_paid_in_minor_units
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_order_payment_state();

UPDATE public.orders
SET amount_paid_in_minor_units = total_in_minor_units
WHERE status = 'completed'
  AND payment_status = 'paid'
  AND amount_paid_in_minor_units < total_in_minor_units
  AND COALESCE(payment_method, 'cash_on_delivery') <> 'debt';

-- -------------------------------------------------------------------------
-- 4. Customer master-data RPC.
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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'حفظ بيانات العملاء'
  );

  IF NULLIF(TRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'اسم العميل مطلوب.';
  END IF;
  IF NULLIF(TRIM(p_phone), '') IS NULL THEN
    RAISE EXCEPTION 'رقم هاتف العميل مطلوب.';
  END IF;
  IF p_customer_type NOT IN ('retail', 'wholesale') THEN
    RAISE EXCEPTION 'تصنيف العميل غير معتمد.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE phone = TRIM(p_phone)
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
      TRIM(p_phone),
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
      phone = TRIM(p_phone),
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
      'phone', TRIM(p_phone),
      'customer_type', p_customer_type
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer_id,
    'full_name', TRIM(p_full_name)
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 5. Customer block/unblock/soft-delete RPC.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_customer_status(
  p_customer_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_customer_name TEXT;
  v_outstanding BIGINT := 0;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تعديل حالة العميل'
  );

  IF p_action NOT IN ('block', 'unblock', 'delete') THEN
    RAISE EXCEPTION 'إجراء حالة العميل غير معتمد.';
  END IF;

  SELECT full_name
  INTO v_customer_name
  FROM public.customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;

  IF p_action = 'delete' THEN
    SELECT COALESCE(SUM(
      GREATEST(
        total_in_minor_units - amount_paid_in_minor_units,
        0
      )
    ), 0)
    INTO v_outstanding
    FROM public.orders
    WHERE customer_id = p_customer_id
      AND status = 'completed';

    IF v_outstanding > 0 THEN
      RAISE EXCEPTION
        'لا يمكن حذف العميل لأن عليه ذمة بقيمة % د.أ.',
        TO_CHAR(v_outstanding::NUMERIC / 1000, 'FM999999990.000');
    END IF;
  END IF;

  UPDATE public.customers
  SET
    is_blocked = CASE
      WHEN p_action = 'block' THEN true
      WHEN p_action = 'unblock' THEN false
      ELSE is_blocked
    END,
    is_active = CASE
      WHEN p_action = 'block' THEN false
      WHEN p_action = 'unblock' THEN true
      WHEN p_action = 'delete' THEN false
      ELSE is_active
    END,
    is_deleted = CASE
      WHEN p_action = 'delete' THEN true
      ELSE is_deleted
    END,
    updated_at = NOW()
  WHERE id = p_customer_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    CASE p_action
      WHEN 'block' THEN 'BLOCK_CUSTOMER'
      WHEN 'unblock' THEN 'UNBLOCK_CUSTOMER'
      ELSE 'SOFT_DELETE_CUSTOMER'
    END,
    'customers',
    p_customer_id,
    jsonb_build_object(
      'customer_name', v_customer_name,
      'action', p_action
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'action', p_action
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 6. Add a real customer delivery address through RPC.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_customer_address(
  p_customer_id UUID,
  p_governorate TEXT,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_is_default BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_address_id UUID;
  v_formatted_address TEXT;
  v_maps_url TEXT;
  v_has_coordinates BOOLEAN :=
    p_latitude IS NOT NULL AND p_longitude IS NOT NULL;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إضافة عنوان عميل'
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = p_customer_id
      AND is_deleted = false
  ) THEN
    RAISE EXCEPTION 'العميل غير موجود أو محذوف.';
  END IF;

  IF NULLIF(TRIM(p_governorate), '') IS NULL
    OR NULLIF(TRIM(p_area), '') IS NULL
  THEN
    RAISE EXCEPTION 'المحافظة والمنطقة مطلوبتان.';
  END IF;

  IF (p_latitude IS NULL) <> (p_longitude IS NULL) THEN
    RAISE EXCEPTION 'يجب إدخال خط العرض وخط الطول معاً.';
  END IF;
  IF v_has_coordinates
    AND (
      p_latitude NOT BETWEEN -90 AND 90
      OR p_longitude NOT BETWEEN -180 AND 180
    )
  THEN
    RAISE EXCEPTION 'إحداثيات الموقع غير صحيحة.';
  END IF;

  v_formatted_address := CONCAT_WS(
    ' - ',
    NULLIF(TRIM(p_governorate), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), '')
  );
  v_maps_url := CASE WHEN v_has_coordinates
    THEN 'https://www.google.com/maps?q=' ||
      p_latitude::TEXT || ',' || p_longitude::TEXT
    ELSE NULL
  END;

  IF p_is_default THEN
    UPDATE public.customer_addresses
    SET is_default = false
    WHERE customer_id = p_customer_id;
  END IF;

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
    p_customer_id,
    TRIM(p_governorate),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), ''),
    NULLIF(TRIM(p_floor), ''),
    NULLIF(TRIM(p_apartment), ''),
    NULLIF(TRIM(p_notes), ''),
    p_latitude,
    p_longitude,
    v_formatted_address,
    v_maps_url,
    CASE WHEN v_has_coordinates THEN 'gps' ELSE 'manual' END,
    v_has_coordinates,
    p_is_default
  )
  RETURNING id INTO v_address_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'ADD_CUSTOMER_ADDRESS',
    'customer_addresses',
    v_address_id,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'formatted_address', v_formatted_address,
      'location_confirmed', v_has_coordinates
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'address_id', v_address_id
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 7. Update the address attached to an active order.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_delivery_address(
  p_order_id UUID,
  p_governorate TEXT,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_location_source TEXT DEFAULT 'manual',
  p_location_confirmed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_formatted_address TEXT;
  v_maps_url TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales', 'delivery_driver'],
    'تعديل عنوان توصيل الطلب'
  );

  SELECT id, order_number, customer_address_id, status
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.';
  END IF;
  IF v_order.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل عنوان طلب مكتمل أو ملغى.';
  END IF;
  IF v_order.customer_address_id IS NULL THEN
    RAISE EXCEPTION 'الطلب لا يملك عنوان توصيل مرتبطاً.';
  END IF;
  IF NULLIF(TRIM(p_governorate), '') IS NULL
    OR NULLIF(TRIM(p_area), '') IS NULL
  THEN
    RAISE EXCEPTION 'المحافظة والمنطقة مطلوبتان.';
  END IF;
  IF p_location_source NOT IN ('gps', 'map_pin', 'manual') THEN
    RAISE EXCEPTION 'مصدر الموقع غير معتمد.';
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
    RAISE EXCEPTION 'إحداثيات الموقع غير صحيحة.';
  END IF;

  v_formatted_address := CONCAT_WS(
    ' - ',
    NULLIF(TRIM(p_governorate), ''),
    NULLIF(TRIM(p_city), ''),
    NULLIF(TRIM(p_area), ''),
    NULLIF(TRIM(p_street), ''),
    NULLIF(TRIM(p_building), '')
  );
  v_maps_url := CASE
    WHEN p_latitude IS NOT NULL AND p_longitude IS NOT NULL
      THEN 'https://www.google.com/maps?q=' ||
        p_latitude::TEXT || ',' || p_longitude::TEXT
    ELSE NULL
  END;

  UPDATE public.customer_addresses
  SET
    governorate = TRIM(p_governorate),
    city = NULLIF(TRIM(p_city), ''),
    area = NULLIF(TRIM(p_area), ''),
    street = NULLIF(TRIM(p_street), ''),
    building = NULLIF(TRIM(p_building), ''),
    floor = NULLIF(TRIM(p_floor), ''),
    apartment = NULLIF(TRIM(p_apartment), ''),
    notes = NULLIF(TRIM(p_notes), ''),
    latitude = p_latitude,
    longitude = p_longitude,
    formatted_address = v_formatted_address,
    google_maps_url = v_maps_url,
    location_source = p_location_source,
    location_confirmed =
      p_location_confirmed
      AND p_latitude IS NOT NULL
      AND p_longitude IS NOT NULL
  WHERE id = v_order.customer_address_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'UPDATE_ORDER_DELIVERY_ADDRESS',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'address_id', v_order.customer_address_id,
      'formatted_address', v_formatted_address,
      'location_confirmed',
        p_location_confirmed
        AND p_latitude IS NOT NULL
        AND p_longitude IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'formatted_address', v_formatted_address
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 8. Record a customer receipt voucher against one completed order.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_customer_order_payment(
  p_order_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_due BIGINT;
  v_new_paid BIGINT;
  v_payment_id UUID;
  v_payment_number TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'تسجيل دفعة عميل'
  );

  IF p_amount_in_minor_units IS NULL
    OR p_amount_in_minor_units <= 0
  THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;
  IF p_payment_method NOT IN (
    'cash',
    'cliq',
    'card',
    'bank_transfer',
    'cheque'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير معتمدة.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود.';
  END IF;
  IF v_order.status <> 'completed' THEN
    RAISE EXCEPTION 'يمكن تسجيل الدفعة على طلب مكتمل فقط.';
  END IF;
  IF v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'الطلب غير مرتبط بعميل مسجل.';
  END IF;

  v_due := GREATEST(
    v_order.total_in_minor_units -
      v_order.amount_paid_in_minor_units,
    0
  );
  IF v_due = 0 THEN
    RAISE EXCEPTION 'الطلب مدفوع بالكامل.';
  END IF;
  IF p_amount_in_minor_units > v_due THEN
    RAISE EXCEPTION
      'مبلغ الدفعة أكبر من المتبقي على الطلب (% د.أ).',
      TO_CHAR(v_due::NUMERIC / 1000, 'FM999999990.000');
  END IF;

  v_new_paid :=
    v_order.amount_paid_in_minor_units + p_amount_in_minor_units;
  v_payment_number :=
    'CRV-' ||
    TO_CHAR(NOW(), 'YYYYMMDD') ||
    '-' ||
    LPAD(
      NEXTVAL('public.customer_payment_number_seq')::TEXT,
      6,
      '0'
    );

  UPDATE public.orders
  SET
    amount_paid_in_minor_units = v_new_paid,
    payment_status = CASE
      WHEN v_new_paid >= total_in_minor_units THEN 'paid'
      ELSE 'partially_paid'
    END,
    updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO public.customer_payments (
    payment_number,
    customer_id,
    order_id,
    amount_in_minor_units,
    payment_method,
    reference_number,
    notes,
    created_by
  ) VALUES (
    v_payment_number,
    v_order.customer_id,
    p_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    NULLIF(TRIM(p_reference_number), ''),
    NULLIF(TRIM(p_notes), ''),
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'RECORD_CUSTOMER_PAYMENT',
    'customer_payments',
    v_payment_id,
    jsonb_build_object(
      'payment_number', v_payment_number,
      'order_id', p_order_id,
      'order_number', v_order.order_number,
      'customer_id', v_order.customer_id,
      'amount_in_minor_units', p_amount_in_minor_units,
      'remaining_in_minor_units',
        v_order.total_in_minor_units - v_new_paid
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'payment_number', v_payment_number,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'amount_in_minor_units', p_amount_in_minor_units,
    'remaining_in_minor_units',
      v_order.total_in_minor_units - v_new_paid
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 9. RPC-only client writes and execution privileges.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated staff to manage customers"
  ON public.customers;
DROP POLICY IF EXISTS "Allow authenticated staff to manage customer addresses"
  ON public.customer_addresses;

REVOKE ALL ON TABLE public.customer_payments FROM anon;
GRANT SELECT ON TABLE public.customer_payments TO authenticated;

REVOKE ALL ON FUNCTION public.save_customer(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_customer(
  TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.set_customer_status(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_customer_status(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.add_customer_address(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_customer_address(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_order_delivery_address(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_delivery_address(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_order_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;
