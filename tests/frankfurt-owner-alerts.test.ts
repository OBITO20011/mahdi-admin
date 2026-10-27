import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

type Assignment={name:string;value:unknown;type:string};
type WorkflowNode={id:string;name:string;type:string;parameters:Record<string,unknown>;onError?:string;credentials?:Record<string,{id:string;name:string}>};
type Workflow={id:string;name:string;active:boolean;nodes:WorkflowNode[];connections:Record<string,{main:Array<Array<{node:string}>>}>;settings:{timezone:string};pinData:Record<string,unknown>;staticData:unknown};
const source=readFileSync('automation/n8n/workflows/frankfurt-owner-business-alerts.json','utf8');
const [workflow]=JSON.parse(source) as Workflow[];
const legacy=JSON.parse(readFileSync('automation/n8n/workflows/nawasrah-alerts.json','utf8')) as Workflow[];
const node=(name:string)=>{const n=workflow.nodes.find(n=>n.name===name);assert.ok(n,name);return n;};
const field=(name:string,key:string)=>node(name).parameters[key];
const assignments=(name:string)=>(field(name,'assignments') as {assignments:Assignment[]}).assignments;
const defaults=Object.fromEntries(assignments('Owner Routing').map(a=>[a.name,a.value]));
const owner={...defaults,ownerTelegramChatId:'811111111',developerTelegramChatIdForComparison:'-922222222'};
function evaluate(expression:unknown,json:Record<string,unknown>,split:Record<string,unknown>={},routing=owner):unknown{
 assert.equal(typeof expression,'string');
 const text=String(expression);assert.match(text,/^=\{\{[\s\S]*\}\}$/u);
 const lookup=(name:string)=>{assert.ok(['Owner Routing','Split Frankfurt Events'].includes(name));return {first:()=>({json:routing}),item:{json:split}};};
 return new Function('$json','$',`return (${text.slice(3,-3)});`)(json,lookup) as unknown;
}
const gate=(name:string,json:Record<string,unknown>)=>evaluate(((field(name,'conditions') as {conditions:Array<{leftValue:string}>}).conditions[0]).leftValue,json);
const next=(name:string,port=0)=>workflow.connections[name]?.main[port]?.map(x=>x.node)??[];
const kinds=['new_order','low_stock','out_of_stock','shift_closed','order_unprocessed','order_near_expiry','order_expired','shift_close_reminder','shift_close_overdue','purchase_order_overdue','expense_daily_threshold','business_daily_summary','business_weekly_summary','cheque_due','cheque_returned'];
const message=(eventType:string,payload:Record<string,unknown>={})=>String(evaluate(assignments('Format Owner Message')[0].value,{eventType,payload,entityId:'10000000-0000-4000-8000-000000000001'}));

test('Frankfurt owner template imports independently with no secret,activation or old identity',()=>{
 assert.equal(workflow.name,'Frankfurt — تنبيهات صاحب المحل');assert.equal(workflow.active,false);
 assert.equal(workflow.settings.timezone,'Asia/Amman');assert.deepEqual(workflow.pinData,{});assert.equal(workflow.staticData,null);
 const oldIds=new Set(legacy.flatMap(w=>[w.id,...w.nodes.flatMap(n=>[n.id,...Object.values(n.credentials??{}).map(c=>c.id)])]));
 assert.equal(oldIds.has(workflow.id),false);assert.equal(new Set(workflow.nodes.map(n=>n.id)).size,workflow.nodes.length);
 for(const n of workflow.nodes){assert.equal(oldIds.has(n.id),false);for(const c of Object.values(n.credentials??{}))assert.equal(oldIds.has(c.id),false);}
 assert.deepEqual(defaults,{ownerTelegramChatId:'',developerTelegramChatIdForComparison:'',businessAlertsEnabled:false,testConsent:false});
 assert.doesNotMatch(source,/acjtabdqqnpwhdvbvnyw|service_role|\$env|accessToken|Authorization|REPLACE_WITH_TELEGRAM_CHAT_ID/u);
 for(const n of workflow.nodes.filter(n=>n.type.endsWith('.httpRequest'))){
  assert.equal(n.parameters.url,'https://kzevmysfydaslxcerogt.supabase.co/functions/v1/n8n-alert-feed');
  assert.equal(n.parameters.authentication,'genericCredentialType');assert.equal(n.parameters.genericAuthType,'httpHeaderAuth');
  assert.deepEqual(n.credentials,{httpHeaderAuth:{id:'ffOwnerFeed214',name:'Frankfurt owner business feed — NEW'}});
 }
 const allowed=['scheduleTrigger','manualTrigger','set','if','httpRequest','splitOut','telegram'];
 assert.ok(workflow.nodes.every(n=>allowed.includes(n.type.replace('n8n-nodes-base.',''))));
});

