import {
  BadgePercent,
  BellRing,
  RefreshCw,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { StorefrontOffer } from '../types/offers';
import { PromotionOffers } from './PromotionOffers';

interface OffersPageProps {
  offers: StorefrontOffer[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onBrowseProducts: () => void;
  onUseOffer: (offer: StorefrontOffer) => void;
}

export function OffersPage({
  offers,
  isLoading,
  error,
  onRetry,
  onBrowseProducts,
  onUseOffer,
}: OffersPageProps) {
  if (isLoading) {
    return (
      <section
        className="min-h-[70vh] bg-gradient-to-b from-[#fffaf1] to-[#fbf7f0] py-10 sm:py-14"
        aria-label="جاري تحميل عروض الجملة"
        aria-busy="true"
      >
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="h-44 animate-pulse rounded-[2rem] bg-white shadow-sm" />
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-64 animate-pulse rounded-[2rem] bg-white shadow-sm"
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="grid min-h-[70vh] place-items-center bg-gradient-to-b from-[#fffaf1] to-[#fbf7f0] px-4 py-12">
        <div className="w-full max-w-xl rounded-[2rem] border border-amber-100 bg-white/95 p-7 text-center shadow-xl shadow-amber-900/5 sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-amber-50 text-amber-700">
            <RefreshCw className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-black text-slate-950 sm:text-2xl">
            تعذر تحديث العروض الآن
          </h1>
          <p className="mx-auto mt-3 max-w-md text-xs font-bold leading-6 text-slate-500">
            لم نعرض أي رمز غير مؤكد. أعد المحاولة ليتم جلب العروض الفعّالة
            مباشرة من إدارة المتجر.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-3 text-xs font-black text-white shadow-lg shadow-blue-900/15 transition hover:bg-blue-800"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة تحميل العروض
          </button>
        </div>
      </section>
    );
  }

  if (offers.length > 0) {
    return (
      <div className="min-h-[70vh] bg-slate-950">
        <PromotionOffers offers={offers} onUseOffer={onUseOffer} />
      </div>
    );
  }

  return (
    <section className="relative grid min-h-[70vh] place-items-center overflow-hidden bg-gradient-to-b from-[#fffaf1] via-[#fbf7f0] to-blue-50/50 px-4 py-12">
      <div className="pointer-events-none absolute -right-24 top-10 h-64 w-64 rounded-full bg-amber-200/25 blur-3xl" />
      <div className="pointer-events-none absolute -left-24 bottom-10 h-64 w-64 rounded-full bg-blue-200/25 blur-3xl" />

      <div className="relative w-full max-w-2xl rounded-[2.25rem] border border-white/80 bg-white/90 p-7 text-center shadow-2xl shadow-slate-900/5 backdrop-blur sm:p-12">
        <div className="relative mx-auto grid h-24 w-24 place-items-center rounded-[2rem] border border-amber-100 bg-gradient-to-br from-amber-50 to-blue-50 text-blue-800 shadow-inner">
          <BadgePercent className="h-10 w-10" />
          <Sparkles className="absolute -left-2 -top-2 h-6 w-6 text-amber-500" />
        </div>

        <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-[10px] font-black text-amber-800">
          <BellRing className="h-3.5 w-3.5" />
          نحدّث عروض الجملة باستمرار
        </span>
        <h1 className="mt-4 text-2xl font-black text-slate-950 sm:text-3xl">
          لا توجد عروض فعّالة الآن
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-xs font-bold leading-7 text-slate-500 sm:text-sm">
          عندما تنشر الإدارة رمز خصم جديد سيظهر هنا تلقائيًا مع قيمته، الحد
          الأدنى للطلب، وتاريخ الانتهاء. يمكنك متابعة التسوق الآن دون انتظار.
        </p>

        <button
          type="button"
          onClick={onBrowseProducts}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-blue-700 to-blue-600 px-5 py-3.5 text-xs font-black text-white shadow-lg shadow-blue-900/15 transition hover:brightness-110 sm:w-auto sm:min-w-56"
        >
          <ShoppingBag className="h-4 w-4" />
          تصفّح أصناف الجملة
        </button>
      </div>
    </section>
  );
}
