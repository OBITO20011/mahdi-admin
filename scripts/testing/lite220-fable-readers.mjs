// Owner11Nov A1/M1:parallel readers only;original192 bodies/ACL remain frozen.
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{sha256,replaceDefinitionSource}from'./sales-only-phase1-bridges.mjs';
const pins=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
export const receivableReaderSpecs=Object.freeze([
 {signature:'get_customer_debt_aging(uuid)',name:'get_customer_debt_aging',parallel:'lite1_debt_aging2',types:'UUID'},
 {signature:'get_crm_customer_page(integer,integer,text,text,text)',name:'get_crm_customer_page',parallel:'lite1_crm_page2',types:'INTEGER,INTEGER,TEXT,TEXT,TEXT'}
]);
export const receivableHunks=Object.freeze([
 ['- COALESCE(d.amount, 0), 0)::BIGINT END AS outstanding','- COALESCE(d.amount, 0) - COALESCE((SELECT sum(r.debt_reduction) FROM sales_lite1.returns r WHERE r.order_id=o.id),0), 0)::BIGINT END AS outstanding'],
 ['COALESCE(h.at, c.at, CASE','COALESCE(h.at, c.at, (SELECT completed_at FROM sales_lite1.completions WHERE order_id=o.id), CASE']
]);
export function liteReceivableReaderSource(row){const spec=receivableReaderSpecs.find(s=>s.signature===row.signature);assert.ok(spec,'FABLE_READER_EXACT_SIGNATURE');assert.equal(sha256(row.source),pins.functions[row.signature]?.sourceSha256,'FABLE_READER_ORIGINAL_BODY_CHANGED');assert.equal(sha256(row.definition),pins.functions[row.signature]?.definitionSha256,'FABLE_READER_ORIGINAL_DECLARATION_CHANGED');let body=row.source;
 for(const[from,to]of receivableHunks){assert.equal(body.split(from).length,2,'FABLE_READER_EXACT_HUNK');body=body.replace(from,()=>to);}return body;
}
export function liteReceivableReadersSql(rows){return receivableReaderSpecs.map(s=>{const row=rows.find(r=>r.signature===s.signature);assert.ok(row);let declaration=replaceDefinitionSource(row.definition,row.source,liteReceivableReaderSource(row));const from='CREATE OR REPLACE FUNCTION public.'+s.name+'(';assert.equal(declaration.split(from).length,2);declaration=declaration.replace(from,'CREATE FUNCTION public.'+s.parallel+'(');return declaration.trimEnd()+`;\nREVOKE ALL ON FUNCTION public.${s.parallel}(${s.types}) FROM PUBLIC,anon,authenticated,service_role;\nGRANT EXECUTE ON FUNCTION public.${s.parallel}(${s.types}) TO authenticated;`;}).join('\n');}
