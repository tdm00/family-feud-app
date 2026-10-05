import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  slot: integer("slot").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  score: integer("score").notNull().default(0),
});

export const players = sqliteTable("players", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  teamId: text("team_id"),
  createdAt: integer("created_at").notNull(),
});

export const questions = sqliteTable("questions", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  usedAt: integer("used_at"),
  sortOrder: integer("sort_order").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const answers = sqliteTable("answers", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull(),
  text: text("text").notNull(),
  points: integer("points").notNull(),
  rank: integer("rank").notNull(),
});

export const aliases = sqliteTable("aliases", {
  id: text("id").primaryKey(),
  answerId: text("answer_id").notNull(),
  text: text("text").notNull(),
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  gameId: text("game_id").notNull(),
  questionId: text("question_id").notNull(),
  phase: text("phase").notNull(),
  active: integer("active").notNull().default(1),
  controllingTeamId: text("controlling_team_id"),
  faceoffPlayerA: text("faceoff_player_a"),
  faceoffPlayerB: text("faceoff_player_b"),
  answeringPlayerId: text("answering_player_id"),
  faceoffMisses: integer("faceoff_misses").notNull().default(0),
  strikes: integer("strikes").notNull().default(0),
  pot: integer("pot").notNull().default(0),
  stealTeamId: text("steal_team_id"),
  buzzWindowId: text("buzz_window_id"),
  buzzWinnerId: text("buzz_winner_id"),
  pendingText: text("pending_text"),
  pointsApplied: integer("points_applied").notNull().default(0),
  awardedTeamId: text("awarded_team_id"),
  undoJson: text("undo_json"),
  createdAt: integer("created_at").notNull(),
});

export const roundReveals = sqliteTable("round_reveals", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  answerId: text("answer_id").notNull(),
  revealedAt: integer("revealed_at").notNull(),
});

export const buzzWindows = sqliteTable("buzz_windows", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  winnerPlayerId: text("winner_player_id"),
  open: integer("open").notNull().default(1),
  eligibleJson: text("eligible_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const buzzes = sqliteTable("buzzes", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  windowId: text("window_id").notNull(),
  playerId: text("player_id").notNull(),
  receivedAt: integer("received_at").notNull(),
  won: integer("won").notNull().default(0),
});

export const displayTokens = sqliteTable("display_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
});
