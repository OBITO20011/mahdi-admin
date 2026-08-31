import {
  AlertTriangle,
  BadgePercent,
  CheckCircle2,
  ClipboardCheck,
  ClipboardPaste,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  LocateFixed,
  MapPin,
  MapPinned,
  MessageCircle,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  UserRoundCheck,
  X,
  Banknote,
  Smartphone,
  Save,
  Trash2,
  Truck,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  previewGuestPromotion,
  submitGuestCustomerOrder,
} from '../services/orders.service';
import { CartItem } from '../types/catalog';
import {
  CheckoutErrors,
  CheckoutField,
  DeliveryZone,
  GuestCheckoutForm,
  GuestOrderReceipt,
  GuestPaymentMethod,
  GuestPromotionQuote,
} from '../types/checkout';
import {
  EMPTY_GUEST_CHECKOUT_FORM,
  buildGoogleMapsUrl,
  buildGuestOrderItems,
  buildWhatsAppOrderMessage,
  buildWhatsAppUrl,
  clearPendingOrder,
  createOrderFingerprint,
  createPromotionContextKey,
  MAX_GUEST_ORDER_LINE_ITEMS,
  MAX_GUEST_DELIVERY_DETAILS_LENGTH,
  getOrCreateIdempotencyKey,
  getOrCreateGuestOrderSessionId,
  extractGoogleMapsCoordinates,
  isSupportedGoogleMapsUrl,
  normalizePromotionCode,
  readSavedGuestCustomer,
  saveGuestCustomer,
  clearSavedGuestCustomer,
  saveLastGuestOrder,
  validateGuestCheckout,
} from '../utils/checkout';
import {
  calculateCartPackages,
  calculateCartSubtotal,
} from '../utils/cart';
import { formatJod } from '../utils/money';
import { CheckoutProgress } from './CheckoutProgress';
import { TurnstileWidget } from './TurnstileWidget';
import type { TurnstileStatus } from './TurnstileWidget';
import { PublicStorefrontSettings } from '../types/storefront';

interface CheckoutModalProps {
  isOpen: boolean;
  items: CartItem[];
  storeWhatsAppNumber: string;
  storefrontSettings: PublicStorefrontSettings;
  settingsUnavailable: boolean;
  initialPromotionCode?: string;
  onClose: () => void;
  onRetryStorefrontSettings: () => void;
  onOrderCreated: (receipt: GuestOrderReceipt, items: CartItem[]) => void;
  onTrackOrder: (receipt: GuestOrderReceipt) => void;
}

const GOVERNORATES = [
  'إربد',
  'المفرق',
  'جرش',
  'عجلون',
  'الزرقاء',
  'عمان',
  'البلقاء',
  'مادبا',
  'الكرك',
  'الطفيلة',
  'معان',
  'العقبة',
];

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, children }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-extrabold text-slate-700">
        {label}
        {required && <span className="mr-1 text-rose-500">*</span>}
      </span>
      {children}
      {error && (
        <span className="mt-1.5 block text-[10px] font-bold text-rose-600">
          {error}
        </span>
      )}
    </label>
  );
}

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100';

