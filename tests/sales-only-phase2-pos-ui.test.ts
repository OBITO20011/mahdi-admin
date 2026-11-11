import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Product} from '../src/types';
import type {PosV2SaleResult,PosV2Line} from '../src/services/supabase/posV2.service';
import {posV2Invoice} from '../src/features/pos/posV2Cart';
import {invoiceReceipt} from '../src/features/receipts/saleReceipt';
import {PosProductCard} from '../src/features/pos/PosProductCard';
import {posAvailabilityIds,readPosAvailability} from '../src/features/pos/salesOnlyPos';
import type {ProductAvailability} from '../src/services/supabase/manualAvailability.service';

const id=(n:number)=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sale:PosV2SaleResult={orderId:id(1),orderNumber:'LOCAL',operationId:id(2),branchId:id(3),warehouseId:id(4),customerName:'اختبار',
 idempotentReplay:false,subtotalInMinorUnits:1234,discountInMinorUnits:0,totalInMinorUnits:1234,amountPaidInMinorUnits:234,
 changeDueInMinorUnits:0,paymentMethod:'debt',paymentStatus:'partially_paid',initialPaymentMethod:'cash',remainingInMinorUnits:1000,
 items:[{id:id(5),productId:id(6),productName:'اختبار',sku:'LOCAL',salePackage:'باكيت',unitPriceInMinorUnits:1234,
  quantity:1,baseQuantity:1,unitsPerSalePackage:1,allocatedDiscountInMinorUnits:0,lineTotalInMinorUnits:1234,cogsInMinorUnits:500}]};
test('lite invoice has explicit unknown cost, same receipt money and no NaN or fabricated profit;full cost unchanged',()=>{
 const full=posV2Invoice(sale,{id:id(7),name:'مالك'},'2026-11-09T10:00:00Z');
 const {cogsInMinorUnits:discarded,...withoutCost}=sale.items[0] as Record<string,unknown>;assert.equal(discarded,500);
 const lite=posV2Invoice({...sale,accountingTracked:false,items:[{...withoutCost,accountingTracked:false}]},{id:id(7),name:'مالك'},full.createdAt);
 assert.equal(full.items[0].costPrice,0.5);assert.equal(full.accountingTracked,undefined);
 assert.equal(lite.accountingTracked,false);assert.equal(lite.items[0].costPrice,null);assert.equal(lite.items[0].accountingTracked,false);
 assert.deepEqual(invoiceReceipt(lite),invoiceReceipt(full));assert.doesNotMatch(JSON.stringify(lite),/NaN|profit|cogs/);
});
test('zero-stock card stays blocked in full but lite permits explicit checkout confirmation',()=>{
 const product={id:id(1),nameAr:'اختبار',barcode:'0000123',imageUrl:'',unitsPerSalePackage:5,salePackagePrice:5,retailPrice:1,parcelOnly:false,reorderLevel:0} as Product;
 const props={product,stock:0,parcelQuantity:0,unitQuantity:0,disabled:false,onAdd:()=>{},onReduce:()=>{}};
 const full=renderToStaticMarkup(React.createElement(PosProductCard,props));
 const lite=renderToStaticMarkup(React.createElement(PosProductCard,{...props,quantityTracked:false,manualAvailable:false}));
 for(const html of [full,lite])assert.match(html,/0000123/);
 const additions=(html:string)=>[...html.matchAll(/<button[^>]*data-pos-add-method[^>]*>/g)].map(m=>m[0]);
 assert.equal(additions(full).length,2);assert.ok(additions(full).every(x=>/\sdisabled(?:=|\s|>)/u.test(x)));
 assert.ok(additions(lite).every(x=>!(/\sdisabled(?:=|\s|>)/u.test(x))));assert.match(lite,/غير متوفر — البيع يحتاج تأكيداً/);assert.doesNotMatch(lite,/نفد|0<\/bdi> باكيت/);
});
test('fresh availability includes mixed family/leaves once;200-id batches;mode drift and network fail closed',async()=>{
 const mixed:PosV2Line={commercial_line_kind:'configurable_parcel',family_product_id:id(1),parcel_configuration_id:id(2),configuration_revision:1,
  parcel_instances:[{components:[{product_id:id(3),base_quantity:2},{product_id:id(4),base_quantity:3}]}]};
 assert.deepEqual(posAvailabilityIds([mixed,{commercial_line_kind:'base_unit',product_id:id(3),base_quantity:1}]),[id(1),id(3),id(4)]);
 const lines:PosV2Line[]=Array.from({length:201},(_,i)=>({commercial_line_kind:'base_unit',product_id:id(i+1),base_quantity:1})),calls:number[]=[];
 const result=await readPosAvailability(lines,async ids=>{calls.push(ids.length);return {contractVersion:'sales-only-availability2-v1' as const,fullAccounting:false,
  products:ids.map(productId=>({productId,available:true,effectiveAvailable:true,active:true,parentAvailable:true,flavorMasterProductId:null,revision:0} satisfies ProductAvailability))};});
 assert.deepEqual(calls,[200,1]);assert.equal(result.length,201);
 await assert.rejects(readPosAvailability([mixed],async()=>({contractVersion:'sales-only-availability2-v1',fullAccounting:true,products:[]})),/POS_MODE_CHANGED/);
 await assert.rejects(readPosAvailability([mixed],async()=>{throw Error('NETWORK');}),/NETWORK/);
});
