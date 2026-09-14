import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../supabase/migrations/111_harden_pos_sale_idempotency_replays.sql',
    import.meta.url,
  ),
  'utf8',
);
const runtime = readFileSync(
  new URL('../scripts/testing/run-pos-idempotency-runtime.mjs', import.meta.url),
  'utf8',
);

test('POS replay is resolved before the private mutating package implementation', () => {
  assert.match(migration, /RENAME TO _create_pos_sale_package_legacy/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(v_key\)\)/);
  assert.match(
    migration,
    /IF NOT FOUND THEN[\s\S]*v_legacy_result := public\._create_pos_sale_package_legacy/,
  );
  assert.match(migration, /'idempotentReplay', true/);
  assert.doesNotMatch(migration, /REPLAY_WHOLESALE_POS_SALE/);
});

test('POS replay identity uses stable product rows and stored package snapshots', () => {
  assert.match(migration, /'product_id', normalized\.product_id/);
  assert.match(migration, /oi\.sale_package_quantity IS NOT NULL/);
  assert.match(migration, /v_stored_items IS DISTINCT FROM v_request_items/);
  assert.match(migration, /ORDER BY normalized\.product_id/);
  assert.match(migration, /jsonb_agg\(item\.value ORDER BY item\.value->>'productId'\)/);
  assert.match(migration, /ORDER BY oi\.product_id/);
  assert.match(migration, /p_customer_id IS DISTINCT FROM v_order\.customer_id/);
  assert.match(migration, /v_request_tender IS DISTINCT FROM v_stored_tender/);
  assert.match(migration, /IDEMPOTENCY_CONFLICT/);
});

test('POS legacy implementation stays private with unchanged public signature', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\._create_pos_sale_package_legacy\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(migration, /ALTER FUNCTION public\.create_pos_sale\([\s\S]*OWNER TO postgres/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_pos_sale\([\s\S]*TO authenticated/);
});

test('isolated runtime covers identical and conflicting concurrent requests', () => {
  assert.match(runtime, /Promise\.all\(\[[\s\S]*identicalKey/);
  assert.match(runtime, /concurrent-conflict/);
  assert.match(runtime, /crossUserCollision/);
  assert.match(runtime, /incompleteLegacyIdentity/);
  assert.match(runtime, /replay_audits: 0/);
});
