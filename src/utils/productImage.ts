export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const PRODUCT_IMAGE_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

type ProductImageCandidate = Pick<File, 'size' | 'type'>;

export function validateProductImage(
  file: ProductImageCandidate
): string | null {
  if (
    !PRODUCT_IMAGE_ALLOWED_TYPES.includes(
      file.type as (typeof PRODUCT_IMAGE_ALLOWED_TYPES)[number]
    )
  ) {
    return 'صيغة الصورة غير مدعومة. اختر صورة JPG أو PNG أو WebP.';
  }

  if (file.size <= 0) {
    return 'ملف الصورة فارغ أو غير صالح.';
  }

  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return 'حجم الصورة أكبر من 5 ميجابايت.';
  }

  return null;
}

export function getProductImageExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}
