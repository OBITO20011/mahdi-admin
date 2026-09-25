import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Order} from '../src/types';
import {isCustomerV2Order, runCustomerV2AdminAction,
  withAdminActionLock} from '../src/services/supabase/adminCustomerV2Lifecycle';
import {attachHistoricalParcelComposition} from '../src/services/supabase/historicalParcelComposition';

const orderId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const success = (action: 'complete' | 'cancel') => ({success: true, order_id: orderId,
  operation_id: '33333333-3333-4333-8333-333333333333',
  ...(action === 'cancel' ? {status: 'cancelled', reservation_state: 'cancelled', released_reservations: 1}
    : {status: 'completed', payment_method: 'cash', payment_status: 'paid',
      total_in_minor_units: 1000, amount_paid_in_minor_units: 1000,
      remaining_in_minor_units: 0, customer_payment_number: 'CP-1'})});

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

class SerialLockManager {
  private tails = new Map<string, Promise<void>>();
  async request<T>(name: string, options: LockOptions,
    callback: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(name) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(name, tail);
    try {
      if (options.signal?.aborted) throw options.signal.reason;
      if (options.signal) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(options.signal?.reason);
          options.signal?.addEventListener('abort', abort, {once: true});
          previous.then(resolve, reject).finally(() =>
            options.signal?.removeEventListener('abort', abort));
        });
      } else {
        await previous;
      }
    } catch (error) {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
      throw error;
    }
    try { return await callback(); } finally {
      release();
      if (this.tails.get(name) === tail) this.tails.delete(name);
    }
  }
}

const previousNavigator = globalThis.navigator;
test.beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: {locks: new SerialLockManager()}, configurable: true,
  });
});
test.after(() => {
  Object.defineProperty(globalThis, 'navigator', {value: previousNavigator, configurable: true});
});

test('bounded lock wait aborts before grant with zero work or persisted mutation', async () => {
  const previousStorage = globalThis.localStorage;
  const storage = new MemoryStorage();
  storage.setItem('protected-evidence', 'unchanged');
  let callbacks = 0;
  let requests = 0;
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  Object.defineProperty(globalThis, 'navigator', {value: {locks: {
    request: async (_name: string, options: LockOptions, callback: () => Promise<unknown>) => {
      requests++;
      await new Promise<never>((_resolve, reject) => {
        if (options.signal?.aborted) return reject(options.signal.reason);
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {once: true});
      });
      callbacks++;
      return callback();
    },
  }}, configurable: true});
  const startedAt = Date.now();
  try {
    await assert.rejects(
      withAdminActionLock('bounded-timeout', async () => {
        callbacks++;
        localStorage.setItem('protected-evidence', 'mutated');
      }, 20),
      /ADMIN_LIFECYCLE_LOCK_WAIT_TIMEOUT/u,
    );
    assert.equal(requests, 1);
    assert.equal(callbacks, 0, 'the business callback must not start after wait abort');
    assert.equal(storage.getItem('protected-evidence'), 'unchanged');
    assert.ok(Date.now() - startedAt < 1_000, 'test wait must remain bounded and short');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previousStorage, configurable: true});
  }
});

test('grant before timeout clears the wait timer and never aborts in-flight work', async () => {
  let callbacks = 0;
  Object.defineProperty(globalThis, 'navigator', {value: {locks: {
    request: async (_name: string, _options: LockOptions, callback: () => Promise<string>) => {
      callbacks++;
      return callback();
    },
  }}, configurable: true});
  const result = await withAdminActionLock('grant-first', async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return 'completed';
  }, 10);
  assert.equal(result, 'completed');
  assert.equal(callbacks, 1);
});

test('unsupported signal-aware Web Lock fails closed without running business work', async () => {
  let callbacks = 0;
  Object.defineProperty(globalThis, 'navigator', {value: {locks: {
    request: async () => { throw new TypeError('signal option unsupported'); },
  }}, configurable: true});
  await assert.rejects(
    withAdminActionLock('unsupported', async () => { callbacks++; }, 10),
    /ADMIN_LIFECYCLE_LOCK_UNSUPPORTED/u,
  );
  assert.equal(callbacks, 0);
});

