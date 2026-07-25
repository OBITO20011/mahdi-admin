-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 010: Warehouse Completion
-- Comprehensive Warehouse Operations:
-- 1. Inter-Warehouse Inventory Transfers
-- 2. Supplier Goods Returns (RTV)
-- 3. Full Reversal & Cancellation of Supplier Receipts
-- 4. Warehouse Stock Count & Physical Reconciliation
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. SEQUENCES
-- -------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.supplier_return_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS public.stock_count_seq START 1001;

-- -------------------------------------------------------------------------
-- 2. TABLES FOR SUPPLIER RETURNS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT UNIQUE NOT NULL,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  supplier_receipt_id UUID REFERENCES public.supplier_receipts(id) ON DELETE SET NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (total_amount_in_minor_units >= 0),
  refund_amount_in_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (refund_amount_in_minor_units >= 0),
  reason TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_returns_number ON public.supplier_returns(return_number);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON public.supplier_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_warehouse ON public.supplier_returns(warehouse_id);

CREATE TABLE IF NOT EXISTS public.supplier_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_return_id UUID NOT NULL REFERENCES public.supplier_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_unit_name TEXT,
  base_unit_name TEXT,
  package_quantity INTEGER NOT NULL CHECK (package_quantity > 0),
  units_per_package INTEGER NOT NULL DEFAULT 1 CHECK (units_per_package > 0),
  total_base_units INTEGER NOT NULL CHECK (total_base_units > 0),
  package_price_in_minor_units BIGINT NOT NULL CHECK (package_price_in_minor_units >= 0),
  line_total_in_minor_units BIGINT NOT NULL CHECK (line_total_in_minor_units >= 0),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON public.supplier_return_items(supplier_return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product_id ON public.supplier_return_items(product_id);

-- -------------------------------------------------------------------------
-- 3. TABLES FOR STOCK COUNTS (RECONCILIATION)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number TEXT UNIQUE NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_counts_number ON public.stock_counts(count_number);
CREATE INDEX IF NOT EXISTS idx_stock_counts_warehouse ON public.stock_counts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON public.stock_counts(status);

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id UUID NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  system_quantity INTEGER NOT NULL CHECK (system_quantity >= 0),
  actual_quantity INTEGER CHECK (actual_quantity >= 0),
  variance_quantity INTEGER DEFAULT 0,
  unit_cost_in_minor_units BIGINT NOT NULL DEFAULT 0,
  total_variance_cost_in_minor_units BIGINT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_count_items_count_id ON public.stock_count_items(stock_count_id);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_product_id ON public.stock_count_items(product_id);

-- Enable RLS
ALTER TABLE public.supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

-- Standard Permissive Policies for Authenticated App Users
CREATE POLICY "Allow all authenticated users access to supplier_returns" ON public.supplier_returns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all authenticated users access to supplier_return_items" ON public.supplier_return_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all authenticated users access to stock_counts" ON public.stock_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all authenticated users access to stock_count_items" ON public.stock_count_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anonymous policies for dev environment
CREATE POLICY "Allow anon select supplier_returns" ON public.supplier_returns FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select supplier_return_items" ON public.supplier_return_items FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select stock_counts" ON public.stock_counts FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon select stock_count_items" ON public.stock_count_items FOR SELECT TO anon USING (true);


-- =========================================================================
-- 4. RPC 1: transfer_inventory_between_warehouses
-- Atomically moves stock from source warehouse to destination warehouse
-- =========================================================================
CREATE OR REPLACE FUNCTION public.transfer_inventory_between_warehouses(
  p_product_id UUID,
  p_source_warehouse_id UUID,
  p_destination_warehouse_id UUID,
  p_quantity INT,
  p_notes TEXT DEFAULT NULL,
  p_transfer_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_product_name TEXT;
  v_source_wh_name TEXT;
  v_dest_wh_name TEXT;
  v_source_on_hand INT;
  v_source_prev INT;
  v_source_new INT;
  v_dest_prev INT;
  v_dest_new INT;
  v_mov_out_id UUID;
  v_mov_in_id UUID;
BEGIN
  v_user_id := auth.uid();

  -- 1. Validations
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'الكمية المنقولة يجب أن تكون أكبر من صفر.';
  END IF;

  IF p_source_warehouse_id = p_destination_warehouse_id THEN
    RAISE EXCEPTION 'لا يمكن نقل المخزون إلى نفس المستودع المصدر.';
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF v_product_name IS NULL THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  SELECT name INTO v_source_wh_name FROM public.warehouses WHERE id = p_source_warehouse_id;
  IF v_source_wh_name IS NULL THEN
    RAISE EXCEPTION 'المستودع المصدر غير موجود.';
  END IF;

  SELECT name INTO v_dest_wh_name FROM public.warehouses WHERE id = p_destination_warehouse_id;
  IF v_dest_wh_name IS NULL THEN
    RAISE EXCEPTION 'المستودع الهدف غير موجود.';
  END IF;

  -- 2. Lock Source Inventory Row (FOR UPDATE)
  SELECT COALESCE(on_hand_quantity, 0)
    INTO v_source_on_hand
    FROM public.inventory_balances
   WHERE warehouse_id = p_source_warehouse_id AND product_id = p_product_id
     FOR UPDATE;

  IF v_source_on_hand IS NULL OR v_source_on_hand < p_quantity THEN
    RAISE EXCEPTION 'الكمية المتاحة في المستودع المصدر (% قطعة) غير كافية لنقل % قطعة.', COALESCE(v_source_on_hand, 0), p_quantity;
  END IF;

  v_source_prev := v_source_on_hand;
  v_source_new := v_source_prev - p_quantity;

  -- Deduct from Source
  UPDATE public.inventory_balances
     SET on_hand_quantity = v_source_new,
         updated_at = NOW()
   WHERE warehouse_id = p_source_warehouse_id AND product_id = p_product_id;

  -- Lock / Upsert Destination Inventory Row
  SELECT COALESCE(on_hand_quantity, 0)
    INTO v_dest_prev
    FROM public.inventory_balances
   WHERE warehouse_id = p_destination_warehouse_id AND product_id = p_product_id
     FOR UPDATE;

  IF v_dest_prev IS NULL THEN
    v_dest_prev := 0;
    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_destination_warehouse_id,
      p_product_id,
      p_quantity,
      0
    );
    v_dest_new := p_quantity;
  ELSE
    v_dest_new := v_dest_prev + p_quantity;
    UPDATE public.inventory_balances
       SET on_hand_quantity = v_dest_new,
           updated_at = NOW()
     WHERE warehouse_id = p_destination_warehouse_id AND product_id = p_product_id;
  END IF;

  -- 3. Create Inventory Movements
  -- Movement OUT from source
  INSERT INTO public.inventory_movements (
    product_id,
    warehouse_id,
    movement_type,
    quantity,
    previous_quantity,
    new_quantity,
    reference_type,
    notes,
    performed_by,
    created_at
  ) VALUES (
    p_product_id,
    p_source_warehouse_id,
    'transfer_out',
    -p_quantity,
    v_source_prev,
    v_source_new,
    'TRANSFER',
    COALESCE(p_notes, 'نقل مخزون خروج إلى ' || v_dest_wh_name),
    v_user_id,
    COALESCE(p_transfer_date, NOW())
  ) RETURNING id INTO v_mov_out_id;

  -- Movement IN to destination
  INSERT INTO public.inventory_movements (
    product_id,
    warehouse_id,
    movement_type,
    quantity,
    previous_quantity,
    new_quantity,
    reference_type,
    notes,
    performed_by,
    created_at
  ) VALUES (
    p_product_id,
    p_destination_warehouse_id,
    'transfer_in',
    p_quantity,
    v_dest_prev,
    v_dest_new,
    'TRANSFER',
    COALESCE(p_notes, 'نقل مخزون دخول من ' || v_source_wh_name),
    v_user_id,
    COALESCE(p_transfer_date, NOW())
  ) RETURNING id INTO v_mov_in_id;

  -- 4. Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'TRANSFER_INVENTORY',
    'inventory_balances',
    p_product_id,
    jsonb_build_object(
      'product_name', v_product_name,
      'quantity', p_quantity,
      'source_warehouse', v_source_wh_name,
      'destination_warehouse', v_dest_wh_name,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم نقل الشحنة بنجاح من ' || v_source_wh_name || ' إلى ' || v_dest_wh_name,
    'productId', p_product_id,
    'quantityTransferred', p_quantity,
    'sourceNewQuantity', v_source_new,
    'destinationNewQuantity', v_dest_new,
    'movementOutId', v_mov_out_id,
    'movementInId', v_mov_in_id
  );
END;
$$;


-- =========================================================================
-- 5. RPC 2: create_supplier_return
-- Creates RTV (Return to Vendor), decreases inventory & logs movements
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_supplier_return(
  p_supplier_id UUID,
  p_warehouse_id UUID,
  p_supplier_receipt_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_refund_amount_in_minor_units BIGINT DEFAULT 0,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_return_id UUID;
  v_return_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_package_qty INT;
  v_units_per_pkg INT;
  v_total_base_units INT;
  v_package_price BIGINT;
  v_line_total BIGINT;
  v_item_reason TEXT;
  v_subtotal BIGINT := 0;
  v_on_hand INT;
  v_prev_qty INT;
  v_new_qty INT;
  v_prod_name TEXT;
  v_purch_unit_name TEXT;
  v_base_unit_name TEXT;
BEGIN
  v_user_id := auth.uid();

  -- 1. Validations
  IF p_supplier_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'المورد والمستودع مطلوبان لإنشاء مرتجع الشراء.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'يجب إضافة أصناف مرتجعة واحدة على الأقل.';
  END IF;

  -- Generate Return Number
  v_return_number := 'RET-' || LPAD(NEXTVAL('public.supplier_return_seq')::TEXT, 5, '0');

  -- First pass: calculate totals and verify stock sufficiency
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_package_qty := COALESCE((v_item->>'package_quantity')::INT, 0);
    v_units_per_pkg := GREATEST(1, COALESCE((v_item->>'units_per_package')::INT, 1));
    v_package_price := COALESCE((v_item->>'package_price_in_minor_units')::BIGINT, 0);

    IF v_package_qty <= 0 THEN
      RAISE EXCEPTION 'كمية الطرود المرتجعة يجب أن تكون أكبر من صفر.';
    END IF;

    v_total_base_units := v_package_qty * v_units_per_pkg;
    v_line_total := v_package_qty * v_package_price;
    v_subtotal := v_subtotal + v_line_total;

    -- Verify stock in warehouse FOR UPDATE
    SELECT COALESCE(on_hand_quantity, 0) INTO v_on_hand
      FROM public.inventory_balances
     WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id
       FOR UPDATE;

    SELECT name INTO v_prod_name FROM public.products WHERE id = v_product_id;

    IF v_on_hand IS NULL OR v_on_hand < v_total_base_units THEN
      RAISE EXCEPTION 'المخزون المتوفر من المنتج (%: % قطعة) غير كافٍ لإرجاع % قطعة.', COALESCE(v_prod_name, 'المنتج'), COALESCE(v_on_hand, 0), v_total_base_units;
    END IF;
  END LOOP;

  -- 2. Insert Parent Return
  INSERT INTO public.supplier_returns (
    return_number,
    supplier_id,
    warehouse_id,
    supplier_receipt_id,
    return_date,
    total_amount_in_minor_units,
    refund_amount_in_minor_units,
    reason,
    notes,
    status,
    created_by
  ) VALUES (
    v_return_number,
    p_supplier_id,
    p_warehouse_id,
    p_supplier_receipt_id,
    CURRENT_DATE,
    v_subtotal,
    p_refund_amount_in_minor_units,
    p_reason,
    p_notes,
    'completed',
    v_user_id
  ) RETURNING id INTO v_return_id;

  -- 3. Insert Items & Execute Stock Deductions
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_package_qty := (v_item->>'package_quantity')::INT;
    v_units_per_pkg := GREATEST(1, COALESCE((v_item->>'units_per_package')::INT, 1));
    v_package_price := COALESCE((v_item->>'package_price_in_minor_units')::BIGINT, 0);
    v_item_reason := v_item->>'reason';
    v_purch_unit_name := COALESCE(v_item->>'purchase_unit_name', 'طرد');
    v_base_unit_name := COALESCE(v_item->>'base_unit_name', 'قطعة');

    v_total_base_units := v_package_qty * v_units_per_pkg;
    v_line_total := v_package_qty * v_package_price;

    -- Insert return item row
    INSERT INTO public.supplier_return_items (
      supplier_return_id,
      product_id,
      purchase_unit_name,
      base_unit_name,
      package_quantity,
      units_per_package,
      total_base_units,
      package_price_in_minor_units,
      line_total_in_minor_units,
      reason
    ) VALUES (
      v_return_id,
      v_product_id,
      v_purch_unit_name,
      v_base_unit_name,
      v_package_qty,
      v_units_per_pkg,
      v_total_base_units,
      v_package_price,
      v_line_total,
      v_item_reason
    );

    -- Get current balance
    SELECT COALESCE(on_hand_quantity, 0) INTO v_prev_qty
      FROM public.inventory_balances
     WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id;

    v_new_qty := v_prev_qty - v_total_base_units;

    -- Deduct stock
    UPDATE public.inventory_balances
       SET on_hand_quantity = v_new_qty,
           updated_at = NOW()
     WHERE warehouse_id = p_warehouse_id AND product_id = v_product_id;

    -- Log Movement
    INSERT INTO public.inventory_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      previous_quantity,
      new_quantity,
      reference_id,
      reference_type,
      notes,
      performed_by
    ) VALUES (
      v_product_id,
      p_warehouse_id,
      'supplier_return',
      -v_total_base_units,
      v_prev_qty,
      v_new_qty,
      v_return_id,
      'SUPPLIER_RETURN',
      'مرتجع بضاعة للمورد (سند رقم ' || v_return_number || ')',
      v_user_id
    );
  END LOOP;

  -- 4. Audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CREATE_SUPPLIER_RETURN',
    'supplier_returns',
    v_return_id,
    jsonb_build_object(
      'return_number', v_return_number,
      'supplier_id', p_supplier_id,
      'total_amount', v_subtotal,
      'refund_amount', p_refund_amount_in_minor_units
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم إنشاء مرتجع المورد رقم ' || v_return_number || ' بنجاح.',
    'returnId', v_return_id,
    'returnNumber', v_return_number,
    'totalAmount', v_subtotal
  );
END;
$$;


-- =========================================================================
-- 6. RPC 3: cancel_supplier_receipt
-- Safely cancels/reverses a supplier receipt, verifies stock non-negativity
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cancel_supplier_receipt(
  p_supplier_receipt_id UUID,
  p_reason TEXT DEFAULT 'إلغاء سند استلام البضائع'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_receipt RECORD;
  v_item RECORD;
  v_on_hand INT;
  v_prev_qty INT;
  v_new_qty INT;
  v_product_name TEXT;
BEGIN
  v_user_id := auth.uid();

  -- 1. Fetch Receipt with FOR UPDATE lock
  SELECT * INTO v_receipt
    FROM public.supplier_receipts
   WHERE id = p_supplier_receipt_id
     FOR UPDATE;

  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'سند استلام البضائع غير موجود.';
  END IF;

  IF v_receipt.status = 'cancelled' THEN
    RAISE EXCEPTION 'سند الاستلام هذا ملغى بالفعل من قبل.';
  END IF;

  -- 2. First Pass: Check stock levels for all products in receipt
  FOR v_item IN
    SELECT sri.*, p.name AS product_name
      FROM public.supplier_receipt_items sri
      JOIN public.products p ON p.id = sri.product_id
     WHERE sri.supplier_receipt_id = p_supplier_receipt_id
  LOOP
    SELECT COALESCE(on_hand_quantity, 0) INTO v_on_hand
      FROM public.inventory_balances
     WHERE warehouse_id = v_receipt.warehouse_id AND product_id = v_item.product_id
       FOR UPDATE;

    IF v_on_hand IS NULL OR v_on_hand < v_item.total_base_units THEN
      RAISE EXCEPTION 'لا يمكن إلغاء السند: الكمية المتاحة حالياً بالمخزن للمنتج (%: % قطعة) أقل من الكمية المستلمة بالسند (% قطعة) بسبب مبيعات/سحوبات سابقة.',
        v_item.product_name, COALESCE(v_on_hand, 0), v_item.total_base_units;
    END IF;
  END LOOP;

  -- 3. Second Pass: Reverse Inventory & Log Movements
  FOR v_item IN
    SELECT * FROM public.supplier_receipt_items
     WHERE supplier_receipt_id = p_supplier_receipt_id
  LOOP
    SELECT COALESCE(on_hand_quantity, 0) INTO v_prev_qty
      FROM public.inventory_balances
     WHERE warehouse_id = v_receipt.warehouse_id AND product_id = v_item.product_id;

    v_new_qty := v_prev_qty - v_item.total_base_units;

    -- Deduct stock from inventory_balances
    UPDATE public.inventory_balances
       SET on_hand_quantity = v_new_qty,
           updated_at = NOW()
     WHERE warehouse_id = v_receipt.warehouse_id AND product_id = v_item.product_id;

    -- Create Reversal Inventory Movement
    INSERT INTO public.inventory_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      previous_quantity,
      new_quantity,
      reference_id,
      reference_type,
      notes,
      performed_by
    ) VALUES (
      v_item.product_id,
      v_receipt.warehouse_id,
      'receipt_cancellation',
      -v_item.total_base_units,
      v_prev_qty,
      v_new_qty,
      p_supplier_receipt_id,
      'SUPPLIER_RECEIPT_CANCELLATION',
      'إلغاء وإرجاع سند استلام رقم ' || v_receipt.receipt_number || ' - ' || COALESCE(p_reason, ''),
      v_user_id
    );
  END LOOP;

  -- 4. Mark Supplier Receipt as Cancelled and Archived
  UPDATE public.supplier_receipts
     SET status = 'cancelled',
         is_archived = true,
         notes = COALESCE(notes, '') || E'\n[تم إلغاء السند بتاريخ ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || ']: ' || COALESCE(p_reason, 'لا يوجد سبب مذكور'),
         updated_at = NOW()
   WHERE id = p_supplier_receipt_id;

  -- 5. Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CANCEL_SUPPLIER_RECEIPT',
    'supplier_receipts',
    p_supplier_receipt_id,
    jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم إلغاء سند الاستلام رقم ' || v_receipt.receipt_number || ' وعكس المخزون بنجاح.',
    'receiptId', p_supplier_receipt_id,
    'receiptNumber', v_receipt.receipt_number
  );
