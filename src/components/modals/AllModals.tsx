/**
 * Nawasrah Business Manager - Modal Dispatcher & Sheet Center
 */

import React, { useState } from 'react';
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
import { ReceiveGoodsModal } from '../../features/inventory/ReceiveGoodsModal';
import { WarehouseTransferModal } from '../../features/inventory/WarehouseTransferModal';
import { StockCountModal } from '../../features/inventory/StockCountModal';
import { SupabaseSqlViewerModal } from './SupabaseSqlViewerModal';
import { runSystemTests, TestResult } from '../../../tests/accounting.test';
import {
  FileCheck2,
  Copy,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const AllModals: React.FC = () => {
  const {
    currentModal,
    modalData,
    closeModal,
    addExpense,
    recordCustomerPayment,
    recordSupplierPayment,
    notifications,
  } = useAppStore();

  // Form states for Expense
  const [expCategory, setExpCategory] = useState('إيجار');
  const [expAmount, setExpAmount] = useState(150);
  const [expDesc, setExpDesc] = useState('');

  // Form states for Customer Payment
  const [payCustAmount, setPayCustAmount] = useState(200);

  // Form states for Supplier Payment
  const [paySupAmount, setPaySupAmount] = useState(500);

  // QA Test Results state
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  return (
    <>
      {/* 1. Add / Edit Product Modal */}
      <Modal
        isOpen={currentModal === 'add_product' || currentModal === 'edit_product'}
        onClose={closeModal}
        title={currentModal === 'edit_product' ? 'تعديل بيانات المنتج' : 'إضافة منتج صنف جديد'}
        subtitle="إدارة بيانات الصنف والأسعار والكمية والمواصفات الكاملة"
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

      {/* Standalone Receive Goods Modal */}
      <Modal
        isOpen={currentModal === 'receive_goods'}
        onClose={closeModal}
        title="استلام بضاعة (إذن توريد جديد)"
        subtitle="إدخال واستلام الشحنات والبضائع الجديدة وتحديث المخزون"
      >
        <ReceiveGoodsModal onClose={closeModal} />
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
        subtitle="إضافة وتعديل وحذف أقسام المنتجات"
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
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-slate-300 font-bold block mb-1">فئة المصروف</label>
            <select
              value={expCategory}
              onChange={(e) => setExpCategory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
            >
              <option value="إيجار">إيجار المباشر</option>
              <option value="كهرباء">كهرباء وماء</option>
              <option value="رواتب">رواتب ومكافآت</option>
              <option value="تسويق">تسويق وإعلانات</option>
              <option value="صيانة">صيانة وتحديثات</option>
            </select>
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">المبلغ (د.أ) *</label>
            <input
              type="number"
              value={expAmount}
              onChange={(e) => setExpAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-bold text-amber-400"
            />
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">البيان / الوصف</label>
            <input
              type="text"
              value={expDesc}
              onChange={(e) => setExpDesc(e.target.value)}
              placeholder="مثال: فاتورة كهرباء الفرع الرئيسي"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
            />
          </div>

          <button
            onClick={() => {
              addExpense(expCategory, expAmount, expDesc || expCategory, 'cash');
              closeModal();
            }}
            className="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-2xl transition shadow mt-2"
          >
            اعتماد وتسجيل المصروف
          </button>
        </div>
      </Modal>

      {/* 11. Customer Payment Modal */}
      <Modal
        isOpen={currentModal === 'record_customer_payment'}
        onClose={closeModal}
        title="تسجيل دفعة عميل (سند قبض)"
        subtitle="استلام مبالغ من ديون العملاء"
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-slate-300 font-bold block mb-1">المبلغ المقبوض (د.أ)</label>
            <input
              type="number"
              value={payCustAmount}
              onChange={(e) => setPayCustAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-extrabold text-emerald-400"
            />
          </div>

          <button
            onClick={() => {
              recordCustomerPayment('cust-1', payCustAmount, 'cliq', 'دفعة حساب');
              closeModal();
            }}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-2xl transition shadow"
          >
            طباعة وحفظ سند القبض
          </button>
        </div>
      </Modal>

      {/* 12. Supplier Payment Modal */}
      <Modal
        isOpen={currentModal === 'record_supplier_payment'}
        onClose={closeModal}
        title="تسجيل دفعة مورد (سند صرف)"
        subtitle="سداد مستحقات الموردين"
      >
        <div className="space-y-3 text-xs">
          <div>
            <label className="text-slate-300 font-bold block mb-1">المبلغ المدفوع للمورد (د.أ)</label>
            <input
              type="number"
              value={paySupAmount}
              onChange={(e) => setPaySupAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white font-extrabold text-rose-400"
            />
          </div>

          <button
            onClick={() => {
              recordSupplierPayment('sup-1', paySupAmount, 'bank_transfer', 'سداد دفعة للمورد');
              closeModal();
            }}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 rounded-2xl transition shadow"
          >
            طباعة وحفظ سند الصرف
          </button>
        </div>
      </Modal>

      {/* 13. Supabase SQL Preview Modal */}
      <Modal
        isOpen={currentModal === 'supabase_sql_preview'}
        onClose={closeModal}
        title="ملفات تصميم قاعدة البيانات Supabase SQL (Phase 1)"
        subtitle="نسخ الأكواد وترتيب تطبيقها في Supabase SQL Editor"
      >
        <SupabaseSqlViewerModal />
      </Modal>

      {/* 14. QA Integration Tests Runner */}
      <Modal
        isOpen={currentModal === 'qa_tests'}
        onClose={closeModal}
        title="منصة اختبارات الجودة QA Tests Engine"
        subtitle="فحص معادلات الحسابات وحجز المخزون والضرائب"
      >
        <div className="space-y-3 text-xs">
          <button
            onClick={() => {
              const res = runSystemTests();
              setTestResults(res);
            }}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-2.5 rounded-xl transition shadow flex items-center justify-center gap-2"
          >
            <FileCheck2 className="w-4 h-4" />
            <span>تشغيل جميع الاختبارات الفورية</span>
          </button>

          {testResults && (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {testResults.map((t, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl border flex items-center justify-between font-semibold ${
                    t.passed
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                      : 'bg-red-950/60 border-red-800 text-red-200'
                  }`}
                >
                  <div>
                    <h5 className="font-bold">{t.title}</h5>
                    <p className="text-[10px] opacity-80">{t.message}</p>
                  </div>
                  {t.passed ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* 15. Notifications Drawer */}
      <Modal
        isOpen={currentModal === 'notifications'}
        onClose={closeModal}
        title="مركز الإشعارات والتنبيهات"
        subtitle="جميع الإشعارات القادمة من المتجر أونلاين والمخزون"
      >
        <div className="space-y-2 text-xs">
          {notifications.map((n) => (
            <div key={n.id} className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 space-y-1">
              <h5 className="font-bold text-blue-400">{n.title}</h5>
              <p className="text-slate-300 text-[11px]">{n.message}</p>
              <span className="text-[9px] text-slate-500 block">
                {new Date(n.createdAt).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
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

const AddCustomerModalContent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { setToast } = useAppStore();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [governorate, setGovernorate] = useState('عمان');
  const [address, setAddress] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;

    try {
      const { supabase, isSupabaseConfigured } = await import('../../lib/supabase');
      if (isSupabaseConfigured && supabase) {
        await supabase.from('customers').insert({
          full_name: fullName.trim(),
          phone: phone.trim() || '0790000000',
          governorate,
          address_line1: address || governorate,
          is_active: true,
        });
      }
      setToast(`تمت إضافة العميل ${fullName} بنجاح!`, 'success');
    } catch (err) {
      console.error('Error adding customer:', err);
    } finally {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div>
        <label className="text-slate-300 font-bold block mb-1">اسم العميل الكامل *</label>
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="مثال: المهندس عمر الشوابكة"
          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
        />
      </div>

      <div>
        <label className="text-slate-300 font-bold block mb-1">رقم الهاتف / الواتساب</label>
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="079XXXXXXX"
          className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-slate-300 font-bold block mb-1">المحافظة</label>
          <select
            value={governorate}
            onChange={(e) => setGovernorate(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
          >
            <option value="عمان">عمان</option>
            <option value="الزرقاء">الزرقاء</option>
            <option value="إربد">إربد</option>
            <option value="العقبة">العقبة</option>
            <option value="السلط">السلط</option>
            <option value="مأدبا">مأدبا</option>
          </select>
        </div>

        <div>
          <label className="text-slate-300 font-bold block mb-1">العنوان التفصيلي</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="مثال: شارع الجامعة"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white"
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-2xl transition shadow mt-2"
      >
        حفظ وإضافة العميل
      </button>
    </form>
  );
};
