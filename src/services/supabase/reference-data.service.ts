import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Branch, Brand, Category, UnitDefinition, Warehouse } from '../../types';

export interface CategoryMutationResult {
  success: boolean;
  categoryId?: string;
  message?: string;
  error?: string;
  errorDetails?: {
    code?: string;
    message: string;
    details?: string;
    hint?: string;
  };
}

export interface BrandMutationResult {
  success: boolean;
  brandId?: string;
  message?: string;
  error?: string;
  errorDetails?: CategoryMutationResult['errorDetails'];
}

export interface UnitMutationResult {
  success: boolean;
  unitId?: string;
  message?: string;
  error?: string;
  errorDetails?: CategoryMutationResult['errorDetails'];
}

const rpcErrorDetails = (error: any) => ({
  code: error?.code,
  message: error?.message || 'تعذر تنفيذ العملية في قاعدة البيانات.',
  details: error?.details || undefined,
  hint: error?.hint || undefined,
});

export async function fetchCategoriesFromSupabase(): Promise<Category[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const [{ data, error }, { data: productRows, error: productCountError }] =
      await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .order('name_ar', { ascending: true }),
        supabase
          .from('products')
          .select('category_id')
          .eq('is_active', true),
      ]);

    if (error) {
      console.error('Supabase fetchCategories error:', error.message);
      return [];
    }
    if (productCountError) {
      console.error(
        'Supabase fetchCategories product count error:',
        productCountError.message
      );
    }

    const productCounts = new Map<string, number>();
    (productRows || []).forEach((item: { category_id: string | null }) => {
      if (!item.category_id) return;
      productCounts.set(
        item.category_id,
        (productCounts.get(item.category_id) || 0) + 1
      );
    });

    return (data || []).map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      code: item.code || '',
      icon: 'Tag',
      sortOrder: 1,
      isHidden: !item.is_active,
      productsCount: productCounts.get(item.id) || 0,
    }));
  } catch (err) {
    console.error('Supabase fetchCategories exception:', err);
    return [];
  }
}

export async function saveProductCategoryInSupabase(input: {
  categoryId?: string;
  nameAr: string;
  code?: string;
}): Promise<CategoryMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc('save_product_category', {
    p_category_id: input.categoryId || null,
    p_name_ar: input.nameAr.trim(),
    p_code: input.code?.trim() || null,
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
    categoryId: data?.categoryId,
    message: data?.message || 'تم حفظ القسم بنجاح.',
  };
}

export async function setProductCategoryActiveInSupabase(
  categoryId: string,
  isActive: boolean
): Promise<CategoryMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc(
    'set_product_category_active',
    {
      p_category_id: categoryId,
      p_is_active: isActive,
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
    success: Boolean(data?.success),
    categoryId: data?.categoryId,
    message:
      data?.message ||
      (isActive ? 'تمت إعادة إظهار القسم.' : 'تم إخفاء القسم.'),
  };
}

export async function fetchBrandsFromSupabase(): Promise<Brand[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const [{ data, error }, { data: productRows, error: productCountError }] =
      await Promise.all([
        supabase
          .from('brands')
          .select('*')
          .order('name_ar', { ascending: true }),
        supabase
          .from('products')
          .select('brand_id')
          .eq('is_active', true),
      ]);

    if (error) {
      console.error('Supabase fetchBrands error:', error.message);
      return [];
    }
    if (productCountError) {
      console.error(
        'Supabase fetchBrands product count error:',
        productCountError.message
      );
    }

    const productCounts = new Map<string, number>();
    (productRows || []).forEach((item: { brand_id: string | null }) => {
      if (!item.brand_id) return;
      productCounts.set(
        item.brand_id,
        (productCounts.get(item.brand_id) || 0) + 1
      );
    });

    return (data || []).map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      description: item.description || '',
      logoUrl: item.logo_url || '',
      isHidden: item.is_active === false,
      productsCount: productCounts.get(item.id) || 0,
    }));
  } catch (err) {
    console.error('Supabase fetchBrands exception:', err);
    return [];
  }
}

export async function saveProductBrandInSupabase(input: {
  brandId?: string;
  nameAr: string;
  description?: string;
  logoUrl?: string;
}): Promise<BrandMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc('save_product_brand', {
    p_brand_id: input.brandId || null,
    p_name_ar: input.nameAr.trim(),
    p_description: input.description?.trim() || null,
    p_logo_url: input.logoUrl?.trim() || null,
  });

  if (error) {
    return {
      success: false,
      error: error.message,
      errorDetails: rpcErrorDetails(error),
    };
  }

  return {
    success: Boolean(data?.success),
    brandId: data?.brandId,
    message: data?.message || 'تم حفظ العلامة التجارية بنجاح.',
  };
}

