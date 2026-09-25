import { CartItem } from '../types/catalog';
import {
  CommerceReviewReason,
  GuestOrderReceipt,
  PersistedCheckoutAttempt,
  PersistedCheckoutAttemptV2,
  PersistedServerSuccessEvidence,
} from '../types/checkout';
import {
  CART_RECOVERY_BACKUP_STORAGE_KEY,
  CART_STORAGE_KEY,
  CartStorageRecovery,
  isCurrentCartItem,
  migrateLegacyCartItem,
} from '../utils/cart';
import { buildGuestOrderV2Lines } from '../utils/checkout';

export const CHECKOUT_ATTEMPT_STORAGE_KEY = 'nawasrah-checkout-attempt-v1';
export const SERVER_SUCCESS_STORAGE_KEY = 'nawasrah-checkout-success-v1';
export const RECONCILIATION_EVIDENCE_STORAGE_KEY = 'nawasrah-checkout-reconciliation-v1';
export const COMMERCE_JOURNAL_STORAGE_KEY = 'nawasrah-commerce-journal-v1'; // gitleaks:allow stable localStorage key, not a credential
export const COMMERCE_STORAGE_EVENT = 'nawasrah-commerce-state';

const STORAGE_LOCK_NAME = 'nawasrah-commerce-storage-v1';
const MAX_RECONCILIATION_EVIDENCE = 24;

const ALLOWED_JOURNAL_TARGETS = new Set([
  CART_STORAGE_KEY,
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  SERVER_SUCCESS_STORAGE_KEY,
  RECONCILIATION_EVIDENCE_STORAGE_KEY,
  CART_RECOVERY_BACKUP_STORAGE_KEY,
]);

type SensitiveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface CommerceLockManager {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

export interface CartReconciliationEvidence {
  attemptId: string;
  orderId: string;
  mutationId: string;
  appliedAt: number;
}

export interface PersistedReconciliationEvidenceV1 {
  version: 1;
  attemptId: string;
  idempotencyKey: string;
  submissionGeneration: string;
  submittedRequestIdentity: string;
  commercialResult: PersistedServerSuccessEvidence['commercialResult'];
  cartMutationId: string;
  cartRevisionAtApply: number;
  appliedAt: number;
}

export interface CartEnvelopeV3 {
  version: 3;
  revision: number;
  lastMutationId: string | null;
  items: CartItem[];
  reconciliations: CartReconciliationEvidence[];
}

export type CartReadResult =
  | { status: 'ABSENT'; raw: null; envelope: CartEnvelopeV3 }
  | { status: 'VALID' | 'VALID_EMPTY'; raw: string; envelope: CartEnvelopeV3 }
  | {
      status: 'INVALID' | 'PARTIALLY_INVALID' | 'UNSUPPORTED_VERSION';
      raw: string;
      envelope: CartEnvelopeV3 | null;
      recovery: CartStorageRecovery;
    }
  | { status: 'UNAVAILABLE'; raw: null; envelope: null; error: string };

export type AttemptReadResult =
  | { status: 'ABSENT'; raw: null; attempt: null }
  | { status: 'VALID'; raw: string; attempt: PersistedCheckoutAttemptV2 }
  | {
      status: 'INVALID' | 'UNSUPPORTED_VERSION';
      raw: string;
      attempt: null;
      reviewReason: CommerceReviewReason;
    }
  | { status: 'UNAVAILABLE'; raw: null; attempt: null; error: string };

interface JournalTarget {
  key: string;
  preimage: string | null;
  postimage: string | null;
}

interface CommerceWriteJournalV1 {
  version: 1;
  mutationId: string;
  operation:
    | 'CART_MUTATION'
    | 'CART_RECOVERY'
    | 'ATTEMPT_TRANSITION'
    | 'CHECKOUT_RECONCILIATION'
    | 'CHECKOUT_CLEANUP';
  attemptId?: string;
  targets: JournalTarget[];
  createdAt: number;
}

export interface CommerceStorageSnapshot {
  cart: CartReadResult;
  attempt: AttemptReadResult;
  successEvidence: PersistedServerSuccessEvidence | null;
  reconciliationEvidence: PersistedReconciliationEvidenceV1 | null;
  journalPending: boolean;
  reviewReason?: CommerceReviewReason;
}

export interface JournalRecoveryResult {
  status: 'NONE' | 'COMPLETED' | 'PENDING' | 'REVIEW_REQUIRED';
  reason?: CommerceReviewReason;
}

export function reviewPolicyFor(reason: CommerceReviewReason) {
  const common = { newCheckoutBlocked: true as const };
  switch (reason) {
    case 'CART_RECOVERY_REQUIRED':
      return { ...common, reason, message: 'السلة تحتاج قرار استرداد صريحًا قبل المتابعة.', automaticRecoveryAllowed: false, userCartDecisionRequired: true, externalOrderVerificationRequired: false };
    case 'AMBIGUOUS_LEGACY_WRITE_OUTCOME':
      return { ...common, reason, message: 'محاولة قديمة لها نتيجة حفظ غير مؤكدة. راجع الطلب والسلة يدويًا قبل أي طلب جديد.', automaticRecoveryAllowed: false, userCartDecisionRequired: true, externalOrderVerificationRequired: true };
    case 'STORAGE_CONFLICT':
      return { ...common, reason, message: 'تعارضت حالة الحفظ مع محاولة ناجحة. يلزم التحقق من الطلب والسلة يدويًا قبل أي طلب جديد.', automaticRecoveryAllowed: false, userCartDecisionRequired: false, externalOrderVerificationRequired: true };
    case 'UNSUPPORTED_STATE_VERSION':
      return { ...common, reason, message: 'نسخة حالة الحفظ غير مدعومة. لا يمكن بدء طلب جديد قبل مراجعتها.', automaticRecoveryAllowed: false, userCartDecisionRequired: false, externalOrderVerificationRequired: true };
    case 'JOURNAL_EVIDENCE_INVALID':
      return { ...common, reason, message: 'دليل عملية حفظ محلية غير صالح. يلزم فحصه قبل تعديل السلة.', automaticRecoveryAllowed: false, userCartDecisionRequired: false, externalOrderVerificationRequired: false };
    case 'ATTEMPT_EVIDENCE_INVALID':
      return { ...common, reason, message: 'دليل محاولة الطلب غير صالح. تحقق من وجود الطلب في الإدارة قبل أي إعادة إرسال.', automaticRecoveryAllowed: false, userCartDecisionRequired: false, externalOrderVerificationRequired: true };
    case 'RECONCILIATION_EVIDENCE_MISSING':
      return { ...common, reason, message: 'تم تسجيل الطلب، لكن دليل تسوية السلة غير مكتمل. لن يُعاد إرسال الطلب، ويلزم استرداد الدليل أو مراجعته قبل طلب جديد.', automaticRecoveryAllowed: true, userCartDecisionRequired: false, externalOrderVerificationRequired: false };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('المتصفح لا يدعم إنشاء هوية آمنة لحفظ السلة.');
  }
  return globalThis.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function emptyEnvelope(): CartEnvelopeV3 {
  return {
    version: 3,
    revision: 0,
    lastMutationId: null,
    items: [],
    reconciliations: [],
  };
}

function uniqueCartIdentities(items: CartItem[]): boolean {
  const lineIds = items.map((item) => item.localLineId);
  if (new Set(lineIds).size !== lineIds.length) return false;
  const instanceIds = items.flatMap((item) =>
    item.commercialLineKind === 'configurable_parcel'
      ? item.parcelInstances.map((instance) => instance.localInstanceId)
      : []
  );
  return new Set(instanceIds).size === instanceIds.length;
}

function protectedSubmittedLinesUnchanged(
  before: CartItem[],
  after: CartItem[],
  attempt: PersistedCheckoutAttemptV2,
  effectivelyReconciled: boolean
): boolean {
  if (['REJECTED', 'ABANDONED'].includes(attempt.serverState) || effectivelyReconciled) return true;
  const beforeById = new Map(before.map((item) => [item.localLineId, item]));
  const afterById = new Map(after.map((item) => [item.localLineId, item]));
  return attempt.submittedItems.every((submitted) => {
    const previous = beforeById.get(submitted.localLineId);
    const next = afterById.get(submitted.localLineId);
    return Boolean(previous && next && JSON.stringify(previous) === JSON.stringify(next));
  });
}

function isReconciliationEvidence(value: unknown): value is CartReconciliationEvidence {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.attemptId) &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.mutationId) &&
    typeof value.appliedAt === 'number' &&
    Number.isFinite(value.appliedAt)
  );
}

function submittedRequestIdentity(attempt: PersistedCheckoutAttemptV2): string {
  return JSON.stringify({
    idempotencyKey: attempt.idempotencyKey,
    clientSessionId: attempt.clientSessionId,
    submissionGeneration: attempt.submissionGeneration,
    contractVersion: attempt.request.contractVersion ?? null,
    items: attempt.request.items,
    paymentMethod: attempt.request.paymentMethod,
    deliveryZone: attempt.request.deliveryZone,
    promotionCode: attempt.request.promotionCode ?? '',
    expectedQuote: attempt.request.expectedQuote ?? null,
    customer: {
      fullName: attempt.request.customer.fullName,
      phone: attempt.request.customer.phone,
      governorate: attempt.request.customer.governorate,
      city: attempt.request.customer.city,
      area: attempt.request.customer.area,
      street: attempt.request.customer.street,
      building: attempt.request.customer.building,
      addressNotes: attempt.request.customer.addressNotes,
      googleMapsUrl: attempt.request.customer.googleMapsUrl,
      latitude: attempt.request.customer.latitude,
      longitude: attempt.request.customer.longitude,
      customerNotes: attempt.request.customer.customerNotes,
    },
    submittedLines: attempt.submittedItems.map((item) => ({
      localLineId: item.localLineId,
      localRevision: item.localRevision,
      commercialLineKind: item.commercialLineKind,
      productId: item.productId,
      quantity: item.quantity,
      unitPriceInMinorUnits: item.unitPriceInMinorUnits,
      parcelInstances: item.commercialLineKind === 'configurable_parcel'
        ? item.parcelInstances.map((instance) => ({
            localInstanceId: instance.localInstanceId,
            localRevision: instance.localRevision,
            components: instance.components.map((component) => ({
              productId: component.productId,
              baseQuantity: component.baseQuantity,
            })),
          }))
        : null,
    })),
  });
}

