import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {SnapshotSession} from '../backup/snapshot-session.mjs';

/** Two actual PostgreSQL sessions: one held update wins, stale competitor refuses. */
export async function verifyIndependentParcel222Concurrency({sql,json,rpc,id,q,j,executor},report){
 const created=await rpc(`create_product_with_opening_stock_v6(p_sku:='PRICE222-RACE-'||gen_random_uuid()::TEXT,p_name_ar:='اختبار تزامن السعرين',p_category_id:=${q(id(11))},p_unit_id:=(SELECT id FROM public.units WHERE code='PKT'),p_purchase_unit_id:=(SELECT id FROM public.units WHERE code='PKT'),p_units_per_purchase_unit:=1,p_sale_unit_id:=(SELECT id FROM public.units WHERE code='CTN'),p_units_per_sale_unit:=20,p_default_sale_price_in_minor_units:=17000,p_sale_price_in_minor_units:=900,p_warehouse_id:=${q(id(201))})`);
 const pid=created.product_id;
 assert.ok(pid);
 const before=await json(`SELECT jsonb_build_object('version',updated_at,'single',sale_price_in_minor_units,'parcel',default_sale_price_in_minor_units) FROM public.products WHERE id=${q(pid)};`);
 const call=(parcel,version)=>`DO $edit$ DECLARE p public.products;BEGIN SELECT * INTO STRICT p FROM public.products WHERE id=${q(pid)};
 PERFORM public.update_product_master_v6(p.id,${q(version)}::TIMESTAMPTZ,p.sku,p.barcode,p.name_ar,p.description,p.category_id,p.brand_id,p.unit_id,p.purchase_unit_id,p.units_per_purchase_unit,p.default_purchase_price_in_minor_units,p.sale_unit_id,20,${parcel},p.cost_price_in_minor_units,p.min_stock_level,p.max_stock_level,p.is_active,NULL,900,false);END $edit$;`;
 const transaction=body=>`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);SET LOCAL ROLE authenticated;SET LOCAL statement_timeout='8s';${body}COMMIT;`;
 // Hold an actual open transaction until the competing writer is observed
 // waiting. No sleep window and no retry of either business mutation.
 const holder=new SnapshotSession(executor.command,executor.args,executor.env??process.env);
 try{
  await holder.query(transaction(`SET LOCAL application_name='price222-held-update';${call(16600,before.version)}`).replace(/COMMIT;$/u,''));
  const loser=sql(transaction(`SET LOCAL application_name='price222-losing-update';${call(17000,before.version)}`));
  let loserError;loser.catch(error=>{loserError=error;});
  const deadline=Date.now()+10_000;let waiting=false;
  while(Date.now()<deadline){
   if(loserError)throw loserError;
   waiting=await json("SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='price222-losing-update' AND wait_event_type='Lock'));");
   if(waiting)break;
   await delay(25);
  }
  assert.equal(waiting,true,'PRICES222_COMPETING_WRITER_NOT_OBSERVED');
  await holder.query('COMMIT;');
  await assert.rejects(loser,/PRODUCT_EDIT_CONFLICT:/);
 }finally{await holder.close();}
 const after=await json(`SELECT jsonb_build_object('version',updated_at,'single',sale_price_in_minor_units,'parcel',default_sale_price_in_minor_units) FROM public.products WHERE id=${q(pid)};`);
 assert.notEqual(after.version,before.version);
 assert.deepEqual({single:after.single,parcel:after.parcel},{single:900,parcel:16600});
 const audits=await json(`SELECT count(*) FROM public.audit_logs WHERE entity_id=${q(pid)} AND action='SET_PRODUCT_INDEPENDENT_PRICES';`);
 assert.equal(audits,2,'PRICES222_STALE_WRITE_OR_AUDIT');
 report.cases.push({name:'two real sessions serialize the existing family lock;stale refused;winning prices/audit exact',passed:true,single:900,parcel:16600,audits});
}
