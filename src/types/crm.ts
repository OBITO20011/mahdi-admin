/**
 * Nawasrah Business Manager - Enterprise CRM Types
 */

export type CustomerStatus = 'active' | 'inactive' | 'blocked' | 'vip';

export type CustomerTag = 'VIP' | 'Wholesale' | 'Retail' | 'New Customer' | 'High Value' | 'Corporate';

export type CustomerSortOption = 'latest' | 'highest_spending' | 'most_orders';

export interface CrmCustomerAddress {
  id: string;
  customerId: string;
  governorate: string;
  city: string;
  area: string;
  street: string;
  building?: string;
  floor?: string;
  apartment?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  googleMapsUrl?: string;
  locationSource?: 'gps' | 'map_pin' | 'manual';
  locationConfirmed?: boolean;
  isDefault?: boolean;
  createdAt?: string;
}

export interface CrmCustomerOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number; // in JOD
  amountPaid: number;
  amountDue: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
  source: string;
  itemsCount: number;
  createdAt: string;
}

export interface CrmCustomerStats {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalSpending: number; // JOD
  outstandingBalance: number; // JOD
  averageOrderValue: number; // JOD
  lastOrderDate: string | null;
}

export interface CrmCustomer {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  governorate: string;
  status: CustomerStatus;
  isActive: boolean;
  isVip: boolean;
  isBlocked: boolean;
  isDeleted: boolean;
  tags: CustomerTag[];
  notes: string;
  whatsapp?: string;
  creditLimit: number;
  currentBalance: number;
  customerType: 'retail' | 'wholesale';
  createdAt: string;
  updatedAt?: string;
  
  // Aggregated fields
  totalOrdersCount: number;
  totalSpending: number;
  addresses?: CrmCustomerAddress[];
  stats?: CrmCustomerStats;
  orderHistory?: CrmCustomerOrderSummary[];
  orderHistoryPage?: number;
  orderHistoryPageSize?: number;
  orderHistoryTotalCount?: number;
  orderHistoryHasMore?: boolean;
}

export interface CrmCustomerFilterParams {
  searchQuery?: string;
  statusFilter?: 'all' | 'vip' | 'active' | 'inactive' | 'blocked';
  sortBy?: CustomerSortOption;
  page?: number;
  pageSize?: number;
}

export interface CrmCustomerResponse {
  success: boolean;
  customers: CrmCustomer[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  error?: string;
}
