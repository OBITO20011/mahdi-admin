import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductGlyph, SegmentedControl, StickyActionBar } from '../src/components/ui';

const pos = readFileSync('src/features/pos/PosView.tsx', 'utf8');
test('POS token presentation preserves V2,open shift,recovery and all authority request fields', () => {
  for (const contract of ['runPosV2Attempt(supabase, currentUser.id, intent, request)', "await executeSale('START_NEW', request)",
    "executeSale('RECOVER_EXISTING')", 'lines: posCartLines(cartItems)', 'discountInMinorUnits: jodToMinorUnits(discountAmount)',
    'idempotencyKey: crypto.randomUUID()', 'cartWarehouseRef.current !== warehouseId || !cartFits(cartItems)',
    'if (!openPosShift)', "paymentMethod === 'debt' && !selectedCustomerId", 'inspectOrCancelPosV2Attempt(supabase,currentUser.id,true)']) assert.ok(pos.includes(contract), contract);
  assert.doesNotMatch(pos, /(?:bg|text|border|outline)-(?:slate|blue|gray|emerald|amber|red|rose)-\d/);
  assert.doesNotMatch(pos, /fetchCustomerDetails|بطاقة 💳/);
  assert.match(pos, /data-testid="pos-customer-debt"/);
  assert.match(pos, /selectedPosCustomer\.currentBalance > selectedPosCustomer\.creditLimit/);
  assert.match(pos, /<SearchField emphasis ref=\{searchInputRef\}/);
  assert.match(pos, /<StickyActionBar tone="hero"/);
  assert.match(pos, /lg:grid-cols-\[repeat\(auto-fill,minmax\(190px,1fr\)\)\]/);
  assert.match(pos, /event\.key === 'Enter' && event\.repeat/);
  assert.match(pos, /searchInputRef\.current\?\.focus\(\{preventScroll: true\}\)/);
});
test('product initial/photo comes from real name/image and uses only decorative tokens', () => {
  const initial = renderToStaticMarkup(React.createElement(ProductGlyph, { name: 'عصير', className: 'h-14 w-14' }));
  assert.match(initial, /aria-hidden="true"/); assert.match(initial, />ع<\/span>/); assert.match(initial, /bg-nw-/);
  const photo = renderToStaticMarkup(React.createElement(ProductGlyph, { name: 'عصير', image: '/test.png' }));
  assert.match(photo, /src="\/test.png"/); assert.match(photo, /alt=""/);
});
test('segmented busy guard is opt-in and sticky hero does not change existing surface default', () => {
  const options = [{ value: 'packet', label: 'باكيت' }, { value: 'carton', label: 'كرتونة' }];
  const disabled = renderToStaticMarkup(React.createElement(SegmentedControl, { label: 'وحدة', value: 'packet', options, onChange: () => undefined, disabled: true, touchSize: true }));
  assert.equal((disabled.match(/disabled=""/g) ?? []).length, 2);
  const normal = renderToStaticMarkup(React.createElement(SegmentedControl, { label: 'وحدة', value: 'packet', options, onChange: () => undefined }));
  assert.doesNotMatch(normal, /disabled=/); assert.match(normal, /h-\[38px\]/);
  assert.match(renderToStaticMarkup(React.createElement(StickyActionBar, {}, 'بيع')), /bg-nw-surface text-nw-text/);
  assert.match(renderToStaticMarkup(React.createElement(StickyActionBar, { tone: 'hero' }, 'بيع')), /bg-nw-hero text-nw-side-text/);
});
test('below-lg cart is one guarded focus-stack sheet;desktop panel remains non-modal', () => {
  const panel = readFileSync('src/components/ui/ResponsiveCartPanel.tsx', 'utf8');
  assert.match(panel, /max-width: 1023px/); assert.match(panel, /useDialogFocus\(modal/);
  assert.match(panel, /if \(!busy\) onClose\(\)/); assert.match(panel, /role=\{modal \? 'dialog'/);
  assert.match(panel, /aria-busy=\{busy\}/); assert.match(panel, /fixed inset-0 z-50/);
  assert.match(panel, /min-h-0 flex-1[\s\S]*overflow-y-auto/);
  assert.match(pos, /showReceiptModal\) setIsCartOpen\(false\)/);
});
