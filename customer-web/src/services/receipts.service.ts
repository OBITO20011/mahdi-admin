import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { PublicPosReceipt } from '../types/receipt';

type RpcRecord = Record<string, unknown>;

const recordValue = (value: unknown): RpcRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RpcRecord)
    : {};
const stringValue = (value: unknown) =>
  typeof value === 'string' ? value : '';
const integerValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

export async function fetchPublicPosReceipt(
  receiptToken: string
): Promise<PublicPosReceipt> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptToken)) {
    throw new Error('رابط الإيصال غير صحيح.');
  }

  const { data, error } = await supabase.rpc('get_public_pos_receipt', {
    p_receipt_token: receiptToken,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل الإيصال.');

  const payload = recordValue(data);
  if (payload.success !== true) {
    throw new Error(stringValue(payload.message) || 'الإيصال غير موجود.');
  }

  const branch = recordValue(payload.branch);
  return {
    orderNumber: stringValue(payload.orderNumber),
    createdAt: stringValue(payload.createdAt),
    status: stringValue(payload.status),
    paymentMethod: stringValue(payload.paymentMethod),
    paymentStatus: stringValue(payload.paymentStatus),
    subtotalInMinorUnits: integerValue(payload.subtotalInMinorUnits),
    discountInMinorUnits: integerValue(payload.discountInMinorUnits),
    totalInMinorUnits: integerValue(payload.totalInMinorUnits),
    branch: {
      name: stringValue(branch.name) || 'محلات النواصرة',
      address: stringValue(branch.address),
      phone: stringValue(branch.phone),
    },
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => {
          const row = recordValue(item);
          return {
            productName: stringValue(row.productName) || 'منتج',
            sku: stringValue(row.sku),
            packageQuantity: integerValue(row.packageQuantity),
            packageName: stringValue(row.packageName) || 'طرد',
            unitsPerPackage: integerValue(row.unitsPerPackage) || 1,
            packagePriceInMinorUnits: integerValue(
              row.packagePriceInMinorUnits
            ),
            lineTotalInMinorUnits: integerValue(row.lineTotalInMinorUnits),
          };
        })
      : [],
  };
}
