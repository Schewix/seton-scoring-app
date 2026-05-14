export type AdminSectionKey =
  | 'dashboard'
  | 'live'
  | 'queues'
  | 'patrols'
  | 'starts'
  | 'stations'
  | 'results'
  | 'stats'
  | 'exports';

export type AdminSectionItem = {
  key: AdminSectionKey;
  label: string;
};

export type RaceDashboardSummary = {
  registeredPatrols: number;
  patrolsSeenOnCourse: number;
  patrolsOnCourse: number;
  patrolsFinished: number;
  patrolsWaitingForStart: number;
  problematicStations: number;
  syncConflicts: number;
  missingLongPatrols: number;
  overdueNoFinishPatrols: number;
  lastSyncAt: string | null;
};

export const ADMIN_SECTION_ITEMS: ReadonlyArray<AdminSectionItem> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'live', label: 'Live' },
  { key: 'queues', label: 'Fronty' },
  { key: 'patrols', label: 'Hlídky' },
  { key: 'starts', label: 'Starty' },
  { key: 'stations', label: 'Stanoviště' },
  { key: 'results', label: 'Výsledky' },
  { key: 'stats', label: 'Statistiky' },
  { key: 'exports', label: 'Exporty' },
];

export const EMPTY_RACE_DASHBOARD_SUMMARY: RaceDashboardSummary = {
  registeredPatrols: 0,
  patrolsSeenOnCourse: 0,
  patrolsOnCourse: 0,
  patrolsFinished: 0,
  patrolsWaitingForStart: 0,
  problematicStations: 0,
  syncConflicts: 0,
  missingLongPatrols: 0,
  overdueNoFinishPatrols: 0,
  lastSyncAt: null,
};

export function formatDateTimeForStatus(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '—';
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return '—';
  }
  return new Date(timestamp).toLocaleString('cs-CZ');
}

export function toAdminSectionId(key: AdminSectionKey): string {
  return `admin-section-${key}`;
}
