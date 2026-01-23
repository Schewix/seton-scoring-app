import localforage from 'localforage';
import type { LocalForage } from 'localforage';

let configured = false;
let outboxStore: LocalForage | null = null;

function configureLocalforage() {
  if (configured) {
    return;
  }
  localforage.config({
    name: 'seton-web',
  });
  configured = true;
}

export function getLocalforage() {
  configureLocalforage();
  return localforage;
}

export function getOutboxStore() {
  if (!outboxStore) {
    const storage = getLocalforage();
    outboxStore = storage.createInstance({
      name: 'seton-web',
      storeName: 'outbox',
    });
  }
  return outboxStore;
}
