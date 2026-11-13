import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {checkCustomerProduction} from '../scripts/deployment/check-customer.mjs';

test('customer check builds and verifies CSP/SEO/private artifacts, with no publishing command',async()=>{
  const calls:string[]=[];
  const result=await checkCustomerProduction({env:{NAWASRAH_DEPLOYMENT_ENV:'production'},run:async(args:string[],options:{cwd:string;env:NodeJS.ProcessEnv})=>{
    assert.equal(options.env.NAWASRAH_DEPLOYMENT_ENV,'production');
    calls.push(args.join(' '));
  },verify:async options=>{
    assert.deepEqual(Object.keys(options).sort(),['app','dir','environment']);
    assert.equal(options.app,'customer');assert.equal(options.environment,'production');
    calls.push('strict-dist');return {ok:true,fixture:false};
  }});
  assert.equal(result.uploaded,false);
  assert.equal(calls.length,3);
  assert.match(calls[0],/run-context\.mjs production customer$/u);
  assert.equal(calls[1],'strict-dist');assert.match(calls[2],/verify-seo-output\.mjs$/u);
  assert.doesNotMatch(calls.join('\n'),/wrangler|pages deploy|functions deploy/u);
});

test('bad context, unknown/deploy flags and any failing check stop before subsequent work',async()=>{
  for(const args of [['--deploy'],['--check','--publish'],['--check','--check']]){
    let calls=0;await assert.rejects(()=>checkCustomerProduction({args,run:()=>{calls++;}}),/CUSTOMER_CHECK_ARGUMENT_REFUSED/u);assert.equal(calls,0);
  }
  let calls=0;
  await assert.rejects(()=>checkCustomerProduction({env:{VITE_BROWSER_QA_ISOLATED:'true'},run:()=>{calls++;}}),/PRODUCTION_DEPLOY_ISOLATED_REFUSED/u);assert.equal(calls,0);
  await assert.rejects(()=>checkCustomerProduction({env:{},run:()=>{throw Error('build-refused');}}),/build-refused/u);
  await assert.rejects(()=>checkCustomerProduction({env:{},run:()=>{calls++;},verify:()=>{throw Error('DIST_CSP_CHANGED');}}),/DIST_CSP_CHANGED/u);assert.equal(calls,1);
  calls=0;await assert.rejects(()=>checkCustomerProduction({env:{},run:()=>{calls++;},verify:async()=>({ok:true,fixture:true})}),/CUSTOMER_CHECK_FIXTURE_NOT_DEPLOYABLE/u);assert.equal(calls,1);
  // Exercise the actual executable: a publication flag is refused before build,
  // even on a machine with a real CLI/login. Nothing dispatches to that CLI.
  assert.throws(()=>execFileSync(process.execPath,['scripts/deployment/check-customer.mjs','--deploy'],{stdio:'pipe'}),/Command failed/u);
});
