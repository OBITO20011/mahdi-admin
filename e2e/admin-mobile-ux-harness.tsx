import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { InventoryView } from '../src/features/inventory/InventoryView';
import { OperationalOrderCard } from '../src/features/orders/OrdersCenterView';
import { ProductsView } from '../src/features/products/ProductsView';
import { ProductDetailModal } from '../src/features/products/ProductDetailModal';
import { ProductFormModal } from '../src/features/products/ProductFormModal';
import type { StartBarcodeCamera } from '../src/features/barcode/barcodeCamera';
import { storeEngine } from '../src/stores/useAppStore';
import type { OperationalOrderListItem } from '../src/services/supabase/orders.service';
import type { Product } from '../src/types';

declare global {
  interface Window {
    __ADMIN_MOBILE_UX_MODAL__: () => string | null;
    __BARCODE_CAMERA_START_COUNT__: number;
    __BARCODE_CAMERA_STOP_COUNT__: number;
    __BARCODE_CAMERA_OPTIONS__: {
      oneShot?: boolean;
      productBarcodesOnly?: boolean;
    } | null;
  }
}

const branch = {
  id: 'branch-mobile-ux',
  name: 'فرع الرمثا الرئيسي',
  nameAr: 'فرع الرمثا الرئيسي',
  address: 'الرمثا',
  city: 'الرمثا',
  phone: '0000000000',
  isMain: true,
};

const warehouse = {
  id: 'warehouse-mobile-ux',
  code: 'MAIN',
  name: 'المستودع الرئيسي',
  nameAr: 'المستودع الرئيسي',
  branchId: branch.id,
  location: 'رف A-12',
};

const baseProduct: Product = {
  id: 'product-mobile-ux',
  sku: 'JUI-STRAWBERRY-30-LONG-SKU',
  barcode: '6251234567890',
  nameAr: 'عصير فراولة طبيعي باسم طويل لاختبار العرض على الهاتف',
  description: 'منتج اختبار عرض فقط',
  imageUrl:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%231e293b"/%3E%3C/svg%3E',
  categoryId: 'category-mobile-ux',
  purchaseUnitId: 'unit-carton',
  purchaseUnitCode: 'CTN',
  purchasePackage: 'كرتونة',
  unitsPerPackage: 30,
  defaultPurchasePrice: 12,
  saleUnitId: 'unit-shrink',
  saleUnitCode: 'SHRINK',
  salePackage: 'شرنك',
  unitsPerSalePackage: 6,
  salePackagePrice: 3,
  costPrice: 0.4,
  retailPrice: 0.5,
  wholesalePrice: 0.5,
  taxRate: 16,
  unit: 'حبة',
  onHandQuantity: 187,
  reservedQuantity: 30,
  availableQuantity: 157,
  reorderLevel: 30,
  maxStockLevel: 600,
  branchId: branch.id,
  warehouseId: warehouse.id,
  warehouseLocation: warehouse.location,
  warehouseBalances: [
    {
      warehouseId: warehouse.id,
      onHandQuantity: 187,
      reservedQuantity: 30,
      availableQuantity: 157,
    },
  ],
  status: 'active',
  createdAt: '2026-09-09T08:00:00.000Z',
  updatedAt: '2026-09-09T08:00:00.000Z',
};

const catalogProducts: Product[] = [
  baseProduct,
  {
    ...baseProduct,
    id: 'product-cola-mobile-ux',
    sku: 'COLA-1L-12',
    barcode: '6251234567891',
    nameAr: 'بيبسي عبوة لتر واحد',
    onHandQuantity: 72,
    reservedQuantity: 0,
    availableQuantity: 72,
  },
  {
    ...baseProduct,
    id: 'product-water-mobile-ux',
    sku: 'WATER-500-24',
    barcode: '6251234567892',
    nameAr: 'مياه معدنية كرتونة 24 حبة',
    onHandQuantity: 24,
    reservedQuantity: 6,
    availableQuantity: 18,
  },
  {
    ...baseProduct,
    id: 'product-chips-mobile-ux',
    sku: 'CHIPS-LARGE-20',
    barcode: '6251234567893',
    nameAr: 'شيبس عائلي بنكهة الجبنة والبهارات',
    onHandQuantity: 0,
    reservedQuantity: 0,
    availableQuantity: 0,
  },
];

