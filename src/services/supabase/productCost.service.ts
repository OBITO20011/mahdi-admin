import { isSupabaseConfigured, supabase } from '../../lib/supabase';

/** What the product editor shows about cost (migration 171). */
export interface ProductCostState {
  productId: string;
  updatedAt: string;
  isFlavorMaster: boolean;
  /** True when the product (or a flavor of the family) has stock history: saving never changes its cost. */
  hasCostHistory: boolean;
  costPriceInMinorUnits: number;
  /** Exact weighted average cost per piece, as text to keep six decimals; null before any receipt. */
  wacCostExactInMinorUnits: string | null;
  defaultPurchasePriceInMinorUnits: number;
}

export interface ProductCostCorrectionResult {
  correctionId: string;
  idempotentReplay: boolean;
  newCostPriceInMinorUnits: number;
  newExactInMinorUnits: string;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

const friendly: Readonly<Record<string, string>> = {
  PRODUCT_COST_CORRECTION_REASON_REQUIRED: 'اكتب سبب التصحيح (5 إلى 500 حرف).',
  PRODUCT_COST_CORRECTION_VALUE_INVALID: 'تكلفة الحبة يجب أن تكون صفراً أو أكثر.',
  PRODUCT_COST_CORRECTION_FLAVOR_MASTER: 'المنتج الأساسي للنكهات بلا مخزون؛ صحّح تكلفة النكهة نفسها.',
  PRODUCT_COST_CORRECTION_KEY_CONFLICT: 'تغيّرت بيانات التصحيح بعد إرساله؛ افتح النافذة من جديد.',
};

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error('إعدادات الاتصال بقاعدة البيانات غير مكتملة.');
  return supabase;
}

async function settle(request: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Json> {
  const { data, error } = await request;
  if (error) {
    const message = error.message || 'تعذر تنفيذ العملية.';
    const code = /^([A-Z0-9_]+):/u.exec(message)?.[1] ?? '';
    throw new Error(friendly[code] ?? message.replace(/^[A-Z0-9_]+:\s*/u, ''));
  }
  return obj(data);
}

export async function fetchProductCostState(productId: string): Promise<ProductCostState> {
  const data = await settle(client().rpc('get_product_cost_state_v1', { p_product_id: productId }));
  return {
    productId: text(data.productId),
    updatedAt: text(data.updatedAt),
    isFlavorMaster: data.isFlavorMaster === true,
    hasCostHistory: data.hasCostHistory === true,
    costPriceInMinorUnits: num(data.costPriceInMinorUnits),
    wacCostExactInMinorUnits: typeof data.wacCostExactInMinorUnits === 'string' ? data.wacCostExactInMinorUnits : null,
    defaultPurchasePriceInMinorUnits: num(data.defaultPurchasePriceInMinorUnits),
  };
}

/** Owner only: sets the exact WAC and cost_price together; quantities and past sales are untouched. */
export async function correctProductCost(input: {
  productId: string;
  unitCostInMinorUnits: number;
  reason: string;
  idempotencyKey: string;
}): Promise<ProductCostCorrectionResult> {
  const data = await settle(client().rpc('correct_product_cost_v1', {
    p_product_id: input.productId,
    p_unit_cost_in_minor_units: input.unitCostInMinorUnits,
    p_reason: input.reason.trim(),
    p_idempotency_key: input.idempotencyKey,
  }));
  return {
    correctionId: text(data.correctionId),
    idempotentReplay: data.idempotentReplay === true,
    newCostPriceInMinorUnits: num(data.newCostPriceInMinorUnits),
    newExactInMinorUnits: text(data.newExactInMinorUnits),
  };
}

/** The cost a sale books per piece today: the exact average when known, else cost_price. */
export const currentUnitCostInMinorUnits = (state: ProductCostState) =>
  state.wacCostExactInMinorUnits !== null ? Number(state.wacCostExactInMinorUnits) : state.costPriceInMinorUnits;
