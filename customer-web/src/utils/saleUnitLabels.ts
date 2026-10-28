/** Owner-approved sales copy only. Never write these labels into unit records. */
export const SINGLE_SALE_UNIT = 'باكيت';
/** Older receipts may only have a saved packaging label, without a commercial
 * kind. Normalize that label without inferring a quantity, price or recipe. */
export function savedSaleUnitLabel(saved: string | undefined): string {
  return ['طرد','كرتونة','كرتون','كراتين','كرتونتان','صندوق','شرنك','ربطة','حافظة'].includes(saved?.trim() ?? '') ? 'طرد' : SINGLE_SALE_UNIT;
}
