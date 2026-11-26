// Offline comparison and SELECT-only query generation. No connection or database writer.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {backupSourceEvidenceSha256} from '../backup/complete-backup.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {TARGET} from './frankfurt-owner-build.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const qi=value=>'"'+String(value).replaceAll('"','""')+'"';
const hash=/^[a-f0-9]{64}$/u;
const historyFiles=Object.freeze({225:185,226:186});
function assertCutoverHistory(history,ceiling,code){
 assert.ok(Object.hasOwn(historyFiles,ceiling)&&Array.isArray(history)&&history.length===historyFiles[ceiling]
  &&history.at(-1)===String(ceiling)&&!history.includes('221')
  &&history.every((version,i)=>/^\d{3}$/u.test(version)&&(!i||version>history[i-1])),code);
}
export const editableStageACatalog225=Object.freeze([
 'public.products','public.categories','public.units','public.brands',
 'public.product_sale_pricing_state225','public.product_cost_corrections','public.audit_logs',
]);
export const requiredEmptyStageA225=Object.freeze(['public.orders','public.order_items','public.supplier_receipts',
 'public.purchase_orders','public.inventory_movements','public.inventory_opening_sessions',
 'public.sales_returns','public.supplier_replacement_cases','public.supplier_replacement_events','public.cash_shifts']);
const application=name=>/^(?:public|sales_lite[123])\.[a-z_][a-z0-9_]*$/u.test(name);
const validFingerprint=value=>value&&Number.isSafeInteger(value.rows)&&value.rows>=0&&/^[a-f0-9]{32}$/u.test(value.hash);
const alertTable='public.stock_alerts';
const rowId=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

function assertAlertSnapshot(value){
 assert.ok(value&&typeof value==='object','STAGE_A_ALERT_SNAPSHOT_REQUIRED');
 assert.deepEqual(Object.keys(value).sort(),['full','rowHashes','withoutLastUpdated'],'STAGE_A_ALERT_SNAPSHOT_SHAPE');
 assert.ok(validFingerprint(value.full)&&validFingerprint(value.withoutLastUpdated),'STAGE_A_ALERT_FINGERPRINT_INVALID');
 for(const fingerprint of [value.full,value.withoutLastUpdated])assert.deepEqual(Object.keys(fingerprint).sort(),['hash','rows'],'STAGE_A_ALERT_FINGERPRINT_SHAPE');
 assert.equal(value.full.rows,value.withoutLastUpdated.rows,'STAGE_A_ALERT_ROW_COUNT');
 assert.ok(value.rowHashes&&typeof value.rowHashes==='object'&&!Array.isArray(value.rowHashes),'STAGE_A_ALERT_ROW_EVIDENCE');
 assert.equal(Object.keys(value.rowHashes).length,value.full.rows,'STAGE_A_ALERT_ROW_COUNT');
 for(const[id,digest]of Object.entries(value.rowHashes))assert.ok(rowId.test(id)&&/^[a-f0-9]{32}$/u.test(digest),'STAGE_A_ALERT_ROW_EVIDENCE');
 return value;
}

// Same full-row fingerprint as the official backup. The second excludes just
// one derived timestamp. Per-row hashes (no payload) support an exact affected
// row count in B; both aggregates and the row map share one SELECT snapshot.
export function stockAlertSnapshotSql225(){
 return `SELECT jsonb_build_object(
 'full',jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''))),
 'withoutLastUpdated',jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg((to_jsonb(t)-'last_updated_at')::text,E'\\n' ORDER BY (to_jsonb(t)-'last_updated_at')::text COLLATE "C"),''))),
 'rowHashes',coalesce(jsonb_object_agg(id::text,md5(to_jsonb(t)::text) ORDER BY id),'{}'::jsonb)) FROM public.stock_alerts t`;
}

// Protect every physical application table derived from the archive catalog.
// Only the seven explicit catalog/cost/audit exceptions above may change.
export function applicationTables225(catalog){
 assert.ok(Array.isArray(catalog?.tables),'STAGE_A_CATALOG_TABLES_REQUIRED');
 const names=catalog.tables.filter(t=>['r','p'].includes(t.kind)&&application(t.schema+'.'+t.name)).map(t=>t.schema+'.'+t.name).sort();
 assert.deepEqual(names,[...new Set(names)],'STAGE_A_CATALOG_TABLE_DUPLICATE');
 for(const name of [...requiredEmptyStageA225,...editableStageACatalog225])assert.ok(names.includes(name),'STAGE_A_REQUIRED_TABLE_MISSING:'+name);
 return names;
}

