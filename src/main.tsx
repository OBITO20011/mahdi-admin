import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Self-hosted: the admin CSP allows fonts from 'self' only.
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './index.css';
import {initErrorMonitoring} from './lib/errorMonitoring';
import {registerAdminServiceWorker} from './pwa/pwa';

// Installs two tiny native listeners. The Sentry SDK itself is downloaded only
// after a real render/runtime error, so healthy sessions pay no startup cost.
initErrorMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerAdminServiceWorker();
