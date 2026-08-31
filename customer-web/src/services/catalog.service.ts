import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  CatalogFacet,
  CatalogCategory,
  CatalogProduct,
  CatalogResponse,
  CatalogSummary,
  PublicCatalogQuery,
} from '../types/catalog';

type RawCatalogItem = Record<string, unknown>;

export const STOREFRONT_CATALOG_PAGE_SIZE = 24;
const STOREFRONT_CATALOG_MAX_PAGE_SIZE = 48;
export const STOREFRONT_CART_SNAPSHOT_BATCH_SIZE = 48;
export const STOREFRONT_PRODUCT_LINK_SEARCH_LIMIT = 8;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicProductLink {
  family: CatalogProduct;
  selectedProductId: string;
}

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

function mapCatalogFacet(item: RawCatalogItem): CatalogFacet {
  return {
    id: textValue(item.id),
    nameAr: textValue(item.nameAr) || 'غير مسمى',
  };
}

function mapCatalogSummary(value: unknown): CatalogSummary {
  const rawSummary = value && typeof value === 'object'
    ? value as RawCatalogItem
    : {};
  return {
    availableProducts: integerValue(rawSummary.availableProducts),
    availableSalePackages: integerValue(rawSummary.availableSalePackages),
    lowStockProducts: integerValue(rawSummary.lowStockProducts),
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

export function buildCartSnapshotBatches(productIds: string[]): string[][] {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((productId) => Boolean(productId)))
  );
  const batches: string[][] = [];
  for (
    let index = 0;
    index < uniqueProductIds.length;
    index += STOREFRONT_CART_SNAPSHOT_BATCH_SIZE
  ) {
    batches.push(
      uniqueProductIds.slice(index, index + STOREFRONT_CART_SNAPSHOT_BATCH_SIZE)
    );
  }
  return batches;
}

/** Finds the exact family and sellable product addressed by a public link. */
export function findPublicProductLink(
  products: CatalogProduct[],
  productKey: string
): PublicProductLink | null {
  const normalizedKey = productKey.trim();
  if (!normalizedKey) return null;

  for (const family of products) {
    const matchedProduct = [family, ...family.variants].find(
      (product) => product.id === normalizedKey || product.sku === normalizedKey
    );
    if (matchedProduct) {
      return { family, selectedProductId: matchedProduct.id };
    }
  }

  return null;
}

export async function fetchPublicProductCatalog(
  query: PublicCatalogQuery = {}
): Promise<CatalogResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'إعدادات الاتصال بكتالوج Supabase غير مكتملة في موقع العملاء.'
    );
  }

  const requestedLimit = Math.min(
    STOREFRONT_CATALOG_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(query.limit ?? STOREFRONT_CATALOG_PAGE_SIZE))
  );
  const { data, error } = await supabase.rpc('get_public_storefront_catalog_page', {
    p_limit: requestedLimit,
    p_offset: Math.max(0, Math.floor(query.offset ?? 0)),
    p_category_id: query.categoryId || null,
    p_search: query.searchQuery?.trim() || null,
    p_availability: query.availability ?? 'all',
    p_sort: query.sort ?? 'recommended',
    p_brand_id: query.brandId || null,
    p_sale_unit_id: query.saleUnitId || null,
    p_product_ids: query.productIds?.filter(Boolean) ?? null,
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

  const rawBrands = Array.isArray(data?.brands) ? data.brands : [];
  const rawSaleUnits = Array.isArray(data?.saleUnits) ? data.saleUnits : [];
  const categories = mappedCategories.length > 0
    ? mappedCategories
    : deriveCatalogCategories(items);

  return {
    items,
    categories,
    brands: rawBrands
      .map((item: RawCatalogItem) => mapCatalogFacet(item))
      .filter((item: CatalogFacet) => Boolean(item.id)),
    saleUnits: rawSaleUnits
      .map((item: RawCatalogItem) => mapCatalogFacet(item))
      .filter((item: CatalogFacet) => Boolean(item.id)),
    summary: mapCatalogSummary(data?.summary),
    total: resolveCatalogTotal(items.length, data?.total),
    limit: integerValue(data?.limit, requestedLimit),
    offset: integerValue(data?.offset),
  };
}

/**
 * Resolves a share link with one bounded public catalog request. UUID links
 * use the exact product-ID contract; SKU links use server-side catalog search
 * and are accepted only when an exact result match is returned.
 */
export async function fetchPublicProductLink(
  productKey: string
): Promise<PublicProductLink | null> {
  const normalizedKey = productKey.trim();
  if (!normalizedKey) return null;

  try {
    const response = await fetchPublicProductCatalog(
      UUID_PATTERN.test(normalizedKey)
        ? { limit: 1, productIds: [normalizedKey] }
        : {
            limit: STOREFRONT_PRODUCT_LINK_SEARCH_LIMIT,
            searchQuery: normalizedKey,
          }
    );
    return findPublicProductLink(response.items, normalizedKey);
  } catch {
    throw new Error('تعذر فتح هذا المنتج الآن. حاول مرة أخرى.');
  }
}

/**
 * Reads only the cart's exact sellable product IDs. The catalog RPC groups
 * flavor families for rendering, so flatten the response back to sellable
 * rows before reconciling the cart by product ID.
 */
export async function fetchPublicCartSnapshot(
  productIds: string[]
): Promise<CatalogProduct[]> {
  const batches = buildCartSnapshotBatches(productIds);
  if (batches.length === 0) return [];

  try {
    const responses = await Promise.all(
      batches.map((productIdsBatch) =>
        fetchPublicProductCatalog({
          limit: productIdsBatch.length,
          productIds: productIdsBatch,
        })
      )
    );
    return responses.flatMap((response) =>
      response.items.flatMap((product) =>
        product.variants.length > 0 ? product.variants : [product]
      )
    );
  } catch {
    throw new Error('تعذر التحقق من سعر ومخزون السلة. حاول مرة أخرى.');
  }
}
