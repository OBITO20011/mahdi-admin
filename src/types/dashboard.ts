/**
 * Nawasrah Business Manager - Executive Dashboard Types
 */

export interface DashboardKpis {
  todaySales: number;
  yesterdaySales: number;
  todaySalesChangePercent: number;
  weekSales: number;
  monthSales: number;
  totalRevenue: number;
  netProfit: number;
  profitMarginPercent: number;
  todayOrdersCount: number;
  activeCustomersCount: number;
  totalProductsCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface DailySalesPoint {
  date: string;
  formattedDate: string;
  sales: number;
  ordersCount: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  monthName: string;
  revenue: number;
}

export interface OrderStatusBreakdown {
  status: string;
  statusAr: string;
  count: number;
  totalAmount: number;
  color: string;
}

export interface TopProductItem {
  id: string;
  nameAr: string;
  sku: string;
  imageUrl?: string;
  totalQuantity: number;
  totalRevenue: number;
}

export interface SalesByEntityItem {
  id: string;
  nameAr: string;
  sales: number;
  ordersCount: number;
  percentage: number;
}

export interface DashboardLatestOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

export interface DashboardLatestCustomer {
  id: string;
  fullName: string;
  phone: string;
  governorate: string;
  createdAt: string;
}

export interface DashboardLowStockAlert {
  id: string;
  nameAr: string;
  sku: string;
  imageUrl?: string;
  availableQuantity: number;
  onHandQuantity: number;
  reservedQuantity: number;
  reorderLevel: number;
  isOutOfStock: boolean;
  unit: string;
}

export interface DashboardInventoryMovement {
  id: string;
  productName: string;
  transactionType: string;
  quantity: number;
  createdAt: string;
  createdBy?: string;
}

export interface DashboardNotificationItem {
  id: string;
  action: string;
  details: string;
  createdAt: string;
  userName?: string;
}

export interface DashboardAnalyticsData {
  kpis: DashboardKpis;
  dailySales30d: DailySalesPoint[];
  monthlyRevenue: MonthlyRevenuePoint[];
  ordersByStatus: OrderStatusBreakdown[];
  topSellingProducts: TopProductItem[];
  salesByWarehouse: SalesByEntityItem[];
  salesByBranch: SalesByEntityItem[];
  latestOrders: DashboardLatestOrder[];
  latestCustomers: DashboardLatestCustomer[];
  lowStockAlerts: DashboardLowStockAlert[];
  recentInventoryMovements: DashboardInventoryMovement[];
  todayNotifications: DashboardNotificationItem[];
}
