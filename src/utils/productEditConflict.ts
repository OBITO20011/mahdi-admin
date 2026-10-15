import type { Product } from '../types';

/** Current values the database returns with PRODUCT_EDIT_CONFLICT (migration 170). */
export interface ProductEditSnapshot {
  productId: string;
  updatedAt: string;
  nameAr: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  brandId: string;
  unitName: string;
  purchasePackage: string;
  unitsPerPackage: number;
  defaultPurchasePriceInMinorUnits: number;
  salePackage: string;
  unitsPerSalePackage: number;
  salePackagePriceInMinorUnits: number;
  costPriceInMinorUnits: number;
  minStockLevel: number;
  maxStockLevel: number | null;
  isActive: boolean;
  flavorNameAr: string;
  imageUrl: string;
}

/** The product form's editable fields, in the form's own units (JOD, sale packages). */
export interface ProductEditFields {
  nameAr: string;
  description: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  imageUrl: string;
  purchasePackage: string;
  unitsPerPackage: number;
  defaultPurchasePrice: number;
  salePackage: string;
  unitsPerSalePackage: number;
  salePackagePrice: number;
  reorderPackages: number;
  maxPackages: number | '';
}

export const PRODUCT_EDIT_CONFLICT_MESSAGE = 'عدّل مستخدم آخر هذا المنتج قبل قليل.';

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Parses the JSON the database puts in the conflict error DETAIL; null when absent or malformed. */
export function readProductEditSnapshot(details: unknown): ProductEditSnapshot | null {
  let value: unknown = details;
  if (typeof details === 'string') {
    try { value = JSON.parse(details); } catch { return null; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (!text(s.productId) || !text(s.updatedAt)) return null;
  return {
    productId: text(s.productId),
    updatedAt: text(s.updatedAt),
    nameAr: text(s.nameAr),
    sku: text(s.sku),
    barcode: text(s.barcode),
    description: text(s.description),
    categoryId: text(s.categoryId),
    brandId: text(s.brandId),
    unitName: text(s.unitName),
    purchasePackage: text(s.purchasePackage),
    unitsPerPackage: number(s.unitsPerPackage) || 1,
    defaultPurchasePriceInMinorUnits: number(s.defaultPurchasePriceInMinorUnits),
    salePackage: text(s.salePackage),
    unitsPerSalePackage: number(s.unitsPerSalePackage) || 1,
    salePackagePriceInMinorUnits: number(s.salePackagePriceInMinorUnits),
    costPriceInMinorUnits: number(s.costPriceInMinorUnits),
    minStockLevel: number(s.minStockLevel),
    maxStockLevel: s.maxStockLevel === null || s.maxStockLevel === undefined ? null : number(s.maxStockLevel),
    isActive: s.isActive === true,
    flavorNameAr: text(s.flavorNameAr),
    imageUrl: text(s.imageUrl),
  };
}

// Same rounding as the form (ProductFormModal toSalePackageCount).
const packages = (units: number, perPackage: number) => Math.ceil(Math.max(0, Number(units) || 0) / Math.max(1, Number(perPackage) || 1));

/** Same conversions the form applies when it opens a product. */
export function productToEditFields(product: Product): ProductEditFields {
  const perSale = product.unitsPerSalePackage ?? product.unitsPerPackage ?? 1;
  return {
    nameAr: product.nameAr || '',
    description: product.description || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    categoryId: product.categoryId || '',
    brandId: product.brandId || '',
    imageUrl: product.imageUrl || '',
    purchasePackage: product.purchasePackage || 'كرتونة',
    unitsPerPackage: product.unitsPerPackage ?? 1,
    defaultPurchasePrice: product.defaultPurchasePrice ?? product.costPrice * (product.unitsPerPackage || 1),
    salePackage: product.saleUnitCode && product.saleUnitCode !== 'PCS' && product.salePackage ? product.salePackage : 'كرتونة',
    unitsPerSalePackage: perSale,
    salePackagePrice: product.salePackagePrice ?? (product.wholesalePrice || product.retailPrice) * perSale,
    reorderPackages: packages(product.reorderLevel, perSale),
    maxPackages: product.maxStockLevel === undefined ? '' : packages(product.maxStockLevel, perSale),
  };
}

export function snapshotToEditFields(snapshot: ProductEditSnapshot): ProductEditFields {
  const perSale = snapshot.unitsPerSalePackage || 1;
  return {
    nameAr: snapshot.nameAr,
    description: snapshot.description,
    sku: snapshot.sku,
    barcode: snapshot.barcode,
    categoryId: snapshot.categoryId,
    brandId: snapshot.brandId,
    imageUrl: snapshot.imageUrl,
    purchasePackage: snapshot.purchasePackage || 'كرتونة',
    unitsPerPackage: snapshot.unitsPerPackage,
    defaultPurchasePrice: snapshot.defaultPurchasePriceInMinorUnits / 1000,
    salePackage: snapshot.salePackage || 'كرتونة',
    unitsPerSalePackage: perSale,
    salePackagePrice: snapshot.salePackagePriceInMinorUnits / 1000,
    reorderPackages: packages(snapshot.minStockLevel, perSale),
    maxPackages: snapshot.maxStockLevel === null ? '' : packages(snapshot.maxStockLevel, perSale),
  };
}

export const PRODUCT_EDIT_FIELD_LABELS: Readonly<Record<keyof ProductEditFields, string>> = {
  nameAr: 'اسم المنتج',
  description: 'الوصف',
  sku: 'رمز الصنف SKU',
  barcode: 'الباركود',
  categoryId: 'القسم',
  brandId: 'الماركة',
  imageUrl: 'الصورة',
  purchasePackage: 'طرد الشراء',
  unitsPerPackage: 'الحبات في طرد الشراء',
  defaultPurchasePrice: 'سعر شراء الطرد',
  salePackage: 'طرد البيع',
  unitsPerSalePackage: 'الحبات في طرد البيع',
  salePackagePrice: 'سعر بيع الطرد',
  reorderPackages: 'حد التنبيه (طرود)',
  maxPackages: 'سقف المستودع (طرود)',
};

const same = (a: unknown, b: unknown) =>
  typeof a === 'number' || typeof b === 'number'
    ? (a === '' ? '' : Number(a)) === (b === '' ? '' : Number(b))
    : String(a ?? '').trim() === String(b ?? '').trim();

export interface ProductEditComparisonRow {
  field: keyof ProductEditFields;
  label: string;
  mine: ProductEditFields[keyof ProductEditFields];
  current: ProductEditFields[keyof ProductEditFields];
  changedByMe: boolean;
  changedByOther: boolean;
}

/** Fields where my value or the other user's value differs from what I opened. */
export function compareProductEdits(opened: ProductEditFields, mine: ProductEditFields, current: ProductEditFields): ProductEditComparisonRow[] {
  return (Object.keys(PRODUCT_EDIT_FIELD_LABELS) as (keyof ProductEditFields)[])
    .map(field => ({
      field,
      label: PRODUCT_EDIT_FIELD_LABELS[field],
      mine: mine[field],
      current: current[field],
      changedByMe: !same(mine[field], opened[field]),
      changedByOther: !same(current[field], opened[field]),
    }))
    .filter(row => row.changedByMe || row.changedByOther);
}

/** Re-apply: my changed fields over the current values; everything I did not touch takes the current value. */
export function reapplyProductEdits(opened: ProductEditFields, mine: ProductEditFields, current: ProductEditFields): ProductEditFields {
  const result = { ...current };
  for (const field of Object.keys(PRODUCT_EDIT_FIELD_LABELS) as (keyof ProductEditFields)[]) {
    if (!same(mine[field], opened[field])) (result as Record<string, unknown>)[field] = mine[field];
  }
  return result;
}
