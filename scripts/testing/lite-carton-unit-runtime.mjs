import assert from 'node:assert/strict';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

// Only the owned local 220 epoch runner calls this proof. All writes roll back.
export async function verifyLiteCartonUnitTransition({json,id,q,j,executor},report){
 const before=await readApplicationFingerprint(executor);
 const cases=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::text,true);SET LOCAL ROLE authenticated;
CREATE TEMP TABLE edit_proof(result jsonb);DO $proof$
DECLARE p public.products;created jsonb;sale jsonb;preview jsonb;payload jsonb;result jsonb;original jsonb;later jsonb;shift uuid;pid uuid;master uuid;item uuid;token uuid;receipt jsonb;purchase uuid;packet uuid;carton uuid;kind integer;part integer;amount bigint;
BEGIN
 SELECT id INTO STRICT packet FROM public.units WHERE code='PKT';SELECT id INTO STRICT purchase FROM public.units WHERE code='CTN';
 SELECT id INTO carton FROM public.units WHERE code='SALE-CARTON' AND name_ar='طرد' AND is_active;
 IF carton IS NULL THEN
  carton:=(public.save_product_unit('طرد','SALE-CARTON',1,NULL)->>'unitId')::uuid;
 END IF;
 IF carton IS NULL THEN RAISE EXCEPTION 'PROOF_CARTON_UNIT_NOT_CREATED';END IF;
 PERFORM public.finish_go_live_setup_v1('إنهاء بداية التشغيل');shift:=(public.open_cash_shift(${q(id(200))},10000)->>'id')::uuid;
 FOR kind IN 0..1 LOOP
  IF kind=0 THEN
   created:=public.create_product_with_opening_stock_v5(p_sku:='EDIT-PROOF-ORDINARY',p_name_ar:='صنف اختبار تعديل لاحق',p_category_id:='92600000-0000-4000-8000-000000000011',p_unit_id:=carton,p_purchase_unit_id:=purchase,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=purchase,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=6000,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:='92600000-0000-4000-8000-000000000201',p_opening_quantity:=0,p_parcel_only:=false);pid:=(created->>'product_id')::uuid;master:=pid;
  ELSE
   created:=public.create_product_family_with_flavors_v2(p_sku:='EDIT-PROOF-FAMILY',p_name_ar:='عائلة اختبار تعديل لاحق',p_category_id:='92600000-0000-4000-8000-000000000011',p_unit_id:=carton,p_purchase_unit_id:=purchase,p_units_per_purchase_unit:=1,p_default_purchase_price_in_minor_units:=0,p_sale_unit_id:=purchase,p_units_per_sale_unit:=1,p_default_sale_price_in_minor_units:=6000,p_cost_price_in_minor_units:=0,p_min_stock_level:=0,p_max_stock_level:=NULL,p_warehouse_id:='92600000-0000-4000-8000-000000000201',p_flavors:='[{"nameAr":"نكهة اختبار","openingSalePackages":0}]'::jsonb,p_parcel_only:=false);master:=(created->>'productId')::uuid;SELECT id INTO STRICT pid FROM public.products WHERE flavor_master_product_id=master;
  END IF;
  IF pid IS NULL THEN RAISE EXCEPTION 'PROOF_PRODUCT_CREATE_FAILED';END IF;
  sale:=public.lite1_pos2(jsonb_build_object('branchId','92600000-0000-4000-8000-000000000200','warehouseId','92600000-0000-4000-8000-000000000201','customerId','92600000-0000-4000-8000-000000000401','paymentMethod','cash','lines',jsonb_build_array(jsonb_build_object('commercial_line_kind','base_unit','product_id',pid,'base_quantity',1)),'discountInMinorUnits',0,'amountReceivedInMinorUnits',6000),gen_random_uuid()::text);
  IF (sale->>'totalInMinorUnits')::bigint IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'PROOF_INITIAL_PRICE';END IF;
  token:=(public.get_or_create_pos_receipt_token((sale->>'orderId')::uuid)->>'receiptToken')::uuid;
  receipt:=public.lite1_public_pos_receipt2(token);
  IF receipt#>>'{items,0,baseUnitName}' IS DISTINCT FROM 'طرد' OR token IS NULL OR (receipt->>'success')::boolean IS DISTINCT FROM true OR (receipt->>'totalInMinorUnits')::bigint IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'PROOF_INITIAL_RECEIPT_INVALID';END IF;
  SELECT id INTO STRICT item FROM public.order_items WHERE order_id=(sale->>'orderId')::uuid;
  SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'payments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.customer_payments a WHERE a.order_id=o.id)) INTO original FROM public.orders o WHERE o.id=(sale->>'orderId')::uuid;
  SELECT * INTO STRICT p FROM public.products WHERE id=master;
  PERFORM public.update_product_master_v5(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,packet,p.purchase_unit_id,12,p.default_purchase_price_in_minor_units,p.sale_unit_id,12,6000,p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,true);
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=pid AND unit_id=packet AND units_per_purchase_unit=12 AND units_per_sale_unit=12 AND parcel_only AND default_sale_price_in_minor_units=6000 AND sale_price_in_minor_units=500) THEN RAISE EXCEPTION 'PROOF_PRODUCT_OR_FLAVOR_NOT_UPDATED';END IF;
  SELECT jsonb_build_object('order',to_jsonb(o),'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.order_items i WHERE i.order_id=o.id),'payments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.customer_payments a WHERE a.order_id=o.id)) INTO later FROM public.orders o WHERE o.id=(sale->>'orderId')::uuid;
  IF public.lite1_public_pos_receipt2(token) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'PROOF_OLD_PUBLIC_RECEIPT_CHANGED';END IF;
  IF original IS DISTINCT FROM later THEN RAISE EXCEPTION 'PROOF_OLD_DOCUMENT_CHANGED';END IF;
  amount:=0;
  FOR part IN 1..1 LOOP
   payload:=jsonb_build_object('orderId',sale->>'orderId','reason','اختبار محلي: مرتجع قديم بعد تعديل الطرد','notes',NULL,'refundMethod','cash','referenceNumber',NULL,'items',jsonb_build_array(jsonb_build_object('return_scope','base_unit','order_item_id',item,'quantity',1,'stock_disposition','restock')),'physicalSources',jsonb_build_array(jsonb_build_object('root_source_kind','base_order_item','root_source_id',item,'source_kind','base_order_item','source_id',item,'product_id',pid,'quantity',1,'sellable_restock_quantity',1,'defect_non_sellable_quantity',0,'customer_damage_quantity',0)),'supplierAssignments','[]'::jsonb);
   preview:=public.lite1_preview_return2(payload);
   IF (preview->>'moneyRefundInMinorUnits')::bigint IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'PROOF_OLD_RETURN_PRICE_NOT_FROZEN:%',preview;END IF;
   result:=public.lite1_settle_return2(payload,gen_random_uuid()::text,preview->>'previewFingerprint');amount:=amount+(result->>'moneyRefundInMinorUnits')::bigint;
  END LOOP;
  IF amount IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'PROOF_OLD_RETURN_TOTAL';END IF;
  later:=public.lite1_pos2(jsonb_build_object('branchId','92600000-0000-4000-8000-000000000200','warehouseId','92600000-0000-4000-8000-000000000201','customerId','92600000-0000-4000-8000-000000000401','paymentMethod','cash','lines',jsonb_build_array(jsonb_build_object('commercial_line_kind','legacy_single_sku_parcel','product_id',pid,'parcel_quantity',1,'units_per_parcel',12)),'discountInMinorUnits',0,'amountReceivedInMinorUnits',6000),gen_random_uuid()::text);
  IF (later->>'totalInMinorUnits')::bigint IS DISTINCT FROM 6000 THEN RAISE EXCEPTION 'PROOF_NEW_SINGLE_PRICE';END IF;
  token:=(public.get_or_create_pos_receipt_token((later->>'orderId')::uuid)->>'receiptToken')::uuid;
  receipt:=public.lite1_public_pos_receipt2(token);
  IF receipt#>>'{items,0,baseUnitName}' IS DISTINCT FROM 'باكيت' OR (receipt#>>'{items,0,baseQuantity}')::integer IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'PROOF_NEW_RECEIPT_UNIT';END IF;
  INSERT INTO edit_proof VALUES(jsonb_build_object('kind',CASE WHEN kind=0 THEN 'ordinary' ELSE 'flavor_family' END,'oldBaseUnit','طرد','oldSaleSize',1,'newBaseUnit','باكيت','newPurchaseAndSaleSize',12,'oldInvoiceUnchanged',true,'oldPublicReceiptJsonUnchanged',true,'oldParcelFils',6000,'wholeOldParcelRefundFils',6000,'historicalWholeParcelRulePreserved',true,'newParcelFils',6000));
 END LOOP;
END $proof$;SELECT jsonb_agg(result) FROM edit_proof;ROLLBACK;`);
 assert.equal(cases.length,2);
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'LITE_CARTON_PROOF_ROLLBACK_ALL_APPLICATION_ROWS');
 report.cases.push({name:'single carton to packet base;versioned save,old/new receipt and old return for ordinary and flavor sales',passed:true,cases});
}
