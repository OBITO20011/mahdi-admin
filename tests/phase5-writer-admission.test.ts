import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {assertWriterAdmissionMatrix,buildWriterAdmissionMatrix,compareGateToBoundary,
  deriveAdmissionReachability,inspectAdmissionBody,inspectExplicitInsertColumns,inspectExplicitInsertValues,inspectReceiptV2SourceContract,inspectReceiptV2DeferredValueContract,inspectReceiptV2InstalledValueRequirements,inspectReceiptV2LiteralSourcePins,inspectReceiptV2RowRequirements,assertReceiptV2RowRequirements,bindReceiptV2ItemProjectionRequirements,assertReceiptV2ItemProjectionRequirements,bindReceiptV2PrimaryProjectionRequirements,assertReceiptV2PrimaryProjectionRequirements,inspectExplicitUpdateValues,inspectReceiptV2UpdateRequirements,bindReceiptV2UpdateProjectionRequirements,assertReceiptV2UpdateProjectionRequirements,decodeReceiptV2LiteralRequirement,maskAdmissionSql} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {functionEvents} from '../scripts/analysis/build-phase5-authority-ledger.mjs';
import {inspectReceiptV2TriggerEffectContract,deriveReceiptV2AlertTransition} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {inspectReceiptV2TransitiveRowRequirements,assertReceiptV2TransitiveRowRequirements} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {deriveReceiptV2StockStages,assertReceiptV2StockStages} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {bindReceiptV2SourceEffectUnion,assertReceiptV2SourceEffectUnion} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {resolveReceiptV2CapturedAlertEvents,assertReceiptV2CapturedAlertEvents} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {resolveReceiptV2StockCandidateRequirements} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {bindReceiptV2StockResourceUnion,assertReceiptV2StockResourceUnion} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';
import {qualifySourceScalarValue,qualifyPreparedSourceRow,assertPreparedSourceRow} from '../scripts/analysis/inspect-phase5-writer-admission.mjs';

const receiptMigrationSources=new Map(readdirSync('supabase/migrations')
  .filter(n=>/^\d{3}_/u.test(n)&&Number(n.slice(0,3))<=127).sort()
  .map(filename=>[filename,readFileSync('supabase/migrations/'+filename,'utf8').replace(/\r\n?/gu,'\n')]));
const receiptSources=functionEvents([...receiptMigrationSources].map(([filename,source])=>({filename,source}))).state;

test('A2 source scalar types retain exact integer and decimal ranges without SQL rounding/coercion',()=>{
  const check=(type:string,v:unknown)=>qualifySourceScalarValue({type,notNull:true},v);
  for(const [type,lo,hi] of [['smallint','-32768','32767'],['integer','-2147483648','2147483647'],
    ['bigint','-9223372036854775808','9223372036854775807']]){
    assert.equal(check(type,lo).value,lo);assert.equal(check(type,hi).value,hi);
    for(const bad of [(BigInt(lo)-1n).toString(),(BigInt(hi)+1n).toString(),null,'1.0',true,' 1','1e2',Number.MAX_SAFE_INTEGER+1])
      assert.throws(()=>check(type,bad),/TYPED_VALUE_INVALID/u);
  }
  for(const value of ['999999999999999999.999999','-999999999999999999.999999','0.000001',10.333333])
    assert.equal(check('numeric(24,6)',value).value,value);
  for(const bad of ['1000000000000000000','1.0000001','1e-6',Infinity,NaN,Number('1000000000000.333333')])
    assert.throws(()=>check('numeric(24,6)',bad),/TYPED_VALUE_INVALID/u);
  assert.throws(()=>check('money','1'),/TYPE_UNRESOLVED/u);
  assert.throws(()=>qualifySourceScalarValue({type:'unknown_domain',notNull:false},null),/TYPE_UNRESOLVED/u);
  for(const type of ['numeric(0,0)','numeric(2,3)','character varying(0)'])
    assert.throws(()=>qualifySourceScalarValue({type,notNull:false},null),/TYPED_VALUE_INVALID/u);
});

test('A2 source text/calendar/UUID/JSON qualification is NULL-explicit and never clock/ownership authority',()=>{
  const check=(type:string,v:unknown)=>qualifySourceScalarValue({type,notNull:true},v);
  assert.equal(check('character varying(2)','أ😀').value,'أ😀');
  for(const bad of ['أ😀ب','a\0','\uD800'])assert.throws(()=>check('character varying(2)',bad),/TYPED_VALUE_INVALID/u);
  for(const bad of ['2026-02-29','2000-02-30','2026-13-01','999-01-01'])assert.throws(()=>check('date',bad),/TYPED_VALUE_INVALID/u);
  assert.equal(check('date','2000-02-29').value,'2000-02-29');
  assert.equal(check('timestamp with time zone','1969-12-31T23:59:59.999999Z').encoding,'UTC_MICROSECOND_TEXT_NOT_CLOCK_AUTHORITY');
  for(const bad of ['2026-10-06T24:00:00Z','2026-10-06T00:00:60Z','2026-10-06T00:00:00.1234567Z','2026-10-06T00:00:00+03:00'])
    assert.throws(()=>check('timestamp with time zone',bad),/TYPED_VALUE_INVALID/u);
  assert.equal(check('uuid','00000000-0000-0000-0000-000000000000').encoding,'UUID_NOT_OWNERSHIP','type proof is not nonnil business policy');
  assert.throws(()=>check('uuid','92400000-0000-0000-0000-00000000000X'),/TYPED_VALUE_INVALID/u);
  assert.equal(qualifySourceScalarValue({type:'jsonb',notNull:true},null,'JSON_VALUE').encoding,'JSON_VALUE');
  assert.throws(()=>check('jsonb',null),/TYPED_VALUE_INVALID/u);
  assert.equal(qualifySourceScalarValue({type:'jsonb',notNull:false},null).encoding,'SQL_NULL');
  const cycle:Record<string,unknown>={};cycle.self=cycle;
  for(const bad of [cycle,{a:undefined},[undefined],new Date(),{n:NaN},Object.defineProperty({a:1},'hidden',{value:2})])
    assert.throws(()=>check('jsonb',bad),/TYPED_VALUE_INVALID/u);
});

test('A2 prepared row covers every column but leaves defaults, missing values and foreign authority unresolved',()=>{
  const installed=[{relation:'inventory_balances',columns:[
    {name:'id',type:'uuid',notNull:true,identity:'',generated:'',default:'gen_random_uuid()'},
    {name:'on_hand_quantity',type:'integer',notNull:true,identity:'',generated:'',default:'0'},
    {name:'reserved_quantity',type:'integer',notNull:true,identity:'',generated:'',default:'0'},
    {name:'available_quantity',type:'integer',notNull:false,identity:'',generated:'s',default:'(on_hand_quantity - reserved_quantity)'},
    {name:'updated_at',type:'timestamp with time zone',notNull:false,identity:'',generated:'',default:'now()'},
  ]}];
  const values={on_hand_quantity:7,reserved_quantity:2};
  const result=qualifyPreparedSourceRow(installed,'public.inventory_balances',values);
  assert.equal(result.columns.length,5);assert.deepEqual(result.unresolvedColumns,['id','updated_at']);
  assert.equal(result.columns[3].typed.value,'5');assert.equal(result.fullRowValuesPresent,false);
  assert.equal(assertPreparedSourceRow(installed,'public.inventory_balances',values,[],result),true);
  for(const flag of ['postgresCastParityProven','defaultsEvaluated','foreignKeysQualified','fullTypedWriteTuplesQualified',
    'durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(result[flag],false);
  for(const bad of [{...values,available_quantity:6},{on_hand_quantity:0,reserved_quantity:0,available_quantity:null},
    {...values,on_hand_quantity:2147483647,reserved_quantity:-1},{...values,extra:1}])
    assert.throws(()=>qualifyPreparedSourceRow(installed,'public.inventory_balances',bad),/TYPED_(?:ROW|VALUE)_INVALID/u);
  const partial=qualifyPreparedSourceRow(installed,'public.inventory_balances',{});
  assert.equal(partial.columns[3].state,'GENERATED_INPUT_REQUIREMENT');assert.equal(partial.unresolvedColumns.length,5);
  const forged=structuredClone(result);forged.executionAuthority=true;
  assert.throws(()=>assertPreparedSourceRow(installed,'public.inventory_balances',values,[],forged),/TYPED_ROW_CHANGED/u);
});

const transitiveSchemaFixture=()=>{
  const time='timestamp with time zone';
  const specs={
    stock_alerts:[['id','uuid',true,'gen_random_uuid()'],['product_id','uuid',true,null],['warehouse_id','uuid',true,null],
      ['severity','text',true,null],['status','text',true,"'active'::text"],['available_quantity','integer',true,null],
      ['threshold_quantity','integer',true,null],['first_triggered_at',time,true,'now()'],['last_updated_at',time,true,'now()'],['resolved_at',time,false,null]],
    stock_alert_reads:[['stock_alert_id','uuid',true,null],['user_id','uuid',true,null],['read_at',time,true,'now()']],
    automation_events:[['id','uuid',true,'gen_random_uuid()'],['event_key','text',true,null],['event_type','text',true,null],
      ['entity_id','uuid',true,null],['payload','jsonb',true,"'{}'::jsonb"],['created_at',time,true,'now()']],
  };
  return Object.entries(specs).map(([relation,cols])=>({relation,columns:cols.map(([name,type,notNull,expression])=>
    ({name,type,notNull,default:expression,identity:'',generated:''}))}));
};

const stockStageFixture=(absent=false)=>{
  const productId='92400000-0000-0000-0000-000000000101',warehouseId='92400000-0000-0000-0000-000000000201';
  const alert='92400000-0000-0000-0000-000000000401',user='92400000-0000-0000-0000-000000000001';
  return {targets:[{productId,warehouseId,productName:'صنف',warehouseName:'مستودع',active:true,threshold:2,
    beforeAvailable:absent?null:0,afterAvailable:1}],alerts:absent?[]:[{id:alert,product_id:productId,warehouse_id:warehouseId,
    severity:'out_of_stock',status:'active',available_quantity:0,threshold_quantity:2,
    first_triggered_at:'2026-10-06T00:00:00Z',last_updated_at:'2026-10-06T00:00:00Z',resolved_at:null}],
    reads:absent?[]:[{stock_alert_id:alert,user_id:user,read_at:'2026-10-06T00:00:00Z'}],events:[]};
};

test('Receipt V2 stock candidates bind future alert across ordered stages without granting ownership',()=>{
  const snapshot=stockStageFixture(true),t=snapshot.targets[0],clock={timestampUtc:'2026-10-06T00:00:00Z',epochFloorSeconds:'1791244800'};
  const allocation=[{productId:t.productId,warehouseId:t.warehouseId,stage:'ZERO_INSERT',
    alertId:'92600000-0000-0000-0000-000000000401',eventId:'92600000-0000-0000-0000-000000000501'},
  {productId:t.productId,warehouseId:t.warehouseId,stage:'FINAL_UPDATE',alertId:null,eventId:'92600000-0000-0000-0000-000000000502'}];
  const derive=(a=allocation,s=snapshot)=>resolveReceiptV2StockCandidateRequirements(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),s,clock,a,[]);
  const result=derive();assert.equal(result.stages.length,2);
  assert.equal(result.stages[1].before.id,allocation[0].alertId);assert.equal(result.stages[1].after.id,allocation[0].alertId);
  assert.equal(result.stages[0].eventKey,`stock_alert:${allocation[0].alertId}:out_of_stock:${clock.epochFloorSeconds}`);
  assert.equal(result.stages[1].eventKey,`stock_alert:${allocation[0].alertId}:low_stock:${clock.epochFloorSeconds}`);
  for(const key of ['clockAuthorityQualified','durableIdentityClaimed','absencePredicatesFenced','afterWaitRevalidated','locksHeld','executionAuthority'])assert.equal(result[key],false);
  for(const change of [(a:typeof allocation)=>a.pop(),(a:typeof allocation)=>a.reverse(),
    (a:typeof allocation)=>{a[1].eventId=a[0].eventId;},(a:typeof allocation)=>{a[0].alertId=t.productId;},
    (a:typeof allocation)=>{a[1].alertId='92600000-0000-0000-0000-000000000402';},
    (a:typeof allocation)=>{a[0].eventId=a[0].alertId;},(a:typeof allocation)=>{a[0].eventId='00000000-0000-0000-0000-000000000000';}]){
    const bad=structuredClone(allocation);change(bad);assert.throws(()=>derive(bad),/STOCK_CANDIDATE_INVALID/u);
  }
  allocation[0].alertId='92600000-0000-0000-0000-000000000499';
  assert.notEqual(result.allocation[0].alertId,allocation[0].alertId,'detached candidate snapshots');
});

test('Receipt V2 stock candidate exact global key reuse preserves unrelated first-wins content',()=>{
  const snapshot=stockStageFixture(),t=snapshot.targets[0],clock={timestampUtc:'1970-01-01T00:00:00.000001Z',epochFloorSeconds:'0'};
  const key=`stock_alert:${snapshot.alerts[0].id}:low_stock:0`;
  const event={id:'92600000-0000-0000-0000-000000000501',entity_id:'92600000-0000-0000-0000-000000000999',
    event_key:key,event_type:'out_of_stock',payload:{sentinel:'first-wins'},created_at:'1969-01-01T00:00:00Z'};
  const allocation=[{productId:t.productId,warehouseId:t.warehouseId,stage:'FINAL_UPDATE',alertId:null,eventId:null}];
  const derive=(a=allocation,e=[event])=>resolveReceiptV2StockCandidateRequirements(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),snapshot,clock,a,e);
  assert.deepEqual(derive().stages[0].storedEvent,event);assert.equal(derive().stages[0].eventDisposition,'REUSE_PREEXISTING');
  assert.throws(()=>derive([{...allocation[0],eventId:'92600000-0000-0000-0000-000000000502'}]),/STOCK_CANDIDATE_INVALID/u);
  assert.throws(()=>derive(allocation,[event,event]),/STOCK_CANDIDATE_INVALID/u);
  assert.throws(()=>derive(allocation,[]),/STOCK_CANDIDATE_INVALID/u,'absence changes exact conditional allocation');
});

