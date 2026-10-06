import {expect, test} from './isolated-test';

const adminBaseUrl = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const actorId = '43210000-0000-4000-8000-000000000001';
const orderId = '43210000-0000-4000-8000-000000000002';
const success = {
  success: true, orderId,
  operationId: '43210000-0000-4000-8000-000000000003',
  replacementId: '43210000-0000-4000-8000-000000000004',
  operationalCoordinatorVersion: 403, issuedQuantity: 1,
  replacementCogsInMinorUnits: 100, moneyRefundInMinorUnits: 0,
  debtReductionInMinorUnits: 0,
};
const request = {items: [{sourceKind: 'base_order_item',
  sourceId: '43210000-0000-4000-8000-000000000005', quantity: 1}],
reason: 'Supplier defect', notes: null};

// Observe only this synthetic fixture. Do not change storage, lock scheduling,
// adapter results or rejection behavior. Keep diagnostics out of product code.
const installTwoTabDiagnostics = async (context: import('@playwright/test').BrowserContext) => {
  await context.addInitScript(({actor, order}) => {
    const global = window as typeof window & {
      aftercareDiagnostics?: {events: unknown[]; dropped: number};
    };
    const evidence = {events: [] as unknown[], dropped: 0};
    global.aftercareDiagnostics = evidence;
    const storageKey = `nawasrah:admin:phase43-aftercare:v2:${actor}:${order}:replacement`;
    const lockName = `nawasrah:admin:phase43-aftercare:v2:lock:${actor}:${order}:replacement`;
    const record = (kind: string, value: unknown) => {
      if (evidence.events.length >= 160) { evidence.dropped += 1; return; }
      evidence.events.push({kind, at: Date.now(), monotonicAt: performance.now(), value});
    };
    const summarize = (raw: string | null) => {
      if (raw === null) return null;
      try {
        const state = JSON.parse(raw);
        return Object.fromEntries(['version', 'actorId', 'orderId', 'action', 'intentId',
          'attemptId', 'idempotencyKey', 'requestFingerprint', 'status', 'generation',
          'hadUnknownOutcome'].map((field) => [field, state?.[field]]));
      } catch { return {invalidJson: true}; }
    };
    for (const method of ['getItem', 'setItem'] as const) {
      const original = Storage.prototype[method];
      Object.defineProperty(Storage.prototype, method, {configurable: true, writable: true,
        value: new Proxy(original, {apply(target, receiver, args) {
          const result = Reflect.apply(target, receiver, args);
          if (args[0] === storageKey) {
            record(method, summarize(method === 'getItem' ? result : args[1]));
          }
          return result;
        }}),
      });
    }
    addEventListener('storage', (event) => {
      if (event.key === storageKey) record('storage-event', summarize(event.newValue));
    });
    const OriginalError = Error;
    global.Error = new Proxy(OriginalError, {construct(target, args, newTarget) {
      const error = Reflect.construct(target, args, newTarget) as Error;
      if (String(args[0]).startsWith('AFTERCARE_REVIEW_REQUIRED:')) {
        // Capture at construction, before WebKit truncates an async rejection stack.
        record('review-required', {message: error.message, stack: error.stack});
      }
      return error;
    }});
    const manager = navigator.locks;
    if (manager) manager.request = new Proxy(manager.request, {apply(target, receiver, args) {
      if (args[0] !== lockName) return Reflect.apply(target, receiver, args);
      record('lock-request', lockName);
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      const observed = [...args];
      observed[callbackIndex] = new Proxy(callback, {apply(work, workReceiver, workArgs) {
        record('lock-granted', lockName);
        const result = Reflect.apply(work, workReceiver, workArgs);
        // Observe settlement without replacing the promise returned to Web Locks.
        void Promise.resolve(result).then(
          () => record('lock-work-fulfilled', lockName),
          () => record('lock-work-rejected', lockName),
        );
        return result;
      }});
      return Reflect.apply(target, receiver, observed);
    }});
  }, {actor: actorId, order: orderId});
};

