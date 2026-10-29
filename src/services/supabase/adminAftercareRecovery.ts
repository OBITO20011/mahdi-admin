import type { SupabaseClient } from '@supabase/supabase-js';
import { withAdminActionLock } from './adminCustomerV2Lifecycle';
import {aftercare215Actions,aftercare215SuccessMatches,type Aftercare215Action} from '../../utils/aftercare215Contracts';
import {claimAftercareFence,finishAftercareFence,readAftercareFence} from './adminAftercareFence';
import {assertAftercare215Request} from './aftercare215Rpc';

export type AdminAftercareAction = 'return' | 'replacement' | Aftercare215Action;
export const adminAftercareActions:readonly AdminAftercareAction[]=['return','replacement',...aftercare215Actions];
const modern=(action:AdminAftercareAction):action is Aftercare215Action=>(aftercare215Actions as readonly string[]).includes(action);
export type AdminAftercareIntent = 'START_NEW' | 'RECOVER_EXISTING';
type AttemptStatus = 'PREPARED' | 'IN_FLIGHT' | 'OUTCOME_UNKNOWN' |
  'DEFINITIVELY_REJECTED' | 'SUCCEEDED';

interface AftercareAttempt {
  version: 2;
  actorId: string;
  orderId: string;
  action: AdminAftercareAction;
  intentId: string;
  attemptId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: Record<string, unknown>;
  status: AttemptStatus;
  generation: number;
  hadUnknownOutcome: boolean;
  result?: Record<string, unknown>;
}

export interface AdminAftercareRecoveryState {
  action: AdminAftercareAction;
  status: AttemptStatus;
  intentId: string;
  attemptId: string;
  generation: number;
  recoverable: boolean;
}