test('Receipt V2 stock stages bind full OLD/NEW columns and distinct conditional UUID/time requirements',()=>{
  for(const absent of [true,false]){
    const snapshot=stockStageFixture(absent),installed=transitiveSchemaFixture();
    const plan=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,installed,snapshot);
    assert.equal(assertReceiptV2StockStages(receiptSources,receiptMigrationSources,installed,snapshot,plan),true);
    assert.equal(plan.stages.length,absent?2:1);
    assert.equal(plan.identityRequirements.filter(n=>n.relation==='public.stock_alerts').length,absent?1:0);
    const final=plan.stages.at(-1)!;
    assert.equal(final.deletedReads.length,absent?0:1);
    assert.equal(Object.keys(final.alert.after).length,10);
    assert.equal(Object.keys(final.outbox!.columns).length,6);
    assert.equal(final.alert.after.available_quantity.value,1);
    assert.equal(final.alert.after.last_updated_at.requirement,'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION');
    assert.equal(final.outbox!.onConflict,'PRESERVE_EXACT_PREEXISTING_EVENT_CONTENT_NO_NEW_IDENTITY');
    for(const flag of ['sourcePlanValidatedByThisAnalysis','actualEventValuesAllocated','futureIdentitySetResolved',
      'paymentUnionComplete','durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(plan[flag],false);
  }
});

test('Receipt V2 ordered stock stages consume a read identity once and preserve resolved history',()=>{
  const snapshot=stockStageFixture();snapshot.targets[0].beforeAvailable=null;
  snapshot.alerts[0].severity='low_stock';snapshot.alerts[0].available_quantity=1;
  const plan=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),snapshot);
  assert.deepEqual(plan.stages.map(s=>s.deletedReads.length),[1,0]);
  assert.equal(plan.stages[1].alert.before.severity.value,'out_of_stock');
  assert.equal(plan.stages[0].alert.after.id.value,plan.stages[1].alert.after.id.value);
  snapshot.targets[0].beforeAvailable=0;snapshot.targets[0].afterAvailable=3;
  const resolved=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),snapshot);
  assert.equal(resolved.stages[0].alert.after.status.value,'resolved');
  assert.equal(resolved.stages[0].outbox,null);assert.equal(resolved.stages[0].deletedReads.length,0);
});

test('Receipt V2 multi-SKU stage identity remains deterministic and rejects foreign or duplicate outbox evidence',()=>{
  const snapshot=stockStageFixture(true),other=structuredClone(snapshot.targets[0]);
  other.productId='92400000-0000-0000-0000-000000000102';other.afterAvailable=3;
  snapshot.targets.unshift(other);
  const plan=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),snapshot);
  assert.deepEqual(plan.stages.map(s=>s.productId),[snapshot.targets[1].productId,snapshot.targets[1].productId,other.productId,other.productId]);
  assert.equal(new Set(plan.identityRequirements.map(n=>n.slot)).size,plan.identityRequirements.length);
  const original=stockStageFixture(),alert=original.alerts[0];
  const event={id:'92400000-0000-0000-0000-000000000501',event_key:'stock_alert:'+alert.id+':out_of_stock:1',
    event_type:'out_of_stock',entity_id:alert.id,payload:{sentinel:'immutable'},created_at:'2026-10-06T00:00:00Z'};
  for(const rows of [[event,event],[event,{...event,id:'92400000-0000-0000-0000-000000000502'}],
    [{...event,entity_id:original.targets[0].productId,event_key:'foreign'}]]){
    assert.throws(()=>deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),{...original,events:rows}),/STOCK_STAGES_INVALID/u);
  }
  const valid=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),{...original,events:[event]});
  assert.deepEqual(valid.stages[0].outbox.beforeCandidates,[event]);
  assert.equal(valid.futureIdentitySetResolved,false);
});

test('Receipt V2 captured event keys preserve exact conflict content and leave new UUID ownership unfilled',()=>{
  const snapshot=stockStageFixture(),installed=transitiveSchemaFixture();
  const clock={timestampUtc:'1970-01-01T00:00:00.999999+00:00',epochFloorSeconds:'0'};
  const key='stock_alert:'+snapshot.alerts[0].id+':low_stock:0';
  const fresh=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,snapshot,clock);
  assert.equal(fresh.decisions[0].outbox.eventKey,key);
  assert.equal(fresh.decisions[0].outbox.action,'REQUIRE_SERVER_EVENT_UUID_AND_FRESH_ABSENCE_FENCE');
  assert.equal(fresh.decisions[0].outbox.newRowWithoutId.payload.updatedAt,clock.timestampUtc);
  assert.equal('id' in fresh.decisions[0].outbox.newRowWithoutId,false);
  const event={id:'92400000-0000-0000-0000-000000000501',event_key:key,event_type:'low_stock',
    entity_id:snapshot.alerts[0].id,payload:{sentinel:'do-not-rewrite'},created_at:'1969-12-31T23:59:59Z'};
  const withEvent={...snapshot,events:[event]};
  const reused=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,withEvent,clock);
  assert.deepEqual(reused.decisions[0].outbox.capturedRow,event);
  assert.equal(reused.decisions[0].outbox.action,'PRESERVE_EXACT_CAPTURED_EVENT');
  assert.equal(reused.decisions[0].outbox.newIdentitySlot,null);
  assert.equal(assertReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,withEvent,clock,reused),true);
  for(const flag of ['sourcePlanValidatedByThisAnalysis','clockAuthorityQualified','futureIdentitySetResolved',
    'absenceFenceHeld','durableIdentityClaimed','fullTypedWriteTuplesQualified','locksHeld','executionAuthority'])assert.equal(reused[flag],false);
  event.payload.sentinel='mutated';assert.equal(reused.decisions[0].outbox.capturedRow.payload.sentinel,'do-not-rewrite');
});

test('Receipt V2 captured event resolution keeps future alerts unresolved and resolve/stable stages event-free',()=>{
  const clock={timestampUtc:'1969-12-31T23:59:59.999999Z',epochFloorSeconds:'-1'},installed=transitiveSchemaFixture();
  const future=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,stockStageFixture(true),clock);
  assert.ok(future.decisions.length>0);assert.ok(future.decisions.every(s=>s.status==='UNRESOLVED_FUTURE_ALERT_IDENTITY'&&s.eventKey===null));
  for(const resolve of [false,true]){
    const snapshot=stockStageFixture();snapshot.alerts[0].severity='low_stock';snapshot.targets[0].beforeAvailable=1;
    snapshot.targets[0].afterAvailable=resolve?3:2;
    const value=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,snapshot,clock);
    assert.equal(value.decisions[0].outbox,null);assert.equal(value.decisions[0].after.last_updated_at,clock.timestampUtc);
  }
  const negative=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,stockStageFixture(),clock);
  assert.ok(negative.decisions[0].outbox.eventKey.endsWith(':-1'));
});

test('Receipt V2 captured event clock and output reject precision, calendar, epoch and authority substitution',()=>{
  const snapshot=stockStageFixture(),installed=transitiveSchemaFixture();
  const clock={timestampUtc:'1970-01-01T00:00:00.000001Z',epochFloorSeconds:'0'};
  for(const bad of [{...clock,epochFloorSeconds:'1'},{...clock,epochFloorSeconds:0},{...clock,epochFloorSeconds:'-0'},
    {...clock,timestampUtc:'2026-02-30T00:00:00Z'},{...clock,timestampUtc:'1970-01-01T00:00:60Z'},
    {...clock,timestampUtc:'1970-01-01T00:00:00.0000001Z'},{...clock,timestampUtc:'1970-01-01T03:00:00+03:00'},
    {...clock,hidden:undefined},{...clock,timestampUtc:null}]){
    assert.throws(()=>resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,snapshot,bad),/EVENT_CLOCK_INVALID/u);
  }
  const valid=resolveReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,snapshot,clock);
  for(const change of [v=>{v.decisions[0].outbox.eventKey='foreign';},v=>{v.decisions[0].after.id=snapshot.targets[0].productId;},
    v=>{v.decisions[0].outbox.newRowWithoutId.payload.availableQuantity=999;},v=>{v.executionAuthority=true;},v=>{v.hidden=undefined;}]){
    const bad=structuredClone(valid);change(bad);
    assert.throws(()=>assertReceiptV2CapturedAlertEvents(receiptSources,receiptMigrationSources,installed,snapshot,clock,bad),/CAPTURED_EVENTS_CHANGED/u);
  }
});

test('Receipt V2 stock stages reject duplicate/foreign/malformed source identity and output forgery',()=>{
  for(const corrupt of [
    s=>{s.targets.push(structuredClone(s.targets[0]));},s=>{s.alerts.push(structuredClone(s.alerts[0]));},
    s=>{s.reads.push(structuredClone(s.reads[0]));},s=>{s.reads[0].stock_alert_id=s.targets[0].productId;},
    s=>{s.alerts[0].warehouse_id=s.targets[0].productId;},s=>{s.targets[0].afterAvailable=0;},
    s=>{s.targets[0].afterAvailable=1.2;},s=>{s.targets[0].beforeAvailable=-(2**33);},
    s=>{s.alerts[0].extra=true;},s=>{s.targets[0].active=null;},
  ]){const snapshot=stockStageFixture();corrupt(snapshot);
    assert.throws(()=>deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,transitiveSchemaFixture(),snapshot),/STOCK_STAGES_INVALID|ALERT_TRANSITION_INVALID/u);}
  const snapshot=stockStageFixture(),installed=transitiveSchemaFixture();
  const valid=deriveReceiptV2StockStages(receiptSources,receiptMigrationSources,installed,snapshot);
  for(const corrupt of [p=>{p.executionAuthority=true;},p=>{p.stages[0].deletedReads=[];},
    p=>{p.stages[0].alert.after.available_quantity.value=99;},p=>{p.stages[0].hidden=undefined;}]){
    const wrong=structuredClone(valid);corrupt(wrong);
    assert.throws(()=>assertReceiptV2StockStages(receiptSources,receiptMigrationSources,installed,snapshot,wrong),/STOCK_STAGES_CHANGED/u);
  }
});

test('Receipt V2 transitive full-column requirements preserve six source writes and unallocated identities',()=>{
  const installed=transitiveSchemaFixture(),ledger=inspectReceiptV2TransitiveRowRequirements(receiptSources,receiptMigrationSources,installed);
  assert.equal(ledger.tables.reduce((n,t)=>n+t.columns.length,0),19);assert.equal(ledger.writes.length,6);
  assert.equal(assertReceiptV2TransitiveRowRequirements(receiptSources,receiptMigrationSources,installed,ledger),true);
  const alerts=ledger.writes.find(w=>w.relation==='public.stock_alerts'&&w.verb==='INSERT INTO')!;
  assert.equal(alerts.columns.find(c=>c.name==='id')!.requirement,'ACTUAL_UUID_DEFAULT_ALLOCATION_AND_CLAIM_REQUIRED');
  assert.equal(alerts.columns.find(c=>c.name==='resolved_at')!.value,null);
  assert.equal(ledger.writes.filter(w=>w.verb==='DELETE FROM')[0].identityRequirement,'EXACT_CAPTURED_STOCK_ALERT_ID_USER_ID_SET');
  for(const flag of ['futureIdentitySetDerived','foreignKeysInstalledValidated','invokerClosureQualified','defaultsEvaluated',
    'typedFullRowsQualified','durableIdentityClaimed','executionAuthority'])assert.equal(ledger[flag],false);
});

test('Receipt V2 transitive requirements reject missing/extra/duplicate tables and every installed column drift',()=>{
  for(const change of [
    (x:ReturnType<typeof transitiveSchemaFixture>)=>{x.pop();},
    (x:ReturnType<typeof transitiveSchemaFixture>)=>{x.push(structuredClone(x[0]));},
    (x:ReturnType<typeof transitiveSchemaFixture>)=>{x[1]=structuredClone(x[0]);},
    (x:ReturnType<typeof transitiveSchemaFixture>)=>{x[0].columns.pop();},
    (x:ReturnType<typeof transitiveSchemaFixture>)=>{x[0].columns.push({...x[0].columns[0],name:'extra'});},
    ...['name','type','default','identity','generated','notNull'].map(field=>(x:ReturnType<typeof transitiveSchemaFixture>)=>{
      x[0].columns[0][field]=field==='notNull'?false:'changed';}),
  ]){const installed=transitiveSchemaFixture();change(installed);
    assert.throws(()=>inspectReceiptV2TransitiveRowRequirements(receiptSources,receiptMigrationSources,installed),/TRANSITIVE_SCHEMA_DRIFT/u);}
});

