/**
 * Nawasrah Business Manager - POS Camera Barcode Scanner Modal
 * Uses html5-qrcode for instant live camera video scanning
 */

import React, { useEffect, useRef, useState } from 'react';
import { Product } from '../../types';
import {
  resolvePosProductCode,
  type PosProductLookupResult,
} from '../../utils/productIdentifiers';
import {
  startBarcodeCamera,
  type BarcodeCameraController,
} from '../barcode/barcodeCamera';
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
  products?: Product[];
  resolveProductCode?: (code: string) => Promise<PosProductLookupResult>;
  onProductScanned: (product: Product) => void;
  setToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

type AudioContextWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  products = [],
  resolveProductCode,
  onProductScanned,
  setToast,
}) => {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isContinuous, setIsContinuous] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [scanCount, setScanCount] = useState<number>(0);

  const scannerRef = useRef<BarcodeCameraController | null>(null);
  const lastScanTimeRef = useRef<{ [code: string]: number }>({});
  const lookupRef = useRef({ products, resolveProductCode });
  lookupRef.current = { products, resolveProductCode };
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

  const handleBarCodeDetected = async (decodedText: string) => {
    const code = decodedText.trim();
    if (!code) return;

    const now = Date.now();
    const lastTime = lastScanTimeRef.current[code] || 0;

    // Cooldown of 1.5 seconds per code to prevent duplicate accidental scans
    if (now - lastTime < 1500) {
      return;
    }

    lastScanTimeRef.current[code] = now;

    let lookup: PosProductLookupResult;
    try {
      lookup = lookupRef.current.resolveProductCode
        ? await lookupRef.current.resolveProductCode(code)
        : resolvePosProductCode(lookupRef.current.products, code);
    } catch (error) {
      console.error('Unable to resolve scanned product code:', error);
      setToast('تعذر التحقق من الباركود. حاول مجددًا أو استخدم البحث اليدوي.', 'error');
      return;
    }

    if (lookup.status === 'found') {
      const matchedProduct = lookup.product;
      playBeep();
      setLastScannedCode(code);
      setLastScannedProduct(matchedProduct);
      setScanCount((prev) => prev + 1);
      onProductScanned(matchedProduct);
      setToast(`تم إضافة: ${matchedProduct.nameAr} إلى السلة 🛒`, 'success');

      if (!isContinuous) {
        onClose();
      }
      return;
    }

    playBeep();
    setLastScannedCode(code);
    setLastScannedProduct(null);
    if (lookup.status === 'ambiguous') {
      setToast('هذا الرمز يطابق أكثر من منتج؛ راجع رمز الصنف والباركود.', 'error');
    } else if (lookup.status === 'not_sellable') {
      setToast('المنتج غير متاح للبيع من نقطة البيع.', 'error');
    } else {
      setToast(`لم يتم العثور على منتج بالرمز: ${code}`, 'error');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    let isSubscribed = true;
    setCameraError(null);

    const startScanner = async () => {
      try {
        const controller = await startBarcodeCamera({
          elementId: regionId,
          onDecoded: (decodedText) => {
            if (isSubscribed) {
              void handleBarCodeDetected(decodedText);
            }
          },
        });
        if (!isSubscribed) {
          await controller.stop();
          return;
        }
        scannerRef.current = controller;
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
        scannerRef.current
          .stop()
          .catch((e) => console.error('Error stopping scanner:', e));
        scannerRef.current = null;
      }
    };
    // The scanner must retain its camera session while callback props change.
    // Restarting it on every product/state update interrupts active scans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-nw-side/80 backdrop-blur-md p-3 sm:p-4 dir-rtl">
      <div className="w-full max-w-md bg-nw-surface border border-nw-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-nw-surface border-b border-nw-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-nw-ok-bg border border-nw-ok/40 text-nw-ok flex items-center justify-center shadow-inner">
              <Camera className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-black text-nw-text flex items-center gap-1.5">
                <span>قارئ الباركود الذكي</span>
                <Sparkles className="w-3.5 h-3.5 text-nw-warn" />
              </h3>
              <p className="text-[10px] text-nw-muted">وجه الكاميرا نحو رمز الباركود للمسح السريع</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-nw-surface-2 text-nw-muted hover:text-nw-text flex items-center justify-center transition border border-nw-border"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Viewport Area */}
        <div className="relative bg-black flex-1 min-h-[260px] max-h-[360px] flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="p-6 text-center space-y-3 max-w-xs rounded-2xl bg-nw-bad-bg">
              <AlertCircle className="w-10 h-10 text-nw-bad mx-auto" />
              <p className="text-xs text-nw-bad leading-relaxed font-medium">{cameraError}</p>
              <button
                onClick={() => {
                  setCameraError(null);
                  window.location.reload();
                }}
                className="bg-nw-surface-2 hover:bg-nw-track text-nw-text border border-nw-border text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 mx-auto transition"
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
                <div className="w-64 h-36 border-2 border-dashed border-nw-ok/70 rounded-2xl relative shadow-lg shadow-nw-ok/30">
                  {/* Corner accents */}
                  <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-nw-ok rounded-tl-md" />
                  <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-nw-ok rounded-tr-md" />
                  <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-nw-ok rounded-bl-md" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-nw-ok rounded-br-md" />

                  {/* Animated Scanning Laser Line */}
                  <div className="absolute left-0 right-0 h-0.5 bg-nw-ok shadow-lg shadow-nw-ok/30 animate-pulse top-1/2 -translate-y-1/2" />
                </div>
                <p className="text-[10px] text-nw-ok font-bold bg-nw-bg px-3 py-1 rounded-full border border-nw-ok/30 mt-3 shadow">
                  ضع الباركود داخل الإطار المحدد
                </p>
              </div>
            </>
          )}
        </div>

        {/* Feedback Bar on Scanned Result */}
        {lastScannedCode && (
          <div className="p-3 bg-nw-bg border-t border-nw-border flex items-center justify-between gap-3 text-xs">
            {lastScannedProduct ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-nw-ok-bg border border-nw-ok/40 text-nw-ok flex items-center justify-center shrink-0">
                  <PackageCheck className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-nw-text truncate">{lastScannedProduct.nameAr}</div>
                  <div className="text-[10px] text-nw-ok font-bold">
                    تمت الإضافة! السعر: {lastScannedProduct.retailPrice.toFixed(3)} د.أ
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-nw-bad font-bold min-w-0">
                <AlertCircle className="w-4 h-4 text-nw-bad shrink-0" />
                <span className="truncate">الرمز غير معروف ({lastScannedCode})</span>
              </div>
            )}

            {scanCount > 0 && (
              <span className="bg-nw-ok-bg text-nw-ok border border-nw-ok/40 font-black px-2.5 py-1 rounded-xl text-[10px] shrink-0">
                إجمالي الممسوح: {scanCount}
              </span>
            )}
          </div>
        )}

        {/* Footer Settings & Controls */}
        <div className="p-4 bg-nw-surface border-t border-nw-border space-y-3 shrink-0">
          <div className="flex items-center justify-between text-xs">
            {/* Continuous Toggle */}
            <button
              onClick={() => setIsContinuous(!isContinuous)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition ${
                isContinuous
                  ? 'bg-nw-ok-bg text-nw-ok border-nw-ok/40'
                  : 'bg-nw-surface-2 text-nw-muted border-nw-border'
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
                  ? 'bg-nw-ok-bg text-nw-ok border-nw-ok/40'
                  : 'bg-nw-surface-2 text-nw-muted border-nw-border'
              }`}
              title={soundEnabled ? 'صوت التنبيه مفعل' : 'صوت التنبيه مكتوم'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full bg-nw-surface-2 hover:bg-nw-track text-nw-text font-bold py-2.5 rounded-2xl text-xs transition border border-nw-border"
          >
            إغلاق الكاميرا والعودة للسلة
          </button>
        </div>
      </div>
    </div>
  );
};