const flavorMasterProduct: Product = {
  ...baseProduct,
  id: 'product-flavor-master-mobile-ux',
  sku: 'JUICE-FAMILY',
  barcode: '',
  nameAr: 'عصير النكهات',
  onHandQuantity: 0,
  reservedQuantity: 0,
  availableQuantity: 0,
  unitsPerPackage: 6,
  unitsPerSalePackage: 6,
  purchasePackage: 'كرتونة',
  salePackage: 'كرتونة',
  unit: 'حبة',
  isFlavorMaster: true,
};

const flavorProducts: Product[] = [
  {
    ...flavorMasterProduct,
    id: 'product-flavor-apple-mobile-ux',
    sku: 'JUICE-FAMILY-APPLE',
    barcode: '6251234567810',
    nameAr: 'عصير النكهات - تفاح',
    flavorMasterProductId: flavorMasterProduct.id,
    flavorNameAr: 'تفاح',
    flavorSortOrder: 1,
    isFlavorMaster: false,
    onHandQuantity: 30,
    reservedQuantity: 6,
    availableQuantity: 24,
  },
  {
    ...flavorMasterProduct,
    id: 'product-flavor-strawberry-mobile-ux',
    sku: 'JUICE-FAMILY-STRAWBERRY',
    barcode: '6251234567811',
    nameAr: 'عصير النكهات - فراولة',
    flavorMasterProductId: flavorMasterProduct.id,
    flavorNameAr: 'فراولة',
    flavorSortOrder: 2,
    isFlavorMaster: false,
    onHandQuantity: 30,
    reservedQuantity: 6,
    availableQuantity: 24,
  },
];

const productCatalogProducts: Product[] = [
  baseProduct,
  catalogProducts[1],
  flavorMasterProduct,
  catalogProducts[3],
  ...flavorProducts,
];

const fetchHarnessProductPage = async () => ({
  products: productCatalogProducts,
  page: 1,
  pageSize: 24,
  totalCount: 4,
  totalPages: 1,
  metrics: {
    lowStock: 1,
    outOfStock: 1,
    inventoryCost: 0,
    potentialProfit: 0,
  },
});

const fetchHarnessInventoryPage = async () => ({
  products: catalogProducts.map((product) => ({
    ...product,
    hasSales: false,
    movementCount:
      product.id === baseProduct.id
        ? 3
        : product.id === catalogProducts[1].id
          ? 1
          : product.id === catalogProducts[2].id
            ? 2
            : 0,
  })),
  page: 1,
  pageSize: 24,
  totalCount: 4,
  totalPages: 1,
  metrics: {
    totalItems: 4,
    totalCostValue: 113.2,
    totalRetailValue: 141.5,
    lowStock: 1,
    outOfStock: 1,
    stagnant: 3,
  },
});

const view = new URLSearchParams(window.location.search).get('view');
const barcodeScenario =
  new URLSearchParams(window.location.search).get('scenario') || 'success';

window.__BARCODE_CAMERA_START_COUNT__ = 0;
window.__BARCODE_CAMERA_STOP_COUNT__ = 0;
window.__BARCODE_CAMERA_OPTIONS__ = null;

const startBarcodeScanner: StartBarcodeCamera = async (options) => {
  window.__BARCODE_CAMERA_START_COUNT__ += 1;
  window.__BARCODE_CAMERA_OPTIONS__ = {
    oneShot: options.oneShot,
    productBarcodesOnly: options.productBarcodesOnly,
  };

  if (barcodeScenario === 'denied') {
    throw new DOMException('Permission denied', 'NotAllowedError');
  }
  if (barcodeScenario === 'unsupported') {
    throw new DOMException('Unsupported camera', 'NotSupportedError');
  }
  if (barcodeScenario === 'failure') {
    throw new Error('Camera stream failed');
  }

  let stopped = false;
  const timer =
    barcodeScenario === 'success' || barcodeScenario === 'duplicate'
      ? window.setTimeout(() => {
          if (!stopped) {
            options.onDecoded(
              barcodeScenario === 'duplicate'
                ? '6251234567891'
                : '6291041500213'
            );
          }
        }, 600)
      : null;

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.__BARCODE_CAMERA_STOP_COUNT__ += 1;
    },
  };
};

