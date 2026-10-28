import assert from 'node:assert/strict';
import {returnPayload215} from './aftercare215-return-cases.mjs';

export async function verifyExchangePreview215(c, pass) {
  const {q, j, sql, rpc, setup, fail, fingerprint} = c;
  const preview = payload => rpc(`preview_sales_exchange_v1(${j(payload)})`, undefined, undefined, undefined, true);
  const old = await setup();
  for (const [price, cost, difference, credit, profit] of [[12000,600,3000,9000,1300],[7500,400,-1500,7500,-800],[9000,500,0,9000,-500]]) {
    const replacement = await setup({cost});
    await sql(`UPDATE public.products SET default_sale_price_in_minor_units=${price} WHERE id=${q(replacement.pid)};`);
    const payload = {returnRequest: returnPayload215(old), replacement: {productId:replacement.pid,kind:'legacy_single_sku_parcel',quantity:1},differenceMethod:'cash'};
    const before = await fingerprint(), p = await preview(payload);
    assert.deepEqual(await fingerprint(), before);
    assert.equal(p.canConfirm,true);assert.equal(p.newTotalInMinorUnits,String(price));assert.equal(p.internalCreditInMinorUnits,String(credit));
    assert.equal(p.differenceInMinorUnits,String(difference));assert.equal(p.moneyReceivedInMinorUnits,String(Math.max(difference,0)));
    assert.equal(p.moneyRefundInMinorUnits,String(Math.max(-difference,0)));assert.equal(Number(p.profitDeltaExactInMinorUnits),profit);
    assert.equal(p.differenceMethod,difference===0?null:'cash');
    const held=await preview({...payload,returnRequest:returnPayload215(old,{supplierId:c.supplier})});
    assert.equal(Number(held.profitDeltaExactInMinorUnits),profit+500);
    pass(`read-only exchange preview9000 to${price}: internalcredit${credit},actual difference${difference},profit${profit}; supplier holds bad500 only`);
  }
  const replacement=await setup(), debt=await setup({paymentMethod:'debt'});
  const payload={returnRequest:returnPayload215(old),replacement:{productId:replacement.pid,kind:'base_unit',quantity:1},differenceMethod:'cliq'};
  const incomplete=await preview(payload);assert.equal(incomplete.canConfirm,false);assert.ok(incomplete.issues.some(x=>x.field==='referenceNumber'));
  const complete=await preview({...payload,referenceNumber:'LOCAL-EXCHANGE-CLIQ'});assert.equal(complete.canConfirm,true);
  await fail(`preview_sales_exchange_v1(${j({...payload,returnRequest:returnPayload215(debt)})})`,/FULLY_PAID_REQUIRED/);
  await fail(`preview_sales_exchange_v1(${j({...payload,replacement:{...payload.replacement,productId:old.pid}})})`,/OTHER_PRODUCT_REQUIRED/);
  await fail(`preview_sales_exchange_v1(${j({...payload,credit:9000})})`,/REQUEST_INVALID/);
  pass('exchange preview named missing CliQ reference; unpaid origin/sameSKU/forged money refused with all tables/sequences unchanged');
  const only=await setup({only:true});
  await fail(`preview_sales_exchange_v1(${j({...payload,replacement:{...payload.replacement,productId:only.pid}})})`,/UNIT_SALE_FORBIDDEN/);
  await fail(`preview_sales_exchange_v1(${j({...payload,returnRequest:returnPayload215(old,{quantity:1,good:1})})})`,/WHOLE|CARTON|PARCEL/);
  const admin=await rpc(`preview_sales_exchange_v1(${j(payload)})`,c.id(215100));
  for(const field of ['newCogsExact','goodRestockValueExact','supplierHeldInMinorUnits','profitDeltaExactInMinorUnits']) assert.equal(field in admin,false);
  await fail(`preview_sales_exchange_v1(${j(payload)})`,/صلاحية/,c.id(215101));
  await fail(`preview_sales_exchange_v1(${j(payload)})`,/المصادقة الثنائية/,c.owner,'authenticated','aal1');
  await fail(`tb215_prepare_exchange_internal(${j(payload)})`,/permission denied/);
  pass('exchange preview parcel-only/whole-original-parcel guards and role/MFA/private DTO boundaries hold, with zero writes');
}
