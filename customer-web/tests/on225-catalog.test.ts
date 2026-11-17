import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCatalogProduct} from '../src/services/catalog.service';
import {readCatalog225,readOperatingCatalog} from '../src/utils/operatingRead';
import {liteParcelSaving,liteProductPriceRows} from '../src/utils/liteProductPricing';
import {remainingStorefrontParcels,remainingStorefrontUnits} from '../src/utils/storefrontUnits';
import {createBaseUnitCartItem,createCartItem,reconcileCartSnapshot} from '../src/utils/cart';

const raw={
 id:'22500000-0000-4000-8000-000000000001',
 nameAr:'صنف وهمي',
 unitNameAr:'باكيت',
 saleUnitNameAr:'طرد',
 unitsPerSalePackage:12,
 salePriceInMinorUnits:1000,
 salePackagePriceInMinorUnits:11000,
 parcelSaleEnabled:true,
 isAvailable:true,
 availableQuantity:3,
 availableSalePackages:0,
};

test('ON225 shows loose units below one parcel and preserves both prices',()=>{
 const product=mapCatalogProduct(raw);
 assert.equal(product.isAvailable,true);
 assert.equal(remainingStorefrontUnits(product,1),2);
 assert.equal(remainingStorefrontParcels(product,0),0);
 assert.deepEqual(liteProductPriceRows(product).map(({kind,price})=>[kind,price]),[['single',1000],['parcel',11000]]);
 assert.equal(liteParcelSaving(product),1000);
 assert.equal(mapCatalogProduct({...raw,parcelOnly:true}).isAvailable,false);
 assert.equal(mapCatalogProduct({...raw,parcelSaleEnabled:undefined}).isAvailable,false);
});

test('a paused ON225 parcel disappears from price and cart while its single is unchanged',()=>{
 const before=mapCatalogProduct({...raw,availableQuantity:36,availableSalePackages:3});
 const paused=mapCatalogProduct({...raw,parcelSaleEnabled:false,availableQuantity:36,availableSalePackages:0});
 assert.equal(paused.isAvailable,true);
 assert.equal(remainingStorefrontParcels(paused,0),0);
 assert.deepEqual(liteProductPriceRows(paused).map(({kind,price})=>[kind,price]),[['single',1000]]);
 assert.equal(liteParcelSaving(paused),0);
 const result=reconcileCartSnapshot([createCartItem(before),createBaseUnitCartItem(before)],[paused],[before.id]);
 assert.equal(result.removedUnavailableItems,1);
 assert.deepEqual(result.items.map(i=>[i.commercialLineKind,i.unitPriceInMinorUnits]),[['base_unit',1000]]);
 assert.equal(mapCatalogProduct({...raw,parcelSaleEnabled:false,parcelOnly:true,availableSalePackages:3}).isAvailable,false);
});

test('225 falls back only for a named PostgREST missing function',async()=>{
 const args={p_limit:24,p_availability:'available'};
 const calls:string[]=[];
 const missing=(name:string)=>({data:null,error:{code:'PGRST202',message:name},status:404});
 const fallback={data:{items:[]},error:null,status:200};
 const rpc=async(name:string,input?:Record<string,unknown>)=>{
  calls.push(name);
  assert.deepEqual(input,args);
  return name==='public_storefront_catalog_page225'?missing(name):fallback;
 };
 assert.equal(await readCatalog225(rpc,'public_storefront_catalog_page225',args,()=>readOperatingCatalog(rpc,'lite1_catalog_page2',args)),fallback);
 assert.deepEqual(calls,['public_storefront_catalog_page225','lite1_catalog_page2']);
 for(const denied of [{...missing('other_rpc')},{...missing('public_storefront_catalog_page225'),status:503}]){
  assert.equal(await readCatalog225(async()=>denied,'public_storefront_catalog_page225',args,async()=>{assert.fail('unexpected fallback');}),denied);
 }
});
