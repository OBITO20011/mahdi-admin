import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {testJwt,fixtureId as id} from '../audit/table-access-probes.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
export async function parcel209AccessContract({executor,json,url,secret}){
 assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/u);
 const make=(n,role='authenticated')=>createClient(url,'local-audit-not-a-project-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+testJwt(role,id(n),secret)},fetch:(input,init)=>{const target=new URL(String(input));assert.equal(target.origin,url);assert.ok(target.pathname.startsWith('/rest/v1/'));target.pathname=target.pathname.slice('/rest/v1'.length);return fetch(target,init);}}});
 const params=await json(`SELECT jsonb_build_object('p_product_id',p.id,'p_expected_updated_at',p.updated_at,'p_sku',p.sku,'p_barcode',p.barcode,'p_name_ar',p.name_ar,'p_description',p.description,'p_category_id',p.category_id,'p_brand_id',p.brand_id,'p_unit_id',p.unit_id,'p_purchase_unit_id',p.purchase_unit_id,'p_units_per_purchase_unit',p.units_per_purchase_unit,'p_default_purchase_price_in_minor_units',p.default_purchase_price_in_minor_units,'p_sale_unit_id',p.sale_unit_id,'p_units_per_sale_unit',p.units_per_sale_unit,'p_default_sale_price_in_minor_units',p.default_sale_price_in_minor_units,'p_cost_price_in_minor_units',p.cost_price_in_minor_units,'p_min_stock_level',p.min_stock_level,'p_max_stock_level',p.max_stock_level,'p_is_active',p.is_active,'p_image_url',NULL,'p_parcel_only',true) FROM products p WHERE id='${id(100)}';`);
 const owner=make(1),changed=await owner.rpc('update_product_master_v5',params);assert.equal(changed.error,null);assert.equal(changed.data.parcelOnly,true);assert.equal(typeof changed.data.updatedAt,'string');
 const before=await readApplicationFingerprint(executor),items=[];
 for(const role of ['anon','authenticated']){const response=await make(1,role).rpc('get_public_storefront_catalog_page',{p_product_ids:[id(101),id(102)]});assert.equal(response.error,null);assert.deepEqual(response.data.items.map(p=>p.id).sort(),[id(100),id(101),id(102)].sort(),'catalog keeps the complete family,including its master');assert.ok(response.data.items.every(p=>p.parcelOnly===true));assert.doesNotMatch(JSON.stringify(response.data.items),/cost_price|wac_cost|default_purchase/iu);items.push({role,rows:3,parcelOnly:true});}
 const lookup=await make(2).rpc('search_admin_products',{p_product_id:id(101)});assert.equal(lookup.error,null);assert.equal(lookup.data[0].parcel_only,true);
 const denied=await make(4).rpc('create_product_with_opening_stock_v5',{p_sku:'209-NO-ROLE',p_name_ar:'مرفوض',p_units_per_sale_unit:5,p_default_sale_price_in_minor_units:5000,p_parcel_only:true});assert.ok(denied.error);assert.equal(denied.data,null);
 assert.deepEqual(await readApplicationFingerprint(executor),before,'public/admin reads and no-role refusal write no rows/sequences');
 const restored=await owner.rpc('update_product_master_v5',{...params,p_expected_updated_at:changed.data.updatedAt,p_parcel_only:false});assert.equal(restored.error,null);assert.equal(restored.data.parcelOnly,false);
 return {ok:true,ownerV5RestMutation:true,publicInheritedMethods:items,adminBarcodeMethod:true,noRoleRefused:true,readZeroWrites:true};
}
