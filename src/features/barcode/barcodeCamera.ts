import type { Html5QrcodeSupportedFormats } from 'html5-qrcode';

export const PRODUCT_BARCODE_FORMAT_NAMES = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'UPC_E',
  'CODE_128',
] as const;

export interface BarcodeCameraController {
  stop: () => Promise<void>;
}

export interface StartBarcodeCameraOptions {
  elementId: string;
  onDecoded: (value: string) => void;
  oneShot?: boolean;
  productBarcodesOnly?: boolean;
  scannerFactory?: BarcodeScannerFactory;
  supportCheck?: () => string | null;
}

export interface BarcodeScannerAdapter {
  isScanning: boolean;
  start: (
    camera: MediaTrackConstraints,
    config: {
      fps: number;
      qrbox: { width: number; height: number };
      aspectRatio: number;
    },
    onDecoded: (value: string) => void,
    onFrameError: () => void
  ) => Promise<unknown>;
  stop: () => Promise<void>;
  clear: () => void;
}

export type BarcodeScannerFactory = (
  elementId: string,
  productBarcodesOnly: boolean
) => Promise<BarcodeScannerAdapter>;

export type StartBarcodeCamera = (
  options: StartBarcodeCameraOptions
) => Promise<BarcodeCameraController>;

export function getBarcodeCameraSupportError(): string | null {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return 'هذا المتصفح لا يدعم تشغيل الكاميرا لمسح الباركود. يمكنك إدخال الباركود يدويًا.';
  }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'تشغيل الكاميرا يحتاج اتصالًا آمنًا. يمكنك إدخال الباركود يدويًا.';
  }

  return null;
}

export function classifyBarcodeCameraError(error: unknown): string {
  const source = error && typeof error === 'object' ? error : {};
  const name = 'name' in source ? String(source.name) : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const searchable = `${name} ${message}`.toLowerCase();

  if (message.includes('يمكنك إدخال الباركود يدويًا')) return message;

  if (
    searchable.includes('notallowed') ||
    searchable.includes('permission') ||
    searchable.includes('denied')
  ) {
    return 'تم رفض إذن الكاميرا. اسمح باستخدامها من إعدادات المتصفح أو أدخل الباركود يدويًا.';
  }

  if (
    searchable.includes('notfound') ||
    searchable.includes('devicesnotfound') ||
    searchable.includes('no camera')
  ) {
    return 'لم يتم العثور على كاميرا متاحة. يمكنك إدخال الباركود يدويًا.';
  }

  if (
    searchable.includes('notsupported') ||
    searchable.includes('unsupported') ||
    searchable.includes('secure context')
  ) {
    return 'هذا المتصفح لا يدعم تشغيل الكاميرا لمسح الباركود. يمكنك إدخال الباركود يدويًا.';
  }

  return 'تعذر تشغيل قارئ الباركود. حاول مرة أخرى أو أدخل الباركود يدويًا.';
}

const createHtml5BarcodeScanner: BarcodeScannerFactory = async (
  elementId,
  productBarcodesOnly
) => {
  const module = await import('html5-qrcode');
  const formatsToSupport = productBarcodesOnly
    ? PRODUCT_BARCODE_FORMAT_NAMES.map(
        (format) => module.Html5QrcodeSupportedFormats[format]
      )
    : undefined;

  return new module.Html5Qrcode(
    elementId,
    formatsToSupport
      ? {
          formatsToSupport:
            formatsToSupport as Html5QrcodeSupportedFormats[],
          verbose: false,
        }
      : undefined
  );
};

const clearScanner = async (scanner: BarcodeScannerAdapter) => {
  try {
    if (scanner.isScanning) await scanner.stop();
  } finally {
    try {
      scanner.clear();
    } catch {
      // The scanner may already have cleared its temporary video/canvas nodes.
    }
  }
};

export const startBarcodeCamera: StartBarcodeCamera = async ({
  elementId,
  onDecoded,
  oneShot = false,
  productBarcodesOnly = false,
  scannerFactory = createHtml5BarcodeScanner,
  supportCheck = getBarcodeCameraSupportError,
}) => {
  const supportError = supportCheck();
  if (supportError) throw new Error(supportError);

  const scanner = await scannerFactory(elementId, productBarcodesOnly);
  let stopped = false;
  let decoded = false;
  let started = false;

  const controller: BarcodeCameraController = {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (started || scanner.isScanning) await clearScanner(scanner);
    },
  };

  try {
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 15,
        qrbox: { width: 280, height: 160 },
        aspectRatio: 1,
      },
      (decodedText) => {
        const value = decodedText.trim();
        if (!value || (oneShot && decoded)) return;
        decoded = true;

        if (oneShot) {
          void controller.stop().finally(() => onDecoded(value));
          return;
        }

        onDecoded(value);
      },
      () => {
        // A frame without a barcode is expected while the camera is searching.
      }
    );
    started = true;
    if (stopped) await clearScanner(scanner);
    return controller;
  } catch (error) {
    stopped = true;
    await clearScanner(scanner).catch(() => undefined);
    throw error;
  }
};
