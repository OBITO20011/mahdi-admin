/**
 * Nawasrah Business Manager - Create Direct Goods Receipt Modal
 * Wholesale Store Goods Receiving Form (Direct receiving bypassing PO approval)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import {
  SupplierReceipt,
  DirectReceiptItemInput,
  DirectReceiptForm,
} from '../../types/directReceiving';
import { Supplier, Unit, Warehouse, Branch } from '../../types';
import {
  fetchSuppliersForReceivingFromSupabase,
  fetchProductsForReceivingFromSupabase,
  fetchUnitsForReceivingFromSupabase,
  fetchWarehousesForReceivingFromSupabase,
  fetchBranchesForReceivingFromSupabase,
  createDirectSupplierReceiptInSupabase,
} from '../../services/supabase/directReceiving.service';
import { createSupplierInSupabase } from '../../services/supabase/purchases.service';
import { CURRENCY } from '../../constants';
import {
  Building2,
  PackageCheck,
  Search,
  Plus,
  Trash2,
  Calendar,
  DollarSign,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Warehouse as WarehouseIcon,
  X,
  Sparkles,
} from 'lucide-react';

interface CreateDirectReceiptModalProps {
  onClose: () => void;
  onSuccess?: (receiptData: any) => void;
}

const COMMON_PURCHASE_UNITS = [
  { name: 'كرتونة', code: 'CARTON' },
  { name: 'صندوق', code: 'BOX' },
  { name: 'باكيت', code: 'PACKET' },
  { name: 'ربطة', code: 'BUNDLE' },
  { name: 'شوال / كيس', code: 'BAG' },
  { name: 'علبة', code: 'CAN' },
  { name: 'قنينة / زجاجة', code: 'BOTTLE' },
  { name: 'حافظة / كيس', code: 'CASE' },
  { name: 'قطعة', code: 'PIECE' },
  { name: 'حبة', code: 'ITEM' },
];

export const CreateDirectReceiptModal: React.FC<CreateDirectReceiptModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const { user } = useAuthStore();
  const { setToast, activeBranch, updateProduct } = useAppStore();

  // Reference Data States
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingRefData, setIsLoadingRefData] = useState<boolean>(true);

  // Form State
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [receivedAt, setReceivedAt] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [deliveryFeeJod, setDeliveryFeeJod] = useState<number>(0);
  const [discountJod, setDiscountJod] = useState<number>(0);
  const [taxJod, setTaxJod] = useState<number>(0);
  const [amountPaidJod, setAmountPaidJod] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [internalNotes, setInternalNotes] = useState<string>('');

  // Selected Items State
  const [items, setItems] = useState<
    (DirectReceiptItemInput & {
      tempId: string;
      pkgPriceJod: number;
      discountJod: number;
      sellingPriceJod: number; // Selling Price per Piece (JOD)
      availableStock?: number;
    })[]
  >([]);

  // Product Search State
  const [productSearch, setProductSearch] = useState<string>('');
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // Inline Add Supplier Modal
  const [showAddSupplierModal, setShowAddSupplierModal] = useState<boolean>(false);
  const [newSupplierCompany, setNewSupplierCompany] = useState<string>('');
  const [newSupplierContact, setNewSupplierContact] = useState<string>('');
  const [newSupplierPhone, setNewSupplierPhone] = useState<string>('');
  const [isAddingSupplier, setIsAddingSupplier] = useState<boolean>(false);

  // Submitting state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load Initial Reference Data
  const loadReferenceData = useCallback(async () => {
    setIsLoadingRefData(true);
    try {
      const [sups, prods, unts, whs, brs] = await Promise.all([
        fetchSuppliersForReceivingFromSupabase(),
        fetchProductsForReceivingFromSupabase(),
        fetchUnitsForReceivingFromSupabase(),
        fetchWarehousesForReceivingFromSupabase(),
        fetchBranchesForReceivingFromSupabase(),
      ]);

      setSuppliers(sups);
      setProducts(prods);
      setUnits(unts);
      setWarehouses(whs);
      setBranches(brs);

      if (sups.length > 0) setSelectedSupplierId(sups[0].id);
      if (whs.length > 0) setSelectedWarehouseId(whs[0].id);
      if (brs.length > 0) setSelectedBranchId(brs[0].id);
    } catch (err) {
      console.error('Error loading receiving metadata:', err);
    } finally {
      setIsLoadingRefData(false);
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // Filtered Products for Search Dropdown
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products.slice(0, 8);
    const query = productSearch.toLowerCase().trim();
    return products.filter(
      (p) =>
        (p.name_ar && p.name_ar.toLowerCase().includes(query)) ||
        (p.sku && p.sku.toLowerCase().includes(query)) ||
        (p.barcode && p.barcode.toLowerCase().includes(query))
    );
  }, [products, productSearch]);

  // Add Product to Receipt Rows
  const handleSelectProduct = (prod: any) => {
    const baseUnitName = prod.units?.name_ar || prod.unit || 'حبة';
    const unitsPerPackage = Math.max(1, Math.floor(Number(prod.units_per_package || prod.unitsPerPackage || prod.packet_size || prod.carton_size) || 24));
    const currentCostPerPiece = (Number(prod.cost_price_in_minor_units) || 0) / 1000.0;
    const currentRetailPerPiece = (Number(prod.retail_price_in_minor_units) || 0) / 1000.0 || (Number(prod.retail_price) || 0) || (currentCostPerPiece * 1.5);
    const defaultPkgPrice = prod.default_purchase_price ? Number(prod.default_purchase_price) : (currentCostPerPiece > 0 ? currentCostPerPiece * unitsPerPackage : 7.200);

    const currentStock = prod.inventory_balances
      ? prod.inventory_balances.reduce(
          (acc: number, ib: any) => acc + Math.floor(Number(ib.on_hand_quantity) || 0),
          0
        )
      : 0;

    const newItem: DirectReceiptItemInput & {
      tempId: string;
      pkgPriceJod: number;
      discountJod: number;
      sellingPriceJod: number;
      availableStock?: number;
    } = {
      tempId: `${prod.id}-${Date.now()}`,
      productId: prod.id,
      productName: prod.name_ar,
      productSku: prod.sku,
      productBarcode: prod.barcode || '',
      purchaseUnitId: prod.unit_id || undefined,
      baseUnitId: prod.unit_id || undefined,
      purchaseUnitName: prod.purchase_package || 'كرتونة',
      baseUnitName: baseUnitName,
      packageQuantity: 1, // Whole package INT
      unitsPerPackage: unitsPerPackage, // Whole package INT
      packagePriceInMinorUnits: Math.round(defaultPkgPrice * 1000),
      discountInMinorUnits: 0,
      pkgPriceJod: defaultPkgPrice,
      sellingPriceJod: currentRetailPerPiece,
      discountJod: 0,
      availableStock: currentStock,
    };

    setItems((prev) => [...prev, newItem]);
    setProductSearch('');
    setIsSearchFocused(false);
  };

  // Update item field in list
  const updateItemField = (index: number, field: string, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === 'packageQuantity') {
        // MUST BE INTEGER >= 1
        item.packageQuantity = Math.max(1, Math.floor(Number(value) || 1));
      } else if (field === 'unitsPerPackage') {
        // MUST BE INTEGER >= 1
        item.unitsPerPackage = Math.max(1, Math.floor(Number(value) || 1));
      } else if (field === 'purchaseUnitName') {
        item.purchaseUnitName = String(value);
      } else if (field === 'baseUnitName') {
        item.baseUnitName = String(value);
      } else if (field === 'pkgPriceJod') {
        item.pkgPriceJod = Math.max(0, Number(value) || 0);
        item.packagePriceInMinorUnits = Math.round(item.pkgPriceJod * 1000);
      } else if (field === 'sellingPriceJod') {
        item.sellingPriceJod = Math.max(0, Number(value) || 0);
        item.sellingPriceInMinorUnits = Math.round(item.sellingPriceJod * 1000);
      } else if (field === 'discountJod') {
        const maxDiscount = item.packageQuantity * item.pkgPriceJod;
        item.discountJod = Math.min(maxDiscount, Math.max(0, Number(value) || 0));
        item.discountInMinorUnits = Math.round(item.discountJod * 1000);
      } else if (field === 'batchNumber') {
        item.batchNumber = value;
      } else if (field === 'productionDate') {
        item.productionDate = value;
      } else if (field === 'expiryDate') {
        item.expiryDate = value;
      } else if (field === 'notes') {
        item.notes = value;
      }

      updated[index] = item;
      return updated;
    });
  };

  // Remove Item row
  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Add Inline New Supplier Handler
  const handleCreateSupplier = async () => {
    if (!newSupplierCompany.trim()) {
      setToast('اسم شركة المورد مطلوب.', 'error');
      return;
    }

    setIsAddingSupplier(true);
    const res = await createSupplierInSupabase({
      companyName: newSupplierCompany.trim(),
      contactPerson: newSupplierContact.trim(),
      phone: newSupplierPhone.trim(),
    });

    if (res.success && res.data) {
      setToast('تم إضافة المورد الجديد بنجاح.', 'success');
      const sups = await fetchSuppliersForReceivingFromSupabase();
      setSuppliers(sups);
      setSelectedSupplierId(res.data.id);
      setShowAddSupplierModal(false);
      setNewSupplierCompany('');
      setNewSupplierContact('');
      setNewSupplierPhone('');
    } else {
      setToast(res.error || 'تعذر إضافة المورد.', 'error');
    }
    setIsAddingSupplier(false);
  };

  // Subtotal Calculation in JOD
  const itemsSubtotalJod = useMemo(() => {
    return items.reduce((sum, item) => {
      const lineSub = item.packageQuantity * item.pkgPriceJod - item.discountJod;
      return sum + Math.max(0, lineSub);
    }, 0);
  }, [items]);

  const grandTotalJod = useMemo(() => {
    const tot = itemsSubtotalJod - discountJod + deliveryFeeJod + taxJod;
    return Math.max(0, tot);
  }, [itemsSubtotalJod, discountJod, deliveryFeeJod, taxJod]);

  const amountDueJod = useMemo(() => {
    const due = grandTotalJod - amountPaidJod;
    return Math.max(0, due);
  }, [grandTotalJod, amountPaidJod]);

  // Handle Payment Method Deferred vs Paid
  useEffect(() => {
    if (paymentMethod === 'deferred') {
      setAmountPaidJod(0);
    }
  }, [paymentMethod]);

  // Main Action: Save Goods Receipt & Update Inventory
  const handleSubmitReceipt = async () => {
    if (!selectedSupplierId) {
      setToast('الرجاء اختيار المورد.', 'error');
      return;
    }
    if (!selectedWarehouseId) {
      setToast('الرجاء اختيار المستودع المستلم.', 'error');
      return;
    }
    if (items.length === 0) {
      setToast('يجب إضافة منتج واحد على الأقل للاستلام.', 'error');
      return;
    }

    // Validate Package Integer Rules
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!Number.isInteger(it.packageQuantity) || it.packageQuantity <= 0) {
        setToast(
          `عدد الطرود في الصنف رقم ${i + 1} (${it.productName}) يجب أن يكون عدداً صحيحاً أكبر من صفر.`,
          'error'
        );
        return;
      }
      if (!Number.isInteger(it.unitsPerPackage) || it.unitsPerPackage <= 0) {
        setToast(
          `محتوى الطرد في الصنف رقم ${i + 1} (${it.productName}) يجب أن يكون عدداً صحيحاً أكبر من صفر.`,
          'error'
        );
        return;
      }
      if (it.pkgPriceJod < 0) {
        setToast(
          `سعر الطرد في الصنف رقم ${i + 1} (${it.productName}) لا يمكن أن يكون بالسالب.`,
          'error'
        );
        return;
      }
    }

    // Validate Payment & Discount Rules
    if (amountPaidJod > grandTotalJod) {
      setToast(
        `المبلغ المدفوع (${amountPaidJod.toFixed(3)}) لا يمكن أن يتجاوز إجمالي سند الاستلام (${grandTotalJod.toFixed(3)}).`,
        'error'
      );
      return;
    }

    if (discountJod > itemsSubtotalJod) {
      setToast(
        `خصم السند (${discountJod.toFixed(3)}) لا يمكن أن يتجاوز مجموع الأصناف المستلمة (${itemsSubtotalJod.toFixed(3)}).`,
        'error'
      );
      return;
    }

    // Generate unique idempotency key for this request attempt
    const idempotencyKey = crypto.randomUUID();

    setIsSubmitting(true);

    const payload: DirectReceiptForm = {
      supplierId: selectedSupplierId,
      warehouseId: selectedWarehouseId,
      branchId: selectedBranchId || undefined,
      supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
      supplierInvoiceDate: supplierInvoiceDate || undefined,
      receivedAt: receivedAt || new Date().toISOString(),
      deliveryFeeInMinorUnits: Math.round(deliveryFeeJod * 1000),
      discountInMinorUnits: Math.round(discountJod * 1000),
      taxInMinorUnits: Math.round(taxJod * 1000),
      amountPaidInMinorUnits: Math.round(amountPaidJod * 1000),
      paymentMethod,
      paymentReference: paymentReference.trim() || undefined,
      notes: notes.trim() || undefined,
      internalNotes: internalNotes.trim() || undefined,
      idempotencyKey,
      items: items.map((item) => ({
        productId: item.productId,
        purchaseUnitId: item.purchaseUnitId,
        baseUnitId: item.baseUnitId,
        purchaseUnitName: item.purchaseUnitName,
        baseUnitName: item.baseUnitName,
        packageQuantity: Math.floor(item.packageQuantity), // Strict Integer
        unitsPerPackage: Math.floor(item.unitsPerPackage), // Strict Integer
        packagePriceInMinorUnits: Math.round(item.pkgPriceJod * 1000),
        discountInMinorUnits: Math.round(item.discountJod * 1000),
        batchNumber: item.batchNumber,
        productionDate: item.productionDate,
        expiryDate: item.expiryDate,
        notes: item.notes,
      })),
    };

    const res = await createDirectSupplierReceiptInSupabase(payload);

    if (res.success && res.data) {
      // Update Product master data for items with updateDefaultPrice = true
      items.forEach((item) => {
        if (item.updateDefaultPrice) {
          const costPerPiece = item.unitsPerPackage > 0 ? item.pkgPriceJod / item.unitsPerPackage : 0;
          const profitPerPiece = item.sellingPriceJod - costPerPiece;
          const profitPercent = costPerPiece > 0 ? (profitPerPiece / costPerPiece) * 100 : 0;

          updateProduct(item.productId, {
            defaultPurchasePrice: item.pkgPriceJod,
            purchasePackage: item.purchaseUnitName,
            unitsPerPackage: item.unitsPerPackage,
            costPrice: Number(costPerPiece.toFixed(4)),
            retailPrice: item.sellingPriceJod,
            profitPerPiece: Number(profitPerPiece.toFixed(4)),
            profitPercentage: Number(profitPercent.toFixed(2)),
          });
        }
      });

      setToast(
        `تم حفظ سند الاستلام ${res.data.receiptNumber} وزيادة المخزون بنجاح (+${res.data.totalInventoryUnitsAdded} وحدة)`,
        'success'
      );
      setIsSubmitting(false);
      onSuccess?.(res.data);
      onClose();
    } else {
      setToast(
        res.error || 'فشلت عملية حفظ سند الاستلام وزيادة المخزون.',
        'error'
      );
      setIsSubmitting(false);
    }
  };

  if (isLoadingRefData) {
    return (
      <div className="p-8 text-center text-slate-300 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
        <p className="text-xs font-bold">جاري تحميل بيانات الموردين والمستودعات...</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4 max-h-[80vh] overflow-y-auto p-1 pr-2 text-xs text-slate-200">
      {/* Supplier & Location Info Section */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-slate-100">بيانات المورد والمستودع المستلم</span>
          </div>
          <button
            onClick={() => setShowAddSupplierModal(true)}
            className="bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-xl font-bold text-[11px] hover:bg-blue-600/30 transition flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مورد جديد</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {/* Supplier Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">
              المورد المستلم منه <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            >
              <option value="">-- اختر المورد --</option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>
                  {sup.companyName} ({sup.contactPerson || 'بدون مسؤول'})
                </option>
              ))}
            </select>
          </div>

          {/* Warehouse Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">
              المستودع المستلم <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            >
              <option value="">-- اختر المستودع --</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.nameAr} ({wh.code})
                </option>
              ))}
            </select>
          </div>

          {/* Branch Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">الفرع المالي (اختياري)</label>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            >
              <option value="">-- الفرع الحالي ({activeBranch?.name}) --</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nameAr}
                </option>
              ))}
            </select>
          </div>

          {/* Supplier Invoice Number */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">رقم فاتورة/إذن المورد</label>
            <input
              type="text"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="مثال: INV-9908"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Supplier Invoice Date */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">تاريخ فاتورة المورد</label>
            <input
              type="date"
              value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Receiving Date & Time */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">تاريخ ووقت الاستلام الفعلي</label>
            <input
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100 focus:border-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Product Search & Addition Section */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-3 relative">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-slate-100">إضافة البضائع المستلمة (الطرود والأصناف)</span>
          </div>
          <span className="text-[10px] text-slate-400 font-bold">
            عدد الأصناف المضافة: {items.length}
          </span>
        </div>

        {/* Product Search Box */}
        <div className="relative">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus-within:border-blue-500 transition">
            <Search className="w-4 h-4 text-slate-400 ml-2" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              placeholder="ابحث باسم المنتج، SKU، أو الباركود لإضافته لسند الاستلام..."
              className="w-full bg-transparent text-slate-100 placeholder-slate-500 outline-none font-bold"
            />
            {productSearch && (
              <button onClick={() => setProductSearch('')} className="text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search Dropdown Results */}
          {isSearchFocused && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl z-50 max-h-60 overflow-y-auto p-1.5 space-y-1">
              {filteredProducts.length === 0 ? (
                <div className="p-4 text-center text-slate-500 space-y-1">
                  <p>لم يتم العثور على نتائج متطابقة.</p>
                  <p className="text-[10px] text-blue-400 font-bold">
                    أضف المنتج من قسم المنتجات أولاً
                  </p>
                </div>
              ) : (
                filteredProducts.map((prod) => (
                  <div
                    key={prod.id}
                    onClick={() => handleSelectProduct(prod)}
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
                  >
                    <div>
                      <h4 className="font-bold text-slate-100 text-xs">{prod.name_ar}</h4>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span>SKU: {prod.sku}</span>
                        {prod.barcode && <span>| الباركود: {prod.barcode}</span>}
                        <span>| الوحدة الأساسية: {prod.units?.name_ar || 'حبة'}</span>
                      </div>
                    </div>
                    <div className="text-left">
                      <span className="text-emerald-400 font-extrabold text-xs block">
                        {((Number(prod.cost_price_in_minor_units) || 0) / 1000).toFixed(3)} {CURRENCY}
                      </span>
                      <span className="text-[10px] text-slate-500 font-semibold">اضغط للإضافة +</span>
                    </div>
                  </div>
                ))
              )}
              <div className="p-2 border-t border-slate-900 text-center">
                <button
                  onClick={() => setIsSearchFocused(false)}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-200"
                >
                  إغلاق القائمة ✕
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Selected Product Rows */}
        {items.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-2xl p-6 text-center text-slate-500 space-y-2">
            <PackageCheck className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-bold text-xs">لم تقم بإضافة أي بضاعة بعد.</p>
            <p className="text-[11px] text-slate-500">
              استخدم مربع البحث أعلاه لإضافة المنتجات والطرود الواردة من المورد.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const totalBaseUnits = Math.floor(item.packageQuantity * item.unitsPerPackage);
              const costPerPieceJod = item.unitsPerPackage > 0 ? item.pkgPriceJod / item.unitsPerPackage : 0;
              const sellingPricePerPieceJod = item.sellingPriceJod || 0;
              const profitPerPieceJod = sellingPricePerPieceJod - costPerPieceJod;
              const profitPercent = costPerPieceJod > 0 ? (profitPerPieceJod / costPerPieceJod) * 100 : 0;
              const lineTotalJod = Math.max(0, item.packageQuantity * item.pkgPriceJod - item.discountJod);

              return (
                <div
                  key={item.tempId}
                  className="bg-slate-950 border border-slate-800 p-3 rounded-2xl space-y-2 relative group hover:border-slate-700 transition"
                >
                  {/* Row Header */}
                  <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                        {index + 1}
                      </span>
                      <h4 className="font-extrabold text-slate-100 text-xs">{item.productName}</h4>
                      <span className="text-[10px] text-slate-500 font-mono">({item.productSku})</span>
                    </div>

                    <button
                      onClick={() => handleRemoveItem(index)}
                      className="text-rose-400 hover:text-rose-300 p-1 rounded-lg hover:bg-rose-950/50 transition flex items-center gap-1 text-[10px] font-bold"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف الصنف</span>
                    </button>
                  </div>

                  {/* Quantity & Unit Configurations */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                    {/* Purchase Unit Name */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-slate-400">وحدة الشراء (الطرد)</label>
                      <select
                        value={item.purchaseUnitName}
                        onChange={(e) => updateItemField(index, 'purchaseUnitName', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-200"
                      >
                        {COMMON_PURCHASE_UNITS.map((u) => (
                          <option key={u.code} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Received Package Quantity - INTEGER ONLY */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-amber-400">عدد الطرود (صحيح)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.packageQuantity}
                        onChange={(e) => updateItemField(index, 'packageQuantity', e.target.value)}
                        className="w-full bg-slate-900 border border-amber-500/40 rounded-lg px-2 py-1 text-xs font-extrabold text-white text-center focus:border-amber-400 outline-none"
                      />
                    </div>

                    {/* Units Per Package - INTEGER ONLY */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-slate-400">محتوى الطرد ({item.baseUnitName})</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.unitsPerPackage}
                        onChange={(e) => updateItemField(index, 'unitsPerPackage', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-100 text-center"
                      />
                    </div>

                    {/* Price Per Package (JOD) */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-slate-400">سعر الطرد ({CURRENCY})</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.pkgPriceJod}
                        onChange={(e) => updateItemField(index, 'pkgPriceJod', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-emerald-400 text-center"
                      />
                    </div>

                    {/* Selling Price Per Piece (JOD) */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-blue-400">سعر بيع القطعة ({CURRENCY})</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.sellingPriceJod}
                        onChange={(e) => updateItemField(index, 'sellingPriceJod', e.target.value)}
                        className="w-full bg-slate-900 border border-blue-500/30 rounded-lg px-2 py-1 text-xs font-bold text-blue-300 text-center"
                      />
                    </div>

                    {/* Discount (JOD) */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-slate-400">خصم الصنف ({CURRENCY})</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.discountJod}
                        onChange={(e) => updateItemField(index, 'discountJod', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-rose-400 text-center"
                      />
                    </div>
                  </div>

                  {/* Calculations breakdown banner */}
                  <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl space-y-1.5 text-[11px] font-bold">
                    <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-1">
                      <div className="text-blue-400 flex items-center gap-1.5 flex-wrap">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          إجمالي القطع: {item.packageQuantity} {item.purchaseUnitName} × {item.unitsPerPackage} {item.baseUnitName} ={' '}
                          <strong className="text-white font-extrabold">{formatWholesaleInventory(totalBaseUnits, item.unitsPerPackage, item.purchaseUnitName, item.baseUnitName).fullFormatted}</strong>
                        </span>
                      </div>

                      <div className="text-slate-300 flex items-center gap-3 flex-wrap text-[10px]">
                        <span>تكلفة القطعة: <strong className="text-amber-400">{costPerPieceJod.toFixed(3)} {CURRENCY}</strong></span>
                        <span>الربح/قطعة: <strong className={profitPerPieceJod >= 0 ? "text-emerald-400" : "text-rose-400"}>{profitPerPieceJod.toFixed(3)} {CURRENCY} ({profitPercent.toFixed(1)}%)</strong></span>
                        <span>الإجمالي: <strong className="text-emerald-400 text-xs">{lineTotalJod.toFixed(3)} {CURRENCY}</strong></span>
                      </div>
                    </div>

                    {/* Checkbox: Update as new default purchase price */}
                    <div className="flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        id={`update-default-${item.tempId}`}
                        checked={Boolean(item.updateDefaultPrice)}
                        onChange={(e) => updateItemField(index, 'updateDefaultPrice', e.target.checked)}
                        className="w-3.5 h-3.5 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <label
                        htmlFor={`update-default-${item.tempId}`}
                        className="text-slate-300 cursor-pointer hover:text-white select-none"
                      >
                        تحديث هذا كالسعر الافتراضي الجديد للشراء والسعر بالمستر
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Financial Summary & Direct Payment Section */}
      <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-100">إجماليات سند الاستلام والدفعات</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Financial Breakdown Inputs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-bold">مجموع الأصناف المستلمة:</span>
              <span className="font-mono font-extrabold text-slate-200">{itemsSubtotalJod.toFixed(3)} {CURRENCY}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400">خصم السند ({CURRENCY})</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={discountJod}
                  onChange={(e) => setDiscountJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs font-bold text-rose-400 text-center"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400">أجور التوصيل/النقل</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={deliveryFeeJod}
                  onChange={(e) => setDeliveryFeeJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs font-bold text-slate-200 text-center"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400">الضريبة ({CURRENCY})</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={taxJod}
                  onChange={(e) => setTaxJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-1 text-xs font-bold text-slate-200 text-center"
                />
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl flex items-center justify-between">
              <span className="font-extrabold text-slate-100">صافي المباشر المستحق للمورد:</span>
              <span className="font-extrabold text-emerald-400 text-sm">
                {grandTotalJod.toFixed(3)} {CURRENCY}
              </span>
            </div>
          </div>

          {/* Payment Method & Paid Amount */}
          <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400">طريقة الدفع للمورد</label>
              <div className="grid grid-cols-3 gap-1 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-1.5 rounded-lg border transition ${
                    paymentMethod === 'cash'
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  نقدي (Cash)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('deferred')}
                  className={`py-1.5 rounded-lg border transition ${
                    paymentMethod === 'deferred'
                      ? 'bg-amber-600 text-white border-amber-500 shadow'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  آجل (على الحساب)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cliq')}
                  className={`py-1.5 rounded-lg border transition ${
                    paymentMethod === 'cliq'
                      ? 'bg-purple-600 text-white border-purple-500 shadow'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  CliQ / تحويل
                </button>
              </div>
            </div>

            {paymentMethod !== 'deferred' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-400">المبلغ المدفوع فوراً ({CURRENCY})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={amountPaidJod}
                    onChange={(e) => setAmountPaidJod(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs font-bold text-emerald-400 text-center"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400">رقم الحوالة/المرجع</label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="رقم المرجع اختياري"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-slate-200"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
              <span className="text-slate-400 font-bold">المتبقي كذمة للمورد:</span>
              <span className={`font-extrabold ${amountDueJod > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {amountDueJod.toFixed(3)} {CURRENCY}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات عامة على الشحنة..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
          />
          <input
            type="text"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="ملاحظات إدارية داخلية (غير مطبوعة)..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200"
          />
        </div>
      </div>

      {/* Main Action Button */}
      <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="bg-slate-800 text-slate-300 border border-slate-700 px-4 py-2.5 rounded-xl font-bold hover:bg-slate-700 transition"
        >
          إلغاء
        </button>

        <button
          type="button"
          onClick={handleSubmitReceipt}
          disabled={isSubmitting || items.length === 0}
          className="bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold px-6 py-2.5 rounded-xl shadow-lg shadow-emerald-900/30 transition flex items-center gap-2 text-xs disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>جاري حفظ سند الاستلام وتحديث المخزون...</span>
            </>
          ) : (
            <>
              <PackageCheck className="w-4 h-4 text-white" />
              <span>حفظ واستلام البضاعة</span>
            </>
          )}
        </button>
      </div>

      {/* Inline Add Supplier Sub-Modal */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl w-full max-w-md space-y-3 text-right">
            <h3 className="font-extrabold text-slate-100 text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              <span>إضافة مورد جديد للقائمة</span>
            </h3>

            <div className="space-y-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400">اسم شركة المورد *</label>
                <input
                  type="text"
                  value={newSupplierCompany}
                  onChange={(e) => setNewSupplierCompany(e.target.value)}
                  placeholder="مثال: شركة القدس للتوريدات"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400">اسم مسؤول التواصل</label>
                <input
                  type="text"
                  value={newSupplierContact}
                  onChange={(e) => setNewSupplierContact(e.target.value)}
                  placeholder="اسم الشخص المسؤول"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400">رقم الهاتف</label>
                <input
                  type="text"
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  placeholder="079XXXXXXX"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddSupplierModal(false)}
                className="bg-slate-800 text-slate-300 px-3 py-1.5 rounded-xl font-bold text-xs"
              >
                إلغاء
              </button>
              <button
                onClick={handleCreateSupplier}
                disabled={isAddingSupplier || !newSupplierCompany.trim()}
                className="bg-blue-600 text-white px-4 py-1.5 rounded-xl font-bold text-xs hover:bg-blue-500 transition flex items-center gap-1"
              >
                {isAddingSupplier ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>حفظ المورد</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
