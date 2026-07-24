-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 005: Order Status Transitions
-- Safe RPC update_order_status for state pipeline (preparing, ready, out_for_delivery)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id UUID,
  p_new_status TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_number TEXT;
  v_old_status TEXT;
  v_user_id UUID;
  v_valid_transition BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();

  -- Normalize target status if needed
  IF p_new_status = 'processing' THEN
    p_new_status := 'preparing';
  ELSIF p_new_status = 'delivered' THEN
    p_new_status := 'completed';
  END IF;

  -- Lock and fetch current order
  SELECT order_number, status
  INTO v_order_number, v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  -- Delegate special atomic transitions
  IF p_new_status = 'confirmed' AND v_old_status = 'new' THEN
    RETURN public.confirm_order(p_order_id, p_notes);
  ELSIF p_new_status = 'completed' THEN
    RETURN public.complete_order(p_order_id, p_notes);
  ELSIF p_new_status = 'cancelled' THEN
    RETURN public.cancel_order(p_order_id, p_notes);
  END IF;

  -- Validate permitted status transitions
  IF v_old_status = 'new' AND p_new_status IN ('confirmed', 'preparing', 'cancelled') THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'confirmed' AND p_new_status IN ('preparing', 'cancelled') THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'preparing' AND p_new_status IN ('ready', 'out_for_delivery', 'cancelled') THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'ready' AND p_new_status IN ('out_for_delivery', 'completed', 'cancelled') THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'out_for_delivery' AND p_new_status IN ('completed', 'cancelled') THEN
    v_valid_transition := true;
  END IF;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'انتقال حالة الطلب غير مسموح به من (%) إلى (%).', v_old_status, p_new_status;
  END IF;

  -- Update status
  UPDATE public.orders
  SET status = p_new_status,
      updated_at = NOW()
  WHERE id = p_order_id;

  -- Record order status history
  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    p_order_id,
    v_old_status,
    p_new_status,
    v_user_id,
    COALESCE(p_notes, 'تغيير حالة الطلب إلى ' || p_new_status)
  );

  -- Record audit log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'update_order_status',
    'orders',
    p_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'old_status', v_old_status,
      'new_status', p_new_status,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order_number,
    'old_status', v_old_status,
    'status', p_new_status,
    'message', 'تم تحديث حالة الطلب بنجاح إلى ' || p_new_status
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية تحديث حالة الطلب: %', SQLERRM;
END;
$$;
