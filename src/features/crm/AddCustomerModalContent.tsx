import React, { useId, useState } from 'react';
import { BadgeCheck, Loader2 } from 'lucide-react';
import { JORDAN_GOVERNORATES } from '../../constants';
import { createCustomerCrmInSupabase } from '../../services/supabase/crm.service';
import { useAppStoreActions } from '../../stores/useAppStore';

export interface CreatedCustomer {
  id: string;
  name: string;
  phone: string;
}

interface AddCustomerModalContentProps {
  onClose: () => void;
  onCreated?: (customer: CreatedCustomer) => void;
  quick?: boolean;
}

export const AddCustomerModalContent: React.FC<
  AddCustomerModalContentProps
> = ({ onClose, onCreated, quick = false }) => {
  const fieldId = useId();
  const { setToast } = useAppStoreActions();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const normalizedName = fullName.trim();
    const normalizedPhone = phone.trim();
    if (!normalizedName || !normalizedPhone) {
      setError('اسم العميل ورقم الهاتف مطلوبان.');
      return;
    }

    setSaving(true);
    try {
      setError(null);
      const result = await createCustomerCrmInSupabase({
        fullName: normalizedName,
        phone: normalizedPhone,
        whatsapp: quick ? undefined : whatsapp.trim() || undefined,
        governorate: quick ? undefined : governorate || undefined,
        customerType: 'wholesale',
      });


      if (!result.success || !result.customerId) {
        setError(result.error || 'تعذر إضافة العميل.');
        return;
      }

      onCreated?.({
        id: result.customerId,
        name: normalizedName,
        phone: normalizedPhone,
      });
      setToast(`تمت إضافة العميل ${normalizedName} واختياره بنجاح.`, 'success');
      onClose();

    } finally {
      setSaving(false);
    }
  };

  return (
    <form aria-busy={saving} onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div className="flex items-start gap-2 rounded-2xl border border-nw-ok/20 bg-nw-ok-bg p-3">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-nw-ok" />
        <div>
          <p className="font-extrabold text-nw-ok">عميل جملة مسجل</p>
          <p className="mt-0.5 text-[10px] leading-5 text-nw-muted">
            سيظهر في نقطة البيع، وسجل المشتريات، والحسابات المدينة.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-nw-bad">
          {error}
        </div>
      )}

      <div>
        <label htmlFor={`${fieldId}-name`} className="mb-1 block font-bold text-nw-text">
          اسم العميل أو المحل *
        </label>
        <input
          id={`${fieldId}-name`}
          type="text"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="مثال: سوبرماركت الرمثا"
          className="min-h-11 w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-base text-nw-text focus:border-nw-ok focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-phone`} className="mb-1 block font-bold text-nw-text">
          رقم الهاتف *
        </label>
        <input
          id={`${fieldId}-phone`}
          type="tel"
          inputMode="tel"
          dir="ltr"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="079XXXXXXX"
          className="min-h-11 w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-base text-left text-nw-text focus:border-nw-ok focus:outline-none"
        />
      </div>

      {!quick && <>
      <div>
        <label className="mb-1 block font-bold text-nw-text">
          رقم الواتساب (اختياري)
        </label>
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={whatsapp}
          onChange={(event) => setWhatsapp(event.target.value)}
          placeholder="اتركه فارغاً إذا كان نفس رقم الهاتف"
          className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-left text-nw-text focus:border-nw-ok focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-nw-text">المحافظة</label>
        <select
          value={governorate}
          onChange={(event) => setGovernorate(event.target.value)}
          className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text focus:border-nw-ok focus:outline-none"
        >
          <option value="">غير محددة</option>
          {JORDAN_GOVERNORATES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      </>}
      <button
        type="submit"
        disabled={saving}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-nw-ok-bg py-3 font-bold text-nw-ok shadow transition hover:bg-nw-ok-bg disabled:opacity-60"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
      </button>
    </form>
  );
};
