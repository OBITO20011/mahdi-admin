import {
  Barcode,
  Boxes,
  CheckCircle2,
  Copy,
  ImageOff,
  Heart,
  Minus,
  PackageCheck,
  Plus,
  Share2,
  Tag,
  X,
  ZoomIn,
  MessageCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CatalogProduct } from '../types/catalog';
import { formatJod } from '../utils/money';
import { CargoAddButton } from './CargoAddButton';
import {
  buildProductShareUrl,
  calculateProductSelectionTotal,
  clampProductSelectionQuantity,
  getRemainingProductPackages,
} from '../utils/productDetails';
import { buildWhatsAppUrl } from '../utils/checkout';

interface ProductDetailsModalProps {
  product: CatalogProduct;
  cartQuantity: number;
  relatedProducts: CatalogProduct[];
  onClose: () => void;
  onAddQuantity: (product: CatalogProduct, quantity: number) => void;
  onOpenProduct: (product: CatalogProduct) => void;
  storeWhatsAppNumber: string;
  isFavorite: boolean;
  onToggleFavorite: (product: CatalogProduct) => void;
}

export function ProductDetailsModal({
  product,
  cartQuantity,
  relatedProducts,
  onClose,
  onAddQuantity,
  onOpenProduct,
  storeWhatsAppNumber,
  isFavorite,
  onToggleFavorite,
}: ProductDetailsModalProps) {
  const remainingPackages = getRemainingProductPackages(
    product.availableSalePackages,
    cartQuantity
  );
  const [quantity, setQuantity] = useState(() =>
    clampProductSelectionQuantity(
      product.minimumOrderPackages,
      product.availableSalePackages,
      cartQuantity
    )
  );
  const [shareMessage, setShareMessage] = useState('');
  const [imageZoomed, setImageZoomed] = useState(false);

  useEffect(() => {
    setQuantity(
      clampProductSelectionQuantity(
        product.minimumOrderPackages,
        product.availableSalePackages,
        cartQuantity
      )
    );
    setShareMessage('');
    setImageZoomed(false);
  }, [
    cartQuantity,
    product.availableSalePackages,
    product.id,
    product.minimumOrderPackages,
  ]);

  useEffect(() => {
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
  }, [onClose]);

  const selectedTotal = calculateProductSelectionTotal(
    product.salePackagePriceInMinorUnits,
    quantity
  );
  const packageDescription = `${product.saleUnitNameAr} × ${product.unitsPerSalePackage.toLocaleString(
    'ar-JO'
  )} ${product.unitNameAr}`;
  const shareUrl = useMemo(
    () =>
      buildProductShareUrl(
        window.location.href,
        product.sku || product.id
      ),
    [product.id, product.sku]
  );

  const handleShare = async () => {
    const shareText = `${product.nameAr} — سعر ${product.saleUnitNameAr} ${formatJod(
      product.salePackagePriceInMinorUnits
    )}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: product.nameAr,
          text: shareText,
          url: shareUrl,
        });
        setShareMessage('تم فتح خيارات المشاركة.');
        return;
      }

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareMessage('تم نسخ رابط المنتج.');
        return;
      }

      setShareMessage('انسخ رابط المنتج من شريط المتصفح.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareMessage('تعذرت المشاركة. انسخ الرابط من شريط المتصفح.');
    }
  };

  const shareOnWhatsApp = () => {
    const text = `${product.nameAr} — سعر ${product.saleUnitNameAr} ${formatJod(product.salePackagePriceInMinorUnits)}\n${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const handleQuantityChange = (nextQuantity: number) => {
    setQuantity(
      clampProductSelectionQuantity(
        nextQuantity,
        product.availableSalePackages,
        cartQuantity
      )
    );
  };

  const handleAdd = () => {
    if (quantity < 1 || remainingPackages < 1) return;
    onAddQuantity(product, quantity);
  };

  const isLowStock =
    product.isAvailable && product.availableSalePackages <= 2;

  return (
    <div className="fixed inset-0 z-[55]" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق تفاصيل المنتج"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-details-title"
        className="absolute inset-0 flex flex-col overflow-hidden bg-white shadow-2xl sm:inset-x-6 sm:top-1/2 sm:mx-auto sm:h-auto sm:max-h-[94vh] sm:max-w-5xl sm:-translate-y-1/2 sm:rounded-[2rem]"
      >
        <header className="z-10 flex shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold text-blue-600">
              تفاصيل صنف الجملة
            </p>
            <h2
              id="product-details-title"
              className="mt-1 truncate text-base font-black text-slate-950 sm:text-lg"
            >
              {product.nameAr}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleFavorite(product)}
              aria-label={
                isFavorite
                  ? `إزالة ${product.nameAr} من المفضلة`
                  : `إضافة ${product.nameAr} إلى المفضلة`
              }
              aria-pressed={isFavorite}
              className={`grid h-10 w-10 place-items-center rounded-2xl border transition ${
                isFavorite
                  ? 'border-rose-200 bg-rose-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
              }`}
            >
              <Heart
                className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={() => void handleShare()}
              aria-label="مشاركة المنتج"
              className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-200 bg-white text-blue-700 transition hover:bg-blue-50"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={shareOnWhatsApp} aria-label="مشاركة المنتج على واتساب" className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700"><MessageCircle className="h-4 w-4" /></button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid sm:grid-cols-[0.9fr_1.1fr]">
            <div className="bg-gradient-to-br from-slate-50 via-white to-blue-50 p-4 sm:p-7">
              <button type="button" onClick={() => setImageZoomed((value) => !value)} aria-label={imageZoomed ? 'تصغير صورة المنتج' : 'تكبير صورة المنتج'} className="relative mx-auto block aspect-[4/3] max-h-[46vh] w-full overflow-hidden rounded-[2rem] border border-white bg-white shadow-[0_24px_70px_-44px_rgba(15,23,42,0.7)] sm:aspect-square sm:max-h-[440px]">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.nameAr}
                    className={`h-full w-full object-contain p-3 transition duration-300 sm:p-5 ${imageZoomed ? 'scale-150' : 'scale-100'}`}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-center text-slate-400">
                    <div>
                      <ImageOff className="mx-auto h-14 w-14" />
                      <p className="mt-3 text-xs font-bold">
                        لا توجد صورة لهذا المنتج بعد
                      </p>
                    </div>
                  </div>
                )}

                <span className="absolute right-4 top-4 rounded-2xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-black text-blue-800 shadow-sm backdrop-blur">
                  {product.categoryNameAr}
                </span>
                {product.imageUrl && <span className="absolute bottom-4 left-4 grid h-9 w-9 place-items-center rounded-2xl bg-slate-950/70 text-white"><ZoomIn className="h-4 w-4" /></span>}
              </button>
            </div>

            <div className="p-5 sm:border-r sm:border-slate-100 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                {product.brandNameAr && (
                  <span className="rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-black text-blue-700">
                    {product.brandNameAr}
                  </span>
                )}
                <span
                  className={`rounded-full px-3 py-1.5 text-[10px] font-black ${
                    product.isAvailable
                      ? isLowStock
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {product.isAvailable
                    ? isLowStock
                      ? 'كمية محدودة'
                      : 'متوفر الآن'
                    : 'غير متوفر حاليًا'}
                </span>
              </div>

              <h3 className="mt-4 text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
                {product.nameAr}
              </h3>

              {product.description ? (
                <p className="mt-3 text-xs font-semibold leading-7 text-slate-600 sm:text-sm">
                  {product.description}
                </p>
              ) : (
                <p className="mt-3 text-xs font-semibold leading-6 text-slate-400">
                  بيانات الطرد والسعر والمخزون موضحة أدناه.
                </p>
              )}

              <div className="mt-5 rounded-3xl border border-orange-100 bg-orange-50 p-4">
                <p className="text-[10px] font-bold text-orange-500">
                  سعر {product.saleUnitNameAr}
                </p>
                <p className="mt-1 text-3xl font-black text-orange-700">
                  {formatJod(product.salePackagePriceInMinorUnits)}
                </p>
                <p className="mt-1 text-[10px] font-bold text-orange-700/70">
                  السعر للطرد الكامل وليس للحبة
                </p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
                  <div className="flex items-center gap-2 text-blue-600">
                    <Boxes className="h-4 w-4" />
                    <p className="text-[10px] font-bold">طرد البيع</p>
                  </div>
                  <p className="mt-2 text-sm font-black text-blue-950">
                    {product.saleUnitNameAr}
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <PackageCheck className="h-4 w-4" />
                    <p className="text-[10px] font-bold">محتوى الطرد</p>
                  </div>
                  <p className="mt-2 text-sm font-black text-slate-900">
                    {product.unitsPerSalePackage.toLocaleString('ar-JO')}{' '}
                    {product.unitNameAr}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold text-emerald-700">
                      المتوفر للطلب الآن
                    </p>
                    <p className="mt-1 text-base font-black text-emerald-950">
                      {product.availableSalePackages.toLocaleString('ar-JO')}{' '}
                      {product.saleUnitNameAr}
                    </p>
                  </div>
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                {cartQuantity > 0 && (
                  <p className="mt-2 text-[10px] font-bold text-emerald-700">
                    في سلتك حاليًا: {cartQuantity.toLocaleString('ar-JO')}
                  </p>
                )}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-5">
                <p className="text-[10px] font-black text-slate-500">
                  معلومات التعريف
                </p>
                <div className="mt-3 grid gap-2 text-[10px] font-bold text-slate-600 sm:grid-cols-2">
                  <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                    <Tag className="h-3.5 w-3.5 text-blue-600" />
                    <span>SKU:</span>
                    <span dir="ltr" className="font-mono text-slate-900">
                      {product.sku}
                    </span>
                  </div>
                  {product.barcode && (
                    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                      <Barcode className="h-3.5 w-3.5 text-blue-600" />
                      <span dir="ltr" className="font-mono text-slate-900">
                        {product.barcode}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {shareMessage && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-[10px] font-bold text-blue-800">
                  <Copy className="h-3.5 w-3.5" />
                  {shareMessage}
                </div>
              )}
            </div>
          </div>

          {relatedProducts.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-6 sm:px-7">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black text-blue-600">
                    من نفس القسم
                  </p>
                  <h3 className="mt-1 text-base font-black text-slate-950">
                    أصناف مشابهة
                  </h3>
                </div>
                <p className="text-[9px] font-bold text-slate-400">
                  اضغط لعرض التفاصيل
                </p>
              </div>

              <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {relatedProducts.map((relatedProduct) => (
                  <button
                    type="button"
                    key={relatedProduct.id}
                    onClick={() => onOpenProduct(relatedProduct)}
                    className="flex w-64 shrink-0 items-center gap-3 rounded-3xl border border-slate-200 bg-white p-3 text-right transition hover:border-blue-200 hover:shadow-md"
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                      {relatedProduct.imageUrl ? (
                        <img
                          src={relatedProduct.imageUrl}
                          alt={relatedProduct.nameAr}
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-slate-400">
                          <ImageOff className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black text-slate-900">
                        {relatedProduct.nameAr}
                      </p>
                      <p className="mt-1 text-[9px] font-bold text-slate-400">
                        {relatedProduct.saleUnitNameAr}
                      </p>
                      <p className="mt-1 text-xs font-black text-orange-700">
                        {formatJod(
                          relatedProduct.salePackagePriceInMinorUnits
                        )}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:py-4">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            {!product.isAvailable ? (
              <a href={buildWhatsAppUrl(storeWhatsAppNumber, `مرحبًا، أريد الاستفسار عن توفر ${product.nameAr} (${product.sku}).`)} target="_blank" rel="noreferrer" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white"><MessageCircle className="h-4 w-4" />اسألنا على واتساب</a>
            ) : remainingPackages === 0 ? (
              <div className="flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-black text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                في السلة
              </div>
            ) : (
              <div className="flex shrink-0 items-center rounded-2xl border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => handleQuantityChange(quantity - 1)}
                  disabled={quantity <= 1}
                  aria-label="إنقاص الكمية"
                  className="grid h-12 w-11 place-items-center text-slate-600 disabled:text-slate-300"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-9 text-center text-sm font-black text-slate-950">
                  {quantity.toLocaleString('ar-JO')}
                </span>
                <button
                  type="button"
                  onClick={() => handleQuantityChange(quantity + 1)}
                  disabled={quantity >= remainingPackages}
                  aria-label="زيادة الكمية"
                  className="grid h-12 w-11 place-items-center text-blue-700 disabled:text-slate-300"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}

            <CargoAddButton
              onAdd={handleAdd}
              disabled={!product.isAvailable || remainingPackages === 0}
              ariaLabel={`إضافة ${quantity.toLocaleString('ar-JO')} من ${product.nameAr} إلى السلة`}
              label={
                remainingPackages === 0
                  ? 'الكمية المتوفرة موجودة في السلة'
                  : `إضافة ${quantity.toLocaleString('ar-JO')} للسلة`
              }
              trailing={
                remainingPackages > 0 ? (
                  <span className="text-xs font-black text-blue-100">
                  {formatJod(selectedTotal)}
                  </span>
                ) : null
              }
            />
          </div>
          <p className="mt-2 text-center text-[9px] font-bold text-slate-400">
            {packageDescription} • تُراجع الكمية والسعر مرة أخرى عند إرسال الطلب
          </p>
        </footer>
      </section>
    </div>
  );
}
