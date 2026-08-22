-- =========================================================================
-- Nawasrah ERP - Atomic website order collection and shift settlement
-- =========================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_reference_number TEXT,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.payment_reference_number IS
  'External payment reference captured when a website order is collected.';
COMMENT ON COLUMN public.orders.payment_confirmed_at IS
  'Time at which staff explicitly confirmed collection for the order.';
COMMENT ON COLUMN public.orders.payment_confirmed_by IS
  'Staff member who explicitly confirmed collection for the order.';

CREATE OR REPLACE FUNCTION public.enforce_order_collection_before_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed'
    AND OLD.status IS DISTINCT FROM 'completed'
    AND NEW.source IS DISTINCT FROM 'pos'
    AND COALESCE(NEW.payment_method, 'cash_on_delivery') <> 'debt'
    AND NEW.payment_confirmed_at IS NULL
  THEN
    RAISE EXCEPTION
      'أكد استلام الكاش أو تحويل CliQ من شاشة الطلب قبل إتمام التسليم.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_order_collection_before_completion
  ON public.orders;
CREATE TRIGGER trg_require_order_collection_before_completion
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_order_collection_before_completion();

REVOKE ALL ON FUNCTION public.enforce_order_collection_before_completion()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_website_order_with_payment(
  p_order_id UUID,
  p_payment_method TEXT,
  p_reference_number TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order RECORD;
  v_payment_method TEXT := LOWER(NULLIF(TRIM(p_payment_method), ''));
  v_shift_id UUID;
  v_shift_number TEXT;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تأكيد قبض وتسليم طلب الموقع'
  );

  IF v_payment_method = 'cash_on_delivery' THEN
    v_payment_method := 'cash';
  END IF;

  IF v_payment_method NOT IN ('cash', 'cliq') THEN
    RAISE EXCEPTION 'طريقة التحصيل يجب أن تكون كاش أو CliQ.';
  END IF;

  IF v_payment_method = 'cliq'
    AND NULLIF(TRIM(p_reference_number), '') IS NULL
  THEN
    RAISE EXCEPTION 'رقم مرجع عملية CliQ مطلوب قبل تأكيد القبض.';
  END IF;

  IF CHAR_LENGTH(COALESCE(TRIM(p_reference_number), '')) > 120 THEN
    RAISE EXCEPTION 'رقم مرجع الدفع أطول من الحد المسموح.';
  END IF;

  SELECT
    id,
    order_number,
    branch_id,
    source,
    status,
    payment_method,
    total_in_minor_units
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود.';
  END IF;

  IF v_order.source = 'pos' THEN
    RAISE EXCEPTION 'طلبات البيع المباشر تُحصّل من شاشة نقطة البيع.';
  END IF;

  IF v_order.status NOT IN ('ready', 'out_for_delivery') THEN
    RAISE EXCEPTION
      'لا يمكن تأكيد قبض الطلب في حالته الحالية (%).',
      v_order.status;
  END IF;

  IF v_order.branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن تحصيل الطلب دون فرع محدد.';
  END IF;

  -- Serialize collection with shift closing. Either this collection belongs to
  -- the current shift, or the operator must open a new shift after closing.
  SELECT id, shift_number
  INTO v_shift_id, v_shift_number
  FROM public.cash_shifts
  WHERE branch_id = v_order.branch_id
    AND status = 'open'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'افتح وردية الصندوق أولاً قبل تأكيد قبض وتسليم الطلب.';
  END IF;

  UPDATE public.orders
  SET
    payment_method = CASE
      WHEN v_payment_method = 'cash' THEN 'cash_on_delivery'
      ELSE 'cliq'
    END,
    payment_reference_number = CASE
      WHEN v_payment_method = 'cliq'
        THEN NULLIF(TRIM(p_reference_number), '')
      ELSE NULL
    END,
    payment_confirmed_at = NOW(),
    payment_confirmed_by = v_user_id,
    cash_shift_id = v_shift_id,
    updated_at = NOW()
  WHERE id = p_order_id;

  -- Reuse the canonical inventory/status implementation. Any failure rolls
  -- back the collection and shift link in this same transaction.
  v_result := public.complete_order(
    p_order_id,
    COALESCE(
      NULLIF(TRIM(p_notes), ''),
      CASE
        WHEN v_payment_method = 'cliq'
          THEN 'تم التسليم وتأكيد استلام تحويل CliQ'
        ELSE 'تم التسليم وتأكيد استلام الكاش'
      END
    )
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CONFIRM_WEBSITE_ORDER_PAYMENT',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'payment_method', v_payment_method,
      'payment_reference_number',
        CASE WHEN v_payment_method = 'cliq'
          THEN NULLIF(TRIM(p_reference_number), '') ELSE NULL END,
      'amount_in_minor_units', v_order.total_in_minor_units,
      'cash_shift_id', v_shift_id,
      'cash_shift_number', v_shift_number
    )
  );

  RETURN v_result || jsonb_build_object(
    'payment_method',
      CASE WHEN v_payment_method = 'cash'
        THEN 'cash_on_delivery' ELSE 'cliq' END,
    'payment_status', 'paid',
    'payment_reference_number',
      CASE WHEN v_payment_method = 'cliq'
        THEN NULLIF(TRIM(p_reference_number), '') ELSE NULL END,
    'cash_shift_id', v_shift_id,
    'cash_shift_number', v_shift_number,
    'message', 'تم تأكيد القبض والتسليم وخصم المخزون وربط العملية بالوردية.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_website_order_with_payment(
  UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_website_order_with_payment(
  UUID, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.complete_website_order_with_payment(
  UUID, TEXT, TEXT, TEXT
) IS
  'Atomically confirms cash/CliQ collection, attaches the open shift, completes delivery and delegates inventory deduction to complete_order.';
