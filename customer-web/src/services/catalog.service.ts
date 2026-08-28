import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  CatalogCategory,
  CatalogProduct,
  CatalogResponse,
} from '../types/catalog';

type RawCatalogItem = Record<string, unknown>;

// This is an intentional near-term storefront threshold, not an unbounded
// client-side catalog. Revisit it before the active catalog approaches 200
// products, then introduce server-side search and pagination together.
export const STOREFRONT_CATALOG_INITIAL_LIMIT = 200;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerValue(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.floor(numericValue))
    : fallback;
}

export function resolveCatalogTotal(
  itemCount: number,
  serverTotal: unknown,
): number {
  return Math.max(itemCount, integerValue(serverTotal, itemCount));
}

export function mapCatalogProduct(item: RawCatalogItem): CatalogProduct {
  const unitsPerSalePackage = Math.max(
    1,
    integerValue(item.unitsPerSalePackage, 1)
  );
  const availableQuantity = integerValue(item.availableQuantity);
  const availableSalePackages = integerValue(
    item.availableSalePackages,
    Math.floor(availableQuantity / unitsPerSalePackage)
  );
  const salePackagePriceInMinorUnits = integerValue(
    item.salePackagePriceInMinorUnits
  );

  return {
    id: textValue(item.id),
    sku: textValue(item.sku),
    barcode: textValue(item.barcode),
    nameAr: textValue(item.nameAr) || 'صنف بدون اسم',
    description: textValue(item.description),
    categoryId: textValue(item.categoryId),
    categoryCode: textValue(item.categoryCode),
    categoryNameAr: textValue(item.categoryNameAr) || 'أصناف متنوعة',
    brandId: textValue(item.brandId),
    brandNameAr: textValue(item.brandNameAr),
    unitId: textValue(item.unitId),
    unitNameAr: textValue(item.unitNameAr) || 'حبة',
    saleUnitId: textValue(item.saleUnitId),
    saleUnitNameAr: textValue(item.saleUnitNameAr) || 'طرد',
    unitsPerSalePackage,
    salePackagePriceInMinorUnits,
    availableQuantity,
    availableSalePackages,
    minimumOrderPackages: Math.max(
      1,
      integerValue(item.minimumOrderPackages, 1)
    ),
    imageUrl: textValue(item.imageUrl),
    isAvailable:
      item.isAvailable === true &&
      availableSalePackages > 0 &&
      salePackagePriceInMinorUnits > 0,
    createdAt: textValue(item.createdAt),
    soldPackagesLast90Days: integerValue(item.soldPackagesLast90Days),
    isFlavorMaster: item.isFlavorMaster === true,
    flavorMasterProductId: textValue(item.flavorMasterProductId),
    flavorNameAr: textValue(item.flavorNameAr),
    flavorSortOrder: integerValue(item.flavorSortOrder),
    variants: [],
  };
}

