import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Product } from '../../types';

export interface CreateProductInput {
  sku: string;
  barcode?: string;
  nameAr: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  unitId?: string;
  unitName?: string;
  purchasePackage?: string;
  unitsPerPackage?: number;
  defaultPurchasePrice?: number;
  salePackage?: string;
  unitsPerSalePackage: number;
  salePackagePrice: number;
  costPrice: number; // in JOD
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

function readErrorStatus(error: unknown): number | string | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) {
    return undefined;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' || typeof status === 'string'
    ? status
    : undefined;
}

export interface UpdateProductInput {
  productId: string;
  sku: string;
  barcode?: string;
  nameAr: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  unitId?: string;
  unitName?: string;
  purchasePackage?: string;
  unitsPerPackage: number;
  defaultPurchasePrice: number;
  salePackage?: string;
  unitsPerSalePackage: number;
  salePackagePrice: number;
  costPrice: number;
  reorderLevel: number;
  maxStockLevel?: number;
  isActive: boolean;
  imageUrl?: string;
}

export interface CreateProductFlavorInput {
  masterProductId: string;
  flavorNameAr: string;
  openingSalePackages: number;
  warehouseId?: string;
  imageUrl?: string;
  barcode?: string;
}

export interface CreateProductFamilyInput extends CreateProductInput {
  flavors: Array<{
    nameAr: string;
    openingSalePackages: number;
    imageUrl?: string;
  }>;
}

export interface UpdateProductFlavorInput {
  flavorProductId: string;
  flavorNameAr: string;
  barcode?: string;
  imageUrl?: string;
  isActive: boolean;
}

function isValidUuid(id?: string | null): boolean {
  if (!id) return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id.trim());
}

