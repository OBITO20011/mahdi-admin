/**
 * Nawasrah Business Manager - Complete Purchasing Management Center
 * Includes Dashboard, Purchase Orders, Goods Receiving, Supplier Management, Payments, and Reports
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStore, storeEngine } from '../../stores/useAppStore';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  SupplierPayment,
  PurchaseReceipt,
} from '../../types/purchases';
import {
  fetchPurchaseOrdersFromSupabase,
  fetchSuppliersFromSupabase,
  fetchSupplierPaymentsFromSupabase,
  fetchGoodsReceiptsFromSupabase,
  toggleSupplierActiveInSupabase,
  subscribeToPurchasesRealtime,
} from '../../services/supabase/purchases.service';
import { PurchaseOrderCard } from './PurchaseOrderCard';
import { CreatePurchaseOrderModal } from './CreatePurchaseOrderModal';
import { CreateSupplierModal } from './CreateSupplierModal';
import { ReceiveGoodsModal } from './ReceiveGoodsModal';
import { SupplierPaymentModal } from './SupplierPaymentModal';
import { PurchaseOrderDetailView } from './PurchaseOrderDetailView';
import { Supplier } from '../../types';
import {
  ShoppingBag,
  Plus,
  ArrowUpRight,
  Search,
  RefreshCw,
  CheckCircle2,
  Truck,
  Building,
  CreditCard,
  BarChart3,
  Edit,
  Printer,
  PackageCheck,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

type TabType = 'orders' | 'receiving' | 'suppliers' | 'payments' | 'reports';
type PurchaseSort = 'newest' | 'highest_value' | 'outstanding';
type SupplierStatusFilter = 'all' | 'active' | 'inactive';

export const PurchasesView: React.FC = () => {
  const { warehouses } = useAppStore();

  const [activeTab, setActiveTab] = useState<TabType>('orders');

  // Main Data States
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters for Tab 1 (Orders)
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'all'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<PurchaseSort>('newest');

  // Filters for Tab 3 (Suppliers)
  const [supplierSearch, setSupplierSearch] = useState<string>('');
  const [supplierStatusFilter, setSupplierStatusFilter] = useState<SupplierStatusFilter>('all');

  // Filters for Tab 4 (Payments)
  const [paymentSearch, setPaymentSearch] = useState<string>('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [poToEdit, setPoToEdit] = useState<PurchaseOrder | null>(null);
  const [selectedPoForDetail, setSelectedPoForDetail] = useState<string | null>(null);
  const [selectedPoForReceive, setSelectedPoForReceive] = useState<PurchaseOrder | null>(null);
  const [selectedPoForPayment, setSelectedPoForPayment] = useState<PurchaseOrder | null>(null);
  const [isGeneralPaymentModalOpen, setIsGeneralPaymentModalOpen] = useState<boolean>(false);
  const [preselectedSupplierForPayment, setPreselectedSupplierForPayment] = useState<Supplier | undefined>(undefined);

  // Supplier Modal state
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState<boolean>(false);
  const [supplierToEdit, setSupplierToEdit] = useState<Supplier | null>(null);

  // Selected Voucher for printing
  const [printingVoucher, setPrintingVoucher] = useState<SupplierPayment | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [poRes, suppList, payList, rcptList] = await Promise.all([
      fetchPurchaseOrdersFromSupabase({
        search,
        status: statusFilter,
        supplierId: supplierFilter,
        warehouseId: warehouseFilter,
        sortBy,
      }),
      fetchSuppliersFromSupabase(true), // include inactive suppliers for complete view
      fetchSupplierPaymentsFromSupabase(),
      fetchGoodsReceiptsFromSupabase(),
    ]);

    if (poRes.success) {
      setOrders(poRes.data);
    }
    setSuppliers(suppList);
    setPayments(payList);
    setReceipts(rcptList);
    setLoading(false);
  }, [search, sortBy, statusFilter, supplierFilter, warehouseFilter]);

  // Reload when a query/filter changes and keep the list live for supplier activity.
  useEffect(() => {
    void loadData();
    return subscribeToPurchasesRealtime(() => {
      void loadData();
    });
  }, [loadData]);

  // Top 8 KPI Calculations
  const totalOrdersCount = orders.length;
  const draftOrdersCount = orders.filter((o) => o.status === 'draft').length;
  const sentOrdersCount = orders.filter((o) => o.status === 'sent').length;
  const approvedOrdersCount = orders.filter((o) => o.status === 'approved').length;
  const partiallyReceivedCount = orders.filter((o) => o.status === 'partially_received').length;
  const fullyReceivedCount = orders.filter((o) => o.status === 'received').length;

  const totalOutstanding = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.amountDue, 0);

  const totalPaid = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((sum, o) => sum + o.amountPaid, 0);

  // Search filter for Tab 1 (Orders)
  const filteredOrders = orders.filter((po) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (
      po.purchaseOrderNumber.toLowerCase().includes(q) ||
      po.supplierName.toLowerCase().includes(q) ||
      (po.supplierInvoiceNumber && po.supplierInvoiceNumber.toLowerCase().includes(q))
    );
  });

  // Orders waiting for receiving (Tab 2)
  const receivingOrders = orders.filter((po) =>
    ['approved', 'partially_received'].includes(po.status)
  );

  // Filtered Suppliers for Tab 3
  const filteredSuppliers = suppliers.filter((s) => {
    const q = supplierSearch.toLowerCase().trim();
    const matchesSearch =
      !q ||
      s.companyName.toLowerCase().includes(q) ||
      s.contactPerson.toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      (s.taxNumber && s.taxNumber.includes(q));

    const matchesStatus =
      supplierStatusFilter === 'all' ||
      (supplierStatusFilter === 'active' && (s.isActive ?? true)) ||
      (supplierStatusFilter === 'inactive' && !(s.isActive ?? true));

    return matchesSearch && matchesStatus;
  });

  // Calculate supplier balances from POs
  const getSupplierBalance = (supplierId: string) => {
    const pos = orders.filter((o) => o.supplierId === supplierId && o.status !== 'cancelled');
    const due = pos.reduce((sum, o) => sum + o.amountDue, 0);
    const totalPurchases = pos.reduce((sum, o) => sum + o.totalAmount, 0);
    return { due, totalPurchases, ordersCount: pos.length };
  };

  // Filtered Payments for Tab 4
  const filteredPayments = payments.filter((p) => {
    const q = paymentSearch.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.supplierName.toLowerCase().includes(q) ||
      (p.purchaseOrderNumber && p.purchaseOrderNumber.toLowerCase().includes(q)) ||
      (p.referenceNumber && p.referenceNumber.toLowerCase().includes(q)) ||
      (p.notes && p.notes.toLowerCase().includes(q));

    const matchesMethod =
      paymentMethodFilter === 'all' || p.paymentMethod === paymentMethodFilter;

    return matchesSearch && matchesMethod;
  });

  const handleToggleSupplierActive = async (supplier: Supplier) => {
    const nextActive = !(supplier.isActive ?? true);
    const res = await toggleSupplierActiveInSupabase(supplier.id, nextActive);
    if (res.success) {
      storeEngine.setToast(
        nextActive ? 'تم تفعيل المورد بنجاح' : 'تم تعطيل المورد بنجاح',
        'success'
      );
      loadData();
    } else {
      storeEngine.setToast(res.error || 'فشل تغيير حالة المورد', 'error');
    }
  };

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
              <span>مركز إدارة المشتريات والموردين</span>
              <span className="text-[10px] bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                نظام بالجملة والتوريد
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">
              إدارة طلبات الشراء، توريد البضاعة للمخازن، حسابات الموردين، سندات الصرف والتقارير
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSupplierToEdit(null);
              setIsSupplierModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-teal-600/20 text-teal-300 border border-teal-500/30 hover:bg-teal-600/30 px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <Building className="w-4 h-4" />
            <span>مورد جديد</span>
          </button>

          <button
            onClick={() => {
              setPreselectedSupplierForPayment(undefined);
              setSelectedPoForPayment(null);
              setIsGeneralPaymentModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>سند صرف جديد</span>
          </button>

          <button
            onClick={() => {
              setPoToEdit(null);
              setIsCreateModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition shadow-lg active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>أمر شراء جديد</span>
          </button>
        </div>
      </div>

      {/* Main Top 8 KPI Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {/* 1. Total POs */}
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-sm text-center space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">إجمالي الأوامر</span>
          <span className="text-sm font-black text-slate-100 block">{totalOrdersCount} أمر</span>
        </div>

        {/* 2. Draft */}
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-sm text-center space-y-1">
          <span className="text-[10px] text-slate-400 block font-medium">مسودة</span>
          <span className="text-sm font-black text-slate-300 block">{draftOrdersCount}</span>
        </div>

        {/* 3. Sent */}
        <div className="bg-slate-900 border border-blue-500/20 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-blue-950/10">
          <span className="text-[10px] text-blue-400 block font-medium">مرسل للمورد</span>
          <span className="text-sm font-black text-blue-300 block">{sentOrdersCount}</span>
        </div>

        {/* 4. Approved */}
        <div className="bg-slate-900 border border-amber-500/20 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-amber-950/10">
          <span className="text-[10px] text-amber-400 block font-medium">معتمد</span>
          <span className="text-sm font-black text-amber-300 block">{approvedOrdersCount}</span>
        </div>

        {/* 5. Partially Received */}
        <div className="bg-slate-900 border border-indigo-500/20 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-indigo-950/10">
          <span className="text-[10px] text-indigo-400 block font-medium">مستلم جزئياً</span>
          <span className="text-sm font-black text-indigo-300 block">{partiallyReceivedCount}</span>
        </div>

        {/* 6. Fully Received */}
        <div className="bg-slate-900 border border-emerald-500/20 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-emerald-950/10">
          <span className="text-[10px] text-emerald-400 block font-medium">مستلم بالكامل</span>
          <span className="text-sm font-black text-emerald-300 block">{fullyReceivedCount}</span>
        </div>

        {/* 7. Outstanding Balance */}
        <div className="bg-slate-900 border border-rose-500/30 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-rose-950/20">
          <span className="text-[10px] text-rose-400 block font-medium">المستحق للموردين</span>
          <span className="text-xs font-black text-rose-300 block font-mono">
            {totalOutstanding.toFixed(2)} {CURRENCY}
          </span>
        </div>

        {/* 8. Paid Amount */}
        <div className="bg-slate-900 border border-emerald-500/30 p-3 rounded-2xl shadow-sm text-center space-y-1 bg-emerald-950/20">
          <span className="text-[10px] text-emerald-400 block font-medium">إجمالي المسدد</span>
          <span className="text-xs font-black text-emerald-300 block font-mono">
            {totalPaid.toFixed(2)} {CURRENCY}
          </span>
        </div>
      </div>

      {/* Main Module Tabs Switcher */}
      <div className="flex items-center gap-1.5 bg-slate-900 p-1.5 rounded-2xl border border-slate-800 text-xs font-bold overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'orders'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>1. أوامر الشراء ({orders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('receiving')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'receiving'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>2. استلام البضائع ({receivingOrders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('suppliers')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'suppliers'
              ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>3. الموردين ({suppliers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('payments')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'payments'
              ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>4. سندات الصرف والمدفوعات ({payments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'reports'
              ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>5. تقارير المشتريات</span>
        </button>
      </div>

      {/* TAB 1: Purchase Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {/* Filters Toolbar */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-3">
            {/* Search and Dropdowns */}
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search input */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث برقم أمر الشراء، المورد، رقم فاتورة المورد..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              {/* Supplier Filter */}
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="w-full md:w-48 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="all">جميع الموردين ({suppliers.length})</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                  </option>
                ))}
              </select>

              {/* Warehouse Filter */}
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="w-full md:w-48 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="all">جميع المخازن</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as PurchaseSort)}
                className="w-full md:w-44 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 font-bold"
              >
                <option value="newest">الأحدث أولاً</option>
                <option value="highest_value">الأعلى قيمة</option>
              </select>

              {/* Refresh Button */}
              <button
                onClick={loadData}
                disabled={loading}
                className="w-full md:w-auto bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-3 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-bold pt-1 border-t border-slate-800/80">
              <span className="text-slate-500 text-[10px] shrink-0 font-medium">الحالة:</span>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'all'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                الكل
              </button>
              <button
                onClick={() => setStatusFilter('draft')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'draft'
                    ? 'bg-slate-700 text-white border-slate-600'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                مسودة
              </button>
              <button
                onClick={() => setStatusFilter('sent')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'sent'
                    ? 'bg-blue-600 text-white border-blue-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                مرسل للمورد
              </button>
              <button
                onClick={() => setStatusFilter('approved')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'approved'
                    ? 'bg-amber-600 text-white border-amber-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                معتمد قيد التوريد
              </button>
              <button
                onClick={() => setStatusFilter('partially_received')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'partially_received'
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                مستلم جزئياً
              </button>
              <button
                onClick={() => setStatusFilter('received')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'received'
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                مستلم بالكامل
              </button>
              <button
                onClick={() => setStatusFilter('cancelled')}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'cancelled'
                    ? 'bg-rose-600 text-white border-rose-500'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                ملغى
              </button>
            </div>
          </div>

          {/* Orders Grid */}
          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-slate-900/50 rounded-3xl border border-slate-800">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
              <span className="font-bold">جاري تحميل أوامر الشراء...</span>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3">
              <ShoppingBag className="w-12 h-12 mx-auto text-slate-600" />
              <h3 className="font-bold text-slate-200 text-sm">لا توجد أوامر شراء مطابقة للبحث</h3>
              <p className="text-slate-400 max-w-md mx-auto">
                قم بإنشاء أمر شراء جديد للمورد أو تعديل معايير البحث والفلترة.
              </p>
              <button
                onClick={() => {
                  setPoToEdit(null);
                  setIsCreateModalOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl font-bold transition shadow-lg inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>إنشاء أمر شراء جديد</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOrders.map((po) => (
                <PurchaseOrderCard
                  key={po.id}
                  po={po}
                  onViewDetails={() => setSelectedPoForDetail(po.id)}
                  onReceiveGoods={() => setSelectedPoForReceive(po)}
                  onRecordPayment={() => setSelectedPoForPayment(po)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Goods Receiving */}
      {activeTab === 'receiving' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-2">
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Truck className="w-4 h-4 text-purple-400" />
              <span>طلبات بانتظار توريد البضاعة للمخزن</span>
            </h2>
            <p className="text-slate-400 text-xs">
              جميع أوامر الشراء المعتمدة والمستلمة جزئياً الجاهزة لإدخال كميات الاستلام الفعلية للمخازن.
            </p>
          </div>

          {receivingOrders.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-2 text-slate-400">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
              <h3 className="font-bold text-slate-200">جميع طلبيات الشراء تم استلامها بالكامل!</h3>
              <p>لا توجد طلبيات شراء معلقة قيد التوريد في الوقت الحالي.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {receivingOrders.map((po) => {
                const totalOrderedQty = po.items.reduce((sum, i) => sum + i.orderedQuantity, 0);
                const totalReceivedQty = po.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
                const remainingQty = totalOrderedQty - totalReceivedQty;
                const percentage =
                  totalOrderedQty > 0 ? Math.round((totalReceivedQty / totalOrderedQty) * 100) : 0;

                return (
                  <div
                    key={po.id}
                    className="bg-slate-900 border border-purple-500/30 rounded-2xl p-4 shadow-lg space-y-3 relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                          <span>{po.purchaseOrderNumber}</span>
                          <span className="text-[10px] bg-purple-600/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-sans">
                            {po.status === 'approved' ? 'معتمد' : 'مستلم جزئياً'}
                          </span>
                        </h3>
                        <p className="text-slate-400 text-[11px] mt-0.5 flex items-center gap-2">
                          <span className="font-bold text-teal-400">{po.supplierName}</span>
                          <span>•</span>
                          <span>مخزن: {po.warehouseName || 'المخزن الرئيسي'}</span>
                        </p>
                      </div>

                      <button
                        onClick={() => setSelectedPoForReceive(po)}
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 shadow-lg transition active:scale-95"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام البضائع</span>
                      </button>
                    </div>

                    {/* Progress Bar */}
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-medium">تقدم التوريد:</span>
                        <span className="font-bold text-slate-200">
                          {totalReceivedQty} من {totalOrderedQty} قطعة ({percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 pt-1 font-mono">
                        <span>المتبقي: {remainingQty} قطعة</span>
                        <span>تاريخ الطلب: {new Date(po.orderDate).toLocaleDateString('ar-JO')}</span>
                      </div>
                    </div>

                    {/* Items preview list */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-bold text-slate-400 block">
                        أبرز أصناف الطلبية:
                      </span>
                      <div className="space-y-1">
                        {po.items.slice(0, 3).map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px]"
                          >
                            <span className="font-medium text-slate-200 truncate max-w-[200px]">
                              {item.productName}
                            </span>
                            <span className="font-bold text-purple-300 font-mono">
                              مستلم {item.receivedQuantity} / {item.orderedQuantity} {item.unit}
                            </span>
                          </div>
                        ))}
                        {po.items.length > 3 && (
                          <div className="text-[10px] text-slate-500 text-center font-bold">
                            + {po.items.length - 3} أصناف أخرى...
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Receiving History Section */}
          <div className="pt-6 space-y-3">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-emerald-400" />
                  <span>سجل عمليات سندات استلام البضائع الأخيرة</span>
                </h3>
                <p className="text-slate-400 text-[11px]">
                  سجل تفصيلي لجميع السندات التي تم إدخال بضائعها في المخازن ومستودعات الشركة.
                </p>
              </div>
            </div>

            {receipts.length === 0 ? (
              <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-2xl text-slate-500">
                لا توجد عمليات استلام بضائع سابقة في السجل.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 shadow">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-800/80 text-slate-300 font-bold border-b border-slate-700/80">
                      <tr>
                        <th className="p-3">رقم سند الاستلام</th>
                        <th className="p-3">المورد</th>
                        <th className="p-3">المخزن المستلم</th>
                        <th className="p-3">ملاحظات والتسليم</th>
                        <th className="p-3 text-center">تاريخ الاستلام</th>
                        <th className="p-3 text-center">المستلم بواسطة</th>
                        <th className="p-3 text-center">عدد الأصناف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {receipts.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-800/40 transition">
                          <td className="p-3 font-bold text-purple-300 font-mono">
                            {r.receiptNumber}
                          </td>
                          <td className="p-3 font-bold text-slate-100">{r.supplierName}</td>
                          <td className="p-3 text-slate-300">{r.warehouseName}</td>
                          <td className="p-3 text-slate-400 max-w-xs truncate">
                            {r.supplierDeliveryNote
                              ? `إشعارات التوريد: ${r.supplierDeliveryNote}`
                              : r.notes || '-'}
                          </td>
                          <td className="p-3 text-center font-mono text-slate-300">
                            {new Date(r.receivedAt).toLocaleDateString('ar-JO')}
                          </td>
                          <td className="p-3 text-center text-slate-300">{r.receivedBy}</td>
                          <td className="p-3 text-center font-bold text-emerald-400">
                            {r.items.length} أصناف
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Supplier Management */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          {/* Top Suppliers Toolbar */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-3">
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search Supplier */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-slate-500" />
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="بحث باسم الشركة، المورد، الهاتـف، الرقم الضريبي..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500 font-medium"
                />
              </div>

              {/* Filter Active status */}
              <select
                value={supplierStatusFilter}
                onChange={(e) => setSupplierStatusFilter(e.target.value as SupplierStatusFilter)}
                className="w-full md:w-48 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-teal-500 font-bold"
              >
                <option value="all">جميع الحالات</option>
                <option value="active">الموردين النشطين فقط</option>
                <option value="inactive">الموردين المعطلين</option>
              </select>

              {/* Add New Supplier button */}
              <button
                onClick={() => {
                  setSupplierToEdit(null);
                  setIsSupplierModalOpen(true);
                }}
                className="w-full md:w-auto bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة مورد جديد</span>
              </button>
            </div>
          </div>

          {/* Suppliers Table/Grid */}
          {filteredSuppliers.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3 text-slate-400">
              <Building className="w-12 h-12 mx-auto text-slate-600" />
              <h3 className="font-bold text-slate-200">لا يوجد موردين مطبقين لهذا البحث</h3>
              <button
                onClick={() => {
                  setSupplierToEdit(null);
                  setIsSupplierModalOpen(true);
                }}
                className="bg-teal-600 text-white px-4 py-2 rounded-xl font-bold transition inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة أول مورد</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSuppliers.map((supp) => {
                const { due, totalPurchases, ordersCount } = getSupplierBalance(supp.id);
                const isActive = supp.isActive ?? true;

                return (
                  <div
                    key={supp.id}
                    className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 shadow-lg space-y-3 relative overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                          <Building className="w-4 h-4 text-teal-400 shrink-0" />
                          <span>{supp.companyName}</span>
                        </h3>
                        {supp.contactPerson && (
                          <p className="text-slate-400 text-[11px] mt-0.5">
                            المسؤول: <span className="text-slate-200 font-semibold">{supp.contactPerson}</span>
                          </p>
                        )}
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isActive
                            ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {isActive ? 'نشط' : 'معطل'}
                      </span>
                    </div>

                    {/* Contact details */}
                    <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1 text-[11px] text-slate-300">
                      {supp.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3 h-3 text-slate-500" />
                          <span className="font-mono">{supp.phone}</span>
                          {supp.whatsapp && (
                            <a
                              href={`https://wa.me/${supp.whatsapp.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-400 hover:underline mr-2 text-[10px]"
                            >
                              واتساب
                            </a>
                          )}
                        </div>
                      )}
                      {supp.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3 text-slate-500" />
                          <span className="font-mono truncate">{supp.email}</span>
                        </div>
                      )}
                      {supp.address && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          <span>{supp.address}</span>
                        </div>
                      )}
                      {supp.taxNumber && (
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 pt-0.5">
                          <span>الرقم الضريبي: {supp.taxNumber}</span>
                        </div>
                      )}
                    </div>

                    {/* Balances */}
                    <div className="grid grid-cols-2 gap-2 text-center text-xs">
                      <div className="bg-slate-800/40 p-2 rounded-xl border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">إجمالي المشتريات:</span>
                        <span className="font-bold text-slate-200 font-mono">
                          {totalPurchases.toFixed(2)} {CURRENCY}
                        </span>
                        <span className="text-[9px] text-slate-500 block">({ordersCount} طلبيات)</span>
                      </div>

                      <div className="bg-rose-950/20 p-2 rounded-xl border border-rose-500/20">
                        <span className="text-[10px] text-rose-400 block">المستحق للمورد:</span>
                        <span className="font-bold text-rose-300 font-mono">
                          {due.toFixed(2)} {CURRENCY}
                        </span>
                      </div>
                    </div>

                    {/* Actions toolbar */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSupplierToEdit(supp);
                            setIsSupplierModalOpen(true);
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition"
                        >
                          <Edit className="w-3 h-3 text-amber-400" />
                          <span>تعديل</span>
                        </button>

                        <button
                          onClick={() => handleToggleSupplierActive(supp)}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded-lg font-medium transition"
                        >
                          {isActive ? 'تعطيل' : 'تفعيل'}
                        </button>
                      </div>

                      {due > 0 && (
                        <button
                          onClick={() => {
                            setPreselectedSupplierForPayment(supp);
                            setSelectedPoForPayment(null);
                            setIsGeneralPaymentModalOpen(true);
                          }}
                          className="bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 px-3 py-1 rounded-lg font-bold flex items-center gap-1 transition"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          <span>تسديد دفعة</span>
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

      {/* TAB 4: Supplier Payments / Vouchers */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          {/* Payment Toolbar */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-3">
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-slate-500" />
                <input
                  type="text"
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                  placeholder="بحث باسم المورد، مرجع الشيك/التحويل، رقم أمر الشراء..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 font-medium"
                />
              </div>

              {/* Payment Method filter */}
              <select
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value)}
                className="w-full md:w-48 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-rose-500 font-bold"
              >
                <option value="all">جميع وسائل الدفع</option>
                <option value="cash">نقداً</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cliq">كليك CliQ</option>
                <option value="card">بطاقة ائتمان</option>
                <option value="check">شيك مصرفي</option>
              </select>

              {/* Record New Payment */}
              <button
                onClick={() => {
                  setPreselectedSupplierForPayment(undefined);
                  setSelectedPoForPayment(null);
                  setIsGeneralPaymentModalOpen(true);
                }}
                className="w-full md:w-auto bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>إصدار سند صرف جديد</span>
              </button>
            </div>
          </div>

          {/* Payments Table */}
          {filteredPayments.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-3xl space-y-3 text-slate-400">
              <CreditCard className="w-12 h-12 mx-auto text-slate-600" />
              <h3 className="font-bold text-slate-200">لا توجد سندات صرف مطابقة للبحث</h3>
              <button
                onClick={() => {
                  setPreselectedSupplierForPayment(undefined);
                  setSelectedPoForPayment(null);
                  setIsGeneralPaymentModalOpen(true);
                }}
                className="bg-rose-600 text-white px-4 py-2 rounded-xl font-bold transition inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>إصدار أول سند صرف</span>
              </button>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-800/80 text-slate-300 font-bold border-b border-slate-700/80">
                    <tr>
                      <th className="p-3">تاريخ السند</th>
                      <th className="p-3">اسم المورد</th>
                      <th className="p-3">أمر الشراء المرتبط</th>
                      <th className="p-3 text-center">المبلغ المصروف ({CURRENCY})</th>
                      <th className="p-3 text-center">طريقة الدفع</th>
                      <th className="p-3">المرجع / الملاحظات</th>
                      <th className="p-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredPayments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-3 font-mono text-slate-300">
                          {new Date(p.paymentDate).toLocaleDateString('ar-JO')}
                        </td>
                        <td className="p-3 font-bold text-slate-100">{p.supplierName}</td>
                        <td className="p-3 text-blue-400 font-mono font-bold">
                          {p.purchaseOrderNumber ? `#${p.purchaseOrderNumber}` : 'سند غير مرتبط بأمر'}
                        </td>
                        <td className="p-3 text-center font-black text-rose-300 font-mono text-sm">
                          {p.amount.toFixed(2)} {CURRENCY}
                        </td>
                        <td className="p-3 text-center">
                          <span className="bg-slate-800 text-slate-300 border border-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                            {p.paymentMethod === 'cash'
                              ? 'نقداً'
                              : p.paymentMethod === 'bank_transfer'
                              ? 'تحويل بنكي'
                              : p.paymentMethod === 'cliq'
                              ? 'كليك'
                              : p.paymentMethod === 'check'
                              ? 'شيك'
                              : p.paymentMethod}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 max-w-xs truncate">
                          {p.referenceNumber && (
                            <span className="font-mono text-slate-300 ml-2 font-bold">
                              مرجع: {p.referenceNumber}
                            </span>
                          )}
                          {p.notes || '-'}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => setPrintingVoucher(p)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1 rounded-lg font-bold flex items-center gap-1 mx-auto transition"
                          >
                            <Printer className="w-3.5 h-3.5 text-blue-400" />
                            <span>طباعة السند</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: Purchase Reports */}
      {activeTab === 'reports' && (
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow space-y-1">
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              <span>تقارير وتحليلات المشتريات والتوريد</span>
            </h2>
            <p className="text-slate-400 text-xs">
              ملخص تحليلي شامل لمشتريات الشركة حسب الموردين، المستحقات القائمة، والمنتجات الأكثر استلاماً.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Report 1: Top Suppliers by Purchases */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow space-y-3">
              <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2 pb-2 border-b border-slate-800">
                <Building className="w-4 h-4 text-teal-400" />
                <span>المشتريات والذمم حسب المورد</span>
              </h3>

              <div className="space-y-2">
                {suppliers.slice(0, 5).map((supp) => {
                  const { due, totalPurchases } = getSupplierBalance(supp.id);
                  return (
                    <div
                      key={supp.id}
                      className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-slate-200 block">{supp.companyName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          مشتريات: {totalPurchases.toFixed(2)} {CURRENCY}
                        </span>
                      </div>
                      <div className="text-left">
                        <span className="text-[10px] text-slate-400 block">المتبقي:</span>
                        <span className="font-bold text-rose-400 font-mono">
                          {due.toFixed(2)} {CURRENCY}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Report 2: Order Fulfillment & Delivery Ratios */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow space-y-3">
              <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2 pb-2 border-b border-slate-800">
                <Truck className="w-4 h-4 text-purple-400" />
                <span>مؤشرات انجاز واستلام طلبات الشراء</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex justify-between text-slate-300">
                    <span>نسبة الطلبات المكتملة بالكامل:</span>
                    <span className="font-bold text-emerald-400">
                      {totalOrdersCount > 0
                        ? Math.round((fullyReceivedCount / totalOrdersCount) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{
                        width: `${
                          totalOrdersCount > 0 ? (fullyReceivedCount / totalOrdersCount) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                  <div className="flex justify-between text-slate-300">
                    <span>نسبة الطلبات قيد الاستلام والتوريد:</span>
                    <span className="font-bold text-purple-400">
                      {totalOrdersCount > 0
                        ? Math.round(
                            ((approvedOrdersCount + partiallyReceivedCount) / totalOrdersCount) * 100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500"
                      style={{
                        width: `${
                          totalOrdersCount > 0
                            ? ((approvedOrdersCount + partiallyReceivedCount) / totalOrdersCount) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                  <span className="text-slate-400">متوسط قيمة أمر الشراء:</span>
                  <span className="font-bold text-slate-100 font-mono">
                    {totalOrdersCount > 0
                      ? (
                          orders
                            .filter((o) => o.status !== 'cancelled')
                            .reduce((sum, o) => sum + o.totalAmount, 0) / (totalOrdersCount || 1)
                        ).toFixed(2)
                      : '0.00'}{' '}
                    {CURRENCY}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}

      {/* 1. Create / Edit Purchase Order Modal */}
      {isCreateModalOpen && (
        <CreatePurchaseOrderModal
          isOpen={isCreateModalOpen}
          poToEdit={poToEdit}
          onClose={() => {
            setIsCreateModalOpen(false);
            setPoToEdit(null);
          }}
          onSuccess={(poId) => {
            loadData();
            if (poId) setSelectedPoForDetail(poId);
          }}
        />
      )}

      {/* 2. Create / Edit Supplier Modal */}
      {isSupplierModalOpen && (
        <CreateSupplierModal
          isOpen={isSupplierModalOpen}
          supplierToEdit={supplierToEdit}
          onClose={() => {
            setIsSupplierModalOpen(false);
            setSupplierToEdit(null);
          }}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* 3. Receive Goods Modal */}
      {selectedPoForReceive && (
        <ReceiveGoodsModal
          po={selectedPoForReceive}
          onClose={() => setSelectedPoForReceive(null)}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* 4. Supplier Payment Modal (Linked to PO or General) */}
      {(selectedPoForPayment || isGeneralPaymentModalOpen) && (
        <SupplierPaymentModal
          po={selectedPoForPayment}
          preselectedSupplier={preselectedSupplierForPayment}
          onClose={() => {
            setSelectedPoForPayment(null);
            setIsGeneralPaymentModalOpen(false);
            setPreselectedSupplierForPayment(undefined);
          }}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* 5. PO Detail Drawer View */}
      {selectedPoForDetail && (
        <PurchaseOrderDetailView
          poId={selectedPoForDetail}
          onClose={() => setSelectedPoForDetail(null)}
          onRefresh={loadData}
        />
      )}

      {/* 6. Printable Voucher Modal */}
      {printingVoucher && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-white text-slate-900 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="text-center border-b pb-3 border-slate-200">
              <h2 className="text-base font-black">شركة النواصرة للتجارة والجملة</h2>
              <p className="text-xs text-slate-500">سند صرف للمورد - Supplier Payment Voucher</p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between font-mono">
                <span>تاريخ السند: {new Date(printingVoucher.paymentDate).toLocaleDateString('ar-JO')}</span>
                <span>طريقة الدفع: {printingVoucher.paymentMethod}</span>
              </div>
              <div className="bg-slate-100 p-3 rounded-xl border border-slate-200 space-y-1">
                <p>
                  <strong>صرفنا إلى السيد/السادة:</strong> {printingVoucher.supplierName}
                </p>
                <p>
                  <strong>مبلغ وقدره:</strong>{' '}
                  <span className="text-base font-black text-rose-600 font-mono">
                    {printingVoucher.amount.toFixed(2)} {CURRENCY}
                  </span>
                </p>
                {printingVoucher.purchaseOrderNumber && (
                  <p>
                    <strong>عن أمر الشراء رقم:</strong> #{printingVoucher.purchaseOrderNumber}
                  </p>
                )}
                {printingVoucher.referenceNumber && (
                  <p>
                    <strong>رقم المرجع / الشيك:</strong> {printingVoucher.referenceNumber}
                  </p>
                )}
                {printingVoucher.notes && (
                  <p>
                    <strong>البيان / الملاحظات:</strong> {printingVoucher.notes}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between text-xs border-t border-slate-200">
              <div>توقيع المستلم: ____________</div>
              <div>توقيع المحاسب: ____________</div>
            </div>

            <div className="pt-2 flex justify-end gap-2 print:hidden">
              <button
                onClick={() => setPrintingVoucher(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 font-bold"
              >
                إغلاق
              </button>
              <button
                onClick={() => window.print()}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white font-bold flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة السند</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
