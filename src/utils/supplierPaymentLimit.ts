export function supplierPaymentLimit(details: string | null | undefined): {error: string; maxAllowedInMinorUnits: number} | null {
  try {
    const limits = JSON.parse(details || '') as {payable: number; paid: number; maxAllowed: number};
    if (!limits || ![limits.payable, limits.paid, limits.maxAllowed].every(value => Number.isSafeInteger(value) && value >= 0)
      || limits.maxAllowed !== Math.max(0, limits.payable - limits.paid)) return null;
    return {error: `المستحق الفعلي ${(limits.payable / 1000).toFixed(3)}، المدفوع ${(limits.paid / 1000).toFixed(3)}، الحد الأقصى المسموح الآن ${(limits.maxAllowed / 1000).toFixed(3)} دينار.`,
      maxAllowedInMinorUnits: limits.maxAllowed};
  } catch { return null; }
}
