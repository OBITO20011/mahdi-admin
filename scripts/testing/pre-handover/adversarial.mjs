import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {root,output,container,id,owner,branch,warehouse,supplier,customer,product,q,j,key,raw,sql,json,rpc,auth,fingerprint,refused,save,assertLocal212,frozenSources} from './context.mjs';
const report={kind:'independent-adversarial212',startedAt:new Date().toISOString(),cases:[],managedAccess:false};let stage='setup';
const record=(name,evidence)=>{report.cases.push({name,evidence,passed:true});console.log(JSON.stringify({passed:name}));};
const pos=(pid,n,k=key('attack-sale'))=>`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'اختبار هجومي','cash',${j([{commercial_line_kind:'base_unit',product_id:pid,base_quantity:n,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${n*1000},${q(k)})`;
const old=(action,payload,k=key(action))=>`execute_supplier_replacement_v1(${q(action)},${j(payload)},${q(k)})`;
async function race(firstCall,secondCall){
 const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(Error(err)));});void done.catch(()=>undefined);
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',s=>{out+=s;if(out.includes('AUDIT_HELD'))resolve();});child.stderr.on('data',s=>err+=s);child.on('close',()=>reject(Error(err||'HELD_SESSION_CLOSED')));});
 child.stdin.write(auth('SELECT public.'+firstCall+';').replace('COMMIT;',"SELECT 'AUDIT_HELD';")+'\n');await ready;let pending,blocked=false;
 try{pending=raw("SET application_name='prehandover-race';"+auth('SELECT public.'+secondCall+';'));for(let n=0;n<100;n++){if(await sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='prehandover-race' AND wait_event_type='Lock';")==='1'){blocked=true;break;}await new Promise(r=>setTimeout(r,40));}}
 finally{child.stdin.end('COMMIT;');await done;}
 const second=await pending;assert.equal(blocked,true,'MUST_OBSERVE_REAL_SECOND_SESSION_LOCK');return {blocked,second,first:JSON.parse(out.split(/\r?\n/u).find(s=>s.startsWith('{')&&s.includes('success'))||'null')};
}
try{
 report.database=await assertLocal212();report.source=await frozenSources();
 const prior=JSON.parse(await readFile(path.join(output,'golden-day.json'),'utf8'));assert.equal(prior.completed,true);
 await rpc(`open_cash_shift(${q(branch)},1000000)`);
 for(const [n,role]of ['admin','manager','warehouse_keeper','cashier','accountant','viewer','none'].entries()){
  const uid=id(600+n);await sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) VALUES(${q(uid)},'authenticated','authenticated',${q(role+'@audit.example.test')},'{}','{}');INSERT INTO profiles(id,full_name,is_active) VALUES(${q(uid)},${q(role)},true);${role==='none'?'':`INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;INSERT INTO user_roles(user_id,role_id) SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`}`);
 }
 stage='legacy-and-parcel';const only=id(110);
 for(const n of [1,10,20])record('parcel-only rejects unit '+n,await refused(pos(only,n),/PARCEL209_UNIT_SALE_FORBIDDEN/));
 record('legacy customer rejects fabricated parcel',await refused(`create_customer_order(p_customer_full_name:='قديم',p_customer_phone:='0796600999',p_items:=${j([{product_id:only,quantity:10}])})`,/PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED/));
 record('service legacy guest rejects fabricated parcel',await refused(`submit_guest_customer_order(p_idempotency_key:=${q(randomUUID())},p_customer_full_name:='قديم',p_customer_phone:='0796600877',p_governorate:='إربد',p_city:='الرمثا',p_area:='حي الاختبار',p_street:='شارع الاختبار',p_items:=${j([{product_id:only,quantity:10}])})`,/PARCEL209_LEGACY_PARCEL_EVIDENCE_REQUIRED/,owner,'service_role'));
 record('POS V1 remains closed',await refused(`create_pos_sale(${q(warehouse)},${q(branch)},NULL,'قديم','cash',${j([{product_id:product,quantity:1}])},0,1000,${q(key('v1'))})`,/PACKAGE_D_POS_V2_REQUIRED/));
 stage='roles-readers';for(const [n,role]of ['admin','manager','warehouse_keeper','cashier','accountant','viewer','none'].entries()){
  const uid=id(600+n),call="get_damage_history_page_v1('today',NULL,NULL,'all',1,25)";
  if(['manager','warehouse_keeper'].includes(role)){const before=await fingerprint(),r=await rpc(call,uid);assert.ok(r.rows.length>0);assert.doesNotMatch(JSON.stringify(r),/lossAt|unitCost|pendingValue|reversal|reclassification|wac|expense|price|cost/i);assert.deepEqual(await fingerprint(),before);record(role+' damage read quantities without owner values',{rows:r.rows.length,zeroWrites:true,privateFieldsAbsent:true});}
  else record(role+' damage reader denied',await refused(call,/42501|ROLE_DENIED|صلاحية/,uid));
  record(role+' supplier value action denied',await refused(`preview_aftercare_supplier_v1('replacement',${q(id(9999))},${q(supplier)})`,/OWNER_ONLY|ROLE_DENIED/,uid));
 }
 for(const role of ['anon','service_role'])record(role+' damage denied',await refused("get_damage_history_page_v1()",/permission denied/,owner,role));
 record('no-role home denied',await refused('get_home_dashboard()',/42501|صلاحية|ROLE|غير/,id(606)));
 stage='mfa';await sql(`INSERT INTO auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret) VALUES(${q(id(998))},${q(owner)},'Audit local factor','totp','verified',NOW(),NOW(),'audit-local-factor');`);
 record('enrolled owner aal1 cannot access supplier action',await refused(`preview_aftercare_supplier_v1('replacement',${q(id(9999))},${q(supplier)})`,/OWNER_ONLY|AAL2|ROLE_DENIED/,owner,'authenticated','aal1'));
 stage='replay';const k=key('replay-sale'),call=pos(product,1,k),sale=await rpc(call),before=await fingerprint();const replay=await rpc(call);assert.deepEqual(replay,sale);assert.deepEqual(await fingerprint(),before);record('sale replay zero all-table and sequence writes',{orderId:sale.orderId,zeroWrites:true});
 record('same sale key changed quantity',await refused(pos(product,2,k),/IDEMPOTENCY|CONFLICT/));
 stage='race-identical-sale';const raceCall=pos(product,1,key('race-sale')),count=Number(await sql('SELECT count(*) FROM orders;')),same=await race(raceCall,raceCall);assert.equal(same.second.code,0,same.second.stderr);assert.equal(Number(await sql('SELECT count(*) FROM orders;')),count+1);record('two sessions same sale key commit one order',{observedLock:true,ordersAdded:1});
 stage='race-supplier-capacity';const held=await rpc(old('shop_pending',{supplierId:supplier,productId:product,warehouseId:warehouse,unit:'base',quantity:2,reason:'معلق لاختبار سباق حقيقي'}));
 const caseId=held.cases[0].id,receive=old('receive',{caseId,quantity:2,reason:'وصل البديل من المورد'}),writeoff=old('writeoff',{caseId,quantity:2,reason:'رفض المورد كامل المتبقي'});
 const outcome=await race(receive,writeoff);assert.notEqual(outcome.second.code,0);assert.match(outcome.second.stderr,/PENDING|QUANTITY|REMAINING|SUPPLIER_REPLACEMENT/);record('receive versus refusal serialize;only available quantity consumed',{observedLock:true,loserError:outcome.second.stderr.split('\n').filter(l=>l.includes('ERROR')).join('\n')});
 stage='reversal';const reverseCandidate=await rpc(old('shop_pending',{supplierId:supplier,productId:product,warehouseId:warehouse,unit:'base',quantity:1,reason:'معلق للعكس الفوري'}));
 const beforeStock=await json(`SELECT to_jsonb(on_hand_quantity) FROM inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`);
 const reverseCall=old('reverse',{eventId:reverseCandidate.cases[0].events[0].id,reason:'عكس تسجيل بالخطأ'});await rpc(reverseCall);const committed=await fingerprint();await rpc(reverseCall);assert.deepEqual(await fingerprint(),committed);assert.equal(await json(`SELECT to_jsonb(on_hand_quantity) FROM inventory_balances WHERE product_id=${q(product)} AND warehouse_id=${q(warehouse)};`),beforeStock+1);record('supplier hold reversal once then replay zero writes',{quantityRecovered:1,replayZeroWrites:true});
 stage='private-relations';for(const role of ['anon','authenticated','service_role'])for(const table of ['aftercare_supplier_links','supplier_replacement_inventory_effects']){const priorState=await fingerprint(),r=await raw(auth('SELECT * FROM public.'+table+' LIMIT 1;',owner,role));assert.notEqual(r.code,0);assert.match(r.stderr,/permission denied/);assert.deepEqual(await fingerprint(),priorState);record(role+' cannot read '+table,{denied:true,zeroWrites:true});}
 report.sourceAfter=await frozenSources();assert.equal(report.source.sha256,report.sourceAfter.sha256);report.ok=true;
}catch(error){report.ok=false;report.stage=stage;report.error=error.message;process.exitCode=1;}
finally{report.endedAt=new Date().toISOString();await save('adversarial',report);console.log(JSON.stringify({ok:report.ok,stage:report.stage,error:report.error,cases:report.cases.length}));}
