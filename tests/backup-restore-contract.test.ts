import assert from 'node:assert/strict';
import {test} from 'node:test';
import {logicalRestoreDifferences,platformPostInitSql,applicationFingerprintSql} from '../scripts/testing/backup-restore-contract.mjs';
const ownerAcl=(value:string[]|null)=>value;
const table={schema:'public',name:'evidence',kind:'r',owner:'postgres',acl:ownerAcl(['postgres=arwdDxtm/postgres']),rls:true,
 columns:[{name:'id',number:1,type:'uuid',acl:null},{name:'amount',number:3,type:'bigint',acl:null}]};
test('logical restore accepts compacted dropped-column holes and equivalent owner-only default ACL,not grants or missing columns',()=>{
 const source={tables:[structuredClone(table)]},restored=structuredClone(source);restored.tables[0]!.acl=null;restored.tables[0]!.columns[1]!.number=2;
 assert.deepEqual(logicalRestoreDifferences(source,restored),[]);
 for(const grant of ['anon=r/postgres','authenticated=r/postgres','service_role=r/postgres','=r/postgres','postgres=r/another_role']){
  const changed=structuredClone(source),acl=changed.tables[0]!.acl;assert.ok(acl);acl.push(grant);assert.ok(logicalRestoreDifferences(source,changed).length);
 }
 const changed=structuredClone(source);changed.tables[0]!.columns.pop();assert.ok(logicalRestoreDifferences(source,changed).length);
 for(const property of ['owner','rls']){const changed=structuredClone(source);Reflect.set(changed.tables[0]!,property,property==='owner'?'another_role':false);assert.ok(logicalRestoreDifferences(source,changed).length);}
});
test('only inherited leaf partition PK representation is normalized;CHECK,definitions,validation and parent links remain strict',()=>{
 const source={tables:[{...table,schema:'realtime',name:'messages_2026_10_16',partition:'FOR VALUES FROM (...)',parents:[{schema:'realtime',name:'messages'}]}],
  constraints:[{schema:'realtime',table:'messages_2026_10_16',name:'messages_2026_10_16_pkey',type:'p',local:false,inheritanceCount:1,noInherit:false,validated:true,definition:'PRIMARY KEY (id)'}]};
 const restored=structuredClone(source);restored.constraints[0]!.noInherit=true;assert.deepEqual(logicalRestoreDifferences(source,restored),[]);
 for(const property of ['validated','definition','inheritanceCount']){const changed=structuredClone(source);Reflect.set(changed.constraints[0]!,property,property==='validated'?false:property==='definition'?'PRIMARY KEY (amount)':0);assert.ok(logicalRestoreDifferences(source,changed).length);}
 const check=structuredClone(source);check.constraints[0]!.type='c';const changed=structuredClone(check);changed.constraints[0]!.noInherit=true;assert.ok(logicalRestoreDifferences(check,changed).length);
 const parent=structuredClone(source);parent.tables[0]!.parents=[];const parentChanged=structuredClone(parent);parentChanged.constraints[0]!.noInherit=true;assert.ok(logicalRestoreDifferences(parent,parentChanged).length);
});
test('platform post-init restore retains every original schema grant and the two exact net search paths',()=>{
 const catalog={schemas:['graphql','graphql_public'].map(name=>({name,owner:'supabase_admin',acl:['supabase_admin=UC/supabase_admin','postgres=U*/supabase_admin','authenticated=U/supabase_admin']})),
 functions:['http_get','http_post'].map(name=>({schema:'net',identity:name+'()',owner:'supabase_admin',configuration:['search_path=net'],definition:'CREATE FUNCTION ...\n SECURITY DEFINER\n...'}))};
 const sql=platformPostInitSql(catalog);assert.match(sql,/TO "postgres" WITH GRANT OPTION/u);assert.match(sql,/TO "authenticated"/u);
 assert.match(sql,/ALTER FUNCTION net.http_get\(text,jsonb,jsonb,integer\) SET search_path TO net/u);
 assert.match(sql,/ALTER FUNCTION net.http_get\(text,jsonb,jsonb,integer\) SECURITY DEFINER/u);
 assert.match(sql,/ALTER FUNCTION net.http_post\(text,jsonb,jsonb,jsonb,integer\) SECURITY DEFINER/u);
 const changed=structuredClone(catalog);changed.functions[0]!.configuration=['search_path=public'];assert.throws(()=>platformPostInitSql(changed));
 const invoker=structuredClone(catalog);invoker.functions[0]!.definition='CREATE FUNCTION ...';assert.throws(()=>platformPostInitSql(invoker),/RESTORE_NET_SOURCE_SECURITY/u);
 assert.match(applicationFingerprintSql,/BEGIN READ ONLY/u);assert.match(applicationFingerprintSql,/pg_tables WHERE schemaname='public'/u);assert.match(applicationFingerprintSql,/string_agg/u);assert.match(applicationFingerprintSql,/pg_sequences/u);
});

test('logical restore never ignores function body,owner,security or search_path changes',()=>{
 const source={functions:[{schema:'public',identity:'read_money()',owner:'postgres',acl:['postgres=X/postgres'],
  configuration:['search_path=public, pg_temp'],definition:'CREATE FUNCTION read_money() SECURITY DEFINER RETURNS bigint ...'}]};
 for(const [key,value] of [['owner','another_role'],['configuration',['search_path=public']],['definition','CREATE FUNCTION read_money() SECURITY INVOKER RETURNS bigint ...']]){
  const changed=structuredClone(source);Reflect.set(changed.functions[0]!,String(key),value);assert.ok(logicalRestoreDifferences(source,changed).length);
 }
});
