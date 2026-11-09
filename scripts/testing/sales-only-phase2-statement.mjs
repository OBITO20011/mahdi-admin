import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256} from './sales-only-phase1-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
// A parallel read model, NOT a ninth bridge or a second balance ledger.
// Reuses every192 timeline/cheque/opening/page and canonical-total assertion.
export const statementHunks=[
 ['BEGIN\n  PERFORM public.assert_erp_role(', 'BEGIN\n  PERFORM sales_lite1.owner();\n  PERFORM public.assert_erp_role('],
 ['      COALESCE(h.at, c.at, CASE','      COALESCE(h.at, c.at, (SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id), CASE'],
 ["    SELECT 'sale_reversal:' || r.id::TEXT, 'sale_reversal', 'عكس دين بيع',",
  "    SELECT 'lite_return:'||r.id::TEXT, 'return_debt_reduction', 'تخفيض دين بمرتجع',\n      r.order_id, o.order_number, r.created_at, 0, r.debt_reduction\n    FROM sales_lite1.returns r JOIN scoped o ON o.id=r.order_id\n    WHERE r.debt_reduction>0 AND sales_lite1.is_order(r.order_id)\n    UNION ALL\n    SELECT 'sale_reversal:' || r.id::TEXT, 'sale_reversal', 'عكس دين بيع',"],
];
export function liteStatementSource(row){
 assert.equal(row.signature,'get_customer_statement(uuid,integer,integer)');
 assert.equal(sha256(row.source),pins.functions[row.signature].sourceSha256,'STATEMENT_ORIGINAL_SOURCE_DRIFT');
 let source=row.source;
 for(const [from,to] of statementHunks){assert.equal(source.split(from).length,2,'EXACT_STATEMENT_HUNK');source=source.replace(from,()=>to);}
 return source;
}
export function statementSql(rows){
 const row=rows.find(r=>r.signature==='get_customer_statement(uuid,integer,integer)');assert.ok(row);
 return `CREATE FUNCTION public.lite1_customer_statement2(p_customer_id UUID,p_page INTEGER DEFAULT 1,p_page_size INTEGER DEFAULT 25) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $lite_statement$${liteStatementSource(row)}$lite_statement$;\nREVOKE ALL ON FUNCTION public.lite1_customer_statement2(UUID,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION public.lite1_customer_statement2(UUID,INTEGER,INTEGER) TO authenticated;`;
}
