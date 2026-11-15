// Separate generation only after a real successful fresh/incremental capture.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {inventory224CatalogDelta,migration224Sha256} from '../operations/inventory224-catalog.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
const root=path.resolve(import.meta.dirname,'../..');assert.equal(process.argv.length,2,'INVENTORY224_NO_TARGET_ARGUMENTS');
const report=JSON.parse(await readFile(path.join(root,'test-results/inventory224-catalog/report.json'),'utf8'));
assert.equal(report.ok,true);assert.equal(report.cleanup,true);assert.equal(report.hostedAccess,false);assert.equal(report.ownerDemoAccess,false);
assert.equal(report.freshIncrementalDifferences,0);assert.equal(report.networkAttachments,0);assert.equal(report.migrationSha256,migration224Sha256());
const read=name=>readFile(path.join(report.output,name+'.json'),'utf8').then(JSON.parse);
const before=await read('catalog223'),after=await read('catalog224-incremental');
const changes=inventory224CatalogDelta(before.catalog,after.catalog);assert.deepEqual(await read('fresh-incremental-differences'),[]);
const old=JSON.parse(await readFile(path.join(root,'docs/design/inventory224/catalog224-pins.json'),'utf8'));
const pins={format:1,migrationSha256:report.migrationSha256,base223PinSha256:sha256(canonicalLf(await readFile(path.join(root,'docs/design/off-quantity-counter223/catalog223-pins.json'),'utf8'))),changes};
assert.deepEqual(pins,old,'INVENTORY224_EXISTING_REVIEWED_PIN_CHANGED');
await writeFile(path.join(root,'docs/generated/DB_FUNCTIONS.md'),await readFile(path.join(report.output,'DB_FUNCTIONS224.md')));
console.log(JSON.stringify({ok:true,publicFunctions:688,privateFunctions:51,old223PinsUnchanged:true}));
