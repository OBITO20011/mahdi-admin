import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(
  new URL('../src/components/MerchandisingSections.tsx', import.meta.url),
  'utf8'
);

test('home merchandising rails support touch, buttons and direct product details', () => {
  assert.match(component, /aria-roledescription="carousel"/);
  assert.match(component, /onPointerDown/);
  assert.match(component, /scrollIntoView/);
  assert.match(component, /onOpenProduct\(product\)/);
  assert.match(component, /المنتج السابق/);
  assert.match(component, /المنتج التالي/);
});

test('carousel motion is calm and respects reduced-motion preference', () => {
  assert.match(component, /5_200/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /document\.hidden/);
  assert.match(component, /pauseUntilRef/);
});

test('merchandising sections still use the live catalog product payload', () => {
  assert.match(component, /product\.availableSalePackages/);
  assert.match(component, /product\.salePackagePriceInMinorUnits/);
  assert.match(component, /product\.imageUrl/);
  assert.doesNotMatch(component, /mock|placeholder/i);
});

test('carousel controls have 44px targets while pagination dots stay visually compact', () => {
  assert.match(component, /grid h-11 w-11 place-items-center rounded-xl border/);
  assert.match(component, /grid h-11 w-11 place-items-center rounded-xl transition/);
  assert.match(component, /aria-current=\{index === activeIndex \? 'true' : undefined\}/);
  assert.match(component, /<span className=\{`h-1\.5 rounded-full/);
});
