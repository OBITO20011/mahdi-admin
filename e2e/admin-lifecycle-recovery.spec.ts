import {expect, test} from '@playwright/test';

const adminBaseUrl = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:4173';
const actorId = '22222222-2222-4222-8222-222222222222';
const orderId = '11111111-1111-4111-8111-111111111111';

test('two real Admin tabs serialize one lifecycle attempt and share durable success', async ({browser}) => {
  const context = await browser.newContext();
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

    await first.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error This URL is resolved by the live Vite browser server.
      const lifecycle = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      const global = window as typeof window & {
        lifecyclePromise?: Promise<unknown>;
        releaseLifecycleRpc?: () => void;
      };
      const request = {reason: 'سبب ثابت'};
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async () => {
          const count = Number(localStorage.getItem('admin-lifecycle-rpc-count') || 0) + 1;
          localStorage.setItem('admin-lifecycle-rpc-count', String(count));
          await new Promise<void>((resolve) => { global.releaseLifecycleRpc = resolve; });
          return {data: {success: true, order_id: order,
            operation_id: '33333333-3333-4333-8333-333333333333', status: 'cancelled',
            reservation_state: 'cancelled', released_reservations: 1},
          error: null};
        },
      };
      global.lifecyclePromise = lifecycle.runCustomerV2AdminAction(
        client as never, order, 'cancel', request,
      );
    }, {actorId, orderId});
    await expect.poll(() => first.evaluate(() =>
      Number(localStorage.getItem('admin-lifecycle-rpc-count') || 0))).toBe(1);

    await second.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error This URL is resolved by the live Vite browser server.
      const lifecycle = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      const global = window as typeof window & {lifecyclePromise?: Promise<unknown>};
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async () => {
          const count = Number(localStorage.getItem('admin-lifecycle-rpc-count') || 0) + 1;
          localStorage.setItem('admin-lifecycle-rpc-count', String(count));
          return {data: {success: true, order_id: order,
            operation_id: '44444444-4444-4444-8444-444444444444', status: 'cancelled',
            reservation_state: 'cancelled', released_reservations: 1},
          error: null};
        },
      };
      global.lifecyclePromise = lifecycle.runCustomerV2AdminAction(
        client as never, order, 'cancel', {reason: 'سبب ثابت'},
      );
    }, {actorId, orderId});
    await second.waitForTimeout(100);
    expect(await second.evaluate(() =>
      Number(localStorage.getItem('admin-lifecycle-rpc-count') || 0))).toBe(1);

    await first.evaluate(() => {
      const global = window as typeof window & {releaseLifecycleRpc?: () => void};
      global.releaseLifecycleRpc?.();
    });
    const [firstResult, secondResult] = await Promise.all([
      first.evaluate(() => (window as typeof window & {lifecyclePromise?: Promise<unknown>}).lifecyclePromise),
      second.evaluate(() => (window as typeof window & {lifecyclePromise?: Promise<unknown>}).lifecyclePromise),
    ]);
    expect(firstResult).toEqual(secondResult);
    expect(await first.evaluate(() =>
      Number(localStorage.getItem('admin-lifecycle-rpc-count') || 0))).toBe(1);
    const state = await first.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.includes('admin:customer-v2-lifecycle'))!;
      return JSON.parse(localStorage.getItem(key)!);
    });
    expect(state.status).toBe('SUCCEEDED');
    expect(state.executionGeneration).toBe(1);
    await second.reload();
    const replay = await second.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      return run({auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async () => { throw new Error('durable success must not send RPC'); }} as never,
      order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    expect(replay).toEqual(firstResult);
  } finally {
    await context.close();
  }
});

test('reload rejects contradictory evidence byte-for-byte with no new RPC', async ({browser}) => {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
  const page = await context.newPage();
  try {
    await page.goto(adminBaseUrl);
    const original = await page.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      localStorage.clear();
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async () => ({data: null, error: {code: 'P0001',
          message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: rejected'}}),
      };
      await run(client as never, order, 'cancel', {reason: 'original'});
      const key = Object.keys(localStorage)[0];
      const state = JSON.parse(localStorage.getItem(key)!);
      state.hadUnknownOutcome = true;
      const raw = JSON.stringify(state);
      localStorage.setItem(key, raw);
      return {key, raw};
    }, {actorId, orderId});
    await page.reload();
    const rejected = await page.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      let calls = 0;
      try {
        await run({auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
          rpc: async () => { calls++; return {data: null, error: null}; }} as never,
        order, 'cancel', {reason: 'corrected'});
        return {calls, error: ''};
      } catch (error) { return {calls, error: String(error)}; }
    }, {actorId, orderId});
    expect(rejected.calls).toBe(0);
    expect(rejected.error).toContain('ADMIN_LIFECYCLE_REVIEW_REQUIRED');
    expect(await page.evaluate((key) => localStorage.getItem(key), original.key)).toBe(original.raw);
  } finally { await context.close(); }
});

