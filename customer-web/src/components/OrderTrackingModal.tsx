import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  LoaderCircle,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  Phone,
  Truck,
  X,
} from 'lucide-react';
import {
  trackGuestOrder,
  trackGuestOrderByToken,
} from '../services/orders.service';
import type { GuestOrderTracking } from '../types/checkout';
import { formatJod } from '../utils/money';

const DELIVERY_STEPS = [
  'new',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
] as const;

const STATUS_LABELS: Record<string, string> = {
  new: 'وصلنا الطلب',
  confirmed: 'تمت مراجعة الطلب',
  preparing: 'جاري تجهيز الطلب',
  ready: 'الطلب جاهز للتوصيل',
  out_for_delivery: 'الطلب في الطريق إليك',
  completed: 'تم تسليم الطلب',
  returned: 'تم إرجاع الطلب ورد المبلغ',
  cancelled: 'تم إلغاء الطلب',
};

const TERMINAL_STATUSES = new Set(['completed', 'returned', 'cancelled']);

interface OrderTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackingToken?: string;
}

function formatDateTime(value?: string): string {
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

function calculateRemainingMinutes(value?: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 60_000));
}

function buildJordanWhatsAppPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('962')) return digits;
  return digits.startsWith('0') ? `962${digits.slice(1)}` : `962${digits}`;
}

