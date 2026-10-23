-- Owner23Oct package R: read-only presentation metadata and damage history.
-- No writer,financial calculation,table policy or existing role grant changes.
BEGIN;
CREATE FUNCTION public.trial212_cash_metadata_internal(p_source TEXT,p_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE title TEXT; document_type TEXT; document_id UUID; v_order_id UUID; previews JSONB:='[]'; count_items BIGINT:=0;
BEGIN
 IF p_source='order' THEN v_order_id:=p_id;
 ELSIF p_source='customer_payment' THEN SELECT cp.order_id INTO v_order_id FROM public.customer_payments cp WHERE cp.id=p_id;
 ELSIF p_source='legacy_return' THEN SELECT r.order_id INTO v_order_id FROM public.sales_returns r WHERE r.id=p_id;
 ELSIF p_source='return_event' THEN SELECT r.order_id INTO v_order_id FROM public.sales_return_events r WHERE r.id=p_id;
 END IF;
 IF v_order_id IS NOT NULL THEN
  SELECT COALESCE(NULLIF(btrim(o.customer_name_snapshot),''),NULLIF(btrim(c.full_name),''),'زبون نقدي') INTO title
   FROM public.orders o LEFT JOIN public.customers c ON c.id=o.customer_id WHERE o.id=v_order_id;
  document_type:='order';document_id:=v_order_id;
  SELECT count(*) INTO count_items FROM public.order_items i WHERE i.order_id=v_order_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',i.product_name_snapshot,'quantity',
   CASE WHEN i.commercial_line_kind IN('legacy_single_sku_parcel','configurable_parcel') THEN COALESCE(i.sale_package_quantity,1) ELSE i.quantity END,
   'unit',CASE WHEN i.commercial_line_kind='configurable_parcel' THEN 'طرد مشكّل' WHEN i.commercial_line_kind='legacy_single_sku_parcel' THEN 'طرد' ELSE COALESCE(i.base_unit_name_snapshot,'حبة') END)
   ORDER BY i.created_at,i.id),'[]') INTO previews
   FROM(SELECT * FROM public.order_items oi WHERE oi.order_id=v_order_id ORDER BY oi.created_at,oi.id LIMIT 2) i;
 ELSIF p_source IN('opening_collection','cheque_collection') THEN
  SELECT c.full_name INTO title FROM public.customer_collection_operations co JOIN public.customers c ON c.id=co.customer_id WHERE co.id=p_id;
  document_type:='customer_collection';document_id:=p_id;
 ELSIF p_source IN('supplier_payment','supplier_opening_payment','supplier_cheque_payment') THEN
  SELECT s.company_name,CASE WHEN sp.supplier_receipt_id IS NOT NULL THEN 'supplier_receipt' WHEN sp.purchase_order_id IS NOT NULL THEN 'purchase_order' ELSE 'supplier_payment' END,
   COALESCE(sp.supplier_receipt_id,sp.purchase_order_id,sp.id) INTO title,document_type,document_id
   FROM public.supplier_payments sp JOIN public.suppliers s ON s.id=sp.supplier_id WHERE sp.id=p_id;
 ELSIF p_source='expense' THEN
  SELECT e.description INTO title FROM public.operational_expenses e WHERE e.id=p_id;document_type:='expense';document_id:=p_id;
 ELSIF p_source='owner_withdrawal' THEN title:='سحب مالك';document_type:='owner_withdrawal';document_id:=p_id;
 ELSIF p_source='owner_withdrawal_return' THEN title:='إرجاع سحب مالك';document_type:='owner_withdrawal_return';document_id:=p_id;
 ELSE RAISE EXCEPTION 'TRIAL212_CASH_SOURCE_INVALID';
 END IF;
 IF document_id IS NULL THEN RAISE EXCEPTION 'TRIAL212_CASH_DOCUMENT_MISSING'; END IF;
 RETURN jsonb_build_object('displayTitle',COALESCE(NULLIF(btrim(title),''),'مستند مسجّل'),'itemsPreview',previews,'itemCount',count_items,
  'document',jsonb_build_object('type',document_type,'id',document_id));
