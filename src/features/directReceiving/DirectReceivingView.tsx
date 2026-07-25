/**
 * Nawasrah Business Manager - Direct Goods Receiving Main View
 * Module Name: "استلام البضائع من الموردين"
 * Subtitle: "تسجيل البضاعة الواردة، تحديث المخزون، وحساب مستحقات الموردين"
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { SupplierReceipt } from '../../types/directReceiving';
import { Supplier } from '../../types';
import {
  fetchSupplierReceiptsFromSupabase,
  fetchSuppliersForReceivingFromSupabase,
  fetchWarehousesForReceivingFromSupabase,
  subscribeToSupplierReceiptsRealtime,
} from '../../services/supabase/directReceiving.service';
import { CreateDirectReceiptModal } from './CreateDirectReceiptModal';
import { SupplierReceiptDetailView } from './SupplierReceiptDetailView';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';
import { Modal } from '../../components/common/Modal';
import { CURRENCY } from '../../constants';
import {
  Building2,
  PackageCheck,
  Plus,
  Search,
  Filter,
  DollarSign,
  Printer,
  Archive,
  RefreshCw,
  Loader2,
  Calendar,
  Warehouse as WarehouseIcon,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  FileText,
  Users,
  ChevronLeft,
  ArrowUpRight,
  ShieldCheck,
  History,
} from 'lucide-react';

export const DirectReceivingView: React.FC = () => {
  const { openModal, setToast } = useAppStore();

  // Primary Receipts State
  const [receipts, setReceipts] = useState<SupplierReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Active View State
  const [activeTab, setActiveTab] = useState<'all' | 'unpaid' | 'partially_paid' | 'paid' | 'archived' | 'suppliers' | 'old_history'>('all');
  const [selectedReceipt, setSelectedReceipt] = useState<SupplierReceipt | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [paymentModalReceipt, setPaymentModalReceipt] = useState<SupplierReceipt | null>(null);

  // Filters State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('');
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('');

  // Load Data
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [receiptsRes, supsData, whsData] = await Promise.all([
        fetchSupplierReceiptsFromSupabase({
          isArchived: activeTab === 'archived',
          paymentStatus: ['unpaid', 'partially_paid', 'paid'].includes(activeTab) ? activeTab : undefined,
          supplierId: selectedSupplierFilter || undefined,
          warehouseId: selectedWarehouseFilter || undefined,
          search: searchTerm || undefined,
        }),
        fetchSuppliersForReceivingFromSupabase(),
        fetchWarehousesForReceivingFromSupabase(),
      ]);

      if (receiptsRes.success && receiptsRes.data) {
        setReceipts(receiptsRes.data);
      }
      setSuppliers(supsData);
      setWarehouses(whsData);
    } catch (err) {
      console.error('Error loading supplier receipts:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [activeTab, selectedSupplierFilter, selectedWarehouseFilter, searchTerm]);

  useEffect(() => {
    loadData();

    // Subscribe to Supabase Realtime updates
    const unsubscribe = subscribeToSupplierReceiptsRealtime(() => {
      loadData(true);
    });

    return () => {
      unsubscribe();
    };
  }, [loadData]);

  // Minor units to JOD helper
  const minorToJod = (fils: number) => (fils / 1000).toFixed(3);

  // Filtered Receipts List
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      if (activeTab === 'archived') return r.isArchived;
      if (r.isArchived && activeTab !== 'archived') return false;

      if (activeTab === 'unpaid' && r.paymentStatus !== 'unpaid') return false;
      if (activeTab === 'partially_paid' && r.paymentStatus !== 'partially_paid') return false;
      if (activeTab === 'paid' && r.paymentStatus !== 'paid') return false;

      return true;
    });
  }, [receipts, activeTab]);

  // Today KPI Aggregations
  const kpiMetrics = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    const todayReceipts = receipts.filter(
      (r) => !r.isArchived && r.receivedAt && r.receivedAt.startsWith(todayStr)
    );

    const todayCount = todayReceipts.length;
    const todayValueFils = todayReceipts.reduce((sum, r) => sum + r.totalInMinorUnits, 0);
    const todayPaidFils = todayReceipts.reduce((sum, r) => sum + r.amountPaidInMinorUnits, 0);

    const totalOutstandingDueFils = receipts
      .filter((r) => !r.isArchived)
      .reduce((sum, r) => sum + r.amountDueInMinorUnits, 0);

    const totalReceivedItemsCount = receipts
      .filter((r) => !r.isArchived)
      .reduce((sum, r) => sum + (r.items?.length || 0), 0);

    return {
      todayCount,
      todayValueJod: (todayValueFils / 1000).toFixed(3),
      todayPaidJod: (todayPaidFils / 1000).toFixed(3),
      outstandingDueJod: (totalOutstandingDueFils / 1000).toFixed(3),
      suppliersCount: suppliers.length,
      receivedItemsCount: totalReceivedItemsCount,
    };
  }, [receipts, suppliers]);

  // Handle Detail View
  if (selectedReceipt) {
    return (
      <div className="p-2 sm:p-4 pb-24 max-w-7xl mx-auto">
        <SupplierReceiptDetailView
          receipt={selectedReceipt}
          onBack={() => setSelectedReceipt(null)}
          onRecordPayment={(r) => setPaymentModalReceipt(r)}
          onRefresh={() => {
            loadData();
            setSelectedReceipt(null);
          }}
        />

        {/* Payment Modal */}
        {paymentModalReceipt && (
          <Modal
            isOpen={Boolean(paymentModalReceipt)}
            onClose={() => setPaymentModalReceipt(null)}
            title="تسجيل دفعة للمورد"
            subtitle="سداد دفعة على مستحقات سند استلام بضائع"
          >
            <RecordSupplierPaymentModal
              receipt={paymentModalReceipt}
              onClose={() => setPaymentModalReceipt(null)}
              onSuccess={() => {
                loadData();
                setSelectedReceipt(null);
              }}
            />
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div dir="rtl" className="p-2 sm:p-4 space-y-4 pb-24 max-w-7xl mx-auto">
      {/* Module Title Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 p-4 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
              <PackageCheck className="w-5 h-5" />
            </div>
            <h1 className="text-base font-black text-slate-100">استلام البضائع من الموردين</h1>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            تسجيل البضاعة الواردة، تحديث المخزون، وحساب مستحقات الموردين مباشرة
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-600 text-white font-extrabold px-4 py-2 rounded-xl text-xs hover:from-emerald-500 hover:to-teal-500 transition shadow-lg shadow-emerald-900/30 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>استلام بضاعة جديد</span>
          </button>

          <button
            onClick={() => openModal('add_supplier')}
            className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-700 transition flex items-center gap-1"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            <span>إضافة مورد</span>
          </button>

          <button
            onClick={() => loadData()}
            className="bg-slate-800 text-slate-400 p-2 rounded-xl hover:text-slate-200 transition"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Summary Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">استلامات اليوم</span>
          <span className="font-extrabold text-white text-base block">{kpiMetrics.todayCount} شحنات</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">قيمة بضاعة اليوم</span>
          <span className="font-extrabold text-emerald-400 text-sm block">
            {kpiMetrics.todayValueJod} {CURRENCY}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">المدفوع اليوم</span>
          <span className="font-extrabold text-teal-300 text-sm block">
            {kpiMetrics.todayPaidJod} {CURRENCY}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">المتبقي للموردين (ذمم)</span>
          <span className="font-extrabold text-rose-400 text-sm block">
            {kpiMetrics.outstandingDueJod} {CURRENCY}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">عدد الموردين</span>
          <span className="font-extrabold text-blue-400 text-base block">{kpiMetrics.suppliersCount} مورد</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-slate-400 font-bold block">الأصناف المستلمة</span>
          <span className="font-extrabold text-purple-400 text-base block">{kpiMetrics.receivedItemsCount} صنف</span>
        </div>
      </div>

      {/* Main Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 border border-slate-800 p-1.5 rounded-2xl text-xs font-bold">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'all' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            جميع الاستلامات
          </button>
          <button
            onClick={() => setActiveTab('unpaid')}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'unpaid' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            غير مدفوع (ذمم)
          </button>
          <button
            onClick={() => setActiveTab('partially_paid')}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'partially_paid' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            مدفوع جزئيًا
          </button>
          <button
            onClick={() => setActiveTab('paid')}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'paid' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            مدفوع بالكامل
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'archived' ? 'bg-slate-800 text-amber-300 shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            المؤرشفة
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-3 py-1.5 rounded-xl border transition ${
              activeTab === 'suppliers'
                ? 'bg-slate-800 text-blue-400 border-blue-500/50'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            دليل الموردين ({suppliers.length})
          </button>
          <button
            onClick={() => setActiveTab('old_history')}
            className={`px-3 py-1.5 rounded-xl border transition flex items-center gap-1 ${
              activeTab === 'old_history'
                ? 'bg-slate-800 text-purple-400 border-purple-500/50'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5 text-purple-400" />
            <span>سجل المشتريات القديم</span>
          </button>
        </div>
      </div>

      {/* Search & Secondary Filters */}
      {activeTab !== 'suppliers' && activeTab !== 'old_history' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-900 border border-slate-800 p-2.5 rounded-2xl">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث برقم السند أو فاتورة المورد..."
              className="w-full bg-transparent text-slate-100 placeholder-slate-500 outline-none font-bold"
            />
          </div>

          <select
            value={selectedSupplierFilter}
            onChange={(e) => setSelectedSupplierFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
          >
            <option value="">جميع الموردين</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </select>

          <select
            value={selectedWarehouseFilter}
            onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
          >
            <option value="">جميع المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Suppliers Tab Content */}
      {activeTab === 'suppliers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">قائمة الموردين النشطين والمستحقات:</span>
            <button
              onClick={() => openModal('add_supplier')}
              className="bg-blue-600/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-xl text-xs font-bold hover:bg-blue-600/30 transition flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة مورد جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suppliers.map((sup) => (
              <div key={sup.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-slate-100 text-sm">{sup.companyName}</h3>
                  <span className="text-[10px] text-slate-400">مسؤول التواصل: {sup.contactPerson || 'غير محدد'}</span>
                </div>

                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>هاتف: {sup.phone || 'بدون هاتف'}</span>
                  <span>العنوان: {sup.address || 'عمان'}</span>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-bold pt-2">
                  <span className="text-slate-400">الرصيد/المستحقات الحالية:</span>
                  <span className="text-rose-400 font-extrabold">{sup.currentBalance} {CURRENCY}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Old Purchase Orders History Read-Only Screen */}
      {activeTab === 'old_history' && (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mx-auto">
            <History className="w-6 h-6" />
          </div>
          <h3 className="font-extrabold text-slate-100 text-sm">سجل طلبيات الشراء القديمة (للعرض فقط)</h3>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            تم إيقاف نظام طلبات الشراء والموافقات بناءً على سياسة العمل المباشر. يتم استلام البضائع الواردة فوراً عبر قسم
            "استلام البضائع من الموردين".
          </p>
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-400 max-w-md mx-auto">
            السجلات القديمة محفوظة بأمان في الأرشيف للأغراض المحاسبية والقانونية.
          </div>
        </div>
      )}

      {/* Primary Receipts List Cards */}
      {activeTab !== 'suppliers' && activeTab !== 'old_history' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto" />
              <p className="text-xs font-bold">جاري تحميل سندات استلام البضائع...</p>
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="bg-slate-900 border border-dashed border-slate-800 p-12 rounded-2xl text-center space-y-3">
              <PackageCheck className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="font-bold text-slate-200 text-xs">لا توجد سندات استلام بضائع مطابقة</h3>
              <p className="text-[11px] text-slate-500">اضغط على زر "استلام بضاعة جديد" لتسجيل الشحنة الواردة فوراً.</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>استلام بضاعة جديد</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredReceipts.map((r) => {
                const isPaid = r.paymentStatus === 'paid';
                const isPartial = r.paymentStatus === 'partially_paid';

                return (
                  <div
                    key={r.id}
                    className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-md space-y-3 hover:border-slate-700 transition"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <div>
                        <span className="font-mono font-extrabold text-blue-400 text-xs block">
                          {r.receiptNumber}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold block mt-0.5">
                          {r.supplierName}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                          isPaid
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : isPartial
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {isPaid ? 'مدفوع' : isPartial ? 'مدفوع جزئياً' : 'غير مدفوع'}
                      </span>
                    </div>

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <div>
                        <span>المستودع: </span>
                        <strong className="text-slate-200">{r.warehouseName}</strong>
                      </div>
                      <div>
                        <span>فاتورة المورد: </span>
                        <strong className="text-slate-200">{r.supplierInvoiceNumber || 'غير متاح'}</strong>
                      </div>
                      <div>
                        <span>عدد الأصناف: </span>
                        <strong className="text-slate-200">{r.items?.length || 0} صنف</strong>
                      </div>
                      <div>
                        <span>التاريخ: </span>
                        <strong className="text-slate-200">
                          {new Date(r.receivedAt).toLocaleDateString('ar-JO')}
                        </strong>
                      </div>
                    </div>

                    {/* Financial Numbers */}
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-bold">الإجمالي:</span>
                        <span className="font-extrabold text-slate-100 font-mono">
                          {minorToJod(r.totalInMinorUnits)} {CURRENCY}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 font-bold">المدفوع:</span>
                        <span className="font-bold text-emerald-400 font-mono">
                          {minorToJod(r.amountPaidInMinorUnits)} {CURRENCY}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-900 pt-1">
                        <span className="text-slate-400 font-bold">المتبقي للمورد:</span>
                        <span className="font-extrabold text-rose-400 font-mono">
                          {minorToJod(r.amountDueInMinorUnits)} {CURRENCY}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-800/80">
                      <button
                        onClick={() => setSelectedReceipt(r)}
                        className="bg-slate-800 text-blue-300 hover:bg-slate-700 px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض التفاصيل</span>
                      </button>

                      {r.amountDueInMinorUnits > 0 && (
                        <button
                          onClick={() => setPaymentModalReceipt(r)}
                          className="bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1"
                        >
                          <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                          <span>سداد دفعة</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Create Receipt Modal */}
      {showCreateModal && (
        <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="استلام بضائع من الموردين (إذن توريد جديد)"
          subtitle="تسجيل الشحنة المباشرة، إدخال أسعار وطرود المنتجات، وتحديث المخزون والمستحقات"
        >
          <CreateDirectReceiptModal
            onClose={() => setShowCreateModal(false)}
            onSuccess={() => loadData()}
          />
        </Modal>
      )}

      {/* Standalone Record Payment Modal */}
      {paymentModalReceipt && (
        <Modal
          isOpen={Boolean(paymentModalReceipt)}
          onClose={() => setPaymentModalReceipt(null)}
          title="تسجيل دفعة للمورد"
          subtitle="سداد دفعة نقدية أو تحويل لحساب المورد على سند استلام"
        >
          <RecordSupplierPaymentModal
            receipt={paymentModalReceipt}
            onClose={() => setPaymentModalReceipt(null)}
            onSuccess={() => loadData()}
          />
        </Modal>
      )}
    </div>
  );
};
