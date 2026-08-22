-- =========================================================================
-- Nawasrah ERP - Migration 030
-- Secure the public guest-order boundary and centralize staff status changes.
-- =========================================================================

-- The public website must never call the canonical order implementation
-- directly because that signature accepts internal accounting parameters.
-- submit_guest_customer_order remains the only anonymous order entry point.
REVOKE ALL ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) TO authenticated;

-- One guarded staff RPC owns every order-state transition. It delegates the
-- inventory-affecting states to their existing atomic implementations.
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
  v_user_id UUID := auth.uid();
  v_valid_transition BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تغيير حالة الطلب'
  );

  IF p_new_status = 'processing' THEN
    p_new_status := 'preparing';
  ELSIF p_new_status = 'delivered' THEN
    p_new_status := 'completed';
  END IF;

  SELECT order_number, status
  INTO v_order_number, v_old_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب المحدد غير موجود في قاعدة البيانات.';
  END IF;

  IF v_old_status = 'new'
    AND p_new_status IN ('confirmed', 'preparing', 'cancelled')
  THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'confirmed'
    AND p_new_status IN ('preparing', 'cancelled')
  THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'preparing'
    AND p_new_status IN ('ready', 'out_for_delivery', 'cancelled')
  THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'ready'
    AND p_new_status IN ('out_for_delivery', 'completed', 'cancelled')
  THEN
    v_valid_transition := true;
  ELSIF v_old_status = 'out_for_delivery'
    AND p_new_status IN ('completed', 'cancelled')
  THEN
    v_valid_transition := true;
  END IF;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION
      'انتقال حالة الطلب غير مسموح به من (%) إلى (%).',
      v_old_status,
      p_new_status;
  END IF;

  IF p_new_status = 'confirmed' THEN
    RETURN public.confirm_order(p_order_id, p_notes);
  ELSIF p_new_status = 'completed' THEN
    RETURN public.complete_order(p_order_id, p_notes);
  ELSIF p_new_status = 'cancelled' THEN
    RETURN public.cancel_order(p_order_id, p_notes);
  END IF;

  UPDATE public.orders
  SET status = p_new_status,
      updated_at = NOW()
  WHERE id = p_order_id;

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
END;
$$;

-- The implementation RPCs are private. The application uses only the guarded
-- update_order_status entry point, which calls them inside one transaction.
REVOKE ALL ON FUNCTION public.confirm_order(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_order(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_order(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.update_order_status(UUID, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.update_order_status(UUID, TEXT, TEXT) IS
  'Authenticated RBAC-guarded order transition entry point. Inventory deduction and reservation release remain delegated to atomic internal RPCs.';
