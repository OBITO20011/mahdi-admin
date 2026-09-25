import assert from 'node:assert/strict';
import test from 'node:test';
import { CartItem } from '../src/types/catalog';
import { GuestOrderReceipt, PersistedCheckoutAttemptV2 } from '../src/types/checkout';
import {
  CART_STORAGE_KEY,
} from '../src/utils/cart';
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  COMMERCE_JOURNAL_STORAGE_KEY,
  CommerceLockManager,
  CommerceStorageRepository,
  RECONCILIATION_EVIDENCE_STORAGE_KEY,
  SERVER_SUCCESS_STORAGE_KEY,
} from '../src/services/commerceStorage';
import { CheckoutRecoveryCoordinator } from '../src/services/checkoutRecoveryCoordinator';
import { buildGuestOrderV2Lines } from '../src/utils/checkout';

class ImmediateLocks implements CommerceLockManager {
  async request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    return callback();
  }
}

class SerialLocks implements CommerceLockManager {
  private tails = new Map<string, Promise<void>>();

  async request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(name, previous.then(() => current));
    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.tails.get(name) === current) this.tails.delete(name);
    }
  }
}

class ControlledStorage {
  values = new Map<string, string>();
  failKeyOnce: string | null = null;
  failRemoveKeyOnce: string | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failKeyOnce === key) {
      this.failKeyOnce = null;
      throw new DOMException('transient audit failure', 'QuotaExceededError');
    }
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemoveKeyOnce === key) {
      this.failRemoveKeyOnce = null;
      throw new DOMException('transient cleanup failure', 'QuotaExceededError');
    }
    this.values.delete(key);
  }
}

const item: CartItem = {
  schemaVersion: 2,
  localLineId: 'line-original',
  localRevision: 1,
  commercialLineKind: 'base_unit',
  productId: '11111111-1111-4111-8111-111111111111',
  sku: 'BASE',
  nameAr: 'باكيت',
  imageUrl: '',
  saleUnitNameAr: 'باكيت',
  unitsPerSalePackage: 1,
  unitPriceInMinorUnits: 250,
  quantity: 1,
  maxAvailablePackages: 20,
};

const receipt: GuestOrderReceipt = {
  success: true,
  id: 'order-1',
  orderNumber: 'ORD-1',
  customerId: 'customer-1',
  customerAddressId: 'address-1',
  customerReused: false,
  idempotentReplay: false,
  subtotalInMinorUnits: 250,
  discountInMinorUnits: 0,
  totalInMinorUnits: 250,
  deliveryFeeInMinorUnits: 0,
  deliveryZone: 'inside_ramtha',
  promotionCode: '',
  status: 'new',
  paymentMethod: 'cash_on_delivery',
  message: 'ok',
};

function preparedAttempt(): PersistedCheckoutAttemptV2 {
  return {
    version: 2,
    revision: 1,
    attemptId: 'attempt-1',
    submissionGeneration: 'generation-1',
    serverState: 'PREPARED',
    reconciliationState: 'NOT_STARTED',
    idempotencyKey: 'key-1',
    clientSessionId: 'session-1',
    request: {
      contractVersion: 'phase3-customer-reservation-v2',
      idempotencyKey: 'key-1',
      clientSessionId: 'session-1',
      customer: {
        fullName: 'عميل', phone: '0791234567', governorate: 'إربد', city: 'الرمثا',
        area: 'الوسط', street: '', building: '', addressNotes: '', googleMapsUrl: '',
        latitude: null, longitude: null, customerNotes: '',
      },
      items: [{
        commercial_line_kind: 'base_unit',
        product_id: item.productId,
        base_quantity: 1,
        expected_unit_price_in_minor_units: 250,
      }],
      paymentMethod: 'cash_on_delivery',
      deliveryZone: 'inside_ramtha',
    },
    submittedItems: [item],
    createdAt: 1,
    updatedAt: 1,
  };
}

async function reconcileFixture(storage: ControlledStorage) {
  const repository = new CommerceStorageRepository(
    storage as unknown as Storage,
    new ImmediateLocks()
  );
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  const result = await repository.reconcileSuccessfulAttempt(attempt.attemptId);
  assert.equal(result.status, 'RECONCILED');
  return { repository, attempt };
}

function protocolRaw(storage: ControlledStorage) {
  return {
    cart: storage.getItem(CART_STORAGE_KEY),
    attempt: storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    success: storage.getItem(SERVER_SUCCESS_STORAGE_KEY),
    proof: storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY),
    journal: storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY),
  };
}

async function interruptedReconciliationFixture(storage: ControlledStorage) {
  const repository = new CommerceStorageRepository(
    storage as unknown as Storage,
    new ImmediateLocks()
  );
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  storage.failKeyOnce = CART_STORAGE_KEY;
  await assert.rejects(() => repository.reconcileSuccessfulAttempt(attempt.attemptId));
  assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));
  return { repository, attempt };
}

test('runtime validation rejects a journal target outside the allowlist', () => {
  const storage = new ControlledStorage();
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify({
    version: 1,
    mutationId: 'mutation',
    operation: 'CART_MUTATION',
    targets: [{ key: 'arbitrary-secret-key', preimage: null, postimage: 'x' }],
    createdAt: 1,
  }));
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  assert.equal(repository.readSnapshot().reviewReason, 'JOURNAL_EVIDENCE_INVALID');
});

test('runtime validation rejects an allowlisted journal with an invalid postimage', () => {
  const storage = new ControlledStorage();
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify({
    version: 1,
    mutationId: 'mutation',
    operation: 'CART_MUTATION',
    targets: [{ key: CART_STORAGE_KEY, preimage: null, postimage: '{invalid-cart' }],
    createdAt: 1,
  }));
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  assert.equal(repository.readSnapshot().reviewReason, 'JOURNAL_EVIDENCE_INVALID');
});

