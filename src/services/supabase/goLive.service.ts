import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { RowError } from '../../features/goLive/goLiveImport';
import { fetchSuppliersFromSupabase } from './purchases.service';

type Json = Record<string, unknown>;

export interface GoLiveStatus {
  finished: boolean;
  finishedAt: string | null;
  finishedByName: string | null;
  mainBranchId: string | null;
  mainBranchName: string | null;
  branches: { id: string; name: string }[];
  products: { activeCount: number; importedCount: number };
  stock: { stockableCount: number; countedProductCount: number; sessionCount: number };
  customers: { customerCount: number; withOpeningCount: number; activeEntryCount: number; activeTotalInMinorUnits: number };
  suppliers: { supplierCount: number; withOpeningCount: number; payableTotalInMinorUnits: number; advanceTotalInMinorUnits: number };
}

export interface OpeningEntry {
  id: string;
  entryNumber: string;
  partyId: string;
  partyName: string;
  partyDetail: string;
  amountInMinorUnits: number;
  originalDate: string;
  direction?: 'payable' | 'advance';
  notes: string;
  isReversed: boolean;
  reversalReason: string;
}

export interface NewParty { row: number; name: string; phone: string }
export interface DryRunResult { rowCount: number; validCount: number; errors: RowError[]; newParties: NewParty[]; summary: Json }

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
  GO_LIVE_NEW_PARTIES_CONFIRMATION_REQUIRED: 'أكّد إضافة العملاء أو الموردين الجدد الظاهرين في المعاينة قبل الحفظ.',
};

function readRowErrors(value: unknown): RowError[] {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map(item => ({ row: num(obj(item).row), message: text(obj(item).message),
          ...(obj(item).kind === 'warning' ? { warning: true } : {}) })).filter(e => e.row > 0 && e.message)
      : [];
  } catch { return []; }
}

type RpcResponse = PromiseLike<{ data: unknown; error: { message?: string; details?: unknown } | null }>;

/** Each call site names its RPC literally so the access inventory resolves every sink. */
function client() {
  if (!isSupabaseConfigured || !supabase) throw new GoLiveRpcError('إعدادات الاتصال بقاعدة البيانات غير مكتملة.');
  return supabase;
}

async function settle(request: RpcResponse): Promise<Json> {
  const { data, error } = await request;
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
    mainBranchId: text(data.mainBranchId) || null,
    mainBranchName: text(data.mainBranchName) || null,
    branches: (Array.isArray(data.branches) ? data.branches : []).map(item => ({ id: text(obj(item).id), name: text(obj(item).name) })),
    products: { activeCount: num(products.activeCount), importedCount: num(products.importedCount) },
    stock: { stockableCount: num(stock.stockableCount), countedProductCount: num(stock.countedProductCount), sessionCount: num(stock.sessionCount) },
    customers: { customerCount: num(customers.customerCount), withOpeningCount: num(customers.withOpeningCount),
      activeEntryCount: num(customers.activeEntryCount), activeTotalInMinorUnits: num(customers.activeTotalInMinorUnits) },
    suppliers: { supplierCount: num(suppliers.supplierCount), withOpeningCount: num(suppliers.withOpeningCount),
      payableTotalInMinorUnits: num(suppliers.payableTotalInMinorUnits), advanceTotalInMinorUnits: num(suppliers.advanceTotalInMinorUnits) },
  };
}

export const fetchGoLiveStatus = async () => readGoLiveStatus(await settle(client().rpc('get_go_live_setup_status_v1', {})));

export async function fetchCustomerOpenings(): Promise<OpeningEntry[]> {
  const data = await settle(client().rpc('get_go_live_customer_openings_v1', { p_page: 1, p_page_size: 100 }));
  return (Array.isArray(data.entries) ? data.entries : []).map(item => {
    const e = obj(item);
    return { id: text(e.id), entryNumber: text(e.entryNumber), partyId: text(e.customerId), partyName: text(e.customerName), partyDetail: text(e.customerPhone),
      amountInMinorUnits: num(e.amountInMinorUnits), originalDate: text(e.originalDebtDate), notes: text(e.notes),
      isReversed: e.isReversed === true, reversalReason: text(e.reversalReason) };
  });
}

