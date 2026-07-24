-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 006: System Test RPCs
-- Adds create_test_customer and create_test_order RPCs for System Test Screen
-- =========================================================================

-- 1. Create Test Customer RPC
CREATE OR REPLACE FUNCTION public.create_test_customer(
  p_name TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT 'عمان'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id UUID;
  v_phone TEXT := COALESCE(p_phone, '079' || FLOOR(1000000 + random() * 8999999)::TEXT);
  v_name TEXT := COALESCE(p_name, 'زبون تجريبي - ' || FLOOR(100 + random() * 899)::TEXT);
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  INSERT INTO public.customers (
    full_name,
    phone,
    governorate,
    city,
    customer_type,
    notes
  ) VALUES (
    v_name,
    v_phone,
    p_governorate,
    'عمان',
    'retail',
    'عميل اختباري تم إنشاؤه عبر شاشة System Test'
  )
  RETURNING id INTO v_customer_id;

  INSERT INTO public.customer_addresses (
    customer_id,
    governorate,
    city,
    area,
    street,
    formatted_address,
    location_source,
    location_confirmed,
    is_default
  ) VALUES (
    v_customer_id,
    p_governorate,
    'عمان',
    'الشميساني',
    'شارع الثقافة',
    p_governorate || ' - عمان - الشميساني - شارع الثقافة',
    'manual',
    true,
    true
  );

  -- Audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'create_test_customer',
    'customers',
    v_customer_id,
    jsonb_build_object(
      'full_name', v_name,
      'phone', v_phone,
      'governorate', p_governorate
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', v_customer_id,
    'full_name', v_name,
    'phone', v_phone,
    'governorate', p_governorate,
    'message', 'تم إنشاء العميل التجريبي بنجاح في قاعدة البيانات.'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشل إنشاء العميل التجريبي: %', SQLERRM;
END;
$$;


-- 2. Create Test Order RPC
CREATE OR REPLACE FUNCTION public.create_test_order(
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_product_id UUID DEFAULT NULL,
  p_quantity INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prod_id UUID := p_product_id;
  v_cust_name TEXT := COALESCE(p_customer_name, 'زبون تجريبي - ' || FLOOR(100 + random() * 899)::TEXT);
  v_cust_phone TEXT := COALESCE(p_customer_phone, '079' || FLOOR(1000000 + random() * 8999999)::TEXT);
  v_items JSONB;
  v_res JSONB;
BEGIN
  -- If product_id not provided, pick an active product
  IF v_prod_id IS NULL THEN
    SELECT id INTO v_prod_id
    FROM public.products
    WHERE is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_prod_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد أي منتج فعال في قاعدة البيانات لإنشاء طلب اختباري عليه.';
  END IF;

  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_prod_id,
      'quantity', COALESCE(p_quantity, 1)
    )
  );

  v_res := public.create_customer_order(
    p_customer_full_name => v_cust_name,
    p_customer_phone => v_cust_phone,
    p_governorate => 'عمان',
    p_city => 'عمان',
    p_area => 'الشميساني',
    p_items => v_items,
    p_customer_notes => 'طلب اختباري تم إنشاؤه عبر شاشة System Test',
    p_source => 'system_test'
  );

  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشل إنشاء الطلب الاختباري: %', SQLERRM;
END;
$$;
