import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertReady223Catalog,quantity223Tables} from '../scripts/operations/optional-quantity223-catalog.mjs';
import {assert223SourceRowsPreserved} from '../scripts/operations/upgrade223-data.mjs';
import {assertOperationalHistory,operationalManifest} from '../scripts/operations/operational-schema.mjs';
import {reset223Arguments} from '../scripts/operations/frankfurt-owner-reset223.mjs';
import {upgrade223Arguments} from '../scripts/operations/frankfurt-owner-upgrade223.mjs';
import {sourceBeforeOptionalQuantity223,quantity223SourcePins} from '../scripts/audit/source-before-optional-quantity223.mjs';

const read=(file:string)=>readFileSync(file,'utf8');

test('223 catalog pins reject one byte, ACL, or new trigger on prior or counter objects',()=>{
 const {catalog}=JSON.parse(read('docs/operations/TABLE_ACCESS_AFTER_223.json'));
 assert.doesNotThrow(()=>assertReady223Catalog(catalog));
 for(const [schema,name] of [['public','lite3_set_counter223'],['public','lite1_pos2'],['sales_lite2','pos'],['sales_lite3','consume223']]){
  const modified=structuredClone(catalog);
  const row=modified.functions.find((r:{schema:string;identity:string})=>r.schema===schema&&r.identity.startsWith(name+'('));
  assert.ok(row);
  row.definition+=' ';
  assert.throws(()=>assertReady223Catalog(modified));
 }
 const acl=structuredClone(catalog);
 acl.tables.find((r:{schema:string;name:string})=>r.schema==='sales_lite3'&&r.name==='quantity_events').acl=['anon=r/postgres'];
 assert.throws(()=>assertReady223Catalog(acl));
 const trigger=structuredClone(catalog);
 trigger.triggers.find((r:{name:string})=>r.name==='optional_quantity_cancel223').enabled='D';
 assert.throws(()=>assertReady223Catalog(trigger));
});

test('223 upgrade preserves existing row hashes and requires three empty counter tables',()=>{
 const before={tables:{'public.orders':{rows:2,hash:'known'}}};
 const empty=Object.fromEntries(quantity223Tables.map(table=>['sales_lite3.'+table,{rows:0,hash:'d41d8cd98f00b204e9800998ecf8427e'}]));
 const after={tables:{...before.tables,...empty}};
 assert.doesNotThrow(()=>assert223SourceRowsPreserved(before,after));
 for(const key of Object.keys(empty)){
  const dirty=structuredClone(after);
  dirty.tables[key].rows=1;
  assert.throws(()=>assert223SourceRowsPreserved(before,dirty),/UPGRADE223_COUNTER_NOT_EMPTY/);
 }
 assert.throws(()=>assert223SourceRowsPreserved(before,{tables:{...after.tables,'public.orders':{rows:2,hash:'changed'}}}),/EXISTING_APPLICATION_ROWS_CHANGED/);
});

test('223 allows exact 222 archives and refuses reserved versions or wrong matching tool inputs',async()=>{
 const manifest=await operationalManifest();
 const versions=manifest.map(m=>m.name.slice(0,3));
 assert.equal(manifest.at(-1)?.name,'223_optional_sales_quantity.sql');
 assert.deepEqual(await assertOperationalHistory(versions),{ceiling:223,files:183});
 assert.deepEqual(await assertOperationalHistory(versions.slice(0,-1)),{ceiling:222,files:182});
 await assert.rejects(assertOperationalHistory([...versions.slice(0,-2),'221',...versions.slice(-2)]));
 assert.equal(reset223Arguments([]).mode,'plan');
 assert.throws(()=>reset223Arguments(['--reference','local-reference-through222-ready.json']));
 assert.throws(()=>upgrade223Arguments(['--apply']),/UPGRADE223_BEFORE_BACKUP_REQUIRED/);
 assert.throws(()=>upgrade223Arguments(['--verify-only']),/UPGRADE223_BACKUP_RESTORE_APPLY_REPORT_REQUIRED/);
});

test('historical 222 projection recognises reviewed counter changes and leaves unknown bytes visible',()=>{
 for(const file of ['src/features/pos/PosView.tsx','src/services/supabase/optionalQuantity.service.ts','supabase/migrations/223_optional_sales_quantity.sql']){
  const raw=read(file),pin=quantity223SourcePins[file];
  assert.ok(pin);
  assert.equal(sourceBeforeOptionalQuantity223(file,raw),pin.beforeText);
  const unknown=raw+'\nUNKNOWN_BYTE';
  assert.equal(sourceBeforeOptionalQuantity223(file,unknown),unknown);
 }
});
