BEGIN;

-- Owner16/17Oct: entered opening balances are NET of these instruments.
-- Registration creates follow-up evidence only: never a payment or balance write.
ALTER TABLE public.go_live_import_batches DROP CONSTRAINT go_live_import_batches_batch_kind_check;
ALTER TABLE public.go_live_import_batches ADD CONSTRAINT go_live_import_batches_batch_kind_check
  CHECK(batch_kind IN ('products','customer_opening','supplier_opening','opening_cheques'));

CREATE FUNCTION public.go_live_cheque_party_internal(p_kind TEXT,p_id TEXT,p_phone TEXT,p_name TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id UUID:=NULLIF(btrim(p_id),'')::UUID;v_phone TEXT:=NULLIF(btrim(p_phone),'');
  v_name TEXT:=NULLIF(public.go_live_normalize_name_internal(p_name),'');v_count BIGINT;v_result UUID;
BEGIN
  IF v_id IS NULL AND v_phone IS NULL AND v_name IS NULL THEN RAISE EXCEPTION 'حدد الطرف الموجود في النظام.';END IF;
  IF p_kind='customer' THEN
    SELECT count(*),min(id::TEXT)::UUID INTO v_count,v_result FROM public.customers
    WHERE NOT is_deleted AND(v_id IS NULL OR id=v_id) AND(v_phone IS NULL OR phone=v_phone)
      AND(v_name IS NULL OR public.go_live_normalize_name_internal(full_name)=v_name);
  ELSIF p_kind='supplier' THEN
    SELECT count(*),min(id::TEXT)::UUID INTO v_count,v_result FROM public.suppliers
    WHERE(v_id IS NULL OR id=v_id) AND(v_phone IS NULL OR phone=v_phone)
      AND(v_name IS NULL OR public.go_live_normalize_name_internal(company_name)=v_name);
  ELSE RAISE EXCEPTION 'نوع الطرف غير صالح.';END IF;
  IF v_count<>1 THEN RAISE EXCEPTION 'الطرف غير موجود أو غير فريد؛ صحح الاسم والهاتف أو اختره من القائمة.';END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.go_live_cheque_party_internal(TEXT,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_cheque_party_internal(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.go_live_cheque_rows_internal(p_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row JSONB;v_plan JSONB:='[]';v_errors JSONB:='[]';v_keys JSONB:='{}';
  v_index INTEGER:=0;v_source INTEGER;v_customer UUID;v_supplier UUID;v_endorsed UUID;
  v_direction TEXT;v_status TEXT;v_bank TEXT;v_number TEXT;v_amount BIGINT;
  v_due DATE;v_original DATE;v_cheque_date DATE;v_debt_at TIMESTAMPTZ;v_party RECORD;v_key TEXT;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'أدخل من سطر واحد إلى 500 سطر في الدفعة.';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_index:=v_index+1;v_source:=v_index;
    BEGIN
      IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'السطر غير صالح.';END IF;
      IF v_row ? 'sourceRow' THEN
        IF COALESCE(v_row->>'sourceRow','') !~ '^[1-9][0-9]{0,6}$' THEN RAISE EXCEPTION 'رقم السطر غير صالح.';END IF;
        v_source:=(v_row->>'sourceRow')::INTEGER;
      END IF;
      IF (v_row-ARRAY['sourceRow','direction','initial_status','bank_name','cheque_number','due_date','amount_in_minor_units',
        'customer_id','customer_phone','customer_name','supplier_id','supplier_name','endorsed_supplier_id','endorsed_supplier_name',
        'original_debt_date','cheque_date','notes'])<>'{}'::JSONB THEN RAISE EXCEPTION 'السطر يحتوي حقولاً غير معتمدة.';END IF;
      v_direction:=v_row->>'direction';v_status:=COALESCE(NULLIF(btrim(v_row->>'initial_status'),''),'pending');
      IF v_direction IS NULL OR v_direction NOT IN ('incoming','outgoing') OR v_status NOT IN ('pending','endorsed')
        OR(v_status='endorsed' AND v_direction<>'incoming') THEN RAISE EXCEPTION 'اختر وارد أو صادر، وقيد الانتظار أو وارد مجيّر فقط.';END IF;
      v_bank:=NULLIF(btrim(v_row->>'bank_name'),'');v_number:=NULLIF(btrim(v_row->>'cheque_number'),'');
      IF v_bank IS NULL OR char_length(v_bank)>120 OR v_number IS NULL OR char_length(v_number)>80 THEN
        RAISE EXCEPTION 'اسم البنك ورقم الشيك مطلوبان ضمن الطول المسموح.';END IF;
      IF COALESCE(v_row->>'amount_in_minor_units','') !~ '^[1-9][0-9]{0,11}$' THEN RAISE EXCEPTION 'مبلغ موجب صحيح بالفلس مطلوب.';END IF;
      v_amount:=(v_row->>'amount_in_minor_units')::BIGINT;
      IF COALESCE(v_row->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الاستحقاق مطلوب بصيغة سنة-شهر-يوم.';END IF;
      v_due:=(v_row->>'due_date')::DATE;v_original:=NULL;v_cheque_date:=NULL;
      IF NULLIF(btrim(v_row->>'original_debt_date'),'') IS NOT NULL THEN
        IF(v_row->>'original_debt_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الدين الأصلي غير صالح.';END IF;
        v_original:=(v_row->>'original_debt_date')::DATE;
      END IF;
      IF NULLIF(btrim(v_row->>'cheque_date'),'') IS NOT NULL THEN
        IF(v_row->>'cheque_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'تاريخ الشيك غير صالح.';END IF;
        v_cheque_date:=(v_row->>'cheque_date')::DATE;
      END IF;
      v_debt_at:=COALESCE(v_original,v_cheque_date)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
      IF char_length(COALESCE(v_row->>'notes',''))>500 THEN RAISE EXCEPTION 'الملاحظة لا تتجاوز 500 حرف.';END IF;
      v_customer:=NULL;v_supplier:=NULL;v_endorsed:=NULL;
      IF v_direction='incoming' THEN
        IF NULLIF(btrim(v_row->>'supplier_id'),'') IS NOT NULL OR NULLIF(btrim(v_row->>'supplier_name'),'') IS NOT NULL THEN
          RAISE EXCEPTION 'الوارد يرتبط بالزبون؛ استخدم حقل المورد المجيّر له عند الحاجة.';END IF;
        v_customer:=public.go_live_cheque_party_internal('customer',v_row->>'customer_id',v_row->>'customer_phone',v_row->>'customer_name');
        IF v_status='endorsed' THEN
          v_endorsed:=public.go_live_cheque_party_internal('supplier',v_row->>'endorsed_supplier_id',NULL,v_row->>'endorsed_supplier_name');
        ELSIF NULLIF(btrim(v_row->>'endorsed_supplier_id'),'') IS NOT NULL OR NULLIF(btrim(v_row->>'endorsed_supplier_name'),'') IS NOT NULL THEN
          RAISE EXCEPTION 'اختر حالة مجيّر عند تحديد مورد التجيير.';
        END IF;
      ELSE
        IF NULLIF(btrim(v_row->>'customer_id'),'') IS NOT NULL OR NULLIF(btrim(v_row->>'customer_phone'),'') IS NOT NULL
          OR NULLIF(btrim(v_row->>'customer_name'),'') IS NOT NULL OR NULLIF(btrim(v_row->>'endorsed_supplier_id'),'') IS NOT NULL
          OR NULLIF(btrim(v_row->>'endorsed_supplier_name'),'') IS NOT NULL THEN RAISE EXCEPTION 'الصادر يرتبط بمورد واحد فقط.';END IF;
        v_supplier:=public.go_live_cheque_party_internal('supplier',v_row->>'supplier_id',NULL,v_row->>'supplier_name');
      END IF;
      FOR v_party IN SELECT 'customer'::TEXT kind,v_customer id WHERE v_customer IS NOT NULL
        UNION ALL SELECT 'supplier',COALESCE(v_supplier,v_endorsed) WHERE COALESCE(v_supplier,v_endorsed) IS NOT NULL LOOP
        v_key:=v_party.kind||':'||v_party.id::TEXT||':'||lower(v_bank)||':'||v_number;
        IF v_keys ? v_key OR EXISTS(SELECT 1 FROM public.cheque_party_keys k WHERE k.party_kind=v_party.kind
          AND k.party_id=v_party.id AND k.bank_key=lower(v_bank) AND k.cheque_number=v_number) THEN
          RAISE EXCEPTION 'الشيك مكرر للطرف والبنك والرقم؛ يشمل ذلك الشيكات المسجلة سابقاً.';END IF;
        v_keys:=v_keys||jsonb_build_object(v_key,true);
      END LOOP;
      v_plan:=v_plan||jsonb_build_array(jsonb_build_object('sourceRow',v_source,'direction',v_direction,'status',v_status,
        'bank',v_bank,'number',v_number,'dueDate',v_due,'amount',v_amount,'customerId',v_customer,'supplierId',v_supplier,
        'endorsedSupplierId',v_endorsed,'originalDebtAt',v_debt_at,'originalDebtDate',v_original,'chequeDate',v_cheque_date,
        'notes',NULLIF(btrim(v_row->>'notes'),'')));
    EXCEPTION WHEN OTHERS THEN
      v_errors:=v_errors||jsonb_build_array(jsonb_build_object('row',v_source,'message',
        CASE WHEN SQLSTATE IN ('22007','22008') THEN 'تاريخ غير صالح؛ استخدم سنة-شهر-يوم.'
          WHEN SQLSTATE='22P02' THEN 'معرف الطرف غير صالح.' ELSE SQLERRM END));
    END;
  END LOOP;
  RETURN jsonb_build_object('rows',v_plan,'errors',v_errors,'rowCount',jsonb_array_length(p_rows),'validCount',jsonb_array_length(v_plan));
END;
$$;
ALTER FUNCTION public.go_live_cheque_rows_internal(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_cheque_rows_internal(JSONB) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.preview_go_live_cheques_v1(p_branch_id UUID,p_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_plan JSONB;v_parties JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'معاينة الشيكات القائمة قبل التشغيل');
  IF p_branch_id IS NULL OR p_branch_id IS DISTINCT FROM public.go_live_main_branch_internal() THEN
    RAISE EXCEPTION 'GO_LIVE_MAIN_BRANCH_REQUIRED: اختر الفرع الرئيسي لبداية التشغيل أولاً.';END IF;
  v_plan:=public.go_live_cheque_rows_internal(p_rows);
  WITH proposed AS (
    SELECT 'customer'::TEXT kind,(r->>'customerId')::UUID id,(r->>'amount')::BIGINT amount
    FROM jsonb_array_elements(v_plan->'rows') r WHERE r->>'customerId' IS NOT NULL
    UNION ALL SELECT 'supplier',COALESCE(r->>'supplierId',r->>'endorsedSupplierId')::UUID,(r->>'amount')::BIGINT
    FROM jsonb_array_elements(v_plan->'rows') r WHERE COALESCE(r->>'supplierId',r->>'endorsedSupplierId') IS NOT NULL
  ), parties AS(SELECT kind,id,SUM(amount)::BIGINT proposed FROM proposed GROUP BY kind,id), totals AS(
    SELECT p.*,CASE WHEN kind='customer' THEN(SELECT full_name FROM public.customers WHERE id=p.id)
      ELSE(SELECT company_name FROM public.suppliers WHERE id=p.id) END name,
      CASE WHEN kind='customer' THEN COALESCE((SELECT SUM(amount_in_minor_units) FROM public.customer_opening_balances WHERE customer_id=p.id AND NOT is_reversed),0)
      ELSE COALESCE((SELECT SUM(CASE direction WHEN 'payable' THEN amount_in_minor_units ELSE -amount_in_minor_units END)
        FROM public.supplier_opening_balances WHERE supplier_id=p.id AND NOT is_reversed),0) END entered,
      COALESCE((SELECT SUM(q.amount_in_minor_units) FROM public.deferred_cheques q WHERE q.origin='opening' AND q.status IN ('pending','endorsed')
        AND((p.kind='customer' AND q.customer_id=p.id) OR(p.kind='supplier' AND COALESCE(q.supplier_id,q.endorsed_supplier_id)=p.id))),0) existing
    FROM parties p
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'name',name,
      'enteredInMinorUnits',entered,'existingChequesInMinorUnits',existing,'proposedChequesInMinorUnits',proposed,
      'chequesInMinorUnits',existing+proposed,'beforeChequesInMinorUnits',entered+existing+proposed) ORDER BY kind,id),'[]'::JSONB)
    INTO v_parties FROM totals;
  RETURN v_plan||jsonb_build_object('branchId',p_branch_id,'parties',v_parties,'balanceEffectInMinorUnits',0);
END;
$$;
ALTER FUNCTION public.preview_go_live_cheques_v1(UUID,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preview_go_live_cheques_v1(UUID,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_go_live_cheques_v1(UUID,JSONB) TO authenticated;

CREATE FUNCTION public.go_live_guard_opening_cheque_internal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.origin='opening' THEN
    PERFORM public.assert_erp_role(ARRAY['owner'],'تسجيل شيك قائم قبل التشغيل');
    PERFORM public.go_live_assert_setup_open_internal();
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.go_live_guard_opening_cheque_internal() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.go_live_guard_opening_cheque_internal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_go_live_opening_cheque_lock BEFORE INSERT ON public.deferred_cheques
FOR EACH ROW EXECUTE FUNCTION public.go_live_guard_opening_cheque_internal();

CREATE FUNCTION public.record_go_live_cheques_v1(p_branch_id UUID,p_idempotency_key TEXT,p_rows JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_envelope JSONB:=jsonb_build_array(jsonb_build_object('branch',p_branch_id,'rows',p_rows));
  v_replay JSONB;v_plan JSONB;v_locked_rows JSONB;v_row JSONB;v_party RECORD;v_id UUID;v_index INTEGER:=0;v_created JSONB:='[]';v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'تسجيل الشيكات القائمة قبل التشغيل');
  v_replay:=public.go_live_begin_batch_internal('opening_cheques',p_idempotency_key,v_envelope);
  IF EXISTS(SELECT 1 FROM public.go_live_import_batches WHERE idempotency_key=p_idempotency_key AND created_by<>auth.uid()) THEN
    RAISE EXCEPTION 'GO_LIVE_BATCH_KEY_CONFLICT: المفتاح يخص عملية لفاعل آخر.';END IF;
  IF v_replay IS NOT NULL THEN RETURN v_replay;END IF;
  PERFORM public.go_live_assert_setup_open_internal();
  -- Discover all parties before row locks. Same customer gate as collection;
  -- supplier rows are locked in UUID order before any cheque row is created.
  v_plan:=public.preview_go_live_cheques_v1(p_branch_id,p_rows);
  IF jsonb_array_length(v_plan->'errors')>0 THEN RAISE EXCEPTION USING MESSAGE='GO_LIVE_CHEQUE_ROWS_INVALID: صحح الأسطر قبل الحفظ.',DETAIL=(v_plan->'errors')::TEXT;END IF;
  v_locked_rows:=v_plan->'rows';
  FOR v_party IN SELECT DISTINCT (r->>'customerId')::UUID id FROM jsonb_array_elements(v_plan->'rows') r
    WHERE r->>'customerId' IS NOT NULL ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('go-live-collection-customer:'||v_party.id::TEXT,0));
  END LOOP;
  FOR v_party IN SELECT DISTINCT (r->>'customerId')::UUID id FROM jsonb_array_elements(v_plan->'rows') r
    WHERE r->>'customerId' IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM public.customers WHERE id=v_party.id AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'العميل غير موجود أو حُذف؛ أعد المعاينة.';END IF;
  END LOOP;
  FOR v_party IN SELECT DISTINCT COALESCE(r->>'supplierId',r->>'endorsedSupplierId')::UUID id FROM jsonb_array_elements(v_plan->'rows') r
    WHERE COALESCE(r->>'supplierId',r->>'endorsedSupplierId') IS NOT NULL ORDER BY id LOOP
    PERFORM 1 FROM public.suppliers WHERE id=v_party.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'المورد غير موجود؛ أعد المعاينة.';END IF;
  END LOOP;
  -- Revalidate duplicates under party gates;preview is never write authority.
  v_plan:=public.preview_go_live_cheques_v1(p_branch_id,p_rows);
  IF jsonb_array_length(v_plan->'errors')>0 THEN RAISE EXCEPTION USING MESSAGE='GO_LIVE_CHEQUE_ROWS_INVALID: صحح الأسطر قبل الحفظ.',DETAIL=(v_plan->'errors')::TEXT;END IF;
  IF v_plan->'rows' IS DISTINCT FROM v_locked_rows THEN
    RAISE EXCEPTION 'GO_LIVE_CHEQUE_PARTIES_CHANGED: تغيّرت هوية الأطراف أثناء الحفظ؛ أعد المعاينة.';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_plan->'rows') LOOP
    v_index:=v_index+1;v_id:=gen_random_uuid();
    INSERT INTO public.deferred_cheques(id,tracking_number,direction,origin,cheque_number,bank_name,due_date,amount_in_minor_units,
      customer_id,supplier_id,endorsed_supplier_id,branch_id,status,original_debt_at,notes,created_by,changed_by)
    VALUES(v_id,'CHQ-'||lpad(nextval('public.deferred_cheque_number_seq')::TEXT,8,'0'),v_row->>'direction','opening',
      v_row->>'number',v_row->>'bank',(v_row->>'dueDate')::DATE,(v_row->>'amount')::BIGINT,
      (v_row->>'customerId')::UUID,(v_row->>'supplierId')::UUID,(v_row->>'endorsedSupplierId')::UUID,p_branch_id,
      v_row->>'status',(v_row->>'originalDebtAt')::TIMESTAMPTZ,v_row->>'notes',auth.uid(),auth.uid());
    FOR v_party IN SELECT 'customer'::TEXT kind,(v_row->>'customerId')::UUID id WHERE v_row->>'customerId' IS NOT NULL
      UNION ALL SELECT 'supplier',COALESCE(v_row->>'supplierId',v_row->>'endorsedSupplierId')::UUID
        WHERE COALESCE(v_row->>'supplierId',v_row->>'endorsedSupplierId') IS NOT NULL LOOP
      INSERT INTO public.cheque_party_keys(party_kind,party_id,bank_key,cheque_number,cheque_id)
      VALUES(v_party.kind,v_party.id,lower(v_row->>'bank'),v_row->>'number',v_id);
      INSERT INTO public.deferred_cheque_allocations(cheque_id,party_kind,party_id,origin_kind,origin_id,original_debt_at,amount_in_minor_units)
      VALUES(v_id,v_party.kind,v_party.id,'opening_cheque',v_id,(v_row->>'originalDebtAt')::TIMESTAMPTZ,(v_row->>'amount')::BIGINT);
    END LOOP;
    v_result:=public.cheque_finish_event_internal(v_id,'opening_registered',NULL,NULL,
      'opening-cheque-'||md5(p_idempotency_key)||'-'||v_index::TEXT,
      jsonb_build_object('action','opening_register','branch',p_branch_id,'batchKey',p_idempotency_key,'row',v_row));
    v_created:=v_created||jsonb_build_array(jsonb_build_object('id',v_id,'trackingNumber',v_result#>>'{cheque,tracking_number}'));
  END LOOP;
  v_result:=jsonb_build_object('success',true,'idempotentReplay',false,'created',v_created,'rowCount',v_index,
    'parties',v_plan->'parties','balanceEffectInMinorUnits',0);
  INSERT INTO public.go_live_import_batches(batch_kind,idempotency_key,request_hash,row_count,result,created_by)
  VALUES('opening_cheques',p_idempotency_key,md5(v_envelope::TEXT),v_index,v_result,auth.uid());
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.record_go_live_cheques_v1(UUID,TEXT,JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_go_live_cheques_v1(UUID,TEXT,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_go_live_cheques_v1(UUID,TEXT,JSONB) TO authenticated;

CREATE FUNCTION public.get_go_live_cheques_v1(p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_page INTEGER:=GREATEST(COALESCE(p_page,1),1);v_size INTEGER:=LEAST(GREATEST(COALESCE(p_page_size,25),1),100);v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'عرض الشيكات القائمة قبل التشغيل');
  WITH source AS MATERIALIZED(SELECT q.*,c.full_name customer_name,s.company_name supplier_name,e.company_name endorsed_supplier_name
    FROM public.deferred_cheques q LEFT JOIN public.customers c ON c.id=q.customer_id
    LEFT JOIN public.suppliers s ON s.id=q.supplier_id LEFT JOIN public.suppliers e ON e.id=q.endorsed_supplier_id WHERE q.origin='opening'),
  page_rows AS(SELECT * FROM source ORDER BY created_at DESC,id DESC OFFSET(v_page::BIGINT-1)*v_size LIMIT v_size)
  SELECT jsonb_build_object('page',v_page,'pageSize',v_size,'totalCount',(SELECT COUNT(*) FROM source),
    'hasMore',(SELECT COUNT(*) FROM source)>v_page::BIGINT*v_size,
    'entries',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'registration_txid'-'bank_key' ORDER BY created_at DESC,id DESC) FROM page_rows r),'[]'::JSONB),
    'incomingPendingInMinorUnits',COALESCE((SELECT SUM(amount_in_minor_units) FROM source WHERE direction='incoming' AND status='pending'),0),
    'outgoingPendingInMinorUnits',COALESCE((SELECT SUM(amount_in_minor_units) FROM source WHERE direction='outgoing' AND status='pending'),0),
    'endorsedInMinorUnits',COALESCE((SELECT SUM(amount_in_minor_units) FROM source WHERE status='endorsed'),0)) INTO v_result;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.get_go_live_cheques_v1(INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_go_live_cheques_v1(INTEGER,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_go_live_cheques_v1(INTEGER,INTEGER) TO authenticated;

-- Complete193 definition. Opening registration has no vouchers. A LATER
-- endorsement still uses the normal approved supplier payment exactly once.
CREATE OR REPLACE FUNCTION public.cheque_assert_integrity_internal(p_id UUID)
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_c public.deferred_cheques%ROWTYPE;v_e public.deferred_cheque_events%ROWTYPE;v_supplier UUID;
BEGIN
  SELECT * INTO STRICT v_c FROM public.deferred_cheques WHERE id=p_id;
  SELECT * INTO v_e FROM public.deferred_cheque_events WHERE cheque_id=p_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND OR v_e.version<>v_c.version OR v_e.resulting_status<>v_c.status OR v_e.actor_id<>v_c.changed_by
    OR(SELECT COUNT(*) FROM public.deferred_cheque_events WHERE cheque_id=p_id)<>v_c.version THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: الحالة والأحداث غير متطابقة.';
  END IF;
  v_supplier:=COALESCE(v_c.endorsed_supplier_id,v_c.supplier_id);
  IF(v_c.customer_id IS NOT NULL AND COALESCE((SELECT SUM(amount_in_minor_units) FROM public.deferred_cheque_allocations
      WHERE cheque_id=p_id AND party_kind='customer' AND party_id=v_c.customer_id),0)<>v_c.amount_in_minor_units)
    OR(v_supplier IS NOT NULL AND COALESCE((SELECT SUM(amount_in_minor_units) FROM public.deferred_cheque_allocations
      WHERE cheque_id=p_id AND party_kind='supplier' AND party_id=v_supplier),0)<>v_c.amount_in_minor_units)
    OR EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a WHERE a.cheque_id=p_id AND
      ((a.party_kind='customer' AND a.party_id IS DISTINCT FROM v_c.customer_id)
       OR(a.party_kind='supplier' AND a.party_id IS DISTINCT FROM v_supplier))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: تخصيص الشيك لا يطابق المبلغ أو الطرف.';
  END IF;
  IF(v_c.origin='operational' AND v_c.direction='incoming' AND NOT EXISTS(
    SELECT 1 FROM public.customer_collection_operations o WHERE o.id=v_c.collection_operation_id
      AND o.customer_id=v_c.customer_id AND o.amount_in_minor_units=v_c.amount_in_minor_units AND o.payment_method='cheque'
      AND NOT o.is_reversed AND o.cash_shift_id IS NULL))
    OR(v_c.origin='opening' AND v_c.collection_operation_id IS NOT NULL)
    OR(v_c.origin='opening' AND NOT EXISTS(SELECT 1 FROM public.deferred_cheque_events e
      WHERE e.cheque_id=v_c.id AND e.version=1 AND e.kind='opening_registered'
        AND e.request_identity->>'action'='opening_register'))
    OR(v_c.origin='opening' AND v_c.supplier_payment_id IS NOT NULL AND NOT(
      v_c.direction='incoming' AND v_c.endorsed_supplier_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.deferred_cheque_events e WHERE e.cheque_id=v_c.id AND e.kind='endorsed' AND e.version=2)
      AND EXISTS(SELECT 1 FROM public.supplier_payments p WHERE p.id=v_c.supplier_payment_id AND p.supplier_id=v_supplier
        AND p.amount_in_minor_units=v_c.amount_in_minor_units AND p.payment_method='cheque' AND NOT p.is_reversed
        AND p.cash_shift_id IS NULL AND p.purchase_order_id IS NULL)))
    OR(v_c.origin='operational' AND v_supplier IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.supplier_payments p WHERE p.id=v_c.supplier_payment_id AND p.supplier_id=v_supplier
        AND p.amount_in_minor_units=v_c.amount_in_minor_units AND p.payment_method='cheque' AND NOT p.is_reversed
        AND p.cash_shift_id IS NULL
        AND p.purchase_order_id IS NOT DISTINCT FROM(SELECT (e.request_identity->>'purchaseOrder')::UUID
          FROM public.deferred_cheque_events e WHERE e.cheque_id=v_c.id AND e.kind='issued' AND e.version=1))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: سند الشيك غير مطابق.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a
    LEFT JOIN public.customer_collection_order_payments l ON l.operation_id=v_c.collection_operation_id
      AND l.order_id=a.origin_id AND l.customer_payment_id=a.customer_payment_id
    LEFT JOIN public.customer_payments p ON p.id=a.customer_payment_id
    WHERE a.cheque_id=p_id AND a.party_kind='customer' AND a.origin_kind='order'
      AND(l.customer_payment_id IS NULL OR l.amount_in_minor_units<>a.amount_in_minor_units OR p.is_reversed
        OR p.payment_method<>'cheque' OR p.customer_id<>a.party_id OR p.amount_in_minor_units<>a.amount_in_minor_units)) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: رابط دفعة الطلب غير مطابق.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deferred_cheque_allocations a LEFT JOIN public.cheque_compensation_claims c ON c.source_allocation_id=a.id
    WHERE a.cheque_id=p_id AND(
      (v_c.status IN ('returned','cancelled') AND(c.id IS NULL OR c.cheque_id<>p_id OR c.party_kind<>a.party_kind
        OR c.party_id<>a.party_id OR c.claim_kind<>v_c.status OR c.amount_in_minor_units<>a.amount_in_minor_units
        OR c.original_debt_at IS DISTINCT FROM a.original_debt_at OR c.origin_kind<>a.origin_kind OR c.reason IS DISTINCT FROM v_e.reason))
      OR(v_c.status NOT IN ('returned','cancelled') AND c.id IS NOT NULL))) THEN
    RAISE EXCEPTION 'CHEQUE_EVIDENCE_MISMATCH: القيود التعويضية لا تطابق الأصول.';
  END IF;
  IF v_supplier IS NOT NULL AND(SELECT current_balance_in_minor_units FROM public.suppliers WHERE id=v_supplier)
    IS DISTINCT FROM(SELECT balance FROM public.phase133_supplier_balance_evidence_internal() WHERE supplier_id=v_supplier) THEN
    RAISE EXCEPTION 'CHEQUE_SUPPLIER_EVIDENCE_MISMATCH';
  END IF;
END;
$$;
ALTER FUNCTION public.cheque_assert_integrity_internal(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cheque_assert_integrity_internal(UUID) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
