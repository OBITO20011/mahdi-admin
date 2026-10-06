import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {ReportsCenterView} from '../src/features/reports/ReportsCenterView';
import {RecordCustomerPaymentModal} from '../src/features/accounts/RecordCustomerPaymentModal';
import {ProductsView} from '../src/features/products/ProductsView';
import {ShiftClosingReportModal} from '../src/features/shifts/ShiftClosingReportModal';
import {fetchCashShiftClosingReportFromSupabase} from '../src/services/supabase/expenses-shifts.service';
import type {ShiftClosingReport} from '../src/types';
import {storeEngine} from '../src/stores/useAppStore';
import {authStoreEngine, type AuthState} from '../src/stores/useAuthStore';

const auth = authStoreEngine as unknown as {state: AuthState; getState: () => AuthState; initAuth: () => Promise<void>};
auth.state = {...auth.getState(), roleName: 'owner', roles: ['owner'], isAuthenticated: true, isLoading: false};
auth.initAuth = async () => undefined;
const app = storeEngine as unknown as {state: ReturnType<typeof storeEngine.getState>};
app.state = {...storeEngine.getState(), activeBranch: {id: 'phase6-branch', name: 'فرع الاختبار', address: '', city: '', phone: ''}};
const kind = new URLSearchParams(location.search).get('kind');
function Closing() {
  const [report, setReport] = useState<ShiftClosingReport | null>(null);
  useEffect(() => {void fetchCashShiftClosingReportFromSupabase('phase6-shift').then(setReport);}, []);
  return <ShiftClosingReportModal isOpen report={report} isLoading={!report} onClose={() => undefined} onRetry={() => undefined} />;
}
createRoot(document.getElementById('root')!).render(
  <div dir="rtl" className="p-4 text-white">
    {kind === 'payments' ? <RecordCustomerPaymentModal onClose={() => undefined} />
      : kind === 'products' ? <ProductsView /> : kind === 'closing' ? <Closing /> : <ReportsCenterView />}
  </div>,
);