function isCartEnvelope(value: unknown): value is CartEnvelopeV3 {
  if (!isRecord(value)) return false;
  if (
    value.version !== 3 ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !(value.lastMutationId === null || isNonEmptyString(value.lastMutationId)) ||
    !Array.isArray(value.items) ||
    !value.items.every(isCurrentCartItem) ||
    !uniqueCartIdentities(value.items as CartItem[]) ||
    !Array.isArray(value.reconciliations) ||
    !value.reconciliations.every(isReconciliationEvidence)
  ) return false;
  const attempts = (value.reconciliations as CartReconciliationEvidence[]).map(
    (entry) => entry.attemptId
  );
  return new Set(attempts).size === attempts.length;
}

function legacyCartRecovery(
  raw: string,
  validItems: CartItem[],
  invalidIndexes: number[],
  reason: CartStorageRecovery['reason'],
  reconciliations: CartReconciliationEvidence[] = []
): CartReadResult {
  return {
    status: validItems.length > 0 ? 'PARTIALLY_INVALID' : 'INVALID',
    raw,
    envelope: null,
    recovery: {
      status: validItems.length > 0 ? 'PARTIALLY_INVALID' : 'INVALID',
      originalRaw: raw,
      validItems,
      reconciledAttemptIds: reconciliations.map((entry) => entry.attemptId),
      reconciliations: clone(reconciliations),
      invalidEntries: invalidIndexes.map((index) => ({
        index,
        reason: 'INVALID_LEGACY_ITEM',
      })),
      reason,
    },
  };
}

export function readCartEnvelope(storage: Pick<Storage, 'getItem'>): CartReadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CART_STORAGE_KEY);
    if (raw === null) return { status: 'ABSENT', raw: null, envelope: emptyEnvelope() };
    const parsed: unknown = JSON.parse(raw);
    if (isCartEnvelope(parsed)) {
      return {
        status: parsed.items.length === 0 ? 'VALID_EMPTY' : 'VALID',
        raw,
        envelope: clone(parsed),
      };
    }
    if (Array.isArray(parsed)) {
      const migrated = parsed.map((entry, index) => migrateLegacyCartItem(entry, index));
      const validItems = migrated.filter((item): item is NonNullable<typeof item> => item !== null);
      const invalidIndexes = migrated.flatMap((item, index) => item ? [] : [index]);
      if (invalidIndexes.length > 0) {
        return legacyCartRecovery(
          raw,
          validItems,
          invalidIndexes,
          validItems.length > 0 ? 'PARTIALLY_INVALID_DOCUMENT' : 'INVALID_DOCUMENT'
        );
      }
      const envelope: CartEnvelopeV3 = { ...emptyEnvelope(), items: validItems };
      return {
        status: validItems.length === 0 ? 'VALID_EMPTY' : 'VALID',
        raw,
        envelope,
      };
    }
    if (isRecord(parsed) && parsed.version === 2 && Array.isArray(parsed.items)) {
      const items = parsed.items.filter(isCurrentCartItem);
      const invalidIndexes = parsed.items.flatMap((item, index) =>
        isCurrentCartItem(item) ? [] : [index]
      );
      const markerValid =
        parsed.reconciledAttemptIds === undefined ||
        (Array.isArray(parsed.reconciledAttemptIds) &&
          parsed.reconciledAttemptIds.every(isNonEmptyString));
      if (invalidIndexes.length > 0 || !markerValid || !uniqueCartIdentities(items)) {
        return legacyCartRecovery(
          raw,
          items,
          invalidIndexes.length > 0 ? invalidIndexes : [-1],
          items.length > 0 ? 'PARTIALLY_INVALID_DOCUMENT' : 'INVALID_DOCUMENT'
        );
      }
      const envelope: CartEnvelopeV3 = {
        ...emptyEnvelope(),
        items,
        reconciliations: (parsed.reconciledAttemptIds as string[] | undefined ?? []).map(
          (attemptId) => ({
            attemptId,
            orderId: 'legacy-unproven',
            mutationId: 'legacy-unproven',
            appliedAt: 0,
          })
        ),
      };
      return {
        status: items.length === 0 ? 'VALID_EMPTY' : 'VALID',
        raw,
        envelope,
      };
    }
    if (isRecord(parsed) && parsed.version === 3 && Array.isArray(parsed.items)) {
      const items = parsed.items.filter(isCurrentCartItem);
      const invalidIndexes = parsed.items.flatMap((item, index) =>
        isCurrentCartItem(item) ? [] : [index]
      );
      const reconciliations = Array.isArray(parsed.reconciliations) &&
        parsed.reconciliations.every(isReconciliationEvidence)
        ? parsed.reconciliations as CartReconciliationEvidence[]
        : [];
      const metadataValid =
        Number.isInteger(parsed.revision) &&
        Number(parsed.revision) >= 0 &&
        (parsed.lastMutationId === null || isNonEmptyString(parsed.lastMutationId)) &&
        Array.isArray(parsed.reconciliations) &&
        parsed.reconciliations.every(isReconciliationEvidence) &&
        new Set(reconciliations.map((entry) => entry.attemptId)).size === reconciliations.length;
      return legacyCartRecovery(
        raw,
        uniqueCartIdentities(items) ? items : [],
        invalidIndexes.length > 0 ? invalidIndexes : [-1],
        items.length > 0 ? 'PARTIALLY_INVALID_DOCUMENT' : 'INVALID_DOCUMENT',
        metadataValid ? reconciliations : []
      );
    }
    if (isRecord(parsed) && typeof parsed.version === 'number') {
      return {
        status: 'UNSUPPORTED_VERSION',
        raw,
        envelope: null,
        recovery: {
          status: 'INVALID',
          originalRaw: raw,
          validItems: [],
          reconciledAttemptIds: [],
          invalidEntries: [],
          reason: 'INVALID_DOCUMENT',
        },
      };
    }
    return legacyCartRecovery(raw, [], [], 'INVALID_DOCUMENT');
  } catch (error) {
    if (raw === null) {
      return {
        status: 'UNAVAILABLE',
        raw: null,
        envelope: null,
        error: error instanceof Error ? error.message : 'Storage unavailable',
      };
    }
    return legacyCartRecovery(raw, [], [], 'CORRUPT_JSON');
  }
}

function legalAttemptCombination(attempt: PersistedCheckoutAttemptV2): boolean {
  if (attempt.serverState !== 'SUCCEEDED') {
    return (
      attempt.reconciliationState === 'NOT_STARTED' &&
      attempt.receipt === undefined
    );
  }
  const successCombination = (
    attempt.receipt !== undefined &&
    ['PENDING', 'BLOCKED_CART', 'WRITE_OUTCOME_UNKNOWN', 'APPLIED'].includes(
      attempt.reconciliationState
    )
  );
  if (!successCombination) return false;
  if (attempt.reconciliationState === 'BLOCKED_CART') {
    return attempt.reviewRequired?.reason === 'CART_RECOVERY_REQUIRED';
  }
  if (attempt.reconciliationState === 'WRITE_OUTCOME_UNKNOWN') {
    return attempt.reviewRequired?.reason === 'AMBIGUOUS_LEGACY_WRITE_OUTCOME';
  }
  return true;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isGuestOrderLine(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.commercial_line_kind === 'base_unit') {
    return isNonEmptyString(value.product_id) &&
      isFiniteInteger(value.base_quantity) && value.base_quantity > 0 &&
      isFiniteInteger(value.expected_unit_price_in_minor_units) &&
      value.expected_unit_price_in_minor_units >= 0;
  }
  if (value.commercial_line_kind === 'legacy_single_sku_parcel') {
    return isNonEmptyString(value.product_id) &&
      isFiniteInteger(value.parcel_quantity) && value.parcel_quantity > 0 &&
      isFiniteInteger(value.units_per_parcel) && value.units_per_parcel > 0 &&
      isFiniteInteger(value.expected_unit_price_in_minor_units) &&
      value.expected_unit_price_in_minor_units >= 0;
  }
  if (value.commercial_line_kind === 'configurable_parcel') {
    return isNonEmptyString(value.family_product_id) &&
      isNonEmptyString(value.parcel_configuration_id) &&
      isFiniteInteger(value.configuration_revision) && value.configuration_revision > 0 &&
      isFiniteInteger(value.expected_unit_price_in_minor_units) &&
      value.expected_unit_price_in_minor_units >= 0 &&
      Array.isArray(value.parcel_instances) && value.parcel_instances.length > 0 &&
      value.parcel_instances.every((instance) =>
        isRecord(instance) && Array.isArray(instance.components) &&
        instance.components.length > 0 && instance.components.every((component) =>
          isRecord(component) && isNonEmptyString(component.product_id) &&
          isFiniteInteger(component.base_quantity) && component.base_quantity > 0
        )
      );
  }
  return isNonEmptyString(value.product_id) &&
    isFiniteInteger(value.quantity) && value.quantity > 0;
}

function isDurableRequest(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.customer) || !Array.isArray(value.items)) return false;
  const customer = value.customer;
  const stringFields = [
    'fullName', 'phone', 'governorate', 'city', 'area', 'street', 'building',
    'addressNotes', 'googleMapsUrl', 'customerNotes',
  ];
  return (
    (value.contractVersion === undefined || value.contractVersion === 'phase3-customer-reservation-v2') &&
    isNonEmptyString(value.idempotencyKey) &&
    isNonEmptyString(value.clientSessionId) &&
    stringFields.every((field) => typeof customer[field] === 'string') &&
    (customer.latitude === null || (typeof customer.latitude === 'number' && Number.isFinite(customer.latitude))) &&
    (customer.longitude === null || (typeof customer.longitude === 'number' && Number.isFinite(customer.longitude))) &&
    value.items.length > 0 && value.items.every(isGuestOrderLine) &&
    ['cash_on_delivery', 'cliq'].includes(String(value.paymentMethod)) &&
    ['inside_ramtha', 'outside_ramtha'].includes(String(value.deliveryZone)) &&
    (value.promotionCode === undefined || typeof value.promotionCode === 'string') &&
    (value.expectedQuote === undefined || (
      isRecord(value.expectedQuote) &&
      ['subtotalInMinorUnits', 'discountInMinorUnits', 'deliveryFeeInMinorUnits', 'totalInMinorUnits']
        .every((field) => {
          const amount = (value.expectedQuote as Record<string, unknown>)[field];
          return isFiniteInteger(amount) && amount >= 0;
        })
    ))
  );
}

function isReviewRequired(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ['CART_RECOVERY_REQUIRED', 'ATTEMPT_EVIDENCE_INVALID', 'RECONCILIATION_EVIDENCE_MISSING', 'AMBIGUOUS_LEGACY_WRITE_OUTCOME',
      'STORAGE_CONFLICT', 'UNSUPPORTED_STATE_VERSION', 'JOURNAL_EVIDENCE_INVALID']
      .includes(String(value.reason)) &&
    isNonEmptyString(value.message) &&
    typeof value.automaticRecoveryAllowed === 'boolean' &&
    typeof value.userCartDecisionRequired === 'boolean' &&
    typeof value.externalOrderVerificationRequired === 'boolean' &&
    value.newCheckoutBlocked === true
  );
}

