import { CloudAlert, RefreshCw, WifiOff } from 'lucide-react';

interface NetworkStatusBannerProps {
  isOnline: boolean;
  refreshError: string | null;
  lastUpdatedAt: Date | null;
  isRetrying: boolean;
  onRetry: () => void;
}

export function NetworkStatusBanner({
  isOnline,
  refreshError,
  lastUpdatedAt,
  isRetrying,
  onRetry,
}: NetworkStatusBannerProps) {
  if (isOnline && !refreshError) return null;

  const isOffline = !isOnline;
  const Icon = isOffline ? WifiOff : CloudAlert;
  const lastUpdatedLabel = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('ar-JO', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      role={isOffline ? 'alert' : 'status'}
      aria-live="polite"
      className={`border-b px-4 py-3 ${
        isOffline
          ? 'border-amber-200 bg-amber-50 text-amber-950'
          : 'border-rose-200 bg-rose-50 text-rose-950'
      }`}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between lg:px-4">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-xs font-black">
              {isOffline
                ? 'لا يوجد اتصال بالإنترنت حاليًا'
                : 'تعذر تحديث الأسعار والمخزون الآن'}
            </p>
            <p className="mt-0.5 text-[10px] font-bold leading-5 opacity-75">
              {lastUpdatedLabel
                ? `نعرض آخر بيانات ناجحة من الساعة ${lastUpdatedLabel}. سنحدّثها تلقائيًا عند عودة الاتصال.`
                : 'تحقق من الاتصال ثم أعد المحاولة لعرض الكتالوج المباشر.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying || isOffline}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-xl border border-current/20 bg-white/70 px-3 py-2 text-[10px] font-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`}
          />
          {isRetrying ? 'جارٍ التحديث...' : 'إعادة التحديث'}
        </button>
      </div>
    </div>
  );
}
