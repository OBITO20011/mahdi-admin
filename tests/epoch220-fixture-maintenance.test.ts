import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertEpochFixtureTarget,epochMaintenanceTables} from '../scripts/testing/epoch220-fixture-maintenance.mjs';

const containerId='a'.repeat(64);
const container='supabase_db_nawasrah-sales-lite3-epoch-test';
const fixture=()=>({
 target:{containerId,executor:{command:'docker',args:['exec','-i',container,'psql','-U','postgres','-d','postgres']}},
 observed:{Id:containerId,Name:'/'+container,State:{Running:true},NetworkSettings:{Networks:{}},
  Config:{Labels:{'com.supabase.cli.project':'nawasrah-sales-lite3-epoch-test'}}}
});

test('epoch maintenance is bound to exactly four tables and the owned network-none test container',()=>{
 assert.deepEqual(epochMaintenanceTables,['products','warehouses','branches','inventory_balances']);
 const {target,observed}=fixture();
 assert.doesNotThrow(()=>assertEpochFixtureTarget(target,observed));
});

test('epoch maintenance refuses remote executors,other projects,replaced containers and attached networks',()=>{
 const {target,observed}=fixture();
 assert.throws(()=>assertEpochFixtureTarget({...target,executor:{command:'psql',args:[]}},observed),/EPOCH_FIXTURE_DOCKER_ONLY/u);
 assert.throws(()=>assertEpochFixtureTarget({...target,executor:{command:'docker',args:['exec','-i','other']}},observed),/EPOCH_FIXTURE_PROJECT_REQUIRED/u);
 assert.throws(()=>assertEpochFixtureTarget(target,{...observed,Id:'b'.repeat(64)}),/EPOCH_FIXTURE_CONTAINER_CHANGED/u);
 assert.throws(()=>assertEpochFixtureTarget(target,{...observed,NetworkSettings:{Networks:{external:{}}}}),/EPOCH_FIXTURE_NETWORK_FORBIDDEN/u);
 assert.throws(()=>assertEpochFixtureTarget(target,{...observed,Config:{Labels:{'com.supabase.cli.project':'other'}}}));
 assert.throws(()=>assertEpochFixtureTarget({...target,context:{}},observed));
});

test('owner cutover and opening guides forbid activation before221 and preserve both prerequisites',()=>{
 for(const file of [
  'docs/operations/GO_LIVE_CUTOVER_AR.md','docs/handover/ورقة-يوم-التشغيل.md',
  'docs/handover/ورقة-يوم-التشغيل.html','docs/operations/SALES_ONLY220_OWNER_AR.md',
  'docs/design/sales-only-phase2/OPENING_EPOCH_PROOF_AR.md'
 ]){
  const text=readFileSync(file,'utf8');
  assert.match(text,/تفعيل المحاسبة ممنوع قبل migration 221/u,file);
  assert.match(text,/LITE2_EPOCH_BUSY/u,file);
  assert.match(text,/بعد دقيقة بالمفتاح نفسه/u,file);
 }
 const deferred=readFileSync('docs/design/sales-only-phase3/README_AR.md','utf8');
 assert.match(deferred,/انتظار محدود بدل NOWAIT على LOCK TABLE/u);
 assert.match(deferred,/219:215\/542/u);
 assert.match(deferred,/كلاهما شرط قبل أي تفعيل فعلي/u);
});
