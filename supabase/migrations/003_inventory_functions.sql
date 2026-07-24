-- =========================================================================
-- Nawasrah Business Manager - Supabase Migration 003: Inventory Functions
-- Stored Procedures / RPCs for Safe Atomic Inventory Management
-- =========================================================================

-- -------------------------------------------------------------------------
-- RPC 1: create_product_with_opening_stock
-- Atomically creates a product, links to warehouse, sets opening stock,
-- records inventory movement, and inserts audit log.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_opening_stock(
  p_sku TEXT,
  p_barcode TEXT DEFAULT NULL,
  p_name_ar TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_brand_id UUID DEFAULT NULL,
  p_unit_id UUID DEFAULT NULL,
  p_cost_price_in_minor_units BIGINT DEFAULT 0,
  p_sale_price_in_minor_units BIGINT DEFAULT 0,
  p_min_stock_level INT DEFAULT 0,
  p_max_stock_level INT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_opening_quantity INT DEFAULT 0,
  p_notes TEXT DEFAULT 'رصيد افتتاحي عند إضافة المنتج'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_id UUID;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Get active user ID if authenticated
  v_user_id := auth.uid();

  -- Input validations
  IF p_sku IS NULL OR TRIM(p_sku) = '' THEN
    RAISE EXCEPTION 'رمز SKU مطلوب ولا يمكن أن يكون فارغاً.';
  END IF;

  IF p_name_ar IS NULL OR TRIM(p_name_ar) = '' THEN
    RAISE EXCEPTION 'اسم المنتج بالعربية مطلوب.';
  END IF;

  IF p_opening_quantity < 0 THEN
    RAISE EXCEPTION 'الكمية الافتتاحية لا يمكن أن تكون أقل من صفر.';
  END IF;

  -- 1. Create Product Row
  INSERT INTO public.products (
    sku,
    barcode,
    name_ar,
    description,
    category_id,
    brand_id,
    unit_id,
    cost_price_in_minor_units,
    sale_price_in_minor_units,
    min_stock_level,
    max_stock_level
  ) VALUES (
    TRIM(p_sku),
    NULLIF(TRIM(p_barcode), ''),
    TRIM(p_name_ar),
    p_description,
    p_category_id,
    p_brand_id,
    p_unit_id,
    p_cost_price_in_minor_units,
    p_sale_price_in_minor_units,
    p_min_stock_level,
    p_max_stock_level
  )
  RETURNING id INTO v_product_id;

  -- 2. Link to Warehouse & Set Opening Stock if warehouse provided
  IF p_warehouse_id IS NOT NULL THEN
    -- Verify warehouse exists
    IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id) THEN
      RAISE EXCEPTION 'المستودع المالي المحدد غير موجود.';
    END IF;

    -- Insert Initial Balance (reserved_quantity = 0)
    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_warehouse_id,
      v_product_id,
      p_opening_quantity,
      0
    );

    -- 3. Record Opening Balance Movement
    IF p_opening_quantity > 0 THEN
      INSERT INTO public.inventory_movements (
        warehouse_id,
        product_id,
        movement_type,
        quantity,
        balance_before,
        balance_after,
        notes,
        created_by
      ) VALUES (
        p_warehouse_id,
        v_product_id,
        'opening_balance',
        p_opening_quantity,
        0,
        p_opening_quantity,
        COALESCE(p_notes, 'رصيد افتتاحي عند إنشاء المنتج'),
        v_user_id
      );
    END IF;
  END IF;

  -- 4. Audit Log
  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'create_product_with_opening_stock',
    'products',
    v_product_id,
    jsonb_build_object(
      'sku', p_sku,
      'name_ar', p_name_ar,
      'warehouse_id', p_warehouse_id,
      'opening_quantity', p_opening_quantity
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'product_id', v_product_id,
    'sku', p_sku,
    'opening_quantity', p_opening_quantity,
    'message', 'تم إنشاء المنتج وتسجيل الرصيد الافتتاحي وسجل التدقيق بنجاح.'
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- PL/pgSQL automatically rolls back all changes in the current transaction block on exception
  RAISE EXCEPTION 'فشلت عملية إنشاء المنتج والرصيد الافتتاحي: %', SQLERRM;
END;
$$;


-- -------------------------------------------------------------------------
-- RPC 2: receive_inventory
-- Safely receives stock for a product in a specified warehouse, updates balance,
-- records 'purchase_receipt' movement, and writes an audit log.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_inventory(
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
