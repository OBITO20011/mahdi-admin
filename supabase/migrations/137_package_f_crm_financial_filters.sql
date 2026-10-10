BEGIN;

-- Read-only extension of the existing085/121 directory. No new authority,
-- writer, wrapper or persisted FIFO allocation. Existing rows/order/paging and
-- current_balance remain the canonical Phase42 output.
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
  IF v_status NOT IN ('all', 'vip', 'active', 'inactive', 'blocked',
    'has_debt', 'overdue', 'over_limit', 'wholesale') THEN RAISE EXCEPTION 'فلتر العملاء غير صالح.'; END IF;
  IF v_sort NOT IN ('latest', 'highest_spending', 'most_orders') THEN RAISE EXCEPTION 'ترتيب العملاء غير صالح.'; END IF;
  IF v_search IS NOT NULL AND CHAR_LENGTH(v_search) > 100 THEN RAISE EXCEPTION 'عبارة البحث طويلة جدًا.'; END IF;
  v_offset := (v_page - 1) * v_page_size;

  RETURN (
    WITH candidates AS MATERIALIZED (
      SELECT c.* FROM public.customers c
      WHERE c.is_deleted = false
        AND (v_search IS NULL OR c.full_name ILIKE '%' || v_search || '%'
          OR COALESCE(c.phone, '') ILIKE '%' || v_search || '%'
          OR COALESCE(c.email, '') ILIKE '%' || v_search || '%')
        AND (v_status IN ('all', 'has_debt', 'overdue', 'over_limit')
          OR (v_status = 'vip' AND c.is_vip = true)
          OR (v_status = 'active' AND c.is_active = true AND c.is_blocked = false)
          OR (v_status = 'inactive' AND c.is_active = false AND c.is_blocked = false)
          OR (v_status = 'blocked' AND c.is_blocked = true)
          OR (v_status = 'wholesale' AND c.customer_type = 'wholesale'))
    ), eligible AS MATERIALIZED (
      SELECT o.id, o.customer_id, o.total_in_minor_units,
        o.amount_paid_in_minor_units, o.operation_id
      FROM public.orders o JOIN candidates c ON c.id = o.customer_id
      WHERE v_status IN ('has_debt', 'overdue', 'over_limit')
        AND o.status IN ('completed', 'delivered')
        AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
        -- A fully covered order without an active payment has zero principal
        -- and zero outstanding in136,so it cannot affect balance or FIFO.
        -- Retain fully covered orders WITH active payments:their coverage still
        -- pays the oldest principal (including a different,undated order).
        AND (o.amount_paid_in_minor_units < o.total_in_minor_units
          OR (v_status = 'overdue' AND o.id IN (
            SELECT p.order_id FROM public.customer_payments p WHERE NOT p.is_reversed)))
    ), prior_debt AS MATERIALIZED (
      -- Same prior_debt source and set-based expression proven in136 against
      -- phase42_customer_receivable_total_internal for every fixture customer.
      SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
      FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
      WHERE e.settlement_status = 'settled' AND e.contract_version = 401
        AND o.amount_paid_in_minor_units < o.total_in_minor_units
      GROUP BY e.order_id
    ), financial_positions AS NOT MATERIALIZED (
      SELECT o.*, CASE
        WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
        ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
          - COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding
      FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
    ), balances AS (
      SELECT customer_id, SUM(outstanding)::BIGINT AS amount
      FROM financial_positions GROUP BY customer_id
    ), active_payments AS NOT MATERIALIZED (
      SELECT p.order_id, SUM(p.amount_in_minor_units)::BIGINT AS amount
      FROM public.customer_payments p JOIN eligible o ON o.id = p.order_id
      WHERE v_status = 'overdue' AND NOT p.is_reversed
      GROUP BY p.order_id
    ), completion_history AS NOT MATERIALIZED (
      SELECT h.order_id, MIN(h.created_at) AS at
      FROM public.order_status_history h JOIN eligible o ON o.id = h.order_id
      WHERE v_status = 'overdue' AND h.new_status = 'completed'
      GROUP BY h.order_id
    ), completion_operations AS NOT MATERIALIZED (
      SELECT o.id AS order_id, MIN(b.completed_at) AS at
      FROM eligible o JOIN public.business_operations b
        ON b.operation_type = 'phase3_customer_completion_v1'
        AND b.result_snapshot->>'order_id' = o.id::TEXT
        AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
        AND b.completed_at IS NOT NULL
      WHERE v_status = 'overdue'
      GROUP BY o.id
    ), principals AS NOT MATERIALIZED (
      SELECT o.id, o.customer_id, o.outstanding,
        LEAST(o.total_in_minor_units, GREATEST(
          o.total_in_minor_units - o.amount_paid_in_minor_units
            + COALESCE(p.amount, 0), o.outstanding, 0))::BIGINT AS principal,
        COALESCE(h.at, c.at, CASE
          WHEN creation.operation_type = 'phase3_pos_sale_v1'
            AND creation.result_snapshot->>'orderId' = o.id::TEXT
          THEN creation.completed_at END) AS completed_at
      FROM financial_positions o
      LEFT JOIN active_payments p ON p.order_id = o.id
      LEFT JOIN completion_history h ON h.order_id = o.id
      LEFT JOIN completion_operations c ON c.order_id = o.id
      LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
      WHERE v_status = 'overdue'
    ), ordered AS (
      SELECT *, SUM(principal - outstanding) OVER (PARTITION BY customer_id) AS coverage,
        COALESCE(SUM(principal) OVER (PARTITION BY customer_id
          ORDER BY completed_at NULLS FIRST, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_principal
      FROM principals WHERE principal > 0
    ), allocated AS (
      SELECT *, GREATEST(principal - GREATEST(coverage - prior_principal, 0), 0)::BIGINT AS remaining,
        CASE WHEN completed_at IS NOT NULL THEN GREATEST(
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE
          - (completed_at AT TIME ZONE 'Asia/Amman')::DATE, 0) END AS age_days
      FROM ordered
    ), overdue AS (
      SELECT customer_id, SUM(remaining)::BIGINT AS amount
      FROM allocated
      WHERE age_days > 30
      GROUP BY customer_id
    ), customer_directory AS (
      SELECT c.id, c.full_name, c.phone, c.email, c.whatsapp, c.governorate,
        c.notes, c.customer_type, c.is_active, c.is_vip, c.is_blocked, c.is_deleted,
        c.credit_limit_in_minor_units, c.created_at, c.updated_at,
        COALESCE(c.governorate, '') AS address_governorate,
        COALESCE(order_stats.total_orders_count, 0)::INTEGER AS total_orders_count,
        COALESCE(order_stats.total_spending_in_minor_units, 0)::BIGINT AS total_spending_in_minor_units
      FROM candidates c
      LEFT JOIN balances balance ON balance.customer_id = c.id
      LEFT JOIN overdue debt_age ON debt_age.customer_id = c.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE COALESCE(o.source, 'website') <> 'pos')::INTEGER AS total_orders_count,
          COALESCE(SUM(o.total_in_minor_units) FILTER (
            WHERE COALESCE(o.source, 'website') <> 'pos'
              AND o.status IN ('completed', 'delivered')), 0)::BIGINT AS total_spending_in_minor_units
        FROM public.orders o WHERE o.customer_id = c.id
          AND v_sort IN ('highest_spending', 'most_orders')
      ) order_stats ON true
      WHERE (v_status <> 'has_debt' OR COALESCE(balance.amount, 0) > 0)
        AND (v_status <> 'overdue' OR COALESCE(debt_age.amount, 0) > 0)
        AND (v_status <> 'over_limit' OR (c.credit_limit_in_minor_units > 0
          AND COALESCE(balance.amount, 0) > c.credit_limit_in_minor_units))
    ), paged_customers AS (
      SELECT * FROM customer_directory
      ORDER BY
        CASE WHEN v_sort = 'highest_spending' THEN total_spending_in_minor_units END DESC,
        CASE WHEN v_sort = 'most_orders' THEN total_orders_count END DESC,
        CASE WHEN v_sort = 'latest' THEN created_at END DESC,
        id DESC
      OFFSET v_offset LIMIT v_page_size
    )
    SELECT jsonb_build_object(
      'customers', COALESCE((SELECT jsonb_agg(to_jsonb(pc) || jsonb_build_object(
        -- Display-only fields are read for the page,not every matching client.
        -- Historical spend/count are still computed before paging when sorting
        -- by them;their old definitions and tie-break order are unchanged.
        'address_governorate', COALESCE(address.governorate, pc.governorate, ''),
        'total_orders_count', CASE WHEN v_sort = 'latest'
          THEN COALESCE(order_stats.total_orders_count, 0) ELSE pc.total_orders_count END,
        'total_spending_in_minor_units', CASE WHEN v_sort = 'latest'
          THEN COALESCE(order_stats.total_spending_in_minor_units, 0) ELSE pc.total_spending_in_minor_units END,
        'current_balance_in_minor_units', public.phase42_customer_receivable_total_internal(pc.id)))
        FROM paged_customers pc
        LEFT JOIN LATERAL (
          SELECT ca.governorate FROM public.customer_addresses ca
          WHERE ca.customer_id = pc.id
          ORDER BY ca.is_default DESC, ca.created_at DESC LIMIT 1
        ) address ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) FILTER (WHERE COALESCE(o.source, 'website') <> 'pos')::INTEGER AS total_orders_count,
            COALESCE(SUM(o.total_in_minor_units) FILTER (
              WHERE COALESCE(o.source, 'website') <> 'pos'
                AND o.status IN ('completed', 'delivered')), 0)::BIGINT AS total_spending_in_minor_units
          FROM public.orders o WHERE o.customer_id = pc.id AND v_sort = 'latest'
        ) order_stats ON true), '[]'::JSONB),
      'total_count', (SELECT COUNT(*)::INTEGER FROM customer_directory)
    )
  );
END;
$$;

ALTER FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_page(INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
