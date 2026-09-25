import {
  BaseUnitCartItem,
  CartItem,
  CatalogProduct,
  ConfigurableParcelCartItem,
  LegacyParcelCartItem,
  ParcelComponentSelection,
  ParcelInstanceSelection,
  PublicConfigurableParcelOption,
} from '../types/catalog';

export const CART_STORAGE_KEY = 'nawasrah-wholesale-cart-v1';
export const CART_RECOVERY_BACKUP_STORAGE_KEY =
  'nawasrah-wholesale-cart-recovery-backup-v1';
export const CART_SCHEMA_VERSION = 2;

export interface InvalidPersistedCartEntry {
  index: number;
  localLineId?: string;
  commercialLineKind?: string;
  reason: 'INVALID_ITEM' | 'INVALID_LEGACY_ITEM' | 'INVALID_RECONCILIATION_MARKER';
}

export interface CartStorageRecovery {
  status: 'INVALID' | 'PARTIALLY_INVALID';
  originalRaw: string | null;
  invalidEntries: InvalidPersistedCartEntry[];
  validItems: CartItem[];
  reconciledAttemptIds: string[];
  reconciliations?: Array<{
    attemptId: string;
    orderId: string;
    mutationId: string;
    appliedAt: number;
  }>;
  reason:
    | 'CORRUPT_JSON'
    | 'INVALID_DOCUMENT'
    | 'PARTIALLY_INVALID_DOCUMENT'
    | 'STORAGE_UNAVAILABLE';
}


function newLocalId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('المتصفح لا يدعم إنشاء هوية آمنة للسلة.');
  }
  return globalThis.crypto.randomUUID();
}

