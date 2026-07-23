/**
 * Nawasrah Business Manager - Edit Order Address Modal
 */

import React, { useState } from 'react';
import { Order, CustomerAddress } from '../../types';
import { useAppStore } from '../../stores/useAppStore';
import { JORDAN_GOVERNORATES } from '../../constants';
import { MapPin, CheckCircle, X, Compass, Edit3 } from 'lucide-react';

interface EditAddressModalProps {
  order: Order;
  onClose: () => void;
}

export const EditAddressModal: React.FC<EditAddressModalProps> = ({ order, onClose }) => {
  const { updateOrder, setToast } = useAppStore();

  const addr: CustomerAddress = order.customerAddress || {};

  const [governorate, setGovernorate] = useState(addr.governorate || order.governorate || 'عمان');
  const [area, setArea] = useState(addr.area || order.region || '');
  const [street, setStreet] = useState(addr.street || '');
  const [building, setBuilding] = useState(addr.building || '');
  const [apartment, setApartment] = useState(addr.apartment || '');
  const [landmark, setLandmark] = useState(addr.landmark || '');
  const [deliveryNotes, setDeliveryNotes] = useState(addr.deliveryNotes || order.notes || '');

  const [latitude, setLatitude] = useState<string>(
    typeof order.latitude === 'number' ? String(order.latitude) : ''
  );
  const [longitude, setLongitude] = useState<string>(
    typeof order.longitude === 'number' ? String(order.longitude) : ''
  );

  const [locationSource, setLocationSource] = useState<'gps' | 'map_pin' | 'manual'>(
    order.locationSource || 'manual'
  );
  const [locationConfirmed, setLocationConfirmed] = useState<boolean>(
    order.locationConfirmed ?? false
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const latNum = latitude.trim() !== '' ? parseFloat(latitude) : undefined;
    const lngNum = longitude.trim() !== '' ? parseFloat(longitude) : undefined;

    const updatedCustomerAddress: CustomerAddress = {
      governorate,
      area,
      street,
      building,
      apartment,
      landmark,
      deliveryNotes,
    };

    const fullFormatted = [
      governorate,
      area,
      street ? `شارع ${street}` : '',
      building ? `بناية ${building}` : '',
      apartment ? `شقة ${apartment}` : '',
    ]
      .filter(Boolean)
      .join('، ');

    const googleUrl =
      latNum !== undefined && lngNum !== undefined
        ? `https://www.google.com/maps/search/?api=1&query=${latNum},${lngNum}`
        : order.googleMapsUrl;

    updateOrder(order.id, {
      governorate,
      region: area,
      address: fullFormatted || order.address,
      customerAddress: updatedCustomerAddress,
      latitude: latNum,
      longitude: lngNum,
      formattedAddress: fullFormatted,
      googleMapsUrl: googleUrl,
      mapUrl: googleUrl || order.mapUrl,
      locationSource,
      locationConfirmed,
    });

    setToast('تم تحديث بيانات العنوان والموقع بنجاح');
    onClose();
  };

  const handleFetchCurrentGps = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(pos.coords.latitude.toFixed(6));
          setLongitude(pos.coords.longitude.toFixed(6));
          setLocationSource('gps');
          setLocationConfirmed(true);
          setToast('تم الحصول على إحداثيات موقعك الحالي بنجاح');
        },
        (err) => {
          setToast('تعذر جلب موقع GPS. يرجى إدخال الإحداثيات يدوياً', 'error');
        }
      );
    } else {
      setToast('خدمة الموقع الجغرافي غير مدعومة في المتصفح', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 space-y-4 my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">تعديل بيانات موقع وعنوان العميل</h3>
              <p className="text-[10px] text-slate-400">الطلب: {order.orderNumber} - العميل: {order.customerName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center hover:bg-slate-700 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="space-y-3 text-xs">
          {/* Row 1: Governorate & Area */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">المحافظة *</label>
              <select
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                required
              >
                {JORDAN_GOVERNORATES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">المنطقة / الحي *</label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="مثال: خلدا، الشميساني، حي الجامعة"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
                required
              />
            </div>
          </div>

          {/* Row 2: Street & Building */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">الشارع</label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="اسم الشارع"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">البناية / المجمع</label>
              <input
                type="text"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="اسم/رقم البناية"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Row 3: Apartment & Landmark */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">الشقة / الطابق</label>
              <input
                type="text"
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                placeholder="مثال: طابق 3، شقة 302"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">العلامة المميزة</label>
              <input
                type="text"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder="مثال: خلف صيدلية فارمسي وان"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Row 4: Coordinates (Latitude / Longitude) */}
          <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-blue-400" />
                <span>إحداثيات GPS (اختياري)</span>
              </span>
              <button
                type="button"
                onClick={handleFetchCurrentGps}
                className="bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-blue-500/30 transition flex items-center gap-1"
              >
                <MapPin className="w-3 h-3" />
                <span>جلب الموقع الحالي (GPS)</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">خط العرض (Latitude)</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="31.9833"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200 font-mono text-xs dir-ltr focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">خط الطول (Longitude)</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="35.8500"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-200 font-mono text-xs dir-ltr focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Row 5: Location Source & Confirmation Toggle */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">مصدر الموقع</label>
              <select
                value={locationSource}
                onChange={(e) => setLocationSource(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="gps">GPS مباشر</option>
                <option value="map_pin">دبوس خريطة (Pin)</option>
                <option value="manual">عنوان يدوي</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">حالة التأكيد</label>
              <button
                type="button"
                onClick={() => setLocationConfirmed(!locationConfirmed)}
                className={`w-full py-2 px-3 rounded-xl font-bold text-xs border transition flex items-center justify-center gap-1.5 ${
                  locationConfirmed
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-600/20 border-rose-500/40 text-rose-300'
                }`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>{locationConfirmed ? 'موقع مؤكد ✓' : 'غير مؤكد ⚠️'}</span>
              </button>
            </div>
          </div>

          {/* Delivery Notes */}
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">ملاحظات التوصيل للسائق</label>
            <textarea
              rows={2}
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="أي ملاحظات خاصة بالتوصيل (المصعد، أوقات التسليم، إلخ)"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2 border-t border-slate-800">
            <button
              type="submit"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-1 shadow"
            >
              <CheckCircle className="w-4 h-4" />
              <span>حفظ التعديلات</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 rounded-xl transition"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
