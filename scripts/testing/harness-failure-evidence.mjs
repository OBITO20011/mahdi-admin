// Synthetic local harnesses only. Never publish raw traces, network, DOM snapshots or console text.
import assert from 'node:assert/strict';import path from 'node:path';import{mkdir,readFile,writeFile,mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{createRequire}from'node:module';
const {yauzl,yazl}=createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
class HarnessWarmupFailure extends Error{constructor(evidence){super('HARNESS_WARMUP_FAILED_SEE_SANITIZED_ARTIFACT');this.evidence=evidence;}}
export const warmupFailureEvidence=error=>error instanceof HarnessWarmupFailure?error.evidence:null;
export async function readTraceZip(bytes){
 return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(error);const entries=[];zip.on('error',reject);zip.on('end',()=>resolve(entries));zip.on('entry',entry=>{
   if(entry.uncompressedSize>16*1024**2){zip.close();reject(Error('TRACE_ENTRY_TOO_LARGE'));return;}
   zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('data',b=>chunks.push(b));stream.on('error',reject);stream.on('end',()=>{entries.push({name:entry.fileName,bytes:Buffer.concat(chunks)});zip.readEntry();});});
  });zip.readEntry();
 }));
}
export function safeTraceRecord(event){
 const pick=(keys)=>Object.fromEntries(keys.filter(k=>typeof event[k]==='number'&&Number.isFinite(event[k])||(typeof event[k]==='string'&&['callId','pageId','contextId','parentId','stepId'].includes(k)&&/^(?:call|page|context|step|browser-context)@[a-z0-9-]{1,100}$/iu.test(event[k]))).map(k=>[k,event[k]]));
 if(event.type==='context-options')return{...pick(['version','contextId','wallTime','monotonicTime']),type:event.type,browserName:['chromium','webkit','firefox'].includes(event.browserName)?event.browserName:'chromium',origin:'library',platform:['linux','darwin','win32'].includes(event.platform)?event.platform:'linux',sdkLanguage:'javascript',options:{viewport:{width:390,height:844}}};
 if(event.type==='before')return{...pick(['callId','startTime','pageId','stepId','parentId']),type:event.type,class:['Page','Frame','Locator','BrowserContext','Tracing'].includes(event.class)?event.class:'Page',method:['goto','click','fill','check','uncheck','expect','evaluateExpression','evaluateExpressionHandle','waitForSelector','waitForLoadState','screenshot','isVisible','isEnabled','inputValue','textContent','press','reload','selectOption','setInputFiles'].includes(event.method)?event.method:'unknown',params:{}};
 if(event.type==='after')return{...pick(['callId','endTime']),type:event.type,...(event.error?{error:{name:'Error',message:'HARNESS_ACTION_FAILED'}}:{})};
 // Console/network/DOM/log/error stacks and inputs are deliberately excluded.
 return null;
}
export async function sanitizedTrace(bytes){
 const result=[];for(const entry of await readTraceZip(bytes)){
  if(entry.name.endsWith('.trace')){const rows=entry.bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line=>safeTraceRecord(JSON.parse(line))).filter(Boolean);result.push({name:result.filter(e=>e.name.endsWith('.trace')).length+'.trace',bytes:Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n')});}
  else if(entry.name.endsWith('.network'))result.push({name:result.filter(e=>e.name.endsWith('.network')).length+'.network',bytes:Buffer.alloc(0)});
 }
 assert.ok(result.some(e=>e.name.endsWith('.trace')),'TRACE_ACTIONS_REQUIRED');
 return new Promise((resolve,reject)=>{const zip=new yazl.ZipFile(),chunks=[];zip.outputStream.on('data',b=>chunks.push(b));zip.outputStream.on('error',reject);zip.outputStream.on('end',()=>resolve(Buffer.concat(chunks)));for(const e of result)zip.addBuffer(e.bytes,e.name);zip.end();});
}
function consoleCode(text){
 if(/Outdated Optimize Dep|504|ISOLATED_VITE_504/u.test(text))return'VITE_OPTIMIZATION_NOT_READY';
 if(/Failed to fetch dynamically imported module|Importing a module script failed/u.test(text))return'CHUNK_LOAD_FAILED';
 if(/LOCAL_CONTEXT_INVALID|LOCAL_CLIENT_REQUIRED/u.test(text))return'HARNESS_CONTEXT_NOT_READY';
 if(/42501|permission denied/iu.test(text))return'LOCAL_READ_REFUSED';return'HARNESS_CONSOLE_EVENT';
}
export function safeRequestFailure(request){
 const raw=request.failure()?.errorText??'',known=['ERR_ABORTED','ERR_FAILED','ERR_CONNECTION_REFUSED','ERR_CONNECTION_RESET','ERR_EMPTY_RESPONSE','ERR_BLOCKED_BY_CLIENT','ERR_INSUFFICIENT_RESOURCES'];
 const resource=request.resourceType(),type=['document','script','stylesheet','font','fetch','xhr','image','other'].includes(resource)?resource:'other';
 let kind='other';try{const u=new URL(request.url());kind=!['localhost','127.0.0.1','[::1]'].includes(u.hostname)?'blocked-nonloopback':u.pathname.includes('/node_modules/')||u.pathname.includes('/@fs/')?'dependency':u.pathname.startsWith('/e2e/')?'harness':u.pathname.startsWith('/src/')?'source':u.pathname.startsWith('/rest/')?'local-api':'other';}catch{/* No raw URL retained. */}
 return{type:'requestfailed',code:known.find(code=>raw.includes(code))??'REQUEST_FAILED',resource:type,kind};
}
export function safeHarnessFailure(error){
 const label=String(error?.message??'').split('\n')[0];
 const known=['WARMUP_ZERO_WRITES','WARMUP_WRITER_CALL','REAL_PREVIEW_ZERO_WRITES','NO_DRAWER_DEBT_OR_PAYABLE_CHANGED','LOST_REPLY_RECOVERY_ZERO_WRITES','REPOSITORY_CHANGED_DURING_VERIFICATION','LOCAL_POSTGREST_READINESS','HARNESS_WARMUP_FAILED_SEE_SANITIZED_ARTIFACT'];
 return{error:'HARNESS_VERIFICATION_FAILED_SEE_SANITIZED_ARTIFACT',errorType:['Error','AssertionError','TimeoutError'].includes(error?.name)?error.name:'Error',errorCode:known.includes(label)?label:error?.code==='ERR_ASSERTION'?'ERR_ASSERTION':'HARNESS_STAGE_FAILED'};
}
export async function recordNoPageFailure({root,suite}){
 assert.ok(['aftercare215','partial216'].includes(suite));const dest=path.join(root,'test-results/harness-failure',suite+'-pre-page-'+Date.now());await mkdir(dest,{recursive:true});await writeFile(path.join(dest,'manifest.json'),JSON.stringify({suite,pageAvailable:false,code:'FAILURE_BEFORE_BROWSER_EVIDENCE_AVAILABLE',rawErrorRetained:false})+'\n');return{code:'FAILURE_BEFORE_BROWSER_EVIDENCE_AVAILABLE'};
}
export async function startHarnessEvidence(context,{root,suite,stage}){
 assert.match(suite,/^(?:aftercare215|partial216|diagnostic-test)$/u);const logs=[];const record=(type,text,extra={})=>{if(logs.length<100)logs.push({type,code:consoleCode(text),...extra});};
 context.on('page',page=>{page.on('console',message=>record(message.type(),message.text()));page.on('pageerror',error=>record('pageerror',error.message));page.on('response',res=>{if(res.status()>=400)record('http',res.status()===504?'504':'http',{status:res.status()});});page.on('requestfailed',request=>{if(logs.length<100)logs.push(safeRequestFailure(request));});});
 await context.tracing.start({screenshots:false,snapshots:false,sources:false});let stopped=false;
 return{async discard(){if(!stopped){stopped=true;await context.tracing.stop();}},async capture(page){
  if(stopped)return null;stopped=true;const dest=path.join(root,'test-results/harness-failure',suite+'-'+Date.now()+'-'+process.pid),privateDir=await mkdtemp(path.join(tmpdir(),'nawasrah-private-trace-'));await mkdir(dest,{recursive:true});
 const result={suite,stage:['warmup','Chromium-final','Chromium-supplier','WebKit-final','WebKit-supplier','Chromium-cash','Chromium-cliq','WebKit-cash','WebKit-cliq','diagnostic-test'].includes(stage)?stage:'unknown',consoleTextRetained:false,networkRetained:false,domSnapshotsRetained:false,trace:'actions-only;params/messages/stacks/URLs removed',screenshot:false};
  try{
   try{await context.tracing.stop({path:path.join(privateDir,'raw.zip')});await writeFile(path.join(dest,'trace-sanitized.zip'),await sanitizedTrace(await readFile(path.join(privateDir,'raw.zip'))));result.traceSaved=true;}catch{result.traceError='TRACE_CAPTURE_FAILED';}
   if(page&&!page.isClosed())try{await page.screenshot({path:path.join(dest,'page-masked.png'),fullPage:true,mask:[page.locator('input,textarea,[role="status"],[role="alert"],[data-sensitive],vite-error-overlay')]});result.screenshot=true;}catch{result.screenshotError='SCREENSHOT_CAPTURE_FAILED';}
   await writeFile(path.join(dest,'console-sanitized.json'),JSON.stringify(logs,null,2)+'\n');await writeFile(path.join(dest,'manifest.json'),JSON.stringify(result,null,2)+'\n');return result;
  }finally{await rm(privateDir,{recursive:true,force:true});}
 }};
}
export async function warmHarness({browser,url,ready,root,suite,route,prepare}){
 const u=new URL(url);assert.ok(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname),'WARMUP_LOOPBACK_ONLY');
 const context=await browser.newContext({viewport:{width:390,height:844}}),evidence=await startHarnessEvidence(context,{root,suite,stage:'warmup'}),page=await context.newPage();
 try{await page.route('**/*',route);if(prepare)await prepare();await page.goto(url);await ready(page);await page.evaluate(()=>document.fonts.ready);await evidence.discard();return{ready:true,compiledBeforeNavigation:Boolean(prepare),hostedConnections:0,retries:0};}
 catch{throw new HarnessWarmupFailure(await evidence.capture(page));}
 finally{await context.close();}
}
