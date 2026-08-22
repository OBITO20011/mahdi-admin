-- =========================================================================
-- Nawasrah ERP - Wholesale order accounting
-- Quantities entered by a customer or POS operator are sale-package counts.
-- Inventory, COGS, and order lifecycle quantities remain base-unit counts.
-- =========================================================================

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sale_package_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS units_per_sale_package INTEGER,
  ADD COLUMN IF NOT EXISTS sale_package_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS sale_package_price_in_minor_units BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_sale_package_quantity_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_sale_package_quantity_check
      CHECK (
        sale_package_quantity IS NULL
        OR sale_package_quantity > 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_units_per_sale_package_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_units_per_sale_package_check
      CHECK (
        units_per_sale_package IS NULL
        OR units_per_sale_package > 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_sale_package_price_check'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_sale_package_price_check
      CHECK (
        sale_package_price_in_minor_units IS NULL
        OR sale_package_price_in_minor_units > 0
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.order_items.quantity IS
  'Canonical base-unit quantity used by inventory, fulfillment, COGS, and profit.';
COMMENT ON COLUMN public.order_items.sale_package_quantity IS
  'Number of full wholesale sale packages requested by the customer.';
COMMENT ON COLUMN public.order_items.units_per_sale_package IS
  'Base units contained in one sale package at order creation time.';
COMMENT ON COLUMN public.order_items.sale_package_name_snapshot IS
  'Wholesale sale package label captured at order creation time.';
COMMENT ON COLUMN public.order_items.sale_package_price_in_minor_units IS
  'Exact selling price of one full sale package at order creation time.';

-- Preserve the previously hardened base-unit RPCs as private implementation
-- details. The canonical public names below become wholesale-package wrappers.
DO $$
BEGIN
  IF to_regprocedure(
    'public.create_pos_sale_base_units_legacy(uuid,uuid,uuid,text,text,jsonb,bigint,bigint,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_pos_sale(
      UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
    ) RENAME TO create_pos_sale_base_units_legacy;
  END IF;

  IF to_regprocedure(
    'public.create_customer_order_base_units_legacy(text,text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,text,text,uuid,uuid,jsonb,bigint,bigint,text,text,text)'
  ) IS NULL THEN
    ALTER FUNCTION public.create_customer_order(
      TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
      DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
      JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
    ) RENAME TO create_customer_order_base_units_legacy;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_pos_sale_base_units_legacy(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_customer_order_base_units_legacy(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- Atomic POS sale. Incoming quantity = number of full sale packages.
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
  v_item JSONB;
  v_product_id UUID;
  v_package_quantity INTEGER;
  v_units_per_package INTEGER;
  v_package_price BIGINT;
  v_package_name TEXT;
  v_base_quantity INTEGER;
  v_line_total BIGINT;
  v_exact_subtotal BIGINT := 0;
  v_exact_total BIGINT;
  v_exact_paid BIGINT;
  v_exact_change BIGINT;
  v_base_items JSONB := '[]'::jsonb;
  v_line_snapshots JSONB := '[]'::jsonb;
  v_legacy_result JSONB;
  v_order_id UUID;
  v_order public.orders%ROWTYPE;
  v_items_result JSONB;
  v_idempotent_replay BOOLEAN := false;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'تنفيذ بيع الجملة المباشر'
  );

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة بيع الجملة فارغة.';
  END IF;

  IF COALESCE(p_discount_in_minor_units, -1) < 0 THEN
    RAISE EXCEPTION 'خصم الفاتورة لا يمكن أن يكون سالباً.';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::UUID;
      v_package_quantity := (v_item->>'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات أحد طرود البيع غير صحيحة.';
    END;

    IF v_product_id IS NULL
      OR v_package_quantity IS NULL
      OR v_package_quantity <= 0
    THEN
      RAISE EXCEPTION 'كل صنف يحتاج منتجاً وعدد طرود صحيحاً أكبر من صفر.';
    END IF;

    SELECT
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(su.name_ar, 'طرد')
    INTO
      v_units_per_package,
      v_package_price,
      v_package_name
    FROM public.products p
    LEFT JOIN public.units su ON su.id = p.sale_unit_id
    WHERE p.id = v_product_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد منتجات سلة البيع غير موجود أو غير نشط.';
    END IF;

    IF COALESCE(v_units_per_package, 0) <= 0
      OR COALESCE(v_package_price, 0) <= 0
    THEN
      RAISE EXCEPTION 'طرد بيع المنتج غير مضبوط، راجع بطاقة المنتج.';
    END IF;

    v_base_quantity := v_package_quantity * v_units_per_package;
    v_line_total := v_package_quantity * v_package_price;
    v_exact_subtotal := v_exact_subtotal + v_line_total;

    v_base_items := v_base_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'quantity', v_base_quantity
      )
    );
    v_line_snapshots := v_line_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'package_quantity', v_package_quantity,
        'units_per_package', v_units_per_package,
        'package_name', v_package_name,
        'package_price', v_package_price,
        'line_total', v_line_total
      )
    );
  END LOOP;

  IF p_discount_in_minor_units > v_exact_subtotal THEN
    RAISE EXCEPTION 'خصم الفاتورة لا يمكن أن يتجاوز مجموع طرود البيع.';
  END IF;

  v_exact_total :=
    v_exact_subtotal - COALESCE(p_discount_in_minor_units, 0);

  IF p_payment_method = 'cash'
    AND COALESCE(p_amount_received_in_minor_units, 0) > 0
    AND p_amount_received_in_minor_units < v_exact_total
  THEN
    RAISE EXCEPTION 'المبلغ النقدي المستلم أقل من إجمالي الفاتورة.';
  END IF;

  v_legacy_result := public.create_pos_sale_base_units_legacy(
    p_warehouse_id,
    p_branch_id,
    p_customer_id,
    p_customer_name,
    p_payment_method,
    v_base_items,
    0,
    CASE
      WHEN p_payment_method = 'cash'
        THEN GREATEST(
          COALESCE(p_amount_received_in_minor_units, 0),
          v_exact_total + 1000000
        )
      ELSE COALESCE(p_amount_received_in_minor_units, 0)
    END,
    p_idempotency_key
  );

  IF NOT COALESCE((v_legacy_result->>'success')::BOOLEAN, false) THEN
    RETURN v_legacy_result;
  END IF;

  v_order_id := (v_legacy_result->>'orderId')::UUID;
  v_idempotent_replay := COALESCE(
    (v_legacy_result->>'idempotentReplay')::BOOLEAN,
    false
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_line_snapshots)
  LOOP
    UPDATE public.order_items
    SET
      sale_package_quantity =
        (v_item->>'package_quantity')::INTEGER,
      units_per_sale_package =
        (v_item->>'units_per_package')::INTEGER,
      sale_package_name_snapshot = v_item->>'package_name',
      sale_package_price_in_minor_units =
        (v_item->>'package_price')::BIGINT,
      line_total_in_minor_units =
        (v_item->>'line_total')::BIGINT,
      cogs_in_minor_units =
        quantity * unit_cost_in_minor_units,
      profit_in_minor_units =
        (v_item->>'line_total')::BIGINT
        - (quantity * unit_cost_in_minor_units)
    WHERE order_id = v_order_id
      AND product_id = (v_item->>'product_id')::UUID;
  END LOOP;

  v_exact_paid := CASE
    WHEN p_payment_method = 'debt' THEN 0
    ELSE v_exact_total
  END;
  v_exact_change := CASE
    WHEN p_payment_method = 'cash' THEN
      GREATEST(
        COALESCE(p_amount_received_in_minor_units, v_exact_total)
        - v_exact_total,
        0
      )
    ELSE 0
  END;

  UPDATE public.orders
  SET
    subtotal_in_minor_units = v_exact_subtotal,
    discount_in_minor_units =
      COALESCE(p_discount_in_minor_units, 0),
    total_in_minor_units = v_exact_total,
    amount_paid_in_minor_units = v_exact_paid,
    change_due_in_minor_units = v_exact_change,
    updated_at = NOW()
  WHERE id = v_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    CASE
      WHEN v_idempotent_replay
        THEN 'REPLAY_WHOLESALE_POS_SALE'
      ELSE 'APPLY_WHOLESALE_POS_ACCOUNTING'
    END,
    'orders',
    v_order_id,
    jsonb_build_object(
      'subtotal_in_minor_units', v_exact_subtotal,
      'discount_in_minor_units',
        COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_exact_total,
      'package_lines', v_line_snapshots
    )
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', oi.id,
    'productId', oi.product_id,
    'productName', oi.product_name_snapshot,
    'sku', oi.sku_snapshot,
    'quantity', COALESCE(oi.sale_package_quantity, oi.quantity),
    'baseQuantity', oi.quantity,
    'unitsPerSalePackage',
      COALESCE(oi.units_per_sale_package, 1),
    'salePackage',
      COALESCE(oi.sale_package_name_snapshot, 'طرد'),
    'unitPriceInMinorUnits',
      COALESCE(
        oi.sale_package_price_in_minor_units,
        oi.unit_price_in_minor_units
      ),
    'lineTotalInMinorUnits', oi.line_total_in_minor_units,
    'cogsInMinorUnits', oi.cogs_in_minor_units,
    'profitInMinorUnits', oi.profit_in_minor_units
  ) ORDER BY oi.created_at), '[]'::jsonb)
  INTO v_items_result
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotentReplay', v_idempotent_replay,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'customerName',
      COALESCE(v_order.customer_name_snapshot, 'زبون نقدي'),
    'warehouseId', v_order.warehouse_id,
    'branchId', v_order.branch_id,
    'subtotalInMinorUnits', v_order.subtotal_in_minor_units,
    'discountInMinorUnits', v_order.discount_in_minor_units,
    'totalInMinorUnits', v_order.total_in_minor_units,
    'amountPaidInMinorUnits', v_order.amount_paid_in_minor_units,
    'changeDueInMinorUnits', v_order.change_due_in_minor_units,
    'paymentMethod', v_order.payment_method,
    'paymentStatus', v_order.payment_status,
    'items', v_items_result,
    'message', 'تم بيع طرود الجملة وخصم حباتها من المخزون بدقة.'
  );
