import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CartItem, ConfigurableParcelCartItem } from '../src/types/catalog';
import {
  CART_RECOVERY_BACKUP_STORAGE_KEY,
  CART_STORAGE_KEY,
} from '../src/utils/cart';
import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CommerceLockManager,
  CommerceStorageRepository,
  readCartEnvelope,
} from '../src/services/commerceStorage';

class ImmediateLocks implements CommerceLockManager {
  async request<T>(_name: string, callback: () => Promise<T> | T): Promise<T> {
    return callback();
  }
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const base: CartItem = {
  schemaVersion: 2,
  localLineId: 'base-line',
  localRevision: 1,
  commercialLineKind: 'base_unit',
  productId: '11111111-1111-4111-8111-111111111111',
  sku: 'BASE',
  nameAr: 'باكيت سليم',
  imageUrl: '',
  saleUnitNameAr: 'باكيت',
  unitsPerSalePackage: 1,
  unitPriceInMinorUnits: 250,
  quantity: 2,
  maxAvailablePackages: 20,
};

const validParcel: ConfigurableParcelCartItem = {
  ...base,
  localLineId: 'parcel-line',
  commercialLineKind: 'configurable_parcel',
  productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  familyProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  parcelConfigurationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  configurationRevision: 1,
  compositionMode: 'configurable_mix',
  capacity: 5,
  saleUnitNameAr: 'طرد',
  unitsPerSalePackage: 5,
  unitPriceInMinorUnits: 1000,
  quantity: 1,
  parcelInstances: [{
    localInstanceId: 'parcel-instance',
    localRevision: 1,
    components: [{
      productId: base.productId,
      sku: base.sku,
      nameAr: base.nameAr,
      flavorNameAr: 'حار',
      unitNameAr: 'باكيت',
      imageUrl: '',
      baseQuantity: 5,
    }],
  }],
};

const invalidParcel = {
  ...validParcel,
  parcelInstances: [{
    ...validParcel.parcelInstances[0],
    components: [{ ...validParcel.parcelInstances[0].components[0], baseQuantity: 4 }],
  }],
};

function legacyDocument(items: unknown[]) {
  return JSON.stringify({ version: 2, items, reconciledAttemptIds: [] });
}

function repository(storage: MemoryStorage) {
  return new CommerceStorageRepository(storage as unknown as Storage, new ImmediateLocks());
}

test('corrupt JSON remains byte-for-byte unchanged across repeated reads', () => {
  const storage = new MemoryStorage();
  const original = '{broken-json';
  storage.setItem(CART_STORAGE_KEY, original);
  for (let reload = 0; reload < 4; reload += 1) {
    const state = readCartEnvelope(storage as unknown as Storage);
    assert.equal(state.status, 'INVALID');
    assert.equal(state.status === 'INVALID' ? state.recovery.reason : '', 'CORRUPT_JSON');
    assert.equal(storage.getItem(CART_STORAGE_KEY), original);
  }
});

test('valid item plus invalid Parcel is partial without filtering and overwriting', () => {
  const storage = new MemoryStorage();
  const original = legacyDocument([base, invalidParcel]);
  storage.setItem(CART_STORAGE_KEY, original);
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'PARTIALLY_INVALID');
  assert.deepEqual(state.status === 'PARTIALLY_INVALID' ? state.recovery.validItems : [], [base]);
  assert.equal(storage.getItem(CART_STORAGE_KEY), original);
  assert.notEqual(legacyDocument([base]), original, 'the old filtered overwrite would lose evidence');
});

test('invalid Parcel-only and valid empty cart stay distinct', async () => {
  const invalidStorage = new MemoryStorage();
  const original = legacyDocument([invalidParcel]);
  invalidStorage.setItem(CART_STORAGE_KEY, original);
  assert.equal(readCartEnvelope(invalidStorage as unknown as Storage).status, 'INVALID');
  assert.equal(invalidStorage.getItem(CART_STORAGE_KEY), original);

  const emptyStorage = new MemoryStorage();
  await repository(emptyStorage).mutateCart(() => []);
  assert.equal(readCartEnvelope(emptyStorage as unknown as Storage).status, 'VALID_EMPTY');
});

test('legacy identities migrate by schema contract without an automatic overwrite', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify([{ ...base, schemaVersion: undefined, localLineId: undefined, commercialLineKind: undefined }]);
  storage.setItem(CART_STORAGE_KEY, raw);
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'VALID');
  assert.equal(state.envelope?.items[0].commercialLineKind, 'legacy_single_sku_parcel');
  assert.equal(storage.getItem(CART_STORAGE_KEY), raw);
  assert.equal(
    readCartEnvelope(storage as unknown as Storage).envelope?.items[0].localLineId,
    state.envelope?.items[0].localLineId,
    'legacy identity must remain deterministic across reloads'
  );
});

