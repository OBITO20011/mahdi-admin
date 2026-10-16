import React, { useState } from 'react';
import { AlertTriangle, Banknote, Smartphone } from 'lucide-react';
import {
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';
import {FormFields, UiButton} from '../../components/ui';
import { useDrawerShortfallConfirm } from '../../hooks/useDrawerShortfallConfirm';

interface ExpenseFormModalProps {
  onClose: () => void;
}

const EXPENSE_CATEGORIES = [
  'إيجار',
  'كهرباء وماء',
  'رواتب ومكافآت',
  'تسويق وإعلانات',
  'صيانة',
  'نقل ومحروقات',
  'مصروفات أخرى',
];

export const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({
  onClose,
}) => {
  const currentShift = useAppStoreSelector((state) => state.currentShift);
  const drawer = useDrawerShortfallConfirm();
  const { addExpense, setActiveTab } = useAppStoreActions();
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'cliq'>('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const numericAmount = Number(amount);
  const isValid =
    Boolean(currentShift) &&
    Number.isFinite(numericAmount) &&
    numericAmount > 0 &&
    description.trim().length >= 2 &&
    (paymentMethod !== 'cliq' || referenceNumber.trim().length > 0);

  if (!currentShift) {
    return (
      <FormFields className="space-y-4 text-center text-xs nw-batch4-fields">
        <div className="rounded-2xl border border-nw-border bg-nw-warn-bg p-5">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-nw-warn" />
          <h3 className="font-black text-nw-warn">افتح وردية الصندوق أولًا</h3>
          <p className="mt-1 leading-5 text-nw-muted">
            كل مصروف يجب أن يرتبط بالوردية المفتوحة حتى تبقى حركة الكاش وCliQ
            قابلة للمراجعة.
          </p>
        </div>
        <UiButton variant="primary"
          type="button"
          onClick={() => {
            onClose();
            setActiveTab('shifts');
          }}
          className="w-full text-xs"
        >
          الانتقال إلى الورديات
        </UiButton>
      </FormFields>
    );
  }

  const handleSubmit = async () => {
    if (!isValid || isSaving) return;
    if (!drawer.confirmCash(numericAmount, paymentMethod === 'cash', currentShift.branchId)) return;
    setIsSaving(true);
    try {
      const success = await addExpense(
        category,
        numericAmount,
        description.trim(),
        paymentMethod,
        referenceNumber
      );

      if (success) onClose();

    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormFields aria-busy={isSaving} className="nw-batch4-fields space-y-4 text-sm text-nw-text">
      <div className="rounded-xl border border-nw-border bg-nw-ok-bg px-3 py-2 text-nw-ok">
        سيرتبط المصروف بالوردية <b>{currentShift.shiftNumber}</b> تلقائيًا.
      </div>

      <div>
        <label htmlFor="expense-category" className="mb-1 block font-bold text-nw-muted">فئة المصروف</label>
        <select
          id="expense-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
        >
          {EXPENSE_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-amount" className="mb-1 block font-bold text-nw-muted">المبلغ (د.أ) *</label>
        <input
          id="expense-amount"
          type="number"
          min="0.001"
          step="0.001"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.000"
          className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 font-bold text-nw-warn"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-nw-muted">طريقة الدفع *</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['cash', 'كاش', Banknote],
            ['cliq', 'CliQ', Smartphone],
          ] as const).map(([value, label, Icon]) => (
            <UiButton variant="plain"
              aria-pressed={paymentMethod === value}
              key={value}
              type="button"
              onClick={() => setPaymentMethod(value)}
              className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 font-black transition ${
                paymentMethod === value
                  ? 'border-nw-border bg-nw-ok-bg text-nw-ok'
                  : 'border-nw-border bg-nw-surface-2 text-nw-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </UiButton>
          ))}
        </div>
      </div>

      {paymentMethod === 'cliq' && (
        <div>
          <label htmlFor="expense-reference" className="mb-1 block font-bold text-nw-muted">
            رقم مرجع CliQ *
          </label>
          <input
            id="expense-reference"
            type="text"
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            placeholder="رقم الحركة أو المرجع"
            className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
          />
        </div>
      )}

      <div>
        <label htmlFor="expense-description" className="mb-1 block font-bold text-nw-muted">البيان / الوصف *</label>
        <input
          id="expense-description"
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="مثال: فاتورة كهرباء الفرع"
          className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
        />
      </div>

      {drawer.warningNode}
      <UiButton variant="accent"
        type="button"
        disabled={!isValid || isSaving}
        onClick={() => void handleSubmit()}
        className="sticky bottom-0 z-10 w-full text-sm shadow-lg"
      >
        {isSaving ? 'جاري تسجيل المصروف...' : 'اعتماد وتسجيل المصروف'}
      </UiButton>
    </FormFields>
  );
};