export async function setProductBrandActiveInSupabase(
  brandId: string,
  isActive: boolean
): Promise<BrandMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc(
    'set_product_brand_active',
    {
      p_brand_id: brandId,
      p_is_active: isActive,
    }
  );

  if (error) {
    return {
      success: false,
      error: error.message,
      errorDetails: rpcErrorDetails(error),
    };
  }

  return {
    success: Boolean(data?.success),
    brandId: data?.brandId,
    message:
      data?.message ||
      (isActive
        ? 'تمت إعادة إظهار العلامة التجارية.'
        : 'تم إخفاء العلامة التجارية.'),
  };
}

export async function fetchUnitsFromSupabase(): Promise<UnitDefinition[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const [{ data, error }, { data: productRows, error: productCountError }] =
      await Promise.all([
        supabase
          .from('units')
          .select('*')
          .order('name_ar', { ascending: true }),
        supabase
          .from('products')
          .select('id, unit_id, purchase_unit_id, sale_unit_id')
          .eq('is_active', true),
      ]);

    if (error) {
      console.error('Supabase fetchUnits error:', error.message);
      return [];
    }
    if (productCountError) {
      console.error(
        'Supabase fetchUnits product count error:',
        productCountError.message
      );
    }

    const productUsage = new Map<string, Set<string>>();
    (productRows || []).forEach(
      (item: {
        id: string;
        unit_id: string | null;
        purchase_unit_id: string | null;
        sale_unit_id: string | null;
      }) => {
        [item.unit_id, item.purchase_unit_id, item.sale_unit_id].forEach(
          (unitId) => {
            if (!unitId) return;
            const usage = productUsage.get(unitId) || new Set<string>();
            usage.add(item.id);
            productUsage.set(unitId, usage);
          }
        );
      }
    );

    return (data || []).map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      code: item.code,
      conversionFactor: Math.max(
        1,
        Number(item.conversion_factor) ||
          (item.code === 'CTN' ? 144 : item.code === 'PKT' ? 12 : 1)
      ),
      isSystem: Boolean(item.is_system),
      isHidden: item.is_active === false,
      productsCount: productUsage.get(item.id)?.size || 0,
    }));
  } catch (err) {
    console.error('Supabase fetchUnits exception:', err);
    return [];
  }
}

export async function saveProductUnitInSupabase(input: {
  unitId?: string;
  nameAr: string;
  code: string;
  conversionFactor: number;
}): Promise<UnitMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc('save_product_unit', {
    p_unit_id: input.unitId || null,
    p_name_ar: input.nameAr.trim(),
    p_code: input.code.trim().toUpperCase(),
    p_conversion_factor: Math.max(
      1,
      Math.floor(Number(input.conversionFactor) || 1)
    ),
  });

  if (error) {
    return {
      success: false,
      error: error.message,
      errorDetails: rpcErrorDetails(error),
    };
  }

  return {
    success: Boolean(data?.success),
    unitId: data?.unitId,
    message: data?.message || 'تم حفظ وحدة القياس بنجاح.',
  };
}

export async function setProductUnitActiveInSupabase(
  unitId: string,
  isActive: boolean
): Promise<UnitMutationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'تكوين Supabase غير مكتمل في التطبيق.',
    };
  }

  const { data, error } = await supabase.rpc(
    'set_product_unit_active',
    {
      p_unit_id: unitId,
      p_is_active: isActive,
    }
  );

  if (error) {
    return {
      success: false,
      error: error.message,
      errorDetails: rpcErrorDetails(error),
    };
  }

  return {
    success: Boolean(data?.success),
    unitId: data?.unitId,
    message:
      data?.message ||
      (isActive
        ? 'تمت إعادة إظهار وحدة القياس.'
        : 'تم إخفاء وحدة القياس.'),
  };
}

export async function fetchBranchesFromSupabase(): Promise<Branch[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Supabase fetchBranches error:', error.message);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      name: item.name_ar,
      address: item.address || item.city || 'الرمثا',
      city: item.city || 'الرمثا',
      phone: item.phone || '',
      isMain: item.code === 'BR-RAMTHA-01',
    }));
  } catch (err) {
    console.error('Supabase fetchBranches exception:', err);
    return [];
  }
}

export async function fetchWarehousesFromSupabase(): Promise<Warehouse[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Supabase fetchWarehouses error:', error.message);
      return [];
    }

    return (data || []).map((item: any) => ({
      id: item.id,
      name: item.name_ar,
      branchId: item.branch_id || '',
      location: item.location || '',
    }));
  } catch (err) {
    console.error('Supabase fetchWarehouses exception:', err);
    return [];
  }
}
