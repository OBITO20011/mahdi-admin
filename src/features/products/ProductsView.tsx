import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  Edit3,
  Eye,
  FolderTree,
  Package,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Tags,
  Truck,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import { useAppStore } from '../../stores/useAppStore';
import { Product, ProductStatus } from '../../types';
import { formatProductInventory } from '../../utils/inventoryFormatter';
import { calculateProductProfit } from '../../utils/productCalculations';

type StatusFilter = 'all' | 'healthy' | 'low_stock' | 'out_of_stock' | 'hidden';
type SortOption = 'name' | 'stock_asc' | 'stock_desc' | 'profit_desc';

const money = (value: number) =>
  `${value.toLocaleString('ar-JO', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  })} ${CURRENCY}`;

export const ProductsView: React.FC = () => {
  const {
    products,
    categories,
    openModal,
    productsSource,
    isProductsLoading,
    productsError,
    refreshProductsFromSupabase,
  } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('name');

  const activeCategories = useMemo(
    () => categories.filter((category) => !category.isHidden),
    [categories]
  );
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.nameAr])),
    [categories]
  );
  const displayProducts = useMemo(
    () =>
      products
        .filter((product) => !product.flavorMasterProductId)
        .map((product) => {
          if (!product.isFlavorMaster) return product;
          const flavors = products.filter(
            (item) => item.flavorMasterProductId === product.id
          );
          return {
            ...product,
            onHandQuantity: flavors.reduce(
              (sum, flavor) => sum + flavor.onHandQuantity,
              0
            ),
            reservedQuantity: flavors.reduce(
              (sum, flavor) => sum + flavor.reservedQuantity,
              0
            ),
            availableQuantity: flavors.reduce(
              (sum, flavor) => sum + flavor.availableQuantity,
              0
            ),
          };
        }),
    [products]
  );

  const metrics = useMemo(() => {
    const lowStock = displayProducts.filter(
      (product) =>
        product.status !== 'hidden' &&
        product.availableQuantity > 0 &&
        product.availableQuantity <= product.reorderLevel
    ).length;
    const outOfStock = displayProducts.filter(
      (product) =>
        product.status !== 'hidden' && product.availableQuantity === 0
    ).length;
    const inventoryCost = displayProducts.reduce(
      (sum, product) =>
        sum + product.costPrice * Math.max(0, product.onHandQuantity),
      0
    );
    const potentialProfit = displayProducts.reduce(
      (sum, product) => {
        if (!product.salePackagePrice || !product.saleUnitId) return sum;
        return (
          sum +
          Math.max(
            0,
            product.salePackagePrice /
              (product.unitsPerSalePackage || 1) -
              product.costPrice
          ) *
            Math.max(0, product.availableQuantity)
        );
      },
      0
    );

    return {
      lowStock,
      outOfStock,
      inventoryCost,
      potentialProfit,
    };
  }, [displayProducts]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('ar');
    const filtered = displayProducts.filter((product) => {
      const matchesCategory =
        selectedCategory === 'all' || product.categoryId === selectedCategory;
      const isLow =
        product.availableQuantity > 0 &&
        product.availableQuantity <= product.reorderLevel;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'healthy' &&
          product.status !== 'hidden' &&
          product.availableQuantity > product.reorderLevel) ||
        (statusFilter === 'low_stock' &&
          product.status !== 'hidden' &&
          isLow) ||
        (statusFilter === 'out_of_stock' &&
          product.status !== 'hidden' &&
          product.availableQuantity === 0) ||
        (statusFilter === 'hidden' && product.status === 'hidden');
      const matchesQuery =
        !query ||
        product.nameAr.toLocaleLowerCase('ar').includes(query) ||
        product.description?.toLocaleLowerCase('ar').includes(query) ||
        product.sku.toLocaleLowerCase().includes(query) ||
        product.barcode.includes(query);

      return matchesCategory && matchesStatus && Boolean(matchesQuery);
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'stock_asc') {
        return a.availableQuantity - b.availableQuantity;
      }
      if (sortBy === 'stock_desc') {
        return b.availableQuantity - a.availableQuantity;
      }
      if (sortBy === 'profit_desc') {
        const bUnits = b.unitsPerSalePackage || 1;
        const aUnits = a.unitsPerSalePackage || 1;
        return (
          (b.salePackagePrice || 0) -
          b.costPrice * bUnits -
          ((a.salePackagePrice || 0) -
            a.costPrice * aUnits)
        );
      }
      return a.nameAr.localeCompare(b.nameAr, 'ar');
    });
  }, [displayProducts, searchQuery, selectedCategory, sortBy, statusFilter]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setStatusFilter('all');
    setSortBy('name');
  };

  return (
    <div dir="rtl" className="space-y-3 p-3 pb-24 text-xs">
      <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-950/70 via-slate-950 to-slate-950 shadow-xl shadow-blue-950/10">
        <div className="relative p-4">
          <div className="absolute -left-8 -top-10 h-28 w-28 rounded-full bg-blue-500/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20">
                  <Boxes className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-black text-slate-100">
                    دليل الأصناف
                  </h2>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    الأسعار والطرود والربح في مكان واحد
                  </p>
                </div>
              </div>
              <div
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold ${
                  productsSource === 'supabase' && !productsError
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                    : 'border-rose-500/25 bg-rose-500/10 text-rose-400'
                }`}
              >
                {productsSource === 'supabase' && !productsError ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertCircle className="h-3 w-3" />
                )}
                {productsSource === 'supabase' && !productsError
                  ? 'متصل ومحدّث من Supabase'
                  : 'تحتاج البيانات إلى إعادة اتصال'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => refreshProductsFromSupabase()}
              disabled={isProductsLoading}
              title="تحديث الأصناف"
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-slate-400 transition hover:text-blue-400 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isProductsLoading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-white/5 bg-slate-950/45">
          <HeroMetric
            label="عدد الأصناف"
            value={displayProducts.length.toLocaleString('ar-JO')}
            tone="blue"
          />
          <HeroMetric
            label="تكلفة الرصيد"
            value={money(metrics.inventoryCost)}
            tone="amber"
          />
          <HeroMetric
            label="ربح متوقع"
            value={money(metrics.potentialProfit)}
            tone="emerald"
          />
        </div>
      </section>

      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
        <button
          type="button"
          onClick={() => openModal('add_product')}
          className="flex items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-2 py-3 font-black text-white shadow-lg shadow-blue-600/20 transition active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          إضافة صنف
        </button>
        <button
          type="button"
          onClick={() => openModal('receive_goods')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-2 py-3 font-bold text-indigo-300 transition active:scale-[0.98]"
        >
          <Truck className="h-4 w-4" />
          استلام
        </button>
        <button
          type="button"
          onClick={() => openModal('manage_categories')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-800 bg-slate-950 px-2 py-3 font-bold text-slate-300 transition active:scale-[0.98]"
        >
          <FolderTree className="h-4 w-4 text-violet-400" />
          الأقسام
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => openModal('manage_brands')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-2 py-2.5 text-[11px] font-bold text-cyan-200 transition active:scale-[0.98]"
        >
          <Tags className="h-4 w-4 text-cyan-400" />
          العلامات التجارية
        </button>
        <button
          type="button"
          onClick={() => openModal('manage_units')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-2 py-2.5 text-[11px] font-bold text-amber-200 transition active:scale-[0.98]"
        >
          <Ruler className="h-4 w-4 text-amber-400" />
          الطرود والوحدات
        </button>
      </div>

      {(metrics.lowStock > 0 || metrics.outOfStock > 0) && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <div>
              <p className="font-black text-amber-200">مخزون يحتاج انتباهك</p>
              <p className="text-[9px] text-slate-500">
                {metrics.lowStock} منخفض • {metrics.outOfStock} نافد
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                metrics.outOfStock > 0 ? 'out_of_stock' : 'low_stock'
              )
            }
            className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[9px] font-black text-amber-300"
          >
            عرضها
          </button>
        </div>
      )}

      {productsError && (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3">
          <div className="flex items-center gap-1.5 font-black text-rose-400">
            <AlertCircle className="h-4 w-4" />
            تعذر تحديث الأصناف
          </div>
          <p className="mt-1.5 text-[10px] leading-5 text-rose-200">
            {productsError}
          </p>
          <button
            type="button"
            onClick={() => refreshProductsFromSupabase()}
            className="mt-2 rounded-lg bg-rose-500/15 px-3 py-1.5 font-bold text-rose-300"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      <section className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-2.5">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="اسم المنتج، SKU أو الباركود"
            className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-3 pr-9 font-semibold text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <select
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
            className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2 text-[10px] font-bold text-slate-300 outline-none"
          >
            <option value="all">كل الأقسام</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameAr}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
            className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2 text-[10px] font-bold text-slate-300 outline-none"
          >
            <option value="all">كل الحالات</option>
            <option value="healthy">متوفر</option>
            <option value="low_stock">منخفض</option>
            <option value="out_of_stock">نافد</option>
            <option value="hidden">مخفي</option>
          </select>
          <label className="relative">
            <ArrowUpDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as SortOption)
              }
              className="h-full w-full min-w-0 appearance-none rounded-xl border border-slate-800 bg-slate-900 py-2 pl-1 pr-6 text-[10px] font-bold text-slate-300 outline-none"
            >
              <option value="name">الاسم</option>
              <option value="stock_asc">الأقل مخزونًا</option>
              <option value="stock_desc">الأكثر مخزونًا</option>
              <option value="profit_desc">الأعلى ربحًا</option>
            </select>
          </label>
        </div>
      </section>

      <div className="flex items-center justify-between px-1">
        <h3 className="font-black text-slate-200">
          الأصناف
          <span className="mr-1.5 rounded-full bg-slate-800 px-2 py-0.5 text-[9px] text-slate-400">
            {filteredProducts.length}
          </span>
        </h3>
        {(searchQuery ||
          selectedCategory !== 'all' ||
          statusFilter !== 'all' ||
          sortBy !== 'name') && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-[10px] font-bold text-blue-400"
          >
            مسح التصفية
          </button>
        )}
      </div>

      {isProductsLoading && products.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-3xl border border-slate-800 bg-slate-950">
          <div className="text-center">
            <RefreshCw className="mx-auto h-6 w-6 animate-spin text-blue-400" />
            <p className="mt-2 text-[10px] font-bold text-slate-500">
              جاري تحميل الأصناف...
            </p>
          </div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-950 p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-slate-700" />
          <h4 className="mt-3 font-black text-slate-200">
            لا توجد أصناف مطابقة
          </h4>
          <p className="mt-1 text-[10px] text-slate-500">
            غيّر البحث أو أضف أول صنف لهذا القسم
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 rounded-xl bg-slate-800 px-4 py-2 font-bold text-blue-400"
          >
            عرض كل الأصناف
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredProducts.map((product) => (
            <ProductCatalogCard
              key={product.id}
              product={product}
              categoryName={
                categoryNames.get(product.categoryId) || 'بدون قسم'
              }
              onView={() => openModal('view_product', product)}
              onEdit={() => openModal('edit_product', product)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const HeroMetric: React.FC<{
  label: string;
  value: string;
  tone: 'blue' | 'amber' | 'emerald';
}> = ({ label, value, tone }) => {
  const colors = {
    blue: 'text-blue-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
  };
  return (
    <div className="min-w-0 border-l border-white/5 px-2 py-3 text-center last:border-l-0">
      <span className="block text-[8px] font-bold text-slate-500">{label}</span>
      <strong className={`mt-0.5 block truncate text-[10px] ${colors[tone]}`}>
        {value}
      </strong>
    </div>
  );
};

const ProductCatalogCard: React.FC<{
  product: Product;
  categoryName: string;
  onView: () => void;
  onEdit: () => void;
}> = ({ product, categoryName, onView, onEdit }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const inventory = formatProductInventory(product, true);
  const unitsPerSalePackage = product.unitsPerSalePackage || 1;
  const salePackagePrice = product.salePackagePrice || 0;
  const needsSalePackageSetup =
    !product.saleUnitId || !product.salePackage || salePackagePrice <= 0;
  const salePackageProfit = calculateProductProfit(
    salePackagePrice,
    product.costPrice * unitsPerSalePackage
  );
  const status = getStatusBadge(
    product.status,
    product.availableQuantity,
    product.reorderLevel
  );

  return (
    <article
      className={`overflow-hidden rounded-3xl border bg-slate-950 transition ${
        product.status === 'hidden'
          ? 'border-slate-800 opacity-70'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <button
        type="button"
        onClick={onView}
        className="w-full p-3 text-right"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {product.imageUrl && !imageFailed ? (
              <img
                src={product.imageUrl}
                alt={product.nameAr}
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-6 w-6 text-slate-700" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="mb-1 text-[9px] font-bold text-blue-400">
                  {categoryName}
                </p>
                <h4 className="truncate text-sm font-black text-slate-100">
                  {product.nameAr}
                </h4>
                <p className="mt-0.5 truncate font-mono text-[9px] text-slate-500">
                  {product.sku}
                  {product.barcode ? ` • ${product.barcode}` : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-black ${status.color}`}
              >
                {status.label}
              </span>
            </div>

            <div className="mt-2 flex items-end justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-2">
              <div>
                <span className="block text-[8px] font-bold text-slate-500">
                  المتاح
                </span>
                <strong className="text-[11px] text-amber-300">
                  {inventory.totalPiecesFormatted}
                </strong>
              </div>
              <div className="text-left">
                <span className="block text-[8px] font-bold text-slate-500">
                  طرد الشراء
                </span>
                <strong className="text-[10px] text-slate-300">
                  {product.purchasePackage || product.unit} ×{' '}
                  {product.unitsPerPackage || 1}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </button>

      <div className="grid grid-cols-3 border-t border-slate-800 bg-slate-950/80">
        <div className="border-l border-slate-800 px-2 py-2.5 text-center">
          <span className="block text-[8px] font-bold text-slate-500">
            طرد البيع
          </span>
          <strong className="mt-0.5 block text-[9px] text-blue-300">
            {needsSalePackageSetup
              ? 'بحاجة ضبط'
              : `${product.salePackage} × ${unitsPerSalePackage}`}
          </strong>
        </div>
        <PriceCell
          label="سعر الطرد"
          value={salePackagePrice}
          color={
            needsSalePackageSetup
              ? 'text-rose-300'
              : 'text-violet-300'
          }
        />
        <div className="border-l border-slate-800 px-2 py-2.5 text-center last:border-l-0">
          <span className="block text-[8px] font-bold text-slate-500">
            ربح / هامش
          </span>
          <strong
            className={`mt-0.5 block text-[9px] ${
              needsSalePackageSetup
                ? 'text-slate-500'
                : salePackageProfit.isLoss
                ? 'text-rose-400'
                : 'text-emerald-400'
            }`}
          >
            {needsSalePackageSetup
              ? '—'
              : `${salePackageProfit.profitPerUnit.toFixed(3)} • %${salePackageProfit.marginPercentage.toFixed(1)}`}
          </strong>
        </div>
      </div>

      <div className="flex border-t border-slate-800 p-2">
        <button
          type="button"
          onClick={onView}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 font-bold text-slate-400 transition hover:bg-slate-900 hover:text-blue-400"
        >
          <Eye className="h-3.5 w-3.5" />
          التفاصيل
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 font-bold text-slate-400 transition hover:bg-slate-900 hover:text-emerald-400"
        >
          <Edit3 className="h-3.5 w-3.5" />
          تعديل
        </button>
      </div>
    </article>
  );
};

const PriceCell: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div className="border-l border-slate-800 px-2 py-2.5 text-center last:border-l-0">
    <span className="block text-[8px] font-bold text-slate-500">{label}</span>
    <strong className={`mt-0.5 block text-[9px] ${color}`}>
      {value.toFixed(3)} {CURRENCY}
    </strong>
  </div>
);

const getStatusBadge = (
  status: ProductStatus,
  available: number,
  reorderLevel: number
) => {
  if (status === 'hidden') {
    return {
      label: 'مخفي',
      color: 'border-slate-700 bg-slate-800 text-slate-400',
    };
  }
  if (available === 0) {
    return {
      label: 'نافد',
      color: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
    };
  }
  if (available <= reorderLevel) {
    return {
      label: 'منخفض',
      color: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    };
  }
  return {
    label: 'متوفر',
    color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  };
};
