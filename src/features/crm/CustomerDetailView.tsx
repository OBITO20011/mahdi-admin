/**
 * Nawasrah Business Manager - Customer Details Full CRM View
 * Displays complete profile, addresses list, stats, order timeline, notes, tags & enterprise action buttons.
 */

import React, { useState, useEffect } from 'react';
import { CrmCustomer } from '../../types/crm';
import {
  fetchCustomerDetailsCrmFromSupabase,
  toggleCustomerBlockStatusInSupabase,
  softDeleteCustomerInSupabase,
  updateCustomerCrmInSupabase,
  subscribeToCrmRealtime,
} from '../../services/supabase/crm.service';
import { CURRENCY } from '../../constants';
import { AddAddressModal } from './AddAddressModal';
import { CustomerEditModal } from './CustomerEditModal';
import { useAppStore } from '../../stores/useAppStore';
import {
  ArrowRight,
  Phone,
  MessageSquare,
  MapPin,
  Calendar,
  Mail,
  ShieldAlert,
  Star,
  UserCheck,
  ShoppingBag,
  CheckCircle2,
  XCircle,
  TrendingUp,
  DollarSign,
  Clock,
  Plus,
  Edit,
  Trash2,
  ExternalLink,
  StickyNote,
  Tag,
  RefreshCw,
  Navigation,
} from 'lucide-react';

interface CustomerDetailViewProps {
  customerId: string;
  onBack: () => void;
  onRefreshList: () => void;
}