export function OrderTrackingModal({
  isOpen,
  onClose,
  trackingToken = '',
}: OrderTrackingModalProps) {
  const [orderNumber, setOrderNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<GuestOrderTracking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const secureToken = trackingToken.trim();

  const loadByToken = useCallback(
    async (silent = false) => {
      if (!secureToken) return;
      if (!silent) setLoading(true);
      setError('');
      try {
        const nextResult = await trackGuestOrderByToken(secureToken);
        setResult(nextResult);
        setLastRefreshAt(new Date());
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'تعذر فتح رابط متابعة الطلب.'
        );
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [secureToken]
  );

  useEffect(() => {
    if (!isOpen || !secureToken) return;
    setResult(null);
    void loadByToken();
  }, [isOpen, loadByToken, secureToken]);

  useEffect(() => {
    if (
      !isOpen ||
      !secureToken ||
      (result && TERMINAL_STATUSES.has(result.status))
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadByToken(true);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [isOpen, loadByToken, result, secureToken]);

  const remainingMinutes = useMemo(
    () => calculateRemainingMinutes(result?.estimatedArrivalAt),
    [result?.estimatedArrivalAt]
  );

  if (!isOpen) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const nextResult = await trackGuestOrder(orderNumber, phone);
      setResult(nextResult);
      setLastRefreshAt(new Date());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'تعذر متابعة الطلب.'
      );
    } finally {
      setLoading(false);
    }
  };

  const copyTrackingLink = async () => {
    const token = result?.trackingToken || secureToken;
    if (!token) return;
    const url = `${window.location.origin}${window.location.pathname}#track=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('تعذر نسخ الرابط تلقائيًا.');
    }
  };

  const currentStepIndex = result
    ? DELIVERY_STEPS.indexOf(
        result.status as (typeof DELIVERY_STEPS)[number]
      )
    : -1;
  const isExceptionalStatus = result
    ? result.status === 'cancelled' || result.status === 'returned'
    : false;

  return (
    <div className="fixed inset-0 z-[70]" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق متابعة الطلب"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-tracking-title"
        className="absolute inset-x-3 top-1/2 mx-auto max-h-[92vh] max-w-xl -translate-y-1/2 overflow-y-auto rounded-[2rem] bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black text-blue-600">
              متابعة آمنة بدون تسجيل دخول
            </p>
            <h2
              id="order-tracking-title"
              className="mt-1 text-xl font-black text-slate-950"
            >
              أين وصل طلبك؟
            </h2>
            <p className="mt-2 text-[10px] font-bold leading-5 text-slate-500">
              تتحدث حالة الطلب تلقائيًا كل 30 ثانية.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!secureToken && !result && (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <p className="text-[10px] font-bold leading-5 text-slate-500">
              أدخل رقم الطلب ورقم الهاتف نفسه المستخدم عند الطلب.
            </p>
            <input
              required
              dir="ltr"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              placeholder="ORD-2026..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-bold outline-none focus:border-blue-400"
            />
            <input
              required
              dir="ltr"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="0791234567"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-bold outline-none focus:border-blue-400"
            />
            <button
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-4 py-3.5 text-sm font-black text-white disabled:bg-slate-300"
            >
              {loading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <PackageSearch className="h-4 w-4" />
              )}
              عرض حالة الطلب
            </button>
          </form>
        )}

        {loading && secureToken && !result && (
          <div className="mt-8 flex flex-col items-center gap-3 py-8 text-slate-500">
            <LoaderCircle className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-xs font-black">جاري تحميل حالة طلبك...</p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold text-rose-700"
          >
            {error}
          </p>
        )}

        {result && (
          <div className="mt-5 space-y-4">
            <div
              className={`rounded-3xl border p-4 ${
                isExceptionalStatus
                  ? 'border-rose-200 bg-rose-50'
                  : 'border-emerald-200 bg-emerald-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex items-center gap-2 ${
                    isExceptionalStatus
                      ? 'text-rose-800'
                      : 'text-emerald-800'
                  }`}
                >
                  {result.status === 'out_for_delivery' ? (
                    <Truck className="h-5 w-5" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                  <strong className="text-sm font-black">
                    {STATUS_LABELS[result.status] || result.status}
                  </strong>
                </div>
                {(result.trackingToken || secureToken) && (
                  <button
                    type="button"
                    onClick={copyTrackingLink}
                    className="flex items-center gap-1 rounded-xl bg-white/80 px-2.5 py-1.5 text-[9px] font-black text-slate-700 shadow-sm"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? 'تم النسخ' : 'نسخ الرابط'}
                  </button>
                )}
              </div>

              {result.status === 'out_for_delivery' &&
                result.estimatedArrivalAt && (
                  <div className="mt-4 rounded-2xl bg-white/85 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-blue-800">
                      <Clock3 className="h-5 w-5" />
                      <span className="text-xs font-black">
                        الوصول المتوقع {formatDateTime(result.estimatedArrivalAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] font-bold text-slate-600">
                      {remainingMinutes === null
                        ? 'يتم تحديث وقت الوصول من الإدارة.'
                        : remainingMinutes > 0
                          ? `متبقي تقريبًا ${remainingMinutes} دقيقة`
                          : 'موعد الوصول المتوقع الآن؛ قد يصل المندوب خلال لحظات.'}
                    </p>
                  </div>
                )}

              {result.status === 'out_for_delivery' && result.driverPhone && (
                <div className="mt-3 rounded-2xl border border-blue-100 bg-white/85 p-4 shadow-sm">
                  <p className="text-[10px] font-black text-slate-500">
                    رقم السائق المسؤول عن توصيل طلبك
                  </p>
                  <strong
                    dir="ltr"
                    className="mt-1 block font-mono text-base font-black text-slate-900"
                  >
                    {result.driverPhone}
                  </strong>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${result.driverPhone}`}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2.5 text-[10px] font-black text-white"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      اتصال بالسائق
                    </a>
                    <a
                      href={`https://wa.me/${buildJordanWhatsAppPhone(
                        result.driverPhone
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-[10px] font-black text-white"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      واتساب السائق
                    </a>
                  </div>
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-600">
                <span>
                  الطلب: <b dir="ltr">{result.orderNumber}</b>
                </span>
                <span>
                  الإجمالي: <b>{formatJod(result.totalInMinorUnits)}</b>
                </span>
                <span>
                  الأصناف: <b>{result.itemCount}</b>
                </span>
                <span>
                  الدفع:{' '}
                  <b>{result.paymentMethod === 'cliq' ? 'CliQ' : 'كاش'}</b>
                </span>
              </div>
            </div>

            {!isExceptionalStatus && (
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center gap-2 text-slate-900">
                  <PackageCheck className="h-4 w-4 text-blue-600" />
                  <h3 className="text-xs font-black">مراحل تنفيذ الطلب</h3>
                </div>
                <div className="space-y-0">
                  {DELIVERY_STEPS.map((status, index) => {
                    const isDone = index <= currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const historyEntry = [...result.timeline]
                      .reverse()
                      .find((entry) => entry.status === status);
                    return (
                      <div key={status} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span
                            className={`grid h-7 w-7 place-items-center rounded-full border-2 ${
                              isDone
                                ? 'border-blue-700 bg-blue-700 text-white'
                                : 'border-slate-200 bg-white text-slate-300'
                            }`}
                          >
                            {isDone ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            )}
                          </span>
                          {index < DELIVERY_STEPS.length - 1 && (
                            <span
                              className={`h-8 w-0.5 ${
                                index < currentStepIndex
                                  ? 'bg-blue-700'
                                  : 'bg-slate-200'
                              }`}
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 pb-4 pt-1">
                          <p
                            className={`text-[11px] font-black ${
                              isCurrent
                                ? 'text-blue-800'
                                : isDone
                                  ? 'text-slate-800'
                                  : 'text-slate-400'
                            }`}
                          >
                            {STATUS_LABELS[status]}
                          </p>
                          {historyEntry?.createdAt && (
                            <p className="mt-1 text-[9px] font-bold text-slate-400">
                              {formatDateTime(historyEntry.createdAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-center text-[9px] font-bold text-slate-400">
              آخر تحديث: {lastRefreshAt?.toLocaleTimeString('ar-JO') || 'الآن'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
