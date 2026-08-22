export const MINOR_UNITS_PER_JOD = 1000;

export const jodToMinorUnits = (value: number): number =>
  Math.round(Math.max(0, Number(value) || 0) * MINOR_UNITS_PER_JOD);

export const minorUnitsToJod = (value: number): number =>
  (Number(value) || 0) / MINOR_UNITS_PER_JOD;

export const normalizeIntegerQuantity = (value: number, minimum = 1): number =>
  Math.max(minimum, Math.floor(Number(value) || minimum));

export interface ReceivingLineCalculationInput {
  packageQuantity: number;
  unitsPerPackage: number;
  packagePriceInMinorUnits: number;
  discountInMinorUnits?: number;
  sellingPriceInMinorUnits?: number;
}

export interface ReceivingLineCalculation {
  packageQuantity: number;
  unitsPerPackage: number;
  totalBaseUnits: number;
  lineSubtotalInMinorUnits: number;
  discountInMinorUnits: number;
  lineTotalInMinorUnits: number;
  effectiveUnitCostInMinorUnits: number;
  sellingPriceInMinorUnits: number;
  profitPerUnitInMinorUnits: number;
  profitPercentage: number;
}

export const calculateReceivingLine = (
  input: ReceivingLineCalculationInput
): ReceivingLineCalculation => {
  const packageQuantity = normalizeIntegerQuantity(input.packageQuantity);
  const unitsPerPackage = normalizeIntegerQuantity(input.unitsPerPackage);
  const packagePriceInMinorUnits = Math.max(
    0,
    Math.round(Number(input.packagePriceInMinorUnits) || 0)
  );
  const totalBaseUnits = packageQuantity * unitsPerPackage;
  const lineSubtotalInMinorUnits = packageQuantity * packagePriceInMinorUnits;
  const discountInMinorUnits = Math.min(
    lineSubtotalInMinorUnits,
    Math.max(0, Math.round(Number(input.discountInMinorUnits) || 0))
  );
  const lineTotalInMinorUnits = lineSubtotalInMinorUnits - discountInMinorUnits;
  const effectiveUnitCostInMinorUnits =
    totalBaseUnits > 0 ? Math.round(lineTotalInMinorUnits / totalBaseUnits) : 0;
  const sellingPriceInMinorUnits = Math.max(
    0,
    Math.round(Number(input.sellingPriceInMinorUnits) || 0)
  );
  const profitPerUnitInMinorUnits =
    sellingPriceInMinorUnits - effectiveUnitCostInMinorUnits;
  const profitPercentage =
    effectiveUnitCostInMinorUnits > 0
      ? (profitPerUnitInMinorUnits / effectiveUnitCostInMinorUnits) * 100
      : 0;

  return {
    packageQuantity,
    unitsPerPackage,
    totalBaseUnits,
    lineSubtotalInMinorUnits,
    discountInMinorUnits,
    lineTotalInMinorUnits,
    effectiveUnitCostInMinorUnits,
    sellingPriceInMinorUnits,
    profitPerUnitInMinorUnits,
    profitPercentage,
  };
};
