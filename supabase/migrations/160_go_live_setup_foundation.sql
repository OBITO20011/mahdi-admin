BEGIN;

-- Go-live setup ("بداية التشغيل"), owner-approved 2026-10-15.
-- One singleton lock row. After the owner finishes setup, the DATABASE (not
-- only the UI) rejects every opening write: opening stock sessions (047),
-- customer opening debts (161), supplier opening balances (162) and the
-- setup product import. The lock is one-way; no RPC or update can reopen it.
-- Owner decision 2026-10-15: an owner-only, reasoned reversal of an existing
-- opening entry stays allowed after finish; NEW opening entries never are.
-- Opening customer debt is attributed to the main branch (main_branch_id),
-- chosen before finish or, with exactly one active branch, that branch.
-- Explicit full definitions only; no historical function body is copied.

CREATE TABLE public.go_live_setup_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  finished_at TIMESTAMPTZ,
  finished_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  main_branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT go_live_setup_state_finish_pair
    CHECK ((finished_at IS NULL) = (finished_by IS NULL))
);
INSERT INTO public.go_live_setup_state(id) VALUES (true);

ALTER TABLE public.go_live_setup_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.go_live_setup_state FROM PUBLIC, anon, authenticated;
ALTER TABLE public.go_live_setup_state OWNER TO postgres;

CREATE FUNCTION public.go_live_guard_setup_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_STATE_IMMUTABLE: لا يمكن حذف حالة بداية التشغيل.';
  END IF;
  IF OLD.finished_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_SETUP_FINISHED: تم إنهاء بداية التشغيل نهائياً ولا يمكن إعادة فتحها.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_STATE_IMMUTABLE: لا يمكن تعديل هوية حالة بداية التشغيل.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_setup_state() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_setup_state() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_go_live_setup_state_guard
BEFORE UPDATE OR DELETE ON public.go_live_setup_state
FOR EACH ROW EXECUTE FUNCTION public.go_live_guard_setup_state();

CREATE FUNCTION public.go_live_reject_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'GO_LIVE_STATE_IMMUTABLE: لا يمكن تفريغ سجلات بداية التشغيل.';
END;
$$;
ALTER FUNCTION public.go_live_reject_truncate() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_reject_truncate() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_go_live_setup_state_no_truncate
BEFORE TRUNCATE ON public.go_live_setup_state
FOR EACH STATEMENT EXECUTE FUNCTION public.go_live_reject_truncate();

-- Writers take a SHARE lock on the singleton; the finisher takes FOR UPDATE.
-- A finish therefore waits for in-flight opening writes, and every write that
-- starts after the finish commits observes the lock and fails closed.
CREATE FUNCTION public.go_live_assert_setup_open_internal()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_finished_at TIMESTAMPTZ;
BEGIN
  SELECT finished_at INTO STRICT v_finished_at
  FROM public.go_live_setup_state WHERE id FOR SHARE;
  IF v_finished_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_SETUP_FINISHED: تم إنهاء بداية التشغيل؛ لا يُقبل أي إدخال افتتاحي بعد الآن.';
  END IF;
END;
$$;
ALTER FUNCTION public.go_live_assert_setup_open_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_assert_setup_open_internal() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.go_live_reject_opening_write_after_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.go_live_assert_setup_open_internal();
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_reject_opening_write_after_finish() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_reject_opening_write_after_finish() FROM PUBLIC, anon, authenticated, service_role;

-- Opening stock (047) is an opening entry: after finish only documented
-- stock counts, receiving and transfers may change inventory.
CREATE TRIGGER trg_inventory_opening_sessions_go_live_lock
BEFORE INSERT OR UPDATE ON public.inventory_opening_sessions
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_opening_write_after_finish();
CREATE TRIGGER trg_inventory_opening_items_go_live_lock
BEFORE INSERT OR UPDATE ON public.inventory_opening_items
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_opening_write_after_finish();

-- Opening stock is valued at the product cost snapshot (047 items). Receiving
-- (113) already treats a NULL exact WAC as cost_price, but configurable parcel
-- sales (114/132) require a non-NULL exact WAC. Seed it from the same opening
-- cost only when it was never set: no reported value changes (valuation reads
-- COALESCE(exact, cost_price)), and an existing exact WAC is never overwritten.
CREATE FUNCTION public.go_live_seed_exact_wac_from_opening()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.actual_quantity > 0 AND NEW.cost_price_in_minor_units > 0 THEN
    UPDATE public.products
    SET wac_cost_in_minor_units_exact = NEW.cost_price_in_minor_units::NUMERIC, updated_at = NOW()
    WHERE id = NEW.product_id AND wac_cost_in_minor_units_exact IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION public.go_live_seed_exact_wac_from_opening() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_seed_exact_wac_from_opening() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_inventory_opening_items_seed_exact_wac
