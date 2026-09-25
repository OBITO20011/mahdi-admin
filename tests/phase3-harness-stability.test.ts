import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertLifecycleRace } from '../scripts/testing/phase3-lifecycle-harness.mjs';
import { isExpectedGatewayReadinessRejection } from '../scripts/testing/gateway-readiness-contract.mjs';

const checkoutBrowserHarness = readFileSync(
  new URL('../scripts/testing/run-customer-checkout-browser-e2e.mjs', import.meta.url),
  'utf8'
);

test('checkout browser fixtures select a catalog-eligible unit deterministically and preflight the real catalog RPC', () => {
  assert.match(checkoutBrowserHarness, /FROM public\.units WHERE code = 'PKT' LIMIT 1/u);
  assert.doesNotMatch(
    checkoutBrowserHarness,
    /SELECT id INTO v_unit FROM public\.units ORDER BY created_at, id LIMIT 1/u
  );
  assert.match(checkoutBrowserHarness, /get_public_storefront_catalog_page/u);
  assert.match(checkoutBrowserHarness, /await assertPublicCatalogFixtures\(apiUrl, anonKey\);/u);
  assert.ok(
    checkoutBrowserHarness.indexOf('await assertPublicCatalogFixtures(apiUrl, anonKey);') <
      checkoutBrowserHarness.indexOf("'test', 'e2e/customer-checkout-isolated.spec.ts'"),
    'catalog fixture preflight must complete before Playwright starts'
  );
});

test('checkout Gateway readiness accepts only the expected post-Turnstile order rejection', () => {
  const response = (status: number) => ({ ok: status >= 200 && status < 300, status });
  assert.equal(
    isExpectedGatewayReadinessRejection(response(400), { code: 'order_rejected' }),
    true
  );
  for (const [status, code] of [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'gateway_unavailable'],
    [503, 'gateway_unavailable'],
    [400, 'turnstile_failed'],
    [400, 'turnstile_required'],
    [400, 'invalid_request'],
  ] as const) {
    assert.equal(isExpectedGatewayReadinessRejection(response(status), { code }), false);
  }
  assert.equal(isExpectedGatewayReadinessRejection(response(400), null), false);
  assert.equal(isExpectedGatewayReadinessRejection(response(200), { code: 'order_rejected' }), false);
});

test('contender rejection is observed before asynchronous lock release', () => {
  const helper = new URL('../scripts/testing/phase3-lifecycle-harness.mjs', import.meta.url).href;
  const script = `import {observeOutcome} from ${JSON.stringify(helper)};
    const contender = observeOutcome(Promise.reject(new Error('EXPECTED_REJECTION')));
    await new Promise(resolve => setTimeout(resolve, 25));
    const result = await contender;
    if(result.status !== 'rejected' || result.reason.message !== 'EXPECTED_REJECTION') process.exit(2);`;
  execFileSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script]);
  assert.throws(() => execFileSync(process.execPath, ['--unhandled-rejections=strict', '-e',
    "const p=Promise.reject(new Error('OLD_UNOBSERVED')); setTimeout(()=>p.catch(()=>{}),25);"],
  { stdio: 'pipe' }), (error: NodeJS.ErrnoException & {status?: number; stderr?: Buffer}) =>
    error.status === 1 && /Error: OLD_UNOBSERVED/u.test(error.stderr?.toString() || ''));
});

test('race assertions reject double effects, wrong winner and unrelated SQL errors', () => {
  const fixture = () => ({
    initialStatus: 'ready', cogs: 12,
    results: [{status: 'fulfilled', value: {success: true, status: 'completed'}},
      {status: 'rejected', reason: {message: 'ERROR: P0001: PHASE3_CUSTOMER_LIFECYCLE_INVALID: rejected'}}],
    before: {status: 'ready', finalized: false, itemFinalized: false,
      reservationState: 'active', onHand: 100, reserved: 1, reservationCount: 1,
      movementCount: 0, lifecycleOperations: 0, terminalHistory: 0,
      cogs: 0, profit: 0, revenue: 0, paymentRows: 0},
    after: {status: 'completed', reservationCount: 1, reservationState: 'consumed',
      onHand: 99, reserved: 0, movementCount: 1, movementQuantity: -1,
      lifecycleOperations: 1, completions: 1, expiries: 0, terminalHistory: 1,
      finalized: true, itemFinalized: true, cogs: 12, profit: 988, revenue: 1000,
      paymentRows: 0, paymentStatus: 'paid'},
  });
  assertLifecycleRace(fixture());
  const expired = fixture();
  expired.initialStatus = expired.before.status = 'new';
  expired.results = [expired.results[1], expired.results[0]];
  expired.results[1].value!.status = 'expired';
  Object.assign(expired.after, {status: 'expired', reservationState: 'released',
    onHand: 100, movementCount: 0, movementQuantity: 0, completions: 0, expiries: 1,
    finalized: false, itemFinalized: false, cogs: 0, profit: 0, revenue: 0, paymentStatus: 'unpaid'});
  assertLifecycleRace(expired);
  const expiredWithSaleEffect = structuredClone(expired);
  expiredWithSaleEffect.after.revenue = 1000;
  assert.throws(() => assertLifecycleRace(expiredWithSaleEffect));
  for (const field of ['movementCount', 'lifecycleOperations', 'completions', 'terminalHistory',
    'cogs', 'profit', 'revenue', 'paymentRows', 'onHand', 'reserved'] as const) {
    const changed = fixture();
    changed.after[field] += 1;
    assert.throws(() => assertLifecycleRace(changed), undefined, field);
  }
  const unrelated = fixture();
  unrelated.results[1].reason!.message = 'ERROR: 42501: permission denied';
  assert.throws(() => assertLifecycleRace(unrelated));
  const bothWon = fixture();
  bothWon.results[1] = bothWon.results[0];
  assert.throws(() => assertLifecycleRace(bothWon));
  const wrongWinner = fixture();
  wrongWinner.initialStatus = wrongWinner.before.status = 'new';
  assert.throws(() => assertLifecycleRace(wrongWinner));
});
