import test from 'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{sourceBeforeSentry}from'../scripts/audit/source-before-sentry.mjs';import{beforeRetentionDocs}from'../scripts/audit/source-before-retention-docs.mjs';
const original='962d0406c6edb6797b7b8429e9508b4e8379470f',retention='d563ba8994932d885570a3b0549493b5f0152f40',sentry='a82973712d22fa6393aa1ef6846ac42c1425aabe';
const git=(sha:string,file:string)=>execFileSync('git',['show',sha+':'+file],{encoding:'utf8',maxBuffer:16*1024**2}).replaceAll('\r\n','\n');
test('integration preserves both approved cutover contents and all Sentry runtime bytes',()=>{
 for(const suffix of ['md','html']){const f='docs/handover/ورقة-يوم-التشغيل.'+suffix,s=readFileSync(f,'utf8').replaceAll('\r\n','\n');assert.ok(s.includes('T+2/3'));assert.ok(s.includes('SENTRY_OWNER_AR.md'));assert.ok(s.includes('أول يومين'));assert.ok(!s.includes('T+7'));assert.ok(git(retention,f).includes('T+2/3'));assert.ok(git(sentry,f).includes('SENTRY_OWNER_AR.md'));assert.equal(sourceBeforeSentry(f,s),git(original,f));assert.equal(sourceBeforeSentry(f,s+'\nunknown change'),s+'\nunknown change');}
 const changed=execFileSync('git',['diff',sentry,'--name-only','--','src','customer-web','supabase','scripts/environments','scripts/operations'],{encoding:'utf8'}).trim();assert.equal(changed,'','Integration must not change approved runtime/SQL/build/deployment logic');
});
test('retention historical guard remains exact;unknown mutations are not projected',()=>{
 const f='tests/handover-documentation.test.ts',s=git(retention,f);assert.equal(beforeRetentionDocs(f,s),git(original,f));assert.equal(beforeRetentionDocs(f,s+'\nunknown change'),s+'\nunknown change');assert.equal(beforeRetentionDocs('unknown.ts',s),s);
});
