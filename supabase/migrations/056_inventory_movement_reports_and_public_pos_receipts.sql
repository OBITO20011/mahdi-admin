-- =========================================================================
-- Nawasrah ERP - Inventory movement reports and secure public POS receipts
-- =========================================================================

BEGIN;

-- Keep the already verified report implementation as an inaccessible base,
-- then enrich its JSON result without duplicating its financial calculations.
DO $$
BEGIN
  IF to_regprocedure(
    'public._get_operational_business_report_v1(uuid,date,date)'
  ) IS NULL THEN
    ALTER FUNCTION public.get_operational_business_report(UUID, DATE, DATE)
      RENAME TO _get_operational_business_report_v1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._get_operational_business_report_v1(
  UUID, DATE, DATE
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_operational_business_report(
  p_branch_id UUID,
  p_date_from DATE,
  p_date_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_report JSONB;
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_movement_summary JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'accountant'],
    'عرض التقارير المالية والتشغيلية'
  );

  -- The base function retains all branch/date validation and calculations.
  v_report := public._get_operational_business_report_v1(
    p_branch_id,
    p_date_from,
    p_date_to
  );

  v_period_start := p_date_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_period_end := (p_date_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';

  WITH period_movements AS (
    SELECT
      im.movement_type,
      im.product_id,
      im.quantity,
      p.name_ar AS product_name,
      p.sku
    FROM public.inventory_movements im
    JOIN public.warehouses w ON w.id = im.warehouse_id
    JOIN public.products p ON p.id = im.product_id
    WHERE w.branch_id = p_branch_id
      AND im.created_at >= v_period_start
      AND im.created_at < v_period_end
  ),
  totals AS (
    SELECT
      COUNT(*)::INTEGER AS movement_count,
      COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0)::BIGINT
        AS units_in,
      COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0)::BIGINT
        AS units_out,
      COALESCE(SUM(quantity), 0)::BIGINT AS net_units,
      COUNT(DISTINCT product_id)::INTEGER AS affected_products
    FROM period_movements
  ),
  movement_types AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'movementType', movement_type,
        'movementCount', movement_count,
        'unitsIn', units_in,
        'unitsOut', units_out,
        'netUnits', net_units
      ) ORDER BY movement_count DESC, movement_type
    ), '[]'::JSONB) AS payload
    FROM (
      SELECT
        movement_type,
        COUNT(*)::INTEGER AS movement_count,
        COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0)::BIGINT
          AS units_in,
        COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0)::BIGINT
          AS units_out,
        COALESCE(SUM(quantity), 0)::BIGINT AS net_units
      FROM period_movements
      GROUP BY movement_type
    ) grouped_types
  ),
  top_products AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'productName', product_name,
        'sku', sku,
        'movementCount', movement_count,
        'unitsIn', units_in,
        'unitsOut', units_out,
        'netUnits', net_units
      ) ORDER BY activity_units DESC, product_name
    ), '[]'::JSONB) AS payload
    FROM (
      SELECT
        product_id,
        product_name,
        COALESCE(sku, '') AS sku,
        COUNT(*)::INTEGER AS movement_count,
        COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0)::BIGINT
          AS units_in,
        COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0)::BIGINT
          AS units_out,
        COALESCE(SUM(quantity), 0)::BIGINT AS net_units,
        COALESCE(SUM(ABS(quantity)), 0)::BIGINT AS activity_units
      FROM period_movements
      GROUP BY product_id, product_name, sku
      ORDER BY activity_units DESC, product_name
      LIMIT 10
    ) ranked_products
  )
  SELECT jsonb_build_object(
    'movementCount', totals.movement_count,
    'affectedProducts', totals.affected_products,
    'unitsIn', totals.units_in,
    'unitsOut', totals.units_out,
    'netUnits', totals.net_units,
    'types', movement_types.payload,
    'topProducts', top_products.payload
  )
  INTO v_movement_summary
  FROM totals
  CROSS JOIN movement_types
  CROSS JOIN top_products;

  RETURN v_report || jsonb_build_object(
    'inventoryMovements', v_movement_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_operational_business_report(
  UUID, DATE, DATE
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_business_report(
  UUID, DATE, DATE
) TO authenticated;

-- A random token authorizes read-only access to one sanitized POS receipt.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS public_receipt_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_receipt_token
  ON public.orders(public_receipt_token)
  WHERE public_receipt_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_or_create_pos_receipt_token(
  p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_token UUID;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner', 'admin', 'manager', 'sales'],
    'إنشاء رابط إيصال البيع المباشر'
  );

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR v_order.source IS DISTINCT FROM 'pos' THEN
    RAISE EXCEPTION 'فاتورة البيع المباشر المطلوبة غير موجودة.';
  END IF;

  IF v_order.status NOT IN ('completed', 'returned') THEN
    RAISE EXCEPTION 'لا يمكن نشر رابط قبل اكتمال فاتورة البيع.';
  END IF;

  v_token := COALESCE(v_order.public_receipt_token, gen_random_uuid());

  IF v_order.public_receipt_token IS NULL THEN
    UPDATE public.orders
    SET public_receipt_token = v_token,
        updated_at = NOW()
    WHERE id = v_order.id;

    INSERT INTO public.audit_logs (
      user_id, action, entity_name, entity_id, details
    ) VALUES (
      auth.uid(),
      'CREATE_PUBLIC_POS_RECEIPT_LINK',
      'orders',
      v_order.id,
      jsonb_build_object('order_number', v_order.order_number)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'receiptToken', v_token,
    'orderNumber', v_order.order_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_pos_receipt_token(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_pos_receipt_token(UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_pos_receipt(
  p_receipt_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt JSONB;
BEGIN
  IF p_receipt_token IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'رابط الإيصال غير صحيح.'
    );
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'orderNumber', o.order_number,
    'createdAt', o.created_at,
    'status', o.status,
    'paymentMethod', o.payment_method,
    'paymentStatus', o.payment_status,
    'subtotalInMinorUnits', o.subtotal_in_minor_units,
    'discountInMinorUnits', o.discount_in_minor_units,
    'totalInMinorUnits', o.total_in_minor_units,
    'branch', jsonb_build_object(
      'name', COALESCE(b.name_ar, 'محلات النواصرة'),
      'address', COALESCE(b.address, ''),
      'phone', COALESCE(b.phone, '')
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'productName', oi.product_name_snapshot,
        'sku', COALESCE(oi.sku_snapshot, ''),
        'packageQuantity', COALESCE(oi.sale_package_quantity, oi.quantity),
        'packageName', COALESCE(oi.sale_package_name_snapshot, 'طرد'),
        'unitsPerPackage', COALESCE(oi.units_per_sale_package, 1),
        'packagePriceInMinorUnits', COALESCE(
          oi.sale_package_price_in_minor_units,
          oi.unit_price_in_minor_units
        ),
        'lineTotalInMinorUnits', oi.line_total_in_minor_units
      ) ORDER BY oi.created_at)
      FROM public.order_items oi
      WHERE oi.order_id = o.id
    ), '[]'::JSONB)
  )
  INTO v_receipt
  FROM public.orders o
  LEFT JOIN public.branches b ON b.id = o.branch_id
  WHERE o.public_receipt_token = p_receipt_token
    AND o.source = 'pos'
    AND o.status IN ('completed', 'returned');

  IF v_receipt IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'الإيصال غير موجود أو لم يعد متاحاً.'
    );
  END IF;

  RETURN v_receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_pos_receipt(UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_pos_receipt(UUID)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_pos_receipt(UUID) IS
  'Returns one token-authorized sanitized POS receipt without customer, cost, or profit data.';

COMMIT;
