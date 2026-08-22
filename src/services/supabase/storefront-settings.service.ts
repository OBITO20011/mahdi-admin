import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import {
  StorefrontSettings,
  StorefrontSettingsInput,
} from '../../types/storefront';

type RpcRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بـ Supabase غير مكتملة.');
  }
  return supabase;
}

function mapSettings(payload: RpcRecord): StorefrontSettings {
  return {
    storeNameAr: text(payload.storeNameAr),
    whatsappNumber: text(payload.whatsappNumber),
    cliqAlias: text(payload.cliqAlias),
    ordersEnabled: payload.ordersEnabled === true,
    announcementText: text(payload.announcementText),
    businessHoursText: text(payload.businessHoursText),
    deliveryAreasText: text(payload.deliveryAreasText),
    deliveryEtaText: text(payload.deliveryEtaText),
    exchangePolicyText: text(payload.exchangePolicyText),
    minimumOrder: number(payload.minimumOrderInMinorUnits) / 1000,
    insideRamthaDeliveryFee:
      number(payload.insideRamthaDeliveryFeeInMinorUnits) / 1000,
    outsideRamthaDeliveryFee:
      number(payload.outsideRamthaDeliveryFeeInMinorUnits) / 1000,
    showNewestProducts: payload.showNewestProducts !== false,
    showBestSellers: payload.showBestSellers !== false,
    showOffers: payload.showOffers !== false,
    showLowStock: payload.showLowStock !== false,
    updatedAt: text(payload.updatedAt),
  };
}

export async function fetchStorefrontSettings(): Promise<StorefrontSettings> {
  const { data, error } = await requireClient().rpc(
    'get_public_storefront_settings'
  );
  if (error) throw new Error(error.message || 'تعذر تحميل إعدادات المتجر.');
  return mapSettings((data || {}) as RpcRecord);
}

export async function saveStorefrontSettings(
  input: StorefrontSettingsInput
): Promise<{ settings: StorefrontSettings; message: string }> {
  const { data, error } = await requireClient().rpc(
    'save_storefront_settings_v3',
    {
      p_store_name_ar: input.storeNameAr.trim(),
      p_whatsapp_number: input.whatsappNumber.trim(),
      p_cliq_alias: input.cliqAlias.trim(),
      p_orders_enabled: input.ordersEnabled,
      p_announcement_text: input.announcementText.trim(),
      p_business_hours_text: input.businessHoursText.trim(),
      p_delivery_areas_text: input.deliveryAreasText.trim(),
      p_delivery_eta_text: input.deliveryEtaText.trim(),
      p_exchange_policy_text: input.exchangePolicyText.trim(),
      p_minimum_order_in_minor_units: Math.round(
        Math.max(0, input.minimumOrder) * 1000
      ),
      p_inside_ramtha_delivery_fee_in_minor_units: Math.round(
        Math.max(0, input.insideRamthaDeliveryFee) * 1000
      ),
      p_outside_ramtha_delivery_fee_in_minor_units: Math.round(
        Math.max(0, input.outsideRamthaDeliveryFee) * 1000
      ),
      p_show_newest_products: input.showNewestProducts,
      p_show_best_sellers: input.showBestSellers,
      p_show_offers: input.showOffers,
      p_show_low_stock: input.showLowStock,
    }
  );
  if (error) throw new Error(error.message || 'تعذر حفظ إعدادات المتجر.');
  const payload = (data || {}) as RpcRecord;
  if (payload.success !== true) {
    throw new Error(text(payload.message) || 'تعذر حفظ إعدادات المتجر.');
  }
  return {
    settings: mapSettings(payload),
    message: text(payload.message) || 'تم حفظ إعدادات المتجر.',
  };
}
