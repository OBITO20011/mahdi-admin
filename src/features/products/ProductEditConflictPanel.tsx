import React, { useId, useState } from 'react';
import { AlertTriangle, Eye, RotateCcw } from 'lucide-react';
import { StatusBadge, UiButton } from '../../components/ui';
import type { ProductEditComparisonRow } from '../../utils/productEditConflict';

interface ProductEditConflictPanelProps {
  rows: ProductEditComparisonRow[];
  /** Set when the other user changed the product's visibility. */
  statusChange?: { mine: boolean; current: boolean };
  formatValue: (row: ProductEditComparisonRow, value: ProductEditComparisonRow['mine']) => string;
  onReapply: () => void;
}

const visibility = (active: boolean) => (active ? 'ظاهر' : 'مخفي');

/** Shown when the database refuses a save because another user changed the product since it was opened. */
export const ProductEditConflictPanel: React.FC<ProductEditConflictPanelProps> = ({ rows, statusChange, formatValue, onReapply }) => {
  const [showCurrent, setShowCurrent] = useState(false);
  const tableId = useId();
  return (
    <div role="alert" data-testid="product-edit-conflict" className="rounded-2xl border border-nw-border bg-nw-warn-bg p-3 text-nw-text">
      <div className="flex items-center gap-2 font-black text-nw-warn">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        عدّل مستخدم آخر هذا المنتج قبل قليل
      </div>
      <p className="mt-1.5 text-sm">لم يُحفظ تعديلك حتى لا يضيع تعديل الآخر. اعرض القيم الحالية ثم أعد تطبيق تعديلاتك عليها وراجعها قبل الحفظ.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <UiButton type="button" aria-expanded={showCurrent} aria-controls={tableId} onClick={() => setShowCurrent(value => !value)}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          {showCurrent ? 'إخفاء القيم الحالية' : 'عرض القيم الحالية'}
        </UiButton>
        <UiButton type="button" variant="accent" onClick={onReapply}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          إعادة تطبيق تعديلاتي
        </UiButton>
      </div>
      {showCurrent && (
        <div id={tableId} className="mt-3 overflow-x-auto rounded-xl border border-nw-border bg-nw-surface">
          <table className="w-full min-w-[18rem] text-right text-[13px]" data-testid="product-edit-conflict-values">
            <caption className="sr-only">مقارنة قيمك بالقيم الحالية</caption>
            <thead className="bg-nw-surface-2 text-xs text-nw-muted">
              <tr>
                <th scope="col" className="p-2 font-bold">الحقل</th>
                <th scope="col" className="p-2 font-bold">قيمتك</th>
                <th scope="col" className="p-2 font-bold">القيمة الحالية</th>
              </tr>
            </thead>
            <tbody>
              {statusChange && (
                <tr className="border-t border-nw-border">
                  <th scope="row" className="p-2 font-semibold">الحالة <StatusBadge tone="warn">غيّرها مستخدم آخر</StatusBadge></th>
                  <td className="p-2">{visibility(statusChange.mine)}</td>
                  <td className="p-2 font-bold">{visibility(statusChange.current)}</td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.field} className="border-t border-nw-border">
                  <th scope="row" className="p-2 font-semibold">
                    {row.label}{' '}
                    {row.changedByMe && row.changedByOther
                      ? <StatusBadge tone="bad">غيّرتماه كلاكما</StatusBadge>
                      : row.changedByOther
                        ? <StatusBadge tone="warn">غيّره مستخدم آخر</StatusBadge>
                        : <StatusBadge tone="info">غيّرته أنت</StatusBadge>}
                  </th>
                  <td className="p-2"><bdi>{formatValue(row, row.mine)}</bdi></td>
                  <td className="p-2 font-bold"><bdi>{formatValue(row, row.current)}</bdi></td>
                </tr>
              ))}
              {!rows.length && !statusChange && (
                <tr className="border-t border-nw-border"><td colSpan={3} className="p-2 text-nw-muted">تغيّرت بيانات أخرى للمنتج (مثل التكلفة بعد استلام بضاعة). أعد التطبيق ثم احفظ.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
