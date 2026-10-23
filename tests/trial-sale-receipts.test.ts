import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {receiptLineDescription,receiptDocumentShareText} from '../customer-web/src/receipts/commercialReceipt';
import {ReceiptDocument} from '../customer-web/src/receipts/ReceiptDocument';
import {orderReceipt,savedReceiptLine,invoiceReceipt} from '../src/features/receipts/saleReceipt';
import {trialDOrder,trialDItems,trialDDescriptions} from '../e2e/trial-d-receipt.fixture';
import {posV2Invoice,receiptBaseUnitNames} from '../src/features/pos/posV2Cart';
import type {PosV2SaleResult} from '../src/services/supabase/posV2.service';
import {buildReceiptShareText} from '../src/utils/receipt';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {trialDPins,sourceBeforeTrialD,inventoryBeforeTrialD} from '../scripts/audit/source-before-trial-sale-receipts.mjs';
import {inventoryBeforeTrialJ} from '../scripts/audit/source-before-trial-aftercare.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';

test('D saved commercial evidence formats mixed invoice without changing quantities or amounts',()=>{
  const original=structuredClone(trialDOrder);
  assert.deepEqual(trialDItems.map(item=>receiptLineDescription(savedReceiptLine(item))),trialDDescriptions);
  const receipt=orderReceipt(trialDOrder),html=renderToStaticMarkup(React.createElement(ReceiptDocument,{receipt}));
  for(const description of trialDDescriptions)assert.ok(html.includes(description),description);
  assert.deepEqual(receipt.lines.map(line=>line.totalInMinorUnits),[15000,12000,7000,3000]);
  assert.equal(receipt.totalInMinorUnits,36000);assert.equal(receipt.discountInMinorUnits,1000);
  assert.doesNotMatch(html,/private-instance|private-berry|PRIVATE-BERRY|999|عنوان التجهيز/);
  assert.deepEqual(trialDOrder,original);
  const shared=receiptDocumentShareText(receipt,trialDOrder.publicReceiptUrl);
  for(const description of trialDDescriptions)assert.ok(shared.includes(description));
  assert.match(shared,/الإجمالي: 36\.000/);
  const posText=buildReceiptShareText({businessName:'النواصرة',branchName:'التجربة',invoiceNumber:trialDOrder.orderNumber,
    customerName:trialDOrder.customerName,createdAt:trialDOrder.createdAt,items:trialDItems,subtotal:37,discount:1,
    totalAmount:36,paymentMethod:'cash',paidAmount:36,remainingAmount:0,changeDue:0});
  for(const description of trialDDescriptions)assert.ok(posText.includes(description));
});

test('D POS result retains saved composition and base unit evidence for the same reprint template',()=>{
  const sale={orderId:trialDOrder.id,orderNumber:trialDOrder.orderNumber,customerName:trialDOrder.customerName,
    subtotalInMinorUnits:37000,discountInMinorUnits:1000,totalInMinorUnits:36000,amountPaidInMinorUnits:36000,
    changeDueInMinorUnits:0,paymentMethod:'cash',branchId:trialDOrder.branchId,
    items:trialDItems.map(i=>({id:i.id,productId:i.productId,productName:i.productName,sku:i.sku,commercialLineKind:i.commercialLineKind,
      quantity:i.quantity,baseQuantity:i.baseQuantity,unitsPerSalePackage:i.baseQuantity!/i.quantity,salePackage:i.salePackage,
      unitPriceInMinorUnits:i.unitPrice*1000,lineTotalInMinorUnits:i.totalPrice*1000,allocatedDiscountInMinorUnits:0,cogsInMinorUnits:500,
      parcelInstances:i.parcelInstances?.map(p=>({instance_id:p.id,instance_sequence:p.sequence,components:p.components.map(c=>({
        component_id:c.id,product_id:c.productId,product_name_snapshot:c.name,sku_snapshot:c.sku,base_unit_name_snapshot:c.unitName,base_quantity:c.quantity,
      }))}))??[]}))} as unknown as PosV2SaleResult;
  const before=structuredClone(sale),units=receiptBaseUnitNames({order_items:trialDItems.map(i=>({id:i.id,base_unit_name_snapshot:i.baseUnitName}))});
  const invoice=posV2Invoice(sale,{id:'owner',name:'المالك'},trialDOrder.createdAt,units);
  assert.deepEqual(invoiceReceipt(invoice).lines,orderReceipt(trialDOrder).lines);
  assert.deepEqual(sale,before);
  assert.deepEqual([...receiptBaseUnitNames({order_items:[null,{id:'x'}, {id:'y',base_unit_name_snapshot:'  '}]})],[]);
});

