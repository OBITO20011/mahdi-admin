import {supabase} from '../../lib/supabase';

export type ParcelFeatureState = 'OFF' | 'OWNER_PILOT' | 'ENABLED';
export type ParcelMode = 'single_sku' | 'configurable_mix';
export interface ParcelConfigurationProduct {
  familyProductId: string; nameAr: string; sku: string; isFlavorMaster: boolean;
  unitsPerParcel: number; parcelPriceInMinorUnits: number;
  configuration: {id: string; composition_mode: ParcelMode; is_active: boolean; configuration_revision: number} | null;
  allowedProductIds: string[];
  components: {productId: string; nameAr: string; sku: string; flavorNameAr: string | null; packetPriceInMinorUnits?: number}[];
}
export interface ParcelConfigurationContext {featureState: ParcelFeatureState; products: ParcelConfigurationProduct[]}
export interface ParcelConfigurationInput {familyProductId: string; mode: ParcelMode; active: boolean; units: number; allowed: string[]}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export const isParcelFeatureState = (v: unknown): v is ParcelFeatureState => ['OFF','OWNER_PILOT','ENABLED'].includes(String(v));
export function parseParcelConfigurationContext(value: unknown): ParcelConfigurationContext {
  const data = value as ParcelConfigurationContext;
  if (!data || !isParcelFeatureState(data.featureState) || !Array.isArray(data.products)) throw Error('تعذر التحقق من إعداد الطرود؛ أعد تحميل البيانات.');
  const ids = new Set<string>();
  for (const product of data.products) {
    if (!product || !uuid(product.familyProductId) || ids.has(product.familyProductId)
      || typeof product.nameAr !== 'string' || typeof product.isFlavorMaster !== 'boolean'
      || !Number.isSafeInteger(product.unitsPerParcel) || product.unitsPerParcel < 1
      || !Number.isSafeInteger(product.parcelPriceInMinorUnits) || product.parcelPriceInMinorUnits < 0
      || !Array.isArray(product.components) || !Array.isArray(product.allowedProductIds)) throw Error('بيانات الطرد غير مكتملة.');
    ids.add(product.familyProductId);
    const components = new Set<string>();
    for (const component of product.components) {
      if (!component || !uuid(component.productId) || components.has(component.productId) || typeof component.nameAr !== 'string'
        || (component.packetPriceInMinorUnits !== undefined && (!Number.isSafeInteger(component.packetPriceInMinorUnits)
          || component.packetPriceInMinorUnits<0))) throw Error('بيانات النكهات غير مكتملة.');
      components.add(component.productId);
    }
    if (new Set(product.allowedProductIds).size !== product.allowedProductIds.length
      || product.allowedProductIds.some(id => !components.has(id))) throw Error('النكهات المسموحة لا تطابق العائلة.');
    if (product.configuration && (!uuid(product.configuration.id)
      || !['single_sku','configurable_mix'].includes(product.configuration.composition_mode)
      || typeof product.configuration.is_active !== 'boolean'
      || !Number.isSafeInteger(product.configuration.configuration_revision)
      || product.configuration.configuration_revision < 1)) throw Error('هوية إعداد الطرد غير صحيحة.');
  }
  return structuredClone(data);
}
export function validateParcelConfiguration(input: ParcelConfigurationInput, product: ParcelConfigurationProduct) {
  if (input.familyProductId !== product.familyProductId || !uuid(input.familyProductId)
    || !['single_sku','configurable_mix'].includes(input.mode) || typeof input.active !== 'boolean'
    || !Number.isSafeInteger(input.units) || input.units < 1 || !Array.isArray(input.allowed)
    || new Set(input.allowed).size !== input.allowed.length
    || input.allowed.some(id => !product.components.some(component => component.productId === id))
    || (input.active && !input.allowed.length)
    || (input.mode === 'configurable_mix' && !product.isFlavorMaster)
    || (input.mode === 'single_sku' && (input.allowed.length !== 1 || input.allowed[0] !== product.familyProductId))) throw Error('راجع عدد القطع والنكهات المسموحة ونمط الطرد.');
}
async function rpc(name: string, args?: Record<string, unknown>) {
  if (!supabase) throw Error('الاتصال بقاعدة البيانات غير متوفر.');
  const {data,error} = await supabase.rpc(name,args);
  if (error) throw Error(error.message || 'تعذر حفظ الإعداد؛ أعد التحميل للتحقق قبل محاولة أخرى.');
  return data;
}
export async function fetchParcelConfigurationContext() {
  return parseParcelConfigurationContext(await rpc('get_admin_parcel_configuration_context_v1'));
}
export async function saveParcelConfiguration(input: ParcelConfigurationInput, product: ParcelConfigurationProduct) {
  const captured = structuredClone(input); validateParcelConfiguration(captured,product);
  const data = await rpc('save_product_parcel_configuration_v1',{p_family_product_id:captured.familyProductId,
    p_composition_mode:captured.mode,p_is_active:captured.active,p_units_per_parcel:captured.units,p_allowed_product_ids:captured.allowed});
  if (data?.success !== true || data.configuration?.family_product_id !== captured.familyProductId
    || data.configuration?.composition_mode !== captured.mode || data.configuration?.is_active !== captured.active
    || data.unitsPerParcel !== captured.units || !Array.isArray(data.allowedProductIds)
    || JSON.stringify([...data.allowedProductIds].sort()) !== JSON.stringify([...captured.allowed].sort())) throw Error('نتيجة الحفظ غير مؤكدة؛ أعد تحميل الإعداد قبل أي تعديل جديد.');
}
export async function setParcelFeatureState(state: ParcelFeatureState) {
  if (!isParcelFeatureState(state)) throw Error('حالة الميزة غير صحيحة.');
  const data = await rpc('set_configurable_parcel_feature_state_v1',{p_state:state});
  if (data?.success !== true || data.feature_state !== state) throw Error('تغيير الحالة غير مؤكد؛ أعد التحميل للتحقق.');
}
