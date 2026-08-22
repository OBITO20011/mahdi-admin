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

export interface GuestOrderRequest {
  idempotencyKey: string;
  customer: GuestCheckoutForm;
  items: GuestOrderItem[];
  promotionCode?: string;
  paymentMethod: GuestPaymentMethod;
  deliveryZone: DeliveryZone;
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
  message: string;
}

export interface PendingGuestOrder {
  fingerprint: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface WhatsAppOrderSummary {
  receipt: GuestOrderReceipt;
  customer: GuestCheckoutForm;
  items: CartItem[];
  paymentMethod: GuestPaymentMethod;
}

export interface SavedGuestCustomer {
  version: 1;
  customer: GuestCheckoutForm;
  savedAt: number;
}

export interface LastGuestOrder {
  version: 1;
  orderNumber: string;
  items: Array<{ productId: string; quantity: number }>;
  createdAt: number;
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
