import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import type { PaymentMethod } from '../../types';

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
  warehouseId: string;
  branchId: string;
  customerId?: string;
  customerName?: string;
  paymentMethod: PaymentMethod;
  lines: PosV2Line[];
  discountInMinorUnits: number;
  amountReceivedInMinorUnits: number;
  idempotencyKey: string;
}

export interface PosV2SaleResult {
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
      recovery: PosV2RecoveryInstruction;
    };

export type PosV2RpcExecutor = (
  functionName: 'create_pos_sale_v2',
  parameters: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

const recoveryInstruction: PosV2RecoveryInstruction = {
  automaticRetry: false,
  reuseOriginalIdempotencyKey: true,
  rotateIdempotencyKey: false,
  verifyOutcomeBeforeRetry: true,
};

const knownErrors: Record<string, string> = {
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
  PHASE3_POS_INSUFFICIENT_INVENTORY:
    'المخزون المتاح لأحد مكونات البيع غير كافٍ.',
  PHASE3_POS_OPEN_SHIFT_REQUIRED:
    'افتح وردية الصندوق قبل إتمام البيع.',
};

const extractStableIdentity = (message: string | undefined): string | null => {
  const match = message?.match(/\b([A-Z][A-Z0-9_]{4,})\s*:/u);
  return match?.[1] || null;
};

const isAmbiguousTransportFailure = (
  error: { code?: string; message?: string } | null,
): boolean => {
  if (!error) return false;
  if (extractStableIdentity(error.message)) return false;
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

export async function submitPosSaleV2WithRpc(
  input: CreatePosSaleV2Input,
  executeRpc: PosV2RpcExecutor,
): Promise<CreatePosSaleV2Outcome> {
  try {
    const { data, error } = await executeRpc(
      'create_pos_sale_v2',
      rpcParameters(input),
    );
    if (error) {
      const identity = extractStableIdentity(error.message);
      if (isAmbiguousTransportFailure(error)) {
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
        errorIdentity: identity || 'PHASE3_POS_REQUEST_REJECTED',
        message:
          (identity && knownErrors[identity]) ||
          'تعذر إتمام البيع. راجع البيانات ثم حاول بالمفتاح نفسه عند الحاجة.',
        recovery: recoveryInstruction,
      };
    }

    const payload = data as Partial<PosV2SaleResult> & { success?: boolean };
    if (!payload?.success || !payload.orderId || !payload.operationId) {
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
  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      status: 'rejected',
      errorIdentity: 'SUPABASE_NOT_CONFIGURED',
      message: 'الاتصال بقاعدة بيانات Supabase غير متاح.',
      recovery: recoveryInstruction,
    };
  }

  return submitPosSaleV2WithRpc(input, (functionName, parameters) =>
    supabase.rpc(functionName, parameters),
  );
}