export async function fetchProductsFromSupabase(): Promise<{
  products: Product[];
  source: 'supabase';
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

  let authSessionStatus: 'authenticated' | 'unauthenticated' | 'error';
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
    let productQuery: any = await supabase
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
        purchase_unit_id,
        units_per_purchase_unit,
        default_purchase_price_in_minor_units,
        sale_unit_id,
        units_per_sale_unit,
        default_sale_price_in_minor_units,
        cost_price_in_minor_units,
        sale_price_in_minor_units,
        wholesale_price_in_minor_units,
        min_stock_level,
        max_stock_level,
        is_active,
        flavor_master_product_id,
        flavor_name_ar,
        is_flavor_master,
        flavor_sort_order,
        created_at,
        updated_at,
        base_unit:units!products_unit_id_fkey ( id, name_ar, code ),
        purchase_unit:units!products_purchase_unit_id_fkey ( id, name_ar, code ),
        sale_unit:units!products_sale_unit_id_fkey ( id, name_ar, code )
      `)
      .order('created_at', { ascending: false });

    // Keep reads operational while a newly deployed client waits for migration
    // 019 to be applied. All writes still require the V2 RPCs.
    if (
      productQuery.error &&
      String(productQuery.error.message || '').includes(
        'wholesale_price_in_minor_units'
      )
    ) {
      productQuery = await supabase
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
          purchase_unit_id,
          units_per_purchase_unit,
          default_purchase_price_in_minor_units,
          sale_unit_id,
          units_per_sale_unit,
          default_sale_price_in_minor_units,
          cost_price_in_minor_units,
          sale_price_in_minor_units,
          min_stock_level,
          max_stock_level,
        is_active,
          flavor_master_product_id,
          flavor_name_ar,
          is_flavor_master,
          flavor_sort_order,
          created_at,
          updated_at,
          base_unit:units!products_unit_id_fkey ( id, name_ar, code ),
          purchase_unit:units!products_purchase_unit_id_fkey ( id, name_ar, code ),
          sale_unit:units!products_sale_unit_id_fkey ( id, name_ar, code )
        `)
        .order('created_at', { ascending: false });
    }

    const {
      data: dbProducts,
      error: prodError,
      status,
    } = productQuery;

    if (prodError) {
      console.error('[Supabase fetchProducts Error]:', {
        message: prodError.message,
        code: prodError.code,
        status: status || readErrorStatus(prodError),
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
          status: status || readErrorStatus(prodError) || 400,
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
      const defaultImg = imageMap[p.id] || '';

      const costInJod = Number(p.cost_price_in_minor_units || 0) / 1000;
      const saleInJod = Number(p.sale_price_in_minor_units || 0) / 1000;
      const wholesaleInJod =
        Number(
          p.wholesale_price_in_minor_units ??
            p.sale_price_in_minor_units ??
            0
        ) / 1000;

      const baseUnit = Array.isArray(p.base_unit) ? p.base_unit[0] : p.base_unit;
      const purchaseUnit = Array.isArray(p.purchase_unit)
        ? p.purchase_unit[0]
        : p.purchase_unit;
      const saleUnit = Array.isArray(p.sale_unit)
        ? p.sale_unit[0]
        : p.sale_unit;
      const unitName = baseUnit?.name_ar || 'قطعة';
      const unitsPerPackage = Math.max(
        1,
        Math.floor(Number(p.units_per_purchase_unit) || 1)
      );
      const defaultPurchasePrice =
        Number(p.default_purchase_price_in_minor_units || 0) / 1000 ||
        costInJod * unitsPerPackage;
      const unitsPerSalePackage = Math.max(
        1,
        Math.floor(Number(p.units_per_sale_unit) || unitsPerPackage)
      );
      const salePackagePrice = saleUnit
        ? Number(p.default_sale_price_in_minor_units || 0) / 1000
        : 0;

      return {
        id: p.id,
        sku: p.sku || '',
        barcode: p.barcode || '',
        nameAr: p.name_ar || '',
        description: p.description || '',
        imageUrl: defaultImg,
        categoryId: p.category_id || '',
        brandId: p.brand_id || '',
        purchaseUnitId: purchaseUnit?.id || p.purchase_unit_id || undefined,
        purchaseUnitCode: purchaseUnit?.code || undefined,
        purchasePackage: purchaseUnit?.name_ar || unitName,
        unitsPerPackage,
        defaultPurchasePrice,
        saleUnitId: saleUnit?.id || p.sale_unit_id || undefined,
        saleUnitCode: saleUnit?.code || undefined,
        salePackage: saleUnit?.name_ar || undefined,
        unitsPerSalePackage,
        salePackagePrice,
        costPrice: costInJod,
        retailPrice: saleInJod,
        wholesalePrice: wholesaleInJod,
        taxRate: 16,
        unit: unitName,
        onHandQuantity: bal.onHand,
        reservedQuantity: bal.reserved,
        availableQuantity: Math.max(0, bal.available),
        reorderLevel: p.min_stock_level ?? 0,
        maxStockLevel: p.max_stock_level ?? undefined,
        warehouseId: bal.warehouseId,
        status: p.is_active ? (bal.available === 0 ? 'out_of_stock' : 'active') : 'hidden',
        createdAt: p.created_at || new Date().toISOString(),
        updatedAt: p.updated_at || new Date().toISOString(),
        isFlavorMaster: Boolean(p.is_flavor_master),
        flavorMasterProductId: p.flavor_master_product_id || undefined,
        flavorNameAr: p.flavor_name_ar || undefined,
        flavorSortOrder: Number(p.flavor_sort_order || 0),
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

  let purchaseUnitIdToUse: string | null = null;
  if (input.purchasePackage?.trim()) {
    const { data: purchaseUnits } = await supabase
      .from('units')
      .select('id')
      .eq('name_ar', input.purchasePackage.trim())
      .limit(1);
    purchaseUnitIdToUse = purchaseUnits?.[0]?.id || null;
  }
  if (!purchaseUnitIdToUse) {
    purchaseUnitIdToUse = unitIdToUse;
  }

  let saleUnitIdToUse: string | null = null;
  if (input.salePackage?.trim()) {
    const { data: saleUnits } = await supabase
      .from('units')
      .select('id')
      .eq('name_ar', input.salePackage.trim())
      .limit(1);
    saleUnitIdToUse = saleUnits?.[0]?.id || null;
  }
  saleUnitIdToUse = saleUnitIdToUse || purchaseUnitIdToUse || unitIdToUse;

  const brandIdToUse: string | null = isValidUuid(input.brandId)
    ? input.brandId!
    : null;

  // 3. Convert prices to minor units (1 JOD = 1000 fils)
  const costMinorUnits = Math.round((Number(input.costPrice) || 0) * 1000);

  const rpcParams = {
    p_sku: input.sku.trim(),
    p_barcode: input.barcode ? input.barcode.trim() : null,
    p_name_ar: input.nameAr.trim(),
    p_description: input.description ? input.description.trim() : null,
    p_category_id: categoryIdToUse,
    p_brand_id: brandIdToUse,
    p_unit_id: unitIdToUse,
    p_purchase_unit_id: purchaseUnitIdToUse,
    p_units_per_purchase_unit: Math.max(
      1,
      Math.floor(Number(input.unitsPerPackage) || 1)
    ),
    p_default_purchase_price_in_minor_units: Math.round(
      Math.max(0, Number(input.defaultPurchasePrice) || 0) * 1000
    ),
    p_sale_unit_id: saleUnitIdToUse,
    p_units_per_sale_unit: Math.max(
      1,
      Math.floor(Number(input.unitsPerSalePackage) || 1)
    ),
    p_default_sale_price_in_minor_units: Math.round(
      Math.max(0, Number(input.salePackagePrice) || 0) * 1000
    ),
    p_cost_price_in_minor_units: costMinorUnits,
    p_min_stock_level: Number(input.reorderLevel) || 0,
    p_max_stock_level:
      input.maxStockLevel === undefined
        ? null
        : Number(input.maxStockLevel),
    p_warehouse_id: warehouseIdToUse,
    p_opening_quantity: Number(input.openingQuantity) || 0,
    p_notes: 'رصيد افتتاحي عند إضافة المنتج عبر التطبيق',
    p_image_url: input.imageUrl?.trim() || null,
  };

  console.log('[Supabase RPC Calling] create_product_with_opening_stock_v4');

  try {
    const { data: res, error } = await supabase.rpc(
      'create_product_with_opening_stock_v4',
      rpcParams
    );

    if (error) {
      console.error(
        '[Supabase RPC Error] create_product_with_opening_stock_v4 failed:',
        error
      );
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code || 'RPC_ERROR',
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
          status: readErrorStatus(error) || 400,
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

export async function createProductFlavorInSupabase(
  input: CreateProductFlavorInput
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'تكوين Supabase غير مكتمل في التطبيق.' };
  }

  const flavorName = input.flavorNameAr.trim();
  if (!flavorName) {
    return { success: false, error: 'اكتب اسم النكهة.' };
  }

  try {
    const { data, error } = await supabase.rpc('create_product_flavor_v1', {
      p_master_product_id: input.masterProductId,
      p_flavor_name_ar: flavorName,
      p_opening_sale_packages: Math.max(
        0,
        Math.floor(Number(input.openingSalePackages) || 0)
      ),
      p_warehouse_id: isValidUuid(input.warehouseId)
        ? input.warehouseId
        : null,
      p_image_url: input.imageUrl?.trim() || null,
      p_barcode: input.barcode?.trim() || null,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
        },
      };
    }

    return {
      success: data?.success === true,
      productId: data?.productId,
      message:
        data?.message ||
        'تمت إضافة النكهة بمخزون مستقل وسعر المنتج الأساسي.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر إضافة النكهة.',
      errorDetails: {
        code: error?.code || 'CLIENT_EXCEPTION',
        message: error?.message || 'تعذر إضافة النكهة.',
      },
    };
  }
}

export async function createProductFamilyWithFlavorsInSupabase(
  input: CreateProductFamilyInput
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'تكوين Supabase غير مكتمل في التطبيق.' };
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      success: false,
      error: 'انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مجددًا.',
    };
  }

  if (input.flavors.length < 1) {
    return { success: false, error: 'أضف نكهة واحدة على الأقل.' };
  }

  try {
    let warehouseIdToUse: string | null = isValidUuid(input.warehouseId)
      ? input.warehouseId!
      : null;
    if (!warehouseIdToUse) {
      const { data: warehouses } = await supabase
        .from('warehouses')
        .select('id')
        .eq('is_active', true)
        .limit(1);
      warehouseIdToUse = warehouses?.[0]?.id || null;
    }

    let categoryIdToUse: string | null = isValidUuid(input.categoryId)
      ? input.categoryId!
      : null;
    if (!categoryIdToUse) {
      const { data: categories } = await supabase
        .from('categories')
        .select('id')
        .eq('is_active', true)
        .limit(1);
      categoryIdToUse = categories?.[0]?.id || null;
    }

    let unitIdToUse: string | null = isValidUuid(input.unitId)
      ? input.unitId!
      : null;
    if (!unitIdToUse && input.unitName?.trim()) {
      const { data: units } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.unitName.trim())
        .limit(1);
      unitIdToUse = units?.[0]?.id || null;
    }
    if (!unitIdToUse) {
      const { data: units } = await supabase.from('units').select('id').limit(1);
      unitIdToUse = units?.[0]?.id || null;
    }

    let purchaseUnitIdToUse: string | null = null;
    if (input.purchasePackage?.trim()) {
      const { data: units } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.purchasePackage.trim())
        .limit(1);
      purchaseUnitIdToUse = units?.[0]?.id || null;
    }
    purchaseUnitIdToUse = purchaseUnitIdToUse || unitIdToUse;

    let saleUnitIdToUse: string | null = null;
    if (input.salePackage?.trim()) {
      const { data: units } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.salePackage.trim())
        .limit(1);
      saleUnitIdToUse = units?.[0]?.id || null;
    }
    saleUnitIdToUse = saleUnitIdToUse || purchaseUnitIdToUse || unitIdToUse;

    const { data, error } = await supabase.rpc(
      'create_product_family_with_flavors_v1',
      {
        p_sku: input.sku.trim(),
        p_barcode: input.barcode?.trim() || null,
        p_name_ar: input.nameAr.trim(),
        p_description: input.description?.trim() || null,
        p_category_id: categoryIdToUse,
        p_brand_id: isValidUuid(input.brandId) ? input.brandId : null,
        p_unit_id: unitIdToUse,
        p_purchase_unit_id: purchaseUnitIdToUse,
        p_units_per_purchase_unit: Math.max(
          1,
          Math.floor(Number(input.unitsPerPackage) || 1)
        ),
        p_default_purchase_price_in_minor_units: Math.round(
          Math.max(0, Number(input.defaultPurchasePrice) || 0) * 1000
        ),
        p_sale_unit_id: saleUnitIdToUse,
        p_units_per_sale_unit: Math.max(
          1,
          Math.floor(Number(input.unitsPerSalePackage) || 1)
        ),
        p_default_sale_price_in_minor_units: Math.round(
          Math.max(0, Number(input.salePackagePrice) || 0) * 1000
        ),
        p_cost_price_in_minor_units: Math.round(
          Math.max(0, Number(input.costPrice) || 0) * 1000
        ),
        p_min_stock_level: Math.max(
          0,
          Math.floor(Number(input.reorderLevel) || 0)
        ),
        p_max_stock_level:
          input.maxStockLevel === undefined
            ? null
            : Math.max(0, Math.floor(Number(input.maxStockLevel) || 0)),
        p_warehouse_id: warehouseIdToUse,
        p_image_url: input.imageUrl?.trim() || null,
        p_flavors: input.flavors.map((flavor) => ({
          nameAr: flavor.nameAr.trim(),
          openingSalePackages: Math.max(
            0,
            Math.floor(Number(flavor.openingSalePackages) || 0)
          ),
          imageUrl: flavor.imageUrl?.trim() || null,
        })),
      }
    );

    if (error) {
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
        },
      };
    }

    return {
      success: data?.success === true,
      productId: data?.productId,
      message:
        data?.message ||
        'تم إنشاء المنتج وجميع نكهاته ومخزونها بنجاح.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر إنشاء المنتج ونكهاته.',
      errorDetails: {
        code: error?.code || 'CLIENT_EXCEPTION',
        message: error?.message || 'تعذر إنشاء المنتج ونكهاته.',
      },
    };
  }
}