END;
$$;

-- -------------------------------------------------------------------------
-- Website order. Incoming quantity = number of full sale packages.
-- The existing customer/address/order workflow remains the single source of
-- truth; this wrapper only converts quantities and applies exact package price.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_customer_full_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT DEFAULT NULL,
  p_governorate TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_area TEXT DEFAULT NULL,
  p_street TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_floor TEXT DEFAULT NULL,
  p_apartment TEXT DEFAULT NULL,
  p_address_notes TEXT DEFAULT NULL,
  p_latitude DOUBLE PRECISION DEFAULT NULL,
  p_longitude DOUBLE PRECISION DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_google_maps_url TEXT DEFAULT NULL,
  p_location_source TEXT DEFAULT 'manual',
  p_branch_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_delivery_fee_in_minor_units BIGINT DEFAULT 0,
  p_discount_in_minor_units BIGINT DEFAULT 0,
  p_customer_notes TEXT DEFAULT NULL,
  p_internal_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'website'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_package_quantity INTEGER;
  v_units_per_package INTEGER;
  v_package_price BIGINT;
  v_package_name TEXT;
  v_base_quantity INTEGER;
  v_line_total BIGINT;
  v_exact_subtotal BIGINT := 0;
  v_exact_total BIGINT;
  v_base_items JSONB := '[]'::jsonb;
  v_line_snapshots JSONB := '[]'::jsonb;
  v_legacy_result JSONB;
  v_order_id UUID;
  v_customer_id UUID;
  v_order_number TEXT;
