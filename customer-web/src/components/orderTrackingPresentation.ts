export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'وصلنا الطلب',
  pending_confirmation: 'بانتظار تأكيد الطلب',
  confirmed: 'تمت مراجعة الطلب',
  preparing: 'جاري تجهيز الطلب',
  processing: 'جاري تجهيز الطلب',
  ready: 'الطلب جاهز للتوصيل',
  out_for_delivery: 'الطلب في الطريق إليك',
  delivered: 'تم تسليم الطلب',
  completed: 'تم تسليم الطلب',
  returned: 'تم إرجاع الطلب ورد المبلغ',
  cancelled: 'تم إلغاء الطلب',
  expired: 'انتهت مهلة حجز هذا الطلب',
};

export function formatTrackingDateTime(value?: string): string {
  if (!value) return 'غير محدد';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'غير محدد';
  return parsed.toLocaleString('ar-JO', {
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}
