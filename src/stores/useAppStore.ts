/**
 * Nawasrah Business Manager - Global Application Store & State Engine
 */

import { useState, useEffect } from 'react';
import {
  AuditLog,
  Branch,
  Brand,
  Category,
  Customer,
  CustomerPayment,
  Expense,
  InventoryMovement,
  MovementType,
  Invoice,
  NotificationItem,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  Product,
  Shift,
  Supplier,
  SupplierPayment,
  UnitDefinition,
  User,
  Warehouse,
  Account,
  JournalEntry,
} from '../types';
import {
  ROLE_PERMISSIONS_MAP,
} from '../constants';
import { isSupabaseConfigured, sanitizedSupabaseUrl, sanitizedSupabaseKey, isValidSupabaseUrl } from '../lib/supabase';
import {
  fetchProductsFromSupabase,
  createProductWithOpeningStockInSupabase,
  updateProductInSupabase,
  SupabaseFetchError,
} from '../services/supabase/products.service';
import {
  adjustInventoryStockInSupabase,
  fetchInventoryMovementsFromSupabase,
  receiveInventoryInSupabase,
} from '../services/supabase/inventory.service';
import {
  fetchCategoriesFromSupabase,
  fetchBrandsFromSupabase,
  fetchUnitsFromSupabase,
  fetchBranchesFromSupabase,
  fetchWarehousesFromSupabase,
  saveProductCategoryInSupabase,
  setProductCategoryActiveInSupabase,
  saveProductBrandInSupabase,
  setProductBrandActiveInSupabase,
  saveProductUnitInSupabase,
  setProductUnitActiveInSupabase,
} from '../services/supabase/reference-data.service';
import {
  fetchOrdersFromSupabase,
  confirmOrderInSupabase,
  completeWebsiteOrderWithPaymentInSupabase,
  completeWebsiteOrderWithSettlementInSupabase,
  cancelOrderInSupabase,
  returnCompletedWebsiteOrderInSupabase,
  startOrUpdateOrderDeliveryInSupabase,
  updateOrderStatusInSupabase,
} from '../services/supabase/orders.service';
import {
  createPosSaleInSupabase,
  getOrCreatePublicPosReceiptUrlFromSupabase,
} from '../services/supabase/pos.service';
import {
  fetchStockAlertsFromSupabase,
  markAllStockAlertsReadInSupabase,
  markStockAlertReadInSupabase,
} from '../services/supabase/stockAlerts.service';
import {
  hasRegisteredDeviceBiometric,
  registerDeviceBiometric,
  removeRegisteredDeviceBiometric,
  verifyDeviceBiometric,
} from '../services/deviceBiometrics.service';
import {
  cancelEmptyCashShiftInSupabase,
  closeCashShiftInSupabase,
  createOperationalExpenseInSupabase,
  fetchExpenseShiftCenterFromSupabase,
  openCashShiftInSupabase,
} from '../services/supabase/expenses-shifts.service';

const STORAGE_KEY = 'nawasrah_bm_state_v1';

const UNAUTHENTICATED_USER: User = {
  id: '',
  name: 'مستخدم غير مسجل',
  email: '',
  phone: '',
  role: 'View Only',
  branchId: '',
  themeMode: 'dark',
  permissions: [],
  isActive: false,
};

const LOADING_BRANCH: Branch = {
  id: '',
  name: 'جاري تحميل الفرع',
  address: '',
  city: '',
  phone: '',
  isMain: false,
};

export interface SupabaseDiagnosticInfo {
  hasUrl: boolean;
  isValidUrlScheme: boolean;
  hasKey: boolean;
  isConfigured: boolean;
  authSessionStatus: 'authenticated' | 'unauthenticated' | 'error' | 'checking';
  authSessionUser?: string | null;
  productsQueryStatus: 'success' | 'failed' | 'idle' | 'loading';
  productsErrorCode?: string;
  productsErrorMessage?: string;
  productsErrorStatus?: number | string;
  productsErrorDetails?: string;
  productsErrorHint?: string;
}

export interface AppState {
  // Auth & Session
  currentUser: User;
  users: User[];
  activeBranch: Branch;
  branches: Branch[];
  warehouses: Warehouse[];
  isBiometricsEnabled: boolean;
  isLockedWithFaceId: boolean;

  // Domain Collections
  products: Product[];
  categories: Category[];
  brands: Brand[];
  units: UnitDefinition[];
  orders: Order[];
  invoices: Invoice[];
  customers: Customer[];
  suppliers: Supplier[];
  expenses: Expense[];
  currentShift: Shift | null;
  recentShifts: Shift[];
  movements: InventoryMovement[];
  accounts: Account[];
  journalEntries: JournalEntry[];
  customerPayments: CustomerPayment[];
  supplierPayments: SupplierPayment[];
  notifications: NotificationItem[];
  auditLogs: AuditLog[];

  // App UI State
  isQuickActionOpen: boolean;
  activeTab: 'home' | 'orders' | 'products' | 'accounts' | 'more' | 'dashboard' | 'pos' | 'inventory' | 'expenses' | 'shifts' | 'reports' | 'users' | 'purchases';
  currentModal: string | null;
  modalData: any;
  customerNavigationTarget: string | null;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;

  isProductsLoading: boolean;
  productsSource: 'supabase';
  productsError: string | null;
  supabaseDiagnostics: SupabaseDiagnosticInfo;
}