test('server success evidence persists independently of an unresolved cart journal', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify({
    version: 1,
    mutationId: 'broken-journal',
    operation: 'CART_MUTATION',
    targets: [{ key: 'invalid-target', preimage: null, postimage: 'x' }],
    createdAt: 1,
  }));

  const evidence = await repository.recordServerSuccess(attempt, receipt);
  assert.equal(evidence.commercialResult.orderId, receipt.id);
  assert.ok(storage.getItem(SERVER_SUCCESS_STORAGE_KEY));
  assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));
});

test('completely corrupt journal cannot block durable success or trigger a Gateway replay', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  const journalRaw = '{completely-corrupt-journal';
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, journalRaw);

  const evidence = await repository.recordServerSuccess(attempt, receipt);
  assert.equal(evidence.commercialResult.orderId, receipt.id);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), journalRaw);
  assert.equal(repository.readSnapshot().successEvidence?.commercialResult.orderId, receipt.id);

  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return { ...receipt, id: 'replacement-order' };
  });
  const resumed = await coordinator.resume(attempt.attemptId);
  assert.equal(resumed?.status, 'REVIEW_REQUIRED');
  assert.equal(gatewayCalls, 0);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), journalRaw);
  assert.equal(repository.readSnapshot().successEvidence?.commercialResult.orderId, receipt.id);
});

test('orphan durable success blocks every replacement checkout before Gateway submission', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  const successRaw = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
  storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return { ...receipt, id: 'replacement-order' };
  });
  const replacementRequest = {
    ...attempt.request,
    idempotencyKey: 'replacement-key',
  };

  assert.equal(repository.readSnapshot().reviewReason, 'ATTEMPT_EVIDENCE_INVALID');
  await assert.rejects(
    () => coordinator.prepare(replacementRequest, [item]),
    /تحتاج مراجعة/
  );
  assert.equal(gatewayCalls, 0);
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successRaw);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});

test('central invariant blocks cart mutation around orphan durable success without creating a journal', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  storage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const successRaw = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
  const cartRaw = storage.getItem(CART_STORAGE_KEY);

  await assert.rejects(
    () => repository.mutateCart(() => [item]),
    /تعارضت أدلة الحفظ المحلية/
  );

  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successRaw);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
  assert.equal(storage.getItem(CART_STORAGE_KEY), cartRaw);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), null);
});

test('replay metadata differences do not conflict but commercial differences do', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  const first = await repository.recordServerSuccess(attempt, receipt);
  const replay = await repository.recordServerSuccess(attempt, { ...receipt, idempotentReplay: true, message: 'replay' });
  assert.deepEqual(replay.commercialResult, first.commercialResult);
  await assert.rejects(
    () => repository.recordServerSuccess(attempt, { ...receipt, id: 'different-order' }),
    /تعارضت نتيجة الخادم/
  );
});

test('central invariant rejects standalone Success B against a successful Attempt A before writes', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  const before = protocolRaw(storage);
  const conflictingReceipt = { ...receipt, id: 'order-2', orderNumber: 'ORD-2' };

  await assert.rejects(
    () => repository.recordServerSuccess(attempt, conflictingReceipt),
    /تعارضت نتيجة الخادم/
  );
  assert.deepEqual(protocolRaw(storage), before);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), null);
});

test('central invariant rejects Attempt B against durable Success A before creating a journal', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  const before = protocolRaw(storage);
  const conflictingReceipt = { ...receipt, id: 'order-2', orderNumber: 'ORD-2' };

  await assert.rejects(() => repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt: conflictingReceipt,
    updatedAt: 2,
  }), /تعارضت أدلة الحفظ/);
  assert.deepEqual(protocolRaw(storage), before);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), null);
});

test('central invariant preserves an old Attempt-transition journal that conflicts with durable Success', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  const attemptRaw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const conflictingReceipt = { ...receipt, id: 'order-2', orderNumber: 'ORD-2' };
  const journalRaw = JSON.stringify({
    version: 1,
    mutationId: 'legacy-conflicting-attempt-transition',
    operation: 'ATTEMPT_TRANSITION',
    attemptId: attempt.attemptId,
    targets: [{
      key: CHECKOUT_ATTEMPT_STORAGE_KEY,
      preimage: attemptRaw,
      postimage: JSON.stringify({
        ...attempt,
        revision: 2,
        serverState: 'SUCCEEDED',
        reconciliationState: 'PENDING',
        receipt: conflictingReceipt,
        updatedAt: 2,
      }),
    }],
    createdAt: 2,
  });
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, journalRaw);
  const before = protocolRaw(storage);

  const result = await repository.recoverPendingJournal();
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.deepEqual(protocolRaw(storage), before);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), journalRaw);
});

test('durable success reaches BLOCKED_CART without rewriting a corrupt Cart', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  const corruptRaw = '{corrupt-after-server-success';
  storage.setItem(CART_STORAGE_KEY, corruptRaw);

  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  const result = await repository.reconcileSuccessfulAttempt(attempt.attemptId);

  assert.equal(result.status, 'BLOCKED_CART');
  assert.equal(storage.getItem(CART_STORAGE_KEY), corruptRaw);
  assert.equal(repository.readSnapshot().attempt.attempt?.serverState, 'SUCCEEDED');
  assert.equal(repository.readSnapshot().attempt.attempt?.reconciliationState, 'BLOCKED_CART');
  assert.equal(repository.readSnapshot().successEvidence?.commercialResult.orderId, receipt.id);
});

test('direct reconciliation rejects conflicting successful commercial evidence without writes', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  const success = JSON.parse(storage.getItem(SERVER_SUCCESS_STORAGE_KEY)!);
  success.receipt = { ...success.receipt, id: 'order-conflict', orderNumber: 'ORD-CONFLICT' };
  success.commercialResult = {
    ...success.commercialResult,
    orderId: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
  };
  storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify(success));
  const before = protocolRaw(storage);

  const result = await repository.reconcileSuccessfulAttempt(attempt.attemptId);

  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.deepEqual(protocolRaw(storage), before);
  assert.equal(repository.readSnapshot().cart.envelope?.items.length, 1);
});

