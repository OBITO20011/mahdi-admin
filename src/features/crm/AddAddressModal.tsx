import React, { useState } from 'react';
import { Loader2, MapPin, Plus } from 'lucide-react';
import {Modal} from '../../components/common/Modal';
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
    try {
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

      if (!result.success) {
        setError(result.error || 'تعذر إضافة العنوان.');
        return;
      }
      onAddressAdded();
      onClose();

    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="إضافة عنوان توصيل"
      subtitle={customerName} maxWidth="max-w-md" maxHeight="max-h-[94vh]"
      closeDisabled={loading} confirmUnsavedClose>

        <form onSubmit={submit} aria-busy={loading} className="space-y-3 text-xs">
          {error && (
            <div className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-nw-bad">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                المحافظة *
              </label>
              <select
                value={governorate}
                onChange={(event) => setGovernorate(event.target.value)}
                required
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
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
              <label className="mb-1 block font-bold text-nw-text">
                المدينة / البلدة
              </label>
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                المنطقة / الحي *
              </label>
              <input
                value={area}
                onChange={(event) => setArea(event.target.value)}
                required
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                الشارع
              </label>
              <input
                value={street}
                onChange={(event) => setStreet(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
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
                <label className="mb-1 block font-bold text-nw-text">
                  {label as string}
                </label>
                <input
                  value={value as string}
                  onChange={(event) =>
                    (setter as React.Dispatch<React.SetStateAction<string>>)(
                      event.target.value
                    )
                  }
                  className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl border border-nw-border bg-nw-bg p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-nw-text">
                إحداثيات GPS (اختياري)
              </span>
              <button
                type="button"
                onClick={getLocation}
                className="flex items-center gap-1 rounded-lg border border-nw-info/30 bg-nw-info-bg px-2 py-1 text-[10px] font-bold text-nw-info"
              >
                <MapPin className="h-3 w-3" />
                جلب موقعي
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input inputMode="decimal" enterKeyHint="next"
                type="number"
                step="any"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="خط العرض"
                className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-text"
              />
              <input inputMode="decimal" enterKeyHint="next"
                type="number"
                step="any"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="خط الطول"
                className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-text"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold text-nw-text">
              ملاحظات التوصيل
            </label>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full rounded-xl border border-nw-border bg-nw-bg p-2.5 text-nw-text"
            />
          </div>

          <label className="flex items-center gap-2 rounded-xl bg-nw-bg p-3 text-nw-text">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="accent-nw-info"
            />
            اجعل هذا العنوان الافتراضي للعميل
          </label>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-warn-bg py-3 font-bold text-nw-warn disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {loading ? 'جاري الحفظ...' : 'حفظ العنوان'}
          </button>
        </form>
    </Modal>
  );
};
