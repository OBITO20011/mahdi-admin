-- QUARANTINED parallel readers. Provenance is immutable, not the current mode.
-- No original reader, financial formula, ACL or ledger row is changed.
CREATE FUNCTION public.lite1_statement_dispatch2(p_customer_id UUID,p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.assert_erp_role(ARRAY['owner','admin','manager','accountant','sales'],'عرض كشف حساب العميل');
 IF EXISTS(SELECT 1 FROM sales_lite1.orders l JOIN public.orders o ON o.id=l.order_id WHERE o.customer_id=p_customer_id) THEN
  RETURN public.lite1_customer_statement2(p_customer_id,p_page,p_page_size);
 END IF;
 RETURN public.get_customer_statement(p_customer_id,p_page,p_page_size);
END $$;
REVOKE ALL ON FUNCTION public.lite1_statement_dispatch2(UUID,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_statement_dispatch2(UUID,INTEGER,INTEGER) TO authenticated;

CREATE FUNCTION public.lite1_public_pos_receipt2(p_receipt_token UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE receipt JSONB;payment JSONB;
BEGIN
 -- The original token/source/status gate and sanitized commercial lines run
 -- first, unchanged. An unknown token never reaches private evidence.
 receipt:=public.get_public_pos_receipt(p_receipt_token);
 IF receipt->>'success' IS DISTINCT FROM 'true' THEN RETURN receipt;END IF;
 SELECT jsonb_strip_nulls(jsonb_build_object('amountPaidInMinorUnits',o.amount_paid_in_minor_units,
  'remainingInMinorUnits',f.outstanding_total_in_minor_units,'initialPaymentMethod',p.payment_method)) INTO payment
 FROM public.orders o JOIN sales_lite2.sales s ON s.order_id=o.id
 LEFT JOIN public.customer_payments p ON p.id=s.initial_payment_id
 CROSS JOIN LATERAL public.phase42_order_financial_position_internal(o.id) f
 WHERE o.public_receipt_token=p_receipt_token AND o.source='pos' AND o.status IN('completed','returned');
 RETURN receipt||COALESCE(payment,'{}'::JSONB);
END $$;
REVOKE ALL ON FUNCTION public.lite1_public_pos_receipt2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_public_pos_receipt2(UUID) TO anon,authenticated;
