import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {createBaseUnitCartItem,createCartItem,createConfigurableParcelCartItem,createParcelInstance,formatCartQuantitySummary} from '../src/utils/cart';
import {buildGuestOrderV2Lines} from '../src/utils/checkout';
import {storefrontCartUnit,storefrontCartPackageDescription,storefrontPackageDescription,storefrontSaleUnit,storefrontStock,storefrontUnitName} from '../src/utils/storefrontUnits';
import {receiptLineDescription,receiptDocumentShareText,type CommercialReceiptLine} from '../src/receipts/commercialReceipt';
import {publicReceiptDocument} from '../src/receipts/publicReceipt';
import {ReceiptDocument} from '../src/receipts/ReceiptDocument';
import type {PublicConfigurableParcelOption} from '../src/types/catalog';
const id=(n:number)=>'12800000-0000-4000-8000-'+String(n).padStart(12,'0');
const make=(unitNameAr:string,size=12)=>mapCatalogProduct({id:id(1),sku:'TRIAL-TA',nameAr:'صنف وهمي',unitNameAr,saleUnitNameAr:'كرتونة',unitsPerSalePackage:size,salePackagePriceInMinorUnits:6000,salePriceInMinorUnits:500,availableQuantity:26,availableSalePackages:2,isAvailable:true});

test('every stored base unit displays packet while raw catalogue and cart metadata stay intact',()=>{
 for(const unit of ['قنينة','قنينة / زجاجة','علبة','شوال','باكيت','وحدة','']){
  const product=make(unit),snapshot=JSON.stringify(product),single=createBaseUnitCartItem(product),parcel=createCartItem(product),saved=JSON.stringify([single,parcel]);
  assert.equal(storefrontUnitName(product.unitNameAr),'باكيت');assert.equal(storefrontSaleUnit(product),'طرد');assert.equal(storefrontCartUnit(single),'باكيت');assert.equal(storefrontCartUnit(parcel),'طرد');
  assert.equal(storefrontPackageDescription(product),`طرد (${(12).toLocaleString('ar-JO')} باكيت)`);assert.equal(storefrontCartPackageDescription(parcel),storefrontPackageDescription(product));
  assert.equal(storefrontStock(product),`${(2).toLocaleString('ar-JO')} طرد + ${(2).toLocaleString('ar-JO')} باكيت`);
  assert.equal(single.saleUnitNameAr,product.unitNameAr);assert.equal(formatCartQuantitySummary([single,parcel]),`${(1).toLocaleString('ar-JO')} باكيت + ${(1).toLocaleString('ar-JO')} طرد`);
  assert.deepEqual(buildGuestOrderV2Lines([single,parcel]),[{commercial_line_kind:'base_unit',product_id:product.id,base_quantity:1,expected_unit_price_in_minor_units:500},{commercial_line_kind:'legacy_single_sku_parcel',product_id:product.id,parcel_quantity:1,units_per_parcel:12,expected_unit_price_in_minor_units:6000}]);
  assert.equal(JSON.stringify(product),snapshot);assert.equal(JSON.stringify([single,parcel]),saved);
  const loose=make(unit,1),old=createCartItem(loose);assert.equal(storefrontSaleUnit(loose),'باكيت');assert.equal(storefrontCartUnit(old),'باكيت');assert.equal(old.saleUnitNameAr,loose.unitNameAr);assert.equal(old.unitPriceInMinorUnits,6000);
 }
});

test('formed parcel keeps flavor units and exact guest payload behind packet-only presentation',()=>{
 const product=make('قنينة'),option:PublicConfigurableParcelOption={familyProductId:id(1),parcelConfigurationId:id(2),configurationRevision:7,compositionMode:'configurable_mix',unitsPerParcel:3,parcelPriceInMinorUnits:1500,baseUnitNameAr:'زجاجة',saleUnitNameAr:'كرتونة',components:[]};
 const instance=createParcelInstance([{productId:id(3),sku:'TA-B',nameAr:'توت',flavorNameAr:'توت',unitNameAr:'قنينة',imageUrl:'',baseQuantity:2},{productId:id(4),sku:'TA-O',nameAr:'برتقال',flavorNameAr:'برتقال',unitNameAr:'علبة',imageUrl:'',baseQuantity:1}]);
 const raw=JSON.stringify({product,option,instance}),item=createConfigurableParcelCartItem(product,option,instance);
 assert.equal(storefrontCartUnit(item),'طرد');assert.equal(storefrontCartPackageDescription(item),`طرد (${(3).toLocaleString('ar-JO')} باكيت)`);assert.deepEqual(item.parcelInstances[0].components.map(c=>c.unitNameAr),['قنينة','علبة']);assert.equal(item.saleUnitNameAr,'كرتونة');
 assert.deepEqual(buildGuestOrderV2Lines([item]),[{commercial_line_kind:'configurable_parcel',family_product_id:id(1),parcel_configuration_id:id(2),configuration_revision:7,expected_unit_price_in_minor_units:1500,parcel_instances:[{components:[{product_id:id(3),base_quantity:2},{product_id:id(4),base_quantity:1}]}]}]);
 assert.throws(()=>createConfigurableParcelCartItem(product,option,createParcelInstance([])),/3 باكيت/u);assert.equal(JSON.stringify({product,option,instance}),raw);
});

test('public receipt,print and sharing show packets using saved line evidence without rewriting it',()=>{
 const saved={orderNumber:'POS-TA',createdAt:'2026-10-28T08:00:00Z',status:'completed',paymentMethod:'cash',paymentStatus:'paid',subtotalInMinorUnits:7500,discountInMinorUnits:0,totalInMinorUnits:7500,branch:{name:'فرع اختبار',address:'',phone:''},items:[{productName:'صنف وهمي',sku:'TA',packageQuantity:3,packageName:'قنينة',unitsPerPackage:1,packagePriceInMinorUnits:500,lineTotalInMinorUnits:1500,commercialLineKind:'base_unit',baseQuantity:3,baseUnitName:'قنينة'},{productName:'صنف وهمي',sku:'TA',packageQuantity:1,packageName:'كرتونة',unitsPerPackage:12,packagePriceInMinorUnits:6000,lineTotalInMinorUnits:6000,commercialLineKind:'legacy_single_sku_parcel',baseQuantity:12,baseUnitName:'علبة'}]},before=JSON.stringify(saved);
 const receipt=publicReceiptDocument(saved);assert.deepEqual(receipt.lines.map(receiptLineDescription),['3 باكيت','1 طرد (12 باكيت)']);
 const html=renderToStaticMarkup(React.createElement(ReceiptDocument,{receipt})),shared=receiptDocumentShareText(receipt);
 for(const output of [html,shared]){assert.ok(output.includes('3 باكيت'));assert.ok(output.includes('1 طرد (12 باكيت)'));assert.ok(output.includes('7.500'));assert.doesNotMatch(output,/قنينة|علبة|كرتونة/u);}
 assert.equal(JSON.stringify(saved),before);assert.equal(receipt.lines[0].baseUnitName,'قنينة');assert.equal(receipt.lines[1].baseUnitName,'علبة');
 const unknown:CommercialReceiptLine={key:'old',name:'تاريخي',quantity:2,baseQuantity:999,savedUnitName:'تغليف تاريخي',totalInMinorUnits:1000};assert.equal(receiptLineDescription(unknown),'2 باكيت');assert.equal(receiptLineDescription({...unknown,savedUnitName:'صندوق'}),'2 طرد');assert.equal(unknown.baseQuantity,999);
});
