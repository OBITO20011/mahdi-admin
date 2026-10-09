/** Package F inventory presentation; all existing reader/mutation boundaries retained. */
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {shallowEqual, useAppStoreActions, useAppStoreSelector} from '../../stores/useAppStore';
import type {Product, InventoryMovement} from '../../types';
import {formatProductInventory, formatWholesaleInventory} from '../../utils/inventoryFormatter';
import {ClearInventoryBalanceDialog} from './ClearInventoryBalanceDialog';
import {fetchInventoryProductPageFromSupabase, type InventoryProductPage} from '../../services/supabase/inventory.service';
import {Card, PageHeader, SectionHeader, DetailLayout, MainColumn, DetailPanel, KpiGrid, KpiCard, MoneyText, StatusBadge, StockBar, FilterChips, SegmentedControl, SearchField, UiButton, ProductGlyph, formatUiDate, type UiTone} from '../../components/ui';
import {TableShell, Th, Tr, Td} from '../../components/ui';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {Truck, ClipboardCheck, FileSpreadsheet, ChevronLeft, ChevronRight, RefreshCw, History, Trash2, ArrowRight} from 'lucide-react';

const stockState = (product: Product): {tone: UiTone; label: string} =>
  product.availableQuantity <= 0 ? {tone:'bad',label:'نفد'} :
    product.availableQuantity <= product.reorderLevel ? {tone:'warn',label:'منخفض'} : {tone:'ok',label:'متوفر'};

