import {Card, FormFields, UiButton, MoneyText, formatUiDate} from '../../components/ui';
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
  'w-full rounded-xl border border-nw-border bg-nw-surface-2 px-3 py-2.5 text-xs font-bold text-nw-text outline-none transition placeholder:text-nw-muted focus:border-nw-primary';

function toLocalDateTimeValue(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value?: string): string {
  if (!value) return 'مفتوح';
  return formatUiDate(value, {
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
    <FormFields aria-busy={isSaving || busyCodeId !== null} className="nw-batch5-fields space-y-4 text-sm">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-nw-info bg-nw-info-bg p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-nw-info-bg text-nw-info">
              <TicketPercent className="h-4 w-4" />
            </div>
            <div>
              <h4 className="font-black text-nw-text">
                {form.id ? 'تعديل رمز الخصم' : 'إنشاء رمز خصم'}
              </h4>
              <p className="text-xs text-nw-muted">
                يُحسب الخصم من قاعدة البيانات عند الطلب
              </p>
            </div>
          </div>
          {form.id && (
            <UiButton variant="plain"
              type="button"
              onClick={() => setForm(EMPTY_FORM)}
              className="inline-flex items-center gap-1 rounded-lg border border-nw-border px-2 py-1 text-xs font-bold text-nw-muted"
            >
              <X className="h-3 w-3" />
              إلغاء التعديل
            </UiButton>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block font-bold text-nw-muted">الرمز *</span>
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
            <span className="mb-1 block font-bold text-nw-muted">النوع *</span>
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
            <span className="mb-1 block font-bold text-nw-muted">
              {form.discountType === 'fixed'
                ? 'قيمة الخصم (د.أ) *'
                : 'نسبة الخصم % *'}
            </span>
            <input inputMode="decimal" enterKeyHint="next"
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
            <span className="mb-1 block font-bold text-nw-muted">
              أقل طلب (د.أ)
            </span>
            <input inputMode="decimal" enterKeyHint="next"
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
              <span className="mb-1 block font-bold text-nw-muted">
                أعلى خصم (د.أ) — اختياري
              </span>
              <input inputMode="decimal" enterKeyHint="next"
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
            <span className="mb-1 block font-bold text-nw-muted">الوصف</span>
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
            <span className="mb-1 block font-bold text-nw-muted">يبدأ</span>
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
            <span className="mb-1 block font-bold text-nw-muted">ينتهي</span>
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
            <span className="mb-1 block font-bold text-nw-muted">
              أقصى استخدام إجمالي
            </span>
            <input inputMode="numeric" enterKeyHint="next"
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
            <span className="mb-1 block font-bold text-nw-muted">
              لكل رقم هاتف
            </span>
            <input inputMode="numeric" enterKeyHint="next"
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

        <label className="flex items-start justify-between gap-3 rounded-xl border border-nw-info bg-nw-info-bg p-3">
          <span>
            <span className="block font-black text-nw-info">
              فعال ويظهر في عروض الموقع
            </span>
            <span className="mt-1 block text-xs font-bold leading-5 text-nw-info">
              تفعيل هذا الخيار ينشر الرمز نفسه فقط. وإذا كان تاريخ بدايته لاحقًا يظهر كعرض مجدول.
            </span>
          </span>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setFormField('isActive', event.target.checked)
            }
            className="mt-1 h-4 w-4 shrink-0 accent-nw-primary"
          />
        </label>

        {error && (
          <div className="rounded-xl border border-nw-bad bg-nw-bad-bg p-2.5 font-bold text-nw-bad">
            {error}
          </div>
        )}

        <UiButton variant="plain"
          type="submit"
          disabled={isSaving}
          className="sticky bottom-0 z-10 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-nw-primary py-3 font-black text-nw-on-primary disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {form.id ? 'حفظ تعديل الرمز' : 'إنشاء رمز الخصم'}
        </UiButton>
      </form>

      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-black text-nw-text">الرموز الحالية</h4>
          <p className="text-xs text-nw-muted">
            الإيقاف يحفظ سجل الطلبات والاستخدامات السابقة
          </p>
        </div>
        <UiButton variant="plain"
          type="button"
          onClick={() => void loadCodes()}
          disabled={isLoading}
          className="grid h-11 w-11 place-items-center rounded-lg border border-nw-border text-nw-muted"
          aria-label="تحديث رموز الخصم"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </UiButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-nw-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ تحميل الرموز...
        </div>
      ) : codes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-nw-border p-6 text-center text-nw-muted">
          <BadgePercent className="mx-auto mb-2 h-7 w-7" />
          لا توجد رموز خصم حتى الآن.
        </div>
      ) : (
        <div className="space-y-2">
          {codes.map((code) => (
            <Card key={code.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="font-mono text-sm text-nw-info">
                      {code.code}
                    </strong>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-black ${
                        code.isActive
                          ? 'bg-nw-ok-bg text-nw-ok'
                          : 'bg-nw-surface text-nw-muted'
                      }`}
                    >
                      {code.isActive ? 'فعال' : 'متوقف'}
                    </span>
                    {code.isActive && code.isPublicOffer && (
                      <span className="rounded-full bg-nw-info-bg px-2 py-0.5 text-xs font-black text-nw-info">
                        يظهر في العروض
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-nw-muted">
                    {code.description || 'بدون وصف'}
                  </p>
                </div>
                <strong className="text-nw-ok">
                  {code.discountType === 'percentage'
                    ? `${code.discountValue}%`
                    : <MoneyText amount={code.discountValue} />}
                </strong>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-nw-surface p-2 text-nw-muted">
                  <Users className="mb-1 h-3.5 w-3.5 text-nw-info" />
                  {code.redemptionCount}
                  {code.maximumTotalRedemptions
                    ? ` / ${code.maximumTotalRedemptions}`
                    : ''}{' '}
                  استخدام
                </div>
                <div className="rounded-xl bg-nw-surface p-2 text-nw-muted">
                  <CalendarClock className="mb-1 h-3.5 w-3.5 text-nw-warn" />
                  ينتهي: {formatDate(code.expiresAt)}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setForm(editForm(code))}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-nw-border py-2 font-bold text-nw-text"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  تعديل
                </UiButton>
                <UiButton variant="plain"
                  type="button"
                  onClick={() => void handleToggle(code)}
                  disabled={busyCodeId === code.id}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 font-bold text-nw-text disabled:opacity-50 ${
                    code.isActive ? 'bg-nw-bad-bg' : 'bg-nw-ok-bg'
                  }`}
                >
                  {busyCodeId === code.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                  {code.isActive ? 'إيقاف' : 'تفعيل'}
                </UiButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </FormFields>
  );
};
