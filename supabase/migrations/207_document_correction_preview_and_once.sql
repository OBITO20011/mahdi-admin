BEGIN;

-- Approved Phase C7: read-only document preview and a durable, keyed envelope
-- around the EXISTING four writers. No existing writer, trigger or ACL changes.
CREATE FUNCTION public.correction207_assert_role_internal(p_action TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_action IN ('pos_sale','supplier_payment') THEN
    RETURN public.assert_reversal_owner('تصحيح مستند مالي');
  ELSIF p_action='customer_payment' THEN
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant'],'عكس سند قبض عميل');
  ELSIF p_action='purchase_receipt' THEN
    PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','warehouse_keeper'],'إلغاء سند استلام أمر شراء');
  ELSE RAISE EXCEPTION 'CORRECTION_ACTION_INVALID: إجراء التصحيح غير معتمد.';
  END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'CORRECTION_AUTH_REQUIRED'; END IF;
  RETURN auth.uid();
END; $$;

CREATE FUNCTION public.get_document_correction_preview(p_action TEXT,p_record_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  o public.orders%ROWTYPE; cp public.customer_payments%ROWTYPE;
  sp public.supplier_payments%ROWTYPE; pr public.purchase_receipts%ROWTYPE;
  sr public.supplier_receipts%ROWTYPE; po public.purchase_orders%ROWTYPE;
  blocked TEXT; ref TEXT; shift_id UUID; method TEXT; amount BIGINT:=0;
  cash_delta BIGINT:=0; cliq_delta BIGINT:=0; customer_delta BIGINT:=0;
  supplier_delta BIGINT:=0; units BIGINT:=0; payments BIGINT:=0;
  stock JSONB:='[]'::JSONB; effect JSONB; facts JSONB:='{}'::JSONB; result JSONB;
BEGIN
  PERFORM public.correction207_assert_role_internal(p_action);
  IF p_record_id IS NULL THEN RAISE EXCEPTION 'CORRECTION_RECORD_REQUIRED'; END IF;
  IF p_action='pos_sale' THEN
    SELECT * INTO o FROM public.orders WHERE id=p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORRECTION_RECORD_NOT_FOUND: الفاتورة غير موجودة.'; END IF;
    ref:=o.order_number;shift_id:=o.cash_shift_id;method:=o.payment_method;amount:=o.total_in_minor_units;
    IF o.source IS DISTINCT FROM 'pos' OR o.status<>'completed' THEN blocked:='الفاتورة ليست بيع POS مكتملاً قابلاً للعكس.';
    ELSIF EXISTS(SELECT 1 FROM public.pos_sale_reversals WHERE order_id=o.id) THEN blocked:='تم عكس البيع مسبقاً.';
    ELSIF EXISTS(SELECT 1 FROM public.customer_payments WHERE order_id=o.id)
      OR EXISTS(SELECT 1 FROM public.sales_returns WHERE order_id=o.id) THEN blocked:='توجد دفعة أو مرتجع مرتبط بالبيع.';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.product_id,r.order_item_id,r.parcel_component_id),'[]'),
      COALESCE(SUM(r.base_quantity),0) INTO stock,units
    FROM public.phase3_pos_reversal_inventory_rows_internal(o.id) r;
    IF blocked IS NULL AND units=0 THEN blocked:='لا توجد حقيقة مخزون قابلة للعكس.'; END IF;
    IF blocked IS NULL AND EXISTS(SELECT 1 FROM public.phase3_pos_reversal_inventory_rows_internal(o.id) r
      JOIN public.inventory_movements m ON m.product_id=r.product_id AND m.warehouse_id=o.warehouse_id
      WHERE m.reference_id IS DISTINCT FROM o.id AND m.created_at>=o.created_at) THEN blocked:='توجد حركة مخزون لاحقة على أحد أصناف البيع.'; END IF;
    IF blocked IS NULL AND EXISTS(SELECT 1 FROM public.phase3_pos_reversal_inventory_rows_internal(o.id) r
      LEFT JOIN public.inventory_balances b ON b.product_id=r.product_id AND b.warehouse_id=o.warehouse_id
      WHERE b.product_id IS NULL OR b.reserved_quantity<>0) THEN blocked:='مخزون أحد الأصناف غير متاح أو محجوز.'; END IF;
    cash_delta:=CASE WHEN method='cash' THEN -amount ELSE 0 END;
    cliq_delta:=CASE WHEN method='cliq' THEN -amount ELSE 0 END;
    customer_delta:=CASE WHEN method='debt' THEN -amount ELSE 0 END;
    facts:=jsonb_build_object('order',to_jsonb(o),'stock',stock);
  ELSIF p_action='customer_payment' THEN
    SELECT * INTO cp FROM public.customer_payments WHERE id=p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORRECTION_RECORD_NOT_FOUND: سند القبض غير موجود.'; END IF;
    SELECT * INTO o FROM public.orders WHERE id=cp.order_id;
    ref:=cp.payment_number;shift_id:=cp.cash_shift_id;method:=cp.payment_method;amount:=cp.amount_in_minor_units;
    IF cp.is_reversed THEN blocked:='تم عكس سند القبض مسبقاً.';
    ELSIF o.id IS NULL OR o.status<>'completed' THEN blocked:='لا يمكن عكس الدفعة إلا لطلب مكتمل قائم.';
    ELSIF COALESCE(o.payment_method,'cash_on_delivery')<>'debt' THEN blocked:='لا يمكن عكس قبض لطلب مكتمل غير آجل؛ العكس غير مدعوم.';
    ELSIF EXISTS(SELECT 1 FROM public.customer_collection_order_payments WHERE customer_payment_id=cp.id) THEN blocked:='هذا السند جزء من تحصيل موحد؛ يعكس التحصيل كاملاً من مساره.';
    ELSIF cp.payment_method IN ('cheque','check') OR EXISTS(SELECT 1 FROM public.deferred_cheque_allocations WHERE customer_payment_id=cp.id) THEN blocked:='أصل الشيك ثابت؛ التصحيح من مسار الشيك المعتمد.';
    END IF;
    cash_delta:=CASE WHEN method='cash' THEN -amount ELSE 0 END;
    cliq_delta:=CASE WHEN method='cliq' THEN -amount ELSE 0 END;customer_delta:=amount;
    facts:=jsonb_build_object('payment',to_jsonb(cp),'order',to_jsonb(o));
  ELSIF p_action='supplier_payment' THEN
    SELECT * INTO sp FROM public.supplier_payments WHERE id=p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORRECTION_RECORD_NOT_FOUND: دفعة المورد غير موجودة.'; END IF;
    ref:=COALESCE(NULLIF(btrim(sp.reference_number),''),'دفعة المورد');shift_id:=sp.cash_shift_id;method:=sp.payment_method;amount:=sp.amount_in_minor_units;
    IF sp.is_reversed THEN blocked:='تم عكس دفعة المورد مسبقاً.';
    ELSIF sp.payment_method IN ('cheque','check') OR EXISTS(SELECT 1 FROM public.deferred_cheques WHERE supplier_payment_id=sp.id) THEN blocked:='أصل الشيك ثابت؛ التصحيح من مسار الشيك المعتمد.';
    ELSIF EXISTS(SELECT 1 FROM public.supplier_cheque_claim_payments WHERE supplier_payment_id=sp.id)
      OR EXISTS(SELECT 1 FROM public.supplier_opening_payments WHERE supplier_payment_id=sp.id) THEN blocked:='هذه دفعة افتتاحية أو تعويض شيك؛ استخدم مسارها المعتمد.';
    ELSIF (sp.supplier_receipt_id IS NULL)=(sp.purchase_order_id IS NULL) THEN blocked:='الدفعة لا تحمل مرجعاً مالياً واحداً قابلاً للعكس.';
    END IF;
    IF sp.supplier_receipt_id IS NOT NULL THEN
      SELECT * INTO sr FROM public.supplier_receipts WHERE id=sp.supplier_receipt_id;
      IF blocked IS NULL AND (sr.id IS NULL OR sr.status<>'completed' OR sr.supplier_id<>sp.supplier_id OR sr.amount_paid_in_minor_units<amount) THEN blocked:='سند المورد أو رصيد دفعاته لم يعد صالحاً للعكس.'; END IF;
    ELSE
      SELECT * INTO po FROM public.purchase_orders WHERE id=sp.purchase_order_id;
      IF blocked IS NULL AND (po.id IS NULL OR po.supplier_id<>sp.supplier_id OR po.amount_paid_in_minor_units<amount) THEN blocked:='أمر الشراء أو رصيد دفعاته لم يعد صالحاً للعكس.'; END IF;
    END IF;
    cash_delta:=CASE WHEN method='cash' THEN amount ELSE 0 END;
    cliq_delta:=CASE WHEN method='cliq' THEN amount ELSE 0 END;supplier_delta:=amount;
    facts:=jsonb_build_object('payment',to_jsonb(sp),'receipt',to_jsonb(sr),'purchaseOrder',to_jsonb(po));
  ELSE
    SELECT * INTO pr FROM public.purchase_receipts WHERE id=p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORRECTION_RECORD_NOT_FOUND: سند الاستلام غير موجود.'; END IF;
    SELECT * INTO po FROM public.purchase_orders WHERE id=pr.purchase_order_id;
    ref:=pr.receipt_number;
    IF pr.phase2_finalized_at IS NULL OR pr.status<>'completed' THEN blocked:='سند الاستلام ليس سند Phase2 مكتملاً قابلاً للإلغاء.';
    ELSIF EXISTS(SELECT 1 FROM public.supplier_payments WHERE purchase_receipt_id=pr.id AND NOT is_reversed AND operation_id IS DISTINCT FROM pr.operation_id) THEN blocked:='للسند دفعات لاحقة؛ إلغاؤها يحتاج سياسة مستقلة معتمدة.';
    END IF;
    SELECT COALESCE(SUM(amount_in_minor_units),0),
      COALESCE(SUM(amount_in_minor_units) FILTER(WHERE payment_method='cash'),0),
      COALESCE(SUM(amount_in_minor_units) FILTER(WHERE payment_method='cliq'),0)
    INTO payments,cash_delta,cliq_delta FROM public.supplier_payments WHERE purchase_receipt_id=pr.id AND NOT is_reversed;
    supplier_delta:=-pr.supplier_invoice_payable_total_snapshot_in_minor_units+payments;
    SELECT -COALESCE(SUM(quantity),0) INTO units FROM public.inventory_movements WHERE operation_id=pr.operation_id AND movement_type='purchase_receipt';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',s.product_id,'productName',p.name_ar,'baseUnits',-s.received_base_quantity,
      'wacBefore',p.wac_cost_in_minor_units_exact,'wacAfter',CASE WHEN s.opening_global_quantity=0 THEN NULL ELSE s.prior_exact_wac_in_minor_units END)
      ORDER BY s.product_id),'[]') INTO stock FROM public.phase2_receipt_wac_snapshots s JOIN public.products p ON p.id=s.product_id WHERE s.operation_id=pr.operation_id;
    IF blocked IS NULL AND EXISTS(SELECT 1 FROM public.phase2_receipt_wac_snapshots s
      JOIN public.products p ON p.id=s.product_id LEFT JOIN public.inventory_balances b ON b.product_id=s.product_id AND b.warehouse_id=pr.warehouse_id
      WHERE s.operation_id=pr.operation_id AND (p.wac_cost_in_minor_units_exact IS DISTINCT FROM s.resulting_exact_wac_in_minor_units
        OR p.cost_price_in_minor_units IS DISTINCT FROM s.resulting_legacy_wac_in_minor_units
        OR (SELECT COALESCE(SUM(on_hand_quantity),0) FROM public.inventory_balances WHERE product_id=s.product_id) IS DISTINCT FROM s.opening_global_quantity+s.received_base_quantity
        OR COALESCE(b.on_hand_quantity,0)-s.received_base_quantity<COALESCE(b.reserved_quantity,0)
        OR EXISTS(SELECT 1 FROM public.inventory_movements m WHERE m.product_id=s.product_id AND m.mutation_sequence>s.receipt_movement_sequence_max))) THEN blocked:='تحرك المخزون أو تغير WAC بعد السند؛ الإلغاء غير آمن.'; END IF;
    facts:=jsonb_build_object('receipt',to_jsonb(pr),'purchaseOrder',to_jsonb(po),'stock',stock,'payments',
      (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.supplier_payments p WHERE p.purchase_receipt_id=pr.id));
  END IF;
  -- PO cancellation deliberately preserves its existing closed-payment-shift
  -- semantics. Customer legacy NULL shift remains NULL; no fictitious shift.
  IF p_action IN ('pos_sale','supplier_payment') AND shift_id IS NULL AND blocked IS NULL THEN blocked:='المستند غير مرتبط بوردية صريحة.'; END IF;
  IF shift_id IS NOT NULL THEN
    facts:=facts||jsonb_build_object('shift',(SELECT jsonb_build_object('id',id,'status',status) FROM public.cash_shifts WHERE id=shift_id));
    IF blocked IS NULL AND NOT EXISTS(SELECT 1 FROM public.cash_shifts WHERE id=shift_id AND status='open') THEN blocked:='لا يمكن العكس على وردية مغلقة.'; END IF;
  END IF;
  effect:=jsonb_build_object('cashInMinorUnits',cash_delta,'cliqInMinorUnits',cliq_delta,
    'customerDebtInMinorUnits',customer_delta,'supplierBalanceInMinorUnits',supplier_delta,
    'inventoryBaseUnits',units,'paymentMethod',method,'paymentInMinorUnits',amount,'stock',stock);
  result:=jsonb_build_object('contractVersion',207,'action',p_action,'recordId',p_record_id,'reference',ref,
    'eligible',blocked IS NULL,'blockedReason',blocked,'cashShiftId',shift_id,'effect',effect);
  RETURN result||jsonb_build_object('fingerprint',encode(extensions.digest((result||jsonb_build_object('facts',facts))::TEXT,'sha256'),'hex'));