function positiveInteger(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonnegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function cartDisplayFields(product: CatalogProduct) {
  return {
    schemaVersion: 2 as const,
    localLineId: newLocalId(),
    localRevision: 1,
    productId: product.id,
    sku: product.sku,
    nameAr: product.nameAr,
    imageUrl: product.imageUrl,
    saleUnitNameAr: product.saleUnitNameAr,
    unitsPerSalePackage: product.unitsPerSalePackage,
    unitPriceInMinorUnits: product.salePackagePriceInMinorUnits,
    quantity: 1,
    maxAvailablePackages: product.availableSalePackages,
  };
}

/** Existing catalogue quick-add remains the explicit legacy single-SKU parcel path. */
export function createCartItem(product: CatalogProduct): LegacyParcelCartItem {
  return {
    ...cartDisplayFields(product),
    commercialLineKind: 'legacy_single_sku_parcel',
  };
}

export function createBaseUnitCartItem(product: CatalogProduct): BaseUnitCartItem {
  return {
    ...cartDisplayFields(product),
    commercialLineKind: 'base_unit',
    saleUnitNameAr: product.unitNameAr || 'وحدة',
    unitsPerSalePackage: 1,
    unitPriceInMinorUnits: product.salePriceInMinorUnits,
    maxAvailablePackages: product.availableQuantity,
  };
}

export function createParcelInstance(
  components: ParcelComponentSelection[]
): ParcelInstanceSelection {
  return {
    localInstanceId: newLocalId(),
    localRevision: 1,
    components: components
      .filter((component) => component.baseQuantity > 0)
      .map((component) => ({
        ...component,
        baseQuantity: positiveInteger(component.baseQuantity),
      })),
  };
}

export function parcelInstanceQuantity(instance: ParcelInstanceSelection): number {
  return instance.components.reduce(
    (sum, component) => sum + nonnegativeInteger(component.baseQuantity),
    0
  );
}

export function createConfigurableParcelCartItem(
  familyProduct: CatalogProduct,
  option: PublicConfigurableParcelOption,
  instance: ParcelInstanceSelection
): ConfigurableParcelCartItem {
  if (parcelInstanceQuantity(instance) !== option.unitsPerParcel) {
    throw new Error(`يجب اختيار ${option.unitsPerParcel} ${option.baseUnitNameAr} للطرد.`);
  }
  return {
    ...cartDisplayFields(familyProduct),
    commercialLineKind: 'configurable_parcel',
    productId: option.familyProductId,
    familyProductId: option.familyProductId,
    parcelConfigurationId: option.parcelConfigurationId,
    configurationRevision: option.configurationRevision,
    compositionMode: option.compositionMode,
    capacity: option.unitsPerParcel,
    saleUnitNameAr: option.saleUnitNameAr,
    unitsPerSalePackage: option.unitsPerParcel,
    unitPriceInMinorUnits: option.parcelPriceInMinorUnits,
    quantity: 1,
    maxAvailablePackages: Number.MAX_SAFE_INTEGER,
    parcelInstances: [instance],
  };
}

function deterministicLegacyLineId(value: Record<string, unknown>, index: number): string {
  const input = `${index}:${JSON.stringify(value)}`;
  let hash = 2166136261;
  for (let offset = 0; offset < input.length; offset += 1) {
    hash ^= input.charCodeAt(offset);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${index}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function migrateLegacyCartItem(
  value: unknown,
  index = 0
): LegacyParcelCartItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.productId !== 'string' || !item.productId) return null;
  return {
    schemaVersion: 2,
    localLineId:
      typeof item.localLineId === 'string' && item.localLineId.length > 0
        ? item.localLineId
        : deterministicLegacyLineId(item, index),
    localRevision: 1,
    commercialLineKind: 'legacy_single_sku_parcel',
    productId: item.productId,
    sku: typeof item.sku === 'string' ? item.sku : '',
    nameAr: typeof item.nameAr === 'string' ? item.nameAr : 'صنف محفوظ',
    imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : '',
    saleUnitNameAr:
      typeof item.saleUnitNameAr === 'string' ? item.saleUnitNameAr : 'طرد',
    unitsPerSalePackage: positiveInteger(item.unitsPerSalePackage),
    unitPriceInMinorUnits: nonnegativeInteger(item.unitPriceInMinorUnits),
    quantity: positiveInteger(item.quantity),
    maxAvailablePackages: positiveInteger(
      item.maxAvailablePackages,
      Number.MAX_SAFE_INTEGER
    ),
  };
}

export function isCurrentCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CartItem>;
  const validDisplayFields =
    item.schemaVersion === 2 &&
    typeof item.localLineId === 'string' &&
    item.localLineId.length > 0 &&
    Number.isInteger(item.localRevision) &&
    Number(item.localRevision) > 0 &&
    typeof item.productId === 'string' &&
    item.productId.length > 0 &&
    typeof item.sku === 'string' &&
    typeof item.nameAr === 'string' &&
    typeof item.imageUrl === 'string' &&
    typeof item.saleUnitNameAr === 'string' &&
    Number.isInteger(item.unitsPerSalePackage) &&
    Number(item.unitsPerSalePackage) > 0 &&
    Number.isInteger(item.unitPriceInMinorUnits) &&
    Number(item.unitPriceInMinorUnits) >= 0 &&
    Number.isInteger(item.quantity) &&
    Number(item.quantity) > 0 &&
    Number.isInteger(item.maxAvailablePackages) &&
    Number(item.maxAvailablePackages) > 0;
  if (
    !validDisplayFields ||
    !['base_unit', 'legacy_single_sku_parcel', 'configurable_parcel'].includes(
      String(item.commercialLineKind)
    )
  ) return false;
  if (item.commercialLineKind === 'base_unit') {
    return item.unitsPerSalePackage === 1;
  }
  if (item.commercialLineKind === 'legacy_single_sku_parcel') return true;
  const parcel = item as Partial<ConfigurableParcelCartItem>;
  const parcelInstances: unknown[] = Array.isArray(parcel.parcelInstances)
    ? parcel.parcelInstances
    : [];
  return (
    typeof parcel.familyProductId === 'string' &&
    parcel.familyProductId.length > 0 &&
    typeof parcel.parcelConfigurationId === 'string' &&
    parcel.parcelConfigurationId.length > 0 &&
    Number.isInteger(parcel.configurationRevision) &&
    Number(parcel.configurationRevision) > 0 &&
    parcel.compositionMode === 'configurable_mix' &&
    Number.isInteger(parcel.capacity) &&
    Number(parcel.capacity) > 0 &&
    parcelInstances.length > 0 &&
    parcel.quantity === parcelInstances.length &&
    parcelInstances.every((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const instance = value as Record<string, unknown>;
      if (
        typeof instance.localInstanceId !== 'string' ||
        instance.localInstanceId.length === 0 ||
        !Number.isInteger(instance.localRevision) ||
        Number(instance.localRevision) <= 0 ||
        !Array.isArray(instance.components) ||
        instance.components.length === 0
      ) return false;
      let componentQuantity = 0;
      for (const value of instance.components) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const component = value as Record<string, unknown>;
        if (
          typeof component.productId !== 'string' ||
          component.productId.length === 0 ||
          typeof component.sku !== 'string' ||
          typeof component.nameAr !== 'string' ||
          typeof component.flavorNameAr !== 'string' ||
          typeof component.unitNameAr !== 'string' ||
          typeof component.imageUrl !== 'string' ||
          !Number.isInteger(component.baseQuantity) ||
          Number(component.baseQuantity) <= 0
        ) return false;
        componentQuantity += Number(component.baseQuantity);
      }
      return componentQuantity === parcel.capacity;
    }) &&
    new Set(parcelInstances.map((value) =>
      (value as Record<string, unknown>).localInstanceId
    )).size === parcelInstances.length
  );
}