function requestMatchesAttempt(attempt: PersistedCheckoutAttemptV2): boolean {
  const modernRequestMatches = attempt.submissionGeneration.startsWith('legacy-') ||
    JSON.stringify(attempt.request.items) === JSON.stringify(buildGuestOrderV2Lines(attempt.submittedItems));
  return (
    isDurableRequest(attempt.request) &&
    attempt.request.idempotencyKey === attempt.idempotencyKey &&
    attempt.request.clientSessionId === attempt.clientSessionId &&
    Array.isArray(attempt.request.items) &&
    attempt.request.items.length > 0 &&
    modernRequestMatches
  );
}

export function isCheckoutAttemptV2(value: unknown): value is PersistedCheckoutAttemptV2 {
  if (!isRecord(value)) return false;
  const candidate = value as unknown as PersistedCheckoutAttemptV2;
  return (
    candidate.version === 2 &&
    Number.isInteger(candidate.revision) &&
    candidate.revision > 0 &&
    isNonEmptyString(candidate.attemptId) &&
    isNonEmptyString(candidate.submissionGeneration) &&
    ['PREPARED', 'IN_FLIGHT', 'UNKNOWN', 'SUCCEEDED', 'REJECTED', 'ABANDONED'].includes(
      candidate.serverState
    ) &&
    ['NOT_STARTED', 'PENDING', 'BLOCKED_CART', 'WRITE_OUTCOME_UNKNOWN', 'APPLIED'].includes(
      candidate.reconciliationState
    ) &&
    isNonEmptyString(candidate.idempotencyKey) &&
    isNonEmptyString(candidate.clientSessionId) &&
    isRecord(candidate.request) &&
    Array.isArray(candidate.submittedItems) &&
    candidate.submittedItems.every(isCurrentCartItem) &&
    uniqueCartIdentities(candidate.submittedItems) &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    (candidate.receipt === undefined || isGuestOrderReceipt(candidate.receipt)) &&
    (candidate.reviewRequired === undefined || isReviewRequired(candidate.reviewRequired)) &&
    requestMatchesAttempt(candidate) &&
    legalAttemptCombination(candidate)
  );
}

function migrateAttemptV1(value: PersistedCheckoutAttempt): PersistedCheckoutAttemptV2 {
  const success = value.state === 'SUCCESS_PENDING_RECONCILIATION' || value.state === 'RECONCILED';
  const ambiguousLegacyWrite = value.cartReconciliationStatus === 'WRITE_OUTCOME_UNKNOWN';
  const blockedCart = value.cartReconciliationStatus === 'BLOCKED_INVALID_CART';
  return {
    version: 2,
    revision: 1,
    attemptId: value.attemptId,
    submissionGeneration: `legacy-${value.attemptId}`,
    serverState:
      value.state === 'IN_FLIGHT' ? 'IN_FLIGHT' :
      value.state === 'UNKNOWN' ? 'UNKNOWN' :
      value.state === 'TERMINAL_REJECTED' ? 'REJECTED' :
      success ? 'SUCCEEDED' : 'UNKNOWN',
    reconciliationState:
      value.state === 'RECONCILED' ? 'APPLIED' :
      value.cartReconciliationStatus === 'BLOCKED_INVALID_CART' ? 'BLOCKED_CART' :
      ambiguousLegacyWrite ? 'WRITE_OUTCOME_UNKNOWN' :
      success ? 'PENDING' : 'NOT_STARTED',
    idempotencyKey: value.idempotencyKey,
    clientSessionId: value.clientSessionId,
    request: clone(value.request),
    submittedItems: clone(value.submittedItems),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    receipt: value.receipt ? clone(value.receipt) : undefined,
    terminalMessage: value.terminalMessage,
    reviewRequired: ambiguousLegacyWrite || blockedCart ? {
      reason: ambiguousLegacyWrite ? 'AMBIGUOUS_LEGACY_WRITE_OUTCOME' : 'CART_RECOVERY_REQUIRED',
      message: ambiguousLegacyWrite
        ? 'تحتاج هذه المحاولة القديمة إلى مراجعة السلة والطلب قبل المتابعة.'
        : 'السلة تحتاج معالجة صريحة قبل إكمال تسوية الطلب.',
      automaticRecoveryAllowed: false,
      userCartDecisionRequired: true,
      externalOrderVerificationRequired: ambiguousLegacyWrite,
      newCheckoutBlocked: true,
    } : undefined,
  };
}

function looksLikeAttemptV1(value: unknown): value is PersistedCheckoutAttempt {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    isNonEmptyString(value.attemptId) &&
    isNonEmptyString(value.idempotencyKey) &&
    isNonEmptyString(value.clientSessionId) &&
    isRecord(value.request) &&
    Array.isArray(value.submittedItems)
  );
}

export function readAttemptEnvelope(storage: Pick<Storage, 'getItem'>): AttemptReadResult {
  try {
    const raw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    if (raw === null) return { status: 'ABSENT', raw: null, attempt: null };
    const parsed: unknown = JSON.parse(raw);
    if (isCheckoutAttemptV2(parsed)) return { status: 'VALID', raw, attempt: clone(parsed) };
    if (looksLikeAttemptV1(parsed)) {
      const migrated = migrateAttemptV1(parsed);
      if (isCheckoutAttemptV2(migrated)) return { status: 'VALID', raw, attempt: migrated };
    }
    return {
      status: isRecord(parsed) && typeof parsed.version === 'number'
        ? 'UNSUPPORTED_VERSION'
        : 'INVALID',
      raw,
      attempt: null,
      reviewReason: isRecord(parsed) && typeof parsed.version === 'number'
        ? 'UNSUPPORTED_STATE_VERSION'
        : 'ATTEMPT_EVIDENCE_INVALID',
    };
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      raw: null,
      attempt: null,
      error: error instanceof Error ? error.message : 'Storage unavailable',
    };
  }
}

function commercialResult(receipt: GuestOrderReceipt) {
  return {
    orderId: receipt.id,
    orderNumber: receipt.orderNumber,
    subtotalInMinorUnits: receipt.subtotalInMinorUnits,
    discountInMinorUnits: receipt.discountInMinorUnits,
    deliveryFeeInMinorUnits: receipt.deliveryFeeInMinorUnits,
    totalInMinorUnits: receipt.totalInMinorUnits,
    paymentMethod: receipt.paymentMethod,
    deliveryZone: receipt.deliveryZone,
  };
}

function sameCommercialResult(
  left: PersistedServerSuccessEvidence,
  right: PersistedServerSuccessEvidence
): boolean {
  return sameCommercialResultValue(left.commercialResult, right.commercialResult);
}

function sameCommercialResultValue(
  left: PersistedServerSuccessEvidence['commercialResult'],
  right: PersistedServerSuccessEvidence['commercialResult']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isCommercialResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.orderNumber) &&
    ['subtotalInMinorUnits', 'discountInMinorUnits', 'deliveryFeeInMinorUnits', 'totalInMinorUnits']
      .every((field) => isFiniteInteger(value[field])) &&
    ['cash_on_delivery', 'cliq'].includes(String(value.paymentMethod)) &&
    ['inside_ramtha', 'outside_ramtha'].includes(String(value.deliveryZone))
  );
}

function isGuestOrderReceipt(value: unknown): value is GuestOrderReceipt {
  if (!isRecord(value)) return false;
  return (
    value.success === true &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.orderNumber) &&
    isNonEmptyString(value.customerId) &&
    isNonEmptyString(value.customerAddressId) &&
    typeof value.customerReused === 'boolean' &&
    typeof value.idempotentReplay === 'boolean' &&
    ['subtotalInMinorUnits', 'discountInMinorUnits', 'deliveryFeeInMinorUnits', 'totalInMinorUnits']
      .every((field) => isFiniteInteger(value[field])) &&
    ['cash_on_delivery', 'cliq'].includes(String(value.paymentMethod)) &&
    ['inside_ramtha', 'outside_ramtha'].includes(String(value.deliveryZone)) &&
    typeof value.promotionCode === 'string' &&
    isNonEmptyString(value.status) &&
    typeof value.message === 'string'
  );
}

function parseSuccessEvidence(raw: string | null): PersistedServerSuccessEvidence | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    const candidate = value as unknown as PersistedServerSuccessEvidence;
    if (
      !isNonEmptyString(candidate.attemptId) ||
      !isNonEmptyString(candidate.idempotencyKey) ||
      !isNonEmptyString(candidate.submissionGeneration) ||
      !isCommercialResult(candidate.commercialResult) ||
      !isGuestOrderReceipt(candidate.receipt) ||
      candidate.commercialResult.orderId !== candidate.receipt.id ||
      !sameCommercialResultValue(candidate.commercialResult, commercialResult(candidate.receipt)) ||
      typeof candidate.recordedAt !== 'number'
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function parseReconciliationEvidence(raw: string | null): PersistedReconciliationEvidenceV1 | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    const candidate = value as unknown as PersistedReconciliationEvidenceV1;
    if (
      !isNonEmptyString(candidate.attemptId) ||
      !isNonEmptyString(candidate.idempotencyKey) ||
      !isNonEmptyString(candidate.submissionGeneration) ||
      !isNonEmptyString(candidate.submittedRequestIdentity) ||
      !isCommercialResult(candidate.commercialResult) ||
      !isNonEmptyString(candidate.cartMutationId) ||
      !isFiniteInteger(candidate.cartRevisionAtApply) ||
      candidate.cartRevisionAtApply < 0 ||
      typeof candidate.appliedAt !== 'number' ||
      !Number.isFinite(candidate.appliedAt)
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function reconciliationEvidenceMatches(
  evidence: PersistedReconciliationEvidenceV1,
  attempt: PersistedCheckoutAttemptV2,
  success: PersistedServerSuccessEvidence
): boolean {
  return (
    evidence.attemptId === attempt.attemptId &&
    evidence.idempotencyKey === attempt.idempotencyKey &&
    evidence.submissionGeneration === attempt.submissionGeneration &&
    evidence.submittedRequestIdentity === submittedRequestIdentity(attempt) &&
    evidence.attemptId === success.attemptId &&
    evidence.idempotencyKey === success.idempotencyKey &&
    evidence.submissionGeneration === success.submissionGeneration &&
    sameCommercialResultValue(evidence.commercialResult, success.commercialResult) &&
    Boolean(attempt.receipt) &&
    sameCommercialResultValue(evidence.commercialResult, commercialResult(attempt.receipt!))
  );
}

function successEvidenceMatchesAttempt(
  success: PersistedServerSuccessEvidence,
  attempt: PersistedCheckoutAttemptV2
): boolean {
  return (
    attempt.serverState === 'SUCCEEDED' &&
    attempt.reconciliationState === 'APPLIED' &&
    Boolean(attempt.receipt) &&
    success.attemptId === attempt.attemptId &&
    success.idempotencyKey === attempt.idempotencyKey &&
    success.submissionGeneration === attempt.submissionGeneration &&
    sameCommercialResultValue(success.commercialResult, commercialResult(attempt.receipt!))
  );
}

function buildReconciliationEvidence(
  attempt: PersistedCheckoutAttemptV2,
  success: PersistedServerSuccessEvidence,
  cartMutationId: string,
  cartRevisionAtApply: number,
  appliedAt: number
): PersistedReconciliationEvidenceV1 {
  return {
    version: 1,
    attemptId: attempt.attemptId,
    idempotencyKey: attempt.idempotencyKey,
    submissionGeneration: attempt.submissionGeneration,
    submittedRequestIdentity: submittedRequestIdentity(attempt),
    commercialResult: clone(success.commercialResult),
    cartMutationId,
    cartRevisionAtApply,
    appliedAt,
  };
}

function parseAttemptPostimage(raw: string | null): PersistedCheckoutAttemptV2 | null {
  if (!raw) return null;
  const parsed = readAttemptEnvelope({ getItem: () => raw });
  return parsed.status === 'VALID' ? parsed.attempt : null;
}

function parseCartPostimage(raw: string | null): CartEnvelopeV3 | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isCartEnvelope(value) ? value : null;
  } catch {
    return null;
  }
}

