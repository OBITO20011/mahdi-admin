import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync('src/App.tsx', 'utf8');
const publicRoutes = readFileSync('src/utils/publicRoutes.ts', 'utf8');
const service = readFileSync('src/services/receipts.service.ts', 'utf8');
const page = readFileSync('src/components/PublicPosReceiptPage.tsx', 'utf8');

test('store opens a dedicated public receipt page from an unguessable hash token', () => {
  assert.match(publicRoutes, /readUuidHash\(location\.hash, 'receipt'\)/);
  assert.match(app, /PublicPosReceiptPage/);
  assert.match(service, /rpc\('get_public_pos_receipt'/);
  assert.match(service, /\[0-9a-f\]\{8\}/);
});

test('public receipt supports Arabic print and sharing without private fields', () => {
  assert.match(page, /إيصال إلكتروني موثّق/);
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /navigator\.share/);
  assert.match(page, /@page \{ size: A4 portrait/);
  assert.doesNotMatch(page, /customerPhone|customerAddress|costPrice|profit/);
});
