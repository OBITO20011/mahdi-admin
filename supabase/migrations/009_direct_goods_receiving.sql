-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 009: Direct Goods Receiving
-- Direct Receiving System for Wholesale Stores (Bypassing PO Approval Workflows)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. SEQUENCE FOR RECEIPT NUMBERS
-- -------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.supplier_receipt_seq START 1001;

-- -------------------------------------------------------------------------
-- 2. SUPPLIER_RECEIPTS (سندات استلام البضائع المباشرة)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  supplier_invoice_number TEXT,
  supplier_invoice_date DATE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subtotal_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_in_minor_units >= 0),
  discount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (discount_in_minor_units >= 0),
  delivery_fee_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_in_minor_units >= 0),
  tax_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (tax_in_minor_units >= 0),
  total_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (total_in_minor_units >= 0),
  amount_paid_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_in_minor_units >= 0),
  amount_due_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (amount_due_in_minor_units >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid')),
  payment_method TEXT,
  payment_reference TEXT,
  notes TEXT,
  internal_notes TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'returned')),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  idempotency_key UUID UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_receipts_number ON public.supplier_receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_supplier ON public.supplier_receipts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_warehouse ON public.supplier_receipts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_received_at ON public.supplier_receipts(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_payment_status ON public.supplier_receipts(payment_status);

-- -------------------------------------------------------------------------
-- 3. SUPPLIER_RECEIPT_ITEMS (عناصر بضاعة استلام الموردين)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_receipt_id UUID NOT NULL REFERENCES public.supplier_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  base_unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  purchase_unit_name TEXT,
  base_unit_name TEXT,
  package_quantity INTEGER NOT NULL CHECK (package_quantity > 0),
  units_per_package INTEGER NOT NULL DEFAULT 1 CHECK (units_per_package > 0),
  total_base_units INTEGER NOT NULL CHECK (total_base_units > 0),
  package_price_in_minor_units BIGINT NOT NULL CHECK (package_price_in_minor_units >= 0),
  base_unit_cost_in_minor_units BIGINT NOT NULL CHECK (base_unit_cost_in_minor_units >= 0),
  discount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (discount_in_minor_units >= 0),
  line_total_in_minor_units BIGINT NOT NULL CHECK (line_total_in_minor_units >= 0),
  batch_number TEXT,
  production_date DATE,
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON public.supplier_receipt_items(supplier_receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_product_id ON public.supplier_receipt_items(product_id);

-- -------------------------------------------------------------------------
-- 4. ADD SUPPLIER_RECEIPT_ID TO SUPPLIER_PAYMENTS
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='supplier_payments' AND column_name='supplier_receipt_id'
  ) THEN
    ALTER TABLE public.supplier_payments 
      ADD COLUMN supplier_receipt_id UUID REFERENCES public.supplier_receipts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_receipt_id ON public.supplier_payments(supplier_receipt_id);

-- -------------------------------------------------------------------------
-- AUTOMATIC TIMESTAMP TRIGGER FOR SUPPLIER_RECEIPTS
-- -------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_update_supplier_receipts_updated_at
BEFORE UPDATE ON public.supplier_receipts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES (SINGLE USER AUTHENTICATED ACCESS)
-- -------------------------------------------------------------------------
ALTER TABLE public.supplier_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated staff to read supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow authenticated staff to manage supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow authenticated staff to read supplier receipt items" ON public.supplier_receipt_items;
DROP POLICY IF EXISTS "Allow authenticated staff to manage supplier receipt items" ON public.supplier_receipt_items;

DROP POLICY IF EXISTS "Allow authorized roles to read supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow authorized roles to manage supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow authorized roles to read supplier receipt items" ON public.supplier_receipt_items;
DROP POLICY IF EXISTS "Allow authorized roles to manage supplier receipt items" ON public.supplier_receipt_items;

DROP POLICY IF EXISTS "Allow owner to select supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow owner to select supplier receipt items" ON public.supplier_receipt_items;
DROP POLICY IF EXISTS "Allow authenticated users to select supplier receipts" ON public.supplier_receipts;
DROP POLICY IF EXISTS "Allow authenticated users to select supplier receipt items" ON public.supplier_receipt_items;

CREATE POLICY "Allow authenticated users to select supplier receipts"
  ON public.supplier_receipts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow authenticated users to select supplier receipt items"
  ON public.supplier_receipt_items FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- -------------------------------------------------------------------------
-- RPC 1: create_direct_supplier_receipt
-- Atomic transaction to create receipt, update inventory, record payment, log audit
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_direct_supplier_receipt(
  p_supplier_id UUID,
  p_warehouse_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_supplier_invoice_number TEXT DEFAULT NULL,
  p_supplier_invoice_date DATE DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NOW(),
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_tax_in_minor_units BIGINT DEFAULT 0,
  p_amount_paid_in_minor_units BIGINT DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_purchase_unit_id UUID;
  v_base_unit_id UUID;
  v_purchase_unit_name TEXT;
  v_base_unit_name TEXT;
  v_pkg_qty INT;
  v_units_per_pkg INT;
  v_total_base_units INT;
  v_pkg_price BIGINT;
  v_base_unit_cost BIGINT;
  v_item_discount BIGINT;
  v_line_total BIGINT;
  v_batch_number TEXT;
  v_prod_date DATE;
  v_exp_date DATE;
  v_item_notes TEXT;
  v_subtotal BIGINT := 0;
  v_total BIGINT := 0;
  v_amount_due BIGINT := 0;
  v_payment_status TEXT;
  v_item_count INT := 0;
  v_total_inventory_added INT := 0;
  v_old_on_hand INT := 0;
  v_new_on_hand INT := 0;
  v_total_existing_stock INT := 0;
  v_current_cost BIGINT := 0;
  v_new_wac_cost BIGINT := 0;
  v_existing_receipt JSONB;
BEGIN
  v_user_id := auth.uid();

  -- Security Check: Authenticated Only
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ هذه العملية.';
  END IF;

  -- 1. Idempotency Check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object(
      'success', true,
      'receipt_id', id,
      'receipt_number', receipt_number,
      'total', total_in_minor_units,
      'paid', amount_paid_in_minor_units,
      'due', amount_due_in_minor_units,
      'is_duplicate', true
    ) INTO v_existing_receipt
    FROM public.supplier_receipts
    WHERE idempotency_key = p_idempotency_key;

    IF v_existing_receipt IS NOT NULL THEN
      RETURN v_existing_receipt;
    END IF;
  END IF;

  -- 2. Input Validations
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'المورد مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود بالنظام.';
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'المستودع مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود بالنظام.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة منتج واحد على الأقل للاستلام.';
  END IF;

  -- 3. Calculate Subtotal and Validate Each Item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_pkg_qty := (v_item->>'package_quantity')::INT;
    v_units_per_pkg := COALESCE((v_item->>'units_per_package')::INT, 1);
    v_pkg_price := (v_item->>'package_price_in_minor_units')::BIGINT;
    v_item_discount := COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);

    IF v_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id) THEN
      RAISE EXCEPTION 'أحد المنتجات غير موجود بالنظام.';
    END IF;

    IF v_pkg_qty IS NULL OR v_pkg_qty <= 0 THEN
      RAISE EXCEPTION 'كمية الطرود يجب أن تكون عدداً صحيحاً أكبر من صفر.';
    END IF;

    IF v_units_per_pkg <= 0 THEN
      RAISE EXCEPTION 'عدد الوحدات في الطرد يجب أن يكون عدداً صحيحاً أكبر من صفر.';
    END IF;

    IF v_pkg_price < 0 THEN
      RAISE EXCEPTION 'سعر شراء الطرد لا يمكن أن يكون بالسالب.';
    END IF;

    -- Business Validation 1: Line discount must never exceed line subtotal
    IF v_item_discount > (v_pkg_qty * v_pkg_price) THEN
      RAISE EXCEPTION 'خصم الصنف يتجاوز إجمالي الصنف قبل الخصم.';
    END IF;

    v_total_base_units := v_pkg_qty * v_units_per_pkg;
    v_line_total := (v_pkg_qty * v_pkg_price) - v_item_discount;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    v_subtotal := v_subtotal + v_line_total;
    v_item_count := v_item_count + 1;
    v_total_inventory_added := v_total_inventory_added + v_total_base_units;
  END LOOP;

  -- 4. Calculate Final Financials & Business Validations
  -- Business Validation 2: Receipt discount must never exceed receipt subtotal
  IF COALESCE(p_discount_in_minor_units, 0) > v_subtotal THEN
    RAISE EXCEPTION 'خصم السند يتجاوز مجموع الأصناف (الإجمالي الفرعي).';
  END IF;

  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0) + COALESCE(p_delivery_fee_in_minor_units, 0) + COALESCE(p_tax_in_minor_units, 0);
  IF v_total < 0 THEN v_total := 0; END IF;

  -- Business Validation 3: Paid amount must never exceed receipt total
  IF COALESCE(p_amount_paid_in_minor_units, 0) > v_total THEN
    RAISE EXCEPTION 'المبلغ المدفوع يتجاوز إجمالي السند.';
  END IF;

  IF p_amount_paid_in_minor_units >= v_total THEN
    v_amount_due := 0;
    v_payment_status := 'paid';
  ELSIF p_amount_paid_in_minor_units > 0 THEN
    v_amount_due := v_total - p_amount_paid_in_minor_units;
    v_payment_status := 'partially_paid';
  ELSE
    v_amount_due := v_total;
    v_payment_status := 'unpaid';
  END IF;

  -- 5. Generate Receipt Number (GRN-YYYY-XXXXXX)
  v_receipt_number := 'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('public.supplier_receipt_seq')::TEXT, 6, '0');

  -- 6. Insert Supplier Receipt Header
  INSERT INTO public.supplier_receipts (
    receipt_number,
    supplier_id,
    warehouse_id,
    branch_id,
    supplier_invoice_number,
    supplier_invoice_date,
    received_at,
    received_by,
    subtotal_in_minor_units,
    discount_in_minor_units,
    delivery_fee_in_minor_units,
    tax_in_minor_units,
    total_in_minor_units,
    amount_paid_in_minor_units,
    amount_due_in_minor_units,
    payment_status,
    payment_method,
    payment_reference,
    notes,
    internal_notes,
    status,
    idempotency_key
  ) VALUES (
    v_receipt_number,
    p_supplier_id,
    p_warehouse_id,
    p_branch_id,
    NULLIF(TRIM(p_supplier_invoice_number), ''),
    p_supplier_invoice_date,
    COALESCE(p_received_at, NOW()),
    v_user_id,
    v_subtotal,
    COALESCE(p_discount_in_minor_units, 0),
    COALESCE(p_delivery_fee_in_minor_units, 0),
    COALESCE(p_tax_in_minor_units, 0),
    v_total,
    COALESCE(p_amount_paid_in_minor_units, 0),
    v_amount_due,
    v_payment_status,
    p_payment_method,
    NULLIF(TRIM(p_payment_reference), ''),
    p_notes,
    p_internal_notes,
    'completed',
    p_idempotency_key
  ) RETURNING id INTO v_receipt_id;

  -- 7. Process Each Item, Insert Items, Increase Stock & Movement Log
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_purchase_unit_id := NULLIF(v_item->>'purchase_unit_id', '')::UUID;
    v_base_unit_id := NULLIF(v_item->>'base_unit_id', '')::UUID;
    v_purchase_unit_name := v_item->>'purchase_unit_name';
    v_base_unit_name := v_item->>'base_unit_name';
    v_pkg_qty := (v_item->>'package_quantity')::INT;
    v_units_per_pkg := COALESCE((v_item->>'units_per_package')::INT, 1);
    v_total_base_units := v_pkg_qty * v_units_per_pkg;
    v_pkg_price := (v_item->>'package_price_in_minor_units')::BIGINT;
    v_item_discount := COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);
    v_line_total := (v_pkg_qty * v_pkg_price) - v_item_discount;
    IF v_line_total < 0 THEN v_line_total := 0; END IF;

    IF v_total_base_units > 0 THEN
      v_base_unit_cost := v_line_total / v_total_base_units;
    ELSE
      v_base_unit_cost := v_pkg_price;
    END IF;

    v_batch_number := NULLIF(TRIM(v_item->>'batch_number'), '');
    v_prod_date := NULLIF(v_item->>'production_date', '')::DATE;
    v_exp_date := NULLIF(v_item->>'expiry_date', '')::DATE;
    v_item_notes := v_item->>'notes';

    -- Insert Receipt Item
    INSERT INTO public.supplier_receipt_items (
      supplier_receipt_id,
      product_id,
      purchase_unit_id,
      base_unit_id,
      purchase_unit_name,
      base_unit_name,
      package_quantity,
      units_per_package,
      total_base_units,
      package_price_in_minor_units,
      base_unit_cost_in_minor_units,
      discount_in_minor_units,
      line_total_in_minor_units,
      batch_number,
      production_date,
      expiry_date,
      notes
    ) VALUES (
      v_receipt_id,
      v_product_id,
      v_purchase_unit_id,
      v_base_unit_id,
      v_purchase_unit_name,
      v_base_unit_name,
      v_pkg_qty,
      v_units_per_pkg,
      v_total_base_units,
      v_pkg_price,
      v_base_unit_cost,
      v_item_discount,
      v_line_total,
      v_batch_number,
      v_prod_date,
      v_exp_date,
      v_item_notes
    );

    -- 1. Lock and read current inventory balance before increasing stock
    SELECT COALESCE(on_hand_quantity, 0) INTO v_old_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_old_on_hand := 0;
    END IF;
    v_new_on_hand := v_old_on_hand + v_total_base_units;

    -- 2. Calculate total existing stock across all warehouses before adding newly received units
    SELECT COALESCE(SUM(on_hand_quantity), 0) INTO v_total_existing_stock
    FROM public.inventory_balances
    WHERE product_id = v_product_id;

    -- 3. Read current product cost
    SELECT COALESCE(cost_price_in_minor_units, 0) INTO v_current_cost
    FROM public.products
    WHERE id = v_product_id;

    -- 4. Calculate Weighted Average Cost (WAC)
    IF v_total_existing_stock <= 0 OR v_current_cost <= 0 THEN
      v_new_wac_cost := v_base_unit_cost;
    ELSE
      v_new_wac_cost := ROUND(
        ((v_total_existing_stock::NUMERIC * v_current_cost::NUMERIC) + (v_total_base_units::NUMERIC * v_base_unit_cost::NUMERIC))
        / (v_total_existing_stock + v_total_base_units)
      )::BIGINT;
    END IF;

    -- 5. Update Product Cost Price using Weighted Average Cost
    IF v_new_wac_cost > 0 THEN
      UPDATE public.products
      SET cost_price_in_minor_units = v_new_wac_cost, updated_at = NOW()
      WHERE id = v_product_id;
    END IF;

    -- 6. Increase Stock in Inventory Balances
    IF v_old_on_hand = 0 AND NOT EXISTS (
      SELECT 1 FROM public.inventory_balances
      WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id
    ) THEN
      INSERT INTO public.inventory_balances (warehouse_id, product_id, on_hand_quantity, reserved_quantity)
      VALUES (p_warehouse_id, v_product_id, v_new_on_hand, 0);
    ELSE
      UPDATE public.inventory_balances
      SET on_hand_quantity = v_new_on_hand, updated_at = NOW()
      WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id;
    END IF;

    -- 7. Record Inventory Movement
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
      p_warehouse_id,
      v_product_id,
      'purchase_receipt',
      v_total_base_units,
      v_old_on_hand,
      v_new_on_hand,
      'supplier_receipt',
      v_receipt_id,
      'استلام بضاعة مباشرة - سند رقم ' || v_receipt_number,
      v_user_id
    );

  END LOOP;

  -- 8. Record Supplier Payment if Paid Amount > 0
  IF p_amount_paid_in_minor_units > 0 THEN
    INSERT INTO public.supplier_payments (
      supplier_id,
      supplier_receipt_id,
      amount_in_minor_units,
      payment_method,
      reference_number,
      payment_date,
      notes,
      created_by
    ) VALUES (
      p_supplier_id,
      v_receipt_id,
      p_amount_paid_in_minor_units,
      COALESCE(p_payment_method, 'cash'),
      NULLIF(TRIM(p_payment_reference), ''),
      COALESCE(p_received_at, NOW()),
      'دفعة نقدية عند استلام البضاعة - سند ' || v_receipt_number,
      v_user_id
    );
  END IF;

  -- 9. Record Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CREATE_DIRECT_SUPPLIER_RECEIPT',
    'supplier_receipts',
    v_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'supplier_id', p_supplier_id,
      'total', v_total,
      'paid', p_amount_paid_in_minor_units,
      'due', v_amount_due,
      'products_count', v_item_count,
      'total_units_added', v_total_inventory_added
    )
  );

  -- 10. Return Final JSON Output
  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'total', v_total,
    'paid', COALESCE(p_amount_paid_in_minor_units, 0),
    'due', v_amount_due,
    'products_count', v_item_count,
    'total_inventory_units_added', v_total_inventory_added
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 2: record_supplier_receipt_payment
-- Record later payment against a supplier receipt
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_supplier_receipt_payment(
  p_receipt_id UUID,
  p_amount_in_minor_units BIGINT,
  p_payment_method TEXT DEFAULT 'cash',
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_supplier_id UUID;
  v_receipt_number TEXT;
  v_total BIGINT;
  v_old_paid BIGINT;
  v_old_due BIGINT;
  v_new_paid BIGINT;
  v_new_due BIGINT;
  v_new_payment_status TEXT;
  v_payment_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- Security Check: Authenticated Only
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ هذه العملية.';
  END IF;

  IF p_amount_in_minor_units IS NULL OR p_amount_in_minor_units <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;

  SELECT supplier_id, receipt_number, total_in_minor_units, amount_paid_in_minor_units, amount_due_in_minor_units
  INTO v_supplier_id, v_receipt_number, v_total, v_old_paid, v_old_due
  FROM public.supplier_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند استلام البضاعة غير موجود بالنظام.';
  END IF;

  IF v_old_due <= 0 THEN
    RAISE EXCEPTION 'هذا السند مدفوع بالكامل ولا توجد عليه مستحقات متبقية.';
  END IF;

  IF p_amount_in_minor_units > v_old_due THEN
    RAISE EXCEPTION 'مبلغ الدفعة أكبر من المبلغ المستحق المتبقي على السند.';
  END IF;

  v_new_paid := v_old_paid + p_amount_in_minor_units;
  v_new_due := v_total - v_new_paid;
  IF v_new_due <= 0 THEN
    v_new_due := 0;
    v_new_payment_status := 'paid';
  ELSE
    v_new_payment_status := 'partially_paid';
  END IF;

  UPDATE public.supplier_receipts
  SET
    amount_paid_in_minor_units = v_new_paid,
    amount_due_in_minor_units = v_new_due,
    payment_status = v_new_payment_status,
    updated_at = NOW()
  WHERE id = p_receipt_id;

  INSERT INTO public.supplier_payments (
    supplier_id,
    supplier_receipt_id,
    amount_in_minor_units,
    payment_method,
    reference_number,
    payment_date,
    notes,
    created_by
  ) VALUES (
    v_supplier_id,
    p_receipt_id,
    p_amount_in_minor_units,
    COALESCE(p_payment_method, 'cash'),
    NULLIF(TRIM(p_reference_number), ''),
    NOW(),
    COALESCE(p_notes, 'سداد دفعة على سند استلام رقم ' || v_receipt_number),
    v_user_id
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'RECORD_SUPPLIER_RECEIPT_PAYMENT',
    'supplier_receipts',
    p_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'payment_id', v_payment_id,
      'amount_paid', p_amount_in_minor_units,
      'remaining_due', v_new_due
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount_paid', p_amount_in_minor_units,
    'total_paid', v_new_paid,
    'amount_due', v_new_due,
    'payment_status', v_new_payment_status
  );
END;
$$;

-- -------------------------------------------------------------------------
-- RPC 3: archive_supplier_receipt
-- Archive or restore a completed supplier receipt
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.archive_supplier_receipt(
  p_receipt_id UUID,
  p_is_archived BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Security Check: Authenticated Only
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ هذه العملية.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.supplier_receipts WHERE id = p_receipt_id) THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;

  UPDATE public.supplier_receipts
  SET is_archived = p_is_archived, updated_at = NOW()
  WHERE id = p_receipt_id;

  RETURN jsonb_build_object('success', true, 'is_archived', p_is_archived);
END;
$$;

-- -------------------------------------------------------------------------
-- FUNCTION EXECUTION PERMISSIONS (REVOKE PUBLIC, GRANT AUTHENTICATED)
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) TO authenticated;

REVOKE ALL ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_supplier_receipt(
  UUID, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.archive_supplier_receipt(
  UUID, BOOLEAN
) TO authenticated;

