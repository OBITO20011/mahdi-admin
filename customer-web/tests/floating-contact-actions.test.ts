import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/FloatingContactActions.tsx', import.meta.url), 'utf8');

test('desktop floating actions keep developer-approved Facebook and WhatsApp channels separate and accessible', () => {
  assert.match(source, /SEO_BRAND\.socialProfiles\[0\]/u);
  assert.match(source, /href=\{whatsappUrl\}/u);
  assert.match(source, /aria-label="متابعة محلات النواصرة على فيسبوك"/u);
  assert.match(source, /aria-label="التواصل عبر واتساب"/u);
  assert.match(source, /h-12 min-w-12/u);
});
