import {renderEnvironmentHeaders,resolveBuildEnvironment} from '../scripts/environments/environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const old='acjtabdqqnpwhdvbvnyw',fra='kzevmysfydaslxcerogt';
for(const file of ['public/_headers','customer-web/public/_headers'])test('Frankfurt CSP endpoints only;all other header bytes exact: '+file,()=>{
 const before=execFileSync('git',['show','40ecf12:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const after=renderEnvironmentHeaders(readFileSync(file,'utf8'),resolveBuildEnvironment({NAWASRAH_DEPLOYMENT_ENV:'production'})).replaceAll('\r\n','\n');
 assert.equal(after,before.replaceAll('https://'+old+'.supabase.co','https://'+fra+'.supabase.co').replaceAll('wss://'+old+'.supabase.co','wss://'+fra+'.supabase.co'));
 assert.equal(after.replaceAll(fra,old),before,'no change outside two exact origin replacements');
 const csp=after.split('\n').find(l=>l.includes('Content-Security-Policy:'));assert.ok(csp);
 const connect=csp.split(';').find(s=>s.trim().startsWith('connect-src '));assert.ok(connect);
 assert.deepEqual(connect.trim().split(/\s+/u),['connect-src',"'self'",'https://'+fra+'.supabase.co','wss://'+fra+'.supabase.co','https://challenges.cloudflare.com']);
 assert.doesNotMatch(connect,/\*/u);assert.ok(!after.includes(old));
});
test('staging instructions enforce Access before builds and Edge before both protected preview uploads',()=>{
 const doc=readFileSync('docs/operations/STAGING_FRANKFURT_AR.md','utf8');
 const sequence=doc.slice(doc.indexOf('function Invoke-StagingStep')).split('```')[0]!;
 const names=['submit-guest-order','manage-staff-users','admin-ai-assistant','n8n-alert-feed','send-order-push'];
 let at=0;for(const name of names){const next=sequence.indexOf('supabase functions deploy '+name);assert.ok(next>=at);at=next;}
 assert.ok(sequence.indexOf('npm.cmd run build')>at);
 assert.match(sequence,/if \(\$LASTEXITCODE -ne 0\)/u);
 assert.match(sequence,/--project-name=nawasrah-admin --branch=staging-frankfurt/u);
 assert.match(sequence,/--project-name=nawasrah-store --branch=staging-frankfurt/u);
 assert.doesNotMatch(sequence,/--branch=main|supabase link|secrets set/u);
 assert.ok(doc.indexOf('هذه بوابة قبل أيbuild')<doc.indexOf('function Invoke-StagingStep'));
});
