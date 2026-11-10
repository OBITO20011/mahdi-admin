// Real isolated production bundle and real SDK calls. No Lighthouse in CI.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {chromium,webkit} from '@playwright/test';
import {speedRpc,speedProducts,speedId,speedRpcPath,fullSpeedRpcName} from './storefront-speed-fixture.mjs';
import {measureStorefrontBudget,assertStorefrontBudget} from './storefront-budget.mjs';
import {expect} from '@playwright/test';
const root=path.resolve(import.meta.dirname,'../..'),dist=path.join(root,'customer-web/dist'),evidence=await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(),'nawasrah-cart-flight-'));
// Deterministic valid PNG: compute every chunk CRC, rather than copying an
// opaque 1px fixture that some browser decoders reject. No external image I/O.
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
const chunk=(type,data)=>{const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);};
const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=6;
const pixels=Buffer.alloc(64*(1+64*4));for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=y*(1+64*4)+1+x*4,box=x>=17&&x<47&&y>=8&&y<57,label=box&&y>=26&&y<43;const color=label?[88,60,39]:box?[212,177,112]:[249,243,231];pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255;}
let png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.webmanifest':'application/manifest+json'};

if(process.env.NAWASRAH_CART_FLIGHT_REVIEW_IMAGES)png=await readFile(path.join(process.env.NAWASRAH_CART_FLIGHT_REVIEW_IMAGES,'0.jpg-400.webp'));
const family={...speedProducts[0],id:speedId(9900),sku:'FLIGHT-FAMILY',nameAr:'عائلة اختبار الحركة',isFlavorMaster:true};
const flavors=['تفاح','عنب'].map((flavorNameAr,i)=>({...speedProducts[0],id:speedId(9901+i),sku:'FLIGHT-FLAVOR-'+i,nameAr:family.nameAr+' - '+flavorNameAr,flavorNameAr,flavorMasterProductId:family.id,isFlavorMaster:false}));
function fixtureRpc(name,args){
 name=fullSpeedRpcName(name);
 if(name==='get_public_configurable_parcel_options')return{featureState:'ENABLED',guestCreationEnabled:true,options:[{familyProductId:family.id,parcelConfigurationId:speedId(9910),configurationRevision:1,compositionMode:'configurable_mix',unitsPerParcel:2,parcelPriceInMinorUnits:1000,baseUnitNameAr:'باكيت',saleUnitNameAr:'طرد',components:flavors.map(p=>({...p,productId:p.id}))}]};
 if(name==='get_public_storefront_catalog_page'){
  if(args.p_search?.includes('FLIGHT-FAMILY')||args.p_product_ids?.includes(family.id))return{...speedRpc(name,{}),items:[family,...flavors],total:1};
  const data=speedRpc(name,args);return{...data,items:data.items.map(p=>p.id===speedProducts[1].id?{...p,imageUrl:''}:p.id===speedProducts[2].id?{...p,availableQuantity:12,availableSalePackages:1}:p)};
 }
 return speedRpc(name,args);
}

