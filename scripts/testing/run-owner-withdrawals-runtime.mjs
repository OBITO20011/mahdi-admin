// Isolated runtime proof for owner withdrawals (180-182), following the
// acceptance gate of docs/design/OWNER_WITHDRAWALS_DESIGN_AR.md and the owner
// decisions of 2026-10-15. No Production access.
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertPackageDDbLint} from './package-d-db-lint-policy.mjs';
import {schemaCatalogSql,catalogDifference} from './schema-catalog.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';
import {logicalRestoreDifferences,platformPostInitSql,readApplicationFingerprint} from './backup-restore-contract.mjs';

const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'../..');
const projectId='nawasrah-owner-withdrawals-test',container=`supabase_db_${projectId}`;
const cli=path.join(root,'node_modules/supabase/dist/supabase.js');
const output=await mkdtemp(path.join(tmpdir(),'nawasrah-withdrawals-'));
const id=n=>`92600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),admin=id(2),cashier=id(3),manager=id(4),accountant=id(5);
const product=id(103),branch=id(200),warehouse=id(201),branch2=id(210),warehouse2=id(211);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
let workdir,stage='bootstrap001-182',keyCounter=0,restoreClusterStarted=false;
const restoreData='/tmp/withdrawal-restore-pgdata',restoreSocket='/tmp/withdrawal-restore-socket';
const key=label=>`ow-${label}-${String(++keyCounter).padStart(4,'0')}-0000000000`;

const psql=(text,database='postgres')=>new Promise((resolve,reject)=>{
  const started=Date.now();
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
  child.on('error',reject);child.on('close',code=>resolve({code,out:out.trim(),err,ms:Date.now()-started}));
  child.stdin.end(`SET statement_timeout='60s';SET lock_timeout='30s';\n${text}`);
});
const sql=async(text,database)=>{const r=await psql(text,database);if(r.code!==0)throw Error(`${stage}: ${r.err.slice(-4000)}`);return r.out;};
const json=async(text,database)=>JSON.parse((await sql(text,database)).split('\n').at(-1));
const claims=actor=>`DO $$BEGIN PERFORM set_config('request.jwt.claims',${q(JSON.stringify({sub:actor,role:'authenticated',aal:'aal2'}))},true);END$$;
  SET LOCAL ROLE authenticated;`;
const asUser=(actor,body,commit=true)=>`BEGIN;${claims(actor)}${body}${commit?'COMMIT':'ROLLBACK'};`;
const heldPsql=async(actor,body,tag)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-v','ON_ERROR_STOP=1'],
    {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let out='',err='',released=false,readyResolve,readyReject;
  const marker=tag+'_READY',ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;if(out.split(/\r?\n/u).includes(marker))readyResolve();});
  child.stderr.on('data',chunk=>err+=chunk);
  const done=new Promise((resolve,reject)=>{
    child.once('error',error=>{readyReject(error);reject(error);});
    child.once('close',code=>{readyReject(new Error('HELD_SESSION_ENDED_BEFORE_READY:'+err));resolve({code,out:out.trim(),err});});
  });
  child.stdin.write(`SET statement_timeout='60s';SET lock_timeout='30s';SET application_name=${q(tag)};BEGIN;${claims(actor)}${body}SELECT ${q(marker)};\n`);
  await ready;
  return {tag,done,release:()=>{if(!released){released=true;child.stdin.end('COMMIT;\n');}},rollback:()=>{if(!released){released=true;child.stdin.end('ROLLBACK;\n');}}};
};
const rpc=(actor,call,{commit=true,database}={})=>json(asUser(actor,`SELECT public.${call};`,commit),database);
const refused=async(actor,call,pattern)=>{const r=await psql(asUser(actor,`SELECT public.${call};`,false));
  assert.notEqual(r.code,0,`${call} must be refused`);assert.match(r.err,pattern,r.err);return r.err;};
const ROLE=/صلاحية|صلاحيات|غير مصرح|ليس لديك|AAL2|مالك/u;
const today=async()=>sql(`SELECT (now() AT TIME ZONE 'Asia/Amman')::date;`);
const summary=shift=>rpc(owner,`get_cash_shift_summary(${q(shift)})`,{commit:false});
const expected=async shift=>Number((await summary(shift)).expectedCashInMinorUnits);
const withdraw=(shift,amount,k,reason=null,actor=owner)=>rpc(actor,`create_owner_cash_withdrawal_v1(${q(shift)},${amount},${reason===null?'NULL':q(reason)},${q(k)})`);
const reverse=(withdrawal,reason,k,actor=owner)=>rpc(actor,`reverse_owner_cash_withdrawal_v1(${q(withdrawal)},${q(reason)},${q(k)})`);
// generatedAt is a per-call timestamp; everything else is compared literally.
const report=async(actor,day,branchId=branch)=>{const {generatedAt:_g,...rest}=await rpc(actor,`get_operational_business_report(${branchId===null?'NULL':q(branchId)},${q(day)}::date,${q(day)}::date)`,{commit:false});void _g;return rest;};
const sell=(k,quantity,shiftBranch=branch,shiftWarehouse=warehouse)=>rpc(owner,`create_pos_sale_v2(${q(shiftWarehouse)},${q(shiftBranch)},NULL,'زبون نقدي','cash',
  ${j([{commercial_line_kind:'base_unit',product_id:product,base_quantity:quantity,price_authority:'server_catalog',line_discount_in_minor_units:0}])},0,${quantity*5000},${q(k)})`);
const monitor=async keyName=>{await sql(`SELECT public.run_advanced_monitoring_checks(now());`);
  return json(`SELECT jsonb_build_object('status',status,'count',issue_count) FROM advanced_monitoring_checks WHERE check_key=${q(keyName)};`);};

try{
  const {stdout}=await exec(process.execPath,[path.join(root,'scripts/testing/bootstrap-isolated-supabase.mjs')],{
    cwd:root,windowsHide:true,timeout:900000,maxBuffer:8*1024*1024,env:{...process.env,
      NAWASRAH_ISOLATED_PROJECT_ID:projectId,NAWASRAH_MAX_MIGRATION:'182',NAWASRAH_SKIP_REDUNDANT_DB_RESET:'true',
      NAWASRAH_SUPABASE_EXCLUDE:'gotrue,kong,postgrest,realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'}});
  const boot=JSON.parse(stdout);assert.equal(boot.ok,true);workdir=boot.isolatedProjectRoot;

  stage='fixture';
  await sql(`ALTER TABLE orders DISABLE TRIGGER trg_notify_new_website_order_push;SELECT cron.alter_job(jobid,active:=false) FROM cron.job;`);
  await sql(await readFile(path.join(root,'scripts/testing/package-e-golden-day-fixture.sql'),'utf8'));
  for(const [actor,role] of [[admin,'admin'],[cashier,'cashier'],[manager,'manager'],[accountant,'accountant']])await sql(`
    INSERT INTO auth.users(id,aud,role,email) VALUES(${q(actor)},'authenticated','authenticated',${q(role+'@withdrawals.example.test')});
    INSERT INTO profiles(id,full_name,is_active) VALUES(${q(actor)},${q(role)},true);
    INSERT INTO roles(code,name_ar) VALUES(${q(role)},${q(role)}) ON CONFLICT(code) DO NOTHING;
    INSERT INTO user_roles(user_id,role_id) SELECT ${q(actor)},r.id FROM roles r WHERE r.code=${q(role)};`);
  await sql(`UPDATE products SET wac_cost_in_minor_units_exact=NULL,sale_price_in_minor_units=5000,wholesale_price_in_minor_units=5000,
      default_sale_price_in_minor_units=25000 WHERE id=${q(product)};
    INSERT INTO branches(id,code,name_ar,is_active) VALUES(${q(branch2)},'E-SECOND','الفرع الثاني',true);
    INSERT INTO warehouses(id,branch_id,code,name_ar,is_active,created_at) VALUES(${q(warehouse2)},${q(branch2)},'E-SECOND','مستودع الثاني',true,'1900-01-01');`);
  const day=await today();

  stage='ACL';
  const acl=await json(`SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'definer',p.prosecdef,'config',p.proconfig))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE '%owner%withdrawal%';`);
  assert.ok(Object.keys(acl).length>=10);
  for(const [sig,value] of Object.entries(acl)){
    assert.equal(value.anon,false,sig);assert.equal(value.definer,true,sig);
    assert.ok((value.config||[]).includes('search_path=public, pg_temp'),sig);
    assert.equal(value.authenticated,/^(create_owner_cash_withdrawal_v1|reverse_owner_cash_withdrawal_v1|get_owner_withdrawals_report|get_shift_owner_withdrawals_v1)\(/u.test(sig),`${sig} client EXECUTE`);
  }
  for(const table of ['owner_cash_withdrawals','owner_cash_withdrawal_reversals']){
    const t=await json(`SELECT jsonb_build_object('rls',c.relrowsecurity,'anon',has_table_privilege('anon','public.${table}','SELECT'),
      'auth',has_table_privilege('authenticated','public.${table}','SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c WHERE c.oid='public.${table}'::regclass;`);
    assert.deepEqual(t,{rls:true,anon:false,auth:false},`${table} is RPC-only`);
  }

  stage='scenario: expected 100.000 and profit 30.000';
  assert.equal((await rpc(owner,`create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},
    p_idempotency_key:='ow-receipt-000000000000000001',p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(950),line_kind:'base_unit',
    commercial_quantity:40,base_unit_name:'باكيت',gross_amount_in_minor_units:80000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:40}]}])})`)).success,true);
  const s1=(await rpc(owner,`open_cash_shift(${q(branch)},50000)`)).id;assert.ok(s1);
  assert.equal((await sell('ow-sale-0000000000000000001',10)).success,true);
  assert.equal(await expected(s1),100000,'opening 50.000 + cash sale 50.000');
  const before=await report(owner,day);
  assert.equal(before.sales.netProfitInMinorUnits,30000,'10 × (5.000 − 2.000)');
  assert.deepEqual(before.ownerWithdrawals,{withdrawnInMinorUnits:0,returnedInMinorUnits:0,netInMinorUnits:0,
    netProfitInMinorUnits:30000,remainingAfterWithdrawalsInMinorUnits:30000});
  const adminBefore=await report(admin,day);
  assert.equal(adminBefore.ownerWithdrawals,undefined,'withdrawals are owner-only in the report');

  stage='withdraw 20.000 ⇒ 80.000 / 30.000 / 10.000';
  const k1=key('w1');
  const w1=await withdraw(s1,20000,k1,'مصروف شخصي');
  assert.equal(w1.success,true);assert.equal(w1.idempotentReplay,false);assert.match(w1.withdrawalNumber,/^OW-\d{6}$/u);
  assert.equal(await expected(s1),80000);
  const live=await rpc(owner,`get_cash_shift_closing_report(${q(s1)})`,{commit:false});
  assert.equal(live.ownerWithdrawals.withdrawnInMinorUnits,20000,'live closing report lists the withdrawal');
  assert.equal(live.ownerWithdrawals.netInMinorUnits,20000);
  assert.equal(live.ownerWithdrawals.netMovementAfterWithdrawalsInMinorUnits,30000,'server computes movement after withdrawals');
  console.log(JSON.stringify({stage:'live closing report reconciliation',reconciliation:live.reconciliation}));
  const after=await report(owner,day);
  assert.equal(after.sales.netProfitInMinorUnits,30000,'profit unchanged by the withdrawal');
  assert.equal(after.ownerWithdrawals.netInMinorUnits,20000);assert.equal(after.ownerWithdrawals.remainingAfterWithdrawalsInMinorUnits,10000);
  const {ownerWithdrawals:_ow,...ownerRest}=after;void _ow;
  assert.deepEqual(ownerRest,await report(admin,day),'old financial JSON identical except the owner-only withdrawal block');
  assert.deepEqual(await report(admin,day),adminBefore,'admin report unchanged by the withdrawal');

  stage='replay / double-click / two tabs';
  const replay=await withdraw(s1,20000,k1,'مصروف شخصي');
  assert.equal(replay.idempotentReplay,true);assert.equal(replay.withdrawalId,w1.withdrawalId);
  await refused(owner,`create_owner_cash_withdrawal_v1(${q(s1)},21000,'مصروف شخصي',${q(k1)})`,/OWNER_WITHDRAWAL_KEY_CONFLICT/u);
  const dbl=key('dbl');
  const [c1,c2]=await Promise.all([withdraw(s1,1000,dbl),withdraw(s1,1000,dbl)]);
  assert.equal(c1.withdrawalId,c2.withdrawalId,'a double click creates one withdrawal');
  assert.equal([c1,c2].filter(r=>r.idempotentReplay).length,1);
  assert.equal(await expected(s1),79000);
  const tabs=await Promise.allSettled([withdraw(s1,50000,key('tabA')),withdraw(s1,50000,key('tabB'))]);
  assert.equal(tabs.filter(t=>t.status==='fulfilled').length,1,'two tabs cannot both take more than the drawer holds');
  assert.match(String(tabs.find(t=>t.status==='rejected').reason),/بالدرج 29\.000 د\.أ فقط/u);
  assert.equal(await expected(s1),29000);
  const tabWin=tabs.find(t=>t.status==='fulfilled').value;

  stage='drawer cap (decision 2)';
  await refused(owner,`create_owner_cash_withdrawal_v1(${q(s1)},29001,NULL,${q(key('cap'))})`,/OWNER_WITHDRAWAL_EXCEEDS_DRAWER: بالدرج 29\.000 د\.أ فقط/u);

  stage='roles';
  for(const actor of [admin,manager,cashier,accountant]){
    await refused(actor,`create_owner_cash_withdrawal_v1(${q(s1)},100,NULL,${q(key('role'))})`,ROLE);
    await refused(actor,`reverse_owner_cash_withdrawal_v1(${q(w1.withdrawalId)},'سبب الاختبار',${q(key('role'))})`,ROLE);
    await refused(actor,`get_owner_withdrawals_report(NULL,${q(day)}::date,${q(day)}::date,1,25)`,ROLE);
    await refused(actor,`get_shift_owner_withdrawals_v1(${q(s1)})`,ROLE);
    const dashboard=await rpc(actor,'get_home_dashboard()',{commit:false}).catch(()=>null);
    if(dashboard)assert.equal(dashboard.summary.monthOwnerWithdrawalsInMinorUnits,undefined,'no withdrawal figures for other roles');
  }
  const ownerDashboard=await rpc(owner,'get_home_dashboard()',{commit:false});
  assert.equal(ownerDashboard.summary.monthOwnerWithdrawalsInMinorUnits,71000);
  assert.equal(ownerDashboard.summary.monthRemainingAfterWithdrawalsInMinorUnits,ownerDashboard.summary.monthProfitInMinorUnits-71000);

  stage='unavailable financial facts preserve legacy JSON but never invent remaining profit';
  const unavailable=await json(`BEGIN;
    ALTER FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) RENAME TO test_original_financial_facts;
    CREATE FUNCTION public.phase6_financial_facts_internal(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) RETURNS JSONB LANGUAGE plpgsql
      AS $$BEGIN RAISE EXCEPTION 'TEST_FINANCIAL_FACTS_UNAVAILABLE';END$$;
    ${claims(owner)}SELECT public.get_home_dashboard();ROLLBACK;`);
  assert.equal(unavailable.financialFactsStatus,'unavailable');
  assert.equal(unavailable.summary.monthOwnerWithdrawalsInMinorUnits,71000,'drawer evidence does not depend on profit availability');
  assert.equal(unavailable.summary.monthRemainingAfterWithdrawalsInMinorUnits,null,'unavailable profit must stay unavailable');

  stage='reverse in the open shift ⇒ back to the drawer; double reversal refused';
  await refused(owner,`reverse_owner_cash_withdrawal_v1(${q(w1.withdrawalId)},'قصير',${q(key('short'))})`,/REASON_REQUIRED/u);
  const kr=key('r1');
  const r1=await reverse(w1.withdrawalId,'أُعيد المبلغ للدرج',kr);
  assert.equal(r1.effectiveShiftId,s1);assert.equal(await expected(s1),49000);
  assert.equal((await reverse(w1.withdrawalId,'أُعيد المبلغ للدرج',kr)).idempotentReplay,true);
  await refused(owner,`reverse_owner_cash_withdrawal_v1(${q(w1.withdrawalId)},'عكس ثانٍ مكرر',${q(key('r1b'))})`,/OWNER_WITHDRAWAL_ALREADY_REVERSED/u);
  const reversedReport=await report(owner,day);
  assert.equal(reversedReport.ownerWithdrawals.netInMinorUnits,51000,'1.000 + 50.000 still out');
  // Clean acceptance numbers: undo the two extra withdrawals.
  await reverse(c1.withdrawalId,'إرجاع اختبار النقر المزدوج',key('rdbl'));
  await reverse(tabWin.withdrawalId,'إرجاع اختبار التبويبين',key('rtab'));
  assert.equal(await expected(s1),100000,'after the reversal ⇒ 100.000');
  const back=await report(owner,day);
  assert.equal(back.sales.netProfitInMinorUnits,30000);assert.equal(back.ownerWithdrawals.netInMinorUnits,0);
  assert.equal(back.ownerWithdrawals.remainingAfterWithdrawalsInMinorUnits,30000,'⇒ 100.000 / 30.000 / 30.000');

  stage='withdraw 40.000 with profit 30.000 ⇒ remaining −10.000 (cash allows)';
  const w40=await withdraw(s1,40000,key('w40'));
  assert.equal((await report(owner,day)).ownerWithdrawals.remainingAfterWithdrawalsInMinorUnits,-10000,'negative is not clipped');
  assert.equal(await expected(s1),60000);

  stage='concurrent close and withdrawal';
  const closeKey=key('race');
  const sessionA=await heldPsql(owner,`SELECT public.create_owner_cash_withdrawal_v1(${q(s1)},5000,NULL,${q(closeKey)});`,'withdrawal_close_session_a');
  const sessionB=psql(asUser(owner,`SELECT public.close_cash_shift(${q(s1)},55000,NULL);`));
  let closeBlocked=0;
  try{
    for(let i=0;i<60&&!closeBlocked;i++){
      closeBlocked=Number(await sql(`SELECT count(*) FROM pg_stat_activity b WHERE b.wait_event_type='Lock'
        AND b.query LIKE '%SELECT public.close_cash_shift(%' AND b.pid<>pg_backend_pid()
        AND EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name=${q(sessionA.tag)} AND a.pid=ANY(pg_blocking_pids(b.pid)));`));
      if(!closeBlocked)await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.equal(closeBlocked,1,'close must be blocked by the actual withdrawal transaction');sessionA.release();
  }finally{sessionA.rollback();}
  const [ra,rb]=await Promise.all([sessionA.done,sessionB]);
  assert.equal(ra.code,0,ra.err);assert.equal(rb.code,0,rb.err);
  const closed=await json(`SELECT jsonb_build_object('status',status,'expected',expected_cash_in_minor_units,'discrepancy',cash_discrepancy_in_minor_units,
    'snapshot',closing_report_snapshot) FROM cash_shifts WHERE id=${q(s1)};`);
  assert.equal(closed.status,'closed');assert.equal(closed.expected,55000,'the close froze the withdrawal made just before it');
  assert.equal(closed.discrepancy,0);
  assert.equal(closed.snapshot.ownerWithdrawals.sectionVersion,1);
  assert.equal(closed.snapshot.ownerWithdrawals.withdrawnInMinorUnits,116000);
  assert.equal(closed.snapshot.ownerWithdrawals.returnedInMinorUnits,71000);
  await refused(owner,`create_owner_cash_withdrawal_v1(${q(s1)},100,NULL,${q(key('afterclose'))})`,/OWNER_WITHDRAWAL_SHIFT_NOT_OPEN/u);
  assert.equal((await withdraw(s1,5000,closeKey)).idempotentReplay,true,'the same request replays even after the close');
  const snapshotBefore=JSON.stringify(closed.snapshot);

  stage='reverse a withdrawal of a closed shift (decision 1)';
  await refused(owner,`reverse_owner_cash_withdrawal_v1(${q(w40.withdrawalId)},'إرجاع بعد الإغلاق',${q(key('nos'))})`,/OWNER_WITHDRAWAL_REVERSAL_NEEDS_OPEN_SHIFT/u);
  const s2=(await rpc(owner,`open_cash_shift(${q(branch)},10000)`)).id;
  const late=await reverse(w40.withdrawalId,'إرجاع بعد الإغلاق',key('late'));
  assert.equal(late.effectiveShiftId,s2,'booked in the open shift of the same branch');
  assert.equal(await expected(s2),50000,'10.000 opening + 40.000 returned');
  assert.equal(JSON.stringify((await json(`SELECT closing_report_snapshot FROM cash_shifts WHERE id=${q(s1)};`))),snapshotBefore,'closed snapshot unchanged');
  assert.equal((await json(`SELECT jsonb_build_object('e',expected_cash_in_minor_units) FROM cash_shifts WHERE id=${q(s1)};`)).e,55000);
  assert.equal((await monitor('integrity:shifts:closing')).status,'healthy','closing check accounts for withdrawals');
  assert.equal((await monitor('integrity:accounting:owner-withdrawals')).status,'healthy');

  stage='other branch and paging';
  const s9=(await rpc(owner,`open_cash_shift(${q(branch2)},30000)`)).id;
  for(const amount of [1000,2000,3000])await withdraw(s9,amount,key('b2'));
  const all=await rpc(owner,`get_owner_withdrawals_report(NULL,${q(day)}::date,${q(day)}::date,1,100)`,{commit:false});
  const b1=await rpc(owner,`get_owner_withdrawals_report(${q(branch)},${q(day)}::date,${q(day)}::date,1,100)`,{commit:false});
  const b2=await rpc(owner,`get_owner_withdrawals_report(${q(branch2)},${q(day)}::date,${q(day)}::date,1,100)`,{commit:false});
  assert.equal(b2.totals.netInMinorUnits,6000);
  assert.equal(all.totals.netInMinorUnits,b1.totals.netInMinorUnits+b2.totals.netInMinorUnits,'branches add up');
  let paged=0,pagedRows=0;
  for(let page=1;page<=Math.ceil(all.totalCount/3);page++){
    const r=await rpc(owner,`get_owner_withdrawals_report(NULL,${q(day)}::date,${q(day)}::date,${page},3)`,{commit:false});
    assert.deepEqual(r.totals,all.totals,'totals cover all pages, not the visible page');
    paged+=r.rows.reduce((s,row)=>s+(row.direction==='out'?row.amountInMinorUnits:-row.amountInMinorUnits),0);pagedRows+=r.rows.length;
  }
  assert.equal(pagedRows,all.totalCount);assert.equal(paged,all.totals.netInMinorUnits,'page rows add up to the totals');
  const yesterday=await rpc(owner,`get_owner_withdrawals_report(NULL,(${q(day)}::date-1),(${q(day)}::date-1),1,25)`,{commit:false});
  assert.equal(yesterday.totalCount,0,'Amman day boundaries');

  stage='full shift reversal: preview, refusal before any write, atomic rollback, success';
  // s3: withdrawal returned in another shift ⇒ not containable.
  const w2=await withdraw(s2,3000,key('s2w'));
  await rpc(owner,`close_cash_shift(${q(s2)},${await expected(s2)},NULL)`);
  const s4=(await rpc(owner,`open_cash_shift(${q(branch)},0)`)).id;
  const w2back=await reverse(w2.withdrawalId,'إرجاع في وردية لاحقة',key('s2back'));assert.equal(w2back.effectiveShiftId,s4);
  const blocked=await rpc(owner,`preview_cash_shift_full_reversal(${q(s2)})`,{commit:false});
  assert.equal(blocked.ownerWithdrawals.canExecute,false);assert.equal(blocked.canExecute,false);
  const reversalsBefore=await sql(`SELECT count(*) FROM cash_shift_reversals;`);
  await refused(owner,`reverse_cash_shift_with_operations(${q(s2)},'عكس للاختبار',${q(key('blocked'))})`,/OWNER_WITHDRAWAL_RETURNED_IN_OTHER_SHIFT/u);
  assert.equal(await sql(`SELECT count(*) FROM cash_shift_reversals;`),reversalsBefore,'refused before any write');
  // s4 holds a return of w2 (from s2) and its own withdrawal w4: both are handled.
  // A real operation too: a shift holding only withdrawals is not "empty" and
  // closes normally; the core full reversal requires shift operations and an
  // open shift (a closed one is refused by the core preview).
  assert.equal((await sell('ow-sale-s4-00000000000000001',1)).success,true);
  const w4=await withdraw(s4,2000,key('s4w'));
  const plan=await rpc(owner,`preview_cash_shift_full_reversal(${q(s4)})`,{commit:false});
  assert.equal(plan.ownerWithdrawals.canExecute,true);
  assert.deepEqual(plan.ownerWithdrawals.withdrawalsToReverse.map(x=>x.withdrawalId),[w4.withdrawalId]);
  assert.deepEqual(plan.ownerWithdrawals.returnsToVoid.map(x=>x.withdrawalId),[w2.withdrawalId]);
  // Inject a failure after the core reversal: everything must roll back.
  await sql(`CREATE OR REPLACE FUNCTION public.test_owner_withdrawal_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'INJECTED_FAILURE'; END$$;
    CREATE TRIGGER test_owner_withdrawal_fail BEFORE INSERT ON public.owner_cash_withdrawal_reversals
      FOR EACH ROW WHEN (NEW.via_shift_reversal_id IS NOT NULL) EXECUTE FUNCTION public.test_owner_withdrawal_fail();`);
  await refused(owner,`reverse_cash_shift_with_operations(${q(s4)},'عكس للاختبار',${q(key('inject'))})`,/INJECTED_FAILURE/u);
  assert.equal((await json(`SELECT jsonb_build_object('s',status) FROM cash_shifts WHERE id=${q(s4)};`)).s,'open','the whole shift reversal rolled back');
  assert.equal(await sql(`SELECT count(*) FROM cash_shift_reversals;`),reversalsBefore);
  await sql(`DROP TRIGGER test_owner_withdrawal_fail ON public.owner_cash_withdrawal_reversals;DROP FUNCTION public.test_owner_withdrawal_fail();`);
  const done=await rpc(owner,`reverse_cash_shift_with_operations(${q(s4)},'عكس الوردية بالكامل',${q(key('full'))})`);
  assert.equal(done.success,true);assert.equal(done.ownerWithdrawals.withdrawalsReversedCount,1);assert.equal(done.ownerWithdrawals.returnsVoidedCount,1);
  const w2state=await rpc(owner,`get_shift_owner_withdrawals_v1(${q(s2)})`,{commit:false});
  assert.equal(w2state.withdrawals[0].reversal,null,'w2 stands again: its return was voided with the reversed shift');
  assert.equal((await monitor('integrity:accounting:owner-withdrawals')).status,'healthy');
  assert.equal((await monitor('integrity:shifts:closing')).status,'healthy');
  const voidEvent=(await rpc(owner,`get_owner_withdrawals_report(NULL,${q(day)}::date,${q(day)}::date,1,100)`,{commit:false})).rows.find(r=>r.kind==='return_voided');
  assert.ok(voidEvent,'the voided return is an outflow event at void time, not a rewrite');
  await refused(owner,`cancel_empty_cash_shift(${q(s9)},'وردية بالخطأ')`,/حركة مالية/u);

  stage='immutability and monitoring injection';
  for(const statement of [`UPDATE owner_cash_withdrawals SET amount_in_minor_units=1`,`DELETE FROM owner_cash_withdrawal_reversals`,
    `TRUNCATE owner_cash_withdrawals CASCADE`,`UPDATE owner_cash_withdrawal_reversals SET reason='تغيير'`]){
    const r=await psql(statement+';');assert.notEqual(r.code,0,statement);assert.match(r.err,/OWNER_WITHDRAWAL_IMMUTABLE/u);
  }
  const direct=await psql(asUser(owner,`SELECT count(*) FROM public.owner_cash_withdrawals;`,false));
  assert.match(direct.err,/permission denied/u,'the UI cannot read the table directly');
  await sql(`ALTER TABLE owner_cash_withdrawal_reversals DISABLE TRIGGER trg_owner_cash_withdrawal_reversals_immutable;
    UPDATE owner_cash_withdrawal_reversals SET amount_in_minor_units=amount_in_minor_units+1 WHERE id=${q(late.reversalId)};`);
  const injected=await monitor('integrity:accounting:owner-withdrawals');
  assert.equal(injected.status,'critical');assert.ok(injected.count>=1);
  await sql(`UPDATE owner_cash_withdrawal_reversals SET amount_in_minor_units=amount_in_minor_units-1 WHERE id=${q(late.reversalId)};
    ALTER TABLE owner_cash_withdrawal_reversals ENABLE TRIGGER trg_owner_cash_withdrawal_reversals_immutable;`);
  assert.equal((await monitor('integrity:accounting:owner-withdrawals')).status,'healthy','no automatic correction; healthy once fixed');

  stage='backup restore then replay without a double effect';
  // Restore to a genuinely empty cluster of the SAME binaries in this disposable
  // container. pg_cron requires database postgres; --clean on the live platform
  // cannot drop inherited realtime partition constraints. Exclude NOTHING and
  // fail on every restore error. Source DB stays intact for the parity oracle.
  assert.equal(container,'supabase_db_nawasrah-owner-withdrawals-test');
  const restoreAdmin=await exec('docker',['exec',container,'psql','-U','supabase_admin','-d','postgres','-X','-q','-At','-w','-c',
    'SELECT rolsuper FROM pg_roles WHERE rolname=current_user;'],{windowsHide:true});
  assert.equal(restoreAdmin.stdout.trim(),'t','LOCAL_PLATFORM_RESTORE_ROLE_REQUIRED');
  const preload=await sql('SHOW shared_preload_libraries;');
  assert.match(preload,/^[a-z_]+(?:,\s*[a-z_]+)*$/u,'RESTORE_PRELOAD_NAMES');
  const catalogBeforeRestore=JSON.parse(await sql(schemaCatalogSql));
  assert.ok(catalogBeforeRestore.extensions.every(extension=>extension.owner==='supabase_admin'),'RESTORE_EXTENSION_OWNER_NOT_SUPPORTED');
  const sourceExecutor={command:'docker',args:['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-q','-At','-w','-v','ON_ERROR_STOP=1']};
  const applicationBeforeRestore=await readApplicationFingerprint(sourceExecutor);
  const restoredCount=await sql('SELECT count(*) FROM owner_cash_withdrawals;');
  await exec('docker',['exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc','-f','/tmp/rehearsal.dump'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  await exec('docker',['exec',container,'pg_dumpall','-U','supabase_admin','--roles-only','--no-role-passwords','-f','/tmp/withdrawal-roles.sql'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  await exec('docker',['exec','--user','postgres',container,'sh','-c',
    `mkdir -p ${restoreSocket} && initdb -D ${restoreData} -U supabase_admin --auth=trust >/tmp/withdrawal-init.log && pg_ctl -D ${restoreData} -l /tmp/withdrawal-restore.log -o "-p 25435 -k ${restoreSocket} -c listen_addresses='' -c shared_preload_libraries='${preload}' -c cron.database_name=postgres -c wal_level=logical" -w start`],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});
  restoreClusterStarted=true;
  const target=['-h',restoreSocket,'-p','25435','-d','postgres'];
  const globals=await exec('docker',['exec',container,'cat','/tmp/withdrawal-roles.sql'],{windowsHide:true,maxBuffer:16*1024*1024});
  // The initial superuser must retain the source grantor identity. Only its
  // duplicate CREATE is omitted;its ALTER attributes and ALL grants still run.
  assert.equal((globals.stdout.match(/^CREATE ROLE supabase_admin;$/gmu)??[]).length,1,'ONE_BOOTSTRAP_ADMIN_DECLARATION');
  const globalsResult=await executeInput({command:'docker',args:['exec','-i',container,'psql','-U','supabase_admin',...target,'-X','-q','-w','-v','ON_ERROR_STOP=1']},
    globals.stdout.replace(/^CREATE ROLE supabase_admin;$/mu,'-- Already created identically by initdb;ALTER follows.'));
  assert.equal(globalsResult.code,0,globalsResult.stderr);
  await exec('docker',['exec',container,'psql','-U','supabase_admin',...target,'-X','-q','-w','-v','ON_ERROR_STOP=1','-c',
    'ALTER DATABASE postgres OWNER TO postgres;'],{windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});
  // Standard pg_restore creates as the restoration administrator,then restores
  // each original OWNER/ACL. --no-owner is deliberately NOT used. Switching the
  // creation session to pgbouncer would require nonexistent pre-restore DB grants.
  await exec('docker',['exec',container,'pg_restore','-U','supabase_admin',...target,'--no-password','--exit-on-error','/tmp/rehearsal.dump'],
    {windowsHide:true,maxBuffer:16*1024*1024,timeout:300000});
  const restoredExecutor={command:'docker',args:['exec','-i',container,'psql','-U','postgres',...target,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1']};
  const restoredSql=async input=>{
    const result=await executeInput(restoredExecutor,input);
    assert.equal(result.code,0,result.stderr);return result.stdout.trim();
  };
  const rawRestored=JSON.parse(await restoredSql(schemaCatalogSql));
  await writeFile(path.join(output,'raw-restore-differences.json'),JSON.stringify(catalogDifference(catalogBeforeRestore,rawRestored),null,2)+'\n');
  const postInit=await executeInput({command:'docker',args:['exec','-i',container,'psql','-U','supabase_admin',...target,'-X','-q','-At','-w','-v','ON_ERROR_STOP=1']},platformPostInitSql(catalogBeforeRestore));
  assert.equal(postInit.code,0,postInit.stderr);
  assert.equal(restoredCount,await restoredSql('SELECT count(*) FROM owner_cash_withdrawals;'));
  const restoredCatalog=JSON.parse(await restoredSql(schemaCatalogSql));
  const differences=logicalRestoreDifferences(catalogBeforeRestore,restoredCatalog);
  await writeFile(path.join(output,'logical-restore-differences.json'),JSON.stringify(differences,null,2)+'\n');
  assert.equal(differences.length,0,'FULL_LOGICAL_RESTORE_CATALOG_MUST_MATCH:'+output);
  assert.deepEqual(await readApplicationFingerprint(restoredExecutor),applicationBeforeRestore,'ALL_PUBLIC_DATA_AND_SEQUENCE_POSITIONS_RESTORED');
  const restoredReplay=JSON.parse(await restoredSql(asUser(owner,`SELECT public.create_owner_cash_withdrawal_v1(${q(s1)},20000,'مصروف شخصي',${q(k1)});`)));
  assert.equal(restoredReplay.idempotentReplay,true);assert.equal(restoredReplay.withdrawalId,w1.withdrawalId);
  assert.equal(await restoredSql('SELECT count(*) FROM owner_cash_withdrawals;'),restoredCount,'no second withdrawal after restore');
  assert.deepEqual(await readApplicationFingerprint(restoredExecutor),applicationBeforeRestore,'RESTORE_REPLAY_MUST_NOT_CHANGE_ANY_PUBLIC_ROW_OR_SEQUENCE');

  console.log(JSON.stringify({stage:'acceptance gate',passed:true,scenario:'100/30 ⇒ 80/30/10 ⇒ 100/30/30; 40 ⇒ −10',drawerCap:true,
    roles:true,replayDoubleClickTabs:true,doubleReversal:true,closeRace:true,closedShiftReversalInOpenShift:true,
    snapshotsUnchanged:true,branchPaging:true,fullShiftReversal:'preview, refusal before write, injected rollback, success',
    monitoring:'healthy, injected critical',restoreReplay:true,oldJsonParity:true}));

  stage='database lint';
  const {stdout:lint}=await exec(process.execPath,[cli,'db','lint','--local','--level','warning','--workdir',workdir],
    {cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});
  console.log(JSON.stringify({stage,passed:true,result:assertPackageDDbLint(lint)}));
  console.log(JSON.stringify({ok:true,mode:'OWNER_WITHDRAWALS_RUNTIME',output,productionAccess:0}));
}catch(error){console.error(JSON.stringify({ok:false,stage,message:error.message,output,productionAccess:0}));process.exitCode=1;}
finally{
  try{if(restoreClusterStarted)await exec('docker',['exec','--user','postgres',container,'pg_ctl','-D',restoreData,'-m','fast','-w','stop'],{windowsHide:true,timeout:120000});}
  finally{if(workdir&&process.env.NAWASRAH_KEEP_STACK!=='true')await exec(process.execPath,[cli,'stop','--no-backup','--workdir',workdir],{cwd:root,windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
}