END;
$$;


-- =========================================================================
-- 7. RPC 4 & 5: Stock Count Session Creation & Final Approval
-- Creates stock audit snapshot and reconciles physical inventory variance
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_stock_count_session(
  p_warehouse_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_count_id UUID;
  v_count_number TEXT;
  v_items_inserted INT := 0;
BEGIN
  v_user_id := auth.uid();

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'المستودع مطلوب لبدء جلسة جرد المخزون.';
  END IF;

  v_count_number := 'STK-' || LPAD(NEXTVAL('public.stock_count_seq')::TEXT, 5, '0');

  -- Create Parent Session
  INSERT INTO public.stock_counts (
    count_number,
    warehouse_id,
    status,
    snapshot_date,
    notes,
    created_by
  ) VALUES (
    v_count_number,
    p_warehouse_id,
    'draft',
    NOW(),
    p_notes,
    v_user_id
  ) RETURNING id INTO v_count_id;

  -- Take Snapshot of all Products in this Warehouse
  INSERT INTO public.stock_count_items (
    stock_count_id,
    product_id,
    system_quantity,
    actual_quantity,
    variance_quantity,
    unit_cost_in_minor_units,
    total_variance_cost_in_minor_units
  )
  SELECT
    v_count_id,
    p.id,
    COALESCE(ib.on_hand_quantity, 0) AS system_quantity,
    COALESCE(ib.on_hand_quantity, 0) AS actual_quantity,
    0 AS variance_quantity,
    p.cost_price_in_minor_units AS unit_cost_in_minor_units,
    0 AS total_variance_cost_in_minor_units
  FROM public.products p
  LEFT JOIN public.inventory_balances ib
         ON ib.product_id = p.id AND ib.warehouse_id = p_warehouse_id
  WHERE p.is_active = true;

  GET DIAGNOSTICS v_items_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم إنشـاء جلسة الجرد رقم ' || v_count_number || ' وبها ' || v_items_inserted || ' أصناف.',
    'stockCountId', v_count_id,
    'countNumber', v_count_number,
    'itemsCounted', v_items_inserted
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.approve_stock_count(
  p_stock_count_id UUID,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_stock_count RECORD;
  v_item JSONB;
  v_product_id UUID;
  v_actual_qty INT;
  v_system_qty INT;
  v_variance INT;
  v_unit_cost BIGINT;
  v_variance_cost BIGINT;
  v_prev_qty INT;
  v_total_variances INT := 0;
BEGIN
  v_user_id := auth.uid();

  -- 1. Fetch Stock Count Session FOR UPDATE
  SELECT * INTO v_stock_count
    FROM public.stock_counts
   WHERE id = p_stock_count_id
     FOR UPDATE;

  IF v_stock_count IS NULL THEN
    RAISE EXCEPTION 'جلسة جرد المخزون غير موجودة.';
  END IF;

  IF v_stock_count.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد جلسة جرد غير مسودة أو جرى اعتمادها سابقاً.';
  END IF;

  -- 2. Process Actual Quantities & Apply Variances
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_actual_qty := GREATEST(0, COALESCE((v_item->>'actual_quantity')::INT, 0));

    -- Get System Qty and Cost Price
    SELECT COALESCE(ib.on_hand_quantity, 0), p.cost_price_in_minor_units
      INTO v_system_qty, v_unit_cost
      FROM public.products p
      LEFT JOIN public.inventory_balances ib
             ON ib.product_id = p.id AND ib.warehouse_id = v_stock_count.warehouse_id
     WHERE p.id = v_product_id;

    v_variance := v_actual_qty - COALESCE(v_system_qty, 0);
    v_variance_cost := v_variance * COALESCE(v_unit_cost, 0);

    -- Update or insert stock count item record
    UPDATE public.stock_count_items
       SET actual_quantity = v_actual_qty,
           variance_quantity = v_variance,
           unit_cost_in_minor_units = COALESCE(v_unit_cost, 0),
           total_variance_cost_in_minor_units = v_variance_cost,
           notes = v_item->>'notes'
     WHERE stock_count_id = p_stock_count_id AND product_id = v_product_id;

    IF NOT FOUND THEN
      INSERT INTO public.stock_count_items (
        stock_count_id,
        product_id,
        system_quantity,
        actual_quantity,
        variance_quantity,
        unit_cost_in_minor_units,
        total_variance_cost_in_minor_units,
        notes
      ) VALUES (
        p_stock_count_id,
        v_product_id,
        COALESCE(v_system_qty, 0),
        v_actual_qty,
        v_variance,
        COALESCE(v_unit_cost, 0),
        v_variance_cost,
        v_item->>'reason'
      );
    END IF;

    -- Apply inventory balance adjustment if variance exists
    IF v_variance <> 0 THEN
      v_total_variances := v_total_variances + 1;

      -- Upsert inventory balance
      INSERT INTO public.inventory_balances (
        warehouse_id,
        product_id,
        on_hand_quantity,
        reserved_quantity
      ) VALUES (
        v_stock_count.warehouse_id,
        v_product_id,
        v_actual_qty,
        0
      ) ON CONFLICT (warehouse_id, product_id)
      DO UPDATE SET on_hand_quantity = EXCLUDED.on_hand_quantity,
                    updated_at = NOW();

      -- Log Inventory Movement
      INSERT INTO public.inventory_movements (
        product_id,
        warehouse_id,
        movement_type,
        quantity,
        previous_quantity,
        new_quantity,
        reference_id,
        reference_type,
        notes,
        performed_by
      ) VALUES (
        v_product_id,
        v_stock_count.warehouse_id,
        'stock_count_adjustment',
        v_variance,
        COALESCE(v_system_qty, 0),
        v_actual_qty,
        p_stock_count_id,
        'STOCK_COUNT',
        'تسوية جرد مخزون (جلسة رقم ' || v_stock_count.count_number || ')',
        v_user_id
      );
    END IF;
  END LOOP;

  -- 3. Mark Session Approved
  UPDATE public.stock_counts
     SET status = 'approved',
         approved_by = v_user_id,
         approved_at = NOW(),
         notes = COALESCE(p_notes, notes),
         updated_at = NOW()
   WHERE id = p_stock_count_id;

  -- 4. Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_type,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'APPROVE_STOCK_COUNT',
    'stock_counts',
    p_stock_count_id,
    jsonb_build_object(
      'count_number', v_stock_count.count_number,
      'variances_adjusted', v_total_variances
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'تم اعتماد نتيجة الجرد رقم ' || v_stock_count.count_number || ' وتعديل رصيد المخزون بنجاح.',
    'stockCountId', p_stock_count_id,
    'countNumber', v_stock_count.count_number,
    'variancesCount', v_total_variances
  );
END;
$$;
