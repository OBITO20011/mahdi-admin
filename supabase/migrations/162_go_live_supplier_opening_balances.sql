BEGIN;

-- Go-live supplier opening balances in both directions, owner-approved.
--   payable ("له"): we owed the supplier before the system  -> balance +amount
--   advance ("عليه"): the supplier owed us before the system -> balance -amount
-- Consistent with 133: suppliers.current_balance_in_minor_units stays the
-- active balance (positive obligation, negative advance) and the monitoring
-- evidence equation below includes the same active opening rows, so the
-- integrity check remains exact. Later settlement uses the existing supplier
-- payment/receiving paths unchanged. Not a receipt, purchase, cost, stock,
-- cash or shift event. Immutable rows; one owner reversal with reason, audited
-- (also after go-live finish, owner decision 3). Cash/CliQ settlement: 163.

CREATE SEQUENCE public.supplier_opening_balance_number_seq START 1001;
REVOKE ALL ON SEQUENCE public.supplier_opening_balance_number_seq FROM PUBLIC, anon, authenticated;

CREATE TABLE public.supplier_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number TEXT NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('payable', 'advance')),
  amount_in_minor_units BIGINT NOT NULL
    CHECK (amount_in_minor_units > 0 AND amount_in_minor_units <= 999999999999),
  original_balance_date DATE NOT NULL CHECK (original_balance_date >= DATE '2000-01-01'),
  notes TEXT CHECK (notes IS NULL OR CHAR_LENGTH(notes) <= 300),
  batch_id UUID NOT NULL REFERENCES public.go_live_import_batches(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_reversed BOOLEAN NOT NULL DEFAULT false,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reversal_reason TEXT,
  CONSTRAINT supplier_opening_balances_reversal_complete CHECK (
    (NOT is_reversed AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
    OR (is_reversed AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND CHAR_LENGTH(BTRIM(reversal_reason)) BETWEEN 5 AND 300))
);
CREATE INDEX idx_supplier_opening_balances_supplier
  ON public.supplier_opening_balances(supplier_id) WHERE NOT is_reversed;
CREATE INDEX idx_supplier_opening_balances_created
  ON public.supplier_opening_balances(created_at DESC);
ALTER TABLE public.supplier_opening_balances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supplier_opening_balances FROM PUBLIC, anon, authenticated;
ALTER TABLE public.supplier_opening_balances OWNER TO postgres;

CREATE FUNCTION public.go_live_guard_supplier_opening_balance()
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
    OR (NEW.id, NEW.entry_number, NEW.supplier_id, NEW.direction, NEW.amount_in_minor_units,
      NEW.original_balance_date, NEW.notes, NEW.batch_id, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
      (OLD.id, OLD.entry_number, OLD.supplier_id, OLD.direction, OLD.amount_in_minor_units,
      OLD.original_balance_date, OLD.notes, OLD.batch_id, OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_OPENING_IMMUTABLE: الرصيد الافتتاحي لا يُعدّل؛ التصحيح بحركة عكس واحدة فقط.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_supplier_opening_balance() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_supplier_opening_balance() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_supplier_opening_balances_immutable
BEFORE UPDATE OR DELETE ON public.supplier_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.go_live_guard_supplier_opening_balance();
CREATE TRIGGER trg_supplier_opening_balances_no_truncate
BEFORE TRUNCATE ON public.supplier_opening_balances
FOR EACH STATEMENT EXECUTE FUNCTION public.go_live_reject_truncate();
CREATE TRIGGER trg_supplier_opening_balances_go_live_lock
BEFORE INSERT ON public.supplier_opening_balances
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_opening_write_after_finish();

-- Owner decision 7 (same rule as customers): match an active supplier by
-- phone first, then by an exactly equal company name. A doubtful match
-- (equal/similar name with a different phone, or a similar name without
-- phone) is a blocking per-row warning. Unmatched suppliers are created only
-- when the caller confirms the listed names. One net line per supplier.
CREATE FUNCTION public.record_supplier_opening_balances_v1(
  p_idempotency_key TEXT,
  p_rows JSONB,
  p_dry_run BOOLEAN DEFAULT false,
  p_confirm_new_suppliers BOOLEAN DEFAULT false
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
  v_supplier_id UUID;
  v_count INTEGER;
  v_warning BOOLEAN;
  v_name TEXT;
  v_phone TEXT;
  v_other TEXT;
  v_new_key TEXT;
  v_new JSONB := '{}'::JSONB;
  v_created_suppliers JSONB := '[]'::JSONB;
  v_date DATE;
  v_direction TEXT;
  v_notes TEXT;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;
  v_valid JSONB := '[]'::JSONB;
  v_batch_id UUID;
  v_created JSONB := '[]'::JSONB;
  v_entry public.supplier_opening_balances%ROWTYPE;
  v_payable BIGINT := 0;
  v_advance BIGINT := 0;
  v_supplier UUID;
  v_signed BIGINT;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إدخال أرصدة الموردين الافتتاحية');
  PERFORM public.go_live_assert_setup_open_internal();
  IF NOT COALESCE(p_dry_run, false) THEN
    v_replay := public.go_live_begin_batch_internal('supplier_opening', p_idempotency_key, p_rows);
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
    v_error := NULL; v_warning := false; v_supplier_id := NULL; v_date := NULL; v_new_key := NULL; v_other := NULL;
    v_name := NULLIF(BTRIM(v_row->>'supplier_name'), '');
    v_phone := NULLIF(public.normalize_customer_phone(COALESCE(v_row->>'supplier_phone', '')), '');
    v_direction := v_row->>'direction';
    v_notes := NULLIF(BTRIM(v_row->>'notes'), '');
    IF jsonb_typeof(v_row) <> 'object' THEN
      v_error := 'بيانات السطر غير صحيحة.';
    ELSIF v_direction IS NULL OR v_direction NOT IN ('payable', 'advance') THEN
      v_error := 'اتجاه الرصيد يجب أن يكون "له" أو "عليه".';
    ELSIF COALESCE(v_row->>'amount_in_minor_units', '') !~ '^[1-9][0-9]{0,11}$' THEN
      v_error := 'المبلغ يجب أن يكون أكبر من صفر وبثلاث منازل عشرية كحد أقصى.';
    ELSIF COALESCE(v_row->>'original_balance_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      v_error := 'تاريخ الرصيد الأصلي مطلوب بصيغة YYYY-MM-DD.';
    ELSIF v_notes IS NOT NULL AND CHAR_LENGTH(v_notes) > 300 THEN
      v_error := 'الملاحظة أطول من 300 حرف.';
    END IF;
    IF v_error IS NULL THEN
      BEGIN
        v_date := (v_row->>'original_balance_date')::DATE;
      EXCEPTION WHEN OTHERS THEN
        v_error := 'تاريخ الرصيد الأصلي غير صحيح.';
      END;
    END IF;
    IF v_error IS NULL AND v_date > v_today THEN
      v_error := 'تاريخ الرصيد الأصلي لا يمكن أن يكون في المستقبل.';
    ELSIF v_error IS NULL AND v_date < DATE '2000-01-01' THEN
      v_error := 'تاريخ الرصيد الأصلي أقدم من المسموح (2000-01-01).';
    END IF;
    IF v_error IS NULL AND v_name IS NOT NULL AND CHAR_LENGTH(v_name) > 150 THEN
      v_error := 'اسم المورد أطول من المسموح.';
    END IF;
    IF v_error IS NULL AND COALESCE(v_row->>'supplier_id', '') <> '' THEN
      IF v_row->>'supplier_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_supplier_id FROM public.suppliers
        WHERE id = (v_row->>'supplier_id')::UUID AND is_active;
      END IF;
      IF v_supplier_id IS NULL THEN v_error := 'المورد غير موجود أو غير نشط.'; END IF;
    ELSIF v_error IS NULL AND v_name IS NULL AND v_phone IS NULL THEN
      v_error := 'اسم المورد أو هاتفه مطلوب لمطابقته.';
    ELSIF v_error IS NULL THEN
      IF v_phone IS NOT NULL THEN
        SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_count, v_supplier_id FROM public.suppliers
        WHERE is_active AND NULLIF(public.normalize_customer_phone(COALESCE(phone, '')), '') = v_phone;
        IF v_count > 1 THEN
          v_supplier_id := NULL;
          v_error := 'يوجد أكثر من مورد بهذا الهاتف؛ أدخل الرصيد يدوياً باختيار المورد.';
        ELSIF v_count = 0 THEN
          v_supplier_id := NULL;
        END IF;
      ELSE
        SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_count, v_supplier_id FROM public.suppliers
        WHERE is_active AND BTRIM(company_name) = v_name;
        IF v_count > 1 THEN
          v_supplier_id := NULL;
          v_error := 'يوجد أكثر من مورد بهذا الاسم؛ أدخل الرصيد يدوياً باختيار المورد.';
        ELSIF v_count = 0 THEN
          v_supplier_id := NULL;
        END IF;
      END IF;
      IF v_error IS NULL AND v_supplier_id IS NULL THEN
        SELECT company_name || COALESCE(' — ' || NULLIF(phone, ''), '') INTO v_other FROM public.suppliers
        WHERE is_active AND v_name IS NOT NULL
          AND public.go_live_normalize_name_internal(company_name) = public.go_live_normalize_name_internal(v_name)
        ORDER BY created_at LIMIT 1;
        IF v_other IS NOT NULL THEN
          v_warning := true;
          v_error := 'تحذير: يوجد مورد باسم مطابق أو مشابه '
            || CASE WHEN v_phone IS NULL THEN 'والسطر بلا هاتف' ELSE 'وهاتف مختلف' END
            || ' (' || v_other || ')؛ صحّح السطر أو أدخل الرصيد يدوياً. لن يُنشأ مورد مكرر.';
        ELSIF v_name IS NULL THEN
          v_error := 'لا يوجد مورد بهذا الهاتف، واسم المورد مطلوب لإضافته كمورد جديد.';
        ELSE
          v_new_key := public.go_live_normalize_name_internal(v_name);
        END IF;
      END IF;
    END IF;
    IF v_error IS NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_valid) prior
      WHERE COALESCE(prior->>'supplier_id', prior->>'new_key') = COALESCE(v_supplier_id::TEXT, v_new_key)) THEN
      v_error := 'المورد مكرر داخل الملف؛ اجعل لكل مورد سطراً واحداً بصافي رصيده.';
    END IF;
    IF v_error IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_n, 'message', v_error,
        'kind', CASE WHEN v_warning THEN 'warning' ELSE 'error' END);
    ELSE
      IF v_new_key IS NOT NULL THEN
        v_new := v_new || jsonb_build_object(v_new_key, jsonb_build_object('row', v_n, 'name', v_name, 'phone', v_phone));
      END IF;
      v_valid := v_valid || jsonb_build_object('row', v_n, 'supplier_id', v_supplier_id, 'new_key', v_new_key,
        'direction', v_direction, 'amount_in_minor_units', (v_row->>'amount_in_minor_units')::BIGINT,
        'original_balance_date', v_date, 'notes', v_notes);
      IF v_direction = 'payable' THEN
        v_payable := v_payable + (v_row->>'amount_in_minor_units')::BIGINT;
      ELSE
        v_advance := v_advance + (v_row->>'amount_in_minor_units')::BIGINT;
      END IF;
    END IF;
  END LOOP;

  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('success', true, 'dryRun', true, 'rowCount', v_n,
      'validCount', jsonb_array_length(v_valid), 'errors', v_errors,
      'newSuppliers', COALESCE((SELECT jsonb_agg(value ORDER BY (value->>'row')::INTEGER)
        FROM jsonb_each(v_new)), '[]'::JSONB),
      'payableTotalInMinorUnits', v_payable, 'advanceTotalInMinorUnits', v_advance);
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_BATCH_INVALID: الملف يحتوي أسطراً غير صالحة أو تحذيرات؛ لم يُحفظ أي سطر.',
      DETAIL = v_errors::TEXT;
  END IF;
  IF v_new <> '{}'::JSONB AND NOT COALESCE(p_confirm_new_suppliers, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_NEW_PARTIES_CONFIRMATION_REQUIRED: سيُضاف ' || (SELECT COUNT(*) FROM jsonb_object_keys(v_new))
        || ' مورد جديد؛ أكّد إضافتهم قبل الحفظ.';
  END IF;

  FOR v_new_key IN SELECT key FROM jsonb_each(v_new) ORDER BY (value->>'row')::INTEGER
  LOOP
    INSERT INTO public.suppliers(company_name, phone, is_active)
    VALUES (v_new->v_new_key->>'name', v_new->v_new_key->>'phone', true)
    RETURNING id INTO v_supplier_id;
    v_new := jsonb_set(v_new, ARRAY[v_new_key, 'supplier_id'], to_jsonb(v_supplier_id));
    v_created_suppliers := v_created_suppliers || jsonb_build_object('supplierId', v_supplier_id,
      'name', v_new->v_new_key->>'name', 'phone', v_new->v_new_key->>'phone');
    INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
    VALUES (v_user_id, 'GO_LIVE_SUPPLIER_CREATED', 'suppliers', v_supplier_id,
      jsonb_build_object('company_name', v_new->v_new_key->>'name', 'phone', v_new->v_new_key->>'phone'));
  END LOOP;
  v_valid := (SELECT COALESCE(jsonb_agg(CASE WHEN v->>'supplier_id' IS NULL
      THEN jsonb_set(v, '{supplier_id}', v_new->(v->>'new_key')->'supplier_id') ELSE v END
      ORDER BY (v->>'row')::INTEGER), '[]'::JSONB)
    FROM jsonb_array_elements(v_valid) v);

  -- Lock suppliers in a stable order before changing their stored balances.
  FOR v_supplier IN SELECT DISTINCT (v->>'supplier_id')::UUID FROM jsonb_array_elements(v_valid) v ORDER BY 1
  LOOP
    PERFORM 1 FROM public.suppliers WHERE id = v_supplier FOR UPDATE;
  END LOOP;

  v_batch_id := gen_random_uuid();
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_valid)
  LOOP
    INSERT INTO public.supplier_opening_balances(entry_number, supplier_id, direction,
      amount_in_minor_units, original_balance_date, notes, batch_id, created_by)
    VALUES ('SOB-' || LPAD(nextval('public.supplier_opening_balance_number_seq')::TEXT, 6, '0'),
      (v_row->>'supplier_id')::UUID, v_row->>'direction', (v_row->>'amount_in_minor_units')::BIGINT,
      (v_row->>'original_balance_date')::DATE, v_row->>'notes', v_batch_id, v_user_id)
    RETURNING * INTO v_entry;
    v_signed := CASE WHEN v_entry.direction = 'payable' THEN v_entry.amount_in_minor_units
      ELSE -v_entry.amount_in_minor_units END;
    UPDATE public.suppliers
    SET current_balance_in_minor_units = current_balance_in_minor_units + v_signed, updated_at = NOW()
    WHERE id = v_entry.supplier_id;
    v_created := v_created || jsonb_build_object('row', (v_row->>'row')::INTEGER,
      'entryId', v_entry.id, 'entryNumber', v_entry.entry_number, 'supplierId', v_entry.supplier_id,
      'direction', v_entry.direction, 'amountInMinorUnits', v_entry.amount_in_minor_units,
      'originalBalanceDate', v_entry.original_balance_date);
  END LOOP;
  v_result := jsonb_build_object('success', true, 'dryRun', false, 'idempotentReplay', false,
    'kind', 'supplier_opening', 'batchId', v_batch_id, 'rowCount', v_n,
    'payableTotalInMinorUnits', v_payable, 'advanceTotalInMinorUnits', v_advance, 'created', v_created,
    'createdSuppliers', v_created_suppliers);
  INSERT INTO public.go_live_import_batches(id, batch_kind, idempotency_key, request_hash, row_count, result, created_by)
  VALUES (v_batch_id, 'supplier_opening', BTRIM(p_idempotency_key), md5(p_rows::TEXT), v_n, v_result, v_user_id);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_SUPPLIER_OPENING_BALANCES', 'go_live_import_batches', v_batch_id,
    jsonb_build_object('idempotency_key', BTRIM(p_idempotency_key), 'row_count', v_n,
      'payable_total_in_minor_units', v_payable, 'advance_total_in_minor_units', v_advance,
      'created_suppliers', v_created_suppliers,
      'entries', (SELECT jsonb_agg(jsonb_build_object('entry_number', c->>'entryNumber',
        'supplier_id', c->>'supplierId', 'direction', c->>'direction',
        'amount_in_minor_units', (c->>'amountInMinorUnits')::BIGINT,
        'original_balance_date', c->>'originalBalanceDate')) FROM jsonb_array_elements(v_created) c)));
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.record_supplier_opening_balances_v1(TEXT, JSONB, BOOLEAN, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_supplier_opening_balances_v1(TEXT, JSONB, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_opening_balances_v1(TEXT, JSONB, BOOLEAN, BOOLEAN) TO authenticated;

CREATE FUNCTION public.reverse_supplier_opening_balance_v1(p_entry_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := NULLIF(BTRIM(p_reason), '');
  v_entry public.supplier_opening_balances%ROWTYPE;
  v_supplier_id UUID;
BEGIN
  -- Owner decision 3: allowed also after go-live finish (owner, reason, audit).
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عكس رصيد مورد افتتاحي');
  IF v_reason IS NULL OR CHAR_LENGTH(v_reason) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'اكتب سبب العكس (5 إلى 300 حرف).';
  END IF;
  SELECT supplier_id INTO v_supplier_id FROM public.supplier_opening_balances WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الرصيد الافتتاحي غير موجود.';
  END IF;
  -- Supplier first, then entry: the same order as the batch writer.
  PERFORM 1 FROM public.suppliers WHERE id = v_supplier_id FOR UPDATE;
  SELECT * INTO STRICT v_entry FROM public.supplier_opening_balances WHERE id = p_entry_id FOR UPDATE;
  IF v_entry.is_reversed THEN
    RETURN jsonb_build_object('success', true, 'idempotentReplay', true, 'entryId', v_entry.id,
      'entryNumber', v_entry.entry_number, 'reversedAt', v_entry.reversed_at);
  END IF;
  UPDATE public.supplier_opening_balances
  SET is_reversed = true, reversed_at = NOW(), reversed_by = v_user_id, reversal_reason = v_reason
  WHERE id = p_entry_id RETURNING * INTO v_entry;
  UPDATE public.suppliers
  SET current_balance_in_minor_units = current_balance_in_minor_units
    - CASE WHEN v_entry.direction = 'payable' THEN v_entry.amount_in_minor_units
      ELSE -v_entry.amount_in_minor_units END,
    updated_at = NOW()
  WHERE id = v_entry.supplier_id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_SUPPLIER_OPENING_REVERSED', 'supplier_opening_balances', v_entry.id,
    jsonb_build_object('entry_number', v_entry.entry_number, 'supplier_id', v_entry.supplier_id,
      'direction', v_entry.direction, 'amount_in_minor_units', v_entry.amount_in_minor_units,
      'original_balance_date', v_entry.original_balance_date, 'reason', v_reason));
  RETURN jsonb_build_object('success', true, 'idempotentReplay', false, 'entryId', v_entry.id,
    'entryNumber', v_entry.entry_number, 'reversedAt', v_entry.reversed_at);
END;
$$;
ALTER FUNCTION public.reverse_supplier_opening_balance_v1(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reverse_supplier_opening_balance_v1(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_opening_balance_v1(UUID, TEXT) TO authenticated;

CREATE FUNCTION public.get_go_live_supplier_openings_v1(p_page INTEGER DEFAULT 1, p_page_size INTEGER DEFAULT 25)
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
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عرض أرصدة الموردين الافتتاحية');
  IF v_page NOT BETWEEN 1 AND 100000 OR v_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'رقم الصفحة أو حجمها غير صالح.';
  END IF;
  RETURN jsonb_build_object(
    'page', v_page, 'pageSize', v_size,
    'totalCount', (SELECT COUNT(*) FROM public.supplier_opening_balances),
    'payableTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
      FROM public.supplier_opening_balances WHERE NOT is_reversed AND direction = 'payable'),
    'advanceTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
      FROM public.supplier_opening_balances WHERE NOT is_reversed AND direction = 'advance'),
    'entries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', b.id, 'entryNumber', b.entry_number, 'supplierId', b.supplier_id,
      'supplierName', s.company_name, 'direction', b.direction,
      'amountInMinorUnits', b.amount_in_minor_units, 'originalBalanceDate', b.original_balance_date,
      'notes', b.notes, 'createdAt', b.created_at, 'isReversed', b.is_reversed,
      'reversedAt', b.reversed_at, 'reversalReason', b.reversal_reason)
      ORDER BY b.created_at DESC, b.entry_number DESC)
      FROM (SELECT * FROM public.supplier_opening_balances
        ORDER BY created_at DESC, entry_number DESC
        OFFSET (v_page - 1) * v_size LIMIT v_size) b
      JOIN public.suppliers s ON s.id = b.supplier_id), '[]'::JSONB));
