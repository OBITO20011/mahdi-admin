import { ExternalLink, MapPinned, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { SEO_BRAND } from '../config/seoBrand';
import { getStorePagePath, type StorePage } from '../utils/publicRoutes';
import { StoreLogoMark } from './StoreLogoMark';

interface StoreFooterProps {
  whatsappUrl: string;
  onNavigate: (page: StorePage) => void;
  onTrackOrder: () => void;
  onOpenPrivacy: () => void;
}

export function StoreFooter({whatsappUrl, onNavigate, onTrackOrder, onOpenPrivacy}: StoreFooterProps) {
  const navLinks: Array<{label: string; page: StorePage}> = [
    {label: 'الرئيسية', page: 'home'},
    {label: 'جميع المنتجات', page: 'catalog'},
    {label: 'الأقسام', page: 'categories'},
    {label: 'العروض', page: 'offers'},
    {label: 'عن المحل', page: 'about'},
  ];
  const openAboutInfo = () => {
    onNavigate('about');
    window.setTimeout(() => document.getElementById('store-info')?.scrollIntoView({behavior: 'smooth'}), 50);
  };
  const linkClass = 'inline-flex min-h-11 items-center text-right text-xs font-bold text-blue-100/75 transition hover:text-white focus-visible:outline-none focus-visible:underline';

  return (
    <footer className="bg-[#06132b] px-4 pb-28 pt-12 text-blue-100 md:pb-8">
      <div className="mx-auto max-w-7xl lg:px-4">
        <div className="grid gap-10 sm:grid-cols-2 xl:grid-cols-4">
          <section aria-labelledby="footer-store-heading">
            <div className="flex items-center gap-3">
              <StoreLogoMark className="h-14 w-16" />
              <div>
                <h2 id="footer-store-heading" className="font-black text-white">{SEO_BRAND.officialName}</h2>
                <p className="mt-1 text-[10px] font-bold text-amber-300">خبرة أكثر من 20 سنة</p>
              </div>
            </div>
            <p className="mt-4 max-w-xs text-xs font-semibold leading-6 text-blue-100/65">
              مواد غذائية وسكاكر وعصائر ومشروبات بالجملة لخدمة المحلات في جميع مناطق المملكة.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={SEO_BRAND.socialProfiles[0]} target="_blank" rel="noreferrer" aria-label="صفحة محلات النواصرة على فيسبوك" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#1877f2] px-3 text-xs font-black text-white transition hover:bg-[#0f68da]">
                <span aria-hidden="true" className="font-serif text-xl font-black">f</span>فيسبوك
              </a>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="التواصل مع محلات النواصرة عبر واتساب" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700">
                <MessageCircle className="h-4 w-4" />واتساب
              </a>
            </div>
          </section>

          <nav aria-labelledby="footer-navigation-heading">
            <h2 id="footer-navigation-heading" className="text-sm font-black text-white">روابط سريعة</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-5 sm:grid-cols-1">
              {navLinks.map((item) => (
                <a key={item.label} href={getStorePagePath(item.page)} onClick={(event) => {event.preventDefault(); onNavigate(item.page);}} className={linkClass}>
                  {item.label}
                </a>
              ))}
            </div>
          </nav>

          <section aria-labelledby="footer-service-heading">
            <h2 id="footer-service-heading" className="text-sm font-black text-white">خدمة العملاء</h2>
            <div className="mt-3 flex flex-col items-start">
              <button type="button" onClick={onTrackOrder} className={linkClass}>متابعة الطلب</button>
              <button type="button" onClick={openAboutInfo} className={linkClass}>معلومات التوصيل والدفع</button>
              <button type="button" onClick={openAboutInfo} className={linkClass}>الاستبدال والاسترجاع</button>
              <button type="button" onClick={openAboutInfo} className={linkClass}>الأسئلة الشائعة</button>
            </div>
          </section>

          <section aria-labelledby="footer-contact-heading">
            <h2 id="footer-contact-heading" className="text-sm font-black text-white">تواصل وزيارة المحل</h2>
            <div className="mt-3 flex flex-col items-start">
              <a href={`tel:${SEO_BRAND.publicPhone}`} dir="ltr" className={`${linkClass} gap-2`}><Phone className="h-4 w-4" />0795957700</a>
              <a href={SEO_BRAND.directionsUrl} target="_blank" rel="noreferrer" className={`${linkClass} gap-2`}><MapPinned className="h-4 w-4" />الاتجاهات إلى المحل <ExternalLink className="h-3 w-3" /></a>
              <span className="inline-flex min-h-11 items-center gap-2 text-xs font-bold text-blue-100/75"><ShieldCheck className="h-4 w-4 text-emerald-400" />طلب آمن ولا يحتاج حسابًا</span>
              <span className="inline-flex min-h-11 items-center text-xs font-bold text-blue-100/75">الدفع: كاش أو CliQ</span>
              <button type="button" onClick={onOpenPrivacy} className={linkClass}>سياسة الخصوصية وحماية البيانات</button>
            </div>
          </section>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-[10px] font-bold text-blue-100/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2000–{new Date().getFullYear()} {SEO_BRAND.officialName} — جميع الحقوق محفوظة.</p>
          <p>الموقع الرسمي لخدمة تجار الجملة في جميع مناطق المملكة.</p>
        </div>
      </div>
    </footer>
  );
}