AFTER INSERT ON public.inventory_opening_items
FOR EACH ROW EXECUTE FUNCTION public.go_live_seed_exact_wac_from_opening();

-- Idempotency ledger for setup batches. A replay with the same key and the
-- same canonical payload returns the stored result; a different payload under
-- the same key is rejected instead of silently writing twice.
CREATE TABLE public.go_live_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_kind TEXT NOT NULL CHECK (batch_kind IN ('products', 'customer_opening', 'supplier_opening')),
  idempotency_key TEXT NOT NULL UNIQUE
    CHECK (CHAR_LENGTH(idempotency_key) BETWEEN 16 AND 120),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{32}$'),
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 500),
  result JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_go_live_import_batches_kind_created
  ON public.go_live_import_batches(batch_kind, created_at DESC);
ALTER TABLE public.go_live_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.go_live_import_batches FROM PUBLIC, anon, authenticated;
ALTER TABLE public.go_live_import_batches OWNER TO postgres;

CREATE FUNCTION public.go_live_reject_batch_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001',
    MESSAGE = 'GO_LIVE_BATCH_IMMUTABLE: دفعات بداية التشغيل سجل دائم لا يُعدّل ولا يُحذف.';
END;
$$;
ALTER FUNCTION public.go_live_reject_batch_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_reject_batch_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_go_live_import_batches_immutable
BEFORE UPDATE OR DELETE ON public.go_live_import_batches
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_batch_mutation();
CREATE TRIGGER trg_go_live_import_batches_no_truncate
BEFORE TRUNCATE ON public.go_live_import_batches
FOR EACH STATEMENT EXECUTE FUNCTION public.go_live_reject_truncate();
CREATE TRIGGER trg_go_live_import_batches_lock
BEFORE INSERT ON public.go_live_import_batches
FOR EACH ROW EXECUTE FUNCTION public.go_live_reject_opening_write_after_finish();

-- Shared request validation and replay lookup. Returns the stored result for
-- an equal replay, NULL for a new key, and rejects a conflicting reuse.
CREATE FUNCTION public.go_live_begin_batch_internal(
  p_kind TEXT, p_idempotency_key TEXT, p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key TEXT := NULLIF(BTRIM(p_idempotency_key), '');
  v_existing public.go_live_import_batches%ROWTYPE;
BEGIN
  IF v_key IS NULL OR CHAR_LENGTH(v_key) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'مفتاح منع التكرار للدفعة غير صالح.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'الدفعة يجب أن تحتوي من 1 إلى 500 سطر.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('go-live-batch:' || v_key, 0));
  SELECT * INTO v_existing FROM public.go_live_import_batches WHERE idempotency_key = v_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_existing.batch_kind <> p_kind OR v_existing.request_hash <> md5(p_rows::TEXT) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_BATCH_KEY_CONFLICT: مفتاح الدفعة استُخدم سابقاً لبيانات مختلفة؛ أعد المعاينة.';
  END IF;
  RETURN v_existing.result || jsonb_build_object('idempotentReplay', true);
END;
$$;
ALTER FUNCTION public.go_live_begin_batch_internal(TEXT, TEXT, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_begin_batch_internal(TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

-- Unit by exact code (case-insensitive) first, else by a UNIQUE Arabic name.
-- NULL when missing or ambiguous; the caller reports the row error.
CREATE FUNCTION public.go_live_resolve_unit_internal(p_value TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.units WHERE upper(code) = upper(BTRIM(p_value))),
    (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id::TEXT)::UUID END
      FROM public.units WHERE name_ar = BTRIM(p_value)));
