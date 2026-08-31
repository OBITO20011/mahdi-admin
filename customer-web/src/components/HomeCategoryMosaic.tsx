import { ArrowLeft } from 'lucide-react';
import type { CatalogCategory, CatalogProduct } from '../types/catalog';
import { getCategoryVisual } from './categoryVisuals';

interface HomeCategoryMosaicProps {
  categories: CatalogCategory[];
  products: CatalogProduct[];
  onSelect: (categoryId: string) => void;
  onShowAll: () => void;
}

export function HomeCategoryMosaic({
  categories,
  products,
  onSelect,
  onShowAll,
}: HomeCategoryMosaicProps) {
  const featuredCategories = [...categories]
    .sort((first, second) => second.productCount - first.productCount)
    .slice(0, 4);

  if (featuredCategories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 lg:px-8" aria-labelledby="home-categories-heading">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
            وصول أسرع لما تحتاجه
          </p>
          <h2 id="home-categories-heading" className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
            تسوّق حسب الفئة
          </h2>
          <p className="mt-2 text-xs font-bold text-slate-500">
            أقسام مختارة من كتالوج الجملة والمتصلة مباشرة بتطبيق الإدارة
          </p>
        </div>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-white px-4 py-3 text-xs font-black text-blue-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-blue-50"
        >
          عرض جميع الأقسام
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div
        data-testid="home-category-grid"
        className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-4"
      >
        {featuredCategories.map((category) => {
          const visual = getCategoryVisual(category.code);
          const Icon = visual.icon;
          const coverUrl =
            category.imageUrl ||
            products.find(
              (product) =>
                product.categoryId === category.id && Boolean(product.imageUrl)
            )?.imageUrl ||
            '';
          return (
            <button
              type="button"
              key={category.id}
              onClick={() => onSelect(category.id)}
              aria-label={`فتح قسم ${category.nameAr}`}
              className={`group relative aspect-square overflow-hidden rounded-2xl bg-gradient-to-br text-right shadow-[0_12px_30px_-22px_rgba(15,23,42,0.7)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(30,64,175,0.55)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${visual.active}`}
            >
              <span className="absolute inset-0 grid place-items-center text-white/20">
                <Icon className="h-10 w-10" />
              </span>
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/10 to-transparent" />

              <span className="absolute inset-x-2 bottom-2 rounded-xl bg-slate-950/65 px-2 py-1.5 text-center text-[10px] font-black leading-4 text-white shadow-sm backdrop-blur-sm sm:text-xs">
                <strong className="line-clamp-2 block">
                  {category.nameAr}
                </strong>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