test('D missing historical evidence is explicit and never inferred from quantity or package label',()=>{
  const line=savedReceiptLine(trialDItems[0]);
  assert.equal(receiptLineDescription({...line,kind:undefined,savedUnitName:'صندوق'}),'1 صندوق');
  assert.equal(receiptLineDescription({...line,baseQuantity:undefined}),'1 طرد (المحتوى المحفوظ غير متاح)');
  assert.equal(receiptLineDescription({...line,kind:'configurable_parcel',parcels:[]}),'1 طرد مشكّل (المكونات المحفوظة غير متاحة)');
  const mixed=savedReceiptLine(trialDItems[2]);
  const different={...mixed,quantity:2,parcels:[...mixed.parcels!,{components:[{name:'عصير المراعي - توت',quantity:6,unitName:'قنينة'}]}]};
  assert.equal(receiptLineDescription(different),'2 طرد مشكّل (الطرد 1: 5 توت + 1 برتقال؛ الطرد 2: 6 توت)');
});

test('D exact additive inverse preserves delivered209 source and rejects current/restored mutations',()=>{
  const baseline='581cb972a247ef13dbdc697b75bcc5c674bfa97d';
  for(const [file,pin] of Object.entries(trialDPins) as [string,{added?:boolean}][]){
    const current=readFileSync(file,'utf8'),restored=sourceBeforeTrialD(file,current);
    assert.throws(()=>sourceBeforeTrialD(file,current+'\nvoid unapproved;\n'));
    if(pin.added)assert.equal(restored,null);
    else {
      const before=execFileSync('git',['show',baseline+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
      assert.equal(restored,before,file);assert.throws(()=>sourceBeforeTrialD(file,before+'\nvoid unapproved;\n'));
    }
  }
  assert.deepEqual(execFileSync('git',['diff','--name-only',baseline,'--','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(f=>f&&Number(f.split('/').at(-1)!.slice(0,3))<=209),[],'001-209 immutable;only approved210 additive');
});

test('D actual SDK evidence covers saved unit/token columns for all existing actors and keeps frozen209 separate',async()=>{
  const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
  const current=await inventoryBeforeTrialJ(),proof=read('docs/operations/TABLE_ACCESS_AFTER_210.json');
  assert.equal(proof.migrationCeiling,210);assert.equal(proof.managedAccess,false);
  assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
  assert.deepEqual(proof.sourceHashes,current.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));
  assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
  const queries=proof.results.filter((r:{id:string})=>r.id.startsWith('src/features/pos/PosView.tsx:')||r.id.startsWith('src/services/supabase/orders.service.ts:'));
  assert.ok(queries.length>0);
  for(const file of ['src/features/pos/PosView.tsx','src/services/supabase/orders.service.ts']){
    const rows=queries.filter((r:{id:string;evaluated:unknown})=>r.id.startsWith(file+':')&&JSON.stringify(r.evaluated).includes('base_unit_name_snapshot'));
    assert.deepEqual([...new Set(rows.map((r:{appRole:string})=>r.appRole))].sort(),['cashier','admin','owner'].sort());
  }
  assert.ok(queries.some((r:{evaluated:unknown})=>JSON.stringify(r.evaluated).includes('public_receipt_token')));
  const frozen=await inventoryBeforeTrialD();assert.deepEqual(frozen.sources,read('docs/operations/TABLE_ACCESS_AFTER_209.json').sourceHashes);
});
