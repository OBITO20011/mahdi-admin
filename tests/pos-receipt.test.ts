import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildReceiptShareText,
  paymentMethodLabel,
} from '../src/utils/receipt';

test('POS receipt share text contains the saved wholesale sale details', () => {
  const text = buildReceiptShareText({
    businessName: 'محلات النواصرة',
    branchName: 'محلات النواصرة - الرمثا',
    invoiceNumber: 'POS-1001',
    customerName: 'عميل اختبار',
    createdAt: '2026-08-20T10:00:00.000Z',
    items: [
      {
        productName: 'مياه',
        quantity: 2,
        salePackage: 'صندوق',
        totalPrice: 8,
      },
    ],
    subtotal: 8,
    discount: 0,
    totalAmount: 8,
    paymentMethod: 'cliq',
    paidAmount: 8,
    remainingAmount: 0,
    changeDue: 0,
    publicReceiptUrl:
      'https://nawasrah-store.pages.dev/#receipt=11111111-1111-4111-8111-111111111111',
  });

  assert.match(text, /POS-1001/);
  assert.match(text, /مياه: 2 صندوق/);
  assert.match(text, /8\.000 د\.أ/);
  assert.match(text, /CliQ/);
  assert.match(text, /رابط الإيصال الإلكتروني/);
  assert.match(text, /#receipt=/);
  assert.equal(paymentMethodLabel('debt'), 'آجل على حساب العميل');
});

test('POS buttons print and share instead of showing simulated alerts', () => {
  const view = readFileSync('src/features/pos/PosView.tsx', 'utf8');
  assert.match(view, /window\.print\(\)/);
  assert.match(view, /navigator\.share/);
  assert.match(view, /getOrCreatePublicPosReceiptUrlFromSupabase/);
  assert.match(view, /نسخ الرابط/);
  assert.match(view, /api\.whatsapp\.com\/send/);
  assert.match(view, /@page \{ size: 80mm auto/);
  assert.doesNotMatch(view, /جاري إرسال الأمر لطابعة/);
  assert.doesNotMatch(view, /تم إنشاء رابط الإيصال الإلكتروني/);
});
