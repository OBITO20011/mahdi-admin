/** Presentation only; preserve arbitrary existing unit names, including PCS. */
const plurals: Readonly<Record<string, string>> = {
  باكيت: 'باكيتات', شوال: 'شوالات', قنينة: 'قناني', علبة: 'علب', كيس: 'أكياس',
  طرد: 'طرود', كرتونة: 'كراتين', قطعة: 'قطع',
};
export function unitCountLabel(count: number, name: string): string {
  return count >= 3 && count <= 10 && Number.isInteger(count) ? (plurals[name] ?? name) : name;
}