test('direct reconciliation accepts stable commercial success with replay-only metadata differences', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt: { ...receipt, idempotentReplay: true, message: 'replay metadata' },
    updatedAt: 2,
  });

  assert.equal((await repository.reconcileSuccessfulAttempt(attempt.attemptId)).status, 'RECONCILED');
  assert.equal(repository.readSnapshot().cart.envelope?.items.length, 0);
});

test('transient cart write failure recovers from journal and reconciles exactly once', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });

  storage.failKeyOnce = CART_STORAGE_KEY;
  await assert.rejects(() => repository.reconcileSuccessfulAttempt(attempt.attemptId));
  assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));

  assert.equal((await repository.recoverPendingJournal()).status, 'COMPLETED');
  const afterRecovery = repository.readSnapshot();
  assert.equal(afterRecovery.cart.envelope?.items.length, 0);
  assert.equal(afterRecovery.cart.envelope?.reconciliations.length, 1);
  assert.equal(afterRecovery.attempt.status, 'VALID');
  assert.equal(afterRecovery.attempt.attempt?.reconciliationState, 'APPLIED');

  const replay = await repository.reconcileSuccessfulAttempt(attempt.attemptId);
  assert.equal(replay.status, 'RECONCILED');
  assert.equal(repository.readSnapshot().cart.envelope?.reconciliations.length, 1);
});

test('a stale attempt transition cannot downgrade durable success', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  await assert.rejects(() => repository.persistAttempt({
    ...attempt,
    revision: 3,
    serverState: 'UNKNOWN',
    reconciliationState: 'NOT_STARTED',
    updatedAt: 3,
  }), /تخفيض نجاح/);
  assert.equal(repository.readSnapshot().attempt.status, 'VALID');
  assert.equal(repository.readSnapshot().attempt.attempt?.serverState, 'SUCCEEDED');
});

test('legacy local identities migrate without requiring UUID formatting', () => {
  const storage = new ControlledStorage();
  storage.setItem(CART_STORAGE_KEY, JSON.stringify([{ ...item, schemaVersion: undefined }]));
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const cart = repository.readSnapshot().cart;
  assert.equal(cart.status, 'VALID');
  assert.match(cart.envelope?.items[0].localLineId || '', /.+/);
});

test('attempt persistence uses only the centralized attempt key', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.persistAttempt(preparedAttempt());
  assert.ok(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY));
});

test('failed attempt snapshot persistence prevents every Gateway call', async () => {
  const storage = new ControlledStorage();
  storage.failKeyOnce = COMMERCE_JOURNAL_STORAGE_KEY;
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return receipt;
  });
  const template = preparedAttempt();
  await assert.rejects(() => coordinator.prepare(template.request, [item]));
  assert.equal(gatewayCalls, 0);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});

test('failed IN_FLIGHT persistence prevents submission to the Gateway', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return receipt;
  });
  const template = preparedAttempt();
  const attempt = await coordinator.prepare(template.request, [item]);
  storage.failKeyOnce = COMMERCE_JOURNAL_STORAGE_KEY;
  await assert.rejects(() => coordinator.submit(attempt.attemptId, 'turnstile-proof'));
  assert.equal(gatewayCalls, 0);
  assert.equal(repository.readSnapshot().attempt.attempt?.serverState, 'PREPARED');
});

test('a hung Gateway is bounded, releases submission coordination, and remains UNKNOWN', async () => {
  const storage = new ControlledStorage();
  const locks = new SerialLocks();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, locks);
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return new Promise<GuestOrderReceipt>(() => undefined);
  }, 10);
  const template = preparedAttempt();
  const attempt = await coordinator.prepare(template.request, [item]);
  const result = await coordinator.submit(attempt.attemptId, 'turnstile-proof');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(gatewayCalls, 1);
  assert.equal(repository.readSnapshot().attempt.attempt?.serverState, 'UNKNOWN');

  const resumed = await coordinator.resume(attempt.attemptId);
  assert.equal(resumed?.status, 'UNKNOWN');
  assert.equal(gatewayCalls, 1);
});

test('a valid late Gateway success monotonically resolves the timed-out attempt', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new SerialLocks());
  await repository.mutateCart(() => [item]);
  let resolveGateway!: (value: GuestOrderReceipt) => void;
  const gateway = new Promise<GuestOrderReceipt>((resolve) => { resolveGateway = resolve; });
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return gateway;
  }, 10);
  const template = preparedAttempt();
  const attempt = await coordinator.prepare(template.request, [item]);

  const initial = await coordinator.submit(attempt.attemptId, 'turnstile-proof');
  assert.equal(initial.status, 'UNKNOWN');
  resolveGateway(receipt);
  for (let retry = 0; retry < 50; retry += 1) {
    if (repository.readSnapshot().attempt.attempt?.serverState === 'SUCCEEDED') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const final = repository.readSnapshot();
  assert.equal(gatewayCalls, 1);
  assert.equal(final.attempt.attempt?.serverState, 'SUCCEEDED');
  assert.equal(final.attempt.attempt?.reconciliationState, 'APPLIED');
  assert.equal(final.successEvidence?.commercialResult.orderId, receipt.id);
  assert.equal(final.cart.envelope?.items.length, 0);
});

test('submitting a persisted IN_FLIGHT attempt does not reacquire its own submission lock', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new SerialLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.persistAttempt({ ...attempt, revision: 2, serverState: 'IN_FLIGHT', updatedAt: 2 });
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return receipt;
  }, 50);

  const result = await Promise.race([
    coordinator.submit(attempt.attemptId, 'fresh-turnstile-proof'),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('self-lock timeout')), 250)),
  ]);
  assert.equal(result.status, 'RECONCILED');
  assert.equal(gatewayCalls, 1);
  assert.equal(repository.readSnapshot().attempt.attempt?.serverState, 'SUCCEEDED');
});

