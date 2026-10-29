import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  readAdminAftercareRecoveryState,
  runAdminAftercareMutation,
  type AdminAftercareAction,
  type AdminAftercareRecoveryState,
  adminAftercareActions,
} from './adminAftercareRecovery';
import {aftercare215Actions,type Aftercare215Action} from '../../utils/aftercare215Contracts';
import {invokeAftercare215} from './aftercare215Rpc';

export interface AftercarePhysicalRepresentative {
  sourceKind: 'base_order_item' | 'parcel_component' | 'replacement_item';
  sourceId: string;
  productId: string;
  remainingQuantity: number;
  parentReplacementItemId: string | null;
  unitsPerParcel?: number;
  isSingleSkuParcel?: boolean;
}
export type AdminAftercareCapability =
  | 'phase43_modern'
  | 'legacy_website_return_v1'
  | 'legacy_pos_v1_unsupported'
  | 'unsupported_contract';

interface AdminAftercareBaseItem {
  parcelOnly?: boolean;
  orderItemId: string; productId: string; quantity: number;
  remainingQuantity: number;
  physicalRepresentatives: AftercarePhysicalRepresentative[];
  commercialLineKind?: 'base_unit' | 'legacy_single_sku_parcel';
  unitsPerParcel?: number;
  commercialQuantity?: number;
  standalonePriceInMinorUnits?: number | null;
}
interface AdminAftercareParcelInstance {
  parcelInstanceId: string; orderItemId: string;
  components: Array<{
    parcelOnly?: boolean;
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
  customer_damage_quantity?: number;
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
  const client = supabase;
  if (!isSupabaseConfigured || !client) return unavailable();
  const orderId = input.orderId;
  const request = {items: input.items, reason: input.reason.trim(), notes: input.notes?.trim() || null};
  return runAdminAftercareMutation(client, orderId, 'replacement', 'START_NEW', request,
    async (key, immutable) => {
      const payload = immutable as unknown as ReplacementMutationRequest;
      if (!Array.isArray(payload.items) || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب الاستبدال المحفوظ غير صالح.');
      }
      return await client.rpc('settle_sales_replacement_v1', {
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
  const client = supabase;
  if (!isSupabaseConfigured || !client) return unavailable();
  const orderId = input.orderId;
  const request = {
    items: input.items,
    physicalSources: input.physicalSources,
    reason: input.reason.trim(),
    refundMethod: input.refundMethod,
    referenceNumber: input.referenceNumber?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  return runAdminAftercareMutation(client, orderId, 'return', 'START_NEW', request,
    async (key, immutable) => {
      const payload = immutable as unknown as ReturnMutationRequest;
      if (!Array.isArray(payload.items) || !Array.isArray(payload.physicalSources)
        || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب المرتجع المحفوظ غير صالح.');
      }
      return await client.rpc('settle_admin_sales_return_v1', {
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
  const client=supabase;
  const states=await Promise.all(adminAftercareActions.map(async action=>[action,await readAdminAftercareRecoveryState(client,orderId,action)] as const));
  return Object.fromEntries(states.filter(([,state])=>state!==null));
}

export async function recoverAdminAftercare(
  orderId: string,
  action: AdminAftercareAction,
) {
  const client = supabase;
  if (!isSupabaseConfigured || !client) return unavailable();
  return runAdminAftercareMutation(client, orderId, action, 'RECOVER_EXISTING', null,
    async (key, immutable) => {
      if((aftercare215Actions as readonly string[]).includes(action))return invokeAftercare215(client,action as Aftercare215Action,orderId,key,immutable);
      if (action === 'replacement') {
        const payload = immutable as unknown as ReplacementMutationRequest;
        if (!Array.isArray(payload.items) || typeof payload.reason !== 'string') {
          throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب الاستبدال المحفوظ غير صالح.');
        }
        return await client.rpc('settle_sales_replacement_v1', {
          p_order_id: orderId, p_idempotency_key: key,
          p_items: payload.items, p_reason: payload.reason, p_notes: payload.notes,
        });
      }
      const payload = immutable as unknown as ReturnMutationRequest;
      if (!Array.isArray(payload.items) || !Array.isArray(payload.physicalSources)
        || typeof payload.reason !== 'string') {
        throw new Error('AFTERCARE_REVIEW_REQUIRED: طلب المرتجع المحفوظ غير صالح.');
      }
      return await client.rpc('settle_admin_sales_return_v1', {
        p_order_id: orderId, p_idempotency_key: key,
        p_items: payload.items, p_physical_sources: payload.physicalSources,
        p_reason: payload.reason, p_refund_method: payload.refundMethod,
        p_reference_number: payload.referenceNumber, p_notes: payload.notes,
      });
    })
    .then(({data, error}) => ({success: data?.success === true, data, error: error?.message}));
}