export async function updateProductFlavorInSupabase(
  input: UpdateProductFlavorInput
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'تكوين Supabase غير مكتمل في التطبيق.' };
  }

  try {
    const { data, error } = await supabase.rpc('update_product_flavor_v1', {
      p_flavor_product_id: input.flavorProductId,
      p_flavor_name_ar: input.flavorNameAr.trim(),
      p_barcode: input.barcode?.trim() || null,
      p_image_url: input.imageUrl?.trim() || null,
      p_is_active: input.isActive,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
        },
      };
    }

    return {
      success: data?.success === true,
      productId: data?.productId,
      message:
        data?.message ||
        'تم تحديث النكهة مع الحفاظ على مخزونها وسجلها.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر تحديث النكهة.',
      errorDetails: {
        code: error?.code || 'CLIENT_EXCEPTION',
        message: error?.message || 'تعذر تحديث النكهة.',
      },
    };
  }
}

export async function reorderProductFlavorsInSupabase(
  masterProductId: string,
  orderedFlavorIds: string[]
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, error: 'تكوين Supabase غير مكتمل في التطبيق.' };
  }

  try {
    const { data, error } = await supabase.rpc(
      'reorder_product_flavors_v1',
      {
        p_master_product_id: masterProductId,
        p_ordered_flavor_ids: orderedFlavorIds,
      }
    );

    if (error) {
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
        },
      };
    }

    return {
      success: data?.success === true,
      productId: data?.productId,
      message: data?.message || 'تم ترتيب النكهات.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر ترتيب النكهات.',
      errorDetails: {
        code: error?.code || 'CLIENT_EXCEPTION',
        message: error?.message || 'تعذر ترتيب النكهات.',
      },
    };
  }
}

