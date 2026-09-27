import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  readAdminAftercareRecoveryState,
  runAdminAftercareMutation,
  type AdminAftercareAction,
  type AdminAftercareRecoveryState,
} from './adminAftercareRecovery';

export interface AftercarePhysicalRepresentative {
  sourceKind: 'base_order_item' | 'parcel_component' | 'replacement_item';
  sourceId: string;
  productId: string;
  remainingQuantity: number;
  parentReplacementItemId: string | null;
}
export type AdminAftercareCapability =
  | 'phase43_modern'
  | 'legacy_website_return_v1'
  | 'legacy_pos_v1_unsupported'
  | 'unsupported_contract';

interface AdminAftercareBaseItem {
  orderItemId: string; productId: string; quantity: number;
  remainingQuantity: number;
  physicalRepresentatives: AftercarePhysicalRepresentative[];
}
interface AdminAftercareParcelInstance {
  parcelInstanceId: string; orderItemId: string;
  components: Array<{
    parcelComponentId: string; productId: string; quantity: number;
    physicalRepresentatives: AftercarePhysicalRepresentative[];
  }>;
}
interface AdminAftercareContextBase {
  contractVersion: 403;
  serverTime: string;
  capability: AdminAftercareCapability;
  baseItems: AdminAftercareBaseItem[];
  parcelInstances: AdminAftercareParcelInstance[];
  returns: Array<Record<string, unknown>>;
  replacements: Array<Record<string, unknown>>;
}
export interface AdminAftercareModernContext extends AdminAftercareContextBase {
  supported: true;
  capability: 'phase43_modern';
  order: {
    id: string; orderNumber: string; status: string; saleContract: string;
    branchId: string; warehouseId: string; completedAt: string;
    deadlineAt: string; withinWindow: boolean;
  };
  financial: {
    merchandiseDebtInMinorUnits: number;
    refundableCollectedInMinorUnits: number;
    deliveryFeeInMinorUnits: number;
  };
}
export interface AdminAftercareLegacyContext extends AdminAftercareContextBase {
  supported: false;
  capability: Exclude<AdminAftercareCapability, 'phase43_modern'>;
  order: {
    id: string; orderNumber: string; status: string; saleContract: string | null;
    source: string; branchId: string | null; warehouseId: string | null;
    completedAt: null; deadlineAt: null; withinWindow: false;
  };
  financial: null;
}
export type AdminAftercareContext =
  | AdminAftercareModernContext
  | AdminAftercareLegacyContext;

export interface ReplacementRequestItem {
  sourceKind: AftercarePhysicalRepresentative['sourceKind'];
  sourceId: string;
  quantity: number;
}
export interface ReturnRequestItem {
  return_scope: 'base_unit' | 'parcel_instance';
  order_item_id: string;
  quantity?: number;
  stock_disposition?: 'restock' | 'damaged';
  parcel_instance_id?: string;
  components?: Array<{
    parcel_component_id: string;
    accepted_quantity: number;
    rejected_quantity: number;
    accepted_condition: 'sellable' | 'supplier_defect' | null;
    accepted_stock_disposition: 'restock' | 'non_sellable' | null;
    rejection_reason: 'customer_damage' | null;
    rejected_stock_disposition: 'returned_to_customer' | null;
  }>;
}
export interface ReturnPhysicalSource {
  root_source_kind: 'base_order_item' | 'parcel_component';
  root_source_id: string;
  source_kind: AftercarePhysicalRepresentative['sourceKind'];
  source_id: string;
  product_id: string;
  quantity: number;
  sellable_restock_quantity: number;
  defect_non_sellable_quantity: number;
  customer_damage_quantity: number;
}

interface ReplacementMutationRequest {
  items: ReplacementRequestItem[];
  reason: string;
  notes: string | null;
}
interface ReturnMutationRequest {
  items: ReturnRequestItem[];
  physicalSources: ReturnPhysicalSource[];
  reason: string;
  refundMethod: 'cash' | 'cliq' | null;
  referenceNumber: string | null;
  notes: string | null;
}

const unavailable = () => ({success: false, error: 'اتصال قاعدة البيانات غير متاح.'});

export async function fetchAdminAftercareContext(
  orderId: string,
): Promise<{success: boolean; data?: AdminAftercareContext; error?: string}> {
  if (!isSupabaseConfigured || !supabase) return unavailable();
  const {data, error} = await supabase.rpc('get_admin_sales_aftercare_context_v1', {
    p_order_id: orderId,
  });
  if (error) return {success: false, error: error.message};
  const context = data as Partial<AdminAftercareContext> | null;
  const capability = context?.capability;
  const capabilityValid = capability === 'phase43_modern'
    || capability === 'legacy_website_return_v1'
    || capability === 'legacy_pos_v1_unsupported'
    || capability === 'unsupported_contract';
  const supportBindingValid = context?.supported === true
    ? capability === 'phase43_modern'
    : context?.supported === false && capabilityValid && capability !== 'phase43_modern';
  if (!context || context.contractVersion !== 403 || !supportBindingValid) {
    return {success: false, error: 'سياق خدمات ما بعد البيع غير مكتمل.'};
  }
  return {success: true, data: context as AdminAftercareContext};
}

