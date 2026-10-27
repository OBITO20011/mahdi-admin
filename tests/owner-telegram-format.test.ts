import {sourceBeforeStoreIdentity} from '../scripts/audit/source-before-store-sharing-identity.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import {canUseNavigationAction} from '../src/features/more/adminNavigation.config';
import {sourceBeforeOwnerTelegramFormat} from '../scripts/audit/source-before-owner-telegram-format.mjs';
import {sourceBeforeNavigation206} from '../scripts/audit/source-before-navigation-cash206.mjs';

type Event={eventType:string;entityId?:string;payload:Record<string,unknown>};
type Assignment={name:string;value:string;type:string};
type Node={name:string;parameters:Record<string,unknown>};
type Workflow={nodes:Node[]};
const file='automation/n8n/workflows/frankfurt-owner-business-alerts.json';
const workflow=(JSON.parse(readFileSync(file,'utf8')) as Workflow[])[0];
const node=(name:string)=>{const n=workflow.nodes.find(n=>n.name===name);assert.ok(n);return n;};
const assignments=(node('Format Owner Message').parameters.assignments as {assignments:Assignment[]}).assignments;
const run=(index:number,event:Event):unknown=>new Function('$json',`return (${assignments[index].value.slice(3,-3)})`)(event) as unknown;
const message=(eventType:string,payload:Record<string,unknown>={},entityId='10000000-0000-4000-8000-000000000001')=>String(run(0,{eventType,payload,entityId}));
const goldens=JSON.parse(readFileSync('tests/fixtures/owner-telegram-messages.golden.json','utf8')) as {cases:Array<{event:Event;html:string;keyboard:unknown}>;testMessage:string};

