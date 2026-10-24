import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='docs/operations/pre-handover-evidence/';
const load=async(name:string)=>JSON.parse(await readFile(base+name+'.json','utf8'));

test('handover evidence manifest retains every captured artifact without hash drift',async()=>{
 const manifest=JSON.parse(await readFile('docs/operations/PREHANDOVER_AUDIT_EVIDENCE.json','utf8'));
 assert.equal(manifest.baseline,'d72f70918a63126b1d561c3a14b6c4b5bd652786');
 assert.equal(manifest.managedAccess,false);assert.equal(manifest.productFixes,false);
 assert.equal(manifest.files.length,17);
 for(const file of manifest.files){const bytes=await readFile(base+file.file);assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.file);}
});

test('golden day independent money and stock oracle matches all captured facts',async()=>{
 const raw=await load('golden-day'),verified=await load('golden-day-independent-verification');
 assert.equal(raw.completed,true);assert.equal(raw.steps.length,31);assert.equal(verified.checks.length,18);
 for(const check of verified.checks)assert.deepEqual(check.actual,check.expected,check.name);
 assert.equal(raw.final.drawer.expectedCashInMinorUnits,1019500);
 assert.equal(raw.final.finance.sales.netProfitInMinorUnits,-2500);
 assert.equal(raw.final.customerA.total_in_minor_units,1500);assert.equal(raw.final.customerB.total_in_minor_units,3000);
 assert.equal(raw.final.supplierDue,237000);
});

test('actual212 attack evidence includes observed competing sessions and cost difference without duplicate loss',async()=>{
 const attack=await load('adversarial'),cost=await load('cost-difference');
 assert.equal(attack.ok,true);assert.equal(attack.cases.length,35);assert.ok(attack.cases.every((c:{passed:boolean})=>c.passed));
 assert.equal(attack.cases.filter((c:{evidence:{observedLock?:boolean}})=>c.evidence.observedLock).length,2);
 assert.equal(cost.ok,true);assert.equal(cost.checks.length,9);
 for(const check of cost.checks)assert.deepEqual(check.actual,check.expected,check.name);
});

test('full requested scale and slow annual report remain visible rather than converted to a pass',async()=>{
 const seed=await load('scale-seed'),perf=await load('performance'),annual=await load('long-period');
 assert.equal(seed.ok,true);assert.deepEqual(seed.counts,{orders:50000,products:3120,customers:500,movements:200000,sellableSkus:3000});
 assert.ok(Object.values(seed.consistency).every(n=>n===0));assert.equal(perf.results.length,11);
 for(const result of perf.results){assert.equal(result.ok,true);assert.equal(result.samples.length,20);assert.ok(result.samples.every((s:{serverMs:number})=>Number.isFinite(s.serverMs)));}
 const slow=annual.results.find((r:{name:string})=>r.name==='annual-report');assert.equal(slow.samples.length,3);assert.ok(slow.samples.every((s:{ms:number})=>s.ms>2000));assert.match(slow.nested.plansAndDiagnostics,/first_completion AS MATERIALIZED/);
});
