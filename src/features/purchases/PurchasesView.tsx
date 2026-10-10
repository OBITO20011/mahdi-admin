import {FormFields, UiButton, Card, formatJod, formatUiDate, DataTable, Tr, Th, Td} from '../../components/ui';
/**
 * Nawasrah Business Manager - Complete Purchasing Management Center
 * Includes Dashboard, Purchase Orders, Goods Receiving, Supplier Management, Payments, and Reports
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useAppStoreSelector, storeEngine } from '../../stores/useAppStore';
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
  ChevronLeft,
  ChevronRight,
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

const HistoryPagination: React.FC<{
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}> = ({ page, totalPages, totalCount, onPageChange }) => {
  if (totalCount === 0) return null;

  return (
    <FormFields className="nw-purchasing-fields flex items-center justify-between gap-3 pt-3 text-xs text-nw-muted">
      <span>إجمالي السجلات: {totalCount}</span>
      <div className="flex items-center gap-2">
        <UiButton variant="plain"
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="الصفحة السابقة"
          className="rounded-lg border border-nw-border p-1.5 text-nw-text transition hover:bg-nw-surface-2 disabled:cursor-not-allowed disabled:opacity-40 h-auto min-h-11 min-w-0 whitespace-normal"
        >
          <ChevronRight className="h-4 w-4" />
        </UiButton>
        <span className="font-mono text-nw-text">{page} / {totalPages}</span>
        <UiButton variant="plain"
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="الصفحة التالية"
          className="rounded-lg border border-nw-border p-1.5 text-nw-text transition hover:bg-nw-surface-2 disabled:cursor-not-allowed disabled:opacity-40 h-auto min-h-11 min-w-0 whitespace-normal"
        >
          <ChevronLeft className="h-4 w-4" />
        </UiButton>
      </div>
    </FormFields>
  );
};

export const PurchasesView: React.FC = () => {
  const warehouses = useAppStoreSelector((state) => state.warehouses);

  const [activeTab, setActiveTab] = useState<TabType>('orders');

  // Main Data States
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalCount, setOrdersTotalCount] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersSummary, setOrdersSummary] = useState({
    draftCount: 0,
    sentCount: 0,
    approvedCount: 0,
    partiallyReceivedCount: 0,
    receivedCount: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalOutstanding: 0,
  });
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsTotalCount, setPaymentsTotalCount] = useState(0);
  const [paymentsTotalPages, setPaymentsTotalPages] = useState(1);
  const [receiptsPage, setReceiptsPage] = useState(1);
  const [receiptsTotalCount, setReceiptsTotalCount] = useState(0);
  const [receiptsTotalPages, setReceiptsTotalPages] = useState(1);

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
        page: ordersPage,
        pageSize: 25,
        search,
        status: statusFilter,
        supplierId: supplierFilter,
        warehouseId: warehouseFilter,
        sortBy,
      }),
      fetchSuppliersFromSupabase(true), // include inactive suppliers for complete view
      fetchSupplierPaymentsFromSupabase({
        page: paymentsPage,
        pageSize: 25,
        search: paymentSearch,
        paymentMethod: paymentMethodFilter,
      }),
      fetchGoodsReceiptsFromSupabase({ page: receiptsPage, pageSize: 25 }),
    ]);

    if (poRes.success) {
      setOrders(poRes.data);
      setOrdersTotalCount(poRes.totalCount);
      setOrdersTotalPages(poRes.totalPages);
      setOrdersSummary(poRes.summary);
    }
    setSuppliers(suppList);
    if (payList.success) {
      setPayments(payList.data);
      setPaymentsTotalCount(payList.totalCount);
      setPaymentsTotalPages(payList.totalPages);
    }
    if (rcptList.success) {
      setReceipts(rcptList.data);
      setReceiptsTotalCount(rcptList.totalCount);
      setReceiptsTotalPages(rcptList.totalPages);
    }
    setLoading(false);
  }, [ordersPage, paymentsPage, paymentMethodFilter, paymentSearch, receiptsPage, search, sortBy, statusFilter, supplierFilter, warehouseFilter]);

  // Reload when a query/filter changes and keep the list live for supplier activity.
  useEffect(() => {
    void loadData();
    return subscribeToPurchasesRealtime(() => {
      void loadData();
    });
  }, [loadData]);

  // Top 8 KPI Calculations
  const totalOrdersCount = ordersTotalCount;
  const draftOrdersCount = ordersSummary.draftCount;
  const sentOrdersCount = ordersSummary.sentCount;
  const approvedOrdersCount = ordersSummary.approvedCount;
  const partiallyReceivedCount = ordersSummary.partiallyReceivedCount;
  const fullyReceivedCount = ordersSummary.receivedCount;
  const totalOutstanding = ordersSummary.totalOutstanding;
  const totalPaid = ordersSummary.totalPaid;

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
    <FormFields className="nw-purchasing-fields p-3 sm:p-5 space-y-5 pb-28 text-xs">
      {/* Module Title & Top Action Bar */}
      <Card padded={false} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-nw-surface border border-nw-border p-4 rounded-3xl shadow-lg">
        <div className="flex items-center gap-3">
          <Card padded={false} className="w-12 h-12 rounded-2xl bg-nw-surface   border border-nw-border flex items-center justify-center text-nw-text shadow-lg">
            <ShoppingBag className="w-6 h-6" />
          </Card>
          <div>
            <h1 className="text-base font-black text-nw-text flex items-center gap-2">
              <span>مركز إدارة المشتريات والموردين</span>
              <span className="text-[10px] bg-nw-info-bg text-nw-info border border-nw-border px-2 py-0.5 rounded-full">
                نظام بالجملة والتوريد
              </span>
            </h1>
            <p className="text-[11px] text-nw-muted">
              إدارة طلبات الشراء، توريد البضاعة للمخازن، حسابات الموردين، سندات الصرف والتقارير
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <UiButton variant="plain" type="button"
            onClick={() => {
              setSupplierToEdit(null);
              setIsSupplierModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-nw-ok-bg text-nw-ok border border-nw-border hover:bg-nw-ok-bg px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Building className="w-4 h-4" />
            <span>مورد جديد</span>
          </UiButton>

          <UiButton variant="plain" type="button"
            onClick={() => {
              setPreselectedSupplierForPayment(undefined);
              setSelectedPoForPayment(null);
              setIsGeneralPaymentModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-nw-bad-bg text-nw-bad border border-nw-border hover:bg-nw-bad-bg px-3.5 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition active:scale-95 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>سند صرف جديد</span>
          </UiButton>

          <UiButton variant="plain" type="button"
            onClick={() => {
              setPoToEdit(null);
              setIsCreateModalOpen(true);
            }}
            className="flex-1 sm:flex-initial bg-nw-surface     text-nw-text px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition shadow-lg active:scale-95 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Plus className="w-4 h-4" />
            <span>أمر شراء جديد</span>
          </UiButton>
        </div>
      </Card>

      {/* Main Top 8 KPI Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {/* 1. Total POs */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1">
          <span className="text-[10px] text-nw-muted block font-medium">إجمالي الأوامر</span>
          <span className="text-sm font-black text-nw-text block">{totalOrdersCount} أمر</span>
        </Card>

        {/* 2. Draft */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1">
          <span className="text-[10px] text-nw-muted block font-medium">مسودة</span>
          <span className="text-sm font-black text-nw-text block">{draftOrdersCount}</span>
        </Card>

        {/* 3. Sent */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-info-bg">
          <span className="text-[10px] text-nw-info block font-medium">مرسل للمورد</span>
          <span className="text-sm font-black text-nw-info block">{sentOrdersCount}</span>
        </Card>

        {/* 4. Approved */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-warn-bg">
          <span className="text-[10px] text-nw-warn block font-medium">معتمد</span>
          <span className="text-sm font-black text-nw-warn block">{approvedOrdersCount}</span>
        </Card>

        {/* 5. Partially Received */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-info-bg">
          <span className="text-[10px] text-nw-info block font-medium">مستلم جزئياً</span>
          <span className="text-sm font-black text-nw-info block">{partiallyReceivedCount}</span>
        </Card>

        {/* 6. Fully Received */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-ok-bg">
          <span className="text-[10px] text-nw-ok block font-medium">مستلم بالكامل</span>
          <span className="text-sm font-black text-nw-ok block">{fullyReceivedCount}</span>
        </Card>

        {/* 7. Outstanding Balance */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-bad-bg">
          <span className="text-[10px] text-nw-bad block font-medium">المستحق للموردين</span>
          <span className="text-xs font-black text-nw-bad block font-mono">
            {formatJod(totalOutstanding)} {CURRENCY}
          </span>
        </Card>

        {/* 8. Paid Amount */}
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow-sm text-center space-y-1 bg-nw-ok-bg">
          <span className="text-[10px] text-nw-ok block font-medium">إجمالي المسدد</span>
          <span className="text-xs font-black text-nw-ok block font-mono">
            {formatJod(totalPaid)} {CURRENCY}
          </span>
        </Card>
      </div>

      {/* Main Module Tabs Switcher */}
      <Card padded={false} className="flex items-center gap-1.5 bg-nw-surface p-1.5 rounded-2xl border border-nw-border text-xs font-bold overflow-x-auto scrollbar-none">
        <UiButton variant="plain" type="button"
          onClick={() => setActiveTab('orders')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'orders'
              ? 'bg-nw-surface   text-nw-text shadow-lg'
              : 'text-nw-muted hover:text-nw-text hover:bg-nw-surface-2'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>1. أوامر الشراء ({ordersTotalCount})</span>
        </UiButton>

        <UiButton variant="plain" type="button"
          onClick={() => setActiveTab('receiving')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'receiving'
              ? 'bg-nw-surface   text-nw-text shadow-lg'
              : 'text-nw-muted hover:text-nw-text hover:bg-nw-surface-2'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>2. استلام البضائع ({receivingOrders.length})</span>
        </UiButton>

        <UiButton variant="plain" type="button"
          onClick={() => setActiveTab('suppliers')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'suppliers'
              ? 'bg-nw-surface   text-nw-text shadow-lg'
              : 'text-nw-muted hover:text-nw-text hover:bg-nw-surface-2'
          }`}
        >
          <Building className="w-4 h-4" />
          <span>3. الموردين ({suppliers.length})</span>
        </UiButton>

        <UiButton variant="plain" type="button"
          onClick={() => setActiveTab('payments')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'payments'
              ? 'bg-nw-surface   text-nw-text shadow-lg'
              : 'text-nw-muted hover:text-nw-text hover:bg-nw-surface-2'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>4. سندات الصرف والمدفوعات ({paymentsTotalCount})</span>
        </UiButton>

        <UiButton variant="plain" type="button"
          onClick={() => setActiveTab('reports')}
          className={`flex-1 py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shrink-0 ${
            activeTab === 'reports'
              ? 'bg-nw-surface   text-nw-text shadow-lg'
              : 'text-nw-muted hover:text-nw-text hover:bg-nw-surface-2'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>5. تقارير المشتريات</span>
        </UiButton>
      </Card>

      {/* TAB 1: Purchase Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {/* Filters Toolbar */}
          <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-3">
            {/* Search and Dropdowns */}
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search input */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-nw-muted" />
                <input aria-label="بحث برقم أمر الشراء، المورد، رقم فاتورة المورد..."
                  type="text"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setOrdersPage(1); }}
                  placeholder="بحث برقم أمر الشراء، المورد، رقم فاتورة المورد..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl pr-9 pl-3 py-2 text-nw-text placeholder-nw-muted focus:outline-none focus:border-nw-border font-medium"
                />
              </div>

              {/* Supplier Filter */}
              <select aria-label="فلتر المورد"
                value={supplierFilter}
                onChange={(e) => { setSupplierFilter(e.target.value); setOrdersPage(1); }}
                className="w-full md:w-48 bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-bold"
              >
                <option value="all">جميع الموردين ({suppliers.length})</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                  </option>
                ))}
              </select>

              {/* Warehouse Filter */}
              <select aria-label="فلتر المستودع"
                value={warehouseFilter}
                onChange={(e) => { setWarehouseFilter(e.target.value); setOrdersPage(1); }}
                className="w-full md:w-48 bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-bold"
              >
                <option value="all">جميع المخازن</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>

              {/* Sort By */}
              <select aria-label="ترتيب القائمة"
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value as PurchaseSort); setOrdersPage(1); }}
                className="w-full md:w-44 bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-bold"
              >
                <option value="newest">الأحدث أولاً</option>
                <option value="highest_value">الأعلى قيمة</option>
              </select>

              {/* Refresh Button */}
              <UiButton variant="plain" type="button"
                onClick={loadData}
                disabled={loading}
                className="w-full md:w-auto bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 transition shrink-0 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-nw-info' : ''}`} />
                <span>تحديث</span>
              </UiButton>
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-bold pt-1 border-t border-nw-border">
              <span className="text-nw-muted text-[10px] shrink-0 font-medium">الحالة:</span>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('all'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'all'
                    ? 'bg-nw-info-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                الكل
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('draft'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'draft'
                    ? 'bg-nw-surface-2 text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                مسودة
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('sent'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'sent'
                    ? 'bg-nw-info-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                مرسل للمورد
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('approved'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'approved'
                    ? 'bg-nw-warn-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                معتمد قيد التوريد
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('partially_received'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'partially_received'
                    ? 'bg-nw-info-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                مستلم جزئياً
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('received'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'received'
                    ? 'bg-nw-ok-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                مستلم بالكامل
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => { setStatusFilter('cancelled'); setOrdersPage(1); }}
                className={`px-3 py-1 rounded-xl border shrink-0 transition ${
                  statusFilter === 'cancelled'
                    ? 'bg-nw-bad-bg text-nw-text border-nw-border'
                    : 'bg-nw-surface-2 text-nw-muted border-nw-border hover:text-nw-text'
                }`}
              >
                ملغى
              </UiButton>
            </div>
          </Card>

          {/* Orders Grid */}
          {loading ? (
            <Card padded={false} className="p-12 text-center text-nw-muted bg-nw-surface rounded-3xl border border-nw-border">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-nw-info mb-3" />
              <span className="font-bold">جاري تحميل أوامر الشراء...</span>
            </Card>
          ) : orders.length === 0 ? (
            <Card padded={false} className="p-12 text-center bg-nw-surface border border-nw-border rounded-3xl space-y-3">
              <ShoppingBag className="w-12 h-12 mx-auto text-nw-muted" />
              <h3 className="font-bold text-nw-text text-sm">لا توجد أوامر شراء مطابقة للبحث</h3>
              <p className="text-nw-muted max-w-md mx-auto">
                قم بإنشاء أمر شراء جديد للمورد أو تعديل معايير البحث والفلترة.
              </p>
              <UiButton variant="plain" type="button"
                onClick={() => {
                  setPoToEdit(null);
                  setIsCreateModalOpen(true);
                }}
                className="bg-nw-info-bg hover:bg-nw-info-bg text-nw-text px-5 py-2 rounded-xl font-bold transition shadow-lg inline-flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>إنشاء أمر شراء جديد</span>
              </UiButton>
            </Card>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {orders.map((po) => (
                  <PurchaseOrderCard
                    key={po.id}
                    po={po}
                    onViewDetails={() => setSelectedPoForDetail(po.id)}
                    onReceiveGoods={() => setSelectedPoForReceive(po)}
                    onRecordPayment={() => setSelectedPoForPayment(po)}
                  />
                ))}
              </div>
              <HistoryPagination
                page={ordersPage}
                totalPages={ordersTotalPages}
                totalCount={ordersTotalCount}
                onPageChange={setOrdersPage}
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Goods Receiving */}
      {activeTab === 'receiving' && (
        <div className="space-y-4">
          <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-2">
            <h2 className="text-sm font-bold text-nw-text flex items-center gap-2">
              <Truck className="w-4 h-4 text-nw-info" />
              <span>طلبات بانتظار توريد البضاعة للمخزن</span>
            </h2>
            <p className="text-nw-muted text-xs">
              جميع أوامر الشراء المعتمدة والمستلمة جزئياً الجاهزة لإدخال كميات الاستلام الفعلية للمخازن.
            </p>
          </Card>

          {receivingOrders.length === 0 ? (
            <Card padded={false} className="p-12 text-center bg-nw-surface border border-nw-border rounded-3xl space-y-2 text-nw-muted">
              <CheckCircle2 className="w-12 h-12 mx-auto text-nw-ok" />
              <h3 className="font-bold text-nw-text">جميع طلبيات الشراء تم استلامها بالكامل!</h3>
              <p>لا توجد طلبيات شراء معلقة قيد التوريد في الوقت الحالي.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {receivingOrders.map((po) => {
                const totalOrderedQty = po.items.reduce((sum, i) => sum + i.orderedQuantity, 0);
                const totalReceivedQty = po.items.reduce((sum, i) => sum + i.receivedQuantity, 0);
                const remainingQty = totalOrderedQty - totalReceivedQty;
                const percentage =
                  totalOrderedQty > 0 ? Math.round((totalReceivedQty / totalOrderedQty) * 100) : 0;

                return (
                  <FormFields
                    key={po.id}
                    className="nw-purchasing-fields bg-nw-surface border border-nw-border rounded-2xl p-4 shadow-lg space-y-3 relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-nw-text text-sm flex items-center gap-2">
                          <span>{po.purchaseOrderNumber}</span>
                          <span className="text-[10px] bg-nw-info-bg text-nw-info border border-nw-border px-2 py-0.5 rounded-full font-sans">
                            {po.status === 'approved' ? 'معتمد' : 'مستلم جزئياً'}
                          </span>
                        </h3>
                        <p className="text-nw-muted text-[11px] mt-0.5 flex items-center gap-2">
                          <span className="font-bold text-nw-ok">{po.supplierName}</span>
                          <span>•</span>
                          <span>مخزن: {po.warehouseName || 'المخزن الرئيسي'}</span>
                        </p>
                      </div>

                      <UiButton variant="plain" type="button"
                        onClick={() => setSelectedPoForReceive(po)}
                        className="bg-nw-surface     text-nw-text px-4 py-2 rounded-xl font-bold flex items-center gap-1.5 shadow-lg transition active:scale-95 h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        <Truck className="w-4 h-4" />
                        <span>استلام البضائع</span>
                      </UiButton>
                    </div>

                    {/* Progress Bar */}
                    <div className="bg-nw-bg p-3 rounded-xl border border-nw-border space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-nw-muted font-medium">تقدم التوريد:</span>
                        <span className="font-bold text-nw-text">
                          {totalReceivedQty} من {totalOrderedQty} قطعة ({percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-nw-surface-2 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-nw-info-bg transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-nw-muted pt-1 font-mono">
                        <span>المتبقي: {remainingQty} قطعة</span>
                        <span>تاريخ الطلب: {formatUiDate(po.orderDate, {year:'numeric',month:'numeric',day:'numeric'})}</span>
                      </div>
                    </div>

                    {/* Items preview list */}
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-bold text-nw-muted block">
                        أبرز أصناف الطلبية:
                      </span>
                      <div className="space-y-1">
                        {po.items.slice(0, 3).map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between bg-nw-bg px-2.5 py-1.5 rounded-lg border border-nw-border text-[11px]"
                          >
                            <span className="font-medium text-nw-text truncate max-w-[200px]">
                              {item.productName}
                            </span>
                            <span className="font-bold text-nw-info font-mono">
                              مستلم {item.receivedQuantity} / {item.orderedQuantity} {item.unit}
                            </span>
                          </div>
                        ))}
                        {po.items.length > 3 && (
                          <div className="text-[10px] text-nw-muted text-center font-bold">
                            + {po.items.length - 3} أصناف أخرى...
                          </div>
                        )}
                      </div>
                    </div>
                  </FormFields>
                );
              })}
            </div>
          )}

          <HistoryPagination
            page={ordersPage}
            totalPages={ordersTotalPages}
            totalCount={ordersTotalCount}
            onPageChange={setOrdersPage}
          />

          {/* Receiving History Section */}
          <div className="pt-6 space-y-3">
            <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow flex items-center justify-between">
              <div>
                <h3 className="font-bold text-nw-text text-sm flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-nw-ok" />
                  <span>سجل عمليات سندات استلام البضائع الأخيرة</span>
                </h3>
                <p className="text-nw-muted text-[11px]">
                  سجل تفصيلي لجميع السندات التي تم إدخال بضائعها في المخازن ومستودعات الشركة.
                </p>
              </div>
            </Card>

            {receipts.length === 0 ? (
              <Card padded={false} className="p-8 text-center bg-nw-surface border border-nw-border rounded-2xl text-nw-muted">
                لا توجد عمليات استلام بضائع سابقة في السجل.
              </Card>
            ) : (
              <Card padded={false} className="border border-nw-border rounded-2xl overflow-hidden bg-nw-surface shadow">
                <div className="overflow-x-auto">
                  <DataTable caption="سجل المشتريات" className="w-full text-right text-xs">
                    <thead className="bg-nw-surface-2 text-nw-text font-bold border-b border-nw-border">
                      <Tr>
                        <Th className="p-3">رقم سند الاستلام</Th>
                        <Th className="p-3">المورد</Th>
                        <Th className="p-3">المخزن المستلم</Th>
                        <Th className="p-3">ملاحظات والتسليم</Th>
                        <Th className="p-3 text-center">تاريخ الاستلام</Th>
                        <Th className="p-3 text-center">المستلم بواسطة</Th>
                        <Th className="p-3 text-center">عدد الأصناف</Th>
                      </Tr>
                    </thead>
                    <tbody className="divide-y divide-nw-border">
                      {receipts.map((r) => (
                        <Tr key={r.id} className="hover:bg-nw-surface-2 transition">
                          <Td className="p-3 font-bold text-nw-info font-mono">
                            {r.receiptNumber}
                          </Td>
                          <Td className="p-3 font-bold text-nw-text">{r.supplierName}</Td>
                          <Td className="p-3 text-nw-text">{r.warehouseName}</Td>
                          <Td className="p-3 text-nw-muted max-w-xs truncate">
                            {r.supplierDeliveryNote
                              ? `إشعارات التوريد: ${r.supplierDeliveryNote}`
                              : r.notes || '-'}
                          </Td>
                          <Td className="p-3 text-center font-mono text-nw-text">
                            {formatUiDate(r.receivedAt, {year:'numeric',month:'numeric',day:'numeric'})}
                          </Td>
                          <Td className="p-3 text-center text-nw-text">{r.receivedBy}</Td>
                          <Td className="p-3 text-center font-bold text-nw-ok">
                            {r.items.length} أصناف
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
              </Card>
            )}
            <HistoryPagination
              page={receiptsPage}
              totalPages={receiptsTotalPages}
              totalCount={receiptsTotalCount}
              onPageChange={setReceiptsPage}
            />
          </div>
        </div>
      )}

      {/* TAB 3: Supplier Management */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          {/* Top Suppliers Toolbar */}
          <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-3">
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search Supplier */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-nw-muted" />
                <input aria-label="بحث باسم الشركة، المورد، الهاتـف، الرقم الضريبي..."
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="بحث باسم الشركة، المورد، الهاتـف، الرقم الضريبي..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl pr-9 pl-3 py-2 text-nw-text placeholder-nw-muted focus:outline-none focus:border-nw-border font-medium"
                />
              </div>

              {/* Filter Active status */}
              <select aria-label="حالة المورد"
                value={supplierStatusFilter}
                onChange={(e) => setSupplierStatusFilter(e.target.value as SupplierStatusFilter)}
                className="w-full md:w-48 bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-bold"
              >
                <option value="all">جميع الحالات</option>
                <option value="active">الموردين النشطين فقط</option>
                <option value="inactive">الموردين المعطلين</option>
              </select>

              {/* Add New Supplier button */}
              <UiButton variant="plain" type="button"
                onClick={() => {
                  setSupplierToEdit(null);
                  setIsSupplierModalOpen(true);
                }}
                className="w-full md:w-auto bg-nw-ok-bg hover:bg-nw-ok-bg text-nw-text px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg shrink-0 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة مورد جديد</span>
              </UiButton>
            </div>
          </Card>

          {/* Suppliers Table/Grid */}
          {filteredSuppliers.length === 0 ? (
            <Card padded={false} className="p-12 text-center bg-nw-surface border border-nw-border rounded-3xl space-y-3 text-nw-muted">
              <Building className="w-12 h-12 mx-auto text-nw-muted" />
              <h3 className="font-bold text-nw-text">لا يوجد موردين مطبقين لهذا البحث</h3>
              <UiButton variant="plain" type="button"
                onClick={() => {
                  setSupplierToEdit(null);
                  setIsSupplierModalOpen(true);
                }}
                className="bg-nw-ok-bg text-nw-text px-4 py-2 rounded-xl font-bold transition inline-flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة أول مورد</span>
              </UiButton>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSuppliers.map((supp) => {
                const due = supp.currentBalance;
                const isActive = supp.isActive ?? true;

                return (
                  <FormFields
                    data-supplier-card={supp.id}
                    key={supp.id}
                    className="nw-purchasing-fields bg-nw-surface border border-nw-border hover:border-nw-border rounded-2xl p-4 shadow-lg space-y-3 relative overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-nw-text text-sm flex items-center gap-2">
                          <Building className="w-4 h-4 text-nw-ok shrink-0" />
                          <span>{supp.companyName}</span>
                        </h3>
                        {supp.contactPerson && (
                          <p className="text-nw-muted text-[11px] mt-0.5">
                            المسؤول: <span className="text-nw-text font-semibold">{supp.contactPerson}</span>
                          </p>
                        )}
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isActive
                            ? 'bg-nw-ok-bg text-nw-ok border-nw-border'
                            : 'bg-nw-surface-2 text-nw-muted border-nw-border'
                        }`}
                      >
                        {isActive ? 'نشط' : 'معطل'}
                      </span>
                    </div>

                    {/* Contact details */}
                    <div className="bg-nw-bg p-2.5 rounded-xl border border-nw-border space-y-1 text-[11px] text-nw-text">
                      {supp.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-3 h-3 text-nw-muted" />
                          <span className="font-mono">{supp.phone}</span>
                          {supp.whatsapp && (
                            <a
                              href={`https://wa.me/${supp.whatsapp.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-nw-ok hover:underline mr-2 text-[10px]"
                            >
                              واتساب
                            </a>
                          )}
                        </div>
                      )}
                      {supp.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3 text-nw-muted" />
                          <span className="font-mono truncate">{supp.email}</span>
                        </div>
                      )}
                      {supp.address && (
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3 h-3 text-nw-muted" />
                          <span>{supp.address}</span>
                        </div>
                      )}
                      {supp.taxNumber && (
                        <div className="flex items-center gap-2 text-[10px] text-nw-muted pt-0.5">
                          <span>الرقم الضريبي: {supp.taxNumber}</span>
                        </div>
                      )}
                    </div>

                    {/* Balances */}
                    <div className="bg-nw-bad-bg p-2 rounded-xl border border-nw-border text-center text-xs">
                        <span className="text-[10px] text-nw-muted block">{due < 0 ? 'دفعة مقدّمة:' : 'المستحق للمورد:'}</span>
                        <span className={`font-bold font-mono ${due < 0 ? 'text-nw-ok' : 'text-nw-bad'}`}>
                          {formatJod(Math.abs(due))} {CURRENCY}
                        </span>
                    </div>

                    {/* Actions toolbar */}
                    <div className="pt-2 border-t border-nw-border flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <UiButton variant="plain" type="button"
                          onClick={() => {
                            setSupplierToEdit(supp);
                            setIsSupplierModalOpen(true);
                          }}
                          className="bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Edit className="w-3 h-3 text-nw-warn" />
                          <span>تعديل</span>
                        </UiButton>

                        <UiButton variant="plain" type="button"
                          onClick={() => handleToggleSupplierActive(supp)}
                          className="bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text px-2 py-1 rounded-lg font-medium transition h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          {isActive ? 'تعطيل' : 'تفعيل'}
                        </UiButton>
                      </div>

                      {due > 0 && (
                        <UiButton variant="plain" type="button"
                          onClick={() => {
                            setPreselectedSupplierForPayment(supp);
                            setSelectedPoForPayment(null);
                            setIsGeneralPaymentModalOpen(true);
                          }}
                          className="bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-bad border border-nw-border px-3 py-1 rounded-lg font-bold flex items-center gap-1 transition h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          <span>تسديد دفعة</span>
                        </UiButton>
                      )}
                    </div>
                  </FormFields>
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
          <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-3">
            <div className="flex flex-col md:flex-row items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute right-3 top-3 text-nw-muted" />
                <input aria-label="بحث باسم المورد، مرجع الشيك/التحويل، رقم أمر الشراء..."
                  type="text"
                  value={paymentSearch}
                  onChange={(e) => { setPaymentSearch(e.target.value); setPaymentsPage(1); }}
                  placeholder="بحث باسم المورد، مرجع الشيك/التحويل، رقم أمر الشراء..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl pr-9 pl-3 py-2 text-nw-text placeholder-nw-muted focus:outline-none focus:border-nw-border font-medium"
                />
              </div>

              {/* Payment Method filter */}
              <select aria-label="فلتر طريقة الدفع"
                value={paymentMethodFilter}
                onChange={(e) => { setPaymentMethodFilter(e.target.value); setPaymentsPage(1); }}
                className="w-full md:w-48 bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border font-bold"
              >
                <option value="all">جميع وسائل الدفع</option>
                <option value="cash">نقداً</option>
                <option value="bank_transfer">تحويل بنكي</option>
                <option value="cliq">كليك CliQ</option>
                <option value="card">بطاقة ائتمان</option>
                <option value="check">شيك مصرفي</option>
              </select>

              {/* Record New Payment */}
              <UiButton variant="plain" type="button"
                onClick={() => {
                  setPreselectedSupplierForPayment(undefined);
                  setSelectedPoForPayment(null);
                  setIsGeneralPaymentModalOpen(true);
                }}
                className="w-full md:w-auto bg-nw-bad-bg hover:bg-nw-bad-bg text-nw-text px-4 py-2 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-lg shrink-0 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>إصدار سند صرف جديد</span>
              </UiButton>
            </div>
          </Card>

          {/* Payments Table */}
          {payments.length === 0 ? (
            <Card padded={false} className="p-12 text-center bg-nw-surface border border-nw-border rounded-3xl space-y-3 text-nw-muted">
              <CreditCard className="w-12 h-12 mx-auto text-nw-muted" />
              <h3 className="font-bold text-nw-text">لا توجد سندات صرف مطابقة للبحث</h3>
              <UiButton variant="plain" type="button"
                onClick={() => {
                  setPreselectedSupplierForPayment(undefined);
                  setSelectedPoForPayment(null);
                  setIsGeneralPaymentModalOpen(true);
                }}
                className="bg-nw-bad-bg text-nw-text px-4 py-2 rounded-xl font-bold transition inline-flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>إصدار أول سند صرف</span>
              </UiButton>
            </Card>
          ) : (
              <Card padded={false} className="border border-nw-border rounded-2xl overflow-hidden bg-nw-surface shadow-lg">
              <div className="overflow-x-auto">
                <DataTable caption="سجل المشتريات" className="w-full text-right text-xs">
                  <thead className="bg-nw-surface-2 text-nw-text font-bold border-b border-nw-border">
                    <Tr>
                      <Th className="p-3">تاريخ السند</Th>
                      <Th className="p-3">اسم المورد</Th>
                      <Th className="p-3">أمر الشراء المرتبط</Th>
                      <Th className="p-3 text-center">المبلغ المصروف ({CURRENCY})</Th>
                      <Th className="p-3 text-center">طريقة الدفع</Th>
                      <Th className="p-3">المرجع / الملاحظات</Th>
                      <Th className="p-3 text-center">إجراءات</Th>
                    </Tr>
                  </thead>
                  <tbody className="divide-y divide-nw-border">
                    {payments.map((p) => (
                      <Tr key={p.id} className="hover:bg-nw-surface-2 transition">
                        <Td className="p-3 font-mono text-nw-text">
                          {formatUiDate(p.paymentDate, {year:'numeric',month:'numeric',day:'numeric'})}
                        </Td>
                        <Td className="p-3 font-bold text-nw-text">{p.supplierName}</Td>
                        <Td className="p-3 text-nw-info font-mono font-bold">
                          {p.purchaseOrderNumber ? `#${p.purchaseOrderNumber}` : 'سند غير مرتبط بأمر'}
                        </Td>
                        <Td className="p-3 text-center font-black text-nw-bad font-mono text-sm">
                          {formatJod(p.amount)} {CURRENCY}
                        </Td>
                        <Td className="p-3 text-center">
                          <span className="bg-nw-surface-2 text-nw-text border border-nw-border px-2.5 py-1 rounded-lg text-[10px] font-bold">
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
                        </Td>
                        <Td className="p-3 text-nw-muted max-w-xs truncate">
                          {p.referenceNumber && (
                            <span className="font-mono text-nw-text ml-2 font-bold">
                              مرجع: {p.referenceNumber}
                            </span>
                          )}
                          {p.notes || '-'}
                        </Td>
                        <Td className="p-3 text-center">
                          <UiButton variant="plain" type="button"
                            onClick={() => setPrintingVoucher(p)}
                            className="bg-nw-surface-2 hover:bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-1 rounded-lg font-bold flex items-center gap-1 mx-auto transition h-auto min-h-11 min-w-0 whitespace-normal"
                          >
                            <Printer className="w-3.5 h-3.5 text-nw-info" />
                            <span>طباعة السند</span>
                          </UiButton>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
                </div>
              </Card>
            )}
          <HistoryPagination
            page={paymentsPage}
            totalPages={paymentsTotalPages}
            totalCount={paymentsTotalCount}
            onPageChange={setPaymentsPage}
          />
        </div>
      )}

      {/* TAB 5: Purchase Reports */}
      {activeTab === 'reports' && (
        <div className="space-y-5">
          <Card padded={false} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-1">
            <h2 className="text-sm font-bold text-nw-text flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-nw-warn" />
              <span>تقارير وتحليلات المشتريات والتوريد</span>
            </h2>
            <p className="text-nw-muted text-xs">
              ملخص تحليلي شامل لمشتريات الشركة حسب الموردين، المستحقات القائمة، والمنتجات الأكثر استلاماً.
            </p>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Report 1: Supplier balances (canonical supplier read model) */}
            <Card padded={false} className="bg-nw-surface border border-nw-border rounded-2xl p-4 shadow space-y-3">
              <h3 className="font-bold text-nw-text text-xs flex items-center gap-2 pb-2 border-b border-nw-border">
                <Building className="w-4 h-4 text-nw-ok" />
                <span>ذمم الموردين الحالية</span>
              </h3>

              <div className="space-y-2">
                {suppliers.slice(0, 5).map((supp) => {
                  const due = supp.currentBalance;
                  return (
                    <FormFields
                      key={supp.id}
                      className="nw-purchasing-fields bg-nw-bg p-2.5 rounded-xl border border-nw-border flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-nw-text block">{supp.companyName}</span>
                        <span className="text-[10px] text-nw-muted font-mono">
                          الرصيد مصدره دفتر المورد الخادمي
                        </span>
                      </div>
                      <div className="text-left">
                        <span className="text-[10px] text-nw-muted block">{due < 0 ? 'دفعة مقدّمة:' : 'المتبقي:'}</span>
                        <span className={`font-bold font-mono ${due < 0 ? 'text-nw-ok' : 'text-nw-bad'}`}>
                          {formatJod(Math.abs(due))} {CURRENCY}
                        </span>
                      </div>
                    </FormFields>
                  );
                })}
              </div>
            </Card>

            {/* Report 2: Order Fulfillment & Delivery Ratios */}
            <Card padded={false} className="bg-nw-surface border border-nw-border rounded-2xl p-4 shadow space-y-3">
              <h3 className="font-bold text-nw-text text-xs flex items-center gap-2 pb-2 border-b border-nw-border">
                <Truck className="w-4 h-4 text-nw-info" />
                <span>مؤشرات انجاز واستلام طلبات الشراء</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div className="bg-nw-bg p-3 rounded-xl border border-nw-border space-y-1">
                  <div className="flex justify-between text-nw-text">
                    <span>نسبة الطلبات المكتملة بالكامل:</span>
                    <span className="font-bold text-nw-ok">
                      {totalOrdersCount > 0
                        ? Math.round((fullyReceivedCount / totalOrdersCount) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-nw-surface-2 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-nw-ok-bg"
                      style={{
                        width: `${
                          totalOrdersCount > 0 ? (fullyReceivedCount / totalOrdersCount) * 100 : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="bg-nw-bg p-3 rounded-xl border border-nw-border space-y-1">
                  <div className="flex justify-between text-nw-text">
                    <span>نسبة الطلبات قيد الاستلام والتوريد:</span>
                    <span className="font-bold text-nw-info">
                      {totalOrdersCount > 0
                        ? Math.round(
                            ((approvedOrdersCount + partiallyReceivedCount) / totalOrdersCount) * 100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-nw-surface-2 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-nw-info-bg"
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

                <div className="bg-nw-bg p-3 rounded-xl border border-nw-border flex justify-between items-center">
                  <span className="text-nw-muted">متوسط قيمة أمر الشراء:</span>
                  <span className="font-bold text-nw-text font-mono">
                    {totalOrdersCount > 0
                      ? formatJod((
                          orders
                            .filter((o) => o.status !== 'cancelled')
                            .reduce((sum, o) => sum + o.totalAmount, 0) / (totalOrdersCount || 1)
                        ))
                      : '0.000'}{' '}
                    {CURRENCY}
                  </span>
                </div>
              </div>
            </Card>
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
          isOpen={Boolean(selectedPoForReceive)}
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
          isOpen={Boolean(selectedPoForPayment || isGeneralPaymentModalOpen)}
          po={selectedPoForPayment}
          supplierId={preselectedSupplierForPayment?.id}
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-4">
          <div className="bg-nw-surface text-nw-muted rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="text-center border-b pb-3 border-nw-border">
              <h2 className="text-base font-black">شركة النواصرة للتجارة والجملة</h2>
              <p className="text-xs text-nw-muted">سند صرف للمورد - Supplier Payment Voucher</p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between font-mono">
                <span>تاريخ السند: {formatUiDate(printingVoucher.paymentDate, {year:'numeric',month:'numeric',day:'numeric'})}</span>
                <span>طريقة الدفع: {printingVoucher.paymentMethod}</span>
              </div>
              <div className="bg-nw-mute-bg p-3 rounded-xl border border-nw-border space-y-1">
                <p>
                  <strong>صرفنا إلى السيد/السادة:</strong> {printingVoucher.supplierName}
                </p>
                <p>
                  <strong>مبلغ وقدره:</strong>{' '}
                  <span className="text-base font-black text-nw-bad font-mono">
                    {formatJod(printingVoucher.amount)} {CURRENCY}
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

            <div className="pt-4 flex items-center justify-between text-xs border-t border-nw-border">
              <div>توقيع المستلم: ____________</div>
              <div>توقيع المحاسب: ____________</div>
            </div>

            <div className="pt-2 flex justify-end gap-2 print:hidden">
              <UiButton variant="plain" type="button"
                onClick={() => setPrintingVoucher(null)}
                className="px-4 py-2 rounded-xl bg-nw-mute-bg text-nw-muted font-bold h-auto min-h-11 min-w-0 whitespace-normal"
              >
                إغلاق
              </UiButton>
              <UiButton variant="plain" type="button"
                onClick={() => window.print()}
                className="px-5 py-2 rounded-xl bg-nw-info-bg text-nw-text font-bold flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة السند</span>
              </UiButton>
            </div>
          </div>
        </div>
      )}
    </FormFields>
  );
};