test('a second Admin tab times out waiting without RPC, attempt, key, or evidence mutation', async ({browser}) => {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
  const owner = await context.newPage();
  const waiter = await context.newPage();
  try {
    await Promise.all([owner.goto(adminBaseUrl), waiter.goto(adminBaseUrl)]);
    await owner.evaluate(() => localStorage.clear());
    await owner.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      const global = window as typeof window & {ownerPromise?: Promise<unknown>; releaseOwner?: () => void};
      global.ownerPromise = run({
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async (_name: string, params: Record<string, unknown>) => {
          localStorage.setItem('admin-owner-rpc-count', String(
            Number(localStorage.getItem('admin-owner-rpc-count') || 0) + 1));
          localStorage.setItem('admin-owner-key', String(params.p_idempotency_key));
          await new Promise<void>((resolve) => { global.releaseOwner = resolve; });
          return {data: {success: true, order_id: order,
            operation_id: '33333333-3333-4333-8333-333333333333', status: 'cancelled',
            reservation_state: 'cancelled', released_reservations: 1}, error: null};
        },
      } as never, order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    await expect.poll(() => owner.evaluate(() =>
      Number(localStorage.getItem('admin-owner-rpc-count') || 0))).toBe(1);
    const before = await owner.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith('nawasrah:admin:customer-v2-lifecycle:v1:'));
      return {keys, values: keys.map((key) => localStorage.getItem(key)),
        idempotencyKey: localStorage.getItem('admin-owner-key')};
    });

    const result = await waiter.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      let calls = 0;
      try {
        await run({auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
          rpc: async () => { calls++; return {data: null, error: null}; }} as never,
        order, 'cancel', {reason: 'سبب ثابت'});
        return {calls, error: ''};
      } catch (error) { return {calls, error: String(error)}; }
    }, {actorId, orderId});
    expect(result.calls).toBe(0);
    expect(result.error).toContain('ADMIN_LIFECYCLE_LOCK_WAIT_TIMEOUT');
    const after = await waiter.evaluate(() => {
      const keys = Object.keys(localStorage).filter((key) =>
        key.startsWith('nawasrah:admin:customer-v2-lifecycle:v1:'));
      return {keys, values: keys.map((key) => localStorage.getItem(key)),
        idempotencyKey: localStorage.getItem('admin-owner-key'),
        rpcCount: Number(localStorage.getItem('admin-owner-rpc-count') || 0)};
    });
    expect(after.keys).toEqual(before.keys);
    expect(after.values).toEqual(before.values);
    expect(after.idempotencyKey).toBe(before.idempotencyKey);
    expect(after.rpcCount).toBe(1);
    await owner.evaluate(() => {
      (window as typeof window & {releaseOwner?: () => void}).releaseOwner?.();
    });
    await owner.evaluate(() =>
      (window as typeof window & {ownerPromise?: Promise<unknown>}).ownerPromise);
  } finally { await context.close(); }
});

test('owner reload releases the lock and recovery reuses the same attempt key', async ({browser}) => {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
  const owner = await context.newPage();
  const recovery = await context.newPage();
  try {
    await Promise.all([owner.goto(adminBaseUrl), recovery.goto(adminBaseUrl)]);
    await owner.evaluate(() => localStorage.clear());
    await owner.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      (window as typeof window & {ownerPromise?: Promise<unknown>}).ownerPromise = run({
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async (_name: string, params: Record<string, unknown>) => {
          localStorage.setItem('admin-first-key', String(params.p_idempotency_key));
          await new Promise(() => undefined);
        },
      } as never, order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    await expect.poll(() => owner.evaluate(() => localStorage.getItem('admin-first-key'))).not.toBeNull();
    const firstKey = await owner.evaluate(() => localStorage.getItem('admin-first-key'));
    const recovered = recovery.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      return run({auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async (_name: string, params: Record<string, unknown>) => {
          localStorage.setItem('admin-recovery-key', String(params.p_idempotency_key));
          return {data: {success: true, order_id: order,
            operation_id: '33333333-3333-4333-8333-333333333333', status: 'cancelled',
            reservation_state: 'cancelled', released_reservations: 1}, error: null};
        }} as never, order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    await owner.reload();
    expect((await recovered).data.success).toBe(true);
    expect(await recovery.evaluate(() => localStorage.getItem('admin-recovery-key'))).toBe(firstKey);
    const state = await recovery.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.startsWith('nawasrah:admin:customer-v2-lifecycle:v1:'))!;
      return JSON.parse(localStorage.getItem(key)!);
    });
    expect(state.status).toBe('SUCCEEDED');
    expect(state.hadUnknownOutcome).toBe(true);
  } finally { await context.close(); }
});

