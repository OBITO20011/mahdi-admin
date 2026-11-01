import {knownBusinessErrorMessage} from './businessError';
import {posKnownRejectionCopy} from './posKnownRejectionCopy';
/** Presentation only: references identify a screen/action, never a business outcome.
 * Only checked-in translations/exact local validation messages can be displayed. */
const messages = {
  products: ['POS-01', 'تعذر تحميل الأصناف. تحقق من الاتصال ثم أعد تحميل القائمة.'],
  partial: ['POS-02', 'راجع المدفوع الآن: اختر زبوناً مسجلاً، وأدخل مبلغاً من صفر إلى صافي الفاتورة وبثلاث خانات عشرية كحد أقصى.'],
  saleUnknown: ['POS-03', 'لم نتأكد هل البيع انحفظ. استخدم استرجاع المحاولة؛ لا تنشئ بيعاً جديداً.'],
  saleRejected: ['POS-04', 'لم يُقبل البيع. راجع السلة والمخزون والوردية والزبون، وتحقق من حالة المحاولة قبل المحاولة مجدداً.'],
  inspect: ['POS-05', 'تعذر التحقق من حالة البيع. المحاولة محفوظة؛ تحقق من الاتصال ثم استخدم استرجاع المحاولة. لا تنشئ بيعاً جديداً.'],
  cancel: ['POS-06', 'لم نتأكد من إلغاء المحاولة. أبقِها محفوظة واستخدم التحقق من حالتها أو استرجاعها؛ لا تنشئ بيعاً جديداً.'],
  receipt: ['POS-07', 'تعذر تجهيز رابط الوصل أو نسخه. تحقق من الاتصال وأعد فتح الوصل من سجل المبيعات؛ لا تُعد تسجيل البيع.'],
  aftercare: ['RET-01', 'تعذر إتمام المرتجع أو الاستبدال. حدّث الفاتورة وراجع الكميات؛ إن كانت هناك محاولة معلقة فاستعدها قبل أي عملية جديدة.'],
  aftercareRead: ['RET-02', 'تعذر قراءة بيانات المرتجع والاستبدال. تحقق من الاتصال وأعد تحميل الفاتورة؛ لا تبدأ عملية جديدة قبل معرفة نتيجة المحاولة السابقة.'],
  parcelEvidence: ['RET-03', 'بيانات الطرد في الفاتورة غير متطابقة. أوقف المرتجع أو الاستبدال وتواصل مع المطوّر لمراجعة الفاتورة.'],
} as const;

export type OperatorErrorArea = keyof typeof messages;

const partialValidationCopy = new Set([
  'اكتب المدفوع الآن بثلاث خانات عشرية كحد أقصى.',
  'المدفوع الآن أكبر من الحد المسموح.',
  'المدفوع الآن يجب أن يكون بين صفر وإجمالي الفاتورة.',
  'اختر زبوناً مسجلاً لحفظ الباقي على حسابه.',
  'لا يمكن تسجيل دفعة لفاتورة صافيها صفر.',
  'المدفوع الآن أكبر من صافي الفاتورة.',
]);

export function operatorErrorMessage(area: OperatorErrorArea, reason?: unknown): string {
  const [reference, message] = messages[area];
  let specific: string | null = null;
  if (area === 'partial') {
    const text = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
    if (partialValidationCopy.has(text)) specific = text;
  } else if (area === 'aftercare' || area === 'aftercareRead') {
    const text = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
    // Unknown/transport text has no known translation. Never interpolate raw text.
    specific = knownBusinessErrorMessage(text);
  }
  return `${specific ?? message} مرجع: ${reference}`;
}

/** A rejected identity selects local copy; the RPC's message is never echoed. */
export function operatorPosRejectionMessage(identity: string): string {
  const specific = Object.hasOwn(posKnownRejectionCopy, identity) ? posKnownRejectionCopy[identity] : null;
  return specific ? `${specific} مرجع: POS-04` : operatorErrorMessage('saleRejected');
}