let api,site,proxy,browser;const failures=[],proofs=[];
try{
 api=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin==='https://127.0.0.1:4174'?'https://127.0.0.1:4174':'http://127.0.0.1:4174');res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers']||'apikey,authorization,content-type,x-client-info');res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  try{assert.equal(req.method,'POST');assert.match(req.url,speedRpcPath);const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=fixtureRpc(req.url.split('/').at(-1),JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
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
 const budget=assertStorefrontBudget(await measureStorefrontBudget(dist));
 // Identical-context f098 cold graph; removing the old delayed button offsets
 // all new initial glue. The actual animation remains a separate lazy chunk.
 assert.ok(budget.initialJsBytes<=683725,'CART_FLIGHT_ADDED_INITIAL_JS');
 assert.ok(budget.initialJsGzip<=187840,'CART_FLIGHT_ADDED_INITIAL_JS_TRANSFER');
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
  browser=await engine.launch({headless:true,proxy:{server:'http://127.0.0.1:4175',bypass:'<-loopback>'}});
  for(const width of[360,390,1440]){
   const context=await browser.newContext({viewport:{width,height:width===1440?1200:900},isMobile:width<500,hasTouch:true,serviceWorkers:'block',recordVideo:{dir:path.join(evidence,'video')}});
   const page=await context.newPage(),escaped=[],imageRequests=[],pageErrors=[];
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname!=='127.0.0.1'||!['4174','4176'].includes(url.port)){escaped.push(url.origin);return route.abort();}
    if(url.protocol==='https:'){url.protocol='http:';const response=await fetch(url,{method:req.method(),headers:req.headers(),body:req.postDataBuffer()??undefined});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
    return route.continue();
   });
   page.on('pageerror',e=>pageErrors.push(e.message));page.on('request',r=>{if(r.resourceType()==='image')imageRequests.push(r.url());});
   await page.addInitScript(()=>{
    window.flightProof={max:0,starts:[],finishes:[],cancellations:[],bounces:0,commits:[],statusCodes:[]};
    // Toasts auto-dismiss, and two unchanged completion callbacks may race.
    // Capture only fixed outcome codes from this fictional fixture, never DOM
    // text or customer inputs, so dismissal cannot erase the observation.
    document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{for(const node of document.querySelectorAll('[role="status"]')){const text=node.textContent;const code=text==='وصلت السلة إلى كامل المخزون المتاح من هذا الصنف.'?'STOCK':text===`تمت إضافة ${(1).toLocaleString('ar-JO')} طرد من منتج وهمي 2 سكاكر.`?'ADDED':null;if(code&&!window.flightProof.statusCodes.includes(code))window.flightProof.statusCodes.push(code);}}).observe(document.body,{childList:true,subtree:true,characterData:true}));
    const quantity=()=>JSON.parse(localStorage.getItem('nawasrah-wholesale-cart-v1')||'{}').items?.reduce((n,i)=>n+i.quantity,0)||0;
    const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){const result=set.call(this,k,v);if(k==='nawasrah-wholesale-cart-v1')window.flightProof.commits.push({at:performance.now(),quantity:quantity()});return result;};
    const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){
     const a=animate.call(this,frames,options);
     if(this.hasAttribute('data-cart-flight')){
      window.flightProof.max=Math.max(window.flightProof.max,document.querySelectorAll('[data-cart-flight]').length);
      const icon=[...document.querySelectorAll('[data-cart-target] svg')].find(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;});const rect=icon?.getBoundingClientRect(),end=/translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(frames.at(-1).transform);const endpointError=rect&&end?Math.hypot(parseFloat(this.style.left)+32+Number(end[1])-rect.left-rect.width/2,parseFloat(this.style.top)+32+Number(end[2])-rect.top-rect.height/2):Infinity;
      window.flightProof.starts.push({endpointError,at:performance.now(),quantity:quantity(),duration:options.duration,keys:Object.keys(frames[0]),image:this.dataset.cartFlightImage||'disc',pointerEvents:getComputedStyle(this).pointerEvents,hidden:this.getAttribute('aria-hidden')});
      a.finished.then(()=>window.flightProof.finishes.push(performance.now()),()=>window.flightProof.cancellations.push(performance.now()));
     }else if(this.closest('[data-cart-target]'))window.flightProof.bounces++;
     return a;
    };
   });
   const quantity=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('nawasrah-wholesale-cart-v1')||'{}').items?.reduce((n,i)=>n+i.quantity,0)||0);
   const proof=()=>page.evaluate(()=>window.flightProof);
   const search=async text=>{if(!await page.getByRole('searchbox').filter({visible:true}).count())await page.getByRole('button',{name:'فتح البحث',exact:true}).tap();await page.getByRole('searchbox').filter({visible:true}).first().fill(text);};
   const card=()=>page.getByTestId('catalog-products-grid').locator('article').filter({has:page.getByRole('heading',{name:speedProducts[0].nameAr,exact:true})});
   const plus=c=>c.getByRole('button',{name:/^(إضافة|زيادة) منتج وهمي.*(?:إلى|في) السلة$/u}).filter({visible:true});
   const resetProof=()=>page.evaluate(()=>{window.flightProof.max=0;window.flightProof.starts=[];window.flightProof.finishes=[];window.flightProof.cancellations=[];window.flightProof.bounces=0;window.flightProof.commits=[];window.flightProof.statusCodes=[];});
   try{
    await page.goto((name==='webkit'?'https:':'http:')+'//127.0.0.1:4174/products/');await page.getByTestId('catalog-products-grid').waitFor();await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/cartAdditionAnimation-')).length),0,'No animation request at first paint');
    await card().scrollIntoViewIfNeeded();await card().locator('img').evaluate(img=>img.decode());const imageBefore=[...imageRequests],displayedUrl=await card().locator('img').evaluate(img=>img.currentSrc);
    await page.screenshot({path:path.join(evidence,`${name}-${width}-before.png`)});
    await plus(card()).tap();
    // Actual touch plus four immediate live button clicks. WAAPI is not paused
    // or slowed, and the existing storage writer is never mocked or deferred.
    await card().evaluate(article=>{for(let n=0;n<4;n++)[...article.querySelectorAll('button')].find(b=>/^(إضافة|زيادة).* (إلى|في) السلة$/u.test(b.getAttribute('aria-label')||'')&&b.getClientRects().length).click();});
    await expect.poll(quantity).toBe(5);await expect.poll(async()=>(await proof()).starts.length).toBeGreaterThan(0);
    await expect(page.getByRole('status').filter({hasText:'تمت إضافة'})).toHaveCount(1);
    await page.screenshot({path:path.join(evidence,`${name}-${width}-flight.png`)});
    await expect(page.locator('[data-cart-flight]')).toHaveCount(0);
    await expect.poll(async()=>{const p=await proof();return p.finishes.length+p.cancellations.length;}).toBe(3);
    const rapid=await proof();assert.equal(rapid.max,3);assert.equal(rapid.starts.length,3);
    assert.ok(rapid.starts.every(s=>s.quantity>=1&&s.duration>=450&&s.duration<=650&&s.pointerEvents==='none'&&s.hidden==='true'&&s.image==='displayed'));
    assert.ok(rapid.starts.every(s=>s.keys.every(k=>['transform','opacity','offset'].includes(k))));
    assert.ok(rapid.starts.every(s=>s.endpointError<1),'Flight must land at the actual SVG icon centre, not the surrounding button');
    assert.ok(rapid.commits.find(c=>c.quantity===5)?.at<Math.min(...rapid.finishes,...rapid.cancellations),'Five commits precede every flight completion or cancellation');
    assert.equal(imageRequests.filter(url=>url===displayedUrl).length,imageBefore.filter(url=>url===displayedUrl).length,'Flight must not re-fetch its displayed image');
    assert.equal(imageRequests.length,new Set(imageRequests).size,'No repeated image downloads');
    await page.screenshot({path:path.join(evidence,`${name}-${width}-after.png`)});

    await resetProof();await page.emulateMedia({reducedMotion:'reduce'});await plus(card()).tap();await expect.poll(quantity).toBe(6);assert.equal((await proof()).starts.length,0);assert.equal((await proof()).bounces,0);await page.emulateMedia({reducedMotion:'no-preference'});
    await resetProof();await card().getByRole('button',{name:`عرض تفاصيل ${speedProducts[0].nameAr}`}).first().tap();const dialog=page.getByRole('dialog');await dialog.waitFor();
    await dialog.getByRole('region',{name:'إضافة طرد',exact:true}).getByRole('button',{name:/إضافة .* طرد من/u}).tap();
    await expect.poll(quantity).toBe(7);await expect.poll(async()=>(await proof()).bounces).toBeGreaterThan(0);assert.equal((await proof()).starts.length,0);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await resetProof();const noImage=page.getByTestId('catalog-products-grid').locator('article').filter({has:page.getByRole('heading',{name:speedProducts[1].nameAr,exact:true})});await plus(noImage).tap();await expect.poll(quantity).toBe(8);
    const visibleTarget=await page.locator('[data-cart-target] svg').evaluateAll(nodes=>nodes.some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;}));
    if(visibleTarget){await expect.poll(async()=>(await proof()).starts.length).toBe(1);assert.equal((await proof()).starts[0].image,'disc');}else{assert.equal((await proof()).starts.length,0,'Hidden cart target skips flight');}
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.locator('[data-cart-flight]')).toHaveCount(0);
    await resetProof();await page.locator('[data-cart-target="header"]').scrollIntoViewIfNeeded();await page.evaluate(()=>{window.injectedFailures=0;window.savedAnimate=Element.prototype.animate;Element.prototype.animate=()=>{window.injectedFailures++;throw Error('INTENTIONAL_DECORATION_FAILURE');};});await plus(noImage).evaluate(b=>b.click());await expect.poll(quantity).toBe(9);await expect.poll(()=>page.evaluate(()=>window.injectedFailures)).toBeGreaterThan(0);assert.equal(await page.locator('[data-cart-flight]').count(),0);await page.evaluate(()=>{Element.prototype.animate=undefined;});await plus(noImage).evaluate(b=>b.click());await expect.poll(quantity).toBe(10);assert.equal(await page.locator('[data-cart-flight]').count(),0);await page.evaluate(()=>{Element.prototype.animate=window.savedAnimate;});
    await resetProof();await page.locator('[data-cart-target]').evaluateAll(nodes=>nodes.forEach(n=>n.style.visibility='hidden'));
    await plus(noImage).evaluate(b=>b.click());await expect.poll(quantity).toBe(11);await expect.poll(async()=>(await proof()).bounces).toBeGreaterThan(0);assert.equal((await proof()).starts.length,0,'Hidden targets must not receive a flight');
    await page.locator('[data-cart-target]').evaluateAll(nodes=>nodes.forEach(n=>n.style.visibility=''));

    await resetProof();await search('FLIGHT-FAMILY');await page.getByRole('button',{name:`اختيار نكهة ${family.nameAr}`}).waitFor();await page.getByRole('button',{name:`اختيار نكهة ${family.nameAr}`}).tap();
    await page.getByRole('button',{name:'كوّن طردًا بالنكهات'}).tap();const builder=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:/اختر/u})});
    await builder.getByRole('button',{name:'زيادة تفاح',exact:true}).tap();await builder.getByRole('button',{name:'زيادة عنب',exact:true}).tap();await builder.getByRole('button',{name:'إضافة الطرد للسلة',exact:true}).tap();
    await expect.poll(quantity).toBe(12);await expect.poll(async()=>(await proof()).bounces).toBeGreaterThan(0);assert.equal((await proof()).starts.length,0);await page.keyboard.press('Escape');
    await search(speedProducts[0].sku);await card().waitFor();await card().getByRole('button',{name:`عرض تفاصيل ${speedProducts[0].nameAr}`}).first().tap();
    const parcels=page.getByRole('dialog').getByRole('region',{name:'إضافة طرد',exact:true});for(let n=0;n<12;n++)await parcels.getByRole('button',{name:'زيادة كمية طرد',exact:true}).tap();await parcels.getByRole('button',{name:/إضافة .* طرد من/u}).tap();await expect.poll(quantity).toBe(25);await page.keyboard.press('Escape');await resetProof();
    await expect(plus(card())).toBeDisabled();await plus(card()).evaluate(b=>b.click());assert.equal(await quantity(),25);assert.equal((await proof()).starts.length,0);assert.equal((await proof()).bounces,0);
    await search(speedProducts[2].sku);const last=page.getByTestId('catalog-products-grid').locator('article').filter({has:page.getByRole('heading',{name:speedProducts[2].nameAr,exact:true})});await last.waitFor();await page.locator('[data-cart-target="header"]').scrollIntoViewIfNeeded();await resetProof();
    // Two real handler calls before React's disabled state commits. The
    // existing serialized writer accepts one, rejects the stale second add.
    await plus(last).evaluate(button=>{button.click();button.click();});await expect.poll(quantity).toBe(26);
    // Both completions may update the same existing toast in either order.
    // Require one actual outcome's exact known copy, not an undefined order
    // between a successful add and a rejected stale click. The AST gate also
    // preserves the original rejection branch byte-for-byte after decoration.
    await expect.poll(async()=>(await proof()).statusCodes.some(code=>code==='STOCK'||code==='ADDED')).toBe(true);
    await expect.poll(async()=>(await proof()).starts.length+(await proof()).bounces).toBeGreaterThan(0);
    await expect(page.locator('[data-cart-flight]')).toHaveCount(0);const rejection=await proof();assert.equal(rejection.starts.length+Math.max(0,rejection.bounces-rejection.starts.length),1,'Rejected stale add must not animate or bounce');
    assert.deepEqual(escaped,[]);assert.deepEqual(pageErrors,[]);
    proofs.push({engine:name,width,height:width===1440?1200:900,rapid,quantity:26,hiddenTarget:true,dialogsNoFlight:true,reducedMotion:true,missingImage:true,decorativeFailureIndependent:true,stockRejection:true});
   }catch(error){await page.screenshot({path:path.join(evidence,`${name}-${width}-failure.png`)});await writeFile(path.join(evidence,'failure.json'),JSON.stringify({engine:name,width,error:error.message,proof:await proof(),pageErrors,escaped},null,2));console.error(JSON.stringify({evidence}));throw error;}
   finally{await context.close();}
  }
  await browser.close();browser=null;
 }
 assert.deepEqual(failures,[]);const guard=await fetch('http://127.0.0.1:4175/__network-guard/status').then(r=>r.json());assert.deepEqual(guard.escapedExternalRequests,[]);
 await writeFile(path.join(evidence,'proof.json'),JSON.stringify({ok:true,proofs,budget,guard},null,2));console.log(JSON.stringify({ok:true,evidence,proofs}));
}finally{await browser?.close();proxy?.kill();await Promise.all([api,site].filter(Boolean).map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));}
