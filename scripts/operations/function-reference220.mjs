// Keep the219 owner's frozen reader unchanged.220 uses its own bounded reader.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {executeInput} from './build-empty-supabase.mjs';
import {migrationManifest,canonicalDefinitionLf,canonicalLf,renderFunctionReference,sha256} from '../testing/maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');
export async function functionReference220(executor,ceiling=220){
 assert.ok([219,220].includes(ceiling),'OWNER220_FUNCTION_REFERENCE_SCOPE');
 const source=await readFile(path.join(root,'scripts/testing/generate-db-functions.mjs'),'utf8'),query=source.match(/const query = `(BEGIN READ ONLY;[\s\S]+?ROLLBACK;)`;/u)?.[1];
 assert.ok(query&&query.includes("n.nspname='public'")&&!query.includes('${'),'FUNCTION_REFERENCE_QUERY_CHANGED');
 const read=await executeInput(executor,query);assert.equal(read.code,0,'FUNCTION_REFERENCE_READ_FAILED');
 const functions=JSON.parse(read.stdout.trim()).map(row=>({...row,definition:canonicalDefinitionLf(row.definition)}));assert.equal(functions.length,ceiling===219?636:680,'OWNER220_EXACT_FUNCTION_COUNT');
 const rendered=renderFunctionReference((await migrationManifest(root)).filter(m=>Number(m.name.slice(0,3))<=ceiling),functions);
 if(ceiling===219)assert.equal(sha256(rendered),'a95ef5a2015b144fa3ef028e19f30a8ca1b2bac1b3544f9e9bcc6c1de5a7edbf','FROZEN219_FUNCTIONS_CHANGED');
 else assert.equal(rendered,canonicalLf(await readFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),'utf8')),'DB_FUNCTIONS220_STALE');
 return functions.length;
}