test('owner recipient guard refuses empty,same,group or malformed destination before any external node',()=>{
 assert.equal(gate('Owner Recipient Ready',owner),true);
 for(const json of [defaults,{...owner,ownerTelegramChatId:owner.developerTelegramChatIdForComparison},{...owner,ownerTelegramChatId:'-1234'},{...owner,ownerTelegramChatId:'@developer'},{...owner,developerTelegramChatIdForComparison:''},{...owner,ownerTelegramChatId:'0'},{...owner,ownerTelegramChatId:'123\n456'}])assert.equal(gate('Owner Recipient Ready',json),false);
 assert.deepEqual(next('Owner Routing'),['Owner Recipient Ready']);assert.deepEqual(next('Owner Recipient Ready',1),[]);
 assert.deepEqual(next('Owner Recipient Ready'),['Manual Test Mode']);
});

test('manual one-message test never claims business events and scheduled polling stays off by default',()=>{
 assert.equal(gate('Manual Test Mode',{mode:'test'}),true);assert.equal(gate('One Test Consent',{mode:'test',testConsent:false}),false);
 assert.equal(gate('One Test Consent',{mode:'test',testConsent:true}),true);
 for(const json of [{...owner,mode:'scheduled'},{...owner,mode:'test',businessAlertsEnabled:true},{...owner,mode:'scheduled',businessAlertsEnabled:'true'},{...owner,mode:'other',businessAlertsEnabled:true}])assert.equal(gate('Business Delivery Enabled',json),false);
 assert.equal(gate('Business Delivery Enabled',{...owner,mode:'scheduled',businessAlertsEnabled:true}),true);
 assert.deepEqual(next('Owner One Message Test'),['Test Mode']);assert.deepEqual(next('Manual Test Mode'),['One Test Consent']);
 assert.deepEqual(next('One Test Consent'),['Send One Owner Test']);assert.deepEqual(next('Send One Owner Test'),['Test Delivery Result']);assert.deepEqual(next('Test Delivery Result'),[]);
 assert.deepEqual(next('Manual Test Mode',1),['Business Delivery Enabled']);assert.deepEqual(next('Business Delivery Enabled'),['Claim Frankfurt Events']);assert.deepEqual(next('Business Delivery Enabled',1),[]);
 assert.deepEqual(JSON.parse(String(field('Claim Frankfurt Events','body'))),{action:'claim',channel:'telegram',limit:10,leaseSeconds:120});
});

test('only known business kinds and their recoveries reach owner;technical and unknown types fail closed',()=>{
 for(const eventType of kinds){assert.equal(gate('Owner Business Event',{eventType}),true);assert.equal(gate('Owner Business Event',{eventType:'business_alert_recovery',payload:{resolvedAlertType:eventType}}),true);}
 for(const eventType of ['business_integrity_warning','backup_failure','watchdog','keep_alive','system_error','ci_failure','unknown','']){
  assert.equal(gate('Owner Business Event',{eventType}),false);
  assert.equal(gate('Owner Business Event',{eventType:'business_alert_recovery',payload:{resolvedAlertType:eventType}}),false);
  assert.throws(()=>message(eventType),/NOT_ALLOWED/u);
 }
 assert.deepEqual(next('Owner Business Event'),['Format Owner Message']);assert.deepEqual(next('Owner Business Event',1),['Record Unsupported Event']);
 assert.deepEqual(next('Record Unsupported Event'),[]);
});