/** The report and evidence originate in the official complete backup/verify path. */
export function stageABaseline225(evidence,backup,archiveSha,stockAlerts){
 assert.equal(backup.ok,true,'STAGE_A_BACKUP_NOT_COMPLETE');
 assert.equal(backup.projectRef,TARGET.id,'STAGE_A_BACKUP_PROJECT');
 const ceiling=backup.historyCeiling;
 assert.ok(Object.hasOwn(historyFiles,ceiling),'STAGE_A_BACKUP_CEILING');
 assert.equal(backup.historyFiles,historyFiles[ceiling],'STAGE_A_BACKUP_HISTORY');
 assert.ok(hash.test(archiveSha)&&archiveSha===backup.sha256,'STAGE_A_ARCHIVE_SHA_MISMATCH');
 assert.equal(backupSourceEvidenceSha256(evidence),backup.sourceEvidenceSha256,'STAGE_A_BACKUP_EVIDENCE_MISMATCH');
 assertCutoverHistory(evidence.history,ceiling,'STAGE_A_HISTORY');
 const all=applicationTables225(evidence.catalog);
 assert.deepEqual(Object.keys(evidence.tables).filter(application).sort(),all,'STAGE_A_TABLE_SCOPE_CHANGED');
 for(const name of all)assert.ok(validFingerprint(evidence.tables[name]),'STAGE_A_FINGERPRINT_INVALID:'+name);
 for(const name of requiredEmptyStageA225)assert.equal(evidence.tables[name].rows,0,'STAGE_A_ALREADY_HAS_OPERATIONS:'+name);
 const tables=Object.fromEntries(all.filter(name=>!editableStageACatalog225.includes(name)).map(name=>[name,evidence.tables[name]]));
 assertAlertSnapshot(stockAlerts);
 assert.deepEqual(stockAlerts.full,tables[alertTable],'STAGE_A_ALERT_ARCHIVE_MISMATCH');
 return {format:1,ceiling,projectRef:TARGET.id,archiveSha256:archiveSha,backupFinishedAt:backup.finishedAt,
  sourceEvidenceSha256:backup.sourceEvidenceSha256,history:evidence.history,
  applicationTables:all,tables,catalogSha256:sha(JSON.stringify(evidence.catalog)),
  editableCatalog:[...editableStageACatalog225],stockAlerts:structuredClone(stockAlerts),readOnly:true};
}

export function assertStageABaseline225(baseline){
 assert.equal(baseline.format,1,'STAGE_B_BASELINE_FORMAT');
 assertCutoverHistory(baseline.history,baseline.ceiling,'STAGE_B_BASELINE_HISTORY');
 assert.equal(baseline.projectRef,TARGET.id,'STAGE_B_BASELINE_PROJECT');
 assert.ok(hash.test(baseline.archiveSha256)&&hash.test(baseline.sourceEvidenceSha256),'STAGE_B_BASELINE_HASH');
 assert.deepEqual(baseline.editableCatalog,[...editableStageACatalog225],'STAGE_B_EDITABLE_SCOPE_CHANGED');
 assert.ok(Array.isArray(baseline.applicationTables)&&baseline.applicationTables.every(application),'STAGE_B_TABLE_NAMES_INVALID');
 assert.deepEqual(baseline.applicationTables,[...new Set(baseline.applicationTables)].sort(),'STAGE_B_TABLE_NAMES_INVALID');
 assert.deepEqual(Object.keys(baseline.tables).sort(),baseline.applicationTables.filter(name=>!editableStageACatalog225.includes(name)),'STAGE_B_TABLE_SCOPE_CHANGED');
 for(const name of requiredEmptyStageA225)assert.equal(baseline.tables[name]?.rows,0,'STAGE_B_BASELINE_HAS_OPERATIONS:'+name);
 for(const value of Object.values(baseline.tables))assert.ok(validFingerprint(value),'STAGE_B_BASELINE_FINGERPRINT_INVALID');
 assertAlertSnapshot(baseline.stockAlerts);
 assert.deepEqual(baseline.stockAlerts.full,baseline.tables[alertTable],'STAGE_A_ALERT_ARCHIVE_MISMATCH');
 return baseline;
}

