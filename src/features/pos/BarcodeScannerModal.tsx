/**
 * Nawasrah Business Manager - POS Camera Barcode Scanner Modal
 * Uses html5-qrcode for instant live camera video scanning
 */

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Product } from '../../types';
import {
  Camera,
  X,
  Zap,
  AlertCircle,
  RefreshCw,
  Volume2,
  VolumeX,
  PackageCheck,
  Sparkles,
} from 'lucide-react';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onProductScanned: (product: Product) => void;
  setToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  products,
  onProductScanned,
  setToast,
}) => {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isContinuous, setIsContinuous] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [scanCount, setScanCount] = useState<number>(0);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanTimeRef = useRef<{ [code: string]: number }>({});
  const regionId = 'pos-camera-barcode-region';

  // Play audio beep tone on successful scan
  const playBeep = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as AudioContextWindow).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6 pitch
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Audio playback fails silently if browser blocks autoplay context
    }
  };

  const handleBarCodeDetected = (decodedText: string) => {
    const code = decodedText.trim();
    if (!code) return;

    const now = Date.now();
    const lastTime = lastScanTimeRef.current[code] || 0;

    // Cooldown of 1.5 seconds per code to prevent duplicate accidental scans
    if (now - lastTime < 1500) {
      return;
    }

    lastScanTimeRef.current[code] = now;

    // Search product by barcode, SKU, or ID
    const matchedProduct = products.find(
      (p) =>
        p.barcode.toLowerCase() === code.toLowerCase() ||
        p.sku.toLowerCase() === code.toLowerCase() ||
        p.id === code
    );

    if (matchedProduct) {
      playBeep();
      setLastScannedCode(code);
      setLastScannedProduct(matchedProduct);
      setScanCount((prev) => prev + 1);
      onProductScanned(matchedProduct);
      setToast(`تم إضافة: ${matchedProduct.nameAr} إلى السلة 🛒`, 'success');

      if (!isContinuous) {
        onClose();
      }
    } else {
      playBeep();
      setLastScannedCode(code);
      setLastScannedProduct(null);
      setToast(`لم يتم العثور على منتج بالباركود: ${code}`, 'error');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    setCameraError(null);

    const startScanner = async () => {
      try {
        const html5Qrcode = new Html5Qrcode(regionId);
        scannerRef.current = html5Qrcode;

        const config = {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.0,
        };

        await html5Qrcode.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            if (isSubscribed) {
              handleBarCodeDetected(decodedText);
            }
          },
          () => {
            // Frame search failure, safe to ignore
          }
        );
      } catch (err: any) {
        console.error('Html5Qrcode camera error:', err);
        if (isSubscribed) {
          setCameraError(
            'تعذر الوصول إلى الكاميرا. يرجى التأكد من منح الصلاحية للكاميرا وإتاحتها في المتصفح.'
          );
        }
      }
    };

    // Small delay to ensure DOM element exists
    const timer = setTimeout(() => {
      startScanner();
    }, 200);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        if (scannerRef.current.isScanning) {
          scannerRef.current
            .stop()
            .then(() => scannerRef.current?.clear())
            .catch((e) => console.error('Error stopping scanner:', e));
        } else {
          try {
            scannerRef.current.clear();
          } catch {
            // clear error ignore
          }
        }
      }
    };
    // The scanner must retain its camera session while callback props change.
    // Restarting it on every product/state update interrupts active scans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 dir-rtl">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shadow-inner">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                <span>قارئ الباركود الذكي</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </h3>
              <p className="text-[10px] text-slate-400">وجه الكاميرا نحو رمز الباركود للمسح السريع</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition border border-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Viewport Area */}
        <div className="relative bg-black flex-1 min-h-[260px] max-h-[360px] flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="p-6 text-center space-y-3 max-w-xs">
              <AlertCircle className="w-10 h-10 text-rose-400 mx-auto" />
              <p className="text-xs text-rose-200 leading-relaxed font-medium">{cameraError}</p>
              <button
                onClick={() => {
                  setCameraError(null);
                  window.location.reload();
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 mx-auto transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          ) : (
            <>
              {/* HTML5 QR Container */}
              <div id={regionId} className="w-full h-full object-cover" />

              {/* Scanning Laser HUD Overlay */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                <div className="w-64 h-36 border-2 border-dashed border-emerald-400/70 rounded-2xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                  {/* Corner accents */}
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl-md" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr-md" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl-md" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br-md" />

                  {/* Animated Scanning Laser Line */}
                  <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#10b981] animate-pulse top-1/2 -translate-y-1/2" />
                </div>
                <p className="text-[10px] text-emerald-300 font-bold bg-slate-950/80 px-3 py-1 rounded-full border border-emerald-500/30 mt-3 shadow">
                  ضع الباركود داخل الإطار المحدد
                </p>
              </div>
            </>
          )}
        </div>

        {/* Feedback Bar on Scanned Result */}
        {lastScannedCode && (
          <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3 text-xs">
            {lastScannedProduct ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                  <PackageCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-white truncate">{lastScannedProduct.nameAr}</div>
                  <div className="text-[10px] text-emerald-400 font-bold">
                    تمت الإضافة! السعر: {lastScannedProduct.retailPrice.toFixed(2)} د.أ
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-rose-300 font-bold min-w-0">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">الرمز غير معروف ({lastScannedCode})</span>
              </div>
            )}

            {scanCount > 0 && (
              <span className="bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-black px-2.5 py-1 rounded-xl text-[10px] shrink-0">
                إجمالي الممسوح: {scanCount}
              </span>
            )}
          </div>
        )}

        {/* Footer Settings & Controls */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-3 shrink-0">
          <div className="flex items-center justify-between text-xs">
            {/* Continuous Toggle */}
            <button
              onClick={() => setIsContinuous(!isContinuous)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                isContinuous
                  ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{isContinuous ? 'مسح مستمر (مفعل)' : 'مسح مرة واحدة'}</span>
            </button>

            {/* Audio Toggle */}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-xl border transition ${
                soundEnabled
                  ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-500 border-slate-700'
              }`}
              title={soundEnabled ? 'صوت التنبيه مفعل' : 'صوت التنبيه مكتوم'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-2xl text-xs transition border border-slate-700"
          >
            إغلاق الكاميرا والعودة للسلة
          </button>
        </div>
      </div>
    </div>
  );
};
