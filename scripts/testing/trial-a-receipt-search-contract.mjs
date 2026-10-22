import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {searchSupplierReceiptRows} from '../../src/services/supabase/supplierReceiptSearch.ts';
import {testJwt,fixtureId as id} from '../audit/table-access-probes.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function trialAReceiptSearchContract({executor,sql,json,ownerRpc,url,secret}) {
  assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/u);
  const q=v=>"'"+String(v).replaceAll("'","''")+"'";
  for(const [n,role] of [[5,'manager'],[6,'warehouse_keeper'],[7,'accountant']])await sql(`
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
      VALUES(${q(id(n))},'authenticated','authenticated',${q(role+'@trial-a.example.test')},NOW(),'{}','{}');
    INSERT INTO profiles(id,full_name,is_active,branch_id) VALUES(${q(id(n))},${q(role)},true,${q(id(200))});
    INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(id(n))},r.id FROM roles r WHERE code=${q(role)};`);
  const makeClient=(n,role='authenticated')=>createClient(url,'local-audit-not-a-project-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:'Bearer '+testJwt(role,id(n),secret)},fetch:(input,init)=>{
      const target=new URL(String(input));assert.equal(target.origin,url);assert.ok(target.pathname.startsWith('/rest/v1/'));
      target.pathname=target.pathname.slice('/rest/v1'.length);return fetch(target,init);
    }}});
  await ownerRpc(`set_configurable_parcel_feature_state_v1('ENABLED')`);
  const beforeOptions=await ownerRpc(`get_pos_configurable_parcel_options_v1(${q(id(201))})`);
  assert.ok(beforeOptions.options.length>0,'Enabled real flavor option required as positive control');
  const n=await sql(`SELECT units_per_sale_unit FROM products WHERE id=${q(id(103))};`);
  await ownerRpc(`save_product_parcel_configuration_v1(${q(id(103))},'single_sku',true,${Number(n)},ARRAY[${q(id(103))}]::uuid[])`);
  const afterOptions=await ownerRpc(`get_pos_configurable_parcel_options_v1(${q(id(201))})`);
  assert.deepEqual(afterOptions,beforeOptions,'Single SKU must not create a second POS parcel option');
  const publicOptions=await json(`SELECT public.get_public_configurable_parcel_options(ARRAY[${q(id(103))}]::uuid[]);`);
  assert.deepEqual(publicOptions.options,[],'Single SKU must not create a second public mixed option');
  // Make the matching receipt older than a complete page of unrelated receipts.
  for(let i=0;i<31;i++){
    const line={client_line_id:id(8000+i),line_kind:'base_unit',commercial_quantity:1,base_unit_name:'باكيت',
      gross_amount_in_minor_units:200,line_discount_in_minor_units:0,components:[{product_id:id(i===0?101:102),base_quantity:1}]};
    const result=await ownerRpc(`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(id(200))},p_warehouse_id:=${q(id(201))},
      p_idempotency_key:=${q('trial-a-search-receipt-'+String(i).padStart(8,'0'))},p_payment_method:='deferred',p_lines:=${q(JSON.stringify([line]))}::jsonb)`);
    assert.equal(result.success,true);
  }
  const expected=await json(`SELECT COALESCE(jsonb_agg(id ORDER BY received_at DESC,id DESC),'[]'::jsonb)
    FROM supplier_receipts sr WHERE NOT is_archived AND EXISTS(SELECT FROM supplier_receipt_items sri
    JOIN products p ON p.id=sri.product_id WHERE sri.supplier_receipt_id=sr.id AND p.name_ar ILIKE '%نكهة أ%');`);
  assert.ok(expected.length>=2);assert.ok(expected.length<25);
  const owner=makeClient(1);
  const firstUnfiltered=await owner.from('supplier_receipts').select('id').eq('is_archived',false)
    .order('received_at',{ascending:false}).order('id',{ascending:false}).range(0,24);
  assert.equal(firstUnfiltered.error,null);assert.ok(expected.every(id=>!firstUnfiltered.data.some(r=>r.id===id)));
  const fingerprint=await readApplicationFingerprint(executor);
  const cases=[];
  for(const [n,role] of [[1,'owner'],[2,'admin'],[5,'manager'],[6,'warehouse_keeper'],[7,'accountant']]){
    const client=makeClient(n),permission=await client.rpc('get_supplier_receipts_page',{p_page:1,p_page_size:25});
    assert.equal(permission.error,null,role+' existing reader permission');
    const result=await searchSupplierReceiptRows(client,{search:'نكهة أ',page:1,pageSize:25});
    assert.equal(result.error,null,JSON.stringify(result.error));assert.equal(result.count,expected.length);
    assert.deepEqual(result.data.map(r=>r.id),expected);
    assert.ok(result.data.some(r=>r.supplier_receipt_items.length===2),'Search must retain all receipt items');
    cases.push({role,passed:true,matchingOutsideFirstPage:true});
  }
  const first=await searchSupplierReceiptRows(owner,{search:'نكهة',page:1,pageSize:25});
  const second=await searchSupplierReceiptRows(owner,{search:'نكهة',page:2,pageSize:25});
  assert.equal(first.error,null);assert.equal(second.error,null);assert.equal(first.data.length,25);
  assert.ok(second.data.length>0);assert.equal(first.count,second.count);
  assert.equal(first.data.length+second.data.length,first.count);
  assert.equal(new Set([...first.data,...second.data].map(r=>r.id)).size,first.count);
  const header=await searchSupplierReceiptRows(owner,{search:first.data[0].receipt_number,page:1,pageSize:25});
  assert.equal(header.error,null);assert.equal(header.count,1);assert.equal(header.data[0].id,first.data[0].id);
  for(const extra of [{supplierId:id(302)},{warehouseId:id(299)},{paymentStatus:'paid'},{isArchived:true}]){
    const r=await searchSupplierReceiptRows(owner,{search:'نكهة أ',page:1,pageSize:25,...extra});
    assert.equal(r.error,null);assert.equal(r.count,0);assert.deepEqual(r.data,[]);
  }
  for(const search of ['لا يوجد هذا الصنف','نكهة أ",receipt_number.not.is.null','نكهة أ(,\\)']){
    const r=await searchSupplierReceiptRows(owner,{search,page:1,pageSize:25});assert.equal(r.error,null);assert.equal(r.count,0);
  }
  for(const [n,role] of [[3,'cashier'],[4,'no-role']]){
    const denied=await makeClient(n).rpc('get_supplier_receipts_page',{p_page:1,p_page_size:25});
    assert.ok(denied.error,role+' must fail the existing reader gate');cases.push({role,existingReaderDenied:true,passed:true});
  }
  const denied=await makeClient(4,'anon').rpc('get_supplier_receipts_page',{p_page:1,p_page_size:25});assert.ok(denied.error);
  assert.deepEqual(await readApplicationFingerprint(executor),fingerprint,'Search must have zero writes,including sequences');
  return {ok:true,managedAccess:false,realPostgrest:true,matchingOutsideFirstPage:true,pages:2,fullItemsRetained:true,
    exactCount:first.count,filtersAndQuotedSearch:true,zeroWrites:true,singleSkuHasNoDuplicateParcel:true,cases};
}
