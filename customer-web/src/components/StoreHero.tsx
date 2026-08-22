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
      className="relative isolate flex min-h-[calc(100svh-7.5rem)] items-center overflow-hidden bg-[#07152f] px-4 py-14 text-white sm:min-h-[calc(100svh-8rem)] sm:py-16"
    >
      <video
        aria-hidden="true"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        className="absolute inset-0 -z-20 h-full w-full bg-[#07152f] object-contain object-center opacity-100 motion-reduce:hidden"
      >
        <source src="/nawasrah-hero.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 -z-10 bg-gradient-to-l from-[#07152f]/78 via-[#0b1b3f]/42 to-[#07152f]/68" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#081632]/60 via-transparent to-[#081632]/20" />
      <div className="hero-orb hero-orb-one" />
      <div className="hero-orb hero-orb-two" />
      <div className="hero-grid" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:px-4">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-orange-400/25 bg-orange-400/10 px-4 py-2 text-xs font-extrabold text-orange-200">
            <Sparkles className="h-4 w-4" />
            {announcementText}
          </div>

          <h1 className="max-w-3xl text-4xl font-black leading-[1.25] sm:text-5xl lg:text-6xl">
            بضاعتك بالجملة،
            <span className="block bg-gradient-to-l from-orange-300 to-orange-500 bg-clip-text text-transparent">
              من المخزون مباشرة
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-sm font-medium leading-8 text-blue-100/75 sm:text-base">
            اختر الطرود المتوفرة فعليًا لدى محلات النواصرة. السعر، نوع الطرد،
            وعدد الطرود المتاحة تأتي من نظام الإدارة نفسه.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onBrowseProducts}
              className="rounded-2xl bg-orange-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-orange-950/20 transition hover:-translate-y-0.5 hover:bg-orange-400"
            >
              تصفح أصناف الجملة
            </button>
            <span className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 text-xs font-bold text-blue-100">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              لا نعرض سعر الشراء أو بيانات المورد
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
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
                className="rounded-3xl border border-white/10 bg-white/[0.07] p-5 backdrop-blur"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-3xl font-black">
                      {stat.value.toLocaleString('ar-JO')}
                    </p>
                    <p className="mt-1 text-xs font-bold text-blue-100/60">
                      {stat.label}
                    </p>
                  </div>
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10">
                    <Icon className={`h-5 w-5 ${stat.color}`} />
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