$$;
ALTER FUNCTION public.go_live_resolve_unit_internal(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_resolve_unit_internal(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- Excel-friendly product import. Each row creates one ordinary wholesale
-- product through the existing create_product_with_opening_stock_v4 path
-- (zero stock; stock only enters via the opening-stock card). Category and
-- units are matched by exact Arabic name. Flavor families stay in the product
-- tools. Dry run validates every row without writing; a real run is atomic.
CREATE FUNCTION public.import_go_live_products_v1(
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
  v_sku TEXT;
  v_barcode TEXT;
  v_name TEXT;
  v_category_id UUID;
  v_unit_id UUID;
  v_purchase_unit_id UUID;
  v_sale_unit_id UUID;
  v_units_per_purchase INTEGER;
  v_units_per_sale INTEGER;
  v_sale_price BIGINT;
  v_purchase_price BIGINT;
  v_cost BIGINT;
  v_min_stock INTEGER;
  v_count INTEGER;
  v_created JSONB := '[]'::JSONB;
  v_product JSONB;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'استيراد منتجات بداية التشغيل');
  PERFORM public.go_live_assert_setup_open_internal();
  IF NOT COALESCE(p_dry_run, false) THEN
    v_replay := public.go_live_begin_batch_internal('products', p_idempotency_key, p_rows);
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
    v_error := NULL;
    v_sku := NULLIF(BTRIM(v_row->>'sku'), '');
    v_barcode := NULLIF(BTRIM(v_row->>'barcode'), '');
    v_name := NULLIF(BTRIM(v_row->>'name_ar'), '');
    v_category_id := NULL; v_unit_id := NULL; v_purchase_unit_id := NULL; v_sale_unit_id := NULL;

    IF jsonb_typeof(v_row) <> 'object' THEN
      v_error := 'بيانات السطر غير صحيحة.';
    ELSIF v_sku IS NULL OR CHAR_LENGTH(v_sku) > 64 THEN
      v_error := 'رمز الصنف SKU مطلوب وبحد أقصى 64 حرفاً.';
    ELSIF v_name IS NULL OR CHAR_LENGTH(v_name) > 200 THEN
      v_error := 'اسم المنتج مطلوب وبحد أقصى 200 حرف.';
    ELSIF v_barcode IS NOT NULL AND CHAR_LENGTH(v_barcode) > 64 THEN
      v_error := 'الباركود أطول من المسموح.';
    ELSIF COALESCE(v_row->>'units_per_purchase_unit', '') !~ '^[1-9][0-9]{0,5}$'
      OR COALESCE(v_row->>'units_per_sale_unit', '') !~ '^[1-9][0-9]{0,5}$' THEN
      v_error := 'عدد الحبات داخل الطرد يجب أن يكون رقماً صحيحاً أكبر من صفر.';
    ELSIF COALESCE(v_row->>'sale_package_price_in_minor_units', '') !~ '^[1-9][0-9]{0,11}$' THEN
      v_error := 'سعر بيع الطرد يجب أن يكون أكبر من صفر.';
    ELSIF COALESCE(v_row->>'purchase_package_price_in_minor_units', '') !~ '^[0-9]{1,12}$'
      OR COALESCE(v_row->>'cost_per_base_unit_in_minor_units', '') !~ '^[0-9]{1,12}$'
      OR COALESCE(v_row->>'min_stock_level', '0') !~ '^[0-9]{1,9}$' THEN
      v_error := 'الأسعار والحد الأدنى يجب أن تكون أرقاماً موجبة صحيحة.';
    END IF;

    IF v_error IS NULL THEN
      SELECT COUNT(*), MIN(id::TEXT)::UUID INTO v_count, v_category_id FROM public.categories
      WHERE is_active AND name_ar = BTRIM(v_row->>'category_name');
      IF v_count <> 1 THEN
        v_error := CASE WHEN v_count = 0 THEN 'القسم غير موجود؛ أضفه أولاً أو صحّح اسمه.'
          ELSE 'اسم القسم مكرر؛ صحّح الأقسام أولاً.' END;
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_unit_id := public.go_live_resolve_unit_internal(v_row->>'base_unit_name');
      IF v_unit_id IS NULL THEN
        v_error := 'الوحدة الصغرى غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل PKT).';
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_purchase_unit_id := public.go_live_resolve_unit_internal(v_row->>'purchase_unit_name');
      IF v_purchase_unit_id IS NULL THEN
        v_error := 'وحدة طرد الشراء غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل CTN).';
      END IF;
    END IF;
    IF v_error IS NULL THEN
      v_sale_unit_id := public.go_live_resolve_unit_internal(v_row->>'sale_unit_name');
      IF v_sale_unit_id IS NULL THEN
        v_error := 'وحدة طرد البيع غير موجودة أو اسمها مكرر؛ اكتب رمز الوحدة (مثل CTN).';
      END IF;
    END IF;
    IF v_error IS NULL AND EXISTS (SELECT 1 FROM public.products WHERE lower(sku) = lower(v_sku)) THEN
      v_error := 'رمز SKU مستخدم لمنتج موجود.';
    END IF;
    IF v_error IS NULL AND v_barcode IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.products WHERE barcode = v_barcode) THEN
      v_error := 'الباركود مستخدم لمنتج موجود.';
    END IF;
    IF v_error IS NULL AND (
      SELECT COUNT(*) FROM jsonb_array_elements(p_rows) other
      WHERE lower(BTRIM(other->>'sku')) = lower(v_sku)) > 1 THEN
      v_error := 'رمز SKU مكرر داخل الملف.';
    END IF;
    IF v_error IS NULL AND v_barcode IS NOT NULL AND (
      SELECT COUNT(*) FROM jsonb_array_elements(p_rows) other
      WHERE BTRIM(other->>'barcode') = v_barcode) > 1 THEN
      v_error := 'الباركود مكرر داخل الملف.';
    END IF;

    IF v_error IS NOT NULL THEN
      v_errors := v_errors || jsonb_build_object('row', v_n, 'message', v_error);
      CONTINUE;
    END IF;
    IF COALESCE(p_dry_run, false) THEN
      CONTINUE;
    END IF;

    v_units_per_purchase := (v_row->>'units_per_purchase_unit')::INTEGER;
    v_units_per_sale := (v_row->>'units_per_sale_unit')::INTEGER;
    v_sale_price := (v_row->>'sale_package_price_in_minor_units')::BIGINT;
    v_purchase_price := (v_row->>'purchase_package_price_in_minor_units')::BIGINT;
    v_cost := (v_row->>'cost_per_base_unit_in_minor_units')::BIGINT;
    v_min_stock := COALESCE((v_row->>'min_stock_level')::INTEGER, 0);
    BEGIN
      v_product := public.create_product_with_opening_stock_v4(
        v_sku, v_barcode, v_name, NULL, v_category_id, NULL, v_unit_id,
        v_purchase_unit_id, v_units_per_purchase, v_purchase_price,
        v_sale_unit_id, v_units_per_sale, v_sale_price, v_cost, v_min_stock,
        NULL, NULL, 0, 'تعريف منتج من بداية التشغيل', NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'GO_LIVE_ROW_FAILED: السطر ' || v_n || ': ' || SQLERRM;
    END;
    v_created := v_created || jsonb_build_object('row', v_n, 'productId', v_product->>'product_id', 'sku', v_sku);
  END LOOP;

  IF COALESCE(p_dry_run, false) THEN
    RETURN jsonb_build_object('success', true, 'dryRun', true, 'rowCount', v_n,
      'validCount', v_n - jsonb_array_length(v_errors), 'errors', v_errors);
  END IF;
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_BATCH_INVALID: الملف يحتوي أسطراً غير صالحة؛ لم يُحفظ أي سطر.',
      DETAIL = v_errors::TEXT;
  END IF;

  v_result := jsonb_build_object('success', true, 'dryRun', false, 'idempotentReplay', false,
    'kind', 'products', 'rowCount', v_n, 'created', v_created);
  INSERT INTO public.go_live_import_batches(batch_kind, idempotency_key, request_hash, row_count, result, created_by)
  VALUES ('products', BTRIM(p_idempotency_key), md5(p_rows::TEXT), v_n, v_result, v_user_id);
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_IMPORT_PRODUCTS', 'go_live_import_batches', NULL,
    jsonb_build_object('idempotency_key', BTRIM(p_idempotency_key), 'row_count', v_n,
      'skus', (SELECT jsonb_agg(c->>'sku') FROM jsonb_array_elements(v_created) c)));
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.import_go_live_products_v1(TEXT, JSONB, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.import_go_live_products_v1(TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_go_live_products_v1(TEXT, JSONB, BOOLEAN) TO authenticated;

-- Main branch for opening-debt attribution: the stored choice, else the only
-- active branch. NULL when several active branches exist and none was chosen.
CREATE FUNCTION public.go_live_main_branch_internal()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT main_branch_id FROM public.go_live_setup_state WHERE id),
    (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id::TEXT)::UUID END FROM public.branches WHERE is_active));
