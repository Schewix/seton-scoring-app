const SYNC_TAG = 'sync-pending-ops';

export const PENDING_SYNC_EVENT = 'SYNC_PENDING_OPS';

export async function registerPendingSync() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await registration.sync.register(SYNC_TAG);
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug('Background sync registration failed', error);
    }
  }
}

export function setupSyncListener(callback: () => void) {
  if (!('serviceWorker' in navigator)) {
    return () => {};
  }
  const handler = (event: MessageEvent) => {
    if (event.data && typeof event.data === 'object' && event.data.type === PENDING_SYNC_EVENT) {
      callback();
    }
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
