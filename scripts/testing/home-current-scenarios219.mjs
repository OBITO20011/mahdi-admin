// Additional current-contract fixtures AFTER performance measurement. Real
// writers, disposable transactions; all business rows roll back. PostgreSQL
// sequences may allocate normally and are not represented as transactional.
import assert from 'node:assert/strict';
import {returnPayload215} from './aftercare215-return-cases.mjs';
import {sharedHome219Definition} from './home-shared-scopes219.mjs';

export async function currentScenarioParity219({clock,owner,base,core,currentBase}){
 const q=s=>"'"+s.replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
 const id=(k,n)=>`929${String(k).padStart(5,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const branch=id(10,2),warehouse=id(11,2),customer=id(13,1),product=id(15,1),family=id(14,1);
 const claims=q(JSON.stringify({sub:owner,role:'authenticated',aal:'aal2'}));
 const rows=[];
 const scenarios=[{method:'cash',returned:false},{method:'cliq',returned:false},{method:'cash',returned:true},{method:'cliq',returned:true},{method:'cliq',formed:true,returned:false}];
 for(const s of scenarios){
  const name=[s.formed?'formed':'base',s.method,s.returned?'returned':'sale'].join('-');
  const line={commercial_line_kind:'base_unit',product_id:product,base_quantity:2,price_authority:'server_catalog',line_discount_in_minor_units:0};
  const returning=returnPayload215({sale:{orderId:'__ORDER__'},item:'__ITEM__',pid:product},{quantity:2,good:2,method:s.method,reference:s.method==='cliq'?'LOCAL219-REFUND':null});
  let prepare=s.formed?`saved:=public.save_product_parcel_configuration_v1(${q(family)},'configurable_mix',true,5,ARRAY[${q(product)},${q(id(15,2))}]::UUID[]);
   PERFORM public.set_configurable_parcel_feature_state_v1('ENABLED');
   lines:=jsonb_build_array(jsonb_build_object('commercial_line_kind','configurable_parcel','family_product_id',${q(family)},'parcel_configuration_id',saved->'configuration'->>'id','configuration_revision',(saved->'configuration'->>'configuration_revision')::INTEGER,'price_authority','server_catalog','line_discount_in_minor_units',0,'parcel_instances',${j([{components:[{product_id:product,base_quantity:2},{product_id:id(15,2),base_quantity:3}]}])}));`:`lines:=${j([line])};`;
  prepare+=`sale:=public.create_pos_sale_with_initial_payment_v1(${q(warehouse)},${q(branch)},${q(customer)},'اختبار قراءة219',lines,${s.formed?0:100},${s.formed?2000:500},${q(s.method)},'LOCAL219',${q('home219-parity-'+name)});
   IF (sale->>'success')::BOOLEAN IS DISTINCT FROM true OR (sale->>'totalInMinorUnits')::BIGINT IS DISTINCT FROM ${s.formed?5000:1900} OR (sale->>'amountPaidInMinorUnits')::BIGINT IS DISTINCT FROM ${s.formed?2000:500} OR (sale->>'remainingInMinorUnits')::BIGINT IS DISTINCT FROM ${s.formed?3000:1400} THEN RAISE EXCEPTION 'HOME219_REAL_PARTIAL_FIXTURE_INVALID';END IF;`;
  if(s.returned)prepare+=`
   SELECT id INTO STRICT item FROM public.order_items WHERE order_id=(sale->>'orderId')::UUID;
   payload:=${j(returning)};
   payload:=jsonb_set(payload,'{orderId}',sale->'orderId');
   payload:=jsonb_set(payload,'{items,0,order_item_id}',to_jsonb(item::TEXT));
   payload:=jsonb_set(payload,'{physicalSources,0,root_source_id}',to_jsonb(item::TEXT));
   payload:=jsonb_set(payload,'{physicalSources,0,source_id}',to_jsonb(item::TEXT));
   preview:=public.preview_admin_sales_return_v2(payload);
   IF (preview->>'canConfirm')::BOOLEAN IS DISTINCT FROM true OR (preview->>'debtReductionInMinorUnits')::BIGINT IS DISTINCT FROM 1400 OR (preview->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'HOME219_REAL_RETURN_FIXTURE_INVALID';END IF;
   result:=public.settle_admin_sales_return_v2(payload,${q('home219-parity-return-'+name)},preview->>'previewFingerprint');
   IF (result->>'debtReductionInMinorUnits')::BIGINT IS DISTINCT FROM 1400 OR (result->>'moneyRefundInMinorUnits')::BIGINT IS DISTINCT FROM 500 THEN RAISE EXCEPTION 'HOME219_REAL_RETURN_SETTLEMENT_INVALID';END IF;`;
  const setup=`DO $scenario219$ DECLARE sale JSONB;saved JSONB;lines JSONB;item UUID;payload JSONB;preview JSONB;result JSONB;BEGIN
   PERFORM public.open_cash_shift(${q(branch)},10000);${prepare}END $scenario219$;`;
  const script='BEGIN;'+base+core+`DO $$BEGIN PERFORM set_config('request.jwt.claims',${claims},true);END$$;SET LOCAL ROLE authenticated;`+setup+
   'SELECT public.get_home_dashboard();RESET ROLE;'+currentBase+sharedHome219Definition(core)+'SET LOCAL ROLE authenticated;SELECT public.get_home_dashboard();ROLLBACK;';
  const pair=(await clock.sql(script)).split(/\r?\n/u).map(x=>JSON.parse(x));
  assert.equal(pair.length,2);assert.equal(pair[0].financialFactsStatus,'available');assert.deepEqual(pair[1],pair[0],'HOME219_CURRENT_CONTRACT_JSON_PARITY:'+name);
  rows.push({name,realPublicWriters:true,discount:s.formed?0:100,total:s.formed?5000:1900,initialPayment:s.formed?2000:500,remaining:s.formed?3000:1400,refund:s.returned?{debtReduction:1400,moneyRefund:500}:null,completeJsonExactlyEqual:true,allBusinessRowsRolledBack:true});
 }
 return rows;
}
