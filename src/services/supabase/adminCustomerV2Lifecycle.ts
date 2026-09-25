import type { SupabaseClient } from '@supabase/supabase-js';

type Action = 'cancel' | 'complete';
type AttemptStatus = 'PREPARED' | 'IN_FLIGHT' | 'SUCCEEDED' |
  'DEFINITIVELY_REJECTED' | 'OUTCOME_UNKNOWN';

interface LegacyPendingAction {
  version: 1; actorId: string; orderId: string; action: Action;
  key: string; request: Record<string, unknown>;
}
interface LifecycleAttempt {
  version: 2; actorId: string; orderId: string; action: Action;
  attemptId: string; key: string; request: Record<string, unknown>;
  status: AttemptStatus; executionGeneration: number; hadUnknownOutcome: boolean;
  result?: Record<string, unknown>; errorIdentity?: string; rejectionCode?: 'P0001';
}

const pendingPrefix = 'nawasrah:admin:customer-v2-lifecycle:v1:';
const adminActionLockWaitMs = 5_000;
const definitiveRejections: Record<Action, ReadonlySet<string>> = {
  complete: new Set([
    'PHASE3_CUSTOMER_SETTLEMENT_INVALID',
    'PHASE3_CUSTOMER_ORDER_NOT_FOUND', 'PHASE3_CUSTOMER_LIFECYCLE_CONTRACT_MISMATCH',
    'PHASE3_CUSTOMER_LIFECYCLE_INVALID', 'PHASE3_CUSTOMER_OPEN_SHIFT_REQUIRED',
    'PHASE3_CUSTOMER_RESERVATION_TERMINAL', 'PHASE3_CUSTOMER_RESERVATION_MISMATCH',
    'PHASE3_EXACT_WAC_UNAVAILABLE',
  ]),
  cancel: new Set([
    'PHASE3_CUSTOMER_LIFECYCLE_CONTRACT_MISMATCH',
    'PHASE3_CUSTOMER_LIFECYCLE_INVALID', 'PHASE3_CUSTOMER_RESERVATION_TERMINAL',
    'PHASE3_CUSTOMER_RESERVATION_MISMATCH',
  ]),
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
};
const sameRequest = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
const extractIdentity = (message: unknown): string | null => typeof message === 'string'
  ? message.match(/^([A-Z][A-Z0-9_]{4,}):/u)?.[1] || null : null;
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isAction = (value: unknown): value is Action => value === 'complete' || value === 'cancel';
const isStatus = (value: unknown): value is AttemptStatus => typeof value === 'string' && [
  'PREPARED', 'IN_FLIGHT', 'SUCCEEDED', 'DEFINITIVELY_REJECTED', 'OUTCOME_UNKNOWN',
].includes(value);
const isLegacyAttempt = (value: unknown): value is LegacyPendingAction => isObject(value)
  && value.version === 1 && typeof value.actorId === 'string'
  && typeof value.orderId === 'string' && isAction(value.action)
  && typeof value.key === 'string' && isObject(value.request);
const isCurrentAttempt = (value: unknown): value is LifecycleAttempt => isObject(value)
  && value.version === 2 && typeof value.actorId === 'string'
  && typeof value.orderId === 'string' && isAction(value.action)
  && typeof value.attemptId === 'string' && typeof value.key === 'string'
  && isObject(value.request) && isStatus(value.status)
  && Number.isSafeInteger(value.executionGeneration) && Number(value.executionGeneration) >= 0
  && typeof value.hadUnknownOutcome === 'boolean'
  && (value.result === undefined || isObject(value.result))
  && (value.errorIdentity === undefined || typeof value.errorIdentity === 'string');

