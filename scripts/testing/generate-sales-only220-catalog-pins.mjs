import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {salesOnly220FunctionSnapshot,salesOnly220PrivateSnapshot} from '../operations/sales-only220-catalog.mjs';
import {migrationManifest,manifestDigest,renderFunctionReference,canonicalDefinitionLf,canonicalLf,sha256} from './maintenance-db-contract.mjs';
import {bridges,bridgedSource,replaceDefinitionSource} from './sales-only-phase1-bridges.mjs';
import {salesOnly220Name} from './sales-only220-compiler.mjs';
assert.equal(process.argv.length,2,'NO_TARGET_OR_HOSTED_INPUT');
const read=name=>readFile(new URL('../../test-results/sales-only220-catalog/'+name,import.meta.url),'utf8').then(JSON.parse),report=await read('report.json');
assert.equal(report.ok,true);assert.equal(report.cleanup,true);assert.equal(report.hostedAccess,false);assert.equal(report.networkAttachments,0);assert.equal(report.freshIncrementalDifferences,0);
const artifact=await readFile(new URL('../../supabase/migrations/'+salesOnly220Name,import.meta.url),'utf8');assert.equal(report.migrationSha256,sha256(canonicalLf(artifact)));
const original=await read('catalog219.json'),current=await read('catalog220.json'),frozen=JSON.parse(await readFile(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
const originalFunctions=original.functions.filter(r=>r.schema==='public');assert.equal(originalFunctions.length,636);let unchanged=0;
for(const f of originalFunctions){
 const sig=Object.keys(frozen.functions).find(s=>frozen.functions[s].definitionSha256===sha256(f.definition));assert.ok(sig,'ORIGINAL219_FUNCTION_DEFINITION_DRIFT');
 const after=current.functions.find(a=>a.schema==='public'&&a.identity===f.identity);assert.ok(after);const name=sig.slice(0,sig.indexOf('('));
 const source=f.definition.match(/\bAS (\$[a-zA-Z0-9_]*\$)([\s\S]*)\1/u)?.[2];assert.equal(sha256(source),frozen.functions[sig].sourceSha256);
 const expected=bridges.some(b=>b.name===name)?replaceDefinitionSource(f.definition,source,bridgedSource({name,signature:sig,source})):f.definition;
 assert.deepEqual(after,{...f,definition:expected},'EXACT636_FUNCTION_BODY_AND_METADATA');if(expected===f.definition)unchanged++;
}
assert.equal(unchanged,628);
const pins={migrationSha256:report.migrationSha256,publicFunctions:678,privateFunctions:35,frozenBodies:628,bridges:8,freshIncrementalDifferences:0,functions:salesOnly220FunctionSnapshot(current),privateObjects:salesOnly220PrivateSnapshot(current),publicTriggers:current.triggers.filter(r=>r.schema==='public')};
assert.equal(pins.functions.length,713);
const manifest=await migrationManifest(fileURLToPath(new URL('../..',import.meta.url)));assert.equal(manifestDigest(manifest),report.manifestSha256);
const publicFunctions=await read('public220-functions.json');assert.equal(publicFunctions.length,678);
// Generation occurs only after the independent read-only build has finished
// and cleaned its container. No tracked source is edited during verification.
await writeFile(new URL('../../docs/design/sales-only-phase3/catalog220-pins.json',import.meta.url),JSON.stringify(pins,null,2)+'\n');
await writeFile(new URL('../../docs/generated/DB_FUNCTIONS.md',import.meta.url),renderFunctionReference(manifest,publicFunctions.map(r=>({...r,definition:canonicalDefinitionLf(r.definition)}))));
console.log(JSON.stringify({ok:true,functions:713,publicFunctions:678,privateFunctions:35,unchangedBodies:628,bridges:8,generatedAfterCleanup:true}));
