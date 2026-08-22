const round = (value: number, precision: number) => {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export interface ProductProfitMetrics {
  profitPerUnit: number;
  marginPercentage: number;
  markupPercentage: number;
  isLoss: boolean;
}

export function calculateUnitCost(
  packagePrice: number,
  unitsPerPackage: number
): number {
  const safePackagePrice = Math.max(0, Number(packagePrice) || 0);
  const safeUnitsPerPackage = Math.max(
    1,
    Math.floor(Number(unitsPerPackage) || 1)
  );

  return round(safePackagePrice / safeUnitsPerPackage, 4);
}

export function calculatePackagePrice(
  unitCost: number,
  unitsPerPackage: number
): number {
  const safeUnitCost = Math.max(0, Number(unitCost) || 0);
  const safeUnitsPerPackage = Math.max(
    1,
    Math.floor(Number(unitsPerPackage) || 1)
  );

  return round(safeUnitCost * safeUnitsPerPackage, 4);
}

export function calculateProductProfit(
  salePrice: number,
  costPrice: number
): ProductProfitMetrics {
  const safeSalePrice = Math.max(0, Number(salePrice) || 0);
  const safeCostPrice = Math.max(0, Number(costPrice) || 0);
  const profitPerUnit = round(safeSalePrice - safeCostPrice, 4);

  return {
    profitPerUnit,
    marginPercentage:
      safeSalePrice > 0
        ? round((profitPerUnit / safeSalePrice) * 100, 1)
        : 0,
    markupPercentage:
      safeCostPrice > 0
        ? round((profitPerUnit / safeCostPrice) * 100, 1)
        : 0,
    isLoss: safeSalePrice > 0 && safeSalePrice < safeCostPrice,
  };
}
