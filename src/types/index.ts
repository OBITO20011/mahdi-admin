/**
 * Nawasrah Business Manager - Core Types & Interfaces
 */

export type Role =
  | 'Owner'
  | 'Admin'
  | 'Accountant'
  | 'Cashier'
  | 'Sales Employee'
  | 'Warehouse Employee'
  | 'Orders Employee'
  | 'Delivery Driver'
  | 'View Only';

export type Permission =
  | 'view_sales'
  | 'view_profits'
  | 'view_cost'
  | 'add_product'
  | 'edit_product'
  | 'delete_product'
  | 'edit_inventory'
  | 'execute_stock_count'
  | 'create_invoice'
  | 'edit_invoice'
  | 'cancel_invoice'
  | 'grant_discount'
  | 'approve_high_discount'
  | 'manage_customers'
  | 'manage_suppliers'
  | 'manage_expenses'
  | 'manage_users'
  | 'export_reports'
  | 'close_financial_period';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  branchId: string;
  avatarUrl?: string;
  jobTitle?: string;
  language?: 'ar' | 'en';
  timezone?: string;
  address?: string;
  whatsapp?: string;
  themeMode?: 'dark' | 'light';
  permissions: Permission[];
  isActive: boolean;
  lastLogin?: string;
  notificationSettings?: {
    newOrders: boolean;
    stockAlerts: boolean;
    expiryAlerts: boolean;
    debtAlerts: boolean;
    emailAlerts?: boolean;
    pushAlerts?: boolean;
    smsAlerts?: boolean;
    soundAlerts?: boolean;
  };
  activeSessions?: {
    id: string;
    device: string;
    ip: string;
    lastActive: string;
    isCurrent: boolean;
  }[];
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  isMain: boolean;
}

export interface Warehouse {
  id: string;
  name: string;
  branchId: string;
  location: string;
}

export type ProductStatus = 'active' | 'hidden' | 'out_of_stock' | 'discontinued' | 'expired' | 'near_expiry';

export interface ProductUnit {
  type: 'piece' | 'packet' | 'carton';
  nameAr: string;
  piecesCount: number; // e.g. 1 for piece, 12 for packet, 144 for carton
  retailPrice: number;
  wholesalePrice: number;
}

export interface ProductBatch {
  batchNumber: string;
  expiryDate?: string;
  quantity: number;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  nameAr: string;
  nameEn?: string;
  description?: string;
  imageUrl: string;
  additionalImages?: string[];
  categoryId: string;
  brandId?: string;
  supplierId?: string;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  promoPrice?: number;
  taxRate: number; // percentage e.g. 16%
  unit: string; // e.g. 'قطعة'
  packetSize?: number; // pieces inside packet
  cartonSize?: number; // pieces inside carton
  onHandQuantity: number;
  reservedQuantity: number; // reserved for pending orders
  availableQuantity: number; // calculated: onHand - reserved
  reorderLevel: number; // minimum alert quantity
  expiryDate?: string;
  productionDate?: string;
  batchNumber?: string;
  alertDaysBeforeExpiry?: number;
  countryOfOrigin?: string;
  warehouseLocation?: string;
  branchId?: string;
  warehouseId?: string;
  weightKg?: number;
  ingredients?: string;
  allergens?: string;
  nutritionalInfo?: string;
  isFeatured?: boolean;
  isNewProduct?: boolean;
  isBestSeller?: boolean;
  allowWholesale?: boolean;
  isWebsiteVisible?: boolean;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
  lastModifiedBy?: string;
}

export interface Category {
  id: string;
  nameAr: string;
  nameEn?: string;
  imageUrl?: string;
  icon?: string;
  sortOrder?: number;
  isHidden?: boolean;
  productsCount?: number;
}

export interface Brand {
  id: string;
  nameAr: string;
  nameEn?: string;
  logoUrl?: string;
}

export interface UnitDefinition {
  id: string;
  nameAr: string;
  nameEn?: string;
  code: string;
  conversionFactor: number; // e.g. 1 for piece, 12 for packet, 144 for carton
  isSystem?: boolean;
}

