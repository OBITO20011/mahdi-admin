import type { HomeDashboardData } from '../src/types/dashboard';
import type { Shift } from '../src/types';

/** Deterministic presentation fixture, not an alternative business reader. */
export const homeFixture: HomeDashboardData = {
  generatedAt: '2026-10-09T12:00:00+03:00', financialFactsAvailable: true, access: { canViewProfit: true },
  summary: { todaySalesInMinorUnits: 1284500, todayCompletedOrders: 42, monthSalesInMinorUnits: 34006250, monthNetSalesInMinorUnits: 31906250, monthProfitInMinorUnits: 4100000, openOrdersCount: 12, newOrdersCount: 6, customerReceivablesInMinorUnits: 8420750, supplierPayablesInMinorUnits: 5100000, supplierAdvancesInMinorUnits: 200000, inventoryValueInMinorUnits: 31000000, activeProductsCount: 180, activeCustomersCount: 27, lowStockCount: 2, outOfStockCount: 1, configurationIssuesCount: 1 },
  latestOrders: [
    { id: 'o1', orderNumber: 'W-10482', customerName: 'سوبرماركت الأمل', status: 'new', paymentStatus: 'unpaid', totalInMinorUnits: 186000, source: 'website', createdAt: '2026-10-09T09:00:00+03:00' },
    { id: 'o2', orderNumber: 'W-10479', customerName: 'بقالة أبو خالد', status: 'preparing', paymentStatus: 'paid', totalInMinorUnits: 92400, source: 'website', createdAt: '2026-10-09T08:00:00+03:00' },
    { id: 'o3', orderNumber: 'P-20931', customerName: 'محمد العمري', status: 'ready', paymentStatus: 'unpaid', totalInMinorUnits: 58000, source: 'pos', createdAt: '2026-10-09T08:15:00+03:00' },
    { id: 'o4', orderNumber: 'W-10471', customerName: 'دكانة الحي', status: 'out_for_delivery', paymentStatus: 'paid', totalInMinorUnits: 131200, source: 'website', createdAt: '2026-10-09T07:00:00+03:00' },
  ],
  stockAlerts: [
    { id: 'p1', nameAr: 'عصير برتقال 250مل', sku: 'SKU-1', availableBaseUnits: 12, unitsPerSaleUnit: 12, saleUnitName: 'كرتونة', availableSalePackages: 1, severity: 'low_stock' },
    { id: 'p2', nameAr: 'شيبس جبنة 30غ', sku: 'SKU-2', availableBaseUnits: 0, unitsPerSaleUnit: 24, saleUnitName: 'كرتونة', availableSalePackages: 0, severity: 'out_of_stock' },
    { id: 'p3', nameAr: 'مياه 600مل', sku: 'SKU-3', availableBaseUnits: 36, unitsPerSaleUnit: 12, saleUnitName: 'كرتونة', availableSalePackages: 3, severity: 'low_stock' },
    { id: 'p4', nameAr: 'بسكويت شوكولاتة', sku: 'SKU-4', availableBaseUnits: 2, unitsPerSaleUnit: 1, saleUnitName: 'باكيت', availableSalePackages: 2, severity: 'configuration' },
  ],
  orderStatuses: [{ status: 'new', count: 6 }, { status: 'confirmed', count: 2 }, { status: 'preparing', count: 1 }, { status: 'ready', count: 1 }, { status: 'out_for_delivery', count: 2 }],
  sevenDaySales: [820000, 1040000, 760000, 1180000, 990000, 1310000, 1284500].map((gross, index) => ({ date: `2026-10-${String(index + 3).padStart(2, '0')}`, dayLabel: '', salesInMinorUnits: gross, netSalesInMinorUnits: index === 6 ? 1162000 : gross - 10000 })),
};

export const shiftFixture: Shift = {
  id: 'shift-home', shiftNumber: '31', branchId: 'branch-home', cashierName: 'مهدي', startTime: '2026-10-09T08:12:00+03:00',
  openingCash: 50, totalCashSales: 734, totalCliqSales: 328, totalCardSales: 0, totalReceipts: 62.3, totalPayments: 24,
  cashReceipts: 62.3, cliqReceipts: 0, cashSupplierPayments: 0, cliqSupplierPayments: 0, cashExpenses: 24, cliqExpenses: 0,
  cashRefunds: 12, cliqRefunds: 0, expectedCash: 810.3, status: 'open',
};