const definitiveRejections: Record<'return'|'replacement', ReadonlySet<string>> = {
  replacement: new Set([
    'PARCEL209_REPLACEMENT_WHOLE_PARCEL_REQUIRED',
    'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED', 'PHASE4_REPLACEMENT_WINDOW_INVALID',
    'PHASE43_ORDER_NOT_FOUND', 'PHASE43_ORIGINAL_SALE_INVALID',
    'PHASE43_REPLACEMENT_INVENTORY_UNAVAILABLE', 'PHASE43_REPLACEMENT_ITEM_INVALID',
    'PHASE43_REPLACEMENT_REQUEST_INVALID', 'PHASE43_REPLACEMENT_SOURCE_DUPLICATE',
    'PHASE43_REPLACEMENT_SOURCE_INVALID', 'PHASE43_SALE_CONTRACT_UNSUPPORTED',
  ]),
  return: new Set([
    'PHASE4_LOGICAL_QUANTITY_ALREADY_CONSUMED', 'PHASE4_PARCEL_RETURN_ALREADY_CONSUMED',
    'PHASE4_RETURN_WINDOW_EXPIRED',
    'PACKAGE_D_CARTON_DAMAGE_PRICE_MISSING', 'PACKAGE_D_CARTON_INSPECTION_INVALID',
    'PACKAGE_D_CARTON_DAMAGE_INSPECT_ONE', 'PACKAGE_D_WHOLE_SINGLE_SKU_PARCEL_REQUIRED',
    'PHASE42_BASE_RETURN_ITEM_INVALID', 'PHASE42_BASE_SALE_EVIDENCE_MISSING',
    'PHASE42_CUMULATIVE_ALLOCATION_INVALID', 'PHASE42_FINANCIAL_EVIDENCE_CONTRADICTORY',
    'PHASE42_FINANCIAL_POSITION_UNAVAILABLE', 'PHASE42_HISTORICAL_COST_MISSING',
    'PHASE42_OPERATIONAL_EFFECTS_INCOMPLETE', 'PHASE42_OPERATIONAL_EFFECTS_INVALID',
    'PHASE42_ORDER_ITEM_INVALID', 'PHASE42_ORIGINAL_SALE_INVALID',
    'PHASE42_PARCEL_COMPONENT_EVIDENCE_INVALID', 'PHASE42_PARCEL_COMPONENT_INVALID',
    'PHASE42_PARCEL_INSPECTION_INCOMPLETE', 'PHASE42_PARCEL_INSPECTION_INVALID',
    'PHASE42_PARCEL_RETURN_ITEM_INVALID', 'PHASE42_PARCEL_SALE_EVIDENCE_MISSING',
    'PHASE42_REFUND_METHOD_INVALID', 'PHASE42_RETURN_IDENTITY_DUPLICATE',
    'PHASE42_RETURN_ITEM_INVALID', 'PHASE42_RETURN_PRODUCT_NOT_FOUND',
    'PHASE42_RETURN_PRODUCTS_UNPROVEN', 'PHASE42_RETURN_REQUEST_INVALID',
    'PHASE42_RETURN_SCOPE_INVALID', 'PHASE42_SALE_CONTRACT_UNSUPPORTED',
    'PHASE43_RETURN_ALLOCATION_MISMATCH', 'PHASE43_RETURN_INSPECTION_EVIDENCE_MISMATCH',
    'PHASE43_RETURN_LINEAGE_INVALID', 'PHASE43_RETURN_LINEAGE_QUANTITY_INVALID',
    'PHASE43_RETURN_PHYSICAL_EVIDENCE_MISMATCH', 'PHASE43_RETURN_PHYSICAL_LINEAGE_REQUIRED',
    'PHASE43_RETURN_PHYSICAL_SOURCE_DUPLICATE', 'PHASE43_RETURN_PHYSICAL_SOURCE_INVALID',
    'PHASE43_RETURN_PHYSICAL_SOURCES_INVALID', 'PHASE43_RETURN_RESTOCK_LINEAGE_INCOMPLETE',
  ]),
};
const modernRejections=new Set([
  'AFTERCARE215_PREVIEW_REQUIRED','AFTERCARE215_PREVIEW_CHANGED','AFTERCARE215_REQUEST_INVALID',
  'AFTERCARE215_INSPECTION_INVALID','AFTERCARE215_DUPLICATE_SOURCE','AFTERCARE215_ORDER_REQUIRED',
  'AFTERCARE215_ORDER_UNAVAILABLE','AFTERCARE215_HISTORICAL_SOURCE_UNAVAILABLE','AFTERCARE215_CURRENT_COST_UNAVAILABLE',
  'AFTERCARE215_WHOLE_PARCEL_INSPECTION_REQUIRED','AFTERCARE215_RETURN_REQUEST_INVALID',
  'AFTERCARE215_REFUND_METHOD_REQUIRED','AFTERCARE215_REFUND_METHOD_INVALID','AFTERCARE215_OPEN_SHIFT_REQUIRED',
  'AFTERCARE215_REFERENCE_REQUIRED','AFTERCARE215_EXCHANGE_REQUEST_INVALID','AFTERCARE215_EXCHANGE_DEBT_UNSUPPORTED',
  'AFTERCARE215_EXCHANGE_PRODUCT_INVALID','AFTERCARE215_EXCHANGE_WHOLE_PARCEL_REQUIRED',
  'AFTERCARE215_EXCHANGE_REPLACEMENT_INVALID','AFTERCARE215_DIFFERENCE_METHOD_REQUIRED',
  'SUPPLIER_REPLACEMENT_SUPPLIER_INVALID','SUPPLIER_REPLACEMENT_RETURN_ASSIGNMENTS_INVALID',
]);
// These SQLSTATEs are emitted by validated Phase-4 request/business guards. A
// matching response proves that the PostgreSQL statement aborted, so there is
// no commit to recover. Serialization/deadlock/transport failures deliberately
// remain outside this set because they require same-attempt recovery.
const definitiveRejectionSqlStates = new Set(['P0001', '22023', '23503', '23514']);

const prefix = 'nawasrah:admin:phase43-aftercare:v2:';
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonicalize = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonicalize)
  : isObject(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonicalize(entry)]))
    : value;
const canonicalString = (value: unknown) => JSON.stringify(canonicalize(value));
const sameRequest = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  canonicalString(left) === canonicalString(right);
const isStatus = (value: unknown): value is AttemptStatus => typeof value === 'string'
  && ['PREPARED', 'IN_FLIGHT', 'OUTCOME_UNKNOWN', 'DEFINITIVELY_REJECTED', 'SUCCEEDED']
    .includes(value);
const isAttempt = (value: unknown): value is AftercareAttempt => isObject(value)
  && value.version === 2 && typeof value.actorId === 'string'
  && typeof value.orderId === 'string'
  && adminAftercareActions.includes(value.action as AdminAftercareAction)
  && typeof value.intentId === 'string' && typeof value.attemptId === 'string'
  && typeof value.idempotencyKey === 'string' && typeof value.requestFingerprint === 'string'
  && isObject(value.request) && isStatus(value.status)
  && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0
  && typeof value.hadUnknownOutcome === 'boolean'
  && (value.result === undefined || isObject(value.result));