const newAttemptId = (): string => {
  if (typeof crypto?.randomUUID !== 'function') {
    throw new Error('لا يمكن إنشاء هوية محاولة آمنة. لا تبدأ العملية.');
  }
  return crypto.randomUUID();
};
async function actionKey(actorId: string, orderId: string, action: Action, attemptId: string) {
  const encoded = new TextEncoder().encode(
    `admin-customer-v2:v2:${actorId}:${orderId}:${action}:${attemptId}`,
  );
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return `admin-v2:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')}`;
}
const persist = (storageKey: string, attempt: LifecycleAttempt): void => {
  const encoded = JSON.stringify(attempt);
  localStorage.setItem(storageKey, encoded);
  if (localStorage.getItem(storageKey) !== encoded) throw new Error('تعذر تثبيت حالة محاولة الطلب.');
};
const minorUnits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const requestIsValid = (action: Action, value: Record<string, unknown>) => action === 'cancel'
  ? Object.keys(value).length === 1 && nullableText(value.reason)
  : Object.keys(value).length === 5 && typeof value.paymentMethod === 'string'
    && ['cash', 'cliq', 'debt'].includes(value.paymentMethod)
    && minorUnits(value.amountCollectedInMinorUnits) && minorUnits(value.deliveryFeeInMinorUnits)
    && nullableText(value.referenceNumber) && nullableText(value.notes);
const responseIsSuccess = (action: Action, orderId: string, value: unknown):
  value is Record<string, unknown> => {
  if (!isObject(value) || value.success !== true || value.order_id !== orderId
    || typeof value.operation_id !== 'string'
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value.operation_id)
    || value.status !== (action === 'complete' ? 'completed' : 'cancelled')) return false;
  if (action === 'cancel') return value.reservation_state === 'cancelled'
    && minorUnits(value.released_reservations);
  if (!minorUnits(value.total_in_minor_units) || !minorUnits(value.amount_paid_in_minor_units)
    || !minorUnits(value.remaining_in_minor_units)) return false;
  return value.total_in_minor_units - value.amount_paid_in_minor_units === value.remaining_in_minor_units
    && value.payment_status === (value.remaining_in_minor_units === 0 ? 'paid'
      : value.amount_paid_in_minor_units > 0 ? 'partially_paid' : 'unpaid')
    && (value.remaining_in_minor_units > 0 || value.amount_paid_in_minor_units === 0
      ? value.payment_method === 'debt' : typeof value.payment_method === 'string'
        && ['cash', 'cliq'].includes(value.payment_method))
    && nullableText(value.customer_payment_number);
};
const reviewRequired = () => new Error(
  'ADMIN_LIFECYCLE_REVIEW_REQUIRED: تغيرت محاولة الطلب أو أدلتها غير متطابقة. راجع حالة الطلب قبل أي إجراء جديد.',
);
// One state/identity boundary for initial reads, post-RPC reads and every write.
async function validateAttempt(value: unknown, actorId: string, orderId: string, action: Action):
Promise<LifecycleAttempt> {
  if (!isCurrentAttempt(value) || value.actorId !== actorId || value.orderId !== orderId
    || value.action !== action || !value.attemptId || !requestIsValid(action, value.request)
    || value.key !== await actionKey(actorId, orderId, action, value.attemptId)) throw reviewRequired();
  const noResult = value.result === undefined;
  switch (value.status) {
    case 'PREPARED':
      if (value.executionGeneration !== 0 || value.hadUnknownOutcome || !noResult
        || value.errorIdentity !== undefined) throw reviewRequired();
      break;
    case 'DEFINITIVELY_REJECTED':
      if (value.executionGeneration < 1 || value.hadUnknownOutcome || !noResult
        || value.rejectionCode !== 'P0001'
        || !value.errorIdentity || !definitiveRejections[action].has(value.errorIdentity)) throw reviewRequired();
      break;
    case 'SUCCEEDED':
      if (value.executionGeneration < 1 || value.errorIdentity !== undefined
        || !responseIsSuccess(action, orderId, value.result)) throw reviewRequired();
      if (action === 'complete' && value.result!.amount_paid_in_minor_units !==
        (value.request.paymentMethod === 'debt' ? 0 : value.request.amountCollectedInMinorUnits)) throw reviewRequired();
      if (action === 'complete' && value.result!.payment_method !==
        (Number(value.result!.remaining_in_minor_units) > 0 || value.result!.amount_paid_in_minor_units === 0
          ? 'debt' : value.request.paymentMethod)) throw reviewRequired();
      break;
    case 'OUTCOME_UNKNOWN':
      if (value.executionGeneration < 1 || !value.hadUnknownOutcome || !noResult) throw reviewRequired();
      break;
    case 'IN_FLIGHT':
      if (value.executionGeneration < 1 || !noResult) throw reviewRequired();
  }
  if (value.status !== 'DEFINITIVELY_REJECTED' && value.rejectionCode !== undefined) throw reviewRequired();
  return value;
}
const sameIdentity = (left: LifecycleAttempt, right: LifecycleAttempt) =>
  left.actorId === right.actorId && left.orderId === right.orderId && left.action === right.action
  && left.attemptId === right.attemptId && left.key === right.key
  && left.executionGeneration === right.executionGeneration && sameRequest(left.request, right.request);
