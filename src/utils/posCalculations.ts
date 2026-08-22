import { jodToMinorUnits, minorUnitsToJod } from './receivingCalculations';

export interface PosCalculationItem {
  unitPrice: number;
  quantity: number;
}

export interface PosSummary {
  subtotal: number;
  discount: number;
  total: number;
  amountReceived: number;
  changeDue: number;
}

export function calculateAvailableSalePackages(
  availableBaseQuantity: number,
  unitsPerSalePackage: number
): number {
  const available = Math.max(
    0,
    Math.floor(Number(availableBaseQuantity) || 0)
  );
  const packageSize = Math.max(
    1,
    Math.floor(Number(unitsPerSalePackage) || 1)
  );
  return Math.floor(available / packageSize);
}

export function calculateSaleBaseQuantity(
  salePackageQuantity: number,
  unitsPerSalePackage: number
): number {
  const packages = Math.max(
    0,
    Math.floor(Number(salePackageQuantity) || 0)
  );
  const packageSize = Math.max(
    1,
    Math.floor(Number(unitsPerSalePackage) || 1)
  );
  return packages * packageSize;
}

export function canSetPosQuantity(
  requestedPackageQuantity: number,
  availablePackageQuantity: number
): boolean {
  return (
    Number.isInteger(requestedPackageQuantity) &&
    requestedPackageQuantity > 0 &&
    requestedPackageQuantity <=
      Math.max(0, Math.floor(availablePackageQuantity))
  );
}

export function calculatePosSummary(
  items: PosCalculationItem[],
  discountJod: number,
  amountReceivedJod: number
): PosSummary {
  const subtotalInMinorUnits = items.reduce((sum, item) => {
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    return sum + jodToMinorUnits(item.unitPrice) * quantity;
  }, 0);
  const discountInMinorUnits = Math.max(
    0,
    jodToMinorUnits(discountJod)
  );
  const totalInMinorUnits = Math.max(
    0,
    subtotalInMinorUnits - discountInMinorUnits
  );
  const amountReceivedInMinorUnits = Math.max(
    0,
    jodToMinorUnits(amountReceivedJod)
  );

  return {
    subtotal: minorUnitsToJod(subtotalInMinorUnits),
    discount: minorUnitsToJod(discountInMinorUnits),
    total: minorUnitsToJod(totalInMinorUnits),
    amountReceived: minorUnitsToJod(amountReceivedInMinorUnits),
    changeDue: minorUnitsToJod(
      Math.max(0, amountReceivedInMinorUnits - totalInMinorUnits)
    ),
  };
}
