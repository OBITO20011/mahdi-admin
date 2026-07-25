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
