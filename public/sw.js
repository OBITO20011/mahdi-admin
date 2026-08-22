const CACHE_NAME = 'nawasrah-admin-shell-v3';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/admin-icon-192.png',
  '/icons/admin-icon-512.png',
  '/icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase, authentication, RPC, inventory or accounting traffic.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest';

  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {body: event.data ? event.data.text() : ''};
  }

  const title = payload.title || 'إدارة محلات النواصرة';
  const options = {
    body: payload.body || 'لديك تحديث جديد في لوحة الإدارة.',
    icon: payload.icon || '/icons/admin-icon-192.png',
    badge: payload.badge || '/icons/admin-icon-192.png',
    tag: payload.tag || 'nawasrah-admin-update',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: payload.data || {url: '/?screen=orders'},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || '/?screen=orders';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({type: 'window', includeUncontrolled: true})
      .then(async (clientList) => {
        const existingClient = clientList.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );

        if (existingClient) {
          if ('navigate' in existingClient) {
            await existingClient.navigate(targetUrl);
          }
          return existingClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
