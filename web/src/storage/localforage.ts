import localforage from 'localforage';

type LocalForageInstance = ReturnType<typeof localforage.createInstance>;

let configured = false;
let outboxStore: LocalForageInstance | null = null;

function configureLocalforage() {
  if (configured) {
    return;
  }
  localforage.config({
    name: 'zelena-liga-scoring-web',
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
      name: 'zelena-liga-scoring-web',
      storeName: 'outbox',
    });
  }
  return outboxStore;
}
