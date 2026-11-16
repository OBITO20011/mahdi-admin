import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {frankfurt220TriggerAcl,frankfurt220RawTriggerAcl,frozen220TriggerAclProfile} from '../operations/frozen220-trigger-acl.mjs';
import {schemaCatalogSql} from '../testing/schema-catalog.mjs';
import {classifiedError} from './postgres-diagnostic.mjs';

const stage='restore-frozen220-trigger-acl';
const rejected=()=>classifiedError('RESTORE_FROZEN220_TRIGGER_ACL_UNSUPPORTED',{stage,tool:'internal'});
const selected=functions=>functions.filter(row=>row.schema==='public'&&frankfurt220TriggerAcl.signatures.includes(row.identity));

export function capturedFrozen220TriggerAcl(before){
 try{return frozen220TriggerAclProfile(before.catalog.functions);}
 catch{throw rejected();}
}

// Replays only the complete approved four-trigger profile. PostgreSQL GRANT on
// NULL materializes its built-in PUBLIC/owner grants in the original raw order.
export async function restoreFrozen220TriggerAcl(session,before){
 let transaction=false;
 try{
  const expected=capturedFrozen220TriggerAcl(before);
  const catalogSql=schemaCatalogSql.replace(/^BEGIN READ ONLY;/u,'').replace(/ROLLBACK;\s*$/u,'');
  const read=async()=>JSON.parse((await session.query(catalogSql)).trim());
  const actual=await read();
  const observed=frozen220TriggerAclProfile(actual.functions);
  const source=selected(before.catalog.functions),target=selected(actual.functions);
  assert.deepEqual(target.map(row=>({...row,acl:null})),source.map(row=>({...row,acl:null})),'RESTORE_FROZEN220_TRIGGER_DEFINITION_CHANGED');
  if(expected==='local')assert.equal(observed,'local','RESTORE_FROZEN220_LOCAL_ACL_CHANGED');
  if(expected==='frankfurt'&&observed==='local'){
   await session.query('BEGIN;SET LOCAL ROLE postgres;');transaction=true;
   for(const identity of frankfurt220TriggerAcl.signatures){
    await session.query('GRANT EXECUTE ON FUNCTION public.'+identity+' TO PUBLIC;');
   }
   const restored=await read();
   assert.equal(frozen220TriggerAclProfile(restored.functions),'frankfurt');
   assert.deepEqual(selected(restored.functions),source,'RESTORE_FROZEN220_RAW_POSTCONDITION');
   const literal=JSON.parse((await session.query(`SELECT jsonb_agg(p.proacl::text ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (${frankfurt220TriggerAcl.signatures.map(identity=>"'"+identity.slice(0,-2)+"'").join(',')});`)).trim());
   assert.ok(literal.length===4&&literal.every(value=>value===frankfurt220RawTriggerAcl),'RESTORE_FROZEN220_RAW_ACL_LITERAL');
   // Keep every other catalog row identical, including all other ACLs.
   const strip=catalog=>({...catalog,functions:catalog.functions.map(row=>
    row.schema==='public'&&frankfurt220TriggerAcl.signatures.includes(row.identity)?{...row,acl:null}:row)});
   assert.ok(isDeepStrictEqual(strip(restored),strip(actual)),'RESTORE_FROZEN220_UNRELATED_CATALOG_CHANGED');
   await session.query('COMMIT;');transaction=false;
  }
  return {profile:expected,checked:4,exactRawAcl:true,exceptionsApplied:[]};
 }catch{
  if(transaction)await session.query('ROLLBACK;').catch(()=>{});
  throw rejected();
 }
}
