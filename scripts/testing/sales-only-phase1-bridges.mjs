import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
export const sha256=text=>createHash('sha256').update(text).digest('hex');
export function replaceDefinitionSource(definition,source,body){
 assert.equal(definition.split(source).length,2,'EXACT_FUNCTION_BODY_OCCURRENCE');
 // SQL regex anchors can contain $', $$ or $&. A callback is mandatory:
 // JavaScript replacement-string expansion must never rewrite a SQL body.
 return definition.replace(source,()=>body);
}
// Exact reviewed hunks; no writer body, historic migration or ACL replacement.
export const bridges=[
 {name:'populate_order_item_cost_snapshot',hunks:[{from:"  IF v_operation_type = 'phase3_customer_reservation_v1' THEN",to:"  IF v_operation_type = 'phase3_customer_reservation_v1' OR sales_lite1.is_order(NEW.order_id) THEN"}]},
 {name:'phase42_order_financial_position_internal',hunks:[
  {from:'0)::BIGINT AS prior_debt,',to:'0)::BIGINT + COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=customer_order.id),0)::BIGINT AS prior_debt,'},
  {from:'0)::BIGINT AS prior_refunds',to:'0)::BIGINT + COALESCE((SELECT sum(r.money_refund) FROM sales_lite1.returns r WHERE r.order_id=customer_order.id),0)::BIGINT AS prior_refunds'}]},
 {name:'get_cash_shift_summary',hunks:[{from:" IF status IS DISTINCT FROM 'open' THEN RETURN result; END IF;",to:" IF status IS DISTINCT FROM 'open' THEN RETURN result; END IF;\n result:=sales_lite1.adjust_shift(result,p_shift_id);"}]},
 {name:'_get_cash_shift_closing_report_before_snapshot',hunks:[{from:'\nBEGIN\n  v_report :=',to:'\nBEGIN\n  IF EXISTS(SELECT 1 FROM sales_lite1.shifts WHERE shift_id=p_shift_id) THEN\n    PERFORM sales_lite1.owner();\n    RETURN sales_lite1.closing_report(p_shift_id);\n  END IF;\n  v_report :='}]},
 {name:'phase6_financial_facts_before208_internal',hunks:[{from:'- COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding',to:'- COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding'}]},
 {name:'run_advanced_monitoring_checks',hunks:[
  {from:"      AND o.reservation_released_at IS NULL\n      AND NOT EXISTS (",to:"      AND o.reservation_released_at IS NULL\n      AND NOT sales_lite1.is_order(o.id)\n      AND NOT EXISTS ("},
  {from:"    WHERE o.status IN ('completed','returned')",to:"    WHERE o.status IN ('completed','returned') AND NOT sales_lite1.is_order(o.id)",count:2},
  {from:"  WHERE CASE\n    WHEN operation.operation_type = 'phase3_customer_reservation_v1'",to:"  WHERE CASE\n    WHEN sales_lite1.is_order(customer_order.id) THEN item.unit_cost_in_minor_units<>0 OR item.cogs_in_minor_units<>0 OR item.profit_in_minor_units<>0 OR item.cost_finalized_at IS NOT NULL OR item.exact_cogs_snapshot_in_minor_units IS NOT NULL OR item.unit_cost_snapshot_in_minor_units_exact IS NOT NULL\n    WHEN operation.operation_type = 'phase3_customer_reservation_v1'"},
  {from:"  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,",to:"  v_count:=sales_lite1.integrity_count();\n  v_total_integrity:=v_total_integrity+v_count;\n  PERFORM public._set_advanced_monitoring_check('integrity:lite1:evidence','orders','database',CASE WHEN v_count=0 THEN 'healthy' ELSE 'critical' END,'critical',v_count,'سلامة المبيعات بلا تتبع مخزون',jsonb_build_object('mismatchCount',v_count),p_observed_at);\n  SELECT jsonb_build_object('ok',true,'checkedAt',p_observed_at,"}]},
 {name:'sync_stock_alert',hunks:[{from:'\nBEGIN\n  SELECT min_stock_level, is_active',to:'\nBEGIN\n  IF sales_lite1.enabled() THEN RETURN;END IF;\n  SELECT min_stock_level, is_active'}]},
 {name:'enqueue_stock_automation_event',hunks:[{from:"\nBEGIN\n  IF NEW.status = 'active' THEN",to:"\nBEGIN\n  IF sales_lite1.enabled() THEN RETURN NEW;END IF;\n  IF NEW.status = 'active' THEN"}]},
];
export function bridgedSource(row) {
 const b=bridges.find(b=>b.name===row.name);assert.ok(b,'NOT_AN_APPROVED_BRIDGE');
 assert.equal(sha256(row.source),pins.functions[row.signature]?.sourceSha256,'FROZEN_BRIDGE_BASE_CHANGED');
 let text=row.source;
 for(const h of b.hunks){assert.equal(text.split(h.from).length-1,h.count??1,`EXACT_HUNK_COUNT:${b.name}`);text=text.split(h.from).join(h.to);}
 return text;
}
export function bridgeSql(rows) {
 return bridges.map(b=>{const found=rows.filter(r=>r.name===b.name);assert.equal(found.length,1);const row=found[0];return replaceDefinitionSource(row.definition,row.source,bridgedSource(row)).trimEnd()+';';}).join('\n');
}
export function assertFrozenFunctions(before,after) {
 const actual=new Map(after.map(r=>[r.signature,r]));
 assert.equal(before.length,Object.keys(pins.functions).length);
 for(const row of before){const pin=pins.functions[row.signature];assert.ok(pin);assert.equal(sha256(row.source),pin.sourceSha256,`FROZEN_BASE_CHANGED:${row.signature}`);assert.equal(sha256(row.definition),pin.definitionSha256,`FROZEN_DECLARATION_BASE_CHANGED:${row.signature}`);for(const field of ['owner','config','acl'])assert.deepEqual(row[field],pin[field]);const a=actual.get(row.signature);assert.ok(a,`MISSING_FROZEN_FUNCTION:${row.signature}`);const expected=bridges.some(b=>b.name===row.name)?bridgedSource(row):row.source;assert.equal(a.source,expected,`FROZEN_SOURCE_CHANGED:${row.signature}`);assert.equal(a.definition,replaceDefinitionSource(row.definition,row.source,expected),`FROZEN_DEFINITION_CHANGED:${row.signature}`);for(const field of ['owner','config','acl'])assert.deepEqual(a[field],row[field],`FROZEN_METADATA_CHANGED:${row.signature}:${field}`);}
 for(const row of after)assert.ok(pins.functions[row.signature]||row.name.startsWith('lite1_'),`UNAPPROVED_FUNCTION_ADDED:${row.signature}`);
}