export const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({
  customerId,
  onBack,
  onRefreshList,
}) => {
  const { openModal, setToast } = useAppStore();

  const [customer, setCustomer] = useState<CrmCustomer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isAddAddressOpen, setIsAddAddressOpen] = useState<boolean>(false);
  const [editingNotes, setEditingNotes] = useState<boolean>(false);
  const [notesText, setNotesText] = useState<string>('');

  const loadDetails = async () => {
    setLoading(true);
    setError(null);

    const res = await fetchCustomerDetailsCrmFromSupabase(customerId);

    if (res.success && res.customer) {
      setCustomer(res.customer);
      setNotesText(res.customer.notes || '');
    } else {
      setError(res.error || 'تعذر جلب تفاصيل العميل من قاعدة البيانات.');
    }

    setLoading(false);
  };

  useEffect(() => {
    loadDetails();

    const unsubscribe = subscribeToCrmRealtime(() => {
      loadDetails();
      onRefreshList();
    });

    return () => {
      unsubscribe();
    };
  }, [customerId]);

  const handleToggleBlock = async () => {
    if (!customer) return;
    const nextBlocked = !customer.isBlocked;
    const confirmMsg = nextBlocked
      ? `هل أنت أيد أنك تريد حظر العميل "${customer.fullName}"؟`
      : `هل تريد إلغاء حظر العميل "${customer.fullName}"؟`;

    if (!window.confirm(confirmMsg)) return;

    const res = await toggleCustomerBlockStatusInSupabase(customer.id, nextBlocked);
    if (res.success) {
      setToast(nextBlocked ? 'تم حظر العميل بنجاح' : 'تم إلغاء حظر العميل بنجاح', 'success');
      loadDetails();
      onRefreshList();
    } else {
      setToast(res.error || 'فشلت عملية تحديث حالة الحظر', 'error');
    }
  };

  const handleSoftDelete = async () => {
    if (!customer) return;
    if (!window.confirm(`هل أنت أيد أنك تريد نقل العميل "${customer.fullName}" إلى سلة المحذوفات؟`)) return;

    const res = await softDeleteCustomerInSupabase(customer.id);
    if (res.success) {
      setToast('تم حذف العميل بنجاح', 'success');
      onRefreshList();
      onBack();
    } else {
      setToast(res.error || 'فشلت عملية الحذف', 'error');
    }
  };

  const handleSaveNotes = async () => {
    if (!customer) return;
    const res = await updateCustomerCrmInSupabase(customer.id, { notes: notesText });
    if (res.success) {
      setToast('تم تحديث الملاحظات الداخلية بنجاح', 'success');
      setEditingNotes(false);
      loadDetails();
    } else {
      setToast(res.error || 'فشل حفظ الملاحظات', 'error');
    }
  };

  // Loading state
  if (loading && !customer) {
    return (
      <div dir="rtl" className="p-4 space-y-4 max-w-5xl mx-auto">
        <div className="h-10 w-28 bg-slate-900 rounded-xl animate-pulse" />
        <div className="h-40 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse p-4" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error || !customer) {
    return (
      <div dir="rtl" className="p-4 max-w-xl mx-auto text-center space-y-4 mt-8">
        <div className="bg-rose-950/80 border border-rose-800 p-6 rounded-2xl space-y-3">
          <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto" />
          <h3 className="text-sm font-bold text-white">خطأ في عرض ملف العميل</h3>
          <p className="text-xs text-rose-300">{error || 'العميل غير موجود'}</p>
          <button
            onClick={onBack}
            className="bg-slate-800 text-slate-200 px-4 py-2 rounded-xl text-xs font-bold"
          >
            العودة لقائمة العملاء
          </button>
        </div>
      </div>
    );
  }

  const primaryAddress = customer.addresses && customer.addresses.length > 0 ? customer.addresses[0] : null;
  const primaryMapsUrl = primaryAddress?.googleMapsUrl || `https://maps.google.com/?q=${encodeURIComponent(customer.governorate + ' ' + customer.fullName)}`;

  const stats = customer.stats || {
    totalOrders: customer.totalOrdersCount,
    completedOrders: 0,
    cancelledOrders: 0,
    totalSpending: customer.totalSpending,
    averageOrderValue: 0,
    lastOrderDate: null,
  };

  return (
    <div dir="rtl" className="p-3 sm:p-4 space-y-4 pb-24 max-w-5xl mx-auto text-xs">
      {/* Top Header & Back Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition active:scale-95"
        >
          <ArrowRight className="w-4 h-4" />
          <span>العودة لقائمة العملاء</span>
        </button>

        <button
          onClick={loadDetails}
          className="bg-slate-900 hover:bg-slate-800 text-slate-300 p-2 rounded-xl border border-slate-800 transition"
          title="تحديث بيانات العميل"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 1. Customer Profile Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 p-4 sm:p-5 rounded-2xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {/* Status Badge */}
              {customer.isBlocked ? (
                <span className="text-[10px] font-black bg-rose-950 text-rose-300 border border-rose-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" />
                  <span>محظور Blocked</span>
                </span>
              ) : customer.isVip ? (
                <span className="text-[10px] font-black bg-amber-950 text-amber-300 border border-amber-700 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Star className="w-3 h-3 fill-amber-300" />
                  <span>عميل VIP متميز</span>
                </span>
              ) : customer.isActive ? (
                <span className="text-[10px] font-black bg-emerald-950 text-emerald-300 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <UserCheck className="w-3 h-3" />
                  <span>حساب نشط Active</span>
                </span>
              ) : (
                <span className="text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 px-2.5 py-0.5 rounded-full">
                  حساب غير نشط
                </span>
              )}

              {/* Tags */}
              {customer.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="text-[10px] font-extrabold bg-blue-950 text-blue-300 border border-blue-800 px-2.5 py-0.5 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
              <span>{customer.fullName}</span>
            </h1>

            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 font-mono">
                <Phone className="w-3.5 h-3.5 text-blue-400" />
                <span>{customer.phone}</span>
              </span>

              {customer.email && (
                <span className="flex items-center gap-1 font-mono">
                  <Mail className="w-3.5 h-3.5 text-blue-400" />
                  <span>{customer.email}</span>
                </span>
              )}

              <span className="flex items-center gap-1 text-slate-400">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>مسجل منذ: {new Date(customer.createdAt).toLocaleDateString('ar-JO')}</span>
              </span>
            </p>
          </div>

          {/* Toolbar Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-2 rounded-xl transition flex items-center gap-1 text-xs shadow"
            >
              <Edit className="w-3.5 h-3.5" />
              <span>تعديل</span>
            </button>

            <button
              onClick={handleToggleBlock}
              className={`font-bold px-3 py-2 rounded-xl transition flex items-center gap-1 text-xs border ${
                customer.isBlocked
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                  : 'bg-amber-600/20 text-amber-300 border-amber-500/30 hover:bg-amber-600/30'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{customer.isBlocked ? 'إلغاء الحظر' : 'حظر العميل'}</span>
            </button>

            <button
              onClick={handleSoftDelete}
              className="bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900 px-3 py-2 rounded-xl font-bold transition flex items-center gap-1 text-xs"
              title="نقل لسلة المحذوفات"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف</span>
            </button>
          </div>
        </div>

        {/* Quick Contact Options */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <a
            href={`tel:${customer.phone}`}
            className="bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 border border-slate-700"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>اتصال هاتفي</span>
          </a>

          <a
            href={`https://wa.me/${customer.whatsapp || customer.phone}`}
            target="_blank"
            rel="noreferrer"
            className="bg-slate-800 hover:bg-emerald-600 text-emerald-400 hover:text-white px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 border border-slate-700"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>واتساب المبيعات</span>
          </a>

          <a
            href={primaryMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-slate-800 hover:bg-rose-600 text-rose-400 hover:text-white px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 border border-slate-700"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>خرائط جوجل</span>
          </a>
        </div>
      </div>

      {/* 2. Customer Statistics Grid (6 Metrics) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">إجمالي الطلبات</span>
          <div className="text-base font-black text-slate-100 flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-blue-400" />
            <span>{stats.totalOrders}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">طلبات منجزة</span>
          <div className="text-base font-black text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>{stats.completedOrders}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">طلبات ملغاة</span>
          <div className="text-base font-black text-rose-400 flex items-center gap-1.5">
            <XCircle className="w-4 h-4" />
            <span>{stats.cancelledOrders}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">إجمالي الإنفاق</span>
          <div className="text-base font-black text-amber-400 flex items-center gap-1">
            <span>{stats.totalSpending.toFixed(2)}</span>
            <span className="text-[10px] text-slate-400">{CURRENCY}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">متوسط قيمة الطلب</span>
          <div className="text-base font-black text-cyan-400 flex items-center gap-1">
            <span>{stats.averageOrderValue.toFixed(2)}</span>
            <span className="text-[10px] text-slate-400">{CURRENCY}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">آخر طلب</span>
          <div className="text-xs font-extrabold text-slate-200 flex items-center gap-1 truncate mt-0.5">
            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              {stats.lastOrderDate
                ? new Date(stats.lastOrderDate).toLocaleDateString('ar-JO')
                : 'لا يوجد'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Customer Addresses Section */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <h3 className="text-xs font-extrabold text-slate-100 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-rose-400" />
            <span>عناوين التوصيل المسجلة ({customer.addresses?.length || 0})</span>
          </h3>

          <button
            onClick={() => setIsAddAddressOpen(true)}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition flex items-center gap-1 shadow"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة عنوان جديد</span>
          </button>
        </div>

        {customer.addresses && customer.addresses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {customer.addresses.map((addr) => (
              <div
                key={addr.id}
                className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2 text-xs relative"
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-200 text-xs flex items-center gap-1">
                    <Navigation className="w-3 h-3 text-rose-400" />
                    <span>{addr.governorate} • {addr.area}</span>
                  </span>

                  <a
                    href={addr.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1 text-[11px] font-bold"
                  >
                    <span>خرائط جوجل</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <p className="text-slate-400 text-[11px] leading-relaxed">
                  الشارع: <strong className="text-slate-200">{addr.street || 'غير محدد'}</strong>
                  {addr.building ? ` • مبنى: ${addr.building}` : ''}
                  {addr.floor ? ` • طابق: ${addr.floor}` : ''}
                  {addr.apartment ? ` • شقة: ${addr.apartment}` : ''}
                </p>

                {addr.notes && (
                  <p className="text-[10px] text-amber-300/90 bg-amber-950/40 border border-amber-800/40 p-1.5 rounded-lg">
                    ملاحظات: {addr.notes}
                  </p>
                )}

                <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 font-mono">
                  <span>الإحداثيات: {addr.latitude?.toFixed(4)}, {addr.longitude?.toFixed(4)}</span>
                  <span>{addr.locationSource || 'GPS'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800/80 p-4 rounded-xl text-center text-slate-400 text-xs">
            لا توجد عناوين مسجلة للعميل. يمكنك إضافة عنوان جديد الآن.
          </div>
        )}
      </div>

      {/* 4. Order History Timeline */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <h3 className="text-xs font-extrabold text-slate-100 flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-blue-400" />
            <span>سجل طلبات العميل (Order Timeline)</span>
          </h3>
          <span className="text-[10px] text-slate-400">إجمالي {customer.orderHistory?.length || 0} طلبات</span>
        </div>

        {customer.orderHistory && customer.orderHistory.length > 0 ? (
          <div className="space-y-2">
            {customer.orderHistory.map((ord) => (
              <div
                key={ord.id}
                className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex items-center justify-between text-xs transition hover:border-slate-700"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-extrabold text-blue-400 font-mono">{ord.orderNumber}</span>
                    <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-bold">
                      {ord.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 block">
                    تاريخ الطلب: {new Date(ord.createdAt).toLocaleString('ar-JO')} • {ord.itemsCount} صنف
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-left">
                    <span className="text-[10px] text-slate-500 block">الإجمالي:</span>
                    <span className="font-black text-emerald-400">
                      {ord.totalAmount.toFixed(2)} {CURRENCY}
                    </span>
                  </div>

                  <button
                    onClick={() => openModal('view_order', { id: ord.id })}
                    className="bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1 text-[11px]"
                  >
                    <span>فتح الطلب</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-slate-950 border border-slate-800/80 p-4 rounded-xl text-center text-slate-400 text-xs">
            لا توجد طلبات سابقة لهذا العميل حتى الآن.
          </div>
        )}
      </div>

      {/* 5. Internal Customer Notes Section */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-lg space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <h3 className="text-xs font-extrabold text-slate-100 flex items-center gap-1.5">
            <StickyNote className="w-4 h-4 text-amber-400" />
            <span>الملاحظات الداخلية للعميل (Internal Notes)</span>
          </h3>

          {!editingNotes ? (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-blue-400 hover:underline font-bold text-xs flex items-center gap-1"
            >
              <Edit className="w-3.5 h-3.5" />
              <span>تعديل الملاحظات</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setEditingNotes(false)}
                className="bg-slate-800 text-slate-300 px-3 py-1 rounded-lg text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveNotes}
                className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold"
              >
                حفظ
              </button>
            </div>
          )}
        </div>

        {editingNotes ? (
          <textarea
            rows={3}
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="اكتب ملاحظات بخصوص طريقة دفع العميل، أي حساسيات أو شروط خاصة..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 text-xs focus:outline-none focus:border-blue-500 resize-none"
          />
        ) : (
          <p className="text-slate-300 text-xs leading-relaxed bg-slate-950 border border-slate-800/80 p-3 rounded-xl min-h-[3rem]">
            {customer.notes || 'لا توجد ملاحظات مدخلة للعميل بعد.'}
          </p>
        )}
      </div>

      {/* Modals */}
      {isEditModalOpen && (
        <CustomerEditModal
          customer={customer}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onCustomerUpdated={() => {
            loadDetails();
            onRefreshList();
          }}
        />
      )}

      {isAddAddressOpen && (
        <AddAddressModal
          customerId={customer.id}
          customerName={customer.fullName}
          isOpen={isAddAddressOpen}
          onClose={() => setIsAddAddressOpen(false)}
          onAddressAdded={() => {
            loadDetails();
            onRefreshList();
          }}
        />
      )}
    </div>
  );
};
