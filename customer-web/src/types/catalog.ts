export interface CatalogProduct {
  id: string;
  sku: string;
  barcode: string;
  nameAr: string;
  description: string;
  categoryId: string;
  categoryCode: string;
  categoryNameAr: string;
  brandId: string;
  brandNameAr: string;
  unitId: string;
  unitNameAr: string;
  saleUnitId: string;
  saleUnitNameAr: string;
  unitsPerSalePackage: number;
  salePackagePriceInMinorUnits: number;
  availableQuantity: number;
  availableSalePackages: number;
  minimumOrderPackages: number;
  imageUrl: string;
  isAvailable: boolean;
  createdAt: string;
  soldPackagesLast90Days: number;
  isFlavorMaster: boolean;
  flavorMasterProductId: string;
  flavorNameAr: string;
  flavorSortOrder: number;
  /** Sellable inventory rows. Empty for a regular product. */
  variants: CatalogProduct[];
}

export interface CatalogCategory {
  id: string;
  code: string;
  nameAr: string;
  imageUrl: string;
  productCount: number;
  availableProductCount: number;
}

export interface CatalogFacet {
  id: string;
  nameAr: string;
}

export interface CatalogSummary {
  availableProducts: number;
  availableSalePackages: number;
  lowStockProducts: number;
}

export interface PublicCatalogQuery {
  limit?: number;
  offset?: number;
  categoryId?: string;
  searchQuery?: string;
  availability?: 'all' | 'available' | 'low_stock';
  sort?:
    | 'recommended'
    | 'name_asc'
    | 'price_asc'
    | 'price_desc'
    | 'stock_desc'
    | 'newest'
    | 'best_sellers'
    | 'offers'
    | 'low_stock';
  brandId?: string;
  saleUnitId?: string;
  productIds?: string[];
}

export interface CatalogResponse {
  items: CatalogProduct[];
  categories: CatalogCategory[];
  brands: CatalogFacet[];
  saleUnits: CatalogFacet[];
  summary: CatalogSummary;
  total: number;
  limit: number;
  offset: number;
}

export interface CartItem {
  productId: string;
  sku: string;
  nameAr: string;
  imageUrl: string;
  saleUnitNameAr: string;
  unitsPerSalePackage: number;
  unitPriceInMinorUnits: number;
  quantity: number;
  maxAvailablePackages: number;
}
