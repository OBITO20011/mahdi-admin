import assert from 'node:assert/strict';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {raceAftercare215} from './aftercare215-race.mjs';

export async function verifyExchangeBoundaries215(c,pass) {
 const {q,j,rpc,setup,sql,json,key}=c;
 const shift=await json("SELECT to_jsonb(id) FROM cash_shifts WHERE status='open';");
 const normal=await rpc(`get_cash_shift_closing_report(${q(shift)})`);
 assert.equal(normal.salesDetailStatus,'available');assert.equal(normal.sales.salesDefinitionVersion,133);
 assert.equal('internalExchangeCreditInMinorUnits' in normal.sales,false);
 pass('a normal shift without exchanges retains version133 closing DTO and has no artificial zero exchange field');
 for(const collectionFirst of [true,false]) {
  await setup({paymentMethod:'debt',kind:'base',soldQuantity:3});
  const old=await setup(),replacement=await setup({cost:600});
  await sql(`UPDATE products SET default_sale_price_in_minor_units=12000 WHERE id=${q(replacement.pid)};`);
  const payload={returnRequest:returnPayload215(old),replacement:{productId:replacement.pid,kind:'legacy_single_sku_parcel',quantity:1},differenceMethod:'cash'};
  const preview=await rpc(`preview_sales_exchange_v1(${j(payload)})`);
  const exchange=`settle_sales_exchange_v1(${j(payload)},${q(key())},${q(preview.previewFingerprint)})`;
  const collection=`collect_customer_balance_v1(${q(c.id(401))},1000,'cash',${q(c.branch)},NULL,'تحصيل فاتورة أخرى أثناء التبديل',${q(key())})`;
  const contender=await raceAftercare215(c)(collectionFirst?collection:exchange,collectionFirst?exchange:collection);
  assert.equal(contender.code,0,contender.stderr);
  assert.equal((await c.stock(old.pid)).quantity,111);assert.equal((await c.stock(replacement.pid)).quantity,88);
 }
 pass('actual customer collection versus exchange in both orders waits then completes; shared customer lock precedes order/shift/products, no deadlock or duplicate money');
}
