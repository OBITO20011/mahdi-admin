import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ListFilter,
  PackageSearch,
  RefreshCw,
  RotateCcw,
  SearchX,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartDrawer } from './components/CartDrawer';
import { CategoryDrawer } from './components/CategoryDrawer';
import { CategoryShowcase } from './components/CategoryShowcase';
import { CheckoutModal } from './components/CheckoutModal';
import { FloatingContactActions } from './components/FloatingContactActions';
import { HomeCategoryMosaic } from './components/HomeCategoryMosaic';
import { NetworkStatusBanner } from './components/NetworkStatusBanner';
import { MerchandisingSections } from './components/MerchandisingSections';
import { MobileStoreNav } from './components/MobileStoreNav';
import { OrderTrackingModal } from './components/OrderTrackingModal';
import { ProductCard } from './components/ProductCard';
import { ProductDetailsModal } from './components/ProductDetailsModal';
import { PublicPosReceiptPage } from './components/PublicPosReceiptPage';
import { PromotionOffers } from './components/PromotionOffers';
import { StoreHeader } from './components/StoreHeader';
import { StoreLogoMark } from './components/StoreLogoMark';
import { StoreHero } from './components/StoreHero';
import { StoreInfoSection } from './components/StoreInfoSection';
import { DEFAULT_STOREFRONT_SETTINGS } from './config/store';
import { fetchPublicProductCatalog } from './services/catalog.service';
import { fetchPublicStorefrontOffers } from './services/offers.service';
import { fetchPublicStorefrontSettings } from './services/storefront-settings.service';
import { CartItem, CatalogCategory, CatalogProduct } from './types/catalog';
import { GuestOrderReceipt, LastGuestOrder } from './types/checkout';
import { PublicStorefrontSettings } from './types/storefront';
import { StorefrontOffer } from './types/offers';
import {
  CART_STORAGE_KEY,
  calculateCartPackages,
  calculateCartSubtotal,
  createCartItem,
  reconcileCart,
} from './utils/cart';
import {
  CatalogAvailabilityFilter,
  CatalogSortOption,
  buildCatalogView,
  isLowStockProduct,
} from './utils/catalogView';
import { buildWhatsAppUrl, readLastGuestOrder } from './utils/checkout';

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
}

type StorePage = 'home' | 'categories' | 'catalog';

function readStorePageFromHash(): StorePage {
  if (typeof window === 'undefined') return 'home';
  if (window.location.hash === '#categories') return 'categories';
  if (window.location.hash === '#catalog') return 'catalog';
  return 'home';
}

