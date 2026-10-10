export interface CustomerDebtAging {
  total_in_minor_units: number;
  days_0_7_in_minor_units: number;
  days_8_30_in_minor_units: number;
  days_over_30_in_minor_units: number;
  age_unavailable_in_minor_units: number;
  oldest_debt_at?: string | null;
  oldest_debt_age_days?: number | null;
  last_payment_at?: string | null;
  overdue_customer_count?: number;
  over_limit_customer_count?: number;
}

export function readCustomerDebtAging(value: unknown): CustomerDebtAging | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const fields = ['total_in_minor_units', 'days_0_7_in_minor_units',
    'days_8_30_in_minor_units', 'days_over_30_in_minor_units', 'age_unavailable_in_minor_units'] as const;
  if (fields.some(key => typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)) return null;
  if (Number(row.total_in_minor_units) !== fields.slice(1).reduce((sum, key) => sum + Number(row[key]), 0)) return null;
  for (const key of ['overdue_customer_count', 'over_limit_customer_count', 'oldest_debt_age_days']) {
    if (row[key] !== undefined && row[key] !== null
      && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || Number(row[key]) < 0)) return null;
  }
  for (const key of ['oldest_debt_at', 'last_payment_at']) {
    if (row[key] !== undefined && row[key] !== null
      && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(String(row[key]))))) return null;
  }
  return row as unknown as CustomerDebtAging;
}
