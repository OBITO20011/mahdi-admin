import { DEFAULT_STOREFRONT_SETTINGS } from '../config/store';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { PublicStorefrontSettings } from '../types/storefront';

type RpcRecord = Record<string, unknown>;

const SETTINGS_UNAVAILABLE_MESSAGE =
  'تعذر التحقق من إعدادات الطلب والتوصيل. حاول مرة أخرى.';

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function hasNonNegativeInteger(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed);
}

function assertCheckoutSettingsContract(payload: RpcRecord): void {
  if (
    typeof payload.ordersEnabled !== 'boolean' ||
    !hasNonNegativeInteger(payload.minimumOrderInMinorUnits) ||
    !hasNonNegativeInteger(payload.insideRamthaDeliveryFeeInMinorUnits) ||
    !hasNonNegativeInteger(payload.outsideRamthaDeliveryFeeInMinorUnits)
  ) {
    throw new Error(SETTINGS_UNAVAILABLE_MESSAGE);
  }
}

export function mapPublicStorefrontSettings(
  payload: RpcRecord
): PublicStorefrontSettings {
  assertCheckoutSettingsContract(payload);

  return {
    storeNameAr: text(payload.storeNameAr, DEFAULT_STOREFRONT_SETTINGS.storeNameAr),
    whatsappNumber: text(payload.whatsappNumber, DEFAULT_STOREFRONT_SETTINGS.whatsappNumber),
    cliqAlias: typeof payload.cliqAlias === 'string' ? payload.cliqAlias.trim() : '',
    ordersEnabled: payload.ordersEnabled === true,
    announcementText: text(payload.announcementText, DEFAULT_STOREFRONT_SETTINGS.announcementText),
    businessHoursText: text(payload.businessHoursText, DEFAULT_STOREFRONT_SETTINGS.businessHoursText),
    deliveryAreasText: text(payload.deliveryAreasText, DEFAULT_STOREFRONT_SETTINGS.deliveryAreasText),
    deliveryEtaText: text(payload.deliveryEtaText, DEFAULT_STOREFRONT_SETTINGS.deliveryEtaText),
    exchangePolicyText: text(payload.exchangePolicyText, DEFAULT_STOREFRONT_SETTINGS.exchangePolicyText),
    minimumOrderInMinorUnits: integer(payload.minimumOrderInMinorUnits),
    deliveryFeeInMinorUnits: integer(payload.deliveryFeeInMinorUnits),
    insideRamthaDeliveryFeeInMinorUnits: integer(
      payload.insideRamthaDeliveryFeeInMinorUnits
    ),
    outsideRamthaDeliveryFeeInMinorUnits: integer(
      payload.outsideRamthaDeliveryFeeInMinorUnits
    ),
    showNewestProducts: payload.showNewestProducts !== false,
    showBestSellers: payload.showBestSellers !== false,
    showOffers: payload.showOffers !== false,
    showLowStock: payload.showLowStock !== false,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
}

export async function fetchPublicStorefrontSettings(): Promise<PublicStorefrontSettings> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(SETTINGS_UNAVAILABLE_MESSAGE);
  }
  const { data, error } = await supabase.rpc('get_public_storefront_settings');
  if (error) throw new Error(SETTINGS_UNAVAILABLE_MESSAGE);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(SETTINGS_UNAVAILABLE_MESSAGE);
  }
  return mapPublicStorefrontSettings(data as RpcRecord);
}
