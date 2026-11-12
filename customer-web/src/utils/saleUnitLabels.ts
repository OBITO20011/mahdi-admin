/** Owner-approved sales copy only. Never write these labels into unit records. */
export const SINGLE_SALE_UNIT = 'باكيت';
/** Keep the existing label for all ordinary units. A carton sold as one unit
 * has no declared packet count yet. */
export const singleSaleUnitLabel = (baseUnit: string | undefined, actualNames = false) =>
  actualNames ? baseUnit?.trim() || SINGLE_SALE_UNIT
    : baseUnit?.trim() === 'طرد' ? 'طرد' : SINGLE_SALE_UNIT;
/** OFF only: labels describe saved/configured packaging, never quantities. */
export const packageSaleUnitLabel = (sale: string | undefined, purchase?: string, actualNames = false) =>
  actualNames ? sale?.trim() || purchase?.trim() || 'طرد' : 'طرد';
/** Older receipts may only have a saved packaging label, without a commercial
 * kind. Normalize that label without inferring a quantity, price or recipe. */
export function savedSaleUnitLabel(saved: string | undefined): string {
  return ['طرد','كرتونة','كرتون','كراتين','كرتونتان','صندوق','شرنك','ربطة','حافظة'].includes(saved?.trim() ?? '') ? 'طرد' : SINGLE_SALE_UNIT;
}
