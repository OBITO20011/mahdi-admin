import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {Modal} from '../src/components/common/Modal';
import {KpiCards} from '../src/features/dashboard/KpiCards';
import {PosView} from '../src/features/pos/PosView';
import {storeEngine, type AppState} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import type {DashboardKpis} from '../src/types/dashboard';
import {RecordCustomerPaymentModal} from '../src/features/accounts/RecordCustomerPaymentModal';
import {RecordSupplierPaymentModal} from '../src/features/directReceiving/RecordSupplierPaymentModal';
import type {SupplierReceipt} from '../src/types/directReceiving';
import type {CustomerOutstandingOrder} from '../src/services/supabase/customerAccounts.service';
import {CartDrawer} from '../customer-web/src/components/CartDrawer';
import type {CartItem} from '../customer-web/src/types/catalog';
const noop = () => undefined;
if (new URLSearchParams(location.search).get('kind') === 'pos') {
  // Explicit isolated location facts: never use an aggregate inventory fallback.
  const store = storeEngine as unknown as {state: AppState; getState: () => AppState};
  const branch = {id: '33333333-3333-4333-8333-333333333333', name: 'فرع الاختبار',
    address: 'اختبار', city: 'اختبار', phone: ''};
  store.state = {...store.getState(), activeBranch: branch, branches: [branch], warehouses: [{
    id: '22222222-2222-4222-8222-222222222222', name: 'مستودع الاختبار', branchId: branch.id,
    location: 'اختبار'}]};
  const actorId = '11111111-1111-4111-8111-111111111111';
  storeEngine.setCurrentUser({id: actorId, name: 'كاشير الاختبار', role: 'Owner', avatarUrl: ''});
  if (supabase) supabase.auth.getUser = async () =>
    (({data: {user: {id: actorId}}, error: null}) as Awaited<ReturnType<typeof supabase.auth.getUser>>);
}
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
  const [supplier, setSupplier] = useState(false);
  if (new URLSearchParams(location.search).get('kind') === 'pos') return <PosView/>;
  const item = {schemaVersion: 2, localLineId: 'base', productId: 'base', nameAr: 'اختبار',
    commercialLineKind: 'base_unit', quantity: 1, unitsPerSalePackage: 1,
    unitPriceInMinorUnits: 1000, maxAvailablePackages: 10, imageUrl: ''} as CartItem;
  return <main>
    <button onClick={() => setOpen(true)}>فتح النافذة</button>
    <button onClick={() => setCart(true)}>فتح السلة</button>
    <button onClick={() => setSupplier(true)}>فتح دفعة المورد</button>
    <p role="status">{action}</p>
    <KpiCards kpis={kpis} onFilterLowStock={() => setAction('منخفض')}
      onFilterOutOfStock={() => setAction('نفد')}/>
    <Modal isOpen={open} onClose={() => setOpen(false)} title="نافذة الاختبار">
      <button onClick={() => setNested(true)}>فتح نافذة داخلية</button>
      <button onClick={() => setBusy(value => !value)}>تغيير الانشغال</button>
      <div aria-busy={busy}><input aria-label="حقل الاختبار"/></div>
      <details><summary>تفاصيل قابلة للفتح</summary><button>بعد الملخص</button></details>
      <div contentEditable suppressContentEditableWarning aria-label="عنصر أصلي خارج القائمة">حقل أصلي</div>
      <button>بعد العنصر الأصلي</button>
      <RecordCustomerPaymentModal initialOrder={order} onClose={noop}/>
      <button>آخر زر</button>
    </Modal>
    <Modal isOpen={supplier} onClose={() => setSupplier(false)} title="دفعة المورد">
      <RecordSupplierPaymentModal receipt={{id: '66660000-0000-4000-8000-000000000091',
        receiptNumber: 'SUP-TEST', supplierName: 'مورد اختبار', amountDueInMinorUnits: 2000} as SupplierReceipt}
        onClose={() => setSupplier(false)} onSuccess={noop}/>
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
