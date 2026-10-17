import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('full CI requires the real source-query access gate in the mandatory reads matrix',async()=>{
 const workflow=await readFile('.github/workflows/quality.yml','utf8');
 const step=workflow.match(/ {6}- name: Require real application table access through198\r?\n([\s\S]*?)(?=\r?\n {6}- name:)/u)?.[1];
 assert.ok(step,'REQUIRED_ACCESS_STEP_MISSING');
 assert.match(step,/if: matrix\.suite == 'package-f-reads'/u);
 assert.match(step,/run: node scripts\/audit\/run-table-access-diagnostic\.mjs --require-access/u);
 assert.doesNotMatch(step,/continue-on-error|\|\|\s*true|--migration-ceiling|--workdir/u);
 assert.match(workflow,/suite: \[[^\]]*package-f-reads[^\]]*\]/u);
 const runner=await readFile('scripts/audit/run-table-access-diagnostic.mjs','utf8');
 assert.match(runner,/process\.argv\.includes\('--require-access'\)\?198/u);
 assert.match(runner,/EXACT_APPROVED_HISTORY_REQUIRED/u);
 assert.match(runner,/report\.coverage=verifyProbeCoverage\(source,report\.results\)/u);
 assert.match(runner,/if\(process\.argv\.includes\('--require-access'\)&&!report\.applicationReady\)\{process\.exitCode=1/u);
});
