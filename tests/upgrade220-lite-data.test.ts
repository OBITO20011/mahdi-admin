import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assert220SourceRowsPreserved} from '../scripts/operations/upgrade220-data.mjs';
import {futureMigrationViolations} from '../scripts/testing/maintenance-db-contract.mjs';
const md5=(s:string)=>createHash('md5').update(s).digest('hex');
const pins=JSON.parse(readFileSync('docs/design/sales-only-phase3/catalog220-pins.json','utf8'));
const reference={catalog:{tables:pins.privateObjects.tables}};
const before={tables:{'public.customer_payments':{rows:3,hash:'original-money-evidence'},'auth.users':{rows:1,hash:'same-owner'},'supabase_migrations.schema_migrations':{rows:180,hash:'old-history'}}};
const after=():{tables:Record<string,{rows:number;hash:string}>}=>({tables:{...structuredClone(before.tables),'supabase_migrations.schema_migrations':{rows:181,hash:'new-history'},...Object.fromEntries(reference.catalog.tables.map((t:{schema:string;name:string})=>[t.schema+'.'+t.name,t.schema+'.'+t.name==='sales_lite1.mode'?{rows:1,hash:md5('{"id": true, "full_accounting": true}')}:{rows:0,hash:md5('')}]))}});
test('220 adds only exact private seeds while preserving all business/Auth evidence',()=>{assert220SourceRowsPreserved(before,after(),reference);});
test('220 rejects old money/owner drift,missingprivate,nonemptyprivate,changedmode and unknown schema',()=>{
 for(const mutate of [(v:ReturnType<typeof after>)=>{v.tables['public.customer_payments'].hash='changed';},(v:ReturnType<typeof after>)=>{v.tables['auth.users'].hash='changed';},(v:ReturnType<typeof after>)=>{delete v.tables['sales_lite1.mode'];},(v:ReturnType<typeof after>)=>{v.tables['sales_lite2.sales'].rows=1;},(v:ReturnType<typeof after>)=>{v.tables['sales_lite1.mode'].hash=md5('false');},(v:ReturnType<typeof after>)=>{v.tables['other.private']={rows:0,hash:md5('')};}]){const value=after();mutate(value);assert.throws(()=>assert220SourceRowsPreserved(before,value,reference));}
});
test('220 migration hygiene exception is whole-file only;one byte and dynamic function DDL remain rejected',()=>{
 const sql=readFileSync('supabase/migrations/220_sales_only_operating_mode.sql','utf8');assert.deepEqual(futureMigrationViolations(sql),[]);
 assert.ok(futureMigrationViolations(sql+'\n--UNAPPROVED_BYTE').includes('FUNCTION_DEFINITION_INTROSPECTION_IN_MIGRATION'));
 assert.ok(futureMigrationViolations(sql+"\nDO $$BEGIN EXECUTE 'CREATE FUNCTION public.bad() RETURNS VOID LANGUAGE sql AS $x$ SELECT NULL $x$';END$$;").includes('DYNAMIC_FUNCTION_DDL'));
});
