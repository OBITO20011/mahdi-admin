import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { PaymentMethod } from '../../types';
import {posV2ResultMatches,posV2RequestValid} from './posV2Validation';

export interface PosV2BaseUnitLine {
  commercial_line_kind: 'base_unit';
  product_id: string;
  base_quantity: number;
  price_authority?: 'server_catalog';
  line_discount_in_minor_units?: 0;
}

export interface PosV2LegacyParcelLine {
  commercial_line_kind: 'legacy_single_sku_parcel';
  product_id: string;
  parcel_quantity: number;
  units_per_parcel: number;
  price_authority?: 'server_catalog';
  line_discount_in_minor_units?: 0;
}

export interface PosV2ConfigurableParcelLine {
  commercial_line_kind: 'configurable_parcel';
  family_product_id: string;
  parcel_configuration_id: string;
  configuration_revision: number;
  price_authority?: 'server_catalog';
  line_discount_in_minor_units?: 0;
  parcel_instances: Array<{
    components: Array<{ product_id: string; base_quantity: number }>;
  }>;
}

export type PosV2Line =
  | PosV2BaseUnitLine
  | PosV2LegacyParcelLine
  | PosV2ConfigurableParcelLine;

export interface CreatePosSaleV2Input {
  /** Captured with the durable attempt; recovery never follows a later toggle. */
  accountingMode?: 'full' | 'sales-only';
  unavailableConfirmed?: string[];
  warehouseId: string;
  branchId: string;
  customerId?: string;
  customerName?: string;
  paymentMethod: PaymentMethod;
  lines: PosV2Line[];
  discountInMinorUnits: number;
  amountReceivedInMinorUnits: number;
  idempotencyKey: string;
  initialPayment?: {amountInMinorUnits: number; method: 'cash' | 'cliq'; referenceNumber?: string};
}

export interface PosV2SaleResult {
  accountingTracked?: boolean;
  unavailableConfirmed?: string[];
  warehouseId: string;
  branchId: string;
  customerName: string;
  operationId: string;
  orderId: string;
  orderNumber: string;
  idempotentReplay: boolean;
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  totalInMinorUnits: number;
  amountPaidInMinorUnits: number;
  changeDueInMinorUnits: number;
  paymentMethod: PaymentMethod;
  paymentStatus: 'paid' | 'unpaid' | 'partially_paid';
  initialPaymentMethod?: 'cash' | 'cliq';
  initialPaymentId?: string;
  remainingInMinorUnits?: number;
  items: unknown[];
}

export interface PosV2RecoveryInstruction {
  automaticRetry: false;
  reuseOriginalIdempotencyKey: true;
  rotateIdempotencyKey: false;
  verifyOutcomeBeforeRetry: true;
}

export type CreatePosSaleV2Outcome =
  | { ok: true; status: 'completed'; data: PosV2SaleResult }
  | {
      ok: false;
      status: 'rejected' | 'unknown';
      errorIdentity: string;
      message: string;
      rejectionCode?: string;
      recovery: PosV2RecoveryInstruction;
    };

