import {
  BadgePercent,
  Flame,
  ImageOff,
  PackageOpen,
  Sparkles,
} from 'lucide-react';
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
  newest: { title: 'وصل حديثًا', subtitle: 'أحدث الأصناف المضافة من الإدارة', icon: Sparkles, color: 'text-blue-700 bg-blue-50' },
  bestSellers: { title: 'الأكثر طلبًا', subtitle: 'حسب المبيعات المكتملة خلال 90 يومًا', icon: Flame, color: 'text-orange-700 bg-orange-50' },
  offers: { title: 'عروض الجملة', subtitle: 'أصناف قسم العروض الخاصة', icon: BadgePercent, color: 'text-violet-700 bg-violet-50' },
  lowStock: { title: 'قارب على النفاد', subtitle: 'اطلبه قبل انتهاء الكمية', icon: PackageOpen, color: 'text-amber-700 bg-amber-50' },
} as const;

function ProductRail({
  kind,
  products,
  onOpenProduct,
}: {
  kind: keyof typeof sectionMeta;
  products: CatalogProduct[];
  onOpenProduct: (product: CatalogProduct) => void;
}) {
  if (products.length === 0) return null;
  const meta = sectionMeta[kind];
  const Icon = meta.icon;
  return (
    <section className="rounded-[2rem] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 place-items-center rounded-2xl ${meta.color}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-black text-slate-950">{meta.title}</h3>
          <p className="mt-1 text-[10px] font-bold text-slate-400">{meta.subtitle}</p>
        </div>
      </div>
      <div className="category-scroll mt-4 flex snap-x gap-3 overflow-x-auto pb-2">
        {products.map((product) => (
          <button
            type="button"
            key={product.id}
            onClick={() => onOpenProduct(product)}
            className="flex w-64 shrink-0 snap-start items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 text-right transition hover:border-blue-200 hover:bg-blue-50/50"
          >
            <span className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.nameAr} className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="grid h-full place-items-center text-slate-300"><ImageOff className="h-6 w-6" /></span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs font-black text-slate-950">{product.nameAr}</strong>
              <span className="mt-1 block truncate text-[9px] font-bold text-slate-400">{product.saleUnitNameAr} • {product.categoryNameAr}</span>
              <span className="mt-2 block text-sm font-black text-orange-700">{formatJod(product.salePackagePriceInMinorUnits)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function MerchandisingSections({ newest, bestSellers, offers, lowStock, onOpenProduct, onShowAll }: MerchandisingSectionsProps) {
  if (![newest, bestSellers, offers, lowStock].some((items) => items.length > 0)) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 pb-8 lg:px-8" aria-label="اختيارات المتجر">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-blue-600">اختيارات سريعة</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">اكتشف ما يناسب محلك</h2>
        </div>
        <button type="button" onClick={onShowAll} className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-[10px] font-black text-blue-700">عرض جميع المنتجات</button>
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
