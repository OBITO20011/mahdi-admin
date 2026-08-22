-- =========================================================================
-- Nawasrah ERP - Audited bulk opening inventory setup
-- Existing physical stock is loaded without supplier invoices or liabilities.
-- All quantities are integer base units; the UI submits packages + loose units.
-- =========================================================================

CREATE SEQUENCE IF NOT EXISTS public.inventory_opening_session_number_seq
  START 1001;

CREATE TABLE IF NOT EXISTS public.inventory_opening_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number TEXT UNIQUE NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_previous_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_previous_quantity >= 0),
  total_actual_quantity INTEGER NOT NULL DEFAULT 0 CHECK (total_actual_quantity >= 0),
  total_quantity_change INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status = 'applied'),
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_opening_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL
    REFERENCES public.inventory_opening_sessions(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  purchase_package_name TEXT NOT NULL,
  base_unit_name TEXT NOT NULL,
  units_per_package INTEGER NOT NULL CHECK (units_per_package > 0),
  package_count INTEGER NOT NULL CHECK (package_count >= 0),
  loose_units INTEGER NOT NULL CHECK (loose_units >= 0),
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
  actual_quantity INTEGER NOT NULL CHECK (actual_quantity >= 0),
  quantity_change INTEGER NOT NULL,
  cost_price_in_minor_units BIGINT NOT NULL
    CHECK (cost_price_in_minor_units >= 0),
  movement_id UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_opening_items_session_product_key
    UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_opening_sessions_warehouse_created
  ON public.inventory_opening_sessions(warehouse_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_opening_items_product
  ON public.inventory_opening_items(product_id, created_at DESC);

ALTER TABLE public.inventory_opening_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_opening_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_opening_sessions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.inventory_opening_items
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.inventory_opening_session_number_seq
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_opening_setup(
  p_warehouse_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_warehouse public.warehouses%ROWTYPE;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'عرض تهيئة المخزون الافتتاحي'
  );

  SELECT * INTO v_warehouse
  FROM public.warehouses
  WHERE id = p_warehouse_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'warehouse', jsonb_build_object(
      'id', v_warehouse.id,
      'branchId', v_warehouse.branch_id,
      'name', v_warehouse.name_ar
    ),
    'products', COALESCE((
      SELECT jsonb_agg(product_payload ORDER BY product_name, sku)
      FROM (
        SELECT
          p.name_ar AS product_name,
          p.sku,
          jsonb_build_object(
            'productId', p.id,
            'sku', p.sku,
            'barcode', p.barcode,
            'productName', p.name_ar,
            'purchasePackageName', COALESCE(pu.name_ar, bu.name_ar, 'طرد'),
            'baseUnitName', COALESCE(bu.name_ar, 'قطعة'),
            'unitsPerPackage', GREATEST(1, COALESCE(p.units_per_purchase_unit, 1)),
            'currentQuantity', COALESCE(ib.on_hand_quantity, 0),
            'reservedQuantity', COALESCE(ib.reserved_quantity, 0),
            'costPriceInMinorUnits', p.cost_price_in_minor_units,
            'defaultPurchasePriceInMinorUnits',
              COALESCE(p.default_purchase_price_in_minor_units, 0),
            'hasOperationalMovements', EXISTS (
              SELECT 1
              FROM public.inventory_movements im
              WHERE im.warehouse_id = p_warehouse_id
                AND im.product_id = p.id
                AND im.movement_type IN (
                  'purchase_receipt',
                  'sales_deduction',
                  'transfer_in',
                  'transfer_out',
                  'return_in',
                  'return_out'
                )
            ),
            'eligible',
              COALESCE(ib.reserved_quantity, 0) = 0
              AND NOT EXISTS (
                SELECT 1
                FROM public.inventory_movements im
                WHERE im.warehouse_id = p_warehouse_id
                  AND im.product_id = p.id
                  AND im.movement_type IN (
                    'purchase_receipt',
                    'sales_deduction',
                    'transfer_in',
                    'transfer_out',
                    'return_in',
                    'return_out'
                  )
              ),
            'blockReason', CASE
              WHEN COALESCE(ib.reserved_quantity, 0) > 0
                THEN 'يوجد مخزون محجوز لطلبات حالية؛ عالج الطلبات أولاً.'
              WHEN EXISTS (
                SELECT 1
                FROM public.inventory_movements im
                WHERE im.warehouse_id = p_warehouse_id
                  AND im.product_id = p.id
                  AND im.movement_type IN (
                    'purchase_receipt',
                    'sales_deduction',
                    'transfer_in',
                    'transfer_out',
                    'return_in',
                    'return_out'
                  )
              )
                THEN 'بدأت حركات هذا الصنف؛ استخدم الجرد الموثق بدلاً من الرصيد الافتتاحي.'
              ELSE NULL
            END
          ) AS product_payload
        FROM public.products p
        LEFT JOIN public.units bu ON bu.id = p.unit_id
        LEFT JOIN public.units pu ON pu.id = p.purchase_unit_id
        LEFT JOIN public.inventory_balances ib
          ON ib.product_id = p.id
         AND ib.warehouse_id = p_warehouse_id
        WHERE p.is_active = true
      ) product_rows
    ), '[]'::jsonb),
    'recentSessions', COALESCE((
      SELECT jsonb_agg(session_payload ORDER BY created_at DESC)
      FROM (
        SELECT
          ios.created_at,
          jsonb_build_object(
            'id', ios.id,
            'sessionNumber', ios.session_number,
            'itemCount', ios.item_count,
            'totalPreviousQuantity', ios.total_previous_quantity,
            'totalActualQuantity', ios.total_actual_quantity,
            'totalQuantityChange', ios.total_quantity_change,
            'notes', ios.notes,
            'createdByName', COALESCE(pr.full_name, 'مستخدم النظام'),
            'createdAt', ios.created_at
          ) AS session_payload
        FROM public.inventory_opening_sessions ios
        LEFT JOIN public.profiles pr ON pr.id = ios.created_by
        WHERE ios.warehouse_id = p_warehouse_id
        ORDER BY ios.created_at DESC
        LIMIT 5
      ) session_rows
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_inventory_opening_setup(
  p_warehouse_id UUID,
  p_rows JSONB,
  p_notes TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_warehouse public.warehouses%ROWTYPE;
  v_existing_session public.inventory_opening_sessions%ROWTYPE;
  v_session_id UUID;
  v_session_number TEXT;
  v_row JSONB;
  v_product_id UUID;
  v_product_name TEXT;
  v_cost_price_in_minor_units BIGINT;
  v_purchase_package_name TEXT;
  v_base_unit_name TEXT;
  v_units_per_package INTEGER;
  v_package_count INTEGER;
  v_loose_units INTEGER;
  v_actual_quantity_big BIGINT;
  v_actual_quantity INTEGER;
  v_previous_quantity INTEGER;
  v_reserved_quantity INTEGER;
  v_quantity_change INTEGER;
  v_movement_id UUID;
  v_item_count INTEGER := 0;
  v_total_previous INTEGER := 0;
  v_total_actual INTEGER := 0;
  v_total_change INTEGER := 0;
  v_notes TEXT := NULLIF(TRIM(p_notes), '');
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'warehouse_keeper'],
    'اعتماد تهيئة المخزون الافتتاحي'
  );

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'المستودع مطلوب.';
  END IF;
  IF v_notes IS NULL OR CHAR_LENGTH(v_notes) < 5 THEN
    RAISE EXCEPTION 'اكتب ملاحظة واضحة لجلسة المخزون الافتتاحي.';
  END IF;
  IF CHAR_LENGTH(v_notes) > 500 THEN
    RAISE EXCEPTION 'ملاحظة جلسة المخزون الافتتاحي أطول من المسموح.';
  END IF;
  IF NULLIF(TRIM(p_idempotency_key), '') IS NULL
    OR CHAR_LENGTH(TRIM(p_idempotency_key)) < 16
    OR CHAR_LENGTH(TRIM(p_idempotency_key)) > 100
  THEN
    RAISE EXCEPTION 'مفتاح منع التكرار غير صالح.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'بيانات أصناف المخزون الافتتاحي غير صحيحة.';
  END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'اختر صنفاً واحداً على الأقل وبحد أقصى 500 صنف.';
  END IF;
  IF (
    SELECT COUNT(*)
    FROM jsonb_array_elements(p_rows)
  ) <> (
    SELECT COUNT(DISTINCT row_data->>'productId')
    FROM jsonb_array_elements(p_rows) row_data
  ) THEN
    RAISE EXCEPTION 'لا يمكن تكرار الصنف داخل جلسة التهيئة.';
  END IF;

  -- Serialize concurrent retries that carry the same idempotency key.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(TRIM(p_idempotency_key), 0)
  );

  SELECT * INTO v_existing_session
  FROM public.inventory_opening_sessions
  WHERE idempotency_key = TRIM(p_idempotency_key);

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotentReplay', true,
      'sessionId', v_existing_session.id,
      'sessionNumber', v_existing_session.session_number,
      'itemCount', v_existing_session.item_count,
      'totalActualQuantity', v_existing_session.total_actual_quantity,
      'message', 'تم اعتماد جلسة المخزون الافتتاحي سابقاً دون تكرار الحركات.'
    );
  END IF;

  SELECT * INTO v_warehouse
  FROM public.warehouses
  WHERE id = p_warehouse_id
    AND is_active = true
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المستودع المحدد غير موجود أو غير نشط.';
  END IF;

  v_session_id := gen_random_uuid();
  v_session_number :=
    'IOS-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    LPAD(nextval('public.inventory_opening_session_number_seq')::TEXT, 6, '0');

  INSERT INTO public.inventory_opening_sessions (
    id,
    session_number,
    idempotency_key,
    branch_id,
    warehouse_id,
    notes,
    created_by
  ) VALUES (
    v_session_id,
    v_session_number,
    TRIM(p_idempotency_key),
    v_warehouse.branch_id,
    p_warehouse_id,
    v_notes,
    v_user_id
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_row) <> 'object'
      OR COALESCE(v_row->>'productId', '') = ''
      OR COALESCE(v_row->>'packageCount', '') !~ '^\d+$'
      OR COALESCE(v_row->>'looseUnits', '') !~ '^\d+$'
    THEN
      RAISE EXCEPTION 'بيانات أحد الأصناف غير صحيحة.';
    END IF;

    v_product_id := (v_row->>'productId')::UUID;
    v_package_count := (v_row->>'packageCount')::INTEGER;
    v_loose_units := (v_row->>'looseUnits')::INTEGER;

    SELECT
      p.name_ar,
      p.cost_price_in_minor_units,
      COALESCE(pu.name_ar, bu.name_ar, 'طرد'),
      COALESCE(bu.name_ar, 'قطعة'),
      GREATEST(1, COALESCE(p.units_per_purchase_unit, 1))
    INTO
      v_product_name,
      v_cost_price_in_minor_units,
      v_purchase_package_name,
      v_base_unit_name,
      v_units_per_package
    FROM public.products p
    LEFT JOIN public.units bu ON bu.id = p.unit_id
    LEFT JOIN public.units pu ON pu.id = p.purchase_unit_id
    WHERE p.id = v_product_id
      AND p.is_active = true
    FOR SHARE OF p;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد الأصناف غير موجود أو غير نشط.';
    END IF;
    IF v_loose_units >= v_units_per_package THEN
      RAISE EXCEPTION
        'الحبات المتبقية للصنف (%) يجب أن تكون أقل من محتوى الطرد (%).',
        v_product_name,
        v_units_per_package;
    END IF;

    v_actual_quantity_big :=
      v_package_count::BIGINT * v_units_per_package + v_loose_units;
    IF v_actual_quantity_big > 2147483647 THEN
      RAISE EXCEPTION 'كمية الصنف (%) أكبر من الحد المسموح.', v_product_name;
    END IF;
    v_actual_quantity := v_actual_quantity_big::INTEGER;

    IF v_actual_quantity > 0 AND v_cost_price_in_minor_units <= 0 THEN
      RAISE EXCEPTION
        'لا يمكن اعتماد مخزون للصنف (%) قبل إدخال تكلفة الشراء.',
        v_product_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements im
      WHERE im.warehouse_id = p_warehouse_id
        AND im.product_id = v_product_id
        AND im.movement_type IN (
          'purchase_receipt',
          'sales_deduction',
          'transfer_in',
          'transfer_out',
          'return_in',
          'return_out'
        )
    ) THEN
      RAISE EXCEPTION
        'بدأت حركات الصنف (%). استخدم الجرد الموثق بدلاً من الرصيد الافتتاحي.',
        v_product_name;
    END IF;

    INSERT INTO public.inventory_balances (
      warehouse_id,
      product_id,
      on_hand_quantity,
      reserved_quantity
    ) VALUES (
      p_warehouse_id,
      v_product_id,
      0,
      0
    ) ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    SELECT on_hand_quantity, reserved_quantity
    INTO v_previous_quantity, v_reserved_quantity
    FROM public.inventory_balances
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product_id
    FOR UPDATE;

    IF v_reserved_quantity > 0 THEN
      RAISE EXCEPTION
        'الصنف (%) عليه كمية محجوزة. عالج الطلبات قبل التهيئة.',
        v_product_name;
    END IF;

    v_quantity_change := v_actual_quantity - v_previous_quantity;
    v_movement_id := NULL;

    UPDATE public.inventory_balances
    SET
      on_hand_quantity = v_actual_quantity,
      updated_at = NOW()
    WHERE warehouse_id = p_warehouse_id
      AND product_id = v_product_id;

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
        v_product_id,
        'opening_balance',
        v_quantity_change,
        v_previous_quantity,
        v_actual_quantity,
        'inventory_opening_session',
        v_session_id,
        v_notes || ' - ' || v_session_number,
        v_user_id
      ) RETURNING id INTO v_movement_id;
    END IF;

    INSERT INTO public.inventory_opening_items (
      session_id,
      product_id,
      purchase_package_name,
      base_unit_name,
      units_per_package,
      package_count,
      loose_units,
      previous_quantity,
      actual_quantity,
      quantity_change,
      cost_price_in_minor_units,
      movement_id
    ) VALUES (
      v_session_id,
      v_product_id,
      v_purchase_package_name,
      v_base_unit_name,
      v_units_per_package,
      v_package_count,
      v_loose_units,
      v_previous_quantity,
      v_actual_quantity,
      v_quantity_change,
      v_cost_price_in_minor_units,
      v_movement_id
    );

    v_item_count := v_item_count + 1;
    v_total_previous := v_total_previous + v_previous_quantity;
    v_total_actual := v_total_actual + v_actual_quantity;
    v_total_change := v_total_change + v_quantity_change;
  END LOOP;

  UPDATE public.inventory_opening_sessions
  SET
    item_count = v_item_count,
    total_previous_quantity = v_total_previous,
    total_actual_quantity = v_total_actual,
    total_quantity_change = v_total_change
  WHERE id = v_session_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    v_user_id,
    'APPLY_INVENTORY_OPENING_SETUP',
    'inventory_opening_sessions',
    v_session_id,
    jsonb_build_object(
      'session_number', v_session_number,
      'warehouse_id', p_warehouse_id,
      'branch_id', v_warehouse.branch_id,
      'item_count', v_item_count,
      'total_previous_quantity', v_total_previous,
      'total_actual_quantity', v_total_actual,
      'total_quantity_change', v_total_change,
      'notes', v_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'sessionId', v_session_id,
    'sessionNumber', v_session_number,
    'itemCount', v_item_count,
    'totalPreviousQuantity', v_total_previous,
    'totalActualQuantity', v_total_actual,
    'totalQuantityChange', v_total_change,
    'message',
      'تم اعتماد المخزون الافتتاحي وتسجيل الحركات دون إنشاء فاتورة مورد أو مديونية.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_opening_setup(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_inventory_opening_setup(
  UUID, JSONB, TEXT, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_inventory_opening_setup(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_inventory_opening_setup(
  UUID, JSONB, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.apply_inventory_opening_setup(
  UUID, JSONB, TEXT, TEXT
) IS
  'Atomically sets audited opening stock targets without supplier accounting.';