BEGIN
  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'سلة الطلب فارغة، يجب اختيار طرد واحد على الأقل.';
  END IF;

  IF COALESCE(p_delivery_fee_in_minor_units, 0) < 0
    OR COALESCE(p_discount_in_minor_units, 0) < 0
  THEN
    RAISE EXCEPTION 'رسوم التوصيل والخصم لا يمكن أن تكون سالبة.';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_items) AS item(value)
    ORDER BY item.value->>'product_id'
  LOOP
    BEGIN
      v_product_id := (v_item->>'product_id')::UUID;
      v_package_quantity := (v_item->>'quantity')::INTEGER;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'بيانات أحد طرود الطلب غير صحيحة.';
    END;

    IF v_product_id IS NULL
      OR v_package_quantity IS NULL
      OR v_package_quantity <= 0
    THEN
      RAISE EXCEPTION 'كل صنف يحتاج منتجاً وعدد طرود صحيحاً أكبر من صفر.';
    END IF;

    SELECT
      p.units_per_sale_unit,
      p.default_sale_price_in_minor_units,
      COALESCE(su.name_ar, 'طرد')
    INTO
      v_units_per_package,
      v_package_price,
      v_package_name
    FROM public.products p
    LEFT JOIN public.units su ON su.id = p.sale_unit_id
    WHERE p.id = v_product_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد منتجات الطلب غير متاح للبيع على الموقع.';
    END IF;

    IF COALESCE(v_units_per_package, 0) <= 0
      OR COALESCE(v_package_price, 0) <= 0
    THEN
      RAISE EXCEPTION 'طرد بيع المنتج غير مضبوط، تواصل مع إدارة المتجر.';
    END IF;

    v_base_quantity := v_package_quantity * v_units_per_package;
    v_line_total := v_package_quantity * v_package_price;
    v_exact_subtotal := v_exact_subtotal + v_line_total;

    v_base_items := v_base_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'quantity', v_base_quantity
      )
    );
    v_line_snapshots := v_line_snapshots || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'package_quantity', v_package_quantity,
        'units_per_package', v_units_per_package,
        'package_name', v_package_name,
        'package_price', v_package_price,
        'line_total', v_line_total
      )
    );
  END LOOP;

  v_exact_total :=
    v_exact_subtotal
    + COALESCE(p_delivery_fee_in_minor_units, 0)
    - COALESCE(p_discount_in_minor_units, 0);

  IF v_exact_total < 0 THEN
    RAISE EXCEPTION 'قيمة الخصم أكبر من إجمالي الطلب.';
  END IF;

  v_legacy_result :=
    public.create_customer_order_base_units_legacy(
      p_customer_full_name,
      p_customer_phone,
      p_customer_email,
      p_governorate,
      p_city,
      p_area,
      p_street,
      p_building,
      p_floor,
      p_apartment,
      p_address_notes,
      p_latitude,
      p_longitude,
      p_formatted_address,
      p_google_maps_url,
      p_location_source,
      p_branch_id,
      p_warehouse_id,
      v_base_items,
      p_delivery_fee_in_minor_units,
      0,
      p_customer_notes,
      p_internal_notes,
      p_source
    );

  IF NOT COALESCE((v_legacy_result->>'success')::BOOLEAN, false) THEN
    RETURN v_legacy_result;
  END IF;

  v_order_id := (v_legacy_result->>'order_id')::UUID;
  v_customer_id := (v_legacy_result->>'customer_id')::UUID;
  v_order_number := v_legacy_result->>'order_number';

  UPDATE public.customers
  SET customer_type = 'wholesale', updated_at = NOW()
  WHERE id = v_customer_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_line_snapshots)
  LOOP
    UPDATE public.order_items
    SET
      sale_package_quantity =
        (v_item->>'package_quantity')::INTEGER,
      units_per_sale_package =
        (v_item->>'units_per_package')::INTEGER,
      sale_package_name_snapshot = v_item->>'package_name',
      sale_package_price_in_minor_units =
        (v_item->>'package_price')::BIGINT,
      line_total_in_minor_units =
        (v_item->>'line_total')::BIGINT,
      cogs_in_minor_units =
        quantity * unit_cost_in_minor_units,
      profit_in_minor_units =
        (v_item->>'line_total')::BIGINT
        - (quantity * unit_cost_in_minor_units)
    WHERE order_id = v_order_id
      AND product_id = (v_item->>'product_id')::UUID;
  END LOOP;

  UPDATE public.orders
  SET
    subtotal_in_minor_units = v_exact_subtotal,
    discount_in_minor_units =
      COALESCE(p_discount_in_minor_units, 0),
    total_in_minor_units = v_exact_total,
    whatsapp_message =
      'تم استلام طلبك رقم '
      || v_order_number
      || ' بقيمة إجمالية '
      || (v_exact_total::NUMERIC / 1000)::TEXT
      || ' د.أ. سيتم التواصل معك لتأكيد التوصيل.',
    updated_at = NOW()
  WHERE id = v_order_id;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    entity_name,
    entity_id,
    details
  ) VALUES (
    auth.uid(),
    'APPLY_WHOLESALE_CUSTOMER_ORDER_ACCOUNTING',
    'orders',
    v_order_id,
    jsonb_build_object(
      'subtotal_in_minor_units', v_exact_subtotal,
      'delivery_fee_in_minor_units',
        COALESCE(p_delivery_fee_in_minor_units, 0),
      'discount_in_minor_units',
        COALESCE(p_discount_in_minor_units, 0),
      'total_in_minor_units', v_exact_total,
      'package_lines', v_line_snapshots
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'customer_id', v_customer_id,
    'customer_address_id',
      v_legacy_result->>'customer_address_id',
    'customer_reused',
      COALESCE(
        (v_legacy_result->>'customer_reused')::BOOLEAN,
        false
      ),
    'subtotal', v_exact_subtotal,
    'total', v_exact_total,
    'status', 'new',
    'message', 'تم إنشاء طلب طرود الجملة وحجز حباتها من المخزون بدقة.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) TO anon, authenticated;

COMMENT ON FUNCTION public.create_pos_sale(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, BIGINT, BIGINT, TEXT
) IS
  'Atomic wholesale POS sale. Item quantity is sale-package count; inventory and COGS use base-unit count.';

COMMENT ON FUNCTION public.create_customer_order(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, UUID, UUID,
  JSONB, BIGINT, BIGINT, TEXT, TEXT, TEXT
) IS
  'Guest wholesale order. Creates or reuses a customer and reserves the exact base units contained in requested sale packages.';
