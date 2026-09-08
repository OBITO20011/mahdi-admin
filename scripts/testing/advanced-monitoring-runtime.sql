\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE advanced_monitoring_results(scenario TEXT PRIMARY KEY,passed BOOLEAN NOT NULL) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_now TIMESTAMPTZ:=NOW();
  v_owner UUID:='99000000-0000-0000-0000-000000000001';
  v_role UUID;
  v_branch UUID:='99000000-0000-0000-0000-000000000002';
  v_warehouse UUID:='99000000-0000-0000-0000-000000000003';
  v_category UUID:='99000000-0000-0000-0000-000000000004';
  v_unit UUID:='99000000-0000-0000-0000-000000000005';
  v_product UUID:='99000000-0000-0000-0000-000000000006';
  v_movement UUID:='99000000-0000-0000-0000-000000000007';
  v_supplier UUID:='99000000-0000-0000-0000-000000000008';
  v_receipt UUID:='99000000-0000-0000-0000-000000000009';
  v_result JSONB;
  v_dashboard JSONB;
  v_denied BOOLEAN:=false;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(v_owner,'authenticated','authenticated','phase5-owner@example.test',NOW(),'{}','{}',NOW(),NOW());
  INSERT INTO public.profiles(id,full_name,is_active) VALUES(v_owner,'مالك اختبار المراقبة',true);
  INSERT INTO public.roles(code,name_ar) VALUES('owner','مالك النظام') ON CONFLICT(code) DO NOTHING;
  SELECT id INTO STRICT v_role FROM public.roles WHERE code='owner';
  INSERT INTO public.user_roles(user_id,role_id) VALUES(v_owner,v_role);
  INSERT INTO public.branches(id,code,name_ar,is_active) VALUES(v_branch,'PHASE5','فرع اختبار',true);
  INSERT INTO public.warehouses(id,branch_id,code,name_ar,is_active) VALUES(v_warehouse,v_branch,'PHASE5-WH','مستودع اختبار',true);
  INSERT INTO public.categories(id,code,name_ar,is_active) VALUES(v_category,'PHASE5-CAT','قسم اختبار',true);
  INSERT INTO public.units(id,code,name_ar) VALUES(v_unit,'PHASE5-UNIT','قطعة');
  INSERT INTO public.products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,cost_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,is_active)
  VALUES(v_product,'PHASE5-001','صنف اختبار',v_category,v_unit,v_unit,v_unit,1,1,1000,500,1000,1000,true);
  INSERT INTO public.inventory_balances(warehouse_id,product_id,on_hand_quantity,reserved_quantity) VALUES(v_warehouse,v_product,5,0);

  v_result:=public.run_advanced_monitoring_checks(v_now);
  IF (v_result->>'integrityIssueCount')::INTEGER<>0 THEN RAISE EXCEPTION 'Healthy baseline failed.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('healthy_baseline',true);

  INSERT INTO public.inventory_movements(id,warehouse_id,product_id,movement_type,quantity,balance_before,balance_after)
  VALUES(v_movement,v_warehouse,v_product,'adjustment_add',-1,5,5);
  v_result:=public.run_advanced_monitoring_checks(v_now+interval '1 minute');
  IF (SELECT status FROM public.advanced_monitoring_checks WHERE check_key='integrity:inventory:movement-arithmetic')<>'critical'
    OR (SELECT count(*) FROM public.automation_events WHERE event_type='business_integrity_warning')<>1
  THEN RAISE EXCEPTION 'Integrity incident did not open once.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('integrity_violation_opens_once',true);

  v_result:=public.run_advanced_monitoring_checks(v_now+interval '2 minutes');
  IF (SELECT count(*) FROM public.automation_events WHERE event_type='business_integrity_warning')<>1
  THEN RAISE EXCEPTION 'Repeated integrity scan duplicated Business alert.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('integrity_duplicate_suppressed',true);

  UPDATE public.inventory_movements SET balance_after=4 WHERE id=v_movement;
  UPDATE public.inventory_balances SET on_hand_quantity=4 WHERE warehouse_id=v_warehouse AND product_id=v_product;
  v_result:=public.run_advanced_monitoring_checks(v_now+interval '3 minutes');
  IF (SELECT status FROM public.advanced_monitoring_checks WHERE check_key='integrity:inventory:movement-arithmetic')<>'healthy'
    OR (SELECT count(*) FROM public.automation_events WHERE event_type='business_alert_recovery' AND payload->>'resolvedAlertType'='business_integrity_warning')<>1
  THEN RAISE EXCEPTION 'Integrity recovery was not emitted exactly once.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('integrity_recovery_once',true);

  INSERT INTO public.suppliers(id,company_name) VALUES(v_supplier,'مورد اختبار المراقبة');
  INSERT INTO public.supplier_receipts(
    id,receipt_number,supplier_id,warehouse_id,branch_id,received_by,status,is_archived,payment_status
  ) VALUES(
    v_receipt,'PHASE5-CANCELLED',v_supplier,v_warehouse,v_branch,v_owner,'cancelled',true,'paid'
  );
  INSERT INTO public.supplier_receipt_items(
    supplier_receipt_id,product_id,purchase_unit_id,base_unit_id,purchase_unit_name,base_unit_name,
    package_quantity,units_per_package,total_base_units,package_price_in_minor_units,
    base_unit_cost_in_minor_units,line_total_in_minor_units
  ) VALUES(v_receipt,v_product,v_unit,v_unit,'قطعة','قطعة',2,1,2,500,500,1000);
  INSERT INTO public.inventory_movements(
    warehouse_id,product_id,movement_type,quantity,balance_before,balance_after,
    reference_type,reference_id,created_by,created_at
  ) VALUES
    (v_warehouse,v_product,'purchase_receipt',2,4,6,'supplier_receipt',v_receipt,v_owner,v_now+interval '4 minutes'),
    (v_warehouse,v_product,'return_out',-2,6,4,'supplier_receipt_cancellation',v_receipt,v_owner,v_now+interval '5 minutes');
  v_result:=public.run_advanced_monitoring_checks(v_now+interval '5 minutes');
  IF (SELECT status FROM public.advanced_monitoring_checks WHERE check_key='integrity:inventory:receiving')<>'healthy'
    OR (SELECT issue_count FROM public.advanced_monitoring_checks WHERE check_key='integrity:inventory:receiving')<>0
  THEN RAISE EXCEPTION 'Cancelled supplier receipt net reversal was reported as a mismatch.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('cancelled_receipt_net_reversal_accepted',true);

  PERFORM public.record_external_monitoring_snapshot('[{"key":"external:backup:erp","category":"backup","status":"healthy","severity":"critical","issueCount":0,"summary":"ERP backup","details":{}}]'::JSONB,v_now);
  IF (SELECT source FROM public.advanced_monitoring_checks WHERE check_key='external:backup:erp')<>'external'
  THEN RAISE EXCEPTION 'External snapshot was not recorded.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('external_snapshot_allowlist',true);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated','aal','aal2')::TEXT,true);
  PERFORM public.report_admin_runtime_incident(repeat('a',64),'admin_render');
  PERFORM public.report_admin_runtime_incident(repeat('a',64),'admin_render');
  IF (SELECT occurrence_count FROM public.advanced_monitoring_runtime_incidents WHERE fingerprint=repeat('a',64))<>2
  THEN RAISE EXCEPTION 'Runtime fingerprint did not dedupe.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('runtime_fingerprint_dedupes',true);

  v_result:=public.run_advanced_monitoring_checks(NOW());
  IF (SELECT status FROM public.advanced_monitoring_checks WHERE check_key='runtime:admin:errors')<>'critical'
  THEN RAISE EXCEPTION 'Runtime incident did not become critical.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('runtime_incident_transition',true);

  UPDATE public.advanced_monitoring_runtime_incidents SET last_seen_at=NOW()-interval '31 minutes' WHERE fingerprint=repeat('a',64);
  v_result:=public.run_advanced_monitoring_checks(NOW());
  IF (SELECT status FROM public.advanced_monitoring_checks WHERE check_key='runtime:admin:errors')<>'healthy'
  THEN RAISE EXCEPTION 'Runtime recovery did not become healthy.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('runtime_recovery_transition',true);

  v_dashboard:=public.get_advanced_monitoring_dashboard();
  IF v_dashboard->>'overallStatus' IS NULL OR jsonb_array_length(v_dashboard->'checks')<10
  THEN RAISE EXCEPTION 'Owner dashboard result is incomplete.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('owner_aal2_dashboard_allowed',true);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated','aal','aal1')::TEXT,true);
  BEGIN PERFORM public.get_advanced_monitoring_dashboard(); EXCEPTION WHEN OTHERS THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Owner AAL1 was not denied.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('owner_aal1_dashboard_denied',true);

  IF has_function_privilege('anon','public.get_advanced_monitoring_dashboard()','EXECUTE')
    OR has_function_privilege('authenticated','public.get_advanced_monitoring_status()','EXECUTE')
    OR has_function_privilege('service_role','public.record_external_monitoring_snapshot(jsonb,timestamp with time zone)','EXECUTE')
  THEN RAISE EXCEPTION 'Monitoring privilege boundary is too broad.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('rpc_privileges_fail_closed',true);

  IF (SELECT count(*) FROM cron.job WHERE jobname='run-advanced-monitoring' AND active)<>1
  THEN RAISE EXCEPTION 'Monitoring cron is missing or duplicated.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('bounded_cron_unique',true);

  IF EXISTS(SELECT 1 FROM public.automation_events WHERE event_type='business_integrity_warning' AND payload::TEXT~*'phone|address|customer|amount')
    OR public.get_advanced_monitoring_status()::TEXT~*'phone|address|customer|amount'
  THEN RAISE EXCEPTION 'Monitoring payload leaked Business data.'; END IF;
  INSERT INTO advanced_monitoring_results VALUES('technical_payload_has_no_pii',true);
END;
$$;

SELECT json_build_object('ok',bool_and(passed),'runtime_scenarios',count(*),'scenarios',json_agg(scenario ORDER BY scenario)) FROM advanced_monitoring_results;
ROLLBACK;
