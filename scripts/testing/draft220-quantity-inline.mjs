// Literal119 quantity expressions. No alternative formula or financial policy.
import assert from 'node:assert/strict';
import {extractSqlFunction} from './build-home219-read-sql.mjs';
export function quantityExpression220(source,name){
 assert.ok(['phase35_report_package_count_internal','phase35_report_base_unit_count_internal'].includes(name));
 const sql=extractSqlFunction(source,name),body=sql.split('AS $$')[1].split('$$;')[0].trim();assert.ok(body.startsWith('SELECT CASE'));
 return '('+body.replace(/^SELECT /u,'').replace(/;$/u,'').replaceAll('p_order_item_id','oi.id').replaceAll('p_commercial_line_kind','oi.commercial_line_kind').replaceAll('p_legacy_quantity','oi.quantity').replaceAll('p_sale_package_quantity','oi.sale_package_quantity').replaceAll('p_units_per_sale_package','oi.units_per_sale_package')+')';
}
export function inlineLegacyQuantities220(original,source119){
 const pkg='public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)',base='public.phase35_report_base_unit_count_internal(oi.id, oi.commercial_line_kind, oi.quantity)';
 assert.equal(original.split(pkg).length,4,'EXACT_THREE_LEGACY_PACKAGE_CALLS');assert.equal(original.split(base).length,2,'EXACT_ONE_LEGACY_BASE_CALL');
 // Only item_sales. Leave both Top Products calls/text untouched, including
 // its historical revenue-tie selection behavior.
 return original.replace(pkg,quantityExpression220(source119,'phase35_report_package_count_internal')).replace(base,quantityExpression220(source119,'phase35_report_base_unit_count_internal'));
}
