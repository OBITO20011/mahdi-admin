-- =========================================================================
-- Nawasrah ERP - Final admin customer receivables and scalability blockers
--
-- 1. Include valid POS debt sales in customer receivables.
-- 2. Serve customer detail summaries and order history in bounded pages.
-- 3. Search the POS customer directory on the server without a silent cap.
--
-- This migration changes read models only. Existing write, inventory and
-- accounting mutation paths remain authoritative and unchanged.
-- =========================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_customers_pos_name_search
  ON public.customers (LOWER(full_name) text_pattern_ops, id)
  WHERE is_active = true AND is_blocked = false AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_customers_pos_phone_search
  ON public.customers (phone text_pattern_ops, id)
  WHERE is_active = true AND is_blocked = false AND is_deleted = false;

-- A POS receivable exists only for an explicitly deferred sale. Cash and CliQ
-- remain excluded even if historical data is incomplete. Cancelled, reversed
-- and returned sales are excluded by the completed/delivered status boundary.
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
      SELECT
        o.id,
        o.order_number,
        o.customer_id,
        o.customer_name_snapshot,
        o.source,
        o.payment_method,
        o.total_in_minor_units,
        o.amount_paid_in_minor_units,
        o.payment_status,
        o.created_at,
        c.full_name AS customer_name,
        c.phone AS customer_phone,
        GREATEST(
          o.total_in_minor_units - o.amount_paid_in_minor_units,
          0
        )::BIGINT AS amount_due_in_minor_units
      FROM public.orders o
      JOIN public.customers c ON c.id = o.customer_id
      WHERE o.status IN ('completed', 'delivered')
        AND o.amount_paid_in_minor_units < o.total_in_minor_units
        AND (
          COALESCE(o.source, 'website') <> 'pos'
          OR o.payment_method = 'debt'
        )
        AND (
          v_search IS NULL
          OR o.order_number ILIKE '%' || v_search || '%'
          OR COALESCE(c.full_name, o.customer_name_snapshot, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
        )
    ),
    paged_orders AS (
      SELECT *
      FROM outstanding_orders
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset
      LIMIT v_page_size
    ),
    summary AS (
      SELECT
        COUNT(*)::INTEGER AS total_count,
        COUNT(DISTINCT customer_id)::INTEGER AS customer_count,
        COALESCE(SUM(amount_due_in_minor_units), 0)::BIGINT AS due_in_minor_units
      FROM outstanding_orders
    )
    SELECT jsonb_build_object(
      'orders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'order_number', order_number,
          'customer_id', customer_id,
          'customer_name', COALESCE(customer_name, customer_name_snapshot, 'عميل مسجل'),
          'customer_phone', COALESCE(customer_phone, ''),
          'source', source,
          'payment_method', payment_method,
          'total_in_minor_units', total_in_minor_units,
          'amount_paid_in_minor_units', amount_paid_in_minor_units,
          'amount_due_in_minor_units', amount_due_in_minor_units,
          'payment_status', payment_status,
          'created_at', created_at
        ) ORDER BY created_at DESC, id DESC)
        FROM paged_orders
      ), '[]'::JSONB),
      'total_count', summary.total_count,
      'summary', jsonb_build_object(
        'customer_count', summary.customer_count,
        'due_in_minor_units', summary.due_in_minor_units
      )
    )
    FROM summary
  );
END;
$$;