class StoreEngine {
  private state: AppState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = this.getInitialState();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.state = {
          ...initial,
          activeTab:
            parsed.activeTab &&
            [
              'home',
              'orders',
              'products',
              'accounts',
              'more',
              'dashboard',
              'pos',
              'inventory',
              'expenses',
              'shifts',
              'reports',
              'users',
              'purchases',
            ].includes(parsed.activeTab)
              ? parsed.activeTab
              : initial.activeTab,
          currentModal: null,
          currentUser: {
            ...UNAUTHENTICATED_USER,
            themeMode: parsed.currentUser?.themeMode === 'light' ? 'light' : 'dark',
          },
          isQuickActionOpen: false,
          isBiometricsEnabled: false,
          isLockedWithFaceId: false,
        };
      } catch {
        this.state = initial;
      }
    } else {
      this.state = initial;
    }

    if (isSupabaseConfigured) {
      this.refreshProductsFromSupabase();
      this.refreshOrdersFromSupabase();
      this.refreshInventoryMovementsFromSupabase();
    }
  }

  public async refreshOrdersFromSupabase() {
    if (!isSupabaseConfigured) return;
    try {
      const res = await fetchOrdersFromSupabase('all');
      if (res.success && res.orders) {
        this.state.orders = res.orders;
        this.notify();
      }
    } catch (err) {
      console.error('[Store refreshOrdersFromSupabase Exception]:', err);
    }
  }

  public async refreshProductsFromSupabase() {
    this.state.isProductsLoading = true;
    this.state.supabaseDiagnostics = {
      ...this.state.supabaseDiagnostics,
      productsQueryStatus: 'loading',
    };
    this.notify();

    try {
      const res = await fetchProductsFromSupabase();
      this.state.products = res.products;
      this.state.productsSource = res.source;
      this.state.productsError = res.error || null;

      this.state.supabaseDiagnostics = {
        hasUrl: Boolean(sanitizedSupabaseUrl),
        isValidUrlScheme: isValidSupabaseUrl,
        hasKey: Boolean(sanitizedSupabaseKey),
        isConfigured: isSupabaseConfigured,
        authSessionStatus: res.authSessionStatus || 'unauthenticated',
        authSessionUser: res.authSessionUser,
        productsQueryStatus: res.errorDetails ? 'failed' : 'success',
        productsErrorCode: res.errorDetails?.code,
        productsErrorMessage: res.errorDetails?.message,
        productsErrorStatus: res.errorDetails?.status,
        productsErrorDetails: res.errorDetails?.details,
        productsErrorHint: res.errorDetails?.hint,
      };

      if (res.source === 'supabase') {
        if (!res.errorDetails) {
          const categories = await fetchCategoriesFromSupabase();
          this.state.categories = categories;

          const brands = await fetchBrandsFromSupabase();
          this.state.brands = brands;

          const units = await fetchUnitsFromSupabase();
          this.state.units = units;

          const branches = await fetchBranchesFromSupabase();
          this.state.branches = branches;
          if (branches.length > 0) {
            // Always replace the cached object with the fresh Supabase record.
            // The branch id can stay the same while its name/location changes.
            this.state.activeBranch =
              branches.find(
                (branch) => branch.id === this.state.activeBranch?.id
              ) ?? branches[0];
          }

          const warehouses = await fetchWarehousesFromSupabase();
          this.state.warehouses = warehouses;

          if (this.state.currentUser.id && this.state.activeBranch.id) {
            try {
              await this.refreshExpenseShiftCenterFromSupabase();
            } catch (error) {
              // Finance access is role-scoped and must not invalidate the
              // independently successful product/reference-data refresh.
              console.warn('[Store finance center refresh skipped]:', error);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[Store refreshProductsFromSupabase Exception]:', err);
      this.state.productsSource = 'supabase';
      this.state.productsError = err?.message || 'تعذر الاتصال بـ Supabase';
      this.state.supabaseDiagnostics = {
        ...this.state.supabaseDiagnostics,
        productsQueryStatus: 'failed',
        productsErrorMessage: err?.message || String(err),
      };
    } finally {
      this.state.isProductsLoading = false;
      this.notify();
    }
  }

  public async refreshCategoriesFromSupabase() {
    const categories = await fetchCategoriesFromSupabase();
    this.state.categories = categories;
    this.notify();
    return categories;
  }

  public async refreshBrandsFromSupabase() {
    const brands = await fetchBrandsFromSupabase();
    this.state.brands = brands;
    this.notify();
    return brands;
  }

  public async refreshUnitsFromSupabase() {
    const units = await fetchUnitsFromSupabase();
    this.state.units = units;
    this.notify();
    return units;
  }

  public async refreshInventoryMovementsFromSupabase() {
    if (!isSupabaseConfigured) return;

    try {
      this.state.movements =
        await fetchInventoryMovementsFromSupabase();
      this.notify();
    } catch (error) {
      console.error(
        '[Store refreshInventoryMovements Exception]:',
        error
      );
    }
  }

  public async refreshExpenseShiftCenterFromSupabase() {
    if (
      !isSupabaseConfigured ||
      !this.state.currentUser.id ||
      !this.state.activeBranch.id
    ) {
      return;
    }

    try {
      const center = await fetchExpenseShiftCenterFromSupabase(
        this.state.activeBranch.id
      );
      this.state.expenses = center.expenses;
      this.state.currentShift = center.currentShift;
      this.state.recentShifts = center.recentShifts;
      this.notify();
    } catch (error) {
      console.error('[Store refreshExpenseShiftCenter Exception]:', error);
      throw error;
    }
  }

  public async refreshStockNotificationsFromSupabase() {
    if (!isSupabaseConfigured) {
      this.state.notifications = [];
      this.notify();
      return [];
    }

    try {
      const result = await fetchStockAlertsFromSupabase();
      this.state.notifications = result.notifications;
      this.notify();
      return result.notifications;
    } catch (error) {
      console.error('[Store refreshStockNotifications Exception]:', error);
      return this.state.notifications;
    }
  }

  public async markNotificationRead(notificationId: string) {
    const result = await markStockAlertReadInSupabase(notificationId);
    if (!result.success) {
      this.setToast(result.error || 'تعذر تحديث حالة التنبيه.', 'error');
      return false;
    }

    this.state.notifications = this.state.notifications.map((notification) =>
      notification.id === notificationId
        ? { ...notification, read: true }
        : notification
    );
    this.notify();
    return true;
  }

  public async markAllNotificationsRead() {
    const result = await markAllStockAlertsReadInSupabase();
    if (!result.success) {
      this.setToast(result.error || 'تعذر تحديث التنبيهات.', 'error');
      return false;
    }

    this.state.notifications = this.state.notifications.map((notification) => ({
      ...notification,
      read: true,
    }));
    this.notify();
    return true;
  }

  private getInitialState(): AppState {
    return {
      currentUser: UNAUTHENTICATED_USER,
      users: [],
      activeBranch: LOADING_BRANCH,
      branches: [],
      warehouses: [],
      isBiometricsEnabled: false,
      isLockedWithFaceId: false,

      products: [],
      categories: [],
      brands: [],
      units: [],
      orders: [],
      invoices: [],
      customers: [],
      suppliers: [],
      expenses: [],
      currentShift: null,
      recentShifts: [],
      movements: [],
      accounts: [],
      journalEntries: [],
      customerPayments: [],
      supplierPayments: [],
      notifications: [],
      auditLogs: [],

      isQuickActionOpen: false,
      activeTab: 'home',
      currentModal: null,
      modalData: null,
      customerNavigationTarget: null,
      toast: null,
      isProductsLoading: false,
      productsSource: 'supabase',
      productsError: null,
      supabaseDiagnostics: {
        hasUrl: Boolean(sanitizedSupabaseUrl),
        isValidUrlScheme: isValidSupabaseUrl,
        hasKey: Boolean(sanitizedSupabaseKey),
        isConfigured: isSupabaseConfigured,
        authSessionStatus: 'checking',
        productsQueryStatus: 'idle',
      },
    };
  }

  public getState(): AppState {
    return this.state;
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('[Store persistence warning]:', error);
    }
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('[Store listener error]:', error);
      }
    });
  }

  // --- Actions ---

  public setToast(
    message: string | { message?: string; type?: 'success' | 'error' | 'info' },
    type: 'success' | 'error' | 'info' = 'success'
  ) {
    let finalMsg = '';
    let finalType = type;

    if (typeof message === 'object' && message !== null) {
      finalMsg = message.message || JSON.stringify(message);
      if (message.type) {
        finalType = message.type;
      }
    } else {
      finalMsg = String(message || '');
    }

    this.state.toast = { message: finalMsg, type: finalType };
    this.notify();
    setTimeout(() => {
      this.state.toast = null;
      this.notify();
    }, 3500);
  }

  public setActiveTab(tab: AppState['activeTab']) {
    this.state.activeTab = tab;
    this.notify();
  }

  public openCustomerProfile(customerId: string) {
    this.state.currentModal = null;
    this.state.modalData = null;
    this.state.customerNavigationTarget = customerId;
    this.state.activeTab = 'accounts';
    this.notify();
  }

  public clearCustomerNavigationTarget() {
    if (!this.state.customerNavigationTarget) return;
    this.state.customerNavigationTarget = null;
    this.notify();
  }

  public toggleQuickAction(open?: boolean) {
    this.state.isQuickActionOpen = open ?? !this.state.isQuickActionOpen;
    this.notify();
  }

  public openModal(modalName: string, data: any = null) {
    this.state.currentModal = modalName;
    this.state.modalData = data;
    this.notify();
  }

  public closeModal() {
    this.state.currentModal = null;
    this.state.modalData = null;
    this.notify();
  }

  public setActiveBranch(branchId: string) {
    const branch = this.state.branches.find((b) => b.id === branchId);
    if (branch) {
      this.state.activeBranch = branch;
      this.state.currentUser.branchId = branchId;
      this.addAuditLog('تغيير الفرع', `تم الانتقال إلى ${branch.name}`);
      this.setToast(`تم الانتقال إلى ${branch.name}`);
      this.notify();
      void this.refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
    }
  }

  public setCurrentUser(userUpdates: Partial<User>) {
    const previousUserId = this.state.currentUser.id;
    this.state.currentUser = {
      ...this.state.currentUser,
      ...userUpdates,
      permissions: userUpdates.role
        ? ROLE_PERMISSIONS_MAP[userUpdates.role] || this.state.currentUser.permissions
        : this.state.currentUser.permissions,
    };

    if (userUpdates.id && userUpdates.id !== previousUserId) {
      this.state.isBiometricsEnabled = hasRegisteredDeviceBiometric(
        userUpdates.id
      );
      this.state.isLockedWithFaceId = false;
    }

    this.notify();
  }

  public async toggleBiometrics() {
    const { id, name } = this.state.currentUser;

    if (this.state.isBiometricsEnabled) {
      removeRegisteredDeviceBiometric(id);
      this.state.isBiometricsEnabled = false;
      this.state.isLockedWithFaceId = false;
      this.addAuditLog(
        'تعطيل بصمة الجهاز',
        'تم تعطيل قفل التطبيق ببصمة الجهاز على هذا الجهاز'
      );
      this.setToast('تم إيقاف قفل Face ID على هذا الجهاز.');
      this.notify();
      return true;
    }

    const result = await registerDeviceBiometric(id, name);
    if (!result.success) {
      this.setToast(result.error || 'تعذر تفعيل بصمة الجهاز.', 'error');
      return false;
    }

    this.state.isBiometricsEnabled = true;
    this.state.isLockedWithFaceId = false;
    this.addAuditLog(
      'تفعيل بصمة الجهاز',
      'تم تسجيل بصمة الجهاز وتفعيل قفل التطبيق'
    );
    this.setToast('تم تفعيل Face ID والتحقق من بصمة الجهاز بنجاح.');
    this.notify();
    return true;
  }

  public lockWithFaceId() {
    if (
      !this.state.isBiometricsEnabled ||
      !hasRegisteredDeviceBiometric(this.state.currentUser.id)
    ) {
      return false;
    }

    this.state.isLockedWithFaceId = true;
    this.notify();
    return true;
  }

  public async unlockFaceId() {
    if (!this.state.isBiometricsEnabled) {
      this.state.isLockedWithFaceId = false;
      this.notify();
      return true;
    }

    const result = await verifyDeviceBiometric(this.state.currentUser.id);
    if (!result.success) {
      this.setToast(result.error || 'تعذر التحقق من بصمة الجهاز.', 'error');
      return false;
    }

    this.state.isLockedWithFaceId = false;
    this.setToast('تم التأكد من الهوية بواسطة بصمة الجهاز.');
    this.notify();
    return true;
  }

  public clearFaceIdLockForPasswordSignIn() {
    this.state.isLockedWithFaceId = false;
    this.notify();
  }

  private addAuditLog(action: string, details: string) {
    const newLog: AuditLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: this.state.currentUser.id,
      userName: this.state.currentUser.name,
      action,
      details,
    };
    this.state.auditLogs = [newLog, ...this.state.auditLogs];
  }

  // --- Atomic Stock & Order Actions ---

  public async confirmOrder(orderId: string, notes?: string) {
    if (isSupabaseConfigured) {
      const res = await confirmOrderInSupabase(orderId, notes);
      if (!res.success) {
        this.setToast(`فشل تأكيد الطلب: ${res.error}`, 'error');
        return;
      }
      this.setToast(res.message || 'تم قبول الطلب وحجز المخزون بنجاح');
      await this.refreshOrdersFromSupabase();
      await this.refreshProductsFromSupabase();
      return;
    }

    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return;

    if (order.status !== 'new' && order.status !== 'pending_confirmation') {
      this.setToast('هذا الطلب غير مؤهل للتأكيد الفوري', 'error');
      return;
    }

    // Atomic check: Verify available quantities for all items
    for (const item of order.items) {
      const prod = this.state.products.find((p) => p.id === item.productId);
      if (!prod) {
        this.setToast(`المنتج ${item.productName} غير موجود بالمخزون!`, 'error');
        return;
      }
      if (prod.availableQuantity < item.quantity) {
        this.setToast(
          `تعارض مخزون: الكمية المتاحة من ${prod.nameAr} هي ${prod.availableQuantity} فقط بينما المطلوب ${item.quantity}!`,
          'error'
        );
        return;
      }
    }

    // Perform atomic reservation
    order.items.forEach((item) => {
      const prod = this.state.products.find((p) => p.id === item.productId);
      if (prod) {
        const prevQty = prod.onHandQuantity;
        prod.reservedQuantity += item.quantity;
        prod.availableQuantity = prod.onHandQuantity - prod.reservedQuantity;

        // Record inventory movement: Reservation
        this.state.movements.unshift({
          id: `mov-${Date.now()}-${Math.random()}`,
          productId: prod.id,
          productName: prod.nameAr,
          branchId: this.state.activeBranch.id,
          warehouseId: 'w-main',
          movementType: 'Reservation',
          previousQuantity: prevQty,
          quantityChange: item.quantity,
          newQuantity: prod.availableQuantity,
          reason: `حجز كمية للطلب رقم ${order.orderNumber}`,
          performedByUserId: this.state.currentUser.id,
          performedByUserName: this.state.currentUser.name,
          timestamp: new Date().toISOString(),
          referenceId: order.id,
        });
      }
    });

    order.status = 'confirmed';
    order.isNew = false;
    order.statusHistory.push({
      status: 'confirmed',
      changedAt: new Date().toISOString(),
      changedBy: this.state.currentUser.name,
    });

    this.addAuditLog('تأكيد طلب زبائن', `تم تأكيد وحجز كميات الطلب ${order.orderNumber}`);
    this.setToast(`تم قبول الطلب ${order.orderNumber} وحجز المنتجات بنجاح`);
    this.notify();
  }

  public async cancelOrder(orderId: string, reason: string = 'إلغاء بواسطة الإدارة') {
    if (isSupabaseConfigured) {
      const res = await cancelOrderInSupabase(orderId, reason);
      if (!res.success) {
        this.setToast(`فشل إلغاء الطلب: ${res.error}`, 'error');
        return;
      }
      this.setToast(res.message || 'تم إلغاء الطلب وتحرير الكميات المحجوزة');
      await this.refreshOrdersFromSupabase();
      await this.refreshProductsFromSupabase();
      return;
    }

    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return;

    // Release reservation if it was confirmed or processing
    if (order.status === 'confirmed' || order.status === 'processing') {
      order.items.forEach((item) => {
        const prod = this.state.products.find((p) => p.id === item.productId);
        if (prod) {
          prod.reservedQuantity = Math.max(0, prod.reservedQuantity - item.quantity);
          prod.availableQuantity = prod.onHandQuantity - prod.reservedQuantity;

          this.state.movements.unshift({
            id: `mov-${Date.now()}-${Math.random()}`,
            productId: prod.id,
            productName: prod.nameAr,
            branchId: this.state.activeBranch.id,
            warehouseId: 'w-main',
            movementType: 'Release Reservation',
            previousQuantity: prod.onHandQuantity,
            quantityChange: -item.quantity,
            newQuantity: prod.availableQuantity,
            reason: `تحرير حجز بسبب إلغاء الطلب ${order.orderNumber}: ${reason}`,
            performedByUserId: this.state.currentUser.id,
            performedByUserName: this.state.currentUser.name,
            timestamp: new Date().toISOString(),
            referenceId: order.id,
          });
        }
      });
    }

    order.status = 'cancelled';
    order.isNew = false;
    order.statusHistory.push({
      status: 'cancelled',
      changedAt: new Date().toISOString(),
      changedBy: this.state.currentUser.name,
      reason,
    });

    this.addAuditLog('إلغاء طلب', `تم إلغاء الطلب ${order.orderNumber}`);
    this.setToast(`تم إلغاء الطلب ${order.orderNumber} وتحرير الكميات المحجوزة`);
    this.notify();
  }

  public async completeWebsiteOrderWithPayment(
    orderId: string,
    paymentMethod: 'cash' | 'cliq',
    referenceNumber?: string,
    notes?: string
  ): Promise<boolean> {
    if (!isSupabaseConfigured) {
      this.setToast('الاتصال بقاعدة البيانات مطلوب لإتمام التحصيل.', 'error');
      return false;
    }

    const res = await completeWebsiteOrderWithPaymentInSupabase(
      orderId,
      paymentMethod,
      referenceNumber,
      notes
    );
    if (!res.success) {
      this.setToast(`فشل تأكيد القبض والتسليم: ${res.error}`, 'error');
      return false;
    }

    this.setToast(
      res.message ||
        'تم تأكيد القبض والتسليم وخصم المخزون وربط العملية بالوردية.'
    );
    await this.refreshOrdersFromSupabase();
    await this.refreshProductsFromSupabase();
    await this.refreshExpenseShiftCenterFromSupabase();
    return true;
  }

  public async completeWebsiteOrderWithSettlement(input: {
    orderId: string;
    paymentMethod: 'cash' | 'cliq' | 'debt';
    amountCollected: number;
    deliveryFee: number;
    referenceNumber?: string;
    notes?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured) {
      this.setToast('الاتصال بقاعدة البيانات مطلوب لإتمام التسليم والتحصيل.', 'error');
      return false;
    }

    const result = await completeWebsiteOrderWithSettlementInSupabase(input);
    if (!result.success) {
      this.setToast(`فشل تسليم الطلب وتسجيل الحساب: ${result.error}`, 'error');
      return false;
    }

    this.setToast(result.message || 'تم تسليم الطلب وتحديث حساب العميل.');
    await this.refreshOrdersFromSupabase();
    await this.refreshProductsFromSupabase();
    await this.refreshExpenseShiftCenterFromSupabase();
    return true;
  }

  public async returnCompletedWebsiteOrder(input: {
    orderId: string;
    reason: string;
    stockDisposition: 'restock' | 'damaged';
    refundMethod: 'cash' | 'cliq';
    referenceNumber?: string;
    notes?: string;
  }): Promise<boolean> {
    if (!isSupabaseConfigured) {
      this.setToast('الاتصال بقاعدة البيانات مطلوب لتسجيل المرتجع.', 'error');
      return false;
    }

    const result = await returnCompletedWebsiteOrderInSupabase(input);
    if (!result.success) {
      this.setToast(`فشل تسجيل المرتجع: ${result.error}`, 'error');
      return false;
    }

    await this.refreshOrdersFromSupabase();
    await this.refreshProductsFromSupabase();
    await this.refreshInventoryMovementsFromSupabase();
    await this.refreshExpenseShiftCenterFromSupabase();
    this.setToast(
      result.message ||
        `تم تسجيل المرتجع ${result.returnNumber || ''} بنجاح.`
    );
    return true;
  }

  public async advanceOrderStatus(orderId: string, nextStatus: OrderStatus, notes?: string) {
    if (isSupabaseConfigured) {
      let res;
      if (nextStatus === 'delivered' || nextStatus === 'completed') {
        this.setToast(
          'أكمل الطلب من خطوة تأكيد القبض وحدد كاش أو CliQ أولًا.',
          'error'
        );
        return;
      } else if (nextStatus === 'cancelled') {
        res = await cancelOrderInSupabase(orderId, notes);
      } else if (nextStatus === 'confirmed') {
        res = await confirmOrderInSupabase(orderId, notes);
      } else {
        res = await updateOrderStatusInSupabase(orderId, nextStatus, notes);
      }

      if (!res.success) {
        this.setToast(`فشل تحديث حالة الطلب: ${res.error}`, 'error');
        return;
      }
      this.setToast(res.message || `تم تحديث حالة الطلب إلى ${nextStatus}`);
      await this.refreshOrdersFromSupabase();
      await this.refreshProductsFromSupabase();
      return;
    }

    this.setToast(
      'تعذر تحديث الطلب لأن الاتصال بقاعدة بيانات Supabase غير متاح.',
      'error'
    );
  }

  public async startOrUpdateOrderDelivery(
    orderId: string,
    etaMinutes: number,
    driverPhone: string,
    notes?: string
  ) {
    if (!isSupabaseConfigured) {
      const result = {
        success: false,
        error: 'الاتصال بقاعدة البيانات مطلوب لبدء التوصيل.',
      };
      this.setToast(result.error, 'error');
      return result;
    }

    const result = await startOrUpdateOrderDeliveryInSupabase(
      orderId,
      etaMinutes,
      driverPhone,
      notes
    );
    if (!result.success) {
      this.setToast(`فشل بدء التوصيل: ${result.error}`, 'error');
      return result;
    }

    await this.refreshOrdersFromSupabase();
    this.setToast(result.message || 'بدأ التوصيل وتم تحديد وقت الوصول.');
    return result;
  }

  // --- Product CRUD & Operations ---

  public async addProduct(productData: Partial<Product>): Promise<{
    success: boolean;
    productId?: string;
    error?: string;
    errorDetails?: any;
  }> {
    const openingQty = Number(productData.onHandQuantity) || 0;
    const targetBranchId = productData.branchId || this.state.activeBranch?.id;
    const targetWarehouseId =
      productData.warehouseId || this.state.warehouses[0]?.id;

    if (isSupabaseConfigured) {
      try {
        if (!productData.sku?.trim() || !productData.nameAr?.trim()) {
          return {
            success: false,
            error: 'اسم المنتج ورمز الصنف SKU مطلوبان.',
            errorDetails: {
              code: 'INVALID_PRODUCT_DATA',
              message: 'اسم المنتج ورمز الصنف SKU مطلوبان.',
            },
          };
        }

        const unitObj = this.state.units.find((u) => u.nameAr === productData.unit || u.id === productData.unit);
        const res = await createProductWithOpeningStockInSupabase({
          sku: productData.sku.trim(),
          barcode: productData.barcode || undefined,
          nameAr: productData.nameAr.trim(),
          description: productData.description || '',
          categoryId: productData.categoryId,
          brandId: productData.brandId,
          unitId: unitObj?.id,
          purchasePackage: productData.purchasePackage,
          unitsPerPackage: productData.unitsPerPackage,
          defaultPurchasePrice: productData.defaultPurchasePrice,
          salePackage:
            productData.salePackage ||
            productData.purchasePackage ||
            productData.unit,
          unitsPerSalePackage:
            productData.unitsPerSalePackage ||
            productData.unitsPerPackage ||
            1,
          salePackagePrice:
            productData.salePackagePrice ||
            (Number(productData.wholesalePrice) || 0) *
              (productData.unitsPerSalePackage ||
                productData.unitsPerPackage ||
                1),
          costPrice: Number(productData.costPrice) || 0,
          reorderLevel:
            productData.reorderLevel === undefined
              ? 5
              : Math.max(0, Number(productData.reorderLevel) || 0),
          maxStockLevel: productData.maxStockLevel,
          warehouseId: targetWarehouseId,
          branchId: targetBranchId,
          openingQuantity: openingQty,
          imageUrl: productData.imageUrl,
        });

        if (res.success) {
          this.addAuditLog('إضافة منتج', `تم إنشاء المنتج والمخزون في Supabase: ${productData.nameAr}`);
          this.setToast('تم حفظ المنتج والمخزون في قاعدة البيانات بنجاح.', 'success');
          await this.refreshProductsFromSupabase();
          return { success: true, productId: res.productId };
        } else {
          console.error('[Supabase RPC addProduct Failed]:', res.error, res.errorDetails);
          this.state.productsError = res.error || 'فشلت إضافة المنتج في Supabase';
          this.notify();
          return {
            success: false,
            error: res.error,
            errorDetails: res.errorDetails || {
              message: res.error || 'فشلت عملية إنشاء المنتج في Supabase.',
              code: 'RPC_FAILED',
            },
          };
        }
      } catch (err: any) {
        console.error('[Supabase RPC addProduct Exception]:', err);
        const errMsg = err?.message || String(err);
        this.state.productsError = errMsg;
        this.notify();
        return {
          success: false,
          error: errMsg,
          errorDetails: {
            message: errMsg,
            code: 'CLIENT_EXCEPTION',
          },
        };
      }
    }

    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
      errorDetails: {
        code: 'SUPABASE_NOT_CONFIGURED',
        message: 'تكوين Supabase غير مكتمل في التطبيق.',
      },
    };
  }

  public async updateProduct(id: string, updates: Partial<Product>) {
    const prodIndex = this.state.products.findIndex((p) => p.id === id);
    if (prodIndex === -1) {
      return { success: false, error: 'المنتج غير موجود.' };
    }

    const current = this.state.products[prodIndex];
    const unitObj = this.state.units.find(
      (unit) =>
        unit.nameAr === (updates.unit || current.unit) ||
        unit.id === (updates.unit || current.unit)
    );

    const result = await updateProductInSupabase({
      productId: id,
      sku: updates.sku || current.sku,
      barcode: updates.barcode ?? current.barcode,
      nameAr: updates.nameAr || current.nameAr,
      description: updates.description ?? current.description,
      categoryId: updates.categoryId ?? current.categoryId,
      brandId: updates.brandId ?? current.brandId,
      unitId: unitObj?.id,
      unitName: updates.unit || current.unit,
      purchasePackage:
        updates.purchasePackage || current.purchasePackage || current.unit,
      unitsPerPackage:
        updates.unitsPerPackage || current.unitsPerPackage || 1,
      defaultPurchasePrice:
        updates.defaultPurchasePrice ??
        current.defaultPurchasePrice ??
        current.costPrice * (current.unitsPerPackage || 1),
      salePackage:
        updates.salePackage ||
        current.salePackage ||
        current.purchasePackage ||
        current.unit,
      unitsPerSalePackage:
        updates.unitsPerSalePackage ||
        current.unitsPerSalePackage ||
        current.unitsPerPackage ||
        1,
      salePackagePrice:
        updates.salePackagePrice ??
        current.salePackagePrice ??
        (current.wholesalePrice || current.retailPrice) *
          (current.unitsPerSalePackage ||
            current.unitsPerPackage ||
            1),
      costPrice: updates.costPrice ?? current.costPrice,
      reorderLevel: updates.reorderLevel ?? current.reorderLevel,
      maxStockLevel: updates.maxStockLevel ?? current.maxStockLevel,
      isActive: (updates.status || current.status) !== 'hidden',
      imageUrl: updates.imageUrl ?? current.imageUrl,
    });

    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث المنتج في Supabase.', 'error');
      return result;
    }

    await Promise.all([
      this.refreshProductsFromSupabase(),
      this.refreshInventoryMovementsFromSupabase(),
      this.refreshStockNotificationsFromSupabase(),
    ]);
    this.setToast(result.message || `تم تحديث المنتج ${current.nameAr} بنجاح.`);
    return result;
  }

  public deleteProduct(id: string) {
    const prod = this.state.products.find((p) => p.id === id);
    if (!prod) return;

    this.state.products = this.state.products.filter((p) => p.id !== id);
    this.addAuditLog('حذف منتج', `تم حذف المنتج ${prod.nameAr} (${prod.sku})`);
    this.setToast(`تم حذف المنتج ${prod.nameAr} بنجاح`);
    this.notify();
  }

  public async hideProduct(id: string) {
    const prod = this.state.products.find((p) => p.id === id);
    if (!prod) return { success: false, error: 'المنتج غير موجود.' };

    return this.updateProduct(id, {
      status: prod.status === 'hidden' ? 'active' : 'hidden',
    });
  }

  public duplicateProduct(id: string): Product | undefined {
    const prod = this.state.products.find((p) => p.id === id);
    if (!prod) return;

    const copy: Product = {
      ...prod,
      id: `prod-${Date.now()}`,
      sku: `${prod.sku}-COPY`,
      barcode: `625${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      nameAr: `${prod.nameAr} (نسخة)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastModifiedBy: this.state.currentUser.name,
    };

    this.state.products.unshift(copy);
    this.addAuditLog('تكرار منتج', `تم تكرار المنتج ${prod.nameAr}`);
    this.setToast(`تم نسخ المنتج بنجاح باسم: ${copy.nameAr}`);
    this.notify();
    return copy;
  }

  public adjustStock(productId: string, newOnHandQuantity: number, reason: string) {
    const prod = this.state.products.find((p) => p.id === productId);
    if (!prod) return;

    const previousQuantity = prod.onHandQuantity;
    const quantityChange = newOnHandQuantity - previousQuantity;
    prod.onHandQuantity = newOnHandQuantity;
    prod.availableQuantity = Math.max(0, newOnHandQuantity - prod.reservedQuantity);
    prod.updatedAt = new Date().toISOString();
    prod.lastModifiedBy = this.state.currentUser.name;

    this.state.movements.unshift({
      id: `mov-${Date.now()}-${Math.random()}`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: prod.branchId || this.state.activeBranch.id,
      warehouseId: prod.warehouseId || 'w-main',
      movementType: quantityChange >= 0 ? 'Manual Adjustment' : 'Damage',
      previousQuantity,
      quantityChange,
      newQuantity: newOnHandQuantity,
      reason: reason || 'تعديل مخزون يدوي',
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
    });

    this.addAuditLog('تعديل مخزون', `تعديل مخزون ${prod.nameAr} من ${previousQuantity} إلى ${newOnHandQuantity}. السبب: ${reason}`);
    this.setToast(`تم تعديل مخزون ${prod.nameAr} إلى ${newOnHandQuantity} ${prod.unit}`);
    this.notify();
  }

  public recordStockMovement(params: {
    productId: string;
    movementType: MovementType;
    quantityChange: number;
    reason: string;
    branchId?: string;
    warehouseId?: string;
    referenceId?: string;
    notes?: string;
  }) {
    const prod = this.state.products.find((p) => p.id === params.productId);
    if (!prod) return;

    const previousQuantity = prod.onHandQuantity;
    const newQuantity = Math.max(0, previousQuantity + params.quantityChange);
    const actualChange = newQuantity - previousQuantity;

    prod.onHandQuantity = newQuantity;
    prod.availableQuantity = Math.max(0, newQuantity - prod.reservedQuantity);
    prod.updatedAt = new Date().toISOString();
    prod.lastModifiedBy = this.state.currentUser.name;

    const targetBranchId = params.branchId || prod.branchId || this.state.activeBranch.id;
    const targetWarehouseId = params.warehouseId || prod.warehouseId || 'w-main';

    const movement: InventoryMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: targetBranchId,
      warehouseId: targetWarehouseId,
      movementType: params.movementType,
      previousQuantity,
      quantityChange: actualChange,
      newQuantity,
      reason: params.reason || params.movementType,
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
      referenceId: params.referenceId,
      notes: params.notes,
    };

    this.state.movements.unshift(movement);

    this.addAuditLog('حركة مخزون', `${params.movementType}: ${prod.nameAr} (${previousQuantity} ← ${newQuantity})`);
    this.setToast(`تم تسجيل حركة المخزون (${params.movementType}) لـ ${prod.nameAr}`);
    this.notify();
    return movement;
  }

  public async receiveGoods(params: {
    productId: string;
    quantity: number;
    branchId?: string;
    warehouseId?: string;
    supplierInvoiceNo?: string;
    notes?: string;
  }) {
    if (!isSupabaseConfigured) {
      const error = 'الاتصال بقاعدة بيانات Supabase غير متاح.';
      this.setToast(error, 'error');
      return { success: false, error };
    }

    const targetWarehouse =
      params.warehouseId || this.state.warehouses[0]?.id;
    if (!targetWarehouse) {
      const error = 'المستودع مطلوب لاستلام البضاعة.';
      this.setToast(error, 'error');
      return { success: false, error };
    }

    const result = await receiveInventoryInSupabase({
      productId: params.productId,
      warehouseId: targetWarehouse,
      quantity: params.quantity,
      referenceType: 'purchase_receipt',
      notes:
        params.notes ||
        `فاتورة مورد #${params.supplierInvoiceNo || ''}`,
    });

    if (!result.success) {
      this.setToast(
        result.error || 'تعذر تحديث المخزون في Supabase.',
        'error'
      );
      return result;
    }

    await Promise.all([
      this.refreshProductsFromSupabase(),
      this.refreshInventoryMovementsFromSupabase(),
      this.refreshStockNotificationsFromSupabase(),
    ]);
    this.setToast(
      'تم استلام البضاعة وتحديث الرصيد في Supabase بنجاح.'
    );
    return result;
  }

  public transferWarehouse(params: {
    productId: string;
    quantity: number;
    fromWarehouseId: string;
    toWarehouseId: string;
    fromBranchId?: string;
    toBranchId?: string;
    reason?: string;
  }) {
    const prod = this.state.products.find((p) => p.id === params.productId);
    if (!prod) return;

    const fromWh = this.state.warehouses.find((w) => w.id === params.fromWarehouseId)?.name || params.fromWarehouseId;
    const toWh = this.state.warehouses.find((w) => w.id === params.toWarehouseId)?.name || params.toWarehouseId;

    const reason = params.reason || `نقل مخزون من ${fromWh} إلى ${toWh}`;

    // Record transfer out
    this.state.movements.unshift({
      id: `mov-${Date.now()}-out`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: params.fromBranchId || prod.branchId || this.state.activeBranch.id,
      warehouseId: params.fromWarehouseId,
      movementType: 'Transfer Out',
      previousQuantity: prod.onHandQuantity,
      quantityChange: -params.quantity,
      newQuantity: prod.onHandQuantity,
      reason: `تحويل خروج: ${reason}`,
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
    });

    // Record transfer in
    this.state.movements.unshift({
      id: `mov-${Date.now()}-in`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: params.toBranchId || prod.branchId || this.state.activeBranch.id,
      warehouseId: params.toWarehouseId,
      movementType: 'Transfer In',
      previousQuantity: prod.onHandQuantity,
      quantityChange: params.quantity,
      newQuantity: prod.onHandQuantity,
      reason: `تحويل دخول: ${reason}`,
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
    });

    prod.warehouseId = params.toWarehouseId;
    if (params.toBranchId) prod.branchId = params.toBranchId;
    prod.updatedAt = new Date().toISOString();

    this.addAuditLog('نقل مخزون', `نقل ${params.quantity} ${prod.unit} لـ ${prod.nameAr} من ${fromWh} إلى ${toWh}`);
    this.setToast(`تم نقل ${params.quantity} ${prod.unit} لـ ${prod.nameAr} إلى ${toWh} بنجاح`);
    this.notify();
  }

  public async executeStockCount(params: {
    productId: string;
    actualQuantity: number;
    reason?: string;
    warehouseId?: string;
    adjustmentType?: 'stock_count' | 'damage' | 'expired' | 'manual';
  }) {
    const prod = this.state.products.find((p) => p.id === params.productId);
    if (!prod) return { success: false, error: 'المنتج غير موجود.' };

    const warehouseId = params.warehouseId || prod.warehouseId;
    if (!warehouseId) {
      return { success: false, error: 'المستودع مطلوب لتنفيذ الجرد.' };
    }

    const result = await adjustInventoryStockInSupabase({
      productId: params.productId,
      warehouseId,
      actualQuantity: params.actualQuantity,
      reason: params.reason || 'جرد مخزني وتسوية الفروقات',
      adjustmentType: params.adjustmentType || 'stock_count',
    });

    if (!result.success) {
      this.setToast(result.error || 'فشلت تسوية المخزون.', 'error');
      return result;
    }

    await Promise.all([
      this.refreshProductsFromSupabase(),
      this.refreshInventoryMovementsFromSupabase(),
      this.refreshStockNotificationsFromSupabase(),
    ]);
    this.setToast(
      result.data?.message ||
        `تم اعتماد جرد ${prod.nameAr} وحفظه في Supabase.`
    );
    return result;
  }

  // --- Category, Brand & Unit Actions ---

  public async addCategory(data: Partial<Category>) {
    if (!data.nameAr?.trim()) {
      return { success: false, error: 'اسم القسم مطلوب.' };
    }

    const result = await saveProductCategoryInSupabase({
      nameAr: data.nameAr,
      code: data.code,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل حفظ القسم.', 'error');
      return result;
    }

    await this.refreshCategoriesFromSupabase();
    this.setToast(result.message || `تمت إضافة القسم ${data.nameAr}.`);
    return result;
  }

  public async updateCategory(id: string, updates: Partial<Category>) {
    const current = this.state.categories.find((category) => category.id === id);
    if (!current) {
      return { success: false, error: 'القسم غير موجود.' };
    }

    const result = await saveProductCategoryInSupabase({
      categoryId: id,
      nameAr: updates.nameAr?.trim() || current.nameAr,
      code: updates.code ?? current.code,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث القسم.', 'error');
      return result;
    }

    await this.refreshCategoriesFromSupabase();
    this.setToast(result.message || `تم تحديث القسم ${current.nameAr}.`);
    return result;
  }

  public async setCategoryActive(id: string, isActive: boolean) {
    const category = this.state.categories.find((item) => item.id === id);
    if (!category) {
      return { success: false, error: 'القسم غير موجود.' };
    }

    const result = await setProductCategoryActiveInSupabase(id, isActive);
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث حالة القسم.', 'error');
      return result;
    }

    await this.refreshCategoriesFromSupabase();
    this.setToast(result.message || 'تم تحديث حالة القسم.');
    return result;
  }

  public async deleteCategory(id: string) {
    return this.setCategoryActive(id, false);
  }

  public async addBrand(data: Partial<Brand>) {
    if (!data.nameAr?.trim()) {
      return { success: false, error: 'اسم العلامة التجارية مطلوب.' };
    }

    const result = await saveProductBrandInSupabase({
      nameAr: data.nameAr,
      description: data.description,
      logoUrl: data.logoUrl,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل حفظ العلامة التجارية.', 'error');
      return result;
    }

    await this.refreshBrandsFromSupabase();
    this.setToast(result.message || `تمت إضافة العلامة ${data.nameAr}.`);
    return result;
  }

  public async updateBrand(id: string, updates: Partial<Brand>) {
    const brand = this.state.brands.find((b) => b.id === id);
    if (!brand) {
      return { success: false, error: 'العلامة التجارية غير موجودة.' };
    }

    const result = await saveProductBrandInSupabase({
      brandId: id,
      nameAr: updates.nameAr?.trim() || brand.nameAr,
      description: updates.description ?? brand.description,
      logoUrl: updates.logoUrl ?? brand.logoUrl,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث العلامة التجارية.', 'error');
      return result;
    }

    await this.refreshBrandsFromSupabase();
    this.setToast(result.message || `تم تحديث العلامة ${brand.nameAr}.`);
    return result;
  }

  public async setBrandActive(id: string, isActive: boolean) {
    const brand = this.state.brands.find((item) => item.id === id);
    if (!brand) {
      return { success: false, error: 'العلامة التجارية غير موجودة.' };
    }

    const result = await setProductBrandActiveInSupabase(id, isActive);
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث حالة العلامة التجارية.', 'error');
      return result;
    }

    await this.refreshBrandsFromSupabase();
    this.setToast(result.message || 'تم تحديث حالة العلامة التجارية.');
    return result;
  }

  public async deleteBrand(id: string) {
    return this.setBrandActive(id, false);
  }

  public async addUnit(data: Partial<UnitDefinition>) {
    if (!data.nameAr?.trim() || !data.code?.trim()) {
      return { success: false, error: 'اسم الوحدة وكودها مطلوبان.' };
    }

    const result = await saveProductUnitInSupabase({
      nameAr: data.nameAr,
      code: data.code,
      conversionFactor: data.conversionFactor || 1,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل حفظ وحدة القياس.', 'error');
      return result;
    }

    await this.refreshUnitsFromSupabase();
    this.setToast(result.message || `تمت إضافة الوحدة ${data.nameAr}.`);
    return result;
  }

  public async updateUnit(id: string, updates: Partial<UnitDefinition>) {
    const unit = this.state.units.find((u) => u.id === id);
    if (!unit) {
      return { success: false, error: 'وحدة القياس غير موجودة.' };
    }

    const result = await saveProductUnitInSupabase({
      unitId: id,
      nameAr: updates.nameAr?.trim() || unit.nameAr,
      code: updates.code?.trim() || unit.code,
      conversionFactor:
        updates.conversionFactor ?? unit.conversionFactor,
    });
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث وحدة القياس.', 'error');
      return result;
    }

    await this.refreshUnitsFromSupabase();
    this.setToast(result.message || `تم تحديث الوحدة ${unit.nameAr}.`);
    return result;
  }

  public async setUnitActive(id: string, isActive: boolean) {
    const unit = this.state.units.find((item) => item.id === id);
    if (!unit) {
      return { success: false, error: 'وحدة القياس غير موجودة.' };
    }

    const result = await setProductUnitActiveInSupabase(id, isActive);
    if (!result.success) {
      this.setToast(result.error || 'فشل تحديث حالة وحدة القياس.', 'error');
      return result;
    }

    await this.refreshUnitsFromSupabase();
    this.setToast(result.message || 'تم تحديث حالة وحدة القياس.');
    return result;
  }

  public async deleteUnit(id: string) {
    return this.setUnitActive(id, false);
  }

  // --- Profile & User Management ---

  public getCurrentProfile(): User {
    return this.state.currentUser;
  }

  public updateProfile(updates: Partial<User>) {
    // Prevent changing role, permissions or isActive from profile form
    const {
      role: _role,
      permissions: _permissions,
      isActive: _isActive,
      ...safeUpdates
    } = updates;

    Object.assign(this.state.currentUser, safeUpdates);

    // Sync with users array
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      Object.assign(matched, safeUpdates);
    }

    // Sync activeBranch if branchId changed and user is Owner/Admin
    if (
      safeUpdates.branchId &&
      (this.state.currentUser.role === 'Owner' || this.state.currentUser.role === 'Admin')
    ) {
      const br = this.state.branches.find((b) => b.id === safeUpdates.branchId);
      if (br) {
        this.state.activeBranch = br;
      }
    }

    this.addAuditLog('تحديث الملف الشخصي', `تم تحديث بيانات الملف الشخصي للمستخدم: ${this.state.currentUser.name}`);
    this.setToast('تم حفظ التغييرات على ملفك الشخصي بنجاح');
    this.notify();
  }

  public updateProfilePhoto(avatarUrl: string) {
    this.state.currentUser.avatarUrl = avatarUrl;
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.avatarUrl = avatarUrl;
    }
    this.addAuditLog('تغيير صورة الملف الشخصي', 'تم تحديث الصورة الشخصية للمستخدم');
    this.setToast('تم تحديث الصورة الشخصية بنجاح');
    this.notify();
  }

  public updatePhone(newPhone: string) {
    this.state.currentUser.phone = newPhone;
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.phone = newPhone;
    }
    this.addAuditLog('تحديث رقم الهاتف', `تم تغيير رقم الهاتف إلى ${newPhone}`);
    this.setToast('تم تحديث رقم الهاتف بنجاح بعد التحقق من الرمز');
    this.notify();
  }

  public updateEmail(newEmail: string) {
    this.state.currentUser.email = newEmail;
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.email = newEmail;
    }
    this.addAuditLog('تحديث البريد الإلكتروني', `تم تغيير البريد الإلكتروني إلى ${newEmail}`);
    this.setToast('تم تحديث البريد الإلكتروني بنجاح بعد التحقق من الرمز');
    this.notify();
  }

  public changePassword(oldPass: string, newPass: string) {
    if (!newPass || newPass.length < 6) {
      this.setToast('كلمة المرور يجب أن لا تقل عن 6 خانات', 'error');
      return false;
    }
    this.addAuditLog('تغيير كلمة المرور', 'تم تغيير كلمة المرور للمستخدم بنجاح');
    this.setToast('تم تغيير كلمة المرور بنجاح');
    this.notify();
    return true;
  }

  public async toggleFaceId() {
    return this.toggleBiometrics();
  }

  public updateNotificationPreferences(settings: User['notificationSettings']) {
    this.state.currentUser.notificationSettings = {
      ...this.state.currentUser.notificationSettings,
      ...settings,
    };
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.notificationSettings = this.state.currentUser.notificationSettings;
    }
    this.addAuditLog('تحديث إعدادات الإشعارات', 'تم تعديل تفضيلات الإشعارات والتنبيهات');
    this.setToast('تم حفظ تفضيلات الإشعارات بنجاح');
    this.notify();
  }

  public updateDefaultBranch(branchId: string) {
    if (this.state.currentUser.role !== 'Owner' && this.state.currentUser.role !== 'Admin') {
      this.setToast('ليس لديك صلاحية لتغيير الفرع المسموح به! تواصل مع مدير النظام.', 'error');
      return;
    }
    this.state.currentUser.branchId = branchId;
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.branchId = branchId;
    }
    const br = this.state.branches.find((b) => b.id === branchId);
    if (br) {
      this.state.activeBranch = br;
    }
    this.addAuditLog('تغيير الفرع الافتراضي', `تم تغيير الفرع إلى ${br?.name || branchId}`);
    this.setToast(`تم تغيير الفرع الافتراضي إلى ${br?.name || branchId}`);
    this.notify();
  }

  public logoutOtherSessions() {
    if (this.state.currentUser.activeSessions) {
      this.state.currentUser.activeSessions = this.state.currentUser.activeSessions.filter(
        (s) => s.isCurrent
      );
    }
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.activeSessions = this.state.currentUser.activeSessions;
    }
    this.addAuditLog('إغلاق الجلسات الأخرى', 'تم تسجيل الخروج من كل الأجهزة الأخرى');
    this.setToast('تم تسجيل الخروج وإغلاق جميع الجلسات النشطة على الأجهزة الأخرى بنجاح');
    this.notify();
  }

  public toggleThemeMode(mode?: 'dark' | 'light') {
    const newMode = mode || (this.state.currentUser.themeMode === 'light' ? 'dark' : 'light');
    this.state.currentUser.themeMode = newMode;
    const matched = this.state.users.find((u) => u.id === this.state.currentUser.id);
    if (matched) {
      matched.themeMode = newMode;
    }
    this.setToast(`تم تغيير المظهر إلى ${newMode === 'dark' ? 'الوضع الداكن (Dark)' : 'الوضع الفاتح (Light)'}`);
    this.notify();
  }

  public createUser(userData: Partial<User>) {
    const newUser: User = {
      id: `u-${Date.now()}`,
      name: userData.name || 'مستخدم جديد',
      email: userData.email || '',
      phone: userData.phone || '',
      role: userData.role || 'Cashier',
      branchId: userData.branchId || this.state.activeBranch.id,
      avatarUrl: userData.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=200',
      permissions: ROLE_PERMISSIONS_MAP[userData.role || 'Cashier'] || [],
      isActive: true,
      lastLogin: new Date().toISOString(),
      jobTitle: userData.jobTitle || 'موظف',
      ...userData,
    };

    this.state.users.push(newUser);
    this.addAuditLog('إضافة مستخدم', `إضافة المستخدم ${newUser.name} بدور ${newUser.role}`);
    this.setToast(`تم إضافة المستخدم ${newUser.name} بنجاح`);
    this.notify();
  }

  public updateUser(id: string, updates: Partial<User>) {
    const u = this.state.users.find((user) => user.id === id);
    if (!u) return;

    if (updates.role && updates.role !== u.role) {
      updates.permissions = ROLE_PERMISSIONS_MAP[updates.role] || [];
    }

    Object.assign(u, updates);
    if (u.id === this.state.currentUser.id) {
      Object.assign(this.state.currentUser, updates);
    }

    this.addAuditLog('تعديل مستخدم', `تعديل مستخدم ${u.name}`);
    this.setToast(`تم تحديث بيانات المستخدم ${u.name}`);
    this.notify();
  }

  public disableUser(id: string) {
    const u = this.state.users.find((user) => user.id === id);
    if (!u) return;
    if (u.id === this.state.currentUser.id) {
      this.setToast('لا يمكنك تعطيل حسابك الحالي بنفسك!', 'error');
      return;
    }
    u.isActive = !u.isActive;
    const statusText = u.isActive ? 'تفعيل' : 'تعطيل';
    this.addAuditLog(`${statusText} مستخدم`, `تم ${statusText} حساب ${u.name}`);
    this.setToast(`تم ${statusText} حساب ${u.name}`);
    this.notify();
  }

  public resetUserPassword(id: string) {
    const u = this.state.users.find((user) => user.id === id);
    if (!u) return;
    this.setToast(`تم إرسال رابط إعادة تعيين كلمة المرور إلى ${u.email || u.phone}`);
    this.notify();
  }

  public updateOrder(orderId: string, updates: Partial<Order>) {
    const ord = this.state.orders.find((o) => o.id === orderId);
    if (!ord) return;

    Object.assign(ord, updates);
    ord.updatedAt = new Date().toISOString();
    this.addAuditLog('تعديل طلب', `تعديل بيانات الطلب ${ord.orderNumber}`);
    this.setToast(`تم تحديث بيانات الطلب ${ord.orderNumber}`);
    this.notify();
  }

  // --- POS Sale Execution ---

  public async createPosSale(
    items: Order['items'],
    customerId: string | undefined,
    customerName: string,
    paymentMethod: PaymentMethod,
    discountAmount: number,
    amountReceived: number,
    idempotencyKey: string
  ) {
    const warehouseId =
      items
        .map((item) => this.state.products.find((p) => p.id === item.productId))
        .find((product) => product?.warehouseId)?.warehouseId ||
      this.state.warehouses[0]?.id;

    const result = await createPosSaleInSupabase({
      warehouseId,
      branchId: this.state.activeBranch?.id || undefined,
      customerId,
      customerName,
      paymentMethod,
      items,
      discountJod: discountAmount,
      amountReceivedJod: amountReceived,
      idempotencyKey,
    });

    if (!result.success || !result.data) {
      this.setToast(result.error || 'فشلت عملية البيع المباشر.', 'error');
      return { success: false, error: result.error };
    }

    const sale = result.data;
    let publicReceiptUrl: string | undefined;
    try {
      publicReceiptUrl = await getOrCreatePublicPosReceiptUrlFromSupabase(
        sale.orderId
      );
    } catch (receiptLinkError) {
      console.error('Unable to create the public POS receipt link:', receiptLinkError);
    }
    const invoiceItems: OrderItem[] = sale.items.map((item) => {
      const product = this.state.products.find(
        (candidate) => candidate.id === item.productId
      );
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productImage: product?.imageUrl || '',
        sku: item.sku,
        unit: item.salePackage || product?.salePackage || 'طرد',
        unitPrice: item.unitPrice,
        costPrice: product?.costPrice || 0,
        quantity: item.quantity,
        baseQuantity: item.baseQuantity,
        unitsPerSalePackage: item.unitsPerSalePackage,
        salePackage: item.salePackage,
        discount: 0,
        totalPrice: item.totalPrice,
      };
    });

    const invoice: Invoice = {
      id: sale.orderId,
      invoiceNumber: sale.orderNumber,
      orderId: sale.orderId,
      customerName: sale.customerName,
      items: invoiceItems,
      subtotal: sale.subtotal,
      discount: sale.discount,
      taxAmount: 0,
      totalAmount: sale.totalAmount,
      paidAmount: sale.paidAmount,
      remainingAmount: Math.max(0, sale.totalAmount - sale.paidAmount),
      paymentMethod: sale.paymentMethod,
      status: 'posted',
      branchId: sale.branchId || this.state.activeBranch?.id || '',
      createdById: this.state.currentUser.id,
      createdByName: this.state.currentUser.name,
      createdAt: new Date().toISOString(),
      publicReceiptUrl,
    };

    await Promise.all([
      this.refreshProductsFromSupabase(),
      this.refreshOrdersFromSupabase(),
      this.refreshInventoryMovementsFromSupabase(),
      this.refreshStockNotificationsFromSupabase(),
    ]);
    this.setToast(`تم البيع وخصم المخزون: ${sale.orderNumber}`);

    return {
      success: true,
      data: {
        ...invoice,
        changeDue: sale.changeDue,
        idempotentReplay: sale.idempotentReplay,
      },
    };
  }

  // --- Record Payment (سند قبض / سند صرف) ---

  public recordCustomerPayment(
    customerId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    notes?: string
  ) {
    const cust = this.state.customers.find((c) => c.id === customerId);
    if (!cust) return;

    cust.currentBalance = Math.max(0, cust.currentBalance - amount);
    const voucherNo = `REC-${Math.floor(10000 + Math.random() * 90000)}`;

    const pay: CustomerPayment = {
      id: `pay-${Date.now()}`,
      voucherNumber: voucherNo,
      customerId: cust.id,
      customerName: cust.name,
      amount,
      paymentMethod,
      notes,
      date: new Date().toISOString(),
      createdByName: this.state.currentUser.name,
    };

    this.state.customerPayments.unshift(pay);

    if (this.state.currentShift && paymentMethod === 'cash') {
      this.state.currentShift.totalReceipts += amount;
      this.state.currentShift.expectedCash += amount;
    }

    this.addAuditLog('سند قبض', `تسجيل دفعة من العميل ${cust.name} بقيمة ${amount} د.أ`);
    this.setToast(`تم تسجيل سند القبض ${voucherNo} بمبلغ ${amount} د.أ`);
    this.notify();
  }

  public recordSupplierPayment(
    supplierId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    notes?: string
  ) {
    const sup = this.state.suppliers.find((s) => s.id === supplierId);
    if (!sup) return;

    sup.currentBalance = Math.max(0, sup.currentBalance - amount);
    const voucherNo = `PAY-${Math.floor(10000 + Math.random() * 90000)}`;

    const pay: SupplierPayment = {
      id: `pay-${Date.now()}`,
      voucherNumber: voucherNo,
      supplierId: sup.id,
      supplierName: sup.companyName,
      amount,
      paymentMethod,
      notes,
      date: new Date().toISOString(),
      createdByName: this.state.currentUser.name,
    };

    this.state.supplierPayments.unshift(pay);

    if (this.state.currentShift && paymentMethod === 'cash') {
      this.state.currentShift.totalPayments += amount;
      this.state.currentShift.expectedCash -= amount;
    }

    this.addAuditLog('سند صرف', `تسجيل دفعة للمورد ${sup.companyName} بقيمة ${amount} د.أ`);
    this.setToast(`تم تسجيل سند الصرف ${voucherNo} بمبلغ ${amount} د.أ`);
    this.notify();
  }

  // --- Expenses ---

  public async addExpense(
    category: string,
    amount: number,
    description: string,
    paymentMethod: 'cash' | 'cliq',
    referenceNumber?: string
  ) {
    try {
      const result = await createOperationalExpenseInSupabase({
        branchId: this.state.activeBranch.id,
        category,
        amount,
        description,
        paymentMethod,
        referenceNumber,
      });
      await this.refreshExpenseShiftCenterFromSupabase();
      this.setToast(result.message, 'success');
      return true;
    } catch (error) {
      // The screen can briefly hold an old shift after another device closes it.
      // Refresh before showing the operational message so the next action uses
      // the canonical server state rather than stale React state.
      const message =
        error instanceof Error ? error.message : 'تعذر تسجيل المصروف.';
      if (message.includes('افتح وردية الصندوق')) {
        await this.refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
        this.setToast(
          'لا توجد وردية مفتوحة الآن. افتح وردية الصندوق ثم سجّل المصروف.',
          'info'
        );
        return false;
      }
      this.setToast(
        message,
        'error'
      );
      return false;
    }
  }

  // --- Close Shift ---

  public async closeShift(actualCash: number, discrepancyReason?: string) {
    if (!this.state.currentShift) {
      this.setToast('لا توجد وردية مفتوحة لإغلاقها.', 'error');
      return false;
    }

    try {
      const result = await closeCashShiftInSupabase(
        this.state.currentShift.id,
        actualCash,
        discrepancyReason
      );
      await this.refreshExpenseShiftCenterFromSupabase();
      this.setToast(result.message, 'success');
      return true;
    } catch (error) {
      this.setToast(
        error instanceof Error ? error.message : 'تعذر إغلاق الوردية.',
        'error'
      );
      return false;
    }
  }

  public async cancelEmptyShift(reason: string) {
    if (!this.state.currentShift) {
      this.setToast('لا توجد وردية مفتوحة لإلغائها.', 'error');
      return false;
    }

    try {
      const result = await cancelEmptyCashShiftInSupabase(
        this.state.currentShift.id,
        reason
      );
      await this.refreshExpenseShiftCenterFromSupabase();
      this.setToast(result.message, 'success');
      return true;
    } catch (error) {
      this.setToast(
        error instanceof Error ? error.message : 'تعذر إلغاء الوردية.',
        'error'
      );
      return false;
    }
  }

  public async openShift(openingCash: number) {
    try {
      const result = await openCashShiftInSupabase(
        this.state.activeBranch.id,
        openingCash
      );
      await this.refreshExpenseShiftCenterFromSupabase();
      this.setToast(result.message, 'success');
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'تعذر فتح الوردية.';

      // Opening a shift from two quick taps (or a second device) can race with
      // the database's one-open-shift guard. The server is correct to reject
      // the duplicate insert; reload its result and keep the operator working
      // on the already-open shift instead of exposing a misleading error.
      const isExistingOpenShift =
        message.includes('توجد وردية مفتوحة بالفعل') ||
        message.includes('idx_cash_shifts_one_open_per_branch') ||
        /duplicate key/i.test(message);
      if (isExistingOpenShift) {
        await this.refreshExpenseShiftCenterFromSupabase().catch(() => undefined);
        if (this.state.currentShift) {
          this.setToast(
            `الوردية ${this.state.currentShift.shiftNumber} مفتوحة بالفعل وتم تحديث الشاشة.`,
            'info'
          );
          return true;
        }
      }

      this.setToast(
        message,
        'error'
      );
      return false;
    }
  }

}