const extractIdentity = (message: unknown) => typeof message === 'string'
  ? message.match(/^([A-Z][A-Z0-9_]{4,}):/u)?.[1] || null
  : null;
const isDefinitiveRejection = (
  action: AdminAftercareAction,
  error: unknown,
  data: unknown,
) => {
  if (data !== null || !isObject(error) || typeof error.code !== 'string') return false;
  const identity = modern(action)&&typeof error.message==='string'
    ? error.message.match(/^([A-Z][A-Z0-9_]{4,})(?::|$)/u)?.[1]??null
    : extractIdentity(error.message);
  // Named209 guard rolls back before writes; other serialization failures keep recovery.
  if(error.code==='40001'&&identity==='PARCEL209_FAMILY_CHANGED_RETRY')return true;
  if(modern(action))return error.code==='42501'||identity!==null&&definitiveRejectionSqlStates.has(error.code)
    &&(modernRejections.has(identity)||definitiveRejections.return.has(identity)||definitiveRejections.replacement.has(identity));
  return identity !== null && definitiveRejectionSqlStates.has(error.code)
    && definitiveRejections[action].has(identity);
};
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const nonNegativeMinor = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const returnFinancialsMatch = (
  request: Record<string, unknown>,
  value: Record<string, unknown>,
) => {
  if (!nonNegativeMinor(value.merchandiseEntitlementInMinorUnits)
    || !nonNegativeMinor(value.debtReductionInMinorUnits)
    || !nonNegativeMinor(value.moneyRefundInMinorUnits)) return false;
  const entitlement = Number(value.merchandiseEntitlementInMinorUnits);
  const debtReduction = Number(value.debtReductionInMinorUnits);
  const moneyRefund = Number(value.moneyRefundInMinorUnits);
  if (debtReduction > entitlement || moneyRefund !== entitlement - debtReduction) return false;

  const requestedMethod = request.refundMethod;
  const requestedReference = request.referenceNumber;
  if (moneyRefund === 0) {
    return requestedMethod === null && requestedReference === null && value.refundMethod === null;
  }
  if (requestedMethod !== 'cash' && requestedMethod !== 'cliq') return false;
  if (value.refundMethod !== requestedMethod) return false;
  if (requestedMethod === 'cash') return requestedReference === null;
  return typeof requestedReference === 'string'
    && requestedReference.length > 0 && requestedReference.length <= 120;
};
const replacementQuantity = (request: Record<string, unknown>) => {
  if (!Array.isArray(request.items) || request.items.length === 0) return null;
  let total = 0;
  for (const item of request.items) {
    if (!isObject(item) || !Number.isSafeInteger(item.quantity) || Number(item.quantity) <= 0) {
      return null;
    }
    total += Number(item.quantity);
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
};

const successMatches = (
  action: AdminAftercareAction,
  orderId: string,
  request: Record<string, unknown>,
  value: unknown,
): value is Record<string, unknown> => {
  if(modern(action))return aftercare215SuccessMatches(action,orderId,request,value);
  if (!isObject(value) || value.success !== true || value.orderId !== orderId
    || !uuid(value.operationId)) return false;
  if (action === 'replacement') {
    const expectedQuantity = replacementQuantity(request);
    return expectedQuantity !== null && uuid(value.replacementId)
      && value.operationalCoordinatorVersion === 403
      && value.issuedQuantity === expectedQuantity
      && nonNegativeMinor(value.replacementCogsInMinorUnits)
      && value.moneyRefundInMinorUnits === 0 && value.debtReductionInMinorUnits === 0;
  }
  return uuid(value.returnId)
    && typeof value.returnNumber === 'string' && value.returnNumber.length > 0
    && value.deliveryRefundInMinorUnits === 0 && value.taxRefundInMinorUnits === 0
    && returnFinancialsMatch(request, value);
};

const nextIdentity = () => {
  if (typeof crypto?.randomUUID !== 'function') {
    throw new Error('AFTERCARE_IDENTITY_UNAVAILABLE: لا يمكن إنشاء هوية محاولة آمنة.');
  }
  return crypto.randomUUID();
};
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
const fingerprintRequest = (request: Record<string, unknown>) => sha256(canonicalString(request));
const buildKey = async (
  actorId: string,
  orderId: string,
  action: string,
  intentId: string,
  attemptId: string,
) => `phase43:${await sha256(
  `phase43-aftercare:${actorId}:${orderId}:${action}:${intentId}:${attemptId}`,
)}`;
const save = (key: string, attempt: AftercareAttempt) => {
  const serialized = JSON.stringify(attempt);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('AFTERCARE_RECOVERY_PERSIST_FAILED: تعذر تثبيت هوية المحاولة.');
  }
};
const reviewRequired = () => new Error(
  'AFTERCARE_REVIEW_REQUIRED: أدلة المحاولة المحلية غير متطابقة. حدّث سياق الطلب قبل أي إجراء.',
);
const storageKeyFor = (
  actorId: string,
  orderId: string,
  action: AdminAftercareAction,
) => `${prefix}${actorId}:${orderId}:${action}`;

