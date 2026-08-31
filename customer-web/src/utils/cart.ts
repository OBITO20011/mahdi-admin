import { CartItem, CatalogProduct } from '../types/catalog';

export const CART_STORAGE_KEY = 'nawasrah-wholesale-cart-v1';

export function createCartItem(product: CatalogProduct): CartItem {
  return {
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

export function reconcileCart(
  cartItems: CartItem[],
  products: CatalogProduct[]
): CartItem[] {
  const productsById = new Map(
    products.map((product) => [product.id, product])
  );

  return cartItems.flatMap((item) => {
    const product = productsById.get(item.productId);
    if (!product || !product.isAvailable || product.availableSalePackages < 1) {
      return [];
    }

    return [
      {
        ...item,
        sku: product.sku,
        nameAr: product.nameAr,
        imageUrl: product.imageUrl,
        saleUnitNameAr: product.saleUnitNameAr,
        unitsPerSalePackage: product.unitsPerSalePackage,
        unitPriceInMinorUnits: product.salePackagePriceInMinorUnits,
        maxAvailablePackages: product.availableSalePackages,
        quantity: Math.min(
          Math.max(1, Math.floor(item.quantity || 1)),
          product.availableSalePackages
        ),
      },
    ];
  });
}

export interface CartSnapshotReconciliation {
  items: CartItem[];
  priceChanges: number;
  quantityAdjustments: number;
  removedUnavailableItems: number;
}

export interface LastOrderSnapshotItem {
  productId: string;
  quantity: number;
}

export interface LastOrderSnapshotRestoration {
  items: CartItem[];
  unavailableItems: number;
  quantityAdjustments: number;
}

/**
 * Rebuilds a previous order only from the current, server-supplied snapshot.
 * The saved order is used solely for product identity and requested quantity;
 * price, availability and package limits always come from the snapshot.
 */
export function restoreLastOrderFromSnapshot(
  savedItems: LastOrderSnapshotItem[],
  snapshotProducts: CatalogProduct[]
): LastOrderSnapshotRestoration {
  const requestedQuantityByProductId = new Map<string, number>();
  for (const savedItem of savedItems) {
    if (!savedItem.productId) continue;
    const requestedQuantity = Math.max(1, Math.floor(savedItem.quantity || 1));
    requestedQuantityByProductId.set(
      savedItem.productId,
      (requestedQuantityByProductId.get(savedItem.productId) ?? 0) + requestedQuantity
    );
  }

  const productsById = new Map(
    snapshotProducts.map((product) => [product.id, product])
  );
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

/**
 * Applies a server snapshot only to the exact cart IDs that were requested.
 * Items added while the request was in flight stay untouched; a requested ID
 * absent from the public snapshot is no longer sellable and is removed.
 */
export function reconcileCartSnapshot(
  cartItems: CartItem[],
  products: CatalogProduct[],
  requestedProductIds: string[]
): CartSnapshotReconciliation {
  const requestedIds = new Set(requestedProductIds);
  const productsById = new Map(products.map((product) => [product.id, product]));
  let priceChanges = 0;
  let quantityAdjustments = 0;
  let removedUnavailableItems = 0;

  const items = cartItems.flatMap((item) => {
    if (!requestedIds.has(item.productId)) return [item];

    const product = productsById.get(item.productId);
    if (!product || !product.isAvailable || product.availableSalePackages < 1) {
      removedUnavailableItems += 1;
      return [];
    }

    const [reconciledItem] = reconcileCart([item], [product]);
    if (!reconciledItem) {
      removedUnavailableItems += 1;
      return [];
    }
    if (reconciledItem.unitPriceInMinorUnits !== item.unitPriceInMinorUnits) {
      priceChanges += 1;
    }
    if (
      reconciledItem.maxAvailablePackages !== item.maxAvailablePackages ||
      reconciledItem.quantity !== item.quantity
    ) {
      quantityAdjustments += 1;
    }
    return [reconciledItem];
  });

  return {
    items,
    priceChanges,
    quantityAdjustments,
    removedUnavailableItems,
  };
}

/**
 * A catalog page is not the customer's entire cart. Refresh only the items
 * returned by that page and preserve unseen items for checkout revalidation.
 */
export function reconcileCartPage(
  cartItems: CartItem[],
  products: CatalogProduct[]
): CartItem[] {
  const productsById = new Map(products.map((product) => [product.id, product]));

  return cartItems.flatMap((item) => {
    const product = productsById.get(item.productId);
    if (!product) return [item];
    return reconcileCart([item], [product]);
  });
}

export function calculateCartSubtotal(cartItems: CartItem[]): number {
  return cartItems.reduce(
    (sum, item) =>
      sum +
      Math.max(0, Math.floor(item.quantity)) *
        Math.max(0, Math.round(item.unitPriceInMinorUnits)),
    0
  );
}

export function calculateCartPackages(cartItems: CartItem[]): number {
  return cartItems.reduce(
    (sum, item) => sum + Math.max(0, Math.floor(item.quantity)),
    0
  );
}