test('Receipt V2 transitive ledger rejects source-expression substitution, hidden undefined and ownership forgery',()=>{
  const installed=transitiveSchemaFixture(),valid=inspectReceiptV2TransitiveRowRequirements(receiptSources,receiptMigrationSources,installed);
  for(const corrupt of [
    (l:typeof valid)=>{l.writes[1]=structuredClone(l.writes[0]);},
    (l:typeof valid)=>{l.writes[1].columns[0].ownershipQualified=true;},
    (l:typeof valid)=>{l.executionAuthority=true;},
    (l:typeof valid)=>{l.writes[0].columns[0].sourceBinding=undefined;},
  ]){const wrong=structuredClone(valid);corrupt(wrong);
    assert.throws(()=>assertReceiptV2TransitiveRowRequirements(receiptSources,receiptMigrationSources,installed,wrong),/TRANSITIVE_REQUIREMENTS_CHANGED/u);}
});

test('Receipt V2 transitive stock/payment source pins remain distinct from installed ownership and future claims',()=>{
  const c=inspectReceiptV2TriggerEffectContract(receiptSources,receiptMigrationSources);
  assert.equal(c.nodes.length,6);assert.equal(c.stages.length,5);
  assert.equal(c.nodes.filter(n=>n.sourceOwner===null).length,5);
  for(const flag of ['sourceOwnersResolved','installedCatalogValidated','defaultsEvaluated','transitiveIdentityOwned',
    'fullWriteTuplesQualified','locksHeld','executionAuthority'])assert.equal(c[flag],false);
  const crlf=new Map([...receiptMigrationSources].map(([name,source])=>[name,source.replace(/\n/gu,'\r\n')]));
  assert.deepEqual(inspectReceiptV2TriggerEffectContract(receiptSources,crlf),c);
});

test('Receipt V2 transitive source requirements reject body/owner/path/ACL drift and missing graph nodes',()=>{
  const c=inspectReceiptV2TriggerEffectContract(receiptSources,receiptMigrationSources);
  for(const node of c.nodes)for(const key of ['body','owner','searchPath','securityMode','acl','sourceMigration']){
    const changed=new Map(receiptSources),row=structuredClone(changed.get(node.signature)!);
    if(key==='acl')row.acl={...row.acl,authenticated:true};
    else if(key==='body')row.body+='\n-- drift';
    else if(key==='owner')row.owner='qa_unapproved_owner';
    else if(key==='securityMode')row.securityMode=row.securityMode==='DEFINER'?'INVOKER':'DEFINER';
    else row[key]='changed';
    changed.set(node.signature,row);
    assert.throws(()=>inspectReceiptV2TriggerEffectContract(changed,receiptMigrationSources),/SOURCE_DRIFT/u);
  }
  for(const node of c.nodes){const changed=new Map(receiptSources);changed.delete(node.signature);
    assert.throws(()=>inspectReceiptV2TriggerEffectContract(changed,receiptMigrationSources),/SOURCE_DRIFT/u);}
});

test('Receipt V2 alert transition model preserves actual insert/update/resolve and read/outbox decisions',()=>{
  const c=inspectReceiptV2TriggerEffectContract(receiptSources,receiptMigrationSources);
  const model=(available:number,previousSeverity:null|'low_stock'|'out_of_stock',threshold:number|null=2,active=true)=>
    deriveReceiptV2AlertTransition(c,{active,available,threshold,previousSeverity});
  assert.deepEqual(model(0,null),{action:'INSERT',severity:'out_of_stock',threshold:2,deleteReads:false,emitOutbox:true,newAlertIdentityRequired:true});
  assert.deepEqual(model(1,'out_of_stock'),{action:'UPDATE',severity:'low_stock',threshold:2,deleteReads:true,emitOutbox:true,newAlertIdentityRequired:false});
  assert.equal(model(2,'low_stock').emitOutbox,false);assert.equal(model(2,'low_stock').deleteReads,false);
  assert.equal(model(3,'low_stock').action,'RESOLVE');assert.equal(model(3,null).action,'NONE');
  assert.equal(model(1,'out_of_stock',2,false).action,'RESOLVE_INACTIVE');
  assert.equal(model(1,'out_of_stock',2,false).deleteReads,false);
  assert.equal(model(0,null,-9).threshold,0);assert.equal(model(0,null,null).threshold,0);
});

test('Receipt V2 alert decisions reject malformed quantity/state and forged authority rather than coercing input',()=>{
  const c=inspectReceiptV2TriggerEffectContract(receiptSources,receiptMigrationSources);
  const valid={active:true,available:1,threshold:2,previousSeverity:null};
  for(const bad of [null,{...valid,available:1.5},{...valid,available:'1'},{...valid,available:2**31},
    {...valid,available:NaN},{...valid,threshold:'2'},{...valid,active:null},{...valid,previousSeverity:'resolved'},
    {...valid,extra:true}])assert.throws(()=>deriveReceiptV2AlertTransition(c,bad),/ALERT_TRANSITION_INVALID/u);
  for(const bad of [null,{...c,executionAuthority:true},{...c,transitiveIdentityOwned:true}])
    assert.throws(()=>deriveReceiptV2AlertTransition(bad,valid),/ALERT_TRANSITION_INVALID/u);
});

const historicalLiterals=()=>[
  {relation:'public.supplier_receipts',column:'is_archived',type:'boolean',notNull:true,expression:'false'},
  {relation:'public.supplier_payments',column:'is_reversed',type:'boolean',notNull:true,expression:'false'},
  {relation:'public.supplier_financial_invoice_identities',column:'is_active',type:'boolean',notNull:true,expression:'true'},
];

test('Receipt V2 literal identities are independently historical-source pinned and LF/CRLF equivalent',()=>{
  const pinned=inspectReceiptV2LiteralSourcePins(receiptMigrationSources,historicalLiterals());
  const crlf=new Map([...receiptMigrationSources].map(([n,s])=>[n,s.replace(/\n/gu,'\r\n')]));
  assert.deepEqual(inspectReceiptV2LiteralSourcePins(crlf,historicalLiterals().reverse()),pinned);
  assert.deepEqual(pinned.pins.map(p=>p.decoded.value),[false,false,true]);
  for(const flag of ['defaultsEvaluated','fullWriteTuplesQualified','ownershipQualified','executionAuthority'])assert.equal(pinned[flag],false);
});

test('Receipt V2 literal exact-set pins reject equal-count substitution, duplicate, missing and tuple drift',()=>{
  for(const mutate of [
    (r:ReturnType<typeof historicalLiterals>)=>{r[1]={...r[0]};},
    (r:ReturnType<typeof historicalLiterals>)=>{r.pop();},
    (r:ReturnType<typeof historicalLiterals>)=>{r.push({...r[0]});},
    ...(['relation','column','type','expression'] as const).map(k=>(r:ReturnType<typeof historicalLiterals>)=>{r[0][k]='wrong';}),
    (r:ReturnType<typeof historicalLiterals>)=>{r[0].notNull=false;},
  ]){const rows=historicalLiterals();mutate(rows);assert.throws(()=>inspectReceiptV2LiteralSourcePins(receiptMigrationSources,rows),/LITERAL_EXACT_SET_INVALID/u);}
  assert.throws(()=>inspectReceiptV2LiteralSourcePins(receiptMigrationSources,null),/LITERAL_EXACT_SET_INVALID/u);
});

test('Receipt V2 historical literal pins reject content drift and absent sources, not just changed defaults',()=>{
  for(const name of ['009_direct_goods_receiving.sql','016_safe_paid_supplier_receipt_reversal.sql','113_configurable_parcel_receiving_and_exact_wac.sql']){
    const changed=new Map(receiptMigrationSources);changed.set(name,changed.get(name)!+'\n-- unexpected drift\n');
    assert.throws(()=>inspectReceiptV2LiteralSourcePins(changed,historicalLiterals()),/LITERAL_SOURCE_DRIFT/u);
    changed.delete(name);assert.throws(()=>inspectReceiptV2LiteralSourcePins(changed,historicalLiterals()),/LITERAL_SOURCE_DRIFT/u);
  }
});

test('Receipt V2 literal requirements preserve exact integers/decimals and typed literal semantics without SQL',()=>{
  assert.deepEqual(decodeReceiptV2LiteralRequirement('9223372036854775807','bigint'),
    {type:'bigint',value:'9223372036854775807',encoding:'EXACT_INTEGER_TEXT'});
  assert.deepEqual(decodeReceiptV2LiteralRequirement('-9223372036854775808','bigint'),
    {type:'bigint',value:'-9223372036854775808',encoding:'EXACT_INTEGER_TEXT'});
  assert.equal(decodeReceiptV2LiteralRequirement('0.000001','numeric(20,6)').value,'0.000001');
  assert.equal(decodeReceiptV2LiteralRequirement('false','boolean').value,false);
  assert.equal(decodeReceiptV2LiteralRequirement("'owner''s'::text",'text').value,"owner's");
  assert.equal(decodeReceiptV2LiteralRequirement("'عربي'::text",'text').value,'عربي');
  assert.deepEqual(decodeReceiptV2LiteralRequirement("'{}'::jsonb",'jsonb').value,{});
  assert.deepEqual(decodeReceiptV2LiteralRequirement("'[]'::jsonb",'jsonb').value,[]);
});

test('Receipt V2 literal decoder rejects executable/default domains, coercion, overflow and unknown semantics',()=>{
  for(const [expression,type] of [
    ['32768','smallint'],['-32769','smallint'],['2147483648','integer'],['9223372036854775808','bigint'],
    ['0.0000001','numeric(20,6)'],['1000','numeric(5,2)'],['1e3','numeric'],['NaN','numeric'],
    ['true','integer'],['42','boolean'],["'x'::text",'integer'],["'false'::boolean",'boolean'],
    ["'{\"n\":9007199254740993}'::jsonb",'jsonb'],["'a\\b'::text",'text'],
    ['now()','timestamp with time zone'],['gen_random_uuid()','uuid'],["nextval('x')",'bigint'],
    ["'x'::text; SELECT 1",'text'],['1+1','integer'],[null,'text'],['0',null],
  ])assert.throws(()=>decodeReceiptV2LiteralRequirement(expression,type),/ADMISSION_RECEIPT_V2_LITERAL_/u);
});

const installedValueFixture=()=>{
  const writes=inspectReceiptV2DeferredValueContract(receiptSources,receiptMigrationSources).writes;
  return [...new Set(writes.map(w=>w.relation))].sort().map(relation=>({relation:relation.replace('public.',''),
    columns:[...new Set(['id',...writes.filter(w=>w.relation===relation).flatMap(w=>w.explicitColumns??[])])].map(name=>({
      name,type:'uuid',notNull:false,identity:'',generated:'',default:name==='id'?'gen_random_uuid()':null}))}));
};

const rowRequirementFixture=()=>{
  const tables=installedValueFixture();
  for(const literal of historicalLiterals())tables.find(t=>'public.'+t.relation===literal.relation)!.columns.push({
    name:literal.column,type:literal.type,notNull:literal.notNull,identity:'',generated:'',default:literal.expression});
  const balance=tables.find(t=>t.relation==='inventory_balances')!;
  for(const column of balance.columns.filter(c=>['on_hand_quantity','reserved_quantity'].includes(c.name)))column.type='integer';
  balance.columns.push({name:'available_quantity',type:'integer',notNull:false,identity:'',generated:'s',default:'(on_hand_quantity - reserved_quantity)'},
    {name:'updated_at',type:'timestamp with time zone',notNull:true,identity:'',generated:'',default:'now()'},
    {name:'nullable_extra',type:'text',notNull:false,identity:'',generated:'',default:null});
  tables.find(t=>t.relation==='inventory_movements')!.columns.push({name:'mutation_sequence',type:'bigint',notNull:true,identity:'',generated:'',default:null});
  return tables;
};