test('persisted in-flight takeover preserves unknown history and blocks a new intent', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue}) => {
      Object.defineProperty(navigator, 'locks', {configurable: true, value: {
        request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) =>
          callback(),
      }});
      // @ts-expect-error Live Vite module.
      const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
      localStorage.clear();
      void runAdminAftercareMutation(
        {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}} as never,
        order, 'replacement', 'START_NEW', requestValue, async () => {
          return await new Promise(() => undefined);
        });
      while (!Object.keys(localStorage).some((key) => key.includes('phase43-aftercare'))) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
      const rejected = await runAdminAftercareMutation(client as never, order, 'replacement',
        'RECOVER_EXISTING', requestValue, async () => ({data: null,
          error: {code: 'P0001', message:
            'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE: stock unavailable'}}));
      let newCalls = 0;
      let newError = '';
      try {
        await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
          {...requestValue, reason: 'changed intent'}, async () => {
            newCalls += 1; return {data: success, error: null};
          });
      } catch (error) { newError = error instanceof Error ? error.message : String(error); }
      const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
      return {rejected, newCalls, newError, state: JSON.parse(localStorage.getItem(stateKey)!)};
    }, {actor: actorId, order: orderId, requestValue: request});
  expect(evidence.rejected.data).toBeNull();
  expect(evidence.state.status).toBe('OUTCOME_UNKNOWN');
  expect(evidence.state.hadUnknownOutcome).toBe(true);
  expect(evidence.newCalls).toBe(0);
  expect(evidence.newError).toContain('AFTERCARE_OUTCOME_UNKNOWN');
});

test('proved non-commit business rejections permit a distinct safe new intent', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    const cases = [
      {code: 'P0001', identity: 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'},
      {code: 'P0001', identity: 'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE'},
      {code: '23514', identity: 'PHASE43_REPLACEMENT_SOURCE_INVALID'},
    ];
    const outcomes = [];
    for (const testCase of cases) {
      localStorage.clear();
      const rejected = await runAdminAftercareMutation(client as never, order, 'replacement',
        'START_NEW', requestValue, async () => ({data: null, error: {code: testCase.code,
          message: `${testCase.identity}: deterministic test rejection`}}));
      const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
      const rejectedState = JSON.parse(localStorage.getItem(stateKey)!);
      let newCalls = 0;
      const next = await runAdminAftercareMutation(client as never, order, 'replacement',
        'START_NEW', {...requestValue, reason: `new intent after ${testCase.identity}`},
        async () => { newCalls += 1; return {data: resultValue, error: null}; });
      outcomes.push({rejected, rejectedState, next, newCalls});
    }
    localStorage.clear();
    await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
      requestValue, async () => ({data: null, error: {code: '40001',
        message: 'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED: wrong SQLSTATE'}}));
    const ambiguousKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
    return {outcomes, ambiguous: JSON.parse(localStorage.getItem(ambiguousKey)!)};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  for (const outcome of evidence.outcomes) {
    expect(outcome.rejected.data).toBeNull();
    expect(outcome.rejectedState.status).toBe('DEFINITIVELY_REJECTED');
    expect(outcome.rejectedState.hadUnknownOutcome).toBe(false);
    expect(outcome.newCalls).toBe(1);
    expect(outcome.next.data).toEqual(success);
  }
  expect(evidence.ambiguous.status).toBe('OUTCOME_UNKNOWN');
  expect(evidence.ambiguous.hadUnknownOutcome).toBe(true);
});

test('request is captured before authentication or lock waits', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const mutable = structuredClone(requestValue);
    let sentQuantity = 0;
    const pending = runAdminAftercareMutation({auth: {getUser: async () => {
      await waiting; return {data: {user: {id: actor}}, error: null};
    }}} as never, order, 'replacement', 'START_NEW', mutable, async (_key: string, sent) => {
      sentQuantity = Number((sent.items as Array<{quantity: number}>)[0].quantity);
      return {data: resultValue, error: null};
    });
    mutable.items[0].quantity = 9;
    release();
    await pending;
    return {sentQuantity};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.sentQuantity).toBe(1);
});

