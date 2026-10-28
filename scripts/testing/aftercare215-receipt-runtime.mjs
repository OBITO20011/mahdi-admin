import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyExchangeReceipt215(c,pass) {
 const {q,rpc,sql,json,fail,fingerprint}=c;
 const order=await json("SELECT jsonb_build_object('new',r.new_order_id,'original',x.order_id,'operation',x.operation_id) FROM aftercare215_exchanges x JOIN aftercare215_exchange_results r ON r.operation_id=x.operation_id ORDER BY x.created_at LIMIT 1;");
 const call=id=>`get_order_exchange_details_v1(${q(id)})`;
 const before=await fingerprint(),newer=await rpc(call(order.new),undefined,undefined,undefined,true),original=await rpc(call(order.original),undefined,undefined,undefined,true);
 assert.equal(newer.contractVersion,215);assert.equal(newer.funding.newOrderId,order.new);assert.equal(newer.funding.originalOrderId,order.original);
 assert.ok(original.exchanges.some(x=>x.operationId===order.operation));assert.equal(original.funding,null);
 assert.equal(typeof newer.funding.internalCreditInMinorUnits,'string');assert.equal('referenceNumber' in newer.funding,false);
 assert.doesNotMatch(JSON.stringify(newer),/wac|cost|Cogs|profit|referenceNumber/);assert.deepEqual(await fingerprint(),before);
 pass('internal receipt funding binds original/new invoice and exact monetary text, READONLY; no costs/profit/payment reference');
 for(const role of ['owner','admin','manager','accountant','cashier','sales','orders','delivery_driver','warehouse_keeper','viewer','none']) {
  let uid=c.owner;
  if(role!=='owner'){uid=randomUUID();await sql(`INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)VALUES(${q(uid)},'authenticated','authenticated',${q('funding-'+uid+'@example.test')},'{}','{}');INSERT INTO profiles(id,full_name,is_active)VALUES(${q(uid)},${q(role)},true);`);
   if(role!=='none')await sql(`INSERT INTO roles(code,name_ar)VALUES(${q(role)},${q(role)})ON CONFLICT(code)DO NOTHING;INSERT INTO user_roles(user_id,role_id)SELECT ${q(uid)},id FROM roles WHERE code=${q(role)};`);}
  if(['warehouse_keeper','viewer','none'].includes(role))await fail(call(order.new),/صلاحية|ROLE_DENIED/,uid);
  else assert.equal((await rpc(call(order.new),uid,undefined,undefined,true)).funding.newOrderId,order.new);
 }
 await fail(call(order.new),/المصادقة الثنائية/,c.owner,'authenticated','aal1');
 for(const role of ['anon','service_role'])await fail(call(order.new),/permission denied/,null,role);
 pass('funding reader uses exact204 history role set with active/MFA guard before reads; unrelated roles,AAL1,anon and service role denied');
 const missing=await rpc(call(randomUUID()),undefined,undefined,undefined,true);assert.equal(missing.funding,null);assert.deepEqual(missing.exchanges,[]);
 pass('ordinary/missing exchange identity has no fabricated credit or payment, and no token creation/write is needed for internal reprinting');
}
