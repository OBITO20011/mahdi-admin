-- =========================================================================
-- Nawasrah ERP - Owner-only cleanup for an explicitly tagged E2E cycle.
--
-- This maintenance RPC is intentionally strict. It only accepts the generated
-- E2E tag format, requires an MFA-satisfied owner session, verifies the whole
-- linked graph, and aborts before deleting anything if a non-test dependency
-- is found. Migration 053 removes the RPC after the verified cleanup run.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_tagged_e2e_test_cycle(
  p_test_tag TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tag TEXT := UPPER(TRIM(COALESCE(p_test_tag, '')));
  v_product_ids UUID[];
  v_supplier_ids UUID[];
  v_receipt_ids UUID[];
  v_customer_ids UUID[];
  v_order_ids UUID[];
  v_expense_ids UUID[];
  v_shift_ids UUID[];
  v_sales_return_ids UUID[];
  v_entity_ids UUID[];
  v_count INTEGER;
  v_has_dependency BOOLEAN := false;
  v_deleted_movements INTEGER := 0;
  v_deleted_audits INTEGER := 0;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner'],
    'تنظيف دورة اختبار شاملة'
  );

  IF v_tag !~ '^E2E-NAW-[0-9]{8}-[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'وسم الاختبار غير صالح.';
  END IF;

  SELECT COALESCE(ARRAY_AGG(p.id ORDER BY p.id), ARRAY[]::UUID[])
    INTO v_product_ids
  FROM public.products p
  WHERE p.sku = v_tag || '-WATER'
    AND (
      p.name_ar ILIKE '%' || v_tag || '%'
      OR COALESCE(p.description, '') ILIKE '%' || v_tag || '%'
    )
  ;

  IF CARDINALITY(v_product_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام صنف اختبار واحدًا، الموجود: %.', CARDINALITY(v_product_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(s.id ORDER BY s.id), ARRAY[]::UUID[])
    INTO v_supplier_ids
  FROM public.suppliers s
  WHERE s.company_name ILIKE '%' || v_tag || '%'
    AND COALESCE(s.notes, '') ILIKE '%' || v_tag || '%'
  ;

  IF CARDINALITY(v_supplier_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام مورد اختبار واحدًا، الموجود: %.', CARDINALITY(v_supplier_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(sr.id ORDER BY sr.id), ARRAY[]::UUID[])
    INTO v_receipt_ids
  FROM public.supplier_receipts sr
  WHERE sr.supplier_id = ANY(v_supplier_ids)
    AND (
      COALESCE(sr.supplier_invoice_number, '') ILIKE '%' || v_tag || '%'
      OR COALESCE(sr.notes, '') ILIKE '%' || v_tag || '%'
      OR COALESCE(sr.internal_notes, '') ILIKE '%' || v_tag || '%'
    )
  ;

  IF CARDINALITY(v_receipt_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام سند استلام اختبار واحدًا، الموجود: %.', CARDINALITY(v_receipt_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(c.id ORDER BY c.id), ARRAY[]::UUID[])
    INTO v_customer_ids
  FROM public.customers c
  WHERE c.full_name ILIKE '%' || v_tag || '%'
    AND c.phone = '0790000013'
  ;

  IF CARDINALITY(v_customer_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام عميل اختبار واحدًا، الموجود: %.', CARDINALITY(v_customer_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(o.id ORDER BY o.id), ARRAY[]::UUID[])
    INTO v_order_ids
  FROM public.orders o
  WHERE o.customer_id = ANY(v_customer_ids)
    AND (
      COALESCE(o.customer_notes, '') ILIKE '%' || v_tag || '%'
      OR COALESCE(o.internal_notes, '') ILIKE '%' || v_tag || '%'
      OR COALESCE(o.whatsapp_message, '') ILIKE '%' || v_tag || '%'
    )
  ;

  IF CARDINALITY(v_order_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام طلب اختبار واحدًا، الموجود: %.', CARDINALITY(v_order_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(e.id ORDER BY e.id), ARRAY[]::UUID[])
    INTO v_expense_ids
  FROM public.operational_expenses e
  WHERE e.description ILIKE '%' || v_tag || '%'
  ;

  IF CARDINALITY(v_expense_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام مصروف اختبار واحدًا، الموجود: %.', CARDINALITY(v_expense_ids);
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT linked.shift_id), ARRAY[]::UUID[])
    INTO v_shift_ids
  FROM (
    SELECT e.shift_id
    FROM public.operational_expenses e
    WHERE e.id = ANY(v_expense_ids)
    UNION ALL
    SELECT o.cash_shift_id
    FROM public.orders o
    WHERE o.id = ANY(v_order_ids)
      AND o.cash_shift_id IS NOT NULL
    UNION ALL
    SELECT cp.cash_shift_id
    FROM public.customer_payments cp
    WHERE cp.order_id = ANY(v_order_ids)
      AND cp.cash_shift_id IS NOT NULL
    UNION ALL
    SELECT sr.cash_shift_id
    FROM public.sales_returns sr
    WHERE sr.order_id = ANY(v_order_ids)
  ) linked
  WHERE linked.shift_id IS NOT NULL;

  IF CARDINALITY(v_shift_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام وردية اختبار واحدة، الموجود: %.', CARDINALITY(v_shift_ids);
  END IF;

  PERFORM 1
  FROM public.cash_shifts cs
  WHERE cs.id = ANY(v_shift_ids)
    AND cs.status IN ('closed', 'cancelled')
  ;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يمكن تنظيف وردية ما زالت مفتوحة.';
  END IF;

  SELECT COALESCE(ARRAY_AGG(sr.id ORDER BY sr.id), ARRAY[]::UUID[])
    INTO v_sales_return_ids
  FROM public.sales_returns sr
  WHERE sr.order_id = ANY(v_order_ids)
  ;

  IF CARDINALITY(v_sales_return_ids) <> 1 THEN
    RAISE EXCEPTION 'توقع النظام مرتجع مبيعات واحدًا، الموجود: %.', CARDINALITY(v_sales_return_ids);
  END IF;

  -- Lock the validated roots before checking and deleting their dependency
  -- graph. This prevents another request from attaching new records midway.
  PERFORM 1 FROM public.products
  WHERE id = ANY(v_product_ids) FOR UPDATE;
  PERFORM 1 FROM public.suppliers
  WHERE id = ANY(v_supplier_ids) FOR UPDATE;
  PERFORM 1 FROM public.supplier_receipts
  WHERE id = ANY(v_receipt_ids) FOR UPDATE;
  PERFORM 1 FROM public.customers
  WHERE id = ANY(v_customer_ids) FOR UPDATE;
  PERFORM 1 FROM public.orders
  WHERE id = ANY(v_order_ids) FOR UPDATE;
  PERFORM 1 FROM public.operational_expenses
  WHERE id = ANY(v_expense_ids) FOR UPDATE;
  PERFORM 1 FROM public.sales_returns
  WHERE id = ANY(v_sales_return_ids) FOR UPDATE;

  -- The completed return and cancelled supplier receipt must have restored the
  -- new product to an exact zero before any physical cleanup is allowed.
  SELECT COUNT(*)
    INTO v_count
  FROM public.inventory_balances ib
  WHERE ib.product_id = ANY(v_product_ids)
    AND (ib.on_hand_quantity <> 0 OR ib.reserved_quantity <> 0);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'رصيد صنف الاختبار لم يرجع إلى صفر؛ تم إيقاف التنظيف.';
  END IF;

  -- Reject any relationship that is not part of this exact tagged cycle.
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.product_id = ANY(v_product_ids)
      AND NOT (oi.order_id = ANY(v_order_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_receipt_items sri
    WHERE sri.product_id = ANY(v_product_ids)
      AND NOT (sri.supplier_receipt_id = ANY(v_receipt_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
    WHERE poi.product_id = ANY(v_product_ids)
  ) OR EXISTS (
    SELECT 1 FROM public.purchase_receipt_items pri
    WHERE pri.product_id = ANY(v_product_ids)
  ) THEN
    RAISE EXCEPTION 'وجد النظام ارتباطًا غير تابع للاختبار مع الصنف؛ تم إيقاف التنظيف.';
  END IF;

  -- Some older modules are optional in deployed databases. Check them only
  -- when the table is actually installed, while keeping the same protection.
  IF TO_REGCLASS('public.supplier_return_items') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM public.supplier_return_items
      WHERE product_id = ANY($1)
    )'
    INTO v_has_dependency
    USING v_product_ids;
    IF v_has_dependency THEN
      RAISE EXCEPTION 'وجد النظام مرتجع مورد مرتبطًا بصنف الاختبار.';
    END IF;
  END IF;

  IF TO_REGCLASS('public.stock_count_items') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM public.stock_count_items
      WHERE product_id = ANY($1)
    )'
    INTO v_has_dependency
    USING v_product_ids;
    IF v_has_dependency THEN
      RAISE EXCEPTION 'وجد النظام جلسة جرد مرتبطة بصنف الاختبار.';
    END IF;
  END IF;

  IF TO_REGCLASS('public.inventory_opening_items') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM public.inventory_opening_items
      WHERE product_id = ANY($1)
    )'
    INTO v_has_dependency
    USING v_product_ids;
    IF v_has_dependency THEN
      RAISE EXCEPTION 'وجد النظام تهيئة افتتاحية مرتبطة بصنف الاختبار.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.purchase_orders po
    WHERE po.supplier_id = ANY(v_supplier_ids)
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_payments sp
    WHERE sp.supplier_id = ANY(v_supplier_ids)
      AND NOT (sp.supplier_receipt_id = ANY(v_receipt_ids))
  ) THEN
    RAISE EXCEPTION 'وجد النظام ارتباطًا غير تابع للاختبار مع المورد؛ تم إيقاف التنظيف.';
  END IF;

  IF TO_REGCLASS('public.supplier_returns') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (
      SELECT 1 FROM public.supplier_returns
      WHERE supplier_id = ANY($1)
    )'
    INTO v_has_dependency
    USING v_supplier_ids;
    IF v_has_dependency THEN
      RAISE EXCEPTION 'وجد النظام مرتجع مورد مرتبطًا بمورد الاختبار.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = ANY(v_customer_ids)
      AND NOT (o.id = ANY(v_order_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.promotion_redemptions pr
    WHERE pr.customer_id = ANY(v_customer_ids)
      AND NOT (pr.order_id = ANY(v_order_ids))
  ) THEN
    RAISE EXCEPTION 'وجد النظام ارتباطًا غير تابع للاختبار مع العميل؛ تم إيقاف التنظيف.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.cash_shift_id = ANY(v_shift_ids)
      AND NOT (o.id = ANY(v_order_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.customer_payments cp
    WHERE cp.cash_shift_id = ANY(v_shift_ids)
      AND NOT (cp.order_id = ANY(v_order_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.supplier_payments sp
    WHERE sp.cash_shift_id = ANY(v_shift_ids)
      AND NOT (sp.supplier_receipt_id = ANY(v_receipt_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.sales_returns sr
    WHERE sr.cash_shift_id = ANY(v_shift_ids)
      AND NOT (sr.id = ANY(v_sales_return_ids))
  ) OR EXISTS (
    SELECT 1 FROM public.operational_expenses e
    WHERE e.shift_id = ANY(v_shift_ids)
      AND NOT (e.id = ANY(v_expense_ids))
  ) THEN
    RAISE EXCEPTION 'وجد النظام حركة غير تابعة للاختبار داخل الوردية؛ تم إيقاف التنظيف.';
  END IF;

  v_entity_ids := v_product_ids || v_supplier_ids || v_receipt_ids
    || v_customer_ids || v_order_ids || v_expense_ids || v_shift_ids
    || v_sales_return_ids;

  DELETE FROM public.audit_logs al
  WHERE al.entity_id = ANY(v_entity_ids)
     OR COALESCE(al.details::TEXT, '') ILIKE '%' || v_tag || '%';
  GET DIAGNOSTICS v_deleted_audits = ROW_COUNT;

  DELETE FROM public.push_dispatches pd
  WHERE pd.entity_id = ANY(v_order_ids);

  DELETE FROM public.sales_returns sr
  WHERE sr.id = ANY(v_sales_return_ids);

  DELETE FROM public.customer_payments cp
  WHERE cp.order_id = ANY(v_order_ids);

  DELETE FROM public.promotion_redemptions pr
  WHERE pr.order_id = ANY(v_order_ids);

  DELETE FROM public.orders o
  WHERE o.id = ANY(v_order_ids);

  DELETE FROM public.supplier_payments sp
  WHERE sp.supplier_receipt_id = ANY(v_receipt_ids);

  DELETE FROM public.supplier_receipts sr
  WHERE sr.id = ANY(v_receipt_ids);

  DELETE FROM public.operational_expenses e
  WHERE e.id = ANY(v_expense_ids);

  DELETE FROM public.inventory_movements im
  WHERE im.product_id = ANY(v_product_ids);
  GET DIAGNOSTICS v_deleted_movements = ROW_COUNT;

  DELETE FROM public.inventory_balances ib
  WHERE ib.product_id = ANY(v_product_ids);

  DELETE FROM public.products p
  WHERE p.id = ANY(v_product_ids);

  DELETE FROM public.customer_addresses ca
  WHERE ca.customer_id = ANY(v_customer_ids);

  DELETE FROM public.customers c
  WHERE c.id = ANY(v_customer_ids);

  DELETE FROM public.suppliers s
  WHERE s.id = ANY(v_supplier_ids);

  DELETE FROM public.cash_shifts cs
  WHERE cs.id = ANY(v_shift_ids);

  RETURN JSONB_BUILD_OBJECT(
    'success', true,
    'testTag', v_tag,
    'deleted', JSONB_BUILD_OBJECT(
      'products', CARDINALITY(v_product_ids),
      'suppliers', CARDINALITY(v_supplier_ids),
      'supplierReceipts', CARDINALITY(v_receipt_ids),
      'customers', CARDINALITY(v_customer_ids),
      'orders', CARDINALITY(v_order_ids),
      'salesReturns', CARDINALITY(v_sales_return_ids),
      'expenses', CARDINALITY(v_expense_ids),
      'cashShifts', CARDINALITY(v_shift_ids),
      'inventoryMovements', v_deleted_movements,
      'auditLogs', v_deleted_audits
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_tagged_e2e_test_cycle(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_tagged_e2e_test_cycle(TEXT)
  TO authenticated;

COMMIT;
