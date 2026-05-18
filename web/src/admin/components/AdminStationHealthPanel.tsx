import { formatDateTimeForStatus } from '../adminSections';

export type AdminStationHealthCard = {
  stationId: string;
  stationCode: string;
  stationName: string;
  isClosed: boolean;
  status: 'online' | 'warning' | 'offline' | 'unknown';
  statusLabel: string;
  judgeCount: number;
  queueLabel: string;
  lastPassageAt: string | null;
  passed: number;
  expected: number;
  missing: number;
};

export type AdminJudgeAssignmentSummary = {
  id: string;
  email: string;
  displayName: string;
  stationCode: string;
  stationName: string;
  categories: string[];
};

type Props = {
  stationCards: AdminStationHealthCard[];
  assignmentRows: AdminJudgeAssignmentSummary[];
  onToggleStationClosed?: (stationId: string, nextClosed: boolean) => void;
  stationClosingId?: string | null;
};

function statusBadgeClass(status: AdminStationHealthCard['status']) {
  if (status === 'online') {
    return 'admin-status-badge admin-status-badge--online';
  }
  if (status === 'warning') {
    return 'admin-status-badge admin-status-badge--warning';
  }
  if (status === 'offline') {
    return 'admin-status-badge admin-status-badge--offline';
  }
  return 'admin-status-badge admin-status-badge--unknown';
}

export default function AdminStationHealthPanel({
  stationCards,
  assignmentRows,
  onToggleStationClosed,
  stationClosingId,
}: Props) {
  return (
    <div className="admin-station-ops-layout">
      <div className="admin-station-live-panel">
        <header className="admin-station-live-header">
          <h3>Stanoviště - live stav</h3>
          <p className="admin-card-subtitle">
            Samostatné live bloky pro rychlou orientaci během závodu.
          </p>
        </header>
        {stationCards.length === 0 ? (
          <p className="admin-card-subtitle">Stanoviště zatím nejsou k dispozici.</p>
        ) : (
          <div className="admin-station-live-grid">
            {stationCards.map((station) => (
              <article
                key={station.stationId}
                className={`admin-station-live-card admin-station-live-card--${station.status}`}
              >
                <header className="admin-station-live-card-header">
                  <div>
                    <strong>{station.stationCode}</strong>
                    <span>{station.stationName || 'Bez názvu'}</span>
                  </div>
                  <span className={statusBadgeClass(station.status)}>{station.statusLabel}</span>
                </header>
                <dl className="admin-station-live-meta">
                  <div>
                    <dt>Rozhodčí</dt>
                    <dd>{station.judgeCount}</dd>
                  </div>
                  <div>
                    <dt>Průchody</dt>
                    <dd>{station.passed}/{station.expected}</dd>
                  </div>
                  <div>
                    <dt>Chybějící</dt>
                    <dd>{station.missing}</dd>
                  </div>
                  <div>
                    <dt>Fronta</dt>
                    <dd>{station.queueLabel}</dd>
                  </div>
                  <div>
                    <dt>Poslední průchod</dt>
                    <dd>{formatDateTimeForStatus(station.lastPassageAt)}</dd>
                  </div>
                </dl>
                {onToggleStationClosed ? (
                  <div className="admin-station-live-actions">
                    <button
                      type="button"
                      className={`admin-button ${station.isClosed ? 'admin-button--secondary' : 'admin-button--danger'}`}
                      onClick={() => onToggleStationClosed(station.stationId, !station.isClosed)}
                      disabled={stationClosingId === station.stationId}
                    >
                      {stationClosingId === station.stationId
                        ? 'Ukládám…'
                        : station.isClosed
                        ? 'Otevřít stanoviště'
                        : 'Uzavřít stanoviště'}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
        {/* TODO: Napojit live fronty stanovišť a online heartbeat rozhodčích. */}
      </div>

      <div className="admin-judge-list-panel">
        <header className="admin-station-live-header">
          <h3>Rozhodčí na stanovištích</h3>
          <p className="admin-card-subtitle">
            Přehled přiřazení rozhodčích odděleně od formulářů.
          </p>
        </header>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Stanoviště</th>
                <th>Rozhodčí</th>
                <th>E-mail</th>
                <th>Kategorie</th>
              </tr>
            </thead>
            <tbody>
              {assignmentRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>Pro vybraný ročník zatím nejsou žádná přiřazení.</td>
                </tr>
              ) : (
                assignmentRows.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>
                      {assignment.stationCode}
                      {assignment.stationName ? ` - ${assignment.stationName}` : ''}
                    </td>
                    <td>{assignment.displayName || '—'}</td>
                    <td>{assignment.email || '—'}</td>
                    <td>{assignment.categories.length ? assignment.categories.join(', ') : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
