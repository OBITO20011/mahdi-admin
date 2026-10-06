import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {Modal} from '../src/components/common/Modal';
import {KpiCards} from '../src/features/dashboard/KpiCards';
import {PosView} from '../src/features/pos/PosView';
import type {DashboardKpis} from '../src/types/dashboard';
import {RecordCustomerPaymentModal} from '../src/features/accounts/RecordCustomerPaymentModal';
import type {CustomerOutstandingOrder} from '../src/services/supabase/customerAccounts.service';
import {CartDrawer} from '../customer-web/src/components/CartDrawer';
import type {CartItem} from '../customer-web/src/types/catalog';
const noop = () => undefined;
const kpis = {todaySales: 0, todaySalesChangePercent: 0, weekSales: 0, monthSales: 0,
  totalRevenue: 0, netProfit: 0, profitMarginPercent: 0, todayOrdersCount: 0,
  activeCustomersCount: 0, totalProductsCount: 1, lowStockCount: 1, outOfStockCount: 1} as DashboardKpis;
const order: CustomerOutstandingOrder = {id: 'test', orderNumber: 'test', customerName: 'عميل اختبار',
  customerId: 'customer', customerPhone: '0790000000', totalAmount: 3, amountPaid: 0,
  amountDue: 3, paymentStatus: 'unpaid', createdAt: '2026-10-06T00:00:00Z'};
function Harness() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState(false);
  const [action, setAction] = useState('');
  if (new URLSearchParams(location.search).get('kind') === 'pos') return <PosView/>;
  const item = {schemaVersion: 2, localLineId: 'base', productId: 'base', nameAr: 'اختبار',
    commercialLineKind: 'base_unit', quantity: 1, unitsPerSalePackage: 1,
    unitPriceInMinorUnits: 1000, maxAvailablePackages: 10, imageUrl: ''} as CartItem;
  return <main>
    <button onClick={() => setOpen(true)}>فتح النافذة</button>
    <button onClick={() => setCart(true)}>فتح السلة</button>
    <p role="status">{action}</p>
    <KpiCards kpis={kpis} onFilterLowStock={() => setAction('منخفض')}
      onFilterOutOfStock={() => setAction('نفد')}/>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="نافذة الاختبار">
      <button onClick={() => setNested(true)}>فتح نافذة داخلية</button>
      <button onClick={() => setBusy(value => !value)}>تغيير الانشغال</button>
      <div aria-busy={busy}><input aria-label="حقل الاختبار"/></div>
      <RecordCustomerPaymentModal initialOrder={order} onClose={noop}/>
      <button>آخر زر</button>
    </Modal>
    <Modal isOpen={nested} onClose={() => setNested(false)} title="نافذة داخلية">
      <input aria-label="حقل داخلي"/>
    </Modal>
    <CartDrawer isOpen={cart} items={[item]} onClose={() => setCart(false)}
      onQuantityChange={noop} onRemove={noop} onEditParcel={noop} onDuplicateParcel={noop}
      onRemoveParcel={noop} lockedParcelInstanceIds={new Set()} lockedLineIds={new Set()}
      onClear={noop} onCheckout={noop}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
