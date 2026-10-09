import type { Order, OrderItem, OrderStatus } from '../src/types';
import type { OperationalOrderListItem } from '../src/services/supabase/orders.service';

const item = (id: string, name: string, kind: string, unit: string, quantity: number, price: number): OrderItem => ({
  id, productId: `product-${id}`, productName: name, productImage: '', sku: id.toUpperCase(), unit,
  unitPrice: price, costPrice: 1, quantity, discount: 0, totalPrice: quantity * price, commercialLineKind: kind,
});
const items: OrderItem[] = [
  item('orange', 'عصير برتقال 250 مل', 'legacy_single_sku_parcel', 'كرتونة', 2, 21.6),
  item('water', 'مياه 600 مل', 'base_unit', 'باكيت', 4, 5),
  { ...item('mixed', 'طرد شيبس مشكّل', 'configurable_parcel', 'طرد', 3, 9), parcelInstances: [1, 2, 3].map((sequence) => ({
    id: `parcel-${sequence}`, sequence, unitName: 'طرد مشكّل', components: [
      { id: `cheese-${sequence}`, productId: 'cheese', name: 'جبنة', sku: 'CHEESE', unitName: 'باكيت', quantity: 10 },
      { id: `chili-${sequence}`, productId: 'chili', name: 'شطة', sku: 'CHILI', unitName: 'باكيت', quantity: 10 },
      { id: `salt-${sequence}`, productId: 'salt', name: 'ملح', sku: 'SALT', unitName: 'باكيت', quantity: 10 },
    ],
  })) },
];
export const ordersFixture: Order[] = (['new', 'preparing', 'completed', 'ready', 'out_for_delivery', 'cancelled'] as OrderStatus[]).map((status, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, orderNumber: `W-${10482 - index}`,
  customerId: `customer-${index}`, customerName: ['سوبرماركت الأمل', 'بقالة أبو خالد', 'محمد العمري', 'ميني ماركت السلام', 'دكانة الحي', 'بقالة الريان'][index],
  customerPhone: '0791234567', governorate: 'الرمثا', region: 'الحي الشرقي', address: 'شارع السوق، بناية 12',
  customerAddress: { governorate: 'الرمثا', area: 'الحي الشرقي', street: 'شارع السوق', building: '12' },
  items: structuredClone(items), subtotal: 90.2, discount: 0, deliveryFee: 2, totalAmount: 92.2,
  amountPaid: status === 'completed' ? 92.2 : 0, amountDue: status === 'completed' ? 0 : 92.2,
  paymentMethod: index === 3 ? 'cliq' : 'cash_on_delivery', paymentStatus: status === 'completed' ? 'paid' : 'unpaid',
  source: 'website', status, branchId: 'orders-branch', isNew: status === 'new',
  createdAt: `2026-10-09T07:${42 - index * 4}:00.000Z`, updatedAt: '2026-10-09T08:00:00.000Z',
  statusHistory: [{ status, changedAt: '2026-10-09T07:00:00.000Z', changedBy: 'owner' }],
  ...(status === 'out_for_delivery' ? { trackingToken: 'isolated-tracking-token', estimatedArrivalAt: '2026-10-09T08:30:00.000Z', deliveryDriverPhone: '0797654321' } : {}),
}));
export const orderListFixture: OperationalOrderListItem[] = ordersFixture.map((order) => ({
  id: order.id, orderNumber: order.orderNumber, customerName: order.customerName, customerPhone: order.customerPhone,
  governorate: order.governorate, region: order.region, status: order.status, paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus, totalAmount: order.totalAmount, amountPaid: order.amountPaid!, amountDue: order.amountDue!,
  itemCount: order.items.length, firstProductName: order.items[0].productName, branchId: order.branchId, createdAt: order.createdAt, updatedAt: order.updatedAt,
}));
