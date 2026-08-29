import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CheckCircle2, ChevronLeft, ChevronRight, Loader2, ReceiptText, Search } from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  CustomerOutstandingOrder,
  fetchCustomerOutstandingOrders,
  recordCustomerOrderPayment,
} from '../../services/supabase/customerAccounts.service';
import { useAppStoreActions } from '../../stores/useAppStore';

interface RecordCustomerPaymentModalProps {
  initialOrder?: CustomerOutstandingOrder | null;
  onClose: () => void;
  onSuccess?: () => void;
}

const createPaymentIdempotencyKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `customer-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const RecordCustomerPaymentModal: React.FC<
  RecordCustomerPaymentModalProps
> = ({ initialOrder, onClose, onSuccess }) => {
  const { setToast } = useAppStoreActions();
  const [orders, setOrders] = useState<CustomerOutstandingOrder[]>([]);
  const [orderId, setOrderId] = useState(initialOrder?.id || '');
  const [amount, setAmount] = useState(
    initialOrder ? String(initialOrder.amountDue) : ''
  );
  const [paymentMethod, setPaymentMethod] = useState<
    'cash' | 'cliq' | 'card' | 'bank_transfer' | 'cheque'
  >('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const paymentIdempotencyKey = useRef(createPaymentIdempotencyKey());

  useEffect(() => {
    let mounted = true;
    fetchCustomerOutstandingOrders({
      page: orderPage,
      pageSize: 25,
      search: initialOrder ? undefined : orderSearch,
    }).then((result) => {
      if (!mounted) return;
      if (result.success) {
        setOrders(result.orders);
        setOrderTotalPages(result.totalPages);
        if (!initialOrder && result.orders[0]) {
          setOrderId(result.orders[0].id);
          setAmount(String(result.orders[0].amountDue));
        }
      } else {
        setError(result.error || 'تعذر تحميل الذمم.');
      }
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [initialOrder, orderPage, orderSearch]);

  const selectedOrder = useMemo(
    () =>
      orders.find((order) => order.id === orderId) ||
      (initialOrder?.id === orderId ? initialOrder : null),
    [initialOrder, orderId, orders]
  );

  const handleOrderChange = (nextOrderId: string) => {
    setOrderId(nextOrderId);
    const order = orders.find((item) => item.id === nextOrderId);
    setAmount(order ? String(order.amountDue) : '');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!selectedOrder) {
      setError('اختر طلبًا عليه مبلغ مستحق.');
      return;
    }
    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      numericAmount > selectedOrder.amountDue
    ) {
      setError(
        `الدفعة يجب أن تكون بين 0.001 و${selectedOrder.amountDue.toFixed(
          3
        )} ${CURRENCY}.`
      );
      return;
    }

    setSaving(true);
    setError(null);
    const result = await recordCustomerOrderPayment({
      orderId: selectedOrder.id,
      amount: numericAmount,
      paymentMethod,
      referenceNumber: referenceNumber.trim(),
      notes: notes.trim(),
      idempotencyKey: paymentIdempotencyKey.current,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error || 'تعذر تسجيل الدفعة.');
      return;
    }

    setToast(
      `تم حفظ سند القبض ${result.paymentNumber || ''} بنجاح.`,
      'success'
    );
    onSuccess?.();
    onClose();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
        جاري تحميل الذمم الحقيقية...
      </div>
    );
  }

  if (!error && orders.length === 0 && !initialOrder) {
    return (
      <div className="rounded-2xl border border-emerald-800/50 bg-emerald-950/30 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-9 w-9 text-emerald-400" />
        <h3 className="text-sm font-black text-white">لا توجد ذمم مستحقة</h3>
        <p className="mt-1 text-[11px] text-slate-400">
          كل الطلبات المكتملة مدفوعة حاليًا.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-rose-300">
          {error}
        </div>
      )}

      <div>
        {!initialOrder && (
          <label className="mb-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-400">
            <Search className="h-3.5 w-3.5" />
            <input
              value={orderSearch}
              onChange={(event) => {
                setOrderSearch(event.target.value);
                setOrderPage(1);
              }}
              placeholder="ابحث برقم الطلب أو العميل أو الهاتف"
              className="w-full bg-transparent text-xs text-white outline-none placeholder:text-slate-600"
            />
          </label>
        )}
        <label className="mb-1 block font-bold text-slate-300">
          الطلب والعميل *
        </label>
        <select
          value={orderId}
          onChange={(event) => handleOrderChange(event.target.value)}
          disabled={Boolean(initialOrder)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white disabled:opacity-70"
        >
          <option value="">اختر الطلب</option>
          {(initialOrder
            ? [initialOrder]
            : orders
          ).map((order) => (
            <option key={order.id} value={order.id}>
              {order.orderNumber} — {order.customerName} — متبقي{' '}
              {order.amountDue.toFixed(3)} {CURRENCY}
            </option>
          ))}
        </select>
        {!initialOrder && orderTotalPages > 1 && (
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
            <button type="button" onClick={() => setOrderPage((current) => Math.max(1, current - 1))} disabled={orderPage <= 1} className="rounded-lg border border-slate-700 px-2 py-1 disabled:opacity-40">
              <ChevronRight className="inline h-3 w-3" /> السابق
            </button>
            <span>{orderPage} / {orderTotalPages}</span>
            <button type="button" onClick={() => setOrderPage((current) => Math.min(orderTotalPages, current + 1))} disabled={orderPage >= orderTotalPages} className="rounded-lg border border-slate-700 px-2 py-1 disabled:opacity-40">
              التالي <ChevronLeft className="inline h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {selectedOrder && (
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-center">
          <div>
            <span className="block text-[10px] text-slate-500">الإجمالي</span>
            <strong className="text-slate-200">
              {selectedOrder.totalAmount.toFixed(3)}
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">المدفوع</span>
            <strong className="text-emerald-400">
              {selectedOrder.amountPaid.toFixed(3)}
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">المتبقي</span>
            <strong className="text-rose-400">
              {selectedOrder.amountDue.toFixed(3)}
            </strong>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block font-bold text-slate-300">
            مبلغ الدفعة ({CURRENCY}) *
          </label>
          <input
            type="number"
            min="0.001"
            step="0.001"
            max={selectedOrder?.amountDue}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-bold text-teal-300"
            required
          />
        </div>
        <div>
          <label className="mb-1 block font-bold text-slate-300">
            طريقة الدفع *
          </label>
          <select
            value={paymentMethod}
            onChange={(event) =>
              setPaymentMethod(event.target.value as typeof paymentMethod)
            }
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
          >
            <option value="cash">نقدي</option>
            <option value="cliq">CliQ</option>
            <option value="card">بطاقة</option>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="cheque">شيك</option>
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">
          رقم المرجع (اختياري)
        </label>
        <input
          value={referenceNumber}
          onChange={(event) => setReferenceNumber(event.target.value)}
          placeholder="رقم CliQ أو التحويل أو الشيك"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">
          ملاحظات (اختياري)
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-600 py-3 font-bold text-white transition hover:bg-teal-500 disabled:opacity-60"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ReceiptText className="h-4 w-4" />
        )}
        {saving ? 'جاري حفظ السند...' : 'حفظ سند القبض وتحديث الذمة'}
      </button>

      <p className="flex items-center gap-1 text-[10px] text-slate-500">
        <Banknote className="h-3 w-3" />
        تُربط الدفعة بالطلب وتُحدّث الذمة تلقائيًا من قاعدة البيانات.
      </p>
    </form>
  );
};
