import type { NotificationItem } from '../types';
import {
  fetchStockAlertsFromSupabase,
  markAllStockAlertsReadInSupabase,
  markStockAlertReadInSupabase,
} from '../services/supabase/stockAlerts.service';

interface StockNotificationsStoreDependencies {
  isConfigured: () => boolean;
  getNotifications: () => NotificationItem[];
  replaceNotifications: (notifications: NotificationItem[]) => void;
  notify: () => void;
  setToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export class StockNotificationsStoreSlice {
  private refreshPromise: Promise<NotificationItem[]> | null = null;

  constructor(
    private readonly dependencies: StockNotificationsStoreDependencies,
  ) {}

  refresh(): Promise<NotificationItem[]> {
    if (this.refreshPromise) return this.refreshPromise;

    const refreshPromise = this.performRefresh().finally(() => {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = null;
      }
    });
    this.refreshPromise = refreshPromise;
    return refreshPromise;
  }

  private async performRefresh(): Promise<NotificationItem[]> {
    if (!this.dependencies.isConfigured()) {
      this.dependencies.replaceNotifications([]);
      this.dependencies.notify();
      return [];
    }

    try {
      const result = await fetchStockAlertsFromSupabase();
      this.dependencies.replaceNotifications(result.notifications);
      this.dependencies.notify();
      return result.notifications;
    } catch (error) {
      console.error('[Store refreshStockNotifications Exception]:', error);
      return this.dependencies.getNotifications();
    }
  }

  async markRead(notificationId: string) {
    const result = await markStockAlertReadInSupabase(notificationId);
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'تعذر تحديث حالة التنبيه.',
        'error',
      );
      return false;
    }

    this.dependencies.replaceNotifications(
      this.dependencies
        .getNotifications()
        .map((notification) =>
          notification.id === notificationId
            ? { ...notification, read: true }
            : notification,
        ),
    );
    this.dependencies.notify();
    return true;
  }

  async markAllRead() {
    const result = await markAllStockAlertsReadInSupabase();
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'تعذر تحديث التنبيهات.',
        'error',
      );
      return false;
    }

    this.dependencies.replaceNotifications(
      this.dependencies
        .getNotifications()
        .map((notification) => ({ ...notification, read: true })),
    );
    this.dependencies.notify();
    return true;
  }
}
