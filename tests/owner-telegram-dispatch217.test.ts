import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {formatOwnerMessage,formatOwnerKeyboard,ownerInlineKeyboard,ownerTestMessage,type OwnerEvent} from '../supabase/functions/_shared/owner-telegram-format.ts';
import {ownerTelegramHandler,type DispatchDependencies} from '../supabase/functions/owner-telegram-dispatch/handler.ts';

const goldens=JSON.parse(readFileSync('tests/fixtures/owner-telegram-messages.golden.json','utf8')) as {cases:Array<{event:OwnerEvent;html:string;keyboard:unknown}>;testMessage:string};
const workflow=JSON.parse(readFileSync('automation/n8n/workflows/frankfurt-owner-business-alerts.json','utf8'))[0];
const expressions=workflow.nodes.find((n:{name:string})=>n.name==='Format Owner Message').parameters.assignments.assignments as Array<{value:string}>;
const old=(index:number,event:OwnerEvent)=>new Function('$json',`return (${expressions[index].value.slice(3,-3)});`)(event) as unknown;
const id='10000000-0000-4000-8000-000000000001',secret='local-only-synthetic-dispatch-secret-217',token='123456:'+ 'SYNTHETIC_'.repeat(4),chat='811111111';
const config={secret,enabled:'true',testEnabled:'false',botToken:token,ownerChatId:chat,developerChatIdForComparison:'-922222222'};
const request=(body:unknown={mode:'dispatch'},auth=secret)=>new Request('http://127.0.0.1/owner-telegram-dispatch',{method:'POST',headers:{'x-owner-telegram-secret':auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
function fixture(override:Partial<DispatchDependencies>={}) {
  const calls:Array<{name:string;args:Record<string,unknown>}> = [],sent:Array<Record<string,unknown>>=[];
  let created=0;
  const deps:DispatchDependencies={config,uuid:()=>id,
    createClient:()=>{created++;return {rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:name==='owner_telegram_dispatch_lease_valid_v1'?true:name==='claim_owner_telegram_deliveries_v1'?{success:true,items:[{...goldens.cases[2].event,eventId:id}]}:{success:true}};}};},
    fetch:async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return Response.json({ok:true,result:{message_id:1,chat:{id:chat}}});},...override};
  return {deps,calls,sent,created:()=>created,handler:ownerTelegramHandler(deps)};
}

test('217 shared formatter matches every reviewed golden and the frozen n8n text/keyboard exactly',()=>{
  assert.equal(workflow.active,false);assert.equal(goldens.cases.length,16);
  for(const g of goldens.cases){assert.equal(formatOwnerMessage(g.event),g.html);assert.equal(formatOwnerMessage(g.event),old(0,g.event));assert.deepEqual(formatOwnerKeyboard(g.event),g.keyboard);assert.deepEqual(formatOwnerKeyboard(g.event),old(1,g.event));assert.ok(g.html.length<4096);}
  assert.equal(ownerTestMessage,goldens.testMessage);
  for(const kind of ['new_order','low_stock','business_daily_summary','shift_closed'])for(const value of [undefined,null,0,'-9007199254740993','<&>"\'', '9'.repeat(80)]){
    const event={eventType:kind,entityId:id,payload:{productName:value,orderNumber:value,totalInMinorUnits:value,cashDiscrepancyInMinorUnits:value,sales:{netSalesInMinorUnits:value}}};
    assert.equal(formatOwnerMessage(event),old(0,event));assert.deepEqual(formatOwnerKeyboard(event),old(1,event));
  }
  const escaped=formatOwnerMessage({eventType:'low_stock',payload:{productName:'< > &'}});assert.ok(escaped.includes('&lt; &gt; &amp;'));assert.doesNotMatch(escaped,/< >/u);
  assert.match(formatOwnerMessage({eventType:'new_order',payload:{totalInMinorUnits:'9007199254740993'}}),/9,007,199,254,740\.993/u);
  for(const type of ['business_integrity_warning','backup_failure','unknown','constructor'])assert.throws(()=>formatOwnerMessage({eventType:type,payload:{}}),/OWNER_BUSINESS_EVENT_NOT_ALLOWED/u);
  assert.throws(()=>formatOwnerMessage({eventType:'business_alert_recovery',payload:{resolvedAlertType:'business_integrity_warning'}}),/OWNER_BUSINESS_EVENT_NOT_ALLOWED/u);
});

test('217 unauthorized/disabled/malformed configuration invokes zero service calls and sends nothing',async()=>{
  for(const [patch,auth,expected]of [[{enabled:'false'},secret,'OWNER_TELEGRAM_DISABLED'],[{enabled:undefined},secret,'OWNER_TELEGRAM_DISABLED'],[{},'wrong','OWNER_TELEGRAM_UNAUTHORIZED'],[{secret:''},secret,'OWNER_TELEGRAM_NOT_CONFIGURED'],[{ownerChatId:'-811111111'},secret,'OWNER_TELEGRAM_NOT_CONFIGURED'],[{developerChatIdForComparison:chat},secret,'OWNER_TELEGRAM_NOT_CONFIGURED'],[{developerChatIdForComparison:''},secret,'OWNER_TELEGRAM_NOT_CONFIGURED']]as const){
    const f=fixture({config:{...config,...patch}}),r=await f.handler(request(undefined,auth));assert.equal((await r.json()).code,expected);assert.equal(f.created(),0);assert.deepEqual(f.sent,[]);assert.deepEqual(f.calls,[]);
  }
});

