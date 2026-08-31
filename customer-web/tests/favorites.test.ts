import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const storefrontApp = readFileSync(
  new URL('../src/App.tsx', import.meta.url),
  'utf8'
);

test('favorites have a dedicated hash route and do not reuse catalog-only filtering', () => {
  assert.match(
    storefrontApp,
    /type StorePage = 'home' \| 'categories' \| 'catalog' \| 'favorites' \| 'offers'/
  );
  assert.match(storefrontApp, /window\.location\.hash === '#favorites'/);
  assert.match(storefrontApp, /navigateStorePage\('favorites'\)/);
  assert.match(storefrontApp, /activePage === 'favorites'/);
  assert.doesNotMatch(storefrontApp, /favoritesOnly/);
});

test('favorites keep missing IDs safe and render an explicit empty state', () => {
  assert.match(storefrontApp, /data-testid="favorites-empty-state"/);
  assert.match(storefrontApp, /مفضلتك فارغة حاليًا/);
  assert.match(storefrontApp, /تصفح المنتجات/);
  assert.match(storefrontApp, /لم نعرض معلومات قديمة عن السعر أو التوفر/);
  assert.match(storefrontApp, /أبقيناها في قائمتك ولم نحذفها تلقائيًا/);
});