// Synthetic shape/identity controls only; live source-value correctness is
// separately proven by fresh PostgreSQL assert_receipt_v2_item_rows_v1.
const itemProjectionFixture=(kind='DIRECT_V2')=>{
  const installed=rowRequirementFixture(),ledger=inspectReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed);
  const id=(n:number)=>`92500000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const operation=id(1),header=id(2),product=id(3),clients=[id(4),id(5)];
  const prefix=kind==='DIRECT_V2'?'public.supplier_receipt':'public.purchase_receipt';
  const source=kind==='DIRECT_V2'?'supplier_receipt_id':'purchase_receipt_id';
  const row=(relation:string)=>Object.fromEntries(ledger.writes.find(w=>w.relation===relation)!.columns
    .filter(c=>c.domain==='EXPLICIT_SOURCE_VALUE'&&c.requirement!=='ACTUAL_TRANSACTION_TIMESTAMP').map(c=>[c.name,null]));
  const flags={fullWriteTuples:false,defaultsQualified:false,stockEffectIdentitiesComplete:false,durableIdentityClaimed:false,
    numberClaimed:false,absencePredicatesFenced:false,locksHeld:false,heldContextAuthority:false,executionAuthority:false};
  const lineBindings=clients.map(clientLineId=>({clientLineId}));
  const componentBindings=clients.map(clientLineId=>({identity:clientLineId+'|'+product,clientLineId,productId:product}));
  const identityBindings=[{slotKey:'OPERATION',id:operation},{slotKey:'HEADER',id:header},
    ...clients.flatMap((c,i)=>[{slotKey:'LINE|'+c,id:id(10+i)},{slotKey:'ITEM|'+c+'|'+product,id:id(20+i)}])];
  const balance={...flags,version:'phase5-receipt-v2-balance-rows-v1',kind,
    candidates:{identityBindings,requirements:{prewrite:{allocation:{lineBindings,componentBindings}}}}};
  const inventory={...flags,version:'phase5-receipt-v2-inventory-rows-v1',kind,balancePlan:balance};
  const financial={...flags,version:'phase5-receipt-v2-financial-rows-v1',kind,inventoryPlan:inventory,
    operationWithoutResultAndTime:{id:operation},headerWithoutEventValues:{id:header,operation_id:operation}};
  const plan={...flags,version:'phase5-receipt-v2-item-rows-v1',kind,financialPlan:financial,
    commercialLines:clients.map((c,i)=>({identity:c,explicitRowWithoutFinalizedAt:{...row(prefix+'_commercial_lines'),
      id:id(10+i),operation_id:operation,[source]:header,client_line_id:c}})),
    items:clients.map((c,i)=>({identity:c+'|'+product,clientLineId:c,explicitRow:{...row(prefix+'_items'),
      id:id(20+i),operation_id:operation,[source]:header,commercial_line_id:id(10+i),product_id:product}}))};
  return {installed,plan};
};

test('line/item bridge is bijective per client/component, kind-specific, detached and explicitly non-authoritative',()=>{
  for(const kind of ['DIRECT_V2','PO_V2']){
    const {installed,plan}=itemProjectionFixture(kind);
    const bound=bindReceiptV2ItemProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan);
    assert.equal(bound.items.length,2);assert.equal(bound.commercialLines.length,2);
    assert.notEqual(bound.items[0].identity,bound.items[1].identity);
    assert.equal(assertReceiptV2ItemProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan,bound),true);
    for(const row of bound.items)assert.ok(row.columns.filter(c=>c.requirement==='BOUND_SOURCE_PROJECTION_VALUE').every(c=>c.projectionValidationRequired&&!c.typedValueFullyQualified));
    assert.ok(bound.commercialLines.every(r=>r.columns.find(c=>c.name==='finalized_at')?.requirement==='ACTUAL_TRANSACTION_TIMESTAMP'));
    for(const flag of ['sourcePlanValidatedByThisAnalysis','actualEventValuesAllocated','fullWriteTuplesQualified',
      'triggerEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(bound[flag],false);
    plan.items[0].explicitRow.product_id='changed after binding';
    assert.notEqual(bound.items[0].columns.find(c=>c.name==='product_id')?.value,'changed after binding');
  }
});

test('line/item bridge rejects equal-count substitution and incomplete or foreign identity/column coverage',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const corrupt of [
    p=>{p.items[1]=structuredClone(p.items[0]);},p=>{p.items.pop();},p=>{p.items.push(structuredClone(p.items[0]));},
    p=>{p.commercialLines[1]=structuredClone(p.commercialLines[0]);},
    p=>{p.items[0].explicitRow.commercial_line_id=p.items[1].explicitRow.commercial_line_id;},
    p=>{p.items[0].explicitRow.operation_id=p.items[0].explicitRow.id;},
    p=>{p.items[0].explicitRow.product_id=p.items[0].explicitRow.id;},
    p=>{delete p.items[0].explicitRow.batch_number;delete p.items[0].explicitRow.received_quantity;},
    p=>{p.items[0].explicitRow.finalized_at='invented';},
    p=>{p.commercialLines[0].explicitRowWithoutFinalizedAt.finalized_at='invented';},
    p=>{p.items[0].explicitRow.exact_unit_cost_in_minor_units=Number.MAX_SAFE_INTEGER+1;},
    p=>{p.executionAuthority=true;},p=>{p.kind='FOREIGN';},
    p=>{p.financialPlan.inventoryPlan.balancePlan.candidates.identityBindings[0].id='00000000-0000-0000-0000-000000000000';},
  ]){
    const {installed,plan}=itemProjectionFixture(kind);corrupt(plan);
    assert.throws(()=>bindReceiptV2ItemProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan),/ITEM_PROJECTION_INVALID/u);
  }
});

test('bound item requirements reject value/result forgery but never claim to validate an arbitrary plan against DB truth',()=>{
  const {installed,plan}=itemProjectionFixture(),bound=bindReceiptV2ItemProjectionRequirements(receiptSources,receiptMigrationSources,installed,'DIRECT_V2',plan);
  for(const corrupt of [
    b=>{b.items[1]=structuredClone(b.items[0]);},b=>{b.items[0].columns[0].value='foreign';},
    b=>{b.sourcePlanValidatedByThisAnalysis=true;},b=>{b.executionAuthority=true;},
  ]){const changed=structuredClone(bound);corrupt(changed);
    assert.throws(()=>assertReceiptV2ItemProjectionRequirements(receiptSources,receiptMigrationSources,installed,'DIRECT_V2',plan,changed),/BOUND_REQUIREMENTS_CHANGED/u);}
  assert.equal(bound.sourcePlanValidationRequired,'FRESH_DB_ASSERT_WITH_CAPTURED_REQUEST_AND_ALLOCATION');
});

// Deliberately synthetic structure, not a substitute for DB source rederivation.
const primaryProjectionFixture=(kind='DIRECT_V2',withOptionalRows=false)=>{
  const {installed,plan}=itemProjectionFixture(kind),f=plan.financialPlan,i=f.inventoryPlan;
  const candidates=i.balancePlan.candidates,p=candidates.requirements.prewrite;
  const id=(n:number)=>`92500000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const source=kind==='DIRECT_V2'?'supplier_receipt':'purchase_receipt',fk=source+'_id';
  const ledger=inspectReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed);
  const prefix=kind==='DIRECT_V2'?'public.create_direct_supplier_receipt_v2(':'public.receive_purchase_order_v2(';
  const row=(relation:string,deferred:string[],inventory=false)=>Object.fromEntries(ledger.writes.find(w=>w.relation===relation
    &&w.signature.startsWith(inventory?'public.phase2_apply_inventory_and_wac_internal(':prefix))!.columns
    .filter(c=>c.domain==='EXPLICIT_SOURCE_VALUE'&&!deferred.includes(c.name)).map(c=>[c.name,null]));
  Object.assign(p,{actorContract:{profile:{id:id(30)}},normalizedKey:'key',fingerprint:'fingerprint',effectiveSupplierId:id(31),effectiveWarehouseId:id(32)});
  for(const c of p.allocation.componentBindings)Object.assign(c,{baseQuantity:3});
  Object.assign(f,{operationWithoutResultAndTime:{...row('public.business_operations',['result_snapshot','completed_at']),
    id:id(1),initiated_by:id(30),idempotency_key:'key',request_fingerprint:'fingerprint',operation_type:kind==='DIRECT_V2'?'supplier_receipt_v2':'purchase_order_receipt_v2'},
    headerWithoutEventValues:{...row('public.'+source+'s',['receipt_number','received_at','phase2_finalized_at']),
      id:id(2),operation_id:id(1),supplier_id:id(31),warehouse_id:id(32),received_by:id(30)},
    invoiceWithoutDefaults:null,paymentWithoutNotesTimeAndTrigger:null,
    resultWithoutReceiptNumber:{success:true,idempotent:false,operation_id:id(1),receipt_id:id(2)},
    auditWithoutEventValues:{...row('public.audit_logs',['details']),id:id(33),user_id:id(30),entity_id:id(2),
      entity_name:source+'s',action:kind==='DIRECT_V2'?'CREATE_DIRECT_SUPPLIER_RECEIPT_V2':'RECEIVE_PURCHASE_ORDER_V2',
      detailsWithoutReceiptNumberAndWac:{operation_id:id(1)}}});
  candidates.identityBindings.push({slotKey:'AUDIT',id:id(33)},{slotKey:'WAC|'+id(3),id:id(34)});
  if(withOptionalRows){
    candidates.identityBindings.push({slotKey:'INVOICE',id:id(35)},{slotKey:'PAYMENT',id:id(36)});
    Object.assign(f,{invoiceWithoutDefaults:{...row('public.supplier_financial_invoice_identities',[]),
      id:id(35),supplier_id:id(31),operation_id:id(1),[fk]:id(2),normalized_invoice_number:'invoice'},
      paymentWithoutNotesTimeAndTrigger:{...row('public.supplier_payments',['payment_date','notes']),
        id:id(36),supplier_id:id(31),operation_id:id(1),[fk]:id(2),created_by:id(30),amount_in_minor_units:50,payment_method:'cash'}});
  }
  Object.assign(i,{movements:p.allocation.componentBindings.map((c,index)=>{
    candidates.identityBindings.push({slotKey:'MOVEMENT|'+c.identity,id:id(40+index)});
    return {slotKey:'MOVEMENT|'+c.identity,componentIdentity:c.identity,explicitRow:{...row('public.inventory_movements',['notes'],true),
      id:id(40+index),operation_id:id(1),reference_id:id(2),reference_type:source,created_by:id(30),product_id:c.productId,
      warehouse_id:id(32),quantity:3,movement_type:'purchase_receipt',[source+'_item_id']:id(20+index)},
      sequenceRequirement:'ACTUAL_INSERT_TRIGGER_RETURNING_SEQUENCE',eventTimeRequirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION',actualReceiptNumberRequired:true};}),
    wacRows:[{slotKey:'WAC|'+id(3),explicitRow:{...row('public.phase2_receipt_wac_snapshots',['receipt_movement_sequence_max'],true),
      id:id(34),operation_id:id(1),product_id:id(3),[fk]:id(2)},
      lastMovementSlot:'MOVEMENT|'+p.allocation.componentBindings[1].identity,
      sequenceRequirement:'ACTUAL_LAST_ORDERED_MOVEMENT_RETURNING_SEQUENCE',eventTimeRequirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'}]});
  return {installed,plan};
};

test('primary bridge covers source-specific financial and per-component movement/SKU WAC requirements without inventing events',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const withOptionalRows of [false,true]){
    const {installed,plan}=primaryProjectionFixture(kind,withOptionalRows);
    const bound=bindReceiptV2PrimaryProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan);
    assert.equal(assertReceiptV2PrimaryProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan,bound),true);
    assert.equal(bound.movements.length,2);assert.equal(bound.wac.length,1);
    assert.equal(bound.invoice===null,!withOptionalRows);assert.equal(bound.payment===null,!withOptionalRows);
    if(withOptionalRows){
      assert.equal(bound.invoice.candidateIdentity.durableClaimed,false);
      assert.equal(bound.payment.columns.find(c=>c.name==='payment_date').requirement,'CAPTURED_RECEIVED_AT_OR_ACTUAL_TRANSACTION_TIMESTAMP');
      assert.equal(bound.payment.columns.find(c=>c.name==='notes').projectionValueDeferred,true);
    }
    assert.equal(bound.audit.candidateIdentity.durableClaimed,false);
    assert.equal(bound.audit.columns.find(c=>c.name==='id').requirement,'ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED');
    assert.equal(bound.header.columns.find(c=>c.name==='received_at').requirement,'CAPTURED_RECEIVED_AT_OR_ACTUAL_TRANSACTION_TIMESTAMP');
    assert.ok(bound.movements.every(r=>r.columns.find(c=>c.name==='notes').projectionValueDeferred));
    assert.equal(bound.wac[0].columns.find(c=>c.name==='receipt_movement_sequence_max').requirement,'ACTUAL_MOVEMENT_RETURNING_SEQUENCE');
    assert.equal(bound.deferredCompositeProjections.finalCompositeValuesQualified,false);
    for(const flag of ['executionAuthority','sourcePlanValidatedByThisAnalysis','defaultOwnershipQualified',
      'actualNumberAndSequenceQualified','balanceAndUpdatePatchBindingsComplete'])assert.equal(bound[flag],false);
    Object.assign(plan.financialPlan,{resultWithoutReceiptNumber:{receipt_id:'mutated'}});
    assert.notEqual(bound.deferredCompositeProjections.resultWithoutReceiptNumber.receipt_id,'mutated');
  }
});

test('primary bridge rejects foreign financial parents, duplicate component substitution and invented event/default ownership',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const corrupt of [
    p=>{p.financialPlan.operationWithoutResultAndTime.initiated_by=p.items[0].explicitRow.id;},
    p=>{p.financialPlan.headerWithoutEventValues.warehouse_id=p.items[0].explicitRow.id;},
    p=>{p.financialPlan.auditWithoutEventValues.entity_id=p.items[0].explicitRow.id;},
    p=>{p.financialPlan.resultWithoutReceiptNumber.operation_id=p.items[0].explicitRow.id;},
    p=>{p.financialPlan.headerWithoutEventValues.receipt_number='invented';},
    p=>{p.financialPlan.inventoryPlan.movements[1]=structuredClone(p.financialPlan.inventoryPlan.movements[0]);},
    p=>{p.financialPlan.inventoryPlan.movements.pop();},
    p=>{p.financialPlan.inventoryPlan.movements[0].explicitRow.notes='invented';},
    p=>{p.financialPlan.inventoryPlan.movements[0].explicitRow.quantity=99;},
    p=>{p.financialPlan.inventoryPlan.movements[0].explicitRow.operation_id=p.items[0].explicitRow.id;},
    p=>{p.financialPlan.inventoryPlan.wacRows[0].lastMovementSlot=p.financialPlan.inventoryPlan.movements[0].slotKey;},
    p=>{p.financialPlan.inventoryPlan.wacRows.push(structuredClone(p.financialPlan.inventoryPlan.wacRows[0]));},
    p=>{p.financialPlan.inventoryPlan.wacRows[0].explicitRow.receipt_movement_sequence_max=5;},
    p=>{p.financialPlan.paymentWithoutNotesTimeAndTrigger={};},
  ]){const {installed,plan}=primaryProjectionFixture(kind);corrupt(plan);
    assert.throws(()=>bindReceiptV2PrimaryProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan),/PRIMARY_PROJECTION_INVALID/u);}
});

