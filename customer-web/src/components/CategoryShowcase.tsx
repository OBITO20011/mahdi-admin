import { ImageOff } from 'lucide-react';
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
      aria-label={`فتح قسم ${category.name}`}
      onClick={() => onSelect(category.id)}
      style={{ animationDelay: `${Math.min(index * 45, 540)}ms` } as CSSProperties}
      className={`category-card-enter group relative aspect-square w-full overflow-hidden rounded-2xl border bg-white text-right shadow-[0_12px_30px_-22px_rgba(15,23,42,0.55)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(30,64,175,0.45)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${
        isSelected
          ? 'border-blue-600 ring-2 ring-blue-100'
          : 'border-slate-200/90 hover:border-blue-200'
      }`}
    >
      <span
        className={`absolute inset-0 grid place-items-center overflow-hidden bg-gradient-to-br ${resolvedVisual.active}`}
      >
        <span className="absolute inset-0 grid place-items-center text-white/30">
          {category.coverUrl ? (
            <ImageOff className="h-7 w-7" />
          ) : (
            <Icon className="h-10 w-10" />
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
        <span className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-transparent" />

        {isSelected && (
          <span
            className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-blue-500 shadow-sm"
            aria-hidden="true"
          />
        )}

        <span className="absolute inset-x-2 bottom-2 rounded-xl bg-slate-950/65 px-2 py-1.5 text-center text-[10px] font-black leading-4 text-white shadow-sm backdrop-blur-sm sm:text-xs">
          <span className="line-clamp-2">
            {category.name}
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
        category.imageUrl ||
        products.find(
          (product) =>
            product.categoryId === category.id && Boolean(product.imageUrl)
        )?.imageUrl ||
        '',
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

      <div
        data-testid="category-grid"
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-5 xl:grid-cols-6"
      >
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
