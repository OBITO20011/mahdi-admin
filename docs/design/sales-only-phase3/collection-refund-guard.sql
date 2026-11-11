-- Owner11Nov M3. New trigger;no existing payment/reversal writer is changed.
CREATE FUNCTION sales_lite2.guard_payment_lite_refund() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT OLD.is_reversed AND NEW.is_reversed AND EXISTS(
  SELECT 1 FROM sales_lite1.returns r WHERE r.order_id=OLD.order_id AND r.money_refund>0
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LITE3_COLLECTION_REVERSAL_HAS_LITE_REFUND',
  DETAIL='لا يمكن عكس سند القبض بعد رد مبلغ بمرتجع لهذه الفاتورة. راجع المرتجع والتحصيل أولاً.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.guard_payment_lite_refund() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite3_payment_refund_guard BEFORE UPDATE OF is_reversed ON public.customer_payments
FOR EACH ROW WHEN(NOT OLD.is_reversed AND NEW.is_reversed)
EXECUTE FUNCTION sales_lite2.guard_payment_lite_refund();
