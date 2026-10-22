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
      'https://alnawasreh.com/#receipt=11111111-1111-4111-8111-111111111111',
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
  const dialog=readFileSync('src/features/receipts/SaleReceiptDialog.tsx','utf8');
  const template=readFileSync('customer-web/src/receipts/ReceiptDocument.tsx','utf8');
  assert.match(dialog, /window\.print\(\)/);
  assert.match(view, /navigator\.share/);
  assert.match(view, /getOrCreatePublicPosReceiptUrlFromSupabase/);
  assert.match(dialog, /نسخ الرابط/);
  assert.match(view, /api\.whatsapp\.com\/send/);
  assert.match(template, /@page \{ size:80mm auto/);
  assert.doesNotMatch(view, /جاري إرسال الأمر لطابعة/);
  assert.doesNotMatch(view, /تم إنشاء رابط الإيصال الإلكتروني/);
});

test('saved base-unit name wins over product package label in print/share',()=>{
 const text=buildReceiptShareText({businessName:'النواصرة',branchName:'اختبار',invoiceNumber:'POS-UNIT',customerName:'',createdAt:'2026-10-11T12:00:00Z',
   items:[{productName:'مياه',quantity:2,unit:'قنينة',salePackage:'صندوق',totalPrice:1},{productName:'رز',quantity:1,unit:'شوال',salePackage:'طرد',totalPrice:10}],
   subtotal:11,discount:0,totalAmount:11,paymentMethod:'cash',paidAmount:11,remainingAmount:0,changeDue:0});
 assert.match(text,/مياه: 2 قنينة/);assert.match(text,/رز: 1 شوال/);
 const view=readFileSync('src/features/pos/PosView.tsx','utf8');
 assert.match(view,/SaleReceiptDialog/);
 const adapter=readFileSync('src/features/receipts/saleReceipt.ts','utf8');assert.match(adapter,/baseUnitName:item.baseUnitName/);
});
