import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

// Run the authoritative full-accounting writer before/after the new hooks on
// one transaction timestamp and identical stock. Both sales are rolled back.
export async function verifyOptionalQuantity223FullParity({json,id,executor},report){
 const before=await readApplicationFingerprint(executor);
 const body=async file=>{
  const source=(await readFile(new URL('../../docs/design/off-quantity-counter223/'+file,import.meta.url),'utf8')).replaceAll('\r\n','\n');
  assert.equal((source.match(/^BEGIN;$/gmu)||[]).length,1);assert.equal((source.match(/^COMMIT;$/gmu)||[]).length,1);
  return source.replace(/^BEGIN;$/mu,'').replace(/^COMMIT;$/mu,'');
 };
 const proof=await json(`BEGIN;
 SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);
 SELECT public.set_go_live_main_branch_v1('${id(200)}');
 SELECT public.open_cash_shift('${id(200)}',10000);
 SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:='${id(301)}',p_branch_id:='${id(200)}',p_warehouse_id:='${id(201)}',p_idempotency_key:='quantity223-full-receive',p_payment_method:='deferred',
 p_lines:='[{"client_line_id":"${id(990)}","line_kind":"base_unit","commercial_quantity":20,"base_unit_name":"باكيت","gross_amount_in_minor_units":10000,"line_discount_in_minor_units":0,"components":[{"product_id":"${id(103)}","base_quantity":20}]}]'::JSONB);
 CREATE FUNCTION pg_temp.full_case223() RETURNS JSONB LANGUAGE plpgsql AS $case$
 DECLARE sold JSONB;receipt JSONB;token UUID;sid UUID;
 BEGIN
  sold:=public.create_pos_sale_v2('${id(201)}','${id(200)}',NULL,'زبون نقدي','cash','[{"commercial_line_kind":"base_unit","product_id":"${id(103)}","base_quantity":2,"price_authority":"server_catalog","line_discount_in_minor_units":0}]'::JSONB,0,2000,'quantity223-full-sale');
  token:=(public.get_or_create_pos_receipt_token((sold->>'orderId')::UUID)->>'receiptToken')::UUID;
  receipt:=public.lite1_public_pos_receipt2(token);
  SELECT cash_shift_id INTO STRICT sid FROM public.orders WHERE id=(sold->>'orderId')::UUID;
  RETURN jsonb_build_object('sale',sold,'receipt',receipt,'summary',public.get_cash_shift_summary(sid),
   'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY product_id,warehouse_id) FROM public.inventory_balances b),
   'movements',(SELECT jsonb_agg(jsonb_build_object('product',product_id,'quantity',quantity,'before',balance_before,'after',balance_after,'kind',movement_type) ORDER BY product_id,movement_type,quantity) FROM public.inventory_movements),
   'costs',(SELECT jsonb_agg(jsonb_build_object('product',id,'cost',cost_price_in_minor_units,'wac',wac_cost_in_minor_units_exact,'price',sale_price_in_minor_units) ORDER BY id) FROM public.products),
   'itemCosts',(SELECT jsonb_agg(jsonb_build_object('product',product_id,'quantity',quantity,'unitCost',unit_cost_snapshot_in_minor_units_exact,'cogs',exact_cogs_snapshot_in_minor_units) ORDER BY product_id) FROM public.order_items WHERE order_id=(sold->>'orderId')::UUID),
   'counterRows',(SELECT count(*) FROM sales_lite3.quantity_counters),'counterEvents',(SELECT count(*) FROM sales_lite3.quantity_events));
 END $case$;
 CREATE TEMP TABLE full_results223(label TEXT PRIMARY KEY,result JSONB);
 DO $before$ DECLARE captured JSONB;BEGIN
  BEGIN captured:=pg_temp.full_case223();RAISE EXCEPTION 'ROLLBACK_FULL223_CASE';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ROLLBACK_FULL223_CASE' THEN RAISE;END IF;END;
  INSERT INTO full_results223 VALUES('before',captured);
 END $before$;
 ${await body('lifecycle223.sql')}
 ${await body('private-writers223.sql')}
 DO $after$ DECLARE captured JSONB;BEGIN
  BEGIN captured:=pg_temp.full_case223();RAISE EXCEPTION 'ROLLBACK_FULL223_CASE';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'ROLLBACK_FULL223_CASE' THEN RAISE;END IF;END;
  INSERT INTO full_results223 VALUES('after',captured);
 END $after$;
 SELECT jsonb_object_agg(label,result) FROM full_results223;ROLLBACK;`);
 // Generated UUIDs and sequential document numbers are not business values.
 // All money,stock,cost,receipt lines and shift totals remain in the comparison.
 const normalize=value=>{
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='orderNumber').map(([key,v])=>[key,normalize(v)]));
  return typeof value==='string'?value.replace(/\b(?!92600000)[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/giu,'generated-id'):value;
 };
 assert.equal(proof.before.sale.success,true);assert.ok(proof.before.sale.orderNumber);
 assert.deepEqual(normalize(proof.after),normalize(proof.before),'QUANTITY223_FULL_FINANCIAL_STOCK_COST_RECEIPT_PARITY');
 assert.ok(proof.before.itemCosts.every(row=>row.cogs>0&&row.unitCost>0),'FULL_PARITY_REQUIRES_REAL_COST');
 assert.equal(proof.after.counterRows,0);assert.equal(proof.after.counterEvents,0);
 assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'FULL_PARITY_OUTER_ROLLBACK_CHANGED_APPLICATION_ROWS');
 report.cases.push({name:'real ON receiving/POS/receipt/shift/cost/quantities identical before/after hooks;zero counter rows;outer rollback exact',passed:true});
}