export const storeEngine = new StoreEngine();

export function useAppStore() {
  const [state, setState] = useState<AppState>(storeEngine.getState());

  useEffect(() => {
    const unsubscribe = storeEngine.subscribe(() => {
      setState({ ...storeEngine.getState() });
    });
    return unsubscribe;
  }, []);

  return {
    ...state,
    setToast: (
      msg: string | { message?: string; type?: 'success' | 'error' | 'info' },
      type?: 'success' | 'error' | 'info'
    ) => storeEngine.setToast(msg, type),
    setActiveTab: (tab: AppState['activeTab']) => storeEngine.setActiveTab(tab),
    openCustomerProfile: (customerId: string) =>
      storeEngine.openCustomerProfile(customerId),
    clearCustomerNavigationTarget: () =>
      storeEngine.clearCustomerNavigationTarget(),
    toggleQuickAction: (open?: boolean) => storeEngine.toggleQuickAction(open),
    openModal: (m: string, data?: any) => storeEngine.openModal(m, data),
    closeModal: () => storeEngine.closeModal(),
    setActiveBranch: (bId: string) => storeEngine.setActiveBranch(bId),
    toggleBiometrics: () => storeEngine.toggleBiometrics(),
    lockWithFaceId: () => storeEngine.lockWithFaceId(),
    unlockFaceId: () => storeEngine.unlockFaceId(),
    clearFaceIdLockForPasswordSignIn: () =>
      storeEngine.clearFaceIdLockForPasswordSignIn(),
    confirmOrder: (orderId: string, notes?: string) => storeEngine.confirmOrder(orderId, notes),
    cancelOrder: (orderId: string, reason?: string) =>
      storeEngine.cancelOrder(orderId, reason),
    completeWebsiteOrderWithPayment: (
      orderId: string,
      paymentMethod: 'cash' | 'cliq',
      referenceNumber?: string,
      notes?: string
    ) =>
      storeEngine.completeWebsiteOrderWithPayment(
        orderId,
        paymentMethod,
        referenceNumber,
        notes
      ),
    completeWebsiteOrderWithSettlement: (input: {
      orderId: string;
      paymentMethod: 'cash' | 'cliq' | 'debt';
      amountCollected: number;
      deliveryFee: number;
      referenceNumber?: string;
      notes?: string;
    }) => storeEngine.completeWebsiteOrderWithSettlement(input),
    returnCompletedWebsiteOrder: (input: {
      orderId: string;
      reason: string;
      stockDisposition: 'restock' | 'damaged';
      refundMethod: 'cash' | 'cliq';
      referenceNumber?: string;
      notes?: string;
    }) => storeEngine.returnCompletedWebsiteOrder(input),
    advanceOrderStatus: (orderId: string, status: OrderStatus, notes?: string) =>
      storeEngine.advanceOrderStatus(orderId, status, notes),
    startOrUpdateOrderDelivery: (
      orderId: string,
      etaMinutes: number,
      driverPhone: string,
      notes?: string
    ) =>
      storeEngine.startOrUpdateOrderDelivery(
        orderId,
        etaMinutes,
        driverPhone,
        notes
      ),
    refreshOrdersFromSupabase: () => storeEngine.refreshOrdersFromSupabase(),
    refreshProductsFromSupabase: () => storeEngine.refreshProductsFromSupabase(),
    refreshCategoriesFromSupabase: () =>
      storeEngine.refreshCategoriesFromSupabase(),
    refreshBrandsFromSupabase: () => storeEngine.refreshBrandsFromSupabase(),
    refreshUnitsFromSupabase: () => storeEngine.refreshUnitsFromSupabase(),
    refreshInventoryMovementsFromSupabase: () =>
      storeEngine.refreshInventoryMovementsFromSupabase(),
    refreshExpenseShiftCenterFromSupabase: () =>
      storeEngine.refreshExpenseShiftCenterFromSupabase(),
    refreshStockNotificationsFromSupabase: () =>
      storeEngine.refreshStockNotificationsFromSupabase(),
    markNotificationRead: (notificationId: string) =>
      storeEngine.markNotificationRead(notificationId),
    markAllNotificationsRead: () => storeEngine.markAllNotificationsRead(),
    addProduct: (data: Partial<Product>) => storeEngine.addProduct(data),
    updateProduct: (id: string, updates: Partial<Product>) => storeEngine.updateProduct(id, updates),
    deleteProduct: (id: string) => storeEngine.deleteProduct(id),
    hideProduct: (id: string) => storeEngine.hideProduct(id),
    duplicateProduct: (id: string) => storeEngine.duplicateProduct(id),
    adjustStock: (pId: string, newQty: number, reason: string) => storeEngine.adjustStock(pId, newQty, reason),
    recordStockMovement: (params: any) => storeEngine.recordStockMovement(params),
    receiveGoods: (params: any) => storeEngine.receiveGoods(params),
    transferWarehouse: (params: any) => storeEngine.transferWarehouse(params),
    executeStockCount: (params: any) => storeEngine.executeStockCount(params),
    
    addCategory: (data: Partial<Category>) => storeEngine.addCategory(data),
    updateCategory: (id: string, updates: Partial<Category>) => storeEngine.updateCategory(id, updates),
    deleteCategory: (id: string) => storeEngine.deleteCategory(id),
    setCategoryActive: (id: string, isActive: boolean) =>
      storeEngine.setCategoryActive(id, isActive),

    addBrand: (data: Partial<Brand>) => storeEngine.addBrand(data),
    updateBrand: (id: string, updates: Partial<Brand>) => storeEngine.updateBrand(id, updates),
    deleteBrand: (id: string) => storeEngine.deleteBrand(id),
    setBrandActive: (id: string, isActive: boolean) =>
      storeEngine.setBrandActive(id, isActive),

    addUnit: (data: Partial<UnitDefinition>) => storeEngine.addUnit(data),
    updateUnit: (id: string, updates: Partial<UnitDefinition>) => storeEngine.updateUnit(id, updates),
    deleteUnit: (id: string) => storeEngine.deleteUnit(id),
    setUnitActive: (id: string, isActive: boolean) =>
      storeEngine.setUnitActive(id, isActive),

    getCurrentProfile: () => storeEngine.getCurrentProfile(),
    setCurrentUser: (userUpdates: Partial<User>) => storeEngine.setCurrentUser(userUpdates),
    updateProfile: (updates: Partial<User>) => storeEngine.updateProfile(updates),
    updateProfilePhoto: (avatarUrl: string) => storeEngine.updateProfilePhoto(avatarUrl),
    updatePhone: (newPhone: string) => storeEngine.updatePhone(newPhone),
    updateEmail: (newEmail: string) => storeEngine.updateEmail(newEmail),
    changePassword: (oldPass: string, newPass: string) => storeEngine.changePassword(oldPass, newPass),
    toggleFaceId: () => storeEngine.toggleFaceId(),
    updateNotificationPreferences: (settings: any) => storeEngine.updateNotificationPreferences(settings),
    updateNotificationSettings: (settings: any) => storeEngine.updateNotificationPreferences(settings),
    updateDefaultBranch: (branchId: string) => storeEngine.updateDefaultBranch(branchId),
    logoutOtherSessions: () => storeEngine.logoutOtherSessions(),
    toggleThemeMode: (mode?: 'dark' | 'light') => storeEngine.toggleThemeMode(mode),

    createUser: (userData: Partial<User>) => storeEngine.createUser(userData),
    updateUser: (id: string, updates: Partial<User>) => storeEngine.updateUser(id, updates),
    disableUser: (id: string) => storeEngine.disableUser(id),
    resetUserPassword: (id: string) => storeEngine.resetUserPassword(id),

    updateOrder: (orderId: string, updates: Partial<Order>) => storeEngine.updateOrder(orderId, updates),
    createPosSale: (
      items: Order['items'],
      customerId: string | undefined,
      customerName: string,
      payMethod: PaymentMethod,
      discount: number,
      amountReceived: number,
      idempotencyKey: string
    ) =>
      storeEngine.createPosSale(
        items,
        customerId,
        customerName,
        payMethod,
        discount,
        amountReceived,
        idempotencyKey
      ),
    recordCustomerPayment: (cId: string, amt: number, method: PaymentMethod, notes?: string) =>
      storeEngine.recordCustomerPayment(cId, amt, method, notes),
    recordSupplierPayment: (sId: string, amt: number, method: PaymentMethod, notes?: string) =>
      storeEngine.recordSupplierPayment(sId, amt, method, notes),
    addExpense: (
      cat: string,
      amt: number,
      desc: string,
      method: 'cash' | 'cliq',
      referenceNumber?: string
    ) => storeEngine.addExpense(cat, amt, desc, method, referenceNumber),
    closeShift: (actualCash: number, reason?: string) =>
      storeEngine.closeShift(actualCash, reason),
    cancelEmptyShift: (reason: string) => storeEngine.cancelEmptyShift(reason),
    openShift: (openingCash: number) => storeEngine.openShift(openingCash),
  };
}
