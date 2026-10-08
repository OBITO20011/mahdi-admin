import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Card, UiButton } from '../../components/ui';
import { fetchHomeDashboardFromSupabase, subscribeToDashboardRealtime } from '../../services/supabase/dashboard.service';
import { useAppStoreActions, useAppStoreSelector } from '../../stores/useAppStore';
import type { HomeDashboardData } from '../../types/dashboard';
import { DashboardHome } from './DashboardHome';

export const DashboardView: React.FC = () => {
  const currentUserName = useAppStoreSelector((state) => state.currentUser.name);
  const currentShift = useAppStoreSelector((state) => state.currentShift);
  const { openModal, setActiveTab } = useAppStoreActions();
  const [data, setData] = useState<HomeDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRef = useRef(false);
  const mountedRef = useRef(true);

  const loadDashboard = useCallback(async (silent = false) => {
    if (refreshPromiseRef.current) {
      queuedRefreshRef.current = true;
      return refreshPromiseRef.current;
    }
    const refresh = async () => {
      if (!silent && mountedRef.current) setLoading(true);
      if (mountedRef.current) setError(null);
      do {
        queuedRefreshRef.current = false;
        const result = await fetchHomeDashboardFromSupabase();
        if (!mountedRef.current) return;
        if (result.success) {
          setData(result.data);
          setError(null);
        } else if ('error' in result) {
          setError(result.error);
        }
      } while (queuedRefreshRef.current && mountedRef.current);
      if (!silent && mountedRef.current) setLoading(false);
    };
    const promise = refresh().finally(() => { refreshPromiseRef.current = null; });
    refreshPromiseRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDashboard();
    const unsubscribe = subscribeToDashboardRealtime(() => void loadDashboard(true), setRealtimeConnected);
    return () => {
      mountedRef.current = false;
      queuedRefreshRef.current = false;
      unsubscribe();
    };
  }, [loadDashboard]);

  if (loading && !data) return <div dir="rtl" role="status" aria-label="جاري تحميل الرئيسية" className="space-y-4 p-4 lg:p-8"><div className="h-32 animate-pulse rounded-2xl bg-nw-surface" /><div className="h-64 animate-pulse rounded-2xl bg-nw-surface" /></div>;
  if (error && !data) return <div dir="rtl" className="p-4 lg:p-8"><Card role="alert" className="text-center"><AlertCircle className="mx-auto h-7 w-7 text-nw-bad" aria-hidden="true" /><h1 className="mt-3 font-bold">تعذر تحميل مركز اليوم</h1><p className="mt-2 text-sm text-nw-muted">{error}</p><UiButton className="mt-5" onClick={() => void loadDashboard()}><RefreshCw className="h-4 w-4" aria-hidden="true" />إعادة المحاولة</UiButton></Card></div>;
  if (!data) return null;
  return <DashboardHome data={data} currentUserName={currentUserName} currentShift={currentShift} loading={loading} error={error} realtimeConnected={realtimeConnected}
    onRefresh={() => void loadDashboard()} onOrders={() => setActiveTab('orders')} onAccounts={() => setActiveTab('accounts')}
    onInventory={() => setActiveTab('inventory')} onProducts={() => setActiveTab('products')} onShift={() => setActiveTab('shifts')}
    onSell={() => setActiveTab('pos')} onReceive={(productId) => openModal('receive_goods', productId ? { productId } : undefined)} onExpense={() => openModal('add_expense')} />;
};
