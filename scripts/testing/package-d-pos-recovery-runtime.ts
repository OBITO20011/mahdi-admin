import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runPosV2Attempt, readPosV2Recovery} from '../../src/services/supabase/posV2Recovery';
import {submitPosSaleV2WithRpc, type CreatePosSaleV2Input} from '../../src/services/supabase/posV2.service';

const [container, configurationId, revisionText] = process.argv.slice(2);
assert.match(container || '', /^supabase_db_nawasrah-package-d-test$/u);
assert.match(configurationId || '', /^[a-f0-9-]{36}$/u);
const actor = '92400000-0000-0000-0000-000000000001';
const product = '92400000-0000-0000-0000-000000000101';
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const sql = (query: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let output = '', error = '';
  child.stdout.on('data', data => {output += data;}); child.stderr.on('data', data => {error += data;});
  child.on('error', reject); child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(error)));
  child.stdin.end(`SET statement_timeout='60s'; SET lock_timeout='30s'; ${query}`);
});
const fingerprint = async () => {
  const raw = await sql(`SELECT jsonb_build_object(
  'orders',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM orders t),
  'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_items t),
  'operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM business_operations t),
  'payments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customer_payments t),
  'shifts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM cash_shifts t),
  'balances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY warehouse_id,product_id) FROM inventory_balances t),
  'movements',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM inventory_movements t),
  'instances',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_parcel_instances t),
  'components',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM order_parcel_components t));`);
  // Preserve the byte-sensitive proof and expose full content if it differs.
  return {sha256: createHash('sha256').update(raw).digest('hex'), content: JSON.parse(raw)};
};
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {value: {
  getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
}});
// Node exercises the shared adapter against real DB RPCs. Browser locking is
// tested separately in Chromium/WebKit; this is not a two-browser simulation.
let chain = Promise.resolve();
Object.defineProperty(globalThis, 'navigator', {value: {locks: {request: (_key: string, _options: unknown,
  work: () => Promise<unknown>) => {const pending = chain.then(work);
  chain = pending.then(() => undefined, () => undefined); return pending;}}}});
let loseNextResponse = true;
let lastRpcFailure = '';
const calls: Array<Record<string, unknown>> = [];
const execute = async (_name: string, p: Record<string, unknown>) => {
  calls.push(structuredClone(p));
  try {
    const raw = await sql(`SELECT set_config('request.jwt.claims',
      '{"sub":"${actor}","role":"authenticated","aal":"aal2"}',false); SET ROLE authenticated;
      SELECT create_pos_sale_v2(${literal(p.p_warehouse_id)}::uuid,${literal(p.p_branch_id)}::uuid,
        ${p.p_customer_id ? literal(p.p_customer_id) + '::uuid' : 'NULL'},${literal(p.p_customer_name)},
        ${literal(p.p_payment_method)},${literal(JSON.stringify(p.p_lines))}::jsonb,
        ${p.p_discount_in_minor_units},${p.p_amount_received_in_minor_units},${literal(p.p_idempotency_key)});`);
    const data = JSON.parse(raw.split(/\r?\n/u).at(-1)!);
    if (loseNextResponse) {loseNextResponse = false; return {data: null, error: {message: 'lost response after commit'}};}
    return {data, error: null};
  } catch (error) {lastRpcFailure = error instanceof Error ? error.message : String(error);
    return {data: null, error: {code: 'P0001', message: lastRpcFailure.replace(/^ERROR:\s*/u, '')}};}
};
const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}, rpc: execute} as unknown as SupabaseClient;
const actualParcelUnits = Number(await sql(`SELECT units_per_sale_unit FROM products WHERE id=${literal(product)}::uuid;`));
assert.ok(Number.isSafeInteger(actualParcelUnits) && actualParcelUnits > 0);
const variants: CreatePosSaleV2Input['lines'][] = [
  [{commercial_line_kind: 'base_unit', product_id: product, base_quantity: 1}],
  [{commercial_line_kind: 'legacy_single_sku_parcel', product_id: product, parcel_quantity: 1, units_per_parcel: actualParcelUnits}],
  [{commercial_line_kind: 'configurable_parcel', family_product_id: '92400000-0000-0000-0000-000000000100',
    parcel_configuration_id: configurationId, configuration_revision: Number(revisionText),
    parcel_instances: [{components: [{product_id: product, base_quantity: 5}]}]}],
];
for (const lines of variants) {
  storage.clear(); loseNextResponse = true; lastRpcFailure = '';
  const input: CreatePosSaleV2Input = {warehouseId: '92400000-0000-0000-0000-000000000201',
    branchId: '92400000-0000-0000-0000-000000000200', paymentMethod: 'cash', customerName: 'D2 runtime',
    lines, discountInMinorUnits: 0, amountReceivedInMinorUnits: 1000000, idempotencyKey: 'captured-by-adapter'};
  const firstIndex = calls.length;
  assert.equal((await runPosV2Attempt(client, actor, 'START_NEW', input)).ok, false);
  assert.equal(lastRpcFailure, '', 'Fixture must really commit before the response is lost');
  assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  const committed = await fingerprint();
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input));
  assert.equal(calls.length, firstIndex + 1, 'Blocked new intent must not invoke any RPC');
  assert.deepEqual(await fingerprint(), committed);
  const recovered = await runPosV2Attempt(client, actor, 'RECOVER_EXISTING');
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.deepEqual(calls[firstIndex], calls[firstIndex + 1]);
  assert.deepEqual(await fingerprint(), committed, 'Recovery cannot write business state');
  assert.equal((await runPosV2Attempt(client, actor, 'RECOVER_EXISTING')).ok, true);
  assert.deepEqual(await fingerprint(), committed);
  const saved = readPosV2Recovery(actor)!;
  const conflict = await submitPosSaleV2WithRpc({...saved.request, discountInMinorUnits: 1}, execute);
  assert.equal(conflict.ok, false); assert.deepEqual(await fingerprint(), committed);
  const next = await runPosV2Attempt(client, actor, 'START_NEW', input);
  assert.equal(next.ok, true, JSON.stringify(next));
  if (next.ok && recovered.ok) assert.notEqual(next.data.orderId, recovered.data.orderId);
}
console.log(JSON.stringify({ok: true, realRpc: 'create_pos_sale_v2', lineKinds: 3,
  lostResponseAfterCommit: true, immutableRecovery: true, replayZeroWrite: true, changedPayloadRejected: true,
  explicitNewIntent: true, browserLockProof: 'separate browser gate'}));
