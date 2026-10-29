import {verifiedInventoryBeforeTrialR} from '../scripts/audit/source-before-trial-owner-r.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {assertCompleteReturnAllocation} from '../src/features/orders/aftercarePresentation';
import {businessErrorMessage} from '../src/utils/businessError';
import {unitCountLabel} from '../src/utils/unitLabels';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {trialJPins,sourceBeforeTrialJ,inventoryBeforeTrialJ} from '../scripts/audit/source-before-trial-aftercare.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';

test('whole-parcel allocation identifies the missing saved flavor without losing its name in notifications', () => {
  for (const allocation of [undefined, {sellableRestock: 0, defectNonSellable: 0, customerDamage: 0},
    {sellableRestock: 2, defectNonSellable: -1, customerDamage: 2},
    {sellableRestock: 1.5, defectNonSellable: 1.5, customerDamage: 0},
    {sellableRestock: 2, defectNonSellable: 1, customerDamage: 1}]) {
    let failure: unknown;
    try { assertCompleteReturnAllocation('عصير برتقال', allocation, 3); } catch (cause) { failure = cause; }
    assert.ok(failure instanceof Error);
    const shown = businessErrorMessage(failure);
    assert.match(shown, /عصير برتقال/u);
    assert.match(shown, /3 باكيت/u);
    assert.doesNotMatch(shown, /PHASE43_|UUID|الممثل/u);
  }
  assert.doesNotThrow(() => assertCompleteReturnAllocation('عصير توت',
    {sellableRestock: 1, defectNonSellable: 1, customerDamage: 1}, 3));
});

test('legacy stored package names display as parcels without changing arbitrary base unit names', () => {
  for (const saved of ['كرتونة','كرتون','كراتين']) {
    assert.equal(unitCountLabel(1,saved),'طرد');assert.equal(unitCountLabel(4,saved),'طرود');assert.equal(unitCountLabel(12,saved),'طرد');
  }
  assert.equal(unitCountLabel(3,'قنينة'),'قناني');assert.equal(unitCountLabel(3,'وحدة قديمة'),'وحدة قديمة');
});

test('J exact additive inverse preserves delivered210 sources and fails closed on any extra mutation',()=>{
  const base='74cc431e9b8d4bf01c03c65e5d1740a61647fd56';
  for(const [file,pin] of Object.entries(trialJPins) as [string,{added?:boolean}][]){
    const current=readFileSync(file,'utf8'),restored=sourceBeforeTrialJ(file,current);
    assert.throws(()=>sourceBeforeTrialJ(file,current+'\nvoid unapproved;\n'));
    if(pin.added)assert.equal(restored,null);else{
      const previous=execFileSync('git',['show',base+':'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
      assert.equal(restored,previous,file);assert.throws(()=>sourceBeforeTrialJ(file,previous+'\nvoid unapproved;\n'));
    }
  }
  const changed=execFileSync('git',['diff','--name-only',base,'--','supabase/migrations'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  assert.ok(changed.every(f=>Number(f.split('/').at(-1)!.slice(0,3))>210),'001-210 immutable');
});

test('J current actual SDK evidence covers every real source/actor/variant while frozen210 remains exact',async()=>{
  const proof=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_211.json','utf8')),current=await verifiedInventoryBeforeTrialR();
  assert.equal(proof.migrationCeiling,211);assert.equal(proof.managedAccess,false);assert.equal(proof.infrastructureOk,true);assert.equal(proof.applicationReady,true);
  assert.deepEqual(proof.sourceHashes,current.sources);assert.deepEqual(proof.coverage,verifyProbeCoverage(current,proof.results));assert.ok(proof.results.every((r:{sqlstate:string|null})=>r.sqlstate===null));
  assert.deepEqual((await inventoryBeforeTrialJ()).sources,JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_210.json','utf8')).sourceHashes);
});

test('defective-unit211 changes only replacement admission;full-return commercial guard and209 sales guards are immutable',()=>{
 const current=readFileSync('supabase/migrations/211_aftercare_supplier_disposition.sql','utf8').replaceAll('\r\n','\n');
 const old=readFileSync('supabase/migrations/209_product_sale_methods.sql','utf8').replaceAll('\r\n','\n');
 const extract=(text:string,name:string)=>{const start=text.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');assert.ok(start>=0);const rest=text.slice(start),tag=rest.match(/AS (\$[a-zA-Z_]*\$)/)![1],end=rest.indexOf(tag+';',rest.indexOf(tag)+tag.length)+tag.length+1;return rest.slice(0,end);};
 const before=extract(old,'parcel209_replacement_issuer_internal');
 const expected=before.replace('PERFORM public.package_d_assert_whole_single_sku_quantity_internal(v_root_order_item_id,v_quantity);','PERFORM public.aftercare211_assert_replacement_root_internal(v_root_order_item_id,v_quantity);')
  .replace('  PERFORM public.parcel209_guard_replacement_internal(v_prepared);','  -- Same-SKU supplier_defect issuer only; no whole-commercial restriction on defective pieces.');
 assert.equal(extract(current,'parcel209_replacement_issuer_internal'),expected,'canonical writer math,locks,window,COGS,replay,evidence byte-identical outside two approved admission sites');
 assert.doesNotMatch(current,/CREATE(?: OR REPLACE)? FUNCTION public\.(?:package_d_assert_whole_single_sku_quantity_internal|settle_admin_sales_return_v1|create_pos_sale_v2|submit_guest_customer_order_v2|create_customer_order)\(/u);
 const proof=extract(current,'phase42_assert_operational_return_evidence_internal');
 assert.match(proof,/package_d_assert_whole_single_sku_quantity_internal\(v_item\.order_item_id,v_item\.returned_quantity\)/u);
 assert.match(proof,/package_d_assert_carton_return_item_internal\(to_jsonb\(v_item\)\)/u);
 assert.doesNotMatch(current,/current_setting\('.*(?:defect|bypass|admission)/iu,'client GUC never controls exception');
});

test('approved211 source hash is included in takeover/preflight admission,not just historical210',async()=>{
 const {migrationInventory}=await import('../scripts/agent/lib.mjs');
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
 assert.equal(migrationInventory().integrationPins[211],state.migration211CanonicalLfSha256);
 const preflight=readFileSync('scripts/agent/preflight.mjs','utf8');
 const approved=preflight.match(/for\(const number of \[([^\]]+)\]/u)![1].split(',').map(Number);
 assert.ok(approved.includes(211));assert.match(preflight,/migrations\.integrationPins\[number\]!==state\[`migration\$\{number\}CanonicalLfSha256`\]/u);
});