-- Preserve directory order/spending semantics (website workflow) while the
-- balance column represents every valid receivable, including POS debt.
CREATE OR REPLACE FUNCTION public.get_crm_customer_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 10,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'all',
  p_sort TEXT DEFAULT 'latest'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_page_size INTEGER := COALESCE(p_page_size, 10);
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_status TEXT := COALESCE(NULLIF(BTRIM(p_status), ''), 'all');
  v_sort TEXT := COALESCE(NULLIF(BTRIM(p_sort), ''), 'latest');
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض دليل العملاء'
  );

  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم الصفحة غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.'; END IF;
  IF v_status NOT IN ('all', 'vip', 'active', 'inactive', 'blocked') THEN RAISE EXCEPTION 'فلتر العملاء غير صالح.'; END IF;
  IF v_sort NOT IN ('latest', 'highest_spending', 'most_orders') THEN RAISE EXCEPTION 'ترتيب العملاء غير صالح.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH customer_directory AS (
      SELECT
        c.id,
        c.full_name,
        c.phone,
        c.email,
        c.whatsapp,
        c.governorate,
        c.notes,
        c.customer_type,
        c.is_active,
        c.is_vip,
        c.is_blocked,
        c.is_deleted,
        c.credit_limit_in_minor_units,
        c.created_at,
        c.updated_at,
        COALESCE(address.governorate, c.governorate, '') AS address_governorate,
        COALESCE(order_stats.total_orders_count, 0)::INTEGER AS total_orders_count,
        COALESCE(order_stats.total_spending_in_minor_units, 0)::BIGINT AS total_spending_in_minor_units,
        COALESCE(receivable_stats.current_balance_in_minor_units, 0)::BIGINT AS current_balance_in_minor_units
      FROM public.customers c
      LEFT JOIN LATERAL (
        SELECT ca.governorate
        FROM public.customer_addresses ca
        WHERE ca.customer_id = c.id
        ORDER BY ca.is_default DESC, ca.created_at DESC
        LIMIT 1
      ) address ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE COALESCE(o.source, 'website') <> 'pos'
          )::INTEGER AS total_orders_count,
          COALESCE(SUM(o.total_in_minor_units) FILTER (
            WHERE COALESCE(o.source, 'website') <> 'pos'
              AND o.status IN ('completed', 'delivered')
          ), 0)::BIGINT AS total_spending_in_minor_units
        FROM public.orders o
        WHERE o.customer_id = c.id
      ) order_stats ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(GREATEST(
          o.total_in_minor_units - o.amount_paid_in_minor_units,
          0
        )), 0)::BIGINT AS current_balance_in_minor_units
        FROM public.orders o
        WHERE o.customer_id = c.id
          AND o.status IN ('completed', 'delivered')
          AND o.amount_paid_in_minor_units < o.total_in_minor_units
          AND (
            COALESCE(o.source, 'website') <> 'pos'
            OR o.payment_method = 'debt'
          )
      ) receivable_stats ON true
      WHERE c.is_deleted = false
        AND (
          v_search IS NULL
          OR c.full_name ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.email, '') ILIKE '%' || v_search || '%'
        )
        AND (
          v_status = 'all'
          OR (v_status = 'vip' AND c.is_vip = true)
          OR (v_status = 'active' AND c.is_active = true AND c.is_blocked = false)
          OR (v_status = 'inactive' AND c.is_active = false AND c.is_blocked = false)
          OR (v_status = 'blocked' AND c.is_blocked = true)
        )
    ),
    paged_customers AS (
      SELECT *
      FROM customer_directory
      ORDER BY
        CASE WHEN v_sort = 'highest_spending' THEN total_spending_in_minor_units END DESC,
        CASE WHEN v_sort = 'most_orders' THEN total_orders_count END DESC,
        CASE WHEN v_sort = 'latest' THEN created_at END DESC,
        id DESC
      OFFSET v_offset
      LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customers', COALESCE(
        (SELECT jsonb_agg(to_jsonb(pc)) FROM paged_customers pc),
        '[]'::JSONB
      ),
      'total_count', (SELECT COUNT(*)::INTEGER FROM customer_directory)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_crm_customer_detail_page(
  p_customer_id UUID,
  p_history_page INTEGER DEFAULT 1,
  p_history_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_history_page, 1);
  v_page_size INTEGER := COALESCE(p_history_page_size, 25);
  v_offset INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض ملف العميل'
  );
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'العميل المطلوب غير محدد.'; END IF;
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم صفحة سجل العميل غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم صفحة سجل العميل يجب أن يكون بين 1 و100.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = p_customer_id AND c.is_deleted = false
  ) THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH customer_row AS (
      SELECT
        c.id, c.full_name, c.phone, c.email, c.whatsapp, c.governorate,
        c.notes, c.customer_type, c.is_active, c.is_vip, c.is_blocked,
        c.is_deleted, c.credit_limit_in_minor_units, c.created_at, c.updated_at
      FROM public.customers c
      WHERE c.id = p_customer_id AND c.is_deleted = false
    ),
    operational_orders AS (
      SELECT
        o.id,
        o.order_number,
        o.status,
        o.payment_status,
        o.total_in_minor_units,
        o.amount_paid_in_minor_units,
        COALESCE(o.source, 'website') AS source,
        o.created_at,
        (SELECT COUNT(*)::INTEGER FROM public.order_items oi WHERE oi.order_id = o.id) AS items_count
      FROM public.orders o
      WHERE o.customer_id = p_customer_id
        AND COALESCE(o.source, 'website') <> 'pos'
    ),
    order_stats AS (
      SELECT
        COUNT(*)::INTEGER AS total_orders,
        COUNT(*) FILTER (WHERE status IN ('completed', 'delivered'))::INTEGER AS completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER AS cancelled_orders,
        COALESCE(SUM(total_in_minor_units) FILTER (
          WHERE status IN ('completed', 'delivered')
        ), 0)::BIGINT AS total_spending_in_minor_units,
        MAX(created_at) AS last_order_date
      FROM operational_orders
    ),
    receivable_stats AS (
      SELECT COALESCE(SUM(GREATEST(
        o.total_in_minor_units - o.amount_paid_in_minor_units,
        0
      )), 0)::BIGINT AS outstanding_in_minor_units
      FROM public.orders o
      WHERE o.customer_id = p_customer_id
        AND o.status IN ('completed', 'delivered')
        AND o.amount_paid_in_minor_units < o.total_in_minor_units
        AND (
          COALESCE(o.source, 'website') <> 'pos'
          OR o.payment_method = 'debt'
        )
    ),
    paged_orders AS (
      SELECT *
      FROM operational_orders
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset
      LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customer', jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'phone', c.phone,
        'email', c.email,
        'whatsapp', c.whatsapp,
        'governorate', c.governorate,
        'notes', c.notes,
        'customer_type', c.customer_type,
        'is_active', c.is_active,
        'is_vip', c.is_vip,
        'is_blocked', c.is_blocked,
        'is_deleted', c.is_deleted,
        'credit_limit_in_minor_units', c.credit_limit_in_minor_units,
        'created_at', c.created_at,
        'updated_at', c.updated_at
      ),
      'addresses', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', ca.id,
          'customer_id', ca.customer_id,
          'governorate', ca.governorate,
          'city', ca.city,
          'area', ca.area,
          'street', ca.street,
          'building', ca.building,
          'floor', ca.floor,
          'apartment', ca.apartment,
          'notes', ca.notes,
          'latitude', ca.latitude,
          'longitude', ca.longitude,
          'formatted_address', ca.formatted_address,
          'google_maps_url', ca.google_maps_url,
          'location_source', ca.location_source,
          'location_confirmed', ca.location_confirmed,
          'is_default', ca.is_default,
          'created_at', ca.created_at
        ) ORDER BY ca.is_default DESC, ca.created_at DESC)
        FROM public.customer_addresses ca
        WHERE ca.customer_id = p_customer_id
      ), '[]'::JSONB),
      'stats', jsonb_build_object(
        'total_orders', s.total_orders,
        'completed_orders', s.completed_orders,
        'cancelled_orders', s.cancelled_orders,
        'total_spending_in_minor_units', s.total_spending_in_minor_units,
        'outstanding_in_minor_units', r.outstanding_in_minor_units,
        'average_order_value_in_minor_units', CASE
          WHEN s.completed_orders > 0
            THEN ROUND(s.total_spending_in_minor_units::NUMERIC / s.completed_orders)::BIGINT
          ELSE 0
        END,
        'last_order_date', s.last_order_date
      ),
      'orders', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', po.id,
          'order_number', po.order_number,
          'status', po.status,
          'payment_status', po.payment_status,
          'total_in_minor_units', po.total_in_minor_units,
          'amount_paid_in_minor_units', po.amount_paid_in_minor_units,
          'amount_due_in_minor_units', CASE
            WHEN po.status IN ('completed', 'delivered')
              THEN GREATEST(po.total_in_minor_units - po.amount_paid_in_minor_units, 0)
            ELSE 0
          END,
          'source', po.source,
          'items_count', po.items_count,
          'created_at', po.created_at
        ) ORDER BY po.created_at DESC, po.id DESC)
        FROM paged_orders po
      ), '[]'::JSONB),
      'history_page', v_page,
      'history_page_size', v_page_size,
      'history_total_count', s.total_orders,
      'history_has_more', (v_offset + v_page_size) < s.total_orders
    )
    FROM customer_row c
    CROSS JOIN order_stats s
    CROSS JOIN receivable_stats r
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pos_customer_page(
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
    ARRAY[
      'owner', 'admin', 'manager', 'cashier', 'sales', 'view_only'
    ],
    'البحث في عملاء نقطة البيع'
  );
  IF v_page < 1 OR v_page > 100000 THEN RAISE EXCEPTION 'رقم صفحة العملاء غير صالح.'; END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN RAISE EXCEPTION 'حجم صفحة العملاء يجب أن يكون بين 1 و100.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة بحث العميل طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH filtered_customers AS (
      SELECT c.id, c.full_name, c.phone
      FROM public.customers c
      WHERE c.is_active = true
        AND c.is_blocked = false
        AND c.is_deleted = false
        AND (
          v_search IS NULL
          OR LOWER(c.full_name) LIKE LOWER(v_search) || '%'
          OR COALESCE(c.phone, '') LIKE v_search || '%'
          OR c.id::TEXT = LOWER(v_search)
        )
    ),
    paged_customers AS (
      SELECT *
      FROM filtered_customers
      ORDER BY LOWER(full_name), id
      OFFSET v_offset
      LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', pc.id,
          'full_name', pc.full_name,
          'phone', pc.phone
        ) ORDER BY LOWER(pc.full_name), pc.id)
        FROM paged_customers pc
      ), '[]'::JSONB),
      'page', v_page,
      'page_size', v_page_size,
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_customers),
      'has_more', (v_offset + v_page_size) < (SELECT COUNT(*) FROM filtered_customers)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_crm_customer_detail_page(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pos_customer_page(INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_detail_page(UUID, INTEGER, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_customer_page(INTEGER, INTEGER, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.get_customer_outstanding_orders_page(INTEGER, INTEGER, TEXT)
  IS 'Role-guarded receivables page including valid POS debt while excluding paid and inactive sales.';
COMMENT ON FUNCTION public.get_crm_customer_detail_page(UUID, INTEGER, INTEGER)
  IS 'Role-guarded customer summary with bounded server-paged website order history and complete receivable balance.';
COMMENT ON FUNCTION public.get_pos_customer_page(INTEGER, INTEGER, TEXT)
  IS 'Role-guarded bounded POS customer search by name prefix, phone prefix or exact customer id.';

COMMIT;
