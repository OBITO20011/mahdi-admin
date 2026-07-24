/**
 * Nawasrah Business Manager - Wholesale Purchase Orders & Goods Receiving View
 */

import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  PurchaseOrder,
  PurchaseOrderFilters,
  PurchaseOrderStatus,
} from '../../types/purchases';
import {
  fetchPurchaseOrdersFromSupabase,
  fetchSuppliersFromSupabase,
  subscribeToPurchasesRealtime,
} from '../../services/supabase/purchases.service';
import { PurchaseOrderCard } from './PurchaseOrderCard';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';
import { ReceiveGoodsModal } from './ReceiveGoodsModal';
import { SupplierPaymentModal } from './SupplierPaymentModal';
import { PurchaseOrderDetailView } from './PurchaseOrderDetailView';
import { Supplier } from '../../types';
import {
  ShoppingBag,
  Plus,
  ArrowUpRight,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Truck,
  Building,
  Warehouse,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const PurchasesView: React.FC = () => {
  const { warehouses, branches } = useAppStore();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'highest_value' | 'outstanding'>('newest');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedPoForDetail, setSelectedPoForDetail] = useState<string | null>(null);
  const [selectedPoForReceive, setSelectedPoForReceive] = useState<PurchaseOrder | null>(null);
  const [selectedPoForPayment, setSelectedPoForPayment] = useState<PurchaseOrder | null>(null);
  const [isGeneralPaymentModalOpen, setIsGeneralPaymentModalOpen] = useState<boolean>(false);

  // Load orders & suppliers
  useEffect(() => {
    loadData();

    // Subscribe to Realtime updates
    const unsubscribe = subscribeToPurchasesRealtime(() => {
      loadData();
    });

    return () => {
      unsubscribe();
    };
  }, [statusFilter, supplierFilter, warehouseFilter, sortBy]);

  const loadData = async () => {
    setLoading(true);
    const [poRes, suppList] = await Promise.all([
      fetchPurchaseOrdersFromSupabase({
        search,
        status: statusFilter,
        supplierId: supplierFilter,
        warehouseId: warehouseFilter,
        sortBy,
      }),
      fetchSuppliersFromSupabase(),
    ]);

    if (poRes.success) {
      setOrders(poRes.data);
    }
    setSuppliers(suppList);
    setLoading(false);
  };

  // KPIs Calculations
  const totalOrdersCount = orders.length;
  const totalNetValue = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  const openOrders = orders.filter((o) =>
    ['draft', 'sent', 'approved', 'partially_received'].includes(o.status)
  );
  const openOrdersCount = openOrders.length;
  const openOrdersValue = openOrders.reduce((sum, o) => sum + o.totalAmount, 0);

  const totalOutstanding = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.amountDue, 0);

  const totalPaid = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.amountPaid, 0);

  // Search filter
  const filteredOrders = orders.filter((po) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (
      po.purchaseOrderNumber.toLowerCase().includes(q) ||
      po.supplierName.toLowerCase().includes(q) ||
      (po.supplierInvoiceNumber && po.supplierInvoiceNumber.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-3 sm:p-5 space-y-5 pb-28 text-xs">
      {/* Module Title & Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-3xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 border border-blue-400/30 flex items-center justify-center text-white shadow-lg">
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-100 flex items-center gap-2">
              <span>إدارة المشتريات واستلام البضائع</span>
              <span className="text-[10px] bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                نظام بالجملة
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              أوامر الشراء، توريد البضائع للمخازن، متطلبات الموردين وسندات الصرف
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsGeneralPaymentModalOpen(true)}
            className="flex-1 sm:flex-initial bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>سند صرف جديد</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex-1 sm:flex-initial bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition shadow-lg active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>طلب شراء جديد</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Total Orders */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold">إجمالي طلبات الشراء:</span>
            <ShoppingBag className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-black text-slate-100">{totalOrdersCount} طلب</span>
            <span className="text-xs font-mono text-slate-300">
              {totalNetValue.toFixed(2)} {CURRENCY}
            </span>
          </div>
        </div>

        {/* KPI 2: Open Awaiting Receiving */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold">طلبات مفتوحة قيد التوريد:</span>
            <Truck className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-black text-purple-300">{openOrdersCount} طلب</span>
            <span className="text-xs font-mono text-purple-400">
              {openOrdersValue.toFixed(2)} {CURRENCY}
            </span>
          </div>
        </div>

        {/* KPI 3: Supplier Outstanding */}
        <div className="bg-slate-900 border border-amber-500/20 p-4 rounded-2xl shadow space-y-1 bg-amber-950/10">
          <div className="flex items-center justify-between text-amber-400">
            <span className="text-[11px] font-bold">مستحقات الموردين القائمة:</span>
            <AlertCircle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-black text-amber-300">
              {totalOutstanding.toFixed(2)} {CURRENCY}
            </span>
            <span className="text-[10px] text-amber-400 font-medium">ذمم غير مسددة</span>
          </div>
        </div>

        {/* KPI 4: Total Paid */}
        <div className="bg-slate-900 border border-emerald-500/20 p-4 rounded-2xl shadow space-y-1 bg-emerald-950/10">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="text-[11px] font-bold">إجمالي المدفوعات المسددة:</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-black text-emerald-300">
              {totalPaid.toFixed(2)} {CURRENCY}
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">سندات صرف</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar & Status Pills */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-3">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-bold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'all'
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            الكل
          </button>
          <button
            onClick={() => setStatusFilter('draft')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'draft'
                ? 'bg-slate-700 text-white border-slate-600'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            مسودة
          </button>
          <button
            onClick={() => setStatusFilter('sent')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'sent'
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            مرسل للمورد
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'approved'
                ? 'bg-amber-600 text-white border-amber-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            معتمد قيد التوريد
          </button>
          <button
            onClick={() => setStatusFilter('partially_received')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'partially_received'
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            مستلم جزئياً
          </button>
          <button
            onClick={() => setStatusFilter('received')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'received'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            مستلم بالكامل
          </button>
          <button
            onClick={() => setStatusFilter('cancelled')}
            className={`px-3 py-1.5 rounded-xl border shrink-0 transition ${
              statusFilter === 'cancelled'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            ملغى
          </button>
        </div>

        {/* Inputs & Dropdowns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          {/* Search Input */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم طلب الشراء، اسم المورد، أو رقم الفاتورة..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Supplier Dropdown */}
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
          >
            <option value="all">جميع الموردين</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </select>

          {/* Warehouse Dropdown */}
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
          >
            <option value="all">جميع المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders List Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-400" />
          <span>جاري تحميل طلبات الشراء والمستحقات...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
          <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-300">لا توجد طلبات شراء مطابقة للفلتر المحدد</h3>
          <p className="text-slate-500">يمكنك إنشاء طلب شراء جديد أو تغيير خيارات البحث والتصفية.</p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl font-bold transition inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء طلب شراء الآن</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredOrders.map((po) => (
            <PurchaseOrderCard
              key={po.id}
              po={po}
              onViewDetails={(selected) => setSelectedPoForDetail(selected.id)}
              onReceiveGoods={(selected) => setSelectedPoForReceive(selected)}
              onRecordPayment={(selected) => setSelectedPoForPayment(selected)}
            />
          ))}
        </div>
      )}

      {/* MODALS */}
      {/* 1. Create Purchase Order Modal */}
      <CreatePurchaseOrderModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(poId) => {
          loadData();
          setSelectedPoForDetail(poId);
        }}
      />

      {/* 2. Detail View Drawer/Sheet */}
      {selectedPoForDetail && (
        <PurchaseOrderDetailView
          poId={selectedPoForDetail}
          onClose={() => setSelectedPoForDetail(null)}
          onRefresh={loadData}
        />
      )}

      {/* 3. Receive Goods Modal */}
      {selectedPoForReceive && (
        <ReceiveGoodsModal
          isOpen={!!selectedPoForReceive}
          po={selectedPoForReceive}
          onClose={() => setSelectedPoForReceive(null)}
          onSuccess={loadData}
        />
      )}

      {/* 4. Payment Modal for specific PO */}
      {selectedPoForPayment && (
        <SupplierPaymentModal
          isOpen={!!selectedPoForPayment}
          po={selectedPoForPayment}
          onClose={() => setSelectedPoForPayment(null)}
          onSuccess={loadData}
        />
      )}

      {/* 5. General Payment Voucher Modal */}
      <SupplierPaymentModal
        isOpen={isGeneralPaymentModalOpen}
        onClose={() => setIsGeneralPaymentModalOpen(false)}
        onSuccess={loadData}
      />
    </div>
  );
};
