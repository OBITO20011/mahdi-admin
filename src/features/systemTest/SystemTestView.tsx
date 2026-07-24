/**
 * Nawasrah Business Manager - System Test Screen (Owner Only)
 * Executes real Supabase RPCs and displays returned JSON, order status, and inventory metrics.
 */

import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import {
  createTestCustomerInSupabase,
  createTestOrderInSupabase,
  confirmOrderInSupabase,
  completeOrderInSupabase,
  cancelOrderInSupabase,
  fetchOrderInventoryStatusFromSupabase,
} from '../../services/supabase/orders.service';
import { isSupabaseConfigured } from '../../lib/supabase';
import {
  ShieldAlert,
  Terminal,
  UserPlus,
  ShoppingBag,
  CheckCircle2,
  PackageCheck,
  XCircle,
  RotateCw,
  AlertCircle,
  Database,
  Layers,
  ArrowLeft,
  CheckCircle,
} from 'lucide-react';

export const SystemTestView: React.FC = () => {
  const { currentUser, products, refreshOrdersFromSupabase, refreshProductsFromSupabase, setActiveTab, setToast } =
    useAppStore();

  const isOwner = currentUser?.role === 'Owner';

  // Test state
  const [testCustomerName, setTestCustomerName] = useState('زبون اختباري جديد');
  const [testCustomerPhone, setTestCustomerPhone] = useState('0791234567');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [testQuantity, setTestQuantity] = useState<number>(1);

  // Active Test Order state
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null);
  const [currentOrderStatus, setCurrentOrderStatus] = useState<string | null>(null);

  // Results & Metrics state
  const [lastReturnedJson, setLastReturnedJson] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Inventory & Reserved Quantity breakdown
  const [itemsInventory, setItemsInventory] = useState<
    Array<{
      productId: string;
      productName: string;
      sku: string;
      quantityInOrder: number;
      onHandQuantity: number;
      reservedQuantity: number;
      availableQuantity: number;
    }>
  >([]);

  // Default select first product
  useEffect(() => {
    if (products && products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].id);
    }
  }, [products]);

  // Helper to refresh order status & inventory after an RPC action
  const refreshActiveOrderStatusAndInventory = async (orderId: string) => {
    if (!orderId) return;
    try {
      const res = await fetchOrderInventoryStatusFromSupabase(orderId);
      if (res.success) {
        setCurrentOrderStatus(res.orderStatus || null);
        setActiveOrderNumber(res.orderNumber || null);
        if (res.itemsInventory) {
          setItemsInventory(res.itemsInventory);
        }
      }
      await refreshOrdersFromSupabase();
      await refreshProductsFromSupabase();
    } catch (err: any) {
      console.error('[refreshActiveOrderStatusAndInventory Error]:', err);
    }
  };

  // Action 1: Create Test Customer
  const handleCreateTestCustomer = async () => {
    setLoadingAction('create_customer');
    setStatusMessage(null);
    try {
      const res = await createTestCustomerInSupabase(testCustomerName, testCustomerPhone);
      setLastReturnedJson(res.rawJson || res);

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `تم إنشاء العميل التجريبي بنجاح عبر RPC (معرف العميل: ${res.data?.customer_id})`,
        });
        setToast('تم إنشاء العميل الاختباري في Supabase');
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل إنشاء العميل التجريبي: ${res.error}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ أثناء تنفيذ RPC: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 2: Create Test Order
  const handleCreateTestOrder = async () => {
    setLoadingAction('create_order');
    setStatusMessage(null);
    try {
      const res = await createTestOrderInSupabase(
        testCustomerName,
        testCustomerPhone,
        selectedProductId || undefined,
        testQuantity
      );
      setLastReturnedJson(res.rawJson || res);

      if (res.success) {
        const newOrderId = res.data?.order_id;
        const newOrderNum = res.data?.order_number;
        const newStatus = res.data?.status || 'new';

        setActiveOrderId(newOrderId);
        setActiveOrderNumber(newOrderNum);
        setCurrentOrderStatus(newStatus);

        setStatusMessage({
          type: 'success',
          text: `تم إنشاء الطلب الاختباري بنجاح عبر RPC (رقم الطلب: ${newOrderNum})`,
        });
        setToast(`تم إنشاء الطلب الاختباري ${newOrderNum}`);

        if (newOrderId) {
          await refreshActiveOrderStatusAndInventory(newOrderId);
        }
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل إنشاء الطلب الاختباري: ${res.error}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ أثناء تنفيذ RPC: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 3: Confirm Order
  const handleConfirmOrder = async () => {
    if (!activeOrderId) {
      setStatusMessage({ type: 'error', text: 'يرجى إنشاء أو تحديد طلب اختباري أولاً.' });
      return;
    }
    setLoadingAction('confirm_order');
    setStatusMessage(null);
    try {
      const res = await confirmOrderInSupabase(activeOrderId, 'تأكيد اختباري من شاشة System Test');
      setLastReturnedJson(res.rawJson || res);

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `RPC (confirm_order): ${res.message || 'تم تأكيد الطلب وحجز المخزون بنجاح'}`,
        });
        setToast('تم تأكيد الطلب وحجز المخزون');
        await refreshActiveOrderStatusAndInventory(activeOrderId);
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل RPC (confirm_order): ${res.error}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ أثناء تنفيذ RPC: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 4: Complete Order
  const handleCompleteOrder = async () => {
    if (!activeOrderId) {
      setStatusMessage({ type: 'error', text: 'يرجى إنشاء أو تحديد طلب اختباري أولاً.' });
      return;
    }
    setLoadingAction('complete_order');
    setStatusMessage(null);
    try {
      const res = await completeOrderInSupabase(activeOrderId, 'إكمال اختباري من شاشة System Test');
      setLastReturnedJson(res.rawJson || res);

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `RPC (complete_order): ${res.message || 'تم إكمال الطلب وخصم الكميات من المخزون بنجاح'}`,
        });
        setToast('تم إكمال الطلب وخصم المخزون');
        await refreshActiveOrderStatusAndInventory(activeOrderId);
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل RPC (complete_order): ${res.error}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ أثناء تنفيذ RPC: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 5: Cancel Order
  const handleCancelOrder = async () => {
    if (!activeOrderId) {
      setStatusMessage({ type: 'error', text: 'يرجى إنشاء أو تحديد طلب اختباري أولاً.' });
      return;
    }
    setLoadingAction('cancel_order');
    setStatusMessage(null);
    try {
      const res = await cancelOrderInSupabase(activeOrderId, 'إلغاء اختباري من شاشة System Test');
      setLastReturnedJson(res.rawJson || res);

      if (res.success) {
        setStatusMessage({
          type: 'success',
          text: `RPC (cancel_order): ${res.message || 'تم إلغاء الطلب وتحرير الكميات المحجوزة بنجاح'}`,
        });
        setToast('تم إلغاء الطلب وتحرير المخزون');
        await refreshActiveOrderStatusAndInventory(activeOrderId);
      } else {
        setStatusMessage({
          type: 'error',
          text: `فشل RPC (cancel_order): ${res.error}`,
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `خطأ أثناء تنفيذ RPC: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // Action 6: Refresh Orders
  const handleRefreshOrders = async () => {
    setLoadingAction('refresh_orders');
    setStatusMessage(null);
    try {
      await refreshOrdersFromSupabase();
      await refreshProductsFromSupabase();

      if (activeOrderId) {
        await refreshActiveOrderStatusAndInventory(activeOrderId);
      }

      setLastReturnedJson({
        action: 'refresh_orders',
        timestamp: new Date().toISOString(),
        activeOrderId,
        currentOrderStatus,
        itemsInventory,
      });

      setStatusMessage({
        type: 'info',
        text: 'تم تحديث حالة الطلبات والمخزون مباشرة من قاعدة البيانات Supabase.',
      });
      setToast('تم تجديد بيانات الطلبات والمخزون');
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `فشل تحديث البيانات: ${err?.message || err}`,
      });
    } finally {
      setLoadingAction(null);
    }
  };

  // REQUIREMENT 1: Access control (Owner only)
  if (!isOwner) {
    return (
      <div className="p-4 min-h-[75vh] flex flex-col items-center justify-center text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-red-950/80 border border-red-800 text-red-400 flex items-center justify-center shadow-2xl">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-1 max-w-xs">
          <h2 className="text-base font-black text-slate-100">وصول محظور (Access Denied)</h2>
          <p className="text-xs text-slate-400">
            صفحة <span className="font-mono text-amber-400">System Test</span> مخصصة حصرياً لدور صاحب العمل (
            <span className="font-bold text-red-400">Owner</span>) لاختبار إجراءات Supabase RPC.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('dashboard')}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>العودة للوحة التحكم الرئيسية</span>
        </button>
      </div>
    );
  }

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'new':
        return { label: 'جديد (new) ⚡', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' };
      case 'confirmed':
        return { label: 'مؤكد ومحجوز (confirmed) 🛒', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
      case 'preparing':
      case 'processing':
        return { label: 'قيد التجهيز (preparing) 📦', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
      case 'ready':
        return { label: 'جاهز (ready) 🏁', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
      case 'out_for_delivery':
        return { label: 'خرج للتوصيل (out_for_delivery) 🚚', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
      case 'completed':
      case 'delivered':
        return { label: 'مكتمل ومخصوم (completed) 🟢', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'cancelled':
        return { label: 'ملغي ومحرر (cancelled) 🔴', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' };
      default:
        return { label: status || 'غير محدد', color: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
  };

  const badge = getStatusBadge(currentOrderStatus);

  return (
    <div className="p-4 space-y-4 pb-28 text-slate-100">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-purple-600/20 border border-purple-500/30 text-purple-400 flex items-center justify-center shadow">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
              <span>System Test Screen</span>
              <span className="text-[10px] font-extrabold bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded-full">
                Owner Only
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">اختبار المبيعات والمخزون الحقيقي عبر Supabase RPCs مباشرة</p>
          </div>
        </div>

        <button
          onClick={() => setActiveTab('more')}
          className="text-slate-400 hover:text-white text-xs bg-slate-900 border border-slate-800 p-2 rounded-xl"
        >
          ✕
        </button>
      </div>

      {/* Supabase status banner */}
      <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-200">حالة الربط مع Supabase:</span>
        </div>
        {isSupabaseConfigured ? (
          <span className="text-[10px] font-extrabold bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full">
            متصل بالقاعدة الحقيقية ✓
          </span>
        ) : (
          <span className="text-[10px] font-extrabold bg-amber-950 text-amber-400 border border-amber-800 px-2.5 py-0.5 rounded-full">
            وضع التخزين المحلي
          </span>
        )}
      </div>

      {/* Test Controls Setup Box */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3 shadow">
        <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span>تخصيص بيانات الاختبار:</span>
        </h3>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-[10px] text-slate-400 font-bold mb-1">اسم العميل الاختباري</label>
            <input
              type="text"
              value={testCustomerName}
              onChange={(e) => setTestCustomerName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-bold mb-1">رقم هاتف العميل</label>
            <input
              type="text"
              value={testCustomerPhone}
              onChange={(e) => setTestCustomerPhone(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="col-span-2">
            <label className="block text-[10px] text-slate-400 font-bold mb-1">اختر المنتج للاختبار</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr} ({p.sku}) - المتاح: {p.availableQuantity || p.onHandQuantity}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-bold mb-1">الكمية</label>
            <input
              type="number"
              min={1}
              value={testQuantity}
              onChange={(e) => setTestQuantity(Number(e.target.value) || 1)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 text-center font-bold"
            />
          </div>
        </div>
      </div>

      {/* REQUIREMENT 2: RPC Execution Buttons */}
      <div className="space-y-2">
        <h3 className="text-xs font-black text-slate-300">أزرار اختبار الـ Supabase RPCs:</h3>

        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          {/* Button 1: Create Test Customer */}
          <button
            onClick={handleCreateTestCustomer}
            disabled={loadingAction !== null}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'create_customer' ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            <span>Create Test Customer</span>
          </button>

          {/* Button 2: Create Test Order */}
          <button
            onClick={handleCreateTestOrder}
            disabled={loadingAction !== null}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'create_order' ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <ShoppingBag className="w-4 h-4" />
            )}
            <span>Create Test Order</span>
          </button>

          {/* Button 3: Confirm Order */}
          <button
            onClick={handleConfirmOrder}
            disabled={loadingAction !== null || !activeOrderId}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'confirm_order' ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <PackageCheck className="w-4 h-4" />
            )}
            <span>Confirm Order</span>
          </button>

          {/* Button 4: Complete Order */}
          <button
            onClick={handleCompleteOrder}
            disabled={loadingAction !== null || !activeOrderId}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'complete_order' ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>Complete Order</span>
          </button>

          {/* Button 5: Cancel Order */}
          <button
            onClick={handleCancelOrder}
            disabled={loadingAction !== null || !activeOrderId}
            className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'cancel_order' ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            <span>Cancel Order</span>
          </button>

          {/* Button 6: Refresh Orders */}
          <button
            onClick={handleRefreshOrders}
            disabled={loadingAction !== null}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 p-3 rounded-2xl transition shadow flex items-center justify-center gap-1.5 active:scale-98"
          >
            {loadingAction === 'refresh_orders' ? (
              <RotateCw className="w-4 h-4 animate-spin text-blue-400" />
            ) : (
              <RotateCw className="w-4 h-4 text-blue-400" />
            )}
            <span>Refresh Orders</span>
          </button>
        </div>
      </div>

      {/* REQUIREMENT 5: Success / Error Status Banner */}
      {statusMessage && (
        <div
          className={`p-3 rounded-2xl border flex items-start gap-2.5 text-xs font-bold transition shadow ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
              : statusMessage.type === 'error'
              ? 'bg-red-950/80 border-red-800 text-red-200'
              : 'bg-blue-950/80 border-blue-800 text-blue-200'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : statusMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          ) : (
            <RotateCw className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-0.5">
            <div className="text-[10px] opacity-75">
              {statusMessage.type === 'success' ? 'نجاح الاستدعاء ✓' : statusMessage.type === 'error' ? 'تنبيه خطأ ✕' : 'معلومات'}
            </div>
            <div>{statusMessage.text}</div>
          </div>
        </div>
      )}

      {/* REQUIREMENT 6: Show Current Order Status */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2 shadow">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">الطلب الاختباري النشط:</span>
          {activeOrderNumber ? (
            <span className="text-xs font-black text-blue-400 bg-blue-950 px-2.5 py-0.5 rounded-full border border-blue-800">
              {activeOrderNumber}
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">لم يتم إنشاء طلب بعد</span>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
          <span className="text-xs font-bold text-slate-400">حالة الطلب الحالية (Order Status):</span>
          <span className={`text-xs font-black px-3 py-1 rounded-full border ${badge.color}`}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* REQUIREMENT 7: Reserved Quantity & Inventory Metrics */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3 shadow">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5">
            <PackageCheck className="w-4 h-4 text-emerald-400" />
            <span>حكم الكمية المحجوزة والمخزون الحقيقي:</span>
          </h3>
          <span className="text-[10px] text-slate-400">من جدول inventory_balances</span>
        </div>

        {itemsInventory.length === 0 ? (
          <div className="text-center py-4 text-slate-500 text-xs">
            قم بالضغط على <span className="text-indigo-400 font-bold">Create Test Order</span> لعرض تغييرات المخزون
            والكميات المحجوزة مباشرة.
          </div>
        ) : (
          itemsInventory.map((item) => (
            <div
              key={item.productId}
              className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl space-y-2 text-xs"
            >
              <div className="flex items-center justify-between font-bold text-slate-200">
                <span>{item.productName}</span>
                <span className="text-[10px] text-slate-400 font-mono">SKU: {item.sku}</span>
              </div>

              <div className="grid grid-cols-4 gap-1 text-center text-[10px] font-extrabold pt-1 border-t border-slate-900">
                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[9px]">الكمية بالطلب</span>
                  <span className="text-blue-400 text-xs">{item.quantityInOrder}</span>
                </div>

                <div className="bg-amber-950/40 border border-amber-800/60 p-1.5 rounded-lg">
                  <span className="text-amber-400 block text-[9px]">المحجوز (Reserved)</span>
                  <span className="text-amber-300 text-xs">{item.reservedQuantity}</span>
                </div>

                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[9px]">الفعلي (On Hand)</span>
                  <span className="text-slate-200 text-xs">{item.onHandQuantity}</span>
                </div>

                <div className="bg-emerald-950/40 border border-emerald-800/60 p-1.5 rounded-lg">
                  <span className="text-emerald-400 block text-[9px]">المتاح (Available)</span>
                  <span className="text-emerald-300 text-xs">{item.availableQuantity}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* REQUIREMENT 4: Show Returned JSON Payload */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-2 shadow">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-xs font-black text-slate-200 flex items-center gap-1.5">
            <Terminal className="w-4 h-4 text-purple-400" />
            <span>الاستجابة البرمجية JSON من RPC:</span>
          </h3>
          <span className="text-[10px] text-slate-500 font-mono">jsonb_build_object</span>
        </div>

        {lastReturnedJson ? (
          <pre className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-56 leading-relaxed">
            {JSON.stringify(lastReturnedJson, null, 2)}
          </pre>
        ) : (
          <div className="bg-slate-950/60 border border-slate-800/60 p-4 rounded-xl text-center text-slate-500 text-xs font-mono">
            // انقر على أي زر أعلاه لعرض الاستجابة البرمجية الراجعة من Supabase RPC
          </div>
        )}
      </div>
    </div>
  );
};