test('primary bound outputs reject hidden undefined, composite substitution and authority forgery',()=>{
  const {installed,plan}=primaryProjectionFixture();
  const bound=bindReceiptV2PrimaryProjectionRequirements(receiptSources,receiptMigrationSources,installed,'DIRECT_V2',plan);
  for(const corrupt of [b=>{b.operation.hidden=undefined;},b=>{b.movements[1]=structuredClone(b.movements[0]);},
    b=>{b.audit.candidateIdentity.durableClaimed=true;},b=>{b.deferredCompositeProjections.finalCompositeValuesQualified=true;}]){
    const changed=structuredClone(bound);corrupt(changed);
    assert.throws(()=>assertReceiptV2PrimaryProjectionRequirements(receiptSources,receiptMigrationSources,installed,'DIRECT_V2',plan,changed),/PRIMARY_BOUND_REQUIREMENTS_CHANGED/u);
  }
});

test('bounded UPDATE reader preserves assignments/predicate coordinates and pinned six-occurrence source coverage',()=>{
  const source="UPDATE public.products SET a=ROUND(1, 6), b='x, WHERE y', updated_at=NOW() WHERE id = v.id;";
  const [write]=inspectExplicitUpdateValues(source);
  assert.deepEqual(write.bindings.map(b=>b.expression),['ROUND(1, 6)',"'x, WHERE y'",'NOW()']);
  for(const b of write.bindings)assert.equal(source.slice(b.offset,b.offset+b.expression.length),b.expression);
  assert.equal(write.predicate.expression,'id = v.id');assert.equal(write.valuesEvaluated,false);
  const ledger=inspectReceiptV2UpdateRequirements(receiptSources,receiptMigrationSources);
  assert.equal(ledger.writes.length,6);assert.equal(ledger.executionAuthority,false);
  for(const w of ledger.writes)for(const b of w.bindings)
    assert.equal(receiptSources.get(w.signature)!.body.slice(b.offset,b.offset+b.expression.length),b.expression);
});

test('bounded UPDATE reader rejects aliases, missing predicates, FROM, duplicate targets and RETURNING',()=>{
  for(const sql of ['UPDATE public.x x SET a=1 WHERE id=1;','UPDATE public.x SET a=1;',
    'UPDATE public.x SET a=1 FROM public.y WHERE id=1;','UPDATE public.x SET a=1 WHERE id=1 RETURNING id;',
    'UPDATE public.x SET a=1,a=2 WHERE id=1;','UPDATE public.x SET a= WHERE id=1;'])
    assert.throws(()=>inspectExplicitUpdateValues(sql),/ADMISSION_UPDATE_/u);
});

const updateProjectionFixture=(kind='DIRECT_V2',absent=false)=>{
  const {installed,plan}=primaryProjectionFixture(kind),f=plan.financialPlan,i=f.inventoryPlan,b=i.balancePlan;
  const p=b.candidates.requirements.prewrite,id=(n:number)=>`92500000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const before={id:id(70),product_id:id(3),warehouse_id:id(32),on_hand_quantity:7,reserved_quantity:2,available_quantity:5};
  const insert={...before,on_hand_quantity:0,reserved_quantity:0,available_quantity:0};
  if(absent)b.candidates.identityBindings.push({slotKey:'BALANCE|'+id(3),id:id(70)});
  Object.assign(b,{rows:[{productId:id(3),warehouseId:id(32),before:absent?null:before,insertWithoutEventTime:absent?insert:null,
    afterWithoutEventTime:{...before,on_hand_quantity:absent?6:13,reserved_quantity:absent?0:2,available_quantity:absent?6:11},
    receivedQuantity:6,eventTimeRequirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION',triggerEffectsQualified:false}]});
  Object.assign(i,{productPatches:[{productId:id(3),before:{id:id(3)},patchWithoutEventTime:{wac_cost_in_minor_units_exact:10,cost_price_in_minor_units:10},
    eventTimeRequirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'}]});
  Object.assign(f,{supplierPatchWithoutEventTime:{id:id(31),before:{id:id(31),current_balance_in_minor_units:0},patchWithoutEventTime:{current_balance_in_minor_units:100}}});
  Object.assign(plan,{purchaseOrderItemPatches:[]});
  if(kind==='PO_V2'){
    const po=id(80);Object.assign(f.headerWithoutEventValues,{purchase_order_id:po});
    Object.assign(p,{resources:[{relation:'public.purchase_orders',row:{id:po,received_at:null}}],prospectivePoCompleted:false});
    const patches=p.allocation.lineBindings.map((l,index)=>{
      const item=id(81+index);Object.assign(l,{purchaseOrderItemId:item});
      return {id:item,before:{id:item,purchase_order_id:po},patchWithoutEventTime:{received_quantity:2,received_parcel_quantity:0},eventTimeRequirement:'ACTUAL_TRANSACTION_TIMESTAMP_AT_EXECUTION'};
    });
    Object.assign(plan,{purchaseOrderItemPatches:patches});
  }
  return {installed,plan};
};

test('UPDATE bridge binds existing/absent balances and all primary patches without time/default/execution authority',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const absent of [false,true]){
    const {installed,plan}=updateProjectionFixture(kind,absent);
    const bound=bindReceiptV2UpdateProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan);
    assert.equal(assertReceiptV2UpdateProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan,bound),true);
    assert.equal(bound.balances.length,1);assert.equal(bound.productPatches.length,1);
    assert.equal(bound.poItems.length,kind==='PO_V2'?2:0);assert.equal(bound.poHeader===null,kind==='DIRECT_V2');
    assert.equal(bound.balances[0].beforeInsert===null,absent);
    assert.equal(bound.balances[0].insertDefaultAttemptOwnershipQualified,false);
    assert.equal(bound.supplierPatch.assignments.find(a=>a.column==='updated_at').requirement,'ACTUAL_TRANSACTION_TIMESTAMP');
    for(const flag of ['actualEventValuesAllocated','sourcePlanValidatedByThisAnalysis','defaultOwnershipQualified','executionAuthority'])assert.equal(bound[flag],false);
  }
});

const sourceUnionFixture=(kind='DIRECT_V2',paid=false,absent=false)=>{
  const base=updateProjectionFixture(kind,absent),f:Record<string,any>=base.plan.financialPlan;
  const i:Record<string,any>=f.inventoryPlan,p:Record<string,any>=i.balancePlan.candidates.requirements.prewrite;
  const id=(n:number)=>`92500000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  const paymentSchema=base.installed.find(t=>t.relation==='supplier_payments')!;
  paymentSchema.columns.push({name:'cash_shift_id',type:'uuid',notNull:false,default:null,identity:'',generated:''});
  if(paid){
    const optional:Record<string,any>=primaryProjectionFixture(kind,true).plan.financialPlan;
    f.invoiceWithoutDefaults=optional.invoiceWithoutDefaults;f.paymentWithoutNotesTimeAndTrigger=optional.paymentWithoutNotesTimeAndTrigger;
    i.balancePlan.candidates.identityBindings.push({slotKey:'INVOICE',id:id(35)},{slotKey:'PAYMENT',id:id(36)});
  }
  Object.assign(p,{kind,effectiveBranchId:id(51),paymentShiftRows:paid?[{id:id(52),branch_id:id(51),status:'open'}]:[]});
  Object.assign(i.productPatches[0].before,{name_ar:'منتج المصدر',min_stock_level:10,is_active:true});
  if(kind==='DIRECT_V2')Object.assign(f.headerWithoutEventValues,{branch_id:id(51)});
  if(paid){Object.assign(f.paymentWithoutNotesTimeAndTrigger,{amount_in_minor_units:50,payment_method:'cash'});}
  for(const r of p.resources??[])if(r.relation==='public.purchase_orders'){
    Object.assign(r,{id:r.row.id});Object.assign(r.row,{branch_id:id(51)});
  }
  p.resources=[...(p.resources??[]),{relation:'public.products',id:id(3),row:structuredClone(i.productPatches[0].before)},
    {relation:'public.warehouses',id:p.effectiveWarehouseId,row:{id:p.effectiveWarehouseId,name_ar:'المستودع'}},
    {relation:'public.stock_alerts',id:id(60),row:{id:id(60),product_id:id(3),warehouse_id:p.effectiveWarehouseId,
      severity:'low_stock',status:'active',available_quantity:5,threshold_quantity:10,
      first_triggered_at:'2026-10-06T00:00:00Z',last_updated_at:'2026-10-06T00:00:00Z',resolved_at:null}},
    ...(paid?[{relation:'public.cash_shifts',id:id(52),row:structuredClone(p.paymentShiftRows[0])}]:[])];
  return {...base,plan:base.plan as Record<string,any>,transitiveInstalled:transitiveSchemaFixture()};
};

test('Receipt V2 source-effect union binds complete source resources and kind-specific paid/unpaid Shift paths',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const paid of [false,true]){
    const fixture=sourceUnionFixture(kind,paid);
    const bound=bindReceiptV2SourceEffectUnion(receiptSources,receiptMigrationSources,fixture.installed,fixture.transitiveInstalled,kind,fixture.plan);
    assert.equal(assertReceiptV2SourceEffectUnion(receiptSources,receiptMigrationSources,fixture.installed,fixture.transitiveInstalled,kind,fixture.plan,bound),true);
    assert.equal(bound.stock.retainedSnapshot.targets.length,1);
    assert.equal(bound.payment===null,!paid);
    if(paid){assert.equal(bound.payment.triggerShift.sourceKind,kind);
      assert.equal(bound.payment.columns.find(c=>c.name==='cash_shift_id').value,bound.payment.triggerShift.value);}
    assert.equal(bound.retainedCompleteSourceResources.length,fixture.plan.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources.length);
    for(const flag of ['sourcePlanValidatedByThisAnalysis','actualEventValuesAllocated','eventKeyResolutionComplete',
      'futureIdentitySetResolved','durableIdentityClaimed','fullTypedWriteTuplesQualified','writerInvokerAbsenceConvergence','locksHeld','executionAuthority'])assert.equal(bound[flag],false);
  }
});

test('Receipt V2 stock resource union retains global first owner without importing unrelated events',()=>{
  for(const kind of ['DIRECT_V2','PO_V2']){
    const f=sourceUnionFixture(kind,true),p=f.plan.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite;
    const alert=p.resources.find(r=>r.relation==='public.stock_alerts').row;
    alert.severity='out_of_stock';alert.threshold_quantity=20;
    f.plan.financialPlan.inventoryPlan.productPatches[0].before.min_stock_level=20;
    p.resources.find(r=>r.relation==='public.products').row.min_stock_level=20;
    const clock={timestampUtc:'2026-10-06T00:00:00Z',epochFloorSeconds:'1791244800'};
    const owner={id:'92600000-0000-0000-0000-000000000501',entity_id:'92600000-0000-0000-0000-000000000999',
      event_key:`stock_alert:${alert.id}:low_stock:${clock.epochFloorSeconds}`,event_type:'out_of_stock',
      payload:{sentinel:'global unrelated first owner'},created_at:'1969-01-01T00:00:00Z'};
    const other={...owner,id:'92600000-0000-0000-0000-000000000502',event_key:'unrelated-key'};
    const allocation=[{productId:alert.product_id,warehouseId:alert.warehouse_id,stage:'FINAL_UPDATE',alertId:null,eventId:null}];
    const derive=(events=[owner,other],plan=f.plan)=>bindReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,
      f.installed,f.transitiveInstalled,kind,plan,clock,allocation,events);
    const result=derive();
    assert.equal(assertReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,
      kind,f.plan,clock,allocation,[owner,other],result),true);
    assert.deepEqual(result.resources.slice(0,p.resources.length),p.resources,'entire source/payment/global-WAC set preserved');
    assert.deepEqual(result.resources.at(-1),{relation:'public.automation_events',id:owner.id,row:owner});
    assert.equal(result.resources.some(r=>r.id===other.id),false,'not a global-table locking requirement');
    assert.deepEqual(result.keyRequirements[0].observedRow,owner);
    assert.equal(result.keyRequirements[0].candidateId,null);assert.equal(result.futureIdentityRequirements.length,0);
    assert.equal(result.transitive.tables.reduce((n,t)=>n+t.columns.length,0),19);
    assert.equal(result.transitive.foreignKeyRequirements.length,4);
    for(const flag of ['sourcePlanValidatedByThisAnalysis','clockAuthorityQualified','foreignKeysInstalledValidated',
      'typedFullRowsQualified','writerInvokerAbsenceConvergence','durableIdentityClaimed','absencePredicatesFenced',
      'afterWaitRevalidated','locksHeld','executionAuthority'])assert.equal(result[flag],false);
    assert.throws(()=>derive([other]),/STOCK_CANDIDATE_INVALID/u,'global owner disappearance invalidates allocation');
    const retained=structuredClone(f.plan);
    retained.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources.push(
      {relation:'public.automation_events',id:owner.id,row:{...owner,payload:{contradiction:true}}});
    assert.throws(()=>derive([owner,other],retained),/STOCK_(?:CANDIDATE|RESOURCE_UNION)_INVALID/u,'contradictory retained owner');
    const outside=structuredClone(f.plan);
    outside.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources.push(
      {relation:'public.automation_events',id:other.id,row:{...other,payload:{contradiction:true}}});
    assert.throws(()=>derive([owner,other],outside),/STOCK_RESOURCE_UNION_INVALID/u,'other-warehouse/global-WAC event must remain exact');
    const kept=structuredClone(f.plan);
    kept.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources.push(
      {relation:'public.automation_events',id:owner.id,row:structuredClone(owner)});
    assert.equal(derive([owner,other],kept).resources.filter(r=>r.id===owner.id).length,1,'identity dedup');
    for(const mutate of [r=>{r.resources.pop();},r=>{r.keyRequirements[0].observedRow.payload={};},
      r=>{r.absencePredicatesFenced=true;},r=>{r.executionAuthority=true;},r=>{r.unexpected=null;}]){
      const bad=structuredClone(result);mutate(bad);
      assert.throws(()=>assertReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,
        kind,f.plan,clock,allocation,[owner,other],bad),/STOCK_RESOURCE_UNION_CHANGED/u);
    }
    owner.payload.sentinel='mutated input';assert.notEqual(result.keyRequirements[0].observedRow.payload.sentinel,owner.payload.sentinel);
  }
});

