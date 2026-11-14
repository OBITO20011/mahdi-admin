// Separate post-verification generation, bound to literal222 and complete
// successful fresh/incremental evidence. Old220 pins are never rewritten.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {canonicalLf,canonicalDefinitionLf,sha256,manifestDigest,renderFunctionReference} from './maintenance-db-contract.mjs';
import {operationalManifest} from '../operations/operational-schema.mjs';
import {sourceBeforeOptionalQuantity223} from '../audit/source-before-optional-quantity223.mjs';
import {independentPrices222Name,price222FunctionSnapshot,assertPrice222Additive} from '../operations/independent-prices222-catalog.mjs';
assert.equal(process.argv.length,2,'NO_TARGET_ARGUMENTS');
const root=new URL('../../',import.meta.url),read=name=>readFile(new URL('test-results/independent-prices222-catalog/'+name+'.json',root),'utf8').then(JSON.parse);
const report=await read('report');assert.equal(report.ok,true);assert.equal(report.cleanup,true);assert.equal(report.hostedAccess,false);assert.equal(report.ownerDemoAccess,false);assert.equal(report.freshIncrementalDifferences,0);assert.equal(report.networkAttachments,0);
const migration=canonicalLf(await readFile(new URL('supabase/migrations/'+independentPrices222Name,root),'utf8'));assert.equal(report.migrationSha256,sha256(migration));
const currentManifest=await operationalManifest(),manifest=currentManifest.filter(m=>Number(m.name.slice(0,3))<=222);
assert.ok([222,223].includes(Number(currentManifest.at(-1).name.slice(0,3))),'CATALOG222_UNKNOWN_SOURCE_CEILING');
assert.equal(manifestDigest(manifest),report.manifestSha256);
const before=await read('catalog220'),after=await read('catalog222-incremental'),fresh=await read('catalog222-fresh');
assertPrice222Additive(before.catalog,after.catalog);
assert.deepEqual(price222FunctionSnapshot(fresh.catalog),price222FunctionSnapshot(after.catalog));
assert.deepEqual(await read('fresh-incremental-differences'),[]);
const pins={format:1,beforeCeiling:220,migrationCeiling:222,publicFunctions:683,privateFunctions:39,freshIncrementalDifferences:0,migrationSha256:report.migrationSha256,base220PinsSha256:sha256(canonicalLf(await readFile(new URL('docs/design/sales-only-phase3/catalog220-pins.json',root),'utf8'))),functions:price222FunctionSnapshot(after.catalog)};
assert.equal(report.privateFunctions,39);
await mkdir(new URL('docs/design/independent-parcel-prices222/',root),{recursive:true});
const publicFunctions=await read('public222-functions');assert.equal(publicFunctions.length,683);
const pinsFile='docs/design/independent-parcel-prices222/catalog222-pins.json',functionFile='docs/generated/DB_FUNCTIONS.md';
const rendered=renderFunctionReference(manifest,publicFunctions.map(f=>({...f,definition:canonicalDefinitionLf(f.definition)})));
const historical=currentManifest.length!==manifest.length;
if(historical){
 assert.equal(canonicalLf(await readFile(new URL(pinsFile,root),'utf8')),JSON.stringify(pins,null,2)+'\n','HISTORICAL222_CATALOG_PIN_DRIFT');
 assert.equal(sourceBeforeOptionalQuantity223(functionFile,canonicalLf(await readFile(new URL(functionFile,root),'utf8'))),rendered,'HISTORICAL222_FUNCTION_REFERENCE_DRIFT');
}else{
 await writeFile(new URL(pinsFile,root),JSON.stringify(pins,null,2)+'\n');
 await writeFile(new URL(functionFile,root),rendered);
}
console.log(JSON.stringify({ok:true,publicFunctions:683,privateFunctions:39,old220PinsUnchanged:true,historicalCheckOnly:historical}));
