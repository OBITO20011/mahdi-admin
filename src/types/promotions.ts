export type PromotionDiscountType = 'fixed' | 'percentage';

export interface PromotionCode {
  id: string;
  code: string;
  description: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minimumSubtotal: number;
  maximumDiscount?: number;
  startsAt?: string;
  expiresAt?: string;
  maximumTotalRedemptions?: number;
  maximumRedemptionsPerPhone: number;
  isActive: boolean;
  isPublicOffer: boolean;
  redemptionCount: number;
  redeemedDiscountTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionCodeInput {
  id?: string;
  code: string;
  description?: string;
  discountType: PromotionDiscountType;
  discountValue: number;
  minimumSubtotal: number;
  maximumDiscount?: number;
  startsAt?: string;
  expiresAt?: string;
  maximumTotalRedemptions?: number;
  maximumRedemptionsPerPhone: number;
  isActive: boolean;
  isPublicOffer: boolean;
}