END $$;


ALTER FUNCTION public.trial212_cash_metadata_internal(TEXT,UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.trial212_cash_metadata_internal(TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_cash_shift_movement_page(
  p_shift_id UUID,
  p_kind TEXT,
  p_method TEXT DEFAULT 'cash',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_shift public.cash_shifts%ROWTYPE;
  v_summary JSONB;
  v_key TEXT;
  v_canonical BIGINT;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant'], 'عرض تفاصيل حركة الوردية');
  IF p_shift_id IS NULL OR p_kind IS NULL OR p_method IS NULL
    OR p_kind NOT IN ('sales','receipts','supplier_payments','expenses','refunds','withdrawals','withdrawal_returns')
    OR p_method NOT IN ('cash','cliq','card')
    OR (p_method='card' AND p_kind<>'sales')
    OR (p_kind IN ('withdrawals','withdrawal_returns') AND p_method<>'cash')
    OR p_page IS NULL OR p_page<1 OR p_page>1000000
    OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>100
  THEN RAISE EXCEPTION 'معايير تفاصيل الوردية غير صالحة.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id=p_shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الوردية المحددة غير موجودة.' USING ERRCODE='22023'; END IF;
  v_summary:=public.get_cash_shift_summary(p_shift_id);
  v_end:=CASE WHEN v_shift.status='open' THEN NOW() ELSE COALESCE(v_shift.closed_at,NOW()) END;
  v_key:=CASE p_kind
    WHEN 'sales' THEN p_method||'SalesInMinorUnits'
    WHEN 'receipts' THEN p_method||'ReceiptsInMinorUnits'
    WHEN 'supplier_payments' THEN p_method||'SupplierPaymentsInMinorUnits'
    WHEN 'expenses' THEN p_method||'ExpensesInMinorUnits'
    WHEN 'refunds' THEN p_method||'RefundsInMinorUnits'
    WHEN 'withdrawals' THEN 'ownerWithdrawalsInMinorUnits'
    WHEN 'withdrawal_returns' THEN 'ownerWithdrawalReturnsInMinorUnits' END;
  v_canonical:=(v_summary->>v_key)::BIGINT;
  -- 044 fallback attribution and 078 reversal predicates are retained exactly.
  -- In particular a legacy reversed receipt with NULL shift still belongs to
  -- the old aggregate; it is labelled, never silently corrected by this reader.
  WITH attributed_sales AS (
    SELECT o.id,o.order_number,o.payment_method,o.total_in_minor_units,
      COALESCE((SELECT MIN(h.created_at) FROM public.order_status_history h
        WHERE h.order_id=o.id AND h.new_status='completed'),o.updated_at) at,
      o.cash_shift_id
    FROM public.orders o WHERE p_kind='sales' AND o.branch_id=v_shift.branch_id
      AND o.status IN ('completed','returned')
      AND (o.payment_method::TEXT=p_method OR (p_method='cash' AND o.payment_method='cash_on_delivery'))
  ), evidence(source,id,reference,at,method,amount,note) AS (
    SELECT 'order'::TEXT,o.id,o.order_number,o.at,p_method,o.total_in_minor_units,NULL::TEXT
    FROM attributed_sales o WHERE o.cash_shift_id=p_shift_id OR
      (o.cash_shift_id IS NULL AND o.at>=v_shift.opened_at AND o.at<=v_end)
    UNION ALL
    SELECT 'customer_payment',cp.id,o.order_number,cp.created_at,cp.payment_method::TEXT,cp.amount_in_minor_units,
      CASE WHEN cp.is_reversed THEN 'سند تاريخي بلا وردية؛ محفوظ ضمن إجمالي القارئ القديم' END
    FROM public.customer_payments cp JOIN public.orders o ON o.id=cp.order_id
    WHERE p_kind='receipts' AND cp.payment_method::TEXT=p_method AND o.branch_id=v_shift.branch_id
      AND o.payment_method='debt' AND (cp.cash_shift_id=p_shift_id OR
        (cp.cash_shift_id IS NULL AND cp.created_at>=v_shift.opened_at AND cp.created_at<=v_end))
      AND NOT (COALESCE(cp.is_reversed,false) AND cp.cash_shift_id IS NOT NULL)
    UNION ALL
    SELECT 'opening_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.opening_amount_in_minor_units,'تحصيل دين البداية'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.opening_amount_in_minor_units>0
    UNION ALL
    SELECT 'cheque_collection',c.id,c.operation_number,c.created_at,c.payment_method::TEXT,c.compensation_amount_in_minor_units,'تحصيل تعويض شيك'
    FROM public.customer_collection_operations c WHERE p_kind='receipts' AND c.cash_shift_id=p_shift_id
      AND NOT c.is_reversed AND c.payment_method::TEXT=p_method AND c.compensation_amount_in_minor_units>0
    UNION ALL
    SELECT 'supplier_payment',sp.id,COALESCE(sr.receipt_number,po.purchase_order_number,sp.id::TEXT),sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,NULL::TEXT
    FROM public.supplier_payments sp LEFT JOIN public.purchase_orders po ON po.id=sp.purchase_order_id
      LEFT JOIN public.supplier_receipts sr ON sr.id=sp.supplier_receipt_id
    WHERE p_kind='supplier_payments' AND sp.payment_method::TEXT=p_method
      AND COALESCE(po.branch_id,sr.branch_id)=v_shift.branch_id AND NOT COALESCE(sp.is_reversed,false)
      AND (sp.cash_shift_id=p_shift_id OR (sp.cash_shift_id IS NULL AND sp.payment_date>=v_shift.opened_at AND sp.payment_date<=v_end))
    UNION ALL
    SELECT 'supplier_opening_payment',sp.id,sp.id::TEXT,sp.payment_date,sp.payment_method::TEXT,sp.amount_in_minor_units,'دفعة دين بداية لمورد'
    FROM public.supplier_opening_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT COALESCE(sp.is_reversed,false)
    UNION ALL
    SELECT 'supplier_cheque_payment',sp.id,c.reference,sp.payment_date,sp.payment_method::TEXT,l.amount_in_minor_units,'دفعة تعويض شيك لمورد'
    FROM public.supplier_cheque_claim_payments l JOIN public.supplier_payments sp ON sp.id=l.supplier_payment_id
      JOIN public.cheque_compensation_claims c ON c.id=l.claim_id
    WHERE p_kind='supplier_payments' AND l.cash_shift_id=p_shift_id AND sp.payment_method::TEXT=p_method AND NOT sp.is_reversed
    UNION ALL
    SELECT 'expense',e.id,e.expense_number,e.created_at,e.payment_method::TEXT,e.amount_in_minor_units,e.description
    FROM public.operational_expenses e WHERE p_kind='expenses' AND e.shift_id=p_shift_id
      AND e.payment_method::TEXT=p_method AND NOT COALESCE(e.is_reversed,false)
    UNION ALL
    SELECT 'legacy_return',r.id,r.return_number,r.created_at,r.refund_method::TEXT,r.refund_amount_in_minor_units,'مرتجع تاريخي'
    FROM public.sales_returns r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
    UNION ALL
    SELECT 'return_event',r.id,r.id::TEXT,r.created_at,r.refund_method::TEXT,r.money_refund_amount_in_minor_units,'مبلغ مسترد مسوّى'
    FROM public.sales_return_events r WHERE p_kind='refunds' AND r.cash_shift_id=p_shift_id AND r.refund_method::TEXT=p_method
      AND r.settlement_status='settled' AND r.money_refund_amount_in_minor_units>0
    UNION ALL
    SELECT 'owner_withdrawal',w.id,w.withdrawal_number,w.created_at,'cash',w.amount_in_minor_units,'سحب مالك'
    FROM public.owner_cash_withdrawals w WHERE p_kind='withdrawals' AND w.cash_shift_id=p_shift_id
    UNION ALL
    SELECT 'owner_withdrawal_return',r.id,w.withdrawal_number,r.reversed_at,'cash',r.amount_in_minor_units,
      'إرجاع سحب من '||s.shift_number
    FROM public.owner_cash_withdrawal_reversals r JOIN public.owner_cash_withdrawals w ON w.id=r.withdrawal_id
      JOIN public.cash_shifts s ON s.id=w.cash_shift_id
    WHERE p_kind='withdrawal_returns' AND r.effective_shift_id=p_shift_id AND r.voided_at IS NULL
  ), totals AS (
    SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount FROM evidence
  ), page AS (
    SELECT * FROM evidence ORDER BY at DESC,id DESC,source
    LIMIT p_page_size OFFSET ((p_page::BIGINT-1)*p_page_size)
  ) SELECT jsonb_build_object(
    'shiftId',p_shift_id,'kind',p_kind,'method',p_method,'generatedAt',NOW(),
    'shiftStatus',v_shift.status,'canonicalAmountInMinorUnits',v_canonical,
    'totalAmountInMinorUnits',totals.amount,'totalCount',totals.count,
    'page',p_page,'pageSize',p_page_size,'totalPages',GREATEST(1,CEIL(totals.count::NUMERIC/p_page_size)),
    'evidenceStatus',CASE WHEN v_canonical IS NULL THEN 'unavailable' WHEN v_canonical=totals.amount THEN 'matched' ELSE 'mismatch' END,
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object('source',source,'id',id,'reference',reference,
      'at',at,'method',method,'amountInMinorUnits',amount,'note',note)||public.trial212_cash_metadata_internal(source,id) ORDER BY at DESC,id DESC,source) FROM page),'[]'::JSONB)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_supplier_replacement_options_v1(p_action TEXT,p_product_search TEXT DEFAULT '',p_supplier_search TEXT DEFAULT '',p_product_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE products JSONB; suppliers JSONB; product_ids UUID[]; receiving JSONB;
BEGIN
 PERFORM public.sr208_assert_role_internal(p_action);
 IF p_action NOT IN('shop_pending','shop_immediate','shop_damage','customer_return') OR length(COALESCE(p_product_search,''))>200 OR length(COALESCE(p_supplier_search,''))>200 THEN RAISE EXCEPTION 'SUPPLIER_REPLACEMENT_OPTIONS_INVALID'; END IF;
 WITH candidates AS(SELECT p.*,(SELECT COALESCE(sum(b.available_quantity),0) FROM public.inventory_balances b JOIN public.warehouses w ON w.id=b.warehouse_id AND w.is_active JOIN public.branches br ON br.id=w.branch_id AND br.is_active WHERE b.product_id=p.id) picker_available FROM public.products p WHERE p.is_active AND NOT COALESCE(p.is_flavor_master,false)
  AND(p_product_id IS NULL OR p.id=p_product_id) AND(p_product_search IS NULL OR p_product_search='' OR p.name_ar ILIKE '%'||p_product_search||'%' OR p.sku ILIKE '%'||p_product_search||'%')
 ), page AS(SELECT * FROM candidates ORDER BY (picker_available>0) DESC,name_ar,id LIMIT 50)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name_ar,'sku',p.sku,'imageUrl',(SELECT image.image_url FROM public.product_images image WHERE image.product_id=p.id ORDER BY image.is_primary DESC,image.display_order,image.created_at,image.id LIMIT 1),'availableQuantity',p.picker_available,'baseUnitName',COALESCE(u.name_ar,'باكيت'),'unitsPerParcel',p.units_per_sale_unit) ORDER BY (p.picker_available>0) DESC,p.name_ar,p.id),'[]'),array_agg(p.id ORDER BY p.id)
 INTO products,product_ids FROM page p LEFT JOIN public.units u ON u.id=p.unit_id;
 IF cardinality(product_ids)>0 THEN receiving:=public.get_receiving_purchase_context(product_ids); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.company_name) ORDER BY s.company_name,s.id),'[]') INTO suppliers
 FROM(SELECT id,company_name FROM public.suppliers WHERE is_active AND(p_supplier_search IS NULL OR p_supplier_search='' OR company_name ILIKE '%'||p_supplier_search||'%') ORDER BY company_name,id LIMIT 100) s;
 RETURN jsonb_build_object('contractVersion',208,'products',products,'suppliers',CASE WHEN p_action='shop_damage' THEN '[]'::JSONB ELSE suppliers END,
  'warehouses',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',w.id,'branchId',w.branch_id,'name',w.name_ar) ORDER BY w.name_ar,w.id),'[]') FROM public.warehouses w JOIN public.branches b ON b.id=w.branch_id AND b.is_active WHERE w.is_active),
  'lastSuppliers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',x->>'productId','supplierId',x->'lastPurchase'->>'supplierId','supplierName',x->'lastPurchase'->>'supplierName')),'[]') FROM jsonb_array_elements(COALESCE(receiving->'products','[]')) x));
