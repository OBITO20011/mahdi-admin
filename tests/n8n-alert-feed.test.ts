import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/057_secure_n8n_automation_events.sql',
  'utf8',
);
const edgeFunction = readFileSync(
  'supabase/functions/n8n-alert-feed/index.ts',
  'utf8',
);
const supabaseConfig = readFileSync('supabase/config.toml', 'utf8');

test('automation events are durable and deliveries are independent per channel', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.automation_events/);
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.automation_event_deliveries/,
  );
  assert.match(migration, /PRIMARY KEY \(event_id, channel\)/);
  assert.match(migration, /FOR UPDATE OF d SKIP LOCKED/);
  assert.match(migration, /status IN \('pending', 'processing', 'delivered', 'failed'\)/);
});

test('ERP activity is captured by database triggers without duplicating business logic in n8n', () => {
  const finalizedOrderAlertMigration = readFileSync(
    'supabase/migrations/062_finalize_automation_order_alerts.sql',
    'utf8',
  );
  assert.match(finalizedOrderAlertMigration, /AFTER INSERT OR UPDATE OF delivery_zone ON public\.orders/);
  assert.match(finalizedOrderAlertMigration, /NEW\.delivery_zone IS NULL/);
  assert.match(finalizedOrderAlertMigration, /customerPhone/);
  assert.match(finalizedOrderAlertMigration, /deliveryFeeInMinorUnits/);
  assert.match(
    migration,
    /AFTER INSERT OR UPDATE OF status, severity ON public\.stock_alerts/,
  );
  assert.match(migration, /AFTER UPDATE OF status ON public\.cash_shifts/);
  assert.match(migration, /OLD\.status = 'open' AND NEW\.status = 'closed'/);
});

test('anonymous and staff clients cannot read or mutate the automation outbox', () => {
  assert.match(
    migration,
    /ALTER TABLE public\.automation_events ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.automation_events[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.claim_automation_deliveries[\s\S]*TO service_role/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.claim_automation_deliveries[\s\S]{0,100}TO authenticated/,
  );
});

test('the n8n feed has a narrow shared-secret boundary and internal service role', () => {
  assert.match(edgeFunction, /x-nawasrah-automation-secret/);
  assert.match(edgeFunction, /safeEqual\(providedSecret, expectedSecret\)/);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeFunction, /claim_automation_deliveries/);
  assert.match(edgeFunction, /complete_automation_delivery/);
  assert.match(edgeFunction, /Cache-Control': 'no-store'/);
  assert.match(
    supabaseConfig,
    /\[functions\.n8n-alert-feed\]\s*verify_jwt = false/,
  );
});
