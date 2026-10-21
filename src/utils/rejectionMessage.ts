/** Presentation dictionary only. Eligibility, request identity and recovery stay authoritative. */
export const rejectionMessages:Readonly<Record<string,string>>={
  CORRECTION_ACTION_INVALID:'إجراء التصحيح غير معتمد.',CORRECTION_AUTH_REQUIRED:'أكد دخولك ثم أعد فتح المستند.',
  CORRECTION_BLOCKED:'لا يمكن تصحيح هذا المستند بحالته الحالية. راجع تفاصيله.',
  CORRECTION_IDEMPOTENCY_CONFLICT:'هذه المحاولة تخص طلباً مختلفاً. استعد المحاولة المحفوظة وراجعها.',
  CORRECTION_KEY_INVALID:'تعذر التحقق من رقم المحاولة. أعد فتح المستند.',
  CORRECTION_PREVIEW_REQUIRED:'افتح معاينة التصحيح قبل التأكيد.',CORRECTION_PREVIEW_STALE:'تغيّر المستند بعد المعاينة. حدّث المعاينة وراجعها.',
  CORRECTION_REASON_INVALID:'اكتب سبب التصحيح من 3 إلى 500 حرف.',CORRECTION_RECORD_NOT_FOUND:'المستند غير موجود أو لم يعد متاحاً.',
  CORRECTION_RECORD_REQUIRED:'اختر المستند الذي تريد تصحيحه.',
  SUPPLIER_REPLACEMENT_ACTION_INVALID:'اختر عملية استبدال معتمدة.',SUPPLIER_REPLACEMENT_ALREADY_REVERSED:'عُكست هذه العملية من قبل.',
  SUPPLIER_REPLACEMENT_CASE_INVALID:'سجل الاستبدال غير متاح. حدّث السجل.',SUPPLIER_REPLACEMENT_DAMAGE_REASON_INVALID:'اختر سبب التلف؛ واكتب ملاحظة عند اختيار «أخرى».',
  SUPPLIER_REPLACEMENT_DEPENDENCY:'توجد عمليات لاحقة مرتبطة بها. راجع السجل من الأحدث.',
  SUPPLIER_REPLACEMENT_EVENT_INVALID:'العملية المطلوبة غير موجودة في السجل.',
  SUPPLIER_REPLACEMENT_EVIDENCE_INVALID:'تعذر التحقق من سجل العملية. راجعه مع المالك قبل المتابعة.',
  SUPPLIER_REPLACEMENT_EXCEEDS_PENDING:'العدد أكبر من البضاعة المتبقية لدى المورد.',
  SUPPLIER_REPLACEMENT_FIELD_INVALID:'بيانات العملية غير متطابقة. أعد فتحها وراجعها.',
  SUPPLIER_REPLACEMENT_IDEMPOTENCY_CONFLICT:'هذه المحاولة تخص طلباً مختلفاً. استعد المحاولة المحفوظة وراجعها.',
  SUPPLIER_REPLACEMENT_INVENTORY_CHANGED:'تغيّر المخزون أو تكلفته بعد العملية؛ لا يمكن عكسها الآن.',
  SUPPLIER_REPLACEMENT_KEY_INVALID:'تعذر التحقق من رقم المحاولة. أعد فتح الشاشة.',
  SUPPLIER_REPLACEMENT_LATER_MOVEMENT:'توجد حركة أو حجز أو تكلفة لاحقة؛ لا يمكن عكس العملية الآن.',
  SUPPLIER_REPLACEMENT_OPTIONS_INVALID:'تعذر التحقق من خيارات الاستبدال. حدّث القراءة.',
  SUPPLIER_REPLACEMENT_OWNER_ONLY:'هذه العملية متاحة للمالك فقط.',SUPPLIER_REPLACEMENT_PAGE_INVALID:'صفحة السجل غير صالحة. أعد فتح السجل.',
  SUPPLIER_REPLACEMENT_PARENT_BUSY_RETRY:'المورد مشغول بعملية أخرى. انتظر انتهائها ثم أعد المحاولة.',
  SUPPLIER_REPLACEMENT_PRODUCT_INVALID:'الصنف غير متاح لهذه العملية.',SUPPLIER_REPLACEMENT_QUANTITY_INVALID:'أدخل عدداً صحيحاً أكبر من صفر.',
  SUPPLIER_REPLACEMENT_REASON_INVALID:'اكتب سبباً من 3 إلى 500 حرف.',SUPPLIER_REPLACEMENT_REQUEST_INVALID:'بيانات العملية غير صالحة. أعد فتحها وراجعها.',
  SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID:'راجع الكميات التالفة التي تريد إرسالها للمورد.',
  SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_MISMATCH:'الكميات المرسلة للمورد لا تطابق المرتجع. أعد مراجعتها.',
  SUPPLIER_REPLACEMENT_RETURN_EVIDENCE_INVALID:'تعذر التحقق من سجل المرتجع. راجعه مع المالك.',
  SUPPLIER_REPLACEMENT_RETURN_IDENTITY_CONFLICT:'تمت تسوية المرتجع بمسار آخر؛ لا يمكن إرساله للمورد بهذه المحاولة.',
  SUPPLIER_REPLACEMENT_ROLE_DENIED:'لا تملك صلاحية استبدال المورد.',SUPPLIER_REPLACEMENT_STOCK_RESERVED:'العدد أكبر من البضاعة المتاحة غير المحجوزة.',
  SUPPLIER_REPLACEMENT_SUPPLIER_INVALID:'اختر مورداً نشطاً ثم أعد المعاينة.',SUPPLIER_REPLACEMENT_WAREHOUSE_INVALID:'المستودع غير متاح. أعد اختياره.',
};
export function describeRejection(reason:unknown):{message:string;code?:string} {
  const text=typeof reason==='string'?reason.trim():'';
  const code=text.match(/^([A-Z][A-Z0-9_]{2,95})(?::|$)/u)?.[1];
  if(code)return {message:rejectionMessages[code]??'تعذر إتمام العملية. راجع المستند أو تواصل مع المالك مستخدماً مرجع الرفض.',code};
  return {message:/\p{Script=Arabic}/u.test(text)?text:'تعذر إتمام العملية. أعد قراءة المستند وراجع بياناته قبل المتابعة.'};
}
