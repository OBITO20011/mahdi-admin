import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { StorefrontOffer } from '../types/offers';

type RpcRecord = Record<string, unknown>;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalText(value: unknown): string | undefined {
  const valueAsText = textValue(value);
  return valueAsText || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function mapStorefrontOffer(row: RpcRecord): StorefrontOffer {
  const discountType =
    row.discount_type === 'percentage' ? 'percentage' : 'fixed';
  return {
    id: textValue(row.id),
    code: textValue(row.code),
    description: textValue(row.description_ar),
    discountType,
    discountValue:
      discountType === 'percentage'
        ? numberValue(row.discount_value) / 100
        : numberValue(row.discount_value) / 1000,
    minimumSubtotalInMinorUnits: Math.max(
      0,
      Math.floor(numberValue(row.minimum_subtotal_in_minor_units))
    ),
    maximumDiscountInMinorUnits: optionalNumber(
      row.maximum_discount_in_minor_units
    ),
    startsAt: optionalText(row.starts_at),
    expiresAt: optionalText(row.expires_at),
  };
}

export async function fetchPublicStorefrontOffers(): Promise<StorefrontOffer[]> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بعروض Supabase غير مكتملة.');
  }

  const { data, error } = await supabase.rpc('get_public_storefront_offers');
  if (error) {
    throw new Error(error.message || 'تعذر تحميل عروض المتجر.');
  }

  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error('تعذر تحميل عروض المتجر.');
  }

  const offers = Array.isArray(payload.offers) ? payload.offers : [];
  return offers
    .map((row) => mapStorefrontOffer(row as RpcRecord))
    .filter((offer) => Boolean(offer.id && offer.code && offer.discountValue > 0));
}