export function CheckoutModal({
  isOpen,
  items,
  storeWhatsAppNumber,
  storefrontSettings,
  settingsUnavailable,
  initialPromotionCode = '',
  onClose,
  onRetryStorefrontSettings,
  onOrderCreated,
  onTrackOrder,
}: CheckoutModalProps) {
  const [form, setForm] = useState<GuestCheckoutForm>(
    EMPTY_GUEST_CHECKOUT_FORM
  );
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<GuestOrderReceipt | null>(null);
  const [submittedItems, setSubmittedItems] = useState<CartItem[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [showLocationFallback, setShowLocationFallback] = useState(false);
  const [locationMode, setLocationMode] = useState<'current' | 'different'>(
    'current'
  );
  const [isPastingLocation, setIsPastingLocation] = useState(false);
  const [promotionInput, setPromotionInput] = useState('');
  const [promotionQuote, setPromotionQuote] =
    useState<GuestPromotionQuote | null>(null);
  const [promotionContextKey, setPromotionContextKey] = useState('');
  const [promotionError, setPromotionError] = useState('');
  const [isApplyingPromotion, setIsApplyingPromotion] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<GuestPaymentMethod>('cash_on_delivery');
  const [deliveryZone, setDeliveryZone] = useState<DeliveryZone>('inside_ramtha');
  const [saveCustomerDetails, setSaveCustomerDetails] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [turnstileStatus, setTurnstileStatus] = useState<TurnstileStatus>('loading');

  const displayedItems = receipt ? submittedItems : items;
  const packagesCount = calculateCartPackages(displayedItems);
  const subtotal = calculateCartSubtotal(displayedItems);
  const currentPromotionContextKey = useMemo(
    () => createPromotionContextKey(form.phone, items),
    [form.phone, items]
  );
  const activePromotionQuote =
    promotionQuote && promotionContextKey === currentPromotionContextKey
      ? promotionQuote
      : null;
  const checkoutBeforeDelivery = activePromotionQuote?.totalInMinorUnits ?? subtotal;
  const selectedDeliveryFee =
    deliveryZone === 'inside_ramtha'
      ? storefrontSettings.insideRamthaDeliveryFeeInMinorUnits
      : storefrontSettings.outsideRamthaDeliveryFeeInMinorUnits;
  const checkoutTotal = checkoutBeforeDelivery + selectedDeliveryFee;
  const whatsappUrl = useMemo(() => {
    if (!receipt) return '';
    return buildWhatsAppUrl(
      storeWhatsAppNumber,
      buildWhatsAppOrderMessage({
        receipt,
        customer: form,
        items: displayedItems,
        paymentMethod,
      })
    );
  }, [displayedItems, form, paymentMethod, receipt, storeWhatsAppNumber]);

  useEffect(() => {
    if (!isOpen || receipt) return;
    const saved = readSavedGuestCustomer(window.localStorage);
    if (saved) {
      setForm(saved);
      setDeliveryZone(
        `${saved.city} ${saved.area}`.includes('الرمثا')
          ? 'inside_ramtha'
          : 'outside_ramtha'
      );
      setSaveCustomerDetails(true);
      setLocationMode(
        saved.latitude !== null && saved.longitude !== null
          ? 'current'
          : saved.googleMapsUrl
            ? 'different'
            : 'current'
      );
    }
  }, [isOpen, receipt]);

  useEffect(() => {
    if (!settingsUnavailable || receipt) return;
    setIsReviewing(false);
    setTurnstileToken('');
    setSubmitError('تعذر التحقق من إعدادات الطلب والتوصيل. حاول مرة أخرى.');
  }, [receipt, settingsUnavailable]);

  useEffect(() => {
    if (!isOpen || receipt || !initialPromotionCode.trim()) return;
    const normalizedCode = normalizePromotionCode(initialPromotionCode);
    if (!normalizedCode) return;
    setPromotionInput(normalizedCode);
    setPromotionQuote(null);
    setPromotionContextKey('');
    setPromotionError('اضغط «تطبيق» بعد إدخال رقم الهاتف لتثبيت الخصم.');
  }, [initialPromotionCode, isOpen, receipt]);

  useEffect(() => {
    if (
      promotionQuote &&
      promotionContextKey &&
      promotionContextKey !== currentPromotionContextKey
    ) {
      setPromotionQuote(null);
      setPromotionContextKey('');
      setPromotionError(
        'تغير رقم الهاتف أو محتوى السلة؛ أعد تطبيق الرمز لحساب صحيح.'
      );
    }
  }, [
    currentPromotionContextKey,
    promotionContextKey,
    promotionQuote,
  ]);

  const setField = (field: CheckoutField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError('');
  };

  const handleMapUrlChange = (value: string) => {
    const coordinates = extractGoogleMapsCoordinates(value);
    setForm((current) => ({
      ...current,
      googleMapsUrl: value,
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null,
    }));
    setErrors((current) => ({
      ...current,
      googleMapsUrl: undefined,
    }));
    setLocationMessage('');
    setShowLocationFallback(false);
    setSubmitError('');
  };

  const handleLocationModeChange = (mode: 'current' | 'different') => {
    setLocationMode(mode);
    setForm((current) => ({
      ...current,
      googleMapsUrl: '',
      latitude: null,
      longitude: null,
    }));
    setErrors((current) => ({
      ...current,
      googleMapsUrl: undefined,
    }));
    setLocationMessage('');
    setShowLocationFallback(false);
    setSubmitError('');
  };

  const handlePasteMapUrl = async () => {
    if (!navigator.clipboard?.readText) {
      setErrors((current) => ({
        ...current,
        googleMapsUrl:
          'الصق رابط خرائط Google يدويًا في الخانة أدناه.',
      }));
      return;
    }

    setIsPastingLocation(true);
    try {
      const value = (await navigator.clipboard.readText()).trim();
      if (!isSupportedGoogleMapsUrl(value)) {
        setErrors((current) => ({
          ...current,
          googleMapsUrl:
            'الحافظة لا تحتوي رابط مشاركة صحيحًا من خرائط Google.',
        }));
        setLocationMessage('');
        return;
      }
      const coordinates = extractGoogleMapsCoordinates(value);
      handleMapUrlChange(value);
      setLocationMessage(
        coordinates
          ? 'تم لصق موقع التوصيل واستخراج الإحداثيات وتأكيدها.'
          : 'تم لصق رابط الموقع. الروابط المختصرة تبقى قابلة للفتح وتحتاج مراجعة الدبوس.'
      );
    } catch {
      setErrors((current) => ({
        ...current,
        googleMapsUrl:
          'تعذر قراءة الحافظة. الصق الرابط يدويًا في الخانة.',
      }));
    } finally {
      setIsPastingLocation(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setErrors((current) => ({
        ...current,
        googleMapsUrl: 'تحديد الموقع غير مدعوم على هذا الجهاز.',
      }));
      setShowLocationFallback(true);
      return;
    }

    setIsLocating(true);
    setLocationMessage('جارٍ تحديد موقعك بدقة...');
    setShowLocationFallback(false);
    setErrors((current) => ({
      ...current,
      googleMapsUrl: undefined,
    }));

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = Number(coords.latitude.toFixed(6));
        const longitude = Number(coords.longitude.toFixed(6));
        setForm((current) => ({
          ...current,
          latitude,
          longitude,
          googleMapsUrl: buildGoogleMapsUrl(latitude, longitude),
        }));
        setLocationMode('current');
        setLocationMessage('تم تحديد موقعك وإرفاق رابط الخرائط بالطلب.');
        setShowLocationFallback(false);
        setIsLocating(false);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'إذن الموقع مرفوض في هذا المتصفح. فعّله من إعدادات الموقع ثم أعد المحاولة.'
            : error.code === error.TIMEOUT
            ? 'استغرق تحديد الموقع وقتًا طويلًا. حاول مرة أخرى.'
            : 'تعذر تحديد الموقع الحالي. ألصق رابط الخرائط يدويًا.';
        setErrors((current) => ({
          ...current,
          googleMapsUrl: message,
        }));
        setLocationMessage('');
        setShowLocationFallback(true);
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      }
    );
  };

  const handlePromotionChange = (value: string) => {
    setPromotionInput(value.toUpperCase());
    setPromotionQuote(null);
    setPromotionError('');
    setSubmitError('');
  };

  const handleApplyPromotion = async () => {
    const code = normalizePromotionCode(promotionInput);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      setPromotionError('اكتب رمزًا صحيحًا ثم اضغط تطبيق.');
      return;
    }

    setIsApplyingPromotion(true);
    setPromotionError('');
    try {
      const quote = await previewGuestPromotion(
        code,
        buildGuestOrderItems(items),
        form.phone
      );
      setPromotionInput(quote.code);
      setPromotionQuote(quote);
      setPromotionContextKey(currentPromotionContextKey);
    } catch (error) {
      setPromotionQuote(null);
      setPromotionError(
        error instanceof Error
          ? error.message
          : 'تعذر التحقق من رمز الخصم.'
      );
    } finally {
      setIsApplyingPromotion(false);
    }
  };

  const handleRemovePromotion = () => {
    setPromotionInput('');
    setPromotionQuote(null);
    setPromotionContextKey('');
    setPromotionError('');
  };

  const validateForReview = () => {
    setSubmitError('');
    if (isSubmitting || receipt) return;
    if (settingsUnavailable) {
      setSubmitError('تعذر التحقق من إعدادات الطلب والتوصيل. حاول مرة أخرى.');
      return false;
    }
    if (items.length === 0) {
      setSubmitError('السلة فارغة. أضف طردًا قبل إرسال الطلب.');
      return false;
    }

    if (items.length > MAX_GUEST_ORDER_LINE_ITEMS) {
      setSubmitError(
        `الحد الأقصى للطلب هو ${MAX_GUEST_ORDER_LINE_ITEMS} صنفًا. احذف ${items.length - MAX_GUEST_ORDER_LINE_ITEMS} صنفًا على الأقل ثم حاول مرة أخرى.`
      );
      return false;
    }

    if (!storefrontSettings.ordersEnabled) {
      setSubmitError('الطلبات متوقفة مؤقتًا من إدارة المتجر. يمكنك التواصل معنا عبر واتساب.');
      return false;
    }

    if (subtotal < storefrontSettings.minimumOrderInMinorUnits) {
      setSubmitError(`الحد الأدنى للطلب هو ${formatJod(storefrontSettings.minimumOrderInMinorUnits)}. أضف أصنافًا أخرى للمتابعة.`);
      return false;
    }

    if (normalizePromotionCode(promotionInput) && !activePromotionQuote) {
      setPromotionError('اضغط «تطبيق» للتحقق من الرمز قبل إرسال الطلب.');
      return false;
    }

    const validationErrors = validateGuestCheckout(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setSubmitError('راجع الحقول المطلوبة قبل إرسال الطلب.');
      return false;
    }

    if (
      deliveryZone === 'inside_ramtha' &&
      !`${form.governorate} ${form.city} ${form.area}`.includes('الرمثا')
    ) {
      setErrors((current) => ({
        ...current,
        city: 'اكتب الرمثا أو اختر «خارج الرمثا» لحساب أجرة التوصيل الصحيحة.',
      }));
      setSubmitError('منطقة التوصيل لا تتطابق مع المدينة المدخلة.');
      return false;
    }

    return true;
  };

  const handleReview = (event: FormEvent) => {
    event.preventDefault();
    if (!validateForReview()) return;
    setIsReviewing(true);
  };

  const handleSubmit = async () => {
    if (!validateForReview()) return;
    if (!turnstileToken) {
      setSubmitError('أكمل التحقق الأمني قبل إرسال الطلب.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    try {
      const fingerprint = createOrderFingerprint(
        form,
        items,
        activePromotionQuote?.code,
        paymentMethod,
        deliveryZone
      );
      const idempotencyKey = getOrCreateIdempotencyKey(
        window.localStorage,
        fingerprint
      );
      const result = await submitGuestCustomerOrder({
        idempotencyKey,
        turnstileToken,
        clientSessionId: getOrCreateGuestOrderSessionId(
          window.sessionStorage
        ),
        customer: form,
        items: buildGuestOrderItems(items),
        promotionCode: activePromotionQuote?.code,
        paymentMethod,
        deliveryZone,
      });
      clearPendingOrder(window.localStorage);
      if (saveCustomerDetails) saveGuestCustomer(window.localStorage, form);
      else clearSavedGuestCustomer(window.localStorage);
      saveLastGuestOrder(window.localStorage, result.orderNumber, items);
      setSubmittedItems(items);
      setReceipt(result);
      onOrderCreated(result, items);

      const popup = window.open(
        buildWhatsAppUrl(
          storeWhatsAppNumber,
          buildWhatsAppOrderMessage({
            receipt: result,
            customer: form,
            items,
            paymentMethod,
          })
        ),
        '_blank',
        'noopener,noreferrer'
      );
      if (popup) popup.opener = null;
    } catch (error) {
      setTurnstileToken('');
      setTurnstileResetSignal((current) => current + 1);
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'تعذر إرسال الطلب. حاول مرة أخرى.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
    setIsReviewing(false);
    setTurnstileToken('');
    setTurnstileResetSignal((current) => current + 1);
    if (receipt) {
      setReceipt(null);
      setForm(EMPTY_GUEST_CHECKOUT_FORM);
      setSubmittedItems([]);
      setErrors({});
      setSubmitError('');
      setPromotionInput('');
      setPromotionQuote(null);
      setPromotionContextKey('');
      setPromotionError('');
      setLocationMessage('');
      setPaymentMethod('cash_on_delivery');
      setDeliveryZone('inside_ramtha');
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[60] transition ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <button
        type="button"
        aria-label="إغلاق إتمام الطلب"
        onClick={handleClose}
        className={`absolute inset-0 bg-slate-950/65 backdrop-blur-sm transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className={`absolute inset-x-3 top-1/2 mx-auto flex max-h-[94vh] max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl transition duration-300 sm:inset-x-6 ${
          isOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-700">
              {receipt ? (
                <ReceiptText className="h-5 w-5" />
              ) : isReviewing ? (
                <ClipboardCheck className="h-5 w-5" />
              ) : (
                <UserRoundCheck className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="checkout-title"
                  className="font-black text-slate-950"
                >
                  {receipt
                    ? 'تم تسجيل طلبك'
                    : isReviewing
                      ? 'راجع طلبك قبل الإرسال'
                      : 'إتمام طلب الجملة'}
                </h2>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700">
                  بدون تسجيل دخول
                </span>
              </div>
              <p className="mt-1 text-[10px] font-bold text-slate-500">
                {settingsUnavailable && !receipt
                  ? 'إعدادات الطلب غير متاحة مؤقتًا'
                  : `${packagesCount.toLocaleString('ar-JO')} طرد • ${formatJod(receipt?.totalInMinorUnits ?? checkoutTotal)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="إغلاق"
            className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-500 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-slate-100 bg-gradient-to-b from-white to-slate-50">
          <CheckoutProgress currentStep={receipt ? 4 : isReviewing ? 3 : 2} />
        </div>

        {receipt ? (
          <div className="overflow-y-auto p-6 text-center sm:p-10">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-[2rem] bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h3 className="mt-5 text-xl font-black text-slate-950">
              وصل طلبك إلى تطبيق الإدارة
            </h3>
            <p className="mt-2 text-xs leading-6 text-slate-500">
              تم ربطه بملف العميل وحجز الكمية المطلوبة دون خصمها كمبيع
              نهائي حتى تؤكد الإدارة التسليم.
            </p>

            <div className="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-[10px] font-bold text-blue-500">
                  رقم الطلب
                </p>
                <p className="mt-1 font-mono text-lg font-black text-blue-800">
                  {receipt.orderNumber}
                </p>
              </div>
              <div className="rounded-3xl border border-orange-100 bg-orange-50 p-4">
                <p className="text-[10px] font-bold text-orange-500">
                  إجمالي المنتجات
                </p>
                <p className="mt-1 text-lg font-black text-orange-700">
                  {formatJod(receipt.totalInMinorUnits)}
                </p>
              </div>
            </div>

            {receipt.discountInMinorUnits > 0 && (
              <div className="mx-auto mt-3 max-w-lg rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs font-black text-violet-800">
                تم تطبيق خصم
                {receipt.promotionCode
                  ? ` بالرمز ${receipt.promotionCode}`
                  : ''}{' '}
                بقيمة {formatJod(receipt.discountInMinorUnits)}
              </div>
            )}

            <div className="mx-auto mt-4 flex max-w-lg items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-right text-[10px] font-bold leading-5 text-emerald-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {receipt.idempotentReplay
                ? 'كان الطلب محفوظًا مسبقًا؛ أعاد النظام نفس الطلب ولم يكرر الحجز.'
                : receipt.customerReused
                ? 'تم ربط الطلب بملف العميل الموجود حسب رقم الهاتف.'
                : 'تم إنشاء ملف عميل جديد وربطه بهذا الطلب تلقائيًا.'}
            </div>

            <div className="mx-auto mt-6 flex max-w-lg flex-col gap-3 sm:flex-row">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-xs font-black text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-700"
              >
                <MessageCircle className="h-4 w-4" />
                {storeWhatsAppNumber
                  ? 'إرسال الملخص لمتجرنا'
                  : 'مشاركة الملخص عبر واتساب'}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-black text-slate-700"
              >
                العودة للمتجر
              </button>
              {receipt.trackingToken && (
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    onTrackOrder(receipt);
                  }}
                  className="flex-1 rounded-2xl bg-blue-700 px-5 py-3.5 text-xs font-black text-white shadow-lg shadow-blue-900/15 transition hover:bg-blue-800"
                >
                  متابعة الطلب
                </button>
              )}
            </div>
          </div>
        ) : settingsUnavailable ? (
          <div className="p-6 text-center sm:p-10">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[1.5rem] bg-amber-100 text-amber-700">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h3 className="mt-5 text-lg font-black text-slate-950">تعذر التحقق من إعدادات الطلب</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-slate-500">لن نعرض رسوم توصيل أو حدًا أدنى غير موثوقين. أعد المحاولة ثم أكمل طلبك.</p>
            <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3 sm:flex-row">
              <button type="button" onClick={onRetryStorefrontSettings} className="flex-1 rounded-2xl bg-blue-700 px-5 py-3.5 text-xs font-black text-white">إعادة المحاولة</button>
              <button type="button" onClick={handleClose} className="flex-1 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-xs font-black text-slate-700">العودة إلى السلة</button>
            </div>
          </div>
        ) : isReviewing ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
              <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
                <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400">المرحلة 3 من 4</p>
                      <h3 className="mt-1 text-base font-black text-slate-950">مراجعة الأصناف والمبلغ</h3>
                    </div>
                    <span className="rounded-2xl bg-blue-100 px-3 py-2 text-[10px] font-black text-blue-800">
                      {packagesCount.toLocaleString('ar-JO')} طرد
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <div key={item.productId} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-slate-900">{item.nameAr}</p>
                          <p className="mt-1 text-[10px] font-bold text-slate-500">
                            {item.quantity.toLocaleString('ar-JO')} {item.saleUnitNameAr} × {formatJod(item.unitPriceInMinorUnits)}
                          </p>
                        </div>
                        <strong className="shrink-0 text-xs font-black text-orange-700">
                          {formatJod(item.quantity * item.unitPriceInMinorUnits)}
                        </strong>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-600">
                    <div className="flex justify-between"><span>المجموع الفرعي</span><strong>{formatJod(subtotal)}</strong></div>
                    {activePromotionQuote && (
                      <div className="flex justify-between text-emerald-700"><span>خصم {activePromotionQuote.code}</span><strong>- {formatJod(activePromotionQuote.discountInMinorUnits)}</strong></div>
                    )}
                    <div className="flex justify-between"><span>التوصيل ({deliveryZone === 'inside_ramtha' ? 'داخل الرمثا' : 'خارج الرمثا'})</span><strong>{formatJod(selectedDeliveryFee)}</strong></div>
                    <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-black text-blue-900"><span>الإجمالي النهائي</span><strong>{formatJod(checkoutTotal)}</strong></div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
                    <p className="text-[10px] font-bold text-blue-500">العميل المستلم</p>
                    <p className="mt-1 text-sm font-black text-blue-950">{form.fullName}</p>
                    <p className="mt-2 text-xs font-bold text-blue-800" dir="ltr">{form.phone}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white p-5">
                    <p className="text-[10px] font-bold text-slate-400">عنوان التوصيل</p>
                    <p className="mt-1 text-xs font-black text-blue-700">{deliveryZone === 'inside_ramtha' ? 'داخل الرمثا' : 'خارج الرمثا'} • {formatJod(selectedDeliveryFee)}</p>
                    <p className="mt-2 text-xs font-black leading-6 text-slate-800">
                      {[form.governorate, form.city, form.area, form.street, form.building].filter(Boolean).join(' - ')}
                    </p>
                    {form.googleMapsUrl && (
                      <a href={form.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-emerald-700">
                        <MapPin className="h-3.5 w-3.5" /> فتح الموقع المرفق
                      </a>
                    )}
                  </div>
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                    <p className="text-[10px] font-bold text-amber-700">طريقة الدفع المختارة</p>
                    <p className="mt-1 text-sm font-black text-amber-950">
                      {paymentMethod === 'cliq' ? 'الدفع عبر CliQ' : 'كاش عند الاستلام'}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold leading-5 text-emerald-800">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    عند التأكيد سيُحفظ الطلب في نظام الإدارة أولًا، وبعد نجاح الحفظ فقط سيفتح ملخص واتساب.
                  </div>
                  <TurnstileWidget
                    resetSignal={turnstileResetSignal}
                    onTokenChange={(token) => {
                      setTurnstileToken(token);
                      if (token) setSubmitError('');
                    }}
                    onStatusChange={setTurnstileStatus}
                  />
                </section>
              </div>

              {submitError && (
                <div role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold leading-5 text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {submitError}
                </div>
              )}
            </div>

            <footer className="grid gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:grid-cols-[0.6fr_1.4fr] sm:px-7">
              <button type="button" onClick={() => setIsReviewing(false)} disabled={isSubmitting} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs font-black text-slate-700 disabled:opacity-50">
                تعديل البيانات
              </button>
              <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || !turnstileToken || turnstileStatus !== 'verified'} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-700 disabled:bg-slate-300">
                {isSubmitting ? <><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ حفظ الطلب...</> : turnstileStatus === 'loading' || turnstileStatus === 'waiting' ? <><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ تجهيز التحقق الأمني...</> : <><CheckCircle2 className="h-5 w-5" /> تأكيد وحفظ الطلب في الإدارة</>}
              </button>
            </footer>
          </div>
        ) : (
          <form
            onSubmit={handleReview}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
              <div className="mb-5 flex items-start gap-3 rounded-3xl border border-blue-100 bg-blue-50 p-4">
                <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                <div>
                  <p className="text-xs font-black text-blue-900">
                    لا تحتاج حسابًا أو كلمة مرور
                  </p>
                  <p className="mt-1 text-[10px] font-bold leading-5 text-blue-800">
                    نستخدم رقم هاتفك فقط لربط طلباتك بملف عميل واحد والتواصل
                    معك بخصوص التوصيل.
                  </p>
                </div>
              </div>

              <details
                open
                className="mb-5 overflow-hidden rounded-3xl border border-slate-200 bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                  <span className="flex items-center gap-2 text-xs font-black text-slate-900">
                    <ShoppingBag className="h-4 w-4 text-blue-700" />
                    مراجعة الطلب
                  </span>
                  <span className="text-[10px] font-black text-blue-700">
                    {packagesCount.toLocaleString('ar-JO')} طرد •{' '}
                    {formatJod(checkoutTotal)}
                  </span>
                </summary>
                <div className="divide-y divide-slate-100 px-4">
                  {items.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-black text-slate-900">
                          {item.nameAr}
                        </p>
                        <p className="mt-1 text-[9px] font-bold text-slate-500">
                          {item.quantity.toLocaleString('ar-JO')}{' '}
                          {item.saleUnitNameAr} ×{' '}
                          {formatJod(item.unitPriceInMinorUnits)}
                        </p>
                      </div>
                      <strong className="shrink-0 text-[11px] font-black text-orange-700">
                        {formatJod(
                          item.quantity * item.unitPriceInMinorUnits
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              </details>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="الاسم الكامل"
                  required
                  error={errors.fullName}
                >
                  <input
                    autoComplete="name"
                    value={form.fullName}
                    onChange={(event) =>
                      setField('fullName', event.target.value)
                    }
                    placeholder="مثال: محمد أحمد"
                    className={inputClassName}
                  />
                </Field>

                <Field
                  label="رقم الهاتف"
                  required
                  error={errors.phone}
                >
                  <input
                    type="tel"
                    dir="ltr"
                    inputMode="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(event) =>
                      setField('phone', event.target.value)
                    }
                    placeholder="0791234567"
                    className={`${inputClassName} text-right`}
                  />
                </Field>

                <Field
                  label="المحافظة"
                  required
                  error={errors.governorate}
                >
                  <select
                    value={form.governorate}
                    onChange={(event) =>
                      setField('governorate', event.target.value)
                    }
                    className={inputClassName}
                  >
                    {GOVERNORATES.map((governorate) => (
                      <option key={governorate} value={governorate}>
                        {governorate}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="المدينة" required error={errors.city}>
                  <input
                    autoComplete="address-level2"
                    value={form.city}
                    onChange={(event) =>
                      setField('city', event.target.value)
                    }
                    placeholder="الرمثا"
                    className={inputClassName}
                  />
                </Field>

                <Field
                  label="المنطقة أو الحي"
                  required
                  error={errors.area}
                >
                  <input
                    autoComplete="address-level3"
                    value={form.area}
                    onChange={(event) =>
                      setField('area', event.target.value)
                    }
                    placeholder="اسم الحي أو المنطقة"
                    className={inputClassName}
                  />
                </Field>

                <div className="sm:col-span-2">
                  <Field
                    label="تفاصيل العنوان والتوصيل (اختياري)"
                    error={errors.street}
                  >
                    <textarea
                      autoComplete="street-address"
                      value={form.street}
                      onChange={(event) =>
                        setField('street', event.target.value)
                      }
                      maxLength={MAX_GUEST_DELIVERY_DETAILS_LENGTH}
                      placeholder="رقم المحل أو المبنى، الشارع، أقرب معلم، وقت التوصيل أو أي ملاحظة مهمة..."
                      rows={3}
                      className={`${inputClassName} resize-none`}
                    />
                    <p className="mt-1.5 text-[10px] font-bold text-slate-500">
                      أضف رقم المبنى أو أقرب معلم أو وقت التوصيل عند الحاجة. {form.street.length}/{MAX_GUEST_DELIVERY_DETAILS_LENGTH}
                    </p>
                  </Field>
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label="موقع التوصيل على الخريطة (اختياري)"
                    error={errors.googleMapsUrl}
                  >
                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-3 sm:p-4">
                      <p className="mb-3 text-[10px] font-bold leading-5 text-emerald-900">
                        اختر أين تريد استلام الطلب؛ ليس شرطًا أن يكون موقعك الحالي.
                      </p>

                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 shadow-sm">
                        <button
                          type="button"
                          onClick={() => handleLocationModeChange('current')}
                          aria-pressed={locationMode === 'current'}
                          className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-[10px] font-black transition ${
                            locationMode === 'current'
                              ? 'bg-emerald-600 text-white shadow'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <LocateFixed className="h-4 w-4" />
                          أنا في موقع التوصيل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLocationModeChange('different')}
                          aria-pressed={locationMode === 'different'}
                          className={`flex items-center justify-center gap-2 rounded-xl px-2 py-2.5 text-[10px] font-black transition ${
                            locationMode === 'different'
                              ? 'bg-blue-600 text-white shadow'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <MapPinned className="h-4 w-4" />
                          موقع التوصيل مختلف
                        </button>
                      </div>

                      {locationMode === 'current' ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={handleUseCurrentLocation}
                            disabled={isLocating}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:bg-emerald-300"
                          >
                            {isLocating ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <LocateFixed className="h-4 w-4" />
                            )}
                            {isLocating
                              ? 'جارٍ تحديد الموقع...'
                              : 'استخدام موقعي الحالي للتوصيل'}
                          </button>
                          {showLocationFallback && (
                            <button
                              type="button"
                              onClick={() =>
                                handleLocationModeChange('different')
                              }
                              className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-[10px] font-black text-amber-900"
                            >
                              الموقع مختلف أو تعذر تحديده؟ اختره من الخرائط
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-[10px] font-bold leading-5 text-blue-950">
                            <strong className="block text-xs">
                              كيف تحدد محلًا أو منزلًا آخر؟
                            </strong>
                            <span className="mt-1 block">
                              ١. افتح خرائط Google وحدد المكان المطلوب.
                              <br />
                              ٢. اضغط «مشاركة» ثم «نسخ الرابط».
                              <br />
                              ٣. ارجع للموقع واضغط «لصق رابط الموقع».
                            </span>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <a
                              href="https://maps.google.com/"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-3 py-3 text-[10px] font-black text-white transition hover:bg-blue-700"
                            >
                              <ExternalLink className="h-4 w-4" />
                              فتح خرائط Google واختيار المكان
                            </a>
                            <button
                              type="button"
                              onClick={() => void handlePasteMapUrl()}
                              disabled={isPastingLocation}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-300 bg-white px-3 py-3 text-[10px] font-black text-blue-800 transition hover:bg-blue-50 disabled:opacity-50"
                            >
                              {isPastingLocation ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <ClipboardPaste className="h-4 w-4" />
                              )}
                              لصق رابط الموقع
                            </button>
                          </div>

                          <div className="relative">
                            <MapPin className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-600" />
                            <input
                              dir="ltr"
                              type="url"
                              value={form.googleMapsUrl}
                              onChange={(event) =>
                                handleMapUrlChange(event.target.value)
                              }
                              placeholder="ألصق رابط المشاركة من خرائط Google"
                              className={`${inputClassName} pr-11 text-left`}
                            />
                          </div>
                        </div>
                      )}

                      {locationMessage && (
                        <span className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {locationMessage}
                        </span>
                      )}
                      {form.googleMapsUrl &&
                        isSupportedGoogleMapsUrl(form.googleMapsUrl) && (
                          <a
                            href={form.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-blue-700 underline"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            مراجعة موقع التوصيل المختار
                          </a>
                        )}
                    </div>
                  </Field>
                </div>

              </div>

              <section className="mb-5 rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4">
                <div className="mb-3 flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-sky-600 text-white"><Truck className="h-5 w-5" /></span>
                  <div>
                    <p className="text-xs font-black text-sky-950">منطقة التوصيل</p>
                    <p className="mt-1 text-[10px] font-bold leading-5 text-sky-700">اختر المنطقة ليظهر المجموع النهائي شامل أجرة التوصيل.</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['inside_ramtha', 'داخل الرمثا', storefrontSettings.insideRamthaDeliveryFeeInMinorUnits],
                    ['outside_ramtha', 'خارج الرمثا', storefrontSettings.outsideRamthaDeliveryFeeInMinorUnits],
                  ] as const).map(([zone, label, fee]) => (
                    <button
                      key={zone}
                      type="button"
                      aria-pressed={deliveryZone === zone}
                      onClick={() => {
                        setDeliveryZone(zone);
                        setSubmitError('');
                        if (zone === 'inside_ramtha') {
                          setForm((current) => ({ ...current, governorate: 'إربد', city: 'الرمثا' }));
                          setErrors((current) => ({ ...current, governorate: undefined, city: undefined }));
                        }
                      }}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-right transition ${deliveryZone === zone ? 'border-sky-600 bg-sky-600 text-white shadow-lg shadow-sky-900/15' : 'border-slate-200 bg-white text-slate-800 hover:border-sky-300'}`}
                    >
                      <span><strong className="block text-xs font-black">{label}</strong><span className={`mt-1 block text-[9px] font-bold ${deliveryZone === zone ? 'text-sky-100' : 'text-slate-400'}`}>أجرة التوصيل</span></span>
                      <strong className="text-sm font-black">{formatJod(fee)}</strong>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-3 text-white">
                  <span className="text-[10px] font-bold text-slate-300">الإجمالي شامل التوصيل</span>
                  <strong className="text-base font-black text-emerald-300">{formatJod(checkoutTotal)}</strong>
                </div>
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 rounded-3xl border border-violet-200 bg-violet-50 p-4">
                  <div className="mb-3 flex items-start gap-2">
                    <BadgePercent className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" />
                    <div>
                      <p className="text-xs font-black text-violet-950">
                        معك رمز خصم؟
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-violet-700/80">
                        الخصم يُحسب ويُثبت من نظام الإدارة، وليس من المتصفح.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      dir="ltr"
                      value={promotionInput}
                      onChange={(event) =>
                        handlePromotionChange(event.target.value)
                      }
                      maxLength={32}
                      placeholder="مثال: WELCOME10"
                      className={`${inputClassName} min-w-0 flex-1 text-left uppercase`}
                    />
                    {activePromotionQuote ? (
                      <button
                        type="button"
                        onClick={handleRemovePromotion}
                        className="shrink-0 rounded-2xl border border-violet-300 bg-white px-4 text-xs font-black text-violet-700"
                      >
                        إزالة
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleApplyPromotion()}
                        disabled={isApplyingPromotion}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-violet-700 px-4 text-xs font-black text-white disabled:bg-violet-300"
                      >
                        {isApplyingPromotion && (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        )}
                        تطبيق
                      </button>
                    )}
                  </div>
                  {promotionError && (
                    <p className="mt-2 text-[10px] font-bold text-rose-600">
                      {promotionError}
                    </p>
                  )}
                  {activePromotionQuote && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold text-emerald-800">
                      <span>
                        تم تطبيق {activePromotionQuote.code}
                        {activePromotionQuote.description
                          ? ` — ${activePromotionQuote.description}`
                          : ''}
                      </span>
                      <strong>
                        وفّرت{' '}
                        {formatJod(
                          activePromotionQuote.discountInMinorUnits
                        )}
                      </strong>
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2 rounded-3xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-black text-blue-950">طريقة الدفع</p>
                  <p className="mt-1 text-[10px] font-bold text-blue-700/80">اختر الطريقة التي تريد تثبيتها مع الطلب.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {([
                      { value: 'cash_on_delivery', label: 'كاش عند الاستلام', icon: Banknote },
                      { value: 'cliq', label: 'CliQ', icon: Smartphone },
                    ] as const).map((option) => {
                      const Icon = option.icon;
                      return <button type="button" key={option.value} onClick={() => setPaymentMethod(option.value)} aria-pressed={paymentMethod === option.value} className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-black transition ${paymentMethod === option.value ? 'border-blue-700 bg-blue-700 text-white' : 'border-blue-200 bg-white text-blue-800'}`}><Icon className="h-4 w-4" />{option.label}</button>;
                    })}
                  </div>
                  {paymentMethod === 'cliq' && <p className="mt-3 rounded-2xl bg-white p-3 text-[10px] font-bold leading-5 text-slate-600">{storefrontSettings.cliqAlias ? <>حوّل عبر CliQ إلى <strong dir="ltr" className="text-blue-800">{storefrontSettings.cliqAlias}</strong>، وسيؤكد الفريق استلام التحويل قبل التجهيز.</> : 'سيؤكد فريق المتجر بيانات تحويل CliQ واستلامه قبل تجهيز الطلب.'}</p>}
                </div>

                <div className="sm:col-span-2 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                  <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={saveCustomerDetails} onChange={(event) => { const enabled = event.target.checked; setSaveCustomerDetails(enabled); if (!enabled) clearSavedGuestCustomer(window.localStorage); }} className="mt-1 h-4 w-4 accent-emerald-600" /><span><span className="flex items-center gap-1.5 text-xs font-black text-emerald-950"><Save className="h-4 w-4" />حفظ بياناتي على هذا الجهاز</span><span className="mt-1 block text-[10px] font-bold leading-5 text-emerald-800/80">اختياري لتعبئة الاسم والهاتف والعنوان تلقائيًا في الطلب القادم.</span><span className="mt-1 block text-[10px] font-bold leading-5 text-emerald-800/80">لا تستخدم هذا الخيار على جهاز مشترك.</span></span></label>
                  {readSavedGuestCustomer(window.localStorage) && <button type="button" onClick={() => { clearSavedGuestCustomer(window.localStorage); setSaveCustomerDetails(false); setForm(EMPTY_GUEST_CHECKOUT_FORM); }} className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-black text-rose-600"><Trash2 className="h-3.5 w-3.5" />مسح البيانات المحفوظة</button>}
                </div>

              </div>

              {submitError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold leading-5 text-rose-700"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {submitError}
                </div>
              )}
            </div>

            <footer className="border-t border-slate-100 bg-slate-50 p-5 sm:px-7">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                  <PackageCheck className="h-4 w-4 text-emerald-600" />
                  {paymentMethod === 'cliq' ? 'الدفع عبر CliQ ويُراجع مع الإدارة' : 'الدفع كاش عند الاستلام'}
                </div>
                <div className="text-left">
                  {activePromotionQuote && (
                    <p className="text-[10px] font-bold text-slate-400 line-through">
                      {formatJod(subtotal)}
                    </p>
                  )}
                  {activePromotionQuote && (
                    <p className="text-[10px] font-black text-emerald-600">
                      خصم -
                      {formatJod(
                        activePromotionQuote.discountInMinorUnits
                      )}
                    </p>
                  )}
                  <strong className="text-lg font-black text-slate-950">
                    {formatJod(checkoutTotal)}
                  </strong>
                </div>
              </div>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  isApplyingPromotion ||
                  items.length === 0
                  || !storefrontSettings.ordersEnabled
                  || subtotal < storefrontSettings.minimumOrderInMinorUnits
                }
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-4 text-sm font-black text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    جارٍ تسجيل الطلب مرة واحدة...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5" />
                    مراجعة الطلب قبل الإرسال
                  </>
                )}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
