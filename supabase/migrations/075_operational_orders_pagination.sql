-- =========================================================================
-- Nawasrah ERP - Operational orders paging
-- Keeps the administration order queue responsive as history grows. The
-- function returns only the current page IDs plus server-calculated counts;
-- the browser subsequently loads the existing order detail projection only
-- for those IDs.
-- =========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_operational_orders_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_filter TEXT DEFAULT 'action',
  p_search TEXT DEFAULT NULL,
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
  v_filter TEXT := COALESCE(NULLIF(BTRIM(p_filter), ''), 'action');
  v_search TEXT := NULLIF(BTRIM(p_search), '');
  v_sort TEXT := COALESCE(NULLIF(BTRIM(p_sort), ''), 'newest');
  v_offset INTEGER;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'cashier',
      'sales',
      'orders',
      'delivery_driver'
    ],
    'عرض قائمة طلبات المتجر'
  );

  IF v_page < 1 OR v_page > 100000 THEN
    RAISE EXCEPTION 'رقم الصفحة غير صالح.';
  END IF;

  IF v_page_size < 1 OR v_page_size > 100 THEN
    RAISE EXCEPTION 'حجم الصفحة يجب أن يكون بين 1 و100.';
  END IF;

  IF v_filter NOT IN (
    'all',
    'action',
    'active',
    'completed',
    'returned',
    'cancelled'
  ) THEN
    RAISE EXCEPTION 'فلتر الطلبات غير صالح.';
  END IF;

  IF v_sort NOT IN ('newest', 'oldest') THEN
    RAISE EXCEPTION 'ترتيب الطلبات غير صالح.';
  END IF;

  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جدًا.';
  END IF;

  v_offset := (v_page - 1) * v_page_size;

  WITH filtered_orders AS (
    SELECT o.id, o.created_at
    FROM public.orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    WHERE COALESCE(o.source, 'website') <> 'pos'
      AND (
        v_filter = 'all'
        OR (v_filter = 'action' AND o.status = 'new')
        OR (
          v_filter = 'active'
          AND o.status IN (
            'confirmed',
            'preparing',
            'processing',
            'ready',
            'out_for_delivery'
          )
        )
        OR (v_filter = 'completed' AND o.status IN ('completed', 'delivered'))
        OR (v_filter = 'returned' AND o.status = 'returned')
        OR (v_filter = 'cancelled' AND o.status = 'cancelled')
      )
      AND (
        v_search IS NULL
        OR o.order_number ILIKE '%' || v_search || '%'
        OR COALESCE(o.customer_name_snapshot, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.full_name, '') ILIKE '%' || v_search || '%'
        OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
      )
  ),
  paged_orders AS (
    SELECT id
    FROM filtered_orders
    ORDER BY
      CASE WHEN v_sort = 'oldest' THEN created_at END ASC,
      CASE WHEN v_sort = 'oldest' THEN id END ASC,
      CASE WHEN v_sort = 'newest' THEN created_at END DESC,
      CASE WHEN v_sort = 'newest' THEN id END DESC
    OFFSET v_offset
    LIMIT v_page_size
  ),
  operational_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE o.status = 'new')::INTEGER AS review_count,
      COUNT(*) FILTER (
        WHERE o.status IN (
          'confirmed',
          'preparing',
          'processing',
          'ready',
          'out_for_delivery'
        )
      )::INTEGER AS active_count,
      COALESCE(SUM(
        GREATEST(
          o.total_in_minor_units - o.amount_paid_in_minor_units,
          0
        )
      ) FILTER (WHERE o.status IN ('completed', 'delivered')), 0)::BIGINT
        AS due_in_minor_units
    FROM public.orders o
    WHERE COALESCE(o.source, 'website') <> 'pos'
  )
  SELECT jsonb_build_object(
    'order_ids', COALESCE(
      (SELECT jsonb_agg(id) FROM paged_orders),
      '[]'::JSONB
    ),
    'total_count', (SELECT COUNT(*)::INTEGER FROM filtered_orders),
    'summary', jsonb_build_object(
      'review_count', operational_summary.review_count,
      'active_count', operational_summary.active_count,
      'due_in_minor_units', operational_summary.due_in_minor_units
    )
  )
  INTO v_result
  FROM operational_summary;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_orders_page(
  INTEGER,
  INTEGER,
  TEXT,
  TEXT,
  TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_operational_orders_page(
  INTEGER,
  INTEGER,
  TEXT,
  TEXT,
  TEXT
) TO authenticated;

COMMIT;
