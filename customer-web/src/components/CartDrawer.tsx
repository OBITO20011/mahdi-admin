import {
  ArrowLeft,
  ImageOff,
  LockKeyhole,
  Minus,
  Plus,
  ShoppingBag,
  TicketPercent,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CartItem } from '../types/catalog';
import { calculateCartPackages, calculateCartSubtotal } from '../utils/cart';
import { formatJod } from '../utils/money';
import { CheckoutProgress } from './CheckoutProgress';

interface CartDrawerProps {
  isOpen: boolean;
  items: CartItem[];
  onClose: () => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}

export function CartDrawer({
  isOpen,
  items,
  onClose,
  onQuantityChange,
  onRemove,
  onClear,
  onCheckout,
}: CartDrawerProps) {
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const packagesCount = calculateCartPackages(items);
  const subtotal = calculateCartSubtotal(items);

  useEffect(() => {
    if (!isOpen) setClearConfirmationOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overscrollBehavior: body.style.overscrollBehavior,
    };
    const previousRootStyles = {
      overflow: root.style.overflow,
      overscrollBehavior: root.style.overscrollBehavior,
    };

    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';

    return () => {
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
      root.style.overflow = previousRootStyles.overflow;
      root.style.overscrollBehavior = previousRootStyles.overscrollBehavior;
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    };
  }, [isOpen]);

  const handleConfirmedClear = () => {
    onClear();
    setClearConfirmationOpen(false);
  };

  return (
    <div
      className={`fixed inset-0 z-50 isolate overflow-hidden overscroll-none transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <button
        type="button"
        aria-label="إغلاق السلة"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className={`absolute inset-0 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden overscroll-none bg-white shadow-2xl transition-transform duration-300 sm:inset-y-0 sm:left-0 sm:right-auto sm:h-full sm:max-h-none sm:max-w-2xl ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-100 text-blue-700">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <h2 id="cart-drawer-title" className="font-black text-slate-950">سلة طلب الجملة</h2>
              <p className="text-[10px] font-bold text-slate-400">
                {packagesCount.toLocaleString('ar-JO')} طرد
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {items.length > 0 && (
          <div className="border-b border-slate-100 bg-gradient-to-b from-white to-slate-50">
            <CheckoutProgress currentStep={1} compact />
          </div>
        )}

        {items.length === 0 ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-[2rem] bg-blue-50 text-blue-600">
                <ShoppingBag className="h-8 w-8" />
              </div>
              <h3 className="mt-5 font-black text-slate-900">السلة فارغة</h3>
              <p className="mt-2 text-xs leading-6 text-slate-500">
                أضف طردًا من الكتالوج وسيبقى محفوظًا على هذا الجهاز.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 rounded-2xl bg-blue-700 px-5 py-3 text-xs font-black text-white"
              >
                تصفح الأصناف
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              data-cart-scroll-region
              className="min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto overscroll-contain p-4 [-webkit-overflow-scrolling:touch]"
            >
              {clearConfirmationOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-[10px] font-black text-rose-800">
                    هل أنت متأكد من حذف جميع الأصناف من السلة؟
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setClearConfirmationOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-600"
                    >
                      تراجع
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmedClear}
                      className="rounded-xl bg-rose-600 px-3 py-1.5 text-[10px] font-black text-white"
                    >
                      نعم، إفراغ
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-bold text-slate-400">
                    الأسعار والكميات تُراجع تلقائيًا مع المخزون
                  </p>
                  <button
                    type="button"
                    onClick={() => setClearConfirmationOpen(true)}
                    className="flex items-center gap-1 text-[10px] font-extrabold text-rose-500"
                  >
                    <Trash2 className="h-3 w-3" />
                    إفراغ السلة
                  </button>
                </div>
              )}

              {items.map((item) => (
                <article
                  key={item.productId}
                  className="rounded-3xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex gap-3">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.nameAr}
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <div className="grid h-full place-items-center text-slate-400">
                          <ImageOff className="h-5 w-5" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-xs font-black text-slate-900">
                            {item.nameAr}
                          </h3>
                          <p className="mt-1 text-[9px] font-bold text-slate-400">
                            {item.saleUnitNameAr} ×{' '}
                            {item.unitsPerSalePackage.toLocaleString('ar-JO')}
                          </p>
                          <p className="mt-1 text-[9px] font-bold text-blue-600">
                            سعر الطرد {formatJod(item.unitPriceInMinorUnits)} •
                            المتاح {item.maxAvailablePackages.toLocaleString(
                              'ar-JO'
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemove(item.productId)}
                          aria-label={`حذف ${item.nameAr}`}
                          className="text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50">
                          <button
                            type="button"
                            onClick={() =>
                              onQuantityChange(
                                item.productId,
                                item.quantity - 1
                              )
                            }
                            className="grid h-8 w-8 place-items-center text-slate-500"
                            aria-label={`إنقاص كمية ${item.nameAr}`}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="min-w-8 text-center text-xs font-black text-slate-900">
                            {item.quantity.toLocaleString('ar-JO')}
                          </span>
                          <button
                            type="button"
                            disabled={
                              item.quantity >= item.maxAvailablePackages
                            }
                            onClick={() =>
                              onQuantityChange(
                                item.productId,
                                item.quantity + 1
                              )
                            }
                            className="grid h-8 w-8 place-items-center text-blue-700 disabled:text-slate-300"
                            aria-label={`زيادة كمية ${item.nameAr}`}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="text-xs font-black text-orange-700">
                          {formatJod(
                            item.quantity * item.unitPriceInMinorUnits
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:p-5">
              <div className="mb-3 flex items-start gap-2 rounded-2xl border border-violet-200 bg-violet-50 p-2.5 text-[10px] font-bold leading-5 text-violet-800 sm:mb-4 sm:p-3">
                <TicketPercent className="mt-0.5 h-4 w-4 shrink-0" />
                لديك كوبون خصم؟ ستتمكن من إدخاله والتحقق منه آمنًا في خطوة البيانات والدفع.
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400">
                    إجمالي السلة
                  </p>
                  <p className="mt-1 text-xl font-black text-slate-950">
                    {formatJod(subtotal)}
                  </p>
                </div>
                <div className="rounded-2xl bg-emerald-100 px-3 py-2 text-[10px] font-extrabold text-emerald-700">
                  {packagesCount.toLocaleString('ar-JO')} طرد
                </div>
              </div>

              <button
                type="button"
                onClick={onCheckout}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800 sm:mt-4 sm:py-4"
              >
                إتمام الطلب بدون تسجيل دخول
                <ArrowLeft className="h-4 w-4" />
              </button>

              <button type="button" onClick={onClose} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs font-black text-slate-700">
                متابعة التسوق
              </button>

              <div className="mt-3 hidden items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold leading-5 text-emerald-800 sm:flex">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                لا تحتاج حسابًا أو كلمة مرور. سيُحفظ الطلب أولًا في الإدارة،
                وبعدها يفتح ملخص واتساب.
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
