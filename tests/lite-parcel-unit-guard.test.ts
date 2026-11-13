import assert from 'node:assert/strict';import test from 'node:test';
import {storefrontPackageDescription} from '../customer-web/src/utils/storefrontUnits';
import {createCartItem,createBaseUnitCartItem} from '../customer-web/src/utils/cart';
import type {CatalogProduct} from '../customer-web/src/types/catalog';
import {filterParcelFamilies,parcelFamilySearchKey} from '../src/utils/parcelFamilySearch';
const product:CatalogProduct={id:'94300000-0000-4000-8000-000000000100',nameAr:'عائلة اختبار وهمية',sku:'TEST-PARCEL',quantityTracked:false,unitNameAr:'باكيت',saleUnitNameAr:'باكيت',unitsPerSalePackage:7,salePriceInMinorUnits:1100,salePackagePriceInMinorUnits:1100,availableQuantity:null,availableSalePackages:null,variants:[],parcelOnly:false,isAvailable:true,barcode:'',description:'',categoryId:'',categoryCode:'',categoryNameAr:'',brandId:'',brandNameAr:'',unitId:'',saleUnitId:'',minimumOrderPackages:1,imageUrl:'',createdAt:'2026-11-13T00:00:00Z',soldPackagesLast90Days:0,isFlavorMaster:false,flavorMasterProductId:'',flavorNameAr:'',flavorSortOrder:0};
test('OFF package name cannot repeat its content unit while full copy remains unchanged',()=>{
 assert.equal(storefrontPackageDescription(product),'طرد (٧ باكيت)');
 assert.equal(storefrontPackageDescription({...product,quantityTracked:true}),'طرد (٧ باكيت)');
 assert.equal(storefrontPackageDescription({...product,unitsPerSalePackage:1}),'باكيت');
 assert.equal(storefrontPackageDescription({...product,unitNameAr:'طرد',saleUnitNameAr:'طرد'}),'مجموعة (٧ طرد)');
});

test('parcel family search reuses catalog normalization and folds Arabic variants without editing source names',()=>{
 const families=[{nameAr:'ألواح توداي',sku:'NW-0268'},{nameAr:'كرتونة حلوى',sku:'NW-0002'},{nameAr:'إيس كريم',sku:'NW-0003'}],before=structuredClone(families);
 for(const query of ['الواح','ألواح','إلواح','آلواح','توداي','0268','nw-0268'])assert.deepEqual(filterParcelFamilies(families,query),[families[0]]);
 for(const query of ['كرتونه','كرتونة','حلوي'])assert.deepEqual(filterParcelFamilies(families,query),[families[1]]);
 assert.equal(parcelFamilySearchKey('ﺇِﻳﺲ ﻛﺮﻳﻢ'),'ايس كريم');assert.deepEqual(filterParcelFamilies(families,'إيس'),[families[2]]);
 assert.deepEqual(filterParcelFamilies(families,'لا يوجد'),[]);assert.equal(filterParcelFamilies(families,'  '),families);assert.deepEqual(families,before);
});
test('new OFF cart lines refuse N units at the stored single-unit price; full and valid packages stay unchanged',()=>{
 assert.throws(()=>createCartItem(product),/سعر.*الطرد/);
 assert.doesNotThrow(()=>createCartItem({...product,salePackagePriceInMinorUnits:7700,saleUnitNameAr:'صندوق'}));
 assert.doesNotThrow(()=>createCartItem({...product,quantityTracked:true,availableQuantity:100,availableSalePackages:10}));
 assert.equal(createBaseUnitCartItem(product).unitPriceInMinorUnits,1100);
});