test('missing Web Locks fails safely before a checkout attempt is persisted', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, null);
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return receipt;
  });
  const template = preparedAttempt();
  await assert.rejects(
    () => coordinator.prepare(template.request, [item]),
    /لا يدعم تنسيقًا آمنًا/
  );
  assert.equal(gatewayCalls, 0);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});

test('repository protects submitted lines while allowing independent newer additions', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  await repository.persistAttempt(preparedAttempt());
  await assert.rejects(
    () => repository.mutateCart((items) => items.map((entry) => ({ ...entry, quantity: 2 }))),
    /سطر مستقل/
  );
  const newer = { ...item, localLineId: 'line-newer', localRevision: 1, quantity: 1 };
  const cart = await repository.mutateCart((items) => [...items, newer]);
  assert.deepEqual(cart.items.map((entry) => entry.localLineId), ['line-original', 'line-newer']);
  assert.equal(cart.items[0].quantity, 1);
});

test('central invariant applies submitted-line protection to recovered cart journals', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  await repository.persistAttempt(preparedAttempt());
  const cartRaw = storage.getItem(CART_STORAGE_KEY)!;
  const cart = JSON.parse(cartRaw);
  const journalRaw = JSON.stringify({
    version: 1,
    mutationId: 'journal-removes-submitted-line',
    operation: 'CART_MUTATION',
    targets: [{
      key: CART_STORAGE_KEY,
      preimage: cartRaw,
      postimage: JSON.stringify({
        ...cart,
        revision: cart.revision + 1,
        lastMutationId: 'journal-removes-submitted-line',
        items: [],
      }),
    }],
    createdAt: 2,
  });
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, journalRaw);
  const before = protocolRaw(storage);

  const result = await repository.recoverPendingJournal();

  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.reason, 'ATTEMPT_EVIDENCE_INVALID');
  assert.deepEqual(protocolRaw(storage), before);
  assert.equal(storage.getItem(CART_STORAGE_KEY), cartRaw);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), journalRaw);
});

test('central invariant permits a recovered journal that only adds an independent cart line', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  await repository.persistAttempt(preparedAttempt());
  const cartRaw = storage.getItem(CART_STORAGE_KEY)!;
  const cart = JSON.parse(cartRaw);
  const newer = { ...item, localLineId: 'line-journal-newer', localRevision: 1, quantity: 3 };
  const postimage = JSON.stringify({
    ...cart,
    revision: cart.revision + 1,
    lastMutationId: 'journal-adds-independent-line',
    items: [item, newer],
  });
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify({
    version: 1,
    mutationId: 'journal-adds-independent-line',
    operation: 'CART_MUTATION',
    targets: [{ key: CART_STORAGE_KEY, preimage: cartRaw, postimage }],
    createdAt: 2,
  }));

  const result = await repository.recoverPendingJournal();

  assert.equal(result.status, 'COMPLETED');
  assert.equal(storage.getItem(CART_STORAGE_KEY), postimage);
  assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), null);
  assert.deepEqual(
    repository.readSnapshot().cart.envelope?.items.map((entry) => entry.localLineId),
    ['line-original', 'line-journal-newer']
  );
});

test('a second tab waits for the active submission before classifying IN_FLIGHT', async () => {
  const storage = new ControlledStorage();
  const locks = new SerialLocks();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, locks);
  await repository.mutateCart(() => [item]);
  let releaseGateway!: (value: GuestOrderReceipt) => void;
  let gatewayStarted!: () => void;
  const started = new Promise<void>((resolve) => { gatewayStarted = resolve; });
  const gatewayResult = new Promise<GuestOrderReceipt>((resolve) => { releaseGateway = resolve; });
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    gatewayStarted();
    return gatewayResult;
  });
  const template = preparedAttempt();
  const attempt = await coordinator.prepare(template.request, [item]);
  const submit = coordinator.submit(attempt.attemptId, 'turnstile-proof');
  await started;
  const resume = coordinator.resume(attempt.attemptId);
  let resumeSettled = false;
  void resume.then(() => { resumeSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(resumeSettled, false);

  releaseGateway(receipt);
  const [submitted, resumed] = await Promise.all([submit, resume]);
  assert.equal(submitted.status, 'RECONCILED');
  assert.equal(resumed?.status, 'RECONCILED');
  assert.equal(gatewayCalls, 1);
  const final = repository.readSnapshot();
  assert.equal(final.attempt.status, 'VALID');
  assert.equal(final.attempt.attempt?.serverState, 'SUCCEEDED');
  assert.equal(final.attempt.attempt?.reconciliationState, 'APPLIED');
  assert.equal(final.cart.envelope?.items.length, 0);
});

test('malformed durable success evidence blocks checkout instead of becoming absent', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.persistAttempt(preparedAttempt());
  storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify({ version: 1, attemptId: 'attempt-1' }));
  const snapshot = repository.readSnapshot();
  assert.equal(snapshot.successEvidence, null);
  assert.equal(snapshot.reviewReason, 'ATTEMPT_EVIDENCE_INVALID');
  await assert.rejects(
    () => repository.recordServerSuccess(preparedAttempt(), receipt),
    /لم يتم استبداله/
  );
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), JSON.stringify({ version: 1, attemptId: 'attempt-1' }));
});