END;
$$;
ALTER FUNCTION public.get_go_live_supplier_openings_v1(INTEGER, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_go_live_supplier_openings_v1(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_go_live_supplier_openings_v1(INTEGER, INTEGER) TO authenticated;

-- 133 evidence equation, complete explicit body plus active opening rows.
-- The integrity monitor compares this to the stored supplier balance.
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
  ), invoices AS (SELECT supplier_id,SUM(amount) amount FROM received GROUP BY supplier_id),
  payments AS (SELECT supplier_id,SUM(amount_in_minor_units::NUMERIC) amount
    FROM public.supplier_payments WHERE NOT is_reversed GROUP BY supplier_id)
  SELECT s.id,(COALESCE(i.amount,0)-COALESCE(p.amount,0))::BIGINT FROM public.suppliers s
  LEFT JOIN invoices i ON i.supplier_id=s.id LEFT JOIN payments p ON p.supplier_id=s.id;
$$;
ALTER FUNCTION public.phase133_supplier_balance_evidence_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.phase133_supplier_balance_evidence_internal() FROM PUBLIC,anon,authenticated,service_role;

-- 160 progress counters, complete explicit body extended with both ledgers.
CREATE OR REPLACE FUNCTION public.go_live_setup_counts_internal()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'products', jsonb_build_object(
      'activeCount', (SELECT COUNT(*) FROM public.products WHERE is_active AND NOT is_flavor_master),
      'importedCount', (SELECT COALESCE(SUM(row_count), 0) FROM public.go_live_import_batches
        WHERE batch_kind = 'products')),
    'stock', jsonb_build_object(
      'stockableCount', (SELECT COUNT(*) FROM public.products WHERE is_active AND NOT is_flavor_master),
      'countedProductCount', (SELECT COUNT(DISTINCT product_id) FROM public.inventory_opening_items),
      'sessionCount', (SELECT COUNT(*) FROM public.inventory_opening_sessions)),
    'customers', jsonb_build_object(
      'customerCount', (SELECT COUNT(*) FROM public.customers WHERE NOT is_deleted),
      'withOpeningCount', (SELECT COUNT(DISTINCT customer_id) FROM public.customer_opening_balances
        WHERE NOT is_reversed),
      'activeEntryCount', (SELECT COUNT(*) FROM public.customer_opening_balances WHERE NOT is_reversed),
      'activeTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
        FROM public.customer_opening_balances WHERE NOT is_reversed)),
    'suppliers', jsonb_build_object(
      'supplierCount', (SELECT COUNT(*) FROM public.suppliers WHERE is_active),
      'withOpeningCount', (SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_opening_balances
        WHERE NOT is_reversed),
      'payableTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
        FROM public.supplier_opening_balances WHERE NOT is_reversed AND direction = 'payable'),
      'advanceTotalInMinorUnits', (SELECT COALESCE(SUM(amount_in_minor_units), 0)
        FROM public.supplier_opening_balances WHERE NOT is_reversed AND direction = 'advance'))
  );
$$;
ALTER FUNCTION public.go_live_setup_counts_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_setup_counts_internal() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.supplier_opening_balances IS
  'Go-live supplier opening balances (payable له / advance عليه) at their original date. Reflected in suppliers.current_balance and the 133 evidence equation; immutable; one audited reversal.';

COMMIT;
