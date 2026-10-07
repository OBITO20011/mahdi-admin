import assert from 'node:assert/strict';
import test from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {runPosV2Attempt, readPosV2Recovery, inspectOrCancelPosV2Attempt} from '../src/services/supabase/posV2Recovery';
import {posV2ResultMatches, posV2RequestValid} from '../src/services/supabase/posV2Validation';
import {posCartLines, posStockDemand, posWarehouseAvailable, type PosCartItem} from '../src/features/pos/posV2Cart';
import type {Product} from '../src/types';
import type {CreatePosSaleV2Input} from '../src/services/supabase/posV2.service';

const actor = '11111111-1111-4111-8111-111111111111';
const input = (): CreatePosSaleV2Input => ({warehouseId: '22222222-2222-4222-8222-222222222222',
  branchId: '33333333-3333-4333-8333-333333333333', paymentMethod: 'cash',
  lines: [{commercial_line_kind: 'base_unit', product_id: '44444444-4444-4444-8444-444444444444', base_quantity: 1}],
  discountInMinorUnits: 0, amountReceivedInMinorUnits: 1000, idempotencyKey: 'ignored-until-captured'});
const success = () => ({success: true, operationId: '55555555-5555-4555-8555-555555555555',
  orderId: '66666666-6666-4666-8666-666666666666', orderNumber: 'POS-D2',
  warehouseId: input().warehouseId, branchId: input().branchId, customerName: 'زبون نقدي',
  idempotentReplay: false, subtotalInMinorUnits: 1000, discountInMinorUnits: 0, totalInMinorUnits: 1000,
  amountPaidInMinorUnits: 1000, changeDueInMinorUnits: 0, paymentMethod: 'cash', paymentStatus: 'paid',
  items: [{id: '77777777-7777-4777-8777-777777777777', productId: '44444444-4444-4444-8444-444444444444',
    productName: 'منتج', sku: 'D2', salePackage: 'قطعة', commercialLineKind: 'base_unit', quantity: 1,
    baseQuantity: 1, unitsPerSalePackage: 1, unitPriceInMinorUnits: 1000, lineTotalInMinorUnits: 1000,
    allocatedDiscountInMinorUnits: 0, netRefundableAmountInMinorUnits: 1000, cogsInMinorUnits: 300,
    profitInMinorUnits: 700, parcelInstances: []}]});
const storage = new Map<string, string>();
function setup(rpc: (name: string, params: Record<string, unknown>) => Promise<unknown>, auth?: () => Promise<unknown>) {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v),
  }});
  let chain = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {locks: {
    request: (_: string, options: {signal: AbortSignal}, work: () => Promise<unknown>) => {
      const pending = chain.then(() => {if (options.signal.aborted) throw new DOMException('', 'AbortError'); return work();});
      chain = pending.then(() => undefined, () => undefined); return pending;
    },
  }}});
  return {auth: {getUser: auth || (async () => ({data: {user: {id: actor}}, error: null}))}, rpc} as unknown as SupabaseClient;
}
test('POS success must bind financial arithmetic and each requested item', () => {
  assert.equal(posV2ResultMatches(input(), success()), true);
  for (const mutate of [(r: ReturnType<typeof success>) => {r.items[0].quantity = 99;},
    (r: ReturnType<typeof success>) => {r.totalInMinorUnits = 999;},
    (r: ReturnType<typeof success>) => {r.warehouseId = actor;},
    (r: ReturnType<typeof success>) => {r.items[0].productId = actor;},
    (r: ReturnType<typeof success>) => {r.items = [];},
    (r: ReturnType<typeof success>) => {r.amountPaidInMinorUnits = -1;}]) {
    const r = success(); mutate(r); assert.equal(posV2ResultMatches(input(), r), false);
  }
});
test('lost response, reload recovery and committed replay preserve the original key and request', async () => {
  const requests: Record<string, unknown>[] = [];
  const client = setup(async (name, params) => {
    assert.equal(name, 'create_pos_sale_v2'); requests.push(structuredClone(params));
    return requests.length === 1 ? {data: null, error: {message: 'network timeout'}}
      : {data: {...success(), idempotentReplay: true}, error: null};
  });
  const first = await runPosV2Attempt(client, actor, 'START_NEW', input());
  assert.equal(first.ok, false); assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
  const recovered = await runPosV2Attempt(client, actor, 'RECOVER_EXISTING'); assert.equal(recovered.ok, true);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal((await runPosV2Attempt(client, actor, 'RECOVER_EXISTING')).ok, true);
  assert.deepEqual(requests[1], requests[2]);
});
test('unknown history is never cleared by a later definitive-looking rejection', async () => {
  let calls = 0;
  const client = setup(async () => (++calls === 1
    ? {data: null, error: {message: 'network timeout'}}
    : {data: null, error: {code: 'P0001', message: 'PHASE3_POS_OPEN_SHIFT_REQUIRED: closed'}}));
  await runPosV2Attempt(client, actor, 'START_NEW', input());
  await runPosV2Attempt(client, actor, 'RECOVER_EXISTING');
  assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
});
test('request cannot mutate during auth; stale concurrent START_NEW cannot send a second sale', async () => {
  let release!: () => void; const wait = new Promise<void>(resolve => {release = resolve;});
  let authCalls = 0, rpcCalls = 0;
  const client = setup(async (_, params) => {
    rpcCalls++; assert.equal((params.p_lines as Array<{base_quantity: number}>)[0].base_quantity, 1);
    return {data: success(), error: null};
  }, async () => {if (++authCalls === 1) await wait; return {data: {user: {id: actor}}, error: null};});
  const request = input(); const running = runPosV2Attempt(client, actor, 'START_NEW', request);
  if (request.lines[0].commercial_line_kind === 'base_unit') request.lines[0].base_quantity = 99;
  release(); assert.equal((await running).ok, true); assert.equal(rpcCalls, 1);
  storage.clear(); rpcCalls = 0;
  const attempts = await Promise.allSettled([runPosV2Attempt(client, actor, 'START_NEW', input()),
    runPosV2Attempt(client, actor, 'START_NEW', input())]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1); assert.equal(rpcCalls, 1);
});
test('malformed success and post-RPC storage substitution cannot persist SUCCEEDED', async () => {
  const client = setup(async () => ({data: {...success(), amountPaidInMinorUnits: 99}, error: null}));
  await runPosV2Attempt(client, actor, 'START_NEW', input());
  assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  const tampered = setup(async () => {const [k, raw] = [...storage][0];
    const a = JSON.parse(raw); a.request.lines[0].base_quantity = 99; storage.set(k, JSON.stringify(a));
    return {data: success(), error: null};});
  await assert.rejects(runPosV2Attempt(tampered, actor, 'START_NEW', input()));
  assert.notEqual(readPosV2Recovery(actor)?.status, 'SUCCEEDED');
});