test('Receipt V2 stock resource union distinguishes absent key and future alert candidates from ownership',()=>{
  const f=sourceUnionFixture('DIRECT_V2'),i=f.plan.financialPlan.inventoryPlan;
  const p=i.balancePlan.candidates.requirements.prewrite;
  i.productPatches[0].before.min_stock_level=20;
  p.resources.find(r=>r.relation==='public.products').row.min_stock_level=20;
  p.resources=p.resources.filter(r=>r.relation!=='public.stock_alerts');
  // Retain the existing balance: one INSERT alert, rather than a zero balance
  // branch invented by this test. Source update is still independently bound.
  const clock={timestampUtc:'2026-10-06T00:00:00Z',epochFloorSeconds:'1791244800'};
  const allocation=[{productId:i.productPatches[0].productId,warehouseId:p.effectiveWarehouseId,stage:'FINAL_UPDATE',
    alertId:'92600000-0000-0000-0000-000000000401',eventId:'92600000-0000-0000-0000-000000000501'}];
  const derive=()=>bindReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,
    'DIRECT_V2',f.plan,clock,allocation,[]);
  const result=derive();assert.equal(result.stock.stages[0].action,'INSERT');
  assert.equal(result.futureIdentityRequirements.length,2);
  assert.equal(result.resources.length,p.resources.length,'hypothetical rows never become captured resources');
  assert.deepEqual(result.keyRequirements[0],{relation:'public.automation_events',column:'event_key',
    key:`stock_alert:${allocation[0].alertId}:low_stock:${clock.epochFloorSeconds}`,disposition:'INSERT_NEW',
    observedRow:null,candidateId:allocation[0].eventId,
    requirement:'FRESH_EXACT_KEY_ABSENCE_REVALIDATION_AND_EXCLUSION_FENCE',afterWaitRevalidated:false,absenceFenced:false});
  for(const identity of result.futureIdentityRequirements)assert.equal(identity.owned,false);
  const bad=structuredClone(result);bad.futureIdentityRequirements[0].owned=true;
  assert.throws(()=>assertReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,
    'DIRECT_V2',f.plan,clock,allocation,[],bad),/STOCK_RESOURCE_UNION_CHANGED/u);
});

test('Receipt V2 stock resource union carries future alert across two keys with a global unrelated first owner',()=>{
  for(const kind of ['DIRECT_V2','PO_V2']){
    const f=sourceUnionFixture(kind,false,true),i=f.plan.financialPlan.inventoryPlan;
    const p=i.balancePlan.candidates.requirements.prewrite;
    p.resources=p.resources.filter(r=>r.relation!=='public.stock_alerts');
    const clock={timestampUtc:'2026-10-06T00:00:00Z',epochFloorSeconds:'1791244800'};
    const alertId='92600000-0000-0000-0000-000000000401';
    const owner={id:'92600000-0000-0000-0000-000000000501',entity_id:'92600000-0000-0000-0000-000000000999',
      event_key:`stock_alert:${alertId}:out_of_stock:${clock.epochFloorSeconds}`,event_type:'low_stock',
      payload:{sentinel:'unrelated owner of future-alert key'},created_at:'1969-01-01T00:00:00Z'};
    const allocation=[{productId:i.productPatches[0].productId,warehouseId:p.effectiveWarehouseId,stage:'ZERO_INSERT',alertId,eventId:null},
      {productId:i.productPatches[0].productId,warehouseId:p.effectiveWarehouseId,stage:'FINAL_UPDATE',alertId:null,
        eventId:'92600000-0000-0000-0000-000000000502'}];
    const result=bindReceiptV2StockResourceUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,
      kind,f.plan,clock,allocation,[owner]);
    assert.equal(result.keyRequirements.length,2);assert.equal(result.futureIdentityRequirements.length,2);
    assert.equal(result.stock.stages[1].before.id,alertId);assert.equal(result.stock.stages[1].after.id,alertId);
    assert.deepEqual(result.resources.at(-1),{relation:'public.automation_events',id:owner.id,row:owner});
    assert.deepEqual(result.keyRequirements.map(k=>k.disposition),['REUSE_PREEXISTING','INSERT_NEW']);
    assert.deepEqual(result.futureIdentityRequirements.map(r=>r.relation),['public.stock_alerts','public.automation_events']);
    assert.equal(result.resources.some(r=>r.id===alertId),false,'future row not captured/owned');
    assert.equal(result.source.updates.balances[0].beforeInsert,null,'actual absent-balance requirement retained');
  }
});

test('Receipt V2 source-effect union rejects missing/duplicate resource, foreign branch, Shift and SKU sources',()=>{
  for(const corrupt of [
    p=>{p.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.kind='PO_V2';},
    p=>{p.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources.pop();},
    p=>{const r=p.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.resources;r.push(structuredClone(r[0]));},
    p=>{p.financialPlan.inventoryPlan.productPatches[0].before.name_ar='foreign';},
    p=>{p.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.paymentShiftRows[0].branch_id='foreign';},
    p=>{p.financialPlan.inventoryPlan.balancePlan.candidates.requirements.prewrite.paymentShiftRows[0].status='closed';},
    p=>{p.financialPlan.headerWithoutEventValues.branch_id='foreign';},
  ]){const f=sourceUnionFixture('DIRECT_V2',true);corrupt(f.plan);
    assert.throws(()=>bindReceiptV2SourceEffectUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,'DIRECT_V2',f.plan),/SOURCE_EFFECT_UNION_INVALID/u);}
  const f=sourceUnionFixture('DIRECT_V2',true);
  const valid=bindReceiptV2SourceEffectUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,'DIRECT_V2',f.plan);
  for(const corrupt of [b=>{b.stock.stages=[];},b=>{b.payment.triggerShift.value='foreign';},b=>{b.executionAuthority=true;},b=>{b.hidden=undefined;}]){
    const bad=structuredClone(valid);corrupt(bad);
    assert.throws(()=>assertReceiptV2SourceEffectUnion(receiptSources,receiptMigrationSources,f.installed,f.transitiveInstalled,'DIRECT_V2',f.plan,bad),/SOURCE_EFFECT_UNION_CHANGED/u);
  }
});

test('UPDATE bridge rejects row-identity substitution, quantity/generated drift, extra patch keys and forged output',()=>{
  for(const kind of ['DIRECT_V2','PO_V2'])for(const corrupt of [
    p=>{p.financialPlan.inventoryPlan.balancePlan.rows[0].afterWithoutEventTime.available_quantity=99;},
    p=>{p.financialPlan.inventoryPlan.balancePlan.rows[0].afterWithoutEventTime.warehouse_id='foreign';},
    p=>{p.financialPlan.inventoryPlan.productPatches.push(structuredClone(p.financialPlan.inventoryPlan.productPatches[0]));},
    p=>{p.financialPlan.inventoryPlan.productPatches[0].patchWithoutEventTime.updated_at='invented';},
    p=>{p.financialPlan.supplierPatchWithoutEventTime.before.id='foreign';},
    p=>{p.financialPlan.supplierPatchWithoutEventTime.patchWithoutEventTime={};},
  ]){const {installed,plan}=updateProjectionFixture(kind);corrupt(plan);
    assert.throws(()=>bindReceiptV2UpdateProjectionRequirements(receiptSources,receiptMigrationSources,installed,kind,plan),/UPDATE_PROJECTION_INVALID/u);}
  const {installed,plan}=updateProjectionFixture('PO_V2');
  const bound=bindReceiptV2UpdateProjectionRequirements(receiptSources,receiptMigrationSources,installed,'PO_V2',plan);
  for(const corrupt of [b=>{b.poItems[1]=structuredClone(b.poItems[0]);},b=>{b.executionAuthority=true;},b=>{b.balances[0].hidden=undefined;}]){
    const changed=structuredClone(bound);corrupt(changed);
    assert.throws(()=>assertReceiptV2UpdateProjectionRequirements(receiptSources,receiptMigrationSources,installed,'PO_V2',plan,changed),/UPDATE_BOUND_REQUIREMENTS_CHANGED/u);
  }
});

test('single-VALUES source reader preserves nested expressions, quoted commas and raw coordinates without evaluation',()=>{
  const body="BEGIN INSERT INTO public.sample (a,b,c,d) VALUES ('عربي, )', COALESCE(x, fn(1,2)), NULL, CASE WHEN x='a,b' THEN 1 END) RETURNING id; END;";
  const row=inspectExplicitInsertValues(body)[0];
  assert.deepEqual(row.bindings.map(v=>v.expression),["'عربي, )'",'COALESCE(x, fn(1,2))','NULL',"CASE WHEN x='a,b' THEN 1 END"]);
  for(const value of row.bindings)assert.equal(body.slice(value.offset,value.offset+value.expression.length),value.expression);
  assert.equal(row.valuesEvaluated,false);
});

test('single-VALUES reader fails closed on unresolved columns, arity, SELECT, multiple rows and malformed values',()=>{
  for(const body of [
    'INSERT INTO public.sample VALUES (1);','INSERT INTO public.sample (a,b) VALUES (1);',
    'INSERT INTO public.sample (a) SELECT x FROM y;','INSERT INTO public.sample (a) VALUES (1),(2);',
    'INSERT INTO public.sample (a) VALUES ();','INSERT INTO public.sample (a) VALUES (/* no value */);',
    'INSERT INTO public.sample (a) VALUES (fn(1);','INSERT INTO public.sample (a) VALUES (1) arbitrary;',
  ])assert.throws(()=>inspectExplicitInsertValues(body),/ADMISSION_INSERT_/u);
});

test('Receipt V2 complete row requirements cover all seventeen exact source occurrences without fabricated event values',()=>{
  const installed=rowRequirementFixture(),ledger=inspectReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed);
  assert.equal(ledger.writes.length,17);assert.equal(new Set(ledger.writes.map(w=>w.identity)).size,17);
  for(const row of ledger.writes){
    assert.deepEqual(row.columns.map(c=>c.name),installed.find(t=>'public.'+t.relation===row.relation)!.columns.map(c=>c.name));
    for(const column of row.columns){
      assert.ok(column.requirement);
      if(column.domain==='EXPLICIT_SOURCE_VALUE')assert.equal(column.sourceBinding.column,column.name);
      if(column.requirement==='OMITTED_SQL_NULL')assert.equal(column.value,null);
      if(column.requirement==='HISTORICAL_TYPED_LITERAL')assert.ok(column.historicalSource.sourceSha256);
      if(column.requirement.includes('ACTUAL')||column.requirement==='PINNED_SOURCE_EXPRESSION_NOT_EVALUATED')assert.ok(!Object.hasOwn(column,'value'));
    }
  }
  const cols=ledger.writes.flatMap(w=>w.columns);
  for(const requirement of ['EXPLICIT_SQL_NULL','OMITTED_SQL_NULL','HISTORICAL_TYPED_LITERAL','SERVER_GENERATED_FROM_EXACT_ROW',
    'ACTUAL_SERVER_UUID_AND_DURABLE_CLAIM_REQUIRED','ACTUAL_TRANSACTION_TIMESTAMP',
    'CAPTURED_RECEIVED_AT_OR_ACTUAL_TRANSACTION_TIMESTAMP','ACTUAL_SOURCE_KIND_RECEIPT_NUMBER',
    'ACTUAL_MOVEMENT_RETURNING_SEQUENCE','NULL_BEFORE_TRIGGER_ACTUAL_SEQUENCE_AFTER_INSERT'])assert.ok(cols.some(c=>c.requirement===requirement),requirement);
  assert.equal(assertReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed,ledger),true);
  for(const flag of ['sourceExpressionsEvaluated','defaultsEvaluated','actualEventValuesAllocated','fullWriteTuplesQualified',
    'triggerEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(ledger[flag],false);
});

test('Receipt row requirement assertion rejects equal-count occurrence substitution, omissions, value injection and authority forgery',()=>{
  const installed=rowRequirementFixture(),ledger=inspectReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed);
  for(const corrupt of [
    r=>{r.writes[1]=structuredClone(r.writes[0]);},r=>{r.writes.pop();},r=>{r.writes.push(structuredClone(r.writes[0]));},
    r=>{r.writes[0].columns.find(c=>c.domain==='EXPLICIT_SOURCE_VALUE').sourceBinding.expression='other_source';},
    r=>{r.writes[0].columns[0].value='fabricated';},r=>{r.executionAuthority=true;},
    r=>{r.writes[0].columns.reverse();},r=>{r.writes[0].bodySha256='other';},
    r=>{r.writes[0].columns[0].value=undefined;},
  ]){const changed=structuredClone(ledger);corrupt(changed);assert.throws(()=>assertReceiptV2RowRequirements(receiptSources,receiptMigrationSources,installed,changed),/ROW_REQUIREMENTS_CHANGED/u);}
  const bad=structuredClone(installed);bad.find(t=>t.relation==='inventory_balances')!.columns.find(c=>c.name==='reserved_quantity')!.type='text';
  assert.throws(()=>inspectReceiptV2RowRequirements(receiptSources,receiptMigrationSources,bad),/ROW_GENERATED_INPUTS_INVALID/u);
});

