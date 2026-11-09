import {readOperatingCatalog,quantityFreePayload,operatingCatalogRpc} from './operatingCatalog';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  CatalogFacet,
  CatalogCategory,
  CatalogProduct,
  CatalogResponse,
  CatalogSummary,
  PublicMerchandisingResponse,
  PublicCatalogQuery,
  PublicConfigurableParcelOption,
  PublicConfigurableParcelResponse,
  PublicParcelComponentOption,
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
  const untracked=item.quantityTracked===false;
  if(untracked&&(item.availableQuantity!==null||item.availableSalePackages!==null||typeof item.manualAvailable!=='boolean'))throw Error('تعذر التحقق من توفر الصنف.');
  if(item.quantityTracked!==undefined&&!untracked)throw Error('تعذر التحقق من تتبع كمية الصنف.');
  const availableQuantity = untracked?null:integerValue(item.availableQuantity);
  const availableSalePackages = untracked?null:integerValue(
    item.availableSalePackages,
    Math.floor((availableQuantity??0) / unitsPerSalePackage)
  );
  const salePackagePriceInMinorUnits = integerValue(
    item.salePackagePriceInMinorUnits
  );
  const salePriceInMinorUnits = integerValue(item.salePriceInMinorUnits);

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
    unitNameAr: textValue(item.unitNameAr) || 'باكيت',
    saleUnitId: textValue(item.saleUnitId),
    saleUnitNameAr: textValue(item.saleUnitNameAr) || 'طرد',
    unitsPerSalePackage,
    parcelOnly: item.parcelOnly === true,
    salePriceInMinorUnits,
    salePackagePriceInMinorUnits,
    ...(untracked?{quantityTracked:false,manualAvailable:item.manualAvailable as boolean}:{}),
    availableQuantity,
    availableSalePackages,
    minimumOrderPackages: Math.max(
      1,
      integerValue(item.minimumOrderPackages, 1)
    ),
    imageUrl: textValue(item.imageUrl),
    isAvailable:
      item.isAvailable === true &&
      (untracked?item.manualAvailable===true:(availableSalePackages??0)>0) &&
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

const mapParcelComponent = (value: unknown): PublicParcelComponentOption | null => {
  const component = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawCatalogItem
    : {};
  const productId = textValue(component.productId);
  const untracked=component.quantityTracked===false;
  if(untracked&&(component.availableQuantity!==null||component.manualAvailable!==true))throw Error('تعذر التحقق من توفر نكهة الطرد.');
  const availableQuantity = untracked?null:integerValue(component.availableQuantity);
  if (!UUID_PATTERN.test(productId) || (availableQuantity!==null&&availableQuantity < 0)) return null;
  return {
    productId,
    sku: textValue(component.sku),
    nameAr: textValue(component.nameAr) || 'نكهة',
    flavorNameAr: textValue(component.flavorNameAr),
    unitNameAr: textValue(component.unitNameAr) || 'وحدة',
    imageUrl: textValue(component.imageUrl),
    ...(untracked?{quantityTracked:false,manualAvailable:true}:{}),
    availableQuantity,
  };
};

const mapParcelOption = (value: unknown): PublicConfigurableParcelOption | null => {
  const option = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawCatalogItem
    : {};
  const familyProductId = textValue(option.familyProductId);
  const parcelConfigurationId = textValue(option.parcelConfigurationId);
  const configurationRevision = integerValue(option.configurationRevision);
  const unitsPerParcel = integerValue(option.unitsPerParcel);
  const parcelPriceInMinorUnits = integerValue(option.parcelPriceInMinorUnits);
  const components = (Array.isArray(option.components) ? option.components : [])
    .map(mapParcelComponent)
    .filter((item): item is PublicParcelComponentOption => Boolean(item));
  if (
    !UUID_PATTERN.test(familyProductId) ||
    !UUID_PATTERN.test(parcelConfigurationId) ||
    option.compositionMode !== 'configurable_mix' ||
    configurationRevision < 1 ||
    unitsPerParcel < 1 ||
    parcelPriceInMinorUnits < 1 ||
    components.length === 0
  ) return null;
  if(option.quantityTracked===false&&components.some(c=>c.quantityTracked!==false))throw Error('تعذر التحقق من مكونات الطرد.');
  return {
    ...(option.quantityTracked===false?{quantityTracked:false}:{}),
    familyProductId,
    parcelConfigurationId,
    configurationRevision,
    compositionMode: 'configurable_mix',
    unitsPerParcel,
    parcelPriceInMinorUnits,
    baseUnitNameAr: textValue(option.baseUnitNameAr) || 'وحدة',
    saleUnitNameAr: textValue(option.saleUnitNameAr) || 'طرد',
    components,
  };
};

/** Reads only the bounded guest-safe projection created by Migration 117. */
export async function fetchPublicConfigurableParcelOptions(
  familyProductIds: string[]
): Promise<PublicConfigurableParcelResponse> {
  const requestedIds = Array.from(new Set(familyProductIds.filter((id) => UUID_PATTERN.test(id))));
  if (requestedIds.length < 1 || requestedIds.length > 48) {
    throw new Error('تعذر تحديد عائلة الطرد المطلوبة.');
  }
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بكتالوج Supabase غير مكتملة في موقع العملاء.');
  }
  const { data, error } = await readOperatingCatalog(operatingCatalogRpc,
    'lite1_parcel_options2',
    { p_family_product_ids: requestedIds }
  );
  if (error) throw new Error(error.message || 'تعذر تحميل خيارات الطرد.');
  return mapPublicConfigurableParcelResponse(data);
}

