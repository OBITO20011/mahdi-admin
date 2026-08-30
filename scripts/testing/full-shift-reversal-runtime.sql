-- Runtime integration coverage for migration 084.  It is destructive only in
-- the disposable isolated Supabase database.  The scenario matrix is expanded
-- by the Node concurrency driver after this deterministic base suite.
\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE full_shift_reversal_results (
  scenario TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('pass', 'expected_blocked')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
) ON COMMIT PRESERVE ROWS;

SELECT set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);

DO $$
DECLARE
  v_owner UUID := '83000000-0000-0000-0000-000000000001';
  v_branch UUID := '84000000-0000-0000-0000-000000000010';
  v_warehouse UUID := '84000000-0000-0000-0000-000000000020';
  v_category UUID := '84000000-0000-0000-0000-000000000030';
  v_unit UUID := '84000000-0000-0000-0000-000000000040';
  v_supplier UUID := '83000000-0000-0000-0000-000000000050';
  v_customer UUID := '83000000-0000-0000-0000-000000000060';
  v_product UUID := '84000000-0000-0000-0000-000000000070';
  v_supplier_product UUID := '84000000-0000-0000-0000-000000000071';
  v_shift UUID;
  v_pos_order UUID;
  v_web_order UUID := '84000000-0000-0000-0000-000000000081';
  v_customer_payment UUID;
  v_expense UUID;
  v_receipt UUID;
  v_supplier_payment UUID;
  v_result JSONB;
  v_preview JSONB;
  v_before_stock INTEGER;
  v_after_stock INTEGER;
  v_error TEXT;
  v_blocked_shift UUID;
  v_blocked_order UUID;
