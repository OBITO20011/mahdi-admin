import React, { useCallback, useState, useSyncExternalStore } from 'react';
import {
  AlertTriangle,
  Banknote,
  BookUser,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  MessageCircle,
  PackageCheck,
  Phone,
  Printer,
  ReceiptText,
  RotateCcw,
  Smartphone,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { MoneyText, StatusBadge, UiButton, formatUiDate } from '../../components/ui';
import { getOrderStatus, PAYMENT_METHOD_LABELS } from './orderStatus';
import { OrderCommercialSummary } from './OrderCommercialSummary';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { CURRENCY } from '../../constants';
import { useAppStoreActions } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import { CustomerLocationCard } from './CustomerLocationCard';
import { EditAddressModal } from './EditAddressModal';
import { AdminAftercarePanel } from './AdminAftercarePanel';
import { buildStorefrontTrackingUrl } from '../../services/supabase/orders.service';
import type { AdminAftercareCapability } from '../../services/supabase/salesAftercare.service';

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
  onOrderChanged?: () => Promise<void>;
  embedded?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'طلب جديد',
  confirmed: 'مؤكد',
  preparing: 'قيد التجهيز',
  processing: 'قيد التجهيز',
  ready: 'جاهز للتوصيل',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'مكتمل',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  returned: 'مرتجع',
  expired: 'انتهت مهلة الحجز',
};



function nextOrderStep(status: OrderStatus) {
  if (status === 'confirmed') {
    return {
      status: 'preparing' as OrderStatus,
      label: 'بدء تجهيز الطلب',
      icon: PackageCheck,
      color: 'bg-nw-primary hover:bg-nw-primary',
    };
  }
  if (status === 'preparing' || status === 'processing') {
    return {
      status: 'out_for_delivery' as OrderStatus,
      label: 'بدء التوصيل',
      icon: Truck,
      color: 'bg-nw-primary hover:bg-nw-primary',
    };
  }
  if (status === 'ready') {
    return {
      status: 'out_for_delivery' as OrderStatus,
      label: 'خرج الطلب للتوصيل',
      icon: Truck,
      color: 'bg-nw-primary hover:bg-nw-primary',
    };
  }
  if (status === 'out_for_delivery') {
    return {
      status: 'delivered' as OrderStatus,
      label: 'تأكيد التسليم وخصم المخزون',
      icon: CheckCircle2,
      color: 'bg-nw-primary hover:bg-nw-primary',
    };
  }
  return null;
}

function normalizeJordanianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('962')
    ? `0${digits.slice(3)}`
    : digits.startsWith('0')
      ? digits
      : `0${digits}`;
  return /^07[789]\d{7}$/.test(local) ? local : null;
}

