import {Minus, Plus} from 'lucide-react';
import {CargoAddButton} from './CargoAddButton';
import {formatJod} from '../utils/money';
import {calculateProductSelectionTotal} from '../utils/productDetails';

interface Props {
  label: string; unit: string; productName: string; price: number;
  quantity: number; remaining: number; disabled: boolean;
  onChange: (quantity: number) => void; onAdd: () => void;
}
export function ProductPurchaseControl({label, unit, productName, price, quantity, remaining, disabled, onChange, onAdd}: Props) {
  return <section aria-label={`إضافة ${unit}`} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-2">
    <p className="text-center text-xs font-black leading-5 text-blue-950">{label} — {formatJod(price)}</p>
    <div className="flex items-center justify-center rounded-xl border border-blue-200 bg-white">
      <button type="button" aria-label={`إنقاص كمية ${unit}`} disabled={disabled || quantity <= 1} onClick={() => onChange(quantity - 1)} className="grid h-11 w-11 shrink-0 place-items-center text-blue-700 disabled:text-slate-400"><Minus className="h-4 w-4" /></button>
      <output aria-label={`كمية ${unit}`} className="min-w-7 text-center text-sm font-black text-slate-950">{quantity.toLocaleString('ar-JO')}</output>
      <button type="button" aria-label={`زيادة كمية ${unit}`} disabled={disabled || quantity >= remaining} onClick={() => onChange(quantity + 1)} className="grid h-11 w-11 shrink-0 place-items-center text-blue-700 disabled:text-slate-400"><Plus className="h-4 w-4" /></button>
    </div>
    <CargoAddButton onAdd={onAdd} disabled={disabled || remaining === 0} itemLabel={unit}
      ariaLabel={`إضافة ${quantity.toLocaleString('ar-JO')} ${unit} من ${productName} إلى السلة`}
      label={remaining === 0 ? 'الكمية في السلة' : `إضافة ${quantity.toLocaleString('ar-JO')} ${unit}`}
      className="min-h-11 justify-center !px-2 [&_.cargo-scene]:hidden" />
    <p className="text-center text-[10px] font-bold text-blue-900">الإجمالي {formatJod(calculateProductSelectionTotal(price, quantity))}</p>
  </section>;
}