BEGIN
  INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(v_branch,'FULL-REV-01','فرع عكس وردية كامل',true) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(v_warehouse,v_branch,'FULL-REV-WH','مستودع عكس وردية كامل',true) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.categories(id,code,name_ar,is_active) VALUES(v_category,'FULL-REV-CAT','قسم عكس وردية كامل',true) ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.units(id,code,name_ar) VALUES(v_unit,'FULL-REV-U','قطعة') ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active)
  VALUES(v_product,'FULL-REV-001','صنف عكس وردية',v_category,v_unit,v_unit,v_unit,1,1,1275,100,1275,1275,1,true)
  ON CONFLICT(id) DO UPDATE SET is_active=true;
  INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,min_stock_level,is_active)
  VALUES(v_supplier_product,'FULL-REV-SUP-001','صنف مورد عكس وردية',v_category,v_unit,v_unit,v_unit,1,1,500,100,500,500,1,true)
  ON CONFLICT(id) DO UPDATE SET is_active=true;
  INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES(v_warehouse,v_product,100,0) ON CONFLICT(warehouse_id,product_id) DO UPDATE SET on_hand_quantity=100,reserved_quantity=0;

  v_result := public.open_cash_shift(v_branch,0);
  v_shift := (v_result->>'id')::UUID;
  SELECT on_hand_quantity INTO v_before_stock FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product;

  v_result := public.create_pos_sale(v_warehouse,v_branch,NULL,'عميل نقدي','cash',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),5,0,'full-shift-pos-sale-key-00000000001');
  v_pos_order := (v_result->>'orderId')::UUID;

  INSERT INTO public.orders(id,order_number,customer_id,branch_id,warehouse_id,status,payment_method,payment_status,subtotal_in_minor_units,discount_in_minor_units,total_in_minor_units,amount_paid_in_minor_units,source,created_at,updated_at)
  VALUES(v_web_order,'FULL-REV-WEB-001',v_customer,v_branch,v_warehouse,'completed','debt','unpaid',500,0,500,0,'website',NOW(),NOW());
  v_result := public.record_customer_order_payment_once(v_web_order,500,'cash',NULL,'قبض ضمن الوردية','full-shift-customer-payment-key-000001');
  v_customer_payment := (v_result->>'payment_id')::UUID;

  v_result := public.create_operational_expense(v_branch,'اختبار','مصروف ضمن عكس الوردية',275,'cliq','FULL-REV-CLIQ');
  SELECT id INTO v_expense FROM public.operational_expenses WHERE shift_id=v_shift ORDER BY created_at DESC LIMIT 1;

  v_result := public.create_direct_supplier_receipt(v_supplier,v_warehouse,v_branch,'FULL-REV-SUP-INV',CURRENT_DATE,NOW(),0,0,0,0,'cash',NULL,'استلام مورد للاختبار',NULL,'84000000-0000-0000-0000-000000000101',jsonb_build_array(jsonb_build_object('product_id',v_supplier_product,'package_quantity',1,'units_per_package',1,'package_price_in_minor_units',500,'discount_in_minor_units',0,'update_product_defaults',false)));
  v_receipt := (v_result->>'receipt_id')::UUID;
  v_result := public.record_supplier_receipt_payment(v_receipt,500,'cash',NULL,'دفع مورد ضمن الوردية','full-shift-supplier-payment-key-000001');
  v_supplier_payment := (v_result->>'payment_id')::UUID;

  v_preview := public.preview_cash_shift_full_reversal(v_shift);
  IF NOT COALESCE((v_preview->>'canExecute')::BOOLEAN,false)
    OR jsonb_array_length(v_preview->'operations') <> 4
    OR (v_preview->'summary'->>'cash_in_minor_units')::BIGINT <> -1270
    OR (v_preview->'summary'->>'cliq_in_minor_units')::BIGINT <> 275
  THEN RAISE EXCEPTION 'Supported full reversal preview is not reconciled: %',v_preview; END IF;
  INSERT INTO full_shift_reversal_results VALUES('supported_preview_all_operation_types','pass',v_preview);

  v_result := public.reverse_cash_shift_with_operations(v_shift,'اختبار عكس الوردية بكامل العمليات','full-shift-reversal-key-000000000001');
  SELECT on_hand_quantity INTO v_after_stock FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product;
  IF NOT COALESCE((v_result->>'success')::BOOLEAN,false)
    OR v_after_stock <> v_before_stock
    OR NOT EXISTS(SELECT 1 FROM public.cash_shifts WHERE id=v_shift AND status='reversed' AND reversal_id=(v_result->>'reversalId')::UUID)
    OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=v_pos_order AND status='cancelled')
    OR NOT EXISTS(SELECT 1 FROM public.customer_payments WHERE id=v_customer_payment AND is_reversed)
    OR NOT EXISTS(SELECT 1 FROM public.operational_expenses WHERE id=v_expense AND is_reversed)
    OR NOT EXISTS(SELECT 1 FROM public.supplier_payments WHERE id=v_supplier_payment AND is_reversed)
    OR (SELECT count(*) FROM public.cash_shift_reversal_operations WHERE reversal_id=(v_result->>'reversalId')::UUID AND status='reversed') <> 4
  THEN RAISE EXCEPTION 'Full shift reversal did not reconcile all supported operations.'; END IF;
  INSERT INTO full_shift_reversal_results VALUES('supported_execute_inventory_customer_supplier_cash_cliq','pass',v_result);

  v_result := public.reverse_cash_shift_with_operations(v_shift,'اختبار عكس الوردية بكامل العمليات','full-shift-reversal-key-000000000001');
  IF NOT COALESCE((v_result->>'idempotent')::BOOLEAN,false) THEN RAISE EXCEPTION 'Full shift same-key retry is not idempotent.'; END IF;
  INSERT INTO full_shift_reversal_results VALUES('same_key_retry_idempotent','pass',v_result);

  BEGIN
    PERFORM public.reverse_cash_shift_with_operations(v_shift,'مفتاح مختلف يجب أن يفشل','full-shift-reversal-other-key-0000001');
    RAISE EXCEPTION 'A reversed shift accepted a second key.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error='A reversed shift accepted a second key.' THEN RAISE; END IF;
    INSERT INTO full_shift_reversal_results VALUES('second_execution_blocked','expected_blocked',jsonb_build_object('error',v_error));
  END;

  -- A downstream stock movement blocks the whole shift before any operation is
  -- changed.  Snapshot proves zero partial effects from the orchestrator.
  v_result := public.open_cash_shift(v_branch,0);
  v_blocked_shift := (v_result->>'id')::UUID;
  v_result := public.create_pos_sale(v_warehouse,v_branch,NULL,'بيع محجوب','cash',jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),0,0,'full-shift-blocked-sale-key-0000001');
  v_blocked_order := (v_result->>'orderId')::UUID;
  SELECT on_hand_quantity INTO v_before_stock FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product;
  PERFORM public.adjust_inventory_stock(v_warehouse,v_product,v_before_stock+1,'حركة لاحقة تمنع العكس الكامل','manual');
  SELECT on_hand_quantity INTO v_before_stock FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product;
  v_preview := public.preview_cash_shift_full_reversal(v_blocked_shift);
  IF COALESCE((v_preview->>'canExecute')::BOOLEAN,true) THEN RAISE EXCEPTION 'Unsafe shift preview was allowed.'; END IF;
  INSERT INTO full_shift_reversal_results VALUES('downstream_inventory_preview_blocked','expected_blocked',v_preview);
  BEGIN
    PERFORM public.reverse_cash_shift_with_operations(v_blocked_shift,'يجب أن يتوقف قبل أي تعديل','full-shift-blocked-key-000000000001');
    RAISE EXCEPTION 'Unsafe shift execution was allowed.';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error='Unsafe shift execution was allowed.' THEN RAISE; END IF;
    SELECT on_hand_quantity INTO v_after_stock FROM public.inventory_balances WHERE warehouse_id=v_warehouse AND product_id=v_product;
    IF v_after_stock<>v_before_stock OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=v_blocked_order AND status='completed') OR EXISTS(SELECT 1 FROM public.cash_shift_reversals WHERE shift_id=v_blocked_shift) THEN
      RAISE EXCEPTION 'Blocked full reversal left partial effects.';
    END IF;
    INSERT INTO full_shift_reversal_results VALUES('downstream_inventory_execute_zero_partial','expected_blocked',jsonb_build_object('error',v_error));
  END;

  -- Server-side Owner+AAL2 gates are verified on the orchestrator itself.
  PERFORM set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',true);
  BEGIN PERFORM public.preview_cash_shift_full_reversal(v_blocked_shift); RAISE EXCEPTION 'AAL1 allowed.'; EXCEPTION WHEN OTHERS THEN v_error:=SQLERRM; IF v_error='AAL1 allowed.' THEN RAISE; END IF; INSERT INTO full_shift_reversal_results VALUES('owner_aal1_preview_denied','expected_blocked',jsonb_build_object('error',v_error)); END;
  PERFORM set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}',true);
  BEGIN PERFORM public.reverse_cash_shift_with_operations(v_blocked_shift,'كاشير يجب أن يرفض','full-shift-cashier-key-0000000001'); RAISE EXCEPTION 'Cashier allowed.'; EXCEPTION WHEN OTHERS THEN v_error:=SQLERRM; IF v_error='Cashier allowed.' THEN RAISE; END IF; INSERT INTO full_shift_reversal_results VALUES('cashier_execute_denied','expected_blocked',jsonb_build_object('error',v_error)); END;
  PERFORM set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',true);
  BEGIN PERFORM public.preview_cash_shift_full_reversal(v_blocked_shift); RAISE EXCEPTION 'View-only allowed.'; EXCEPTION WHEN OTHERS THEN v_error:=SQLERRM; IF v_error='View-only allowed.' THEN RAISE; END IF; INSERT INTO full_shift_reversal_results VALUES('view_only_preview_denied','expected_blocked',jsonb_build_object('error',v_error)); END;
  PERFORM set_config('request.jwt.claims','{"role":"anon","aal":"aal2"}',true);
  BEGIN PERFORM public.reverse_cash_shift_with_operations(v_blocked_shift,'مجهول يجب أن يرفض','full-shift-anon-key-000000000001'); RAISE EXCEPTION 'Anonymous allowed.'; EXCEPTION WHEN OTHERS THEN v_error:=SQLERRM; IF v_error='Anonymous allowed.' THEN RAISE; END IF; INSERT INTO full_shift_reversal_results VALUES('anonymous_execute_denied','expected_blocked',jsonb_build_object('error',v_error)); END;
END $$;

SELECT jsonb_build_object('runtime_scenarios',(SELECT count(*) FROM full_shift_reversal_results),'passed',(SELECT count(*) FROM full_shift_reversal_results WHERE outcome='pass'),'expected_blocked',(SELECT count(*) FROM full_shift_reversal_results WHERE outcome='expected_blocked'),'unexpected_failures',0,'scenarios',(SELECT jsonb_agg(jsonb_build_object('name',scenario,'outcome',outcome) ORDER BY scenario) FROM full_shift_reversal_results)) AS full_shift_reversal_runtime_summary;

ROLLBACK;
