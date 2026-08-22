-- =========================================================================
-- Nawasrah ERP - Simplified order workflow and partial customer settlement
-- =========================================================================

BEGIN;

-- Accepting an order is one operational action for the employee, while the
-- canonical confirmation/reservation and status history remain fully audited.
CREATE OR REPLACE FUNCTION public.accept_order_for_preparation(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'قبول الطلب وبدء التجهيز'
  );

  SELECT status
  INTO v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود.';
  END IF;

  IF v_status = 'new' THEN
    PERFORM public.confirm_order(
      p_order_id,
      COALESCE(NULLIF(TRIM(p_notes), ''), 'قبول الطلب وحجز المخزون')
    );
    v_status := 'confirmed';
  END IF;

  IF v_status = 'confirmed' THEN
    v_result := public.update_order_status(
      p_order_id,
      'preparing',
      COALESCE(NULLIF(TRIM(p_notes), ''), 'تم قبول الطلب وبدأ التجهيز')
    );
  ELSIF v_status = 'preparing' THEN
    v_result := jsonb_build_object(
      'success', true,
      'order_id', p_order_id,
      'status', 'preparing'
    );
  ELSE
    RAISE EXCEPTION 'لا يمكن قبول الطلب وبدء تجهيزه من الحالة الحالية (%).', v_status;
  END IF;

  RETURN v_result || jsonb_build_object(
    'message', 'تم قبول الطلب وحجز المخزون وبدء التجهيز.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_order_for_preparation(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_order_for_preparation(UUID, TEXT)
  TO authenticated;

-- The employee starts delivery directly from preparation. Internally the RPC
-- still records ready -> out_for_delivery so tracking and audit remain exact.
CREATE OR REPLACE FUNCTION public.start_or_update_order_delivery(
  p_order_id UUID,
  p_eta_minutes INTEGER,
  p_driver_phone TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_order_number TEXT;
  v_status TEXT;
  v_source TEXT;
  v_tracking_token UUID;
  v_existing_driver_phone TEXT;
  v_driver_phone TEXT;
  v_eta TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'بدء توصيل الطلب وتحديد وقت الوصول ورقم السائق'
  );

  IF p_eta_minutes IS NULL OR p_eta_minutes NOT BETWEEN 5 AND 360 THEN
    RAISE EXCEPTION 'وقت الوصول المتوقع يجب أن يكون بين 5 و360 دقيقة.';
  END IF;

  IF NULLIF(TRIM(p_driver_phone), '') IS NOT NULL THEN
    v_driver_phone := public.normalize_customer_phone(p_driver_phone);
    IF v_driver_phone !~ '^07[789][0-9]{7}$' THEN
      RAISE EXCEPTION 'رقم السائق الأردني غير صحيح.';
    END IF;
  END IF;

  SELECT
    order_number,
    status,
    source,
    tracking_token,
    delivery_driver_phone
  INTO
    v_order_number,
    v_status,
    v_source,
    v_tracking_token,
    v_existing_driver_phone
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;
  IF v_source IS DISTINCT FROM 'website' THEN
    RAISE EXCEPTION 'تتبع التوصيل متاح لطلبات الموقع فقط.';
  END IF;

  v_driver_phone := COALESCE(v_driver_phone, v_existing_driver_phone);
  IF v_driver_phone IS NULL THEN
    RAISE EXCEPTION 'أدخل رقم السائق قبل بدء التوصيل.';
  END IF;

  IF v_status = 'preparing' THEN
    PERFORM public.update_order_status(
      p_order_id,
      'ready',
      COALESCE(NULLIF(TRIM(p_notes), ''), 'اكتمل التجهيز وأصبح الطلب جاهزًا')
    );
    v_status := 'ready';
  END IF;

  IF v_status = 'ready' THEN
    PERFORM public.update_order_status(
      p_order_id,
      'out_for_delivery',
      COALESCE(NULLIF(TRIM(p_notes), ''), 'بدأ توصيل الطلب')
    );
  ELSIF v_status <> 'out_for_delivery' THEN
    RAISE EXCEPTION
      'يجب أن يكون الطلب قيد التجهيز أو جاهزًا أو خارجًا للتوصيل.';
  END IF;

  v_eta := NOW() + make_interval(mins => p_eta_minutes);

  UPDATE public.orders
  SET delivery_started_at = COALESCE(delivery_started_at, NOW()),
      estimated_arrival_at = v_eta,
      delivery_driver_phone = v_driver_phone,
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING tracking_token INTO v_tracking_token;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'start_or_update_order_delivery',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'eta_minutes', p_eta_minutes,
      'estimated_arrival_at', v_eta,
      'driver_phone', v_driver_phone,
      'notes', NULLIF(TRIM(p_notes), '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'status', 'out_for_delivery',
    'estimated_arrival_at', v_eta,
    'driver_phone', v_driver_phone,
    'tracking_token', v_tracking_token,
    'tracking_path', '/#track=' || v_tracking_token::TEXT,
    'message', 'اكتمل التجهيز وبدأ التوصيل وتم حفظ وقت الوصول ورقم السائق.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_or_update_order_delivery(
  UUID, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_or_update_order_delivery(
  UUID, INTEGER, TEXT, TEXT
) TO authenticated;

-- One atomic settlement boundary owns delivery fee adjustment, final delivery,
-- inventory deduction, partial collection and the remaining customer debt.
CREATE OR REPLACE FUNCTION public.complete_website_order_with_settlement(
  p_order_id UUID,
  p_payment_method TEXT,
  p_amount_collected_in_minor_units BIGINT DEFAULT NULL,
  p_delivery_fee_in_minor_units BIGINT DEFAULT NULL,
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
  v_order public.orders%ROWTYPE;
  v_payment_method TEXT := LOWER(NULLIF(TRIM(p_payment_method), ''));
  v_delivery_fee BIGINT;
  v_total BIGINT;
  v_collected BIGINT;
  v_remaining BIGINT;
  v_shift_id UUID;
  v_shift_number TEXT;
  v_result JSONB;
  v_payment_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تسليم الطلب وتسجيل التحصيل والذمة'
  );

  IF v_payment_method = 'cash_on_delivery' THEN
    v_payment_method := 'cash';
  END IF;
  IF v_payment_method NOT IN ('cash', 'cliq', 'debt') THEN
    RAISE EXCEPTION 'طريقة التحصيل يجب أن تكون كاش أو CliQ أو على الحساب.';
  END IF;

  SELECT *
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
    RAISE EXCEPTION 'لا يمكن تسليم الطلب من حالته الحالية (%).', v_order.status;
  END IF;
  IF v_order.branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يمكن إتمام الطلب دون فرع محدد.';
  END IF;

  v_delivery_fee := COALESCE(
    p_delivery_fee_in_minor_units,
    v_order.delivery_fee_in_minor_units,
    0
  );
  IF v_delivery_fee < 0 THEN
    RAISE EXCEPTION 'أجرة التوصيل لا يمكن أن تكون سالبة.';
  END IF;

  v_total := v_order.subtotal_in_minor_units
    - v_order.discount_in_minor_units
    + v_delivery_fee;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'إجمالي الطلب بعد الخصم والتوصيل غير صحيح.';
  END IF;

  v_collected := CASE
    WHEN v_payment_method = 'debt' THEN 0
    ELSE COALESCE(p_amount_collected_in_minor_units, v_total)
  END;
  IF v_collected < 0 OR v_collected > v_total THEN
    RAISE EXCEPTION 'المبلغ المقبوض يجب أن يكون بين صفر وإجمالي الطلب.';
  END IF;
  IF v_collected = 0 THEN
    v_payment_method := 'debt';
  END IF;
  IF v_payment_method = 'cliq'
    AND v_collected > 0
    AND NULLIF(TRIM(p_reference_number), '') IS NULL
  THEN
    RAISE EXCEPTION 'رقم مرجع CliQ مطلوب عند تسجيل التحويل.';
  END IF;
  IF CHAR_LENGTH(COALESCE(TRIM(p_reference_number), '')) > 120 THEN
    RAISE EXCEPTION 'رقم مرجع الدفع أطول من الحد المسموح.';
  END IF;

  v_remaining := v_total - v_collected;
  IF v_remaining > 0 AND v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'يجب ربط الطلب بعميل مسجل قبل تسجيل ذمة.';
  END IF;

  SELECT id, shift_number
  INTO v_shift_id, v_shift_number
  FROM public.cash_shifts
  WHERE branch_id = v_order.branch_id
    AND status = 'open'
  FOR SHARE;

  IF v_collected > 0 AND v_shift_id IS NULL THEN
    RAISE EXCEPTION 'افتح وردية الصندوق أولًا قبل تسجيل المبلغ المقبوض.';
  END IF;

  UPDATE public.orders
  SET
    delivery_fee_in_minor_units = v_delivery_fee,
    total_in_minor_units = v_total,
    payment_method = CASE
      WHEN v_remaining > 0 THEN 'debt'
      WHEN v_payment_method = 'cash' THEN 'cash_on_delivery'
      ELSE 'cliq'
    END,
    amount_paid_in_minor_units = 0,
    payment_reference_number = CASE
      WHEN v_payment_method = 'cliq' THEN NULLIF(TRIM(p_reference_number), '')
      ELSE NULL
    END,
    payment_confirmed_at = CASE WHEN v_collected > 0 THEN NOW() ELSE NULL END,
    payment_confirmed_by = CASE WHEN v_collected > 0 THEN v_user_id ELSE NULL END,
    cash_shift_id = v_shift_id,
    updated_at = NOW()
  WHERE id = p_order_id;

  v_result := public.complete_order(
    p_order_id,
    COALESCE(
      NULLIF(TRIM(p_notes), ''),
      CASE
        WHEN v_remaining = 0 THEN 'تم التسليم وقبض كامل المبلغ'
        WHEN v_collected = 0 THEN 'تم التسليم وكامل المبلغ على حساب العميل'
        ELSE 'تم التسليم وتسجيل دفعة جزئية والباقي ذمة'
      END
    )
  );

  IF v_remaining > 0 AND v_collected > 0 THEN
    v_payment_result := public.record_customer_order_payment(
      p_order_id,
      v_collected,
      v_payment_method,
      NULLIF(TRIM(p_reference_number), ''),
      COALESCE(NULLIF(TRIM(p_notes), ''), 'دفعة مستلمة عند تسليم الطلب')
    );
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, entity_name, entity_id, details
  ) VALUES (
    v_user_id,
    'COMPLETE_WEBSITE_ORDER_WITH_SETTLEMENT',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'delivery_fee_in_minor_units', v_delivery_fee,
      'total_in_minor_units', v_total,
      'collected_in_minor_units', v_collected,
      'remaining_in_minor_units', v_remaining,
      'collection_method', v_payment_method,
      'customer_payment_number', v_payment_result->>'payment_number',
      'cash_shift_id', v_shift_id,
      'cash_shift_number', v_shift_number
    )
  );

  RETURN v_result || jsonb_build_object(
    'payment_method', CASE WHEN v_remaining > 0 THEN 'debt' ELSE v_payment_method END,
    'payment_status', CASE
      WHEN v_remaining = 0 THEN 'paid'
      WHEN v_collected > 0 THEN 'partially_paid'
      ELSE 'unpaid'
    END,
    'total_in_minor_units', v_total,
    'amount_paid_in_minor_units', v_collected,
    'remaining_in_minor_units', v_remaining,
    'customer_payment_number', v_payment_result->>'payment_number',
    'cash_shift_id', v_shift_id,
    'cash_shift_number', v_shift_number,
    'message', CASE
      WHEN v_remaining = 0 THEN 'تم التسليم وقبض كامل المبلغ وخصم المخزون.'
      WHEN v_collected = 0 THEN 'تم التسليم وخصم المخزون وتسجيل كامل المبلغ ذمة على العميل.'
      ELSE 'تم التسليم وتسجيل الدفعة والباقي ذمة على العميل.'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.accept_order_for_preparation(UUID, TEXT) IS
  'One-click audited order acceptance, inventory reservation and preparation start.';
COMMENT ON FUNCTION public.complete_website_order_with_settlement(
  UUID, TEXT, BIGINT, BIGINT, TEXT, TEXT
) IS
  'Atomic website delivery settlement with editable delivery fee, full/partial/debt collection, inventory completion and customer receivable creation.';

COMMIT;
