import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Camera, RefreshCw, X } from 'lucide-react';
import {
  classifyBarcodeCameraError,
  startBarcodeCamera,
  type BarcodeCameraController,
  type StartBarcodeCamera,
} from './barcodeCamera';

interface BarcodeCameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (barcode: string) => void;
  startScanner?: StartBarcodeCamera;
}

export const BarcodeCameraCaptureModal: React.FC<
  BarcodeCameraCaptureModalProps
> = ({ isOpen, onClose, onCapture, startScanner = startBarcodeCamera }) => {
  const reactId = useId();
  const regionId = `product-barcode-camera-${reactId.replace(/:/g, '')}`;
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      window.setTimeout(() => previousFocus?.focus(), 0);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let disposed = false;
    let controller: BarcodeCameraController | null = null;
    setCameraError(null);

    const timer = window.setTimeout(() => {
      void startScanner({
        elementId: regionId,
        oneShot: true,
        productBarcodesOnly: true,
        onDecoded: (value) => {
          if (disposed) return;
          onCapture(value);
          onClose();
        },
      })
        .then((startedController) => {
          if (disposed) {
            void startedController.stop();
            return;
          }
          controller = startedController;
        })
        .catch((error) => {
          if (!disposed) setCameraError(classifyBarcodeCameraError(error));
        });
    }, 150);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (controller) void controller.stop();
    };
  }, [attempt, isOpen, onCapture, onClose, regionId, startScanner]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-md"
      role="dialog"
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={`${regionId}-title`}
      dir="rtl"
    >
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/15 text-emerald-300">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <h3 id={`${regionId}-title`} className="text-sm font-black text-white">
                مسح باركود المنتج
              </h3>
              <p className="mt-0.5 text-[10px] text-slate-400">
                تُغلق الكاميرا تلقائيًا بعد قراءة باركود واحد.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="إلغاء مسح الباركود وإغلاق الكاميرا"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 transition hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex min-h-[280px] items-center justify-center overflow-hidden bg-black">
          {cameraError ? (
            <div className="max-w-xs space-y-4 p-6 text-center">
              <AlertCircle className="mx-auto h-10 w-10 text-rose-400" />
              <p role="alert" className="text-xs font-bold leading-6 text-rose-200">
                {cameraError}
              </p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mx-auto flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-black text-slate-200"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <>
              <div id={regionId} className="h-full min-h-[280px] w-full" />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div className="h-36 w-64 rounded-2xl border-2 border-dashed border-emerald-400/80 shadow-[0_0_22px_rgba(16,185,129,0.3)]" />
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-800 p-4">
          <p className="mb-3 text-center text-[10px] font-bold text-slate-400">
            لا تُحفظ صورة أو فيديو؛ تُستخدم فقط قيمة الباركود المقروءة.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-black text-slate-200"
          >
            إلغاء والمتابعة بالإدخال اليدوي
          </button>
        </div>
      </div>
    </div>
  );
};
