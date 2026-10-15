import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { RowError } from '../../features/goLive/goLiveImport';

type Json = Record<string, unknown>;

export interface GoLiveStatus {
  finished: boolean;
  finishedAt: string | null;
  finishedByName: string | null;
  products: { activeCount: number; importedCount: number };
  stock: { stockableCount: number; countedProductCount: number; sessionCount: number };
  customers: { customerCount: number; withOpeningCount: number; activeEntryCount: number; activeTotalInMinorUnits: number };
  suppliers: { supplierCount: number; withOpeningCount: number; payableTotalInMinorUnits: number; advanceTotalInMinorUnits: number };
}

export interface OpeningEntry {
  id: string;
  entryNumber: string;
  partyName: string;
  partyDetail: string;
  amountInMinorUnits: number;
  originalDate: string;
  direction?: 'payable' | 'advance';
  notes: string;
  isReversed: boolean;
  reversalReason: string;
}

export interface DryRunResult { rowCount: number; validCount: number; errors: RowError[]; summary: Json }

/** Thrown when the database refuses a batch; carries per-row errors when given. */
export class GoLiveRpcError extends Error {
  constructor(message: string, readonly rowErrors: RowError[] = [], readonly code = '') { super(message); }
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});

const friendly: Readonly<Record<string, string>> = {
  GO_LIVE_SETUP_FINISHED: 'تم إنهاء بداية التشغيل؛ لا يُقبل أي إدخال افتتاحي بعد الآن.',
  GO_LIVE_BATCH_KEY_CONFLICT: 'تغيّر محتوى الدفعة بعد المعاينة؛ أعد اختيار الملف ومعاينته.',
  GO_LIVE_CONFIRMATION_REQUIRED: 'اكتب عبارة التأكيد كما هي حرفياً.',
};

function readRowErrors(value: unknown): RowError[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map(item => ({ row: num(obj(item).row), message: text(obj(item).message) })).filter(e => e.row > 0 && e.message)
      : [];
  } catch { return []; }
}

async function call(name: string, args: Json): Promise<Json> {
  if (!isSupabaseConfigured || !supabase) throw new GoLiveRpcError('إعدادات الاتصال بقاعدة البيانات غير مكتملة.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const message = error.message || 'تعذر تنفيذ العملية.';
    const code = /^([A-Z0-9_]+):/u.exec(message)?.[1] ?? '';
    throw new GoLiveRpcError(friendly[code] ?? message.replace(/^[A-Z0-9_]+:\s*/u, ''), readRowErrors(error.details), code);
  }
  return obj(data);
}

export function readGoLiveStatus(data: Json): GoLiveStatus {
  const products = obj(data.products), stock = obj(data.stock), customers = obj(data.customers), suppliers = obj(data.suppliers);
  return {
    finished: data.finished === true,
    finishedAt: text(data.finishedAt) || null,
    finishedByName: text(data.finishedByName) || null,
    products: { activeCount: num(products.activeCount), importedCount: num(products.importedCount) },
    stock: { stockableCount: num(stock.stockableCount), countedProductCount: num(stock.countedProductCount), sessionCount: num(stock.sessionCount) },
    customers: { customerCount: num(customers.customerCount), withOpeningCount: num(customers.withOpeningCount),
      activeEntryCount: num(customers.activeEntryCount), activeTotalInMinorUnits: num(customers.activeTotalInMinorUnits) },
    suppliers: { supplierCount: num(suppliers.supplierCount), withOpeningCount: num(suppliers.withOpeningCount),
      payableTotalInMinorUnits: num(suppliers.payableTotalInMinorUnits), advanceTotalInMinorUnits: num(suppliers.advanceTotalInMinorUnits) },
  };
}

export const fetchGoLiveStatus = async () => readGoLiveStatus(await call('get_go_live_setup_status_v1', {}));

