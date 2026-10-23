/** Presentation only; preserve arbitrary existing unit names, including PCS. */
const plurals: Readonly<Record<string, string>> = {
  باكيت: 'باكيتات', شوال: 'شوالات', قنينة: 'قناني', علبة: 'علب', كيس: 'أكياس',
  طرد: 'طرود', قطعة: 'قطع',
};
export function displayUnitName(name: string): string {
  return ['كرتونة','كرتون','كراتين','كرتونتان'].includes(name.trim()) ? 'طرد' : name;
}
export function unitCountLabel(count: number, name: string): string {
  const shown = displayUnitName(name);
  return count >= 3 && count <= 10 && Number.isInteger(count) ? (plurals[shown] ?? shown) : shown;
}

/** New content choices are physical base units;keep stored legacy selections separately. */
export function isContentUnitOption(unit:{code:string;nameAr:string;isHidden?:boolean}):boolean {
  return !unit.isHidden&&!['PCS','CTN','BOX','SHRINK','BUNDLE','CASE','PARCEL'].includes(unit.code)
    &&!['طرد','كرتونة','كراتين','صندوق','شرنك','ربطة','حافظة'].includes(unit.nameAr);
}
