import { Check, PackageCheck } from 'lucide-react';

interface TrackingTimelineEntry {
  status: string;
  createdAt: string;
}

interface OrderTrackingTimelineProps {
  entries: TrackingTimelineEntry[];
}

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

export function OrderTrackingTimeline({
  entries,
}: OrderTrackingTimelineProps) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 flex items-center gap-2 text-slate-900">
        <PackageCheck className="h-4 w-4 text-blue-600" />
        <h3 className="text-xs font-black">مراحل تنفيذ الطلب</h3>
      </div>
      <div className="space-y-0">
        {entries.map((entry, index) => {
          const isCurrent = index === entries.length - 1;
          const isExceptionalEntry =
            entry.status === 'cancelled' || entry.status === 'returned';
          return (
            <div
              key={`${entry.status}-${entry.createdAt}-${index}`}
              className="flex gap-3"
            >
              <div className="flex flex-col items-center">
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full border-2 ${
                    isExceptionalEntry
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-blue-700 bg-blue-700 text-white'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                {index < entries.length - 1 && (
                  <span className="h-8 w-0.5 bg-blue-700" />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-4 pt-1">
                <p
                  className={`text-[11px] font-black ${
                    isExceptionalEntry
                      ? 'text-rose-800'
                      : isCurrent
                        ? 'text-blue-800'
                        : 'text-slate-800'
                  }`}
                >
                  {ORDER_STATUS_LABELS[entry.status] || entry.status}
                </p>
                <p className="mt-1 text-[9px] font-bold text-slate-400">
                  {formatTrackingDateTime(entry.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