function fakeClient(operationType = 'phase3_customer_reservation_v1') {
  const calls: {name: string; params: Record<string, unknown>}[] = [];
  const client = {
    auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
    from(table: string) {
      return {select() { return {eq() { return {single: async () => ({
        data: table === 'orders' ? {operation_id: 'creation-operation'} : {operation_type: operationType},
        error: null,
      })}; }}; }};
    },
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({name, params});
      return {data: success(name === 'cancel_customer_order_v2' ? 'cancel' : 'complete'), error: null};
    },
  } as unknown as SupabaseClient;
  return {client, calls};
}

test('V2 is identified by creation operation type, including Base-only orders', async () => {
  assert.equal(await isCustomerV2Order(fakeClient().client, orderId), true);
  assert.equal(await isCustomerV2Order(fakeClient('legacy_order').client, orderId), false);
});

test('Admin completion and cancellation keep separate durable successful attempts', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const {client, calls} = fakeClient();
    const request = {paymentMethod: 'cash', amountCollectedInMinorUnits: 1000,
      deliveryFeeInMinorUnits: 0, referenceNumber: null, notes: null};
    const first = await runCustomerV2AdminAction(client, orderId, 'complete', request);
    assert.equal(first.data.success, true);
    await runCustomerV2AdminAction(client, orderId, 'complete', {...request});
    assert.deepEqual(calls.map((call) => call.name), ['complete_website_order_with_settlement_v2']);
    assert.equal(storage.length, 1);
    await assert.rejects(
      runCustomerV2AdminAction(client, orderId, 'complete', {...request, amountCollectedInMinorUnits: 2000}),
      /ناجح سابقًا/u,
    );
    assert.equal(calls.length, 1, 'changed payload must not reach the RPC');
    await runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'رفض العميل'});
    assert.equal(calls.at(-1)?.name, 'cancel_customer_order_v2');
    assert.equal(calls.at(-1)?.params.p_reason, 'رفض العميل');
    assert.equal(storage.length, 2, 'completion and cancellation identities remain separate');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('ambiguous response preserves immutable key and request; storage failure sends no RPC', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const {client, calls} = fakeClient();
    let fail = true;
    const rpc = client.rpc.bind(client);
    (client as any).rpc = async (...args: Parameters<typeof rpc>) => {
      if (fail) { fail = false; throw new Error('response lost'); }
      return rpc(...args);
    };
    await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'سبب ثابت'}), /response lost/u);
    assert.equal(storage.length, 1);
    const pending = [...storage.values.values()][0];
    await runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'سبب ثابت'});
    assert.notEqual([...storage.values.values()][0], pending);
    assert.equal(calls.length, 1);
    storage.clear();
    storage.setItem = () => { throw new Error('quota'); };
    await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'سبب ثابت'}), /quota/u);
    assert.equal(calls.length, 1);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('definitive completion and cancellation rejection allow a corrected new attempt', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const action of ['complete', 'cancel'] as const) {
      storage.clear();
      const keys: string[] = [];
      let calls = 0;
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
        rpc: async (name: string, params: Record<string, unknown>) => {
          calls++;
          keys.push(String(params.p_idempotency_key));
          if (calls === 1) return {data: null, error: {code: 'P0001', message:
            action === 'complete'
              ? 'PHASE3_CUSTOMER_OPEN_SHIFT_REQUIRED: Open Shift is required.'
              : 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Order cannot be cancelled.'}};
          return {data: action === 'complete'
            ? {...success(action), payment_method: 'debt', payment_status: 'unpaid',
              amount_paid_in_minor_units: 0, remaining_in_minor_units: 1000}
            : success(action), error: null};
        },
      } as unknown as SupabaseClient;
      const original = action === 'complete'
        ? {paymentMethod: 'cash', amountCollectedInMinorUnits: 1000,
          deliveryFeeInMinorUnits: 0, referenceNumber: null, notes: null}
        : {reason: 'السبب الأول'};
      const corrected = action === 'complete'
        ? {...original, paymentMethod: 'debt', amountCollectedInMinorUnits: 0}
        : {reason: 'السبب المصحح'};
      assert.ok((await runCustomerV2AdminAction(client, orderId, action, original)).error);
      assert.equal((await runCustomerV2AdminAction(client, orderId, action, corrected)).data.success, true);
      assert.equal(calls, 2);
      assert.notEqual(keys[0], keys[1], 'corrected request must be a new logical attempt');
    }
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('unknown and malformed outcomes retain same identity and block changed inputs', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const keys: string[] = [];
    let calls = 0;
    const client = {
      auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
      rpc: async (_name: string, params: Record<string, unknown>) => {
        calls++;
        keys.push(String(params.p_idempotency_key));
        if (calls === 1) throw new Error('response lost');
        return {data: {success: true}, error: null};
      },
    } as unknown as SupabaseClient;
    const request = {reason: 'سبب ثابت'};
    await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', request), /response lost/u);
    await assert.rejects(
      runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'سبب مختلف'}),
      /غير محسومة/u,
    );
    const malformed = await runCustomerV2AdminAction(client, orderId, 'cancel', request);
    assert.equal(malformed.error.code, 'ADMIN_LIFECYCLE_RESPONSE_INVALID');
    assert.deepEqual(keys, [keys[0], keys[0]]);
    const persisted = JSON.parse([...storage.values.values()][0]);
    assert.equal(persisted.status, 'OUTCOME_UNKNOWN');
    assert.equal(persisted.hadUnknownOutcome, true);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('completion and cancellation require their exact success response contracts', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const action of ['complete', 'cancel'] as const) {
      storage.clear();
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
        rpc: async () => ({data: {success: true, order_id: orderId,
          operation_id: '33333333-3333-4333-8333-333333333333',
          status: action === 'complete' ? 'cancelled' : 'completed'}, error: null}),
      } as unknown as SupabaseClient;
      const request = action === 'complete'
        ? {paymentMethod: 'debt', amountCollectedInMinorUnits: 0,
          deliveryFeeInMinorUnits: 0, referenceNumber: null, notes: null}
        : {reason: 'سبب ثابت'};
      const result = await runCustomerV2AdminAction(client, orderId, action, request);
      assert.equal(result.error.code, 'ADMIN_LIFECYCLE_RESPONSE_INVALID');
      assert.equal(JSON.parse([...storage.values.values()][0]).status, 'OUTCOME_UNKNOWN');
    }
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('a definitive-looking retry rejection cannot clear an earlier unknown outcome', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    let calls = 0;
    const client = {
      auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
      rpc: async () => {
        calls++;
        if (calls === 1) throw new Error('timeout after send');
        return {data: null, error: {code: 'P0001',
          message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: Order state changed.'}};
      },
    } as unknown as SupabaseClient;
    const request = {reason: 'سبب ثابت'};
    await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', request), /timeout/u);
    assert.ok((await runCustomerV2AdminAction(client, orderId, 'cancel', request)).error);
    const persisted = JSON.parse([...storage.values.values()][0]);
    assert.equal(persisted.status, 'OUTCOME_UNKNOWN');
    await assert.rejects(
      runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'بديل'}),
      /غير محسومة/u,
    );
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('idempotency conflict and a mismatched SQLSTATE remain outcome-unknown', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const error of [
      {code: 'P0001', message: 'PHASE3_IDEMPOTENCY_CONFLICT: identity unavailable'},
      {code: '42501', message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: permission changed'},
    ]) {
      storage.clear();
      const client = {
        auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
        rpc: async () => ({data: null, error}),
      } as unknown as SupabaseClient;
      const request = {reason: 'سبب ثابت'};
      assert.ok((await runCustomerV2AdminAction(client, orderId, 'cancel', request)).error);
      assert.equal(JSON.parse([...storage.values.values()][0]).status, 'OUTCOME_UNKNOWN');
      await assert.rejects(
        runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'بديل'}),
        /غير محسومة/u,
      );
    }
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('a stale response cannot overwrite a newer durable success generation', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    let release!: (value: unknown) => void;
    const client = {
      auth: {getUser: async () => ({data: {user: {id: actorId}}, error: null})},
      rpc: async () => new Promise((resolve) => { release = resolve; }),
    } as unknown as SupabaseClient;
    const request = {reason: 'سبب ثابت'};
    const pending = runCustomerV2AdminAction(client, orderId, 'cancel', request);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    const [storageKey, raw] = [...storage.values.entries()][0];
    const newer = JSON.parse(raw);
    newer.executionGeneration++;
    newer.status = 'SUCCEEDED';
    newer.result = {...success('cancel'), operation_id: '44444444-4444-4444-8444-444444444444'};
    storage.setItem(storageKey, JSON.stringify(newer));
    release({data: null, error: {code: 'P0001',
      message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: stale rejection'}});
    await assert.rejects(pending, /تغيرت محاولة الطلب/u);
    const final = JSON.parse(storage.getItem(storageKey)!);
    assert.equal(final.status, 'SUCCEEDED');
    assert.equal(final.result.operation_id, '44444444-4444-4444-8444-444444444444');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('shared lock serializes same-input calls and preserves monotonic success', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const {client} = fakeClient();
    const originalRpc = client.rpc.bind(client);
    (client as any).rpc = async (...args: Parameters<typeof originalRpc>) => {
      calls++;
      await gate;
      return originalRpc(...args);
    };
    const request = {reason: 'سبب ثابت'};
    const first = runCustomerV2AdminAction(client, orderId, 'cancel', request);
    const second = runCustomerV2AdminAction(client, orderId, 'cancel', {...request});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, 1, 'second context must wait for the shared action lock');
    release();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left.data.success, true);
    assert.equal(right.data.success, true);
    assert.equal(calls, 1, 'second context returns durable success without another RPC');
    assert.equal(JSON.parse([...storage.values.values()][0]).status, 'SUCCEEDED');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('legacy outcome-less records stay conservative and cannot accept corrected inputs', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const request = {reason: 'سبب قديم'};
    storage.setItem(`nawasrah:admin:customer-v2-lifecycle:v1:${actorId}:${orderId}:cancel`, JSON.stringify({
      version: 1, actorId, orderId, action: 'cancel', key: 'admin-v2:legacy-key', request,
    }));
    const {client, calls} = fakeClient();
    await assert.rejects(
      runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'سبب جديد'}),
      /المحاولة القديمة/u,
    );
    assert.equal(calls.length, 0);
    const raw = [...storage.values.values()][0];
    await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', request), /المحاولة القديمة/u);
    assert.equal(calls.length, 0);
    assert.equal([...storage.values.values()][0], raw);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true});
  }
});

