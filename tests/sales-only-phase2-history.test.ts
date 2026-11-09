import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inventory} from '../scripts/audit/table-access-inventory.mjs';
import {projectSalesOnlyPhase2Inventory} from '../scripts/testing/sales-only-phase2-history.mjs';
import {restoreSalesOnlyPhase2Hashes,salesOnlyPhase2Pins} from '../scripts/audit/source-before-sales-only-phase2.mjs';
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,canonical(v)])):v;
// Production signature sorts object keys by JS code-point order.
function digest(v:unknown):string{const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort((v as Record<string,unknown>)[k])])):v;return createHash('sha256').update(JSON.stringify(sort(v))).digest('hex');}
test('entire actual SDK inventory rewinds to frozen371-file tree;forged path/hash/query/role still rejected',async()=>{
 const current=await inventory(),before=projectSalesOnlyPhase2Inventory(current),frozen=JSON.parse(readFileSync('scripts/testing/product-workbook-history.json','utf8'));
 assert.ok(current.sources.length>before.sources.length);assert.equal(before.sources.length,371);
 const core=(e:Record<string,unknown>)=>Object.fromEntries(Object.entries(e).filter(([k])=>!['callers','screenPaths','reachability'].includes(k)));
 assert.equal(digest({sources:before.sources,entries:before.entries.map(core)}),frozen.currentSignature);
 assert.notDeepEqual(canonical(current.sources),canonical(before.sources));
 const badPath=structuredClone(current);badPath.sources.pop();assert.throws(()=>projectSalesOnlyPhase2Inventory(badPath),/PHASE2_PATHS/);
 const badHash=structuredClone(current);badHash.sources[0].sha256='0'.repeat(64);assert.throws(()=>projectSalesOnlyPhase2Inventory(badHash),/PHASE2_SOURCE/);
 const badQuery=structuredClone(current);badQuery.entries[0].calls[0].args.push('unreviewed');assert.throws(()=>projectSalesOnlyPhase2Inventory(badQuery),/PHASE2_ARGUMENTS/);
 const badRole=structuredClone(current);badRole.entries[0].role='anon';assert.throws(()=>projectSalesOnlyPhase2Inventory(badRole),/PHASE2_ARGUMENTS/);
});
test('hash inverse removes only exact known new sources;unknown hashes/files remain observable',async()=>{
 const current=await inventory(),old=restoreSalesOnlyPhase2Hashes(current.sources);
 for(const row of current.sources){const pin=salesOnlyPhase2Pins.entries[row.file];if(!pin||pin.after!==row.sha256)continue;
  const prior=old.find((r:{file:string;sha256:string})=>r.file===row.file);
  if(pin.beforeText===null)assert.equal(prior,undefined);else assert.equal(prior?.sha256,pin.before);
 }
 const unknown={file:'unreviewed.ts',sha256:'unapproved'};assert.deepEqual(restoreSalesOnlyPhase2Hashes([unknown]),[unknown]);
 const file=Object.keys(salesOnlyPhase2Pins.entries).find(f=>f.startsWith('src/services/'))!;
 const changed={file,sha256:'0'.repeat(64)};assert.deepEqual(restoreSalesOnlyPhase2Hashes([changed]),[changed]);
});
