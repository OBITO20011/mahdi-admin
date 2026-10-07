/** Human-facing text only. Never use this to classify or change recovery state. */
export function businessErrorMessage(message: unknown): string {
  const text = message instanceof Error ? message.message : String(message ?? '');
  const known: Array<[RegExp, string]> = [
    [/PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING/u,
      'هذا البيع القديم لا يحتوي سعر القطعة التاريخي؛ لا يمكن تسوية ضرر العميل. مرتجع السليم وعيب المورد متاحان.'],
    [/PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE/u,
      'افحص ضرر العميل بمرتجع مستقل لكل كرتونة حتى يبقى الخصم ضمن استحقاقها الأصلي.'],
    [/AFTERCARE_(OUTCOME_UNKNOWN|RESPONSE_INVALID|RECOVERY_PERSIST_FAILED|RECOVERY_UNAVAILABLE)/u,
      'نتيجة المحاولة غير مؤكدة. استعد نفس المحاولة ولا تبدأ عملية جديدة حتى تتأكد من نتيجتها.'],
    [/AFTERCARE_REVIEW_REQUIRED/u, 'بيانات المحاولة غير متطابقة. أعد تحميل الطلب وراجع المحاولة المحفوظة قبل المتابعة.'],
    [/PHASE4_(LOGICAL_QUANTITY_ALREADY_CONSUMED|PARCEL_RETURN_ALREADY_CONSUMED)/u,
      'تم استخدام هذه الكمية في عملية سابقة. حدّث الطلب واختر من الكمية المتبقية.'],
    [/PHASE4_(RETURN_WINDOW_EXPIRED|REPLACEMENT_WINDOW_INVALID)/u, 'انتهت مهلة المرتجع أو الاستبدال الأصلية (48 ساعة).'],
    [/PHASE43_RETURN_ALLOCATION_(INVALID|MISSING|MISMATCH)/u, 'صنّف كامل كمية كل قطعة بين سليم، عيب، وضرر عميل قبل الاعتماد.'],
    [/IDEMPOTENCY.*(CONFLICT|MISMATCH)|PAYMENT.*CONFLICT/u, 'تفاصيل المحاولة تختلف عن المحاولة المحفوظة. راجعها ولا تعِد إرسالها بتفاصيل مختلفة.'],
    [/SHIFT.*(REQUIRED|NOT_OPEN|INVALID)|OPEN.*SHIFT/u, 'تحتاج هذه الحركة النقدية إلى وردية مفتوحة صالحة. افتح الوردية ثم تابع.'],
    [/permission denied|FORBIDDEN|UNAUTHORIZED/iu, 'ليس لديك صلاحية لهذا الإجراء. راجع مسؤول المحل.'],
    [/timeout|network|failed to fetch|fetch failed/iu, 'تعذر تأكيد النتيجة بسبب الاتصال. تحقق من المحاولة السابقة قبل إعادة الإرسال.'],
  ];
  for (const [pattern, translation] of known) if (pattern.test(text)) return translation;
  if (!/[\u0600-\u06ff]/u.test(text) || /[A-Z][A-Z0-9]+_[A-Z0-9_]+/u.test(text)) {
    const code = text.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/u)?.[0] || 'UNKNOWN';
    return `تعذر إتمام الإجراء. حدّث البيانات وراجع نتيجة المحاولة السابقة قبل تكراره.\nرمز: ${code}`;
  }
  return text || 'تعذر إتمام الإجراء. راجع البيانات وحاول مجددًا.';
}
