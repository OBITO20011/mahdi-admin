import React, { useState } from 'react';
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
}

export const AddCustomerModalContent: React.FC<
  AddCustomerModalContentProps
> = ({ onClose, onCreated }) => {
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
    setError(null);
    const result = await createCustomerCrmInSupabase({
      fullName: normalizedName,
      phone: normalizedPhone,
      whatsapp: whatsapp.trim() || undefined,
      governorate: governorate || undefined,
      customerType: 'wholesale',
    });
    setSaving(false);

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
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <div>
          <p className="font-extrabold text-emerald-300">عميل جملة مسجل</p>
          <p className="mt-0.5 text-[10px] leading-5 text-slate-400">
            سيظهر في نقطة البيع، وسجل المشتريات، والحسابات المدينة.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-rose-300">
          {error}
        </div>
      )}

      <div>
        <label className="mb-1 block font-bold text-slate-300">
          اسم العميل أو المحل *
        </label>
        <input
          type="text"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="مثال: سوبرماركت الرمثا"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">
          رقم الهاتف *
        </label>
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          required
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="079XXXXXXX"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-left text-white focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">
          رقم الواتساب (اختياري)
        </label>
        <input
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={whatsapp}
          onChange={(event) => setWhatsapp(event.target.value)}
          placeholder="اتركه فارغاً إذا كان نفس رقم الهاتف"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-left text-white focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">المحافظة</label>
        <select
          value={governorate}
          onChange={(event) => setGovernorate(event.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="">غير محددة</option>
          {JORDAN_GOVERNORATES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 font-bold text-white shadow transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
      </button>
    </form>
  );
};
