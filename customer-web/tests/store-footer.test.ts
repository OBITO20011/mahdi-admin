import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/StoreFooter.tsx', import.meta.url), 'utf8');

test('store footer exposes real navigation, contact, service, and trust destinations', () => {
  assert.match(source, /خبرة أكثر من 20 سنة/u);
  assert.match(source, /SEO_BRAND\.socialProfiles\[0\]/u);
  assert.match(source, /href=\{whatsappUrl\}/u);
  assert.match(source, /SEO_BRAND\.directionsUrl/u);
  assert.match(source, /متابعة الطلب/u);
  assert.match(source, /سياسة الخصوصية وحماية البيانات/u);
  assert.match(source, /getStorePagePath\(item\.page\)/u);
  assert.match(source, /min-h-11/u);
});