export async function fetchSupplierOpenings(): Promise<OpeningEntry[]> {
  const data = await settle(client().rpc('get_go_live_supplier_openings_v1', { p_page: 1, p_page_size: 100 }));
  return (Array.isArray(data.entries) ? data.entries : []).map(item => {
    const e = obj(item);
    return { id: text(e.id), entryNumber: text(e.entryNumber), partyId: text(e.supplierId), partyName: text(e.supplierName), partyDetail: '',
      amountInMinorUnits: num(e.amountInMinorUnits), originalDate: text(e.originalBalanceDate), notes: text(e.notes),
      direction: e.direction === 'advance' ? 'advance' : 'payable', isReversed: e.isReversed === true,
      reversalReason: text(e.reversalReason) };
  });
}

export type ServerBatchKind = 'products' | 'customers' | 'suppliers';

function batchRpc(kind: ServerBatchKind, args: Json) {
  const db = client();
  if (kind === 'products') return settle(db.rpc('import_go_live_products_v1', args));
  if (kind === 'customers') return settle(db.rpc('record_customer_opening_balances_v1', args));
  return settle(db.rpc('record_supplier_opening_balances_v1', args));
}

export async function dryRunBatch(kind: ServerBatchKind, rows: readonly Json[]): Promise<DryRunResult> {
  const data = await batchRpc(kind, { p_idempotency_key: 'dry-run-not-stored-0000', p_rows: rows, p_dry_run: true });
  const parties = Array.isArray(data.newCustomers) ? data.newCustomers : Array.isArray(data.newSuppliers) ? data.newSuppliers : [];
  return { rowCount: num(data.rowCount), validCount: num(data.validCount), errors: readRowErrors(data.errors),
    newParties: parties.map(item => ({ row: num(obj(item).row), name: text(obj(item).name), phone: text(obj(item).phone) })),
    summary: data };
}

export async function saveBatch(kind: ServerBatchKind, key: string, rows: readonly Json[], confirmNewParties = false) {
  const confirm = kind === 'customers' ? { p_confirm_new_customers: confirmNewParties }
    : kind === 'suppliers' ? { p_confirm_new_suppliers: confirmNewParties } : {};
  const data = await batchRpc(kind, { p_idempotency_key: key, p_rows: rows, p_dry_run: false, ...confirm });
  return { replay: data.idempotentReplay === true, created: Array.isArray(data.created) ? data.created.length : 0 };
}

export async function reverseOpening(kind: 'customers' | 'suppliers', entryId: string, reason: string) {
  const args = { p_entry_id: entryId, p_reason: reason };
  const data = kind === 'customers'
    ? await settle(client().rpc('reverse_customer_opening_balance_v1', args))
    : await settle(client().rpc('reverse_supplier_opening_balance_v1', args));
  return { replay: data.idempotentReplay === true };
}

export async function finishGoLiveSetup(confirmation: string) {
  const data = await settle(client().rpc('finish_go_live_setup_v1', { p_confirmation: confirmation }));
  return { finishedAt: text(data.finishedAt) };
}

export interface PartyOption { id: string; name: string; detail: string }

export async function searchCustomers(search: string): Promise<PartyOption[]> {
  const data = await settle(client().rpc('get_crm_customer_page', { p_page: 1, p_page_size: 20, p_search: search || null, p_status: 'all', p_sort: 'latest' }));
  return (Array.isArray(data.customers) ? data.customers : []).map(item => {
    const c = obj(item);
    return { id: text(c.id), name: text(c.full_name), detail: text(c.phone) };
  });
}

/** Reuses the purchases supplier read, so go-live adds no direct table query of its own. */
export async function listActiveSuppliers(): Promise<PartyOption[]> {
  const suppliers = await fetchSuppliersFromSupabase();
  return suppliers.map(supplier => ({ id: supplier.id, name: supplier.companyName, detail: supplier.phone }));
}

