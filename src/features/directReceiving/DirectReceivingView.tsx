import {FormFields, Card, UiButton, formatJod, formatUiDate} from '../../components/ui';
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
  const [inventoryProductsLoading, setInventoryProductsLoading] = useState(false);

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
      const [receiptsRes, supsData, whsData] = await Promise.all([
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
      ]);

      if (receiptsRes.success && receiptsRes.data) {
        setReceipts(receiptsRes.data);
        setReceiptTotalCount(receiptsRes.totalCount);
        setReceiptTotalPages(receiptsRes.totalPages);
        setReceiptSummary(receiptsRes.summary);
      }
      setSuppliers(supsData);
      setWarehouses(whsData);
    } catch (err) {
      console.error('Error loading supplier receipts:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [activeTab, receiptPage, selectedSupplierFilter, selectedWarehouseFilter, searchTerm]);

  useEffect(() => {
    if (activeTab !== 'inventory') return;
    let active = true;
    const timer = window.setTimeout(() => {
      setInventoryProductsLoading(true);
      fetchProductsForReceivingFromSupabase({
        search: inventorySearchTerm,
        limit: 50,
      })
        .then((result) => {
          if (active) setProducts(result);
        })
        .catch((error) => {
          if (!active) return;
          console.error('Error searching receiving inventory products:', error);
          setProducts([]);
        })
        .finally(() => {
          if (active) setInventoryProductsLoading(false);
        });
    }, inventorySearchTerm.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeTab, inventorySearchTerm]);

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

  const filteredInventoryProducts = products;

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
      <FormFields className="nw-purchasing-fields p-2 sm:p-4 pb-24 max-w-7xl mx-auto">
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
      </FormFields>
    );
  }

  return (
    <FormFields dir="rtl" className="nw-purchasing-fields p-2 sm:p-4 space-y-4 pb-24 max-w-7xl mx-auto">
      {/* Module Title Header */}
      <Card padded={false} className="bg-nw-surface    border border-nw-border p-4 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-nw-info-bg text-nw-info border border-nw-border flex items-center justify-center">
              <PackageCheck className="w-5 h-5" />
            </div>
            <h1 className="text-base font-black text-nw-text">استلام البضائع من الموردين</h1>
          </div>
          <p className="text-[11px] text-nw-muted mt-1">
            تسجيل البضاعة الواردة، تحديث المخزون، وحساب مستحقات الموردين مباشرة
          </p>
        </div>

        <div className="flex items-center gap-2">
          <UiButton variant="plain" type="button"
            onClick={() => setShowCreateModal(true)}
            className="bg-nw-surface    text-nw-text font-extrabold px-4 py-2 rounded-xl text-xs   transition shadow-lg shadow-nw-border flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Plus className="w-4 h-4" />
            <span>استلام بضاعة جديد</span>
          </UiButton>

          <UiButton variant="plain" type="button"
            onClick={() => setShowSupplierModal(true)}
            className="bg-nw-surface-2 text-nw-text border border-nw-border px-3 py-2 rounded-xl font-bold text-xs hover:bg-nw-surface-2 transition flex items-center gap-1 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Building2 className="w-3.5 h-3.5 text-nw-info" />
            <span>إضافة مورد</span>
          </UiButton>

          <UiButton variant="plain" type="button"
            onClick={() => loadData()}
            className="bg-nw-surface-2 text-nw-muted p-2 rounded-xl hover:text-nw-text transition h-auto min-h-11 min-w-0 whitespace-normal"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </UiButton>
        </div>
      </Card>

      {/* KPI Summary Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">استلامات اليوم</span>
          <span className="font-extrabold text-nw-text text-base block">{kpiMetrics.todayCount} شحنات</span>
        </Card>

        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">قيمة بضاعة اليوم</span>
          <span className="font-extrabold text-nw-ok text-sm block">
            {formatJod(Number(kpiMetrics.todayValueJod))} {CURRENCY}
          </span>
        </Card>

        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">المدفوع اليوم</span>
          <span className="font-extrabold text-nw-ok text-sm block">
            {formatJod(Number(kpiMetrics.todayPaidJod))} {CURRENCY}
          </span>
        </Card>

        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">المتبقي للموردين (ذمم)</span>
          <span className="font-extrabold text-nw-bad text-sm block">
            {formatJod(Number(kpiMetrics.outstandingDueJod))} {CURRENCY}
          </span>
        </Card>

        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">عدد الموردين</span>
          <span className="font-extrabold text-nw-info text-base block">{kpiMetrics.suppliersCount} مورد</span>
        </Card>

        <Card padded={false} className="bg-nw-surface border border-nw-border p-3 rounded-2xl shadow space-y-1">
          <span className="text-[10px] text-nw-muted font-bold block">الأصناف المستلمة</span>
          <span className="font-extrabold text-nw-info text-base block">{kpiMetrics.receivedItemsCount} صنف</span>
        </Card>
      </div>

      {/* Main Filter Tabs */}
      <Card padded={false} className="flex flex-wrap items-center justify-between gap-2 bg-nw-surface border border-nw-border p-1.5 rounded-2xl text-xs font-bold">
        <div className="flex items-center gap-1 overflow-x-auto">
          <UiButton variant="plain" type="button"
            onClick={() => { setActiveTab('all'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'all' ? 'bg-nw-info-bg text-nw-text shadow' : 'text-nw-muted hover:text-nw-text'
            }`}
          >
            جميع الاستلامات
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => { setActiveTab('unpaid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'unpaid' ? 'bg-nw-bad-bg text-nw-text shadow' : 'text-nw-muted hover:text-nw-text'
            }`}
          >
            غير مدفوع (ذمم)
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => { setActiveTab('partially_paid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'partially_paid' ? 'bg-nw-warn-bg text-nw-text shadow' : 'text-nw-muted hover:text-nw-text'
            }`}
          >
            مدفوع جزئيًا
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => { setActiveTab('paid'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'paid' ? 'bg-nw-ok-bg text-nw-text shadow' : 'text-nw-muted hover:text-nw-text'
            }`}
          >
            مدفوع بالكامل
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => { setActiveTab('archived'); setReceiptPage(1); }}
            className={`px-3 py-1.5 rounded-xl transition ${
              activeTab === 'archived' ? 'bg-nw-surface-2 text-nw-warn shadow' : 'text-nw-muted hover:text-nw-text'
            }`}
          >
            المؤرشفة
          </UiButton>
        </div>

        <div className="flex items-center gap-1">
          <UiButton variant="plain" type="button"
            onClick={() => setActiveTab('inventory')}
            className={`px-3 py-1.5 rounded-xl border transition flex items-center gap-1 ${
              activeTab === 'inventory'
                ? 'bg-nw-surface-2 text-nw-info border-nw-border'
                : 'bg-nw-bg text-nw-muted border-nw-border hover:text-nw-text'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>المخزون ({products.length})</span>
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => setActiveTab('suppliers')}
            className={`px-3 py-1.5 rounded-xl border transition ${
              activeTab === 'suppliers'
                ? 'bg-nw-surface-2 text-nw-info border-nw-border'
                : 'bg-nw-bg text-nw-muted border-nw-border hover:text-nw-text'
            }`}
          >
            دليل الموردين ({suppliers.length})
          </UiButton>
          <UiButton variant="plain" type="button"
            onClick={() => setActiveTab('old_history')}
            className={`px-3 py-1.5 rounded-xl border transition flex items-center gap-1 ${
              activeTab === 'old_history'
                ? 'bg-nw-surface-2 text-nw-info border-nw-border'
                : 'bg-nw-bg text-nw-muted border-nw-border hover:text-nw-text'
            }`}
          >
            <History className="w-3.5 h-3.5 text-nw-info" />
            <span>سجل المشتريات القديم</span>
          </UiButton>
        </div>
      </Card>

      {/* Search & Secondary Filters */}
      {activeTab !== 'suppliers' &&
        activeTab !== 'inventory' &&
        activeTab !== 'old_history' && (
        <Card padded={false} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-nw-surface border border-nw-border p-2.5 rounded-2xl">
          <div className="flex items-center bg-nw-bg border border-nw-border rounded-xl px-3 py-1.5 text-xs">
            <Search className="w-3.5 h-3.5 text-nw-muted ml-2" />
            <input aria-label="ابحث برقم السند أو فاتورة المورد..."
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setReceiptPage(1); }}
              placeholder="ابحث برقم السند أو فاتورة المورد..."
              className="w-full bg-transparent text-nw-text placeholder-nw-muted outline-none font-bold"
            />
          </div>

          <select aria-label="فلتر المورد"
            value={selectedSupplierFilter}
            onChange={(e) => { setSelectedSupplierFilter(e.target.value); setReceiptPage(1); }}
            className="bg-nw-bg border border-nw-border text-nw-text rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
          >
            <option value="">جميع الموردين</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </select>

          <select aria-label="فلتر المستودع"
            value={selectedWarehouseFilter}
            onChange={(e) => { setSelectedWarehouseFilter(e.target.value); setReceiptPage(1); }}
            className="bg-nw-bg border border-nw-border text-nw-text rounded-xl px-3 py-1.5 text-xs font-bold outline-none"
          >
            <option value="">جميع المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </select>
        </Card>
      )}

      {/* Suppliers Tab Content */}
      {activeTab === 'suppliers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-nw-text">قائمة الموردين النشطين والمستحقات:</span>
            <UiButton variant="plain" type="button"
              onClick={() => setShowSupplierModal(true)}
              className="bg-nw-info-bg text-nw-info border border-nw-border px-3 py-1 rounded-xl text-xs font-bold hover:bg-nw-info-bg transition flex items-center gap-1 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة مورد جديد</span>
            </UiButton>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {suppliers.map((sup) => (
              <Card padded={false} key={sup.id} className="bg-nw-surface border border-nw-border p-4 rounded-2xl shadow space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-nw-text text-sm">{sup.companyName}</h3>
                  <span className="text-[10px] text-nw-muted">مسؤول التواصل: {sup.contactPerson || 'غير محدد'}</span>
                </div>

                <div className="text-xs text-nw-muted flex items-center justify-between">
                  <span>هاتف: {sup.phone || 'بدون هاتف'}</span>
                  <span>العنوان: {sup.address || 'غير محدد'}</span>
                </div>

                <div className="bg-nw-bg p-2.5 rounded-xl border border-nw-border flex items-center justify-between text-xs font-bold pt-2">
                  <span className="text-nw-muted">{sup.currentBalance < 0 ? 'دفعة مقدّمة:' : 'المستحقات الحالية:'}</span>
                  <span className={`font-extrabold ${sup.currentBalance < 0 ? 'text-nw-ok' : 'text-nw-bad'}`}>{formatJod(Math.abs(sup.currentBalance))} {CURRENCY}</span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Live Inventory Tab */}
      {activeTab === 'inventory' && (
        <div className="space-y-3">
          <Card padded={false} className="rounded-2xl border border-nw-border bg-nw-surface    p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-nw-info" />
                  <h2 className="text-sm font-extrabold text-nw-text">
                    المخزون الفعلي بعد الاستلام والبيع
                  </h2>
                </div>
                <p className="mt-1 text-[11px] text-nw-muted">
                  النتائج الحالية مباشرة من أرصدة Supabase ومحدودة إلى 50 صنفًا؛
                  استخدم البحث للوصول السريع إلى أي صنف.
                </p>
              </div>

              <div className="flex min-w-[240px] items-center rounded-xl border border-nw-border bg-nw-bg px-3 py-2 text-xs">
                <Search className="ml-2 h-4 w-4 text-nw-muted" />
                <input aria-label="ابحث باسم الصنف أو SKU أو الباركود..."
                  value={inventorySearchTerm}
                  onChange={(event) => setInventorySearchTerm(event.target.value)}
                  placeholder="ابحث باسم الصنف أو SKU أو الباركود..."
                  className="w-full bg-transparent font-bold text-nw-text outline-none placeholder:text-nw-muted"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                {
                  label: 'الأصناف',
                  value: products.length.toLocaleString('en-US'),
                  tone: 'text-nw-text',
                },
                {
                  label: 'المخزون الفعلي',
                  value: inventoryMetrics.onHandQuantity.toLocaleString('en-US'),
                  tone: 'text-nw-info',
                },
                {
                  label: 'المحجوز للطلبات',
                  value: inventoryMetrics.reservedQuantity.toLocaleString('en-US'),
                  tone: 'text-nw-warn',
                },
                {
                  label: 'المتاح للبيع',
                  value: inventoryMetrics.availableQuantity.toLocaleString('en-US'),
                  tone: 'text-nw-info',
                },
                {
                  label: 'قيمة التكلفة',
                  value: `${formatJod(Number(minorToJod(inventoryMetrics.costValueInMinorUnits)))} ${CURRENCY}`,
                  tone: 'text-nw-ok',
                },
                {
                  label: 'قريب من النفاد',
                  value: inventoryMetrics.lowStockCount.toLocaleString('en-US'),
                  tone:
                    inventoryMetrics.lowStockCount > 0
                      ? 'text-nw-bad'
                      : 'text-nw-ok',
                },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-xl border border-nw-border bg-nw-bg p-2.5"
                >
                  <span className="block text-[9px] font-bold text-nw-muted">
                    {metric.label}
                  </span>
                  <strong className={`mt-1 block text-xs ${metric.tone}`}>
                    {metric.value}
                  </strong>
                </div>
              ))}
            </div>
          </Card>

          {inventoryProductsLoading ? (
            <div className="p-12 text-center text-nw-muted">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-nw-info" />
            </div>
          ) : filteredInventoryProducts.length === 0 ? (
            <Card padded={false} className="rounded-2xl border border-dashed border-nw-border bg-nw-surface p-10 text-center">
              <Boxes className="mx-auto h-9 w-9 text-nw-muted" />
              <p className="mt-2 text-xs font-bold text-nw-text">
                لا توجد أصناف مطابقة للبحث
              </p>
            </Card>
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
                    className={`space-y-3 rounded-2xl border bg-nw-surface p-4 shadow ${
                      isLowStock
                        ? 'border-nw-border'
                        : 'border-nw-border hover:border-nw-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-nw-border pb-2">
                      <div>
                        <h3 className="text-sm font-extrabold text-nw-text">
                          {product.nameAr}
                        </h3>
                        <p className="mt-0.5 text-[10px] text-nw-muted">
                          SKU: {product.sku}
                          {product.barcode ? ` · باركود: ${product.barcode}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[9px] font-extrabold ${
                          isLowStock
                            ? 'border-nw-border bg-nw-bad-bg text-nw-bad'
                            : 'border-nw-border bg-nw-ok-bg text-nw-ok'
                        }`}
                      >
                        {isLowStock ? 'قريب من النفاد' : 'المخزون جيد'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-nw-border bg-nw-info-bg p-2.5">
                        <span className="block text-[9px] text-nw-muted">
                          الفعلي
                        </span>
                        <strong className="mt-1 block text-[11px] text-nw-info">
                          {stockFormat.fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-xl border border-nw-border bg-nw-warn-bg p-2.5">
                        <span className="block text-[9px] text-nw-muted">
                          المحجوز
                        </span>
                        <strong className="mt-1 block text-[11px] text-nw-warn">
                          {formatWholesaleInventory(
                            product.reservedQuantity,
                            product.unitsPerPackage,
                            product.purchaseUnitName,
                            product.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-xl border border-nw-border bg-nw-info-bg p-2.5">
                        <span className="block text-[9px] text-nw-muted">
                          المتاح للبيع
                        </span>
                        <strong className="mt-1 block text-[11px] text-nw-info">
                          {availableFormat.fullFormatted}
                        </strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="rounded-xl border border-nw-border bg-nw-bg p-2">
                        <span className="text-nw-muted">تكلفة الحبة: </span>
                        <strong className="text-nw-warn">
                          {formatJod(Number(minorToJod(product.costPriceInMinorUnits)))} {CURRENCY}
                        </strong>
                        <span className="mt-1 block text-nw-muted">
                          قيمة المخزون بالتكلفة:{' '}
                          <strong className="text-nw-text">
                            {formatJod(Number(minorToJod(
                              product.onHandQuantity *
                                product.costPriceInMinorUnits
                            )))}{' '}
                            {CURRENCY}
                          </strong>
                        </span>
                      </div>
                      <div className="rounded-xl border border-nw-border bg-nw-bg p-2">
                        <span className="text-nw-muted">سعر بيع الحبة: </span>
                        <strong className="text-nw-ok">
                          {formatJod(Number(minorToJod(product.salePriceInMinorUnits)))} {CURRENCY}
                        </strong>
                        <span className="mt-1 block text-nw-muted">
                          قيمة البيع المتوقعة:{' '}
                          <strong className="text-nw-text">
                            {formatJod(Number(minorToJod(
                              product.onHandQuantity *
                                product.salePriceInMinorUnits
                            )))}{' '}
                            {CURRENCY}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 rounded-xl border border-nw-border bg-nw-bg p-2.5">
                      {product.inventoryBalances.length === 0 ? (
                        <p className="text-[10px] text-nw-muted">
                          لا يوجد رصيد في أي مستودع بعد.
                        </p>
                      ) : (
                        product.inventoryBalances.map((balance) => {
                          const warehouse = warehouses.find(
                            (item) => item.id === balance.warehouseId
                          );
                          return (
                            <FormFields
                              key={balance.warehouseId}
                              className="nw-purchasing-fields flex flex-wrap items-center justify-between gap-2 text-[10px]"
                            >
                              <span className="font-bold text-nw-text">
                                {warehouse?.nameAr || 'مستودع غير معروف'}
                              </span>
                              <span className="text-nw-muted">
                                فعلي{' '}
                                <strong className="text-nw-info">
                                  {balance.onHandQuantity}
                                </strong>{' '}
                                · محجوز{' '}
                                <strong className="text-nw-warn">
                                  {balance.reservedQuantity}
                                </strong>{' '}
                                · متاح{' '}
                                <strong className="text-nw-info">
                                  {balance.availableQuantity}
                                </strong>
                              </span>
                            </FormFields>
                          );
                        })
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-nw-muted">
                      <span>
                        الموردون في سجل الاستلام:{' '}
                        <strong className="text-nw-text">{supplierNames}</strong>
                      </span>
                      <span>
                        حد التنبيه:{' '}
                        <strong className="text-nw-bad">
                          {product.minStockLevel} {product.baseUnitName}
                        </strong>
                        {lastReceipt
                          ? ` · آخر استلام ${formatUiDate(lastReceipt.receivedAt, {year:'numeric',month:'numeric',day:'numeric'})}`
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
        <Card padded={false} className="bg-nw-surface border border-nw-border p-6 rounded-2xl text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-nw-info-bg text-nw-info border border-nw-border flex items-center justify-center mx-auto">
            <History className="w-6 h-6" />
          </div>
          <h3 className="font-extrabold text-nw-text text-sm">سجل طلبيات الشراء القديمة (للعرض فقط)</h3>
          <p className="text-xs text-nw-muted max-w-lg mx-auto">
            تم إيقاف نظام طلبات الشراء والموافقات بناءً على سياسة العمل المباشر. يتم استلام البضائع الواردة فوراً عبر قسم
            "استلام البضائع من الموردين".
          </p>
          <div className="p-3 bg-nw-bg border border-nw-border rounded-xl text-[11px] text-nw-muted max-w-md mx-auto">
            السجلات القديمة محفوظة بأمان في الأرشيف للأغراض المحاسبية والقانونية.
          </div>
        </Card>
      )}

      {/* Primary Receipts List Cards */}
      {activeTab !== 'suppliers' &&
        activeTab !== 'inventory' &&
        activeTab !== 'old_history' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-12 text-center text-nw-muted space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-nw-info mx-auto" />
              <p className="text-xs font-bold">جاري تحميل سندات استلام البضائع...</p>
            </div>
          ) : receipts.length === 0 ? (
            <Card padded={false} className="bg-nw-surface border border-dashed border-nw-border p-12 rounded-2xl text-center space-y-3">
              <PackageCheck className="w-10 h-10 text-nw-muted mx-auto" />
              <h3 className="font-bold text-nw-text text-xs">لا توجد سندات استلام بضائع مطابقة</h3>
              <p className="text-[11px] text-nw-muted">اضغط على زر "استلام بضاعة جديد" لتسجيل الشحنة الواردة فوراً.</p>
              <UiButton variant="plain" type="button"
                onClick={() => setShowCreateModal(true)}
                className="bg-nw-ok-bg text-nw-text font-bold px-4 py-2 rounded-xl text-xs inline-flex items-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
              >
                <Plus className="w-4 h-4" />
                <span>استلام بضاعة جديد</span>
              </UiButton>
            </Card>
          ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {receipts.map((r) => {
                const isPaid = r.paymentStatus === 'paid';
                const isPartial = r.paymentStatus === 'partially_paid';
                const isCancelled = r.status === 'cancelled';

                return (
                  <FormFields
                    key={r.id}
                    className="nw-purchasing-fields bg-nw-surface border border-nw-border p-4 rounded-2xl shadow-md space-y-3 hover:border-nw-border transition"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-nw-border pb-2">
                      <div>
                        <span className="font-mono font-extrabold text-nw-info text-xs block">
                          {r.receiptNumber}
                        </span>
                        <span className="text-[10px] text-nw-muted font-bold block mt-0.5">
                          {r.supplierName}
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                          isCancelled
                            ? 'bg-nw-bad-bg text-nw-bad border-nw-border'
                            : isPaid
                            ? 'bg-nw-ok-bg text-nw-ok border-nw-border'
                            : isPartial
                            ? 'bg-nw-warn-bg text-nw-warn border-nw-border'
                            : 'bg-nw-bad-bg text-nw-bad border-nw-border'
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
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-nw-muted">
                      <div>
                        <span>المستودع: </span>
                        <strong className="text-nw-text">{r.warehouseName}</strong>
                      </div>
                      <div>
                        <span>فاتورة المورد: </span>
                        <strong className="text-nw-text">{r.supplierInvoiceNumber || 'غير متاح'}</strong>
                      </div>
                      <div>
                        <span>عدد الأصناف: </span>
                        <strong className="text-nw-text">{r.items?.length || 0} صنف</strong>
                      </div>
                      <div>
                        <span>التاريخ: </span>
                        <strong className="text-nw-text">
                          {formatUiDate(r.receivedAt, {year:'numeric',month:'numeric',day:'numeric'})}
                        </strong>
                      </div>
                    </div>

                    {/* Financial Numbers */}
                    <div className="bg-nw-bg p-2.5 rounded-xl border border-nw-border space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-nw-muted font-bold">الإجمالي:</span>
                        <span className="font-extrabold text-nw-text font-mono">
                          {formatJod(Number(minorToJod(r.totalInMinorUnits)))} {CURRENCY}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-nw-muted font-bold">المدفوع:</span>
                        <span className="font-bold text-nw-ok font-mono">
                          {formatJod(Number(minorToJod(r.amountPaidInMinorUnits)))} {CURRENCY}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-nw-border pt-1">
                        <span className="text-nw-muted font-bold">المتبقي للمورد:</span>
                        <span className="font-extrabold text-nw-bad font-mono">
                          {formatJod(Number(minorToJod(r.amountDueInMinorUnits)))} {CURRENCY}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-1 pt-1 border-t border-nw-border">
                      <UiButton variant="plain" type="button"
                        onClick={() => void handleViewReceiptDetails(r)}
                        className="bg-nw-surface-2 text-nw-info hover:bg-nw-surface-2 px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1 h-auto min-h-11 min-w-0 whitespace-normal"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>عرض التفاصيل</span>
                      </UiButton>

                      <div className="flex items-center gap-1">
                        {r.status === 'completed' && (
                          <UiButton variant="plain" type="button"
                            onClick={() => setCancellationReceipt(r)}
                            className="flex items-center gap-1 rounded-xl border border-nw-border bg-nw-bad-bg px-2.5 py-1.5 text-[10px] font-bold text-nw-bad transition hover:bg-nw-bad-bg h-auto min-h-11 min-w-0 whitespace-normal"
                            title="إلغاء السند وعكس المخزون"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </UiButton>
                        )}

                        {r.status === 'completed' &&
                          r.amountDueInMinorUnits > 0 && (
                            <UiButton variant="plain" type="button"
                              onClick={() => setPaymentModalReceipt(r)}
                              className="bg-nw-ok-bg text-nw-ok border border-nw-border hover:bg-nw-ok-bg px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1 h-auto min-h-11 min-w-0 whitespace-normal"
                            >
                              <DollarSign className="w-3.5 h-3.5 text-nw-ok" />
                              <span>سداد دفعة</span>
                            </UiButton>
                          )}
                      </div>
                    </div>
                  </FormFields>
                );
              })}
            </div>
            {receiptTotalCount > 0 && (
              <Card padded={false} className="flex items-center justify-between rounded-2xl border border-nw-border bg-nw-surface p-2 text-[11px] font-bold text-nw-muted">
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setReceiptPage((current) => Math.max(1, current - 1))}
                  disabled={receiptPage <= 1 || loading}
                  className="inline-flex items-center gap-1 rounded-xl bg-nw-surface-2 px-3 py-2 text-nw-text disabled:opacity-40 h-auto min-h-11 min-w-0 whitespace-normal"
                >
                  <ChevronRight className="h-4 w-4" /> السابق
                </UiButton>
                <span>{receiptPage} / {receiptTotalPages} · {receiptTotalCount} سند</span>
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setReceiptPage((current) => Math.min(receiptTotalPages, current + 1))}
                  disabled={receiptPage >= receiptTotalPages || loading}
                  className="inline-flex items-center gap-1 rounded-xl bg-nw-surface-2 px-3 py-2 text-nw-text disabled:opacity-40 h-auto min-h-11 min-w-0 whitespace-normal"
                >
                  التالي <ChevronLeft className="h-4 w-4" />
                </UiButton>
              </Card>
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
    </FormFields>
  );
};