test('APPLIED without matching proof is review-required, survives reload, and cannot clean up', async () => {
  const storage = new ControlledStorage();
  const { repository, attempt } = await reconcileFixture(storage);
  const cart = repository.readSnapshot().cart.envelope!;
  storage.removeItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
  storage.setItem(CART_STORAGE_KEY, JSON.stringify({
    ...cart,
    revision: cart.revision + 1,
    items: [item],
    reconciliations: [],
  }));
  const attemptRaw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const successRaw = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
  let gatewayCalls = 0;
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    gatewayCalls += 1;
    return receipt;
  });

  assert.equal(repository.readSnapshot().reviewReason, 'RECONCILIATION_EVIDENCE_MISSING');
  const first = await coordinator.resume(attempt.attemptId);
  assert.equal(first?.status, 'REVIEW_REQUIRED');
  assert.equal(gatewayCalls, 0);
  assert.equal(repository.readSnapshot().cart.envelope?.items.length, 1);
  await repository.clearResolvedAttempt(attempt.attemptId);
  assert.ok(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY));
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successRaw);

  const reloaded = new CommerceStorageRepository(
    storage as unknown as Storage,
    new ImmediateLocks()
  );
  assert.equal(reloaded.readSnapshot().reviewReason, 'RECONCILIATION_EVIDENCE_MISSING');
  assert.notEqual(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
  assert.notEqual(attemptRaw, null);
});

test('valid protocol proof reconciles and accepts replay-only receipt metadata differences', async () => {
  const storage = new ControlledStorage();
  const { repository, attempt } = await reconcileFixture(storage);
  const success = JSON.parse(storage.getItem(SERVER_SUCCESS_STORAGE_KEY)!);
  success.receipt.idempotentReplay = true;
  success.receipt.message = 'safe replay metadata';
  storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify(success));
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    throw new Error('Gateway must not be called during local proof recovery');
  });
  assert.equal(repository.readSnapshot().reviewReason, undefined);
  assert.equal((await coordinator.resume(attempt.attemptId))?.status, 'RECONCILED');
});

test('wrong-attempt, wrong-commercial-result, and malformed proofs block reconciliation and cleanup', async () => {
  for (const mutation of ['WRONG_ATTEMPT', 'WRONG_RESULT', 'MALFORMED'] as const) {
    const storage = new ControlledStorage();
    const { repository, attempt } = await reconcileFixture(storage);
    const proofRaw = storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY)!;
    const proof = JSON.parse(proofRaw);
    if (mutation === 'WRONG_ATTEMPT') proof.attemptId = 'different-attempt';
    if (mutation === 'WRONG_RESULT') proof.commercialResult.orderId = 'different-order';
    storage.setItem(
      RECONCILIATION_EVIDENCE_STORAGE_KEY,
      mutation === 'MALFORMED' ? '{malformed-proof' : JSON.stringify(proof)
    );
    const attemptBefore = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    const successBefore = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
    const cartBefore = storage.getItem(CART_STORAGE_KEY);
    assert.equal(repository.readSnapshot().reviewReason, 'ATTEMPT_EVIDENCE_INVALID');
    await repository.clearResolvedAttempt(attempt.attemptId);
    assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), attemptBefore);
    assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successBefore);
    assert.equal(storage.getItem(CART_STORAGE_KEY), cartBefore);
    assert.equal(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY), mutation === 'MALFORMED'
      ? '{malformed-proof'
      : JSON.stringify(proof));
  }
});

test('resume preserves malformed reconciliation proof and requires review', async () => {
  const storage = new ControlledStorage();
  const { repository, attempt } = await reconcileFixture(storage);
  storage.setItem(RECONCILIATION_EVIDENCE_STORAGE_KEY, '{malformed-proof');
  const cartBefore = storage.getItem(CART_STORAGE_KEY);
  const attemptBefore = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const successBefore = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    throw new Error('Gateway must not be called');
  });

  assert.equal((await coordinator.resume(attempt.attemptId))?.status, 'REVIEW_REQUIRED');
  assert.equal(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY), '{malformed-proof');
  assert.equal(storage.getItem(CART_STORAGE_KEY), cartBefore);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), attemptBefore);
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successBefore);
});

test('journal validation rejects an unrelated ATTEMPT_TRANSITION that erases unresolved evidence', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.persistAttempt({ ...attempt, revision: 2, serverState: 'UNKNOWN', updatedAt: 2 });
  await repository.recordServerSuccess(attempt, receipt);
  const attemptRaw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const successRaw = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify({
    version: 1,
    mutationId: 'invalid-erasure',
    operation: 'ATTEMPT_TRANSITION',
    attemptId: 'different-attempt',
    createdAt: 3,
    targets: [
      { key: CHECKOUT_ATTEMPT_STORAGE_KEY, preimage: attemptRaw, postimage: null },
      { key: SERVER_SUCCESS_STORAGE_KEY, preimage: successRaw, postimage: null },
    ],
  }));

  assert.equal((await repository.recoverPendingJournal()).status, 'REVIEW_REQUIRED');
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), attemptRaw);
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), successRaw);
});

test('legacy reconciliation journal preserves malformed proof and performs zero target writes', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(
    storage as unknown as Storage,
    new ImmediateLocks()
  );
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  storage.failKeyOnce = CART_STORAGE_KEY;
  await assert.rejects(() => repository.reconcileSuccessfulAttempt(attempt.attemptId));
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  journal.targets = journal.targets.filter(
    (target: { key: string }) => target.key !== RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  storage.setItem(RECONCILIATION_EVIDENCE_STORAGE_KEY, '{malformed-proof');
  const before = {
    cart: storage.getItem(CART_STORAGE_KEY),
    attempt: storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    success: storage.getItem(SERVER_SUCCESS_STORAGE_KEY),
    proof: storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY),
    journal: storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY),
  };

  const result = await repository.recoverPendingJournal();
  assert.deepEqual(result, { status: 'REVIEW_REQUIRED', reason: 'JOURNAL_EVIDENCE_INVALID' });
  assert.deepEqual({
    cart: storage.getItem(CART_STORAGE_KEY),
    attempt: storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    success: storage.getItem(SERVER_SUCCESS_STORAGE_KEY),
    proof: storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY),
    journal: storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY),
  }, before);
});

