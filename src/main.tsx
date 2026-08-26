import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initErrorMonitoring} from './lib/errorMonitoring';
import {registerAdminServiceWorker} from './pwa/pwa';

const startErrorMonitoring = () => initErrorMonitoring();

if ('requestIdleCallback' in window) {
  window.requestIdleCallback(startErrorMonitoring, {timeout: 3_000});
} else {
  window.setTimeout(startErrorMonitoring, 1_500);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerAdminServiceWorker();
