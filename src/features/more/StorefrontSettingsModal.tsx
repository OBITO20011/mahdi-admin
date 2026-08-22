import {
  Banknote,
  Clock3,
  ExternalLink,
  Globe2,
  LoaderCircle,
  MapPinned,
  MessageCircle,
  Save,
  ShieldCheck,
  Store,
  Truck,
  Sparkles,
  Flame,
  BadgePercent,
  PackageOpen,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  fetchStorefrontSettings,
  saveStorefrontSettings,
} from '../../services/supabase/storefront-settings.service';
import { useAppStore } from '../../stores/useAppStore';
import { StorefrontSettingsInput } from '../../types/storefront';

const EMPTY_SETTINGS: StorefrontSettingsInput = {
  storeNameAr: 'محلات النواصرة',
  whatsappNumber: '0772838886',
  cliqAlias: '',
  ordersEnabled: true,
  announcementText: 'الأسعار والكميات تُحدّث مباشرة من مخزون محلات النواصرة',
  businessHoursText: 'يُؤكد وقت التجهيز والتوصيل بعد مراجعة الطلب.',
  deliveryAreasText: 'الرمثا وإربد والمناطق المحيطة، وتُؤكد المنطقة مع الإدارة.',
  deliveryEtaText: 'تعتمد على المنطقة وتوفر الأصناف ويؤكدها فريق المتجر.',
  exchangePolicyText: 'تواصل معنا فورًا عند وجود خطأ أو تلف قبل فتح الطرد.',
  minimumOrder: 0,
  insideRamthaDeliveryFee: 0,
  outsideRamthaDeliveryFee: 0,
  showNewestProducts: true,
  showBestSellers: true,
  showOffers: true,
  showLowStock: true,
};

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