const state = storeEngine.getState();
Object.assign(state, {
  activeBranch: branch,
  branches: [branch],
  warehouses: [warehouse],
  categories: [
    {
      id: 'category-mobile-ux',
      code: 'JUICE',
      nameAr: 'العصائر والمشروبات',
    },
  ],
  products:
    view === 'orders'
      ? [baseProduct]
      : view === 'products' ||
          view === 'flavor-detail' ||
          view === 'barcode-flavor'
        ? productCatalogProducts
        : catalogProducts,
  movements: [],
  movementPage: {
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 1,
    productMovementCounts: {
      [baseProduct.id]: 3,
      [catalogProducts[1].id]: 1,
      [catalogProducts[2].id]: 2,
      [catalogProducts[3].id]: 0,
    },
    salesProductIds: [],
    productId: null,
  },
});
storeEngine.refreshInventoryMovementsFromSupabase = async () => undefined;

window.__ADMIN_MOBILE_UX_MODAL__ = () =>
  storeEngine.getState().currentModal;

const orders: OperationalOrderListItem[] = [
  {
    id: 'order-multiple-products',
    orderNumber: 'ORD-20260909-80582',
    customerName: 'عميل باسم طويل لاختبار الاختصار',
    customerPhone: '0770000000',
    governorate: 'إربد',
    region: 'الحي الشرقي',
    status: 'new',
    paymentMethod: 'cash_on_delivery',
    paymentStatus: 'unpaid',
    totalAmount: 27.5,
    amountPaid: 0,
    amountDue: 27.5,
    itemCount: 3,
    firstProductName: 'عصير فراولة طبيعي',
    branchId: branch.id,
    createdAt: '2026-09-09T08:00:00.000Z',
    updatedAt: '2026-09-09T08:00:00.000Z',
  },
  {
    id: 'order-single-product',
    orderNumber: 'ORD-20260909-80583',
    customerName: 'عميل نقدي',
    customerPhone: '',
    governorate: 'إربد',
    region: 'الرمثا',
    status: 'completed',
    paymentMethod: 'cliq',
    paymentStatus: 'paid',
    totalAmount: 6,
    amountPaid: 6,
    amountDue: 0,
    itemCount: 1,
    firstProductName: 'بيبسي 1 لتر',
    branchId: branch.id,
    createdAt: '2026-09-09T09:00:00.000Z',
    updatedAt: '2026-09-09T09:00:00.000Z',
  },
];

const content =
  view === 'orders' ? (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-2.5 p-3">
      {orders.map((order) => (
        <OperationalOrderCard
          key={order.id}
          order={order}
          onOpen={() => undefined}
        />
      ))}
    </main>
  ) : view === 'products' ? (
    <ProductsView fetchProductPage={fetchHarnessProductPage} />
  ) : view === 'flavor-detail' ? (
    <main dir="rtl" className="mx-auto max-w-lg p-3">
      <ProductDetailModal
        product={flavorMasterProduct}
        onClose={() => undefined}
      />
    </main>
  ) : view === 'barcode-add' ? (
    <main dir="rtl" className="mx-auto max-w-lg p-3">
      <ProductFormModal
        onClose={() => undefined}
        startBarcodeScanner={startBarcodeScanner}
      />
    </main>
  ) : view === 'barcode-edit' ? (
    <main dir="rtl" className="mx-auto max-w-lg p-3">
      <ProductFormModal
        initialProduct={baseProduct}
        onClose={() => undefined}
        startBarcodeScanner={startBarcodeScanner}
      />
    </main>
  ) : view === 'barcode-master' ? (
    <main dir="rtl" className="mx-auto max-w-lg p-3">
      <ProductFormModal
        initialProduct={flavorMasterProduct}
        onClose={() => undefined}
        startBarcodeScanner={startBarcodeScanner}
      />
    </main>
  ) : view === 'barcode-flavor' ? (
    <main dir="rtl" className="mx-auto max-w-lg p-3">
      <ProductDetailModal
        product={flavorMasterProduct}
        onClose={() => undefined}
        startBarcodeScanner={startBarcodeScanner}
      />
    </main>
  ) : (
    <InventoryView fetchProductPage={fetchHarnessInventoryPage} />
  );

createRoot(document.getElementById('root')!).render(
  view?.startsWith('barcode-') ? content : <React.StrictMode>{content}</React.StrictMode>
);
