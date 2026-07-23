/**
 * Nawasrah Business Manager - POS (Point of Sale) View
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Product, OrderItem, PaymentMethod } from '../../types';
import {
  Search,
  Scan,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Receipt,
  CreditCard,
  DollarSign,
  QrCode,
  Printer,
  Share2,
  CheckCircle2,
  UserCheck,
  X,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

export const PosView: React.FC = () => {
  const { products, customers, createPosSale, openModal } = useAppStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cartItems, setCartItems] = useState<OrderItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>('زبون نقدي');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [isScanningBarcode, setIsScanningBarcode] = useState<boolean>(false);

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'all' ? true : p.categoryId === selectedCategory;
    const matchesSearch =
      p.nameAr.includes(searchQuery) ||
      p.barcode.includes(searchQuery) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const addToCart = (prod: Product) => {
    const existingIndex = cartItems.findIndex((item) => item.productId === prod.id);
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
        unit: prod.unit,
        unitPrice: prod.retailPrice,
        costPrice: prod.costPrice,
        quantity: 1,
        discount: 0,
        totalPrice: prod.retailPrice,
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
          return {
            ...item,
            quantity: newQty,
            totalPrice: newQty * item.unitPrice,
          };
        }
        return item;
      })
      .filter(Boolean) as OrderItem[];

    setCartItems(updated);
  };

  const subtotal = cartItems.reduce((acc, i) => acc + i.totalPrice, 0);
  const totalAmount = Math.max(0, subtotal - discountAmount);
  const changeDue = Math.max(0, cashReceived - totalAmount);

  const handleCompleteSale = () => {
    if (cartItems.length === 0) return;

    const inv = createPosSale(cartItems, selectedCustomer, paymentMethod, discountAmount);
    setLastInvoice(inv);
    setShowReceiptModal(true);
    setCartItems([]);
    setDiscountAmount(0);
    setCashReceived(0);
  };

  const simulateBarcodeScan = () => {
    setIsScanningBarcode(true);
    setTimeout(() => {
      setIsScanningBarcode(false);
      if (!products || products.length === 0) return;
      const randomProd = products[Math.floor(Math.random() * products.length)];
      if (randomProd) {
        addToCart(randomProd);
      }
    }, 1200);
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

        {/* Barcode Camera Simulator Button */}
        <button
          onClick={simulateBarcodeScan}
          disabled={isScanningBarcode}
          className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
        >
          <Scan className={`w-4 h-4 ${isScanningBarcode ? 'animate-spin' : ''}`} />
          <span>{isScanningBarcode ? 'جاري المسح...' : 'مسح الكاميرا'}</span>
        </button>
      </div>

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
          {['all', 'cat-1', 'cat-2', 'cat-3', 'cat-5'].map((catId) => (
            <button
              key={catId}
              onClick={() => setSelectedCategory(catId)}
              className={`px-3 py-1.5 rounded-xl shrink-0 transition border ${
                selectedCategory === catId
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {catId === 'all'
                ? 'جميع الأقسام'
                : catId === 'cat-1'
                ? 'مشروبات'
                : catId === 'cat-2'
                ? 'شوكولاتة'
                : catId === 'cat-3'
                ? 'مكسرات'
                : 'قطع غيار'}
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
              <img src={prod.imageUrl} alt={prod.nameAr} className="w-8 h-8 rounded-lg object-cover border border-slate-700" />
              <div className="min-w-0 flex-1">
                <h4 className="text-[11px] font-bold text-slate-100 truncate">{prod.nameAr}</h4>
                <span className="text-[9px] text-slate-400 block">{prod.barcode}</span>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 pt-1 text-[11px]">
              <span className="font-extrabold text-emerald-400">
                {prod.retailPrice.toFixed(2)} {CURRENCY}
              </span>
              <span className="text-[9px] text-slate-500 font-medium">متاح: {prod.availableQuantity}</span>
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
                    {item.unitPrice.toFixed(2)} {CURRENCY} / {item.unit}
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
                    {item.totalPrice.toFixed(2)} {CURRENCY}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payment Configuration Controls */}
        <div className="pt-2 border-t border-slate-800 space-y-2 text-xs">
          {/* Customer Picker */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400 font-medium">العميل المستلم:</span>
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="زبون نقدي">زبون نقدي - مباشر</option>
              {customers.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Method Selector */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {[
              { id: 'cash', label: 'نقدي 💵' },
              { id: 'cliq', label: 'CliQ 📱' },
              { id: 'card', label: 'بطاقة 💳' },
              { id: 'debt', label: 'آجل 📝' },
            ].map((pm) => (
              <button
                key={pm.id}
                onClick={() => setPaymentMethod(pm.id as any)}
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
                <span className="text-[10px] text-emerald-400">الباقي: {changeDue.toFixed(2)} {CURRENCY}</span>
              </div>
              <input
                type="number"
                value={cashReceived || ''}
                onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                placeholder={totalAmount.toFixed(2)}
                className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-left font-bold text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          {/* Total & Execute Button */}
          <div className="pt-2 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 block">الإجمالي النهائي:</span>
              <span className="text-base font-black text-emerald-400">
                {totalAmount.toFixed(2)} {CURRENCY}
              </span>
            </div>
            <button
              onClick={handleCompleteSale}
              disabled={cartItems.length === 0}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black py-3 px-6 rounded-2xl shadow-lg transition active:scale-95 text-xs flex items-center gap-2"
            >
              <Receipt className="w-4 h-4" />
              <span>إتمام البيع وطباعة</span>
            </button>
          </div>
        </div>
      </div>

      {/* Print Receipt Modal Sheet */}
      {showReceiptModal && lastInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
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

            {/* Simulated Receipt Preview */}
            <div className="bg-white text-slate-900 p-4 rounded-xl shadow-inner font-mono text-[11px] leading-relaxed space-y-2">
              <div className="text-center border-b border-slate-300 pb-2">
                <h4 className="font-extrabold text-xs">مؤسسة نواصرة التجارية</h4>
                <p className="text-[9px] text-slate-600">عمان - شارع مكة | هاتف: 065800111</p>
                <p className="text-[9px] text-slate-500">رقم الفاتورة: {lastInvoice.invoiceNumber}</p>
              </div>

              <div className="border-b border-slate-300 pb-2 space-y-1">
                {(lastInvoice.items || []).map((i: any) => (
                  <div key={i.id} className="flex justify-between">
                    <span>{i.productName} ({i.quantity})</span>
                    <span>{i.totalPrice.toFixed(2)} د.أ</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-left font-bold border-b border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span>الإجمالي:</span>
                  <span>{lastInvoice.totalAmount.toFixed(2)} د.أ</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>شامل الضريبة %16:</span>
                  <span>{lastInvoice.taxAmount.toFixed(2)} د.أ</span>
                </div>
              </div>

              <div className="text-center pt-1 text-[9px] text-slate-500">
                شكراً لتسوقكم من نواصرة!
              </div>
            </div>

            {/* Print & Share Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  alert('جاري إرسال الأمر لطابعة الإيصالات الحرارية عبر شبكة Bluetooth/Wi-Fi...');
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة حرارية</span>
              </button>
              <button
                onClick={() => {
                  alert('تم إنشاء رابط الإيصال الإلكتروني بنجاح!');
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 border border-slate-700"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>مشاركة واتساب</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