test('replacement success quantity must equal the immutable submitted request', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const outcome = await runAdminAftercareMutation(
      {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}} as never,
      order, 'replacement', 'START_NEW', requestValue,
      async () => ({data: {...resultValue, issuedQuantity: 99}, error: null}));
    const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
    return {outcome, state: JSON.parse(localStorage.getItem(stateKey)!)};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.outcome.data).toBeNull();
  expect(evidence.outcome.error.message).toContain('AFTERCARE_RESPONSE_INVALID');
  expect(evidence.state.status).toBe('OUTCOME_UNKNOWN');
});

test('Return success enforces debt-first financial semantics and refund evidence', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    const baseResult = {
      success: true, orderId: order,
      operationId: '43210000-0000-4000-8000-000000000103',
      returnId: '43210000-0000-4000-8000-000000000104',
      returnNumber: 'RET-SEMANTIC-1',
      merchandiseEntitlementInMinorUnits: 1000,
      debtReductionInMinorUnits: 100,
      moneyRefundInMinorUnits: 900,
      deliveryRefundInMinorUnits: 0,
      taxRefundInMinorUnits: 0,
      refundMethod: 'cash',
    };
    const baseRequest = {items: [{returnScope: 'base_unit', quantity: 1}],
      reason: 'Valid return', refundMethod: 'cash', referenceNumber: null};
    const run = async (requestValue: Record<string, unknown>, resultValue: Record<string, unknown>) => {
      localStorage.clear();
      const outcome = await runAdminAftercareMutation(client as never, order, 'return',
        'START_NEW', requestValue, async () => ({data: resultValue, error: null}));
      const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
      return {accepted: outcome.data !== null,
        status: JSON.parse(localStorage.getItem(stateKey)!).status};
    };
    return {
      validCash: await run(baseRequest, baseResult),
      validDebtOnly: await run({...baseRequest, refundMethod: null},
        {...baseResult, debtReductionInMinorUnits: 1000,
          moneyRefundInMinorUnits: 0, refundMethod: null}),
      overAllocated: await run(baseRequest,
        {...baseResult, debtReductionInMinorUnits: 900, moneyRefundInMinorUnits: 900}),
      negative: await run(baseRequest,
        {...baseResult, debtReductionInMinorUnits: -1, moneyRefundInMinorUnits: 1001}),
      underAllocated: await run(baseRequest,
        {...baseResult, debtReductionInMinorUnits: 100, moneyRefundInMinorUnits: 899}),
      zeroWithMoneyMethod: await run(baseRequest,
        {...baseResult, debtReductionInMinorUnits: 1000,
          moneyRefundInMinorUnits: 0, refundMethod: null}),
      cashWithReference: await run({...baseRequest, referenceNumber: 'not-allowed'}, baseResult),
      cliqWithoutReference: await run({...baseRequest, refundMethod: 'cliq'},
        {...baseResult, refundMethod: 'cliq'}),
      wrongOrder: await run(baseRequest,
        {...baseResult, orderId: '43210000-0000-4000-8000-000000000999'}),
    };
  }, {actor: actorId, order: orderId});
  expect(evidence.validCash).toEqual({accepted: true, status: 'SUCCEEDED'});
  expect(evidence.validDebtOnly).toEqual({accepted: true, status: 'SUCCEEDED'});
  for (const invalid of [evidence.overAllocated, evidence.negative, evidence.underAllocated,
    evidence.zeroWithMoneyMethod, evidence.cashWithReference,
    evidence.cliqWithoutReference, evidence.wrongOrder]) {
    expect(invalid).toEqual({accepted: false, status: 'OUTCOME_UNKNOWN'});
  }
});