const subscribePhoneViewport = (notify: () => void) => {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const isPhoneViewport = () => window.matchMedia('(max-width: 767px)').matches;

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order,
  onClose,
  onOrderChanged,
  embedded = false,
}) => {
  const {
    confirmOrder,
    cancelOrder,
    advanceOrderStatus,
    startOrUpdateOrderDelivery,
    completeWebsiteOrderWithSettlement,
    openCustomerProfile,
    setToast,
  } = useAppStoreActions();

  const [busy, setBusy] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showEditAddress, setShowEditAddress] = useState(false);
  const [showPaymentConfirmation, setShowPaymentConfirmation] =
    useState(false);
  const [collectedBy, setCollectedBy] = useState<'cash' | 'cliq'>(
    order.paymentMethod === 'cliq' ? 'cliq' : 'cash'
  );
  const [settlementMode, setSettlementMode] = useState<
    'full' | 'partial' | 'debt'
  >('full');
  const [partialAmount, setPartialAmount] = useState('');
  const [deliveryFeeInput, setDeliveryFeeInput] = useState(
    String(order.deliveryFee || 0)
  );
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [aftercareCapability, setAftercareCapability] =
    useState<AdminAftercareCapability | null>(null);
  const [showDeliveryEtaForm, setShowDeliveryEtaForm] = useState(false);
  const [deliveryEtaMinutes, setDeliveryEtaMinutes] = useState(30);
  const [deliveryDriverPhone, setDeliveryDriverPhone] = useState(
    order.deliveryDriverPhone || ''
  );
  const [latestTrackingUrl, setLatestTrackingUrl] = useState('');
  const nextStep = nextOrderStep(order.status);
  const phoneViewport = useSyncExternalStore(subscribePhoneViewport, isPhoneViewport, () => false);
  const fullScreenDetail = embedded && phoneViewport;
  const detailFocus = useDialogFocus(!embedded || fullScreenDetail, () => { if (!busy) onClose(); }, true);
  const handleAftercareContract = useCallback((capability: AdminAftercareCapability | null) => {
    setAftercareCapability(capability);
  }, []);
  const parsedDeliveryFee = Number(deliveryFeeInput);
  const settlementDeliveryFee = Number.isFinite(parsedDeliveryFee)
    ? parsedDeliveryFee
    : 0;
  const settlementTotal = Math.max(
    0,
    order.subtotal - order.discount + settlementDeliveryFee
  );
  const parsedPartialAmount = Number(partialAmount);
  const settlementCollectedAmount =
    settlementMode === 'full'
      ? settlementTotal
      : settlementMode === 'debt'
        ? 0
        : Number.isFinite(parsedPartialAmount)
          ? parsedPartialAmount
          : 0;
  const settlementRemaining = Math.max(
    0,
    settlementTotal - settlementCollectedAmount
  );
  const canCancel = ![
    'completed',
    'delivered',
    'cancelled',
    'returned',
  ].includes(
    order.status
  );

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onOrderChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      setToast('اكتب سبب إلغاء الطلب قبل المتابعة.', 'error');
      return;
    }
    await runAction(() => cancelOrder(order.id, cancelReason.trim()));
    setShowCancelForm(false);
  };

  const handleConfirmPaymentAndDelivery = async () => {
    if (!Number.isFinite(parsedDeliveryFee) || parsedDeliveryFee < 0) {
      setToast('أجرة التوصيل يجب أن تكون صفرًا أو أكثر.', 'error');
      return;
    }
    if (
      settlementMode === 'partial' &&
      (!Number.isFinite(parsedPartialAmount) ||
        parsedPartialAmount <= 0 ||
        parsedPartialAmount >= settlementTotal)
    ) {
      setToast(
        `الدفعة الجزئية يجب أن تكون أكبر من صفر وأقل من ${settlementTotal.toFixed(3)} ${CURRENCY}.`,
        'error'
      );
      return;
    }
    if (
      settlementMode !== 'debt' &&
      collectedBy === 'cliq' &&
      !paymentReference.trim()
    ) {
      setToast('اكتب رقم مرجع عملية CliQ قبل تأكيد القبض.', 'error');
      return;
    }

    setBusy(true);
    try {
      const success = await completeWebsiteOrderWithSettlement({
        orderId: order.id,
        paymentMethod:
          settlementMode === 'debt' ? 'debt' : collectedBy,
        amountCollected: settlementCollectedAmount,
        deliveryFee: settlementDeliveryFee,
        referenceNumber: paymentReference.trim(),
        notes: paymentNotes.trim(),
      });
      if (success) {
        setShowPaymentConfirmation(false);
        await onOrderChanged?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleStartOrUpdateDelivery = async () => {
    if (!Number.isInteger(deliveryEtaMinutes) || deliveryEtaMinutes < 5 || deliveryEtaMinutes > 360) {
      setToast('وقت الوصول المتوقع يجب أن يكون بين 5 و360 دقيقة.', 'error');
      return;
    }

    const normalizedDriverPhone = normalizeJordanianPhone(
      deliveryDriverPhone
    );
    if (!normalizedDriverPhone) {
      setToast(
        'أدخل رقم سائق أردني صحيح، مثل 0791234567.',
        'error'
      );
      return;
    }

    setBusy(true);
    try {
      const result = await startOrUpdateOrderDelivery(
        order.id,
        deliveryEtaMinutes,
        normalizedDriverPhone
      );
      if (result.success) {
        setLatestTrackingUrl(result.trackingUrl || '');
        setDeliveryDriverPhone(
          result.driverPhone || normalizedDriverPhone
        );
        setShowDeliveryEtaForm(false);
        await onOrderChanged?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const copyTrackingLink = async () => {
    const trackingUrl =
      latestTrackingUrl ||
      (order.trackingToken
        ? buildStorefrontTrackingUrl(order.trackingToken)
        : '');
    if (!trackingUrl) {
      setToast('رابط التتبع غير متاح لهذا الطلب بعد.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(trackingUrl);
      setToast('تم نسخ رابط تتبع الطلب لإرساله إلى العميل.');
    } catch {
      setToast('تعذر نسخ الرابط على هذا الجهاز.', 'error');
    }
  };


  const phoneDigits = order.customerPhone.replace(/\D/g, '');
  const whatsappPhone = phoneDigits.startsWith('962')
    ? phoneDigits
    : phoneDigits.startsWith('0')
    ? `962${phoneDigits.slice(1)}`
    : `962${phoneDigits}`;
  const currentTrackingUrl =
    latestTrackingUrl ||
    (order.trackingToken
      ? buildStorefrontTrackingUrl(order.trackingToken)
      : '');
  const currentDriverPhone =
    order.deliveryDriverPhone || deliveryDriverPhone;
  const normalizedDriverPhone = normalizeJordanianPhone(currentDriverPhone);
  const trackingMessage = currentTrackingUrl
    ? [
        `مرحبًا ${order.customerName}،`,
        `طلبك رقم ${order.orderNumber} خرج للتوصيل.`,
        order.estimatedArrivalAt
          ? `وقت الوصول المتوقع: ${new Date(
              order.estimatedArrivalAt
            ).toLocaleTimeString('ar-JO-u-nu-latn', {
              hour: '2-digit',
              minute: '2-digit',
            })}`
          : '',
        normalizedDriverPhone
          ? `رقم السائق: ${normalizedDriverPhone}`
          : '',
        `تابع حالة الطلب من هنا: ${currentTrackingUrl}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const trackingWhatsAppUrl =
    whatsappPhone && trackingMessage
      ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(
          trackingMessage
        )}`
      : '';
  const focusActionArea = (openAction: () => void) => {
    openAction();
    window.requestAnimationFrame(() => {
      document
        .getElementById(`order-action-area-${order.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div ref={detailFocus as React.RefObject<HTMLDivElement>} role={!embedded || fullScreenDetail ? 'dialog' : undefined} aria-modal={!embedded || fullScreenDetail ? true : undefined} aria-label={`تفاصيل الطلب ${order.orderNumber}`} aria-busy={busy} className="order-detail space-y-4 break-words text-sm text-nw-text">
      {embedded && <header className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-nw-border bg-nw-bg p-4 pt-[max(1rem,env(safe-area-inset-top))] md:hidden">
        <UiButton aria-label="رجوع للطلبات" onClick={onClose} disabled={busy}><ChevronRight className="h-4 w-4" />رجوع للطلبات</UiButton>
      </header>}
      <div className="flex items-start justify-between border-b border-nw-border pb-3">
        <div>
          <bdi dir="ltr" className="select-text font-mono text-[11px] font-black text-nw-info">
            {order.orderNumber}
          </bdi>
          <h3 className="text-sm font-black text-nw-text">{order.customerName}</h3>
          <span className="text-[10px] text-nw-muted">
            {formatUiDate(order.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge tone={getOrderStatus(order.status).tone}>{STATUS_LABELS[order.status] || order.status}</StatusBadge>
          <UiButton
            type="button"
            onClick={onClose}
            disabled={busy} className="min-h-11 min-w-11 rounded-full bg-nw-surface-2 p-2 text-nw-muted"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </UiButton>
        </div>
      </div>

      <bdi dir="ltr" className="block text-xs text-nw-muted">{order.customerPhone || 'لا يوجد رقم هاتف'}</bdi>
      <p className="text-xs text-nw-muted">{order.governorate} · {order.region} · {order.address}</p>
      <UiButton onClick={() => window.print()} className="w-full print:hidden"><Printer className="h-4 w-4" />طباعة الطلب</UiButton>
      {embedded && <OrderCommercialSummary order={order} />}

      <section className="rounded-2xl border border-nw-info    p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[9px] font-bold text-nw-text">
              الخطوة التالية
            </span>
            <h4 className="mt-0.5 font-black text-nw-text">
              {order.status === 'new'
                ? 'راجع الأصناف ثم ابدأ التجهيز'
                : order.status === 'out_for_delivery'
                  ? 'سجّل التسليم والتحصيل'
                  : nextStep?.label || 'لا يوجد إجراء مطلوب الآن'}
            </h4>
            <p className="mt-1 text-[10px] text-nw-muted">
              الإجمالي {order.totalAmount.toFixed(3)} {CURRENCY} ·{' '}
              {(order.items || []).length} أصناف
            </p>
          </div>
          <StatusBadge tone={getOrderStatus(order.status).tone}>{STATUS_LABELS[order.status] || order.status}</StatusBadge>
        </div>

        {order.status === 'new' && (
          <UiButton variant="primary"
            type="button"
            disabled={busy}
            onClick={() => runAction(() => confirmOrder(order.id))}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            قبول الطلب وبدء التجهيز
          </UiButton>
        )}

        {nextStep &&
          nextStep.status !== 'delivered' &&
          nextStep.status !== 'out_for_delivery' && (
            <UiButton
              type="button"
              disabled={busy}
              onClick={() =>
                runAction(() => advanceOrderStatus(order.id, nextStep.status))
              }
              variant="primary"
              className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-3 font-black text-nw-on-primary disabled:opacity-60 ${nextStep.color}`}
            >
              <nextStep.icon className="h-4 w-4" />
              {nextStep.label}
            </UiButton>
          )}

        {nextStep?.status === 'out_for_delivery' &&
          !showDeliveryEtaForm && (
            <UiButton variant="primary"
              type="button"
              disabled={busy}
              onClick={() => focusActionArea(() => setShowDeliveryEtaForm(true))}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary disabled:opacity-60"
            >
              <Truck className="h-4 w-4" />
              بدء التوصيل وتحديد وقت الوصول
            </UiButton>
          )}

        {nextStep?.status === 'delivered' && !showPaymentConfirmation && (
          <UiButton variant="primary"
            type="button"
            disabled={busy}
            onClick={() =>
              focusActionArea(() => setShowPaymentConfirmation(true))
            }
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary disabled:opacity-60"
          >
            <ReceiptText className="h-4 w-4" />
            تسليم الطلب وتسجيل الحساب
          </UiButton>
        )}
      </section>

      <div id={`order-action-area-${order.id}`} className="space-y-2 scroll-mt-4">

        {(showDeliveryEtaForm || order.status === 'out_for_delivery') && (
          <div className="space-y-3 rounded-2xl border border-nw-info bg-nw-info-bg p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-black text-nw-text">
                  {order.status === 'out_for_delivery'
                    ? 'الطلب في طريقه إلى العميل'
                    : 'وقت الوصول المتوقع'}
                </h4>
                <p className="mt-1 text-[10px] leading-5 text-nw-muted">
                  اختر المدة وأدخل رقم السائق. لا يحتاج السائق إلى حساب أو تطبيق آخر.
                </p>
              </div>
              <Clock3 className="h-5 w-5 text-nw-info" />
            </div>

            {order.estimatedArrivalAt && !showDeliveryEtaForm && (
              <div className="rounded-xl border border-nw-info bg-nw-surface-2 p-3 text-center">
                <span className="block text-[9px] font-bold text-nw-muted">
                  الوصول المتوقع
                </span>
                <strong className="mt-1 block text-base font-black text-nw-text">
                  {new Date(order.estimatedArrivalAt).toLocaleTimeString('ar-JO-u-nu-latn', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </strong>
                <span className="mt-1 block text-[10px] font-bold text-nw-info">
                  بعد نحو{' '}
                  {Math.max(
                    0,
                    Math.ceil(
                      (new Date(order.estimatedArrivalAt).getTime() - Date.now()) /
                        60000
                    )
                  )}{' '}
                  دقيقة
                </span>
              </div>
            )}

            {showDeliveryEtaForm && (
              <>
                <div className="grid grid-cols-4 gap-1.5">
                  {[15, 30, 45, 60].map((minutes) => (
                    <UiButton
                      key={minutes}
                      type="button"
                      onClick={() => setDeliveryEtaMinutes(minutes)}
                      variant={deliveryEtaMinutes === minutes ? 'primary' : 'secondary'}
                      className={`rounded-xl border py-2 text-[11px] font-black ${
                        deliveryEtaMinutes === minutes
                          ? 'border-nw-info bg-nw-primary text-nw-on-primary'
                          : 'border-nw-border bg-nw-surface-2 text-nw-text'
                      }`}
                    >
                      {minutes} د
                    </UiButton>
                  ))}
                </div>
                <label className="block text-[10px] font-bold text-nw-muted">
                  أو مدة مخصصة بالدقائق
                  <input
                    type="number"
                    min={5}
                    max={360}
                    step={5}
                    value={deliveryEtaMinutes}
                    onChange={(event) =>
                      setDeliveryEtaMinutes(Number(event.target.value))
                    }
                    className="mt-1.5 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-center text-sm font-black text-nw-text outline-none focus:border-nw-info"
                  />
                </label>
                <label className="block text-[10px] font-bold text-nw-muted">
                  رقم هاتف السائق
                  <input
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    value={deliveryDriverPhone}
                    onChange={(event) =>
                      setDeliveryDriverPhone(event.target.value)
                    }
                    placeholder="0791234567"
                    className="mt-1.5 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-center font-mono text-sm font-black text-nw-text outline-none focus:border-nw-info"
                  />
                  <span className="mt-1 block text-[9px] leading-4 text-nw-muted">
                    سيظهر للعميل داخل رابط التتبع ورسالة واتساب.
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <UiButton variant="primary"
                    type="button"
                    disabled={busy}
                    onClick={handleStartOrUpdateDelivery}
                    className="rounded-xl bg-nw-primary py-2.5 text-xs font-black text-nw-on-primary disabled:opacity-60"
                  >
                    {order.status === 'out_for_delivery'
                      ? 'تحديث الوقت'
                      : 'بدء التوصيل'}
                  </UiButton>
                  <UiButton
                    type="button"
                    disabled={busy}
                    onClick={() => setShowDeliveryEtaForm(false)}
                    className="rounded-xl border border-nw-border bg-nw-surface py-2.5 text-xs font-black text-nw-text"
                  >
                    رجوع
                  </UiButton>
                </div>
              </>
            )}

            {order.status === 'out_for_delivery' && !showDeliveryEtaForm && (
              <div className="space-y-2">
                {normalizedDriverPhone && (
                  <div className="flex items-center justify-between rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-nw-muted">
                      رقم السائق
                    </span>
                    <a
                      href={`tel:${normalizedDriverPhone}`}
                      dir="ltr"
                      className="font-mono text-[11px] font-black text-nw-text"
                    >
                      {normalizedDriverPhone}
                    </a>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <UiButton
                    type="button"
                    onClick={() => setShowDeliveryEtaForm(true)}
                    className="rounded-xl border border-nw-info bg-nw-info-bg py-2.5 text-[11px] font-black text-nw-text"
                  >
                    تعديل الوقت والسائق
                  </UiButton>
                  <UiButton
                    type="button"
                    onClick={copyTrackingLink}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-nw-info bg-nw-info-bg py-2.5 text-[11px] font-black text-nw-text"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    نسخ رابط التتبع
                  </UiButton>
                </div>
                {trackingWhatsAppUrl && normalizedDriverPhone && (
                  <a
                    href={trackingWhatsAppUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-2.5 text-[11px] font-black text-nw-on-primary hover:bg-nw-primary"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    إرسال التتبع ورقم السائق للعميل
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {nextStep?.status === 'delivered' && showPaymentConfirmation && (
          <div className="space-y-3 rounded-2xl border border-nw-ok bg-nw-ok-bg p-3">
            <div>
              <h4 className="font-black text-nw-text">
                التسليم والتحصيل
              </h4>
              <p className="mt-1 text-[10px] leading-5 text-nw-muted">
                حدّد أجرة التوصيل وما دفعه العميل؛ المتبقي يصبح ذمة تلقائيًا.
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block font-bold text-nw-text">
                أجرة التوصيل ({CURRENCY})
              </span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={deliveryFeeInput}
                onChange={(event) => setDeliveryFeeInput(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 font-black text-nw-text"
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <UiButton
                type="button"
                onClick={() => setSettlementMode('full')}
                variant={settlementMode === 'full' ? 'primary' : 'secondary'}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'full'
                    ? 'border-nw-ok bg-nw-primary text-nw-on-primary'
                    : 'border-nw-border bg-nw-surface-2 text-nw-text'
                }`}
              >
                دفع كامل
              </UiButton>
              <UiButton
                type="button"
                onClick={() => setSettlementMode('partial')}
                variant={settlementMode === 'partial' ? 'primary' : 'secondary'}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'partial'
                    ? 'border-nw-warn bg-nw-primary text-nw-on-primary'
                    : 'border-nw-border bg-nw-surface-2 text-nw-text'
                }`}
              >
                دفع جزئي
              </UiButton>
              <UiButton
                type="button"
                onClick={() => setSettlementMode('debt')}
                variant={settlementMode === 'debt' ? 'primary' : 'secondary'}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'debt'
                    ? 'border-nw-bad bg-nw-primary text-nw-on-primary'
                    : 'border-nw-border bg-nw-surface-2 text-nw-text'
                }`}
              >
                على الحساب
              </UiButton>
            </div>

            {settlementMode === 'partial' && (
              <label className="block">
                <span className="mb-1 block font-bold text-nw-text">
                  المبلغ المقبوض الآن ({CURRENCY}) *
                </span>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  max={Math.max(0, settlementTotal - 0.001)}
                  value={partialAmount}
                  onChange={(event) => setPartialAmount(event.target.value)}
                  placeholder="مثال: 5.000"
                  className="w-full rounded-xl border border-nw-warn bg-nw-surface-2 p-2.5 font-black text-nw-text"
                />
              </label>
            )}

            {settlementMode !== 'debt' && (
              <div className="grid grid-cols-2 gap-2">
                <UiButton
                  type="button"
                  onClick={() => setCollectedBy('cash')}
                  variant={collectedBy === 'cash' ? 'primary' : 'secondary'}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                    collectedBy === 'cash'
                      ? 'border-nw-ok bg-nw-primary text-nw-on-primary'
                      : 'border-nw-border bg-nw-surface-2 text-nw-text'
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  كاش
                </UiButton>
                <UiButton
                  type="button"
                  onClick={() => setCollectedBy('cliq')}
                  variant={collectedBy === 'cliq' ? 'primary' : 'secondary'}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                    collectedBy === 'cliq'
                      ? 'border-nw-info bg-nw-primary text-nw-on-primary'
                      : 'border-nw-border bg-nw-surface-2 text-nw-text'
                  }`}
                >
                  <Smartphone className="h-4 w-4" />
                  CliQ
                </UiButton>
              </div>
            )}

            {settlementMode !== 'debt' && collectedBy === 'cliq' && (
              <label className="block">
                <span className="mb-1 block font-bold text-nw-text">
                  رقم مرجع CliQ *
                </span>
                <input
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  maxLength={120}
                  placeholder="اكتب رقم الحركة أو المرجع"
                  className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
                />
              </label>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3 text-center">
              <div>
                <span className="block text-[9px] text-nw-muted">الإجمالي</span>
                <b className="text-nw-text">{settlementTotal.toFixed(3)}</b>
              </div>
              <div>
                <span className="block text-[9px] text-nw-muted">المقبوض</span>
                <b className="text-nw-text">{settlementCollectedAmount.toFixed(3)}</b>
              </div>
              <div>
                <span className="block text-[9px] text-nw-muted">ذمة العميل</span>
                <b className={settlementRemaining > 0 ? 'text-nw-text' : 'text-nw-text'}>
                  {settlementRemaining.toFixed(3)}
                </b>
              </div>
            </div>

            {settlementRemaining > 0 && (
              <p className="rounded-xl border border-nw-bad bg-nw-bad-bg p-2 text-[10px] font-bold leading-5 text-nw-text">
                بعد الاعتماد سيظهر مبلغ {settlementRemaining.toFixed(3)} {CURRENCY}{' '}
                تلقائيًا في ذمم العميل {order.customerName} ويمكن تسديده لاحقًا بسند قبض.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block font-bold text-nw-text">
                ملاحظة (اختياري)
              </span>
              <input
                value={paymentNotes}
                onChange={(event) => setPaymentNotes(event.target.value)}
                placeholder="مثال: استلمه عامل التوصيل"
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </label>

            <div className="flex gap-2">
              <UiButton variant="primary"
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmPaymentAndDelivery()}
                className="flex-1 rounded-xl bg-nw-primary py-2.5 font-black text-nw-on-primary disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'اعتماد التسليم والحساب'}
              </UiButton>
              <UiButton
                type="button"
                disabled={busy}
                onClick={() => setShowPaymentConfirmation(false)}
                className="rounded-xl bg-nw-surface-2 px-4 py-2.5 font-bold text-nw-text disabled:opacity-60"
              >
                رجوع
              </UiButton>
            </div>
          </div>
        )}

        {['completed', 'delivered'].includes(order.status) && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-nw-ok bg-nw-ok-bg p-3 font-bold text-nw-text">
            <CheckCircle2 className="h-4 w-4" />
            تم التسليم وخصم الكمية من المخزون
          </div>
        )}

        {['completed', 'delivered'].includes(order.status) && (
          <AdminAftercarePanel
            order={order}
            onChanged={onOrderChanged}
            onContractResolved={handleAftercareContract}
            notify={setToast}
          />
        )}

        {['completed', 'delivered'].includes(order.status) &&
          aftercareCapability === 'legacy_pos_v1_unsupported' && (
            <div className="rounded-xl border border-nw-warn bg-nw-warn-bg p-3 text-sm text-nw-text">
              هذا بيع POS تاريخي. خدمات ما بعد البيع الحديثة ومسار مرتجع الموقع غير متاحين لهذا العقد.
            </div>
          )}

        {['completed', 'delivered'].includes(order.status) &&
          aftercareCapability === 'unsupported_contract' && (
            <div className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-sm text-nw-text">
              عقد إنشاء الطلب غير معروف؛ تم إيقاف إجراءات ما بعد البيع لهذا الطلب بأمان.
            </div>
          )}

        {['completed', 'delivered'].includes(order.status) &&
          aftercareCapability === 'legacy_website_return_v1' && (
            <div className="rounded-xl border border-nw-warn p-3 text-sm text-nw-text">
              طلب موقع تاريخي — للقراءة فقط. لا تُنشأ مرتجعات جديدة بهذا العقد.
            </div>
          )}

        {order.status === 'returned' && (
          <div className="space-y-2 rounded-2xl border border-nw-warn bg-nw-warn-bg p-3 text-nw-text">
            <div className="flex items-center gap-2 font-black">
              <RotateCcw className="h-4 w-4" />
              تم إرجاع الطلب ورد كامل المبلغ
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <span>سند المرتجع: <bdi dir="ltr" className="select-text font-bold">{order.returnNumber || 'محفوظ'}</bdi></span>
              <span>المبلغ: <b>{(order.refundAmount || order.totalAmount).toFixed(3)} {CURRENCY}</b></span>
              <span>الرد: <b>{order.refundMethod === 'cliq' ? 'CliQ' : 'كاش'}</b></span>
              <span>
                المخزون:{' '}
                <b>
                  {order.returnStockDisposition === 'restock'
                    ? 'أُعيدت البضاعة السليمة'
                    : 'تالف — لم يُضف للمخزون'}
                </b>
              </span>
            </div>
            {order.returnReason && (
              <p className="text-[10px] text-nw-text">
                السبب: {order.returnReason}
              </p>
            )}
          </div>
        )}

        {order.status === 'cancelled' && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-nw-bad bg-nw-bad-bg p-3 font-bold text-nw-text">
            <XCircle className="h-4 w-4" />
            الطلب ملغي والحجز محرر
          </div>
        )}

        {canCancel && !showCancelForm && (
          <UiButton
            type="button"
            onClick={() => setShowCancelForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-nw-bad bg-nw-bad-bg py-2.5 font-bold text-nw-text"
          >
            <XCircle className="h-4 w-4" />
            إلغاء الطلب مع ذكر السبب
          </UiButton>
        )}

        {showCancelForm && (
          <div className="space-y-2 rounded-2xl border border-nw-bad bg-nw-bad-bg p-3">
            <label htmlFor={`cancel-reason-${order.id}`} className="font-bold text-nw-text">
              سبب الإلغاء *
            </label>
            <textarea
              id={`cancel-reason-${order.id}`}
              rows={2}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="مثال: الزبون طلب الإلغاء"
              className="w-full resize-none rounded-xl border border-nw-bad bg-nw-surface-2 p-2.5 text-nw-text"
            />
            <div className="flex gap-2">
              <UiButton variant="primary"
                type="button"
                disabled={busy}
                onClick={handleCancel}
                className="flex-1 rounded-xl bg-nw-primary py-2 font-bold text-nw-on-primary disabled:opacity-60"
              >
                تأكيد الإلغاء
              </UiButton>
              <UiButton
                type="button"
                onClick={() => setShowCancelForm(false)}
                className="rounded-xl bg-nw-surface-2 px-4 py-2 font-bold text-nw-text"
              >
                رجوع
              </UiButton>
            </div>
          </div>
        )}
      </div>

      <details open={!embedded} className="rounded-xl border border-nw-border p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold text-nw-primary">التواصل وملف العميل</summary>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
        <div>
          <strong className="block text-nw-text">{order.customerName}</strong>
          <bdi dir="ltr" className="select-text font-mono text-[10px] text-nw-ok">
            {order.customerPhone || 'لا يوجد رقم هاتف'}
          </bdi>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {order.customerId && (
            <UiButton variant="primary"
              type="button"
              onClick={() => openCustomerProfile(order.customerId!)}
              className="flex items-center gap-1 rounded-lg bg-nw-primary px-2.5 py-1.5 font-bold text-nw-on-primary"
            >
              <BookUser className="h-3.5 w-3.5" />
              ملف العميل
            </UiButton>
          )}
          {order.customerPhone && (
            <>
              <a
                href={`tel:${order.customerPhone}`}
                className="flex items-center gap-1 rounded-lg bg-nw-primary px-2.5 py-1.5 font-bold text-nw-on-primary"
              >
                <Phone className="h-3.5 w-3.5" />
                اتصال
              </a>
              <a
                href={`https://wa.me/${whatsappPhone}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg bg-nw-primary px-2.5 py-1.5 font-bold text-nw-on-primary"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </>
          )}
        </div>
      </div>

      </details>
      <details
        className="group rounded-2xl border border-nw-border bg-nw-surface-2 p-3"
        open={!embedded && ['new', 'confirmed'].includes(order.status)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between font-black text-nw-text marker:hidden">
          <span>تفاصيل الطلب والحساب</span>
          <ChevronLeft className="h-4 w-4 text-nw-muted transition group-open:-rotate-90" />
        </summary>
        <div className="mt-3 space-y-4">
          <div className="rounded-2xl border border-nw-info bg-nw-primary p-3 text-[11px] leading-5 text-nw-on-primary">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-nw-info" />
          <p>
            كميات هذا الطلب محجوزة منذ إنشائه في المتجر. قبول الطلب يبدأ
            التجهيز مباشرة، والخصم الفعلي من المخزون يحدث عند اعتماد
            التسليم والحساب.
          </p>
        </div>
      </div>

      <details className="rounded-xl border border-nw-border p-3"><summary className="min-h-11 cursor-pointer py-3 font-bold text-nw-primary">العنوان والخريطة وتعديل الموقع</summary>
      <CustomerLocationCard
        order={order}
        onEditAddress={
          canCancel ? () => setShowEditAddress(true) : undefined
        }
      />
      </details>

      <div className="space-y-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
        <h4 className="font-bold text-nw-text">أصناف الطلب</h4>
        {(order.items || []).map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-nw-border bg-nw-surface p-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {item.productImage ? (
                  <img
                    src={item.productImage}
                    alt=""
                    className="h-9 w-9 rounded-lg border border-nw-border object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-nw-surface-2 text-nw-muted">
                    <PackageCheck className="h-4 w-4" />
                  </div>
                )}
                <div>
                  <h5 className="font-bold text-nw-text">
                    {item.productName}
                  </h5>
                  <span className="text-[10px] text-nw-muted">
                    {item.commercialLineKind === 'configurable_parcel' ? 'طرد مشكّل' : item.commercialLineKind === 'legacy_single_sku_parcel' ? 'كرتونة' : item.unit} · {item.quantity} × {item.unitPrice.toFixed(3)}
                  </span>
                </div>
              </div>
              <strong className="text-nw-text">
                <MoneyText amount={item.totalPrice} />
              </strong>
            </div>
            {item.parcelInstances?.map((instance) => (
              <details key={instance.id} className="mt-2 rounded-lg border border-nw-border bg-nw-surface-2 p-2 text-xs text-nw-text">
                <summary className="min-h-11 cursor-pointer py-3 font-semibold">مكونات {instance.unitName} #{instance.sequence}</summary>
                <ul className="mt-1 space-y-1" aria-label={`مكونات ${instance.unitName} رقم ${instance.sequence}`}>
                  {instance.components.map((component) => (
                    <li key={component.id}>
                      {component.name} ({component.sku}) — {component.quantity} {component.unitName}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-1.5 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
        <div className="flex justify-between text-nw-muted">
          <span>المجموع الفرعي</span>
          <span><MoneyText amount={order.subtotal} /></span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between text-nw-ok">
            <span>
              الخصم
              {order.promotionCode ? ` (${order.promotionCode})` : ''}
            </span>
            <span><MoneyText amount={-order.discount} /></span>
          </div>
        )}
        <div className="flex justify-between text-nw-muted">
          <span>التوصيل{order.deliveryZone ? ` (${order.deliveryZone === 'inside_ramtha' ? 'داخل الرمثا' : 'خارج الرمثا'})` : ''}</span>
          <span><MoneyText amount={order.deliveryFee} /></span>
        </div>
        <div className="flex justify-between border-t border-nw-border pt-2 font-black text-nw-text">
          <span>إجمالي الطلب</span>
          <span className="text-nw-info">
            {order.totalAmount.toFixed(3)} {CURRENCY}
          </span>
        </div>
      </div>

      <details open={!embedded} className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3"><summary className="min-h-11 cursor-pointer py-2 font-bold">تفاصيل الدفع والتحصيل</summary>
        <div className="mb-2 flex items-center gap-1.5 font-bold text-nw-text">
          <ReceiptText className="h-4 w-4 text-nw-info" />
          الدفع والتحصيل
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-nw-surface p-2">
            <span className="block text-[9px] text-nw-muted">الطريقة</span>
            <b className="text-[10px] text-nw-text">
              {PAYMENT_METHOD_LABELS[order.paymentMethod] ||
                order.paymentMethod}
            </b>
          </div>
          <div className="rounded-xl bg-nw-surface p-2">
            <span className="block text-[9px] text-nw-muted">المدفوع</span>
            <b className="text-nw-ok">
              {(order.amountPaid || 0).toFixed(3)}
            </b>
          </div>
          <div className="rounded-xl bg-nw-surface p-2">
            <span className="block text-[9px] text-nw-muted">المتبقي</span>
            <b className={(order.amountDue || 0) > 0 ? 'text-nw-bad' : 'text-nw-ok'}>
              {(order.amountDue || 0).toFixed(3)}
            </b>
          </div>
        </div>
        {order.paymentConfirmedAt && (
          <div className="mt-2 rounded-xl border border-nw-ok bg-nw-ok-bg p-2 text-[10px] text-nw-text">
            تم تأكيد القبض في{' '}
            {formatUiDate(order.paymentConfirmedAt, { dateStyle: 'medium', timeStyle: 'short' })}
            {order.paymentReferenceNumber && <> — المرجع: <bdi dir="ltr" className="select-text">{order.paymentReferenceNumber}</bdi></>}
          </div>
        )}
      </details>

        </div>
      </details>
      {order.statusHistory.length > 0 && (
        <div className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 font-bold text-nw-text">
            <Clock3 className="h-4 w-4 text-nw-info" />
            سجل حالة الطلب
          </h4>
          <div className="space-y-2">
            {order.statusHistory.map((entry, index) => (
              <div
                key={`${entry.status}-${entry.changedAt}-${index}`}
                className="flex items-start gap-2 border-r border-nw-border pr-3"
              >
                <ChevronLeft className="mt-0.5 h-3 w-3 text-nw-muted" />
                <div>
                  <strong className="text-[11px] text-nw-text">
                    {STATUS_LABELS[entry.status] || entry.status}
                  </strong>
                  <span className="mr-2 text-[9px] text-nw-muted">
                    {formatUiDate(entry.changedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                  {entry.reason && (
                    <p className="text-[10px] text-nw-muted">
                      {entry.reason}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showEditAddress && (
        <EditAddressModal
          order={order}
          onClose={() => setShowEditAddress(false)}
          onSaved={async () => {
            await onOrderChanged?.();
            setShowEditAddress(false);
          }}
        />
      )}
    </div>
  );
};
