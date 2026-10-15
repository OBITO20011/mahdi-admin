BEGIN;

-- Go-live customer opening debts ("رصيد سابق قبل النظام"), owner-approved.
-- An opening debt is receivable evidence with its ORIGINAL date. It is not an
-- order, sale, payment, shift, cash or inventory event, so sales, profit,
-- COGS, stock and shift readers are untouched. It enters exactly the
-- receivable readers named by the owner: phase42 canonical total (121), debt
-- aging (136), CRM financial filters (137) and the customer statement (138),
-- each redefined below with a complete explicit body. Rows are immutable;
-- the only correction is a one-time reversal, audited, before go-live finish.

CREATE SEQUENCE public.customer_opening_balance_number_seq START 1001;
REVOKE ALL ON SEQUENCE public.customer_opening_balance_number_seq FROM PUBLIC, anon, authenticated;

CREATE TABLE public.customer_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount_in_minor_units BIGINT NOT NULL
    CHECK (amount_in_minor_units > 0 AND amount_in_minor_units <= 999999999999),
  original_debt_date DATE NOT NULL CHECK (original_debt_date >= DATE '2000-01-01'),
  -- Midnight Asia/Amman of the original date; the evidence timestamp used by
  -- aging and the statement. Never inferred from created_at.
  occurred_at TIMESTAMPTZ NOT NULL,
  notes TEXT CHECK (notes IS NULL OR CHAR_LENGTH(notes) <= 300),
  -- Deferred: entries are written first and the immutable batch row, which
  -- stores the final result, is inserted last in the same transaction.
  batch_id UUID NOT NULL REFERENCES public.go_live_import_batches(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_reversed BOOLEAN NOT NULL DEFAULT false,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reversal_reason TEXT,
  CONSTRAINT customer_opening_balances_occurred_at_exact
    CHECK (occurred_at = (original_debt_date::TIMESTAMP AT TIME ZONE 'Asia/Amman')),
  CONSTRAINT customer_opening_balances_reversal_complete CHECK (
    (NOT is_reversed AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR (is_reversed AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND CHAR_LENGTH(BTRIM(reversal_reason)) BETWEEN 5 AND 300))
);
CREATE INDEX idx_customer_opening_balances_customer
  ON public.customer_opening_balances(customer_id) WHERE NOT is_reversed;
CREATE INDEX idx_customer_opening_balances_customer_all
  ON public.customer_opening_balances(customer_id, occurred_at);
CREATE INDEX idx_customer_opening_balances_created
  ON public.customer_opening_balances(created_at DESC);
ALTER TABLE public.customer_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_opening_balances FROM PUBLIC, anon, authenticated;
ALTER TABLE public.customer_opening_balances OWNER TO postgres;

CREATE FUNCTION public.go_live_guard_customer_opening_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_OPENING_IMMUTABLE: لا يُحذف رصيد افتتاحي؛ استخدم حركة العكس.';
  END IF;
  IF OLD.is_reversed OR NOT NEW.is_reversed
    OR (NEW.id, NEW.entry_number, NEW.customer_id, NEW.amount_in_minor_units,
      NEW.original_debt_date, NEW.occurred_at, NEW.notes, NEW.batch_id, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
      (OLD.id, OLD.entry_number, OLD.customer_id, OLD.amount_in_minor_units,
      OLD.original_debt_date, OLD.occurred_at, OLD.notes, OLD.batch_id, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_OPENING_IMMUTABLE: الرصيد الافتتاحي لا يُعدّل؛ التصحيح بحركة عكس واحدة فقط.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_customer_opening_balance() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_customer_opening_balance() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_customer_opening_balances_immutable
BEFORE UPDATE OR DELETE ON public.customer_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.go_live_guard_customer_opening_balance();
CREATE TRIGGER trg_customer_opening_balances_no_truncate
BEFORE TRUNCATE ON public.customer_opening_balances
FOR EACH STATEMENT EXECUTE FUNCTION public.go_live_reject_truncate();
CREATE TRIGGER trg_customer_opening_balances_go_live_lock
BEFORE INSERT OR UPDATE ON public.customer_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_opening_write_after_finish();

-- Writer. Dry run returns per-row Arabic errors without writing; a real run
-- validates the whole batch again and writes atomically or not at all.
-- Customer is matched by id or by exact phone (spaces/dashes/brackets/+ ignored).
CREATE FUNCTION public.record_customer_opening_balances_v1(
  p_idempotency_key TEXT,
  p_rows JSONB,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_replay JSONB;
  v_row JSONB;
  v_n INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
  v_error TEXT;
  v_customer_id UUID;
  v_phone TEXT;
  v_count INTEGER;
  v_date DATE;
  v_notes TEXT;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;
  v_valid JSONB := '[]'::JSONB;
  v_batch_id UUID;
  v_created JSONB := '[]'::JSONB;
  v_entry public.customer_opening_balances%ROWTYPE;
  v_total BIGINT := 0;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إدخال ديون العملاء الافتتاحية');
  PERFORM public.go_live_assert_setup_open_internal();
  IF NOT COALESCE(p_dry_run, false) THEN
    v_replay := public.go_live_begin_batch_internal('customer_opening', p_idempotency_key, p_rows);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
  ELSIF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'الدفعة يجب أن تحتوي من 1 إلى 500 سطر.';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_n := v_n + 1;
    v_error := NULL; v_customer_id := NULL; v_date := NULL;
    v_notes := NULLIF(BTRIM(v_row->>'notes'), '');
    IF jsonb_typeof(v_row) <> 'object' THEN
      v_error := 'بيانات السطر غير صحيحة.';
    ELSIF COALESCE(v_row->>'amount_in_minor_units', '') !~ '^[1-9][0-9]{0,11}$' THEN
      v_error := 'مبلغ الدين يجب أن يكون أكبر من صفر وبثلاث منازل عشرية كحد أقصى.';
    ELSIF COALESCE(v_row->>'original_debt_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      v_error := 'تاريخ الدين الأصلي مطلوب بصيغة YYYY-MM-DD.';
    ELSIF v_notes IS NOT NULL AND CHAR_LENGTH(v_notes) > 300 THEN
      v_error := 'الملاحظة أطول من 300 حرف.';
    END IF;
    IF v_error IS NULL THEN
      BEGIN
        v_date := (v_row->>'original_debt_date')::DATE;
      EXCEPTION WHEN OTHERS THEN
        v_error := 'تاريخ الدين الأصلي غير صحيح.';
      END;
    END IF;
    IF v_error IS NULL AND v_date > v_today THEN
      v_error := 'تاريخ الدين الأصلي لا يمكن أن يكون في المستقبل.';
    ELSIF v_error IS NULL AND v_date < DATE '2000-01-01' THEN
      v_error := 'تاريخ الدين الأصلي أقدم من المسموح (2000-01-01).';
    END IF;
    IF v_error IS NULL THEN
      IF COALESCE(v_row->>'customer_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_customer_id FROM public.customers
        WHERE id = (v_row->>'customer_id')::UUID AND NOT is_deleted;
        IF NOT FOUND THEN v_error := 'العميل غير موجود.'; END IF;
      ELSE
        v_phone := translate(BTRIM(COALESCE(v_row->>'customer_phone', '')), ' -()+', '');
        IF v_phone = '' THEN
          v_error := 'رقم هاتف العميل مطلوب لمطابقته.';
        ELSE
          SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_count, v_customer_id FROM public.customers
          WHERE NOT is_deleted AND translate(BTRIM(phone), ' -()+', '') = v_phone;
          IF v_count = 0 THEN
            v_customer_id := NULL;
            v_error := 'لا يوجد عميل بهذا الهاتف؛ أضف العميل أولاً من شاشة العملاء.';
          ELSIF v_count > 1 THEN
            v_customer_id := NULL;
            v_error := 'يوجد أكثر من عميل بهذا الهاتف؛ أدخل الدين يدوياً باختيار العميل.';
          END IF;
        END IF;
      END IF;
    END IF;
    IF v_error IS NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_valid) prior
      WHERE (prior->>'customer_id')::UUID = v_customer_id
        AND (prior->>'original_debt_date')::DATE = v_date
        AND (prior->>'amount_in_minor_units')::BIGINT = (v_row->>'amount_in_minor_units')::BIGINT) THEN
      v_error := 'سطر مكرر لنفس العميل والتاريخ والمبلغ داخل الملف؛ اجمعهما في سطر واحد.';
    END IF;
    IF v_error IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_n, 'message', v_error);
    ELSE
      v_valid := v_valid || jsonb_build_object('row', v_n, 'customer_id', v_customer_id,
        'amount_in_minor_units', (v_row->>'amount_in_minor_units')::BIGINT,
        'original_debt_date', v_date, 'notes', v_notes);
      v_total := v_total + (v_row->>'amount_in_minor_units')::BIGINT;
    END IF;
  END LOOP;

  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('success', true, 'dryRun', true, 'rowCount', v_n,
      'validCount', jsonb_array_length(v_valid), 'errors', v_errors,
      'validTotalInMinorUnits', v_total,
      'customerCount', (SELECT COUNT(DISTINCT v->>'customer_id') FROM jsonb_array_elements(v_valid) v));
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_BATCH_INVALID: الملف يحتوي أسطراً غير صالحة؛ لم يُحفظ أي سطر.',
      DETAIL = v_errors::TEXT;
  END IF;

  v_batch_id := gen_random_uuid();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_valid)
  LOOP
    v_date := (v_row->>'original_debt_date')::DATE;
    INSERT INTO public.customer_opening_balances(entry_number, customer_id, amount_in_minor_units,
      original_debt_date, occurred_at, notes, batch_id, created_by)
    VALUES ('COB-' || LPAD(nextval('public.customer_opening_balance_number_seq')::TEXT, 6, '0'),
      (v_row->>'customer_id')::UUID, (v_row->>'amount_in_minor_units')::BIGINT, v_date,
      v_date::TIMESTAMP AT TIME ZONE 'Asia/Amman', v_row->>'notes', v_batch_id, v_user_id)
    RETURNING * INTO v_entry;
    v_created := v_created || jsonb_build_object('row', (v_row->>'row')::INTEGER,
      'entryId', v_entry.id, 'entryNumber', v_entry.entry_number, 'customerId', v_entry.customer_id,
      'amountInMinorUnits', v_entry.amount_in_minor_units, 'originalDebtDate', v_entry.original_debt_date);
  END LOOP;
  v_result := jsonb_build_object('success', true, 'dryRun', false, 'idempotentReplay', false,
    'kind', 'customer_opening', 'batchId', v_batch_id, 'rowCount', v_n,
    'totalInMinorUnits', v_total, 'created', v_created);
  INSERT INTO public.go_live_import_batches(id, batch_kind, idempotency_key, request_hash, row_count, result, created_by)
  VALUES (v_batch_id, 'customer_opening', BTRIM(p_idempotency_key), md5(p_rows::TEXT), v_n, v_result, v_user_id);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_CUSTOMER_OPENING_BALANCES', 'go_live_import_batches', v_batch_id,
    jsonb_build_object('idempotency_key', BTRIM(p_idempotency_key), 'row_count', v_n,
      'total_in_minor_units', v_total,
      'entries', (SELECT jsonb_agg(jsonb_build_object('entry_number', c->>'entryNumber',
        'customer_id', c->>'customerId', 'amount_in_minor_units', (c->>'amountInMinorUnits')::BIGINT,
        'original_debt_date', c->>'originalDebtDate')) FROM jsonb_array_elements(v_created) c)));
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.record_customer_opening_balances_v1(TEXT, JSONB, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_customer_opening_balances_v1(TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_customer_opening_balances_v1(TEXT, JSONB, BOOLEAN) TO authenticated;

-- The only correction: one reversal per entry, with reason, before finish.
-- A repeated call for an already reversed entry is a replay without writes.
CREATE FUNCTION public.reverse_customer_opening_balance_v1(p_entry_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_entry public.customer_opening_balances%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عكس دين عميل افتتاحي');
  PERFORM public.go_live_assert_setup_open_internal();
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'اكتب سبب العكس (5 إلى 300 حرف).';
  END IF;
  SELECT * INTO v_entry FROM public.customer_opening_balances WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الرصيد الافتتاحي غير موجود.';
  END IF;
  IF v_entry.is_reversed THEN
    RETURN jsonb_build_object('success', true, 'idempotentReplay', true, 'entryId', v_entry.id,
      'entryNumber', v_entry.entry_number, 'reversedAt', v_entry.reversed_at);
  END IF;
  UPDATE public.customer_opening_balances
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id, reversal_reason = v_reason
  WHERE id = p_entry_id RETURNING * INTO v_entry;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_CUSTOMER_OPENING_REVERSED', 'customer_opening_balances', v_entry.id,
    jsonb_build_object('entry_number', v_entry.entry_number, 'customer_id', v_entry.customer_id,
      'amount_in_minor_units', v_entry.amount_in_minor_units,
      'original_debt_date', v_entry.original_debt_date, 'reason', v_reason));
  RETURN jsonb_build_object('success', true, 'idempotentReplay', false, 'entryId', v_entry.id,
    'entryNumber', v_entry.entry_number, 'reversedAt', v_entry.reversed_at);
END;
$$;
ALTER FUNCTION public.reverse_customer_opening_balance_v1(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_customer_opening_balance_v1(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_customer_opening_balance_v1(UUID, TEXT) TO authenticated;

CREATE FUNCTION public.get_go_live_customer_openings_v1(p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 25)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page, 1);
  v_size INTEGER := COALESCE(p_page_size, 25);
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عرض ديون العملاء الافتتاحية');
  IF v_page NOT BETWEEN 1 AND 100000 OR v_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'رقم الصفحة أو حجمها غير صالح.';
  END IF;
  RETURN jsonb_build_object(
    'page', v_page, 'pageSize', v_size,
    'totalCount', (SELECT COUNT(*) FROM public.customer_opening_balances),
    'activeTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
      FROM public.customer_opening_balances WHERE NOT is_reversed),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', b.id, 'entryNumber', b.entry_number, 'customerId', b.customer_id,
      'customerName', c.full_name, 'customerPhone', c.phone,
      'amountInMinorUnits', b.amount_in_minor_units, 'originalDebtDate', b.original_debt_date,
      'notes', b.notes, 'createdAt', b.created_at, 'isReversed', b.is_reversed,
      'reversedAt', b.reversed_at, 'reversalReason', b.reversal_reason)
      ORDER BY b.created_at DESC, b.entry_number DESC)
      FROM (SELECT * FROM public.customer_opening_balances
        ORDER BY created_at DESC, entry_number DESC
        OFFSET (v_page - 1) * v_size LIMIT v_size) b
      JOIN public.customers c ON c.id = b.customer_id), '[]'::JSONB));
