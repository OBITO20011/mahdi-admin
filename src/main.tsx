import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initErrorMonitoring} from './lib/errorMonitoring';
import {registerAdminServiceWorker} from './pwa/pwa';

initErrorMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerAdminServiceWorker();
