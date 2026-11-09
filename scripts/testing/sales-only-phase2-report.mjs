import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sha256,bridgedSource} from './sales-only-phase1-bridges.mjs';
const frozen=JSON.parse(readFileSync(new URL('../../docs/design/sales-only-phase1/frozen-functions.json',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../../supabase/migrations/219_home_financial_facts_narrow_projection.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const signature='phase6_financial_facts_before208_internal(uuid,timestamp with time zone,timestamp with time zone,text,boolean)';
const start=migration.indexOf('AS $$\n')+5,end=migration.indexOf('\n$$;',start)+1,original=migration.slice(start,end);
assert.equal(sha256(original),frozen.functions[signature].sourceSha256,'SIMPLE_REPORT_ORIGINAL_SOURCE_CHANGED');
const section=(from,to)=>{assert.equal(original.split(from).length,2);const a=original.indexOf(from),b=original.indexOf(to,a+from.length);assert.ok(b>a);return original.slice(a,b);};
// Parallel, cost-free read only. Existing public helper/approved bridge stays
// byte-identical. All other collection/opening/cheque/expense/period equations
// and full return-evidence checks are retained from the pinned219 reader.
export const simpleReportHunks=[
 [`    FROM public.order_status_history h
    WHERE h.new_status = 'completed'
    GROUP BY h.order_id`,`    FROM (
      SELECT order_id,created_at FROM public.order_status_history WHERE new_status='completed'
      UNION ALL SELECT order_id,completed_at FROM sales_lite1.completions
    ) h
    GROUP BY h.order_id`],
 ['  v_damage JSONB;\n',''],
 ['  v_damage := public.inventory_damage_period_totals_internal(p_branch_id,p_period_start,p_period_end);\n',''],
 [section('  ), issued AS MATERIALIZED (','  ), return_rows AS ('),''],
 [section('      COALESCE((SELECT SUM(f.historical_restock_value_in_minor_units_exact)',' AS recovery\n    FROM modern_returns e'),'      0::NUMERIC'],
 [section("      CASE WHEN e.stock_disposition = 'restock'",'\n    FROM public.sales_returns e'),'      0::NUMERIC'],
 ['  ), initial_collections AS (',`    UNION ALL
    SELECT r.id,r.order_id,r.created_at,r.debt_reduction,r.money_refund,r.method,r.entitlement,0::NUMERIC
    FROM sales_lite1.returns r JOIN order_scope o ON o.id=r.order_id
  ), initial_collections AS (`],
 [section('  ), costs AS (','  ), flows AS ('),''],
 [section("      'cogsInMinorUnits'","      'collectedInMinorUnits'"),''],
 ['  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN costs c\n    CROSS JOIN replacement_costs rc CROSS JOIN flows f CROSS JOIN balances b',
  '  FROM sales_totals s CROSS JOIN period_returns r CROSS JOIN flows f CROSS JOIN balances b'],
];
export function simpleReportSource(row){
 assert.equal(row.signature,signature);assert.equal(sha256(row.source),frozen.functions[signature].sourceSha256);
 let body=bridgedSource(row);
 for(const [from,to] of simpleReportHunks){assert.equal(body.split(from).length-1,1,'SIMPLE_REPORT_EXACT_HUNK');body=body.split(from).join(to);}
 assert.doesNotMatch(body,/cogs|wac|cost_snapshot|inventory_damage_period|grossProfit|netProfit|restockRecovery/iu);
 return body;
}
export function simpleReportSql(rows){
 const row=rows.find(r=>r.signature===signature);assert.ok(row);
 return `CREATE FUNCTION sales_lite2.simple_facts(p_branch_id UUID,p_period_start TIMESTAMPTZ,p_period_end TIMESTAMPTZ,p_timezone TEXT,p_verify_evidence BOOLEAN)
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $simple$${simpleReportSource(row)}$simple$;
 REVOKE ALL ON FUNCTION sales_lite2.simple_facts(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated,service_role;
 `+readFileSync(new URL('../../docs/design/sales-only-phase2/simple-report.sql',import.meta.url),'utf8');
}
