import React from 'react';
import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {CreateDirectReceiptModal} from '../src/features/directReceiving/CreateDirectReceiptModal';

declare global {
  interface Window {
    __DIRECT_RECEIVING_RECOVERY_UNMOUNT__: () => void;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Direct receiving recovery harness root is missing.');

const root = createRoot(rootElement);
window.__DIRECT_RECEIVING_RECOVERY_UNMOUNT__ = () => root.unmount();

root.render(
  <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
    <CreateDirectReceiptModal
      initialProductId="92300000-0000-0000-0000-000000009001"
      onClose={() => root.unmount()}
    />
  </main>,
);
