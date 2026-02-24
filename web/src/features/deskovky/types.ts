export type BoardScoringType = 'points' | 'placement' | 'both';
export type BoardMatchStatus = 'submitted' | 'void';
export type BoardPointsOrder = 'asc' | 'desc';

export interface BoardEvent {
  id: string;
  slug: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
}

export interface BoardCategory {
  id: string;
  event_id: string;
  name: string;
  primary_game_id: string | null;
  created_at: string;
}

export interface BoardGame {
  id: string;
  event_id: string;
  name: string;
  scoring_type: BoardScoringType;
  points_order: BoardPointsOrder;
  three_player_adjustment: boolean;
  notes: string | null;
  created_at: string;
}

export interface BoardBlock {
  id: string;
  event_id: string;
  category_id: string;
  block_number: number;
  game_id: string;
  created_at: string;
}

export interface BoardPlayer {
  id: string;
  event_id: string;
  short_code: string;
  team_name: string | null;
  display_name: string | null;
  category_id: string;
  disqualified?: boolean;
  created_at: string;
}

export interface BoardJudgeAssignment {
  id: string;
  event_id: string;
  user_id: string;
  game_id: string;
  category_id: string | null;
  table_number?: number | null;
  created_at: string;
}

export interface BoardMatch {
  id: string;
  event_id: string;
  category_id: string;
  block_id: string;
  round_number: number | null;
  table_number?: number | null;
  created_by: string;
  created_at: string;
  status: BoardMatchStatus;
}

export interface BoardMatchPlayer {
  id: string;
  match_id: string;
  player_id: string;
  seat: number;
  placement: number | null;
  points: number | null;
  created_at: string;
}

export interface BoardGameStanding {
  event_id: string;
  category_id: string;
  game_id: string;
  player_id: string;
  matches_played: number;
  total_points: number | null;
  avg_placement: number | null;
  best_placement: number | null;
  game_rank: number;
}

export interface BoardOverallStanding {
  event_id: string;
  category_id: string;
  player_id: string;
  primary_game_id: string | null;
  games_counted: number;
  overall_score: number;
  game_breakdown: Array<{
    game_id: string;
    game_name: string;
    is_primary: boolean;
    game_rank: number;
    total_points: number | null;
    avg_placement: number | null;
  }> | null;
  overall_rank: number;
}

export interface BoardJudgeContext {
  assignments: BoardJudgeAssignment[];
  events: BoardEvent[];
  games: BoardGame[];
  categories: BoardCategory[];
}

export interface BoardAdminJudge {
  id: string;
  email: string;
  display_name: string;
}