export type PosV2RpcExecutor = (
  functionName: 'create_pos_sale_v2' | 'create_pos_sale_with_initial_payment_v1' | 'lite1_pos2',
  parameters: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const recoveryInstruction: PosV2RecoveryInstruction = {
  automaticRetry: false,
  reuseOriginalIdempotencyKey: true,
  rotateIdempotencyKey: false,
  verifyOutcomeBeforeRetry: true,
};

const knownErrors: Record<string, string> = {
  LITE1_UNAVAILABLE_CONFIRM_REQUIRED: 'الصنف غير متوفر يدوياً. راجع الأصناف وأكّد البيع رغم عدم التوفر قبل بدء محاولة جديدة.',
  LITE2_REQUEST_INVALID: 'تعذر إثبات بيانات البيع أو وضع التشغيل. حدّث الشاشة واسترجع أي محاولة معلقة أولاً.',
  LITE1_MODE_DISABLED: 'تغيّر وضع التشغيل. حدّث الشاشة واسترجع أي محاولة معلقة قبل بدء بيع جديد.',
  LITE1_IDEMPOTENCY_CONFLICT: 'هوية المحاولة لا تطابق الطلب المحفوظ. استرجع المحاولة الأصلية ولا تنشئ بيعاً جديداً.',
  PACKAGE_D_POS_ATTEMPT_CANCELLED: 'هذه المحاولة أُلغيت بإثبات الخادم. ابدأ محاولة جديدة من السلة بعد مراجعتها.',
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

const extractStableIdentity = (message: string | undefined, lite = false): string | null => {
  if (lite && message && Object.hasOwn(knownErrors, message.trim())) return message.trim();
  const match = message?.match(/\b([A-Z][A-Z0-9_]{4,})\s*:/u);
  return match?.[1] || null;
};

const isAmbiguousTransportFailure = (
  error: { code?: string; message?: string } | null,
  lite = false,
): boolean => {
  if (!error) return false;
  if (extractStableIdentity(error.message,lite)) return false;
  return !error.code || /network|fetch|timeout|timed out|connection|abort/iu.test(
    error.message || '',
  );
};

const rpcParameters = (input: CreatePosSaleV2Input) => ({
  p_warehouse_id: input.warehouseId,
  p_branch_id: input.branchId,
  p_customer_id: input.customerId || null,
  p_customer_name: input.customerName?.trim() || 'زبون نقدي',
  p_payment_method: input.paymentMethod,
  p_lines: input.lines,
  p_discount_in_minor_units: input.discountInMinorUnits,
  p_amount_received_in_minor_units: input.amountReceivedInMinorUnits,
  p_idempotency_key: input.idempotencyKey,
});
const partialRpcParameters = (input: CreatePosSaleV2Input) => ({
  p_warehouse_id: input.warehouseId, p_branch_id: input.branchId,
  p_customer_id: input.customerId || null, p_customer_name: input.customerName?.trim() || 'زبون نقدي',
  p_lines: input.lines, p_discount_in_minor_units: input.discountInMinorUnits,
  p_initial_paid_in_minor_units: input.initialPayment!.amountInMinorUnits,
  p_initial_payment_method: input.initialPayment!.method,
  p_reference_number: input.initialPayment!.referenceNumber?.trim() || null,
  p_idempotency_key: input.idempotencyKey,
});

const liteRpcParameters = (input: CreatePosSaleV2Input) => ({
  p_key: input.idempotencyKey,
  p_request: {
    warehouseId: input.warehouseId, branchId: input.branchId,
    ...(input.customerId ? {customerId: input.customerId} : {}),
    customerName: input.customerName?.trim() || 'زبون نقدي',
    paymentMethod: input.paymentMethod, lines: input.lines,
    discountInMinorUnits: input.discountInMinorUnits,
    amountReceivedInMinorUnits: input.amountReceivedInMinorUnits,
    ...(input.initialPayment ? {initialPayment: input.initialPayment} : {}),
    ...(input.unavailableConfirmed ? {unavailableConfirmed: input.unavailableConfirmed} : {}),
  },
});

export async function submitPosSaleV2WithRpc(
  input: CreatePosSaleV2Input,
  executeRpc: PosV2RpcExecutor,
): Promise<CreatePosSaleV2Outcome> {
  input = structuredClone(input);
  const initialContract=input.initialPayment!==undefined;
  if((initialContract||input.accountingMode!==undefined||input.unavailableConfirmed!==undefined)&&!posV2RequestValid(input))return {
    ok:false,status:'rejected',errorIdentity:initialContract?'POS216_INITIAL_PAYMENT_INVALID':'LITE2_REQUEST_INVALID',rejectionCode:'22023',
    message:initialContract?knownErrors.POS216_INITIAL_PAYMENT_INVALID:knownErrors.LITE2_REQUEST_INVALID,recovery:recoveryInstruction,
  };
  try {
    // Literal sinks keep the current RPC inventory independently auditable.
    const { data, error } = input.accountingMode === 'sales-only'
      ? await executeRpc('lite1_pos2',liteRpcParameters(structuredClone(input)))
      : input.initialPayment
      ? await executeRpc('create_pos_sale_with_initial_payment_v1',partialRpcParameters(structuredClone(input)))
      : await executeRpc('create_pos_sale_v2',rpcParameters(structuredClone(input)));
    if (error) {
      const identity = extractStableIdentity(error.message,input.accountingMode==='sales-only');
      if (data != null || isAmbiguousTransportFailure(error,input.accountingMode==='sales-only')) {
        return {
          ok: false,
          status: 'unknown',
          errorIdentity: 'PHASE3_POS_WRITE_OUTCOME_UNKNOWN',
          message:
            'انقطع الاتصال بعد إرسال البيع. لا تعِد العملية بمفتاح جديد؛ تحقق من النتيجة أولًا.',
          recovery: recoveryInstruction,
        };
      }
      return {
        ok: false,
        status: 'rejected',
        rejectionCode: error.code,
        errorIdentity: identity || 'PHASE3_POS_REQUEST_REJECTED',
        message:
          (identity && knownErrors[identity]) ||
          'تعذر إتمام البيع. راجع البيانات ثم حاول بالمفتاح نفسه عند الحاجة.',
        recovery: recoveryInstruction,
      };
    }

    const payload = data as Partial<PosV2SaleResult> & { success?: boolean };
    if (!posV2ResultMatches(input, payload)) {
      return {
        ok: false,
        status: 'unknown',
        errorIdentity: 'PHASE3_POS_RESPONSE_INVALID',
        message:
          'وصل رد غير مكتمل بعد إرسال البيع. تحقق من النتيجة قبل إعادة المحاولة.',
        recovery: recoveryInstruction,
      };
    }
    return { ok: true, status: 'completed', data: payload as PosV2SaleResult };
  } catch {
    return {
      ok: false,
      status: 'unknown',
      errorIdentity: 'PHASE3_POS_WRITE_OUTCOME_UNKNOWN',
      message:
        'انقطع الاتصال بعد إرسال البيع. لا تعِد العملية بمفتاح جديد؛ تحقق من النتيجة أولًا.',
      recovery: recoveryInstruction,
    };
  }
}

export async function createPosSaleV2InSupabase(
  input: CreatePosSaleV2Input,
): Promise<CreatePosSaleV2Outcome> {
  const client = supabase;
  if (!isSupabaseConfigured || !client) {
    return {
      ok: false,
      status: 'rejected',
      errorIdentity: 'SUPABASE_NOT_CONFIGURED',
      message: 'الاتصال بقاعدة بيانات Supabase غير متاح.',
      recovery: recoveryInstruction,
    };
  }

  return submitPosSaleV2WithRpc(input, (functionName, parameters) =>
    client.rpc(functionName, parameters),
  );
}
