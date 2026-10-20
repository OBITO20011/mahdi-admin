import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeStorefrontC6,storefrontC6Pins,inventoryBeforeStorefrontC6} from '../scripts/audit/source-before-storefront-c6.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
const read=(file:string)=>readFileSync(file,'utf8');
test('C6 restores every accepted206 source byte and its real-role coverage without repinning',async()=>{
 const historical=await inventoryBeforeStorefrontC6(),proof=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_206.json'));
 assert.deepEqual(historical.sources,proof.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,proof.results),proof.coverage);
 for(const[file,pin]of Object.entries(storefrontC6Pins) as Array<[string,{before:string|null;after:string;added?:boolean}]>){
  const current=read(file),restored=sourceBeforeStorefrontC6(file,current);
  assert.throws(()=>sourceBeforeStorefrontC6(file,current+'\nvoid 600;\n'),/STOREFRONT_C6_ENTIRE_CURRENT_FILE_CHANGED/u);
  if(pin.added)assert.equal(restored,null);else assert.equal(createHash('sha256').update(restored!).digest('hex'),pin.before);
 }
});
