import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/102_privacy_minimize_business_alert_payload.sql',
  'utf8',
);
const workflow = readFileSync(
  'automation/n8n/workflows/nawasrah-alerts.json',
  'utf8',
);
const pushFunction = readFileSync(
  'supabase/functions/send-order-push/index.ts',
  'utf8',
);
const privacyPolicy = readFileSync(
  'customer-web/src/components/PrivacyPolicyModal.tsx',
  'utf8',
);
const dataMap = readFileSync('docs/operations/PRIVACY_DATA_MAP.md', 'utf8');

test('new Business order events exclude customer contact, address, notes and location', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_order_automation_event/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enqueue_order_automation_event\(\)/);
  assert.doesNotMatch(
    migration,
    /customerName|customerPhone|deliveryAddress|googleMapsUrl|customerNotes/,
  );
});

test('external order alert templates cannot render customer PII', () => {
  const parsed = JSON.parse(workflow) as Array<{ nodes: Array<{ parameters?: Record<string, unknown> }> }>;
  const expressions = parsed.flatMap((item) =>
    item.nodes.flatMap((node) => [node.parameters?.text, node.parameters?.textBody])
  ).filter((value): value is string => typeof value === 'string');
  const orderExpressions = expressions.filter((value) => value.includes("t === 'new_order'"));
  assert.equal(orderExpressions.length, 2);
  for (const expression of orderExpressions) {
    assert.doesNotMatch(expression, /p\.customerName|p\.customerPhone|p\.deliveryAddress|p\.googleMapsUrl/);
  }
});

test('staff web push contains a generic operational message only', () => {
  assert.doesNotMatch(pushFunction, /customer_name_snapshot|total_in_minor_units/);
  assert.match(pushFunction, /طلب موقع جديد بحاجة للمراجعة/);
});

test('privacy policy and data map describe actual services and unresolved policy decisions', () => {
  for (const service of ['Supabase', 'Cloudflare', 'Sentry', 'n8n', 'Telegram', 'WhatsApp']) {
    assert.match(privacyPolicy, new RegExp(service));
  }
  assert.match(dataMap, /Requires Business or legal input/);
  assert.match(dataMap, /No automatic Production deletion/);
});
