import { DEFAULT_STOREFRONT_SETTINGS } from '../config/store';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { PublicStorefrontSettings } from '../types/storefront';

type RpcRecord = Record<string, unknown>;

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function fetchPublicStorefrontSettings(): Promise<PublicStorefrontSettings> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  const { data, error } = await supabase.rpc('get_public_storefront_settings');
  if (error) throw new Error(error.message || 'تعذر تحميل إعدادات المتجر.');
  const payload = (data || {}) as RpcRecord;
  return {
    storeNameAr: text(payload.storeNameAr, DEFAULT_STOREFRONT_SETTINGS.storeNameAr),
    whatsappNumber: text(payload.whatsappNumber, DEFAULT_STOREFRONT_SETTINGS.whatsappNumber),
    cliqAlias: typeof payload.cliqAlias === 'string' ? payload.cliqAlias.trim() : '',
    ordersEnabled: payload.ordersEnabled !== false,
    announcementText: text(payload.announcementText, DEFAULT_STOREFRONT_SETTINGS.announcementText),
    businessHoursText: text(payload.businessHoursText, DEFAULT_STOREFRONT_SETTINGS.businessHoursText),
    deliveryAreasText: text(payload.deliveryAreasText, DEFAULT_STOREFRONT_SETTINGS.deliveryAreasText),
    deliveryEtaText: text(payload.deliveryEtaText, DEFAULT_STOREFRONT_SETTINGS.deliveryEtaText),
    exchangePolicyText: text(payload.exchangePolicyText, DEFAULT_STOREFRONT_SETTINGS.exchangePolicyText),
    minimumOrderInMinorUnits: integer(payload.minimumOrderInMinorUnits),
    deliveryFeeInMinorUnits: integer(payload.deliveryFeeInMinorUnits),
    insideRamthaDeliveryFeeInMinorUnits: integer(
      payload.insideRamthaDeliveryFeeInMinorUnits ?? payload.deliveryFeeInMinorUnits
    ),
    outsideRamthaDeliveryFeeInMinorUnits: integer(
      payload.outsideRamthaDeliveryFeeInMinorUnits ?? payload.deliveryFeeInMinorUnits
    ),
    showNewestProducts: payload.showNewestProducts !== false,
    showBestSellers: payload.showBestSellers !== false,
    showOffers: payload.showOffers !== false,
    showLowStock: payload.showLowStock !== false,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
}
