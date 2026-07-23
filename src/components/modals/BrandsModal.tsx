/**
 * Nawasrah Business Manager - Brands Management Modal
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Plus, Edit, Trash2, Check, Tag } from 'lucide-react';

export const BrandsModal: React.FC<{ onClose: () => void }> = () => {
  const { brands, addBrand, updateBrand, deleteBrand } = useAppStore();

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) return;
    addBrand({ nameAr, logoUrl });
    setNameAr('');
    setLogoUrl('');
    setIsAdding(false);
  };

  const handleUpdate = (id: string) => {
    if (!nameAr.trim()) return;
    updateBrand(id, { nameAr, logoUrl });
    setEditingId(null);
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 font-bold">العلامات التجارية ({brands.length})</span>
        {!isAdding && (
          <button
            onClick={() => {
              setNameAr('');
              setLogoUrl('');
              setIsAdding(true);
            }}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-xl font-bold flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>إضافة علامة</span>
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="bg-slate-950 p-3 rounded-2xl border border-blue-500/40 space-y-2">
          <input
            type="text"
            required
            placeholder="اسم العلامة التجارية بالعربية *"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none"
          />
          <input
            type="text"
            placeholder="رابط اللوغو (Logo URL)..."
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-1.5 rounded-xl font-bold flex items-center justify-center gap-1"
            >
              <Check className="w-3.5 h-3.5" />
              <span>حفظ العلامة</span>
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

      {/* Brands List */}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {(brands || []).map((b) => (
          <div
            key={b.id}
            className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between"
          >
            {editingId === b.id ? (
              <div className="flex-1 flex gap-2 items-center">
                <input
                  type="text"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 flex-1"
                />
                <button onClick={() => handleUpdate(b.id)} className="bg-emerald-600 text-white p-1.5 rounded-lg">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setEditingId(null)} className="bg-slate-800 text-slate-300 p-1.5 rounded-lg">
                  إلغاء
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold overflow-hidden border border-slate-800">
                    {b.logoUrl ? <img src={b.logoUrl} alt="" className="w-full h-full object-cover" /> : <Tag className="w-4 h-4" />}
                  </div>
                  <h5 className="font-bold text-slate-200">{b.nameAr}</h5>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(b.id);
                      setNameAr(b.nameAr);
                      setLogoUrl(b.logoUrl || '');
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-400"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>

                  <button onClick={() => deleteBrand(b.id)} className="p-1.5 text-slate-400 hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
