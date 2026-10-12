BEGIN;

-- A read model over existing receivable evidence,not a second balance ledger.
-- Voucher reversals retain the original credit and add its proven debit.
-- Initial exposure follows136:remove only effective vouchers from amount_paid.
CREATE FUNCTION public.get_customer_statement(
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
    SELECT 'payment:' || p.id::TEXT, 'payment', 'دفعة عميل', p.order_id,
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
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_customer_statement(UUID, INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_statement(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_statement(UUID, INTEGER, INTEGER) TO authenticated;
COMMENT ON FUNCTION public.get_customer_statement(UUID, INTEGER, INTEGER) IS
  'Read-only receivable evidence timeline; undated first; canonical phase42 closing balance; no synthetic adjustment or financial writes.';
COMMIT;
