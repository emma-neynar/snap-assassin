import { createClient, type Client } from '@libsql/client';
import type { Player, GameConfig, GameState } from './types.js';

// ── Client singleton ──────────────────────────────────────────────────────────

let _client: Client | null = null;

function client(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL ?? 'file:assassin.db';
  const authToken = process.env.TURSO_AUTH_TOKEN;
  _client = createClient({ url, authToken });
  return _client;
}

// ── Init (idempotent, called once per process) ────────────────────────────────

let _initDone = false;

export async function initDb(): Promise<void> {
  if (_initDone) return;
  _initDone = true;
  const c = client();

  await c.batch(
    [
      {
        sql: `CREATE TABLE IF NOT EXISTS players (
          fid                   INTEGER PRIMARY KEY,
          username              TEXT    NOT NULL DEFAULT '',
          status                TEXT    NOT NULL DEFAULT 'registered',
          target_fid            INTEGER,
          assassin_fid          INTEGER,
          availability_start    INTEGER NOT NULL DEFAULT 0,
          availability_duration INTEGER NOT NULL DEFAULT 8,
          kill_count            INTEGER NOT NULL DEFAULT 0,
          eliminated_by_fid     INTEGER,
          grace_period_active   INTEGER NOT NULL DEFAULT 0,
          grace_period_expires  INTEGER,
          registered_at         INTEGER NOT NULL,
          last_seen             INTEGER NOT NULL
        )`,
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS game_config (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
        args: [],
      },
      {
        sql: `CREATE TABLE IF NOT EXISTS eliminations (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          assassin_fid INTEGER NOT NULL,
          target_fid   INTEGER NOT NULL,
          occurred_at  INTEGER NOT NULL
        )`,
        args: [],
      },
    ],
    'write'
  );

  // Seed config only on first-ever run
  const { rows } = await c.execute('SELECT COUNT(*) as n FROM game_config');
  if (Number(rows[0]!.n) === 0) {
    const now = Date.now();
    const deadline = process.env.REGISTRATION_DEADLINE_MS
      ? Number(process.env.REGISTRATION_DEADLINE_MS)
      : now + 48 * 60 * 60 * 1000;
    const gameStart = process.env.GAME_START_MS
      ? Number(process.env.GAME_START_MS)
      : deadline + 60 * 60 * 1000;
    const minPlayers = process.env.MIN_PLAYERS ? Number(process.env.MIN_PLAYERS) : 2;

    await c.batch(
      [
        { sql: `INSERT OR IGNORE INTO game_config VALUES ('game_state','registration')`, args: [] },
        { sql: `INSERT OR IGNORE INTO game_config VALUES ('registration_deadline',?)`, args: [String(deadline)] },
        { sql: `INSERT OR IGNORE INTO game_config VALUES ('game_start',?)`, args: [String(gameStart)] },
        { sql: `INSERT OR IGNORE INTO game_config VALUES ('min_players',?)`, args: [String(minPlayers)] },
      ],
      'write'
    );
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getGameConfig(): Promise<GameConfig> {
  const { rows } = await client().execute('SELECT key, value FROM game_config');
  const m: Record<string, string> = {};
  for (const r of rows) m[String(r.key)] = String(r.value);
  return {
    game_state: (m.game_state ?? 'registration') as GameState,
    registration_deadline: Number(m.registration_deadline ?? 0),
    game_start: Number(m.game_start ?? 0),
    min_players: Number(m.min_players ?? 2),
  };
}

export async function setGameState(state: GameState): Promise<void> {
  await client().execute({
    sql: `INSERT OR REPLACE INTO game_config (key, value) VALUES ('game_state', ?)`,
    args: [state],
  });
}

// ── Player reads ──────────────────────────────────────────────────────────────

function rowToPlayer(row: Record<string, unknown>): Player {
  return row as unknown as Player;
}

export async function getPlayer(fid: number): Promise<Player | null> {
  const { rows } = await client().execute({
    sql: 'SELECT * FROM players WHERE fid = ?',
    args: [fid],
  });
  return rows.length ? rowToPlayer(rows[0] as Record<string, unknown>) : null;
}

export async function getAlivePlayers(): Promise<Player[]> {
  const { rows } = await client().execute(
    `SELECT * FROM players WHERE status = 'alive'`
  );
  return rows.map(r => rowToPlayer(r as Record<string, unknown>));
}

export async function getRegisteredCount(): Promise<number> {
  const { rows } = await client().execute(
    `SELECT COUNT(*) as n FROM players WHERE status IN ('registered','waiting','alive','winner')`
  );
  return Number(rows[0]!.n);
}

export async function getRecentEliminations(
  limit = 5
): Promise<Array<{ assassin_username: string; target_username: string; occurred_at: number }>> {
  const { rows } = await client().execute({
    sql: `SELECT a.username as assassin_username, t.username as target_username, e.occurred_at
          FROM eliminations e
          JOIN players a ON a.fid = e.assassin_fid
          JOIN players t ON t.fid = e.target_fid
          ORDER BY e.occurred_at DESC LIMIT ?`,
    args: [limit],
  });
  return rows as unknown as Array<{
    assassin_username: string;
    target_username: string;
    occurred_at: number;
  }>;
}

// ── Player writes ─────────────────────────────────────────────────────────────

export async function registerPlayer(fid: number, username: string): Promise<void> {
  const now = Date.now();
  await client().batch(
    [
      {
        sql: `INSERT OR IGNORE INTO players (fid, username, status, registered_at, last_seen)
              VALUES (?, ?, 'registered', ?, ?)`,
        args: [fid, username, now, now],
      },
      {
        sql: `UPDATE players SET username = ?, last_seen = ? WHERE fid = ?`,
        args: [username, now, fid],
      },
    ],
    'write'
  );
}

export async function setAvailability(fid: number, start: number): Promise<void> {
  await client().execute({
    sql: `UPDATE players SET availability_start = ?, status = 'waiting', last_seen = ? WHERE fid = ?`,
    args: [start, Date.now(), fid],
  });
}

export async function touchPlayer(fid: number): Promise<void> {
  await client().execute({
    sql: 'UPDATE players SET last_seen = ? WHERE fid = ?',
    args: [Date.now(), fid],
  });
}

// ── Grace period ──────────────────────────────────────────────────────────────

export async function startGracePeriod(targetFid: number): Promise<void> {
  await client().execute({
    sql: 'UPDATE players SET grace_period_active = 1, grace_period_expires = ? WHERE fid = ?',
    args: [Date.now() + 5 * 60 * 1000, targetFid],
  });
}

export async function clearGracePeriod(targetFid: number): Promise<void> {
  await client().execute({
    sql: 'UPDATE players SET grace_period_active = 0, grace_period_expires = NULL WHERE fid = ?',
    args: [targetFid],
  });
}

// ── Elimination chain ─────────────────────────────────────────────────────────

export async function processElimination(targetFid: number, assassinFid: number): Promise<void> {
  const target = await getPlayer(targetFid);
  if (!target) return;

  const statements = [
    {
      sql: `UPDATE players SET status='eliminated', eliminated_by_fid=?, grace_period_active=0, grace_period_expires=NULL WHERE fid=?`,
      args: [assassinFid, targetFid],
    },
    {
      sql: `UPDATE players SET target_fid=? WHERE fid=?`,
      args: [target.target_fid, assassinFid],
    },
    {
      sql: `UPDATE players SET kill_count=kill_count+1 WHERE fid=?`,
      args: [assassinFid],
    },
    {
      sql: `INSERT INTO eliminations (assassin_fid, target_fid, occurred_at) VALUES (?,?,?)`,
      args: [assassinFid, targetFid, Date.now()],
    },
  ] as { sql: string; args: (string | number | null)[] }[];

  if (target.target_fid) {
    statements.push({
      sql: `UPDATE players SET assassin_fid=? WHERE fid=?`,
      args: [assassinFid, target.target_fid],
    });
  }

  await client().batch(statements, 'write');

  // Check win condition after batch (must be a separate query)
  const alive = await getAlivePlayers();
  if (alive.length === 1) {
    await client().batch(
      [
        { sql: `UPDATE players SET status='winner' WHERE fid=?`, args: [alive[0]!.fid] },
        { sql: `INSERT OR REPLACE INTO game_config VALUES ('game_state','ended')`, args: [] },
      ],
      'write'
    );
  }
}

// ── Assignment ────────────────────────────────────────────────────────────────

export async function assignTargets(): Promise<void> {
  const { rows } = await client().execute(
    `SELECT fid FROM players WHERE status IN ('registered','waiting')`
  );
  const fids = rows.map(r => Number(r.fid));

  // Fisher-Yates shuffle
  for (let i = fids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fids[i], fids[j]] = [fids[j]!, fids[i]!];
  }

  const statements = fids.map((fid, i) => ({
    sql: `UPDATE players SET status='alive', target_fid=?, assassin_fid=? WHERE fid=?`,
    args: [fids[(i + 1) % fids.length]!, fids[(i - 1 + fids.length) % fids.length]!, fid],
  }));
  statements.push({
    sql: `INSERT OR REPLACE INTO game_config VALUES ('game_state','active')`,
    args: [],
  });

  await client().batch(statements, 'write');
}

// ── Maintenance (called on each POST, replaces background interval) ────────────

export async function processExpiredGracePeriods(): Promise<void> {
  const now = Date.now();
  const { rows } = await client().execute({
    sql: `SELECT fid, assassin_fid FROM players
          WHERE grace_period_active=1 AND grace_period_expires IS NOT NULL AND grace_period_expires<?`,
    args: [now],
  });
  for (const r of rows) {
    await processElimination(Number(r.fid), Number(r.assassin_fid));
  }
}

export async function processInactivePlayers(inactivityMs = 48 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - inactivityMs;
  const { rows } = await client().execute({
    sql: `SELECT fid, assassin_fid FROM players
          WHERE status='alive' AND last_seen<? AND grace_period_active=0`,
    args: [cutoff],
  });
  for (const r of rows) {
    await processElimination(Number(r.fid), Number(r.assassin_fid));
  }
}

export async function maybeStartGame(): Promise<void> {
  const config = await getGameConfig();
  if (config.game_state !== 'registration') return;
  if (Date.now() < config.game_start) return;

  const { rows } = await client().execute(
    `SELECT COUNT(*) as n FROM players WHERE status IN ('registered','waiting')`
  );
  if (Number(rows[0]!.n) < config.min_players) return;

  await assignTargets();
}
