import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  CatalogCategory,
  CatalogProduct,
  CatalogResponse,
} from '../types/catalog';

type RawCatalogItem = Record<string, unknown>;

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerValue(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Math.max(0, Math.floor(numericValue))
    : fallback;
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
  };
}

export function mapCatalogCategory(item: RawCatalogItem): CatalogCategory {
  return {
    id: textValue(item.id),
    code: textValue(item.code),
    nameAr: textValue(item.nameAr) || 'قسم بدون اسم',
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
    p_limit: 200,
    p_offset: 0,
    p_category_id: null,
    p_search: null,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل كتالوج الجملة.');
  }

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems
    .map((item: RawCatalogItem) => mapCatalogProduct(item))
    .filter(
      (item: CatalogProduct) =>
        Boolean(item.id) &&
        Boolean(item.saleUnitId) &&
        item.unitsPerSalePackage > 0 &&
        item.salePackagePriceInMinorUnits > 0
    );
  const rawCategories = Array.isArray(data?.categories)
    ? data.categories
    : [];
  const mappedCategories = rawCategories
    .map((item: RawCatalogItem) => mapCatalogCategory(item))
    .filter(
      (category: CatalogCategory) =>
        Boolean(category.id) && Boolean(category.nameAr)
    );

  return {
    items,
    categories:
      mappedCategories.length > 0
        ? mappedCategories
        : deriveCatalogCategories(items),
    total: integerValue(data?.total, items.length),
    limit: integerValue(data?.limit, 200),
    offset: integerValue(data?.offset),
  };
}
