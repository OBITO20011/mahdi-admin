import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backupSourceEvidenceSha256} from '../scripts/backup/complete-backup.mjs';
import {stageABaseline225,stageBReadOnlySql225,verifyStageB225,editableStageACatalog225,requiredEmptyStageA225,applicationTables225,stockAlertSnapshotSql225} from '../scripts/operations/two-stage225.mjs';
import {runTwoStage225,unwrapStageB225,unwrapStageAAlerts225} from '../scripts/operations/two-stage225-cli.mjs';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const empty={rows:0,hash:'d41d8cd98f00b204e9800998ecf8427e'};
const snapshot=JSON.parse(readFileSync(new URL('./fixtures/two-stage225-reference-tables.json',import.meta.url),'utf8')) as {source:{mainSha:string;referenceSha256:string};history:string[];catalog:{tables:{schema:string;name:string;kind:string}[]}};
const tableNames=snapshot.catalog.tables.filter(t=>['r','p'].includes(t.kind)).map(t=>t.schema+'.'+t.name).sort();
const history=snapshot.history;
function fixture(){
 const catalog=structuredClone(snapshot.catalog);
 const evidence={history,catalog,tables:Object.fromEntries(tableNames.map(name=>[name,{...empty}]))};
 const stockAlerts={full:{...empty},withoutLastUpdated:{...empty},rowHashes:{} as Record<string,string>};
 const backup={ok:true,projectRef:'kzevmysfydaslxcerogt',historyCeiling:225,historyFiles:185,sha256:'a'.repeat(64),sourceEvidenceSha256:backupSourceEvidenceSha256(evidence),finishedAt:'2026-11-19T10:00:00Z'};
 const baseline=stageABaseline225(evidence,backup,backup.sha256,stockAlerts);
 const observed={format:1,ceiling:225,capturedAt:'2026-11-24T19:00:00Z',history,catalog:evidence.catalog,modeOn:true,setupOpen:true,ordersClosed:true,positiveBalances:0,tables:structuredClone(evidence.tables),stockAlerts:structuredClone(stockAlerts),products:[{id:'test',sku:'NW-0001'}]};
 return {evidence,backup,baseline,observed,stockAlerts};
}

const alertRow={id:'00000000-0000-4000-8000-000000000001',product_id:'00000000-0000-4000-8000-000000000002',warehouse_id:'00000000-0000-4000-8000-000000000003',status:'active',severity:'out_of_stock',available_quantity:0,threshold_quantity:0,first_triggered_at:'2026-11-19T10:00:00.000001Z',last_updated_at:'2026-11-19T10:00:00.000001Z',resolved_at:null};
function alertProof(rows:Record<string,unknown>[]){
 const canonical=(row:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b,'en'))));
 const md5=(s:string)=>createHash('md5').update(s).digest('hex');
 const fingerprint=(items:Record<string,unknown>[])=>({rows:items.length,hash:md5(items.map(canonical).sort().join('\n'))});
 return {full:fingerprint(rows),withoutLastUpdated:fingerprint(rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='last_updated_at')))),rowHashes:Object.fromEntries(rows.map(row=>[String(row.id),md5(canonical(row))]))};
}
function alertFixture(rows:Record<string,unknown>[]=[alertRow]){
 const f=fixture();f.stockAlerts=alertProof(rows);f.evidence.tables['public.stock_alerts']=f.stockAlerts.full;
 f.backup.sourceEvidenceSha256=backupSourceEvidenceSha256(f.evidence);
 f.baseline=stageABaseline225(f.evidence,f.backup,f.backup.sha256,f.stockAlerts);
 f.observed.tables=structuredClone(f.evidence.tables);f.observed.stockAlerts=structuredClone(f.stockAlerts);return f;
}
function observeAlerts(f:ReturnType<typeof alertFixture>,rows:Record<string,unknown>[]){f.observed.stockAlerts=alertProof(rows);f.observed.tables['public.stock_alerts']=f.observed.stockAlerts.full;}

