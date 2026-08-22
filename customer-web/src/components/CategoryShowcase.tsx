import { ArrowLeft, CheckCircle2, ImageOff } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CatalogCategory, CatalogProduct } from '../types/catalog';
import {
  ALL_CATEGORY_VISUAL,
  getCategoryVisual,
} from './categoryVisuals';

interface CategoryShowcaseProps {
  categories: CatalogCategory[];
  products: CatalogProduct[];
  selectedCategory: string;
  totalProducts: number;
  onSelect: (categoryId: string) => void;
}

interface CategoryCardData {
  id: string;
  name: string;
  count: number;
  code: string;
  coverUrl: string;
}

function CategoryCard({
  category,
  isSelected,
  index,
  onSelect,
}: {
  category: CategoryCardData;
  isSelected: boolean;
  index: number;
  onSelect: (id: string) => void;
}) {
  const resolvedVisual =
    category.id === 'all'
      ? ALL_CATEGORY_VISUAL
      : getCategoryVisual(category.code);
  const Icon = resolvedVisual.icon;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(category.id)}
      style={{ animationDelay: `${Math.min(index * 45, 540)}ms` } as CSSProperties}
      className={`category-card-enter group relative flex min-h-[310px] w-[82vw] max-w-[330px] shrink-0 snap-center flex-col overflow-hidden rounded-[1.75rem] border bg-white text-right shadow-[0_16px_45px_-30px_rgba(15,23,42,0.55)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_55px_-30px_rgba(30,64,175,0.45)] sm:w-[300px] lg:w-auto lg:max-w-none ${
        isSelected
          ? 'border-blue-500 ring-4 ring-blue-100'
          : 'border-slate-200/90 hover:border-blue-200'
      }`}
    >
      <span className={`relative block h-44 w-full overflow-hidden bg-gradient-to-br ${resolvedVisual.active}`}>
        <span className="absolute inset-0 grid place-items-center text-white/30">
          {category.coverUrl ? (
            <ImageOff className="h-10 w-10" />
          ) : (
            <Icon className="h-16 w-16" />
          )}
        </span>
        {category.coverUrl && (
          <img
            src={category.coverUrl}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-slate-950/55 via-transparent to-slate-950/5" />

        <span className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-2xl border border-white/25 bg-white/90 text-blue-800 shadow-lg backdrop-blur">
          <Icon className="h-5 w-5" />
        </span>
        <span className="absolute left-4 top-4 rounded-full border border-white/60 bg-white/95 px-3 py-1.5 text-[10px] font-black text-blue-900 shadow-sm backdrop-blur">
          {category.count.toLocaleString('ar-JO')} منتج
        </span>
        {isSelected && (
          <span className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full bg-blue-700 px-3 py-1.5 text-[9px] font-black text-white shadow-lg">
            <CheckCircle2 className="h-3.5 w-3.5" />
            القسم المحدد
          </span>
        )}
      </span>

      <span className="flex flex-1 flex-col p-5">
        <span className="block truncate text-lg font-black text-slate-950">
          {category.name}
        </span>
        <span className="mt-2 block min-h-10 text-[11px] font-bold leading-5 text-slate-500">
          {category.count > 0
            ? `اكتشف أصناف الجملة المتوفرة داخل قسم ${category.name}`
            : 'سيظهر محتوى هذا القسم تلقائيًا عند إضافة أصناف إليه من تطبيق الإدارة'}
        </span>
        <span className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-black text-blue-800">
          <span>{category.count > 0 ? 'تصفح المنتجات' : 'عرض القسم'}</span>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 transition group-hover:-translate-x-1 group-hover:bg-blue-700 group-hover:text-white">
            <ArrowLeft className="h-4 w-4" />
          </span>
        </span>
      </span>
    </button>
  );
}

export function CategoryShowcase({
  categories,
  products,
  selectedCategory,
  totalProducts,
  onSelect,
}: CategoryShowcaseProps) {
  const firstCatalogImage =
    products.find((product) => Boolean(product.imageUrl))?.imageUrl ?? '';
  const categoryItems: CategoryCardData[] = [
    {
      id: 'all',
      name: 'جميع المنتجات',
      count: totalProducts,
      code: 'ALL',
      coverUrl: firstCatalogImage,
    },
    ...categories.map((category) => ({
      id: category.id,
      name: category.nameAr,
      count: category.productCount,
      code: category.code,
      coverUrl:
        products.find(
          (product) =>
            product.categoryId === category.id && Boolean(product.imageUrl)
        )?.imageUrl ?? '',
    })),
  ];

  return (
    <section aria-labelledby="catalog-categories-heading" className="mt-7">
      <div className="mb-6 rounded-[1.75rem] border border-slate-200 bg-gradient-to-l from-white to-blue-50/50 px-5 py-6 shadow-sm sm:px-7">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
          وصول أسرع
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3
              id="catalog-categories-heading"
              className="text-xl font-black text-blue-950 sm:text-2xl"
            >
              أقسام متجر نواصرة
            </h3>
            <p className="mt-2 text-[11px] font-bold leading-5 text-slate-500">
              اختر القسم الذي تريده وسننقلك مباشرة إلى أصنافه المتوفرة
            </p>
          </div>
          <p className="rounded-full bg-white px-3 py-2 text-[10px] font-black text-slate-500 shadow-sm">
            {categories.length.toLocaleString('ar-JO')} قسم مرتبط بتطبيق الإدارة
          </p>
        </div>
      </div>

      <div className="category-scroll flex snap-x snap-mandatory gap-4 overflow-x-auto pb-5 lg:grid lg:grid-cols-3 lg:overflow-visible xl:grid-cols-4">
        {categoryItems.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            isSelected={selectedCategory === category.id}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
