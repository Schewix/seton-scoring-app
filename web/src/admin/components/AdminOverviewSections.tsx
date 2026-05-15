import {
  formatDateTimeForStatus,
  toAdminSectionId,
  type AdminSectionKey,
  type RaceDashboardSummary,
} from '../adminSections';

type DashboardSectionProps = {
  eventLoading: boolean;
  scoringLocked: boolean;
  lockUpdating: boolean;
  onToggleLock: (nextLocked: boolean) => void;
  onNavigate: (section: AdminSectionKey) => void;
  summary: RaceDashboardSummary;
  warnings: string[];
  eventError: string | null;
  lockMessage: string | null;
};

export function AdminDashboardSection({
  eventLoading,
  scoringLocked,
  lockUpdating,
  onToggleLock,
  onNavigate,
  summary,
  warnings,
  eventError,
  lockMessage,
}: DashboardSectionProps) {
  const syncState = summary.problematicStations > 0 || summary.syncConflicts > 0
    ? 'alert'
    : summary.lastSyncAt
    ? 'ok'
    : 'pending';

  return (
    <section
      id={toAdminSectionId('dashboard')}
      className="admin-card admin-card--section admin-card--dashboard-focus admin-section-block admin-section-block--dashboard"
    >
      <header className="admin-card-header">
        <div>
          <h2>Dashboard závodu</h2>
          <p className="admin-card-subtitle">
            {eventLoading
              ? 'Načítám stav závodu…'
              : scoringLocked
              ? 'Závod je ukončen. Zapisování bodů je uzamčeno pro všechna stanoviště kromě T.'
              : 'Závod probíhá. Všechna stanoviště mohou zapisovat body.'}
          </p>
        </div>
        <div className="admin-card-actions admin-card-actions--quick">
          <button
            type="button"
            className="admin-button admin-button--primary"
            onClick={() => onToggleLock(!scoringLocked)}
            disabled={lockUpdating}
          >
            {lockUpdating ? 'Aktualizuji…' : scoringLocked ? 'Znovu povolit zapisování' : 'Ukončit závod'}
          </button>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={() => onNavigate('patrols')}
          >
            Přidat hlídku
          </button>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={() => onNavigate('live')}
          >
            Otevřít live mapu
          </button>
          <a
            className="admin-button admin-button--secondary"
            href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky?autoExport=1"
            target="_blank"
            rel="noreferrer"
          >
            Export výsledků
          </a>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={() => onNavigate('exports')}
          >
            Export dat
          </button>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={() => onNavigate('stations')}
          >
            Správa rozhodčích
          </button>
        </div>
      </header>
      <div className="admin-dashboard-live-status">
        <article className={`admin-dashboard-live-status-item admin-dashboard-live-status-item--${syncState}`}>
          <span>Synchronizace</span>
          <strong>
            {syncState === 'ok'
              ? 'Synchronizováno'
              : syncState === 'alert'
              ? 'Vyžaduje pozornost'
              : 'Čeká na první data'}
          </strong>
        </article>
        <article className="admin-dashboard-live-status-item">
          <span>Offline / problémová stanoviště</span>
          <strong>{summary.problematicStations}</strong>
        </article>
        <article className="admin-dashboard-live-status-item">
          <span>Konflikty synchronizace</span>
          <strong>{summary.syncConflicts}</strong>
        </article>
        <article className="admin-dashboard-live-status-item">
          <span>Poslední sync</span>
          <strong>{formatDateTimeForStatus(summary.lastSyncAt)}</strong>
        </article>
      </div>
      <div className="admin-dashboard-metrics">
        <article className="admin-dashboard-metric admin-dashboard-metric--primary">
          <span>Přihlášené hlídky</span>
          <strong>{summary.registeredPatrols}</strong>
        </article>
        <article className="admin-dashboard-metric admin-dashboard-metric--highlight">
          <span>Hlídky na trati</span>
          <strong>{summary.patrolsOnCourse}</strong>
        </article>
        <article className="admin-dashboard-metric admin-dashboard-metric--highlight">
          <span>Dokončené hlídky</span>
          <strong>{summary.patrolsFinished}</strong>
        </article>
        <article className="admin-dashboard-metric admin-dashboard-metric--warning">
          <span>Čekající na start</span>
          <strong>{summary.patrolsWaitingForStart}</strong>
        </article>
        <article className="admin-dashboard-metric admin-dashboard-metric--danger">
          <span>Offline/problémová stanoviště</span>
          <strong>{summary.problematicStations}</strong>
        </article>
        <article className="admin-dashboard-metric admin-dashboard-metric--primary">
          <span>Poslední synchronizace</span>
          <strong>{formatDateTimeForStatus(summary.lastSyncAt)}</strong>
        </article>
      </div>
      {warnings.length > 0 ? (
        <div className="admin-dashboard-alerts">
          {warnings.map((warning) => (
            <p key={warning} className="admin-notice">{warning}</p>
          ))}
        </div>
      ) : null}
      {eventError ? <p className="admin-error">{eventError}</p> : null}
      {lockMessage ? <p className="admin-notice">{lockMessage}</p> : null}
    </section>
  );
}

