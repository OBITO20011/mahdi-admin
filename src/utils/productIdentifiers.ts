import { Product } from '../types';

export const normalizeProductSku = (value: string): string =>
  value.trim().toUpperCase();

export const normalizeProductBarcode = (value: string): string =>
  value.trim().toLowerCase();

export const isPosSellableProduct = (product: Product): boolean =>
  !product.isFlavorMaster &&
  product.status !== 'hidden' &&
  product.status !== 'discontinued' &&
  product.status !== 'expired' &&
  (product.unitsPerSalePackage || 0) > 0 &&
  (product.salePackagePrice || 0) > 0 &&
  product.saleUnitCode !== 'PCS';

export type ProductIdentifierValidation =
  | { valid: true }
  | {
      valid: false;
      code:
        | 'SKU_REQUIRED'
        | 'DUPLICATE_SKU'
        | 'DUPLICATE_BARCODE'
        | 'IDENTIFIER_COLLISION';
      message: string;
    };

export function validateProductIdentifiers(
  products: Product[],
  input: {
    sku: string;
    barcode?: string;
    currentProductId?: string;
  }
): ProductIdentifierValidation {
  const sku = normalizeProductSku(input.sku);
  const barcode = normalizeProductBarcode(input.barcode || '');

  if (!sku) {
    return {
      valid: false,
      code: 'SKU_REQUIRED',
      message: 'رمز الصنف SKU مطلوب.',
    };
  }

  for (const product of products) {
    if (product.id === input.currentProductId) continue;

    const existingSku = normalizeProductSku(product.sku);
    const existingBarcode = normalizeProductBarcode(product.barcode || '');

    if (existingSku === sku) {
      return {
        valid: false,
        code: 'DUPLICATE_SKU',
        message: 'رمز الصنف SKU مستخدم بالفعل لمنتج آخر.',
      };
    }
    if (barcode && existingBarcode === barcode) {
      return {
        valid: false,
        code: 'DUPLICATE_BARCODE',
        message: 'الباركود مستخدم بالفعل لمنتج آخر.',
      };
    }
    if (
      (existingBarcode && existingBarcode === sku.toLowerCase()) ||
      (barcode && existingSku.toLowerCase() === barcode)
    ) {
      return {
        valid: false,
        code: 'IDENTIFIER_COLLISION',
        message: 'لا يمكن استخدام نفس الرقم كـSKU لمنتج وباركود لمنتج آخر.',
      };
    }
  }

  return { valid: true };
}

export function generateUniqueProductSku(
  existingIdentifiers: string[],
  timestamp = Date.now(),
  maxAttempts = 100
): string {
  const normalizedExisting = new Set(
    existingIdentifiers
      .map(normalizeProductSku)
      .filter(Boolean)
  );
  const base = `NWS-${timestamp.toString(36).toUpperCase()}`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!normalizedExisting.has(candidate)) return candidate;
  }

  throw new Error('تعذر توليد SKU فريد. حاول مرة أخرى.');
}

export type PosProductLookupResult =
  | { status: 'found'; product: Product }
  | { status: 'not_found' | 'ambiguous' | 'not_sellable' };

export function resolvePosProductCode(
  products: Product[],
  rawCode: string
): PosProductLookupResult {
  const code = rawCode.trim();
  if (!code) return { status: 'not_found' };

  const normalized = code.toLowerCase();
  const matches = products.filter(
    (product) =>
      product.id === code ||
      normalizeProductSku(product.sku).toLowerCase() === normalized ||
      (Boolean(product.barcode?.trim()) &&
        normalizeProductBarcode(product.barcode) === normalized)
  );

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous' };
  if (!isPosSellableProduct(matches[0])) {
    return { status: 'not_sellable' };
  }

  return { status: 'found', product: matches[0] };
}
