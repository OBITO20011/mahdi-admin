import {
  BadgePercent,
  CalendarClock,
  Check,
  Copy,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { StorefrontOffer } from '../types/offers';
import { formatJod } from '../utils/money';

interface PromotionOffersProps {
  offers: StorefrontOffer[];
  onUseOffer: (offer: StorefrontOffer) => void;
}

function discountLabel(offer: StorefrontOffer): string {
  return offer.discountType === 'percentage'
    ? `${offer.discountValue.toLocaleString('ar-JO')}% خصم`
    : `خصم ${offer.discountValue.toLocaleString('ar-JO', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })} د.أ`;
}

function formatExpiry(expiresAt?: string): string {
  if (!expiresAt) return 'لفترة محدودة';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'لفترة محدودة';
  return `حتى ${date.toLocaleDateString('ar-JO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function formatStart(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return 'عرض مجدول';
  return `يبدأ ${date.toLocaleDateString('ar-JO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

export function PromotionOffers({
  offers,
  onUseOffer,
}: PromotionOffersProps) {
  const [copiedCode, setCopiedCode] = useState('');

  if (offers.length === 0) return null;

  const copyCode = async (offer: StorefrontOffer) => {
    try {
      await navigator.clipboard?.writeText(offer.code);
      setCopiedCode(offer.code);
      window.setTimeout(() => setCopiedCode(''), 1800);
    } catch {
      setCopiedCode('');
    }
  };

  return (
    <section
      id="storefront-offers"
      className="scroll-mt-28 border-y border-violet-100 bg-gradient-to-br from-violet-950 via-blue-950 to-slate-950 py-10 text-white sm:py-14"
      aria-labelledby="storefront-offers-title"
    >
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-white/10 px-3 py-1.5 text-[10px] font-black text-violet-100 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              عروض منشورة من الإدارة
            </div>
            <h2
              id="storefront-offers-title"
              className="mt-3 text-2xl font-black sm:text-3xl"
            >
              رموز خصم جاهزة لطلبك
            </h2>
            <p className="mt-2 max-w-2xl text-xs font-bold leading-6 text-blue-100/70">
              اختر العرض المناسب، ثم أضف المنتجات. يحتسب النظام الخصم النهائي
              من قاعدة البيانات عند إتمام الطلب.
            </p>
          </div>
          <BadgePercent className="hidden h-14 w-14 text-violet-300/40 sm:block" />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {offers.map((offer) => {
            const startsAtTime = offer.startsAt
              ? new Date(offer.startsAt).getTime()
              : 0;
            const isUpcoming =
              Number.isFinite(startsAtTime) && startsAtTime > Date.now();

            return (
            <article
              key={offer.id}
              className="group relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur transition hover:-translate-y-1 hover:border-violet-300/40 hover:bg-white/[0.13]"
            >
              <div className="absolute -left-10 -top-10 h-28 w-28 rounded-full bg-violet-400/15 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-black text-amber-300">
                    {discountLabel(offer)}
                  </p>
                  <p className="mt-2 min-h-10 text-xs font-bold leading-5 text-white/75">
                    {offer.description || 'عرض خاص على إجمالي طلب الجملة'}
                  </p>
                </div>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-400/20 text-violet-200">
                  <BadgePercent className="h-5 w-5" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void copyCode(offer)}
                className="relative mt-5 flex w-full items-center justify-between rounded-2xl border border-dashed border-white/30 bg-slate-950/30 px-4 py-3 text-left transition hover:border-violet-300/60"
                aria-label={`نسخ رمز الخصم ${offer.code}`}
              >
                <span className="font-mono text-lg font-black tracking-widest text-white">
                  {offer.code}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-blue-100/70">
                  {copiedCode === offer.code ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-300" /> نُسخ
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> نسخ الرمز
                    </>
                  )}
                </span>
              </button>

              <div className="relative mt-4 flex flex-wrap gap-2 text-[9px] font-bold text-blue-100/75">
                {offer.minimumSubtotalInMinorUnits > 0 && (
                  <span className="rounded-full bg-white/10 px-3 py-1.5">
                    أقل طلب {formatJod(offer.minimumSubtotalInMinorUnits)}
                  </span>
                )}
                {offer.maximumDiscountInMinorUnits !== undefined && (
                  <span className="rounded-full bg-white/10 px-3 py-1.5">
                    أعلى خصم {formatJod(offer.maximumDiscountInMinorUnits)}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5">
                  <CalendarClock className="h-3 w-3" />
                  {isUpcoming && offer.startsAt
                    ? formatStart(offer.startsAt)
                    : formatExpiry(offer.expiresAt)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onUseOffer(offer)}
                disabled={isUpcoming}
                className="relative mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-violet-500 to-blue-600 px-4 py-3 text-xs font-black text-white shadow-lg shadow-violet-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 disabled:text-slate-300 disabled:shadow-none"
              >
                {isUpcoming ? (
                  <CalendarClock className="h-4 w-4" />
                ) : (
                  <ShoppingBag className="h-4 w-4" />
                )}
                {isUpcoming ? 'عرض مجدول قريبًا' : 'استخدم العرض وتسوق'}
              </button>
            </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
