/**
 * Nawasrah Business Manager - Direct Goods Receiving Main View
 * Module Name: "استلام البضائع من الموردين"
 * Subtitle: "تسجيل البضاعة الواردة، تحديث المخزون، وحساب مستحقات الموردين"
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ReceivingProduct, SupplierReceipt } from '../../types/directReceiving';
import { Supplier, Warehouse } from '../../types';
import {
  fetchProductsForReceivingFromSupabase,
  fetchSupplierReceiptByIdFromSupabase,
  fetchSupplierReceiptsFromSupabase,
  fetchSuppliersForReceivingFromSupabase,
  fetchWarehousesForReceivingFromSupabase,
  subscribeToSupplierReceiptsRealtime,
} from '../../services/supabase/directReceiving.service';
import { CreateDirectReceiptModal } from './CreateDirectReceiptModal';
import { SupplierReceiptDetailView } from './SupplierReceiptDetailView';
import { RecordSupplierPaymentModal } from './RecordSupplierPaymentModal';
import { CancelSupplierReceiptDialog } from './CancelSupplierReceiptDialog';
import { CreateSupplierModal } from '../purchases/CreateSupplierModal';
import { Modal } from '../../components/common/Modal';
import { CURRENCY } from '../../constants';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import {
  Building2,
  PackageCheck,
  Plus,
  Search,
  DollarSign,
  RefreshCw,
  Loader2,
  Eye,
  History,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';

export const DirectReceivingView: React.FC = () => {
  // Primary Receipts State
  const [receipts, setReceipts] = useState<SupplierReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ReceivingProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Active View State
  const [activeTab, setActiveTab] = useState<
    | 'all'
    | 'unpaid'
    | 'partially_paid'
    | 'paid'
    | 'archived'
    | 'suppliers'
    | 'inventory'
    | 'old_history'
  >('all');
  const [selectedReceipt, setSelectedReceipt] = useState<SupplierReceipt | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [paymentModalReceipt, setPaymentModalReceipt] = useState<SupplierReceipt | null>(null);
  const [cancellationReceipt, setCancellationReceipt] =
    useState<SupplierReceipt | null>(null);

  // Filters State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [inventorySearchTerm, setInventorySearchTerm] = useState<string>('');
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState<string>('');
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>('');
  const [receiptPage, setReceiptPage] = useState(1);
  const [receiptTotalCount, setReceiptTotalCount] = useState(0);
  const [receiptTotalPages, setReceiptTotalPages] = useState(1);
  const [receiptSummary, setReceiptSummary] = useState({
    dueInMinorUnits: 0,
    todayCount: 0,
    todayTotalInMinorUnits: 0,
    todayPaidInMinorUnits: 0,
    itemCount: 0,
  });

  // Load Data
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [receiptsRes, supsData, whsData, productsData] = await Promise.all([
        fetchSupplierReceiptsFromSupabase({
          page: receiptPage,
          pageSize: 25,
          isArchived: activeTab === 'archived',
          paymentStatus: ['unpaid', 'partially_paid', 'paid'].includes(activeTab) ? activeTab : undefined,
          supplierId: selectedSupplierFilter || undefined,
          warehouseId: selectedWarehouseFilter || undefined,
          search: searchTerm || undefined,
        }),
        fetchSuppliersForReceivingFromSupabase(),
        fetchWarehousesForReceivingFromSupabase(),
        fetchProductsForReceivingFromSupabase(),
      ]);

      if (receiptsRes.success && receiptsRes.data) {
        setReceipts(receiptsRes.data);
        setReceiptTotalCount(receiptsRes.totalCount);
        setReceiptTotalPages(receiptsRes.totalPages);
        setReceiptSummary(receiptsRes.summary);
      }
      setSuppliers(supsData);
      setWarehouses(whsData);
      setProducts(productsData);
    } catch (err) {
      console.error('Error loading supplier receipts:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [activeTab, receiptPage, selectedSupplierFilter, selectedWarehouseFilter, searchTerm]);

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

  const filteredInventoryProducts = useMemo(() => {
    const query = inventorySearchTerm.trim().toLowerCase();
    if (!query) return products;

    return products.filter(
      (product) =>
        product.nameAr.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query) ||
        Boolean(product.barcode?.toLowerCase().includes(query))
    );
  }, [inventorySearchTerm, products]);

  const inventoryMetrics = useMemo(() => {
    const onHandQuantity = products.reduce(
      (total, product) => total + product.onHandQuantity,
      0
    );
    const reservedQuantity = products.reduce(
      (total, product) => total + product.reservedQuantity,
      0
    );
    const availableQuantity = products.reduce(
      (total, product) => total + product.availableQuantity,
      0
    );
    const costValueInMinorUnits = products.reduce(
      (total, product) =>
        total + product.onHandQuantity * product.costPriceInMinorUnits,
      0
    );
    const saleValueInMinorUnits = products.reduce(
      (total, product) =>
        total + product.onHandQuantity * product.salePriceInMinorUnits,
      0
    );
    const lowStockCount = products.filter(
      (product) => product.availableQuantity <= product.minStockLevel
    ).length;

    return {
      onHandQuantity,
      reservedQuantity,
      availableQuantity,
      costValueInMinorUnits,
      saleValueInMinorUnits,
      lowStockCount,
    };
  }, [products]);

  const productReceiptContext = useMemo(() => {
    const context = new Map<
      string,
      {
        supplierNames: Set<string>;
        lastReceipt: SupplierReceipt | null;
      }
    >();

    receipts.forEach((receipt) => {
      receipt.items?.forEach((item) => {
        const current = context.get(item.productId) ?? {
          supplierNames: new Set<string>(),
          lastReceipt: null,
        };
        current.supplierNames.add(receipt.supplierName);

        if (
          !current.lastReceipt ||
          new Date(receipt.receivedAt).getTime() >
            new Date(current.lastReceipt.receivedAt).getTime()
        ) {
          current.lastReceipt = receipt;
        }
        context.set(item.productId, current);
      });
    });

    return context;
  }, [receipts]);

  // Today KPI Aggregations
  const kpiMetrics = useMemo(() => {
    return {
      todayCount: receiptSummary.todayCount,
      todayValueJod: (receiptSummary.todayTotalInMinorUnits / 1000).toFixed(3),
      todayPaidJod: (receiptSummary.todayPaidInMinorUnits / 1000).toFixed(3),
      outstandingDueJod: (receiptSummary.dueInMinorUnits / 1000).toFixed(3),
      suppliersCount: suppliers.length,
      receivedItemsCount: receiptSummary.itemCount,
    };
  }, [receiptSummary, suppliers]);

  const handleViewReceiptDetails = useCallback(async (receipt: SupplierReceipt) => {
    const result = await fetchSupplierReceiptByIdFromSupabase(receipt.id);
    if (result.success && result.data) {
      setSelectedReceipt(result.data);
      return;
    }

    console.error('Unable to load supplier receipt details:', result.error);
  }, []);

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
            onClick={() => setShowSupplierModal(true)}
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
            onClick={() => { setActiveTab('all'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'all' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            جميع الاستلامات
          </button>
          <button
            onClick={() => { setActiveTab('unpaid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'unpaid' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            غير مدفوع (ذمم)
          </button>
          <button
            onClick={() => { setActiveTab('partially_paid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'partially_paid' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            مدفوع جزئيًا
          </button>
          <button
            onClick={() => { setActiveTab('paid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'paid' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            مدفوع بالكامل
          </button>
          <button
            onClick={() => { setActiveTab('archived'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'archived' ? 'bg-slate-800 text-amber-300 shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            المؤرشفة
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-3 py-1.5 rounded-xl border transition flex items-center gap-1 ${
              activeTab === 'inventory'
                ? 'bg-slate-800 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>المخزون ({products.length})</span>
          </button>
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
      {activeTab !== 'suppliers' &&
        activeTab !== 'inventory' &&
        activeTab !== 'old_history' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-900 border border-slate-800 p-2.5 rounded-2xl">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 ml-2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setReceiptPage(1); }}
              placeholder="ابحث برقم السند أو فاتورة المورد..."
              className="w-full bg-transparent text-slate-100 placeholder-slate-500 outline-none font-bold"
            />
          </div>

          <select
            value={selectedSupplierFilter}
            onChange={(e) => { setSelectedSupplierFilter(e.target.value); setReceiptPage(1); }}
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
            onChange={(e) => { setSelectedWarehouseFilter(e.target.value); setReceiptPage(1); }}
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
              onClick={() => setShowSupplierModal(true)}
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
                  <span>العنوان: {sup.address || 'غير محدد'}</span>
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

      {/* Live Inventory Tab */}
      {activeTab === 'inventory' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-l from-cyan-950/25 via-slate-900 to-slate-900 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-sm font-extrabold text-slate-100">
                    المخزون الفعلي بعد الاستلام والبيع
                  </h2>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  الأرقام مباشرة من أرصدة Supabase لكل مستودع. الاستلام يزيد المخزون
                  والبيع ينقص المتاح تلقائياً.
                </p>
              </div>

              <div className="flex min-w-[240px] items-center rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
                <Search className="ml-2 h-4 w-4 text-slate-500" />
                <input
                  value={inventorySearchTerm}
                  onChange={(event) => setInventorySearchTerm(event.target.value)}
                  placeholder="ابحث باسم الصنف أو SKU أو الباركود..."
                  className="w-full bg-transparent font-bold text-slate-100 outline-none placeholder:text-slate-600"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                {
                  label: 'الأصناف',
                  value: products.length.toLocaleString('ar-JO'),
                  tone: 'text-white',
                },
                {
                  label: 'المخزون الفعلي',
                  value: inventoryMetrics.onHandQuantity.toLocaleString('ar-JO'),
                  tone: 'text-blue-300',
                },
                {
                  label: 'المحجوز للطلبات',
                  value: inventoryMetrics.reservedQuantity.toLocaleString('ar-JO'),
                  tone: 'text-amber-300',
                },
                {
                  label: 'المتاح للبيع',
                  value: inventoryMetrics.availableQuantity.toLocaleString('ar-JO'),
                  tone: 'text-cyan-300',
                },
                {
                  label: 'قيمة التكلفة',
                  value: `${minorToJod(inventoryMetrics.costValueInMinorUnits)} ${CURRENCY}`,
                  tone: 'text-emerald-300',
                },
                {
                  label: 'قريب من النفاد',
                  value: inventoryMetrics.lowStockCount.toLocaleString('ar-JO'),
                  tone:
                    inventoryMetrics.lowStockCount > 0
                      ? 'text-rose-300'
                      : 'text-emerald-300',
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5"
                >
                  <span className="block text-[9px] font-bold text-slate-500">
                    {metric.label}
                  </span>
                  <strong className={`mt-1 block text-xs ${metric.tone}`}>
                    {metric.value}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-cyan-400" />
            </div>
          ) : filteredInventoryProducts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900 p-10 text-center">
              <Boxes className="mx-auto h-9 w-9 text-slate-600" />
              <p className="mt-2 text-xs font-bold text-slate-300">
                لا توجد أصناف مطابقة للبحث
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredInventoryProducts.map((product) => {
                const isLowStock =
                  product.availableQuantity <= product.minStockLevel;
                const context = productReceiptContext.get(product.id);
                const supplierNames = context
                  ? Array.from(context.supplierNames).join('، ')
                  : 'لا يوجد استلام مسجل';
                const lastReceipt = context?.lastReceipt;
                const stockFormat = formatWholesaleInventory(
                  product.onHandQuantity,
                  product.unitsPerPackage,
                  product.purchaseUnitName,
                  product.baseUnitName
                );
                const availableFormat = formatWholesaleInventory(
                  product.availableQuantity,
                  product.unitsPerPackage,
                  product.purchaseUnitName,
                  product.baseUnitName
                );

                return (
                  <article
                    key={product.id}
                    className={`space-y-3 rounded-2xl border bg-slate-900 p-4 shadow ${
                      isLowStock
                        ? 'border-rose-500/35'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-2">
                      <div>
                        <h3 className="text-sm font-extrabold text-slate-100">
                          {product.nameAr}
                        </h3>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          SKU: {product.sku}
                          {product.barcode ? ` · باركود: ${product.barcode}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${
                          isLowStock
                            ? 'border-rose-500/30 bg-rose-950/50 text-rose-300'
                            : 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
                        }`}
                      >
                        {isLowStock ? 'قريب من النفاد' : 'المخزون جيد'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-2.5">
                        <span className="block text-[9px] text-slate-500">
                          الفعلي
                        </span>
                        <strong className="mt-1 block text-[11px] text-blue-200">
                          {stockFormat.fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-xl border border-amber-500/20 bg-amber-950/15 p-2.5">
                        <span className="block text-[9px] text-slate-500">
                          المحجوز
                        </span>
                        <strong className="mt-1 block text-[11px] text-amber-300">
                          {formatWholesaleInventory(
                            product.reservedQuantity,
                            product.unitsPerPackage,
                            product.purchaseUnitName,
                            product.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-2.5">
                        <span className="block text-[9px] text-slate-500">
                          المتاح للبيع
                        </span>
                        <strong className="mt-1 block text-[11px] text-cyan-200">
                          {availableFormat.fullFormatted}
                        </strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                        <span className="text-slate-500">تكلفة الحبة: </span>
                        <strong className="text-amber-300">
                          {minorToJod(product.costPriceInMinorUnits)} {CURRENCY}
                        </strong>
                        <span className="mt-1 block text-slate-500">
                          قيمة المخزون بالتكلفة:{' '}
                          <strong className="text-slate-200">
                            {minorToJod(
                              product.onHandQuantity *
                                product.costPriceInMinorUnits
                            )}{' '}
                            {CURRENCY}
                          </strong>
                        </span>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                        <span className="text-slate-500">سعر بيع الحبة: </span>
                        <strong className="text-emerald-300">
                          {minorToJod(product.salePriceInMinorUnits)} {CURRENCY}
                        </strong>
                        <span className="mt-1 block text-slate-500">
                          قيمة البيع المتوقعة:{' '}
                          <strong className="text-slate-200">
                            {minorToJod(
                              product.onHandQuantity *
                                product.salePriceInMinorUnits
                            )}{' '}
                            {CURRENCY}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                      {product.inventoryBalances.length === 0 ? (
                        <p className="text-[10px] text-slate-500">
                          لا يوجد رصيد في أي مستودع بعد.
                        </p>
                      ) : (
                        product.inventoryBalances.map((balance) => {
                          const warehouse = warehouses.find(
                            (item) => item.id === balance.warehouseId
                          );
                          return (
                            <div
                              key={balance.warehouseId}
                              className="flex flex-wrap items-center justify-between gap-2 text-[10px]"
                            >
                              <span className="font-bold text-slate-300">
                                {warehouse?.nameAr || 'مستودع غير معروف'}
                              </span>
                              <span className="text-slate-500">
                                فعلي{' '}
                                <strong className="text-blue-300">
                                  {balance.onHandQuantity}
                                </strong>{' '}
                                · محجوز{' '}
                                <strong className="text-amber-300">
                                  {balance.reservedQuantity}
                                </strong>{' '}
                                · متاح{' '}
                                <strong className="text-cyan-300">
                                  {balance.availableQuantity}
                                </strong>
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>
                        الموردون في سجل الاستلام:{' '}
                        <strong className="text-slate-300">{supplierNames}</strong>
                      </span>
                      <span>
                        حد التنبيه:{' '}
                        <strong className="text-rose-300">
                          {product.minStockLevel} {product.baseUnitName}
                        </strong>
                        {lastReceipt
                          ? ` · آخر استلام ${new Date(
                              lastReceipt.receivedAt
                            ).toLocaleDateString('ar-JO')}`
                          : ''}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
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
      {activeTab !== 'suppliers' &&
        activeTab !== 'inventory' &&
        activeTab !== 'old_history' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto" />
              <p className="text-xs font-bold">جاري تحميل سندات استلام البضائع...</p>
            </div>
          ) : receipts.length === 0 ? (
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
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {receipts.map((r) => {
                const isPaid = r.paymentStatus === 'paid';
                const isPartial = r.paymentStatus === 'partially_paid';
                const isCancelled = r.status === 'cancelled';

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
                          isCancelled
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                            : isPaid
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : isPartial
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {isCancelled
                          ? 'ملغى ومعكوس'
                          : isPaid
                          ? 'مدفوع'
                          : isPartial
                          ? 'مدفوع جزئياً'
                          : 'غير مدفوع'}
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
                        onClick={() => void handleViewReceiptDetails(r)}
                        className="bg-slate-800 text-blue-300 hover:bg-slate-700 px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض التفاصيل</span>
                      </button>

                      <div className="flex items-center gap-1">
                        {r.status === 'completed' && (
                          <button
                            onClick={() => setCancellationReceipt(r)}
                            className="flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-600/15 px-2.5 py-1.5 text-[10px] font-bold text-rose-300 transition hover:bg-rose-600/25"
                            title="إلغاء السند وعكس المخزون"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </button>
                        )}

                        {r.status === 'completed' &&
                          r.amountDueInMinorUnits > 0 && (
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
                  </div>
                );
              })}
            </div>
            {receiptTotalCount > 0 && (
              <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-2 text-[11px] font-bold text-slate-400">
                <button
                  type="button"
                  onClick={() => setReceiptPage((current) => Math.max(1, current - 1))}
                  disabled={receiptPage <= 1 || loading}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-200 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" /> السابق
                </button>
                <span>{receiptPage} / {receiptTotalPages} · {receiptTotalCount} سند</span>
                <button
                  type="button"
                  onClick={() => setReceiptPage((current) => Math.min(receiptTotalPages, current + 1))}
                  disabled={receiptPage >= receiptTotalPages || loading}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-3 py-2 text-slate-200 disabled:opacity-40"
                >
                  التالي <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            )}
            </>
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

      <CreateSupplierModal
        isOpen={showSupplierModal}
        onClose={() => setShowSupplierModal(false)}
        onSuccess={(supplier) => {
          setSuppliers((current) => {
            const next = current.filter((item) => item.id !== supplier.id);
            return [...next, supplier].sort((a, b) =>
              a.companyName.localeCompare(b.companyName, 'ar')
            );
          });
          setShowSupplierModal(false);
          loadData(true);
        }}
      />

      <CancelSupplierReceiptDialog
        receipt={cancellationReceipt}
        onClose={() => setCancellationReceipt(null)}
        onSuccess={() => loadData()}
      />

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
