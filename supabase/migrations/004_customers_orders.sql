-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 004: Customers & Orders
-- Phase 2 Core Database Schema & RPCs for Order Processing
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. CUSTOMERS (العملاء)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast searching by phone number
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);

-- -------------------------------------------------------------------------
-- 2. CUSTOMER_ADDRESSES (عناوين العملاء للتوصيل)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  governorate TEXT,
  city TEXT,
  area TEXT,
  street TEXT,
  building TEXT,
  floor TEXT,
  apartment TEXT,
  notes TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  formatted_address TEXT,
  google_maps_url TEXT,
  location_source TEXT CHECK (location_source IN ('gps', 'map_pin', 'manual')),
  location_confirmed BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON public.customer_addresses(customer_id);

-- -------------------------------------------------------------------------
-- 3. ORDERS (الطلبات)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_address_id UUID REFERENCES public.customer_addresses(id) ON DELETE SET NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled'
  )),
  payment_method TEXT DEFAULT 'cash_on_delivery',
  payment_status TEXT DEFAULT 'unpaid',
  subtotal_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_in_minor_units >= 0),
  delivery_fee_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_in_minor_units >= 0),
  discount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (discount_in_minor_units >= 0),
  total_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (total_in_minor_units >= 0),
  customer_notes TEXT,
  internal_notes TEXT,
  whatsapp_message TEXT,
  source TEXT DEFAULT 'website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);

