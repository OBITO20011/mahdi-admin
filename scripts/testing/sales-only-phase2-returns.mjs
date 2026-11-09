import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from './sales-only-phase1-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
// Preserve the entire existing financial inspection/entitlement algorithm.
// Parallel evidence sources substitute lite provenance and omit stock costs;
// no existing public function is replaced or granted additional privileges.
export const returnSourceHunks=[
 [" ctx:=public.tb215_read_sale_internal(order_id);"," ctx:=sales_lite2.return_context(order_id);\n IF jsonb_array_length(p_request->'supplierAssignments')<>0 THEN RAISE EXCEPTION 'LITE2_SUPPLIER_ACCOUNTING_DISABLED';END IF;"],
 ["   SELECT COALESCE(sum(i.returned_quantity),0)::INTEGER,COALESCE(sum(i.refund_amount_snapshot_in_minor_units+i.applied_customer_damage_deduction_in_minor_units),0)::BIGINT\n    INTO prior,prior_refund FROM public.sales_return_items i JOIN public.sales_return_events e ON e.id=i.sales_return_event_id\n    WHERE i.order_item_id=oi.id AND i.return_scope='base_unit' AND e.settlement_status='settled';",
  "   SELECT COALESCE(sum(r.quantity),0)::INTEGER,COALESCE(sum(r.entitlement+COALESCE(d.applied_damage,0)),0)::BIGINT\n    INTO prior,prior_refund FROM sales_lite1.returns r LEFT JOIN sales_lite2.return_details d ON d.return_id=r.id WHERE r.item_id=oi.id;"],
 ["   IF COALESCE((item->>'customer_damage_quantity')::INTEGER,0)>0 AND(oi.commercial_line_kind<>'legacy_single_sku_parcel'", "   oi.effective_standalone_unit_sale_price_snapshot_in_minor_units:=sales_lite2.sale_packet_price(order_id,oi.id,NULL);\n   IF COALESCE((item->>'customer_damage_quantity')::INTEGER,0)>0 AND(oi.commercial_line_kind<>'legacy_single_sku_parcel'"],
 ["   IF EXISTS(SELECT 1 FROM public.sales_return_items i JOIN public.sales_return_events e ON e.id=i.sales_return_event_id\n    WHERE i.parcel_instance_id=instance.id AND e.settlement_status='settled') THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;",
  "   IF EXISTS(SELECT 1 FROM sales_lite2.return_details d WHERE d.parcel_instance_id=instance.id) THEN RAISE EXCEPTION 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'; END IF;"],
 ["    IF NOT FOUND OR pc.base_quantity<>","    IF NOT FOUND THEN RAISE EXCEPTION 'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID';END IF;\n    pc.effective_standalone_unit_sale_price_snapshot_in_minor_units:=sales_lite2.sale_packet_price(order_id,oi.id,pc.id);\n    IF pc.base_quantity<>"],
 ["  cost:=public.tb215_return_source_cost_internal(order_id,source);","  PERFORM public.phase43_assert_return_physical_source_internal(order_id,source->>'root_source_kind',(source->>'root_source_id')::UUID,source->>'source_kind',(source->>'source_id')::UUID,(source->>'product_id')::UUID);\n  cost:=0; -- untracked, never financial cost truth"],
];
export function liteReturnSource(row){
 assert.equal(row.signature,'tb215_prepare_return_internal(jsonb)');
 assert.equal(sha256(row.source),pins.functions[row.signature].sourceSha256,'RETURN_ORIGINAL_SOURCE_DRIFT');
 let source=row.source;
 for(const [from,to] of returnSourceHunks){assert.equal(source.split(from).length,2,'EXACT_RETURN_HUNK');source=source.replace(from,()=>to);}
 return source;
}
export function returnSql(rows){
 const row=rows.find(r=>r.signature==='tb215_prepare_return_internal(jsonb)');assert.ok(row);
 const sql=readFileSync(new URL('../../docs/design/sales-only-phase2/returns.sql',import.meta.url),'utf8');
 assert.equal(sql.split('-- INSERT_EXACT_RETURN_PREPARE_HERE').length,2);
 return sql.replace('-- INSERT_EXACT_RETURN_PREPARE_HERE',()=>`CREATE FUNCTION sales_lite2.prepare_return(p_request JSONB) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $prepare_lite$${liteReturnSource(row)}$prepare_lite$;\nREVOKE ALL ON FUNCTION sales_lite2.prepare_return(JSONB) FROM PUBLIC,anon,authenticated,service_role;`);
}
