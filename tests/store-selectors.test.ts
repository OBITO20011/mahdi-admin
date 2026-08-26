import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shallowEqual,
  type SelectorCache,
  updateSelectorCache,
} from '../src/stores/storeSelectors';

test('selector cache ignores an unrelated store notification', () => {
  const products = [{ id: 'p-1' }];
  const cache: SelectorCache<{ products: typeof products }> = {
    hasValue: false,
  };

  const initial = updateSelectorCache(cache, { products }, shallowEqual);
  const afterUnrelatedToast = updateSelectorCache(
    cache,
    { products },
    shallowEqual
  );

  assert.equal(initial.changed, true);
  assert.equal(afterUnrelatedToast.changed, false);
  assert.equal(afterUnrelatedToast.selection, initial.selection);
});

test('selector cache notifies when the selected domain reference changes', () => {
  const products = [{ id: 'p-1' }];
  const cache: SelectorCache<{ products: typeof products }> = {
    hasValue: false,
  };

  updateSelectorCache(cache, { products }, shallowEqual);
  const afterProductsRefresh = updateSelectorCache(
    cache,
    { products: [...products, { id: 'p-2' }] },
    shallowEqual
  );

  assert.equal(afterProductsRefresh.changed, true);
  assert.equal(afterProductsRefresh.selection.products.length, 2);
});

test('shallow equality detects scalar UI preference changes', () => {
  assert.equal(
    shallowEqual(
      { activeTab: 'home', themeMode: 'dark' },
      { activeTab: 'home', themeMode: 'dark' }
    ),
    true
  );
  assert.equal(
    shallowEqual(
      { activeTab: 'home', themeMode: 'dark' },
      { activeTab: 'products', themeMode: 'dark' }
    ),
    false
  );
});
