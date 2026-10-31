import {sanitizeEvent,sanitizeBreadcrumb,monitoringScreen} from './monitoringPrivacy';

const jordanPhonePattern = /(?:\+?962|0)7[789]\d{7}/g;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type SentrySdk = typeof import('@sentry/react');

const pendingChunkKey='nawasrah:monitoring:pending-chunk';
const isChunkFailure=(error:Error)=>/chunk|dynamically imported|module script/iu.test(error.message);
let monitoringSdk: SentrySdk | null = null;
let monitoringLoad: Promise<SentrySdk> | null = null;
let bootstrapListenersInstalled = false;
let removeBootstrapListeners: (() => void) | null = null;
const pendingRenderErrors: Array<{ error: Error; componentStack?: string; screen: string }> = [];

function redactText(value: string): string {
  return value
    .replace(jordanPhonePattern, '[phone]')
    .replace(emailPattern, '[email]');
}

function getMonitoringDsn(): string | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  return import.meta.env.PROD && import.meta.env.VITE_MONITORING_ENV !== 'isolated' && ['production','staging','prelaunch-trial'].includes(import.meta.env.VITE_MONITORING_ENV ?? '') && dsn ? dsn : null;
}

function normalizeUnexpectedError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.trim()) {
    return new Error(redactText(value));
  }
  return new Error(fallback);
}

function loadMonitoringSdk(): Promise<SentrySdk> | null {
  const dsn = getMonitoringDsn();
  if (!dsn) return null;
  if (monitoringSdk) return Promise.resolve(monitoringSdk);
  if (monitoringLoad) return monitoringLoad;

  monitoringLoad = import('@sentry/react')
    .then((sdk) => {
      sdk.init({
        dsn,
        environment: import.meta.env.VITE_MONITORING_ENV,
        release: import.meta.env.VITE_MONITORING_RELEASE,
        defaultIntegrations: false,
        integrations: [sdk.globalHandlersIntegration(),sdk.dedupeIntegration()],
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        sendDefaultPii: false,
        attachStacktrace: true,
        maxBreadcrumbs: 30,
        normalizeDepth: 4,
        tracesSampleRate: 0,
        beforeBreadcrumb: sanitizeBreadcrumb,
        beforeSend: (event) => sanitizeEvent(event, {screen: event.tags?.screen ?? window.location.pathname}),
      });
      monitoringSdk = sdk;
      removeBootstrapListeners?.();
      removeBootstrapListeners = null;
      bootstrapListenersInstalled = false;

      for (const pending of pendingRenderErrors.splice(0)) {
        captureRenderError(pending.error, pending.componentStack, pending.screen);
      }

      return sdk;
    })
    .catch((error: unknown) => {
      monitoringLoad = null;
      console.warn('[ErrorMonitoring] تعذر تحميل خدمة مراقبة الأخطاء.', error);
      throw error;
    });

  return monitoringLoad;
}

export function initErrorMonitoring(): boolean {
  if (!getMonitoringDsn()) return false;
  if (monitoringSdk || monitoringLoad || bootstrapListenersInstalled) return true;

  const handleWindowError = (event: globalThis.ErrorEvent) => {
    captureRenderError(
      normalizeUnexpectedError(event.error ?? event.message, 'خطأ غير متوقع في المتجر.'),
    );
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    captureRenderError(
      normalizeUnexpectedError(event.reason, 'فشل غير متوقع في عملية غير متزامنة.'),
    );
  };

  window.addEventListener('vite:preloadError', () => captureRenderError(new Error('CHUNK_LOAD_ERROR')));
  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  removeBootstrapListeners = () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
  bootstrapListenersInstalled = true;
  try {if(window.sessionStorage.getItem(pendingChunkKey)==='1')captureRenderError(new Error('CHUNK_LOAD_ERROR'));}catch{/* Storage may be unavailable; normal capture still works. */}
  return true;
}

export function captureRenderError(error: Error, componentStack?: string, screen = monitoringScreen(window.location.pathname)): void {
  if (!monitoringSdk) {
    if (!getMonitoringDsn()) return;
    // Only a fixed code survives the existing immediate stale-chunk reload.
    if(isChunkFailure(error))try{window.sessionStorage.setItem(pendingChunkKey,'1');}catch{/* No business data is stored. */}
    if (pendingRenderErrors.length < 10) {
      pendingRenderErrors.push({ error, componentStack, screen });
    }
    void loadMonitoringSdk()?.catch(() => undefined);
    return;
  }

  monitoringSdk.withScope((scope) => {
    scope.setTag('screen',screen);
    if (componentStack) {
      scope.setTag('error_code','REACT_RENDER_ERROR');
      scope.setTag('component','StoreErrorBoundary');
    }
    if (isChunkFailure(error)) scope.setTag('error_code','CHUNK_LOAD_ERROR');
    else if(error.message==='PWA_UPDATE_ERROR')scope.setTag('error_code','PWA_UPDATE_ERROR');
    monitoringSdk?.captureException(error);
    if(isChunkFailure(error))try{window.sessionStorage.removeItem(pendingChunkKey);}catch{/* Best-effort cleanup. */}
  });
}
