import {
  Heart,
  Menu,
  RefreshCw,
  Search,
  ShoppingCart,
  Tag,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CatalogProduct } from '../types/catalog';

interface StoreHeaderProps {
  activePage: 'home' | 'categories' | 'catalog';
  searchQuery: string;
  onSearchChange: (value: string) => void;
  cartPackages: number;
  favoritesCount: number;
  favoritesActive: boolean;
  onCartOpen: () => void;
  onFavoritesOpen: () => void;
  onMenuOpen: () => void;
  onCategoriesOpen: () => void;
  onHome: () => void;
  onAllProducts: () => void;
  onOffers: () => void;
  onTrackOrder: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  suggestions: CatalogProduct[];
  searchOpenSignal: number;
  onSuggestionSelect: (product: CatalogProduct) => void;
}

export function StoreHeader({
  activePage,
  searchQuery,
  onSearchChange,
  cartPackages,
  favoritesCount,
  favoritesActive,
  onCartOpen,
  onFavoritesOpen,
  onMenuOpen,
  onCategoriesOpen,
  onHome,
  onAllProducts,
  onOffers,
  onTrackOrder,
  onRefresh,
  isRefreshing,
  suggestions,
  searchOpenSignal,
  onSuggestionSelect,
}: StoreHeaderProps) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    if (searchOpenSignal < 1) return;
    setMobileSearchOpen(true);
    window.setTimeout(() => {
      document.getElementById('mobile-catalog-search')?.focus();
    }, 50);
  }, [searchOpenSignal]);

  const suggestionsList = searchQuery.trim().length > 0 && suggestions.length > 0;
  const navigation = [
    { label: 'الرئيسية', onClick: onHome, page: 'home' as const },
    { label: 'الأقسام', onClick: onCategoriesOpen, page: 'categories' as const },
    { label: 'جميع المنتجات', onClick: onAllProducts, page: 'catalog' as const },
    { label: 'العروض', onClick: onOffers, icon: Tag },
    { label: 'تتبع الطلب', onClick: onTrackOrder },
  ];

  const searchField = (mobile = false) => (
    <label className="relative block w-full">
      <Search className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        id={mobile ? 'mobile-catalog-search' : 'catalog-search'}
        autoFocus={mobile}
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="ابحث باسم المنتج أو SKU أو الباركود..."
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-11 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => onSearchChange('')}
          aria-label="مسح البحث"
          className="absolute left-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-xl bg-slate-200 text-slate-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {suggestionsList && (
        <span className="absolute inset-x-0 top-[calc(100%+.5rem)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 text-right shadow-xl">
          {suggestions.map((product) => (
            <button
              type="button"
              key={product.id}
              onClick={() => onSuggestionSelect(product)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-black text-slate-800 hover:bg-blue-50"
            >
              <span>{product.nameAr}</span>
              <small className="font-bold text-slate-400">
                {product.saleUnitNameAr}
              </small>
            </button>
          ))}
        </span>
      )}
    </label>
  );

  return (
    <>
      <div className="bg-[#081835] px-4 py-2 text-center text-[11px] font-bold text-blue-100 sm:text-xs">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          الأسعار والكميات تُحدّث مباشرة من مخزون محلات النواصرة
        </span>
      </div>

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1450px] items-center gap-3 px-4 py-3 lg:px-7">
          <button
            type="button"
            onClick={onMenuOpen}
            aria-label="فتح قائمة الأقسام"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-blue-800 transition hover:border-blue-200 hover:bg-blue-50"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button type="button" onClick={onHome} className="flex shrink-0 items-center gap-3 text-right">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-950 text-xl font-black text-white shadow-lg shadow-blue-900/20">
              ن
            </div>
            <div className="hidden sm:block">
              <p className="text-lg font-black leading-tight text-blue-900">نواصرة</p>
              <p className="text-[9px] font-bold text-amber-700">تجارة الجملة والمواد الغذائية</p>
            </div>
          </button>

          <nav className="hidden items-center gap-1 xl:flex" aria-label="التنقل الرئيسي">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={item.onClick}
                  aria-current={item.page === activePage ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black transition ${item.page === activePage ? 'bg-blue-50 text-blue-800 ring-1 ring-blue-100' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-800'}`}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mx-auto hidden w-full max-w-xl md:block">
            {searchField()}
          </div>

          <div className="mr-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              aria-label="تحديث المنتجات"
              className="hidden h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 lg:grid"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => setMobileSearchOpen((open) => !open)}
              aria-label={mobileSearchOpen ? 'إغلاق البحث' : 'فتح البحث'}
              className="grid h-11 w-11 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 md:hidden"
            >
              {mobileSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={onFavoritesOpen}
              aria-label="عرض المنتجات المفضلة"
              aria-pressed={favoritesActive}
              className={`relative grid h-11 w-11 place-items-center rounded-2xl border transition ${favoritesActive ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'}`}
            >
              <Heart className={`h-5 w-5 ${favoritesActive ? 'fill-current' : ''}`} />
              {favoritesCount > 0 && (
                <span className="absolute -left-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
                  {favoritesCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onCartOpen}
              className="relative flex h-11 items-center gap-2 rounded-2xl bg-blue-700 px-3.5 font-extrabold text-white shadow-lg shadow-blue-900/15 transition hover:bg-blue-800"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden text-xs sm:inline">السلة</span>
              {cartPackages > 0 && (
                <span className="absolute -left-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-blue-950 ring-2 ring-white">
                  {cartPackages}
                </span>
              )}
            </button>
          </div>
        </div>

        {mobileSearchOpen && (
          <div className="border-t border-slate-100 px-4 py-3 md:hidden">
            {searchField(true)}
          </div>
        )}

        <div className="border-t border-slate-100 px-4 py-2 xl:hidden">
          <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto pb-1 scrollbar-none" aria-label="روابط سريعة">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.label}
                onClick={item.onClick}
                aria-current={item.page === activePage ? 'page' : undefined}
                className={`shrink-0 rounded-xl px-3 py-2 text-[10px] font-black ${item.page === activePage ? 'bg-blue-700 text-white' : 'bg-slate-50 text-slate-700'}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
