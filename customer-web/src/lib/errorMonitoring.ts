import type { Breadcrumb, ErrorEvent } from '@sentry/react';

const sensitiveKeyPattern =
  /address|authorization|customer|email|location|name|notes?|password|phone|token/i;
const jordanPhonePattern = /(?:\+?962|0)7[789]\d{7}/g;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const redactedValue = '[filtered]';

type SentrySdk = typeof import('@sentry/react');

let monitoringSdk: SentrySdk | null = null;
let monitoringLoad: Promise<SentrySdk> | null = null;
let bootstrapListenersInstalled = false;
let removeBootstrapListeners: (() => void) | null = null;
const pendingRenderErrors: Array<{ error: Error; componentStack?: string }> = [];

function redactText(value: string): string {
  return value
    .replace(jordanPhonePattern, '[phone]')
    .replace(emailPattern, '[email]');
}

function stripUrlDetails(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return redactText(value.split('?')[0]?.split('#')[0] ?? value);
  }
}

function sanitizeValue(value: unknown, key = '', depth = 0): unknown {
  if (sensitiveKeyPattern.test(key)) return redactedValue;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, '', depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return value;
}

function sanitizeEvent(event: ErrorEvent): ErrorEvent {
  event.user = undefined;

  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url ? stripUrlDetails(event.request.url) : undefined,
    };
  }

  event.message = event.message ? redactText(event.message) : event.message;
  event.extra = sanitizeValue(event.extra) as ErrorEvent['extra'];
  event.contexts = sanitizeValue(event.contexts) as ErrorEvent['contexts'];
  event.tags = sanitizeValue(event.tags) as ErrorEvent['tags'];

  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactText(value.value);
  }

  return event;
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;

  breadcrumb.message = breadcrumb.message
    ? redactText(breadcrumb.message)
    : breadcrumb.message;

  if (breadcrumb.data) {
    const sanitizedData = sanitizeValue(breadcrumb.data) as Record<string, unknown>;
    const rawUrl = breadcrumb.data.url;
    if (typeof rawUrl === 'string') sanitizedData.url = stripUrlDetails(rawUrl);
    breadcrumb.data = sanitizedData;
  }

  return breadcrumb;
}

function getMonitoringDsn(): string | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  return import.meta.env.PROD && dsn ? dsn : null;
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
        environment: 'production',
        sendDefaultPii: false,
        attachStacktrace: true,
        maxBreadcrumbs: 30,
        normalizeDepth: 4,
        tracesSampleRate: 0,
        beforeBreadcrumb: sanitizeBreadcrumb,
        beforeSend: sanitizeEvent,
      });
      monitoringSdk = sdk;
      removeBootstrapListeners?.();
      removeBootstrapListeners = null;
      bootstrapListenersInstalled = false;

      for (const pending of pendingRenderErrors.splice(0)) {
        captureRenderError(pending.error, pending.componentStack);
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

  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  removeBootstrapListeners = () => {
    window.removeEventListener('error', handleWindowError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
  bootstrapListenersInstalled = true;
  return true;
}

export function captureRenderError(error: Error, componentStack?: string): void {
  if (!monitoringSdk) {
    if (!getMonitoringDsn()) return;
    if (pendingRenderErrors.length < 10) {
      pendingRenderErrors.push({ error, componentStack });
    }
    void loadMonitoringSdk()?.catch(() => undefined);
    return;
  }

  monitoringSdk.withScope((scope) => {
    if (componentStack) {
      scope.setContext('react', {componentStack: redactText(componentStack)});
    }
    monitoringSdk?.captureException(error);
  });
}
