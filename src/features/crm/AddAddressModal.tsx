import React, { useState } from 'react';
import { Loader2, MapPin, Plus, X } from 'lucide-react';
import { JORDAN_GOVERNORATES } from '../../constants';
import { addCustomerAddressInSupabase } from '../../services/supabase/crm.service';

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
  const [governorate, setGovernorate] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [apartment, setApartment] = useState('');
  const [notes, setNotes] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const getLocation = () => {
    if (!navigator.geolocation) {
      setError('خدمة الموقع غير مدعومة على هذا الجهاز.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setError(null);
      },
      () => setError('تعذر جلب الموقع. يمكنك إدخال الإحداثيات يدويًا.')
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasLat = latitude.trim() !== '';
    const hasLng = longitude.trim() !== '';
    if (hasLat !== hasLng) {
      setError('أدخل خط العرض وخط الطول معًا أو اتركهما فارغين.');
      return;
    }
    const latitudeValue = hasLat ? Number(latitude) : undefined;
    const longitudeValue = hasLng ? Number(longitude) : undefined;
    if (
      (latitudeValue !== undefined &&
        (!Number.isFinite(latitudeValue) ||
          latitudeValue < -90 ||
          latitudeValue > 90)) ||
      (longitudeValue !== undefined &&
        (!Number.isFinite(longitudeValue) ||
          longitudeValue < -180 ||
          longitudeValue > 180))
    ) {
      setError('إحداثيات الموقع غير صحيحة.');
      return;
    }

    setLoading(true);
    setError(null);
    const result = await addCustomerAddressInSupabase(customerId, {
      governorate,
      city: city.trim(),
      area: area.trim(),
      street: street.trim(),
      building: building.trim(),
      floor: floor.trim(),
      apartment: apartment.trim(),
      notes: notes.trim(),
      latitude: latitudeValue,
      longitude: longitudeValue,
      isDefault,
    });
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'تعذر إضافة العنوان.');
      return;
    }
    onAddressAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-900 p-5 sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-black text-white">إضافة عنوان توصيل</h3>
            <p className="text-[10px] text-slate-500">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-800 p-2 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 text-xs">
          {error && (
            <div className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                المحافظة *
              </label>
              <select
                value={governorate}
                onChange={(event) => setGovernorate(event.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              >
                <option value="">اختر المحافظة</option>
                {JORDAN_GOVERNORATES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                المدينة / البلدة
              </label>
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                المنطقة / الحي *
              </label>
              <input
                value={area}
                onChange={(event) => setArea(event.target.value)}
                required
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-300">
                الشارع
              </label>
              <input
                value={street}
                onChange={(event) => setStreet(event.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['المبنى', building, setBuilding],
              ['الطابق', floor, setFloor],
              ['الشقة', apartment, setApartment],
            ].map(([label, value, setter]) => (
              <div key={label as string}>
                <label className="mb-1 block font-bold text-slate-300">
                  {label as string}
                </label>
                <input
                  value={value as string}
                  onChange={(event) =>
                    (setter as React.Dispatch<React.SetStateAction<string>>)(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">
                إحداثيات GPS (اختياري)
              </span>
              <button
                type="button"
                onClick={getLocation}
                className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-bold text-blue-300"
              >
                <MapPin className="h-3 w-3" />
                جلب موقعي
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="any"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="خط العرض"
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-white"
              />
              <input
                type="number"
                step="any"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="خط الطول"
                className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold text-slate-300">
              ملاحظات التوصيل
            </label>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-white"
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl bg-slate-950 p-3 text-slate-300">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="accent-blue-500"
            />
            اجعل هذا العنوان الافتراضي للعميل
          </label>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-600 py-3 font-bold text-white disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {loading ? 'جاري الحفظ...' : 'حفظ العنوان'}
          </button>
        </form>
      </div>
    </div>
  );
};
