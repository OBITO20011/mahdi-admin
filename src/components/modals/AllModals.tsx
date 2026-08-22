/**
 * Nawasrah Business Manager - Modal Dispatcher & Sheet Center
 */

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Modal } from '../common/Modal';
import { ProductFormModal } from '../../features/products/ProductFormModal';
import { ProductDetailModal } from '../../features/products/ProductDetailModal';
import { StockAdjustmentModal } from '../../features/products/StockAdjustmentModal';
import { CategoriesModal } from './CategoriesModal';
import { BrandsModal } from './BrandsModal';
import { UnitsModal } from './UnitsModal';
import { ProfileModal } from '../../features/more/ProfileModal';
import { UserFormModal } from '../../features/users/UserFormModal';
import { OrderDetailModal } from '../../features/orders/OrderDetailModal';
import { CreateDirectReceiptModal } from '../../features/directReceiving/CreateDirectReceiptModal';
import { WarehouseTransferModal } from '../../features/inventory/WarehouseTransferModal';
import { StockCountModal } from '../../features/inventory/StockCountModal';
import { InventoryOpeningSetupModal } from '../../features/inventory/InventoryOpeningSetupModal';
import { RecordCustomerPaymentModal } from '../../features/accounts/RecordCustomerPaymentModal';
import { AddCustomerModalContent } from '../../features/crm/AddCustomerModalContent';
import { PromotionCodesModal } from '../../features/more/PromotionCodesModal';
import {PushNotificationControls} from '../../features/more/PushNotificationControls';
import { StorefrontSettingsModal } from '../../features/more/StorefrontSettingsModal';
import { ExpenseFormModal } from '../../features/expenses/ExpenseFormModal';
import {
  CheckCheck,
  PackageOpen,
} from 'lucide-react';

