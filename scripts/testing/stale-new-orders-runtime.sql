-- Runtime integrity suite for migration 091.  It runs only against a
-- disposable local Supabase database and rolls every fixture back.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE stale_order_results (
  scenario TEXT PRIMARY KEY,
  passed BOOLEAN NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_branch UUID := '91000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '91000000-0000-0000-0000-000000000020';
  v_category UUID := '91000000-0000-0000-0000-000000000030';
  v_unit UUID := '91000000-0000-0000-0000-000000000040';
  v_product UUID := '91000000-0000-0000-0000-000000000050';
  v_mismatch_product UUID := '91000000-0000-0000-0000-000000000051';
  v_basic UUID := '91000000-0000-0000-0000-000000000101';
  v_good UUID := '91000000-0000-0000-0000-000000000102';
  v_mismatch UUID := '91000000-0000-0000-0000-000000000103';
  v_recent UUID := '91000000-0000-0000-0000-000000000104';
  v_historical UUID := '91000000-0000-0000-0000-000000000105';
  v_status_order UUID;
  v_result JSONB;
  v_status TEXT;
  v_reserved INTEGER;
  v_error TEXT;
  v_batch_expired INTEGER;
  v_untouched INTEGER;
BEGIN
  INSERT INTO public.branches(id, code, name_ar, is_active)
  VALUES (v_branch, 'STALE-ORDERS', 'فرع انتهاء الحجز', true);
  INSERT INTO public.warehouses(id, branch_id, code, name_ar, is_active)
  VALUES (v_warehouse, v_branch, 'STALE-WH', 'مستودع انتهاء الحجز', true);
  INSERT INTO public.categories(id, code, name_ar, is_active)
  VALUES (v_category, 'STALE-CAT', 'قسم انتهاء الحجز', true);
  INSERT INTO public.units(id, code, name_ar)
  VALUES (v_unit, 'STALE-U', 'قطعة');
  INSERT INTO public.products(
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active
  ) VALUES
    (v_product, 'STALE-001', 'صنف انتهاء الحجز', v_category, v_unit, v_unit, v_unit,
     1, 1, 100, 25, 100, 100, 1, true),
    (v_mismatch_product, 'STALE-002', 'صنف مطابقة الحجز', v_category, v_unit, v_unit, v_unit,
     1, 1, 100, 25, 100, 100, 1, true);
  INSERT INTO public.inventory_balances(warehouse_id, product_id, on_hand_quantity, reserved_quantity)
  VALUES (v_warehouse, v_product, 1000, 0), (v_warehouse, v_mismatch_product, 1000, 0);

  -- A) exact release, state/audit/history and five-hour eligibility.
  INSERT INTO public.orders(
    id, order_number, branch_id, warehouse_id, status, source,
    subtotal_in_minor_units, total_in_minor_units, reservation_expires_at
  ) VALUES (v_basic, 'STALE-BASIC-001', v_branch, v_warehouse, 'new', 'website', 200, 200, NOW() - INTERVAL '1 minute');
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  VALUES (v_basic, v_product, 'صنف انتهاء الحجز', 'STALE-001', 2, 100, 200);
  UPDATE public.inventory_balances SET reserved_quantity = 2
  WHERE warehouse_id = v_warehouse AND product_id = v_product;

  v_result := public.expire_stale_new_website_orders(100);
  SELECT status INTO v_status FROM public.orders WHERE id = v_basic;
  SELECT reserved_quantity INTO v_reserved FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_product;
  IF (v_result->>'expired_count')::INTEGER <> 1
    OR v_status <> 'expired'
    OR v_reserved <> 0
    OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_basic AND expired_at IS NOT NULL AND reservation_released_at IS NOT NULL AND expired_reason IS NOT NULL)
    OR (SELECT count(*) FROM public.order_status_history WHERE order_id = v_basic AND old_status = 'new' AND new_status = 'expired') <> 1
    OR (SELECT count(*) FROM public.audit_logs WHERE entity_id = v_basic AND action = 'EXPIRE_STALE_NEW_WEBSITE_ORDER') <> 1
  THEN RAISE EXCEPTION 'Basic expiry reconciliation failed: %', v_result; END IF;
  INSERT INTO stale_order_results VALUES ('exact_expiry_release_history_and_audit', true, v_result);

  -- B) a scheduler retry is a safe no-op.
  v_result := public.expire_stale_new_website_orders(100);
  IF (v_result->>'expired_count')::INTEGER <> 0
    OR (SELECT count(*) FROM public.order_status_history WHERE order_id = v_basic AND new_status = 'expired') <> 1
  THEN RAISE EXCEPTION 'Expiry retry was not a safe no-op: %', v_result; END IF;
  INSERT INTO stale_order_results VALUES ('repeat_expiry_no_double_release', true, v_result);

  -- D) one strict mismatch rolls the whole batch back, including a preceding valid candidate.
  INSERT INTO public.orders(id, order_number, branch_id, warehouse_id, status, source, subtotal_in_minor_units, total_in_minor_units, reservation_expires_at)
  VALUES
    (v_good, 'STALE-GOOD-ROLLBACK', v_branch, v_warehouse, 'new', 'website', 100, 100, NOW() - INTERVAL '3 minutes'),
    (v_mismatch, 'STALE-MISMATCH-ROLLBACK', v_branch, v_warehouse, 'new', 'website', 200, 200, NOW() - INTERVAL '2 minutes');
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  VALUES
    (v_good, v_product, 'صنف انتهاء الحجز', 'STALE-001', 1, 100, 100),
    (v_mismatch, v_mismatch_product, 'صنف مطابقة الحجز', 'STALE-002', 2, 100, 200);
  UPDATE public.inventory_balances SET reserved_quantity = 1 WHERE warehouse_id = v_warehouse AND product_id = v_product;
  UPDATE public.inventory_balances SET reserved_quantity = 1 WHERE warehouse_id = v_warehouse AND product_id = v_mismatch_product;
  BEGIN
    PERFORM public.expire_stale_new_website_orders(100);
    RAISE EXCEPTION 'Reservation mismatch unexpectedly succeeded.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Reservation mismatch unexpectedly succeeded.' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.orders WHERE id = v_good) <> 'new'
    OR (SELECT status FROM public.orders WHERE id = v_mismatch) <> 'new'
    OR (SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_product) <> 1
    OR (SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_mismatch_product) <> 1
    OR EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id IN (v_good, v_mismatch) AND action = 'EXPIRE_STALE_NEW_WEBSITE_ORDER')
  THEN RAISE EXCEPTION 'Mismatch left partial expiry effects.'; END IF;
  INSERT INTO stale_order_results VALUES ('mismatch_rolls_back_entire_batch', true, jsonb_build_object('error', v_error));
  DELETE FROM public.orders WHERE id IN (v_good, v_mismatch);
  UPDATE public.inventory_balances SET reserved_quantity = 0 WHERE warehouse_id = v_warehouse AND product_id IN (v_product, v_mismatch_product);

  -- E) a bounded batch releases exactly one reservation per stale order.
  WITH batch_orders AS (
    INSERT INTO public.orders(order_number, branch_id, warehouse_id, status, source, subtotal_in_minor_units, total_in_minor_units, reservation_expires_at)
    SELECT 'STALE-BATCH-' || lpad(n::TEXT, 3, '0'), v_branch, v_warehouse, 'new', 'website', 100, 100, NOW() - INTERVAL '1 minute'
    FROM generate_series(1, 100) AS n
    RETURNING id
  )
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  SELECT id, v_product, 'صنف انتهاء الحجز', 'STALE-001', 1, 100, 100 FROM batch_orders;
  UPDATE public.inventory_balances SET reserved_quantity = 100 WHERE warehouse_id = v_warehouse AND product_id = v_product;
  v_result := public.expire_stale_new_website_orders(100);
  SELECT count(*) INTO v_batch_expired FROM public.orders WHERE order_number LIKE 'STALE-BATCH-%' AND status = 'expired';
  SELECT reserved_quantity INTO v_reserved FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_product;
  IF (v_result->>'expired_count')::INTEGER <> 100 OR v_batch_expired <> 100 OR v_reserved <> 0 THEN
    RAISE EXCEPTION 'Bounded 100-order expiry was not exact: %', v_result;
  END IF;
  INSERT INTO stale_order_results VALUES ('hundred_stale_orders_exact_batch_release', true, v_result);

  -- F) newly-created orders receive exactly five hours and are untouched while recent.
  INSERT INTO public.orders(id, order_number, branch_id, warehouse_id, status, source, subtotal_in_minor_units, total_in_minor_units)
  VALUES (v_recent, 'STALE-RECENT-001', v_branch, v_warehouse, 'new', 'website', 100, 100);
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  VALUES (v_recent, v_product, 'صنف انتهاء الحجز', 'STALE-001', 1, 100, 100);
  UPDATE public.inventory_balances SET reserved_quantity = reserved_quantity + 1 WHERE warehouse_id = v_warehouse AND product_id = v_product;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = v_recent
      AND reservation_expires_at >= created_at + INTERVAL '5 hours' - INTERVAL '1 second'
      AND reservation_expires_at <= created_at + INTERVAL '5 hours' + INTERVAL '1 second'
  ) THEN RAISE EXCEPTION 'New website order did not receive a five-hour expiry.'; END IF;
  v_result := public.expire_stale_new_website_orders(100);
  IF (v_result->>'expired_count')::INTEGER <> 0 OR (SELECT status FROM public.orders WHERE id = v_recent) <> 'new' THEN
    RAISE EXCEPTION 'Recent order was expired early: %', v_result;
  END IF;
  INSERT INTO stale_order_results VALUES ('recent_order_uses_five_hours_and_is_untouched', true, v_result);

  -- H) pre-migration history has no trustworthy deadline, so it is not backfilled or released.
  ALTER TABLE public.orders DISABLE TRIGGER trg_set_website_new_order_reservation_expiry;
  INSERT INTO public.orders(id, order_number, branch_id, warehouse_id, status, source, subtotal_in_minor_units, total_in_minor_units, created_at, updated_at, reservation_expires_at)
  VALUES (v_historical, 'STALE-HISTORICAL-001', v_branch, v_warehouse, 'new', 'website', 300, 300, NOW() - INTERVAL '7 hours', NOW() - INTERVAL '7 hours', NULL);
  ALTER TABLE public.orders ENABLE TRIGGER trg_set_website_new_order_reservation_expiry;
  INSERT INTO public.order_items(order_id, product_id, product_name_snapshot, sku_snapshot, quantity, unit_price_in_minor_units, line_total_in_minor_units)
  VALUES (v_historical, v_product, 'صنف انتهاء الحجز', 'STALE-001', 3, 100, 300);
  UPDATE public.inventory_balances SET reserved_quantity = reserved_quantity + 3 WHERE warehouse_id = v_warehouse AND product_id = v_product;
  v_result := public.expire_stale_new_website_orders(100);
  IF (SELECT status FROM public.orders WHERE id = v_historical) <> 'new'
    OR (SELECT reservation_expires_at IS NULL FROM public.orders WHERE id = v_historical) IS NOT TRUE
    OR (SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_product) <> 4
  THEN RAISE EXCEPTION 'Historical order was inferred or released: %', v_result; END IF;
  INSERT INTO stale_order_results VALUES ('historical_website_new_is_not_backfilled', true, v_result);

  -- C and G) status is an absolute gate: no non-new order is ever touched.
  FOREACH v_status IN ARRAY ARRAY['cancelled', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'returned']
  LOOP
    v_status_order := gen_random_uuid();
    INSERT INTO public.orders(
      id, order_number, branch_id, warehouse_id, status, source,
      subtotal_in_minor_units, total_in_minor_units, reservation_expires_at
    ) VALUES (
      v_status_order, 'STALE-STATUS-' || v_status || '-' || substr(v_status_order::TEXT, 1, 6),
      v_branch, v_warehouse, v_status, 'website', 100, 100, NOW() - INTERVAL '1 minute'
    );
  END LOOP;
  v_result := public.expire_stale_new_website_orders(100);
  SELECT count(*) INTO v_untouched FROM public.orders
  WHERE order_number LIKE 'STALE-STATUS-%' AND status IN ('cancelled', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'returned');
  IF v_untouched <> 7 OR (v_result->>'expired_count')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'Non-new statuses were changed: %', v_result;
  END IF;
  INSERT INTO stale_order_results VALUES ('non_new_statuses_never_expire', true, jsonb_build_object('untouched', v_untouched));

  -- Reconciliation is explicit: inventory has only the recent and historical reservations.
  IF (SELECT reserved_quantity FROM public.inventory_balances WHERE warehouse_id = v_warehouse AND product_id = v_product) <> 4
    OR EXISTS (SELECT 1 FROM public.inventory_balances WHERE reserved_quantity < 0 OR available_quantity < 0)
  THEN RAISE EXCEPTION 'Inventory reconciliation failed after expiry scenarios.'; END IF;
  INSERT INTO stale_order_results VALUES ('inventory_reconciliation_after_all_scenarios', true, jsonb_build_object('reserved_quantity', 4));
END $$;

SELECT jsonb_build_object(
  'ok', bool_and(passed),
  'runtime_scenarios', count(*),
  'scenarios', jsonb_agg(scenario ORDER BY scenario)
) AS stale_new_orders_runtime_summary
FROM stale_order_results;

ROLLBACK;
