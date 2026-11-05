// Real isolated production bundle and real SDK calls. No Lighthouse in CI.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {chromium,webkit} from '@playwright/test';
import {speedRpc} from './storefront-speed-fixture.mjs';
import {assertStorefrontRequests} from './storefront-budget.mjs';
const root=path.resolve(import.meta.dirname,'../..'),dist=path.join(root,'customer-web/dist'),evidence=await mkdtemp(path.join(os.tmpdir(),'nawasrah-storefront-budget-'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v7sAAAAASUVORK5CYII=','base64');
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.webmanifest':'application/manifest+json'};
let api,site,proxy,browser;const failures=[],proofs=[];
try{
 api=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin==='https://127.0.0.1:4174'?'https://127.0.0.1:4174':'http://127.0.0.1:4174');res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers']||'apikey,authorization,content-type,x-client-info');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  try{assert.equal(req.method,'POST');assert.match(req.url,/^\/rest\/v1\/rpc\/[a-z_]+$/u);const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=speedRpc(req.url.split('/').at(-1),JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
  catch(error){failures.push(error.message);res.writeHead(500).end('FIXTURE_REFUSED');}
 });await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(4176,'127.0.0.1',resolve);});
 site=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://127.0.0.1:4174').pathname;
  if(/^\/fixture-images\/\d+\.jpg(?:-400\.webp)?$/u.test(pathname)){res.setHeader('Content-Type','image/png');res.end(png);return;}
  let file=path.resolve(dist,'.'+decodeURIComponent(pathname));assert.ok(file===dist||file.startsWith(dist+path.sep));let bytes;try{bytes=await readFile(file);}catch{file=path.join(dist,'index.html');bytes=await readFile(file);}
  const type=mime[path.extname(file)]||'application/json';res.setHeader('Content-Type',type);res.setHeader('Access-Control-Allow-Origin',req.headers.origin==='https://127.0.0.1:4174'?'https://127.0.0.1:4174':'http://127.0.0.1:4174');
  if(type.startsWith('text/html')){const headers=await readFile(path.join(dist,'_headers'),'utf8');const csp=headers.split(/\r?\n/u).find(line=>line.trim().startsWith('Content-Security-Policy:'));assert.ok(csp);res.setHeader('Content-Security-Policy',csp.trim().slice('Content-Security-Policy:'.length).trim());}
  if(type==='video/mp4'){res.setHeader('Accept-Ranges','bytes');const range=/^bytes=(\d+)-(\d*)$/u.exec(req.headers.range||'');if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;assert.ok(start<=end&&start<bytes.length);res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);bytes=bytes.subarray(start,end+1);}}
  res.setHeader('Content-Length',bytes.length);res.end(bytes);
 }catch(error){failures.push(error.message);res.writeHead(500).end('FIXTURE_REFUSED');}});
 await new Promise((resolve,reject)=>{site.once('error',reject);site.listen(4174,'127.0.0.1',resolve);});
 const env={...process.env,VITE_BROWSER_QA_ISOLATED:'true',VITE_SUPABASE_URL:'http://127.0.0.1:4176',VITE_SUPABASE_PUBLISHABLE_KEY:'isolated-performance-public-key',VITE_SUPABASE_ANON_KEY:'isolated-performance-public-key',VITE_TURNSTILE_SITE_KEY:'1x00000000000000000000AA'};
 const build=await promisify(execFile)(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build'],{cwd:path.join(root,'customer-web'),env,windowsHide:true,maxBuffer:8*1024**2});await writeFile(path.join(evidence,'build.log'),build.stdout+build.stderr);
 proxy=spawn(process.execPath,[path.join(root,'scripts/testing/run-browser-network-guard.mjs'),'4175'],{windowsHide:true,stdio:'ignore'});
 let ready=false;for(let n=0;n<100&&!ready;n++){try{ready=(await fetch('http://127.0.0.1:4175/health')).ok;}catch{/* Readiness or non-JSON envelope headers: no secret output. */}if(!ready)await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'NETWORK_GUARD_NOT_READY');
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
  browser=await engine.launch({headless:true,proxy:{server:'http://127.0.0.1:4175',bypass:'<-loopback>'}});
  for(const[pageName,route]of[['home','/'],['category','/category/speed-0/'],['product','/product/SPEED-0000/'],['cart','/products/']]){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),requests=[],escaped=[];
   let loopbackHttpsFulfilled=0;
   await context.route('**/*',async r=>{
    const request=r.request(),url=new URL(request.url());
    if(url.hostname!=='127.0.0.1'||!['4174','4176'].includes(url.port)){escaped.push(url.origin);return r.abort();}
    // WebKit applies upgrade-insecure-requests to loopback too. Preserve the
    // EXACT CSP; fulfil its HTTPS request from our same bounded local fixture.
    if(url.protocol==='https:'){
     loopbackHttpsFulfilled++;url.protocol='http:';
     const response=await fetch(url,{method:request.method(),headers:request.headers(),body:request.postDataBuffer()??undefined});
     return r.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    return r.continue();
   });
   page.on('request',r=>requests.push({url:r.url(),method:r.method(),type:r.resourceType()}));
   const consoleErrors=[];page.on('pageerror',error=>consoleErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
   try{
   await page.goto((name==='webkit'?'https://':'http://')+'127.0.0.1:4174'+route);
   if(pageName==='home')await page.getByTestId('home-category-grid').waitFor();
   else if(pageName==='product')await page.getByRole('dialog').waitFor();
   else await page.getByTestId('catalog-products-grid').waitFor();
   if(pageName==='cart'){await page.getByRole('button',{name:/^فتح السلة،/u}).click();await page.getByRole('dialog').waitFor();}
   await page.waitForLoadState('networkidle');
   const report=()=>({rpc:requests.filter(r=>r.method==='POST'&&r.url.includes('/rest/v1/rpc/')).length,total:requests.length,fonts:requests.filter(r=>r.type==='font').length});
   assertStorefrontRequests(pageName,report());assert.deepEqual(escaped,[]);
   const positive=report();let negative=false;
   if(pageName==='home'){
    assert.equal(await page.locator('video').count(),0,'Decorative video must not compete with first paint');
    await page.evaluate(()=>fetch('http://127.0.0.1:4176/rest/v1/rpc/get_public_storefront_settings',{method:'POST',headers:{'content-type':'application/json',apikey:'isolated-performance-public-key'},body:'{}'}));
    assert.throws(()=>assertStorefrontRequests(pageName,report()),/STOREFRONT_RPC_REQUEST_BUDGET/u);negative=true;
    await page.locator('#top').tap({position:{x:10,y:20}});await page.locator('video').waitFor();
   }
   proofs.push({engine:name,page:pageName,...positive,negativeExtraRealRequestRejected:negative,loopbackHttpsFulfilled,cspUnchanged:true});
   }catch(error){await page.screenshot({path:path.join(evidence,name+'-'+pageName+'-failure.png')});await writeFile(path.join(evidence,'failure.json'),JSON.stringify({message:error.message,consoleErrors,requests,failures,body:await page.locator('body').innerText()},null,2));console.error(JSON.stringify({failureEvidence:evidence}));throw error;}
   await context.close();
  }
  await browser.close();browser=null;
 }
 assert.deepEqual(failures,[]);const guard=await fetch('http://127.0.0.1:4175/__network-guard/status').then(r=>r.json());assert.deepEqual(guard.escapedExternalRequests,[]);
 await writeFile(path.join(evidence,'proof.json'),JSON.stringify({ok:true,hosted:false,proofs,guard},null,2));console.log(JSON.stringify({ok:true,evidence,proofs}));
}finally{await browser?.close();proxy?.kill();await Promise.all([api,site].filter(Boolean).map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));}
