/**
 * Nawasrah Business Manager - Interactive Products & Inventory Catalog
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product, ProductStatus } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import {
  Package,
  Search,
  Plus,
  Grid,
  List,
  AlertCircle,
  Tag,
  Barcode,
  Copy,
  Edit,
  Eye,
  EyeOff,
  Trash2,
  Calendar,
  Layers,
  MoreVertical,
  Scale,
  SlidersHorizontal,
  Check,
  Truck,
  RefreshCw,
  Database,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const ProductsView: React.FC = () => {
  const {
    products,
    categories,
    brands,
    openModal,
    deleteProduct,
    hideProduct,
    duplicateProduct,
    productsSource,
    isProductsLoading,
    productsError,
    supabaseDiagnostics,
    refreshProductsFromSupabase,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'price_desc' | 'price_asc' | 'qty_desc' | 'qty_asc'>('name');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showWholesaleInfo, setShowWholesaleInfo] = useState<boolean>(true);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Filter Logic
  let filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'all' ? true : p.categoryId === selectedCategory;

    let matchesStatus = true;
    if (selectedStatusFilter === 'low_stock') {
      matchesStatus = p.availableQuantity <= p.reorderLevel && p.availableQuantity > 0;
    } else if (selectedStatusFilter === 'out_of_stock') {
      matchesStatus = p.availableQuantity === 0;
    } else if (selectedStatusFilter === 'hidden') {
      matchesStatus = p.status === 'hidden';
    } else if (selectedStatusFilter === 'near_expiry') {
      matchesStatus = p.status === 'near_expiry';
    }

    const query = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !query ||
      p.nameAr.toLowerCase().includes(query) ||
      (p.nameEn && p.nameEn.toLowerCase().includes(query)) ||
      p.barcode.includes(query) ||
      p.sku.toLowerCase().includes(query);

    return matchesCategory && matchesStatus && matchesQuery;
  });

  // Sort Logic
  filteredProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === 'price_desc') return b.retailPrice - a.retailPrice;
    if (sortBy === 'price_asc') return a.retailPrice - b.retailPrice;
    if (sortBy === 'qty_desc') return b.availableQuantity - a.availableQuantity;
    if (sortBy === 'qty_asc') return a.availableQuantity - b.availableQuantity;
    return a.nameAr.localeCompare(b.nameAr, 'ar');
  });

  const getStatusBadge = (status: ProductStatus, available: number, reorder: number) => {
    if (status === 'hidden') {
      return { label: 'مخفي 👁️‍🗨️', color: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
    if (available === 0) {
      return { label: 'نافد بالمخزن 🔴', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    }
    if (available <= reorder) {
      return { label: 'مخزون منخفض ⚠️', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    }
    if (status === 'near_expiry') {
      return { label: 'قريب الانتهاء ⏳', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
    }
    return { label: 'متوفر 🟢', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  };

  return (
    <div className="p-3 space-y-3 pb-24 text-xs">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-400" />
              <span>إدارة الأصناف والمخزون</span>
            </h2>

            {/* Supabase Status Pill */}
            <span
              className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                productsSource === 'supabase'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              <Database className="w-3 h-3" />
              <span>{productsSource === 'supabase' ? 'Supabase حقيقي' : 'بيانات تجريبية (Fallback)'}</span>
            </span>
          </div>

          <p className="text-[10px] text-slate-400 mt-0.5">
            إجمالي الأصناف: <strong className="text-slate-200">{(products || []).length}</strong> صنف
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => refreshProductsFromSupabase()}
            disabled={isProductsLoading}
            title="إعادة جلب من Supabase"
            className="bg-slate-900 hover:bg-slate-800 text-slate-300 p-2 rounded-xl border border-slate-800 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProductsLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={() => openModal('receive_goods')}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-2 rounded-xl text-[11px] font-bold transition flex items-center gap-1 shadow active:scale-95"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>استلام بضاعة</span>
          </button>

          <button
            onClick={() => openModal('add_product')}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة صنف</span>
          </button>
        </div>
      </div>

      {/* Supabase Diagnostic Badge Bar */}
      <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-2xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-300 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-blue-400" />
              <span>تشخيص الاتصال:</span>
            </span>

            {/* URL Scheme Pill */}
            <span
              className={`px-2 py-0.5 rounded-md border font-semibold ${
                supabaseDiagnostics?.isValidUrlScheme
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}
            >
              URL: {supabaseDiagnostics?.isValidUrlScheme ? 'صالح (https://)' : 'غير صالح'}
            </span>

            {/* Key Pill */}
            <span
              className={`px-2 py-0.5 rounded-md border font-semibold ${
                supabaseDiagnostics?.hasKey
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-400 border-red-500/30'
              }`}
            >
              Key: {supabaseDiagnostics?.hasKey ? 'موجود' : 'مفقود'}
            </span>

            {/* Auth Session Pill */}
            <span
              className={`px-2 py-0.5 rounded-md border font-semibold ${
                supabaseDiagnostics?.authSessionStatus === 'authenticated'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              جلسة المصادقة: {supabaseDiagnostics?.authSessionStatus === 'authenticated' ? 'مُسجّل الدخول' : 'زائر (unauthenticated)'}
            </span>

            {/* Query Status Pill */}
            <span
              className={`px-2 py-0.5 rounded-md border font-semibold ${
                supabaseDiagnostics?.productsQueryStatus === 'success'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : supabaseDiagnostics?.productsQueryStatus === 'failed'
                  ? 'bg-red-500/10 text-red-400 border-red-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              استعلام الأصناف: {supabaseDiagnostics?.productsQueryStatus === 'success' ? 'ناجح (success)' : supabaseDiagnostics?.productsQueryStatus === 'failed' ? 'فشل (failed)' : 'قيد التحميل'}
            </span>
          </div>

          <button
            onClick={() => refreshProductsFromSupabase()}
            disabled={isProductsLoading}
            className="text-[10px] font-bold bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-lg transition flex items-center gap-1 active:scale-95"
          >
            <RefreshCw className={`w-3 h-3 ${isProductsLoading ? 'animate-spin' : ''}`} />
            <span>إعادة الفحص</span>
          </button>
        </div>

        {/* Detailed Supabase Error Card if Failed */}
        {(supabaseDiagnostics?.productsQueryStatus === 'failed' || productsError) && (
          <div className="bg-red-500/10 border border-red-500/30 p-3 rounded-xl space-y-1.5 text-red-300 text-[11px] mt-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 font-black text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>خطأ استعلام Supabase الحقيقي</span>
              </div>
              <button
                onClick={() => refreshProductsFromSupabase()}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-2 py-0.5 rounded text-[10px] transition"
              >
                إعادة المحاولة
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-slate-950/60 p-2 rounded-lg font-mono text-[10px]">
              <div>
                <span className="text-slate-400 block">رمز الخطأ (error.code):</span>
                <strong className="text-amber-300">{supabaseDiagnostics?.productsErrorCode || 'غير محدد'}</strong>
              </div>
              <div>
                <span className="text-slate-400 block">الحالة (status):</span>
                <strong className="text-amber-300">{String(supabaseDiagnostics?.productsErrorStatus || 'N/A')}</strong>
              </div>
              <div>
                <span className="text-slate-400 block">جلسة Auth:</span>
                <strong className="text-slate-200">{supabaseDiagnostics?.authSessionStatus}</strong>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-300">رسالة الخطأ (error.message):</span>
              <p className="bg-slate-950/80 p-2 rounded text-red-200 font-mono mt-0.5 select-all">
                {supabaseDiagnostics?.productsErrorMessage || productsError || 'حدث خطأ أثناء الاتصال بالخادم.'}
              </p>
            </div>

            {supabaseDiagnostics?.productsErrorDetails && (
              <div>
                <span className="font-bold text-slate-400">التفاصيل (error.details):</span>
                <p className="text-slate-300 font-mono text-[10px]">{supabaseDiagnostics.productsErrorDetails}</p>
              </div>
            )}

            {supabaseDiagnostics?.productsErrorHint && (
              <div>
                <span className="font-bold text-slate-400">ملاحظة الخادم (error.hint):</span>
                <p className="text-slate-300 font-mono text-[10px]">{supabaseDiagnostics.productsErrorHint}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auxiliary Management Buttons (Categories, Brands, Units) */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => openModal('manage_categories')}
          className="bg-slate-950 border border-slate-800 hover:border-slate-700 py-2 rounded-xl text-slate-300 font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
        >
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span>الأقسام ({(categories || []).length})</span>
        </button>

        <button
          onClick={() => openModal('manage_brands')}
          className="bg-slate-950 border border-slate-800 hover:border-slate-700 py-2 rounded-xl text-slate-300 font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
        >
          <Tag className="w-3.5 h-3.5 text-amber-400" />
          <span>العلامات ({(brands || []).length})</span>
        </button>

        <button
          onClick={() => openModal('manage_units')}
          className="bg-slate-950 border border-slate-800 hover:border-slate-700 py-2 rounded-xl text-slate-300 font-bold flex items-center justify-center gap-1.5 transition active:scale-95"
        >
          <Scale className="w-3.5 h-3.5 text-emerald-400" />
          <span>وحدات القياس</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="ابحث باسم المنتج، الباركود، أو رمز SKU..."
          className="w-full bg-slate-950 border border-slate-800 rounded-2xl pr-9 pl-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
        />
      </div>

      {/* Category Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar font-bold">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-xl shrink-0 transition border ${
            selectedCategory === 'all'
              ? 'bg-blue-600 text-white border-blue-500 shadow'
              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          الكل ({(products || []).length})
        </button>
        {(categories || []).map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCategory(c.id)}
            className={`px-3 py-1.5 rounded-xl shrink-0 transition border ${
              selectedCategory === c.id
                ? 'bg-blue-600 text-white border-blue-500 shadow'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {c.nameAr}
          </button>
        ))}
      </div>

      {/* Filters & Controls Toolbar */}
      <div className="flex items-center justify-between gap-2 bg-slate-950 p-2 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2">
          {/* Status Filter */}
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] focus:outline-none"
          >
            <option value="all">كل الحالات</option>
            <option value="low_stock">مخزون منخفض ⚠️</option>
            <option value="out_of_stock">نافد بالرف 🔴</option>
            <option value="hidden">أصناف مخفية 👁️‍🗨️</option>
          </select>

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-900 border border-slate-800 text-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] focus:outline-none"
          >
            <option value="name">ترتيب بالاسم</option>
            <option value="price_desc">السعر: الأعلى أولاً</option>
            <option value="price_asc">السعر: الأقل أولاً</option>
            <option value="qty_desc">الكمية: الأكثر أولاً</option>
            <option value="qty_asc">الكمية: الأقل أولاً</option>
          </select>
        </div>

        {/* View Mode & Wholesale Info Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowWholesaleInfo(!showWholesaleInfo)}
            className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-bold transition flex items-center gap-1 ${
              showWholesaleInfo
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="إظهار/إخفاء أعمدة وأسعار طرود الجملة والربح"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">أعمدة طرود الجملة</span>
          </button>

          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition ${
                viewMode === 'grid' ? 'bg-slate-800 text-blue-400' : 'text-slate-500'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition ${
                viewMode === 'list' ? 'bg-slate-800 text-blue-400' : 'text-slate-500'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {filteredProducts.length === 0 && (
        <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 text-center space-y-3 my-4">
          <div className="w-12 h-12 rounded-full bg-slate-900 text-slate-500 flex items-center justify-center mx-auto border border-slate-800">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <h4 className="font-extrabold text-slate-200 text-sm">لا توجد أصناف تطابق البحث</h4>
            <p className="text-[10px] text-slate-500">جرّب إلغاء التصفية أو أضف صنفًا جديدًا الآن</p>
          </div>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setSelectedStatusFilter('all');
            }}
            className="bg-slate-900 hover:bg-slate-800 text-blue-400 font-bold px-4 py-2 rounded-xl border border-slate-800 transition"
          >
            إعادة تعيين البحث
          </button>
        </div>
      )}

      {/* Grid Layout */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 gap-2.5">
          {filteredProducts.map((prod) => {
            const badge = getStatusBadge(prod.status, prod.availableQuantity, prod.reorderLevel);

            return (
              <div
                key={prod.id}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 p-2.5 rounded-2xl shadow transition relative flex flex-col justify-between"
              >
                <div>
                  {/* Card Image & Badges */}
                  <div
                    onClick={() => openModal('view_product', prod)}
                    className="relative mb-2 cursor-pointer group"
                  >
                    <img
                      src={prod.imageUrl}
                      alt={prod.nameAr}
                      className="w-full h-24 rounded-xl object-cover border border-slate-800"
                    />
                    <span
                      className={`absolute top-1.5 right-1.5 text-[9px] font-extrabold px-2 py-0.5 rounded-full border shadow ${badge.color}`}
                    >
                      {badge.label}
                    </span>

                    {/* 3-Dots Quick Popup Trigger */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === prod.id ? null : prod.id);
                      }}
                      className="absolute top-1.5 left-1.5 bg-slate-950/80 hover:bg-slate-900 text-slate-200 p-1 rounded-full border border-slate-700 shadow"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Context Popup Menu */}
                  {activeMenuId === prod.id && (
                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-1 shadow-2xl space-y-0.5 mb-2 animate-fadeIn z-10">
                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          openModal('view_product', prod);
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-slate-800 rounded-lg text-slate-200 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <Eye className="w-3 h-3 text-blue-400" />
                        <span>عرض التفاصيل الكاملة</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          openModal('edit_product', prod);
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-slate-800 rounded-lg text-slate-200 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <Edit className="w-3 h-3 text-emerald-400" />
                        <span>تعديل الصنف</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          openModal('adjust_stock', { product: prod, mode: 'add' });
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-slate-800 rounded-lg text-slate-200 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <Plus className="w-3 h-3 text-cyan-400" />
                        <span>تعديل الكمية بالمخزون</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          duplicateProduct(prod.id);
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-slate-800 rounded-lg text-slate-200 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <Copy className="w-3 h-3 text-amber-400" />
                        <span>تكرار الصنف (نسخة)</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          hideProduct(prod.id);
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-slate-800 rounded-lg text-slate-200 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <EyeOff className="w-3 h-3 text-purple-400" />
                        <span>{prod.status === 'hidden' ? 'إظهار بالكتالوج' : 'إخفاء عن الكتالوج'}</span>
                      </button>

                      <button
                        onClick={() => {
                          setActiveMenuId(null);
                          if (confirm(`هل أنت تأكد من حذف الصنف ${prod.nameAr}؟`)) {
                            deleteProduct(prod.id);
                          }
                        }}
                        className="w-full text-right px-2 py-1.5 hover:bg-red-950/60 rounded-lg text-red-400 text-[10px] font-bold flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>حذف الصنف</span>
                      </button>
                    </div>
                  )}

                  {/* Product Title & Info */}
                  <div onClick={() => openModal('view_product', prod)} className="cursor-pointer space-y-0.5">
                    <h4 className="text-xs font-extrabold text-slate-100 truncate">{prod.nameAr}</h4>
                    <span className="text-[10px] text-slate-400 block font-mono">{prod.sku}</span>
                  </div>
                </div>

                {/* Footer Prices & Optional Wholesale Metrics */}
                <div
                  onClick={() => openModal('view_product', prod)}
                  className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] text-slate-500 block">سعر البيع:</span>
                      <strong className="font-black text-blue-400 text-xs">
                        {prod.retailPrice.toFixed(3)} {CURRENCY}
                      </strong>
                    </div>
                    <div className="text-left">
                      <span className="text-[9px] text-slate-500 block">المتاح بالمخزن:</span>
                      {(() => {
                        const inv = formatProductInventory(prod, true);
                        return (
                          <div>
                            <strong className="font-extrabold text-amber-300 text-xs block">{inv.cartonFormatted}</strong>
                            <span className="text-[10px] text-slate-400 font-bold block">{inv.totalPiecesFormatted}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {showWholesaleInfo && (
                    <div className="bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 text-[10px] space-y-0.5">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>طرد الشراء: <strong className="text-slate-200">{prod.purchasePackage || 'كرتونة'} ({prod.unitsPerPackage || 24} قطعة)</strong></span>
                        <span>التكلفة/قطعة: <strong className="text-amber-400">{prod.costPrice.toFixed(3)}</strong></span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>الربح/قطعة: <strong className="text-emerald-400">{(prod.profitPerPiece ?? (prod.retailPrice - prod.costPrice)).toFixed(3)}</strong></span>
                        <span>نسبة الربح: <strong className="text-emerald-400 font-mono">%{(prod.profitPercentage ?? (prod.costPrice > 0 ? (((prod.retailPrice - prod.costPrice) / prod.costPrice) * 100).toFixed(1) : 0))}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Compact List Layout */
        <div className="space-y-2">
          {filteredProducts.map((prod) => {
            const badge = getStatusBadge(prod.status, prod.availableQuantity, prod.reorderLevel);
            const profitVal = (prod.profitPerPiece ?? (prod.retailPrice - prod.costPrice));
            const profitPct = (prod.profitPercentage ?? (prod.costPrice > 0 ? (((prod.retailPrice - prod.costPrice) / prod.costPrice) * 100).toFixed(1) : 0));

            return (
              <div
                key={prod.id}
                onClick={() => openModal('view_product', prod)}
                className="bg-slate-950 border border-slate-800 p-2.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:border-slate-700 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={prod.imageUrl}
                    alt={prod.nameAr}
                    className="w-12 h-12 rounded-xl object-cover border border-slate-800 shrink-0"
                  />
                  <div className="min-w-0">
                    <h4 className="font-extrabold text-slate-100 truncate text-xs">{prod.nameAr}</h4>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {prod.barcode} • {prod.sku}
                    </p>
                    <span className={`inline-block mt-0.5 text-[9px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>

                {showWholesaleInfo && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800 text-[10px] text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[9px]">وحدة الشراء</span>
                      <strong className="text-slate-200">{prod.purchasePackage || 'كرتونة'} ({prod.unitsPerPackage || 24} قطعة)</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">تكلفة القطعة</span>
                      <strong className="text-amber-400">{prod.costPrice.toFixed(3)} {CURRENCY}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">الربح (% / JOD)</span>
                      <strong className="text-emerald-400">{profitVal.toFixed(3)} JOD (%{profitPct})</strong>
                    </div>
                  </div>
                )}

                <div className="text-left shrink-0">
                  <strong className="font-black text-blue-400 text-sm block">
                    {prod.retailPrice.toFixed(3)} {CURRENCY}
                  </strong>
                  {(() => {
                    const inv = formatProductInventory(prod, true);
                    return (
                      <div className="text-[10px] text-left">
                        <strong className="font-extrabold text-amber-300 block">{inv.cartonFormatted}</strong>
                        <span className="text-slate-400 font-bold block">{inv.totalPiecesFormatted}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