export function reconcileCart(
  cartItems: CartItem[],
  products: CatalogProduct[]
): CartItem[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return cartItems.reduce<CartItem[]>((result, item) => {
    if (item.commercialLineKind === 'configurable_parcel') return [...result, item];
    const product = productsById.get(item.productId);
    const isBaseUnit = item.commercialLineKind === 'base_unit';
    const available = isBaseUnit ? product?.availableQuantity ?? 0 : product?.availableSalePackages ?? 0;
    if (!product || !product.isAvailable || available < 1) return result;
    return [...result, {
      ...item,
      sku: product.sku,
      nameAr: product.nameAr,
      imageUrl: product.imageUrl,
      saleUnitNameAr: isBaseUnit ? product.unitNameAr : product.saleUnitNameAr,
      unitsPerSalePackage: isBaseUnit ? 1 : product.unitsPerSalePackage,
      unitPriceInMinorUnits: isBaseUnit ? product.salePriceInMinorUnits : product.salePackagePriceInMinorUnits,
      maxAvailablePackages: available,
      quantity: Math.min(positiveInteger(item.quantity), available),
    } as CartItem];
  }, []);
}

export interface CartSnapshotReconciliation {
  items: CartItem[];
  priceChanges: number;
  quantityAdjustments: number;
  removedUnavailableItems: number;
}

export interface LastOrderSnapshotItem { productId: string; quantity: number; }
export interface LastOrderSnapshotRestoration {
  items: CartItem[];
  unavailableItems: number;
  quantityAdjustments: number;
}

export function restoreLastOrderFromSnapshot(
  savedItems: LastOrderSnapshotItem[],
  snapshotProducts: CatalogProduct[]
): LastOrderSnapshotRestoration {
  const requestedQuantityByProductId = new Map<string, number>();
  for (const savedItem of savedItems) {
    if (!savedItem.productId) continue;
    const requestedQuantity = positiveInteger(savedItem.quantity);
    requestedQuantityByProductId.set(
      savedItem.productId,
      (requestedQuantityByProductId.get(savedItem.productId) ?? 0) + requestedQuantity
    );
  }
  const productsById = new Map(snapshotProducts.map((product) => [product.id, product]));
  let unavailableItems = 0;
  let quantityAdjustments = 0;
  const items = Array.from(requestedQuantityByProductId.entries()).flatMap(
    ([productId, requestedQuantity]) => {
      const product = productsById.get(productId);
      if (!product || !product.isAvailable || product.availableSalePackages < 1) {
        unavailableItems += 1;
        return [];
      }
      const quantity = Math.min(requestedQuantity, product.availableSalePackages);
      if (quantity !== requestedQuantity) quantityAdjustments += 1;
      return [{ ...createCartItem(product), quantity }];
    }
  );
  return { items, unavailableItems, quantityAdjustments };
}

