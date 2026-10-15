import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {assertOutsideRepository,checkProject,connectionFromLink,holdBuildGuard,TARGET} from '../scripts/operations/frankfurt-owner-build.mjs';
import {executeInput} from '../scripts/operations/build-empty-supabase.mjs';

test('Frankfurt destination is exact and a different Postgres major fails closed',()=>{
 const fixture={...TARGET,status:'ACTIVE_HEALTHY',database:{postgres_engine:'17',version:'17.11.0.003'}};
 assert.equal(checkProject(fixture).postgresMajor,17);
 for(const key of ['id','name','region','status'] as const)assert.throws(()=>checkProject({...fixture,[key]:'wrong'}));
 assert.throws(()=>checkProject({...fixture,database:{postgres_engine:'18',version:'18.0'}}),/POSTGRES_MAJOR_MISMATCH/u);
});
test('repository root,children and same root are never valid Frankfurt workdirs',()=>{
 const root=path.resolve('.');
 assert.throws(()=>assertOutsideRepository(root,root));
 assert.throws(()=>assertOutsideRepository(path.join(root,'supabase'),root));
 assert.doesNotThrow(()=>assertOutsideRepository(path.resolve(root,'../external-fra'),root));
});
test('only a password-free Frankfurt session pooler connection is accepted',()=>{
 const uri='postgresql://postgres.'+TARGET.id+'@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
 assert.equal(connectionFromLink(uri)[5],'postgres.'+TARGET.id);
 for(const bad of [uri.replace(TARGET.id,'acjtabdqqnpwhdvbvnyw'),uri.replace('5432','6543'),
  uri.replace('eu-central-1','us-east-1'),uri.replace('@',':not-a-real-password@'),uri.replace('/postgres','/other')])
  assert.throws(()=>connectionFromLink(bad));
});
test('SQL child environment is transient,not global or argv',async()=>{
 const old=process.env.NAWASRAH_ENV_PROOF;
 const read=await executeInput({command:process.execPath,args:['-e','process.stdout.write(process.env.NAWASRAH_ENV_PROOF||"absent")'],
  env:{...process.env,NAWASRAH_ENV_PROOF:'child-only-fixture'}},'');
 assert.equal(read.code,0);assert.equal(read.stdout,'child-only-fixture');assert.equal(process.env.NAWASRAH_ENV_PROOF,old);
});
test('empty-build lock session remains alive across work and closes only when explicitly released',async()=>{
 const guard=await holdBuildGuard({command:process.execPath,args:['-e',
  'process.stdin.once("data",()=>process.stdout.write("FRA_GUARD_READY\\n"));process.stdin.on("end",()=>{});']},Buffer.from('guard fixture'));
 guard.assertHeld();await guard.close();assert.throws(()=>guard.assertHeld(),/BUILD_GUARD_LOST/u);
 await assert.rejects(()=>holdBuildGuard({command:process.execPath,args:['-e',
  'process.stderr.write("ERROR: EMPTY_PROJECT_REQUIRED");process.exitCode=1;']},Buffer.from('')),/EMPTY_PROJECT_REQUIRED/u);
 await assert.rejects(()=>holdBuildGuard({command:process.execPath,args:['-e','process.exitCode=1;']},Buffer.from('')),/EMPTY_TARGET_GUARD_FAILED/u);
});
test('dry preparation returns before prompt,link or remote SQL;official repair follows successful SQL',async()=>{
 const source=await readFile('scripts/operations/frankfurt-owner-build.mjs','utf8');
 assert.ok(source.indexOf("if(mode==='dry-run')")<source.indexOf('const password=await ownerPassword()'));
 assert.ok(source.indexOf('const password=await ownerPassword()')<source.indexOf("stage='external-link'"));
 assert.ok(source.indexOf("assert.equal(result.code,0,'MIGRATION_SQL_FAILURE:")<source.indexOf("['migration','repair','--linked'"));
 assert.match(source,/New-Object Security.SecureString/u);assert.match(source,/ReadKey\(\$true\)/u);assert.match(source,/ZeroFreeBSTR/u);
 assert.match(source,/delete childEnv.PGPASSWORD/u);assert.match(source,/delete childEnv.SUPABASE_DB_PASSWORD/u);
 assert.match(source,/process\.stdin\.isTTY/u);assert.doesNotMatch(source,/recoverySql|PGSERVICE|--password|--db-url|functions.*deploy/u);
 assert.match(source,/!file.startsWith\('supabase\/\.temp\/'\)/u);
 assert.match(source,/dry\.stdout\+dry\.stderr.*up to date/u);assert.match(source,/report.catalogExpectedHold=assertHeldCatalog\(reference.catalog/u);
 assert.ok(source.indexOf("stage='post138-notification-hold'")>source.indexOf('report.recorded.push'));
 assert.ok(source.indexOf("'restore-notifications.sql'")<source.indexOf('state:await transitionNotifications'));
 assert.match(source,/DB_FUNCTIONS_STALE/u);assert.match(source,/OLD_BACKUP_LINK_CHANGED/u);
 const legacy=await readFile('scripts/backup/preflight.mjs','utf8');assert.ok(legacy.includes("expectedProjectRef = 'acjtabdqqnpwhdvbvnyw'"));
});
