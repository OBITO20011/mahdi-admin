import { UiButton } from '../../components/ui';
import React, { useRef, useState } from 'react';
import {useDialogFocus} from '../../hooks/useDialogFocus';
import {
  CheckCircle2,
  Compass,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { JORDAN_GOVERNORATES } from '../../constants';
import { updateOrderDeliveryAddressInSupabase } from '../../services/supabase/orders.service';
import { useAppStoreActions } from '../../stores/useAppStore';
import { Order } from '../../types';

interface EditAddressModalProps {
  order: Order;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export const EditAddressModal: React.FC<EditAddressModalProps> = ({
  order,
  onClose,
  onSaved,
}) => {
  const { setToast } = useAppStoreActions();
  const address = order.customerAddress || {};
  const [governorate, setGovernorate] = useState(
    address.governorate || order.governorate || ''
  );
  const [city, setCity] = useState(address.landmark || '');
  const [area, setArea] = useState(address.area || order.region || '');
  const [street, setStreet] = useState(address.street || '');
  const [building, setBuilding] = useState(address.building || '');
  const [floor, setFloor] = useState('');
  const [apartment, setApartment] = useState(address.apartment || '');
  const [notes, setNotes] = useState(address.deliveryNotes || '');
  const [latitude, setLatitude] = useState(
    typeof order.latitude === 'number' ? String(order.latitude) : ''
  );
  const [longitude, setLongitude] = useState(
    typeof order.longitude === 'number' ? String(order.longitude) : ''
  );
  const [locationSource, setLocationSource] = useState<
    'gps' | 'map_pin' | 'manual'
  >(order.locationSource || 'manual');
  const [locationConfirmed, setLocationConfirmed] = useState(
    Boolean(order.locationConfirmed)
  );
  const [saving, setSaving] = useState(false);
  const edited = useRef(false);
  const panel = useDialogFocus(true, () => { if (!saving && !edited.current) onClose(); });
  const [error, setError] = useState<string | null>(null);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('خدمة الموقع غير مدعومة على هذا الجهاز.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        edited.current = true;
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocationSource('gps');
        setLocationConfirmed(true);
        setError(null);
      },
      () => setError('تعذر جلب الموقع. يمكنك إدخال الإحداثيات يدويًا.')
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasLatitude = latitude.trim() !== '';
    const hasLongitude = longitude.trim() !== '';
    if (hasLatitude !== hasLongitude) {
      setError('أدخل خط العرض وخط الطول معًا أو اتركهما فارغين.');
      return;
    }

    const latitudeValue = hasLatitude ? Number(latitude) : undefined;
    const longitudeValue = hasLongitude ? Number(longitude) : undefined;
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

    setSaving(true);
    setError(null);
    const result = await updateOrderDeliveryAddressInSupabase(order.id, {
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
      locationSource:
        latitudeValue === undefined ? 'manual' : locationSource,
      locationConfirmed:
        latitudeValue !== undefined && locationConfirmed,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error || 'تعذر حفظ العنوان.');
      return;
    }
    setToast(result.message || 'تم تحديث عنوان التوصيل.', 'success');
    await onSaved?.();
    onClose();
  };

  return (
    <div ref={panel as React.RefObject<HTMLDivElement>} onInputCapture={() => { edited.current = true; }}
      onChangeCapture={() => { edited.current = true; }} tabIndex={-1} role="dialog" aria-modal="true" aria-label="تعديل عنوان التوصيل" aria-busy={saving} className="fixed inset-0 z-[60] flex items-end justify-center bg-nw-surface-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-nw-border bg-nw-surface p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between border-b border-nw-border pb-3">
          <div>
            <h3 className="text-sm font-black text-nw-text">
              تعديل عنوان التوصيل
            </h3>
            <p className="text-[10px] text-nw-muted">
              الطلب {order.orderNumber} — يُحفظ مباشرة في Supabase
            </p>
          </div>
          <UiButton
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-full bg-nw-surface-2 p-2 text-nw-muted"
          >
            <X className="h-4 w-4" />
          </UiButton>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {error && (
            <div className="rounded-xl border border-nw-bad bg-nw-bad-bg p-3 text-nw-text">
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
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
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
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
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
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                الشارع
              </label>
              <input
                value={street}
                onChange={(event) => setStreet(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                المبنى
              </label>
              <input
                value={building}
                onChange={(event) => setBuilding(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                الطابق
              </label>
              <input
                value={floor}
                onChange={(event) => setFloor(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-nw-text">
                الشقة
              </label>
              <input
                value={apartment}
                onChange={(event) => setApartment(event.target.value)}
                className="w-full rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
              />
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-nw-border bg-nw-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-bold text-nw-text">
                <Compass className="h-3.5 w-3.5 text-nw-info" />
                إحداثيات الموقع (اختياري)
              </span>
              <UiButton variant="primary"
                type="button"
                onClick={getCurrentLocation}
                className="flex items-center gap-1 rounded-lg border border-nw-info bg-nw-primary px-2 py-1 text-[10px] font-bold text-nw-on-primary"
              >
                <MapPin className="h-3 w-3" />
                جلب GPS
              </UiButton>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step="any"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                placeholder="خط العرض"
                className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-text"
              />
              <input
                type="number"
                step="any"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                placeholder="خط الطول"
                className="rounded-xl border border-nw-border bg-nw-surface p-2 text-nw-text"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={locationSource}
              onChange={(event) =>
                setLocationSource(
                  event.target.value as 'gps' | 'map_pin' | 'manual'
                )
              }
              disabled={!latitude || !longitude}
              className="rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text disabled:opacity-50"
            >
              <option value="manual">عنوان يدوي</option>
              <option value="gps">GPS مباشر</option>
              <option value="map_pin">دبوس خريطة</option>
            </select>
            <UiButton
              type="button"
              disabled={!latitude || !longitude}
              onClick={() => setLocationConfirmed((value) => !value)}
              variant="primary"
              className={`rounded-xl border p-2.5 font-bold disabled:opacity-50 ${
                locationConfirmed
                  ? 'border-nw-ok bg-nw-primary text-nw-on-primary'
                  : 'border-nw-warn bg-nw-primary text-nw-on-primary'
              }`}
            >
              {locationConfirmed ? 'الموقع مؤكد' : 'الموقع غير مؤكد'}
            </UiButton>
          </div>

          <div>
            <label className="mb-1 block font-bold text-nw-text">
              ملاحظات التوصيل
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full resize-none rounded-xl border border-nw-border bg-nw-surface-2 p-2.5 text-nw-text"
            />
          </div>

          <UiButton variant="primary"
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-nw-primary py-3 font-bold text-nw-on-primary disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {saving ? 'جاري الحفظ...' : 'حفظ العنوان في قاعدة البيانات'}
          </UiButton>
        </form>
      </div>
    </div>
  );
};
