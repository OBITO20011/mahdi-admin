import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {stageHistoricalResetSource} from '../scripts/testing/historical-reset-source.mjs';
import {migrationManifest} from '../scripts/testing/maintenance-db-contract.mjs';
import {resetUnits} from '../scripts/operations/trial-reset-core.mjs';

for(const [ceiling,count] of [[182,151],[199,161],[200,162],[201,163],[202,164],[203,165],[204,166],[205,167],[206,168]])test(`historical reset rehearses exact${ceiling} bytes while live owner reset still rejects newer files`,async()=>{
 const root=process.cwd(),full=await migrationManifest(root);
 const manifest=full.filter(m=>Number(m.name.slice(0,3))<=ceiling);
 const reference={migrationCeiling:ceiling,manifest};
 assert.ok(full.some(m=>Number(m.name.slice(0,3))>ceiling));
 await assert.rejects(resetUnits(root,reference),/RESET_MANIFEST_CHANGED/u);
 const historical=await stageHistoricalResetSource(root,reference);
 try{
  assert.deepEqual(await migrationManifest(historical),manifest);
  for(const unit of manifest)assert.deepEqual(await readFile(path.join(historical,'supabase/migrations',unit.name)),await readFile(path.join(root,'supabase/migrations',unit.name)));
  assert.equal((await resetUnits(historical,reference)).length,count);
 }finally{await rm(historical,{recursive:true});}
});

test('historical source refuses changed,missing or wrong-ceiling reference before staging',async()=>{
 const root=process.cwd(),manifest=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=182);
 await assert.rejects(stageHistoricalResetSource(root,{migrationCeiling:195,manifest}),/HISTORICAL_RESET_CEILING/u);
 await assert.rejects(stageHistoricalResetSource(root,{migrationCeiling:209,manifest}),/HISTORICAL_RESET_CEILING/u);
 await assert.rejects(stageHistoricalResetSource(root,{migrationCeiling:182,manifest:manifest.slice(1)}),/HISTORICAL_RESET_SOURCE_CHANGED/u);
 await assert.rejects(stageHistoricalResetSource(root,{migrationCeiling:182,manifest:manifest.map((m,i)=>i===0?{...m,sha256:'0'.repeat(64)}:m)}),/HISTORICAL_RESET_SOURCE_CHANGED/u);
});
