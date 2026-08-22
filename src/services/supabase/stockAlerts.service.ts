import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { NotificationItem } from '../../types';

export interface StockAlertNotification extends NotificationItem {
  productId: string;
  warehouseId: string;
  severity: 'low_stock' | 'out_of_stock';
  status: 'active' | 'resolved';
  availableQuantity: number;
  thresholdQuantity: number;
  unitsPerPackage: number;
  purchaseUnitName: string;
  baseUnitName: string;
}

const mapStockAlert = (item: any): StockAlertNotification => {
  const availableQuantity = Number(item.availableQuantity) || 0;
  const thresholdQuantity = Number(item.thresholdQuantity) || 0;
  const unitsPerPackage = Math.max(
    1,
    Math.floor(Number(item.unitsPerPackage) || 1)
  );
  const packageCount = Math.floor(
    Math.max(availableQuantity, 0) / unitsPerPackage
  );
  const looseUnits = Math.max(availableQuantity, 0) % unitsPerPackage;
  const packageSummary =
    unitsPerPackage > 1
      ? `${packageCount} ${item.purchaseUnitName || 'عبوة'} و${looseUnits} ${
          item.baseUnitName || 'حبة'
        }`
      : `${Math.max(availableQuantity, 0)} ${item.baseUnitName || 'حبة'}`;
  const isOutOfStock =
    item.severity === 'out_of_stock' || availableQuantity <= 0;

  return {
    id: item.id,
    title: isOutOfStock
      ? `نفد مخزون ${item.productName || 'منتج'}`
      : `مخزون ${item.productName || 'منتج'} اقترب من النفاد`,
    message: isOutOfStock
      ? `لا توجد كمية متاحة في ${item.warehouseName || 'المستودع'}.`
      : `المتوفر ${packageSummary}، وحد التنبيه ${thresholdQuantity} ${
          item.baseUnitName || 'حبة'
        }.`,
    type: 'stock',
    read: Boolean(item.isRead),
    createdAt:
      item.lastUpdatedAt || item.firstTriggeredAt || new Date().toISOString(),
    targetScreen: 'inventory',
    targetId: item.productId,
    productId: item.productId,
    warehouseId: item.warehouseId,
    severity: isOutOfStock ? 'out_of_stock' : 'low_stock',
    status: item.status || 'active',
    availableQuantity,
    thresholdQuantity,
    unitsPerPackage,
    purchaseUnitName: item.purchaseUnitName || 'عبوة',
    baseUnitName: item.baseUnitName || 'حبة',
  };
};

export async function fetchStockAlertsFromSupabase(): Promise<{
  notifications: StockAlertNotification[];
  unreadCount: number;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { notifications: [], unreadCount: 0 };
  }

  const { data, error } = await supabase.rpc(
    'get_stock_alert_notifications',
    {
      p_include_resolved: false,
      p_limit: 100,
    }
  );

  if (error) throw error;

  return {
    notifications: (data?.items || []).map(mapStockAlert),
    unreadCount: Number(data?.unreadCount) || 0,
  };
}

export async function markStockAlertReadInSupabase(
  stockAlertId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير متاح.' };
  }

  const { error } = await supabase.rpc('mark_stock_alert_read', {
    p_stock_alert_id: stockAlertId,
  });

  return error
    ? { success: false, error: error.message }
    : { success: true };
}

export async function markAllStockAlertsReadInSupabase(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'Supabase غير متاح.' };
  }

  const { error } = await supabase.rpc('mark_all_stock_alerts_read');

  return error
    ? { success: false, error: error.message }
    : { success: true };
}

export function subscribeToStockAlertChanges(
  onChange: () => void
): () => void {
  if (!isSupabaseConfigured || !supabase) return () => {};

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(onChange, 250);
  };

  const channel = supabase
    .channel('stock-alert-notifications')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_movements' },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'products' },
      scheduleRefresh
    )
    .subscribe();

  return () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    supabase.removeChannel(channel);
  };
}