END;
$$;
ALTER FUNCTION public.get_go_live_customer_openings_v1(INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_go_live_customer_openings_v1(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_go_live_customer_openings_v1(INTEGER, INTEGER) TO authenticated;

-- Canonical receivable (121) + active opening debts. Same signature, owner,
-- security and private ACL as before.
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
      SELECT SUM(opening.amount_in_minor_units)
      FROM public.customer_opening_balances opening
      WHERE opening.customer_id = p_customer_id
        AND NOT opening.is_reversed
    ), 0)
  )::BIGINT;
$$;
ALTER FUNCTION public.phase42_customer_receivable_total_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase42_customer_receivable_total_internal(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- 136 debt aging, complete explicit body; the only change is the opening
-- principal branch. Grants/owner unchanged.
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
    -- 161: an active opening debt is a principal with its original date and
    -- nothing paid on it directly; FIFO coverage from later vouchers still
    -- presents against the oldest principal first, as for any order.
    SELECT opening.id, opening.customer_id, opening.amount_in_minor_units,
      opening.amount_in_minor_units, opening.occurred_at
    FROM public.customer_opening_balances opening
    WHERE NOT opening.is_reversed
      AND (p_customer_id IS NULL OR opening.customer_id = p_customer_id)
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

-- 137 CRM directory filters, complete explicit body; has_debt/over_limit use
-- the opening-inclusive balance and overdue uses the same FIFO as aging.
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
      SELECT opening.id, opening.customer_id, opening.amount_in_minor_units AS amount,
        opening.occurred_at
      FROM public.customer_opening_balances opening JOIN candidates c ON c.id = opening.customer_id
      WHERE v_status IN ('has_debt', 'overdue', 'over_limit') AND NOT opening.is_reversed
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
      SELECT opening.id, opening.customer_id, opening.amount, opening.amount, opening.occurred_at
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

-- 138 statement, complete explicit body; adds opening movements. The closing
-- balance must still equal the canonical phase42 total above.
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

COMMENT ON TABLE public.customer_opening_balances IS
  'Go-live customer opening debts at their original date. Receivable evidence only: never a sale, payment, shift, stock or profit event. Immutable; one audited reversal.';
COMMENT ON FUNCTION public.get_customer_debt_aging(UUID) IS
  'Read-only customer receivables aging including active go-live opening debts at their original date. FIFO presentation only.';
COMMENT ON FUNCTION public.get_customer_statement(UUID, INTEGER, INTEGER) IS
  'Read-only receivable evidence timeline including pre-system opening balances; canonical phase42 closing balance; no synthetic adjustment.';

COMMIT;
