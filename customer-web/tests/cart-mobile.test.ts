import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cartDrawer = readFileSync(
  new URL('../src/components/CartDrawer.tsx', import.meta.url),
  'utf8'
);

test('mobile cart is a full-height independent screen with one contained scroll region', () => {
  assert.match(cartDrawer, /h-\[100dvh\]/);
  assert.match(cartDrawer, /data-cart-scroll-region/);
  assert.match(cartDrawer, /overscroll-contain/);
  assert.match(cartDrawer, /touch-pan-y/);
  assert.match(cartDrawer, /env\(safe-area-inset-bottom\)/);
});

test('opening the cart locks the storefront and restores its exact scroll position', () => {
  assert.match(cartDrawer, /body\.style\.position = 'fixed'/);
  assert.match(cartDrawer, /root\.style\.overflow = 'hidden'/);
  assert.match(cartDrawer, /body\.style\.top = `-\$\{scrollY\}px`/);
  assert.match(cartDrawer, /window\.scrollTo\(\{ top: scrollY, behavior: 'auto' \}\)/);
});

test('cart exposes dialog semantics for mobile assistive technology', () => {
  assert.match(cartDrawer, /role="dialog"/);
  assert.match(cartDrawer, /aria-modal="true"/);
  assert.match(cartDrawer, /aria-labelledby="cart-drawer-title"/);
});
