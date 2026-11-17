// Owner-approved raw ACL replay for this closed set only. No catalog normalization.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {classifiedError} from './postgres-diagnostic.mjs';

export const private220AclTables=Object.freeze({
 sales_lite1:Object.freeze(['availability','completions','mode','orders','requests','returns','shifts']),
 sales_lite2:Object.freeze(['opening_epoch_items','opening_epochs','return_details','sales']),
});
const schemas=Object.keys(private220AclTables),stage='restore-lite220-private-acl';
const failure=()=>classifiedError('RESTORE_LITE220_PRIVATE_ACL_UNSUPPORTED',{stage,tool:'internal'});
const tableAcl=['postgres=arwdDxtm/postgres'],schemaAcl=['postgres=UC/postgres'];
const selected=catalog=>({
 tables:catalog.tables.filter(row=>schemas.includes(row.schema)),
 schemas:catalog.schemas.filter(row=>schemas.includes(row.name)),
});
const identities=rows=>rows.map(row=>row.schema+'.'+row.name).sort();
const expectedTables=Object.entries(private220AclTables).flatMap(([schema,names])=>names.map(name=>schema+'.'+name)).sort();
const strip=catalog=>({...catalog,
 tables:catalog.tables.map(row=>schemas.includes(row.schema)?{...row,acl:null}:row),
 schemas:catalog.schemas.map(row=>schemas.includes(row.name)?{...row,acl:null}:row),
});
export function capturedLite220PrivateAcl(before){
 try{
  const rows=selected(before.catalog);
  const applicable=before.history.some(version=>Number(version)>=220);
  if(!applicable){assert.equal(rows.tables.length+rows.schemas.length,0);return false;}
  assert.deepEqual(identities(rows.tables),expectedTables);
  assert.deepEqual(rows.schemas.map(row=>row.name).sort(),schemas);
  for(const row of rows.tables){assert.equal(row.owner,'postgres');assert.equal(row.kind,'r');assert.deepEqual(row.acl,tableAcl);}
  for(const row of rows.schemas){assert.equal(row.owner,'postgres');assert.deepEqual(row.acl,schemaAcl);}
  return true;
 }catch{throw failure();}
}
export async function restoreLite220PrivateAcl(session,before){
 let transaction=false;
 try{
  if(!capturedLite220PrivateAcl(before))return {applicable:false,checked:0,exactRawAcl:true,exceptionsApplied:[]};
  const read=async()=>JSON.parse((await session.query(schemaCatalogSql.replace(/^BEGIN READ ONLY;/u,'').replace(/ROLLBACK;\s*$/u,''))).trim());
  const source=selected(before.catalog),actual=await read(),target=selected(actual);
  assert.deepEqual(strip({...before.catalog,tables:source.tables,schemas:source.schemas}),strip({...before.catalog,tables:target.tables,schemas:target.schemas}));
  for(const row of target.tables)assert.ok(row.acl===null||isDeepStrictEqual(row.acl,tableAcl));
  for(const row of target.schemas)assert.ok(row.acl===null||isDeepStrictEqual(row.acl,schemaAcl));
  const pendingTables=target.tables.filter(row=>row.acl===null),pendingSchemas=target.schemas.filter(row=>row.acl===null);
  if(pendingTables.length+pendingSchemas.length){
   await session.query('BEGIN;SET LOCAL ROLE postgres;');transaction=true;
   for(const row of pendingTables)await session.query(`GRANT ALL PRIVILEGES ON TABLE ${row.schema}.${row.name} TO postgres;`);
   for(const row of pendingSchemas)await session.query(`GRANT ALL PRIVILEGES ON SCHEMA ${row.name} TO postgres;`);
   const restored=await read();
   assert.deepEqual(selected(restored),source,'RESTORE_LITE220_PRIVATE_RAW_POSTCONDITION');
   assert.ok(isDeepStrictEqual(strip(restored),strip(actual)),'RESTORE_LITE220_PRIVATE_UNRELATED_CATALOG_CHANGED');
   await session.query('COMMIT;');transaction=false;
  }else assert.deepEqual(target,source);
  return {applicable:true,checked:13,exactRawAcl:true,exceptionsApplied:[]};
 }catch{
  if(transaction)await session.query('ROLLBACK;').catch(()=>{});
  throw failure();
 }
}
