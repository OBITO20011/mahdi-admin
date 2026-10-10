import {Card,FormFields,UiButton,PageHeader,MoneyText,formatJod} from '../../components/ui';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit3,
  Eye,
  FolderTree,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Tags,
  Truck,
} from 'lucide-react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { Product, ProductStatus } from '../../types';
import {
  formatProductInventory,
  formatWholesaleInventory,
  summarizeFlavorFamilyInventory,
} from '../../utils/inventoryFormatter';
import { calculateProductProfit } from '../../utils/productCalculations';
import {
  fetchAdminProductPage,
  type AdminProductPage,
} from '../../services/supabase/products.service';

type StatusFilter = 'all' | 'healthy' | 'low_stock' | 'out_of_stock' | 'hidden';
type SortOption = 'name' | 'stock_asc' | 'stock_desc' | 'profit_desc';

const money = (value: number) => formatJod(value);

interface ProductsViewProps {
  fetchProductPage?: typeof fetchAdminProductPage;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  fetchProductPage = fetchAdminProductPage,
}) => {
  const {categories, productDataRevision} = useAppStoreSelector(
    (state) => ({
      categories: state.categories,
      productDataRevision: state.productDataRevision,
    }),
    shallowEqual
  );
  const {openModal, cacheProductPage} = useAppStoreActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [productPage, setProductPage] = useState<AdminProductPage>({
    products: [],
    page: 1,
    pageSize: 24,
    totalCount: 0,
    totalPages: 1,
    metrics: {lowStock: 0, outOfStock: 0, inventoryCost: 0, potentialProfit: 0},
  });
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(searchQuery.trim()),
      searchQuery.trim() ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, selectedCategory, sortBy, statusFilter]);

  useEffect(() => {
    let active = true;
    setIsProductsLoading(true);
    setProductsError(null);
    fetchProductPage({
      page,
      pageSize: 24,
      search: debouncedSearch,
      categoryId: selectedCategory === 'all' ? undefined : selectedCategory,
      status: statusFilter,
      sort: sortBy,
    })
      .then((result) => {
        if (!active) return;
        setProductPage(result);
        cacheProductPage(result.products);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProductsError(
          error instanceof Error ? error.message : 'تعذر تحميل صفحة المنتجات.',
        );
      })
      .finally(() => {
        if (active) setIsProductsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    cacheProductPage,
    debouncedSearch,
    fetchProductPage,
    page,
    productDataRevision,
    refreshToken,
    selectedCategory,
    sortBy,
    statusFilter,
  ]);

  const products = productPage.products;
  const metrics = productPage.metrics;

  const activeCategories = useMemo(
    () => categories.filter((category) => !category.isHidden),
    [categories]
  );
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.nameAr])),
    [categories]
  );
  const flavorsByMaster = useMemo(() => {
    const grouped = new Map<string, Product[]>();
    products.forEach((product) => {
      if (!product.flavorMasterProductId) return;
      const current = grouped.get(product.flavorMasterProductId) || [];
      current.push(product);
      grouped.set(product.flavorMasterProductId, current);
    });
    grouped.forEach((flavors) =>
      flavors.sort(
        (first, second) =>
          (first.flavorSortOrder || 0) - (second.flavorSortOrder || 0) ||
          (first.flavorNameAr || '').localeCompare(
            second.flavorNameAr || '',
            'ar'
          )
      )
    );
    return grouped;
  }, [products]);
  const displayProducts = useMemo(
    () => products.filter((product) => !product.flavorMasterProductId),
    [products],
  );
  const filteredProducts = displayProducts;

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setStatusFilter('all');
    setSortBy('name');
    setPage(1);
  };

  return (
    <FormFields dir="rtl" className="nw-products-fields min-w-0 space-y-4 bg-nw-bg p-4 pb-24 text-nw-text text-sm">
      <Card padded={false} data-ui="products-hero" className="overflow-hidden rounded-3xl border border-nw-border     shadow-xl shadow-none">
        <div className="relative p-4">
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-nw-info-bg text-nw-info ring-1 ring-nw-primary">
                  <Boxes className="h-5 w-5" />
                </span>
                <div>
                  <PageHeader title="دليل المنتجات" description="الأسعار والطرود والربح في مكان واحد" />
                </div>
              </div>
              <div
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
                  !productsError
                    ? 'border-nw-border bg-nw-ok-bg text-nw-ok'
                    : 'border-nw-border bg-nw-bad-bg text-nw-bad'
                }`}
              >
                {!productsError ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertCircle className="h-3 w-3" />
                )}
                {isProductsLoading ? 'جاري تحديث المنتجات…' : !productsError
                  ? 'متصل ومحدّث من Supabase'
                  : 'تحتاج البيانات إلى إعادة اتصال'}
              </div>
            </div>
            <UiButton variant="plain"
              type="button"
              onClick={() => setRefreshToken((value) => value + 1)}
              disabled={isProductsLoading}
              title="تحديث المنتجات"
              className="rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-muted transition hover:text-nw-info disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isProductsLoading ? 'animate-spin' : ''}`}
              />
            </UiButton>
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-nw-border bg-nw-surface">
          <HeroMetric
            label="عدد المنتجات"
            value={productPage.totalCount.toLocaleString('ar-JO-u-nu-latn')}
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
      </Card>

      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-2">
        <UiButton variant="plain"
          type="button"
          onClick={() => openModal('add_product')}
          className="flex items-center justify-center gap-1.5 rounded-2xl bg-nw-primary px-2 py-3 font-black text-nw-on-primary shadow-lg shadow-none transition active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          إضافة منتج
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={() => openModal('receive_goods')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-nw-border bg-nw-info-bg px-2 py-3 font-bold text-nw-info transition active:scale-[0.98]"
        >
          <Truck className="h-4 w-4" />
          استلام
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={() => openModal('manage_categories')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-nw-border bg-nw-surface px-2 py-3 font-bold text-nw-text transition active:scale-[0.98]"
        >
          <FolderTree className="h-4 w-4 text-nw-info" />
          الأقسام
        </UiButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <UiButton variant="plain"
          type="button"
          onClick={() => openModal('manage_brands')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-nw-border bg-nw-info-bg px-2 py-2.5 text-xs font-bold text-nw-info transition active:scale-[0.98]"
        >
          <Tags className="h-4 w-4 text-nw-info" />
          العلامات التجارية
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={() => openModal('manage_units')}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-nw-border bg-nw-warn-bg px-2 py-2.5 text-xs font-bold text-nw-warn transition active:scale-[0.98]"
        >
          <Ruler className="h-4 w-4 text-nw-warn" />
          الطرود والوحدات
        </UiButton>
      </div>

      {(metrics.lowStock > 0 || metrics.outOfStock > 0) && (
        <div className="flex items-center justify-between rounded-2xl border border-nw-border bg-nw-warn-bg px-3 py-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-nw-warn" />
            <div>
              <p className="font-black text-nw-warn">مخزون يحتاج انتباهك</p>
              <p className="text-xs text-nw-muted">
                {metrics.lowStock} منخفض • {metrics.outOfStock} نافد
              </p>
            </div>
          </div>
          <UiButton variant="plain"
            type="button"
            onClick={() =>
              setStatusFilter(
                metrics.outOfStock > 0 ? 'out_of_stock' : 'low_stock'
              )
            }
            className="rounded-lg bg-nw-warn-bg px-2.5 py-1.5 text-xs font-black text-nw-warn"
          >
            عرضها
          </UiButton>
        </div>
      )}

      {productsError && (
        <div className="rounded-2xl border border-nw-border bg-nw-bad-bg p-3">
          <div className="flex items-center gap-1.5 font-black text-nw-bad">
            <AlertCircle className="h-4 w-4" />
            تعذر تحديث المنتجات
          </div>
          <p className="mt-1.5 text-xs leading-5 text-nw-bad">
            {productsError}
          </p>
          <UiButton variant="plain"
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="mt-2 rounded-lg bg-nw-bad-bg px-3 py-1.5 font-bold text-nw-bad"
          >
            إعادة المحاولة
          </UiButton>
        </div>
      )}

      <Card padded={false} className="space-y-2 rounded-2xl border border-nw-border bg-nw-surface p-2.5">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nw-muted" />
          <input aria-label="بحث المنتجات"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="اسم المنتج، SKU أو الباركود"
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 py-2.5 pl-3 pr-9 font-semibold text-nw-text outline-none placeholder:text-nw-muted focus:border-nw-border"
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <select
            aria-label="تصفية المنتجات حسب القسم"
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
            className="min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-2 text-xs font-bold text-nw-text outline-none"
          >
            <option value="all">كل الأقسام</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameAr}
              </option>
            ))}
          </select>
          <select
            aria-label="تصفية المنتجات حسب حالة المخزون"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
            className="min-w-0 rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-2 text-xs font-bold text-nw-text outline-none"
          >
            <option value="all">كل الحالات</option>
            <option value="healthy">متوفر</option>
            <option value="low_stock">منخفض</option>
            <option value="out_of_stock">نافد</option>
            <option value="hidden">مخفي</option>
          </select>
          <label className="relative">
            <ArrowUpDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-nw-muted" />
            <select
              aria-label="ترتيب المنتجات"
              value={sortBy}
              onChange={(event) =>
                setSortBy(event.target.value as SortOption)
              }
              className="h-full w-full min-w-0 appearance-none rounded-xl border border-nw-border bg-nw-surface-2 py-2 pl-1 pr-6 text-xs font-bold text-nw-text outline-none"
            >
              <option value="name">الاسم</option>
              <option value="stock_asc">الأقل مخزونًا</option>
              <option value="stock_desc">الأكثر مخزونًا</option>
              <option value="profit_desc">الأعلى ربحًا</option>
            </select>
          </label>
        </div>
      </Card>

      <div className="flex items-center justify-between px-1">
        <h3 className="font-black text-nw-text">
          المنتجات
          <span className="mr-1.5 rounded-full bg-nw-mute-bg px-2 py-0.5 text-xs text-nw-muted">
            {productPage.totalCount}
          </span>
        </h3>
        {(searchQuery ||
          selectedCategory !== 'all' ||
          statusFilter !== 'all' ||
          sortBy !== 'name') && (
          <UiButton variant="plain"
            type="button"
            onClick={resetFilters}
            className="text-xs font-bold text-nw-info"
          >
            مسح التصفية
          </UiButton>
        )}
      </div>

      {isProductsLoading && products.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-3xl border border-nw-border bg-nw-surface">
          <div className="text-center">
            <RefreshCw className="mx-auto h-6 w-6 animate-spin text-nw-info" />
            <p className="mt-2 text-xs font-bold text-nw-muted">
              جاري تحميل المنتجات...
            </p>
          </div>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-nw-border bg-nw-surface p-8 text-center">
          <Package className="mx-auto h-8 w-8 text-nw-muted" />
          <h4 className="mt-3 font-black text-nw-text">
            لا توجد منتجات مطابقة
          </h4>
          <p className="mt-1 text-xs text-nw-muted">
            غيّر البحث أو أضف أول منتج لهذا القسم
          </p>
          <UiButton variant="plain"
            type="button"
            onClick={resetFilters}
            className="mt-3 rounded-xl bg-nw-mute-bg px-4 py-2 font-bold text-nw-info"
          >
            عرض كل المنتجات
          </UiButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map((product) => (
            <ProductCatalogCard
              key={product.id}
              product={product}
              categoryName={
                categoryNames.get(product.categoryId) || 'بدون قسم'
              }
              flavors={flavorsByMaster.get(product.id) || []}
              onView={() => openModal('view_product', product)}
              onEdit={() => openModal('edit_product', product)}
              onReceiveFlavor={(flavorId) =>
                openModal('receive_goods', { productId: flavorId })
              }
            />
          ))}
        </div>
      )}

      {productPage.totalPages > 1 && (
        <nav
          aria-label="صفحات المنتجات"
          className="flex items-center justify-between rounded-2xl border border-nw-border bg-nw-surface px-3 py-2"
        >
          <UiButton variant="plain"
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || isProductsLoading}
            className="flex items-center gap-1 rounded-xl bg-nw-mute-bg px-3 py-2 text-xs font-bold text-nw-text disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            السابق
          </UiButton>
          <span className="text-xs font-bold text-nw-muted">
            صفحة {productPage.page.toLocaleString('ar-JO-u-nu-latn')} من{' '}
            {productPage.totalPages.toLocaleString('ar-JO-u-nu-latn')}
          </span>
          <UiButton variant="plain"
            type="button"
            onClick={() =>
              setPage((value) => Math.min(productPage.totalPages, value + 1))
            }
            disabled={page >= productPage.totalPages || isProductsLoading}
            className="flex items-center gap-1 rounded-xl bg-nw-mute-bg px-3 py-2 text-xs font-bold text-nw-text disabled:opacity-40"
          >
            التالي
            <ChevronLeft className="h-3.5 w-3.5" />
          </UiButton>
        </nav>
      )}
    </FormFields>
  );
};