END $$;


CREATE FUNCTION public.get_damage_history_page_v1(
 p_period TEXT DEFAULT 'today',p_from_date DATE DEFAULT NULL,p_to_date DATE DEFAULT NULL,
 p_reason TEXT DEFAULT 'all',p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE owner_values BOOLEAN; from_at TIMESTAMPTZ; to_at TIMESTAMPTZ; today DATE;
 result JSONB; item RECORD; dto JSONB; entries JSONB:='[]'; case_dto JSONB; blocked TEXT;
BEGIN
 PERFORM public.sr208_assert_role_internal('read');owner_values:=public.has_erp_role(ARRAY['owner']);
 today:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;
 IF p_period IS NULL OR p_period NOT IN('today','week','month','range') OR p_reason IS NULL
  OR p_reason NOT IN('all','shop_breakage','expired','storage_damage','other','customer_return_final','supplier_writeoff','customer_replacement')
  OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'TRIAL212_DAMAGE_FILTER_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_period='range' THEN
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date>p_to_date OR p_to_date-p_from_date>365 THEN
   RAISE EXCEPTION 'TRIAL212_DAMAGE_DATE_INVALID' USING ERRCODE='22023'; END IF;
 ELSE
  p_from_date:=CASE p_period WHEN 'today' THEN today WHEN 'week' THEN today-6 ELSE date_trunc('month',today)::DATE END;p_to_date:=today;
 END IF;
 from_at:=p_from_date::TIMESTAMP AT TIME ZONE 'Asia/Amman';to_at:=(p_to_date+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';
 -- Original immutable loss evidence only: no new net-profit or financial
 -- calculation. Reversal/reclassification are separately labelled states.
 WITH evidence AS(
  SELECT 'damage'::TEXT source,d.id,d.product_id,d.quantity,d.reason_code,d.reason,d.occurred_at,
   d.origin,d.loss_in_minor_units loss,r.order_id,
   (SELECT c.id FROM public.supplier_replacement_cases c WHERE c.damage_event_id=d.id AND c.origin='shop_damage') case_id,
   CASE WHEN d.origin='customer_return' THEN 'return'::TEXT END reclass_kind
  FROM public.inventory_damage_events d LEFT JOIN public.sales_return_events r ON r.id=d.return_event_id
  WHERE d.occurred_at>=from_at AND d.occurred_at<to_at
  UNION ALL
  SELECT 'replacement',f.replacement_item_id,f.product_id,f.issued_quantity,'customer_replacement',e.reason,e.issued_at,
   'customer_return',f.replacement_cogs_snapshot_in_minor_units,e.root_order_id,NULL::UUID,'replacement'
  FROM public.phase43_replacement_inventory_effects f JOIN public.sales_replacement_events e ON e.id=f.replacement_event_id
  WHERE e.issued_at>=from_at AND e.issued_at<to_at AND e.issuance_status='issued'
  UNION ALL
  SELECT 'supplier_writeoff',e.id,c.product_id,e.quantity,'supplier_writeoff',e.reason,e.occurred_at,
   'supplier_rejected',e.expense_delta_in_minor_units,NULL::UUID,c.id,NULL::TEXT
  FROM public.supplier_replacement_events e JOIN public.supplier_replacement_cases c ON c.id=e.case_id
  WHERE e.action='writeoff' AND e.occurred_at>=from_at AND e.occurred_at<to_at
 ), filtered AS(SELECT * FROM evidence WHERE p_reason='all' OR reason_code=p_reason), page AS(
  SELECT * FROM filtered ORDER BY occurred_at DESC,id DESC,source LIMIT p_page_size OFFSET(p_page::BIGINT-1)*p_page_size
 ) SELECT jsonb_build_object('contractVersion',212,'page',p_page,'pageSize',p_page_size,
  'totalCount',(SELECT count(*) FROM filtered),'fromDate',p_from_date,'toDate',p_to_date,
  'rows',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY occurred_at DESC,id DESC,source) FROM page),'[]')) INTO result;
 FOR item IN SELECT x FROM jsonb_array_elements(result->'rows') x LOOP
  case_dto:=NULL;blocked:=NULL;
  dto:=jsonb_build_object('source',item.x->>'source','id',item.x->>'id','productId',item.x->>'product_id',
   'productName',(SELECT p.name_ar FROM public.products p WHERE p.id=(item.x->>'product_id')::UUID),
   'unitName',COALESCE((SELECT u.name_ar FROM public.products p LEFT JOIN public.units u ON u.id=p.unit_id WHERE p.id=(item.x->>'product_id')::UUID),'حبة'),
   'quantity',item.x->'quantity','reasonCode',item.x->>'reason_code','reason',item.x->>'reason','occurredAt',item.x->'occurred_at','origin',item.x->>'origin');
  IF item.x->>'case_id' IS NOT NULL THEN
   -- The existing immutable case reader proves reversal/state evidence.
   case_dto:=public.sr208_case_dto_internal((item.x->>'case_id')::UUID,owner_values);
   dto:=dto||jsonb_build_object('isReversed',EXISTS(SELECT 1 FROM jsonb_array_elements(case_dto->'events') e WHERE e->>'action'='reverse'
    AND e->>'reversesEventId'=CASE WHEN item.x->>'source'='supplier_writeoff' THEN item.x->>'id'
      ELSE(SELECT e->>'id' FROM jsonb_array_elements(case_dto->'events') e WHERE e->>'action'='damage' LIMIT 1) END));
  ELSE dto:=dto||jsonb_build_object('isReversed',false); END IF;
  IF item.x->>'reclass_kind' IS NOT NULL THEN
   blocked:=public.sr211_blocked_internal(item.x->>'reclass_kind',(item.x->>'id')::UUID);
   dto:=dto||jsonb_build_object('isReclassified',COALESCE(blocked='AFTERCARE211_ALREADY_CLASSIFIED',false));
  ELSE dto:=dto||jsonb_build_object('isReclassified',false); END IF;
  IF owner_values THEN
   dto:=dto||jsonb_build_object('lossAtRegistrationInMinorUnits',item.x->'loss');
   IF case_dto IS NOT NULL AND NOT (dto->>'isReversed')::BOOLEAN THEN
    dto:=dto||jsonb_build_object('reversal',jsonb_build_object('case',case_dto,'eventId',CASE WHEN item.x->>'source'='supplier_writeoff' THEN item.x->>'id'
     ELSE(SELECT e->>'id' FROM jsonb_array_elements(case_dto->'events') e WHERE e->>'action'='damage' LIMIT 1) END));
   END IF;
   IF item.x->>'reclass_kind' IS NOT NULL THEN
    dto:=dto||jsonb_build_object('reclassification',jsonb_build_object('kind',item.x->>'reclass_kind','sourceId',item.x->>'id',
     'orderId',item.x->>'order_id','blockedReason',blocked));
   END IF;
  END IF;
  entries:=entries||jsonb_build_array(dto);
 END LOOP;
 RETURN (result-'rows')||jsonb_build_object('rows',entries);
END $$;
ALTER FUNCTION public.get_damage_history_page_v1(TEXT,DATE,DATE,TEXT,INTEGER,INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_damage_history_page_v1(TEXT,DATE,DATE,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_damage_history_page_v1(TEXT,DATE,DATE,TEXT,INTEGER,INTEGER) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
