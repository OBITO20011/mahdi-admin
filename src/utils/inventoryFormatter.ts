/**
 * Nawasrah Business Manager - Inventory Quantity Formatter Utility
 * Converts internal base units (pieces) into wholesale carton + remaining pieces representation.
 */

export interface WholesaleInventoryFormat {
  cartons: number;
  remainingPieces: number;
  cartonLabel: string;
  pieceLabel: string;
  cartonFormatted: string; // e.g. "📦 1 كرتونة + 0 قطعة"
  totalPiecesFormatted: string; // e.g. "(12 قطعة)"
  fullFormatted: string; // e.g. "📦 1 كرتونة + 0 قطعة (12 قطعة)"
}

export interface FlavorInventoryInput {
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  unitsPerPackage?: number;
  purchasePackage?: string;
  unit?: string;
}

export interface FlavorFamilyInventorySummary {
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  hasCompatiblePackaging: boolean;
  unitsPerPackage: number;
  purchasePackage: string;
  unit: string;
}

/**
 * Sums real flavor-child balances for read-only family presentation.
 * It never creates or mutates inventory for the flavor master.
 */
export function summarizeFlavorFamilyInventory(
  flavors: FlavorInventoryInput[]
): FlavorFamilyInventorySummary {
  const first = flavors[0];
  const unitsPerPackage = Math.max(1, Math.floor(first?.unitsPerPackage || 1));
  const purchasePackage = first?.purchasePackage || 'كرتونة';
  const unit = first?.unit || 'قطعة';
  const hasCompatiblePackaging = flavors.every(
    (flavor) =>
      Math.max(1, Math.floor(flavor.unitsPerPackage || 1)) === unitsPerPackage &&
      (flavor.purchasePackage || 'كرتونة') === purchasePackage &&
      (flavor.unit || 'قطعة') === unit
  );

  return {
    onHandQuantity: flavors.reduce(
      (total, flavor) => total + Math.max(0, Math.floor(flavor.onHandQuantity || 0)),
      0
    ),
    reservedQuantity: flavors.reduce(
      (total, flavor) => total + Math.max(0, Math.floor(flavor.reservedQuantity || 0)),
      0
    ),
    availableQuantity: flavors.reduce(
      (total, flavor) => total + Math.max(0, Math.floor(flavor.availableQuantity || 0)),
      0
    ),
    hasCompatiblePackaging,
    unitsPerPackage,
    purchasePackage,
    unit,
  };
}

/**
 * Formats raw pieces count into cartons + remaining pieces and total pieces subtitle.
 */
export function formatWholesaleInventory(
  totalPieces: number,
  unitsPerPackage: number = 12,
  purchasePackageName: string = 'كرتونة',
  baseUnitName: string = 'قطعة'
): WholesaleInventoryFormat {
  const pkgSize = Math.max(1, Math.floor(unitsPerPackage || 12));
  const pieces = Math.max(0, Math.floor(totalPieces || 0));

  const cartons = Math.floor(pieces / pkgSize);
  const remainingPieces = pieces % pkgSize;

  // Pluralization logic for Cartons
  let cartonLabel = purchasePackageName || 'كرتونة';
  if (cartonLabel === 'كرتونة') {
    if (cartons >= 3 && cartons <= 10) {
      cartonLabel = 'كراتين';
    } else {
      cartonLabel = 'كرتونة';
    }
  } else if (cartonLabel === 'طرد') {
    if (cartons >= 3 && cartons <= 10) {
      cartonLabel = 'طرود';
    } else {
      cartonLabel = 'طرد';
    }
  }

  // Pluralization logic for Pieces
  let pieceLabel = baseUnitName || 'قطعة';
  if (pieceLabel === 'قطعة') {
    if (remainingPieces >= 3 && remainingPieces <= 10) {
      pieceLabel = 'قطع';
    } else {
      pieceLabel = 'قطعة';
    }
  }

  const cartonFormatted = `📦 ${cartons} ${cartonLabel} + ${remainingPieces} ${pieceLabel}`;
  const totalPiecesFormatted = `(${pieces} ${baseUnitName || 'قطعة'})`;

  return {
    cartons,
    remainingPieces,
    cartonLabel,
    pieceLabel,
    cartonFormatted,
    totalPiecesFormatted,
    fullFormatted: `${cartonFormatted} ${totalPiecesFormatted}`,
  };
}

/**
 * Helper to format directly from a Product object.
 */
export function formatProductInventory(
  product: {
    onHandQuantity?: number;
    availableQuantity?: number;
    unitsPerPackage?: number;
    cartonSize?: number;
    packetSize?: number;
    purchasePackage?: string;
    unit?: string;
  },
  useAvailable: boolean = false
): WholesaleInventoryFormat {
  const pieces = useAvailable
    ? (product.availableQuantity !== undefined ? product.availableQuantity : (product.onHandQuantity || 0))
    : (product.onHandQuantity || 0);

  const unitsPerPkg = product.unitsPerPackage || product.cartonSize || product.packetSize || 12;
  const pkgName = product.purchasePackage || 'كرتونة';
  const baseUnit = product.unit || 'قطعة';

  return formatWholesaleInventory(pieces, unitsPerPkg, pkgName, baseUnit);
}