// Same exact row/hash expression as complete-backup.captureEvidence. One SELECT
// in the caller's READ ONLY transaction; not a new RPC/function/migration.
export function stageBReadOnlySql225(baseline){
 assertStageABaseline225(baseline);
 const rows=baseline.applicationTables.map(name=>{
  const [schema,table]=name.split('.');
  return `SELECT ${q(name)} AS name,jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''))) AS fingerprint FROM ${qi(schema)}.${qi(table)} t`;
 }).join('\nUNION ALL\n');
 const catalogPrefix='BEGIN READ ONLY;SET LOCAL search_path=public,pg_temp;';
 assert.ok(schemaCatalogSql.startsWith(catalogPrefix),'STAGE_B_CATALOG_QUERY_PREFIX_CHANGED');
 const catalogQuery=schemaCatalogSql.slice(catalogPrefix.length).replace(/ROLLBACK;\s*$/u,'').trim().replace(/;$/u,'');
 // Match the official catalog's deparsing context. This changes only the
 // current transaction's search_path, including inside BEGIN READ ONLY;
 // CASE evaluates it before the catalog branch. No stored state is written.
 return `SELECT CASE WHEN set_config('search_path','public,pg_temp',true)='public,pg_temp' THEN jsonb_build_object('format',1,'ceiling',${baseline.ceiling},'capturedAt',clock_timestamp(),
 'catalog',(${catalogQuery}),
 'history',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
 'modeOn',(SELECT count(*)=1 AND bool_and(full_accounting) FROM sales_lite1.mode),
 'setupOpen',(SELECT count(*)=1 AND bool_and(finished_at IS NULL) FROM public.go_live_setup_state),
 'ordersClosed',(SELECT count(*)=1 AND bool_and(NOT orders_enabled) FROM public.storefront_settings),
 'positiveBalances',(SELECT count(*) FROM public.inventory_balances WHERE on_hand_quantity<>0 OR reserved_quantity<>0),
 'tables',(SELECT jsonb_object_agg(name,fingerprint ORDER BY name) FROM (${rows}) fingerprints),
 'stockAlerts',(${stockAlertSnapshotSql225()}),
 'products',(SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'sku',p.sku,'name',p.name_ar,'active',p.is_active,'master',p.is_flavor_master,
  'unitCode',u.code,'unitName',u.name_ar,'purchaseUnitCode',pu.code,
  'unitsPerPackage',p.units_per_purchase_unit,'costPriceInMinorUnits',p.cost_price_in_minor_units,
  'wacExact',p.wac_cost_in_minor_units_exact::text,'updatedAt',p.updated_at
 ) ORDER BY p.sku,p.id),'[]') FROM public.products p
 LEFT JOIN public.units u ON u.id=p.unit_id LEFT JOIN public.units pu ON pu.id=p.purchase_unit_id)) END`;
}

export function verifyStageB225(baseline,observed){
 assertStageABaseline225(baseline);
 assert.equal(observed.format,1,'STAGE_B_OBSERVED_FORMAT');assert.equal(observed.ceiling,baseline.ceiling,'STAGE_B_OBSERVED_CEILING');
 assert.deepEqual(observed.history,baseline.history,'STAGE_B_HISTORY_CHANGED');
 assert.equal(sha(JSON.stringify(observed.catalog)),baseline.catalogSha256,'STAGE_B_CATALOG_CHANGED');
 assert.equal(observed.modeOn,true,'STAGE_B_MODE_MUST_BE_ON');
 assert.equal(observed.setupOpen,true,'STAGE_B_SETUP_ALREADY_FINISHED');
 assert.equal(observed.ordersClosed,true,'STAGE_B_ORDERS_OPEN');
 assert.equal(observed.positiveBalances,0,'STAGE_B_STOCK_ALREADY_STARTED');
 assert.deepEqual(Object.keys(observed.tables).sort(),baseline.applicationTables,'STAGE_B_TABLE_SCOPE_CHANGED');
 assertAlertSnapshot(observed.stockAlerts);
 assert.deepEqual(observed.stockAlerts.full,observed.tables[alertTable],'STAGE_B_ALERT_OBSERVED_MISMATCH');
 const allowedTimestampDifferences=[];
 for(const [name,expected] of Object.entries(baseline.tables)){
  assert.ok(validFingerprint(observed.tables[name]),'STAGE_B_FINGERPRINT_INVALID:'+name);
  if(name===alertTable){
   assert.deepEqual(observed.stockAlerts.withoutLastUpdated,baseline.stockAlerts.withoutLastUpdated,'STAGE_B_OPERATIONAL_DATA_CHANGED:'+name);
   const before=baseline.stockAlerts.rowHashes,after=observed.stockAlerts.rowHashes;
   assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort(),'STAGE_B_ALERT_ROW_IDENTITIES_CHANGED');
   const affectedRows=Object.keys(before).filter(id=>before[id]!==after[id]).length;
   const fullChanged=observed.tables[name].rows!==expected.rows||observed.tables[name].hash!==expected.hash;
   assert.equal(affectedRows>0,fullChanged,'STAGE_B_ALERT_ROW_EVIDENCE_MISMATCH');
   if(affectedRows)allowedTimestampDifferences.push({table:name,field:'last_updated_at',affectedRows});
   continue;
  }
  assert.deepEqual(observed.tables[name],expected,'STAGE_B_OPERATIONAL_DATA_CHANGED:'+name);
 }
 assert.ok(Array.isArray(observed.products)&&observed.products.length>0,'STAGE_B_PRODUCTS_REQUIRED');
 return {ok:true,readOnly:true,archiveSha256:baseline.archiveSha256,checkedTables:Object.keys(baseline.tables).length,
  capturedAt:observed.capturedAt,modeOn:true,setupOpen:true,ordersClosed:true,positiveBalances:0,allowedTimestampDifferences};
}
