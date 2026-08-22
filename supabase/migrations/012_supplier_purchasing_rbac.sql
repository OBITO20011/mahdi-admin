-- =========================================================================
-- Nawasrah ERP - Migration 012
-- Application-role enforcement and RPC-only supplier / purchasing writes.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Central application-role guard
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_erp_role(
  p_allowed_roles TEXT[],
  p_operation TEXT DEFAULT 'تنفيذ العملية'
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول من حساب موظف معتمد.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE p.id = v_user_id
      AND p.is_active = true
      AND r.code = ANY(p_allowed_roles)
  ) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية %.', COALESCE(p_operation, 'تنفيذ العملية');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_erp_role(TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. Preserve existing business logic as private implementations
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure(
    'public._create_product_with_opening_stock_impl(text,text,text,text,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,integer,integer,uuid,integer,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_product_with_opening_stock(
      TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
      BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
    ) RENAME TO _create_product_with_opening_stock_impl;
  END IF;

  IF to_regprocedure(
    'public._create_direct_supplier_receipt_impl(uuid,uuid,uuid,text,date,timestamp with time zone,bigint,bigint,bigint,bigint,text,text,text,text,uuid,jsonb)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_direct_supplier_receipt(
      UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT,
      BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
    ) RENAME TO _create_direct_supplier_receipt_impl;
  END IF;

  IF to_regprocedure(
    'public._record_supplier_receipt_payment_impl(uuid,bigint,text,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.record_supplier_receipt_payment(
      UUID, BIGINT, TEXT, TEXT, TEXT
    ) RENAME TO _record_supplier_receipt_payment_impl;
  END IF;

  IF to_regprocedure(
    'public._archive_supplier_receipt_impl(uuid,boolean)'
  ) IS NULL THEN
    ALTER FUNCTION public.archive_supplier_receipt(UUID, BOOLEAN)
      RENAME TO _archive_supplier_receipt_impl;
  END IF;

  IF to_regprocedure(
    'public._cancel_supplier_receipt_impl(uuid,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.cancel_supplier_receipt(UUID, TEXT)
      RENAME TO _cancel_supplier_receipt_impl;
  END IF;

  IF to_regprocedure('public._confirm_order_impl(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.confirm_order(UUID, TEXT)
      RENAME TO _confirm_order_impl;
  END IF;

  IF to_regprocedure('public._complete_order_impl(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.complete_order(UUID, TEXT)
      RENAME TO _complete_order_impl;
  END IF;

  IF to_regprocedure('public._cancel_order_impl(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.cancel_order(UUID, TEXT)
      RENAME TO _cancel_order_impl;
  END IF;

  IF to_regprocedure(
    'public._update_order_status_impl(uuid,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.update_order_status(UUID, TEXT, TEXT)
      RENAME TO _update_order_status_impl;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._create_product_with_opening_stock_impl(
  TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER, BIGINT,
  BIGINT, BIGINT, INTEGER, INTEGER, UUID, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._create_direct_supplier_receipt_impl(
  UUID, UUID, UUID, TEXT, DATE, TIMESTAMPTZ, BIGINT, BIGINT,
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._record_supplier_receipt_payment_impl(
  UUID, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._archive_supplier_receipt_impl(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cancel_supplier_receipt_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._confirm_order_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._complete_order_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cancel_order_impl(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._update_order_status_impl(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. Role-protected public wrappers
-- -------------------------------------------------------------------------
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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إضافة المنتجات والأرصدة الافتتاحية'
  );

  RETURN public._create_product_with_opening_stock_impl(
    p_sku,
    p_barcode,
    p_name_ar,
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    p_purchase_unit_id,
    p_units_per_purchase_unit,
    p_default_purchase_price_in_minor_units,
    p_cost_price_in_minor_units,
    p_sale_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level,
    p_warehouse_id,
    p_opening_quantity,
    p_notes
  );
END;
$$;

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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'استلام بضاعة الموردين'
  );

  RETURN public._create_direct_supplier_receipt_impl(
    p_supplier_id,
    p_warehouse_id,
    p_branch_id,
    p_supplier_invoice_number,
    p_supplier_invoice_date,
    p_received_at,
    p_delivery_fee_in_minor_units,
    p_discount_in_minor_units,
    p_tax_in_minor_units,
    p_amount_paid_in_minor_units,
    p_payment_method,
    p_payment_reference,
    p_notes,
    p_internal_notes,
    p_idempotency_key,
    p_items
  );
END;
$$;

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
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'تسجيل دفعات الموردين'
  );

  RETURN public._record_supplier_receipt_payment_impl(
    p_receipt_id,
    p_amount_in_minor_units,
    p_payment_method,
    p_reference_number,
    p_notes
  );
END;
$$;

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
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'أرشفة سندات الاستلام'
  );

  RETURN public._archive_supplier_receipt_impl(
    p_receipt_id,
    p_is_archived
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_supplier_receipt(
  p_supplier_receipt_id UUID,
  p_reason TEXT DEFAULT 'إلغاء سند استلام البضائع'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إلغاء سندات الاستلام'
  );

  RETURN public._cancel_supplier_receipt_impl(
    p_supplier_receipt_id,
    p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales', 'warehouse_keeper'],
    'تأكيد الطلبات'
  );
  RETURN public._confirm_order_impl(p_order_id, p_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'إكمال الطلبات وخصم المخزون'
  );
  RETURN public._complete_order_impl(p_order_id, p_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(
  p_order_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إلغاء الطلبات'
  );
  RETURN public._cancel_order_impl(p_order_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'تحديث حالة الطلب'
  );
  RETURN public._update_order_status_impl(
    p_order_id,
    p_new_status,
    p_notes
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 4. Supplier master-data RPCs
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_supplier(
  p_company_name TEXT,
  p_supplier_id UUID DEFAULT NULL,
  p_contact_person TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_whatsapp TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_tax_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_supplier public.suppliers%ROWTYPE;
  v_action TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'إدارة الموردين'
  );

  IF NULLIF(TRIM(p_company_name), '') IS NULL THEN
    RAISE EXCEPTION 'اسم الشركة أو المورد مطلوب.';
  END IF;

  IF p_supplier_id IS NULL THEN
    INSERT INTO public.suppliers (
      company_name,
      contact_person,
      phone,
      whatsapp,
      email,
      address,
      tax_number,
      notes,
      is_active
    ) VALUES (
      TRIM(p_company_name),
      NULLIF(TRIM(p_contact_person), ''),
      NULLIF(TRIM(p_phone), ''),
      NULLIF(TRIM(p_whatsapp), ''),
      NULLIF(TRIM(p_email), ''),
      NULLIF(TRIM(p_address), ''),
      NULLIF(TRIM(p_tax_number), ''),
      NULLIF(TRIM(p_notes), ''),
      COALESCE(p_is_active, true)
    )
    RETURNING * INTO v_supplier;
    v_action := 'CREATE_SUPPLIER';
  ELSE
    PERFORM 1
    FROM public.suppliers
    WHERE id = p_supplier_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المورد المحدد غير موجود.';
    END IF;

    UPDATE public.suppliers
    SET
      company_name = TRIM(p_company_name),
      contact_person = NULLIF(TRIM(p_contact_person), ''),
      phone = NULLIF(TRIM(p_phone), ''),
      whatsapp = NULLIF(TRIM(p_whatsapp), ''),
      email = NULLIF(TRIM(p_email), ''),
      address = NULLIF(TRIM(p_address), ''),
      tax_number = NULLIF(TRIM(p_tax_number), ''),
      notes = NULLIF(TRIM(p_notes), ''),
      is_active = COALESCE(p_is_active, true),
      updated_at = NOW()
    WHERE id = p_supplier_id
    RETURNING * INTO v_supplier;
    v_action := 'UPDATE_SUPPLIER';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    v_action,
    'suppliers',
    v_supplier.id,
    jsonb_build_object(
      'company_name', v_supplier.company_name,
      'is_active', v_supplier.is_active
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'supplier', to_jsonb(v_supplier)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_supplier_active(
  p_supplier_id UUID,
  p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_company_name TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تغيير حالة المورد'
  );

  UPDATE public.suppliers
  SET
    is_active = p_is_active,
    updated_at = NOW()
  WHERE id = p_supplier_id
  RETURNING company_name INTO v_company_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود.';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    CASE WHEN p_is_active
      THEN 'ACTIVATE_SUPPLIER'
      ELSE 'DEACTIVATE_SUPPLIER'
    END,
    'suppliers',
    p_supplier_id,
    jsonb_build_object(
      'company_name', v_company_name,
      'is_active', p_is_active
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'supplier_id', p_supplier_id,
    'is_active', p_is_active
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 5. Atomic draft purchase-order editing and deletion
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_order(
  p_purchase_order_id UUID,
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
  v_user_id UUID := auth.uid();
  v_purchase_order_number TEXT;
  v_status TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_ordered_quantity INTEGER;
  v_purchase_price BIGINT;
  v_item_discount BIGINT;
  v_line_total BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_items_count INTEGER := 0;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل أوامر الشراء'
  );

  SELECT purchase_order_number, status
  INTO v_purchase_order_number, v_status
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء المحدد غير موجود.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'يمكن تعديل أمر الشراء عندما تكون حالته مسودة فقط.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
    WHERE id = p_supplier_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'المورد المحدد غير موجود أو غير نشط.';
  END IF;
  IF p_branch_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.branches
      WHERE id = p_branch_id AND is_active = true
    )
  THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير نشط.';
  END IF;
  IF p_warehouse_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.warehouses
      WHERE id = p_warehouse_id AND is_active = true
    )
  THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
  END IF;
  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'يجب إضافة منتج واحد على الأقل لأمر الشراء.';
  END IF;
  IF p_delivery_fee_in_minor_units < 0
    OR p_discount_in_minor_units < 0
  THEN
    RAISE EXCEPTION 'الخصم ورسوم التوصيل لا يمكن أن تكون سالبة.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_ordered_quantity :=
      COALESCE((v_item->>'ordered_quantity')::INTEGER, 0);
    v_purchase_price :=
      COALESCE((v_item->>'purchase_price_in_minor_units')::BIGINT, 0);
    v_item_discount :=
      COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);

    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = v_product_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'أحد المنتجات غير موجود أو غير نشط.';
    END IF;
    IF v_ordered_quantity <= 0 THEN
      RAISE EXCEPTION 'كمية أمر الشراء يجب أن تكون عددًا صحيحًا أكبر من صفر.';
    END IF;
    IF v_purchase_price < 0 OR v_item_discount < 0 THEN
      RAISE EXCEPTION 'سعر الشراء والخصم لا يمكن أن يكونا سالبين.';
    END IF;
    IF v_item_discount > (v_ordered_quantity * v_purchase_price) THEN
      RAISE EXCEPTION 'خصم الصنف يتجاوز إجمالي الصنف.';
    END IF;

    v_line_total :=
      (v_ordered_quantity * v_purchase_price) - v_item_discount;
    v_subtotal := v_subtotal + v_line_total;
    v_items_count := v_items_count + 1;
  END LOOP;

  IF p_discount_in_minor_units > v_subtotal THEN
    RAISE EXCEPTION 'خصم أمر الشراء يتجاوز مجموع الأصناف.';
  END IF;

  v_total :=
    v_subtotal
    - p_discount_in_minor_units
    + p_delivery_fee_in_minor_units;

  UPDATE public.purchase_orders
  SET
    supplier_id = p_supplier_id,
    branch_id = p_branch_id,
    warehouse_id = p_warehouse_id,
    expected_delivery_date = p_expected_delivery_date,
    delivery_fee_in_minor_units = p_delivery_fee_in_minor_units,
    discount_in_minor_units = p_discount_in_minor_units,
    subtotal_in_minor_units = v_subtotal,
    total_in_minor_units = v_total,
    supplier_invoice_number =
      NULLIF(TRIM(p_supplier_invoice_number), ''),
    notes = NULLIF(TRIM(p_notes), ''),
    internal_notes = NULLIF(TRIM(p_internal_notes), ''),
    updated_at = NOW()
  WHERE id = p_purchase_order_id;

  DELETE FROM public.purchase_order_items
  WHERE purchase_order_id = p_purchase_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_ordered_quantity := (v_item->>'ordered_quantity')::INTEGER;
    v_purchase_price :=
      (v_item->>'purchase_price_in_minor_units')::BIGINT;
    v_item_discount :=
      COALESCE((v_item->>'discount_in_minor_units')::BIGINT, 0);
    v_line_total :=
      (v_ordered_quantity * v_purchase_price) - v_item_discount;

    INSERT INTO public.purchase_order_items (
      purchase_order_id,
      product_id,
      ordered_quantity,
      received_quantity,
      purchase_price_in_minor_units,
      discount_in_minor_units,
      line_total_in_minor_units
    ) VALUES (
      p_purchase_order_id,
      v_product_id,
      v_ordered_quantity,
      0,
      v_purchase_price,
      v_item_discount,
      v_line_total
    );
  END LOOP;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'UPDATE_PURCHASE_ORDER',
    'purchase_orders',
    p_purchase_order_id,
    jsonb_build_object(
      'purchase_order_number', v_purchase_order_number,
      'supplier_id', p_supplier_id,
      'items_count', v_items_count,
      'total', v_total
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'purchase_order_number', v_purchase_order_number,
    'total', v_total,
    'items_count', v_items_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_draft_purchase_order(
  p_purchase_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_purchase_order_number TEXT;
  v_status TEXT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager'],
    'حذف أوامر الشراء'
  );

  SELECT purchase_order_number, status
  INTO v_purchase_order_number, v_status
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الشراء المحدد غير موجود.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'يمكن حذف أمر الشراء عندما تكون حالته مسودة فقط.';
  END IF;

  DELETE FROM public.purchase_orders
  WHERE id = p_purchase_order_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'DELETE_DRAFT_PURCHASE_ORDER',
    'purchase_orders',
    p_purchase_order_id,
    jsonb_build_object(
      'purchase_order_number', v_purchase_order_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'purchase_order_number', v_purchase_order_number
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 6. RPC-only write policies and execution grants
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated staff to manage suppliers"
  ON public.suppliers;

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

REVOKE ALL ON FUNCTION public.save_supplier(
  TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_supplier(
  TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;

REVOKE ALL ON FUNCTION public.set_supplier_active(UUID, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_active(UUID, BOOLEAN)
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_purchase_order(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT,
  TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_order(
  UUID, UUID, UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT,
  TEXT, TEXT, TEXT, JSONB
) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_draft_purchase_order(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_draft_purchase_order(UUID)
  TO authenticated;
