export type StationMapPosition = {
  id: string;
  event_id: string;
  station_id: string;
  x_percent: number;
  y_percent: number;
  created_at: string | null;
};

export type EventMapRow = {
  id: string;
  event_id: string;
  image_url: string;
  created_at: string | null;
};

export type MapStation = {
  id: string;
  event_id: string;
  code: string;
  name: string;
  is_split?: boolean | null;
  split_categories?: string[] | null;
};

export type MapPatrol = {
  id: string;
  event_id: string;
  team_name: string;
  patrol_code: string;
  category: string;
  sex: string;
  active: boolean;
  disqualified: boolean;
};

export type MapTiming = {
  event_id: string;
  patrol_id: string;
  start_time: string | null;
  finish_time: string | null;
};

export type MapPassage = {
  id: string;
  event_id: string;
  station_id: string;
  patrol_id: string;
  arrived_at: string | null;
  left_at: string | null;
  wait_minutes: number;
  client_created_at: string | null;
};

export type MapStationScore = {
  id: string;
  event_id: string;
  station_id: string;
  patrol_id: string;
  created_at: string | null;
  client_created_at: string | null;
};

export type LivePatrolState = {
  patrol: MapPatrol;
  status: 'na-trase' | 'ceka' | 'plni' | 'dobehla';
  currentStationId: string | null;
  latestArrivalAt: string | null;
  waitMinutes: number;
};

export type StationLiveSummary = {
  station: MapStation;
  position: StationMapPosition | null;
  servingCount: number;
  waitingCount: number;
  lastPassageAt: string | null;
  averageWaitMinutes: number | null;
  averageServiceMinutes: number | null;
  servingPatrols: LivePatrolState[];
  waitingPatrols: LivePatrolState[];
  recentPassages: Array<{
    id: string;
    patrolCode: string;
    teamName: string;
    arrivedAt: string | null;
    waitMinutes: number;
  }>;
};
