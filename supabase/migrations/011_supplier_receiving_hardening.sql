-- =========================================================================
-- Nawasrah ERP - Migration 011
-- Supplier receiving hardening, product packaging, supplier balances,
-- sales cost snapshots, and RPC permission enforcement.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Canonical purchase-package units
-- -------------------------------------------------------------------------
INSERT INTO public.units (code, name_ar) VALUES
  ('CTN', 'كرتونة'),
  ('BOX', 'صندوق'),
  ('PKT', 'باكيت'),
  ('SHRINK', 'شرنك'),
  ('BAG', 'كيس'),
  ('SACK', 'شوال'),
  ('BUNDLE', 'ربطة'),
  ('CASE', 'حافظة'),
  ('CAN', 'علبة'),
  ('BTL', 'قنينة / زجاجة'),
  ('PCS', 'حبة / قطعة')
ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar;

-- -------------------------------------------------------------------------
-- 2. Product master packaging fields
-- -------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS purchase_unit_id UUID,
  ADD COLUMN IF NOT EXISTS units_per_purchase_unit INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_purchase_price_in_minor_units BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_purchase_unit_id_fkey'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_purchase_unit_id_fkey
      FOREIGN KEY (purchase_unit_id)
      REFERENCES public.units(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_units_per_purchase_unit_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_units_per_purchase_unit_check
      CHECK (units_per_purchase_unit > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_default_purchase_price_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_default_purchase_price_check
      CHECK (default_purchase_price_in_minor_units >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_products_purchase_unit_id
  ON public.products(purchase_unit_id);

UPDATE public.products
SET
  purchase_unit_id = COALESCE(purchase_unit_id, unit_id),
  units_per_purchase_unit = GREATEST(1, units_per_purchase_unit),
  default_purchase_price_in_minor_units = CASE
    WHEN default_purchase_price_in_minor_units > 0
      THEN default_purchase_price_in_minor_units
    ELSE cost_price_in_minor_units * GREATEST(1, units_per_purchase_unit)
  END
WHERE
  purchase_unit_id IS NULL
  OR units_per_purchase_unit < 1
  OR default_purchase_price_in_minor_units = 0;

-- -------------------------------------------------------------------------
-- 3. Supplier payable balance and immutable receipt price snapshots
-- -------------------------------------------------------------------------
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS current_balance_in_minor_units BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'suppliers_current_balance_minor_check'
      AND conrelid = 'public.suppliers'::regclass
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_current_balance_minor_check
      CHECK (current_balance_in_minor_units >= 0);
  END IF;
END;
$$;

ALTER TABLE public.supplier_receipt_items
  ADD COLUMN IF NOT EXISTS selling_price_in_minor_units BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_receipt_items_selling_price_check'
      AND conrelid = 'public.supplier_receipt_items'::regclass
  ) THEN
    ALTER TABLE public.supplier_receipt_items
      ADD CONSTRAINT supplier_receipt_items_selling_price_check
      CHECK (selling_price_in_minor_units >= 0);
  END IF;
END;
$$;

UPDATE public.supplier_receipt_items sri
SET selling_price_in_minor_units = p.sale_price_in_minor_units
FROM public.products p
WHERE p.id = sri.product_id
  AND sri.selling_price_in_minor_units = 0;

UPDATE public.suppliers s
SET current_balance_in_minor_units = COALESCE((
  SELECT SUM(sr.amount_due_in_minor_units)
  FROM public.supplier_receipts sr
  WHERE sr.supplier_id = s.id
    AND sr.status = 'completed'
), 0);

-- -------------------------------------------------------------------------
-- 4. Sales cost and profit snapshots
-- -------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cogs_in_minor_units BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_in_minor_units BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.populate_order_item_cost_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_cost BIGINT;
BEGIN
  SELECT cost_price_in_minor_units
  INTO v_unit_cost
  FROM public.products
  WHERE id = NEW.product_id;

  NEW.unit_cost_in_minor_units := COALESCE(v_unit_cost, 0);
  NEW.cogs_in_minor_units :=
    COALESCE(NEW.quantity, 0) * NEW.unit_cost_in_minor_units;
  NEW.profit_in_minor_units :=
    COALESCE(NEW.line_total_in_minor_units, 0) - NEW.cogs_in_minor_units;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_item_cost_snapshot ON public.order_items;
CREATE TRIGGER trg_order_item_cost_snapshot
BEFORE INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.populate_order_item_cost_snapshot();

UPDATE public.order_items oi
SET
  unit_cost_in_minor_units = p.cost_price_in_minor_units,
  cogs_in_minor_units = oi.quantity * p.cost_price_in_minor_units,
  profit_in_minor_units =
    oi.line_total_in_minor_units - (oi.quantity * p.cost_price_in_minor_units)
FROM public.products p
WHERE p.id = oi.product_id
  AND oi.unit_cost_in_minor_units = 0;

-- -------------------------------------------------------------------------
-- 5. Product creation RPC extended with purchase packaging
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_product_with_opening_stock(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, BIGINT, BIGINT,
  INTEGER, INTEGER, UUID, INTEGER, TEXT
);

CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock(
  p_sku TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_name_ar TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_purchase_unit_id UUID DEFAULT NULL,
  p_units_per_purchase_unit INTEGER DEFAULT 1,
  p_default_purchase_price_in_minor_units BIGINT DEFAULT 0,
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INTEGER DEFAULT 0,
  p_max_stock_level INTEGER DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INTEGER DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإضافة منتج.';
  END IF;

  IF p_sku IS NULL OR TRIM(p_sku) = '' THEN
    RAISE EXCEPTION 'رمز SKU مطلوب.';
  END IF;
  IF p_name_ar IS NULL OR TRIM(p_name_ar) = '' THEN
    RAISE EXCEPTION 'اسم المنتج مطلوب.';
  END IF;
  IF p_opening_quantity < 0
    OR p_units_per_purchase_unit <= 0
    OR p_default_purchase_price_in_minor_units < 0
    OR p_cost_price_in_minor_units < 0
    OR p_sale_price_in_minor_units < 0
  THEN
    RAISE EXCEPTION 'الكميات والأسعار يجب أن تكون أعداداً صحيحة غير سالبة.';
  END IF;

  IF p_unit_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.units WHERE id = p_unit_id)
  THEN
    RAISE EXCEPTION 'الوحدة الأساسية غير موجودة.';
  END IF;

  IF p_purchase_unit_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.units WHERE id = p_purchase_unit_id)
  THEN
    RAISE EXCEPTION 'وحدة الشراء غير موجودة.';
  END IF;

  IF p_warehouse_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.warehouses
      WHERE id = p_warehouse_id AND is_active = true
    )
  THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
  END IF;

  INSERT INTO public.products (
    sku,
    barcode,
    name_ar,
    description,
    category_id,
    brand_id,
    unit_id,
    purchase_unit_id,
    units_per_purchase_unit,
    default_purchase_price_in_minor_units,
    cost_price_in_minor_units,
    sale_price_in_minor_units,
    min_stock_level,
    max_stock_level
  ) VALUES (
    TRIM(p_sku),
    NULLIF(TRIM(p_barcode), ''),
    TRIM(p_name_ar),
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    COALESCE(p_purchase_unit_id, p_unit_id),
    p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units,
    p_cost_price_in_minor_units,
    p_sale_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level
  )
  RETURNING id INTO v_product_id;

  IF p_warehouse_id IS NOT NULL THEN
    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_warehouse_id,
      v_product_id,
      p_opening_quantity,
      0
    );

    IF p_opening_quantity > 0 THEN
      INSERT INTO public.inventory_movements (
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        balance_before,
        balance_after,
        notes,
        created_by
      ) VALUES (
        p_warehouse_id,
        v_product_id,
        'opening_balance',
        p_opening_quantity,
        0,
        p_opening_quantity,
        COALESCE(p_notes, 'رصيد افتتاحي عند إضافة المنتج'),
        v_user_id
      );
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
    'CREATE_PRODUCT_WITH_PACKAGING',
    'products',
    v_product_id,
    jsonb_build_object(
      'sku', p_sku,
      'warehouse_id', p_warehouse_id,
      'opening_quantity', p_opening_quantity,
      'purchase_unit_id', p_purchase_unit_id,
      'units_per_purchase_unit', p_units_per_purchase_unit
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'sku', p_sku,
    'opening_quantity', p_opening_quantity
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 6. Hardened direct supplier receipt RPC
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
  v_user_id UUID := auth.uid();
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_purchase_unit_id UUID;
  v_base_unit_id UUID;
  v_purchase_unit_name TEXT;
  v_base_unit_name TEXT;
  v_pkg_qty INTEGER;
  v_units_per_pkg INTEGER;
  v_total_base_units INTEGER;
  v_pkg_price BIGINT;
  v_selling_price BIGINT;
  v_current_sale_price BIGINT;
  v_base_unit_cost BIGINT;
  v_item_discount BIGINT;
  v_line_total BIGINT;
  v_update_product_defaults BOOLEAN;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_amount_due BIGINT;
  v_payment_status TEXT;
  v_item_count INTEGER := 0;
  v_total_inventory_added INTEGER := 0;
  v_old_on_hand INTEGER;
  v_new_on_hand INTEGER;
  v_total_existing_stock INTEGER;
  v_current_cost BIGINT;
  v_new_wac_cost BIGINT;
  v_existing_receipt JSONB;
  v_batch_number TEXT;
  v_production_date DATE;
  v_expiry_date DATE;
  v_item_notes TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتنفيذ عملية الاستلام.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object(
      'success', true,
      'receipt_id', sr.id,
      'receipt_number', sr.receipt_number,
      'total', sr.total_in_minor_units,
      'paid', sr.amount_paid_in_minor_units,
      'due', sr.amount_due_in_minor_units,
      'products_count', (
        SELECT COUNT(*) FROM public.supplier_receipt_items sri
        WHERE sri.supplier_receipt_id = sr.id
      ),
      'total_inventory_units_added', (
        SELECT COALESCE(SUM(sri.total_base_units), 0)
        FROM public.supplier_receipt_items sri
        WHERE sri.supplier_receipt_id = sr.id
      ),
      'is_duplicate', true
    )
    INTO v_existing_receipt
    FROM public.supplier_receipts sr
    WHERE sr.idempotency_key = p_idempotency_key;

    IF v_existing_receipt IS NOT NULL THEN
      RETURN v_existing_receipt;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE id = p_supplier_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود أو غير نشط.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
    WHERE id = p_warehouse_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
  END IF;

  IF p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.warehouses
    WHERE id = p_warehouse_id
      AND branch_id IS NOT NULL
      AND branch_id <> p_branch_id
  ) THEN
    RAISE EXCEPTION 'المستودع المحدد لا يتبع الفرع المختار.';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'يجب إضافة منتج واحد على الأقل للاستلام.';
  END IF;

  IF p_delivery_fee_in_minor_units < 0
    OR p_discount_in_minor_units < 0
    OR p_tax_in_minor_units < 0
    OR p_amount_paid_in_minor_units < 0
  THEN
    RAISE EXCEPTION 'قيم الخصم والضريبة والتوصيل والدفعة لا يمكن أن تكون سالبة.';
  END IF;

  IF COALESCE(p_payment_method, 'cash') NOT IN (
    'cash', 'bank', 'cliq', 'transfer', 'deferred'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة.';
  END IF;

  IF p_payment_method = 'deferred' AND p_amount_paid_in_minor_units > 0 THEN
    RAISE EXCEPTION 'الاستلام الآجل لا يقبل دفعة فورية.';
  END IF;

  IF NULLIF(TRIM(p_supplier_invoice_number), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.supplier_receipts
      WHERE supplier_id = p_supplier_id
        AND LOWER(supplier_invoice_number) =
          LOWER(TRIM(p_supplier_invoice_number))
        AND status <> 'cancelled'
    )
  THEN
    RAISE EXCEPTION 'رقم فاتورة المورد مسجل مسبقاً لهذا المورد.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_pkg_qty := COALESCE((v_item->>'package_quantity')::INTEGER, 0);
    v_units_per_pkg :=
      COALESCE((v_item->>'units_per_package')::INTEGER, 0);
    v_pkg_price :=
      COALESCE((v_item->>'package_price_in_minor_units')::BIGINT, 0);
    v_item_discount :=
      COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);
    v_selling_price :=
      COALESCE((v_item->>'selling_price_in_minor_units')::BIGINT, 0);

    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = v_product_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'أحد المنتجات غير موجود أو غير نشط.';
    END IF;
    IF v_pkg_qty <= 0 OR v_units_per_pkg <= 0 THEN
      RAISE EXCEPTION 'عدد الطرود ومحتوى الطرد يجب أن يكونا أكبر من صفر.';
    END IF;
    IF v_pkg_price < 0 OR v_item_discount < 0 OR v_selling_price < 0 THEN
      RAISE EXCEPTION 'أسعار الصنف وخصمه لا يمكن أن تكون سالبة.';
    END IF;
    IF v_item_discount > (v_pkg_qty * v_pkg_price) THEN
      RAISE EXCEPTION 'خصم الصنف يتجاوز إجمالي الصنف.';
    END IF;

    v_line_total := (v_pkg_qty * v_pkg_price) - v_item_discount;
    v_subtotal := v_subtotal + v_line_total;
    v_item_count := v_item_count + 1;
    v_total_inventory_added :=
      v_total_inventory_added + (v_pkg_qty * v_units_per_pkg);
  END LOOP;

  IF p_discount_in_minor_units > v_subtotal THEN
    RAISE EXCEPTION 'خصم السند يتجاوز مجموع الأصناف.';
  END IF;

  v_total :=
    v_subtotal
    - p_discount_in_minor_units
    + p_delivery_fee_in_minor_units
    + p_tax_in_minor_units;

  IF p_amount_paid_in_minor_units > v_total THEN
    RAISE EXCEPTION 'المبلغ المدفوع يتجاوز إجمالي السند.';
  END IF;

  v_amount_due := v_total - p_amount_paid_in_minor_units;
  v_payment_status := CASE
    WHEN v_amount_due = 0 THEN 'paid'
    WHEN p_amount_paid_in_minor_units > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END;

  v_receipt_number :=
    'GRN-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
    LPAD(NEXTVAL('public.supplier_receipt_seq')::TEXT, 6, '0');

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
    p_discount_in_minor_units,
    p_delivery_fee_in_minor_units,
    p_tax_in_minor_units,
    v_total,
    p_amount_paid_in_minor_units,
    v_amount_due,
    v_payment_status,
    COALESCE(p_payment_method, 'cash'),
    NULLIF(TRIM(p_payment_reference), ''),
    p_notes,
    p_internal_notes,
    'completed',
    p_idempotency_key
  )
  RETURNING id INTO v_receipt_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_pkg_qty := (v_item->>'package_quantity')::INTEGER;
    v_units_per_pkg := (v_item->>'units_per_package')::INTEGER;
    v_total_base_units := v_pkg_qty * v_units_per_pkg;
    v_pkg_price :=
      (v_item->>'package_price_in_minor_units')::BIGINT;
    v_item_discount :=
      COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);
    v_line_total := (v_pkg_qty * v_pkg_price) - v_item_discount;
    v_update_product_defaults :=
      COALESCE((v_item->>'update_product_defaults')::BOOLEAN, false);

    SELECT
      p.unit_id,
      p.purchase_unit_id,
      p.cost_price_in_minor_units,
      p.sale_price_in_minor_units
    INTO
      v_base_unit_id,
      v_purchase_unit_id,
      v_current_cost,
      v_current_sale_price
    FROM public.products p
    WHERE p.id = v_product_id
    FOR UPDATE;

    v_purchase_unit_id := COALESCE(
      NULLIF(v_item->>'purchase_unit_id', '')::UUID,
      v_purchase_unit_id,
      v_base_unit_id
    );

    IF v_purchase_unit_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.units WHERE id = v_purchase_unit_id
      )
    THEN
      RAISE EXCEPTION 'وحدة الشراء المحددة غير موجودة.';
    END IF;

    SELECT name_ar
    INTO v_purchase_unit_name
    FROM public.units
    WHERE id = v_purchase_unit_id;

    SELECT name_ar
    INTO v_base_unit_name
    FROM public.units
    WHERE id = v_base_unit_id;

    v_purchase_unit_name := COALESCE(
      v_purchase_unit_name,
      NULLIF(v_item->>'purchase_unit_name', ''),
      'طرد'
    );
    v_base_unit_name := COALESCE(
      v_base_unit_name,
      NULLIF(v_item->>'base_unit_name', ''),
      'حبة'
    );

    IF v_item ? 'selling_price_in_minor_units' THEN
      v_selling_price :=
        COALESCE((v_item->>'selling_price_in_minor_units')::BIGINT, 0);
    ELSE
      v_selling_price := v_current_sale_price;
    END IF;

    v_base_unit_cost := ROUND(
      v_line_total::NUMERIC / v_total_base_units
    )::BIGINT;

    v_batch_number := NULLIF(TRIM(v_item->>'batch_number'), '');
    v_production_date := NULLIF(v_item->>'production_date', '')::DATE;
    v_expiry_date := NULLIF(v_item->>'expiry_date', '')::DATE;
    v_item_notes := NULLIF(v_item->>'notes', '');

    IF v_production_date IS NOT NULL
      AND v_expiry_date IS NOT NULL
      AND v_expiry_date < v_production_date
    THEN
      RAISE EXCEPTION 'تاريخ الانتهاء لا يمكن أن يسبق تاريخ الإنتاج.';
    END IF;

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
      selling_price_in_minor_units,
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
      v_selling_price,
      v_item_discount,
      v_line_total,
      v_batch_number,
      v_production_date,
      v_expiry_date,
      v_item_notes
    );

    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_warehouse_id,
      v_product_id,
      0,
      0
    )
    ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    SELECT on_hand_quantity
    INTO v_old_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product_id
    FOR UPDATE;

    SELECT COALESCE(SUM(on_hand_quantity), 0)
    INTO v_total_existing_stock
    FROM public.inventory_balances
    WHERE product_id = v_product_id;

    v_new_wac_cost := CASE
      WHEN v_total_existing_stock <= 0 OR v_current_cost <= 0
        THEN v_base_unit_cost
      ELSE ROUND(
        (
          (v_total_existing_stock::NUMERIC * v_current_cost::NUMERIC)
          + (v_total_base_units::NUMERIC * v_base_unit_cost::NUMERIC)
        ) / (v_total_existing_stock + v_total_base_units)
      )::BIGINT
    END;

    UPDATE public.products
    SET
      cost_price_in_minor_units = v_new_wac_cost,
      purchase_unit_id = CASE
        WHEN v_update_product_defaults THEN v_purchase_unit_id
        ELSE purchase_unit_id
      END,
      units_per_purchase_unit = CASE
        WHEN v_update_product_defaults THEN v_units_per_pkg
        ELSE units_per_purchase_unit
      END,
      default_purchase_price_in_minor_units = CASE
        WHEN v_update_product_defaults THEN v_pkg_price
        ELSE default_purchase_price_in_minor_units
      END,
      sale_price_in_minor_units = CASE
        WHEN v_update_product_defaults THEN v_selling_price
        ELSE sale_price_in_minor_units
      END,
      updated_at = NOW()
    WHERE id = v_product_id;

    v_new_on_hand := v_old_on_hand + v_total_base_units;

    UPDATE public.inventory_balances
    SET
      on_hand_quantity = v_new_on_hand,
      updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product_id;

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
      'استلام مباشر من المورد - سند ' || v_receipt_number,
      v_user_id
    );
  END LOOP;

  UPDATE public.suppliers
  SET
    current_balance_in_minor_units =
      current_balance_in_minor_units + v_amount_due,
    updated_at = NOW()
  WHERE id = p_supplier_id;

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
      'دفعة عند الاستلام - سند ' || v_receipt_number,
      v_user_id
    );
  END IF;

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
      'warehouse_id', p_warehouse_id,
      'total', v_total,
      'paid', p_amount_paid_in_minor_units,
      'due', v_amount_due,
      'products_count', v_item_count,
      'total_units_added', v_total_inventory_added
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'total', v_total,
    'paid', p_amount_paid_in_minor_units,
    'due', v_amount_due,
    'products_count', v_item_count,
    'total_inventory_units_added', v_total_inventory_added
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 7. Supplier receipt payment updates both receipt and supplier balance
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
  v_user_id UUID := auth.uid();
  v_supplier_id UUID;
  v_receipt_number TEXT;
  v_status TEXT;
  v_total BIGINT;
  v_old_paid BIGINT;
  v_old_due BIGINT;
  v_new_paid BIGINT;
  v_new_due BIGINT;
  v_new_payment_status TEXT;
  v_payment_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتسجيل دفعة مورد.';
  END IF;
  IF p_amount_in_minor_units IS NULL OR p_amount_in_minor_units <= 0 THEN
    RAISE EXCEPTION 'مبلغ الدفعة يجب أن يكون أكبر من صفر.';
  END IF;
  IF COALESCE(p_payment_method, 'cash') NOT IN (
    'cash', 'bank', 'cliq', 'transfer'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير مدعومة.';
  END IF;

  SELECT
    supplier_id,
    receipt_number,
    status,
    total_in_minor_units,
    amount_paid_in_minor_units,
    amount_due_in_minor_units
  INTO
    v_supplier_id,
    v_receipt_number,
    v_status,
    v_total,
    v_old_paid,
    v_old_due
  FROM public.supplier_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة على سند غير مكتمل.';
  END IF;
  IF p_amount_in_minor_units > v_old_due THEN
    RAISE EXCEPTION 'مبلغ الدفعة يتجاوز المبلغ المتبقي.';
  END IF;

  v_new_paid := v_old_paid + p_amount_in_minor_units;
  v_new_due := v_total - v_new_paid;
  v_new_payment_status := CASE
    WHEN v_new_due = 0 THEN 'paid'
    ELSE 'partially_paid'
  END;

  UPDATE public.supplier_receipts
  SET
    amount_paid_in_minor_units = v_new_paid,
    amount_due_in_minor_units = v_new_due,
    payment_status = v_new_payment_status,
    updated_at = NOW()
  WHERE id = p_receipt_id;

  UPDATE public.suppliers
  SET
    current_balance_in_minor_units =
      GREATEST(0, current_balance_in_minor_units - p_amount_in_minor_units),
    updated_at = NOW()
  WHERE id = v_supplier_id;

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
    COALESCE(p_notes, 'دفعة على سند ' || v_receipt_number),
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
    'RECORD_SUPPLIER_RECEIPT_PAYMENT',
    'supplier_receipts',
    p_receipt_id,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'amount', p_amount_in_minor_units,
      'remaining_due', v_new_due
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'total_paid', v_new_paid,
    'amount_due', v_new_due,
    'payment_status', v_new_payment_status
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 8. Safe supplier receipt reversal for the current inventory schema
-- -------------------------------------------------------------------------
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
  v_user_id UUID := auth.uid();
  v_receipt RECORD;
  v_item RECORD;
  v_old_on_hand INTEGER;
  v_new_on_hand INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لإلغاء سند استلام.';
  END IF;

  SELECT *
  INTO v_receipt
  FROM public.supplier_receipts
  WHERE id = p_supplier_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;
  IF v_receipt.status <> 'completed' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء سند غير مكتمل.';
  END IF;
  IF v_receipt.amount_paid_in_minor_units > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء سند عليه دفعات. استخدم مرتجع المورد وتسوية الدفعة.';
  END IF;

  FOR v_item IN
    SELECT sri.*, p.name_ar AS product_name
    FROM public.supplier_receipt_items sri
    JOIN public.products p ON p.id = sri.product_id
    WHERE sri.supplier_receipt_id = p_supplier_receipt_id
  LOOP
    SELECT on_hand_quantity
    INTO v_old_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id
    FOR UPDATE;

    IF v_old_on_hand IS NULL
      OR v_old_on_hand < v_item.total_base_units
    THEN
      RAISE EXCEPTION
        'لا يمكن إلغاء السند لأن مخزون المنتج % أقل من الكمية المستلمة.',
        v_item.product_name;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT *
    FROM public.supplier_receipt_items
    WHERE supplier_receipt_id = p_supplier_receipt_id
  LOOP
    SELECT on_hand_quantity
    INTO v_old_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id
    FOR UPDATE;

    v_new_on_hand := v_old_on_hand - v_item.total_base_units;

    UPDATE public.inventory_balances
    SET
      on_hand_quantity = v_new_on_hand,
      updated_at = NOW()
    WHERE warehouse_id = v_receipt.warehouse_id
      AND product_id = v_item.product_id;

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
      v_receipt.warehouse_id,
      v_item.product_id,
      'return_out',
      -v_item.total_base_units,
      v_old_on_hand,
      v_new_on_hand,
      'supplier_receipt_cancellation',
      p_supplier_receipt_id,
      'إلغاء سند استلام ' || v_receipt.receipt_number,
      v_user_id
    );
  END LOOP;

  UPDATE public.suppliers
  SET
    current_balance_in_minor_units = GREATEST(
      0,
      current_balance_in_minor_units - v_receipt.amount_due_in_minor_units
    ),
    updated_at = NOW()
  WHERE id = v_receipt.supplier_id;

  UPDATE public.supplier_receipts
  SET
    status = 'cancelled',
    is_archived = true,
    amount_due_in_minor_units = 0,
    notes = CONCAT_WS(
      E'\n',
      NULLIF(notes, ''),
      '[إلغاء ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI') || '] ' ||
        COALESCE(NULLIF(TRIM(p_reason), ''), 'بدون سبب')
    ),
    updated_at = NOW()
  WHERE id = p_supplier_receipt_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
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
    'receipt_id', p_supplier_receipt_id,
    'receipt_number', v_receipt.receipt_number
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 9. Archive action is audited
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
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لأرشفة سند الاستلام.';
  END IF;

  UPDATE public.supplier_receipts
  SET
    is_archived = p_is_archived,
    updated_at = NOW()
  WHERE id = p_receipt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الاستلام غير موجود.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    CASE WHEN p_is_archived
      THEN 'ARCHIVE_SUPPLIER_RECEIPT'
      ELSE 'RESTORE_SUPPLIER_RECEIPT'
    END,
    'supplier_receipts',
    p_receipt_id,
    jsonb_build_object('is_archived', p_is_archived)
  );

  RETURN jsonb_build_object(
    'success', true,
    'is_archived', p_is_archived
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 10. RLS hardening: business documents are read-only to the client.
-- All mutations go through SECURITY DEFINER RPCs.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated staff to manage purchase orders"
  ON public.purchase_orders;
DROP POLICY IF EXISTS "Allow authenticated staff to manage purchase order items"
  ON public.purchase_order_items;
DROP POLICY IF EXISTS "Allow authenticated staff to manage purchase receipts"
  ON public.purchase_receipts;
DROP POLICY IF EXISTS "Allow authenticated staff to manage purchase receipt items"
  ON public.purchase_receipt_items;
DROP POLICY IF EXISTS "Allow authenticated staff to manage supplier payments"
  ON public.supplier_payments;

DROP POLICY IF EXISTS "Allow authenticated staff to manage orders"
  ON public.orders;
DROP POLICY IF EXISTS "Allow authenticated staff to manage order items"
  ON public.order_items;
DROP POLICY IF EXISTS "Allow authenticated staff to manage order status history"
  ON public.order_status_history;

-- -------------------------------------------------------------------------
-- 11. Function execution permissions
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_product_with_opening_stock(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_opening_stock(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT,
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_supplier_receipt(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT,
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) TO authenticated;

REVOKE ALL ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_receipt_payment(
  UUID, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_supplier_receipt(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_supplier_receipt(UUID, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_order(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_order(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.complete_order(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_order(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_order(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT)
  TO authenticated;
