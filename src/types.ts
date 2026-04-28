export type PlayerStatus = 'registered' | 'waiting' | 'alive' | 'eliminated' | 'winner';
export type GameState = 'registration' | 'active' | 'ended';

export interface Player {
  fid: number;
  username: string;
  status: PlayerStatus;
  target_fid: number | null;
  assassin_fid: number | null;
  availability_start: number; // 0–23 UTC hour window begins
  availability_duration: number; // always 8
  kill_count: number;
  eliminated_by_fid: number | null;
  grace_period_active: 0 | 1; // SQLite stores booleans as integers
  grace_period_expires: number | null; // Unix ms
  registered_at: number; // Unix ms
  last_seen: number; // Unix ms
}

export interface GameConfig {
  game_state: GameState;
  registration_deadline: number; // Unix ms
  game_start: number; // Unix ms
  min_players: number;
}

// Typed element for snap UI building
export type SnapEl = {
  type: string;
  props?: Record<string, unknown>;
  children?: string[];
  on?: {
    press?: {
      action: string;
      params?: Record<string, unknown>;
    };
  };
};
