/** Display-only mirror of the existing POS translation dictionary.
 * The drift test requires exact identity/text equality with posV2.service.
 * No server message or financial decision is trusted here. */
export const posKnownRejectionCopy: Readonly<Record<string, string>> = {
  POS216_INITIAL_PAYMENT_INVALID: 'راجع المدفوع الآن؛ يجب أن يكون أقل من صافي الفاتورة للدفع الجزئي.',
  POS216_SALE_CONTRACT_CHANGED: 'تغيّرت بيانات البيع؛ لم تُحفظ العملية. راجع السلة قبل المحاولة مجدداً.',
  PARCEL209_UNIT_SALE_FORBIDDEN:
    'هذا الصنف بيتباع بالطرد بس. احذف سطر المفرد وأضفه كطرد؛ لا تتغيّر السلة تلقائياً.',
  PARCEL209_FAMILY_CHANGED_RETRY:
    'تغيّرت نكهات المنتج. حدّث البيانات وراجع السلة قبل بدء محاولة جديدة.',
  PHASE3_IDEMPOTENCY_CONFLICT:
    'مفتاح إعادة المحاولة مرتبط بطلب مختلف. راجع البيع الموجود قبل أي محاولة جديدة.',
  CONFIGURABLE_PARCEL_DISABLED:
    'ميزة الطرود المخصصة غير مفعلة لهذا الحساب حاليًا.',
  PARCEL_CONFIGURATION_STALE:
    'تغير إعداد الطرد. أعد فتح المُنشئ وراجع التكوين الحالي.',
  PARCEL_CAPACITY_MISMATCH:
    'مجموع مكونات الطرد لا يساوي سعته المحددة.',
  PARCEL_COMPONENT_FAMILY_MISMATCH:
    'أحد مكونات الطرد لا ينتمي إلى العائلة التجارية المحددة.',
  PARCEL_COMPONENT_NOT_STOCKED:
    'أحد مكونات البيع لا يملك رصيدًا في المستودع.',
  PARCEL_COMPONENT_NOT_ALLOWED:
    'إحدى النكهات غير مسموحة في إعداد الطرد الحالي. أعد تركيب الطرد.',
  PHASE3_POS_INSUFFICIENT_INVENTORY:
    'المخزون المتاح لأحد مكونات البيع غير كافٍ.',
  PHASE3_POS_OPEN_SHIFT_REQUIRED:
    'افتح وردية الصندوق قبل إتمام البيع.',
};
