import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

/** Owned isolated PostgreSQL only. Existing public writers; every row rolls back. */
export async function verifyLiteActualUnitTransition({json,id,q,j,executor},report){
 const before=await readApplicationFingerprint(executor);
 const rows=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);SET LOCAL ROLE authenticated;
 CREATE TEMP TABLE actual_unit_proof(result JSONB);DO $proof$
 DECLARE source_name TEXT;unit_code TEXT;renamed_name TEXT;old_unit UUID;renamed_unit UUID;packet UUID;p public.products;created JSONB;sale JSONB;second_sale JSONB;receipt JSONB;second_receipt JSONB;token UUID;second_token UUID;pid UUID;master UUID;sid UUID;item UUID;payload JSONB;preview JSONB;returned JSONB;kind INTEGER;before_documents JSONB;after_documents JSONB;
 BEGIN
 SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';
 PERFORM public.finish_go_live_setup_v1('إنهاء بداية التشغيل');sid:=(public.open_cash_shift(${q(id(200))},100000)->>'id')::UUID;
 FOREACH source_name IN ARRAY ARRAY['باكيت','صندوق','شرنك','كرتونة','طرد'] LOOP
  unit_code:=CASE source_name WHEN 'باكيت' THEN 'PKT' WHEN 'صندوق' THEN 'BOX' WHEN 'شرنك' THEN 'SHRINK' WHEN 'كرتونة' THEN 'CTN' ELSE 'SALE-CARTON' END;
  SELECT id INTO old_unit FROM public.units WHERE units.code=unit_code AND name_ar=source_name AND is_active;
  IF old_unit IS NULL THEN old_unit:=(public.save_product_unit(source_name,'ACTUAL-'||unit_code,1,NULL)->>'unitId')::UUID;END IF;
  renamed_name:=CASE WHEN source_name='صندوق' THEN 'شرنك' ELSE 'صندوق' END;
  SELECT id INTO renamed_unit FROM public.units WHERE name_ar=renamed_name AND is_active LIMIT 1;
  IF renamed_unit IS NULL THEN renamed_unit:=(public.save_product_unit(renamed_name,'ACTUAL-RENAME-'||unit_code,1,NULL)->>'unitId')::UUID;END IF;
  FOR kind IN 0..1 LOOP
   IF kind=0 THEN
    created:=public.create_product_with_opening_stock_v5(p_sku:='AU-'||unit_code,p_name_ar:='صنف وحدة وهمي',p_category_id:='92600000-0000-4000-8000-000000000011',p_unit_id:=old_unit,p_purchase_unit_id:=old_unit,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=old_unit,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=6000,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:='92600000-0000-4000-8000-000000000201',p_opening_quantity:=0,p_parcel_only:=false);
    master:=(created->>'product_id')::UUID;pid:=master;
   ELSE
    created:=public.create_product_family_with_flavors_v2(p_sku:='AU-F-'||unit_code,p_name_ar:='عائلة وحدة وهمية',p_category_id:='92600000-0000-4000-8000-000000000011',p_unit_id:=old_unit,p_purchase_unit_id:=old_unit,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=old_unit,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=6000,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:='92600000-0000-4000-8000-000000000201',p_flavors:='[{"nameAr":"نكهة وحدة","openingSalePackages":0}]'::JSONB,p_parcel_only:=false);
    master:=(created->>'productId')::UUID;SELECT id INTO STRICT pid FROM public.products WHERE flavor_master_product_id=master;
   END IF;
   sale:=public.lite1_pos2(jsonb_build_object('branchId',${q(id(200))},'warehouseId',${q(id(201))},'customerId',${q(id(401))},'paymentMethod','cash','lines',jsonb_build_array(jsonb_build_object('commercial_line_kind','base_unit','product_id',pid,'base_quantity',1)),'discountInMinorUnits',0,'amountReceivedInMinorUnits',6000),gen_random_uuid()::TEXT);
   token:=(public.get_or_create_pos_receipt_token((sale->>'orderId')::UUID)->>'receiptToken')::UUID;receipt:=public.lite1_public_pos_receipt2(token);
   IF receipt#>>'{items,0,baseUnitName}' IS DISTINCT FROM source_name OR (receipt->>'totalInMinorUnits')::BIGINT IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'ACTUAL_UNIT_INITIAL_RECEIPT';END IF;
   SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'payments',(SELECT jsonb_agg(to_jsonb(pay) ORDER BY pay.id) FROM public.customer_payments pay WHERE pay.order_id=o.id)) INTO before_documents FROM public.orders o WHERE o.id=(sale->>'orderId')::UUID;
   SELECT * INTO STRICT p FROM public.products WHERE id=master;
   PERFORM public.update_product_master_v5(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,renamed_unit,renamed_unit,1,p.default_purchase_price_in_minor_units,renamed_unit,1,6000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,false);
   IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=pid AND unit_id=renamed_unit AND default_sale_price_in_minor_units=6000 AND units_per_sale_unit=1) THEN RAISE EXCEPTION 'ACTUAL_UNIT_RENAME_NOT_PROPAGATED';END IF;
   IF public.lite1_public_pos_receipt2(token) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'ACTUAL_UNIT_RENAME_CHANGED_OLD_RECEIPT';END IF;
   second_sale:=public.lite1_pos2(jsonb_build_object('branchId',${q(id(200))},'warehouseId',${q(id(201))},'customerId',${q(id(401))},'paymentMethod','cash','lines',jsonb_build_array(jsonb_build_object('commercial_line_kind','base_unit','product_id',pid,'base_quantity',1)),'discountInMinorUnits',0,'amountReceivedInMinorUnits',6000),gen_random_uuid()::TEXT);
   second_token:=(public.get_or_create_pos_receipt_token((second_sale->>'orderId')::UUID)->>'receiptToken')::UUID;second_receipt:=public.lite1_public_pos_receipt2(second_token);
   IF second_receipt#>>'{items,0,baseUnitName}' IS DISTINCT FROM renamed_name THEN RAISE EXCEPTION 'ACTUAL_UNIT_NEW_RECEIPT_NAME';END IF;
   SELECT * INTO STRICT p FROM public.products WHERE id=master;
   PERFORM public.update_product_master_v5(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,packet,renamed_unit,12,p.default_purchase_price_in_minor_units,renamed_unit,12,6000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,true);
   IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=pid AND unit_id=packet AND purchase_unit_id=renamed_unit AND sale_unit_id=renamed_unit AND units_per_purchase_unit=12 AND units_per_sale_unit=12 AND parcel_only AND default_sale_price_in_minor_units=6000) THEN RAISE EXCEPTION 'ACTUAL_UNIT_CONVERSION_NOT_PROPAGATED';END IF;
   IF public.lite1_public_pos_receipt2(token) IS DISTINCT FROM receipt OR public.lite1_public_pos_receipt2(second_token) IS DISTINCT FROM second_receipt THEN RAISE EXCEPTION 'ACTUAL_UNIT_CONVERSION_CHANGED_OLD_RECEIPT';END IF;
   SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'payments',(SELECT jsonb_agg(to_jsonb(pay) ORDER BY pay.id) FROM public.customer_payments pay WHERE pay.order_id=o.id)) INTO after_documents FROM public.orders o WHERE o.id=(sale->>'orderId')::UUID;
   IF before_documents IS DISTINCT FROM after_documents THEN RAISE EXCEPTION 'ACTUAL_UNIT_CHANGED_OLD_DOCUMENT';END IF;
   FOR item IN SELECT id FROM public.order_items WHERE order_id IN((sale->>'orderId')::UUID,(second_sale->>'orderId')::UUID) LOOP
    payload:=jsonb_build_object('orderId',(SELECT order_id FROM public.order_items WHERE id=item),'reason','اختبار محلي مرتجع بعد إعادة تعريف الوحدة','notes',NULL,'referenceNumber',NULL,'refundMethod','cash','items',jsonb_build_array(jsonb_build_object('return_scope','base_unit','order_item_id',item,'quantity',1,'stock_disposition','restock')),'physicalSources',jsonb_build_array(jsonb_build_object('root_source_kind','base_order_item','root_source_id',item,'source_kind','base_order_item','source_id',item,'product_id',pid,'quantity',1,'sellable_restock_quantity',1,'defect_non_sellable_quantity',0,'customer_damage_quantity',0)),'supplierAssignments','[]'::JSONB);
    preview:=public.lite1_preview_return2(payload);IF (preview->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'ACTUAL_UNIT_RETURN_SNAPSHOT_PRICE';END IF;
    returned:=public.lite1_settle_return2(payload,gen_random_uuid()::TEXT,preview->>'previewFingerprint');IF (returned->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'ACTUAL_UNIT_RETURN_MONEY';END IF;
   END LOOP;
   sale:=public.lite1_pos2(jsonb_build_object('branchId',${q(id(200))},'warehouseId',${q(id(201))},'customerId',${q(id(401))},'paymentMethod','cash','lines',jsonb_build_array(jsonb_build_object('commercial_line_kind','legacy_single_sku_parcel','product_id',pid,'parcel_quantity',1,'units_per_parcel',12)),'discountInMinorUnits',0,'amountReceivedInMinorUnits',6000),gen_random_uuid()::TEXT);
   token:=(public.get_or_create_pos_receipt_token((sale->>'orderId')::UUID)->>'receiptToken')::UUID;receipt:=public.lite1_public_pos_receipt2(token);
   IF (sale->>'totalInMinorUnits')::BIGINT IS DISTINCT FROM 6000 OR receipt#>>'{items,0,baseUnitName}' IS DISTINCT FROM 'باكيت' OR receipt#>>'{items,0,packageName}' IS DISTINCT FROM renamed_name OR (receipt#>>'{items,0,baseQuantity}')::INTEGER IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'ACTUAL_UNIT_NEW_PACKAGE_RECEIPT';END IF;
   IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE product_id IN(pid,master)) OR EXISTS(SELECT 1 FROM public.order_inventory_reservations WHERE product_id IN(pid,master)) OR EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id IN(pid,master) AND (on_hand_quantity<>0 OR reserved_quantity<>0 OR available_quantity<>0)) OR EXISTS(SELECT 1 FROM public.products WHERE id IN(pid,master) AND (cost_price_in_minor_units<>0 OR wac_cost_in_minor_units_exact IS NOT NULL)) THEN RAISE EXCEPTION 'ACTUAL_UNIT_UNEXPECTED_INVENTORY_OR_COST:%',jsonb_build_object('moves',(SELECT count(*) FROM public.inventory_movements WHERE product_id IN(pid,master)),'reservations',(SELECT count(*) FROM public.order_inventory_reservations WHERE product_id IN(pid,master)),'balances',(SELECT jsonb_agg(to_jsonb(b)) FROM public.inventory_balances b WHERE product_id IN(pid,master)),'costs',(SELECT jsonb_agg(jsonb_build_object('cost',cost_price_in_minor_units,'wac',wac_cost_in_minor_units_exact)) FROM public.products WHERE id IN(pid,master)));END IF;
   INSERT INTO actual_unit_proof VALUES(jsonb_build_object('sourceUnit',source_name,'renamedUnit',renamed_name,'kind',kind,'priceFils',6000,'size',12,'oldDocumentsUnchanged',true,'twoOldRefundsFils',12000));
  END LOOP;
 END LOOP;
 END $proof$;SELECT jsonb_agg(result) FROM actual_unit_proof;ROLLBACK;`);
 assert.equal(rows.length,10);
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'ACTUAL_UNIT_PROOF_ROLLBACK');
 report.cases.push({name:'actual units:5 ordinary+5 family rename/conversion;old invoices/receipts/refunds and new package sale',passed:true,rows});
}
