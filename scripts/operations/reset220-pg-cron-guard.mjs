// Owner7Nov: separate RESET220 policy only. Fresh builds still execute literal migrations.
import assert from 'node:assert/strict';
import {canonicalLf,sha256,migrationManifest} from '../testing/maintenance-db-contract.mjs';
import {executeResetInput} from './reset214-io.mjs';
import {assertOperationalManifest} from './operational-schema.mjs';
export const reset220CronStatements=Object.freeze([
 {name:'091_expire_stale_new_website_orders.sql',line:211,sha256:'b66fa73b06fed8e695dc48260d325e0db88a294a7b26fb53ff955aed5f271d54'},
 {name:'097_core_business_alerts.sql',line:628,sha256:'d3afb579cd853a18c91100a2f29358bde29a91405bbaa701b93c3a8e580a67ee'},
 {name:'098_business_summaries.sql',line:718,sha256:'5b39ddab61ff704370de2ce9dce18bfe8f99f74108e97fb03db8fba1f653dbde'},
].map(spec=>Object.freeze(spec)));
export const reset220CronIdentitySql="SELECT coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner))),'[]') FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_cron';";
export function reset220CronIdentity(reference){
 assert.equal(reference.migrationCeiling,220,'RESET220_CRON_SCOPE_REQUIRED');
 const rows=(reference.catalog?.extensions??[]).filter(e=>e.name==='pg_cron');
 assert.equal(rows.length,1,'RESET220_CRON_REFERENCE_REQUIRED');
 const {name,version,schema,owner}=rows[0];
 assert.equal(name,'pg_cron');
 for(const s of [version,schema,owner])assert.ok(typeof s==='string'&&/^[a-zA-Z0-9_.-]+$/u.test(s),'RESET220_CRON_REFERENCE_INVALID');
 return {name,version,schema,owner};
}
export function assertReset220CronIdentity(observed,identity){
 assert.ok(Array.isArray(observed)&&observed.length===1,'RESET220_PG_CRON_MISSING');
 assert.deepEqual(observed,[identity],'RESET220_PG_CRON_IDENTITY_MISMATCH');
}
export async function verifyExistingReset220Cron(executor,reference){
 const identity=reset220CronIdentity(reference),result=await executeResetInput(executor,reset220CronIdentitySql);
 assert.equal(result.code,0,'RESET220_PG_CRON_READ_FAILED');
 assertReset220CronIdentity(JSON.parse(result.stdout.trim()),identity);
 return {identity,checkedBeforeDestructive:true};
}
export function guardedReset220CronUnits(units,reference){
 const identity=reset220CronIdentity(reference),replaced=[];
 const literal=s=>"'"+s.replaceAll("'","''")+"'";
 // A DO with SELECT only: neither CREATE EXTENSION nor its platform hooks run.
 const guard="DO $reset220_existing_cron$ BEGIN IF (SELECT count(*) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_cron' AND e.extversion="+literal(identity.version)+" AND n.nspname="+literal(identity.schema)+" AND pg_get_userbyid(e.extowner)="+literal(identity.owner)+")<>1 THEN RAISE EXCEPTION 'RESET220_PG_CRON_IDENTITY_MISMATCH'; END IF; END $reset220_existing_cron$;";
 const prepared=units.map(unit=>{
  const spec=reset220CronStatements.find(s=>s.name===unit.name);if(!spec)return unit;
  assert.ok(!replaced.some(s=>s.name===spec.name),'RESET220_CRON_DUPLICATE_UNIT');
  assert.equal(reference.manifest.find(m=>m.name===spec.name)?.sha256,spec.sha256,'RESET220_CRON_REFERENCE_FILE_CHANGED');
  const raw=unit.input.toString('utf8'),marker='\n\\echo EMPTY_BUILD_APPLIED:'+spec.name+'\n';
  // Frozen001-138 builder appends exactly this psql evidence line. Hash the
  // original file only,retain the marker byte-for-byte,and reject any other tail.
  const source=raw.endsWith(marker)?raw.slice(0,-marker.length):raw;
  const canonical=canonicalLf(source),statement='CREATE EXTENSION IF NOT EXISTS pg_cron;';
  assert.equal(sha256(canonical),spec.sha256,'RESET220_CRON_SOURCE_FILE_CHANGED');
  assert.equal(canonical.split('\n')[spec.line-1],statement,'RESET220_CRON_SOURCE_LINE_CHANGED');
  assert.equal(raw.split(statement).length,2,'RESET220_CRON_STATEMENT_NOT_UNIQUE');
  const input=raw.replace(statement,guard);replaced.push({...spec});
  return {...unit,input:Buffer.isBuffer(unit.input)?Buffer.from(input):input};
 });
 assert.equal(replaced.length,3,'RESET220_CRON_THREE_KNOWN_UNITS_REQUIRED');
 return {units:prepared,replaced,identity};
}
export async function verifyReset220MigrationManifest(root,reference){
 const actual=assertOperationalManifest(await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=220);assert.deepEqual(actual,reference.manifest,'RESET220_FINAL_MIGRATION_SOURCE_CHANGED');
 return {files:actual.length,manifestDigest:sha256(JSON.stringify(actual)),namesAndHashesUnchanged:true};
}
