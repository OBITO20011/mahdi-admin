import { Minus, PackageCheck, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ParcelInstanceSelection,
  PublicConfigurableParcelOption,
} from '../types/catalog';
import { createParcelInstance } from '../utils/cart';
import { formatJod } from '../utils/money';
import { ProductImage } from './ProductImage';

interface ParcelBuilderModalProps {
  option: PublicConfigurableParcelOption;
  initialInstance?: ParcelInstanceSelection;
  reservedByProductId: ReadonlyMap<string, number>;
  onClose: () => void;
  onSave: (instance: ParcelInstanceSelection) => void;
}

export function ParcelBuilderModal({
  option,
  initialInstance,
  reservedByProductId,
  onClose,
  onSave,
}: ParcelBuilderModalProps) {
  const [selection, setSelection] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      initialInstance?.components.map((component) => [component.productId, component.baseQuantity]) ?? []
    )
  );
  const selectedCount = Object.values(selection).reduce((sum, value) => sum + value, 0);
  const remaining = option.unitsPerParcel - selectedCount;
  const availableFor = (productId: string, current: number) => {
    const component = option.components.find((candidate) => candidate.productId === productId);
    const reservedElsewhere = Math.max(0, (reservedByProductId.get(productId) ?? 0) - current);
    return Math.max(0, (component?.availableQuantity ?? 0) - reservedElsewhere);
  };
  const canSave = remaining === 0;
  const summary = useMemo(() => option.components.flatMap((component) => {
    const quantity = selection[component.productId] ?? 0;
    return quantity > 0 ? [`${component.flavorNameAr || component.nameAr} × ${quantity}`] : [];
  }), [option.components, selection]);

  const change = (productId: string, delta: number) => {
    setSelection((current) => {
      const oldQuantity = current[productId] ?? 0;
      const nextQuantity = Math.max(0, Math.min(oldQuantity + delta, availableFor(productId, oldQuantity)));
      if (delta > 0 && remaining <= 0) return current;
      return { ...current, [productId]: nextQuantity };
    });
  };

  const save = () => {
    if (!canSave) return;
    const components = option.components.flatMap((component) => {
      const baseQuantity = selection[component.productId] ?? 0;
      return baseQuantity > 0 ? [{
        productId: component.productId,
        sku: component.sku,
        nameAr: component.nameAr,
        flavorNameAr: component.flavorNameAr,
        unitNameAr: component.unitNameAr,
        imageUrl: component.imageUrl,
        baseQuantity,
      }] : [];
    });
    const next = createParcelInstance(components);
    onSave(initialInstance ? {
      ...next,
      localInstanceId: initialInstance.localInstanceId,
      localRevision: initialInstance.localRevision + 1,
    } : next);
  };

  return (
    <div className="fixed inset-0 z-[70]" dir="rtl">
      <button type="button" aria-label="إغلاق مكوّن الطرد" onClick={onClose} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="parcel-builder-title" className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[2rem] bg-white shadow-2xl sm:inset-x-6 sm:bottom-auto sm:top-1/2 sm:mx-auto sm:max-w-2xl sm:-translate-y-1/2 sm:rounded-[2rem]">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 sm:p-5">
          <div>
            <p className="text-[10px] font-black text-violet-700">تكوين طرد بالنكهات</p>
            <h2 id="parcel-builder-title" className="mt-1 text-lg font-black text-slate-950">اختر {option.unitsPerParcel.toLocaleString('ar-JO')} {option.baseUnitNameAr}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-600"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <div className={`rounded-3xl border p-4 ${remaining === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-violet-200 bg-violet-50'}`}>
            <div className="flex items-center justify-between gap-3">
              <strong className="text-sm font-black text-slate-950">تم اختيار {selectedCount.toLocaleString('ar-JO')} من {option.unitsPerParcel.toLocaleString('ar-JO')}</strong>
              <span className="text-sm font-black text-violet-700">{formatJod(option.parcelPriceInMinorUnits)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${Math.min(100, selectedCount / option.unitsPerParcel * 100)}%` }} /></div>
            {summary.length > 0 && <p className="mt-2 text-[10px] font-bold text-slate-600">{summary.join('، ')}</p>}
          </div>

          {option.components.map((component) => {
            const quantity = selection[component.productId] ?? 0;
            const available = availableFor(component.productId, quantity);
            return (
              <article key={component.productId} className="flex items-center gap-3 rounded-3xl border border-slate-200 p-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100"><ProductImage src={component.imageUrl} alt={component.flavorNameAr || component.nameAr} imageClassName="h-full w-full object-contain" /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-xs font-black text-slate-900">{component.flavorNameAr || component.nameAr}</h3>
                  <p className="mt-1 text-[9px] font-bold text-slate-500">المتاح لهذه السلة: {available.toLocaleString('ar-JO')} {component.unitNameAr}</p>
                </div>
                <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50">
                  <button type="button" aria-label={`إنقاص ${component.flavorNameAr}`} onClick={() => change(component.productId, -1)} disabled={quantity === 0} className="grid h-11 w-10 place-items-center disabled:text-slate-300"><Minus className="h-4 w-4" /></button>
                  <span className="min-w-8 text-center text-sm font-black">{quantity.toLocaleString('ar-JO')}</span>
                  <button type="button" aria-label={`زيادة ${component.flavorNameAr}`} onClick={() => change(component.productId, 1)} disabled={remaining === 0 || quantity >= available} className="grid h-11 w-10 place-items-center text-violet-700 disabled:text-slate-300"><Plus className="h-4 w-4" /></button>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          <button type="button" onClick={save} disabled={!canSave} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-violet-700 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            <PackageCheck className="h-5 w-5" />
            {initialInstance ? 'حفظ تعديل الطرد' : 'إضافة الطرد للسلة'}
          </button>
          {!canSave && <p className="mt-2 text-center text-[10px] font-bold text-amber-700">أكمل {remaining.toLocaleString('ar-JO')} {option.baseUnitNameAr} قبل الإضافة.</p>}
        </footer>
      </section>
    </div>
  );
}
