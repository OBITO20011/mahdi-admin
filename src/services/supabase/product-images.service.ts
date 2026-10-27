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
  uncertain?: boolean;
}

interface CatalogImageUploadOptions {
  subdirectory?: string;
  /** Durable bulk-upload intent must be saved before the first Storage write. */
  beforeUpload?: (intent: {storagePath: string; publicUrl: string}) => void;
  resumeStoragePath?: string;
}

async function uploadCatalogImageToSupabase(
  file: File,
  options: CatalogImageUploadOptions = {}
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
  const subdirectory = options.subdirectory
    ? `${options.subdirectory.replace(/^\/+|\/+$/g, '')}/`
    : '';
  const storagePath = options.resumeStoragePath || `${userId}/${subdirectory}${fileName}.${extension}`;
  if (options.resumeStoragePath && (!storagePath.startsWith(userId + '/') ||
    !/^[a-f\d-]{36}\/[a-f\d-]{36}\.jpg$/iu.test(storagePath) || extension !== 'jpg')) {
    return {success: false, code: 'INVALID_IMAGE_RESUME_PATH', error: 'مسار استئناف الصورة غير صالح.'};
  }

  if (options.beforeUpload) {
    const {data} = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath);
    if (!data.publicUrl) return {success: false, code: 'PRODUCT_IMAGE_URL_FAILED', error: 'تعذر تجهيز رابط الصورة.'};
    options.beforeUpload({storagePath, publicUrl: data.publicUrl});
  }

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  const resumedDuplicate = Boolean(options.resumeStoragePath && uploadError &&
    ('statusCode' in uploadError && String(uploadError.statusCode) === '409' || uploadError.message === 'The resource already exists'));
  if (uploadError && !resumedDuplicate) {
    return {
      success: false,
      error: uploadError.message || 'تعذر رفع صورة المنتج.',
      code: 'PRODUCT_IMAGE_UPLOAD_FAILED',
      uncertain: !('statusCode' in uploadError && /^4\d\d$/u.test(String(uploadError.statusCode))),
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

export function uploadProductImageToSupabase(
  file: File,
  beforeUpload?: CatalogImageUploadOptions['beforeUpload'],
  resumeStoragePath?: string,
): Promise<ProductImageUploadResult> {
  return uploadCatalogImageToSupabase(file, {beforeUpload, resumeStoragePath});
}

/** Same image-only writer invoked by the existing product/flavor save RPCs. */
export async function saveProductPrimaryImage(productId: string, publicUrl: string): Promise<{success: boolean; error?: string; uncertain?: boolean}> {
  if (!isSupabaseConfigured || !supabase) return {success: false, error: 'إعدادات الاتصال غير مكتملة.'};
  const {data, error, status} = await supabase.rpc('set_product_primary_image', {p_product_id: productId, p_image_url: publicUrl});
  return error ? {success: false, uncertain: !(/^[A-Z\d]{5}$/u.test(error.code) || status >= 400 && status < 500), error: 'تعذر حفظ صورة المنتج. تحقق من الجلسة وصلاحية تعديل المنتجات.'}
    : {success: typeof data === 'string' && data.length > 0, uncertain: typeof data !== 'string' || !data.length};
}

/** Includes secondary/other-product references before any cleanup decision. */
export async function isUploadedImageReferenced(publicUrl: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) throw new Error('تعذر التحقق من حفظ الصورة.');
  const {data, error} = await supabase.from('product_images').select('id').eq('image_url', publicUrl).limit(1);
  if (error) throw new Error('تعذر التحقق من مراجع الصورة؛ لن تُحذف حتى ينجح التحقق.');
  return Boolean(data?.length);
}

/** Bulk cleanup needs an explicit result;the normal form keeps its old API. */
export async function removeBulkUploadedProductImage(storagePath: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const {data, error: sessionError} = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (sessionError || !userId || !storagePath.startsWith(userId + '/') || storagePath.includes('..')) return false;
  const {error} = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
  return !error;
}

export function uploadCategoryImageToSupabase(
  file: File
): Promise<ProductImageUploadResult> {
  return uploadCatalogImageToSupabase(file, {
    subdirectory: 'categories',
  });
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
