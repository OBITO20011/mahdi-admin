import {expect, test, type Page, type Route} from './isolated-test';

type Fixture = {orderId: string; orderItemId: string; productId: string; warehouseId: string};
type DurableFingerprint = {sha256: string; content: Record<string, unknown>;
  orderReturns: number; orderReplacements: number; returnItems: number;
  replacementItems: number; returnEffects: number; replacementEffects: number};
type FixtureMap = Record<string, Record<string, Fixture>>;
const baseUrl = process.env.PHASE44_ADMIN_BASE_URL;
const controlUrl = process.env.PHASE44_CONTROL_URL;
const email = process.env.PHASE44_ADMIN_EMAIL;
const password = process.env.PHASE44_ADMIN_PASSWORD;
const fixtures = JSON.parse(process.env.PHASE44_FIXTURES || '{}') as FixtureMap;
const enabled = Boolean(baseUrl && controlUrl && email && password);
const prefix = 'nawasrah:admin:phase43-aftercare:v2:';

const fixtureFor = (project: string, name: string) => fixtures[project]?.[name];
const snapshot = async (fixture: Fixture) => {
  const response = await fetch(`${controlUrl}/snapshot?orderId=${fixture.orderId}`);
  expect(response.ok).toBe(true);
  return response.json() as Promise<DurableFingerprint>;
};
const recoveryFingerprint = async (page: Page, action: 'return' | 'replacement') =>
  page.evaluate(async ({storagePrefix, actionName}) => {
    const key = Object.keys(localStorage).find((entry) =>
      entry.startsWith(storagePrefix) && entry.endsWith(`:${actionName}`));
    const raw = key ? localStorage.getItem(key)! : 'null';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return {sha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')).join(''), raw};
  }, {storagePrefix: prefix, actionName: action});
const openModuleShell = async (page: Page) => {
  await page.route(`${baseUrl}/`, (route) => route.fulfill({contentType: 'text/html',
    body: '<html><body><main data-testid="phase44-slice4-shell"><div id="root"></div></main></body></html>'}));
  await page.goto(baseUrl!);
};
const signIn = async (page: Page) => {
  await openModuleShell(page);
  const result = await page.evaluate(async ({loginEmail, loginPassword}) => {
    const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
    const module = await runtimeImport('/src/lib/supabase.ts');
    const signedIn = await module.supabase.auth.signInWithPassword({email: loginEmail, password: loginPassword,
      options: {captchaToken: 'XXXX.DUMMY.TOKEN.XXXX'}});
    const verified = await module.supabase.auth.getUser();
    return {signInError: signedIn.error?.message || null,
      userError: verified.error?.message || null, userId: verified.data.user?.id || null};
  }, {loginEmail: email!, loginPassword: password!});
  expect(result.signInError).toBeNull();
  expect(result.userError).toBeNull();
  expect(result.userId).not.toBeNull();
};
const clearRecovery = (page: Page) => page.evaluate((storagePrefix) => {
  for (const key of Object.keys(localStorage)) if (key.startsWith(storagePrefix)) localStorage.removeItem(key);
}, prefix);
const state = (page: Page, action: 'return' | 'replacement') => page.evaluate(
  ({storagePrefix, actionName}) => {
    const key = Object.keys(localStorage).find((entry) =>
      entry.startsWith(storagePrefix) && entry.endsWith(`:${actionName}`));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  }, {storagePrefix: prefix, actionName: action});
const replacementInput = (fixture: Fixture, quantity = 1) => ({orderId: fixture.orderId,
  items: [{sourceKind: 'base_order_item' as const, sourceId: fixture.orderItemId, quantity}],
  reason: 'Phase 4.4 isolated supplier defect'});
const returnInput = (fixture: Fixture) => ({orderId: fixture.orderId,
  items: [{return_scope: 'base_unit' as const, order_item_id: fixture.orderItemId,
    quantity: 1, stock_disposition: 'restock' as const}],
  physicalSources: [{root_source_kind: 'base_order_item' as const,
    root_source_id: fixture.orderItemId, source_kind: 'base_order_item' as const,
    source_id: fixture.orderItemId, product_id: fixture.productId, quantity: 1,
    sellable_restock_quantity: 1, defect_non_sellable_quantity: 0,
    customer_damage_quantity: 0}], reason: 'Phase 4.4 isolated return',
  refundMethod: 'cash' as const});
const callService = async (page: Page, method: string, input: unknown) => page.evaluate(
  async ({methodName, value}) => {
    const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
    const service = await runtimeImport('/src/services/supabase/salesAftercare.service.ts');
    return service[methodName](value);
  }, {methodName: method, value: input});
const recover = async (page: Page, orderId: string, action: 'return' | 'replacement') =>
  page.evaluate(async ({order, actionName}) => {
    const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
    const service = await runtimeImport('/src/services/supabase/salesAftercare.service.ts');
    return service.recoverAdminAftercare(order, actionName);
  }, {order: orderId, actionName: action});
const mountAftercarePanel = async (page: Page, orderId: string) => page.evaluate(async (order) => {
  const runtimeImport = (modulePath: string) => import(/* @vite-ignore */ modulePath);
  const Refresh = await runtimeImport('/@react-refresh');
  Refresh.default.injectIntoGlobalHook(window);
  const refreshWindow = window as typeof window & {
    $RefreshReg$: () => void; $RefreshSig$: () => <T>(type: T) => T;
    __vite_plugin_react_preamble_installed__: boolean;
  };
  refreshWindow.$RefreshReg$ = () => undefined;
  refreshWindow.$RefreshSig$ = () => (type) => type;
  refreshWindow.__vite_plugin_react_preamble_installed__ = true;
  const ReactModule = await runtimeImport('/node_modules/.vite/deps/react.js');
  const React = ReactModule.default ?? ReactModule;
  const ReactDOM = await runtimeImport('/node_modules/.vite/deps/react-dom_client.js');
  const panel = await runtimeImport('/src/features/orders/AdminAftercarePanel.tsx');
  (ReactDOM.createRoot ?? ReactDOM.default.createRoot)(document.getElementById('root')!).render(
    React.createElement(panel.AdminAftercarePanel, {order: {id: order},
      onContractResolved: () => undefined, notify: () => undefined}),
  );
}, orderId);
const installLostAfterCommit = async (page: Page, rpc: string) => {
  let calls = 0;
  await page.route(`**/rest/v1/rpc/${rpc}`, async (route: Route) => {
    calls += 1;
    await route.fetch();
    await route.abort('failed');
  });
  return () => calls;
};

test.describe('Phase 4.4 Slice 4 real Admin recovery bridge', () => {
  test.skip(!enabled, 'Run through run-phase44-admin-recovery-fullstack.mjs only.');

  test.beforeEach(async ({page}) => { await signIn(page); await clearRecovery(page); });

  test('lost Replacement response after commit reloads and recovers with zero writes', async ({page}, testInfo) => {
    const fixture = fixtureFor(testInfo.project.name, 'lostReplacement');
    const before = await snapshot(fixture);
    const calls = await installLostAfterCommit(page, 'settle_sales_replacement_v1');
    const failed = await callService(page, 'settleAdminReplacement', replacementInput(fixture));
    expect(failed.success).toBe(false);
    expect((await state(page, 'replacement')).status).toBe('OUTCOME_UNKNOWN');
    const committed = await snapshot(fixture);
    expect(committed.orderReplacements).toBe(before.orderReplacements + 1);
    expect(calls()).toBe(1);
    const identity = await state(page, 'replacement');
    await page.unroute('**/rest/v1/rpc/settle_sales_replacement_v1');
    await page.reload();
    await mountAftercarePanel(page, fixture.orderId);
    await expect(page.getByRole('button', {name: 'استعادة الاستبدال', exact: true})).toBeVisible();
    const recovered = await recover(page, fixture.orderId, 'replacement');
    expect(recovered.success).toBe(true);
    const recoveredIdentity = await state(page, 'replacement');
    expect(recoveredIdentity.idempotencyKey).toBe(identity.idempotencyKey);
    expect(recoveredIdentity.requestFingerprint).toBe(identity.requestFingerprint);
    expect(recoveredIdentity.intentId).toBe(identity.intentId);
    expect(await snapshot(fixture)).toEqual(committed);
    const durableBeforeCleanReplay = await snapshot(fixture);
    const browserBeforeCleanReplay = await recoveryFingerprint(page, 'replacement');
    const cleanReplay = await recover(page, fixture.orderId, 'replacement');
    expect(cleanReplay.success).toBe(true);
    expect(await snapshot(fixture)).toEqual(durableBeforeCleanReplay);
    expect(await recoveryFingerprint(page, 'replacement')).toEqual(browserBeforeCleanReplay);
  });

  test('lost Return response uses the same public recovery contract', async ({page}, testInfo) => {
    const fixture = fixtureFor(testInfo.project.name, 'lostReturn');
    const before = await snapshot(fixture);
    await installLostAfterCommit(page, 'settle_admin_sales_return_v1');
    const failed = await callService(page, 'settleAdminReturn', returnInput(fixture));
    expect(failed.success).toBe(false);
    const unknown = await state(page, 'return');
    expect(unknown.status).toBe('OUTCOME_UNKNOWN');
    const committed = await snapshot(fixture);
    expect(committed.orderReturns).toBe(before.orderReturns + 1);
    await page.unroute('**/rest/v1/rpc/settle_admin_sales_return_v1');
    await page.reload();
    expect((await recover(page, fixture.orderId, 'return')).success).toBe(true);
    expect((await state(page, 'return')).idempotencyKey).toBe(unknown.idempotencyKey);
    expect(await snapshot(fixture)).toEqual(committed);
  });

  test('malformed committed response remains unknown then recovers valid stored result', async ({page}, testInfo) => {
    const fixture = fixtureFor(testInfo.project.name, 'malformedReplacement');
    await page.route('**/rest/v1/rpc/settle_sales_replacement_v1', async (route) => {
      const response = await route.fetch();
      const body = await response.json() as Record<string, unknown>;
      await route.fulfill({response, json: {...body, issuedQuantity: 99}});
    });
    const result = await callService(page, 'settleAdminReplacement', replacementInput(fixture));
    expect(result.success).toBe(false);
    expect((await state(page, 'replacement')).status).toBe('OUTCOME_UNKNOWN');
    const committed = await snapshot(fixture);
    await page.unroute('**/rest/v1/rpc/settle_sales_replacement_v1');
    const recovered = await recover(page, fixture.orderId, 'replacement');
    expect(recovered.success).toBe(true);
    expect(recovered.data.issuedQuantity).toBe(1);
    expect(await snapshot(fixture)).toEqual(committed);
  });

  test('same-context tabs serialize through Web Lock and DB idempotency', async ({page, context}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Full Web Lock race runs on Chromium.');
    const fixture = fixtureFor(testInfo.project.name, 'sameContext');
    const second = await context.newPage();
    await openModuleShell(second);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let rpcCalls = 0;
    await context.route('**/rest/v1/rpc/settle_sales_replacement_v1', async (route) => {
      rpcCalls += 1; await gate; await route.fallback();
    });
    const firstCall = callService(page, 'settleAdminReplacement', replacementInput(fixture));
    await expect.poll(() => rpcCalls).toBe(1);
    const secondCall = recover(second, fixture.orderId, 'replacement');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rpcCalls).toBe(1);
    release();
    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    expect(firstResult.success).toBe(true); expect(secondResult.success).toBe(true);
    expect(firstResult.data.operationId).toBe(secondResult.data.operationId);
    expect(rpcCalls).toBe(1);
    await second.close();
  });

  test('separate contexts rely on DB authority for overlapping new intent', async ({browser}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Cross-context authority runs on Chromium.');
    const fixture = fixtureFor(testInfo.project.name, 'crossContext');
    const before = await snapshot(fixture);
    const leftContext = await browser.newContext(); const rightContext = await browser.newContext();
    const left = await leftContext.newPage(); const right = await rightContext.newPage();
    try {
      await Promise.all([signIn(left), signIn(right)]);
      const [a, b] = await Promise.all([
        callService(left, 'settleAdminReplacement', replacementInput(fixture)),
        callService(right, 'settleAdminReplacement', replacementInput(fixture)),
      ]);
      expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
      const after = await snapshot(fixture);
      expect(after.orderReplacements).toBe(before.orderReplacements + 1);
      expect(after.replacementItems).toBe(before.replacementItems + 1);
      expect(after.replacementEffects).toBe(before.replacementEffects + 1);
    } finally { await leftContext.close(); await rightContext.close(); }
  });

  test('timeout before dispatch has zero footprint and same attempt can recover', async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Full timeout branch runs on Chromium.');
    const fixture = fixtureFor(testInfo.project.name, 'timeoutBeforeCommit');
    const before = await snapshot(fixture);
    let requests = 0;
    await page.route('**/rest/v1/rpc/settle_sales_replacement_v1', async (route) => {
      requests += 1; await route.abort('timedout');
    });
    const failed = await callService(page, 'settleAdminReplacement', replacementInput(fixture));
    expect(failed.success).toBe(false); expect(requests).toBe(1);
    expect(await snapshot(fixture)).toEqual(before);
    const unknown = await state(page, 'replacement');
    await page.unroute('**/rest/v1/rpc/settle_sales_replacement_v1');
    const recovered = await recover(page, fixture.orderId, 'replacement');
    expect(recovered.success).toBe(true);
    expect((await state(page, 'replacement')).idempotencyKey).toBe(unknown.idempotencyKey);
  });

  test('deliberately reordered stale response cannot overwrite newer durable success', async ({page, context}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Deliberate stale-response race runs on Chromium.');
    const fixture = fixtureFor(testInfo.project.name, 'staleResponse');
    const observer = await context.newPage(); await openModuleShell(observer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let committedResult: Record<string, unknown> | null = null;
    await page.route('**/rest/v1/rpc/settle_sales_replacement_v1', async (route) => {
      const response = await route.fetch();
      committedResult = await response.json() as Record<string, unknown>;
      await gate;
      await route.fulfill({response, json: committedResult});
    });
    const staleCall = callService(page, 'settleAdminReplacement', replacementInput(fixture));
    await expect.poll(() => committedResult).not.toBeNull();
    await observer.evaluate(({storagePrefix, result}) => {
      const key = Object.keys(localStorage).find((entry) => entry.startsWith(storagePrefix)
        && entry.endsWith(':replacement'))!;
      const current = JSON.parse(localStorage.getItem(key)!);
      localStorage.setItem(key, JSON.stringify({...current, status: 'SUCCEEDED',
        generation: current.generation + 1, result}));
    }, {storagePrefix: prefix, result: committedResult});
    release();
    await expect(staleCall).rejects.toThrow(/AFTERCARE_REVIEW_REQUIRED/u);
    const newer = await state(observer, 'replacement');
    expect(newer.status).toBe('SUCCEEDED');
    expect(newer.result.operationId).toBe(committedResult!.operationId);
    expect((await snapshot(fixture)).orderReplacements).toBe(1);
    await observer.close();
  });

  test('deterministic consumed-capacity rejection survives reload and permits a safe new intent', async ({page}, testInfo) => {
    const fixture = fixtureFor(testInfo.project.name, 'deterministicRejection');
    expect((await callService(page, 'settleAdminReplacement', replacementInput(fixture, 1))).success)
      .toBe(true);
    const afterFirst = await snapshot(fixture);
    const rejected = await callService(page, 'settleAdminReplacement', replacementInput(fixture, 2));
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED');
    const rejectionState = await state(page, 'replacement');
    expect(rejectionState.status).toBe('DEFINITIVELY_REJECTED');
    expect(rejectionState.hadUnknownOutcome).toBe(false);
    expect(await snapshot(fixture)).toEqual(afterFirst);
    await page.reload();
    const reloadedState = await state(page, 'replacement');
    expect(reloadedState.status).toBe('DEFINITIVELY_REJECTED');
    expect(reloadedState.recoverable).not.toBe(true);
    const legitimateNewIntent = await callService(page, 'settleAdminReplacement',
      replacementInput(fixture, 1));
    expect(legitimateNewIntent.success).toBe(true);
  });

  test('content-sensitive durable fingerprint detects a same-count row mutation', async ({page: _page}, testInfo) => {
    const fixture = fixtureFor(testInfo.project.name, 'fingerprintProbe');
    const response = await fetch(`${controlUrl}/fingerprint-probe?orderId=${fixture.orderId}`);
    expect(response.ok).toBe(true);
    const [before, after] = await response.json() as [DurableFingerprint, DurableFingerprint];
    expect(before.sha256).not.toBe(after.sha256);
    expect(before.content.inventoryBalances).not.toEqual(after.content.inventoryBalances);
  });
});
