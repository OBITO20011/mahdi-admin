import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleWebVitals, sanitizeVitalSpan, sanitizeVitalTransaction } from '../src/lib/webVitalsPrivacy';
import type { VitalSpan, VitalTransaction } from '../src/lib/webVitalsPrivacy';

test('vitals are restricted to five percent of configured production page loads, never isolated', () => {
  for (const env of ['isolated', 'staging', 'prelaunch-trial', undefined]) assert.equal(sampleWebVitals(env, true, 0), false);
  assert.equal(sampleWebVitals('production', false, 0), false);
  for (const random of [-1, .05, 1, NaN, Infinity]) assert.equal(sampleWebVitals('production', true, random), false);
  assert.equal(Array.from({ length: 10_000 }, (_, n) => sampleWebVitals('production', true, n / 10_000)).filter(Boolean).length, 500);
});
test('vital events keep only timings and canonical screen, never any sensitive text or arbitrary measurements', () => {
  const secret = 'زبون_سري 0771234567 100.500 token-private cart-private';
  const raw = { type: 'transaction', transaction: secret, message: secret, tags: { secret }, user: { username: secret }, request: { url: secret }, extra: { secret }, contexts: { trace: { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), op: 'pageload', data: { secret } }, secret: { secret } }, measurements: { lcp: { value: 1234 }, cls: { value: .02 }, inp: { value: 42 }, secret: { value: 100.5 } }, spans: [{ data: { secret } }], start_timestamp: 1, timestamp: 3 } as unknown as VitalTransaction;
  const safe = sanitizeVitalTransaction(raw, '/product/private?token=private');
  assert.equal(safe?.transaction, '/product/:product/');
  assert.deepEqual(safe?.measurements, { lcp: { value: 1234, unit: 'millisecond' }, cls: { value: .02, unit: '' }, inp: { value: 42, unit: 'millisecond' } });
  const span = sanitizeVitalSpan({ ...raw.spans![0], data: { secret }, description: secret, trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), start_timestamp: 1, timestamp: 3, measurements: raw.measurements } as VitalSpan);
  for (const object of [safe, span]) for (const part of ['سري', '0771234567', '100.500', 'token-private', 'cart-private', 'secret', 'request', 'username']) assert.ok(!JSON.stringify(object).includes(part), part);
  assert.equal(sanitizeVitalTransaction({ ...raw, contexts: { trace: { op: 'http.client' } } } as VitalTransaction, '/'), null);
});
