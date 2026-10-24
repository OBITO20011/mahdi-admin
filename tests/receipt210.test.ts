import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {assert210History} from '../scripts/operations/frankfurt-owner-upgrade210.mjs';
import {publicReceiptDocument} from '../customer-web/src/receipts/publicReceipt';import {receiptLineDescription} from '../customer-web/src/receipts/commercialReceipt';
import {trialDItems,trialDDescriptions} from '../e2e/trial-d-receipt.fixture';
const read=(p:string)=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
test('210 only replaces same read-only token reader;no grants/table/writer change',()=>{
 const sql=read('supabase/migrations/210_public_pos_receipt_commercial_lines.sql'),state=JSON.parse(read('docs/agent/project-state.json'));
 assert.equal(createHash('sha256').update(sql).digest('hex').toUpperCase(),state.migration210CanonicalLfSha256);assert.equal(state.migrationCeiling,214);
 assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g)||[]).length,1);assert.match(sql,/get_public_pos_receipt\(p_receipt_token UUID\)/);assert.match(sql,/STABLE SECURITY DEFINER/);assert.match(sql,/o.public_receipt_token = p_receipt_token/);assert.match(sql,/o.source = 'pos' AND o.status IN \('completed', 'returned'\)/);
 assert.doesNotMatch(sql,/^\s*(?:GRANT|REVOKE|ALTER|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/gm);assert.doesNotMatch(sql,/'(?:cost|cogs|profit|wac|customer|id|productId|operationId)[^']*'/i);
 assert.match(sql,/oi.commercial_line_kind/);assert.match(sql,/c.product_name_snapshot/);assert.match(sql,/c.base_quantity/);assert.doesNotMatch(sql,/JOIN public.products|FROM public.products/);
});
test('210 owner upgrade accepts complete208/209/210 only and applies missing versions',()=>{
 const base=Array.from({length:170},(_,n)=>String(n)),reference={prefixes:{'208':{appliedVersions:base}},appliedVersions:[...base,'209','210']};
 assert.deepEqual(assert210History(base,reference),['209','210']);assert.deepEqual(assert210History([...base,'209'],reference),['210']);assert.deepEqual(assert210History(reference.appliedVersions,reference),[]);
 assert.throws(()=>assert210History(base.slice(0,-1),reference));assert.throws(()=>assert210History([...base,'210'],reference));assert.throws(()=>assert210History([...base,'209','210','211'],reference));
});
test('210 public saved projection shares internal descriptions and amounts without inferred parcel kinds',()=>{
 const receipt=publicReceiptDocument({orderNumber:'POS210',createdAt:'',status:'completed',paymentMethod:'cash',paymentStatus:'paid',subtotalInMinorUnits:37000,discountInMinorUnits:1000,totalInMinorUnits:36000,branch:{name:'',address:'',phone:''},items:trialDItems.map(i=>({productName:i.productName,sku:i.sku,packageQuantity:i.quantity,packageName:i.salePackage!,unitsPerPackage:999,packagePriceInMinorUnits:999,lineTotalInMinorUnits:i.totalPrice*1000,commercialLineKind:i.commercialLineKind,baseQuantity:i.baseQuantity,baseUnitName:i.baseUnitName,parcelInstances:i.parcelInstances?.map(p=>({components:p.components.map(c=>({name:c.name,quantity:c.quantity,unitName:c.unitName}))}))}))});
 assert.deepEqual(receipt.lines.map(receiptLineDescription),trialDDescriptions);assert.equal(receipt.totalInMinorUnits,36000);assert.deepEqual(receipt.lines.map(l=>l.totalInMinorUnits),[15000,12000,7000,3000]);assert.doesNotMatch(JSON.stringify(receipt),/private-|PRIVATE-|999/);
 const old={...receipt.lines[0],kind:undefined,savedUnitName:'تغليف قديم'};assert.equal(receiptLineDescription(old),'1 تغليف قديم');
});
