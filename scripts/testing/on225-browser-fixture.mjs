import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHmac,randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import {setTimeout as wait} from 'node:timers/promises';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {build,preview} from 'vite';
import path from 'node:path';
import {startInventory225Local} from './inventory225-local.mjs';
import {loadPinnedPostgrestImage} from './pinned-postgrest-image.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';

const exec=promisify(execFile);
const docker=(...args)=>exec('docker',args,{windowsHide:true,maxBuffer:16*1024**2});
const inspect=async name=>JSON.parse((await docker('inspect',name)).stdout)[0];
export const goldenId=n=>'92600000-0000-4000-8000-'+String(n).padStart(12,'0');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const product=goldenId(103),branch=goldenId(200),warehouse=goldenId(201),owner=goldenId(1);
const allowedReadTables=new Set(['branches','warehouses','units','brands','categories','products','suppliers',
  'purchase_orders','supplier_receipts','orders','order_items','profiles','customers','stock_notifications']);
const rpcName=/^\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)$/u;

// Build the actual screens so browser execution does not depend on hundreds of
// concurrent cold Vite transforms. Only the disposable loopback app is built.
async function startBuiltApp(root,port,env,input,proxy){
 const parent=await realpath(tmpdir());
 const outDir=await mkdtemp(path.join(parent,'nawasrah-on225-built-'));
 const clean=async()=>{
  assert.equal(path.dirname(await realpath(outDir)),parent);
  assert.ok(path.basename(outDir).startsWith('nawasrah-on225-built-'));
  await rm(outDir,{recursive:true,force:true});
 };
 const variables={...env,NAWASRAH_DEPLOYMENT_ENV:'',VITE_BROWSER_QA_ISOLATED:'true'};
 const before=new Map(Object.keys(variables).map(key=>[key,process.env[key]]));
 Object.assign(process.env,variables);
 try{
  await build({root,mode:'test',logLevel:'error',build:{outDir,emptyOutDir:false,
    ...(input?{rollupOptions:{input}}:{})}});
  const server=await preview({root,mode:'test',logLevel:'error',build:{outDir},
    plugins:[proxy],preview:{host:'127.0.0.1',port,strictPort:true}});
  return {close:async()=>{try{await server.close();}finally{await clean();}}};
 }catch(error){await clean();throw error;}
 finally{
  for(const [key,value] of before){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
}

export async function startOn225BrowserFixture(root,engine){
  assert.ok(['Chromium','WebKit'].includes(engine));
  const adminPort=engine==='Chromium'?4190:4192,shopPort=adminPort+1;
  const adminUrl='http://127.0.0.1:'+adminPort,shopUrl='http://127.0.0.1:'+shopPort;
  const navigations=[];
  const db=await startInventory225Local(225,'reference');
  const id=(await inspect(db.container)).Id;
  const network='supabase_network_nawasrah-inv225-reference-test';
  const rest='nawasrah-on225-golden-'+process.pid;
  let restId,attached=false,admin,shop;
  const close=async()=>{
    await shop?.close();
    await admin?.close();
    if(restId){assert.equal((await inspect(rest)).Id,restId);await docker('rm','-f',restId);}
    if(attached){assert.equal((await inspect(db.container)).Id,id);await docker('network','disconnect',network,id);}
    await db.stop();
  };
  try{
    await db.sql('SELECT cron.alter_job(jobid,active:=false) FROM cron.job;ALTER TABLE public.orders DISABLE TRIGGER trg_notify_new_website_order_push;');
    await db.sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
    await db.sql(`
      INSERT INTO public.units(id,code,name_ar) VALUES('${goldenId(225)}','ON225-GOLDEN-BOX','صندوق');
      UPDATE public.products SET purchase_unit_id='${goldenId(225)}',sale_unit_id='${goldenId(225)}',
        units_per_purchase_unit=12,units_per_sale_unit=12,default_purchase_price_in_minor_units=9600,
        default_sale_price_in_minor_units=12000,sale_price_in_minor_units=1000,wholesale_price_in_minor_units=1000,
        cost_price_in_minor_units=800,wac_cost_in_minor_units_exact=800 WHERE id='${product}';`);
    const sql=async input=>{
      const result=await executeInput(db.executor,input);
      assert.equal(result.code,0,result.stderr);
      return result.stdout.trim();
    };
    const json=async input=>JSON.parse((await sql(input)).split(/\r?\n/u).at(-1));
    const claims=role=>JSON.stringify(role==='service_role'?{role}:{role,sub:owner,aal:'aal2'});
    const rpc=(body,role='authenticated')=>json(`BEGIN;SET LOCAL statement_timeout='8s';
      SELECT set_config('request.jwt.claims',${q(claims(role))},true);SET LOCAL ROLE ${role};
      SELECT public.${body};COMMIT;`);
    await rpc(`set_go_live_main_branch_v1('${branch}')`);
    const history=await json("SELECT jsonb_build_array(max(version),count(*),(SELECT full_accounting FROM sales_lite1.mode)) FROM supabase_migrations.schema_migrations;");
    assert.deepEqual(history,['225',185,true]);
    const image=await loadPinnedPostgrestImage();
    const members=JSON.parse((await docker('network','inspect',network)).stdout)[0].Containers;
    assert.deepEqual(Object.keys(members??{}),[],'ON225_GOLDEN_OWN_NETWORK_REQUIRED');
    await docker('network','connect','--alias','db',network,id);
    attached=true;
    const secret=randomBytes(32).toString('hex');
    const jwt=role=>{
      const payload={...JSON.parse(claims(role)),exp:Math.floor(Date.now()/1000)+1800};
      if(role==='anon')delete payload.sub;
      const part=[{alg:'HS256',typ:'JWT'},payload].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
      return part+'.'+createHmac('sha256',secret).update(part).digest('base64url');
    };
    const ownerJwt=jwt('authenticated'),anonJwt=jwt('anon');
    restId=(await docker('run','-d','--name',rest,'--network',network,'-p','127.0.0.1::3000',
      '-e','PGRST_DB_URI=postgresql://authenticator:postgres@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public',
      '-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,image)).stdout.trim();
    const restPort=(await docker('port',restId,'3000/tcp')).stdout.trim().match(/^127\.0\.0\.1:(\d+)$/u)?.[1];
    assert.ok(restPort,'ON225_GOLDEN_REST_LOOPBACK_REQUIRED');
    const restUrl='http://127.0.0.1:'+restPort;
    const deadline=Date.now()+15000;
    while(true){
      try{if((await fetch(restUrl,{redirect:'error'})).ok)break;}catch{/* wait for the owned service */}
      assert.ok(Date.now()<deadline,'ON225_GOLDEN_REST_READY');
      await wait(100);
    }
    const metadata=await json(`SELECT jsonb_build_object(
      'branch',jsonb_build_object('id','${branch}','name','فرع اليوم الكامل','city','الرمثا','address','','phone',''),
      'warehouse',jsonb_build_object('id','${warehouse}','branchId','${branch}','name','مستودع اليوم','location',''),
      'units',(SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'nameAr',name_ar,'conversionFactor',1)) FROM units),
      'categories',(SELECT jsonb_agg(jsonb_build_object('id',id,'nameAr',name_ar,'icon','Package')) FROM categories));`);
    const calls=[];
    let originalOrderId=null;
    const proxy=(role)=>({
      name:'on225-golden-'+role,
      configurePreviewServer(server){
        server.middlewares.use(async(request,response,next)=>{
          const url=new URL(request.url??'/',adminUrl);
          if(url.pathname.endsWith('.html')||url.pathname==='/')response.once('finish',()=>navigations.push({pathname:url.pathname,status:response.statusCode}));
          const send=(status,value)=>{response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value));};
          try{
            if(role==='authenticated'&&url.pathname==='/__on225_fixture'){
              const reader=restUrl+'/rpc/search_admin_products';
              const found=await fetch(reader,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+ownerJwt,'content-type':'application/json'},
                body:JSON.stringify({p_search:null,p_limit:24,p_category_id:null,p_purpose:'stockable',p_product_id:product})});
              assert.ok(found.ok,'ON225_GOLDEN_FIXTURE_PRODUCT_READ');
              const rows=await found.json();
              assert.equal(rows.length,1);
              return send(200,{...metadata,ownerId:owner,product:rows[0],accessToken:ownerJwt});
            }
            if(role==='authenticated'&&url.pathname==='/__tb215_fixture'){
              assert.ok(originalOrderId);
              return send(200,{orderId:originalOrderId,ownerId:owner,accessToken:ownerJwt});
            }
            if(url.pathname.startsWith('/auth/'))return send(401,{message:'Synthetic local identity'});
            if(!url.pathname.startsWith('/rest/v1/'))return next();
            const rpc=rpcName.exec(url.pathname)?.[1];
            const table=!rpc?url.pathname.slice('/rest/v1/'.length):null;
            const permitted=rpc?(role==='authenticated'||rpc.startsWith('public_storefront_')||
              rpc.startsWith('get_public_')||rpc==='lite1_operating_mode'):
              role==='authenticated'&&allowedReadTables.has(table)&&request.method==='GET';
            assert.ok(permitted,'ON225_GOLDEN_UNEXPECTED_ENDPOINT:'+url.pathname);
            assert.ok(['GET','POST','HEAD'].includes(request.method));
            let body='';
            for await(const part of request){body+=part;assert.ok(Buffer.byteLength(body)<=65536);}
            const headers={authorization:'Bearer '+(role==='authenticated'?ownerJwt:anonJwt)};
            for(const key of ['accept','content-type','prefer','range'])if(typeof request.headers[key]==='string')headers[key]=request.headers[key];
            const result=await fetch(restUrl+url.pathname.slice('/rest/v1'.length)+url.search,{
              method:request.method,headers,redirect:'error',...(body?{body}:{}),
            });
            calls.push({role,name:rpc??table,status:result.status});
            response.statusCode=result.status;
            for(const key of ['content-type','content-range','preference-applied'])if(result.headers.has(key))response.setHeader(key,result.headers.get(key));
            response.end(await result.text());
          }catch(error){send(500,{message:String(error.message).split('\n')[0]});}
        });
      },
    });
    const env=origin=>({VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:anonJwt,VITE_SUPABASE_ANON_KEY:anonJwt});
    const entries=['on225-golden-harness','aftercare215-fullstack-harness'].map(name=>path.join(root,'e2e',name+'.html'));
    admin=await startBuiltApp(root,adminPort,env(adminUrl),entries,proxy('authenticated'));
    shop=await startBuiltApp(path.join(root,'customer-web'),shopPort,env('http://127.0.0.1:4176'),null,proxy('anon'));
    return {adminUrl,shopUrl,admin,shop,product,branch,warehouse,history,calls,navigations,sql,json,rpc,close,
      selectReturnOrder:orderId=>{assert.match(orderId,/^[0-9a-f-]{36}$/u);originalOrderId=orderId;}};
  }catch(error){
    await close();
    throw error;
  }
}