test('an explicit new sale after success gets a new key, while recovery keeps the old key', async () => {
  const keys: unknown[] = [];
  const client = setup(async (_, params) => {keys.push(params.p_idempotency_key);
    return {data: {...success(), idempotentReplay: keys.length === 2}, error: null};});
  assert.equal((await runPosV2Attempt(client, actor, 'START_NEW', input())).ok, true);
  assert.equal((await runPosV2Attempt(client, actor, 'RECOVER_EXISTING')).ok, true);
  assert.equal((await runPosV2Attempt(client, actor, 'START_NEW', input())).ok, true);
  assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
});

test('contradictory data plus a rejection is unknown, never permission for a new sale', async () => {
  const client = setup(async () => ({data: success(), error: {
    code: 'P0001', message: 'PHASE3_POS_OPEN_SHIFT_REQUIRED: closed'}}));
  const outcome = await runPosV2Attempt(client, actor, 'START_NEW', input());
  assert.equal(outcome.ok, false); assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
});

test('wrong actor and failed durable storage cannot reach the business RPC', async () => {
  let calls = 0;
  const client = setup(async () => {calls++; return {data: success(), error: null};},
    async () => ({data: {user: {id: input().warehouseId}}, error: null}));
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
  assert.equal(calls, 0);
  const valid = setup(async () => {calls++; return {data: success(), error: null};});
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: () => null, setItem: () => {throw new DOMException('Full', 'QuotaExceededError');}}});
  await assert.rejects(runPosV2Attempt(valid, actor, 'START_NEW', input()));
  assert.equal(calls, 0);
});

test('equal quantity and cost cannot mask substitution of one requested product', () => {
  const request = input();
  request.lines.push({...request.lines[0], product_id: actor} as CreatePosSaleV2Input['lines'][number]);
  request.amountReceivedInMinorUnits = 2000;
  const result = success();
  result.subtotalInMinorUnits = result.totalInMinorUnits = result.amountPaidInMinorUnits = 2000;
  result.items.push({...result.items[0], id: '88888888-8888-4888-8888-888888888888', productId: actor});
  assert.equal(posV2ResultMatches(request, result), true);
  result.items[1].productId = result.items[0].productId;
  assert.equal(posV2ResultMatches(request, result), false);
});

