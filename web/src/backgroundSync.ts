const SYNC_TAG = 'sync-pending-ops';

export const PENDING_SYNC_EVENT = 'SYNC_PENDING_OPS';

type BackgroundSyncCapable = ServiceWorkerRegistration & {
  // Background Sync is not in lib.dom.d.ts everywhere; define the minimal surface we need
  sync: {
    register(tag: string): Promise<void>;
  };
};

function hasBackgroundSync(reg: ServiceWorkerRegistration): reg is BackgroundSyncCapable {
  return typeof (reg as any)?.sync?.register === 'function';
}

export async function registerPendingSync() {
  if (!('serviceWorker' in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    if (hasBackgroundSync(registration)) {
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