test('legacy reconciliation journal with missing success and malformed proof is read-only review-required', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  journal.targets = journal.targets.filter(
    (target: { key: string }) => target.key !== RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  storage.removeItem(SERVER_SUCCESS_STORAGE_KEY);
  storage.setItem(RECONCILIATION_EVIDENCE_STORAGE_KEY, '{malformed-proof');
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'JOURNAL_EVIDENCE_INVALID',
  });
  assert.deepEqual(protocolRaw(storage), before);
});

test('legacy reconciliation journal with missing success and no proof fails closed without target writes', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  journal.targets = journal.targets.filter(
    (target: { key: string }) => target.key !== RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  storage.removeItem(SERVER_SUCCESS_STORAGE_KEY);
  storage.removeItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'JOURNAL_EVIDENCE_INVALID',
  });
  assert.deepEqual(protocolRaw(storage), before);
});

test('reconciliation journal rejects a conflicting live commercial success before every target write', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const success = JSON.parse(storage.getItem(SERVER_SUCCESS_STORAGE_KEY)!);
  success.receipt = { ...success.receipt, id: 'order-conflict', orderNumber: 'ORD-CONFLICT' };
  success.commercialResult = {
    ...success.commercialResult,
    orderId: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
  };
  storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify(success));
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'JOURNAL_EVIDENCE_INVALID',
  });
  assert.deepEqual(protocolRaw(storage), before);
});

test('reconciliation journal cannot replace an already successful preimage with another commercial result', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  const attemptTarget = journal.targets.find(
    (target: { key: string }) => target.key === CHECKOUT_ATTEMPT_STORAGE_KEY
  );
  const cartTarget = journal.targets.find(
    (target: { key: string }) => target.key === CART_STORAGE_KEY
  );
  const proofTarget = journal.targets.find(
    (target: { key: string }) => target.key === RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  const postAttempt = JSON.parse(attemptTarget.postimage);
  postAttempt.receipt = {
    ...postAttempt.receipt,
    id: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
    idempotentReplay: true,
    message: 'allowed replay metadata',
  };
  attemptTarget.postimage = JSON.stringify(postAttempt);
  const postCart = JSON.parse(cartTarget.postimage);
  postCart.reconciliations = postCart.reconciliations.map(
    (marker: { attemptId: string; orderId: string }) => ({
      ...marker,
      orderId: marker.attemptId === postAttempt.attemptId ? 'order-conflict' : marker.orderId,
    })
  );
  cartTarget.postimage = JSON.stringify(postCart);
  const postProof = JSON.parse(proofTarget.postimage);
  postProof.commercialResult = {
    ...postProof.commercialResult,
    orderId: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
  };
  proofTarget.postimage = JSON.stringify(postProof);
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));

  const success = JSON.parse(storage.getItem(SERVER_SUCCESS_STORAGE_KEY)!);
  success.receipt = {
    ...success.receipt,
    id: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
    idempotentReplay: true,
    message: 'allowed replay metadata',
  };
  success.commercialResult = {
    ...success.commercialResult,
    orderId: 'order-conflict',
    orderNumber: 'ORD-CONFLICT',
  };
  storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify(success));
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'JOURNAL_EVIDENCE_INVALID',
  });
  assert.deepEqual(protocolRaw(storage), before);
  const preservedAttempt = JSON.parse(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY)!);
  assert.equal(preservedAttempt.receipt.id, receipt.id);
  assert.equal(preservedAttempt.receipt.orderNumber, receipt.orderNumber);
  assert.equal(repository.readSnapshot().cart.envelope?.items.length, 1);
});

test('attempt persistence rejects customer contact or address mutation and preserves original bytes', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  const before = protocolRaw(storage);

  await assert.rejects(() => repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'UNKNOWN',
    request: {
      ...attempt.request,
      customer: {
        ...attempt.request.customer,
        phone: '0799999999',
        street: 'عنوان مختلف',
      },
    },
    updatedAt: 2,
  }));
  assert.deepEqual(protocolRaw(storage), before);
});

test('reconciliation journal cannot replace immutable customer request context', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  const attemptTarget = journal.targets.find(
    (target: { key: string }) => target.key === CHECKOUT_ATTEMPT_STORAGE_KEY
  );
  const postAttempt = JSON.parse(attemptTarget.postimage);
  postAttempt.request.customer = {
    ...postAttempt.request.customer,
    phone: '0799999999',
    addressNotes: 'عنوان مستبدل',
  };
  attemptTarget.postimage = JSON.stringify(postAttempt);
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'JOURNAL_EVIDENCE_INVALID',
  });
  assert.deepEqual(protocolRaw(storage), before);
});

test('supported legacy reconciliation journal upgrades proof and completes exactly once', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  journal.targets = journal.targets.filter(
    (target: { key: string }) => target.key !== RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  storage.removeItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);

  assert.deepEqual(await repository.recoverPendingJournal(), { status: 'COMPLETED' });
  const completed = repository.readSnapshot();
  assert.equal(completed.attempt.attempt?.reconciliationState, 'APPLIED');
  assert.equal(completed.cart.envelope?.items.length, 0);
  assert.ok(completed.reconciliationEvidence);
  assert.equal((await repository.recoverPendingJournal()).status, 'NONE');
  assert.equal(repository.readSnapshot().cart.envelope?.reconciliations.length, 1);
});

