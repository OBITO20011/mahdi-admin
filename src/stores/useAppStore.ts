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
  OrderStatus,
  PaymentMethod,
  Product,
  Role,
  Shift,
  Supplier,
  SupplierPayment,
  SyncQueueItem,
  UnitDefinition,
  User,
  Warehouse,
  Account,
  JournalEntry,
} from '../types';
import {
  DEFAULT_BRANCHES,
  DEFAULT_WAREHOUSES,
  DEFAULT_CATEGORIES,
  DEFAULT_CHART_OF_ACCOUNTS,
  ROLE_PERMISSIONS_MAP,
} from '../constants';
import {
  INITIAL_CUSTOMERS,
  INITIAL_EXPENSES,
  INITIAL_INVOICES,
  INITIAL_ORDERS,
  INITIAL_PRODUCTS,
  INITIAL_SHIFT,
  INITIAL_SUPPLIERS,
  INITIAL_USERS,
} from '../services/mockData';
import { isSupabaseConfigured, sanitizedSupabaseUrl, sanitizedSupabaseKey, isValidSupabaseUrl } from '../lib/supabase';
import {
  fetchProductsFromSupabase,
  createProductWithOpeningStockInSupabase,
  SupabaseFetchError,
} from '../services/supabase/products.service';
import { receiveInventoryInSupabase } from '../services/supabase/inventory.service';
import {
  fetchCategoriesFromSupabase,
  fetchBrandsFromSupabase,
  fetchUnitsFromSupabase,
  fetchBranchesFromSupabase,
  fetchWarehousesFromSupabase,
} from '../services/supabase/reference-data.service';
import {
  fetchOrdersFromSupabase,
  confirmOrderInSupabase,
  completeOrderInSupabase,
  cancelOrderInSupabase,
  updateOrderStatusInSupabase,
} from '../services/supabase/orders.service';

