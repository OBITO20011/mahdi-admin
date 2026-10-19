export interface CustomerCollectionsInMinorUnits {
  cashInMinorUnits: number;
  cliqInMinorUnits: number;
  bankTransferInMinorUnits: number;
  chequeInMinorUnits: number;
  otherInMinorUnits: number;
  totalInMinorUnits: number;
}

/** Signed net receipts after collection reversals; refunds are separate. */
export function parseCustomerCollections(value: unknown): CustomerCollectionsInMinorUnits | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('بيانات المقبوض من العملاء غير مكتملة. أعد التحميل.');
  const row = value as Record<string, unknown>;
  const keys = ['cashInMinorUnits','cliqInMinorUnits','bankTransferInMinorUnits','chequeInMinorUnits','otherInMinorUnits','totalInMinorUnits'] as const;
  if (keys.some(key => typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]))) throw new Error('بيانات المقبوض من العملاء غير مكتملة. أعد التحميل.');
  const result = row as unknown as CustomerCollectionsInMinorUnits;
  const sum = result.cashInMinorUnits + result.cliqInMinorUnits + result.bankTransferInMinorUnits + result.chequeInMinorUnits + result.otherInMinorUnits;
  if (!Number.isSafeInteger(sum) || sum !== result.totalInMinorUnits) throw new Error('إجمالي المقبوض لا يطابق تفصيل طرق الدفع. أعد التحميل.');
  return result;
}

export const customerCollectionRows = (value: CustomerCollectionsInMinorUnits) => [
  {label:'كاش',amount:value.cashInMinorUnits}, {label:'CliQ',amount:value.cliqInMinorUnits},
  {label:'تحويل',amount:value.bankTransferInMinorUnits}, {label:'شيك',amount:value.chequeInMinorUnits},
  ...(value.otherInMinorUnits !== 0 ? [{label:'وسائل أخرى',amount:value.otherInMinorUnits}] : []),
];