function TextArea({
  label,
  icon: Icon,
  value,
  onChange,
}: {
  label: string;
  icon: typeof Store;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-[11px] font-black text-slate-300">
        <Icon className="h-4 w-4 text-blue-400" />
        {label}
      </span>
      <textarea
        rows={2}
        required
        maxLength={500}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} resize-none leading-6`}
      />
    </label>
  );
}

function SectionToggle({
  label,
  description,
  icon: Icon,
  enabled,
  onToggle,
}: {
  label: string;
  description: string;
  icon: typeof Store;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-right transition ${enabled ? 'border-blue-700/60 bg-blue-950/30' : 'border-slate-800 bg-slate-950/70 opacity-70'}`}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${enabled ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-800 text-slate-500'}`}><Icon className="h-4 w-4" /></span>
        <span><strong className="block text-xs font-black text-slate-100">{label}</strong><span className="mt-1 block text-[9px] font-bold leading-4 text-slate-400">{description}</span></span>
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${enabled ? 'bg-blue-500' : 'bg-slate-700'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${enabled ? 'right-1' : 'right-5'}`} /></span>
    </button>
  );
}

export function StorefrontSettingsModal() {
  const { setToast } = useAppStore();
  const [form, setForm] = useState<StorefrontSettingsInput>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    void fetchStorefrontSettings()
      .then((settings) => {
        if (!mounted) return;
        const { updatedAt: _updatedAt, ...editable } = settings;
        void _updatedAt;
        setForm(editable);
      })
      .catch((reason) => {
        if (mounted) setError(reason instanceof Error ? reason.message : 'تعذر تحميل الإعدادات.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const update = <Key extends keyof StorefrontSettingsInput>(
    key: Key,
    value: StorefrontSettingsInput[Key]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await saveStorefrontSettings(form);
      const { updatedAt: _updatedAt, ...editable } = result.settings;
      void _updatedAt;
      setForm(editable);
      setToast(result.message, 'success');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'تعذر حفظ إعدادات المتجر.';
      setError(message);
      setToast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-slate-400"><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ تحميل إعدادات المتجر من Supabase...</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
      <div className={`rounded-2xl border p-4 ${form.ordersEnabled ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-rose-700/60 bg-rose-950/30'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${form.ordersEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}><Globe2 className="h-5 w-5" /></div>
            <div><h4 className="text-sm font-black text-white">استقبال طلبات الموقع</h4><p className="mt-1 text-[10px] font-bold leading-5 text-slate-400">الإيقاف يمنع حفظ أي طلب جديد من الموقع داخل قاعدة البيانات.</p></div>
          </div>
          <button type="button" role="switch" aria-checked={form.ordersEnabled} onClick={() => update('ordersEnabled', !form.ordersEnabled)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${form.ordersEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${form.ordersEnabled ? 'right-1' : 'right-6'}`} /></button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
        <h4 className="mb-4 flex items-center gap-2 text-xs font-black text-white"><Store className="h-4 w-4 text-orange-400" />هوية المتجر والتواصل</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-black text-slate-300">اسم المتجر<input required minLength={2} maxLength={120} value={form.storeNameAr} onChange={(event) => update('storeNameAr', event.target.value)} className={`${inputClass} mt-2`} /></label>
          <label className="text-[11px] font-black text-slate-300">رقم واتساب<input required dir="ltr" inputMode="tel" value={form.whatsappNumber} onChange={(event) => update('whatsappNumber', event.target.value)} className={`${inputClass} mt-2 text-left`} /></label>
          <label className="text-[11px] font-black text-slate-300 sm:col-span-2">اسم أو رقم CliQ (اختياري)<input dir="ltr" maxLength={120} value={form.cliqAlias} onChange={(event) => update('cliqAlias', event.target.value)} placeholder="مثال: NAWASRAH" className={`${inputClass} mt-2 text-left`} /></label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
        <h4 className="mb-4 flex items-center gap-2 text-xs font-black text-white"><Banknote className="h-4 w-4 text-emerald-400" />قواعد الطلب والتوصيل</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-[11px] font-black text-slate-300">الحد الأدنى للطلب (د.أ)<input type="number" min="0" step="0.001" value={form.minimumOrder} onChange={(event) => update('minimumOrder', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
          <label className="text-[11px] font-black text-slate-300">توصيل داخل الرمثا (د.أ)<input type="number" min="0" step="0.001" value={form.insideRamthaDeliveryFee} onChange={(event) => update('insideRamthaDeliveryFee', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
          <label className="text-[11px] font-black text-slate-300">توصيل خارج الرمثا (د.أ)<input type="number" min="0" step="0.001" value={form.outsideRamthaDeliveryFee} onChange={(event) => update('outsideRamthaDeliveryFee', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/25 p-3 text-[10px] font-bold leading-5 text-emerald-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />العميل يختار داخل أو خارج الرمثا، وقاعدة البيانات تضيف السعر المحفوظ هنا إلى إجمالي الطلب؛ لا يمكن تغييره من المتصفح.</p>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
        <div className="mb-4"><h4 className="flex items-center gap-2 text-xs font-black text-white"><Sparkles className="h-4 w-4 text-violet-400" />أقسام الصفحة الرئيسية</h4><p className="mt-1 text-[10px] font-bold leading-5 text-slate-400">اختر الأقسام التي تريد إظهارها. محتواها يُحسب تلقائيًا من المنتجات والمبيعات الحقيقية.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <SectionToggle label="وصل حديثًا" description="أحدث الأصناف المضافة من تطبيق الإدارة." icon={Sparkles} enabled={form.showNewestProducts} onToggle={() => update('showNewestProducts', !form.showNewestProducts)} />
          <SectionToggle label="الأكثر طلبًا" description="من الطلبات المكتملة خلال آخر 90 يومًا." icon={Flame} enabled={form.showBestSellers} onToggle={() => update('showBestSellers', !form.showBestSellers)} />
          <SectionToggle label="عروض الجملة" description="الأصناف التابعة لقسم العروض الخاصة." icon={BadgePercent} enabled={form.showOffers} onToggle={() => update('showOffers', !form.showOffers)} />
          <SectionToggle label="قارب على النفاد" description="الأصناف المتاحة التي وصلت إلى حد التنبيه." icon={PackageOpen} enabled={form.showLowStock} onToggle={() => update('showLowStock', !form.showLowStock)} />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
        <TextArea label="الشريط الإعلاني" icon={MessageCircle} value={form.announcementText} onChange={(value) => update('announcementText', value)} />
        <TextArea label="مناطق التوصيل" icon={MapPinned} value={form.deliveryAreasText} onChange={(value) => update('deliveryAreasText', value)} />
        <TextArea label="أوقات الدوام والتجهيز" icon={Clock3} value={form.businessHoursText} onChange={(value) => update('businessHoursText', value)} />
        <TextArea label="مدة التوصيل" icon={Truck} value={form.deliveryEtaText} onChange={(value) => update('deliveryEtaText', value)} />
        <TextArea label="سياسة الاستبدال والاسترجاع" icon={ShieldCheck} value={form.exchangePolicyText} onChange={(value) => update('exchangePolicyText', value)} />
      </section>

      {error && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-[11px] font-bold text-rose-300">{error}</div>}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <button type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-500 disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق على الموقع'}</button>
        <a href="https://nawasrah-store.pages.dev/" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-black text-slate-200"><ExternalLink className="h-4 w-4" />معاينة الموقع</a>
      </div>
    </form>
  );
}
