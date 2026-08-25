/**
 * Nawasrah Business Manager - POS (Point of Sale) View
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Invoice, Product, OrderItem, PaymentMethod } from '../../types';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { Modal } from '../../components/common/Modal';
import {
  AddCustomerModalContent,
  CreatedCustomer,
} from '../crm/AddCustomerModalContent';
import {
  fetchOpenPosShiftFromSupabase,
  fetchPosCustomersFromSupabase,
  getOrCreatePublicPosReceiptUrlFromSupabase,
  OpenPosShift,
  PosCustomer,
} from '../../services/supabase/pos.service';
import {
  Search,
  Camera,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Receipt,
  Printer,
  Share2,
  CheckCircle2,
  Package,
  Loader2,
  UserPlus,
  CircleAlert,
  Clock3,
  LockKeyhole,
  Copy,
} from 'lucide-react';
import { CURRENCY } from '../../constants';
import {
  calculateAvailableSalePackages,
  calculatePosSummary,
  canSetPosQuantity,
} from '../../utils/posCalculations';
import {
  buildReceiptShareText,
  paymentMethodLabel,
} from '../../utils/receipt';

export const PosView: React.FC = () => {
  const {
    products,
    categories,
    createPosSale,
    refreshProductsFromSupabase,
    setToast,
    activeBranch,
    setActiveTab,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [posCustomers, setPosCustomers] = useState<PosCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
  const [lastInvoice, setLastInvoice] = useState<
    (Invoice & { changeDue: number }) | null
  >(null);
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState<boolean>(false);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [openPosShift, setOpenPosShift] = useState<OpenPosShift | null>(null);
  const [isShiftStatusLoading, setIsShiftStatusLoading] = useState(true);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    refreshProductsFromSupabase();
    fetchPosCustomersFromSupabase()
      .then(setPosCustomers)
      .catch((error) => {
        console.error('Unable to load POS customers:', error);
        setPosCustomers([]);
      });
  }, [refreshProductsFromSupabase]);

  useEffect(() => {
    if (!activeBranch.id) return;
    let isMounted = true;
    setIsShiftStatusLoading(true);
    fetchOpenPosShiftFromSupabase(activeBranch.id)
      .then((shift) => {
        if (isMounted) setOpenPosShift(shift);
      })
      .catch((error) => {
        console.error('Unable to load POS shift status:', error);
        if (isMounted) setOpenPosShift(null);
      })
      .finally(() => {
        if (isMounted) setIsShiftStatusLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeBranch.id]);

  const filteredProducts = products.filter((p) => {
    const isWholesaleReady =
      (p.unitsPerSalePackage || 0) > 0 &&
      (p.salePackagePrice || 0) > 0 &&
      p.saleUnitCode !== 'PCS';
    const matchesCategory = selectedCategory === 'all' ? true : p.categoryId === selectedCategory;
    const matchesSearch =
      p.nameAr.includes(searchQuery) ||
      p.barcode.includes(searchQuery) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return isWholesaleReady && matchesCategory && matchesSearch;
  });

  const addToCart = (prod: Product) => {
    const unitsPerSalePackage = Math.max(
      1,
      Math.floor(prod.unitsPerSalePackage || 1)
    );
    const availableSalePackages = calculateAvailableSalePackages(
      prod.availableQuantity,
      unitsPerSalePackage
    );
    const existingIndex = cartItems.findIndex((item) => item.productId === prod.id);
    const currentQuantity =
      existingIndex >= 0 ? cartItems[existingIndex].quantity : 0;
    if (!canSetPosQuantity(currentQuantity + 1, availableSalePackages)) {
      setToast(`المتاح من ${prod.nameAr} هو ${availableSalePackages} طرد بيع فقط.`, 'error');
      return;
    }

    if (existingIndex >= 0) {
      const updated = [...cartItems];
      updated[existingIndex].quantity += 1;
      updated[existingIndex].totalPrice = updated[existingIndex].quantity * updated[existingIndex].unitPrice;
      setCartItems(updated);
    } else {
      const newItem: OrderItem = {
        id: `cart-${Date.now()}-${Math.random()}`,
        productId: prod.id,
        productName: prod.nameAr,
        productImage: prod.imageUrl,
        sku: prod.sku,
        unit: prod.salePackage || 'طرد',
        unitPrice: prod.salePackagePrice || 0,
        costPrice: prod.costPrice,
        quantity: 1,
        baseQuantity: unitsPerSalePackage,
        unitsPerSalePackage,
        salePackage: prod.salePackage || 'طرد',
        discount: 0,
        totalPrice: prod.salePackagePrice || 0,
      };
      setCartItems([...cartItems, newItem]);
    }
  };

  const updateQuantity = (itemId: string, delta: number) => {
    const updated = cartItems
      .map((item) => {
        if (item.id === itemId) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          const product = products.find(
            (candidate) => candidate.id === item.productId
          );
          const availableSalePackages = product
            ? calculateAvailableSalePackages(
                product.availableQuantity,
                product.unitsPerSalePackage || 1
              )
            : 0;
          if (
            product &&
            !canSetPosQuantity(newQty, availableSalePackages)
          ) {
            setToast(
              `المتاح من ${product.nameAr} هو ${availableSalePackages} طرد بيع فقط.`,
              'error'
            );
            return item;
          }
          return {
            ...item,
            quantity: newQty,
            baseQuantity:
              newQty * (item.unitsPerSalePackage || 1),
            totalPrice: newQty * item.unitPrice,
          };
        }
        return item;
      })
      .filter(Boolean) as OrderItem[];

    setCartItems(updated);
  };

  const posSummary = calculatePosSummary(
    cartItems,
    discountAmount,
    cashReceived
  );
  const subtotal = posSummary.subtotal;
  const totalAmount = posSummary.total;
  const changeDue = posSummary.changeDue;

  const handleCompleteSale = async () => {
    if (cartItems.length === 0) return;

    if (!openPosShift) {
      setToast('افتح وردية الصندوق أولاً قبل إتمام البيع المباشر.', 'error');
      return;
    }

    if (discountAmount > subtotal) {
      setToast('خصم الفاتورة لا يمكن أن يتجاوز مجموع الأصناف.', 'error');
      return;
    }
    if (
      paymentMethod === 'cash' &&
      cashReceived > 0 &&
      cashReceived < totalAmount
    ) {
      setToast('المبلغ المستلم أقل من إجمالي الفاتورة.', 'error');
      return;
    }
    if (paymentMethod === 'debt' && !selectedCustomerId) {
      setToast(
        'البيع الآجل يتطلب اختيار عميل مسجل حتى يُحفظ الدين على حسابه.',
        'error'
      );
      return;
    }

    const selectedCustomer = posCustomers.find(
      (customer) => customer.id === selectedCustomerId
    );

    setIsSubmitting(true);
    let result;
    try {
      result = await createPosSale(
        cartItems,
        selectedCustomer?.id,
        selectedCustomer?.name || 'زبون نقدي',
        paymentMethod,
        discountAmount,
        paymentMethod === 'debt'
          ? 0
          : paymentMethod === 'cash'
          ? cashReceived || totalAmount
          : totalAmount,
        idempotencyKeyRef.current
      );
    } finally {
      setIsSubmitting(false);
    }

    if (!result?.success || !result.data) return;

    idempotencyKeyRef.current = crypto.randomUUID();
    setLastInvoice(result.data);
    setShowReceiptModal(true);
    setCartItems([]);
    setDiscountAmount(0);
    setCashReceived(0);
    setSelectedCustomerId('');
    setPaymentMethod('cash');
  };

  const handleCustomerCreated = (customer: CreatedCustomer) => {
    setPosCustomers((currentCustomers) => [
      ...currentCustomers.filter((item) => item.id !== customer.id),
      customer,
    ].sort((first, second) => first.name.localeCompare(second.name, 'ar')));
    setSelectedCustomerId(customer.id);
  };

  const selectedPosCustomer = posCustomers.find(
    (customer) => customer.id === selectedCustomerId
  );

  const handlePrintReceipt = () => window.print();

  const ensurePublicReceiptUrl = async () => {
    if (!lastInvoice) throw new Error('لا توجد فاتورة لإنشاء الرابط.');
    if (lastInvoice.publicReceiptUrl) return lastInvoice.publicReceiptUrl;

    const publicReceiptUrl =
      await getOrCreatePublicPosReceiptUrlFromSupabase(lastInvoice.id);
    setLastInvoice((current) =>
      current ? { ...current, publicReceiptUrl } : current
    );
    return publicReceiptUrl;
  };

  const handleShareReceipt = async () => {
    if (!lastInvoice) return;

    let publicReceiptUrl: string;
    try {
      publicReceiptUrl = await ensurePublicReceiptUrl();
    } catch (linkError) {
      setToast(
        linkError instanceof Error
          ? linkError.message
          : 'تعذر إنشاء رابط الإيصال.',
        'error'
      );
      return;
    }

    const text = buildReceiptShareText({
      businessName: 'محلات النواصرة',
      branchName: activeBranch.name,
      invoiceNumber: lastInvoice.invoiceNumber,
      customerName: lastInvoice.customerName,
      createdAt: lastInvoice.createdAt,
      items: lastInvoice.items,
      subtotal: lastInvoice.subtotal,
      discount: lastInvoice.discount,
      totalAmount: lastInvoice.totalAmount,
      paymentMethod: lastInvoice.paymentMethod,
      paidAmount: lastInvoice.paidAmount,
      remainingAmount: lastInvoice.remainingAmount,
      changeDue: lastInvoice.changeDue,
      publicReceiptUrl,
    });

    try {
      if (navigator.share) {
        await navigator.share({
          title: `إيصال ${lastInvoice.invoiceNumber}`,
          text,
          url: publicReceiptUrl,
        });
        return;
      }

      window.open(
        `https://api.whatsapp.com/send/?text=${encodeURIComponent(text)}&type=custom_url&app_absent=0`,
        '_blank',
        'noopener,noreferrer'
      );
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') {
        return;
      }
      setToast('تعذرت مشاركة الإيصال على هذا الجهاز.', 'error');
    }
  };

  const handleCopyReceiptLink = async () => {
    try {
      const publicReceiptUrl = await ensurePublicReceiptUrl();
      await navigator.clipboard.writeText(publicReceiptUrl);
      setToast('تم نسخ رابط الإيصال الإلكتروني.', 'success');
    } catch (linkError) {
      setToast(
        linkError instanceof Error
          ? linkError.message
          : 'تعذر نسخ رابط الإيصال.',
        'error'
      );
    }
  };

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-black text-slate-100 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-emerald-400" />
            <span>نقطة البيع السريعة (POS)</span>
          </h2>
          <p className="text-[11px] text-slate-400">إصدار الفواتير وطباعة الإيصالات المباشرة</p>
        </div>

        {/* Barcode Camera Scanner Button */}
        <button
          onClick={() => setIsBarcodeScannerOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/50 border border-emerald-500/40 px-3.5 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 active:scale-95"
        >
          <Camera className="w-4 h-4 animate-pulse" />
          <span>مسح بالباركود (الكاميرا)</span>
        </button>
      </div>

      {isShiftStatusLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          جاري التحقق من وردية الصندوق...
        </div>
      ) : openPosShift ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-700/60 bg-emerald-950/30 p-3 text-xs">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-emerald-400" />
            <div>
              <b className="block text-emerald-300">البيع مربوط بالوردية المفتوحة</b>
              <span className="text-[10px] text-slate-400">
                {openPosShift.shiftNumber} • {activeBranch.name}
              </span>
            </div>
          </div>
          <span className="rounded-full border border-emerald-700 bg-emerald-950 px-2 py-1 text-[10px] font-black text-emerald-300">
            جاهز للبيع
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-700/60 bg-amber-950/40 p-3 text-xs">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <b className="block text-amber-200">البيع المباشر متوقف مؤقتًا</b>
              <span className="text-[10px] leading-5 text-slate-400">
                افتح وردية الصندوق حتى تُربط الفاتورة والحسابات بها تلقائيًا.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('shifts')}
            className="shrink-0 rounded-xl bg-amber-500 px-3 py-2 text-[10px] font-black text-slate-950 transition hover:bg-amber-400"
          >
            فتح وردية
          </button>
        </div>
      )}

      {/* Search Input & Categories */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المنتج أو الباركود أو SKU..."
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl pr-9 pl-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs font-bold">
          {[
            { id: 'all', nameAr: 'جميع الأقسام' },
            ...categories.map((category) => ({
              id: category.id,
              nameAr: category.nameAr,
            })),
          ].map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-3 py-1.5 rounded-xl shrink-0 transition border ${
                selectedCategory === category.id
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {category.nameAr}
            </button>
          ))}
        </div>
      </div>

      {/* Products Grid Picker */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto p-1 bg-slate-900/40 rounded-2xl border border-slate-800/80">
        {filteredProducts.map((prod) => (
          <div
            key={prod.id}
            onClick={() => addToCart(prod)}
            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 p-2.5 rounded-2xl shadow transition cursor-pointer active:scale-95 text-right flex flex-col justify-between"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {prod.imageUrl ? (
                <img
                  src={prod.imageUrl}
                  alt={prod.nameAr}
                  className="w-8 h-8 rounded-lg object-cover border border-slate-700"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-800 flex items-center justify-center">
                  <Package className="w-4 h-4 text-slate-500" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h4 className="text-[11px] font-bold text-slate-100 truncate">{prod.nameAr}</h4>
                <span className="text-[9px] text-slate-400 block">{prod.barcode}</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 pt-1 text-[11px]">
              <span className="font-extrabold text-emerald-400">
                {(prod.salePackagePrice || 0).toFixed(3)} {CURRENCY}
              </span>
              <span className="text-[9px] text-slate-500 font-medium">
                متاح:{' '}
                {calculateAvailableSalePackages(
                  prod.availableQuantity,
                  prod.unitsPerSalePackage || 1
                )}{' '}
                {prod.salePackage || 'طرد'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Cart Summary & Item List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-100">سلة المبيعات الحالية ({cartItems.length})</h3>
          </div>
          {cartItems.length > 0 && (
            <button
              onClick={() => setCartItems([])}
              className="text-[10px] text-red-400 hover:underline font-bold flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>إفراغ السلة</span>
            </button>
          )}
        </div>

        {cartItems.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-xs">
            انقر على أي منتج أعلاه لإضافته إلى الفاتورة
          </div>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {cartItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-slate-800/60 p-2 rounded-xl border border-slate-700/60 text-xs">
                <div className="min-w-0 flex-1 pl-2">
                  <h5 className="font-bold text-slate-200 truncate">{item.productName}</h5>
                  <span className="text-[10px] text-slate-400">
                    {item.unitPrice.toFixed(3)} {CURRENCY} / {item.unit}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded-lg border border-slate-700">
                    <button onClick={() => updateQuantity(item.id, -1)} className="text-slate-400 hover:text-white">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-bold text-white px-1">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="text-slate-400 hover:text-white">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <span className="font-black text-emerald-400 w-16 text-left">
                    {item.totalPrice.toFixed(3)} {CURRENCY}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payment Configuration Controls */}
        <div className="pt-2 border-t border-slate-800 space-y-2 text-xs">
          {/* Customer Picker */}
          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950/35 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-300">العميل المستلم</span>
              <button
                type="button"
                onClick={() => setIsAddCustomerOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[10px] font-extrabold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                <UserPlus className="h-3.5 w-3.5" />
                إضافة عميل جديد
              </button>
            </div>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">زبون نقدي - مباشر</option>
              {posCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                  {customer.phone ? ` — ${customer.phone}` : ''}
                </option>
              ))}
            </select>
            {paymentMethod === 'debt' && !selectedCustomerId ? (
              <p className="flex items-start gap-1.5 text-[10px] leading-5 text-amber-300">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                اختر عميلاً مسجلاً؛ لا يمكن حفظ دين على زبون نقدي مباشر.
              </p>
            ) : selectedPosCustomer ? (
              <p className="text-[10px] leading-5 text-emerald-300">
                ستُحفظ الفاتورة في سجل {selectedPosCustomer.name} وحسابه.
              </p>
            ) : (
              <p className="text-[10px] leading-5 text-slate-500">
                للبيع النقدي العابر اترك الخيار على «زبون نقدي - مباشر».
              </p>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {[
              { id: 'cash' as PaymentMethod, label: 'نقدي 💵' },
              { id: 'cliq' as PaymentMethod, label: 'CliQ 📱' },
              { id: 'card' as PaymentMethod, label: 'بطاقة 💳' },
              { id: 'debt' as PaymentMethod, label: 'آجل 📝' },
            ].map((pm) => (
              <button
                key={pm.id}
                onClick={() => setPaymentMethod(pm.id)}
                className={`py-2 rounded-xl text-[11px] font-bold border transition ${
                  paymentMethod === pm.id
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                }`}
              >
                {pm.label}
              </button>
            ))}
          </div>

          {/* Received Cash Input */}
          {paymentMethod === 'cash' && cartItems.length > 0 && (
            <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-xl border border-slate-700">
              <div>
                <span className="text-[11px] text-slate-300 font-bold block">المبلغ المستلم:</span>
                <span className="text-[10px] text-emerald-400">الباقي: {changeDue.toFixed(3)} {CURRENCY}</span>
              </div>
              <input
                type="number"
                value={cashReceived || ''}
                onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                placeholder={totalAmount.toFixed(3)}
                className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-left font-bold text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          {/* Total & Execute Button */}
          <div className="pt-2 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 block">الإجمالي النهائي:</span>
              <span className="text-base font-black text-emerald-400">
                {totalAmount.toFixed(3)} {CURRENCY}
              </span>
            </div>
            <button
              onClick={() =>
                openPosShift
                  ? void handleCompleteSale()
                  : setActiveTab('shifts')
              }
              disabled={
                cartItems.length === 0 ||
                isSubmitting ||
                isShiftStatusLoading
              }
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black py-3 px-6 rounded-2xl shadow-lg transition active:scale-95 text-xs flex items-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Receipt className="w-4 h-4" />
              )}
              <span>
                {isSubmitting
                  ? 'جاري حفظ البيع...'
                  : openPosShift
                  ? 'إتمام البيع وطباعة'
                  : 'فتح وردية للمتابعة'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Print Receipt Modal Sheet */}
      {showReceiptModal && lastInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <style>{`
            @media print {
              @page { size: 80mm auto; margin: 4mm; }
              html, body { background: #ffffff !important; }
              body * { visibility: hidden !important; }
              .pos-receipt-print,
              .pos-receipt-print * { visibility: visible !important; }
              .pos-receipt-print {
                position: absolute !important;
                inset: 0 !important;
                width: 72mm !important;
                margin: 0 auto !important;
                padding: 3mm !important;
                border: 0 !important;
                box-shadow: none !important;
                color: #111827 !important;
                background: #ffffff !important;
                direction: rtl !important;
                font-family: Arial, Tahoma, sans-serif !important;
              }
            }
          `}</style>
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 text-right font-sans space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <CheckCircle2 className="w-5 h-5" />
                <span>تم إتمام العملية بنجاح!</span>
              </div>
              <button
                onClick={() => setShowReceiptModal(false)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Receipt Preview */}
            <div className="pos-receipt-print bg-white text-slate-900 p-4 rounded-xl shadow-inner text-[11px] leading-relaxed space-y-2">
              <div className="text-center border-b border-slate-300 pb-2">
                <h4 className="font-extrabold text-xs">محلات النواصرة</h4>
                <p className="text-[9px] text-slate-600">{activeBranch.name}</p>
                <p className="text-[9px] text-slate-600">
                  {[activeBranch.address, activeBranch.phone].filter(Boolean).join(' | ')}
                </p>
                <p className="text-[9px] text-slate-500">رقم الفاتورة: {lastInvoice.invoiceNumber}</p>
                <p className="text-[9px] text-slate-500">
                  {new Date(lastInvoice.createdAt).toLocaleString('ar-JO')}
                </p>
              </div>

              <div className="border-b border-slate-300 pb-2 text-[10px]">
                العميل: {lastInvoice.customerName || 'زبون نقدي'}
              </div>

              <div className="border-b border-slate-300 pb-2 space-y-1">
                {(lastInvoice.items || []).map((i: any) => (
                  <div key={i.id} className="flex justify-between">
                    <span>{i.productName} ({i.quantity})</span>
                    <span>{i.totalPrice.toFixed(3)} د.أ</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-left font-bold border-b border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span>الإجمالي:</span>
                  <span>{lastInvoice.totalAmount.toFixed(3)} د.أ</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>طريقة الدفع:</span>
                  <span>{paymentMethodLabel(lastInvoice.paymentMethod)}</span>
                </div>
                {lastInvoice.remainingAmount > 0 && (
                  <div className="flex justify-between text-[10px] text-rose-700">
                    <span>المتبقي على العميل:</span>
                    <span>{lastInvoice.remainingAmount.toFixed(3)} د.أ</span>
                  </div>
                )}
                {lastInvoice.changeDue > 0 && (
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>الباقي للزبون:</span>
                    <span>{lastInvoice.changeDue.toFixed(3)} د.أ</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-1 text-[9px] text-slate-500">
                شكراً لتسوقكم من نواصرة!
              </div>
            </div>

            {/* Print & Share Action Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handlePrintReceipt}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة / PDF</span>
              </button>
              <button
                onClick={() => void handleShareReceipt()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 border border-slate-700"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>مشاركة الإيصال</span>
              </button>
              <button
                onClick={() => void handleCopyReceiptLink()}
                className="bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-200 font-bold py-2.5 rounded-xl text-[10px] flex items-center justify-center gap-1 border border-emerald-700/50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ الرابط</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Barcode Camera Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        products={products}
        onProductScanned={(scannedProduct) => addToCart(scannedProduct)}
        setToast={setToast}
      />

      <Modal
        isOpen={isAddCustomerOpen}
        onClose={() => setIsAddCustomerOpen(false)}
        title="إضافة عميل جديد"
        subtitle="سيُحفظ في العملاء ويُختار لهذه الفاتورة مباشرة"
      >
        <AddCustomerModalContent
          onClose={() => setIsAddCustomerOpen(false)}
          onCreated={handleCustomerCreated}
        />
      </Modal>
    </div>
  );
};