test('legacy reconciliation journal remains byte-identical when a live cart conflict blocks upgrade', async () => {
  const storage = new ControlledStorage();
  const { repository } = await interruptedReconciliationFixture(storage);
  const journal = JSON.parse(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!);
  journal.targets = journal.targets.filter(
    (target: { key: string }) => target.key !== RECONCILIATION_EVIDENCE_STORAGE_KEY
  );
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
  storage.removeItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
  const liveCart = JSON.parse(storage.getItem(CART_STORAGE_KEY)!);
  liveCart.revision += 1;
  liveCart.lastMutationId = 'independent-newer-cart-mutation';
  liveCart.items.push({
    ...item,
    localLineId: 'line-added-after-interruption',
    localRevision: 1,
  });
  storage.setItem(CART_STORAGE_KEY, JSON.stringify(liveCart));
  const before = protocolRaw(storage);

  assert.deepEqual(await repository.recoverPendingJournal(), {
    status: 'REVIEW_REQUIRED',
    reason: 'STORAGE_CONFLICT',
  });
  assert.deepEqual(protocolRaw(storage), before);
});

test('reconciliation journal cannot replace one attempt with another identity', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(
    storage as unknown as Storage,
    new ImmediateLocks()
  );
  await repository.mutateCart(() => [item]);
  const original = preparedAttempt();
  await repository.persistAttempt(original);
  await repository.persistAttempt({
    ...original,
    revision: 2,
    serverState: 'UNKNOWN',
    updatedAt: 2,
  });
  const originalAttemptRaw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  const originalCartRaw = storage.getItem(CART_STORAGE_KEY);

  const otherStorage = new ControlledStorage();
  const otherRepository = new CommerceStorageRepository(
    otherStorage as unknown as Storage,
    new ImmediateLocks()
  );
  await otherRepository.mutateCart(() => [item]);
  const other = {
    ...preparedAttempt(),
    attemptId: 'attempt-2',
    submissionGeneration: 'generation-2',
    idempotencyKey: 'key-2',
    request: { ...preparedAttempt().request, idempotencyKey: 'key-2' },
  };
  await otherRepository.persistAttempt(other);
  await otherRepository.recordServerSuccess(other, receipt);
  await otherRepository.persistAttempt({
    ...other,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  otherStorage.failKeyOnce = CART_STORAGE_KEY;
  await assert.rejects(() => otherRepository.reconcileSuccessfulAttempt(other.attemptId));
  const crossIdentityJournal = JSON.parse(
    otherStorage.getItem(COMMERCE_JOURNAL_STORAGE_KEY)!
  );
  crossIdentityJournal.targets.find(
    (target: { key: string }) => target.key === CHECKOUT_ATTEMPT_STORAGE_KEY
  ).preimage = originalAttemptRaw;
  crossIdentityJournal.targets.find(
    (target: { key: string }) => target.key === CART_STORAGE_KEY
  ).preimage = originalCartRaw;
  storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(crossIdentityJournal));
  const before = {
    cart: storage.getItem(CART_STORAGE_KEY),
    attempt: storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    success: storage.getItem(SERVER_SUCCESS_STORAGE_KEY),
    proof: storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY),
    journal: storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY),
  };

  const result = await repository.recoverPendingJournal();
  assert.deepEqual(result, { status: 'REVIEW_REQUIRED', reason: 'JOURNAL_EVIDENCE_INVALID' });
  assert.deepEqual({
    cart: storage.getItem(CART_STORAGE_KEY),
    attempt: storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY),
    success: storage.getItem(SERVER_SUCCESS_STORAGE_KEY),
    proof: storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY),
    journal: storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY),
  }, before);
});

test('legacy stored cart identities remain stable and successful checkout removes the submitted line', async () => {
  const storage = new ControlledStorage();
  storage.setItem(CART_STORAGE_KEY, JSON.stringify([{
    productId: item.productId,
    sku: item.sku,
    nameAr: item.nameAr,
    quantity: 1,
    unitPriceInMinorUnits: item.unitPriceInMinorUnits,
    unitsPerSalePackage: 1,
  }]));
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new SerialLocks());
  const firstRead = repository.readSnapshot().cart.envelope?.items ?? [];
  const secondRead = repository.readSnapshot().cart.envelope?.items ?? [];
  assert.equal(firstRead[0].localLineId, secondRead[0].localLineId);
  const template = preparedAttempt();
  const request = {
    ...template.request,
    items: buildGuestOrderV2Lines(firstRead),
  };
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => receipt);
  const attempt = await coordinator.prepare(request, firstRead);
  const result = await coordinator.submit(attempt.attemptId, 'turnstile-proof');
  assert.equal(result.status, 'RECONCILED');
  assert.deepEqual(repository.readSnapshot().cart.envelope?.items, []);
});

test('legacy cart marker deterministically promotes to durable proof without a second cart mutation', async () => {
  const storage = new ControlledStorage();
  const { repository, attempt } = await reconcileFixture(storage);
  const cartBefore = storage.getItem(CART_STORAGE_KEY);
  storage.removeItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
  const coordinator = new CheckoutRecoveryCoordinator(repository, async () => {
    throw new Error('Gateway must not be called');
  });
  assert.equal((await coordinator.resume(attempt.attemptId))?.status, 'RECONCILED');
  assert.ok(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY));
  assert.equal(storage.getItem(CART_STORAGE_KEY), cartBefore);
});