export function reconcileCartSnapshot(
  cartItems: CartItem[], products: CatalogProduct[], requestedProductIds: string[]
): CartSnapshotReconciliation {
  const requestedIds = new Set(requestedProductIds);
  const productsById = new Map(products.map((product) => [product.id, product]));
  let priceChanges = 0;
  let quantityAdjustments = 0;
  let removedUnavailableItems = 0;
  const items = cartItems.flatMap((item) => {
    if (item.commercialLineKind === 'configurable_parcel') return [item];
    if (!requestedIds.has(item.productId)) return [item];
    const product = productsById.get(item.productId);
    if (!product || !product.isAvailable) {
      removedUnavailableItems += 1;
      return [];
    }
    const [reconciledItem] = reconcileCart([item], [product]);
    if (!reconciledItem) {
      removedUnavailableItems += 1;
      return [];
    }
    if (reconciledItem.unitPriceInMinorUnits !== item.unitPriceInMinorUnits) priceChanges += 1;
    if (reconciledItem.maxAvailablePackages !== item.maxAvailablePackages || reconciledItem.quantity !== item.quantity) quantityAdjustments += 1;
    return [reconciledItem];
  });
  return { items, priceChanges, quantityAdjustments, removedUnavailableItems };
}

export function reconcileCartPage(cartItems: CartItem[], products: CatalogProduct[]): CartItem[] {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return cartItems.flatMap((item) => {
    if (item.commercialLineKind === 'configurable_parcel') return [item];
    const product = productsById.get(item.productId);
    return product ? reconcileCart([item], [product]) : [item];
  });
}

export function calculateCartSubtotal(cartItems: CartItem[]): number {
  return cartItems.reduce(
    (sum, item) => sum + positiveInteger(item.quantity) * nonnegativeInteger(item.unitPriceInMinorUnits), 0
  );
}

export function calculateCartPackages(cartItems: CartItem[]): number {
  return cartItems.reduce((sum, item) => sum + positiveInteger(item.quantity), 0);
}

export function requiredBaseUnitsByProductId(cartItems: CartItem[]): Map<string, number> {
  const required = new Map<string, number>();
  const add = (productId: string, quantity: number) => required.set(productId, (required.get(productId) ?? 0) + quantity);
  for (const item of cartItems) {
    if (item.commercialLineKind === 'base_unit') add(item.productId, positiveInteger(item.quantity));
    else if (item.commercialLineKind === 'legacy_single_sku_parcel') add(item.productId, positiveInteger(item.quantity) * positiveInteger(item.unitsPerSalePackage));
    else for (const instance of item.parcelInstances) for (const component of instance.components) add(component.productId, positiveInteger(component.baseQuantity));
  }
  return required;
}

export function duplicateParcelInstance(instance: ParcelInstanceSelection): ParcelInstanceSelection {
  return createParcelInstance(instance.components);
}

export function replaceParcelInstance(
  item: ConfigurableParcelCartItem,
  instanceId: string,
  replacement: ParcelInstanceSelection
): ConfigurableParcelCartItem {
  const parcelInstances = item.parcelInstances.map((instance) => instance.localInstanceId === instanceId ? replacement : instance);
  return { ...item, localRevision: item.localRevision + 1, quantity: parcelInstances.length, parcelInstances };
}

export function removeParcelInstance(
  item: ConfigurableParcelCartItem,
  instanceId: string
): ConfigurableParcelCartItem | null {
  const parcelInstances = item.parcelInstances.filter((instance) => instance.localInstanceId !== instanceId);
  if (parcelInstances.length === 0) return null;
  return { ...item, localRevision: item.localRevision + 1, quantity: parcelInstances.length, parcelInstances };
}
