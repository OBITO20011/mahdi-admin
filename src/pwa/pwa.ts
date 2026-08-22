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
        window.location.reload();
      },
      {once: true},
    );
  }

  const register = () => {
    void navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      .then((registration) => registration.update())
      .catch(() => undefined);
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, {once: true});
  }
};