function InventoryStock({product}: {product: Product}) {
  const status = stockState(product);
  const invAvailable = formatProductInventory(product, true);
  return <div className="min-w-0 space-y-2 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="sr-only">المتاح في المخزون</span>
      <span className="break-words font-semibold">{invAvailable.cartonFormatted}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
    <StockBar label={'المتاح في المخزون: ' + product.nameAr} value={product.availableQuantity}
      max={Math.max(product.maxStockLevel ?? 0, product.availableQuantity, product.reorderLevel, 1)} tone={status.tone} />
  </div>;
}
function InventoryMovements({items}: {items: InventoryMovement[]}) {
  return <div className="space-y-2">{items.map(mov => {
    const adjustment = ['Stock Count','Manual Adjustment','Damage','Expired'].includes(mov.movementType);
    const tone: UiTone = adjustment ? 'warn' : mov.quantityChange >= 0 ? 'ok' : 'info';
    const glyph = adjustment ? '±' : mov.quantityChange >= 0 ? '+' : '−';
    return <div key={mov.id} className="flex min-w-0 items-start gap-3 border-b border-nw-border py-3 text-xs">
      <StatusBadge tone={tone}>{glyph}</StatusBadge><div className="min-w-0 flex-1 space-y-1">
        <p className="m-0 break-words font-semibold">{mov.productName}</p><p className="m-0 break-words">{mov.reason}</p>
        <p className="m-0 break-words text-nw-muted">{mov.movementType} · {mov.performedByUserName}</p>
        <bdi dir="ltr" className="block text-nw-muted">{formatUiDate(mov.timestamp,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</bdi>
        <p className="m-0 text-nw-muted">القبل: {mov.previousQuantity} ← النتيجة: {mov.newQuantity}</p>
      </div><bdi dir="ltr" className={'nw-num shrink-0 font-bold ' + (adjustment ? 'text-nw-warn' : mov.quantityChange >= 0 ? 'text-nw-ok' : 'text-nw-info')}>
        {mov.quantityChange >= 0 ? '+' : '−'}{Math.abs(mov.quantityChange)}</bdi>
    </div>;
  })}</div>;
}
type InventoryStatusFilter =
  | 'all'
  | 'available'
  | 'low_stock'
  | 'out_of_stock'
  | 'near_expiry'
  | 'damaged'
  | 'stagnant';

interface InventoryViewProps {
  fetchProductPage?: typeof fetchInventoryProductPageFromSupabase;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  fetchProductPage = fetchInventoryProductPageFromSupabase,
}) => {
  const {
    branches,
    warehouses,
    categories,
    movements,
    movementPage,
    activeBranch,
    productDataRevision,
  } = useAppStoreSelector(
    (state) => ({
      branches: state.branches,
      warehouses: state.warehouses,
      categories: state.categories,
      movements: state.movements,
      movementPage: state.movementPage,
      activeBranch: state.activeBranch,
      productDataRevision: state.productDataRevision,
    }),
    shallowEqual
  );
  const {openModal, refreshInventoryMovementsFromSupabase, cacheProductPage} =
    useAppStoreActions();

  // Active Tab: 'products' (الأصناف والمخزون) vs 'movements' (سجل الحركات)
  const [activeTab, setActiveTab] = useState<'products' | 'movements'>('products');

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<InventoryStatusFilter>('all');
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('');
  const [productPageNumber, setProductPageNumber] = useState(1);
  const [isProductPageLoading, setIsProductPageLoading] = useState(true);
  const [productPageError, setProductPageError] = useState<string | null>(null);
  const [productPageRefreshToken, setProductPageRefreshToken] = useState(0);
  const [inventoryProductPage, setInventoryProductPage] = useState<InventoryProductPage>({
    products: [],
    page: 1,
    pageSize: 24,
    totalCount: 0,
    totalPages: 1,
    metrics: {
      totalItems: 0,
      totalCostValue: 0,
      totalRetailValue: 0,
      lowStock: 0,
      outOfStock: 0,
      stagnant: 0,
    },
  });
  const [acceptedRevision, setAcceptedRevision] = useState<number | null>(null);
  const [movementPageNumber, setMovementPageNumber] = useState(1);
  const movementPageSize = 25;

  // Selected product for movement history modal inside this view
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const historyProductId = historyProduct?.id;
  const [clearInventoryProduct, setClearInventoryProduct] =
    useState<Product | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedProductSearch(searchQuery.trim()),
      searchQuery.trim() ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setProductPageNumber(1);
  }, [
    debouncedProductSearch,
    selectedBranchId,
    selectedCategoryId,
    selectedWarehouseId,
    statusFilter,
  ]);

  useEffect(() => {
    if (activeTab !== 'products') return;
    let active = true;
    setIsProductPageLoading(true);
    setProductPageError(null);
    fetchProductPage({
      page: productPageNumber,
      pageSize: 24,
      search: debouncedProductSearch,
      branchId: selectedBranchId === 'all' ? undefined : selectedBranchId,
      warehouseId: selectedWarehouseId === 'all' ? undefined : selectedWarehouseId,
      categoryId: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
      status: statusFilter,
    })
      .then((result) => {
        if (!active) return;
        setInventoryProductPage(result);
        setAcceptedRevision(productDataRevision);
        cacheProductPage(result.products);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProductPageError(
          error instanceof Error ? error.message : 'تعذر تحميل صفحة المخزون.',
        );
      })
      .finally(() => {
        if (active) setIsProductPageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    activeTab,
    cacheProductPage,
    debouncedProductSearch,
    fetchProductPage,
    productDataRevision,
    productPageNumber,
    productPageRefreshToken,
    selectedBranchId,
    selectedCategoryId,
    selectedWarehouseId,
    statusFilter,
  ]);

  useEffect(() => {
    if (activeTab !== 'movements' && !historyProductId) return;
    const timer = window.setTimeout(() => {
      void refreshInventoryMovementsFromSupabase({
        page: movementPageNumber,
        pageSize: movementPageSize,
        searchQuery,
        branchId: selectedBranchId === 'all' ? undefined : selectedBranchId,
        warehouseId:
          selectedWarehouseId === 'all' ? undefined : selectedWarehouseId,
        productId: historyProductId,
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    historyProductId,
    movementPageNumber,
    refreshInventoryMovementsFromSupabase,
    searchQuery,
    selectedBranchId,
    selectedWarehouseId,
    activeTab,
  ]);

  useEffect(() => {
    setMovementPageNumber(1);
  }, [searchQuery, selectedBranchId, selectedWarehouseId, historyProductId]);
  const filteredProducts = inventoryProductPage.products;
  const totalCostValue = inventoryProductPage.metrics.totalCostValue;
  const totalRetailValue = inventoryProductPage.metrics.totalRetailValue;
  const totalItemCount = inventoryProductPage.metrics.totalItems;
  const activeItemCount = inventoryProductPage.metrics.activeItems;
  const availableStockCount = inventoryProductPage.metrics.availableStock;
  const lowStockCount = inventoryProductPage.metrics.lowStock;
  const outOfStockCount = inventoryProductPage.metrics.outOfStock;
  const stagnantCount = inventoryProductPage.metrics.stagnant;

  // Filtered Movements List
  const filteredMovements = movements;

  // Product Movement History Helper
  const getProductMovements = (productId: string) =>
    movementPage.productId === productId ? movements : [];

  const rootRef = useRef<HTMLDivElement>(null);
  const returnPoint = useRef<{id: string; container: HTMLElement; top: number} | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const closeDetail = () => setHistoryProduct(null);
  const detailRef = useDialogFocus(Boolean(historyProduct && phone), closeDetail);
  const openProduct = (product: Product) => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      let container = rootRef.current?.parentElement ?? null;
      while (container && !/^(auto|scroll)$/.test(getComputedStyle(container).overflowY)) container = container.parentElement;
      container ??= document.scrollingElement as HTMLElement;
      returnPoint.current = {id: product.id, container, top: container.scrollTop};
    }
    setLastSelectedId(product.id);
    setHistoryProduct(product);
  };
  useLayoutEffect(() => {
    const point = returnPoint.current;
    if (!point || historyProduct || isProductPageLoading || acceptedRevision !== productDataRevision) return;
    returnPoint.current = null;
    if (!point.container.isConnected) return;
    point.container.scrollTop = point.top;
    const card = rootRef.current?.querySelector<HTMLElement>('[data-inventory-product-card="' + CSS.escape(point.id) + '"] button');
    card?.focus({preventScroll:true});
    if (card) {
      const bounds = card.getBoundingClientRect(), viewport = point.container.getBoundingClientRect();
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) card.scrollIntoView({block:'nearest'});
    }
  }, [historyProduct, isProductPageLoading, acceptedRevision, productDataRevision]);
  const product = filteredProducts.find(item => item.id === historyProductId) ?? historyProduct;
  const metricsReady = acceptedRevision !== null && !productPageError;
  const kpi = (value: number | undefined) => metricsReady && Number.isFinite(value) ? value! : 'غير متاح';
  const movementPagination = <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-nw-muted">
    <UiButton onClick={() => setMovementPageNumber((current) => Math.max(1, current - 1))} disabled={movementPage.page <= 1}>الأحدث</UiButton>
    <span>صفحة {movementPage.page} من {movementPage.totalPages}</span>
    <UiButton onClick={() => setMovementPageNumber((current) => Math.min(movementPage.totalPages, current + 1))} disabled={movementPage.page >= movementPage.totalPages}>الأقدم</UiButton>
  </div>;

  return <div ref={rootRef} dir="rtl" data-testid="inventory-workbench" className="min-w-0 bg-nw-bg text-nw-text">
    <PageHeader title="المخزون الفعلي" description="راقب المتاح بالكراتين والباكيتات؛ كل تعديل محفوظ بحركة موثقة." actions={<>
      <UiButton variant="primary" onClick={() => openModal('receive_goods')}><Truck className="h-4 w-4" />استلام بضاعة</UiButton>
      <UiButton onClick={() => openModal('stock_count')}><ClipboardCheck className="h-4 w-4" />بدء جرد</UiButton>
      <details className="relative"><summary className="flex min-h-11 cursor-pointer items-center rounded-xl border border-nw-border px-3 text-sm">إدارة</summary>
        <Card className="absolute left-0 z-20 mt-2 w-64 max-w-[80vw]">
          <UiButton className="w-full text-xs" onClick={() => openModal('inventory_opening_setup')}><FileSpreadsheet className="h-4 w-4" />تهيئة المخزون الافتتاحي</UiButton>
        </Card>
      </details>
    </>} />
    <div className="space-y-5 p-4 pb-28 sm:p-6">
      <KpiGrid phonePairs>
        <KpiCard label="قيمة المخزون بالتكلفة" value={metricsReady && Number.isFinite(totalCostValue) ? <MoneyText amount={totalCostValue} /> : 'غير متاح'} note="د.أ · متوسط التكلفة" />
        <KpiCard label="أصناف نشطة" value={kpi(activeItemCount)} note="الأصناف المفعّلة فقط" />
        <KpiCard label="تحت حد الطلب" value={kpi(lowStockCount)} valueTone="warn" note="يحتاج متابعة المخزون" />
        <KpiCard label="نفدت" value={kpi(outOfStockCount)} valueTone="bad" note="لا يوجد مخزون متاح" />
      </KpiGrid>
      <SegmentedControl touchSize label="عرض المخزون" value={activeTab} onChange={value => {setActiveTab(value); if(value === 'movements') setHistoryProduct(null);}}
        options={[{value:'products',label:'المتاح الآن',count:inventoryProductPage.totalCount},{value:'movements',label:'سجل الحركات',count:movementPage.totalCount}]} />
      <DetailLayout>
        <MainColumn>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FilterChips touchSize label="حالة المخزون" value={statusFilter} onChange={setStatusFilter}
              options={[{value:'all',label:'الكل',count:totalItemCount},{value:'available',label:'متوفر',count:availableStockCount},{value:'low_stock',label:'منخفض',count:lowStockCount},{value:'out_of_stock',label:'نفد',count:outOfStockCount}]} />
            <SearchField label="البحث في المخزون" placeholder="ابحث باسم المنتج، الكود SKU، أو الباركود..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full md:max-w-sm" />
            <UiButton aria-label="تحديث المخزون" disabled={isProductPageLoading} onClick={() => setProductPageRefreshToken(value => value + 1)}><RefreshCw className="h-4 w-4" />تحديث</UiButton>
          </div>
          <details className="rounded-xl border border-nw-border bg-nw-surface px-4">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-nw-muted">تصفية وبحث متقدم</summary>
            <div className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4">
              <label className="text-xs text-nw-muted">الفرع:<select aria-label="الفرع" value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-nw-text">
                <option value="all">جميع الفروع ({branches.length})</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label className="text-xs text-nw-muted">المستودع:<select aria-label="المستودع" value={selectedWarehouseId} onChange={e => setSelectedWarehouseId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-nw-text">
                <option value="all">جميع المستودعات ({warehouses.length})</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              <label className="text-xs text-nw-muted">القسم:<select aria-label="القسم" value={selectedCategoryId} onChange={e => setSelectedCategoryId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-nw-text">
                <option value="all">جميع الأقسام ({categories.length})</option>{categories.map(c => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</select></label>
              <label className="text-xs text-nw-muted">حالة المخزون:<select aria-label="حالة المخزون المتقدمة" value={statusFilter} onChange={e => setStatusFilter(e.target.value as InventoryStatusFilter)} className="mt-1 min-h-11 w-full rounded-xl border border-nw-border bg-nw-surface-2 px-2 text-nw-text">
                <option value="all">الكل (جميع الحالات)</option><option value="available">متوفر</option><option value="low_stock">منخفض المخزون</option><option value="out_of_stock">نافد المخزون</option><option value="near_expiry">قريب انتهاء الصلاحية</option><option value="stagnant">منتجات راكدة</option></select></label>
            </div>
            <p className="text-xs text-nw-muted">المنتجات الراكدة: {stagnantCount} · قريب انتهاء الصلاحية: غير متاح</p>
            <p className="text-xs text-nw-muted">القيمة بسعر البيع: {metricsReady ? <MoneyText amount={totalRetailValue} currency /> : 'غير متاح'}</p>
          </details>
          {activeTab === 'products' ? <>
            {productPageError ? <Card className="text-center"><p role="alert" className="text-nw-bad">{productPageError}</p><UiButton onClick={() => setProductPageRefreshToken((value) => value + 1)}>إعادة المحاولة</UiButton></Card> :
              isProductPageLoading && filteredProducts.length === 0 ? <Card role="status">جارٍ تحميل صفحة المخزون…</Card> :
              filteredProducts.length === 0 ? <Card className="space-y-3 text-center"><p>لا توجد منتجات تطابق الفلاتر المحددة</p><p className="text-xs text-nw-muted">جرب تغيير شروط البحث أو اختيار فرع ومستودع آخر</p>
                <UiButton onClick={() => {setSearchQuery('');setSelectedBranchId('all');setSelectedWarehouseId('all');setSelectedCategoryId('all');setStatusFilter('all');}}>إعادة ضبط جميع الفلاتر</UiButton></Card> : <>
              <div className="hidden md:block"><TableShell caption="أصناف المخزون" minWidth={730} head={<><Th>الصنف</Th><Th>القسم</Th><Th>المتوفر</Th><Th>حد الطلب</Th><Th>متوسط التكلفة / باكيت</Th></>}>
                {filteredProducts.map(product => <Tr key={product.id} data-inventory-product-row={product.id} selected={lastSelectedId === product.id}>
                  <Td><button type="button" className="min-h-11 text-right" aria-label={'تفاصيل المنتج والرصيد: ' + product.nameAr} onClick={() => openProduct(product)}><span className="block font-semibold">{product.nameAr}</span><span className="text-xs text-nw-muted">{product.purchasePackage || product.unit} = {product.unitsPerPackage || 1} {product.unit}</span></button></Td>
                  <Td>{categories.find(c => c.id === product.categoryId)?.nameAr || 'عام'}</Td>
                  <Td><InventoryStock product={product} /></Td><Td>{product.reorderLevel} {product.unit}</Td>
                  <Td>{Number.isFinite(product.costPrice) ? <MoneyText amount={product.costPrice} /> : 'غير متاح'}</Td>
                </Tr>)}
              </TableShell></div>
              <div className="grid gap-3 md:hidden">{filteredProducts.map(product => <Card key={product.id} data-inventory-product-card={product.id} padded={false} className={lastSelectedId === product.id ? 'border-nw-primary bg-nw-sel-row' : ''}>
                <button type="button" className="min-h-11 w-full space-y-3 p-4 text-right" aria-label={'تفاصيل المنتج والرصيد: ' + product.nameAr} onClick={() => openProduct(product)}>
                  <span className="block break-words text-sm font-bold">{product.nameAr}</span><InventoryStock product={product} />
                  <span className="flex justify-between gap-2 text-xs text-nw-muted"><span>حد الطلب: {product.reorderLevel} {product.unit}</span><span>{product.purchasePackage || product.unit} × {product.unitsPerPackage || 1}</span></span>
                </button>
              </Card>)}</div>
            </>}
            {inventoryProductPage.totalPages > 1 && <nav aria-label="صفحات منتجات المخزون" className="flex items-center justify-center gap-3 rounded-xl border border-nw-border bg-nw-surface p-3 text-xs">
              <UiButton onClick={() => setProductPageNumber((page) => Math.max(1, page - 1))} disabled={productPageNumber <= 1 || isProductPageLoading}><ChevronRight className="h-4 w-4" />السابق</UiButton>
              <span>{inventoryProductPage.page} من {inventoryProductPage.totalPages}</span>
              <UiButton onClick={() => setProductPageNumber((page) => Math.min(inventoryProductPage.totalPages, page + 1))} disabled={productPageNumber >= inventoryProductPage.totalPages || isProductPageLoading}>التالي<ChevronLeft className="h-4 w-4" /></UiButton>
            </nav>}
          </> : <Card><SectionHeader title="سجل الحركات" />{filteredMovements.length ? <InventoryMovements items={filteredMovements} /> : <p className="text-sm text-nw-muted">لا توجد حركات مخزون مطابقة للبحث حالياً</p>}{movementPage.totalPages > 1 && movementPagination}</Card>}
        </MainColumn>
        {product && historyProduct && <DetailPanel ref={detailRef as React.Ref<HTMLElement>} data-testid="inventory-detail-panel" role={phone ? 'dialog' : 'region'} aria-modal={phone || undefined} aria-label={'تفاصيل المنتج والرصيد: ' + product.nameAr} tabIndex={-1}
          className="fixed inset-0 z-40 w-full max-md:rounded-none max-md:border-0 max-md:bg-nw-bg md:static md:z-auto">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-nw-border p-4"><h2 className="m-0 break-words text-base font-bold">{product.nameAr}</h2>
            <UiButton aria-label="رجوع للمخزون" onClick={closeDetail} className="shrink-0 text-xs"><ArrowRight className="h-4 w-4" /><span className="md:hidden">رجوع للمخزون</span><span className="hidden md:inline">إغلاق</span></UiButton></div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-28 md:overflow-visible md:pb-4">
            <div className="flex items-start gap-3"><ProductGlyph name={product.nameAr} image={product.imageUrl} /><div className="min-w-0 space-y-1 text-xs text-nw-muted"><p className="m-0 break-all">SKU: <bdi dir="ltr">{product.sku}</bdi></p><p className="m-0 break-all">الباركود: <bdi dir="ltr">{product.barcode || 'غير محدد'}</bdi></p></div></div>
            <InventoryStock product={product} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Card className="p-3"><span className="text-nw-muted">الفعلي</span><p className="mb-0 font-bold">{formatProductInventory(product, false).cartonFormatted}</p></Card>
              <Card className="p-3"><span className="text-nw-muted">المحجوز</span><p className="mb-0 font-bold">{product.reservedQuantity} {product.unit}</p></Card>
              <Card className="p-3"><span className="text-nw-muted">حد التنبيه</span><p className="mb-0 font-bold">{formatWholesaleInventory(product.reorderLevel, product.unitsPerPackage, product.purchasePackage, product.unit).cartonFormatted}</p></Card>
              <Card className="p-3"><span className="text-nw-muted">سعر الباكيت</span><p className="mb-0 font-bold"><MoneyText amount={product.retailPrice} /></p></Card>
              <Card className="p-3"><span className="text-nw-muted">سعر طرد البيع</span><p className="mb-0 font-bold"><MoneyText amount={product.salePackagePrice || 0} /></p></Card>
            </div>
            <p className="m-0 text-xs text-nw-muted">طرد الشراء: {product.purchasePackage || product.unit} × {product.unitsPerPackage || 1}</p>
            <p className="m-0 text-xs text-nw-muted">طرد البيع: {product.salePackage || 'غير مضبوط'} × {product.unitsPerSalePackage || 1}</p>
            <p className="m-0 text-xs text-nw-muted">{branches.find(b => b.id === product.branchId)?.name || activeBranch.name} · {warehouses.find(w => w.id === product.warehouseId)?.name || 'المستودع الرئيسي'}{product.warehouseLocation && ' · رف: ' + product.warehouseLocation}</p>
            <div className="grid grid-cols-2 gap-2">
              <UiButton variant="primary" onClick={() => openModal('receive_goods', { productId: product.id })}><Truck className="h-4 w-4" />استلام</UiButton>
              <UiButton onClick={() => openModal('stock_count', { productId: product.id })}><ClipboardCheck className="h-4 w-4" />جرد</UiButton>
              <UiButton onClick={() => setHistoryProduct(product)} className="col-span-2 text-xs"><History className="h-4 w-4" />سجل الحركات ({product.movementCount ?? 0})</UiButton>
              <UiButton variant="danger" onClick={() => setClearInventoryProduct(product)} title={product.onHandQuantity > 0 ? 'تصفير الرصيد مع حفظ حركة تدقيق' : 'الرصيد صفر بالفعل'} className="col-span-2 text-xs">{product.onHandQuantity > 0 ? 'حذف الرصيد' : 'الرصيد صفر'}<Trash2 className="h-4 w-4" /></UiButton>
            </div>
            <SectionHeader title="آخر الحركات" />
            {movementPage.productId !== product.id ? <p role="status" className="text-xs text-nw-muted">جارِ تحميل سجل حركات هذا المنتج…</p> :
              getProductMovements(product.id).length ? <InventoryMovements items={getProductMovements(product.id)} /> : <p className="text-xs text-nw-muted">لا توجد حركات مسجلة لهذا المنتج بعد</p>}
            {movementPage.productId === product.id && movementPage.totalPages > 1 && movementPagination}
          </div>
        </DetailPanel>}
      </DetailLayout>
    </div>
    {clearInventoryProduct && <ClearInventoryBalanceDialog product={clearInventoryProduct}
      warehouseName={warehouses.find(warehouse => warehouse.id === clearInventoryProduct.warehouseId)?.name || 'المستودع الرئيسي'}
      movementCount={inventoryProductPage.products.find(product => product.id === clearInventoryProduct.id)?.movementCount || 0}
      onClose={() => setClearInventoryProduct(null)} />}
  </div>;
};