export const AllModals: React.FC = () => {
  const {
    currentModal,
    modalData,
    closeModal,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAppStore();

  return (
    <>
      {/* 1. Add / Edit Product Modal */}
      <Modal
        isOpen={currentModal === 'add_product' || currentModal === 'edit_product'}
        onClose={closeModal}
        title={currentModal === 'edit_product' ? 'تعديل بطاقة الصنف' : 'إضافة صنف جديد'}
        subtitle="عرّف طرد الشراء وطرد بيع الجملة وحدود المخزون"
      >
        <ProductFormModal initialProduct={modalData} onClose={closeModal} />
      </Modal>

      {/* 2. View Product Details Modal */}
      <Modal
        isOpen={currentModal === 'view_product' && Boolean(modalData)}
        onClose={closeModal}
        title="تفاصيل الصنف والمخزون"
        subtitle="عرض الأسعار والكميات والمستودع"
      >
        {modalData && <ProductDetailModal product={modalData} onClose={closeModal} />}
      </Modal>

      {/* 3. Adjust Stock Modal */}
      <Modal
        isOpen={currentModal === 'adjust_stock' && Boolean(modalData?.product)}
        onClose={closeModal}
        title="تعديل وتسوية المخزون"
        subtitle="إضافة أو خصم كمية مع تسجيل سبب الحركة"
      >
        {modalData?.product && (
          <StockAdjustmentModal
            product={modalData.product}
            mode={modalData.mode || 'add'}
            onClose={closeModal}
          />
        )}
      </Modal>

      {/* Standalone Direct Receive Goods Modal */}
      <Modal
        isOpen={currentModal === 'receive_goods'}
        onClose={closeModal}
        title="استلام بضائع من الموردين (إذن توريد جديد)"
        subtitle="تسجيل الشحنة المباشرة، إدخال أسعار وطرود المنتجات، وتحديث المخزون والمستحقات"
      >
        <CreateDirectReceiptModal onClose={closeModal} />
      </Modal>

      {/* Warehouse Transfer Modal */}
      <Modal
        isOpen={currentModal === 'warehouse_transfer'}
        onClose={closeModal}
        title="نقل كميات بين المستودعات"
        subtitle="تحويل بضاعة من مستودع إلى آخر مع تسجيل حركات الخروج والدخول"
      >
        <WarehouseTransferModal productId={modalData?.productId} onClose={closeModal} />
      </Modal>

      {/* Stock Count / Audit Modal */}
      <Modal
        isOpen={currentModal === 'stock_count'}
        onClose={closeModal}
        title="جرد وتدقيق المخزون"
        subtitle="إدخال الجرد الفعلي وتسوية الفروق أوتوماتيكياً"
      >
        <StockCountModal productId={modalData?.productId} onClose={closeModal} />
      </Modal>

      {/* 4. Manage Categories Modal */}
      <Modal
        isOpen={currentModal === 'manage_categories'}
        onClose={closeModal}
        title="إدارة الأقسام والكتالوج"
        subtitle="أضف الأقسام التي تناسب بضاعتكم وأدر ظهورها بأمان"
      >
        <CategoriesModal onClose={closeModal} />
      </Modal>

      {/* 5. Manage Brands Modal */}
      <Modal
        isOpen={currentModal === 'manage_brands'}
        onClose={closeModal}
        title="إدارة العلامات التجارية"
        subtitle="إضافة وتعديل العلامات التجارية والشعارات"
      >
        <BrandsModal onClose={closeModal} />
      </Modal>

      {/* 6. Manage Units Modal */}
      <Modal
        isOpen={currentModal === 'manage_units'}
        onClose={closeModal}
        title="إدارة وحدات القياس والتعبئة"
        subtitle="تعريف ووحدات التعبئة والمعاملات"
      >
        <UnitsModal onClose={closeModal} />
      </Modal>

      {/* 7. Profile Settings Modal */}
      <Modal
        isOpen={currentModal === 'profile' || currentModal === 'profile_settings'}
        onClose={closeModal}
        title="الملف الشخصي وإعدادات الحساب"
        subtitle="إدارة بياناتك الشخصية، الأمان، الجلسات النشطة والإشعارات"
      >
        <ProfileModal onClose={closeModal} />
      </Modal>

      {/* 8. Add / Edit User Modal */}
      <Modal
        isOpen={currentModal === 'storefront_settings'}
        onClose={closeModal}
        title="إدارة المتجر الإلكتروني"
        subtitle="إعدادات واحدة بسيطة تتحكم بالموقع وطلبات العملاء مباشرة"
      >
        <StorefrontSettingsModal />
      </Modal>

      {/* Bulk opening inventory setup */}
      <Modal
        isOpen={currentModal === 'inventory_opening_setup'}
        onClose={closeModal}
        title="تهيئة المخزون الافتتاحي"
        subtitle="إدخال البضاعة الموجودة فعليًا قبل بدء التشغيل دون إنشاء مديونية مورد"
        maxHeight="max-h-[96vh]"
        maxWidth="max-w-5xl"
      >
        <InventoryOpeningSetupModal onClose={closeModal} />
      </Modal>

      {/* Promotion codes */}
      <Modal
        isOpen={currentModal === 'promotion_codes'}
        onClose={closeModal}
        title="رموز الخصم للموقع"
        subtitle="إنشاء الرموز ومتابعة الاستخدام وإيقافها مع حفظ السجل"
      >
        <PromotionCodesModal />
      </Modal>

      {/* 8. Add / Edit User Modal */}
      <Modal
        isOpen={currentModal === 'add_user' || currentModal === 'edit_user'}
        onClose={closeModal}
        title={currentModal === 'edit_user' ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد لفرق العمل'}
        subtitle="تحديد الدور والصلاحيات والفرع التابع له"
      >
        <UserFormModal initialUser={modalData} onClose={closeModal} />
      </Modal>

      {/* 9. View Order Details Modal */}
      <Modal
        isOpen={currentModal === 'view_order' && Boolean(modalData)}
        onClose={closeModal}
        title="تفاصيل الطلب والتحصيل"
        subtitle="متابعة حالة الطلب وقبوله وتعيين السائق"
      >
        {modalData && <OrderDetailModal order={modalData} onClose={closeModal} />}
      </Modal>

      {/* 10. Add Expense Modal */}
      <Modal
        isOpen={currentModal === 'add_expense'}
        onClose={closeModal}
        title="تسجيل مصروف تشغيلي"
        subtitle="وثّق الإيجار أو الرواتب أو الفواتير"
      >
        <ExpenseFormModal onClose={closeModal} />
      </Modal>

      {/* 11. Customer Payment Modal */}
      <Modal
        isOpen={currentModal === 'record_customer_payment'}
        onClose={closeModal}
        title="تسجيل دفعة عميل (سند قبض)"
        subtitle="ربط الدفعة بطلب مكتمل وتحديث الذمة تلقائياً"
      >
        <RecordCustomerPaymentModal onClose={closeModal} />
      </Modal>

      {/* 13. Notifications Drawer */}
      <Modal
        isOpen={currentModal === 'notifications'}
        onClose={closeModal}
        title="مركز الإشعارات والتنبيهات"
        subtitle="جميع الإشعارات القادمة من المتجر أونلاين والمخزون"
      >
        <div className="space-y-3 text-xs">
          <PushNotificationControls />

          <div className="flex items-center justify-between gap-2">
            {notifications.some((notification) => !notification.read) && (
              <button
                type="button"
                onClick={() => markAllNotificationsRead()}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 font-bold text-slate-300 transition hover:bg-slate-700"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                تحديد الكل كمقروء
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-7 text-center">
              <PackageOpen className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              <h4 className="font-extrabold text-slate-200">
                المخزون بحالة جيدة
              </h4>
              <p className="mt-1 text-[11px] text-slate-500">
                سيظهر هنا أي منتج يصل إلى حد التنبيه المحدد.
              </p>
            </div>
          ) : (
            notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                onClick={() => markNotificationRead(notification.id)}
                className={`w-full space-y-1 rounded-xl border p-3 text-right transition ${
                  notification.read
                    ? 'border-slate-800 bg-slate-900/50 opacity-75'
                    : 'border-amber-500/30 bg-amber-950/30 hover:bg-amber-950/45'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h5
                    className={`font-bold ${
                      notification.read ? 'text-slate-300' : 'text-amber-300'
                    }`}
                  >
                    {notification.title}
                  </h5>
                  {!notification.read && (
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                  )}
                </div>
                <p className="text-[11px] text-slate-300">
                  {notification.message}
                </p>
                <span className="block text-[9px] text-slate-500">
                  {new Date(notification.createdAt).toLocaleString('ar-JO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* 16. Add Customer Modal */}
      <Modal
        isOpen={currentModal === 'add_customer'}
        onClose={closeModal}
        title="إضافة عميل جديد"
        subtitle="تسجيل بيانات الزبون الجديد ودليله في قاعدة بيانات النواصرة"
      >
        <AddCustomerModalContent onClose={closeModal} />
      </Modal>
    </>
  );
};
