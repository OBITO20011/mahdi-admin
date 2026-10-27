import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {createCartItem,createBaseUnitCartItem,requiredBaseUnitsByProductId,formatCartQuantitySummary} from '../src/utils/cart';
import {buildGuestOrderV2Lines} from '../src/utils/checkout';
import {storefrontSaleUnit,storefrontPackageDescription,storefrontStock,remainingStorefrontUnits,remainingStorefrontParcels} from '../src/utils/storefrontUnits';
const product=mapCatalogProduct({id:'11111111-1111-4111-8111-111111111111',nameAr:'مياه',unitNameAr:'باكيت',saleUnitNameAr:'كرتونة',unitsPerSalePackage:10,salePackagePriceInMinorUnits:5500,salePriceInMinorUnits:550,availableQuantity:23,availableSalePackages:2,isAvailable:true});
test('canonical parcel copy retains independent stored prices and actual physical units',()=>{
 assert.equal(storefrontSaleUnit(product),'طرد');assert.equal(storefrontPackageDescription(product),`طرد (${(10).toLocaleString('ar-JO')} باكيت)`);
 assert.equal(storefrontStock(product),`${(2).toLocaleString('ar-JO')} طرد + ${(3).toLocaleString('ar-JO')} باكيت`);
 const loose={...product,unitsPerSalePackage:1,unitNameAr:'شوال',salePackagePriceInMinorUnits:7000,salePriceInMinorUnits:6500};
 assert.equal(storefrontSaleUnit(loose),'باكيت');assert.equal(storefrontPackageDescription(loose),'باكيت');assert.equal(storefrontStock(loose),`${(23).toLocaleString('ar-JO')} باكيت`);
 assert.equal(createCartItem(loose).unitPriceInMinorUnits,7000);assert.equal(createCartItem(loose).saleUnitNameAr,'شوال');assert.equal(createBaseUnitCartItem(loose).unitPriceInMinorUnits,6500);
});
test('mixed parcel/base-unit requirements share the same stock without counting a base unit as a parcel',()=>{
 const parcel={...createCartItem(product),quantity:1},unit={...createBaseUnitCartItem(product),quantity:4};
 const reserved=requiredBaseUnitsByProductId([parcel,unit]).get(product.id)!;assert.equal(reserved,14);
 assert.equal(remainingStorefrontUnits(product,reserved),9);assert.equal(remainingStorefrontParcels(product,reserved),0);
 assert.equal(remainingStorefrontUnits(product,23),0);assert.equal(remainingStorefrontParcels(product,23),0);
 assert.equal(remainingStorefrontParcels(product,0),2);
 assert.equal(formatCartQuantitySummary([parcel,unit]),`${(1).toLocaleString('ar-JO')} طرد + ${(4).toLocaleString('ar-JO')} باكيت`);
});
test('presentation does not mutate saved carts or either canonical guest line payload',()=>{
 const items=[{...createCartItem(product),quantity:2},{...createBaseUnitCartItem(product),quantity:3}];
 const saved=JSON.stringify(items);formatCartQuantitySummary(items);assert.equal(JSON.stringify(items),saved);
 assert.deepEqual(buildGuestOrderV2Lines(items),[
 {commercial_line_kind:'legacy_single_sku_parcel',product_id:product.id,parcel_quantity:2,units_per_parcel:10,expected_unit_price_in_minor_units:5500},
 {commercial_line_kind:'base_unit',product_id:product.id,base_quantity:3,expected_unit_price_in_minor_units:550}]);
});
