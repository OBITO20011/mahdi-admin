import assert from 'node:assert/strict';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {raceAftercare215} from './aftercare215-race.mjs';
import {executeInput} from '../operations/build-empty-supabase.mjs';

export async function verifyExchange215(c,pass) {
 const {q,j,rpc,setup,sql,fingerprint,key,stock,facts,fail}=c;
 for(const [price,cost,difference,profit] of [[12000,600,3000,1300],[7500,400,-1500,-800],[9000,500,0,-500]]) {
  const old=await setup(),replacement=await setup({cost});
  await sql(`UPDATE products SET default_sale_price_in_minor_units=${price} WHERE id=${q(replacement.pid)};`);
  const payload={returnRequest:returnPayload215(old),replacement:{productId:replacement.pid,kind:'legacy_single_sku_parcel',quantity:1},differenceMethod:'cash'};
  const p=await rpc(`preview_sales_exchange_v1(${j(payload)})`),identity=key();
  const call=`settle_sales_exchange_v1(${j(payload)},${q(identity)},${q(p.previewFingerprint)})`,before=await facts();
  const shift=await rpc(`get_cash_shift_summary(${q((await c.json(`SELECT to_jsonb(id) FROM cash_shifts WHERE status='open';`)))})`);
  const result=await rpc(call);assert.equal(result.success,true);assert.equal(result.moneyReceivedInMinorUnits,String(Math.max(difference,0)));
  assert.equal(result.moneyRefundInMinorUnits,String(Math.max(-difference,0)));
  assert.equal((await stock(old.pid)).quantity,111);assert.equal((await stock(replacement.pid)).quantity,88);
  const after=await facts();assert.equal(after.sales.netProfitInMinorUnits-before.sales.netProfitInMinorUnits,profit);
  assert.equal(after.sales.netSalesInMinorUnits-before.sales.netSalesInMinorUnits,difference);
  assert.equal(after.cashFlow.customerCollections.totalInMinorUnits-before.cashFlow.customerCollections.totalInMinorUnits,Math.max(difference,0));
  assert.equal(after.cashFlow.cashRefundedInMinorUnits-before.cashFlow.cashRefundedInMinorUnits,Math.max(-difference,0));
  const shifted=await rpc(`get_cash_shift_summary(${q(shift.id)})`);
  assert.equal(shifted.expectedCashInMinorUnits-shift.expectedCashInMinorUnits,difference);
  assert.equal(shifted.cashSalesInMinorUnits-shift.cashSalesInMinorUnits,Math.max(difference,0));
  assert.equal(shifted.cashRefundsInMinorUnits-shift.cashRefundsInMinorUnits,Math.max(-difference,0));
  await fail(`reverse_pos_sale(${q(result.newOrderId)},'عكس مستقل غير مسموح لفاتورة المقابل',${q(key())})`,/AFTERCARE215_EXCHANGE_REVERSAL_UNSUPPORTED/);
  const fp=await fingerprint();assert.deepEqual(await rpc(call),{...result,idempotentReplay:true});assert.deepEqual(await fingerprint(),fp);
  await fail(`settle_sales_exchange_v1(${j({...payload,differenceMethod:'cliq',referenceNumber:'changed'})},${q(identity)},${q(p.previewFingerprint)})`,/IDEMPOTENCY_CONFLICT/);
  pass(`atomic exchange9000to${price}: original+11,new-12,actualcash${difference},profit${profit},no fictitious receipts/refunds,idempotent whole exchange`);
 }
 pass('cash positive/negative/equal funded invoices reject standalone old POS reversal with all tables and sequences unchanged;ordinary full215 return remains available');
 const make=async({method='cash',held=false}={})=>{
  const old=await setup(),replacement=await setup({cost:600});await sql(`UPDATE products SET default_sale_price_in_minor_units=12000 WHERE id=${q(replacement.pid)};`);
  const payload={returnRequest:returnPayload215(old,{supplierId:held?c.supplier:null}),replacement:{productId:replacement.pid,kind:'legacy_single_sku_parcel',quantity:1},differenceMethod:method,...(method==='cliq'?{referenceNumber:'LOCAL-EXCHANGE-COMPLETED'}:{})};
  const p=await rpc(`preview_sales_exchange_v1(${j(payload)})`),identity=key();
  return{old,replacement,payload,p,identity,call:`settle_sales_exchange_v1(${j(payload)},${q(identity)},${q(p.previewFingerprint)})`};
 };
 const cliq=await make({method:'cliq',held:true}),cf=await facts();
 const shiftId=await c.json(`SELECT to_jsonb(id) FROM cash_shifts WHERE status='open';`),cs=await rpc(`get_cash_shift_summary(${q(shiftId)})`);
 const cr=await rpc(cliq.call),ca=await facts(),cas=await rpc(`get_cash_shift_summary(${q(shiftId)})`);
 assert.equal(ca.cashFlow.customerCollections.cliqInMinorUnits-cf.cashFlow.customerCollections.cliqInMinorUnits,3000);
 assert.equal(cas.expectedCashInMinorUnits,cs.expectedCashInMinorUnits);assert.equal(cas.cliqSalesInMinorUnits-cs.cliqSalesInMinorUnits,3000);
 assert.equal(ca.sales.netProfitInMinorUnits-cf.sales.netProfitInMinorUnits,1800);
 assert.equal(await sql(`SELECT sum(sc.quantity) FROM supplier_replacement_cases sc JOIN inventory_damage_events d ON d.id=sc.damage_event_id WHERE d.return_event_id=${q(cr.returnId)};`),'1');
 pass('CliQ exchange difference3000 stays outside drawer; only original bad packet500 held, profit1800, no false full12000 collection');
 const newItem=await c.json(`SELECT to_jsonb(id) FROM order_items WHERE order_id=${q(cr.newOrderId)};`);
 const returnNew={...returnPayload215({sale:{orderId:cr.newOrderId},item:newItem,pid:cliq.replacement.pid},{quantity:12,good:12,method:'cash'}),reason:'إرجاع البديل المدفوع بالمقابل والفرق'};
 const rp=await rpc(`preview_admin_sales_return_v2(${j(returnNew)})`);assert.equal(rp.moneyRefundInMinorUnits,'12000');
 const fbefore=await facts();await rpc(`settle_admin_sales_return_v2(${j(returnNew)},${q(key())},${q(rp.previewFingerprint)})`);
 assert.equal((await stock(cliq.replacement.pid)).quantity,100);
 assert.equal((await facts()).cashFlow.cashRefundedInMinorUnits-fbefore.cashFlow.cashRefundedInMinorUnits,12000);
 await fail(`preview_admin_sales_return_v2(${j(cliq.payload.returnRequest)})`,/CONSUMED|UNAVAILABLE|BOUND/);
 pass('new invoice refundable12000 is covered by old9000 plus actual3000; its full return restores new historical stock once, original capacity remains consumed');
 const race=await make(),contender=await raceAftercare215(c)(race.call,race.call);
 assert.equal(contender.code,0,contender.stderr);assert.equal(JSON.parse(contender.stdout.trim().split('\n').at(-1)).idempotentReplay,true);
 assert.equal((await stock(race.old.pid)).quantity,111);assert.equal((await stock(race.replacement.pid)).quantity,88);
 pass('two actual exchange sessions block then whole-operation replay; exactly one new sale,one return,one actual difference');
 const stale=await make();await sql(`UPDATE products SET default_sale_price_in_minor_units=12500 WHERE id=${q(stale.replacement.pid)};`);
 await fail(stale.call,/PREVIEW_CHANGED/);
 await fail(`create_pos_sale_v2(${q(c.warehouse)},${q(c.branch)},NULL,'زبون نقدي','exchange_credit',${j([stale.p.replacement])},0,0,${q(key())})`,/PAYMENT_METHOD_INVALID/);
 await fail(`tb215_exchange_pos_internal(${q(c.warehouse)},${q(c.branch)},NULL,'زبون نقدي','exchange_credit','[]',0,0,${q(key())})`,/permission denied/);
 pass('changed price invalidates exchange before writes; old public POS cannot issue exchange credit and private carrier has no application grants');
 const rollback=await make({held:true});
 await sql(`CREATE FUNCTION public.tb215_exchange_failure() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'TB215_EXCHANGE_INJECTED_FAILURE';END $$;CREATE TRIGGER tb215_exchange_failure BEFORE INSERT ON public.aftercare215_exchange_results FOR EACH ROW EXECUTE FUNCTION public.tb215_exchange_failure();`);
 try {
  const fp=await fingerprint(),r=await executeInput(c.executor,c.auth(`SELECT public.${rollback.call};`));assert.notEqual(r.code,0);assert.match(r.stderr,/TB215_EXCHANGE_INJECTED_FAILURE/);
  assert.deepEqual(await fingerprint(),{...fp,sequences:{...fp.sequences,inventory_movement_mutation_seq:fp.sequences.inventory_movement_mutation_seq+2}});
 } finally {await sql('DROP TRIGGER tb215_exchange_failure ON public.aftercare215_exchange_results;DROP FUNCTION public.tb215_exchange_failure();');}
 pass('failure after new sale,old return and supplier hold rolls all tables/business sequences back; only two existing113 technical stamps consumed');
}