function parseCartPreimage(raw: string | null): CartEnvelopeV3 | null {
  if (!raw) return null;
  const parsed = readCartEnvelope({ getItem: () => raw });
  return parsed.envelope && ['VALID', 'VALID_EMPTY'].includes(parsed.status)
    ? parsed.envelope
    : null;
}

function reconciliationProofMatchesAttemptOnly(
  evidence: PersistedReconciliationEvidenceV1,
  attempt: PersistedCheckoutAttemptV2
): boolean {
  return (
    attempt.serverState === 'SUCCEEDED' &&
    attempt.reconciliationState === 'APPLIED' &&
    Boolean(attempt.receipt) &&
    evidence.attemptId === attempt.attemptId &&
    evidence.idempotencyKey === attempt.idempotencyKey &&
    evidence.submissionGeneration === attempt.submissionGeneration &&
    evidence.submittedRequestIdentity === submittedRequestIdentity(attempt) &&
    sameCommercialResultValue(evidence.commercialResult, commercialResult(attempt.receipt!))
  );
}

function sameAttemptIdentity(
  before: PersistedCheckoutAttemptV2,
  after: PersistedCheckoutAttemptV2
): boolean {
  return (
    before.attemptId === after.attemptId &&
    before.idempotencyKey === after.idempotencyKey &&
    before.submissionGeneration === after.submissionGeneration &&
    before.clientSessionId === after.clientSessionId &&
    before.createdAt === after.createdAt &&
    submittedRequestIdentity(before) === submittedRequestIdentity(after)
  );
}

function validAttemptTransition(
  before: PersistedCheckoutAttemptV2 | null,
  after: PersistedCheckoutAttemptV2
): boolean {
  if (!before) return after.revision === 1 && after.serverState === 'PREPARED';
  if (!sameAttemptIdentity(before, after) || after.revision <= before.revision) return false;
  if (before.serverState === 'SUCCEEDED') {
    if (after.serverState !== 'SUCCEEDED' || !before.receipt || !after.receipt) return false;
    if (!sameCommercialResultValue(commercialResult(before.receipt), commercialResult(after.receipt))) {
      return false;
    }
  }
  if (['REJECTED', 'ABANDONED'].includes(before.serverState)) return false;
  return true;
}

function reconcileSubmittedCartItems(
  currentItems: CartItem[],
  submittedItems: CartItem[]
): { items: CartItem[]; conflict: boolean } {
  const submittedLineIds = new Set(submittedItems.map((item) => item.localLineId));
  let conflict = false;
  const items = currentItems.flatMap((item) => {
    if (!submittedLineIds.has(item.localLineId)) return [item];
    const submitted = submittedItems.find(
      (candidate) => candidate.localLineId === item.localLineId
    );
    if (!submitted || submitted.commercialLineKind !== item.commercialLineKind) {
      conflict = true;
      return [item];
    }
    if (
      item.commercialLineKind === 'configurable_parcel' &&
      submitted.commercialLineKind === 'configurable_parcel'
    ) {
      const ids = new Set(
        submitted.parcelInstances.map((instance) => instance.localInstanceId)
      );
      const existingSubmitted = item.parcelInstances.filter(
        (instance) => ids.has(instance.localInstanceId)
      );
      if (existingSubmitted.length !== ids.size) conflict = true;
      const remaining = item.parcelInstances.filter(
        (instance) => !ids.has(instance.localInstanceId)
      );
      return remaining.length > 0
        ? [{
            ...item,
            localRevision: item.localRevision + 1,
            quantity: remaining.length,
            parcelInstances: remaining,
          }]
        : [];
    }
    if (item.localRevision !== submitted.localRevision || item.quantity !== submitted.quantity) {
      conflict = true;
      return [item];
    }
    return [];
  });
  return { items, conflict };
}

function cartReconciliationTransitionValid(
  before: CartEnvelopeV3,
  after: CartEnvelopeV3,
  attempt: PersistedCheckoutAttemptV2,
  marker: CartReconciliationEvidence
): boolean {
  const existingMarker = before.reconciliations.find(
    (entry) => entry.attemptId === attempt.attemptId
  );
  if (existingMarker) {
    return (
      JSON.stringify(existingMarker) === JSON.stringify(marker) &&
      JSON.stringify(before) === JSON.stringify(after)
    );
  }
  const reconciled = reconcileSubmittedCartItems(before.items, attempt.submittedItems);
  if (reconciled.conflict) return false;
  const expectedMarkers = [
    ...before.reconciliations.filter((entry) => entry.attemptId !== attempt.attemptId),
    marker,
  ].slice(-MAX_RECONCILIATION_EVIDENCE);
  return (
    after.revision === before.revision + 1 &&
    after.lastMutationId === marker.mutationId &&
    JSON.stringify(after.items) === JSON.stringify(reconciled.items) &&
    JSON.stringify(after.reconciliations) === JSON.stringify(expectedMarkers)
  );
}

function isValidJournalRelations(journal: CommerceWriteJournalV1): boolean {
  const target = (key: string) => journal.targets.find((entry) => entry.key === key);
  if (journal.operation === 'CART_MUTATION') return journal.attemptId === undefined;
  if (journal.operation === 'CART_RECOVERY') {
    const cartTarget = target(CART_STORAGE_KEY);
    const backupTarget = target(CART_RECOVERY_BACKUP_STORAGE_KEY);
    return (
      journal.attemptId === undefined &&
      Boolean(cartTarget && backupTarget) &&
      backupTarget?.postimage === cartTarget?.preimage
    );
  }
  if (journal.operation === 'ATTEMPT_TRANSITION') {
    const attemptTarget = target(CHECKOUT_ATTEMPT_STORAGE_KEY);
    if (!journal.attemptId || !attemptTarget) return false;
    const before = parseAttemptPostimage(attemptTarget.preimage);
    const after = parseAttemptPostimage(attemptTarget.postimage);
    const successTarget = target(SERVER_SUCCESS_STORAGE_KEY);
    if (after) {
      return (
        !successTarget &&
        after.attemptId === journal.attemptId &&
        validAttemptTransition(before, after)
      );
    }
    return Boolean(
      before &&
      before.attemptId === journal.attemptId &&
      ['REJECTED', 'ABANDONED'].includes(before.serverState) &&
      successTarget &&
      successTarget.preimage === null &&
      successTarget.postimage === null
    );
  }
  if (journal.operation === 'CHECKOUT_RECONCILIATION') {
    const attemptTarget = target(CHECKOUT_ATTEMPT_STORAGE_KEY);
    const cartTarget = target(CART_STORAGE_KEY);
    const beforeAttempt = parseAttemptPostimage(attemptTarget?.preimage ?? null);
    const afterAttempt = parseAttemptPostimage(attemptTarget?.postimage ?? null);
    const beforeCart = parseCartPreimage(cartTarget?.preimage ?? null);
    const afterCart = parseCartPostimage(cartTarget?.postimage ?? null);
    if (
      !beforeAttempt ||
      !afterAttempt ||
      !beforeCart ||
      !afterCart ||
      !journal.attemptId ||
      beforeAttempt.attemptId !== journal.attemptId ||
      afterAttempt.attemptId !== journal.attemptId ||
      !validAttemptTransition(beforeAttempt, afterAttempt) ||
      afterAttempt.serverState !== 'SUCCEEDED' ||
      afterAttempt.reconciliationState !== 'APPLIED' ||
      !afterAttempt.receipt
    ) return false;
    const marker = afterCart.reconciliations.find(
      (entry) => entry.attemptId === afterAttempt.attemptId
    );
    if (
      !marker ||
      marker.orderId !== afterAttempt.receipt.id ||
      !cartReconciliationTransitionValid(beforeCart, afterCart, afterAttempt, marker)
    ) return false;
    const proofTarget = target(RECONCILIATION_EVIDENCE_STORAGE_KEY);
    if (!proofTarget) return true;
    if (proofTarget.preimage !== null) return false;
    const proof = parseReconciliationEvidence(proofTarget.postimage);
    return Boolean(
      proof &&
      reconciliationProofMatchesAttemptOnly(proof, afterAttempt) &&
      proof.cartMutationId === marker.mutationId &&
      proof.cartRevisionAtApply === afterCart.revision &&
      proof.appliedAt === marker.appliedAt
    );
  }
  if (journal.operation === 'CHECKOUT_CLEANUP') {
    const attemptTarget = target(CHECKOUT_ATTEMPT_STORAGE_KEY);
    const successTarget = target(SERVER_SUCCESS_STORAGE_KEY);
    const proofTarget = target(RECONCILIATION_EVIDENCE_STORAGE_KEY);
    const cartTarget = target(CART_STORAGE_KEY);
    const attempt = parseAttemptPostimage(attemptTarget?.preimage ?? null);
    const success = parseSuccessEvidence(successTarget?.preimage ?? null);
    const proof = parseReconciliationEvidence(proofTarget?.preimage ?? null);
    const beforeCart = parseCartPostimage(cartTarget?.preimage ?? null);
    const afterCart = parseCartPostimage(cartTarget?.postimage ?? null);
    if (
      !attempt || !success || !proof || !beforeCart || !afterCart ||
      attemptTarget?.postimage !== null ||
      successTarget?.postimage !== null ||
      proofTarget?.postimage !== null ||
      !journal.attemptId ||
      attempt.attemptId !== journal.attemptId ||
      !reconciliationEvidenceMatches(proof, attempt, success)
    ) return false;
    const expectedReconciliations = beforeCart.reconciliations.filter(
      (entry) => entry.attemptId !== journal.attemptId
    );
    return (
      afterCart.revision === beforeCart.revision + 1 &&
      JSON.stringify(afterCart.items) === JSON.stringify(beforeCart.items) &&
      JSON.stringify(afterCart.reconciliations) === JSON.stringify(expectedReconciliations)
    );
  }
  return true;
}

