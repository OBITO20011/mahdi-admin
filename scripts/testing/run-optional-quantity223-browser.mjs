// Real component/service/Edge/SQL integration on one fixed disposable DB.
// No target arguments,hosted network,owner demo or actual third-party messages.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {startPrices222Local} from './independent-prices222-local.mjs';
import {optionalQuantity223BrowserApi} from './optional-quantity223-browser-api.mjs';
import {canonicalLf,sha256} from './maintenance-db-contract.mjs';
assert.equal(process.argv.length,2,'QUANTITY223_BROWSER_NO_TARGET_ARGUMENTS');
const root=path.resolve(import.meta.dirname,'../..'),output=await mkdtemp(path.join(tmpdir(),'nawasrah-quantity223-browser-')),exec=promisify(execFile),started=performance.now();
const id=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const report={ok:false,output,hostedAccess:false,ownerDemoAccess:false,identity:'synthetic owner/AAL2 claims;actual role denial proved in separate PG gate',turnstile:'local stub;real gateway/quote/writer',calls:[]};let db,api;
const files=['docs/design/off-quantity-counter223/prototype223.sql','docs/design/off-quantity-counter223/lifecycle223.sql','docs/design/off-quantity-counter223/private-writers223.sql','scripts/testing/optional-quantity223-browser-api.mjs','scripts/testing/run-optional-quantity223-browser.mjs','e2e/optional-quantity223.fullstack.ts','src/features/operatingMode/OptionalQuantityPanel.tsx','src/features/products/ProductFormModal.tsx','src/features/pos/PosView.tsx','supabase/functions/submit-guest-order/index.ts'];
const hashes=()=>Promise.all(files.map(async file=>[file,sha256(canonicalLf(await readFile(path.join(root,file),'utf8')))]));const before=await hashes();
try{
 db=await startPrices222Local(222,'reference');
 await db.sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 await db.sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
 for(const file of files.slice(0,3))await db.sql(await readFile(path.join(root,file),'utf8'));
 await db.sql(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;
 SELECT public.lite1_set_mode2(false);SELECT public.set_go_live_main_branch_v1('${id(200)}');SELECT public.finish_go_live_setup_v1('إنهاء بداية التشغيل');SELECT public.open_cash_shift('${id(200)}',100000);
 DO $unit$ DECLARE p public.products;BEGIN SELECT * INTO STRICT p FROM public.products WHERE id='${id(103)}';PERFORM public.update_product_master_v6(p.id,p.updated_at,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.unit_id,1,0,p.unit_id,1,1000,0,0,NULL,true,NULL,1000,false);END $unit$;COMMIT;`);
 api=await optionalQuantity223BrowserApi(db,id);
 assert.deepEqual((await api.snapshot()).accounting,[0,0,0]);
 const config=path.join(output,'playwright.config.mjs'),slash=root.replaceAll('\\','/');
 const moduleUrl=pathToFileURL(path.join(root,'node_modules/@playwright/test/index.mjs')).href;
 await writeFile(config,`import{devices}from${JSON.stringify(moduleUrl)};const cwd=${JSON.stringify(slash)};export default{testDir:cwd+'/e2e',testMatch:'optional-quantity223.fullstack.ts',timeout:180000,retries:0,workers:1,reporter:[['list']],outputDir:${JSON.stringify(output.replaceAll('\\','/')+'/results')},use:{baseURL:'http://127.0.0.1:4173',serviceWorkers:'block',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{proxy:{server:'http://127.0.0.1:4175'}}},projects:[{name:'desktop-chromium',use:{...devices['Desktop Chrome'],locale:'ar-JO'}},{name:'mobile-webkit',use:{...devices['iPhone 13'],locale:'ar-JO'}}],webServer:[{command:'node scripts/testing/run-browser-network-guard.mjs 4175',cwd,url:'http://127.0.0.1:4175/health',reuseExistingServer:false,timeout:30000},{command:'node scripts/testing/run-isolated-vite.mjs admin 4173',cwd,url:'http://127.0.0.1:4173',reuseExistingServer:false,timeout:120000},{command:'node scripts/testing/run-isolated-vite.mjs customer 4174',cwd,url:'http://127.0.0.1:4174',reuseExistingServer:false,timeout:120000}]};\n`);
 const result=await exec(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',config],{cwd:root,windowsHide:true,maxBuffer:16*1024**2,env:{...process.env,QUANTITY223_CONTROL_URL:api.origin,QUANTITY223_CONTROL_TOKEN:api.token}});
 await writeFile(path.join(output,'browser.log'),result.stdout+'\n'+result.stderr);
 report.snapshot=await api.snapshot();assert.equal(report.snapshot.counter.enabled,false);assert.deepEqual(report.snapshot.accounting,[0,0,0]);
 assert.deepEqual(await hashes(),before,'QUANTITY223_BROWSER_SOURCES_CHANGED');report.ok=true;
}catch(error){
 report.error=String(error.message).slice(0,2000);process.exitCode=1;
 if(error.stdout||error.stderr)await writeFile(path.join(output,'browser.log'),String(error.stdout??'')+'\n'+String(error.stderr??''));
}finally{
 if(api){report.calls=api.calls;try{report.snapshot=await api.snapshot();}catch{report.snapshotUnavailable=true;}await api.stop();}
 if(db){try{await db.stop();report.cleanup=true;}catch(error){report.cleanup=false;report.cleanupError=String(error.message);process.exitCode=1;}}
 report.elapsedMs=Math.round(performance.now()-started);await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:report.ok,output,error:report.error,elapsedMs:report.elapsedMs,cleanup:report.cleanup}));
}
