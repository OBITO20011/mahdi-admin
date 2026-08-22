/**
 * Nawasrah Business Manager - Create Direct Goods Receipt Modal
 * Wholesale Store Goods Receiving Form (Direct receiving bypassing PO approval)
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { formatWholesaleInventory } from '../../utils/inventoryFormatter';
import {
  calculateReceivingLine,
  jodToMinorUnits,
  minorUnitsToJod,
  normalizeIntegerQuantity,
} from '../../utils/receivingCalculations';
import {
  DirectReceiptItemInput,
  DirectReceiptForm,
  ReceivingProduct,
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
import { CreateSupplierModal } from '../purchases/CreateSupplierModal';
import { CURRENCY, PURCHASE_PACKAGE_OPTIONS } from '../../constants';
import {
  Building2,
  ChevronLeft,
  PackageCheck,
  Search,
  Plus,
  Minus,
  Trash2,
  Calendar,
  DollarSign,
  FileText,
  Loader2,
  AlertCircle,
  Info,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';

interface CreateDirectReceiptModalProps {
  onClose: () => void;
  onSuccess?: (receiptData: any) => void;
}

export const CreateDirectReceiptModal: React.FC<CreateDirectReceiptModalProps> = ({
  onClose,
  onSuccess,
}) => {
  const { setToast, refreshProductsFromSupabase } = useAppStore();

  // Reference Data States
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ReceivingProduct[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingRefData, setIsLoadingRefData] = useState<boolean>(true);
  const [referenceDataError, setReferenceDataError] = useState<string | null>(null);

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
    })[]
  >([]);

  // Product Search State
  const [productSearch, setProductSearch] = useState<string>('');
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // Shared Supplier Modal
  const [showAddSupplierModal, setShowAddSupplierModal] = useState<boolean>(false);

  // Submitting state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // Load Initial Reference Data
  const loadReferenceData = useCallback(async () => {
    setIsLoadingRefData(true);
    setReferenceDataError(null);
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

      const preferredWarehouse =
        whs.find((warehouse) =>
          /الرمثا|النواصرة|نواصره/.test(
            `${warehouse.nameAr ?? ''} ${warehouse.location ?? ''}`
          )
        ) ?? whs[0];
      setSelectedWarehouseId(preferredWarehouse?.id ?? '');
      setSelectedBranchId(preferredWarehouse?.branchId ?? '');
    } catch (err) {
      console.error('Error loading receiving metadata:', err);
      setSuppliers([]);
      setProducts([]);
      setUnits([]);
      setWarehouses([]);
      setBranches([]);
      setSelectedSupplierId('');
      setSelectedWarehouseId('');
      setSelectedBranchId('');
      setReferenceDataError(
        err instanceof Error
          ? err.message
          : 'تعذر تحميل بيانات الاستلام من Supabase.'
      );
    } finally {
      setIsLoadingRefData(false);
    }
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    const selectedWarehouse = warehouses.find(
      (warehouse) => warehouse.id === selectedWarehouseId
    );
    setSelectedBranchId(selectedWarehouse?.branchId ?? '');
  }, [selectedWarehouseId, warehouses]);

  // Filtered Products for Search Dropdown
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products.slice(0, 8);
    const query = productSearch.toLowerCase().trim();
    return products.filter(
      (p) =>
        (p.nameAr && p.nameAr.toLowerCase().includes(query)) ||
        (p.sku && p.sku.toLowerCase().includes(query)) ||
        (p.barcode && p.barcode.toLowerCase().includes(query))
    );
  }, [products, productSearch]);

  // Add Product to Receipt Rows
  const handleSelectProduct = (prod: ReceivingProduct) => {
    const unitsPerPackage = normalizeIntegerQuantity(prod.unitsPerPackage);
    const defaultPkgPrice = minorUnitsToJod(
      prod.defaultPackagePriceInMinorUnits ||
        prod.costPriceInMinorUnits * unitsPerPackage
    );

    const newItem: DirectReceiptItemInput & {
      tempId: string;
      pkgPriceJod: number;
      discountJod: number;
    } = {
      tempId: `${prod.id}-${Date.now()}`,
      productId: prod.id,
      productName: prod.nameAr,
      productSku: prod.sku,
      productBarcode: prod.barcode || '',
      purchaseUnitId: prod.purchaseUnitId,
      baseUnitId: prod.baseUnitId,
      purchaseUnitName: prod.purchaseUnitName,
      baseUnitName: prod.baseUnitName,
      packageQuantity: 1, // Whole package INT
      unitsPerPackage: unitsPerPackage, // Whole package INT
      packagePriceInMinorUnits: jodToMinorUnits(defaultPkgPrice),
      updateProductDefaults: true,
      discountInMinorUnits: 0,
      pkgPriceJod: defaultPkgPrice,
      discountJod: 0,
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
        item.packageQuantity = normalizeIntegerQuantity(Number(value));
      } else if (field === 'unitsPerPackage') {
        // MUST BE INTEGER >= 1
        item.unitsPerPackage = normalizeIntegerQuantity(Number(value));
      } else if (field === 'purchaseUnitName') {
        item.purchaseUnitName = String(value);
        const selectedOption = PURCHASE_PACKAGE_OPTIONS.find(
          (option) => option.nameAr === item.purchaseUnitName
        );
        const selectedUnit = units.find(
          (unit) =>
            unit.code === selectedOption?.code ||
            unit.nameAr === item.purchaseUnitName
        );
        item.purchaseUnitId = selectedUnit?.id;
      } else if (field === 'baseUnitName') {
        item.baseUnitName = String(value);
      } else if (field === 'pkgPriceJod') {
        item.pkgPriceJod = Math.max(0, Number(value) || 0);
        item.packagePriceInMinorUnits = jodToMinorUnits(item.pkgPriceJod);
      } else if (field === 'discountJod') {
        const maxDiscount = item.packageQuantity * item.pkgPriceJod;
        item.discountJod = Math.min(maxDiscount, Math.max(0, Number(value) || 0));
        item.discountInMinorUnits = jodToMinorUnits(item.discountJod);
      } else if (field === 'updateProductDefaults') {
        item.updateProductDefaults = Boolean(value);
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

  const handleSupplierCreated = (supplier: Supplier) => {
    setSuppliers((current) => {
      const next = current.filter((item) => item.id !== supplier.id);
      return [...next, supplier].sort((a, b) =>
        a.companyName.localeCompare(b.companyName, 'ar')
      );
    });
    setSelectedSupplierId(supplier.id);
    setShowAddSupplierModal(false);
  };

  // Subtotal Calculation in JOD
  const itemsSubtotalJod = useMemo(() => {
    return items.reduce((sum, item) => {
      const lineSub = item.packageQuantity * item.pkgPriceJod - item.discountJod;
      return sum + Math.max(0, lineSub);
    }, 0);
  }, [items]);

  const grandTotalJod = useMemo(() => {
    const tot = itemsSubtotalJod + deliveryFeeJod + taxJod;
    return Math.max(0, tot);
  }, [itemsSubtotalJod, deliveryFeeJod, taxJod]);

  const amountDueJod = useMemo(() => {
    const due = grandTotalJod - amountPaidJod;
    return Math.max(0, due);
  }, [grandTotalJod, amountPaidJod]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === selectedWarehouseId),
    [selectedWarehouseId, warehouses]
  );
  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId),
    [branches, selectedBranchId]
  );

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
      if (
        it.productionDate &&
        it.expiryDate &&
        new Date(it.expiryDate) < new Date(it.productionDate)
      ) {
        setToast(
          `تاريخ انتهاء الصنف رقم ${i + 1} (${it.productName}) لا يمكن أن يسبق تاريخ الإنتاج.`,
          'error'
        );
        return;
      }
    }

    // Validate direct payment
    if (amountPaidJod > grandTotalJod) {
      setToast(
        `المبلغ المدفوع (${amountPaidJod.toFixed(3)}) لا يمكن أن يتجاوز إجمالي سند الاستلام (${grandTotalJod.toFixed(3)}).`,
        'error'
      );
      return;
    }

    setIsSubmitting(true);

    const payload: DirectReceiptForm = {
      supplierId: selectedSupplierId,
      warehouseId: selectedWarehouseId,
      branchId: selectedBranchId || undefined,
      supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
      supplierInvoiceDate: supplierInvoiceDate || undefined,
      receivedAt: receivedAt || new Date().toISOString(),
      deliveryFeeInMinorUnits: jodToMinorUnits(deliveryFeeJod),
      // Receipt-level discount is intentionally disabled. Supplier discounts
      // stay attached to their product lines so inventory cost remains exact.
      discountInMinorUnits: 0,
      taxInMinorUnits: jodToMinorUnits(taxJod),
      amountPaidInMinorUnits: jodToMinorUnits(amountPaidJod),
      paymentMethod,
      paymentReference: paymentReference.trim() || undefined,
      notes: notes.trim() || undefined,
      internalNotes: internalNotes.trim() || undefined,
      idempotencyKey: idempotencyKeyRef.current,
      items: items.map((item) => ({
        productId: item.productId,
        purchaseUnitId: item.purchaseUnitId,
        baseUnitId: item.baseUnitId,
        purchaseUnitName: item.purchaseUnitName,
        baseUnitName: item.baseUnitName,
        packageQuantity: Math.floor(item.packageQuantity), // Strict Integer
        unitsPerPackage: Math.floor(item.unitsPerPackage), // Strict Integer
        packagePriceInMinorUnits: jodToMinorUnits(item.pkgPriceJod),
        updateProductDefaults: Boolean(item.updateProductDefaults),
        discountInMinorUnits: jodToMinorUnits(item.discountJod),
        batchNumber: item.batchNumber,
        productionDate: item.productionDate,
        expiryDate: item.expiryDate,
        notes: item.notes,
      })),
    };

    const res = await createDirectSupplierReceiptInSupabase(payload);

    if (res.success && res.data) {
      await refreshProductsFromSupabase();
      idempotencyKeyRef.current = crypto.randomUUID();

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

  if (referenceDataError) {
    return (
      <div
        dir="rtl"
        className="m-2 rounded-2xl border border-rose-500/30 bg-rose-950/30 p-6 text-center"
      >
        <AlertCircle className="mx-auto mb-3 h-9 w-9 text-rose-400" />
        <h3 className="text-sm font-extrabold text-rose-100">
          تعذر تحميل بيانات الاستلام
        </h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-rose-200/80">
          {referenceDataError}
        </p>
        <button
          type="button"
          onClick={loadReferenceData}
          className="mt-4 rounded-xl bg-rose-500 px-4 py-2 text-xs font-extrabold text-white transition hover:bg-rose-400"
        >
          إعادة المحاولة
        </button>
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
            <span className="font-bold text-slate-100">ابدأ بالمورد والمستودع</span>
          </div>
          <button
            onClick={() => setShowAddSupplierModal(true)}
            className="bg-blue-600/20 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-xl font-bold text-[11px] hover:bg-blue-600/30 transition flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مورد جديد</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          {/* Branch is derived from the warehouse to prevent mismatches */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-400">موقع الاستلام المعتمد</label>
            <div className="min-h-[34px] rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3 py-2">
              <p className="text-xs font-extrabold text-emerald-300">
                {selectedWarehouse?.nameAr || 'اختر المستودع'}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {selectedWarehouse?.location || selectedBranch?.nameAr || 'سيتم تحديد الفرع تلقائياً'}
              </p>
            </div>
          </div>

        </div>

        <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-slate-400 marker:hidden">
            معلومات سند إضافية (اختياري)
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        </details>
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

        <div className="rounded-xl border border-blue-900/70 bg-blue-950/30 px-3 py-2 text-[11px] font-bold leading-5 text-blue-200">
          اختر الصنف، ثم أدخل عدد الطرود التي وصلت فعليًا ومحتوى كل طرد.
          مثال: 3 كراتين × 5 حبات = 15 حبة تُضاف للمخزون.
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
                filteredProducts.map((prod) => {
                  const warehouseBalance = prod.inventoryBalances.find(
                    (balance) => balance.warehouseId === selectedWarehouseId
                  );
                  const warehouseAvailable = warehouseBalance?.availableQuantity ?? 0;

                  return (
                    <div
                      key={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-900 border border-transparent hover:border-slate-800 transition cursor-pointer"
                    >
                      <div>
                        <h4 className="font-bold text-slate-100 text-xs">{prod.nameAr}</h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span>SKU: {prod.sku}</span>
                          {prod.barcode && <span>| الباركود: {prod.barcode}</span>}
                          <span>| الوحدة الأساسية: {prod.baseUnitName}</span>
                          <span>| طرد الشراء: {prod.purchaseUnitName} × {prod.unitsPerPackage}</span>
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-cyan-300">
                          المتاح الآن في {selectedWarehouse?.nameAr || 'المستودع'}:{' '}
                          {formatWholesaleInventory(
                            warehouseAvailable,
                            prod.unitsPerPackage,
                            prod.purchaseUnitName,
                            prod.baseUnitName
                          ).fullFormatted}
                        </p>
                      </div>
                      <div className="text-left">
                        <span className="text-emerald-400 font-extrabold text-xs block">
                          {minorUnitsToJod(prod.costPriceInMinorUnits).toFixed(3)} {CURRENCY}
                        </span>
                        <span className="text-[10px] text-slate-500 font-semibold">اضغط للإضافة +</span>
                      </div>
                    </div>
                  );
                })
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
              const lineCalculation = calculateReceivingLine({
                packageQuantity: item.packageQuantity,
                unitsPerPackage: item.unitsPerPackage,
                packagePriceInMinorUnits: jodToMinorUnits(item.pkgPriceJod),
                discountInMinorUnits: jodToMinorUnits(item.discountJod),
              });
              const totalBaseUnits = lineCalculation.totalBaseUnits;
              const costPerPieceJod = minorUnitsToJod(
                lineCalculation.effectiveUnitCostInMinorUnits
              );
              const lineTotalJod = minorUnitsToJod(
                lineCalculation.lineTotalInMinorUnits
              );
              const sourceProduct = products.find(
                (product) => product.id === item.productId
              );
              const warehouseBalance = sourceProduct?.inventoryBalances.find(
                (balance) => balance.warehouseId === selectedWarehouseId
              );
              const stockBefore = warehouseBalance?.onHandQuantity ?? 0;
              const reservedBefore = warehouseBalance?.reservedQuantity ?? 0;
              const availableBefore = warehouseBalance?.availableQuantity ?? 0;
              const stockAfter = stockBefore + totalBaseUnits;
              const availableAfter = availableBefore + totalBaseUnits;

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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {/* Purchase Unit Name */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-slate-400">وحدة الشراء (الطرد)</label>
                      <select
                        value={item.purchaseUnitName}
                        onChange={(e) => updateItemField(index, 'purchaseUnitName', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-200"
                      >
                        {PURCHASE_PACKAGE_OPTIONS.map((unitOption) => (
                          <option key={unitOption.code} value={unitOption.nameAr}>
                            {unitOption.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Received Package Quantity - INTEGER ONLY */}
                    <div className="col-span-2 space-y-1 rounded-xl border border-amber-500/40 bg-amber-950/20 p-2">
                      <label className="block text-[11px] font-black text-amber-300">
                        عدد الطرود المستلمة ({item.purchaseUnitName})
                      </label>
                      <div className="grid grid-cols-[2.25rem_1fr_2.25rem] gap-1.5">
                        <button
                          type="button"
                          aria-label={`إنقاص عدد طرود ${item.productName}`}
                          disabled={item.packageQuantity <= 1}
                          onClick={() =>
                            updateItemField(
                              index,
                              'packageQuantity',
                              item.packageQuantity - 1
                            )
                          }
                          className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200 transition hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <input
                          aria-label={`عدد الطرود المستلمة للصنف ${item.productName}`}
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={item.packageQuantity}
                          onChange={(e) =>
                            updateItemField(index, 'packageQuantity', e.target.value)
                          }
                          className="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-2 py-2 text-center text-base font-black text-white outline-none focus:border-amber-300"
                        />
                        <button
                          type="button"
                          aria-label={`زيادة عدد طرود ${item.productName}`}
                          onClick={() =>
                            updateItemField(
                              index,
                              'packageQuantity',
                              item.packageQuantity + 1
                            )
                          }
                          className="flex items-center justify-center rounded-lg border border-amber-600/60 bg-amber-600/20 text-amber-200 transition hover:bg-amber-600/30"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-[9px] font-bold text-amber-200/70">
                        اكتب عدد الكراتين أو الصناديق التي وصلت، وليس عدد الحبات.
                      </p>
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
                          الكمية التي ستدخل المخزون: {item.packageQuantity}{' '}
                          {item.purchaseUnitName} × {item.unitsPerPackage}{' '}
                          {item.baseUnitName} ={' '}
                          <strong className="font-extrabold text-white">
                            {totalBaseUnits} {item.baseUnitName}
                          </strong>
                          <span className="text-slate-400">
                            {' '}({formatWholesaleInventory(totalBaseUnits, item.unitsPerPackage, item.purchaseUnitName, item.baseUnitName).fullFormatted})
                          </span>
                        </span>
                      </div>

                      <div className="text-slate-300 flex items-center gap-3 flex-wrap text-[10px]">
                        <span>تكلفة {item.baseUnitName} المحسوبة: <strong className="text-amber-400">{costPerPieceJod.toFixed(3)} {CURRENCY}</strong></span>
                        <span>الإجمالي: <strong className="text-emerald-400 text-xs">{lineTotalJod.toFixed(3)} {CURRENCY}</strong></span>
                      </div>
                    </div>

                    <details className="group rounded-lg border border-slate-800 bg-slate-950/30 p-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] text-slate-400 marker:hidden">
                        تفاصيل الرصيد قبل/بعد وخيارات الصنف
                        <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
                      </summary>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1">
                        <span className="block text-[9px] text-slate-500">المخزون الفعلي قبل</span>
                        <strong className="text-slate-200">
                          {formatWholesaleInventory(
                            stockBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1">
                        <span className="block text-[9px] text-slate-500">المحجوز للطلبات</span>
                        <strong className="text-amber-300">
                          {formatWholesaleInventory(
                            reservedBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1">
                        <span className="block text-[9px] text-slate-500">المتاح للبيع قبل</span>
                        <strong className="text-cyan-300">
                          {formatWholesaleInventory(
                            availableBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-2 py-1">
                        <span className="block text-[9px] text-emerald-300/70">الكمية الداخلة</span>
                        <strong className="text-emerald-300">
                          +{formatWholesaleInventory(
                            totalBaseUnits,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="col-span-2 rounded-lg border border-blue-500/30 bg-blue-950/25 px-2 py-1 sm:col-span-1">
                        <span className="block text-[9px] text-blue-300/70">بعد الاستلام / المتاح</span>
                        <strong className="text-blue-200">
                          {formatWholesaleInventory(
                            stockAfter,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}{' '}
                          / {formatWholesaleInventory(
                            availableAfter,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                    </div>

                    {/* Checkbox: Update as new default purchase price */}
                    <div className="flex items-center gap-2 text-[10px]">
                      <input
                        type="checkbox"
                        id={`update-default-${item.tempId}`}
                        checked={Boolean(item.updateProductDefaults)}
                        onChange={(e) =>
                          updateItemField(index, 'updateProductDefaults', e.target.checked)
                        }
                        className="w-3.5 h-3.5 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <label
                        htmlFor={`update-default-${item.tempId}`}
                        className="text-slate-300 cursor-pointer hover:text-white select-none"
                      >
                        حفظ وحدة الشراء ومحتوى الطرد وسعر الشراء كبيانات افتراضية للصنف
                      </label>
                    </div>
                    </details>
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
          <span className="font-bold text-slate-100">ملخص الاستلام</span>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-center">
          <div>
            <span className="block text-[9px] text-slate-500">إجمالي السند</span>
            <strong className="text-slate-100">{grandTotalJod.toFixed(3)}</strong>
          </div>
          <div>
            <span className="block text-[9px] text-slate-500">المدفوع</span>
            <strong className="text-emerald-300">{amountPaidJod.toFixed(3)}</strong>
          </div>
          <div>
            <span className="block text-[9px] text-slate-500">ذمة المورد</span>
            <strong className={amountDueJod > 0 ? 'text-rose-300' : 'text-emerald-300'}>
              {amountDueJod.toFixed(3)}
            </strong>
          </div>
        </div>

        <details className="group rounded-xl border border-slate-800 bg-slate-950/40 p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-slate-400 marker:hidden">
            الدفعة وأجور النقل والضريبة والملاحظات
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
          <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Financial Breakdown Inputs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-bold">مجموع الأصناف المستلمة:</span>
              <span className="font-mono font-extrabold text-slate-200">{itemsSubtotalJod.toFixed(3)} {CURRENCY}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
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
              <div className="grid grid-cols-2 gap-1 text-[10px] font-bold">
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400">المبلغ المدفوع الآن ({CURRENCY})</label>
                <input
                  type="number"
                  min="0"
                  max={grandTotalJod}
                  step="0.001"
                  value={amountPaidJod}
                  onChange={(e) => setAmountPaidJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs font-bold text-emerald-400 text-center"
                />
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setAmountPaidJod(grandTotalJod)}
                    className="rounded-lg bg-emerald-600/15 px-2 py-1 text-[9px] font-bold text-emerald-300"
                  >
                    دفع كامل
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountPaidJod(0)}
                    className="rounded-lg bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300"
                  >
                    بدون دفعة الآن
                  </button>
                </div>
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

            <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-900">
              <span className="text-slate-400 font-bold">
                المتبقي يُسجل تلقائياً كذمة للمورد:
              </span>
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
        </details>
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

      <CreateSupplierModal
        isOpen={showAddSupplierModal}
        onClose={() => setShowAddSupplierModal(false)}
        onSuccess={handleSupplierCreated}
      />
    </div>
  );
};
