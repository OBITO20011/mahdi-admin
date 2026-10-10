import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Edit,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  ShoppingBag,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  fetchCustomerDetailsCrmFromSupabase,
  subscribeToCrmRealtime,
} from '../../services/supabase/crm.service';
import { CrmCustomer } from '../../types/crm';
import { AddAddressModal } from './AddAddressModal';
import { CustomerEditModal } from './CustomerEditModal';
import {CustomerAgingDetail} from './CustomerAging';
import {MoneyText, StatusBadge, StickyActionBar, UiButton} from '../../components/ui';
import {Modal} from '../../components/common/Modal';
import {RecordCustomerPaymentModal} from '../accounts/RecordCustomerPaymentModal';

interface CustomerDetailViewProps {
  customerId: string;
  onBack: () => void;
  onRefreshList: () => void;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'جديد',
  confirmed: 'مؤكد',
  preparing: 'قيد التجهيز',
  processing: 'قيد التجهيز',
  ready: 'جاهز',
  out_for_delivery: 'خرج للتوصيل',
  delivered: 'مكتمل',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  expired: 'انتهت مهلة الحجز',
};

function jordanWhatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('962')) return digits;
  if (digits.startsWith('0')) return `962${digits.slice(1)}`;
  return `962${digits}`;
}

export const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({
  customerId,
  onBack,
  onRefreshList,
}) => {
  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCustomerDetailsCrmFromSupabase(customerId, {
      historyPage: 1,
      historyPageSize: 25,
    });
    if (result.success && result.customer) {
      setCustomer(result.customer);
    } else {
      setError(result.error || 'تعذر تحميل ملف العميل.');
    }
    setLoading(false);
  }, [customerId]);

  const loadMoreHistory = async () => {
    if (!customer?.orderHistoryHasMore || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    const result = await fetchCustomerDetailsCrmFromSupabase(customerId, {
      historyPage: (customer.orderHistoryPage || 1) + 1,
      historyPageSize: customer.orderHistoryPageSize || 25,
    });
    if (result.success && result.customer) {
      setCustomer((current) => {
        if (!current) return result.customer;
        const existingIds = new Set(
          (current.orderHistory || []).map((order) => order.id)
        );
        return {
          ...result.customer,
          orderHistory: [
            ...(current.orderHistory || []),
            ...(result.customer?.orderHistory || []).filter(
              (order) => !existingIds.has(order.id)
            ),
          ],
        };
      });
    } else {
      setHistoryError(result.error || 'تعذر تحميل المزيد من سجل العميل.');
    }
    setHistoryLoading(false);
  };

  useEffect(() => {
    load();
    const unsubscribe = subscribeToCrmRealtime((change) => {
      if (
        change.customerIds.length === 0 ||
        change.customerIds.includes(customerId)
      ) {
        void load();
      }
    });
    return unsubscribe;
  }, [customerId, load]);

  if (loading && !customer) {
    return (
      <div className="mx-3 flex items-center justify-center gap-2 rounded-2xl border border-nw-border bg-nw-surface p-10 text-xs font-bold text-nw-muted">
        <Loader2 className="h-5 w-5 animate-spin text-nw-primary" />
        جاري تحميل ملف العميل...
      </div>
    );
  }

  if (!customer || error) {
    return (
      <div className="mx-3 rounded-2xl border border-nw-bad bg-nw-bad-bg p-5 text-xs text-nw-bad">
        <p>{error || 'العميل غير موجود.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 rounded-xl bg-nw-surface px-4 py-2 font-bold text-nw-text"
        >
          رجوع
        </button>
      </div>
    );
  }

  const stats = customer.stats || {
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    totalSpending: 0,
    outstandingBalance: 0,
    averageOrderValue: 0,
    lastOrderDate: null,
  };

  const refresh = async () => {
    await load();
    onRefreshList();
  };

  return (
    <div dir="rtl" className="min-w-0 space-y-4 p-4 pb-48 text-sm md:pb-4" data-testid="customer-detail">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="رجوع للعملاء"
          className="flex min-h-11 items-center gap-1 rounded-xl border border-nw-border bg-nw-surface px-3 py-2 font-bold text-nw-text"
        >
          <ArrowRight className="h-4 w-4" />
          رجوع للعملاء
        </button>
        <button
          type="button"
          onClick={refresh}
          aria-label="تحديث ملف العميل"
          className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-text"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded-2xl border border-nw-border bg-nw-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-nw-primary text-nw-on-primary">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="break-words text-base font-black text-nw-text">
                {customer.fullName}
              </h2>
              <p className="text-[10px] text-nw-muted">
                {customer.customerType === 'wholesale'
                  ? 'عميل جملة'
                  : 'عميل تجزئة'}{' '}
                — {customer.governorate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="flex min-h-11 items-center gap-1 rounded-xl bg-nw-primary px-3 py-2 font-bold text-nw-on-primary"
          >
            <Edit className="h-3.5 w-3.5" />
            تعديل
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {customer.phone && (
            <>
              <a
                href={`tel:${customer.phone}`}
                className="flex items-center justify-center gap-1 rounded-xl border border-nw-ok bg-nw-ok-bg py-2 font-bold text-nw-ok"
              >
                <Phone className="h-3.5 w-3.5" />
                {customer.phone}
              </a>
              <a
                href={`https://wa.me/${jordanWhatsappNumber(
                  customer.whatsapp || customer.phone
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 rounded-xl border border-nw-ok bg-nw-ok-bg py-2 font-bold text-nw-ok"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl bg-nw-hero p-4 text-nw-side-text [&_bdi_.text-nw-muted]:text-nw-side-muted">
        <span className="text-xs text-nw-side-muted">الدين الحالي</span><p className="m-0 text-3xl font-bold"><MoneyText amount={stats.outstandingBalance} currency /></p>
        {customer.creditLimit > 0 && customer.currentBalance > customer.creditLimit && <StatusBadge tone="bad">تجاوز حد الدين <MoneyText amount={customer.creditLimit} /></StatusBadge>}
      </div>
      <CustomerAgingDetail customerId={customer.id} revision={customer} />
      <div className="hidden md:block"><UiButton variant="accent" onClick={() => setPaymentOpen(true)}>تسجيل دفعة · اختيار الطلب</UiButton></div>
      <StickyActionBar className="z-50 md:hidden" data-testid="customer-payment-sticky"><UiButton variant="accent" size="large" onClick={() => setPaymentOpen(true)}>تسجيل دفعة · اختيار الطلب</UiButton></StickyActionBar>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-nw-info bg-nw-info-bg p-3">
          <ShoppingBag className="mb-1 h-4 w-4 text-nw-info" />
          <span className="block text-[9px] text-nw-muted">كل الطلبات</span>
          <b className="text-nw-info">{stats.totalOrders}</b>
        </div>
        <div className="rounded-2xl border border-nw-ok bg-nw-ok-bg p-3">
          <span className="block text-[9px] text-nw-muted">مبيعات مكتملة</span>
          <b className="text-nw-ok">
            {stats.totalSpending.toFixed(3)}
          </b>
        </div>
        <div className="rounded-2xl border border-nw-bad bg-nw-bad-bg p-3">
          <WalletCards className="mb-1 h-4 w-4 text-nw-bad" />
          <span className="block text-[9px] text-nw-muted">الذمة الحالية</span>
          <b className={stats.outstandingBalance > 0 ? 'text-nw-bad' : 'text-nw-ok'}>
            {stats.outstandingBalance.toFixed(3)}
          </b>
        </div>
      </div>

      <section className="rounded-2xl border border-nw-border bg-nw-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 font-black text-nw-text">
              <MapPin className="h-4 w-4 text-nw-warn" />
              عناوين التوصيل
            </h3>
            <p className="text-[9px] text-nw-muted">
              لا يتم إنشاء موقع افتراضي؛ الإحداثيات تظهر فقط عند إدخالها
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddressOpen(true)}
            className="flex items-center gap-1 rounded-xl bg-nw-warn-bg px-2.5 py-2 font-bold text-nw-warn"
          >
            <Plus className="h-3.5 w-3.5" />
            عنوان
          </button>
        </div>
        {customer.addresses?.length ? (
          <div className="space-y-2">
            {customer.addresses.map((address) => (
              <div
                key={address.id}
                className="rounded-xl border border-nw-border bg-nw-surface-2 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-nw-text">
                      {address.formattedAddress ||
                        [
                          address.governorate,
                          address.city,
                          address.area,
                          address.street,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                    </strong>
                    {address.notes && (
                      <p className="mt-1 text-[10px] text-nw-muted">
                        {address.notes}
                      </p>
                    )}
                  </div>
                  {address.googleMapsUrl ? (
                    <a
                      href={address.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg bg-nw-info-bg px-2 py-1 text-[9px] font-bold text-nw-info"
                    >
                      الخريطة
                    </a>
                  ) : (
                    <span className="shrink-0 text-[9px] text-nw-muted">
                      بدون GPS
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-nw-surface-2 p-4 text-center text-nw-muted">
            لا توجد عناوين مسجلة.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-nw-border bg-nw-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-black text-nw-text">سجل طلبات المتجر</h3>
          <span className="text-[9px] text-nw-muted">
            {customer.orderHistoryTotalCount || 0} طلب
          </span>
        </div>
        {customer.orderHistory?.length ? (
          <div className="space-y-2">
            {customer.orderHistory.map((order) => (
              <div
                key={order.id}
                className="rounded-xl border border-nw-border bg-nw-surface-2 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] font-black text-nw-info">
                      {order.orderNumber}
                    </span>
                    <p className="text-[10px] text-nw-muted">
                      {ORDER_STATUS_LABELS[order.status] || order.status} —{' '}
                      {new Date(order.createdAt).toLocaleDateString('ar-JO-u-nu-latn')}
                    </p>
                  </div>
                  <strong className="text-nw-text">
                    {order.totalAmount.toFixed(3)} {CURRENCY}
                  </strong>
                </div>
                {order.amountDue > 0 && (
                  <div className="mt-2 rounded-lg bg-nw-bad-bg px-2 py-1 text-[10px] text-nw-bad">
                    مدفوع {order.amountPaid.toFixed(3)} — متبقي{' '}
                    {order.amountDue.toFixed(3)} {CURRENCY}
                  </div>
                )}
              </div>
            ))}
            {customer.orderHistoryHasMore && (
              <button
                type="button"
                onClick={loadMoreHistory}
                disabled={historyLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface px-3 py-2 font-bold text-nw-text disabled:cursor-wait disabled:opacity-60"
              >
                {historyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {historyLoading ? 'جاري تحميل المزيد...' : 'تحميل طلبات أقدم'}
              </button>
            )}
            {historyError && (
              <p className="rounded-xl bg-nw-bad-bg px-3 py-2 text-center text-[10px] text-nw-bad">
                {historyError}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-nw-surface-2 p-4 text-center text-nw-muted">
            لا توجد طلبات متجر لهذا العميل.
          </div>
        )}
      </section>

      {customer.notes && (
        <section className="rounded-2xl border border-nw-border bg-nw-surface p-4">
          <h3 className="mb-2 font-black text-nw-text">ملاحظات داخلية</h3>
          <p className="leading-5 text-nw-muted">{customer.notes}</p>
        </section>
      )}
      <Modal isOpen={paymentOpen} title="تسجيل دفعة على طلب مستحق" onClose={() => setPaymentOpen(false)}>
        <RecordCustomerPaymentModal onClose={() => setPaymentOpen(false)} onSuccess={refresh} />
      </Modal>

      {editOpen && (
        <CustomerEditModal
          customer={customer}
          isOpen={editOpen}
          onClose={() => setEditOpen(false)}
          onCustomerUpdated={refresh}
        />
      )}
      {addressOpen && (
        <AddAddressModal
          customerId={customer.id}
          customerName={customer.fullName}
          isOpen={addressOpen}
          onClose={() => setAddressOpen(false)}
          onAddressAdded={refresh}
        />
      )}
    </div>
  );
};