const STORAGE_KEY = 'nawasrah_bm_state_v1';

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
  movements: InventoryMovement[];
  accounts: Account[];
  journalEntries: JournalEntry[];
  customerPayments: CustomerPayment[];
  supplierPayments: SupplierPayment[];
  notifications: NotificationItem[];
  auditLogs: AuditLog[];
  syncQueue: SyncQueueItem[];

  // App UI State
  isOffline: boolean;
  isQuickActionOpen: boolean;
  activeTab: 'home' | 'orders' | 'products' | 'accounts' | 'more' | 'dashboard' | 'pos' | 'inventory' | 'accounting' | 'expenses' | 'shifts' | 'reports' | 'users' | 'system_test' | 'purchases';
  currentModal: string | null;
  modalData: any;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;

  // Simulator & Adapter Mode
  databaseMode: 'mock' | 'supabase';
  isProductsLoading: boolean;
  productsSource: 'supabase' | 'mock';
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
          ...parsed,
          currentUser: parsed.currentUser || initial.currentUser,
          users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : initial.users,
          activeBranch: parsed.activeBranch || initial.activeBranch,
          branches: Array.isArray(parsed.branches) && parsed.branches.length > 0 ? parsed.branches : initial.branches,
          products: Array.isArray(parsed.products) ? parsed.products : initial.products,
          categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : initial.categories,
          brands: Array.isArray(parsed.brands) && parsed.brands.length > 0 ? parsed.brands : initial.brands,
          units: Array.isArray(parsed.units) && parsed.units.length > 0 ? parsed.units : initial.units,
          orders: Array.isArray(parsed.orders)
            ? parsed.orders.map((o: any) => ({
                ...o,
                items: Array.isArray(o?.items) ? o.items : [],
                statusHistory: Array.isArray(o?.statusHistory) ? o.statusHistory : [],
              }))
            : initial.orders,
          invoices: Array.isArray(parsed.invoices) ? parsed.invoices : initial.invoices,
          customers: Array.isArray(parsed.customers) ? parsed.customers : initial.customers,
          suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : initial.suppliers,
          expenses: Array.isArray(parsed.expenses) ? parsed.expenses : initial.expenses,
          currentShift: parsed.currentShift !== undefined ? parsed.currentShift : initial.currentShift,
          movements: Array.isArray(parsed.movements) ? parsed.movements : initial.movements,
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : initial.accounts,
          journalEntries: Array.isArray(parsed.journalEntries) ? parsed.journalEntries : initial.journalEntries,
          customerPayments: Array.isArray(parsed.customerPayments) ? parsed.customerPayments : initial.customerPayments,
          supplierPayments: Array.isArray(parsed.supplierPayments) ? parsed.supplierPayments : initial.supplierPayments,
          notifications: Array.isArray(parsed.notifications) ? parsed.notifications : initial.notifications,
          auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : initial.auditLogs,
          syncQueue: Array.isArray(parsed.syncQueue) ? parsed.syncQueue : initial.syncQueue,
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
          if (categories && categories.length > 0) this.state.categories = categories;

          const brands = await fetchBrandsFromSupabase();
          if (brands && brands.length > 0) this.state.brands = brands;

          const units = await fetchUnitsFromSupabase();
          if (units && units.length > 0) this.state.units = units;

          const branches = await fetchBranchesFromSupabase();
          if (branches && branches.length > 0) this.state.branches = branches;

          const warehouses = await fetchWarehousesFromSupabase();
          if (warehouses && warehouses.length > 0) this.state.warehouses = warehouses;
        }
      }
    } catch (err: any) {
      console.error('[Store refreshProductsFromSupabase Exception]:', err);
      this.state.productsSource = isSupabaseConfigured ? 'supabase' : 'mock';
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

  private getInitialState(): AppState {
    return {
      currentUser: INITIAL_USERS[0],
      users: INITIAL_USERS,
      activeBranch: DEFAULT_BRANCHES[0],
      branches: DEFAULT_BRANCHES,
      warehouses: DEFAULT_WAREHOUSES,
      isBiometricsEnabled: true,
      isLockedWithFaceId: false,

      products: INITIAL_PRODUCTS,
      categories: DEFAULT_CATEGORIES,
      brands: [
        { id: 'b-1', nameAr: 'شركة دكّان للحلويات', logoUrl: 'https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&q=80&w=100' },
        { id: 'b-2', nameAr: 'مزارع مزمز للمياه النقية', logoUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&q=80&w=100' },
        { id: 'b-3', nameAr: 'الأردنية للتوربو وقطع السيارات' },
      ],
      units: [
        { id: 'u-piece', nameAr: 'قطعة', code: 'PCS', conversionFactor: 1, isSystem: true },
        { id: 'u-packet', nameAr: 'باكيت', code: 'PKT', conversionFactor: 12, isSystem: true },
        { id: 'u-carton', nameAr: 'كرتونة', code: 'CTN', conversionFactor: 144, isSystem: true },
      ],
      orders: INITIAL_ORDERS,
      invoices: INITIAL_INVOICES,
      customers: INITIAL_CUSTOMERS,
      suppliers: INITIAL_SUPPLIERS,
      expenses: INITIAL_EXPENSES,
      currentShift: INITIAL_SHIFT,
      movements: [],
      accounts: DEFAULT_CHART_OF_ACCOUNTS,
      journalEntries: [],
      customerPayments: [],
      supplierPayments: [],
      notifications: [
        {
          id: 'notif-1',
          title: 'طلب جديد من موقع الزبائن',
          message: 'تم استلام طلب جديد #1025 من عبدالرحمن الباسم بقيمة 23.70 د.أ',
          type: 'order',
          read: false,
          createdAt: new Date().toISOString(),
          targetScreen: 'orders',
          targetId: 'ord-1025',
        },
        {
          id: 'notif-2',
          title: 'تنبيه مخزون منخفض',
          message: 'فستق حلبي محمص فاخر 500غ أصبح 8 باكيت فقط (تحت حد إعادة الطلب 10)',
          type: 'stock',
          read: false,
          createdAt: new Date().toISOString(),
          targetScreen: 'products',
        },
      ],
      auditLogs: [
        {
          id: 'log-1',
          timestamp: new Date().toISOString(),
          userId: 'u-owner-1',
          userName: 'أحمد النواصرة',
          action: 'تسجيل دخول ناجح',
          details: 'تم الدخول إلى النظام عبر فرع عمان الرئيسي',
        },
      ],
      syncQueue: [],

      isOffline: false,
      isQuickActionOpen: false,
      activeTab: 'home',
      currentModal: null,
      modalData: null,
      toast: null,
      databaseMode: isSupabaseConfigured ? 'supabase' : 'mock',
      isProductsLoading: false,
      productsSource: isSupabaseConfigured ? 'supabase' : 'mock',
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this.listeners.forEach((fn) => fn());
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
    }
  }

  public setCurrentUser(userUpdates: Partial<User>) {
    this.state.currentUser = {
      ...this.state.currentUser,
      ...userUpdates,
      permissions: userUpdates.role
        ? ROLE_PERMISSIONS_MAP[userUpdates.role] || this.state.currentUser.permissions
        : this.state.currentUser.permissions,
    };
    this.notify();
  }

  public switchRole(role: Role) {
    this.state.currentUser.role = role;
    this.state.currentUser.permissions = ROLE_PERMISSIONS_MAP[role] || [];
    this.addAuditLog('تغيير الدور', `تم تحويل الدور إلى ${role}`);
    this.setToast(`تم تغيير الدور الحالي إلى: ${role}`, 'info');
    this.notify();
  }

  public toggleBiometrics() {
    this.state.isBiometricsEnabled = !this.state.isBiometricsEnabled;
    this.setToast(
      this.state.isBiometricsEnabled ? 'تم تفعيل Face ID بنجاح' : 'تم إيقاف Face ID'
    );
    this.notify();
  }

  public lockWithFaceId() {
    this.state.isLockedWithFaceId = true;
    this.notify();
  }

  public unlockFaceId() {
    this.state.isLockedWithFaceId = false;
    this.setToast('تم التأكد من الهوية بواسطة Face ID');
    this.notify();
  }

  public toggleOfflineMode() {
    this.state.isOffline = !this.state.isOffline;
    if (this.state.isOffline) {
      this.setToast('تنبيه: أنت الآن تعمل في الوضع المحلي (Offline Mode)', 'info');
    } else {
      this.syncPendingQueue();
      this.setToast('تم الاتصال بالإنترنت ومزامنة البيانات مع السيرفر');
    }
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

  public async advanceOrderStatus(orderId: string, nextStatus: OrderStatus, notes?: string) {
    if (isSupabaseConfigured) {
      let res;
      if (nextStatus === 'delivered' || nextStatus === 'completed') {
        res = await completeOrderInSupabase(orderId, notes);
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

    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return;

    // If changing to delivered / sale completed: deduct actual onHand and release reservation
    if (nextStatus === 'delivered' && order.status !== 'delivered') {
      order.items.forEach((item) => {
        const prod = this.state.products.find((p) => p.id === item.productId);
        if (prod) {
          const prevOnHand = prod.onHandQuantity;
          prod.onHandQuantity = Math.max(0, prod.onHandQuantity - item.quantity);
          prod.reservedQuantity = Math.max(0, prod.reservedQuantity - item.quantity);
          prod.availableQuantity = prod.onHandQuantity - prod.reservedQuantity;

          this.state.movements.unshift({
            id: `mov-${Date.now()}-${Math.random()}`,
            productId: prod.id,
            productName: prod.nameAr,
            branchId: this.state.activeBranch.id,
            warehouseId: 'w-main',
            movementType: 'Sale',
            previousQuantity: prevOnHand,
            quantityChange: -item.quantity,
            newQuantity: prod.onHandQuantity,
            reason: `تسليم مبيعات الطلب ${order.orderNumber}`,
            performedByUserId: this.state.currentUser.id,
            performedByUserName: this.state.currentUser.name,
            timestamp: new Date().toISOString(),
            referenceId: order.id,
          });
        }
      });

      // Automatically generate Invoice & Journal Entry
      this.createInvoiceFromOrder(order);
    }

    order.status = nextStatus;
    order.statusHistory.push({
      status: nextStatus,
      changedAt: new Date().toISOString(),
      changedBy: this.state.currentUser.name,
    });

    this.setToast(`تم تحديث حالة الطلب ${order.orderNumber}`);
    this.notify();
  }

  private createInvoiceFromOrder(order: Order) {
    const invNumber = `INV-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    const tax = Number((order.subtotal * 0.16).toFixed(2));
    const newInv: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber: invNumber,
      orderId: order.id,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      items: order.items,
      subtotal: order.subtotal,
      discount: order.discount,
      taxAmount: tax,
      totalAmount: order.totalAmount,
      paidAmount: order.paymentStatus === 'paid' ? order.totalAmount : 0,
      remainingAmount: order.paymentStatus === 'paid' ? 0 : order.totalAmount,
      paymentMethod: order.paymentMethod,
      status: 'posted',
      branchId: order.branchId,
      createdById: this.state.currentUser.id,
      createdByName: this.state.currentUser.name,
      createdAt: new Date().toISOString(),
    };
    this.state.invoices.unshift(newInv);

    // If debt, update customer balance
    if (order.paymentMethod === 'debt' || order.paymentStatus !== 'paid') {
      const cust = this.state.customers.find((c) => c.name === order.customerName);
      if (cust) {
        cust.currentBalance += order.totalAmount;
      }
    }
  }

  // --- Product CRUD & Operations ---

  public async addProduct(productData: Partial<Product>): Promise<{
    success: boolean;
    productId?: string;
    error?: string;
    errorDetails?: any;
  }> {
    const openingQty = Number(productData.onHandQuantity) || 0;
    const targetBranchId = productData.branchId || this.state.activeBranch?.id || 'b-amman-main';
    const targetWarehouseId = productData.warehouseId || 'w-main';

    if (isSupabaseConfigured) {
      try {
        const unitObj = this.state.units.find((u) => u.nameAr === productData.unit || u.id === productData.unit);
        const res = await createProductWithOpeningStockInSupabase({
          sku: productData.sku || `NWS-${Math.floor(1000 + Math.random() * 9000)}`,
          barcode: productData.barcode || `625${Math.floor(1000000000 + Math.random() * 9000000000)}`,
          nameAr: productData.nameAr || 'منتج جديد',
          description: productData.description || '',
          categoryId: productData.categoryId,
          brandId: productData.brandId,
          unitId: unitObj?.id,
          costPrice: Number(productData.costPrice) || 0,
          retailPrice: Number(productData.retailPrice) || 0,
          reorderLevel: Number(productData.reorderLevel) || 5,
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

  public updateProduct(id: string, updates: Partial<Product>) {
    const prodIndex = this.state.products.findIndex((p) => p.id === id);
    if (prodIndex === -1) return;

    const current = this.state.products[prodIndex];
    const newOnHand = updates.onHandQuantity !== undefined ? updates.onHandQuantity : current.onHandQuantity;
    const newReserved = updates.reservedQuantity !== undefined ? updates.reservedQuantity : current.reservedQuantity;
    const newAvailable = Math.max(0, newOnHand - newReserved);

    const updatedProd: Product = {
      ...current,
      ...updates,
      onHandQuantity: newOnHand,
      reservedQuantity: newReserved,
      availableQuantity: newAvailable,
      updatedAt: new Date().toISOString(),
      lastModifiedBy: this.state.currentUser.name,
    };

    this.state.products[prodIndex] = updatedProd;
    this.addAuditLog('تعديل منتج', `تعديل بيانات المنتج ${updatedProd.nameAr}`);
    this.setToast(`تم تحديث بيانات المنتج ${updatedProd.nameAr} بنجاح`);
    this.notify();
  }

  public deleteProduct(id: string) {
    const prod = this.state.products.find((p) => p.id === id);
    if (!prod) return;

    this.state.products = this.state.products.filter((p) => p.id !== id);
    this.addAuditLog('حذف منتج', `تم حذف المنتج ${prod.nameAr} (${prod.sku})`);
    this.setToast(`تم حذف المنتج ${prod.nameAr} بنجاح`);
    this.notify();
  }

  public hideProduct(id: string) {
    const prod = this.state.products.find((p) => p.id === id);
    if (!prod) return;

    prod.status = prod.status === 'hidden' ? 'active' : 'hidden';
    prod.updatedAt = new Date().toISOString();
    prod.lastModifiedBy = this.state.currentUser.name;

    const actionText = prod.status === 'hidden' ? 'إخفاء' : 'إظهار';
    this.addAuditLog(`${actionText} منتج`, `تم ${actionText} المنتج ${prod.nameAr}`);
    this.setToast(`تم ${actionText} المنتج ${prod.nameAr}`);
    this.notify();
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
    if (isSupabaseConfigured) {
      try {
        const targetWarehouse = params.warehouseId || this.state.warehouses[0]?.id || 'w-main';
        const res = await receiveInventoryInSupabase({
          productId: params.productId,
          warehouseId: targetWarehouse,
          quantity: params.quantity,
          referenceType: 'purchase_receipt',
          notes: params.notes || `فاتورة مورد #${params.supplierInvoiceNo || ''}`,
        });

        if (res.success) {
          this.addAuditLog('استلام بضاعة', `تم استلام كمية +${params.quantity} في Supabase للمنتج ${params.productId}`);
          this.setToast('تم استلام البضاعة وتحديث الرصيد والمخزون في Supabase بنجاح.');
          await this.refreshProductsFromSupabase();
          return;
        } else {
          console.warn('Supabase receive_inventory returned error, falling back to local state:', res.error);
          this.setToast(`تعذر التحديث في Supabase: ${res.error}. تم التحديث محلياً.`, 'error');
        }
      } catch (err: any) {
        console.warn('Exception during Supabase receiveInventory:', err);
      }
    }

    const prod = this.state.products.find((p) => p.id === params.productId);
    if (!prod) return;

    const previousQuantity = prod.onHandQuantity;
    const newQuantity = previousQuantity + params.quantity;

    prod.onHandQuantity = newQuantity;
    prod.availableQuantity = Math.max(0, newQuantity - prod.reservedQuantity);
    if (params.branchId) prod.branchId = params.branchId;
    if (params.warehouseId) prod.warehouseId = params.warehouseId;
    prod.updatedAt = new Date().toISOString();
    prod.lastModifiedBy = this.state.currentUser.name;

    let reason = `استلام بضاعة (Purchase Receipt) +${params.quantity} ${prod.unit}`;
    if (params.supplierInvoiceNo) {
      reason += ` - فاتورة مورد #${params.supplierInvoiceNo}`;
    }
    if (params.notes) {
      reason += ` (${params.notes})`;
    }

    const movement: InventoryMovement = {
      id: `mov-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: params.branchId || prod.branchId || this.state.activeBranch.id,
      warehouseId: params.warehouseId || prod.warehouseId || 'w-main',
      movementType: 'Purchase Receipt',
      previousQuantity,
      quantityChange: params.quantity,
      newQuantity,
      reason,
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
      referenceId: params.supplierInvoiceNo,
      notes: params.notes,
    };

    this.state.movements.unshift(movement);

    this.addAuditLog('استلام بضاعة', `تم استلام +${params.quantity} ${prod.unit} لـ ${prod.nameAr}. المخزون من ${previousQuantity} إلى ${newQuantity}`);
    this.setToast(`تم استلام البضاعة بنجاح: ${prod.nameAr} (قبل الاستلام: ${previousQuantity} ← بعد الاستلام: ${newQuantity})`);
    this.notify();
    return movement;
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

  public executeStockCount(params: {
    productId: string;
    actualQuantity: number;
    reason?: string;
    warehouseId?: string;
  }) {
    const prod = this.state.products.find((p) => p.id === params.productId);
    if (!prod) return;

    const previousQuantity = prod.onHandQuantity;
    const quantityChange = params.actualQuantity - previousQuantity;

    prod.onHandQuantity = params.actualQuantity;
    prod.availableQuantity = Math.max(0, params.actualQuantity - prod.reservedQuantity);
    prod.updatedAt = new Date().toISOString();
    prod.lastModifiedBy = this.state.currentUser.name;

    this.state.movements.unshift({
      id: `mov-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      productId: prod.id,
      productName: prod.nameAr,
      branchId: prod.branchId || this.state.activeBranch.id,
      warehouseId: params.warehouseId || prod.warehouseId || 'w-main',
      movementType: 'Stock Count',
      previousQuantity,
      quantityChange,
      newQuantity: params.actualQuantity,
      reason: params.reason || 'جرد مخزني وتسوية الفروقات',
      performedByUserId: this.state.currentUser.id,
      performedByUserName: this.state.currentUser.name,
      timestamp: new Date().toISOString(),
    });

    this.addAuditLog('جرد مخزني', `تسوية جرد ${prod.nameAr}: سابق ${previousQuantity} ← فعلي ${params.actualQuantity}`);
    this.setToast(`تم الاعتماد وتسوية جرد ${prod.nameAr} إلى ${params.actualQuantity} ${prod.unit}`);
    this.notify();
  }

  // --- Category, Brand & Unit Actions ---

  public addCategory(data: Partial<Category>) {
    const newCat: Category = {
      id: `cat-${Date.now()}`,
      nameAr: data.nameAr || 'قسم جديد',
      nameEn: data.nameEn || '',
      icon: data.icon || 'Package',
      imageUrl: data.imageUrl || '',
      sortOrder: data.sortOrder || this.state.categories.length + 1,
      isHidden: false,
      productsCount: 0,
    };
    this.state.categories.push(newCat);
    this.addAuditLog('إضافة قسم', `إضافة القسم: ${newCat.nameAr}`);
    this.setToast(`تم إضافة القسم ${newCat.nameAr}`);
    this.notify();
  }

  public updateCategory(id: string, updates: Partial<Category>) {
    const cat = this.state.categories.find((c) => c.id === id);
    if (!cat) return;
    Object.assign(cat, updates);
    this.setToast(`تم تحديث القسم ${cat.nameAr}`);
    this.notify();
  }

  public deleteCategory(id: string) {
    const cat = this.state.categories.find((c) => c.id === id);
    if (!cat) return;
    const hasProducts = this.state.products.some((p) => p.categoryId === id);
    if (hasProducts) {
      this.setToast(`لا يمكن حذف القسم "${cat.nameAr}" لأنه يحتوي على منتجات مرتبطة بها!`, 'error');
      return;
    }
    this.state.categories = this.state.categories.filter((c) => c.id !== id);
    this.setToast(`تم حذف القسم ${cat.nameAr}`);
    this.notify();
  }

  public addBrand(data: Partial<Brand>) {
    const newBrand: Brand = {
      id: `brand-${Date.now()}`,
      nameAr: data.nameAr || 'علامة تجارية جديدة',
      nameEn: data.nameEn || '',
      logoUrl: data.logoUrl || '',
    };
    this.state.brands.push(newBrand);
    this.setToast(`تم إضافة العلامة ${newBrand.nameAr}`);
    this.notify();
  }

  public updateBrand(id: string, updates: Partial<Brand>) {
    const brand = this.state.brands.find((b) => b.id === id);
    if (!brand) return;
    Object.assign(brand, updates);
    this.setToast(`تم تحديث العلامة ${brand.nameAr}`);
    this.notify();
  }

  public deleteBrand(id: string) {
    this.state.brands = this.state.brands.filter((b) => b.id !== id);
    this.setToast('تم حذف العلامة التجارية');
    this.notify();
  }

  public addUnit(data: Partial<UnitDefinition>) {
    const newUnit: UnitDefinition = {
      id: `unit-${Date.now()}`,
      nameAr: data.nameAr || 'وحدة جديدة',
      code: data.code || 'UNIT',
      conversionFactor: data.conversionFactor || 1,
      isSystem: false,
    };
    this.state.units.push(newUnit);
    this.setToast(`تم إضافة الوحدة ${newUnit.nameAr}`);
    this.notify();
  }

  public updateUnit(id: string, updates: Partial<UnitDefinition>) {
    const unit = this.state.units.find((u) => u.id === id);
    if (!unit) return;
    Object.assign(unit, updates);
    this.setToast(`تم تحديث الوحدة ${unit.nameAr}`);
    this.notify();
  }

  public deleteUnit(id: string) {
    this.state.units = this.state.units.filter((u) => u.id !== id);
    this.setToast('تم حذف الوحدة');
    this.notify();
  }

  // --- Profile & User Management ---

  public getCurrentProfile(): User {
    return this.state.currentUser;
  }

  public updateProfile(updates: Partial<User>) {
    // Prevent changing role, permissions or isActive from profile form
    const safeUpdates = { ...updates };
    delete (safeUpdates as any).role;
    delete (safeUpdates as any).permissions;
    delete (safeUpdates as any).isActive;

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

  public toggleFaceId() {
    this.state.isBiometricsEnabled = !this.state.isBiometricsEnabled;
    const text = this.state.isBiometricsEnabled ? 'تفعيل' : 'تعطيل';
    this.addAuditLog(`${text} Face ID`, `تم ${text} الأمان ببصمة الوجه`);
    this.setToast(`تم ${text} الأمان ببصمة الوجه Face ID`);
    this.notify();
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

  public createPosSale(
    items: Order['items'],
    customerName: string,
    paymentMethod: PaymentMethod,
    discountAmount: number
  ) {
    const subtotal = items.reduce((acc, i) => acc + i.totalPrice, 0);
    const total = Math.max(0, subtotal - discountAmount);
    const orderNumber = `POS-${Math.floor(100000 + Math.random() * 900000)}`;

    // Deduct stock directly for POS instantaneous sale
    items.forEach((item) => {
      const prod = this.state.products.find((p) => p.id === item.productId);
      if (prod) {
        const prevOnHand = prod.onHandQuantity;
        prod.onHandQuantity = Math.max(0, prod.onHandQuantity - item.quantity);
        prod.availableQuantity = prod.onHandQuantity - prod.reservedQuantity;

        this.state.movements.unshift({
          id: `mov-${Date.now()}-${Math.random()}`,
          productId: prod.id,
          productName: prod.nameAr,
          branchId: this.state.activeBranch.id,
          warehouseId: 'w-main',
          movementType: 'Sale',
          previousQuantity: prevOnHand,
          quantityChange: -item.quantity,
          newQuantity: prod.onHandQuantity,
          reason: `مبيعات نقطة البيع المباشرة POS #${orderNumber}`,
          performedByUserId: this.state.currentUser.id,
          performedByUserName: this.state.currentUser.name,
          timestamp: new Date().toISOString(),
        });
      }
    });

    const inv: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber: `INV-${orderNumber}`,
      customerName: customerName || 'زبون نقدي - نقطة البيع',
      items,
      subtotal,
      discount: discountAmount,
      taxAmount: Number((total * 0.16).toFixed(2)),
      totalAmount: total,
      paidAmount: paymentMethod === 'debt' ? 0 : total,
      remainingAmount: paymentMethod === 'debt' ? total : 0,
      paymentMethod,
      status: 'posted',
      branchId: this.state.activeBranch.id,
      createdById: this.state.currentUser.id,
      createdByName: this.state.currentUser.name,
      createdAt: new Date().toISOString(),
    };

    this.state.invoices.unshift(inv);

    // Update Shift Totals
    if (this.state.currentShift) {
      if (paymentMethod === 'cash') this.state.currentShift.totalCashSales += total;
      if (paymentMethod === 'cliq') this.state.currentShift.totalCliqSales += total;
      if (paymentMethod === 'card') this.state.currentShift.totalCardSales += total;
      this.state.currentShift.expectedCash =
        this.state.currentShift.openingCash +
        this.state.currentShift.totalCashSales +
        this.state.currentShift.totalReceipts -
        this.state.currentShift.totalPayments;
    }

    this.addAuditLog('عملية بيع POS', `تم إنشاء فاتورة مبيعات بمبلغ ${total} د.أ`);
    this.setToast(`تمت عملية البيع بنجاح! رقم الفاتورة: ${inv.invoiceNumber}`);
    this.notify();
    return inv;
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

  public addExpense(category: string, amount: number, description: string, paymentMethod: PaymentMethod) {
    const expNo = `EXP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const newExp: Expense = {
      id: `exp-${Date.now()}`,
      expenseNumber: expNo,
      category,
      amount,
      paymentMethod,
      description,
      isApproved: true,
      approvedBy: this.state.currentUser.name,
      branchId: this.state.activeBranch.id,
      createdByName: this.state.currentUser.name,
      createdAt: new Date().toISOString(),
    };

    this.state.expenses.unshift(newExp);

    if (this.state.currentShift && paymentMethod === 'cash') {
      this.state.currentShift.totalPayments += amount;
      this.state.currentShift.expectedCash -= amount;
    }

    this.addAuditLog('تسجيل مصروف', `تم تسجيل مصروف ${category} بقيمة ${amount} د.أ`);
    this.setToast(`تم تسجيل المصروف ${expNo} بنجاح`);
    this.notify();
  }

  // --- Close Shift ---

  public closeShift(actualCash: number, discrepancyReason?: string) {
    if (!this.state.currentShift) return;

    const shift = this.state.currentShift;
    shift.actualCash = actualCash;
    shift.cashDiscrepancy = Number((actualCash - shift.expectedCash).toFixed(2));
    shift.discrepancyReason = discrepancyReason;
    shift.endTime = new Date().toISOString();
    shift.status = 'closed';
    shift.managerSignOffBy = this.state.currentUser.name;

    this.addAuditLog('إغلاق وردية', `تم إغلاق الوردية ${shift.shiftNumber} بفرق صندوق ${shift.cashDiscrepancy} د.أ`);
    this.setToast(`تم إغلاق الوردية بنجاح. الفرق: ${shift.cashDiscrepancy} د.أ`);

    // Reset current shift or leave closed
    this.state.currentShift = null;
    this.notify();
  }

  public openShift(openingCash: number) {
    const newShiftNumber = `SHF-2026-${Math.floor(100 + Math.random() * 900)}`;
    this.state.currentShift = {
      id: `shf-${Date.now()}`,
      shiftNumber: newShiftNumber,
      branchId: this.state.activeBranch.id,
      cashierName: this.state.currentUser.name,
      startTime: new Date().toISOString(),
      openingCash,
      totalCashSales: 0,
      totalCliqSales: 0,
      totalCardSales: 0,
      totalReceipts: 0,
      totalPayments: 0,
      expectedCash: openingCash,
      status: 'open',
    };

    this.addAuditLog('فتح وردية جديدة', `فتح وردية برصيد افتتاحي ${openingCash} د.أ`);
    this.setToast(`تم فتح وردية جديدة برصيد ${openingCash} د.أ`);
    this.notify();
  }

  // --- Simulator triggers ---

  public simulateNewIncomingWebsiteOrder() {
    const id = `ord-${Math.floor(1000 + Math.random() * 9000)}`;
    const randomCustomer = [
      { name: 'طارق الأطرش', phone: '0791112233', city: 'عمان', region: 'عبدون' },
      { name: 'رانية الكردي', phone: '0789998877', city: 'إربد', region: 'الجامعة' },
      { name: 'سيف النواصرة', phone: '0773332211', city: 'الزرقاء', region: 'البتراوي' },
    ][Math.floor(Math.random() * 3)];

    const newOrd: Order = {
      id,
      orderNumber: `ORD-#${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: randomCustomer.name,
      customerPhone: randomCustomer.phone,
      governorate: randomCustomer.city,
      region: randomCustomer.region,
      address: `شارع الرئيس، بالقرب من دوار ${randomCustomer.region}`,
      items: [
        {
          id: `item-${Date.now()}`,
          productId: this.state.products[0]?.id || 'prod-101',
          productName: this.state.products[0]?.nameAr || 'مياه مزمز فاخرة 330مل (كرتونة)',
          productImage: this.state.products[0]?.imageUrl || '',
          sku: 'NWS-WTR-330',
          unit: 'كرتونة',
          unitPrice: 2.80,
          costPrice: 1.80,
          quantity: 3,
          discount: 0,
          totalPrice: 8.40,
        },
      ],
      subtotal: 8.40,
      discount: 0,
      deliveryFee: 2.00,
      totalAmount: 10.40,
      paymentMethod: 'cliq',
      paymentStatus: 'paid',
      status: 'new',
      branchId: this.state.activeBranch.id,
      isNew: true,
      notes: 'طلب جديد أوتوماتيكي عبر موقع الزبائن الإلكتروني',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: [
        { status: 'new', changedAt: new Date().toISOString(), changedBy: 'موقع الزبائن' },
      ],
    };

    this.state.orders.unshift(newOrd);

    // Push Notification
    this.state.notifications.unshift({
      id: `notif-${Date.now()}`,
      title: '⚡ طلب جديد أونلاين',
      message: `وصل طلب جديد #${newOrd.orderNumber} من ${newOrd.customerName} بقيمة ${newOrd.totalAmount} د.أ`,
      type: 'order',
      read: false,
      createdAt: new Date().toISOString(),
      targetScreen: 'orders',
      targetId: newOrd.id,
    });

    this.setToast(`🔔 وصلنا طلب جديد أونلاين من ${newOrd.customerName}!`, 'info');
    this.notify();
  }

  private syncPendingQueue() {
    this.state.syncQueue.forEach((item) => {
      item.status = 'synced';
    });
    this.state.syncQueue = [];
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
    toggleQuickAction: (open?: boolean) => storeEngine.toggleQuickAction(open),
    openModal: (m: string, data?: any) => storeEngine.openModal(m, data),
    closeModal: () => storeEngine.closeModal(),
    setActiveBranch: (bId: string) => storeEngine.setActiveBranch(bId),
    switchRole: (role: Role) => storeEngine.switchRole(role),
    toggleBiometrics: () => storeEngine.toggleBiometrics(),
    lockWithFaceId: () => storeEngine.lockWithFaceId(),
    unlockFaceId: () => storeEngine.unlockFaceId(),
    toggleOfflineMode: () => storeEngine.toggleOfflineMode(),
    confirmOrder: (orderId: string, notes?: string) => storeEngine.confirmOrder(orderId, notes),
    cancelOrder: (orderId: string, reason?: string) =>
      storeEngine.cancelOrder(orderId, reason),
    advanceOrderStatus: (orderId: string, status: OrderStatus, notes?: string) =>
      storeEngine.advanceOrderStatus(orderId, status, notes),
    refreshOrdersFromSupabase: () => storeEngine.refreshOrdersFromSupabase(),
    refreshProductsFromSupabase: () => storeEngine.refreshProductsFromSupabase(),
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

    addBrand: (data: Partial<Brand>) => storeEngine.addBrand(data),
    updateBrand: (id: string, updates: Partial<Brand>) => storeEngine.updateBrand(id, updates),
    deleteBrand: (id: string) => storeEngine.deleteBrand(id),

    addUnit: (data: Partial<UnitDefinition>) => storeEngine.addUnit(data),
    updateUnit: (id: string, updates: Partial<UnitDefinition>) => storeEngine.updateUnit(id, updates),
    deleteUnit: (id: string) => storeEngine.deleteUnit(id),

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
      custName: string,
      payMethod: PaymentMethod,
      disc: number
    ) => storeEngine.createPosSale(items, custName, payMethod, disc),
    recordCustomerPayment: (cId: string, amt: number, method: PaymentMethod, notes?: string) =>
      storeEngine.recordCustomerPayment(cId, amt, method, notes),
    recordSupplierPayment: (sId: string, amt: number, method: PaymentMethod, notes?: string) =>
      storeEngine.recordSupplierPayment(sId, amt, method, notes),
    addExpense: (cat: string, amt: number, desc: string, method: PaymentMethod) =>
      storeEngine.addExpense(cat, amt, desc, method),
    closeShift: (actualCash: number, reason?: string) =>
      storeEngine.closeShift(actualCash, reason),
    openShift: (openingCash: number) => storeEngine.openShift(openingCash),
    simulateNewIncomingWebsiteOrder: () => storeEngine.simulateNewIncomingWebsiteOrder(),
  };
}
