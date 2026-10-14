import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {buildEmptyProjectInput,EMPTY_034_TABLES,FKS_034,ORIGINAL_034_SHA256,prepare034Sql,restore034Sql,executorFor,executeInput,SEED_SUPPLIERS_008} from '../scripts/operations/build-empty-supabase.mjs';
import {catalogDifference,schemaCatalogSql} from '../scripts/testing/schema-catalog.mjs';
const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1');
test('an early SQL child exit retains stderr and exit code instead of hiding them with EOF/EPIPE',async()=>{
 const result=await executeInput({command:process.execPath,args:['-e',"process.stderr.write('ERROR: synthetic SQL failure\\n');process.exitCode=3;"]},Buffer.alloc(8*1024**2));
 assert.equal(result.code,3);assert.match(result.stderr,/synthetic SQL failure/u);
});
test('empty builder retains all138 original byte buffers,including pinned034',async()=>{
 const {input,manifest}=await buildEmptyProjectInput(root);
 assert.equal(manifest.length,138);
 let cursor=0;
 for(const entry of manifest){const bytes=readFileSync(new URL('../supabase/migrations/'+entry.name,import.meta.url));
  const at=input.indexOf(bytes,cursor);assert.ok(at>=cursor,entry.name);cursor=at+bytes.length;}
 assert.equal(manifest[33].sha256,ORIGINAL_034_SHA256);
 assert.ok(input.includes(Buffer.from(prepare034Sql)));assert.ok(input.includes(Buffer.from(restore034Sql)));
});
test('034 guard covers all28 affected tables and snapshots/drops exactly four valid FKs',()=>{
 assert.equal(new Set(EMPTY_034_TABLES).size,28);assert.equal(FKS_034.length,4);
 assert.match(prepare034Sql,/count\(\*\).*ENV034_NOT_EMPTY/su);
 assert.match(prepare034Sql,/ACCESS EXCLUSIVE MODE/u);
 assert.equal((prepare034Sql.match(/DROP CONSTRAINT/gu)??[]).length,4);
 assert.match(prepare034Sql,/INVALID_CONSTRAINT_SNAPSHOT/u);
 assert.match(restore034Sql,/IS DISTINCT FROM/u);assert.match(restore034Sql,/validated/u);
});
test('executor refuses arbitrary Docker names,URL credentials and implicit external target',()=>{
 assert.throws(()=>executorFor(['--container','supabase_db_production']));
 assert.throws(()=>executorFor(['postgres://someone:password@real-host/database']));
 assert.throws(()=>executorFor(['--psql-empty-target']));
 assert.equal(executorFor(['--container','supabase_db_nawasrah-fixture-test']).command,'docker');
});
test('seed exception is exactly008 two full rows;post034 verifies only the original cleanup audit beforeFK restore',()=>{
 assert.equal(SEED_SUPPLIERS_008.length,2);
 const source=readFileSync(new URL('../supabase/migrations/008_purchase_orders.sql',import.meta.url),'utf8');
 for(const row of SEED_SUPPLIERS_008)for(const key of ['company_name','contact_person','phone','email','address','tax_number'] as const)assert.ok(source.includes("'"+row[key]+"'"));
 assert.match(prepare034Sql,/counted<>2/u);assert.match(prepare034Sql,/count\(DISTINCT company_name\)/u);
 assert.match(prepare034Sql,/to_jsonb\(s\)-ARRAY\['id','created_at','updated_at'\]/u);
 assert.match(restore034Sql,/count\(\*\) FROM public.audit_logs\)<>1/u);
 assert.match(restore034Sql,/expected\.details/u);assert.match(restore034Sql,/expected\.captured_at/u);
 assert.ok(restore034Sql.indexOf('ENV034_CLEANUP_AUDIT_MISMATCH')<restore034Sql.indexOf('ADD CONSTRAINT'));
});
test('catalog comparison detects table,FK,index,function and privilege changes independently',()=>{
 const before:Record<string,Array<Record<string,unknown>>>={tables:[{name:'x',acl:['postgres']}],constraints:[{name:'fk',validated:true}],indexes:[{name:'ix',valid:true}],functions:[{identity:'f()',acl:['owner']}]};
 assert.deepEqual(catalogDifference(before,structuredClone(before)),[]);
 for(const section of Object.keys(before)){
  const after=structuredClone(before);after[section][0].changed=true;
  assert.equal(catalogDifference(before,after).length,1);
 }
 assert.match(schemaCatalogSql,/BEGIN READ ONLY/u);assert.match(schemaCatalogSql,/defaultPrivileges/u);
});
test('bookkeeping follows each successful file,uses official local repair,and never registers seed',()=>{
 const source=readFileSync(new URL('../scripts/operations/build-empty-supabase.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf('if(execution.code!==0)break;')<source.indexOf("'migration','repair','--local'"));
 assert.ok(source.indexOf("'migration','repair','--local'")<source.indexOf('recorded.push(version)'));
 assert.match(source,/CLI workdir must match the isolated target/u);
 assert.match(source,/CLI_FILE_BYTES_MISMATCH/u);
 assert.doesNotMatch(source,/INSERT INTO supabase_migrations\.seed_files/u);
 assert.match(source,/seedHistoryStructureAdded=true/u);
});
