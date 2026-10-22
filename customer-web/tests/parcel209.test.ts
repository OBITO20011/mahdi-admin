import assert from 'node:assert/strict';import test from 'node:test';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {createBaseUnitCartItem,createCartItem,reconcileCart,reconcileCartSnapshot} from '../src/utils/cart';
const product=mapCatalogProduct({id:'43210000-0000-4000-8000-000000000001',sku:'209-STORE',nameAr:'شيبس',unitsPerSalePackage:10,salePackagePriceInMinorUnits:15000,salePriceInMinorUnits:1500,availableQuantity:100,availableSalePackages:10,isAvailable:true,unitNameAr:'باكيت',saleUnitNameAr:'طرد'});
test('209 catalog carries strict server boolean;new unit entry refused,parcel price and physical quantity unchanged',()=>{
 const restricted={...product,parcelOnly:true};assert.throws(()=>createBaseUnitCartItem(restricted),/بيتباع بالطرد بس/);const parcel=createCartItem(restricted);assert.equal(parcel.unitsPerSalePackage,10);assert.equal(parcel.unitPriceInMinorUnits,15000);
 assert.equal(mapCatalogProduct({...product,parcelOnly:'true'}).parcelOnly,false);assert.equal(mapCatalogProduct({...product,parcelOnly:true}).parcelOnly,true);
});
test('209 ordinary old unit cart is retained exactly,then fresh checkout requires correction before mutation',()=>{
 const old={...createBaseUnitCartItem(product),quantity:10},before=structuredClone(old),restricted={...product,parcelOnly:true,salePriceInMinorUnits:9999};
 assert.deepEqual(reconcileCart([old],[restricted]),[before]);assert.deepEqual(old,before);assert.throws(()=>reconcileCartSnapshot([old],[restricted],[product.id]),/احذف سطر المفرد/);assert.deepEqual(old,before);
});
