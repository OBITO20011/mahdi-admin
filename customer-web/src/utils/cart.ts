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
