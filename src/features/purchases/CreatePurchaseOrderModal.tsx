import {FormFields, Card, UiButton, formatJod, DataTable, Tr, Th, Td} from '../../components/ui';
/**
 * Nawasrah Business Manager - Create Purchase Order Modal Component
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import { useAppStoreSelector, storeEngine } from '../../stores/useAppStore';
import { CreatePurchaseOrderInput, PurchaseOrder } from '../../types/purchases';
import {
  createPurchaseOrderInSupabase,
  updatePurchaseOrderInSupabase,
  fetchSuppliersFromSupabase,
  isValidUUID,
} from '../../services/supabase/purchases.service';
import { searchAdminProducts } from '../../services/supabase/products.service';
import { fetchBranchesFromSupabase, fetchWarehousesFromSupabase } from '../../services/supabase/reference-data.service';
import { Supplier, Product, Branch, Warehouse } from '../../types';
import { CreateSupplierModal } from './CreateSupplierModal';
import {
  X,
  Plus,
  Trash2,
  Building,
  Warehouse as WarehouseIcon,
  Calendar,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Search,
  Package,
  Edit,
} from 'lucide-react';
import { CURRENCY } from '../../constants';

interface CreatePurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (poId: string) => void;
  poToEdit?: PurchaseOrder | null;
}

interface OrderItemRow {
  productId: string;
  productName: string;
  sku: string;
  barcode?: string;
  unit: string;
  orderedQuantity: number;
  purchasePrice: number; // JOD
  discount: number; // JOD
}

export const CreatePurchaseOrderModal: React.FC<CreatePurchaseOrderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  poToEdit,
}) => {
  const activeBranch = useAppStoreSelector((state) => state.activeBranch);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [supplierSearch, setSupplierSearch] = useState<string>('');
  const [isCreateSupplierModalOpen, setIsCreateSupplierModalOpen] = useState<boolean>(false);
  const [initialSupplierName, setInitialSupplierName] = useState<string>('');

  const [availableBranches, setAvailableBranches] = useState<Branch[]>([]);
  const [availableWarehouses, setAvailableWarehouses] = useState<Warehouse[]>([]);

  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [overallDiscount, setOverallDiscount] = useState<number>(0);
  const [notes, setNotes] = useState<string>('');
  const [internalNotes, setInternalNotes] = useState<string>('');

  // Products loaded from Supabase
  const [fetchedProducts, setFetchedProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(false);
  const [productsFetchError, setProductsFetchError] = useState<string | null>(null);

  // Line items
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [productSearch, setProductSearch] = useState<string>('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const panel = useDialogFocus(isOpen, () => { if (!isSubmitting) onClose(); }, true);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close product search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProductDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const loadBranchesAndWarehouses = useCallback(async () => {
    try {
      const [bList, wList] = await Promise.all([
        fetchBranchesFromSupabase(),
        fetchWarehousesFromSupabase(),
      ]);

      // Filter only real UUID branches/warehouses
      const validBranches = (bList || []).filter((b) => isValidUUID(b.id));
      const validWarehouses = (wList || []).filter((w) => isValidUUID(w.id));

      setAvailableBranches(validBranches);
      setAvailableWarehouses(validWarehouses);

      // Default active branch if it has a valid UUID
      if (activeBranch?.id && isValidUUID(activeBranch.id)) {
        setSelectedBranchId(activeBranch.id);
      } else if (validBranches.length > 0) {
        setSelectedBranchId(validBranches[0].id);
      } else {
        setSelectedBranchId('');
      }

      if (validWarehouses.length > 0) {
        setSelectedWarehouseId(validWarehouses[0].id);
      } else {
        setSelectedWarehouseId('');
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[CreatePurchaseOrderModal] Error loading reference data:', err);
      }
      setAvailableBranches([]);
      setAvailableWarehouses([]);
    }
  }, [activeBranch?.id]);

  const loadSuppliers = useCallback(async () => {
    const list = await fetchSuppliersFromSupabase();
    // Only keep suppliers with valid UUIDs
    const validSuppliers = list.filter((s) => isValidUUID(s.id));
    setSuppliers(validSuppliers);
      setSelectedSupplierId((currentSupplierId) =>
        validSuppliers.length > 0 && !isValidUUID(currentSupplierId)
          ? validSuppliers[0].id
          : currentSupplierId,
      );
  }, []);

  // Load reference data only when this sheet opens. Product options are searched
  // independently below so opening the sheet never downloads the full catalog.
  useEffect(() => {
    if (!isOpen) return;

    if (poToEdit) {
      setSelectedSupplierId(poToEdit.supplierId);
      setSelectedBranchId(poToEdit.branchId || '');
      setSelectedWarehouseId(poToEdit.warehouseId || '');
      setExpectedDeliveryDate(poToEdit.expectedDeliveryDate ? poToEdit.expectedDeliveryDate.substring(0, 10) : '');
      setSupplierInvoiceNumber(poToEdit.supplierInvoiceNumber || '');
      setDeliveryFee(poToEdit.deliveryFee || 0);
      setOverallDiscount(poToEdit.discount || 0);
      setNotes(poToEdit.notes || '');
      setInternalNotes(poToEdit.internalNotes || '');
      setItems((poToEdit.items || []).map((i) => ({
        productId: i.productId,
        productName: i.productName,
        sku: i.sku || '',
        barcode: i.barcode || '',
        unit: i.unit || 'قطعة',
        orderedQuantity: i.orderedQuantity,
        purchasePrice: i.purchasePrice,
        discount: i.discount,
      })));
    } else {
      setSelectedSupplierId('');
      setSelectedBranchId('');
      setSelectedWarehouseId('');
      setExpectedDeliveryDate('');
      setSupplierInvoiceNumber('');
      setDeliveryFee(0);
      setOverallDiscount(0);
      setNotes('');
      setInternalNotes('');
      setItems([]);
    }

    void loadSuppliers();
    void loadBranchesAndWarehouses();
  }, [isOpen, loadBranchesAndWarehouses, loadSuppliers, poToEdit]);

  useEffect(() => {
    if (!isOpen || !isProductDropdownOpen) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoadingProducts(true);
      setProductsFetchError(null);
      searchAdminProducts({
        search: productSearch,
        limit: 20,
        purpose: 'receiving',
      })
        .then((products) => {
          if (!active) return;
          setFetchedProducts(products.filter((product) => isValidUUID(product.id)));
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (import.meta.env.DEV) {
            console.error('[CreatePurchaseOrderModal] Error searching products:', error);
          }
          setProductsFetchError('تعذر تحميل قائمة المنتجات من قاعدة البيانات.');
          setFetchedProducts([]);
        })
        .finally(() => {
          if (active) setIsLoadingProducts(false);
        });
    }, productSearch.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isOpen, isProductDropdownOpen, productSearch]);

  if (!isOpen) return null;

  // Add or increment a product item row
  const handleAddProduct = (product: Product) => {
    if (!product.id || !isValidUUID(product.id)) {
      setErrorMsg(`المنتج (${product.nameAr}) لا يمتلك معرّف UUID صالح في قاعدة البيانات.`);
      return;
    }

    const existingIndex = items.findIndex((i) => i.productId === product.id);
    if (existingIndex >= 0) {
      const updated = [...items];
      updated[existingIndex].orderedQuantity += 1;
      setItems(updated);
    } else {
      setItems([
        ...items,
        {
          productId: product.id, // Strictly public.products.id (UUID)
          productName: product.nameAr,
          sku: product.sku || '',
          barcode: product.barcode || '',
          unit: product.unit || 'قطعة',
          orderedQuantity: 1,
          purchasePrice: product.costPrice || 0,
          discount: 0,
        },
      ]);
    }
    setProductSearch('');
    setIsProductDropdownOpen(false);
  };

  const handleUpdateItem = (index: number, field: keyof OrderItemRow, rawValue: number) => {
    const updated = [...items];
    const item = { ...updated[index] };

    if (field === 'orderedQuantity') {
      const qty = Math.max(1, Math.floor(rawValue || 1));
      item.orderedQuantity = qty;
      const rowSubtotal = item.orderedQuantity * item.purchasePrice;
      if (item.discount > rowSubtotal) {
        item.discount = rowSubtotal;
      }
    } else if (field === 'purchasePrice') {
      const price = Math.max(0, rawValue || 0);
      item.purchasePrice = price;
      const rowSubtotal = item.orderedQuantity * item.purchasePrice;
      if (item.discount > rowSubtotal) {
        item.discount = rowSubtotal;
      }
    } else if (field === 'discount') {
      const rowSubtotal = item.orderedQuantity * item.purchasePrice;
      const disc = Math.min(rowSubtotal, Math.max(0, rawValue || 0));
      item.discount = disc;
    }

    updated[index] = item;
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = item.orderedQuantity * item.purchasePrice - item.discount;
    return sum + Math.max(0, lineTotal);
  }, 0);

  const grandTotal = Math.max(0, subtotal - Number(overallDiscount || 0) + Number(deliveryFee || 0));

  // Filtered suppliers
  const filteredSuppliers = suppliers.filter((s) => {
    if (!supplierSearch.trim()) return true;
    const q = supplierSearch.toLowerCase().trim();
    return (
      s.companyName.toLowerCase().includes(q) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(q))
    );
  });

  const filteredProducts = fetchedProducts;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // 1. Strict Supplier UUID Check
    if (!selectedSupplierId || !isValidUUID(selectedSupplierId)) {
      setErrorMsg('معرّف المورد غير صالح (يجب أن يكون UUID). يرجى اختيار مورد من القائمة.');
      return;
    }

    // 2. Items Validation
    if (items.length === 0) {
      setErrorMsg('يرجى إضافة منتج واحد على الأقل إلى طلب الشراء.');
      return;
    }

    for (const item of items) {
      if (!item.productId || !isValidUUID(item.productId)) {
        setErrorMsg(`معرّف المنتج (${item.productName}) غير صالح (يجب أن يكون UUID).`);
        return;
      }
      if (item.orderedQuantity <= 0) {
        setErrorMsg(`الكمية المطلوبة للمنتج (${item.productName}) يجب أن تكون أكبر من صفر.`);
        return;
      }
      if (item.purchasePrice < 0) {
        setErrorMsg(`سعر الشراء للمنتج (${item.productName}) لا يمكن أن يكون بالسالب.`);
        return;
      }
    }

    // 3. Clean optional branch and warehouse UUIDs (strip non-UUID strings like "b-jrbd")
    const cleanBranchId = isValidUUID(selectedBranchId) ? selectedBranchId.trim() : undefined;
    const cleanWarehouseId = isValidUUID(selectedWarehouseId) ? selectedWarehouseId.trim() : undefined;

    setIsSubmitting(true);
    try {

      const input: CreatePurchaseOrderInput = {
        supplierId: selectedSupplierId.trim(),
        branchId: cleanBranchId,
        warehouseId: cleanWarehouseId,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : undefined,
        supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
        deliveryFee: Number(deliveryFee) || 0,
        discount: Number(overallDiscount) || 0,
        notes: notes.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        items: items.map((i) => ({
          productId: i.productId.trim(),
          orderedQuantity: i.orderedQuantity,
          purchasePrice: i.purchasePrice,
          discount: i.discount,
        })),
      };

      let res;
      if (poToEdit) {
        res = await updatePurchaseOrderInSupabase(poToEdit.id, input);
      } else {
        res = await createPurchaseOrderInSupabase(input);
      }


      if (res.success) {
        storeEngine.setToast(
          poToEdit ? 'تم تحديث أمر الشراء بنجاح' : 'تم إنشاء أمر الشراء بنجاح',
          'success'
        );
        onSuccess(res.purchaseOrderId || poToEdit?.id || '');
        onClose();
      } else {
        setErrorMsg(res.error || 'حدث خطأ أثناء حفظ أمر الشراء');
      }

    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormFields ref={panel as React.RefObject<HTMLDivElement>} tabIndex={-1} role="dialog" aria-modal="true" aria-label="أمر الشراء" aria-busy={isSubmitting} className="nw-purchasing-fields fixed inset-0 z-50 flex items-center justify-center bg-nw-overlay backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <Card padded={false} className="bg-nw-surface border border-nw-border rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden my-auto flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-nw-surface-2 px-5 py-4 border-b border-nw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-nw-info-bg border border-nw-border flex items-center justify-center text-nw-info font-bold">
              {poToEdit ? <Edit className="w-5 h-5 text-nw-warn" /> : <Plus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-nw-text">
                {poToEdit ? `تعديل أمر الشراء (${poToEdit.purchaseOrderNumber})` : 'إنشاء أمر شراء جديد (Purchase Order)'}
              </h2>
              <p className="text-xs text-nw-muted">
                {poToEdit
                  ? 'تعديل أصناف وكميات وأسعار المورد لأمر الشراء بحالة مسودة'
                  : 'إدخال طلب شراء بالجملة من المورد وتحديد الكميات والأسعار'}
              </p>
            </div>
          </div>
          <UiButton aria-label="إغلاق أمر الشراء" variant="plain" type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-xl bg-nw-surface-2 text-nw-text hover:text-nw-text flex items-center justify-center transition h-auto min-h-11 min-w-0 whitespace-normal"
          >
            <X className="w-5 h-5" />
          </UiButton>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="bg-nw-bad-bg border border-nw-border p-3 rounded-2xl text-nw-bad flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-nw-bad" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Supplier & Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 bg-nw-bg p-4 rounded-2xl border border-nw-border">
            {/* Supplier Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-bold text-nw-text flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-nw-ok" />
                  المورد: <span className="text-nw-bad">*</span>
                </label>
                <UiButton variant="plain"
                  type="button"
                  onClick={() => {
                    setInitialSupplierName(supplierSearch.trim());
                    setIsCreateSupplierModalOpen(true);
                  }}
                  className="text-xs text-nw-info hover:text-nw-info font-bold flex items-center gap-1 transition h-auto min-h-11 min-w-0 whitespace-normal"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ إضافة مورد جديد</span>
                </UiButton>
              </div>

              {suppliers.length > 5 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-nw-muted absolute right-3 top-2.5" />
                  <input aria-label="بحث في أسماء الموردين..."
                    type="text"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    placeholder="بحث في أسماء الموردين..."
                    className="w-full bg-nw-surface-2 border border-nw-border rounded-xl pr-8 pl-3 py-1.5 text-xs text-nw-text focus:outline-none focus:border-nw-border"
                  />
                </div>
              )}

              <select aria-label="المورد"
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                required
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text font-semibold focus:outline-none focus:border-nw-border"
              >
                <option value="">-- اختر المورد --</option>
                {filteredSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName} {s.contactPerson ? `(${s.contactPerson})` : ''}
                  </option>
                ))}
              </select>

              {(filteredSuppliers.length === 0 || suppliers.length === 0) && (
                <UiButton variant="plain"
                  type="button"
                  onClick={() => {
                    setInitialSupplierName(supplierSearch.trim());
                    setIsCreateSupplierModalOpen(true);
                  }}
                  className="w-full mt-1.5 p-2 rounded-xl bg-nw-info-bg border border-nw-border text-nw-info text-xs font-bold hover:bg-nw-info-bg transition flex items-center justify-center gap-1.5 h-auto min-h-11 min-w-0 whitespace-normal"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>لا يوجد مورد بهذا الاسم — إضافة مورد جديد</span>
                </UiButton>
              )}
            </div>

            {/* Warehouse Selector */}
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <WarehouseIcon className="w-3.5 h-3.5 text-nw-info" />
                مستودع الاستلام المستهدف:
              </label>
              <select aria-label="المستودع"
                value={isValidUUID(selectedWarehouseId) ? selectedWarehouseId : ''}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text font-semibold focus:outline-none focus:border-nw-border"
              >
                <option value="">-- بدون تحديد مستودع --</option>
                {availableWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Expected Delivery Date */}
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-nw-warn" />
                تاريخ التسليم المتوقع:
              </label>
              <input aria-label="تاريخ التسليم المتوقع:"
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>

            {/* Supplier Invoice # */}
            <div className="space-y-1">
              <label className="font-bold text-nw-text flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-nw-info" />
                رقم فاتورة المورد (اختياري):
              </label>
              <input aria-label="مثال: INV-9842"
                type="text"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder="مثال: INV-9842"
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              />
            </div>

            {/* Branch */}
            <div className="space-y-1">
              <label className="font-bold text-nw-text">الفرع طالب الشراء:</label>
              <select aria-label="الفرع"
                value={isValidUUID(selectedBranchId) ? selectedBranchId : ''}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
              >
                <option value="">-- بدون تحديد فرع --</option>
                {availableBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 2: Items Table & Product Picker */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-nw-text text-sm">عناصر وأصناف أمر الشراء:</h3>
              <span className="text-[11px] text-nw-muted">عدد الأصناف: {items.length}</span>
            </div>

            {/* Product Search Input */}
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <Search className="w-4 h-4 text-nw-muted absolute right-3 top-2.5" />
                <input aria-label="ابحث عن منتج بإدخال الاسم، الرمز SKU، أو الباركود لإضافته للجدول..."
                  type="text"
                  value={productSearch}
                  onFocus={() => setIsProductDropdownOpen(true)}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setIsProductDropdownOpen(true);
                  }}
                  placeholder="ابحث عن منتج بإدخال الاسم، الرمز SKU، أو الباركود لإضافته للجدول..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl pr-9 pl-3 py-2 text-nw-text focus:outline-none focus:border-nw-border"
                />
              </div>

              {/* Autocomplete Dropdown */}
              {isProductDropdownOpen && (
                <Card padded={false} className="absolute top-full right-0 left-0 mt-1 bg-nw-surface border border-nw-border rounded-2xl shadow-2xl z-30 p-2 space-y-1">
                  {isLoadingProducts ? (
                    <div className="p-3 text-center text-nw-muted font-semibold flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-nw-border border-t-transparent rounded-full animate-spin" />
                      <span>جاري تحميل المنتجات من قاعدة البيانات...</span>
                    </div>
                  ) : productsFetchError ? (
                    <div className="p-3 text-center text-nw-bad text-xs font-semibold flex items-center justify-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{productsFetchError}</span>
                    </div>
                  ) : fetchedProducts.length === 0 ? (
                    <div className="p-4 text-center text-nw-warn font-bold text-xs bg-nw-warn-bg rounded-xl border border-nw-border">
                      لا توجد منتجات متاحة. أضف منتجاً من قسم المنتجات أولاً.
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="p-3 text-center text-nw-muted text-xs">لا توجد منتجات تطابق البحث</div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                      {filteredProducts.map((p) => (
                        <UiButton variant="plain"
                          type="button"
                          key={p.id}
                          onClick={() => handleAddProduct(p)}
                          className="w-full text-right p-2.5 rounded-xl hover:bg-nw-surface-2 flex items-center justify-between gap-3 transition group border border-transparent hover:border-nw-border h-auto min-h-11 min-w-0 whitespace-normal"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {p.imageUrl ? (
                              <img
                                src={p.imageUrl}
                                alt={p.nameAr}
                                className="w-9 h-9 rounded-lg object-cover border border-nw-border shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-nw-surface-2 border border-nw-border flex items-center justify-center shrink-0 text-nw-muted">
                                <Package className="w-4 h-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="font-bold text-nw-text group-hover:text-nw-ok transition truncate">
                                {p.nameAr}
                              </div>
                              <div className="text-[10px] text-nw-muted flex flex-wrap items-center gap-2 mt-0.5 font-mono">
                                <span>SKU: {p.sku || 'غير محدد'}</span>
                                {p.barcode && <span>• باركود: {p.barcode}</span>}
                                {p.unit && (
                                  <span className="bg-nw-surface-2 border border-nw-border px-1.5 py-0.2 rounded text-[9px] text-nw-text font-sans">
                                    {p.unit}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 text-left">
                            <div className="text-[10px]">
                              <div className="text-nw-ok font-bold">
                                تكلفة: {formatJod((p.costPrice || 0))} {CURRENCY}
                              </div>
                              <div className="text-nw-muted font-sans">
                                المخزون: <span className={(p.onHandQuantity || 0) > 0 ? 'text-nw-text font-bold' : 'text-nw-warn font-bold'}>{p.onHandQuantity || 0}</span>
                              </div>
                            </div>
                            <span className="bg-nw-info-bg text-nw-info border border-nw-border group-hover:bg-nw-info-bg group-hover:text-nw-text px-2.5 py-1 rounded-lg font-bold text-[10px] transition">
                              + إضافة
                            </span>
                          </div>
                        </UiButton>
                      ))}
                    </div>
                  )}
                </Card>
              )}
            </div>

            {/* Items Table */}
            <div className="border border-nw-border rounded-2xl overflow-hidden bg-nw-bg">
              <div className="overflow-x-auto">
                <DataTable caption="أصناف الطلب" className="w-full text-right text-xs">
                  <thead className="bg-nw-surface-2 text-nw-text font-bold border-b border-nw-border">
                    <Tr>
                      <Th className="p-3">اسم المنتج / SKU</Th>
                      <Th className="p-3 w-28 text-center">الكمية المطلوب شراءها</Th>
                      <Th className="p-3 w-32 text-center">سعر الشراء الفردي ({CURRENCY})</Th>
                      <Th className="p-3 w-28 text-center">الخصم ({CURRENCY})</Th>
                      <Th className="p-3 w-32 text-center">إجمالي هذا المنتج ({CURRENCY})</Th>
                      <Th className="p-3 w-12 text-center">حذف</Th>
                    </Tr>
                  </thead>
                  <tbody className="divide-y divide-nw-border">
                    {items.length === 0 ? (
                      <Tr>
                        <Td colSpan={6} className="p-8 text-center text-nw-muted bg-nw-surface">
                          <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto">
                            <Card padded={false} className="w-12 h-12 rounded-2xl bg-nw-surface-2 border border-nw-border flex items-center justify-center text-nw-muted">
                              <Package className="w-6 h-6" />
                            </Card>
                            <h4 className="font-bold text-nw-text text-xs">لا توجد منتجات مضافة بعد</h4>
                            <p className="text-nw-muted text-[11px] leading-relaxed">
                              ابحث واختر المنتجات من القائمة أعلاه للبدء في إعداد أمر الشراء وتحديد الكميات والأسعار.
                            </p>
                          </div>
                        </Td>
                      </Tr>
                    ) : (
                      items.map((item, index) => {
                        const lineTotal = Math.max(0, item.orderedQuantity * item.purchasePrice - item.discount);
                        return (
                          <Tr key={index} className="hover:bg-nw-surface-2 transition">
                            <Td className="p-3 font-semibold text-nw-text">
                              <div>{item.productName}</div>
                              <div className="text-[10px] text-nw-muted font-mono">
                                SKU: {item.sku} ({item.unit})
                              </div>
                            </Td>
                            <Td className="p-3">
                              <input aria-label="الكمية المطلوبة"
                                type="number"
                                min="1"
                                value={item.orderedQuantity}
                                onChange={(e) =>
                                  handleUpdateItem(index, 'orderedQuantity', parseInt(e.target.value) || 1)
                                }
                                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1.5 text-center font-bold text-nw-text focus:outline-none focus:border-nw-border"
                              />
                            </Td>
                            <Td className="p-3">
                              <input aria-label="سعر الشراء"
                                type="number"
                                step="0.001"
                                min="0"
                                value={item.purchasePrice}
                                onChange={(e) =>
                                  handleUpdateItem(index, 'purchasePrice', parseFloat(e.target.value) || 0)
                                }
                                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1.5 text-center font-bold text-nw-text focus:outline-none focus:border-nw-border"
                              />
                            </Td>
                            <Td className="p-3">
                              <input aria-label="خصم السطر"
                                type="number"
                                step="0.001"
                                min="0"
                                value={item.discount}
                                onChange={(e) =>
                                  handleUpdateItem(index, 'discount', parseFloat(e.target.value) || 0)
                                }
                                className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1.5 text-center font-bold text-nw-text focus:outline-none focus:border-nw-border"
                              />
                            </Td>
                            <Td className="p-3 text-center font-black text-nw-text">
                              {formatJod(lineTotal)}
                            </Td>
                            <Td className="p-3 text-center">
                              <UiButton variant="plain"
                                type="button"
                                onClick={() => handleRemoveItem(index)}
                                aria-label={`إزالة ${item.productName}`}
                                className="w-7 h-7 rounded-lg bg-nw-bad-bg text-nw-bad hover:bg-nw-bad-bg hover:text-nw-text flex items-center justify-center transition mx-auto h-auto min-h-11 min-w-0 whitespace-normal"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </UiButton>
                            </Td>
                          </Tr>
                        );
                      })
                    )}
                  </tbody>
                </DataTable>
              </div>
            </div>
          </div>

          {/* Section 3: Totals & Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* Notes */}
            <div className="space-y-2">
              <div>
                <label className="font-bold text-nw-text block mb-1">ملاحظات الطلب العامة:</label>
                <textarea aria-label="أي تعليمات للمورد أو شروط التوريد..."
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="أي تعليمات للمورد أو شروط التوريد..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl p-2.5 text-nw-text focus:outline-none focus:border-nw-border"
                />
              </div>
              <div>
                <label className="font-bold text-nw-text block mb-1">ملاحظات داخلية (للإدارة فقط):</label>
                <textarea aria-label="ملاحظات سرية..."
                  rows={2}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  placeholder="ملاحظات سرية..."
                  className="w-full bg-nw-surface-2 border border-nw-border rounded-xl p-2.5 text-nw-text focus:outline-none focus:border-nw-border"
                />
              </div>
            </div>

            {/* Financial Summary Calculation Card */}
            <div className="bg-nw-overlay p-4 rounded-2xl border border-nw-border space-y-2.5">
              <div className="flex items-center justify-between font-semibold text-nw-text">
                <span>المجموع الفرعي للأصناف:</span>
                <span>
                  {formatJod(subtotal)} {CURRENCY}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-nw-muted">خصم إضافي على الفاتورة:</span>
                <div className="flex items-center gap-1 w-32">
                  <input aria-label="خصم الفاتورة"
                    type="number"
                    step="0.001"
                    min="0"
                    value={overallDiscount}
                    onChange={(e) => setOverallDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1 text-center font-bold text-nw-text"
                  />
                  <span className="text-nw-muted font-mono">{CURRENCY}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-nw-muted">رسوم الشحن والتوصيل:</span>
                <div className="flex items-center gap-1 w-32">
                  <input aria-label="رسوم التوصيل"
                    type="number"
                    step="0.001"
                    min="0"
                    value={deliveryFee}
                    onChange={(e) => setDeliveryFee(parseFloat(e.target.value) || 0)}
                    className="w-full bg-nw-surface-2 border border-nw-border rounded-xl px-2 py-1 text-center font-bold text-nw-text"
                  />
                  <span className="text-nw-muted font-mono">{CURRENCY}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-nw-border flex items-center justify-between font-black text-sm text-nw-text">
                <span className="text-nw-info text-base">المبلغ الإجمالي الكلي:</span>
                <span className="text-lg text-nw-ok">
                  {formatJod(grandTotal)} {CURRENCY}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Submit */}
          <div className="pt-3 border-t border-nw-border flex items-center justify-end gap-3 shrink-0">
            <UiButton variant="plain"
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-nw-surface-2 text-nw-text hover:bg-nw-surface-2 font-bold transition h-auto min-h-11 min-w-0 whitespace-normal"
            >
              إلغاء
            </UiButton>
            <UiButton variant="plain"
              type="submit"
              disabled={isSubmitting || items.length === 0}
              className="px-6 py-2.5 rounded-xl bg-nw-accent text-nw-on-accent font-bold transition shadow-lg disabled:opacity-50 flex items-center gap-2 h-auto min-h-11 min-w-0 whitespace-normal"
            >
              {isSubmitting ? (
                <span>جاري الحفظ...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{poToEdit ? 'حفظ التعديلات' : 'حفظ وإصدار أمر الشراء'}</span>
                </>
              )}
            </UiButton>
          </div>
        </form>
      </Card>

      {/* Create Supplier Modal */}
      <CreateSupplierModal
        isOpen={isCreateSupplierModalOpen}
        initialCompanyName={initialSupplierName}
        onClose={() => setIsCreateSupplierModalOpen(false)}
        onSuccess={async (newSupplier) => {
          const updatedList = await fetchSuppliersFromSupabase();
          setSuppliers(updatedList);
          setSelectedSupplierId(newSupplier.id);
          setSupplierSearch('');
        }}
      />
    </FormFields>
  );
};