async function validateAttempt(
  value: unknown,
  actorId: string,
  orderId: string,
  action: AdminAftercareAction,
): Promise<AftercareAttempt> {
  if (!isAttempt(value) || value.actorId !== actorId || value.orderId !== orderId
    || value.action !== action || !uuid(value.intentId) || !uuid(value.attemptId)
    || value.idempotencyKey !== await buildKey(
      actorId, orderId, action, value.intentId, value.attemptId,
    )
    || value.requestFingerprint !== await fingerprintRequest(value.request)) {
    throw reviewRequired();
  }
  if (value.status === 'PREPARED' && (value.generation !== 0 || value.result !== undefined)) {
    throw reviewRequired();
  }
  if (value.status === 'PREPARED' && value.hadUnknownOutcome) throw reviewRequired();
  if (value.status === 'DEFINITIVELY_REJECTED' && value.hadUnknownOutcome) {
    throw reviewRequired();
  }
  if (value.status === 'OUTCOME_UNKNOWN' && !value.hadUnknownOutcome) throw reviewRequired();
  if (value.status === 'IN_FLIGHT' && value.generation > 1 && !value.hadUnknownOutcome) {
    throw reviewRequired();
  }
  if (value.status === 'SUCCEEDED'
    && !successMatches(action, orderId, value.request, value.result)) {
    throw reviewRequired();
  }
  if (value.status !== 'SUCCEEDED' && value.result !== undefined) throw reviewRequired();
  if (['IN_FLIGHT', 'OUTCOME_UNKNOWN', 'DEFINITIVELY_REJECTED', 'SUCCEEDED'].includes(value.status)
    && value.generation < 1) throw reviewRequired();
  return value;
}

const sameImmutableIdentity = (left: AftercareAttempt, right: AftercareAttempt) =>
  left.version === right.version && left.actorId === right.actorId
  && left.orderId === right.orderId && left.action === right.action
  && left.intentId === right.intentId && left.attemptId === right.attemptId
  && left.idempotencyKey === right.idempotencyKey
  && left.requestFingerprint === right.requestFingerprint
  && sameRequest(left.request, right.request);
const sameAttemptIdentity = (left: AftercareAttempt, right: AftercareAttempt) =>
  sameImmutableIdentity(left, right) && left.generation === right.generation;
const completedSameAttempt = (fresh: AftercareAttempt, sent: AftercareAttempt) =>
  fresh.status === 'SUCCEEDED' && sameImmutableIdentity(fresh, sent)
  && fresh.generation <= sent.generation
  && successMatches(fresh.action, fresh.orderId, sent.request, fresh.result);

async function currentActor(client: SupabaseClient) {
  const auth = await client.auth.getUser();
  const actorId = auth.data.user?.id;
  if (auth.error || !actorId) throw new Error('تعذر التحقق من المستخدم الحالي.');
  return actorId;
}

export async function readAdminAftercareRecoveryState(
  client: SupabaseClient,
  orderId: string,
  action: AdminAftercareAction,
): Promise<AdminAftercareRecoveryState | null> {
  if (typeof localStorage === 'undefined') return null;
  const actorId = await currentActor(client);
  const fence=await readAftercareFence(actorId,orderId);
  const raw = localStorage.getItem(storageKeyFor(actorId, orderId, action));
  if (raw === null) {
    if(fence?.status==='pending'&&fence.action===action)throw reviewRequired();
    return null;
  }
  const attempt = await validateAttempt(JSON.parse(raw), actorId, orderId, action);
  if(fence?.status==='pending'&&fence.action===action&&(['attemptId','idempotencyKey','requestFingerprint'] as const).some(k=>fence[k]!==attempt[k]))throw reviewRequired();
  return {
    action, status: attempt.status, intentId: attempt.intentId,
    attemptId: attempt.attemptId, generation: attempt.generation,
    recoverable: ['IN_FLIGHT', 'OUTCOME_UNKNOWN'].includes(attempt.status),
  };
}

