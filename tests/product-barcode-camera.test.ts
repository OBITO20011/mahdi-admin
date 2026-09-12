import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Product } from '../src/types';
import {
  PRODUCT_BARCODE_FORMAT_NAMES,
  classifyBarcodeCameraError,
  startBarcodeCamera,
  type BarcodeScannerAdapter,
} from '../src/features/barcode/barcodeCamera';
import { validateProductBarcode } from '../src/utils/productIdentifiers';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

test('product capture accepts retail barcode formats but not QR codes', () => {
  assert.deepEqual(PRODUCT_BARCODE_FORMAT_NAMES, [
    'EAN_13',
    'EAN_8',
    'UPC_A',
    'UPC_E',
    'CODE_128',
  ]);
  assert.equal(PRODUCT_BARCODE_FORMAT_NAMES.includes('QR_CODE' as never), false);
});

test('camera failures map to clear Arabic guidance with manual fallback', () => {
  assert.match(
    classifyBarcodeCameraError(
      new DOMException('Permission denied', 'NotAllowedError')
    ),
    /رفض إذن الكاميرا.*يدويًا/
  );
  assert.match(
    classifyBarcodeCameraError(
      new DOMException('Unsupported camera', 'NotSupportedError')
    ),
    /لا يدعم.*يدويًا/
  );
  assert.match(classifyBarcodeCameraError(new Error('stream failed')), /يدويًا/);
});

test('one-shot camera stops and clears before delivering the first barcode', async () => {
  let onDecoded: ((value: string) => void) | undefined;
  let stopCount = 0;
  let clearCount = 0;
  let productFormatsOnly = false;
  const scanner: BarcodeScannerAdapter = {
    isScanning: false,
    start: async (_camera, _config, callback) => {
      scanner.isScanning = true;
      onDecoded = callback;
      return null;
    },
    stop: async () => {
      stopCount += 1;
      scanner.isScanning = false;
    },
    clear: () => {
      clearCount += 1;
    },
  };

  const captured = new Promise<string>((resolve) => {
    void startBarcodeCamera({
      elementId: 'scanner-test',
      oneShot: true,
      productBarcodesOnly: true,
      supportCheck: () => null,
      scannerFactory: async (_elementId, formatsOnly) => {
        productFormatsOnly = formatsOnly;
        return scanner;
      },
      onDecoded: resolve,
    }).then(() => onDecoded?.(' 6291041500213 '));
  });

  assert.equal(await captured, '6291041500213');
  assert.equal(productFormatsOnly, true);
  assert.equal(stopCount, 1);
  assert.equal(clearCount, 1);
});

test('camera cancel and startup failure clean temporary scanner resources', async () => {
  let stopCount = 0;
  let clearCount = 0;
  const scanner: BarcodeScannerAdapter = {
    isScanning: false,
    start: async () => {
      scanner.isScanning = true;
      return null;
    },
    stop: async () => {
      stopCount += 1;
      scanner.isScanning = false;
    },
    clear: () => {
      clearCount += 1;
    },
  };

  const controller = await startBarcodeCamera({
    elementId: 'scanner-cancel-test',
    onDecoded: () => undefined,
    supportCheck: () => null,
    scannerFactory: async () => scanner,
  });
  await controller.stop();
  assert.equal(stopCount, 1);
  assert.equal(clearCount, 1);

  const failedScanner: BarcodeScannerAdapter = {
    ...scanner,
    isScanning: false,
    start: async () => {
      throw new Error('camera startup failed');
    },
  };
  await assert.rejects(
    startBarcodeCamera({
      elementId: 'scanner-failure-test',
      onDecoded: () => undefined,
      supportCheck: () => null,
      scannerFactory: async () => failedScanner,
    }),
    /camera startup failed/
  );
  assert.equal(clearCount, 2);
});

test('continuous scanner mode preserves POS behavior until explicit close', async () => {
  let onDecoded: ((value: string) => void) | undefined;
  let stopCount = 0;
  const values: string[] = [];
  const scanner: BarcodeScannerAdapter = {
    isScanning: false,
    start: async (_camera, _config, callback) => {
      scanner.isScanning = true;
      onDecoded = callback;
      return null;
    },
    stop: async () => {
      stopCount += 1;
      scanner.isScanning = false;
    },
    clear: () => undefined,
  };

  const controller = await startBarcodeCamera({
    elementId: 'pos-continuous-test',
    onDecoded: (value) => values.push(value),
    supportCheck: () => null,
    scannerFactory: async (_elementId, formatsOnly) => {
      assert.equal(formatsOnly, false);
      return scanner;
    },
  });
  onDecoded?.('FIRST');
  onDecoded?.('SECOND');

  assert.deepEqual(values, ['FIRST', 'SECOND']);
  assert.equal(stopCount, 0);
  await controller.stop();
  assert.equal(stopCount, 1);
});

test('barcode precheck rejects duplicates and cross-field collisions but excludes self', () => {
  const products = [
    {
      id: 'product-one',
      sku: 'SKU-ONE',
      barcode: '625100000001',
    },
  ] as Product[];

  assert.deepEqual(
    validateProductBarcode(products, { barcode: ' 625100000001 ' }),
    {
      valid: false,
      code: 'DUPLICATE_BARCODE',
      message: 'الباركود مستخدم بالفعل لمنتج آخر.',
    }
  );
  assert.equal(
    validateProductBarcode(products, { barcode: 'sku-one' }).valid,
    false
  );
  assert.deepEqual(
    validateProductBarcode(products, {
      barcode: '625100000001',
      currentProductId: 'product-one',
    }),
    { valid: true }
  );
});

test('product and flavor forms use shared one-shot capture while flavor master stays barcode-free', () => {
  const productForm = readSource('../src/features/products/ProductFormModal.tsx');
  const productDetail = readSource('../src/features/products/ProductDetailModal.tsx');
  const captureModal = readSource(
    '../src/features/barcode/BarcodeCameraCaptureModal.tsx'
  );
  const posModal = readSource('../src/features/pos/BarcodeScannerModal.tsx');

  assert.match(productForm, /مسح باركود المنتج بالكاميرا/);
  assert.match(productForm, /isOpen=\{isBarcodeCameraOpen && !isFlavorMaster\}/);
  assert.match(productDetail, /مسح باركود النكهة الجديدة بالكاميرا/);
  assert.match(productDetail, /setBarcodeCameraTarget\('edit'\)/);
  assert.match(captureModal, /oneShot: true/);
  assert.match(captureModal, /productBarcodesOnly: true/);
  assert.match(posModal, /startBarcodeCamera/);
  assert.doesNotMatch(posModal, /from 'html5-qrcode'/);
});
