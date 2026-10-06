import type {SupabaseClient} from '@supabase/supabase-js';
import {withAdminActionLock} from './adminCustomerV2Lifecycle';
import {submitPosSaleV2WithRpc, type CreatePosSaleV2Input, type CreatePosSaleV2Outcome} from './posV2.service';
import {posV2ResultMatches, posV2RequestValid} from './posV2Validation';

type Status = 'PREPARED' | 'IN_FLIGHT' | 'OUTCOME_UNKNOWN' | 'SUCCEEDED' | 'DEFINITIVELY_REJECTED';
interface Attempt {
  version: 1; actorId: string; attemptId: string; fingerprint: string;
  request: CreatePosSaleV2Input; status: Status; generation: number; hadUnknown: boolean;
  result?: Extract<CreatePosSaleV2Outcome, {ok: true}>['data'];
  rejectionIdentity?: string;
}
const prefix = 'nawasrah:pos-v2:attempt:v1:';
const rejectionIdentities = new Set([
  'CONFIGURABLE_PARCEL_DISABLED', 'PARCEL_CONFIGURATION_STALE', 'PARCEL_CAPACITY_MISMATCH',
  'PARCEL_COMPONENT_FAMILY_MISMATCH', 'PARCEL_COMPONENT_NOT_ALLOWED', 'PARCEL_COMPONENT_NOT_STOCKED',
  'PHASE3_POS_INSUFFICIENT_INVENTORY', 'PHASE3_POS_OPEN_SHIFT_REQUIRED', 'PHASE3_POS_LOCATION_INVALID',
  'PHASE3_POS_CUSTOMER_INVALID', 'PHASE3_POS_DEBT_CUSTOMER_REQUIRED', 'PHASE3_POS_PRODUCT_INVALID',
  'PHASE3_POS_PRICE_OR_PACKAGE_STALE', 'PHASE3_POS_DISCOUNT_EXCEEDS_SUBTOTAL', 'PHASE3_POS_TENDER_INSUFFICIENT',
]);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, x]) => [k, canonical(x)])) : v;
const encoded = (v: unknown) => JSON.stringify(canonical(v));
const digest = async (v: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(encoded(v)))), b => b.toString(16).padStart(2, '0')).join('');
const review = () => new Error('POS_V2_RECOVERY_REVIEW_REQUIRED: تعذر إثبات هوية محاولة البيع. استرجع المحاولة الأصلية ولا تبدأ بيعاً آخر.');
const persist = (key: string, attempt: Attempt, expected: string | null) => {
  if (localStorage.getItem(key) !== expected) throw review();
  const raw = JSON.stringify(attempt); localStorage.setItem(key, raw);
  if (localStorage.getItem(key) !== raw) throw review();
  return raw;
};
async function validate(raw: string, actorId: string): Promise<Attempt> {
  const a = JSON.parse(raw) as Attempt;
  if (!a || a.version !== 1 || a.actorId !== actorId || typeof a.attemptId !== 'string'
    || !posV2RequestValid(a.request)
    || !Number.isSafeInteger(a.generation) || a.generation < 0 || typeof a.hadUnknown !== 'boolean'
    || a.fingerprint !== await digest({...a.request, idempotencyKey: undefined})
    || a.request.idempotencyKey !== `pos-v2:${await digest([actorId, a.attemptId, a.fingerprint])}`) throw review();
  if (a.status === 'SUCCEEDED') {
    if (a.generation < 1 || !posV2ResultMatches(a.request, a.result)) throw review();
  } else {
    if (a.result !== undefined) throw review();
    if (a.status === 'PREPARED') { if (a.generation !== 0 || a.hadUnknown) throw review(); }
    else if (a.status === 'IN_FLIGHT') { if (a.generation < 1) throw review(); }
    else if (a.status === 'OUTCOME_UNKNOWN') { if (a.generation < 1 || !a.hadUnknown) throw review(); }
    else if (a.status === 'DEFINITIVELY_REJECTED') {
      if (a.generation < 1 || a.hadUnknown || !rejectionIdentities.has(a.rejectionIdentity || '')) throw review();
    } else throw review();
  }
  return a;
}
export function readPosV2Recovery(actorId: string): {status: Status; request: CreatePosSaleV2Input} | null {
  const raw = localStorage.getItem(prefix + actorId);
  if (raw === null) return null;
  // This is only an affordance. Execution independently validates every identity.
  const a = JSON.parse(raw) as Attempt;
  if (!a || a.actorId !== actorId || a.version !== 1) throw review();
  return {status: a.status, request: structuredClone(a.request)};
}
export async function runPosV2Attempt(
  client: SupabaseClient, actorId: string, intent: 'START_NEW' | 'RECOVER_EXISTING',
  request?: CreatePosSaleV2Input,
): Promise<CreatePosSaleV2Outcome> {
  // Copy before auth, hashing, lock wait or any other asynchronous boundary.
  const captured = request && structuredClone(request);
  if (intent === 'START_NEW' && !posV2RequestValid(captured)) throw review();
  const storageKey = prefix + actorId;
  const observedRaw = localStorage.getItem(storageKey);
  const auth = await client.auth.getUser();
  if (auth.error || auth.data.user?.id !== actorId) throw review();
  return withAdminActionLock(prefix + 'lock:' + actorId, async () => {
    const lockedAuth = await client.auth.getUser();
    if (lockedAuth.error || lockedAuth.data.user?.id !== actorId) throw review();
    let raw = localStorage.getItem(storageKey);
    let a = raw === null ? null : await validate(raw, actorId);
    if (intent === 'START_NEW') {
      if (!captured || raw !== observedRaw || (a && !['SUCCEEDED', 'DEFINITIVELY_REJECTED'].includes(a.status))) throw review();
      const attemptId = crypto.randomUUID();
      const fingerprint = await digest({...captured, idempotencyKey: undefined});
      const key = `pos-v2:${await digest([actorId, attemptId, fingerprint])}`;
      a = {version: 1, actorId, attemptId, fingerprint, request: {...captured, idempotencyKey: key},
        status: 'PREPARED', generation: 0, hadUnknown: false};
      raw = persist(storageKey, a, raw);
    } else if (!a) throw review();
    if (!a) throw review();
    const before = {...a};
    a = {...a, status: 'IN_FLIGHT', generation: a.generation + 1,
      result: undefined, rejectionIdentity: undefined,
      hadUnknown: a.hadUnknown || a.status === 'IN_FLIGHT' || a.status === 'OUTCOME_UNKNOWN'};
    raw = persist(storageKey, a, raw);
    const outcome = await submitPosSaleV2WithRpc(a.request,
      (name, parameters) => client.rpc(name, parameters));
    const current = localStorage.getItem(storageKey);
    if (current !== raw) throw review();
    await validate(raw, actorId);
    if (localStorage.getItem(storageKey) !== raw) throw review();
    if (outcome.ok === true) {
      if (before.result && encoded(before.result) !== encoded({...outcome.data, idempotentReplay: before.result.idempotentReplay})) throw review();
      persist(storageKey, {...a, status: 'SUCCEEDED', result: outcome.data, rejectionIdentity: undefined}, raw);
      return outcome;
    }
    const definitive = !a.hadUnknown && ['P0001', '22023'].includes(outcome.rejectionCode || '')
      && rejectionIdentities.has(outcome.errorIdentity);
    persist(storageKey, {...a, status: definitive ? 'DEFINITIVELY_REJECTED' : 'OUTCOME_UNKNOWN',
      hadUnknown: !definitive, rejectionIdentity: definitive ? outcome.errorIdentity : undefined}, raw);
    return definitive ? outcome : {...outcome, status: 'unknown'};
  });
}
