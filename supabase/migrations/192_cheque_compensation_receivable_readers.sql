BEGIN;

-- Complete explicit definitions; original source121/133/136/137/138/161/162.
-- Compensation claims are additional authoritative evidence, never rewritten vouchers.

CREATE OR REPLACE FUNCTION public.phase42_customer_receivable_total_internal(
  p_customer_id UUID
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (
    COALESCE((
      SELECT SUM(position.outstanding_total_in_minor_units)
      FROM public.orders customer_order
      CROSS JOIN LATERAL public.phase42_order_financial_position_internal(
        customer_order.id
      ) position
      WHERE customer_order.customer_id = p_customer_id
        AND customer_order.status IN ('completed', 'delivered')
        AND (
          COALESCE(customer_order.source, 'website') <> 'pos'
          OR customer_order.payment_method = 'debt'
        )
    ), 0)
    + COALESCE((
      SELECT SUM(opening.outstanding)
      FROM public.go_live_customer_opening_positions_internal(p_customer_id) opening
    ), 0)
    + COALESCE((SELECT SUM(c.outstanding) FROM public.cheque_customer_claim_positions_internal(p_customer_id)c),0)
  )::BIGINT;
$$;
ALTER FUNCTION public.phase42_customer_receivable_total_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase42_customer_receivable_total_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_customer_debt_aging(p_customer_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض عمر ذمم العملاء'
  );

  WITH eligible AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.total_in_minor_units,
      o.amount_paid_in_minor_units, o.operation_id
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
  ), prior_debt AS MATERIALIZED (
    -- Exact set-based form of121 phase42_order_financial_position_internal's
    -- prior_debt source. Do not introduce a projection/cache or new authority.
    SELECT e.order_id, SUM(e.debt_reduction_amount_in_minor_units)::BIGINT AS amount
    FROM public.sales_return_events e JOIN eligible o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND o.amount_paid_in_minor_units < o.total_in_minor_units
    GROUP BY e.order_id
  ), financial_positions AS MATERIALIZED (
    SELECT o.*, CASE
      WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
      ELSE GREATEST(o.total_in_minor_units - o.amount_paid_in_minor_units
        - COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding
    FROM eligible o LEFT JOIN prior_debt d ON d.order_id = o.id
  ), active_payments AS MATERIALIZED (
    SELECT p.order_id, SUM(p.amount_in_minor_units)::BIGINT AS amount
    FROM public.customer_payments p JOIN eligible o ON o.id = p.order_id
    WHERE NOT p.is_reversed
    GROUP BY p.order_id
  ), completion_history AS MATERIALIZED (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h JOIN eligible o ON o.id = h.order_id
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id
  ), completion_operations AS MATERIALIZED (
    SELECT o.id AS order_id, MIN(b.completed_at) AS at
    FROM eligible o JOIN public.business_operations b
      ON b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = o.id::TEXT
      AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
      AND b.completed_at IS NOT NULL
    GROUP BY o.id
  ), principals AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.outstanding,
      -- amount_paid contains initial collection plus effective later vouchers.
      -- Remove only proven active vouchers to recover the original exposure;
      -- the bounded difference to current outstanding is display FIFO coverage.
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
    UNION ALL
    -- 161: an active opening debt is a principal at its original date; its
    -- allocated opening collections (163) are coverage like vouchers, and
    -- FIFO still presents all coverage against the oldest principal first.
    SELECT opening.id, opening.customer_id, opening.outstanding,
      opening.principal, opening.occurred_at
    FROM public.go_live_customer_opening_positions_internal(p_customer_id) opening
    UNION ALL
    SELECT c.id,c.customer_id,c.outstanding,c.principal,c.occurred_at
    FROM public.cheque_customer_claim_positions_internal(p_customer_id)c
  ), ordered AS (
    SELECT *,
      SUM(principal - outstanding) OVER (PARTITION BY customer_id) AS coverage,
      COALESCE(SUM(principal) OVER (PARTITION BY customer_id
        ORDER BY completed_at NULLS FIRST, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_principal
    FROM principals
    -- Zero principal contributes neither coverage nor remaining debt. Keep
    -- positive fully-paid principals: their coverage still belongs in FIFO.
    WHERE principal > 0
  ), allocated AS (
    SELECT *, GREATEST(principal - GREATEST(coverage - prior_principal, 0), 0)::BIGINT AS remaining,
      CASE WHEN completed_at IS NOT NULL THEN GREATEST(
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE
        - (completed_at AT TIME ZONE 'Asia/Amman')::DATE, 0) END AS age_days
    FROM ordered
  ), buckets AS (
    SELECT customer_id, SUM(remaining)::BIGINT AS total,
      COALESCE(SUM(remaining) FILTER (WHERE age_days BETWEEN 0 AND 7), 0)::BIGINT AS days_0_7,
      COALESCE(SUM(remaining) FILTER (WHERE age_days BETWEEN 8 AND 30), 0)::BIGINT AS days_8_30,
      COALESCE(SUM(remaining) FILTER (WHERE age_days > 30), 0)::BIGINT AS days_over_30,
      COALESCE(SUM(remaining) FILTER (WHERE age_days IS NULL), 0)::BIGINT AS age_unavailable,
      COUNT(*) FILTER (WHERE remaining > 0 AND age_days IS NULL)::INTEGER AS undated_debt_count,
      CASE WHEN BOOL_OR(remaining > 0 AND age_days IS NULL) THEN NULL
        ELSE MIN(completed_at) FILTER (WHERE remaining > 0) END AS oldest_debt_at,
      CASE WHEN BOOL_OR(remaining > 0 AND age_days IS NULL) THEN NULL
        ELSE MAX(age_days) FILTER (WHERE remaining > 0) END AS oldest_debt_age_days
    FROM allocated GROUP BY customer_id
  ), payment_dates AS (
    SELECT customer_id, MAX(at) AS last_payment_at FROM (
      SELECT p.customer_id, p.created_at AS at
      FROM public.customer_payments p
      WHERE NOT p.is_reversed
        AND (p_customer_id IS NULL OR p.customer_id = p_customer_id)
      UNION ALL
      SELECT c.customer_id, c.created_at FROM public.customer_collection_operations c
      WHERE NOT c.is_reversed AND c.opening_amount_in_minor_units+c.compensation_amount_in_minor_units > 0
        AND (p_customer_id IS NULL OR c.customer_id = p_customer_id)
    ) paid
    GROUP BY customer_id
  ), customers AS (
    SELECT c.id AS customer_id, c.full_name, c.phone, c.credit_limit_in_minor_units,
      COALESCE(b.total, 0) AS total_in_minor_units,
      COALESCE(b.days_0_7, 0) AS days_0_7_in_minor_units,
      COALESCE(b.days_8_30, 0) AS days_8_30_in_minor_units,
      COALESCE(b.days_over_30, 0) AS days_over_30_in_minor_units,
      COALESCE(b.age_unavailable, 0) AS age_unavailable_in_minor_units,
      COALESCE(b.undated_debt_count, 0) AS undated_debt_count,
      b.oldest_debt_at, b.oldest_debt_age_days, p.last_payment_at,
      COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
        WHERE q.customer_id=c.id AND q.status IN ('pending','endorsed')),0)::BIGINT AS outstanding_cheques_in_minor_units,
      EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=c.id AND q.status='returned') AS has_returned_cheque
    FROM public.customers c LEFT JOIN buckets b ON b.customer_id = c.id
    LEFT JOIN payment_dates p ON p.customer_id = c.id
    WHERE p_customer_id IS NULL OR c.id = p_customer_id
  )
  SELECT CASE WHEN p_customer_id IS NOT NULL THEN
    (SELECT TO_JSONB(c) FROM customers c)
  ELSE JSONB_BUILD_OBJECT(
    'total_in_minor_units', COALESCE(SUM(c.total_in_minor_units), 0),
    'days_0_7_in_minor_units', COALESCE(SUM(c.days_0_7_in_minor_units), 0),
    'days_8_30_in_minor_units', COALESCE(SUM(c.days_8_30_in_minor_units), 0),
    'days_over_30_in_minor_units', COALESCE(SUM(c.days_over_30_in_minor_units), 0),
    'age_unavailable_in_minor_units', COALESCE(SUM(c.age_unavailable_in_minor_units), 0),
    'undated_debt_count', COALESCE(SUM(c.undated_debt_count), 0),
    'overdue_customer_count', COUNT(*) FILTER (WHERE c.days_over_30_in_minor_units > 0),
    'over_limit_customer_count', COUNT(*) FILTER (
      WHERE c.credit_limit_in_minor_units > 0 AND c.total_in_minor_units > c.credit_limit_in_minor_units),
    'top_overdue_limit', 50,
    'top_overdue', COALESCE((SELECT JSONB_AGG(TO_JSONB(t)
      ORDER BY t.days_over_30_in_minor_units DESC, t.customer_id)
      FROM (SELECT * FROM customers WHERE days_over_30_in_minor_units > 0
        ORDER BY days_over_30_in_minor_units DESC, customer_id LIMIT 50) t), '[]'::JSONB)
  ) END INTO v_result FROM customers c;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_customer_debt_aging(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_debt_aging(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_debt_aging(UUID) TO authenticated;

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
    ), opening_debts AS MATERIALIZED (
      -- 161: active opening debts of candidate customers, original date kept.
      SELECT opening.id, opening.customer_id, opening.principal, opening.outstanding AS amount,
        opening.occurred_at
      FROM public.go_live_customer_opening_positions_internal(NULL) opening
      JOIN candidates c ON c.id = opening.customer_id
      WHERE v_status IN ('has_debt', 'overdue', 'over_limit')
      UNION ALL
      SELECT d.id,d.customer_id,d.principal,d.outstanding,d.occurred_at
      FROM public.cheque_customer_claim_positions_internal(NULL)d JOIN candidates c ON c.id=d.customer_id
      WHERE v_status IN ('has_debt','overdue','over_limit')
    ), balances AS (
      SELECT customer_id, SUM(amount)::BIGINT AS amount
      FROM (SELECT customer_id, outstanding AS amount FROM financial_positions
        UNION ALL SELECT customer_id, amount FROM opening_debts) debt
      GROUP BY customer_id
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
      UNION ALL
      SELECT opening.id, opening.customer_id, opening.amount, opening.principal, opening.occurred_at
      FROM opening_debts opening WHERE v_status = 'overdue'
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
        'current_balance_in_minor_units', public.phase42_customer_receivable_total_internal(pc.id),
        'outstanding_cheques_in_minor_units',COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
          WHERE q.customer_id=pc.id AND q.status IN ('pending','endorsed')),0),
        'has_returned_cheque',EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=pc.id AND q.status='returned')))
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
ALTER FUNCTION public.get_crm_customer_page(INTEGER,INTEGER,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_crm_customer_page(INTEGER,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_crm_customer_page(INTEGER,INTEGER,TEXT,TEXT,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id UUID, p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_size INTEGER := LEAST(COALESCE(p_page_size, 25), 100);
  v_result JSONB;
  v_evidence_total BIGINT;
  v_canonical BIGINT;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant', 'sales'],
    'عرض كشف حساب العميل'
  );
  IF p_customer_id IS NULL OR v_page < 1 OR v_size < 1 THEN
    RAISE EXCEPTION 'معرّف العميل ورقم الصفحة وحجمها مطلوبون وصالحون.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RETURN NULL;
  END IF;

  WITH scoped AS MATERIALIZED (
    SELECT o.* FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
      AND (o.status IN ('completed', 'delivered') OR EXISTS (
        SELECT 1 FROM public.pos_sale_reversals r WHERE r.order_id = o.id
          AND (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT > 0
      ))
  ), vouchers AS MATERIALIZED (
    SELECT p.* FROM public.customer_payments p JOIN scoped o ON o.id = p.order_id
  ), active_payments AS (
    SELECT order_id, SUM(amount_in_minor_units)::BIGINT AS amount
    FROM vouchers WHERE NOT is_reversed GROUP BY order_id
  ), completion_history AS (
    SELECT h.order_id, MIN(h.created_at) AS at
    FROM public.order_status_history h JOIN scoped o ON o.id = h.order_id
    WHERE h.new_status = 'completed' GROUP BY h.order_id
  ), completion_operations AS (
    SELECT o.id AS order_id, MIN(b.completed_at) AS at
    FROM scoped o JOIN public.business_operations b
      ON b.operation_type = 'phase3_customer_completion_v1'
      AND b.result_snapshot->>'order_id' = o.id::TEXT
      AND b.request_identity_snapshot->>'order_id' = o.id::TEXT
      AND b.completed_at IS NOT NULL GROUP BY o.id
  ), exposure AS (
    SELECT o.id, o.order_number,
      LEAST(o.total_in_minor_units, GREATEST(
        o.total_in_minor_units - o.amount_paid_in_minor_units
          + COALESCE(p.amount, 0), 0))::BIGINT AS amount,
      COALESCE(h.at, c.at, CASE
        WHEN creation.operation_type = 'phase3_pos_sale_v1'
          AND creation.result_snapshot->>'orderId' = o.id::TEXT
        THEN creation.completed_at END) AS at
    FROM scoped o LEFT JOIN active_payments p ON p.order_id = o.id
    LEFT JOIN completion_history h ON h.order_id = o.id
    LEFT JOIN completion_operations c ON c.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
  ), movements AS (
    SELECT 'sale:' || id::TEXT AS movement_id, 'sale_debt'::TEXT AS movement_type,
      'دين بيع'::TEXT AS type_label, id AS order_id, order_number AS reference,
      at AS occurred_at, amount AS debit_in_minor_units, 0::BIGINT AS credit_in_minor_units
    FROM exposure WHERE amount > 0
    UNION ALL
    SELECT 'payment:' || p.id::TEXT, 'payment', CASE WHEN p.payment_method='cheque' THEN 'تحصيل بشيك مؤجل' ELSE 'دفعة عميل' END, p.order_id,
      p.payment_number, p.created_at, 0, p.amount_in_minor_units
    FROM vouchers p
    UNION ALL
    SELECT 'payment_reversal:' || p.id::TEXT, 'payment_reversal', 'عكس دفعة',
      p.order_id, p.payment_number, p.reversed_at, p.amount_in_minor_units, 0
    FROM vouchers p WHERE p.is_reversed
    UNION ALL
    SELECT 'return:' || e.id::TEXT, 'return_debt_reduction', 'تخفيض دين بمرتجع',
      e.order_id, o.order_number, e.settled_at, 0, e.debt_reduction_amount_in_minor_units
    FROM public.sales_return_events e JOIN scoped o ON o.id = e.order_id
    WHERE e.settlement_status = 'settled' AND e.contract_version = 401
      AND e.debt_reduction_amount_in_minor_units > 0
    UNION ALL
    SELECT 'sale_reversal:' || r.id::TEXT, 'sale_reversal', 'عكس دين بيع',
      r.order_id, o.order_number, r.created_at, 0,
      (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT
    FROM public.pos_sale_reversals r JOIN scoped o ON o.id = r.order_id
    WHERE (r.actual_effect->>'customer_receivable_in_minor_units')::BIGINT > 0
    UNION ALL
    -- 161: pre-system balance at its original date; a reversal keeps the
    -- original debit and adds its own credit, like a voucher reversal.
    SELECT 'opening:' || b.id::TEXT, 'opening_balance', 'رصيد سابق قبل النظام',
      NULL::UUID, b.entry_number, b.occurred_at, b.amount_in_minor_units, 0
    FROM public.customer_opening_balances b WHERE b.customer_id = p_customer_id
    UNION ALL
    SELECT 'opening_reversal:' || b.id::TEXT, 'opening_balance_reversal', 'عكس رصيد سابق',
      NULL::UUID, b.entry_number, b.reversed_at, 0, b.amount_in_minor_units
    FROM public.customer_opening_balances b
    WHERE b.customer_id = p_customer_id AND b.is_reversed
    UNION ALL
    -- 163: the opening part of a unified collection, and its reversal. Order
    -- parts are ordinary customer_payments and appear as payments above.
    SELECT 'opening_collection:' || c.id::TEXT, 'opening_collection', 'تحصيل دين قديم',
      NULL::UUID, c.operation_number, c.created_at, 0, c.opening_amount_in_minor_units
    FROM public.customer_collection_operations c
    WHERE c.customer_id = p_customer_id AND c.opening_amount_in_minor_units > 0
    UNION ALL
    SELECT 'opening_collection_reversal:' || c.id::TEXT, 'opening_collection_reversal', 'عكس تحصيل دين قديم',
      NULL::UUID, c.operation_number, c.reversed_at, c.opening_amount_in_minor_units, 0
    FROM public.customer_collection_operations c
    WHERE c.customer_id = p_customer_id AND c.opening_amount_in_minor_units > 0 AND c.is_reversed
    UNION ALL
    SELECT 'cheque_claim:'||c.id::TEXT,
      CASE WHEN c.claim_kind='returned' THEN 'cheque_return_compensation' ELSE 'cheque_cancellation_compensation' END,
      CASE WHEN c.claim_kind='returned' THEN 'شيك راجع' ELSE 'إلغاء تسجيل شيك' END,
      NULL::UUID,c.reference,c.created_at,c.amount_in_minor_units,0
    FROM public.cheque_compensation_claims c WHERE c.party_kind='customer' AND c.party_id=p_customer_id
    UNION ALL
    SELECT 'cheque_claim_collection:'||c.id::TEXT,'cheque_claim_collection','تحصيل قيد شيك',
      NULL::UUID,c.operation_number,c.created_at,0,c.compensation_amount_in_minor_units
    FROM public.customer_collection_operations c WHERE c.customer_id=p_customer_id AND c.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'cheque_claim_collection_reversal:'||c.id::TEXT,'cheque_claim_collection_reversal','عكس تحصيل قيد شيك',
      NULL::UUID,c.operation_number,c.reversed_at,c.compensation_amount_in_minor_units,0
    FROM public.customer_collection_operations c WHERE c.customer_id=p_customer_id AND c.compensation_amount_in_minor_units>0 AND c.is_reversed
  ), running AS MATERIALIZED (
    SELECT m.*, ROW_NUMBER() OVER (
      ORDER BY occurred_at NULLS FIRST, movement_id COLLATE "C") AS sequence,
      SUM(debit_in_minor_units - credit_in_minor_units) OVER (
        ORDER BY occurred_at NULLS FIRST, movement_id COLLATE "C"
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::BIGINT AS balance_in_minor_units
    FROM movements m
  ), page_rows AS MATERIALIZED (
    SELECT * FROM running ORDER BY sequence DESC
    OFFSET (v_page::BIGINT - 1) * v_size LIMIT v_size
  )
  SELECT JSONB_BUILD_OBJECT(
    'customer_id', p_customer_id, 'page', v_page, 'page_size', v_size,
    'total_count', (SELECT COUNT(*) FROM running),
    'has_more', (v_page::BIGINT * v_size) < (SELECT COUNT(*) FROM running),
    'timezone', 'Asia/Amman',
    'closing_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units FROM running ORDER BY sequence DESC LIMIT 1), 0),
    'page_opening_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units - debit_in_minor_units + credit_in_minor_units
      FROM page_rows ORDER BY sequence LIMIT 1), 0),
    'page_closing_balance_in_minor_units', COALESCE((
      SELECT balance_in_minor_units FROM page_rows ORDER BY sequence DESC LIMIT 1), 0),
    'movements', COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
      'movement_id', movement_id, 'movement_type', movement_type, 'type_label', type_label,
      'order_id', order_id, 'reference', reference, 'occurred_at', occurred_at,
      'original_debt_at',(SELECT c.original_debt_at FROM public.cheque_compensation_claims c WHERE movement_id='cheque_claim:'||c.id::TEXT),
      'reason',(SELECT c.reason FROM public.cheque_compensation_claims c WHERE movement_id='cheque_claim:'||c.id::TEXT),
      'occurred_at_amman', TO_CHAR(occurred_at AT TIME ZONE 'Asia/Amman',
        'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'date_label', CASE WHEN occurred_at IS NULL THEN 'تاريخ غير متاح' ELSE NULL END,
      'debit_in_minor_units', debit_in_minor_units, 'credit_in_minor_units', credit_in_minor_units,
      'balance_in_minor_units', balance_in_minor_units, 'sequence', sequence
    ) ORDER BY sequence DESC) FROM page_rows), '[]'::JSONB)
  ), COALESCE((SELECT SUM(debit_in_minor_units - credit_in_minor_units) FROM movements), 0)::BIGINT
  INTO v_result, v_evidence_total;

  v_canonical := public.phase42_customer_receivable_total_internal(p_customer_id);
  IF v_evidence_total IS DISTINCT FROM v_canonical THEN
    -- Do not invent an adjustment to make corrupt/incomplete history balance.
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CUSTOMER_STATEMENT_EVIDENCE_MISMATCH: أدلة الحركات لا تطابق رصيد العميل؛ يلزم مراجعتها.',
      DETAIL = JSONB_BUILD_OBJECT('movements_in_minor_units', v_evidence_total,
        'canonical_in_minor_units', v_canonical)::TEXT;
  END IF;
  RETURN v_result||jsonb_build_object(
    'outstanding_cheques_in_minor_units',COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q
      WHERE q.customer_id=p_customer_id AND q.status IN ('pending','endorsed')),0),
    'has_returned_cheque',EXISTS(SELECT 1 FROM public.deferred_cheques q WHERE q.customer_id=p_customer_id AND q.status='returned'));
