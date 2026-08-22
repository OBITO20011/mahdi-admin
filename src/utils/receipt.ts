import type { PaymentMethod } from '../types';

export interface ReceiptShareItem {
  productName: string;
  quantity: number;
  salePackage?: string;
  unit?: string;
  totalPrice: number;
}

export interface ReceiptShareInput {
  businessName: string;
  branchName: string;
  invoiceNumber: string;
  customerName: string;
  createdAt: string;
  items: ReceiptShareItem[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  remainingAmount: number;
  changeDue: number;
  publicReceiptUrl?: string;
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return (
    {
      cash: 'كاش',
      cash_on_delivery: 'كاش عند الاستلام',
      cliq: 'CliQ',
      card: 'بطاقة',
      bank_transfer: 'تحويل بنكي',
      debt: 'آجل على حساب العميل',
      mixed: 'دفع مختلط',
    }[method] || method
  );
}

const money = (value: number) => `${value.toFixed(3)} د.أ`;

export function buildReceiptShareText(input: ReceiptShareInput): string {
  const lines = input.items.map(
    (item) =>
      `• ${item.productName}: ${item.quantity} ${item.salePackage || item.unit || 'طرد'} - ${money(item.totalPrice)}`
  );

  return [
    input.businessName,
    input.branchName,
    `إيصال البيع رقم: ${input.invoiceNumber}`,
    `التاريخ: ${new Date(input.createdAt).toLocaleString('ar-JO')}`,
    `العميل: ${input.customerName || 'زبون نقدي'}`,
    '',
    ...lines,
    '',
    `المجموع الفرعي: ${money(input.subtotal)}`,
    input.discount > 0 ? `الخصم: ${money(input.discount)}` : '',
    `الإجمالي: ${money(input.totalAmount)}`,
    `طريقة الدفع: ${paymentMethodLabel(input.paymentMethod)}`,
    input.remainingAmount > 0
      ? `المتبقي على العميل: ${money(input.remainingAmount)}`
      : '',
    input.changeDue > 0 ? `الباقي للعميل: ${money(input.changeDue)}` : '',
    input.publicReceiptUrl ? `رابط الإيصال الإلكتروني: ${input.publicReceiptUrl}` : '',
    '',
    'شكرًا لتعاملكم مع محلات النواصرة.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
