export type StorefrontOfferDiscountType = 'fixed' | 'percentage';

export interface StorefrontOffer {
  id: string;
  code: string;
  description: string;
  discountType: StorefrontOfferDiscountType;
  discountValue: number;
  minimumSubtotalInMinorUnits: number;
  maximumDiscountInMinorUnits?: number;
  startsAt?: string;
  expiresAt?: string;
}
