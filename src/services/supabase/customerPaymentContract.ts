// Inactive Slice5 protocol preparation. No current service/UI imports this
// module. Payload validation is necessary, never proof of server commitment.
export interface CustomerCollectionRequest {
  readonly requestVersion: 'phase5-customer-collection-v2';
  readonly actorId: string;
  readonly orderId: string;
  readonly action: 'customer_collection';
  readonly idempotencyKey: string;
  readonly amountInMinorUnits: string;
  readonly tenderMethod: 'cash' | 'cliq';
  readonly tenderReference: string | null;
  readonly notes: string | null;
}

export interface CustomerCollectionResult extends CustomerCollectionRequest {
  readonly contractVersion: 'phase5-customer-collection-result-v2';
  readonly kind: 'COMMITTED_COLLECTION';
  readonly success: true;
  readonly requestFingerprint: string;
  readonly request: CustomerCollectionRequest;
  readonly operationId: string;
  readonly originalPaymentId: string;
  readonly collectionId: string;
  readonly paymentNumber: string;
  readonly outstandingBeforeInMinorUnits: string;
  readonly outstandingAfterInMinorUnits: string;
}

const requestKeys = ['requestVersion','actorId','orderId','action','idempotencyKey',
  'amountInMinorUnits','tenderMethod','tenderReference','notes'] as const;
const resultKeys = [...requestKeys,'contractVersion','kind','success','requestFingerprint','request',
  'operationId','originalPaymentId','collectionId','paymentNumber',
  'outstandingBeforeInMinorUnits','outstandingAfterInMinorUnits'] as const;
const maximum = 9223372036854775807n;
const trim = (s: string) => s.replace(/^ +| +$/gu,''); // PostgreSQL BTRIM(text).
const invalid = () => new Error('PAYMENT_CONTRACT_INVALID: بيانات محاولة الدفع غير متطابقة.');
const object = (v: unknown): v is Record<string,unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: unknown, keys: readonly string[]): v is Record<string,unknown> => object(v)
  && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v,key));
const uuid = (v: unknown): v is string => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(v)
  && v !== '00000000-0000-0000-0000-000000000000';
const normalizedText = (v: unknown): v is string | null => v === null
  || (typeof v === 'string' && v !== '' && trim(v) === v && !v.includes('\0'));

export function canonicalPaymentMoney(v: unknown): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,18})$/u.test(v)) throw invalid();
  const amount = BigInt(v);
  if (amount > maximum) throw invalid();
  return amount;
}

export function parseCustomerPaymentAmount(v: unknown): string {
  // JOD minor units = 1/1000. No Number/parseFloat/rounding at this boundary.
  if (typeof v !== 'string') throw invalid();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,3}))?$/u.exec(v.trim());
  if (!match) throw invalid();
  const amount = BigInt(match[1]) * 1000n + BigInt((match[2] ?? '').padEnd(3,'0'));
  if (amount <= 0n || amount > maximum) throw invalid();
  return amount.toString();
}

export function assertCustomerCollectionRequest(v: unknown): asserts v is CustomerCollectionRequest {
  if (!exactKeys(v,requestKeys) || v.requestVersion !== 'phase5-customer-collection-v2'
    || v.action !== 'customer_collection' || !uuid(v.actorId) || !uuid(v.orderId)
    || typeof v.idempotencyKey !== 'string' || !v.idempotencyKey || trim(v.idempotencyKey) !== v.idempotencyKey
    || v.idempotencyKey.includes('\0')
    || [...v.idempotencyKey].length > 255 || (v.tenderMethod !== 'cash' && v.tenderMethod !== 'cliq')
    || canonicalPaymentMoney(v.amountInMinorUnits) === 0n
    || !normalizedText(v.tenderReference) || !normalizedText(v.notes)
    || (typeof v.tenderReference === 'string' && [...v.tenderReference].length > 120)
    || (v.tenderMethod === 'cliq' && v.tenderReference === null)) throw invalid();
}

export function captureCustomerCollectionRequest(input: {
  actorId: string; orderId: string; idempotencyKey: string; amount: string;
  method: string; reference: string | null; notes: string | null;
}): CustomerCollectionRequest {
  // Synchronous primitive copy before authentication, digest, Web Lock or RPC.
  const request = {
    requestVersion:'phase5-customer-collection-v2',actorId:input.actorId,orderId:input.orderId,
    action:'customer_collection',idempotencyKey:input.idempotencyKey,
    amountInMinorUnits:parseCustomerPaymentAmount(input.amount),tenderMethod:trim(input.method).toLowerCase(),
    tenderReference:input.reference === null ? null : trim(input.reference) || null,
    notes:input.notes === null ? null : trim(input.notes) || null,
  };
  assertCustomerCollectionRequest(request);
  return Object.freeze(request);
}

export function customerCollectionPostgresText(request: CustomerCollectionRequest): string {
  assertCustomerCollectionRequest(request);
  // PostgreSQL jsonb orders these fixed ASCII keys by byte length then byte
  // value and emits ': ' / ', '. Values are flat text/null, never JS numbers.
  // Cross-language runtime evidence must guard this representation contract.
  return `{${Object.keys(request).sort((a,b) => a.length-b.length || (a<b ? -1 : a>b ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}: ${JSON.stringify(request[key as keyof CustomerCollectionRequest])}`).join(', ')}}`;
}

export async function fingerprintCustomerCollectionRequest(request: CustomerCollectionRequest): Promise<string> {
  const capturedText = customerCollectionPostgresText(request);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(capturedText));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('').toUpperCase();
}

export function assertCustomerCollectionResult(
  request: CustomerCollectionRequest, fingerprint: string, v: unknown,
): asserts v is CustomerCollectionResult {
  assertCustomerCollectionRequest(request);
  if (!/^[0-9A-F]{64}$/u.test(fingerprint) || !exactKeys(v,resultKeys)
    || v.contractVersion !== 'phase5-customer-collection-result-v2'
    || v.kind !== 'COMMITTED_COLLECTION' || v.success !== true || v.requestFingerprint !== fingerprint
    || !uuid(v.operationId) || !uuid(v.originalPaymentId) || !uuid(v.collectionId)
    || typeof v.paymentNumber !== 'string' || !v.paymentNumber || trim(v.paymentNumber) !== v.paymentNumber) throw invalid();
  assertCustomerCollectionRequest(v.request);
  for (const key of requestKeys) {
    if (v[key] !== request[key] || v.request[key] !== request[key]) throw invalid();
  }
  const amount = canonicalPaymentMoney(v.amountInMinorUnits);
  const before = canonicalPaymentMoney(v.outstandingBeforeInMinorUnits);
  const after = canonicalPaymentMoney(v.outstandingAfterInMinorUnits);
  if (before < amount || after !== before-amount) throw invalid();
}