test('unknown mutation exposes recovery controls immediately without manual refresh', async ({page}) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html',
      body: '<html><body><div id="root"></div></body></html>'});
    if (url.pathname.endsWith('/salesAftercare.service.ts')) {
      return route.fulfill({contentType: 'text/javascript', body: `
let pending = false;
const source = {sourceKind:'base_order_item',sourceId:'43210000-0000-4000-8000-000000000005',productId:'43210000-0000-4000-8000-000000000006',remainingQuantity:1,parentReplacementItemId:null};
export async function fetchAdminAftercareContext(){return {success:true,data:{supported:true,capability:'phase43_modern',contractVersion:403,order:{id:'${orderId}',withinWindow:true,deadlineAt:'2026-09-29T00:00:00Z'},financial:{merchandiseDebtInMinorUnits:0,refundableCollectedInMinorUnits:1000,deliveryFeeInMinorUnits:0},baseItems:[{orderItemId:source.sourceId,productId:source.productId,quantity:1,remainingQuantity:1,physicalRepresentatives:[source]}],parcelInstances:[],returns:[],replacements:[]}};}
export async function fetchAdminAftercareRecoveryStates(){return pending?{replacement:{recoverable:true,status:'OUTCOME_UNKNOWN'}}:{};}
export async function settleAdminReplacement(){pending=true;return {success:false,error:'lost response'};}
export async function settleAdminReturn(){throw new Error('unused');}
export async function recoverAdminAftercare(){return {success:true};}
`});
    }
    return route.continue();
  });
  await page.goto(adminBaseUrl);
  await page.evaluate(async () => {
    // @ts-expect-error Live Vite module.
    const Refresh = await import('/@react-refresh');
    Refresh.default.injectIntoGlobalHook(window);
    const refreshWindow = window as typeof window & {
      $RefreshReg$: () => void;
      $RefreshSig$: () => <T>(type: T) => T;
      __vite_plugin_react_preamble_installed__: boolean;
    };
    refreshWindow.$RefreshReg$ = () => undefined;
    refreshWindow.$RefreshSig$ = () => (type) => type;
    refreshWindow.__vite_plugin_react_preamble_installed__ = true;
    // @ts-expect-error Live Vite module.
    const ReactModule = await import('/node_modules/.vite/deps/react.js');
    const React = ReactModule.default ?? ReactModule;
    // @ts-expect-error Live Vite module.
    const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = ReactDOM.createRoot ?? ReactDOM.default.createRoot;
    // @ts-expect-error Live Vite module.
    const {AdminAftercarePanel} = await import('/src/features/orders/AdminAftercarePanel.tsx');
    createRoot(document.getElementById('root')!).render(React.createElement(AdminAftercarePanel, {
      order: {id: '43210000-0000-4000-8000-000000000002', items: []},
      onContractResolved: () => undefined,
      notify: () => undefined,
    }));
  });
  await page.getByRole('button', {name: 'استبدال وحدة', exact: true}).click();
  await page.getByPlaceholder('سبب العيب/الاستبدال').fill('Supplier defect');
  await page.getByRole('button', {name: 'اعتماد الاستبدال', exact: true}).click();
  await expect(page.getByRole('button', {name: 'استعادة الاستبدال', exact: true})).toBeVisible();
});

const isolateModuleShell = async (page: import('@playwright/test').Page) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
};

test('lost response retries the exact aftercare attempt and idempotency key', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    let firstKey = '';
    try {
      await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW', requestValue,
        async (key: string) => { firstKey = key; throw new TypeError('lost response'); });
    } catch { /* expected ambiguous transport failure */ }
    let secondKey = '';
    const recovered = await runAdminAftercareMutation(client as never, order, 'replacement', 'RECOVER_EXISTING', requestValue,
      async (key: string) => { secondKey = key; return {data: resultValue, error: null}; });
    const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
    return {firstKey, secondKey, recovered, state: JSON.parse(localStorage.getItem(stateKey)!)};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.firstKey).toBe(evidence.secondKey);
  expect(evidence.recovered.data).toEqual(success);
  expect(evidence.state.status).toBe('SUCCEEDED');
  expect(evidence.state.generation).toBe(2);
});

