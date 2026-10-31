import {captureRenderError} from '../lib/errorMonitoring';
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'; platform: string}>;
}

interface StandaloneNavigator extends Navigator {
  standalone?: boolean;
}

export const isRunningStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as StandaloneNavigator).standalone)
  );
};

let isReloadingAfterServiceWorkerUpdate = false;

export const registerAdminServiceWorker = (): void => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  // Installed iPhone PWAs can keep the previous bundle open after a new
  // service worker takes control. Reload once so the new hashed assets and UI
  // are used immediately, without creating a reload loop on first install.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        if (isReloadingAfterServiceWorkerUpdate) return;
        isReloadingAfterServiceWorkerUpdate = true;
        // Let the current document's fonts finish before the intentional reload.
        // Otherwise WebKit can cancel its own in-flight shell requests.
        void document.fonts.ready.then(() => window.location.reload());
      },
      {once: true},
    );
  }

  const register = () => {
    const serviceWorkerUrl = new URL('/sw.js', window.location.origin);
    serviceWorkerUrl.searchParams.set('build', __NAWASRAH_BUILD_ID__);

    void navigator.serviceWorker
      .register(serviceWorkerUrl.href, {
        scope: '/',
        updateViaCache: 'none',
      })
      .then((registration) => {
        const activateWaitingRelease = () => {
          const waiting = registration.waiting;
          if (waiting?.scriptURL === serviceWorkerUrl.href) {
            waiting.postMessage({type: 'NAWASRAH_ACTIVATE_RELEASE', buildId: __NAWASRAH_BUILD_ID__});
          }
        };
        registration.addEventListener('updatefound', () => {
          registration.installing?.addEventListener('statechange', activateWaitingRelease);
        });
        // Registration may resolve with an already-installed waiting worker.
        registration.installing?.addEventListener('statechange', activateWaitingRelease);
        activateWaitingRelease();
        // register() already checks a new script. Do not race a second update
        // against its installation; still check an existing active registration.
        if (!registration.installing && !registration.waiting) return registration.update();
      })
      .catch(() => captureRenderError(new Error('PWA_UPDATE_ERROR')));
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, {once: true});
  }
};
