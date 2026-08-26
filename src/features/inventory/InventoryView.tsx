/**
 * Nawasrah Business Manager - Independent Inventory Management View (شاشة إدارة المخزون)
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import { ClearInventoryBalanceDialog } from './ClearInventoryBalanceDialog';
import {
  Boxes,
  Search,
  Filter,
  Building2,
  Warehouse as WarehouseIcon,
  Layers,
  Truck,
  Plus,
  Minus,
  ClipboardCheck,
  History,
  AlertTriangle,
  XCircle,
  Clock,
  CheckCircle2,
  DollarSign,
  Package,
  Calendar,
  ChevronLeft,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const InventoryView: React.FC = () => {
  const {
    products,
    branches,
    warehouses,
    categories,
    movements,
    openModal,
    activeBranch,
    refreshInventoryMovementsFromSupabase,
  } = useAppStore();

  useEffect(() => {
    refreshInventoryMovementsFromSupabase();
  }, [refreshInventoryMovementsFromSupabase]);

  // Active Tab: 'products' (الأصناف والمخزون) vs 'movements' (سجل الحركات)
  const [activeTab, setActiveTab] = useState<'products' | 'movements'>('products');

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Selected product for movement history modal inside this view
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [clearInventoryProduct, setClearInventoryProduct] =
    useState<Product | null>(null);
  // Flavor masters are commercial cards only. Their child flavors are the
  // actual inventory rows shown and counted here.
  const inventoryProducts = products.filter((product) => !product.isFlavorMaster);

  // Calculate Metrics
  const totalCostValue = inventoryProducts.reduce((acc, p) => acc + (p.costPrice * p.onHandQuantity), 0);
  const totalRetailValue = inventoryProducts.reduce((acc, p) => acc + (p.retailPrice * p.onHandQuantity), 0);
  const totalItemCount = inventoryProducts.length;

  const lowStockProducts = inventoryProducts.filter(
    (p) => p.availableQuantity > 0 && p.availableQuantity <= p.reorderLevel
  );
  const outOfStockProducts = inventoryProducts.filter((p) => p.availableQuantity <= 0);

  // Near expiry (e.g. within 30 days)
  const now = new Date().getTime();
  const nearExpiryProducts = inventoryProducts.filter((p) => {
    if (!p.expiryDate) return false;
    const expTime = new Date(p.expiryDate).getTime();
    const diffDays = (expTime - now) / (1000 * 3600 * 24);
    return diffDays >= 0 && diffDays <= 30;
  });

  // Stagnant / slow moving products: no sales in movements or onHand == opening
  const stagnantProducts = inventoryProducts.filter((p) => {
    const hasSaleMovements = movements.some(
      (m) => m.productId === p.id && m.movementType === 'Sale'
    );
    return !hasSaleMovements && p.onHandQuantity > 0;
  });

  // Filtered Products List
  const filteredProducts = inventoryProducts.filter((product) => {
    // Search query match
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      product.nameAr.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.barcode.toLowerCase().includes(q);

    // Branch match
    const matchesBranch =
      selectedBranchId === 'all' || product.branchId === selectedBranchId;

    // Warehouse match
    const matchesWarehouse =
      selectedWarehouseId === 'all' || product.warehouseId === selectedWarehouseId;

    // Category match
    const matchesCategory =
      selectedCategoryId === 'all' || product.categoryId === selectedCategoryId;

    // Status filter match
    let matchesStatus = true;
    if (statusFilter === 'low_stock') {
      matchesStatus =
        product.availableQuantity > 0 &&
        product.availableQuantity <= product.reorderLevel;
    } else if (statusFilter === 'out_of_stock') {
      matchesStatus = product.availableQuantity <= 0;
    } else if (statusFilter === 'near_expiry') {
      if (!product.expiryDate) matchesStatus = false;
      else {
        const expTime = new Date(product.expiryDate).getTime();
        const diffDays = (expTime - now) / (1000 * 3600 * 24);
        matchesStatus = diffDays >= 0 && diffDays <= 30;
      }
    } else if (statusFilter === 'damaged') {
      matchesStatus = product.status === 'expired' || product.status === 'discontinued';
    } else if (statusFilter === 'stagnant') {
      const hasSales = movements.some((m) => m.productId === product.id && m.movementType === 'Sale');
      matchesStatus = !hasSales && product.onHandQuantity > 0;
    }

    return matchesSearch && matchesBranch && matchesWarehouse && matchesCategory && matchesStatus;
  });

  // Filtered Movements List
  const filteredMovements = movements.filter((mov) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      mov.productName.toLowerCase().includes(q) ||
      mov.reason.toLowerCase().includes(q) ||
      mov.movementType.toLowerCase().includes(q);

    const matchesBranch = selectedBranchId === 'all' || mov.branchId === selectedBranchId;
    const matchesWarehouse = selectedWarehouseId === 'all' || mov.warehouseId === selectedWarehouseId;

    return matchesSearch && matchesBranch && matchesWarehouse;
  });

  // Product Movement History Helper
  const getProductMovements = (pId: string) => {
    return movements.filter((m) => m.productId === pId);
  };

  return (
    <div className="p-4 space-y-4 pb-28">
      {/* Top Bar / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-100 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-indigo-400" />
            <span>المخزون</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            استلم البضاعة أو راقب المتاح؛ كل تعديل محفوظ بحركة موثقة.
          </p>
        </div>

        {/* Action Buttons Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => openModal('receive_goods')}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow"
          >
            <Truck className="w-4 h-4" />
            <span>استلام بضاعة</span>
          </button>
          <details className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-300 marker:hidden">
              إدارة
              <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
            </summary>
            <div className="absolute left-0 z-20 mt-2 w-52 space-y-1 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
              <button
                onClick={() => openModal('stock_count')}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                <ClipboardCheck className="h-4 w-4 text-purple-400" />
                جرد منتج
              </button>
              <button
                onClick={() => openModal('inventory_opening_setup')}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-xs font-bold text-emerald-300 hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-4 w-4" />
                تهيئة المخزون الافتتاحي
              </button>
            </div>
          </details>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-950/20 p-3 text-xs">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <div>
          <strong className="text-cyan-200">الرصيد يتغير تلقائيًا</strong>
          <p className="mt-1 leading-5 text-slate-400">
            الاستلام يزيده، تسليم الطلب ينقصه، والجرد وحده يصحح أي فرق مع حفظ السبب.
          </p>
        </div>
      </div>

      {/* 1. Metrics Grid (7 Dashboard Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {/* Total Value */}
        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-2xl col-span-2 sm:col-span-2 lg:col-span-2 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold block">إجمالي قيمة المخزون والتكلفة</span>
            <div className="flex items-baseline gap-2">
              <strong className="text-sm font-extrabold text-emerald-400">
                {totalCostValue.toLocaleString('ar-JO')} {CURRENCY}
              </strong>
              <span className="text-[9px] text-slate-400">
                (البيع: {totalRetailValue.toLocaleString('ar-JO')} {CURRENCY})
              </span>
            </div>
          </div>
        </div>

        {/* Total Items */}
        <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-2xl flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">عدد الأصناف</span>
            <strong className="text-sm font-extrabold text-slate-100">{totalItemCount} صنف</strong>
          </div>
        </div>

        {/* Low Stock */}
        <button
          onClick={() => setStatusFilter(statusFilter === 'low_stock' ? 'all' : 'low_stock')}
          className={`p-2.5 rounded-2xl border text-right transition flex items-center gap-2.5 ${
            statusFilter === 'low_stock'
              ? 'bg-amber-950/60 border-amber-600 text-amber-200'
              : 'bg-slate-900 border-slate-800 hover:border-amber-500/50'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">منخفض المخزون</span>
            <strong className="text-sm font-extrabold text-amber-400">{lowStockProducts.length}</strong>
          </div>
        </button>

        {/* Out of Stock */}
        <button
          onClick={() => setStatusFilter(statusFilter === 'out_of_stock' ? 'all' : 'out_of_stock')}
          className={`p-2.5 rounded-2xl border text-right transition flex items-center gap-2.5 ${
            statusFilter === 'out_of_stock'
              ? 'bg-rose-950/60 border-rose-600 text-rose-200'
              : 'bg-slate-900 border-slate-800 hover:border-rose-500/50'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center shrink-0">
            <XCircle className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">نافد المخزون</span>
            <strong className="text-sm font-extrabold text-rose-400">{outOfStockProducts.length}</strong>
          </div>
        </button>

        <details className="col-span-2 group rounded-2xl border border-slate-800 bg-slate-900 p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-bold text-slate-400 marker:hidden">
            تنبيهات إضافية: صلاحية وركود
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
        {/* Near Expiry */}
        <button
          onClick={() => setStatusFilter(statusFilter === 'near_expiry' ? 'all' : 'near_expiry')}
          className={`p-2.5 rounded-2xl border text-right transition flex items-center gap-2.5 ${
            statusFilter === 'near_expiry'
              ? 'bg-orange-950/60 border-orange-600 text-orange-200'
              : 'bg-slate-900 border-slate-800 hover:border-orange-500/50'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">قريب انتهاء الصلاحية</span>
            <strong className="text-sm font-extrabold text-orange-400">{nearExpiryProducts.length}</strong>
          </div>
        </button>

        {/* Damaged & Stagnant */}
        <button
          onClick={() => setStatusFilter(statusFilter === 'stagnant' ? 'all' : 'stagnant')}
          className={`p-2.5 rounded-2xl border text-right transition flex items-center gap-2.5 ${
            statusFilter === 'stagnant'
              ? 'bg-purple-950/60 border-purple-600 text-purple-200'
              : 'bg-slate-900 border-slate-800 hover:border-purple-500/50'
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">المنتجات الراكدة</span>
            <strong className="text-sm font-extrabold text-purple-300">{stagnantProducts.length}</strong>
          </div>
        </button>
          </div>
        </details>
      </div>

      {/* 2. Main Navigation Tabs */}
      <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800">
        <button
          onClick={() => setActiveTab('products')}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'products'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>المتاح الآن ({filteredProducts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 ${
            activeTab === 'movements'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>سجل الحركات ({filteredMovements.length})</span>
        </button>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl space-y-3">
        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المنتج، الكود SKU، أو الباركود..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2.5 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 font-semibold"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold"
            >
              إلغاء
            </button>
          )}
        </div>

        <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-slate-400 marker:hidden">
            تصفية وبحث متقدم
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
        {/* Dropdown Filters */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {/* Branch Filter */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
              <Building2 className="w-3 h-3 text-blue-400" />
              <span>الفرع:</span>
            </label>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 text-xs focus:outline-none"
            >
              <option value="all">جميع الفروع ({branches.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Warehouse Filter */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
              <WarehouseIcon className="w-3 h-3 text-indigo-400" />
              <span>المستودع:</span>
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 text-xs focus:outline-none"
            >
              <option value="all">جميع المستودعات ({warehouses.length})</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
              <Layers className="w-3 h-3 text-teal-400" />
              <span>القسم:</span>
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 text-xs focus:outline-none"
            >
              <option value="all">جميع الأقسام ({categories.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>

          {/* Status Quick Filter Tabs */}
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 font-bold block flex items-center gap-1">
              <Filter className="w-3 h-3 text-amber-400" />
              <span>حالة المخزون:</span>
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 text-xs focus:outline-none font-bold"
            >
              <option value="all">الكل (جميع الحالات)</option>
              <option value="low_stock">منخفض المخزون ⚠️</option>
              <option value="out_of_stock">نافد المخزون ❌</option>
              <option value="near_expiry">قريب انتهاء الصلاحية 📅</option>
              <option value="stagnant">منتجات راكدة 💤</option>
            </select>
          </div>
        </div>
        </details>
      </div>

      {/* TAB 1: PRODUCTS INVENTORY TAB */}
      {activeTab === 'products' && (
        <div className="space-y-3">
          {filteredProducts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
              <Package className="w-10 h-10 text-slate-600 mx-auto" />
              <h4 className="font-bold text-slate-300 text-sm">لا توجد منتجات تطابق الفلاتر المحددة</h4>
              <p className="text-xs text-slate-500">جرب تغيير شروط البحث أو اختيار فرع ومستودع آخر</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedBranchId('all');
                  setSelectedWarehouseId('all');
                  setSelectedCategoryId('all');
                  setStatusFilter('all');
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition inline-block"
              >
                إعادة ضبط جميع الفلاتر
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredProducts.map((product) => {
                const branchName =
                  branches.find((b) => b.id === product.branchId)?.name ||
                  activeBranch.name;
                const warehouseName =
                  warehouses.find((w) => w.id === product.warehouseId)?.name || 'المستودع الرئيسي';
                const categoryName =
                  categories.find((c) => c.id === product.categoryId)?.nameAr || 'عام';

                const isLow =
                  product.availableQuantity > 0 &&
                  product.availableQuantity <= product.reorderLevel;
                const isOut = product.availableQuantity <= 0;

                return (
                  <div
                    key={product.id}
                    className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow hover:border-slate-700 transition space-y-3 flex flex-col justify-between"
                  >
                    {/* Header: Product Info */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <img
                            src={product.imageUrl}
                            alt=""
                            className="w-12 h-12 rounded-xl object-cover border border-slate-800 shrink-0"
                          />
                          <div>
                            <h4 className="font-extrabold text-slate-100 text-xs line-clamp-1">
                              {product.nameAr}
                            </h4>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                              <span>SKU: {product.sku}</span>
                              <span>|</span>
                              <span>الباركود: {product.barcode}</span>
                            </div>
                            <span className="inline-block mt-1 bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md text-[9px] font-semibold">
                              القسم: {categoryName}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isOut ? (
                            <span className="bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full text-[9px] font-extrabold block whitespace-nowrap">
                              نافد المخزون
                            </span>
                          ) : isLow ? (
                            <span className="bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full text-[9px] font-extrabold block whitespace-nowrap">
                              منخفض
                            </span>
                          ) : (
                            <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full text-[9px] font-bold block whitespace-nowrap">
                              متوفر
                            </span>
                          )}
                        </div>
                      </div>

                      {(() => {
                        const invAvailable = formatProductInventory(product, true);
                        return (
                          <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-2.5 text-center">
                            <span className="block text-[9px] font-bold text-emerald-200/70">المتاح للبيع الآن</span>
                            <strong className="mt-0.5 block text-sm font-black text-emerald-300">
                              {invAvailable.fullFormatted}
                            </strong>
                            {product.reservedQuantity > 0 && (
                              <span className="mt-1 block text-[9px] text-amber-300">
                                محجوز للطلبات: {product.reservedQuantity} قطعة
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-bold text-slate-400 marker:hidden">
                          تفاصيل الصنف والرصد
                          <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
                        </summary>
                        <div className="mt-2 space-y-2">
                      {/* Branch & Warehouse Tags */}
                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/80 flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-1 text-slate-300">
                          <Building2 className="w-3.5 h-3.5 text-blue-400" />
                          <span>{branchName}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-300">
                          <WarehouseIcon className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{warehouseName}</span>
                        </div>
                        {product.warehouseLocation && (
                          <span className="text-slate-400 font-mono">
                            رف: {product.warehouseLocation}
                          </span>
                        )}
                      </div>

                      {/* Quantities Table Breakdown */}
                      <div className="grid grid-cols-4 gap-1.5 text-center bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                        {/* Actual Stock */}
                        {(() => {
                          const invOnHand = formatProductInventory(product, false);
                          const invAvail = formatProductInventory(product, true);
                          return (
                            <>
                              <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                                <span className="text-[9px] text-slate-400 block font-bold">الفعلي</span>
                                <strong className="text-[11px] font-black text-amber-300 block">
                                  {invOnHand.cartonFormatted}
                                </strong>
                                <span className="text-[10px] text-slate-400 font-bold block">{invOnHand.totalPiecesFormatted}</span>
                              </div>

                              {/* Reserved Stock */}
                              <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                                <span className="text-[9px] text-amber-400 block font-bold">المحجوز</span>
                                <strong className="text-xs font-black text-amber-400 block">
                                  {product.reservedQuantity} قطعة
                                </strong>
                              </div>

                              {/* Available Stock */}
                              <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                                <span className="text-[9px] text-emerald-400 block font-bold">المتاح</span>
                                <strong className="text-[11px] font-black text-emerald-400 block">
                                  {invAvail.cartonFormatted}
                                </strong>
                                <span className="text-[10px] text-emerald-300/80 font-bold block">{invAvail.totalPiecesFormatted}</span>
                              </div>
                            </>
                          );
                        })()}

                        {/* Reorder Level */}
                        <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                          <span className="text-[9px] text-slate-400 block font-bold">حد التنبيه</span>
                          <strong className="text-xs font-bold text-slate-300">
                            {product.reorderLevel}
                          </strong>
                        </div>
                      </div>
                        </div>
                      </details>
                    </div>

                    {/* Action Bar per Product */}
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* 1. Receive Goods */}
                        <button
                          onClick={() => openModal('receive_goods')}
                          className="bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-800/80 p-1.5 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center gap-0.5 transition"
                          title="استلام بضاعة جديدة"
                        >
                          <Truck className="w-3.5 h-3.5" />
                          <span>استلام</span>
                        </button>

                        {/* 2. Stock Count: the only controlled correction path */}
                        <button
                          onClick={() => openModal('stock_count', { productId: product.id })}
                          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 p-1.5 rounded-lg text-[10px] font-bold flex flex-col items-center justify-center gap-0.5 transition"
                          title="جرد مطابقة المخزون"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5 text-purple-400" />
                          <span>جرد</span>
                        </button>
                      </div>

                      <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-bold text-slate-400 marker:hidden">
                          سجل الحركات وإدارة الرصيد
                          <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
                        </summary>
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5">
                        {/* View Movement Log */}
                        <button
                          onClick={() => setHistoryProduct(product)}
                          className="bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 px-2 py-1.5 rounded-xl text-[10px] font-bold transition flex items-center justify-center gap-1.5"
                        >
                          <History className="w-3.5 h-3.5 text-indigo-400" />
                          <span>
                            سجل الحركات ({getProductMovements(product.id).length})
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setClearInventoryProduct(product)}
                          className="min-w-[92px] rounded-xl border border-rose-800/70 bg-rose-950/40 px-2 py-1.5 text-[10px] font-black text-rose-300 transition hover:bg-rose-950/70 disabled:cursor-not-allowed disabled:opacity-45"
                          title={
                            product.onHandQuantity > 0
                              ? 'تصفير الرصيد مع حفظ حركة تدقيق'
                              : 'الرصيد صفر بالفعل'
                          }
                        >
                          <span className="flex items-center justify-center gap-1">
                            <Trash2 className="h-3.5 w-3.5" />
                            {product.onHandQuantity > 0
                              ? 'حذف الرصيد'
                              : 'الرصيد صفر'}
                          </span>
                        </button>
                      </div>
                      </details>
                  </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {clearInventoryProduct && (
        <ClearInventoryBalanceDialog
          product={clearInventoryProduct}
          warehouseName={
            warehouses.find(
              (warehouse) =>
                warehouse.id === clearInventoryProduct.warehouseId
            )?.name || 'المستودع الرئيسي'
          }
          movementCount={getProductMovements(clearInventoryProduct.id).length}
          onClose={() => setClearInventoryProduct(null)}
        />
      )}

      {/* TAB 2: LIVE MOVEMENTS FEED TAB */}
      {activeTab === 'movements' && (
        <div className="space-y-2">
          {filteredMovements.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-500 text-xs">
              لا توجد حركات مخزون مطابقة للبحث حالياً
            </div>
          ) : (
            filteredMovements.map((mov) => {
              const isPositive = mov.quantityChange >= 0;
              return (
                <div
                  key={mov.id}
                  className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {isPositive ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-slate-100">{mov.productName}</span>
                        <span className="bg-slate-800 border border-slate-700/80 text-indigo-300 text-[10px] px-2 py-0.5 rounded-md font-bold">
                          {mov.movementType}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300">{mov.reason}</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span>المستخدم: {mov.performedByUserName}</span>
                        <span>•</span>
                        <span>
                          {new Date(mov.timestamp).toLocaleDateString('ar-JO')} -{' '}
                          {new Date(mov.timestamp).toLocaleTimeString('ar-JO', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-left sm:text-left pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                    <span
                      className={`text-sm font-black dir-ltr block ${
                        isPositive ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isPositive ? `+${mov.quantityChange}` : mov.quantityChange}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-mono">
                      (القبل: {mov.previousQuantity} ← النتيجة: {mov.newQuantity})
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* PRODUCT MOVEMENT HISTORY MODAL */}
      {historyProduct && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={historyProduct.imageUrl}
                  alt=""
                  className="w-10 h-10 rounded-xl object-cover border border-slate-800"
                />
                <div>
                  <h3 className="font-extrabold text-slate-100 text-xs">{historyProduct.nameAr}</h3>
                  <p className="text-[10px] text-slate-400">
                    الرمز: <span className="font-mono">{historyProduct.sku}</span> | المخزون الحالي: <strong className="text-amber-300 font-bold">{formatProductInventory(historyProduct).fullFormatted}</strong>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setHistoryProduct(null)}
                className="w-8 h-8 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-bold flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: Movements list */}
            <div className="p-4 overflow-y-auto space-y-2 flex-1 text-xs">
              <h4 className="font-bold text-slate-300 text-xs mb-2">سجل الحركات الكاملة لهذا المنتج:</h4>
              {getProductMovements(historyProduct.id).length === 0 ? (
                <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 text-center text-slate-500">
                  لا توجد حركات مسجلة لهذا المنتج بعد
                </div>
              ) : (
                getProductMovements(historyProduct.id).map((m) => (
                  <div key={m.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-indigo-400 text-xs">{m.movementType}</span>
                      <strong className={`font-black ${m.quantityChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.quantityChange >= 0 ? `+${m.quantityChange}` : m.quantityChange}
                      </strong>
                    </div>
                    <p className="text-slate-300 text-[11px]">{m.reason}</p>
                    <div className="flex items-center justify-between text-[9px] text-slate-500 pt-1 border-t border-slate-900">
                      <span>القبل: {m.previousQuantity} → البعد: {m.newQuantity}</span>
                      <span>بواسطة: {m.performedByUserName} | {new Date(m.timestamp).toLocaleString('ar-JO')}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setHistoryProduct(null)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 rounded-xl text-xs"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
