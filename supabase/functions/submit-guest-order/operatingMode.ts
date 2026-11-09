interface RpcError {code?: unknown; message?: unknown}
/** The URI is fixed by the caller. Only an explicitly absent mode RPC is a
 * legacy219 installation. Network, malformed data and other errors stop writes. */
export function decodeOperatingMode(ok: boolean, status: number, payload: unknown): boolean {
 if (ok && payload && typeof payload === 'object' && !Array.isArray(payload)) {
  const mode=payload as Record<string,unknown>;
  if (mode.contractVersion==='sales-only-phase2-v1' && typeof mode.fullAccounting==='boolean') return mode.fullAccounting;
 }
 if (!ok && status===404 && payload && typeof payload==='object' && !Array.isArray(payload)) {
  const error=payload as RpcError;
  if (error.code==='PGRST202' && typeof error.message==='string'
   && error.message.includes('lite1_operating_mode')) return true;
 }
 throw new Error('OPERATING_MODE_UNVERIFIED');
}

/** Translate the existing, sanitized Edge payload, with no client mode switch. */
export function liteGuestParameters(p:Record<string,unknown>):Record<string,unknown> {
 return {p_key:p.p_idempotency_key,p_request:{
  phoneHash:p.p_guest_phone_hash,sessionHash:p.p_guest_session_hash,
  recipient:{fullName:p.p_customer_full_name,phone:p.p_customer_phone,governorate:p.p_governorate,
   city:p.p_city,area:p.p_area,street:p.p_street,building:p.p_building,addressNotes:p.p_address_notes,
   googleMapsUrl:p.p_google_maps_url,latitude:p.p_latitude,longitude:p.p_longitude,customerNotes:p.p_customer_notes},
  lines:p.p_lines,promotionCode:p.p_promotion_code,paymentMethod:p.p_payment_method,deliveryZone:p.p_delivery_zone,
  expectedQuote:{subtotalInMinorUnits:p.p_expected_subtotal_in_minor_units,discountInMinorUnits:p.p_expected_discount_in_minor_units,
   deliveryFeeInMinorUnits:p.p_expected_delivery_fee_in_minor_units,totalInMinorUnits:p.p_expected_total_in_minor_units},
 }};
}
