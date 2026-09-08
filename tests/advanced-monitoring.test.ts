import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationPath='supabase/migrations/099_advanced_monitoring_and_business_integrity.sql';
const monitoringFixPath='supabase/migrations/100_fix_cancelled_supplier_receipt_monitoring.sql';

test('advanced monitoring is read-only for Business sources and has no repair path',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  const scan=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.run_advanced_monitoring_checks'),sql.indexOf('CREATE OR REPLACE FUNCTION public.report_admin_runtime_incident'));
  assert.match(scan,/inventory:movement-arithmetic/u);
  assert.match(scan,/orders:reservations/u);
  assert.match(scan,/accounting:cogs-profit/u);
  assert.match(scan,/shifts:closing/u);
  assert.doesNotMatch(scan,/UPDATE public\.(?:inventory_balances|inventory_movements|orders|order_items|cash_shifts|suppliers)/u);
});

test('cancelled supplier receipts reconcile original and reversal movements as a zero net effect',async()=>{
  const sql=await readFile(monitoringFixPath,'utf8');
  assert.match(sql,/sr\.status IN \('completed', 'cancelled'\)/u);
  assert.match(sql,/reference_type = 'supplier_receipt_cancellation'[\s\S]*movement_type = 'return_out'/u);
  assert.match(sql,/COALESCE\(e\.qty, 0\) <> COALESCE\(a\.qty, 0\)/u);
  assert.doesNotMatch(sql,/UPDATE public\.supplier_receipts|UPDATE public\.inventory_balances/u);
});

test('monitoring RPCs are private and dashboard requires owner AAL2',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/assert_erp_role\(ARRAY\['owner'\]/u);
  assert.match(sql,/auth\.jwt\(\)->>'aal','aal1'\)<>'aal2'/u);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.record_external_monitoring_snapshot[\s\S]*PUBLIC,anon,authenticated,service_role/u);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.get_advanced_monitoring_dashboard\(\) TO authenticated/u);
});

test('monitoring uses conservative configurable performance thresholds',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/slow_rpc_mean_ms INTEGER NOT NULL DEFAULT 2000/u);
  assert.match(sql,/slow_rpc_max_ms INTEGER NOT NULL DEFAULT 5000/u);
  assert.match(sql,/connection_warning_percent INTEGER NOT NULL DEFAULT 80/u);
  assert.match(sql,/database_growth_min_bytes BIGINT NOT NULL DEFAULT 104857600/u);
  assert.match(sql,/extensions\.pg_stat_statements/u);
  assert.match(sql,/no-safe-error-rate-source/u);
  assert.match(sql,/source='external' AND checked_at<NOW\(\)-interval '15 minutes'/u);
});

test('watchdog routes sanitized advanced incidents and external snapshots',async()=>{
  const watchdog=await readFile('scripts/monitoring/run-developer-watchdog.mjs','utf8');
  assert.match(watchdog,/get_advanced_monitoring_status/u);
  assert.match(watchdog,/record_external_monitoring_snapshot/u);
  assert.match(watchdog,/`developer:integrity:\$\{family\}`/u);
  assert.match(watchdog,/\['inventory', 'accounting', 'automation', 'performance', 'database', 'security', 'runtime'\]/u);
  assert.doesNotMatch(watchdog,/customer_name|customer_phone|delivery_address|total_in_minor_units/iu);
});

test('admin runtime routing stores only a sha256 fingerprint and fixed area',async()=>{
  const source=await readFile('src/lib/errorMonitoring.ts','utf8');
  assert.match(source,/crypto\.subtle\.digest\('SHA-256'/u);
  assert.match(source,/report_admin_runtime_incident/u);
  assert.match(source,/runtimeIncidentCooldownMs = 10 \* 60_000/u);
  const callStart=source.indexOf("supabase.rpc('report_admin_runtime_incident'");
  const call=source.slice(callStart,source.indexOf('  });',callStart)+5);
  assert.doesNotMatch(call,/message|stack|phone|address/u);
});

test('health dashboard is owner-only navigation and typed modal',async()=>{
  const [navigation,modals,dispatcher]=await Promise.all([
    readFile('src/features/more/adminNavigation.config.ts','utf8'),
    readFile('src/stores/modalTypes.ts','utf8'),
    readFile('src/components/modals/AllModals.tsx','utf8'),
  ]);
  assert.match(navigation,/admin-monitoring[\s\S]*monitoring_dashboard[\s\S]*visibility: 'owner'/u);
  assert.match(modals,/monitoring_dashboard: ModalPayloadContract<null, 'none'>/u);
  assert.match(dispatcher,/MonitoringDashboardModal/u);
});

test('integrity Business alert is counts-only and uses hardened outbox',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/business_integrity_warning/u);
  assert.match(sql,/enqueue_automation_event/u);
  assert.match(sql,/jsonb_build_object\('issueCount',v_total_integrity/u);
  assert.doesNotMatch(sql,/business_integrity_warning'[\s\S]{0,500}(?:customerName|phone|address|totalAmount)/u);
});

test('Business delivery formats integrity warning without technical or personal details',async()=>{
  const workflow=await readFile('automation/n8n/workflows/nawasrah-alerts.json','utf8');
  assert.match(workflow,/business_integrity_warning/u);
  assert.match(workflow,/تنبيه سلامة تشغيلية/u);
  assert.match(workflow,/p\.issueCount/u);
});

test('runbooks cover every required incident family and prohibit unsafe repairs',async()=>{
  const runbooks=await readFile('docs/operations/MONITORING_RUNBOOKS.md','utf8');
  for(const heading of ['Backup failure','n8n down','Supabase / database issue','Business delivery dead-letter','Integrity violation','Deployment mismatch','Security anomaly']) {
    assert.match(runbooks,new RegExp(heading.replace('/','\\/'),'u'));
  }
  assert.match(runbooks,/لا تعدل الرصيد أو الحركة مباشرة/u);
  assert.match(runbooks,/Unknown/u);
});