test('only last_updated_at may differ; the B report identifies the exact table and affected row count',()=>{
 const f=alertFixture();assert.deepEqual(verifyStageB225(f.baseline,f.observed).allowedTimestampDifferences,[]);
 observeAlerts(f,[{...alertRow,last_updated_at:'2026-11-24T10:00:00.000002Z'}]);
 assert.deepEqual(verifyStageB225(f.baseline,f.observed).allowedTimestampDifferences,[{table:'public.stock_alerts',field:'last_updated_at',affectedRows:1}]);
 f.observed.tables['public.supplier_receipts']={rows:1,hash:'b'.repeat(32)};
 assert.throws(()=>verifyStageB225(f.baseline,f.observed),/OPERATIONAL_DATA_CHANGED:public.supplier_receipts/u);
 const rows=[alertRow,{...alertRow,id:'00000000-0000-4000-8000-000000000004'}],g=alertFixture(rows);
 observeAlerts(g,rows.map(r=>({...r,last_updated_at:'2026-11-25T10:00:00Z'})));
 assert.equal(verifyStageB225(g.baseline,g.observed).allowedTimestampDifferences[0].affectedRows,2);
});
for(const [field,value]of Object.entries({id:'00000000-0000-4000-8000-000000000009',product_id:'00000000-0000-4000-8000-000000000009',warehouse_id:'00000000-0000-4000-8000-000000000009',status:'resolved',severity:'low_stock',available_quantity:1,threshold_quantity:1,first_triggered_at:'2026-11-19T10:00:00.000002Z',resolved_at:'2026-11-24T10:00:00Z'})){
 test('timestamp allowance refuses any other stock_alert field: '+field,()=>{const f=alertFixture();observeAlerts(f,[{...alertRow,[field]:value}]);assert.throws(()=>verifyStageB225(f.baseline,f.observed),/OPERATIONAL_DATA_CHANGED:public.stock_alerts/u);});
}
test('alert insertion,deletion,unbound A snapshot and inconsistent per-row evidence all fail closed',()=>{
 for(const rows of [[],[alertRow,{...alertRow,id:'00000000-0000-4000-8000-000000000004'}]]){const f=alertFixture();observeAlerts(f,rows);assert.throws(()=>verifyStageB225(f.baseline,f.observed),/OPERATIONAL_DATA_CHANGED:public.stock_alerts/u);}
 const f=alertFixture(),bad=structuredClone(f.stockAlerts);bad.full.hash='f'.repeat(32);assert.throws(()=>stageABaseline225(f.evidence,f.backup,f.backup.sha256,bad),/ALERT_ARCHIVE_MISMATCH/u);
 const g=alertFixture();g.observed.stockAlerts.rowHashes[alertRow.id]='f'.repeat(32);assert.throws(()=>verifyStageB225(g.baseline,g.observed),/ALERT_ROW_EVIDENCE_MISMATCH/u);
 const h=alertFixture();h.observed.stockAlerts.full.hash='f'.repeat(32);assert.throws(()=>verifyStageB225(h.baseline,h.observed),/ALERT_OBSERVED_MISMATCH/u);
 const i=alertFixture();delete i.observed.stockAlerts.rowHashes[alertRow.id];assert.throws(()=>verifyStageB225(i.baseline,i.observed),/ALERT_ROW_COUNT/u);
});
test('stock alert query excludes exactly the approved timestamp and preserves full row evidence and C sorting',()=>{
 const sql=stockAlertSnapshotSql225();assert.ok(sql.startsWith('SELECT jsonb_build_object('));assert.ok(sql.endsWith('FROM public.stock_alerts t'));
 assert.deepEqual([...sql.matchAll(/to_jsonb\(t\)-'([^']+)'/gu)].map(m=>m[1]),['last_updated_at','last_updated_at']);
 assert.ok(sql.includes('md5(to_jsonb(t)::text) ORDER BY id'));assert.ok(sql.includes('COLLATE "C"'));
 const e=fixture().stockAlerts;assert.deepEqual(unwrapStageAAlerts225([{stage_a_stock_alert_snapshot:e}]),e);assert.throws(()=>unwrapStageAAlerts225([{stage_a_stock_alert_snapshot:e,extra:true}]),/RESULT_COLUMN/u);
});

test('every configured table exists in the real225 reference; unknown,retired or missing physical identities are rejected',()=>{
 assert.equal(snapshot.source.mainSha,'3fda5f90d6fe380bcff677f494476bc9a6a6ab69');
 assert.equal(snapshot.source.referenceSha256,'dd71179daa33f981487a3ce9398d6a895be0d3d1d22234f20ee83dfbe989ae58');
 assert.equal(history.length,185);assert.equal(history.at(-1),'225');
 const names=new Set(tableNames);
 for(const name of [...requiredEmptyStageA225,...editableStageACatalog225])assert.ok(names.has(name),name);
 assert.equal(names.has('public.supplier_returns'),false);
 assert.deepEqual(applicationTables225(snapshot.catalog),tableNames);
 for(const name of ['public.supplier_replacement_cases','public.supplier_replacement_events'])assert.ok(requiredEmptyStageA225.includes(name));
 const a=fixture();a.evidence.catalog.tables=a.evidence.catalog.tables.filter(t=>t.schema+'.'+t.name!=='public.supplier_replacement_cases');a.backup.sourceEvidenceSha256=backupSourceEvidenceSha256(a.evidence);
 assert.throws(()=>stageABaseline225(a.evidence,a.backup,a.backup.sha256,a.stockAlerts),/REQUIRED_TABLE_MISSING:public.supplier_replacement_cases/u);
 for(const name of ['public.supplier_returns','public.imaginary_operation']){
  const b=fixture();b.evidence.tables[name]={...empty};b.backup.sourceEvidenceSha256=backupSourceEvidenceSha256(b.evidence);
  assert.throws(()=>stageABaseline225(b.evidence,b.backup,b.backup.sha256,b.stockAlerts),/TABLE_SCOPE_CHANGED/u);
 }
 const c=fixture();delete c.evidence.tables['public.inventory_movements'];c.backup.sourceEvidenceSha256=backupSourceEvidenceSha256(c.evidence);
 assert.throws(()=>stageABaseline225(c.evidence,c.backup,c.backup.sha256,c.stockAlerts),/TABLE_SCOPE_CHANGED/u);
});
test('days between phases do not expire the baseline; all non-catalog tables remain exact',()=>{
 const f=fixture();for(const name of editableStageACatalog225)f.observed.tables[name]={rows:5,hash:'b'.repeat(32)};
 const r=verifyStageB225(f.baseline,f.observed);assert.equal(r.ok,true);assert.equal(r.readOnly,true);assert.equal(r.checkedTables,tableNames.length-editableStageACatalog225.length);
});
for(const name of ['public.orders','public.order_items','public.supplier_receipts','public.purchase_orders','public.purchase_receipts',
 'public.supplier_financial_invoice_identities','public.sales_returns','public.supplier_replacement_cases','public.supplier_replacement_events','public.sales_return_events',
 'public.inventory_movements','public.inventory_opening_sessions','public.cash_shifts','sales_lite1.returns','sales_lite3.quantity_events']){
 test('pre-B check refuses an operation since A: '+name,()=>{
  const f=fixture();f.observed.tables[name]={rows:1,hash:'b'.repeat(32)};
  assert.throws(()=>verifyStageB225(f.baseline,f.observed),error=>error instanceof Error&&error.message.includes('STAGE_B_OPERATIONAL_DATA_CHANGED:'+name));
 });
}
test('same-count update/deletion, missing table and schema drift fail closed',()=>{
 const a=fixture();a.observed.tables['public.orders'].hash='b'.repeat(32);assert.throws(()=>verifyStageB225(a.baseline,a.observed),/OPERATIONAL_DATA_CHANGED/u);
 const b=fixture();delete b.observed.tables['public.inventory_movements'];assert.throws(()=>verifyStageB225(b.baseline,b.observed),/TABLE_SCOPE_CHANGED/u);
 const c=fixture();c.observed.catalog.tables[0].name='unexpected';assert.throws(()=>verifyStageB225(c.baseline,c.observed),/CATALOG_CHANGED/u);
});
test('OFF, finished setup, open orders and nonzero/reserved stock all refuse B',()=>{
 for(const [key,value]of [['modeOn',false],['setupOpen',false],['ordersClosed',false],['positiveBalances',1]]as const){
  const f=fixture();Object.assign(f.observed,{[key]:value});assert.throws(()=>verifyStageB225(f.baseline,f.observed),/STAGE_B_/u);
 }
});
test('baseline must match the official backup hash/evidence and contain no initial transactions',()=>{
 const f=fixture();assert.throws(()=>stageABaseline225(f.evidence,f.backup,'b'.repeat(64),f.stockAlerts),/ARCHIVE_SHA/u);
 f.evidence.tables['public.products'].rows=1;assert.throws(()=>stageABaseline225(f.evidence,f.backup,f.backup.sha256,f.stockAlerts),/BACKUP_EVIDENCE_MISMATCH/u);
 const g=fixture();g.evidence.tables['public.orders'].rows=1;g.backup.sourceEvidenceSha256=backupSourceEvidenceSha256(g.evidence);
 assert.throws(()=>stageABaseline225(g.evidence,g.backup,g.backup.sha256,g.stockAlerts),/ALREADY_HAS_OPERATIONS:public.orders/u);
});
test('generated query is SELECT-only and uses only exact approved table identities',()=>{
 const f=fixture(),sql=stageBReadOnlySql225(f.baseline);
 assert.ok(sql.startsWith("SELECT CASE WHEN set_config('search_path','public,pg_temp',true)='public,pg_temp' THEN jsonb_build_object("));
 assert.doesNotMatch(sql,/SET LOCAL|BEGIN READ ONLY|ROLLBACK/u);assert.ok(sql.endsWith(' END'));
 assert.ok(sql.includes('COLLATE "C"'));assert.ok(sql.includes('finished_at IS NULL'));assert.ok(sql.includes('NOT orders_enabled'));
 const bad=structuredClone(f.baseline);bad.applicationTables.push('public.orders; DROP TABLE public.products');assert.throws(()=>stageBReadOnlySql225(bad),/TABLE_NAMES_INVALID/u);
});
test('SQL Editor result has exactly one named JSON column; unrelated envelopes are refused',()=>{
 const f=fixture();assert.deepEqual(unwrapStageB225([{stage_b_snapshot:f.observed}]),f.observed);
 assert.throws(()=>unwrapStageB225([{stage_b_snapshot:f.observed,extra:'x'}]),/RESULT_COLUMN/u);
 assert.throws(()=>unwrapStageB225([]),/SINGLE_RESULT/u);
});
test('offline CLI binds archive/baseline bytes and refuses drift without producing a success report',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'nawasrah-stage225-')),f=fixture(),archive=path.join(dir,'A.nwb');
 await writeFile(archive,'local archive fixture');f.backup.sha256=hash('local archive fixture');
 const evidence=path.join(dir,'evidence.json'),backup=path.join(dir,'backup.json');await writeFile(evidence,JSON.stringify(f.evidence));await writeFile(backup,JSON.stringify(f.backup));
 const alerts=path.join(dir,'alerts.json');await writeFile(alerts,JSON.stringify([{stage_a_stock_alert_snapshot:f.stockAlerts}]));
 const alertQuery=path.join(dir,'alert-query');await runTwoStage225(['--mode','alert-query','--output',alertQuery]);const alertSql=await readFile(path.join(alertQuery,'STAGE_A_STOCK_ALERT_READ_ONLY.sql'),'utf8');assert.ok(alertSql.startsWith('SELECT (SELECT jsonb_build_object('));assert.ok(alertSql.endsWith('FROM public.stock_alerts t) AS stage_a_stock_alert_snapshot;\n'));
 const first=path.join(dir,'prepare');await runTwoStage225(['--mode','prepare','--source-evidence',evidence,'--backup-report',backup,'--archive',archive,'--stock-alerts',alerts,'--output',first]);
 const base=path.join(first,'stage-a-baseline.json'),baseBytes=await readFile(base),baseHash=hash(baseBytes);
 const query=path.join(dir,'query');await runTwoStage225(['--mode','query','--baseline',base,'--baseline-sha256',baseHash,'--output',query]);
 const sql=await readFile(path.join(query,'STAGE_B_READ_ONLY.sql'),'utf8');assert.match(sql,/AS stage_b_snapshot;\n$/u);assert.doesNotMatch(sql,/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|DO)\b/gimu);
 const observed=path.join(dir,'observed.json');await writeFile(observed,JSON.stringify([{stage_b_snapshot:f.observed}]));
 const verified=path.join(dir,'verified');await runTwoStage225(['--mode','verify','--baseline',base,'--baseline-sha256',baseHash,'--observed',observed,'--output',verified]);assert.deepEqual(await readdir(verified),['stage-b-verified.json']);
 f.observed.tables['public.supplier_receipts']={rows:1,hash:'b'.repeat(32)};await writeFile(observed,JSON.stringify(f.observed));
 await assert.rejects(()=>runTwoStage225(['--mode','verify','--baseline',base,'--baseline-sha256',baseHash,'--observed',observed,'--output',path.join(dir,'refused')]),/OPERATIONAL_DATA_CHANGED/u);
 await assert.rejects(()=>runTwoStage225(['--mode','query','--baseline',base,'--baseline-sha256','b'.repeat(64),'--output',path.join(dir,'bad-sha')]),/BASELINE_SHA/u);
});
