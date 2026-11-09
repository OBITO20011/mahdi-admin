import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertFrozenFunctions} from './sales-only-phase1-bridges.mjs';
import {functionCatalogSql} from './sales-only-phase1-runtime.mjs';
import {phase2PrototypeSql} from './sales-only-phase2-installer.mjs';
import {tsImport} from 'tsx/esm/api';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';

export async function verifyCommercialGuest(c,report){
 const {sql,json,rpc,id,q,j,executor}=c;
 const rows=await json(functionCatalogSql);
 await sql(phase2PrototypeSql(rows));
 const {parseSalesOnlyOrderDetails}=await tsImport('../../src/services/supabase/salesOnlyOrderContext.ts',import.meta.url);
 assertFrozenFunctions(rows,await json(functionCatalogSql));
 const config=(await rpc(`save_product_parcel_configuration_v1(${q(id(100))},'configurable_mix',true,5,ARRAY[${q(id(101))},${q(id(102))}]::UUID[])`)).configuration;
 await rpc("set_configurable_parcel_feature_state_v1('ENABLED')");
 assert.deepEqual(await rpc('lite1_operating_mode()',null,'anon'),{contractVersion:'sales-only-phase2-v1',fullAccounting:true});
 let aalFailure;try{await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal1'})}::text,true);SET LOCAL ROLE authenticated;SELECT public.lite1_set_mode2(false);COMMIT;`);}catch(error){aalFailure=error;}
 assert.ok(aalFailure);assert.match(aalFailure.message,/LITE2_OWNER_AAL2_REQUIRED/);
 await rpc('lite1_set_mode2(false)');
 assert.deepEqual(await rpc('lite1_operating_mode()',null,'service_role'),{contractVersion:'sales-only-phase2-v1',fullAccounting:false});
 await sql(`INSERT INTO public.customer_addresses(id,customer_id,governorate,city,area,street,is_default) VALUES(${q(id(700))},${q(id(401))},'إربد','الرمثا','حي البطاقة','شارع البطاقة',true);`);
 const card=()=>json(`SELECT to_jsonb(c) FROM public.customers c WHERE id=${q(id(401))};`);
 const defaultAddress=()=>json(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${q(id(700))};`);
 const inventory=()=>json(`SELECT jsonb_build_object('moves',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_movements x),'reservations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.order_inventory_reservations x),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.inventory_balances x),'costs',(SELECT jsonb_agg(jsonb_build_array(id,cost_price_in_minor_units,wac_cost_in_minor_units_exact) ORDER BY id) FROM public.products));`);
 const originalCard=await card(),originalAddress=await defaultAddress(),originalInventory=await inventory();
 const base={commercial_line_kind:'base_unit',product_id:id(103),base_quantity:3,expected_unit_price_in_minor_units:1000};
 const parcel={commercial_line_kind:'legacy_single_sku_parcel',product_id:id(103),parcel_quantity:2,units_per_parcel:5,expected_unit_price_in_minor_units:4500};
 const mixed={commercial_line_kind:'configurable_parcel',family_product_id:id(100),parcel_configuration_id:config.id,configuration_revision:config.configuration_revision,expected_unit_price_in_minor_units:5000,parcel_instances:[{components:[{product_id:id(101),base_quantity:2},{product_id:id(102),base_quantity:3}]}]};
 let sequence=0;
 const request=async({lines=[base],phone='079660'+String(6000+ ++sequence),promotion=null,zone='inside_ramtha',method='cash_on_delivery'}={})=>{
  const plan=await json(`BEGIN;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);SELECT sales_lite2.plan(${j(lines)},'customer_v2',0,${q(promotion)},${q(phone)},${q(zone)});COMMIT;`);
  return {phoneHash:'c'.repeat(64),sessionHash:'d'.repeat(64),recipient:{fullName:'مستلم وهمي مختلف',phone,governorate:'إربد',city:'الرمثا',area:'حي التوصيل',street:'شارع التوصيل'},lines,promotionCode:promotion,paymentMethod:method,deliveryZone:zone,expectedQuote:Object.fromEntries(Object.entries(plan).filter(([key])=>key!=='lines'))};
 };
 const guest=(r,key=randomUUID())=>rpc(`lite1_guest2(${j(r)},${q(key)})`,null,'service_role');
 const fail=async(r,pattern,key=randomUUID(),role='service_role')=>{let e;try{await rpc(`lite1_guest2(${j(r)},${q(key)})`,null,role);}catch(error){e=error;}assert.ok(e,'EXPECTED_GUEST_REFUSAL');assert.match(String(e.message),pattern);};
 const firstRequest=await request({phone:'0796600401'}),firstKey=randomUUID(),first=await guest(firstRequest,firstKey);
 const recipientProof=await rpc(`lite1_order_details2(${q(first.order_id)})`),recipientView=parseSalesOnlyOrderDetails(recipientProof,first.order_id);
 assert.equal(recipientView.recipientProposal.proposed,true);assert.equal(recipientView.recipientProposal.recipient.fullName,firstRequest.recipient.fullName);assert.equal(recipientView.recipientProposal.customerCard.fullName,originalCard.full_name);
 assert.equal(recipientView.amountDue,first.total/1000);assert.doesNotMatch(JSON.stringify(recipientProof),/phoneHash|sessionHash|customerNotes|wac|cogs|profit/);
 assert.equal(first.customer_id,id(401));assert.equal(first.customer_reused,true);assert.equal(first.total,4000);assert.equal(first.delivery_fee,1000);
 assert.deepEqual(await card(),originalCard);assert.deepEqual(await defaultAddress(),originalAddress);
 assert.equal(await json(`SELECT to_jsonb(is_default) FROM public.customer_addresses WHERE id=${q(first.customer_address_id)};`),false);
 assert.equal(await json(`SELECT to_jsonb(customer_name_snapshot) FROM public.orders WHERE id=${q(first.order_id)};`),firstRequest.recipient.fullName);
 const fp=await readApplicationFingerprint(executor);assert.deepEqual(await guest(firstRequest,firstKey),first);assert.deepEqual(await readApplicationFingerprint(executor),fp);
 const parallelRequest=await request({phone:'0796600401',lines:[parcel,mixed]}),parallelKey=randomUUID();
 const parallel=await Promise.all([guest(parallelRequest,parallelKey),guest(parallelRequest,parallelKey)]);assert.deepEqual(parallel[0],parallel[1]);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.orders WHERE idempotency_key=${q(parallelKey)};`)),1);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.order_parcel_instances WHERE order_id=${q(parallel[0].order_id)} AND finalized_at IS NULL;`)),0);
 assert.deepEqual(await card(),originalCard);assert.deepEqual(await defaultAddress(),originalAddress);
 report.cases.push({name:'H1 existing customer anddefault address byte-identical;recipient snapshot separate;real mixed/carton guest/replay/concurrency exactlyonce',passed:true});
 await rpc("upsert_promotion_code('LITE2_GUEST','percentage',1250)");
 const promotedRequest=await request({lines:[base,parcel,mixed],promotion:'LITE2_GUEST',zone:'outside_ramtha',method:'cliq'}),promoted=await guest(promotedRequest);
 assert.equal(promoted.total,promotedRequest.expectedQuote.totalInMinorUnits);assert.equal(promoted.discount,2125);assert.equal(promoted.payment_method,'cliq');
 assert.equal(Number(await sql(`SELECT count(*) FROM public.promotion_redemptions WHERE order_id=${q(promoted.order_id)};`)),1);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.customers WHERE phone=${q(promotedRequest.recipient.phone)};`)),1);
 const beforeFailure=await json(`SELECT jsonb_build_object('customerCount',(SELECT count(*) FROM public.customers),'addressCount',(SELECT count(*) FROM public.customer_addresses),'orderCount',(SELECT count(*) FROM public.orders),'requestCount',(SELECT count(*) FROM sales_lite1.requests));`);
 const badRequest=await request();
 await fail({...badRequest,recipient:{...badRequest.recipient,street:''}},/PHASE3_CUSTOMER_INPUT_INVALID/);
 await fail({...badRequest,expectedQuote:{...badRequest.expectedQuote,totalInMinorUnits:1}},/PHASE3_CUSTOMER_QUOTE_STALE/);
 await fail({...badRequest,sessionHash:'invalid'},/PHASE3_IDEMPOTENCY_INPUT_INVALID/);
 await fail({...badRequest,unavailableConfirmed:[id(103)]},/PHASE3_IDEMPOTENCY_INPUT_INVALID/);
 await fail(badRequest,/permission denied/,randomUUID(),'anon');
 assert.deepEqual(await json(`SELECT jsonb_build_object('customerCount',(SELECT count(*) FROM public.customers),'addressCount',(SELECT count(*) FROM public.customer_addresses),'orderCount',(SELECT count(*) FROM public.orders),'requestCount',(SELECT count(*) FROM sales_lite1.requests));`),beforeFailure);
 await rpc(`lite1_set_available2(${q(id(103))},false,0)`);await fail(badRequest,/LITE1_UNAVAILABLE_CONFIRM_REQUIRED/);await rpc(`lite1_set_available2(${q(id(103))},true,1)`);
 await sql('UPDATE public.storefront_settings SET orders_enabled=false;');await fail(badRequest,/PHASE3_CUSTOMER_ORDERS_DISABLED/);await sql('UPDATE public.storefront_settings SET orders_enabled=true;');
 await fail({...firstRequest,recipient:{...firstRequest.recipient,fullName:'تغيير مرفوض'}},/LITE1_IDEMPOTENCY_CONFLICT/,firstKey);
 report.cases.push({name:'guest newcustomer/promotions/CliQ/existingdelivery;invalidaddress/quote/identity/clientoverride/ACL/unavailable/closedstore refused withoutpartialwrites',passed:true});
 // Execute the ACTUAL Edge handler with local Postgres for every RPC. Only
 // Turnstile's verification is mocked; no fetch reaches any network service.
 const {handleGuestOrderRequest}=await import('../../supabase/functions/submit-guest-order/index.ts');
 const edgeCalls=[];
 const edgeFetch=async(input,init)=>{
  const url=new URL(String(input));edgeCalls.push(url.pathname);
  if(url.hostname==='challenges.cloudflare.com')return Response.json({success:true,action:'guest-order',hostname:'nawasrah-store.pages.dev'});
  assert.equal(url.hostname,'127.0.0.1','NO_HOSTED_EDGE_OR_DB');
  const name=url.pathname.split('/').at(-1),payload=JSON.parse(String(init.body));
  assert.ok(['authorize_guest_order_gateway','lite1_operating_mode','lite1_guest2','finalize_guest_order_gateway'].includes(name),'UNAPPROVED_LOCAL_EDGE_RPC');
  const args=Object.entries(payload).map(([key,value])=>key+':='+(typeof value==='object'&&value!==null?j(value):q(value))).join(',');
  const result=await rpc(name+'('+args+')',null,'service_role');
  return Response.json(result);
 };
 const edgeKey=randomUUID(),edgeRequest=await request({phone:'0796600990',lines:[base,mixed]});
 const body={contractVersion:'phase3-customer-reservation-v2',idempotencyKey:edgeKey,clientSessionId:randomUUID(),turnstileToken:'local-fixture-token',customer:edgeRequest.recipient,items:edgeRequest.lines,paymentMethod:edgeRequest.paymentMethod,deliveryZone:edgeRequest.deliveryZone,promotionCode:null,expectedQuote:edgeRequest.expectedQuote};
 const edgeResults=[];
 for(let retry=0;retry<2;retry++){
  const response=await handleGuestOrderRequest(new Request('http://127.0.0.1:54321/functions/v1/submit-guest-order',{method:'POST',headers:{origin:'http://127.0.0.1:4174','content-type':'application/json','x-forwarded-for':'198.51.100.44'},body:JSON.stringify(body)}),{
   getEnv:name=>({SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'isolated-fixture-role',TURNSTILE_SECRET_KEY:'isolated-fixture-turnstile',GUEST_ORDER_HASH_SECRET:'isolated-fixture-long-hmac-secret',TURNSTILE_ALLOWED_HOSTNAMES:'nawasrah-store.pages.dev'}[name]),fetchImpl:edgeFetch});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));edgeResults.push(result);
 }
 assert.deepEqual(edgeResults[0],edgeResults[1]);
 assert.equal(Number(await sql(`SELECT count(*) FROM public.orders WHERE idempotency_key=${q(edgeKey)};`)),1);
 assert.ok(edgeCalls.includes('/rest/v1/rpc/authorize_guest_order_gateway'));assert.ok(edgeCalls.includes('/rest/v1/rpc/finalize_guest_order_gateway'));
 report.cases.push({name:'actual Edge→local authorize→trustedmode→liteguest→finalize;Tworequestsoneorder;Turnstilemockonly,noexternalrequests;modeAAL2 enforced',passed:true});
 assert.deepEqual(await inventory(),originalInventory);
 const monitor=await json('SELECT public.run_advanced_monitoring_checks();');assert.equal(monitor.integrityIssueCount,0,JSON.stringify(monitor));
 assertFrozenFunctions(rows,await json(functionCatalogSql));
 report.cases.push({name:'all pendingguest integrity0;zero movements/reservations/WAC;628bodies/636metadata exact',passed:true});
}
