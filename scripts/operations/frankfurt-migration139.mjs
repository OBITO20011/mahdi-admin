// No CLI entry point or implicit target. Only the explicit owner command calls
// this after successful138 verification; runtime tests use disposable Docker.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {executeInput} from './build-empty-supabase.mjs';
import {schemaCatalogSql,catalogDifference} from '../testing/schema-catalog.mjs';
import {readNotificationSnapshot} from './frankfurt-notification-hold.mjs';
export const MIGRATION139='139_project_order_push_webhook_url.sql';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function read139Input(root){
 const input=await readFile(path.join(root,'supabase/migrations',MIGRATION139));
 const state=JSON.parse(await readFile(path.join(root,'docs/agent/project-state.json'),'utf8'));
 assert.equal(hash(Buffer.from(input.toString('utf8').replaceAll('\r\n','\n'))).toUpperCase(),state.migration139CanonicalLfSha256,'139_PIN_MISMATCH');
 return {name:MIGRATION139,input,rawSha256:hash(input)};
}
export async function apply139(executor,unit,repair,report={},beforeWrite=()=>{}){
 const read=async sql=>{const r=await executeInput(executor,sql);assert.equal(r.code,0,'139_READ_FAILED');return JSON.parse(r.stdout.trim());};
 const history=await read("BEGIN READ ONLY;SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;ROLLBACK;");
 assert.deepEqual(history,Array.from({length:138},(_,i)=>String(i+1).padStart(3,'0')),'EXACT138_HISTORY_REQUIRED');
 const before=await read(schemaCatalogSql),notifications=await readNotificationSnapshot(executor);
 beforeWrite();
 const applied=await executeInput(executor,unit.input);
 assert.equal(applied.code,0,'139_SQL_FAILED');
 await repair(); // Official CLI repair only after successful original139 bytes.
 const after=await read(schemaCatalogSql);
 report.catalogDifferences=catalogDifference(before,after); // Persist on caller's failure too.
 assert.equal(report.catalogDifferences.length,1,'139_EXPECTS_ONE_FUNCTION_DELTA');
 const difference=report.catalogDifferences[0];
 assert.equal(difference.section,'functions');
 assert.equal(difference.before.schema,'public');
 assert.equal(difference.before.identity,'enqueue_order_push_webhook(p_payload jsonb)');
 assert.notEqual(difference.before.definition,difference.after.definition);
 const {definition:oldDefinition,...oldMetadata}=difference.before;
 const {definition:newDefinition,...newMetadata}=difference.after;
 assert.ok(oldDefinition&&newDefinition);
 assert.deepEqual(newMetadata,oldMetadata,'139_FUNCTION_METADATA_CHANGED');
 assert.deepEqual(await readNotificationSnapshot(executor),notifications,'139_NOTIFICATION_HOLD_CHANGED');
 assert.deepEqual(await read("BEGIN READ ONLY;SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;ROLLBACK;"),[...history,'139'],'139_HISTORY_NOT_RECORDED');
 report.ok=true;report.notificationStateUnchanged=true;report.settingWritten=false;
 return report;
}
