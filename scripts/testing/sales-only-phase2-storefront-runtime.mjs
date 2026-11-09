import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
export async function verifyLiteStorefront(c,report){
 const {json,rpc,sql,id,q,executor}=c;
 const flags=await json(`SELECT COALESCE(jsonb_agg(to_jsonb(a)),'[]') FROM sales_lite1.availability a WHERE product_id IN(${q(id(100))},${q(id(101))},${q(id(103))});`);
 const revision=pid=>flags.find(a=>a.product_id===pid)?.revision??0;
 const catalog=(args='')=>rpc(`lite1_catalog_page2(${args})`,null,'anon');
 const original=()=>rpc('get_public_storefront_catalog_page()',null,'anon');
 const parcel=()=>rpc(`lite1_parcel_options2(ARRAY[${q(id(100))}]::UUID[])`,null,'anon');
 // Calling this proof requires the owner test to have already selected OFF.
 assert.equal((await rpc('lite1_operating_mode()',null,'anon')).fullAccounting,false);
 const fp=await readApplicationFingerprint(executor),all=await catalog();
 assert.equal(all.contractVersion,'lite2-catalog-v1');assert.equal(all.quantityTracked,false);assert.ok(all.items.length>=4);
 for(const item of all.items){assert.equal(item.quantityTracked,false);assert.equal(item.availableQuantity,null);assert.equal(item.availableSalePackages,null);assert.equal(typeof item.manualAvailable,'boolean');if(!item.isFlavorMaster)assert.equal(item.isAvailable,true);}
 const basic=all.items.find(p=>p.id===id(103));assert.equal(basic.salePackagePriceInMinorUnits,4500);assert.equal(basic.salePriceInMinorUnits,1000);
 assert.equal(all.summary.availableSalePackages,null);assert.equal(all.summary.quantityTracked,false);assert.equal(all.summary.lowStockProducts,0);
 const p=await parcel();assert.equal(p.guestCreationEnabled,true);assert.equal(p.options.length,1);assert.equal(p.options[0].quantityTracked,false);assert.equal(p.options[0].parcelPriceInMinorUnits,5000);
 assert.equal(p.options[0].components.length,2);for(const component of p.options[0].components){assert.equal(component.quantityTracked,false);assert.equal(component.availableQuantity,null);assert.equal(component.manualAvailable,true);}
 const mapper=await tsImport('../../customer-web/src/services/catalog.service.ts',import.meta.url),cart=await tsImport('../../customer-web/src/utils/cart.ts',import.meta.url);
 const mapped=mapper.mapCatalogItems(all.items),basicModel=mapped.find(item=>item.id===basic.id);assert.ok(basicModel);assert.equal(basicModel.isAvailable,true);
 const saved={...cart.createCartItem(basicModel),quantity:7};assert.equal(saved.maxAvailablePackages,null);assert.equal(cart.isCurrentCartItem(saved),true);assert.equal(cart.reconcileCartSnapshot([saved],mapped,[basic.id]).items[0].quantity,7);assert.equal(cart.calculateCartSubtotal([saved]),31500);
 const mappedParcel=mapper.mapPublicConfigurableParcelResponse(p);assert.equal(mappedParcel.options[0].quantityTracked,false);assert.equal(mappedParcel.options[0].components[0].availableQuantity,null);
 const merchandising=await rpc('lite1_merchandising2()',null,'anon');assert.equal(merchandising.quantityTracked,false);assert.deepEqual(merchandising.lowStock,[]);
 const publicData=JSON.stringify([all,p,merchandising]);assert.doesNotMatch(publicData,/wac|cost|supplier|customerPhone|purchase_price|session|token/i);
 assert.deepEqual(await readApplicationFingerprint(executor),fp,'PUBLIC_READERS_ZERO_WRITES');
 const categories=all.categories,facets=all.saleUnits;
 const filtered=await catalog(`p_limit:=1,p_offset:=0,p_search:=${q(basic.sku)}`);assert.equal(filtered.total,1);assert.equal(filtered.items[0].id,basic.id);assert.deepEqual(filtered.categories,categories);assert.deepEqual(filtered.saleUnits,facets);
 await rpc(`lite1_set_available2(${q(id(103))},false,${revision(id(103))})`);
 const unavailable=(await catalog()).items.find(p=>p.id===id(103));assert.equal(unavailable.isAvailable,false);assert.equal(unavailable.manualAvailable,false);
 const availablePage=await catalog("p_availability:='available'");assert.ok(!availablePage.items.some(p=>p.id===id(103)));
 await rpc(`lite1_set_available2(${q(id(103))},true,${revision(id(103))+1})`);
 await rpc(`lite1_set_available2(${q(id(101))},false,${revision(id(101))})`);assert.deepEqual((await parcel()).options[0].components.map(p=>p.productId),[id(102)]);
 await rpc(`lite1_set_available2(${q(id(101))},true,${revision(id(101))+1})`);
 await rpc(`lite1_set_available2(${q(id(100))},false,${revision(id(100))})`);assert.deepEqual((await parcel()).options,[]);assert.ok((await catalog()).items.filter(p=>p.flavorMasterProductId===id(100)).every(p=>!p.isAvailable));
 await rpc(`lite1_set_available2(${q(id(100))},true,${revision(id(100))+1})`);
 for(const call of [`lite1_catalog_page2(p_search:=${q('x'.repeat(501))})`,'lite1_parcel_options2(ARRAY[]::UUID[])']){let error;try{await rpc(call,null,'anon');}catch(e){error=e;}assert.ok(error,'INVALID_PUBLIC_INPUT_REFUSED');}
 assert.equal(await sql("SELECT has_function_privilege('anon','sales_lite2.catalog_page(integer,integer,uuid,text,text,text,uuid,uuid,uuid[])','EXECUTE') OR has_function_privilege('authenticated','sales_lite2.parcel_options(uuid[])','EXECUTE');"),'f');
 // Full delegates the original complete public JSON,including stock quantities.
 await sql('UPDATE sales_lite1.mode SET full_accounting=true;');
 try{
  assert.deepEqual(await catalog(),await original(),'FULL_CATALOG_ALL_JSON_UNCHANGED');
  assert.deepEqual(await parcel(),await rpc(`get_public_configurable_parcel_options(ARRAY[${q(id(100))}]::UUID[])`,null,'anon'),'FULL_PARCEL_ALL_JSON_UNCHANGED');
  assert.deepEqual(await rpc('lite1_merchandising2()',null,'anon'),await rpc('get_public_storefront_merchandising()',null,'anon'),'FULL_MERCHANDISING_ALL_JSON_UNCHANGED');
 }finally{await sql('UPDATE sales_lite1.mode SET full_accounting=false;');}
 report.cases.push({name:'public catalog+parcel+merchandising parallel readers:real prices/facets/pages/manualparent+flavoravailability,nullquantity,no private data/readonly/invalidinput/privateACL;fullJSONexact',passed:true});
}
