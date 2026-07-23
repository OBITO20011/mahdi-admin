/**
 * Nawasrah Business Manager - Customer Location & Address Card
 */

import React, { useState } from 'react';
import { Order, CustomerAddress } from '../../types';
import { useAppStore } from '../../stores/useAppStore';
import {
  MapPin,
  Navigation,
  Globe,
  Compass,
  Copy,
  Share2,
  Send,
  Phone,
  MessageSquare,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Map,
  Building,
  Home,
  FileText,
  Smartphone,
  Info,
} from 'lucide-react';

interface CustomerLocationCardProps {
  order: Order;
  onEditAddress?: () => void;
}

export const CustomerLocationCard: React.FC<CustomerLocationCardProps> = ({
  order,
  onEditAddress,
}) => {
  const { setToast, currentUser } = useAppStore();
  const [copied, setCopied] = useState(false);

  // Address fields breakdown
  const addr: CustomerAddress = order.customerAddress || {};
  const governorate = addr.governorate || order.governorate || 'غير محدد';
  const area = addr.area || order.region || 'غير محدد';
  const street = addr.street || 'غير محدد';
  const building = addr.building || 'غير محدد';
  const apartment = addr.apartment || 'غير محدد';
  const landmark = addr.landmark || 'لا توجد علامة مميزة';
  const deliveryNotes = addr.deliveryNotes || order.notes || 'لا توجد ملاحظات خاصة';

  const hasCoords = typeof order.latitude === 'number' && typeof order.longitude === 'number';
  const lat = order.latitude;
  const lng = order.longitude;

  const googleMapsUrl =
    order.googleMapsUrl ||
    (hasCoords ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : '');
  const appleMapsUrl = hasCoords ? `https://maps.apple.com/?q=${lat},${lng}` : '';

  const locationSource = order.locationSource || (hasCoords ? 'gps' : 'manual');
  const isConfirmed = order.locationConfirmed ?? (hasCoords && locationSource !== 'manual');

  // Phone clean for WhatsApp
  const cleanPhone = order.customerPhone ? order.customerPhone.replace(/\D/g, '') : '';
  const formattedPhoneForWa = cleanPhone.startsWith('962')
    ? cleanPhone
    : cleanPhone.startsWith('0')
    ? `962${cleanPhone.slice(1)}`
    : `962${cleanPhone}`;

  // 1. Copy location link
  const handleCopyLink = () => {
    const urlToCopy = googleMapsUrl || order.mapUrl || `${governorate} - ${area} - ${order.address}`;
    navigator.clipboard.writeText(urlToCopy);
    setCopied(true);
    setToast('تم نسخ رابط/عنوان الموقع بنجاح');
    setTimeout(() => setCopied(false), 2000);
  };

  // 2. Share location
  const handleShareLocation = async () => {
    const shareText = `موقع توصيل الطلب ${order.orderNumber}\nالعميل: ${order.customerName} (${order.customerPhone})\nالعنوان: ${governorate} - ${area} - ${order.address}\nالرابط: ${googleMapsUrl || order.mapUrl || 'لا يوجد رابط'}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `موقع طلب ${order.orderNumber}`,
          text: shareText,
          url: googleMapsUrl || order.mapUrl,
        });
      } catch (e) {
        // Fallback to copy
        navigator.clipboard.writeText(shareText);
        setToast('تم نسخ تفاصيل ورابط الموقع للمشاركة');
      }
    } else {
      navigator.clipboard.writeText(shareText);
      setToast('تم نسخ تفاصيل ورابط الموقع للمشاركة');
    }
  };

  // 3. Send location to courier / driver via WhatsApp or share
  const handleSendToCourier = () => {
    const driverPhone = order.deliveryDriverName ? '' : '';
    const message = encodeURIComponent(
      `🚚 *توجيه توصيل طلب #${order.orderNumber}*\n` +
      `👤 العميل: ${order.customerName}\n` +
      `📞 الهاتف: ${order.customerPhone}\n` +
      `📍 العنوان: ${governorate} - ${area} - ${street}\n` +
      `🏢 البناية: ${building} | شقة: ${apartment}\n` +
      `🚩 العلامة: ${landmark}\n` +
      `📝 ملاحظات: ${deliveryNotes}\n` +
      `🔗 رابط الخريطة: ${googleMapsUrl || order.mapUrl || 'غير متوفر (عنوان يدوي)'}`
    );

    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  // 4. Request location from customer via WhatsApp
  const handleRequestLocationFromCustomer = () => {
    const requestMessage = encodeURIComponent(
      `أهلاً بك عزيزي العميل ${order.customerName} 🌸\n` +
      `معك فريق التوصيل في *نواصرة للمحاسبة والإدارة*، بخصوص طلبك رقم *${order.orderNumber}*.\n` +
      `يرجى مشاركة موقعك الدقيق (Pin Location) عبر الواتساب لتأكيد عنوان التوصيل وتسليمه بأسرع وقت.\n` +
      `شكراً لتسوقك معنا!`
    );
    window.open(`https://wa.me/${formattedPhoneForWa}?text=${requestMessage}`, '_blank');
  };

  // Location source badge styling
  const getLocationSourceBadge = () => {
    switch (locationSource) {
      case 'gps':
        return { label: 'GPS مباشر', icon: Navigation, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
      case 'map_pin':
        return { label: 'دبوس الخريطة', icon: MapPin, color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' };
      case 'manual':
      default:
        return { label: 'عنوان يدوي', icon: Edit3, color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    }
  };

  const sourceBadge = getLocationSourceBadge();
  const SourceIcon = sourceBadge.icon;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 space-y-3 text-xs">
      {/* Header: Title & Confirmation Badges */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-extrabold text-slate-100 text-xs">موقع وعنوان التوصيل التفصيلي</h4>
            <p className="text-[10px] text-slate-400">بيانات الإحداثيات وتوجيه السائق للموقع</p>
          </div>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Source Badge */}
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border flex items-center gap-1 ${sourceBadge.color}`}>
            <SourceIcon className="w-2.5 h-2.5" />
            <span>{sourceBadge.label}</span>
          </span>

          {/* Confirmed / Unconfirmed Status Badge */}
          {isConfirmed && hasCoords ? (
            <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full text-[9px] font-extrabold flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
              <span>موقع مؤكد</span>
            </span>
          ) : (
            <span className="bg-rose-950 text-rose-300 border border-rose-800 px-2 py-0.5 rounded-full text-[9px] font-extrabold flex items-center gap-1 animate-pulse">
              <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
              <span>موقع غير مؤكد</span>
            </span>
          )}
        </div>
      </div>

      {/* Mini Map Visual Card */}
      <div className="relative group rounded-2xl overflow-hidden border border-slate-800 bg-slate-900 transition hover:border-blue-500/60">
        {hasCoords ? (
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="block relative h-32 w-full bg-slate-950 flex flex-col justify-between p-3"
            title="انقر لفتح الخريطة في خرائط جوجل"
          >
            {/* Visual Grid Lines simulating a map view */}
            <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent pointer-events-none" />

            {/* Top info overlay */}
            <div className="relative z-10 flex items-center justify-between">
              <span className="bg-slate-900/90 backdrop-blur-md border border-slate-700 text-blue-300 text-[10px] font-mono px-2 py-0.5 rounded-lg flex items-center gap-1 shadow">
                <Globe className="w-3 h-3 text-blue-400" />
                <span>{lat?.toFixed(4)}, {lng?.toFixed(4)}</span>
              </span>

              <span className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                <span>فتح الخريطة</span>
              </span>
            </div>

            {/* Center Location Pin */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-blue-500/30 animate-ping absolute" />
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-lg border-2 border-white">
                  <MapPin className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Bottom Address snippet overlay */}
            <div className="relative z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-1.5 rounded-xl text-[10px] text-slate-200 line-clamp-1">
              📍 {governorate} - {area} - {street}
            </div>
          </a>
        ) : (
          /* No Coordinates Card View */
          <div className="p-4 bg-slate-900/80 border border-amber-900/30 rounded-2xl text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h5 className="font-bold text-amber-300 text-xs">العنوان مكتوب يدوياً (لا توجد إحداثيات GPS)</h5>
              <p className="text-[10px] text-slate-400 max-w-sm mx-auto mt-0.5">
                {governorate} - {area} - {order.address}
              </p>
            </div>
            
            {/* Request Location via WA Button */}
            <button
              onClick={handleRequestLocationFromCustomer}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-md shadow-emerald-600/20 active:scale-95"
            >
              <MessageSquare className="w-4 h-4" />
              <span>طلب الموقع من العميل عبر واتساب</span>
            </button>
          </div>
        )}
      </div>

      {/* Address Details Table / Cards */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">المحافظة:</span>
          <strong className="text-slate-200 font-extrabold">{governorate}</strong>
        </div>

        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">المنطقة / الحي:</span>
          <strong className="text-slate-200 font-extrabold">{area}</strong>
        </div>

        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">الشارع:</span>
          <strong className="text-slate-200 font-extrabold">{street}</strong>
        </div>

        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">البناية / المجمع:</span>
          <strong className="text-slate-200 font-extrabold">{building}</strong>
        </div>

        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">الشقة / الطابق:</span>
          <strong className="text-slate-200 font-extrabold">{apartment}</strong>
        </div>

        <div className="bg-slate-900 p-2.5 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-400 font-bold block">العلامة المميزة:</span>
          <strong className="text-slate-200 font-extrabold">{landmark}</strong>
        </div>

        <div className="col-span-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
          <span className="text-[10px] text-slate-400 font-bold block">ملاحظات التوصيل:</span>
          <p className="text-slate-300 font-semibold text-[11px]">{deliveryNotes}</p>
        </div>

        {hasCoords && (
          <div className="col-span-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-[10px]">
            <span className="text-slate-400 font-bold">الإحداثيات الجغرافية:</span>
            <span className="font-mono text-blue-400 font-bold dir-ltr">
              Lat: {lat}, Lng: {lng}
            </span>
          </div>
        )}
      </div>

      {/* Action Buttons Grid */}
      <div className="pt-2 border-t border-slate-800 space-y-2">
        {/* Row 1: Maps Openers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {/* 1. Google Maps */}
          <a
            href={googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${governorate} ${area} ${order.address}`)}`}
            target="_blank"
            rel="noreferrer"
            className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 shadow"
          >
            <Map className="w-3.5 h-3.5" />
            <span>Google Maps</span>
          </a>

          {/* 2. Apple Maps */}
          <a
            href={appleMapsUrl || `https://maps.apple.com/?q=${encodeURIComponent(`${governorate} ${area} ${order.address}`)}`}
            target="_blank"
            rel="noreferrer"
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Apple Maps</span>
          </a>

          {/* 3. Copy Location Link */}
          <button
            onClick={handleCopyLink}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Copy className="w-3.5 h-3.5 text-indigo-400" />
            <span>{copied ? 'تم النسخ!' : 'نسخ الرابط'}</span>
          </button>

          {/* 4. Share Location */}
          <button
            onClick={handleShareLocation}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Share2 className="w-3.5 h-3.5 text-purple-400" />
            <span>مشاركة</span>
          </button>
        </div>

        {/* Row 2: Courier & Communication */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {/* 5. Send Location to Courier */}
          <button
            onClick={handleSendToCourier}
            className="bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 text-indigo-300 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Send className="w-3.5 h-3.5 text-indigo-400" />
            <span>إرسال للمندوب</span>
          </button>

          {/* 6. Call Customer */}
          <a
            href={`tel:${order.customerPhone}`}
            className="bg-emerald-950 hover:bg-emerald-900 border border-emerald-800 text-emerald-300 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
            <span>اتصال بالعميل</span>
          </a>

          {/* 7. WhatsApp */}
          <a
            href={`https://wa.me/${formattedPhoneForWa}`}
            target="_blank"
            rel="noreferrer"
            className="bg-green-950 hover:bg-green-900 border border-green-800 text-green-300 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <MessageSquare className="w-3.5 h-3.5 text-green-400" />
            <span>واتساب العميل</span>
          </a>

          {/* 8. Edit Address according to permission */}
          <button
            onClick={onEditAddress}
            className="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 p-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1"
          >
            <Edit3 className="w-3.5 h-3.5 text-amber-400" />
            <span>تعديل العنوان</span>
          </button>
        </div>
      </div>
    </div>
  );
};
