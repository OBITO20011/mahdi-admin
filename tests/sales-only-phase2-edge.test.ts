import assert from 'node:assert/strict';
import test from 'node:test';
import {handleGuestOrderRequest} from '../supabase/functions/submit-guest-order/index.ts';
import {decodeOperatingMode} from '../supabase/functions/submit-guest-order/operatingMode.ts';
import {TURNSTILE_ACTION} from '../supabase/functions/submit-guest-order/security.ts';

const key='11111111-1111-4111-8111-111111111111',orderId='44444444-4444-4444-8444-444444444444';
const lines=[{commercial_line_kind:'base_unit',product_id:'33333333-3333-4333-8333-333333333333',base_quantity:2,expected_unit_price_in_minor_units:1000}];
const quote={subtotalInMinorUnits:2000,discountInMinorUnits:0,deliveryFeeInMinorUnits:1000,totalInMinorUnits:3000};
const body={contractVersion:'phase3-customer-reservation-v2',idempotencyKey:key,turnstileToken:'test-only-opaque-token',clientSessionId:'22222222-2222-4222-8222-222222222222',
 customer:{fullName:'مستلم وهمي',phone:'0791234567',governorate:'إربد',city:'الرمثا',area:'حي وهمي',street:'شارع وهمي'},items:lines,expectedQuote:quote,paymentMethod:'cash_on_delivery',deliveryZone:'inside_ramtha',fullAccounting:true};
const env=(name:string)=>({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'isolated-fixture-role',TURNSTILE_SECRET_KEY:'isolated-fixture-turnstile',GUEST_ORDER_HASH_SECRET:'isolated-fixture-hmac-long-enough',TURNSTILE_ALLOWED_HOSTNAMES:'nawasrah-store.pages.dev'}[name]);
function request(overrides:Record<string,unknown>={}){return new Request('http://127.0.0.1:54321/functions/v1/submit-guest-order',{method:'POST',headers:{origin:'http://127.0.0.1:4174','content-type':'application/json','x-forwarded-for':'198.51.100.44'},body:JSON.stringify({...body,...overrides})});}
test('strict mode decoder accepts booleanversion only;legacy missingRPC explicit;errors never assume full',()=>{
 assert.equal(decodeOperatingMode(true,200,{contractVersion:'sales-only-phase2-v1',fullAccounting:false}),false);
 assert.equal(decodeOperatingMode(false,404,{code:'PGRST202',message:'public.lite1_operating_mode missing'}),true);
 for(const [ok,status,payload] of [[true,200,{}],[true,200,{fullAccounting:false}],[true,200,{contractVersion:'sales-only-phase2-v1',fullAccounting:'false'}],[false,503,{}],[false,404,{code:'PGRST202',message:'another_function missing'}],[false,400,{code:'42501',message:'permission denied'}]] as const){
  assert.throws(()=>decodeOperatingMode(ok,status,payload),/OPERATING_MODE_UNVERIFIED/);
 }
});
test('actual Edge gates Turnstile+gateway beforetrusted mode;OFF ignoresclientmode anduses exactsame key/quote/actorhashes',async()=>{
 const calls:string[]=[],writes:Record<string,unknown>[]=[],finalized:Record<string,unknown>[]=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));calls.push(url.pathname);
  if(url.hostname==='challenges.cloudflare.com')return Response.json({success:true,action:TURNSTILE_ACTION,hostname:'nawasrah-store.pages.dev'});
  assert.equal(url.hostname,'127.0.0.1','ALL_NETWORK_MOCKED_NO_HOSTED_TARGET');
  const payload=JSON.parse(String(init?.body));
  if(url.pathname.endsWith('/authorize_guest_order_gateway'))return Response.json({allowed:true});
  if(url.pathname.endsWith('/lite1_operating_mode')){assert.deepEqual(payload,{p_guest_key:key});return Response.json({contractVersion:'sales-only-phase2-v1',fullAccounting:false});}
  if(url.pathname.endsWith('/lite1_guest2')){writes.push(payload);return Response.json({success:true,order_id:orderId,idempotent_replay:writes.length>1});}
  if(url.pathname.endsWith('/finalize_guest_order_gateway')){finalized.push(payload);return new Response(null,{status:204});}
  throw Error('UNEXPECTED_UPSTREAM');
 };
 for(let i=0;i<2;i++)assert.equal((await handleGuestOrderRequest(request(),{getEnv:env,fetchImpl})).status,200);
 assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].p_key,key);
 const submitted=writes[0].p_request as Record<string,unknown>;
 assert.deepEqual(submitted.lines,lines);assert.deepEqual(submitted.expectedQuote,quote);
 assert.match(String(submitted.phoneHash),/^[a-f0-9]{64}$/);assert.match(String(submitted.sessionHash),/^[a-f0-9]{64}$/);
 assert.equal('fullAccounting' in submitted,false);assert.equal('turnstileToken' in submitted,false);
 assert.ok(calls.indexOf('/turnstile/v0/siteverify')<calls.indexOf('/rest/v1/rpc/authorize_guest_order_gateway'));
 assert.ok(calls.indexOf('/rest/v1/rpc/authorize_guest_order_gateway')<calls.indexOf('/rest/v1/rpc/lite1_operating_mode'));
 assert.ok(finalized.every(x=>x.p_order_id===orderId&&x.p_outcome==='succeeded'));
});
test('mode unavailable/malformed/forbidden makes no writercall andfinalizes asgatewayerror;Turnstile failure stopsbeforemode',async()=>{
 for(const scenario of ['network','malformed','forbidden','turnstile','rate']){
  const calls:string[]=[],outcomes:unknown[]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
   const path=new URL(String(input)).pathname;calls.push(path);
   if(path.endsWith('/siteverify'))return Response.json({success:scenario!=='turnstile',action:TURNSTILE_ACTION,hostname:'nawasrah-store.pages.dev'});
   if(path.endsWith('/authorize_guest_order_gateway'))return Response.json({allowed:scenario!=='rate'});
   if(path.endsWith('/lite1_operating_mode')){
    if(scenario==='network')throw Error('synthetic transport error');
    return Response.json(scenario==='forbidden'?{code:'42501'}:{fullAccounting:false},{status:scenario==='forbidden'?403:200});
   }
   if(path.endsWith('/finalize_guest_order_gateway')){outcomes.push(JSON.parse(String(init?.body)).p_outcome);return new Response(null,{status:204});}
   throw Error('WRITER_MUST_NOT_BE_CALLED');
  };
  const response=await handleGuestOrderRequest(request(),{getEnv:env,fetchImpl});assert.equal(response.status,scenario==='turnstile'?400:scenario==='rate'?429:503);
  assert.ok(!calls.some(x=>x.endsWith('/lite1_guest2')||x.endsWith('/submit_guest_customer_order_v2')));
  if(['turnstile','rate'].includes(scenario))assert.ok(!calls.some(x=>x.endsWith('/lite1_operating_mode')));else assert.deepEqual(outcomes,['gateway_error']);
 }
});
test('fullmode keeps existing RPC payload andcannotbe switchedOFF byclient',async()=>{
 let submitted:Record<string,unknown>|undefined;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith('/siteverify'))return Response.json({success:true,action:TURNSTILE_ACTION,hostname:'nawasrah-store.pages.dev'});
  if(path.endsWith('/authorize_guest_order_gateway'))return Response.json({allowed:true});
  if(path.endsWith('/lite1_operating_mode'))return Response.json({contractVersion:'sales-only-phase2-v1',fullAccounting:true});
  if(path.endsWith('/submit_guest_customer_order_v2')){submitted=JSON.parse(String(init?.body));return Response.json({success:true,order_id:orderId});}
  if(path.endsWith('/finalize_guest_order_gateway'))return new Response(null,{status:204});
  throw Error('UNEXPECTED_UPSTREAM');
 };
 assert.equal((await handleGuestOrderRequest(request({fullAccounting:false}),{getEnv:env,fetchImpl})).status,200);
 assert.equal(submitted?.p_idempotency_key,key);assert.deepEqual(submitted?.p_lines,lines);assert.equal(submitted?.p_expected_total_in_minor_units,3000);
});