type LiveSectionProps = {
  stationLoading: boolean;
  onRefresh: () => void;
  summary: RaceDashboardSummary;
};

export function AdminLiveOverviewSection({
  stationLoading,
  onRefresh,
  summary,
}: LiveSectionProps) {
  const hasCriticalIssue = summary.problematicStations > 0 || summary.syncConflicts > 0;
  const hasWarningIssue = summary.missingLongPatrols > 0 || summary.overdueNoFinishPatrols > 0;

  return (
    <section
      id={toAdminSectionId('live')}
      className="admin-card admin-card--section admin-card--live-focus admin-section-block admin-section-block--live"
    >
      <header className="admin-card-header">
        <div>
          <h2>Živý průběh závodu</h2>
          <p className="admin-card-subtitle">
            Rychlý přehled provozu během závodu včetně průchodů a synchronizace.
          </p>
        </div>
        <div className="admin-card-actions">
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={onRefresh}
            disabled={stationLoading}
          >
            {stationLoading ? 'Načítám…' : 'Obnovit live data'}
          </button>
        </div>
      </header>
      <div className="admin-live-status-panel">
        <div className="admin-live-status-panel-row">
          <span className={`admin-status-badge ${hasCriticalIssue ? 'admin-status-badge--offline' : 'admin-status-badge--online'}`}>
            {hasCriticalIssue ? 'Problém synchronizace' : 'Synchronizace v pořádku'}
          </span>
          <span className={`admin-status-badge ${summary.problematicStations > 0 ? 'admin-status-badge--offline' : 'admin-status-badge--online'}`}>
            Offline/problémová stanoviště: {summary.problematicStations}
          </span>
          <span className={`admin-status-badge ${summary.syncConflicts > 0 ? 'admin-status-badge--warning' : 'admin-status-badge--online'}`}>
            Konflikty: {summary.syncConflicts}
          </span>
          <span className="admin-status-badge admin-status-badge--unknown">
            Poslední sync: {formatDateTimeForStatus(summary.lastSyncAt)}
          </span>
        </div>
        {hasCriticalIssue || hasWarningIssue ? (
          <div className="admin-live-status-alerts">
            {summary.problematicStations > 0 ? (
              <p className="admin-error">Některá stanoviště mohou být offline nebo bez dat.</p>
            ) : null}
            {summary.syncConflicts > 0 ? (
              <p className="admin-notice">Zjištěny konflikty synchronizace, zkontroluj queue a exporty.</p>
            ) : null}
            {summary.missingLongPatrols > 0 ? (
              <p className="admin-notice">Některé hlídky dlouho nejsou vidět v průchodech.</p>
            ) : null}
            {summary.overdueNoFinishPatrols > 0 ? (
              <p className="admin-error">Některé hlídky stále nemají cíl po očekávaném čase.</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="admin-live-grid">
        <article className="admin-live-item admin-live-item--primary">
          <span>Průchody (viděné hlídky)</span>
          <strong>{summary.patrolsSeenOnCourse}</strong>
        </article>
        <article className="admin-live-item admin-live-item--danger">
          <span>Offline/problémy stanovišť</span>
          <strong>{summary.problematicStations}</strong>
        </article>
        <article className="admin-live-item admin-live-item--warning">
          <span>Konflikty synchronizace</span>
          <strong>{summary.syncConflicts}</strong>
        </article>
        <article className="admin-live-item admin-live-item--warning">
          <span>Hlídky dlouho nevidět</span>
          <strong>{summary.missingLongPatrols}</strong>
        </article>
        <article className="admin-live-item admin-live-item--danger">
          <span>Bez cíle po očekávaném čase</span>
          <strong>{summary.overdueNoFinishPatrols}</strong>
        </article>
        <article className="admin-live-item">
          <span>Poslední synchronizace</span>
          <strong>{formatDateTimeForStatus(summary.lastSyncAt)}</strong>
        </article>
      </div>
      <div className="admin-card-actions">
        <a className="admin-button admin-button--secondary" href="#admin-live-map-section">
          Otevřít mapu průchodů
        </a>
      </div>
      {/* TODO: Napojit endpointy pro offline stanoviště, konflikty synchronizace a hlídky dlouho nevidět. */}
    </section>
  );
}

type LiveMapSectionProps = {
  mapRoute: string;
};

export function AdminLiveMapSection({ mapRoute }: LiveMapSectionProps) {
  return (
    <section
      id="admin-live-map-section"
      className="admin-card admin-card--section admin-card--live-map admin-section-block admin-section-block--live"
    >
      <header className="admin-card-header">
        <div>
          <h2>Live mapa závodu</h2>
          <p className="admin-card-subtitle">
            Připravené místo pro budoucí mapový náhled live průchodů a stavů stanovišť.
          </p>
        </div>
      </header>
      <div className="admin-live-map-placeholder">
        <div className="admin-live-map-placeholder-canvas" role="img" aria-label="Náhled live mapy závodu">
          <span>Náhled mapy</span>
        </div>
        <div className="admin-live-map-placeholder-meta">
          <p>
            Mapa je napojená na živý dispečink průchodů, front a stavů stanovišť.
          </p>
          <a className="admin-button admin-button--secondary" href={mapRoute}>
            Otevřít mapu
          </a>
        </div>
      </div>
    </section>
  );
}

export function AdminQueuesSection() {
  return (
    <section
      id={toAdminSectionId('queues')}
      className="admin-card admin-card--section admin-section-block admin-section-block--queues"
    >
      <header className="admin-card-header">
        <div>
          <h2>Fronty a čekání</h2>
          <p className="admin-card-subtitle">
            Přehled čekání podle stanovišť. UI je připravené pro pozdější napojení dat.
          </p>
        </div>
      </header>
      <div className="admin-placeholder-grid">
        <div className="admin-placeholder-item">
          <strong>Čekající hlídky</strong>
          <span>—</span>
        </div>
        <div className="admin-placeholder-item">
          <strong>Právě odbavováno</strong>
          <span>—</span>
        </div>
        <div className="admin-placeholder-item">
          <strong>Průměrné čekání</strong>
          <span>—</span>
        </div>
        <div className="admin-placeholder-item">
          <strong>Maximální čekání</strong>
          <span>—</span>
        </div>
      </div>
      {/* TODO: Napojit data front a čekání po stanovištích z backendu. */}
    </section>
  );
}

type PatrolsOverviewSectionProps = {
  onShowPreRaceSetup: () => void;
};

export function AdminPatrolsOverviewSection({ onShowPreRaceSetup }: PatrolsOverviewSectionProps) {
  return (
    <section
      id={toAdminSectionId('patrols')}
      className="admin-card admin-card--section admin-section-block admin-section-block--patrols"
    >
      <header className="admin-card-header">
        <div>
          <h2>Hlídky a registrace</h2>
          <p className="admin-card-subtitle">
            Vyhledávání, filtrace, registrace a kontrola duplicit hlídek.
          </p>
        </div>
        <div className="admin-card-actions">
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={onShowPreRaceSetup}
          >
            Zobrazit předzávodní nastavení
          </button>
        </div>
      </header>
      <div className="admin-placeholder-grid">
        <div className="admin-placeholder-item"><strong>Vyhledávání hlídek</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Filtr: kategorie</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Filtr: oddíl</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Kontrola duplicit</strong><span>TODO</span></div>
      </div>
      {/* TODO: Připravit kompletní seznam hlídek s filtry a editací. */}
    </section>
  );
}

export function AdminStartsSection() {
  return (
    <section
      id={toAdminSectionId('starts')}
      className="admin-card admin-card--section admin-section-block admin-section-block--starts"
    >
      <header className="admin-card-header">
        <div>
          <h2>Startovní časy</h2>
          <p className="admin-card-subtitle">
            Generování, ruční úpravy, přesuny hlídek a export startovky.
          </p>
        </div>
      </header>
      <div className="admin-placeholder-grid">
        <div className="admin-placeholder-item"><strong>Generovat starty</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Ruční přesun hlídky</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Kolize startů</strong><span>TODO</span></div>
        <div className="admin-placeholder-item"><strong>Tisk/export startovky</strong><span>TODO</span></div>
      </div>
      {/* TODO: Napojit správu startovních časů na backend. */}
    </section>
  );
}

type ResultsSectionProps = {
  totalMissingAcrossStations: number;
  summary: RaceDashboardSummary;
  exportingLeague: boolean;
  onExportLeaguePoints: () => void;
};

export function AdminResultsSection({
  totalMissingAcrossStations,
  summary,
  exportingLeague,
  onExportLeaguePoints,
}: ResultsSectionProps) {
  const hasResultProblems = totalMissingAcrossStations > 0 || summary.patrolsOnCourse > 0 || summary.overdueNoFinishPatrols > 0;

  return (
    <section
      id={toAdminSectionId('results')}
      className="admin-card admin-card--section admin-card--results-focus admin-section-block admin-section-block--results"
    >
      <header className="admin-card-header">
        <div>
          <h2>Výsledky</h2>
          <p className="admin-card-subtitle">
            Průběžné a finální výsledky včetně kontrol před vyhlášením.
          </p>
        </div>
        <div className="admin-card-actions">
          <a
            className="admin-button admin-button--secondary"
            href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky"
            target="_blank"
            rel="noreferrer"
          >
            Otevřít průběžné výsledky
          </a>
          <a
            className="admin-button admin-button--secondary"
            href="https://www.zelenaliga.cz/aplikace/setonuv-zavod/vysledky?autoExport=1"
            target="_blank"
            rel="noreferrer"
          >
            Export výsledků (CSV/PDF)
          </a>
          <button
            type="button"
            className="admin-button admin-button--secondary"
            disabled
          >
            Export diplomů (TODO)
          </button>
        </div>
      </header>
      {hasResultProblems ? (
        <div className="admin-results-alerts">
          {totalMissingAcrossStations > 0 ? (
            <p className="admin-error">Ve stanovištích chybí průchody nebo body.</p>
          ) : null}
          {summary.patrolsOnCourse > 0 ? (
            <p className="admin-notice">Některé hlídky jsou stále neuzavřené.</p>
          ) : null}
          {summary.overdueNoFinishPatrols > 0 ? (
            <p className="admin-error">Některé hlídky nemají cílový čas po očekávaném limitu.</p>
          ) : null}
        </div>
      ) : null}
      <div className="admin-placeholder-grid">
        <div className="admin-placeholder-item admin-placeholder-item--warning">
          <strong>Chybějící průchody / body</strong>
          <span>{totalMissingAcrossStations}</span>
        </div>
        <div className="admin-placeholder-item admin-placeholder-item--warning">
          <strong>Neuzavřené hlídky</strong>
          <span>{summary.patrolsOnCourse}</span>
        </div>
        <div className="admin-placeholder-item admin-placeholder-item--danger">
          <strong>Bez cíle po limitu</strong>
          <span>{summary.overdueNoFinishPatrols}</span>
        </div>
        <div className="admin-placeholder-item">
          <strong>Diskvalifikované / mimo soutěž</strong>
          <span>TODO</span>
        </div>
      </div>
      <div className="admin-card-actions">
        <button type="button" className="admin-button admin-button--secondary admin-button--cta" disabled>
          Potvrdit výsledky hlavním rozhodčím (TODO)
        </button>
        <button
          type="button"
          className="admin-button admin-button--primary admin-button--cta"
          onClick={onExportLeaguePoints}
          disabled={exportingLeague}
        >
          {exportingLeague ? 'Exportuji…' : 'Výpočet bodů do Zelené ligy'}
        </button>
      </div>
    </section>
  );
}

type StatsSectionProps = {
  showStatsSection: boolean;
  onToggle: () => void;
  summary: RaceDashboardSummary;
};

export function AdminStatsSection({
  showStatsSection,
  onToggle,
  summary,
}: StatsSectionProps) {
  return (
    <section
      id={toAdminSectionId('stats')}
      className="admin-card admin-card--section admin-card--low-priority admin-section-block admin-section-block--stats"
    >
      <header className="admin-card-header">
        <div>
          <h2>Statistiky</h2>
          <p className="admin-card-subtitle">
            Přehled vytíženosti a výkonnosti stanovišť. Defaultně sbaleno.
          </p>
        </div>
        <div className="admin-card-actions">
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={onToggle}
          >
            {showStatsSection ? 'Skrýt statistiky' : 'Zobrazit statistiky'}
          </button>
        </div>
      </header>
      {showStatsSection ? (
        <div className="admin-placeholder-grid">
          <div className="admin-placeholder-item">
            <strong>Hlídky na trati</strong>
            <span>{summary.patrolsOnCourse}</span>
          </div>
          <div className="admin-placeholder-item">
            <strong>Dokončené hlídky</strong>
            <span>{summary.patrolsFinished}</span>
          </div>
          <div className="admin-placeholder-item">
            <strong>Čekající na start</strong>
            <span>{summary.patrolsWaitingForStart}</span>
          </div>
          <div className="admin-placeholder-item">
            <strong>Poslední synchronizace</strong>
            <span>{formatDateTimeForStatus(summary.lastSyncAt)}</span>
          </div>
        </div>
      ) : (
        <p className="admin-card-subtitle">Statistiky jsou skryté. Otevři je tlačítkem výše.</p>
      )}
    </section>
  );
}

type ExportsOverviewSectionProps = {
  showExportsSection: boolean;
  onToggle: () => void;
  onExportNameCheck: () => void;
  exportingNames: boolean;
  onExportLeaguePoints: () => void;
  exportingLeague: boolean;
};

export function AdminExportsOverviewSection({
  showExportsSection,
  onToggle,
  onExportNameCheck,
  exportingNames,
  onExportLeaguePoints,
  exportingLeague,
}: ExportsOverviewSectionProps) {
  return (
    <section
      id={toAdminSectionId('exports')}
      className="admin-card admin-card--section admin-card--low-priority admin-section-block admin-section-block--exports"
    >
      <header className="admin-card-header">
        <div>
          <h2>Exporty, importy a technická správa</h2>
          <p className="admin-card-subtitle">
            Diagnostika, exporty a servisní operace. Sekce je defaultně sbalená.
          </p>
        </div>
        <div className="admin-card-actions">
          <button
            type="button"
            className="admin-button admin-button--secondary"
            onClick={onToggle}
          >
            {showExportsSection ? 'Skrýt exporty a techniku' : 'Zobrazit exporty a techniku'}
          </button>
        </div>
      </header>
      {showExportsSection ? (
        <>
          <div className="admin-card-actions">
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={onExportNameCheck}
              disabled={exportingNames}
            >
              {exportingNames ? 'Exportuji…' : 'Export kontrola jmen'}
            </button>
            <button
              type="button"
              className="admin-button admin-button--secondary"
              onClick={onExportLeaguePoints}
              disabled={exportingLeague}
            >
              {exportingLeague ? 'Exportuji…' : 'Export body ZL'}
            </button>
          </div>
          <p className="admin-card-subtitle">
            TODO: audit log, offline queue/debug, diagnostika synchronizace a API nástroje.
          </p>
        </>
      ) : (
        <p className="admin-card-subtitle">Exporty a technická správa jsou skryté.</p>
      )}
    </section>
  );
}
