/** Owner-approved sales copy only. Never write these labels into unit records. */
export const SINGLE_SALE_UNIT = 'باكيت';
/** Keep the existing label for all ordinary units. A carton sold as one unit
 * has no declared packet count yet. */
export const singleSaleUnitLabel = (baseUnit: string | undefined, actualNames = false) =>
  actualNames ? baseUnit?.trim() || SINGLE_SALE_UNIT
    : baseUnit?.trim() === 'طرد' ? 'طرد' : SINGLE_SALE_UNIT;
/** OFF only: labels describe saved/configured packaging, never quantities. */
export const packageSaleUnitLabel = (sale: string | undefined, purchase?: string, actualNames = false, base?: string) => {
  const label = actualNames ? sale?.trim() || purchase?.trim() || 'طرد' : 'طرد';
  return actualNames && base?.trim() === label ? label === 'طرد' ? 'مجموعة' : 'طرد' : label;
};
/** Refuse new OFF parcel additions with the exact inconsistent price produced
 * by changing capacity without converting the product. Never reprice a line. */
export const unsafeLiteParcelPrice = (lite: boolean, units: number, parcelPrice: number | undefined, unitPrice: number | undefined) =>
  lite && units > 1 && typeof unitPrice === 'number' && unitPrice > 0 && parcelPrice === unitPrice;
export const PARCEL_DEFINITION_MESSAGE = 'راجع سعر ووحدة الطرد من نموذج المنتج قبل بيع الطرد؛ لا يمكن بيع عدة وحدات بسعر وحدة واحدة.';
/** Older receipts may only have a saved packaging label, without a commercial
 * kind. Normalize that label without inferring a quantity, price or recipe. */
export function savedSaleUnitLabel(saved: string | undefined): string {
  return ['طرد','كرتونة','كرتون','كراتين','كرتونتان','صندوق','شرنك','ربطة','حافظة'].includes(saved?.trim() ?? '') ? 'طرد' : SINGLE_SALE_UNIT;
}