const HeroMetric: React.FC<{
  label: string;
  value: string;
  tone: 'blue' | 'amber' | 'emerald';
}> = ({ label, value, tone }) => {
  const colors = {
    blue: 'text-nw-info',
    amber: 'text-nw-warn',
    emerald: 'text-nw-ok',
  };
  return (
    <div className="min-w-0 border-l border-nw-border px-2 py-3 text-center last:border-l-0">
      <span className="block text-xs font-bold text-nw-muted">{label}</span>
      <strong className={`mt-0.5 block truncate text-xs ${colors[tone]}`}>
        {value}
      </strong>
    </div>
  );
};

const ProductCatalogCard: React.FC<{
  product: Product;
  categoryName: string;
  flavors: Product[];
  onView: () => void;
  onEdit: () => void;
  onReceiveFlavor: (flavorId: string) => void;
}> = ({
  product,
  categoryName,
  flavors,
  onView,
  onEdit,
  onReceiveFlavor,
}) => {
  const [imageFailed, setImageFailed] = useState(false);
  const [areFlavorsExpanded, setAreFlavorsExpanded] = useState(false);
  const familyInventory = summarizeFlavorFamilyInventory(flavors);
  const inventory = product.isFlavorMaster
    ? formatWholesaleInventory(
        familyInventory.availableQuantity,
        familyInventory.unitsPerPackage,
        familyInventory.purchasePackage,
        familyInventory.unit
      )
    : formatProductInventory(product, true);
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
      data-product-catalog-card={product.id}
      className={`overflow-hidden rounded-3xl border bg-nw-surface transition ${
        product.status === 'hidden'
          ? 'border-nw-border '
          : 'border-nw-border hover:border-nw-border'
      }`}
    >
      <UiButton variant="plain"
        type="button"
        onClick={onView}
        className="w-full p-2 text-right sm:p-3"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="flex h-20 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-nw-border bg-nw-surface-2 sm:h-16 sm:w-16">
            {product.imageUrl && !imageFailed ? (
              <img
                src={product.imageUrl}
                alt={product.nameAr}
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <Package className="h-6 w-6 text-nw-muted" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="mb-0.5 truncate text-xs font-bold text-nw-info sm:mb-1 sm:text-xs">
                  {categoryName}
                </p>
                <h4 className="line-clamp-2 text-xs font-black leading-4 text-nw-text sm:text-sm">
                  {product.nameAr}
                </h4>
                <p className="mt-0.5 truncate font-mono text-xs text-nw-muted sm:text-xs">
                  {product.sku}
                  {product.barcode ? ` • ${product.barcode}` : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2 py-1 text-xs font-black ${status.color}`}
              >
                {status.label}
              </span>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-1 rounded-xl border border-nw-border bg-nw-surface-2 px-2 py-1.5 sm:grid-cols-2 sm:px-2.5 sm:py-2">
              <div className="min-w-0">
                <span className="block text-xs font-bold text-nw-muted">
                  {product.isFlavorMaster
                    ? 'إجمالي المتاح في النكهات'
                    : 'المتاح'}
                </span>
                <strong className="block truncate text-xs text-nw-warn sm:text-xs">
                  {product.isFlavorMaster && !familyInventory.hasCompatiblePackaging
                    ? 'راجع أرصدة النكهات'
                    : inventory.cartonFormatted}
                </strong>
              </div>
              <div className="min-w-0 text-right sm:text-left">
                <span className="block text-xs font-bold text-nw-muted">
                  طرد الشراء
                </span>
                <strong className="block truncate text-xs text-nw-text sm:text-xs">
                  {product.purchasePackage || product.unit} ×{' '}
                  {product.unitsPerPackage || 1}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </UiButton>

      {flavors.length > 0 && (
        <div className="border-t border-nw-border bg-nw-info-bg px-2.5 py-2">
          <UiButton variant="plain"
            type="button"
            aria-expanded={areFlavorsExpanded}
            onClick={() => setAreFlavorsExpanded((current) => !current)}
            className="flex min-h-11 w-full items-center justify-between gap-1 rounded-xl px-1 py-1.5 text-right transition hover:bg-nw-info-bg sm:px-1.5"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-nw-info-bg text-nw-info">
                <Palette className="h-3.5 w-3.5" />
              </span>
              <span>
                <strong className="block text-xs text-nw-info">
                  {flavors.length.toLocaleString('ar-JO-u-nu-latn')} نكهات
                </strong>
                <span className="text-xs text-nw-muted">
                  اضغط لعرض رصيد كل نكهة
                </span>
              </span>
            </span>
            {areFlavorsExpanded ? (
              <ChevronUp className="h-4 w-4 text-nw-info" />
            ) : (
              <ChevronDown className="h-4 w-4 text-nw-muted" />
            )}
          </UiButton>

          {areFlavorsExpanded && (
            <div className="mt-2 space-y-1.5 border-t border-nw-border pt-2">
              {flavors.map((flavor) => {
                const flavorAvailable = formatProductInventory(flavor, true);
                const isHidden = flavor.status === 'hidden';
                return (
                  <div
                    key={flavor.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-nw-border bg-nw-surface-2 p-2"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-nw-surface">
                      {flavor.imageUrl ? (
                        <img
                          src={flavor.imageUrl}
                          alt={flavor.flavorNameAr}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Palette className="h-4 w-4 text-nw-muted" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <strong className="truncate text-xs text-nw-text">
                          {flavor.flavorNameAr}
                        </strong>
                        {isHidden && (
                          <span className="rounded-full bg-nw-mute-bg px-1.5 py-0.5 text-xs font-black text-nw-text">
                            متوقفة
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs font-bold text-nw-warn">
                        {flavorAvailable.cartonFormatted} متاح
                      </p>
                    </div>
                    <UiButton variant="plain"
                      type="button"
                      onClick={() => onReceiveFlavor(flavor.id)}
                      className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-nw-border bg-nw-info-bg px-2 text-xs font-black text-nw-info sm:w-auto"
                    >
                      <Truck className="h-3 w-3" />
                      استلام
                    </UiButton>
                  </div>
                );
              })}
              <UiButton variant="plain"
                type="button"
                onClick={onView}
                className="min-h-11 w-full rounded-xl bg-nw-info-bg py-2 text-xs font-black text-nw-info"
              >
                إدارة النكهات وترتيبها
              </UiButton>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-nw-border bg-nw-surface">
        <div className="border-l border-nw-border px-2 py-2.5 text-center">
          <span className="block text-xs font-bold text-nw-muted">
            طرد البيع
          </span>
          <strong className="mt-0.5 block text-xs text-nw-info">
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
              ? 'text-nw-bad'
              : 'text-nw-info'
          }
        />
        <div className="border-l border-nw-border px-2 py-2.5 text-center last:border-l-0">
          <span className="block text-xs font-bold text-nw-muted">
            ربح / هامش
          </span>
          <strong
            className={`mt-0.5 block text-xs ${
              needsSalePackageSetup
                ? 'text-nw-muted'
                : salePackageProfit.isLoss
                ? 'text-nw-bad'
                : 'text-nw-ok'
            }`}
          >
            {needsSalePackageSetup
              ? '—'
              : `${formatJod(salePackageProfit.profitPerUnit)} • %${salePackageProfit.marginPercentage.toFixed(1)}`}
          </strong>
        </div>
      </div>

      <div className="flex border-t border-nw-border p-2">
        <UiButton variant="plain"
          type="button"
          onClick={onView}
          className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl py-2 font-bold text-nw-muted transition hover:bg-nw-surface-2 hover:text-nw-info"
        >
          <Eye className="h-3.5 w-3.5" />
          التفاصيل
        </UiButton>
        <UiButton variant="plain"
          type="button"
          onClick={onEdit}
          className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl py-2 font-bold text-nw-muted transition hover:bg-nw-surface-2 hover:text-nw-ok"
        >
          <Edit3 className="h-3.5 w-3.5" />
          تعديل
        </UiButton>
      </div>
    </article>
  );
};

const PriceCell: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div className="border-l border-nw-border px-2 py-2.5 text-center last:border-l-0">
    <span className="block text-xs font-bold text-nw-muted">{label}</span>
    <strong className={`mt-0.5 block text-xs ${color}`}>
      <MoneyText amount={value} currency />
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
      color: 'border-nw-border bg-nw-mute-bg text-nw-muted',
    };
  }
  if (available === 0) {
    return {
      label: 'نافد',
      color: 'border-nw-border bg-nw-bad-bg text-nw-bad',
    };
  }
  if (available <= reorderLevel) {
    return {
      label: 'منخفض',
      color: 'border-nw-border bg-nw-warn-bg text-nw-warn',
    };
  }
  return {
    label: 'متوفر',
    color: 'border-nw-border bg-nw-ok-bg text-nw-ok',
  };
};
