import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {executeInput} from './build-empty-supabase.mjs';
import {operationalManifest} from './operational-schema.mjs';
import {canonicalLf,canonicalDefinitionLf,renderFunctionReference} from '../testing/maintenance-db-contract.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const publicAcls=catalog=>new Map(catalog.functions.filter(row=>row.schema==='public').map(row=>[row.identity,row.acl]));

export async function functionReference223(executor,reference,beforeCatalog){
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&query.includes("n.nspname='public'")&&!query.includes('${'));
 const response=await executeInput(executor,query);
 assert.equal(response.code,0,'FUNCTION_REFERENCE223_READ_FAILED');
 const functions=JSON.parse(response.stdout.trim()).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));
 assert.equal(functions.length,687,'EXACT223_PUBLIC_FUNCTIONS_REQUIRED');
 const expected=await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8');
 const preservedAcls=publicAcls(beforeCatalog),referenceAcls=publicAcls(reference.catalog);
 assert.equal(preservedAcls.size,functions.length,'RESET223_FINAL_FUNCTION_ACL_SNAPSHOT_MISMATCH');
 assert.equal(referenceAcls.size,functions.length,'RESET223_FINAL_FUNCTION_ACL_REFERENCE_MISMATCH');
 const verified=functions.map(row=>{
  assert.ok(preservedAcls.has(row.identity)&&referenceAcls.has(row.identity),'CURRENT223_FUNCTION_REFERENCE_CHANGED');
  const preservedAcl=preservedAcls.get(row.identity);
  assert.ok(isDeepStrictEqual(row.acl,preservedAcl),'RESET223_FINAL_FUNCTION_ACL_CHANGED:'+row.identity);
  // Compare the generated reference with only the verified explicit ACL projected back.
  // The saved pre-RESET value was checked exactly, including order, above.
  return preservedAcl===null?row:{...row,acl:referenceAcls.get(row.identity)};
 });
 assert.ok(renderFunctionReference(await operationalManifest(),verified)===canonicalLf(expected),
  'CURRENT223_FUNCTION_REFERENCE_CHANGED');
 return functions.length;
}
