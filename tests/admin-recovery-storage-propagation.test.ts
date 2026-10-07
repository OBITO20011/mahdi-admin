import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runAdminAftercareMutation} from '../src/services/supabase/adminAftercareRecovery';
import {runCustomerV2AdminAction} from '../src/services/supabase/adminCustomerV2Lifecycle';

const actor = '43210000-0000-4000-8000-000000000001';
const order = '43210000-0000-4000-8000-000000000002';
const replacementResult = {success: true, orderId: order,
  operationId: '43210000-0000-4000-8000-000000000003',
  replacementId: '43210000-0000-4000-8000-000000000004',
  operationalCoordinatorVersion: 403, issuedQuantity: 1,
  replacementCogsInMinorUnits: 100, moneyRefundInMinorUnits: 0, debtReductionInMinorUnits: 0};
const lifecycleResult = {success: true, order_id: order,
  operation_id: '43210000-0000-4000-8000-000000000003',
  status: 'cancelled', reservation_state: 'cancelled', released_reservations: 1};
type RecordValue = Record<string, any>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;

for (const kind of ['aftercare', 'lifecycle'] as const) {
  async function fixture(work: (f: {
    storage: {raw: string | null; reads: number; writes: number;
      onRead?: (reads: number) => void};
    pending: RecordValue; unknown: RecordValue; success: RecordValue;
    result: RecordValue; request: RecordValue;
    run: (invoke: () => Promise<{data: unknown; error: any}>) => Promise<any>;
  }) => Promise<void>) {
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const storage = {raw: null as string | null, reads: 0, writes: 0,
      onRead: undefined as ((reads: number) => void) | undefined,
      getItem() {this.reads += 1; this.onRead?.(this.reads); return this.raw;},
      setItem(_key: string, value: string) {this.writes += 1; this.raw = value;}};
    Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true});
    Object.defineProperty(globalThis, 'navigator', {value: {locks: {
      request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback(),
    }}, configurable: true});
    const request = kind === 'aftercare'
      ? {items: [{sourceKind: 'base_order_item', sourceId: actor, quantity: 1}], reason: 'defect', notes: null}
      : {reason: 'unchanged'};
    const result = kind === 'aftercare' ? replacementResult : lifecycleResult;
    const run = (invoke: () => Promise<{data: unknown; error: any}>) => {
      const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})},
        rpc: invoke} as unknown as SupabaseClient;
      return kind === 'aftercare'
        ? runAdminAftercareMutation(client, order, 'replacement', storage.raw === null ? 'START_NEW' : 'RECOVER_EXISTING', request, invoke)
        : runCustomerV2AdminAction(client, order, 'cancel', request);
    };
    try {
      let pending!: RecordValue;
      await assert.rejects(run(async () => {
        pending = JSON.parse(storage.raw!);
        throw new Error('lost response');
      }), /lost response/u);
      const unknown = JSON.parse(storage.raw!);
      const success = {...pending, status: 'SUCCEEDED', result};
      storage.reads = 0; storage.writes = 0;
      await work({storage, pending, unknown, success, result, request, run});
    } finally {
      if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  }

  test(`${kind}: stale pre-write CAS refresh adopts same-attempt success with no RPC/write`, async () => {
    await fixture(async ({storage, pending, success, result, run}) => {
      storage.raw = JSON.stringify(pending);
      storage.onRead = reads => {if (reads === 2) storage.raw = JSON.stringify(success);};
      let calls = 0;
      const response = await run(async () => {calls++; throw Error('must not invoke');});
      assert.deepEqual(response, {data: result, error: null});
      assert.equal(calls, 0); assert.equal(storage.writes, 0);
    });
  });

  for (const field of ['attemptId', 'request', 'key'] as const) {
    test(`${kind}: pre-write CAS ${field} substitution stays review-required with zero RPC/write`, async () => {
      await fixture(async ({storage, pending, success, run}) => {
        storage.raw = JSON.stringify(pending);
        const corrupted = structuredClone(success);
        if (field === 'request') corrupted.request = {...corrupted.request, reason: 'substituted'};
        else if (field === 'key') corrupted[kind === 'aftercare' ? 'idempotencyKey' : 'key'] += '-different';
        else corrupted.attemptId = '43210000-0000-4000-8000-000000000099';
        storage.onRead = reads => {if (reads === 2) storage.raw = JSON.stringify(corrupted);};
        let calls = 0;
        await assert.rejects(run(async () => {calls++; throw Error('must not invoke');}), /REVIEW_REQUIRED/u);
        assert.equal(calls, 0); assert.equal(storage.writes, 0);
      });
    });
  }

  test(`${kind}: another cryptographically valid attempt cannot replace the observed attempt`, async () => {
    await fixture(async ({storage, pending, success, run}) => {
      const other: RecordValue = {...success, attemptId: '43210000-0000-4000-8000-000000000099'};
      if (kind === 'aftercare') other.idempotencyKey = `phase43:${hash(
        `phase43-aftercare:${actor}:${order}:replacement:${other.intentId}:${other.attemptId}`)}`;
      else other.key = `admin-v2:${hash(`admin-customer-v2:v2:${actor}:${order}:cancel:${other.attemptId}`)}`;
      storage.raw = JSON.stringify(pending);
      storage.onRead = reads => {if (reads === 2) storage.raw = JSON.stringify(other);};
      let calls = 0;
      await assert.rejects(run(async () => {calls++; throw Error('must not invoke');}), /REVIEW_REQUIRED/u);
      assert.equal(calls, 0); assert.equal(storage.writes, 0);
    });
  });

  test(`${kind}: continuously changing CAS is bounded and never calls RPC`, async () => {
    await fixture(async ({storage, pending, unknown, run}) => {
      storage.raw = JSON.stringify(pending);
      storage.onRead = reads => {storage.raw = JSON.stringify(reads % 2 ? pending : unknown);};
      let calls = 0;
      await assert.rejects(run(async () => {calls++; throw Error('must not invoke');}), /REVIEW_REQUIRED/u);
      assert.equal(calls, 0); assert.equal(storage.writes, 0);
      assert.ok(storage.reads <= 7, 'two decision refreshes maximum');
    });
  });

  if (kind === 'aftercare') {
    test('aftercare: START_NEW refresh seeing a new IN_FLIGHT attempt stays outcome-unknown', async () => {
      await fixture(async ({storage, pending, success, request}) => {
        storage.raw = JSON.stringify(success);
        storage.onRead = reads => {if (reads === 2) storage.raw = JSON.stringify(pending);};
        let calls = 0;
        const client = {auth: {getUser: async () => ({data: {user: {id: actor}}, error: null})}} as unknown as SupabaseClient;
        await assert.rejects(runAdminAftercareMutation(client, order, 'replacement', 'START_NEW', request,
          async () => {calls++; throw Error('must not invoke');}), /AFTERCARE_OUTCOME_UNKNOWN/u);
        assert.equal(calls, 0); assert.equal(storage.writes, 0);
      });
    });
  }

  for (const throws of [false, true]) {
    test(`${kind}: post-RPC same-identity success at earlier generation wins (${throws ? 'lost response' : 'response'})`, async () => {
      await fixture(async ({storage, unknown, success, result, run}) => {
        storage.raw = JSON.stringify(unknown);
        let calls = 0;
        const response = await run(async () => {
          calls++;
          const sent = JSON.parse(storage.raw!);
          assert.equal(sent[kind === 'aftercare' ? 'generation' : 'executionGeneration'], 2);
          storage.raw = JSON.stringify(success);
          if (throws) throw Error('lost response');
          return {data: result, error: null};
        });
        assert.deepEqual(response, {data: result, error: null});
        assert.equal(calls, 1); assert.equal(storage.writes, 1, 'only pre-RPC IN_FLIGHT write');
        assert.equal(storage.raw, JSON.stringify(success));
      });
    });
  }

  for (const field of ['request', 'key', 'future-generation', 'invalid-result'] as const) {
    test(`${kind}: post-RPC ${field} mismatch remains review-required`, async () => {
      await fixture(async ({storage, unknown, success, result, run}) => {
        storage.raw = JSON.stringify(unknown);
        await assert.rejects(run(async () => {
          const corrupted = structuredClone(success);
          if (field === 'request') {
            corrupted.request = {...corrupted.request, reason: 'substituted'};
            if (kind === 'aftercare') corrupted.requestFingerprint = hash(JSON.stringify(canonical(corrupted.request)));
          }
          if (field === 'key') corrupted[kind === 'aftercare' ? 'idempotencyKey' : 'key'] += '-different';
          if (field === 'future-generation') corrupted[kind === 'aftercare' ? 'generation' : 'executionGeneration'] = 3;
          if (field === 'invalid-result') corrupted.result = {...result, success: false};
          storage.raw = JSON.stringify(corrupted);
          return {data: result, error: null};
        }), /REVIEW_REQUIRED/u);
        assert.equal(storage.writes, 1, 'no post-RPC mutation after mismatch');
      });
    });
  }
}
