import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {AdminAftercarePanel} from '../src/features/orders/AdminAftercarePanel';
import {DamageHistoryPanel} from '../src/features/more/DamageHistoryPanel';
import {IPhoneContainer} from '../src/components/layout/IPhoneContainer';
import {Header} from '../src/components/common/Header';
import {authStoreEngine, type AuthState} from '../src/stores/useAuthStore';
import {storeEngine} from '../src/stores/useAppStore';
import {supabase} from '../src/lib/supabase';
import type {Order} from '../src/types';
import {CartDrawer} from '../customer-web/src/components/CartDrawer';
import type {CartItem} from '../customer-web/src/types/catalog';

const actorId = '66660000-0000-4000-8000-000000000001';
// Synthetic authentication only. Requests still traverse the actual public service/recovery adapter.
if (supabase) supabase.auth.getUser = async () => ({data: {user: {id: actorId}}, error: null}) as Awaited<ReturnType<NonNullable<typeof supabase>['auth']['getUser']>>;
const auth = authStoreEngine as unknown as {state: AuthState; getState: () => AuthState; initAuth: () => Promise<void>};
const role = new URLSearchParams(location.search).get('role') === 'admin' ? 'admin' : 'owner';
auth.state = {...auth.getState(), roleName: role, roles: [role], isAuthenticated: true, isLoading: false};
auth.initAuth = async () => undefined;
storeEngine.setCurrentUser({id: actorId, name: 'المالك', role: 'Owner', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='});
const order = {id: '66660000-0000-4000-8000-000000000002', items: [
  {id: 'base-root', productId: 'juice', productName: 'عصير فراولة', parcelInstances: []},
  {id: 'parcel-root', productId: 'mix', productName: 'طرد العصائر', parcelInstances: [
    {id: 'parcel', components: [{id: 'component', productId: 'juice', name: 'عصير برتقال'}]},
  ]},
]} as Order;
const resolved = () => undefined;
function Harness() {
  const [message, setMessage] = useState('');
  const [damageOpen, setDamageOpen] = useState(false);
  if (new URLSearchParams(location.search).get('kind') === 'cart') {
    const common = {schemaVersion: 2, localRevision: 0, sku: 'test', imageUrl: '', saleUnitNameAr: 'وحدة',
      unitPriceInMinorUnits: 1000, maxAvailablePackages: 10};
    const items = [
      {...common, localLineId: 'base', productId: 'base', nameAr: 'وحدة العصير', commercialLineKind: 'base_unit', quantity: 3, unitsPerSalePackage: 1},
      {...common, localLineId: 'parcel', productId: 'parcel', nameAr: 'طرد العصير', saleUnitNameAr: 'طرد', commercialLineKind: 'legacy_single_sku_parcel', quantity: 2, unitsPerSalePackage: 6},
    ] as CartItem[];
    return <CartDrawer isOpen items={items} onClose={resolved} onQuantityChange={resolved}
      onRemove={resolved} onEditParcel={resolved} onDuplicateParcel={resolved}
      onRemoveParcel={resolved} lockedParcelInstanceIds={new Set()} lockedLineIds={new Set()}
      onClear={resolved} onCheckout={resolved}/>;
  }
  return <IPhoneContainer><Header/><div className="overflow-auto p-3">
    <p data-testid="notice">{message}</p>
    <p data-testid="selectable-identity" dir="ltr">P6-B-123</p>
    <AdminAftercarePanel order={order} onContractResolved={resolved} notify={setMessage}/>
    {/* The shop-wide damage list left the invoice (owner 2026-11-20); it lives in More → التالف.
        This owner-only stand-in keeps the same panel reachable next to the invoice in the harness. */}
    {role === 'owner' && <details data-testid="more-damage-screen" open={damageOpen} onToggle={event => setDamageOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">التالف</summary>
      {damageOpen && <DamageHistoryPanel/>}
    </details>}
  </div></IPhoneContainer>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
