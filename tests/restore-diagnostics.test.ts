import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {restoreErrorFields,postgresDiagnostic,diagnosticError} from '../scripts/backup/postgres-diagnostic.mjs';
import {restoreToolError,sanitizedRestoreLog} from '../scripts/backup/restore-log.mjs';
import {platformPostInitSql,logicalRestoreDifferences} from '../scripts/testing/backup-restore-contract.mjs';
const secret='PRIVATE-customer-value-password-DO-NOT-PERSIST';
test('pg_restore error yields SQLSTATE,TOC identity,canonical ERROR and numeric exit without DETAIL or SQL',()=>{
 const stderr=`pg_restore: from TOC entry 221; 1255 555 FUNCTION public sample(text, integer) postgres\npg_restore: error: could not execute query: ERROR: 42501: must be owner of function sample\nDETAIL: Key (name)=(${secret})\nCommand was: INSERT INTO private VALUES('${secret}');`;
 const fields=restoreErrorFields(stderr);assert.deepEqual(fields.toc,{type:'FUNCTION',schema:'public',name:'sample'});assert.equal(fields.sqlstate,'42501');assert.equal(fields.restoreErrorCode,'PERMISSION');
 const error=restoreToolError({code:1,stderr,cmd:secret},{stage:'restore-complete-dump'}).diagnostic;
 const roundtrip=postgresDiagnostic(diagnosticError('STRICT_RESTORE',error));assert.equal(roundtrip.exitCode,1);assert.equal(roundtrip.tool,'pg_restore');assert.equal(roundtrip.sqlstate,'42501');assert.deepEqual(roundtrip.toc,fields.toc);
 for(const text of [JSON.stringify(error),JSON.stringify(roundtrip),JSON.stringify(sanitizedRestoreLog(stderr))]){assert.ok(!text.includes(secret));assert.ok(!text.includes('INSERT'));assert.ok(!text.includes('Key ('));}
});
test('server tail SQLSTATE is recovered and restore failures remain specific',()=>{
 const cases:Array<[string,string,string]>=[['extension "pg_net" is not available','MISSING_EXTENSION','0A000'],['role "postgres" does not exist','MISSING_ROLE','42704'],['schema "auth" does not exist','MISSING_SCHEMA','3F000'],['duplicate key value violates unique constraint','DUPLICATE_DATA','23505'],['unrecognized configuration parameter','INVALID_SETTING','42704'],['could not access file "$libdir/pg_net": No such file','MISSING_LIBRARY','58P01']];
 for(const [message,code,state]of cases){const stderr=`pg_restore: from TOC entry 9; 3079 88 EXTENSION - pg_net\npg_restore: error: ERROR: ${message}\nDETAIL: ${secret}`;
 const log=`[state=${state}] ERROR: ${message}\n[state=${state}] DETAIL: ${secret}\nSTATEMENT: SELECT '${secret}'`;
 const d=restoreToolError({code:1,stderr},{stage:'restore-complete-dump',serverLog:log}).diagnostic;assert.equal(d.restoreErrorCode,code);assert.equal(d.sqlstate,state);assert.equal(d.exitCode,1);assert.deepEqual(d.toc,{type:'EXTENSION',schema:null,name:'pg_net'});assert.ok(!JSON.stringify(d).includes(secret));assert.ok(!JSON.stringify(sanitizedRestoreLog(log)).includes(secret));}
});
test('untrusted diagnostic extras and unsupported TOC names never survive revalidation',()=>{
 const d=postgresDiagnostic({diagnostic:{category:'RESTORE_SQL_ERROR',toc:{type:secret,schema:secret,name:secret},restoreErrorCode:secret,restoreMessage:secret}});assert.ok(!JSON.stringify(d).includes(secret));
 const unknown=sanitizedRestoreLog(`ERROR: ${secret}\nDETAIL: ${secret}\nCONTEXT: COPY private, line1:${secret}`);assert.equal(unknown.events.length,1);assert.ok(!JSON.stringify(unknown).includes(secret));
});
test('captured Frankfurt214 net INVOKER/null profile restores exact source and comparison remains strict',async()=>{
 const profile=JSON.parse(await readFile('scripts/testing/fixtures/frankfurt214-restore-platform.json','utf8'));
 assert.equal(profile.extensions.length,7);assert.ok(profile.netFunctions.every((f:{configuration:null;securityDefiner:boolean})=>f.configuration===null&&!f.securityDefiner));
 const catalog={schemas:['graphql','graphql_public'].map(name=>({name,owner:'supabase_admin',acl:['supabase_admin=UC/supabase_admin','authenticated=U/supabase_admin']})),functions:profile.netFunctions.map((f:{identity:string;owner:string;configuration:null})=>({schema:'net',...f,definition:'CREATE FUNCTION ...'}))};
 const sql=platformPostInitSql(catalog);assert.match(sql,/SECURITY INVOKER/u);assert.match(sql,/RESET ALL/u);assert.doesNotMatch(sql,/SET search_path/u);
 const altered=structuredClone(catalog);altered.functions[0].configuration=['search_path=net'];assert.ok(logicalRestoreDifferences(catalog,altered).length);
 altered.functions[0].configuration=['search_path=public'];assert.throws(()=>platformPostInitSql(altered),/UNSUPPORTED/u);
});