test('optional OFF quantity refusal uses a fixed public message without disclosing a count or internal error',async()=>{
 for(const fullAccounting of [false,true]){
  const finalized:Record<string,unknown>[]=[];
  const response=await handleGuestOrderRequest(request(),{getEnv:env,fetchImpl:async(input,init)=>{
   const path=new URL(String(input)).pathname;
   if(path.endsWith('/siteverify'))return Response.json({success:true,action:TURNSTILE_ACTION,hostname:'nawasrah-store.pages.dev'});
   if(path.endsWith('/authorize_guest_order_gateway'))return Response.json({allowed:true});
   if(path.endsWith('/lite1_operating_mode'))return Response.json({contractVersion:'sales-only-phase2-v1',fullAccounting});
   if(path.endsWith(fullAccounting?'/submit_guest_customer_order_v2':'/lite1_guest2'))return Response.json({code:'P0001',message:'QUANTITY223_INSUFFICIENT'},{status:400});
   if(path.endsWith('/finalize_guest_order_gateway')){finalized.push(JSON.parse(String(init?.body)));return new Response(null,{status:204});}
   throw Error('UNEXPECTED_UPSTREAM');
  }});
  assert.equal(response.status,400);assert.deepEqual(finalized,[{p_idempotency_key:key,p_outcome:'order_rejected',p_order_id:null}]);
  assert.deepEqual(await response.json(),fullAccounting?{error:'تعذر إكمال الطلب بهذه البيانات. راجع الكميات وحاول مرة أخرى.',code:'order_rejected'}:
   {error:'الكمية المطلوبة غير متوفرة حالياً، قلّل الكمية.',code:'quantity_unavailable'});
 }
});
