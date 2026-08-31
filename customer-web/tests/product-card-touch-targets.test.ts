import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const productCard = readFileSync(
  new URL('../src/components/ProductCard.tsx', import.meta.url),
  'utf8',
);

test('product card keeps favorite and quantity controls at 44px touch targets', () => {
  assert.match(productCard, /grid h-11 w-11 place-items-center rounded-xl border border-white/);
  assert.match(productCard, /grid h-11 w-11 place-items-center text-slate-600/);
  assert.match(productCard, /grid h-11 w-11 place-items-center text-blue-700/);
  assert.match(productCard, /<Heart className=\{`h-4 w-4/);
  assert.match(productCard, /<Minus className="h-3\.5 w-3\.5" \/>/);
  assert.match(productCard, /<Plus className="h-3\.5 w-3\.5" \/>/);
});

test('product card keeps the mobile summary compact while preserving detail access', () => {
  assert.match(productCard, /aspect-square w-full.*sm:aspect-\[4\/3\]/);
  assert.match(productCard, /line-clamp-2 text-\[11px\]/);
  assert.match(productCard, /hidden h-11 w-11 place-items-center.*sm:grid/);
  assert.match(productCard, /sm:hidden/);
  assert.match(productCard, /aria-label=\{`اختيار نكهة \$\{product\.nameAr\}`\}/);
});
