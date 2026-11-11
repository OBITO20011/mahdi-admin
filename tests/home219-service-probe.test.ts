import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {home219ServiceProbeArgs} from '../scripts/testing/home219-service-probe.mjs';

test('219 owner gates retain default service diagnostic; prototype is explicit and fresh-audit only',()=>{
 const original=['scripts/audit/run-service-access-diagnostic.mjs','--migration-ceiling','219'];
 assert.deepEqual(home219ServiceProbeArgs([]),original);
 assert.deepEqual(home219ServiceProbeArgs(['--sales-only-phase2']),[...original,'--quarantined-prototype','sales-only-phase2']);
 for(const args of [['--workdir','owner'],['--url','http://127.0.0.1'],['--sales-only-phase2','--apply'],['--sales-only-phase2','--sales-only-phase2'],['--unknown']])assert.throws(()=>home219ServiceProbeArgs(args),/HOME219_DIAGNOSTIC_OPTION_REQUIRED/);
 const runner=readFileSync('scripts/testing/run-home219-operations-gates.mjs','utf8');
 assert.ok(runner.indexOf('home219ServiceProbeArgs(process.argv.slice(2))')<runner.indexOf('await mkdtemp'));
 for(const tool of ['run-owner-upgrade219-runtime.mjs','run-reset219-resume-runtime.mjs','run-reset219-cli-contract.mjs'])assert.match(runner,new RegExp("\\['scripts/testing/"+tool.replaceAll('.','\\.')+"',reference\\]"));
 assert.doesNotMatch(runner,/--quarantined-prototype.*reference|GRANT|ALTER FUNCTION/);
 assert.match(readFileSync('.github/workflows/quality.yml','utf8'),/run: node scripts\/testing\/run-home219-operations-gates\.mjs --sales-only-phase2/);
});