$$;
ALTER FUNCTION public.go_live_main_branch_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_main_branch_internal() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.set_go_live_main_branch_v1(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'تحديد الفرع الرئيسي لبداية التشغيل');
  PERFORM public.go_live_assert_setup_open_internal();
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch_id AND is_active) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو غير نشط.';
  END IF;
  UPDATE public.go_live_setup_state SET main_branch_id = p_branch_id WHERE id;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (auth.uid(), 'GO_LIVE_MAIN_BRANCH_SET', 'branches', p_branch_id, '{}'::JSONB);
  RETURN jsonb_build_object('success', true, 'mainBranchId', p_branch_id);
END;
$$;
ALTER FUNCTION public.set_go_live_main_branch_v1(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_go_live_main_branch_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_go_live_main_branch_v1(UUID) TO authenticated;

-- One-way finish. Requires the exact Arabic confirmation phrase. A repeat
-- call after finish is a read-only replay that reports the original finish.
CREATE FUNCTION public.finish_go_live_setup_v1(p_confirmation TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_state public.go_live_setup_state%ROWTYPE;
  v_main_branch UUID;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'إنهاء بداية التشغيل');
  SELECT * INTO STRICT v_state FROM public.go_live_setup_state WHERE id FOR UPDATE;
  IF v_state.finished_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'idempotentReplay', true,
      'finishedAt', v_state.finished_at, 'finishedBy', v_state.finished_by);
  END IF;
  IF BTRIM(COALESCE(p_confirmation, '')) <> 'إنهاء بداية التشغيل' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_CONFIRMATION_REQUIRED: اكتب عبارة التأكيد "إنهاء بداية التشغيل" حرفياً.';
  END IF;
  v_main_branch := public.go_live_main_branch_internal();
  IF v_main_branch IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'GO_LIVE_MAIN_BRANCH_REQUIRED: اختر الفرع الرئيسي الذي تُنسب إليه الديون الافتتاحية قبل الإنهاء.';
  END IF;
  UPDATE public.go_live_setup_state
  SET finished_at = NOW(), finished_by = v_user_id, main_branch_id = v_main_branch
  WHERE id RETURNING * INTO v_state;
  INSERT INTO public.audit_logs(user_id, action, entity_name, entity_id, details)
  VALUES (v_user_id, 'GO_LIVE_SETUP_FINISHED', 'go_live_setup_state', NULL,
    jsonb_build_object('finished_at', v_state.finished_at, 'main_branch_id', v_state.main_branch_id,
      'status', public.go_live_setup_counts_internal()));
  RETURN jsonb_build_object('success', true, 'idempotentReplay', false,
    'finishedAt', v_state.finished_at, 'finishedBy', v_state.finished_by);
