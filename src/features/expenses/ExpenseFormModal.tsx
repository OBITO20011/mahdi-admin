import React, { useState } from 'react';
import { AlertTriangle, Banknote, Smartphone } from 'lucide-react';
import {
  useAppStoreActions,
  useAppStoreSelector,
} from '../../stores/useAppStore';

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
      <div className="space-y-4 text-center text-xs">
        <div className="rounded-2xl border border-amber-700/60 bg-amber-950/40 p-5">
          <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-400" />
          <h3 className="font-black text-amber-200">افتح وردية الصندوق أولًا</h3>
          <p className="mt-1 leading-5 text-slate-400">
            كل مصروف يجب أن يرتبط بالوردية المفتوحة حتى تبقى حركة الكاش وCliQ
            قابلة للمراجعة.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClose();
            setActiveTab('shifts');
          }}
          className="w-full rounded-2xl bg-blue-600 py-3 font-black text-white transition hover:bg-blue-500"
        >
          الانتقال إلى الورديات
        </button>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!isValid || isSaving) return;
    setIsSaving(true);
    const success = await addExpense(
      category,
      numericAmount,
      description.trim(),
      paymentMethod,
      referenceNumber
    );
    setIsSaving(false);
    if (success) onClose();
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-emerald-800/70 bg-emerald-950/30 px-3 py-2 text-emerald-300">
        سيرتبط المصروف بالوردية <b>{currentShift.shiftNumber}</b> تلقائيًا.
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">فئة المصروف</label>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
        >
          {EXPENSE_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">المبلغ (د.أ) *</label>
        <input
          type="number"
          min="0.001"
          step="0.001"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.000"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-bold text-amber-400"
        />
      </div>

      <div>
        <label className="mb-1 block font-bold text-slate-300">طريقة الدفع *</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            ['cash', 'كاش', Banknote],
            ['cliq', 'CliQ', Smartphone],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPaymentMethod(value)}
              className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 font-black transition ${
                paymentMethod === value
                  ? 'border-emerald-500 bg-emerald-950/60 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {paymentMethod === 'cliq' && (
        <div>
          <label className="mb-1 block font-bold text-slate-300">
            رقم مرجع CliQ *
          </label>
          <input
            type="text"
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            placeholder="رقم الحركة أو المرجع"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block font-bold text-slate-300">البيان / الوصف *</label>
        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="مثال: فاتورة كهرباء الفرع"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"
        />
      </div>

      <button
        type="button"
        disabled={!isValid || isSaving}
        onClick={() => void handleSubmit()}
        className="w-full rounded-2xl bg-amber-600 py-3 font-black text-white shadow transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSaving ? 'جاري الحفظ في Supabase...' : 'اعتماد وتسجيل المصروف'}
      </button>
    </div>
  );
};