export type MovementType =
  | 'Opening Balance'
  | 'Purchase Receipt'
  | 'Receive Goods'
  | 'Purchase'
  | 'Sale'
  | 'Reservation'
  | 'Release Reservation'
  | 'Sale Return'
  | 'Purchase Return'
  | 'Damage'
  | 'Expired'
  | 'Transfer Out'
  | 'Transfer In'
  | 'Manual Adjustment'
  | 'Stock Count'
  | 'Internal Use'
  | 'Free Sample';

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  branchId: string;
  warehouseId: string;
  movementType: MovementType;
  previousQuantity: number;
  quantityChange: number;
  newQuantity: number;
  reason: string;
  performedByUserId: string;
  performedByUserName: string;
  timestamp: string;
  referenceId?: string; // Order or Invoice ID
  notes?: string;
}

export type OrderStatus =
  | 'new'
  | 'pending_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'processing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'returned';

export type PaymentMethod = 'cash' | 'cliq' | 'card' | 'bank_transfer' | 'debt' | 'mixed';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface CustomerAddress {
  governorate?: string;
  area?: string;
  street?: string;
  building?: string;
  apartment?: string;
  landmark?: string;
  deliveryNotes?: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productImage: string;
  sku: string;
  unit: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  discount: number;
  totalPrice: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  governorate: string;
  region: string;
  address: string;
  customerAddress?: CustomerAddress;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  googleMapsUrl?: string;
  mapUrl?: string;
  locationSource?: 'gps' | 'map_pin' | 'manual';
  locationConfirmed?: boolean;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  branchId: string;
  isNew: boolean;
  notes?: string;
  internalNotes?: string;
  assignedStaffId?: string;
  assignedDeliveryDriverId?: string;
  deliveryDriverId?: string;
  deliveryDriverName?: string;
  createdAt: string;
  updatedAt: string;
  statusHistory: {
    status: OrderStatus;
    changedAt: string;
    changedBy: string;
    reason?: string;
  }[];
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  orderId?: string;
  customerName: string;
  customerPhone?: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: PaymentMethod;
  status: 'draft' | 'posted' | 'cancelled' | 'refunded';
  isReturned?: boolean;
  returnReason?: string;
  branchId: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  whatsapp?: string;
  address: string;
  governorate: string;
  customerType: 'retail' | 'wholesale';
  creditLimit: number;
  paymentTermDays: number;
  currentBalance: number; // positive = customer owes us
  totalOrdersCount: number;
  notes?: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  whatsapp?: string;
  address: string;
  currentBalance: number; // positive = we owe supplier
  taxNumber?: string;
  notes?: string;
}

export interface CustomerPayment {
  id: string;
  voucherNumber: string; // رقم سند القبض
  customerId: string;
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string; // CliQ reference or cheque no
  notes?: string;
  date: string;
  createdByName: string;
}

export interface SupplierPayment {
  id: string;
  voucherNumber: string; // رقم سند الصرف
  supplierId: string;
  supplierName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  notes?: string;
  date: string;
  createdByName: string;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  category: string; // 'إيجار' | 'كهرباء' | 'رواتب' | 'تسويق' | 'صيانة' | etc.
  amount: number;
  paymentMethod: PaymentMethod;
  description: string;
  receiptImageUrl?: string;
  isApproved: boolean;
  approvedBy?: string;
  branchId: string;
  createdByName: string;
  createdAt: string;
  isRecurring?: boolean;
}

export interface Shift {
  id: string;
  shiftNumber: string;
  branchId: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  openingCash: number;
  totalCashSales: number;
  totalCliqSales: number;
  totalCardSales: number;
  totalReceipts: number; // مقبوضات
  totalPayments: number; // مدفوعات ومصروفات
  expectedCash: number;
  actualCash?: number;
  cashDiscrepancy?: number;
  discrepancyReason?: string;
  status: 'open' | 'closed';
  managerSignOffBy?: string;
}

export interface Account {
  id: string;
  code: string;
  nameAr: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance: number;
  isSystem: boolean;
}

export interface JournalEntryLine {
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  debit: number;
  credit: number;
  notes?: string;
}

export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  lines: JournalEntryLine[];
  totalDebit: number;
  totalCredit: number;
  isPosted: boolean;
  createdByName: string;
  referenceType?: 'invoice' | 'payment' | 'expense' | 'purchase';
  referenceId?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'order' | 'stock' | 'expiry' | 'debt' | 'approval' | 'shift';
  read: boolean;
  createdAt: string;
  targetScreen?: string;
  targetId?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  ipAddress?: string;
}

export interface SyncQueueItem {
  id: string;
  clientOperationId: string;
  type: string;
  payload: any;
  status: 'pending' | 'synced' | 'failed';
  timestamp: string;
  errorMessage?: string;
}

export * from './purchases';
