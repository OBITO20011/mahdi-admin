import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/App.tsx'),
  'utf8'
);

function repeatLastOrderBlock(): string {
  const start = appSource.indexOf('const repeatLastOrder = () => {');
  const end = appSource.indexOf('\n\n  return (', start);
  assert.ok(start >= 0, 'repeatLastOrder handler must exist');
  assert.ok(end > start, 'repeatLastOrder handler must end before the render');
  return appSource.slice(start, end);
}

test('repeat-last-order fetches only saved product IDs from the server snapshot', () => {
  const handler = repeatLastOrderBlock();
  assert.match(
    handler,
    /fetchPublicCartSnapshot\(\s*lastGuestOrder\.items\.map\(\(item\) => item\.productId\)/
  );
  assert.match(handler, /restoreLastOrderFromSnapshot\(/);
  assert.doesNotMatch(handler, /sellableProducts/);
});

test('repeat-last-order makes unavailable and reduced quantities visible to the customer', () => {
  const handler = repeatLastOrderBlock();
  assert.match(handler, /لم تعد متاحة للبيع ولم تُضف إلى السلة/);
  assert.match(handler, /تم تعديل كمية بعض الأصناف إلى المتاح حاليًا/);
  assert.match(handler, /بالأسعار الحالية/);
});

test('repeat-last-order coalesces a second click while its bounded snapshot is pending', () => {
  const handler = repeatLastOrderBlock();
  assert.match(handler, /pendingRepeatLastOrderRef\.current/);
  assert.match(appSource, /disabled=\{isRepeatingLastOrder\}/);
});
