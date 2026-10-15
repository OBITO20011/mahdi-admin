import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {ReceivingUnitFields} from '../src/components/ui';
import {purchaseReceiptV2Lines,directReceiptV2Lines} from '../src/utils/receivingV2';
import {strictProductLegacySource} from './strict-product-legacy-source';
const product='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',item='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('existing base-unit PO payload remains literally unchanged',()=>{
 const input={purchaseOrderItemId:item,productId:product,receivedQuantity:7,unitCost:.143,baseUnitName:'قنينة'};
 assert.equal(JSON.stringify(purchaseReceiptV2Lines([input])),JSON.stringify([{client_line_id:item,purchase_order_item_id:item,line_kind:'base_unit',commercial_quantity:7,base_unit_name:'قنينة',gross_amount_in_minor_units:1001,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:7}]}]));
});
for(const [packages,units,price,discount] of [[1,24,1000,0],[100,24,1000,0],[1,7,1000,0],[1,7,1000,123]])test(`exact PO/direct package money ${packages}x${units}@${price}-${discount}`,()=>{
 const quote={packageQuantity:packages,unitsPerPackage:units,packagePriceInMinorUnits:price,discountInMinorUnits:discount};
 const po=purchaseReceiptV2Lines([{purchaseOrderItemId:item,productId:product,receivedQuantity:packages*units,unitCost:0,baseUnitName:'شوال',packagePricing:quote}])[0];
 const direct=directReceiptV2Lines([{clientLineId:item,productId:product,purchaseUnitName:'صندوق',baseUnitName:'شوال',...quote}])[0];
 assert.equal(po.gross_amount_in_minor_units,packages*price);
 assert.equal(po.commercial_quantity,packages*units);
 assert.equal(po.line_discount_in_minor_units,discount);
 assert.equal(po.gross_amount_in_minor_units,direct.gross_amount_in_minor_units);
 assert.equal(po.components[0].base_quantity,direct.components[0].base_quantity);
});
test('inconsistent package/base quantity and excessive discount fail closed',()=>{
 const input={purchaseOrderItemId:item,productId:product,receivedQuantity:24,unitCost:0,packagePricing:{packageQuantity:1,unitsPerPackage:7,packagePriceInMinorUnits:1000}};
 assert.throws(()=>purchaseReceiptV2Lines([input]),/لا تطابق/);
 assert.throws(()=>purchaseReceiptV2Lines([{...input,receivedQuantity:7,packagePricing:{...input.packagePricing,discountInMinorUnits:1001}}]),/يتجاوز/);
});

test('shared named-unit control hides contents/package kind when receiving base units',()=>{
 const noop=()=>{};
 const props={unitName:'قنينة',mode:'base_unit' as const,hasPackage:false,quantity:3,unitsPerPackage:24,priceJod:.05,packageName:'صندوق',onMode:noop,onQuantity:noop,onContents:noop,onPrice:noop,onPackageName:noop};
 const html=renderToStaticMarkup(React.createElement(ReceivingUnitFields,props));
 assert.match(html,/كم قنينة/);assert.match(html,/سعر قنينة/);assert.doesNotMatch(html,/بالطرد|نوع الطرد/);
 assert.doesNotMatch(html,/>طرد<\/button>/);assert.match(html,/<bdi>3<\/bdi> قنينة/);
 const packageHtml=renderToStaticMarkup(React.createElement(ReceivingUnitFields,{...props,unitName:'شوال',mode:'package',hasPackage:true}));
 assert.match(packageHtml,/كم شوال بالطرد/);assert.match(packageHtml,/<bdi>72<\/bdi> شوال/);
});
test('all existing receiving service RPC payload definitions remain source-identical',()=>{
 for(const file of ['src/services/supabase/purchases.service.ts','src/services/supabase/directReceiving.service.ts']){
  // Only the owner-approved read-relationship hints changed after this pin.
  // Entire-source equality still protects every RPC payload/body/validation.
  const hints=file.endsWith('/purchases.service.ts')
   ?['purchase_order_items_product_id_fkey','purchase_receipt_items_purchase_receipt_id_fkey']
   :['supplier_receipts_received_by_fkey'];
  let current=strictProductLegacySource(file,readFileSync(file,'utf8'));
  for(const hint of hints)current=current.replaceAll('!'+hint,'');
  assert.equal(current,execFileSync('git',['show',`d293ec38d29ba7d3dd74e0c4b732edf9e01ad469:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'));
 }
});
test('POS sale/recovery/payment/print/share action bodies remain AST-identical',()=>{
 const file='src/features/pos/PosView.tsx',names=['addToCart','updateQuantity','handleCompleteSale','executeSale','handlePrintReceipt','handleShareReceipt','ensurePublicReceiptUrl'];
 const extract=(source:string)=>{
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result:Record<string,string>={};
  const printer=ts.createPrinter({removeComments:true});
  function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&names.includes(n.name.getText(ast))&&n.initializer)result[n.name.getText(ast)]=printer.printNode(ts.EmitHint.Unspecified,n.initializer,ast);ts.forEachChild(n,visit);}visit(ast);return result;
 };
 const before=extract(execFileSync('git',['show',`d293ec38d29ba7d3dd74e0c4b732edf9e01ad469:${file}`],{encoding:'utf8'})),after=extract(readFileSync(file,'utf8'));
 assert.deepEqual(Object.keys(before).sort(),names.sort());assert.deepEqual(after,before);
});
