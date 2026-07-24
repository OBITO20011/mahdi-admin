import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Product } from '../../types';
import { INITIAL_PRODUCTS } from '../mockData';

export interface CreateProductInput {
  sku: string;
  barcode?: string;
  nameAr: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  unitId?: string;
  unitName?: string;
  costPrice: number; // in JOD
  retailPrice: number; // in JOD
  reorderLevel?: number;
  maxStockLevel?: number;
  warehouseId?: string;
  branchId?: string;
  openingQuantity: number;
  imageUrl?: string;
}

export interface SupabaseFetchError {
  message: string;
  code?: string;
  status?: number | string;
  details?: string;
  hint?: string;
}

export interface SupabaseRpcResult {
  success: boolean;
  productId?: string;
  message?: string;
  error?: string;
  errorDetails?: {
    code?: string;
    message: string;
    details?: string;
    hint?: string;
    status?: number | string;
  };
}

function isValidUuid(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id.trim());
}

export async function fetchProductsFromSupabase(): Promise<{
  products: Product[];
  source: 'supabase' | 'mock';
  error?: string;
  errorDetails?: SupabaseFetchError;
  authSessionStatus?: 'authenticated' | 'unauthenticated' | 'error';
  authSessionUser?: string | null;
}> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      products: [],
      source: 'supabase',
      error: 'لم يتم تعيين SUPABASE_URL و SUPABASE_PUBLISHABLE_KEY في src/config/supabase-public-config.ts',
    };
  }

  let authSessionStatus: 'authenticated' | 'unauthenticated' | 'error' = 'unauthenticated';
  let authSessionUser: string | null = null;

  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      console.error('[Supabase Auth getSession Error]:', sessionErr);
      authSessionStatus = 'error';
    } else if (sessionData?.session?.user) {
      authSessionStatus = 'authenticated';
      authSessionUser = sessionData.session.user.email || sessionData.session.user.id;
    } else {
      authSessionStatus = 'unauthenticated';
    }
  } catch (err) {
    console.error('[Supabase Auth getSession Exception]:', err);
    authSessionStatus = 'error';
  }

  try {
    // Query products table
    const { data: dbProducts, error: prodError, status } = await supabase
      .from('products')
      .select(`
        id,
        sku,
        barcode,
        name_ar,
        description,
        category_id,
        brand_id,
        unit_id,
        cost_price_in_minor_units,
        sale_price_in_minor_units,
        min_stock_level,
        max_stock_level,
        is_active,
        created_at,
        updated_at,
        units ( name_ar )
      `)
      .order('created_at', { ascending: false });

    if (prodError) {
      console.error('[Supabase fetchProducts Error]:', {
        message: prodError.message,
        code: prodError.code,
        status: status || (prodError as any).status,
        details: prodError.details,
        hint: prodError.hint,
      });

      return {
        products: [],
        source: 'supabase',
        error: prodError.message,
        errorDetails: {
          message: prodError.message,
          code: prodError.code || 'UNKNOWN_CODE',
          status: status || (prodError as any).status || 400,
          details: prodError.details || undefined,
          hint: prodError.hint || undefined,
        },
        authSessionStatus,
        authSessionUser,
      };
    }

    if (!dbProducts || dbProducts.length === 0) {
      return {
        products: [],
        source: 'supabase',
        authSessionStatus,
        authSessionUser,
      };
    }

    // Query inventory balances
    const { data: dbBalances, error: balError } = await supabase
      .from('inventory_balances')
      .select('product_id, warehouse_id, on_hand_quantity, reserved_quantity, available_quantity');

    if (balError) {
      console.error('[Supabase inventory_balances Query Error]:', balError);
    }

    // Query primary product images
    const { data: dbImages, error: imgError } = await supabase
      .from('product_images')
      .select('product_id, image_url, is_primary');

    if (imgError) {
      console.error('[Supabase product_images Query Error]:', imgError);
    }

    // Map balances by product_id
    const balanceMap: Record<string, { onHand: number; reserved: number; available: number; warehouseId?: string }> = {};
    if (dbBalances) {
      dbBalances.forEach((b: any) => {
        if (!balanceMap[b.product_id]) {
          balanceMap[b.product_id] = {
            onHand: 0,
            reserved: 0,
            available: 0,
            warehouseId: b.warehouse_id,
          };
        }
        balanceMap[b.product_id].onHand += b.on_hand_quantity || 0;
        balanceMap[b.product_id].reserved += b.reserved_quantity || 0;
        balanceMap[b.product_id].available += b.available_quantity ?? ((b.on_hand_quantity || 0) - (b.reserved_quantity || 0));
      });
    }

    // Map images by product_id
    const imageMap: Record<string, string> = {};
    if (dbImages) {
      dbImages.forEach((img: any) => {
        if (img.is_primary || !imageMap[img.product_id]) {
          imageMap[img.product_id] = img.image_url;
        }
      });
    }

    // Convert minor units (fils) to standard JOD (1 JOD = 1000 fils)
    const mappedProducts: Product[] = dbProducts.map((p: any) => {
      const bal = balanceMap[p.id] || { onHand: 0, reserved: 0, available: 0 };
      const defaultImg =
        imageMap[p.id] ||
        'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=400';

      const costInJod = Number(p.cost_price_in_minor_units || 0) / 1000;
      const saleInJod = Number(p.sale_price_in_minor_units || 0) / 1000;

      const unitName = (p.units && p.units.name_ar) ? p.units.name_ar : 'قطعة';

      return {
        id: p.id,
        sku: p.sku || '',
        barcode: p.barcode || '',
        nameAr: p.name_ar || '',
        description: p.description || '',
        imageUrl: defaultImg,
        categoryId: p.category_id || '',
        brandId: p.brand_id || '',
        costPrice: costInJod,
        retailPrice: saleInJod,
        wholesalePrice: saleInJod,
        taxRate: 16,
        unit: unitName,
        onHandQuantity: bal.onHand,
        reservedQuantity: bal.reserved,
        availableQuantity: Math.max(0, bal.available),
        reorderLevel: p.min_stock_level || 5,
        warehouseId: bal.warehouseId,
        status: p.is_active ? (bal.available === 0 ? 'out_of_stock' : 'active') : 'hidden',
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
      };
    });

    return {
      products: mappedProducts,
      source: 'supabase',
      authSessionStatus,
      authSessionUser,
    };
  } catch (err: any) {
    console.error('[Supabase fetchProducts Exception]:', err);
    return {
      products: [],
      source: 'supabase',
      error: err?.message || String(err),
      errorDetails: {
        message: err?.message || String(err),
        code: 'CLIENT_EXCEPTION',
        status: 500,
      },
      authSessionStatus,
      authSessionUser,
    };
  }
}