export function mapPublicConfigurableParcelResponse(data:unknown):PublicConfigurableParcelResponse {
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data as RawCatalogItem
    : {};
  const untracked=quantityFreePayload(payload,'lite2-parcel-options-v1');
  const featureState = payload.featureState;
  if (!['OFF', 'OWNER_PILOT', 'ENABLED'].includes(String(featureState))) {
    throw new Error('تعذر التحقق من حالة ميزة الطرود.');
  }
  const options = (Array.isArray(payload.options) ? payload.options : [])
    .map(mapParcelOption)
    .filter((item): item is PublicConfigurableParcelOption => Boolean(item));
  if(untracked&&options.some(o=>o.quantityTracked!==false))throw Error('تعذر التحقق من خيارات الطرد.');
  return {
    featureState: featureState as PublicConfigurableParcelResponse['featureState'],
    guestCreationEnabled: payload.guestCreationEnabled === true,
    options,
  };
}

export function mapCatalogItems(value: unknown): CatalogProduct[] {
  const rawItems = Array.isArray(value) ? value : [];
  const flatItems = rawItems
    .map((item) => mapCatalogProduct(item as RawCatalogItem))
    .filter(
      (item: CatalogProduct) =>
        Boolean(item.id) &&
        Boolean(item.saleUnitId) &&
        item.unitsPerSalePackage > 0 &&
        item.salePackagePriceInMinorUnits > 0
    );
  return groupCatalogFlavorFamilies(flatItems);
}

export function mapPublicMerchandisingResponse(
  value: unknown,
): PublicMerchandisingResponse {
  const payload = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawCatalogItem
    : {};
  const untracked=quantityFreePayload(payload,'lite2-merchandising-v1');
  if(untracked&&['newest','bestSellers','offers','lowStock'].some(k=>(Array.isArray(payload[k])?payload[k] as RawCatalogItem[]:[]).some(p=>p.quantityTracked!==false)))throw Error('تعذر التحقق من مقترحات المنتجات.');
  return {
    newest: mapCatalogItems(payload.newest),
    bestSellers: mapCatalogItems(payload.bestSellers),
    offers: mapCatalogItems(payload.offers),
    lowStock: mapCatalogItems(payload.lowStock),
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
      ...(root.quantityTracked===false?{quantityTracked:false}:{}),
      availableQuantity: root.quantityTracked===false?null:variants.reduce(
        (sum, item) => sum + (item.availableQuantity??0),
        0
      ),
      availableSalePackages: root.quantityTracked===false?null:variants.reduce(
        (sum, item) => sum + (item.availableSalePackages??0),
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
  const untracked=rawSummary.quantityTracked===false;
  if(untracked&&rawSummary.availableSalePackages!==null)throw Error('تعذر التحقق من ملخص التوفر.');
  return {
    ...(untracked?{quantityTracked:false}:{}),
    availableProducts: integerValue(rawSummary.availableProducts),
    availableSalePackages: untracked?null:integerValue(rawSummary.availableSalePackages),
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
  const { data, error } = await readOperatingCatalog(operatingCatalogRpc,'lite1_catalog_page2', {
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

  const untracked=quantityFreePayload(data,'lite2-catalog-v1'),payload=data as RawCatalogItem;
  if(untracked&&(!Array.isArray(payload.items)||payload.items.some((p:RawCatalogItem)=>p.quantityTracked!==false)))throw Error('تعذر التحقق من توفر المنتجات.');
  const items = mapCatalogItems(payload.items);
  const rawCategories = Array.isArray(payload.categories)
    ? payload.categories
    : [];
  const mappedCategories: CatalogCategory[] = rawCategories
    .map((item: RawCatalogItem) => mapCatalogCategory(item))
    .filter(
      (category: CatalogCategory) =>
        Boolean(category.id) && Boolean(category.nameAr)
    );

  const rawBrands = Array.isArray(payload.brands) ? payload.brands : [];
  const rawSaleUnits = Array.isArray(payload.saleUnits) ? payload.saleUnits : [];
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
    summary: mapCatalogSummary(payload.summary),
    total: resolveCatalogTotal(items.length, payload.total),
    limit: integerValue(payload.limit, requestedLimit),
    offset: integerValue(payload.offset),
  };
}

/**
 * Loads all home merchandising rails in one bounded server response. The
 * response contains at most six product families per rail and no catalog facets.
 */
export async function fetchPublicStorefrontMerchandising(): Promise<PublicMerchandisingResponse> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('إعدادات الاتصال بكتالوج Supabase غير مكتملة في موقع العملاء.');
  }

  const { data, error } = await readOperatingCatalog(operatingCatalogRpc,'lite1_merchandising2');
  if (error) {
    throw new Error(error.message || 'تعذر تحميل الاختيارات المميزة.');
  }

  return mapPublicMerchandisingResponse(data);
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
