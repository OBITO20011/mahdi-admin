import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/105_harden_business_alert_rules_and_thresholds.sql',
  'utf8',
);
const workflow = readFileSync('automation/n8n/workflows/nawasrah-alerts.json', 'utf8');
const documentation = readFileSync('docs/BUSINESS_ALERT_RULES.md', 'utf8');

test('delayed orders use the fixed two-hour server-side rule and actual open states', () => {
  assert.match(migration, /order_unprocessed_after_minutes = 120/);
  assert.match(migration, /order_unprocessed_after_minutes SET NOT NULL/);
  assert.match(migration, /CHECK \(order_unprocessed_after_minutes = 120\)/);
  assert.match(migration, /o\.status IN \('new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'\)/);
  assert.match(migration, /o\.created_at <= p_observed_at[\s\S]*make_interval/);
  assert.doesNotMatch(migration, /UPDATE public\.orders/);
});

test('cash differences use any non-zero amount and expose a clear direction', () => {
  assert.match(migration, /'cashDiscrepancyDetected', v_difference <> 0/);
  assert.match(migration, /WHEN v_difference > 0 THEN 'surplus'/);
  assert.match(migration, /WHEN v_difference < 0 THEN 'shortage'/);
  assert.match(migration, /'cashDiscrepancyAbsoluteInMinorUnits', ABS\(v_difference\)/);
  assert.match(workflow, /cashDiscrepancyDirection === 'surplus' \? 'زيادة' : 'عجز'/);
  assert.doesNotMatch(workflow, /فرق الكاش تجاوز الحد المعتمد/);
});

test('Telegram formats surplus, shortage and balanced shifts without a monetary threshold', () => {
  const workflows = JSON.parse(workflow) as Array<{
    nodes: Array<{ id: string; parameters: { text?: string; textBody?: string } }>;
  }>;
  for (const item of workflows) {
    const node = item.nodes.find((candidate) => candidate.id.endsWith('-send'));
    const expression = node?.parameters.text ?? node?.parameters.textBody;
    assert.ok(expression);
    const format = new Function('$json', `return (${expression.slice(3, -3)})`) as (
      input: Record<string, unknown>,
    ) => string;
    const base = {
      eventType: 'shift_closed',
      payload: {
        shiftNumber: 'SHIFT-1',
        expectedCashInMinorUnits: 1000,
        actualCashInMinorUnits: 1001,
      },
    };
    const surplus = String(format({
      ...base,
      payload: {
        ...base.payload,
        cashDiscrepancyDetected: true,
        cashDiscrepancyDirection: 'surplus',
        cashDiscrepancyAbsoluteInMinorUnits: 1,
      },
    }));
    const shortage = String(format({
      ...base,
      payload: {
        ...base.payload,
        cashDiscrepancyDetected: true,
        cashDiscrepancyDirection: 'shortage',
        cashDiscrepancyAbsoluteInMinorUnits: 1,
      },
    }));
    const balanced = String(format({
      ...base,
      payload: {
        ...base.payload,
        cashDiscrepancyDetected: false,
        cashDiscrepancyDirection: 'balanced',
        cashDiscrepancyAbsoluteInMinorUnits: 0,
      },
    }));
    assert.match(surplus, /فرق الكاش: زيادة/);
    assert.match(surplus, /الفرق: زيادة 0\.001 د\.أ/);
    assert.match(shortage, /فرق الكاش: عجز/);
    assert.match(shortage, /الفرق: عجز 0\.001 د\.أ/);
    assert.doesNotMatch(balanced, /⚠️/);
    assert.doesNotMatch(`${surplus}${shortage}${balanced}`, /الحد المعتمد/);
  }
});

test('daily expenses stay summary-only on explicit Amman calendar boundaries', () => {
  assert.match(migration, /business_timezone = 'Asia\/Amman'/);
  assert.match(migration, /daily_expense_threshold_in_minor_units = NULL/);
  const scanner = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.scan_core_business_alerts'));
  assert.doesNotMatch(scanner, /SUM\(oe\.amount_in_minor_units\)/);
  assert.match(documentation, /not a rolling\s+24-hour window/);
});

test('shift maximum is min of 15 elapsed hours and next local midnight', () => {
  assert.match(migration, /LEAST\([\s\S]*opened_at \+ INTERVAL '15 hours'/);
  assert.match(migration, /AT TIME ZONE v_settings\.business_timezone/);
  assert.match(migration, /p_observed_at >= v_max_close_at/);
  assert.doesNotMatch(migration, /UPDATE public\.cash_shifts/);
});

test('existing incident dedup, recovery, permissions and delivery contracts remain in use', () => {
  assert.match(migration, /public\._transition_business_alert_incident/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.scan_core_business_alerts/);
  assert.match(workflow, /business_alert_recovery/);
  assert.match(documentation, /recipient remain unchanged/);
});
