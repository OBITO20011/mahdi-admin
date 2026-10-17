// Test-only frozen source view. Never relax the owner reset's exact manifest guard.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {migrationManifest} from './maintenance-db-contract.mjs';

export async function stageHistoricalResetSource(root,reference){
 assert.equal(reference.migrationCeiling,182,'HISTORICAL_RESET_CEILING');
 const approved=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=182);
 assert.equal(approved.length,151,'HISTORICAL_RESET_FILE_COUNT');
 assert.deepEqual(approved,reference.manifest,'HISTORICAL_RESET_SOURCE_CHANGED');
 const sourceRoot=await mkdtemp(path.join(tmpdir(),'nawasrah-reset-source182-'));
 const destination=path.join(sourceRoot,'supabase/migrations');
 await mkdir(destination,{recursive:true});
 for(const unit of approved){
  const source=path.join(root,'supabase/migrations',unit.name),target=path.join(destination,unit.name);
  await copyFile(source,target);
  assert.deepEqual(await readFile(target),await readFile(source),'HISTORICAL_RESET_COPY_BYTES:'+unit.name);
 }
 assert.deepEqual(await migrationManifest(sourceRoot),reference.manifest,'HISTORICAL_RESET_COPY_MANIFEST');
 return sourceRoot;
}
