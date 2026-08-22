import React, { useEffect, useState } from 'react';
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

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCustomerDetailsCrmFromSupabase(customerId);
    if (result.success && result.customer) {
      setCustomer(result.customer);
    } else {
      setError(result.error || 'تعذر تحميل ملف العميل.');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const unsubscribe = subscribeToCrmRealtime(load);
    return unsubscribe;
  }, [customerId]);

  if (loading && !customer) {
    return (
      <div className="mx-3 flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-10 text-xs font-bold text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
        جاري تحميل ملف العميل...
      </div>
    );
  }

  if (!customer || error) {
    return (
      <div className="mx-3 rounded-2xl border border-rose-800 bg-rose-950/50 p-5 text-xs text-rose-300">
        <p>{error || 'العميل غير موجود.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-3 rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-200"
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
    <div dir="rtl" className="space-y-4 px-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-300"
        >
          <ArrowRight className="h-4 w-4" />
          الدليل
        </button>
        <button
          type="button"
          onClick={refresh}
          className="rounded-xl border border-slate-700 bg-slate-800 p-2 text-slate-300"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-gradient-to-l from-indigo-950/70 to-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
              <UserRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">
                {customer.fullName}
              </h2>
              <p className="text-[10px] text-slate-400">
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
            className="flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 font-bold text-white"
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
                className="flex items-center justify-center gap-1 rounded-xl border border-emerald-800 bg-emerald-950/40 py-2 font-bold text-emerald-300"
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
                className="flex items-center justify-center gap-1 rounded-xl border border-green-800 bg-green-950/40 py-2 font-bold text-green-300"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                واتساب
              </a>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3">
          <ShoppingBag className="mb-1 h-4 w-4 text-blue-400" />
          <span className="block text-[9px] text-slate-500">كل الطلبات</span>
          <b className="text-blue-300">{stats.totalOrders}</b>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <span className="block text-[9px] text-slate-500">مبيعات مكتملة</span>
          <b className="text-emerald-300">
            {stats.totalSpending.toFixed(3)}
          </b>
        </div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
          <WalletCards className="mb-1 h-4 w-4 text-rose-400" />
          <span className="block text-[9px] text-slate-500">الذمة الحالية</span>
          <b className={stats.outstandingBalance > 0 ? 'text-rose-300' : 'text-emerald-300'}>
            {stats.outstandingBalance.toFixed(3)}
          </b>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-1.5 font-black text-white">
              <MapPin className="h-4 w-4 text-amber-400" />
              عناوين التوصيل
            </h3>
            <p className="text-[9px] text-slate-500">
              لا يتم إنشاء موقع افتراضي؛ الإحداثيات تظهر فقط عند إدخالها
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddressOpen(true)}
            className="flex items-center gap-1 rounded-xl bg-amber-500/10 px-2.5 py-2 font-bold text-amber-300"
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
                className="rounded-xl border border-slate-800 bg-slate-950 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-slate-200">
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
                      <p className="mt-1 text-[10px] text-slate-500">
                        {address.notes}
                      </p>
                    )}
                  </div>
                  {address.googleMapsUrl ? (
                    <a
                      href={address.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300"
                    >
                      الخريطة
                    </a>
                  ) : (
                    <span className="shrink-0 text-[9px] text-slate-600">
                      بدون GPS
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-950 p-4 text-center text-slate-500">
            لا توجد عناوين مسجلة.
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 font-black text-white">سجل طلبات المتجر</h3>
        {customer.orderHistory?.length ? (
          <div className="space-y-2">
            {customer.orderHistory.map((order) => (
              <div
                key={order.id}
                className="rounded-xl border border-slate-800 bg-slate-950 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] font-black text-blue-400">
                      {order.orderNumber}
                    </span>
                    <p className="text-[10px] text-slate-500">
                      {ORDER_STATUS_LABELS[order.status] || order.status} —{' '}
                      {new Date(order.createdAt).toLocaleDateString('ar-JO')}
                    </p>
                  </div>
                  <strong className="text-slate-200">
                    {order.totalAmount.toFixed(3)} {CURRENCY}
                  </strong>
                </div>
                {order.amountDue > 0 && (
                  <div className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">
                    مدفوع {order.amountPaid.toFixed(3)} — متبقي{' '}
                    {order.amountDue.toFixed(3)} {CURRENCY}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-950 p-4 text-center text-slate-500">
            لا توجد طلبات متجر لهذا العميل.
          </div>
        )}
      </section>

      {customer.notes && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 font-black text-white">ملاحظات داخلية</h3>
          <p className="leading-5 text-slate-400">{customer.notes}</p>
        </section>
      )}

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
