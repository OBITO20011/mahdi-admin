-- =========================================================================
-- Nawasrah ERP - Paginated operational read models
-- Keep growing inventory history and the CRM directory server-paged without
-- changing inventory or accounting mutation paths.
-- =========================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at
  ON public.inventory_movements (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_created_at
  ON public.inventory_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer_created_at
  ON public.orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_directory_created_at
  ON public.customers (is_deleted, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_inventory_movement_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_search TEXT DEFAULT NULL,
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_product_id UUID DEFAULT NULL
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
      'owner', 'admin', 'manager', 'accountant', 'cashier', 'sales',
      'warehouse_keeper', 'orders', 'delivery_driver', 'view_only'
    ],
    'عرض سجل حركات المخزون'
  );

  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH scoped_movements AS (
      SELECT
        im.id,
        im.warehouse_id,
        im.product_id,
        im.movement_type,
        im.quantity,
        im.balance_before,
        im.balance_after,
        im.reference_type,
        im.reference_id,
        im.notes,
        im.created_by,
        im.created_at,
        COALESCE(p.name_ar, p.sku, 'منتج') AS product_name,
        w.branch_id
      FROM public.inventory_movements im
      JOIN public.products p ON p.id = im.product_id
      JOIN public.warehouses w ON w.id = im.warehouse_id
      WHERE (p_branch_id IS NULL OR w.branch_id = p_branch_id)
        AND (p_warehouse_id IS NULL OR im.warehouse_id = p_warehouse_id)
        AND (p_product_id IS NULL OR im.product_id = p_product_id)
    ),
    filtered_movements AS (
      SELECT *
      FROM scoped_movements sm
      WHERE v_search IS NULL
        OR sm.product_name ILIKE '%' || v_search || '%'
        OR COALESCE(sm.notes, '') ILIKE '%' || v_search || '%'
        OR COALESCE(sm.reference_type, '') ILIKE '%' || v_search || '%'
        OR sm.movement_type ILIKE '%' || v_search || '%'
    ),
    paged_movements AS (
      SELECT *
      FROM filtered_movements
      ORDER BY created_at DESC, id DESC
      OFFSET v_offset
      LIMIT v_page_size
    ),
    product_counts AS (
      SELECT product_id, COUNT(*)::INTEGER AS movement_count
      FROM scoped_movements
      GROUP BY product_id
    ),
    sales_products AS (
      SELECT DISTINCT product_id
      FROM scoped_movements
      WHERE movement_type = 'sales_deduction'
    )
    SELECT jsonb_build_object(
      'rows', COALESCE(
        (SELECT jsonb_agg(to_jsonb(pm) ORDER BY pm.created_at DESC, pm.id DESC)
         FROM paged_movements pm),
        '[]'::JSONB
      ),
      'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_movements),
      'product_movement_counts', COALESCE(
        (SELECT jsonb_object_agg(product_id::TEXT, movement_count)
         FROM product_counts),
        '{}'::JSONB
      ),
      'sales_product_ids', COALESCE(
        (SELECT jsonb_agg(product_id::TEXT) FROM sales_products),
        '[]'::JSONB
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_movement_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_movement_page(
  INTEGER, INTEGER, TEXT, UUID, UUID, UUID
) TO authenticated;

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

  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;
  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;
  IF v_status NOT IN ('all', 'vip', 'active', 'inactive', 'blocked') THEN
    RAISE EXCEPTION 'فلتر العملاء غير صالح.';
  END IF;
  IF v_sort NOT IN ('latest', 'highest_spending', 'most_orders') THEN
    RAISE EXCEPTION 'ترتيب العملاء غير صالح.';
  END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;

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
        COALESCE(order_stats.total_spending_in_minor_units, 0)::BIGINT
          AS total_spending_in_minor_units,
        COALESCE(order_stats.current_balance_in_minor_units, 0)::BIGINT
          AS current_balance_in_minor_units
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
          ), 0)::BIGINT AS total_spending_in_minor_units,
          COALESCE(SUM(GREATEST(
            o.total_in_minor_units - o.amount_paid_in_minor_units,
            0
          )) FILTER (
            WHERE COALESCE(o.source, 'website') <> 'pos'
              AND o.status IN ('completed', 'delivered')
          ), 0)::BIGINT AS current_balance_in_minor_units
        FROM public.orders o
        WHERE o.customer_id = c.id
      ) order_stats ON true
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
        CASE WHEN v_sort = 'highest_spending'
          THEN total_spending_in_minor_units END DESC,
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

REVOKE ALL ON FUNCTION public.get_crm_customer_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
