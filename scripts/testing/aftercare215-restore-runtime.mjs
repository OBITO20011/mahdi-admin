import assert from 'node:assert/strict';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {aftercare211Restore} from './aftercare211-restore.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';

export async function verifyRestore215(c,output,pass){
 const {q,j,rpc,key,setup}=c,calls=[],expected=[];
 const completed=async call=>{await rpc(call);const stable=await c.fingerprint();expected.push(await rpc(call));assert.deepEqual(await c.fingerprint(),stable);calls.push(call);};
 const inspection=await setup(),ip=await rpc(`preview_inspected_sales_replacement_v2(${j(inspection.payload)})`);
 await completed(`settle_inspected_sales_replacement_v2(${j(inspection.payload)},${q(key())},${q(ip.previewFingerprint)})`);
 const returned=await setup(),payload=returnPayload215(returned),rp=await rpc(`preview_admin_sales_return_v2(${j(payload)})`);
 await completed(`settle_admin_sales_return_v2(${j(payload)},${q(key())},${q(rp.previewFingerprint)})`);
 const original=await setup(),replacement=await setup(),exchange={returnRequest:returnPayload215(original),replacement:{productId:replacement.pid,kind:'legacy_single_sku_parcel',quantity:1},differenceMethod:null},xp=await rpc(`preview_sales_exchange_v1(${j(exchange)})`);
 await completed(`settle_sales_exchange_v1(${j(exchange)},${q(key())},${q(xp.previewFingerprint)})`);
 const held=await rpc(`execute_supplier_replacement_v1('shop_pending',${j({supplierId:c.supplier,productId:replacement.pid,warehouseId:c.warehouse,quantity:1,unit:'base',reason:'معلّق لاختبار الاسترجاع المحلي'})},${q(key())})`);
 const credit={caseId:held.cases[0].id,quantity:1,reason:'خصم لاختبار استرجاع الذمة'},cp=await rpc(`preview_supplier_replacement_credit_v1('credit',${j(credit)})`);
 await completed(`settle_supplier_replacement_credit_v1('credit',${j(credit)},${q(key())},${q(cp.previewFingerprint)})`);
 const result=await aftercare211Restore({container:'supabase_db_nawasrah-tb215-test',executor:c.executor,output,replay:async executor=>{
  for(let i=0;i<calls.length;i++){
   const response=await executeInput(executor,c.auth('SELECT public.'+calls[i]+';'));assert.equal(response.code,0,response.stderr);
   assert.deepEqual(JSON.parse(response.stdout.trim().split('\n').at(-1)),expected[i]);
  }
 }});
 pass('full215 logical restore:roles/owners/ACL/catalog/data/sequences identical;four sealed coordinators replay exact completed results with zero writes');
 return result;
}

export async function verifyIntegrity215(c,pass,output){
 await c.sql('SELECT public.run_advanced_monitoring_checks(NOW());');
 const checks=await c.json("SELECT jsonb_agg(jsonb_build_object('key',check_key,'status',status,'issues',issue_count,'details',details) ORDER BY check_key) FROM advanced_monitoring_checks WHERE check_key LIKE 'integrity:%';");
 const mismatches=await c.json("WITH last_move AS(SELECT DISTINCT ON(product_id,warehouse_id) id,product_id,warehouse_id,balance_after,created_at FROM inventory_movements ORDER BY product_id,warehouse_id,created_at DESC,id DESC)SELECT COALESCE(jsonb_agg(jsonb_build_object('productId',l.product_id,'expected',b.on_hand_quantity,'selected',l.balance_after,'movements',(SELECT jsonb_agg(jsonb_build_object('quantity',m.quantity,'before',m.balance_before,'after',m.balance_after,'at',m.created_at,'type',m.reference_type) ORDER BY m.created_at,m.id) FROM inventory_movements m WHERE m.product_id=l.product_id AND m.warehouse_id=l.warehouse_id))),'[]')FROM last_move l LEFT JOIN inventory_balances b USING(product_id,warehouse_id) WHERE b.id IS NULL OR b.on_hand_quantity<>l.balance_after;");
 await writeFile(path.join(output,'integrity.json'),JSON.stringify({checks,mismatches},null,2)+'\n');
 assert.equal(checks.length,17,'EVERY214_INTEGRITY_CHECK_REMAINS_PRESENT');
 for(const row of checks){assert.equal(row.status,'healthy',row.key);assert.equal(row.issues,0,row.key);}
 for(const [type,proof]of [['aftercare215_inspection','tb215_assert_inspection_internal'],['aftercare215_return','tb215_assert_return_internal'],['aftercare215_exchange','tb215_assert_exchange_internal']])
  await c.sql(`SELECT public.${proof}(id) FROM business_operations WHERE operation_type=${c.q(type)};`);
 await c.sql('SELECT public.tb215_assert_supplier_credit_internal(operation_id) FROM supplier215_credits;');
 pass('all17 existing integrity checks healthy/zero issues plus independent proof of every215 return/inspection/exchange/supplier-credit operation');
 return checks;
}
