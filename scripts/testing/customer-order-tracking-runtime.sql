-- F2 runtime verification. Run only against the disposable isolated database.
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_category UUID;
  v_unit UUID;
  v_warehouse UUID;
  v_product_id UUID := '89000000-0000-4000-8900-000000000001'::UUID;
  v_result JSONB;
  v_replay JSONB;
  v_tracking JSONB;
  v_invalid_tracking JSONB;
  v_token UUID;
BEGIN
  SELECT id INTO v_category FROM public.categories ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_unit FROM public.units ORDER BY created_at, id LIMIT 1;
  SELECT id INTO v_warehouse
  FROM public.warehouses
  WHERE is_active
  ORDER BY created_at, id
  LIMIT 1;

  IF v_category IS NULL OR v_unit IS NULL OR v_warehouse IS NULL THEN
    RAISE EXCEPTION 'F2 isolated seed prerequisites are missing.';
  END IF;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES (
    v_product_id, 'F2-TRACK-001', 'صنف تتبع F2', v_category, v_unit, v_unit, v_unit,
    1, 1, 1275, 500, 1275, 1275, 1, true, false
  ) ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.inventory_balances (
    warehouse_id, product_id, on_hand_quantity, reserved_quantity
  ) VALUES (v_warehouse, v_product_id, 10, 0)
  ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET on_hand_quantity = 10, reserved_quantity = 0;

  UPDATE public.storefront_settings
  SET orders_enabled = true,
      minimum_order_in_minor_units = 0,
      inside_ramtha_delivery_fee_in_minor_units = 0,
      outside_ramtha_delivery_fee_in_minor_units = 0
  WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

  v_result := public.submit_guest_customer_order(
    '89000000-0000-4000-8910-000000000001',
    'عميل تتبع F2', '0797001090', 'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار',
    NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
    NULL, 'cash_on_delivery', 'inside_ramtha'
  );

  v_token := (v_result->>'tracking_token')::UUID;
  IF NOT COALESCE((v_result->>'success')::BOOLEAN, false)
    OR v_token IS NULL
    OR v_result->>'tracking_path' <> '/#track=' || v_token::TEXT
  THEN
    RAISE EXCEPTION 'Accepted guest order did not return its opaque tracking capability: %', v_result;
  END IF;

  v_replay := public.submit_guest_customer_order(
    '89000000-0000-4000-8910-000000000001',
    'عميل تتبع F2', '0797001090', 'إربد', 'الرمثا', 'حي الاختبار', 'شارع الاختبار',
    NULL, NULL, NULL, NULL, NULL, NULL,
    jsonb_build_array(jsonb_build_object('product_id', v_product_id, 'quantity', 1)),
    NULL, 'cash_on_delivery', 'inside_ramtha'
  );

  IF NOT COALESCE((v_replay->>'idempotent_replay')::BOOLEAN, false)
    OR (v_replay->>'tracking_token')::UUID IS DISTINCT FROM v_token
  THEN
    RAISE EXCEPTION 'Idempotent checkout replay did not return the original tracking token.';
  END IF;

  v_tracking := public.track_guest_order_by_token(v_token::TEXT);
  IF NOT COALESCE((v_tracking->>'success')::BOOLEAN, false)
    OR v_tracking ? 'customer_phone'
    OR v_tracking ? 'customer_address'
    OR v_tracking ? 'google_maps_url'
    OR v_tracking ? 'latitude'
    OR v_tracking ? 'longitude'
  THEN
    RAISE EXCEPTION 'Public tracking payload failed its privacy boundary: %', v_tracking;
  END IF;

  v_invalid_tracking := public.track_guest_order_by_token(
    '89000000-0000-4000-8999-000000000099'
  );
  IF COALESCE((v_invalid_tracking->>'success')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'Invalid tracking token unexpectedly returned an order.';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.submit_guest_customer_order(text,text,text,text,text,text,text,text,text,text,double precision,double precision,text,jsonb,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'F2 changed the gateway-only execution boundary.';
  END IF;
END;
$$;

SELECT jsonb_build_object(
  'ok', true,
  'accepted_order_receives_opaque_token', true,
  'idempotent_replay_receives_same_token', true,
  'tracking_payload_is_customer_pii_free', true,
  'invalid_token_denied', true,
  'gateway_only_contract_preserved', true
);

ROLLBACK;
