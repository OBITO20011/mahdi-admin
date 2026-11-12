import test from 'node:test';
import assert from 'node:assert/strict';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {createCartItem,createBaseUnitCartItem,formatCartQuantitySummary} from '../src/utils/cart';
import {storefrontSaleUnit,storefrontPackageDescription,storefrontCartUnit,storefrontCartPackageDescription} from '../src/utils/storefrontUnits';
import {receiptLineDescription,receiptDocumentShareText,type ReceiptDocumentData} from '../src/receipts/commercialReceipt';
import {buildGuestOrderV2Lines} from '../src/utils/checkout';

test('OFF uses each actual single unit throughout catalogue/cart/saved receipt, without changing the quote',()=>{
 for(const name of ['باكيت','صندوق','شرنك','كرتونة','طرد','شوال','قنينة','حافظة مخصصة']){
  const product=mapCatalogProduct({id:'12800000-0000-4000-8000-000000000001',sku:'UNIT',nameAr:'صنف وهمي',unitNameAr:name,saleUnitNameAr:'كرتونة',unitsPerSalePackage:1,salePackagePriceInMinorUnits:3500,salePriceInMinorUnits:3500,quantityTracked:false,manualAvailable:true,availableQuantity:null,availableSalePackages:null,isAvailable:true});
  for(const item of [createCartItem(product),createBaseUnitCartItem(product)]){
   const raw=JSON.stringify(item);
   assert.equal(storefrontSaleUnit(product),name);
   assert.equal(storefrontPackageDescription(product),name);
   assert.equal(storefrontCartUnit(item),name);
   assert.equal(storefrontCartPackageDescription(item),name);
   assert.ok(formatCartQuantitySummary([item]).includes(name));
   assert.equal(buildGuestOrderV2Lines([item])[0].expected_unit_price_in_minor_units,3500);
   const line={key:'saved',name:'قديم',kind:item.commercialLineKind,quantity:1,baseQuantity:1,baseUnitName:name,savedUnitName:name,totalInMinorUnits:3500,actualUnitNames:true};
   assert.equal(receiptLineDescription(line),'1 '+name);
   assert.equal(JSON.stringify(item),raw);
  }
 }
});

test('OFF package and cart describe saved packaging and contents; full copy stays unchanged',()=>{
 const product=mapCatalogProduct({id:'12800000-0000-4000-8000-000000000001',sku:'UNIT',nameAr:'وهمي',unitNameAr:'قنينة',saleUnitNameAr:'صندوق',unitsPerSalePackage:12,salePackagePriceInMinorUnits:10000,salePriceInMinorUnits:833,quantityTracked:false,manualAvailable:true,availableQuantity:null,availableSalePackages:null,isAvailable:true});
 const item=createCartItem(product);
 assert.equal(storefrontSaleUnit(product),'صندوق');
 assert.equal(storefrontPackageDescription(product),`صندوق (${(12).toLocaleString('ar-JO')} قنينة)`);
 assert.equal(storefrontCartPackageDescription(item),`صندوق (${(12).toLocaleString('ar-JO')} قنينة)`);
 assert.equal(storefrontSaleUnit({...product,quantityTracked:undefined}),'طرد');
 assert.equal(receiptLineDescription({key:'old',name:'قديم',kind:'base_unit',quantity:1,baseQuantity:1,baseUnitName:'قنينة',totalInMinorUnits:10000}),'1 باكيت');
 assert.equal(receiptLineDescription({key:'old',name:'قديم',kind:'legacy_single_sku_parcel',quantity:1,baseQuantity:12,baseUnitName:'قنينة',savedUnitName:'صندوق',totalInMinorUnits:10000,actualUnitNames:true}),'1 صندوق (12 قنينة)');
});

test('OFF receipt print/share uses immutable line labels, not a changed catalogue',()=>{
 const receipt:ReceiptDocumentData={businessName:'اختبار',number:'OLD',createdAt:'2026-11-12T08:00:00Z',branch:{name:'وهمي'},lines:[{key:'1',name:'منتج',kind:'base_unit',quantity:1,baseQuantity:1,baseUnitName:'شرنك',savedUnitName:'شرنك',totalInMinorUnits:3500,actualUnitNames:true}],subtotalInMinorUnits:3500,discountInMinorUnits:0,deliveryInMinorUnits:0,totalInMinorUnits:3500,paymentLabel:'كاش'};
 const raw=JSON.stringify(receipt);
 assert.ok(receiptDocumentShareText(receipt).includes('1 شرنك'));
 assert.equal(JSON.stringify(receipt),raw);
});
