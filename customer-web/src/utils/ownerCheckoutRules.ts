// Owner trial decisions 2026-11-20 (items 2 and 6). Presentation and request
// shaping only: the database contract and the frozen checkout/order services stay exact.
import {isSupportedGoogleMapsUrl} from './googleMaps';
import type {GuestCheckoutForm} from '../types/checkout';

/** Item 2: a pinned map location replaces the area/details text. */
export const MAP_LOCATION_ADDRESS_PLACEHOLDER = 'حسب الموقع على الخريطة';

/** True only for a complete GPS pin or a supported Google Maps share link. */
export function hasDeliveryMapLocation(
  form: Pick<GuestCheckoutForm, 'googleMapsUrl' | 'latitude' | 'longitude'>
): boolean {
  if (form.latitude !== null && form.longitude !== null) {
    return Number.isFinite(form.latitude) && Number.isFinite(form.longitude);
  }
  const mapsUrl = form.googleMapsUrl.trim();
  return Boolean(mapsUrl) && isSupportedGoogleMapsUrl(mapsUrl);
}

/** The server still needs non-empty area/details; with a map pin, blanks become the placeholder. */
export function withMapLocationAddress<T extends GuestCheckoutForm>(form: T): T {
  if (!hasDeliveryMapLocation(form)) return form;
  return {
    ...form,
    area: form.area.trim() || MAP_LOCATION_ADDRESS_PLACEHOLDER,
    street: form.street.trim() || MAP_LOCATION_ADDRESS_PLACEHOLDER,
  };
}

/** Item 6: with a zero shop fee the customer pays the driver directly, outside the shop invoice. */
export const DRIVER_PAID_DELIVERY_LINE = 'أجرة التوصيل: تُدفع لعامل التوصيل مباشرة (خارج فاتورة المحل)';

export function driverPaidDeliveryMessage(message: string, deliveryFeeInMinorUnits: number): string {
  if (deliveryFeeInMinorUnits !== 0) return message;
  return message
    .split('\n')
    .map((line) => line.startsWith('أجرة التوصيل: ') ? DRIVER_PAID_DELIVERY_LINE : line)
    .join('\n')
    .replace('💰 *الإجمالي المطلوب: ', '💰 *إجمالي فاتورة المحل: ');
}
