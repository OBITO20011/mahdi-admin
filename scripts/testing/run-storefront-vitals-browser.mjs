// Actual Sentry SDK, intercepted envelopes, fictional DOM. No hosted connection.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
const root=path.resolve(import.meta.dirname,'../..').replaceAll('\\','/'),evidence=await mkdtemp(path.join(os.tmpdir(),'nawasrah-vitals-browser-'));
const secret='SensitiveFixture 0771234567 100.500 token-private cart-private';
for(const environment of ['production','isolated','missing']){
 const out=path.join(evidence,environment);await mkdir(out);
 await build({absWorkingDir:root,stdin:{contents:`import{initErrorMonitoring}from'${root}/customer-web/src/lib/errorMonitoring.ts';window.fixtureStatus=initErrorMonitoring();window.fixtureReady=async()=>Boolean((await import('@sentry/react')).getClient());window.fixtureFlush=async()=>{await(await import('@sentry/react')).flush(2000)};document.querySelector('button').addEventListener('click',()=>{const end=performance.now()+130;while(performance.now()<end){}});`,resolveDir:root,sourcefile:'vitals-fixture.ts',loader:'ts'},bundle:true,splitting:true,format:'esm',platform:'browser',outdir:out,plugins:[{name:'deterministic-vitals-sampling-only',setup(b){b.onLoad({filter:/customer-web[\\/]src[\\/]lib[\\/]errorMonitoring\.ts$/},async({path:file})=>{const source=await readFile(file,'utf8'),line="const random = typeof globalThis.crypto === 'undefined' ? 1 : crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;";assert.equal(source.split(line).length,2,'SAMPLING_TEST_SEAM_DRIFT');return{contents:source.replace(line,'const random = window.fixtureRandom;'),loader:'ts'};});}}],define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({PROD:true,VITE_MONITORING_ENV:environment==='missing'?'production':environment,VITE_MONITORING_RELEASE:'87f29abad10718bd533a6f9f0789194d967ee0f3',VITE_SENTRY_DSN:environment==='missing'?'':'https://fixture@o123.ingest.de.sentry.io/103'})}});
 await writeFile(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><h1 style="width:350px;height:240px">متجر وهمي لقياس محلي</h1><input value="${secret}"><button id="SensitiveFixture" aria-label="${secret}">اختبار</button><script type="module" src="/stdin.js"></script>`);
}
let current='production',browser,proxy;const proofs=[];
const server=createServer(async(req,res)=>{try{let file=path.join(evidence,current,new URL(req.url,'http://127.0.0.1:4189').pathname);if(req.url==='/empty.html'){res.setHeader('Content-Type','text/html');res.end('<p>Finished</p>');return;}try{await readFile(file);}catch{file=path.join(evidence,current,'index.html');}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');res.end(await readFile(file));}catch{res.writeHead(500).end();}});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4189,'127.0.0.1',resolve);});
 proxy=spawn(process.execPath,[path.join(root,'scripts/testing/run-browser-network-guard.mjs'),'4175'],{windowsHide:true,stdio:'ignore'});
 let ready=false;for(let n=0;n<100&&!ready;n++){try{ready=(await fetch('http://127.0.0.1:4175/health')).ok;}catch{/* Readiness or non-JSON envelope headers: no secret output. */}if(!ready)await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'NETWORK_GUARD_NOT_READY');
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
  browser=await engine.launch({headless:true,proxy:{server:'http://127.0.0.1:4175',bypass:'<-loopback>'}});
  for(const [environment,sampled] of [['production',true],['production',false],['isolated',true],['missing',true]]){
   console.log(JSON.stringify({starting:{engine:name,environment,sampled}}));
   current=environment;const context=await browser.newContext({viewport:{width:390,height:844}}),events=[],envelopes=[],escaped=[];
   await context.addInitScript(selected=>{window.fixtureRandom=selected ? .001 : .99;},sampled);
   await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.hostname==='o123.ingest.de.sentry.io'){const body=request.postData()||'';envelopes.push(body);for(const line of body.split('\n'))try{const event=JSON.parse(line);if(event.type==='transaction'&&event.contexts?.trace||event.trace_id&&event.measurements||event.items)events.push(event);}catch{/* Readiness or non-JSON envelope headers: no secret output. */}return route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},body:'{}'});}if(url.origin!=='http://127.0.0.1:4189'){escaped.push(url.origin);return route.abort();}return route.continue();});
   const page=await context.newPage(),pageErrors=[],requests=[];
   page.on('pageerror',error=>pageErrors.push(error.message));page.on('request',r=>requests.push(r.url()));
   try{
   await page.goto('http://127.0.0.1:4189/product/private/?token=token-private&phone=0771234567');
   const supported=await page.evaluate(()=>PerformanceObserver.supportedEntryTypes);
   if(environment==='production'&&sampled){
    await page.waitForFunction(async()=>await window.fixtureReady());
    await page.getByRole('button').click();
    await page.waitForTimeout(1800);await page.evaluate(()=>window.fixtureFlush());
    await page.goto('http://127.0.0.1:4189/empty.html');await page.waitForTimeout(300);
    assert.ok(events.length,'NO_VITAL_ENVELOPE:'+name);
    const transaction=events.find(event=>event.type==='transaction');assert.ok(transaction,'NO_PAGELOAD:'+name);
    assert.equal(transaction.transaction,'/product/:product/');
    if(supported.includes('largest-contentful-paint'))assert.ok(transaction.measurements?.lcp?.value>=0,'LCP_NOT_RETAINED:'+name);
   }else{await page.waitForTimeout(500);assert.deepEqual(events,[],'VITALS_NOT_DISABLED:'+environment+':'+sampled);}
   const serialized=JSON.stringify(envelopes);for(const fragment of [secret,'SensitiveFixture','0771234567','100.500','token-private','cart-private','?token','user_agent.original','client.address','http.url','http.request'])assert.ok(!serialized.includes(fragment),'VITAL_PRIVACY_LEAK:'+fragment);
   assert.deepEqual(escaped,[]);proofs.push({engine:name,environment,sampled,envelopes:events.length,supported});await writeFile(path.join(evidence,'progress.json'),JSON.stringify(proofs,null,2));
   }catch(error){await writeFile(path.join(evidence,'failure.json'),JSON.stringify({name,environment,sampled,message:error.message,pageErrors,requests,escaped,envelopes},null,2));console.error(JSON.stringify({failureEvidence:evidence}));throw error;}
   await context.close();
  }
  await browser.close();browser=null;
 }
 await writeFile(path.join(evidence,'proof.json'),JSON.stringify({ok:true,hosted:false,proofs},null,2));console.log(JSON.stringify({ok:true,evidence,proofs}));
}finally{await browser?.close();proxy?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
