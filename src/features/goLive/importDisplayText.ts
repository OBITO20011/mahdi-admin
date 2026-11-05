/** Descriptive import text only. Never use for barcode,SKU,phone,dates or money. */
export const normalizeImportDisplayText=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,' ').trim();
export const IMPORT_DESCRIPTIVE_KEYS:ReadonlySet<string>=new Set(['name_ar','name','category_name','base_unit_name','purchase_unit_name','sale_unit_name','brand_name','description','customer_name','supplier_name','endorsed_supplier_name','bank_name','notes']);
export const importNormalizationNotice=(count:number)=>`تم تطبيع ${count} حقلاً وصفياً لتوحيد الحروف والمسافات. هذا التطبيع يخص النصوص الوصفية فقط.`;
