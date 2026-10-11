import {Card, FormFields, SwitchTrack, UiButton} from '../../components/ui';
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
import { useAppStoreActions } from '../../stores/useAppStore';
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
  'w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-xs font-bold text-nw-text outline-none transition focus:border-nw-primary focus:ring-2 focus:ring-nw-primary';

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
      <span className="mb-2 flex items-center gap-2 text-xs font-black text-nw-text">
        <Icon className="h-4 w-4 text-nw-info" />
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
    <UiButton variant="plain"
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-right transition ${enabled ? 'border-nw-info bg-nw-info-bg' : 'border-nw-border bg-nw-surface-2 '}`}
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${enabled ? 'bg-nw-info-bg text-nw-info' : 'bg-nw-surface text-nw-muted'}`}><Icon className="h-4 w-4" /></span>
        <span><strong className="block text-xs font-black text-nw-text">{label}</strong><span className="mt-1 block text-xs font-bold leading-4 text-nw-muted">{description}</span></span>
      </span>
      <span className="flex shrink-0 flex-col items-center gap-1"><SwitchTrack enabled={enabled} /><span className="text-xs text-nw-text">{enabled ? 'مفعّل' : 'متوقف'}</span></span>
    </UiButton>
  );
}

export function StorefrontSettingsModal() {
  const { setToast } = useAppStoreActions();
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
    return <div className="flex items-center justify-center gap-2 py-16 text-xs font-bold text-nw-muted"><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ تحميل إعدادات المتجر...</div>;
  }

  return (
    <FormFields className="nw-batch5-fields"><form aria-busy={saving} onSubmit={handleSubmit} className="space-y-4" dir="rtl">
      <div className={`rounded-2xl border p-4 ${form.ordersEnabled ? 'border-nw-ok bg-nw-ok-bg' : 'border-nw-bad bg-nw-bad-bg'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${form.ordersEnabled ? 'bg-nw-ok-bg text-nw-ok' : 'bg-nw-bad-bg text-nw-bad'}`}><Globe2 className="h-5 w-5" /></div>
            <div><h4 className="text-sm font-black text-nw-text">استقبال طلبات الموقع</h4><p className="mt-1 text-xs font-bold leading-5 text-nw-muted">الإيقاف يمنع حفظ أي طلب جديد من الموقع داخل قاعدة البيانات.</p></div>
          </div>
          <UiButton variant="plain" type="button" role="switch" aria-label="استقبال طلبات الموقع" aria-checked={form.ordersEnabled} onClick={() => update('ordersEnabled', !form.ordersEnabled)} className="h-11 w-12 shrink-0 p-0"><SwitchTrack enabled={form.ordersEnabled} /></UiButton>
        </div>
        <p className="mt-2 text-xs font-bold text-nw-text">{form.ordersEnabled ? 'يستقبل الطلبات' : 'متوقف'}</p>
      </div>

      <Card>
        <h4 className="mb-4 flex items-center gap-2 text-xs font-black text-nw-text"><Store className="h-4 w-4 text-nw-warn" />هوية المتجر والتواصل</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-black text-nw-text">اسم المتجر<input required minLength={2} maxLength={120} value={form.storeNameAr} onChange={(event) => update('storeNameAr', event.target.value)} className={`${inputClass} mt-2`} /></label>
          <label className="text-xs font-black text-nw-text">رقم واتساب<input required dir="ltr" inputMode="tel" value={form.whatsappNumber} onChange={(event) => update('whatsappNumber', event.target.value)} className={`${inputClass} mt-2 text-left`} /></label>
          <label className="text-xs font-black text-nw-text sm:col-span-2">اسم أو رقم CliQ (اختياري)<input dir="ltr" maxLength={120} value={form.cliqAlias} onChange={(event) => update('cliqAlias', event.target.value)} placeholder="مثال: NAWASRAH" className={`${inputClass} mt-2 text-left`} /></label>
        </div>
      </Card>

      <Card>
        <h4 className="mb-4 flex items-center gap-2 text-xs font-black text-nw-text"><Banknote className="h-4 w-4 text-nw-ok" />قواعد الطلب والتوصيل</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-black text-nw-text">الحد الأدنى للطلب (د.أ)<input type="number" min="0" step="0.001" value={form.minimumOrder} onChange={(event) => update('minimumOrder', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
          <label className="text-xs font-black text-nw-text">توصيل داخل الرمثا (د.أ)<input type="number" min="0" step="0.001" value={form.insideRamthaDeliveryFee} onChange={(event) => update('insideRamthaDeliveryFee', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
          <label className="text-xs font-black text-nw-text">توصيل خارج الرمثا (د.أ)<input type="number" min="0" step="0.001" value={form.outsideRamthaDeliveryFee} onChange={(event) => update('outsideRamthaDeliveryFee', Number(event.target.value))} className={`${inputClass} mt-2`} /></label>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-nw-ok bg-nw-ok-bg p-3 text-xs font-bold leading-5 text-nw-ok"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />العميل يختار داخل أو خارج الرمثا، وقاعدة البيانات تضيف السعر المحفوظ هنا إلى إجمالي الطلب؛ لا يمكن تغييره من المتصفح.</p>
      </Card>

      <Card>
        <div className="mb-4"><h4 className="flex items-center gap-2 text-xs font-black text-nw-text"><Sparkles className="h-4 w-4 text-nw-info" />أقسام الصفحة الرئيسية</h4><p className="mt-1 text-xs font-bold leading-5 text-nw-muted">اختر الأقسام التي تريد إظهارها. محتواها يُحسب تلقائيًا من المنتجات والمبيعات الحقيقية.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <SectionToggle label="وصل حديثًا" description="أحدث الأصناف المضافة من تطبيق الإدارة." icon={Sparkles} enabled={form.showNewestProducts} onToggle={() => update('showNewestProducts', !form.showNewestProducts)} />
          <SectionToggle label="الأكثر طلبًا" description="من الطلبات المكتملة خلال آخر 90 يومًا." icon={Flame} enabled={form.showBestSellers} onToggle={() => update('showBestSellers', !form.showBestSellers)} />
          <SectionToggle label="عروض الجملة" description="الأصناف التابعة لقسم العروض الخاصة." icon={BadgePercent} enabled={form.showOffers} onToggle={() => update('showOffers', !form.showOffers)} />
          <SectionToggle label="قارب على النفاد" description="الأصناف المتاحة التي وصلت إلى حد التنبيه." icon={PackageOpen} enabled={form.showLowStock} onToggle={() => update('showLowStock', !form.showLowStock)} />
        </div>
      </Card>

      <Card className="space-y-3">
        <TextArea label="الشريط الإعلاني" icon={MessageCircle} value={form.announcementText} onChange={(value) => update('announcementText', value)} />
        <TextArea label="مناطق التوصيل" icon={MapPinned} value={form.deliveryAreasText} onChange={(value) => update('deliveryAreasText', value)} />
        <TextArea label="أوقات الدوام والتجهيز" icon={Clock3} value={form.businessHoursText} onChange={(value) => update('businessHoursText', value)} />
        <TextArea label="مدة التوصيل" icon={Truck} value={form.deliveryEtaText} onChange={(value) => update('deliveryEtaText', value)} />
        <TextArea label="سياسة الاستبدال والاسترجاع" icon={ShieldCheck} value={form.exchangePolicyText} onChange={(value) => update('exchangePolicyText', value)} />
      </Card>

      {error && <div role="alert" className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-xs font-bold text-nw-bad">{error}</div>}

      <div className="sticky bottom-0 z-10 grid gap-2 bg-nw-surface py-2 sm:grid-cols-[1fr_auto]">
        <UiButton variant="plain" type="submit" disabled={saving} className="flex items-center justify-center gap-2 rounded-xl bg-nw-primary px-4 py-3 text-xs font-black text-nw-on-primary transition hover:bg-nw-primary disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق على الموقع'}</UiButton>
        <a href="https://alnawasreh.com/" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-nw-border bg-nw-surface px-4 py-3 text-xs font-black text-nw-text"><ExternalLink className="h-4 w-4" />معاينة الموقع</a>
      </div>
    </form></FormFields>
  );
}
