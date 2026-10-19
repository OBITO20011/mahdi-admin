BEGIN;

-- Owner19Oct: warehouse administration only. No inventory, cost, balance,
-- Auth, or existing operational writer is changed. There is no delete RPC.
CREATE FUNCTION public.get_owner_warehouses_v1()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'إدارة الفروع والمستودعات');
  RETURN jsonb_build_object(
    'branches',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',b.id,'code',b.code,'name',b.name_ar,'isActive',b.is_active
    ) ORDER BY b.code,b.id),'[]'::jsonb) FROM public.branches b),
    'warehouses',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',w.id,'code',w.code,'name',w.name_ar,'branchId',w.branch_id,
      'isActive',w.is_active,'updatedAt',w.updated_at,
      'hasStockOrReservations',EXISTS(SELECT 1 FROM public.inventory_balances ib
        WHERE ib.warehouse_id=w.id AND (ib.on_hand_quantity<>0 OR ib.reserved_quantity<>0)),
      'hasMovements',EXISTS(SELECT 1 FROM public.inventory_movements im WHERE im.warehouse_id=w.id),
      -- Products have no warehouse/default-warehouse column in this schema.
      -- Zero balance rows ARE product assignments; document links count too.
      'hasProductAssociations',(
        EXISTS(SELECT 1 FROM public.inventory_balances WHERE warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.stock_alerts WHERE warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.inventory_opening_sessions d JOIN public.inventory_opening_items i ON i.session_id=d.id WHERE d.warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.orders d JOIN public.order_items i ON i.order_id=d.id WHERE d.warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.purchase_orders d JOIN public.purchase_order_items i ON i.purchase_order_id=d.id WHERE d.warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.purchase_receipts d JOIN public.purchase_receipt_items i ON i.purchase_receipt_id=d.id WHERE d.warehouse_id=w.id)
        OR EXISTS(SELECT 1 FROM public.supplier_receipts d JOIN public.supplier_receipt_items i ON i.supplier_receipt_id=d.id WHERE d.warehouse_id=w.id)
      )
    ) ORDER BY w.code,w.id),'[]'::jsonb) FROM public.warehouses w)
  );
END;
$$;