function parseJournal(raw: string | null): CommerceWriteJournalV1 | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.targets)) return null;
    const candidate = value as unknown as CommerceWriteJournalV1;
    if (
      !isNonEmptyString(candidate.mutationId) ||
      !['CART_MUTATION', 'CART_RECOVERY', 'ATTEMPT_TRANSITION', 'CHECKOUT_RECONCILIATION', 'CHECKOUT_CLEANUP'].includes(
        candidate.operation
      ) ||
      candidate.targets.length === 0 ||
      !candidate.targets.every((target) =>
        isRecord(target) &&
        isNonEmptyString(target.key) &&
        ALLOWED_JOURNAL_TARGETS.has(target.key) &&
        (target.preimage === null || typeof target.preimage === 'string') &&
        (target.postimage === null || typeof target.postimage === 'string') &&
        isValidJournalPostimage(target.key, target.postimage)
      ) ||
      new Set(candidate.targets.map((target) => target.key)).size !== candidate.targets.length ||
      !isValidJournalTargetSet(candidate.operation, candidate.targets.map((target) => target.key)) ||
      !isValidJournalRelations(candidate)
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function isValidJournalPostimage(key: string, postimage: string | null): boolean {
  if (postimage === null) {
    return key === CHECKOUT_ATTEMPT_STORAGE_KEY ||
      key === SERVER_SUCCESS_STORAGE_KEY ||
      key === RECONCILIATION_EVIDENCE_STORAGE_KEY;
  }
  if (key === CART_RECOVERY_BACKUP_STORAGE_KEY) return true;
  try {
    const parsed: unknown = JSON.parse(postimage);
    if (key === CART_STORAGE_KEY) return isCartEnvelope(parsed);
    if (key === CHECKOUT_ATTEMPT_STORAGE_KEY) return isCheckoutAttemptV2(parsed);
    if (key === SERVER_SUCCESS_STORAGE_KEY) return parseSuccessEvidence(postimage) !== null;
    if (key === RECONCILIATION_EVIDENCE_STORAGE_KEY) {
      return parseReconciliationEvidence(postimage) !== null;
    }
  } catch {
    return false;
  }
  return false;
}

function isValidJournalTargetSet(
  operation: CommerceWriteJournalV1['operation'],
  keys: string[]
): boolean {
  const actual = [...keys].sort().join('|');
  if (operation === 'CART_MUTATION') return actual === CART_STORAGE_KEY;
  if (operation === 'CART_RECOVERY') {
    return actual === [CART_RECOVERY_BACKUP_STORAGE_KEY, CART_STORAGE_KEY].sort().join('|');
  }
  if (operation === 'CHECKOUT_RECONCILIATION') {
    return actual === [CART_STORAGE_KEY, CHECKOUT_ATTEMPT_STORAGE_KEY].sort().join('|') ||
      actual === [CART_STORAGE_KEY, CHECKOUT_ATTEMPT_STORAGE_KEY, RECONCILIATION_EVIDENCE_STORAGE_KEY]
        .sort().join('|');
  }
  if (operation === 'CHECKOUT_CLEANUP') {
    return actual === [
      CART_STORAGE_KEY,
      CHECKOUT_ATTEMPT_STORAGE_KEY,
      SERVER_SUCCESS_STORAGE_KEY,
      RECONCILIATION_EVIDENCE_STORAGE_KEY,
    ].sort().join('|');
  }
  return actual === CHECKOUT_ATTEMPT_STORAGE_KEY ||
    actual === [CHECKOUT_ATTEMPT_STORAGE_KEY, SERVER_SUCCESS_STORAGE_KEY].sort().join('|');
}

type CommerceMutationPlan = Pick<
  CommerceWriteJournalV1,
  'operation' | 'attemptId' | 'targets'
> | {
  operation: 'SERVER_SUCCESS_RECORD';
  attemptId: string;
  targets: Array<{
    key: typeof SERVER_SUCCESS_STORAGE_KEY;
    preimage: string | null;
    postimage: string;
  }>;
};

interface CommerceRelationalValidation {
  valid: boolean;
  reason?: CommerceReviewReason;
}

function targetValue(
  plan: CommerceMutationPlan,
  key: string,
  liveValue: string | null
): string | null {
  const target = plan.targets.find((entry) => entry.key === key);
  return target ? target.postimage : liveValue;
}

/**
 * The single mandatory relational boundary for every sensitive local write.
 * Structural parsers validate individual records; this boundary validates the
 * relationship between the authoritative live evidence and the complete
 * post-mutation projection before a journal or target is persisted.
 */
function validateCommerceMutationPlan(
  plan: CommerceMutationPlan,
  storage: SensitiveStorage
): CommerceRelationalValidation {
  let liveAttemptRaw: string | null;
  let liveSuccessRaw: string | null;
  let liveProofRaw: string | null;
  let liveCartRaw: string | null;
  let liveJournalRaw: string | null;
  try {
    liveAttemptRaw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    liveSuccessRaw = storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
    liveProofRaw = storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
    liveCartRaw = storage.getItem(CART_STORAGE_KEY);
    liveJournalRaw = storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY);
  } catch {
    return { valid: false, reason: 'STORAGE_CONFLICT' };
  }

  const isRecoveringThisJournal = plan.operation !== 'SERVER_SUCCESS_RECORD' &&
    liveJournalRaw !== null &&
    (() => {
      const parsed = parseJournal(liveJournalRaw);
      return Boolean(parsed && parsed.mutationId === (plan as CommerceWriteJournalV1).mutationId);
    })();

  const isDiagnosticReviewTransition = (() => {
    if (plan.operation !== 'ATTEMPT_TRANSITION') return false;
    const target = plan.targets.find((entry) => entry.key === CHECKOUT_ATTEMPT_STORAGE_KEY);
    const before = parseAttemptPostimage(target?.preimage ?? null);
    const after = parseAttemptPostimage(target?.postimage ?? null);
    if (!before || !after || !after.reviewRequired || !validAttemptTransition(before, after)) return false;
    const omitDiagnostic = (attempt: PersistedCheckoutAttemptV2) => {
      const {
        revision: _revision,
        updatedAt: _updatedAt,
        reviewRequired: _reviewRequired,
        ...stable
      } = attempt;
      return stable;
    };
    return JSON.stringify(omitDiagnostic(before)) === JSON.stringify(omitDiagnostic(after));
  })();

  // A new transactional write may not be authorized over an unresolved
  // journal. Recovery plans validate that exact journal instead.
  if (liveJournalRaw !== null && !isRecoveringThisJournal && plan.operation !== 'SERVER_SUCCESS_RECORD') {
    return { valid: false, reason: 'STORAGE_CONFLICT' };
  }

  if (plan.operation !== 'SERVER_SUCCESS_RECORD') {
    const journalPlan: CommerceWriteJournalV1 = {
      version: 1,
      mutationId: (plan as CommerceWriteJournalV1).mutationId,
      operation: plan.operation,
      attemptId: plan.attemptId,
      targets: plan.targets,
      createdAt: (plan as CommerceWriteJournalV1).createdAt,
    };
    if (
      !isValidJournalTargetSet(journalPlan.operation, journalPlan.targets.map((target) => target.key)) ||
      !isValidJournalRelations(journalPlan)
    ) return { valid: false, reason: 'JOURNAL_EVIDENCE_INVALID' };
  }

  const attemptRaw = targetValue(plan, CHECKOUT_ATTEMPT_STORAGE_KEY, liveAttemptRaw);
  const successRaw = targetValue(plan, SERVER_SUCCESS_STORAGE_KEY, liveSuccessRaw);
  const proofRaw = targetValue(plan, RECONCILIATION_EVIDENCE_STORAGE_KEY, liveProofRaw);
  const cartRaw = targetValue(plan, CART_STORAGE_KEY, liveCartRaw);
  const attempt = parseAttemptPostimage(attemptRaw);
  const success = parseSuccessEvidence(successRaw);
  const proof = parseReconciliationEvidence(proofRaw);
  const cartRead = cartRaw === null
    ? null
    : readCartEnvelope({ getItem: () => cartRaw });
  const cart = cartRead?.envelope ?? null;
  const cartRecoveryOnly = plan.operation === 'CART_RECOVERY';
  const requiresValidCart = ![
    'SERVER_SUCCESS_RECORD',
    'ATTEMPT_TRANSITION',
  ].includes(plan.operation);

  if (
    (!cartRecoveryOnly && attemptRaw && !attempt) ||
    (!cartRecoveryOnly && successRaw && !success) ||
    (!cartRecoveryOnly && proofRaw && !proof) ||
    (requiresValidCart && cartRaw && (
      !cart || !cartRead || !['VALID', 'VALID_EMPTY'].includes(cartRead.status)
    ))
  ) {
    return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
  }

  if (plan.operation === 'CART_MUTATION' && attempt) {
    const cartTarget = plan.targets.find((entry) => entry.key === CART_STORAGE_KEY);
    const beforeCart = parseCartPreimage(cartTarget?.preimage ?? null);
    const afterCart = parseCartPostimage(cartTarget?.postimage ?? null);
    const effectivelyReconciled = Boolean(
      success &&
      proof &&
      attempt.serverState === 'SUCCEEDED' &&
      attempt.reconciliationState === 'APPLIED' &&
      reconciliationEvidenceMatches(proof, attempt, success)
    );
    if (
      !afterCart ||
      !protectedSubmittedLinesUnchanged(
        beforeCart?.items ?? [],
        afterCart.items,
        attempt,
        effectivelyReconciled
      )
    ) {
      return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
    }
  }

  // Explicit Cart recovery is allowed to preserve an unsupported or malformed
  // unresolved Attempt byte-for-byte. Its validated plan can only write the
  // Cart and recovery backup, so unrelated order evidence cannot be replaced.
  if (cartRecoveryOnly) return { valid: true };

  // Durable success without its owning Attempt is unresolved evidence. No
  // ordinary mutation may proceed around it; only the explicit Cart-recovery
  // operation above may preserve/repair Cart bytes without touching order
  // evidence.
  if (success && !attempt) {
    return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
  }

  if (attempt && success) {
    if (
      attempt.attemptId !== success.attemptId ||
      attempt.idempotencyKey !== success.idempotencyKey ||
      attempt.submissionGeneration !== success.submissionGeneration ||
      (attempt.serverState === 'SUCCEEDED' && (
        !attempt.receipt ||
        !sameCommercialResultValue(commercialResult(attempt.receipt), success.commercialResult)
      ))
    ) return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
  }

  if (proof) {
    if (!attempt || !success || !reconciliationEvidenceMatches(proof, attempt, success)) {
      return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
    }
  }

  if (attempt?.reconciliationState === 'APPLIED' && !proof &&
      plan.operation !== 'CHECKOUT_CLEANUP' &&
      !isDiagnosticReviewTransition) {
    return { valid: false, reason: 'RECONCILIATION_EVIDENCE_MISSING' };
  }

  // Recording a real response is intentionally independent from Cart repair.
  // A valid pending Cart-only journal is allowed, but a journal that proposes
  // a different Attempt/Success identity must be compared before this write.
  if (plan.operation === 'SERVER_SUCCESS_RECORD' && liveJournalRaw) {
    const pending = parseJournal(liveJournalRaw);
    if (!pending) {
      // An unparseable journal is inert: recovery cannot apply it. Preserve it
      // byte-for-byte for review, but do not let it prevent durable capture of
      // a real server response in the independent success slot. If the journal
      // later becomes structurally valid, it must pass this same relational
      // boundary before any target can be applied.
      return { valid: true };
    }
    const pendingAttemptTarget = pending.targets.find(
      (target) => target.key === CHECKOUT_ATTEMPT_STORAGE_KEY
    );
    const pendingSuccessTarget = pending.targets.find(
      (target) => target.key === SERVER_SUCCESS_STORAGE_KEY
    );
    if (pendingSuccessTarget) return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
    if (pendingAttemptTarget?.postimage) {
      const pendingAttempt = parseAttemptPostimage(pendingAttemptTarget.postimage);
      if (!pendingAttempt || !success ||
          pendingAttempt.attemptId !== success.attemptId ||
          pendingAttempt.idempotencyKey !== success.idempotencyKey ||
          pendingAttempt.submissionGeneration !== success.submissionGeneration ||
          (pendingAttempt.serverState === 'SUCCEEDED' && (
            !pendingAttempt.receipt ||
            !sameCommercialResultValue(commercialResult(pendingAttempt.receipt), success.commercialResult)
          ))) {
        return { valid: false, reason: 'ATTEMPT_EVIDENCE_INVALID' };
      }
    }
  }

  return { valid: true };
}

