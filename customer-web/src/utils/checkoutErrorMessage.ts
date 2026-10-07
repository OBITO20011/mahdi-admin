/** Presentation only: recovery classification stays in CheckoutRecoveryCoordinator. */
export function checkoutErrorMessage(message: string, hasAttempt = false): string {
  if (/PARCEL_COMPONENT_NOT_ALLOWED/u.test(message)) {
    return 'إحدى النكهات لم تعد مسموحة لهذا الطرد. حدّث الصفحة وأعد اختيار النكهات.';
  }
  if (/IDEMPOTENCY.*(CONFLICT|MISMATCH)|REVIEW_REQUIRED/u.test(message)) {
    return hasAttempt ? 'تفاصيل المحاولة المحفوظة تحتاج مراجعة. لا تبدأ طلبًا جديدًا قبل التحقق من المحاولة السابقة.'
      : 'تعذر إتمام الطلب. راجع البيانات وحاول مجددًا.';
  }
  if (/OUTCOME_UNKNOWN|timeout|network|failed to fetch/iu.test(message)) {
    return hasAttempt ? 'لم نتأكد من نتيجة الطلب بسبب الاتصال. استعد نفس المحاولة للتحقق؛ لا تنشئ طلبًا جديدًا.'
      : 'تعذر الاتصال قبل إنشاء محاولة طلب. تحقق من الاتصال ثم حاول مجددًا.';
  }
  if (/STOCK.*(INSUFFICIENT|UNAVAILABLE)|INSUFFICIENT.*STOCK/u.test(message)) {
    return hasAttempt ? 'الكمية المطلوبة لم تعد متاحة. حدّث السلة وراجع الكميات بعد التحقق من المحاولة السابقة.'
      : 'الكمية المطلوبة لم تعد متاحة. حدّث السلة وراجع الكميات.';
  }
  if (message && (!/[\u0600-\u06ff]/u.test(message) || /[A-Z][A-Z0-9]+_[A-Z0-9_]+/u.test(message))) {
    const code = message.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/u)?.[0] || 'UNKNOWN';
    return `${hasAttempt ? 'تعذر إتمام الطلب. راجع البيانات ونتيجة المحاولة المحفوظة قبل إعادة الإرسال.' : 'تعذر إتمام الطلب. راجع البيانات وحاول مجددًا.'}\nرمز: ${code}`;
  }
  return message;
}
