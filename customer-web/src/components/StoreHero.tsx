import { useEffect, useState } from 'react';
import { Boxes, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react';

const desktopHeroMediaQuery = '(min-width: 768px)';
const reducedMotionMediaQuery = '(prefers-reduced-motion: reduce)';

function getHeroMediaPreferences() {
  if (typeof window === 'undefined') {
    return { isDesktop: false, prefersReducedMotion: false };
  }

  return {
    isDesktop: window.matchMedia(desktopHeroMediaQuery).matches,
    prefersReducedMotion: window.matchMedia(reducedMotionMediaQuery).matches,
  };
}

interface StoreHeroProps {
  productsCount: number;
  categoriesCount: number;
  availablePackages: number;
  onBrowseProducts: () => void;
  announcementText: string;
}

export function StoreHero({
  productsCount,
  categoriesCount,
  availablePackages,
  onBrowseProducts,
  announcementText,
}: StoreHeroProps) {
  const [heroMediaPreferences, setHeroMediaPreferences] = useState(
    getHeroMediaPreferences,
  );

  useEffect(() => {
    const desktopMedia = window.matchMedia(desktopHeroMediaQuery);
    const reducedMotionMedia = window.matchMedia(reducedMotionMediaQuery);
    const updatePreferences = () => {
      setHeroMediaPreferences({
        isDesktop: desktopMedia.matches,
        prefersReducedMotion: reducedMotionMedia.matches,
      });
    };

    desktopMedia.addEventListener('change', updatePreferences);
    reducedMotionMedia.addEventListener('change', updatePreferences);
    return () => {
      desktopMedia.removeEventListener('change', updatePreferences);
      reducedMotionMedia.removeEventListener('change', updatePreferences);
    };
  }, []);

  const shouldRenderMobileVideo =
    !heroMediaPreferences.isDesktop && !heroMediaPreferences.prefersReducedMotion;
  const shouldRenderDesktopVideo =
    heroMediaPreferences.isDesktop && !heroMediaPreferences.prefersReducedMotion;

  const stats = [
    { label: 'صنف جملة', value: productsCount, icon: PackageCheck, color: 'text-orange-300' },
    { label: 'طرد متاح', value: availablePackages, icon: Boxes, color: 'text-emerald-300' },
    { label: 'قسم', value: categoriesCount, icon: Sparkles, color: 'text-blue-300' },
  ];

  return (
    <section
      id="top"
      className="relative isolate overflow-hidden bg-[#07152f] px-4 pb-6 text-white md:flex md:min-h-[calc(100svh-8rem)] md:items-center md:py-16"
    >
      <div
        data-testid="mobile-hero-video"
        className="relative -mx-4 aspect-video overflow-hidden bg-[#07152f] md:hidden"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 scale-110 bg-cover bg-center opacity-45 blur-xl"
          style={{ backgroundImage: "url('/nawasrah-hero-poster.webp')" }}
        />
        {shouldRenderMobileVideo && (
          <video
            aria-hidden="true"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
            poster="/nawasrah-hero-poster.webp"
            className="absolute inset-0 h-full w-full bg-[#07152f] object-contain"
          >
            <source src="/nawasrah-hero-mobile.mp4" type="video/mp4" />
          </video>
        )}
      </div>

      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-30 hidden scale-110 bg-cover bg-center opacity-65 blur-2xl md:block"
        style={{ backgroundImage: "url('/nawasrah-hero-poster.webp')" }}
      />
      {shouldRenderDesktopVideo && (
        <video
          data-testid="desktop-hero-video"
          aria-hidden="true"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          poster="/nawasrah-hero-poster.webp"
          className="absolute inset-0 -z-20 h-full w-full bg-[#07152f] object-contain object-center opacity-100"
        >
          <source src="/nawasrah-hero-4k.mp4" type="video/mp4" />
        </video>
      )}
      <div className="absolute inset-0 -z-10 hidden bg-gradient-to-l from-[#07152f]/72 via-[#0b1b3f]/34 to-[#07152f]/60 md:block" />
      <div className="absolute inset-0 -z-10 hidden bg-gradient-to-t from-[#081632]/54 via-transparent to-[#081632]/16 md:block" />
      <div className="hero-orb hero-orb-one hidden md:block" />
      <div className="hero-orb hero-orb-two hidden md:block" />
      <div className="hero-grid hidden md:block" />

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-5 py-5 md:gap-7 md:py-0 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:px-4">
        <div>
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-1.5 text-[9px] font-extrabold leading-5 text-orange-100 backdrop-blur md:mb-5 md:px-4 md:py-2 md:text-xs">
            <Sparkles className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            {announcementText}
          </div>

          <h1 className="max-w-3xl text-[1.7rem] font-black leading-[1.3] sm:text-5xl lg:text-6xl">
            بضاعتك بالجملة،
            <span className="block bg-gradient-to-l from-orange-300 to-orange-500 bg-clip-text text-transparent">
              من المخزون مباشرة
            </span>
          </h1>

          <p className="mt-3 max-w-2xl text-[11px] font-medium leading-6 text-blue-50/85 sm:mt-6 sm:text-base sm:leading-8 sm:text-blue-100/75">
            اختر الطرود المتوفرة فعليًا لدى محلات النواصرة. السعر، نوع الطرد،
            وعدد الطرود المتاحة تأتي من نظام الإدارة نفسه.
          </p>

          <div className="mt-4 grid gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={onBrowseProducts}
              className="w-full rounded-2xl bg-orange-500 px-6 py-3 text-sm font-black text-white shadow-xl shadow-orange-950/20 transition hover:-translate-y-0.5 hover:bg-orange-400 sm:w-auto sm:py-3.5"
            >
              تصفح أصناف الجملة
            </button>
            <span className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#07152f]/35 px-4 py-2.5 text-[9px] font-bold text-blue-50 backdrop-blur sm:px-5 sm:py-3.5 sm:text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              لا نعرض سعر الشراء أو بيانات المورد
            </span>
          </div>
        </div>

        <div data-testid="hero-stats" className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-white/[0.06] p-2.5 backdrop-blur-md lg:rounded-3xl lg:bg-white/[0.07] lg:p-5"
              >
                <div className="flex flex-col-reverse items-center justify-between gap-2 text-center lg:flex-row lg:gap-4 lg:text-right">
                  <div className="min-w-0">
                    <p className="text-xl font-black sm:text-3xl">
                      {stat.value.toLocaleString('ar-JO')}
                    </p>
                    <p className="mt-1 truncate text-[9px] font-bold text-blue-100/70 sm:text-xs">
                      {stat.label}
                    </p>
                  </div>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 lg:h-11 lg:w-11 lg:rounded-2xl">
                    <Icon className={`h-4 w-4 lg:h-5 lg:w-5 ${stat.color}`} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
