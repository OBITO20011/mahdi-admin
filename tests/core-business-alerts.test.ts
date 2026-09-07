import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/097_core_business_alerts.sql', 'utf8');
const workflow = readFileSync('automation/n8n/workflows/nawasrah-alerts.json', 'utf8');
const feed = readFileSync('supabase/functions/n8n-alert-feed/index.ts', 'utf8');

test('core Business alerts reuse the existing private outbox and delivery channel', () => {
  assert.match(migration, /public\.enqueue_automation_event/);
  assert.match(migration, /public\.business_alert_incidents/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.business_alert_incidents[\s\S]*PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*(?:telegram|recipient|channel)/i);
  assert.match(feed, /claim_automation_deliveries/);
});

test('only evidence-backed alerts are enabled and unapproved thresholds fail closed', () => {
  assert.match(migration, /order_expired_enabled BOOLEAN NOT NULL DEFAULT true/);
  assert.match(migration, /purchase_order_overdue_enabled BOOLEAN NOT NULL DEFAULT true/);
  for (const setting of [
    'order_unprocessed_after_minutes',
    'order_near_expiry_minutes',
    'shift_expected_close_local_time',
    'cash_discrepancy_threshold_in_minor_units',
    'daily_expense_threshold_in_minor_units',
  ]) {
    assert.match(migration, new RegExp(`${setting}[^,;]*(?:INTEGER|TIME|BIGINT)`));
  }
  assert.doesNotMatch(migration, /order_unprocessed_after_minutes[^\n]*DEFAULT\s+\d/i);
  assert.doesNotMatch(migration, /daily_expense_threshold_in_minor_units[^\n]*DEFAULT\s+\d/i);
});

test('incident transitions dedupe repeated scans and emit one meaningful recovery', () => {
  assert.match(migration, /state TEXT NOT NULL CHECK \(state IN \('open', 'resolved'\)\)/);
  assert.match(migration, /RETURN 'unchanged'/);
  assert.match(migration, /business_alert_recovery/);
  assert.match(migration, /occurrence = v_occurrence/);
  assert.match(migration, /business:' \|\| p_incident_key \|\| ':open:'/);
  assert.match(migration, /business:' \|\| p_incident_key \|\| ':resolved:'/);
});

test('scanner is bounded, private, and scheduled once every five minutes', () => {
  assert.match(migration, /p_batch_size NOT BETWEEN 1 AND 200/);
  assert.match(migration, /LIMIT p_batch_size/g);
  assert.match(migration, /set_config\('lock_timeout', '3s', true\)/);
  assert.match(migration, /set_config\('statement_timeout', '25s', true\)/);
  assert.match(migration, /scan-core-business-alerts'[\s\S]*'\*\/5 \* \* \* \*'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.scan_core_business_alerts[\s\S]*PUBLIC, anon, authenticated/);
});

test('messages contain only operational fields required by the owner', () => {
  assert.match(workflow, /order_expired/);
  assert.match(workflow, /purchase_order_overdue/);
  assert.match(workflow, /business_alert_recovery/);
  assert.doesNotMatch(migration, /customerPhone|customer_phone|internal_notes/i);
});
