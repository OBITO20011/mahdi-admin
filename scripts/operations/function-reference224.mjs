import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {executeInput} from './build-empty-supabase.mjs';
import {frozen220TriggerAclProfile,hasFrankfurt220TriggerAcl} from './frozen220-trigger-acl.mjs';
import {operationalManifest} from './operational-schema.mjs';
import {canonicalLf,canonicalDefinitionLf,renderFunctionReference} from '../testing/maintenance-db-contract.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const publicFunctions=catalog=>catalog.functions.filter(row=>row.schema==='public');

export async function functionReference224(executor,reference,beforeCatalog){
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&query.includes("n.nspname='public'")&&!query.includes('${'));
 const response=await executeInput(executor,query);
 assert.equal(response.code,0,'FUNCTION_REFERENCE224_READ_FAILED');
 const functions=JSON.parse(response.stdout.trim()).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));
 assert.equal(functions.length,688,'EXACT224_PUBLIC_FUNCTIONS_REQUIRED');
 const expected=await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8');
 const preservedFunctions=publicFunctions(beforeCatalog);
 const preservedByIdentity=new Map(preservedFunctions.map(row=>[row.identity,row]));
 const referenceAcls=new Map(publicFunctions(reference.catalog).map(row=>[row.identity,row.acl]));
 assert.equal(preservedByIdentity.size,functions.length,'RESET224_FINAL_FUNCTION_ACL_SNAPSHOT_MISMATCH');
 assert.equal(referenceAcls.size,functions.length,'RESET224_FINAL_FUNCTION_ACL_REFERENCE_MISMATCH');
 const verified=functions.map(row=>{
  const preserved=preservedByIdentity.get(row.identity);
  assert.ok(preserved&&referenceAcls.has(row.identity),'CURRENT224_FUNCTION_REFERENCE_CHANGED');
  const referenceAcl=referenceAcls.get(row.identity);
  const matchesReference=isDeepStrictEqual(preserved.acl,referenceAcl);
  assert.ok(matchesReference||hasFrankfurt220TriggerAcl(preserved),'RESET224_FINAL_FUNCTION_ACL_UNAPPROVED:'+row.identity);
  assert.ok(isDeepStrictEqual(row.acl,preserved.acl),'RESET224_FINAL_FUNCTION_ACL_CHANGED:'+row.identity);
  return matchesReference?row:{...row,acl:referenceAcl};
 });
 // Validate the complete profiles using the raw rows, before comparing the projected reference.
 const restoredFunctions=functions.map(({identity,owner,acl})=>({schema:'public',identity,owner,acl}));
 assert.equal(frozen220TriggerAclProfile(restoredFunctions),frozen220TriggerAclProfile(preservedFunctions),
  'RESET224_FINAL_FUNCTION_ACL_PROFILE_CHANGED');
 assert.ok(renderFunctionReference(await operationalManifest(),verified)===canonicalLf(expected),
  'CURRENT224_FUNCTION_REFERENCE_CHANGED');
 return functions.length;
}