test('malformed request identity, tender and quantities fail before RPC', async () => {
  for (const mutation of [(r: CreatePosSaleV2Input) => {r.warehouseId = '';},
    (r: CreatePosSaleV2Input) => {r.paymentMethod = 'debt';},
    (r: CreatePosSaleV2Input) => {r.discountInMinorUnits = -1;},
    (r: CreatePosSaleV2Input) => {r.lines = [];},
    (r: CreatePosSaleV2Input) => {r.lines = [{commercial_line_kind: 'base_unit', product_id: actor, base_quantity: 0}];}]) {
    const r = input(); mutation(r); assert.equal(posV2RequestValid(r), false);
    let calls = 0; const client = setup(async () => {calls++; return {data: success(), error: null};});
    await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', r)); assert.equal(calls, 0);
  }
});

test('cart capacity is physical and warehouse-scoped across all three line modes', () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const cart = [
    {quantity: 2, v2Line: {commercial_line_kind: 'base_unit', product_id: id, base_quantity: 99}},
    {quantity: 1, v2Line: {commercial_line_kind: 'legacy_single_sku_parcel', product_id: id, parcel_quantity: 99, units_per_parcel: 3}},
    {quantity: 1, v2Line: {commercial_line_kind: 'configurable_parcel', family_product_id: actor,
      parcel_configuration_id: actor, configuration_revision: 1,
      parcel_instances: [{components: [{product_id: id, base_quantity: 4}]}]}},
  ] as PosCartItem[];
  assert.equal(posStockDemand(cart).get(id), 9);
  const captured = posCartLines(cart);
  if (cart[2].v2Line.commercial_line_kind === 'configurable_parcel') cart[2].v2Line.parcel_instances[0].components[0].base_quantity = 99;
  assert.equal((captured[2] as Extract<CreatePosSaleV2Input['lines'][number], {commercial_line_kind: 'configurable_parcel'}>)
    .parcel_instances[0].components[0].base_quantity, 4);
  const product = {availableQuantity: 999, warehouseId: actor, warehouseBalances: [{
    warehouseId: input().warehouseId, availableQuantity: 5}]} as Product;
  assert.equal(posWarehouseAvailable(product, input().warehouseId), 5);
  assert.equal(posWarehouseAvailable(product, input().branchId), 0);
});

test('parcel success must preserve every requested composition and immutable instance identity', () => {
  const request = input(); request.lines = [{commercial_line_kind: 'configurable_parcel', family_product_id: actor,
    parcel_configuration_id: actor, configuration_revision: 3,
    parcel_instances: [{components: [{product_id: input().warehouseId, base_quantity: 1}]}]}];
  const result = success();
  const item = {...result.items[0], productId: actor, commercialLineKind: 'configurable_parcel', parcelInstances: [{
    instance_id: input().branchId, configuration_revision: 3, units_per_parcel: 1,
    components: [{component_id: input().warehouseId, product_id: input().warehouseId, base_quantity: 1}],
  }]};
  const sale = {...result, items: [item]};
  assert.equal(posV2ResultMatches(request, sale), true);
  item.parcelInstances[0].components[0].product_id = actor;
  assert.equal(posV2ResultMatches(request, sale), false);
  item.parcelInstances[0].components[0].product_id = input().warehouseId;
  item.parcelInstances[0].configuration_revision = 4;
  assert.equal(posV2ResultMatches(request, sale), false);
});

const pendingBytes = () => [...storage.values()][0];
const proofFor = (params: Record<string, unknown>, state: string) => ({state, actorId: actor,
  idempotencyKey: params.p_idempotency_key, requestFingerprint: params.p_request_fingerprint});
