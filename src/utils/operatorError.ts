/** Presentation only: references identify a screen/action, never a business outcome.
 * Untrusted exception messages, identifiers and values never enter the output. */
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

export function operatorErrorMessage(area: OperatorErrorArea): string {
  const [reference, message] = messages[area];
  return `${message} مرجع: ${reference}`;
}