test('owner tab close releases the lock and preserves same-key unknown-outcome recovery', async ({browser}) => {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<html></html>'});
    return route.continue();
  });
  const owner = await context.newPage();
  const recovery = await context.newPage();
  try {
    await Promise.all([owner.goto(adminBaseUrl), recovery.goto(adminBaseUrl)]);
    await owner.evaluate(() => localStorage.clear());
    await owner.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      (window as typeof window & {ownerPromise?: Promise<unknown>}).ownerPromise = run({
        auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async (_name: string, params: Record<string, unknown>) => {
          localStorage.setItem('admin-close-owner-key', String(params.p_idempotency_key));
          await new Promise(() => undefined);
        },
      } as never, order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    await expect.poll(() => owner.evaluate(() =>
      localStorage.getItem('admin-close-owner-key'))).not.toBeNull();
    const firstKey = await owner.evaluate(() => localStorage.getItem('admin-close-owner-key'));
    const recovered = recovery.evaluate(async ({actorId: actor, orderId: order}) => {
      // @ts-expect-error Live Vite module.
      const {runCustomerV2AdminAction: run} = await import('/src/services/supabase/adminCustomerV2Lifecycle.ts');
      return run({auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: async (_name: string, params: Record<string, unknown>) => {
          localStorage.setItem('admin-close-recovery-key', String(params.p_idempotency_key));
          return {data: {success: true, order_id: order,
            operation_id: '33333333-3333-4333-8333-333333333333', status: 'cancelled',
            reservation_state: 'cancelled', released_reservations: 1}, error: null};
        }} as never, order, 'cancel', {reason: 'سبب ثابت'});
    }, {actorId, orderId});
    await owner.close();
    expect((await recovered).data.success).toBe(true);
    expect(await recovery.evaluate(() =>
      localStorage.getItem('admin-close-recovery-key'))).toBe(firstKey);
  } finally { await context.close(); }
});

test('Web Lock abort/grant boundary has exactly one outcome and never runs a hidden callback', async ({page}) => {
  await page.goto(adminBaseUrl);
  const outcomes = await page.evaluate(async () => {
    const results: Array<{aborted: boolean; callbacks: number; value: string}> = [];
    for (let index = 0; index < 20; index++) {
      const name = `admin-lock-boundary-${index}`;
      let releaseOwner!: () => void;
      let ownerReady!: () => void;
      const ready = new Promise<void>((resolve) => { ownerReady = resolve; });
      const owner = navigator.locks.request(name, async () => {
        ownerReady();
        await new Promise<void>((resolve) => { releaseOwner = resolve; });
      });
      await ready;
      const controller = new AbortController();
      let callbacks = 0;
      let callbackStarted!: () => void;
      let releaseCallback!: () => void;
      const started = new Promise<void>((resolve) => { callbackStarted = resolve; });
      const callbackGate = new Promise<void>((resolve) => { releaseCallback = resolve; });
      const waiter = navigator.locks.request(name, {signal: controller.signal}, async () => {
        callbacks++;
        callbackStarted();
        await callbackGate;
        return 'granted';
      });
      if (index % 2 === 0) {
        controller.abort();
        releaseOwner();
      } else {
        releaseOwner();
        await owner;
        await started;
        controller.abort();
        releaseCallback();
      }
      try {
        results.push({aborted: false, callbacks, value: await waiter});
      } catch (error) {
        results.push({aborted: error instanceof DOMException && error.name === 'AbortError',
          callbacks, value: ''});
      }
      await owner;
    }
    return results;
  });
  for (const [index, outcome] of outcomes.entries()) {
    if (index % 2 === 0) {
      expect(outcome).toEqual({aborted: true, callbacks: 0, value: ''});
    } else {
      expect(outcome).toEqual({aborted: false, callbacks: 1, value: 'granted'});
    }
  }
});
