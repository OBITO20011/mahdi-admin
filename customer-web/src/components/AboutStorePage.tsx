import { Building2, CalendarDays, Candy, ExternalLink, GlassWater, MapPinned, PackageCheck, Phone, ShieldCheck, Truck } from 'lucide-react';
import { SEO_BRAND } from '../config/seoBrand';
import type { PublicStorefrontSettings } from '../types/storefront';
import { StoreInfoSection } from './StoreInfoSection';

interface AboutStorePageProps {
  onBrowseProducts: () => void;
  whatsappUrl: string;
  onTrackOrder: () => void;
  settings: PublicStorefrontSettings | null;
}

export function AboutStorePage({onBrowseProducts, whatsappUrl, onTrackOrder, settings}: AboutStorePageProps) {
  return (
    <>
      <section aria-label="نبذة عن محلات النواصرة التجارية" className="min-h-[70vh] bg-gradient-to-b from-blue-50/60 to-[#fbf7f0] py-10 sm:py-16">
        <div className="mx-auto max-w-5xl px-4 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-white bg-white shadow-xl shadow-slate-900/5">
          <figure className="relative overflow-hidden bg-slate-950">
            <img
              src={SEO_BRAND.storefrontImagePath}
              alt="واجهة محلات النواصرة التجارية في الرمثا"
              width="1412"
              height="820"
              fetchPriority="high"
              className="aspect-[16/9] w-full object-cover object-center"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent px-5 pb-4 pt-12 text-xs font-bold text-white sm:px-8">
              محلات النواصرة التجارية — الرمثا، الأردن
            </figcaption>
          </figure>
          <div className="bg-[#081835] px-6 py-10 text-white sm:px-10 sm:py-14">
            <p className="text-xs font-black text-amber-300">تجارة الجملة في الرمثا</p>
            <h1 className="mt-3 text-3xl font-black leading-tight sm:text-5xl">
              محلات النواصرة التجارية
            </h1>
            <p className="mt-3 text-sm font-bold text-blue-100 sm:text-base">
              المعروفة أيضًا باسم محلات مهدي النواصرة التجارية
            </p>
            <p className="mt-6 max-w-3xl text-sm font-semibold leading-8 text-blue-100/85 sm:text-base">
              نوفر تشكيلة من المواد الغذائية والسكاكر والعصائر والمشروبات واحتياجات المحلات
              للبيع بالجملة، مع عرض المنتجات والأسعار المتاحة عبر متجرنا الإلكتروني.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <span className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-black ring-1 ring-white/15">
                <CalendarDays className="h-5 w-5 text-amber-300" />خبرة منذ عام 2000
              </span>
              <span className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-black ring-1 ring-white/15">
                <Truck className="h-5 w-5 text-amber-300" />خدمة جميع مناطق المملكة
              </span>
            </div>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-8">
            {[
              {icon: Building2, title: 'اسم موحّد وموثوق', text: 'الاسم الرسمي محلات النواصرة التجارية، والاسم المعروف محليًا محلات مهدي النواصرة التجارية.'},
              {icon: PackageCheck, title: 'منتجات الجملة', text: 'مواد غذائية وسكاكر وعصائر ومشروبات ضمن طرود ووحدات بيع واضحة.'},
              {icon: ShieldCheck, title: 'معلومات مباشرة', text: 'الأسعار والتوفر المعروضان في المتجر مرتبطان بنظام إدارة المخزون.'},
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <Icon className="h-6 w-6 text-blue-700" />
                  <h2 className="mt-4 text-sm font-black text-slate-950">{item.title}</h2>
                  <p className="mt-2 text-xs font-semibold leading-6 text-slate-600">{item.text}</p>
                </article>
              );
            })}
          </div>

          <div className="border-t border-slate-100 px-5 py-8 sm:px-8">
            <p className="text-xs font-black text-blue-700">تشكيلة تخدم احتياجات المحلات</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">أنواع البضائع الرئيسية</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {icon: Candy, title: 'السكاكر والحلويات', text: 'تشكيلة من السكاكر والبسكويت والشوكولاتة.'},
                {icon: GlassWater, title: 'العصائر والمشروبات', text: 'عصائر ومشروبات غازية ومشروبات طاقة.'},
                {icon: PackageCheck, title: 'الشيبس والتسالي', text: 'أصناف وطرود مناسبة لتجار التجزئة.'},
                {icon: Building2, title: 'مواد غذائية متنوعة', text: 'احتياجات أساسية ومتنوعة للمحلات.'},
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="rounded-3xl border border-amber-100 bg-amber-50/60 p-5">
                    <Icon className="h-6 w-6 text-amber-700" />
                    <h3 className="mt-3 text-sm font-black text-slate-950">{item.title}</h3>
                    <p className="mt-2 text-xs font-semibold leading-6 text-slate-600">{item.text}</p>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 px-5 py-7 sm:px-8">
            <div className="flex flex-col gap-3 text-sm font-bold text-slate-700 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
              <span className="inline-flex min-h-11 items-center gap-2"><MapPinned className="h-5 w-5 text-blue-700" />الرمثا، الأردن</span>
              <a className="inline-flex min-h-11 items-center gap-2 text-blue-800 hover:underline" href={`tel:${SEO_BRAND.publicPhone}`} dir="ltr">
                <Phone className="h-5 w-5" />0795957700
              </a>
              <a className="inline-flex min-h-11 items-center gap-2 text-blue-800 hover:underline" href={SEO_BRAND.socialProfiles[0]} target="_blank" rel="noreferrer">
                صفحة فيسبوك الرسمية <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={onBrowseProducts} className="min-h-11 rounded-2xl bg-blue-700 px-6 py-3 text-sm font-black text-white transition hover:bg-blue-800">
                تصفح منتجات الجملة
              </button>
              <a href={SEO_BRAND.directionsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-blue-200 bg-white px-6 py-3 text-sm font-black text-blue-800 transition hover:bg-blue-50">
                <MapPinned className="h-5 w-5" />الاتجاهات إلى المحل
              </a>
            </div>
          </div>
          </div>
        </div>
      </section>
      <StoreInfoSection whatsappUrl={whatsappUrl} onTrackOrder={onTrackOrder} settings={settings} />
    </>
  );
}