test('unknown aftercare outcome blocks changed inputs with zero replacement RPC', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const result = await page.evaluate(async ({actor, order, requestValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    try {
      await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW', requestValue,
        async () => { throw new TypeError('lost response'); });
    } catch { /* expected */ }
    let calls = 0;
    let message = '';
    try {
      await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
        {...requestValue, reason: 'changed'}, async () => {
          calls += 1; return {data: null, error: null};
        });
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    return {calls, message};
  }, {actor: actorId, order: orderId, requestValue: request});
  expect(result.calls).toBe(0);
  expect(result.message).toContain('AFTERCARE_OUTCOME_UNKNOWN');
});

test('transport-shaped error result remains unknown and retains the exact key', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    let firstKey = '';
    await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW', requestValue,
      async (key: string) => {
        firstKey = key;
        return {data: null, error: {code: 'FETCH_ERROR', message: 'network unavailable'}};
      });
    let changedCalls = 0;
    let changedMessage = '';
    try {
      await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
        {...requestValue, reason: 'changed after ambiguous result'}, async () => {
          changedCalls += 1;
          return {data: resultValue, error: null};
        });
    } catch (error) {
      changedMessage = error instanceof Error ? error.message : String(error);
    }
    let retryKey = '';
    const recovered = await runAdminAftercareMutation(client as never, order, 'replacement',
      'RECOVER_EXISTING', requestValue, async (key: string) => {
        retryKey = key;
        return {data: resultValue, error: null};
      });
    return {firstKey, retryKey, changedCalls, changedMessage, recovered};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.changedCalls).toBe(0);
  expect(evidence.changedMessage).toContain('AFTERCARE_OUTCOME_UNKNOWN');
  expect(evidence.retryKey).toBe(evidence.firstKey);
  expect(evidence.recovered.data).toEqual(success);
});

test('explicit new intent with identical inputs creates a distinct attempt and key', async ({page}) => {
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    const keys: string[] = [];
    await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
      requestValue, async (key: string) => { keys.push(key); return {data: resultValue, error: null}; });
    await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
      requestValue, async (key: string) => { keys.push(key); return {data: resultValue, error: null}; });
    return {keys};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.keys).toHaveLength(2);
  expect(evidence.keys[0]).not.toBe(evidence.keys[1]);
});

test('post-RPC full-identity CAS rejects a concurrently substituted request', async ({page}) => {
  await installTwoTabDiagnostics(page.context());
  await isolateModuleShell(page);
  await page.goto(adminBaseUrl);
  const evidence = await page.evaluate(async ({actor, order, requestValue, resultValue}) => {
    // @ts-expect-error Live Vite module.
    const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
    localStorage.clear();
    const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}};
    let message = '';
    try {
      await runAdminAftercareMutation(client as never, order, 'replacement', 'START_NEW',
        requestValue, async () => {
          const stateKey = Object.keys(localStorage).find((key) => key.includes('phase43-aftercare'))!;
          const state = JSON.parse(localStorage.getItem(stateKey)!);
          state.request = {...state.request, reason: 'substituted after RPC'};
          const canonical = (value: unknown): unknown => Array.isArray(value)
            ? value.map(canonical)
            : value && typeof value === 'object'
              ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonical(entry)]))
              : value;
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
            JSON.stringify(canonical(state.request)),
          ));
          state.requestFingerprint = Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0')).join('');
          localStorage.setItem(stateKey, JSON.stringify(state));
          return {data: resultValue, error: null};
        });
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    return {message};
  }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
  expect(evidence.message).toContain('AFTERCARE_REVIEW_REQUIRED');
  const diagnostics = await page.evaluate(() => (window as typeof window & {
    aftercareDiagnostics?: {events: Array<{kind: string; value: {stack?: string}}>};
  }).aftercareDiagnostics);
  expect(diagnostics?.events.some((event) => event.kind === 'review-required'
    && event.value.stack?.includes('adminAftercareRecovery.ts'))).toBe(true);
});

