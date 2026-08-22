export function getRemainingProductPackages(
  availablePackages: number,
  cartQuantity: number
): number {
  return Math.max(
    0,
    Math.floor(availablePackages) - Math.max(0, Math.floor(cartQuantity))
  );
}

export function clampProductSelectionQuantity(
  requestedQuantity: number,
  availablePackages: number,
  cartQuantity: number
): number {
  const remaining = getRemainingProductPackages(
    availablePackages,
    cartQuantity
  );
  if (remaining === 0) return 0;

  return Math.min(
    remaining,
    Math.max(1, Math.floor(requestedQuantity || 1))
  );
}

export function calculateProductSelectionTotal(
  priceInMinorUnits: number,
  quantity: number
): number {
  return (
    Math.max(0, Math.round(priceInMinorUnits)) *
    Math.max(0, Math.floor(quantity))
  );
}

export function buildProductShareUrl(currentUrl: string, productKey: string) {
  const url = new URL(currentUrl);
  url.hash = `product=${encodeURIComponent(productKey)}`;
  return url.toString();
}
