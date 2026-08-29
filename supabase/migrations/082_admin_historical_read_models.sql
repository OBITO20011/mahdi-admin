-- =========================================================================
-- Nawasrah ERP - Admin historical read models
-- Keeps purchasing, supplier receiving and customer receivables responsive as
-- history grows. These are read-only, role-guarded projections; no mutation
-- or accounting logic is changed here.
-- =========================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_history_page
  ON public.purchase_orders (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_history_page
  ON public.purchase_orders (supplier_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_history_page
  ON public.supplier_receipts (received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_receipts_supplier_history_page
  ON public.supplier_receipts (supplier_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_history_page
  ON public.supplier_payments (payment_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_outstanding_customer_history
  ON public.orders (customer_id, created_at DESC, id DESC)
  WHERE customer_id IS NOT NULL
    AND status IN ('completed', 'delivered')
    AND amount_paid_in_minor_units < total_in_minor_units;

CREATE OR REPLACE FUNCTION public.get_purchase_orders_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_supplier_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_sort TEXT DEFAULT 'newest'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_status TEXT := COALESCE(NULLIF(BTRIM(p_status), ''), 'all');
  v_sort TEXT := COALESCE(NULLIF(BTRIM(p_sort), ''), 'newest');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'warehouse_keeper'],
    'عرض سجل أوامر الشراء'
  );

  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_status NOT IN ('all', 'draft', 'sent', 'approved', 'partially_received', 'received', 'cancelled') THEN
    RAISE EXCEPTION 'حالة أمر الشراء غير صالحة.';
  END IF;
  IF v_sort NOT IN ('newest', 'highest_value', 'outstanding') THEN
    RAISE EXCEPTION 'ترتيب أوامر الشراء غير صالح.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_orders AS (
      SELECT
        po.*,
        s.company_name AS supplier_name,
        b.name_ar AS branch_name,
        w.name_ar AS warehouse_name,
        GREATEST(po.total_in_minor_units - po.amount_paid_in_minor_units, 0)::BIGINT
          AS amount_due_in_minor_units
      FROM public.purchase_orders po
      JOIN public.suppliers s ON s.id = po.supplier_id
      LEFT JOIN public.branches b ON b.id = po.branch_id
      LEFT JOIN public.warehouses w ON w.id = po.warehouse_id
      WHERE (v_status = 'all' OR po.status = v_status)
        AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
        AND (p_warehouse_id IS NULL OR po.warehouse_id = p_warehouse_id)
        AND (
          v_search IS NULL
          OR po.purchase_order_number ILIKE '%' || v_search || '%'
          OR s.company_name ILIKE '%' || v_search || '%'
          OR COALESCE(po.supplier_invoice_number, '') ILIKE '%' || v_search || '%'
        )
    ),
    paged_orders AS (
      SELECT *
      FROM filtered_orders
      ORDER BY
        CASE WHEN v_sort = 'highest_value' THEN total_in_minor_units END DESC,
        CASE WHEN v_sort = 'outstanding' THEN amount_due_in_minor_units END DESC,
        CASE WHEN v_sort = 'newest' THEN created_at END DESC,
        id DESC
      OFFSET v_offset
      LIMIT v_page_size
    ),
    order_rows AS (
      SELECT jsonb_build_object(
        'id', po.id,
        'purchase_order_number', po.purchase_order_number,
        'supplier_id', po.supplier_id,
        'branch_id', po.branch_id,
        'warehouse_id', po.warehouse_id,
        'status', po.status,
        'order_date', po.order_date,
        'expected_delivery_date', po.expected_delivery_date,
        'subtotal_in_minor_units', po.subtotal_in_minor_units,
        'discount_in_minor_units', po.discount_in_minor_units,
        'delivery_fee_in_minor_units', po.delivery_fee_in_minor_units,
        'total_in_minor_units', po.total_in_minor_units,
        'amount_paid_in_minor_units', po.amount_paid_in_minor_units,
        'supplier_invoice_number', po.supplier_invoice_number,
        'notes', po.notes,
        'internal_notes', po.internal_notes,
        'created_by', po.created_by,
        'approved_by', po.approved_by,
        'approved_at', po.approved_at,
        'received_at', po.received_at,
        'cancelled_at', po.cancelled_at,
        'created_at', po.created_at,
        'updated_at', po.updated_at,
        'suppliers', jsonb_build_object('id', po.supplier_id, 'company_name', po.supplier_name),
        'branches', CASE WHEN po.branch_id IS NULL THEN NULL ELSE jsonb_build_object('id', po.branch_id, 'name_ar', po.branch_name) END,
        'warehouses', CASE WHEN po.warehouse_id IS NULL THEN NULL ELSE jsonb_build_object('id', po.warehouse_id, 'name_ar', po.warehouse_name) END,
        'purchase_order_items', COALESCE(items.items, '[]'::JSONB)
      ) AS row
      FROM paged_orders po
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id', poi.id,
          'purchase_order_id', poi.purchase_order_id,
          'product_id', poi.product_id,
          'ordered_quantity', poi.ordered_quantity,
          'received_quantity', poi.received_quantity,
          'purchase_price_in_minor_units', poi.purchase_price_in_minor_units,
          'discount_in_minor_units', poi.discount_in_minor_units,
          'line_total_in_minor_units', poi.line_total_in_minor_units,
          'products', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', p.id,
            'name_ar', p.name_ar,
            'sku', p.sku,
            'barcode', p.barcode,
            'unit_id', p.unit_id,
            'base_unit', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('name_ar', u.name_ar) END
          ) END
        ) ORDER BY poi.created_at, poi.id) AS items
        FROM public.purchase_order_items poi
        LEFT JOIN public.products p ON p.id = poi.product_id
        LEFT JOIN public.units u ON u.id = p.unit_id
        WHERE poi.purchase_order_id = po.id
      ) items ON true
    ),
    summary AS (
      SELECT
        COUNT(*)::INTEGER AS total_count,
        COUNT(*) FILTER (WHERE status = 'draft')::INTEGER AS draft_count,
        COUNT(*) FILTER (WHERE status = 'sent')::INTEGER AS sent_count,
        COUNT(*) FILTER (WHERE status = 'approved')::INTEGER AS approved_count,
        COUNT(*) FILTER (WHERE status = 'partially_received')::INTEGER AS partially_received_count,
        COUNT(*) FILTER (WHERE status = 'received')::INTEGER AS received_count,
        COALESCE(SUM(total_in_minor_units) FILTER (WHERE status <> 'cancelled'), 0)::BIGINT AS total_in_minor_units,
        COALESCE(SUM(amount_paid_in_minor_units) FILTER (WHERE status <> 'cancelled'), 0)::BIGINT AS paid_in_minor_units,
        COALESCE(SUM(amount_due_in_minor_units) FILTER (WHERE status <> 'cancelled'), 0)::BIGINT AS due_in_minor_units
      FROM filtered_orders
    )
    SELECT jsonb_build_object(
      'orders', COALESCE((SELECT jsonb_agg(row) FROM order_rows), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', jsonb_build_object(
        'draft_count', summary.draft_count,
        'sent_count', summary.sent_count,
        'approved_count', summary.approved_count,
        'partially_received_count', summary.partially_received_count,
        'received_count', summary.received_count,
        'total_in_minor_units', summary.total_in_minor_units,
        'paid_in_minor_units', summary.paid_in_minor_units,
        'due_in_minor_units', summary.due_in_minor_units
      )
    )
    FROM summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_supplier_receipts_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_payment_status TEXT DEFAULT 'all',
  p_is_archived BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_payment_status TEXT := COALESCE(NULLIF(BTRIM(p_payment_status), ''), 'all');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'warehouse_keeper'],
    'عرض سندات استلام الموردين'
  );

  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم الصفحة غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.'; END IF;
  IF v_payment_status NOT IN ('all', 'unpaid', 'partially_paid', 'paid') THEN RAISE EXCEPTION 'حالة الدفع غير صالحة.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_receipts AS (
      SELECT sr.*, s.company_name AS supplier_name, s.phone AS supplier_phone,
             w.name_ar AS warehouse_name, b.name_ar AS branch_name, pr.full_name AS received_by_name
      FROM public.supplier_receipts sr
      JOIN public.suppliers s ON s.id = sr.supplier_id
      JOIN public.warehouses w ON w.id = sr.warehouse_id
      LEFT JOIN public.branches b ON b.id = sr.branch_id
      LEFT JOIN public.profiles pr ON pr.id = sr.received_by
      WHERE sr.is_archived = COALESCE(p_is_archived, false)
        AND (p_supplier_id IS NULL OR sr.supplier_id = p_supplier_id)
        AND (p_warehouse_id IS NULL OR sr.warehouse_id = p_warehouse_id)
        AND (v_payment_status = 'all' OR sr.payment_status = v_payment_status)
        AND (
          v_search IS NULL
          OR sr.receipt_number ILIKE '%' || v_search || '%'
          OR COALESCE(sr.supplier_invoice_number, '') ILIKE '%' || v_search || '%'
          OR s.company_name ILIKE '%' || v_search || '%'
        )
    ),
    paged_receipts AS (
      SELECT * FROM filtered_receipts ORDER BY received_at DESC, id DESC OFFSET v_offset LIMIT v_page_size
    ),
    receipt_rows AS (
      SELECT jsonb_build_object(
        'id', sr.id, 'receipt_number', sr.receipt_number, 'supplier_id', sr.supplier_id,
        'warehouse_id', sr.warehouse_id, 'branch_id', sr.branch_id,
        'supplier_invoice_number', sr.supplier_invoice_number, 'supplier_invoice_date', sr.supplier_invoice_date,
        'received_at', sr.received_at, 'received_by', sr.received_by,
        'subtotal_in_minor_units', sr.subtotal_in_minor_units, 'discount_in_minor_units', sr.discount_in_minor_units,
        'delivery_fee_in_minor_units', sr.delivery_fee_in_minor_units, 'tax_in_minor_units', sr.tax_in_minor_units,
        'total_in_minor_units', sr.total_in_minor_units, 'amount_paid_in_minor_units', sr.amount_paid_in_minor_units,
        'amount_due_in_minor_units', sr.amount_due_in_minor_units, 'payment_status', sr.payment_status,
        'payment_method', sr.payment_method, 'payment_reference', sr.payment_reference,
        'notes', sr.notes, 'internal_notes', sr.internal_notes, 'status', sr.status,
        'is_archived', sr.is_archived, 'created_at', sr.created_at, 'updated_at', sr.updated_at,
        'suppliers', jsonb_build_object('company_name', sr.supplier_name, 'phone', sr.supplier_phone),
        'warehouses', jsonb_build_object('name_ar', sr.warehouse_name),
        'branches', CASE WHEN sr.branch_id IS NULL THEN NULL ELSE jsonb_build_object('name_ar', sr.branch_name) END,
        'profiles', CASE WHEN sr.received_by IS NULL THEN NULL ELSE jsonb_build_object('full_name', sr.received_by_name) END,
        'supplier_receipt_items', COALESCE(items.items, '[]'::JSONB),
        'supplier_payments', '[]'::JSONB
      ) AS row
      FROM paged_receipts sr
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id', sri.id, 'supplier_receipt_id', sri.supplier_receipt_id, 'product_id', sri.product_id,
          'purchase_unit_id', sri.purchase_unit_id, 'base_unit_id', sri.base_unit_id,
          'purchase_unit_name', sri.purchase_unit_name, 'base_unit_name', sri.base_unit_name,
          'package_quantity', sri.package_quantity, 'units_per_package', sri.units_per_package,
          'total_base_units', sri.total_base_units, 'package_price_in_minor_units', sri.package_price_in_minor_units,
          'base_unit_cost_in_minor_units', sri.base_unit_cost_in_minor_units,
          'discount_in_minor_units', sri.discount_in_minor_units, 'line_total_in_minor_units', sri.line_total_in_minor_units,
          'batch_number', sri.batch_number, 'production_date', sri.production_date, 'expiry_date', sri.expiry_date,
          'notes', sri.notes, 'created_at', sri.created_at,
          'products', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('name_ar', p.name_ar, 'sku', p.sku, 'barcode', p.barcode) END
        ) ORDER BY sri.created_at, sri.id) AS items
        FROM public.supplier_receipt_items sri
        LEFT JOIN public.products p ON p.id = sri.product_id
        WHERE sri.supplier_receipt_id = sr.id
      ) items ON true
    ),
    summary AS (
      SELECT COUNT(*)::INTEGER AS total_count,
        COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS due_in_minor_units,
        COUNT(*) FILTER (WHERE received_at::DATE = CURRENT_DATE)::INTEGER AS today_count,
        COALESCE(SUM(total_in_minor_units) FILTER (WHERE received_at::DATE = CURRENT_DATE), 0)::BIGINT AS today_total_in_minor_units,
        COALESCE(SUM(amount_paid_in_minor_units) FILTER (WHERE received_at::DATE = CURRENT_DATE), 0)::BIGINT AS today_paid_in_minor_units,
        COALESCE(SUM(item_count), 0)::INTEGER AS item_count
      FROM (
        SELECT fr.*, (SELECT COUNT(*)::INTEGER FROM public.supplier_receipt_items sri WHERE sri.supplier_receipt_id = fr.id) AS item_count
        FROM filtered_receipts fr
      ) summarized
    )
    SELECT jsonb_build_object(
      'receipts', COALESCE((SELECT jsonb_agg(row) FROM receipt_rows), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', jsonb_build_object('due_in_minor_units', summary.due_in_minor_units, 'today_count', summary.today_count, 'today_total_in_minor_units', summary.today_total_in_minor_units, 'today_paid_in_minor_units', summary.today_paid_in_minor_units, 'item_count', summary.item_count)
    ) FROM summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_outstanding_orders_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض ذمم العملاء'
  );
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم الصفحة غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH outstanding_orders AS (
      SELECT o.id, o.order_number, o.customer_id, o.customer_name_snapshot,
        o.total_in_minor_units, o.amount_paid_in_minor_units, o.payment_status, o.created_at,
        c.full_name AS customer_name, c.phone AS customer_phone,
        GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units, 0)::BIGINT AS amount_due_in_minor_units
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE COALESCE(o.source, 'website') <> 'pos'
        AND o.status IN ('completed', 'delivered')
        AND o.amount_paid_in_minor_units < o.total_in_minor_units
        AND (
          v_search IS NULL
          OR o.order_number ILIKE '%' || v_search || '%'
          OR COALESCE(c.full_name, o.customer_name_snapshot, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
        )
    ),
    paged_orders AS (
      SELECT * FROM outstanding_orders ORDER BY created_at DESC, id DESC OFFSET v_offset LIMIT v_page_size
    ),
    summary AS (
      SELECT COUNT(*)::INTEGER AS total_count, COUNT(DISTINCT customer_id)::INTEGER AS customer_count,
        COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS due_in_minor_units
      FROM outstanding_orders
    )
    SELECT jsonb_build_object(
      'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'order_number', order_number, 'customer_id', customer_id,
        'customer_name', COALESCE(customer_name, customer_name_snapshot, 'عميل مسجل'),
        'customer_phone', COALESCE(customer_phone, ''),
        'total_in_minor_units', total_in_minor_units,
        'amount_paid_in_minor_units', amount_paid_in_minor_units,
        'amount_due_in_minor_units', amount_due_in_minor_units,
        'payment_status', payment_status, 'created_at', created_at
      )) FROM paged_orders), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', jsonb_build_object('customer_count', summary.customer_count, 'due_in_minor_units', summary.due_in_minor_units)
    ) FROM summary
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_supplier_payments_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 25);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_payment_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method), ''), 'all');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض سندات صرف الموردين'
  );
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم الصفحة غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.'; END IF;
  IF v_payment_method NOT IN ('all', 'cash', 'bank_transfer', 'cliq', 'card', 'check') THEN
    RAISE EXCEPTION 'طريقة الدفع غير صالحة.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_payments AS (
      SELECT sp.*, s.company_name AS supplier_name, po.purchase_order_number
      FROM public.supplier_payments sp
      JOIN public.suppliers s ON s.id = sp.supplier_id
      LEFT JOIN public.purchase_orders po ON po.id = sp.purchase_order_id
      WHERE (p_supplier_id IS NULL OR sp.supplier_id = p_supplier_id)
        AND (v_payment_method = 'all' OR sp.payment_method = v_payment_method)
        AND (
          v_search IS NULL
          OR s.company_name ILIKE '%' || v_search || '%'
          OR COALESCE(po.purchase_order_number, '') ILIKE '%' || v_search || '%'
          OR COALESCE(sp.reference_number, '') ILIKE '%' || v_search || '%'
          OR COALESCE(sp.notes, '') ILIKE '%' || v_search || '%'
        )
    ),
    paged_payments AS (
      SELECT * FROM filtered_payments ORDER BY payment_date DESC, created_at DESC, id DESC OFFSET v_offset LIMIT v_page_size
    ),
    summary AS (
      SELECT COUNT(*)::INTEGER AS total_count,
        COALESCE(SUM(amount_in_minor_units), 0)::BIGINT AS total_in_minor_units
      FROM filtered_payments
    )
    SELECT jsonb_build_object(
      'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'supplier_id', supplier_id, 'supplier_name', supplier_name,
        'purchase_order_id', purchase_order_id, 'purchase_order_number', purchase_order_number,
        'amount_in_minor_units', amount_in_minor_units, 'payment_method', payment_method,
        'reference_number', reference_number, 'payment_date', payment_date, 'notes', notes,
        'created_by', created_by, 'created_at', created_at
      )) FROM paged_payments), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', jsonb_build_object('total_in_minor_units', summary.total_in_minor_units)
    ) FROM summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_purchase_orders_page(INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_supplier_receipts_page(INTEGER, INTEGER, TEXT, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_supplier_payments_page(INTEGER, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_purchase_orders_page(INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_receipts_page(INTEGER, INTEGER, TEXT, UUID, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_payments_page(INTEGER, INTEGER, TEXT, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.get_purchase_orders_page(INTEGER, INTEGER, TEXT, TEXT, UUID, UUID, TEXT)
  IS 'Role-guarded, server-paged purchase-order read model with only the current page item details.';
COMMENT ON FUNCTION public.get_supplier_receipts_page(INTEGER, INTEGER, TEXT, UUID, UUID, TEXT, BOOLEAN)
  IS 'Role-guarded, server-paged direct supplier-receipt history with server totals.';
COMMENT ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT)
  IS 'Role-guarded, server-calculated outstanding customer order balances.';
COMMENT ON FUNCTION public.get_supplier_payments_page(INTEGER, INTEGER, TEXT, UUID, TEXT)
  IS 'Role-guarded, server-paged supplier-payment history with server-side supplier and reference filtering.';

COMMIT;