test('server ABSENT alone never clears unknown history or authorizes START_NEW', async () => {
  const calls: string[] = [];
  const client = setup(async (name, params) => {calls.push(name);
    return name === 'create_pos_sale_v2' ? {data: null, error: {message: 'timeout'}}
      : {data: proofFor(params, 'ABSENT'), error: null};});
  await runPosV2Attempt(client, actor, 'START_NEW', input());
  const before = pendingBytes();
  assert.equal(await inspectOrCancelPosV2Attempt(client, actor), 'ABSENT');
  assert.equal(pendingBytes(), before);
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
  assert.deepEqual(calls, ['create_pos_sale_v2', 'get_pos_sale_attempt_state_v1']);
});
test('explicit cancellation preserves the attempt and proof; new sale gets a different key', async () => {
  const keys: unknown[] = []; let submitted = 0;
  const client = setup(async (name, params) => {
    if (name === 'create_pos_sale_v2') {keys.push(params.p_idempotency_key);
      return ++submitted === 1 ? {data: null, error: {message: 'timeout'}} : {data: success(), error: null};}
    if (name === 'get_pos_sale_attempt_state_v1') return {data: proofFor(params, 'ABSENT'), error: null};
    assert.equal(name, 'cancel_uncommitted_pos_sale_attempt_v1'); assert.equal(params.p_confirmed, true);
    return {data: {...proofFor(params, 'CANCELLED_UNCOMMITTED'), cancellationId: actor}, error: null};
  });
  await runPosV2Attempt(client, actor, 'START_NEW', input()); const previous = JSON.parse(pendingBytes());
  assert.equal(await inspectOrCancelPosV2Attempt(client, actor, true), 'CANCELLED_UNCOMMITTED');
  const cancelled = JSON.parse(pendingBytes());
  assert.equal(cancelled.attemptId, previous.attemptId); assert.deepEqual(cancelled.request, previous.request);
  assert.equal(cancelled.generation, previous.generation); assert.equal(cancelled.hadUnknown, true);
  assert.equal(cancelled.cancellationProof.requestFingerprint, previous.fingerprint);
  await assert.rejects(runPosV2Attempt(client, actor, 'RECOVER_EXISTING'));
  assert.equal((await runPosV2Attempt(client, actor, 'START_NEW', input())).ok, true);
  assert.notEqual(keys[0], keys[1]);
});
test('server EXISTS remains recovery-only even if cancellation was confirmed', async () => {
  let cancelCalls = 0, submissions = 0;
  const client = setup(async (name, params) => {
    if (name === 'create_pos_sale_v2') return ++submissions === 1 ? {data: null, error: {message: 'timeout'}}
      : {data: {...success(), idempotentReplay: true}, error: null};
    if (name === 'cancel_uncommitted_pos_sale_attempt_v1') cancelCalls++;
    return {data: proofFor(params, 'EXISTS'), error: null};});
  await runPosV2Attempt(client, actor, 'START_NEW', input()); const before = pendingBytes();
  assert.equal(await inspectOrCancelPosV2Attempt(client, actor, true), 'EXISTS');
  assert.equal(cancelCalls, 0); assert.equal(pendingBytes(), before);
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
  assert.equal((await runPosV2Attempt(client, actor, 'RECOVER_EXISTING')).ok, true);
});
test('lost cancellation response preserves unknown; reinspection can recover its durable proof', async () => {
  let cancelled = false;
  const client = setup(async (name, params) => {
    if (name === 'create_pos_sale_v2') return {data: null, error: {message: 'timeout'}};
    if (name === 'get_pos_sale_attempt_state_v1') return {data: proofFor(params,
      cancelled ? 'CANCELLED_UNCOMMITTED' : 'ABSENT'), error: null};
    if (!cancelled) {cancelled = true; return {data: null, error: {message: 'timeout after cancellation'}};}
    return {data: {...proofFor(params, 'CANCELLED_UNCOMMITTED'), cancellationId: actor}, error: null};});
  await runPosV2Attempt(client, actor, 'START_NEW', input()); const before = pendingBytes();
  await assert.rejects(inspectOrCancelPosV2Attempt(client, actor, true)); assert.equal(pendingBytes(), before);
  await assert.rejects(runPosV2Attempt(client, actor, 'START_NEW', input()));
  assert.equal(await inspectOrCancelPosV2Attempt(client, actor, true), 'CANCELLED_UNCOMMITTED');
});
test('wrong actor/key/fingerprint/cancellation identity and contradictory proof fail closed', async () => {
  for (const field of ['actorId', 'idempotencyKey', 'requestFingerprint', 'cancellationId', 'state']) {
    const client = setup(async (name, params) => {
      if (name === 'create_pos_sale_v2') return {data: null, error: {message: 'timeout'}};
      if (name === 'get_pos_sale_attempt_state_v1') return {data: proofFor(params, 'ABSENT'), error: null};
      const proof = {...proofFor(params, 'CANCELLED_UNCOMMITTED'), cancellationId: actor, [field]: 'wrong'};
      return {data: proof, error: null};});
    await runPosV2Attempt(client, actor, 'START_NEW', input()); const before = pendingBytes();
    await assert.rejects(inspectOrCancelPosV2Attempt(client, actor, true)); assert.equal(pendingBytes(), before);
  }
});
test('post-read CAS substitution and a sale committing between read and cancel cannot clear history', async () => {
  for (const substitute of [false, true]) {
    const client = setup(async (name, params) => {
      if (name === 'create_pos_sale_v2') return {data: null, error: {message: 'timeout'}};
      if (name === 'get_pos_sale_attempt_state_v1') {
        if (substitute) {const [key, raw] = [...storage][0];
          storage.set(key, JSON.stringify({...JSON.parse(raw), generation: 10}));}
        return {data: proofFor(params, 'ABSENT'), error: null};}
      return {data: null, error: {code: 'P0001', message: 'PACKAGE_D_POS_ATTEMPT_COMMITTED'}};
    });
    await runPosV2Attempt(client, actor, 'START_NEW', input());
    await assert.rejects(inspectOrCancelPosV2Attempt(client, actor, true));
    assert.equal(readPosV2Recovery(actor)?.status, 'OUTCOME_UNKNOWN');
  }
});
