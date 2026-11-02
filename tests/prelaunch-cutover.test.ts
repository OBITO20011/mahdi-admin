import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=(file:string)=>readFileSync(file,'utf8').replaceAll('\r\n','\n');
const old=(file:string)=>execFileSync('git',['show','f24d8330:'+file],{encoding:'utf8',maxBuffer:32*1024**2}).replaceAll('\r\n','\n');
test('cutover changes only the approved source Boolean;production config/CSP/runtime and SQL transport remain identical',()=>{
 const flag='scripts/environments/prelaunch-trial-control.mjs';assert.equal(read(flag),old(flag).replace('PRELAUNCH_TRIAL_OPEN=true','PRELAUNCH_TRIAL_OPEN=false'));
 for(const f of ['scripts/environments/environment.mjs','scripts/environments/verify-dist.mjs','scripts/environments/deployment-context.mjs','scripts/deployment/deploy-prelaunch-trial.mjs','scripts/environments/run-context.mjs','public/_headers','customer-web/public/_headers','src/config/supabase-public-config.ts','customer-web/src/config/supabase-public-config.ts','scripts/testing/run-environment-builds.mjs'])assert.equal(read(f),old(f),f);
});
test('closed real CLI gate retains production/staging positive builds and all refusal paths;launch merge precedes reset',()=>{
 const runner=read('scripts/testing/run-prelaunch-trial-builds.mjs'),closed=read('scripts/testing/run-prelaunch-closed-gates.mjs');assert.ok(runner.includes("if(!PRELAUNCH_TRIAL_OPEN){await import('./run-prelaunch-closed-gates.mjs');process.exit(0);}"));
 for(const token of ['run-environment-builds.mjs','run-context.mjs','verify-dist.mjs','deploy-prelaunch-trial.mjs','existingArtifactRefusals','environmentOverrideRefusals'])assert.ok(closed.includes(token),token);
 for(const f of ['docs/handover/ورقة-يوم-التشغيل.md','docs/handover/ورقة-يوم-التشغيل.html']){const s=read(f);assert.ok(s.indexOf('دمج PR إغلاق المعاينات')<s.indexOf('7. RESET219'));assert.ok(s.includes('لا يُدمج قبل يوم التشغيل'));assert.ok(s.includes('03:00'));assert.ok(s.includes('حظر المعاينات'));}
});
