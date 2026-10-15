import { isSupabaseConfigured, supabase } from '../../lib/supabase';

/** Owner cash withdrawals (migrations 180-181). Every RPC name is literal. */
export interface ShiftOwnerWithdrawal {
  withdrawalId: string;
  withdrawalNumber: string;
  amountInMinorUnits: number;
  reason: string;
  createdAt: string;
  createdByName: string;
  reversal: { reversalId: string; effectiveShiftId: string; reversedAt: string; reason: string; viaShiftReversal: boolean } | null;
}
export interface ShiftOwnerReturn {
  reversalId: string;
  withdrawalNumber: string;
  amountInMinorUnits: number;
  reversedAt: string;
  reason: string;
  voided: boolean;
}
export interface ShiftOwnerWithdrawals { withdrawals: ShiftOwnerWithdrawal[]; returnsFromOtherShifts: ShiftOwnerReturn[] }

export interface OwnerWithdrawalsReportRow {
  kind: 'withdrawal' | 'return' | 'return_voided';
  at: string;
  direction: 'out' | 'in';
  amountInMinorUnits: number;
  withdrawalNumber: string;
  branchName: string;
  shiftNumber: string;
  actorName: string;
  reason: string;
  withdrawalId: string;
  /** The withdrawal currently has an active return (reverse button hidden). */
  isReversed: boolean;
}
export interface OwnerWithdrawalTotals { withdrawnInMinorUnits: number; returnedInMinorUnits: number; netInMinorUnits: number }
export interface OwnerWithdrawalsReport {
  totals: OwnerWithdrawalTotals;
  rows: OwnerWithdrawalsReportRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const list = (value: unknown) => (Array.isArray(value) ? value : []);

/** Thrown with the database message; drawer refusals keep their expected-cash detail. */
export class OwnerWithdrawalError extends Error {
  constructor(message: string, readonly code = '') { super(message); }
}

function client() {
  if (!isSupabaseConfigured || !supabase) throw new OwnerWithdrawalError('إعدادات الاتصال بقاعدة البيانات غير مكتملة.');
  return supabase;
}

async function settle(request: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Json> {
  const { data, error } = await request;
  if (error) {
    const message = error.message || 'تعذر تنفيذ العملية.';
    const code = /^([A-Z0-9_]+):/u.exec(message)?.[1] ?? '';
    throw new OwnerWithdrawalError(message.replace(/^[A-Z0-9_]+:\s*/u, ''), code);
  }
  return obj(data);
}

export const newWithdrawalKey = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export async function createOwnerWithdrawal(input: { shiftId: string; amountInMinorUnits: number; reason: string; idempotencyKey: string }) {
  const data = await settle(client().rpc('create_owner_cash_withdrawal_v1', {
    p_shift_id: input.shiftId,
    p_amount_in_minor_units: input.amountInMinorUnits,
    p_reason: input.reason.trim() || null,
    p_idempotency_key: input.idempotencyKey,
  }));
  return { withdrawalNumber: text(data.withdrawalNumber), replay: data.idempotentReplay === true };
}

export async function reverseOwnerWithdrawal(input: { withdrawalId: string; reason: string; idempotencyKey: string }) {
  const data = await settle(client().rpc('reverse_owner_cash_withdrawal_v1', {
    p_withdrawal_id: input.withdrawalId,
    p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
  }));
  return { effectiveShiftId: text(data.effectiveShiftId), replay: data.idempotentReplay === true };
}

export async function fetchShiftOwnerWithdrawals(shiftId: string): Promise<ShiftOwnerWithdrawals> {
  const data = await settle(client().rpc('get_shift_owner_withdrawals_v1', { p_shift_id: shiftId }));
  return {
    withdrawals: list(data.withdrawals).map(item => {
      const w = obj(item), r = w.reversal ? obj(w.reversal) : null;
      return {
        withdrawalId: text(w.withdrawalId), withdrawalNumber: text(w.withdrawalNumber), amountInMinorUnits: num(w.amountInMinorUnits),
        reason: text(w.reason), createdAt: text(w.createdAt), createdByName: text(w.createdByName),
        reversal: r ? { reversalId: text(r.reversalId), effectiveShiftId: text(r.effectiveShiftId), reversedAt: text(r.reversedAt),
          reason: text(r.reason), viaShiftReversal: r.viaShiftReversal === true } : null,
      };
    }),
    returnsFromOtherShifts: list(data.returnsFromOtherShifts).map(item => {
      const r = obj(item);
      return { reversalId: text(r.reversalId), withdrawalNumber: text(r.withdrawalNumber), amountInMinorUnits: num(r.amountInMinorUnits),
        reversedAt: text(r.reversedAt), reason: text(r.reason), voided: r.voided === true };
    }),
  };
}

export const readOwnerWithdrawalTotals = (value: unknown): OwnerWithdrawalTotals => {
  const t = obj(value);
  return { withdrawnInMinorUnits: num(t.withdrawnInMinorUnits), returnedInMinorUnits: num(t.returnedInMinorUnits), netInMinorUnits: num(t.netInMinorUnits) };
};

export async function fetchOwnerWithdrawalsReport(input: { branchId: string | null; dateFrom: string; dateTo: string; page: number; pageSize: number }): Promise<OwnerWithdrawalsReport> {
  const data = await settle(client().rpc('get_owner_withdrawals_report', {
    p_branch_id: input.branchId,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
    p_page: input.page,
    p_page_size: input.pageSize,
  }));
  return {
    totals: readOwnerWithdrawalTotals(data.totals),
    rows: list(data.rows).map(item => {
      const r = obj(item);
      return { kind: (['withdrawal', 'return', 'return_voided'].includes(text(r.kind)) ? text(r.kind) : 'withdrawal') as OwnerWithdrawalsReportRow['kind'],
        at: text(r.at), direction: r.direction === 'in' ? 'in' : 'out', amountInMinorUnits: num(r.amountInMinorUnits),
        withdrawalNumber: text(r.withdrawalNumber), branchName: text(r.branchName), shiftNumber: text(r.shiftNumber),
        actorName: text(r.actorName), reason: text(r.reason), withdrawalId: text(r.withdrawalId), isReversed: r.isReversed === true };
    }),
    totalCount: num(data.totalCount), page: num(data.page), pageSize: num(data.pageSize),
  };
}
