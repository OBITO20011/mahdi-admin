/**
 * Nawasrah Business Manager - POS (Point of Sale) View
 */

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  shallowEqual,
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import { Invoice, Product, PaymentMethod } from '../../types';
import {supabase} from '../../lib/supabase';
import {runPosV2Attempt, readPosV2Recovery, inspectOrCancelPosV2Attempt} from '../../services/supabase/posV2Recovery';
import type {CreatePosSaleV2Input, PosV2ConfigurableParcelLine} from '../../services/supabase/posV2.service';
import {PosParcelBuilder, type PosParcelOption} from './PosParcelBuilder';
import {posCartLines, posStockDemand, posWarehouseAvailable, posV2Invoice, type PosCartItem} from './posV2Cart';
import {jodToMinorUnits} from '../../utils/receivingCalculations';
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
import {
  isPosSellableProduct,
  resolvePosProductCode,
  type PosProductLookupResult,
} from '../../utils/productIdentifiers';
import { searchAdminProducts } from '../../services/supabase/products.service';

const BarcodeScannerModal = lazy(() =>
  import('./BarcodeScannerModal').then((module) => ({
    default: module.BarcodeScannerModal,
  })),
);

export const PosView: React.FC = () => {
  const {
    categories,
    activeBranch,
    productDataRevision,
    warehouses,
    branches,
    currentUser,
  } = useAppStoreSelector(
    (state) => ({
      categories: state.categories,
      activeBranch: state.activeBranch,
      productDataRevision: state.productDataRevision,
      warehouses: state.warehouses,
      branches: state.branches,
      currentUser: state.currentUser,
    }),
    shallowEqual
  );
  const {
    refreshProductsFromSupabase,
    refreshOrdersFromSupabase,
    refreshInventoryMovementsFromSupabase,
    refreshStockNotificationsFromSupabase,
    cacheProductPage,
    setToast,
    setActiveTab,
  } = useAppStoreActions();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [posProducts, setPosProducts] = useState<Product[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [cartItems, setCartItems] = useState<PosCartItem[]>([]);
  const [saleMode, setSaleMode] = useState<'base_unit' | 'legacy_single_sku_parcel'>('legacy_single_sku_parcel');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const branchWarehouses = warehouses.filter(w => w.branchId === activeBranch.id);
  const warehouseId = branchWarehouses.find(w => w.id === selectedWarehouseId)?.id
    || (branchWarehouses.length === 1 ? branchWarehouses[0].id : '');
  const [parcelOptions, setParcelOptions] = useState<PosParcelOption[]>([]);
  const [parcelOption, setParcelOption] = useState<PosParcelOption | null>(null);
  const [editingParcelId, setEditingParcelId] = useState<string | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  const [absenceState, setAbsenceState] = useState<'ABSENT' | 'EXISTS' | 'CANCELLED_UNCOMMITTED' | null>(null);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const recoveryBlocked = recoveryStatus !== null && !['SUCCEEDED', 'DEFINITIVELY_REJECTED', 'CANCELLED_UNCOMMITTED'].includes(recoveryStatus);
  const [posCustomers, setPosCustomers] = useState<PosCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [posCustomerPage, setPosCustomerPage] = useState(1);
  const [posCustomerTotal, setPosCustomerTotal] = useState(0);
  const [posCustomersHaveMore, setPosCustomersHaveMore] = useState(false);
  const [isPosCustomersLoading, setIsPosCustomersLoading] = useState(false);
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
  const knownProductsRef = useRef<Map<string, Product>>(new Map());
  const cartWarehouseRef = useRef<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refreshRecovery = () => {
    setAbsenceState(null); setCancelConfirmed(false);
    try {setRecoveryStatus(readPosV2Recovery(currentUser.id)?.status || null);}
    catch {setRecoveryStatus('UNPROVEN');}
  };
  useEffect(() => {
    const refresh = () => {
      setAbsenceState(null); setCancelConfirmed(false);
      try {setRecoveryStatus(readPosV2Recovery(currentUser.id)?.status || null);}
      catch {setRecoveryStatus('UNPROVEN');}
    };
    refresh(); window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [currentUser.id]);
  useEffect(() => {
    let active = true; setParcelOptions([]); setParcelOption(null);
    if (warehouseId && supabase) void Promise.resolve(supabase.rpc('get_pos_configurable_parcel_options_v1', {p_warehouse_id: warehouseId}))
      .then(({data, error}) => {
        if (!active) return;
        if (error || !data || !Array.isArray(data.options)) {setToast('تعذر قراءة إعداد طرود الكاشير.', 'error'); return;}
        const options = data.options as PosParcelOption[];
        if (options.some(o => !o.familyProductId || !o.parcelConfigurationId || !Number.isSafeInteger(o.configurationRevision)
          || o.configurationRevision < 1 || !Number.isSafeInteger(o.unitsPerParcel) || o.unitsPerParcel < 1
          || !Number.isSafeInteger(o.parcelPriceInMinorUnits) || o.parcelPriceInMinorUnits < 1 || !Array.isArray(o.components)
          || !o.components.length || new Set(o.components.map(c => c.productId)).size !== o.components.length
          || o.components.some(c => !c.productId || typeof c.nameAr !== 'string'
            || !Number.isSafeInteger(c.availableQuantity) || c.availableQuantity < 0))) {
          setToast('بيانات الطرود غير مكتملة؛ أعد تحميلها.', 'error'); return;
        }
        setParcelOptions(options);
      }).catch(() => {if (active) setToast('تعذر تحميل طرود الكاشير. تحقق من الاتصال.', 'error');});
    return () => {active = false;};
  }, [warehouseId, productDataRevision, setToast]);

  const cartFits = (next: PosCartItem[]) => [...posStockDemand(next)].every(([id, quantity]) => {
    const product = knownProductsRef.current.get(id);
    const component = parcelOptions.flatMap(p => p.components).find(c => c.productId === id);
    const available = product ? posWarehouseAvailable(product, warehouseId) : component?.availableQuantity;
    return Number.isSafeInteger(quantity) && quantity > 0 && available !== undefined && quantity <= available;
  });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setIsProductsLoading(true);
      setProductsError(null);
      searchAdminProducts({
        search: searchQuery,
        limit: 40,
        categoryId: selectedCategory === 'all' ? undefined : selectedCategory,
        purpose: 'sellable',
      })
        .then((result) => {
          if (!active) return;
          const sellableProducts = result.filter(isPosSellableProduct);
          sellableProducts.forEach((product) =>
            knownProductsRef.current.set(product.id, product),
          );
          setPosProducts(sellableProducts);
          cacheProductPage(sellableProducts);
        })
        .catch((error: unknown) => {
          if (!active) return;
          setProductsError(
            error instanceof Error ? error.message : 'تعذر تحميل منتجات نقطة البيع.',
          );
          setPosProducts([]);
        })
        .finally(() => {
          if (active) setIsProductsLoading(false);
        });
    }, searchQuery.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cacheProductPage, productDataRevision, searchQuery, selectedCategory]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setIsPosCustomersLoading(true);
      fetchPosCustomersFromSupabase({
        page: 1,
        pageSize: 25,
        search: customerSearch,
      })
        .then((result) => {
          if (!active) return;
          setPosCustomers((currentCustomers) => {
            const selected = currentCustomers.find(
              (customer) => customer.id === selectedCustomerId
            );
            if (
              selected &&
              !result.customers.some((customer) => customer.id === selected.id)
            ) {
              return [selected, ...result.customers];
            }
            return result.customers;
          });
          setPosCustomerPage(result.page);
          setPosCustomerTotal(result.totalCount);
          setPosCustomersHaveMore(result.hasMore);
        })
        .catch((error) => {
          if (!active) return;
          console.error('Unable to load POS customers:', error);
          setPosCustomers((currentCustomers) =>
            currentCustomers.filter(
              (customer) => customer.id === selectedCustomerId
            )
          );
          setPosCustomerTotal(0);
          setPosCustomersHaveMore(false);
        })
        .finally(() => {
          if (active) setIsPosCustomersLoading(false);
        });
    }, customerSearch.trim() ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [customerSearch, selectedCustomerId]);

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

  const filteredProducts = posProducts;

  const resolveScannedProductCode = async (
    code: string,
  ): Promise<PosProductLookupResult> => {
    const matches = await searchAdminProducts({
      search: code,
      limit: 3,
      purpose: 'any',
    });
    matches.forEach((product) => knownProductsRef.current.set(product.id, product));
    return resolvePosProductCode(matches, code);
  };

  const addToCart = (prod: Product) => {
    if (isSubmitting || recoveryBlocked || !warehouseId) {setToast('حدد المستودع واسترجع أي محاولة معلقة قبل البيع.', 'error'); return;}
    if (cartItems.length && cartWarehouseRef.current !== warehouseId) {setToast('تغير مستودع البيع؛ أفرغ السلة ثم أعد تركيبها.', 'error'); return;}
    cartWarehouseRef.current = warehouseId;
    knownProductsRef.current.set(prod.id, prod);
    const unitsPerSalePackage = saleMode === 'base_unit' ? 1 : Math.max(
      1,
      Math.floor(prod.unitsPerSalePackage || 1)
    );
    const availableSalePackages = calculateAvailableSalePackages(
      posWarehouseAvailable(prod, warehouseId),
      unitsPerSalePackage
    );
    const existingIndex = cartItems.findIndex((item) => item.productId === prod.id && item.v2Line.commercial_line_kind === saleMode);
    const currentQuantity =
      existingIndex >= 0 ? cartItems[existingIndex].quantity : 0;
    if (!canSetPosQuantity(currentQuantity + 1, availableSalePackages)) {
      setToast(`المتاح من ${prod.nameAr} هو ${availableSalePackages} طرد بيع فقط.`, 'error');
      return;
    }

    if (existingIndex >= 0) {
      const updated = cartItems.map(item => ({...item}));
      updated[existingIndex].quantity += 1;
      updated[existingIndex].baseQuantity = updated[existingIndex].quantity * unitsPerSalePackage;
      updated[existingIndex].totalPrice = updated[existingIndex].quantity * updated[existingIndex].unitPrice;
      if (!cartFits(updated)) {setToast('الكمية المشتركة للقطع والطرود تتجاوز مخزون المستودع.', 'error'); return;}
      setCartItems(updated);
    } else {
      const unitPrice = saleMode === 'base_unit' ? prod.retailPrice : prod.salePackagePrice;
      if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) {setToast('سعر البيع غير متوفر.', 'error'); return;}
      const newItem: PosCartItem = {
        v2Line: saleMode === 'base_unit' ? {commercial_line_kind: saleMode, product_id: prod.id, base_quantity: 1}
          : {commercial_line_kind: saleMode, product_id: prod.id, parcel_quantity: 1, units_per_parcel: unitsPerSalePackage},
        id: `cart-${Date.now()}-${Math.random()}`,
        productId: prod.id,
        productName: prod.nameAr,
        productImage: prod.imageUrl,
        sku: prod.sku,
        unit: saleMode === 'base_unit' ? prod.unit : prod.salePackage || 'طرد',
        unitPrice,
        costPrice: prod.costPrice,
        quantity: 1,
        baseQuantity: unitsPerSalePackage,
        unitsPerSalePackage,
        salePackage: prod.salePackage || 'طرد',
        discount: 0,
        totalPrice: unitPrice,
      };
      if (!cartFits([...cartItems, newItem])) {setToast('الكمية المشتركة تتجاوز مخزون المستودع.', 'error'); return;}
      setCartItems([...cartItems, newItem]);
    }
    searchInputRef.current?.focus({preventScroll: true});
  };

  const updateQuantity = (itemId: string, delta: number) => {
    if (isSubmitting || recoveryBlocked) return;
    const updated = cartItems
      .map((item) => {
        if (item.id === itemId) {
          const newQty = item.quantity + delta;
          if (newQty <= 0) return null;
          if (item.v2Line.commercial_line_kind === 'configurable_parcel') return item;
          const product = knownProductsRef.current.get(item.productId);
          const availableSalePackages = product
            ? calculateAvailableSalePackages(
                posWarehouseAvailable(product, warehouseId),
                item.unitsPerSalePackage || 1
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
      .filter(Boolean) as PosCartItem[];

    if (!cartFits(updated)) {setToast('الكمية المشتركة تتجاوز مخزون المستودع.', 'error'); return;}
    setCartItems(updated);
  };

  const addParcel = (line: PosV2ConfigurableParcelLine) => {
    if (!parcelOption || recoveryBlocked || isSubmitting) return;
    const option = parcelOption;
    const item: PosCartItem = {id: crypto.randomUUID(), productId: option.familyProductId,
      productName: option.nameAr + ' — ' + line.parcel_instances[0].components.map(c =>
        `${option.components.find(p => p.productId === c.product_id)?.flavorNameAr || option.components.find(p => p.productId === c.product_id)?.nameAr}: ${c.base_quantity}`).join('، '),
      productImage: '', sku: '', unit: 'طرد مرن', unitPrice: option.parcelPriceInMinorUnits / 1000,
      costPrice: 0, quantity: 1, baseQuantity: option.unitsPerParcel, unitsPerSalePackage: option.unitsPerParcel,
      salePackage: 'طرد مرن', discount: 0, totalPrice: option.parcelPriceInMinorUnits / 1000, v2Line: line};
    if (cartItems.length && cartWarehouseRef.current !== warehouseId) {setToast('تغير مستودع البيع؛ أعد تركيب السلة.', 'error'); return;}
    const next = editingParcelId ? cartItems.map(c => c.id === editingParcelId ? {...item, id: c.id} : c) : [...cartItems, item];
    if (!cartFits(next)) {setToast('مكونات السلة تتجاوز المخزون المتاح.', 'error'); return;}
    cartWarehouseRef.current = warehouseId;
    setCartItems(next); setParcelOption(null); setEditingParcelId(null); searchInputRef.current?.focus();
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
    if (isSubmitting || recoveryBlocked || !warehouseId) return;
    if (cartItems.length === 0) return;
    if (cartWarehouseRef.current !== warehouseId || !cartFits(cartItems)) {setToast('تغير المستودع أو المخزون المتاح؛ راجع السلة قبل الإرسال.', 'error'); return;}

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

    const request: CreatePosSaleV2Input = {warehouseId, branchId: activeBranch.id,
      customerId: selectedCustomer?.id, customerName: selectedCustomer?.name || 'زبون نقدي', paymentMethod,
      lines: posCartLines(cartItems), discountInMinorUnits: jodToMinorUnits(discountAmount),
      amountReceivedInMinorUnits: jodToMinorUnits(paymentMethod === 'debt' ? 0
        : paymentMethod === 'cash' ? cashReceived || totalAmount : totalAmount), idempotencyKey: crypto.randomUUID()};
    await executeSale('START_NEW', request);
  };

  const executeSale = async (intent: 'START_NEW' | 'RECOVER_EXISTING', request?: CreatePosSaleV2Input) => {
    if (!supabase || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await runPosV2Attempt(supabase, currentUser.id, intent, request);
      if (result.ok === false) {setToast(result.message, 'error'); return;}
      const meta = await supabase.from('orders').select('created_at').eq('id', result.data.orderId).single();
      const invoice = posV2Invoice(result.data, currentUser, typeof meta.data?.created_at === 'string' ? meta.data.created_at : '');
      try {invoice.publicReceiptUrl = await getOrCreatePublicPosReceiptUrlFromSupabase(result.data.orderId);} catch {/* Committed sale is still recoverable. */}
      setLastInvoice(invoice); setShowReceiptModal(true); setCartItems([]); setDiscountAmount(0);
      setCashReceived(0); setSelectedCustomerId(''); setPaymentMethod('cash');
      await Promise.allSettled([refreshProductsFromSupabase(), refreshOrdersFromSupabase(),
        refreshInventoryMovementsFromSupabase(), refreshStockNotificationsFromSupabase()]);
      setToast(`تم حفظ البيع V2: ${result.data.orderNumber}`);
    } catch (error) {setToast(error instanceof Error ? error.message : 'تعذر استرجاع محاولة البيع.', 'error');}
    finally {setIsSubmitting(false); refreshRecovery();}
  };

  const handleCustomerCreated = (customer: CreatedCustomer) => {
    setPosCustomers((currentCustomers) => [
      ...currentCustomers.filter((item) => item.id !== customer.id),
      customer,
    ].sort((first, second) => first.name.localeCompare(second.name, 'ar')));
    setPosCustomerTotal((currentTotal) => currentTotal + 1);
    setSelectedCustomerId(customer.id);
  };

  const loadMorePosCustomers = async () => {
    if (!posCustomersHaveMore || isPosCustomersLoading) return;
    setIsPosCustomersLoading(true);
    try {
      const result = await fetchPosCustomersFromSupabase({
        page: posCustomerPage + 1,
        pageSize: 25,
        search: customerSearch,
      });
      setPosCustomers((currentCustomers) => {
        const existingIds = new Set(
          currentCustomers.map((customer) => customer.id)
        );
        return [
          ...currentCustomers,
          ...result.customers.filter(
            (customer) => !existingIds.has(customer.id)
          ),
        ];
      });
      setPosCustomerPage(result.page);
      setPosCustomerTotal(result.totalCount);
      setPosCustomersHaveMore(result.hasMore);
    } catch (error) {
      console.error('Unable to load more POS customers:', error);
      setToast('تعذر تحميل المزيد من العملاء.', 'error');
    } finally {
      setIsPosCustomersLoading(false);
    }
  };

  const selectedPosCustomer = posCustomers.find(
    (customer) => customer.id === selectedCustomerId
  );
  const receiptBranch = lastInvoice ? branches.find(branch => branch.id === lastInvoice.branchId) : undefined;

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
      branchName: receiptBranch?.name || lastInvoice.branchId,
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

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="pos-warehouse">مستودع البيع</label>
        <select id="pos-warehouse" value={warehouseId} disabled={cartItems.length > 0 || isSubmitting || recoveryBlocked}
          onChange={e => setSelectedWarehouseId(e.target.value)} className="rounded-lg bg-slate-800 p-2">
          <option value="">اختر المستودع</option>
          {branchWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label htmlFor="pos-sale-unit">وحدة البيع</label>
        <select id="pos-sale-unit" value={saleMode} disabled={isSubmitting || recoveryBlocked}
          onChange={e => setSaleMode(e.target.value as typeof saleMode)} className="rounded-lg bg-slate-800 p-2">
          <option value="base_unit">قطعة</option><option value="legacy_single_sku_parcel">طرد من صنف واحد</option>
        </select>
      </div>
      {recoveryStatus && recoveryStatus !== 'DEFINITIVELY_REJECTED' && <div className="rounded-xl border border-amber-700 p-3 text-xs" role="status">
        <p>{recoveryStatus === 'CANCELLED_UNCOMMITTED' ? 'ألغيت المحاولة بعد إثبات الخادم عدم تسجيلها. يمكنك بدء بيع جديد.'
          : recoveryBlocked ? 'نتيجة بيع معلقة: لا تبدأ بيعاً جديداً. استرجع المحاولة الأصلية بنفس الطلب والمفتاح.' : 'آخر بيع محفوظ؛ يمكنك استرجاع إيصال العملية نفسها.'}</p>
        {recoveryStatus !== 'CANCELLED_UNCOMMITTED' &&
        <button type="button" disabled={isSubmitting} className="mt-2 rounded-lg bg-amber-600 p-2"
          onClick={() => void executeSale('RECOVER_EXISTING')}>استرجاع محاولة البيع</button>}
        {recoveryBlocked && <button type="button" disabled={isSubmitting || !supabase}
          className="m-2 rounded-lg border border-amber-500 p-2" onClick={async () => {
            if (!supabase) return; setIsSubmitting(true);
            try {setAbsenceState(await inspectOrCancelPosV2Attempt(supabase,currentUser.id));}
            catch (error) {setToast(error instanceof Error ? error.message : 'تعذر إثبات حالة المحاولة؛ السجل محفوظ.', 'error');}
            finally {setIsSubmitting(false);}
          }}>التحقق من حالة المحاولة</button>}
        {absenceState === 'EXISTS' && <p>العملية مسجلة. استرجاع المحاولة هو الطريق الوحيد.</p>}
        {recoveryBlocked && (absenceState === 'ABSENT' || absenceState === 'CANCELLED_UNCOMMITTED') && <div>
          <p>الخادم لا يجد بيعاً مسجلاً لهذه المحاولة. سيعيد التحقق عند الإلغاء.</p>
          <label className="flex items-center gap-2 p-2"><input type="checkbox" checked={cancelConfirmed}
            disabled={isSubmitting} onChange={e => setCancelConfirmed(e.target.checked)}/>
            أؤكد إلغاء هذه المحاولة غير المسجلة وبدء بيع جديد</label>
          <button type="button" disabled={!cancelConfirmed || isSubmitting || !supabase}
            className="rounded-lg bg-red-700 p-2 disabled:opacity-50" onClick={async () => {
              if (!supabase || !cancelConfirmed) return; setIsSubmitting(true);
              try {
                const outcome = await inspectOrCancelPosV2Attempt(supabase,currentUser.id,true);
                if (outcome === 'EXISTS') {setAbsenceState(outcome); return;}
                if (outcome !== 'CANCELLED_UNCOMMITTED') throw new Error('تعذر إثبات الإلغاء؛ السجل محفوظ.');
                refreshRecovery(); setToast('ألغيت المحاولة غير المسجلة؛ يمكنك بدء بيع جديد.', 'success');
              } catch (error) {setToast(error instanceof Error ? error.message : 'تعذر إثبات الإلغاء؛ السجل محفوظ.', 'error');}
              finally {setIsSubmitting(false);}
            }}>إلغاء المحاولة غير المسجلة</button>
        </div>}
      </div>}
      {parcelOptions.length > 0 && <div className="flex flex-wrap gap-2">
        {parcelOptions.map(option => <button type="button" key={option.parcelConfigurationId}
          disabled={isSubmitting || recoveryBlocked || !warehouseId} className="rounded-xl bg-blue-700 p-3 text-xs"
          onClick={() => {setEditingParcelId(null); setParcelOption(option);}}>تركيب طرد: {option.nameAr}</button>)}
      </div>}

      {/* Search Input & Categories */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم المنتج أو الباركود أو SKU..."
            ref={searchInputRef}
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
        {productsError && (
          <div className="col-span-full rounded-xl border border-rose-800 bg-rose-950/30 p-4 text-center text-xs font-bold text-rose-300">
            {productsError}
          </div>
        )}
        {isProductsLoading && filteredProducts.length === 0 && !productsError && (
          <div className="col-span-full flex items-center justify-center gap-2 p-5 text-xs font-bold text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ تحميل المنتجات…
          </div>
        )}
        {!isProductsLoading && filteredProducts.length === 0 && !productsError && (
          <div className="col-span-full p-5 text-center text-xs font-bold text-slate-500">
            لا توجد منتجات مطابقة.
          </div>
        )}
        {filteredProducts.map((prod) => (
          <button
            type="button"
            key={prod.id}
            disabled={isSubmitting || recoveryBlocked || !warehouseId}
            data-pos-product-card={prod.id}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.repeat) event.preventDefault();
            }}
            onClick={() => addToCart(prod)}
            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 p-2.5 rounded-2xl shadow transition cursor-pointer active:scale-95 text-right flex flex-col justify-between focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
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
                {(saleMode === 'base_unit' ? prod.retailPrice : prod.salePackagePrice || 0).toFixed(3)} {CURRENCY}
              </span>
              <span className="text-[9px] text-slate-500 font-medium">
                متاح:{' '}
                {calculateAvailableSalePackages(
                  posWarehouseAvailable(prod, warehouseId),
                  saleMode === 'base_unit' ? 1 : prod.unitsPerSalePackage || 1
                )}{' '}
                {saleMode === 'base_unit' ? prod.unit : prod.salePackage || 'طرد'}
              </span>
            </div>
          </button>
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
              disabled={isSubmitting || recoveryBlocked}
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
                  {item.v2Line.commercial_line_kind === 'configurable_parcel' && <button type="button"
                    disabled={isSubmitting || recoveryBlocked} className="rounded-lg bg-blue-700 p-2"
                    onClick={() => {
                      const line = item.v2Line;
                      if (line.commercial_line_kind !== 'configurable_parcel') return;
                      const option = parcelOptions.find(o => o.parcelConfigurationId === line.parcel_configuration_id
                        && o.configurationRevision === line.configuration_revision);
                      if (!option) {setToast('تغير إعداد الطرد؛ احذف هذا الطرد وأعد تركيبه.', 'error'); return;}
                      setEditingParcelId(item.id); setParcelOption(option);
                    }}>تعديل الطرد</button>}
                  <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded-lg border border-slate-700">
                    <button disabled={isSubmitting || recoveryBlocked} aria-label={`تقليل ${item.productName}`} onClick={() => updateQuantity(item.id, -1)} className="text-slate-400 hover:text-white">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-bold text-white px-1">{item.quantity}</span>
                    <button disabled={isSubmitting || recoveryBlocked || item.v2Line.commercial_line_kind === 'configurable_parcel'} aria-label={`زيادة ${item.productName}`} onClick={() => updateQuantity(item.id, 1)} className="text-slate-400 hover:text-white">
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
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="ابحث بالاسم أو الهاتف أو معرف العميل"
                aria-label="البحث عن عميل للبيع"
                className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2 pl-3 pr-9 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
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
            <div className="flex items-center justify-between gap-2 text-[9px] text-slate-500">
              <span>
                {isPosCustomersLoading
                  ? 'جاري البحث...'
                  : `${posCustomerTotal} عميل مطابق`}
              </span>
              {posCustomersHaveMore && (
                <button
                  type="button"
                  onClick={loadMorePosCustomers}
                  disabled={isPosCustomersLoading}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 font-bold text-slate-300 disabled:opacity-60"
                >
                  تحميل المزيد
                </button>
              )}
            </div>
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
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {[
              { id: 'cash' as PaymentMethod, label: 'نقدي 💵' },
              { id: 'cliq' as PaymentMethod, label: 'CliQ 📱' },
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
                recoveryBlocked || !warehouseId ||
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
                <p className="text-[9px] text-slate-600">{receiptBranch?.name || lastInvoice.branchId}</p>
                <p className="text-[9px] text-slate-600">
                  {[receiptBranch?.address, receiptBranch?.phone].filter(Boolean).join(' | ')}
                </p>
                <p className="text-[9px] text-slate-500">رقم الفاتورة: {lastInvoice.invoiceNumber}</p>
                <p className="text-[9px] text-slate-500">
                  {lastInvoice.createdAt ? new Date(lastInvoice.createdAt).toLocaleString('ar-JO') : 'التاريخ في الإيصال المحفوظ'}
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

      {parcelOption && <PosParcelBuilder option={parcelOption}
        initialComponents={(() => {const line = cartItems.find(i => i.id === editingParcelId)?.v2Line;
          return line?.commercial_line_kind === 'configurable_parcel' ? line.parcel_instances[0].components : undefined;})()}
        onClose={() => {setParcelOption(null); setEditingParcelId(null);}} onAdd={addParcel}/>}
      {/* Live Barcode Camera Scanner Modal */}
      {isBarcodeScannerOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" dir="rtl">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-bold text-slate-200 shadow-2xl">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                <span>جاري فتح قارئ الباركود...</span>
              </div>
            </div>
          }
        >
          <BarcodeScannerModal
            isOpen={isBarcodeScannerOpen}
            onClose={() => setIsBarcodeScannerOpen(false)}
            resolveProductCode={resolveScannedProductCode}
            onProductScanned={(scannedProduct) => addToCart(scannedProduct)}
            setToast={setToast}
          />
        </Suspense>
      )}

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