test('owner messages escape untrusted HTML,have actual line breaks and only format saved financial values',()=>{
 for(const kind of kinds)assert.ok(message(kind).length>5);
 const stock=message('low_stock',{productName:'تفاح <script>&\nتوت',availableQuantity:3});
 assert.match(stock,/تفاح &lt;script&gt;&amp; توت/u);assert.match(stock,/\nالصنف:/u);assert.doesNotMatch(stock,/\\n|<script>/u);
 const summary=message('business_daily_summary',{period:{dateFrom:'2026-10-27',dateTo:'2026-10-27'},sales:{grossSalesInMinorUnits:15000,netSalesInMinorUnits:12000,netProfitInMinorUnits:1006},cashFlow:{cashCollectedInMinorUnits:3000,cliqCollectedInMinorUnits:1000}});
 assert.match(summary,/15\.000 د.أ/u);assert.match(summary,/12\.000 د.أ/u);assert.match(summary,/1\.006 د.أ/u);assert.match(summary,/كاش: 3\.000 د.أ\nCliQ: 1\.000 د.أ/u);
 assert.match(message('business_daily_summary'),/غير متاح/u);
 assert.doesNotMatch(message('new_order',{orderNumber:'ORD-1',customerPhone:'SHOULD_NOT_LEAK',customerName:'SHOULD_NOT_LEAK',deliveryAddress:'SHOULD_NOT_LEAK'}),/SHOULD_NOT_LEAK/u);
});

test('only a Telegram success with message id and matching owner receipt can acknowledge delivery',()=>{
 const good={ok:true,result:{message_id:7,chat:{id:Number(owner.ownerTelegramChatId)}}};
 assert.equal(gate('Telegram Receipt Matches Owner',good),true);
 for(const response of [{error:'redacted'},{ok:false},{ok:true,result:{chat:{id:Number(owner.ownerTelegramChatId)}}},{ok:true,result:{message_id:7,chat:{id:123}}}])assert.equal(gate('Telegram Receipt Matches Owner',response),false);
 assert.equal(node('Send Owner Business Message').onError,'continueRegularOutput');
 assert.deepEqual(next('Format Owner Message'),['Send Owner Business Message']);assert.deepEqual(next('Send Owner Business Message'),['Telegram Receipt Matches Owner']);
 assert.deepEqual(next('Telegram Receipt Matches Owner'),['Acknowledge Owner Delivery']);assert.deepEqual(next('Telegram Receipt Matches Owner',1),['Record Owner Delivery Failure']);
 const split={eventId:'10000000-0000-4000-8000-000000000007'};
 for(const [name,success,error] of [['Acknowledge Owner Delivery',true,null],['Record Owner Delivery Failure',false,'OWNER_TELEGRAM_DELIVERY_FAILED'],['Record Unsupported Event',false,'OWNER_BUSINESS_EVENT_NOT_ALLOWED']] as const){
  const body=JSON.parse(String(evaluate(field(name,'body'),{error:'Never forward this response'},split))) as Record<string,unknown>;
  assert.deepEqual(body,{action:'complete',channel:'telegram',eventId:split.eventId,success,error});
 }
 for(const n of workflow.nodes.filter(n=>n.type.endsWith('.telegram'))){assert.equal(n.parameters.chatId,"={{ $('Owner Routing').first().json.ownerTelegramChatId }}");assert.deepEqual(n.parameters.additionalFields,{parse_mode:'HTML',appendAttribution:false,disable_web_page_preview:true});}
});
