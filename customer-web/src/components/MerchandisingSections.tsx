import {
  BadgePercent,
  ChevronLeft,
  ChevronRight,
  Flame,
  ImageOff,
  PackageOpen,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogProduct } from '../types/catalog';
import { formatJod } from '../utils/money';

interface MerchandisingSectionsProps {
  newest: CatalogProduct[];
  bestSellers: CatalogProduct[];
  offers: CatalogProduct[];
  lowStock: CatalogProduct[];
  onOpenProduct: (product: CatalogProduct) => void;
  onShowAll: () => void;
}

const sectionMeta = {
  newest: {
    title: 'وصل حديثًا',
    subtitle: 'أحدث الأصناف المضافة من الإدارة',
    badge: 'جديد',
    icon: Sparkles,
    color: 'text-blue-700 bg-blue-50',
    border: 'border-blue-100/90',
    glow: 'from-blue-500/12 via-cyan-400/5 to-transparent',
  },
  bestSellers: {
    title: 'الأكثر طلبًا',
    subtitle: 'حسب المبيعات المكتملة خلال 90 يومًا',
    badge: 'الأكثر طلبًا',
    icon: Flame,
    color: 'text-orange-700 bg-orange-50',
    border: 'border-orange-100/90',
    glow: 'from-orange-500/12 via-amber-400/5 to-transparent',
  },
  offers: {
    title: 'عروض الجملة',
    subtitle: 'أصناف قسم العروض الخاصة',
    badge: 'عرض',
    icon: BadgePercent,
    color: 'text-violet-700 bg-violet-50',
    border: 'border-violet-100/90',
    glow: 'from-violet-500/12 via-fuchsia-400/5 to-transparent',
  },
  lowStock: {
    title: 'قارب على النفاد',
    subtitle: 'اطلبه قبل انتهاء الكمية',
    badge: 'كمية محدودة',
    icon: PackageOpen,
    color: 'text-amber-700 bg-amber-50',
    border: 'border-amber-100/90',
    glow: 'from-amber-500/14 via-orange-400/5 to-transparent',
  },
} as const;

type SectionKind = keyof typeof sectionMeta;

