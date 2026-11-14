// Disposable loopback test transport. Every modeled RPC executes real SQL
// with the actual role/claims. Identity is synthetic,not a GoTrue/TOTP proof.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {handleGuestOrderRequest} from '../../supabase/functions/submit-guest-order/index.ts';
import {TURNSTILE_ACTION} from '../../supabase/functions/submit-guest-order/security.ts';

const allowed=new Set(['get_public_storefront_settings','get_public_storefront_offers','lite1_catalog_page2','lite1_merchandising2','lite1_parcel_options2','lite1_preview_guest2',
 'search_admin_products','get_admin_product_page','get_open_pos_shift','get_pos_customer_page','get_expense_shift_center','lite1_pos_options2','lite1_product_availability2','lite1_pos2','get_or_create_pos_receipt_token','lite1_operational_orders_page2','get_operational_orders_page',
 'lite3_counter_context223','lite3_set_counter223','lite3_pos_quantity_check223','lite3_low_counters223',
 'authorize_guest_order_gateway','lite1_operating_mode','lite1_guest2','finalize_guest_order_gateway']);
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function optionalQuantity223BrowserApi(db,id){
 const token=randomBytes(32).toString('hex'),signatures=new Map(),calls=[];
 const json=async sql=>JSON.parse((await db.sql(sql)).split('\n').at(-1));
 async function rpc(name,args,role){
  assert.ok(allowed.has(name),'COUNTER_BROWSER_RPC_NOT_ALLOWLISTED:'+name);
  assert.ok(['anon','authenticated','service_role'].includes(role),'COUNTER_BROWSER_ROLE');
  assert.ok(args&&typeof args==='object'&&!Array.isArray(args),'COUNTER_BROWSER_ARGS');
  let signature=signatures.get(name);
  if(!signature){
   const found=await json(`SELECT COALESCE(jsonb_agg(jsonb_build_object('set',p.proretset,'args',(SELECT COALESCE(jsonb_object_agg(p.proargnames[n],format_type(p.proargtypes[n-1],NULL)),'{}') FROM generate_series(1,p.pronargs)n))),'[]') FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='public' AND p.proname=${q(name)};`);
   assert.equal(found.length,1,'COUNTER_BROWSER_UNIQUE_RPC_SIGNATURE:'+name);signature=found[0];signatures.set(name,signature);
  }
  const typed=(value,type)=>{
   if(value===null)return 'NULL::'+type;
   if(type==='jsonb'||type==='json')return q(JSON.stringify(value))+'::'+type;
   if(type.endsWith('[]')){
    assert.ok(Array.isArray(value),'COUNTER_BROWSER_ARRAY');
    assert.equal(type,'uuid[]','COUNTER_BROWSER_ARRAY_TYPE');
    assert.ok(value.every(item=>typeof item==='string'&&/^[0-9a-f-]{36}$/iu.test(item)),'COUNTER_BROWSER_UUID_ARRAY');
    return q('{'+value.join(',')+'}')+'::uuid[]';
   }
   assert.ok(['string','number','boolean'].includes(typeof value),'COUNTER_BROWSER_SCALAR');
   return q(value)+'::'+type;
  };
  const parameters=Object.entries(args).map(([key,value])=>{
   assert.ok(Object.hasOwn(signature.args,key),'COUNTER_BROWSER_UNKNOWN_ARGUMENT:'+name+':'+key);
   assert.match(key,/^[a-z][a-z0-9_]*$/u);return key+':='+typed(value,signature.args[key]);
  }).join(',');
  const call='public.'+name+'('+parameters+')',claims={role,...(role==='authenticated'?{sub:id(1),aal:'aal2'}:{})};
  const statement=signature.set?`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]') FROM ${call} r;`:`SELECT to_jsonb(${call});`;
  calls.push({name,role});
  return json(`BEGIN;SELECT set_config('request.jwt.claims',${q(JSON.stringify(claims))},true);SET LOCAL ROLE ${role};SET LOCAL statement_timeout='${role==='anon'?3:8}s';${statement}COMMIT;`);
 }
 const snapshot=()=>json(`SELECT jsonb_build_object('counter',(SELECT to_jsonb(c) FROM sales_lite3.quantity_counters c WHERE product_id='${id(103)}'),'orders',(SELECT count(*) FROM public.orders WHERE source='website'),'pos',(SELECT count(*) FROM public.orders WHERE source='pos'),'shortage',(SELECT count(*) FROM public.audit_logs WHERE action='OPTIONAL_QUANTITY_SHORTAGE'),'accounting',(SELECT jsonb_build_array((SELECT count(*) FROM public.inventory_balances),(SELECT count(*) FROM public.inventory_movements),(SELECT count(*) FROM public.order_inventory_reservations))));`);
 let origin;
 const edge=async body=>handleGuestOrderRequest(new Request(origin+'/functions/v1/submit-guest-order',{method:'POST',headers:{origin:'http://127.0.0.1:4174','content-type':'application/json','x-forwarded-for':'198.51.100.223'},body:JSON.stringify(body)}),{
  getEnv:name=>({SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:token,TURNSTILE_SECRET_KEY:token,GUEST_ORDER_HASH_SECRET:token,TURNSTILE_ALLOWED_HOSTNAMES:'quantity223.local.test'})[name],
  fetchImpl:async(input,init)=>{
   const url=new URL(String(input));
   if(url.origin==='https://challenges.cloudflare.com'&&url.pathname.endsWith('/siteverify'))return Response.json({success:true,action:TURNSTILE_ACTION,hostname:'quantity223.local.test',challenge_ts:new Date().toISOString()});
   assert.equal(url.origin,origin,'COUNTER_BROWSER_EDGE_NONLOCAL_REQUEST');
   const name=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/u)?.[1];assert.ok(name,'COUNTER_BROWSER_EDGE_FIXED_RPC');
   try{return Response.json(await rpc(name,JSON.parse(String(init?.body)), 'service_role'));}
   catch(error){const message=String(error.message).match(/ERROR:\s*([^\n]+)/u)?.[1]??'ISOLATED_RPC_FAILED';return Response.json({code:'P0001',message},{status:400});}
  },
 });
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');res.setHeader('access-control-allow-origin','*');
  if(req.headers['x-quantity-test-token']!==token){res.statusCode=403;res.end('{"code":"ISOLATED_CONTROL_REQUIRED"}');return;}
  try{
   const url=new URL(req.url,origin);let body='';for await(const part of req){body+=part;assert.ok(Buffer.byteLength(body)<=65536,'COUNTER_BROWSER_BODY_LIMIT');}
   if(req.method==='GET'&&url.pathname==='/snapshot'){res.end(JSON.stringify(await snapshot()));return;}
   if(req.method==='GET'&&url.pathname==='/fixture'){
    const products=await rpc('search_admin_products',{p_search:null,p_limit:24,p_category_id:null,p_purpose:'stockable',p_product_id:id(103)},'authenticated');
    const metadata=await json(`SELECT jsonb_build_object('units',(SELECT jsonb_agg(jsonb_build_object('id',id,'nameAr',name_ar,'code',code,'conversionFactor',1)) FROM public.units),'categories',(SELECT jsonb_agg(jsonb_build_object('id',id,'nameAr',name_ar,'icon','Package')) FROM public.categories));`);
    res.end(JSON.stringify({owner:id(1),product:products[0],branch:id(200),warehouse:id(201),...metadata}));return;
   }
   if(req.method==='GET'&&url.pathname==='/order-meta'){
    const order=url.searchParams.get('id');assert.match(order,/^[0-9a-f-]{36}$/iu);
    res.end(JSON.stringify(await json(`SELECT jsonb_build_object('created_at',created_at,'order_items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'base_unit_name_snapshot',i.base_unit_name_snapshot)) FROM public.order_items i WHERE i.order_id=o.id)) FROM public.orders o WHERE o.id=${q(order)}::UUID;`)));return;
   }
   if(req.method==='GET'&&url.pathname==='/product-reference-counts'){
    const column=url.searchParams.get('column');assert.ok(['category_id','brand_id','id,unit_id,purchase_unit_id,sale_unit_id'].includes(column),'COUNTER_BROWSER_REFERENCE_COLUMN');
    const fields=column.split(',').map(field=>q(field)+','+field).join(',');
    res.end(JSON.stringify(await json(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;SELECT COALESCE(jsonb_agg(jsonb_build_object(${fields})),'[]') FROM public.products WHERE is_active=true;COMMIT;`)));return;
   }
   if(req.method==='GET'&&['/table/orders','/table/order_items','/table/categories','/table/units','/table/brands','/table/warehouses','/table/branches'].includes(url.pathname)){
    const table=url.pathname.slice(7),filter=url.searchParams.get('filter');let where='';
    if(filter){const values=filter.startsWith('eq.')?[filter.slice(3)]:filter.startsWith('in.(')&&filter.endsWith(')')?filter.slice(4,-1).split(','):[];
     assert.ok(values.length>0&&values.every(value=>/^[0-9a-f-]{36}$/iu.test(value)),'COUNTER_BROWSER_TABLE_FILTER');
     where=' WHERE '+(table==='order_items'?'order_id':'id')+' IN('+values.map(value=>q(value)+'::UUID').join(',')+')';}
    res.end(JSON.stringify(await json(`BEGIN;SELECT set_config('request.jwt.claims','{"sub":"${id(1)}","role":"authenticated","aal":"aal2"}',true);SET LOCAL ROLE authenticated;SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM public.${table} t${where};COMMIT;`)));return;
   }
   if(req.method==='POST'&&url.pathname==='/edge'){const response=await edge(JSON.parse(body));res.statusCode=response.status;res.end(await response.text());return;}
   const name=url.pathname.match(/^\/rpc\/([a-z0-9_]+)$/u)?.[1];
   assert.ok(req.method==='POST'&&name,'COUNTER_BROWSER_ROUTE');
   const role=req.headers['x-quantity-test-role'];assert.ok(['anon','authenticated'].includes(role),'COUNTER_BROWSER_EXTERNAL_ROLE');
   res.end(JSON.stringify(await rpc(name,JSON.parse(body),role)));
  }catch(error){res.statusCode=400;const message=String(error.message).match(/ERROR:\s*([^\n]+)/u)?.[1]??String(error.message).split('\n')[0];res.end(JSON.stringify({code:'P0001',message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {origin,token,calls,snapshot,stop:()=>new Promise(resolve=>server.close(resolve))};
}
