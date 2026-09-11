-- Runtime verification for Migration 103. Disposable isolated DB only.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE flavor_hardening_results (
  scenario TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'expected_safe_failure')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_owner UUID := 'a3000000-0000-0000-0000-000000000001';
  v_owner_role UUID;
  v_branch UUID := 'a3000000-0000-0000-0000-000000000010';
  v_wh_a UUID := 'a3000000-0000-0000-0000-000000000020';
  v_wh_b UUID := 'a3000000-0000-0000-0000-000000000021';
  v_category UUID := 'a3000000-0000-0000-0000-000000000030';
  v_piece UUID := 'a3000000-0000-0000-0000-000000000040';
  v_carton UUID := 'a3000000-0000-0000-0000-000000000041';
  v_supplier UUID := 'a3000000-0000-0000-0000-000000000050';
  v_master UUID := 'a3000000-0000-0000-0000-000000000060';
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_owner, 'authenticated', 'authenticated', 'flavor-owner@example.test',
    NOW(), '{}'::JSONB, '{}'::JSONB, NOW(), NOW()
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, full_name, is_active)
  VALUES (v_owner, 'مالك اختبار النكهات', true)
  ON CONFLICT (id) DO UPDATE SET is_active = true;

  INSERT INTO public.roles (code, name_ar)
  VALUES ('owner', 'مالك النظام')
  ON CONFLICT (code) DO NOTHING;
  SELECT id INTO v_owner_role FROM public.roles WHERE code = 'owner';
  INSERT INTO public.user_roles (user_id, role_id)
  VALUES (v_owner, v_owner_role)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.branches (id, code, name_ar, is_active)
  VALUES (v_branch, 'FH-BR', 'فرع اختبار النكهات', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.warehouses (id, branch_id, code, name_ar, is_active)
  VALUES
    (v_wh_a, v_branch, 'FH-WH-A', 'مستودع النكهات أ', true),
    (v_wh_b, v_branch, 'FH-WH-B', 'مستودع النكهات ب', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.categories (id, code, name_ar, is_active)
  VALUES (v_category, 'FH-CAT', 'قسم اختبار النكهات', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.units (id, code, name_ar)
  VALUES
    (v_piece, 'FH-PCS', 'حبة اختبار'),
    (v_carton, 'FH-CTN', 'كرتونة اختبار')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.suppliers (
    id, company_name, current_balance_in_minor_units
  ) VALUES (v_supplier, 'مورد اختبار النكهات', 0)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (
    id, sku, name_ar, category_id, unit_id, purchase_unit_id, sale_unit_id,
    units_per_purchase_unit, units_per_sale_unit,
    default_purchase_price_in_minor_units,
    default_sale_price_in_minor_units, cost_price_in_minor_units,
    sale_price_in_minor_units, wholesale_price_in_minor_units,
    min_stock_level, is_active, is_flavor_master
  ) VALUES (
    v_master, 'FH-MASTER', 'عصير اختبار', v_category, v_piece, v_carton,
    v_carton, 1, 1, 1000, 2000, 1000, 2000, 2000, 1, true, true
  );
END;
$$;

SELECT set_config(
  'request.jwt.claim.sub',
  'a3000000-0000-0000-0000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_master UUID := 'a3000000-0000-0000-0000-000000000060';
  v_wh_a UUID := 'a3000000-0000-0000-0000-000000000020';
  v_wh_b UUID := 'a3000000-0000-0000-0000-000000000021';
  v_branch UUID := 'a3000000-0000-0000-0000-000000000010';
  v_supplier UUID := 'a3000000-0000-0000-0000-000000000050';
  v_category UUID := 'a3000000-0000-0000-0000-000000000030';
  v_piece UUID := 'a3000000-0000-0000-0000-000000000040';
  v_carton UUID := 'a3000000-0000-0000-0000-000000000041';
  v_result JSONB;
  v_wac_child UUID;
  v_po_child UUID;
  v_created_product UUID;
  v_po_id UUID;
  v_po_item_id UUID;
  v_contract_po_id UUID;
  v_contract_po_item_id UUID;
  v_order_id UUID;
  v_before_reserved INTEGER;
  v_after_reserved INTEGER;
  v_error TEXT;
  v_count INTEGER;
  v_cost BIGINT;
  v_qty INTEGER;
BEGIN
  -- Flavor definitions are created with zero stock and no opening movement.
  v_result := public.create_product_flavor_v1(
    v_master, 'فراولة', 0, v_wh_a, NULL, 'FH-FLAVOR-STR'
  );
  v_wac_child := (v_result->>'productId')::UUID;
  v_result := public.create_product_flavor_v1(
    v_master, 'برتقال', 0, v_wh_a, NULL, 'FH-FLAVOR-ORG'
  );
  v_po_child := (v_result->>'productId')::UUID;

  SELECT COUNT(*) INTO v_count
  FROM public.inventory_movements
  WHERE product_id IN (v_wac_child, v_po_child)
    AND movement_type = 'opening_balance';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Flavor creation emitted % opening movements.', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_balances
    WHERE product_id IN (v_wac_child, v_po_child)
      AND (on_hand_quantity <> 0 OR reserved_quantity <> 0)
  ) THEN
    RAISE EXCEPTION 'Flavor creation changed inventory.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'flavor_creation_zero_stock', 'passed',
    jsonb_build_object('children', 2, 'opening_movements', 0)
  );

  -- A normal product definition is also zero-stock; a non-zero legacy request
  -- is rejected without creating a partial product or movement.
  v_result := public.create_product_with_opening_stock_v4(
    'FH-ZERO-PRODUCT', NULL, 'منتج برصيد صفر', NULL, v_category, NULL,
    v_piece, v_carton, 1, 1000, v_carton, 1, 2000, 1000, 1, NULL,
    v_wh_a, 0, 'اختبار تعريف فقط', NULL
  );
  v_created_product := (v_result->>'product_id')::UUID;
  IF COALESCE((SELECT on_hand_quantity FROM public.inventory_balances
    WHERE warehouse_id = v_wh_a AND product_id = v_created_product), 0) <> 0
     OR EXISTS (SELECT 1 FROM public.inventory_movements
       WHERE product_id = v_created_product)
  THEN
    RAISE EXCEPTION 'Zero-stock product creation changed inventory.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'product_creation_zero_stock', 'passed', '{}'
  );

  BEGIN
    PERFORM public.create_product_with_opening_stock_v4(
      'FH-LEGACY-OPENING', NULL, 'منتج افتتاحي مرفوض', NULL, v_category,
      NULL, v_piece, v_carton, 1, 1000, v_carton, 1, 2000, 1000, 1,
      NULL, v_wh_a, 5, 'يجب رفضه', NULL
    );
    RAISE EXCEPTION 'Non-zero product opening stock was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Non-zero product opening stock was accepted.' THEN RAISE; END IF;
    IF v_error NOT LIKE '%لا يُضاف مخزون أثناء إنشاء المنتج%' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'legacy_opening_stock_rejected', 'expected_safe_failure',
      jsonb_build_object('message', v_error)
    );
  END;

  -- Master balance/movement writes fail at the shared persistence boundary.
  BEGIN
    INSERT INTO public.inventory_balances (
      warehouse_id, product_id, on_hand_quantity, reserved_quantity
    ) VALUES (v_wh_a, v_master, 1, 0);
    RAISE EXCEPTION 'Master inventory balance was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Master inventory balance was accepted.' THEN RAISE; END IF;
    IF v_error NOT LIKE '%مخصص للتجميع فقط%' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'master_balance_rejected', 'expected_safe_failure', '{}'
    );
  END;

  BEGIN
    INSERT INTO public.inventory_movements (
      warehouse_id, product_id, movement_type, quantity,
      balance_before, balance_after, reference_type, notes
    ) VALUES (
      v_wh_a, v_master, 'adjustment_add', 1, 0, 1,
      'flavor_hardening_test', 'يجب رفضه'
    );
    RAISE EXCEPTION 'Master inventory movement was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Master inventory movement was accepted.' THEN RAISE; END IF;
    IF v_error NOT LIKE '%مخصص للتجميع فقط%' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'master_movement_rejected', 'expected_safe_failure', '{}'
    );
  END;

  BEGIN
    PERFORM public.create_direct_supplier_receipt(
      v_supplier, v_wh_a, v_branch, 'FH-MASTER-RECEIPT', CURRENT_DATE,
      NOW(), 0, 0, 0, 0, 'cash', NULL, 'يجب رفض Master', NULL,
      'a3000000-0000-0000-0000-000000000101',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_master, 'package_quantity', 1,
        'units_per_package', 1, 'package_price_in_minor_units', 1000,
        'discount_in_minor_units', 0, 'update_product_defaults', false
      ))
    );
    RAISE EXCEPTION 'Master direct receiving was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Master direct receiving was accepted.' THEN RAISE; END IF;
    IF v_error NOT LIKE '%مخصص للتجميع فقط%' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'master_receiving_rejected', 'expected_safe_failure', '{}'
    );
  END;

  BEGIN
    PERFORM public.adjust_inventory_stock(
      v_wh_a, v_master, 1, 'يجب رفض Master', 'manual'
    );
    RAISE EXCEPTION 'Master adjustment was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Master adjustment was accepted.' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'master_adjustment_rejected', 'expected_safe_failure',
      jsonb_build_object('message', v_error)
    );
  END;

  BEGIN
    PERFORM public.transfer_inventory_between_warehouses(
      v_master, v_wh_a, v_wh_b, 1, 'يجب رفض Master', NOW()
    );
    RAISE EXCEPTION 'Master transfer was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Master transfer was accepted.' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'master_transfer_rejected', 'expected_safe_failure',
      jsonb_build_object('message', v_error)
    );
  END;

  -- Child WAC: 10 old units at 1000 + 10 received at 3000 = 2000.
  UPDATE public.inventory_balances
  SET on_hand_quantity = 10
  WHERE warehouse_id = v_wh_a AND product_id = v_wac_child;
  v_result := public.create_direct_supplier_receipt(
    v_supplier, v_wh_a, v_branch, 'FH-WAC-RECEIPT', CURRENT_DATE, NOW(),
    0, 0, 0, 0, 'cash', NULL, 'اختبار WAC للنكهة', NULL,
    'a3000000-0000-0000-0000-000000000102',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_wac_child, 'package_quantity', 10,
      'units_per_package', 1, 'package_price_in_minor_units', 3000,
      'discount_in_minor_units', 0, 'update_product_defaults', false
    ))
  );
  SELECT cost_price_in_minor_units INTO v_cost
  FROM public.products WHERE id = v_wac_child;
  SELECT on_hand_quantity INTO v_qty FROM public.inventory_balances
  WHERE warehouse_id = v_wh_a AND product_id = v_wac_child;
  IF v_cost <> 2000 OR v_qty <> 20 THEN
    RAISE EXCEPTION 'Child WAC/quantity mismatch: cost %, quantity %.', v_cost, v_qty;
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'child_receiving_wac', 'passed',
    jsonb_build_object('old_qty', 10, 'received_qty', 10, 'wac', v_cost)
  );

  UPDATE public.products
  SET cost_price_in_minor_units = 9000
  WHERE id = v_master;
  SELECT cost_price_in_minor_units INTO v_cost
  FROM public.products WHERE id = v_wac_child;
  IF v_cost <> 2000 THEN
    RAISE EXCEPTION 'Master edit overwrote child WAC with %.', v_cost;
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'master_edit_preserves_child_wac', 'passed',
    jsonb_build_object('master_cost', 9000, 'child_cost', v_cost)
  );

  -- Child transfer and stock adjustment remain fully operational.
  PERFORM public.transfer_inventory_between_warehouses(
    v_wac_child, v_wh_a, v_wh_b, 2, 'اختبار نقل نكهة', NOW()
  );
  IF (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_wh_a AND product_id = v_wac_child) <> 18
     OR (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_wh_b AND product_id = v_wac_child) <> 2
  THEN
    RAISE EXCEPTION 'Child transfer balances are incorrect.';
  END IF;
  PERFORM public.adjust_inventory_stock(
    v_wh_b, v_wac_child, 3, 'اختبار جرد نكهة', 'stock_count'
  );
  IF (SELECT on_hand_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_wh_b AND product_id = v_wac_child) <> 3
  THEN
    RAISE EXCEPTION 'Child stock adjustment failed.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'child_transfer_and_adjustment', 'passed', '{}'
  );

  -- The payload product_id remains syntax-validated, while the locked PO item
  -- remains authoritative for valid-but-mismatched product IDs.
  v_result := public.create_purchase_order(
    v_supplier, v_branch, v_wh_a, NOW() + INTERVAL '1 day', 0, 0,
    'FH-PO-CONTRACT', 'اختبار عقد منتج الاستلام', NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_created_product, 'ordered_quantity', 2,
      'purchase_price_in_minor_units', 3000,
      'discount_in_minor_units', 0
    ))
  );
  v_contract_po_id := (v_result->>'purchase_order_id')::UUID;
  PERFORM public.update_purchase_order_status(
    v_contract_po_id, 'sent', 'إرسال اختبار العقد'
  );
  PERFORM public.update_purchase_order_status(
    v_contract_po_id, 'approved', 'اعتماد اختبار العقد'
  );
  SELECT id INTO v_contract_po_item_id
  FROM public.purchase_order_items
  WHERE purchase_order_id = v_contract_po_id
    AND product_id = v_created_product;

  BEGIN
    PERFORM public.receive_purchase_order(
      v_contract_po_id, v_wh_a, 'FH-DN-MALFORMED', 'يجب رفض UUID غير صالح',
      jsonb_build_array(jsonb_build_object(
        'purchase_order_item_id', v_contract_po_item_id,
        'product_id', 'not-a-uuid',
        'received_quantity', 1, 'unit_cost_in_minor_units', 3000
      ))
    );
    RAISE EXCEPTION 'Malformed payload product_id was accepted.';
  EXCEPTION
    WHEN invalid_text_representation THEN
      INSERT INTO flavor_hardening_results VALUES (
        'po_receiving_malformed_product_id_rejected',
        'expected_safe_failure',
        jsonb_build_object('sqlstate', SQLSTATE)
      );
  END;
  IF (SELECT received_quantity FROM public.purchase_order_items
      WHERE id = v_contract_po_item_id) <> 0
     OR EXISTS (
       SELECT 1 FROM public.purchase_receipts
       WHERE purchase_order_id = v_contract_po_id
         AND supplier_delivery_note = 'FH-DN-MALFORMED'
     )
  THEN
    RAISE EXCEPTION 'Malformed payload rejection left partial effects.';
  END IF;

  PERFORM public.receive_purchase_order(
    v_contract_po_id, v_wh_a, 'FH-DN-MISMATCH', 'توثيق المصدر الموثوق',
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', v_contract_po_item_id,
      'product_id', v_po_child,
      'received_quantity', 2, 'unit_cost_in_minor_units', 3000
    ))
  );
  IF (SELECT received_quantity FROM public.purchase_order_items
      WHERE id = v_contract_po_item_id) <> 2
     OR (SELECT on_hand_quantity FROM public.inventory_balances
       WHERE warehouse_id = v_wh_a AND product_id = v_created_product) <> 2
     OR NOT EXISTS (
       SELECT 1
       FROM public.purchase_receipt_items pri
       JOIN public.purchase_receipts pr ON pr.id = pri.purchase_receipt_id
       WHERE pr.purchase_order_id = v_contract_po_id
         AND pr.supplier_delivery_note = 'FH-DN-MISMATCH'
         AND pri.product_id = v_created_product
         AND pri.purchase_order_item_id = v_contract_po_item_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.purchase_receipt_items pri
       JOIN public.purchase_receipts pr ON pr.id = pri.purchase_receipt_id
       WHERE pr.purchase_order_id = v_contract_po_id
         AND pri.product_id = v_po_child
     )
  THEN
    RAISE EXCEPTION 'PO item did not remain the authoritative product source.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'po_receiving_mismatched_payload_uses_po_item', 'passed',
    jsonb_build_object(
      'payload_product_id', v_po_child,
      'authoritative_product_id', v_created_product
    )
  );

  -- PO receiving keeps its existing partial workflow: 10 -> 6 -> 4.
  v_result := public.create_purchase_order(
    v_supplier, v_branch, v_wh_a, NOW() + INTERVAL '1 day', 0, 0,
    'FH-PO-10', 'اختبار استلام جزئي للنكهة', NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_po_child, 'ordered_quantity', 10,
      'purchase_price_in_minor_units', 4000,
      'discount_in_minor_units', 0
    ))
  );
  v_po_id := (v_result->>'purchase_order_id')::UUID;
  PERFORM public.update_purchase_order_status(v_po_id, 'sent', 'إرسال اختبار');
  PERFORM public.update_purchase_order_status(v_po_id, 'approved', 'اعتماد اختبار');
  SELECT id INTO v_po_item_id FROM public.purchase_order_items
  WHERE purchase_order_id = v_po_id AND product_id = v_po_child;

  PERFORM public.receive_purchase_order(
    v_po_id, v_wh_a, 'FH-DN-6', 'استلام أول',
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', v_po_item_id, 'product_id', v_po_child,
      'received_quantity', 6, 'unit_cost_in_minor_units', 4000
    ))
  );
  IF (SELECT status FROM public.purchase_orders WHERE id = v_po_id)
      <> 'partially_received'
     OR (SELECT received_quantity FROM public.purchase_order_items
       WHERE id = v_po_item_id) <> 6
  THEN
    RAISE EXCEPTION 'First partial PO receipt was not persisted correctly.';
  END IF;

  PERFORM public.receive_purchase_order(
    v_po_id, v_wh_a, 'FH-DN-4', 'استلام نهائي',
    jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', v_po_item_id, 'product_id', v_po_child,
      'received_quantity', 4, 'unit_cost_in_minor_units', 4000
    ))
  );
  SELECT on_hand_quantity INTO v_qty FROM public.inventory_balances
  WHERE warehouse_id = v_wh_a AND product_id = v_po_child;
  SELECT cost_price_in_minor_units INTO v_cost
  FROM public.products WHERE id = v_po_child;
  SELECT COUNT(*) INTO v_count FROM public.inventory_movements
  WHERE warehouse_id = v_wh_a AND product_id = v_po_child
    AND movement_type = 'purchase_receipt';
  IF (SELECT status FROM public.purchase_orders WHERE id = v_po_id) <> 'received'
     OR v_qty <> 10 OR v_count <> 2 OR v_cost <> 4000
     OR (SELECT COALESCE(SUM(quantity), 0) FROM public.inventory_movements
       WHERE warehouse_id = v_wh_a AND product_id = v_po_child
         AND movement_type = 'purchase_receipt') <> 10
  THEN
    RAISE EXCEPTION '10 -> 6 -> 4 receiving reconciliation failed.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'partial_po_receiving_6_then_4', 'passed',
    jsonb_build_object(
      'received', 10, 'movements', v_count, 'weighted_cost', v_cost
    )
  );

  BEGIN
    PERFORM public.receive_purchase_order(
      v_po_id, v_wh_a, 'FH-DN-OVER', 'يجب رفضه',
      jsonb_build_array(jsonb_build_object(
        'purchase_order_item_id', v_po_item_id, 'product_id', v_po_child,
        'received_quantity', 1, 'unit_cost_in_minor_units', 4000
      ))
    );
    RAISE EXCEPTION 'Over-receiving was accepted.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error = 'Over-receiving was accepted.' THEN RAISE; END IF;
    INSERT INTO flavor_hardening_results VALUES (
      'over_receiving_rejected', 'expected_safe_failure',
      jsonb_build_object('message', v_error)
    );
  END;

  -- Reservation and cancellation operate on the child SKU, never the master.
  SELECT reserved_quantity INTO v_before_reserved
  FROM public.inventory_balances
  WHERE warehouse_id = v_wh_a AND product_id = v_wac_child;
  v_result := public.create_customer_order(
    'عميل اختبار النكهة', '0793000000', NULL,
    'إربد', 'الرمثا', 'اختبار', 'شارع اختبار', '1', NULL, NULL, NULL,
    NULL, NULL, 'عنوان اختبار', NULL, 'manual', v_branch, v_wh_a,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_wac_child, 'quantity', 1
    )),
    0, 0, 'اختبار حجز نكهة', NULL, 'website'
  );
  v_order_id := (v_result->>'order_id')::UUID;
  SELECT reserved_quantity INTO v_after_reserved
  FROM public.inventory_balances
  WHERE warehouse_id = v_wh_a AND product_id = v_wac_child;
  IF v_order_id IS NULL OR v_after_reserved <> v_before_reserved + 1 THEN
    RAISE EXCEPTION 'Child reservation did not increase exactly once.';
  END IF;
  PERFORM public.update_order_status(v_order_id, 'cancelled', 'إلغاء اختبار');
  IF (SELECT reserved_quantity FROM public.inventory_balances
      WHERE warehouse_id = v_wh_a AND product_id = v_wac_child)
      <> v_before_reserved
  THEN
    RAISE EXCEPTION 'Child reservation was not released on cancellation.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'child_reservation_and_release', 'passed', '{}'
  );

  -- Editing flavor identity preserves row identity and all historical rows.
  v_result := public.update_product_flavor_v1(
    v_wac_child, 'فراولة محدثة', 'FH-FLAVOR-STR-NEW', NULL, true
  );
  IF (v_result->>'productId')::UUID <> v_wac_child
     OR NOT EXISTS (
       SELECT 1 FROM public.inventory_movements WHERE product_id = v_wac_child
     )
  THEN
    RAISE EXCEPTION 'Flavor identity edit recreated or detached history.';
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'flavor_edit_preserves_identity_history', 'passed',
    jsonb_build_object('product_id', v_wac_child)
  );

  -- No duplicate movement/reference tuple was emitted by tested operations.
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT warehouse_id, product_id, movement_type, reference_type,
           reference_id, balance_before, balance_after, COUNT(*)
    FROM public.inventory_movements
    WHERE product_id IN (v_wac_child, v_po_child)
    GROUP BY warehouse_id, product_id, movement_type, reference_type,
             reference_id, balance_before, balance_after
    HAVING COUNT(*) > 1
  ) duplicate_movements;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Duplicate inventory movements detected: %.', v_count;
  END IF;
  INSERT INTO flavor_hardening_results VALUES (
    'no_duplicate_movements', 'passed', '{}'
  );
END;
$$;

SELECT jsonb_build_object(
  'runtime_scenarios', COUNT(*),
  'passed', COUNT(*) FILTER (
    WHERE outcome IN ('passed', 'expected_safe_failure')
  ),
  'unexpected_failures', 0,
  'scenarios', jsonb_agg(
    jsonb_build_object(
      'scenario', scenario,
      'outcome', outcome,
      'details', details
    ) ORDER BY scenario
  )
)
FROM flavor_hardening_results;

ROLLBACK;
