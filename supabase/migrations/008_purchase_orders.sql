-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 008: Purchase Orders & Goods Receiving
-- Module for Wholesale Purchasing, Supplier Management & Inventory Receiving
-- =========================================================================

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. SUPPLIERS (الموردون)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  tax_number TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_company_name ON public.suppliers(company_name);

-- -------------------------------------------------------------------------
-- 2. PURCHASE_ORDERS (طلبات الشراء)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_number TEXT UNIQUE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'sent',
    'approved',
    'partially_received',
    'received',
    'cancelled'
  )),
  order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_delivery_date TIMESTAMPTZ,
  subtotal_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_in_minor_units >= 0),
  discount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (discount_in_minor_units >= 0),
  delivery_fee_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_in_minor_units >= 0),
  total_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (total_in_minor_units >= 0),
  amount_paid_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_in_minor_units >= 0),
  supplier_invoice_number TEXT,
  notes TEXT,
  internal_notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_number ON public.purchase_orders(purchase_order_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON public.purchase_orders(created_at DESC);

-- -------------------------------------------------------------------------
-- 3. PURCHASE_ORDER_ITEMS (عناصر طلب الشراء)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ordered_quantity INT NOT NULL CHECK (ordered_quantity > 0),
  received_quantity INT NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  purchase_price_in_minor_units BIGINT NOT NULL CHECK (purchase_price_in_minor_units >= 0),
  discount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (discount_in_minor_units >= 0),
  line_total_in_minor_units BIGINT NOT NULL CHECK (line_total_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product_id ON public.purchase_order_items(product_id);

-- -------------------------------------------------------------------------
-- 4. PURCHASE_RECEIPTS (سندات استلام البضائع)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supplier_delivery_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_po_id ON public.purchase_receipts(purchase_order_id);

-- -------------------------------------------------------------------------
-- 5. PURCHASE_RECEIPT_ITEMS (عناصر سند الاستلام)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_receipt_id UUID NOT NULL REFERENCES public.purchase_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  received_quantity INT NOT NULL CHECK (received_quantity > 0),
  unit_cost_in_minor_units BIGINT NOT NULL CHECK (unit_cost_in_minor_units >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON public.purchase_receipt_items(purchase_receipt_id);

-- -------------------------------------------------------------------------
-- 6. SUPPLIER_PAYMENTS (مدفوعات الموردين / سندات الصرف)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  amount_in_minor_units BIGINT NOT NULL CHECK (amount_in_minor_units > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference_number TEXT,
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_id ON public.supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_po_id ON public.supplier_payments(purchase_order_id);

-- -------------------------------------------------------------------------
-- AUTOMATIC TIMESTAMP TRIGGERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_update_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_purchase_orders_updated_at
BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_purchase_order_items_updated_at
BEFORE UPDATE ON public.purchase_order_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- -------------------------------------------------------------------------
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read purchasing tables
CREATE POLICY "Allow authenticated staff to read suppliers"
  ON public.suppliers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage suppliers"
  ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read purchase orders"
  ON public.purchase_orders FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage purchase orders"
  ON public.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read purchase order items"
  ON public.purchase_order_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage purchase order items"
  ON public.purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read purchase receipts"
  ON public.purchase_receipts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage purchase receipts"
  ON public.purchase_receipts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read purchase receipt items"
  ON public.purchase_receipt_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage purchase receipt items"
  ON public.purchase_receipt_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated staff to read supplier payments"
  ON public.supplier_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated staff to manage supplier payments"
  ON public.supplier_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- -------------------------------------------------------------------------
-- SEED SAMPLE SUPPLIERS IF EMPTY
-- -------------------------------------------------------------------------
INSERT INTO public.suppliers (company_name, contact_person, phone, email, address, tax_number)
SELECT 'شركة الأردن التجارية المحدودة', 'أحمد محمود', '0791234567', 'info@jordan-trade.jo', 'عمان - شارع مكة', '102938475'
WHERE NOT EXISTS (SELECT 1 FROM public.suppliers LIMIT 1);

INSERT INTO public.suppliers (company_name, contact_person, phone, email, address, tax_number)
SELECT 'مجموعة البركة للتوريدات العمومية', 'خالد النجار', '0788765432', 'sales@albaraka.jo', 'الزرقاء - المنطقة الحرة', '987654321'
WHERE NOT EXISTS (SELECT 1 FROM public.suppliers WHERE company_name = 'مجموعة البركة للتوريدات العمومية');

-- =========================================================================
-- STORED PROCEDURES / RPCs FOR ATOMIC PURCHASING
-- =========================================================================

-- -------------------------------------------------------------------------
-- RPC 1: create_purchase_order
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_supplier_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_expected_delivery_date TIMESTAMPTZ DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_po_id UUID;
  v_po_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_ordered_qty INT;
  v_unit_price BIGINT;
  v_item_discount BIGINT;
  v_line_total BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT := 0;
  v_item_count INT := 0;
BEGIN
  v_user_id := auth.uid();

  -- 1. Validate Supplier
  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND is_active = true) THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود أو غير مفعل.';
  END IF;

  -- 2. Validate Items Array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة منتج واحد على الأقل في أمر الشراء.';
  END IF;

  -- 3. Calculate Subtotal & Validate Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_ordered_qty := COALESCE((v_item->>'ordered_quantity')::INT, 0);
    v_unit_price := COALESCE((v_item->>'purchase_price_in_minor_units')::BIGINT, 0);
    v_item_discount := COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);

    IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND is_active = true) THEN
      RAISE EXCEPTION 'أحد المنتجات المحددة غير موجود أو غير مفعل.';
    END IF;

    IF v_ordered_qty <= 0 THEN
      RAISE EXCEPTION 'الكمية المطلوبة لكل منتج يجب أن تكون أكبر من صفر.';
    END IF;

    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'سعر الشراء لا يمكن أن يكون بالسالب.';
    END IF;

    v_line_total := (v_ordered_qty * v_unit_price) - v_item_discount;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    v_subtotal := v_subtotal + v_line_total;
    v_item_count := v_item_count + 1;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0) + COALESCE(p_delivery_fee_in_minor_units, 0);
  IF v_total < 0 THEN v_total := 0; END IF;

  -- 4. Generate Unique PO Number: PO-2026-XXXX
  v_po_number := 'PO-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  WHILE EXISTS (SELECT 1 FROM public.purchase_orders WHERE purchase_order_number = v_po_number) LOOP
    v_po_number := 'PO-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  END LOOP;

  -- 5. Insert Purchase Order Header
  INSERT INTO public.purchase_orders (
    purchase_order_number,
    supplier_id,
    branch_id,
    warehouse_id,
    status,
    order_date,
    expected_delivery_date,
    subtotal_in_minor_units,
    discount_in_minor_units,
    delivery_fee_in_minor_units,
    total_in_minor_units,
    amount_paid_in_minor_units,
    supplier_invoice_number,
    notes,
    internal_notes,
    created_by
  ) VALUES (
    v_po_number,
    p_supplier_id,
    p_branch_id,
    p_warehouse_id,
    'draft',
    NOW(),
    p_expected_delivery_date,
    v_subtotal,
    COALESCE(p_discount_in_minor_units, 0),
    COALESCE(p_delivery_fee_in_minor_units, 0),
    v_total,
    0,
    p_supplier_invoice_number,
    p_notes,
    p_internal_notes,
    v_user_id
  )
  RETURNING id INTO v_po_id;

  -- 6. Insert Purchase Order Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_ordered_qty := (v_item->>'ordered_quantity')::INT;
    v_unit_price := (v_item->>'purchase_price_in_minor_units')::BIGINT;
    v_item_discount := COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);
    v_line_total := (v_ordered_qty * v_unit_price) - v_item_discount;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    INSERT INTO public.purchase_order_items (
      purchase_order_id,
      product_id,
      ordered_quantity,
      received_quantity,
      purchase_price_in_minor_units,
      discount_in_minor_units,
      line_total_in_minor_units
    ) VALUES (
      v_po_id,
      v_product_id,
      v_ordered_qty,
      0,
      v_unit_price,
      v_item_discount,
      v_line_total
    );
  END LOOP;

  -- 7. Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'إنشاء أمر شراء',
    'purchase_orders',
    v_po_id,
    jsonb_build_object(
      'purchase_order_number', v_po_number,
      'supplier_id', p_supplier_id,
      'total_in_minor_units', v_total,
      'items_count', v_item_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', v_po_id,
    'purchase_order_number', v_po_number,
    'total_in_minor_units', v_total,
    'message', 'تم إنشاء أمر الشراء مسودة بنجاح'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 2: update_purchase_order_status
-- Enforces allowed transitions:
-- draft -> sent / cancelled
-- sent -> approved / cancelled
-- approved -> partially_received / received / cancelled (if received = 0)
-- partially_received -> partially_received / received
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_order_status(
  p_purchase_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_po public.purchase_orders%ROWTYPE;
  v_total_received INT := 0;
BEGIN
  v_user_id := auth.uid();

  -- Lock PO row
  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الشراء المحدد غير موجود.';
  END IF;

  IF v_po.status = p_new_status THEN
    RETURN jsonb_build_object('success', true, 'message', 'الحالة الحالية هي بالفعل الحالة المطلوبة.');
  END IF;

  -- Calculate total received quantity across all items
  SELECT COALESCE(SUM(received_quantity), 0) INTO v_total_received
  FROM public.purchase_order_items
  WHERE purchase_order_id = p_purchase_order_id;

  -- Validate Transitions
  IF v_po.status = 'draft' AND p_new_status NOT IN ('sent', 'cancelled') THEN
    RAISE EXCEPTION 'طلب الشراء المسودة يمكن تحويله إلى مرسل أو ملغى فقط.';
  ELSIF v_po.status = 'sent' AND p_new_status NOT IN ('approved', 'cancelled') THEN
    RAISE EXCEPTION 'طلب الشراء المرسل يمكن تحويله إلى معتمد أو ملغى فقط.';
  ELSIF v_po.status = 'approved' AND p_new_status NOT IN ('partially_received', 'received', 'cancelled') THEN
    RAISE EXCEPTION 'طلب الشراء المعتمد يمكن استلامه جزئياً/كلياً أو إلغاؤه.';
  ELSIF v_po.status = 'approved' AND p_new_status = 'cancelled' AND v_total_received > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء طلب شراء معتمد تم استلام جزء من بضائعه بالفعل.';
  ELSIF v_po.status = 'partially_received' AND p_new_status NOT IN ('partially_received', 'received') THEN
    RAISE EXCEPTION 'طلب الشراء المستلم جزئياً لا يمكن تحويله إلا إلى مستلم كلياً.';
  ELSIF v_po.status = 'received' THEN
    RAISE EXCEPTION 'أمر الشراء المكتمل والمستلم بالكامل لا يمكن تغيير حالته أو إلغاؤه.';
  ELSIF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'أمر الشراء الملغى لا يمكن تعديل حالته.';
  END IF;

  -- Apply Update
  UPDATE public.purchase_orders
  SET
    status = p_new_status,
    approved_by = CASE WHEN p_new_status = 'approved' THEN v_user_id ELSE approved_by END,
    approved_at = CASE WHEN p_new_status = 'approved' THEN NOW() ELSE approved_at END,
    cancelled_at = CASE WHEN p_new_status = 'cancelled' THEN NOW() ELSE cancelled_at END,
    received_at = CASE WHEN p_new_status = 'received' THEN NOW() ELSE received_at END,
    notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes, '') || ' | ' || p_notes ELSE notes END,
    updated_at = NOW()
  WHERE id = p_purchase_order_id;

  -- Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'تحديث حالة أمر شراء',
    'purchase_orders',
    p_purchase_order_id,
    jsonb_build_object(
      'old_status', v_po.status,
      'new_status', p_new_status,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'status', p_new_status,
    'message', 'تم تحديث حالة طلب الشراء بنجاح'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 3: receive_purchase_order
-- Atomic Goods Receiving (GRN) Procedure
-- Accepts items JSON array, validates remaining quantities, creates purchase_receipt
-- and receipt_items, updates purchase_order_items.received_quantity,
-- updates inventory_balances & records inventory_movements, and calculates weighted average cost.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id UUID,
  p_warehouse_id UUID DEFAULT NULL,
  p_supplier_delivery_note TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_po public.purchase_orders%ROWTYPE;
  v_target_warehouse_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_item JSONB;
  v_po_item_id UUID;
  v_product_id UUID;
  v_recv_qty INT;
  v_unit_cost BIGINT;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_remaining_qty INT;
  v_current_on_hand INT := 0;
  v_total_on_hand_all_wh INT := 0;
  v_new_on_hand INT := 0;
  v_current_cost BIGINT := 0;
  v_new_weighted_cost BIGINT := 0;
  v_all_completed BOOLEAN := true;
  v_receipt_item_count INT := 0;
  v_check_item RECORD;
BEGIN
  v_user_id := auth.uid();

  -- Lock PO row
  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء المحدد غير موجود.';
  END IF;

  IF v_po.status NOT IN ('approved', 'partially_received') THEN
    RAISE EXCEPTION 'يجب أن يكون أمر الشراء معتمداً أو مستلماً جزئياً لاستلام البضائع. الحالة الحالية: %', v_po.status;
  END IF;

  v_target_warehouse_id := COALESCE(p_warehouse_id, v_po.warehouse_id);
  IF v_target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'يرجى تحديد المستودع المستلم للبضائع.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إدخال منتج واحد على الأقل للاستلام.';
  END IF;

  -- Generate Receipt Number: GRN-2026-XXXX
  v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  WHILE EXISTS (SELECT 1 FROM public.purchase_receipts WHERE receipt_number = v_receipt_number) LOOP
    v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(CAST(FLOOR(1000 + RANDOM() * 9000) AS TEXT), 4, '0');
  END LOOP;

  -- Create Purchase Receipt Header
  INSERT INTO public.purchase_receipts (
    receipt_number,
    purchase_order_id,
    supplier_id,
    warehouse_id,
    received_by,
    received_at,
    supplier_delivery_note,
    notes
  ) VALUES (
    v_receipt_number,
    p_purchase_order_id,
    v_po.supplier_id,
    v_target_warehouse_id,
    v_user_id,
    NOW(),
    p_supplier_delivery_note,
    p_notes
  )
  RETURNING id INTO v_receipt_id;

  -- Loop through received items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_po_item_id := (v_item->>'purchase_order_item_id')::UUID;
    v_product_id := (v_item->>'product_id')::UUID;
    v_recv_qty := COALESCE((v_item->>'received_quantity')::INT, 0);
    v_unit_cost := COALESCE((v_item->>'unit_cost_in_minor_units')::BIGINT, 0);

    IF v_recv_qty <= 0 THEN
      CONTINUE; -- skip zero quantity items
    END IF;

    -- Lock & Fetch PO Item
    SELECT * INTO v_po_item
    FROM public.purchase_order_items
    WHERE id = v_po_item_id AND purchase_order_id = p_purchase_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'عنصر أمر الشراء غير موجود.';
    END IF;

    v_remaining_qty := v_po_item.ordered_quantity - v_po_item.received_quantity;
    IF v_recv_qty > v_remaining_qty THEN
      RAISE EXCEPTION 'الكمية المستلمة (%s) تتجاوز الكمية المتبقية (%s) للمنتج.', v_recv_qty, v_remaining_qty;
    END IF;

    -- 1. Insert Receipt Item
    INSERT INTO public.purchase_receipt_items (
      purchase_receipt_id,
      purchase_order_item_id,
      product_id,
      received_quantity,
      unit_cost_in_minor_units
    ) VALUES (
      v_receipt_id,
      v_po_item_id,
      v_po_item.product_id,
      v_recv_qty,
      v_unit_cost
    );

    -- 2. Update PO Item received_quantity
    UPDATE public.purchase_order_items
    SET received_quantity = received_quantity + v_recv_qty,
        updated_at = NOW()
    WHERE id = v_po_item_id;

    -- 3. Update Inventory Balance
    SELECT COALESCE(on_hand_quantity, 0) INTO v_current_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = v_target_warehouse_id AND product_id = v_po_item.product_id;

    IF NOT FOUND THEN
      v_current_on_hand := 0;
      INSERT INTO public.inventory_balances (
        warehouse_id,
        product_id,
        on_hand_quantity,
        reserved_quantity
      ) VALUES (
        v_target_warehouse_id,
        v_po_item.product_id,
        v_recv_qty,
        0
      );
      v_new_on_hand := v_recv_qty;
    ELSE
      v_new_on_hand := v_current_on_hand + v_recv_qty;
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_new_on_hand,
          updated_at = NOW()
      WHERE warehouse_id = v_target_warehouse_id AND product_id = v_po_item.product_id;
    END IF;

    -- 4. Record Inventory Movement
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
      v_target_warehouse_id,
      v_po_item.product_id,
      'purchase_receipt',
      v_recv_qty,
      v_current_on_hand,
      v_new_on_hand,
      'purchase_receipt',
      v_receipt_id,
      'استلام مشتريات سند رقم ' || v_receipt_number || ' - طلب شراء ' || v_po.purchase_order_number,
      v_user_id
    );

    -- 5. Calculate Weighted Average Cost & Update Product Cost
    SELECT COALESCE(cost_price_in_minor_units, 0) INTO v_current_cost
    FROM public.products
    WHERE id = v_po_item.product_id;

    SELECT COALESCE(SUM(on_hand_quantity), 0) INTO v_total_on_hand_all_wh
    FROM public.inventory_balances
    WHERE product_id = v_po_item.product_id;

    -- Note: v_total_on_hand_all_wh already includes v_recv_qty
    IF (v_total_on_hand_all_wh) > 0 AND v_unit_cost > 0 THEN
      v_new_weighted_cost := (( (v_total_on_hand_all_wh - v_recv_qty) * v_current_cost ) + ( v_recv_qty * v_unit_cost )) / v_total_on_hand_all_wh;
      
      UPDATE public.products
      SET cost_price_in_minor_units = v_new_weighted_cost,
          updated_at = NOW()
      WHERE id = v_po_item.product_id;
    END IF;

    v_receipt_item_count := v_receipt_item_count + 1;
  END LOOP;

  -- Determine if PO is fully received
  FOR v_check_item IN SELECT ordered_quantity, received_quantity FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id
  LOOP
    IF v_check_item.received_quantity < v_check_item.ordered_quantity THEN
      v_all_completed := false;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET status = CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
      received_at = CASE WHEN v_all_completed THEN NOW() ELSE received_at END,
      updated_at = NOW()
  WHERE id = p_purchase_order_id;

  -- Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'استلام بضائع أمر شراء',
    'purchase_receipts',
    v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'purchase_order_id', p_purchase_order_id,
      'is_fully_received', v_all_completed,
      'items_received_count', v_receipt_item_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'is_fully_received', v_all_completed,
    'new_status', CASE WHEN v_all_completed THEN 'received' ELSE 'partially_received' END,
    'message', 'تم استلام البضائع وزيادة المخزون وتحديث متوسط التكلفة بنجاح'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 4: record_supplier_payment
-- Registers supplier payment (voucher) and safely updates PO amount_paid & amount_due
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id UUID,
  p_purchase_order_id UUID DEFAULT NULL,
  p_amount_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_payment_date TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_payment_id UUID;
  v_po public.purchase_orders%ROWTYPE;
  v_due_amount BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF p_supplier_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود.';
  END IF;

  IF p_amount_in_minor_units <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;

  -- If tied to specific PO
  IF p_purchase_order_id IS NOT NULL THEN
    SELECT * INTO v_po
    FROM public.purchase_orders
    WHERE id = p_purchase_order_id AND supplier_id = p_supplier_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أمر الشراء غير موجود أو لا يتبع للمورد المحدد.';
    END IF;

    v_due_amount := v_po.total_in_minor_units - v_po.amount_paid_in_minor_units;
    IF p_amount_in_minor_units > v_due_amount THEN
      RAISE EXCEPTION 'مبلغ الدفعة (%s) يتجاوز الرصيد المستحق على أمر الشراء (%s).', p_amount_in_minor_units, v_due_amount;
    END IF;

    UPDATE public.purchase_orders
    SET amount_paid_in_minor_units = amount_paid_in_minor_units + p_amount_in_minor_units,
        updated_at = NOW()
    WHERE id = p_purchase_order_id;
  END IF;

  INSERT INTO public.supplier_payments (
    supplier_id,
    purchase_order_id,
    amount_in_minor_units,
    payment_method,
    reference_number,
    payment_date,
    notes,
    created_by
  ) VALUES (
    p_supplier_id,
    p_purchase_order_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    COALESCE(p_payment_date, NOW()),
    p_notes,
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  -- Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'تسجيل سند صرف مورد',
    'supplier_payments',
    v_payment_id,
    jsonb_build_object(
      'supplier_id', p_supplier_id,
      'purchase_order_id', p_purchase_order_id,
      'amount_in_minor_units', p_amount_in_minor_units,
      'payment_method', p_payment_method
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'message', 'تم تسجيل دفعة المورد (سند الصرف) بنجاح'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 5: cancel_purchase_order
-- Wrapper for cancelling purchase orders safely
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_purchase_order(
  p_purchase_order_id UUID,
  p_reason TEXT DEFAULT 'إلغاء بطلب من المستخدم'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.update_purchase_order_status(p_purchase_order_id, 'cancelled', p_reason);
END;
$$;
