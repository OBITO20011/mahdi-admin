import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  PromotionCode,
  PromotionCodeInput,
} from '../../types/promotions';

type RpcRecord = Record<string, unknown>;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalText(value: unknown): string | undefined {
  const text = textValue(value);
  return text || undefined;
}

function mapPromotionCode(row: RpcRecord): PromotionCode {
  const discountType =
    row.discount_type === 'percentage' ? 'percentage' : 'fixed';
  const rawDiscountValue = numberValue(row.discount_value);

  return {
    id: textValue(row.id),
    code: textValue(row.code),
    description: textValue(row.description_ar),
    discountType,
    discountValue:
      discountType === 'percentage'
        ? rawDiscountValue / 100
        : rawDiscountValue / 1000,
    minimumSubtotal:
      numberValue(row.minimum_subtotal_in_minor_units) / 1000,
    maximumDiscount:
      optionalNumber(row.maximum_discount_in_minor_units) === undefined
        ? undefined
        : numberValue(row.maximum_discount_in_minor_units) / 1000,
    startsAt: optionalText(row.starts_at),
    expiresAt: optionalText(row.expires_at),
    maximumTotalRedemptions: optionalNumber(
      row.maximum_total_redemptions
    ),
    maximumRedemptionsPerPhone: Math.max(
      1,
      Math.round(numberValue(row.maximum_redemptions_per_phone))
    ),
    isActive: row.is_active === true,
    isPublicOffer: row.is_public_offer === true,
    redemptionCount: Math.max(
      0,
      Math.round(numberValue(row.redemption_count))
    ),
    redeemedDiscountTotal:
      numberValue(row.redeemed_discount_in_minor_units) / 1000,
    createdAt: textValue(row.created_at),
    updatedAt: textValue(row.updated_at),
  };
}

function requireConfiguredClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  return supabase;
}

export async function fetchPromotionCodes(): Promise<PromotionCode[]> {
  const client = requireConfiguredClient();
  const { data, error } = await client.rpc('get_promotion_codes');
  if (error) {
    throw new Error(error.message || 'تعذر تحميل رموز الخصم.');
  }

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر تحميل رموز الخصم.');
  }

  const codes = Array.isArray(payload.codes) ? payload.codes : [];
  return codes.map((row) => mapPromotionCode(row as RpcRecord));
}

export async function savePromotionCode(
  input: PromotionCodeInput
): Promise<string> {
  const client = requireConfiguredClient();
  const discountValue =
    input.discountType === 'percentage'
      ? Math.round(input.discountValue * 100)
      : Math.round(input.discountValue * 1000);
  const { data, error } = await client.rpc('upsert_promotion_code', {
    p_code: input.code.trim().toUpperCase(),
    p_discount_type: input.discountType,
    p_discount_value: discountValue,
    p_promotion_code_id: input.id || null,
    p_description_ar: input.description?.trim() || null,
    p_minimum_subtotal_in_minor_units: Math.round(
      Math.max(0, input.minimumSubtotal) * 1000
    ),
    p_maximum_discount_in_minor_units:
      input.maximumDiscount && input.maximumDiscount > 0
        ? Math.round(input.maximumDiscount * 1000)
        : null,
    p_starts_at: input.startsAt || null,
    p_expires_at: input.expiresAt || null,
    p_maximum_total_redemptions:
      input.maximumTotalRedemptions &&
      input.maximumTotalRedemptions > 0
        ? Math.floor(input.maximumTotalRedemptions)
        : null,
    p_maximum_redemptions_per_phone: Math.max(
      1,
      Math.floor(input.maximumRedemptionsPerPhone)
    ),
    p_is_active: input.isActive,
    p_is_public_offer: input.isPublicOffer,
  });

  if (error) {
    throw new Error(error.message || 'تعذر حفظ رمز الخصم.');
  }
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(textValue(payload.message) || 'تعذر حفظ رمز الخصم.');
  }
  return textValue(payload.message) || 'تم حفظ رمز الخصم.';
}

export async function setPromotionCodeActive(
  promotionCodeId: string,
  isActive: boolean
): Promise<string> {
  const client = requireConfiguredClient();
  const { data, error } = await client.rpc(
    'set_promotion_code_active',
    {
      p_promotion_code_id: promotionCodeId,
      p_is_active: isActive,
    }
  );

  if (error) {
    throw new Error(error.message || 'تعذر تحديث حالة رمز الخصم.');
  }
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(
      textValue(payload.message) || 'تعذر تحديث حالة رمز الخصم.'
    );
  }
  return textValue(payload.message) || 'تم تحديث حالة رمز الخصم.';
}
