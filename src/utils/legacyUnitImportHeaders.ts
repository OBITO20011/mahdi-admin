/** Import-only compatibility. Never render these historical workbook titles. */
export const LEGACY_UNIT_HEADERS: Readonly<Record<string, readonly string[]>> = {
  units_per_purchase_unit: ['عدد الحبات في طرد الشراء'],
  units_per_sale_unit: ['عدد الحبات في طرد البيع'],
  cost_per_base_unit: ['تكلفة الحبة (د.أ)'],
  min_stock_level: ['الحد الأدنى للمخزون (حبة)'],
  loose_units: ['الحبات الإضافية'],
};
export const LEGACY_OPENING_LOOSE_HEADER = 'الحباتالمتبقية';
/** Matching existing database units is not renaming or inventing a unit. */
export const LEGACY_PIECE_NAMES = ['قطعة', 'حبة', 'قطع'];
