import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildHome219Migration,extractSqlFunction} from '../scripts/testing/build-home219-read-sql.mjs';
import {sourceBeforeDraft220Workflow} from '../scripts/audit/source-before-draft220.mjs';
import {inlineLegacyQuantities220} from '../scripts/testing/draft220-quantity-inline.mjs';
const read=(f:string)=>readFileSync(f,'utf8').replaceAll('\r\n','\n');
const draft=read('docs/design/migration220/220_posthandover_read_performance.sql');
const body=(sql:string)=>{const m=/\bAS\s+(\$[a-z_]*\$)/iu.exec(sql)!;return sql.slice(m.index+m[0].length,sql.lastIndexOf(m[1]));};
test('older CI assertions see only the exact reviewed workflow inverse; unknown mutations remain visible',()=>{
 const raw=read('.github/workflows/quality.yml'),old=execFileSync('git',['show','01d4b036136304876da1be8b701cff9e342e3b4d:.github/workflows/quality.yml'],{encoding:'utf8',windowsHide:true}).replaceAll('\r\n','\n');
 assert.equal(sourceBeforeDraft220Workflow(raw),old);assert.equal(sourceBeforeDraft220Workflow(raw+'\n# unknown'),raw+'\n# unknown');
 assert.ok(raw.includes('posthandover220-draft'));assert.equal(raw.replace(', posthandover220-draft','').replace(raw.slice(raw.indexOf('      - name: Quarantined post-handover220'),raw.indexOf('      - name: Collect allowlisted safe reset')), ''),old);
});
test('220 stays quarantined: history/tools/RESET219 remain exact main219, no deployment entry',()=>{
 const migrations=readdirSync('supabase/migrations');assert.equal(migrations.filter(n=>/^\d{3}_.*\.sql$/u.test(n)).length,180);assert.ok(!migrations.some(n=>n.startsWith('220_')));
 const changes=execFileSync('git',['diff','--name-only','d0cbf421fedb613c52b48483ba6a9aa44b087adc','--','supabase','scripts/operations','scripts/backup'],{encoding:'utf8',windowsHide:true});assert.equal(changes.trim(),'');
 assert.equal(JSON.parse(read('docs/agent/project-state.json')).migrationCeiling,219);
 assert.match(draft,/DRAFT220_REQUIRES_EXACT_219_HISTORY/u);assert.match(draft,/DRAFT220_REQUIRES_REVIEWED_219_READERS/u);
 assert.doesNotMatch(draft,/\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\s/iu);
 assert.equal((draft.match(/CREATE INDEX /gu)??[]).length,1);assert.match(draft,/supplier_receipt_items\(supplier_receipt_id\)/u);
 assert.equal((draft.match(/ALTER POLICY /gu)??[]).length,2);assert.equal((draft.match(/USING \(\(select auth\.uid\(\)\) IS NOT NULL\)/gu)??[]).length,2);
 assert.equal((draft.match(/ALTER FUNCTION .*work_mem/gu)??[]).length,1);assert.match(draft,/_get_operational_business_report_before_phase6\(uuid,date,date\) SET work_mem='8MB'/u);
});
test('legacy reader changes only literal119 quantity-call expansions; policy math and all other legacy calculations exact',()=>{
 const source=read('supabase/migrations/119_exact_wac_and_commercial_quantity_reporting.sql');
 // Migration056 renames055;083 excludes cancelled orders;119 patches quantities/WAC.
 const original=extractSqlFunction(read('supabase/migrations/055_operational_business_reports.sql'),'get_operational_business_report')
  .replaceAll('COALESCE(oi.sale_package_quantity, oi.quantity)','public.phase35_report_package_count_internal(oi.id, oi.commercial_line_kind, oi.sale_package_quantity, oi.units_per_sale_package)')
  .replace('    JOIN public.orders o ON o.id = ce.order_id\n  ),','    JOIN public.orders o ON o.id = ce.order_id\n    WHERE o.status IN (\'completed\', \'returned\')\n  ),')
  .replace('COALESCE(SUM(oi.quantity), 0)::BIGINT AS base_unit_count','COALESCE(SUM(public.phase35_report_base_unit_count_internal(oi.id, oi.commercial_line_kind, oi.quantity)), 0)::BIGINT AS base_unit_count')
  .replace('ib.on_hand_quantity * p.cost_price_in_minor_units','ib.on_hand_quantity::NUMERIC * COALESCE(p.wac_cost_in_minor_units_exact, p.cost_price_in_minor_units::NUMERIC)');
 assert.equal(body(extractSqlFunction(draft,'_get_operational_business_report_v1')),body(inlineLegacyQuantities220(original,source)));
 assert.throws(()=>assert.equal(body(extractSqlFunction(draft.replace('s.gross - r.entitlement','s.gross + r.entitlement'),'phase6_financial_facts_before208_internal')),body(extractSqlFunction(draft,'phase6_financial_facts_before208_internal'))));
});
test('facts retain literal219 body except exact daily aggregate grouping; monetary mutation is detected',async()=>{
 const original=body(extractSqlFunction(await buildHome219Migration(process.cwd()),'phase6_financial_facts_before208_internal'));
 const grouped=`  ), daily_sales_grouped AS (
    SELECT (o.completion_at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(o.total_in_minor_units),0)::BIGINT AS gross, COUNT(*)::BIGINT AS count
    FROM period_sales o GROUP BY (o.completion_at AT TIME ZONE p_timezone)::DATE
  ), daily_returns_grouped AS (
    SELECT (r.at AT TIME ZONE p_timezone)::DATE AS day,
      COALESCE(SUM(r.entitlement),0)::BIGINT AS returned
    FROM return_rows r WHERE r.at>=p_period_start AND r.at<p_period_end
    GROUP BY (r.at AT TIME ZONE p_timezone)::DATE
`;
 const short=`      COALESCE(ds.gross,0)::BIGINT AS gross,
      COALESCE(ds.count,0)::BIGINT AS count,
      COALESCE(dr.returned,0)::BIGINT AS returned,`;
 const long=original.slice(original.indexOf('      COALESCE((SELECT SUM(o.total_in_minor_units) FROM period_sales o',original.indexOf('), daily AS (')),original.indexOf('      COALESCE(dc.cash_collected',original.indexOf('), daily AS ('))).trimEnd();
 const inverse=(s:string)=>{assert.ok(s.includes(grouped));assert.ok(s.includes(short));return s.replace(grouped,'').replace(short,long).replace('\n      LEFT JOIN daily_sales_grouped ds ON ds.day=d.day\n      LEFT JOIN daily_returns_grouped dr ON dr.day=d.day','');};
 const current=body(extractSqlFunction(draft,'phase6_financial_facts_before208_internal'));assert.equal(inverse(current),original);
 assert.throws(()=>assert.equal(inverse(current.replace('s.gross - r.entitlement','s.gross + r.entitlement')),original));
 assert.throws(()=>inverse(current.replace('SUM(o.total_in_minor_units),0)','SUM(o.total_in_minor_units)+1,0)')));
});
test('supplier reader changes only both page/order clauses; cheque due-date order untouched',()=>{
 const original=body(extractSqlFunction(read('supabase/migrations/208_supplier_replacement_and_damage.sql'),'get_supplier_replacements_page_v1'));
 const candidate=body(extractSqlFunction(draft,'get_supplier_replacements_page_v1'));
 assert.equal(candidate.replace('ORDER BY occurred_at DESC,id DESC LIMIT','ORDER BY occurred_at,id LIMIT').replace('ORDER BY c.occurred_at DESC,c.id DESC),','ORDER BY c.occurred_at,c.id),'),original);
 assert.match(read('src/features/inventory/SupplierReplacementPanel.tsx'),/الأحدث أولاً؛ الصفحة التالية تعرض الأقدم/u);
 assert.equal(execFileSync('git',['diff','--name-only','01d4b036','--','src/features/cheques','src/services/supabase/deferredCheques.service.ts'],{encoding:'utf8',windowsHide:true}).trim(),'');
});
test('CI has the opt-in50k real authenticated8s acceptance and original slow negative, preserves20+3',()=>{
 const runner=read('scripts/testing/run-posthandover220-draft.mjs'),proof=read('scripts/testing/posthandover220-proof.mjs'),workflow=read('.github/workflows/quality.yml');
 assert.match(runner,/orders:50000/u);assert.match(runner,/DRAFT220_REQUIRES_50000_SCOPED_INVOICES_NOT_DATABASE_TOTAL/u);assert.match(runner,/scoped,50000/u);assert.match(runner,/EXISTING_CONTAINER_MUST_NOT_BE_REUSED/u);assert.match(runner,/DRAFT220_REQUIRES_OWN_CREATED_CONTAINER/u);assert.match(runner,/stop','--no-backup/u);
 assert.match(runner,/FULL_YEAR_FIXTURE_PERIOD_REQUIRED/u);assert.match(runner,/annualPeriod:period/u);assert.match(proof,/\['annual',annualFrom,annualTo\]/u);
 assert.match(proof,/i=-3;i<20/u);assert.match(proof,/statement_timeout='8s'/u);assert.match(proof,/ORIGINAL_MUST_FAIL_REAL_8S/u);assert.match(proof,/M01_REQUIRES_ONE_SECOND_MARGIN/u);assert.match(proof,/ROLLBACK_RESTORES_ALL_READER_DEFINITIONS_CONFIG_ACL/u);assert.match(proof,/INDEX|indexNegativeDetected/u);
 assert.match(workflow,/node scripts\/testing\/run-posthandover220-draft\.mjs --isolated-draft220/u);
 const evidence=JSON.parse(read('docs/design/migration220/LOCAL_EVIDENCE.json'));
 assert.equal(evidence.hostedAccess,false);assert.equal(evidence.activeCeiling,219);
 assert.equal(evidence.candidateSha256,createHash('sha256').update(draft).digest('hex'));
});
