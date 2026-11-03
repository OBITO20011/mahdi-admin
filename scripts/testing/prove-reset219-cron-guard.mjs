import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {schemaCatalogSql} from './schema-catalog.mjs';
import {migrationManifest} from './maintenance-db-contract.mjs';
import {guardedReset219CronUnits,reset219CronStatements,verifyExistingReset219Cron,reset219CronIdentitySql} from '../operations/reset219-pg-cron-guard.mjs';
export async function proveReset219CronGuard(executor,root){
 const query=async input=>{const r=await executor.localExecute(input);assert.equal(r.code,0,'CRON_GUARD_RUNTIME_SQL_FAILED');return r.stdout.trim();};
 const before=JSON.parse(await query(schemaCatalogSql)),reference={migrationCeiling:219,catalog:before,manifest:await migrationManifest(root)};
 const identity=(await verifyExistingReset219Cron(executor,reference)).identity;
 const units=await Promise.all(reset219CronStatements.map(async s=>({name:s.name,input:await readFile(path.join(root,'supabase/migrations',s.name))})));
 const plan=guardedReset219CronUnits(units,reference),guardOf=p=>p.units[0].input.toString().match(/DO \$reset219_existing_cron\$[\s\S]*?END \$reset219_existing_cron\$;/u)[0];
 await query('BEGIN;'+guardOf(plan)+'ROLLBACK;');
 const negative=[];
 for(const [field,value]of [['version','0.0.0'],['owner','postgres'],['schema','public']]){
  assert.notEqual(identity[field],value);const bad=structuredClone(reference);bad.catalog.extensions.find(e=>e.name==='pg_cron')[field]=value;
  await assert.rejects(()=>verifyExistingReset219Cron(executor,bad),/RESET219_PG_CRON_IDENTITY_MISMATCH/u);
  const denied=await executor.localExecute('BEGIN;'+guardOf(guardedReset219CronUnits(units,bad))+'ROLLBACK;');
  assert.notEqual(denied.code,0);assert.match(denied.stderr,/RESET219_PG_CRON_IDENTITY_MISMATCH/u);negative.push({field,rejectedReadOnly:true,rejectedStatementGuard:true});
 }
 // A real empty pg_extension SELECT,not a fabricated successful query result.
 let missingQueries=0;const missing={localOnly:true,localExecute:async input=>{assert.equal(input,reset219CronIdentitySql);missingQueries++;return executor.localExecute(input.replace("e.extname='pg_cron'","e.extname='rehearsal_nonexistent_extension'"));}};
 await assert.rejects(()=>verifyExistingReset219Cron(missing,reference),/RESET219_PG_CRON_MISSING/u);assert.equal(missingQueries,1);
 assert.deepEqual(JSON.parse(await query(schemaCatalogSql)),before,'CRON_GUARD_PROBES_CHANGED_CATALOG');
 return {identity,sourceFileLineHashesPinned:true,replaced:plan.replaced,negative,missingCatalogRowRejected:true,missingQueryReadOnly:true,guardDoesNotCreateExtension:true,fullCatalogUnchanged:true};
}
