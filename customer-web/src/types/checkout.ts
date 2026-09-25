import { CartItem } from './catalog';

export type GuestPaymentMethod = 'cash_on_delivery' | 'cliq';
export type DeliveryZone = 'inside_ramtha' | 'outside_ramtha';

export interface GuestCheckoutForm {
  fullName: string;
  phone: string;
  governorate: string;
  city: string;
  area: string;
  street: string;
  building: string;
  addressNotes: string;
  googleMapsUrl: string;
  latitude: number | null;
  longitude: number | null;
  customerNotes: string;
}

export type CheckoutField = {
  [Field in keyof GuestCheckoutForm]: GuestCheckoutForm[Field] extends string
    ? Field
    : never;
}[keyof GuestCheckoutForm];

export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

export interface GuestOrderItem {
  product_id: string;
  quantity: number;
}

export type GuestOrderV2Line =
  | {
      commercial_line_kind: 'base_unit';
      product_id: string;
      base_quantity: number;
      expected_unit_price_in_minor_units: number;
    }
  | {
      commercial_line_kind: 'legacy_single_sku_parcel';
      product_id: string;
      parcel_quantity: number;
      units_per_parcel: number;
      expected_unit_price_in_minor_units: number;
    }
  | {
      commercial_line_kind: 'configurable_parcel';
      family_product_id: string;
      parcel_configuration_id: string;
      configuration_revision: number;
      expected_unit_price_in_minor_units: number;
      parcel_instances: Array<{
        components: Array<{ product_id: string; base_quantity: number }>;
      }>;
    };

export interface ExpectedGuestOrderQuote {
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  deliveryFeeInMinorUnits: number;
  totalInMinorUnits: number;
}

export interface GuestOrderRequest {
  contractVersion?: 'phase3-customer-reservation-v2';
  idempotencyKey: string;
  turnstileToken: string;
  clientSessionId: string;
  customer: GuestCheckoutForm;
  items: GuestOrderItem[] | GuestOrderV2Line[];
  promotionCode?: string;
  paymentMethod: GuestPaymentMethod;
  deliveryZone: DeliveryZone;
  expectedQuote?: ExpectedGuestOrderQuote;
}

export interface GuestPromotionQuote {
  success: true;
  promotionCodeId: string;
  code: string;
  description: string;
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  totalInMinorUnits: number;
  message: string;
}

export interface GuestPromotionQuoteV2 {
  success: true;
  contractVersion: 'phase3-customer-promotion-preview-v2';
  code: string;
  description: string;
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  totalInMinorUnits: number;
  message: string;
}

export interface GuestOrderReceipt {
  success: true;
  id: string;
  orderNumber: string;
  customerId: string;
  customerAddressId: string;
  customerReused: boolean;
  idempotentReplay: boolean;
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  totalInMinorUnits: number;
  deliveryFeeInMinorUnits: number;
  deliveryZone: DeliveryZone;
  promotionCode: string;
  status: string;
  paymentMethod: GuestPaymentMethod;
  /**
   * Per-order opaque capability returned only after the gateway has accepted
   * this customer's order. It is never derived from the order number.
   */
  trackingToken?: string;
  trackingPath?: string;
  message: string;
}

export interface PendingGuestOrder {
  fingerprint: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface WhatsAppOrderSummary {
  receipt: GuestOrderReceipt;
  items: CartItem[];
  paymentMethod: GuestPaymentMethod;
}

export interface SavedGuestCustomer {
  version: 3;
  customer: Omit<GuestCheckoutForm, 'customerNotes'>;
  savedAt: number;
  expiresAt: number;
}

export interface LastGuestOrder {
  version: 2;
  orderNumber: string;
  items: CartItem[];
  createdAt: number;
}

export type CheckoutAttemptState =
  | 'IN_FLIGHT'
  | 'UNKNOWN'
  | 'SUCCESS_PENDING_RECONCILIATION'
  | 'RECONCILED'
  | 'TERMINAL_REJECTED';

export type CheckoutServerState =
  | 'PREPARED'
  | 'IN_FLIGHT'
  | 'UNKNOWN'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'ABANDONED';

export type CheckoutReconciliationState =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'BLOCKED_CART'
  | 'WRITE_OUTCOME_UNKNOWN'
  | 'APPLIED';

export type CommerceReviewReason =
  | 'CART_RECOVERY_REQUIRED'
  | 'ATTEMPT_EVIDENCE_INVALID'
  | 'RECONCILIATION_EVIDENCE_MISSING'
  | 'AMBIGUOUS_LEGACY_WRITE_OUTCOME'
  | 'STORAGE_CONFLICT'
  | 'UNSUPPORTED_STATE_VERSION'
  | 'JOURNAL_EVIDENCE_INVALID';

export interface CheckoutReviewRequired {
  reason: CommerceReviewReason;
  message: string;
  automaticRecoveryAllowed: boolean;
  userCartDecisionRequired: boolean;
  externalOrderVerificationRequired: boolean;
  newCheckoutBlocked: true;
}

export interface PersistedCheckoutAttemptV2 {
  version: 2;
  revision: number;
  attemptId: string;
  submissionGeneration: string;
  serverState: CheckoutServerState;
  reconciliationState: CheckoutReconciliationState;
  idempotencyKey: string;
  clientSessionId: string;
  request: Omit<GuestOrderRequest, 'turnstileToken'>;
  submittedItems: CartItem[];
  createdAt: number;
  updatedAt: number;
  receipt?: GuestOrderReceipt;
  terminalMessage?: string;
  reviewRequired?: CheckoutReviewRequired;
}

export interface PersistedServerSuccessEvidence {
  version: 1;
  attemptId: string;
  idempotencyKey: string;
  submissionGeneration: string;
  commercialResult: {
    orderId: string;
    orderNumber: string;
    subtotalInMinorUnits: number;
    discountInMinorUnits: number;
    deliveryFeeInMinorUnits: number;
    totalInMinorUnits: number;
    paymentMethod: GuestPaymentMethod;
    deliveryZone: DeliveryZone;
  };
  receipt: GuestOrderReceipt;
  recordedAt: number;
}

export type CartReconciliationStatus =
  | 'PENDING'
  | 'BLOCKED_INVALID_CART'
  | 'BLOCKED_STORAGE_CONFLICT'
  | 'WRITE_OUTCOME_UNKNOWN'
  | 'APPLIED';

export interface PersistedCheckoutAttempt {
  version: 1;
  attemptId: string;
  state: CheckoutAttemptState;
  idempotencyKey: string;
  clientSessionId: string;
  request: Omit<GuestOrderRequest, 'turnstileToken'>;
  submittedItems: CartItem[];
  createdAt: number;
  updatedAt: number;
  receipt?: GuestOrderReceipt;
  cartReconciliationStatus?: CartReconciliationStatus;
  terminalMessage?: string;
}

export interface GuestOrderTracking {
  success: true;
  orderNumber: string;
  status: string;
  paymentMethod: GuestPaymentMethod;
  paymentStatus: string;
  totalInMinorUnits: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  trackingToken: string;
  trackingPath: string;
  deliveryStartedAt?: string;
  estimatedArrivalAt?: string;
  deliveryCompletedAt?: string;
  driverPhone?: string;
  timeline: Array<{ status: string; createdAt: string }>;
}
