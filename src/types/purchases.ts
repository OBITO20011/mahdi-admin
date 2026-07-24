/**
 * Nawasrah Business Manager - Purchase Orders & Goods Receiving Types
 */

export type PurchaseOrderStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  orderedQuantity: number;
  receivedQuantity: number;
  purchasePrice: number; // in JOD
  discount: number; // in JOD
  lineTotal: number; // in JOD
}

export interface PurchaseReceiptItem {
  id: string;
  purchaseReceiptId: string;
  purchaseOrderItemId?: string;
  productId: string;
  productName: string;
  receivedQuantity: number;
  unitCost: number; // in JOD
}

export interface PurchaseReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  receivedBy: string;
  receivedByName?: string;
  receivedAt: string;
  supplierDeliveryNote?: string;
  notes?: string;
  items: PurchaseReceiptItem[];
}

export interface PurchaseOrder {
  id: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  branchId?: string;
  branchName?: string;
  warehouseId?: string;
  warehouseName?: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate?: string;
  subtotal: number; // in JOD
  discount: number; // in JOD
  deliveryFee: number; // in JOD
  totalAmount: number; // in JOD
  amountPaid: number; // in JOD
  amountDue: number; // in JOD
  supplierInvoiceNumber?: string;
  notes?: string;
  internalNotes?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
  receipts?: PurchaseReceipt[];
  payments?: SupplierPayment[];
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  amount: number; // in JOD
  paymentMethod: string;
  referenceNumber?: string;
  paymentDate: string;
  notes?: string;
  createdByName?: string;
  createdAt: string;
}

export interface PurchaseOrderFilters {
  search?: string;
  status?: PurchaseOrderStatus | 'all';
  supplierId?: string | 'all';
  branchId?: string | 'all';
  warehouseId?: string | 'all';
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'newest' | 'highest_value' | 'outstanding';
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  branchId?: string;
  warehouseId?: string;
  expectedDeliveryDate?: string;
  deliveryFee: number; // JOD
  discount: number; // JOD
  supplierInvoiceNumber?: string;
  notes?: string;
  internalNotes?: string;
  items: {
    productId: string;
    orderedQuantity: number;
    purchasePrice: number; // JOD
    discount?: number; // JOD
  }[];
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  warehouseId?: string;
  supplierDeliveryNote?: string;
  notes?: string;
  items: {
    purchaseOrderItemId: string;
    productId: string;
    receivedQuantity: number;
    unitCost: number; // JOD
  }[];
}

export interface SupplierPurchaseSummary {
  totalPurchaseOrders: number;
  totalPurchases: number; // JOD
  totalPaid: number; // JOD
  totalOutstanding: number; // JOD
  latestPurchaseOrderNumber?: string;
  latestPurchaseOrderDate?: string;
  openPurchaseOrdersCount: number;
}
