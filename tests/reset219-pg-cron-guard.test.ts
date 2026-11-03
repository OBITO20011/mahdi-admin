import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reset219CronStatements,reset219CronIdentity,assertReset219CronIdentity,guardedReset219CronUnits,verifyExistingReset219Cron} from '../scripts/operations/reset219-pg-cron-guard.mjs';
import {resetUnits} from '../scripts/operations/trial-reset-core.mjs';
import {migrationManifest,manifestDigest} from '../scripts/testing/maintenance-db-contract.mjs';
const identity={name:'pg_cron',version:'1.6.4',schema:'pg_catalog',owner:'supabase_admin'};
const fixture=async()=>({migrationCeiling:219,catalog:{extensions:[identity]},manifest:await migrationManifest(process.cwd())});
test('219 exact file/line/hash guard replaces only three known extension statements;all other CREATE EXTENSION remains literal',async()=>{
 const ref=await fixture(),source=reset219CronStatements.map(s=>({name:s.name,input:readFileSync('supabase/migrations/'+s.name)}));
 const other={name:'033_order_web_push_notifications.sql',input:readFileSync('supabase/migrations/033_order_web_push_notifications.sql')};
 const plan=guardedReset219CronUnits([...source,other],ref);assert.deepEqual(plan.identity,identity);assert.equal(plan.replaced.length,3);assert.equal(plan.units.at(-1),other);
 const wrapped=source.map(u=>({...u,input:Buffer.concat([u.input,Buffer.from('\n\\echo EMPTY_BUILD_APPLIED:'+u.name+'\n')])}));
 const wrappedPlan=guardedReset219CronUnits(wrapped,ref);
 for(let i=0;i<3;i++)assert.equal(wrappedPlan.units[i].input.toString(),plan.units[i].input.toString()+'\n\\echo EMPTY_BUILD_APPLIED:'+source[i].name+'\n');
 const wrong=wrapped.map(u=>({...u,input:Buffer.from(u.input.toString().replace('EMPTY_BUILD_APPLIED:','UNREVIEWED_MARKER:'))}));assert.throws(()=>guardedReset219CronUnits(wrong,ref));
 for(let i=0;i<3;i++){const original=source[i].input.toString(),changed=plan.units[i].input.toString();assert.ok(changed.includes("RAISE EXCEPTION 'RESET219_PG_CRON_IDENTITY_MISMATCH'"));assert.ok(!changed.includes('CREATE EXTENSION IF NOT EXISTS pg_cron;'));assert.equal(changed.split('DO $reset219_existing_cron$').length,2);const replacement=changed.match(/DO \$reset219_existing_cron\$[\s\S]*?END \$reset219_existing_cron\$;/u)![0];assert.equal(changed.replace(replacement,'CREATE EXTENSION IF NOT EXISTS pg_cron;'),original);}
 for(const mutate of [(u:any[])=>{u[0].input=Buffer.from(u[0].input+'\n');},(u:any[])=>{u[0].name='another.sql';},(u:any[])=>{u.pop();},(u:any[])=>{u.push(u[0]);}]){const bad=source.map(x=>({...x}));mutate(bad);assert.throws(()=>guardedReset219CronUnits(bad,ref));}
 const bad=structuredClone(ref);bad.manifest.find(m=>m.name===source[0].name)!.sha256='0'.repeat(64);assert.throws(()=>guardedReset219CronUnits(source,bad));
 assert.throws(()=>guardedReset219CronUnits(source,{...ref,migrationCeiling:217}));
});
test('missing,different version/owner/schema and duplicates reject with read-only preflight before any mutation',async()=>{
 const reference=await fixture();assert.deepEqual(reset219CronIdentity(reference),identity);
 for(const value of [[],[{...identity,version:'0.0'}],[{...identity,owner:'postgres'}],[{...identity,schema:'public'}],[identity,identity]]){
  assert.throws(()=>assertReset219CronIdentity(value,identity));let calls=0;
  const ex={localOnly:true,localExecute:async(input:string)=>{calls++;assert.match(input,/^SELECT /u);assert.doesNotMatch(input,/CREATE|DROP|GRANT|REVOKE|INSERT|DELETE|UPDATE/u);return {code:0,stdout:JSON.stringify(value),stderr:''};}};
  await assert.rejects(()=>verifyExistingReset219Cron(ex,reference));assert.equal(calls,1);
 }
 const core=readFileSync('scripts/operations/trial-reset214-core.mjs','utf8');assert.ok(core.indexOf('await verifyExistingReset219Cron')<core.indexOf("report.stage='retention-preflight'"));assert.match(core,/policy\.ceiling===219\?guardedReset219CronUnits/u);
});
test('fresh/resetUnits source is unchanged and never imports or applies the RESET-only guard',async()=>{
 const manifest=await migrationManifest(process.cwd()),ref={migrationCeiling:219,manifest,manifestDigest:manifestDigest(manifest)};const units=await resetUnits(process.cwd(),ref);
 for(const spec of reset219CronStatements){const unit=units.find((u:any)=>u.name===spec.name);assert.ok(unit);assert.ok(unit.input.toString().includes('CREATE EXTENSION IF NOT EXISTS pg_cron;'));}
 const guarded=guardedReset219CronUnits(units,{...ref,catalog:{extensions:[identity]}});assert.equal(guarded.replaced.length,3);
 const build=readFileSync('scripts/operations/build-empty-supabase.mjs','utf8');assert.ok(!build.includes('reset219-pg-cron-guard'));assert.ok(!readFileSync('scripts/operations/trial-reset-core.mjs','utf8').includes('reset219-pg-cron-guard'));
});
