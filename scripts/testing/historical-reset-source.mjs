// Test-only frozen source view. Never relax the owner reset's exact manifest guard.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {migrationManifest} from './maintenance-db-contract.mjs';

export async function stageHistoricalResetSource(root,reference){
 const counts={182:151,199:161,200:162,201:163,202:164,203:165,204:166,205:167,206:168,207:169,208:170,209:171,210:172,211:173},ceiling=reference.migrationCeiling;
 assert.ok(Object.hasOwn(counts,ceiling),'HISTORICAL_RESET_CEILING');
 const approved=(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=ceiling);
 assert.equal(approved.length,counts[ceiling],'HISTORICAL_RESET_FILE_COUNT');
 assert.deepEqual(approved,reference.manifest,'HISTORICAL_RESET_SOURCE_CHANGED');
 const sourceRoot=await mkdtemp(path.join(tmpdir(),'nawasrah-reset-source'+ceiling+'-'));
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
