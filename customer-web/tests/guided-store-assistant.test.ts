import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('guided store assistant is a local, guided surface with the required safe actions', () => {
  const assistant = read('../src/components/GuidedStoreAssistant.tsx');

  for (const label of [
    'تصفح المنتجات',
    'العروض الحالية',
    'تتبع طلبي',
    'مناطق ورسوم التوصيل',
    'طرق الدفع',
    'الأسئلة الشائعة',
    'تواصل عبر WhatsApp',
  ]) {
    assert.match(assistant, new RegExp(label, 'u'));
  }

  assert.match(assistant, /event\.key === 'Escape'/u);
  assert.match(assistant, /aria-modal="true"/u);
  assert.match(assistant, /prefers-reduced-motion|motion-reduce/u);
  assert.doesNotMatch(assistant, /supabase|\.rpc\(|fetch\(|localStorage|customerPhone|customerAddress|inventory|supplier|WAC/iu);
});

test('assistant uses the established navigation, tracking and WhatsApp paths without touching checkout', () => {
  const app = read('../src/App.tsx');
  const productDetails = read('../src/components/ProductDetailsModal.tsx');

  assert.match(app, /<GuidedStoreAssistant/u);
  assert.match(app, /onBrowseProducts=\{showAllProducts\}/u);
  assert.match(app, /onOpenOffers=\{openPromotionOffers\}/u);
  assert.match(app, /onTrackOrder=\{\(\) => setTrackingOpen\(true\)\}/u);
  assert.match(app, /whatsappUrl=\{storeWhatsappUrl\}/u);
  assert.match(app, /settings=\{settingsTrusted \? storefrontSettings : null\}/u);
  assert.match(productDetails, /onOpenAssistant/u);
  assert.doesNotMatch(assistantCheckoutSlice(app), /GuidedStoreAssistant/u);
});

function assistantCheckoutSlice(app: string): string {
  const start = app.indexOf('<CheckoutModal');
  const end = app.indexOf('<OrderTrackingModal');
  return start >= 0 && end > start ? app.slice(start, end) : '';
}
