-- Owner18: actual bounded drawer evidence. Read only; existing summaries/writers
-- and frozen closing snapshots remain authoritative and are never replaced.
BEGIN;
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
      'at',at,'method',method,'amountInMinorUnits',amount,'note',note) ORDER BY at DESC,id DESC,source) FROM page),'[]'::JSONB)
  ) INTO v_result FROM totals;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_cash_shift_movement_page(UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_cash_shift_movement_page(UUID,TEXT,TEXT,INTEGER,INTEGER) TO authenticated;
COMMENT ON FUNCTION public.get_cash_shift_movement_page(UUID,TEXT,TEXT,INTEGER,INTEGER) IS
  '206 readonly actual evidence with full totals and bounded pages; same four closing-report roles; summary/snapshot remain authoritative.';
COMMIT;
