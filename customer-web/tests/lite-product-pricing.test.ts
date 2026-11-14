import test from 'node:test';
import assert from 'node:assert/strict';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {liteProductPriceRows,liteParcelSaving,liteFamilyStartingPrice,liteProductDescription} from '../src/utils/liteProductPricing';
const product=mapCatalogProduct({id:'12800000-0000-4000-8000-000000000173',sku:'PRICE-173',nameAr:'صنف وهمي',description:'24 حبة',unitNameAr:'باكيت',saleUnitNameAr:'طرد',unitsPerSalePackage:10,salePackagePriceInMinorUnits:15000,salePriceInMinorUnits:1850,quantityTracked:false,manualAvailable:true,availableQuantity:null,availableSalePackages:null,isAvailable:true});
test('OFF price rows expose saved1850 single and15000 parcel without deriving or changing either price',()=>{
 const before=JSON.stringify(product);
 assert.deepEqual(liteProductPriceRows(product),[{kind:'single',label:'باكيت',price:1850},{kind:'parcel',label:`طرد (${(10).toLocaleString('ar-JO')} باكيت)`,price:15000}]);
 assert.equal(liteParcelSaving(product),3500);assert.equal(JSON.stringify(product),before);
 assert.equal(liteParcelSaving({...product,salePackagePriceInMinorUnits:18500}),0);
 assert.equal(liteParcelSaving({...product,salePackagePriceInMinorUnits:1850}),0);
 assert.equal(liteParcelSaving({...product,quantityTracked:true}),0);
});
test('single and parcel-only rows use actual units;only enabled single/parcel pair advertises a saving',()=>{
 assert.deepEqual(liteProductPriceRows({...product,unitsPerSalePackage:1,unitNameAr:'صندوق',salePriceInMinorUnits:1900,salePackagePriceInMinorUnits:1900}),[{kind:'single',label:'صندوق',price:1900}]);
 assert.equal(liteProductPriceRows({...product,parcelOnly:true}).length,1);
 assert.equal(liteProductPriceRows({...product,parcelOnly:true})[0].price,15000);
 assert.equal(liteParcelSaving({...product,parcelOnly:true}),0);
});
test('family starting price uses selectable commercial prices;description formats only a pure content count',()=>{
 assert.equal(liteFamilyStartingPrice({...product,variants:[{...product,salePriceInMinorUnits:2100},{...product,salePriceInMinorUnits:1900}]}),1900);
 assert.equal(liteFamilyStartingPrice({...product,variants:[{...product,parcelOnly:true}]}),15000);
 assert.equal(liteProductDescription(product),'باكيت فيه 24 حبة');
 assert.equal(liteProductDescription({...product,unitNameAr:'شرنك'}),'شرنك فيه 24 حبة');
 assert.equal(liteProductDescription({...product,description:'24 حبة مغلفة'}),'24 حبة مغلفة');
});