/** Content-bound key: retries of the same preview replay; a new file selection gets a new session. */
export async function batchKey(kind: string, session: string, index: number, rows: readonly unknown[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  const hex = Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
  return `golive-${kind}-${session}-${index}-${hex}`;
}

// ---------------------------------------------------------------- unified collection (163)
export interface CollectionPart {
  kind: 'opening' | 'order';
  id: string;
  reference: string;
  debtAt: string;
  outstandingInMinorUnits: number;
  allocateInMinorUnits: number;
  remainingAfterInMinorUnits: number;
}
export interface CollectionPreview {
  totalOutstandingInMinorUnits: number;
  openingOutstandingInMinorUnits: number;
  ordersOutstandingInMinorUnits: number;
  exceedsBalance: boolean;
  parts: CollectionPart[];
}
export interface CollectionOperation {
  operationId: string;
  operationNumber: string;
  amountInMinorUnits: number;
  openingAmountInMinorUnits: number;
  ordersAmountInMinorUnits: number;
  paymentMethod: string;
  isReversed: boolean;
  createdAt: string;
  remainingBalanceInMinorUnits: number;
}
export type CollectionMethod = 'cash' | 'cliq' | 'bank_transfer';

const readPart = (value: unknown): CollectionPart => {
  const p = obj(value);
  return { kind: p.kind === 'opening' ? 'opening' : 'order', id: text(p.id), reference: text(p.reference),
    debtAt: text(p.debtAt), outstandingInMinorUnits: num(p.outstandingInMinorUnits),
    allocateInMinorUnits: num(p.allocateInMinorUnits), remainingAfterInMinorUnits: num(p.remainingAfterInMinorUnits) };
};
const readOperation = (value: unknown): CollectionOperation => {
  const o = obj(value);
  return { operationId: text(o.operationId), operationNumber: text(o.operationNumber),
    amountInMinorUnits: num(o.amountInMinorUnits), openingAmountInMinorUnits: num(o.openingAmountInMinorUnits),
    ordersAmountInMinorUnits: num(o.ordersAmountInMinorUnits), paymentMethod: text(o.paymentMethod),
    isReversed: o.isReversed === true, createdAt: text(o.createdAt),
    remainingBalanceInMinorUnits: num(o.remainingBalanceInMinorUnits) };
};

export async function previewCustomerCollection(customerId: string, amountInMinorUnits: number): Promise<CollectionPreview> {
  const data = await settle(client().rpc('preview_customer_collection_v1', { p_customer_id: customerId, p_amount_in_minor_units: amountInMinorUnits }));
  return { totalOutstandingInMinorUnits: num(data.totalOutstandingInMinorUnits),
    openingOutstandingInMinorUnits: num(data.openingOutstandingInMinorUnits),
    ordersOutstandingInMinorUnits: num(data.ordersOutstandingInMinorUnits),
    exceedsBalance: data.exceedsBalance === true,
    parts: (Array.isArray(data.parts) ? data.parts : []).map(readPart) };
}

export async function collectCustomerBalance(input: { customerId: string; amountInMinorUnits: number; method: CollectionMethod;
  branchId: string | null; reference: string; notes: string; idempotencyKey: string }) {
  return readOperation(await settle(client().rpc('collect_customer_balance_v1', { p_customer_id: input.customerId,
    p_amount_in_minor_units: input.amountInMinorUnits, p_payment_method: input.method, p_branch_id: input.branchId,
    p_reference_number: input.reference.trim() || null, p_notes: input.notes.trim() || null,
    p_idempotency_key: input.idempotencyKey })));
}

export async function reverseCustomerCollection(operationId: string, reason: string) {
  return readOperation(await settle(client().rpc('reverse_customer_collection_v1', { p_operation_id: operationId, p_reason: reason })));
}

export async function fetchCustomerCollections(customerId: string): Promise<CollectionOperation[]> {
  const data = await settle(client().rpc('get_customer_collections_v1', { p_customer_id: customerId }));
  return (Array.isArray(data.operations) ? data.operations : []).map(readOperation);
}

// ---------------------------------------------------------------- supplier opening payment (163)
export async function fetchSupplierOpeningPayable(supplierId: string) {
  const data = await settle(client().rpc('get_supplier_opening_payable_v1', { p_supplier_id: supplierId }));
  return { remainingInMinorUnits: num(data.remainingOpeningPayableInMinorUnits), currentBalanceInMinorUnits: num(data.currentBalanceInMinorUnits) };
}

export async function paySupplierOpeningBalance(input: { supplierId: string; branchId: string | null; amountInMinorUnits: number;
  method: 'cash' | 'cliq' | 'bank_transfer' | 'cheque'; reference: string; notes: string; idempotencyKey: string }) {
  const data = await settle(client().rpc('pay_supplier_opening_balance_v1', { p_supplier_id: input.supplierId, p_branch_id: input.branchId,
    p_amount_in_minor_units: input.amountInMinorUnits, p_payment_method: input.method,
    p_reference_number: input.reference.trim() || null, p_notes: input.notes.trim() || null,
    p_idempotency_key: input.idempotencyKey }));
  return { remainingInMinorUnits: num(data.remainingOpeningPayableInMinorUnits), replay: data.idempotentReplay === true };
}

export const setGoLiveMainBranch = (branchId: string) => settle(client().rpc('set_go_live_main_branch_v1', { p_branch_id: branchId }));

export const newIdempotencyKey = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
