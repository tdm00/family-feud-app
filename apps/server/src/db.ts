import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

const MIGRATION_SQL = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL UNIQUE CHECK (slot IN (1, 2)),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  team_id TEXT REFERENCES teams(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX players_name_nocase ON players(name COLLATE NOCASE);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  used_at INTEGER,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  points INTEGER NOT NULL,
  rank INTEGER NOT NULL
);

CREATE TABLE aliases (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  text TEXT NOT NULL
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  phase TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  controlling_team_id TEXT,
  faceoff_player_a TEXT,
  faceoff_player_b TEXT,
  answering_player_id TEXT,
  faceoff_misses INTEGER NOT NULL DEFAULT 0,
  strikes INTEGER NOT NULL DEFAULT 0,
  pot INTEGER NOT NULL DEFAULT 0,
  steal_team_id TEXT,
  buzz_window_id TEXT,
  buzz_winner_id TEXT,
  pending_text TEXT,
  points_applied INTEGER NOT NULL DEFAULT 0,
  awarded_team_id TEXT,
  undo_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX rounds_active_idx ON rounds(active);

CREATE TABLE round_reveals (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  answer_id TEXT NOT NULL,
  revealed_at INTEGER NOT NULL,
  UNIQUE (round_id, answer_id)
);

CREATE TABLE buzz_windows (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  winner_player_id TEXT,
  open INTEGER NOT NULL DEFAULT 1,
  eligible_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE buzzes (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  won INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE display_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
`;

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

export function openDatabase(dbPath: string): { sqlite: Database.Database; db: AppDb; path: string } {
  const resolved = path.resolve(dbPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, path: resolved };
}

function migrate(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = sqlite.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001_init");
  if (applied) return;
  const run = sqlite.transaction(() => {
    sqlite.exec(MIGRATION_SQL);
    sqlite.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_init", Date.now());
  });
  run();
}

export function seed(db: AppDb, roomCode: string): void {
  const room = db.select().from(schema.settings).where(eq(schema.settings.key, "room_code")).get();
  if (!room) {
    db.insert(schema.settings).values({ key: "room_code", value: roomCode }).run();
  }
  const points = db.select().from(schema.settings).where(eq(schema.settings.key, "points_to_win")).get();
  if (!points) {
    db.insert(schema.settings).values({ key: "points_to_win", value: "" }).run();
  }
  const existingTeams = db.select().from(schema.teams).all();
  if (existingTeams.length === 0) {
    db.insert(schema.teams)
      .values([
        { id: crypto.randomUUID(), slot: 1, name: "Family 1", color: "#2f6fed", score: 0 },
        { id: crypto.randomUUID(), slot: 2, name: "Family 2", color: "#d12d2d", score: 0 },
      ])
      .run();
  }
  const game = db.select().from(schema.games).where(eq(schema.games.status, "active")).get();
  if (!game) {
    db.insert(schema.games)
      .values({ id: crypto.randomUUID(), status: "active", createdAt: Date.now() })
      .run();
  }
}