test('217 dispatch acknowledges only Telegram ok/message-id/matching owner and uses fixed safe diagnostics',async()=>{
  for(const reply of [{ok:true,result:{message_id:4,chat:{id:chat}}},{ok:false,description:'RAW_'+token},{ok:true,result:{message_id:4,chat:{id:'wrong'}}},{ok:true,result:{chat:{id:chat}}},{ok:true,result:{message_id:0,chat:{id:chat}}}]){
    const f=fixture({fetch:async()=>Response.json(reply)}),r=await f.handler(request()),result=await r.json();assert.equal(result.code,'OWNER_TELEGRAM_BATCH_COMPLETE');
    const success=reply.ok===true&&reply.result?.message_id===4&&reply.result?.chat.id===chat;
    const completion=f.calls.find(c=>c.name==='complete_owner_telegram_delivery_v1');assert.ok(completion);assert.equal(completion.args.p_success,success);assert.equal(completion.args.p_error,success?null:'OWNER_TELEGRAM_DELIVERY_FAILED');
    assert.equal(f.calls.at(-1)?.name,'release_owner_telegram_dispatch_v1');assert.doesNotMatch(JSON.stringify({result,calls:f.calls}),/RAW_|SYNTHETIC_|123456:/u);
  }
});

test('217 unknown/technical kinds complete failed with original fixed exclusion code and no send',async()=>{
  for(const event of [{eventType:'business_integrity_warning',payload:{}},{eventType:'business_alert_recovery',payload:{resolvedAlertType:'business_integrity_warning'}},{eventType:'unknown',payload:{}}]){
    const f=fixture({createClient:()=>({rpc:async(name,args)=>{f.calls.push({name,args});return {error:null,data:name==='claim_owner_telegram_deliveries_v1'?{success:true,items:[{...event,eventId:id}]}:{success:true}};}})});
    assert.equal((await(await f.handler(request())).json()).failed,1);assert.equal(f.sent.length,0);assert.equal(f.calls.find(c=>c.name==='complete_owner_telegram_delivery_v1')?.args.p_error,'OWNER_BUSINESS_EVENT_NOT_ALLOWED');
  }
});

test('217 busy/database-disabled states do not send or release another holder; complete failures still release own lease',async()=>{
  for(const code of ['OWNER_TELEGRAM_BUSY','OWNER_TELEGRAM_DISABLED']){
    const f=fixture({createClient:()=>({rpc:async()=>({data:{code},error:null})})});assert.equal((await(await f.handler(request())).json()).code,code);assert.deepEqual(f.sent,[]);
  }
  const f=fixture({createClient:()=>({rpc:async(name,args)=>{f.calls.push({name,args});return name==='owner_telegram_dispatch_lease_valid_v1'?{error:null,data:true}:name==='claim_owner_telegram_deliveries_v1'?{error:null,data:{success:true,items:[{...goldens.cases[2].event,eventId:id}]}}:{error:name==='complete_owner_telegram_delivery_v1'?{message:token}:null,data:{success:true}};}})});
  const result=await(await f.handler(request())).json();assert.equal(result.code,'OWNER_TELEGRAM_COMPLETE_FAILED');assert.equal(f.calls.at(-1)?.name,'release_owner_telegram_dispatch_v1');assert.ok(!JSON.stringify(result).includes(token));
});

test('217 explicit manual test is off by default, sends exact approved text once and never creates a DB client',async()=>{
  const f=fixture({config:{...config,enabled:'false',testEnabled:'true'}});
  assert.equal((await(await f.handler(request({mode:'test',testConsent:false}))).json()).code,'OWNER_TELEGRAM_DISABLED');
  assert.equal((await(await f.handler(request({mode:'test',testConsent:true}))).json()).testDelivered,true);
  assert.equal(f.created(),0);assert.deepEqual(f.calls,[]);assert.equal(f.sent.length,1);assert.equal(f.sent[0].text,ownerTestMessage);assert.equal(f.sent[0].parse_mode,'HTML');assert.equal(f.sent[0].disable_web_page_preview,true);
});

test('217 expired run is rechecked immediately before send and cannot send or acknowledge',async()=>{
  const f=fixture({createClient:()=>({rpc:async(name,args)=>{f.calls.push({name,args});return {error:null,data:name==='claim_owner_telegram_deliveries_v1'?{success:true,items:[{...goldens.cases[2].event,eventId:id}]}:false};}})});
  assert.equal((await(await f.handler(request())).json()).code,'OWNER_TELEGRAM_LEASE_LOST');
  assert.deepEqual(f.sent,[]);assert.ok(!f.calls.some(c=>c.name==='complete_owner_telegram_delivery_v1'));assert.equal(f.calls.at(-1)?.name,'release_owner_telegram_dispatch_v1');
});

test('217 real loopback Telegram stub receives identical text/buttons; transport failure is sanitized',async()=>{
  const bodies:Array<Record<string,unknown>>=[];
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=String(chunk);bodies.push(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result:{message_id:217,chat:{id:Number(chat)}}}));});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  try{
    const f=fixture({fetch:async(url,init)=>{assert.equal(String(url),'https://api.telegram.org/bot'+token+'/sendMessage');return fetch('http://127.0.0.1:'+address.port+'/sendMessage',init);}});
    const result=await(await f.handler(request())).json();assert.equal(result.delivered,1);assert.equal(bodies.length,1);assert.equal(bodies[0].text,goldens.cases[2].html);assert.deepEqual(bodies[0].reply_markup,ownerInlineKeyboard(goldens.cases[2].event));
    const bad=fixture({fetch:async()=>{throw new Error('https://api.telegram.org/bot'+token+'/sendMessage RAW');}});assert.equal((await(await bad.handler(request())).json()).failed,1);assert.equal(bad.calls.find(c=>c.name==='complete_owner_telegram_delivery_v1')?.args.p_error,'OWNER_TELEGRAM_DELIVERY_FAILED');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
