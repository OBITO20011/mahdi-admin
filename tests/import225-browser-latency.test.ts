import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync('docs/operations/MEASURE_IMPORT225_GET_READ_ONLY.js','utf8');
type Options={key?:string;session?:string;httpAt?:number;networkAt?:number;empty?:boolean;malformed?:boolean;cancel?:boolean;expectedError?:string;expectedCalls?:number};
const jwt=(role:string,exp=Math.floor(Date.now()/1000)+3600)=>'e30.'+Buffer.from(JSON.stringify({role,exp})).toString('base64url')+'.test';
async function probe(options:Options={}){
 let calls=0,clock=0;
 const logs:string[]=[],key=options.key??jwt('anon'),token=options.session??null;
 let finish:()=>void=()=>{throw Error('PROBE_NOT_INITIALIZED');};
 const done=new Promise<void>(resolve=>{finish=resolve;});
 const context={
  prompt:()=>key,confirm:()=>Boolean(token),
  localStorage:{getItem:(name:string)=>{assert.equal(name,'sb-kzevmysfydaslxcerogt-auth-token');return token?JSON.stringify({access_token:token}):null;},setItem:()=>{throw Error('STORAGE_WRITE_FORBIDDEN');},removeItem:()=>{throw Error('STORAGE_WRITE_FORBIDDEN');}},
  performance:{now:()=>clock+=10},Date,atob,
  console:{info:(s:string)=>{logs.push(s);finish();},warn:(s:string)=>{logs.push(s);finish();}},
  fetch:async(url:string,input:{method:string;redirect:string;credentials:string;cache:string;referrerPolicy:string;headers:{apikey:string;Authorization?:string}})=>{
   calls++;assert.equal(url,'https://kzevmysfydaslxcerogt.supabase.co/rest/v1/products?select=id&limit=1');
   assert.equal(input.method,'GET');assert.equal(input.redirect,'error');assert.equal(input.credentials,'omit');assert.equal(input.cache,'no-store');assert.equal(input.referrerPolicy,'no-referrer');assert.equal(input.headers.apikey,key);
   if(token)assert.equal(input.headers.Authorization,'Bearer '+token);
   if(options.networkAt===calls)throw new TypeError('MUST_NOT_LOG:'+key);
   const bad=options.httpAt===calls;
   return{status:bad?403:200,ok:!bad,json:async()=>options.malformed?{secret:key}:options.empty?[]:[{id:'fixture-id'}]};
  },
 };
 vm.runInNewContext(source,context,{filename:'owner-get-probe.js',timeout:1000});await done;
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(logs.length,1);if(key)assert.ok(!logs[0].includes(key));if(token)assert.ok(!logs[0].includes(token));
 const result:Record<string,unknown>=logs[0].startsWith('{')?JSON.parse(logs[0]):{message:logs[0]};
 if(options.expectedError){assert.equal(result.code,options.expectedError);assert.equal(calls,options.expectedCalls);if(options.networkAt)assert.equal(result.httpStatus,null);}
 else if(options.cancel){assert.equal(calls,0);}
 else{assert.equal(calls,50);assert.equal(result.samples,50);assert.equal(result.meanMs,10);assert.equal(result.p50Ms,10);assert.equal(result.p95Ms,10);assert.equal(result.assumedImportRequests,9438);assert.equal(result.estimatedImportMinutes,1.57);}
}
const cases:[string,Options][]=[
 ['public anon fifty GETs and exact aggregate math',{}],
 ['existing authenticated session stays in RAM',{session:jwt('authenticated')}],
 ['publishable key and empty RLS response',{key:'sb_publishable_OFFLINE_SENTINEL',empty:true}],
 ['HTTP403 stops without retry',{httpAt:3,expectedError:'HTTP_NOT_OK',expectedCalls:3}],
 ['network failure redacts details and stale HTTP status',{networkAt:2,expectedError:'NETWORK_OR_BROWSER_FAILURE',expectedCalls:2}],
 ['service_role refused before any request',{key:jwt('service_role'),expectedError:'PUBLIC_KEY_REQUIRED',expectedCalls:0}],
 ['expired session refused without refresh',{session:jwt('authenticated',1),expectedError:'SESSION_EXPIRED_NO_REFRESH',expectedCalls:0}],
 ['unexpected body never logged',{malformed:true,expectedError:'UNEXPECTED_READ_RESPONSE',expectedCalls:1}],
 ['cancel sends no request',{key:'',cancel:true}],
];
for(const [name,options]of cases)test('owner GET latency: '+name,()=>probe(options));
test('cutover records local measurements, unchanged request budget and shell distinction',()=>{
 const plan=readFileSync('docs/operations/GO_LIVE_CUTOVER_AR.md','utf8');
 for(const text of['17.65','5.38','9438','فرانكفورت أبطأ','powershell.exe','pwsh','UTF8','IMPORT225_BROWSER_LATENCY_READ_ONLY_AR.md'])assert.ok(plan.includes(text),text);
 assert.ok(readFileSync('docs/operations/IMPORT225_FRESH_SNAPSHOT_REUSE_STUDY_AR.md','utf8').includes('لا تنفيذ'));
});
