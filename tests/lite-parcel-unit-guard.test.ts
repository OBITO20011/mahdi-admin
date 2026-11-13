import assert from 'node:assert/strict';import test from 'node:test';
import {storefrontPackageDescription} from '../customer-web/src/utils/storefrontUnits';
import {createCartItem} from '../customer-web/src/utils/cart';
import type {CatalogProduct} from '../customer-web/src/types/catalog';
const product={id:'94300000-0000-4000-8000-000000000100',nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',quantityTracked:false,unitNameAr:'باكيت',saleUnitNameAr:'باكيت',unitsPerSalePackage:7,salePriceInMinorUnits:1100,salePackagePriceInMinorUnits:1100,availableQuantity:null,availableSalePackages:null,variants:[],parcelOnly:false,isAvailable:true} as CatalogProduct;
test('OFF package name cannot repeat its content unit while full copy remains unchanged',()=>{
 assert.equal(storefrontPackageDescription(product),'طرد (٧ باكيت)');
 assert.equal(storefrontPackageDescription({...product,quantityTracked:true}),'طرد (٧ باكيت)');
 assert.equal(storefrontPackageDescription({...product,unitsPerSalePackage:1}),'باكيت');
});
test('new OFF cart lines refuse N units at the stored single-unit price; full and valid packages stay unchanged',()=>{
 assert.throws(()=>createCartItem(product),/سعر.*الطرد/);
 assert.doesNotThrow(()=>createCartItem({...product,salePackagePriceInMinorUnits:7700,saleUnitNameAr:'صندوق'}));
 assert.doesNotThrow(()=>createCartItem({...product,quantityTracked:true,availableQuantity:100,availableSalePackages:10}));
});