test('contradictory stored states and substituted keys are blocked byte-for-byte before RPC', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const {client, calls} = fakeClient();
    const rpc = client.rpc;
    (client as any).rpc = async () => ({data: null, error: {code: 'P0001',
      message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: rejected'}});
    await runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'original'});
    const [key, original] = [...storage.values.entries()][0];
    (client as any).rpc = rpc;
    for (const mutation of [
      {hadUnknownOutcome: true}, {result: success('cancel')}, {rejectionCode: undefined},
      {status: ['SUCCEEDED']},
      {key: 'admin-v2:substituted'}, {executionGeneration: 0},
      {status: 'SUCCEEDED', result: {...success('cancel'), order_id: actorId}},
    ]) {
      const raw = JSON.stringify({...JSON.parse(original), ...mutation});
      storage.setItem(key, raw);
      await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'corrected'}),
        /ADMIN_LIFECYCLE_REVIEW_REQUIRED/u);
      assert.equal(storage.getItem(key), raw);
      assert.equal(calls.length, 0);
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('post-RPC immutable identity and success evidence substitutions never overwrite evidence', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const mutation of [
      {request: {reason: 'substitution'}}, {key: 'admin-v2:other'}, {actorId: orderId},
      {status: 'SUCCEEDED', result: {...success('cancel'), order_id: actorId}},
      {status: 'SUCCEEDED', result: {...success('cancel'), operation_id: '44444444-4444-4444-8444-444444444444'}},
    ]) {
      for (const throws of [false, true]) {
        // A matching valid success is allowed to survive a late failure.
        if (throws && mutation.status === 'SUCCEEDED' && mutation.result?.order_id === orderId) continue;
        storage.clear();
        let protectedRaw = '';
        const {client} = fakeClient();
        (client as any).rpc = async () => {
          const [key, raw] = [...storage.values.entries()][0];
          protectedRaw = JSON.stringify({...JSON.parse(raw), ...mutation});
          storage.setItem(key, protectedRaw);
          if (throws) throw new Error('transport failed');
          return {data: success('cancel'), error: null};
        };
        await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'original'}),
          /ADMIN_LIFECYCLE_REVIEW_REQUIRED/u);
        assert.equal([...storage.values.values()][0], protectedRaw);
      }
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('every required financial/cancellation response field is independently checked', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const action of ['complete', 'cancel'] as const) {
      const fields = action === 'complete'
        ? ['total_in_minor_units', 'amount_paid_in_minor_units', 'remaining_in_minor_units',
          'payment_method', 'payment_status', 'customer_payment_number']
        : ['reservation_state', 'released_reservations'];
      for (const field of fields) {
        storage.clear();
        const data: Record<string, unknown> = success(action);
        delete data[field];
        const {client} = fakeClient();
        (client as any).rpc = async () => ({data, error: null});
        const request = action === 'cancel' ? {reason: null} : {paymentMethod: 'cash',
          amountCollectedInMinorUnits: 1000, deliveryFeeInMinorUnits: 0, referenceNumber: null, notes: null};
        const result = await runCustomerV2AdminAction(client, orderId, action, request);
        assert.equal(result.error.code, 'ADMIN_LIFECYCLE_RESPONSE_INVALID', field);
        assert.equal(JSON.parse([...storage.values.values()][0]).status, 'OUTCOME_UNKNOWN');
      }
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('contradictory data plus rejection and embedded error identities cannot authorize replacement', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const response of [
      {data: success('cancel'), error: {code: 'P0001', message: 'PHASE3_CUSTOMER_LIFECYCLE_INVALID: mixed'}},
      {data: null, error: {code: 'P0001', message: 'OTHER_ERROR: PHASE3_CUSTOMER_LIFECYCLE_INVALID: nested'}},
    ]) {
      storage.clear();
      let calls = 0;
      const {client} = fakeClient();
      (client as any).rpc = async () => { calls++; return response; };
      await runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'original'});
      const raw = [...storage.values.values()][0];
      assert.equal(JSON.parse(raw).status, 'OUTCOME_UNKNOWN');
      await assert.rejects(runCustomerV2AdminAction(client, orderId, 'cancel', {reason: 'new'}), /غير محسومة/u);
      assert.equal(calls, 1);
      assert.equal([...storage.values.values()][0], raw);
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('settlement arithmetic and submitted payment identity cannot be replaced by a plausible success', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    for (const mutation of [
      {remaining_in_minor_units: 1}, {total_in_minor_units: -1},
      {amount_paid_in_minor_units: '1000'}, {payment_method: 'cliq'},
      {payment_status: 'unpaid'}, {payment_method: ['cash']},
      {total_in_minor_units: Number.MAX_SAFE_INTEGER + 1},
    ]) {
      storage.clear();
      const {client} = fakeClient();
      (client as any).rpc = async () => ({data: {...success('complete'), ...mutation}, error: null});
      try {
        const result = await runCustomerV2AdminAction(client, orderId, 'complete', {paymentMethod: 'cash',
          amountCollectedInMinorUnits: 1000, deliveryFeeInMinorUnits: 0, referenceNumber: null, notes: null});
        assert.equal(result.error.code, 'ADMIN_LIFECYCLE_RESPONSE_INVALID');
      } catch (error) {
        assert.match(String(error), /ADMIN_LIFECYCLE_REVIEW_REQUIRED/u);
      }
      const persisted = JSON.parse([...storage.values.values()][0]);
      assert.ok(['IN_FLIGHT', 'OUTCOME_UNKNOWN'].includes(persisted.status));
      assert.equal(persisted.result, undefined);
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('caller mutation across authentication await cannot replace submitted inputs', async () => {
  const previous = globalThis.localStorage;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
  try {
    const {client, calls} = fakeClient();
    const request = {reason: 'original'};
    const pending = runCustomerV2AdminAction(client, orderId, 'cancel', request);
    request.reason = 'changed';
    await pending;
    assert.equal(calls[0].params.p_reason, 'original');
    assert.equal(JSON.parse([...storage.values.values()][0]).request.reason, 'original');
  } finally { Object.defineProperty(globalThis, 'localStorage', {value: previous, configurable: true}); }
});

test('historical parcel instances retain their own component snapshots and do not alter base lines', () => {
  const base = {id: 'base-line', commercialLineKind: 'base_unit', quantity: 2};
  const parcel = {id: 'parcel-line', commercialLineKind: 'configurable_parcel', quantity: 2};
  const order = {items: [base, parcel]} as unknown as Order;
  const instances = [1, 2].map((number) => ({id: `instance-${number}`, order_item_id: 'parcel-line',
    instance_sequence: number, units_per_parcel_snapshot: 5, parcel_unit_name_snapshot: 'طرد'}));
  const components = [
    {id: 'a', parcel_instance_id: 'instance-1', product_id: 'flavor-a', base_quantity: 2,
      product_name_snapshot: 'حار تاريخي', sku_snapshot: 'HOT-OLD', base_unit_name_snapshot: 'باكيت'},
    {id: 'b', parcel_instance_id: 'instance-1', product_id: 'flavor-b', base_quantity: 3,
      product_name_snapshot: 'جبنة تاريخي', sku_snapshot: 'CHEESE-OLD', base_unit_name_snapshot: 'باكيت'},
    {id: 'c', parcel_instance_id: 'instance-2', product_id: 'flavor-a', base_quantity: 5,
      product_name_snapshot: 'حار تاريخي', sku_snapshot: 'HOT-OLD', base_unit_name_snapshot: 'باكيت'},
  ];
  attachHistoricalParcelComposition(order, instances, components);
  assert.equal(order.items[0].parcelInstances, undefined);
  assert.deepEqual(order.items[1].parcelInstances?.map((instance) => instance.components.map((component) => component.quantity)), [[2, 3], [5]]);
  assert.equal(order.items[1].parcelInstances?.[0].components[0].name, 'حار تاريخي');
  assert.throws(() => attachHistoricalParcelComposition(order, instances, components.slice(1)), /غير متطابقة/u);
});

test('service entrypoints route cancellation and settlement without changing legacy RPCs', () => {
  const source = readFileSync(new URL('../src/services/supabase/orders.service.ts', import.meta.url), 'utf8');
  assert.match(source, /cancelOrderInSupabase[\s\S]*isCustomerV2Order[\s\S]*runCustomerV2AdminAction[\s\S]*'update_order_status'/u);
  assert.match(source, /completeWebsiteOrderWithSettlementInSupabase[\s\S]*isCustomerV2Order[\s\S]*runCustomerV2AdminAction[\s\S]*'complete_website_order_with_settlement'/u);
  assert.match(source, /if \(newStatus === 'cancelled'\) return cancelOrderInSupabase/u);
  const legacyPayment = source.split('export async function completeWebsiteOrderWithPaymentInSupabase(')[1]
    .split('export async function cancelOrderInSupabase(')[0];
  const returnPath = source.split('export async function returnCompletedWebsiteOrderInSupabase(')[1]
    .split('export async function updateOrderStatusInSupabase(')[0];
  assert.match(legacyPayment, /isCustomerV2Order\(supabase, orderId\)/u);
  assert.doesNotMatch(returnPath, /isCustomerV2Order\(supabase, orderId\)/u);
});