function readStoredCart(): CartItem[] {
  try {
    const storedValue = localStorage.getItem(CART_STORAGE_KEY);
    if (!storedValue) return [];
    const parsedValue = JSON.parse(storedValue);
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch {
    return [];
  }
}

const FAVORITES_STORAGE_KEY = 'nawasrah-store-favorites-v1';

function readStoredFavorites(): string[] {
  try {
    const storedValue = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!storedValue) return [];
    const parsedValue = JSON.parse(storedValue);
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function readPublicReceiptToken(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.hash.match(/^#receipt=([0-9a-f-]{36})$/i);
  return match?.[1] || '';
}

function readPublicTrackingToken(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.hash.match(/^#track=([0-9a-f-]{36})$/i);
  return match?.[1] || '';
}

export function App() {
  const [receiptToken, setReceiptToken] = useState(readPublicReceiptToken);
  const [trackingToken, setTrackingToken] = useState(readPublicTrackingToken);

  useEffect(() => {
    const handleHashChange = () => {
      setReceiptToken(readPublicReceiptToken());
      setTrackingToken(readPublicTrackingToken());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (receiptToken) return <PublicPosReceiptPage token={receiptToken} />;
  return <StorefrontApp trackingToken={trackingToken} />;
}

function StorefrontApp({ trackingToken }: { trackingToken: string }) {
  const [activePage, setActivePage] = useState<StorePage>(readStorePageFromHash);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<
    CatalogCategory[]
  >([]);
  const [cartItems, setCartItems] = useState<CartItem[]>(readStoredCart);
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>(
    readStoredFavorites
  );
  const [storefrontOffers, setStorefrontOffers] = useState<StorefrontOffer[]>([]);
  const [preferredPromotionCode, setPreferredPromotionCode] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] =
    useState<CatalogAvailabilityFilter>('all');
  const [sortOption, setSortOption] =
    useState<CatalogSortOption>('recommended');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [selectedSaleUnit, setSelectedSaleUnit] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [cartOpen, setCartOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [searchOpenSignal, setSearchOpenSignal] = useState(0);
  const [lastGuestOrder, setLastGuestOrder] = useState<LastGuestOrder | null>(() => readLastGuestOrder(window.localStorage));
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [storefrontSettings, setStorefrontSettings] =
    useState<PublicStorefrontSettings>(DEFAULT_STOREFRONT_SETTINGS);

  useEffect(() => {
    if (trackingToken) setTrackingOpen(true);
  }, [trackingToken]);

  const showToast = useCallback(
    (message: string, type: ToastState['type'] = 'success') => {
      setToast({ message, type });
      window.setTimeout(() => setToast(null), 2800);
    },
    []
  );

  const loadCatalog = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const catalog = await fetchPublicProductCatalog();
      setProducts(catalog.items);
      setCatalogCategories(catalog.categories);
      setLoadError(null);
      setLastUpdatedAt(new Date());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'تعذر تحميل كتالوج الجملة من Supabase.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadStorefrontSettings = useCallback(async () => {
    try {
      setStorefrontSettings(await fetchPublicStorefrontSettings());
    } catch (error) {
      console.error('[Storefront settings]', error);
    }
  }, []);

  const loadStorefrontOffers = useCallback(async () => {
    try {
      setStorefrontOffers(await fetchPublicStorefrontOffers());
    } catch (error) {
      console.error('[Storefront offers]', error);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadStorefrontSettings();
    void loadStorefrontOffers();
    const intervalId = window.setInterval(() => {
      void loadCatalog(true);
      void loadStorefrontSettings();
      void loadStorefrontOffers();
    }, 30_000);
    const handleFocus = () => {
      void loadCatalog(true);
      void loadStorefrontOffers();
    };
    const handleOnline = () => {
      setIsOnline(true);
      void loadCatalog(true);
      void loadStorefrontSettings();
      void loadStorefrontOffers();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadCatalog, loadStorefrontOffers, loadStorefrontSettings]);

  useEffect(() => {
    if (products.length === 0) return;
    setCartItems((currentItems) => reconcileCart(currentItems, products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(favoriteProductIds)
    );
  }, [favoriteProductIds]);

  useEffect(() => {
    const syncProductFromHash = () => {
      if (!window.location.hash.startsWith('#product=')) {
        setSelectedProductId(null);
        setActivePage(readStorePageFromHash());
        return;
      }

      let productKey = '';
      try {
        productKey = decodeURIComponent(
          window.location.hash.slice('#product='.length)
        );
      } catch {
        productKey = '';
      }

      const matchedProduct = products.find(
        (product) => product.sku === productKey || product.id === productKey
      );
      setSelectedProductId(matchedProduct?.id ?? null);
    };

    syncProductFromHash();
    window.addEventListener('hashchange', syncProductFromHash);
    window.addEventListener('popstate', syncProductFromHash);

    return () => {
      window.removeEventListener('hashchange', syncProductFromHash);
      window.removeEventListener('popstate', syncProductFromHash);
    };
  }, [products]);

  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      catalogCategories.length > 0 &&
      !catalogCategories.some((category) => category.id === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [catalogCategories, selectedCategory]);

  const filteredProducts = useMemo(
    () => {
      const catalogView = buildCatalogView(products, {
        searchQuery,
        categoryId: selectedCategory,
        availability: availabilityFilter,
        sort: sortOption,
        brandId: selectedBrand,
        saleUnitId: selectedSaleUnit,
      });
      return favoritesOnly
        ? catalogView.filter((product) => favoriteProductIds.includes(product.id))
        : catalogView;
    },
    [
      availabilityFilter,
      products,
      searchQuery,
      selectedCategory,
      sortOption,
      selectedBrand,
      selectedSaleUnit,
      favoritesOnly,
      favoriteProductIds,
    ]
  );

  const cartQuantityByProduct = useMemo(
    () =>
      new Map(
        cartItems.map((item) => [item.productId, item.quantity] as const)
      ),
    [cartItems]
  );
  const selectedProduct = useMemo(
    () =>
      products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const relatedProducts = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter(
        (product) =>
          product.id !== selectedProduct.id &&
          product.categoryId === selectedProduct.categoryId
      )
      .slice(0, 4);
  }, [products, selectedProduct]);
  const cartPackages = calculateCartPackages(cartItems);
  const availablePackages = products.reduce(
    (sum, product) => sum + product.availableSalePackages,
    0
  );
  const availableProductsCount = products.filter(
    (product) => product.isAvailable
  ).length;
  const lowStockProductsCount = products.filter(isLowStockProduct).length;
  const selectedCategoryDetails = catalogCategories.find(
    (category) => category.id === selectedCategory
  );
  const hasActiveCatalogView =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== 'all' ||
    availabilityFilter !== 'all' ||
    sortOption !== 'recommended' ||
    selectedBrand !== 'all' ||
    selectedSaleUnit !== 'all' ||
    favoritesOnly;

  const brands = useMemo(() => Array.from(new Map(products.filter((product) => product.brandId).map((product) => [product.brandId, product.brandNameAr || 'ماركة غير مسماة'])).entries()).sort((a, b) => a[1].localeCompare(b[1], 'ar')), [products]);
  const saleUnits = useMemo(() => Array.from(new Map(products.map((product) => [product.saleUnitId, product.saleUnitNameAr])).entries()).sort((a, b) => a[1].localeCompare(b[1], 'ar')), [products]);
  const searchSuggestions = useMemo(() => searchQuery.trim() ? buildCatalogView(products, { searchQuery, categoryId: 'all', availability: 'all', sort: 'recommended' }).slice(0, 5) : [], [products, searchQuery]);
  const newestProducts = useMemo(() => [...products].filter((product) => product.isAvailable).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()).slice(0, 6), [products]);
  const bestSellerProducts = useMemo(() => [...products].filter((product) => product.isAvailable && product.soldPackagesLast90Days > 0).sort((a, b) => b.soldPackagesLast90Days - a.soldPackagesLast90Days).slice(0, 6), [products]);
  const offerProducts = useMemo(() => products.filter((product) => product.isAvailable && product.categoryCode === 'CAT-OFFERS').slice(0, 6), [products]);
  const lowStockProducts = useMemo(() => products.filter(isLowStockProduct).slice(0, 6), [products]);
  const cartSubtotal = calculateCartSubtotal(cartItems);
  const storeWhatsappUrl = buildWhatsAppUrl(storefrontSettings.whatsappNumber, `مرحبًا ${storefrontSettings.storeNameAr}، أريد الاستفسار عن أصناف الجملة.`);

  const addQuantityToCart = (
    product: CatalogProduct,
    requestedQuantity = 1
  ) => {
    if (!product.isAvailable) {
      showToast('هذا الصنف غير متوفر حاليًا.', 'error');
      return;
    }

    const existingItem = cartItems.find(
      (item) => item.productId === product.id
    );
    const remainingPackages = Math.max(
      0,
      product.availableSalePackages - (existingItem?.quantity ?? 0)
    );
    if (remainingPackages === 0) {
      showToast('وصلت إلى كامل الكمية المتاحة من هذا الصنف.', 'info');
      return;
    }

    const quantityToAdd = Math.min(
      remainingPackages,
      Math.max(1, Math.floor(requestedQuantity || 1))
    );

    setCartItems((currentItems) => {
      const currentItem = currentItems.find(
        (item) => item.productId === product.id
      );
      if (!currentItem) {
        return [
          ...currentItems,
          { ...createCartItem(product), quantity: quantityToAdd },
        ];
      }
      return currentItems.map((item) =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + quantityToAdd }
          : item
      );
    });
    showToast(
      `تمت إضافة ${quantityToAdd.toLocaleString('ar-JO')} ${
        product.saleUnitNameAr
      } من ${product.nameAr}.`
    );
  };

  const addToCart = (product: CatalogProduct) => {
    addQuantityToCart(product, 1);
  };

  const openProductDetails = useCallback((product: CatalogProduct) => {
    setSelectedProductId(product.id);
    const nextHash = `#product=${encodeURIComponent(
      product.sku || product.id
    )}`;
    if (window.location.hash === nextHash) return;

    if (window.location.hash.startsWith('#product=')) {
      window.history.replaceState(null, '', nextHash);
    } else {
      window.history.pushState(null, '', nextHash);
    }
  }, []);

  const closeProductDetails = useCallback(() => {
    setSelectedProductId(null);
    if (window.location.hash.startsWith('#product=')) {
      window.history.replaceState(null, '', `#${activePage}`);
    }
  }, [activePage]);

  const updateCartQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCartItems((items) =>
        items.filter((item) => item.productId !== productId)
      );
      return;
    }

    setCartItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? {
              ...item,
              quantity: Math.min(
                Math.max(1, Math.floor(quantity)),
                item.maxAvailablePackages
              ),
            }
          : item
      )
    );
  };

  const resetCatalogView = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setAvailabilityFilter('all');
    setSortOption('recommended');
    setSelectedBrand('all');
    setSelectedSaleUnit('all');
    setFavoritesOnly(false);
  };

  const navigateStorePage = useCallback((page: StorePage) => {
    setActivePage(page);
    const nextHash = `#${page}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  const scrollToCatalog = () => {
    setActivePage('catalog');
    if (window.location.hash !== '#catalog') {
      window.history.pushState(null, '', '#catalog');
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById('catalog-products')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  };

  const showAllProducts = () => {
    resetCatalogView();
    scrollToCatalog();
  };

  const toggleFavoritesView = () => {
    if (favoriteProductIds.length === 0 && !favoritesOnly) {
      showToast('اضغط رمز القلب على أي منتج لإضافته إلى المفضلة.', 'info');
    }
    setFavoritesOnly((current) => !current);
    scrollToCatalog();
  };

  const toggleProductFavorite = (product: CatalogProduct) => {
    setFavoriteProductIds((current) => {
      const isFavorite = current.includes(product.id);
      showToast(
        isFavorite
          ? `تمت إزالة ${product.nameAr} من المفضلة.`
          : `تمت إضافة ${product.nameAr} إلى المفضلة.`
      );
      return isFavorite
        ? current.filter((productId) => productId !== product.id)
        : [...current, product.id];
    });
  };

  const selectCatalogCategory = useCallback((categoryId: string) => {
    setActivePage('catalog');
    setSelectedCategory(categoryId);
    setSearchQuery('');
    setAvailabilityFilter('all');
    setCategoriesOpen(false);
    if (window.location.hash !== '#catalog') {
      window.history.pushState(null, '', '#catalog');
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById('catalog-products')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  }, []);

  const openCheckout = () => {
    if (cartItems.length === 0) {
      showToast('السلة فارغة. أضف طردًا أولًا.', 'info');
      return;
    }
    if (!storefrontSettings.ordersEnabled) {
      showToast('الطلبات متوقفة مؤقتًا من إدارة المتجر. تواصل معنا عبر واتساب.', 'info');
      return;
    }
    if (cartSubtotal < storefrontSettings.minimumOrderInMinorUnits) {
      showToast(`الحد الأدنى للطلب هو ${(storefrontSettings.minimumOrderInMinorUnits / 1000).toFixed(3)} د.أ.`, 'info');
      return;
    }
    setCartOpen(false);
    setCheckoutOpen(true);
  };

  const handleOrderCreated = (receipt: GuestOrderReceipt, submittedItems: CartItem[]) => {
    setCartItems([]);
    setPreferredPromotionCode('');
    setLastGuestOrder({ version: 1, orderNumber: receipt.orderNumber, items: submittedItems.map((item) => ({ productId: item.productId, quantity: item.quantity })), createdAt: Date.now() });
    showToast(`تم تسجيل الطلب ${receipt.orderNumber} بنجاح.`);
    void loadCatalog(true);
  };

  const usePromotionOffer = (offer: StorefrontOffer) => {
    setPreferredPromotionCode(offer.code);
    void navigator.clipboard?.writeText(offer.code).catch(() => undefined);
    showToast(`تم تجهيز رمز ${offer.code}. سيظهر تلقائيًا عند إتمام الطلب.`);
    if (cartItems.length > 0) {
      setCartOpen(true);
      return;
    }
    showAllProducts();
  };

  const openPromotionOffers = () => {
    if (storefrontOffers.length === 0) {
      const offersCategory = catalogCategories.find(
        (category) => category.code === 'CAT-OFFERS'
      );
      if (offersCategory) selectCatalogCategory(offersCategory.id);
      else showAllProducts();
      return;
    }

    setActivePage('home');
    if (window.location.hash !== '#home') {
      window.history.pushState(null, '', '#home');
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document.getElementById('storefront-offers')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    });
  };

  const repeatLastOrder = () => {
    if (!lastGuestOrder) return;
    const restored = lastGuestOrder.items.flatMap((saved) => {
      const product = products.find((item) => item.id === saved.productId);
      if (!product?.isAvailable) return [];
      return [{ ...createCartItem(product), quantity: Math.min(saved.quantity, product.availableSalePackages) }];
    });
    if (restored.length === 0) {
      showToast('أصناف الطلب السابق غير متوفرة حاليًا.', 'info');
      return;
    }
    setCartItems(reconcileCart(restored, products));
    setCartOpen(true);
    showToast(`تمت إعادة ${restored.length.toLocaleString('ar-JO')} أصناف متوفرة من طلبك السابق.`);
  };

  return (
    <div className="min-h-screen bg-[#fbf7f0] text-slate-900">
      <StoreHeader
        activePage={activePage}
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
          if (value.trim() && activePage !== 'catalog') {
            setActivePage('catalog');
            window.history.pushState(null, '', '#catalog');
          }
        }}
        cartPackages={cartPackages}
        favoritesCount={favoriteProductIds.length}
        favoritesActive={favoritesOnly}
        onCartOpen={() => setCartOpen(true)}
        onFavoritesOpen={toggleFavoritesView}
        onMenuOpen={() => setCategoriesOpen(true)}
        onCategoriesOpen={() => navigateStorePage('categories')}
        onHome={() => navigateStorePage('home')}
        onAllProducts={showAllProducts}
        onOffers={openPromotionOffers}
        onTrackOrder={() => setTrackingOpen(true)}
        onRefresh={() => void loadCatalog(true)}
        isRefreshing={isRefreshing}
        suggestions={searchSuggestions}
        searchOpenSignal={searchOpenSignal}
        onSuggestionSelect={(product) => { setSearchQuery(''); openProductDetails(product); }}
      />

      <NetworkStatusBanner
        isOnline={isOnline}
        refreshError={products.length > 0 ? loadError : null}
        lastUpdatedAt={lastUpdatedAt}
        isRetrying={isRefreshing}
        onRetry={() => void loadCatalog(true)}
      />

      {!storefrontSettings.ordersEnabled && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-xs font-black text-amber-800">
          الطلبات متوقفة مؤقتًا، لكن يمكنك تصفح الأصناف والتواصل معنا عبر واتساب.
        </div>
      )}

      <main>
        {activePage === 'home' && (
          <>
        <StoreHero
          productsCount={products.length}
          categoriesCount={catalogCategories.length}
          availablePackages={availablePackages}
          onBrowseProducts={showAllProducts}
          announcementText={storefrontSettings.announcementText}
        />

        {storefrontSettings.showOffers && (
          <PromotionOffers
            offers={storefrontOffers}
            onUseOffer={usePromotionOffer}
          />
        )}

        <HomeCategoryMosaic
          categories={catalogCategories}
          products={products}
          onSelect={selectCatalogCategory}
          onShowAll={() => navigateStorePage('categories')}
        />

        <MerchandisingSections
          newest={storefrontSettings.showNewestProducts ? newestProducts : []}
          bestSellers={storefrontSettings.showBestSellers ? bestSellerProducts : []}
          offers={storefrontSettings.showOffers ? offerProducts : []}
          lowStock={storefrontSettings.showLowStock ? lowStockProducts : []}
          onOpenProduct={openProductDetails}
          onShowAll={showAllProducts}
        />
          </>
        )}

        {activePage === 'categories' && (
          <section id="categories-page" className="min-h-[70vh] bg-gradient-to-b from-blue-50/50 to-[#fbf7f0] py-10 sm:py-14">
            <div className="mx-auto max-w-7xl px-4 lg:px-8">
              <CategoryShowcase
                categories={catalogCategories}
                products={products}
                selectedCategory={selectedCategory}
                totalProducts={products.length}
                onSelect={selectCatalogCategory}
              />
            </div>
          </section>
        )}

        {activePage === 'catalog' && (
        <section id="catalog" className="relative z-10 min-h-[70vh] py-8 pb-24 sm:py-12">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <div className="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-900/5 backdrop-blur sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 text-blue-700">
                    <Boxes className="h-5 w-5" />
                    <span className="text-xs font-black">الكتالوج المباشر</span>
                  </div>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">
                    أصناف الجملة المتوفرة
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-slate-500">
                    كل كمية هنا محسوبة كطرد بيع كامل، وليس بيعًا بالحبة.
                  </p>
                </div>

                <div className="flex flex-col items-start gap-2 text-[10px] font-bold text-slate-600 sm:items-end">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
                      isOnline && !loadError
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {isOnline && !loadError ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                    {isOnline && !loadError
                      ? 'متصل بـSupabase'
                      : isOnline
                        ? 'آخر تحديث لم يكتمل'
                        : 'بدون اتصال'}
                  </span>
                  {lastUpdatedAt && (
                    <span>
                      آخر تحديث:{' '}
                      {lastUpdatedAt.toLocaleTimeString('ar-JO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      {
                        value: 'all',
                        label: `كل الحالات (${products.length.toLocaleString(
                          'ar-JO'
                        )})`,
                      },
                      {
                        value: 'available',
                        label: `متوفر (${availableProductsCount.toLocaleString(
                          'ar-JO'
                        )})`,
                      },
                      {
                        value: 'low_stock',
                        label: `قارب على النفاد (${lowStockProductsCount.toLocaleString(
                          'ar-JO'
                        )})`,
                      },
                    ] as const
                  ).map((filter) => (
                    <button
                      type="button"
                      key={filter.value}
                      onClick={() => setAvailabilityFilter(filter.value)}
                      className={`rounded-2xl px-3.5 py-2 text-[10px] font-black transition sm:text-xs ${
                        availabilityFilter === filter.value
                          ? 'bg-emerald-700 text-white shadow-md shadow-emerald-900/15'
                          : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-emerald-200'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <label className="flex min-w-52 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <ListFilter className="h-4 w-4 shrink-0 text-blue-700" />
                  <span className="text-[10px] font-black text-slate-500">
                    ترتيب:
                  </span>
                  <select
                    value={sortOption}
                    onChange={(event) =>
                      setSortOption(event.target.value as CatalogSortOption)
                    }
                    className="min-w-0 flex-1 bg-transparent text-xs font-black text-slate-800 outline-none"
                  >
                    <option value="recommended">المقترح</option>
                    <option value="name_asc">الاسم</option>
                    <option value="price_asc">السعر: الأقل أولًا</option>
                    <option value="price_desc">السعر: الأعلى أولًا</option>
                    <option value="stock_desc">الأكثر توفرًا</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black text-slate-500">الماركة<select value={selectedBrand} onChange={(event) => setSelectedBrand(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-slate-800 outline-none"><option value="all">جميع الماركات</option>{brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black text-slate-500">نوع الطرد<select value={selectedSaleUnit} onChange={(event) => setSelectedSaleUnit(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-slate-800 outline-none"><option value="all">جميع أنواع الطرود</option>{saleUnits.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              </div>

              {lastGuestOrder && <button type="button" onClick={repeatLastOrder} className="mt-3 w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-black text-blue-800">إعادة آخر طلب ({lastGuestOrder.orderNumber})</button>}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[10px] font-bold text-slate-600">
                  عرض {filteredProducts.length.toLocaleString('ar-JO')} من{' '}
                  {products.length.toLocaleString('ar-JO')} صنف
                </p>
                {hasActiveCatalogView && (
                  <button
                    type="button"
                    onClick={resetCatalogView}
                    className="inline-flex items-center gap-1.5 text-[10px] font-black text-blue-700 transition hover:text-blue-900"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    إعادة ضبط العرض
                  </button>
                )}
              </div>
            </div>

            <div id="catalog-products" className="scroll-mt-40">
            {isLoading ? (
              <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-[430px] animate-pulse rounded-[1.75rem] border border-slate-200 bg-white p-4"
                  >
                    <div className="h-52 rounded-3xl bg-slate-100" />
                    <div className="mt-5 h-4 w-2/3 rounded bg-slate-100" />
                    <div className="mt-3 h-3 w-1/3 rounded bg-slate-100" />
                    <div className="mt-7 h-16 rounded-2xl bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : loadError && products.length === 0 ? (
              <div className="mt-6 rounded-[2rem] border border-rose-200 bg-white p-10 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
                <h3 className="mt-4 text-lg font-black text-slate-900">
                  تعذر فتح كتالوج الجملة
                </h3>
                <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-slate-500">
                  {loadError}
                </p>
                <button
                  type="button"
                  onClick={() => void loadCatalog()}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-700 px-5 py-3 text-xs font-black text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-10 text-center">
                {searchQuery ? (
                  <SearchX className="mx-auto h-10 w-10 text-slate-400" />
                ) : (
                  <PackageSearch className="mx-auto h-10 w-10 text-slate-400" />
                )}
                <h3 className="mt-4 font-black text-slate-900">
                  {searchQuery
                    ? 'لا توجد نتيجة مطابقة'
                    : selectedCategoryDetails
                      ? `لا توجد أصناف داخل ${selectedCategoryDetails.nameAr} حاليًا`
                    : 'لا توجد أصناف جملة جاهزة للعرض'}
                </h3>
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  {searchQuery
                    ? 'جرّب اسمًا أو SKU مختلفًا.'
                    : selectedCategoryDetails
                      ? 'عند إسناد صنف لهذا القسم من تطبيق الإدارة سيظهر هنا تلقائيًا.'
                    : 'عند إضافة صنف مكتمل من تطبيق الإدارة سيظهر هنا تلقائيًا.'}
                </p>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    cartQuantity={cartQuantityByProduct.get(product.id) || 0}
                    isFavorite={favoriteProductIds.includes(product.id)}
                    onAdd={addToCart}
                    onQuantityChange={updateCartQuantity}
                    onOpenDetails={openProductDetails}
                    onToggleFavorite={toggleProductFavorite}
                  />
                ))}
              </div>
            )}
            </div>
          </div>
        </section>
        )}

        {activePage === 'home' && (
          <>
        <StoreInfoSection whatsappUrl={storeWhatsappUrl} onTrackOrder={() => setTrackingOpen(true)} settings={storefrontSettings} />

        <section className="border-y border-slate-200 bg-white py-12">
          <div className="mx-auto grid max-w-7xl gap-4 px-4 sm:grid-cols-3 lg:px-8">
            {[
              {
                icon: ShieldCheck,
                title: 'أسعار آمنة',
                text: 'الموقع يعرض سعر البيع فقط ولا يكشف تكلفة الشراء.',
              },
              {
                icon: Boxes,
                title: 'طرود جملة فقط',
                text: 'كل كمية في السلة تمثل كرتونة أو شرنك أو صندوقًا كاملاً.',
              },
              {
                icon: Truck,
                title: 'مخزون موحّد',
                text: 'إضافة المنتج وتعديل سعره من الإدارة ينعكسان على الكتالوج.',
              },
            ].map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div
                  key={benefit.title}
                  className="flex items-start gap-3 rounded-3xl bg-slate-50 p-5"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">
                      {benefit.title}
                    </h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      {benefit.text}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
          </>
        )}
      </main>

      <CategoryDrawer
        isOpen={categoriesOpen}
        categories={catalogCategories}
        selectedCategory={selectedCategory}
        totalProducts={products.length}
        onClose={() => setCategoriesOpen(false)}
        onSelect={selectCatalogCategory}
      />

      <footer className="bg-[#08152e] px-4 pb-28 pt-10 text-blue-100 md:py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between lg:px-4">
          <div className="flex items-center gap-3">
            <StoreLogoMark className="h-12 w-16" />
            <div>
              <p className="font-black text-white">{storefrontSettings.storeNameAr}</p>
              <p className="mt-1 text-[10px] font-bold text-blue-200/60">
                الرمثا، الأردن • تجارة الجملة
              </p>
            </div>
          </div>
          <p className="text-[10px] font-bold text-blue-200">
            البيانات المعروضة مرتبطة بنظام إدارة المخزون.
          </p>
        </div>
      </footer>

      {selectedProduct && (
        <ProductDetailsModal
          product={selectedProduct}
          cartQuantity={
            cartQuantityByProduct.get(selectedProduct.id) || 0
          }
          relatedProducts={relatedProducts}
          onClose={closeProductDetails}
          onAddQuantity={addQuantityToCart}
          onOpenProduct={openProductDetails}
          storeWhatsAppNumber={storefrontSettings.whatsappNumber}
          isFavorite={favoriteProductIds.includes(selectedProduct.id)}
          onToggleFavorite={toggleProductFavorite}
        />
      )}

      <CartDrawer
        isOpen={cartOpen}
        items={cartItems}
        onClose={() => setCartOpen(false)}
        onQuantityChange={updateCartQuantity}
        onRemove={(productId) =>
          setCartItems((items) =>
            items.filter((item) => item.productId !== productId)
          )
        }
        onClear={() => setCartItems([])}
        onCheckout={openCheckout}
      />

      <CheckoutModal
        isOpen={checkoutOpen}
        items={cartItems}
        storeWhatsAppNumber={storefrontSettings.whatsappNumber}
        storefrontSettings={storefrontSettings}
        initialPromotionCode={preferredPromotionCode}
        onClose={() => setCheckoutOpen(false)}
        onOrderCreated={handleOrderCreated}
      />

      <OrderTrackingModal
        isOpen={trackingOpen}
        trackingToken={trackingToken}
        onClose={() => {
          setTrackingOpen(false);
          if (trackingToken) {
            window.history.replaceState(null, '', '#home');
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }
        }}
      />

      <MobileStoreNav cartPackages={cartPackages} cartTotal={cartSubtotal} whatsappUrl={storeWhatsappUrl} onHome={() => navigateStorePage('home')} onCategories={() => navigateStorePage('categories')} onSearch={() => { setActivePage('catalog'); if (window.location.hash !== '#catalog') window.history.pushState(null, '', '#catalog'); setSearchOpenSignal((value) => value + 1); }} onCart={() => setCartOpen(true)} />

      <FloatingContactActions whatsappUrl={storeWhatsappUrl} />

      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-2xl px-4 py-3 text-xs font-extrabold text-white shadow-2xl ${
            toast.type === 'error'
              ? 'bg-rose-600'
              : toast.type === 'info'
              ? 'bg-slate-800'
              : 'bg-emerald-600'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}
    </div>
  );
}
