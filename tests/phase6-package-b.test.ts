import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {allocateBaseReturn, assertReturnCapacityUnchanged} from '../src/features/orders/aftercarePresentation';
import {businessErrorMessage} from '../src/utils/businessError';
import {formatCartQuantitySummary, calculateCartPackages} from '../customer-web/src/utils/cart';
import {checkoutErrorMessage} from '../customer-web/src/utils/checkoutErrorMessage';
import type {CartItem} from '../customer-web/src/types/catalog';
import type {AftercarePhysicalRepresentative} from '../src/services/supabase/salesAftercare.service';

const leaves: AftercarePhysicalRepresentative[] = [
  {sourceKind: 'base_order_item', sourceId: 'a', productId: 'p', remainingQuantity: 2, parentReplacementItemId: null},
  {sourceKind: 'replacement_item', sourceId: 'b', productId: 'p', remainingQuantity: 3, parentReplacementItemId: 'prior'},
];
const history = [{operationalStatus: 'issued', issuedAt: '2026-10-01T10:00:00Z', items: [
  {replacementItemId: 'prior', parentReplacementItemId: null, rootOrderItemId: 'root'},
]}, {operationalStatus: 'issued', issuedAt: '2026-10-02T10:00:00Z', items: [
  {replacementItemId: 'b', parentReplacementItemId: 'prior', rootOrderItemId: 'root'},
]}];
test('partial base return allocates exact selected quantity over current physical leaves only', () => {
  const physical = allocateBaseReturn('root', [...leaves].reverse(), 3, 'restock', history);
  assert.deepEqual(physical.map(row => [row.source_id, row.quantity]), [['a', 2], ['b', 1]]);
  assert.equal(physical.reduce((sum, row) => sum + row.sellable_restock_quantity, 0), 3);
  assert.ok(physical.every(row => row.root_source_id === 'root' && row.product_id === 'p'));
  assert.deepEqual(leaves.map(row => row.remainingQuantity), [2, 3]);
  const damaged = allocateBaseReturn('root', leaves, 1, 'damaged', history);
  assert.equal(damaged[0].defect_non_sellable_quantity, 1);
  assert.equal(damaged[0].sellable_restock_quantity, 0);
  for (const invalid of [0, -1, 1.5, 6, NaN, Infinity]) {
    assert.throws(() => allocateBaseReturn('root', leaves, invalid, 'restock'));
  }
  assert.throws(() => allocateBaseReturn('root', [leaves[0], leaves[0]], 1, 'restock'));
  assert.equal(allocateBaseReturn('root', leaves, 5, 'restock', history).length, 2);
});
test('base return orders original first, issuance oldest first, then depth and stable identity', () => {
  const original = {...leaves[0], sourceId: 'zz-original', remainingQuantity: 1};
  const leaf = (id: string, parent: string | null = null) => ({...leaves[1], sourceId: id,
    parentReplacementItemId: parent, remainingQuantity: 1});
  const event = (id: string, issuedAt: string | null, parent: string | null = null) => ({
    operationalStatus: 'issued', issuedAt, items: [{replacementItemId: id,
      parentReplacementItemId: parent, rootOrderItemId: 'root'}],
  });
  const reps = [leaf('aa-new'), leaf('zz-old'), original];
  const dated = [event('aa-new', '2026-10-03T10:00:00Z'), event('zz-old', '2026-10-01T10:00:00Z')];
  const ids = (r: AftercarePhysicalRepresentative[], h: Array<Record<string, unknown>>) =>
    allocateBaseReturn('root', r, r.length, 'restock', h).map(row => row.source_id);
  assert.deepEqual(ids(reps, dated), ['zz-original', 'zz-old', 'aa-new']);
  assert.deepEqual(reps.map(r => r.sourceId), ['aa-new', 'zz-old', 'zz-original']);
  const undated = [event('aa-deep', null, 'parent'), event('parent', null), event('zz-shallow', null)];
  assert.deepEqual(ids([leaf('aa-deep', 'parent'), original, leaf('zz-shallow')], undated),
    ['zz-original', 'zz-shallow', 'aa-deep']);
  const tied = [event('bb', null), event('aa', null)];
  assert.deepEqual(ids([leaf('bb'), leaf('aa')], tied), ['aa', 'bb']);
  assert.deepEqual(ids([leaf('aa'), leaf('bb')], tied), ['aa', 'bb']);
  assert.deepEqual(ids([leaf('bb'), leaf('aa')], [event('bb', '2026-10-01T10:00:00Z'),
    event('aa', '2026-10-01T10:00:00Z')]), ['aa', 'bb']);
  assert.throws(() => ids([leaf('aa')], [{operationalStatus: 'issued', items: [null]}]));
  assert.throws(() => ids([leaf('aa-new', 'wrong-parent')], dated));
  assert.throws(() => ids([leaf('foreign')], dated));
  assert.throws(() => ids([leaf('cycle', 'cycle')], [event('cycle', null, 'cycle')]));
  assert.throws(() => ids([leaf('aa-new')], [{...dated[0], items: [
    {replacementItemId: 'aa-new', parentReplacementItemId: null, rootOrderItemId: 'foreign-root'},
  ]}]));
});
test('cart display separates base units and parcels without changing commercial counting', () => {
  const items = [{commercialLineKind: 'base_unit', quantity: 3},
    {commercialLineKind: 'legacy_single_sku_parcel', quantity: 2},
    {commercialLineKind: 'configurable_parcel', quantity: 1}] as CartItem[];
  assert.equal(formatCartQuantitySummary(items), `${(3).toLocaleString('ar-JO')} طرد • ${(3).toLocaleString('ar-JO')} وحدة أساسية`);
  assert.equal(calculateCartPackages(items), 6);
  assert.equal(formatCartQuantitySummary([items[0]]), `${(3).toLocaleString('ar-JO')} وحدة أساسية`);
  assert.equal(formatCartQuantitySummary([]), 'السلة فارغة');
});
test('Arabic messages preserve recovery semantics and expose unknown diagnostic codes', () => {
  assert.match(businessErrorMessage('AFTERCARE_OUTCOME_UNKNOWN'), /نفس المحاولة.*لا تبدأ/u);
  assert.match(businessErrorMessage('PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED'), /الكمية المتبقية/u);
  assert.match(businessErrorMessage('PHASE43_RETURN_ALLOCATION_INVALID'), /صنّف كامل/u);
  assert.match(businessErrorMessage('Failed to fetch'), /تحقق من المحاولة السابقة/u);
  assert.match(businessErrorMessage('PHASE43_UNRECOGNIZED'), /رمز: PHASE43_UNRECOGNIZED/u);
  assert.match(businessErrorMessage('PHASE43_RETURN_ALLOCATION_MISMATCH'), /صنّف كامل/u);
  assert.equal(businessErrorMessage('اختر كمية صحيحة'), 'اختر كمية صحيحة');
  assert.match(checkoutErrorMessage('OUTCOME_UNKNOWN', true), /نفس المحاولة/u);
  assert.doesNotMatch(checkoutErrorMessage('timeout', false), /نفس المحاولة|المحاولة المحفوظة/u);
  assert.match(checkoutErrorMessage('PHASE3_UNKNOWN_ERROR'), /رمز: PHASE3_UNKNOWN_ERROR/u);
});

