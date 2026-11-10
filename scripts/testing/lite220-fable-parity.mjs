// Full-only real writers/expiry and every reader filter remain unchanged.
// All financial fixture work is inside one ROLLBACK;never on a hosted DB.
import assert from'node:assert/strict';import{readApplicationFingerprint}from'./backup-restore-contract.mjs';
export async function verifyFableFullParity(c,report){const{sql,json,q,j,id,executor}=c,branch=id(200),warehouse=id(201),customer=id(402),product=id(103),before=await readApplicationFingerprint(executor),lines=[{commercial_line_kind:'base_unit',product_id:product,base_quantity:10,price_authority:'server_catalog',line_discount_in_minor_units:0}],guestLines=[{commercial_line_kind:'base_unit',product_id:product,base_quantity:1,expected_unit_price_in_minor_units:1000}];
 assert.equal(await sql('SELECT sales_lite1.enabled();'),'f');
 const result=await json(`BEGIN;SELECT set_config('request.jwt.claims',${j({sub:id(1),role:'authenticated',aal:'aal2'})}::TEXT,true);
 SELECT public.create_direct_supplier_receipt_v2(p_supplier_id:=${q(id(301))},p_branch_id:=${q(branch)},p_warehouse_id:=${q(warehouse)},p_idempotency_key:=${q(id(993))},p_payment_method:='deferred',p_lines:=${j([{client_line_id:id(998),line_kind:'base_unit',commercial_quantity:1000,base_unit_name:'باكيت',gross_amount_in_minor_units:500000,line_discount_in_minor_units:0,components:[{product_id:product,base_quantity:1000}]}])});
 CREATE TEMP TABLE empty_full_shift AS SELECT(public.open_cash_shift(${q(branch)},0)->>'id')::UUID id;
 SELECT public.cancel_empty_cash_shift((SELECT id FROM empty_full_shift),'وردية كاملة فارغة');
 CREATE TEMP TABLE fable_full_shift AS SELECT(public.open_cash_shift(${q(branch)},100000)->>'id')::UUID id;
 CREATE TEMP TABLE fable_full_sale AS SELECT public.create_pos_sale_v2(${q(warehouse)},${q(branch)},${q(customer)},'عميل كامل','debt',${j(lines)},0,0,${q(id(991))}) value;
 CREATE TEMP TABLE fable_full_payment AS SELECT public.record_customer_order_payment_once((SELECT(value->>'orderId')::UUID FROM fable_full_sale),1000,'cash',NULL,'قبض كامل',${q(id(992))}) value;
 SELECT public.reverse_customer_order_payment((SELECT(value->>'payment_id')::UUID FROM fable_full_payment),'عكس كامل بلا مرتجعlite');
 CREATE TEMP TABLE fable_full_pairs AS SELECT jsonb_build_object('aging',public.get_customer_debt_aging(${q(customer)})=public.lite1_debt_aging2(${q(customer)}),
 'crm',(SELECT bool_and(public.get_crm_customer_page(page,10,search,status,sort)=public.lite1_crm_page2(page,10,search,status,sort))
 FROM(VALUES(1),(2))pages(page) CROSS JOIN(VALUES(NULL::TEXT),('079660'))searches(search)
 CROSS JOIN(VALUES('all'),('vip'),('active'),('inactive'),('blocked'),('has_debt'),('overdue'),('over_limit'),('wholesale'))statuses(status)
 CROSS JOIN(VALUES('latest'),('highest_spending'),('most_orders'))sorts(sort))) value;
 SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
 CREATE TEMP TABLE fable_guest_plan AS SELECT sales_lite2.plan(${j(guestLines)},'customer_v2',0,NULL,'0796600402','inside_ramtha') value;
 CREATE TEMP TABLE fable_full_guest AS SELECT public.submit_guest_customer_order_v2(${q(id(990))},repeat('c',64),repeat('d',64),'طلب كامل وهمي','0796600402','إربد','الرمثا','حي وهمي','شارع وهمي',NULL,NULL,NULL,NULL,NULL,NULL,${j(guestLines)},NULL,'cash_on_delivery','inside_ramtha',
 (SELECT(value->>'subtotalInMinorUnits')::BIGINT FROM fable_guest_plan),(SELECT(value->>'discountInMinorUnits')::BIGINT FROM fable_guest_plan),(SELECT(value->>'deliveryFeeInMinorUnits')::BIGINT FROM fable_guest_plan),(SELECT(value->>'totalInMinorUnits')::BIGINT FROM fable_guest_plan)) value;
 UPDATE public.orders SET reservation_expires_at=now()-interval '6 hours' WHERE id=(SELECT(value->>'order_id')::UUID FROM fable_full_guest);
 CREATE TEMP TABLE fable_full_expiry AS SELECT public.expire_stale_new_website_orders(100) value;
 SELECT jsonb_build_object('pairs',(SELECT value FROM fable_full_pairs),'crmComparisons',108,
 'fullCost',(SELECT(value#>>'{items,0,cogsInMinorUnits}')::BIGINT FROM fable_full_sale),
 'emptyFullCancelled',(SELECT status FROM cash_shifts WHERE id=(SELECT id FROM empty_full_shift)),
 'paymentReversed',(SELECT is_reversed FROM customer_payments WHERE id=(SELECT(value->>'payment_id')::UUID FROM fable_full_payment)),
 'fullGuestExpired',(SELECT status FROM orders WHERE id=(SELECT(value->>'order_id')::UUID FROM fable_full_guest)),
 'expiry',(SELECT value FROM fable_full_expiry));ROLLBACK;`);
 assert.deepEqual(result.pairs,{aging:true,crm:true});assert.equal(result.fullCost,5000);assert.equal(result.emptyFullCancelled,'cancelled');assert.equal(result.paymentReversed,true);assert.equal(result.fullGuestExpired,'expired');assert.equal(result.expiry.success,true);assert.deepEqual((await readApplicationFingerprint(executor)).tables,before.tables,'FULL_FIXTURE_ROLLBACK_ALL_ROWS');
 report.fullParity={...result,wholeJson:true,allRowsRolledBack:true,sequenceRollbackClaimed:false};
}
