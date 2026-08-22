import { ArrowLeft, Layers3 } from 'lucide-react';
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

      <div className="grid auto-rows-[190px] gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[210px]">
        {featuredCategories.map((category, index) => {
          const visual = getCategoryVisual(category.code);
          const Icon = visual.icon;
          const coverUrl =
            products.find(
              (product) =>
                product.categoryId === category.id && Boolean(product.imageUrl)
            )?.imageUrl ?? '';
          const isFeatured = index === 0;
          const layoutClass =
            index === 0
              ? 'sm:col-span-2 lg:col-span-2 lg:row-span-2'
              : index === 3
                ? 'sm:col-span-2 lg:col-span-2'
                : '';

          return (
            <button
              type="button"
              key={category.id}
              onClick={() => onSelect(category.id)}
              className={`group relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br text-right shadow-[0_18px_45px_-28px_rgba(15,23,42,0.7)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_25px_55px_-28px_rgba(30,64,175,0.55)] ${visual.active} ${layoutClass}`}
            >
              <span className="absolute inset-0 grid place-items-center text-white/20">
                <Icon className={isFeatured ? 'h-28 w-28' : 'h-16 w-16'} />
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
              <span className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-transparent" />

              <span className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-white/15 text-white backdrop-blur">
                <Icon className="h-5 w-5" />
              </span>
              <span className="absolute left-4 top-4 rounded-full bg-white/95 px-3 py-1.5 text-[9px] font-black text-blue-950 shadow-sm">
                {category.productCount.toLocaleString('ar-JO')} منتج
              </span>

              <span className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
                {isFeatured && category.productCount > 0 && (
                  <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-[9px] font-black text-amber-950">
                    <Layers3 className="h-3.5 w-3.5" />
                    أكبر تشكيلة حاليًا
                  </span>
                )}
                <strong className={`block font-black ${isFeatured ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>
                  {category.nameAr}
                </strong>
                <span className="mt-2 flex items-center justify-between text-[10px] font-bold text-white/75">
                  <span>{category.productCount > 0 ? 'تصفح منتجات القسم' : 'بانتظار إضافة الأصناف'}</span>
                  <ArrowLeft className="h-4 w-4 transition group-hover:-translate-x-1" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