test('return draft rejects changed quantity, missing/replaced identity and product/parent drift', () => {
  assert.doesNotThrow(() => assertReturnCapacityUnchanged(leaves, leaves.map(row => ({...row}))));
  for (const changed of [{...leaves[0], remainingQuantity: 1}, {...leaves[0], sourceId: 'other'},
    {...leaves[0], productId: 'foreign'}, {...leaves[0], parentReplacementItemId: 'new'}]) {
    assert.throws(() => assertReturnCapacityUnchanged(leaves, [changed, leaves[1]]), /تغيّرت الكمية/u);
  }
  assert.throws(() => assertReturnCapacityUnchanged(leaves, [leaves[0], leaves[0], leaves[1]]));
});

test('replacement cannot predate its parent or original completion, missing dates still use lineage', () => {
  const earlierChild = [{...history[0], issuedAt: '2026-10-03T10:00:00Z'}, history[1]];
  assert.throws(() => allocateBaseReturn('root', leaves, 3, 'restock', earlierChild), /أقدم من الأصل/u);
  assert.throws(() => allocateBaseReturn('root', leaves, 3, 'restock', history, '2026-10-01T11:00:00Z'), /أقدم من الأصل/u);
  assert.doesNotThrow(() => allocateBaseReturn('root', leaves, 3, 'restock', history, '2026-09-30T10:00:00Z'));
  assert.doesNotThrow(() => allocateBaseReturn('root', leaves, 3, 'restock', history.map(row => ({...row, issuedAt: null}))));
});
test('desktop shell changes are md-only; mobile safe areas and locked-content exclusion remain', () => {
  const shell = readFileSync('src/components/layout/IPhoneContainer.tsx', 'utf8');
  assert.match(shell, /md:max-w-\[1600px\]/u);
  assert.match(shell, /w-full h-\[100dvh\]/u);
  assert.match(shell, /env\(safe-area-inset-bottom\)/u);
  assert.match(shell, /!isApplicationLocked &&/u);
  assert.match(shell, /get\('preview'\) === 'phone'/u);
  assert.doesNotMatch(shell, /font-sans select-none/u);
});
