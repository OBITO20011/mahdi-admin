-- =========================================================================
-- Nawasrah ERP - Migration 014
-- Simple daily operations: POS sales, product updates, stock adjustments,
-- and persistent low-stock notifications.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. POS metadata on the canonical orders table
-- -------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (amount_paid_in_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS change_due_in_minor_units BIGINT NOT NULL DEFAULT 0
    CHECK (change_due_in_minor_units >= 0),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON public.orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.pos_sale_number_seq START WITH 1;

-- -------------------------------------------------------------------------
-- 2. Persistent stock alerts and per-user read state
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('low_stock', 'out_of_stock')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'resolved')),
  available_quantity INTEGER NOT NULL,
  threshold_quantity INTEGER NOT NULL CHECK (threshold_quantity >= 0),
  first_triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_alerts_active_product_warehouse
  ON public.stock_alerts(product_id, warehouse_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_stock_alerts_status_updated
  ON public.stock_alerts(status, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_alert_reads (
  stock_alert_id UUID NOT NULL
    REFERENCES public.stock_alerts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (stock_alert_id, user_id)
);

ALTER TABLE public.stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_alert_reads ENABLE ROW LEVEL SECURITY;

-- Alerts are read through SECURITY DEFINER RPCs only.
DROP POLICY IF EXISTS "Allow authenticated users to view stock alerts"
  ON public.stock_alerts;
DROP POLICY IF EXISTS "Allow authenticated users to manage stock alerts"
  ON public.stock_alerts;
DROP POLICY IF EXISTS "Allow authenticated users to view stock alert reads"
  ON public.stock_alert_reads;
DROP POLICY IF EXISTS "Allow authenticated users to manage stock alert reads"
  ON public.stock_alert_reads;

-- -------------------------------------------------------------------------
-- 3. Alert synchronization triggers
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_stock_alert(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_on_hand_quantity INTEGER,
  p_reserved_quantity INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_threshold INTEGER;
  v_is_active BOOLEAN;
  v_available INTEGER :=
    COALESCE(p_on_hand_quantity, 0) - COALESCE(p_reserved_quantity, 0);
  v_severity TEXT;
  v_existing_id UUID;
  v_existing_severity TEXT;
BEGIN
  SELECT min_stock_level, is_active
  INTO v_threshold, v_is_active
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND OR NOT COALESCE(v_is_active, false) THEN
    UPDATE public.stock_alerts
    SET
      status = 'resolved',
      resolved_at = NOW(),
      last_updated_at = NOW()
    WHERE product_id = p_product_id
      AND warehouse_id = p_warehouse_id
      AND status = 'active';
    RETURN;
  END IF;

  v_threshold := GREATEST(COALESCE(v_threshold, 0), 0);

  SELECT id, severity
  INTO v_existing_id, v_existing_severity
  FROM public.stock_alerts
  WHERE product_id = p_product_id
    AND warehouse_id = p_warehouse_id
    AND status = 'active'
  FOR UPDATE;

  IF v_available <= v_threshold THEN
    v_severity :=
      CASE WHEN v_available <= 0
        THEN 'out_of_stock'
        ELSE 'low_stock'
      END;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.stock_alerts (
        product_id,
        warehouse_id,
        severity,
        status,
        available_quantity,
        threshold_quantity
      ) VALUES (
        p_product_id,
        p_warehouse_id,
        v_severity,
        'active',
        v_available,
        v_threshold
      );
    ELSE
      UPDATE public.stock_alerts
      SET
        severity = v_severity,
        available_quantity = v_available,
        threshold_quantity = v_threshold,
        last_updated_at = NOW(),
        resolved_at = NULL
      WHERE id = v_existing_id;

      -- A read low-stock alert becomes unread again if the product reaches zero.
      IF v_existing_severity IS DISTINCT FROM v_severity THEN
        DELETE FROM public.stock_alert_reads
        WHERE stock_alert_id = v_existing_id;
      END IF;
    END IF;
  ELSIF v_existing_id IS NOT NULL THEN
    UPDATE public.stock_alerts
    SET
      status = 'resolved',
      available_quantity = v_available,
      threshold_quantity = v_threshold,
      resolved_at = NOW(),
      last_updated_at = NOW()
    WHERE id = v_existing_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_stock_alert_from_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_stock_alert(
    NEW.product_id,
    NEW.warehouse_id,
    NEW.on_hand_quantity,
    NEW.reserved_quantity
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_alert_from_balance
  ON public.inventory_balances;
CREATE TRIGGER trg_sync_stock_alert_from_balance
AFTER INSERT OR UPDATE OF on_hand_quantity, reserved_quantity
ON public.inventory_balances
FOR EACH ROW
EXECUTE FUNCTION public.sync_stock_alert_from_balance();

CREATE OR REPLACE FUNCTION public.sync_stock_alert_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance RECORD;
BEGIN
  FOR v_balance IN
    SELECT
      warehouse_id,
      on_hand_quantity,
      reserved_quantity
    FROM public.inventory_balances
    WHERE product_id = NEW.id
  LOOP
    PERFORM public.sync_stock_alert(
      NEW.id,
      v_balance.warehouse_id,
      v_balance.on_hand_quantity,
      v_balance.reserved_quantity
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_alert_from_product
  ON public.products;
CREATE TRIGGER trg_sync_stock_alert_from_product
AFTER UPDATE OF min_stock_level, is_active
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_stock_alert_from_product();

DO $$
DECLARE
  v_balance RECORD;
BEGIN
  FOR v_balance IN
    SELECT
      product_id,
      warehouse_id,
      on_hand_quantity,
      reserved_quantity
    FROM public.inventory_balances
  LOOP
    PERFORM public.sync_stock_alert(
      v_balance.product_id,
      v_balance.warehouse_id,
      v_balance.on_hand_quantity,
      v_balance.reserved_quantity
    );
  END LOOP;
END;
$$;

-- -------------------------------------------------------------------------
-- 4. Alert read RPCs
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stock_alert_notifications(
  p_include_resolved BOOLEAN DEFAULT false,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'عرض تنبيهات المخزون'
  );

  SELECT jsonb_build_object(
    'items',
    COALESCE(jsonb_agg(item ORDER BY sort_priority, "lastUpdatedAt" DESC), '[]'::jsonb),
    'unreadCount',
    COUNT(*) FILTER (WHERE NOT "isRead")
  )
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id', sa.id,
        'productId', sa.product_id,
        'warehouseId', sa.warehouse_id,
        'productName', p.name_ar,
        'sku', p.sku,
        'warehouseName', w.name_ar,
        'severity', sa.severity,
        'status', sa.status,
        'availableQuantity', sa.available_quantity,
        'thresholdQuantity', sa.threshold_quantity,
        'unitsPerPackage', p.units_per_purchase_unit,
        'purchaseUnitName', pu.name_ar,
        'baseUnitName', bu.name_ar,
        'isRead', EXISTS (
          SELECT 1
          FROM public.stock_alert_reads sar
          WHERE sar.stock_alert_id = sa.id
            AND sar.user_id = v_user_id
        ),
        'firstTriggeredAt', sa.first_triggered_at,
        'lastUpdatedAt', sa.last_updated_at,
        'resolvedAt', sa.resolved_at
      ) AS item,
      CASE WHEN sa.severity = 'out_of_stock' THEN 0 ELSE 1 END AS sort_priority,
      sa.last_updated_at AS "lastUpdatedAt",
      EXISTS (
        SELECT 1
        FROM public.stock_alert_reads sar
        WHERE sar.stock_alert_id = sa.id
          AND sar.user_id = v_user_id
      ) AS "isRead"
    FROM public.stock_alerts sa
    JOIN public.products p ON p.id = sa.product_id
    JOIN public.warehouses w ON w.id = sa.warehouse_id
    LEFT JOIN public.units pu ON pu.id = p.purchase_unit_id
    LEFT JOIN public.units bu ON bu.id = p.unit_id
    WHERE p_include_resolved OR sa.status = 'active'
    ORDER BY
      CASE WHEN sa.severity = 'out_of_stock' THEN 0 ELSE 1 END,
      sa.last_updated_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250)
  ) alerts;

  RETURN COALESCE(
    v_result,
    jsonb_build_object('items', '[]'::jsonb, 'unreadCount', 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stock_alert_read(
  p_stock_alert_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'تحديث حالة تنبيه المخزون'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.stock_alerts
    WHERE id = p_stock_alert_id
  ) THEN
    RAISE EXCEPTION 'تنبيه المخزون المحدد غير موجود.';
  END IF;

  INSERT INTO public.stock_alert_reads (
    stock_alert_id,
    user_id,
    read_at
  ) VALUES (
    p_stock_alert_id,
    v_user_id,
    NOW()
  )
  ON CONFLICT (stock_alert_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_stock_alerts_read()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY[
      'owner',
      'admin',
      'manager',
      'accountant',
      'sales',
      'warehouse_keeper',
      'delivery_driver'
    ],
    'تحديث حالة تنبيهات المخزون'
  );

  INSERT INTO public.stock_alert_reads (
    stock_alert_id,
    user_id,
    read_at
  )
  SELECT id, v_user_id, NOW()
  FROM public.stock_alerts
  WHERE status = 'active'
  ON CONFLICT (stock_alert_id, user_id)
  DO UPDATE SET read_at = EXCLUDED.read_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updatedCount', v_count
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 5. Canonical product update RPC
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_master(
  p_product_id UUID,
  p_sku TEXT,
  p_barcode TEXT,
  p_name_ar TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_brand_id UUID,
  p_unit_id UUID,
  p_purchase_unit_id UUID,
  p_units_per_purchase_unit INTEGER,
  p_default_purchase_price_in_minor_units BIGINT,
  p_cost_price_in_minor_units BIGINT,
  p_sale_price_in_minor_units BIGINT,
  p_min_stock_level INTEGER,
  p_max_stock_level INTEGER,
  p_is_active BOOLEAN,
  p_image_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product public.products%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'تعديل بيانات المنتج'
  );

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'معرف المنتج مطلوب.';
  END IF;
  IF NULLIF(TRIM(p_sku), '') IS NULL THEN
    RAISE EXCEPTION 'رمز الصنف SKU مطلوب.';
  END IF;
  IF NULLIF(TRIM(p_name_ar), '') IS NULL THEN
    RAISE EXCEPTION 'اسم المنتج مطلوب.';
  END IF;
  IF COALESCE(p_units_per_purchase_unit, 0) < 1 THEN
    RAISE EXCEPTION 'عدد الحبات داخل العبوة يجب أن يكون عدداً صحيحاً أكبر من صفر.';
  END IF;
  IF COALESCE(p_default_purchase_price_in_minor_units, -1) < 0
    OR COALESCE(p_cost_price_in_minor_units, -1) < 0
    OR COALESCE(p_sale_price_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'أسعار المنتج لا يمكن أن تكون سالبة.';
  END IF;
  IF COALESCE(p_min_stock_level, -1) < 0 THEN
    RAISE EXCEPTION 'حد تنبيه المخزون لا يمكن أن يكون سالباً.';
  END IF;
  IF p_max_stock_level IS NOT NULL
    AND p_max_stock_level < p_min_stock_level THEN
    RAISE EXCEPTION 'الحد الأعلى للمخزون لا يمكن أن يقل عن حد التنبيه.';
  END IF;

  PERFORM 1
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود.';
  END IF;

  UPDATE public.products
  SET
    sku = TRIM(p_sku),
    barcode = NULLIF(TRIM(p_barcode), ''),
    name_ar = TRIM(p_name_ar),
    description = NULLIF(TRIM(p_description), ''),
    category_id = p_category_id,
    brand_id = p_brand_id,
    unit_id = p_unit_id,
    purchase_unit_id = COALESCE(p_purchase_unit_id, p_unit_id),
    units_per_purchase_unit = p_units_per_purchase_unit,
    default_purchase_price_in_minor_units =
      p_default_purchase_price_in_minor_units,
    cost_price_in_minor_units = p_cost_price_in_minor_units,
    sale_price_in_minor_units = p_sale_price_in_minor_units,
    min_stock_level = p_min_stock_level,
    max_stock_level = p_max_stock_level,
    is_active = COALESCE(p_is_active, true),
    updated_at = NOW()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  IF NULLIF(TRIM(p_image_url), '') IS NOT NULL THEN
    PERFORM public.set_product_primary_image(
      p_product_id,
      TRIM(p_image_url)
    );
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'UPDATE_PRODUCT_MASTER',
    'products',
    p_product_id,
    jsonb_build_object(
      'sku', v_product.sku,
      'name_ar', v_product.name_ar,
      'sale_price_in_minor_units', v_product.sale_price_in_minor_units,
      'cost_price_in_minor_units', v_product.cost_price_in_minor_units,
      'min_stock_level', v_product.min_stock_level,
      'units_per_purchase_unit', v_product.units_per_purchase_unit
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', v_product.id,
    'message', 'تم تحديث بيانات المنتج وحد تنبيه المخزون بنجاح.'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 6. Atomic stock count / damage adjustment RPC
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_warehouse_id UUID,
  p_product_id UUID,
  p_actual_quantity INTEGER,
  p_reason TEXT,
  p_adjustment_type TEXT DEFAULT 'stock_count'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product_name TEXT;
  v_previous_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_quantity_change INTEGER;
  v_movement_type TEXT;
  v_movement_id UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'جرد وتسوية المخزون'
  );

  IF p_warehouse_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'المنتج والمستودع مطلوبان.';
  END IF;
  IF p_actual_quantity IS NULL OR p_actual_quantity < 0 THEN
    RAISE EXCEPTION 'الكمية الفعلية يجب أن تكون عدداً صحيحاً لا يقل عن صفر.';
  END IF;
  IF NULLIF(TRIM(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'سبب الجرد أو التسوية مطلوب.';
  END IF;
  IF COALESCE(p_adjustment_type, 'stock_count') NOT IN (
    'stock_count',
    'damage',
    'expired',
    'manual'
  ) THEN
    RAISE EXCEPTION 'نوع تسوية المخزون غير معتمد.';
  END IF;

  SELECT p.name_ar
  INTO v_product_name
  FROM public.products p
  WHERE p.id = p_product_id
    AND p.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج المحدد غير موجود أو غير نشط.';
  END IF;

  SELECT on_hand_quantity, reserved_quantity
  INTO v_previous_quantity, v_reserved_quantity
  FROM public.inventory_balances
  WHERE warehouse_id = p_warehouse_id
    AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد رصيد لهذا المنتج في المستودع المحدد.';
  END IF;

  IF p_actual_quantity < v_reserved_quantity THEN
    RAISE EXCEPTION
      'لا يمكن جعل المخزون الفعلي (%) أقل من الكمية المحجوزة (%).',
      p_actual_quantity,
      v_reserved_quantity;
  END IF;

  v_quantity_change := p_actual_quantity - v_previous_quantity;
  v_movement_type :=
    CASE WHEN v_quantity_change >= 0
      THEN 'adjustment_add'
      ELSE 'adjustment_subtract'
    END;

  UPDATE public.inventory_balances
  SET
    on_hand_quantity = p_actual_quantity,
    updated_at = NOW()
  WHERE warehouse_id = p_warehouse_id
    AND product_id = p_product_id;

  IF v_quantity_change <> 0 THEN
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
      v_movement_type,
      v_quantity_change,
      v_previous_quantity,
      p_actual_quantity,
      COALESCE(p_adjustment_type, 'stock_count'),
      NULL,
      TRIM(p_reason),
      v_user_id
    )
    RETURNING id INTO v_movement_id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'ADJUST_INVENTORY_STOCK',
    'inventory_balances',
    p_product_id,
    jsonb_build_object(
      'warehouse_id', p_warehouse_id,
      'product_name', v_product_name,
      'previous_quantity', v_previous_quantity,
      'actual_quantity', p_actual_quantity,
      'quantity_change', v_quantity_change,
      'adjustment_type', COALESCE(p_adjustment_type, 'stock_count'),
      'reason', TRIM(p_reason),
      'movement_id', v_movement_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'productId', p_product_id,
    'productName', v_product_name,
    'warehouseId', p_warehouse_id,
    'previousQuantity', v_previous_quantity,
    'actualQuantity', p_actual_quantity,
    'quantityChange', v_quantity_change,
    'availableQuantity', p_actual_quantity - v_reserved_quantity,
    'movementId', v_movement_id,
    'message', 'تم حفظ الجرد وتسوية المخزون في Supabase بنجاح.'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 7. Atomic POS sale RPC
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_warehouse_id UUID,
  p_branch_id UUID,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_amount_received_in_minor_units BIGINT DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_warehouse_id UUID := p_warehouse_id;
  v_branch_id UUID := p_branch_id;
  v_customer_id UUID := p_customer_id;
  v_customer_name TEXT := NULLIF(TRIM(p_customer_name), '');
  v_order_id UUID;
  v_order_number TEXT;
  v_item JSONB;
  v_product_id UUID;
  v_product_name TEXT;
  v_product_sku TEXT;
  v_quantity INTEGER;
  v_unit_price BIGINT;
  v_line_total BIGINT;
  v_subtotal BIGINT := 0;
  v_total BIGINT;
  v_paid BIGINT;
  v_change BIGINT;
  v_on_hand INTEGER;
  v_reserved INTEGER;
  v_new_on_hand INTEGER;
  v_items_result JSONB;
  v_existing_order public.orders%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ البيع المباشر'
  );

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'سلة البيع فارغة.';
  END IF;
  IF COALESCE(p_discount_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'خصم الفاتورة لا يمكن أن يكون سالباً.';
  END IF;
  IF COALESCE(p_amount_received_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'المبلغ المستلم لا يمكن أن يكون سالباً.';
  END IF;
  IF COALESCE(p_payment_method, 'cash') NOT IN (
    'cash',
    'cliq',
    'card',
    'bank_transfer',
    'debt',
    'mixed'
  ) THEN
    RAISE EXCEPTION 'طريقة الدفع غير معتمدة.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM jsonb_array_elements(p_items)
  ) <> (
    SELECT COUNT(DISTINCT item.value->>'product_id')
    FROM jsonb_array_elements(p_items) AS item(value)
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار المنتج نفسه أكثر من مرة في سلة البيع.';
  END IF;

  IF NULLIF(TRIM(p_idempotency_key), '') IS NOT NULL THEN
    -- Serialize retries carrying the same key so two concurrent taps cannot
    -- deduct inventory twice before the unique index is checked.
    PERFORM pg_advisory_xact_lock(
      hashtext(TRIM(p_idempotency_key))
    );

    SELECT *
    INTO v_existing_order
    FROM public.orders
    WHERE idempotency_key = TRIM(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'productId', oi.product_id,
        'productName', oi.product_name_snapshot,
        'sku', oi.sku_snapshot,
        'quantity', oi.quantity,
        'unitPriceInMinorUnits', oi.unit_price_in_minor_units,
        'lineTotalInMinorUnits', oi.line_total_in_minor_units
      ) ORDER BY oi.created_at), '[]'::jsonb)
      INTO v_items_result
      FROM public.order_items oi
      WHERE oi.order_id = v_existing_order.id;

      RETURN jsonb_build_object(
        'success', true,
        'idempotentReplay', true,
        'orderId', v_existing_order.id,
        'orderNumber', v_existing_order.order_number,
        'customerName', COALESCE(
          v_existing_order.customer_name_snapshot,
          'زبون نقدي'
        ),
        'subtotalInMinorUnits',
          v_existing_order.subtotal_in_minor_units,
        'discountInMinorUnits',
          v_existing_order.discount_in_minor_units,
        'totalInMinorUnits', v_existing_order.total_in_minor_units,
        'amountPaidInMinorUnits',
          v_existing_order.amount_paid_in_minor_units,
        'changeDueInMinorUnits',
          v_existing_order.change_due_in_minor_units,
        'paymentMethod', v_existing_order.payment_method,
        'paymentStatus', v_existing_order.payment_status,
        'items', v_items_result
      );
    END IF;
  END IF;

  IF v_warehouse_id IS NULL THEN
    SELECT id, branch_id
    INTO v_warehouse_id, v_branch_id
    FROM public.warehouses
    WHERE is_active = true
    ORDER BY created_at
    LIMIT 1;
  ELSE
    SELECT COALESCE(v_branch_id, branch_id)
    INTO v_branch_id
    FROM public.warehouses
    WHERE id = v_warehouse_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
    END IF;
  END IF;

  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مستودع نشط لتنفيذ البيع.';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT full_name
    INTO v_customer_name
    FROM public.customers
    WHERE id = v_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'العميل المحدد غير موجود.';
    END IF;
  END IF;

  v_customer_name := COALESCE(v_customer_name, 'زبون نقدي');

  -- Lock inventory rows in a stable order and calculate canonical prices.
  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    IF v_product_id IS NULL
      OR v_quantity IS NULL
      OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'كل عنصر بيع يحتاج منتجاً وكمية صحيحة أكبر من صفر.';
    END IF;

    SELECT
      name_ar,
      sku,
      sale_price_in_minor_units
    INTO
      v_product_name,
      v_product_sku,
      v_unit_price
    FROM public.products
    WHERE id = v_product_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد منتجات سلة البيع غير موجود أو غير نشط.';
    END IF;

    SELECT on_hand_quantity, reserved_quantity
    INTO v_on_hand, v_reserved
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'المنتج (%) لا يملك رصيداً في المستودع المحدد.',
        v_product_name;
    END IF;

    IF (v_on_hand - v_reserved) < v_quantity THEN
      RAISE EXCEPTION
        'المتاح من المنتج (%) هو % حبة، والمطلوب %.',
        v_product_name,
        v_on_hand - v_reserved,
        v_quantity;
    END IF;

    v_line_total := v_unit_price * v_quantity;
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  IF p_discount_in_minor_units > v_subtotal THEN
    RAISE EXCEPTION 'خصم الفاتورة لا يمكن أن يتجاوز مجموع الأصناف.';
  END IF;

  v_total := v_subtotal - COALESCE(p_discount_in_minor_units, 0);

  IF p_payment_method = 'debt' THEN
    v_paid := 0;
    v_change := 0;
  ELSE
    v_paid := v_total;
    v_change :=
      CASE WHEN p_payment_method = 'cash'
        THEN GREATEST(
          COALESCE(p_amount_received_in_minor_units, v_total) - v_total,
          0
        )
        ELSE 0
      END;
  END IF;

  IF p_payment_method = 'cash'
    AND COALESCE(p_amount_received_in_minor_units, 0) > 0
    AND p_amount_received_in_minor_units < v_total THEN
    RAISE EXCEPTION 'المبلغ النقدي المستلم أقل من إجمالي الفاتورة.';
  END IF;

  v_order_number :=
    'POS-' ||
    TO_CHAR(NOW(), 'YYYYMMDD') ||
    '-' ||
    LPAD(NEXTVAL('public.pos_sale_number_seq')::TEXT, 6, '0');

  INSERT INTO public.orders (
    order_number,
    customer_id,
    customer_name_snapshot,
    branch_id,
    warehouse_id,
    status,
    payment_method,
    payment_status,
    subtotal_in_minor_units,
    delivery_fee_in_minor_units,
    discount_in_minor_units,
    total_in_minor_units,
    amount_paid_in_minor_units,
    change_due_in_minor_units,
    internal_notes,
    source,
    idempotency_key
  ) VALUES (
    v_order_number,
    v_customer_id,
    v_customer_name,
    v_branch_id,
    v_warehouse_id,
    'completed',
    COALESCE(p_payment_method, 'cash'),
    CASE WHEN p_payment_method = 'debt'
      THEN 'unpaid'
      ELSE 'paid'
    END,
    v_subtotal,
    0,
    COALESCE(p_discount_in_minor_units, 0),
    v_total,
    v_paid,
    v_change,
    'بيع مباشر من نقطة البيع',
    'pos',
    NULLIF(TRIM(p_idempotency_key), '')
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    SELECT
      name_ar,
      sku,
      sale_price_in_minor_units
    INTO
      v_product_name,
      v_product_sku,
      v_unit_price
    FROM public.products
    WHERE id = v_product_id;

    v_line_total := v_unit_price * v_quantity;

    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      quantity,
      unit_price_in_minor_units,
      line_total_in_minor_units
    ) VALUES (
      v_order_id,
      v_product_id,
      v_product_name,
      v_product_sku,
      v_quantity,
      v_unit_price,
      v_line_total
    );

    SELECT on_hand_quantity
    INTO v_on_hand
    FROM public.inventory_balances
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_product_id;

    v_new_on_hand := v_on_hand - v_quantity;

    UPDATE public.inventory_balances
    SET
      on_hand_quantity = v_new_on_hand,
      updated_at = NOW()
    WHERE warehouse_id = v_warehouse_id
      AND product_id = v_product_id;

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
      v_warehouse_id,
      v_product_id,
      'sales_deduction',
      -v_quantity,
      v_on_hand,
      v_new_on_hand,
      'pos_sale',
      v_order_id,
      'بيع مباشر رقم ' || v_order_number,
      v_user_id
    );
  END LOOP;

  INSERT INTO public.order_status_history (
    order_id,
    old_status,
    new_status,
    changed_by,
    notes
  ) VALUES (
    v_order_id,
    NULL,
    'completed',
    v_user_id,
    'بيع مباشر مكتمل وخصم فوري من المخزون'
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'CREATE_POS_SALE',
    'orders',
    v_order_id,
    jsonb_build_object(
      'order_number', v_order_number,
      'warehouse_id', v_warehouse_id,
      'customer_name', v_customer_name,
      'payment_method', p_payment_method,
      'subtotal_in_minor_units', v_subtotal,
      'discount_in_minor_units', p_discount_in_minor_units,
      'total_in_minor_units', v_total,
      'items_count', jsonb_array_length(p_items)
    )
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id,
    'productId', oi.product_id,
    'productName', oi.product_name_snapshot,
    'sku', oi.sku_snapshot,
    'quantity', oi.quantity,
    'unitPriceInMinorUnits', oi.unit_price_in_minor_units,
    'lineTotalInMinorUnits', oi.line_total_in_minor_units
  ) ORDER BY oi.created_at), '[]'::jsonb)
  INTO v_items_result
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotentReplay', false,
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'customerName', v_customer_name,
    'warehouseId', v_warehouse_id,
    'branchId', v_branch_id,
    'subtotalInMinorUnits', v_subtotal,
    'discountInMinorUnits', COALESCE(p_discount_in_minor_units, 0),
    'totalInMinorUnits', v_total,
    'amountPaidInMinorUnits', v_paid,
    'changeDueInMinorUnits', v_change,
    'paymentMethod', COALESCE(p_payment_method, 'cash'),
    'paymentStatus', CASE WHEN p_payment_method = 'debt'
      THEN 'unpaid'
      ELSE 'paid'
    END,
    'items', v_items_result,
    'message', 'تم حفظ البيع وخصم المخزون في Supabase بنجاح.'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- 8. Function permissions
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sync_stock_alert(
  UUID, UUID, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_stock_alert_from_balance()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_stock_alert_from_product()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_stock_alert_notifications(
  BOOLEAN, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stock_alert_notifications(
  BOOLEAN, INTEGER
) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_stock_alert_read(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_stock_alert_read(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.mark_all_stock_alerts_read()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_stock_alerts_read()
  TO authenticated;

REVOKE ALL ON FUNCTION public.update_product_master(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_master(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, INTEGER,
  BIGINT, BIGINT, BIGINT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_inventory_stock(
  UUID, UUID, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(
  UUID, UUID, INTEGER, TEXT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) TO authenticated;