/**
 * Creates a product with opening stock using RPC create_product_with_opening_stock
 */
export async function createProductWithOpeningStockInSupabase(
  input: CreateProductInput
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
      errorDetails: {
        code: 'SUPABASE_NOT_CONFIGURED',
        message: 'تكوين Supabase غير مكتمل في التطبيق.',
      },
    };
  }

  // 1. Session Verification
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !sessionData?.session) {
    return {
      success: false,
      error: 'انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مجددًا.',
      errorDetails: {
        code: 'AUTH_SESSION_EXPIRED',
        message: 'انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مجددًا.',
        details: sessionErr?.message || 'لم يتم العثور على جلسة مصادقة نشطة في Supabase Client.',
        hint: 'يرجى تسجيل الخروج ثم إعادة تسجيل الدخول لتفعيل التوكن.',
      },
    };
  }

  // 2. Resolve UUIDs for relational parameters (warehouse_id, category_id, unit_id, brand_id)
  let warehouseIdToUse: string | null = isValidUuid(input.warehouseId) ? input.warehouseId! : null;
  if (!warehouseIdToUse) {
    const { data: whList } = await supabase.from('warehouses').select('id').eq('is_active', true).limit(1);
    if (whList && whList.length > 0) {
      warehouseIdToUse = whList[0].id;
    }
  }

  let categoryIdToUse: string | null = isValidUuid(input.categoryId) ? input.categoryId! : null;
  if (!categoryIdToUse) {
    const { data: catList } = await supabase.from('categories').select('id').eq('is_active', true).limit(1);
    if (catList && catList.length > 0) {
      categoryIdToUse = catList[0].id;
    }
  }

  let unitIdToUse: string | null = isValidUuid(input.unitId) ? input.unitId! : null;
  if (!unitIdToUse) {
    const { data: unitList } = await supabase.from('units').select('id').limit(1);
    if (unitList && unitList.length > 0) {
      unitIdToUse = unitList[0].id;
    }
  }

  let brandIdToUse: string | null = isValidUuid(input.brandId) ? input.brandId! : null;

  // 3. Convert prices to minor units (1 JOD = 1000 fils)
  const costMinorUnits = Math.round((Number(input.costPrice) || 0) * 1000);
  const saleMinorUnits = Math.round((Number(input.retailPrice) || 0) * 1000);

  const rpcParams = {
    p_sku: input.sku.trim(),
    p_barcode: input.barcode ? input.barcode.trim() : null,
    p_name_ar: input.nameAr.trim(),
    p_description: input.description ? input.description.trim() : null,
    p_category_id: categoryIdToUse,
    p_brand_id: brandIdToUse,
    p_unit_id: unitIdToUse,
    p_cost_price_in_minor_units: costMinorUnits,
    p_sale_price_in_minor_units: saleMinorUnits,
    p_min_stock_level: Number(input.reorderLevel) || 0,
    p_max_stock_level: input.maxStockLevel ? Number(input.maxStockLevel) : null,
    p_warehouse_id: warehouseIdToUse,
    p_opening_quantity: Number(input.openingQuantity) || 0,
    p_notes: 'رصيد افتتاحي عند إضافة المنتج عبر التطبيق',
  };

  console.log('[Supabase RPC Calling] create_product_with_opening_stock params:', rpcParams);

  try {
    const { data: res, error } = await supabase.rpc('create_product_with_opening_stock', rpcParams);

    if (error) {
      console.error('[Supabase RPC Error] create_product_with_opening_stock failed:', error);
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code || 'RPC_ERROR',
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
          status: (error as any).status || 400,
        },
      };
    }

    const createdProdId = res?.product_id;

    if (!createdProdId) {
      return {
        success: false,
        error: 'لم يرجع الخادم معرف المنتج (product_id)',
        errorDetails: {
          code: 'MISSING_PRODUCT_ID',
          message: 'تم استدعاء الدالة لكن لم يتم إرجاع product_id.',
        },
      };
    }

    // 4. Verify actual records created in Supabase tables: public.products, public.inventory_balances, public.inventory_movements
    const { data: checkProd, error: checkProdErr } = await supabase
      .from('products')
      .select('id, name_ar, sku')
      .eq('id', createdProdId)
      .single();

    if (checkProdErr || !checkProd) {
      return {
        success: false,
        error: 'فشل التحقق من وجود السجل في public.products',
        errorDetails: {
          code: checkProdErr?.code || 'VERIFICATION_FAILED_PRODUCTS',
          message: checkProdErr?.message || 'لم يتواجد السجل في جدول public.products بعد إنشائه.',
          details: checkProdErr?.details,
          hint: checkProdErr?.hint,
        },
      };
    }

    const { data: checkBal } = await supabase
      .from('inventory_balances')
      .select('*')
      .eq('product_id', createdProdId);

    const { data: checkMov } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('product_id', createdProdId);

    console.log('[Supabase Multi-Table Verification Success]:', {
      product: checkProd,
      inventory_balances: checkBal,
      inventory_movements: checkMov,
    });

    // Save image if provided
    if (createdProdId && input.imageUrl) {
      try {
        await supabase.from('product_images').insert({
          product_id: createdProdId,
          image_url: input.imageUrl,
          is_primary: true,
          display_order: 1,
        });
      } catch (imgErr) {
        console.warn('Failed to insert product_images:', imgErr);
      }
    }

    return {
      success: true,
      productId: createdProdId,
      message: 'تم حفظ المنتج والمخزون في قاعدة البيانات بنجاح.',
    };
  } catch (err: any) {
    console.error('Exception during createProductWithOpeningStockInSupabase:', err);
    return {
      success: false,
      error: err?.message || 'تعذر الاتصال بـ Supabase',
      errorDetails: {
        code: 'CLIENT_EXCEPTION',
        message: err?.message || String(err),
      },
    };
  }
}