test('current V3 cart keeps valid items available when one Parcel is invalid', async () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({
    version: 3,
    revision: 7,
    lastMutationId: 'prior-mutation',
    items: [base, invalidParcel],
    reconciliations: [],
  });
  storage.setItem(CART_STORAGE_KEY, original);

  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'PARTIALLY_INVALID');
  if (state.status !== 'PARTIALLY_INVALID') throw new Error('Expected partial V3 recovery.');
  assert.deepEqual(state.recovery.validItems, [base]);
  assert.equal(storage.getItem(CART_STORAGE_KEY), original);

  await repository(storage).resolveCartRecovery(state.recovery, 'KEEP_VALID_ITEMS');
  assert.equal(storage.getItem(CART_RECOVERY_BACKUP_STORAGE_KEY), original);
  assert.deepEqual(readCartEnvelope(storage as unknown as Storage).envelope?.items, [base]);
});

test('nested null Parcel entries remain isolated from the valid V3 recovery projection', async () => {
  for (const parcelInstances of [
    [null],
    [{
      ...validParcel.parcelInstances[0],
      components: [null],
    }],
  ]) {
    const storage = new MemoryStorage();
    const original: string = JSON.stringify({
      version: 3,
      revision: 9,
      lastMutationId: 'nested-invalid-fixture',
      items: [base, { ...validParcel, parcelInstances }],
      reconciliations: [],
    });
    storage.setItem(CART_STORAGE_KEY, original);

    const state = readCartEnvelope(storage as unknown as Storage);
    assert.equal(state.status, 'PARTIALLY_INVALID');
    if (state.status !== 'PARTIALLY_INVALID') throw new Error('Expected partial V3 recovery.');
    assert.deepEqual(state.recovery.validItems, [base]);
    assert.equal(state.recovery.invalidEntries[0]?.index, 1);
    assert.equal(storage.getItem(CART_STORAGE_KEY), original);

    await repository(storage).resolveCartRecovery(state.recovery, 'KEEP_VALID_ITEMS');
    assert.equal(storage.getItem(CART_RECOVERY_BACKUP_STORAGE_KEY), original);
    assert.deepEqual(readCartEnvelope(storage as unknown as Storage).envelope?.items, [base]);
  }
});

test('valid configurable Parcel persists with stable identities and components', async () => {
  const storage = new MemoryStorage();
  await repository(storage).mutateCart(() => [validParcel]);
  assert.deepEqual(readCartEnvelope(storage as unknown as Storage).envelope?.items, [validParcel]);
});

test('explicit recovery first backs up raw state then keeps valid items', async () => {
  const storage = new MemoryStorage();
  const original = legacyDocument([base, invalidParcel]);
  storage.setItem(CART_STORAGE_KEY, original);
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'PARTIALLY_INVALID');
  await repository(storage).resolveCartRecovery(state.recovery, 'KEEP_VALID_ITEMS');
  assert.equal(storage.getItem(CART_RECOVERY_BACKUP_STORAGE_KEY), original);
  assert.deepEqual(readCartEnvelope(storage as unknown as Storage).envelope?.items, [base]);
});

test('explicit reset is required for invalid-only cart', async () => {
  const storage = new MemoryStorage();
  const original = legacyDocument([invalidParcel]);
  storage.setItem(CART_STORAGE_KEY, original);
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'INVALID');
  await repository(storage).resolveCartRecovery(state.recovery, 'RESET_CART');
  assert.equal(storage.getItem(CART_RECOVERY_BACKUP_STORAGE_KEY), original);
  assert.equal(readCartEnvelope(storage as unknown as Storage).status, 'VALID_EMPTY');
});

test('cart recovery never changes pending attempt evidence', async () => {
  const storage = new MemoryStorage();
  const original = legacyDocument([base, invalidParcel]);
  const pendingAttempt = JSON.stringify({ version: 99, attemptId: 'pending' });
  storage.setItem(CART_STORAGE_KEY, original);
  storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, pendingAttempt);
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'PARTIALLY_INVALID');
  await repository(storage).resolveCartRecovery(state.recovery, 'KEEP_VALID_ITEMS');
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), pendingAttempt);

  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /hasUnresolvedCheckoutAttempt=\{unresolvedCheckoutAttempt\}/);
  assert.match(app, /lockedLineIds=\{lockedLineIds\}/);
});

test('stale recovery refuses to overwrite newer valid cart additions', async () => {
  const storage = new MemoryStorage();
  storage.setItem(CART_STORAGE_KEY, legacyDocument([base, invalidParcel]));
  const state = readCartEnvelope(storage as unknown as Storage);
  assert.equal(state.status, 'PARTIALLY_INVALID');
  storage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 3, revision: 1, lastMutationId: 'newer', items: [base], reconciliations: [] }));
  await assert.rejects(
    () => repository(storage).resolveCartRecovery(state.recovery, 'RESET_CART'),
    /تغيّرت السلة/
  );
  assert.deepEqual(readCartEnvelope(storage as unknown as Storage).envelope?.items, [base]);
});

test('unavailable browser storage is not mistaken for a valid empty cart', () => {
  const storage = { getItem() { throw new DOMException('blocked', 'SecurityError'); } };
  assert.equal(readCartEnvelope(storage as Pick<Storage, 'getItem'>).status, 'UNAVAILABLE');
});
