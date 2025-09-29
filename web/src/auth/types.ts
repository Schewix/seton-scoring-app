export interface LoginResponse {
  access_token: string;
  access_token_expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  device_salt: string;
  manifest: StationManifest;
  patrols: PatrolSummary[];
}

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

export interface TicketManifest {
  stationId: string;
  judgeId: string;
  manifestVersion: number;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  sessionId: string;
}

export type AuthStatus =
  | { state: 'loading' }
  | { state: 'locked'; requiresPin: boolean }
  | { state: 'unauthenticated' }
  | { state: 'error'; message: string }
  | {
      state: 'authenticated';
      manifest: StationManifest;
      patrols: PatrolSummary[];
      deviceKey: Uint8Array;
      tokens: AuthTokens;
    };