END; $$;

CREATE UNIQUE INDEX uq_document_correction207_key ON public.business_operations(initiated_by,idempotency_key)
WHERE operation_type='document_correction207';

CREATE FUNCTION public.execute_document_correction_once(p_action TEXT,p_record_id UUID,p_reason TEXT,p_idempotency_key TEXT,p_preview_fingerprint TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor UUID; k TEXT:=NULLIF(btrim(p_idempotency_key),''); reason TEXT:=NULLIF(btrim(p_reason),'');
  request_hash TEXT; existing public.business_operations%ROWTYPE; preview JSONB; result JSONB;
  o public.orders%ROWTYPE; cp public.customer_payments%ROWTYPE; locked_cp public.customer_payments%ROWTYPE;
  shift_id UUID; product_ids UUID[];
BEGIN
  actor:=public.correction207_assert_role_internal(p_action);
  PERFORM set_config('lock_timeout','3s',true);
  PERFORM set_config('statement_timeout','30s',true);
  IF p_record_id IS NULL OR reason IS NULL OR char_length(reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'CORRECTION_REASON_INVALID: اكتب سبباً من3 إلى500 حرف.'; END IF;
  IF k IS NULL OR char_length(k) NOT BETWEEN 16 AND 200 THEN RAISE EXCEPTION 'CORRECTION_KEY_INVALID'; END IF;
  IF p_preview_fingerprint IS NULL OR p_preview_fingerprint!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CORRECTION_PREVIEW_REQUIRED'; END IF;
  request_hash:=encode(extensions.digest(jsonb_build_object('action',p_action,'recordId',p_record_id,'reason',reason,'preview',p_preview_fingerprint)::TEXT,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('document-correction207-key:'||actor::TEXT||':'||k,0));
  SELECT * INTO existing FROM public.business_operations WHERE operation_type='document_correction207' AND initiated_by=actor AND idempotency_key=k;
  IF FOUND THEN
    IF existing.request_fingerprint IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'CORRECTION_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN existing.result_snapshot||jsonb_build_object('idempotent',true);
  END IF;
  -- Acquire the canonical writer's lock hierarchy BEFORE comparing displayed
  -- facts. Its own relationship validation/locks and all triggers still run.
  IF p_action='pos_sale' THEN
    SELECT * INTO o FROM public.orders WHERE id=p_record_id;shift_id:=o.cash_shift_id;
    IF shift_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('cash-shift-full-reversal:'||shift_id::TEXT,0)); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('pos-sale-reversal:'||p_record_id::TEXT,0));
    PERFORM 1 FROM public.cash_shifts WHERE id=shift_id FOR UPDATE;
    PERFORM 1 FROM public.orders WHERE id=p_record_id FOR UPDATE;
    SELECT array_agg(DISTINCT product_id ORDER BY product_id) INTO product_ids FROM public.phase3_pos_reversal_inventory_rows_internal(p_record_id);
    IF cardinality(product_ids)>0 THEN PERFORM public.phase3_lock_inventory_products_internal(product_ids); END IF;
  ELSIF p_action='customer_payment' THEN
    SELECT * INTO cp FROM public.customer_payments WHERE id=p_record_id;
    IF cp.order_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('phase4-order|'||cp.order_id::TEXT,0)); END IF;
    PERFORM 1 FROM public.cash_shifts WHERE id=cp.cash_shift_id FOR UPDATE;
    PERFORM 1 FROM public.orders WHERE id=cp.order_id FOR UPDATE;
    SELECT * INTO locked_cp FROM public.customer_payments WHERE id=p_record_id FOR UPDATE;
    IF locked_cp.order_id IS DISTINCT FROM cp.order_id OR locked_cp.cash_shift_id IS DISTINCT FROM cp.cash_shift_id THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PHASE4_LOCK_PLAN_CHANGED_RETRY: Customer Payment relationship changed.';
    END IF;
  ELSIF p_action='supplier_payment' THEN
    PERFORM public.phase4_lock_supplier_context_internal(NULL,NULL,p_record_id);
  ELSE
    PERFORM public.phase4_lock_supplier_context_internal(NULL,p_record_id,NULL);
  END IF;
  preview:=public.get_document_correction_preview(p_action,p_record_id);
  IF preview->>'fingerprint' IS DISTINCT FROM p_preview_fingerprint THEN RAISE EXCEPTION 'CORRECTION_PREVIEW_STALE: تغير المستند؛ راجع المعاينة الجديدة وأكد مجدداً.'; END IF;
  IF NOT (preview->>'eligible')::BOOLEAN THEN RAISE EXCEPTION 'CORRECTION_BLOCKED: %',preview->>'blockedReason'; END IF;
  CASE p_action
    WHEN 'pos_sale' THEN result:=public.reverse_pos_sale(p_record_id,reason,k);
    WHEN 'customer_payment' THEN result:=public.reverse_customer_order_payment(p_record_id,reason);
    WHEN 'supplier_payment' THEN result:=public.reverse_supplier_payment(p_record_id,reason,k);
    WHEN 'purchase_receipt' THEN result:=public.cancel_purchase_receipt_v2(p_record_id,reason);
  END CASE;
  result:=jsonb_build_object('success',true,'contractVersion',207,'action',p_action,'recordId',p_record_id,
    'idempotent',false,'preview',preview,'writerResult',result);
  INSERT INTO public.business_operations(operation_type,initiated_by,idempotency_key,request_fingerprint,result_snapshot,completed_at)
  VALUES('document_correction207',actor,k,request_hash,result,NOW());
  RETURN result;
END; $$;

ALTER FUNCTION public.correction207_assert_role_internal(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.correction207_assert_role_internal(TEXT) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.get_document_correction_preview(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_document_correction_preview(TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_document_correction_preview(TEXT,UUID) TO authenticated;
ALTER FUNCTION public.execute_document_correction_once(TEXT,UUID,TEXT,TEXT,TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.execute_document_correction_once(TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_document_correction_once(TEXT,UUID,TEXT,TEXT,TEXT) TO authenticated;

COMMIT;
