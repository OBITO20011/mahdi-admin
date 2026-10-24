import assert from 'node:assert/strict';
import {aclEntries} from '../operations/managed-catalog-policy.mjs';
import {catalogDifference} from './schema-catalog.mjs';
export const closed213=['receive_inventory','create_product_with_opening_stock','create_product_with_opening_stock_v2','create_product_with_opening_stock_v3','enforce_product_flavor_inheritance','sync_product_flavor_commercial_settings'];
export function assertReady213Catalog(catalog){
 for(const name of closed213){const rows=catalog.functions.filter(f=>f.schema==='public'&&f.identity.startsWith(name+'('));assert.equal(rows.length,1,name);assert.equal(rows[0].owner,'postgres');assert.deepEqual(aclEntries(rows[0].acl,rows[0],'functions').filter(a=>a.grantee!=='postgres'),[],name);}
 const guard=catalog.functions.find(f=>f.schema==='public'&&f.identity.startsWith('package_d_reject_pos_cancellation_mutation('));assert.deepEqual(guard.configuration,['search_path=public, pg_temp']);
 const track=catalog.functions.find(f=>f.schema==='public'&&f.identity.startsWith('track_guest_order('));assert.match(track.definition,/VOLATILE|LANGUAGE plpgsql/);assert.match(track.definition,/guest_order_tracking_limits/);assert.deepEqual(track.configuration,['search_path=public, pg_temp']);
 for(const t of catalog.tables.filter(t=>t.schema==='public'))for(const a of aclEntries(t.acl,t,'tables'))if(['PUBLIC','anon','authenticated'].includes(a.grantee))assert.ok(!['TRUNCATE','REFERENCES','TRIGGER'].includes(a.privilege),t.name+':'+a.grantee);
 const limits=catalog.tables.find(t=>t.schema==='public'&&t.name==='guest_order_tracking_limits');assert.ok(limits);assert.equal(limits.owner,'postgres');assert.deepEqual(aclEntries(limits.acl,limits,'tables').filter(a=>a.grantee!=='postgres'),[]);
 assert.ok(!catalog.policies.some(p=>p.schema==='storage'&&p.name==='Public can read product images'));
 assert.ok(catalog.policies.some(p=>p.schema==='storage'&&p.name==='ERP staff can read own product image metadata'));
}
export function assert213Transition(before,after){
 assertReady213Catalog(after);const differences=catalogDifference(before,after);const seen=new Set();
 for(const d of differences){
  const item=d.after??d.before;const name=item.identity?.split('(')[0]??item.name??'';
  if(d.section==='functions'){
   assert.ok([...closed213,'track_guest_order','package_d_reject_pos_cancellation_mutation'].includes(name),'UNAPPROVED_FUNCTION_'+name);seen.add(name);
   const allowed=name==='track_guest_order'?['definition']:name==='package_d_reject_pos_cancellation_mutation'?['definition','configuration']:['acl'];
   const strip=o=>Object.fromEntries(Object.entries(o).filter(([k])=>!allowed.includes(k)));assert.deepEqual(strip(d.before),strip(d.after),'213_FUNCTION_METADATA_'+name);
  }else if(d.section==='tables'&&d.before&&d.after){
   assert.equal(item.schema,'public');assert.deepEqual({...d.before,acl:null},{...d.after,acl:null});
   const prior=aclEntries(d.before.acl,d.before,'tables'),next=aclEntries(d.after.acl,d.after,'tables');
   assert.deepEqual(next,prior.filter(a=>!(['PUBLIC','anon','authenticated'].includes(a.grantee)&&['TRUNCATE','REFERENCES','TRIGGER'].includes(a.privilege))));
  }else if(d.section==='policies'){
   assert.equal(item.schema,'storage');assert.ok(['Public can read product images','ERP staff can read own product image metadata'].includes(item.name));
  }else{
   assert.equal(d.before,null,'213_EXISTING_OBJECT_CHANGED_'+d.section);assert.equal(item.schema,'public');assert.match(JSON.stringify(item),/guest_order_tracking_limits/);
  }
 }
 for(const name of [...closed213,'track_guest_order','package_d_reject_pos_cancellation_mutation'])assert.ok(seen.has(name),name);
 return differences;
}
