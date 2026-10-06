/** Presentation only: recovery classification stays in CheckoutRecoveryCoordinator. */
export function checkoutErrorMessage(message: string): string {
  if (/IDEMPOTENCY.*(CONFLICT|MISMATCH)|REVIEW_REQUIRED/u.test(message)) {
    return 'تفاصيل المحاولة المحفوظة تحتاج مراجعة. لا تبدأ طلبًا جديدًا قبل التحقق من المحاولة السابقة.';
  }
  if (/OUTCOME_UNKNOWN|timeout|network|failed to fetch/iu.test(message)) {
    return 'لم نتأكد من نتيجة الطلب بسبب الاتصال. استعد نفس المحاولة للتحقق؛ لا تنشئ طلبًا جديدًا.';
  }
  if (/STOCK.*(INSUFFICIENT|UNAVAILABLE)|INSUFFICIENT.*STOCK/u.test(message)) {
    return 'الكمية المطلوبة لم تعد متاحة. حدّث السلة وراجع الكميات بعد التحقق من المحاولة السابقة.';
  }
  if (message && (!/[\u0600-\u06ff]/u.test(message) || /[A-Z][A-Z0-9]+_[A-Z0-9_]+/u.test(message))) {
    return 'تعذر إتمام الطلب. راجع البيانات ونتيجة المحاولة المحفوظة قبل إعادة الإرسال.';
  }
  return message;
}
