export interface StationManifest {
  judge: {
    id: string;
    email: string;
    displayName: string;
  };
  station: {
    id: string;
    code: string;
    name: string;
  };
  event: {
    id: string;
    name: string;
  };
  allowedCategories: string[];
  allowedTasks: string[];
  manifestVersion: number;
}

export interface PatrolSummary {
  id: string;
  team_name: string;
  category: string;
  sex: string;
  patrol_code: string;
}
