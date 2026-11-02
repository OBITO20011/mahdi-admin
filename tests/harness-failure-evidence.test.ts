import test from'node:test';import assert from'node:assert/strict';import{safeTraceRecord}from'../scripts/testing/harness-failure-evidence.mjs';import{readFileSync}from'node:fs';
test('trace records keep timing and method only;no raw parameters,URLs,errors,headers,console or arbitrary metadata',()=>{
 const sensitive='private-sensitive-value';const before=safeTraceRecord({type:'before',callId:'call@12',startTime:100,class:'Frame',method:'click',apiName:sensitive,pageId:sensitive,params:{url:'http://localhost/?token='+sensitive,headers:{authorization:sensitive}},stack:[sensitive]});assert.deepEqual(before,{type:'before',callId:'call@12',startTime:100,class:'Frame',method:'click',params:{}});
 const after=safeTraceRecord({type:'after',callId:'call@12',endTime:105,error:{message:sensitive,stack:sensitive},result:{token:sensitive}});assert.deepEqual(after,{type:'after',callId:'call@12',endTime:105,error:{name:'Error',message:'HARNESS_ACTION_FAILED'}});
 for(const type of ['event','frame-snapshot','resource-snapshot','screencast-frame','log'])assert.equal(safeTraceRecord({type,message:sensitive}),null);
 const unknown=safeTraceRecord({type:'before',class:sensitive,method:sensitive,apiName:sensitive});assert.deepEqual(unknown,{type:'before',class:'Page',method:'unknown',params:{}});
});
test('both real fullstack runners warm once per engine before measured case and retain original limits/assertions',()=>{
 for(const f of ['run-aftercare215-fullstack.mjs','run-partial216-fullstack.mjs']){const s=readFileSync('scripts/testing/'+f,'utf8');assert.match(s,/warmHarness/);assert.match(s,/WARMUP_ZERO_WRITES/);assert.match(s,/WARMUP_WRITER_CALL/);assert.match(s,/startHarnessEvidence/);assert.match(s,/evidence\.capture\(lastHarnessPage\)/);assert.doesNotMatch(s,/retries:|setDefaultTimeout|setDefaultNavigationTimeout/u);}
 const y=readFileSync('.github/workflows/quality.yml','utf8');assert.match(y,/sanitized-harness-failure/);assert.match(y,/path: test-results\/harness-failure\/\s+retention-days: 7/u);
});
