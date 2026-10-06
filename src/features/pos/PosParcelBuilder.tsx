import {useState} from 'react';
import {Modal} from '../../components/common/Modal';
import type {PosV2ConfigurableParcelLine} from '../../services/supabase/posV2.service';

export interface PosParcelOption {
  familyProductId: string; nameAr: string; parcelConfigurationId: string;
  configurationRevision: number; unitsPerParcel: number; parcelPriceInMinorUnits: number;
  components: Array<{productId: string; nameAr: string; flavorNameAr?: string; sku: string; availableQuantity: number}>;
}
export function PosParcelBuilder({option, initialComponents, onClose, onAdd}: {option: PosParcelOption;
  initialComponents?: Array<{product_id: string; base_quantity: number}>;
  onClose: () => void; onAdd: (line: PosV2ConfigurableParcelLine) => void}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(
    (initialComponents || []).map(c => [c.product_id, c.base_quantity])));
  const total = Object.keys(quantities).reduce((sum, key) => sum + quantities[key], 0);
  const valid = total === option.unitsPerParcel
    && Object.keys(quantities).every(id => option.components.some(c => c.productId === id)) && option.components.every(c => {
    const q = quantities[c.productId] || 0;
    return Number.isSafeInteger(q) && q >= 0 && q <= c.availableQuantity;
  });
  return <Modal isOpen onClose={onClose} title={`تركيب طرد: ${option.nameAr}`}>
    <div className="space-y-4 p-4" data-unsaved={total > 0 ? 'true' : undefined}>
      <p role="status">المختار: {total} / {option.unitsPerParcel} قطعة — السعر {(option.parcelPriceInMinorUnits / 1000).toFixed(3)} د.أ</p>
      {option.components.map(c => <label key={c.productId} className="flex items-center justify-between gap-3">
        <span>{c.flavorNameAr || c.nameAr} <small>المتاح: {c.availableQuantity}</small></span>
        <input type="number" min={0} max={c.availableQuantity} step={1} value={quantities[c.productId] || 0}
          aria-label={`كمية ${c.flavorNameAr || c.nameAr}`} className="w-20 rounded-lg bg-slate-800 p-2"
          onChange={e => setQuantities(q => ({...q, [c.productId]: Number(e.target.value)}))}/>
      </label>)}
      <button type="button" disabled={!valid} className="rounded-xl bg-emerald-600 p-3 disabled:opacity-50"
        onClick={() => onAdd({commercial_line_kind: 'configurable_parcel', family_product_id: option.familyProductId,
          parcel_configuration_id: option.parcelConfigurationId, configuration_revision: option.configurationRevision,
          parcel_instances: [{components: option.components.filter(c => (quantities[c.productId] || 0) > 0)
            .map(c => ({product_id: c.productId, base_quantity: quantities[c.productId]}))}]})}>إضافة الطرد المكتمل</button>
    </div>
  </Modal>;
}