async function readAttempt(storageKey: string, expected: LifecycleAttempt) {
  const raw = localStorage.getItem(storageKey);
  const fresh = await validateAttempt(raw === null ? null : JSON.parse(raw),
    expected.actorId, expected.orderId, expected.action);
  if (localStorage.getItem(storageKey) !== raw || !sameIdentity(fresh, expected)
    || (expected.hadUnknownOutcome && !fresh.hadUnknownOutcome)) throw reviewRequired();
  return {fresh, raw};
}
async function writeAttempt(storageKey: string, value: LifecycleAttempt, expectedRaw: string | null) {
  await validateAttempt(value, value.actorId, value.orderId, value.action);
  if (localStorage.getItem(storageKey) !== expectedRaw) throw reviewRequired();
  persist(storageKey, value);
}
const sameCommercialResult = (action: Action, left: Record<string, unknown>, right: Record<string, unknown>) => {
  const fields = action === 'cancel'
    ? ['order_id', 'operation_id', 'status', 'reservation_state', 'released_reservations']
    : ['order_id', 'operation_id', 'status', 'payment_method', 'payment_status',
      'total_in_minor_units', 'amount_paid_in_minor_units', 'remaining_in_minor_units', 'customer_payment_number'];
  return fields.every((field) => left[field] === right[field]);
};
const invalidResponse = () => ({
  code: 'ADMIN_LIFECYCLE_RESPONSE_INVALID',
  message: 'ADMIN_LIFECYCLE_RESPONSE_INVALID: وصل رد غير مكتمل. تحقق من حالة الطلب قبل المحاولة مجددًا.',
});
const lockWaitTimedOut = () => new Error(
  'ADMIN_LIFECYCLE_LOCK_WAIT_TIMEOUT: عملية أخرى ما زالت قيد التنفيذ أو التعافي. لم تبدأ محاولة جديدة؛ انتظر قليلًا ثم أعد المحاولة بنفس البيانات.',
);
const lockUnsupported = () => new Error(
  'ADMIN_LIFECYCLE_LOCK_UNSUPPORTED: المتصفح لا يوفر تنسيقًا آمنًا لانتظار العملية. استخدم متصفحًا محدثًا.',
);
export async function withAdminActionLock<T>(
  lockName: string, work: () => Promise<T>, waitMs = adminActionLockWaitMs,
): Promise<T> {
  const manager = globalThis.navigator?.locks;
  if (!manager || typeof AbortController !== 'function') throw lockUnsupported();
  const controller = new AbortController();
  let granted = false;
  const timer = globalThis.setTimeout(() => controller.abort(), waitMs);
  try {
    return await manager.request(lockName, {signal: controller.signal}, async () => {
      granted = true;
      globalThis.clearTimeout(timer);
      return work();
    });
  } catch (error) {
    if (!granted && controller.signal.aborted) throw lockWaitTimedOut();
    if (!granted && ((error instanceof DOMException && error.name === 'NotSupportedError')
      || error instanceof TypeError)) throw lockUnsupported();
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

// The operation type, not the presence of parcel rows, identifies Customer V2.
export async function isCustomerV2Order(client: SupabaseClient, orderId: string): Promise<boolean> {
  const orderResult = await client.from('orders').select('operation_id').eq('id', orderId).single();
  if (orderResult.error || !orderResult.data) {
    throw new Error(orderResult.error?.message || 'تعذر تحديد نوع الطلب.');
  }
  const operationId = orderResult.data.operation_id;
  if (!operationId) return false;
  const operationResult = await client.from('business_operations')
    .select('operation_type').eq('id', operationId).single();
  if (operationResult.error || !operationResult.data) {
    throw new Error(operationResult.error?.message || 'تعذر تحديد عقد العملية الأصلية.');
  }
  return operationResult.data.operation_type === 'phase3_customer_reservation_v1';
}

export async function runCustomerV2AdminAction(
  client: SupabaseClient, orderId: string, action: Action, request: Record<string, unknown>,
): Promise<{ data: any; error: any }> {
  // Capture the submitted request before the first await; callers cannot mutate it in flight.
  if (!isAction(action) || !requestIsValid(action, request)) throw reviewRequired();
  request = structuredClone(request);
  const auth = await client.auth.getUser();
  const actorId = auth.data.user?.id;
  if (auth.error || !actorId) throw new Error('تعذر التحقق من المستخدم الحالي. أعد تسجيل الدخول.');
  if (typeof localStorage === 'undefined') throw new Error('لا يمكن حفظ هوية المحاولة محليًا. لا تبدأ العملية.');
  const storageKey = `${pendingPrefix}${actorId}:${orderId}:${action}`;
  const lockName = `${pendingPrefix}lock:${actorId}:${orderId}:${action}`;

  return withAdminActionLock(lockName, async () => {
    const lockedAuth = await client.auth.getUser();
    if (lockedAuth.error || lockedAuth.data.user?.id !== actorId) throw reviewRequired();
    let attempt: LifecycleAttempt;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) {
        const attemptId = newAttemptId();
        attempt = {version: 2, actorId, orderId, action, attemptId,
          key: await actionKey(actorId, orderId, action, attemptId), request,
          status: 'PREPARED', executionGeneration: 0, hadUnknownOutcome: false};
      } else {
        const parsed: unknown = JSON.parse(raw);
        if (isLegacyAttempt(parsed)) {
          if (parsed.actorId !== actorId || parsed.orderId !== orderId || parsed.action !== action
            || !sameRequest(parsed.request, request)) {
            throw new Error('المحاولة القديمة لا تملك دليل نتيجة كافيًا. راجع حالة الطلب قبل أي إجراء جديد.');
          }
          // The retained V1 record does not prove how its key was derived.
          // Preserve its bytes rather than minting V2 evidence from a guess.
          throw new Error('المحاولة القديمة لا تملك دليل هوية كافيًا. راجع حالة الطلب قبل أي إجراء جديد.');
        } else {
          attempt = await validateAttempt(parsed, actorId, orderId, action);
        }
      }
      if (localStorage.getItem(storageKey) !== raw) throw reviewRequired();

      if (attempt.status === 'SUCCEEDED') {
        if (!sameRequest(attempt.request, request) || !responseIsSuccess(action, orderId, attempt.result)) {
          throw new Error('الطلب ناجح سابقًا لكن دليل النتيجة غير متطابق. راجع حالة الطلب.');
        }
        return {data: attempt.result, error: null};
      }
      if (attempt.status === 'OUTCOME_UNKNOWN' || attempt.status === 'IN_FLIGHT') {
        if (!sameRequest(attempt.request, request)) {
          throw new Error('نتيجة المحاولة السابقة غير محسومة. لا تغيّر المدخلات أو مفتاح المحاولة.');
        }
        attempt.hadUnknownOutcome = true;
      } else if (attempt.status === 'DEFINITIVELY_REJECTED') {
        const attemptId = newAttemptId();
        attempt = {version: 2, actorId, orderId, action, attemptId,
          key: await actionKey(actorId, orderId, action, attemptId), request,
          status: 'PREPARED', executionGeneration: 0, hadUnknownOutcome: false};
      } else if (!sameRequest(attempt.request, request)) {
        throw new Error('توجد محاولة جارية بمدخلات مختلفة. انتظر نتيجتها أولًا.');
      }

      const executionGeneration = attempt.executionGeneration + 1;
      attempt = {...attempt, status: 'IN_FLIGHT', executionGeneration, rejectionCode: undefined};
      await writeAttempt(storageKey, attempt, raw);
      let result: {data: any; error: any};
      try {
        result = action === 'cancel'
          ? await client.rpc('cancel_customer_order_v2', {p_order_id: orderId,
            p_idempotency_key: attempt.key, p_reason: attempt.request.reason})
          : await client.rpc('complete_website_order_with_settlement_v2', {p_order_id: orderId,
            p_idempotency_key: attempt.key, p_payment_method: attempt.request.paymentMethod,
            p_amount_collected_in_minor_units: attempt.request.amountCollectedInMinorUnits,
            p_delivery_fee_in_minor_units: attempt.request.deliveryFeeInMinorUnits,
            p_reference_number: attempt.request.referenceNumber, p_notes: attempt.request.notes});
      } catch (error) {
        const {fresh, raw: freshRaw} = await readAttempt(storageKey, attempt);
        if (fresh.status === 'SUCCEEDED') return {data: fresh.result, error: null};
        if (fresh.status !== 'IN_FLIGHT') throw reviewRequired();
        await writeAttempt(storageKey, {...fresh, status: 'OUTCOME_UNKNOWN', hadUnknownOutcome: true}, freshRaw);
        throw error;
      }

      const {fresh, raw: freshRaw} = await readAttempt(storageKey, attempt);
      if (fresh.status === 'SUCCEEDED') {
        if (!result.error && responseIsSuccess(action, orderId, result.data)
          && !sameCommercialResult(action, fresh.result!, result.data)) throw reviewRequired();
        return {data: fresh.result, error: null};
      }
      if (fresh.status !== 'IN_FLIGHT') throw reviewRequired();
      if (!result.error && responseIsSuccess(action, orderId, result.data)) {
        await writeAttempt(storageKey, {...fresh, status: 'SUCCEEDED', result: result.data,
          errorIdentity: undefined}, freshRaw);
        return result;
      }
      if (result.error) {
        const identity = extractIdentity(result.error.message);
        const canReject = !fresh.hadUnknownOutcome && result.data === null && result.error.code === 'P0001'
          && identity !== null
          && definitiveRejections[action].has(identity);
        await writeAttempt(storageKey, {...fresh,
          status: canReject ? 'DEFINITIVELY_REJECTED' : 'OUTCOME_UNKNOWN',
          hadUnknownOutcome: fresh.hadUnknownOutcome || !canReject,
          errorIdentity: identity || undefined, rejectionCode: canReject ? 'P0001' : undefined}, freshRaw);
        return result;
      }
      await writeAttempt(storageKey, {...fresh, status: 'OUTCOME_UNKNOWN', hadUnknownOutcome: true,
        errorIdentity: 'ADMIN_LIFECYCLE_RESPONSE_INVALID'}, freshRaw);
      return {data: result.data, error: invalidResponse()};
    } catch (error) {
      throw new Error(error instanceof Error ? error.message :
        'تعذر قراءة محاولة الطلب السابقة بأمان.', {cause: error});
    }
  });
}