export async function runAdminAftercareMutation(
  client: SupabaseClient,
  orderId: string,
  action: AdminAftercareAction,
  intent: AdminAftercareIntent,
  submittedRequest: Record<string, unknown> | null,
  invoke: (
    idempotencyKey: string,
    immutableRequest: Record<string, unknown>,
  ) => Promise<{data: unknown; error: any}>,
): Promise<{data: Record<string, unknown> | null; error: any}> {
  // Capture caller-owned data before authentication, Web Lock acquisition, or
  // any other await. The persisted identity and the RPC receive this snapshot.
  const capturedRequest = submittedRequest === null ? null : structuredClone(submittedRequest);
  if(modern(action)&&capturedRequest!==null)assertAftercare215Request(action,orderId,capturedRequest);
  if (typeof localStorage === 'undefined') {
    throw new Error('AFTERCARE_RECOVERY_UNAVAILABLE: التخزين المحلي مطلوب للتعافي الآمن.');
  }
  const actorId = await currentActor(client);
  const storageKey = storageKeyFor(actorId, orderId, action);
  const lockName = `${prefix}lock:${actorId}:${orderId}:all-actions`;

  return withAdminActionLock(lockName, async () => {
    const lockedActor = await currentActor(client);
    if (lockedActor !== actorId) throw reviewRequired();
    const fence=await readAftercareFence(actorId,orderId);
    if(fence?.status==='pending'&&(intent==='START_NEW'||fence.action!==action)){
      throw new Error('AFTERCARE_OUTCOME_UNKNOWN: استعد المحاولة السابقة قبل بدء إجراء جديد.');
    }
    // Import old pending records conservatively. A corrupt/foreign record stops
    // the operation; it is never discarded to make a new attempt possible.
    for(const other of adminAftercareActions){
      if(other===action)continue;
      const rawOther=localStorage.getItem(storageKeyFor(actorId,orderId,other));
      if(rawOther===null)continue;
      const previous=await validateAttempt(JSON.parse(rawOther),actorId,orderId,other);
      if(['IN_FLIGHT','OUTCOME_UNKNOWN'].includes(previous.status))throw new Error('AFTERCARE_OUTCOME_UNKNOWN: استعد المحاولة السابقة قبل تغيير نوع العملية.');
    }
    let attempt!: AftercareAttempt;
    let previousObservation: AftercareAttempt | null | undefined;
    // A granted Web Lock does not flush WebKit's localStorage snapshot. Re-read
    // at most twice on a pre-write CAS change, never retry the business RPC.
    for (let decision = 0; decision < 3; decision += 1) {
      const raw = localStorage.getItem(storageKey);
      let existing: AftercareAttempt | null = null;

      if (intent === 'RECOVER_EXISTING') {
        if (raw === null) {
          throw new Error('AFTERCARE_RECOVERY_NOT_FOUND: لا توجد محاولة معلقة للتعافي.');
        }
        attempt = await validateAttempt(JSON.parse(raw), actorId, orderId, action);
        if(modern(action))assertAftercare215Request(action,orderId,attempt.request);
        if(fence?.status==='pending'&&(['attemptId','idempotencyKey','requestFingerprint'] as const).some(k=>fence[k]!==attempt[k]))throw reviewRequired();
        existing = attempt;
        if (previousObservation !== undefined && (previousObservation === null
          || !sameAttemptIdentity(existing, previousObservation))) throw reviewRequired();
        if (capturedRequest !== null && !sameRequest(attempt.request, capturedRequest)) {
          throw reviewRequired();
        }
        if (!['IN_FLIGHT', 'OUTCOME_UNKNOWN'].includes(attempt.status)&&!(modern(action)&&attempt.status==='SUCCEEDED')) {
          if (attempt.status === 'SUCCEEDED') {
            if(fence?.status==='pending')await finishAftercareFence(attempt);
            return {data: attempt.result!, error: null};
          }
          throw new Error('AFTERCARE_RECOVERY_NOT_AVAILABLE: المحاولة الحالية ليست معلقة.');
        }
      } else {
        if (!isObject(capturedRequest)) throw reviewRequired();
        if (raw !== null) {
          const previous = await validateAttempt(JSON.parse(raw), actorId, orderId, action);
          existing = previous;
          if (['IN_FLIGHT', 'OUTCOME_UNKNOWN'].includes(previous.status)) {
            throw new Error('AFTERCARE_OUTCOME_UNKNOWN: عالج المحاولة السابقة قبل بدء إجراء جديد.');
          }
        }
        if (previousObservation !== undefined && (existing === null
          ? previousObservation !== null
          : previousObservation === null || !sameAttemptIdentity(existing, previousObservation))) {
          throw reviewRequired();
        }
        const request = capturedRequest;
        const intentId = nextIdentity();
        const attemptId = nextIdentity();
        attempt = {
          version: 2, actorId, orderId, action, intentId, attemptId,
          idempotencyKey: await buildKey(actorId, orderId, action, intentId, attemptId),
          requestFingerprint: await fingerprintRequest(request), request,
          status: 'PREPARED', generation: 0, hadUnknownOutcome: false,
        };
      }

      if (localStorage.getItem(storageKey) !== raw) {
        if (decision === 2) throw reviewRequired();
        previousObservation = existing;
        continue;
      }
      // New coordinators re-prove a saved success by replaying the same server
      // key. Local cached results alone cannot authorize a second operation.
      const {result:_previousResult,...pendingAttempt}=attempt;
      attempt = {...pendingAttempt, status: 'IN_FLIGHT', generation: attempt.generation + 1,
        hadUnknownOutcome: attempt.hadUnknownOutcome
          || attempt.status === 'IN_FLIGHT' || attempt.status === 'OUTCOME_UNKNOWN'||modern(action)&&attempt.status==='SUCCEEDED'};
      save(storageKey, attempt);
      break;
    }
    const sentAttempt = structuredClone(attempt);
    await claimAftercareFence(sentAttempt);

    let response: {data: unknown; error: any};
    try {
      if(await currentActor(client)!==actorId)throw reviewRequired();
      response = await invoke(attempt.idempotencyKey, structuredClone(attempt.request));
    } catch (error) {
      const fresh = await validateAttempt(JSON.parse(localStorage.getItem(storageKey) || 'null'),
        actorId, orderId, action);
      if (completedSameAttempt(fresh, sentAttempt)) {await finishAftercareFence(sentAttempt);return {data: fresh.result!, error: null};}
      if (!sameAttemptIdentity(fresh, sentAttempt)) throw reviewRequired();
      if (fresh.status !== 'IN_FLIGHT') throw reviewRequired();
      save(storageKey, {...fresh, status: 'OUTCOME_UNKNOWN', hadUnknownOutcome: true});
      throw error;
    }

    const fresh = await validateAttempt(JSON.parse(localStorage.getItem(storageKey) || 'null'),
      actorId, orderId, action);
    if (completedSameAttempt(fresh, sentAttempt)) {await finishAftercareFence(sentAttempt);return {data: fresh.result!, error: null};}
    if (!sameAttemptIdentity(fresh, sentAttempt)) throw reviewRequired();
    if (fresh.status !== 'IN_FLIGHT') throw reviewRequired();
    if (!response.error && successMatches(action, orderId, fresh.request, response.data)) {
      const result = structuredClone(response.data);
      save(storageKey, {...fresh, status: 'SUCCEEDED', result});
      await finishAftercareFence(sentAttempt);
      return {data: result, error: null};
    }
    if (response.error) {
      const canReject = !fresh.hadUnknownOutcome && response.data === null
        && isDefinitiveRejection(action, response.error, response.data);
      save(storageKey, {...fresh,
        status: canReject ? 'DEFINITIVELY_REJECTED' : 'OUTCOME_UNKNOWN',
        hadUnknownOutcome: fresh.hadUnknownOutcome || !canReject});
      if(canReject)await finishAftercareFence(sentAttempt);
      return {data: null, error: response.error};
    }
    save(storageKey, {...fresh, status: 'OUTCOME_UNKNOWN', hadUnknownOutcome: true});
    return {data: null, error: {message:
      'AFTERCARE_RESPONSE_INVALID: وصل رد غير مكتمل؛ أعد نفس المحاولة للتعافي.'}};
  });
}
