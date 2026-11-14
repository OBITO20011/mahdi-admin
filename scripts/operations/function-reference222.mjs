import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from './build-empty-supabase.mjs';
import {operationalManifest} from './operational-schema.mjs';
import {canonicalLf,canonicalDefinitionLf,renderFunctionReference} from '../testing/maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export async function functionReference222(executor){
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8');
 const query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];assert.ok(query&&!query.includes('${'));
 const result=await executeInput(executor,query);assert.equal(result.code,0,'FUNCTION_REFERENCE222_READ_FAILED');
 const functions=JSON.parse(result.stdout.trim()).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));assert.equal(functions.length,683,'EXACT222_PUBLIC_FUNCTIONS_REQUIRED');
 assert.equal(renderFunctionReference(await operationalManifest(),functions),canonicalLf(await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8')),'CURRENT222_FUNCTION_REFERENCE_CHANGED');return functions.length;
}
