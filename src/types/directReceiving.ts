/**
 * Nawasrah Business Manager - Direct Goods Receiving Types
 * Types for wholesale direct supplier goods receiving module
 */

export type ReceiptPaymentStatus = 'unpaid' | 'partially_paid' | 'paid';
export type ReceiptStatus = 'completed' | 'cancelled' | 'returned';

export interface PurchaseUnitOption {
  id: string;
  name: string;
  code: string;
}

export interface SupplierReceiptItem {
  id: string;
  supplierReceiptId: string;
  productId: string;
  productName?: string;
  productSku?: string;
  productBarcode?: string;
  purchaseUnitId?: string;
  baseUnitId?: string;
  purchaseUnitName?: string;
  baseUnitName?: string;
  packageQuantity: number; // INTEGER
  unitsPerPackage: number; // INTEGER
  totalBaseUnits: number; // INTEGER
  packagePriceInMinorUnits: number;
  baseUnitCostInMinorUnits: number;
  sellingPriceInMinorUnits?: number;
  profitPerPieceInMinorUnits?: number;
  profitPercentage?: number;
  discountInMinorUnits: number;
  lineTotalInMinorUnits: number;
  batchNumber?: string;
  productionDate?: string;
  expiryDate?: string;
  notes?: string;
  createdAt: string;
}

export interface SupplierReceiptPayment {
  id: string;
  supplierReceiptId?: string;
  supplierId: string;
  amountInMinorUnits: number;
  paymentMethod: string;
  referenceNumber?: string;
  paymentDate: string;
  notes?: string;
  createdBy?: string;
  isReversed?: boolean;
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  createdAt: string;
}

export interface SupplierReceipt {
  id: string;
  receiptNumber: string;
  supplierId: string;
  supplierName?: string;
  supplierPhone?: string;
  warehouseId: string;
  warehouseName?: string;
  branchId?: string;
  branchName?: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  receivedAt: string;
  receivedBy?: string;
  receivedByName?: string;
  subtotalInMinorUnits: number;
  discountInMinorUnits: number;
  deliveryFeeInMinorUnits: number;
  taxInMinorUnits: number;
  totalInMinorUnits: number;
  amountPaidInMinorUnits: number;
  amountDueInMinorUnits: number;
  paymentStatus: ReceiptPaymentStatus;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  internalNotes?: string;
  status: ReceiptStatus;
  isArchived: boolean;
  items?: SupplierReceiptItem[];
  payments?: SupplierReceiptPayment[];
  createdAt: string;
  updatedAt: string;
}

export interface DirectReceiptItemInput {
  productId: string;
  productName?: string;
  productSku?: string;
  productBarcode?: string;
  purchaseUnitId?: string;
  baseUnitId?: string;
  purchaseUnitName: string;
  baseUnitName: string;
  packageQuantity: number; // INTEGER
  unitsPerPackage: number; // INTEGER
  packagePriceInMinorUnits: number;
  updateProductDefaults?: boolean;
  discountInMinorUnits?: number;
  batchNumber?: string;
  productionDate?: string;
  expiryDate?: string;
  notes?: string;
}

export interface DirectReceiptForm {
  supplierId: string;
  warehouseId: string;
  branchId?: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  receivedAt: string;
  deliveryFeeInMinorUnits: number;
  discountInMinorUnits: number;
  taxInMinorUnits: number;
  amountPaidInMinorUnits: number;
  paymentMethod: string;
  paymentReference?: string;
  notes?: string;
  internalNotes?: string;
  idempotencyKey?: string;
  items: DirectReceiptItemInput[];
}

export interface ReceivingProduct {
  id: string;
  nameAr: string;
  sku: string;
  barcode: string;
  baseUnitId?: string;
  baseUnitName: string;
  baseUnitCode?: string;
  purchaseUnitId?: string;
  purchaseUnitName: string;
  purchaseUnitCode?: string;
  unitsPerPackage: number;
  defaultPackagePriceInMinorUnits: number;
  costPriceInMinorUnits: number;
  salePriceInMinorUnits: number;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStockLevel: number;
  inventoryBalances: Array<{
    warehouseId: string;
    onHandQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
}
