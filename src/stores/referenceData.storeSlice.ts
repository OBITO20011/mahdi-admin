import type { Brand, Category, UnitDefinition } from '../types';
import {
  fetchBrandsFromSupabase,
  fetchCategoriesFromSupabase,
  fetchUnitsFromSupabase,
  saveProductBrandInSupabase,
  saveProductCategoryInSupabase,
  saveProductUnitInSupabase,
  setProductBrandActiveInSupabase,
  setProductCategoryActiveInSupabase,
  setProductUnitActiveInSupabase,
} from '../services/supabase/reference-data.service';

type ToastType = 'success' | 'error' | 'info';

interface ReferenceDataStoreDependencies {
  getCategories: () => readonly Category[];
  getBrands: () => readonly Brand[];
  getUnits: () => readonly UnitDefinition[];
  replaceCategories: (categories: Category[]) => void;
  replaceBrands: (brands: Brand[]) => void;
  replaceUnits: (units: UnitDefinition[]) => void;
  setToast: (message: string, type?: ToastType) => void;
}

export class ReferenceDataStoreSlice {
  constructor(private readonly dependencies: ReferenceDataStoreDependencies) {}

  async refreshCategories() {
    const categories = await fetchCategoriesFromSupabase();
    this.dependencies.replaceCategories(categories);
    return categories;
  }

  async refreshBrands() {
    const brands = await fetchBrandsFromSupabase();
    this.dependencies.replaceBrands(brands);
    return brands;
  }

  async refreshUnits() {
    const units = await fetchUnitsFromSupabase();
    this.dependencies.replaceUnits(units);
    return units;
  }

  async addCategory(data: Partial<Category>) {
    if (!data.nameAr?.trim()) {
      return { success: false, error: 'اسم القسم مطلوب.' };
    }

    const result = await saveProductCategoryInSupabase({
      nameAr: data.nameAr,
      code: data.code,
      imageUrl: data.imageUrl,
    });
    if (!result.success) {
      this.dependencies.setToast(result.error || 'فشل حفظ القسم.', 'error');
      return result;
    }

    await this.refreshCategories();
    this.dependencies.setToast(
      result.message || `تمت إضافة القسم ${data.nameAr}.`,
    );
    return result;
  }

  async updateCategory(id: string, updates: Partial<Category>) {
    const current = this.dependencies
      .getCategories()
      .find((category) => category.id === id);
    if (!current) {
      return { success: false, error: 'القسم غير موجود.' };
    }

    const result = await saveProductCategoryInSupabase({
      categoryId: id,
      nameAr: updates.nameAr?.trim() || current.nameAr,
      code: updates.code ?? current.code,
      imageUrl: updates.imageUrl ?? current.imageUrl,
    });
    if (!result.success) {
      this.dependencies.setToast(result.error || 'فشل تحديث القسم.', 'error');
      return result;
    }

    await this.refreshCategories();
    this.dependencies.setToast(
      result.message || `تم تحديث القسم ${current.nameAr}.`,
    );
    return result;
  }

  async setCategoryActive(id: string, isActive: boolean) {
    const category = this.dependencies
      .getCategories()
      .find((item) => item.id === id);
    if (!category) {
      return { success: false, error: 'القسم غير موجود.' };
    }

    const result = await setProductCategoryActiveInSupabase(id, isActive);
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل تحديث حالة القسم.',
        'error',
      );
      return result;
    }

    await this.refreshCategories();
    this.dependencies.setToast(result.message || 'تم تحديث حالة القسم.');
    return result;
  }

  deleteCategory(id: string) {
    return this.setCategoryActive(id, false);
  }

  async addBrand(data: Partial<Brand>) {
    if (!data.nameAr?.trim()) {
      return { success: false, error: 'اسم العلامة التجارية مطلوب.' };
    }

    const result = await saveProductBrandInSupabase({
      nameAr: data.nameAr,
      description: data.description,
      logoUrl: data.logoUrl,
    });
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل حفظ العلامة التجارية.',
        'error',
      );
      return result;
    }

    await this.refreshBrands();
    this.dependencies.setToast(
      result.message || `تمت إضافة العلامة ${data.nameAr}.`,
    );
    return result;
  }

  async updateBrand(id: string, updates: Partial<Brand>) {
    const brand = this.dependencies.getBrands().find((item) => item.id === id);
    if (!brand) {
      return { success: false, error: 'العلامة التجارية غير موجودة.' };
    }

    const result = await saveProductBrandInSupabase({
      brandId: id,
      nameAr: updates.nameAr?.trim() || brand.nameAr,
      description: updates.description ?? brand.description,
      logoUrl: updates.logoUrl ?? brand.logoUrl,
    });
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل تحديث العلامة التجارية.',
        'error',
      );
      return result;
    }

    await this.refreshBrands();
    this.dependencies.setToast(
      result.message || `تم تحديث العلامة ${brand.nameAr}.`,
    );
    return result;
  }

  async setBrandActive(id: string, isActive: boolean) {
    const brand = this.dependencies.getBrands().find((item) => item.id === id);
    if (!brand) {
      return { success: false, error: 'العلامة التجارية غير موجودة.' };
    }

    const result = await setProductBrandActiveInSupabase(id, isActive);
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل تحديث حالة العلامة التجارية.',
        'error',
      );
      return result;
    }

    await this.refreshBrands();
    this.dependencies.setToast(
      result.message || 'تم تحديث حالة العلامة التجارية.',
    );
    return result;
  }

  deleteBrand(id: string) {
    return this.setBrandActive(id, false);
  }

  async addUnit(data: Partial<UnitDefinition>) {
    if (!data.nameAr?.trim() || !data.code?.trim()) {
      return { success: false, error: 'اسم الوحدة وكودها مطلوبان.' };
    }

    const result = await saveProductUnitInSupabase({
      nameAr: data.nameAr,
      code: data.code,
      conversionFactor: data.conversionFactor || 1,
    });
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل حفظ وحدة القياس.',
        'error',
      );
      return result;
    }

    await this.refreshUnits();
    this.dependencies.setToast(
      result.message || `تمت إضافة الوحدة ${data.nameAr}.`,
    );
    return result;
  }

  async updateUnit(id: string, updates: Partial<UnitDefinition>) {
    const unit = this.dependencies.getUnits().find((item) => item.id === id);
    if (!unit) {
      return { success: false, error: 'وحدة القياس غير موجودة.' };
    }

    const result = await saveProductUnitInSupabase({
      unitId: id,
      nameAr: updates.nameAr?.trim() || unit.nameAr,
      code: updates.code?.trim() || unit.code,
      conversionFactor: updates.conversionFactor ?? unit.conversionFactor,
    });
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل تحديث وحدة القياس.',
        'error',
      );
      return result;
    }

    await this.refreshUnits();
    this.dependencies.setToast(
      result.message || `تم تحديث الوحدة ${unit.nameAr}.`,
    );
    return result;
  }

  async setUnitActive(id: string, isActive: boolean) {
    const unit = this.dependencies.getUnits().find((item) => item.id === id);
    if (!unit) {
      return { success: false, error: 'وحدة القياس غير موجودة.' };
    }

    const result = await setProductUnitActiveInSupabase(id, isActive);
    if (!result.success) {
      this.dependencies.setToast(
        result.error || 'فشل تحديث حالة وحدة القياس.',
        'error',
      );
      return result;
    }

    await this.refreshUnits();
    this.dependencies.setToast(
      result.message || 'تم تحديث حالة وحدة القياس.',
    );
    return result;
  }

  deleteUnit(id: string) {
    return this.setUnitActive(id, false);
  }
}
