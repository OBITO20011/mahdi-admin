// Actual disposable214 Auth/Storage/DB plus both browsers. No linked projects.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {executorFor,executeInput} from '../operations/build-empty-supabase.mjs';
import {startIsolatedVite} from './isolated-vite-server.mjs';
import {localTotp} from './local-totp.mjs';
const root=path.resolve(import.meta.dirname,'../..'),exec=promisify(execFile),cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const project='nawasrah-bulk-images-'+randomBytes(4).toString('hex')+'-test',output=await mkdtemp(path.join(tmpdir(),'nawasrah-bulk-images-'));
const executor=executorFor(['--container','supabase_db_'+project]),q=value=>"'"+String(value).replaceAll("'","''")+"'";
const sql=async text=>{const result=await executeInput(executor,text);assert.equal(result.code,0,'BULK_LOCAL_SQL_FAILED:'+result.stderr.slice(0,200));return result.stdout.trim();};
const json=async text=>JSON.parse(await sql(text));
const secrets=new Set(),sanitize=value=>{let text=String(value);for(const secret of secrets)if(secret)text=text.replaceAll(secret,'[local-test-credential]');return text;};
const report={schemaVersion:1,startedAt:new Date().toISOString(),output,ceiling:214,hostedConnections:0,applicationServiceRole:false};
let local,vite,control,stage='bootstrap';
try{
 const boot=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:{...process.env,NAWASRAH_ISOLATED_PROJECT_ID:project,NAWASRAH_MAX_MIGRATION:'214',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',NAWASRAH_SUPABASE_EXCLUDE:'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
 local=JSON.parse(boot.stdout).isolatedProjectRoot;
 await sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
 const status=JSON.parse((await exec(process.execPath,[cli,'status','-o','json','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:2*1024**2})).stdout),api=new URL(status.API_URL);
 assert.ok(['127.0.0.1','localhost'].includes(api.hostname));assert.equal(api.port,'25431');
 // This local-only admin client provisions fictional accounts;it is never sent
 // to Vite,browsers,application code,arguments or reports.
 secrets.add(status.SERVICE_ROLE_KEY);
 const fixtureAdmin=createClient(api.origin,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const make=()=>createClient(api.origin,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 stage='fixtures';
 const imageIds={};
 const baseUnit=await sql("SELECT id FROM public.units WHERE code<>'PCS' ORDER BY code LIMIT 1;");
 for(const suffix of ['C','W']){
  const master=randomUUID();
  for(const [sku,name,flavor,parent] of [['SUG-10-','سكر','',null],['PRG-','منتج نكهات','',null],['PRG-BBQ-','اسم تاريخي للنكهة يبقى كما هو','حار',master],['FAIL-','حالة رفض وهمية','',null],['LAST-','آخر صنف للاختبار','',null]]){
   const id=sku==='PRG-'?master:randomUUID();imageIds[sku+suffix]=id;
   await sql(`INSERT INTO public.products(id,sku,name_ar,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_purchase_price_in_minor_units,default_sale_price_in_minor_units,sale_price_in_minor_units,wholesale_price_in_minor_units,cost_price_in_minor_units,wac_cost_in_minor_units_exact,is_active,is_flavor_master,flavor_master_product_id,flavor_name_ar)
    VALUES(${q(id)},${q(sku+suffix)},${q(name)},${q(baseUnit)},${q(baseUnit)},${q(baseUnit)},10,10,0,15000,1500,1500,1001,1000.6,true,${sku==='PRG-'},${parent?q(parent):'NULL'},${flavor?q(flavor):'NULL'});`);
  }
 }
 const roleProduct=randomUUID();
 await sql(`INSERT INTO public.products(id,sku,name_ar,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,cost_price_in_minor_units,is_active)
  VALUES(${q(roleProduct)},'ROLE-TEST','صنف مخفي لاختبار الصلاحيات',${q(baseUnit)},${q(baseUnit)},NULL,1,1,0,9007199254740993,false);
  INSERT INTO public.products(sku,name_ar,unit_id,purchase_unit_id,sale_unit_id,units_per_purchase_unit,units_per_sale_unit,default_sale_price_in_minor_units,cost_price_in_minor_units,is_active)
  SELECT 'FILL-'||n,'صنف حشو وهمي '||n,${q(baseUnit)},${q(baseUnit)},${q(baseUnit)},1,1,2000,1000,true FROM generate_series(1,121) n;`);
 const jpeg=await readFile(path.join(root,'tests/fixtures/bulk-images/landscape.jpg'));
 const roleBefore=await sql(`SELECT to_jsonb(p)::text FROM public.products p WHERE id=${q(roleProduct)};`);
 const actors=[];let ownerSession;
 stage='actual-role-contracts';
 for(const role of ['owner','admin','manager','warehouse_keeper','cashier','accountant','view_only','none','inactive']){
  const email='bulk-'+role+'@example.test',password=randomUUID()+'aA1!';secrets.add(password);
  const created=await fixtureAdmin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(created.error,null,'LOCAL_ACTOR_CREATE_FAILED');const userId=created.data.user.id;
  const code=role==='inactive'?'owner':role;
  await sql(`INSERT INTO public.profiles(id,full_name,is_active) VALUES(${q(userId)},'حساب اختبار صور',${role!=='inactive'});${code==='none'?'':`INSERT INTO roles(code,name_ar) VALUES(${q(code)},${q(code)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(userId)},id FROM roles WHERE code=${q(code)};`}`);
  const client=make(),link=await fixtureAdmin.auth.admin.generateLink({type:'magiclink',email});assert.equal(link.error,null,'LOCAL_LINK_FAILED');secrets.add(link.data.properties.hashed_token);
  assert.equal((await client.auth.verifyOtp({token_hash:link.data.properties.hashed_token,type:'email'})).error,null,'LOCAL_OTP_FAILED');
  const factor=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Local bulk image proof',issuer:'Nawasrah local'});assert.equal(factor.error,null,'LOCAL_FACTOR_FAILED');secrets.add(factor.data.totp.secret);
  assert.equal((await client.auth.mfa.challengeAndVerify({factorId:factor.data.id,code:localTotp(factor.data.totp.secret)})).error,null,'LOCAL_MFA_FAILED');
  const session=(await client.auth.getSession()).data.session;secrets.add(session.access_token);secrets.add(session.refresh_token);
  if(role==='owner')ownerSession=session;
  const before=await sql('SELECT (SELECT count(*) FROM public.product_images)||\':\'||(SELECT count(*) FROM storage.objects);');
  const object=userId+'/'+randomUUID()+'.jpg',url=client.storage.from('product-images').getPublicUrl(object).data.publicUrl;
  const uploaded=await client.storage.from('product-images').upload(object,jpeg,{contentType:'image/jpeg'}),saved=await client.rpc('set_product_primary_image',{p_product_id:roleProduct,p_image_url:url});
  const allowed=['owner','admin','manager','warehouse_keeper'].includes(role);
  if(allowed){assert.equal(uploaded.error,null,role+':STORAGE');assert.equal(saved.error,null,role+':IMAGE_RPC');const reference=await client.from('product_images').select('id').eq('image_url',url).limit(1);assert.equal(reference.error,null,role+':REFERENCE_READ');assert.equal(reference.data.length,1,role+':REFERENCE_VISIBLE');}
  else{assert.ok(uploaded.error,role+':STORAGE_DENIED');assert.ok(saved.error,role+':IMAGE_RPC_DENIED');assert.equal(await sql('SELECT (SELECT count(*) FROM public.product_images)||\':\'||(SELECT count(*) FROM storage.objects);'),before,role+':ZERO_WRITES');}
  actors.push({role,allowed,realStorageHttp:true,realRpc:true,zeroWritesWhenDenied:!allowed});
 }
 const anonymous=make(),anonBefore=await sql('SELECT count(*) FROM public.product_images;');assert.ok((await anonymous.rpc('set_product_primary_image',{p_product_id:roleProduct,p_image_url:'https://example.test/not-written.jpg'})).error);assert.equal(await sql('SELECT count(*) FROM public.product_images;'),anonBefore);report.roles=actors;report.anonDenied=true;
 assert.equal(await sql(`SELECT to_jsonb(p)::text FROM public.products p WHERE id=${q(roleProduct)};`),roleBefore,'IMAGE_ROLE_PATH_CHANGED_PRODUCT_FIELDS');report.roleProductFieldsIdentical=true;
 stage='business-baseline';
 const snapshot=()=>json(`CREATE FUNCTION pg_temp.bulk_snapshot() RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE result jsonb:='{}';t record;value jsonb;BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('audit_logs','product_images') ORDER BY tablename LOOP EXECUTE format('SELECT jsonb_build_object(''rows'',count(*),''hash'',md5(COALESCE(string_agg(to_jsonb(row_data)::text,E''\\n'' ORDER BY to_jsonb(row_data)::text),''''))) FROM public.%I row_data',t.tablename) INTO value;result:=result||jsonb_build_object(t.tablename,value);END LOOP;RETURN result;END$$;SELECT pg_temp.bulk_snapshot();`);
 const before=await snapshot();report.protectedTables=Object.keys(before).length;
 // A fixture-only trigger supplies a deterministic transaction rollback. It is
 // removed before the final comparison;no migration or application RPC changes.
 await sql(`CREATE SCHEMA bulk_image_fixture;CREATE TABLE bulk_image_fixture.rejections(product_id uuid primary key);INSERT INTO bulk_image_fixture.rejections VALUES(${q(imageIds['FAIL-C'])}),(${q(imageIds['FAIL-W'])});
  CREATE FUNCTION bulk_image_fixture.reject_once() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$BEGIN IF EXISTS(SELECT 1 FROM bulk_image_fixture.rejections WHERE product_id=NEW.product_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_BULK_IMAGE_REJECTION';END IF;RETURN NEW;END$$;
  CREATE TRIGGER bulk_image_fixture_reject BEFORE INSERT ON public.product_images FOR EACH ROW EXECUTE FUNCTION bulk_image_fixture.reject_once();`);
 const nonce=randomUUID();secrets.add(nonce);
 control=createServer(async(req,res)=>{try{if(req.method!=='POST'||req.url!=='/enable-image-save'||req.headers['x-local-control']!==nonce){res.writeHead(403).end();return;}const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());if(!['FAIL-C','FAIL-W'].includes(body.sku)){res.writeHead(400).end();return;}await sql(`DELETE FROM bulk_image_fixture.rejections WHERE product_id=${q(imageIds[body.sku])};`);res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true}');}catch{res.writeHead(500).end();}});
 await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
 const controlUrl='http://127.0.0.1:'+control.address().port;
 stage='browser';
 vite=await startIsolatedVite({root,port:0,env:{VITE_SUPABASE_URL:api.origin,VITE_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY}});
 const browserEnv={...process.env,BULK_IMAGES_BASE_URL:'http://127.0.0.1:'+vite.server.httpServer.address().port,BULK_IMAGES_SESSION:JSON.stringify(ownerSession),BULK_IMAGES_CONTROL_URL:controlUrl,BULK_IMAGES_CONTROL_NONCE:nonce,BULK_IMAGES_BROWSER_OUTPUT:path.join(output,'browser')};
 try{const tested=await exec(process.execPath,[path.join(root,'node_modules/playwright/cli.js'),'test','--config','playwright.bulk-images.config.ts'],{cwd:root,windowsHide:true,maxBuffer:8*1024**2,env:browserEnv});await writeFile(path.join(output,'browser-sanitized.log'),sanitize(tested.stdout+tested.stderr));}
 catch(error){await writeFile(path.join(output,'browser-sanitized.log'),sanitize((error.stdout??'')+(error.stderr??'')));throw new Error('LOCAL_BULK_BROWSER_FAILED',{cause:error});}
 stage='strict-after';
 await sql('DROP TRIGGER bulk_image_fixture_reject ON public.product_images;DROP FUNCTION bulk_image_fixture.reject_once();DROP TABLE bulk_image_fixture.rejections;DROP SCHEMA bulk_image_fixture;');
 const after=await snapshot();assert.deepEqual(after,before,'BUSINESS_OR_CATALOG_DATA_CHANGED');
 const checks=await json(`SELECT jsonb_build_object('orphans',(SELECT count(*) FROM storage.objects o WHERE o.bucket_id='product-images' AND NOT EXISTS(SELECT 1 FROM public.product_images i WHERE i.image_url=${q(api.origin+'/storage/v1/object/public/product-images/')}||o.name)),
  'uploaded',(SELECT count(*) FROM storage.objects WHERE bucket_id='product-images'),'applicationImages',(SELECT count(*) FROM product_images WHERE product_id IN (${Object.values(imageIds).map(q).join(',')})),
  'doublePrimary',(SELECT count(*) FROM(SELECT product_id FROM product_images WHERE is_primary GROUP BY product_id HAVING count(*)>1) duplicates));`);
 assert.equal(checks.orphans,0,'ORPHAN_STORAGE_OBJECT');assert.equal(checks.doublePrimary,0);assert.equal(checks.applicationImages,8);report.storage=checks;
 report.ok=true;report.actualBrowserEngines=['Chromium','WebKit'];report.authMfa=true;report.businessDataIdentical=true;report.catalogFieldsAndWacIdentical=true;report.before=before;report.after=after;
}catch(error){report.ok=false;report.stage=stage;report.error=sanitize(error.message).split('\n')[0];process.exitCode=1;}
finally{await vite?.close();if(control)await new Promise(resolve=>control.close(resolve));if(local)await exec(process.execPath,[cli,'stop','--no-backup','--workdir',local],{cwd:root,windowsHide:true,maxBuffer:2*1024**2});report.endedAt=new Date().toISOString();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,output,engines:report.actualBrowserEngines,protectedTables:report.protectedTables,storage:report.storage}));}
