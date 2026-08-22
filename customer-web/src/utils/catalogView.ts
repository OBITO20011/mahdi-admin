import { CatalogProduct } from '../types/catalog';

export type CatalogAvailabilityFilter = 'all' | 'available' | 'low_stock';

export type CatalogSortOption =
  | 'recommended'
  | 'name_asc'
  | 'price_asc'
  | 'price_desc'
  | 'stock_desc';

export const LOW_STOCK_PACKAGE_THRESHOLD = 5;

export interface CatalogViewOptions {
  searchQuery: string;
  categoryId: string;
  availability: CatalogAvailabilityFilter;
  sort: CatalogSortOption;
  brandId?: string;
  saleUnitId?: string;
}

export function normalizeCatalogSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0640\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim()
    .toLocaleLowerCase('ar');
}

export function isLowStockProduct(product: CatalogProduct): boolean {
  return (
    product.isAvailable &&
    product.availableSalePackages > 0 &&
    product.availableSalePackages <= LOW_STOCK_PACKAGE_THRESHOLD
  );
}

function compareAvailability(
  first: CatalogProduct,
  second: CatalogProduct
): number {
  return Number(second.isAvailable) - Number(first.isAvailable);
}

export function buildCatalogView(
  products: CatalogProduct[],
  options: CatalogViewOptions
): CatalogProduct[] {
  const normalizedSearch = normalizeCatalogSearch(options.searchQuery);
  const filtered = products.filter((product) => {
    if (
      options.categoryId !== 'all' &&
      product.categoryId !== options.categoryId
    ) {
      return false;
    }

    if (options.brandId && options.brandId !== 'all' && product.brandId !== options.brandId) {
      return false;
    }

    if (
      options.saleUnitId &&
      options.saleUnitId !== 'all' &&
      product.saleUnitId !== options.saleUnitId
    ) {
      return false;
    }

    if (options.availability === 'available' && !product.isAvailable) {
      return false;
    }
    if (
      options.availability === 'low_stock' &&
      !isLowStockProduct(product)
    ) {
      return false;
    }

    if (!normalizedSearch) return true;

    return [
      product.nameAr,
      product.description,
      product.sku,
      product.barcode,
      product.brandNameAr,
      product.categoryNameAr,
      product.saleUnitNameAr,
    ].some((value) =>
      normalizeCatalogSearch(value).includes(normalizedSearch)
    );
  });

  return filtered
    .map((product, index) => ({ product, index }))
    .sort((firstEntry, secondEntry) => {
      const first = firstEntry.product;
      const second = secondEntry.product;
      const availabilityOrder = compareAvailability(first, second);
      if (availabilityOrder !== 0) return availabilityOrder;

      let comparison = 0;
      switch (options.sort) {
        case 'name_asc':
          comparison = first.nameAr.localeCompare(second.nameAr, 'ar');
          break;
        case 'price_asc':
          comparison =
            first.salePackagePriceInMinorUnits -
            second.salePackagePriceInMinorUnits;
          break;
        case 'price_desc':
          comparison =
            second.salePackagePriceInMinorUnits -
            first.salePackagePriceInMinorUnits;
          break;
        case 'stock_desc':
          comparison =
            second.availableSalePackages - first.availableSalePackages;
          break;
        case 'recommended':
        default:
          comparison = firstEntry.index - secondEntry.index;
          break;
      }

      return (
        comparison ||
        first.nameAr.localeCompare(second.nameAr, 'ar') ||
        firstEntry.index - secondEntry.index
      );
    })
    .map(({ product }) => product);
}
