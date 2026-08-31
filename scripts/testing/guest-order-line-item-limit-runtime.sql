-- M5 runtime verification: the private checkout core must reserve exactly the
-- requested fifty distinct product rows, reject fifty-one atomically, and keep
-- exact sellable product IDs as independent line items.
DO $$
DECLARE
  v_category UUID;
  v_unit UUID;
  v_warehouse UUID;
  v_items_30 JSONB;
  v_items_50 JSONB;
  v_items_51 JSONB;
  v_result JSONB;
  v_orders_before INTEGER;
  v_reserved_before NUMERIC;
  v_reserved_after NUMERIC;
  v_rejected BOOLEAN := false;
BEGIN
  SELECT id INTO v_category FROM public.categories ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_unit FROM public.units ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_warehouse
  FROM public.warehouses
  WHERE is_active
  ORDER BY created_at, id
  LIMIT 1;

  IF v_category IS NULL OR v_unit IS NULL OR v_warehouse IS NULL THEN
    RAISE EXCEPTION 'M5 isolated seed prerequisites are missing.';
  END IF;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  )
  SELECT
    format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0'))::UUID,
    format('M5-LINE-%s', lpad(sequence::TEXT, 2, '0')),
    format('صنف M5 %s', sequence),
    v_category, v_unit, v_unit, v_unit,
    1, 1, 1275, 500, 1275, 1275, 1, true, false
  FROM generate_series(1, 51) AS sequence
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  )
  SELECT
    v_warehouse,
    format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0'))::UUID,
    20,
    0
  FROM generate_series(1, 51) AS sequence
  ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET on_hand_quantity = 20, reserved_quantity = 0;

  UPDATE public.storefront_settings
  SET orders_enabled = true,
      minimum_order_in_minor_units = 0,
      inside_ramtha_delivery_fee_in_minor_units = 0,
      outside_ramtha_delivery_fee_in_minor_units = 0
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0')),
    'quantity', 1
  ) ORDER BY sequence)
  INTO v_items_30
  FROM generate_series(1, 30) AS sequence;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0')),
    'quantity', 1
  ) ORDER BY sequence)
  INTO v_items_50
  FROM generate_series(1, 50) AS sequence;

  SELECT jsonb_agg(jsonb_build_object(
    'product_id', format('87000000-0000-4000-8700-%s', lpad(sequence::TEXT, 12, '0')),
    'quantity', 1
  ) ORDER BY sequence)
  INTO v_items_51
  FROM generate_series(1, 51) AS sequence;

  v_result := public.submit_guest_customer_order(
    '87000000-0000-4000-8710-000000000030', 'عميل M5 ثلاثون', '0797001030',
    'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار', NULL, NULL, NULL,
    NULL, NULL, NULL, v_items_30, NULL, 'cash_on_delivery', 'inside_ramtha'
  );
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'Thirty-item checkout was rejected: %', v_result;
  END IF;

  v_result := public.submit_guest_customer_order(
    '87000000-0000-4000-8710-000000000050', 'عميل M5 خمسون', '0797001050',
    'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار', NULL, NULL, NULL,
    NULL, NULL, NULL, v_items_50, NULL, 'cash_on_delivery', 'inside_ramtha'
  );
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'Fifty-item checkout was rejected: %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_orders_before
  FROM public.orders
  WHERE idempotency_key IN (
    '87000000-0000-4000-8710-000000000030',
    '87000000-0000-4000-8710-000000000050'
  );
  SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved_before
  FROM public.inventory_balances
  WHERE product_id::TEXT LIKE '87000000-0000-4000-8700-%';

  BEGIN
    PERFORM public.submit_guest_customer_order(
      '87000000-0000-4000-8710-000000000051', 'عميل M5 واحد وخمسون', '0797001051',
      'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار', NULL, NULL, NULL,
      NULL, NULL, NULL, v_items_51, NULL, 'cash_on_delivery', 'inside_ramtha'
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_rejected := SQLERRM LIKE '%عدد الأصناف في الطلب أكبر من الحد المسموح%';
  END;

  SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved_after
  FROM public.inventory_balances
  WHERE product_id::TEXT LIKE '87000000-0000-4000-8700-%';

  IF NOT v_rejected
    OR v_orders_before <> 2
    OR v_reserved_before <> 80
    OR v_reserved_after <> v_reserved_before
    OR (SELECT COUNT(*) FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.idempotency_key = '87000000-0000-4000-8710-000000000050') <> 50
  THEN
    RAISE EXCEPTION 'M5 limit or reservation reconciliation failed.';
  END IF;
END;
$$;

SELECT json_build_object(
  'ok', true,
  'thirty_line_items', true,
  'fifty_line_items', true,
  'fifty_one_rejected_without_effects', true,
  'fifty_item_order_rows', (
    SELECT COUNT(*)
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.idempotency_key = '87000000-0000-4000-8710-000000000050'
  ),
  'reserved_packages_across_test_items', (
    SELECT COALESCE(SUM(reserved_quantity), 0)
    FROM public.inventory_balances
    WHERE product_id::TEXT LIKE '87000000-0000-4000-8700-%'
  )
);
