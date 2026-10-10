import {FormFields, UiButton, formatJod, Card} from '../../components/ui';
/**
 * Nawasrah Business Manager - Create Direct Goods Receipt Modal
 * Wholesale Store Goods Receiving Form (Direct receiving bypassing PO approval)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStoreActions } from '../../stores/useAppStore';
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
  type LegacyReceiptReplayResolution,
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
  DollarSign,
  Loader2,
  AlertCircle,
  Info,
  X,
} from 'lucide-react';

interface CreateDirectReceiptModalProps {
  onClose: () => void;
  onSuccess?: (receiptData: any) => void;
  initialProductId?: string;
}

export const CreateDirectReceiptModal: React.FC<CreateDirectReceiptModalProps> = ({
  onClose,
  onSuccess,
  initialProductId,
}) => {
  const { setToast, refreshProductsFromSupabase } = useAppStoreActions();

  // Reference Data States
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ReceivingProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsFetchError, setProductsFetchError] = useState<string | null>(null);
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
  const [legacyReplayResolution, setLegacyReplayResolution] =
    useState<LegacyReceiptReplayResolution | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const didPreselectProductRef = useRef(false);
  const selectedProductsRef = useRef<Map<string, ReceivingProduct>>(new Map());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load Initial Reference Data
  const loadReferenceData = useCallback(async () => {
    setIsLoadingRefData(true);
    setReferenceDataError(null);
    try {
      const [sups, unts, whs, brs] = await Promise.all([
        fetchSuppliersForReceivingFromSupabase(),
        fetchUnitsForReceivingFromSupabase(),
        fetchWarehousesForReceivingFromSupabase(),
        fetchBranchesForReceivingFromSupabase(),
      ]);

      setSuppliers(sups);
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

  useEffect(() => {
    if (!isSearchFocused) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoadingProducts(true);
      setProductsFetchError(null);
      fetchProductsForReceivingFromSupabase({
        search: productSearch,
        limit: 20,
      })
        .then((result) => {
          if (active) setProducts(result);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setProducts([]);
          setProductsFetchError(
            error instanceof Error ? error.message : 'تعذر البحث في المنتجات.',
          );
        })
        .finally(() => {
          if (active) setIsLoadingProducts(false);
        });
    }, productSearch.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isSearchFocused, productSearch]);

  const filteredProducts = products;

  // Add Product to Receipt Rows
  const handleSelectProduct = useCallback((prod: ReceivingProduct) => {
    selectedProductsRef.current.set(prod.id, prod);
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
      clientLineId: crypto.randomUUID(),
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
      discountInMinorUnits: 0,
      pkgPriceJod: defaultPkgPrice,
      discountJod: 0,
    };

    setItems((prev) => [...prev, newItem]);
    setProductSearch('');
    setIsSearchFocused(false);
  }, []);

  useEffect(() => {
    if (!initialProductId || didPreselectProductRef.current) return;
    let active = true;
    fetchProductsForReceivingFromSupabase({ productId: initialProductId, limit: 1 })
      .then(([product]) => {
        if (!active || !product || didPreselectProductRef.current) return;
        didPreselectProductRef.current = true;
        handleSelectProduct(product);
      })
      .catch((error) => {
        console.error('Unable to preselect receiving product:', error);
      });
    return () => {
      active = false;
    };
  }, [handleSelectProduct, initialProductId]);

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
    if (legacyReplayResolution) {
      setToast(
        'راجع سند الاستلام الموجود أولًا، ثم أغلق النموذج وابدأ عملية مستقلة فقط عند الحاجة.',
        'error'
      );
      return;
    }
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
    try {

      const payload: DirectReceiptForm = {
        supplierId: selectedSupplierId,
        warehouseId: selectedWarehouseId,
        branchId: selectedBranchId || undefined,
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: supplierInvoiceDate || undefined,
        receivedAt: receivedAt || undefined,
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
          clientLineId: item.clientLineId,
          productId: item.productId,
          purchaseUnitId: item.purchaseUnitId,
          baseUnitId: item.baseUnitId,
          purchaseUnitName: item.purchaseUnitName,
          baseUnitName: item.baseUnitName,
          packageQuantity: Math.floor(item.packageQuantity), // Strict Integer
          unitsPerPackage: Math.floor(item.unitsPerPackage), // Strict Integer
          packagePriceInMinorUnits: jodToMinorUnits(item.pkgPriceJod),
          discountInMinorUnits: jodToMinorUnits(item.discountJod),
          batchNumber: item.batchNumber,
          productionDate: item.productionDate,
          expiryDate: item.expiryDate,
          notes: item.notes,
        })),
      };

      const res = await createDirectSupplierReceiptInSupabase(payload);
      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        setLegacyReplayResolution(null);
        await refreshProductsFromSupabase();
        if (!isMountedRef.current) return;
        idempotencyKeyRef.current = crypto.randomUUID();

        setToast(
          `تم حفظ سند الاستلام ${res.data.receiptNumber} وزيادة المخزون بنجاح (+${res.data.totalInventoryUnitsAdded} وحدة)`,
          'success'
        );

        onSuccess?.(res.data);
        onClose();
      } else {
        setLegacyReplayResolution(
          res.errorCode === 'LEGACY_IDEMPOTENCY_IDENTITY_UNPROVEN'
            ? res.recovery ?? { found: false }
            : null
        );
        setToast(
          res.error || 'فشلت عملية حفظ سند الاستلام وزيادة المخزون.',
          'error'
        );

      }

    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingRefData) {
    return (
      <FormFields className="nw-purchasing-fields p-8 text-center text-nw-text space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-nw-info mx-auto" />
        <p className="text-xs font-bold">جاري تحميل بيانات الموردين والمستودعات...</p>
      </FormFields>
    );
  }

  if (referenceDataError) {
    return (
      <FormFields
        dir="rtl"
        className="nw-purchasing-fields m-2 rounded-2xl border border-nw-border bg-nw-bad-bg p-6 text-center"
      >
        <AlertCircle className="mx-auto mb-3 h-9 w-9 text-nw-bad" />
        <h3 className="text-sm font-extrabold text-nw-bad">
          تعذر تحميل بيانات الاستلام
        </h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-nw-bad">
          {referenceDataError}
        </p>
        <UiButton variant="plain"
          type="button"
          onClick={loadReferenceData}
          className="mt-4 rounded-xl bg-nw-bad-bg px-4 py-2 text-xs font-extrabold text-nw-text transition hover:bg-nw-bad-bg h-auto min-h-11 min-w-0 whitespace-normal"
        >
          إعادة المحاولة
        </UiButton>
      </FormFields>
    );
  }

  return (
    <FormFields dir="rtl" aria-busy={isSubmitting} className="nw-purchasing-fields space-y-4 max-h-[80vh] overflow-y-auto p-1 pr-2 text-xs text-nw-text">
      {legacyReplayResolution && (
        <div
          role="alert"
          className="rounded-2xl border border-nw-border bg-nw-warn-bg p-4 text-nw-warn"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-nw-warn" />
            <div className="space-y-1.5">
              <p className="font-extrabold">توقفت إعادة الإرسال لحماية المخزون والحسابات</p>
              {legacyReplayResolution.found && legacyReplayResolution.receiptNumber ? (
                <p className="leading-6 text-nw-warn">
                  المفتاح مرتبط بسند الاستلام{' '}
                  <span className="font-extrabold">{legacyReplayResolution.receiptNumber}</span>
                  {typeof legacyReplayResolution.totalInMinorUnits === 'number'
                    ? ` بقيمة ${formatJod(minorUnitsToJod(legacyReplayResolution.totalInMinorUnits))} ${CURRENCY}`
                    : ''}
                  . راجع السند الموجود قبل إنشاء عملية مستقلة.
                </p>
              ) : (
                <p className="leading-6 text-nw-warn">
                  تعذر إثبات أن الطلب الحالي مطابق لعملية تاريخية. راجع سندات الاستلام
                  قبل إنشاء عملية مستقلة.
                </p>
              )}
              <p className="text-[11px] leading-5 text-nw-warn">
                لن يعيد النظام الإرسال تلقائيًا، ولن يغيّر المخزون أو رصيد المورد من هذه المحاولة.
              </p>
            </div>
          </div>
        </div>
      )}
      {/* Supplier & Location Info Section */}
      <Card padded={false} className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl space-y-3">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-nw-info" />
            <span className="font-bold text-nw-text">ابدأ بالمورد والمستودع</span>
          </div>
          <UiButton variant="plain" type="button"
            onClick={() => setShowAddSupplierModal(true)}
            className="bg-nw-info-bg text-nw-info border border-nw-border px-2.5 py-1 rounded-xl font-bold text-[11px] hover:bg-nw-info-bg transition flex items-center gap-1 h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة مورد جديد</span>
          </UiButton>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Supplier Dropdown */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-nw-muted">
              المورد المستلم منه <span className="text-nw-bad">*</span>
            </label>
            <select aria-label="المورد"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs font-bold text-nw-text focus:border-nw-border outline-none"
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
            <label className="text-[11px] font-bold text-nw-muted">
              المستودع المستلم <span className="text-nw-bad">*</span>
            </label>
            <select aria-label="المستودع"
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs font-bold text-nw-text focus:border-nw-border outline-none"
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
            <label className="text-[11px] font-bold text-nw-muted">موقع الاستلام المعتمد</label>
            <div className="min-h-[34px] rounded-xl border border-nw-border bg-nw-ok-bg px-3 py-2">
              <p className="text-xs font-extrabold text-nw-ok">
                {selectedWarehouse?.nameAr || 'اختر المستودع'}
              </p>
              <p className="mt-0.5 text-[10px] text-nw-muted">
                {selectedWarehouse?.location || selectedBranch?.nameAr || 'سيتم تحديد الفرع تلقائياً'}
              </p>
            </div>
          </div>

        </div>

        <details className="group rounded-xl border border-nw-border bg-nw-bg p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-nw-muted marker:hidden">
            معلومات سند إضافية (اختياري)
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Supplier Invoice Number */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-nw-muted">رقم فاتورة/إذن المورد</label>
            <input aria-label="مثال: INV-9908"
              type="text"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              placeholder="مثال: INV-9908"
              className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs font-bold text-nw-text focus:border-nw-border outline-none"
            />
          </div>

          {/* Supplier Invoice Date */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-nw-muted">تاريخ فاتورة المورد</label>
            <input aria-label="تاريخ فاتورة المورد"
              type="date"
              value={supplierInvoiceDate}
              onChange={(e) => setSupplierInvoiceDate(e.target.value)}
              className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs font-bold text-nw-text focus:border-nw-border outline-none"
            />
          </div>

          {/* Receiving Date & Time */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-nw-muted">تاريخ ووقت الاستلام الفعلي</label>
            <input aria-label="تاريخ ووقت الاستلام الفعلي"
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs font-bold text-nw-text focus:border-nw-border outline-none"
            />
          </div>
        </div>
        </details>
      </Card>

      {/* Product Search & Addition Section */}
      <Card padded={false} className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl space-y-3 relative">
        <div className="flex items-center justify-between border-b border-nw-border pb-2">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-nw-ok" />
            <span className="font-bold text-nw-text">إضافة البضائع المستلمة (الطرود والأصناف)</span>
          </div>
          <span className="text-[10px] text-nw-muted font-bold">
            عدد الأصناف المضافة: {items.length}
          </span>
        </div>

        <div className="rounded-xl border border-nw-border bg-nw-info-bg px-3 py-2 text-[11px] font-bold leading-5 text-nw-info">
          اختر الصنف، ثم أدخل عدد الطرود التي وصلت فعليًا ومحتوى كل طرد.
          مثال: 3 كراتين × 5 حبات = 15 حبة تُضاف للمخزون.
        </div>

        {/* Product Search Box */}
        <div className="relative">
          <div className="flex items-center bg-nw-bg border border-nw-border rounded-xl px-3 py-2 text-xs focus-within:border-nw-border transition">
            <Search className="w-4 h-4 text-nw-muted ml-2" />
            <input aria-label="ابحث باسم المنتج، SKU، أو الباركود لإضافته لسند الاستلام..."
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              placeholder="ابحث باسم المنتج، SKU، أو الباركود لإضافته لسند الاستلام..."
              className="w-full bg-transparent text-nw-text placeholder-nw-muted outline-none font-bold"
            />
            {productSearch && (
              <UiButton variant="plain" type="button" onClick={() => setProductSearch('')} className="text-nw-muted hover:text-nw-text h-auto min-h-11 min-w-0 whitespace-normal">
                <X className="w-3.5 h-3.5" />
              </UiButton>
            )}
          </div>

          {/* Search Dropdown Results */}
          {isSearchFocused && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-nw-bg border border-nw-border rounded-2xl shadow-2xl z-50 max-h-60 overflow-y-auto p-1.5 space-y-1">
              {isLoadingProducts ? (
                <div className="flex items-center justify-center gap-2 p-4 text-xs font-bold text-nw-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جارٍ البحث في المنتجات…
                </div>
              ) : productsFetchError ? (
                <div className="p-4 text-center text-xs font-bold text-nw-bad">
                  {productsFetchError}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="p-4 text-center text-nw-muted space-y-1">
                  <p>لم يتم العثور على نتائج متطابقة.</p>
                  <p className="text-[10px] text-nw-info font-bold">
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
                    <FormFields
                      key={prod.id}
                      data-receiving-product-result={prod.id}
                      onClick={() => handleSelectProduct(prod)}
                      className="nw-purchasing-fields flex items-center justify-between p-2.5 rounded-xl hover:bg-nw-surface border border-transparent hover:border-nw-border transition cursor-pointer"
                    >
                      <div>
                        <h4 className="font-bold text-nw-text text-xs">{prod.nameAr}</h4>
                        <div className="flex items-center gap-2 text-[10px] text-nw-muted">
                          <span>SKU: {prod.sku}</span>
                          {prod.barcode && <span>| الباركود: {prod.barcode}</span>}
                          <span>| الوحدة الأساسية: {prod.baseUnitName}</span>
                          <span>| طرد الشراء: {prod.purchaseUnitName} × {prod.unitsPerPackage}</span>
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-nw-info">
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
                        <span className="text-nw-ok font-extrabold text-xs block">
                          {formatJod(minorUnitsToJod(prod.costPriceInMinorUnits))} {CURRENCY}
                        </span>
                        <span className="text-[10px] text-nw-muted font-semibold">اضغط للإضافة +</span>
                      </div>
                    </FormFields>
                  );
                })
              )}
              <div className="p-2 border-t border-nw-border text-center">
                <UiButton variant="plain" type="button"
                  onClick={() => setIsSearchFocused(false)}
                  className="text-[10px] font-bold text-nw-muted hover:text-nw-text h-auto min-h-11 min-w-0 whitespace-normal"
                >
                  إغلاق القائمة ✕
                </UiButton>
              </div>
            </div>
          )}
        </div>

        {/* Selected Product Rows */}
        {items.length === 0 ? (
          <div className="border border-dashed border-nw-border rounded-2xl p-6 text-center text-nw-muted space-y-2">
            <PackageCheck className="w-8 h-8 text-nw-muted mx-auto" />
            <p className="font-bold text-xs">لم تقم بإضافة أي بضاعة بعد.</p>
            <p className="text-[11px] text-nw-muted">
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
              const sourceProduct = selectedProductsRef.current.get(item.productId);
              const warehouseBalance = sourceProduct?.inventoryBalances.find(
                (balance) => balance.warehouseId === selectedWarehouseId
              );
              const stockBefore = warehouseBalance?.onHandQuantity ?? 0;
              const reservedBefore = warehouseBalance?.reservedQuantity ?? 0;
              const availableBefore = warehouseBalance?.availableQuantity ?? 0;
              const stockAfter = stockBefore + totalBaseUnits;
              const availableAfter = availableBefore + totalBaseUnits;

              return (
                <FormFields
                  key={item.tempId}
                  className="nw-purchasing-fields bg-nw-bg border border-nw-border p-3 rounded-2xl space-y-2 relative group hover:border-nw-border transition"
                >
                  {/* Row Header */}
                  <div className="flex items-center justify-between border-b border-nw-border pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-nw-info-bg text-nw-info flex items-center justify-center text-[10px] font-bold">
                        {index + 1}
                      </span>
                      <h4 className="font-extrabold text-nw-text text-xs">{item.productName}</h4>
                      <span className="text-[10px] text-nw-muted font-mono">({item.productSku})</span>
                    </div>

                    <UiButton variant="plain" type="button"
                      onClick={() => handleRemoveItem(index)}
                      className="text-nw-bad hover:text-nw-bad p-1 rounded-lg hover:bg-nw-bad-bg transition flex items-center gap-1 text-[10px] font-bold h-auto min-h-11 min-w-0 whitespace-normal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف الصنف</span>
                    </UiButton>
                  </div>

                  {/* Quantity & Unit Configurations */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {/* Purchase Unit Name */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-nw-muted">وحدة الشراء (الطرد)</label>
                      <select aria-label="وحدة الشراء"
                        value={item.purchaseUnitName}
                        onChange={(e) => updateItemField(index, 'purchaseUnitName', e.target.value)}
                        className="w-full bg-nw-surface border border-nw-border rounded-lg px-2 py-1 text-xs font-bold text-nw-text"
                      >
                        {PURCHASE_PACKAGE_OPTIONS.map((unitOption) => (
                          <option key={unitOption.code} value={unitOption.nameAr}>
                            {unitOption.nameAr}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Received Package Quantity - INTEGER ONLY */}
                    <div className="col-span-2 space-y-1 rounded-xl border border-nw-border bg-nw-warn-bg p-2">
                      <label className="block text-[11px] font-black text-nw-warn">
                        عدد الطرود المستلمة ({item.purchaseUnitName})
                      </label>
                      <div className="grid grid-cols-[2.25rem_1fr_2.25rem] gap-1.5">
                        <UiButton variant="plain"
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
                          className="flex items-center justify-center rounded-lg border border-nw-border bg-nw-bg text-nw-text transition hover:border-nw-border hover:text-nw-warn disabled:cursor-not-allowed disabled:opacity-35 h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Minus className="h-4 w-4" />
                        </UiButton>
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
                          className="w-full rounded-lg border border-nw-border bg-nw-bg px-2 py-2 text-center text-base font-black text-nw-text outline-none focus:border-nw-border"
                        />
                        <UiButton variant="plain"
                          type="button"
                          aria-label={`زيادة عدد طرود ${item.productName}`}
                          onClick={() =>
                            updateItemField(
                              index,
                              'packageQuantity',
                              item.packageQuantity + 1
                            )
                          }
                          className="flex items-center justify-center rounded-lg border border-nw-border bg-nw-warn-bg text-nw-warn transition hover:bg-nw-warn-bg h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <Plus className="h-4 w-4" />
                        </UiButton>
                      </div>
                      <p className="text-[9px] font-bold text-nw-warn">
                        اكتب عدد الكراتين أو الصناديق التي وصلت، وليس عدد الحبات.
                      </p>
                    </div>

                    {/* Units Per Package - INTEGER ONLY */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-nw-muted">محتوى الطرد ({item.baseUnitName})</label>
                      <input aria-label="محتوى الطرد ( )"
                        type="number"
                        min="1"
                        step="1"
                        value={item.unitsPerPackage}
                        onChange={(e) => updateItemField(index, 'unitsPerPackage', e.target.value)}
                        className="w-full bg-nw-surface border border-nw-border rounded-lg px-2 py-1 text-xs font-bold text-nw-text text-center"
                      />
                    </div>

                    {/* Price Per Package (JOD) */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-nw-muted">سعر الطرد ({CURRENCY})</label>
                      <input aria-label="سعر الطرد ( )"
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.pkgPriceJod}
                        onChange={(e) => updateItemField(index, 'pkgPriceJod', e.target.value)}
                        className="w-full bg-nw-surface border border-nw-border rounded-lg px-2 py-1 text-xs font-bold text-nw-ok text-center"
                      />
                    </div>

                    {/* Discount (JOD) */}
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-bold text-nw-muted">خصم الصنف ({CURRENCY})</label>
                      <input aria-label="خصم الصنف ( )"
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.discountJod}
                        onChange={(e) => updateItemField(index, 'discountJod', e.target.value)}
                        className="w-full bg-nw-surface border border-nw-border rounded-lg px-2 py-1 text-xs font-bold text-nw-bad text-center"
                      />
                    </div>
                  </div>

                  {/* Calculations breakdown banner */}
                  <Card padded={false} className="bg-nw-surface border border-nw-border p-2 rounded-xl space-y-1.5 text-[11px] font-bold">
                    <div className="flex items-center justify-between gap-2 flex-wrap border-b border-nw-border pb-1">
                      <div className="text-nw-info flex items-center gap-1.5 flex-wrap">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          الكمية التي ستدخل المخزون: {item.packageQuantity}{' '}
                          {item.purchaseUnitName} × {item.unitsPerPackage}{' '}
                          {item.baseUnitName} ={' '}
                          <strong className="font-extrabold text-nw-text">
                            {totalBaseUnits} {item.baseUnitName}
                          </strong>
                          <span className="text-nw-muted">
                            {' '}({formatWholesaleInventory(totalBaseUnits, item.unitsPerPackage, item.purchaseUnitName, item.baseUnitName).fullFormatted})
                          </span>
                        </span>
                      </div>

                      <div className="text-nw-text flex items-center gap-3 flex-wrap text-[10px]">
                        <span>تكلفة {item.baseUnitName} المحسوبة: <strong className="text-nw-warn">{formatJod(costPerPieceJod)} {CURRENCY}</strong></span>
                        <span>الإجمالي: <strong className="text-nw-ok text-xs">{formatJod(lineTotalJod)} {CURRENCY}</strong></span>
                      </div>
                    </div>

                    <details className="group rounded-lg border border-nw-border bg-nw-bg p-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] text-nw-muted marker:hidden">
                        تفاصيل الرصيد قبل/بعد وخيارات الصنف
                        <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
                      </summary>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                      <div className="rounded-lg border border-nw-border bg-nw-bg px-2 py-1">
                        <span className="block text-[9px] text-nw-muted">المخزون الفعلي قبل</span>
                        <strong className="text-nw-text">
                          {formatWholesaleInventory(
                            stockBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-nw-border bg-nw-bg px-2 py-1">
                        <span className="block text-[9px] text-nw-muted">المحجوز للطلبات</span>
                        <strong className="text-nw-warn">
                          {formatWholesaleInventory(
                            reservedBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-nw-border bg-nw-bg px-2 py-1">
                        <span className="block text-[9px] text-nw-muted">المتاح للبيع قبل</span>
                        <strong className="text-nw-info">
                          {formatWholesaleInventory(
                            availableBefore,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="rounded-lg border border-nw-border bg-nw-ok-bg px-2 py-1">
                        <span className="block text-[9px] text-nw-ok">الكمية الداخلة</span>
                        <strong className="text-nw-ok">
                          +{formatWholesaleInventory(
                            totalBaseUnits,
                            item.unitsPerPackage,
                            item.purchaseUnitName,
                            item.baseUnitName
                          ).fullFormatted}
                        </strong>
                      </div>
                      <div className="col-span-2 rounded-lg border border-nw-border bg-nw-info-bg px-2 py-1 sm:col-span-1">
                        <span className="block text-[9px] text-nw-info">بعد الاستلام / المتاح</span>
                        <strong className="text-nw-info">
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

                    <p className="text-[10px] text-nw-muted">الاستلام لا يغيّر أسعار البيع أو افتراضيات الصنف. عدّلها من شاشة الصنف.</p>
                    </details>
                  </Card>
                </FormFields>
              );
            })}
          </div>
        )}
      </Card>

      {/* Financial Summary & Direct Payment Section */}
      <Card padded={false} className="bg-nw-surface border border-nw-border p-3.5 rounded-2xl space-y-3">
        <div className="flex items-center gap-2 border-b border-nw-border pb-2">
          <DollarSign className="w-4 h-4 text-nw-ok" />
          <span className="font-bold text-nw-text">ملخص الاستلام</span>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl border border-nw-border bg-nw-bg p-2.5 text-center">
          <div>
            <span className="block text-[9px] text-nw-muted">إجمالي السند</span>
            <strong className="text-nw-text">{formatJod(grandTotalJod)}</strong>
          </div>
          <div>
            <span className="block text-[9px] text-nw-muted">المدفوع</span>
            <strong className="text-nw-ok">{formatJod(amountPaidJod)}</strong>
          </div>
          <div>
            <span className="block text-[9px] text-nw-muted">ذمة المورد</span>
            <strong className={amountDueJod > 0 ? 'text-nw-bad' : 'text-nw-ok'}>
              {formatJod(amountDueJod)}
            </strong>
          </div>
        </div>

        <details className="group rounded-xl border border-nw-border bg-nw-bg p-2.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-nw-muted marker:hidden">
            الدفعة وأجور النقل والضريبة والملاحظات
            <ChevronLeft className="h-3.5 w-3.5 transition group-open:-rotate-90" />
          </summary>
          <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Financial Breakdown Inputs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-nw-muted font-bold">مجموع الأصناف المستلمة:</span>
              <span className="font-mono font-extrabold text-nw-text">{formatJod(itemsSubtotalJod)} {CURRENCY}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-nw-muted">أجور التوصيل/النقل</label>
                <input aria-label="أجور التوصيل/النقل"
                  type="number"
                  min="0"
                  step="0.001"
                  value={deliveryFeeJod}
                  onChange={(e) => setDeliveryFeeJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-nw-bg border border-nw-border rounded-xl px-2 py-1 text-xs font-bold text-nw-text text-center"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-nw-muted">الضريبة ({CURRENCY})</label>
                <input aria-label="الضريبة ( )"
                  type="number"
                  min="0"
                  step="0.001"
                  value={taxJod}
                  onChange={(e) => setTaxJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-nw-bg border border-nw-border rounded-xl px-2 py-1 text-xs font-bold text-nw-text text-center"
                />
              </div>
            </div>

            <div className="bg-nw-bg border border-nw-border p-2.5 rounded-xl flex items-center justify-between">
              <span className="font-extrabold text-nw-text">صافي المباشر المستحق للمورد:</span>
              <span className="font-extrabold text-nw-ok text-sm">
                {formatJod(grandTotalJod)} {CURRENCY}
              </span>
            </div>
          </div>

          {/* Payment Method & Paid Amount */}
          <div className="space-y-2 bg-nw-bg p-3 rounded-xl border border-nw-border">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-nw-muted">طريقة الدفع للمورد</label>
              <div className="grid grid-cols-2 gap-1 text-[10px] font-bold">
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-1.5 rounded-lg border transition ${
                    paymentMethod === 'cash'
                      ? 'bg-nw-ok-bg text-nw-text border-nw-border shadow'
                      : 'bg-nw-surface border-nw-border text-nw-muted'
                  }`}
                >
                  نقدي (Cash)
                </UiButton>
                <UiButton variant="plain"
                  type="button"
                  onClick={() => setPaymentMethod('cliq')}
                  className={`py-1.5 rounded-lg border transition ${
                    paymentMethod === 'cliq'
                      ? 'bg-nw-info-bg text-nw-text border-nw-border shadow'
                      : 'bg-nw-surface border-nw-border text-nw-muted'
                  }`}
                >
                  CliQ / تحويل
                </UiButton>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-nw-muted">المبلغ المدفوع الآن ({CURRENCY})</label>
                <input aria-label="المبلغ المدفوع الآن ( )"
                  type="number"
                  min="0"
                  max={grandTotalJod}
                  step="0.001"
                  value={amountPaidJod}
                  onChange={(e) => setAmountPaidJod(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-nw-surface border border-nw-border rounded-xl px-2 py-1.5 text-xs font-bold text-nw-ok text-center"
                />
                <div className="mt-1 flex items-center gap-1">
                  <UiButton variant="plain"
                    type="button"
                    onClick={() => setAmountPaidJod(grandTotalJod)}
                    className="rounded-lg bg-nw-ok-bg px-2 py-1 text-[9px] font-bold text-nw-ok h-auto min-h-11 min-w-0 whitespace-normal"
                  >
                    دفع كامل
                  </UiButton>
                  <UiButton variant="plain"
                    type="button"
                    onClick={() => setAmountPaidJod(0)}
                    className="rounded-lg bg-nw-surface-2 px-2 py-1 text-[9px] font-bold text-nw-text h-auto min-h-11 min-w-0 whitespace-normal"
                  >
                    بدون دفعة الآن
                  </UiButton>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-nw-muted">رقم الحوالة/المرجع</label>
                <input aria-label="رقم المرجع اختياري"
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  placeholder="رقم المرجع اختياري"
                  className="w-full bg-nw-surface border border-nw-border rounded-xl px-2 py-1.5 text-xs text-nw-text"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-nw-border">
              <span className="text-nw-muted font-bold">
                المتبقي يُسجل تلقائياً كذمة للمورد:
              </span>
              <span className={`font-extrabold ${amountDueJod > 0 ? 'text-nw-bad' : 'text-nw-ok'}`}>
                {formatJod(amountDueJod)} {CURRENCY}
              </span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input aria-label="ملاحظات عامة على الشحنة..."
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ملاحظات عامة على الشحنة..."
            className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-1.5 text-xs text-nw-text"
          />
          <input aria-label="ملاحظات إدارية داخلية (غير مطبوعة)..."
            type="text"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="ملاحظات إدارية داخلية (غير مطبوعة)..."
            className="w-full bg-nw-bg border border-nw-border rounded-xl px-3 py-1.5 text-xs text-nw-text"
          />
        </div>
          </div>
        </details>
      </Card>

      {/* Main Action Button */}
      <div className="pt-2 flex items-center justify-end gap-2 border-t border-nw-border">
        <UiButton variant="plain"
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="bg-nw-surface-2 text-nw-text border border-nw-border px-4 py-2.5 rounded-xl font-bold hover:bg-nw-surface-2 transition h-auto min-h-11 min-w-0 whitespace-normal"
        >
          إلغاء
        </UiButton>

        <UiButton variant="plain"
          type="button"
          onClick={handleSubmitReceipt}
          disabled={isSubmitting || items.length === 0 || legacyReplayResolution !== null}
          className="bg-nw-accent text-nw-on-accent font-extrabold px-6 py-2.5 rounded-xl shadow-lg shadow-nw-border transition flex items-center gap-2 text-xs disabled:opacity-50 h-auto min-h-11 min-w-0 whitespace-normal"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-nw-text" />
              <span>جاري حفظ سند الاستلام وتحديث المخزون...</span>
            </>
          ) : legacyReplayResolution ? (
            <>
              <AlertCircle className="w-4 h-4 text-nw-text" />
              <span>راجع السند الموجود أولًا</span>
            </>
          ) : (
            <>
              <PackageCheck className="w-4 h-4 text-nw-text" />
              <span>حفظ واستلام البضاعة</span>
            </>
          )}
        </UiButton>
      </div>

      <CreateSupplierModal
        isOpen={showAddSupplierModal}
        onClose={() => setShowAddSupplierModal(false)}
        onSuccess={handleSupplierCreated}
      />
    </FormFields>
  );
};
