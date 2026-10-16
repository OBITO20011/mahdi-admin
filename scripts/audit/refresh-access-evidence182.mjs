// Mechanical artifact refresh AFTER each owned runtime has stopped. No mocks,
// granting or live connection. CLI subprocess failures stop the whole sequence.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {inventory,writeInventory} from './table-access-inventory.mjs';
import {serviceInventory,saveServices} from './service-access-inventory.mjs';
import {generateServiceReport} from './service-access-report.mjs';
import {reportWithSupplement,proposedAccess} from './table-access-report.mjs';
import {DEFAULT_WORKDIR} from '../operations/frankfurt-owner-build.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile);
assert.equal(process.argv.length,2,'NO_HOST_OR_TARGET_OPTIONS');
await writeInventory(await inventory());await saveServices(await serviceInventory());
for(const ceiling of [138,150,164,171,182]){
 const result=await exec(process.execPath,[path.join(root,'scripts/audit/run-table-access-diagnostic.mjs'),'--migration-ceiling',String(ceiling),
  ...(ceiling===182?['--require-access']:[])],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
 const summary=JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));assert.equal(summary.infrastructureOk,true);
 const text=await readFile(path.join(summary.output,'diagnostic.json'),'utf8'),proof=JSON.parse(text);
 assert.equal(proof.migrationCeiling,ceiling);if(ceiling!==138)assert.equal(proof.applicationReady,true);
 const name=ceiling===138?'TABLE_ACCESS_DIAGNOSTIC.json':`TABLE_ACCESS_AFTER_${ceiling}.json`;
 if(ceiling===138)proof.proposal=proposedAccess(await inventory(),proof);
 await writeFile(path.join(root,'docs/operations',name),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({ceiling,...summary}));
}
const result=await exec(process.execPath,[path.join(root,'scripts/audit/run-service-access-diagnostic.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2});
const summary=JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));assert.equal(summary.ok,true);
await generateServiceReport(path.join(summary.output,'diagnostic.json'),path.join(DEFAULT_WORKDIR,'local-reference.json'),path.join(DEFAULT_WORKDIR,'catalog-observed.json'));
// Historical138 report remains a negative control;new182 evidence is explicit,
// rather than renaming any old diagnosis or pretending all neutral RPCs succeed.
const source=await inventory(),negative=JSON.parse(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_DIAGNOSTIC.json'),'utf8')),
 current=JSON.parse(await readFile(path.join(root,'docs/operations/TABLE_ACCESS_AFTER_182.json'),'utf8'));
const markdown=await reportWithSupplement(source,negative);
await writeFile(path.join(root,'docs/operations/TABLE_ACCESS_INVENTORY.md'),`# تكامل182 —أدلة وصول حقيقية\n\nقاعدة182: ${current.results.length} استعلامSDK،${current.counts.permission_denied} رفض42501،${current.counts.other_error} خطأ،تغطية كاملة.\n\nالأقسام التاريخية138/150 أدناه ضوابط منفصلة أُعيد قياسها بنفس المصدر الحالي؛لا تعاد تسميتها كدليل182.\n\n`+markdown);
console.log(JSON.stringify({ok:true,service:summary}));
