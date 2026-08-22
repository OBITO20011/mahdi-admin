import {
  isSupabaseConfigured,
  supabase,
} from '../../lib/supabase';
import {
  getProductImageExtension,
  validateProductImage,
} from '../../utils/productImage';

export const PRODUCT_IMAGE_BUCKET = 'product-images';

export interface ProductImageUploadResult {
  success: boolean;
  publicUrl?: string;
  storagePath?: string;
  error?: string;
  code?: string;
}

export async function uploadProductImageToSupabase(
  file: File
): Promise<ProductImageUploadResult> {
  const validationError = validateProductImage(file);
  if (validationError) {
    return {
      success: false,
      error: validationError,
      code: 'INVALID_PRODUCT_IMAGE',
    };
  }

  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
      code: 'SUPABASE_NOT_CONFIGURED',
    };
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;

  if (sessionError || !userId) {
    return {
      success: false,
      error: 'انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مجددًا.',
      code: 'AUTH_SESSION_EXPIRED',
    };
  }

  const extension = getProductImageExtension(file.type);
  const fileName =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storagePath = `${userId}/${fileName}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return {
      success: false,
      error: uploadError.message || 'تعذر رفع صورة المنتج.',
      code: 'PRODUCT_IMAGE_UPLOAD_FAILED',
    };
  }

  const { data: publicUrlData } = supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .getPublicUrl(storagePath);

  if (!publicUrlData.publicUrl) {
    await supabase.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .remove([storagePath]);

    return {
      success: false,
      error: 'تم رفع الصورة لكن تعذر إنشاء رابط العرض.',
      code: 'PRODUCT_IMAGE_URL_FAILED',
    };
  }

  return {
    success: true,
    publicUrl: publicUrlData.publicUrl,
    storagePath,
  };
}

export async function removeUploadedProductImage(
  storagePath: string
): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !storagePath) return;

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    console.warn(
      '[Supabase product image cleanup failed]:',
      error.message
    );
  }
}