test('every supported event has a reviewed exact HTML and keyboard golden,plus the one-message test',()=>{
 assert.equal(goldens.cases.length,16);assert.equal(new Set(goldens.cases.map(c=>c.event.eventType)).size,16);
 for(const c of goldens.cases){assert.equal(run(0,c.event),c.html,c.event.eventType);assert.deepEqual(run(1,c.event),c.keyboard,c.event.eventType);assert.ok(c.html.length<4096);assert.match(c.html,/^<b>.+<\/b>/u);assert.doesNotMatch(c.html,/https?:\/\//u);}
 assert.equal(node('Send One Owner Test').parameters.text,'<b>✅ تم ربط تنبيهات النواصرة لتجارة الجملة والمواد الغذائية بهاتفك</b>');assert.equal(goldens.testMessage,node('Send One Owner Test').parameters.text);
});

test('money is grouped exact BigInt minor units,including signs,zero and values beyond2^53',()=>{
 assert.match(message('new_order',{totalInMinorUnits:'1235500'}),/1,235\.500 د.أ/u);
 assert.match(message('new_order',{totalInMinorUnits:'9007199254740993'}),/9,007,199,254,740\.993 د.أ/u);
 assert.match(message('new_order',{totalInMinorUnits:9007199254740993n}),/9,007,199,254,740\.993 د.أ/u);
 assert.match(message('new_order',{totalInMinorUnits:'-9007199254740993'}),/−9,007,199,254,740\.993 د.أ/u);
 assert.match(message('new_order',{totalInMinorUnits:'0'}),/0\.000 د.أ/u);
 assert.match(message('new_order',{totalInMinorUnits:'-1'}),/−0\.001 د.أ/u);
 const huge=message('new_order',{totalInMinorUnits:'1'+'0'.repeat(79)});assert.ok(huge.includes('0.000 د.أ'));assert.ok(huge.length<4096);
 for(const value of [undefined,null,'','oops','<b>123</b>',Number.MAX_SAFE_INTEGER+1,NaN,Infinity,1.5])assert.match(message('new_order',{totalInMinorUnits:value}),/الإجمالي: غير متاح/u);
});

test('summary sections preserve saved net values and use Amman Arabic dates and ranges',()=>{
 const daily=goldens.cases[0].html,weekly=goldens.cases[1].html;
 assert.match(daily,/<i>الإثنين 2 نوفمبر<\/i>/u);assert.match(weekly,/الإثنين 2 نوفمبر — الأحد 8 نوفمبر/u);
 assert.match(daily,/<b>المقبوض<\/b>\nكاش: 1,000\.000 د.أ\nCliQ: 235\.500 د.أ/u);
 for(const heading of ['المبيعات','المقبوض','المصاريف','صافي الربح','المخزون','الذمم'])assert.ok(daily.includes('\n\n<b>'+heading+'</b>'));
 const fromUtc=message('business_daily_summary',{period:{dateFrom:'2026-11-01T22:30:00Z',dateTo:'2026-11-01T22:30:00Z'},sales:{grossSalesInMinorUnits:'10000',returnEntitlementInMinorUnits:'1000',netSalesInMinorUnits:'7777'}});
 assert.match(fromUtc,/الإثنين 2 نوفمبر/u);assert.match(fromUtc,/الصافي: 7\.777 د.أ/u); // display the supplied net,never recompute it.
 assert.match(message('business_daily_summary',{period:{dateFrom:'2026-02-31',dateTo:'2026-02-31'}}),/<i>غير متاح — غير متاح<\/i>/u);
 assert.match(message('business_daily_summary'),/كاش: غير متاح\nCliQ: غير متاح/u);
});

test('every untrusted string is escaped and bounded;raw payload and unknown financial fields never leak',()=>{
 const malicious=`<x>&"'`,stock=message('low_stock',{productName:malicious,warehouseName:malicious,availableQuantity:1,unitName:malicious});
 assert.ok(stock.includes('&lt;x&gt;&amp;&quot;&#39;'));assert.doesNotMatch(stock,/<x>/u);
 const summary=message('business_daily_summary',{inventory:{lowStockCount:4,outOfStockCount:1,lowStockItems:[{name:'الأول <&>'},{productName:'الثاني'},{name:'الثالث'},{name:'الرابع'}]}});
 assert.ok(summary.includes('الأول &lt;&amp;&gt;'));assert.ok(summary.includes('الثالث'));assert.ok(!summary.includes('الرابع'));
 const payload={orderNumber:'ORD-1',totalInMinorUnits:'1000',cost:'HIDDEN_COST',wac:'HIDDEN_WAC',customerPhone:'HIDDEN_PHONE'};const before=JSON.stringify(payload);assert.doesNotMatch(message('new_order',Object.freeze(payload)),/HIDDEN_/u);assert.equal(JSON.stringify(payload),before);
 const digits='9'.repeat(80),long='&'.repeat(10000);
 const stress=message('business_weekly_summary',{period:{dateFrom:'2026-11-02',dateTo:'2026-11-08'},sales:{grossSalesInMinorUnits:digits,returnEntitlementInMinorUnits:digits,netSalesInMinorUnits:digits,netProfitInMinorUnits:'-'+digits},cashFlow:{cashCollectedInMinorUnits:digits,cliqCollectedInMinorUnits:digits},expenses:{totalInMinorUnits:digits},balances:{customerDueInMinorUnits:digits,supplierDueInMinorUnits:digits},inventory:{lowStockCount:digits,outOfStockCount:digits,lowStockItems:[long,long,long,long]}});
 assert.ok(stress.length<4096);assert.equal((stress.match(/• /gu)??[]).length,3);
});

test('drawer discrepancy is Arabic and quantities use only supplied metadata without conversions',()=>{
 for(const [direction,expected] of [['surplus','زيادة 0.500'],['shortage','نقص 0.500']])assert.ok(message('shift_closed',{cashDiscrepancyDirection:direction,cashDiscrepancyAbsoluteInMinorUnits:'500'}).includes('فرق الدرج: '+expected+' د.أ'));
 assert.match(message('shift_closed',{cashDiscrepancyAbsoluteInMinorUnits:0}),/فرق الدرج: مطابق/u);
 assert.match(message('shift_closed'),/فرق الدرج: غير متاح/u);
 const enormous='9'.repeat(80),drawer=message('shift_closed',{expectedCashInMinorUnits:enormous,actualCashInMinorUnits:enormous,cashDiscrepancyAbsoluteInMinorUnits:enormous,cashDiscrepancyDirection:'surplus'});
 assert.equal((drawer.match(/د\.أ/gu)??[]).length,3);assert.ok(drawer.length<4096);
 assert.match(message('low_stock',{availableQuantity:12}),/المتاح: 12\n/u);
 assert.match(message('low_stock',{availableQuantity:12,unitName:'باكيت'}),/المتاح: 12 باكيت/u);
 assert.match(message('low_stock',{availableQuantity:12,parcelQuantity:1,unitQuantity:2,unitName:'حبة'}),/المتاح: 1 طرد \+ 2 حبة/u);
 assert.doesNotMatch(message('business_daily_summary',{inventory:{lowStockCount:3,outOfStockCount:0}}),/• /u);
});

test('URL keyboards use a fixed production origin and valid entity identities only',()=>{
 for(const c of goldens.cases){const output=run(1,c.event) as {rows:Array<{row:{buttons:Array<{text:string;additionalFields:{url:string}}>}}>} ;for(const row of output.rows)for(const button of row.row.buttons){assert.equal(new URL(button.additionalFields.url).origin,'https://admin.alnawasreh.com');assert.ok(button.text.startsWith('افتح'));}}
 for(const id of ['', 'https://evil.example','<script>','10000000-0000-4000-8000-000000000001&x=y']){
  assert.deepEqual(run(1,{eventType:'new_order',entityId:id,payload:{}}),{rows:[]});assert.deepEqual(run(1,{eventType:'low_stock',entityId:'10000000-0000-4000-8000-000000000001',payload:{productId:id}}),{rows:[]});
 }
 assert.equal(node('Send Owner Business Message').parameters.inlineKeyboard,'={{ $json.messageKeyboard }}');assert.equal(assignments[1].type,'object');
});

test('only approved presentation nodes change;claim,complete,guards,recipients and activation are byte-equivalent to merged main',()=>{
 const base=(JSON.parse(execFileSync('git',['show','28ab68dbe95329d435feb4871b6edd4a1230279f:'+file],{encoding:'utf8'})) as Workflow[])[0];
 const current=structuredClone(workflow),old=structuredClone(base);
 for(const name of ['Format Owner Message','Send Owner Business Message','Send One Owner Test']){
  const a=current.nodes.find(n=>n.name===name),b=old.nodes.find(n=>n.name===name);assert.ok(a&&b);
  const fields=name==='Format Owner Message'?['assignments']:name==='Send Owner Business Message'?['replyMarkup','inlineKeyboard']:['text'];
  for(const key of fields){if(key in b.parameters)a.parameters[key]=b.parameters[key];else delete a.parameters[key];}
 }
 assert.deepEqual(current,old);
 for(const type of ['business_integrity_warning','backup_failure','constructor','toString','unknown',''])assert.throws(()=>message(type),/OWNER_BUSINESS_EVENT_NOT_ALLOWED/u);
 assert.throws(()=>message('business_alert_recovery',{resolvedAlertType:'business_integrity_warning'}),/OWNER_BUSINESS_EVENT_NOT_ALLOWED/u);
});

test('native n8n expression delimiters occur only at the outer boundary',()=>{
 for(const assignment of assignments)assert.ok(!assignment.value.slice(3,-3).includes('}}'));
});

test('exact display inverse restores prior App bytes without accepting any extra product logic or repinning history',()=>{
 const app=readFileSync('src/App.tsx','utf8'),base=execFileSync('git',['show','28ab68dbe95329d435feb4871b6edd4a1230279f:src/App.tsx'],{encoding:'utf8'});
 assert.equal(sourceBeforeOwnerTelegramFormat('src/App.tsx',app),base);
 assert.throws(()=>sourceBeforeNavigation206('src/App.tsx',app+'\nconst unauthorized=1;'),/NAVIGATION206_ENTIRE_CURRENT_FILE_CHANGED/u);
 const helper='scripts/audit/source-before-environments.mjs';assert.throws(()=>sourceBeforeOwnerTelegramFormat(helper,readFileSync(helper,'utf8')+'\n// unknown'),/HANDOVER214_UNREVIEWED_SOURCE:TELEGRAM_FORMAT/u);
 assert.equal(execFileSync('git',['diff','--name-only','28ab68dbe95329d435feb4871b6edd4a1230279f','--','supabase','src/services','scripts/audit/*-hunks.json','scripts/audit/*-inverse.json'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter(file=>{if(file!=='src/services/deviceBiometrics.service.ts')return true;assert.equal(sourceBeforeStoreIdentity(file,readFileSync(file,'utf8')),execFileSync('git',['show','28ab68dbe95329d435feb4871b6edd4a1230279f:'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));return false;}).join('\n'),'');
});

test('actual App link effect only selects the three approved existing screens after authentication',()=>{
 const app=readFileSync('src/App.tsx','utf8'),source=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let body='';
 const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect'&&n.getText(source).includes("screen !== 'reports'")){const fn=n.arguments[0];assert.ok(ts.isArrowFunction(fn));body=fn.body.getText(source);}ts.forEachChild(n,visit);};visit(source);assert.ok(body);
 for(const authenticated of [false,true])for(const role of ['owner','accountant','warehouse_keeper','unassigned'])for(const screen of ['reports','inventory','shifts','users','go_live','unknown','https://evil.example']){
  const selected:string[]=[],replaced:string[]=[],window={location:{search:'?screen='+encodeURIComponent(screen)+'&keep=1',pathname:'/',hash:'#saved'},history:{replaceState:(_a:unknown,_b:string,url:string)=>replaced.push(url)}};
  new Function('isAuthenticated','setActiveTab','window','URLSearchParams','canUseNavigationAction','roleName','roles',body)(authenticated,(tab:string)=>selected.push(tab),window,URLSearchParams,canUseNavigationAction,role,[role]);
  const allowed=role==='owner'||role==='accountant'||(role==='warehouse_keeper'&&screen==='inventory');
  const admitted=authenticated&&['reports','inventory','shifts'].includes(screen)&&allowed;assert.deepEqual(selected,admitted?[screen]:[],`${role}/${screen}`);assert.deepEqual(replaced,admitted?['/?keep=1#saved']:[]);
 }
 const block=/ {2}\/\/ Owner alert links select existing views;[^]*? {2}\}, \[isAuthenticated, setActiveTab, roleName, roles\]\);\r?\n\r?\n/u;
 const base=execFileSync('git',['show','28ab68dbe95329d435feb4871b6edd4a1230279f:src/App.tsx'],{encoding:'utf8'});
 const normalized=app.replace(block,'').replace("import {canUseNavigationAction} from './features/more/adminNavigation.config';\n",'').replace('    roleName,\n    roles,\n','');
 assert.equal(normalized,base); // all existing login,cheque,order and view permission paths stay intact.
});

test('214 operational reference retains its frozen source proof while current SDK evidence binds the actual display source',async()=>{
 const {inventory}=await import('../scripts/audit/table-access-inventory.mjs');
 const {verifyProbeCoverage}=await import('../scripts/audit/table-access-probes.mjs');
 const old=JSON.parse(readFileSync('docs/operations/TABLE_ACCESS_AFTER_214.json','utf8'));
 const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
 const fresh=JSON.parse(readFileSync(state.currentTableReadinessEvidence,'utf8'));
 const projected=await inventory({projectSource:sourceBeforeOwnerTelegramFormat}),current=await inventory();
 assert.deepEqual(projected.sources,old.sourceHashes);assert.deepEqual(current.sources,fresh.sourceHashes);
 assert.deepEqual(verifyProbeCoverage(projected,old.results),old.coverage);assert.deepEqual(verifyProbeCoverage(current,fresh.results),fresh.coverage);
 const changed=await inventory({projectSource:(file:string,text:string)=>sourceBeforeOwnerTelegramFormat(file,file==='src/App.tsx'?text+'\nvoid unreviewed;':text)});
 assert.notDeepEqual(changed.sources,old.sourceHashes);
 for(const file of ['scripts/operations/build-acl-reference214.mjs','scripts/operations/frankfurt-reference214.mjs','scripts/testing/run-handover214-gates.mjs']){
  assert.equal(sourceBeforeOwnerTelegramFormat(file,readFileSync(file,'utf8')),execFileSync('git',['show','28ab68dbe95329d435feb4871b6edd4a1230279f:'+file],{encoding:'utf8'}));
 }
});
