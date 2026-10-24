import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceBeforeCorrections207,corrections207Pins,inventoryBeforeCorrections207} from '../scripts/audit/source-before-corrections207.mjs';
import {verifyProbeCoverage} from '../scripts/audit/table-access-probes.mjs';
test('207 restores accepted C6 source/readiness exactly and refuses any unpinned source mutation',async()=>{
 const old=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_STOREFRONT_C6.json','utf8')),historical=await inventoryBeforeCorrections207();
 assert.deepEqual(historical.sources,old.sourceHashes);assert.deepEqual(verifyProbeCoverage(historical,old.results),old.coverage);
 for(const [file,pin]of Object.entries(corrections207Pins) as Array<[string,{before:string|null;after:string;added?:boolean}]>){
  const current=readFileSync(file,'utf8'),restored=sourceBeforeCorrections207(file,current);
  assert.throws(()=>sourceBeforeCorrections207(file,current+'\nvoid 207;\n'),/CORRECTIONS207_ENTIRE_CURRENT_FILE_CHANGED|HANDOVER214_UNREVIEWED_SOURCE/u);
  if(pin.added)assert.equal(restored,null);else assert.equal(createHash('sha256').update(restored!).digest('hex'),pin.before);
 }
});