test('installed Receipt V2 value ledger is per INSERT occurrence and every column, without evaluating defaults',()=>{
  const tables=installedValueFixture();
  const balance=tables.find(t=>t.relation==='inventory_balances')!;
  balance.columns.push({name:'available_quantity',type:'integer',notNull:false,identity:'',generated:'s',default:'(on_hand_quantity - reserved_quantity)'},
    {name:'updated_at',type:'timestamp with time zone',notNull:true,identity:'',generated:'',default:'now()'},
    {name:'literal',type:'integer',notNull:true,identity:'',generated:'',default:'0'});
  tables.find(t=>t.relation==='inventory_movements')!.columns.push({name:'mutation_sequence',type:'bigint',notNull:true,identity:'',generated:'',default:null});
  const ledger=inspectReceiptV2InstalledValueRequirements(receiptSources,receiptMigrationSources,tables);
  assert.equal(ledger.writes.length,17);
  const columns=ledger.writes.find(w=>w.relation==='public.inventory_balances')!.columns;
  assert.equal(columns.find(c=>c.name==='available_quantity')?.domain,'GENERATED_AVAILABLE_QUANTITY');
  assert.equal(columns.find(c=>c.name==='id')?.domain,'OMITTED_UUID_REQUIRES_SERVER_ALLOCATION_AND_CLAIM');
  assert.equal(columns.find(c=>c.name==='updated_at')?.domain,'OMITTED_ACTUAL_TRANSACTION_TIMESTAMP');
  assert.equal(columns.find(c=>c.name==='literal')?.domain,'OMITTED_LITERAL_DEFAULT_REQUIRES_TYPED_VALUE_PROOF');
  assert.ok(ledger.writes.every(w=>w.columns.every(c=>!c.valueAllocated&&!c.ownershipQualified)));
  for(const flag of ['defaultsEvaluated','sequenceConsumed','fullWriteTuplesQualified','triggerEffectsQualified',
    'durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(ledger[flag],false);
});

test('installed value ledger rejects malformed catalogs, unknown omissions/defaults and generated/identity drift',()=>{
  for(const corrupt of [
    t=>t.pop(),t=>t.push(t[0]),t=>t[0].columns.push(t[0].columns[0]),
    t=>t[0].columns[0].identity='a',t=>t[0].columns[0].notNull=null,
    t=>t.find(x=>x.relation==='inventory_balances').columns[0].default='unreviewed_function()',
    t=>t.find(x=>x.relation==='inventory_balances').columns[0].type='integer',
    t=>t[0].columns.push({name:'required_unmodelled',type:'integer',notNull:true,identity:'',generated:'',default:null}),
    t=>t[0].columns.push({name:'wrong_clock',type:'integer',notNull:true,identity:'',generated:'',default:'now()'}),
    t=>t[0].columns.push({name:'wrong_generated',type:'integer',notNull:false,identity:'',generated:'s',default:'1'}),
    t=>t.find(x=>x.relation==='inventory_movements').columns.push({name:'mutation_sequence',type:'bigint',notNull:true,identity:'',generated:'',default:'42'}),
  ]){
    const tables=installedValueFixture();corrupt(tables);
    assert.throws(()=>inspectReceiptV2InstalledValueRequirements(receiptSources,receiptMigrationSources,tables),/ADMISSION_RECEIPT_V2_/u);
  }
  assert.throws(()=>inspectReceiptV2InstalledValueRequirements(receiptSources,receiptMigrationSources,null),/INSTALLED_RELATIONS_INVALID/u);
});

test('Receipt V2 deferred values keep actual sequence allocation distinct from random receipt numbers and UUID candidates',()=>{
  const c=inspectReceiptV2DeferredValueContract(receiptSources,receiptMigrationSources);
  assert.deepEqual(c.numberDomains.map(n=>[n.kind,n.allocation]),[
    ['DIRECT_V2','ACTUAL_NEXTVAL_supplier_receipt_seq'],
    ['PO_V2','ACTUAL_RANDOM_CANDIDATE_AND_ABSENCE_RECHECK'],
  ]);
  assert.equal(c.movementSequence.sequence,'public.inventory_movement_mutation_seq');
  assert.equal(c.movementSequence.allocation,'NULL_ONLY_BEFORE_INSERT_TRIGGER');
  assert.equal(c.movementSequence.rollbackReclaimsSequence,false);
  assert.equal(c.movementSequence.callerSuppliedValueSafe,false);
  assert.equal(c.numberDomains[0].rollbackReclaimsSequence,false);
  for(const k of ['predictionAllowed','sequenceConsumed','numberClaimed','fullWriteTuplesQualified',
    'stockPaymentEffectsQualified','durableIdentityClaimed','locksHeld','executionAuthority'])assert.equal(c[k],false);
  assert.ok(c.writes.length>10);
  assert.ok(c.writes.every(w=>w.installedOmittedDefaultsQualified===false&&w.generatedTupleComplete===false));
  const movement=c.writes.find(w=>w.relation==='public.inventory_movements');
  assert.ok(movement);
  assert.equal(movement.explicitColumns.includes('mutation_sequence'),false);
});

test('Receipt V2 deferred-value ledger rejects trigger/sequence/default source changes and preserves LF/CRLF equivalence',()=>{
  const expected=inspectReceiptV2DeferredValueContract(receiptSources,receiptMigrationSources);
  const crlf=new Map([...receiptMigrationSources].map(([n,s])=>[n,s.replace(/\n/gu,'\r\n')]));
  assert.deepEqual(inspectReceiptV2DeferredValueContract(receiptSources,crlf),expected);
  for(const [from,to] of [
    ["NEXTVAL('public.inventory_movement_mutation_seq')","42"],
    ['IF NEW.mutation_sequence IS NULL THEN','IF TRUE THEN'],
    ['BEFORE INSERT ON public.inventory_movements','AFTER INSERT ON public.inventory_movements'],
    ["NEXTVAL('public.supplier_receipt_seq')","42"],
    ['RETURNING mutation_sequence INTO v_last_movement_sequence','RETURNING 42 INTO v_last_movement_sequence'],
  ]){
    const changed=new Map(receiptMigrationSources);
    const name='113_configurable_parcel_receiving_and_exact_wac.sql';
    assert.ok(changed.get(name)?.includes(from));
    changed.set(name,changed.get(name)!.replace(from,to));
    assert.throws(()=>inspectReceiptV2DeferredValueContract(receiptSources,changed),/ADMISSION_RECEIPT_V2_SCHEMA_DRIFT/u);
  }
});

test('Receipt V2 source checkpoint pins the intended contract while all runtime/activation boundaries stay open',()=>{
  const c=inspectReceiptV2SourceContract(receiptSources,receiptMigrationSources);
  const digest=createHash('sha256').update(JSON.stringify(c)).digest('hex').toUpperCase();
  assert.equal(digest,'BA04C099B758F303DEC157E03E864A6FC36CF5B36FD1C249BA8D6EC94816EA67');
  const state=JSON.parse(readFileSync('docs/agent/project-state.json','utf8'));
  const task=JSON.parse(readFileSync('docs/agent/ACTIVE_TASK.json','utf8'));
  assert.equal(state.phase5Slice5ReceiptV2SourceContractSha256,digest);
  assert.equal(task.slice5ReceiptV2SourceCheckpoint.sourceContractSha256,digest);
  assert.equal(task.slice5ReceiptV2SourceCheckpoint.status,'SOURCE_DOMAIN_CONTRACT_FOCUSED_PASS_RUNTIME_ADMISSION_OPEN');
  assert.equal(state.phase5PublicActivationAllowed,false);
  assert.equal(state.phase5Slice5Closed,false);
  assert.equal(c.fullRowIdentityDomainImplemented,false);
  assert.equal(c.runtimeAdmissionProven,false);
  assert.equal(c.executionAuthority,false);
});

test('Receipt V2 explicit INSERT column observations reject unresolved lists and never qualify omitted defaults',()=>{
  const body="-- INSERT INTO public.fake(id) VALUES(1);\nSELECT 'INSERT INTO public.fake(id)';\nINSERT INTO public.items(id, product_id, operation_id) VALUES(1,2,3); INSERT INTO public.audit_logs VALUES(1);";
  const found=inspectExplicitInsertColumns(body);
  assert.equal(found.length,2);
  assert.deepEqual(found[0].columns,['id','product_id','operation_id']);
  assert.equal(found[1].columns,null);
  assert.ok(found.every(r=>r.implicitColumnsQualified===false));
  for(const list of ['id,id','id,','id,fn(x)','id']) {
    const suffix=list==='id'?'':' ) VALUES(1);';
    assert.throws(()=>inspectExplicitInsertColumns('INSERT INTO public.items('+list+suffix),/ADMISSION_INSERT_COLUMNS/u);
  }
});

test('modern Receipt V2 source map binds both actual first writes, divergent key/number domains and prewrite locking delegates',()=>{
  const c=inspectReceiptV2SourceContract(receiptSources,receiptMigrationSources);
  assert.equal(c.nodes.length,18);assert.equal(c.schemaSources.length,7);
  assert.deepEqual(c.entries.map(e=>e.kind),['DIRECT_V2','PO_V2']);
  assert.ok(c.entries.every(e=>e.firstOwnWrite.relation==='public.business_operations'
    &&e.gateOrder.sourceOrder==='GATE_PRECEDES_BOUNDARY'&&e.replayBeforePaymentAndSkuLocks));
  assert.match(c.entries[0].numberDomain,/supplier_receipt_seq/u);
  assert.match(c.entries[1].numberDomain,/random-collision-loop/u);
  assert.match(c.entries[0].idempotencyDomain,/cross-actor/u);
  assert.match(c.entries[1].idempotencyDomain,/<actor>/u);
  assert.equal(c.entries[1].prewriteRowLocks.length,2);
  const validator=c.nodes.find(n=>n.signature.startsWith('public.phase2_validate_receipt_lines_internal('));
  assert.deepEqual(validator?.observation.rowLocks.map(l=>l.mode),['SHARE','SHARE']);
  assert.equal(c.nodes.filter(n=>n.directAcl.authenticated).length,2);
  assert.equal(c.runtimeAdmissionProven,false);assert.equal(c.executionAuthority,false);
});

test('Receipt V2 per-client-line/component identity is distinct from per-SKU WAC and absence/default ownership',()=>{
  const c=inspectReceiptV2SourceContract(receiptSources,receiptMigrationSources);
  assert.equal(c.identityDomains.length,12);
  assert.match(c.identityDomains[4].identity,/client_line_id \+ component product_id/u);
  assert.match(c.identityDomains[4].coverage,/same SKU.*MUST stay distinct/u);
  assert.match(c.identityDomains[5].identity,/exact receipt-item UUID/u);
  assert.match(c.identityDomains[6].identity,/distinct SKU/u);
  assert.match(c.identityDomains[6].coverage,/ALL-warehouse.*ACTUAL movement sequence/u);
  assert.match(c.identityDomains[7].coverage,/ON CONFLICT does not prove/u);
  assert.match(c.identityDomains[11].coverage,/no prediction from last_value/u);
  assert.match(c.allocationContract,/ties by client UUID.*ties by SKU/u);
  assert.match(c.expectedTruth,/never derive expected identity from movement/u);
  assert.equal(c.breakMatrix.length,12);
  assert.ok(c.graphs.every(g=>!g.implicitEffectsQualified&&!g.allBranchesOrdered&&!g.executionAuthority));
});

test('Receipt source-column coverage records default-omitted UUIDs and exact item/movement/source relations',()=>{
  const c=inspectReceiptV2SourceContract(receiptSources,receiptMigrationSources);
  const direct=c.nodes.find(n=>n.signature.startsWith('public.create_direct_supplier_receipt_v2('));
  const inventory=c.nodes.find(n=>n.signature.startsWith('public.phase2_apply_inventory_and_wac_internal('));
  assert.ok(direct?.explicitInserts.find(r=>r.relation==='public.supplier_receipt_items')?.columns?.includes('commercial_line_id'));
  for(const relation of ['public.audit_logs','public.supplier_payments','public.supplier_financial_invoice_identities']) {
    const insert=direct?.explicitInserts.find(r=>r.relation===relation);
    assert.ok(insert);assert.ok(!insert.columns?.includes('id'));
    assert.equal(insert.implicitColumnsQualified,false);
  }
  const movement=inventory?.explicitInserts.find(r=>r.relation==='public.inventory_movements');
  assert.ok(movement?.columns?.includes('supplier_receipt_item_id'));
  assert.ok(movement?.columns?.includes('purchase_receipt_item_id'));
  assert.ok(!movement?.columns?.includes('mutation_sequence'));
  assert.ok(!inventory?.explicitInserts.find(r=>r.relation==='public.phase2_receipt_wac_snapshots')?.columns?.includes('id'));
  assert.equal(c.fullRowIdentityDomainImplemented,false);
});

test('independent Receipt source pins reject body/owner/ACL/path changes, missing sources and equal-count substitution',()=>{
  const chosen=[...receiptSources.keys()].filter(s=>s.startsWith('public.phase2_apply_inventory_and_wac_internal('))[0];
  const original=receiptSources.get(chosen)!;
  const changes=[
    {...original,body:original.body+'\n-- drift'},
    {...original,owner:'authenticated'},
    {...original,securityMode:'INVOKER'},
    {...original,searchPath:'public'},
    {...original,acl:{...original.acl,authenticated:true}},
    {...original,sourceMigration:'127_substitute.sql'},
  ];
  for(const changed of changes) {
    const copy=new Map(receiptSources);copy.set(chosen,changed);
    assert.throws(()=>inspectReceiptV2SourceContract(copy,receiptMigrationSources),/ADMISSION_RECEIPT_V2_SOURCE_DRIFT/u);
  }
  const missing=new Map(receiptSources);missing.delete(chosen);
  assert.throws(()=>inspectReceiptV2SourceContract(missing,receiptMigrationSources),/ADMISSION_RECEIPT_V2_SOURCE_DRIFT/u);
  const substitute=new Map(missing);substitute.set('public.non_authoritative_substitute(uuid)',original);
  assert.equal(substitute.size,receiptSources.size);
  assert.throws(()=>inspectReceiptV2SourceContract(substitute,receiptMigrationSources),/ADMISSION_RECEIPT_V2_SOURCE_DRIFT/u);
});

test('Receipt schema pins ignore only checkout line endings, not altered defaults/attachments/source content',()=>{
  const crlf=new Map([...receiptMigrationSources].map(([name,source])=>[name,source.replace(/\n/gu,'\r\n')]));
  assert.deepEqual(inspectReceiptV2SourceContract(receiptSources,crlf),inspectReceiptV2SourceContract(receiptSources,receiptMigrationSources));
  const name='113_configurable_parcel_receiving_and_exact_wac.sql';
  for(const source of [receiptMigrationSources.get(name)!+'\n-- changed',receiptMigrationSources.get(name)!.replace('receipt_movement_sequence_max BIGINT','receipt_movement_sequence_max INTEGER')]) {
    const changed=new Map(receiptMigrationSources);changed.set(name,source);
    assert.throws(()=>inspectReceiptV2SourceContract(receiptSources,changed),/ADMISSION_RECEIPT_V2_SCHEMA_DRIFT/u);
  }
});

test('admission scanner masks SQL literal/comment decoys while retaining exact source coordinates',()=>{
  const source=`-- UPDATE public.products SET x=1;\n/* outer /* INSERT INTO public.stock_alert_reads */ end */
SELECT 'DELETE FROM public.products', $quoted$TRUNCATE public.products$quoted$;
SELECT E'escaped \\' UPDATE public.products';
PERFORM public.phase2_lock_inventory_products_internal(ids);
UPDATE public.products SET x=1;`;
  const masked=maskAdmissionSql(source);
  assert.equal(masked.length,source.length);
  const rows=inspectAdmissionBody(source,['public.phase2_lock_inventory_products_internal(uuid[])']);
  assert.equal(rows.writes.length,1);assert.equal(rows.firstOwnWrite?.relation,'public.products');
  assert.equal(rows.firstOwnWrite?.offset,source.lastIndexOf('UPDATE public.products'));
  assert.equal(rows.calls[0].exactTarget,'public.phase2_lock_inventory_products_internal(uuid[])');
});

test('FOR UPDATE is a resource lock, never an UPDATE business write',()=>{
  const scan=inspectAdmissionBody(`SELECT p.id FROM public.products p FOR NO KEY UPDATE;
SELECT * FROM public.stock_alerts FOR UPDATE NOWAIT;
INSERT INTO public.stock_alert_reads VALUES (1,2);`);
  assert.equal(scan.writes.length,1);assert.equal(scan.firstOwnWrite?.verb,'INSERT INTO');
  assert.deepEqual(scan.rowLocks.map(r=>r.mode),['NO KEY UPDATE','UPDATE']);
  assert.equal(inspectAdmissionBody('INSERT INTO public.audit_logs(user_id,details) VALUES(1,2);').calls.length,0);
});

test('early/late/missing gate and pre-gate row locks have distinct source results without authority',()=>{
  const gate='public.phase2_lock_inventory_products_internal';
  const boundary='INSERT INTO public.products';
  assert.equal(compareGateToBoundary(`PERFORM ${gate}(ids); ${boundary} VALUES(1);`,gate,boundary).sourceOrder,'GATE_PRECEDES_BOUNDARY');
  const late=compareGateToBoundary(`${boundary} VALUES(1); PERFORM ${gate}(ids);`,gate,boundary);
  assert.equal(late.sourceOrder,'GATE_AFTER_BOUNDARY');
  assert.equal(compareGateToBoundary(`${boundary} VALUES(1);`,gate,boundary).sourceOrder,'GATE_ABSENT');
  const locked=compareGateToBoundary(`SELECT * FROM public.products FOR UPDATE; PERFORM ${gate}(ids); ${boundary} VALUES(1);`,gate,boundary);
  assert.equal(locked.earlierRowLock?.mode,'UPDATE');
  assert.equal(locked.runtimeAdmissionProven,false);assert.equal(locked.executionAuthority,false);
});

test('overloaded callable identity stays explicitly unresolved; dynamic EXECUTE is never hidden',()=>{
  const scan=inspectAdmissionBody('PERFORM public.example(1); EXECUTE command;',
    ['public.example(int)','public.example(text)']);
  assert.equal(scan.calls[0].exactTarget,null);assert.equal(scan.calls[0].candidates.length,2);
  assert.equal(scan.calls[0].resolution,'OVERLOAD_OR_EXTERNAL_REVIEW_REQUIRED');
  assert.equal(scan.dynamicSql.length,1);
  for(const broken of ["SELECT 'unterminated",'/* unfinished','SELECT $body$unfinished'])
    assert.throws(()=>maskAdmissionSql(broken),/ADMISSION_UNTERMINATED/u);
});

test('reachability covers private delegates and cycles without inventing order, overload or implicit-effect proof',()=>{
  const sources=new Map([
    ['public.entry(uuid)',{sourceMigration:'fixture',body:'PERFORM phase5_private.child(1); UPDATE public.products SET x=1;'}],
    ['phase5_private.child(uuid)',{sourceMigration:'fixture',body:'INSERT INTO public.audit_logs VALUES(1); PERFORM public.entry(1); PERFORM public.overloaded(1);'}],
  ]);
  const graph=deriveAdmissionReachability('public.entry(uuid)',sources,
    [...sources.keys(),'public.overloaded(uuid)','public.overloaded(text)'],new Set(['public.entry(uuid)']));
  assert.equal(graph.nodes.length,2);
  assert.equal(graph.nodes[1].sourcePinned,false);
  assert.deepEqual(graph.cycles,[['public.entry(uuid)','phase5_private.child(uuid)','public.entry(uuid)']]);
  assert.deepEqual(graph.potentialWriteRelations,['public.audit_logs','public.products']);
  assert.equal(graph.unresolved[0].exactTarget,null);
  assert.equal(graph.allBranchesOrdered,false);assert.equal(graph.implicitEffectsQualified,false);
  assert.equal(graph.executionAuthority,false);
});

test('first-write runtime instrumentation is rollback-only, per-product and invokes supported authenticated RPCs',()=>{
  const runner=readFileSync('scripts/testing/run-phase5-inactive-collection-preparation-runtime.mjs','utf8');
  const body=runner.slice(runner.indexOf('const writerAdmissionRuntime ='),runner.indexOf('const receivingPrewriteRuntime ='));
  assert.ok(body.length>0);
  assert.match(body,/BEFORE INSERT ON public\.products/u);
  assert.match(body,/BEFORE INSERT ON public\.purchase_receipts/u);
  assert.match(body,/l\.pid=pg_catalog\.pg_backend_pid\(\)/u);
  assert.match(body,/l\.objsubid=1/u);
  assert.match(body,/l\.classid=.*key>>32/u);
  assert.match(body,/l\.objid=.*key&4294967295/u);
  assert.match(body,/SET LOCAL ROLE authenticated/u);
  assert.match(body,/public\.create_product_family_with_flavors_v1/u);
  assert.match(body,/public\.receive_purchase_order/u);
  assert.match(body,/held:false/u);assert.match(body,/held:true/u);
  assert.match(body,/source-product authority preserved/u);
  assert.match(body,/inventory_authority_catalog_v1/u);
  assert.match(body,/PHASE2_LEGACY_COST_REQUIRED/u);
  assert.match(body,/42501\.\*permission denied for function/u);
  assert.doesNotMatch(body,/DISABLE TRIGGER|ALTER FUNCTION public\.|COMMIT;|pg_advisory_xact_lock\(/u);
  assert.match(body,/ROLLBACK;/u);
  assert.match(runner,/writerAdmissionFocused\?\s*'FOCUSED_WRITER_ADMISSION_SOURCE_PATHS'/u);
});

test('current admission matrix pins the existing exact source set and resolves six real transitive branches',()=>{
  const m=buildWriterAdmissionMatrix();
  assert.equal(assertWriterAdmissionMatrix(m),true);
  assert.equal(new Set(m.records.map(r=>r.signature)).size,m.records.length);
  const single=m.branches.find(b=>b.id==='READ_MARK_SINGLE');
  const receive=m.branches.find(b=>b.id==='PURCHASE_ORDER_RECEIVING');
  const flavor=m.branches.find(b=>b.id==='PRODUCT_FLAVOR_CREATE');
  assert.equal(single?.firstTransitiveWrite.relation,'public.stock_alert_reads');
  assert.equal(single?.currentGateOrder.sourceOrder,'GATE_ABSENT');
  assert.equal(receive?.firstTransitiveWrite.relation,'public.purchase_receipts');
  assert.equal(receive?.currentGateOrder.sourceOrder,'GATE_PRECEDES_BOUNDARY');
  assert.equal(flavor?.firstTransitiveWrite.relation,'public.products');
  assert.ok(flavor?.wrappers.some(w=>w.rowLocksBeforeDelegate.some(l=>l.mode==='UPDATE')));
  assert.ok(m.records.some(r=>r.sourceTransform==='090_optional_guest_delivery_details.sql:remove-exact-required-street-fragment'));
  assert.equal(m.supportDependencies.length,7);
  assert.ok(m.supportDependencies.every(r=>r.observation.writes.length===0&&r.actorAuthority==='CALLER_MUST_AUTHORIZE'));
  assert.ok(m.incomingCallerEdges.length>0);
  assert.ok(m.incomingCallerEdges.every(e=>typeof e.callerSourceQualified==='boolean'));
  assert.deepEqual(m.unreviewedCallerFrontier,[]);
  assert.equal(m.financialDependencies.length,5);
  assert.equal(m.financialDependencies.find(r=>r.signature.startsWith('public.record_customer_order_payment_once('))?.sourceOwner,'NOT_PROVEN_FROM_SOURCE');
  assert.deepEqual(m.reachableGraphs.map(g=>g.entry),m.records.map(r=>r.signature));
  const familyGraph=m.reachableGraphs.find(g=>g.entry.startsWith('public.create_product_family_with_flavors_v1('));
  assert.ok(familyGraph?.nodes.some(n=>n.signature.startsWith('public.create_product_flavor_v1(')));
  assert.ok(familyGraph?.nodes.some(n=>n.signature.startsWith('public.set_product_primary_image(')));
  assert.ok(familyGraph?.potentialWriteRelations.includes('public.inventory_balances'));
  assert.ok(m.reachableGraphs.every(g=>g.implicitEffectsQualified===false&&g.runtimeAdmissionProven===false));
  assert.equal(m.writerClosed,false);assert.equal(m.executionAuthority,false);
});

test('same-count signature substitution, missing/extra evidence and forged qualification fail closed',()=>{
  const valid=buildWriterAdmissionMatrix();
  const changes=[
    (m:typeof valid)=>{m.records[1]=structuredClone(m.records[0]);},
    (m:typeof valid)=>{m.records.pop();},
    (m:typeof valid)=>{m.records.push(structuredClone(m.records[0]));},
    (m:typeof valid)=>{m.records[0].bodySha256='0'.repeat(64);},
    (m:typeof valid)=>{m.records[0].allowedInvokerClosure=true;},
    (m:typeof valid)=>{m.writerClosed=true;},
    (m:typeof valid)=>{m.branches[0].executionAuthority=true;},
    (m:typeof valid)=>{m.branches[2].firstTransitiveWrite.bodyLine++;},
    (m:typeof valid)=>{m.branches[4].wrappers[0].rowLocksBeforeDelegate=[];},
    (m:typeof valid)=>{m.supportDependencies.pop();},
    (m:typeof valid)=>{m.incomingCallerEdges[0].caller='public.unapproved_substitute(uuid)';},
    (m:typeof valid)=>{m.unreviewedCallerFrontier=['public.hidden(uuid)'];},
    (m:typeof valid)=>{m.financialDependencies.pop();},
    (m:typeof valid)=>{m.reachableGraphs[0].nodes.pop();},
    (m:typeof valid)=>{m.reachableGraphs[0].implicitEffectsQualified=true;},
    (m:typeof valid)=>{m.receiptV2.nodes.pop();},
    (m:typeof valid)=>{m.receiptV2.identityDomains[4].identity=m.receiptV2.identityDomains[6].identity;},
    (m:typeof valid)=>{m.receiptV2.fullRowIdentityDomainImplemented=true;},
    (m:typeof valid)=>{m.receiptV2.schemaSources[0].installedDefaultTriggerFkClosure=true;},
    (m:typeof valid)=>{m.receiptV2.entries[0].prewriteCalls=[];},
  ];
  for(const change of changes){const altered=structuredClone(valid);change(altered);
    assert.throws(()=>assertWriterAdmissionMatrix(altered),/ADMISSION_MATRIX_CHANGED_OR_INCOMPLETE/u);}
});
