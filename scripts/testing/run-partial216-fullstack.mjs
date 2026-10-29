// Real POS/controller/recovery -> local HTTP/PostgREST -> literal216.
// Only identity/session protocol is synthetic;no business call is mocked.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createHmac,randomUUID} from 'node:crypto';
import {chromium,webkit,expect} from '@playwright/test';
import {aftercare215Context} from './aftercare215-context.mjs';
import {startIsolatedVite} from './isolated-vite-server.mjs';
import {loadPinnedPostgrestImage} from './pinned-postgrest-image.mjs';
import {readVerificationSourceFreeze,assertVerificationSourceFreeze} from './verification-source-freeze.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-tb215-test',rest='nawasrah-partial216-ui-rest',url='http://127.0.0.1:4188',restUrl='http://127.0.0.1:25423';
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-partial216-fullstack-'));
const report={output,hostedConnections:0,authScope:'synthetic local JWT identity;real SQL/RLS/role/MFA guards',cases:[]};
let local,vite,restStarted=false,fixture,browser,lastPage,stage='bootstrap',loseNext=false,committedResponses=[];
const counts={},secret='isolated-table-access-audit-signing-material-only';
const jwt=claims=>{const parts=[{alg:'HS256',typ:'JWT'},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url'));return parts.join('.')+'.'+createHmac('sha256',secret).update(parts.join('.')).digest('base64url');};
try{
 const frozen=await readVerificationSourceFreeze(root);
 const boot=await exec(process.execPath,['scripts/testing/bootstrap-isolated-supabase.mjs'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'216',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 const c=aftercare215Context('supabase_db_'+project);await c.initialize();
 const image=await loadPinnedPostgrestImage();
 await exec('docker',['run','-d','--name',rest,'--network','supabase_network_'+project,'-p','127.0.0.1:25423:3000','-e','PGRST_DB_URI=postgresql://authenticator:postgres@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,image],{windowsHide:true});restStarted=true;
 const deadline=Date.now()+15000;while(true){try{if((await fetch(restUrl)).ok)break;}catch{/* Local readiness only. */}assert.ok(Date.now()<deadline,'LOCAL_POSTGREST_READINESS');await new Promise(r=>setTimeout(r,100));}
 const accessToken=jwt({sub:c.owner,role:'authenticated',aal:'aal2',exp:Math.floor(Date.now()/1000)+3600});
 const proxy={name:'tc216-local-only',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url==='/__tc216_fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}
  if(!req.url?.startsWith('/rest/v1/'))return next();
  try{
   const name=req.url.split('?')[0].split('/').at(-1);counts[name]=(counts[name]??0)+1;
   let body='';for await(const part of req)body+=part;
   const response=await fetch(restUrl+req.url.slice('/rest/v1'.length),{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),'Content-Type':'application/json',Accept:req.headers.accept??'application/json'},...(body?{body}:{})});
   const text=await response.text();
   if(name==='create_pos_sale_with_initial_payment_v1'&&response.ok){committedResponses.push(JSON.parse(text));if(loseNext){loseNext=false;res.statusCode=502;res.end('{"message":"LOCAL_SIMULATED_LOST_REPLY"}');return;}}
   res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')??'application/json');res.end(text);
  }catch{res.statusCode=500;res.end('{"message":"LOCAL_PROXY_FAILED"}');}
 });}};
 vite=await startIsolatedVite({root,port:4188,env:{VITE_SUPABASE_URL:url,VITE_SUPABASE_ANON_KEY:jwt({role:'anon',exp:Math.floor(Date.now()/1000)+3600})},config:{plugins:[proxy]}});
 let sample=0;
 for(const[engine,type]of[['Chromium',chromium],['WebKit',webkit]]){browser=await type.launch();
  for(const method of['cash','cliq']){
   stage=engine+'-'+method;const pid=randomUUID(),sku='HTTP216-'+randomUUID(),name='صنف HTTP216 '+(++sample);
   await c.sql(`INSERT INTO products(id,sku,name_ar,category_id,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,sale_price_in_minor_units,default_sale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,parcel_only)SELECT ${c.q(pid)},${c.q(sku)},${c.q(name)},category_id,unit_id,purchase_unit_id,sale_unit_id,1,1,100000,100000,0,0,true,false,false FROM products WHERE id=${c.q(c.id(103))};`);
   await c.receive(pid,20,500);fixture={ownerId:c.owner,accessToken,branch:c.branch,warehouse:c.warehouse};
   const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),violations=[];lastPage=page;
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===url)return route.continue();violations.push(u.origin);return route.abort();});
   await page.goto(url+'/e2e/partial216-fullstack-harness.html');
   await page.getByLabel('البحث في منتجات نقطة البيع',{exact:true}).fill(sku);
   const card=page.locator(`[data-pos-product="${pid}"]`);await expect(card).toBeVisible();await card.getByRole('button',{name:'إضافة باكيت من '+name,exact:true}).click();
   const open=page.getByRole('button',{name:'مراجعة السلة والعميل',exact:true});if(await open.isVisible())await open.click();
   await page.getByRole('radio',{name:'دين',exact:true}).filter({visible:true}).click();
   const customerName='زبون HTTP216 '+sample,phone='07900000'+String(sample).padStart(2,'0'),beforeSave=counts.save_customer??0;
   await page.getByRole('button',{name:'زبون جديد سريع',exact:true}).click();
   await page.getByLabel('اسم العميل أو المحل *',{exact:true}).fill(customerName);await page.getByLabel('رقم الهاتف *',{exact:true}).fill(phone);
   await page.getByRole('button',{name:'حفظ واختيار العميل',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'زبون جديد سريع'})).toHaveCount(0);
   const customerId=await c.json(`SELECT to_jsonb(id) FROM customers WHERE full_name=${c.q(customerName)};`);assert.match(customerId,/^[0-9a-f-]{36}$/);
   await expect(page.getByRole('combobox',{name:'اختيار العميل'})).toHaveValue(customerId);assert.equal(counts.save_customer,beforeSave+1);
   await page.getByLabel('المدفوع الآن',{exact:true}).fill('60.000');await page.getByRole('radiogroup',{name:'طريقة المدفوع الآن'}).getByRole('radio',{name:method==='cash'?'كاش':'CliQ',exact:true}).click();
   if(method==='cliq')await page.getByLabel('مرجع CliQ (اختياري)',{exact:true}).fill('LOCAL216-HTTP');
   await expect(page.locator('#pos-initial-paid-help')).toContainText('40.000');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const before=await c.facts(),partialCount=counts.create_pos_sale_with_initial_payment_v1??0,oldCount=counts.create_pos_sale_v2??0;
   committedResponses=[];loseNext=method==='cliq';await page.locator('[data-testid="pos-complete-sale"]:visible').click();
   if(method==='cliq'){
    const recover=page.getByRole('button',{name:'استرجاع محاولة البيع',exact:true});await expect(recover).toBeEnabled();
    await page.getByRole('button',{name:'رجوع للبيع',exact:true}).click();
    await c.rpc(`get_or_create_pos_receipt_token(${c.q(committedResponses[0].orderId)})`);const saved=await c.fingerprint();await recover.click();await expect(page.getByTestId('sale-receipt-document')).toBeVisible();assert.deepEqual(await c.fingerprint(),saved,'LOST_REPLY_RECOVERY_ZERO_WRITES');
   }
   const receipt=page.getByTestId('sale-receipt-document');await expect(receipt).toBeVisible();await expect(receipt).toContainText('60.000');await expect(receipt).toContainText('الباقي على الحساب');await expect(receipt).toContainText('40.000');
   assert.equal(counts.create_pos_sale_v2??0,oldCount);assert.equal(counts.create_pos_sale_with_initial_payment_v1,partialCount+(method==='cliq'?2:1));
   const sale=committedResponses[0],after=await c.facts();assert.equal(sale.totalInMinorUnits,100000);assert.equal(sale.amountPaidInMinorUnits,60000);assert.equal(sale.remainingInMinorUnits,40000);
   assert.equal(after.sales.netSalesInMinorUnits-before.sales.netSalesInMinorUnits,100000);assert.equal(after.sales.netProfitInMinorUnits-before.sales.netProfitInMinorUnits,99500);assert.equal((await c.stock(pid)).quantity,19);
   assert.equal(Number(await c.sql(`SELECT count(*) FROM customer_payments WHERE order_id=${c.q(sale.orderId)};`)),1);
   assert.equal(Number(await c.sql(`SELECT count(*) FROM pos216_initial_payments WHERE order_id=${c.q(sale.orderId)};`)),1);
   await page.screenshot({path:path.join(output,engine+'-'+method+'-390.png'),fullPage:true});assert.deepEqual(violations,[]);
   report.cases.push({engine,method,quickCustomerReal:true,oneSale:true,onePayment:true,total:100000,paid:60000,due:40000,stockDelta:-1,profit:99500,lostReplyRecovery:method==='cliq',hostedConnections:0});console.log(JSON.stringify({stage,ok:true}));await context.close();lastPage=null;
  }await browser.close();browser=null;
 }
 assertVerificationSourceFreeze(frozen,await readVerificationSourceFreeze(root));report.repositoryStayedFrozen=true;report.ok=true;
}catch(error){Object.assign(report,{ok:false,stage,error:error.message});if(lastPage&&!lastPage.isClosed())try{await lastPage.screenshot({path:path.join(output,'failed-local-ui.png'),fullPage:true});}catch{/* Preserve the original failure. */}process.exitCode=1;}
finally{await browser?.close();await vite?.close();if(restStarted)await exec('docker',['rm','-f',rest],{windowsHide:true});if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
