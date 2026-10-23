import React, { useEffect, useId, useState } from 'react';
import { Calculator, CheckCircle2 } from 'lucide-react';
import { FormFields, UiButton, formatJod } from '../../components/ui';
import { CURRENCY } from '../../constants';
import {
  correctProductCost,
  currentUnitCostInMinorUnits,
  fetchProductCostState,
  type ProductCostState,
} from '../../services/supabase/productCost.service';

interface ProductCostCorrectionPanelProps {
  /** One product, or the flavors of a family (the family row holds no stock). */
  targets: { id: string; name: string; unit?: string }[];
  onCorrected: () => void;
  onClose: () => void;
}

const fieldClass = 'h-11 w-full rounded-xl border border-nw-border bg-nw-surface px-3 text-sm text-nw-text';
const newKey = () => `cost-correction-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Owner only (enforced in the database): corrects the average cost per piece with a mandatory reason. */
export const ProductCostCorrectionPanel: React.FC<ProductCostCorrectionPanelProps> = ({ targets, onCorrected, onClose }) => {
  const ids = { cost: useId(), reason: useId(), title: useId(), target: useId() };
  const [productId, setProductId] = useState(targets[0]?.id ?? '');
  const productName = targets.find(target => target.id === productId)?.name ?? '';
  const unitName = targets.find(target => target.id === productId)?.unit || 'باكيت';
  const [state, setState] = useState<ProductCostState | null>(null);
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setState(null);
    if (!productId) return;
    fetchProductCostState(productId)
      .then(result => { if (live) setState(result); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'تعذر تحميل التكلفة.'); });
    return () => { live = false; };
  }, [productId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^\d+(?:\.\d{1,3})?$/u.test(cost.trim())) { setError(`أدخل تكلفة ${unitName} بالدينار بثلاث منازل عشرية كحد أقصى.`); return; }
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) { setError('اكتب سبب التصحيح (5 إلى 500 حرف).'); return; }
    setBusy(true);
    try {
      const [whole, fraction = ''] = cost.trim().split('.');
      await correctProductCost({ productId, unitCostInMinorUnits: Number(whole) * 1000 + Number(fraction.padEnd(3, '0')),
        reason: trimmed, idempotencyKey: key });
      onCorrected();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تصحيح التكلفة.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={ids.title} data-testid="product-cost-correction" className="rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
      <h3 id={ids.title} className="m-0 flex items-center gap-2 text-sm font-black">
        <Calculator className="h-4 w-4 text-nw-warn" aria-hidden="true" />
        تصحيح تكلفة {productName}
      </h3>
      <p className="mt-1 text-xs text-nw-muted">
        يضبط متوسط التكلفة لكل {unitName} لهذا المنتج فقط. لا يغيّر الكميات ولا تكلفة المبيعات السابقة، ويُسجّل مع السبب في سجل التدقيق.
      </p>
      {state && (
        <p className="mt-2 text-sm" data-testid="product-cost-current">
          متوسط التكلفة الحالي: <bdi dir="ltr" className="font-black">{formatJod(currentUnitCostInMinorUnits(state) / 1000)}</bdi> {CURRENCY} لكل {unitName}
        </p>
      )}
      <FormFields>
        <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={event => void save(event)} aria-busy={busy}>
          {targets.length > 1 && (
            <div className="sm:col-span-2">
              <label htmlFor={ids.target} className="mb-1 block text-xs font-bold text-nw-muted">النكهة</label>
              <select id={ids.target} className={fieldClass} value={productId} onChange={event => setProductId(event.target.value)}>
                {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor={ids.cost} className="mb-1 block text-xs font-bold text-nw-muted">التكلفة الصحيحة لكل {unitName} ({CURRENCY}) *</label>
            <input enterKeyHint="next" id={ids.cost} className={fieldClass} dir="ltr" inputMode="decimal" value={cost} placeholder="0.000"
              onChange={event => setCost(event.target.value)} required />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={ids.reason} className="mb-1 block text-xs font-bold text-nw-muted">سبب التصحيح *</label>
            <textarea id={ids.reason} className={`${fieldClass} h-20 py-2`} maxLength={500} value={reason}
              onChange={event => setReason(event.target.value)} required />
          </div>
          {error && <p role="alert" className="sm:col-span-2 m-0 rounded-xl bg-nw-bad-bg p-2 text-sm text-nw-bad">{error}</p>}
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <UiButton type="submit" variant="accent" disabled={busy || !state}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {busy ? 'جارٍ الحفظ…' : 'حفظ التصحيح'}
            </UiButton>
            <UiButton type="button" onClick={onClose} disabled={busy}>إلغاء</UiButton>
          </div>
        </form>
      </FormFields>
    </section>
  );
};
