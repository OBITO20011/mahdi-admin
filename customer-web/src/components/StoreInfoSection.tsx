import { Clock3, CreditCard, HelpCircle, MapPinned, Phone, RefreshCcw, Truck } from 'lucide-react';
import { PublicStorefrontSettings } from '../types/storefront';

export function StoreInfoSection({ whatsappUrl, onTrackOrder, settings }: { whatsappUrl: string; onTrackOrder: () => void; settings: PublicStorefrontSettings }) {
  const info = [
    { icon: MapPinned, title: 'مناطق التوصيل', text: settings.deliveryAreasText },
    { icon: Clock3, title: 'أوقات الدوام', text: settings.businessHoursText },
    { icon: CreditCard, title: 'طريقة الدفع', text: settings.cliqAlias ? 'كاش عند الاستلام أو CliQ حسب اختيارك في الطلب.' : 'كاش عند الاستلام أو CliQ، وتؤكد الإدارة بيانات التحويل.' },
    { icon: Truck, title: 'مدة التوصيل', text: settings.deliveryEtaText },
    { icon: RefreshCcw, title: 'الاستبدال والاسترجاع', text: settings.exchangePolicyText },
    { icon: HelpCircle, title: 'أسئلة شائعة', text: 'الأسعار للطرد الكامل، والطلب لا يحتاج حسابًا أو كلمة مرور.' },
  ];
  return <section id="store-info" className="bg-white py-12">
    <div className="mx-auto max-w-7xl px-4 lg:px-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black text-blue-600">قبل أن تطلب</p><h2 className="mt-1 text-2xl font-black text-slate-950">معلومات مهمة وواضحة</h2></div><div className="flex gap-2"><button type="button" onClick={onTrackOrder} className="rounded-2xl bg-blue-700 px-4 py-3 text-xs font-black text-white">متابعة طلب</button><a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black text-white"><Phone className="h-4 w-4" />واتساب</a></div></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{info.map((item) => { const Icon = item.icon; return <article key={item.title} className="rounded-3xl border border-slate-200 bg-slate-50 p-5"><Icon className="h-5 w-5 text-blue-700" /><h3 className="mt-3 text-sm font-black text-slate-950">{item.title}</h3><p className="mt-2 text-[11px] font-semibold leading-6 text-slate-500">{item.text}</p></article>; })}</div>
      <p className="mt-4 text-[10px] font-bold leading-5 text-slate-400">{settings.minimumOrderInMinorUnits > 0 ? `الحد الأدنى للطلب ${new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD' }).format(settings.minimumOrderInMinorUnits / 1000)}.` : 'لا يوجد حد أدنى إضافي محدد حاليًا.'} أجرة التوصيل داخل الرمثا {new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD' }).format(settings.insideRamthaDeliveryFeeInMinorUnits / 1000)}، وخارج الرمثا {new Intl.NumberFormat('ar-JO', { style: 'currency', currency: 'JOD' }).format(settings.outsideRamthaDeliveryFeeInMinorUnits / 1000)}، وتضاف تلقائيًا إلى الإجمالي حسب اختيار العميل.</p>
    </div>
  </section>;
}