END;
$$;

-- Progress counters only; no money or stock is derived here.
CREATE FUNCTION public.go_live_setup_counts_internal()
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
      'sessionCount', (SELECT COUNT(*) FROM public.inventory_opening_sessions))
  );
$$;
ALTER FUNCTION public.go_live_setup_counts_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_setup_counts_internal() FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.finish_go_live_setup_v1(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finish_go_live_setup_v1(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_go_live_setup_v1(TEXT) TO authenticated;

CREATE FUNCTION public.get_go_live_setup_status_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state public.go_live_setup_state%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'], 'عرض بداية التشغيل');
  SELECT * INTO STRICT v_state FROM public.go_live_setup_state WHERE id;
  RETURN jsonb_build_object('success', true,
    'finished', v_state.finished_at IS NOT NULL,
    'finishedAt', v_state.finished_at,
    'finishedByName', (SELECT full_name FROM public.profiles WHERE id = v_state.finished_by),
    'mainBranchId', public.go_live_main_branch_internal(),
    'mainBranchName', (SELECT name_ar FROM public.branches WHERE id = public.go_live_main_branch_internal()),
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name_ar) ORDER BY name_ar, id)
      FROM public.branches WHERE is_active), '[]'::JSONB))
    || public.go_live_setup_counts_internal();
END;
$$;
ALTER FUNCTION public.get_go_live_setup_status_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_go_live_setup_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_go_live_setup_status_v1() TO authenticated;

COMMENT ON TABLE public.go_live_setup_state IS
  'Singleton one-way go-live setup lock. After finished_at is set the database rejects all opening writes.';
COMMENT ON FUNCTION public.import_go_live_products_v1(TEXT, JSONB, BOOLEAN) IS
  'Owner-only setup product import via create_product_with_opening_stock_v4 (zero stock). Dry run validates; real run is atomic and idempotent per key.';
COMMENT ON FUNCTION public.finish_go_live_setup_v1(TEXT) IS
  'Owner-only, one-way go-live setup finish with exact Arabic confirmation; audited.';

COMMIT;
