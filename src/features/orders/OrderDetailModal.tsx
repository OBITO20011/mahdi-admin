import React, { useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  BookUser,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Copy,
  MapPin,
  MessageCircle,
  PackageCheck,
  PackageX,
  Phone,
  ReceiptText,
  RotateCcw,
  Smartphone,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { useAppStore } from '../../stores/useAppStore';
import { Order, OrderStatus } from '../../types';
import { CustomerLocationCard } from './CustomerLocationCard';
import { EditAddressModal } from './EditAddressModal';
import { buildStorefrontTrackingUrl } from '../../services/supabase/orders.service';

interface OrderDetailModalProps {
  order: Order;
  onClose: () => void;
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
};

const STATUS_COLORS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  confirmed: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  preparing: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  processing: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  ready: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  out_for_delivery: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  delivered: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  cancelled: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  returned: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cash_on_delivery: 'نقدي عند الاستلام',
  cliq: 'CliQ',
  card: 'بطاقة',
  bank_transfer: 'تحويل بنكي',
  debt: 'على الحساب',
  mixed: 'مختلط',
};

function nextOrderStep(status: OrderStatus) {
  if (status === 'confirmed') {
    return {
      status: 'preparing' as OrderStatus,
      label: 'بدء تجهيز الطلب',
      icon: PackageCheck,
      color: 'bg-violet-600 hover:bg-violet-500',
    };
  }
  if (status === 'preparing' || status === 'processing') {
    return {
      status: 'out_for_delivery' as OrderStatus,
      label: 'بدء التوصيل',
      icon: Truck,
      color: 'bg-cyan-600 hover:bg-cyan-500',
    };
  }
  if (status === 'ready') {
    return {
      status: 'out_for_delivery' as OrderStatus,
      label: 'خرج الطلب للتوصيل',
      icon: Truck,
      color: 'bg-cyan-600 hover:bg-cyan-500',
    };
  }
  if (status === 'out_for_delivery') {
    return {
      status: 'delivered' as OrderStatus,
      label: 'تأكيد التسليم وخصم المخزون',
      icon: CheckCircle2,
      color: 'bg-emerald-600 hover:bg-emerald-500',
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

export const OrderDetailModal: React.FC<OrderDetailModalProps> = ({
  order: initialOrder,
  onClose,
}) => {
  const {
    orders,
    confirmOrder,
    cancelOrder,
    advanceOrderStatus,
    startOrUpdateOrderDelivery,
    completeWebsiteOrderWithSettlement,
    returnCompletedWebsiteOrder,
    refreshOrdersFromSupabase,
    openCustomerProfile,
    setToast,
  } = useAppStore();
  const order =
    orders.find((candidate) => candidate.id === initialOrder.id) ||
    initialOrder;

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
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnDisposition, setReturnDisposition] = useState<
    'restock' | 'damaged'
  >('restock');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'cliq'>(
    order.paymentMethod === 'cliq' ? 'cliq' : 'cash'
  );
  const [refundReference, setRefundReference] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [showDeliveryEtaForm, setShowDeliveryEtaForm] = useState(false);
  const [deliveryEtaMinutes, setDeliveryEtaMinutes] = useState(30);
  const [deliveryDriverPhone, setDeliveryDriverPhone] = useState(
    order.deliveryDriverPhone || ''
  );
  const [latestTrackingUrl, setLatestTrackingUrl] = useState('');
  const nextStep = nextOrderStep(order.status);
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
      if (success) setShowPaymentConfirmation(false);
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

  const handleReturnOrder = async () => {
    if (returnReason.trim().length < 3) {
      setToast('اكتب سبب المرتجع بوضوح.', 'error');
      return;
    }
    if (refundMethod === 'cliq' && !refundReference.trim()) {
      setToast('اكتب رقم مرجع CliQ لعملية رد المبلغ.', 'error');
      return;
    }

    setBusy(true);
    try {
      const success = await returnCompletedWebsiteOrder({
        orderId: order.id,
        reason: returnReason.trim(),
        stockDisposition: returnDisposition,
        refundMethod,
        referenceNumber: refundReference.trim(),
        notes: returnNotes.trim(),
      });
      if (success) setShowReturnForm(false);
    } finally {
      setBusy(false);
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
            ).toLocaleTimeString('ar-JO', {
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
    <div className="space-y-4 text-xs">
      <div className="flex items-start justify-between border-b border-slate-800 pb-3">
        <div>
          <span className="font-mono text-[11px] font-black text-blue-400">
            {order.orderNumber}
          </span>
          <h3 className="text-sm font-black text-white">{order.customerName}</h3>
          <span className="text-[10px] text-slate-500">
            {new Date(order.createdAt).toLocaleString('ar-JO')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${
              STATUS_COLORS[order.status] ||
              'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            {STATUS_LABELS[order.status] || order.status}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800 p-2 text-slate-400"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <div>
          <strong className="block text-slate-200">{order.customerName}</strong>
          <span className="font-mono text-[10px] text-emerald-400">
            {order.customerPhone || 'لا يوجد رقم هاتف'}
          </span>
        </div>
        <div className="flex gap-1.5">
          {order.customerId && (
            <button
              type="button"
              onClick={() => openCustomerProfile(order.customerId!)}
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 font-bold text-white"
            >
              <BookUser className="h-3.5 w-3.5" />
              ملف العميل
            </button>
          )}
          {order.customerPhone && (
            <>
              <a
                href={`tel:${order.customerPhone}`}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-bold text-white"
              >
                <Phone className="h-3.5 w-3.5" />
                اتصال
              </a>
              <a
                href={`https://wa.me/${whatsappPhone}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg bg-green-700 px-2.5 py-1.5 font-bold text-white"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </>
          )}
        </div>
      </div>

      <section className="rounded-2xl border border-blue-500/30 bg-gradient-to-l from-blue-950/50 to-slate-950 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[9px] font-bold text-blue-300">
              الخطوة التالية
            </span>
            <h4 className="mt-0.5 font-black text-white">
              {order.status === 'new'
                ? 'راجع الأصناف ثم ابدأ التجهيز'
                : order.status === 'out_for_delivery'
                  ? 'سجّل التسليم والتحصيل'
                  : nextStep?.label || 'لا يوجد إجراء مطلوب الآن'}
            </h4>
            <p className="mt-1 text-[10px] text-slate-400">
              الإجمالي {order.totalAmount.toFixed(3)} {CURRENCY} ·{' '}
              {(order.items || []).length} أصناف
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold ${
              STATUS_COLORS[order.status] ||
              'border-slate-700 bg-slate-800 text-slate-300'
            }`}
          >
            {STATUS_LABELS[order.status] || order.status}
          </span>
        </div>

        {order.status === 'new' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => runAction(() => confirmOrder(order.id))}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 font-black text-white disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            قبول الطلب وبدء التجهيز
          </button>
        )}

        {nextStep &&
          nextStep.status !== 'delivered' &&
          nextStep.status !== 'out_for_delivery' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAction(() => advanceOrderStatus(order.id, nextStep.status))
              }
              className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-3 font-black text-white disabled:opacity-60 ${nextStep.color}`}
            >
              <nextStep.icon className="h-4 w-4" />
              {nextStep.label}
            </button>
          )}

        {nextStep?.status === 'out_for_delivery' &&
          !showDeliveryEtaForm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => focusActionArea(() => setShowDeliveryEtaForm(true))}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-cyan-600 py-3 font-black text-white disabled:opacity-60"
            >
              <Truck className="h-4 w-4" />
              بدء التوصيل وتحديد وقت الوصول
            </button>
          )}

        {nextStep?.status === 'delivered' && !showPaymentConfirmation && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              focusActionArea(() => setShowPaymentConfirmation(true))
            }
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 font-black text-white disabled:opacity-60"
          >
            <ReceiptText className="h-4 w-4" />
            تسليم الطلب وتسجيل الحساب
          </button>
        )}
      </section>

      <details
        className="group rounded-2xl border border-slate-800 bg-slate-950 p-3"
        open={['new', 'confirmed'].includes(order.status)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between font-black text-slate-200 marker:hidden">
          <span>تفاصيل الطلب والحساب</span>
          <ChevronLeft className="h-4 w-4 text-slate-500 transition group-open:-rotate-90" />
        </summary>
        <div className="mt-3 space-y-4">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] leading-5 text-blue-200">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p>
            كميات هذا الطلب محجوزة منذ إنشائه في المتجر. قبول الطلب يبدأ
            التجهيز مباشرة، والخصم الفعلي من المخزون يحدث عند اعتماد
            التسليم والحساب.
          </p>
        </div>
      </div>

      <CustomerLocationCard
        order={order}
        onEditAddress={
          canCancel ? () => setShowEditAddress(true) : undefined
        }
      />

      <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <h4 className="font-bold text-slate-300">أصناف الطلب</h4>
        {(order.items || []).map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-2.5"
          >
            <div className="flex items-center gap-2">
              {item.productImage ? (
                <img
                  src={item.productImage}
                  alt=""
                  className="h-9 w-9 rounded-lg border border-slate-800 object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-slate-500">
                  <PackageCheck className="h-4 w-4" />
                </div>
              )}
              <div>
                <h5 className="font-bold text-slate-200">
                  {item.productName}
                </h5>
                <span className="text-[10px] text-slate-500">
                  {item.quantity} {item.unit} × {item.unitPrice.toFixed(3)}
                </span>
              </div>
            </div>
            <strong className="text-slate-100">
              {item.totalPrice.toFixed(3)} {CURRENCY}
            </strong>
          </div>
        ))}
      </div>

      <div className="space-y-1.5 rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <div className="flex justify-between text-slate-400">
          <span>المجموع الفرعي</span>
          <span>{order.subtotal.toFixed(3)} {CURRENCY}</span>
        </div>
        {order.discount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>
              الخصم
              {order.promotionCode ? ` (${order.promotionCode})` : ''}
            </span>
            <span>-{order.discount.toFixed(3)} {CURRENCY}</span>
          </div>
        )}
        <div className="flex justify-between text-slate-400">
          <span>التوصيل{order.deliveryZone ? ` (${order.deliveryZone === 'inside_ramtha' ? 'داخل الرمثا' : 'خارج الرمثا'})` : ''}</span>
          <span>{order.deliveryFee.toFixed(3)} {CURRENCY}</span>
        </div>
        <div className="flex justify-between border-t border-slate-800 pt-2 font-black text-white">
          <span>إجمالي الطلب</span>
          <span className="text-blue-400">
            {order.totalAmount.toFixed(3)} {CURRENCY}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
        <div className="mb-2 flex items-center gap-1.5 font-bold text-slate-200">
          <ReceiptText className="h-4 w-4 text-teal-400" />
          الدفع والتحصيل
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-900 p-2">
            <span className="block text-[9px] text-slate-500">الطريقة</span>
            <b className="text-[10px] text-slate-200">
              {PAYMENT_METHOD_LABELS[order.paymentMethod] ||
                order.paymentMethod}
            </b>
          </div>
          <div className="rounded-xl bg-slate-900 p-2">
            <span className="block text-[9px] text-slate-500">المدفوع</span>
            <b className="text-emerald-400">
              {(order.amountPaid || 0).toFixed(3)}
            </b>
          </div>
          <div className="rounded-xl bg-slate-900 p-2">
            <span className="block text-[9px] text-slate-500">المتبقي</span>
            <b className={(order.amountDue || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {(order.amountDue || 0).toFixed(3)}
            </b>
          </div>
        </div>
        {order.paymentConfirmedAt && (
          <div className="mt-2 rounded-xl border border-emerald-800/50 bg-emerald-950/30 p-2 text-[10px] text-emerald-300">
            تم تأكيد القبض في{' '}
            {new Date(order.paymentConfirmedAt).toLocaleString('ar-JO')}
            {order.paymentReferenceNumber
              ? ` — المرجع: ${order.paymentReferenceNumber}`
              : ''}
          </div>
        )}
      </div>

        </div>
      </details>

      <div id={`order-action-area-${order.id}`} className="space-y-2 scroll-mt-4">

        {(showDeliveryEtaForm || order.status === 'out_for_delivery') && (
          <div className="space-y-3 rounded-2xl border border-cyan-700/60 bg-cyan-950/25 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-black text-cyan-200">
                  {order.status === 'out_for_delivery'
                    ? 'الطلب في طريقه إلى العميل'
                    : 'وقت الوصول المتوقع'}
                </h4>
                <p className="mt-1 text-[10px] leading-5 text-slate-400">
                  اختر المدة وأدخل رقم السائق. لا يحتاج السائق إلى حساب أو تطبيق آخر.
                </p>
              </div>
              <Clock3 className="h-5 w-5 text-cyan-400" />
            </div>

            {order.estimatedArrivalAt && !showDeliveryEtaForm && (
              <div className="rounded-xl border border-cyan-800/60 bg-slate-950/50 p-3 text-center">
                <span className="block text-[9px] font-bold text-slate-500">
                  الوصول المتوقع
                </span>
                <strong className="mt-1 block text-base font-black text-cyan-200">
                  {new Date(order.estimatedArrivalAt).toLocaleTimeString('ar-JO', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </strong>
                <span className="mt-1 block text-[10px] font-bold text-cyan-400">
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
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setDeliveryEtaMinutes(minutes)}
                      className={`rounded-xl border py-2 text-[11px] font-black ${
                        deliveryEtaMinutes === minutes
                          ? 'border-cyan-400 bg-cyan-600 text-white'
                          : 'border-slate-700 bg-slate-950 text-slate-300'
                      }`}
                    >
                      {minutes} د
                    </button>
                  ))}
                </div>
                <label className="block text-[10px] font-bold text-slate-400">
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
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-center text-sm font-black text-white outline-none focus:border-cyan-500"
                  />
                </label>
                <label className="block text-[10px] font-bold text-slate-400">
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
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-center font-mono text-sm font-black text-white outline-none focus:border-cyan-500"
                  />
                  <span className="mt-1 block text-[9px] leading-4 text-slate-500">
                    سيظهر للعميل داخل رابط التتبع ورسالة واتساب.
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleStartOrUpdateDelivery}
                    className="rounded-xl bg-cyan-600 py-2.5 text-xs font-black text-white disabled:opacity-60"
                  >
                    {order.status === 'out_for_delivery'
                      ? 'تحديث الوقت'
                      : 'بدء التوصيل'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowDeliveryEtaForm(false)}
                    className="rounded-xl border border-slate-700 bg-slate-900 py-2.5 text-xs font-black text-slate-300"
                  >
                    رجوع
                  </button>
                </div>
              </>
            )}

            {order.status === 'out_for_delivery' && !showDeliveryEtaForm && (
              <div className="space-y-2">
                {normalizedDriverPhone && (
                  <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                    <span className="text-[10px] font-bold text-slate-400">
                      رقم السائق
                    </span>
                    <a
                      href={`tel:${normalizedDriverPhone}`}
                      dir="ltr"
                      className="font-mono text-[11px] font-black text-emerald-300"
                    >
                      {normalizedDriverPhone}
                    </a>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeliveryEtaForm(true)}
                    className="rounded-xl border border-cyan-700 bg-cyan-950/40 py-2.5 text-[11px] font-black text-cyan-200"
                  >
                    تعديل الوقت والسائق
                  </button>
                  <button
                    type="button"
                    onClick={copyTrackingLink}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-700 bg-blue-950/40 py-2.5 text-[11px] font-black text-blue-200"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    نسخ رابط التتبع
                  </button>
                </div>
                {trackingWhatsAppUrl && normalizedDriverPhone && (
                  <a
                    href={trackingWhatsAppUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-[11px] font-black text-white hover:bg-emerald-500"
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
          <div className="space-y-3 rounded-2xl border border-emerald-700/60 bg-emerald-950/30 p-3">
            <div>
              <h4 className="font-black text-emerald-200">
                التسليم والتحصيل
              </h4>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">
                حدّد أجرة التوصيل وما دفعه العميل؛ المتبقي يصبح ذمة تلقائيًا.
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block font-bold text-slate-300">
                أجرة التوصيل ({CURRENCY})
              </span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={deliveryFeeInput}
                onChange={(event) => setDeliveryFeeInput(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-black text-cyan-300"
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSettlementMode('full')}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'full'
                    ? 'border-emerald-500 bg-emerald-600 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
                }`}
              >
                دفع كامل
              </button>
              <button
                type="button"
                onClick={() => setSettlementMode('partial')}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'partial'
                    ? 'border-amber-500 bg-amber-600 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
                }`}
              >
                دفع جزئي
              </button>
              <button
                type="button"
                onClick={() => setSettlementMode('debt')}
                className={`rounded-xl border p-2.5 font-bold ${
                  settlementMode === 'debt'
                    ? 'border-rose-500 bg-rose-600 text-white'
                    : 'border-slate-700 bg-slate-950 text-slate-300'
                }`}
              >
                على الحساب
              </button>
            </div>

            {settlementMode === 'partial' && (
              <label className="block">
                <span className="mb-1 block font-bold text-slate-300">
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
                  className="w-full rounded-xl border border-amber-700 bg-slate-950 p-2.5 font-black text-amber-300"
                />
              </label>
            )}

            {settlementMode !== 'debt' && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCollectedBy('cash')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                    collectedBy === 'cash'
                      ? 'border-emerald-500 bg-emerald-600 text-white'
                      : 'border-slate-700 bg-slate-950 text-slate-300'
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  كاش
                </button>
                <button
                  type="button"
                  onClick={() => setCollectedBy('cliq')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                    collectedBy === 'cliq'
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-slate-950 text-slate-300'
                  }`}
                >
                  <Smartphone className="h-4 w-4" />
                  CliQ
                </button>
              </div>
            )}

            {settlementMode !== 'debt' && collectedBy === 'cliq' && (
              <label className="block">
                <span className="mb-1 block font-bold text-slate-300">
                  رقم مرجع CliQ *
                </span>
                <input
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  maxLength={120}
                  placeholder="اكتب رقم الحركة أو المرجع"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
                />
              </label>
            )}

            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-center">
              <div>
                <span className="block text-[9px] text-slate-500">الإجمالي</span>
                <b className="text-blue-300">{settlementTotal.toFixed(3)}</b>
              </div>
              <div>
                <span className="block text-[9px] text-slate-500">المقبوض</span>
                <b className="text-emerald-300">{settlementCollectedAmount.toFixed(3)}</b>
              </div>
              <div>
                <span className="block text-[9px] text-slate-500">ذمة العميل</span>
                <b className={settlementRemaining > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                  {settlementRemaining.toFixed(3)}
                </b>
              </div>
            </div>

            {settlementRemaining > 0 && (
              <p className="rounded-xl border border-rose-800/60 bg-rose-950/30 p-2 text-[10px] font-bold leading-5 text-rose-200">
                بعد الاعتماد سيظهر مبلغ {settlementRemaining.toFixed(3)} {CURRENCY}{' '}
                تلقائيًا في ذمم العميل {order.customerName} ويمكن تسديده لاحقًا بسند قبض.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block font-bold text-slate-300">
                ملاحظة (اختياري)
              </span>
              <input
                value={paymentNotes}
                onChange={(event) => setPaymentNotes(event.target.value)}
                placeholder="مثال: استلمه عامل التوصيل"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmPaymentAndDelivery()}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-black text-white disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'اعتماد التسليم والحساب'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowPaymentConfirmation(false)}
                className="rounded-xl bg-slate-800 px-4 py-2.5 font-bold text-slate-300 disabled:opacity-60"
              >
                رجوع
              </button>
            </div>
          </div>
        )}

        {['completed', 'delivered'].includes(order.status) && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 font-bold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            تم التسليم وخصم الكمية من المخزون
          </div>
        )}

        {['completed', 'delivered'].includes(order.status) &&
          !showReturnForm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowReturnForm(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-orange-700 bg-orange-950/30 py-2.5 font-bold text-orange-300 disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" />
              تسجيل مرتجع كامل ورد المبلغ
            </button>
          )}

        {['completed', 'delivered'].includes(order.status) &&
          showReturnForm && (
            <div className="space-y-3 rounded-2xl border border-orange-700/60 bg-orange-950/30 p-3">
              <div>
                <h4 className="font-black text-orange-200">
                  مرتجع كامل للطلب بقيمة {order.totalAmount.toFixed(3)}{' '}
                  {CURRENCY}
                </h4>
                <p className="mt-1 text-[10px] leading-5 text-orange-100/70">
                  العملية نهائية: ستُسجل كمرتجع ويُرد كامل المبلغ ويُحدّث الصندوق تلقائيًا.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block font-bold text-slate-300">
                  سبب المرتجع *
                </span>
                <textarea
                  rows={2}
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  placeholder="مثال: خطأ في الصنف أو طلب العميل الإرجاع"
                  className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
                />
              </label>

              <div>
                <span className="mb-1 block font-bold text-slate-300">
                  حالة البضاعة المرتجعة *
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnDisposition('restock')}
                    className={`rounded-xl border p-2.5 font-bold ${
                      returnDisposition === 'restock'
                        ? 'border-emerald-500 bg-emerald-600 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <PackageCheck className="mx-auto mb-1 h-4 w-4" />
                    سليمة — تعود للمخزون
                  </button>
                  <button
                    type="button"
                    onClick={() => setReturnDisposition('damaged')}
                    className={`rounded-xl border p-2.5 font-bold ${
                      returnDisposition === 'damaged'
                        ? 'border-rose-500 bg-rose-600 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <PackageX className="mx-auto mb-1 h-4 w-4" />
                    تالفة — لا تعود للمخزون
                  </button>
                </div>
              </div>

              <div>
                <span className="mb-1 block font-bold text-slate-300">
                  طريقة رد المبلغ *
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRefundMethod('cash')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                      refundMethod === 'cash'
                        ? 'border-emerald-500 bg-emerald-600 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <Banknote className="h-4 w-4" />
                    رد كاش
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefundMethod('cliq')}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-bold ${
                      refundMethod === 'cliq'
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    <Smartphone className="h-4 w-4" />
                    رد عبر CliQ
                  </button>
                </div>
              </div>

              {refundMethod === 'cliq' && (
                <label className="block">
                  <span className="mb-1 block font-bold text-slate-300">
                    رقم مرجع CliQ *
                  </span>
                  <input
                    value={refundReference}
                    onChange={(event) =>
                      setRefundReference(event.target.value)
                    }
                    maxLength={120}
                    placeholder="رقم عملية رد المبلغ"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1 block font-bold text-slate-300">
                  ملاحظة داخلية (اختياري)
                </span>
                <input
                  value={returnNotes}
                  onChange={(event) => setReturnNotes(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
                />
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReturnOrder()}
                  className="flex-1 rounded-xl bg-orange-600 py-2.5 font-black text-white disabled:opacity-60"
                >
                  {busy ? 'جاري تسجيل المرتجع...' : 'اعتماد المرتجع ورد المبلغ'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setShowReturnForm(false)}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 font-bold text-slate-300"
                >
                  رجوع
                </button>
              </div>
            </div>
          )}

        {order.status === 'returned' && (
          <div className="space-y-2 rounded-2xl border border-orange-700/60 bg-orange-950/30 p-3 text-orange-200">
            <div className="flex items-center gap-2 font-black">
              <RotateCcw className="h-4 w-4" />
              تم إرجاع الطلب ورد كامل المبلغ
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <span>سند المرتجع: <b>{order.returnNumber || 'محفوظ'}</b></span>
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
              <p className="text-[10px] text-orange-100/70">
                السبب: {order.returnReason}
              </p>
            )}
          </div>
        )}

        {order.status === 'cancelled' && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-800 bg-rose-950/40 p-3 font-bold text-rose-300">
            <XCircle className="h-4 w-4" />
            الطلب ملغي والحجز محرر
          </div>
        )}

        {canCancel && !showCancelForm && (
          <button
            type="button"
            onClick={() => setShowCancelForm(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-800 bg-rose-950/30 py-2.5 font-bold text-rose-300"
          >
            <XCircle className="h-4 w-4" />
            إلغاء الطلب مع ذكر السبب
          </button>
        )}

        {showCancelForm && (
          <div className="space-y-2 rounded-2xl border border-rose-800 bg-rose-950/50 p-3">
            <label className="font-bold text-rose-200">
              سبب الإلغاء *
            </label>
            <textarea
              rows={2}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="مثال: الزبون طلب الإلغاء"
              className="w-full resize-none rounded-xl border border-rose-800 bg-slate-950 p-2.5 text-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleCancel}
                className="flex-1 rounded-xl bg-rose-600 py-2 font-bold text-white disabled:opacity-60"
              >
                تأكيد الإلغاء
              </button>
              <button
                type="button"
                onClick={() => setShowCancelForm(false)}
                className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-300"
              >
                رجوع
              </button>
            </div>
          </div>
        )}
      </div>

      {order.statusHistory.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 font-bold text-slate-300">
            <Clock3 className="h-4 w-4 text-blue-400" />
            سجل حالة الطلب
          </h4>
          <div className="space-y-2">
            {order.statusHistory.map((entry, index) => (
              <div
                key={`${entry.status}-${entry.changedAt}-${index}`}
                className="flex items-start gap-2 border-r border-slate-700 pr-3"
              >
                <ChevronLeft className="mt-0.5 h-3 w-3 text-slate-600" />
                <div>
                  <strong className="text-[11px] text-slate-200">
                    {STATUS_LABELS[entry.status] || entry.status}
                  </strong>
                  <span className="mr-2 text-[9px] text-slate-500">
                    {new Date(entry.changedAt).toLocaleString('ar-JO')}
                  </span>
                  {entry.reason && (
                    <p className="text-[10px] text-slate-500">
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
            await refreshOrdersFromSupabase();
            setShowEditAddress(false);
          }}
        />
      )}
    </div>
  );
};
