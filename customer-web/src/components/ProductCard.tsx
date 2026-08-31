import {
  Eye,
  Heart,
  Minus,
  PackagePlus,
  Plus,
  Share2,
} from 'lucide-react';
import { CatalogProduct } from '../types/catalog';
import { formatJod } from '../utils/money';
import { CargoAddButton } from './CargoAddButton';
import { buildProductShareUrl } from '../utils/productDetails';
import { isLowStockProduct } from '../utils/catalogView';
import { ProductImage } from './ProductImage';

interface ProductCardProps {
  product: CatalogProduct;
  cartQuantity: number;
  isFavorite: boolean;
  onAdd: (product: CatalogProduct) => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onOpenDetails: (product: CatalogProduct) => void;
  onToggleFavorite: (product: CatalogProduct) => void;
}

export function ProductCard({
  product,
  cartQuantity,
  isFavorite,
  onAdd,
  onQuantityChange,
  onOpenDetails,
  onToggleFavorite,
}: ProductCardProps) {
  const hasVariants = product.variants.length > 0;
  const remainingAfterCart = Math.max(
    0,
    product.availableSalePackages - cartQuantity
  );
  const canAdd = product.isAvailable && remainingAfterCart > 0;
  const isLowStock = isLowStockProduct(product);
  const shareProduct = () => {
    const url = buildProductShareUrl(window.location.href, product.sku || product.id);
    const message = `${product.nameAr} — ${formatJod(product.salePackagePriceInMinorUnits)}\n${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_14px_45px_-32px_rgba(15,23,42,0.45)] transition duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-[0_22px_55px_-32px_rgba(30,64,175,0.45)] sm:rounded-[1.75rem]">
      <button
        type="button"
        onClick={() => onOpenDetails(product)}
        aria-label={`عرض تفاصيل ${product.nameAr}`}
        className="relative block aspect-square w-full overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50 text-right sm:aspect-[4/3]"
      >
        <ProductImage
          src={product.imageUrl}
          alt={product.nameAr}
          imageClassName="h-full w-full object-contain p-2 transition duration-500 group-hover:scale-105 sm:p-3"
          fallbackClassName="grid h-full place-items-center text-slate-400"
          fallbackLabel="لا توجد صورة بعد"
        />

        <div className="absolute right-2 top-2 max-w-[calc(100%-3rem)] truncate rounded-lg border border-white/60 bg-white/90 px-1.5 py-1 text-[8px] font-extrabold text-blue-800 shadow-sm backdrop-blur sm:right-3 sm:top-3 sm:rounded-xl sm:px-2.5 sm:text-[10px]">
          {hasVariants ? (
            <>
              <span className="sm:hidden">نكهات</span>
              <span className="hidden sm:inline">
                {product.variants.length.toLocaleString('ar-JO')} نكهات
              </span>
            </>
          ) : product.categoryNameAr}
        </div>

        <span className={`absolute left-2 top-2 rounded-lg px-1.5 py-1 text-[8px] font-black shadow-sm sm:left-3 sm:top-3 sm:rounded-xl sm:px-2.5 sm:text-[9px] ${!product.isAvailable ? 'bg-rose-600 text-white' : isLowStock ? 'bg-amber-400 text-amber-950' : 'bg-emerald-700 text-white'}`}>
          {!product.isAvailable ? 'غير متوفر' : isLowStock ? 'قارب على النفاد' : 'متوفر'}
        </span>

        <div className="absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-xl border border-white/70 bg-slate-950/75 px-2.5 py-1.5 text-[9px] font-black text-white opacity-100 shadow-sm backdrop-blur transition sm:flex sm:opacity-0 sm:group-hover:opacity-100">
          <Eye className="h-3 w-3" />
          عرض التفاصيل
        </div>

        {!product.isAvailable && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/50 backdrop-blur-[2px]">
            <span className="rounded-xl bg-white px-2 py-1.5 text-[10px] font-black text-slate-800 sm:px-4 sm:py-2 sm:text-xs">
              غير متوفر حاليًا
            </span>
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={() => onToggleFavorite(product)}
        aria-label={isFavorite ? `إزالة ${product.nameAr} من المفضلة` : `إضافة ${product.nameAr} إلى المفضلة`}
        aria-pressed={isFavorite}
        className={`absolute left-2 top-10 z-10 grid h-11 w-11 place-items-center rounded-xl border border-white/70 shadow-sm backdrop-blur transition hover:scale-105 sm:left-3 sm:top-12 ${isFavorite ? 'bg-rose-600 text-white' : 'bg-white/90 text-slate-600 hover:text-rose-600'}`}
      >
        <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
      </button>

      <div className="flex flex-1 flex-col p-2.5 sm:p-4">
        <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenDetails(product)}
              className="block max-w-full text-right"
            >
              <h2 className="line-clamp-2 text-[11px] font-black leading-4 text-slate-950 transition hover:text-blue-700 sm:truncate sm:text-base sm:leading-normal">
                {product.nameAr}
              </h2>
            </button>
            <p className="mt-1 hidden truncate text-[10px] font-bold text-slate-600 sm:block">
              {product.sku}
              {product.brandNameAr ? ` • ${product.brandNameAr}` : ''}
            </p>
          </div>
          <PackagePlus className="hidden h-5 w-5 shrink-0 text-blue-600 sm:block" />
        </div>

        {product.description && (
          <p className="mt-3 hidden line-clamp-2 text-[11px] leading-5 text-slate-500 sm:block">
            {product.description}
          </p>
        )}

        <div className="mt-4 hidden grid-cols-2 gap-2 sm:grid">
          <div className="rounded-2xl bg-blue-50 p-2.5">
            <p className="text-[9px] font-bold text-blue-700">طرد البيع</p>
            <p className="mt-1 text-xs font-black text-blue-950">
              {product.saleUnitNameAr}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-2.5">
            <p className="text-[9px] font-bold text-slate-600">محتوى الطرد</p>
            <p className="mt-1 text-xs font-black text-slate-800">
              {product.unitsPerSalePackage.toLocaleString('ar-JO')}{' '}
              {product.unitNameAr}
            </p>
          </div>
        </div>

        <div className="mt-auto flex min-w-0 flex-col items-stretch gap-2 pt-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:pt-5">
          <div className="min-w-0">
            <p className="hidden text-[9px] font-bold text-slate-600 sm:block">
              سعر {product.saleUnitNameAr}
            </p>
            <p className="truncate text-sm font-black text-orange-700 sm:mt-0.5 sm:text-lg">
              {formatJod(product.salePackagePriceInMinorUnits)}
            </p>
            <p className="mt-0.5 truncate text-[9px] font-bold text-slate-500 sm:mt-1 sm:text-emerald-700">
              <span className="sm:hidden">{product.saleUnitNameAr}</span>
              <span className="hidden sm:inline">
              متاح {product.availableSalePackages.toLocaleString('ar-JO')}{' '}
              {product.saleUnitNameAr}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={shareProduct} aria-label={`مشاركة ${product.nameAr} على واتساب`} className="hidden h-11 w-11 place-items-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 sm:grid"><Share2 className="h-4 w-4" /></button>
            <button
              type="button"
              onClick={() => onOpenDetails(product)}
              aria-label={`عرض تفاصيل ${product.nameAr}`}
              className="hidden h-11 w-11 place-items-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 transition hover:bg-blue-100 sm:grid"
            >
              <Eye className="h-4 w-4" />
            </button>
            {hasVariants ? (
              <button
                type="button"
                onClick={() => onOpenDetails(product)}
                aria-label={`اختيار نكهة ${product.nameAr}`}
                className="grid h-11 w-full place-items-center rounded-2xl bg-blue-700 text-[10px] font-black text-white sm:block sm:w-auto sm:px-3"
              >
                <span className="sm:hidden">اختر</span>
                <span className="hidden sm:inline">اختر النكهة</span>
              </button>
            ) : cartQuantity > 0 ? (
              <>
              <CargoAddButton
                compact
                onAdd={() => onAdd(product)}
                disabled={!canAdd}
                ariaLabel={`زيادة ${product.nameAr} في السلة`}
                className="w-full sm:hidden"
              />
              <div className="hidden h-11 items-center rounded-2xl border border-blue-200 bg-blue-50 sm:flex">
                <button
                  type="button"
                  onClick={() =>
                    onQuantityChange(product.id, cartQuantity - 1)
                  }
                  aria-label={`إنقاص ${product.nameAr} من السلة`}
                  className="grid h-11 w-11 place-items-center text-slate-600 transition hover:text-rose-600"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-7 text-center text-xs font-black text-blue-950">
                  {cartQuantity.toLocaleString('ar-JO')}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onQuantityChange(product.id, cartQuantity + 1)
                  }
                  disabled={!canAdd}
                  aria-label={`زيادة ${product.nameAr} في السلة`}
                  className="grid h-11 w-11 place-items-center text-blue-700 transition hover:text-blue-900 disabled:text-slate-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              </>
            ) : (
              <CargoAddButton
                compact
                onAdd={() => onAdd(product)}
                disabled={!canAdd}
                ariaLabel={`إضافة ${product.nameAr} إلى السلة`}
                className="w-full sm:w-14"
              />
            )}
          </div>
        </div>

        {cartQuantity > 0 && !hasVariants && (
          <div className="mt-3 hidden rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[10px] font-extrabold text-orange-700 sm:block">
            في السلة: {cartQuantity.toLocaleString('ar-JO')} • المتبقي للإضافة:{' '}
            {remainingAfterCart.toLocaleString('ar-JO')}
          </div>
        )}
      </div>
    </article>
  );
}