export async function settleAdminReplacement(input: {
  orderId: string;
  items: ReplacementRequestItem[];
  reason: string;
  notes?: string;
}) {
  if (!isSupabaseConfigured || !supabase) return unavailable();
  const orderId = input.orderId;
  const request = {items: input.items, reason: input.reason.trim(), notes: input.notes?.trim() || null};
  return runAdminAftercareMutation(supabase, orderId, 'replacement', 'START_NEW', request,
    async (key, immutable) => {
      const payload = immutable as unknown as ReplacementMutationRequest;
      if (!Array.isArray(payload.items) || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب الاستبدال المحفوظ غير صالح.');
      }
      return await supabase.rpc('settle_sales_replacement_v1', {
          p_order_id: orderId,
      p_idempotency_key: key,
        p_items: payload.items,
        p_reason: payload.reason,
        p_notes: payload.notes,
      });
    })
    .then(({data, error}) => ({success: data?.success === true, data, error: error?.message}));
}

export async function settleAdminReturn(input: {
  orderId: string;
  items: ReturnRequestItem[];
  physicalSources: ReturnPhysicalSource[];
  reason: string;
  refundMethod: 'cash' | 'cliq' | null;
  referenceNumber?: string;
  notes?: string;
}) {
  if (!isSupabaseConfigured || !supabase) return unavailable();
  const orderId = input.orderId;
  const request = {
    items: input.items,
    physicalSources: input.physicalSources,
    reason: input.reason.trim(),
    refundMethod: input.refundMethod,
    referenceNumber: input.referenceNumber?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  return runAdminAftercareMutation(supabase, orderId, 'return', 'START_NEW', request,
    async (key, immutable) => {
      const payload = immutable as unknown as ReturnMutationRequest;
      if (!Array.isArray(payload.items) || !Array.isArray(payload.physicalSources)
        || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب المرتجع المحفوظ غير صالح.');
      }
      return await supabase.rpc('settle_admin_sales_return_v1', {
      p_order_id: orderId,
      p_idempotency_key: key,
        p_items: payload.items,
        p_physical_sources: payload.physicalSources,
        p_reason: payload.reason,
        p_refund_method: payload.refundMethod,
        p_reference_number: payload.referenceNumber,
        p_notes: payload.notes,
      });
    })
    .then(({data, error}) => ({success: data?.success === true, data, error: error?.message}));
}

export async function fetchAdminAftercareRecoveryStates(
  orderId: string,
): Promise<Partial<Record<AdminAftercareAction, AdminAftercareRecoveryState>>> {
  if (!isSupabaseConfigured || !supabase) return {};
  const [returnState, replacementState] = await Promise.all([
    readAdminAftercareRecoveryState(supabase, orderId, 'return'),
    readAdminAftercareRecoveryState(supabase, orderId, 'replacement'),
  ]);
  return {
    ...(returnState ? {return: returnState} : {}),
    ...(replacementState ? {replacement: replacementState} : {}),
  };
}

export async function recoverAdminAftercare(
  orderId: string,
  action: AdminAftercareAction,
) {
  if (!isSupabaseConfigured || !supabase) return unavailable();
  return runAdminAftercareMutation(supabase, orderId, action, 'RECOVER_EXISTING', null,
    async (key, immutable) => {
      if (action === 'replacement') {
        const payload = immutable as unknown as ReplacementMutationRequest;
        if (!Array.isArray(payload.items) || typeof payload.reason !== 'string') {
          throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب الاستبدال المحفوظ غير صالح.');
        }
        return await supabase.rpc('settle_sales_replacement_v1', {
          p_order_id: orderId, p_idempotency_key: key,
          p_items: payload.items, p_reason: payload.reason, p_notes: payload.notes,
        });
      }
      const payload = immutable as unknown as ReturnMutationRequest;
      if (!Array.isArray(payload.items) || !Array.isArray(payload.physicalSources)
        || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب المرتجع المحفوظ غير صالح.');
      }
      return await supabase.rpc('settle_admin_sales_return_v1', {
        p_order_id: orderId, p_idempotency_key: key,
        p_items: payload.items, p_physical_sources: payload.physicalSources,
        p_reason: payload.reason, p_refund_method: payload.refundMethod,
        p_reference_number: payload.referenceNumber, p_notes: payload.notes,
      });
    })
    .then(({data, error}) => ({success: data?.success === true, data, error: error?.message}));
}
