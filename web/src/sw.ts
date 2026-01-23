/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };
// Minimal typings for Background Sync – not available in all TS lib.dom versions
interface SyncEvent extends ExtendableEvent {
  tag: string;
}

const SYNC_TAG = 'sync-pending-ops';
const CACHE_VERSION = 'v2';

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

clientsClaim();
self.skipWaiting();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: `${CACHE_VERSION}-pages`, networkTimeoutSeconds: 3 })
);

registerRoute(
  ({ request, url }) => request.destination === 'manifest' || url.pathname.endsWith('/manifest.json'),
  new NetworkFirst({ cacheName: `${CACHE_VERSION}-manifest`, networkTimeoutSeconds: 3 })
);

registerRoute(
  ({ request }) => request.destination === 'style' || request.destination === 'script',
  new StaleWhileRevalidate({ cacheName: `${CACHE_VERSION}-assets` })
);

registerRoute(
  ({ request, url }) =>
    request.method === 'GET' &&
    request.destination === '' &&
    (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/manifest') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.includes('/rest/v1/') ||
      url.pathname.includes('/auth/v1/')),
  new NetworkFirst({ cacheName: `${CACHE_VERSION}-api-data`, networkTimeoutSeconds: 3 })
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: `${CACHE_VERSION}-images`,
    matchOptions: { ignoreVary: true },
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => {
          return response && response.status === 200 ? response : null;
        },
      },
    ],
  })
);

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_PENDING_OPS' });
  }
}

self.addEventListener('sync', (event: Event) => {
  const se = event as unknown as SyncEvent;
  if (se.tag === SYNC_TAG) {
    se.waitUntil(notifyClientsToSync());
  }
});

export {};
