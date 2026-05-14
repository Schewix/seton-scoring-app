import type {
  LivePatrolState,
  MapPassage,
  MapPatrol,
  MapStationScore,
  MapStation,
  MapTiming,
  StationLiveSummary,
  StationMapPosition,
} from './types';

const SERVING_RECENCY_MS = 12 * 60 * 1000;
const WAITING_RECENCY_MS = 30 * 60 * 1000;
const WAITING_THRESHOLD_MINUTES = 5;
const AVERAGE_WINDOW = 50;

function toUpper(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function passageSortValue(passage: MapPassage) {
  return (
    toTimestamp(passage.arrived_at) ||
    toTimestamp(passage.left_at) ||
    toTimestamp(passage.client_created_at) ||
    0
  );
}

function createPassageIndex(passages: readonly MapPassage[]) {
  const byPatrol = new Map<string, MapPassage[]>();
  passages.forEach((passage) => {
    const key = passage.patrol_id;
    const bucket = byPatrol.get(key) ?? [];
    bucket.push(passage);
    byPatrol.set(key, bucket);
  });
  byPatrol.forEach((bucket) => {
    bucket.sort((a, b) => passageSortValue(b) - passageSortValue(a));
  });
  return byPatrol;
}

export function formatPatrolLabel(patrol: Pick<MapPatrol, 'patrol_code' | 'team_name' | 'category' | 'sex'>) {
  const code = toUpper(patrol.patrol_code);
  if (code) {
    return code;
  }
  const category = toUpper(patrol.category);
  const sex = toUpper(patrol.sex);
  if (category && sex) {
    return `${category}${sex}`;
  }
  return category || sex || '—';
}

export function buildLivePatrolStates(input: {
  patrols: readonly MapPatrol[];
  timings: readonly MapTiming[];
  passages: readonly MapPassage[];
  now: number;
}) {
  const timingByPatrol = new Map(input.timings.map((timing) => [timing.patrol_id, timing] as const));
  const passagesByPatrol = createPassageIndex(input.passages);

  const onCourse: LivePatrolState[] = [];
  const finished: LivePatrolState[] = [];
  const notStarted: LivePatrolState[] = [];

  input.patrols.forEach((patrol) => {
    if (!patrol.active || patrol.disqualified) {
      return;
    }

    const timing = timingByPatrol.get(patrol.id);
    const hasStart = Boolean(timing?.start_time);
    const hasFinish = Boolean(timing?.finish_time);

    if (!hasStart) {
      notStarted.push({
        patrol,
        status: 'na-trase',
        currentStationId: null,
        latestArrivalAt: null,
        waitMinutes: 0,
      });
      return;
    }

    const latestPassage = passagesByPatrol.get(patrol.id)?.[0] ?? null;
    const latestArrivalAt = latestPassage?.arrived_at ?? latestPassage?.client_created_at ?? null;
    const latestArrivalTs = toTimestamp(latestArrivalAt);
    const waitMinutes = Math.max(0, Number(latestPassage?.wait_minutes ?? 0) || 0);

    if (hasFinish) {
      finished.push({
        patrol,
        status: 'dobehla',
        currentStationId: latestPassage?.station_id ?? null,
        latestArrivalAt,
        waitMinutes,
      });
      return;
    }

    let status: LivePatrolState['status'] = 'na-trase';
    const deltaMs = Number.isFinite(latestArrivalTs) ? input.now - latestArrivalTs : Number.POSITIVE_INFINITY;
    const hasOpenPassage = Boolean(latestPassage && latestPassage.arrived_at && !latestPassage.left_at);

    // TODO: Backend currently does not expose explicit queue state for all stations.
    // We derive waiting/serving from passages and recorded wait_minutes.
    if (hasOpenPassage && deltaMs <= WAITING_RECENCY_MS) {
      status = 'plni';
    } else if (latestPassage && deltaMs <= WAITING_RECENCY_MS && waitMinutes >= WAITING_THRESHOLD_MINUTES) {
      status = 'ceka';
    } else if (latestPassage && deltaMs <= SERVING_RECENCY_MS) {
      status = 'plni';
    }

    onCourse.push({
      patrol,
      status,
      currentStationId: latestPassage?.station_id ?? null,
      latestArrivalAt,
      waitMinutes,
    });
  });

  return {
    onCourse,
    finished,
    notStarted,
  };
}

function formatAverageMinutes(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export function buildStationLiveSummaries(input: {
  stations: readonly MapStation[];
  positions: readonly StationMapPosition[];
  passages: readonly MapPassage[];
  stationScores?: readonly MapStationScore[];
  livePatrols: readonly LivePatrolState[];
  patrolById: ReadonlyMap<string, MapPatrol>;
}) {
  const positionByStation = new Map(input.positions.map((item) => [item.station_id, item] as const));
  const passageByStation = new Map<string, MapPassage[]>();
  const scoreByStation = new Map<string, MapStationScore[]>();

  input.passages.forEach((passage) => {
    const bucket = passageByStation.get(passage.station_id) ?? [];
    bucket.push(passage);
    passageByStation.set(passage.station_id, bucket);
  });
  passageByStation.forEach((bucket) => {
    bucket.sort((a, b) => passageSortValue(b) - passageSortValue(a));
  });
  (input.stationScores ?? []).forEach((score) => {
    const bucket = scoreByStation.get(score.station_id) ?? [];
    bucket.push(score);
    scoreByStation.set(score.station_id, bucket);
  });
  scoreByStation.forEach((bucket) => {
    bucket.sort((a, b) => {
      const aTs = toTimestamp(a.client_created_at) || toTimestamp(a.created_at) || 0;
      const bTs = toTimestamp(b.client_created_at) || toTimestamp(b.created_at) || 0;
      return bTs - aTs;
    });
  });

  const patrolsByStation = new Map<string, LivePatrolState[]>();
  input.livePatrols.forEach((state) => {
    if (!state.currentStationId) {
      return;
    }
    const bucket = patrolsByStation.get(state.currentStationId) ?? [];
    bucket.push(state);
    patrolsByStation.set(state.currentStationId, bucket);
  });

  return input.stations.map<StationLiveSummary>((station) => {
    const stationPatrols = patrolsByStation.get(station.id) ?? [];
    const servingPatrols = stationPatrols.filter((state) => state.status === 'plni');
    const waitingPatrols = stationPatrols.filter((state) => state.status === 'ceka');
    const stationPassages = (passageByStation.get(station.id) ?? []).slice(0, AVERAGE_WINDOW);
    const waitValues = stationPassages
      .map((passage) => Number(passage.wait_minutes ?? 0))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const serviceValues = stationPassages
      .map((passage) => {
        const left = toTimestamp(passage.left_at);
        const arrived = toTimestamp(passage.arrived_at);
        if (!Number.isFinite(left) || !Number.isFinite(arrived) || left < arrived) {
          return Number.NaN;
        }
        return (left - arrived) / (60 * 1000);
      })
      .filter((value) => Number.isFinite(value) && value >= 0);

    const recentPassages = stationPassages.slice(0, 8).map((passage) => {
      const patrol = input.patrolById.get(passage.patrol_id);
      return {
        id: passage.id,
        patrolCode: patrol ? formatPatrolLabel(patrol) : '—',
        teamName: patrol?.team_name ?? '',
        arrivedAt: passage.arrived_at ?? passage.client_created_at,
        waitMinutes: Math.max(0, Number(passage.wait_minutes ?? 0) || 0),
      };
    });
    const lastScoreAt = scoreByStation.get(station.id)?.[0];
    const scoreTimestamp =
      toTimestamp(lastScoreAt?.client_created_at) ||
      toTimestamp(lastScoreAt?.created_at) ||
      Number.NaN;
    const passageTimestamp = toTimestamp(recentPassages[0]?.arrivedAt ?? null);
    let lastActivityAt: string | null = null;
    if (Number.isFinite(passageTimestamp) || Number.isFinite(scoreTimestamp)) {
      if (Number.isFinite(passageTimestamp) && passageTimestamp >= scoreTimestamp) {
        lastActivityAt = recentPassages[0]?.arrivedAt ?? null;
      } else {
        lastActivityAt = lastScoreAt?.client_created_at ?? lastScoreAt?.created_at ?? null;
      }
    }

    return {
      station,
      position: positionByStation.get(station.id) ?? null,
      servingCount: servingPatrols.length,
      waitingCount: waitingPatrols.length,
      lastPassageAt: lastActivityAt,
      averageWaitMinutes: formatAverageMinutes(waitValues),
      averageServiceMinutes: formatAverageMinutes(serviceValues),
      servingPatrols,
      waitingPatrols,
      recentPassages,
    };
  });
}

export function createStationOrder(stations: readonly MapStation[]) {
  return [...stations].sort((a, b) => {
    const codeCompare = toUpper(a.code).localeCompare(toUpper(b.code), 'cs');
    if (codeCompare !== 0) {
      return codeCompare;
    }
    return a.name.localeCompare(b.name, 'cs');
  });
}

export function queueSeverity(waitingCount: number) {
  if (waitingCount <= 0) {
    return 'ok';
  }
  if (waitingCount <= 2) {
    return 'warn';
  }
  return 'critical';
}
