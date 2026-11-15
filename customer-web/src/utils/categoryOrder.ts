/** Stable owner order; custom import codes can change after RESET/import. */
export const STOREFRONT_CATEGORY_ORDER = [
  'CAT-OFFERS', 'PREMIUM-CHOCOLATE', 'CAT-CHOCO', 'CAT-CANDY',
  'CAT-CHIPS', 'CAT-BISCUIT', 'BISCUIT-TEN', 'CAT-CAKE', 'CAT-GUM',
  'CAT-BEV', 'CAT-ENERGY', 'CAT-WATER', 'CAT-FOOD', 'CAT-GIFTS',
] as const;

const NAME_KEYS: Record<string, string> = {
  'عروض خاصة': 'CAT-OFFERS', 'شوكلاتة غوالي': 'PREMIUM-CHOCOLATE',
  'شوكولاتة': 'CAT-CHOCO', 'كاندي وسكاكر': 'CAT-CANDY',
  'شيبس وتسالي': 'CAT-CHIPS', 'بسكويت وويفر': 'CAT-BISCUIT',
  'بسكويت 10 قروش': 'BISCUIT-TEN', 'كيك': 'CAT-CAKE', 'علكة': 'CAT-GUM',
  'مشروبات وعصائر': 'CAT-BEV', 'مشروبات طاقة': 'CAT-ENERGY', 'مياه': 'CAT-WATER',
  'مواد غذائية': 'CAT-FOOD', 'علب هدايا': 'CAT-GIFTS', 'أخرى': 'OTHER',
};
const normalizeName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export function categoryPresentationKey(code: string, name = ''): string {
  return NAME_KEYS[normalizeName(name)] ?? code;
}

interface NamedCategory {code: string; nameAr: string}
const alphabetical = new Intl.Collator('ar-JO', {numeric: true});
const rank = (category: NamedCategory) => {
  const key = categoryPresentationKey(category.code, category.nameAr);
  if (key === 'OTHER') return STOREFRONT_CATEGORY_ORDER.length + 1;
  const index = STOREFRONT_CATEGORY_ORDER.findIndex(value => value === key);
  return index < 0 ? STOREFRONT_CATEGORY_ORDER.length : index;
};

export function orderStorefrontCategories<T extends NamedCategory>(categories: readonly T[]): T[] {
  return [...categories].sort((first, second) =>
    rank(first) - rank(second) || alphabetical.compare(first.nameAr, second.nameAr) ||
    first.code.localeCompare(second.code));
}