function ProductRail({
  kind,
  products,
  onOpenProduct,
}: {
  kind: SectionKind;
  products: CatalogProduct[];
  onOpenProduct: (product: CatalogProduct) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const pauseUntilRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const meta = sectionMeta[kind];
  const Icon = meta.icon;

  const scrollToProduct = useCallback(
    (requestedIndex: number, manual = false) => {
      const rail = railRef.current;
      const cards = rail?.querySelectorAll<HTMLElement>('[data-merchandising-card]');
      if (!rail || !cards?.length) return;

      const nextIndex = (requestedIndex + cards.length) % cards.length;
      if (manual) pauseUntilRef.current = Date.now() + 10_000;
      cards[nextIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'start',
      });
      setActiveIndex(nextIndex);
    },
    []
  );

  useEffect(() => {
    setActiveIndex(0);
    railRef.current?.scrollTo({ left: 0, behavior: 'auto' });
  }, [kind, products]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    let animationFrame = 0;
    const updateActiveCard = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const cards = Array.from(
          rail.querySelectorAll<HTMLElement>('[data-merchandising-card]')
        );
        if (cards.length === 0) return;

        const railBox = rail.getBoundingClientRect();
        const railCenter = railBox.left + railBox.width / 2;
        const nearestIndex = cards.reduce(
          (bestIndex, card, index) => {
            const cardBox = card.getBoundingClientRect();
            const cardCenter = cardBox.left + cardBox.width / 2;
            const bestBox = cards[bestIndex].getBoundingClientRect();
            const bestCenter = bestBox.left + bestBox.width / 2;
            return Math.abs(cardCenter - railCenter) <
              Math.abs(bestCenter - railCenter)
              ? index
              : bestIndex;
          },
          0
        );
        setActiveIndex(nearestIndex);
      });
    };

    rail.addEventListener('scroll', updateActiveCard, { passive: true });
    window.addEventListener('resize', updateActiveCard);
    return () => {
      cancelAnimationFrame(animationFrame);
      rail.removeEventListener('scroll', updateActiveCard);
      window.removeEventListener('resize', updateActiveCard);
    };
  }, [products.length]);

  useEffect(() => {
    if (products.length < 2) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;

    const timer = window.setInterval(() => {
      const rail = railRef.current;
      if (
        !rail ||
        document.hidden ||
        Date.now() < pauseUntilRef.current ||
        rail.matches(':hover') ||
        rail.contains(document.activeElement)
      ) {
        return;
      }
      scrollToProduct(activeIndex + 1);
    }, 5_200);

    return () => window.clearInterval(timer);
  }, [activeIndex, products.length, scrollToProduct]);

  if (products.length === 0) return null;

  return (
    <section
      className={`relative overflow-hidden rounded-[2rem] border bg-white/95 p-4 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.55)] sm:p-5 ${meta.border}`}
      aria-label={meta.title}
    >
      <span
        className={`pointer-events-none absolute inset-0 bg-gradient-to-bl ${meta.glow}`}
        aria-hidden="true"
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${meta.color}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-950">{meta.title}</h3>
            <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{meta.subtitle}</p>
          </div>
        </div>

        {products.length > 1 && (
          <div className="flex shrink-0 items-center gap-1" aria-label={`التحكم في ${meta.title}`}>
            <button
              type="button"
              onClick={() => scrollToProduct(activeIndex - 1, true)}
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              aria-label={`المنتج السابق في ${meta.title}`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => scrollToProduct(activeIndex + 1, true)}
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              aria-label={`المنتج التالي في ${meta.title}`}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={railRef}
        className="merchandising-rail relative -mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-1"
        role="region"
        aria-roledescription="carousel"
        aria-label={`منتجات ${meta.title}`}
        onPointerDown={() => {
          pauseUntilRef.current = Date.now() + 10_000;
        }}
      >
        {products.map((product, index) => (
          <button
            type="button"
            key={product.id}
            data-merchandising-card
            data-active={index === activeIndex}
            onClick={() => onOpenProduct(product)}
            className="merchandising-card group relative flex w-[calc(100%-1rem)] min-w-[calc(100%-1rem)] items-center gap-3 overflow-hidden rounded-[1.65rem] border border-slate-200/90 bg-gradient-to-l from-white to-slate-50 p-3 text-right shadow-[0_14px_36px_-30px_rgba(15,23,42,0.65)] transition duration-300 hover:border-blue-200 sm:w-[280px] sm:min-w-[280px]"
            aria-label={`عرض تفاصيل ${product.nameAr}`}
          >
            <span className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[1.35rem] border border-slate-100 bg-white shadow-sm">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.nameAr}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain p-1.5 transition duration-500 group-hover:scale-105"
                />
              ) : (
                <span className="grid h-full place-items-center text-slate-300">
                  <ImageOff className="h-6 w-6" aria-hidden="true" />
                </span>
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-black ${meta.color}`}>
                {meta.badge}
              </span>
              <strong className="mt-2 block truncate text-sm font-black text-slate-950">{product.nameAr}</strong>
              <span className="mt-1 block truncate text-[9px] font-bold text-slate-400">
                {product.saleUnitNameAr} • {product.categoryNameAr}
              </span>
              <span className="mt-2 flex items-end justify-between gap-2">
                <span className="text-sm font-black text-orange-700">{formatJod(product.salePackagePriceInMinorUnits)}</span>
                <span className="text-[8px] font-black text-emerald-700">
                  {product.availableSalePackages.toLocaleString('ar-JO')} متاح
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {products.length > 1 && (
        <div className="relative mt-3 flex items-center justify-center gap-1.5" aria-label={`مؤشر ${meta.title}`}>
          {products.map((product, index) => (
            <button
              type="button"
              key={product.id}
              onClick={() => scrollToProduct(index, true)}
              aria-label={`عرض المنتج ${index + 1} من ${products.length}`}
              aria-current={index === activeIndex ? 'true' : undefined}
              className="grid h-11 w-11 place-items-center rounded-xl transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              <span className={`h-1.5 rounded-full transition-all duration-300 ${
                index === activeIndex ? 'w-6 bg-blue-600' : 'w-1.5 bg-slate-200 hover:bg-slate-300'
              }`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function MerchandisingSections({
  newest,
  bestSellers,
  offers,
  lowStock,
  onOpenProduct,
  onShowAll,
}: MerchandisingSectionsProps) {
  if (![newest, bestSellers, offers, lowStock].some((items) => items.length > 0)) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pb-8 lg:px-8" aria-label="اختيارات المتجر">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-blue-600">اختيارات سريعة</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">اكتشف ما يناسب محلك</h2>
        </div>
        <button
          type="button"
          onClick={onShowAll}
          className="flex min-h-11 shrink-0 items-center rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-[10px] font-black text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          عرض جميع المنتجات
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ProductRail kind="newest" products={newest} onOpenProduct={onOpenProduct} />
        <ProductRail kind="bestSellers" products={bestSellers} onOpenProduct={onOpenProduct} />
        <ProductRail kind="offers" products={offers} onOpenProduct={onOpenProduct} />
        <ProductRail kind="lowStock" products={lowStock} onOpenProduct={onOpenProduct} />
      </div>
    </section>
  );
}
