import { Boxes, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react';

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
  return (
    <section
      id="top"
      className="relative isolate flex min-h-[650px] items-center overflow-hidden bg-[#07152f] px-4 py-8 text-white sm:min-h-[calc(100svh-8rem)] sm:py-16"
    >
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-30 scale-110 bg-cover bg-center opacity-65 blur-2xl"
        style={{ backgroundImage: "url('/nawasrah-hero-poster.webp')" }}
      />
      <video
        aria-hidden="true"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        poster="/nawasrah-hero-poster.webp"
        className="absolute inset-0 -z-20 h-full w-full bg-[#07152f] object-cover object-[center_42%] opacity-90 motion-reduce:hidden md:object-contain md:object-center md:opacity-100"
      >
        <source
          src="/nawasrah-hero-mobile.mp4"
          type="video/mp4"
          media="(max-width: 767px)"
        />
        <source src="/nawasrah-hero-4k.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 -z-10 bg-gradient-to-l from-[#07152f]/85 via-[#0b1b3f]/55 to-[#07152f]/75 md:from-[#07152f]/72 md:via-[#0b1b3f]/34 md:to-[#07152f]/60" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#081632]/80 via-[#081632]/20 to-[#081632]/35 md:from-[#081632]/54 md:via-transparent md:to-[#081632]/16" />
      <div className="hero-orb hero-orb-one" />
      <div className="hero-orb hero-orb-two" />
      <div className="hero-grid" />

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-7 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:px-4">
        <div>
          <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-3 py-2 text-[10px] font-extrabold leading-5 text-orange-100 backdrop-blur sm:mb-5 sm:px-4 sm:text-xs">
            <Sparkles className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
            {announcementText}
          </div>

          <h1 className="max-w-3xl text-3xl font-black leading-[1.3] sm:text-5xl lg:text-6xl">
            بضاعتك بالجملة،
            <span className="block bg-gradient-to-l from-orange-300 to-orange-500 bg-clip-text text-transparent">
              من المخزون مباشرة
            </span>
          </h1>

          <p className="mt-4 max-w-2xl text-xs font-medium leading-7 text-blue-50/85 sm:mt-6 sm:text-base sm:leading-8 sm:text-blue-100/75">
            اختر الطرود المتوفرة فعليًا لدى محلات النواصرة. السعر، نوع الطرد،
            وعدد الطرود المتاحة تأتي من نظام الإدارة نفسه.
          </p>

          <div className="mt-6 grid gap-2 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={onBrowseProducts}
              className="w-full rounded-2xl bg-orange-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-orange-950/20 transition hover:-translate-y-0.5 hover:bg-orange-400 sm:w-auto"
            >
              تصفح أصناف الجملة
            </button>
            <span className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#07152f]/35 px-4 py-3 text-[10px] font-bold text-blue-50 backdrop-blur sm:px-5 sm:py-3.5 sm:text-xs">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              لا نعرض سعر الشراء أو بيانات المورد
            </span>
          </div>
        </div>

        <div data-testid="hero-stats" className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-1">
          {[
            {
              label: 'صنف جملة',
              value: productsCount,
              icon: PackageCheck,
              color: 'text-orange-300',
            },
            {
              label: 'طرد متاح',
              value: availablePackages,
              icon: Boxes,
              color: 'text-emerald-300',
            },
            {
              label: 'قسم',
              value: categoriesCount,
              icon: Sparkles,
              color: 'text-blue-300',
            },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl border border-white/10 bg-[#07152f]/40 p-3 backdrop-blur-md lg:rounded-3xl lg:bg-white/[0.07] lg:p-5"
              >
                <div className="flex flex-col-reverse items-center justify-between gap-2 text-center lg:flex-row lg:gap-4 lg:text-right">
                  <div className="min-w-0">
                    <p className="text-2xl font-black sm:text-3xl">
                      {stat.value.toLocaleString('ar-JO')}
                    </p>
                    <p className="mt-1 truncate text-[9px] font-bold text-blue-100/70 sm:text-xs">
                      {stat.label}
                    </p>
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 lg:h-11 lg:w-11 lg:rounded-2xl">
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