test('two real Admin tabs share one aftercare RPC and one durable success', async ({browser}, testInfo) => {
  const context = await browser.newContext();
  await installTwoTabDiagnostics(context);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
  const first = await context.newPage();
  const second = await context.newPage();
  try {
    await Promise.all([first.goto(adminBaseUrl), second.goto(adminBaseUrl)]);
    await first.evaluate(() => localStorage.clear());
    await first.evaluate(async ({actor, order, requestValue, resultValue}) => {
      // @ts-expect-error Live Vite module.
      const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
      const global = window as typeof window & {aftercare?: Promise<unknown>; release?: () => void};
      global.aftercare = runAdminAftercareMutation(
        {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}} as never,
        order, 'replacement', 'START_NEW', requestValue, async () => {
          localStorage.setItem('phase43-rpc-count', String(Number(localStorage.getItem('phase43-rpc-count') || 0) + 1));
          await new Promise<void>((resolve) => { global.release = resolve; });
          return {data: resultValue, error: null};
        });
    }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
    await expect.poll(() => first.evaluate(() => Number(localStorage.getItem('phase43-rpc-count') || 0))).toBe(1);
    await second.evaluate(async ({actor, order, requestValue, resultValue}) => {
      // @ts-expect-error Live Vite module.
      const {runAdminAftercareMutation} = await import('/src/services/supabase/adminAftercareRecovery.ts');
      const global = window as typeof window & {aftercare?: Promise<unknown>};
      global.aftercare = runAdminAftercareMutation(
        {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}} as never,
        order, 'replacement', 'RECOVER_EXISTING', requestValue, async () => {
          localStorage.setItem('phase43-rpc-count', String(Number(localStorage.getItem('phase43-rpc-count') || 0) + 1));
          return {data: resultValue, error: null};
        });
    }, {actor: actorId, order: orderId, requestValue: request, resultValue: success});
    await second.waitForTimeout(100);
    expect(await second.evaluate(() => Number(localStorage.getItem('phase43-rpc-count') || 0))).toBe(1);
    await first.evaluate(() => (window as typeof window & {release?: () => void}).release?.());
    const [left, right] = await Promise.all([
      first.evaluate(() => (window as typeof window & {aftercare?: Promise<unknown>}).aftercare),
      second.evaluate(() => (window as typeof window & {aftercare?: Promise<unknown>}).aftercare),
    ]);
    expect(left).toEqual(right);
    expect(await first.evaluate(() => Number(localStorage.getItem('phase43-rpc-count') || 0))).toBe(1);
  } catch (error) {
    // Attachment failure must not replace the original test failure.
    try {
      const tabs = await Promise.all([first, second].map(async (page, index) => {
        try {
          return {tab: index + 1, diagnostics: await page.evaluate(() =>
            (window as typeof window & {aftercareDiagnostics?: unknown}).aftercareDiagnostics)};
        } catch { return {tab: index + 1, unavailable: true}; }
      }));
      const diagnostic = {project: testInfo.project.name, retry: testInfo.retry,
        browserVersion: browser.version(), tabs};
      await testInfo.attach('aftercare-two-tab-diagnostics', {
        body: Buffer.from(JSON.stringify(diagnostic, null, 2)), contentType: 'application/json',
      });
      console.error('AFTERCARE_TWO_TAB_DIAGNOSTICS', JSON.stringify(diagnostic));
    } catch { /* Preserve the original rejection/assertion. */ }
    throw error;
  } finally { await context.close(); }
});
