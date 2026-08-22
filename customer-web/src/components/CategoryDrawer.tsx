import { Check, LayoutGrid, Menu, PackageSearch, X } from 'lucide-react';
import { useEffect } from 'react';
import type { CatalogCategory } from '../types/catalog';
import {
  ALL_CATEGORY_VISUAL,
  getCategoryVisual,
} from './categoryVisuals';

interface CategoryDrawerProps {
  isOpen: boolean;
  categories: CatalogCategory[];
  selectedCategory: string;
  totalProducts: number;
  onClose: () => void;
  onSelect: (categoryId: string) => void;
}

export function CategoryDrawer({
  isOpen,
  categories,
  selectedCategory,
  totalProducts,
  onClose,
  onSelect,
}: CategoryDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSelect = (categoryId: string) => {
    onSelect(categoryId);
    onClose();
  };

  const categoryItems = [
    {
      id: 'all',
      code: 'ALL',
      nameAr: 'جميع المنتجات',
      productCount: totalProducts,
      availableProductCount: totalProducts,
    },
    ...categories,
  ];

  return (
    <div
      className={`fixed inset-0 z-[60] transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="إغلاق قائمة الأقسام"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-drawer-title"
        className={`absolute right-0 top-0 flex h-full w-[min(92vw,390px)] flex-col overflow-hidden bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="relative overflow-hidden bg-gradient-to-br from-[#081835] to-blue-800 px-5 pb-5 pt-4 text-white">
          <div className="absolute -left-12 -top-16 h-40 w-40 rounded-full bg-cyan-400/15 blur-2xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                <Menu className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[10px] font-black text-cyan-200">
                  وصول سريع
                </p>
                <h2 id="category-drawer-title" className="mt-1 font-black">
                  أقسام المنتجات
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white transition hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="relative mt-4 text-[11px] font-semibold leading-6 text-blue-100/75">
            اختر القسم وسننقلك مباشرة إلى منتجاته وأسعاره المتوفرة.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/80 p-3">
          <div className="space-y-2">
            {categoryItems.map((category) => {
              const isAll = category.id === 'all';
              const visual = isAll
                ? ALL_CATEGORY_VISUAL
                : getCategoryVisual(category.code);
              const Icon = isAll ? LayoutGrid : visual.icon;
              const isSelected = selectedCategory === category.id;

              return (
                <button
                  type="button"
                  key={category.id}
                  aria-pressed={isSelected}
                  onClick={() => handleSelect(category.id)}
                  className={`group flex w-full items-center gap-3 rounded-3xl border p-3 text-right transition duration-200 ${
                    isSelected
                      ? 'border-blue-200 bg-white shadow-md shadow-blue-900/10'
                      : 'border-transparent bg-white/65 hover:border-slate-200 hover:bg-white'
                  }`}
                >
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
                      isSelected
                        ? `bg-gradient-to-br ${visual.active} text-white`
                        : visual.accent
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black text-slate-950">
                      {category.nameAr}
                    </span>
                    <span className="mt-1 block text-[9px] font-bold text-slate-400">
                      {category.productCount > 0
                        ? `${category.productCount.toLocaleString('ar-JO')} صنف`
                        : 'لا توجد أصناف حاليًا'}
                    </span>
                  </span>
                  {isSelected ? (
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <PackageSearch className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-blue-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <footer className="border-t border-slate-100 bg-white px-5 py-4 text-center text-[9px] font-bold text-slate-400">
          الأقسام والعدادات متزامنة مع تطبيق الإدارة
        </footer>
      </aside>
    </div>
  );
}
