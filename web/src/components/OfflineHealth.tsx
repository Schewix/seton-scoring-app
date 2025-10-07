import type { FC } from 'react';

interface OfflineHealthProps {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  syncing: boolean;
  nextAttemptAt: string | null;
  lastSyncedAt: string | null;
}

function formatTime(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

const OfflineHealth: FC<OfflineHealthProps> = ({
  isOnline,
  pendingCount,
  failedCount,
  syncing,
  nextAttemptAt,
  lastSyncedAt,
}) => {
  const queueLabel = pendingCount
    ? `čeká ${pendingCount}${failedCount ? ` • chyby ${failedCount}` : ''}`
    : 'prázdná';
  const queueClass = failedCount > 0 ? 'warn' : pendingCount > 0 ? 'info' : 'ok';

  let syncLabel: string;
  let syncClass: 'ok' | 'info' | 'warn';

  if (syncing) {
    syncLabel = 'Odesílám…';
    syncClass = 'info';
  } else if (!isOnline) {
    syncLabel = 'Čekám na připojení';
    syncClass = 'warn';
  } else if (failedCount > 0) {
    const timeLabel = formatTime(nextAttemptAt);
    syncLabel = timeLabel ? `Další pokus ${timeLabel}` : 'Vyžaduje znovu odeslat';
    syncClass = 'warn';
  } else if (pendingCount > 0) {
    const timeLabel = formatTime(nextAttemptAt);
    syncLabel = timeLabel ? `Další pokus ${timeLabel}` : 'Připraveno k odeslání';
    syncClass = 'info';
  } else {
    const lastLabel = formatTime(lastSyncedAt);
    syncLabel = lastLabel ? `Poslední úspěch ${lastLabel}` : 'Zatím žádné odeslání';
    syncClass = 'ok';
  }

  const networkClass = isOnline ? 'online' : 'offline';
  const queueDotClass = failedCount > 0 ? 'warn' : pendingCount > 0 ? 'online' : 'sync';
  const syncDotClass = syncClass === 'ok' ? 'sync' : syncClass === 'info' ? 'online' : 'warn';

  return (
    <section className="offline-health" aria-label="Stav offline fronty">
      <div className="offline-health-row offline-health-network">
        <span className={`offline-health-dot ${networkClass}`} aria-hidden="true" />
        <span className="offline-health-label">Síť:</span>
        <span className={`offline-health-value ${isOnline ? 'ok' : 'warn'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="offline-health-row">
        <span className={`offline-health-dot ${queueDotClass}`} aria-hidden="true" />
        <span className="offline-health-label">Fronta:</span>
        <span className={`offline-health-value ${queueClass}`}>{queueLabel}</span>
      </div>
      <div className="offline-health-row">
        <span className={`offline-health-dot ${syncDotClass}`} aria-hidden="true" />
        <span className="offline-health-label">Synchronizace:</span>
        <span className={`offline-health-value ${syncClass}`}>{syncLabel}</span>
      </div>
    </section>
  );
};

export default OfflineHealth;
