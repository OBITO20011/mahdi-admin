-- Migration 107: canonical application schema; preserve historical migrations.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public._receive_inventory_impl(
  p_warehouse_id UUID,
  p_product_id UUID,
  p_quantity INT,
  p_reference_type TEXT DEFAULT 'purchase_order',
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT 'استلام كميات جديدة للمخزن'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_on_hand INT := 0;
  v_new_on_hand INT := 0;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();

  -- Validations
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'يجب أن تكون الكمية المستلمة أكبر من صفر.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  -- Serialize this RPC even before the balance row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'receive_inventory:' || p_warehouse_id::TEXT || ':' || p_product_id::TEXT, 0
  ));

  -- Lock row and fetch existing stock level if available
  SELECT on_hand_quantity INTO v_current_on_hand
  FROM public.inventory_balances
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_current_on_hand := 0;
    v_new_on_hand := p_quantity;

    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_warehouse_id,
      p_product_id,
      v_new_on_hand,
      0
    );
  ELSE
    v_new_on_hand := v_current_on_hand + p_quantity;

    UPDATE public.inventory_balances
    SET on_hand_quantity = v_new_on_hand,
        updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id;
  END IF;

  -- Record Movement
  INSERT INTO public.inventory_movements (
    warehouse_id,
    product_id,
    movement_type,
    quantity,
    balance_before,
    balance_after,
    reference_type,
    reference_id,
    notes,
    created_by
  ) VALUES (
    p_warehouse_id,
    p_product_id,
    'purchase_receipt',
    p_quantity,
    v_current_on_hand,
    v_new_on_hand,
    p_reference_type,
    p_reference_id,
    p_notes,
    v_user_id
  );

  -- Record Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'receive_inventory',
    'inventory_balances',
    p_product_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id,
      'received_quantity', p_quantity,
      'previous_balance', v_current_on_hand,
      'new_balance', v_new_on_hand,
      'reference_type', p_reference_type
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'warehouse_id', p_warehouse_id,
    'product_id', p_product_id,
    'received_quantity', p_quantity,
    'balance_before', v_current_on_hand,
    'balance_after', v_new_on_hand,
    'message', 'تم استلام وتزويد المخزون وتسجيل الحركة بنجاح.'
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشلت عملية استلام وتزويد المخزون: %', SQLERRM;
END;
$$;

-- The guarded receive_inventory wrapper is the only application entrypoint.
REVOKE ALL ON FUNCTION public._receive_inventory_impl(
  UUID, UUID, INTEGER, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

-- CREATE OR REPLACE preserves the existing owner and ACL.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.update_updated_at_column()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER trg_update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_branches_updated_at
BEFORE UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_warehouses_updated_at
BEFORE UPDATE ON public.warehouses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_update_inventory_balances_updated_at
BEFORE UPDATE ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lock before counting so concurrent inserts cannot invalidate the safety gate.
DO $$
DECLARE
  v_name TEXT;
  v_count BIGINT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'supplier_return_items', 'stock_count_items', 'supplier_returns', 'stock_counts'
  ] LOOP
    IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', v_name);
      EXECUTE format('SELECT count(*) FROM public.%I', v_name) INTO v_count;
      IF v_count <> 0 THEN
        RAISE EXCEPTION '107 aborted: legacy table % contains % rows', v_name, v_count;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- RESTRICT is deliberate: unexpected dependencies abort the whole transaction.
-- Retired RPCs were removed by 079; no current application callers remain.
DROP TABLE IF EXISTS public.supplier_return_items RESTRICT;
DROP TABLE IF EXISTS public.stock_count_items RESTRICT;
DROP TABLE IF EXISTS public.supplier_returns RESTRICT;
DROP TABLE IF EXISTS public.stock_counts RESTRICT;
DROP SEQUENCE IF EXISTS public.supplier_return_seq RESTRICT;
DROP SEQUENCE IF EXISTS public.stock_count_seq RESTRICT;
DROP FUNCTION IF EXISTS public.has_role(TEXT) RESTRICT;

-- rls_auto_enable belongs to separately managed platform configuration.
COMMIT;