-- -------------------------------------------------------------------------
-- 4. ORDER_ITEMS (عناصر الطلب)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_price_in_minor_units BIGINT NOT NULL CHECK (unit_price_in_minor_units >= 0),
  line_total_in_minor_units BIGINT NOT NULL CHECK (line_total_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- -------------------------------------------------------------------------
-- 5. ORDER_STATUS_HISTORY (سجل حالات الطلب)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------------
-- AUTOMATIC TIMESTAMP UPDATER TRIGGERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_update_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- -------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

-- Full management access for authenticated staff/admin users
CREATE POLICY "Allow authenticated staff to read customers"
  ON public.customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage customers"
  ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read customer addresses"
  ON public.customer_addresses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage customer addresses"
  ON public.customer_addresses FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read orders"
  ON public.orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage orders"
  ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read order items"
  ON public.order_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage order items"
  ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read order status history"
  ON public.order_status_history FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage order status history"
  ON public.order_status_history FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- =========================================================================
-- STORED PROCEDURES / RPCs FOR ATOMIC ORDER PROCESSING
-- =========================================================================

-- -------------------------------------------------------------------------
-- RPC 1: create_customer_order
-- Creates customer, address, verifies server-side prices & available stock,
-- inserts order & order_items, reserves stock, creates history & audit log.
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
  v_total BIGINT := 0;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- 1. Input Validations
  IF p_customer_full_name IS NULL OR TRIM(p_customer_full_name) = '' THEN
    RAISE EXCEPTION 'اسم العميل مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF p_customer_phone IS NULL OR TRIM(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'رقم هاتف العميل مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'سلة الطلب فارغة، يجب تقديم عنصر واحد على الأقل.';
  END IF;

  -- Resolve default branch and warehouse if not provided
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    SELECT id INTO v_warehouse_id FROM public.warehouses WHERE is_active = true ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على مستودع فعال لمعالجة الطلب.';
  END IF;

  -- 2. Customer Lookup or Creation by Phone Number
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE phone = TRIM(p_customer_phone)
  LIMIT 1;

  IF v_customer_id IS NOT NULL THEN
    -- Update existing customer details if provided
    UPDATE public.customers
    SET full_name = TRIM(p_customer_full_name),
        email = COALESCE(NULLIF(TRIM(p_customer_email), ''), email),
        updated_at = NOW()
    WHERE id = v_customer_id;
  ELSE
    -- Insert new customer
    INSERT INTO public.customers (
      full_name,
      phone,
      email
    ) VALUES (
      TRIM(p_customer_full_name),
      TRIM(p_customer_phone),
      NULLIF(TRIM(p_customer_email), '')
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- 3. Customer Address Creation
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
    p_governorate,
    p_city,
    p_area,
    p_street,
    p_building,
    p_floor,
    p_apartment,
    p_address_notes,
    p_latitude,
    p_longitude,
    p_formatted_address,
    p_google_maps_url,
    COALESCE(p_location_source, 'manual'),
    (p_latitude IS NOT NULL AND p_longitude IS NOT NULL),
    true
  )
  RETURNING id INTO v_address_id;

  -- 4. Calculate Subtotal and Verify Product Availability & Prices Server-Side
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::INT;

    IF v_prod_id IS NULL THEN
      RAISE EXCEPTION 'معرف المنتج product_id مفقود في عناصر الطلب.';
    END IF;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'كمية المنتج يجب أن تكون أكبر من صفر.';
    END IF;

    -- Fetch canonical server product prices and details
    SELECT name_ar, sku, sale_price_in_minor_units, is_active
    INTO v_prod_name, v_prod_sku, v_unit_price, v_is_active
    FROM public.products
    WHERE id = v_prod_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المنتج المحدد برقم (%) غير موجود في النظام.', v_prod_id;
    END IF;

    IF NOT v_is_active THEN
      RAISE EXCEPTION 'المنتج (%) غير نشط حالياً ولا يمكن طلبه.', v_prod_name;
    END IF;

    -- Check inventory balance in the target warehouse with lock
    SELECT on_hand_quantity, reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id AND product_id = v_prod_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المنتج (%) غير مسجل له رصيد مخزني في المستودع المحدد.', v_prod_name;
    END IF;

    v_available := v_on_hand - v_reserved;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'الكمية المتاحة للمنتج (%) غير كافية بالمخزون. المتاح: %, المطلوب: %', v_prod_name, v_available, v_qty;
    END IF;

    v_line_total := v_unit_price * v_qty;
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  -- 5. Calculate Final Order Total
  v_total := v_subtotal + COALESCE(p_delivery_fee_in_minor_units, 0) - COALESCE(p_discount_in_minor_units, 0);
  IF v_total < 0 THEN
    v_total := 0;
  END IF;

  -- 6. Generate Unique Order Number
  v_order_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD((FLOOR(RANDOM() * 89999 + 10000))::text, 5, '0');

  -- 7. Insert Order Row
  INSERT INTO public.orders (
    order_number,
    customer_id,
    customer_address_id,
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
    v_branch_id,
    v_warehouse_id,
    'new',
    'cash_on_delivery',
    'unpaid',
    v_subtotal,
    COALESCE(p_delivery_fee_in_minor_units, 0),
    COALESCE(p_discount_in_minor_units, 0),
    v_total,
    p_customer_notes,
    p_internal_notes,
    'تم استلام طلبك رقم ' || v_order_number || ' بقيمة إجمالية ' || (v_total::numeric / 1000.0)::text || ' د.أ. سيتم التواصل معك لتأكيد التوصيل.',
    COALESCE(p_source, 'website')
  )
  RETURNING id INTO v_order_id;

  -- 8. Insert Order Items & Reserve Inventory
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

    -- Increase reserved_quantity in inventory_balances
    UPDATE public.inventory_balances
    SET reserved_quantity = reserved_quantity + v_qty,
        updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id AND product_id = v_prod_id;
  END LOOP;

  -- 9. Insert Order Status History
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
    'إنشاء الطلب وحجز الكميات تلقائياً بالمخزون'
  );

  -- 10. Insert Audit Log
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
      'customer_phone', p_customer_phone,
      'total_in_minor_units', v_total,
      'items_count', jsonb_array_length(p_items)
    )
  );

  -- 11. Return Response Object
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'total', v_total,
    'status', 'new',
    'message', 'تم إنشاء الطلب وحجز الكميات بنجاح.'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية إنشاء الطلب: %', SQLERRM;
END;
$$;


-- -------------------------------------------------------------------------
-- RPC 2: confirm_order
-- Changes order status from 'new' to 'confirmed'. Keeps stock reserved.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_number TEXT;
  v_old_status TEXT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Fetch order details with row lock
  SELECT order_number, status
  INTO v_order_number, v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن تأكيد طلب ملغى.';
  END IF;

  IF v_old_status = 'completed' THEN
    RAISE EXCEPTION 'الطلب مكتمل بالفعل.';
  END IF;

  -- Update order status to confirmed
  UPDATE public.orders
  SET status = 'confirmed',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- Record status transition
  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_old_status,
    'confirmed',
    v_user_id,
    COALESCE(p_notes, 'تأكيد الطلب وبدء تحضيره (المخزون محجوز)')
  );

  -- Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'confirm_order',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'old_status', v_old_status,
      'new_status', 'confirmed'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'confirmed',
    'message', 'تم تأكيد الطلب بنجاح ويبقى المخزون محجوزاً.'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية تأكيد الطلب: %', SQLERRM;
END;
$$;