function actualLockManager(): CommerceLockManager | null {
  const manager = globalThis.navigator?.locks;
  if (!manager) return null;
  return {
    request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
      return manager.request(name, callback);
    },
  };
}

export class CommerceStorageRepository {
  constructor(
    private readonly storage: SensitiveStorage,
    private readonly locks: CommerceLockManager | null = actualLockManager(),
    private readonly notify: () => void = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMMERCE_STORAGE_EVENT));
    }
  ) {}

  isSafeCoordinationSupported(): boolean {
    return this.locks !== null;
  }

  readSnapshot(): CommerceStorageSnapshot {
    const cart = readCartEnvelope(this.storage);
    const attempt = readAttemptEnvelope(this.storage);
    let successRaw: string | null = null;
    let reconciliationRaw: string | null = null;
    let journalRaw: string | null = null;
    let storageReadFailed = false;
    try {
      successRaw = this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
      reconciliationRaw = this.storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
      journalRaw = this.storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY);
    } catch {
      storageReadFailed = true;
    }
    const successEvidence = parseSuccessEvidence(successRaw);
    const reconciliationEvidence = parseReconciliationEvidence(reconciliationRaw);
    const journal = parseJournal(journalRaw);
    let reviewReason: CommerceReviewReason | undefined;
    if (storageReadFailed) reviewReason = 'STORAGE_CONFLICT';
    else if (successRaw && !successEvidence) reviewReason = 'ATTEMPT_EVIDENCE_INVALID';
    else if (reconciliationRaw && !reconciliationEvidence) reviewReason = 'ATTEMPT_EVIDENCE_INVALID';
    else if (journalRaw && !journal) reviewReason = 'JOURNAL_EVIDENCE_INVALID';
    else if (attempt.status === 'INVALID' || attempt.status === 'UNSUPPORTED_VERSION') {
      reviewReason = attempt.reviewReason;
    } else if (cart.status === 'UNSUPPORTED_VERSION') reviewReason = 'UNSUPPORTED_STATE_VERSION';
    else if (!journalRaw && successEvidence && (
      attempt.status !== 'VALID' ||
      !attempt.attempt ||
      attempt.attempt.attemptId !== successEvidence.attemptId ||
      attempt.attempt.idempotencyKey !== successEvidence.idempotencyKey ||
      attempt.attempt.submissionGeneration !== successEvidence.submissionGeneration
    )) reviewReason = 'ATTEMPT_EVIDENCE_INVALID';
    else if (!journalRaw && attempt.status === 'VALID' && attempt.attempt?.serverState === 'SUCCEEDED' &&
      attempt.attempt.reconciliationState === 'APPLIED') {
      if (!reconciliationEvidence) reviewReason = 'RECONCILIATION_EVIDENCE_MISSING';
      else if (!successEvidence || !reconciliationEvidenceMatches(
        reconciliationEvidence,
        attempt.attempt,
        successEvidence
      )) reviewReason = 'ATTEMPT_EVIDENCE_INVALID';
    } else if (!journalRaw && reconciliationEvidence) {
      if (
        attempt.status !== 'VALID' ||
        !attempt.attempt ||
        !successEvidence ||
        !reconciliationEvidenceMatches(reconciliationEvidence, attempt.attempt, successEvidence)
      ) reviewReason = 'ATTEMPT_EVIDENCE_INVALID';
    }
    return {
      cart,
      attempt,
      successEvidence,
      reconciliationEvidence,
      journalPending: Boolean(journalRaw),
      reviewReason,
    };
  }

  async withStorageLock<T>(work: () => Promise<T> | T): Promise<T> {
    if (!this.locks) {
      throw new Error('هذا المتصفح لا يوفر تنسيقًا آمنًا لعمليات السلة. استخدم متصفحًا محدثًا.');
    }
    return this.locks.request(STORAGE_LOCK_NAME, work);
  }

  async withSubmissionLock<T>(attemptId: string, work: () => Promise<T>): Promise<T> {
    if (!this.locks) {
      throw new Error('هذا المتصفح لا يوفر تنسيقًا آمنًا لإرسال الطلب.');
    }
    return this.locks.request(`nawasrah-commerce-submit-${attemptId}`, work);
  }

  async recoverPendingJournal(): Promise<JournalRecoveryResult> {
    return this.withStorageLock(() => this.recoverPendingJournalLocked());
  }

  private recoverPendingJournalLocked(): JournalRecoveryResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY);
    } catch {
      return { status: 'PENDING' };
    }
    if (!raw) return { status: 'NONE' };
    let journal = parseJournal(raw);
    if (!journal) return { status: 'REVIEW_REQUIRED', reason: 'JOURNAL_EVIDENCE_INVALID' };
    if (journal.operation === 'CHECKOUT_RECONCILIATION') {
      const attemptTarget = journal.targets.find((target) => target.key === CHECKOUT_ATTEMPT_STORAGE_KEY);
      const cartTarget = journal.targets.find((target) => target.key === CART_STORAGE_KEY);
      const attemptPost = attemptTarget?.postimage ? readAttemptEnvelope({
        getItem: () => attemptTarget.postimage,
      }) : null;
      const cartPost = cartTarget?.postimage ? readCartEnvelope({
        getItem: () => cartTarget.postimage,
      }) : null;
      const attempt = attemptPost?.status === 'VALID' ? attemptPost.attempt : null;
      const success = parseSuccessEvidence(this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY));
      const marker = attempt && cartPost?.envelope
        ? cartPost.envelope.reconciliations.find((entry) => entry.attemptId === attempt.attemptId)
        : null;
      const existingProofRaw = this.storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY);
      const existingProof = parseReconciliationEvidence(existingProofRaw);
      if (
        !attempt ||
        !cartPost?.envelope ||
        !success ||
        !successEvidenceMatchesAttempt(success, attempt) ||
        !marker ||
        marker.orderId !== success.commercialResult.orderId ||
        marker.orderId !== attempt.receipt?.id
      ) {
        return { status: 'REVIEW_REQUIRED', reason: 'JOURNAL_EVIDENCE_INVALID' };
      }
      if (existingProofRaw !== null && (
        !existingProof ||
        !reconciliationEvidenceMatches(existingProof, attempt, success) ||
        existingProof.cartMutationId !== marker.mutationId ||
        existingProof.cartRevisionAtApply !== cartPost.envelope.revision ||
        existingProof.appliedAt !== marker.appliedAt
      )) {
        return { status: 'REVIEW_REQUIRED', reason: 'JOURNAL_EVIDENCE_INVALID' };
      }
      if (
        !journal.targets.some((target) => target.key === RECONCILIATION_EVIDENCE_STORAGE_KEY) &&
        existingProofRaw === null
      ) {
        const evidence = buildReconciliationEvidence(
          attempt,
          success,
          marker.mutationId,
          cartPost.envelope.revision,
          marker.appliedAt
        );
        const upgraded: CommerceWriteJournalV1 = {
          ...journal,
          targets: [
            ...journal.targets,
            {
              key: RECONCILIATION_EVIDENCE_STORAGE_KEY,
              preimage: null,
              postimage: JSON.stringify(evidence),
            },
          ],
        };
        // Keep the persisted legacy journal byte-for-byte intact until every
        // live target has passed conflict validation. The proof target is
        // upgraded in memory and participates in the same locked validation
        // and application pass as the original targets.
        journal = upgraded;
      }
    }
    const validated = validateCommerceMutationPlan(journal, this.storage);
    if (!validated.valid) {
      return {
        status: 'REVIEW_REQUIRED',
        reason: validated.reason ?? 'JOURNAL_EVIDENCE_INVALID',
      };
    }
    let values: Array<string | null>;
    try {
      values = journal.targets.map((target) => this.storage.getItem(target.key));
    } catch {
      return { status: 'PENDING' };
    }
    const recognized = values.every((value, index) =>
      value === journal.targets[index].preimage || value === journal.targets[index].postimage
    );
    if (!recognized) return { status: 'REVIEW_REQUIRED', reason: 'STORAGE_CONFLICT' };
    try {
      journal.targets.forEach((target, index) => {
        if (values[index] === target.postimage) return;
        if (target.postimage === null) this.storage.removeItem(target.key);
        else this.storage.setItem(target.key, target.postimage);
      });
      const complete = journal.targets.every(
        (target) => this.storage.getItem(target.key) === target.postimage
      );
      if (!complete) return { status: 'PENDING' };
      this.storage.removeItem(COMMERCE_JOURNAL_STORAGE_KEY);
      this.notify();
      return { status: 'COMPLETED' };
    } catch {
      return { status: 'PENDING' };
    }
  }

  private transactLocked(
    operation: CommerceWriteJournalV1['operation'],
    targets: Array<{ key: string; postimage: string | null }>,
    attemptId?: string
  ): void {
    const pending = this.recoverPendingJournalLocked();
    if (pending.status === 'PENDING') throw new Error('عملية حفظ سابقة ما زالت معلقة.');
    if (pending.status === 'REVIEW_REQUIRED') throw new Error('بيانات الحفظ تحتاج مراجعة قبل المتابعة.');
    if (targets.some((target) => !ALLOWED_JOURNAL_TARGETS.has(target.key))) {
      throw new Error('محاولة كتابة إلى مفتاح تخزين غير مسموح.');
    }
    const mutationId = newId();
    const journal: CommerceWriteJournalV1 = {
      version: 1,
      mutationId,
      operation,
      attemptId,
      targets: targets.map((target) => ({
        ...target,
        preimage: this.storage.getItem(target.key),
      })),
      createdAt: Date.now(),
    };
    const validated = validateCommerceMutationPlan(journal, this.storage);
    if (!validated.valid) {
      throw new Error('تعارضت أدلة الحفظ المحلية؛ لم يتم تغيير الحالة.');
    }
    this.storage.setItem(COMMERCE_JOURNAL_STORAGE_KEY, JSON.stringify(journal));
    if (!parseJournal(this.storage.getItem(COMMERCE_JOURNAL_STORAGE_KEY))) {
      throw new Error('تعذر تثبيت سجل الحفظ؛ لم تُغيّر البيانات المستهدفة.');
    }
    journal.targets.forEach((target) => {
      if (target.postimage === null) this.storage.removeItem(target.key);
      else this.storage.setItem(target.key, target.postimage);
    });
    const verified = journal.targets.every(
      (target) => this.storage.getItem(target.key) === target.postimage
    );
    if (!verified) throw new Error('تعذر إثبات اكتمال الحفظ المحلي.');
    this.storage.removeItem(COMMERCE_JOURNAL_STORAGE_KEY);
    this.notify();
  }

  async mutateCart(
    mutate: (items: CartItem[]) => CartItem[],
    expectedRevision?: number
  ): Promise<CartEnvelopeV3> {
    return this.withStorageLock(() => {
      const pending = this.recoverPendingJournalLocked();
      if (pending.status === 'PENDING') throw new Error('عملية حفظ سابقة ما زالت معلقة.');
      if (pending.status === 'REVIEW_REQUIRED') throw new Error('السلة تحتاج مراجعة قبل التعديل.');
      const current = readCartEnvelope(this.storage);
      if (!current.envelope || !['ABSENT', 'VALID', 'VALID_EMPTY'].includes(current.status)) {
        throw new Error('السلة المحفوظة تحتاج معالجة صريحة قبل تعديلها.');
      }
      if (expectedRevision !== undefined && current.envelope.revision !== expectedRevision) {
        throw new Error('تغيّرت السلة في نافذة أخرى. أعد المحاولة على الحالة الجديدة.');
      }
      const mutationId = newId();
      const items = mutate(clone(current.envelope.items));
      if (!items.every(isCurrentCartItem) || !uniqueCartIdentities(items)) {
        throw new Error('نتيجة تعديل السلة غير صالحة للحفظ.');
      }
      const attempt = readAttemptEnvelope(this.storage);
      const success = parseSuccessEvidence(this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY));
      const reconciliation = parseReconciliationEvidence(
        this.storage.getItem(RECONCILIATION_EVIDENCE_STORAGE_KEY)
      );
      const effectivelyReconciled = Boolean(
        attempt.status === 'VALID' &&
        attempt.attempt &&
        success &&
        reconciliation &&
        attempt.attempt.serverState === 'SUCCEEDED' &&
        attempt.attempt.reconciliationState === 'APPLIED' &&
        reconciliationEvidenceMatches(reconciliation, attempt.attempt, success)
      );
      if (
        attempt.status === 'VALID' &&
        attempt.attempt &&
        !protectedSubmittedLinesUnchanged(
          current.envelope.items,
          items,
          attempt.attempt,
          effectivelyReconciled
        )
      ) {
        throw new Error('هذا السطر مرتبط بمحاولة طلب غير محسومة؛ أضف التغيير كسطر مستقل.');
      }
      const envelope: CartEnvelopeV3 = {
        ...current.envelope,
        revision: current.envelope.revision + 1,
        lastMutationId: mutationId,
        items: clone(items),
      };
      this.transactLocked('CART_MUTATION', [
        { key: CART_STORAGE_KEY, postimage: JSON.stringify(envelope) },
      ]);
      return envelope;
    });
  }

  async resolveCartRecovery(
    recovery: CartStorageRecovery,
    action: 'KEEP_VALID_ITEMS' | 'RESET_CART'
  ): Promise<CartEnvelopeV3> {
    return this.withStorageLock(() => {
      if (recovery.originalRaw === null) throw new Error('تخزين السلة غير متاح.');
      if (this.storage.getItem(CART_STORAGE_KEY) !== recovery.originalRaw) {
        throw new Error('تغيّرت السلة في نافذة أخرى. أعد تحميلها قبل المعالجة.');
      }
      const mutationId = newId();
      const envelope: CartEnvelopeV3 = {
        ...emptyEnvelope(),
        revision: 1,
        lastMutationId: mutationId,
        items: clone(action === 'KEEP_VALID_ITEMS' ? recovery.validItems : []),
        reconciliations: clone(recovery.reconciliations ?? []),
      };
      this.transactLocked('CART_RECOVERY', [
        { key: CART_RECOVERY_BACKUP_STORAGE_KEY, postimage: recovery.originalRaw },
        { key: CART_STORAGE_KEY, postimage: JSON.stringify(envelope) },
      ]);
      return envelope;
    });
  }

  async persistAttempt(attempt: PersistedCheckoutAttemptV2): Promise<PersistedCheckoutAttemptV2> {
    if (!isCheckoutAttemptV2(attempt)) throw new Error('حالة محاولة الطلب غير صالحة.');
    return this.withStorageLock(() => {
      const current = readAttemptEnvelope(this.storage);
      if (current.status === 'VALID' && current.attempt) {
        if (current.attempt.attemptId !== attempt.attemptId) {
          throw new Error('توجد محاولة طلب أخرى غير محسومة.');
        }
        if (attempt.revision <= current.attempt.revision) {
          throw new Error('وصل انتقال قديم لمحاولة الطلب وتم تجاهله.');
        }
        if (current.attempt.serverState === 'SUCCEEDED' && attempt.serverState !== 'SUCCEEDED') {
          throw new Error('لا يمكن تخفيض نجاح خادم مثبت.');
        }
        if (!validAttemptTransition(current.attempt, attempt)) {
          throw new Error('انتقال محاولة الطلب غير صالح أو يغيّر هويتها الثابتة.');
        }
      } else if (current.status !== 'ABSENT') {
        throw new Error('دليل محاولة الطلب يحتاج مراجعة.');
      } else if (this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY) !== null) {
        throw new Error('يوجد دليل نجاح سابق دون محاولة مرتبطة؛ يلزم مراجعته قبل طلب جديد.');
      }
      this.transactLocked('ATTEMPT_TRANSITION', [
        { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(attempt) },
      ], attempt.attemptId);
      return clone(attempt);
    });
  }

  async recordServerSuccess(
    attempt: PersistedCheckoutAttemptV2,
    receipt: GuestOrderReceipt
  ): Promise<PersistedServerSuccessEvidence> {
    return this.withStorageLock(() => {
      const currentAttempt = readAttemptEnvelope(this.storage);
      if (
        currentAttempt.status !== 'VALID' ||
        !currentAttempt.attempt ||
        currentAttempt.attempt.attemptId !== attempt.attemptId ||
        currentAttempt.attempt.idempotencyKey !== attempt.idempotencyKey ||
        currentAttempt.attempt.submissionGeneration !== attempt.submissionGeneration
      ) throw new Error('نتيجة الخادم لا ترتبط بمحاولة الطلب الحالية.');
      const evidence: PersistedServerSuccessEvidence = {
        version: 1,
        attemptId: attempt.attemptId,
        idempotencyKey: attempt.idempotencyKey,
        submissionGeneration: attempt.submissionGeneration,
        commercialResult: commercialResult(receipt),
        receipt: clone(receipt),
        recordedAt: Date.now(),
      };
      const existingRaw = this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY);
      const existing = parseSuccessEvidence(existingRaw);
      if (existingRaw && !existing) {
        throw new Error('دليل نجاح محفوظ غير صالح ويحتاج مراجعة؛ لم يتم استبداله.');
      }
      if (existing) {
        if (
          existing.attemptId !== evidence.attemptId ||
          existing.idempotencyKey !== evidence.idempotencyKey ||
          !sameCommercialResult(existing, evidence)
        ) throw new Error('تعارضت نتيجة الخادم مع دليل نجاح محفوظ؛ لم يتم استبداله.');
        return existing;
      }
      const validated = validateCommerceMutationPlan({
        operation: 'SERVER_SUCCESS_RECORD',
        attemptId: attempt.attemptId,
        targets: [{
          key: SERVER_SUCCESS_STORAGE_KEY,
          preimage: existingRaw,
          postimage: JSON.stringify(evidence),
        }],
      }, this.storage);
      if (!validated.valid) {
        throw new Error('تعارضت نتيجة الخادم مع أدلة المحاولة الحالية؛ لم يتم استبدالها.');
      }
      this.storage.setItem(SERVER_SUCCESS_STORAGE_KEY, JSON.stringify(evidence));
      const verified = parseSuccessEvidence(this.storage.getItem(SERVER_SUCCESS_STORAGE_KEY));
      if (!verified || !sameCommercialResult(verified, evidence)) {
        throw new Error('تعذر تثبيت دليل نجاح الخادم محليًا.');
      }
      this.notify();
      return verified;
    });
  }

  async reconcileSuccessfulAttempt(
    attemptId: string
  ): Promise<{ status: 'RECONCILED' | 'BLOCKED_CART' | 'PENDING' | 'REVIEW_REQUIRED'; snapshot: CommerceStorageSnapshot }> {
    return this.withStorageLock(() => {
      const journal = this.recoverPendingJournalLocked();
      if (journal.status === 'PENDING') return { status: 'PENDING', snapshot: this.readSnapshot() };
      if (journal.status === 'REVIEW_REQUIRED') {
        return { status: 'REVIEW_REQUIRED', snapshot: this.readSnapshot() };
      }
      const snapshot = this.readSnapshot();
      if (
        snapshot.reviewReason &&
        snapshot.reviewReason !== 'RECONCILIATION_EVIDENCE_MISSING'
      ) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      if (!snapshot.successEvidence || snapshot.successEvidence.attemptId !== attemptId) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      if (snapshot.attempt.status !== 'VALID' || !snapshot.attempt.attempt) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      const attempt = snapshot.attempt.attempt;
      if (
        attempt.attemptId !== attemptId ||
        attempt.idempotencyKey !== snapshot.successEvidence.idempotencyKey ||
        attempt.submissionGeneration !== snapshot.successEvidence.submissionGeneration
      ) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      if (
        attempt.serverState === 'SUCCEEDED' &&
        attempt.receipt &&
        !sameCommercialResultValue(
          commercialResult(attempt.receipt),
          snapshot.successEvidence.commercialResult
        )
      ) {
        return { status: 'REVIEW_REQUIRED', snapshot };
      }
      if (snapshot.reconciliationEvidence) {
        if (!reconciliationEvidenceMatches(
          snapshot.reconciliationEvidence,
          attempt,
          snapshot.successEvidence
        )) {
          return { status: 'REVIEW_REQUIRED', snapshot };
        }
        if (attempt.reconciliationState !== 'APPLIED' || attempt.reviewRequired) {
          const completed: PersistedCheckoutAttemptV2 = {
            ...attempt,
            revision: attempt.revision + 1,
            serverState: 'SUCCEEDED',
            reconciliationState: 'APPLIED',
            receipt: clone(snapshot.successEvidence.receipt),
            reviewRequired: undefined,
            updatedAt: Date.now(),
          };
          this.transactLocked('ATTEMPT_TRANSITION', [
            { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(completed) },
          ], attemptId);
        }
        return { status: 'RECONCILED', snapshot: this.readSnapshot() };
      }
      if (!snapshot.cart.envelope || !['ABSENT', 'VALID', 'VALID_EMPTY'].includes(snapshot.cart.status)) {
        const blocked: PersistedCheckoutAttemptV2 = {
          ...attempt,
          revision: attempt.revision + 1,
          serverState: 'SUCCEEDED',
          reconciliationState: 'BLOCKED_CART',
          receipt: clone(snapshot.successEvidence.receipt),
          updatedAt: Date.now(),
          reviewRequired: {
            reason: 'CART_RECOVERY_REQUIRED',
            message: 'السلة تحتاج معالجة صريحة قبل إكمال تسوية الطلب.',
            automaticRecoveryAllowed: false,
            userCartDecisionRequired: true,
            externalOrderVerificationRequired: false,
            newCheckoutBlocked: true,
          },
        };
        this.transactLocked('ATTEMPT_TRANSITION', [
          { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(blocked) },
        ], attemptId);
        return { status: 'BLOCKED_CART', snapshot: this.readSnapshot() };
      }
      const previousEvidence = snapshot.cart.envelope.reconciliations.find(
        (entry) => entry.attemptId === attemptId
      );
      if (previousEvidence) {
        if (previousEvidence.orderId !== snapshot.successEvidence.commercialResult.orderId) {
          if (attempt.reviewRequired?.reason !== 'ATTEMPT_EVIDENCE_INVALID') {
            const reviewAttempt: PersistedCheckoutAttemptV2 = {
              ...attempt,
              revision: attempt.revision + 1,
              reviewRequired: reviewPolicyFor('ATTEMPT_EVIDENCE_INVALID'),
              updatedAt: Date.now(),
            };
            this.transactLocked('ATTEMPT_TRANSITION', [
              { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(reviewAttempt) },
            ], attemptId);
          }
          return { status: 'REVIEW_REQUIRED', snapshot: this.readSnapshot() };
        }
        const completed: PersistedCheckoutAttemptV2 = {
          ...attempt,
          revision: attempt.revision + 1,
          serverState: 'SUCCEEDED',
          reconciliationState: 'APPLIED',
          receipt: clone(snapshot.successEvidence.receipt),
          reviewRequired: undefined,
          updatedAt: Date.now(),
        };
        const evidence = buildReconciliationEvidence(
          completed,
          snapshot.successEvidence,
          previousEvidence.mutationId,
          snapshot.cart.envelope.revision,
          previousEvidence.appliedAt
        );
        this.transactLocked('CHECKOUT_RECONCILIATION', [
          { key: CART_STORAGE_KEY, postimage: JSON.stringify(snapshot.cart.envelope) },
          { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(completed) },
          { key: RECONCILIATION_EVIDENCE_STORAGE_KEY, postimage: JSON.stringify(evidence) },
        ], attemptId);
        return { status: 'RECONCILED', snapshot: this.readSnapshot() };
      }
      if (attempt.reconciliationState === 'APPLIED') {
        if (attempt.reviewRequired?.reason !== 'RECONCILIATION_EVIDENCE_MISSING') {
          const reviewAttempt: PersistedCheckoutAttemptV2 = {
            ...attempt,
            revision: attempt.revision + 1,
            reviewRequired: reviewPolicyFor('RECONCILIATION_EVIDENCE_MISSING'),
            updatedAt: Date.now(),
          };
          this.transactLocked('ATTEMPT_TRANSITION', [
            { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(reviewAttempt) },
          ], attemptId);
        }
        return { status: 'REVIEW_REQUIRED', snapshot: this.readSnapshot() };
      }
      const reconciliation = reconcileSubmittedCartItems(
        snapshot.cart.envelope.items,
        attempt.submittedItems
      );
      if (reconciliation.conflict) {
        if (attempt.reviewRequired?.reason !== 'STORAGE_CONFLICT') {
          const reviewAttempt: PersistedCheckoutAttemptV2 = {
            ...attempt,
            revision: attempt.revision + 1,
            reviewRequired: reviewPolicyFor('STORAGE_CONFLICT'),
            updatedAt: Date.now(),
          };
          this.transactLocked('ATTEMPT_TRANSITION', [
            { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(reviewAttempt) },
          ], attemptId);
        }
        return { status: 'REVIEW_REQUIRED', snapshot: this.readSnapshot() };
      }
      const mutationId = newId();
      const cart: CartEnvelopeV3 = {
        ...snapshot.cart.envelope,
        revision: snapshot.cart.envelope.revision + 1,
        lastMutationId: mutationId,
        items: reconciliation.items,
        reconciliations: [
          ...snapshot.cart.envelope.reconciliations.filter((entry) => entry.attemptId !== attemptId),
          {
            attemptId,
            orderId: snapshot.successEvidence.commercialResult.orderId,
            mutationId,
            appliedAt: Date.now(),
          },
        ].slice(-MAX_RECONCILIATION_EVIDENCE),
      };
      const completed: PersistedCheckoutAttemptV2 = {
        ...attempt,
        revision: attempt.revision + 1,
        serverState: 'SUCCEEDED',
        reconciliationState: 'APPLIED',
        receipt: clone(snapshot.successEvidence.receipt),
        reviewRequired: undefined,
        updatedAt: Date.now(),
      };
      const evidence = buildReconciliationEvidence(
        completed,
        snapshot.successEvidence,
        mutationId,
        cart.revision,
        cart.reconciliations[cart.reconciliations.length - 1].appliedAt
      );
      this.transactLocked('CHECKOUT_RECONCILIATION', [
        { key: CART_STORAGE_KEY, postimage: JSON.stringify(cart) },
        { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: JSON.stringify(completed) },
        { key: RECONCILIATION_EVIDENCE_STORAGE_KEY, postimage: JSON.stringify(evidence) },
      ], attemptId);
      return { status: 'RECONCILED', snapshot: this.readSnapshot() };
    });
  }

  async clearResolvedAttempt(attemptId: string): Promise<void> {
    return this.withStorageLock(() => {
      const pending = this.recoverPendingJournalLocked();
      if (pending.status !== 'NONE' && pending.status !== 'COMPLETED') return;
      const snapshot = this.readSnapshot();
      const attempt = snapshot.attempt;
      if (
        attempt.status !== 'VALID' ||
        !attempt.attempt ||
        attempt.attempt.attemptId !== attemptId
      ) return;
      if (['REJECTED', 'ABANDONED'].includes(attempt.attempt.serverState)) {
        if (snapshot.successEvidence || snapshot.reconciliationEvidence || snapshot.reviewReason) return;
        this.transactLocked('ATTEMPT_TRANSITION', [
          { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: null },
          { key: SERVER_SUCCESS_STORAGE_KEY, postimage: null },
        ], attemptId);
        return;
      }
      if (
        attempt.attempt.serverState !== 'SUCCEEDED' ||
        attempt.attempt.reconciliationState !== 'APPLIED' ||
        !snapshot.successEvidence ||
        !snapshot.reconciliationEvidence ||
        !reconciliationEvidenceMatches(
          snapshot.reconciliationEvidence,
          attempt.attempt,
          snapshot.successEvidence
        ) ||
        !snapshot.cart.raw ||
        !snapshot.cart.envelope ||
        !['VALID', 'VALID_EMPTY'].includes(snapshot.cart.status)
      ) return;
      const mutationId = newId();
      const cleanedCart: CartEnvelopeV3 = {
        ...snapshot.cart.envelope,
        revision: snapshot.cart.envelope.revision + 1,
        lastMutationId: mutationId,
        reconciliations: snapshot.cart.envelope.reconciliations.filter(
          (entry) => entry.attemptId !== attemptId
        ),
      };
      this.transactLocked('CHECKOUT_CLEANUP', [
        { key: CART_STORAGE_KEY, postimage: JSON.stringify(cleanedCart) },
        { key: CHECKOUT_ATTEMPT_STORAGE_KEY, postimage: null },
        { key: SERVER_SUCCESS_STORAGE_KEY, postimage: null },
        { key: RECONCILIATION_EVIDENCE_STORAGE_KEY, postimage: null },
      ], attemptId);
    });
  }
}

export function createBrowserCommerceStorage(): CommerceStorageRepository {
  return new CommerceStorageRepository(window.localStorage);
}