test('proof survives newer additions and cart recovery, then cleanup preserves newer content', async () => {
  const storage = new ControlledStorage();
  const { repository, attempt } = await reconcileFixture(storage);
  const newer = { ...item, localLineId: 'line-after-success', localRevision: 1, quantity: 3 };
  await repository.mutateCart((items) => [...items, newer]);
  const proofBefore = storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
  const newerBefore = repository.readSnapshot().cart.envelope?.items[0];

  const invalidRaw = '{invalid-cart-after-success';
  storage.setItem(CART_STORAGE_KEY, invalidRaw);
  const recovery = repository.readSnapshot().cart;
  assert.equal(recovery.status, 'INVALID');
  if (recovery.status !== 'INVALID') throw new Error('Expected invalid cart recovery fixture.');
  await repository.resolveCartRecovery(recovery.recovery, 'RESET_CART');
  assert.equal(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY), proofBefore);

  await repository.mutateCart(() => [newer]);
  const itemBeforeCleanup = repository.readSnapshot().cart.envelope?.items[0];
  assert.deepEqual(itemBeforeCleanup, newerBefore);
  await repository.clearResolvedAttempt(attempt.attemptId);
  const cleaned = repository.readSnapshot();
  assert.equal(cleaned.attempt.status, 'ABSENT');
  assert.equal(cleaned.successEvidence, null);
  assert.equal(cleaned.reconciliationEvidence, null);
  assert.deepEqual(cleaned.cart.envelope?.items, [newer]);

  const reloaded = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  assert.equal(reloaded.readSnapshot().attempt.status, 'ABSENT');
  assert.deepEqual(reloaded.readSnapshot().cart.envelope?.items, [newer]);
  await reloaded.clearResolvedAttempt(attempt.attemptId);
  assert.deepEqual(reloaded.readSnapshot().cart.envelope?.items, [newer]);
});

test('cleanup journal recovers failures before, during, and after target writes without evidence loss', async () => {
  for (const failure of ['BEFORE', 'PARTIAL', 'AFTER'] as const) {
    const storage = new ControlledStorage();
    const { repository, attempt } = await reconcileFixture(storage);
    if (failure === 'BEFORE') storage.failKeyOnce = COMMERCE_JOURNAL_STORAGE_KEY;
    if (failure === 'PARTIAL') storage.failRemoveKeyOnce = CHECKOUT_ATTEMPT_STORAGE_KEY;
    if (failure === 'AFTER') storage.failRemoveKeyOnce = COMMERCE_JOURNAL_STORAGE_KEY;
    await assert.rejects(() => repository.clearResolvedAttempt(attempt.attemptId));
    if (failure === 'BEFORE') {
      assert.ok(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY));
      assert.ok(storage.getItem(SERVER_SUCCESS_STORAGE_KEY));
      assert.ok(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY));
      assert.equal(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY), null);
      continue;
    }
    assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));
    assert.equal((await repository.recoverPendingJournal()).status, 'COMPLETED');
    assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
    assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), null);
    assert.equal(storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY), null);
    assert.equal(repository.readSnapshot().cart.envelope?.items.length, 0);
  }
});

test('rejected and abandoned attempts keep their approved cleanup behavior', async () => {
  for (const serverState of ['REJECTED', 'ABANDONED'] as const) {
    const storage = new ControlledStorage();
    const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
    const attempt = preparedAttempt();
    await repository.persistAttempt(attempt);
    await repository.persistAttempt({
      ...attempt,
      revision: 2,
      serverState,
      terminalMessage: 'terminal',
      updatedAt: 2,
    });
    await repository.clearResolvedAttempt(attempt.attemptId);
    assert.equal(repository.readSnapshot().attempt.status, 'ABSENT');
  }
});

test('dismissing an applied attempt clears attempt and success evidence atomically', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({
    ...attempt,
    revision: 2,
    serverState: 'SUCCEEDED',
    reconciliationState: 'PENDING',
    receipt,
    updatedAt: 2,
  });
  await repository.reconcileSuccessfulAttempt(attempt.attemptId);
  await repository.clearResolvedAttempt(attempt.attemptId);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
  assert.equal(storage.getItem(SERVER_SUCCESS_STORAGE_KEY), null);
});

test('crash after cart postimage but before attempt postimage converges once', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({ ...attempt, revision: 2, serverState: 'SUCCEEDED', reconciliationState: 'PENDING', receipt, updatedAt: 2 });
  storage.failKeyOnce = CHECKOUT_ATTEMPT_STORAGE_KEY;
  await assert.rejects(() => repository.reconcileSuccessfulAttempt(attempt.attemptId));
  assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));
  assert.equal((await repository.recoverPendingJournal()).status, 'COMPLETED');
  const snapshot = repository.readSnapshot();
  assert.equal(snapshot.cart.envelope?.items.length, 0);
  assert.equal(snapshot.attempt.status, 'VALID');
  assert.equal(snapshot.attempt.attempt?.reconciliationState, 'APPLIED');
  assert.equal((await repository.reconcileSuccessfulAttempt(attempt.attemptId)).status, 'RECONCILED');
  assert.equal(repository.readSnapshot().cart.envelope?.reconciliations.length, 1);
});

test('crash after both reconciliation postimages but before journal cleanup converges once', async () => {
  const storage = new ControlledStorage();
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  await repository.mutateCart(() => [item]);
  const attempt = preparedAttempt();
  await repository.persistAttempt(attempt);
  await repository.recordServerSuccess(attempt, receipt);
  await repository.persistAttempt({ ...attempt, revision: 2, serverState: 'SUCCEEDED', reconciliationState: 'PENDING', receipt, updatedAt: 2 });
  storage.failRemoveKeyOnce = COMMERCE_JOURNAL_STORAGE_KEY;
  await assert.rejects(() => repository.reconcileSuccessfulAttempt(attempt.attemptId));
  assert.ok(storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY));
  assert.equal((await repository.recoverPendingJournal()).status, 'COMPLETED');
  const snapshot = repository.readSnapshot();
  assert.equal(snapshot.cart.envelope?.items.length, 0);
  assert.equal(snapshot.cart.envelope?.reconciliations.length, 1);
  assert.equal(snapshot.attempt.status, 'VALID');
  assert.equal(snapshot.attempt.attempt?.reconciliationState, 'APPLIED');
});

test('unsupported attempt version is preserved and blocks automatic recovery', () => {
  const storage = new ControlledStorage();
  const raw = JSON.stringify({ version: 99, attemptId: 'future-attempt' });
  storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, raw);
  const repository = new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
  const snapshot = repository.readSnapshot();
  assert.equal(snapshot.reviewReason, 'UNSUPPORTED_STATE_VERSION');
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), raw);
});
