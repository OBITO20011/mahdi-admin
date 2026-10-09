BEGIN;

-- Presentation-only FIFO. No allocation is persisted and no financial writer
-- or existing reader changes. Unknown completion evidence is not a date.
CREATE FUNCTION public.get_customer_debt_aging(p_customer_id UUID DEFAULT NULL)
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
      o.amount_paid_in_minor_units, o.operation_id,
      CASE WHEN o.amount_paid_in_minor_units >= o.total_in_minor_units THEN 0::BIGINT
        ELSE (SELECT position.outstanding_total_in_minor_units
          FROM public.phase42_order_financial_position_internal(o.id) position)
      END AS outstanding
    FROM public.orders o
    WHERE o.status IN ('completed', 'delivered')
      AND o.customer_id IS NOT NULL
      AND (p_customer_id IS NULL OR o.customer_id = p_customer_id)
      AND (COALESCE(o.source, 'website') <> 'pos' OR o.payment_method = 'debt')
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
    FROM eligible o
    LEFT JOIN active_payments p ON p.order_id = o.id
    LEFT JOIN completion_history h ON h.order_id = o.id
    LEFT JOIN completion_operations c ON c.order_id = o.id
    LEFT JOIN public.business_operations creation ON creation.id = o.operation_id
  ), ordered AS (
    SELECT *,
      SUM(principal - outstanding) OVER (PARTITION BY customer_id) AS coverage,
      COALESCE(SUM(principal) OVER (PARTITION BY customer_id
        ORDER BY completed_at NULLS FIRST, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_principal
    FROM principals
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
    SELECT p.customer_id, MAX(p.created_at) AS last_payment_at
    FROM public.customer_payments p
    WHERE NOT p.is_reversed
      AND (p_customer_id IS NULL OR p.customer_id = p_customer_id)
    GROUP BY p.customer_id
  ), customers AS (
    SELECT c.id AS customer_id, c.full_name, c.phone, c.credit_limit_in_minor_units,
      COALESCE(b.total, 0) AS total_in_minor_units,
      COALESCE(b.days_0_7, 0) AS days_0_7_in_minor_units,
      COALESCE(b.days_8_30, 0) AS days_8_30_in_minor_units,
      COALESCE(b.days_over_30, 0) AS days_over_30_in_minor_units,
      COALESCE(b.age_unavailable, 0) AS age_unavailable_in_minor_units,
      COALESCE(b.undated_debt_count, 0) AS undated_debt_count,
      b.oldest_debt_at, b.oldest_debt_age_days, p.last_payment_at
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
REVOKE ALL ON FUNCTION public.get_customer_debt_aging(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_debt_aging(UUID) TO authenticated;
COMMENT ON FUNCTION public.get_customer_debt_aging(UUID) IS
  'Read-only customer receivables aging. FIFO presentation only; undated debts first, separate from overdue. No created_at date inference or financial writes.';

COMMIT;