-- -------------------------------------------------------------------------
-- RPC 3: complete_order
-- Completes the order: deducts from on_hand_quantity, decreases reserved_quantity,
-- adds sales_deduction inventory movement, updates status to completed.
-- Prevents executing twice.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_number TEXT;
  v_warehouse_id UUID;
  v_old_status TEXT;
  v_item RECORD;
  v_on_hand INT;
  v_reserved INT;
  v_new_on_hand INT;
  v_new_reserved INT;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Fetch order details with lock
  SELECT order_number, warehouse_id, status
  INTO v_order_number, v_warehouse_id, v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_old_status = 'completed' THEN
    RAISE EXCEPTION 'الطلب مكتمل ومخصوم من المخزون بالفعل، ولا يمكن إكماله مرة أخرى.';
  END IF;

  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن إكمال طلب ملغى.';
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'المستودع الخاص بالطلب غير محدد.';
  END IF;

  -- Process inventory deduction for each order item
  FOR v_item IN
    SELECT product_id, quantity
    FROM public.order_items
    WHERE order_id = p_order_id
  LOOP
    SELECT on_hand_quantity, reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id AND product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'لم يتم العثور على رصيد المخزون للمنتج برقم (%) في المستودع.', v_item.product_id;
    END IF;

    v_new_on_hand := v_on_hand - v_item.quantity;
    v_new_reserved := GREATEST(0, v_reserved - v_item.quantity);

    IF v_new_on_hand < 0 THEN
      RAISE EXCEPTION 'الكمية الفعلية بالمخزون غير كافية لخصم الطلب. المتوفر الفعلي: %', v_on_hand;
    END IF;

    -- Update balance row
    UPDATE public.inventory_balances
    SET on_hand_quantity = v_new_on_hand,
        reserved_quantity = v_new_reserved,
        updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id AND product_id = v_item.product_id;

    -- Record sales deduction movement
    INSERT INTO public.inventory_movements (
      warehouse_id,
      product_id,
      movement_type,
      quantity,
      balance_before,
      balance_after,
      reference_type,
      reference_id,
      notes,
      created_by
    ) VALUES (
      v_warehouse_id,
      v_item.product_id,
      'sales_deduction',
      -v_item.quantity,
      v_on_hand,
      v_new_on_hand,
      'order',
      p_order_id,
      'خصم مبيعات نهائي للطلب رقم ' || v_order_number,
      v_user_id
    );
  END LOOP;

  -- Update order status to completed and payment_status to paid
  UPDATE public.orders
  SET status = 'completed',
      payment_status = 'paid',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- Record status history
  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_old_status,
    'completed',
    v_user_id,
    COALESCE(p_notes, 'تسليم الطلب وإكمال الخصم النهائي من المخزون وتحصيل المبلغ')
  );

  -- Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'complete_order',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'old_status', v_old_status,
      'new_status', 'completed'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'completed',
    'message', 'تم إكمال الطلب وخصم الكميات من المخزون وتحديث الحسابات بنجاح.'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية إكمال الطلب: %', SQLERRM;
END;
$$;


-- -------------------------------------------------------------------------
-- RPC 4: cancel_order
-- Cancels order: releases reserved quantity by decreasing reserved_quantity,
-- leaves on_hand_quantity untouched, updates status to cancelled.
-- Prevents cancelling completed orders.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_number TEXT;
  v_warehouse_id UUID;
  v_old_status TEXT;
  v_item RECORD;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Fetch order details
  SELECT order_number, warehouse_id, status
  INTO v_order_number, v_warehouse_id, v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_old_status = 'completed' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء طلب مكتمل ومخصوم من المخزون بالفعل.';
  END IF;

  IF v_old_status = 'cancelled' THEN
    RAISE EXCEPTION 'الطلب ملغى بالفعل.';
  END IF;

  -- Release reserved stock for each order item if warehouse_id is set
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT product_id, quantity
      FROM public.order_items
      WHERE order_id = p_order_id
    LOOP
      UPDATE public.inventory_balances
      SET reserved_quantity = GREATEST(0, reserved_quantity - v_item.quantity),
          updated_at = NOW()
      WHERE warehouse_id = v_warehouse_id AND product_id = v_item.product_id;
    END LOOP;
  END IF;

  -- Update order status to cancelled
  UPDATE public.orders
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE id = p_order_id;

  -- Record status history
  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_old_status,
    'cancelled',
    v_user_id,
    COALESCE(p_notes, 'إلغاء الطلب وتحرير الكمية المحجوزة بالمخزون')
  );

  -- Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'cancel_order',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'old_status', v_old_status,
      'new_status', 'cancelled'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'cancelled',
    'message', 'تم إلغاء الطلب وتحرير المخزون المحجوز بنجاح.'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية إلغاء الطلب: %', SQLERRM;
END;
$$;
