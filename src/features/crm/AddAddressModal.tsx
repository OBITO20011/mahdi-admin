/**
 * Nawasrah Business Manager - Add Customer Address Modal
 * Allows adding new full address with Governorate, City, Area, Street, Lat/Lng & Google Maps.
 */

import React, { useState } from 'react';
import { addCustomerAddressInSupabase } from '../../services/supabase/crm.service';
import { MapPin, X, Plus, Navigation } from 'lucide-react';

interface AddAddressModalProps {
  customerId: string;
  customerName: string;
  isOpen: boolean;
  onClose: () => void;
  onAddressAdded: () => void;
}

export const AddAddressModal: React.FC<AddAddressModalProps> = ({
  customerId,
  customerName,
  isOpen,
  onClose,
  onAddressAdded,
}) => {
  const [governorate, setGovernorate] = useState<string>('عمان');
  const [city, setCity] = useState<string>('عمان');
  const [area, setArea] = useState<string>('');
  const [street, setStreet] = useState<string>('');
  const [building, setBuilding] = useState<string>('');
  const [floor, setFloor] = useState<string>('');
  const [apartment, setApartment] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [latitude, setLatitude] = useState<number>(31.9539);
  const [longitude, setLongitude] = useState<number>(35.9106);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGetCurrentGps = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(Number(pos.coords.latitude.toFixed(6)));
          setLongitude(Number(pos.coords.longitude.toFixed(6)));
        },
        (err) => {
          console.warn('Geolocation error:', err);
        }
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!area.trim() || !street.trim()) {
      setError('يرجى تعبئة المنطقة والشارع على الأقل.');
      return;
    }

    setLoading(true);
    setError(null);

    const res = await addCustomerAddressInSupabase(customerId, {
      governorate,
      city: city || governorate,
      area: area.trim(),
      street: street.trim(),
      building: building.trim(),
      floor: floor.trim(),
      apartment: apartment.trim(),
      notes: notes.trim(),
      latitude,
      longitude,
    });

    setLoading(false);

    if (res.success) {
      onAddressAdded();
      onClose();
    } else {
      setError(res.error || 'تعذر إضافة العنوان الجديد.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-5 space-y-4 shadow-2xl relative my-auto text-xs">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-600/20 text-rose-400 flex items-center justify-center border border-rose-500/30">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-100 text-sm">إضافة عنوان جديد للعميل</h3>
              <p className="text-[10px] text-slate-400">{customerName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-800 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/80 border border-rose-800 p-2.5 rounded-xl text-rose-300 text-[11px]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-slate-300 font-bold block mb-1">المحافظة *</label>
              <select
                value={governorate}
                onChange={(e) => {
                  setGovernorate(e.target.value);
                  setCity(e.target.value);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100 focus:border-blue-500"
              >
                <option value="عمان">عمان</option>
                <option value="الزرقاء">الزرقاء</option>
                <option value="إربد">إربد</option>
                <option value="العقبة">العقبة</option>
                <option value="السلط">السلط</option>
                <option value="مأدبا">مأدبا</option>
                <option value="الكرك">الكرك</option>
                <option value="جرش">جرش</option>
                <option value="عجلون">عجلون</option>
                <option value="المفرق">المفرق</option>
                <option value="معان">معان</option>
                <option value="الطفيلة">الطفيلة</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 font-bold block mb-1">المدينة / البلدة</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="مثال: عمان الغربية"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">المنطقة / الحي *</label>
            <input
              type="text"
              required
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="مثال: دابوق / الجبيهة"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
            />
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">اسم الشارع *</label>
            <input
              type="text"
              required
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="مثال: شارع المدينة المنورة"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-slate-300 font-bold block mb-1">رقم المبنى</label>
              <input
                type="text"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="12"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
              />
            </div>
            <div>
              <label className="text-slate-300 font-bold block mb-1">الطابق</label>
              <input
                type="text"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="3"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
              />
            </div>
            <div>
              <label className="text-slate-300 font-bold block mb-1">الشقة</label>
              <input
                type="text"
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                placeholder="302"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
              />
            </div>
          </div>

          {/* Coordinates GPS / Maps section */}
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                <Navigation className="w-3 h-3 text-blue-400" />
                <span>إحداثيات الموقع (GPS)</span>
              </span>
              <button
                type="button"
                onClick={handleGetCurrentGps}
                className="text-[10px] bg-blue-950 border border-blue-800 text-blue-300 px-2 py-0.5 rounded-lg font-bold hover:bg-blue-900"
              >
                جلب موقعي الحالي
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <label className="text-slate-400 block mb-0.5">خط العرض Latitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={latitude}
                  onChange={(e) => setLatitude(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-0.5">خط الطول Longitude</label>
                <input
                  type="number"
                  step="0.000001"
                  value={longitude}
                  onChange={(e) => setLongitude(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-bold block mb-1">ملاحظات التوصيل المعلم البارز</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="بجانب مجمع الشوملي، المقابيل من الصيدلية"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-100"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 text-slate-300 px-4 py-2.5 rounded-xl font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-5 py-2.5 rounded-xl transition shadow flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{loading ? 'جاري الحفظ...' : 'حفظ العنوان'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