export function groupCatalogFlavorFamilies(
  flatProducts: CatalogProduct[]
): CatalogProduct[] {
  const childrenByMaster = new Map<string, CatalogProduct[]>();
  flatProducts.forEach((product) => {
    if (!product.flavorMasterProductId) return;
    const current = childrenByMaster.get(product.flavorMasterProductId) || [];
    current.push(product);
    childrenByMaster.set(product.flavorMasterProductId, current);
  });

  const roots = flatProducts.filter((product) => !product.flavorMasterProductId);
  const rootsById = new Map(roots.map((product) => [product.id, product]));

  // Search may return a matching flavor without its parent row. Build a safe
  // family card from the flavor so the result still stays grouped.
  childrenByMaster.forEach((children, masterId) => {
    if (rootsById.has(masterId) || children.length === 0) return;
    const first = children[0];
    const suffix = first.flavorNameAr ? ` - ${first.flavorNameAr}` : '';
    const familyName =
      suffix && first.nameAr.endsWith(suffix)
        ? first.nameAr.slice(0, -suffix.length)
        : first.nameAr;
    const syntheticRoot: CatalogProduct = {
      ...first,
      id: masterId,
      sku: masterId,
      barcode: '',
      nameAr: familyName,
      flavorMasterProductId: '',
      flavorNameAr: '',
      isFlavorMaster: true,
      variants: [],
    };
    roots.push(syntheticRoot);
    rootsById.set(masterId, syntheticRoot);
  });

  return roots.map((root) => {
    const variants = [...(childrenByMaster.get(root.id) || [])].sort(
      (first, second) =>
        first.flavorSortOrder - second.flavorSortOrder ||
        first.flavorNameAr.localeCompare(second.flavorNameAr, 'ar')
    );
    if (variants.length === 0) return root;

    return {
      ...root,
      isFlavorMaster: true,
      variants,
      imageUrl: root.imageUrl || variants.find((item) => item.imageUrl)?.imageUrl || '',
      availableQuantity: variants.reduce(
        (sum, item) => sum + item.availableQuantity,
        0
      ),
      availableSalePackages: variants.reduce(
        (sum, item) => sum + item.availableSalePackages,
        0
      ),
      isAvailable: variants.some((item) => item.isAvailable),
      soldPackagesLast90Days: variants.reduce(
        (sum, item) => sum + item.soldPackagesLast90Days,
        0
      ),
    };
  });
}

export function mapCatalogCategory(item: RawCatalogItem): CatalogCategory {
  return {
    id: textValue(item.id),
    code: textValue(item.code),
    nameAr: textValue(item.nameAr) || 'قسم بدون اسم',
    imageUrl: textValue(item.imageUrl),
    productCount: integerValue(item.productCount),
    availableProductCount: integerValue(item.availableProductCount),
  };
}

export function deriveCatalogCategories(
  products: CatalogProduct[]
): CatalogCategory[] {
  const categories = new Map<string, CatalogCategory>();

  products.forEach((product) => {
    if (!product.categoryId) return;
    const current = categories.get(product.categoryId);
    categories.set(product.categoryId, {
      id: product.categoryId,
      code: product.categoryCode,
      nameAr: product.categoryNameAr,
      imageUrl: '',
      productCount: (current?.productCount ?? 0) + 1,
      availableProductCount:
        (current?.availableProductCount ?? 0) +
        (product.isAvailable ? 1 : 0),
    });
  });

  return Array.from(categories.values()).sort((first, second) =>
    first.nameAr.localeCompare(second.nameAr, 'ar')
  );
}

export async function fetchPublicProductCatalog(): Promise<CatalogResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'إعدادات الاتصال بكتالوج Supabase غير مكتملة في موقع العملاء.'
    );
  }

  const { data, error } = await supabase.rpc('get_public_storefront_catalog', {
    p_limit: STOREFRONT_CATALOG_INITIAL_LIMIT,
    p_offset: 0,
    p_category_id: null,
    p_search: null,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل كتالوج الجملة.');
  }

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const flatItems = rawItems
    .map((item: RawCatalogItem) => mapCatalogProduct(item))
    .filter(
      (item: CatalogProduct) =>
        Boolean(item.id) &&
        Boolean(item.saleUnitId) &&
        item.unitsPerSalePackage > 0 &&
        item.salePackagePriceInMinorUnits > 0
    );
  const items = groupCatalogFlavorFamilies(flatItems);
  const rawCategories = Array.isArray(data?.categories)
    ? data.categories
    : [];
  const mappedCategories: CatalogCategory[] = rawCategories
    .map((item: RawCatalogItem) => mapCatalogCategory(item))
    .filter(
      (category: CatalogCategory) =>
        Boolean(category.id) && Boolean(category.nameAr)
    );

  return {
    items,
    categories: deriveCatalogCategories(items).map((category) => ({
      ...category,
      imageUrl:
        mappedCategories.find((item) => item.id === category.id)?.imageUrl || '',
    })),
    total: resolveCatalogTotal(items.length, data?.total),
    limit: integerValue(data?.limit, STOREFRONT_CATALOG_INITIAL_LIMIT),
    offset: integerValue(data?.offset),
  };
}
