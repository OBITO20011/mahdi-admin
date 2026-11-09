-- QUARANTINED. Owner-approved9Nov: narrow additional shared behavioral guard.
-- All628 original bodies and the eight approved bridge diffs stay unchanged.
CREATE FUNCTION sales_lite2.guard_shift_lite_refund() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- The UPDATE already owns the shift row lock. Do not add a mode/order lock
 -- with a different ordering. VOLATILE reads see a refund committed while
 -- the original reversal was waiting for that same row lock.
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN('cancelled','reversed')
 AND EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=OLD.id AND r.money_refund>0)
 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sales_lite2.guard_shift_lite_refund() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER lite2_guard_shift_lite_refund BEFORE UPDATE OF status ON public.cash_shifts
FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN('cancelled','reversed'))
EXECUTE FUNCTION sales_lite2.guard_shift_lite_refund();

CREATE FUNCTION public.lite1_preview_shift_reversal2(p_shift_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result JSONB;
BEGIN
 -- Preserve the existing owner/MFA permission check and full-only JSON.
 result:=public.preview_cash_shift_full_reversal(p_shift_id);
 IF EXISTS(SELECT 1 FROM sales_lite1.returns r WHERE r.shift_id=p_shift_id AND r.money_refund>0) THEN
  RETURN result||jsonb_build_object('canExecute',false,'liteMonetaryRefundBlocked',true,'operations',
   COALESCE(result->'operations','[]'::JSONB)||jsonb_build_array(jsonb_build_object(
    'operationType','lite_monetary_refund','originalRecordId',p_shift_id,'status','BLOCKED',
    'reason','الوردية تتضمن ردّ مبلغ لفاتورة قديمة بلا مخزون. لا يمكن إلغاؤها أو عكسها؛ استخدم عدّ الدرج والإغلاق اليومي.',
    'expectedEffect','{}'::JSONB)));
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.lite1_preview_shift_reversal2(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lite1_preview_shift_reversal2(UUID) TO authenticated;
