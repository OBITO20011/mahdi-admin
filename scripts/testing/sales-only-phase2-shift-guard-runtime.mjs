import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {readApplicationFingerprint} from './backup-restore-contract.mjs';
import {returnPayload215} from './aftercare215-return-cases.mjs';

/** Actual financial writers; no alternate URL, grants, clock or writer body.
 * A held first transaction uses its real locks, then commits only after the
 * second independent PostgreSQL session is observed blocked by its backend. */
export async function verifyShiftReversalGuard(c,report,oldCliQSale){
 const {sql,json,rpc,id,q,j,executor,ownedContainerId,assertOwned}=c;
 assert.equal(executor.command,'docker');
 const target=c.container??'supabase_db_nawasrah-sales-lite2-epoch-test';assert.ok(['supabase_db_nawasrah-sales-lite2-epoch-test','supabase_db_nawasrah-sales-lite3-epoch-test'].includes(target),'SHIFT_GUARD_FIXED_LOCAL_TARGET_REQUIRED');
 assert.deepEqual(executor.args.slice(0,3),['exec','-i',target]);
 assert.match(ownedContainerId,/^[a-f0-9]{64}$/);
 const pinnedExecutor={...executor,args:[...executor.args.slice(0,2),ownedContainerId,...executor.args.slice(3)]};
 const branch=id(200),warehouse=id(201),pid=id(103),key=()=>randomUUID();
 const auth=body=>`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';${body}`;
 const reject=async(call,pattern=/LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND/)=>{
  const before=await readApplicationFingerprint(executor);let error;
  try{await rpc(call);}catch(e){error=e;}assert.ok(error,'EXPECTED_SHIFT_GUARD');assert.match(error.message,pattern);
  assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'DIRECT_REJECTION_ALL_PUBLIC_ROWS_ATOMIC');
 };
 const item=await json(`SELECT to_jsonb(id) FROM public.order_items WHERE order_id=${q(oldCliQSale.orderId)};`);
 const refund=()=>returnPayload215({sale:oldCliQSale,item,pid},{quantity:1,good:1,method:'cliq',reference:'LOCAL-GUARD-CLIQ'});
 const refundCall=async()=>{const payload=refund(),p=await rpc(`lite1_preview_return2(${j(payload)})`);assert.equal(p.moneyRefundInMinorUnits,'1000');return `lite1_settle_return2(${j(payload)},${q(key())},${q(p.previewFingerprint)})`;};
 const makeFull=()=>rpc(`create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(id(401))},'اختبار الحارس الكامل','cash',${j([{commercial_line_kind:'base_unit',product_id:pid,base_quantity:1}])},0,1000,${q(key())})`);
 const quantity=()=>sql(`SELECT on_hand_quantity FROM public.inventory_balances WHERE product_id=${q(pid)} AND warehouse_id=${q(warehouse)};`);
 const pair=shift=>json(auth(`SELECT jsonb_build_object('current',public.lite1_preview_shift_reversal2(${q(shift)}),'original',public.preview_cash_shift_full_reversal(${q(shift)}));COMMIT;`));

 // CliQ-only refund in a genuinely otherwise empty full shift. The original
 // empty-shift cancel route must also be stopped by the same status trigger.
 const cliqShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 await rpc(await refundCall());
 const cliqPreview=await rpc(`lite1_preview_shift_reversal2(${q(cliqShift)})`);
 assert.equal(cliqPreview.liteMonetaryRefundBlocked,true);assert.equal(cliqPreview.canExecute,false);
 await reject(`cancel_empty_cash_shift(${q(cliqShift)},'اختبار إلغاء وردية مع رد مبلغ')`);
 for(const status of ['cancelled','reversed']){
  const before=await readApplicationFingerprint(executor);await assert.rejects(sql(`UPDATE public.cash_shifts SET status=${q(status)} WHERE id=${q(cliqShift)};`),/LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND/);
  assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables);
 }
 const cliqSummary=await rpc(`get_cash_shift_summary(${q(cliqShift)})`);assert.equal(cliqSummary.cliqRefundsInMinorUnits,1000);assert.equal(cliqSummary.expectedCashInMinorUnits,0);
 await rpc(`close_cash_shift(${q(cliqShift)},0,NULL)`);
 const cliqClosing=await rpc(`lite1_shift_closing2(${q(cliqShift)})`);assert.equal(cliqClosing.returnCount,1);assert.equal(cliqClosing.returnMoneyInMinorUnits,1000);assert.equal(cliqClosing.summary.actualCashInMinorUnits,0);
 report.cases.push({name:'CliQ-only oldlite refund blocks emptycancel/directstatus;dailyclose/immutablecash0 andrefund1000 unchanged',passed:true});

 // A zero-money dependency fixture is deliberately confined to ROLLBACK.
 // It is not claimed as a new business-return path or a ledger-integrity case.
 const cleanShift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id;
 const pureSale=await makeFull(),pureQuantity=await quantity(),purePreview=await pair(cleanShift);
 assert.deepEqual(purePreview.current,purePreview.original,'FULL_PREVIEW_ENTIRE_JSON_IDENTICAL');assert.equal(purePreview.current.canExecute,true);
 const fp=await readApplicationFingerprint(executor),zeroKey=key();
 const zero=await json(`BEGIN;INSERT INTO sales_lite1.requests VALUES(${q(zeroKey)},'return2',repeat('0',64),${q(id(1))},'{}');
 INSERT INTO sales_lite1.returns(order_id,item_id,quantity,entitlement,debt_reduction,money_refund,method,shift_id,key,created_by)
 SELECT order_id,item_id,1,1,1,0,'cash',${q(cleanShift)},${q(zeroKey)},created_by FROM sales_lite1.returns WHERE money_refund=0 LIMIT 1;
 UPDATE public.cash_shifts SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=${q(id(1))},cancellation_reason='حالة مبلغ صفر داخل التراجع' WHERE id=${q(cleanShift)};
 SELECT jsonb_build_object('status',(SELECT status FROM public.cash_shifts WHERE id=${q(cleanShift)}),'zeroRows',(SELECT count(*) FROM sales_lite1.returns WHERE key=${q(zeroKey)}));ROLLBACK;`);
 assert.equal(zero.status,'cancelled');assert.equal(zero.zeroRows,1);assert.deepEqual((await readApplicationFingerprint(executor)).tables,fp.tables);
 assert.equal(await sql(`SELECT count(*) FROM sales_lite1.requests WHERE key=${q(zeroKey)};`),'0');
 const pureResult=await rpc(`reverse_cash_shift_with_operations(${q(cleanShift)},'تصحيح وردية كاملة بلا أثر lite',${q(key())})`);
 assert.equal(pureResult.success,true);assert.equal((await rpc(`get_cash_shift_summary(${q(cleanShift)})`)).status,'reversed');
 assert.equal(Number(await quantity()),Number(pureQuantity)+1);assert.equal(await sql(`SELECT count(*) FROM public.pos_sale_reversals WHERE order_id=${q(pureSale.orderId)};`),'1');
 assert.equal(await sql(`SELECT cost_price_in_minor_units FROM public.products WHERE id=${q(pid)};`),'500');
 report.cases.push({name:'full-only preview wholeJSONexact and originalreversal restores onebaseunit/500cost;zero-money fixtureignored+rollback;no blanketmodeblock',passed:true});

 const held=async call=>{
  await assertOwned();const child=spawn(pinnedExecutor.command,pinnedExecutor.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));});
  void done.then(()=>{if(!stdout.includes('LITE2_GUARD_READY:'))rejectReady(Error('HOLDER_DID_NOT_REACH_READY'));},rejectReady);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/LITE2_GUARD_READY:(\d+)/);if(match)resolveReady(Number(match[1]));});
  child.stderr.on('data',chunk=>stderr+=chunk);child.stdin.on('error',e=>{if(!['EOF','EPIPE'].includes(e.code))rejectReady(e);});
  child.stdin.write(auth(`SELECT public.${call};SELECT 'LITE2_GUARD_READY:'||pg_backend_pid();`)+'\n');
  let backend;try{backend=await ready;}catch(error){child.stdin.end('ROLLBACK;\n');await done.catch(()=>{});throw error;}
  return {backend,finish:async commit=>{child.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');await done;}};
 };
 const race=async(first,second,name)=>{
  const holder=await held(first);let contender,blocked=false;
  try{
   await assertOwned();contender=executeInput(pinnedExecutor,auth(`SET LOCAL application_name=${q(name)};SELECT public.${second};COMMIT;`));
   for(let n=0;n<100;n++){
    blocked=await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name)} AND ${holder.backend}=ANY(pg_blocking_pids(pid)));`)==='t';
    if(blocked)break;await setTimeout(50);
   }
  }finally{await holder.finish(blocked);}
  const result=await contender;assert.equal(blocked,true,'REAL_CONTENDER_MUST_WAIT_FOR_FIRST_BACKEND');return result;
 };
 for(const first of ['refund','reversal']){
  const shift=(await rpc(`open_cash_shift(${q(branch)},0)`)).id,full=await makeFull(),beforeStock=await quantity();
  const returnSql=await refundCall(),reversalSql=`reverse_cash_shift_with_operations(${q(shift)},'سباق عكس وردية وهمية',${q(key())})`;
  const oldReturns=await sql(`SELECT count(*) FROM sales_lite1.returns WHERE order_id=${q(oldCliQSale.orderId)};`);
  const result=await race(first==='refund'?returnSql:reversalSql,first==='refund'?reversalSql:returnSql,'lite2-guard-'+first+'-contender');
  assert.notEqual(result.code,0,'SECOND_CONFLICTING_WRITER_MUST_REJECT');
  assert.match(result.stderr,first==='refund'?/LITE2_SHIFT_REVERSAL_HAS_LITE_REFUND/:/PHASE4_LOCK_PLAN_CHANGED_RETRY|AFTERCARE215_PREVIEW_CHANGED|LITE1_SHIFT_REQUIRED|LITE2_RETURN_REVIEW_REQUIRED/);
  const summary=await rpc(`get_cash_shift_summary(${q(shift)})`);
  if(first==='refund'){
   assert.equal(summary.status,'open');assert.equal(summary.cliqRefundsInMinorUnits,1000);assert.equal(summary.expectedCashInMinorUnits,1000);
   assert.equal(await quantity(),beforeStock);assert.equal(await sql(`SELECT count(*) FROM public.pos_sale_reversals WHERE order_id=${q(full.orderId)};`),'0');
   assert.equal(Number(await sql(`SELECT count(*) FROM sales_lite1.returns WHERE order_id=${q(oldCliQSale.orderId)};`)),Number(oldReturns)+1);
   await rpc(`close_cash_shift(${q(shift)},1000,NULL)`);
  }else{
   assert.equal(summary.status,'reversed');assert.equal(Number(await quantity()),Number(beforeStock)+1);
   assert.equal(await sql(`SELECT count(*) FROM sales_lite1.returns WHERE order_id=${q(oldCliQSale.orderId)};`),oldReturns);
   assert.equal(await sql(`SELECT count(*) FROM public.pos_sale_reversals WHERE order_id=${q(full.orderId)};`),'1');
  }
  report.cases.push({name:`real shiftlock race ${first} firstcommits;contenderblocked+rejects;no lostrefund/unfundedreturn/duplicatereversal`,passed:true});
 }
 for(const role of ['anon','service_role'])assert.equal(await sql(`SELECT has_function_privilege(${q(role)},'public.lite1_preview_shift_reversal2(uuid)','EXECUTE');`),'f');
 assert.equal(await sql("SELECT has_function_privilege('authenticated','sales_lite2.guard_shift_lite_refund()','EXECUTE');"),'f');
}