export async function fetchCustomerOpenings(): Promise<OpeningEntry[]> {
  const data = await call('get_go_live_customer_openings_v1', { p_page: 1, p_page_size: 100 });
  return (Array.isArray(data.entries) ? data.entries : []).map(item => {
    const e = obj(item);
    return { id: text(e.id), entryNumber: text(e.entryNumber), partyName: text(e.customerName), partyDetail: text(e.customerPhone),
      amountInMinorUnits: num(e.amountInMinorUnits), originalDate: text(e.originalDebtDate), notes: text(e.notes),
      isReversed: e.isReversed === true, reversalReason: text(e.reversalReason) };
  });
}

export async function fetchSupplierOpenings(): Promise<OpeningEntry[]> {
  const data = await call('get_go_live_supplier_openings_v1', { p_page: 1, p_page_size: 100 });
  return (Array.isArray(data.entries) ? data.entries : []).map(item => {
    const e = obj(item);
    return { id: text(e.id), entryNumber: text(e.entryNumber), partyName: text(e.supplierName), partyDetail: '',
      amountInMinorUnits: num(e.amountInMinorUnits), originalDate: text(e.originalBalanceDate), notes: text(e.notes),
      direction: e.direction === 'advance' ? 'advance' : 'payable', isReversed: e.isReversed === true,
      reversalReason: text(e.reversalReason) };
  });
}

const rpcByKind = {
  products: 'import_go_live_products_v1',
  customers: 'record_customer_opening_balances_v1',
  suppliers: 'record_supplier_opening_balances_v1',
} as const;
export type ServerBatchKind = keyof typeof rpcByKind;

export async function dryRunBatch(kind: ServerBatchKind, rows: readonly Json[]): Promise<DryRunResult> {
  const data = await call(rpcByKind[kind], { p_idempotency_key: 'dry-run-not-stored-0000', p_rows: rows, p_dry_run: true });
  return { rowCount: num(data.rowCount), validCount: num(data.validCount), errors: readRowErrors(data.errors), summary: data };
}

export async function saveBatch(kind: ServerBatchKind, key: string, rows: readonly Json[]) {
  const data = await call(rpcByKind[kind], { p_idempotency_key: key, p_rows: rows, p_dry_run: false });
  return { replay: data.idempotentReplay === true, created: Array.isArray(data.created) ? data.created.length : 0 };
}

export async function reverseOpening(kind: 'customers' | 'suppliers', entryId: string, reason: string) {
  const data = await call(kind === 'customers' ? 'reverse_customer_opening_balance_v1' : 'reverse_supplier_opening_balance_v1',
    { p_entry_id: entryId, p_reason: reason });
  return { replay: data.idempotentReplay === true };
}

export async function finishGoLiveSetup(confirmation: string) {
  const data = await call('finish_go_live_setup_v1', { p_confirmation: confirmation });
  return { finishedAt: text(data.finishedAt) };
}

export interface PartyOption { id: string; name: string; detail: string }

export async function searchCustomers(search: string): Promise<PartyOption[]> {
  const data = await call('get_crm_customer_page', { p_page: 1, p_page_size: 20, p_search: search || null, p_status: 'all', p_sort: 'latest' });
  return (Array.isArray(data.customers) ? data.customers : []).map(item => {
    const c = obj(item);
    return { id: text(c.id), name: text(c.full_name), detail: text(c.phone) };
  });
}

export async function listActiveSuppliers(): Promise<PartyOption[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.from('suppliers').select('id,company_name,phone').eq('is_active', true)
    .order('company_name', { ascending: true }).limit(1000);
  if (error) throw new GoLiveRpcError(error.message || 'تعذر تحميل الموردين.');
  return (data ?? []).map(row => ({ id: String(row.id), name: String(row.company_name ?? ''), detail: String(row.phone ?? '') }));
}

/** Content-bound key: retries of the same preview replay; a new file selection gets a new session. */
export async function batchKey(kind: string, session: string, index: number, rows: readonly unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  const hex = Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
  return `golive-${kind}-${session}-${index}-${hex}`;
}
