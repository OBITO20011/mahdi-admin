// Real public RPC/SELECT transport for the fixed isolated product-template runner.
// No hosted URL/client,AuthAdmin,service_role or arbitrary SQL endpoint.
import assert from 'node:assert/strict';import vm from 'node:vm';import path from 'node:path';import{build}from'esbuild';import{webcrypto}from'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const functions=new Set(['get_go_live_setup_status_v1','import_go_live_products_v1','create_product_family_with_flavors_v2','update_product_master_v5','update_product_flavor_v2']);
const tables=new Set(['products','categories','units','brands','warehouses']);
const q=v=>v===null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
export async function productWorkbookDbTransport({json,auth,actor,container}){
 assert.equal(container,'supabase_db_nawasrah-product-template-test');
 let loseCreate=false,loseWrite=false,loseBarcode=false;const calls=[];
 const types=await json("SELECT jsonb_object_agg(p.proname,(SELECT jsonb_object_agg(p.proargnames[g],format_type(p.proargtypes[g-1],NULL)) FROM generate_series(1,p.pronargs)g)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('get_go_live_setup_status_v1','import_go_live_products_v1','create_product_family_with_flavors_v2','update_product_master_v5','update_product_flavor_v2');");
 const db={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async(name,args={})=>{
  assert.ok(functions.has(name));const signature=types[name]??{};const parameters=Object.entries(args).map(([key,value])=>{assert.ok(Object.hasOwn(signature,key),key);const type=signature[key];assert.match(type,/^(?:text|jsonb|boolean|uuid|integer|bigint|timestamp with time zone)$/u);return key+':='+q(type==='jsonb'?JSON.stringify(value):value)+'::'+type;}).join(',');
  try{const data=await json(auth('SELECT public.'+name+'('+parameters+');'));calls.push({name,success:true});if((loseCreate&&name==='create_product_family_with_flavors_v2')||(loseWrite&&name==='update_product_master_v5'&&args.p_parcel_only===null)||(loseBarcode&&name==='update_product_flavor_v2')){loseCreate=false;loseWrite=false;loseBarcode=false;return{data:null,error:{code:'LOCAL_LOST_RESPONSE'}};}return{data,error:null};}catch(error){calls.push({name,success:false});return{data:null,error:{code:'LOCAL_RPC_REFUSED',message:error.message}};}
 },from:table=>{
  assert.ok(tables.has(table));let projection='id',filters=[],from=0,limit=500,single=false;
  const run=async()=>{assert.match(projection,/^[a-z_,]+$/u);const columns=projection.split(',').map(c=>'"'+c+'"').join(',');const where=filters.length?' WHERE '+filters.join(' AND '):'';
   try{const data=await json(auth(`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]') FROM(SELECT ${columns} FROM public.${table}${where} ORDER BY id LIMIT ${limit} OFFSET ${from})t;`));return single?data.length===1?{data:data[0],error:null}:{data:null,error:{code:'LOCAL_SINGLE_REFUSED'}}:{data,error:null};}catch{return{data:null,error:{code:'LOCAL_SELECT_REFUSED'}};}};
  const query={select:columns=>{projection=columns;return query;},order:column=>{assert.equal(column,'id');return query;},range:(a,b)=>{assert.ok(Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=a&&b-a<500);from=a;limit=b-a+1;return query;},eq:(column,value)=>{assert.match(column,/^[a-z_]+$/u);filters.push('"'+column+'"='+q(value));return query;},limit:n=>{assert.ok(Number.isSafeInteger(n)&&n>=1&&n<=500);limit=n;return query;},single:()=>{single=true;return query;},then:(resolve,reject)=>run().then(resolve,reject)};return query;
 }};
 const compile=entry=>build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'fixed-local-database',setup(b){b.onResolve({filter:/lib\/supabase$/},()=>({path:'client',namespace:'local-only'}));b.onResolve({filter:/^\.\/goLive\.service$/},()=>({path:'status',namespace:'local-only'}));b.onLoad({filter:/.*/,namespace:'local-only'},a=>({contents:a.path==='client'?"export const supabase=globalThis.__DB,isSupabaseConfigured=true,sanitizedSupabaseUrl='http://127.0.0.1:25431';":"export async function fetchGoLiveStatus(){const r=await globalThis.__DB.rpc('get_go_live_setup_status_v1',{});if(r.error)throw Error('LOCAL_OWNER_STATUS_REFUSED');return r.data;}",loader:'js'}));}}]});
 const load=async entry=>{const module={exports:{}};vm.runInContext((await compile(entry)).outputFiles[0].text,vm.createContext({__DB:db,module,exports:module.exports,crypto:webcrypto,TextEncoder,TextDecoder,structuredClone}));return module.exports;};
 const service=await load('src/services/supabase/productWorkbook.service.ts'),barcodeService=await load('src/services/supabase/productFamilyBarcodes.service.ts');
 const entries=new Map();const storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,getItem:k=>entries.get(k)??null,setItem:(k,v)=>{entries.set(k,v);},removeItem:k=>{entries.delete(k);},clear:()=>entries.clear()};
 return{service,barcodeService,storage,calls,loseBarcode:()=>{loseBarcode=true;},loseCreate:()=>{loseCreate=true;},loseWrite:()=>{loseWrite=true;}};
}
