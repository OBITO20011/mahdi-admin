/**
 * Nawasrah Business Manager - Units Management Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Plus, Edit, Trash2, Check, Scale } from 'lucide-react';

export const UnitsModal: React.FC<{ onClose: () => void }> = () => {
  const { units, addUnit, updateUnit, deleteUnit } = useAppStore();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [nameAr, setNameAr] = useState('');
  const [code, setCode] = useState('');
  const [conversionFactor, setConversionFactor] = useState(1);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) return;
    addUnit({ nameAr, code: code || nameAr, conversionFactor });
    setNameAr('');
    setCode('');
    setConversionFactor(1);
    setIsAdding(false);
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 font-bold">وحدات القياس والتعبئة ({units.length})</span>
        {!isAdding && (
          <button
            onClick={() => {
              setNameAr('');
              setCode('');
              setConversionFactor(1);
              setIsAdding(true);
            }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة وحدة</span>
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="bg-slate-950 p-3 rounded-2xl border border-blue-500/40 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              required
              placeholder="اسم الوحدة *"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none"
            />
            <input
              type="text"
              placeholder="الكود (PCS, CTN)..."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none uppercase"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-slate-400 block">معامل التحويل (كم قطعة في هذه الوحدة):</label>
            <input
              type="number"
              min="1"
              value={conversionFactor}
              onChange={(e) => setConversionFactor(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 font-bold focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-1.5 rounded-xl font-bold flex items-center justify-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>حفظ الوحدة</span>
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 bg-slate-800 text-slate-300 py-1.5 rounded-xl font-bold"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* Units List */}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {(units || []).map((u) => (
          <div
            key={u.id}
            className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <h5 className="font-bold text-slate-200">{u.nameAr} ({u.code})</h5>
                <span className="text-[10px] text-slate-500">
                  معامل التعبئة: {u.conversionFactor} قطعة
                </span>
              </div>
            </div>

            {!u.isSystem && (
              <button onClick={() => deleteUnit(u.id)} className="p-1.5 text-slate-400 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
