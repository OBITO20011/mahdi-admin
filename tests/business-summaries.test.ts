import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/098_business_summaries.sql';
const workflowPath = 'automation/n8n/workflows/nawasrah-alerts.json';

test('Business summaries use the hardened Business outbox and bounded schedule', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /business_daily_summary/u);
  assert.match(migration, /business_weekly_summary/u);
  assert.match(migration, /UNIQUE \(summary_type, period_start, period_end\)/u);
  assert.match(migration, /scan-business-summaries[\s\S]*'\*\/5 \* \* \* \*'/u);
  assert.match(migration, /daily_summary_local_time TIME NOT NULL DEFAULT TIME '08:00'/u);
  assert.match(migration, /weekly_summary_iso_day SMALLINT NOT NULL DEFAULT 1/u);
  assert.match(migration, /weekly_summary_local_time TIME NOT NULL DEFAULT TIME '09:00'/u);
});

test('Business summary functions and ledger remain private', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(migration, new RegExp(`FROM PUBLIC, anon, authenticated`, 'u'));
    assert.ok(role);
  }
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.build_business_summary[\s\S]*TO service_role/u);
  assert.match(migration, /REVOKE ALL ON TABLE public\.business_summary_runs[\s\S]*FROM PUBLIC, anon, authenticated/u);
});

test('summary monitoring exposes technical counters and not Business totals', async () => {
  const migration = await readFile(migrationPath, 'utf8');
  const monitoringBody = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.get_business_summary_monitoring_status'),
    migration.indexOf('REVOKE ALL ON FUNCTION public.enqueue_automation_event'),
  );
  assert.match(monitoringBody, /unresolvedMissedPeriods/u);
  assert.match(monitoringBody, /overdueDeliveries/u);
  assert.doesNotMatch(monitoringBody, /grossSalesInMinorUnits|customerDueInMinorUnits|supplierDueInMinorUnits/u);
});

test('Telegram and WhatsApp templates format both summary event types', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /business_daily_summary/u);
  assert.match(workflow, /business_weekly_summary/u);
  assert.match(workflow, /ملخص الأعمال اليومي/u);
  assert.match(workflow, /ملخص الأعمال الأسبوعي/u);
});

test('summary messages are bounded Arabic aggregates with no customer PII', async () => {
  const workflows = JSON.parse(await readFile(workflowPath, 'utf8')) as Array<{
    nodes: Array<{id: string; parameters: {text?: string; textBody?: string}}>;
  }>;
  for (const workflow of workflows) {
    const node = workflow.nodes.find((candidate) => candidate.id.endsWith('-send'));
    const expression = node?.parameters.text ?? node?.parameters.textBody;
    assert.ok(expression);
    const formatter = new Function(
      '$json',
      `return (${expression.slice(3, -3)})`,
    ) as ($json: Record<string, unknown>) => unknown;
    const message = String(formatter({
      eventType: 'business_weekly_summary',
      payload: {
        period: {dateFrom: '2026-01-05', dateTo: '2026-01-11'},
        sales: {
          completedOrderCount: 3,
          netSalesInMinorUnits: 20000,
          cashSalesInMinorUnits: 9000,
          cliqSalesInMinorUnits: 5000,
          cogsInMinorUnits: 6000,
          discountInMinorUnits: 1000,
          grossProfitInMinorUnits: 14000,
          netProfitInMinorUnits: 12500,
        },
        expenses: {totalInMinorUnits: 1500},
        inventory: {lowStockCount: 1, outOfStockCount: 1},
        balances: {
          customerDueInMinorUnits: 4000,
          customerCount: 1,
          supplierDueInMinorUnits: 7000,
          supplierCount: 1,
        },
        purchases: {totalInMinorUnits: 12000},
        shifts: {openCount: 1, closedCount: 1, cashDiscrepancyCount: 1},
        orders: {expiredCount: 1},
        openIncidents: {total: 1},
        dailyBreakdown: [{date: '2026-01-05', grossSalesInMinorUnits: 20000}],
      },
    }));
    assert.match(message, /ملخص الأعمال الأسبوعي/u);
    assert.match(message, /المبيعات الصافية: 20\.000 د\.أ/u);
    assert.match(message, /صافي الربح: 12\.500 د\.أ/u);
    assert.ok(message.length < 4096);
    assert.doesNotMatch(message, /هاتف|عنوان|0799999999/u);
  }
});
