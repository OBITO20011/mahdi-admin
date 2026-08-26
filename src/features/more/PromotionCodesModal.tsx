import React, { FormEvent, useEffect, useState } from 'react';
import {
  BadgePercent,
  CalendarClock,
  Edit3,
  Loader2,
  Power,
  RefreshCw,
  Save,
  TicketPercent,
  Users,
  X,
} from 'lucide-react';
import {
  fetchPromotionCodes,
  savePromotionCode,
  setPromotionCodeActive,
} from '../../services/supabase/promotions.service';
import {
  PromotionCode,
  PromotionCodeInput,
} from '../../types/promotions';
import { useAppStoreActions } from '../../stores/useAppStore';

interface PromotionFormState {
  id?: string;
  code: string;
  description: string;
  discountType: 'fixed' | 'percentage';
  discountValue: string;
  minimumSubtotal: string;
  maximumDiscount: string;
  startsAt: string;
  expiresAt: string;
  maximumTotalRedemptions: string;
  maximumRedemptionsPerPhone: string;
  isActive: boolean;
  isPublicOffer: boolean;
}

const EMPTY_FORM: PromotionFormState = {
  code: '',
  description: '',
  discountType: 'fixed',
  discountValue: '',
  minimumSubtotal: '0',
  maximumDiscount: '',
  startsAt: '',
  expiresAt: '',
  maximumTotalRedemptions: '',
  maximumRedemptionsPerPhone: '1',
  isActive: true,
  isPublicOffer: true,
};

const inputClassName =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-violet-500';

function toLocalDateTimeValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value?: string): string {
  if (!value) return 'مفتوح';
  return new Date(value).toLocaleString('ar-JO', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function editForm(code: PromotionCode): PromotionFormState {
  return {
    id: code.id,
    code: code.code,
    description: code.description,
    discountType: code.discountType,
    discountValue: String(code.discountValue),
    minimumSubtotal: String(code.minimumSubtotal),
    maximumDiscount:
      code.maximumDiscount === undefined
        ? ''
        : String(code.maximumDiscount),
    startsAt: toLocalDateTimeValue(code.startsAt),
    expiresAt: toLocalDateTimeValue(code.expiresAt),
    maximumTotalRedemptions:
      code.maximumTotalRedemptions === undefined
        ? ''
        : String(code.maximumTotalRedemptions),
    maximumRedemptionsPerPhone: String(
      code.maximumRedemptionsPerPhone
    ),
    isActive: code.isActive,
    isPublicOffer: true,
  };
}

function toOptionalPositiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export const PromotionCodesModal: React.FC = () => {
  const { setToast } = useAppStoreActions();
  const [codes, setCodes] = useState<PromotionCode[]>([]);
  const [form, setForm] = useState<PromotionFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyCodeId, setBusyCodeId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadCodes = async () => {
    setIsLoading(true);
    setError('');
    try {
      setCodes(await fetchPromotionCodes());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'تعذر تحميل رموز الخصم.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCodes();
  }, []);

  const setFormField = <Field extends keyof PromotionFormState>(
    field: Field,
    value: PromotionFormState[Field]
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const discountValue = Number(form.discountValue);
    const minimumSubtotal = Number(form.minimumSubtotal || 0);
    const maximumRedemptionsPerPhone = Number(
      form.maximumRedemptionsPerPhone
    );

    if (!/^[A-Z0-9_-]{3,32}$/.test(form.code.trim().toUpperCase())) {
      setError('الرمز يجب أن يحتوي 3 إلى 32 حرفًا أو رقمًا إنجليزيًا.');
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setError('اكتب قيمة خصم أكبر من صفر.');
      return;
    }
    if (form.discountType === 'percentage' && discountValue > 100) {
      setError('نسبة الخصم لا يمكن أن تتجاوز 100%.');
      return;
    }
    if (!Number.isFinite(minimumSubtotal) || minimumSubtotal < 0) {
      setError('الحد الأدنى للطلب غير صحيح.');
      return;
    }
    if (
      !Number.isFinite(maximumRedemptionsPerPhone) ||
      maximumRedemptionsPerPhone < 1
    ) {
      setError('عدد الاستخدامات لكل هاتف يجب أن يكون مرة واحدة على الأقل.');
      return;
    }

    const input: PromotionCodeInput = {
      id: form.id,
      code: form.code,
      description: form.description,
      discountType: form.discountType,
      discountValue,
      minimumSubtotal,
      maximumDiscount: toOptionalPositiveNumber(form.maximumDiscount),
      startsAt: form.startsAt
        ? new Date(form.startsAt).toISOString()
        : undefined,
      expiresAt: form.expiresAt
        ? new Date(form.expiresAt).toISOString()
        : undefined,
      maximumTotalRedemptions: toOptionalPositiveNumber(
        form.maximumTotalRedemptions
      ),
      maximumRedemptionsPerPhone,
      isActive: form.isActive,
      isPublicOffer: true,
    };

    setIsSaving(true);
    setError('');
    try {
      const message = await savePromotionCode(input);
      setToast(message, 'success');
      setForm(EMPTY_FORM);
      await loadCodes();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'تعذر حفظ رمز الخصم.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (code: PromotionCode) => {
    setBusyCodeId(code.id);
    setError('');
    try {
      const message = code.isActive
        ? await setPromotionCodeActive(code.id, false)
        : await savePromotionCode({
            id: code.id,
            code: code.code,
            description: code.description,
            discountType: code.discountType,
            discountValue: code.discountValue,
            minimumSubtotal: code.minimumSubtotal,
            maximumDiscount: code.maximumDiscount,
            startsAt: code.startsAt,
            expiresAt: code.expiresAt,
            maximumTotalRedemptions: code.maximumTotalRedemptions,
            maximumRedemptionsPerPhone: code.maximumRedemptionsPerPhone,
            isActive: true,
            isPublicOffer: true,
          });
      setToast(message, 'success');
      await loadCodes();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : 'تعذر تحديث حالة رمز الخصم.'
      );
    } finally {
      setBusyCodeId(null);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-violet-800/50 bg-violet-950/20 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-600/20 text-violet-400">
              <TicketPercent className="h-4 w-4" />
            </div>
            <div>
              <h4 className="font-black text-slate-100">
                {form.id ? 'تعديل رمز الخصم' : 'إنشاء رمز خصم'}
              </h4>
              <p className="text-[10px] text-slate-500">
                يُحسب الخصم من قاعدة البيانات عند الطلب
              </p>
            </div>
          </div>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm(EMPTY_FORM)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-400"
            >
              <X className="h-3 w-3" />
              إلغاء التعديل
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block font-bold text-slate-400">الرمز *</span>
            <input
              dir="ltr"
              value={form.code}
              onChange={(event) =>
                setFormField('code', event.target.value.toUpperCase())
              }
              maxLength={32}
              placeholder="WELCOME10"
              className={`${inputClassName} text-left uppercase`}
            />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block font-bold text-slate-400">النوع *</span>
            <select
              value={form.discountType}
              onChange={(event) =>
                setFormField(
                  'discountType',
                  event.target.value as 'fixed' | 'percentage'
                )
              }
              className={inputClassName}
            >
              <option value="fixed">مبلغ ثابت (د.أ)</option>
              <option value="percentage">نسبة مئوية</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">
              {form.discountType === 'fixed'
                ? 'قيمة الخصم (د.أ) *'
                : 'نسبة الخصم % *'}
            </span>
            <input
              type="number"
              min="0.001"
              step={form.discountType === 'fixed' ? '0.001' : '0.01'}
              value={form.discountValue}
              onChange={(event) =>
                setFormField('discountValue', event.target.value)
              }
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">
              أقل طلب (د.أ)
            </span>
            <input
              type="number"
              min="0"
              step="0.001"
              value={form.minimumSubtotal}
              onChange={(event) =>
                setFormField('minimumSubtotal', event.target.value)
              }
              className={inputClassName}
            />
          </label>
          {form.discountType === 'percentage' && (
            <label className="col-span-2">
              <span className="mb-1 block font-bold text-slate-400">
                أعلى خصم (د.أ) — اختياري
              </span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={form.maximumDiscount}
                onChange={(event) =>
                  setFormField('maximumDiscount', event.target.value)
                }
                className={inputClassName}
              />
            </label>
          )}
          <label className="col-span-2">
            <span className="mb-1 block font-bold text-slate-400">الوصف</span>
            <input
              value={form.description}
              onChange={(event) =>
                setFormField('description', event.target.value)
              }
              placeholder="مثال: خصم عملاء افتتاح الموقع"
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">يبدأ</span>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setFormField('startsAt', event.target.value)
              }
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">ينتهي</span>
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) =>
                setFormField('expiresAt', event.target.value)
              }
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">
              أقصى استخدام إجمالي
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.maximumTotalRedemptions}
              onChange={(event) =>
                setFormField(
                  'maximumTotalRedemptions',
                  event.target.value
                )
              }
              placeholder="بلا حد"
              className={inputClassName}
            />
          </label>
          <label>
            <span className="mb-1 block font-bold text-slate-400">
              لكل رقم هاتف
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.maximumRedemptionsPerPhone}
              onChange={(event) =>
                setFormField(
                  'maximumRedemptionsPerPhone',
                  event.target.value
                )
              }
              className={inputClassName}
            />
          </label>
        </div>

        <label className="flex items-start justify-between gap-3 rounded-xl border border-violet-800/60 bg-violet-950/30 p-3">
          <span>
            <span className="block font-black text-violet-200">
              فعال ويظهر في عروض الموقع
            </span>
            <span className="mt-1 block text-[10px] font-bold leading-5 text-violet-400">
              تفعيل هذا الخيار ينشر الرمز نفسه فقط. وإذا كان تاريخ بدايته لاحقًا يظهر كعرض مجدول.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setFormField('isActive', event.target.checked)
            }
            className="mt-1 h-4 w-4 shrink-0 accent-violet-600"
          />
        </label>

        {error && (
          <div className="rounded-xl border border-rose-800 bg-rose-950/40 p-2.5 font-bold text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 font-black text-white disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {form.id ? 'حفظ تعديل الرمز' : 'إنشاء رمز الخصم'}
        </button>
      </form>

      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-black text-slate-100">الرموز الحالية</h4>
          <p className="text-[10px] text-slate-500">
            الإيقاف يحفظ سجل الطلبات والاستخدامات السابقة
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadCodes()}
          disabled={isLoading}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 text-slate-400"
          aria-label="تحديث رموز الخصم"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ تحميل الرموز...
        </div>
      ) : codes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-500">
          <BadgePercent className="mx-auto mb-2 h-7 w-7" />
          لا توجد رموز خصم حتى الآن.
        </div>
      ) : (
        <div className="space-y-2">
          {codes.map((code) => (
            <div
              key={code.id}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="font-mono text-sm text-violet-300">
                      {code.code}
                    </strong>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                        code.isActive
                          ? 'bg-emerald-950 text-emerald-300'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {code.isActive ? 'فعال' : 'متوقف'}
                    </span>
                    {code.isActive && code.isPublicOffer && (
                      <span className="rounded-full bg-violet-950 px-2 py-0.5 text-[9px] font-black text-violet-300">
                        يظهر في العروض
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {code.description || 'بدون وصف'}
                  </p>
                </div>
                <strong className="text-emerald-400">
                  {code.discountType === 'percentage'
                    ? `${code.discountValue}%`
                    : `${code.discountValue.toFixed(3)} د.أ`}
                </strong>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-xl bg-slate-900 p-2 text-slate-400">
                  <Users className="mb-1 h-3.5 w-3.5 text-blue-400" />
                  {code.redemptionCount}
                  {code.maximumTotalRedemptions
                    ? ` / ${code.maximumTotalRedemptions}`
                    : ''}{' '}
                  استخدام
                </div>
                <div className="rounded-xl bg-slate-900 p-2 text-slate-400">
                  <CalendarClock className="mb-1 h-3.5 w-3.5 text-amber-400" />
                  ينتهي: {formatDate(code.expiresAt)}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm(editForm(code))}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 py-2 font-bold text-slate-300"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  تعديل
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggle(code)}
                  disabled={busyCodeId === code.id}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 font-bold text-white disabled:opacity-50 ${
                    code.isActive ? 'bg-rose-700' : 'bg-emerald-700'
                  }`}
                >
                  {busyCodeId === code.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                  {code.isActive ? 'إيقاف' : 'تفعيل'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