CREATE FUNCTION public.save_owner_warehouse_v1(
  p_id UUID,p_code TEXT,p_name TEXT,p_branch_id UUID,p_is_active BOOLEAN,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  v_before public.warehouses%ROWTYPE;v_after public.warehouses%ROWTYPE;
  v_name TEXT:=BTRIM(p_name);v_code TEXT:=BTRIM(p_code);v_exists BOOLEAN;
BEGIN
  PERFORM public.assert_erp_role(ARRAY['owner'],'حفظ مستودع');
  IF p_id IS NULL OR p_branch_id IS NULL OR p_is_active IS NULL
    OR v_name IS NULL OR CHAR_LENGTH(v_name) NOT BETWEEN 2 AND 120
    OR v_code IS NULL OR v_code!~'^[A-Z0-9_-]{1,32}$'
  THEN RAISE EXCEPTION 'WAREHOUSE_INPUT_INVALID: تحقق من اسم المستودع والفرع.';END IF;

  -- Rare administrative mutation: drain transactions that already read the
  -- warehouse before checking inventory, rather than modifying stock writers.
  -- The lock is transaction-scoped; no DDL, data movement or manual unlock.
  LOCK TABLE public.warehouses IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO v_before FROM public.warehouses WHERE id=p_id FOR UPDATE;
  v_exists:=FOUND;
  IF v_exists AND v_before.code=v_code AND v_before.name_ar=v_name
    AND v_before.branch_id IS NOT DISTINCT FROM p_branch_id
    AND v_before.is_active=p_is_active
  THEN RETURN jsonb_build_object('warehouse',to_jsonb(v_before),'idempotentReplay',true);END IF;
  IF v_exists AND (p_expected_updated_at IS NULL OR v_before.updated_at IS DISTINCT FROM p_expected_updated_at)
  THEN RAISE EXCEPTION 'WAREHOUSE_EDIT_CONFLICT: تغير المستودع. حدّث الصفحة قبل الحفظ.';END IF;
  IF v_exists AND v_before.code<>v_code
  THEN RAISE EXCEPTION 'WAREHOUSE_CODE_IMMUTABLE: رمز المستودع لا يتغير.';END IF;
  IF NOT v_exists AND p_expected_updated_at IS NOT NULL
  THEN RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND: المستودع غير موجود.';END IF;
  IF (NOT v_exists OR v_before.branch_id IS DISTINCT FROM p_branch_id)
    AND NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p_branch_id AND is_active)
  THEN RAISE EXCEPTION 'WAREHOUSE_BRANCH_INVALID: اختر فرعاً نشطاً.';END IF;
  IF NOT p_is_active AND (NOT v_exists OR v_before.is_active) AND EXISTS(SELECT 1 FROM public.inventory_balances
    WHERE warehouse_id=p_id AND (on_hand_quantity<>0 OR reserved_quantity<>0))
  THEN RAISE EXCEPTION 'WAREHOUSE_HAS_STOCK: لا يمكن تعطيل مستودع لديه رصيد أو حجز.';END IF;
  IF NOT p_is_active AND v_exists AND v_before.is_active
    AND EXISTS(SELECT 1 FROM public.inventory_movements WHERE warehouse_id=p_id)
  THEN RAISE EXCEPTION 'WAREHOUSE_HAS_MOVEMENTS: لا يمكن تعطيل مستودع له حركة مخزون سابقة. تغيير الاسم مسموح.';END IF;
  IF NOT p_is_active AND v_exists AND v_before.is_active AND (
    EXISTS(SELECT 1 FROM public.inventory_balances WHERE warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.stock_alerts WHERE warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.inventory_opening_sessions d JOIN public.inventory_opening_items i ON i.session_id=d.id WHERE d.warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.orders d JOIN public.order_items i ON i.order_id=d.id WHERE d.warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.purchase_orders d JOIN public.purchase_order_items i ON i.purchase_order_id=d.id WHERE d.warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.purchase_receipts d JOIN public.purchase_receipt_items i ON i.purchase_receipt_id=d.id WHERE d.warehouse_id=p_id)
    OR EXISTS(SELECT 1 FROM public.supplier_receipts d JOIN public.supplier_receipt_items i ON i.supplier_receipt_id=d.id WHERE d.warehouse_id=p_id)
  ) THEN RAISE EXCEPTION 'WAREHOUSE_HAS_PRODUCTS: لا يمكن تعطيل مستودع مرتبط بصنف، حتى برصيد صفر ودون حركة. تغيير الاسم مسموح.';END IF;
  IF v_exists AND v_before.branch_id IS DISTINCT FROM p_branch_id
    AND EXISTS(SELECT 1 FROM public.inventory_movements WHERE warehouse_id=p_id)
  THEN RAISE EXCEPTION 'WAREHOUSE_HAS_MOVEMENTS: لا يمكن تغيير الفرع بعد حركة مخزون. تغيير الاسم مسموح.';END IF;
  IF EXISTS(SELECT 1 FROM public.warehouses WHERE code=v_code AND id<>p_id)
  THEN RAISE EXCEPTION 'WAREHOUSE_CODE_EXISTS: رمز المستودع مستخدم.';END IF;
  IF v_exists THEN
    UPDATE public.warehouses SET name_ar=v_name,branch_id=p_branch_id,is_active=p_is_active
      WHERE id=p_id RETURNING * INTO v_after;
  ELSE
    INSERT INTO public.warehouses(id,code,name_ar,branch_id,is_active)
      VALUES(p_id,v_code,v_name,p_branch_id,p_is_active) RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
  VALUES(auth.uid(),CASE WHEN v_exists THEN 'OWNER_WAREHOUSE_UPDATED' ELSE 'OWNER_WAREHOUSE_CREATED' END,
    'warehouses',p_id,jsonb_build_object('before',CASE WHEN v_exists THEN to_jsonb(v_before) ELSE NULL END,'after',to_jsonb(v_after)));
  RETURN jsonb_build_object('warehouse',to_jsonb(v_after),'idempotentReplay',false);
END;
$$;

ALTER FUNCTION public.get_owner_warehouses_v1() OWNER TO postgres;
ALTER FUNCTION public.save_owner_warehouse_v1(UUID,TEXT,TEXT,UUID,BOOLEAN,TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_owner_warehouses_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_owner_warehouse_v1(UUID,TEXT,TEXT,UUID,BOOLEAN,TIMESTAMPTZ) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_owner_warehouses_v1() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_owner_warehouse_v1(UUID,TEXT,TEXT,UUID,BOOLEAN,TIMESTAMPTZ) TO authenticated;

COMMIT;
