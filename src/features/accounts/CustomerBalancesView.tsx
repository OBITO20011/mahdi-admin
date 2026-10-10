import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ReceiptText,
  RefreshCw,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  CustomerOutstandingOrder,
  fetchCustomerOutstandingOrders,
} from '../../services/supabase/customerAccounts.service';
import { RecordCustomerPaymentModal } from './RecordCustomerPaymentModal';

export const CustomerBalancesView: React.FC = () => {
  const [orders, setOrders] = useState<CustomerOutstandingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] =
    useState<CustomerOutstandingOrder | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [serverSummary, setServerSummary] = useState({ amount: 0, customers: 0 });

  const loadBalances = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCustomerOutstandingOrders({ page, pageSize: 25 });
    if (result.success) {
      setOrders(result.orders);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
      setServerSummary(result.summary);
    } else {
      setError(result.error || 'تعذر تحميل الذمم.');
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const summary = useMemo(() => {
    return {
      amount: serverSummary.amount,
      customers: serverSummary.customers,
      orders: totalCount,
    };
  }, [serverSummary, totalCount]);

  return (
    <div className="space-y-4 px-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-black text-nw-text">
            <WalletCards className="h-4 w-4 text-nw-ok" />
            الذمم المطلوب تحصيلها
          </h3>
          <p className="mt-0.5 text-[11px] text-nw-muted">
            تظهر فقط المبالغ المتبقية على الطلبات المكتملة
          </p>
        </div>
        <button
          type="button"
          onClick={loadBalances}
          disabled={loading}
          className="flex items-center gap-1 rounded-xl border border-nw-border bg-nw-surface px-3 py-2 font-bold text-nw-text"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-nw-bad bg-nw-bad-bg p-3">
          <Banknote className="mb-1 h-4 w-4 text-nw-bad" />
          <span className="block text-[9px] text-nw-muted">إجمالي الذمم</span>
          <strong className="text-sm text-nw-bad">
            {summary.amount.toFixed(3)}
          </strong>
          <span className="mr-1 text-[9px] text-nw-muted">{CURRENCY}</span>
        </div>
        <div className="rounded-2xl border border-nw-info bg-nw-info-bg p-3">
          <Users className="mb-1 h-4 w-4 text-nw-info" />
          <span className="block text-[9px] text-nw-muted">عملاء عليهم ذمم</span>
          <strong className="text-sm text-nw-info">{summary.customers}</strong>
        </div>
        <div className="rounded-2xl border border-nw-warn bg-nw-warn-bg p-3">
          <ReceiptText className="mb-1 h-4 w-4 text-nw-warn" />
          <span className="block text-[9px] text-nw-muted">طلبات مستحقة</span>
          <strong className="text-sm text-nw-warn">{summary.orders}</strong>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-nw-border bg-nw-surface p-10 font-bold text-nw-muted">
          <Loader2 className="h-5 w-5 animate-spin text-nw-ok" />
          جاري تحميل الذمم...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-nw-bad bg-nw-bad-bg p-4 text-nw-bad">
          <AlertCircle className="mb-2 h-5 w-5" />
          {error}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-nw-ok bg-nw-ok-bg p-8 text-center">
          <WalletCards className="mx-auto mb-2 h-10 w-10 text-nw-ok" />
          <h4 className="font-black text-nw-text">لا توجد ذمم مستحقة</h4>
          <p className="mt-1 text-[11px] text-nw-muted">
            جميع الطلبات المكتملة مدفوعة بالكامل.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <article
              key={order.id}
              className="rounded-2xl border border-nw-border bg-nw-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono text-[10px] font-black text-nw-info">
                    {order.orderNumber}
                  </span>
                  <h4 className="font-bold text-nw-text">{order.customerName}</h4>
                  <span className="text-[10px] text-nw-muted">
                    {order.customerPhone || 'لا يوجد هاتف'}
                  </span>
                </div>
                <div className="text-left">
                  <span className="block text-[9px] text-nw-muted">
                    المتبقي
                  </span>
                  <strong className="text-sm text-nw-bad">
                    {order.amountDue.toFixed(3)} {CURRENCY}
                  </strong>
                </div>
              </div>

              <div className="my-3 grid grid-cols-2 gap-2 rounded-xl bg-nw-surface-2 p-2 text-[10px]">
                <span className="text-nw-muted">
                  إجمالي الطلب:{' '}
                  <b className="text-nw-text">
                    {order.totalAmount.toFixed(3)}
                  </b>
                </span>
                <span className="text-nw-muted">
                  المدفوع:{' '}
                  <b className="text-nw-ok">
                    {order.amountPaid.toFixed(3)}
                  </b>
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-ok-bg py-2.5 font-bold text-nw-text hover:bg-nw-ok-bg"
              >
                <Banknote className="h-4 w-4" />
                تسجيل دفعة على هذا الطلب
              </button>
            </article>
          ))}
          {totalCount > 0 && (
            <div className="flex items-center justify-between rounded-2xl border border-nw-border bg-nw-surface p-2 text-[11px] font-bold text-nw-muted">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 rounded-xl bg-nw-surface px-3 py-2 text-nw-text disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" /> السابق
              </button>
              <span>{page} / {totalPages} · {totalCount} طلب</span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 rounded-xl bg-nw-surface px-3 py-2 text-nw-text disabled:opacity-40"
              >
                التالي <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-nw-surface-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-nw-border bg-nw-surface p-5 shadow-2xl sm:rounded-3xl">
            <div className="mb-4 flex items-start justify-between border-b border-nw-border pb-3">
              <div>
                <h3 className="text-sm font-black text-nw-text">
                  تسجيل دفعة عميل
                </h3>
                <p className="text-[10px] text-nw-muted">
                  سند قبض مرتبط بالطلب {selectedOrder.orderNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="rounded-full bg-nw-surface p-2 text-nw-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <RecordCustomerPaymentModal
              initialOrder={selectedOrder}
              onClose={() => setSelectedOrder(null)}
              onSuccess={loadBalances}
            />
          </div>
        </div>
      )}
    </div>
  );
};