export async function updateProductInSupabase(
  input: UpdateProductInput
): Promise<SupabaseRpcResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  try {
    let unitIdToUse = isValidUuid(input.unitId) ? input.unitId! : null;
    if (!unitIdToUse && input.unitName?.trim()) {
      const { data: units, error: unitError } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.unitName.trim())
        .limit(1);
      if (unitError) throw unitError;
      unitIdToUse = units?.[0]?.id || null;
    }

    let purchaseUnitIdToUse: string | null = null;
    if (input.purchasePackage?.trim()) {
      const { data: purchaseUnits, error: purchaseUnitError } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.purchasePackage.trim())
        .limit(1);
      if (purchaseUnitError) throw purchaseUnitError;
      purchaseUnitIdToUse = purchaseUnits?.[0]?.id || null;
    }
    purchaseUnitIdToUse = purchaseUnitIdToUse || unitIdToUse;

    let saleUnitIdToUse: string | null = null;
    if (input.salePackage?.trim()) {
      const { data: saleUnits, error: saleUnitError } = await supabase
        .from('units')
        .select('id')
        .eq('name_ar', input.salePackage.trim())
        .limit(1);
      if (saleUnitError) throw saleUnitError;
      saleUnitIdToUse = saleUnits?.[0]?.id || null;
    }
    saleUnitIdToUse =
      saleUnitIdToUse || purchaseUnitIdToUse || unitIdToUse;

    const { data, error } = await supabase.rpc('update_product_master_v3', {
      p_product_id: input.productId,
      p_sku: input.sku.trim(),
      p_barcode: input.barcode?.trim() || null,
      p_name_ar: input.nameAr.trim(),
      p_description: input.description?.trim() || null,
      p_category_id: isValidUuid(input.categoryId) ? input.categoryId : null,
      p_brand_id: isValidUuid(input.brandId) ? input.brandId : null,
      p_unit_id: unitIdToUse,
      p_purchase_unit_id: purchaseUnitIdToUse,
      p_units_per_purchase_unit: Math.max(
        1,
        Math.floor(Number(input.unitsPerPackage) || 1)
      ),
      p_default_purchase_price_in_minor_units: Math.round(
        Math.max(0, Number(input.defaultPurchasePrice) || 0) * 1000
      ),
      p_sale_unit_id: saleUnitIdToUse,
      p_units_per_sale_unit: Math.max(
        1,
        Math.floor(Number(input.unitsPerSalePackage) || 1)
      ),
      p_default_sale_price_in_minor_units: Math.round(
        Math.max(0, Number(input.salePackagePrice) || 0) * 1000
      ),
      p_cost_price_in_minor_units: Math.round(
        Math.max(0, Number(input.costPrice) || 0) * 1000
      ),
      p_min_stock_level: Math.max(
        0,
        Math.floor(Number(input.reorderLevel) || 0)
      ),
      p_max_stock_level:
        input.maxStockLevel === undefined
          ? null
          : Math.max(0, Math.floor(Number(input.maxStockLevel) || 0)),
      p_is_active: input.isActive,
      p_image_url: input.imageUrl?.trim() || null,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        errorDetails: {
          code: error.code,
          message: error.message,
          details: error.details || undefined,
          hint: error.hint || undefined,
        },
      };
    }

    return {
      success: Boolean(data?.success),
      productId: data?.productId || input.productId,
      message: data?.message || 'تم تحديث المنتج بنجاح.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'تعذر تحديث المنتج في Supabase.',
      errorDetails: {
        code: error?.code || 'CLIENT_EXCEPTION',
        message: error?.message || 'تعذر تحديث المنتج في Supabase.',
      },
    };
  }
}

