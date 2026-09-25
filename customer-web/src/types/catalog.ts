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
  salePriceInMinorUnits: number;
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

/** Bounded, server-selected product families for the home merchandising rails. */
export interface PublicMerchandisingResponse {
  newest: CatalogProduct[];
  bestSellers: CatalogProduct[];
  offers: CatalogProduct[];
  lowStock: CatalogProduct[];
}

export interface CartDisplayFields {
  schemaVersion: 2;
  localLineId: string;
  localRevision: number;
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

export interface BaseUnitCartItem extends CartDisplayFields {
  commercialLineKind: 'base_unit';
  unitsPerSalePackage: 1;
}

export interface LegacyParcelCartItem extends CartDisplayFields {
  commercialLineKind: 'legacy_single_sku_parcel';
}

export interface ParcelComponentSelection {
  productId: string;
  sku: string;
  nameAr: string;
  flavorNameAr: string;
  unitNameAr: string;
  imageUrl: string;
  baseQuantity: number;
}

export interface ParcelInstanceSelection {
  localInstanceId: string;
  localRevision: number;
  components: ParcelComponentSelection[];
}

export interface ConfigurableParcelCartItem extends CartDisplayFields {
  commercialLineKind: 'configurable_parcel';
  familyProductId: string;
  parcelConfigurationId: string;
  configurationRevision: number;
  compositionMode: 'configurable_mix';
  capacity: number;
  parcelInstances: ParcelInstanceSelection[];
}

export type CartItem =
  | BaseUnitCartItem
  | LegacyParcelCartItem
  | ConfigurableParcelCartItem;

export type ConfigurableParcelFeatureState = 'OFF' | 'OWNER_PILOT' | 'ENABLED';

export interface PublicParcelComponentOption {
  productId: string;
  sku: string;
  nameAr: string;
  flavorNameAr: string;
  unitNameAr: string;
  imageUrl: string;
  availableQuantity: number;
}

export interface PublicConfigurableParcelOption {
  familyProductId: string;
  parcelConfigurationId: string;
  configurationRevision: number;
  compositionMode: 'configurable_mix';
  unitsPerParcel: number;
  parcelPriceInMinorUnits: number;
  baseUnitNameAr: string;
  saleUnitNameAr: string;
  components: PublicParcelComponentOption[];
}

export interface PublicConfigurableParcelResponse {
  featureState: ConfigurableParcelFeatureState;
  guestCreationEnabled: boolean;
  options: PublicConfigurableParcelOption[];
}
