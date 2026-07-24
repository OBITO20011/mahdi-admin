import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { Branch, Brand, Category, UnitDefinition, Warehouse } from '../../types';
import { DEFAULT_BRANCHES, DEFAULT_CATEGORIES, DEFAULT_WAREHOUSES } from '../../constants';

export async function fetchCategoriesFromSupabase(): Promise<Category[]> {
  if (!isSupabaseConfigured || !supabase) {
    return DEFAULT_CATEGORIES;
  }

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      if (error) console.warn('Supabase fetchCategories error, falling back to mock:', error.message);
      return DEFAULT_CATEGORIES;
    }

    return data.map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      code: item.code || '',
      icon: 'Tag',
      sortOrder: 1,
      isHidden: false,
      productsCount: 0,
    }));
  } catch (err) {
    console.warn('Fallback to mock categories due to exception:', err);
    return DEFAULT_CATEGORIES;
  }
}

export async function fetchBrandsFromSupabase(): Promise<Brand[]> {
  const fallbackBrands: Brand[] = [
    { id: 'b-1', nameAr: 'شركة دكّان للحلويات', logoUrl: 'https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&q=80&w=100' },
    { id: 'b-2', nameAr: 'مزارع مزمز للمياه النقية', logoUrl: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?auto=format&fit=crop&q=80&w=100' },
    { id: 'b-3', nameAr: 'نواصرة فاخر' },
  ];

  if (!isSupabaseConfigured || !supabase) {
    return fallbackBrands;
  }

  try {
    const { data, error } = await supabase.from('brands').select('*');

    if (error || !data || data.length === 0) {
      if (error) console.warn('Supabase fetchBrands error, falling back to mock:', error.message);
      return fallbackBrands;
    }

    return data.map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      description: item.description || '',
    }));
  } catch (err) {
    console.warn('Fallback to mock brands:', err);
    return fallbackBrands;
  }
}

export async function fetchUnitsFromSupabase(): Promise<UnitDefinition[]> {
  const fallbackUnits: UnitDefinition[] = [
    { id: 'u-piece', nameAr: 'قطعة', code: 'PCS', conversionFactor: 1, isSystem: true },
    { id: 'u-packet', nameAr: 'باكيت', code: 'PKT', conversionFactor: 12, isSystem: true },
    { id: 'u-carton', nameAr: 'كرتونة', code: 'CTN', conversionFactor: 144, isSystem: true },
  ];

  if (!isSupabaseConfigured || !supabase) {
    return fallbackUnits;
  }

  try {
    const { data, error } = await supabase.from('units').select('*');

    if (error || !data || data.length === 0) {
      if (error) console.warn('Supabase fetchUnits error, falling back to mock:', error.message);
      return fallbackUnits;
    }

    return data.map((item: any) => ({
      id: item.id,
      nameAr: item.name_ar,
      code: item.code,
      conversionFactor: item.code === 'CTN' ? 144 : item.code === 'PKT' ? 12 : 1,
      isSystem: true,
    }));
  } catch (err) {
    console.warn('Fallback to mock units:', err);
    return fallbackUnits;
  }
}

export async function fetchBranchesFromSupabase(): Promise<Branch[]> {
  if (!isSupabaseConfigured || !supabase) {
    return DEFAULT_BRANCHES;
  }

  try {
    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      if (error) console.warn('Supabase fetchBranches error, falling back to mock:', error.message);
      return DEFAULT_BRANCHES;
    }

    return data.map((item: any) => ({
      id: item.id,
      name: item.name_ar,
      address: item.address || item.city || 'عمان',
      city: item.city || 'عمان',
      phone: item.phone || '065551234',
      isMain: item.code === 'BR-AMMAN-01',
    }));
  } catch (err) {
    console.warn('Fallback to mock branches:', err);
    return DEFAULT_BRANCHES;
  }
}

export async function fetchWarehousesFromSupabase(): Promise<Warehouse[]> {
  if (!isSupabaseConfigured || !supabase) {
    return DEFAULT_WAREHOUSES;
  }

  try {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      if (error) console.warn('Supabase fetchWarehouses error, falling back to mock:', error.message);
      return DEFAULT_WAREHOUSES;
    }

    return data.map((item: any) => ({
      id: item.id,
      name: item.name_ar,
      branchId: item.branch_id || 'b-amman-main',
      location: item.location || '',
    }));
  } catch (err) {
    console.warn('Fallback to mock warehouses:', err);
    return DEFAULT_WAREHOUSES;
  }
}
