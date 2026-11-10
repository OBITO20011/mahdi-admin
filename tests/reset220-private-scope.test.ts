import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {externalDependentsSql,assertExternalDependents,dropPublicSql,rowCountsSql,cleanSeedCounts} from '../scripts/operations/reset220-foundation.mjs';
import {publicFingerprintSql,attachGuardSql,removeGuardSql,lockAndCheckGuardSql} from '../scripts/operations/reset220-write-guard.mjs';
const read=(p:string)=>readFileSync(p,'utf8');
test('RESET220 drops exactly public business objects and the two reviewed lite schemas;dependency closure retains extension guards',()=>{
 assert.match(dropPublicSql,/DROP SCHEMA sales_lite2 CASCADE;DROP SCHEMA sales_lite1 CASCADE;/);
 assert.doesNotMatch(dropPublicSql,/DROP (?:SCHEMA|EXTENSION) (?:net|pg_net|cron|pg_cron|storage|auth|vault)/i);
 assert.match(externalDependentsSql,/deptype IN\('i','e'\)/);assert.match(externalDependentsSql,/nspname IN\('sales_lite1','sales_lite2'\)/);
 for(const row of [{class:'pg_class',schema:'other',description:'cross-schema dependent'},{class:'pg_extension',schema:null,description:'unexpected extension dependency'},{class:'pg_proc',schema:'net',description:'unexpected function dependency'}])assert.throws(()=>assertExternalDependents([row],220),/UNREVIEWED_EXTERNAL_DROP_DEPENDENT/);
});
test('private row counting and sticky write/lock fence cover all three application schemas',()=>{
 for(const sql of [rowCountsSql,publicFingerprintSql,attachGuardSql,removeGuardSql,lockAndCheckGuardSql])assert.match(sql,/\('public','sales_lite1','sales_lite2'\)/);
 assert.equal(cleanSeedCounts['sales_lite1.mode'],1);assert.match(read('scripts/operations/reset220-write-guard.mjs'),/RESET220_PRIVATE_MODE_SEED_CHANGED/);
 assert.match(read('scripts/operations/reset220-session.mjs'),/RESET220_IN_PROGRESS\.json/);
 assert.match(read('scripts/operations/reset220-private-state.mjs'),/reset220-private/);
});
test('actual220 generator rejects unknown219 source/output bytes in a separate file-only fixture',()=>{
 execFileSync(process.execPath,['scripts/testing/build-reset220-engine.mjs','--check'],{stdio:'pipe'});
 const dir=mkdtempSync(path.join(tmpdir(),'nawasrah-reset220-generator-'));
 const paths=['scripts/testing/build-reset220-engine.mjs','scripts/testing/maintenance-db-contract.mjs','docs/design/sales-only-phase1/frozen-source.json',...['trial-reset-core','reset214-write-guard','reset214-private-state','reset214-session','trial-reset214-core','reset220-foundation','reset220-write-guard','reset220-private-state','reset220-session','trial-reset220-core'].map(n=>'scripts/operations/'+n+'.mjs')];
 try{
  for(const file of paths){const target=path.join(dir,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,readFileSync(file));}
  const run=()=>spawnSync(process.execPath,[path.join(dir,'scripts/testing/build-reset220-engine.mjs'),'--check'],{cwd:dir,encoding:'utf8',windowsHide:true});
  assert.equal(run().status,0);const source='scripts/operations/trial-reset-core.mjs';writeFileSync(path.join(dir,source),read(source)+'\n--UNKNOWN219BYTE');let result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/FROZEN219_TOOL_SOURCE_DRIFT/);
  writeFileSync(path.join(dir,source),read(source));const output='scripts/operations/reset220-write-guard.mjs';writeFileSync(path.join(dir,output),read(output)+'\n//UNKNOWN220BYTE');result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/GENERATED_RESET220_DRIFT/);
 }finally{const relative=path.relative(path.resolve(tmpdir()),path.resolve(dir));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));rmSync(dir,{recursive:true,force:true});}
});