END;
$$;
ALTER FUNCTION public.get_customer_statement(UUID,INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_statement(UUID,INTEGER,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_statement(UUID,INTEGER,INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.phase133_supplier_balance_evidence_internal()
RETURNS TABLE(supplier_id UUID,balance BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH received AS (
    SELECT supplier_id,total_in_minor_units::NUMERIC amount
    FROM public.supplier_receipts WHERE status='completed'
    UNION ALL
    SELECT po.supplier_id,r.supplier_invoice_payable_total_snapshot_in_minor_units::NUMERIC
    FROM public.purchase_receipts r JOIN public.purchase_orders po ON po.id=r.purchase_order_id
    WHERE r.status='completed' AND r.phase2_finalized_at IS NOT NULL
    UNION ALL
    SELECT supplier_id,payable::NUMERIC FROM public.phase133_legacy_po_payables_internal()
    UNION ALL
    -- 162: active go-live opening balances; an advance is a negative amount.
    SELECT supplier_id,CASE WHEN direction='payable' THEN amount_in_minor_units
      ELSE -amount_in_minor_units END::NUMERIC
    FROM public.supplier_opening_balances WHERE NOT is_reversed
    UNION ALL
    SELECT party_id,amount_in_minor_units::NUMERIC FROM public.cheque_compensation_claims WHERE party_kind='supplier'
  ), invoices AS (SELECT supplier_id,SUM(amount) amount FROM received GROUP BY supplier_id),
  payments AS (SELECT supplier_id,SUM(amount_in_minor_units::NUMERIC) amount
    FROM public.supplier_payments WHERE NOT is_reversed GROUP BY supplier_id)
  SELECT s.id,(COALESCE(i.amount,0)-COALESCE(p.amount,0))::BIGINT FROM public.suppliers s
  LEFT JOIN invoices i ON i.supplier_id=s.id LEFT JOIN payments p ON p.supplier_id=s.id;
$$;
ALTER FUNCTION public.phase133_supplier_balance_evidence_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase133_supplier_balance_evidence_internal() FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
