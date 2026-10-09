import type { OrderStatus } from '../../types';
import type { OperationalOrderListItem } from '../../services/supabase/orders.service';
import type { UiTone } from '../../components/ui';
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي', cash_on_delivery: 'نقدي عند الاستلام', cliq: 'CliQ', card: 'بطاقة',
  bank_transfer: 'تحويل بنكي', debt: 'على الحساب', mixed: 'مختلط',
};
export function getPaymentLabel(order: OperationalOrderListItem): { label: string; tone: UiTone } {
  if (order.status === 'cancelled' || order.status === 'expired') return { label: 'لا مبلغ للتحصيل', tone: 'mute' };
  if (order.paymentStatus === 'refunded') return { label: 'تم رد المبلغ', tone: 'warn' };
  if (order.paymentStatus === 'paid') return { label: 'مدفوع', tone: 'ok' };
  if (order.paymentStatus === 'partially_paid') return { label: `متبقي ${(order.amountDue || 0).toFixed(3)}`, tone: 'warn' };
  return { label: 'غير مدفوع', tone: 'bad' };
}
export const orderSourceLabel = (source?: string) => source === 'pos' ? 'الكاشير' : source === 'website' ? 'المتجر' : source || 'غير متاح';
export function getOrderStatus(status: OrderStatus | string): { label: string; tone: UiTone; border: string } {
  const badges: Record<string, { label: string; tone: UiTone; border: string }> = {
    new: { label: 'جديد', tone: 'info', border: 'border-s-nw-info' },
    confirmed: { label: 'مؤكد', tone: 'warn', border: 'border-s-nw-warn' },
    preparing: { label: 'قيد التجهيز', tone: 'warn', border: 'border-s-nw-warn' },
    processing: { label: 'قيد التجهيز', tone: 'warn', border: 'border-s-nw-warn' },
    ready: { label: 'جاهز', tone: 'ok', border: 'border-s-nw-ok' },
    out_for_delivery: { label: 'خرج للتوصيل', tone: 'info', border: 'border-s-nw-info' },
    delivered: { label: 'مكتمل', tone: 'ok', border: 'border-s-nw-ok' },
    completed: { label: 'مكتمل', tone: 'ok', border: 'border-s-nw-ok' },
    returned: { label: 'مرتجع', tone: 'warn', border: 'border-s-nw-warn' },
    cancelled: { label: 'ملغي', tone: 'mute', border: 'border-s-nw-muted' },
    expired: { label: 'انتهت مهلة الحجز', tone: 'mute', border: 'border-s-nw-muted' },
  };
  return badges[status] ?? { label: status, tone: 'mute', border: 'border-s-nw-muted' };
}
