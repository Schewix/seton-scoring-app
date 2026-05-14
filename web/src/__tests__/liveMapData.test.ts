import { describe, expect, it } from 'vitest';
import {
  buildLivePatrolStates,
  buildStationLiveSummaries,
  queueSeverity,
} from '../liveMap/liveMapData';
import type { MapPassage, MapPatrol, MapStation, MapTiming, StationMapPosition } from '../liveMap/types';

function createPatrol(id: string, overrides: Partial<MapPatrol> = {}): MapPatrol {
  return {
    id,
    event_id: 'event-1',
    team_name: `Team ${id}`,
    patrol_code: `NH-${id}`,
    category: 'N',
    sex: 'H',
    active: true,
    disqualified: false,
    ...overrides,
  };
}

function createTiming(patrolId: string, overrides: Partial<MapTiming> = {}): MapTiming {
  return {
    event_id: 'event-1',
    patrol_id: patrolId,
    start_time: '2026-05-14T08:00:00Z',
    finish_time: null,
    ...overrides,
  };
}

function createPassage(
  id: string,
  patrolId: string,
  stationId: string,
  overrides: Partial<MapPassage> = {},
): MapPassage {
  return {
    id,
    event_id: 'event-1',
    station_id: stationId,
    patrol_id: patrolId,
    arrived_at: '2026-05-14T09:00:00Z',
    left_at: null,
    wait_minutes: 0,
    client_created_at: '2026-05-14T09:00:00Z',
    ...overrides,
  };
}

describe('liveMapData', () => {
  it('classifies patrol states from timings and passages', () => {
    const patrols: MapPatrol[] = [
      createPatrol('1'),
      createPatrol('2'),
      createPatrol('3'),
      createPatrol('4'),
      createPatrol('5'),
      createPatrol('6', { disqualified: true }),
      createPatrol('7', { active: false }),
    ];

    const timings: MapTiming[] = [
      createTiming('1'),
      createTiming('2'),
      createTiming('3'),
      createTiming('4'),
      createTiming('5', { start_time: null }),
      createTiming('6'),
      createTiming('7'),
    ];

    const now = Date.parse('2026-05-14T10:00:00Z');
    const passages: MapPassage[] = [
      createPassage('p1', '1', 'station-a', {
        arrived_at: '2026-05-14T09:54:00Z',
        wait_minutes: 0,
      }),
      createPassage('p2', '2', 'station-a', {
        arrived_at: '2026-05-14T09:45:00Z',
        left_at: '2026-05-14T09:47:00Z',
        wait_minutes: 8,
      }),
      createPassage('p3', '3', 'station-b', {
        arrived_at: '2026-05-14T09:10:00Z',
        wait_minutes: 0,
      }),
      createPassage('p4', '4', 'station-c', {
        arrived_at: '2026-05-14T09:50:00Z',
      }),
    ];

    timings[3] = createTiming('4', { finish_time: '2026-05-14T09:58:00Z' });

    const result = buildLivePatrolStates({ patrols, timings, passages, now });

    expect(result.onCourse).toHaveLength(3);
    expect(result.finished).toHaveLength(1);
    expect(result.notStarted).toHaveLength(1);

    const stateByPatrolId = new Map(result.onCourse.map((state) => [state.patrol.id, state]));
    expect(stateByPatrolId.get('1')?.status).toBe('plni');
    expect(stateByPatrolId.get('2')?.status).toBe('ceka');
    expect(stateByPatrolId.get('3')?.status).toBe('na-trase');
    expect(result.finished[0]?.patrol.id).toBe('4');
    expect(result.finished[0]?.status).toBe('dobehla');
    expect(result.notStarted[0]?.patrol.id).toBe('5');
  });

  it('builds station summaries with queue stats and averages', () => {
    const stations: MapStation[] = [
      { id: 'station-a', event_id: 'event-1', code: 'A', name: 'Alfa' },
      { id: 'station-b', event_id: 'event-1', code: 'B', name: 'Beta' },
    ];
    const positions: StationMapPosition[] = [
      {
        id: 'pos-a',
        event_id: 'event-1',
        station_id: 'station-a',
        x_percent: 20,
        y_percent: 40,
        created_at: '2026-05-14T08:00:00Z',
      },
    ];

    const patrols = [createPatrol('1', { patrol_code: 'NH-1' }), createPatrol('2', { patrol_code: 'NH-2' })];
    const patrolById = new Map(patrols.map((patrol) => [patrol.id, patrol] as const));
    const livePatrols = [
      {
        patrol: patrols[0],
        status: 'plni' as const,
        currentStationId: 'station-a',
        latestArrivalAt: '2026-05-14T10:00:00Z',
        waitMinutes: 1,
      },
      {
        patrol: patrols[1],
        status: 'ceka' as const,
        currentStationId: 'station-a',
        latestArrivalAt: '2026-05-14T10:01:00Z',
        waitMinutes: 7,
      },
    ];
    const passages: MapPassage[] = [
      createPassage('p1', '1', 'station-a', {
        arrived_at: '2026-05-14T09:10:00Z',
        left_at: '2026-05-14T09:16:00Z',
        wait_minutes: 2,
      }),
      createPassage('p2', '2', 'station-a', {
        arrived_at: '2026-05-14T09:20:00Z',
        left_at: '2026-05-14T09:29:00Z',
        wait_minutes: 4,
      }),
    ];

    const summaries = buildStationLiveSummaries({
      stations,
      positions,
      passages,
      livePatrols,
      patrolById,
    });

    const stationA = summaries.find((summary) => summary.station.id === 'station-a');
    const stationB = summaries.find((summary) => summary.station.id === 'station-b');

    expect(stationA).toBeTruthy();
    expect(stationA?.position?.x_percent).toBe(20);
    expect(stationA?.servingCount).toBe(1);
    expect(stationA?.waitingCount).toBe(1);
    expect(stationA?.averageWaitMinutes).toBe(3);
    expect(stationA?.averageServiceMinutes).toBe(7.5);
    expect(stationA?.recentPassages[0]?.patrolCode).toBe('NH-2');

    expect(stationB).toBeTruthy();
    expect(stationB?.position).toBeNull();
    expect(stationB?.servingCount).toBe(0);
    expect(stationB?.waitingCount).toBe(0);
  });

  it('returns queue severity levels', () => {
    expect(queueSeverity(0)).toBe('ok');
    expect(queueSeverity(2)).toBe('warn');
    expect(queueSeverity(3)).toBe('critical');
  });
});
